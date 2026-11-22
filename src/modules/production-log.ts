import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { getApprovals, sanitize, sendNotification, toInt, uploadImage } from '@/lib/functions';
import { P, SITE_URL, V, halt, msgWarn, notFound } from '@/lib/h';
import { REVIEW_HOURS, getLogChanges, recordLogChanges, reviewWindow } from '@/lib/logAudit';

const FIELD_LABELS: Record<string, string> = { total_pcs: 'Total pcs', rejection: 'Rejection (kg)', lumps: 'Lumps (kg)', no_plan_time: 'No plan time (hr)', breakdown_reason: 'Breakdown reason', production: 'Production (kg)' };

/** Tell the production managers (production_logs access level 3) that a shift log is waiting for review. Never blocks the save. */
async function notifyManagers(ctx: Ctx, logId: number, lot: string, by: string) {
  try {
    const devs = await ctx.db.selectAll("SELECT tag FROM users u JOIN staff_permissions sp ON u.role = sp.role AND sp.type = 'production_logs' LEFT JOIN user_devices ud ON u.id = ud.user WHERE u.status = 2 AND access_level = 3 AND sp.access = 3 AND tag IS NOT NULL");
    if (devs.length) await sendNotification(ctx, devs.map((d: any) => d.tag), `Shift log ${lot} needs your review`, `Added by ${by}. Approve or correct it within ${REVIEW_HOURS} hours.`, `${SITE_URL}/production-log?id=${logId}`);
  } catch (e: any) { console.error('manager notification failed:', e?.message); }
}

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  const level = P(ctx, 'production_logs');
  if (level < 2) halt('You do not have access to this item.');
  if (ctx.get.id === undefined) notFound();
  const id = toInt(ctx.get.id);
  const log: any = await db.selectOne('SELECT pl.*, lot_id, date_mould_changed, date_started, box_size, weight, cycle_time, cavities FROM production_logs pl JOIN production_instances pi ON pl.instance_id = pi.id JOIN products p ON pi.product = p.id WHERE pl.id = ?', [id]);
  if (!log) notFound();
  if (Number(log.cycle_time) === 0) halt('Cycle time must be added to product to add/edit this log.');
  const approvals = await getApprovals(ctx, 'production_logs', id, 1);
  if (approvals.approved > 0) halt('Log is locked. Editing is not allowed anymore.');

  const shots = (60 / log.cycle_time) * 60;
  const expectedPerHr = Math.round(((shots * log.cavities * log.weight) / 1000) * 100) / 100;
  let shiftHours = log.end_hour - log.start_hour;
  if (shiftHours <= 0) shiftHours += 24;

  // Level 2 = shift incharge (adds / edits the log). Level 3 = production manager: reviews every submitted log and may correct it;
  // every correction is written to the change history together with the manager's reason.
  const isManager = level === 3 && log.date_added !== null;
  const rw = log.date_added !== null ? reviewWindow(log.date_added) : null;
  if (log.created_by) log.created_by_name = ((await db.selectOne('SELECT name FROM users WHERE id = ?', [log.created_by])) as any)?.name ?? '';
  const firstSubmit = log.date_added === null;

  if (post.total_pcs !== undefined && (level === 2 || isManager)) {
    const p: any = { total_pcs: sanitize(post.total_pcs, 'number'), rejection: sanitize(post.rejection, 'number'), lumps: sanitize(post.lumps, 'number'), no_plan_time: sanitize(post.no_plan_time, 'number'), breakdown_reason: sanitize(post.breakdown_reason) };
    // the incharge's submission stamp / owner must survive a manager's correction
    if (!isManager) { p.date_added = now; p.created_by = ctx.userId; }
    const reason = isManager ? String(sanitize(post.change_reason) ?? '').trim() : '';
    if (isManager && !reason) return jsonExit({ message: { type: 'warning', content: 'Please enter the reason for changing this log.' } });
    if (log.date_mould_changed !== null) {
      const mc = strtotime(log.date_mould_changed) as number, ds = strtotime(log.date_started) as number;
      const ss = strtotime(`${log.shift_date} ${log.start_hour}:00:00`) as number, se = strtotime(`${log.shift_date} ${log.end_hour}:00:00`) as number;
      if (ds > ss && mc < se) {
        let dur = 0;
        if (mc < ss && ds > se) dur = shiftHours * 60;
        else if (mc > ss && ds < se) dur = Math.abs(ds - mc) / 60;
        else if (mc < ss) dur = Math.abs(ds - ss) / 60;
        else if (ds > se) dur = Math.abs(se - mc) / 60;
        p.mold_change_time = dur / 60;
        shiftHours -= dur / 60;
      }
    }
    shiftHours -= Number(p.no_plan_time);
    if (shiftHours < 0) shiftHours = 0;
    p.expected_production = expectedPerHr * shiftHours;
    p.good_pack = Math.floor(p.total_pcs / log.box_size);
    p.production = (p.total_pcs * log.weight) / 1000;
    p.rejection_percent = p.production ? ((Number(p.rejection) + Number(p.lumps)) / p.production) * 100 : 0;
    p.running_hrs = Math.round((p.production / expectedPerHr) * 100) / 100;
    p.breakdown_time = shiftHours - p.running_hrs;
    let r: any = {};
    try {
      // audit first: a correction must never reach the log without a record of it
      if (isManager) await recordLogChanges(id, { id: Number(ctx.userId), name: S.user.name }, log, { total_pcs: p.total_pcs, rejection: p.rejection, lumps: p.lumps, no_plan_time: p.no_plan_time, breakdown_reason: p.breakdown_reason, production: Math.round(p.production * 100) / 100 }, reason, now);
      await db.update('production_logs', p, 'id = ?', [id]);
      if (firstSubmit) await notifyManagers(ctx, id, log.lot_id, S.user.name);
      for (const [key, value] of isManager ? [] : Object.entries(post)) {
        const m = key.match(/maintenance-(\d+)-status/);
        if (!m) continue;
        const up: any = { status: toInt(value) };
        const f = ctx.files[`maintenance-${m[1]}-image`]?.[0];
        if (f && f.size) {
          const u = await uploadImage(ctx, [f], `img/production/${log.lot_id}/`, 500);
          if (!u) { const msg = S.msg?.content; delete S.msg; return jsonExit({ error: msg }); }
          up.image = '/' + u[0].path;
        }
        if (post[`maintenance-${m[1]}-remarks`]) up.remarks = sanitize(post[`maintenance-${m[1]}-remarks`]);
        await db.update('production_maintenance', up, 'id = ? AND shift = ?', [m[1], log.id]);
      }
      r = { action: 'goback' };
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  }

  let maint = '';
  if (level === 2) {
    const ms = await db.selectAll('SELECT pm.id, pm.status, mt.name, image, remarks FROM production_maintenance pm JOIN maintenance_tasks mt ON pm.task = mt.id WHERE pm.shift = ?', [log.id]);
    if (ms.length) {
      maint = '<hr><h3 class="mt1">Maintenance Due</h3>' + ms.map((r: any) => `<div class="card outline mb1"><div class="content"><p><span class="material-icons">engineering</span> <strong>${esc(r.name)}</strong></p>
			<div class="input-field"><div class="segmented-control"><input type="radio" name="maintenance-${r.id}-status" id="maint-${r.id}-0" value="0" required><label for="maint-${r.id}-0">Not done</label>
			<input type="radio" name="maintenance-${r.id}-status" id="maint-${r.id}-1" value="1" disabled><label for="maint-${r.id}-1">Pending</label>
			<input type="radio" name="maintenance-${r.id}-status" id="maint-${r.id}-2" value="2"><label for="maint-${r.id}-2">Done</label></div></div>
			<div class="file-input hide"><input type="file" name="maintenance-${r.id}-image"><label>Picture</label><button type="button" class="btn outline small">Select File</button><span class="file-name">No file selected</span></div>
			<div class="input-field"><textarea name="maintenance-${r.id}-remarks" maxlength="500"></textarea><label>Remarks</label></div></div></div>`).join('');
    }
  }
  const calc = (label: string, id: string) => `<p class="calculated-values"><span class="label">${label}:</span><span id="${id}"></span></p>`;
  const num = (n: string, label: string, extra: string, unit = '') => `<div class="input-field sidelabel">${unit ? `<span class="right-assist">${unit}</span>` : ''}<input type="number" min="0" ${extra} name="${n}" value="${esc(log[n] ?? '')}" required><label>${label}</label></div>`;
  // review window banner (shown to everyone who opens a submitted log)
  let banner = '';
  if (rw) {
    const by = esc(log.created_by_name ?? '');
    banner = rw.overdue
      ? `<div class="text-banner error mb1"><span class="material-icons">schedule</span><p>Submitted ${by ? `by ${by} ` : ''}for manager review — the ${REVIEW_HOURS} hour window ended on ${rw.deadlineText}. It will be auto-approved at the next hourly check if nobody decides.</p></div>`
      : `<div class="text-banner warning mb1"><span class="material-icons">schedule</span><p>Submitted ${by ? `by ${by} ` : ''}for manager review. Approve or correct it by ${rw.deadlineText} (${rw.hoursLeft} hr left) — after that it is approved automatically.</p></div>`;
  }
  const reasonField = isManager ? '<div class="input-field sidelabel"><textarea name="change_reason" rows="2" maxlength="500" required></textarea><label>Reason for change (required if you change any value)</label></div>' : '';
  // change history with timestamps
  const changes = await getLogChanges(id);
  let history = '';
  if (changes.length) {
    history = `<div class="card mb1"><div class="content"><h3>Change history</h3><p class="neutral-color-1"><small>Corrections made after the shift incharge submitted this log.</small></p>
      ${changes.map((c) => `<div class="mb1"><strong>${esc(FIELD_LABELS[c.field] ?? c.field)}</strong>: <span class="error-color">${esc(c.old_value ?? '—')}</span> → <span class="success-color">${esc(c.new_value ?? '—')}</span><br>
      <small>${esc(c.changed_by_name)} • ${date('d M Y h:i A', strtotime(c.changed_at) as number)}${c.reason ? ` • “${esc(c.reason)}”` : ''}</small></div>`).join('')}</div></div>`;
  }
  return {
    metaTitle: `Production Log ${id}`, pageTitle: `Production Log ${id}`, metaDescription: '', subTitle: `${date('d M', strtotime(log.shift_date) as number)} • ${esc(log.shift)}`,
    content: `<section><div class="container"><div class="row center-aligned"><form method="post" class="col xs12 s10 m8 ajax">
	${banner}${num('total_pcs', 'Total pcs', '')}${calc('Total Packs', 'total-packs')}${calc('Production', 'total-production')}
	${num('rejection', 'Rejection', 'step="0.01"', 'kg')}${num('lumps', 'Lumps', 'step="0.01"', 'kg')}${calc('Total Rejection', 'rejection')}${calc('Runtime', 'running-hours')}
	${num('no_plan_time', 'No Plan Time', 'step="0.1"', 'hr')}${calc('Breakdown Time', 'breakdown-time')}
	<div class="input-field sidelabel"><textarea name="breakdown_reason" rows="4" maxlength="200">${esc(log.breakdown_reason ?? '')}</textarea><label>Breakdown Reason</label></div>
	${maint}${reasonField}${level === 2 || isManager ? `<button type="submit" class="btn ${isManager ? 'outline' : 'filled'}">${isManager ? 'Save Correction' : 'Save'}</button>` : ''}${log.total_pcs !== null ? approvals.html : ''}${history}</form></div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms, mgmtApproval} from './js/functions.mjs?v=${V}';
	initInputs(); initAjaxForms(); mgmtApproval();
	function calculateProduction(){
		const totalProduction = parseInt(totalPcsInput.value)*weight/1000;
		const runningHours = (totalProduction/expectedProduction).toFixed(2);
		totalProductionEl.textContent = +totalProduction.toFixed(2)+'kg';
		runningHoursEl.textContent = +runningHours+'hr';
		breakdownTime.textContent = +(${shiftHours} - runningHours - noPlanInput.value).toFixed(2) + 'hr'
	}
	function addTotalRejection(){
		if(!rejectionInput.value.length || !lumpsInput.value.length) return;
		const totalProduction = parseInt(totalPcsInput.value)*weight/1000, totalRejection = parseFloat(rejectionInput.value)+parseFloat(lumpsInput.value), rejectionPercent = +(totalRejection/totalProduction*100).toFixed(1);
		rejection.textContent = +(totalRejection).toFixed(2)+'kg ('+rejectionPercent+'%)';
	}
	const totalPcsInput = document.querySelector('input[name="total_pcs"]'), totalPacks = document.getElementById('total-packs'), totalProductionEl = document.getElementById('total-production'),
		rejectionInput = document.querySelector('input[name="rejection"]'), lumpsInput = document.querySelector('input[name="lumps"]'), rejection = document.getElementById('rejection'),
		runningHoursEl = document.getElementById('running-hours'), breakdownTime = document.getElementById('breakdown-time'), noPlanInput = document.querySelector('input[name="no_plan_time"]'),
		boxSize = ${Number(log.box_size)}, weight = ${Number(log.weight)}, expectedProduction = ${expectedPerHr};
	totalPcsInput.addEventListener('input', () => { totalPacks.textContent = Math.floor(parseInt(totalPcsInput.value)/boxSize); calculateProduction(); });
	rejectionInput.addEventListener('input', addTotalRejection); lumpsInput.addEventListener('input', addTotalRejection); noPlanInput.addEventListener('input', calculateProduction);
	if(totalPcsInput.value.length) totalPcsInput.dispatchEvent(new Event('input'));
	if(rejectionInput.value.length) rejectionInput.dispatchEvent(new Event('input'));
	G('input[type="radio"][name^="maintenance"]').on('change', e => {
		const content = e.target.closest('.content'), image = content.querySelector('.file-input'), remarks = content.querySelector('textarea');
		if(e.target.value === '0'){ image.classList.add('hide'); image.querySelector('input').required = false; remarks.required = true; }
		else { image.classList.remove('hide'); image.querySelector('input').required = true; remarks.required = false; }
	});
</script>`,
  };
}
