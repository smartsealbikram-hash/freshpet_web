import { Ctx, Page } from '@/lib/ctx';
import { paymentStatusLegend } from '@/lib/config';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { noData } from '@/lib/functions';
import { P, V } from '@/lib/h';

function list(data: any[], mine = true) {
  return `<ul class="list compact dividers right-assist link-list">${data.map((r) => `<li data-url="advance-salary-request?id=${r.id}"><div class="content"><p class="no-margin">${mine ? date('d M Y', strtotime(r.date_requested) as number) : esc(r.name)}<br><small>₹${esc(r.amount)}</small></p></div><div class="right-assisst"><span class="badge status-${r.status}">${paymentStatusLegend[r.status]}</span></div></li>`).join('')}</ul>`;
}

export default async function (ctx: Ctx): Promise<Page> {
  const { db, S } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  const mine = async () => {
    const r = await db.selectAll('SELECT * FROM advance_salary WHERE created_by = ? ORDER BY id DESC', [S.user.id]);
    return r.length ? list(r) : noData('Advance Salary Requests');
  };
  let body: string;
  if (P(ctx, 'advance_salary') === 3 || S.user.role == 5) {
    const r = await db.selectAll('SELECT asa.*, u.name FROM advance_salary asa JOIN users u ON asa.created_by = u.id WHERE asa.created_by != ? ORDER BY FIELD(asa.status, 1) DESC, id DESC', [S.user.id]);
    body = `<ul class="tab-controller" data-target="tabs"><li>Requests</li><li>My Requests</li></ul><ul class="tabs" id="tabs"><li>${r.length ? list(r, false) : noData('Advance Salary Requests')}</li><li>${await mine()}</li></ul>`;
  } else body = await mine();
  return {
    metaTitle: 'Advance Salary', pageTitle: 'Advance Salary', metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>
<div class="fab-cont"><a href="advance-salary-request" class="fab extended"><span class="material-icons">add</span> Add New</a></div>`,
    js: `<script type="module">
	import { initLinksList } from './js/functions.mjs?v=${V}';
	initLinksList();
	G('.tab-controller').tabs();
	EventBus.subscribe('advance-salary', 'out', () => { G('.tab-controller').tabs('destroy'); EventBus.unsubscribe('advance-salary'); });
</script>`,
  };
}
