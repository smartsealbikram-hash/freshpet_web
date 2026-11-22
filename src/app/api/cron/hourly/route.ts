import { deleteFolderFiles } from '@/lib/storage';
import path from 'path';
import type { NextRequest } from 'next/server';
import { Ctx } from '@/lib/ctx';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { date, strtotime, time } from '@/lib/php';
import { sendNotification, STORAGE_DIR } from '@/lib/functions';
import { REVIEW_HOURS } from '@/lib/logAudit';

/**
 * Port of vault/cron-hourly.php (schedule at minute 15 of every hour):
 *   GET /api/cron/hourly?key=$CRON_KEY
 * Not ported: the 07:00 "abnormalities" digest that is posted to the external AI service.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_KEY;
  if (!expected || req.nextUrl.searchParams.get('key') !== expected) return new Response('Forbidden', { status: 403 });

  const ctx = new Ctx();
  ctx.db = db;
  const today = date('Y-m-d');
  const hour = parseInt(date('G'), 10);
  const log: string[] = [];

  const shifts = await db.selectAll('SELECT * FROM shifts WHERE status = 2');

  const starting = shifts.find((s: any) => s.start_hour == hour);
  if (starting) {
    const tasks = await db.selectAll('SELECT id, frequency FROM maintenance_tasks WHERE status = 2');
    const lots = await db.selectAll('SELECT pi.id, pl.machine FROM production_instances pi JOIN production_lots pl ON pi.lot_id = pl.id WHERE pi.status BETWEEN 5 AND 6 AND pl.status = 5');
    for (const row of lots) {
      const exists = await db.selectOne('SELECT id FROM production_logs WHERE instance_id = ? AND shift_date = ? AND shift = ?', [row.id, today, starting.name]);
      if (exists) continue;
      const logId = await db.insert('production_logs', { instance_id: row.id, shift: starting.name, shift_date: today, start_hour: starting.start_hour, end_hour: starting.end_hour, created_by: starting.incharge });
      log.push(`log ${logId} created for instance ${row.id}`);
      for (const t of tasks) {
        const last: any = await db.selectOne('SELECT pl.shift_date FROM production_maintenance pm JOIN production_logs pl ON pm.shift = pl.id WHERE pm.status = 2 AND pm.machine = ? AND task = ? ORDER BY pm.id DESC', [row.machine, t.id]);
        let due = true;
        if (last) due = (strtotime(last.shift_date) as number) + t.frequency * 86400 < time();
        if (due) await db.insert('production_maintenance', { status: 1, machine: row.machine, task: t.id, shift: logId });
      }
    }
  }

  const ending = shifts.find((s: any) => s.end_hour == hour - 1);
  if (ending) {
    const shiftDate = ending.start_hour > ending.end_hour ? date('Y-m-d', time() - 86400) : today;
    const pending = await db.selectAll('SELECT plt.id, plt.lot_id FROM production_logs pl JOIN production_instances pi ON pl.instance_id = pi.id JOIN production_lots plt ON pi.lot_id = plt.id WHERE shift = ? AND shift_date = ? AND production IS NULL', [ending.name, shiftDate]);
    if (pending.length) {
      const devs = await db.selectAll("SELECT tag FROM users u JOIN staff_permissions sp ON u.role = sp.role AND sp.type = 'production_instances' LEFT JOIN user_devices ud ON u.id = ud.user WHERE u.status = 2 AND access_level = 3 AND sp.access > 0 AND (u.role = 1 OR u.role = 15 OR u.role = 17) AND tag IS NOT NULL");
      if (devs.length) {
        const url = pending.length === 1 ? `/production-lot?id=${pending[0].id}` : '/production-lots';
        await sendNotification(ctx, devs.map((d: any) => d.tag), `Shift logs not entered for ${pending.length} lots`, `Lots missing shift log: ${pending.map((p: any) => p.lot_id).join(', ')}`, env.SITE_URL + url);
        log.push('missing-log notification sent');
      }
    }
  }

  // Manager review window: a submitted shift log nobody (approve OR reject) decided on within REVIEW_HOURS is approved automatically.
  // Only logs of the last 3 days are looked at, so history from before this rule existed is never touched and a missed cron run catches up.
  const pendingLogs = await db.selectAll('SELECT id FROM production_logs WHERE date_added IS NOT NULL AND date_added > ? AND date_added <= ?', [date('Y-m-d H:i:s', time() - 72 * 3600), date('Y-m-d H:i:s', time() - REVIEW_HOURS * 3600)]);
  const auto: any[] = [];
  for (const l of pendingLogs) {
    if (await db.selectOne('SELECT id FROM approvals WHERE entity_type = ? AND entity_id = ?', ['production_logs', l.id])) continue;
    await db.insert('approvals', { entity_type: 'production_logs', entity_id: l.id, user: 0, decision: 1, remarks: `Auto-approved: no manager decision within ${REVIEW_HOURS} hours`, date_decided: ctx.now ?? date('Y-m-d H:i:s') });
    auto.push(l);
  }
  if (auto.length) {
    log.push(`auto-approved production log(s): ${auto.map((l) => l.id).join(', ')}`);
    const devs = await db.selectAll("SELECT tag FROM users u JOIN staff_permissions sp ON u.role = sp.role AND sp.type = 'production_logs' LEFT JOIN user_devices ud ON u.id = ud.user WHERE u.status = 2 AND access_level = 3 AND sp.access = 3 AND tag IS NOT NULL");
    if (devs.length) await sendNotification(ctx, devs.map((d: any) => d.tag), `${auto.length} shift log${auto.length > 1 ? 's were' : ' was'} auto-approved`, `No decision was made within ${REVIEW_HOURS} hours.`, env.SITE_URL + (auto.length === 1 ? `/production-log?id=${auto[0].id}` : '/production-lots'));
  }

  if (hour === 3) {
    await deleteFolderFiles('docs/exports');
    log.push('exports cleaned');
  }
  return Response.json({ ok: true, hour, log });
}
