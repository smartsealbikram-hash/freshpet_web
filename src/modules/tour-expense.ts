import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { date, strtotime, time } from '@/lib/php';
import { esc } from '@/lib/html';
import { compare, sanitize, toInt } from '@/lib/functions';
import { P, V, halt, msgWarn, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'tours') < 2) halt('You do not have access to this item.');
  if (ctx.get.t === undefined) notFound();
  const tourId = toInt(ctx.get.t);
  let q = 'SELECT * FROM tours WHERE id = ?';
  const a: any[] = [tourId];
  if (P(ctx, 'tours') < 3) { q += ' AND created_by = ?'; a.push(S.user.id); }
  const tour: any = await db.selectOne(q, a);
  if (!tour) notFound();
  if (tour.date_ended !== null || (strtotime(tour.date_started) as number) > time())
    halt(tour.date_ended !== null ? 'This tour has ended. Expenses can not be added/edited anymore.' : 'Expenses can not be added until the tour has started.');
  let id = 0, expense: any;
  if (ctx.get.id !== undefined) {
    id = toInt(ctx.get.id);
    expense = await db.selectOne('SELECT * FROM tour_expenses WHERE id = ? AND tour = ?', [id, tourId]);
    if (!expense) notFound();
    expense.date_expense = date('Y-m-d h:i a', strtotime(expense.date_expense) as number);
  }
  if (post.type !== undefined) {
    const p: any = { type: sanitize(post.type), date_expense: date('Y-m-d H:i:s', strtotime(post.date_expense) as number), amount: sanitize(post.amount, 'number'), remarks: sanitize(post.remarks) };
    let r: any = {};
    try {
      if (ctx.get.id !== undefined) await db.update('tour_expenses', p, 'id = ?', [id]);
      else { p.tour = tourId; await db.insert('tour_expenses', p); }
      r = { action: 'goback' };
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  }
  return {
    metaTitle: 'Add Expense', pageTitle: 'Add Expense', metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>
	<form method="post" class="ajax">
		<div class="input-field sidelabel"><select name="type" required><option></option>
			${['Food', 'Travel', 'Stay'].map((t) => `<option value="${t}"${compare(t, expense?.type ?? '', ' selected')}>${t}</option>`).join('')}</select><label>Type</label></div>
		<div class="input-field sidelabel"><input type="text" name="date_expense" class="datetimepicker" value="${esc(expense?.date_expense ?? '')}" required><label>Time of Expense</label></div>
		<div class="input-field sidelabel"><input type="number" name="amount" value="${esc(expense?.amount ?? '')}" required><label>Amount</label></div>
		<div class="input-field sidelabel"><input type="text" name="remarks" maxlength="100" value="${esc(expense?.remarks ?? '')}"><label>Remarks</label></div>
		<button type="submit" class="btn filled">Save</button>
	</form></div></div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms } from './js/functions.mjs?v=${V}';
	initInputs(); initAjaxForms();
	G('.datetimepicker').datepicker({ type: 'datetime', startDate: '${esc(tour.date_started)}', endDate: dayjs() });
</script>`,
  };
}
