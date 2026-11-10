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
  noun: 'product', path: 'product', listPath: 'products', perm: 'production', table: 'products',
  titleNew: 'Add Product', titleEdit: 'Edit Product', postKey: 'weight', savedMsg: 'Product Saved.',
  fields: (r) => `<div class="input-field sidelabel"><span class="right-assist">gms</span><input type="number" step="0.01" name="weight" value="${esc(r.weight ?? '')}" required><label>Weight</label></div>`
    + textField('type', 'Type', r.type, 'maxlength="10" required')
    + `<div class="input-field sidelabel"><input type="number" name="box_size" value="${esc(r.box_size ?? '')}" required><label>Box Size</label></div>`
    + `<div class="input-field sidelabel"><span class="right-assist">sec</span><input type="number" step="0.01" name="cycle_time" value="${esc(r.cycle_time ?? '')}" required><label>Cycle Time</label></div>`
    + `<div class="input-field sidelabel"><input type="number" name="cavities" value="${esc(r.cavities ?? '')}" required><label>Cavities</label></div>` + statusField(r.status),
  payload: (p) => ({ weight: sanitize(p.weight, 'number'), type: sanitize(p.type), box_size: sanitize(p.box_size, 'number'), cycle_time: sanitize(p.cycle_time, 'number'), cavities: sanitize(p.cavities, 'number'), status: toInt(p.status) }),
  onPost: {
    keys: ['save-params'],
    run: async (c, product) => {
      let r: any = {};
      try {
        for (let i = 0; i < productParameters.length; i++) {
          const v = c.post['value-' + i];
          if (v !== undefined && v !== '') {
            const p: any = { operator: sanitize(c.post['operator-' + i], 'html'), value: sanitize(v), unit: sanitize(c.post['unit-' + i]), display_value: sanitize(c.post['display_value-' + i]) };
            if (c.post['mpId-' + i] !== undefined) await c.db.update('product_parameters', p, 'id = ?', [toInt(c.post['mpId-' + i])]);
            else { p.product = product; p.parameter = snakeCase(productParameters[i]); await c.db.insert('product_parameters', p); }
          }
        }
        r.action = 'goback';
      } catch (e: any) { r.message = { type: 'warning', content: e.message }; }
      jsonExit(r);
    },
  },
  below: async (r, c) => {
    if (!r.id) return '';
    const mp: Record<string, any> = {};
    for (const x of await c.db.selectAll('SELECT * FROM product_parameters WHERE product = ?', [r.id])) mp[x.parameter] = x;
    const rows = productParameters.map((param, key) => {
      const m = mp[snakeCase(param)] ?? {};
      const opt = (v: string, label: string) => `<option value="${v}"${compare(v, m.operator ?? '', ' selected')}>${label}</option>`;
      return `${m.id ? `<input type="number" name="mpId-${key}" value="${m.id}" hidden>` : ''}<div class="row"><div class="col xs12 m4 l3"><p>${esc(param)}</p></div>
		<div class="col xs12 m6 l3 input-field"><input type="text" name="display_value-${key}" maxlength="100" value="${esc(m.display_value ?? '')}"><label>Display Value</label></div>
		<div class="col xs4 m2 offset-m4 offset-l0 input-field"><select name="operator-${key}"><option></option>${opt('NA', 'NA')}${opt('=', 'Equals')}${opt('<', 'Less than')}${opt('>', 'Greater than')}${opt('↔', 'Between')}</select><label>Operator</label></div>
		<div class="col xs5 m2 input-field"><input type="text" name="value-${key}" maxlength="20" value="${esc(m.value ?? '')}"><label>Value</label><span class="helper hide">Enter two mathematical values separated by comma</span></div>
		<div class="col xs3 m2 l2 input-field"><input type="text" name="unit-${key}" maxlength="5" value="${esc(m.unit ?? '')}"><label>Unit</label></div></div>`;
    }).join('');
    return `<h3 class="mt2">Product Parameters</h3><form method="post" class="card ajax"><div class="content">${rows}</div><div class="action"><button type="submit" class="btn tonal" name="save-params">Save</button><div id="global-msg-cont"></div></div></form>`;
  },
  js: `G('select').on('change', e => { const row = e.target.closest('.row'), input = row.querySelector('input[name^="value-"]'); if(!input) return; if(e.target.value == '↔') input.nextElementSibling.nextElementSibling.classList.remove('hide'); else input.nextElementSibling.nextElementSibling.classList.add('hide'); });`,
});
