import { Ctx } from '@/lib/ctx';
import { adminList, statusSwitch, editBtn, delBtn, OPTIONS_TH } from '@/lib/adminList';
import { hasAccess } from '@/lib/functions';
import { esc } from '@/lib/html';
import { date, strtotime, number_format } from '@/lib/php';
import { dispatchCategories, dispatchStatusLegend } from '@/lib/config';
void esc; void date; void strtotime; void number_format; void dispatchCategories; void dispatchStatusLegend; void statusSwitch; void editBtn; void delBtn;

export default async function (ctx: Ctx) {
  return adminList(ctx, {
    title: "Admin Accounts", path: "admins", view: "admins", sql: "SELECT users.id, status, users.name, phone, email, date_created, up.name as profile FROM users LEFT JOIN permissions up ON users.access_level = up.id WHERE status > 0 AND access_level >= 4", idCol: "users.id", addHref: "admin",
    cols: [
      { label: 'Id', th: 'data-type="int" data-sort="desc"', cell: (r) => String(r.id) },
      { label: 'Name', cell: (r) => esc(r.name) },
      { label: 'Contact', cell: (r) => esc(r.email) + '<br>' + esc(r.phone) },
      { label: 'Access Level', cell: (r) => esc(r.profile) },
      { label: 'Signed up on', cell: (r) => date('d M Y h:i A', strtotime(r.date_created) as number), sort: (r) => strtotime(r.date_created) as number },
      { label: 'Active?', cell: (r, c) => statusSwitch(r, 'admins', !!hasAccess(c, 'edit', 'admins')), sort: (r) => r.status },
      { label: 'Options', th: OPTIONS_TH, cell: (r, c) => (hasAccess(c, 'edit', 'admins') ? editBtn(`admin?id=${r.id}`) + `<a href="admin-profile?user=${r.id}" title="Manage Permissions" class="btn icon small table-tooltip"><span class="material-icons">lock_open</span></a>` : '') },
    ],
  });
}
