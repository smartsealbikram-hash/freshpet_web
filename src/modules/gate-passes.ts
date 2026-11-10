import { Ctx, Page } from '@/lib/ctx';
import { leavesList } from '@/lib/leaves';
import { noData } from '@/lib/functions';
import { strtotime } from '@/lib/php';
import { P, V } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, S } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  const todayTS = strtotime(ctx.today) as number;
  const mine = async () => {
    const r = await db.selectAll("SELECT * FROM leave_applications WHERE type = 'gate_pass' AND user = ? ORDER BY start_date DESC", [S.user.id]);
    return r.length ? leavesList(r, todayTS) : noData('Gate Passes');
  };
  let body: string;
  if (P(ctx, 'gate_passes') === 3 || S.user.department == 8) {
    let q = "SELECT la.*, u.name FROM leave_applications la JOIN users u ON la.user = u.id JOIN staff_roles sr ON u.role = sr.id WHERE la.type = 'gate_pass' AND la.user != ? ";
    const args: any[] = [S.user.id];
    if (![10, 8, 1].includes(Number(S.user.department))) { q += ' AND sr.department = ?'; args.push(S.user.department); }
    q += ' ORDER BY FIELD(la.status, 1) DESC, start_date DESC LIMIT 250';
    const reqs = await db.selectAll(q, args);
    body = `<ul class="tab-controller" data-target="tabs"><li>Requests</li><li>My Passes</li></ul>
		<ul class="tabs" id="tabs"><li>${reqs.length ? leavesList(reqs, todayTS) : noData('Gate Pass Requests')}</li><li>${await mine()}</li></ul>`;
  } else body = await mine();
  return {
    metaTitle: 'Gate Passes', pageTitle: 'Gate Passes', metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>
<div class="fab-cont"><a href="leave-application?type=gate_pass" class="fab extended"><span class="material-icons">add</span> Add New</a></div>`,
    js: `<script type="module">
	import { initLinksList } from './js/functions.mjs?v=${V}';
	initLinksList();
	G('.tab-controller').tabs();
	EventBus.subscribe('gate-passes', 'out', () => { G('.tab-controller').tabs('destroy'); EventBus.unsubscribe('gate-passes'); });
</script>`,
  };
}
