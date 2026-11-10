import { Ctx, Page } from '@/lib/ctx';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { noData } from '@/lib/functions';
import { P, V } from '@/lib/h';

function toursList(data: any[]) {
  let out = '<ul class="list compact dividers link-list">';
  for (const r of data) {
    out += `<li data-url="tour?id=${r.id}"><div class="content"><p class="no-margin">`;
    if (r.name !== undefined) out += `<strong>${esc(r.name)}</strong><br>`;
    out += `${esc(r.location)}<br><small>${date('d M Y', strtotime(r.date_started) as number)}`;
    if (r.date_ended !== null && String(r.date_started).split(' ')[0] != String(r.date_ended).split(' ')[0]) out += ' to ' + date('d M Y', strtotime(r.date_ended) as number);
    out += '</small></p></div></li>';
  }
  return out + '</ul>';
}

export default async function (ctx: Ctx): Promise<Page> {
  const { db, S } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  const mine = async () => {
    const r = await db.selectAll('SELECT * FROM tours WHERE created_by = ? ORDER BY date_started DESC', [S.user.id]);
    return r.length ? toursList(r) : noData('Tours');
  };
  let body: string;
  if (P(ctx, 'tours') === 3) {
    const r = await db.selectAll('SELECT t.*, u.name FROM tours t JOIN users u ON t.created_by = u.id JOIN staff_roles sr ON u.role = sr.id WHERE t.created_by != ? ORDER BY id DESC', [S.user.id]);
    body = `<ul class="tab-controller" data-target="tabs"><li>Requests</li><li>My Tours</li></ul><ul class="tabs" id="tabs"><li>${r.length ? toursList(r) : noData('Tours')}</li><li>${await mine()}</li></ul>`;
  } else body = await mine();
  return {
    metaTitle: 'Tours', pageTitle: 'Tours', metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>
${P(ctx, 'tours') >= 2 ? '<div class="fab-cont"><a href="tour" class="fab extended"><span class="material-icons">add</span> Add New</a></div>' : ''}`,
    js: `<script type="module">
	import { initLinksList } from './js/functions.mjs?v=${V}';
	initLinksList();
	G('.tab-controller').tabs();
	EventBus.subscribe('tours', 'out', () => { G('.tab-controller').tabs('destroy'); EventBus.unsubscribe('tours'); });
</script>`,
  };
}
