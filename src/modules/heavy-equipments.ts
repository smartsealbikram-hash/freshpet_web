import { Ctx, Page } from '@/lib/ctx';
import { heavyEquipmentStatus } from '@/lib/config';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { noData } from '@/lib/functions';
import { P, V, halt } from '@/lib/h';

export const duration = (m: number) => (m > 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`);

export default async function (ctx: Ctx): Promise<Page> {
  if (!ctx.isLoggedIn) ctx.account.logout();
  const level = P(ctx, 'heavy_equipment');
  if (level === 0) halt('You do not have access to this item.');
  const page: Page = { metaTitle: 'Heavy Equipment', pageTitle: 'Heavy Equipment', metaDescription: '' };
  if (P(ctx, 'store_reports') > 0) page.subTitle = '<a href="heavy-equipments-reports" class="btn outline small"><span class="material-icons left-icon">area_chart</span> View Reports</a>';
  let q = 'SELECT * FROM heavy_equipment_requests';
  const a: any[] = [];
  if (level === 2) { q += ' WHERE created_by = ?'; a.push(ctx.S.user.id); }
  q += ' ORDER BY id DESC';
  const rows = await ctx.db.selectAll(q, a);
  const body = rows.length
    ? `<ul class="list three-line dividers right-assist link-list">${rows.map((r: any) => `<li data-url="heavy-equipment?id=${r.id}"><div class="content"><p class="headline">#${esc(r.display_id)}</p><p>${esc(r.equipment)} - ${duration(r.work_duration)}<br><small>${date('d M Y h:i A', strtotime(r.date_requested) as number)}</small></p></div><div class="right-assist"><span class="badge status-${r.status >= 2 ? '2' : r.status}">${heavyEquipmentStatus[r.status]}</span></div></li>`).join('')}</ul>`
    : noData('Equipment requests');
  page.content = `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>
${level === 2 ? '<div class="fab-cont"><a href="heavy-equipment" class="fab extended"><span class="material-icons">add</span> Add New</a></div>' : ''}`;
  page.js = `<script type="module">import { initLinksList } from './js/functions.mjs?v=${V}'; initLinksList();</script>`;
  return page;
}
