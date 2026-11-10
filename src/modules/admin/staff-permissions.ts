import { Ctx, Page, exit, jsonExit } from '@/lib/ctx';
import { staffPermissions } from '@/lib/config';
import { hasAccess, sanitize, toInt } from '@/lib/functions';
import { env } from '@/lib/env';
import { esc } from '@/lib/html';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S } = ctx;
  if (!hasAccess(ctx, 'view', 'admin_profiles')) {
    ctx.flash('error', 'You do not have access to that page.');
    return exit(new Response(null, { status: 302, headers: { location: S.current_page ?? env.SITE_URL + '/admin/' } }));
  }
  let title = 'Staff Permissions';
  S.current_page = `${env.SITE_URL}/admin/staff-permissions`;

  if (post.jobs !== undefined) {
    const id = toInt(ctx.get.id);
    let r: any = {};
    try {
      for (const [key, value] of Object.entries(post)) {
        if (key.includes('_limited')) continue;
        const type = sanitize(key), access = toInt(value);
        let limited = 1;
        if (access === 3) limited = 0; else if (post[key + '_limited'] !== undefined) limited = toInt(post[key + '_limited']);
        if (Number(value) === 0) await db.delete('staff_permissions', 'role = ? AND type = ?', [id, type]);
        else await db.run('INSERT INTO staff_permissions (role, type, access, limited) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE access = ?, limited = ?', [id, type, access, limited, access, limited]);
      }
    } catch (e: any) { r = { message: { type: 'warning', content: e.message } }; }
    return jsonExit(r);
  }
  if (ctx.get.id === undefined) return jsonExit({ redirect: 'staff-roles' });
  const id = toInt(ctx.get.id);
  const role: any = await db.selectOne('SELECT * FROM staff_roles WHERE id = ?', [id]);
  if (!role) jsonExit({ message: { type: 'error', content: 'No role found. Please select one from the list.' }, action: 'halt' });
  S.current_page += `?id=${id}`;
  title = `${role.name}'s Permissions`;
  const perms: Record<string, any> = {};
  for (const r of await db.selectAll('SELECT type, access, limited FROM staff_permissions WHERE role = ?', [id])) perms[r.type] = r;
  const nice = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  let body = '';
  for (const [group, list] of Object.entries(staffPermissions)) {
    body += `<h2>${group}</h2>`;
    for (const p of list) {
      const a = perms[p];
      const ck = (c: boolean) => (c ? ' checked' : '');
      body += `<div class="faux-sidelabel"><p class="label">${esc(nice(p))}</p><div class="inputs"><div class="input-field inline"><div class="segmented-control">
		<input type="radio" name="${p}" id="${p}_no" value="0"${ck(!a)} required><label for="${p}_no">No Access</label>
		<input type="radio" name="${p}" id="${p}_view" value="1"${ck(a?.access == 1)}><label for="${p}_view">View</label>
		<input type="radio" name="${p}" id="${p}_add" value="2"${ck(a?.access == 2)}><label for="${p}_add">Add</label>
		<input type="radio" name="${p}" id="${p}_approve" value="3"${ck(a?.access == 3)}><label for="${p}_approve">Approve</label></div></div>&emsp;
		<div class="input-field inline"><div class="segmented-control"><input type="radio" name="${p}_limited" id="${p}_lim" value="1"${ck(a?.limited == 1)}><label for="${p}_lim">Limited</label><input type="radio" name="${p}_limited" id="${p}_full" value="0"${ck(a?.limited == 0)}><label for="${p}_full">Full</label></div></div></div></div>`;
    }
  }
  return {
    metaTitle: title, pageTitle: title, metaDescription: '',
    content: `<section><div class="container"><h1 class="page-title">${esc(title)}</h1><div class="row"><div class="col xs12 xl10"><form method="post" class="card ajax"><div class="content">${body}</div>
	<div class="action">${hasAccess(ctx, 'edit', 'admin_profiles') ? '<button type="submit" class="btn filled">Save</button>' : ''}<p class="neutral-color-3 mt1"><small>* Limited access implies that the role can access items that were created by them only. What they can do with the items is still determined by access type granted. Approve role is always full access.</small></p></div></form></div></div></div></section>`,
    js: `<script type="module">import { initInputs, initAjaxForms } from '../js/functions.mjs'; initInputs(); initAjaxForms();</script>`,
  };
}
