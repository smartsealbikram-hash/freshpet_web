import { Ctx } from '@/lib/ctx';
import { adminForm, textField, statusField } from '@/lib/adminForm';
import { compare, sanitize, toInt } from '@/lib/functions';
import { esc } from '@/lib/html';
import { date, strtotime } from '@/lib/php';
import { clearSettingsCache } from '@/lib/server';
void compare; void sanitize; void toInt; void esc; void date; void strtotime; void clearSettingsCache; void textField; void statusField;

export default (ctx: Ctx) => adminForm(ctx, {
  noun: 'machine', path: 'machine', listPath: 'machines', perm: 'production', table: 'machines',
  titleNew: 'Add Machine', titleEdit: 'Edit Machine', postKey: 'name', savedMsg: 'Machine Saved.',
  fields: (r) => textField('name', 'Name', r.name, 'required') + textField('id_prefix', 'ID Prefix', r.id_prefix, 'required'),
  payload: (p, c, row) => ({ name: sanitize(p.name), id_prefix: sanitize(p.id_prefix), ...(row.id ? {} : { status: 2 }) }),
  extra: async (r, c) => {
    if (!r.id) return '';
    const params = await c.db.selectAll('SELECT mp.id, p.id as product_id, weight, type FROM products p LEFT JOIN (SELECT id, product FROM machine_parameters WHERE machine = ? GROUP BY product) mp ON mp.product = p.id WHERE p.status = 2', [r.id]);
    return `<hr><h4 class="text-uppercase">Product Parameters</h4><ul class="list compact right-assist">${params.map((x: any) => `<li><div class="content">${esc(x.weight)}gms ${esc(x.type)}<br><small class="error-color">${x.id === null ? 'Not added' : ''}</small></div><div class="right-assist"><a href="machine-parameters?m=${r.id}&p=${x.product_id}" class="btn outline small">View Parameters</a></div></li>`).join('')}</ul>`;
  },
});
