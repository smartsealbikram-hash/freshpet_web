import { Ctx, Page } from '@/lib/ctx';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { toInt } from '@/lib/functions';
import { P, V, halt } from '@/lib/h';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dur = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr ${m % 60} min`);

export default async function (ctx: Ctx): Promise<Page> {
  const { db } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'store_reports') === 0) halt('You do not have access to this item.');
  let title = 'Heavy Equipments Reports', type = 'all', year = 0, month = 0;
  if (ctx.get.y !== undefined) {
    year = toInt(ctx.get.y); title = String(year);
    if (ctx.get.m !== undefined) { month = toInt(ctx.get.m); title = `${MONTHS[month - 1]} ${year}`; type = 'days'; } else type = 'months';
  }
  const group = (rows: any[], key: string, href: (r: any) => string, label: (r: any) => string) => {
    let out = '', last: any = null;
    for (const r of rows) {
      if (last !== r[key]) {
        if (last !== null) out += '</ul></div></div>';
        out += `<div class="card mb1"><div class="content"><h3><a href="${href(r)}">${label(r)} &gt;</a></h3><ul class="list dividers right-assist">`;
        last = r[key];
      }
      out += `<li><div class="content">${esc(r.equipment)}</div><div class="right-assist">${dur(Number(r.duration))}</div></li>`;
    }
    return out;
  };
  let body = '';
  if (type === 'days') {
    const mm = String(month).padStart(2, '0');
    const rows = await db.selectAll("SELECT id, equipment, reason, work_duration, date_requested FROM heavy_equipment_requests WHERE status = 4 AND DATE(date_requested) >= ? AND DATE(date_requested) <= ? ORDER BY id ASC", [`${year}-${mm}-01`, `${year}-${mm}-31`]);
    if (rows.length) body = `<ul class="list three-line compact dividers right-assist link-list">${rows.map((r: any) => `<li data-url="heavy-equipment?id=${r.id}"><div class="content"><p class="headline">${esc(r.equipment)}</p><p class="helper-text"><small>${date('d M Y h:i A', strtotime(r.date_requested) as number)}<br>${esc(r.reason)}</small></p></div><div class="right-assist">${dur(Number(r.work_duration))}</div></li>`).join('')}</ul>`;
  } else if (type === 'months') {
    const rows = await db.selectAll("SELECT MONTH(date_requested) month, equipment, SUM(work_duration) as duration FROM heavy_equipment_requests WHERE status = 4 AND DATE(date_requested) >= ? AND DATE(date_requested) <= ? GROUP BY month, equipment ORDER BY FIELD(month, 4,5,6,7,8,9,10,11,12,1,2,3)", [`${year}-04-01`, `${year + 1}-03-31`]);
    body = group(rows, 'month', (r) => `heavy-equipments-reports?y=${r.month <= 3 ? year + 1 : year}&m=${r.month}`, (r) => MONTHS[r.month - 1]) + (rows.length ? '</ul></div></div>' : '');
  } else {
    const rows = await db.selectAll('SELECT YEAR(date_requested) year, equipment, SUM(work_duration) as duration FROM heavy_equipment_requests WHERE status = 4 GROUP BY year, equipment ORDER BY year DESC');
    body = group(rows, 'year', (r) => `heavy-equipments-reports?y=${r.year}`, (r) => String(r.year)) + (rows.length ? '</ul></div></div>' : '');
  }
  return {
    metaTitle: title, pageTitle: title, metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>`,
    js: `<script type="module">import { initLinksList } from './js/functions.mjs?v=${V}'; initLinksList();</script>`,
  };
}
