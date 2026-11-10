import { Ctx } from '@/lib/ctx';
import { adminForm, textField, statusField } from '@/lib/adminForm';
import { compare, sanitize, toInt } from '@/lib/functions';
import { esc } from '@/lib/html';
import { date, strtotime } from '@/lib/php';
import { clearSettingsCache } from '@/lib/server';
void compare; void sanitize; void toInt; void esc; void date; void strtotime; void clearSettingsCache; void textField; void statusField;

export default (ctx: Ctx) => adminForm(ctx, {
  noun: 'department', path: 'department', listPath: 'departments', perm: 'departments', table: 'departments',
  titleNew: 'Create Department', titleEdit: 'Edit Department', postKey: 'name', savedMsg: 'Department Saved.',
  fields: (r) => textField('name', 'Department Name', r.name, 'required') + textField('icon', 'Icon', r.icon, 'required', 'Reference: <a href="https://fonts.google.com/icons" target="_blank">Material Symbols <span class="material-icons">open_in_new</span></a>'),
  payload: (p, c, row) => ({ name: sanitize(p.name), icon: sanitize(String(p.icon).replace(/ /g, '_').toLowerCase()), ...(row.id ? {} : { status: 2 }) }),
  after: async () => clearSettingsCache(),
});
