import path from 'path';
import fs from 'fs/promises';
import { Ctx, Page, exit, jsonExit } from '@/lib/ctx';
import { dispatchTimeline } from '@/lib/config';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { sanitize, STORAGE_DIR, toInt } from '@/lib/functions';
import { P, V, arr, halt, msgWarn, notFound } from '@/lib/h';
import { coaHtml } from '@/lib/coa';
import { htmlToPdf, pdfResponse } from '@/lib/pdf';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, today } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'dispatches') === 0) halt('You do not have access to this item.');
  if (ctx.get.id === undefined) notFound();
  const id = toInt(ctx.get.id);
  let q = 'SELECT d.*, c.name as client_name, coa_extra_params, t.name as transporter_name FROM dispatches d JOIN clients c ON d.party_name = c.id JOIN transporters t ON d.transporter = t.id WHERE d.id = ?';
  if (S.user.department != 10) q += ' AND d.status = 1';
  const dispatch: any = await db.selectOne(q, [id]);
  if (!dispatch) notFound();
  const html = (s: string) => exit(new Response(s, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  const dept = Number(S.user.department);

  if (ctx.get.coa !== undefined) {
    const product: any = await db.selectOne('SELECT di.*, p.weight, p.type FROM dispatch_items di JOIN products p ON di.item_name = p.id WHERE di.id = ? AND dispatch = ?', [toInt(ctx.get.coa), id]);
    if (!product) return exit(new Response(''));
    const qi: any = await db.selectOne("SELECT signature FROM dispatch_times dt JOIN users u ON dt.reported_by = u.id WHERE dt.dispatch = ? AND checkpoint = 'quality_out'", [id]);
    let pdf: Buffer;
    try { pdf = await htmlToPdf(await coaHtml(ctx, dispatch, product, qi?.signature)); }
    catch (e: any) { return exit(new Response(String(e?.message ?? 'PDF generation failed'), { status: 501 })); }
    return exit(pdfResponse(pdf, `COA-${product.invoice_num}.pdf`));
  }

  if (post.action !== undefined || post.action2 !== undefined) {
    const action = post.action ?? post.action2;
    if (action === 'load-timeline') {
      const times: Record<string, string> = {};
      for (const r of await db.selectAll('SELECT * FROM dispatch_times WHERE dispatch = ?', [id])) times[r.checkpoint] = date('h:i A', strtotime(r.time_recorded) as number);
      let out = '<ul class="list compact right-assist timeline">';
      let done = false;
      for (const [key, v] of Object.entries(dispatchTimeline)) {
        if (dispatch.category == 2 && (key === 'quality_in' || key === 'quality_out')) continue;
        out += `<li${times[key] ? ' class="done"' : ''}>${v.name}<div class="right-assist">`;
        if (times[key]) out += `<strong>${times[key]}</strong>`;
        else if ((dept === 10 || dept === v.department) && !done) {
          out += `<button type="button" class="btn filled small checkpoint-done" data-checkpoint="${key}"${v.additional_info ? ` data-info="${v.additional_info}"` : ''}><span class="material-icons left-icon">done</span>Done</button>`;
          done = true;
        } else { out += '...'; done = true; }
        out += '</div></li>';
      }
      return html(out + '</ul>');
    } else if (action === 'additional-info') {
      let out = '';
      const info = (dispatchTimeline as any)[post.checkpoint]?.additional_info;
      if (info === 'items') {
        const products = await db.selectAll('SELECT id, weight, type FROM products WHERE status = 2 ORDER BY weight, type');
        const f = (n: string, label: string, type = 'text', extra = '') => `<div class="input-field col xs12 s6"><input type="${type}" name="${n}[]" ${extra} required><label>${label}</label></div>`;
        out = `<h4>Items</h4><ul class="dyno-content"><li class="item eat-me"><div class="row">
			${f('invoice_number', 'Invoice number')}${f('invoice_date', 'Invoice Date', 'text', 'class="datepicker"')}${f('date_produced', 'Date of Production', 'text', 'class="datepicker"')}
			<div class="input-field col xs12 s6"><select name="item_name[]" class="searchable" required><option></option>${products.map((r: any) => `<option value="${r.id}">${esc(r.weight)} ${esc(r.type)}</option>`).join('')}</select><label>Product</label></div>
			${f('color', 'Color')}${f('resin_supplier', 'Resin Supplier', 'text', 'maxlength="50"')}${f('resin_grade', 'Resin Grade')}${f('quantity', 'Quantity', 'number')}${f('boxes_replaced', 'Boxes Replaced', 'number', 'min="0"')}
			</div><a href="#" class="btn icon error-color delete"><span class="material-icons">delete</span></a></li></ul>
			<button type="button" class="btn tonal small add-dyno"><span class="material-icons">add</span> Add Item</button>`;
      } else if (info === 'signature') {
        const items = await db.selectAll('SELECT di.id, weight, type FROM dispatch_items di JOIN products p ON di.item_name = p.id WHERE dispatch = ?', [id]);
        out = '<h4>Items</h4>' + items.map((r: any) => `<div class="card mb1"><div class="content"><h4>${esc(r.weight)}gm ${esc(r.type)}</h4><div class="row">
			<div class="input-field col xs6"><input type="text" name="preform_batch-${r.id}" required><label>Preform Batch No.</label></div>
			<div class="input-field col xs6"><input type="text" name="resin_batch-${r.id}" required><label>Resin Batch No.</label></div></div></div></div>`).join('');
        const u: any = await db.selectOne('SELECT signature FROM users WHERE id = ?', [ctx.userId]);
        out += '<p><strong id="sign-label">Signature</strong></p>';
        if (u.signature !== null) out += `<img src="${esc(u.signature)}" id="sign-image">`;
        out += `<canvas id="signature"></canvas><input type="text" name="signature" value="${esc(u.signature ?? '')}" hidden><br><button type="button" class="btn outline" id="clear-sign"><span class="material-icons left-icon">ink_eraser</span>Clear</button>`;
      } else if (info) out = `<div class="input-field"><input type="text" name="${esc(info)}" required><label style="text-transform:capitalize">${esc(String(info).replace(/_/g, ' '))}</label></div>`;
      return html(out);
    } else if (action === 'timeline-advance') {
      const checkpoint = sanitize(post.checkpoint);
      if (await db.selectOne('SELECT id FROM dispatch_times WHERE dispatch = ? AND checkpoint = ?', [id, checkpoint]))
        return jsonExit({ error: 'This checkpoint has already been marked done. Please contact an admin to make changes.' });
      let r: any = {};
      try {
        await db.insert('dispatch_times', { dispatch: id, checkpoint, date_checkpoint: today, time_recorded: date('H:i:s'), reported_by: S.user.id });
        const p: any = {};
        if (post.vehicle_number !== undefined) p.vehicle_number = sanitize(post.vehicle_number).toUpperCase();
        if (post.item_name !== undefined) {
          const names = arr(post.item_name);
          for (let i = 0; i < names.length; i++)
            await db.insert('dispatch_items', {
              dispatch: id, invoice_num: sanitize(arr(post.invoice_number)[i]), invoice_date: sanitize(arr(post.invoice_date)[i]), resin_supplier: sanitize(arr(post.resin_supplier)[i]),
              resin_grade: sanitize(arr(post.resin_grade)[i]), quantity: sanitize(arr(post.quantity)[i], 'number'), item_name: sanitize(names[i]), color: sanitize(arr(post.color)[i]),
              date_produced: sanitize(arr(post.date_produced)[i]), boxes_replaced: sanitize(arr(post.boxes_replaced)[i]) || 0,
            });
          r = { action: 'refresh' };
        }
        if (post.signature !== undefined) {
          for (const [k, v] of Object.entries(post))
            if (k.startsWith('preform_batch')) { const itemId = k.split('-')[1]; await db.update('dispatch_items', { preform_batch: v, resin_batch: post['resin_batch-' + itemId] }, 'id = ?', [itemId]); }
          if (String(post.signature).includes('data:image')) {
            const loc = `img/signatures/${ctx.userId}.png`;
            await fs.mkdir(path.join(STORAGE_DIR, 'img/signatures'), { recursive: true });
            await fs.writeFile(path.join(STORAGE_DIR, loc), Buffer.from(String(post.signature).split(',')[1], 'base64'));
            await db.update('users', { signature: loc }, 'id = ?', [ctx.userId]);
          }
          r = { action: 'refresh' };
        }
        if (checkpoint === 'quality_out') {
          const items = await db.selectAll('SELECT di.*, p.weight, p.type FROM dispatch_items di JOIN products p ON di.item_name = p.id WHERE dispatch = ? ORDER BY invoice_num', [id]);
          const u: any = await db.selectOne('SELECT signature FROM users WHERE id = ?', [S.user.id]);
          await fs.mkdir(path.join(STORAGE_DIR, 'docs/coa'), { recursive: true });
          for (const product of items) {
            try { await fs.writeFile(path.join(STORAGE_DIR, `docs/coa/COA-${product.invoice_num}.pdf`), await htmlToPdf(await coaHtml(ctx, dispatch, product, u?.signature))); }
            catch (e: any) { console.error('COA generation failed:', e.message); }
          }
        } else if (checkpoint === 'dispatched') { p.status = 2; r = { action: 'goback' }; }
        if (Object.keys(p).length) await db.update('dispatches', p, 'id = ?', [id]);
      } catch (e) { r = msgWarn(e); }
      return jsonExit(r);
    } else if (action === 'cancel-dispatch') {
      if ([1, 9, 10].includes(dept)) {
        let r: any = {};
        try { await db.update('dispatches', { status: 0 }, 'id = ?', [id]); r = { action: 'goback' }; } catch (e) { r = msgWarn(e); }
        return jsonExit(r);
      }
    }
    return exit(new Response(''));
  }

  let itemsHtml = '';
  if (dept === 4 || dept === 10) {
    const items = await db.selectAll('SELECT di.*, p.weight, p.type FROM dispatch_items di JOIN products p ON di.item_name = p.id WHERE dispatch = ? ORDER BY invoice_num', [id]);
    if (items.length) {
      const qc = await db.count('dispatch_times', "dispatch = ? AND checkpoint = 'quality_out'", [id]);
      let prev: any = null, tq = 0, br = 0, rows = '';
      for (const r of items) {
        tq += Number(r.quantity); br += Number(r.boxes_replaced);
        if (prev === null || prev != r.invoice_num) { rows += `<tr><td colspan="6">Invoice: <strong>${esc(r.invoice_num)}</strong></td></tr>`; prev = r.invoice_num; }
        rows += `<tr><td>${esc(r.weight)}gm ${esc(r.type)}</td><td>${esc(r.resin_grade)}</td><td>${esc(r.quantity)}</td><td>${date('M d, Y', strtotime(r.date_produced) as number)}</td><td>${esc(r.boxes_replaced)}</td>${qc ? `<td><a href="docs/coa/COA-${esc(r.invoice_num)}.pdf" class="btn icon tonal" download><span class="material-icons">download</span></a></td>` : ''}</tr>`;
      }
      itemsHtml = `<h3 class="no-margin">Dispatch Items</h3><div class="responsive-table mt1 mb2"><table class="h-borders"><thead><tr><th>Product</th><th>Resin Grade</th><th>No. of Boxes</th><th>Date of Production</th><th>Boxes Replaced</th>${qc ? '<th>COA</th>' : ''}</tr></thead><tbody>${rows}</tbody>
			<tfoot><tr><th></th><th></th><th>${tq}</th><th></th><th>${br}</th>${qc ? '<th></th>' : ''}</tr></tfoot></table></div>`;
    }
  }
  return {
    metaTitle: dispatch.client_name, pageTitle: dispatch.client_name, metaDescription: '',
    css: '<style type="text/css">#signature{ border: 1px dashed var(--neutral-color-4); } #sign-image{ pointer-events: none; border: 1px dashed var(--neutral-color-4); } #sign-image + #signature{ display: none; }</style>',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8">
	<dl class="horizontal"><dt>Dispatch Date</dt><dd>${date('d M Y', strtotime(dispatch.date_of_dispatch) as number)}</dd><dt>Party</dt><dd>${esc(dispatch.client_name)}</dd>
	<dt>Vehicle</dt><dd>${esc(dispatch.transporter_name)}<br>${esc(dispatch.vehicle_number)} (${esc(dispatch.vehicle_size)}ft)</dd></dl>
	${itemsHtml}<h3>Timeline</h3><div id="timeline-cont" style="margin-bottom: 5rem;"></div></div></div></div></section>
<div class="sheets"><div class="head">Vehicle Report</div><form method="post" class="body ajax-form"><div class="input-field"><input type="text" name="vehicle_number" class="text-uppercase" required><label>Vehicle Number</label></div><button type="submit" class="btn tonal">Save</button></form></div>
${dispatch.status == 1 && [1, 9, 10].includes(dept) ? '<div class="fab-cont"><button type="button" class="fab extended center error-bg" id="cancel-dispatch">Cancel Dispatch</button></div>' : ''}`,
    js: `<script src="js/signature_pad.umd.min.js?v=${V}"></script><script src="js/dispatch.js?v=${V}" type="module"></script>`,
  };
}
