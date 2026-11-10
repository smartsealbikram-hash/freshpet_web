import { Ctx } from '@/lib/ctx';
import { adminForm, textField, statusField } from '@/lib/adminForm';
import { compare, sanitize, toInt } from '@/lib/functions';
import { esc } from '@/lib/html';
import { date, strtotime } from '@/lib/php';
import { clearSettingsCache } from '@/lib/server';
void compare; void sanitize; void toInt; void esc; void date; void strtotime; void clearSettingsCache; void textField; void statusField;

export default (ctx: Ctx) => adminForm(ctx, {
  noun: 'transporter', path: 'transporter', listPath: 'transporters', perm: 'transporters', table: 'transporters',
  titleNew: 'Create Transporter', titleEdit: 'Edit Transporter', postKey: 'name', savedMsg: 'transporter Saved.',
  fields: (r) => textField('name', 'Name', r.name, 'required') + statusField(r.status),
  payload: (p) => ({ status: toInt(p.status), name: sanitize(p.name) }),
});
