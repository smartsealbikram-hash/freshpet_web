import { Ctx } from '@/lib/ctx';
import { adminList, statusSwitch, editBtn, delBtn, OPTIONS_TH } from '@/lib/adminList';
import { hasAccess } from '@/lib/functions';
import { esc } from '@/lib/html';
import { date, strtotime, number_format } from '@/lib/php';
import { dispatchCategories, dispatchStatusLegend } from '@/lib/config';
void esc; void date; void strtotime; void number_format; void dispatchCategories; void dispatchStatusLegend; void statusSwitch; void editBtn; void delBtn;

export default async function (ctx: Ctx) {
  return adminList(ctx, {
    title: "Maintenance Tasks", path: "maintenance-tasks", view: "production", sql: "SELECT * FROM maintenance_tasks", idCol: "id", addHref: "maintenance-task",
    cols: [
      { label: 'ID', th: 'data-type="int" data-sort="desc"', cell: (r) => String(r.id) },
      { label: 'Name', cell: (r) => esc(r.name) },
      { label: 'Frequency', cell: (r) => esc(r.frequency) + ' Days' },
      { label: 'Active', cell: (r, c) => statusSwitch(r, 'maintenance_tasks', !!hasAccess(c, 'edit', 'production')), sort: (r) => r.status },
      { label: 'Options', th: OPTIONS_TH, cell: (r, c) => (hasAccess(c, 'edit', 'production') ? editBtn(`maintenance-task?id=${r.id}`) : '') + (hasAccess(c, 'delete', 'production') ? delBtn('maintenance_tasks', r.id, "If the maintenance task was completed before, avoid deleting it. Instead you can turn it off with the status toggle.") : '') },
    ],
  });
}
