import { Ctx } from '@/lib/ctx';
import { adminForm, textField, statusField } from '@/lib/adminForm';
import { compare, sanitize, toInt } from '@/lib/functions';
import { esc } from '@/lib/html';
import { date, strtotime } from '@/lib/php';
import { clearSettingsCache } from '@/lib/server';
void compare; void sanitize; void toInt; void esc; void date; void strtotime; void clearSettingsCache; void textField; void statusField;

export default (ctx: Ctx) => adminForm(ctx, {
  noun: 'client', path: 'client', listPath: 'clients', perm: 'clients', table: 'clients',
  titleNew: 'Create Client', titleEdit: 'Edit Client', postKey: 'name', savedMsg: 'Client Saved.',
  fields: async (r, c) => {
    const sales = await c.db.selectAll('SELECT u.id, u.name FROM users u JOIN staff_roles sr ON u.role = sr.id WHERE u.status = 2 AND sr.department = 9 ORDER BY u.name');
    let h = textField('name', 'Name', r.name, 'required');
    if (!r.id) h += textField('location', 'Location', '', 'required');
    h += `<div class="input-field sidelabel"><select name="sales_associate" required><option></option>${sales.map((s: any) => `<option value="${s.id}" ${compare(r.sales_associate ?? '', s.id, 'selected')}>${esc(s.name)}</option>`).join('')}</select><label>Sales Associate</label></div>`;
    h += `<div class="input-field switch"><input type="checkbox" name="coa_extra_params" id="coa_extra_params"${r.coa_extra_params ? ' checked' : ''}><label for="coa_extra_params">Enable additional parameters in COA</label></div>`;
    return h + statusField(r.status);
  },
  extra: async (r, c) => {
    if (!r.id) return '';
    const ts = await c.db.selectAll('SELECT t.id, t.name, truck_19, truck_32_mtxl, other FROM transporters t LEFT JOIN transport_cost tc ON tc.client = ? AND tc.transporter = t.id WHERE t.status = 2', [r.id]);
    if (!ts.length) return '';
    const cell = (id: any, size: number, v: any) => `<td><div class="input-field no-margin"><span class="left-assist">₹</span><input type="number" name="trans-${id}-${size}" value="${esc(v ?? '')}"></div></td>`;
    return `<h4 class="mt3">Transporters Cost</h4><table><thead><tr><th></th><th>19ft</th><th>32ft</th><th>Other</th></tr></thead><tbody>${ts.map((t: any) => `<tr><td>${esc(t.name)}</td>${cell(t.id, 19, t.truck_19)}${cell(t.id, 32, t.truck_32_mtxl)}${cell(t.id, 0, t.other)}</tr>`).join('')}</tbody></table>`;
  },
  payload: (p) => ({ status: toInt(p.status), name: sanitize(p.name) + (p.location !== undefined ? ', ' + sanitize(p.location) : ''), sales_associate: sanitize(p.sales_associate), coa_extra_params: p.coa_extra_params !== undefined ? 1 : 0 }),
  after: async (id, c) => {
    const costs: Record<string, Record<string, any>> = {};
    for (const [k, v] of Object.entries(c.post)) if (k.includes('trans-')) { const [, t, s] = k.split('-'); (costs[t] ??= {})[s] = v; }
    for (const [t, vehicles] of Object.entries(costs)) {
      const row: any = { client: id, transporter: t, date_updated: c.now, updated_by: c.userId };
      for (const [size, v] of Object.entries(vehicles)) row[size === '19' ? 'truck_19' : size === '32' ? 'truck_32_mtxl' : 'other'] = v === '' || v === null ? null : sanitize(v);
      const n = await c.db.update('transport_cost', row, 'client = ? AND transporter = ?', [id, t]);
      if (!n) await c.db.insert('transport_cost', row);
    }
  },
});
