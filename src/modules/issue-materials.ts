import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { esc } from '@/lib/html';
import { sanitize, toInt } from '@/lib/functions';
import { P, V, halt, msgWarn, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'material_requisition') < 3) halt('You do not have access to this item.');
  if (ctx.get.id === undefined) notFound();
  const id = toInt(ctx.get.id);
  const materials = await db.selectAll('SELECT pri.*, m.name as machine_name FROM pm_rm_items pri LEFT JOIN machines m ON pri.machine = m.id WHERE mr_id = ? ORDER BY pri.type', [id]);
  if (!materials.length) notFound();

  if (post['save-materials'] !== undefined) {
    const totals: Record<string, number> = { raw: 0, packing: 0 };
    let r: any = {};
    try {
      for (const [key, value] of Object.entries(post)) {
        if (key === 'save-materials') continue;
        const mid = key.replace('material-', '');
        const units = Number(sanitize(value, 'number')) || 0;
        const m = materials.find((x: any) => String(x.id) === mid);
        if (m) totals[m.type] += units;
        await db.update('pm_rm_items', { units_issued: units }, 'id = ?', [mid]);
      }
      await db.update('pm_rm_requests', { raw_materials_issued: totals.raw, packing_materials_issued: totals.packing, issued_by: S.user.id, date_issued: now }, 'id = ?', [id]);
      r = { action: 'goback' };
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  }

  return {
    metaTitle: 'Issue Materials', pageTitle: 'Issue Materials', metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s9 m7 l5">
	<form method="post" class="ajax mt2"><table class="compact"><thead><tr><th>Material</th><th>Qty Requested</th><th>Qty Issued</th></tr></thead><tbody>
	${materials.map((r: any) => `<tr><td>${r.machine !== null ? `<small class="neutral-color-3">${esc(r.machine_name)}</small><br>` : ''}${esc(r.material)}</td><td>${esc(r.units_requested)}</td><td class="stepper-cont">
		${r.type === 'packing'
        ? `<div class="stepper-input"><button type="button" class="btn small icon filled less"><span class="material-icons">remove</span></button><input type="number" name="material-${r.id}" min="0" max="${esc(r.units_requested)}" value="${esc(r.units_issued)}" class="nospinner" required><button type="button" class="btn small icon filled more"><span class="material-icons">add</span></button></div>`
        : `${r.units_issued ? esc(r.units_issued) + '&nbsp;&nbsp;' : ''}<a href="scan-materials?pri=${r.id}" class="btn outline small">Scan Bags</a>`}</td></tr>`).join('')}
	</tbody></table><button type="submit" class="btn filled" name="save-materials"><span class="material-icons">save</span> Save</button></form>
</div></div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms, stepperInput } from './js/functions.mjs?v=${V}';
	stepperInput(); initInputs(); initAjaxForms();
</script>`,
  };
}
