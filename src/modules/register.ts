import { Ctx, Page, exit } from '@/lib/ctx';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { noData, registerApprovalButtons, timeSince, toInt } from '@/lib/functions';
import { V, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (ctx.get.id === undefined) notFound();
  const id = toInt(ctx.get.id);
  let q = 'SELECT r.id, id_prefix, name, approvals_required, approving_staff_role, number_of_approvals_required FROM registers r JOIN register_access ra ON r.id = ra.register WHERE r.id = ? AND r.status = 2';
  const a: any[] = [id];
  if (S.user.department != 10) { q += ' AND ra.department = ?'; a.push(S.user.department); }
  const register: any = await db.selectOne(q, a);
  if (!register) notFound();
  const fields = await db.selectAll('SELECT group_number, show_priority, multiple, type, name, display_name FROM register_fields WHERE register = ? ORDER BY group_number', [id]);
  const legend: Record<string, any[]> = {};
  for (const f of fields) (legend[f.group_number] ??= []).push(f);

  if (post.action === 'entry-details') {
    const printField = (field: any, data: any, i?: number) => {
      const value = i === undefined ? data[field.name] : data[field.name][i];
      let out = `<dt>${esc(field.display_name)}</dt><dd>`;
      if (field.type === 'file') {
        const s = String(value);
        const loc = `img/registers/${id}/${s[0]}/${s[1]}/`;
        out += `<img src="${loc}${esc(s)}" class="expandable max1"> <button type="button" class="btn outline small expand-image">View</button>`;
      } else out += esc(value);
      return out + '</dd>';
    };
    const entry: any = await db.selectOne('SELECT sequence, data, date_added FROM register_data WHERE id = ? AND register = ?', [toInt(post.id), id]);
    let out = '';
    if (entry) {
      out += `<dl class="horizontal"><dt>ID</dt><dd>${esc(register.id_prefix)}${entry.sequence}</dd><dt>Added on</dt><dd>${date('M d, Y h:i A', strtotime(entry.date_added) as number)}</dd></dl>`;
      const data = JSON.parse(entry.data);
      for (const group of Object.values(legend)) {
        out += '<div class="card flat mb1"><div class="content"><dl class="horizontal">';
        if (group[0].multiple) {
          const n = Array.isArray(data[group[0].name]) ? data[group[0].name].length : 0;
          for (let i = 0; i < n; i++) {
            for (const f of group) if (data[f.name] && data[f.name][i] !== undefined) out += printField(f, data, i);
            out += '</dl><hr><dl class="horizontal">';
          }
        } else for (const f of group) if (data[f.name] !== undefined) out += printField(f, data);
        out += '</dl></div></div>';
      }
    }
    return exit(new Response(out, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  }

  let lq = 'SELECT * FROM register_data WHERE register = ?';
  const la: any[] = [id];
  if (register.approving_staff_role != S.user.role && S.user.department != 10) { lq += ' AND added_by = ?'; la.push(S.user.id); }
  lq += ' ORDER BY id DESC LIMIT 100';
  const rows = await db.selectAll(lq, la);
  let body: string;
  if (rows.length) {
    body = '<table class="h-borders edged"><tbody>';
    for (const r of rows) {
      const data = JSON.parse(r.data);
      let i = 0, summary = '';
      for (const group of Object.values(legend))
        for (const f of group)
          if (f.show_priority) {
            if (i >= 2) break;
            if (data[f.name] !== undefined) { summary += `${esc(f.display_name)}: ${esc(data[f.name])}<br>`; i++; }
          }
      body += `<tr data-id="${r.id}"><td>${esc(register.id_prefix)}${r.sequence}</td><td>${summary}</td><td>${timeSince(r.date_added)}</td>${register.approvals_required ? `<td>${registerApprovalButtons(ctx, register, r)}</td>` : ''}</tr>`;
    }
    body += '</tbody></table>';
  } else body = noData(register.name);

  return {
    metaTitle: register.name, pageTitle: register.name, metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>
<div class="fab-cont"><a href="register-entry?r=${id}" class="fab extended"><span class="material-icons left-icon">add</span> Add Entry</a></div>
<div class="sheets wide"><div class="head">Entry Details</div><div class="body"></div></div>`,
    js: `<script type="module">
	import { setupSheet } from './js/functions.mjs?v=${V}';
	G('table tr').on('click', e => {
		const tr = e.target.closest('tr');
		const sheet = setupSheet('Entry Details', 'wide');
		G.ajax({ type: 'POST', data: { action: 'entry-details', id: tr.dataset.id } }).then(data => {
			sheet.body.innerHTML = data.responseText;
			G(sheet.body.querySelectorAll('.expandable')).on('click', e => { G(e.target).expandableImg(); });
			G('.expand-image').on('click', e => { e.target.previousElementSibling.click(); });
		}).catch(xhr => { console.log('Failed', xhr); G.snackbar('An error occurred.'); sheet.sheet.sheets('close'); });
	});
	G('.register-approve').on('click', e => {
		const btn = e.target.closest('button');
		G.dialog({
			title: 'Confirm entry',
			description: '<p class="center"><button type="submit" class="btn error-bg waves" data-action="deny"><span class="material-icons">thumb_down</span> Deny</button><button type="submit" class="btn success-bg waves" data-action="approve"><span class="material-icons">thumb_up</span> Approve</button></p>',
			dismissiveAction: { text: 'Cancel' },
			onLoad: dl => {
				G(dl.querySelectorAll('.body button')).on('click', e => {
					const actionBtn = e.target.closest('button');
					G.dialog('close');
					btn.innerHTML = '<span class="spinner"></span>';
					G.ajax({ url: 'inc/register-approve', type: 'POST', data: { entry: btn.dataset.id, action: actionBtn.dataset.action } }).then(data => {
						btn.closest('td').innerHTML = data.responseText;
					}).catch(xhr => { console.log('Failed', xhr); btn.innerHTML = '<span class="material-icons">thumbs_up_down</span>'; G.snackbar('An error occurred.'); });
				}, {once: true});
			}
		});
	});
</script>`,
  };
}
