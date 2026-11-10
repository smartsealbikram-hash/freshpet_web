import { Ctx } from '@/lib/ctx';
import { adminList, statusSwitch, editBtn, delBtn, OPTIONS_TH } from '@/lib/adminList';
import { hasAccess } from '@/lib/functions';
import { esc } from '@/lib/html';
import { date, strtotime, number_format } from '@/lib/php';
import { dispatchCategories, dispatchStatusLegend } from '@/lib/config';
void esc; void date; void strtotime; void number_format; void dispatchCategories; void dispatchStatusLegend; void statusSwitch; void editBtn; void delBtn;

export default async function (ctx: Ctx) {
  return adminList(ctx, {
    title: "Staff Roles", path: "staff-roles", view: "admin_profiles", sql: "SELECT sr.*, d.name as department FROM staff_roles sr LEFT JOIN departments d ON sr.department = d.id", idCol: "sr.id", addHref: "staff-role",
    cols: [
      { label: 'Id&emsp;', th: 'data-type="int" data-sort="desc"', cell: (r) => String(r.id) },
      { label: 'Department', cell: (r) => esc(r.department) },
      { label: 'Role', cell: (r) => esc(r.name) },
      { label: 'Options', th: OPTIONS_TH, cell: (r, c) => (hasAccess(c, 'edit', 'admin_profiles') ? editBtn(`staff-role?id=${r.id}`) + `<a href="staff-permissions?id=${r.id}" class="btn icon table-tooltip" title="Permissions"><span class="material-icons">lock_open</span></a>` : '') + (hasAccess(c, 'delete', 'admin_profiles') ? delBtn('staff_roles', r.id, "Make sure no staff account is using this role before deleting.") : '') },
    ],
  });
}
