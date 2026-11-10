import { Ctx } from '@/lib/ctx';
import { adminList, statusSwitch, editBtn, delBtn, OPTIONS_TH } from '@/lib/adminList';
import { hasAccess } from '@/lib/functions';
import { esc } from '@/lib/html';
import { date, strtotime, number_format } from '@/lib/php';
import { dispatchCategories, dispatchStatusLegend } from '@/lib/config';
void esc; void date; void strtotime; void number_format; void dispatchCategories; void dispatchStatusLegend; void statusSwitch; void editBtn; void delBtn;

export default async function (ctx: Ctx) {
  return adminList(ctx, {
    title: "Staff Accounts", path: "staff-accounts", view: "staff", sql: "SELECT u.id, u.status, u.name, phone, date_created, d.name as department, r.name as role FROM users u LEFT JOIN staff_roles r ON u.role = r.id LEFT JOIN departments d ON r.department = d.id WHERE u.status > 0 AND access_level = 3", idCol: "u.id", addHref: "staff",
    cols: [
      { label: 'Id', th: 'data-type="int" data-sort="desc"', cell: (r) => String(r.id) },
      { label: 'Department', cell: (r) => esc(r.department) },
      { label: 'Role', cell: (r) => esc(r.role) },
      { label: 'Name', cell: (r) => esc(r.name) },
      { label: 'Contact', cell: (r) => esc(r.phone) },
      { label: 'Signed up on', th: 'data-type="int"', cell: (r) => date('M d, Y h:i A', strtotime(r.date_created) as number), sort: (r) => strtotime(r.date_created) as number },
      { label: 'Active?', th: 'data-type="int"', cell: (r, c) => statusSwitch(r, 'staff', !!hasAccess(c, 'edit', 'staff')), sort: (r) => r.status },
      { label: 'Options', th: OPTIONS_TH, cell: (r, c) => (hasAccess(c, 'edit', 'staff') ? editBtn(`staff?id=${r.id}`) : '') },
    ],
  });
}
