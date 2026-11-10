import { Ctx, Page, exit } from '@/lib/ctx';
import { date, number_format, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { noData, sanitize, toInt } from '@/lib/functions';
import { P, V, halt } from '@/lib/h';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pct = (a: any, b: any) => (Number(b) ? Math.round((Number(a) / Number(b)) * 100) : 0);

export default async function (ctx: Ctx): Promise<Page> {
  const { db } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'production_reports') === 0) halt('You do not have access to this item.');
  let title = 'Shift Incharge Reports', type = 'all', userId = 0, year = 0, month = 0;
  if (ctx.get.u !== undefined) {
    userId = toInt(ctx.get.u);
    const u: any = await db.selectOne('SELECT name FROM users WHERE id = ? AND status > 0', [userId]);
    if (!u) return exit(new Response(null, { status: 302, headers: { location: 'shift-incharge-reports' } }));
    title = u.name;
    if (ctx.get.y !== undefined) { year = toInt(ctx.get.y); if (ctx.get.m !== undefined) { month = toInt(ctx.get.m); type = 'days'; } else type = 'months'; }
    else if (ctx.get.d !== undefined) type = 'shifts';
    else type = 'years';
  }
  const list = (items: string, cls = 'list dividers right-assist link-list') => `<ul class="${cls}">${items}</ul>`;
  const row = (url: string, left: string, right: string) => `<li data-url="${url}"><div class="content">${left}</div><div class="right-assist">${right}</div></li>`;
  let body = '';

  if (type === 'shifts') {
    const d = sanitize(ctx.get.d);
    body += `<h3>${date('d M Y', strtotime(ctx.get.d) as number)}</h3><p class="mtn1 mb2 neutral-color-2">${esc(ctx.get.ef)}% efficiency</p>`;
    const logs = await db.selectAll('SELECT instance_id, shift, plt.lot_id FROM production_logs pl JOIN production_instances pi ON pl.instance_id = pi.id JOIN production_lots plt ON pi.lot_id = plt.id WHERE pl.created_by = ? AND pl.shift_date = ? AND production IS NOT NULL', [userId, d]);
    body += list(logs.map((r: any) => `<li data-url="production-logs?ins=${r.instance_id}&date=${esc(d)}"><div class="content">${esc(r.lot_id)} - ${esc(r.shift)}</div></li>`).join(''), 'list dividers link-list');
  } else if (type === 'days') {
    body += `<h3>${MONTHS[month - 1]} ${year}</h3>`;
    const mm = String(month).padStart(2, '0');
    const logs = await db.selectAll('SELECT shift_date, SUM(expected_production) as expected_production, SUM(production) as production FROM production_logs WHERE created_by = ? AND shift_date >= ? AND shift_date <= ? AND production IS NOT NULL GROUP BY shift_date ORDER BY shift_date', [userId, `${year}-${mm}-01`, `${year}-${mm}-31`]);
    body += logs.length ? list(logs.map((r: any) => { const ef = pct(r.production, r.expected_production); return row(`shift-incharge-reports?u=${userId}&d=${r.shift_date}&ef=${ef}`, String(r.shift_date).split('-')[2], `${Math.round(r.production)}/${Math.round(r.expected_production)} kg (${ef}%)`); }).join('')) : noData('Reports');
  } else if (type === 'months') {
    body += `<h3>Financial year ${year}</h3>`;
    const logs = await db.selectAll('SELECT MONTH(shift_date) as month, SUM(expected_production) as expected_production, SUM(production) as production FROM production_logs WHERE created_by = ? AND shift_date >= ? AND shift_date <= ? AND production IS NOT NULL GROUP BY month ORDER BY FIELD(month, 4,5,6,7,8,9,10,11,12,1,2,3)', [userId, `${year}-04-01`, `${year + 1}-03-31`]);
    body += logs.length ? list(logs.map((r: any) => row(`shift-incharge-reports?u=${userId}&y=${r.month <= 3 ? year + 1 : year}&m=${r.month}`, MONTHS[r.month - 1], `${number_format(r.production)}/${number_format(r.expected_production ?? 0)} kg (${pct(r.production, r.expected_production)}%)`)).join('')) : noData('Reports');
  } else if (type === 'years') {
    const logs = await db.selectAll('SELECT CASE WHEN MONTH(shift_date) <= 3 THEN YEAR(shift_date)-1 ELSE YEAR(shift_date) END AS `year`, SUM(expected_production) as expected_production, SUM(production) as production FROM production_logs WHERE created_by = ? AND production IS NOT NULL GROUP BY `year` ORDER BY `year` DESC', [userId]);
    body += logs.length ? list(logs.map((r: any) => row(`shift-incharge-reports?u=${userId}&y=${r.year}`, String(r.year), `${number_format(r.production)}/${number_format(r.expected_production)} kg (${pct(r.production, r.expected_production)}%)`)).join('')) : noData('Reports');
  } else {
    let items = '';
    for (const u of await db.selectAll('SELECT id, name FROM users WHERE (role = 13 or role = 18) AND status = 2')) {
      const l: any = await db.selectOne('SELECT SUM(CASE WHEN end_hour - start_hour <= 0 THEN end_hour - start_hour + 24 ELSE end_hour - start_hour END) as total_hrs, SUM(breakdown_time) as breakdown_hrs FROM production_logs WHERE created_by = ? AND shift_date >= CURDATE() - INTERVAL 1 MONTH AND production IS NOT NULL', [u.id]);
      const ef = l.total_hrs > 0 ? Math.round(((l.total_hrs - l.breakdown_hrs) / l.total_hrs) * 100) + '%' : '';
      items += row(`shift-incharge-reports?u=${u.id}`, esc(u.name), ef);
    }
    body = list(items);
  }
  return {
    metaTitle: title, pageTitle: title, metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>`,
    js: `<script type="module">import { initLinksList } from './js/functions.mjs?v=${V}'; initLinksList();</script>`,
  };
}
