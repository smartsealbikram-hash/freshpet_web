import { Ctx, exit } from '@/lib/ctx';
import { hasAccess, hasAccessToRow, pageToPermission, pageToTable, sanitize, toInt } from '@/lib/functions';

const txt = (s: string) => exit(new Response(s, { headers: { 'content-type': 'text/html; charset=utf-8' } }));

export default async function (ctx: Ctx) {
  const { db, post } = ctx;
  if (post.status === undefined) return undefined;
  let status = toInt(post.status);
  const id = toInt(post.id), type = sanitize(post.type);
  const perm = pageToPermission(type);
  if (hasAccess(ctx, 'edit', perm) && (await hasAccessToRow(ctx, id, perm))) {
    const table = pageToTable(type);
    if (!/^[a-z_]+$/.test(table)) return txt('An error occurred');
    if ((type === 'blog_posts' || type === 'products') && status === 2) status = 3;
    let ok = true;
    try { await db.update(table, { status }, 'id = ?', [id]); } catch { ok = false; }
    return txt(ok ? 'Status Updated' : 'An error occurred');
  }
  return txt('You do not have permission to update this record.');
}
