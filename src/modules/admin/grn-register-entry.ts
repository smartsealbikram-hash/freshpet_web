import { Ctx, jsonExit } from '@/lib/ctx';
import { adminForm, textField } from '@/lib/adminForm';
import { compare, getFinancialYear, sanitize, toInt, uploadImage } from '@/lib/functions';
import { env } from '@/lib/env';
import { esc } from '@/lib/html';

const locSelect = async (c: Ctx, cur: any) => {
  const locs = await c.db.selectAll('SELECT * FROM locations');
  return `<div class="input-field sidelabel"><select name="location" required><option></option>${locs.map((l: any) => `<option value="${l.id}"${compare(l.id, cur ?? '', ' selected')}>${esc(l.name)}</option>`).join('')}</select><label>Location</label></div>`;
};
const photo = (name: string, label: string, src: any) => `<div class="file-input sidelabel">${src ? `<img src="${esc(src)}" class="upload-sideimage expandable">` : ''}<input type="file" name="${name}"><label>${label}</label><button type="button" class="btn outline small">Select File</button><span class="file-name">No file selected</span></div>`;
const upload = async (c: Ctx, p: any) => {
  for (const f of ['photo_in', 'photo_out']) {
    const file = c.files[f]?.[0];
    if (file && file.size) {
      const u = await uploadImage(c, [file], 'img/receiving-notes/', { maxSize: 500, tree: 2 });
      if (!u) { const m = c.S.msg?.content; delete c.S.msg; jsonExit({ error: m }); }
      else p[f] = '/' + u[0].path;
    }
  }
};
const nextId = async (c: Ctx, type: string, loc: number, codes: Record<number, string>) => {
  const y = getFinancialYear();
  const n = (await c.db.count('receiving_notes', "location = ? AND type = ? AND DATE(date_received) >= ? AND DATE(date_received) <= ?", [loc, type, `${y}-04-01`, `${y + 1}-03-31`])) + 1;
  return `${codes[loc]}/${String(n).padStart(3, '0')}`;
};
void env; void toInt; void textField;

export default (ctx: Ctx) => adminForm(ctx, {
  noun: 'entry', path: 'grn-register-entry', listPath: 'receiving-notes?t=grn', perm: 'receiving_notes', table: 'receiving_notes',
  titleNew: 'Add Entry', titleEdit: 'Edit GRN Entry', postKey: 'date_invoice', savedMsg: 'GRN Saved.',
  loadSql: 'SELECT * FROM receiving_notes WHERE id = ?',
  fields: async (r, c) => (await locSelect(c, r.location))
    + textField('date_invoice', 'Invoice Date', r.date_invoice, 'class="datepicker"') + textField('invoice_num', 'Invoice Number', r.invoice_num, 'maxlength="20"').replace('type="text"', 'type="tel"')
    + textField('po_num', 'P.O. Number', r.po_num, 'maxlength="10"') + textField('party_name', 'Party Name', r.party_name, 'maxlength="50"') + textField('product_name', 'Product Name', r.product_name, 'maxlength="50"')
    + `<div class="faux-sidelabel"><p class="label">Quantity</p><div class="inputs"><div class="row mb1"><div class="col xs8 input-field"><input type="number" name="quantity" value="${esc(r.quantity ?? '')}"></div><div class="input-field col xs4"><select name="unit"><option></option><option value="kgs"${compare('kgs', r.unit ?? null, ' selected')}>kgs</option><option value="pcs"${compare('pcs', r.unit ?? null, ' selected')}>pcs</option></select><label>Unit</label></div></div></div></div>`
    + `<div class="input-field sidelabel"><input type="number" step="0.01" name="rate" value="${esc(r.rate ?? '')}"><label>Rate</label></div><div class="input-field sidelabel"><input type="number" step="0.01" name="amount" value="${esc(r.amount ?? '')}"><label>Amount</label></div>`
    + photo('photo_in', 'Photo In', r.photo_in) + photo('photo_out', 'Photo Out', r.photo_out)
    + `<div class="card flat mb1"><div class="content"><h4>Delivered by</h4><div class="input-field"><input type="text" maxlength="50" name="delivered_by" value="${esc(r.delivered_by ?? '')}"><label>Name</label></div><div class="row"><div class="input-field col xs6"><input type="tel" maxlength="20" name="deliverer_phone" value="${esc(r.deliverer_phone ?? '')}"><label>Phone</label></div><div class="input-field col xs6"><input type="text" maxlength="10" name="vehicle_num" value="${esc(r.vehicle_num ?? '')}"><label>Vehicle Number</label></div></div></div></div>`,
  payload: async (p, c, row) => {
    const out: any = { location: toInt(p.location), date_invoice: sanitize(p.date_invoice), invoice_num: sanitize(p.invoice_num), po_num: sanitize(p.po_num), party_name: sanitize(p.party_name), product_name: sanitize(p.product_name), quantity: sanitize(p.quantity, 'number'), unit: sanitize(p.unit), rate: sanitize(p.rate, 'number'), amount: sanitize(p.amount, 'number'), delivered_by: sanitize(p.delivered_by), deliverer_phone: sanitize(p.deliverer_phone), vehicle_num: sanitize(p.vehicle_num) };
    await upload(c, out);
    if (row.id) { out.updated_by = c.S.user.id; out.date_updated = c.now; }
    else Object.assign(out, { type: 'grn', register_id: await nextId(c, 'grn', out.location, { 1: 'GRN', 2: 'GRNJ' }), received_by: c.S.user.id, date_received: c.now });
    return out;
  },
});
