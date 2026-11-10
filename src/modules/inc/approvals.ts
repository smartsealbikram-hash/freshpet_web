import { Ctx, exit, jsonExit, json } from '@/lib/ctx';
import { Account } from '@/lib/account';
import { approvalEntityTable, pageToPermission, sanitize, sendNotification } from '@/lib/functions';
import { date, strtotime, ucfirst } from '@/lib/php';
import { SITE_URL } from '@/lib/h';

export default async function (ctx: Ctx) {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) exit(new Response(''));
  if (post.entity_type === undefined || post.entity_id === undefined || post.decision === undefined)
    return exit(json({ error: 'Invalid request.' }, 400));

  const entityType = sanitize(post.entity_type);
  const entityId = sanitize(post.entity_id);
  const decision = post.decision === 'Approve' ? 1 : 0;
  const remarks = sanitize(post.remarks);
  const staffPerm = pageToPermission(entityType, 1);
  const [table, col] = approvalEntityTable(entityType);

  let can = false;
  let entity: any;
  if (S.user.permissions?.[staffPerm]?.access == 3) {
    entity = await db.selectOne(`SELECT ${col} as created_by FROM ${table} WHERE id = ?`, [entityId]);
    if (entity && entity.created_by != S.user.id) can = true;
  }
  if (!can) return jsonExit({ error: 'You do not have permission to approve this item.' });

  let response: any;
  try {
    let needed: number | undefined;
    if (table === 'leave_applications') {
      const cp: any = await db.selectOne('SELECT access FROM staff_permissions sp JOIN users u ON sp.role = u.role WHERE u.id = ? AND sp.type = ?', [entity.created_by, entityType]);
      if (cp && cp.access == 3) needed = 1;
    }
    if (needed === undefined) needed = ['advance_salary', 'payments', 'leave_applications'].includes(table) ? 2 : 1;

    const approvals = await db.selectAll('SELECT user, decision FROM approvals WHERE entity_type = ? AND entity_id = ?', [entityType, entityId]);
    let total = 0;
    for (const r of approvals) {
      if (r.user == ctx.userId) throw new Error('You have already given a decision on this matter.');
      if (r.decision == 1) total++;
    }
    await db.insert('approvals', { entity_type: entityType, entity_id: entityId, user: S.user.id, decision, remarks, date_decided: now });
    total++;

    const zeroTwo = ['advance_salary', 'heavy_equipment_requests', 'payments', 'leave_applications'];
    if (decision === 0) {
      if (zeroTwo.includes(table) || table === 'job_interviews') await db.update(table, { status: 0 }, 'id = ?', [entityId]);
      else if (table === 'production_lots') await db.update('production_lots', { status: 4 }, 'id = ?', [entityId]);
    } else if (needed === total) {
      if (zeroTwo.includes(table)) await db.update(table, { status: 2 }, 'id = ?', [entityId]);
      if (entityType === 'advance_salary') {
        entity = await db.selectOne('SELECT amount, u.name, s.created_by FROM advance_salary s JOIN users u ON s.created_by = u.id WHERE s.id = ?', [entityId]);
        await db.insert('payments', {
          status: 2, amount: entity.amount, recipient: entity.name, purpose: `Advance salary #${entityId}`, date_requested: now,
          created_by: 0, attached_entity: 'advance_salary', attached_entity_id: entityId,
        });
      } else if (entityType === 'production_instances') {
        await db.update(entityType, { status: 1 }, 'id = ?', [entityId]);
        const inst: any = await db.selectOne('SELECT pi.quantity, date_production, date_accepted, pl.lot_id, weight, p.type FROM production_instances pi JOIN production_lots pl ON pi.lot_id = pl.id JOIN products p ON pi.product = p.id WHERE pi.id = ?', [entityId]);
        let title: string, msg: string;
        if (inst.date_accepted === null) {
          title = `New production instance created on ${inst.lot_id}`;
          msg = `${inst.quantity}MT of ${inst.weight}gm ${inst.type}. Production to start on ${date('d M Y', strtotime(inst.date_production) as number)}`;
        } else { title = `Production instance on ${inst.lot_id} updated.`; msg = `Quantity updated to ${inst.quantity}MT`; }
        const devs = await db.selectAll("SELECT tag FROM users u JOIN staff_permissions sp ON u.role = sp.role AND sp.type = 'production_instances' LEFT JOIN user_devices ud ON u.id = ud.user WHERE u.status = 2 AND access_level = 3 AND (sp.access = 3 OR u.role = 13) AND tag IS NOT NULL");
        if (devs.length) await sendNotification(ctx, devs.map((r: any) => r.tag), title, msg, `${SITE_URL}/production-instance?id=${entityId}`);
      }
    }

    const employee = new Account(ctx);
    employee.id = entity.created_by;
    const cs: any = await employee.checkCommSettings(1);
    if (cs.push_enabled)
      await sendNotification(ctx, cs.push_devices, `${ucfirst(entityType.replace(/_/g, ' '))} added by you was ${post.decision === 'Approve' ? 'Approved' : 'Rejected'}`, '', SITE_URL);
    response = { action: 'refresh' };
  } catch (e: any) {
    response = { message: { type: 'error', content: e.message } };
  }
  return jsonExit(response);
}
