import { Ctx } from '@/lib/ctx';
import { adminForm, textField, statusField } from '@/lib/adminForm';
import { compare, sanitize, toInt } from '@/lib/functions';
import { esc } from '@/lib/html';
import { date, strtotime } from '@/lib/php';
import { clearSettingsCache } from '@/lib/server';
void compare; void sanitize; void toInt; void esc; void date; void strtotime; void clearSettingsCache; void textField; void statusField;

export default (ctx: Ctx) => adminForm(ctx, {
  noun: 'staff role', path: 'staff-role', listPath: 'staff-roles', perm: 'admin_profiles', table: 'staff_roles',
  titleNew: 'Add Staff Role', titleEdit: 'Edit Staff Role', postKey: 'name', savedMsg: 'Role Saved.',
  loadSql: 'SELECT * FROM staff_roles WHERE id = ?',
  fields: async (r, c) => {
    const ds = await c.db.selectAll('SELECT id, name FROM departments WHERE status = 2');
    return `<div class="input-field"><select name="department" required><option></option>${ds.map((d: any) => `<option value="${d.id}"${compare(d.id, r.department ?? '', ' selected')}>${esc(d.name)}</option>`).join('')}</select><label>Department</label></div>`
      + `<div class="input-field"><input type="text" name="name" value="${esc(r.name ?? '')}" required><label>Role Name</label></div>`;
  },
  payload: (p) => ({ department: toInt(p.department), name: sanitize(p.name) }),
});
