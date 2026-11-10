import { Ctx, jsonExit } from '@/lib/ctx';
import { hasAccess, hasAccessToRow, pageToPermission, pageToTable, sanitize, toInt } from '@/lib/functions';

export default async function (ctx: Ctx) {
  const { db, post, S, now } = ctx;
  let response: any = {};
  if (post.type !== undefined && post.id !== undefined) {
    const type = sanitize(post.type), id = toInt(post.id);
    try {
      if (type === 'user_devices') await db.delete('user_devices', 'id = ? AND user = ?', [id, S.user.id]);
      else {
        const perm = pageToPermission(type);
        if (hasAccess(ctx, 'delete', perm) && (await hasAccessToRow(ctx, id, perm))) {
          const table = pageToTable(type);
          if (!/^[a-z_]+$/.test(table)) throw new Error('Invalid record type');
          const col = await db.selectOne(`SHOW COLUMNS FROM ${table} LIKE 'date_deleted'`);
          if (col) await db.update(table, { status: 0, date_deleted: now, deleted_by: S.user.id }, 'id = ?', [id]);
          else await db.delete(table, 'id = ?', [id]);
        } else throw new Error('You do not have permission to update this record.');
      }
      console.log(`Record of type ${type}, ID ${id} deleted by ${S.user.id}`);
      response = { message: { type: 'snackbar', content: 'Record Deleted' }, action: 'refresh' };
    } catch (e: any) { response = { message: { type: 'warning', content: e.message } }; }
  }
  return jsonExit(response);
}
