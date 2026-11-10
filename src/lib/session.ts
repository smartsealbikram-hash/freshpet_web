import { randomBytes } from 'crypto';
import { db } from './db';
import { env } from './env';
import { time } from './php';
import { getDb } from './msql/store';

/**
 * Replacement for PHP's $_SESSION: data lives server-side (MongoDB collection `web_sessions`, or the `web_sessions` SQL table when
 * DB_ENGINE=mysql), the cookie only carries the id. (Cookie-only sessions would overflow 4KB once the permission matrix is stored.)
 */
export const SESSION_COOKIE = 'fp_sid';
const TTL = 60 * 60 * 24 * 60; // 60 days, same as the remember-me cookie
const MONGO = env.DB_ENGINE !== 'mysql';

let ready: Promise<void> | null = null;
export function ensureSessionTable() {
  if (!ready) {
    ready = (MONGO
      ? getDb().then((d) => d.collection('web_sessions').createIndex({ updated_at: 1 })).then(() => undefined)
      : db
          .run(
            `CREATE TABLE IF NOT EXISTS web_sessions (
          id CHAR(48) NOT NULL PRIMARY KEY,
          data MEDIUMTEXT NOT NULL,
          updated_at INT UNSIGNED NOT NULL,
          INDEX (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
          )
          .then(() => undefined)
    ).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

async function readRow(id: string): Promise<{ data: string; updated_at: number } | null> {
  if (MONGO) {
    const r: any = await (await getDb()).collection('web_sessions').findOne({ _id: id as any });
    return r ? { data: r.data, updated_at: r.updated_at } : null;
  }
  const row: any = await db.selectOne('SELECT data, updated_at FROM web_sessions WHERE id = ?', [id]);
  return row || null;
}

export class Session {
  data: Record<string, any> = {};
  isNew = true;
  dirty = false;
  destroyed = false;
  constructor(public id: string) {}

  static async load(cookieId?: string): Promise<Session> {
    await ensureSessionTable();
    if (cookieId && /^[a-f0-9]{48}$/.test(cookieId)) {
      const row = await readRow(cookieId);
      if (row && time() - row.updated_at < TTL) {
        const s = new Session(cookieId);
        try { s.data = JSON.parse(row.data); } catch { s.data = {}; }
        s.isNew = false;
        return s;
      }
    }
    return new Session(randomBytes(24).toString('hex'));
  }

  /** Call after mutating `data` */
  touch() { this.dirty = true; }

  destroy() { this.destroyed = true; this.data = {}; this.dirty = true; }

  async save() {
    if (this.destroyed) {
      if (MONGO) await (await getDb()).collection('web_sessions').deleteOne({ _id: this.id as any });
      else await db.run('DELETE FROM web_sessions WHERE id = ?', [this.id]);
      return;
    }
    if (!this.dirty && !this.isNew) return;
    if (this.isNew && Object.keys(this.data).length === 0) return; // don't persist empty anonymous sessions
    if (MONGO) {
      await (await getDb()).collection('web_sessions').updateOne({ _id: this.id as any }, { $set: { data: JSON.stringify(this.data), updated_at: time() } }, { upsert: true });
    } else {
      await db.run(
        'INSERT INTO web_sessions (id, data, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)',
        [this.id, JSON.stringify(this.data), time()]
      );
    }
    this.isNew = false;
    this.dirty = false;
    // opportunistic garbage collection
    if (Math.random() < 0.01) {
      if (MONGO) await (await getDb()).collection('web_sessions').deleteMany({ updated_at: { $lt: time() - TTL } });
      else await db.run('DELETE FROM web_sessions WHERE updated_at < ?', [time() - TTL]);
    }
  }
}
