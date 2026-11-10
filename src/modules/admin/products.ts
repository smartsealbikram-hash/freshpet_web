import { Ctx } from '@/lib/ctx';
import { adminList, statusSwitch, editBtn, delBtn, OPTIONS_TH } from '@/lib/adminList';
import { hasAccess } from '@/lib/functions';
import { esc } from '@/lib/html';
import { date, strtotime, number_format } from '@/lib/php';
import { dispatchCategories, dispatchStatusLegend } from '@/lib/config';
void esc; void date; void strtotime; void number_format; void dispatchCategories; void dispatchStatusLegend; void statusSwitch; void editBtn; void delBtn;

export default async function (ctx: Ctx) {
  return adminList(ctx, {
    title: "Products", path: "products", view: "production", sql: "SELECT * FROM products WHERE status > 0", idCol: "id", addHref: "product",
    cols: [
      { label: 'ID', th: 'data-type="int" data-sort="desc"', cell: (r) => String(r.id) },
      { label: 'Weight', th: 'data-type="int"', cell: (r) => esc(r.weight) + 'gms' },
      { label: 'Type', cell: (r) => esc(r.type) },
      { label: 'Box Size', cell: (r) => esc(r.box_size) },
      { label: 'Cavities', cell: (r) => esc(r.cavities) },
      { label: 'Cycle Time', cell: (r) => esc(r.cycle_time) + 's' },
      { label: 'Active?', th: 'data-type="int"', cell: (r, c) => statusSwitch(r, 'products', !!hasAccess(c, 'edit', 'production')), sort: (r) => r.status },
      { label: 'Options', th: OPTIONS_TH, cell: (r, c) => (hasAccess(c, 'edit', 'production') ? editBtn(`product?id=${r.id}`) : '') + (hasAccess(c, 'delete', 'production') ? delBtn('products', r.id) : '') },
    ],
  });
}
