import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { paymentStatusLegend } from '@/lib/config';
import { date, number_format, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { getApprovals, notifyForApproval, sanitize, toInt } from '@/lib/functions';
import { P, SITE_URL, V, halt, msgWarn, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'payments') === 0) halt('You do not have access to this item.');
  let pageTitle = 'Create Payment Request', id = 0, payment: any;
  if (ctx.get.id !== undefined) {
    id = toInt(ctx.get.id);
    payment = await db.selectOne('SELECT p.*, u.name as requester_name FROM payments p LEFT JOIN users u ON p.created_by = u.id WHERE p.id = ?', [id]);
    if (!payment) notFound();
    pageTitle = `Payment #${id}`;
  } else if (P(ctx, 'payments') < 2) halt('You do not have the permissions to request payment.');

  if (post.recipient !== undefined) {
    const p: any = { amount: sanitize(post.amount, 'number'), recipient: sanitize(post.recipient), purpose: sanitize(post.purpose) };
    let r: any = {};
    try {
      if (ctx.get.id !== undefined) { await db.update('payments', p, 'id = ?', [id]); await db.delete('approvals', "entity_type = 'payments' AND entity_id = ?", [id]); }
      else { Object.assign(p, { status: 1, created_by: S.user.id, date_requested: now }); id = await db.insert('payments', p); }
      await notifyForApproval(ctx, 'payments', `Payment request for ${p.recipient} needs approval`, `₹${number_format(p.amount)} for ${p.purpose}`, `${SITE_URL}/payment?id=${id}`, 10);
      r = { action: 'goback' };
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  }

  let body: string;
  if (ctx.get.id === undefined || (payment.status == 1 && payment.created_by == S.user.id)) {
    body = `<form method="post" class="ajax">
		<div class="input-field"><input type="text" name="recipient" maxlength="50" value="${esc(payment?.recipient ?? '')}" required><label>Recipient</label></div>
		<div class="input-field"><span class="left-assist">₹</span><input type="number" name="amount" min="0" value="${esc(payment?.amount ?? '')}" required><label>Amount</label></div>
		<div class="input-field"><input type="text" name="purpose" maxlength="200" value="${esc(payment?.purpose ?? '')}" required><label>Purpose</label></div>
		<button type="submit" class="btn filled">Save</button><div id="global-msg-cont"></div></form>`;
  } else {
    let purpose = esc(payment.purpose);
    if (payment.attached_entity !== null) {
      const pg = payment.attached_entity === 'advance_salary' ? 'advance-salary-request' : payment.attached_entity;
      purpose = `<a href="${esc(pg)}?id=${esc(payment.attached_entity_id)}">${purpose}</a>`;
    }
    body = `<div id="global-msg-cont"></div><dl class="horizontal">
		<dt>Recipient</dt><dd>${esc(payment.recipient)}</dd><dt>Amount</dt><dd>₹${number_format(payment.amount)}</dd><dt>Purpose</dt><dd>${purpose}</dd>
		<dt>Requested by</dt><dd>${esc(payment.requester_name ?? 'None ')} (${date('d M Y h:i A', strtotime(payment.date_requested) as number)})</dd>
		<dt>Status</dt><dd>${paymentStatusLegend[payment.status]}</dd>
		${payment.is_paid ? `<dt>Paid On</dt><dd>${date('d M Y h:i A', strtotime(payment.date_paid) as number)}</dd>` : ''}</dl>
		${payment.created_by != 0 ? (await getApprovals(ctx, 'payments', id, 2)).html : ''}`;
  }
  return {
    metaTitle: pageTitle, pageTitle, metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8">${body}</div></div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms, mgmtApproval } from './js/functions.mjs?v=${V}';
	initInputs(); initAjaxForms(); mgmtApproval();
</script>`,
  };
}
