import { Ctx, Page, exit } from '@/lib/ctx';
import { number_format } from '@/lib/php';
import { esc } from '@/lib/html';
import { calculateSalary } from '@/lib/functions';
import { P, SITE_URL, halt } from '@/lib/h';

const COLS = ['Employee', 'Basic Salary', 'HRA', 'TA', 'SA', 'Gross', 'PF', 'ESI', 'TDS', 'Deductions', 'LE', 'C-PF', 'C-ESI', 'Annual CTC'];
const csvCell = (v: any) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export default async function (ctx: Ctx): Promise<Page> {
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'jobs') < 3) halt('You do not have access to this item.');
  ctx.S['current-page'] = `${SITE_URL}/salary-reports`;
  const emps = await ctx.db.selectAll('SELECT ji.* FROM job_interviews ji WHERE ji.status = 5');
  let tg = 0, td = 0, tc = 0;
  const data = emps.map((r: any) => { const s = calculateSalary(r); tg += s.gross; td += s.deductions; tc += s.ctcAnnual; return { r, s }; });

  if (ctx.get.export !== undefined) {
    const lines: any[][] = [COLS];
    for (const { r, s } of data) lines.push([r.name, r.basic_salary, r.hra, r.ta, r.sa, s.gross, r.pf, r.esi, r.tds, s.deductions, r.le, r.cpf, r.cesi, s.ctcAnnual]);
    lines.push(['', '', '', '', '', tg, '', '', '', td, '', '', '', tc]);
    return exit(new Response('﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\n') + '\n', { headers: { 'content-type': 'application/csv', 'content-disposition': 'attachment; filename="salary-report.csv"' } }));
  }
  return {
    metaTitle: 'Salary Reports', pageTitle: 'Salary Reports', metaDescription: '',
    content: `<section><div class="container"><div id="global-msg-cont"></div><div class="responsive-table"><table class="h-borders"><thead><tr>${COLS.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>
	${data.map(({ r, s }) => `<tr><td>${esc(r.name)}</td><td>${esc(r.basic_salary)}</td><td>${esc(r.hra)}</td><td>${esc(r.ta)}</td><td>${esc(r.sa)}</td><td>${s.gross}</td><td>${esc(r.pf)}</td><td>${esc(r.esi)}</td><td>${esc(r.tds)}</td><td>${s.deductions}</td><td>${esc(r.le)}</td><td>${esc(r.cpf)}</td><td>${esc(r.cesi)}</td><td>${number_format(s.ctcAnnual)}</td></tr>`).join('')}
	</tbody><tfoot><tr><th>Total</th><th></th><th></th><th></th><th></th><th>₹${number_format(tg)}</th><th></th><th></th><th></th><th>₹${number_format(td)}</th><th></th><th></th><th></th><th>₹${number_format(tc)}</th></tr></tfoot></table></div>
	<p class="mt1"><a href="salary-reports?export=1" class="btn text"><span class="material-icons left-icon">download</span> Download</a></p></div></section>`,
  };
}
