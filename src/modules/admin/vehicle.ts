import { Ctx } from '@/lib/ctx';
import { adminForm, textField, statusField } from '@/lib/adminForm';
import { compare, sanitize, toInt } from '@/lib/functions';
import { esc } from '@/lib/html';
import { date, strtotime } from '@/lib/php';
import { clearSettingsCache } from '@/lib/server';
void compare; void sanitize; void toInt; void esc; void date; void strtotime; void clearSettingsCache; void textField; void statusField;

export default (ctx: Ctx) => adminForm(ctx, {
  noun: 'vehicle', path: 'vehicle', listPath: 'vehicles', perm: 'vehicles', table: 'vehicles',
  titleNew: 'Add Vehicle', titleEdit: 'Edit Vehicle', postKey: 'name', savedMsg: 'Account Saved.',
  loadSql: 'SELECT v.*, u.name as updated_by FROM vehicles v LEFT JOIN users u ON v.updated_by = u.id WHERE v.id = ?',
  fields: (r) => textField('name', 'Name', r.name, 'required', 'Use an identifiable name for this vehicle. Example: White Activa') + textField('registration_number', 'Registration Number', r.registration_number, 'required') + textField('odometer_reading', 'Odometer Reading', r.odometer_reading, 'required')
    + (r.date_updated ? `<div class="faux-sidelabel"><p class="label">Last Updated</p><div class="inputs">${date('d M Y h:i A', strtotime(r.date_updated) as number)} (${esc(r.updated_by)})</div></div>` : ''),
  payload: (p, c) => ({ name: sanitize(p.name), registration_number: sanitize(p.registration_number), odometer_reading: sanitize(p.odometer_reading), date_updated: c.now, updated_by: c.S.user.id }),
});
