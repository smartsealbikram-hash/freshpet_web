import { Ctx } from '@/lib/ctx';
import { adminList, statusSwitch, editBtn, delBtn, OPTIONS_TH } from '@/lib/adminList';
import { hasAccess } from '@/lib/functions';
import { esc } from '@/lib/html';
import { date, strtotime, number_format } from '@/lib/php';
import { dispatchCategories, dispatchStatusLegend } from '@/lib/config';
void esc; void date; void strtotime; void number_format; void dispatchCategories; void dispatchStatusLegend; void statusSwitch; void editBtn; void delBtn;

export default async function (ctx: Ctx) {
  return adminList(ctx, {
    title: "Transporters", path: "transporters", view: "transporters", sql: "SELECT * FROM transporters WHERE status > 0", idCol: "id", addHref: "transporter",
    cols: [
      { label: 'ID', th: 'data-type="int" data-sort="desc"', cell: (r) => String(r.id) },
      { label: 'Name', cell: (r) => esc(r.name) },
      { label: 'Active?', cell: (r, c) => statusSwitch(r, 'transporters', !!hasAccess(c, 'edit', 'transporters')), sort: (r) => r.status },
      { label: 'Options', th: OPTIONS_TH, cell: (r, c) => (hasAccess(c, 'edit', 'transporters') ? editBtn(`transporter?id=${r.id}`) : '') + (hasAccess(c, 'delete', 'transporters') ? delBtn('transporters', r.id) : '') },
    ],
  });
}
