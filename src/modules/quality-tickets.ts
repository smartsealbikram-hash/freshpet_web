import { Ctx, Page } from '@/lib/ctx';
import { qualityTicketStatus } from '@/lib/config';
import { esc } from '@/lib/html';
import { noData } from '@/lib/functions';
import { P, V, halt } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  if (!ctx.isLoggedIn) ctx.account.logout();
  const level = P(ctx, 'quality_tickets');
  if (level === 0) halt('You do not have access to this item.');
  const rows = await ctx.db.selectAll('SELECT q.id, q.status, q.customer, p.weight, p.type FROM quality_tickets q JOIN products p ON q.product = p.id ORDER BY q.id DESC');
  return {
    metaTitle: 'Quality Tickets',
    pageTitle: 'Quality Tickets',
    metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8">
	<div id="global-msg-cont"></div>
	${rows.length
      ? `<ul class="list three-line dividers right-assist link-list">${rows.map((r: any) => `<li data-url="quality-ticket?id=${r.id}"><div class="content"><p class="headline">FP${String(r.id).padStart(4, '0')}</p><p class="helper-text">${esc(r.weight)}gm ${esc(r.type)}<br>${esc(r.customer)}</p></div><div class="right-assist"><span class="badge status-${r.status >= 2 ? r.status - 1 : r.status}">${qualityTicketStatus[r.status]}</span></div></li>`).join('')}</ul>`
      : noData('Quality Tickets')}
</div></div></div></section>
${level >= 2 ? '<div class="fab-cont"><a href="quality-ticket" class="fab extended"><span class="material-icons">add</span> Add New</a></div>' : ''}`,
    js: `<script type="module">import { initLinksList } from './js/functions.mjs?v=${V}'; initLinksList();</script>`,
  };
}
