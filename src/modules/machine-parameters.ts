import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { machineParams } from '@/lib/config';
import { esc } from '@/lib/html';
import { sanitize, sentenceCase, snakeCase, toInt } from '@/lib/functions';
import { P, V, halt, msgWarn, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  const level = P(ctx, 'production_logs');
  if (level < 2) halt('You do not have access to this item.');
  if (ctx.get.log === undefined) notFound();
  const logId = toInt(ctx.get.log);
  const log: any = await db.selectOne('SELECT m.id as machine, pl.status as lot_status, pi.product FROM production_logs plg JOIN production_instances pi ON plg.instance_id = pi.id JOIN production_lots pl ON pi.lot_id = pl.id JOIN machines m ON pl.machine = m.id WHERE plg.id = ?', [logId]);
  if (!log) notFound();
  let values: any = {}, spId = 0;
  if (ctx.get.id !== undefined) { spId = toInt(ctx.get.id); values = (await db.selectOne('SELECT * FROM shift_parameters WHERE id = ?', [spId])) || {}; }

  if (post.resin_residence_time !== undefined && level >= 2 && log.lot_status < 6) {
    const p: any = { date_added: now, added_by: S.user.id };
    for (const k of machineParams) { const key = snakeCase(k); p[key] = post[key] !== undefined ? sanitize(post[key]) : null; }
    let r: any = {};
    try {
      if (ctx.get.id !== undefined) await db.update('shift_parameters', p, 'id = ?', [spId]);
      else { p.log = logId; await db.insert('shift_parameters', p); }
      r = { action: 'goback' };
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  }

  const params = await db.selectAll('SELECT * FROM machine_parameters WHERE machine = ? AND product = ?', [log.machine, log.product]);
  const rec = (r: any) => {
    const u = r.unit ?? '';
    if (r.operator === '<') return `Max ${r.value}${u}`;
    if (r.operator === '>') return `Min ${r.value}${u}`;
    if (r.operator === '↔') { const l = String(r.value).split(','); return `${l[0]} to ${l[1]}${u}`; }
    return `${r.value}${u}`;
  };
  return {
    metaTitle: 'Add Machine Parameters', pageTitle: 'Add Machine Parameters', metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><form method="post" class="col xs12 l8 ajax"><div id="parameters-table">
	<div><span class="hide-xs">Parameter</span><span>Value</span><span>Recommended value</span></div>
	${params.map((r: any) => `<div><span>${esc(sentenceCase(r.parameter))}</span><span><div class="input-field no-margin"><span class="right-assist">${esc(r.unit)}</span><input type="tel" maxlength="10" name="${esc(r.parameter)}" value="${esc(values[r.parameter] ?? '')}" required></div></span><span data-operator="${esc(r.operator)}" data-value="${esc(r.value)}">${esc(rec(r))}</span></div>`).join('')}
	</div>${log.lot_status < 6 && level === 2 ? '<button type="submit" class="btn filled mt1">Save</button>' : ''}</form></div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms } from './js/functions.mjs?v=${V}';
	initInputs(); initAjaxForms();
	const paramTable = document.getElementById('parameters-table');
	G(paramTable.querySelectorAll('input')).on('change', e => {
		const inputValue = parseFloat(e.target.value), recValuesSpan = e.target.closest('span').nextElementSibling, recValueOperator = recValuesSpan.dataset.operator;
		let recValue = recValuesSpan.dataset.value, isValid = false;
		if(recValueOperator == 'NA') return;
		else if((recValueOperator == '=' && inputValue == parseFloat(recValue)) || (recValueOperator == '<' && inputValue <= parseFloat(recValue)) || (recValueOperator == '>' && inputValue >= parseFloat(recValue))) isValid = true;
		else if(recValueOperator == '↔'){ const recValues = recValue.split(','); if(inputValue >= parseFloat(recValues[0]) && inputValue <= parseFloat(recValues[1])) isValid = true; }
		if(isValid){ recValuesSpan.classList.add('success-color'); recValuesSpan.classList.remove('error-color'); }
		else { recValuesSpan.classList.remove('success-color'); recValuesSpan.classList.add('error-color'); }
	});
</script>`,
  };
}
