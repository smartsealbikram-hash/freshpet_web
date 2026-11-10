import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { date, number_format, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { getApprovals, notifyForApproval, sanitize, toInt } from '@/lib/functions';
import { P, SITE_URL, V, msgWarn, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  let pageTitle = 'Add Tour', id = 0, tour: any;
  if (ctx.get.id !== undefined) {
    id = toInt(ctx.get.id);
    let q = 'SELECT * FROM tours WHERE id = ?';
    const a: any[] = [id];
    if (P(ctx, 'tours') < 3) { q += ' AND created_by = ?'; a.push(S.user.id); }
    tour = await db.selectOne(q, a);
    if (!tour) notFound();
    pageTitle = 'Tour #' + id;
  }

  if (post.location !== undefined) {
    let r: any = {};
    try {
      id = await db.insert('tours', { created_by: ctx.userId, location: sanitize(post.location), date_started: sanitize(post.date_started) });
      r = { redirect: 'tour?id=' + id };
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  }
  if (post.action === 'end-tour') {
    let r: any = {};
    try {
      await db.update('tours', { date_ended: now }, 'id = ?', [id]);
      await notifyForApproval(ctx, 'tours', 'Approval requested for tour expenses', `${S.user.name} has ended a tour. Tap to view and approve expenses`, `${SITE_URL}/tour?id=${id}`, 7);
      r = { action: 'goback', message: { type: 'snackbar', content: 'Tour marked complete' } };
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  }

  let body: string;
  if (ctx.get.id === undefined) {
    body = `<form method="post" class="ajax">
		<div class="input-field sidelabel"><input type="text" name="location" required><label>Location</label></div>
		<div class="input-field sidelabel"><input type="text" name="date_started" class="datetimepicker" required><label>Start Date</label></div>
		<button type="submit" class="btn filled">Save</button></form>`;
  } else {
    const fmt = (d: any) => date('d M Y h:i A', strtotime(d) as number);
    const exps = await db.selectAll('SELECT * FROM tour_expenses WHERE tour = ? ORDER BY date_expense', [tour.id]);
    let list = '';
    if (exps.length) {
      const cat: Record<string, { icon: string; total: number }> = {
        Food: { icon: '<span class="material-icons left-assist expense-icon food">fastfood</span>', total: 0 },
        Travel: { icon: '<span class="material-icons left-assist expense-icon travel">directions_bike</span>', total: 0 },
        Stay: { icon: '<span class="material-icons left-assist expense-icon stay">hotel</span>', total: 0 },
      };
      let prev: string | null = null, rows = '';
      for (const r of exps) {
        const d = date('Y-m-d', strtotime(r.date_expense) as number);
        if (d !== prev) { prev = d; rows += `<li class="heading">${date('d M Y', strtotime(d) as number)}</li>`; }
        if (cat[r.type]) cat[r.type].total += Number(r.amount);
        rows += `<li data-url="tour-expense?t=${tour.id}&id=${r.id}">${cat[r.type]?.icon ?? ''}<div class="content">${date('h:i A', strtotime(r.date_expense) as number)} <small>${esc(r.remarks)}</small></div><span class="right-assist">₹${esc(r.amount)}</span></li>`;
      }
      let grand = 0, sum = '';
      for (const [k, v] of Object.entries(cat)) { grand += v.total; sum += `<tr><td style="width:3rem">${v.icon}</td><td>${k}</td><td class="right">₹${number_format(v.total)}</td></tr>`; }
      list = `<ul class="list compact left-assist right-assist ${tour.date_ended === null ? 'link-list' : ''}">${rows}</ul>
			<div class="card mt2"><div class="content"><h3>Summary</h3><table class="compact"><tbody>${sum}<tr><td></td><td><strong>Total</strong></td><td class="right"><strong>₹${number_format(grand)}</strong></td></tr></tbody></table></div></div>`;
    } else list = '<p>No expenses added</p>';
    let tail: string;
    if (S.user.id == tour.created_by && tour.date_ended === null)
      tail = `<div class="center mt2"><a href="tour-expense?t=${id}" class="btn outline">Add Expense</a>
			<button type="button" class="btn filled send-action" data-action="end-tour" data-msg="The tour will be marked as ended now. No expenses can be added or edited after this action.">End Tour</button></div>`;
    else tail = '<br>' + (await getApprovals(ctx, 'tours', id, 1)).html;
    body = `<dl class="horizontal"><dt>Location</dt><dd>${esc(tour.location)}</dd><dt>Start Date</dt><dd>${fmt(tour.date_started)}</dd>
		${tour.date_ended !== null ? `<dt>End Date</dt><dd>${fmt(tour.date_ended)}</dd>` : ''}</dl>
		<h3 class="mt2">Expenses</h3><hr>${list}${tail}`;
  }
  return {
    metaTitle: pageTitle, pageTitle, metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms, mgmtApproval, initLinksList } from './js/functions.mjs?v=${V}';
	initInputs(); initAjaxForms(); mgmtApproval(); initLinksList();
	G('.datetimepicker').datepicker({ type: 'datetime', startDate: dayjs() });
</script>`,
  };
}
