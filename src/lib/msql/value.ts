/**
 * Value model of the SQL-on-MongoDB engine. It mimics what mysql2 returned for the original MySQL/MariaDB database:
 *  - INT/BIGINT/DOUBLE  -> JS number
 *  - DECIMAL            -> Dec (rendered as a string with its scale, e.g. "12.50"; exactly like mysql2 with decimalNumbers:false)
 *  - CHAR/VARCHAR/TEXT/DATE/DATETIME/TIME -> JS string (dates are 'YYYY-MM-DD' / 'YYYY-MM-DD HH:MM:SS')
 *  - NULL               -> null
 */
export class Dec {
  constructor(public v: number, public s: number) {}
  toString() { return fixed(this.v, this.s); }
}

/** Decimal-correct formatting of a number with `s` digits after the point (round half away from zero on the decimal expansion). */
export function fixed(v: number, s: number): string {
  if (!isFinite(v)) return String(v);
  const neg = v < 0;
  const t = Math.abs(v).toFixed(Math.min(100, s + 8));
  const [ip, fp = ''] = t.split('.');
  let digits = ip + fp.slice(0, s);
  if (fp.charAt(s) >= '5') {
    const a = digits.split('');
    let i = a.length - 1;
    while (i >= 0) { if (a[i] === '9') { a[i] = '0'; i--; } else { a[i] = String(+a[i] + 1); break; } }
    digits = (i < 0 ? '1' : '') + a.join('');
  }
  const intLen = digits.length - s;
  const out = s ? digits.slice(0, intLen) + '.' + digits.slice(intLen) : digits;
  return neg && /[1-9]/.test(out) ? '-' + out : out;
}

export const isDec = (v: any): v is Dec => v instanceof Dec;
export const isNumK = (v: any) => typeof v === 'number' || v instanceof Dec;

export function toNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (v instanceof Dec) return v.v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const m = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(v);
    return m ? parseFloat(m[0]) : 0;
  }
  if (Buffer.isBuffer(v)) return toNum(v.toString('utf8'));
  return 0;
}

export function toStr(v: any): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (v instanceof Dec) return v.toString();
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  return String(v);
}

/** SQL truthiness: null | 0 | 1 */
export function truthy(v: any): 0 | 1 | null {
  if (v === null || v === undefined) return null;
  const n = toNum(v);
  return n === 0 ? 0 : 1;
}

// ---- collation (utf8mb4_unicode_ci / general_ci / 0900_ai_ci: case- and accent-insensitive) ----
const normCache = new Map<string, string>();
export function norm(s: string): string {
  let r = normCache.get(s);
  if (r === undefined) {
    r = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (normCache.size > 100000) normCache.clear();
    normCache.set(s, r);
  }
  return r;
}
const stripPad = (s: string) => s.replace(/ +$/, '');
const DT = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/;
const LOOSE_DT = /^\d{2,4}-\d{1,2}-\d{1,2}( \d{1,2}:\d{1,2}:\d{1,2})?$/;
function looseDt(s: string): string | null {
  const m = /^(\d{2,4})-(\d{1,2})-(\d{1,2})(?: (\d{1,2}):(\d{1,2}):(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  let y = +m[1];
  if (m[1].length <= 2) y += y < 70 ? 2000 : 1900;
  const p = (v?: string) => (v ?? '0').padStart(2, '0');
  return `${String(y).padStart(4, '0')}-${p(m[2])}-${p(m[3])} ${p(m[4])}:${p(m[5])}:${p(m[6])}`;
}

/** Three-way compare with MySQL semantics. Returns null when either side is NULL. */
export function cmp(a: any, b: any): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  const an = isNumK(a), bn = isNumK(b);
  if (an || bn) {
    const x = toNum(a)!, y = toNum(b)!;
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (Buffer.isBuffer(a) || Buffer.isBuffer(b)) {
    return Buffer.compare(Buffer.isBuffer(a) ? a : Buffer.from(String(a)), Buffer.isBuffer(b) ? b : Buffer.from(String(b)));
  }
  const x = String(a), y = String(b);
  // MySQL reads a date-looking string next to a DATE/DATETIME value as a date ('26-04-01' = 2026-04-01)
  if (x.length <= 19 && y.length <= 19 && (LOOSE_DT.test(x) || LOOSE_DT.test(y)) && (DT.test(x) || DT.test(y) || (LOOSE_DT.test(x) && LOOSE_DT.test(y)))) {
    const nx = looseDt(x), ny = looseDt(y);
    if (nx && ny) return nx < ny ? -1 : nx > ny ? 1 : 0;
  }
  if (x.length >= 10 && x.length <= 19 && y.length >= 10 && y.length <= 19 && DT.test(x) && DT.test(y)) {
    const px = x.length === 10 ? x + ' 00:00:00' : x, py = y.length === 10 ? y + ' 00:00:00' : y;
    return px < py ? -1 : px > py ? 1 : 0;
  }
  const nx = stripPad(norm(x)), ny = stripPad(norm(y));
  return nx < ny ? -1 : nx > ny ? 1 : 0;
}

export function eq(a: any, b: any): 0 | 1 | null {
  const c = cmp(a, b);
  return c === null ? null : c === 0 ? 1 : 0;
}

/** Sorting comparator: NULL sorts first (ascending), as in MySQL. */
export function sortCmp(a: any, b: any): number {
  const an = a === null || a === undefined, bn = b === null || b === undefined;
  if (an || bn) return an && bn ? 0 : an ? -1 : 1;
  return cmp(a, b)!;
}

/** Grouping / DISTINCT key (collation-aware). */
export function keyOf(v: any): string {
  if (v === null || v === undefined) return 'z';
  if (typeof v === 'number') return 'n' + v;
  if (v instanceof Dec) return 'n' + v.v;
  if (Buffer.isBuffer(v)) return 'b' + v.toString('hex');
  return 's' + stripPad(norm(String(v)));
}

/** Key used to bucket equi-join values (numeric strings are bucketed as numbers like MySQL's numeric comparison). */
export function joinKey(v: any): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return 'n' + v;
  if (v instanceof Dec) return 'n' + v.v;
  if (typeof v === 'string') {
    if (/^\s*-?\d+(\.\d+)?\s*$/.test(v)) return 'n' + Number(v);
    return 's' + stripPad(norm(v));
  }
  return 'b' + String(v);
}

// ---- LIKE ----
const likeCache = new Map<string, RegExp>();
export function likeMatch(value: any, pattern: any, escape = '\\'): 0 | 1 | null {
  if (value === null || value === undefined || pattern === null || pattern === undefined) return null;
  const p = String(toStr(pattern));
  let re = likeCache.get(p + '\u0000' + escape);
  if (!re) {
    const np = norm(p);
    let out = '';
    for (let i = 0; i < np.length; i++) {
      const c = np[i];
      if (c === escape && i + 1 < np.length) { out += np[++i].replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }
      else if (c === '%') out += '[\\s\\S]*';
      else if (c === '_') out += '[\\s\\S]';
      else out += c.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    }
    re = new RegExp('^' + out + '$');
    if (likeCache.size > 2000) likeCache.clear();
    likeCache.set(p + '\u0000' + escape, re);
  }
  return re.test(norm(String(toStr(value)))) ? 1 : 0;
}

// ---- dates (the site runs on IST, like the PHP original) ----
const IST_MS = 5.5 * 3600 * 1000;
export function istNow(): Date { return new Date(Date.now() + IST_MS); }
const p2 = (n: number) => String(n).padStart(2, '0');
export function fmtDate(d: Date): string { return `${String(d.getUTCFullYear()).padStart(4, '0')}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; }
export function fmtDateTime(d: Date): string { return `${fmtDate(d)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`; }
export const curDate = () => fmtDate(istNow());
export const curDateTime = () => fmtDateTime(istNow());

export interface DateParts { y: number; m: number; d: number; h: number; i: number; s: number; hasTime: boolean }
export function parseDt(v: any): DateParts | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === 'string' ? v : toStr(v)!;
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.\d+)?)?/.exec(s);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3], h: m[4] ? +m[4] : 0, i: m[5] ? +m[5] : 0, s: m[6] ? +m[6] : 0, hasTime: m[4] !== undefined };
}
export function partsToDate(p: DateParts): Date { return new Date(Date.UTC(p.y, p.m - 1, p.d, p.h, p.i, p.s)); }

export function addInterval(base: any, n: number, unit: string, sign: 1 | -1): string | null {
  const p = parseDt(base);
  if (!p) return null;
  unit = unit.toUpperCase();
  const k = sign * n;
  const timeUnit = ['HOUR', 'MINUTE', 'SECOND'].includes(unit);
  let y = p.y, mo = p.m, d = p.d, h = p.h, mi = p.i, se = p.s;
  if (unit === 'YEAR' || unit === 'MONTH' || unit === 'QUARTER') {
    const months = unit === 'YEAR' ? k * 12 : unit === 'QUARTER' ? k * 3 : k;
    const total = y * 12 + (mo - 1) + months;
    y = Math.floor(total / 12); mo = (total % 12 + 12) % 12 + 1;
    const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    if (d > dim) d = dim;
    const out = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
    return p.hasTime ? fmtDateTime(out) : fmtDate(out);
  }
  const base2 = Date.UTC(y, mo - 1, d, h, mi, se);
  const mult = unit === 'DAY' ? 86400e3 : unit === 'WEEK' ? 7 * 86400e3 : unit === 'HOUR' ? 3600e3 : unit === 'MINUTE' ? 60e3 : unit === 'SECOND' ? 1e3 : NaN;
  if (isNaN(mult)) throw new Error(`Unsupported INTERVAL unit ${unit}`);
  const out = new Date(base2 + k * mult);
  return p.hasTime || timeUnit ? fmtDateTime(out) : fmtDate(out);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const monthName = (m: number) => MONTHS[m - 1] ?? null;
export const dayName = (p: DateParts) => DAYS[partsToDate(p).getUTCDay()];

export function dateFormat(v: any, fmt: string): string | null {
  const p = parseDt(v);
  if (!p || fmt === null) return null;
  const dt = partsToDate(p);
  const wd = dt.getUTCDay();
  const ord = (n: number) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
  const doy = Math.floor((Date.UTC(p.y, p.m - 1, p.d) - Date.UTC(p.y, 0, 1)) / 86400e3) + 1;
  return fmt.replace(/%(.)/g, (_m, c) => {
    switch (c) {
      case 'Y': return String(p.y).padStart(4, '0');
      case 'y': return p2(p.y % 100);
      case 'm': return p2(p.m);
      case 'c': return String(p.m);
      case 'd': return p2(p.d);
      case 'e': return String(p.d);
      case 'D': return ord(p.d);
      case 'H': return p2(p.h);
      case 'k': return String(p.h);
      case 'h': case 'I': return p2(p.h % 12 === 0 ? 12 : p.h % 12);
      case 'l': return String(p.h % 12 === 0 ? 12 : p.h % 12);
      case 'i': return p2(p.i);
      case 's': case 'S': return p2(p.s);
      case 'p': return p.h < 12 ? 'AM' : 'PM';
      case 'M': return MONTHS[p.m - 1];
      case 'b': return MONTHS[p.m - 1].slice(0, 3);
      case 'W': return DAYS[wd];
      case 'a': return DAYS[wd].slice(0, 3);
      case 'w': return String(wd);
      case 'j': return String(doy).padStart(3, '0');
      case 'T': return `${p2(p.h)}:${p2(p.i)}:${p2(p.s)}`;
      case 'f': return '000000';
      case '%': return '%';
      default: return c;
    }
  });
}

/** MySQL's numeric -> output normalisation: integers stay numbers. */
export function outVal(v: any): any {
  if (v instanceof Dec) return v.toString();
  if (v === undefined) return null;
  return v;
}
