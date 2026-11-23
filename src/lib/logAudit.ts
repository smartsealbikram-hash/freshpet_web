import { db } from './db';
import { env } from './env';
import { date, strtotime, time } from './php';
import { getDb } from './msql/store';

/**
 * Review window + audit trail for production logs.
 *  - A shift log submitted by the shift incharge must be reviewed (approved / corrected) by the production manager within REVIEW_HOURS.
 *  - Every change a manager makes to a submitted log is stored in `production_log_changes` (who, when, field, old -> new, reason).
 * The audit rows live in their own collection / table (created on first use, same approach as web_sessions), so no migration is needed.
 */
export const REVIEW_HOURS = 24;
const MONGO = env.DB_ENGINE !== 'mysql';
const COLL = 'production_log_changes';

export const FIELD_LABELS: Record<string, string> = { total_pcs: 'Total pcs', rejection: 'Rejection (kg)', lumps: 'Lumps (kg)', no_plan_time: 'No plan time (hr)', breakdown_reason: 'Breakdown reason', production: 'Production (kg)' };

export interface LogChange { log_id: number; changed_by: number; changed_by_name: string; field: string; old_value: string | null; new_value: string | null; reason: string; changed_at: string }

let ready: Promise<void> | null = null;
function ensure() {
  if (!ready) {
    ready = (MONGO
      ? getDb().then((d) => d.collection(COLL).createIndex({ log_id: 1, changed_at: 1 })).then(() => undefined)
      : db.run(`CREATE TABLE IF NOT EXISTS ${COLL} (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, log_id INT NOT NULL, changed_by INT NOT NULL, changed_by_name VARCHAR(100) NOT NULL,
          field VARCHAR(50) NOT NULL, old_value VARCHAR(255) NULL, new_value VARCHAR(255) NULL, reason VARCHAR(500) NOT NULL, changed_at DATETIME NOT NULL, INDEX (log_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).then(() => undefined)
    ).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

const str = (v: any) => (v === null || v === undefined ? null : String(v));
/** Compare as numbers when both sides are numeric (so 5 and "5.00" are not a change). */
const same = (a: any, b: any) => {
  if (a === null || a === undefined || a === '') a = null;
  if (b === null || b === undefined || b === '') b = null;
  if (a === null || b === null) return a === b;
  const na = Number(a), nb = Number(b);
  // tolerance: derived values (production kg) are stored rounded, the freshly computed one is not
  return Number.isFinite(na) && Number.isFinite(nb) ? Math.abs(na - nb) < 0.005 : String(a) === String(b);
};

/** Store one row per field that really changed. Returns the rows recorded. */
export async function recordLogChanges(logId: number, user: { id: number; name: string }, before: Record<string, any>, after: Record<string, any>, reason: string, now: string): Promise<LogChange[]> {
  const rows: LogChange[] = [];
  for (const field of Object.keys(after)) {
    if (same(before[field], after[field])) continue;
    rows.push({ log_id: logId, changed_by: user.id, changed_by_name: String(user.name ?? '').slice(0, 100), field, old_value: str(before[field])?.slice(0, 255) ?? null, new_value: str(after[field])?.slice(0, 255) ?? null, reason: reason.slice(0, 500), changed_at: now });
  }
  if (!rows.length) return [];
  await ensure();
  if (MONGO) {
    const d = await getDb();
    await d.collection(COLL).insertMany(rows.map((r) => ({ ...r })));
  } else {
    for (const r of rows) await db.insert(COLL, r as any);
  }
  return rows;
}

export async function getLogChanges(logId: number): Promise<LogChange[]> {
  await ensure();
  if (MONGO) {
    const d = await getDb();
    return (await d.collection(COLL).find({ log_id: logId }).sort({ changed_at: 1, _id: 1 }).toArray()) as any;
  }
  return (await db.selectAll(`SELECT * FROM ${COLL} WHERE log_id = ? ORDER BY changed_at, id`, [logId])) as any;
}

/** log ids (of the given list) that were modified by a manager */
export async function modifiedLogIds(logIds: number[]): Promise<Set<number>> {
  if (!logIds.length) return new Set();
  await ensure();
  if (MONGO) {
    const d = await getDb();
    return new Set((await d.collection(COLL).distinct('log_id', { log_id: { $in: logIds } })) as number[]);
  }
  const rows = await db.selectAll(`SELECT DISTINCT log_id FROM ${COLL} WHERE log_id IN (${logIds.map(() => '?').join(',')})`, logIds);
  return new Set(rows.map((r: any) => Number(r.log_id)));
}

/** Review window state for a submitted log (`dateAdded` = production_logs.date_added, the incharge's submission time). */
export function reviewWindow(dateAdded: string | null) {
  const start = dateAdded ? strtotime(dateAdded) : false;
  if (start === false) return null;
  const deadline = start + REVIEW_HOURS * 3600;
  const left = deadline - time();
  return { deadline, deadlineText: date('d M Y h:i A', deadline), overdue: left < 0, hoursLeft: Math.max(0, Math.ceil(left / 3600)), hoursOver: Math.max(0, Math.floor(-left / 3600)) };
}

const escHtml = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Drop a short alert into the FAI chat of every admin (management department users + ids 11 and 22 — the people who see FAI) saying what the
 * manager changed. It only writes rows into chats / chat_messages, the same place FAI's own reports land, so the AI connection is not involved.
 * Best effort: a failure here must never block the correction itself.
 */
export async function alertAdminsViaFai(info: { logId: number; lot: string; shift: string; shiftDate: string; incharge: string; manager: string; reason: string; changes: LogChange[]; now: string }) {
  try {
    const admins = await db.selectAll('SELECT u.id FROM users u LEFT JOIN staff_roles sr ON u.role = sr.id WHERE u.status = 2 AND (sr.department = 10 OR u.id = 11 OR u.id = 22)');
    if (!admins.length) return;
    const items = info.changes.map((c) => `  <li>${escHtml(FIELD_LABELS[c.field] ?? c.field)}: ${escHtml(c.old_value ?? '—')} → ${escHtml(c.new_value ?? '—')}</li>`).join('\n');
    const message = `### Production Log Corrected

<h2>${escHtml(info.lot)}, ${escHtml(info.shift)} (${escHtml(info.shiftDate)})</h2>
<ul class="default">
  <li>Entered by ${escHtml(info.incharge || 'shift incharge')}, changed by ${escHtml(info.manager)}</li>
${items}
  <li>Reason: ${escHtml(info.reason)}</li>
</ul>`;
    for (const a of admins) {
      let chat: any = await db.selectOne('SELECT id FROM chats WHERE user_1 = 0 AND user_2 = ?', [a.id]);
      const chatId = chat ? chat.id : await db.insert('chats', { user_1: 0, user_2: a.id });
      await db.insert('chat_messages', { chat: chatId, sender: 0, is_read: 0, message, date_sent: info.now });
    }
  } catch (e: any) { console.error('FAI alert failed:', e?.message); }
}
