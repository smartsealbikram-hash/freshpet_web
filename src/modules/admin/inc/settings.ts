import { Ctx, exit } from '@/lib/ctx';
import { sanitize } from '@/lib/functions';

export default async function (ctx: Ctx) {
  const { db, post, S } = ctx;
  const u = S.user;
  u.settings ??= {};
  if (post.action === 'load-settings') {
    return exit(new Response(JSON.stringify({ sidenav: u.settings.sidenav_state?.[post.page] ?? 'open', tableWidth: u.settings.table_width?.[post.page] ?? 'normal' }), { headers: { 'content-type': 'application/json' } }));
  }
  if (post.theme !== undefined) {
    S.theme = sanitize(post.theme); S.themeDefault = 1;
    if (post.theme === 'light') u.settings.theme = 'light'; else if (post.theme === 'dark') u.settings.theme = 'dark';
    u.settings.theme_default = 1;
  }
  if (!Array.isArray(u.settings.sidenav_state) && typeof u.settings.sidenav_state !== 'object') u.settings.sidenav_state = {};
  if (post.sidenav !== undefined) { if (Array.isArray(u.settings.sidenav_state)) u.settings.sidenav_state = {}; u.settings.sidenav_state[post.page] = post.sidenav; }
  if (post.tableWidth !== undefined) { if (!u.settings.table_width || Array.isArray(u.settings.table_width)) u.settings.table_width = {}; u.settings.table_width[post.page] = post.tableWidth; }
  ctx.session.touch();
  await db.update('users', { settings: JSON.stringify(u.settings) }, 'id = ?', [u.id]);
  return undefined;
}
