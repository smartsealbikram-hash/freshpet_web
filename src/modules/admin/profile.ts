import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { deviceInfo } from '@/lib/account';
import { sanitize, toInt } from '@/lib/functions';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S } = ctx;
  const userId = S.user.id;
  const title = S.user.name;

  if (post.profile !== undefined) {
    let r: any = {};
    const p: any = { name: sanitize(post.name), phone: sanitize(post.phone) };
    S.user.settings ??= {};
    const theme = sanitize(post.theme_toggle);
    if (theme === 'default') S.user.settings.theme_default = 1;
    else if (theme === 'light' || theme === 'dark') { S.user.settings.theme = theme; S.user.settings.theme_default = 0; }
    p.settings = JSON.stringify(S.user.settings);
    try {
      await db.update('users', p, 'id = ?', [userId]);
      r.message = { type: 'snackbar', content: 'Details Saved' };
      S.user.name = p.name; S.user.phone = p.phone; delete S.theme;
      ctx.session.touch();
    } catch (e: any) { r.message = { type: 'warning', content: e.message }; }
    return jsonExit(r);
  }
  if (ctx.get['delete-device'] !== undefined) {
    let r: any = {};
    try { await db.delete('user_devices', 'id = ? AND user = ?', [toInt(ctx.get['delete-device']), userId]); r.message = { type: 'snackbar', content: 'Device Deleted' }; }
    catch (e: any) { r.message = { type: 'warning', content: e.message }; }
    return jsonExit(r);
  }
  const admin: any = await db.selectOne('SELECT name, email, phone FROM users WHERE id = ?', [userId]);
  const info = deviceInfo(ctx.ua);
  const desc = `${info.browser}, ${info.os}`;
  const devId = info.model !== 'Unknown' ? `${info.model} ${info.browser}` : null;
  const devices = await db.selectAll('SELECT * FROM user_devices WHERE user = ? ORDER BY last_login DESC', [userId]);
  const rows = devices.map((r: any) => {
    const current = r.tag === null && ((devId && devId == r.device_id) || (!devId && desc == r.description && info.version_fingerprint >= r.version_fingerprint && info.version_fingerprint < Number(r.version_fingerprint) + 1));
    return `<tr><td>${esc(r.description)}</td><td>${esc(r.ip)}</td><td>${date('d M Y h:i A', strtotime(r.last_login) as number)}</td><td>${date('d M Y h:i A', strtotime(r.date_added) as number)}</td><td>${current ? '<button type="button" class="btn icon small" id="enable-notification"><span class="material-icons">notifications</span></button>' : ''}<button type="button" class="btn icon small delete" data-type="user_devices" data-id="${r.id}" data-msg="This device will be logged out and deleted and will not receive any notifications."><span class="material-icons">delete</span></button></td></tr>`;
  }).join('');
  const def = S.themeDefault, th = S.theme;
  return {
    metaTitle: title, pageTitle: title, metaDescription: '',
    content: `<section><div class="container"><h1 class="page-title">${esc(title)}</h1><div id="global-msg-cont"></div><div class="row">
	<div class="col xs12 l4"><div class="row"><div class="col xs12 s6 l12"><form method="post" class="card ajax"><div class="content">
		<div class="input-field"><input type="text" name="name" value="${esc(admin.name)}" required><label>Name</label></div>
		<div class="input-field"><input type="email" name="email" value="${esc(admin.email)}" readonly><label>Email</label></div>
		<div class="input-field"><input type="tel" name="phone" value="${esc(admin.phone)}"><label>Phone</label></div>
		<div class="input-field"><select name="theme_toggle"><option></option><option value="default"${def ? ' selected' : ''}>System Default</option><option value="light"${!def && th === 'light' ? ' selected' : ''}>Light</option><option value="dark"${!def && th === 'dark' ? ' selected' : ''}>Dark</option></select><label for="theme_toggle">Theme</label><span class="helper">You might have to reload a few times for change to take effect</span></div>
	</div><div class="action"><button type="submit" name="profile" class="btn filled">Save</button></div></form></div></div></div>
	<div class="col xs12 l8"><div class="card"><div class="content"><p class="mt0 text-uppercase"><strong>Devices</strong></p><div class="responsive-table"><table class="h-borders"><thead><tr><th>Description</th><th>IP</th><th>Last Login</th><th>First Seen</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div></div></div>
	</div></div></section>`,
    js: `<script src="../js/firebase.mjs" type="module"></script>
<script type="module">import { initInputs, initAjaxForms } from '../js/functions.mjs'; initInputs(); initAjaxForms();</script>`,
  };
}
