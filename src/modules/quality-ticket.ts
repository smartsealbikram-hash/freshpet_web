import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { qualityTicketStatus } from '@/lib/config';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { Account } from '@/lib/account';
import { compare, sanitize, sendNotification, toInt, uploadImage } from '@/lib/functions';
import { P, SITE_URL, V, halt, msgWarn, nl2br, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'quality_tickets') === 0) halt('You do not have access to this item.');

  let pageTitle = 'Create Quality Ticket';
  let id = 0, ticketId = '';
  let ticket: any;
  if (ctx.get.id !== undefined) {
    id = toInt(ctx.get.id);
    ticket = await db.selectOne('SELECT q.*, u.name as adder_name, p.weight, p.type FROM quality_tickets q JOIN users u ON q.added_by = u.id LEFT JOIN products p ON q.product = p.id WHERE q.id = ?', [id]);
    if (!ticket) notFound();
    ticketId = 'FP' + String(ticket.id).padStart(4, '0');
    pageTitle = 'Ticket ' + ticketId;
  } else if (P(ctx, 'quality_tickets') < 2) halt('You do not have the permissions to add quality tickets.');

  if (post.customer !== undefined) {
    const payload: any = { customer: sanitize(post.customer), product: toInt(post.product), complaint: sanitize(post.complaint) };
    const photosFiles = (ctx.files.photos ?? []).filter((f) => f.size > 0);
    let photos: string | undefined;
    if (photosFiles.length) {
      const up = await uploadImage(ctx, photosFiles, 'img/quality/', { maxSize: 500, tree: 1 });
      if (!up) { const m = S.msg?.content; delete S.msg; return jsonExit({ error: m }); }
      photos = up.map((k) => '/' + k.path).join(',');
    }
    let response: any = {};
    try {
      if (ctx.get.id !== undefined) {
        if (photos) await db.run('UPDATE quality_tickets SET customer = ?, product = ?, complaint = ?, photos = CONCAT(IFNULL(photos, \'\'), ?) WHERE id = ?', [payload.customer, payload.product, payload.complaint, (ticket.photos ? ',' : '') + photos, id]);
        else await db.update('quality_tickets', payload, 'id = ?', [id]);
      } else {
        if (photos) payload.photos = photos;
        Object.assign(payload, { status: 1, added_by: ctx.userId, date_added: now });
        id = await db.insert('quality_tickets', payload);
        ticket = await db.selectOne('SELECT weight, type FROM products WHERE id = ?', [payload.product]);
      }
      const devs = await db.selectAll("SELECT tag FROM users u JOIN staff_permissions sp ON u.role = sp.role AND sp.type = 'quality_tickets' JOIN user_devices ud ON u.id = ud.user WHERE u.status = 2 AND access_level = 3 AND sp.access = 3 AND tag IS NOT NULL");
      if (devs.length) await sendNotification(ctx, devs.map((r: any) => r.tag), `Quality ticket created for product ${ticket.weight}gm ${ticket.type}`, '', `${SITE_URL}/quality-ticket?id=${id}`);
      response = { action: 'goback' };
    } catch (e) { response = msgWarn(e); }
    return jsonExit(response);
  }

  if (post.description !== undefined) {
    let response: any = {};
    try {
      await db.insert('complaint_timeline', { type: 'quality', complaint: id, description: sanitize(post.description), added_by: ctx.userId, date_added: now });
      if (post.fixed !== undefined) {
        await db.update('quality_tickets', { status: 2 }, 'id = ?', [id]);
        const emp = new Account(ctx);
        emp.id = ticket.added_by;
        const cs: any = await emp.checkCommSettings(7);
        if (cs.push_enabled) await sendNotification(ctx, cs.push_devices, `Quality ticket ${ticketId} has been marked as fixed`, 'Verify and approve the fix to close the ticket.', `${SITE_URL}/quality-ticket?id=${id}`);
        response = { action: 'goback' };
      } else response = { action: 'refresh' };
    } catch (e) { response = msgWarn(e); }
    return jsonExit(response);
  }

  if (post.action === 'approve') {
    let response: any = {};
    if (ticket.added_by == S.user.id && ticket.status == 2) {
      try { await db.update('quality_tickets', { status: 3 }, 'id = ?', [id]); } catch (e) { response = msgWarn(e); }
    } else response.message = { type: 'error', content: 'This ticket can not be approved' };
    return jsonExit(response);
  }

  const fmt = (d: string) => date('d M Y h:i A', strtotime(d) as number);
  const photoList = (ticket?.photos ? String(ticket.photos).split(',').filter(Boolean) : []);
  const imgs = photoList.map((k) => `<li><img src="${SITE_URL}${esc(k)}" class="expandable"></li>`).join('');
  let content: string;
  if (ctx.get.id === undefined || (ticket.added_by == S.user.id && ticket.status == 1)) {
    const products = await db.selectAll('SELECT * FROM products WHERE status = 2');
    content = `<form method="post" class="ajax">
		<div class="input-field sidelabel"><input type="text" name="customer" maxlength="50" value="${esc(ticket?.customer ?? '')}" required><label>Customer</label></div>
		<div class="input-field sidelabel"><select name="product" required><option></option>${products.map((r: any) => `<option value="${r.id}"${compare(r.id, ticket?.product ?? '', ' selected')}>${esc(r.weight)}gm ${esc(r.type)}</option>`).join('')}</select><label>Product</label></div>
		<div class="input-field sidelabel"><textarea name="complaint" maxlength="2000" rows="4" required>${esc(ticket?.complaint ?? '')}</textarea><label>Problem</label></div>
		<div class="faux-sidelabel"><p class="label">Photos</p><div class="inputs">
			${imgs ? `<ul class="image-list">${imgs}</ul>` : ''}
			<div class="file-input"><input type="file" name="photos[]"><button type="button" class="btn outline small">Select Files</button><span class="file-name">No file selected</span></div>
		</div></div>
		<button type="submit" class="btn filled">Save</button>
	</form>`;
  } else {
    const tl = await db.selectAll("SELECT ct.*, u.name FROM complaint_timeline ct JOIN users u ON ct.added_by = u.id WHERE ct.type = 'quality' AND complaint = ? ORDER BY ct.id DESC", [id]);
    content = `<dl class="horizontal">
		<dt>Customer</dt><dd>${esc(ticket.customer)}</dd>
		<dt>Product</dt><dd>${esc(ticket.weight)}gm ${esc(ticket.type)}</dd>
		<dt>Problem</dt><dd>${nl2br(ticket.complaint)}</dd>
		${imgs ? `<dt>Photos</dt><dd><ul class="image-list">${imgs}</ul></dd>` : ''}
		<dt>Created By</dt><dd>${esc(ticket.adder_name)} (${fmt(ticket.date_added)})</dd>
		<dt>Status</dt><dd>${qualityTicketStatus[ticket.status]}</dd>
	</dl>
	${ticket.added_by == S.user.id && ticket.status == 2 ? '<p class="center"><button type="button" class="btn filled send-action" data-action="approve">Approve Ticket</button></p>' : ''}
	<h4 class="mt2">Timeline</h4>
	<ul class="list two-line timeline compact">
		${P(ctx, 'quality_tickets') >= 2 && ticket.status < 2 ? '<li><div class="content"><p><button type="button" class="btn outline" id="add-progress">Update Status</button></p></div></li>' : ''}
		${tl.map((r: any) => `<li><div class="content">${esc(r.description)}<br><small>By ${esc(r.name)} (${fmt(r.date_added)})</small></div></li>`).join('')}
		<li><div class="content">Complaint added by ${esc(ticket.adder_name)}<br><small>${fmt(ticket.date_added)}</small></div></li>
	</ul>`;
  }

  return {
    metaTitle: pageTitle,
    pageTitle,
    metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${content}</div></div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms, processAjaxForm } from './js/functions.mjs?v=${V}';
	initInputs();
	initAjaxForms();
	G('#add-progress').on('click', () => {
		G.dialog({
			title: 'Update Ticket',
			description: \`<form method="post">
				<div class="input-field"><textarea name="description" maxlength="200" rows="4" required></textarea><label>Remarks</label></div>
				<div class="input-field"><input type="checkbox" name="fixed" id="fixed"><label for="fixed">Related problem has been fixed</label></div>
			</form>\`,
			onLoad: function(d){ G(d.querySelector('.input-field textarea')).textInput(); },
			confirmingAction: { text: 'Save', onPress: function(d){ const form = d.querySelector('form'); if(form.checkValidity()){ processAjaxForm(form); } else return false; } },
			dismissiveAction: { text: 'Cancel' }
		});
	});
	G('.expandable').expandableImg();
</script>`,
  };
}
