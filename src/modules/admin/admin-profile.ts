import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { hasAccess, hasAccessToRow, sanitize, toInt } from '@/lib/functions';
import { env } from '@/lib/env';
import { esc } from '@/lib/html';
import { noAccess } from '@/lib/adminList';

const DEF = '[0,0,0,0,"0-*"]';
const halt = (m: string) => jsonExit({ message: { type: 'error', content: m }, action: 'halt' });

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, get } = ctx;
  if (!hasAccess(ctx, 'view', 'admin_profiles')) noAccess();
  let pathName = '/admin/admin-profile', title = 'Add Admin Profile';
  S.current_page = env.SITE_URL + pathName;
  const columns = (await db.selectAll('SHOW columns FROM permissions')).map((r: any) => r.Field).filter((f: string) => !['id', 'user', 'name'].includes(f));

  if (post.name !== undefined) {
    if (post.reset !== undefined) {
      let r: any;
      try { await db.delete('permissions', 'user = ?', [toInt(get.user)]); r = { message: { type: 'snackbar', content: "Permissions reset to admin profile's permissions" }, action: 'refresh' }; }
      catch (e: any) { r = { message: { type: 'warning', content: e.message } }; }
      return jsonExit(r);
    }
    const perms: Record<string, any> = {};
    for (const key of columns) {
      const t: any[] = [post['view-' + key] !== undefined ? 1 : 0, post['edit-' + key] !== undefined ? 1 : 0, post['add-' + key] !== undefined ? 1 : 0, post['delete-' + key] !== undefined ? 1 : 0];
      const rowT = String(post['rows-' + key] ?? '');
      if (!rowT.includes('-') || rowT.split('-').some((n) => n !== '*' && !/^\d+$/.test(n)))
        return jsonExit({ error: `Invalid row access format for ${key}. Please read the notes below.` });
      t.push(rowT);
      perms[key] = JSON.stringify(t);
    }
    perms.name = sanitize(post.name);
    let response: any = {};
    try {
      let id = 0, adminId = 0;
      if (get.id !== undefined && hasAccess(ctx, 'edit', 'admin_profiles')) { id = toInt(get.id); await db.update('permissions', perms, 'id = ?', [id]); }
      else if (get.user !== undefined && hasAccess(ctx, 'edit', 'admins')) {
        adminId = toInt(get.user);
        if (await db.selectOne('SELECT id FROM permissions WHERE user = ?', [adminId])) await db.update('permissions', perms, 'user = ?', [adminId]);
        else { perms.user = adminId; await db.insert('permissions', perms); }
      } else if (get.id === undefined && get.user === undefined && hasAccess(ctx, 'add', 'admin_profiles')) await db.insert('permissions', perms);
      else throw new Error('You do not have permission for this operation');
      if (get.id !== undefined) await db.run('UPDATE user_devices ud JOIN users u ON ud.user = u.id SET force_logout = 1 WHERE access_level = ?', [id]);
      else if (get.user !== undefined) await db.update('user_devices', { force_logout: 1 }, 'user = ?', [adminId]);
      if (get.id === undefined) {
        if (post.another !== undefined) response = { message: { type: 'snackbar', content: 'Profile Saved.' }, action: 'refresh' };
        else response.action = 'goback';
      }
    } catch (e: any) { response = { message: { type: 'warning', content: e.message } }; }
    return jsonExit(response);
  }

  let permissions: any = null, name = '';
  if (get.id !== undefined || get.user !== undefined) {
    let id: any;
    if (get.id !== undefined) {
      id = toInt(get.id);
      if (!(await hasAccessToRow(ctx, id, 'admin_profiles'))) halt('You are not authorized to access this record.');
      pathName += `?id=${id}`;
    } else {
      const adminId = toInt(get.user);
      if (!(await hasAccessToRow(ctx, adminId, 'admins'))) halt('You are not authorized to access this record.');
      const p: any = await db.selectOne('SELECT id FROM permissions WHERE user = ?', [adminId]);
      if (p) id = p.id;
      else { const u: any = await db.selectOne('SELECT access_level FROM users WHERE id = ?', [adminId]); if (!u) halt('No profile found. Please select one from the list.'); id = u.access_level; }
      pathName += `?user=${adminId}`;
    }
    permissions = await db.selectOne('SELECT * FROM permissions WHERE id = ?', [id]);
    if (!permissions) halt('No profile found. Please select one from the list.');
    name = permissions.name; delete permissions.id; delete permissions.user; delete permissions.name;
    title = 'Edit Admin Profile';
    S.current_page = env.SITE_URL + pathName;
  }
  const keys = permissions ? Object.keys(permissions) : columns;
  const cb = (n: string, checked: boolean) => `<td><div class="input-field no-margin"><input type="checkbox" name="${n}" id="${n}"${checked ? ' checked' : ''}><label for="${n}">&nbsp;</label></div></td>`;
  const checkAll = (id: string) => `<td><div class="input-field no-margin"><input type="checkbox" id="${id}"><label for="${id}">&nbsp;</label></div></td>`;
  const rows = keys.map((key) => {
    let v: any = permissions ? permissions[key] : DEF;
    if (/^\d+$/.test(String(v))) v = DEF;
    try { v = JSON.parse(v); } catch { v = JSON.parse(DEF); }
    if (!Array.isArray(v)) v = JSON.parse(DEF);
    return `<tr><td>${esc(key.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()))}</td>${cb('all-' + key, false)}${cb('view-' + key, v[0] == 1)}${cb('edit-' + key, v[1] == 1)}${cb('add-' + key, v[2] == 1)}${cb('delete-' + key, v[3] == 1)}<td><div class="input-field no-margin"><input type="text" name="rows-${key}" class="width100 nomargin" value="${esc(v[4])}"></div></td></tr>`;
  }).join('');
  const canSave = hasAccess(ctx, 'edit', 'admin_profiles') || hasAccess(ctx, 'add', 'admin_profiles');
  return {
    metaTitle: title, pageTitle: title, metaDescription: '', nav: { refLink: `${env.SITE_URL}/admin/admin-profiles` },
    content: `<section><div class="container"><h1 class="page-title">${esc(title)}</h1><div id="global-msg-cont"></div><div class="row"><div class="col xs12 m10 l9">
	<form method="post" class="card ajax"><div class="content"><div class="input-field"><input type="text" name="name" value="${esc(name)}" required><label>Designation/Profile Name</label></div><p>Permissions</p>
	<div class="responsive-table"><table><thead><tr><th>Page Name</th><th>All</th><th>View</th><th>Edit</th><th>Add</th><th>Delete</th><th>Rows</th></tr></thead><tbody>
	<tr><td class="grey-text">Check All</td>${checkAll('checkAll')}${checkAll('checkAllView')}${checkAll('checkAllEdit')}${checkAll('checkAllAdd')}${checkAll('checkAllDelete')}<td></td></tr>${rows}</tbody></table></div></div>
	${canSave ? `<div class="action"><button type="submit" name="save-permissions" class="btn filled">Save</button>${get.user !== undefined ? '<button type="submit" name="reset" class="btn tonal">Reset to Profile</button>' : get.id === undefined ? '<button type="submit" class="btn outline" name="another">Save and Add Another</button>' : ''}</div>` : ''}</form>
	<div class="card mt2"><div class="content"><h3><strong>Row wise access</strong></h3><ul class="default"><li>Enter From and To row IDs separated by a dash, eg. 500-1000</li><li>To give access to all rows after a particular ID, use asterisk, eg. 500-*</li><li>To give access upto a row ID, use 0-1000</li><li>To give access to latest n records, use asterisk, eg. *-500 (latest 500 records)</li><li>Row IDs need not exist to be valid. You might enter 0-2000 while you have 1000 rows. The user will get access to all rows upto 2000.</li><li>Row IDs are not same as row number/sequence number. Row Ids are usually the first column in the table</li></ul></div></div>
	</div></div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms } from '../js/functions.mjs';
	initInputs(); initAjaxForms();
	const bind = (id, sel) => G(document.getElementById(id)).on('click', function(){ const c = this.checked; G(sel).each(function(){ this.checked = c; }); });
	bind('checkAll', 'input[type="checkbox"]'); bind('checkAllView', 'input[name^="view"]'); bind('checkAllEdit', 'input[name^="edit"]'); bind('checkAllAdd', 'input[name^="add"]'); bind('checkAllDelete', 'input[name^="delete"]');
	G(document.querySelectorAll('input[name^="all-"]')).on('click', function(){ const c = this.checked, row = this.closest('tr'); G(row.querySelectorAll('input[type="checkbox"]')).each(function(){ this.checked = c; }); });
</script>`,
  };
}
