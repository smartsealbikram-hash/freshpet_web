import { Ctx, Page } from '@/lib/ctx';
import { date, time } from '@/lib/php';
import { esc } from '@/lib/html';
import { compare, sanitize } from '@/lib/functions';
import { P, V, halt } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'dispatch_reports') === 0) halt('You do not have access to this item.');
  let location: any, start: string, end: string;
  if (ctx.get.date !== undefined) { location = sanitize(ctx.get.location); [start, end] = String(ctx.get.date).split(' - '); }
  else { location = ctx.settings.location; start = date('Y-m-d', time() - 30 * 86400); end = ctx.today; }
  const locs = await db.selectAll('SELECT * FROM locations');
  const rows = await db.selectAll("SELECT date_of_dispatch, c.name as client_name, invoice_num, item_name, quantity, t.name as transporter_name, d.cost FROM dispatches d JOIN clients c ON d.party_name = c.id LEFT JOIN (SELECT dispatch, GROUP_CONCAT(invoice_num SEPARATOR '<br>') as invoice_num, GROUP_CONCAT(item_name SEPARATOR '<br>') as item_name, GROUP_CONCAT(quantity SEPARATOR '<br>') as quantity FROM dispatch_items GROUP BY dispatch) di ON d.id = di.dispatch JOIN transporters t ON d.transporter = t.id WHERE d.location = ? AND date_of_dispatch BETWEEN ? AND ? AND d.status = 2 ORDER BY date_of_dispatch", [location, start, end]);
  return {
    metaTitle: 'Transportation Report', pageTitle: 'Transportation Report', metaDescription: '',
    css: '<style type="text/css">#datatable td:nth-child(2), #datatable td:nth-child(4), #datatable td:nth-child(6){ min-width:15rem; }</style>',
    content: `<section><div class="container"><div id="global-msg-cont"></div>
	<form><div class="input-field inline mb1" id="locations"><span class="material-icons left-assist">location_on</span><select name="location">${locs.map((r: any) => `<option value="${r.id}"${compare(r.id, location, ' selected')}>${esc(r.name)}</option>`).join('')}</select><label>Location</label></div>
	<div class="input-field inline mb1"><input type="text" name="date" class="daterange-picker" value="${esc(start)} - ${esc(end)}" required><label>Date Range</label></div>
	<button type="submit" class="btn filled mb1">Show Report</button></form>
	<div class="card"><div class="content"><table id="datatable"><thead><tr><th>Date</th><th>Party Name</th><th>Invoice Num</th><th>Item Name</th><th colspan="2">Quantity</th><th>Transporter Name</th><th>Cost</th><th>Halting Charges</th><th>Total</th></tr></thead><tbody>
	${rows.map((r: any) => `<tr><td>${esc(r.date_of_dispatch)}</td><td>${esc(r.client_name)}</td><td>${r.invoice_num ?? ''}</td><td>${r.item_name ?? ''}</td><td>${r.quantity ?? ''}</td><td>${esc(r.transporter_name)}</td><td>₹${esc(r.cost)}</td><td></td><td>₹${esc(r.cost)}</td></tr>`).join('')}
	</tbody></table></div></div></div></section>`,
    js: `<script src="js/gs-datatable.min.js?v=${V}"></script>
<script type="module">
	import { initInputs, locationSwitcher, initAjaxForms } from './js/functions.mjs?v=${V}';
	initInputs(); locationSwitcher(); initAjaxForms();
	G('.daterange-picker').datepicker({ type: 'daterange', endDate: dayjs(), allowDateOutOfRange: true, showRangePresets: true });
	G('#datatable').dataTable();
</script>`,
  };
}
