import { Ctx } from '@/lib/ctx';
import { adminList, statusSwitch, editBtn, delBtn, OPTIONS_TH } from '@/lib/adminList';
import { hasAccess } from '@/lib/functions';
import { esc } from '@/lib/html';
import { date, strtotime, number_format } from '@/lib/php';
import { dispatchCategories, dispatchStatusLegend } from '@/lib/config';
void esc; void date; void strtotime; void number_format; void dispatchCategories; void dispatchStatusLegend; void statusSwitch; void editBtn; void delBtn;

export default async function (ctx: Ctx) {
  return adminList(ctx, {
    title: "Departments", path: "departments", view: "departments", sql: "SELECT * FROM departments WHERE status > 0", idCol: "id", addHref: "department",
    cols: [
      { label: 'Id&emsp;', th: 'data-type="int" data-sort="desc"', cell: (r) => String(r.id) },
      { label: 'Icon', cell: (r) => `<span class="material-icons">${esc(r.icon)}</span>` },
      { label: 'Name', cell: (r) => esc(r.name) },
      { label: 'Options', th: OPTIONS_TH, cell: (r, c) => (hasAccess(c, 'edit', 'departments') ? editBtn(`department?id=${r.id}`, true) : '') + (hasAccess(c, 'delete', 'departments') ? delBtn('departments', r.id) : '') },
    ],
  });
}
