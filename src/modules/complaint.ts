import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { complaintStatusLegend } from '@/lib/config';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { notifyForApproval, sanitize, sendNotification, toInt } from '@/lib/functions';
import { Account } from '@/lib/account';
import { P, SITE_URL, V, halt, msgWarn, nl2br, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'complaint_tickets') === 0) halt('You do not have access to this item.');

  let pageTitle = 'Add Complaint';
  let id = 0;
  let complaint: any;
  if (ctx.get.id !== undefined) {
    id = toInt(ctx.get.id);
    complaint = await db.selectOne('SELECT c.*, u.name as adder_name, u2.name as handler_name FROM complaints c JOIN users u ON c.added_by = u.id LEFT JOIN users u2 ON c.handled_by = u2.id WHERE c.id = ?', [id]);
    if (!complaint) notFound();
    pageTitle = 'Complaint #' + id;
  } else if (P(ctx, 'complaint_tickets') < 2) halt('You do not have the permissions to add complaints.');

  if (post.item !== undefined) {
    const payload: any = { item: sanitize(post.item), problem: sanitize(post.problem) };
    let response: any = {};
    try {
      if (ctx.get.id !== undefined) await db.update('complaints', payload, 'id = ?', [id]);
      else {
        payload.status = 1; payload.added_by = S.user.id; payload.date_added = now;
        id = await db.insert('complaints', payload);
      }
      const dept: any = await db.selectOne('SELECT name FROM departments WHERE id = ?', [S.user.department]);
      await notifyForApproval(ctx, 'complaint_tickets', `Complaint lodged from ${dept.name} department`, payload.item, `${SITE_URL}/complaint?id=${id}`, 5);
      response = { action: 'goback' };
    } catch (e) { response = msgWarn(e); }
    return jsonExit(response);
  }

  if (post.description !== undefined) {
    const status = toInt(post.status);
    let response: any = {};
    try {
      await db.insert('complaint_timeline', { type: 'complaint', complaint: id, description: sanitize(post.description), date_added: now });
      const payload: any = {};
      if (complaint.handled_by === null && ctx.account.id != complaint.added_by) payload.handled_by = S.user.id;
      if (status === 0 || status === 2) { payload.status = status; payload.date_closed = now; }
      if (Object.keys(payload).length) await db.update('complaints', payload, 'id = ?', [id]);
      if (status === 3) response = { redirect: `material-request?c=${id}` };
      else {
        if (status !== 1) {
          const desc = status === 0 ? 'Complaint was rejected' : 'Complaint was marked resolved';
          await db.insert('complaint_timeline', { type: 'complaint', complaint: id, description: desc, date_added: now });
          const employee = new Account(ctx);
          employee.id = complaint.added_by;
          const cs: any = await employee.checkCommSettings(5);
          if (cs.push_enabled) await sendNotification(ctx, cs.push_devices, `Your ${desc}`, '', `${SITE_URL}/complaint?id=${id}`);
        }
        response = { action: 'goback' };
      }
    } catch (e) { response = msgWarn(e); }
    return jsonExit(response);
  }

  let content: string;
  const editable = ctx.get.id === undefined || (complaint.added_by == S.user.id && complaint.handled_by === null);
  if (editable) {
    content = `<form method="post" class="ajax">
		<div class="input-field"><input type="text" name="item" maxlength="50" value="${esc(complaint?.item ?? '')}" required><label>Item</label></div>
		<div class="input-field"><textarea name="problem" maxlength="1000" rows="4" required>${esc(complaint?.problem ?? '')}</textarea><label>Problem</label></div>
		<button type="submit" class="btn filled">Save</button>
		<div id="global-msg-cont"></div>
	</form>`;
  } else {
    const tl = await db.selectAll("SELECT * FROM complaint_timeline WHERE type = 'complaint' AND complaint = ?", [id]);
    const fmt = (d: string) => date('d M Y h:i A', strtotime(d) as number);
    content = `<div id="global-msg-cont"></div>
	<dl class="horizontal">
		<dt>Item</dt><dd>${esc(complaint.item)}</dd>
		<dt>Problem</dt><dd>${nl2br(complaint.problem)}</dd>
		<dt>Reported by</dt><dd>${esc(complaint.adder_name)} (${fmt(complaint.date_added)})</dd>
		<dt>Status</dt><dd>${complaintStatusLegend[complaint.status]}</dd>
		${complaint.handler_name !== null ? `<dt>Handled By</dt><dd>${esc(complaint.handler_name)}</dd>` : ''}
	</dl>
	<h4 class="mt2">Timeline</h4>
	<ul class="list two-line timeline">
		<li><div class="content">Complaint added by ${esc(complaint.adder_name)}<br><small>${fmt(complaint.date_added)}</small></div></li>
		${tl.map((r: any) => `<li><div class="content">${esc(r.description)}<small>${fmt(r.date_added)}</small></div></li>`).join('')}
		${(complaint.handled_by === null || complaint.handled_by == S.user.id) && complaint.status == 1 ? '<li><div class="content"><p><button type="button" class="btn outline" id="add-progress">Update Status</button></p></div></li>' : ''}
	</ul>`;
  }

  return {
    metaTitle: pageTitle,
    pageTitle,
    metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8">${content}</div></div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms, processAjaxForm } from './js/functions.mjs?v=${V}';
	initInputs();
	initAjaxForms();
	G('#add-progress').on('click', () => {
		G.dialog({
			title: 'Update Complaint',
			description: \`<form method="post">
				<div class="input-field"><textarea name="description" maxlength="200" rows="4" required></textarea><label>Remarks</label></div>
				<div class="input-field"><select name="status" required><option></option><option value="1">In Progress</option><option value="3">Material(s) Required</option><option value="2">Resolved</option></select><label>Status</label></div>
			</form>\`,
			onLoad: function(d){ G(d.querySelector('.input-field textarea')).textInput(); G(d.querySelector('.input-field select')).selectInput(); },
			confirmingAction: { text: 'Save', onPress: function(d){ const form = d.querySelector('form'); if(form.checkValidity()){ processAjaxForm(form).catch(()=> {}); } else return false; } },
			dismissiveAction: { text: 'Cancel' }
		});
	});
</script>`,
  };
}
