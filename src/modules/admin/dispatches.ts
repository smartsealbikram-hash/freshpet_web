import { Ctx } from '@/lib/ctx';
import { adminList, statusSwitch, editBtn, delBtn, OPTIONS_TH } from '@/lib/adminList';
import { hasAccess } from '@/lib/functions';
import { esc } from '@/lib/html';
import { date, strtotime, number_format } from '@/lib/php';
import { dispatchCategories, dispatchStatusLegend } from '@/lib/config';
void esc; void date; void strtotime; void number_format; void dispatchCategories; void dispatchStatusLegend; void statusSwitch; void editBtn; void delBtn;

export default async function (ctx: Ctx) {
  return adminList(ctx, {
    title: "Dispatches", path: "dispatches", view: "dispatches", sql: "SELECT d.*, c.name as client_name, t.name as transporter_name FROM dispatches d LEFT JOIN clients c ON d.party_name = c.id LEFT JOIN transporters t ON d.transporter = t.id", idCol: "d.id", addHref: "dispatch",
    cols: [
      { label: 'Id', th: 'data-type="int" data-sort="desc"', cell: (r) => String(r.id) },
      { label: 'Category', cell: (r) => dispatchCategories[r.category] },
      { label: 'Dispatch Date', th: 'data-type="int"', cell: (r) => date('M d, Y', strtotime(r.date_of_dispatch) as number), sort: (r) => strtotime(r.date_of_dispatch) as number },
      { label: 'Party', cell: (r) => r.client_name ? esc(r.client_name) : `<span class="error-color">${esc(r.party_name)} (${esc(r.destination)})</span>` },
      { label: 'Transporter', cell: (r) => r.transporter_name ? esc(r.transporter_name) : `<span class="error-color">${esc(r.transporter)}</span>` },
      { label: 'Status', cell: (r) => dispatchStatusLegend[r.status] },
      { label: 'Date Created', th: 'data-type="int"', cell: (r) => date('M d, Y h:i A', strtotime(r.date_created) as number), sort: (r) => strtotime(r.date_created) as number },
      { label: 'Options', th: OPTIONS_TH, cell: (r, c) => (hasAccess(c, 'edit', 'dispatches') ? editBtn(`dispatch?id=${r.id}`) : '') + (hasAccess(c, 'delete', 'dispatches') ? delBtn('dispatches', r.id) : '') },
    ],
  });
}
