import { Ctx, jsonExit } from '@/lib/ctx';
import { adminForm, textField, statusField } from '@/lib/adminForm';
import { compare, sanitize, snakeCase, toInt } from '@/lib/functions';
import { productParameters } from '@/lib/config';
import { esc } from '@/lib/html';
import { date, strtotime } from '@/lib/php';
void compare; void sanitize; void toInt; void esc; void date; void strtotime; void textField; void statusField; void snakeCase; void productParameters; void jsonExit;

const devicesCard = async (r: any, c: Ctx, fmt: string) => {
  const ds = await c.db.selectAll('SELECT * FROM user_devices WHERE user = ? ORDER BY last_login DESC', [r.id]);
  return `<div class="card mt2"><div class="content"><p class="mt0 text-uppercase"><strong>Devices</strong></p><table class="h-borders"><thead><tr><th>Description</th><th>IP</th><th>Last Login</th><th>First Seen</th></tr></thead><tbody>${ds.map((d: any) => `<tr><td>${esc(d.description)}</td><td>${esc(d.ip)}</td><td>${date(fmt, strtotime(d.last_login) as number)}</td><td>${date(fmt, strtotime(d.date_added) as number)}</td></tr>`).join('')}</tbody></table></div></div>`;
};
void devicesCard;

export default (ctx: Ctx) => adminForm(ctx, {
  noun: 'account', path: 'admin', listPath: 'admins', perm: 'admins', table: 'users',
  titleNew: 'Add Admin Account', titleEdit: 'Edit Admin Account', postKey: 'name', savedMsg: 'Account Saved.',
  fields: async (r, c) => {
    const profiles = await c.db.selectAll('SELECT id, name FROM permissions WHERE id >= 4 AND user IS NULL');
    return textField('name', 'Name', r.name, 'required') + textField('email', 'Email', r.email, 'required').replace('type="text"', 'type="email"') + textField('phone', 'Phone', r.phone).replace('type="text"', 'type="tel"')
      + `<div class="input-field sidelabel"><select name="access_level" required><option></option>${profiles.map((p: any) => `<option value="${p.id}" ${compare(r.access_level ?? '', p.id, 'selected')}>${esc(p.name)}</option>`).join('')}</select><label>Admin Profile</label></div>`
      + statusField(r.status)
      + (r.id ? '<div class="input-field sidelabel"><input type="checkbox" name="force_logout" id="force_logout"><label for="force_logout">Logout this admin</label></div>' : '');
  },
  payload: async (p, c, row) => {
    const out: any = { status: toInt(p.status), access_level: toInt(p.access_level), name: sanitize(p.name), email: sanitize(p.email, 'email'), phone: sanitize(p.phone) };
    const dup: any = await c.db.selectOne('SELECT id FROM users WHERE email = ? AND status > 0 AND id != ?', [out.email, row.id ?? 0]);
    if (dup) throw new Error('The email you entered is already in use by another account. Please enter a new one.');
    if (!row.id) out.date_created = c.now;
    return out;
  },
  after: async (id, c) => { if (c.post.force_logout !== undefined) await c.db.update('user_devices', { force_logout: 1 }, 'user = ?', [id]); },
  outside: (r, c) => (r.id ? devicesCard(r, c, 'd M Y h:i A') : ''),
});
