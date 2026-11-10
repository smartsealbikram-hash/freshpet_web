import { Ctx, Page, exit, jsonExit } from '@/lib/ctx';
import { compare, hasAccess, hasAccessToRow, sanitize, toInt } from '@/lib/functions';
import { env } from '@/lib/env';
import { esc } from '@/lib/html';
import { noAccess } from '@/lib/adminList';

const html = (s: string) => exit(new Response(s, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
const halt = (m: string) => jsonExit({ message: { type: 'error', content: m }, action: 'halt' });

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, get, now } = ctx;
  if (!hasAccess(ctx, 'view', 'production')) noAccess();
  let title = 'Add Production Log';
  ctx.S.current_page = `${env.SITE_URL}/admin/production-log`;

  if (post.action !== undefined) {
    if (post.action === 'autocomplete') {
      let out = '';
      if (post.name === 'lot_id') for (const r of await db.selectAll('SELECT id, lot_id FROM production_lots WHERE lot_id LIKE ? ORDER BY id DESC LIMIT 5', [sanitize(post.search) + '%'])) out += `<li data-id="${r.id}">${esc(r.lot_id)}</li>`;
      return html(out);
    } else if (post.action === 'load-instances') {
      const rows = await db.selectAll('SELECT pi.id, p.weight, p.type, pi.color FROM production_instances pi JOIN products p ON pi.product = p.id WHERE lot_id = ?', [toInt(post.lot)]);
      return html('<option></option>' + rows.map((r: any) => `<option value="${r.id}">${esc(r.weight)}gms ${esc(r.type)}, ${esc(r.color)}</option>`).join(''));
    } else if (post.action === 'load-instance') {
      const p: any = await db.selectOne('SELECT weight, box_size, cycle_time, cavities FROM production_instances pi JOIN products p ON pi.product = p.id WHERE pi.id = ?', [toInt(post.instance)]);
      const shots = (60 / p.cycle_time) * 60;
      p.expectedProduction = Math.round(((shots * p.cavities * p.weight) / 1000) * 100) / 100;
      return html(JSON.stringify(p));
    }
    return html('');
  }

  let log: any = null, shiftHours: number | undefined;
  if (get.id !== undefined && (await hasAccessToRow(ctx, toInt(get.id), 'production'))) {
    title = 'Edit Production Log';
    const id = toInt(get.id);
    log = await db.selectOne('SELECT plg.*, pl.lot_id, pl.id as lot_id_real, p.* FROM production_logs plg JOIN production_instances pi ON plg.instance_id = pi.id JOIN products p ON pi.product = p.id JOIN production_lots pl ON pi.lot_id = pl.id WHERE plg.id = ?', [id]);
    if (!log) halt('No log found. Please select one from the list.');
    ctx.S.current_page += `?id=${id}`;
    if (Number(log.cycle_time) === 0) halt('Cycle time must be added to product to edit this log.');
    // NOTE: `SELECT plg.*, ..., p.*` makes p.id overwrite plg.id in the PHP row; keep the log id from the URL
    log.expected_production = Math.round((((60 / log.cycle_time) * 60 * log.cavities * log.weight) / 1000) * 100) / 100;
    const sh: any = await db.selectOne('SELECT start_hour, end_hour FROM shifts WHERE name = ?', [log.shift]);
    shiftHours = sh.end_hour - sh.start_hour;
    if (shiftHours <= 0) shiftHours += 24;
  }

  if (post.total_pcs !== undefined) {
    const p: any = {
      instance_id: toInt(post.instance), shift_date: sanitize(post.shift_date), shift: sanitize(post.shift), total_pcs: sanitize(post.total_pcs, 'number'), rejection: sanitize(post.rejection, 'number'), lumps: sanitize(post.lumps, 'number'),
      mold_change_time: Number(sanitize(post.mold_change_time, 'number')) || 0, no_plan_time: Number(sanitize(post.no_plan_time, 'number')) || 0, breakdown_reason: sanitize(post.breakdown_reason), date_added: now, created_by: toInt(post.shift_incharge),
    };
    const expPerHr = Math.round((((60 / post.cycle_time) * 60 * post.cavities * post.weight) / 1000) * 100) / 100;
    if (shiftHours === undefined) {
      const sh: any = await db.selectOne('SELECT start_hour, end_hour FROM shifts WHERE name = ?', [p.shift]);
      shiftHours = sh.end_hour - sh.start_hour;
      if (shiftHours <= 0) shiftHours += 24;
    }
    shiftHours -= p.mold_change_time + p.no_plan_time;
    const prod = (p.total_pcs * post.weight) / 1000;
    p.good_pack = Math.floor(p.total_pcs / post.box_size);
    p.production = prod;
    p.rejection_percent = prod ? ((Number(p.rejection) + Number(p.lumps)) / prod) * 100 : 0;
    p.expected_production = expPerHr * shiftHours;
    p.running_hrs = Math.round((prod / expPerHr) * 100) / 100;
    p.breakdown_time = shiftHours - p.running_hrs;
    let r: any = {};
    try {
      if (get.id !== undefined && hasAccess(ctx, 'edit', 'production') && (await hasAccessToRow(ctx, toInt(get.id), 'production'))) await db.update('production_logs', p, 'id = ?', [toInt(get.id)]);
      else if (get.id === undefined && hasAccess(ctx, 'add', 'production')) await db.insert('production_logs', p);
      else throw new Error('You do not have permission for this operation');
      if (get.id === undefined) { if (post.another !== undefined) r = { message: { type: 'snackbar', content: 'Log Saved.' }, action: 'refresh' }; else r.action = 'goback'; }
    } catch (e: any) { r = { message: { type: 'warning', content: e.message } }; }
    return jsonExit(r);
  }

  const users = await db.selectAll('SELECT id, name FROM users WHERE access_level = 3 AND role = 13 AND status = 2');
  let instOpts = '';
  if (log) for (const r of await db.selectAll('SELECT pi.id, p.weight, p.type, pi.color FROM production_instances pi JOIN products p ON pi.product = p.id WHERE lot_id = ?', [log.lot_id_real])) instOpts += `<option value="${r.id}"${compare(r.id, log.instance_id, ' selected')}>${esc(r.weight)}gms ${esc(r.type)}, ${esc(r.color)}</option>`;
  const v = (k: string) => esc(log?.[k] ?? '');
  const num = (n: string, label: string, extra: string, unit = '') => `<div class="input-field sidelabel">${unit ? `<span class="right-assist">${unit}</span>` : ''}<input type="number" min="0" ${extra} name="${n}" value="${v(n)}" required><label>${label}</label></div>`;
  const calc = (label: string, id: string) => `<p class="calculated-values"><span class="label">${label}:</span><span id="${id}"></span></p>`;
  const hid = (n: string) => `<input type="number" step="0.01" name="${n}" value="${v(n)}" hidden>`;
  return {
    metaTitle: title, pageTitle: title, metaDescription: '',
    content: `<section><div class="container"><h1 class="page-title">${esc(title)}</h1><div class="row"><div class="col xs12 m10 l8"><form method="post" class="card ajax"><div class="content">
	<div class="input-field sidelabel"><input type="search" name="lot_id" class="autocomplete" value="${v('lot_id')}" required><label>Lot ID</label><div class="dropdown no-init"><ul class="search-results fill"></ul></div><input type="number" name="lot" value="${v('lot_id_real')}" hidden></div>
	<div class="input-field sidelabel"><select name="instance" required><option></option>${instOpts}</select><label>Instance</label></div>
	<div class="input-field sidelabel"><input type="text" name="shift_date" class="datepicker" value="${v('shift_date')}" required><label>Shift Date</label></div>
	<div class="input-field sidelabel"><select name="shift" required><option></option>${['Shift A', 'Shift B', 'Shift C'].map((s) => `<option value="${s}"${compare(s, log?.shift ?? '', ' selected')}>${s}</option>`).join('')}</select><label>Shift</label></div>
	<div class="input-field sidelabel"><select name="shift_incharge" required><option></option>${users.map((u: any) => `<option value="${u.id}"${compare(u.id, log?.created_by ?? '', ' selected')}>${esc(u.name)}</option>`).join('')}</select><label>Shift Incharge</label></div>
	${num('total_pcs', 'Total pcs', '')}${calc('Total Packs', 'total-packs')}${calc('Production', 'total-production')}
	${num('rejection', 'Rejection', 'step="0.01"', 'kg')}${num('lumps', 'Lumps', 'step="0.01"', 'kg')}${calc('Total Rejection', 'rejection')}${calc('Runtime', 'running-hours')}
	${num('mold_change_time', 'Mold Change Time', 'step="0.01"', 'hr')}${num('no_plan_time', 'No Plan Time', 'step="0.1"', 'hr')}${calc('Breakdown Time', 'breakdown-time')}
	<div class="input-field sidelabel"><textarea name="breakdown_reason" rows="4" maxlength="200">${v('breakdown_reason')}</textarea><label>Breakdown Reason</label></div>
	${hid('box_size')}${hid('weight')}${hid('cycle_time')}${hid('cavities')}${hid('expected_production')}</div>
	<div class="action"><button type="submit" class="btn filled">Save</button>${get.id === undefined ? '<button type="submit" class="btn outline add-another">Save and Add Another</button>' : ''}</div></form></div></div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms, initSearchAutocomplete } from '../js/functions.mjs';
	initInputs(); initSearchAutocomplete(); initAjaxForms();
	function calculateProduction(){
		const totalProduction = parseInt(totalPcsInput.value)*weight/1000;
		const runningHours = (totalProduction/expectedProduction).toFixed(2);
		totalProductionEl.textContent = +totalProduction.toFixed(2)+'kg';
		runningHoursEl.textContent = +runningHours+'hr';
		breakdownTime.textContent = +(${shiftHours ?? 8} - runningHours - moldChangeInput.value - noPlanInput.value).toFixed(2) + 'hr'
	}
	function addTotalRejection(){
		if(!rejectionInput.value.length || !lumpsInput.value.length) return;
		const totalProduction = parseInt(totalPcsInput.value)*weight/1000, totalRejection = parseFloat(rejectionInput.value)+parseFloat(lumpsInput.value), rejectionPercent = +(totalRejection/totalProduction*100).toFixed(1);
		rejection.textContent = +(totalRejection).toFixed(2)+'kg ('+rejectionPercent+'%)';
	}
	const totalPcsInput = document.querySelector('input[name="total_pcs"]'), totalPacks = document.getElementById('total-packs'), totalProductionEl = document.getElementById('total-production'),
		rejectionInput = document.querySelector('input[name="rejection"]'), lumpsInput = document.querySelector('input[name="lumps"]'), rejection = document.getElementById('rejection'),
		runningHoursEl = document.getElementById('running-hours'), breakdownTime = document.getElementById('breakdown-time'), moldChangeInput = document.querySelector('input[name="mold_change_time"]'),
		noPlanInput = document.querySelector('input[name="no_plan_time"]'), instanceInput = document.querySelector('select[name="instance"]'), boxSizeInput = document.querySelector('input[name="box_size"]'),
		weightInput = document.querySelector('input[name="weight"]'), cavitiesInput = document.querySelector('input[name="cavities"]'), cycleTimeInput = document.querySelector('input[name="cycle_time"]'),
		expectedProductionInput = document.querySelector('input[name="expected_production"]');
	let boxSize = parseInt(boxSizeInput.value), weight = parseFloat(weightInput.value), expectedProduction = parseFloat(expectedProductionInput.value);
	document.querySelector('input[name="lot"]').addEventListener('input', e => {
		G.ajax({ type: 'POST', data: { action: 'load-instances', lot: e.target.value } }).then(data => { instanceInput.innerHTML = data.responseText; G(instanceInput).selectInput('reload'); }).catch(xhr => { console.log('Failed', xhr); G.snackbar('An error occurred.'); });
	});
	instanceInput.addEventListener('change', () => {
		G.ajax({ type: 'POST', data: { action: 'load-instance', instance: instanceInput.value } }).then(data => {
			const response = JSON.parse(data.responseText);
			boxSizeInput.value = boxSize = parseInt(response.box_size); weightInput.value = weight = parseFloat(response.weight);
			cycleTimeInput.value = response.cycle_time; cavitiesInput.value = response.cavities;
			expectedProductionInput.value = expectedProduction = parseFloat(response.expectedProduction);
			calculateProduction();
		}).catch(xhr => { console.log('Failed', xhr); G.snackbar('An error occurred.'); });
	});
	totalPcsInput.addEventListener('input', () => { totalPacks.textContent = Math.floor(parseInt(totalPcsInput.value)/boxSize); calculateProduction(); });
	moldChangeInput.addEventListener('input', () => { calculateProduction(); });
	rejectionInput.addEventListener('input', () => { addTotalRejection(); }); lumpsInput.addEventListener('input', () => { addTotalRejection(); });
	if(totalPcsInput.value.length) totalPcsInput.dispatchEvent(new Event('input'));
	if(rejectionInput.value.length) rejectionInput.dispatchEvent(new Event('input'));
</script>`,
  };
}
