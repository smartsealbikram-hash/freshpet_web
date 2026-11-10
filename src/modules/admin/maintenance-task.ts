import { Ctx } from '@/lib/ctx';
import { adminForm, textField, statusField } from '@/lib/adminForm';
import { compare, sanitize, toInt } from '@/lib/functions';
import { esc } from '@/lib/html';
import { date, strtotime } from '@/lib/php';
import { clearSettingsCache } from '@/lib/server';
void compare; void sanitize; void toInt; void esc; void date; void strtotime; void clearSettingsCache; void textField; void statusField;

export default (ctx: Ctx) => adminForm(ctx, {
  noun: 'task', path: 'maintenance-task', listPath: 'maintenance-tasks', perm: 'production', table: 'maintenance_tasks',
  titleNew: 'Add Maintenance Task', titleEdit: 'Edit Maintenance Task', postKey: 'name', savedMsg: 'Task Saved.',
  loadSql: 'SELECT * FROM maintenance_tasks WHERE id = ?',
  fields: (r) => textField('name', 'Name', r.name, 'required')
    + `<div class="input-field sidelabel"><span class="right-assist">days</span><input type="number" name="frequency" value="${esc(r.frequency ?? '')}" required><label>Frequency</label></div>`
    + `<div class="input-field sidelabel"><select name="status" required><option></option><option value="2" ${compare(r.status ?? '', 2, 'selected')}>Active</option><option value="1" ${compare(r.status ?? '', 1, 'selected')}>Inactive</option></select><label>Status</label></div>`,
  payload: (p) => ({ status: toInt(p.status), name: sanitize(p.name), frequency: toInt(p.frequency) }),
});
