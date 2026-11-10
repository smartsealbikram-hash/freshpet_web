import { Ctx, Page } from '@/lib/ctx';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { compare, noData } from '@/lib/functions';
import { P, SITE_URL, V, halt } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, S } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  const level = P(ctx, 'receiving_notes');
  if (level === 0) halt('You do not have access to this item.');
  const type = ctx.get.t === 'grn' || ctx.get.t === 'srn' ? ctx.get.t : 'grn';
  const title = `${type.toUpperCase()} Register`;
  S['current-page'] = `${SITE_URL}/receiving-notes?t=${type}`;
  let loc = '';
  if (S.user.department == 10) {
    const locs = await db.selectAll('SELECT * FROM locations');
    loc = `<div class="input-field inline mb2" id="locations"><span class="material-icons left-assist">location_on</span><select name="location">${locs.map((r: any) => `<option value="${r.id}"${compare(r.id, ctx.settings.location, ' selected')}>${esc(r.name)}</option>`).join('')}</select><label></label></div>`;
  }
  const rows = await db.selectAll('SELECT * FROM receiving_notes WHERE location = ? AND type = ? ORDER BY id DESC', [ctx.settings.location, type]);
  const body = rows.length
    ? `<ul class="list three-line dividers link-list">${rows.map((r: any) => `<li data-url="${type}-register-entry?id=${r.id}"><div class="content"><small>${esc(r.register_id)}</small><p><strong class="truncate">${esc(r.party_name)}</strong>${date('d M Y', strtotime(r.date_received) as number)}</p></div></li>`).join('')}</ul>`
    : noData(title);
  return {
    metaTitle: title, pageTitle: title, metaDescription: '',
    content: `<section class="pt0"><div class="container">${loc}<div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>
${level >= 2 ? `<div class="fab-cont"><a href="${type}-register-entry" class="fab extended"><span class="material-icons">add</span> Add New</a></div>` : ''}`,
    js: `<script type="module">import { locationSwitcher, initLinksList } from './js/functions.mjs?v=${V}'; locationSwitcher(); initLinksList();</script>`,
  };
}
