import { Ctx, Page } from '@/lib/ctx';
import { materialRequestStatusLegend } from '@/lib/config';
import { date, strtotime } from '@/lib/php';
import { noData } from '@/lib/functions';
import { P, V, halt, limited } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  if (!ctx.isLoggedIn) ctx.account.logout();
  const level = P(ctx, 'material_requisition');
  if (level === 0) halt('You do not have access to this item.');
  let q = 'SELECT mr.id, mr.status, mr.date_requested, SUM(quantity_requested) quantity_requested, SUM(quantity_issued) quantity_issued FROM material_requests mr LEFT JOIN material_request_items mri ON mr.id = mri.request';
  const a: any[] = [];
  if (limited(ctx, 'material_requisition')) { q += ' WHERE requested_by = ?'; a.push(ctx.S.user.id); }
  q += ' GROUP BY mr.id ORDER BY mr.id DESC';
  const rows = await ctx.db.selectAll(q, a);
  const body = rows.length
    ? `<ul class="list three-line dividers right-assist link-list">${rows.map((r: any) => `<li data-url="material-request?id=${r.id}"><div class="content"><p>${date('d M Y h:i A', strtotime(r.date_requested) as number)}<br>${r.quantity_requested} items</div><div class="right-assisst"><span class="badge status-${r.status}">${materialRequestStatusLegend[r.status]}</span></div></li>`).join('')}</ul>`
    : noData('Material Indent');
  return {
    metaTitle: 'Material Indent', pageTitle: 'Material Indent', metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>
${level === 2 ? '<div class="fab-cont"><a href="material-request" class="fab extended"><span class="material-icons">add</span> Add New</a></div>' : ''}`,
    js: `<script type="module">import { initLinksList } from './js/functions.mjs?v=${V}'; initLinksList();</script>`,
  };
}
