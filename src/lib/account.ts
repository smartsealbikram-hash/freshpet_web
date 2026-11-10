import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Ctx, exit, json } from './ctx';
import { env } from './env';
import { staffPermissions } from './config';
import { date, time, strtotime } from './php';
import { generatePassword, sendWhatsapp, sendmail } from './functions';

/** Port of GStone\Account (login/session/device handling). */
export function deviceInfo(ua: string) {
  const device: Record<string, any> = {
    model: 'Unknown', os: 'Unknown', os_version: 'Unknown', browser: 'Unknown', browser_version: 'Unknown', version_fingerprint: 0,
  };
  if (!ua) return device;

  const browserList: [string, RegExp][] = [
    ['Firefox', /(?:firefox|fxios)\/(.+?)(?:\s|$)/i],
    ['Opera', /(?:opr|opios)\/(.+?)(?:\s|$)/i],
    ['Samsung', /samsungbrowser\/(.+?)(?:\s|$)/i],
    ['Edge', /(?:edg\/|edga\/|edgw\/|edgios\/)(.+?)(?:\s|$)/i],
    ['Chrome', /(?:chrome|crios)\/(.+?)(?:\s|$)/i],
    ['Safari', /version\/(.+?)\s.*safari/i],
  ];
  for (const [name, re] of browserList) {
    let m = ua.match(re);
    if (!m && name === 'Safari') m = ua.match(/safari/i);
    if (m) {
      device.browser = name;
      if (m[1]) device.browser_version = m[1];
      break;
    }
  }
  const osList: [string, RegExp][] = [
    ['Xbox', /xbox/i],
    ['Windows', /windows nt/i],
    ['Android', /android (.+?)[;|)]/i],
    ['Linux', /linux/i],
    ['Mac OS', /macintosh; Intel Mac OS X (.+?)[)|;]/i],
    ['iOS', /(?:ipad|iphone); CPU(?: iphone)? OS (.+?)\s/i],
    ['Chrome OS', /cros \w+ (.+?)\)/i],
  ];
  for (const [name, re] of osList) {
    const m = ua.match(re);
    if (m) {
      device.os = name;
      if (m[1]) device.os_version = m[1].replace(/_/g, '.');
      break;
    }
  }
  if ((device.os === 'iOS' || device.os === 'Mac OS') && device.browser === 'Unknown' && ua.includes('AppleWebKit')) device.browser = 'Safari';
  if (device.os === 'Android') {
    const m = ua.match(/linux; android.+?; (.+?)(?:\sbuild|\))/i);
    if (m && m[1]) device.model = m[1];
  }
  if (device.os_version !== 'Unknown') device.version_fingerprint += parseFloat(device.os_version) || 0;
  if (device.browser_version !== 'Unknown') device.version_fingerprint += parseFloat(device.browser_version) || 0;
  return device;
}

const mac = (s: string) => createHmac('sha256', env.SECRET_KEY).update(s).digest('hex');

export class Account {
  id: number | null = null;
  phone?: string;
  email?: string;

  constructor(private ctx: Ctx) {}

  /** Resolve the session user or the "remember me" cookie. */
  async isLoggedIn(): Promise<boolean> {
    const { ctx } = this;
    if (this.id) return true;
    if (ctx.S.user) {
      this.id = ctx.S.user.id;
      if (time() - (strtotime(ctx.S.user.device?.last_login) || 0) > 86400) await this.updateLastLogin();
      return true;
    }
    const cookie = ctx.cookies['session_remember'];
    if (cookie) {
      const parts = cookie.split(':');
      if (parts.length < 4) return false;
      const [user, device, token, m] = parts;
      const expected = mac(`${user}:${device}:${token}`);
      if (m.length === expected.length && timingSafeEqual(Buffer.from(m), Buffer.from(expected))) {
        const deviceId = parseInt(device, 10) || 0;
        const row: any = await ctx.db.selectOne('SELECT token FROM user_devices WHERE id = ?', [deviceId]);
        if (row && row.token && row.token.length === token.length && timingSafeEqual(Buffer.from(row.token), Buffer.from(token))) {
          this.id = parseInt(user, 10);
          await this.login();
          return true;
        }
      }
    }
    return false;
  }

  async login(remember = true) {
    const { ctx } = this;
    const db = ctx.db;
    const u: any = await db.selectOne(
      'SELECT u.id, location, access_level, role, sr.department, u.name, phone, settings FROM users u LEFT JOIN staff_roles sr ON u.role = sr.id WHERE u.id = ?',
      [this.id]
    );
    ctx.S.user = u;
    try { ctx.S.user.settings = u.settings ? JSON.parse(u.settings) : {}; } catch { ctx.S.user.settings = {}; }
    if (Array.isArray(ctx.S.user.settings)) ctx.S.user.settings = {};
    delete ctx.S.theme;
    delete ctx.S.themeDefault;

    await this.updateLastLogin();

    if (ctx.S.user.access_level >= 4) {
      let perm: any = await db.selectOne('SELECT * FROM permissions WHERE user = ?', [this.id]);
      if (!perm) perm = await db.selectOne('SELECT * FROM permissions WHERE id = ?', [ctx.S.user.access_level]);
      ctx.S.user.permissions = perm;
      ctx.S.user.settings.sidenav_state ??= [];
      ctx.S.user.settings.table_width ??= [];
    } else if (ctx.S.user.access_level == 3) {
      const rows = await db.selectAll('SELECT type, access, limited FROM staff_permissions WHERE role = ?', [ctx.S.user.role]);
      const perms: Record<string, any> = {};
      for (const r of rows) perms[r.type] = { access: r.access, limited: r.limited };
      for (const list of Object.values(staffPermissions))
        for (const p of list) if (perms[p]?.access === undefined) perms[p] = { access: 0, limited: 1 };
      ctx.S.user.permissions = perms;
    }
    ctx.session.touch();

    if (remember) {
      const token = randomBytes(64).toString('hex');
      await db.update('user_devices', { token }, 'id = ?', [ctx.S.user.device.id]);
      let cookie = `${this.id}:${ctx.S.user.device.id}:${token}`;
      cookie += ':' + mac(cookie);
      ctx.setCookie('session_remember', cookie, { maxAge: 60 * 60 * 24 * 60, path: '/', sameSite: 'lax', httpOnly: true, secure: env.SITE_URL.startsWith('https') });
    }
  }

  private async updateLastLogin() {
    const device: any = await this.getCurrentDevice(true);
    this.ctx.S.user.device = { id: device.id, tag: device.tag, last_login: this.ctx.now, last_activity: time() };
    this.ctx.session.touch();
  }

  async getCurrentDevice(update = false) {
    const { ctx } = this;
    const db = ctx.db;
    const info = deviceInfo(ctx.ua);
    const desc = `${info.browser}, ${info.os}`;
    const deviceId = info.model !== 'Unknown' ? `${info.model} ${info.browser}` : null;

    let device: any;
    if (deviceId) device = await db.selectOne('SELECT id, tag FROM user_devices WHERE user = ? AND device_id = ?', [this.id, deviceId]);
    else
      device = await db.selectOne(
        'SELECT id, tag FROM user_devices WHERE user = ? AND description = ? AND version_fingerprint BETWEEN ? AND ?',
        [this.id, desc, info.version_fingerprint - 1, info.version_fingerprint]
      );
    const data: Record<string, any> = { ip: ctx.ip, last_login: ctx.now };
    if (device) {
      if (update) {
        if (!deviceId) data.version_fingerprint = info.version_fingerprint;
        await db.update('user_devices', data, 'id = ?', [device.id]);
      }
      return device;
    }
    Object.assign(data, { user: this.id, description: desc, date_added: ctx.now, user_agent: ctx.ua });
    if (deviceId) data.device_id = deviceId;
    else data.version_fingerprint = info.version_fingerprint;
    const id = await db.insert('user_devices', data);
    return { id, tag: null };
  }

  async sendOTP(type: string, otp: string | null = null): Promise<string> {
    if (!otp) otp = generatePassword(false, 4);
    if (env.PRODUCTION) await sendWhatsapp(this.phone!, 'app_login_otp', [otp]);
    else {
      // Development: no WhatsApp/SMTP — print the OTP in the server console.
      console.log(`[OTP:${type}] phone=${this.phone} code=${otp}`);
      if (this.email) await sendmail(this.email, 'One time code to login', { text: `<h1 class="center">${otp}</h1>` });
    }
    return otp;
  }

  async checkCommSettings(comm: number) {
    const none = { email_enabled: 0, sms_enabled: 0, push_enabled: 0 };
    const s: any = await this.ctx.db.selectOne('SELECT email_enabled, sms_enabled, push_enabled FROM comm_settings WHERE user = ? AND comm = ?', [this.id, comm]);
    if (!s) return none;
    if (s.push_enabled) {
      const devices = await this.ctx.db.selectAll('SELECT tag FROM user_devices WHERE user = ? AND tag IS NOT NULL', [this.id]);
      s.push_devices = devices.map((d: any) => d.tag);
      if (!s.push_devices.length) s.push_enabled = 0;
    }
    return s;
  }

  /** Redirects to login. Mirrors Account::logout(): JSON 401 for AJAX/SPA, 302 otherwise. */
  logout(): never {
    const { ctx } = this;
    if (ctx.isSpa || ctx.method !== 'GET') {
      exit(json({ message: { type: 'snackbar', content: 'You have been logged out. Please login again.' }, redirect: `${env.SITE_URL}/login?logout=1` }, 401));
    }
    ctx.flash('snackbar', 'You have been logged out. Please login again.');
    exit(new Response(null, { status: 302, headers: { location: `${env.SITE_URL}/login?logout=1` } }));
  }
}

export { date };
