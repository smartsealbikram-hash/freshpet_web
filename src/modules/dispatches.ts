import { Ctx, Page, exit } from '@/lib/ctx';
import { dispatchTimeline } from '@/lib/config';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { compare } from '@/lib/functions';
import { P, SITE_URL, V } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, S } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'dispatches') === 0) {
    ctx.flash('error', 'You do not have access to that page.');
    return exit(new Response(null, { status: 302, headers: { location: SITE_URL } }));
  }
  let loc = '';
  if (S.user.role == 6 || S.user.department == 10) {
    const locs = await db.selectAll('SELECT * FROM locations');
    loc = `<div class="input-field inline mb2" id="locations"><span class="material-icons left-assist">location_on</span><select name="location">${locs.map((r: any) => `<option value="${r.id}"${compare(r.id, ctx.settings.location, ' selected')}>${esc(r.name)}</option>`).join('')}</select><label></label></div>`;
  }
  const list = async (category: number) => {
    let q = "SELECT d.*, c.name as party_name, t.name as transporter_name, dt.checkpoint FROM dispatches d JOIN clients c ON d.party_name = c.id JOIN transporters t ON d.transporter = t.id LEFT JOIN dispatch_times dt ON d.id = dt.dispatch AND dt.id IN (SELECT MAX(id) FROM dispatch_times GROUP BY dispatch) WHERE location = ? AND category = ?";
    const a: any[] = [ctx.settings.location, category];
    if (S.user.role == 1) q += ' AND (d.status = 1 OR date_of_dispatch > CURDATE() - INTERVAL 3 DAY)';
    else q += ' AND d.status = 1';
    if (S.user.department == 1 || S.user.department == 9) { q += ' AND added_by = ?'; a.push(S.user.id); }
    q += ' ORDER BY date_of_dispatch DESC, d.id DESC';
    const rows = await db.selectAll(q, a);
    if (!rows.length) return '<div class="center"><img src="img/no-data.png"><h3>No Dispatches</h3><p class="mtn1">Active dispatches will appear here</p></div>';
    const groups: Record<string, any[]> = {};
    for (const r of rows) (groups[r.date_of_dispatch] ??= []).push(r);
    let out = '';
    for (const [d, data] of Object.entries(groups)) {
      out += `<h4><span class="material-icons">event</span> ${date('M d, Y', strtotime(d) as number)}</h4><ul class="list compact right-assist dividers link-list mb1">`;
      for (const r of data) {
        out += `<li data-url="dispatch?id=${r.id}"><div class="content"><h4 class="no-margin">${r.status == 0 ? '<span class="material-icons error-color">cancel</span> ' : r.status == 2 ? '<span class="material-icons success-color">check_circle</span> ' : ''}${esc(r.party_name)}</h4>
				<p class="no-margin neutral-color-2"><small>${esc(r.transporter_name)}${r.sales_quotation ? `&emsp;Sales Quotation: ${esc(r.sales_quotation)}` : ''}<br>${esc(r.vehicle_number)}${r.vehicle_size ? `&emsp;Vehicle Size: ${esc(r.vehicle_size)}ft` : ''}</small></p></div>
				<div class="right-assist text-right"><span class="chip">${r.checkpoint === null ? 'Not Started' : dispatchTimeline[r.checkpoint]?.name ?? ''}</span>${[1, 9, 10].includes(Number(S.user.department)) ? `<br><a href="manage-dispatch?id=${r.id}" class="btn icon toggle-off"><span class="material-icons">edit</span></a>` : ''}</div></li>`;
      }
      out += '</ul>';
    }
    return out;
  };
  const body = ctx.get.t === 'c' ? await list(1) : ctx.get.t === 'w' ? await list(2) : '';
  return {
    metaTitle: 'Dispatches', pageTitle: 'Dispatches', metaDescription: '',
    content: `<section class="pt0"><div class="container">${loc}<div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>
${P(ctx, 'dispatches') >= 2 ? '<div class="fab-cont"><a href="manage-dispatch" class="fab extended"><span class="material-icons">add</span> Add New</a></div>' : ''}`,
    js: `<script type="module">
  import { initLinksList, locationSwitcher } from './js/functions.mjs?v=${V}';
  locationSwitcher(); initLinksList();
  G('.link-list a').on('click', e => { e.stopPropagation(); });
</script>`,
  };
}
