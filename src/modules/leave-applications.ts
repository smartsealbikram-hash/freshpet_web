import { Ctx, Page } from '@/lib/ctx';
import { leavesList } from '@/lib/leaves';
import { noData } from '@/lib/functions';
import { P, V } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, S } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  const page: Page = { metaTitle: 'Leave Applications', pageTitle: 'Leave Applications', metaDescription: '' };
  if (P(ctx, 'hr_reports') > 0) page.subTitle = '<a href="leave-reports" class="btn outline small"><span class="material-icons left-icon">area_chart</span> View Reports</a>';

  const mine = async () => {
    const r = await db.selectAll("SELECT * FROM leave_applications WHERE type = 'regular' AND user = ? ORDER BY start_date DESC", [S.user.id]);
    return r.length ? leavesList(r) : noData('Leave Applications');
  };
  let body: string;
  if (P(ctx, 'leaves') === 3) {
    let q = "SELECT la.*, u.name FROM leave_applications la JOIN users u ON la.user = u.id JOIN staff_roles sr ON u.role = sr.id WHERE la.user != ? AND type = 'regular'";
    const args: any[] = [S.user.id];
    if (S.user.department != 10 && S.user.department != 1) { q += ' AND sr.department = ?'; args.push(S.user.department); }
    q += ' ORDER BY FIELD(la.status, 1) DESC, start_date DESC';
    const reqs = await db.selectAll(q, args);
    body = `<ul class="tab-controller" data-target="tabs"><li>Requests</li><li>My Leaves</li></ul>
		<ul class="tabs" id="tabs"><li>${reqs.length ? leavesList(reqs) : noData('Leave Applications')}</li><li>${await mine()}</li></ul>`;
  } else body = await mine();

  page.content = `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>
<div class="fab-cont"><a href="leave-application?type=regular" class="fab extended"><span class="material-icons">add</span> Add New</a></div>`;
  page.js = `<script type="module">
	import { initLinksList } from './js/functions.mjs?v=${V}';
	initLinksList();
	G('.tab-controller').tabs();
	EventBus.subscribe('leave-applications', 'out', () => { G('.tab-controller').tabs('destroy'); EventBus.unsubscribe('leave-applications'); });
</script>`;
  return page;
}
