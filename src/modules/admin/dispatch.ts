import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { dispatchStatusLegend, dispatchTimeline } from '@/lib/config';
import { compare, hasAccess, hasAccessToRow, sanitize, toInt } from '@/lib/functions';
import { date, strtotime } from '@/lib/php';
import { env } from '@/lib/env';
import { esc } from '@/lib/html';
import { arr } from '@/lib/h';
import { noAccess } from '@/lib/adminList';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, get, now } = ctx;
  if (!hasAccess(ctx, 'view', 'dispatches')) noAccess();
  let title = 'Create Dispatch', dispatch: any = {}, id = 0;
  ctx.S.current_page = `${env.SITE_URL}/admin/dispatch`;
  const hasId = get.id !== undefined;

  if (post.party_name !== undefined) {
    const p: any = { status: toInt(post.status), category: toInt(post.category), date_of_dispatch: sanitize(post.date_of_dispatch), party_name: toInt(post.party_name), vehicle_size: toInt(post.vehicle_size), vehicle_number: sanitize(post.vehicle_number).toUpperCase(), sales_quotation: sanitize(post.sales_quotation), transporter: toInt(post.transporter), cost: sanitize(post.cost, 'number') };
    let r: any = {};
    try {
      if (hasId && hasAccess(ctx, 'edit', 'dispatches') && (await hasAccessToRow(ctx, toInt(get.id), 'dispatches'))) { id = toInt(get.id); await db.update('dispatches', p, 'id = ?', [id]); }
      else if (!hasId && hasAccess(ctx, 'add', 'dispatches')) { p.date_created = now; id = await db.insert('dispatches', p); }
      else throw new Error('You do not have permission for this operation');
      if (post['deleted-items']) {
        const del = String(post['deleted-items']).split(',').filter(Boolean).map((x) => toInt(x));
        if (del.length) await db.delete('dispatch_items', `id IN (${del.map(() => '?').join(',')})`, del);
      }
      const ids = arr(post['dItem-id']);
      for (let i = 0; i < ids.length; i++) {
        const it: any = { invoice_num: sanitize(arr(post.invoice_num)[i]), item_name: sanitize(arr(post.item_name)[i]), quantity: sanitize(arr(post.quantity)[i], 'number'), date_produced: sanitize(arr(post.date_produced)[i]), resin_grade: sanitize(arr(post.resin_grade)[i]) };
        if (ids[i] !== '') await db.update('dispatch_items', it, 'id = ?', [toInt(ids[i])]);
        else { it.dispatch = id; await db.insert('dispatch_items', it); }
      }
      if (!hasId) { if (post.another !== undefined) r = { message: { type: 'snackbar', content: 'Dispatch Saved.' }, action: 'refresh' }; else r.action = 'goback'; }
    } catch (e: any) { r = { message: { type: 'warning', content: e.message } }; }
    return jsonExit(r);
  } else if (hasId && (await hasAccessToRow(ctx, toInt(get.id), 'dispatches'))) {
    title = 'Edit Dispatch';
    id = toInt(get.id);
    dispatch = await db.selectOne('SELECT * FROM dispatches WHERE id = ?', [id]);
    if (!dispatch) jsonExit({ message: { type: 'error', content: 'No dispatch found. Please select one from the list.' }, action: 'halt' });
    ctx.S.current_page += `?id=${id}`;
    if (post['save-timeline'] !== undefined) {
      const timeNow: string[] = arr(post.timenow);
      const old: Record<string, any> = {};
      for (const r of await db.selectAll('SELECT * FROM dispatch_times WHERE dispatch = ?', [id])) old[r.checkpoint] = r;
      const canEdit = hasAccess(ctx, 'edit', 'dispatch_timeline'), canAdd = hasAccess(ctx, 'add', 'dispatch_timeline');
      let complete = false, r: any = {};
      try {
        for (const [key, value] of Object.entries(post)) {
          if (['save-timeline', 'timenow'].includes(key) || value === '' || value === undefined) continue;
          const p: any = { time_recorded: date('H:i:00', strtotime(value) as number), reported_by: ctx.S.user.id };
          if (old[key]) { if (String(old[key].time_recorded).slice(0, 5) === p.time_recorded.slice(0, 5)) continue; else if (canEdit) await db.update('dispatch_times', p, 'id = ?', [old[key].id]); }
          else if (canAdd) { p.dispatch = id; p.checkpoint = key; p.date_checkpoint = ctx.today; await db.insert('dispatch_times', p); }
          if (key === 'dispatched') complete = true;
        }
        for (const key of timeNow) {
          const p: any = { time_recorded: date('H:i:s'), reported_by: ctx.S.user.id };
          if (old[key] && canEdit) await db.update('dispatch_times', p, 'id = ?', [old[key].id]);
          else if (canAdd) { p.dispatch = id; p.checkpoint = key; p.date_checkpoint = ctx.today; await db.insert('dispatch_times', p); }
          if (key === 'dispatched') complete = true;
        }
        if (complete && dispatch.status == 1) await db.update('dispatches', { status: 2 }, 'id = ?', [id]);
      } catch (e: any) { r.message = { type: 'warning', content: e.message }; }
      return jsonExit(r);
    }
  }

  const clients = await db.selectAll('SELECT id, name FROM clients WHERE status = 2 ORDER BY name');
  const transporters = await db.selectAll('SELECT id, name FROM transporters WHERE status = 2');
  const items: any[] = hasId ? await db.selectAll('SELECT * FROM dispatch_items WHERE dispatch = ?', [id]) : [];
  items.push({ eatme: true });
  const v = (k: string) => esc(dispatch?.[k] ?? '');
  const itemsHtml = items.map((r) => `<li class="item${r.eatme ? ' eat-me' : ''}"><input type="number" name="dItem-id[]" value="${esc(r.id ?? '')}" hidden><div class="row">
		<div class="input-field col xs12 s6"><input type="text" name="invoice_num[]" value="${esc(r.invoice_num ?? '')}" required><label>Invoice Number</label></div>
		<div class="input-field col xs12 s6"><input type="text" name="item_name[]" value="${esc(r.item_name ?? '')}" required><label>Item Name</label></div>
		<div class="input-field col xs12 s6"><input type="number" name="quantity[]" value="${esc(r.quantity ?? '')}" required><label>Quantity</label></div>
		<div class="input-field col xs12 s6"><input type="text" name="date_produced[]" class="datepicker" value="${esc(r.date_produced ?? '')}" required><label>Date of Production</label></div>
		<div class="input-field col xs12 s6"><input type="text" name="resin_grade[]" value="${esc(r.resin_grade ?? '')}" required><label>Resin Grade</label></div></div>
		<button class="btn icon remove" data-itemid="${esc(r.id ?? '')}"><span class="material-icons">delete</span></button></li>`).join('');

  let timeline = '';
  if (hasId && hasAccess(ctx, 'view', 'dispatch_timeline')) {
    const tl: Record<string, any> = JSON.parse(JSON.stringify(dispatchTimeline));
    for (const r of await db.selectAll('SELECT dt.checkpoint, time_recorded, u.name, u.access_level FROM dispatch_times dt LEFT JOIN users u ON dt.reported_by = u.id WHERE dispatch = ?', [id])) {
      if (tl[r.checkpoint]) {
        tl[r.checkpoint].time = date('h:i a', strtotime(r.time_recorded) as number);
        tl[r.checkpoint].reported_by = esc(r.name) + (r.access_level >= 4 ? ' <span class="tooltip" title="Time recorded by admin"><span class="material-icons">supervisor_account</span></span>' : '');
      }
    }
    const canAdd = hasAccess(ctx, 'add', 'dispatch_timeline'), canEdit = hasAccess(ctx, 'edit', 'dispatch_timeline');
    const rows = Object.entries(tl).filter(([k]) => !(dispatch.category == 2 && (k === 'quality_in' || k === 'quality_out'))).map(([k, val]) => `<tr><td>${esc(val.name)}</td><td style="width: 150px;">${canAdd || canEdit
      ? `<div class="input-field mb05"><input type="text" name="${k}" class="timepicker"${val.time ? ` value="${val.time}" required` : ''}><label>Time</label></div><div class="input-field small-check no-margin"><input type="checkbox" name="timenow[]" value="${k}" id="${k}_now"><label for="${k}_now">Now</label></div>`
      : val.time ?? 'Pending'}</td><td>${val.reported_by ?? ''}</td></tr>`).join('');
    timeline = `<div class="row"><div class="col xs12 m9 l6"><form method="post" class="card mt2 ajax"><div class="content"><h4 class="text-uppercase">Timeline</h4><table class="h-borders"><tbody>${rows}</tbody></table></div>
		<div class="action"><input type="text" name="save-timeline" hidden>${canAdd || canEdit ? '<button type="submit" class="btn secondary waves">Save</button>' : ''}<div id="global-msg-cont"></div></div></form></div></div>`;
  }

  return {
    metaTitle: title, pageTitle: title, metaDescription: '',
    content: `<section><div class="container"><h1 class="page-title">${esc(title)}</h1><form method="post" class="card ajax"><div class="content"><div class="row"><div class="col xs12 m9 l6">
	<div class="input-field sidelabel"><p class="label">Category</p><div class="segmented-control"><input type="radio" name="category" value="1" id="category1"${compare(1, dispatch.category ?? '', ' checked')} required><label for="category1">Client</label><input type="radio" name="category" value="2" id="category2"${compare(2, dispatch.category ?? '', ' checked')} required><label for="category2">Warehouse</label></div></div>
	<div class="input-field sidelabel"><input type="text" name="date_of_dispatch" class="datepicker" value="${v('date_of_dispatch')}" required><label>Dispatch Date</label></div>
	<div class="input-field sidelabel"><input type="text" name="sales_quotation" value="${v('sales_quotation')}"><label>Sales Quotation</label></div>
	<div class="input-field sidelabel"><select name="party_name" class="searchable" required><option></option>${clients.map((r: any) => `<option value="${r.id}"${compare(r.id, dispatch.party_name ?? '', ' selected')}>${esc(r.name)}</option>`).join('')}</select><label>Party</label></div>
	<div class="input-field sidelabel"><select name="transporter" required><option></option>${transporters.map((r: any) => `<option value="${r.id}"${compare(r.id, dispatch.transporter ?? '', ' selected')}>${esc(r.name)}</option>`).join('')}</select><label>Transporter</label></div>
	<div class="input-field sidelabel"><select name="vehicle_size"><option></option><option value="19"${compare(19, dispatch.vehicle_size, ' selected')}>19ft Single Axle</option><option value="32"${compare(32, dispatch.vehicle_size, ' selected')}>32ft Multi Axle</option><option value="0"${compare(0, dispatch.vehicle_size, ' selected')}>Other</option></select><label>Vehicle Size</label></div>
	<div class="input-field sidelabel"><input type="text" name="vehicle_number" maxlength="20" class="text-uppercase" value="${v('vehicle_number')}"><label>Vehicle Number</label></div>
	<div class="input-field sidelabel"><span class="left-assist">₹</span><input type="number" name="cost" value="${v('cost')}"><label>Cost</label></div>
	<div class="input-field sidelabel"><select name="status" required><option></option>${Object.entries(dispatchStatusLegend).map(([k, val]) => `<option value="${k}"${compare(dispatch.status ?? '', k, ' selected')}>${val}</option>`).join('')}</select><label>Status</label></div>
	</div><div class="col xs12 m9 l6"><h4>Dispatch Items</h4><ul class="dyno-content"><input type="text" name="deleted-items" hidden>${itemsHtml}</ul><button type="button" class="btn tonal small add-dyno"><i class="material-icons">add</i> Add Item</button></div></div></div>
	${hasAccess(ctx, 'edit', 'dispatches') || hasAccess(ctx, 'add', 'dispatches') ? `<div class="action"><button type="submit" class="btn filled">Save</button>${!hasId ? '<button type="submit" class="btn outline add-another">Save and Add Another</button>' : ''}</div>` : ''}</form>${timeline}</div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms, initializeDyno } from '../js/functions.mjs';
	initializeDyno(G('.add-dyno')); initInputs(); initAjaxForms();
	G('input[name="timenow[]"]').on('change', e => { const td = e.target.closest('td'), timeInput = td.querySelector('.timepicker'); timeInput.disabled = !!e.target.checked; });
</script>`,
  };
}
