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
  noun: 'account', path: 'staff', listPath: 'staff-accounts', perm: 'staff', table: 'users',
  titleNew: 'Add Staff Account', titleEdit: 'Edit Staff Account', postKey: 'name', savedMsg: 'Account Saved.',
  fields: async (r, c) => {
    const locs = await c.db.selectAll('SELECT * FROM locations');
    const roles = await c.db.selectAll('SELECT sr.*, d.name as department FROM staff_roles sr LEFT JOIN departments d ON sr.department = d.id ORDER BY d.name, sr.name');
    return textField('name', 'Name', r.name, 'required') + textField('phone', 'Phone', r.phone, 'required').replace('type="text"', 'type="tel"')
      + `<div class="input-field sidelabel"><select name="location" required><option></option>${locs.map((l: any) => `<option value="${l.id}"${compare(r.location ?? '', l.id, ' selected')}>${esc(l.name)}</option>`).join('')}</select><label>Location</label></div>`
      + `<div class="input-field sidelabel"><select name="role" required><option></option>${roles.map((x: any) => `<option value="${x.id}"${compare(r.role ?? '', x.id, ' selected')}>${x.department !== null ? esc(x.department) + ' &gt; ' : ''}${esc(x.name)}</option>`).join('')}</select><label>Role</label></div>`
      + `<div class="input-field sidelabel"><select name="status" required><option></option><option value="2" ${compare(r.status ?? '', 2, 'selected')}>Active</option><option value="1" ${compare(r.status ?? '', 1, 'selected')}>Inactive</option></select><label>Status</label></div>`;
  },
  payload: async (p, c, row) => {
    const out: any = { name: sanitize(p.name), phone: sanitize(p.phone), role: toInt(p.role), location: toInt(p.location), status: toInt(p.status) };
    const dup: any = await c.db.selectOne('SELECT id FROM users WHERE phone = ? AND status > 0 AND id != ?', [out.phone, row.id ?? 0]);
    if (dup) throw new Error('The phone number you entered is already in use by another account. Please enter a new one.');
    if (!row.id) { out.access_level = 3; out.date_created = c.now; }
    return out;
  },
  outside: (r, c) => (r.id ? devicesCard(r, c, 'M d, Y h:i A') : ''),
  side: async (r, c) => {
    if (!r.id) return '';
    const accts = await c.db.selectAll('SELECT id, name FROM users WHERE access_level = 3 AND status = 2 ORDER BY name');
    return `<div class="col xs12 s8 m4"><form method="post" class="card ajax"><div class="content"><h4>Transfer assets to another account</h4><p>Clients assigned to ${esc(r.name)} will be transferred to selected account.</p>
		<div class="input-field"><select name="transfer" required><option></option>${accts.map((a: any) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select><label>Select Account</label></div><button type="submit" class="btn tonal">Transfer</button></div></form></div>`;
  },
  onPost: {
    keys: ['transfer'],
    run: async (c, id) => {
      let r: any;
      try { await c.db.update('clients', { sales_associate: sanitize(c.post.transfer) }, 'sales_associate = ?', [id]); r = { message: { type: 'alert', title: 'Transfer complete', content: 'Assets have been moved to selected account' } }; }
      catch (e: any) { r = { message: { type: 'error', content: e.message } }; }
      jsonExit(r);
    },
  },
});
