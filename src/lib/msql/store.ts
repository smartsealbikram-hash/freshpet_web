import { Decimal128, Db, MongoClient } from 'mongodb';
import { env } from '../env';
import { Dec, curDate, curDateTime, fixed, istNow, fmtDateTime, toNum, toStr } from './value';

/**
 * MongoDB storage layer.
 *  - one collection per original table, one document per row, `_id` = the row's integer `id`
 *  - column values keep their SQL meaning: INT -> number, DECIMAL -> Decimal128, VARCHAR/TEXT -> string, DATE/DATETIME/TIME -> the same
 *    'YYYY-MM-DD[ HH:MM:SS]' strings the MySQL driver returned, NULL -> null
 *  - `_schema` holds the table definitions (columns, types, defaults, unique keys), `_counters` the AUTO_INCREMENT values.
 */
export interface ColDef {
  name: string;
  type: string; // int | decimal | varchar | char | text | mediumtext | date | datetime | time | ...
  full: string; // e.g. varchar(255), decimal(10,2)
  nullable: boolean;
  def: string | null;
  defGenerated: boolean;
  len: number | null;
  scale: number | null;
  auto: boolean;
  key: string; // PRI | UNI | MUL | ''
}
export interface TableDef {
  name: string;
  cols: ColDef[];
  map: Map<string, ColDef>;
  unique: string[][];
  indexes: string[][];
}

const g = globalThis as any;

export function mongoUrl() { return process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017'; }
export function mongoDbName() { return process.env.MONGO_DB ?? 'freshpet'; }

export async function getClient(): Promise<MongoClient> {
  if (!g.__fpMongo) {
    const c = new MongoClient(mongoUrl(), { maxPoolSize: 20, serverSelectionTimeoutMS: 8000, appName: 'freshpet' });
    g.__fpMongo = c.connect().catch((e) => { g.__fpMongo = null; throw e; });
  }
  return g.__fpMongo;
}
export async function getDb(): Promise<Db> { return (await getClient()).db(mongoDbName()); }

export async function getCatalog(): Promise<Map<string, TableDef>> {
  if (!g.__fpCatalog) {
    g.__fpCatalog = (async () => {
      const db = await getDb();
      const docs = await db.collection('_schema').find({}).toArray();
      if (!docs.length) throw new Error(`MongoDB database "${mongoDbName()}" has no data. Run: npm run db:mongo`);
      const m = new Map<string, TableDef>();
      for (const d of docs as any[]) {
        const cols: ColDef[] = d.cols;
        m.set(String(d._id), { name: String(d._id), cols, map: new Map(cols.map((c) => [c.name.toLowerCase(), c])), unique: d.unique ?? [], indexes: d.indexes ?? [] });
      }
      return m;
    })().catch((e) => { g.__fpCatalog = null; throw e; });
  }
  return g.__fpCatalog;
}
export function resetCatalog() { g.__fpCatalog = null; }

export async function tableDef(name: string): Promise<TableDef> {
  const cat = await getCatalog();
  const t = cat.get(name) ?? [...cat.values()].find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!t) throw new Error(`Table '${name}' doesn't exist`);
  return t;
}

/* ---------------------------------------------------------------- decoding (Mongo document -> engine row) */
export function decodeDoc(doc: any, td: TableDef, want?: ColDef[]): Record<string, any> {
  const out: Record<string, any> = { _id: doc._id };
  for (const c of want ?? td.cols) {
    let v = doc[c.name];
    if (v === undefined) v = null;
    else if (v instanceof Decimal128) v = new Dec(parseFloat(v.toString()), c.scale ?? 0);
    else if (v && typeof v === 'object' && typeof (v as any).buffer !== 'undefined' && (v as any)._bsontype === 'Binary') v = Buffer.from((v as any).buffer);
    out[c.name] = v;
  }
  return out;
}

/* ---------------------------------------------------------------- encoding (SQL value -> stored value) */
const isIntType = (t: string) => ['int', 'tinyint', 'smallint', 'mediumint', 'bigint', 'year'].includes(t);
const isStrType = (t: string) => ['varchar', 'char', 'text', 'tinytext', 'mediumtext', 'longtext', 'enum', 'set'].includes(t);

export function normDate(v: any): string {
  const s = toStr(v) ?? '';
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (!m) return '0000-00-00';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}
export function normDateTime(v: any): string {
  const s = toStr(v) ?? '';
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(s);
  if (!m) return '0000-00-00 00:00:00';
  const p = (x?: string) => (x ?? '0').padStart(2, '0');
  return `${m[1]}-${p(m[2])}-${p(m[3])} ${p(m[4])}:${p(m[5])}:${p(m[6])}`;
}
export function normTime(v: any): string {
  const s = toStr(v) ?? '';
  const m = /^\s*(-?\d{1,3}):(\d{1,2})(?::(\d{1,2}))?/.exec(s);
  if (!m) return '00:00:00';
  const sign = m[1].startsWith('-') ? '-' : '';
  return `${sign}${m[1].replace('-', '').padStart(2, '0')}:${m[2].padStart(2, '0')}:${(m[3] ?? '0').padStart(2, '0')}`;
}

export function implicitDefault(c: ColDef): any {
  if (c.nullable) return null;
  if (isIntType(c.type)) return 0;
  if (c.type === 'decimal') return Decimal128.fromString(fixed(0, c.scale ?? 0));
  if (c.type === 'date') return '0000-00-00';
  if (c.type === 'datetime' || c.type === 'timestamp') return '0000-00-00 00:00:00';
  if (c.type === 'time') return '00:00:00';
  return '';
}

/** Coerce an SQL value to the column type the way non-strict MySQL does. */
export function coerce(c: ColDef, v: any, mode: 'insert' | 'update'): any {
  if (v === undefined) v = null;
  if (v === null) {
    if (c.nullable) return null;
    if (mode === 'insert') throw new Error(`Column '${c.name}' cannot be null`);
    return implicitDefault(c);
  }
  if (typeof v === 'object' && !(v instanceof Dec) && !Buffer.isBuffer(v)) {
    throw new Error(`Cannot store a ${Array.isArray(v) ? 'list' : 'complex value'} in column '${c.name}'`);
  }
  if (isIntType(c.type)) {
    const n = toNum(v)!;
    if (!isFinite(n)) return 0;
    const r = Math.sign(n) * Math.round(Math.abs(n));
    return r === 0 ? 0 : r;
  }
  if (c.type === 'decimal') {
    const n = toNum(v)!;
    return Decimal128.fromString(fixed(isFinite(n) ? n : 0, c.scale ?? 0));
  }
  if (isStrType(c.type)) {
    let s = String(toStr(v));
    if ((c.type === 'varchar' || c.type === 'char') && c.len && s.length > c.len) s = [...s].slice(0, c.len).join('');
    return s;
  }
  if (c.type === 'date') return normDate(v);
  if (c.type === 'datetime' || c.type === 'timestamp') return normDateTime(v);
  if (c.type === 'time') return normTime(v);
  return v;
}

/** Default value for a column that an INSERT did not mention. */
export function defaultFor(c: ColDef): any {
  if (c.def !== null && c.def !== undefined) {
    if (c.defGenerated) {
      const u = c.def.toUpperCase();
      if (u.startsWith('CURRENT_TIMESTAMP') || u === 'NOW()') return c.type === 'date' ? curDate() : curDateTime();
      const m = /^_[a-z0-9]+'([\s\S]*)'$/i.exec(c.def.replace(/\\'/g, "'"));
      if (m) return coerce(c, m[1].replace(/\\\\/g, '\\'), 'insert');
      return coerce(c, c.def, 'insert');
    }
    if (c.def.toUpperCase() === 'NULL' && c.nullable) return null;
    return coerce(c, c.def, 'insert');
  }
  return implicitDefault(c);
}

/* ---------------------------------------------------------------- auto-increment */
export async function nextId(table: string): Promise<number> {
  const db = await getDb();
  const r = await db.collection('_counters').findOneAndUpdate({ _id: table as any }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  return (r as any).seq ?? (r as any).value?.seq;
}
export async function bumpCounter(table: string, id: number) {
  const db = await getDb();
  await db.collection('_counters').updateOne({ _id: table as any }, { $max: { seq: id } }, { upsert: true });
}

export { istNow, fmtDateTime };
