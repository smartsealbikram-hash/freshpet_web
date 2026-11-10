import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { esc } from '@/lib/html';
import { compare, notifyForApproval, sanitize, toInt } from '@/lib/functions';
import { P, SITE_URL, V, halt, msgWarn, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  const level = P(ctx, 'production_instances');
  if (level === 0) halt('You do not have access to this item.');
  let pageTitle = 'Production Instance', id = 0, inst: any;
  S['current-page'] = 'production-instance';
  if (ctx.get.lot !== undefined && S.user.department == 10) {
    inst = await db.selectOne('SELECT id, lot_id as p_lot_id FROM production_lots WHERE id = ?', [toInt(ctx.get.lot)]);
    if (!inst) notFound();
    pageTitle = `Add instance on ${inst.p_lot_id}`;
  } else if (ctx.get.id !== undefined) {
    id = toInt(ctx.get.id);
    inst = await db.selectOne('SELECT pi.*, pl.lot_id as p_lot_id FROM production_instances pi JOIN production_lots pl ON pi.lot_id = pl.id WHERE pi.id = ?', [id]);
    if (!inst) notFound();
    S['current-page'] += `?id=${id}`;
  } else notFound();

  if (post.quantity !== undefined && level >= 2) {
    const p: any = { quantity: sanitize(post.quantity, 'number'), remarks: sanitize(post.remarks), status: 0 };
    if (post.product !== undefined) Object.assign(p, { date_production: sanitize(post.date_production), product: toInt(post.product), color: sanitize(post.color), ldr: sanitize(post.ldr, 'number') });
    let r: any = {};
    try {
      if (ctx.get.id !== undefined) {
        id = toInt(ctx.get.id);
        if (post.delete !== undefined) {
          if (await db.selectOne('SELECT id FROM production_logs WHERE instance_id = ?', [id])) throw new Error('The instance contains shift logs hence it can not be deleted.');
          await db.delete('production_instances', 'id = ?', [id]);
        } else await db.update('production_instances', p, 'id = ? AND created_by = ?', [id, ctx.userId]);
        await db.delete('approvals', "entity_type = 'production_instances' AND entity_id = ?", [id]);
      } else {
        Object.assign(p, { lot_id: toInt(ctx.get.lot), status: 0, date_created: now, created_by: ctx.userId });
        id = await db.insert('production_instances', p);
      }
      await notifyForApproval(ctx, 'production_instances', `An instance in ${inst.p_lot_id} has been created or modified.`, 'Approve instance to activate.', `${SITE_URL}/production-instance?id=${id}`, 10);
      r = { action: 'goback' };
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  }

  let top = '';
  if (!(inst.status >= 5)) {
    const products = await db.selectAll('SELECT * FROM products WHERE status = 2');
    top = `<div class="input-field sidelabel"><input type="text" name="date_production" class="datepicker-future" value="${esc(inst.date_production ?? '')}" required><label>Date of Production</label></div>
		<div class="input-field sidelabel"><select name="product" required><option></option>${products.map((r: any) => `<option value="${r.id}"${compare(r.id, inst.product ?? '', ' selected')}>${esc(r.weight)}gm ${esc(r.type)}</option>`).join('')}</select><label>Product</label></div>
		<div class="input-field sidelabel"><input type="text" maxlength="10" name="color" value="${esc(inst.color ?? '')}" required><label>Color</label></div>
		<div class="input-field sidelabel"><input type="number" name="ldr" step="0.001" value="${esc(inst.ldr ?? '')}" required><label>LDR</label></div>`;
  }
  let del = '';
  if (ctx.get.id !== undefined && !(await db.selectOne('SELECT id FROM production_logs WHERE instance_id = ?', [id]))) del = '<button type="submit" class="btn outline error-color" name="delete">Delete Instance</button>';
  return {
    metaTitle: pageTitle, pageTitle, metaDescription: '',
    content: `<section><div class="container"><div class="row"><form method="post" class="col xs12 s10 m8 l6 ajax">${top}
		<div class="input-field sidelabel"><span class="right-assist">MT</span><input type="number" name="quantity" step="0.1" value="${esc(inst.quantity ?? '')}" required><label>Quantity</label></div>
		<div class="input-field sidelabel"><textarea name="remarks" rows="3">${esc(inst.remarks ?? '')}</textarea><label>Remarks</label></div>
		<button type="submit" class="btn filled">Save</button>${del}</form></div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms } from './js/functions.mjs?v=${V}';
	initInputs(); initAjaxForms();
	G('.datepicker-future').datepicker({ startDate: dayjs() });
</script>`,
  };
}
