import fs from 'node:fs';
import { env } from './env';
import { Engine, Tx } from './msql/engine';

/**
 * Data access used by every page. It mirrors GStone\DB from the PHP app (selectOne / selectAll / insert / update / delete / count /
 * transactions) so the original SQL statements are used unchanged.
 *
 * Storage engine (DB_ENGINE):
 *   mongo (default)  all data lives in MongoDB. Statements are executed by the SQL engine in ./msql against the collections.
 *   mysql            the original MySQL/MariaDB database (kept only for comparison testing).
 */
export type Row = Record<string, any>;

const g = globalThis as any;

type Runner = { query: (sql: string, args?: any[]) => Promise<any> };

async function mysqlPool(): Promise<any> {
  if (!g.__fpPool2) {
    const mysql = (await import('mysql2/promise')).default;
    g.__fpPool2 = mysql.createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USERNAME,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      charset: 'utf8mb4',
      dateStrings: true, // keep DATE/DATETIME as strings like PDO did
      decimalNumbers: false,
      supportBigNumbers: true,
      bigNumberStrings: false,
      connectionLimit: 10,
      timezone: '+05:30',
      namedPlaceholders: false,
    });
    // The PHP app was written against a non-strict MariaDB (inserts omit NOT NULL columns, zero dates exist).
    (g.__fpPool2 as any).on('connection', (conn: any) => {
      conn.query("SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO'");
    });
  }
  return g.__fpPool2;
}

/** Quote a column identifier (some columns contain '/', '(' or '-', e.g. `m/c_distributor`). */
const qid = (k: string) => (k.includes('`') || k.includes('.') ? k : '`' + k + '`');

function norm(args: any): any[] {
  if (args === undefined || args === null) return [];
  return Array.isArray(args) ? args : [args];
}

const USE_MONGO = env.DB_ENGINE !== 'mysql';

export class DB {
  private runner?: Runner;
  private tx?: Tx;
  constructor(opts?: { runner?: Runner; tx?: Tx }) {
    this.runner = opts?.runner;
    this.tx = opts?.tx;
  }

  async run(sql: string, args: any = []): Promise<any> {
    const a = norm(args);
    if (process.env.SQL_LOG) { try { fs.appendFileSync(process.env.SQL_LOG, JSON.stringify({ sql, args: a }) + '\n'); } catch { /* logging is best effort */ } }
    try {
      if (USE_MONGO) return await new Engine().run(sql, a, this.tx);
      const runner = this.runner ?? (await mysqlPool());
      const [res] = await runner.query(sql, a);
      return res;
    } catch (e: any) {
      console.error(`[db] Query failed: ${e.message}\n  SQL: ${sql}\n  Params: ${JSON.stringify(a)}`);
      throw new Error('An error occurred processing the request');
    }
  }

  async selectOne<T = Row>(sql: string, args: any = []): Promise<T | false> {
    if (sql.trimStart().startsWith('SELECT') && !sql.trimEnd().endsWith('LIMIT 1')) sql += ' LIMIT 1';
    const rows = (await this.run(sql, args)) as T[];
    return rows[0] ?? false;
  }

  async selectAll<T = Row>(sql: string, args: any = []): Promise<T[]> {
    return (await this.run(sql, args)) as T[];
  }

  async count(table: string, where = '', args: any = []): Promise<number> {
    let sql = `SELECT COUNT(id) as total FROM ${table}`;
    if (where) sql += ` WHERE ${where}`;
    const r: any = await this.selectOne(sql, args);
    return Number(r?.total ?? 0);
  }

  async insert(table: string, data: Row): Promise<number> {
    const keys = Object.keys(data);
    const sql = `INSERT INTO ${table} (${keys.map(qid).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
    const res = await this.run(sql, keys.map((k) => data[k]));
    return res.insertId;
  }

  async update(table: string, data: Row, where: string, whereArgs: any = []): Promise<number> {
    const keys = Object.keys(data);
    const sql = `UPDATE ${table} SET ${keys.map((k) => `${qid(k)} = ?`).join(', ')} WHERE ${where}`;
    const res = await this.run(sql, [...keys.map((k) => data[k]), ...norm(whereArgs)]);
    return res.affectedRows;
  }

  async delete(table: string, where: string, args: any = []): Promise<number> {
    const res = await this.run(`DELETE FROM ${table} WHERE ${where}`, args);
    return res.affectedRows;
  }

  /**
   * Run fn inside a transaction; commits on success, rolls back on throw.
   * MySQL: a real transaction. MongoDB: the standalone server has no multi-document transactions, so every write is
   * recorded with an undo step and, if fn throws, the writes are reverted in reverse order.
   */
  async transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T> {
    if (USE_MONGO) {
      const tx = new Tx();
      try {
        return await fn(new DB({ tx }));
      } catch (e) {
        for (const undo of tx.undo.reverse()) {
          try { await undo(); } catch (u: any) { console.error('[db] rollback step failed:', u?.message); }
        }
        throw e;
      }
    }
    const conn = await (await mysqlPool()).getConnection();
    try {
      await conn.beginTransaction();
      const out = await fn(new DB({ runner: conn }));
      await conn.commit();
      return out;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
}

export const db = new DB();
