import { Ctx, Page, exit, json, jsonExit } from '@/lib/ctx';
import { env } from '@/lib/env';
import { sanitize } from '@/lib/functions';
import { getCreateArgs, getGetArgs, newChallenge, processCreate, processGet } from '@/lib/webauthn';

const err = (m: string): never => jsonExit({ error: m });
const withOtp = (msg: string, otp: string) => (env.SHOW_OTP ? `${msg} (Test OTP: ${otp})` : msg);

function loginRedirectURL(ctx: Ctx) {
  if (ctx.S.current_page) return ctx.S.current_page;
  return ctx.S.user && ctx.S.user.access_level >= 4 ? `${env.SITE_URL}/admin/` : env.SITE_URL;
}

const isExit = (e: any) => e && typeof e === 'object' && 'result' in e;

export default async function (ctx: Ctx): Promise<Page | undefined> {
  const { S, db, post } = ctx;

  if (ctx.get.logout !== undefined) {
    delete S.user;
    delete S.locationOverride;
    ctx.session.touch();
    if (ctx.cookies['session_remember']) ctx.setCookie('session_remember', '', { maxAge: 0, path: '/', sameSite: 'lax', httpOnly: true });
    if (ctx.isSpa) return exit(json({ hard_redirect: `${env.SITE_URL}/login` }));
    ctx.headers['cache-control'] = 'no-store, no-cache, must-revalidate';
    return exit(new Response(null, { status: 302, headers: { location: 'login' } }));
  }

  if (ctx.isLoggedIn) {
    if (ctx.isSpa || ctx.method !== 'GET') return exit(json({ hard_redirect: env.SITE_URL }));
    return exit(new Response(null, { status: 302, headers: { location: env.SITE_URL } }));
  }

  if (post.action) {
    const account = ctx.account;
    const lc = () => (S['login-challenge'] ??= {});

    if (post.action === 'requestLogin') {
      const phone = sanitize(post.phone, 'number');
      const noWebauthn = post.webauthn === 'notsupported';

      if (noWebauthn) {
        if (post.otp && lc().otp) {
          if (lc().otp == post.otp) delete lc().otp; // continue to login
          else err('One time code is invalid.');
        } else {
          account.phone = phone;
          S['login-challenge'] = { phone, otp: await account.sendOTP('login'), otp_type: 'login' };
          ctx.session.touch();
          jsonExit({ actionRequired: 'otp', error: withOtp('Enter the one time code sent to your phone number', S['login-challenge'].otp) });
        }
      }

      const customer: any = await db.selectOne('SELECT id, status, name FROM users WHERE phone = ? AND status > 0', [phone]);
      if (!customer) err('No account found with this phone number. Contact your superior to create your account.');
      if (customer.status < 2) err('Your account is inactive. Please contact support for more information');

      if (noWebauthn) {
        account.id = customer.id;
        await account.login();
        jsonExit({ actionRequired: 'redirect', redirect: loginRedirectURL(ctx) });
      }

      const credentialIds: Buffer[] = [];
      let external = true;
      if (post.deviceId === 'unknown') {
        external = false;
        const devices = await db.selectAll('SELECT credential_id FROM user_devices WHERE user = ? AND credential_id IS NOT NULL', [customer.id]);
        if (!devices.length) jsonExit({ actionRequired: 'unidentifiedDevice' });
        for (const d of devices) credentialIds.push(Buffer.from(d.credential_id, 'base64'));
      } else if (post.deviceId === 'new') {
        if (!post.otp) {
          account.phone = phone;
          S['login-challenge'] = { user_id: customer.id, phone, otp: await account.sendOTP('new_device'), otp_type: 'new_device' };
          ctx.session.touch();
          jsonExit({ actionRequired: 'otp', error: withOtp('Enter the one time code sent to your phone number.', S['login-challenge'].otp) });
        }
        const c = lc();
        if ((c.otp === undefined || c.otp == post.otp) && c.user_id == customer.id) {
          const challenge = newChallenge();
          S['login-challenge'] = { challenge: challenge.toString('base64'), user_id: customer.id, phone };
          ctx.session.touch();
          jsonExit({ actionRequired: 'newDevice', createArgs: getCreateArgs(String(customer.id), phone, customer.name, challenge) });
        }
        err('One time code entered is not valid.');
      } else if (post.deviceId !== 'other') {
        const dev: any = await db.selectOne('SELECT credential_id FROM user_devices WHERE id = ? AND user = ? AND credential_id IS NOT NULL', [parseInt(sanitize(post.deviceId, 'number'), 10), customer.id]);
        if (!dev) err('Device identifier mis-match. Try clearing your phone from this device.');
        credentialIds.push(Buffer.from(dev.credential_id, 'base64'));
      }

      const challenge = newChallenge();
      S['login-challenge'] = { user_id: customer.id, challenge: challenge.toString('base64') };
      ctx.session.touch();
      jsonExit(getGetArgs(credentialIds, challenge, external));
    }

    if (post.action === 'verifyLogin') {
      try {
        const pk = JSON.parse(post.publicKeyCredential);
        const credentialId = sanitize(pk.id);
        const c = lc();
        const device: any = await db.selectOne('SELECT id, credential_public_key FROM user_devices WHERE user = ? AND credential_id = ?', [c.user_id, credentialId]);
        if (!device) throw new Error('Login failed. Try again or use another device');
        processGet(Buffer.from(pk.clientDataJSON, 'base64'), Buffer.from(pk.authenticatorData, 'base64'), Buffer.from(pk.signature, 'base64'), device.credential_public_key, Buffer.from(c.challenge, 'base64'));
        account.id = c.user_id;
        await account.login();
        delete S['login-challenge'];
        jsonExit({ phone: S.user.phone, deviceId: device.id, redirect: loginRedirectURL(ctx) });
      } catch (e: any) {
        if (isExit(e)) throw e;
        err(e.message);
      }
    }

    if (post.action === 'verifyNewDevice') {
      try {
        const pk = JSON.parse(post.publicKeyCredential);
        const c = lc();
        const data = await processCreate(Buffer.from(pk.clientDataJSON, 'base64'), Buffer.from(pk.attestationObject, 'base64'), Buffer.from(c.challenge, 'base64'));
        account.id = c.user_id;
        await account.login();
        await db.update('user_devices', { credential_id: data.credentialId.toString('base64'), credential_public_key: data.credentialPublicKey }, 'id = ?', [S.user.device.id]);
        delete S['login-challenge'];
        jsonExit({ phone: S.user.phone, deviceId: S.user.device.id, redirect: loginRedirectURL(ctx) });
      } catch (e: any) {
        if (isExit(e)) throw e;
        err(e.message);
      }
    }

    if (post.action === 'resendOTP') {
      const c = lc();
      if (c.otp && c.phone) {
        account.phone = c.phone;
        await account.sendOTP(c.otp_type ?? 'login', c.otp);
      }
    }
    return exit(new Response('', { status: 200 }));
  }

  delete S['login-challenge'];

  return {
    metaTitle: `Login at ${env.SITE_NAME}`,
    metaDescription: '',
    pageTitle: 'Login',
    content: `<header>
	<div class="container center">
		<h1 class="page-title">Login</h1>
	</div>
</header>
<section>
	<div class="container">
		<div class="row center-aligned">
			<div class="col xs12 s6 m5 l4">
				<div id="global-msg-cont"></div>
				<form method="post" class="card" id="fido-form" data-type="login">
					<div class="content">
						<div class="center">
							<p class="mt1 neutral-color-4">Enter your phone number to login</p>
						</div>
						<ul class="chips" id="remembered-logins"></ul>
		    		<div class="input-field mt1">
		    			<input type="tel" name="phone" class="start-focus" required>
		    			<label>Phone</label>
		    		</div>
		    		<div class="otp-field hide">
							<label>Enter one time code sent to your phone</label>
							<input type="number" name="otp" hidden>
							<div class="inputs">
								<input type="number">
								<input type="number">
								<input type="number">
								<input type="number">
							</div>
							<span class="helper"><button type="button" class="btn text small" id="resend-otp" disabled>Resend</button></span>
						</div>
						<p id="signin-backup" class="hide">Having trouble? <a href="#">Sign in with OTP</a></p>
						<input type="text" name="recaptcha-token" hidden>
					</div>
					<div class="action">
						<button type="submit" class="btn filled">Login</button>
					</div>
				</form>
			</div>
		</div>
	</div>
</section>`,
    js: `${env.PASSKEYS ? '' : `<script>try{sessionStorage.setItem('useBackupSignin','1')}catch(e){}</script>`}<script src="js/login.min.js?v=${env.VERSION}"></script>`,
  };
}
