import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { leaveStatusLegend } from '@/lib/config';
import { date, strtotime, time } from '@/lib/php';
import { esc } from '@/lib/html';
import { compare, getApprovals, sanitize, sendNotification, toInt } from '@/lib/functions';
import { SITE_URL, V, msgWarn, notFound } from '@/lib/h';

const fmtD = (d: any) => date('d M Y', strtotime(d) as number);
const fmtT = (d: any) => date('h:i A', strtotime(d) as number);

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now, today } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();

  let id = 0, pageTitle: string, leave: any, permissionRequired: string, creator: any, approvalsNeeded = 2;
  if (ctx.get.id !== undefined) {
    id = toInt(ctx.get.id);
    leave = await db.selectOne('SELECT la.*, v.id as vehicle_id, v.name as vehicle_name, registration_number, odometer_reading FROM leave_applications la LEFT JOIN vehicles v ON la.vehicle = v.id WHERE la.id = ?', [id]);
    if (!leave) notFound();
    pageTitle = leave.type === 'gate_pass' ? 'Gate Pass Request' : 'Leave Request';
    permissionRequired = leave.type === 'gate_pass' ? 'gate_passes' : 'leaves';
    creator = await db.selectOne('SELECT access, department FROM staff_permissions sp JOIN users u ON sp.role = u.role JOIN staff_roles sr ON u.role = sr.id WHERE u.id = ? AND sp.type = ?', [leave.user, permissionRequired]);
    approvalsNeeded = creator && (creator.access == 3 || creator.department == 1) ? 1 : 2;

    if (post.action !== undefined || post.f_action !== undefined) {
      let response: any = {};
      try {
        if (post.action === 'time_out') {
          const startInt = parseInt(String(leave.start_time).replace(/:/g, ''), 10);
          const endInt = parseInt(String(leave.end_time).replace(/:/g, ''), 10);
          const start = (strtotime(`${leave.start_date} ${leave.start_time}`) as number) - 600;
          let end = (strtotime(`${leave.start_date} ${leave.end_time}`) as number) + 600;
          if (endInt < startInt) end += 86400;
          const cur = time();
          if (cur < start || cur > end) throw new Error('The employee is not approved to leave at this time.');
          const payload: any = { time_out: now, time_out_by: ctx.userId };
          if (leave.no_return) payload.time_in = `${leave.start_date} ${leave.end_time}`;
          await db.update('leave_applications', payload, 'id = ?', [id]);
        } else if (post.action === 'time_in' || post.f_action === 'time_in') {
          const payload: any = { time_in: now, time_in_by: ctx.userId };
          if (post.odometer !== undefined) {
            const odo = Number(sanitize(post.odometer, 'number'));
            if (odo < leave.odometer_reading) throw new Error('Odometer reading is invalid. Check again.');
            payload.vehicle_odometer = odo;
            payload.vehicle_driven = odo - leave.odometer_reading;
            await db.update('vehicles', { odometer_reading: odo, date_updated: now, updated_by: ctx.userId }, 'id = ?', [leave.vehicle_id]);
          }
          await db.update('leave_applications', payload, 'id = ?', [id]);
        }
        response = { action: 'refresh' };
      } catch (e) { response = msgWarn(e); }
      return jsonExit(response);
    }
    if ((post.revoke !== undefined || ctx.get.revoke !== undefined) && leave.user == S.user.id) {
      let response: any = {};
      try { await db.update('leave_applications', { status: 0, date_revoked: now }, 'id = ?', [id]); response = { action: 'refresh' }; } catch (e) { response = msgWarn(e); }
      return jsonExit(response);
    }
  } else {
    const type = ctx.get.type;
    pageTitle = type === 'gate_pass' ? 'Gate Pass Request' : 'Leave Request';
    leave = { type, reason_type: 'personal' };
    permissionRequired = type === 'gate_pass' ? 'gate_passes' : 'leaves';
    creator = { access: S.user.permissions?.[permissionRequired]?.access, department: S.user.department };
  }

  if (post.start_date !== undefined) {
    let response: any = {};
    try {
      const p: any = { reason: sanitize(post.reason), type: sanitize(leave.type), date_requested: now };
      if (post.end_date !== undefined) {
        p.start_date = sanitize(post.start_date);
        p.end_date = post.end_date ? sanitize(post.end_date) : null;
      } else {
        p.start_date = sanitize(post.start_date);
        p.end_date = null;
        p.start_time = date('H:i:s', strtotime(post.start_time) as number);
        p.end_time = date('H:i:s', strtotime(post.end_time) as number);
        p.no_return = post.no_return !== undefined ? 1 : 0;
        p.vehicle = post.need_vehicle !== undefined ? toInt(post.vehicle) : null;
        p.reason_type = sanitize(post.reason_type);
        if (p.start_time === p.end_time) throw new Error('Start and End time can not be the same');
        if (post.need_vehicle !== undefined) {
          let q = 'SELECT id FROM leave_applications WHERE status > 0 AND vehicle = ? AND start_date = ? AND (start_time <= ? AND end_time >= ?) AND time_in IS NULL';
          const a: any[] = [p.vehicle, p.start_date, p.end_time, p.start_time];
          if (ctx.get.id !== undefined) { q += ' AND id != ?'; a.push(id); }
          if (await db.selectOne(q, a)) throw new Error('The vehicle requested is in use at your requested date and time. Please select another vehicle or change time.');
        }
      }
      const exists = 'You already have a pending request. You can edit the current request or wait for a decision on it.';
      const perm = p.type === 'gate_pass' ? 'gate_passes' : 'leaves';
      if (ctx.get.id !== undefined) {
        if (await db.selectOne('SELECT id FROM leave_applications WHERE user = ? AND status = 1 AND id != ? AND type = ?', [S.user.id, id, p.type])) throw new Error(exists);
        await db.update('leave_applications', p, 'id = ?', [id]);
        await db.delete('approvals', 'entity_type = ? AND entity_id = ?', [perm, id]);
      } else {
        if (await db.selectOne('SELECT id FROM leave_applications WHERE user = ? AND status = 1 AND type = ?', [S.user.id, p.type])) throw new Error(exists);
        p.status = 1; p.user = ctx.userId;
        id = await db.insert('leave_applications', p);
      }
      const department = creator.department == 1 && creator.access == 3 ? 10 : creator.department;
      const hod = await db.selectAll("SELECT ud.tag FROM users u JOIN staff_roles sr ON u.role = sr.id JOIN staff_permissions sp ON u.role = sp.role AND sp.type = ? LEFT JOIN user_devices ud ON u.id = ud.user WHERE u.status = 2 AND sr.department = ? AND sp.access = 3 AND tag IS NOT NULL", [perm, department]);
      if (hod.length) {
        const gp = p.type === 'gate_pass';
        let desc = `${S.user.name} has requested a ${gp ? 'gate pass' : 'leave'} for ${p.start_date}`;
        if (gp) desc += ' ' + p.start_time;
        desc += '. Tap to approve/reject';
        await sendNotification(ctx, hod.map((r: any) => r.tag), gp ? 'Gate pass requested by employee' : 'Leave requested by employee', desc, `${SITE_URL}/leave-application?id=${id}`);
      }
      response = { action: 'goback' };
    } catch (e) { response = msgWarn(e); }
    return jsonExit(response);
  }

  let inner: string;
  const isMineOpen = ctx.get.id !== undefined && leave.status == 1 && leave.user == S.user.id;
  if (ctx.get.id !== undefined && !isMineOpen) {
    const ids = [leave.user, leave.time_out_by, leave.time_in_by].filter(Boolean);
    const names: Record<number, string> = {};
    for (const r of await db.selectAll(`SELECT id, name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids)) names[r.id] = r.name;
    let dl = '';
    if (leave.user != S.user.id) dl += `<dt>Employee</dt><dd>${esc(names[leave.user])}</dd>`;
    dl += `<dt>Leave Date</dt><dd>${fmtD(leave.start_date)}${leave.end_date !== null ? ' to ' + fmtD(leave.end_date) : ''}${leave.start_time !== null ? `<br>${fmtT(leave.start_time)} to ${fmtT(leave.end_time)}` : ''}</dd>`;
    if (leave.vehicle !== null) dl += `<dt>Vehicle</dt><dd>${esc(leave.vehicle_name)} (${esc(leave.registration_number)})</dd>`;
    dl += `<dt>Reason</dt><dd>${esc(leave.reason)}</dd><dt>Requested On</dt><dd>${date('d M Y h:i A', strtotime(leave.date_requested) as number)}</dd>`;
    if (leave.status != 1) dl += `<dt>Decision</dt><dd><span class="badge status-${leave.status}">${leave.date_revoked !== null ? 'Revoked by Requestor' : leaveStatusLegend[leave.status]}</span></dd>`;
    if (leave.type === 'gate_pass' && leave.status == 2) {
      const gate = S.user.role == 2 || S.user.department == 10;
      dl += '<dt>Time Out</dt><dd>';
      if (gate && leave.time_out === null) dl += '<button type="button" class="btn outline send-action" data-action="time_out">Mark Employee Out</button>';
      else if (leave.time_out !== null) dl += `${date('d M Y h:i A', strtotime(leave.time_out) as number)} by ${esc(names[leave.time_out_by])}`;
      else dl += 'NA';
      dl += '</dd>';
      if (leave.time_out !== null) {
        dl += '<dt>Time In</dt><dd>';
        if (gate && leave.time_in === null) dl += `<button type="button" class="btn outline ${leave.vehicle ? 'mark-in' : 'send-action" data-action="time_in'}">Mark Employee In</button>`;
        else if (leave.time_in !== null) dl += `${date('d M Y h:i A', strtotime(leave.time_in) as number)} by ${leave.time_in_by ? esc(names[leave.time_in_by]) : '<em>Auto marked</em>'}`;
        else dl += 'NA';
        dl += '</dd>';
      }
      if (leave.vehicle_driven !== null) dl += `<dt>Vehicle Driven</dt><dd>${esc(leave.vehicle_driven)} km</dd>`;
    }
    let approvals: any;
    if (leave.status == 0) approvals = await getApprovals(ctx, permissionRequired, leave.id, approvalsNeeded, 0);
    else {
      if (approvalsNeeded == 2) approvals = await getApprovals(ctx, permissionRequired, leave.id, approvalsNeeded, creator.department);
      if (!(approvals && approvals.approved == 0)) approvals = await getApprovals(ctx, permissionRequired, leave.id, approvalsNeeded, creator.department == 1 ? 10 : 1);
    }
    let extra = '';
    if (leave.status == 2 && S.user.id == leave.user && (strtotime(`${leave.start_date} ${leave.start_time ?? ''}`.trim()) as number) > time() && !(leave.type === 'gate_pass' && leave.time_out !== null))
      extra = `<a href="leave-application?id=${leave.id}&revoke=1" class="btn outline confirm"><span class="material-icons">cancel</span> Revoke Request</a>`;
    inner = `<dl class="horizontal col xs12 s10 m8">${dl}</dl><div class="col xs12 s10 m8">${approvals.html}${extra}</div>`;
  } else {
    let f = '';
    if (leave.type === 'regular') {
      f += `<div class="input-field sidelabel"><input type="text" name="start_date" class="datepicker-future" value="${esc(leave.start_date ?? '')}" required><label>Leave Start Date</label></div>
			<div class="input-field sidelabel"><input type="text" name="end_date" class="datepicker-future" value="${esc(leave.end_date ?? '')}"><label>Leave End Date</label><option class="helper">Optional. Required in case of multi day leave</option></div>`;
    } else {
      const tomorrow = date('Y-m-d', strtotime('tomorrow') as number);
      const vehicles = await db.selectAll('SELECT id, name FROM vehicles');
      const hasV = leave.vehicle !== undefined && leave.vehicle !== null;
      f += `<div class="input-field sidelabel"><select name="start_date" required><option></option>
				<option value="${today}"${compare(today, leave.start_date ?? '', ' selected')}>Today&emsp;${date('d M Y')}</option>
				<option value="${tomorrow}"${compare(tomorrow, leave.start_date ?? '', ' selected')}>Tomorrow&emsp;${fmtD(tomorrow)}</option></select><label>Date</label></div>
			<div class="faux-sidelabel"><p class="label">Time</p><div class="inputs"><div class="row">
				<div class="input-field col xs6"><input type="text" name="start_time" class="timepicker" value="${esc(leave.start_time ?? '')}" required><label>From</label></div>
				<div class="col xs6"><div class="input-field"><input type="text" name="end_time" class="timepicker" value="${esc(leave.end_time ?? '')}" required><label>To</label></div>
				<div class="input-field mtn1"><input type="checkbox" name="no_return" id="no_return"${leave.no_return ? ' checked' : ''}><label for="no_return">Shift ends before return</label></div></div>
			</div></div></div>
			<div class="input-field switch next-input-depends"><input type="checkbox" name="need_vehicle" id="need_vehicle"${hasV ? ' checked' : ''}><label for="need_vehicle">Need to use company vehicle</label></div>
			<div class="input-field sidelabel"${hasV ? '' : ' style="display: none"'}><select name="vehicle" data-required="true"><option></option>${vehicles.map((r: any) => `<option value="${r.id}"${compare(leave.vehicle ?? '', r.id, ' selected')}>${esc(r.name)}</option>`).join('')}</select><label>Vehicle</label></div>
			<div class="input-field sidelabel"><p class="label">Reason Type</p><div class="segmented-control">
				<input type="radio" name="reason_type" value="personal" id="reason_type_personal"${compare('personal', leave.reason_type ?? '', ' checked')} required><label for="reason_type_personal">Personal</label>
				<input type="radio" name="reason_type" value="official" id="reason_type_official"${compare('official', leave.reason_type ?? '', ' checked')} required><label for="reason_type_official">Official</label></div></div>`;
    }
    f += `<div class="input-field sidelabel"><textarea name="reason" required>${esc(leave.reason ?? '')}</textarea><label>Reason</label></div>`;
    if (ctx.get.id !== undefined) {
      const a = await getApprovals(ctx, permissionRequired, leave.id, approvalsNeeded);
      f += a.html + '<div class="input-field switch"><input type="checkbox" name="revoke" id="revoke"><label for="revoke">Revoke request</label></div>';
    }
    inner = `<form method="post" class="col xs12 s10 m8 ajax">${f}<button type="submit" class="btn filled">Save</button><div id="global-msg-cont"></div></form>`;
  }

  return {
    metaTitle: pageTitle, pageTitle, metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned">${inner}</div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms, nextInputDepends, processAjaxForm, mgmtApproval } from './js/functions.mjs?v=${V}';
	initInputs(); initAjaxForms(); mgmtApproval();
	G('.timepicker').datepicker({ type: 'time' });
	G('.datepicker-future').datepicker({ startDate: dayjs() });
	G('.next-input-depends').on('change', (e) => { nextInputDepends(e); });
	${leave.vehicle ? `G('.mark-in').on('click', () => {
		G.dialog({
			title: 'Mark In',
			description: \`<p>Enter odometer rating of ${esc(leave.vehicle_name)}</p><form method="post"><input type="text" name="f_action" value="time_in" hidden><div class="input-field"><span class="right-assist">km</span><input type="tel" name="odometer" required><label>Odometer</label></div></form>\`,
			onLoad: function(d){ G(d.querySelector('.input-field input')).textInput(); },
			confirmingAction: { text: 'Mark In', onPress: function(d){ const form = d.querySelector('form'); if(form.checkValidity()){ processAjaxForm(form).then(() => {}).catch(() => {}); } else return false; } },
			dismissiveAction: { text: 'Cancel' }
		});
	});` : ''}
</script>`,
  };
}
