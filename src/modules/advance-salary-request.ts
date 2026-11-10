import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { leaveStatusLegend } from '@/lib/config';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { getApprovals, notifyForApproval, sanitize, toInt } from '@/lib/functions';
import { SITE_URL, V, msgWarn, nl2br, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  let pageTitle = 'Request Advance Salary', id = 0, request: any;
  if (ctx.get.id !== undefined) {
    id = toInt(ctx.get.id);
    request = await db.selectOne('SELECT r.*, u.name as requester_name, u2.name as disburser_name FROM advance_salary r JOIN users u ON r.created_by = u.id LEFT JOIN users u2 ON r.disbursed_by = u2.id WHERE r.id = ?', [id]);
    if (!request) notFound();
    pageTitle = `Advance Salary Request #${id}`;
    if (post.action === 'disburse' && S.user.role == 5) {
      let r: any = {};
      try { await db.update('advance_salary', { status: 3, disbursed_by: S.user.id, date_disbursed: now }, 'id = ?', [id]); r = { action: 'refresh' }; } catch (e) { r = msgWarn(e); }
      return jsonExit(r);
    }
  }
  if (post.amount !== undefined) {
    const p: any = { amount: sanitize(post.amount), reason: sanitize(post.reason) };
    let r: any = {};
    try {
      if (ctx.get.id !== undefined) await db.update('advance_salary', p, 'id = ?', [id]);
      else { Object.assign(p, { status: 1, created_by: S.user.id, date_requested: now }); id = await db.insert('advance_salary', p); }
      await notifyForApproval(ctx, 'advance_salary', `Advance salary requested by ${S.user.name}`, '', `${SITE_URL}/advance-salary-request?id=${id}`, 10);
      r = { action: 'goback' };
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  }
  let body: string;
  if (ctx.get.id === undefined || (request.status == 1 && request.created_by == S.user.id && request.disbursed_by === null)) {
    body = `<form method="post" class="ajax">
		<div class="input-field sidelabel"><input type="number" name="amount" value="${esc(request?.amount ?? '')}" required><label>Amount</label></div>
		<div class="input-field sidelabel"><textarea name="reason" maxlength="200" rows="4" required>${esc(request?.reason ?? '')}</textarea><label>Reason</label><span class="helper">Enter reason for this request</span></div>
		<button type="submit" class="btn filled">Save</button></form>`;
  } else {
    body = `<dl class="horizontal"><dt>Requested By</dt><dd>${esc(request.requester_name)} (${date('d M Y h:i A', strtotime(request.date_requested) as number)})</dd>
		<dt>Amount</dt><dd>₹${esc(request.amount)}</dd><dt>Reason</dt><dd>${nl2br(request.reason)}</dd><dt>Status</dt><dd>${leaveStatusLegend[request.status]}</dd>
		${request.disbursed_by !== null ? `<dt>Disbursed By</dt><dd>${esc(request.disburser_name)} (${date('d M Y h:i A', strtotime(request.date_disbursed) as number)})</dd>`
        : S.user.role == 5 ? '<dt>Disbursement</dt><dd><button type="button" class="btn tonal send-action" data-action="disburse">Mark as Done</button></dd>' : ''}</dl>
		${(await getApprovals(ctx, 'advance_salary', request.id, 2)).html}`;
  }
  return {
    metaTitle: pageTitle, pageTitle, metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms, mgmtApproval } from './js/functions.mjs?v=${V}';
	initInputs(); initAjaxForms(); mgmtApproval();
</script>`,
  };
}
