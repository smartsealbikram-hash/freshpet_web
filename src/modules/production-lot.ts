import { Ctx, Page, exit, jsonExit } from '@/lib/ctx';
import { productionInstanceStatusLegend, productionStatusLegend } from '@/lib/config';
import { date, number_format, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { Account } from '@/lib/account';
import { compare, getApprovals, getFinancialYear, sanitize, sendNotification, timeSince, toInt } from '@/lib/functions';
import { P, SITE_URL, V, halt, msgWarn, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now, today } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  const level = P(ctx, 'production_instances');
  if (level === 0) halt('You do not have access to this item.');

  let pageTitle = 'Add Production Planning', id = 0, lot: any;
  S['current-page'] = 'production-lot';
  const html = (s: string) => exit(new Response(s, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  const role = Number(S.user.role);

  if (ctx.get.id !== undefined) {
    id = toInt(ctx.get.id);
    lot = await db.selectOne('SELECT plt.*, m.name as machine_name FROM production_lots plt JOIN machines m ON plt.machine = m.id WHERE plt.id = ?', [id]);
    if (!lot) notFound();
    pageTitle = lot.lot_id;
    S['current-page'] += `?id=${id}`;

    if (post.action !== undefined) {
      let response: any = {};
      if (post.action !== 'close') {
        if (post.action === 'load-materials') {
          let mats: any[];
          if (post.instance !== undefined) mats = await db.selectAll('SELECT bag_no, weight, pm.date_added, u.name as added_by FROM production_materials pm JOIN users u ON pm.added_by = u.id WHERE instance = ?', [toInt(post.instance)]);
          else mats = await db.selectAll('SELECT bag_no, weight, pm.date_added, u.name as added_by FROM production_materials pm JOIN production_instances pi ON pm.instance = pi.id JOIN users u ON pm.added_by = u.id WHERE lot_id = ?', [toInt(post.lot)]);
          return html(mats.map((r) => `<div class="card outline mb1"><div class="content"><dl class="horizontal no-margin"><dt>Bag No.</dt><dd>${esc(r.bag_no)}</dd><dt>Weight</dt><dd>${esc(r.weight)}kg</dd><dt>Date Loaded</dt><dd>${date('d M Y h:i A', strtotime(r.date_added) as number)} (${esc(r.added_by)})</dd></dl></div></div>`).join(''));
        } else if (post.action === 'load-timeline') {
          const instances = await db.selectAll('SELECT pi.*, p.weight, p.type FROM production_instances pi JOIN products p ON pi.product = p.id WHERE lot_id = ? ORDER BY pi.id DESC', [id]);
          const doers: any[] = [lot.created_by, lot.ended_by];
          for (const r of instances) doers.push(r.accepted_by, r.resin_load_by, r.mould_change_by, r.started_by, r.loading_stopped_by, r.machine_stopped_by, r.ended_by, r.ordered_stop_by);
          const ids = doers.filter(Boolean);
          const names: Record<number, string> = {};
          if (ids.length) for (const u of await db.selectAll(`SELECT id, name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids)) names[u.id] = u.name;
          const tl: Record<number, string> = {};
          const fmt = (t: number) => date('d M y h:iA', t);
          const item = (label: string, t: number, who: any, extra = '') => `<li><div class="content"><p class="h-split"><span class="neutral-color-4">${label}</span><span class="neutral-color-2">${fmt(t)}</span></p>${esc(names[who] ?? '')}${extra}</div></li>`;
          let t = strtotime(lot.date_created) as number;
          tl[t] = item('Lot Created', t, lot.created_by);
          if (lot.date_ended !== null) { t = strtotime(lot.date_ended) as number; tl[t] = item('Lot Ended', t, lot.ended_by); }
          for (const r of instances) {
            if (r.ordered_stop_by !== null) { t = strtotime(r.date_ordered_stop) as number; tl[t] = item('Ordered to Stop', t, r.ordered_stop_by); }
            if (r.ended_by !== null) { t = strtotime(r.date_ended) as number; tl[t] = item(`Closed #${r.id}`, t, r.ended_by); }
            if (r.machine_stopped_by !== null) { t = strtotime(r.date_machine_stopped) as number; tl[t] = item('Machine Stopped', t, r.machine_stopped_by); }
            if (r.loading_stopped_by !== null) { t = strtotime(r.date_loading_stopped) as number; tl[t] = item('Loading Stopped', t, r.loading_stopped_by); }
            if (r.started_by !== null) { t = strtotime(r.date_started) as number; tl[t] = item('Started', t, r.started_by); }
            if (r.mould_change_by !== null) {
              t = strtotime(r.date_mould_changed) as number;
              if (r.started_by !== null) tl[t + 1] = `<li class="duration"><div class="content"><p class="h-split"><span class="neutral-color-4">Duration</span><span class="neutral-color-2">${timeSince(r.date_started, r.date_mould_changed)}</span></p></div></li>`;
              tl[t] = item(`Mould Change<br>${esc(r.weight)}gm ${esc(r.type)}`, t, r.mould_change_by);
            }
            if (r.resin_load_by !== null) { t = strtotime(r.date_resin_load) as number; tl[t] = item('Resin Loaded', t, r.resin_load_by); }
            if (r.accepted_by !== null) { t = strtotime(r.date_accepted) as number; tl[t] = item(`Accepted #${r.id}`, t, r.accepted_by); }
          }
          return html('<ul class="list compact timeline">' + Object.keys(tl).map(Number).sort((a, b) => b - a).map((k) => tl[k]).join('') + '</ul>');
        } else if (level === 3 || role === 13 || role === 18) {
          const instanceId = toInt(post.id);
          const product: any = await db.selectOne('SELECT weight, type, color, quantity FROM production_instances pi JOIN products p ON pi.product = p.id WHERE pi.id = ?', [instanceId]);
          try {
            const a = post.action;
            if (a === 'accept') {
              await db.update('production_instances', { status: 2, accepted_by: ctx.userId, date_accepted: now }, 'id = ?', [instanceId]);
              if (lot.status == 2) await db.update('production_lots', { status: 3 }, 'id = ?', [id]);
            } else if (a === 'resin-load') {
              await db.update('production_instances', { status: 3, resin_load_by: ctx.userId, date_resin_load: now }, 'id = ?', [instanceId]);
              if (lot.status == 3) await db.update('production_lots', { status: 4 }, 'id = ?', [id]);
            } else if (a === 'mould-change') {
              if (await db.selectOne('SELECT pi.id FROM production_instances pi JOIN production_lots pl ON pi.lot_id = pl.id WHERE machine = ? AND pl.status = 5 AND pi.status = 5', [lot.machine]))
                throw new Error('There are active instances on this or another lot. Close all running instances before starting mould change.');
              await db.update('production_instances', { status: 4, mould_change_by: ctx.userId, date_mould_changed: now }, 'id = ?', [instanceId]);
            } else if (a === 'start') {
              if (await db.count('production_lots', 'machine = ? AND id != ? AND status BETWEEN 2 AND 5', [lot.machine, lot.id])) throw new Error('Close previous lot to start this one.');
              await db.update('production_instances', { status: 5, started_by: ctx.userId, date_started: now }, 'id = ?', [instanceId]);
              if (lot.status == 4) await db.update('production_lots', { status: 5 }, 'id = ?', [id]);
              const hour = parseInt(date('G'), 10);
              let cur: any = null;
              for (const s of await db.selectAll('SELECT name, start_hour, end_hour FROM shifts WHERE status = 2')) {
                if (s.start_hour < s.end_hour) { if (hour >= s.start_hour && hour <= s.end_hour) cur = s; }
                else if ((hour >= s.start_hour && hour <= 23) || (hour >= 0 && hour <= s.end_hour)) cur = s;
              }
              let shiftDate = today;
              if (cur && cur.start_hour > cur.end_hour && hour < cur.end_hour) shiftDate = date('Y-m-d', strtotime('yesterday') as number);
              await db.insert('production_logs', { instance_id: instanceId, shift: cur?.name, shift_date: shiftDate, start_hour: cur?.start_hour, end_hour: cur?.end_hour });
            } else if (a === 'loading-stop') await db.update('production_instances', { status: 6, loading_stopped_by: ctx.userId, date_loading_stopped: now }, 'id = ?', [instanceId]);
            else if (a === 'machine-stop') await db.update('production_instances', { status: 7, machine_stopped_by: ctx.userId, date_machine_stopped: now }, 'id = ?', [instanceId]);
            else if (a === 'finish') {
              if (await db.selectOne('SELECT id FROM production_logs WHERE instance_id = ? AND production IS NULL', [instanceId])) throw new Error('There are pending shift logs on this instance. Enter all pending logs before closing the instance.');
              await db.update('production_instances', { status: 8, ended_by: ctx.userId, date_ended: now }, 'id = ?', [instanceId]);
              await db.delete('approvals', "entity_type = 'production_instances' AND entity_id = ?", [instanceId]);
            } else if (a === 'stop-order') {
              await db.update('production_instances', { ordered_stop_by: ctx.userId, date_ordered_stop: now }, 'id = ?', [instanceId]);
              const si = await db.selectAll('SELECT ud.tag FROM users u LEFT JOIN user_devices ud ON u.id = ud.user WHERE u.status = 2 AND (role = 13 OR role = 18) AND tag IS NOT NULL');
              if (si.length) await sendNotification(ctx, si.map((r: any) => r.tag), `⚠️ Stop Production of ${lot.lot_id}`, `${S.user.name} has ordered to immediately stop production on this lot`, `${SITE_URL}/production-lot?id=${id}`);
            }
            if (level !== 3) {
              const emp = new Account(ctx); emp.id = lot.created_by;
              const cs: any = await emp.checkCommSettings(4);
              if (cs.push_enabled) await sendNotification(ctx, cs.push_devices, `Production instance on ${lot.lot_id} ${a}ed by ${S.user.name}`, `${product.quantity}MT of ${product.weight}gm ${product.type} (${product.color})`, `${SITE_URL}/production-instance?id=${id}`);
            }
            response = { action: 'goback' };
          } catch (e) { response = msgWarn(e); }
        } else response.message = { type: 'error', content: 'You are not allowed to do this.' };
      } else {
        try {
          if (!(role === 15 || role === 17 || level === 3)) throw new Error('You are not allowed to do this.');
          if (await db.selectOne('SELECT id FROM production_instances WHERE lot_id = ? AND status BETWEEN 1 AND 5', [id])) throw new Error('There are running instances. Close all instances before closing the lot');
          await db.update('production_lots', { status: 6, ended_by: ctx.userId, date_ended: now }, 'id = ?', [id]);
          response = { action: 'goback' };
        } catch (e) { response = msgWarn(e); }
      }
      return jsonExit(response);
    }
  }

  if (post.machine !== undefined) {
    if (level < 2) return jsonExit({ error: 'Permission error. Please contact your supervisor' });
    const p: any = { machine: toInt(post.machine), packaging: sanitize(post.packaging), resin: sanitize(post.resin), status: toInt(post.status) };
    let response: any;
    try {
      if (ctx.get.id !== undefined) {
        id = toInt(ctx.get.id);
        await db.update('production_lots', p, 'id = ?', [id]);
        if (p.status === -1) {
          await db.delete('production_lots', 'id = ?', [id]);
          await db.delete('production_instances', 'lot_id = ?', [id]);
          response = { redirect: 'production_lots' };
        } else if (p.status === 2) {
          const ins = await db.selectAll('SELECT id FROM production_instances WHERE lot_id = ? AND status <= 4', [id]);
          if (ins.length) await db.update('production_instances', { status: 1 }, `id IN (${ins.map(() => '?').join(',')})`, ins.map((r: any) => r.id));
        }
      } else {
        const fy = getFinancialYear();
        const mp: any = await db.selectOne('SELECT id_prefix FROM machines WHERE id = ?', [p.machine]);
        const prefix = mp.id_prefix + fy;
        const last: any = await db.selectOne("SELECT lot_id FROM production_lots WHERE machine = ? AND date_created >= ? AND status > 0 ORDER BY id DESC", [p.machine, `${fy}-04-01`]);
        const seq = last ? parseInt(String(last.lot_id).substring(3), 10) + 1 : 1;
        p.lot_id = prefix + String(seq).padStart(3, '0');
        p.created_by = ctx.userId; p.date_created = now;
        id = await db.insert('production_lots', p);
        response = { redirect: `production-lot?id=${id}` };
      }
      const title = ctx.get.id === undefined ? 'New production planning created' : `Production planning ${lot.lot_id} has been updated.`;
      const devs = await db.selectAll("SELECT tag FROM users u JOIN staff_permissions sp ON u.role = sp.role AND sp.type = 'production_instances' LEFT JOIN user_devices ud ON u.id = ud.user WHERE u.status = 2 AND access_level = 3 AND (sp.access = 3 OR u.role = 13) AND tag IS NOT NULL");
      if (devs.length) await sendNotification(ctx, devs.map((r: any) => r.tag), title, '', `${SITE_URL}/production-lot?id=${id}`);
      response ??= { action: 'goback' };
    } catch (e) { response = msgWarn(e); }
    return jsonExit(response);
  }

  // ------------------------------------------------------------------ view
  const css = '<style type="text/css">.card > .dropdown-content { max-height: none !important; }</style>';
  let body: string;
  if (level >= 2 && !(lot?.status > 3) && ctx.get.edit !== undefined) {
    const machines = await db.selectAll('SELECT id, name FROM machines WHERE status = 2 AND location = ?', [ctx.settings.location]);
    const resins = await db.selectAll('SELECT id, name FROM resins WHERE status = 2');
    body = `<form method="post" class="col xs12 s10 m8 ajax">
		<div class="input-field sidelabel"><select name="machine" required><option></option>${machines.map((r: any) => `<option value="${r.id}"${compare(r.id, lot?.machine ?? '', ' selected')}>${esc(r.name)}</option>`).join('')}</select><label>Machine</label></div>
		<div class="input-field sidelabel"><p class="label">Packaging</p><div class="segmented-control"><input type="radio" name="packaging" id="packaging-active" value="Boxes"${compare('Boxes', lot?.packaging ?? '', ' checked')} required><label for="packaging-active">Boxes</label><input type="radio" name="packaging" id="packaging-inactive" value="Bags"${compare('Bags', lot?.packaging ?? '', ' checked')}><label for="packaging-inactive">Bags</label></div></div>
		<div class="input-field sidelabel"><select name="resin" required><option></option>${resins.map((r: any) => `<option value="${esc(r.name)}"${compare(r.name, lot?.resin ?? '', ' selected')}>${esc(r.name)}</option>`).join('')}</select><label>Resin</label></div>
		<div class="input-field sidelabel"><p class="label">Status</p><div class="segmented-control">
			<input type="radio" name="status" id="status-active" value="2"${compare(2, lot?.status ?? '', ' checked')} required><label for="status-active">Active</label>
			<input type="radio" name="status" id="status-inactive" value="1"${compare(1, lot?.status ?? '', ' checked')}><label for="status-inactive">On Hold</label>
			<input type="radio" name="status" id="status-cancel" value="0"${compare(0, lot?.status ?? '', ' checked')}><label for="status-cancel">Cancel</label>
			${ctx.get.id !== undefined && lot.status <= 2 ? '<input type="radio" name="status" id="status-delete" value="-1"><label for="status-delete">Delete</label>' : ''}</div></div>
		<button type="submit" class="btn filled">Save</button></form>`;
  } else {
    if (!lot) notFound();
    const hasOther = !!(await db.selectOne('SELECT id FROM production_instances WHERE lot_id = ? AND status >= 3', [id]));
    const instances = await db.selectAll('SELECT pi.*, p.weight, p.type FROM production_instances pi JOIN products p ON pi.product = p.id WHERE lot_id = ? ORDER BY pi.id DESC', [id]);
    let cards = '';
    for (const row of instances) {
      if (row.status == 0 && level < 3) continue;
      let c = `<div class="card mb1 instance"><div class="content"><h3 class="no-margin" style="padding-right: 3rem;">${esc(row.weight)}gms ${esc(row.type)} (${esc(row.color)}) <span class="neutral-color-5">#${row.id}</span></h3><span class="chip">${productionInstanceStatusLegend[row.status]}</span>`;
      if (level === 3 && row.created_by == S.user.id && lot.status <= 5) c += ` <a href="production-instance?id=${row.id}" class="btn outline small"><span class="material-icons left-icon">edit</span>Edit</a></p>`;
      if (row.status >= 5 && row.status <= 6 && row.ordered_stop_by !== null) c += '<p class="error-color">🛑 Stop production immediately</p>';
      c += `<button type="button" class="btn icon outline toggle-off dropdown-trigger"><span class="material-icons">expand_more</span></button></div><div class="dropdown-content"><ul class="grid">
			<li><small>LDR</small>${esc(row.ldr)}</li><li><small>Quantity</small>${esc(row.quantity)}MT</li><li><small>Production Start</small>${date('d M Y', strtotime(row.date_production) as number)}</li>`;
      if (row.remarks) c += `<li><small>Remarks</small>${esc(row.remarks)}</li>`;
      c += '</ul>';
      if (row.status == 0) c += (await getApprovals(ctx, 'production_instances', row.id, 1)).html.replace('card', 'card flat mt1');
      if (row.status >= 5) {
        const logs = await db.selectAll('SELECT shift_date, SUM(production) production, SUM(total_pcs) total_pcs, SUM(good_pack) good_pack, SUM(rejection+lumps) total_rejection, MAX(breakdown_time) breakdown_time FROM production_logs WHERE instance_id = ? GROUP BY shift_date ORDER BY shift_date DESC', [row.id]);
        if (logs.length) {
          let tp = 0, tprod = 0, tpacks = 0, trej = 0, pct = 0;
          let lh = '<h4 class="mt2">Logs</h4><hr><ul class="list right-assist link-list">';
          for (const l of logs) {
            tp += Number(l.total_pcs); tprod += Number(l.production); tpacks += Number(l.good_pack); trej += Number(l.total_rejection);
            lh += `<li data-url="production-logs?ins=${row.id}&date=${l.shift_date}"><div class="content"><p>${date('d M Y', strtotime(l.shift_date) as number)}${l.breakdown_time >= 0.8 ? ' <span class="material-icons warning-color">warning</span>' : ''}</p></div><div class="right-assist">`;
            if (l.production !== null) lh += `${l.production}kg<br><span class="${l.total_rejection == 0 ? 'success-color' : l.total_rejection > 1 ? 'error-color' : ''}">${l.total_rejection}kg</span>`;
            lh += '</div></li>';
          }
          lh += '</ul>';
          if (tprod) pct = Math.round((trej / tprod) * 1000) / 10;
          c += `<h4 class="mt2">Summary</h4><hr><ul class="grid"><li><small>Pcs</small>${number_format(tp)}</li><li><small>Production</small>${number_format(tprod, 2)}kgs</li><li><small>Good Packs</small>${tpacks} boxes/bags</li><li><small>Rejection</small>${trej}kgs (${pct}%)</li>`;
          if (row.status == 8) {
            const bags = await db.count('production_materials', 'instance = ?', [row.id]);
            const calc = bags * 1200 - tprod;
            c += `<li><small>Resin Loaded</small>${bags * 1200}kg</li><li><small>Calculated Rejection</small>${number_format(calc)}kg (${Math.round((calc / tprod) * 1000) / 10}%)</li><li><small>Effective Preform Wt.</small>${Math.round(((tprod * 1000) / tp) * 100) / 100}gm</li>`;
          }
          c += '</ul>' + lh;
        }
      }
      c += '</div>';
      let actions = '';
      const btn = (act: string, label: string, extra = '') => `<button type="button" class="btn filled${extra} send-action" data-action="${act}" data-id="${row.id}">${label}</button>`;
      if (lot.status >= 2 && lot.status <= 5) {
        if (role === 13 || role === 18) {
          let st = row.status;
          if (st == 1) actions += btn('accept', 'Accept');
          else if (st == 2) { if (!hasOther) actions += btn('resin-load', 'Load Resin'); else st = 3; }
          if (st == 3) {
            const prevLot: any = await db.selectOne('SELECT id FROM production_lots WHERE status = 6 AND machine = ? ORDER BY id DESC LIMIT 1', [lot.machine]);
            let q = 'SELECT product FROM production_instances WHERE (lot_id = ?';
            const a: any[] = [id];
            if (prevLot) { q += ' OR lot_id = ?'; a.push(prevLot.id); }
            const prevIns: any = await db.selectOne(q + ') AND id < ? ORDER BY id DESC LIMIT 1', [...a, row.id]);
            if (!(prevIns && prevIns.product == row.product)) actions += btn('mould-change', 'Start Mould Change'); else st = 4;
          }
          if (st == 4) actions += btn('start', 'Start Production');
          else if (st == 5) actions += btn('loading-stop', 'Stop Loading');
          else if (st == 6) actions += btn('machine-stop', 'Stop Machine');
          else if (st == 7) actions += btn('finish', 'Close Instance');
        } else if (S.user.department == 10 && row.status >= 5 && row.status <= 6) actions += btn('stop-order', 'Stop Production', ' error-bg');
      }
      cards += c + (actions ? `<div class="action">${actions}</div>` : '') + '</div>';
    }
    body = `<div class="col xs12 s10 m8"><dl class="horizontal"><dt>Machine</dt><dd>${esc(lot.machine_name)}</dd><dt>Packaging</dt><dd>${esc(lot.packaging)}</dd>
		<dt>Resin</dt><dd>${esc(lot.resin)} <button type="button" class="btn outline small view-materials" data-lot="${lot.id}">View Loaded Bags</button></dd>
		<dt>Status</dt><dd>${productionStatusLegend[lot.status]}</dd><dt>Timeline</dt><dd><button type="button" class="btn outline small" id="view-timeline">View</button></dd></dl>
		${level >= 2 && lot.status <= 3 ? `<p><a href="${S['current-page']}&edit=1" class="btn small outline"><span class="material-icons">edit</span> Edit Lot</a></p>` : ''}
		<h2 class="mt2">Instances</h2>${cards}
		<div class="center">${(role === 15 || role === 17) && lot.status == 5 ? '<button type="button" class="btn filled send-action" data-action="close">Lot Closing</button>' : ''}
		${S.user.department == 10 && lot.status <= 5 ? `<a href="production-instance?lot=${lot.id}" class="btn tonal"><span class="material-icons">add</span> Add Instance</a>` : ''}</div></div>`;
  }
  return {
    metaTitle: pageTitle, pageTitle, metaDescription: '', css,
    content: `<section><div class="container"><div id="global-msg-cont"></div><div class="row">${body}</div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms, setupSheet, mgmtApproval, initLinksList } from './js/functions.mjs?v=${V}';
	initInputs(); mgmtApproval(); initAjaxForms(); initLinksList();
	const cards = G('.card.instance').dropdownCard();
	if(cards.length) cards[0].querySelector('.dropdown-trigger').click();
	G('#view-timeline').on('click', e => {
		const sheet = setupSheet('Lot Timeline');
		G.ajax({ type: 'POST', data: { action: 'load-timeline' } }).then(data => { sheet.body.innerHTML = data.responseText; }).catch(xhr => { console.log('Failed', xhr); G.snackbar('An error occurred.'); });
	});
	G('.view-materials').on('click', e => {
		const btn = e.target.closest('.btn');
		const sheet = setupSheet('View Resin');
		const payload = { action: 'load-materials' };
		if('instance' in btn.dataset) payload.instance = btn.dataset.instance;
		if('lot' in btn.dataset) payload.lot = btn.dataset.lot;
		G.ajax({ type: 'POST', data: payload }).then(data => { sheet.body.innerHTML = data.responseText; }).catch(xhr => { console.log('Failed', xhr); G.snackbar('An error occurred.'); });
	});
</script>`,
  };
}
