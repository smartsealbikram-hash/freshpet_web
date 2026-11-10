import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { statusToColor } from '@/lib/config';
import { date, number_format, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { getApprovals, sanitize, toInt } from '@/lib/functions';
import { P, SITE_URL, V, halt, msgWarn, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  const level = P(ctx, 'production_logs');
  if (level === 0) halt('You do not have access to this item.');

  if (post.verified !== undefined) {
    let r: any = {};
    try { await db.update('production_logs', { verified_by: ctx.userId, date_verified: now }, 'id = ? AND created_by != ?', [toInt(post.log), ctx.userId]); r = { action: 'refresh' }; } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  }
  if (ctx.get.ins === undefined || ctx.get.date === undefined) notFound();
  const instanceId = toInt(ctx.get.ins), d = sanitize(ctx.get.date);
  const logs = await db.selectAll('SELECT plg.*, pl.status as lot_status, pl.lot_id, u.name as creator_name, u2.name as verifier_name FROM production_logs plg JOIN production_instances pi ON plg.instance_id = pi.id JOIN production_lots pl ON pi.lot_id = pl.id LEFT JOIN users u ON plg.created_by = u.id LEFT JOIN users u2 ON plg.verified_by = u2.id WHERE plg.instance_id = ? AND shift_date = ?', [instanceId, d]);
  if (!logs.length) notFound();

  let tp = 0, tprod = 0, tpacks = 0, trej = 0, run = 0, mold = 0, noplan = 0, brk = 0;
  for (const l of logs) {
    if (l.date_added === null) continue;
    tp += Number(l.total_pcs); tprod += Number(l.production); tpacks += Number(l.good_pack); trej += Number(l.rejection) + Number(l.lumps);
    run += Number(l.running_hrs); mold += Number(l.mold_change_time); noplan += Number(l.no_plan_time); brk += Number(l.breakdown_time);
  }
  const fmt = (x: any) => date('d M Y h:i A', strtotime(x) as number);
  let body = '';
  if (tp)
    body += `<div class="card mb1"><div class="content"><h3>Total</h3><dl class="horizontal"><dt>Pcs</dt><dd>${number_format(tp)}</dd><dt>Production</dt><dd>${number_format(tprod, 2)}kgs</dd><dt>Good Packs</dt><dd>${tpacks} boxes/bags</dd>
		<dt>Rejection</dt><dd>${trej}kgs (${Math.round((trej / tprod) * 1000) / 10}%)</dd><dt>Running Hrs</dt><dd>${run}hr</dd><dt>Mold Change Time</dt><dd>${mold}hr</dd><dt>No Plan Time</dt><dd>${noplan}hr</dd>
		<dt>Breakdown Time</dt><dd>${brk}hr${brk >= 2.4 ? ' <span class="material-icons warning-color">warning</span>' : ''}</dd></dl>
		<a href="daily-production-report?d=${esc(d)}" class="btn outline"><span class="material-icons left-icon">area_chart</span> View Daily Report</a></div></div>`;

  for (const l of logs) {
    let params = '';
    const ps = await db.selectAll('SELECT id, date_added FROM shift_parameters WHERE log = ?', [l.id]);
    if (ps.length) params = `<hr><h4>Parameters</h4><ul class="scrollx">${ps.map((r: any) => `<li><a href="machine-parameters?log=${l.id}&id=${r.id}" class="btn outline">${fmt(r.date_added)}</a></li>`).join('')}</ul>`;
    let maint = '';
    const ms = await db.selectAll('SELECT pm.status, mt.name, image, remarks FROM production_maintenance pm JOIN maintenance_tasks mt ON pm.task = mt.id WHERE pm.shift = ?', [l.id]);
    if (ms.length) {
      maint = '<hr><h4>Maintenance</h4>' + ms.map((r: any) => `<div class="text-banner mb1 ${statusToColor[r.status]}"><span class="material-icons">engineering</span><p><strong>${esc(r.name)}</strong>${r.remarks ? `<br><small>${esc(r.remarks)}</small>` : r.status == 1 ? '<br><small>Pending</small>' : ''}</p>${r.image ? `<button type="button" class="btn icon tonal toggle-off start-lightbox" data-image="${SITE_URL}${esc(r.image)}" style="margin-top:0"><span class="material-icons">image</span></button>` : ''}</div>`).join('');
    }
    if (l.date_added === null) {
      body += `<div class="card flat mb1"><div class="content"><dl class="horizontal"><dt>Shift</dt><dd>${esc(l.shift)}</dd><dt>Incharge</dt><dd>${esc(l.creator_name)}</dd><dt>Production</dt><dd class="error-color">Not entered yet</dd></dl>${params}${maint}</div><div class="action">`;
      if (l.lot_status < 6 && level === 2) {
        const prev = date('Y-m-d', (strtotime(l.shift_date) as number) - 86400);
        const pl: any = await db.selectOne('SELECT verified_by FROM `production_logs` WHERE instance_id = ? AND end_hour = ? AND ((start_hour > end_hour AND shift_date = ?) OR (start_hour < end_hour AND shift_date = ?))', [instanceId, l.start_hour, prev, l.shift_date]);
        if (pl && pl.verified_by === null) body += '<span class="error-color">Verify previous shift log to add current log.</span>';
        else body += `<a href="machine-parameters?log=${l.id}" class="btn tonal">Add Parameters</a><a href="production-log?id=${l.id}" class="btn filled">Add Log</a>`;
      }
      body += '</div></div>';
    } else {
      body += `<div class="card flat mb1"><div class="content"><dl class="horizontal"><dt>Shift</dt><dd>${esc(l.shift)}</dd><dt>Total Pcs</dt><dd>${number_format(l.total_pcs)}</dd><dt>Production</dt><dd>${esc(l.production)}kg</dd>
			<dt>Good Packs</dt><dd>${esc(l.good_pack)} boxes/bags</dd><dt>Rejection</dt><dd>${esc(l.rejection)}kg + ${esc(l.lumps)}kg = ${Number(l.rejection) + Number(l.lumps)}kg (${esc(l.rejection_percent)}%)</dd>
			<dt>Running Hours</dt><dd>${esc(l.running_hrs)}hr</dd><dt>Mold Change Time</dt><dd>${esc(l.mold_change_time)}hr</dd><dt>No plan Time</dt><dd>${esc(l.no_plan_time)}hr</dd>
			<dt>Breakdown Time</dt><dd>${esc(l.breakdown_time)}hr${l.breakdown_time >= 0.8 ? ' <span class="material-icons warning-color">warning</span>' : ''}</dd>
			<dt>Added By</dt><dd>${esc(l.creator_name)} (${fmt(l.date_added)})</dd>`;
      if (l.verified_by !== null) body += `<dt>Verified by <span class="material-icons success-color">verified</span></dt><dd>${esc(l.verifier_name)} (${fmt(l.date_verified)})`;
      body += `</dl>${params}${maint}`;
      const ap = await getApprovals(ctx, 'production_logs', l.id, 1);
      if (ap.approved > 0) body += ap.html;
      body += '</div>';
      if (l.lot_status < 6 && ap.approved < ap.totalApprovals) {
        body += '<div class="action">';
        if (l.verified_by === null) {
          if (S.user.role == 13 && l.created_by != S.user.id) body += `<button type="submit" class="btn filled verify-log" data-log="${l.id}">Verify</button>`;
          else if (l.created_by == S.user.id) body += `<a href="machine-parameters?log=${l.id}" class="btn tonal">Add Parameters</a><a href="production-log?id=${l.id}" class="btn outline">Edit Log</a>`;
        } else if (level === 3) body += `<a href="production-log?id=${l.id}" class="btn filled">View &amp; Approve</a>`;
        body += '</div>';
      }
      body += '</div>';
    }
  }
  return {
    metaTitle: 'Production Logs', pageTitle: 'Production Logs', metaDescription: '', subTitle: `${esc(logs[0].lot_id)} • ${date('d M', strtotime(d) as number)}`,
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>`,
    js: `<script type="module">
	import {mgmtApproval, processAjaxForm } from './js/functions.mjs?v=${V}';
	mgmtApproval();
	G('.start-lightbox').on('click', e => { const image = e.target.closest('.start-lightbox').dataset.image; G(document.documentElement).lightbox({ images: [image], zoom: true }); });
	G('.verify-log').on('click', e => {
		G.dialog({
			title: 'Verify shift log',
			description: \`<form method="post"><input type="number" name="log" value="\${e.target.dataset.log}" hidden><div class="input-field"><input type="checkbox" name="verified" id="verified" data-error="Ask the shift incharge of this shift to correct the values if they are not valid" required><label for="verified">I have verified all values in this log to be correct and valid.</label></div></form>\`,
			onLoad: function(d){ G(d.querySelector('.input-field input')).toggleInput(); },
			confirmingAction: { text: 'Verify', onPress: function(d){ const form = d.querySelector('form'); if(form.checkValidity()){ processAjaxForm(form).catch(() => {}); } else return false; } },
			dismissiveAction: { text: 'Cancel' }
		});
	})
</script>`,
  };
}
