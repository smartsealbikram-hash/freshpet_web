import { Ctx } from '@/lib/ctx';
import { adminList, statusSwitch, editBtn, delBtn, OPTIONS_TH } from '@/lib/adminList';
import { hasAccess } from '@/lib/functions';
import { esc } from '@/lib/html';
import { date, strtotime, number_format } from '@/lib/php';
import { dispatchCategories, dispatchStatusLegend } from '@/lib/config';
void esc; void date; void strtotime; void number_format; void dispatchCategories; void dispatchStatusLegend; void statusSwitch; void editBtn; void delBtn;

export default async function (ctx: Ctx) {
  return adminList(ctx, {
    title: "Vehicles", path: "vehicles", view: "vehicles", sql: "SELECT v.*, u.name as updated_by FROM vehicles v LEFT JOIN users u ON v.updated_by = u.id", idCol: "v.id", addHref: "vehicle",
    cols: [
      { label: 'ID', th: 'data-type="int" data-sort="desc"', cell: (r) => String(r.id) },
      { label: 'Name', cell: (r) => esc(r.name) },
      { label: 'Registration Number', cell: (r) => esc(r.registration_number) },
      { label: 'Odometer', cell: (r) => number_format(r.odometer_reading) },
      { label: 'Last Updated', cell: (r) => (r.date_updated ? date('d M Y h:i A', strtotime(r.date_updated) as number) : '') + '<br>' + esc(r.updated_by ?? ''), sort: (r) => (r.date_updated ? (strtotime(r.date_updated) as number) : 0) },
      { label: 'Options', th: OPTIONS_TH, cell: (r, c) => (hasAccess(c, 'edit', 'vehicles') ? editBtn(`vehicle?id=${r.id}`) : '') + (hasAccess(c, 'delete', 'vehicles') ? delBtn('vehicles', r.id) : '') },
    ],
  });
}
