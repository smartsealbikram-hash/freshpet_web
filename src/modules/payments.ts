import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { paymentStatusLegend } from '@/lib/config';
import { number_format } from '@/lib/php';
import { esc } from '@/lib/html';
import { noData } from '@/lib/functions';
import { P, V, halt, limited, msgWarn } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  const level = P(ctx, 'payments');
  if (level === 0) halt('You do not have access to this item.');

  if (post.action === 'mark-paid') {
    const payments: any[] = JSON.parse(post.payments);
    let r: any;
    if (level >= 2) {
      try {
        await db.update('payments', { status: 3, is_paid: 1, date_paid: now }, `status = 2 AND id IN (${payments.map(() => '?').join(',')})`, payments);
        r = { message: { type: 'snackbar', content: 'Payments marked paid' }, action: 'refresh' };
      } catch (e) { r = msgWarn(e); }
    } else r = { message: { type: 'error', content: 'You do not have sufficient rights for this operation.' } };
    return jsonExit(r);
  }

  let q = "SELECT p.*, a.decision FROM payments p LEFT JOIN approvals a ON a.entity_type = 'payments' AND a.entity_id = p.id AND a.user = ? WHERE date_requested > CURRENT_DATE - INTERVAL 30 DAY";
  const args: any[] = [ctx.userId];
  if (limited(ctx, 'payments')) { q += ' AND created_by = ?'; args.push(ctx.userId); }
  q += ' ORDER BY p.id DESC';
  const rows = await db.selectAll(q, args);
  let body: string;
  if (rows.length) {
    const groups: Record<string, any[]> = { undecided: [], approved: [], denied: [] };
    for (const r of rows) {
      if (r.status == 0) groups.denied.push(r);
      else if (r.status >= 2 || r.decision !== null) groups.approved.push(r);
      else groups.undecided.push(r);
    }
    body = '<ul class="tab-controller" data-target="tabs"><li>Pending</li><li>Approved</li><li>Denied</li></ul><ul class="tabs" id="tabs">';
    for (const list of Object.values(groups)) {
      body += '<li><ul class="list two-line dividers left-assist right-assist link-list selectable">';
      for (const r of list) {
        body += `<li data-url="payment?id=${r.id}">`;
        if ((r.status == 1 && level === 3 && r.decision === null) || (r.status == 2 && r.created_by == ctx.userId && !r.is_paid))
          body += `<div class="input-field left-assist"><input type="checkbox" name="payment[]" value="${r.id}" id="payment-${r.id}" data-amount="${esc(r.amount)}"><label for="payment-${r.id}">&nbsp;</label></div>`;
        else body += '<span class="left-assist"></span>';
        body += `<div class="content"><span class="truncate">${esc(r.recipient)}</span><small>₹${number_format(r.amount)}</small></div><div class="right-assist"><span class="badge status-${Math.min(r.status, 2)}">${paymentStatusLegend[r.status]}</span></div></li>`;
      }
      body += '</ul></li>';
    }
    body += '</ul>';
  } else body = noData('Payments');
  void S;
  return {
    metaTitle: 'Payments', pageTitle: 'Payments', metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>
<div id="selection-actions"><div><p class="neutral-color-5 mb0"><small><span id="num-items">0</span> Payments Selected</small></p><h3 class="mb0">₹<span id="amount-items">0</span></h3></div>
${level === 3 ? '<button type="button" class="btn elevated approve"><span class="material-icons">check_circle</span> Approve</button>' : '<button type="button" class="btn elevated paid"><span class="material-icons">credit_score</span> Paid</button>'}</div>
${level >= 2 ? '<div class="fab-cont"><a href="payment" class="fab extended"><span class="material-icons">add</span> Add New</a></div>' : ''}`,
    js: `<script src="js/payments.js?v=${V}" type="module"></script>`,
  };
}
