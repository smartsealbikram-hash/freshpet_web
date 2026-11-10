import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { getFinancialYear, notifyGroup, sanitize, toInt } from '@/lib/functions';
import { P, SITE_URL, V, halt, msgWarn, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now, today } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  const level = P(ctx, 'receiving_notes');
  if (level === 0) halt('You do not have access to this item.');
  let pageTitle = 'Add Entry', id = 0, entry: any;
  if (ctx.get.id !== undefined) {
    id = toInt(ctx.get.id);
    entry = await db.selectOne('SELECT rn.*, u.name as receiver_name FROM receiving_notes rn JOIN users u ON rn.received_by = u.id WHERE rn.id = ?', [id]);
    if (!entry) notFound();
    pageTitle = entry.register_id;
  } else if (level < 2) halt('You do not have the permissions to add receiving notes.');

  if (post.date_invoice !== undefined) {
    const p: any = {
      date_invoice: sanitize(post.date_invoice), invoice_num: sanitize(post.invoice_num), party_name: sanitize(post.party_name), product_name: sanitize(post.product_name),
      amount: sanitize(post.amount, 'number'), delivered_by: sanitize(post.delivered_by), deliverer_phone: sanitize(post.deliverer_phone), vehicle_num: sanitize(post.vehicle_num),
    };
    let r: any = {};
    try {
      let registerId = entry?.register_id;
      if (ctx.get.id !== undefined) { p.updated_by = ctx.userId; p.date_updated = now; await db.update('receiving_notes', p, 'id = ?', [id]); }
      else {
        const y = getFinancialYear();
        const loc = Number(ctx.settings.location);
        const n = (await db.count('receiving_notes', "location = ? AND type = 'srn' AND DATE(date_received) >= ? AND DATE(date_received) <= ?", [loc, `${y}-04-01`, `${y + 1}-03-31`])) + 1;
        registerId = `${({ 1: 'SRN UK', 2: 'SRNJK' } as any)[loc]}/${String(n).padStart(3, '0')}`;
        Object.assign(p, { location: loc, type: 'srn', register_id: registerId, received_by: S.user.id, date_received: now });
        id = await db.insert('receiving_notes', p);
      }
      await notifyGroup(ctx, 'department', 10, 'receiving_notes', 1, `${registerId} added`, `Party: ${p.party_name}`, `${SITE_URL}/srn-register-entry?id=${id}`);
      r = { action: 'goback' };
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  }

  let body: string;
  const input = (n: string, label: string, attrs = 'type="text"') => `<div class="input-field sidelabel"><input ${attrs} name="${n}" value="${esc(entry?.[n] ?? '')}"><label>${label}</label></div>`;
  if (level >= 2 && (ctx.get.id === undefined || String(entry.date_received).split(' ')[0] == today)) {
    body = `<form method="post" class="ajax">
		<div class="input-field sidelabel"><input type="text" name="date_invoice" class="datepicker" value="${esc(entry?.date_invoice ?? '')}"><label>Invoice Date</label></div>
		${input('invoice_num', 'Invoice Number', 'type="tel" maxlength="20"')}${input('party_name', 'Party Name', 'type="text" maxlength="50"')}${input('product_name', 'Service Details', 'type="text" maxlength="50"')}${input('amount', 'Amount', 'type="number" step="0.01"')}
		<div class="card flat mb1"><div class="content"><h4>Delivered by</h4>
			<div class="input-field"><input type="text" maxlength="50" name="delivered_by" value="${esc(entry?.delivered_by ?? '')}"><label>Name</label></div>
			<div class="row"><div class="input-field col xs6"><input type="tel" maxlength="20" name="deliverer_phone" value="${esc(entry?.deliverer_phone ?? '')}"><label>Phone</label></div>
			<div class="input-field col xs6"><input type="text" maxlength="10" name="vehicle_num" value="${esc(entry?.vehicle_num ?? '')}"><label>Vehicle Number</label></div></div></div></div>
		<button type="submit" class="btn filled">Save</button></form>`;
  } else {
    let upd = '';
    if (entry.updated_by !== null) {
      const name = entry.updated_by == entry.received_by ? entry.receiver_name : ((await db.selectOne('SELECT name FROM users WHERE id = ?', [entry.updated_by])) as any).name;
      upd = `<dt>Last updated by</dt><dd>${esc(name)} (${date('d M Y h:i A', strtotime(entry.date_updated) as number)})</dd>`;
    }
    body = `<dl class="horizontal"><dt>Received by</dt><dd>${esc(entry.receiver_name)} (${date('d M Y h:i A', strtotime(entry.date_received) as number)})</dd>
		<dt>Invoice Date</dt><dd>${date('d M Y', strtotime(entry.date_invoice) as number)}</dd><dt>Invoice Number</dt><dd>${esc(entry.invoice_num)}</dd><dt>Party Name</dt><dd>${esc(entry.party_name)}</dd>
		<dt>Service Details</dt><dd>${esc(entry.product_name)}</dd><dt>Amount</dt><dd>₹${esc(entry.amount)}</dd>
		<dt>Delivered by</dt><dd>${esc(entry.delivered_by)} - <a href="tel:${esc(entry.deliverer_phone)}">${esc(entry.deliverer_phone)}</a></dd><dt>Vehicle Number</dt><dd>${esc(entry.vehicle_num)}</dd>${upd}</dl>`;
  }
  return {
    metaTitle: pageTitle, pageTitle, metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>`,
    js: `<script type="module">import { initInputs, initAjaxForms } from './js/functions.mjs?v=${V}'; initInputs(); initAjaxForms();</script>`,
  };
}
