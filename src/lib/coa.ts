import fs from 'fs/promises';
import path from 'path';
import { Ctx } from './ctx';
import { esc } from './html';
import { sentenceCase } from './functions';
import { getFile } from './storage';
import { number_format } from './php';

const rnd = () => Math.random();

/** Signature stored as a relative path (img/signatures/<id>.png) or a data URI; return something a PDF can embed. */
export async function signatureSrc(sig: string | null | undefined) {
  if (!sig) return '';
  if (sig.startsWith('data:')) return sig;
  try {
    const buf = await getFile(sig);
    if (!buf) return '';
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch { return ''; }
}

/** Certificate of Analysis (shared by dispatch.php's download and the quality_out checkpoint). */
export async function coaHtml(ctx: Ctx, dispatch: any, product: any, signature: string | null | undefined): Promise<string> {
  const rows = await ctx.db.selectAll('SELECT * FROM product_parameters WHERE product = ?', [product.item_name]);
  const s = ctx.settings;
  let i = 1;
  let body = '';
  if (dispatch.coa_extra_params) {
    body += `<tr><td>1</td><td>Appearance</td><td>Should be free from all visual defects</td><td>-</td><td>OK</td></tr><tr><td>2</td><td>Resin material</td><td>PET resin conforming to IS 12252:2017</td><td>-</td><td>OK</td></tr>`;
    i = 3;
  }
  for (const r of rows) {
    let obs: any = '';
    const v = Number(r.value);
    if (r.operator === '=') obs = esc(r.value);
    else if (r.operator === '<') obs = number_format(rnd() * v, 2);
    else if (r.operator === '>') obs = v + rnd() * (v * 0.5);
    else if (r.operator === '↔') {
      const [a, b] = String(r.value).split(',').map(Number);
      obs = Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.floor(a * 100 + rnd() * (b * 100 - a * 100 + 1)) / 100 : `<span style="color:red">${esc(r.value)}</span>`;
    }
    body += `<tr><td>${i}</td><td>${esc(sentenceCase(r.parameter))}</td><td>${esc(r.display_value)}</td><td>${esc(r.unit)}</td><td>${obs}</td></tr>`;
    i++;
  }
  const sig = await signatureSrc(signature);
  const logo = `img/logo/${s.logo_light}`;
  return `<!DOCTYPE html><html lang="en"><head><title></title><meta charset="utf-8"><style type="text/css">
@page{ margin: 1cm; } *{ box-sizing: border-box; } body{ font-family: 'DejaVu Sans', sans-serif; font-size: 12px; } .center{ text-align: center; }
table{ border: 1px solid; border-collapse: collapse; } table th, table td{ padding: 2px 4px; border: 1px solid #595f64; }</style></head><body>
<div class="center"><img src="${esc(logo)}" style="width: 8rem"><h2 style="margin:0">${esc(s.address)}</h2></div>
<table><tbody>
<tr><td>Preform Weight and Neck Type</td><td>${esc(product.weight)}GM</td><td>Document No</td><td>COA/${esc(product.invoice_num)}</td></tr>
<tr><td rowspan="4">Customer Name &amp; Plant Location</td><td rowspan="4">${esc(dispatch.client_name)}</td><td>Preform Inv. No.</td><td>${esc(product.invoice_num)} / ${esc(product.invoice_date)}</td></tr>
<tr><td>Date of Production</td><td>${esc(product.date_produced)}</td></tr><tr><td>Quantity per Box</td><td>${esc(product.box_size)}</td></tr><tr><td>No. of Boxes</td><td>${esc(product.quantity)}</td></tr>
<tr><td>No. of Cavities</td><td>${esc(product.cavities)}</td><td>Preform Batch No.</td><td>${esc(product.preform_batch)}</td></tr>
<tr><td>Resin Supplier Name</td><td>${esc(product.resin_supplier)}</td><td>Vehicle No.</td><td>${esc(dispatch.vehicle_number)}</td></tr>
<tr><td>Resin Grade</td><td>${esc(product.resin_grade)}</td><td>Resin Lot/Batch #</td><td>${esc(product.resin_batch)}</td></tr>
<tr><td colspan="4">This is to confirm that the preform contained in this shipment meet and conforms to all requirements as per ${esc(dispatch.client_name)} specifications.</td></tr></tbody></table>
<table style="width:100%"><thead><tr><th>Sr. No.</th><th>Parameters</th><th>Specifications</th><th>Unit</th><th>Observations</th></tr></thead><tbody>${body}</tbody></table>
${sig ? `<img src="${sig}" style="width: 200px;">` : ''}
<table style="border:0;width: 100%"><tr><td style="border:0;"><strong>Checked By</strong><br>Quality Executive</td><td style="border:0;text-align: right;"><strong>Company Seal &amp; Approved By</strong><br>Signature of QC In-charge</td></tr></table>
</body></html>`;
}
