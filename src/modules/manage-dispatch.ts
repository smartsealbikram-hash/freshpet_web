import { Ctx, Page, exit, jsonExit } from '@/lib/ctx';
import { esc } from '@/lib/html';
import { compare, sanitize, sendNotification, toInt } from '@/lib/functions';
import { P, SITE_URL, V, halt, msgWarn, notFound, text } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'dispatches') < 2) halt('You do not have access to this item.');
  let pageTitle = 'Create Dispatch', dispatch: any;
  const html = (s: string) => exit(new Response(s, { headers: { 'content-type': 'text/html; charset=utf-8' } }));

  if (post.action !== undefined) {
    if (post.action === 'load-transporters') {
      const ts = await db.selectAll('SELECT t.id, t.name FROM transport_cost tc JOIN transporters t ON tc.transporter = t.id WHERE tc.client = ? AND t.status = 2 AND (truck_19 IS NOT NULL OR truck_32_mtxl IS NOT NULL OR other IS NOT NULL)', [toInt(post.client)]);
      return html('<option></option>' + ts.map((r: any) => `<option value="${r.id}"${compare(r.id, post.transporter, ' selected')}>${esc(r.name)}</option>`).join(''));
    } else if (post.action === 'load-vehicles') {
      const c: any = await db.selectOne('SELECT * FROM transport_cost tc WHERE client = ? AND transporter = ?', [toInt(post.client), toInt(post.transporter)]);
      let out = '<option></option>';
      if (c && c.truck_19 !== null) out += `<option value="19"${compare(19, post.vehicle, ' selected')}>19ft Single Axle</option>`;
      if (c && c.truck_32_mtxl !== null) out += `<option value="32"${compare(32, post.vehicle, ' selected')}>32ft Multi Axle</option>`;
      if (c && c.other !== null) out += `<option value="0"${compare(0, post.vehicle, ' selected')}>Other</option>`;
      return html(out);
    }
    return exit(new Response(''));
  } else if (post.location !== undefined) {
    const p: any = {
      location: post.location !== undefined ? toInt(post.location) : S.user.location,
      category: post.category !== undefined ? toInt(post.category) : S.user.department == 9 ? 1 : 2,
      date_of_dispatch: sanitize(post.date_of_dispatch), party_name: toInt(post.party_name), vehicle_size: toInt(post.vehicle_size),
      vehicle_number: sanitize(post.vehicle_number).toUpperCase(), transporter: toInt(post.transporter), sales_quotation: sanitize(post.sales_quotation),
    };
    let r: any = {};
    try {
      const col = p.vehicle_size === 19 ? 'truck_19' : p.vehicle_size === 32 ? 'truck_32_mtxl' : 'other';
      const cost: any = await db.selectOne(`SELECT ${col} FROM transport_cost tc WHERE client = ? AND transporter = ?`, [p.party_name, p.transporter]);
      if (cost && cost[col] !== null && cost[col] !== undefined) p.cost = cost[col];
      else throw new Error('Select a valid transporter and vehicle size.');
      if (ctx.get.id !== undefined) await db.update('dispatches', p, 'id = ?', [toInt(ctx.get.id)]);
      else {
        Object.assign(p, { status: 1, date_created: now, added_by: S.user.id });
        const id = await db.insert('dispatches', p);
        const devs = await db.selectAll('SELECT tag FROM users u JOIN staff_roles sr ON u.role = sr.id LEFT JOIN user_devices ud ON u.id = ud.user WHERE status = 2 AND access_level = 3 AND location = ? AND department = 3 AND tag IS NOT NULL', [p.location]);
        if (devs.length) await sendNotification(ctx, devs.map((d: any) => d.tag), `New dispatch has been created for ${p.date_of_dispatch}`, '', `${SITE_URL}/dispatch?id=${id}`);
      }
      r = { action: 'goback' };
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  } else if (ctx.get.id !== undefined) {
    dispatch = await db.selectOne('SELECT * FROM dispatches WHERE id = ? AND status = 1', [toInt(ctx.get.id)]);
    if (!dispatch) notFound();
    pageTitle = 'Edit Dispatch';
  }

  let loc = '', cat = '';
  if (S.user.role == 6 || S.user.department == 10) {
    const locs = await db.selectAll('SELECT id, name FROM locations');
    loc = `<div class="input-field sidelabel"><select name="location" required><option></option>${locs.map((r: any) => `<option value="${r.id}"${compare(r.id, dispatch?.location ?? '', ' selected')}>${esc(r.name)}</option>`).join('')}</select><label>Location</label></div>`;
  }
  if (S.user.department == 10)
    cat = `<div class="input-field sidelabel"><p class="label">Category</p><div class="segmented-control"><input type="radio" name="category" value="1" id="category1"${compare(1, dispatch?.category ?? '', ' checked')} required><label for="category1">Client</label><input type="radio" name="category" value="2" id="category2"${compare(2, dispatch?.category ?? '', ' checked')} required><label for="category2">Warehouse</label></div></div>`;
  let cq = 'SELECT id, name FROM clients WHERE status = 2';
  const ca: any[] = [];
  if (S.user.department != 10) { cq += ' AND sales_associate = ?'; ca.push(ctx.userId); }
  const clients = await db.selectAll(cq, ca);
  let tOpts = '<option value="null" disabled>Select Party to load Transporters</option>';
  if (dispatch?.party_name) {
    const ts = await db.selectAll('SELECT t.id, t.name FROM transport_cost tc JOIN transporters t ON tc.transporter = t.id WHERE tc.client = ? AND t.status = 2 AND (truck_19 IS NOT NULL OR truck_32_mtxl IS NOT NULL OR other IS NOT NULL)', [dispatch.party_name]);
    tOpts = ts.map((r: any) => `<option value="${r.id}"${compare(r.id, dispatch.transporter ?? '', ' selected')}>${esc(r.name)}</option>`).join('');
  }
  let vOpts = '<option value="null" disabled>Select Transporters to load Vehicles</option>';
  if (dispatch?.transporter) {
    const c: any = await db.selectOne('SELECT * FROM transport_cost tc WHERE client = ? AND transporter = ?', [dispatch.party_name, dispatch.transporter]);
    vOpts = '';
    if (c?.truck_19 !== null && c) vOpts += `<option value="19"${compare(19, dispatch.vehicle_size, ' selected')}>19ft Single Axle</option>`;
    if (c?.truck_32_mtxl !== null && c) vOpts += `<option value="32"${compare(32, dispatch.vehicle_size, ' selected')}>32ft Multi Axle</option>`;
    if (c?.other !== null && c) vOpts += `<option value="0"${compare(0, dispatch.vehicle_size, ' selected')}>Other</option>`;
  }
  void text;
  return {
    metaTitle: pageTitle, pageTitle, metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><form method="post" class="col xs12 s10 m8 ajax">${loc}${cat}
	<div class="input-field sidelabel"><input type="text" name="date_of_dispatch" value="${esc(dispatch?.date_of_dispatch ?? '')}" class="datepicker" required><label>Dispatch Date</label></div>
	<div class="input-field sidelabel"><select name="party_name" class="searchable" required><option></option>${clients.map((r: any) => `<option value="${r.id}"${compare(r.id, dispatch?.party_name ?? '', ' selected')}>${esc(r.name)}</option>`).join('')}</select><label>Party</label></div>
	<div class="input-field sidelabel"><select name="transporter"><option></option>${tOpts}</select><label>Transporter</label></div>
	<div class="input-field sidelabel"><select name="vehicle_size"><option></option>${vOpts}</select><label>Vehicle Size</label></div>
	<div class="input-field sidelabel"><input type="text" name="vehicle_number" maxlength="20" class="text-uppercase" value="${esc(dispatch?.vehicle_number ?? '')}"><label>Vehicle Number</label></div>
	<div class="input-field sidelabel"><input type="text" name="sales_quotation" value="${esc(dispatch?.sales_quotation ?? '')}"><label>Sales Quotation</label></div>
	<button type="submit" class="btn filled">Save</button></form></div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms } from './js/functions.mjs?v=${V}';
	initInputs(); initAjaxForms();
	const client = document.querySelector('select[name="party_name"]'), transporterEl = document.querySelector('select[name="transporter"]'), vehicleEl = document.querySelector('select[name="vehicle_size"]');
	client.addEventListener('change', e => {
		transporterEl.disabled = true; vehicleEl.disabled = true;
		G.ajax({ type: 'POST', data: { action: 'load-transporters', client: e.target.value, transporter: transporterEl.value } }).then(data => {
			transporterEl.innerHTML = data.responseText; G(transporterEl).selectInput('reload');
		}).catch(xhr => { console.log('Failed', xhr); G.snackbar('An error occurred.'); }).finally(() => { transporterEl.disabled = false; vehicleEl.disabled = false; });
	});
	transporterEl.addEventListener('change', e => {
		vehicleEl.disabled = true;
		G.ajax({ type: 'POST', data: { action: 'load-vehicles', client: client.value, transporter: transporterEl.value, vehicle: vehicleEl.value } }).then(data => {
			vehicleEl.innerHTML = data.responseText; G(vehicleEl).selectInput('reload');
		}).catch(xhr => { console.log('Failed', xhr); G.snackbar('An error occurred.'); }).finally(() => { vehicleEl.disabled = false; });
	});
</script>`,
  };
}
