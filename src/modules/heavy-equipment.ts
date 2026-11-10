import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { heavyEquipmentStatus } from '@/lib/config';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { Account } from '@/lib/account';
import { compare, getApprovals, getFinancialYear, notifyForApproval, sanitize, sendNotification, toInt } from '@/lib/functions';
import { P, SITE_URL, V, halt, msgWarn, nl2br, notFound } from '@/lib/h';
import { duration } from './heavy-equipments';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  const level = P(ctx, 'heavy_equipment');
  if (level === 0) halt('You do not have access to this item.');

  let pageTitle = 'New HE Request', id = 0, he: any, block = false;
  if (ctx.get.id !== undefined) {
    id = toInt(ctx.get.id);
    he = await db.selectOne('SELECT * FROM heavy_equipment_requests WHERE id = ?', [id]);
    if (!he) notFound();
    pageTitle = `Request #${id}`;
  } else if (level >= 2) {
    if (await db.selectOne('SELECT id FROM heavy_equipment_requests WHERE date_requested < CURDATE() AND status BETWEEN 1 AND 3')) block = true;
  } else halt('You do not have the permissions to create heavy equipment requests.');

  if (post.equipment !== undefined) {
    if (block) return jsonExit({ error: 'New requests can not be created. Please close all existing requests first.' });
    const p: any = { vendor: sanitize(post.vendor), equipment: sanitize(post.equipment), reason: sanitize(post.reason), status: 1 };
    let r: any = {};
    try {
      if (ctx.get.id !== undefined) await db.update('heavy_equipment_requests', p, 'id = ?', [id]);
      else {
        const y = getFinancialYear();
        const n = await db.count('heavy_equipment_requests', "DATE(date_requested) >= ? AND DATE(date_requested) <= ?", [`${y}-04-01`, `${y + 1}-03-31`]);
        Object.assign(p, { display_id: n + 1, created_by: S.user.id, date_requested: now });
        id = await db.insert('heavy_equipment_requests', p);
      }
      await notifyForApproval(ctx, 'heavy_equipment', 'Heavy equipment requested', 'Tap to view and approve', `${SITE_URL}/heavy-equipment?id=${id}`, 1);
      r = { action: 'goback' };
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  }

  if (post.action !== undefined || post['f-action'] !== undefined) {
    const action = post['f-action'] ?? post.action;
    const p: any = {};
    let notif = '';
    if (action === 'gate-in' && S.user.role == 2) { p.status = 3; p.in_by = S.user.id; p.in_time = now; notif = `${he.equipment} has entered the facility`; }
    else if (action === 'start' && S.user.id == he.created_by) p.start_time = now;
    else if (action === 'end' && S.user.id == he.created_by) {
      const mins = Math.floor(((strtotime(now) as number) - (strtotime(he.start_time) as number)) / 60);
      p.end_time = now; p.work_duration = mins; p.remarks = sanitize(post.remarks);
    } else if (action === 'gate-out' && S.user.role == 2) { p.status = 4; p.out_by = S.user.id; p.out_time = now; }
    let r: any = {};
    if (Object.keys(p).length) {
      try {
        await db.update('heavy_equipment_requests', p, 'id = ?', [id]);
        if (action === 'gate-in') {
          const emp = new Account(ctx); emp.id = he.created_by;
          const cs: any = await emp.checkCommSettings(4);
          if (cs.push_enabled) await sendNotification(ctx, cs.push_devices, notif, '', `${SITE_URL}/heavy-equipment?id=${id}`);
          r = { action: 'goback' };
        } else r = { action: 'refresh' };
      } catch (e) { r = msgWarn(e); }
    }
    return jsonExit(r);
  }

  let body: string;
  const fmt = (d: any) => date('d M Y h:i A', strtotime(d) as number);
  if (ctx.get.id === undefined || (he.created_by == S.user.id && he.status == 1)) {
    body = `${block ? '<div class="text-banner error mb1"><p>New requests can not be created. Please close all existing requests first.</p></div>' : ''}
	<form method="post" class="ajax">
		<div class="input-field sidelabel"><input type="text" name="vendor" maxlength="50" value="${esc(he?.vendor ?? '')}" required><label>Vendor</label></div>
		<div class="input-field sidelabel"><select name="equipment" required><option></option>
			<option value="Hydra"${compare('Hydra', he?.equipment ?? '', ' selected')}>Hydra</option><option value="Forklift"${compare('Forklift', he?.equipment ?? '', ' selected')}>Forklift</option></select><label>Equipment</label></div>
		<div class="input-field sidelabel"><textarea name="reason" rows="2" required>${esc(he?.reason ?? '')}</textarea><label>Reason</label></div>
		<button type="submit" class="btn filled">Save</button></form>`;
  } else {
    body = `<dl class="horizontal"><dt>Vendor</dt><dd>${esc(he.vendor)}</dd><dt>Equipment</dt><dd>${esc(he.equipment)}</dd>
		${he.end_time !== null ? `<dt>Work Time</dt><dd>${duration(he.work_duration)}</dd>` : ''}
		<dt>Reason</dt><dd>${nl2br(he.reason)}</dd><dt>Status</dt><dd>${heavyEquipmentStatus[he.status]}</dd></dl>`;
    if (he.status <= 1) body += (await getApprovals(ctx, 'heavy_equipment_requests', id, 1)).html;
    else {
      const ids = [he.created_by, he.in_by, he.out_by].filter(Boolean);
      const names: Record<number, string> = {};
      for (const r of await db.selectAll(`SELECT id, name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids)) names[r.id] = r.name;
      const mine = S.user.id == he.created_by, gate = S.user.role == 2;
      body += `<h4 class="mt2">Timeline</h4><ul class="list two-line timeline">
		<li><div class="content">Requested by<br><small>${esc(names[he.created_by])} (${fmt(he.date_requested)})</small></div></li>
		<li><div class="content">Gate In<br><small>${he.in_time !== null ? `${esc(names[he.in_by])} (${fmt(he.in_time)})` : gate ? '<button type="button" class="btn filled send-action" data-action="gate-in">Mark In</button>' : 'Pending'}</small></div></li>
		${he.in_time !== null ? `<li><div class="content">Work Started<br><small>${he.start_time !== null ? fmt(he.start_time) : mine ? '<button type="button" class="btn filled send-action" data-action="start">Start Work</button>' : 'Pending'}</small></div></li>` : ''}
		${he.start_time !== null ? `<li><div class="content">Work Completed<br><small>${he.end_time !== null ? fmt(he.end_time) + (he.remarks ? ` <span class="material-icons message tooltip" title="${esc(he.remarks)}">message</span>` : '') : mine ? '<button type="button" class="btn filled end-work">End Work</button>' : 'Pending'}</small></div></li>` : ''}
		${he.end_time !== null ? `<li><div class="content">Gate Out<br><small>${he.out_time !== null ? `${esc(names[he.out_by])} (${fmt(he.out_time)})` : gate ? '<button type="button" class="btn filled send-action" data-action="gate-out">Mark Out</button>' : 'Pending'}</small></div></li>` : ''}
		</ul>`;
    }
  }
  return {
    metaTitle: pageTitle, pageTitle, metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms, mgmtApproval, processAjaxForm } from './js/functions.mjs?v=${V}';
	initInputs(); initAjaxForms(); mgmtApproval();
	G('.end-work').on('click', () => {
		G.dialog({
			title: 'Are you sure?',
			description: \`<form method="post"><input type="text" name="f-action" value="end" hidden><div class="input-field"><textarea name="remarks"></textarea><label>Remarks</label></div></form>\`,
			onLoad: function(d){ G(d.querySelector('.input-field textarea')).textInput(); },
			confirmingAction: { text: 'Confirm', onPress: function(d){ const form = d.querySelector('form'); processAjaxForm(form).catch(() => {}); } },
			dismissiveAction: { text: 'Cancel' }
		});
	});
</script>`,
  };
}
