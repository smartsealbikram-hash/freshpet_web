import { Ctx, Page } from '@/lib/ctx';
import { number_format } from '@/lib/php';
import { esc } from '@/lib/html';
import { noData } from '@/lib/functions';
import { P, V, halt } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  if (!ctx.isLoggedIn) ctx.account.logout();
  const level = P(ctx, 'jobs');
  if (level === 0) halt('You do not have access to this item.');
  const rows = await ctx.db.selectAll('SELECT jv.id, status, sr.name, ctc, l.name as location FROM job_vacancies jv JOIN staff_roles sr ON jv.staff_role = sr.id JOIN locations l ON jv.location = l.id ORDER BY status DESC, jv.id DESC');
  const st: Record<number, string> = { 1: 'Inactive', 2: 'Active' };
  const body = rows.length
    ? `<ul class="list two-line dividers right-assist link-list">${rows.map((r: any) => `<li data-url="job-vacancy?id=${r.id}"><div class="content"><p class="no-margin">${esc(r.name)}<br>CTC: ₹${number_format(r.ctc)} | ${esc(r.location)}</p></div><div class="right-assisst"><span class="badge status-${r.status}">${st[r.status]}</span></div></li>`).join('')}</ul>`
    : noData('Job vacancies');
  return {
    metaTitle: 'Job Vacancies', pageTitle: 'Job Vacancies', metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>
${level >= 2 ? '<div class="fab-cont"><a href="manage-job-vacancy" class="fab extended"><span class="material-icons">add</span> Add New</a></div>' : ''}`,
    js: `<script type="module">import { initLinksList } from './js/functions.mjs?v=${V}'; initLinksList();</script>`,
  };
}
