import { Ctx, Page, exit, jsonExit, json } from '@/lib/ctx';
import { materialItemStatus, materialRequestStatusLegend } from '@/lib/config';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { Account } from '@/lib/account';
import { compare, sanitize, sendNotification, toInt } from '@/lib/functions';
import { P, SITE_URL, V, arr, halt, msgWarn, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  const level = P(ctx, 'material_requisition');
  if (level === 0) halt('You do not have access to this item.');

  let pageTitle = 'Create Material Indent', id = 0, request: any;
  if (ctx.get.id !== undefined) {
    id = toInt(ctx.get.id);
    request = await db.selectOne('SELECT mr.*, u1.name as requester_name FROM material_requests mr JOIN users u1 ON mr.requested_by = u1.id WHERE mr.id = ?', [id]);
    if (!request) notFound();
    pageTitle = `Material Indent #${id}`;
  } else request = { status: 1 };

  if (post.action !== undefined) {
    if (post.action === 'load-timeline') {
      const itemId = toInt(post.itemId);
      const response: any = { timeline: '', canAdd: false };
      const item: any = await db.selectOne('SELECT * FROM material_request_items WHERE request = ? AND id = ?', [id, itemId]);
      if (item) {
        let quantity = 0;
        if (item.timeline) {
          const tl = JSON.parse(item.timeline);
          response.timeline += '<ul class="list two-line timeline right-assist mb1">';
          for (const v of tl) {
            if (v.status == 2) quantity += Number(v.quantity);
            response.timeline += `<li><div class="content"><small class="neutral-color-3">${date('d M Y h:i A', strtotime(v.date) as number)}</small><span>${esc(v.quantity)} ${materialItemStatus[v.status]} • ${esc(v.issued_by)}</span></div><span class="right-assist" style="font-size: 1.2rem;">${quantity}/${item.quantity_requested}</span></li>`;
          }
          response.timeline += '</ul>';
        }
        if (request.status == 1 && item.quantity_issued < item.quantity_requested && level === 3) {
          response.canAdd = true;
          response.timeline += `<form method="post"><input type="number" name="timeline_item_id" value="${itemId}" hidden><div class="row"><div class="input-field col xs6"><select name="status" required><option></option>
			${Object.entries(materialItemStatus).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
			</select><label>Status</label></div><div class="col xs6 stepper-cont"><div class="stepper-input"><button type="button" class="btn small icon filled less"><span class="material-icons">remove</span></button><input type="number" name="quantity" min="0" max="${item.quantity_requested}" value="0" class="nospinner"><button type="button" class="btn small icon filled more"><span class="material-icons">add</span></button></div></div></div></form>`;
        }
      }
      return exit(json(response));
    } else if (post.action === 'mark-complete') {
      let r: any = {};
      try {
        await db.update('material_requests', { status: 2, date_completed: now }, 'id = ?', [id]);
        const emp = new Account(ctx); emp.id = request.requested_by;
        const cs: any = await emp.checkCommSettings(4);
        if (cs.push_enabled) await sendNotification(ctx, cs.push_devices, 'Material requested by you has been issued', 'Tap to view details', `${SITE_URL}/material-request?id=${id}`);
        r = { action: 'goback' };
      } catch (e) { r = msgWarn(e); }
      return jsonExit(r);
    } else if (post.action === 'cancel') {
      let r: any = {};
      try { await db.update('material_requests', { status: 0 }, 'id = ?', [id]); r = { action: 'goback' }; } catch (e) { r = msgWarn(e); }
      return jsonExit(r);
    }
    return exit(new Response(''));
  } else if (post['save-pm'] !== undefined) {
    if (level !== 2) return jsonExit({ error: 'Permission error. Please contact your supervisor' });
    let r: any = {};
    try {
      const base = { status: 1, requested_by: ctx.userId, date_requested: now };
      if (ctx.get.id !== undefined) await db.update('material_requests', base, 'id = ?', [id]);
      else {
        id = await db.insert('material_requests', base);
        if (ctx.get.c !== undefined) {
          await db.insert('complaint_timeline', { type: 'complaint', complaint: toInt(ctx.get.c), description: `<a href="material-request?id=${id}">Material request #${id} created</a>`, date_added: now });
        }
      }
      if (post['deleted-items'] !== '') {
        const del = String(post['deleted-items']).split(',').filter(Boolean).map((x) => toInt(x));
        if (del.length) await db.delete('material_request_items', `request = ? AND id IN (${del.map(() => '?').join(',')})`, [id, ...del]);
      }
      const types = arr(post.type), items = arr(post.item), qty = arr(post.quantity), ids = arr(post.item_id);
      for (let i = 0; i < types.length; i++) {
        const p: any = { type: sanitize(types[i]), item: sanitize(items[i]), quantity_requested: sanitize(qty[i], 'number') };
        if (!ids[i]) { p.request = id; p.status = 1; await db.insert('material_request_items', p); }
        else await db.update('material_request_items', p, 'id = ?', [toInt(ids[i])]);
      }
      r = { action: 'goback' };
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  } else if (post.timeline_item_id !== undefined) {
    const itemId = toInt(post.timeline_item_id);
    let r: any;
    if (level === 3) {
      const status = toInt(post.status), quantity = toInt(post.quantity);
      const item: any = await db.selectOne('SELECT * FROM material_request_items WHERE request = ? AND id = ?', [id, itemId]);
      if (item) {
        const tl = item.timeline ? JSON.parse(item.timeline) : [];
        tl.push({ status, quantity, date: now, issued_by: S.user.name });
        let q = 'UPDATE material_request_items SET timeline = ?';
        const a: any[] = [JSON.stringify(tl)];
        if (status === 2) {
          q += ', quantity_issued = quantity_issued + ?'; a.push(quantity);
          if (Number(item.quantity_issued) + quantity >= item.quantity_requested) { q += ', date_issued = ?, issued_by = ?'; a.push(now, ctx.userId); }
        }
        q += ' WHERE id = ?'; a.push(item.id);
        try { await db.run(q, a); r = { action: 'reload' }; } catch (e) { r = msgWarn(e); }
      } else r = { message: { type: 'error', content: 'Could not find the selected item.' } };
    } else r = { message: { type: 'error', content: 'You do not have permission to issue materials.' } };
    return jsonExit(r);
  }

  let body: string;
  if (level === 2 && request.status == 1) {
    let entries: any[] = [];
    if (ctx.get.id !== undefined) entries = await db.selectAll('SELECT * FROM material_request_items WHERE request = ?', [id]);
    entries.push({ eatme: true, type: '', item: '', quantity: 0 });
    const machines = await db.selectAll('SELECT name FROM machines WHERE status = 2');
    const opts = (cur: string) => machines.map((m: any) => `<option value="${esc(m.name)}"${compare(m.name, cur, ' selected')}>${esc(m.name)}</option>`).join('') +
      ['Air Compressor', 'Chiller', 'Other'].map((t) => `<option value="${t}"${compare(t, cur, ' selected')}>${t}</option>`).join('');
    body = `<form method="post" class="col xs12 s10 m8 ajax"><ul class="dyno-content"><input type="text" name="deleted-items" hidden>
	${entries.map((v) => `<li class="item row${v.eatme ? ' eat-me' : ''}"><input type="number" name="item_id[]" value="${esc(v.id ?? '')}" hidden>
		<div class="input-field col xs6 s4"><select name="type[]" required><option></option>${opts(v.type)}</select><label>Item Type</label></div>
		<div class="col xs6 stepper-cont"><div class="stepper-input"><button type="button" class="btn small icon filled less"><span class="material-icons">remove</span></button><input type="number" name="quantity[]" min="0" value="${v.quantity_requested ?? 0}" class="nospinner" required><button type="button" class="btn small icon filled more"><span class="material-icons">add</span></button></div></div>
		<div class="input-field col xs12 s8"><input type="text" name="item[]" value="${esc(v.item)}" maxlength="50" required><label>Description</label></div>
		<button class="btn icon remove" data-itemid=""><span class="material-icons">delete</span></button></li>`).join('')}
	</ul><button type="button" class="btn small tonal add-dyno"><span class="material-icons">add</span> Add Item</button>
	<div class="mt2"><button type="submit" class="btn filled" name="save-pm">Save</button>
	${ctx.get.id !== undefined && request.status == 1 && request.requested_by == ctx.account.id ? '<button type="button" class="btn tonal send-action" data-action="cancel">Cancel Request</button>' : ''}</div></form>`;
  } else {
    const mats = await db.selectAll('SELECT * FROM material_request_items WHERE request = ?', [id]);
    const canIssue = level === 3 && request.status == 1;
    body = `<div class="col xs12 s10 m8"><dl class="horizontal mt2"><dt>Requested By</dt><dd>${esc(request.requester_name)}</dd><dt>Date Requested</dt><dd>${date('d M Y h:i A', strtotime(request.date_requested) as number)}</dd>
		<dt>Status</dt><dd>${materialRequestStatusLegend[request.status]}</dd>${request.date_completed !== null ? `<dt>Completed on</dt><dd>${date('d M Y h:i A', strtotime(request.date_completed) as number)}</dd>` : ''}</dl>
		<h3 class="mt2">Materials Requested</h3><table class="h-borders compact"><thead><tr><th>Material</th><th>Requested</th><th>Issued</th><th></th></tr></thead><tbody>
		${mats.map((r: any) => `<tr><td><small class="neutral-color-3">${esc(r.type)}</small><br>${esc(r.item)}</td><td>${r.quantity_requested}</td><td>${r.quantity_issued}</td><td>${canIssue ? `<button type="button" class="btn icon small material-timeline" data-id="${r.id}"><span class="material-icons">timeline</span></button>` : ''}</td></tr>`).join('')}
		</tbody></table>
		${canIssue ? `<div class="center mt2"><button type="button" class="btn tonal send-action" data-action="mark-complete" data-id="${id}" data-msg="Material request can not be modified after its marked complete">Mark Complete</button></div>` : ''}</div>`;
  }

  return {
    metaTitle: pageTitle, pageTitle, metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned">${body}</div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms, stepperInput, initializeDyno, processAjaxForm } from './js/functions.mjs?v=${V}';
	initializeDyno(G('.add-dyno')); initInputs(); initAjaxForms();
	G('.material-timeline').on('click', e => {
		const btn = e.target.closest('.btn');
		G.ajax({ type: 'POST', data: { action: 'load-timeline', itemId: btn.dataset.id } }).then(data => {
			const response = JSON.parse(data.responseText);
			const dialogOpts = {
				title: 'Timeline', description: response.timeline,
				onLoad: function(d){ G(d.querySelector('.input-field select')).selectInput(); G(d.querySelector('.input-field input')).textInput(); stepperInput(d); },
				dismissiveAction: { text: 'Close' }
			};
			if(response.canAdd){
				dialogOpts.confirmingAction = { text: 'Save', onPress: function(d){ const form = d.querySelector('form'); if(form.checkValidity()) processAjaxForm(form).catch(() => {}); else return false; } }
			}
			G.dialog(dialogOpts);
		}).catch(xhr => { console.log('Failed', xhr); G.snackbar('An error occurred.'); });
	});
</script>`,
  };
}
