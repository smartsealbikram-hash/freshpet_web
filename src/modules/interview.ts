import path from 'path';
import { putFile, uniqueName } from '@/lib/storage';
import { Ctx, Page, exit, jsonExit } from '@/lib/ctx';
import { jobInterviewStatusLegend } from '@/lib/config';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { Account } from '@/lib/account';
import { calculateSalary, compare, generatePassword, getApprovals, notifyForApproval, sanitize, sendmail, STORAGE_DIR, toInt, uploadImage } from '@/lib/functions';
import { P, SITE_URL, V, arr, halt, msgWarn, nl2br, notFound } from '@/lib/h';
import { env } from '@/lib/env';
import { createHash } from 'crypto';
import { makeDocument } from '@/lib/jobDocs';
import { htmlToPdf, pdfResponse, PdfUnavailable } from '@/lib/pdf';
import type { UploadedFile } from '@/lib/ctx';

const NEEDED = 2;
const ALLOWED = ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/pdf'];

async function handleDocUpload(file: UploadedFile | undefined, location: string): Promise<{ filename?: string; error?: string }> {
  if (!file || !file.size || !ALLOWED.includes(file.type)) return { error: 'Please select a valid file of type <strong>.pdf or .docx</strong>' };
  const safe = file.name.toLowerCase().replace(/[^a-zA-Z0-9.-]+/g, '-');
  const parts = safe.split('.');
  const ext = parts.pop() as string;
  const base = parts.join('.');
  const newName = await uniqueName(location, base, ext);
  await putFile(location.replace(/\/+$/, '') + '/' + newName, file.buffer);
  return { filename: '/' + location + newName };
}

const baseName = (p: string) => p.split('/').pop();

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'jobs') < 2) halt('You do not have access to this item.');

  let pageTitle = 'Add Candidate', id = 0, iv: any, vacancy: any, approvals: any;

  if (post.name !== undefined) {
    const status = toInt(post.status);
    const p: any = { name: sanitize(post.name), father_name: sanitize(post.father_name), phone: sanitize(post.phone, 'number'), email: sanitize(post.email, 'email'), address: sanitize(post.address), remarks: sanitize(post.remarks), status };
    if (post.basic_salary) for (const k of ['basic_salary', 'hra', 'ta', 'sa', 'pf', 'esi', 'tds', 'le', 'cpf', 'cesi']) p[k] = post[k] ? sanitize(post[k], 'number') : 0;
    if (post.date_joining) p.date_joining = sanitize(post.date_joining);
    if (post.date_sign_offer) p.date_sign_offer = sanitize(post.date_sign_offer);
    let r: any = {};
    try {
      if (ctx.get.id !== undefined) { id = toInt(ctx.get.id); await db.update('job_interviews', p, 'id = ?', [id]); }
      else { p.job_vacancy = toInt(ctx.get.j); p.created_by = ctx.userId; p.date_created = now; id = await db.insert('job_interviews', p); }
      const loc = `docs/jobs/${id}/`;
      const up: any = {};
      const photo = ctx.files.photo?.[0];
      if (photo && photo.size) {
        const u = await uploadImage(ctx, [photo], loc, { maxSize: 150 });
        if (!u) { const m = S.msg?.content; delete S.msg; return jsonExit({ error: m }); }
        up.photo = '/' + u[0].path;
      }
      const resume = ctx.files.resume?.[0];
      if (resume && resume.size) {
        const rs = await handleDocUpload(resume, loc);
        if (rs.error) throw new Error(rs.error);
        up.resume = rs.filename;
      }
      if (Object.keys(up).length) await db.update('job_interviews', up, 'id = ?', [id]);
      if (post.old_status != status && status === 3)
        await notifyForApproval(ctx, 'jobs', 'Candidate selected for job', 'Approve/Reject the candidate to hire. Tap to view details.', `${SITE_URL}/interview?id=${id}`);
      r = { action: 'goback' };
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  } else if (post.offer_letter_remarks !== undefined) {
    let r: any = {};
    try {
      const ol = await handleDocUpload(ctx.files.offer_letter?.[0], `docs/jobs/${toInt(ctx.get.id)}/`);
      if (ol.error) throw new Error(ol.error);
      const p: any = { offer_letter: ol.filename, status: 4 };
      if (post.offer_letter_remarks) p.offer_letter_remarks = sanitize(post.offer_letter_remarks);
      id = toInt(ctx.get.id);
      await db.update('job_interviews', p, 'id = ?', [id]);
      const i: any = await db.selectOne('SELECT job_vacancy FROM job_interviews WHERE id = ?', [id]);
      await db.update('job_vacancies', { status: 1 }, 'id = ?', [i.job_vacancy]);
      r = { action: 'refresh' };
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  } else if (ctx.get.id !== undefined) {
    id = toInt(ctx.get.id);
    iv = await db.selectOne('SELECT * FROM job_interviews WHERE id = ?', [id]);
    if (!iv) notFound();
    pageTitle = 'Edit Candidate';
    S['current-page'] = `${SITE_URL}/interview?id=${id}`;
    vacancy = await db.selectOne('SELECT jv.staff_role, sr.name as role_name, location, l.name as location_name, d.name as department FROM job_vacancies jv JOIN staff_roles sr ON jv.staff_role = sr.id JOIN departments d ON sr.department = d.id JOIN locations l ON jv.location = l.id WHERE jv.id = ?', [iv.job_vacancy]);
    approvals = await getApprovals(ctx, 'job_interviews', id, NEEDED);

    if (post['create-account'] !== undefined) {
      const belongings = post.belongings ? sanitize(arr(post.belongings).join(',')) : '';
      let r: any = {};
      try {
        const staff = new Account(ctx);
        const password = generatePassword();
        const hash = createHash('sha512').update(password + env.SECRET_KEY).digest('hex');
        // Account::createProfile
        const existing: any = await db.selectOne('SELECT id, access_level FROM users WHERE status > 0 AND ' + (iv.email ? 'email = ?' : 'phone = ?'), [iv.email || iv.phone]);
        const profile: any = { status: 2, location: vacancy.location, access_level: 3, role: vacancy.staff_role, name: iv.name, phone: iv.phone, email: iv.email, password: hash, settings: JSON.stringify({ theme: 'light', themeDefault: 1, belongings }), date_created: now };
        if (existing) {
          if (existing.access_level >= 2) throw new Error('You are already registered. Please proceed to login.');
          staff.id = existing.id; await db.update('users', profile, 'id = ?', [existing.id]);
        } else {
          staff.id = await db.insert('users', profile);
          for (const c of await db.selectAll('SELECT * FROM comm_types WHERE default_value = 1'))
            await db.insert('comm_settings', { user: staff.id, comm: c.id, email_enabled: 1, sms_enabled: 1, push_enabled: 1 });
        }
        await db.update('job_interviews', { status: 5, user: staff.id }, 'id = ?', [id]);
        r = { message: { type: 'dialog', content: `Account created. ${iv.name} can now login with their phone number` } };
      } catch (e) { r = msgWarn(e); }
      return jsonExit(r);
    } else if (post.action !== undefined) {
      let r: any = {};
      if (post.action === 'layoff') {
        try {
          await db.update('job_interviews', { status: 6, date_fired: now, fired_by: ctx.userId, performance: sanitize(post.performance) }, 'id = ?', [id]);
          await db.update('users', { status: 1 }, 'phone = ?', [iv.phone]);
        } catch (e) { r = msgWarn(e); }
      } else if (post.action === 'cancel-interview') {
        try { await db.run('UPDATE job_interviews SET status = 0, remarks = CONCAT(IFNULL(remarks, \'\'), ?) WHERE id = ?', ['\n' + sanitize(post.remarks), id]); } catch (e) { r = msgWarn(e); }
      } else if (post.action === 'email-doc') {
        const fileType = post.id;
        try {
          const doc = makeDocument(fileType, vacancy, iv);
          const buf = await htmlToPdf(doc.html);
          const loc = `docs/jobs/${id}/`;
          await putFile(loc + doc.name, buf);
          await sendmail(iv.email, `${fileType.charAt(0).toUpperCase() + fileType.slice(1)} for your job at FreshPet`, {
            text: `<p>Hello ${esc(iv.name)},</p><p>Your ${fileType} is attached to this mail.</p><p>Regards,<br>Human Resources<br>${env.SITE_NAME}</p>`,
            attachment: { name: doc.name, buffer: buf },
          }, 'hr@freshpet.in,Freshpet HR');
          r = { message: { type: 'snackbar', content: `${fileType.charAt(0).toUpperCase() + fileType.slice(1)} sent at ${iv.email}` } };
        } catch (e: any) { r = e instanceof PdfUnavailable ? msgWarn(e) : msgWarn(e); }
      }
      return jsonExit(r);
    }
    if (ctx.get.download !== undefined) {
      const fileType = String(ctx.get.download).replace(/_/g, ' ');
      const doc = makeDocument(fileType, vacancy, iv);
      let pdf: Buffer;
      try { pdf = await htmlToPdf(doc.html); }
      catch (e: any) { return exit(new Response(String(e?.message ?? 'PDF generation failed'), { status: 501 })); }
      return exit(pdfResponse(pdf, doc.name));
    }
  }

  // ------------------------------------------------------------------ view
  const fmtD = (x: any) => date('d M Y', strtotime(x) as number);
  let inner: string;
  if (approvals && (approvals.approved > 0 || approvals.rejected > 0)) {
    const s = calculateSalary(iv);
    const nf = (v: number) => v.toLocaleString('en-US');
    const link = (p: string) => `<a href="${SITE_URL}${esc(p)}">${esc(baseName(p))}</a>`;
    const row = (l: string, v: any) => `<tr><td>${l}</td><td><strong>₹${esc(v)}</strong></td></tr>`;
    const dlBlock = (title: string, key: string, label: string) => `<h3 class="mt2">${title}</h3><div class="row"><div class="col xs6"><a href="${S['current-page']}&download=${key}" class="btn tonal full-width" download><span class="material-icons">download</span> Download</a></div><div class="col xs6"><button type="button" class="btn tonal full-width send-action" data-action="email-doc" data-id="${label}"><span class="material-icons">mail</span> Email</button></div></div>`;
    inner = `<div class="col xs12 s10 m8"><dl class="horizontal">
		<dt>Candidate's Name</dt><dd>${esc(iv.name)}</dd><dt>Father's Name</dt><dd>${esc(iv.father_name)}</dd><dt>Phone</dt><dd>${esc(iv.phone)}</dd><dt>Email</dt><dd>${esc(iv.email || 'NA')}</dd><dt>Address</dt><dd>${esc(iv.address)}</dd>
		<dt>Photo</dt><dd>${iv.photo ? `<img src="${SITE_URL}${esc(iv.photo)}" class="max150 expandable">` : ''}</dd>
		<dt>Résumé</dt><dd>${iv.resume ? link(iv.resume) : ''}</dd><dt>Remarks</dt><dd>${iv.remarks ? nl2br(iv.remarks) : 'NA'}</dd>
		${iv.offer_letter ? `<dt>Offer Letter</dt><dd>${link(iv.offer_letter)}<br>${esc(iv.offer_letter_remarks)}</dd>` : ''}
		<dt>Status</dt><dd>${jobInterviewStatusLegend[iv.status]}</dd></dl><hr>
		<dl class="horizontal"><dt>Date created</dt><dd>${fmtD(iv.date_created)}</dd>${iv.date_joining !== null ? `<dt>Joining Date</dt><dd>${fmtD(iv.date_joining)}</dd>` : ''}${iv.date_fired !== null ? `<dt>Layoff Date</dt><dd>${fmtD(iv.date_fired)}</dd>` : ''}</dl>
		<h3 class="mt2">Salary Structure</h3><table class="h-borders mb2"><tbody>
		${row('Basic Salary', iv.basic_salary)}${row('House Rent Allowance', iv.hra)}${row('Transport Allowance', iv.ta)}${row('Special Allowance', iv.sa)}
		<tr class="primary-container-bg"><td>Gross</td><td><strong>${nf(s.gross)}</strong></td></tr>
		${row('Provident Fund', iv.pf)}${row("Employee's State Insurance", iv.esi)}${row('Tax Deducted at Source', iv.tds)}
		<tr class="primary-container-bg"><td>Total Deductions</td><td><strong>₹${nf(s.deductions)}</strong></td></tr>
		${row('Leave Encashment', iv.le)}${row('Company PF', iv.cpf)}${row('Company ESI', iv.cesi)}
		<tr class="primary-container-bg"><td>Annual CTC</td><td><strong>₹${nf(s.ctcAnnual)}</strong></td></tr></tbody></table>
		${approvals.html}
		${approvals.approved == NEEDED ? `${dlBlock('Offer Letter', 'offer_letter', 'offer letter')}
		${iv.status == 3 ? `<form method="post" class="card flat ajax mt1 confirm" data-msg="Uploading offer letter will mark this candidate as hired and this vacancy will be deactivated."><div class="content">
			<div class="file-input sidelabel"><input type="file" name="offer_letter" required><label>Upload Offer Letter</label><button type="button" class="btn outline small">Select File</button><span class="file-name">No file selected</span>
			${iv.offer_letter ? `<span class="helper">${link(iv.offer_letter)}</span>` : '<span class="helper">Upload signed copy of offer letter from the candidate</span>'}</div>
			<div class="input-field sidelabel"><textarea name="offer_letter_remarks" maxlength="500" rows="4">${esc(iv.offer_letter_remarks ?? '')}</textarea><label>Offer Letter Remarks</label></div>
			<button type="submit" class="btn filled">Upload</button></div></form>` : ''}
		${dlBlock('Joining Letter', 'joining_letter', 'joining letter')}
		${iv.status == 6 ? dlBlock('Relieving Letter', 'relieving_letter', 'relieving letter') : ''}
		<hr><div class="row">
		${iv.status == 4 ? '<div class="col xs12 s6"><button type="button" class="btn filled full-width" id="create-account"><span class="material-icons left-icon">badge</span> Create Staff Account</button></div>' : ''}
		${iv.status == 3 || iv.status == 4 ? '<div class="col xs12 s6"><button type="button" class="btn outline error-color full-width" id="cancel-interview"><span class="material-icons left-icon">cancel</span> Cancel Hiring</button></div>' : ''}
		${iv.status == 5 ? '<div class="col xs12 s6"><button type="button" class="btn outline error-color full-width" id="layoff-employee"><span class="material-icons left-icon">person_remove</span> Layoff Employee</button></div>' : ''}
		</div>` : ''}</div>`;
  } else {
    const hasId = ctx.get.id !== undefined;
    const sal = iv ? calculateSalary(iv) : null;
    const fld = (n: string, label: string, req = false, min = true) => `<div class="input-field sidelabel"><input type="number" name="${n}" ${min ? 'min="0" ' : ''}value="${esc(iv?.[n] ?? '')}"${req ? ' data-required="true"' : ''}><label>${label}</label></div>`;
    const txt = (n: string, label: string, type = 'text', extra = '') => `<div class="input-field sidelabel"><input type="${type}" name="${n}" ${extra} value="${esc(iv?.[n] ?? '')}"${n === 'name' || n === 'father_name' || n === 'phone' ? ' required' : ''}><label>${label}</label></div>`;
    const fname = (p: string | undefined) => (p ? `<span class="helper">${`<a href="${SITE_URL}${esc(p)}">${esc(baseName(p))}</a>`}</span>` : '');
    inner = `<form method="post" enctype="multipart/form-data" class="col xs12 s10 m8 ajax">
		${txt('name', "Candidate's Name")}${txt('father_name', "Father's Name")}${txt('phone', 'Phone Number', 'tel', 'minlength="10"')}${txt('email', 'Email', 'email')}${txt('address', 'Address')}
		<div class="file-input sidelabel">${iv?.photo ? `<img src="${SITE_URL}${esc(iv.photo)}" class="upload-sideimage expandable">` : ''}<input type="file" name="photo"><label>Photo</label><button type="button" class="btn outline small">Select File</button><span class="file-name">No file selected</span></div>
		<div class="file-input sidelabel"><input type="file" name="resume" ${hasId ? '' : 'required'}><label>Résumé</label><button type="button" class="btn outline small">Select File</button><span class="file-name">No file selected</span>${fname(iv?.resume)}</div>
		<div class="input-field sidelabel"><textarea name="remarks" maxlength="500" rows="4">${esc(iv?.remarks ?? '')}</textarea><label for="remarks">Remarks</label></div>
		${!(iv && iv.status >= 3)
        ? `<input type="number" name="old_status" value="${esc(iv?.status ?? '')}" hidden><div class="input-field sidelabel"><select name="status" required><option></option>
			${Object.entries(jobInterviewStatusLegend).filter(([k]) => (hasId && +k <= 3) || (!hasId && +k <= 2)).map(([k, v]) => `<option value="${k}"${compare(+k, iv?.status ?? '', ' selected')}>${v}</option>`).join('')}</select><label>Status</label></div>`
        : `<div class="faux-sidelabel"><p class="label">Status</p><div class="inputs"><strong>${jobInterviewStatusLegend[iv.status]}</strong></div></div>`}
		<div class="status-fields${iv && iv.status >= 3 ? '' : ' hide'}" data-min-status="3"><hr class="mt2"><h3 class="mt1">Salary Structure</h3>
			${fld('basic_salary', 'Basic Salary', true)}${fld('hra', 'House Rent Allowance', true)}${fld('ta', 'Transport Allowance')}${fld('sa', 'Special Allowance')}
			<p class="mb2">Gross: <strong>₹<span id="gross-salary">${sal ? sal.gross.toLocaleString('en-US') : ''}</span></strong></p>
			${fld('pf', 'Provident Fund', true)}${fld('esi', "Employee's State Insurance", true)}${fld('tds', 'Tax Deducted at Source')}
			<p>Total Deductions: <strong>₹<span id="total-deductions">${(sal?.deductions ?? 0).toLocaleString('en-US')}</span></strong></p><p>Following fields take annual values</p>
			${fld('le', 'Leave Encashment')}${fld('cpf', 'Company PF')}${fld('cesi', 'Company ESI')}
			<p>Annual CTC: <strong>₹<span id="annual-ctc">${(sal?.ctcAnnual ?? 0).toLocaleString('en-US')}</span></strong></p>
			<hr class="mt2"><h3 class="mt1 mb1">Hiring Information</h3>
			<div class="input-field sidelabel"><input type="text" name="date_joining" class="datepicker" value="${esc(iv?.date_joining ?? '')}" data-required="true"><label>Date of Joining</label></div>
			<div class="input-field sidelabel"><input type="text" name="date_sign_offer" value="${esc(iv?.date_sign_offer ?? '')}" data-required="true"><label>Sign Offer Letter By Date</label></div></div>
		${iv && iv.status >= 3 ? approvals.html : ''}
		<div class="row center-aligned"><div class="col xs12 s8 m6 l4"><button type="submit" class="btn filled full-width">Save</button></div></div></form>`;
  }

  return {
    metaTitle: pageTitle, pageTitle, metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned">${inner}</div></div></section>`,
    js: `<script src="${SITE_URL}/js/gs-richeditor.min.js?v=${V}"></script><script src="${SITE_URL}/js/manage-interview.js?v=${V}" type="module"></script>`,
  };
}
