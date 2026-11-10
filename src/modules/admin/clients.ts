import { Ctx } from '@/lib/ctx';
import { adminList, statusSwitch, editBtn, delBtn, OPTIONS_TH } from '@/lib/adminList';
import { hasAccess } from '@/lib/functions';
import { esc } from '@/lib/html';
import { date, strtotime, number_format } from '@/lib/php';
import { dispatchCategories, dispatchStatusLegend } from '@/lib/config';
void esc; void date; void strtotime; void number_format; void dispatchCategories; void dispatchStatusLegend; void statusSwitch; void editBtn; void delBtn;

export default async function (ctx: Ctx) {
  return adminList(ctx, {
    title: "Clients", path: "clients", view: "clients", sql: "SELECT c.id, c.status, c.name, u.name as sales_associate FROM clients c JOIN users u ON c.sales_associate = u.id WHERE c.status > 0", idCol: "c.id", addHref: "client",
    cols: [
      { label: 'ID', th: 'data-type="int" data-sort="desc"', cell: (r) => String(r.id) },
      { label: 'Name', cell: (r) => esc(r.name) },
      { label: 'Sales Associate', cell: (r) => esc(r.sales_associate) },
      { label: 'Active?', cell: (r, c) => statusSwitch(r, 'clients', !!hasAccess(c, 'edit', 'clients')), sort: (r) => r.status },
      { label: 'Options', th: OPTIONS_TH, cell: (r, c) => (hasAccess(c, 'edit', 'clients') ? editBtn(`client?id=${r.id}`, true) : '') + (hasAccess(c, 'delete', 'clients') ? delBtn('clients', r.id) : '') },
    ],
  });
}
