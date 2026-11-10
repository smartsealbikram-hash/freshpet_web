import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { esc } from '@/lib/html';
import { compare, toInt } from '@/lib/functions';
import { V, arr, halt, msgWarn } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (S.user.department != 10) halt('You do not have access to this item.');
  if (post.id !== undefined) {
    let r: any = {};
    try {
      const ids = arr(post.id);
      for (let i = 0; i < ids.length; i++) {
        const id = toInt(ids[i]);
        await db.update('shifts', { start_hour: toInt(arr(post.start_hour)[i]), end_hour: toInt(arr(post.end_hour)[i]), incharge: toInt(arr(post.incharge)[i]), status: toInt(post['status-' + id]) }, 'id = ?', [id]);
      }
      r = { action: 'goback' };
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  }
  const incharges = await db.selectAll('SELECT id, name FROM users WHERE status = 2 AND role = 13');
  const shifts = await db.selectAll('SELECT * FROM shifts');
  return {
    metaTitle: 'Shift Timings', pageTitle: 'Shift Timings', metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div><form method="post" class="ajax">
	${shifts.map((r: any) => `<div class="card outline mb1"><div class="content"><h2>${esc(r.name)}</h2><input type="number" name="id[]" value="${r.id}" hidden>
		<div class="input-field sidelabel"><input type="number" name="start_hour[]" value="${esc(r.start_hour)}" required><label>Start Hour</label></div>
		<div class="input-field sidelabel"><input type="number" name="end_hour[]" value="${esc(r.end_hour)}" required><label>End Hour</label></div>
		<div class="input-field sidelabel"><select name="incharge[]" required><option></option>${incharges.map((i: any) => `<option value="${i.id}"${compare(i.id, r.incharge, ' selected')}>${esc(i.name)}</option>`).join('')}</select><label>Shift Incharge</label></div>
		<div class="input-field sidelabel"><p class="label">Status</p><div class="segmented-control">
			<input type="radio" name="status-${r.id}" value="1" id="status-${r.id}-inactive" ${compare(r.status ?? '', 1, ' checked')} required><label for="status-${r.id}-inactive">Inactive</label>
			<input type="radio" name="status-${r.id}" value="2" id="status-${r.id}-active" ${compare(r.status ?? '', 2, ' checked')}><label for="status-${r.id}-active">Active</label></div></div></div></div>`).join('')}
	<button type="submit" class="btn filled">Save</button><p class="mt1">Shift timings affect upcoming shifts that will be auto-generated. Existing shifts remain unaffected.</p></form></div></div></div></section>`,
    js: `<script type="module">import { initInputs, initAjaxForms } from './js/functions.mjs?v=${V}'; initInputs(); initAjaxForms();</script>`,
  };
}
