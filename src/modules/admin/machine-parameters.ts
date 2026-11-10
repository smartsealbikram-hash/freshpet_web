import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { machineParams } from '@/lib/config';
import { compare, hasAccess, sanitize, snakeCase, toInt } from '@/lib/functions';
import { env } from '@/lib/env';
import { esc } from '@/lib/html';
import { noAccess } from '@/lib/adminList';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, get } = ctx;
  if (!hasAccess(ctx, 'view', 'production')) noAccess();
  ctx.S.current_page = `${env.SITE_URL}/admin/machine-parameters`;
  if (post['save-params'] !== undefined) {
    let r: any = {};
    try {
      for (let i = 0; i < machineParams.length; i++) {
        const v = post['value-' + i];
        if (v === undefined || v === '') continue;
        const p: any = { operator: sanitize(post['operator-' + i], 'html'), value: sanitize(v), unit: sanitize(post['unit-' + i]) };
        if (post['mpId-' + i] !== undefined) await db.update('machine_parameters', p, 'id = ?', [toInt(post['mpId-' + i])]);
        else { p.machine = toInt(get.m); p.product = toInt(get.p); p.parameter = snakeCase(machineParams[i]); await db.insert('machine_parameters', p); }
      }
      if (get.id === undefined) { if (post.another !== undefined) r = { message: { type: 'snackbar', content: 'Parameters Saved.' }, action: 'refresh' }; else r.action = 'goback'; }
    } catch (e: any) { r.message = { type: 'warning', content: e.message }; }
    return jsonExit(r);
  }
  if (get.m === undefined || get.p === undefined) return jsonExit({ message: { type: 'error', content: 'Please select a machine from the list.' }, action: 'halt' });
  const mp: Record<string, any> = {};
  for (const r of await db.selectAll('SELECT * FROM machine_parameters WHERE machine = ? AND product = ?', [toInt(get.m), toInt(get.p)])) mp[r.parameter] = r;
  const rows = machineParams.map((param, key) => {
    const m = mp[snakeCase(param)];
    const op = m?.operator ?? '';
    const o = (v: string, l: string) => `<option value="${v}"${compare(v, op, ' selected')}>${l}</option>`;
    return `${m ? `<input type="number" name="mpId-${key}" value="${m.id}" hidden>` : ''}<div class="row"><div class="col xs12 m5"><p>${esc(param)}</p></div>
		<div class="col xs4 m2 input-field"><select name="operator-${key}" required><option></option>${o('NA', 'NA')}${o('=', 'Equals')}${o('<', 'Less than')}${o('>', 'Greater than')}${o('↔', 'Between')}</select><label>Operator</label></div>
		<div class="col xs5 m3 input-field"><input type="text" name="value-${key}" maxlength="20" value="${esc(m?.value ?? '')}" required><label>Value</label><span class="helper hide">Enter two mathematical values separated by comma</span></div>
		<div class="col xs3 m2 input-field"><input type="text" name="unit-${key}" maxlength="5" value="${esc(m?.unit ?? '')}"><label>Unit</label></div></div>`;
  }).join('');
  return {
    metaTitle: 'Edit Machine Parameters', pageTitle: 'Edit Machine Parameters', metaDescription: '',
    content: `<section><div class="container"><h1 class="page-title">Edit Machine Parameters</h1><div class="row"><div class="col xs12"><form method="post" class="card ajax"><input type="text" name="save-params" hidden><div class="content">${rows}</div>
	<div class="action"><button type="submit" class="btn filled">Save</button><button type="submit" class="btn outline add-another">Save and Add Another</button><div id="global-msg-cont"></div></div></form></div></div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms } from '../js/functions.mjs';
	initInputs(); initAjaxForms();
	G('select[name^=operator]').on('change', e => { const helper = e.target.closest('.input-field').nextElementSibling.querySelector('.helper'); if(e.target.value == '↔') helper.classList.remove('hide'); else helper.classList.add('hide'); });
</script>`,
  };
}
