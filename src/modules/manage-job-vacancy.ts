import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { esc } from '@/lib/html';
import { compare, sanitize, toInt } from '@/lib/functions';
import { P, V, halt, msgWarn, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'jobs') < 2) halt('You do not have access to this item.');
  let pageTitle = 'Create Job Vacancy', vacancy: any;

  if (post.staff_role !== undefined) {
    const p: any = { staff_role: toInt(post.staff_role), ctc: sanitize(post.ctc, 'number'), location: toInt(post.location), description: sanitize(post.description, 'none'), status: sanitize(post.status) };
    let r: any = {};
    try {
      if (ctx.get.id !== undefined) {
        const id = toInt(ctx.get.id);
        if (p.status == 1 && (await db.count('job_interviews', 'job_vacancy = ? AND status BETWEEN 1 AND 4', [id])))
          throw new Error('There are active interviews in this job vacancy. Close all candidates before deactivating this.');
        await db.update('job_vacancies', p, 'id = ?', [id]);
        r.action = 'goback';
      } else {
        p.created_by = ctx.userId; p.date_created = now;
        r = { redirect: `job-vacancy?id=${await db.insert('job_vacancies', p)}` };
      }
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  } else if (ctx.get.id !== undefined) {
    vacancy = await db.selectOne('SELECT * FROM job_vacancies WHERE id = ?', [toInt(ctx.get.id)]);
    if (!vacancy) notFound();
    pageTitle = 'Edit Job Vacancy';
  }
  const roles = await db.selectAll('SELECT sr.id, sr.name, d.name as department FROM staff_roles sr JOIN departments d ON sr.department = d.id WHERE d.status = 2 ORDER BY d.name, sr.name');
  return {
    metaTitle: pageTitle, pageTitle, metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><form method="post" class="col xs12 s10 m8 ajax">
	<div class="input-field sidelabel"><select name="staff_role" required><option></option>${roles.map((r: any) => `<option value="${r.id}"${compare(r.id, vacancy?.staff_role ?? '', ' selected')}>${esc(r.department)} &gt; ${esc(r.name)}</option>`).join('')}</select><label>Designation</label></div>
	<div class="input-field sidelabel"><span class="left-assist">₹</span><input type="number" name="ctc" value="${esc(vacancy?.ctc ?? '')}" required><label>CTC</label></div>
	<div class="input-field sidelabel"><select name="location" required><option></option><option value="1"${compare(1, vacancy?.location ?? '', ' selected')}>Haridwar</option><option value="2"${compare(2, vacancy?.location ?? '', ' selected')}>Jammu</option></select><label>Location</label></div>
	<div class="input-field"><label>Description</label><textarea name="description" class="rich-editor" required>${esc(vacancy?.description ?? '')}</textarea></div>
	<div class="input-field sidelabel"><p class="label">Status</p><div class="segmented-control">
		<input type="radio" name="status" id="status-active" value="2" ${compare(2, vacancy?.status ?? '', 'checked')} required><label for="status-active">Active</label>
		<input type="radio" name="status" id="status-inactive" value="1" ${compare(1, vacancy?.status ?? '', 'checked')} required><label for="status-inactive">Inactive</label></div></div>
	<button type="submit" class="btn filled">Save</button><div id="global-msg-cont"></div></form></div></div></section>`,
    js: `<script src="js/gs-richeditor.min.js"></script>
<script type="module">import { initInputs, initAjaxForms } from './js/functions.mjs?v=${V}'; initInputs(); initAjaxForms();</script>`,
  };
}
