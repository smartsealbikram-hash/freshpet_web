import { Expr } from './parser';
import {
  Dec, addInterval, cmp, curDate, curDateTime, dateFormat, dayName, eq, fixed, isDec, isNumK, keyOf, likeMatch, monthName, norm, outVal, parseDt, sortCmp, toNum, toStr, truthy,
} from './value';

/* ---------------------------------------------------------------- runtime environment */
export interface Env {
  rows: any[]; // one row object (or null for a LEFT JOIN miss) per source, aligned with the scope's sources
  parent?: Env;
  group?: Env[]; // set while evaluating a grouped row: the member rows
  values?: Record<string, any>; // INSERT ... ON DUPLICATE KEY UPDATE: the row that would have been inserted (VALUES(col))
}

export interface EvalCx {
  params: any[];
  /** run an (already parsed) sub-select; returns the data rows as arrays */
  sub(node: any, env: Env): any[][];
}

const AGG = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'GROUP_CONCAT']);

export function hasAgg(e: Expr): boolean {
  if (!e || typeof e !== 'object') return false;
  switch (e.k) {
    case 'fn': return !!e.agg || e.args.some(hasAgg);
    case 'bin': return hasAgg(e.l) || hasAgg(e.r);
    case 'un': case 'paren': case 'isnull': case 'istrue': case 'cast': return hasAgg(e.e);
    case 'like': case 'regexp': return hasAgg(e.e) || hasAgg(e.pat);
    case 'in': return hasAgg(e.e) || (e.list ? e.list.some(hasAgg) : false);
    case 'between': return hasAgg(e.e) || hasAgg(e.lo) || hasAgg(e.hi);
    case 'case': return (e.operand ? hasAgg(e.operand) : false) || e.whens.some(([c, r]: any) => hasAgg(c) || hasAgg(r)) || (e.els ? hasAgg(e.els) : false);
    case 'interval': return hasAgg(e.e);
    default: return false;
  }
}

export function hasSub(e: Expr): boolean {
  if (!e || typeof e !== 'object') return false;
  switch (e.k) {
    case 'sub': case 'exists': return true;
    case 'fn': return e.args.some(hasSub);
    case 'bin': return hasSub(e.l) || hasSub(e.r);
    case 'un': case 'paren': case 'isnull': case 'istrue': case 'cast': case 'interval': return hasSub(e.e);
    case 'like': case 'regexp': return hasSub(e.e) || hasSub(e.pat);
    case 'in': return !!e.sub || hasSub(e.e) || (e.list ? e.list.some(hasSub) : false);
    case 'between': return hasSub(e.e) || hasSub(e.lo) || hasSub(e.hi);
    case 'case': return (e.operand ? hasSub(e.operand) : false) || e.whens.some(([c, r]: any) => hasSub(c) || hasSub(r)) || (e.els ? hasSub(e.els) : false);
    default: return false;
  }
}

/** Visit every expression node (not descending into sub-selects). */
export function walk(e: Expr, f: (n: any) => void) {
  if (!e || typeof e !== 'object') return;
  f(e);
  switch (e.k) {
    case 'fn': e.args.forEach((a: any) => walk(a, f)); if (e.order) e.order.forEach((o: any) => walk(o.e, f)); break;
    case 'bin': walk(e.l, f); walk(e.r, f); break;
    case 'un': case 'paren': case 'isnull': case 'istrue': case 'cast': case 'interval': walk(e.e, f); break;
    case 'like': case 'regexp': walk(e.e, f); walk(e.pat, f); break;
    case 'in': walk(e.e, f); if (e.list) e.list.forEach((a: any) => walk(a, f)); break;
    case 'between': walk(e.e, f); walk(e.lo, f); walk(e.hi, f); break;
    case 'case': if (e.operand) walk(e.operand, f); e.whens.forEach(([c, r]: any) => { walk(c, f); walk(r, f); }); if (e.els) walk(e.els, f); break;
  }
}

/* ---------------------------------------------------------------- arithmetic with MySQL result types */
const scaleOf = (v: any) => (v instanceof Dec ? v.s : 0);
const isIntLike = (v: any) => (typeof v === 'number' && Number.isInteger(v)) || (v instanceof Dec);

function arith(op: string, a: any, b: any): any {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  const x = toNum(a)!, y = toNum(b)!;
  const exact = (isNumK(a) && (isDec(a) || Number.isInteger(a))) && (isNumK(b) && (isDec(b) || Number.isInteger(b)));
  switch (op) {
    case '+': { const r = x + y; if (!exact) return r; return (isDec(a) || isDec(b)) ? new Dec(r, Math.max(scaleOf(a), scaleOf(b))) : r; }
    case '-': { const r = x - y; if (!exact) return r; return (isDec(a) || isDec(b)) ? new Dec(r, Math.max(scaleOf(a), scaleOf(b))) : r; }
    case '*': { const r = x * y; if (!exact) return r; return (isDec(a) || isDec(b)) ? new Dec(r, scaleOf(a) + scaleOf(b)) : r; }
    case '/': { if (y === 0) return null; const r = x / y; return exact ? new Dec(r, scaleOf(a) + 4) : r; }
    case 'DIV': { if (y === 0) return null; return Math.trunc(x / y); }
    case '%': case 'MOD': { if (y === 0) return null; const r = x % y; return exact && (isDec(a) || isDec(b)) ? new Dec(r, Math.max(scaleOf(a), scaleOf(b))) : r; }
  }
  throw new Error(`Unsupported operator ${op}`);
}

function isTemporalFn(v: any) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v); }

/* ---------------------------------------------------------------- evaluator */
export function ev(e: Expr, env: Env, cx: EvalCx): any {
  switch (e.k) {
    case 'lit': return e.v;
    case 'param': {
      const v = cx.params[e.i];
      return v === undefined ? null : v;
    }
    case 'paren': return ev(e.e, env, cx);
    case 'col': {
      if (e.aliasExpr) return ev(e.aliasExpr, env, cx);
      let en: Env | undefined = env;
      for (let i = 0; i < e.up; i++) en = en!.parent;
      const r = en!.rows[e.si];
      if (r === null || r === undefined) return null;
      const v = r[e.key];
      return v === undefined ? null : v;
    }
    case 'un': {
      const v = ev(e.e, env, cx);
      if (e.op === 'NOT') { const t = truthy(v); return t === null ? null : t ? 0 : 1; }
      if (v === null) return null;
      if (v instanceof Dec) return new Dec(-v.v, v.s);
      return -(toNum(v)!);
    }
    case 'bin': return evBin(e, env, cx);
    case 'isnull': { const v = ev(e.e, env, cx); const n = v === null || v === undefined || (!e.not && e.e.zeroNull === true && typeof v === 'string' && v.startsWith('0000-00-00')); return (e.not ? !n : n) ? 1 : 0; }
    case 'istrue': { const t = truthy(ev(e.e, env, cx)); const r = t === e.val; return (e.not ? !r : r) ? 1 : 0; }
    case 'like': {
      const r = likeMatch(ev(e.e, env, cx), ev(e.pat, env, cx), e.esc ?? '\\');
      return r === null ? null : e.not ? 1 - r : r;
    }
    case 'regexp': {
      const v = ev(e.e, env, cx), p = ev(e.pat, env, cx);
      if (v === null || p === null) return null;
      const r = new RegExp(String(toStr(p)), 'i').test(String(toStr(v))) ? 1 : 0;
      return e.not ? 1 - r : r;
    }
    case 'between': {
      const v = ev(e.e, env, cx), lo = ev(e.lo, env, cx), hi = ev(e.hi, env, cx);
      const c1 = cmp(v, lo), c2 = cmp(v, hi);
      let r: 0 | 1 | null;
      const a = c1 === null ? null : c1 >= 0 ? 1 : 0;
      const b = c2 === null ? null : c2 <= 0 ? 1 : 0;
      if (a === 0 || b === 0) r = 0; else if (a === null || b === null) r = null; else r = 1;
      return r === null ? null : e.not ? 1 - r : r;
    }
    case 'in': {
      const v = ev(e.e, env, cx);
      let items: any[];
      if (e.sub) items = cx.sub(e, env).map((r) => r[0]);
      else { items = []; for (const x of e.list) { const y = ev(x, env, cx); if (Array.isArray(y)) items.push(...y); else items.push(y); } }
      if (v === null || v === undefined) return null;
      let sawNull = false, found = false;
      for (const it of items) { const c = cmp(v, it); if (c === null) sawNull = true; else if (c === 0) { found = true; break; } }
      if (found) return e.not ? 0 : 1;
      if (sawNull) return null;
      return e.not ? 1 : 0;
    }
    case 'sub': {
      const rows = cx.sub(e, env);
      if (rows.length > 1) throw new Error('Subquery returns more than 1 row');
      return rows.length ? rows[0][0] : null;
    }
    case 'exists': { const rows = cx.sub(e, env); const r = rows.length > 0; return (e.not ? !r : r) ? 1 : 0; }
    case 'case': {
      if (e.operand) {
        const o = ev(e.operand, env, cx);
        for (const [c, r] of e.whens) if (eq(o, ev(c, env, cx)) === 1) return ev(r, env, cx);
      } else {
        for (const [c, r] of e.whens) if (truthy(ev(c, env, cx)) === 1) return ev(r, env, cx);
      }
      return e.els ? ev(e.els, env, cx) : null;
    }
    case 'interval': throw new Error('INTERVAL is only valid next to + or -');
    case 'cast': return evCast(e, env, cx);
    case 'fn': return e.agg ? evAgg(e, env, cx) : evFn(e, env, cx);
  }
  throw new Error(`Cannot evaluate expression of kind ${e.k}`);
}

function evBin(e: any, env: Env, cx: EvalCx): any {
  const op = e.op;
  if (op === 'AND') {
    const a = truthy(ev(e.l, env, cx));
    if (a === 0) return 0;
    const b = truthy(ev(e.r, env, cx));
    if (b === 0) return 0;
    return a === null || b === null ? null : 1;
  }
  if (op === 'OR') {
    const a = truthy(ev(e.l, env, cx));
    if (a === 1) return 1;
    const b = truthy(ev(e.r, env, cx));
    if (b === 1) return 1;
    return a === null || b === null ? null : 0;
  }
  if (op === 'XOR') {
    const a = truthy(ev(e.l, env, cx)), b = truthy(ev(e.r, env, cx));
    return a === null || b === null ? null : a !== b ? 1 : 0;
  }
  if ((op === '+' || op === '-') && (e.r.k === 'interval' || e.l.k === 'interval')) {
    const iv = e.r.k === 'interval' ? e.r : e.l;
    const base = ev(e.r.k === 'interval' ? e.l : e.r, env, cx);
    const n = ev(iv.e, env, cx);
    if (base === null || n === null) return null;
    return addInterval(base, toNum(n)!, iv.unit, op === '+' ? 1 : -1);
  }
  const l = ev(e.l, env, cx), r = ev(e.r, env, cx);
  switch (op) {
    case '=': return eq(l, r);
    case '!=': { const c = cmp(l, r); return c === null ? null : c !== 0 ? 1 : 0; }
    case '<': { const c = cmp(l, r); return c === null ? null : c < 0 ? 1 : 0; }
    case '<=': { const c = cmp(l, r); return c === null ? null : c <= 0 ? 1 : 0; }
    case '>': { const c = cmp(l, r); return c === null ? null : c > 0 ? 1 : 0; }
    case '>=': { const c = cmp(l, r); return c === null ? null : c >= 0 ? 1 : 0; }
    case '<=>': { if (l === null || r === null) return l === null && r === null ? 1 : 0; return eq(l, r); }
    default: return arith(op, l, r);
  }
}

function evCast(e: any, env: Env, cx: EvalCx): any {
  const v = ev(e.e, env, cx);
  if (v === null) return null;
  switch (e.type) {
    case 'SIGNED': case 'INTEGER': case 'INT': return Math.trunc(toNum(v)!);
    case 'UNSIGNED': return Math.abs(Math.trunc(toNum(v)!));
    case 'CHAR': return toStr(v);
    case 'DATE': { const p = parseDt(v); return p ? `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` : null; }
    case 'DECIMAL': return new Dec(toNum(v)!, 0);
    case 'DOUBLE': case 'FLOAT': return toNum(v);
  }
  throw new Error(`Unsupported CAST type ${e.type}`);
}

function evAgg(e: any, env: Env, cx: EvalCx): any {
  const group = env.group;
  if (!group) throw new Error(`Invalid use of group function ${e.name}`);
  if (e.name === 'COUNT') {
    if (e.star) return group.length;
    if (e.distinct) { const s = new Set<string>(); for (const g of group) { const v = ev(e.args[0], g, cx); if (v !== null) s.add(keyOf(v)); } return s.size; }
    let n = 0; for (const g of group) if (ev(e.args[0], g, cx) !== null) n++;
    return n;
  }
  let vals: any[] = [];
  const arg = e.args[0];
  for (const g of group) {
    const v = ev(arg, g, cx);
    if (v !== null) vals.push(v);
  }
  if (e.distinct) { const seen = new Set<string>(); vals = vals.filter((v) => { const k = keyOf(v); if (seen.has(k)) return false; seen.add(k); return true; }); }
  switch (e.name) {
    case 'SUM': case 'AVG': {
      if (!vals.length) return null;
      let sum = 0, exact = true, scale = 0;
      for (const v of vals) {
        if (typeof v === 'string' || (typeof v === 'number' && !Number.isInteger(v))) exact = false;
        if (v instanceof Dec) scale = Math.max(scale, v.s);
        sum += toNum(v)!;
      }
      if (e.name === 'SUM') return exact ? new Dec(sum, scale) : sum;
      const avg = sum / vals.length;
      return exact ? new Dec(avg, scale + 4) : avg;
    }
    case 'MIN': case 'MAX': {
      if (!vals.length) return null;
      let best = vals[0];
      for (const v of vals) { const c = sortCmp(v, best); if (e.name === 'MIN' ? c < 0 : c > 0) best = v; }
      return best;
    }
    case 'GROUP_CONCAT': {
      // GROUP_CONCAT(expr1, expr2 ...) concatenates all args per row
      let items: { s: string; g: Env }[] = [];
      for (const g of group) {
        const parts: string[] = [];
        let isNull = false;
        for (const a of e.args) { const v = ev(a, g, cx); if (v === null) { isNull = true; break; } parts.push(String(toStr(v))); }
        if (!isNull) items.push({ s: parts.join(''), g });
      }
      if (e.distinct) { const seen = new Set<string>(); items = items.filter((it) => { const k = norm(it.s); if (seen.has(k)) return false; seen.add(k); return true; }); }
      if (e.order) {
        const keyed = items.map((it) => ({ it, ks: e.order.map((o: any) => ev(o.e, it.g, cx)) }));
        keyed.sort((p, q) => { for (let i = 0; i < e.order.length; i++) { const c = sortCmp(p.ks[i], q.ks[i]); if (c) return e.order[i].desc ? -c : c; } return 0; });
        items = keyed.map((k) => k.it);
      }
      if (!items.length) return null;
      const out = items.map((i) => i.s).join(e.sep ?? ',');
      return out.length > 1024 ? out.slice(0, 1024) : out; // group_concat_max_len default
    }
  }
  throw new Error(`Unsupported aggregate ${e.name}`);
}

const needArgs = (e: any, n: number) => { if (e.args.length < n) throw new Error(`Incorrect parameter count in the call to native function '${e.name}'`); };

function evFn(e: any, env: Env, cx: EvalCx): any {
  const name = e.name;
  const a = (i: number) => ev(e.args[i], env, cx);
  switch (name) {
    case 'IFNULL': { needArgs(e, 2); const v = a(0); return v === null ? a(1) : v; }
    case 'COALESCE': { for (let i = 0; i < e.args.length; i++) { const v = a(i); if (v !== null) return v; } return null; }
    case 'NULLIF': { const x = a(0), y = a(1); return eq(x, y) === 1 ? null : x; }
    case 'IF': { needArgs(e, 3); return truthy(a(0)) === 1 ? a(1) : a(2); }
    case 'CONCAT': {
      let s = '';
      for (let i = 0; i < e.args.length; i++) { const v = a(i); if (v === null) return null; s += toStr(v); }
      return s;
    }
    case 'CONCAT_WS': {
      const sep = a(0); if (sep === null) return null;
      const parts: string[] = [];
      for (let i = 1; i < e.args.length; i++) { const v = a(i); if (v !== null) parts.push(String(toStr(v))); }
      return parts.join(String(toStr(sep)));
    }
    case 'LOWER': case 'LCASE': { const v = a(0); return v === null ? null : String(toStr(v)).toLowerCase(); }
    case 'UPPER': case 'UCASE': { const v = a(0); return v === null ? null : String(toStr(v)).toUpperCase(); }
    case 'TRIM': { const v = a(0); return v === null ? null : String(toStr(v)).trim(); }
    case 'LTRIM': { const v = a(0); return v === null ? null : String(toStr(v)).replace(/^\s+/, ''); }
    case 'RTRIM': { const v = a(0); return v === null ? null : String(toStr(v)).replace(/\s+$/, ''); }
    case 'LENGTH': { const v = a(0); return v === null ? null : Buffer.byteLength(String(toStr(v)), 'utf8'); }
    case 'CHAR_LENGTH': case 'CHARACTER_LENGTH': { const v = a(0); return v === null ? null : [...String(toStr(v))].length; }
    case 'SUBSTRING': case 'SUBSTR': {
      const v = a(0), pos = a(1); if (v === null || pos === null) return null;
      const s = [...String(toStr(v))];
      let p = Math.trunc(toNum(pos)!);
      const start = p > 0 ? p - 1 : p < 0 ? s.length + p : s.length;
      if (e.args.length > 2) { const l = a(2); if (l === null) return null; const n = Math.trunc(toNum(l)!); return n <= 0 ? '' : s.slice(Math.max(start, 0), Math.max(start, 0) + n).join(''); }
      return s.slice(Math.max(start, 0)).join('');
    }
    case 'LEFT': { const v = a(0), n = a(1); return v === null || n === null ? null : [...String(toStr(v))].slice(0, Math.max(0, Math.trunc(toNum(n)!))).join(''); }
    case 'RIGHT': { const v = a(0), n = a(1); if (v === null || n === null) return null; const s = [...String(toStr(v))]; const k = Math.max(0, Math.trunc(toNum(n)!)); return k ? s.slice(-k).join('') : ''; }
    case 'REPLACE': { const v = a(0), f = a(1), t = a(2); if (v === null || f === null || t === null) return null; return String(toStr(v)).split(String(toStr(f))).join(String(toStr(t))); }
    case 'REVERSE': { const v = a(0); return v === null ? null : [...String(toStr(v))].reverse().join(''); }
    case 'ABS': { const v = a(0); if (v === null) return null; return v instanceof Dec ? new Dec(Math.abs(v.v), v.s) : Math.abs(toNum(v)!); }
    case 'ROUND': {
      const v = a(0); if (v === null) return null;
      const d = e.args.length > 1 ? Math.trunc(toNum(a(1))!) : 0;
      const n = toNum(v)!;
      const f = Math.pow(10, d);
      const r = Math.sign(n) * Math.round(Math.abs(n) * f + 1e-9) / f;
      if (v instanceof Dec) return new Dec(r, Math.max(0, Math.min(v.s, d)));
      return Number.isInteger(v) ? r : r;
    }
    case 'FLOOR': { const v = a(0); return v === null ? null : Math.floor(toNum(v)!); }
    case 'CEIL': case 'CEILING': { const v = a(0); return v === null ? null : Math.ceil(toNum(v)!); }
    case 'GREATEST': case 'LEAST': {
      let best: any = undefined;
      for (let i = 0; i < e.args.length; i++) { const v = a(i); if (v === null) return null; if (best === undefined || (name === 'GREATEST' ? sortCmp(v, best) > 0 : sortCmp(v, best) < 0)) best = v; }
      return best ?? null;
    }
    case 'FIELD': {
      const x = a(0); if (x === null) return 0;
      for (let i = 1; i < e.args.length; i++) if (eq(x, a(i)) === 1) return i;
      return 0;
    }
    case 'FIND_IN_SET': {
      const x = a(0), l = a(1); if (x === null || l === null) return null;
      const parts = String(toStr(l)).split(',');
      const i = parts.findIndex((p) => norm(p) === norm(String(toStr(x))));
      return i + 1;
    }
    case 'CURDATE': case 'CURRENT_DATE': return curDate();
    case 'NOW': case 'CURRENT_TIMESTAMP': case 'LOCALTIME': case 'LOCALTIMESTAMP': case 'SYSDATE': return curDateTime();
    case 'DATE': { const v = a(0); const p = parseDt(v); return p ? `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` : null; }
    case 'YEAR': { const p = parseDt(a(0)); return p ? p.y : null; }
    case 'MONTH': { const p = parseDt(a(0)); return p ? p.m : null; }
    case 'DAY': case 'DAYOFMONTH': { const p = parseDt(a(0)); return p ? p.d : null; }
    case 'HOUR': { const p = parseDt(a(0)); return p ? p.h : null; }
    case 'MONTHNAME': { const p = parseDt(a(0)); return p ? monthName(p.m) : null; }
    case 'DAYNAME': { const p = parseDt(a(0)); return p ? dayName(p) : null; }
    case 'DAYOFWEEK': { const p = parseDt(a(0)); return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 1 : null; }
    case 'DATE_FORMAT': { const v = a(0), f = a(1); return v === null || f === null ? null : dateFormat(v, String(toStr(f))); }
    case 'DATEDIFF': {
      const x = parseDt(a(0)), y = parseDt(a(1)); if (!x || !y) return null;
      return Math.round((Date.UTC(x.y, x.m - 1, x.d) - Date.UTC(y.y, y.m - 1, y.d)) / 86400e3);
    }
    case 'DATE_ADD': case 'DATE_SUB': case 'ADDDATE': case 'SUBDATE': {
      const iv = e.args[1];
      if (!iv || iv.k !== 'interval') throw new Error(`${name} requires an INTERVAL`);
      const base = a(0), n = ev(iv.e, env, cx); if (base === null || n === null) return null;
      return addInterval(base, toNum(n)!, iv.unit, name === 'DATE_ADD' || name === 'ADDDATE' ? 1 : -1);
    }
    case 'TIMESTAMPDIFF': {
      const unit = e.args[0].k === 'col' ? e.args[0].name.toUpperCase() : String(a(0)).toUpperCase();
      const x = parseDt(ev(e.args[1], env, cx)), y = parseDt(ev(e.args[2], env, cx)); if (!x || !y) return null;
      const ms = Date.UTC(y.y, y.m - 1, y.d, y.h, y.i, y.s) - Date.UTC(x.y, x.m - 1, x.d, x.h, x.i, x.s);
      const div = unit === 'SECOND' ? 1e3 : unit === 'MINUTE' ? 60e3 : unit === 'HOUR' ? 3600e3 : unit === 'DAY' ? 86400e3 : unit === 'WEEK' ? 604800e3 : 0;
      if (div) return Math.trunc(ms / div);
      if (unit === 'MONTH' || unit === 'YEAR') {
        let m = (y.y - x.y) * 12 + (y.m - x.m);
        const dx = [x.d, x.h, x.i, x.s], dy = [y.d, y.h, y.i, y.s];
        for (let i = 0; i < 4; i++) { if (dy[i] > dx[i]) break; if (dy[i] < dx[i]) { m += m > 0 ? -1 : 0; break; } }
        return unit === 'YEAR' ? Math.trunc(m / 12) : m;
      }
      throw new Error(`Unsupported TIMESTAMPDIFF unit ${unit}`);
    }
    case 'VALUES': {
      const c = e.args[0];
      const vals = env.values ?? {};
      let nv = vals[c.name];
      if (nv === undefined) { const k = Object.keys(vals).find((x) => x.toLowerCase() === String(c.name).toLowerCase()); nv = k ? vals[k] : undefined; }
      return nv === undefined ? null : nv;
    }
    case 'CHAR': return String.fromCharCode(...e.args.map((_: any, i: number) => toNum(a(i))!));
    case 'LAST_INSERT_ID': return 0;
    case 'RAND': return Math.random();
  }
  throw new Error(`Unsupported SQL function ${name}()`);
}

export { fixed, outVal };
