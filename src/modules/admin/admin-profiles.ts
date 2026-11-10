import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { adminList, delBtn, editBtn, noAccess, OPTIONS_TH } from '@/lib/adminList';
import { hasAccess, toInt } from '@/lib/functions';
import { esc } from '@/lib/html';

export default async function (ctx: Ctx): Promise<Page> {
  if (!hasAccess(ctx, 'view', 'admin_profiles')) noAccess();
  if (ctx.post.action !== undefined) {
    if (ctx.post.action === 'duplicate' && hasAccess(ctx, 'add', 'admin_profiles')) {
      let r: any;
      try {
        const p: any = await ctx.db.selectOne('SELECT * FROM permissions WHERE id = ?', [toInt(ctx.post.id)]);
        if (!p) throw new Error('Failed to load profile.');
        delete p.id;
        await ctx.db.insert('permissions', p);
        r = { message: { type: 'snackbar', content: 'Profile duplicated' }, action: 'refresh' };
      } catch (e: any) { r = { message: { type: 'warning', content: e.message } }; }
      return jsonExit(r);
    }
    return jsonExit({});
  }
  return adminList(ctx, {
    title: 'Admin Profiles', path: 'admin-profiles', view: 'admin_profiles', sql: 'SELECT id, name FROM permissions WHERE (user IS NULL OR user = 0)', idCol: 'id', addHref: 'admin-profile', colClass: 'col xs12 s10 m8 l6',
    cols: [
      { label: 'ID&emsp;', th: 'data-type="int" data-sort="desc"', cell: (r) => String(r.id) },
      { label: 'Profile Name', cell: (r) => esc(r.name) },
      { label: 'Options', th: OPTIONS_TH, cell: (r, c) => r.id >= 4 ? (hasAccess(c, 'edit', 'admin_profiles') ? editBtn(`admin-profile?id=${r.id}`, true) : '') + (hasAccess(c, 'add', 'admin_profiles') ? `<button type="button" class="btn icon small table-tooltip duplicate" title="Duplicate" data-pid="${r.id}"><span class="material-icons">content_copy</span></button>` : '') + (hasAccess(c, 'delete', 'admin_profiles') ? delBtn('admin_profiles', r.id).replace('btn icon delete', 'btn icon small delete') : '') : '' },
    ],
    js: `<script>
	document.getElementById('datatable').addEventListener('click', e => {
		if(e.target.closest('.duplicate')){
			const btn = e.target.closest('.duplicate'); btn.disabled = true;
			G.ajax({ type: 'POST', data: { action: 'duplicate', id: btn.dataset.pid } }).then(data => { const response = JSON.parse(data.responseText); handleAjaxResponse(response); }).catch(xhr => { console.log('Failed', xhr); G.snackbar('An error occurred.'); }).finally(() => btn.disabled = false);
		}
	});
</script>`,
  });
}
