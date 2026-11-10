import { Ctx, Page, exit } from '@/lib/ctx';
import { date, strtotime, ucfirst } from '@/lib/php';
import { esc } from '@/lib/html';
import { toInt } from '@/lib/functions';
import { P, V, halt } from '@/lib/h';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const csvCell = (v: any) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const days = (r: any) => (r.end_date === null ? 1 : Math.round(((strtotime(r.end_date) as number) - (strtotime(r.start_date) as number)) / 86400) + 1);
const hrs = (r: any) => Math.round((((strtotime(r.time_in) as number) - (strtotime(r.time_out) as number)) / 3600) * 10) / 10;

export default async function (ctx: Ctx): Promise<Page> {
  const { db } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'jobs') < 3) halt('You do not have access to this item.');
  let title = 'Leave Reports', year = 0, month = 0, leaves: any[] = [], passes: any[] = [];
  if (ctx.get.y !== undefined && ctx.get.m !== undefined) {
    year = toInt(ctx.get.y); month = toInt(ctx.get.m);
    leaves = await db.selectAll("SELECT u.name, start_date, end_date FROM leave_applications la JOIN users u ON la.user = u.id WHERE type = 'regular' AND la.status = 2 AND YEAR(start_date) = ? AND MONTH(start_date) = ? ORDER BY user, start_date", [year, month]);
    passes = await db.selectAll("SELECT u.name, reason_type, time_out, time_in FROM leave_applications la JOIN users u ON la.user = u.id WHERE type = 'gate_pass' AND la.status = 2 AND YEAR(start_date) = ? AND MONTH(start_date) = ? AND time_in IS NOT NULL ORDER BY user, start_date", [year, month]);
    if (ctx.get.export !== undefined) {
      let lines: any[][], name: string;
      if (ctx.get.export === 'leaves') { name = `Leave-Report-${month}-${year}.csv`; lines = [['Employee', 'Leave Date', 'Return Date', 'Duration (days)'], ...leaves.map((r) => [r.name, r.start_date, r.end_date, days(r)])]; }
      else { name = `Gate-Pass-Report-${month}-${year}.csv`; lines = [['Employee', 'Reason Type', 'Date', 'Leave Time', 'Return Time', 'Duration (hrs)'], ...passes.map((r) => [r.name, ucfirst(r.reason_type ?? ''), date('Y-m-d', strtotime(r.time_out) as number), date('H:i', strtotime(r.time_out) as number), date('H:i', strtotime(r.time_in) as number), hrs(r)])]; }
      return exit(new Response(lines.map((l) => l.map(csvCell).join(',')).join('\n') + '\n', { headers: { 'content-type': 'application/csv', 'content-disposition': `attachment; filename="${name}"` } }));
    }
    title = `${MONTHS[month - 1]} ${year}`;
    ctx.S['current-page'] = `leave-reports?y=${year}&m=${month}`;
  } else ctx.S['current-page'] = 'leave-reports';
  const cur = ctx.S['current-page'];

  let body = '';
  if (!year) {
    const rows = await db.selectAll('SELECT YEAR(start_date) as year, MONTH(start_date) as month FROM leave_applications WHERE status = 2 GROUP BY year, month ORDER BY start_date DESC');
    let last: any = null;
    body = '<ul class="list link-list dividers">';
    for (const r of rows) {
      if (last === null || last != r.year) { body += `<li class="primary-color"><h3 class="no-margin"><span class="material-icons">calendar_month</span>&emsp;${r.year}</h3></li>`; last = r.year; }
      body += `<li data-url="leave-reports?y=${r.year}&m=${r.month}">${MONTHS[r.month - 1]}</li>`;
    }
    body += '</ul>';
  } else {
    if (leaves.length) body += `<h2>Leaves</h2><div class="responsive-table"><table class="h-borders"><thead><tr><th>Employee</th><th>Leave Date</th><th>Return Date</th><th>Duration (Days)</th></tr></thead><tbody>${leaves.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.start_date)}</td><td>${esc(r.end_date)}</td><td>${days(r)}</td></tr>`).join('')}</tbody></table></div>
		<p class="mt1"><a href="${cur}&export=leaves" class="btn text" download><span class="material-icons">download</span> Export</a></p>`;
    if (passes.length) body += `<h2 class="mt2">Gate Passes</h2><div class="responsive-table"><table class="h-borders"><thead><tr><th>Employee</th><th>Reason Type</th><th>Date</th><th>Leave Time</th><th>Return Time</th><th>Duration (Hrs)</th></tr></thead><tbody>${passes.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(ucfirst(r.reason_type ?? ''))}</td><td>${date('Y-m-d', strtotime(r.time_out) as number)}</td><td>${date('h:i a', strtotime(r.time_out) as number)}</td><td>${date('h:i a', strtotime(r.time_in) as number)}</td><td>${hrs(r)}</td></tr>`).join('')}</tbody></table></div>
		<p class="mt1"><a href="${cur}&export=gate" class="btn tonal" download><span class="material-icons">download</span> Export</a></p>`;
  }
  return {
    metaTitle: title, pageTitle: title, metaDescription: '',
    content: `<section><div class="container"><div id="global-msg-cont"></div>${body}</div></section>`,
    js: `<script type="module">import { initLinksList } from './js/functions.mjs?v=${V}'; initLinksList();</script>`,
  };
}
