import path from 'path';
import { getFile, putFile } from '@/lib/storage';
import { Ctx, Page, exit, jsonExit } from '@/lib/ctx';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { compare, curlRequest, getFinancialYear, sanitize, sendmail, STORAGE_DIR, toInt, uploadImage } from '@/lib/functions';
import { P, SITE_URL, V, halt, msgWarn, notFound } from '@/lib/h';
import { env } from '@/lib/env';
import { htmlToPdf } from '@/lib/pdf';

const formFields = (e: any = {}) => `<div class="input-field sidelabel"><input type="text" name="date_invoice" class="datepicker" value="${esc(e.date_invoice ?? '')}" required><label>Invoice Date</label></div>
<div class="input-field sidelabel"><input type="tel" name="invoice_num" maxlength="20" value="${esc(e.invoice_num ?? '')}" required><label>Invoice Number</label></div>
<div class="input-field sidelabel"><input type="text" name="party_name" maxlength="50" value="${esc(e.party_name ?? '')}" required><label>Party Name</label></div>
<div class="input-field sidelabel"><input type="text" name="product_name" maxlength="50" value="${esc(e.product_name ?? '')}" required><label>Product Name</label></div>
<div class="faux-sidelabel"><p class="label">Quantity</p><div class="inputs"><div class="row mb1"><div class="col xs8 input-field"><input type="number" name="quantity" value="${esc(e.quantity ?? '')}" required></div>
<div class="input-field col xs4"><select name="unit" required><option></option><option value="kgs"${compare('kgs', e.unit ?? null, ' selected')}>kgs</option><option value="pcs"${compare('pcs', e.unit ?? null, ' selected')}>pcs</option></select><label>Unit</label></div></div></div></div>
<div class="input-field sidelabel"><input type="number" step="0.01" name="rate" value="${esc(e.rate ?? '')}" required><label>Rate</label></div>
<div class="input-field sidelabel"><input type="number" step="0.01" name="amount" value="${esc(e.amount ?? '')}" required><label>Amount</label></div>
<div class="input-field sidelabel"><input type="text" maxlength="10" name="vehicle_num" value="${esc(e.vehicle_num ?? '')}" required><label>Vehicle Number</label></div>`;

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now, today } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  const level = P(ctx, 'receiving_notes');
  if (level === 0) halt('You do not have access to this item.');
  let pageTitle = 'Add Entry', id = 0, entry: any;

  if (ctx.get.id !== undefined) {
    id = toInt(ctx.get.id);
    entry = await db.selectOne('SELECT rn.*, u.name as receiver_name FROM receiving_notes rn JOIN users u ON rn.received_by = u.id WHERE rn.id = ?', [id]);
    if (!entry) notFound();
    pageTitle = entry.register_id;

    if (post.action === 'job-done') {
      const chk = await curlRequest(`${env.AI_URL}/job-status/${entry.ai_job_id}`, { type: 'GET', headers: ['X-API-Key: ' + env.AI_SERVER_KEY] });
      let job: any = {};
      try { job = JSON.parse(chk.response_body); } catch { job = { status: 'failed' }; }
      let out = '';
      if (['not_found', 'done', 'failed'].includes(job.status)) {
        const p: any = { ai_job_id: null };
        if (job.status === 'done') {
          const inv = job.result?.extracted_data ?? {};
          p.ocr_text = job.result?.ocr_text;
          Object.assign(p, { invoice_num: inv.invoice_number ?? '', date_invoice: inv.invoice_date ?? '', party_name: inv.company_name ?? '', product_name: inv.product_name ?? '', quantity: inv.quantity ?? '', unit: inv.unit ?? '', rate: inv.rate ?? '', amount: inv.total_amount ?? '', vehicle_num: inv.vehicle_number ?? '' });
          if (!inv.freshpet_mentioned) {
            const parts = String(entry.invoice_pdf).split('/');
            const pdfName = parts.pop() as string;
            const pdfBuf = await getFile(String(entry.invoice_pdf));
            for (const r of await db.selectAll('SELECT name, email FROM users WHERE status = 2 AND role = 11'))
              await sendmail(r.email, 'Issue bill', { text: `Hello ${r.name}, a GRN invoice has been scanned in without FreshPet being mentioned on it. The invoice has been attached below. Please issue an invoice against FreshPet`, attachment: pdfBuf ? { name: pdfName, buffer: pdfBuf } : { name: pdfName, path: path.join(STORAGE_DIR, parts.join('/')) + path.sep } }, 'operations@freshpet.in,Operations');
          }
        }
        await db.update('receiving_notes', p, 'id = ?', [id]);
        out = formFields(p);
      }
      return exit(new Response(out, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    } else if (post.date_invoice !== undefined) {
      const p: any = {
        date_invoice: sanitize(post.date_invoice), invoice_num: sanitize(post.invoice_num), po_num: sanitize(post.po_num), party_name: sanitize(post.party_name), product_name: sanitize(post.product_name),
        quantity: sanitize(post.quantity, 'number'), unit: sanitize(post.unit), rate: sanitize(post.rate, 'number'), amount: sanitize(post.amount, 'number'),
        delivered_by: sanitize(post.delivered_by), deliverer_phone: sanitize(post.deliverer_phone), vehicle_num: sanitize(post.vehicle_num),
      };
      for (const f of ['photo_in', 'photo_out']) {
        const file = ctx.files[f]?.[0];
        if (file && file.size) {
          const u = await uploadImage(ctx, [file], 'img/receiving-notes/', { maxSize: 500, tree: 2 });
          if (!u) { const m = S.msg?.content; delete S.msg; return jsonExit({ error: m }); }
          p[f] = '/' + u[0].path;
        }
      }
      let r: any = {};
      try { p.updated_by = S.user.id; p.date_updated = now; await db.update('receiving_notes', p, 'id = ?', [id]); r = { action: 'goback' }; } catch (e) { r = msgWarn(e); }
      return jsonExit(r);
    }
  } else if (level < 2) halt('You do not have permission to access that page.');

  if (ctx.files.invoice_photos?.length) {
    let r: any;
    try {
      const fd = new FormData();
      const first = ctx.files.invoice_photos[0];
      fd.append('file', new Blob([new Uint8Array(first.buffer)], { type: first.type }), first.name);
      const resp = await fetch(`${env.AI_URL}/grn-scanner`, { method: 'POST', headers: { 'X-API-Key': env.AI_SERVER_KEY }, body: fd }).catch(() => null);
      const body = resp && resp.status === 200 ? await resp.text() : '';
      if (!body || body === 'null') throw new Error('Failed to scan the file. Please check your image or contact support.');
      const job = JSON.parse(body);
      const y = getFinancialYear();
      const loc = Number(ctx.settings.location);
      const n = (await db.count('receiving_notes', "location = ? AND type = 'grn' AND DATE(date_received) >= ? AND DATE(date_received) <= ?", [loc, `${y}-04-01`, `${y + 1}-03-31`])) + 1;
      const registerId = `${({ 1: 'GRN', 2: 'GRNJ' } as any)[loc]}/${String(n).padStart(3, '0')}`;
      const pdfLocation = `docs/grn/${y}/`;
      const pdfName = registerId.replace('/', '') + '.pdf';
      id = await db.insert('receiving_notes', { ai_job_id: job.job_id, location: loc, type: 'grn', register_id: registerId, invoice_pdf: `/${pdfLocation}${pdfName}`, received_by: S.user.id, date_received: now });
      const pages = ctx.files.invoice_photos.map((f) => `<div class="page"><img src="data:${f.type};base64,${f.buffer.toString('base64')}"></div>`).join('');
      const html = `<!DOCTYPE html><html lang="en"><head><title></title><meta charset="utf-8"><style>body{margin:0;padding:0}@page{margin:0}.page{page-break-after:always;text-align:center}.page:last-child{page-break-after:auto}img{max-width:100%;max-height:100%}</style></head><body>${pages}</body></html>`;
      await putFile(pdfLocation + pdfName, await htmlToPdf(html));
      r = { redirect: `grn-register-entry?id=${id}` };
    } catch (e: any) { r = { message: { type: 'error', content: e.message } }; }
    return jsonExit(r);
  }

  let display: string;
  if (level >= 2) display = ctx.get.id === undefined ? 'upload_form' : String(entry.date_received).split(' ')[0] == today ? 'edit_form' : 'display';
  else display = 'display';
  const fmt = (d: any) => date('d M Y h:i A', strtotime(d) as number);
  const fileLink = (name: string) => (entry?.[name] ? `<img src="${esc(entry[name])}" class="upload-sideimage expandable">` : '');
  let body: string;
  if (display === 'upload_form')
    body = `<form method="post" class="ajax"><div class="file-drop"><label>Upload photos of the invoice</label><input type="file" name="invoice_photos[]" accept="image/*" multiple hidden></div><div class="action center mt1"><button type="submit" class="btn filled">Upload</button></div></form>`;
  else if (display === 'edit_form')
    body = `<form method="post" class="ajax">
		${entry.ai_job_id !== null ? '<div class="card mb1" id="ai-tracker"><div class="content"><div id="progress-cont"></div><div><h4 id="ai-status">Scanning Image</h4><p class="mtn1 mb0"><small class="neutral-color-3">AI can make mistakes. Verify inputs</small></p></div></div></div><div id="form-fields-cont"></div>' : formFields(entry)}
		<div class="input-field sidelabel"><input type="text" name="po_num" maxlength="10" value="${esc(entry.po_num ?? '')}"><label>P.O. Number</label></div>
		<div class="file-input sidelabel">${fileLink('photo_in')}<input type="file" name="photo_in" required><label>Photo In</label><button type="button" class="btn outline small">Select File</button><span class="file-name">No file selected</span></div>
		<div class="file-input sidelabel">${fileLink('photo_out')}<input type="file" name="photo_out"><label>Photo Out</label><button type="button" class="btn outline small">Select File</button><span class="file-name">No file selected</span></div>
		<div class="faux-sidelabel"><p class="label">Delivered By</p><div class="inputs"><div class="row">
			<div class="input-field col xs12 s6"><input type="text" maxlength="50" name="delivered_by" value="${esc(entry.delivered_by ?? '')}" required><label>Name</label></div>
			<div class="input-field col xs12 s6"><input type="tel" maxlength="20" name="deliverer_phone" value="${esc(entry.deliverer_phone ?? '')}"><label>Phone</label></div></div></div></div>
		<button type="submit" class="btn filled">Save</button></form>`;
  else {
    let upd = '';
    if (entry.updated_by !== null) {
      const name = entry.updated_by == entry.received_by ? entry.receiver_name : ((await db.selectOne('SELECT name FROM users WHERE id = ?', [entry.updated_by])) as any).name;
      upd = `<dt>Invoice</dt><dd>${entry.invoice_pdf !== null ? `<a href="${SITE_URL}${esc(entry.invoice_pdf)}" class="btn text small" download>Download</a>` : 'NA'}</dd><dt>Last updated by</dt><dd>${esc(name)} (${fmt(entry.date_updated)})</dd>`;
    }
    body = `<dl class="horizontal"><dt>Received by</dt><dd>${esc(entry.receiver_name)} (${fmt(entry.date_received)})</dd>
		<dt>Invoice Date</dt><dd>${date('d M Y', strtotime(entry.date_invoice) as number)}</dd><dt>Invoice Number</dt><dd>${esc(entry.invoice_num)}</dd><dt>PO Number</dt><dd>${esc(entry.po_num)}</dd>
		<dt>Party Name</dt><dd>${esc(entry.party_name)}</dd><dt>Product Name</dt><dd>${esc(entry.product_name)}</dd><dt>Quantity</dt><dd>${esc(entry.quantity)}${esc(entry.unit)}</dd>
		<dt>Rate</dt><dd>₹${esc(entry.rate)}</dd><dt>Amount</dt><dd>₹${esc(entry.amount)}</dd><dt>Delivered by</dt><dd>${esc(entry.delivered_by)} - <a href="tel:${esc(entry.deliverer_phone)}">${esc(entry.deliverer_phone)}</a></dd>
		<dt>Vehicle Number</dt><dd>${esc(entry.vehicle_num)}</dd>
		${entry.photo_in ? `<dt>Photo In</dt><dd><img src="${SITE_URL}${esc(entry.photo_in)}" class="max150 expandable"></dd>` : ''}
		${entry.photo_in ? `<dt>Photo Out</dt><dd><img src="${SITE_URL}${esc(entry.photo_out ?? '')}" class="max150 expandable"></dd>` : ''}${upd}</dl>`;
  }

  const aiJs = ctx.get.id !== undefined && entry.ai_job_id !== null ? `
	let progressCont = G('#progress-cont'), progressBar = progressCont.progress({ type: 'circular' }), progressBarType = 'indeterminate', progress = 10,
		aiStatusEl = document.getElementById('ai-status'), formBtn = document.querySelector('form.ajax button[type="submit"]');
	formBtn.disabled = true;
	const jobCheck = setInterval(() => {
		if(progressBarType == 'indeterminate'){ progressBarType = 'determinate'; progressCont[0].innerHTML = ''; progressBar = progressCont.progress({ type: 'circular', process: progressBarType, startingProgress: progress }); }
		G.ajax({ url: 'inc/ai_jobs', type: 'POST', data: { action: 'job_status', job_id: '${esc(entry.ai_job_id)}' } }).then(data => {
			const response = JSON.parse(data.responseText);
			if(['not_found', 'done', 'failed'].includes(response.status)){
				clearInterval(jobCheck);
				if(response.status == 'done'){ aiStatusEl.textContent = 'Processing'; progress = 95; }
				G.ajax({ type: 'POST', data: { action: 'job-done' } }).then(data => {
					if(data.responseText.length){
						aiStatusEl.textContent = 'Invoice scanned'; progress = 100;
						const fieldsCont = document.getElementById('form-fields-cont');
						fieldsCont.innerHTML = data.responseText; initInputs(fieldsCont);
						setTimeout(function() { progressCont[0].innerHTML = '<span class="material-icons">check_circle</span>'; }, 500);
					} else {
						G.dialog({ title: 'Something went wrong', description: 'Please save your form and refresh the page. If issue persists, contact your superior', dismissiveAction: { text: 'Close' } });
					}
					formBtn.disabled = false;
				}).catch(xhr => { console.log('Failed', xhr); G.snackbar('An error occurred.'); });
			} else if(response.status == 'extracting_data'){ aiStatusEl.textContent = 'Reading contents'; progress += 5; }
			if(response.status != 'done' && progress > 90) progress = 90;
			progressBar[0].dataset.progress = progress; progressBar.progress('update');
		}).catch(xhr => {});
	}, 3000);
	EventBus.subscribe('grn-register-entry', 'out', () => { clearInterval(jobCheck); EventBus.unsubscribe('grn-register-entry'); });` : '';

  return {
    metaTitle: pageTitle, pageTitle, metaDescription: '',
    css: '<style type="text/css">#ai-tracker .content{ display: flex; gap: 1rem; } #progress-cont .material-icons{ font-size: 2.7rem; color: var(--success-color); }</style>',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>`,
    js: `<script type="module">
	import { initInputs, processAjaxForm, initAjaxForms } from './js/functions.mjs?v=${V}';
	initInputs(); G('.file-drop').fileDrop(); initAjaxForms();${aiJs}
</script>`,
  };
}
