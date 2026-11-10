import { Ctx, Page } from '@/lib/ctx';
import { jobInterviewStatusLegend } from '@/lib/config';
import { date, number_format, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { toInt } from '@/lib/functions';
import { P, SITE_URL, V, halt, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'jobs') === 0) halt('You do not have access to this item.');
  if (ctx.get.id === undefined) notFound();
  const id = toInt(ctx.get.id);
  const v: any = await db.selectOne('SELECT jv.*, sr.name as role_name, d.name as department, l.name as location FROM job_vacancies jv JOIN staff_roles sr ON jv.staff_role = sr.id JOIN departments d ON sr.department = d.id JOIN locations l ON jv.location = l.id WHERE jv.id = ?', [id]);
  if (!v) notFound();
  const ints = await db.selectAll('SELECT id, status, name, photo, date_created FROM job_interviews WHERE job_vacancy = ? ORDER BY id DESC', [id]);
  const list = ints.map((r: any) => {
    const pending = r.status >= 1 && r.status <= 4;
    const status = pending ? 'Pending' : jobInterviewStatusLegend[r.status];
    return `<li data-url="interview?id=${r.id}"><img data-src="${esc(SITE_URL + (r.photo ?? ''))}" class="left-assist circle expandable" style="aspect-ratio:1;"><div class="content"><p class="headline">${esc(r.name)}</p><p class="helper-text neutral-color-3"><small>${date('d M Y', strtotime(r.date_created) as number)}</small></p></div><div class="right-assist"><span class="badge status-${pending ? 1 : 2}">${status}</span>${pending ? `<br><small>${jobInterviewStatusLegend[r.status]}</small>` : ''}</div></li>`;
  }).join('');
  return {
    metaTitle: v.role_name, pageTitle: v.role_name, metaDescription: '',
    content: `<div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8">
	<section><div id="global-msg-cont"></div><dl class="horizontal">
		<dt>Department</dt><dd>${esc(v.department)}</dd><dt>CTC</dt><dd>₹${number_format(v.ctc)}</dd><dt>Location</dt><dd>${esc(v.location)}</dd>
		<dt>Description</dt><dd class="wysiwyg-output">${v.description}</dd>
		<dt>Status</dt><dd class="${v.status == 2 ? 'success-color' : 'warning-color'}">${v.status == 2 ? 'Active' : 'Inactive'}</dd></dl>
		${P(ctx, 'jobs') >= 2 ? `<a href="manage-job-vacancy?id=${id}" class="btn outline"><span class="material-icons left-icon">edit</span> Edit Job Vacancy</a>` : ''}</section>
	<section><h2>Interviews</h2>
		${v.status == 2 ? `<a href="interview?j=${id}" class="btn filled full-width"><span class="material-icons left-icon">person_add</span> Add Interview Candidate</a>` : ''}
		${ints.length ? `<ul class="list two-line left-assist right-assist dividers mt1 link-list">${list}</ul>` : ''}</section>
</div></div></div>`,
    js: `<script type="module">import { initLinksList } from './js/functions.mjs?v=${V}'; initLinksList(); G('.expandable').expandableImg();</script>`,
  };
}
