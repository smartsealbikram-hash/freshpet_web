import { Ctx, Page } from '@/lib/ctx';
import { jobInterviewStatusLegend, standardStatusLegend } from '@/lib/config';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { toInt } from '@/lib/functions';
import { P, V, halt, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'jobs') === 0) halt('You do not have access to this item.');
  if (ctx.get.id === undefined) notFound();
  const id = toInt(ctx.get.id);
  const s: any = await db.selectOne('SELECT u.status, u.name, phone, email, u.date_created, sr.name as role FROM users u JOIN staff_roles sr ON u.role = sr.id WHERE u.status > 0 AND access_level = 3 AND u.id = ?', [id]);
  if (!s) notFound();
  const ints = await db.selectAll('SELECT ji.id, ji.status, sr.name as role, location, ji.date_created FROM job_interviews ji JOIN job_vacancies jv ON job_vacancy = jv.id LEFT JOIN staff_roles sr ON jv.staff_role = sr.id WHERE user = ? ORDER BY ji.id DESC', [id]);
  return {
    metaTitle: s.name, pageTitle: s.name, metaDescription: '',
    content: `<div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8">
	<section><div id="global-msg-cont"></div><dl class="horizontal"><dt>Name</dt><dd>${esc(s.name)}</dd><dt>Role</dt><dd>${esc(s.role)}</dd><dt>Phone</dt><dd>${esc(s.phone)}</dd><dt>Email</dt><dd>${esc(s.email)}</dd>
	<dt>Status</dt><dd>${standardStatusLegend[s.status]}</dd><dt>Date Created</dt><dd>${date('d M Y h:i A', strtotime(s.date_created) as number)}</dd></dl></section>
	<section>${ints.length ? `<h2>Interviews</h2><ul class="list two-line edged link-list right-assist">${ints.map((r: any) => `<li data-url="interview?id=${r.id}"><div class="content"><p class="headline">${esc(r.role)}</p><p class="helper-text">${date('d M Y', strtotime(r.date_created) as number)} • ${esc(r.location)}</p></div><div class="right-assist"><span class="chip">${jobInterviewStatusLegend[r.status]}</span></div></li>`).join('')}</ul>` : ''}</section>
</div></div></div>`,
    js: `<script type="module">import { initLinksList } from './js/functions.mjs?v=${V}'; initLinksList();</script>`,
  };
}
