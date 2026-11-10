import { Decimal128 } from 'mongodb';
import { Env, EvalCx, ev, hasAgg, hasSub, walk } from './eval';
import { Expr, JoinRef, Select, SelectItem, SourceRef, Stmt, parseSql } from './parser';
import { ColDef, TableDef, bumpCounter, coerce, decodeDoc, defaultFor, getCatalog, getDb, nextId, tableDef } from './store';
import { Dec, cmp, istNow, fmtDateTime, joinKey, keyOf, outVal, sortCmp, toNum, toStr, truthy, likeMatch } from './value';

/* ---------------------------------------------------------------- scopes & binding */
interface Src { alias: string; names: string[]; map: Map<string, string>; td?: TableDef; rows?: any[]; cols?: ColDef[]; }
interface Scope { srcs: Src[]; parent?: Scope; usedOuter?: boolean }

function mkSrcFromNames(alias: string, names: string[]): Src {
  return { alias, names, map: new Map(names.map((n) => [n.toLowerCase(), n])) };
}

function resolveCol(scope: Scope, table: string | undefined, name: string): { up: number; si: number; key: string } {
  const lname = name.toLowerCase();
  let sc: Scope | undefined = scope, up = 0;
  while (sc) {
    if (table) {
      const si = sc.srcs.findIndex((s) => s.alias.toLowerCase() === table.toLowerCase());
      if (si >= 0) {
        const key = sc.srcs[si].map.get(lname);
        if (key === undefined) throw new Error(`Unknown column '${table}.${name}' in 'field list'`);
        markOuter(scope, sc);
        return { up, si, key };
      }
    } else {
      let found = -1, key = '';
      for (let i = 0; i < sc.srcs.length; i++) {
        const k = sc.srcs[i].map.get(lname);
        if (k !== undefined) { if (found >= 0) throw new Error(`Column '${name}' in field list is ambiguous`); found = i; key = k; }
      }
      if (found >= 0) { markOuter(scope, sc); return { up, si: found, key }; }
    }
    sc = sc.parent; up++;
  }
  throw new Error(`Unknown column '${table ? table + '.' : ''}${name}' in 'field list'`);
}
function markOuter(from: Scope, to: Scope) { let s: Scope | undefined = from; while (s && s !== to) { s.usedOuter = true; s = s.parent; } }

interface BindOpts { aliasFirst?: SelectItem[]; aliasFallback?: SelectItem[]; }

function bind(e: Expr, scope: Scope, o: BindOpts = {}): void {
  if (!e || typeof e !== 'object') return;
  switch (e.k) {
    case 'col': {
      if (e.bound) return;
      if (!e.table && o.aliasFirst) {
        const it = o.aliasFirst.find((i) => i.e && outName(i).toLowerCase() === e.name.toLowerCase());
        if (it) { e.aliasExpr = it.e; e.bound = true; return; }
      }
      try {
        const r = resolveCol(scope, e.table, e.name);
        e.up = r.up; e.si = r.si; e.key = r.key; e.bound = true;
        // MySQL quirk: `col IS NULL` is also true for the zero date of a NOT NULL DATE/DATETIME column
        let sc2: Scope | undefined = scope; for (let i = 0; i < r.up; i++) sc2 = sc2!.parent;
        const cdef = sc2!.srcs[r.si].td?.map.get(String(r.key).toLowerCase());
        if (cdef && !cdef.nullable && (cdef.type === 'date' || cdef.type === 'datetime')) e.zeroNull = true;
      } catch (err) {
        if (!e.table && o.aliasFallback) {
          const it = o.aliasFallback.find((i) => i.e && outName(i).toLowerCase() === e.name.toLowerCase());
          if (it) { e.aliasExpr = it.e; e.bound = true; return; }
        }
        throw err;
      }
      return;
    }
    case 'fn':
      if (e.name === 'VALUES') return;
      for (const a of e.args) bind(a, scope, o);
      if (e.order) for (const x of e.order) bind(x.e, scope, o);
      return;
    case 'bin': bind(e.l, scope, o); bind(e.r, scope, o); return;
    case 'un': case 'paren': case 'isnull': case 'istrue': case 'cast': case 'interval': bind(e.e, scope, o); return;
    case 'like': case 'regexp': bind(e.e, scope, o); bind(e.pat, scope, o); return;
    case 'in':
      bind(e.e, scope, o);
      if (e.list) e.list.forEach((x: Expr) => bind(x, scope, o));
      return;
    case 'between': bind(e.e, scope, o); bind(e.lo, scope, o); bind(e.hi, scope, o); return;
    case 'case':
      if (e.operand) bind(e.operand, scope, o);
      for (const [c, r] of e.whens) { bind(c, scope, o); bind(r, scope, o); }
      if (e.els) bind(e.els, scope, o);
      return;
    case 'sub': case 'exists': return;
  }
}
const outName = (it: SelectItem): string => it.alias ?? (it.e?.k === 'col' ? it.e.name : it.text);

function splitAnd(e: Expr | undefined, out: Expr[] = []): Expr[] {
  if (!e) return out;
  while (e.k === 'paren') e = e.e;
  if (e.k === 'bin' && e.op === 'AND') { splitAnd(e.l, out); splitAnd(e.r, out); } else out.push(e);
  return out;
}

/** source indices (at this scope's level) referenced by an expression; -1 marks "unknown/unsafe" (outer refs, aggregates, subqueries) */
function srcRefs(e: Expr): Set<number> | null {
  const set = new Set<number>();
  let bad = false;
  walk(e, (n) => {
    if (n.k === 'col') { if (n.aliasExpr || n.up !== 0) bad = true; else set.add(n.si); }
    else if (n.k === 'sub' || n.k === 'exists' || (n.k === 'in' && n.sub) || (n.k === 'fn' && n.agg)) bad = true;
    else if (n.k === 'fn' && n.name === 'VALUES') bad = true;
  });
  return bad ? null : set;
}

/* ---------------------------------------------------------------- result types */
export interface Rs { names: string[]; rows: any[][]; }

export interface WriteResult { affectedRows: number; insertId: number; }

type UndoFn = () => Promise<void>;
export class Tx { undo: UndoFn[] = []; }

/* ---------------------------------------------------------------- the executor */
export class Engine {
  params: any[] = [];
  tx?: Tx;
  cx: EvalCx;
  constructor() {
    this.cx = { params: this.params, sub: (node, env) => this.runSubSync(node, env) };
  }

  /* sub-selects are evaluated asynchronously; the evaluator is synchronous, so correlated/uncorrelated subqueries are
     pre-executed (see prepareSubs) and looked up here. */
  private runSubSync(node: any, env: Env): any[][] {
    if (node.cache) return node.cache;
    if (node.perRow) {
      const key = node.perRow(env);
      const hit = node.rowCache?.get(key);
      if (hit) return hit;
    }
    throw new Error('Internal: sub-select was not prepared');
  }

  async run(sql: string, params: any[], tx?: Tx): Promise<any> {
    this.params.length = 0;
    for (const p of params) this.params.push(normParam(p));
    this.tx = tx;
    const { stmt, nparams } = parseSql(sql);
    if (nparams !== params.length && stmt.kind !== 'noop') {
      // mysql2 expands array params; only complain when there are fewer values than placeholders
      if (params.length < nparams) throw new Error(`Placeholder count mismatch: ${nparams} placeholders, ${params.length} values`);
    }
    switch (stmt.kind) {
      case 'select': {
        const rs = await this.execSelect(stmt);
        return rs.rows.map((r) => {
          const o: Record<string, any> = {};
          for (let i = 0; i < rs.names.length; i++) o[rs.names[i]] = outVal(r[i]);
          return o;
        });
      }
      case 'insert': return this.execInsert(stmt);
      case 'update': return this.execUpdate(stmt);
      case 'delete': return this.execDelete(stmt);
      case 'showcols': return this.execShowCols(stmt);
      case 'noop': return { affectedRows: 0, insertId: 0 };
    }
  }

  /* ---------------------------------------------------------------- SELECT */
  async execSelect(sel: Select, parentScope?: Scope, parentEnv?: Env): Promise<Rs> {
    const first = await this.execSelectCore(sel, parentScope, parentEnv);
    if (!sel.unions) return first;
    let names = first.names;
    let rows = first.rows.slice();
    let distinctAll = false;
    for (const u of sel.unions) {
      const r = await this.execSelectCore(u.sel, parentScope, parentEnv);
      if (r.names.length !== names.length) throw new Error('The used SELECT statements have a different number of columns');
      rows = rows.concat(r.rows);
      if (!u.all) distinctAll = true;
    }
    if (distinctAll) { const seen = new Set<string>(); rows = rows.filter((r) => { const k = r.map(keyOf).join('|'); if (seen.has(k)) return false; seen.add(k); return true; }); }
    if (sel.order.length) {
      const idx = sel.order.map((o) => {
        if (o.e.k === 'lit' && typeof o.e.v === 'number') return o.e.v - 1;
        if (o.e.k === 'col') { const i = names.findIndex((n) => n.toLowerCase() === o.e.name.toLowerCase()); if (i >= 0) return i; }
        throw new Error('ORDER BY on a UNION must use output column names');
      });
      rows.sort((p, q) => { for (let i = 0; i < idx.length; i++) { const c = sortCmp(p[idx[i]], q[idx[i]]); if (c) return sel.order[i].desc ? -c : c; } return 0; });
    }
    if (sel.limit) { const { off, cnt } = this.limits(sel.limit); rows = rows.slice(off, off + cnt); }
    return { names, rows };
  }

  private limits(l: { offset: Expr | null; count: Expr }) {
    const f = (e: Expr) => { const v = ev(e, { rows: [] }, this.cx); return Math.max(0, Math.trunc(toNum(v) ?? 0)); };
    return { off: l.offset ? f(l.offset) : 0, cnt: f(l.count) };
  }

  private async makeSource(ref: SourceRef): Promise<Src> {
    if (ref.sub) {
      const rs = await this.execSelect(ref.sub);
      const s = mkSrcFromNames(ref.alias, rs.names);
      s.rows = rs.rows.map((r) => { const o: Record<string, any> = {}; rs.names.forEach((n, i) => (o[n] = r[i])); return o; });
      return s;
    }
    const td = await tableDef(ref.table!);
    const s = mkSrcFromNames(ref.alias, td.cols.map((c) => c.name));
    s.td = td;
    return s;
  }

  private async execSelectCore(sel: Select, parentScope?: Scope, parentEnv?: Env): Promise<Rs> {
    // ---- sources
    const srcs: Src[] = [];
    if (sel.from) {
      srcs.push(await this.makeSource(sel.from));
      for (const j of sel.joins) srcs.push(await this.makeSource(j.src));
    }
    const scope: Scope = { srcs, parent: parentScope };

    // ---- expand select list
    const items: SelectItem[] = [];
    for (const it of sel.items) {
      if (!it.star) { items.push(it); continue; }
      let any = false;
      srcs.forEach((s, si) => {
        if (it.starTable && s.alias.toLowerCase() !== it.starTable.toLowerCase()) return;
        any = true;
        for (const n of s.names) items.push({ e: { k: 'col', name: n, table: s.alias, up: 0, si, key: n, bound: true }, alias: n, text: n });
      });
      if (!any) throw new Error(`Unknown table '${it.starTable ?? '*'}'`);
    }

    // ---- bind
    items.forEach((it) => bind(it.e, scope));
    sel.joins.forEach((j) => j.on && bind(j.on, scope));
    if (sel.where) bind(sel.where, scope);
    const groupExprs = sel.group.map((g) => resolveOrdinal(g, items));
    groupExprs.forEach((g) => bind(g, scope, { aliasFallback: items }));
    if (sel.having) bind(sel.having, scope, { aliasFallback: items });
    const orderExprs = sel.order.map((o) => ({ e: resolveOrdinal(o.e, items), desc: o.desc }));
    orderExprs.forEach((o) => bind(o.e, scope, { aliasFirst: items }));

    // ---- load rows & join
    const whereConj = splitAnd(sel.where);
    const hasSubs = [sel.where, sel.having, ...items.map((i) => i.e), ...sel.joins.map((j) => j.on), ...orderExprs.map((o) => o.e), ...groupExprs].some((e) => e && hasSub(e));
    const need = hasSubs ? null : neededColumns(srcs, [sel.where, sel.having, ...items.map((i) => i.e), ...sel.joins.map((j) => j.on), ...orderExprs.map((o) => o.e), ...groupExprs]);
    const subExprs = [sel.where, sel.having, ...items.map((i) => i.e), ...orderExprs.map((o) => o.e), ...groupExprs, ...sel.joins.map((j) => j.on)];
    await this.prepareSubs(subExprs, scope, null);
    let envs = await this.buildEnvs(sel, srcs, whereConj, need, parentEnv);
    await this.prepareSubs(subExprs, scope, envs);

    // ---- WHERE
    if (sel.where) envs = envs.filter((env) => truthy(ev(sel.where, env, this.cx)) === 1);

    // ---- group / aggregate / project
    const aggregated = sel.group.length > 0 || items.some((i) => hasAgg(i.e)) || (sel.having ? hasAgg(sel.having) : false) || orderExprs.some((o) => hasAgg(o.e));
    let outRows: { vals: any[]; env: Env }[] = [];
    if (aggregated) {
      let groups: Env[][];
      if (groupExprs.length) {
        const map = new Map<string, Env[]>();
        for (const env of envs) {
          const k = groupExprs.map((g) => keyOf(ev(g, env, this.cx))).join('\u0001');
          const arr = map.get(k);
          if (arr) arr.push(env); else map.set(k, [env]);
        }
        groups = [...map.values()];
      } else groups = [envs];
      for (const grp of groups) {
        const rep: Env = { rows: grp.length ? grp[0].rows : srcs.map(() => null), parent: parentEnv, group: grp };
        if (sel.having && truthy(ev(sel.having, rep, this.cx)) !== 1) continue;
        outRows.push({ vals: items.map((i) => ev(i.e, rep, this.cx)), env: rep });
      }
    } else {
      for (const env of envs) outRows.push({ vals: items.map((i) => ev(i.e, env, this.cx)), env });
    }

    if (sel.distinct) {
      const seen = new Set<string>();
      outRows = outRows.filter((r) => { const k = r.vals.map(keyOf).join('\u0001'); if (seen.has(k)) return false; seen.add(k); return true; });
    }

    if (orderExprs.length) {
      const keyed = outRows.map((r) => ({ r, ks: orderExprs.map((o) => ev(o.e, r.env, this.cx)) }));
      // rows that tie on every ORDER BY key keep their storage (id) order; SQL leaves that order unspecified
      keyed.sort((p, q) => { for (let i = 0; i < orderExprs.length; i++) { const c = sortCmp(p.ks[i], q.ks[i]); if (c) return orderExprs[i].desc ? -c : c; } return 0; });
      outRows = keyed.map((k) => k.r);
    }
    if (sel.limit) { const { off, cnt } = this.limits(sel.limit); outRows = outRows.slice(off, off + cnt); }
    return { names: items.map(colName), rows: outRows.map((r) => r.vals) };
  }

  /** Run every sub-select found in the given expressions. Uncorrelated ones run once; correlated ones run once per distinct outer values
   *  (they need the outer rows, so they are prepared in a second pass that receives `envs`). */
  private async prepareSubs(exprs: (Expr | undefined)[], scope: Scope, envs: Env[] | null) {
    const subs: any[] = [];
    for (const ex of exprs) if (ex) walk(ex, (n) => { if (n.k === 'sub' || n.k === 'exists' || (n.k === 'in' && n.sub)) subs.push(n); });
    for (const n of subs) {
      if (n.prepared) continue;
      const q: Select = n.k === 'in' ? n.sub : n.q;
      if (n.correlated === undefined) n.correlated = await this.refsOuter(q);
      if (!n.correlated) {
        n.cache = (await this.execSelect(cloneSelect(q))).rows;
        n.prepared = true;
        continue;
      }
      if (!envs) continue; // handled in the second pass
      const refs: { up: number; si: number; key: string }[] = [];
      collectOuterRefs(q, scope, refs);
      const rowCache = new Map<string, any[][]>();
      n.rowCache = rowCache;
      n.perRow = (env: Env) => refs.map((r) => keyOf(env.rows[r.si]?.[r.key])).join('\u0001');
      for (const env of envs) {
        const k = n.perRow(env);
        if (rowCache.has(k)) continue;
        rowCache.set(k, (await this.execSelect(cloneSelect(q), scope, env)).rows);
      }
      n.prepared = true;
    }
  }

  private async refsOuter(q: Select): Promise<boolean> {
    try { await this.execSelectProbe(cloneSelect(q)); return false; } catch (e: any) { if (/Unknown column/.test(String(e?.message))) return true; throw e; }
  }
  private async execSelectProbe(q: Select) {
    // bind-only probe: build sources and bind everything with no parent scope
    const srcs: Src[] = [];
    if (q.from) { srcs.push(await this.makeSource(q.from)); for (const j of q.joins) srcs.push(await this.makeSource(j.src)); }
    const scope: Scope = { srcs };
    for (const it of q.items) if (!it.star) bind(it.e, scope);
    q.joins.forEach((j) => j.on && bind(j.on, scope));
    if (q.where) bind(q.where, scope);
    q.group.forEach((g) => bind(g, scope, { aliasFallback: q.items }));
    if (q.having) bind(q.having, scope, { aliasFallback: q.items });
    q.order.forEach((o) => bind(o.e, scope, { aliasFirst: q.items }));
  }

  /* ---------------------------------------------------------------- row loading & joins */
  private async buildEnvs(sel: Select, srcs: Src[], whereConj: Expr[], need: Set<string>[] | null, parentEnv?: Env): Promise<Env[]> {
    if (!sel.from) return [{ rows: [], parent: parentEnv }];
    const baseEnv: Env = parentEnv ?? { rows: [] };
    // per-source pushdown conditions (superset filters; the full predicates are re-applied in memory)
    const conds: Expr[][] = srcs.map(() => []);
    whereConj.forEach((c) => {
      const refs = srcRefs(c);
      if (!refs || refs.size !== 1) return;
      const si = [...refs][0];
      if (si === 0 || sel.joins[si - 1].type !== 'left') conds[si].push(c);
    });
    sel.joins.forEach((j, idx) => {
      const si = idx + 1;
      splitAnd(j.on).forEach((c) => { const refs = srcRefs(c); if (refs && refs.size === 1 && [...refs][0] === si) conds[si].push(c); });
    });

    const loadSrc = async (si: number, extra?: { filter: any; collate: boolean }): Promise<any[]> => {
      const s = srcs[si];
      if (s.rows) return s.rows;
      const { filter, collate } = this.pushFilter(s, si, conds[si], baseEnv);
      const parts = [filter, extra?.filter].filter((x) => x && Object.keys(x).length);
      const fil = parts.length === 0 ? {} : parts.length === 1 ? parts[0] : { $and: parts };
      const want = need && need[si] ? s.td!.cols.filter((c) => need[si].has(c.name)) : undefined;
      return this.fetch(s.td!, fil, want, collate || !!extra?.collate);
    };

    let combos: any[][];
    combos = (await loadSrc(0)).map((r) => [r]);

    for (let ji = 0; ji < sel.joins.length; ji++) {
      const j = sel.joins[ji];
      const si = ji + 1;
      const s = srcs[si];
      if (!combos.length && j.type !== 'cross') { combos = []; continue; }
      const onConj = splitAnd(j.on);
      // find an equi-join: right-col = f(left sources)
      let rightKeyExpr: Expr | null = null, leftKeyExpr: Expr | null = null;
      for (const c of onConj) {
        if (c.k === 'bin' && c.op === '=') {
          for (const [a, b] of [[c.l, c.r], [c.r, c.l]]) {
            const ra = srcRefs(a), rb = srcRefs(b);
            if (ra && rb && ra.size >= 1 && [...ra].every((x) => x === si) && [...rb].every((x) => x < si) && rb.size >= 1) { rightKeyExpr = a; leftKeyExpr = b; break; }
          }
        }
        if (rightKeyExpr) break;
      }
      let rightRows: any[];
      if (s.rows) rightRows = s.rows;
      else {
        let extra: { filter: any; collate: boolean } | undefined;
        if (rightKeyExpr && leftKeyExpr && rightKeyExpr.k === 'col' && s.td) {
          const cd = s.td.map.get(String(rightKeyExpr.key).toLowerCase());
          const keys = new Map<string, any>();
          let ok = !!cd;
          for (const combo of combos) {
            const v = ev(leftKeyExpr, { rows: combo, parent: parentEnv }, this.cx);
            if (v === null) continue;
            if (cd && cd.type === 'decimal') { ok = false; break; }
            if (cd && isIntType(cd.type)) {
              if (typeof v === 'number' || v instanceof Dec) keys.set('n' + toNum(v), toNum(v));
              else if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) keys.set('n' + Number(v), Number(v));
              else { ok = false; break; }
            } else if (cd && isStrCol(cd)) {
              if (typeof v === 'string' && !/\s$/.test(v)) keys.set('s' + v, v); else { ok = false; break; }
            } else { ok = false; break; }
          }
          if (ok && keys.size <= 20000) extra = { filter: { [rightKeyExpr.key]: { $in: [...keys.values()] } }, collate: !!cd && isStrCol(cd) };
        }
        rightRows = await loadSrc(si, extra);
      }
      // hash join
      let bucket: Map<string, any[]> | null = null;
      if (rightKeyExpr && leftKeyExpr) {
        bucket = new Map();
        for (const r of rightRows) {
          const env: Env = { rows: new Array(si + 1).fill(null), parent: parentEnv };
          env.rows[si] = r;
          const k = joinKey(ev(rightKeyExpr, env, this.cx));
          if (k === null) continue;
          const arr = bucket.get(k);
          if (arr) arr.push(r); else bucket.set(k, [r]);
        }
      }
      const out: any[][] = [];
      for (const combo of combos) {
        let cands: any[] = rightRows;
        if (bucket) {
          const k = joinKey(ev(leftKeyExpr!, { rows: combo, parent: parentEnv }, this.cx));
          cands = k === null ? [] : bucket.get(k) ?? [];
        }
        let matched = false;
        for (const r of cands) {
          const next = combo.concat([r]);
          if (j.on && truthy(ev(j.on, { rows: next, parent: parentEnv }, this.cx)) !== 1) continue;
          matched = true; out.push(next);
        }
        if (!matched && j.type === 'left') out.push(combo.concat([null]));
      }
      combos = out;
    }
    return combos.map((rows) => ({ rows, parent: parentEnv }));
  }

  /** Translate simple conjuncts on one table into a MongoDB filter (always a superset of what SQL would select). */
  private pushFilter(s: Src, si: number, conds: Expr[], baseEnv: Env): { filter: any; collate: boolean } {
    const parts: any[] = [];
    let collate = false;
    const td = s.td!;
    const constOf = (e: Expr): { ok: boolean; v?: any } => {
      const refs = srcRefsAny(e);
      if (refs) return { ok: false };
      try { return { ok: true, v: ev(e, baseEnv, this.cx) }; } catch { return { ok: false }; }
    };
    const colOf = (e: Expr): ColDef | null => {
      while (e.k === 'paren') e = e.e;
      if (e.k !== 'col' || e.aliasExpr || e.up !== 0 || e.si !== si) return null;
      return td.map.get(String(e.key).toLowerCase()) ?? null;
    };
    const val = (cd: ColDef, v: any, op: string): any | undefined => {
      if (v === null || v === undefined) return undefined;
      if (isIntType(cd.type) || cd.type === 'decimal') {
        let n: number | undefined;
        if (typeof v === 'number' || v instanceof Dec) n = toNum(v)!;
        else if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) n = Number(v);
        if (n === undefined) return undefined;
        // DECIMAL columns are stored as Decimal128; the double 9.3 is not equal to 9.30 there, so compare as decimals
        if (cd.type === 'decimal') return Decimal128.fromString(v instanceof Dec ? v.toString() : typeof v === 'string' ? v.trim() : String(n));
        return n;
      }
      if (isStrCol(cd)) {
        if (op !== '=' || typeof v !== 'string' || /\s$/.test(v)) return undefined;
        collate = true; return v;
      }
      if (cd.type === 'date') return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
      if (cd.type === 'datetime') return typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? v : undefined;
      return undefined;
    };
    const MOP: Record<string, string> = { '<': '$lt', '<=': '$lte', '>': '$gt', '>=': '$gte' };
    const FLIP: Record<string, string> = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '=': '=' };
    for (let c of conds) {
      while (c.k === 'paren') c = c.e;
      if (c.k === 'bin' && ['=', '<', '<=', '>', '>='].includes(c.op)) {
        let cd = colOf(c.l), k = constOf(c.r), op = c.op;
        if (!cd) { cd = colOf(c.r); k = constOf(c.l); op = FLIP[op]; }
        if (!cd || !k.ok) continue;
        const v = val(cd, k.v, op);
        if (v === undefined) continue;
        parts.push(op === '=' ? { [cd.name]: v } : { [cd.name]: { [MOP[op]]: v } });
      } else if (c.k === 'between' && !c.not) {
        const cd = colOf(c.e), lo = constOf(c.lo), hi = constOf(c.hi);
        if (!cd || !lo.ok || !hi.ok) continue;
        const a = val(cd, lo.v, '>='), b = val(cd, hi.v, '<=');
        if (a === undefined || b === undefined) continue;
        parts.push({ [cd.name]: { $gte: a, $lte: b } });
      } else if (c.k === 'in' && !c.not && c.list) {
        const cd = colOf(c.e);
        if (!cd) continue;
        const vals: any[] = [];
        let ok = true;
        for (const x of c.list) {
          const k = constOf(x);
          if (!k.ok) { ok = false; break; }
          const items = Array.isArray(k.v) ? k.v : [k.v];
          for (const it of items) { if (it === null) continue; const v = val(cd, it, '='); if (v === undefined) { ok = false; break; } vals.push(v); }
          if (!ok) break;
        }
        if (ok) parts.push({ [cd.name]: { $in: vals } });
      } else if (c.k === 'isnull') {
        const cd = colOf(c.e);
        if (cd && (c.not || !(!cd.nullable && (cd.type === "date" || cd.type === "datetime")))) parts.push(c.not ? { [cd.name]: { $ne: null } } : { [cd.name]: null });
      }
    }
    return { filter: parts.length ? (parts.length === 1 ? parts[0] : { $and: parts }) : {}, collate };
  }

  async fetch(td: TableDef, filter: any, want: ColDef[] | undefined, collate: boolean): Promise<any[]> {
    const db = await getDb();
    const proj = want ? Object.fromEntries([['_id', 1], ...want.map((c) => [c.name, 1])]) : undefined;
    const opts: any = { sort: { _id: 1 } };
    if (proj) opts.projection = proj;
    if (collate) opts.collation = { locale: 'en', strength: 1 };
    const docs = await db.collection(td.name).find(filter, opts).toArray();
    return docs.map((d) => decodeDoc(d, td, want));
  }

  /* ---------------------------------------------------------------- INSERT */
  private async execInsert(st: Extract<Stmt, { kind: 'insert' }>): Promise<WriteResult> {
    const td = await tableDef(st.table);
    const db = await getDb();
    const colNames = st.cols ?? td.cols.map((c) => c.name);
    const cds = colNames.map((n) => { const cd = td.map.get(n.toLowerCase()); if (!cd) throw new Error(`Unknown column '${n}' in 'field list'`); return cd; });
    let affected = 0, lastId = 0;
    for (const row of st.rows) {
      if (row.length !== cds.length) throw new Error("Column count doesn't match value count");
      const given = new Map<string, any>();
      const env: Env = { rows: [] };
      row.forEach((e, i) => { given.set(cds[i].name, coerceInput(ev(e, env, this.cx))); });
      const doc: Record<string, any> = {};
      for (const cd of td.cols) {
        if (given.has(cd.name)) {
          const raw = given.get(cd.name);
          if (cd.auto && (raw === null || raw === 0 || raw === undefined)) doc[cd.name] = null; // allocated below
          else doc[cd.name] = coerce(cd, raw, 'insert');
        } else doc[cd.name] = cd.auto ? null : defaultFor(cd);
      }
      const auto = td.cols.find((c) => c.auto);
      const pk = td.cols.find((c) => c.key === 'PRI' && c.type !== undefined);
      const tryInsert = async (): Promise<'inserted' | 'dup' | 'ignored'> => {
        if (auto) {
          if (doc[auto.name] === null) doc[auto.name] = await nextId(td.name);
          else await bumpCounter(td.name, doc[auto.name]);
        }
        const mdoc: any = { ...doc };
        mdoc._id = auto ? doc[auto.name] : (pk ? doc[pk.name] : undefined);
        if (mdoc._id === undefined) delete mdoc._id;
        try {
          await db.collection(td.name).insertOne(mdoc);
          lastId = auto ? doc[auto.name] : 0;
          const id = mdoc._id;
          this.tx?.undo.push(async () => { await db.collection(td.name).deleteOne({ _id: id }); });
          return 'inserted';
        } catch (e: any) {
          if (e?.code === 11000) return 'dup';
          throw e;
        }
      };
      // ON DUPLICATE KEY UPDATE / INSERT IGNORE need to know about an existing conflicting row first
      if (st.dup || st.ignore) {
        const existing = await this.findConflict(td, doc);
        if (existing) {
          if (st.ignore && !st.dup) continue;
          affected += await this.applyDup(td, st, existing, doc);
          lastId = existing._id;
          continue;
        }
      }
      const r = await tryInsert();
      if (r === 'inserted') affected += 1;
      else if (st.dup) { const existing = await this.findConflict(td, doc); if (existing) affected += await this.applyDup(td, st, existing, doc); }
      else if (st.ignore) continue;
      else throw new Error(`Duplicate entry for key in table '${td.name}'`);
    }
    return { affectedRows: affected, insertId: lastId };
  }

  private async findConflict(td: TableDef, doc: Record<string, any>): Promise<any | null> {
    const db = await getDb();
    const auto = td.cols.find((c) => c.auto);
    const keys: string[][] = [...td.unique];
    const ors: any[] = [];
    if (auto && doc[auto.name] !== null && doc[auto.name] !== undefined) ors.push({ _id: doc[auto.name] });
    for (const k of keys) {
      if (k.every((c) => doc[c] !== null && doc[c] !== undefined)) ors.push(Object.fromEntries(k.map((c) => [c, doc[c]])));
    }
    if (!ors.length) return null;
    return db.collection(td.name).findOne(ors.length === 1 ? ors[0] : { $or: ors });
  }

  private async applyDup(td: TableDef, st: Extract<Stmt, { kind: 'insert' }>, existing: any, newDoc: Record<string, any>): Promise<number> {
    const row = decodeDoc(existing, td);
    const sets = (st.dup ?? []).map((d) => ({ col: d.col, e: d.e }));
    const scope: Scope = { srcs: [{ ...mkSrcFromNames(td.name, td.cols.map((c) => c.name)), td }] };
    sets.forEach((s) => bind(s.e, scope));
    const env: Env = { rows: [row], values: Object.fromEntries(td.cols.map((c) => [c.name, newDoc[c.name] instanceof Decimal128 ? new Dec(parseFloat(newDoc[c.name].toString()), c.scale ?? 0) : newDoc[c.name]])) };
    const work = { ...row };
    const changes: Record<string, any> = {};
    for (const s of sets) {
      const cd = td.map.get(s.col.toLowerCase());
      if (!cd) throw new Error(`Unknown column '${s.col}' in 'field list'`);
      const nv = coerce(cd, coerceInput(ev(s.e, { ...env, rows: [work] }, this.cx)), 'update');
      work[cd.name] = nv instanceof Decimal128 ? new Dec(parseFloat(nv.toString()), cd.scale ?? 0) : nv;
      changes[cd.name] = nv;
    }
    const changed: Record<string, any> = {};
    const before: Record<string, any> = {};
    for (const [k, v] of Object.entries(changes)) {
      if (!sameStored(existing[k], v)) { changed[k] = v; before[k] = existing[k] === undefined ? null : existing[k]; }
    }
    if (!Object.keys(changed).length) return 0;
    const db = await getDb();
    await db.collection(td.name).updateOne({ _id: existing._id }, { $set: changed });
    this.tx?.undo.push(async () => { await db.collection(td.name).updateOne({ _id: existing._id }, { $set: before }); });
    return 2;
  }

  /* ---------------------------------------------------------------- UPDATE / DELETE */
  private async matchRows(from: SourceRef, joins: JoinRef[], where: Expr | undefined, order: { e: Expr; desc: boolean }[], limit: Expr | undefined, extraNeed?: (srcs: Src[]) => void) {
    const sel: Select = { kind: 'select', distinct: false, items: [], from, joins, where, group: [], order: [] };
    const srcs: Src[] = [await this.makeSource(from)];
    for (const j of joins) srcs.push(await this.makeSource(j.src));
    const scope: Scope = { srcs };
    joins.forEach((j) => j.on && bind(j.on, scope));
    if (where) bind(where, scope);
    order.forEach((o) => bind(o.e, scope));
    const conj = splitAnd(where);
    await this.prepareSubs([where, ...joins.map((j) => j.on)], scope, null);
    let envs = await this.buildEnvs(sel, srcs, conj, null, undefined);
    await this.prepareSubs([where], scope, envs);
    if (where) envs = envs.filter((env) => truthy(ev(where, env, this.cx)) === 1);
    if (order.length) {
      const keyed = envs.map((env) => ({ env, ks: order.map((o) => ev(o.e, env, this.cx)) }));
      keyed.sort((p, q) => { for (let i = 0; i < order.length; i++) { const c = sortCmp(p.ks[i], q.ks[i]); if (c) return order[i].desc ? -c : c; } return 0; });
      envs = keyed.map((k) => k.env);
    }
    if (limit) { const n = Math.trunc(toNum(ev(limit, { rows: [] }, this.cx)) ?? 0); envs = envs.slice(0, n); }
    return { srcs, scope, envs };
  }

  private async execUpdate(st: Extract<Stmt, { kind: 'update' }>): Promise<WriteResult> {
    const { srcs, scope, envs } = await this.matchRows(st.from, st.joins, st.where, st.order, st.limit);
    // resolve each SET target to a source
    const targets = st.sets.map((s) => {
      let si = -1;
      if (s.table) { si = srcs.findIndex((x) => x.alias.toLowerCase() === s.table!.toLowerCase()); if (si < 0) throw new Error(`Unknown table '${s.table}'`); }
      else {
        const hits = srcs.map((x, i) => (x.td && x.map.has(s.col.toLowerCase()) ? i : -1)).filter((i) => i >= 0);
        if (hits.length > 1) throw new Error(`Column '${s.col}' in field list is ambiguous`);
        si = hits[0] ?? -1;
      }
      if (si < 0 || !srcs[si].td) throw new Error(`Unknown column '${s.col}' in 'field list'`);
      const cd = srcs[si].td!.map.get(s.col.toLowerCase());
      if (!cd) throw new Error(`Unknown column '${s.col}' in 'field list'`);
      bind(s.e, scope);
      return { si, cd, e: s.e, constant: !srcRefsAny(s.e) ? true : false };
    });
    const db = await getDb();
    const done = new Set<string>();
    let matched = 0;
    for (const env of envs) {
      const touched = new Map<number, { work: any; changes: Record<string, any>; row: any }>();
      for (const t of targets) {
        const row = env.rows[t.si];
        if (!row) continue;
        let tt = touched.get(t.si);
        if (!tt) { tt = { work: { ...row }, changes: {}, row }; touched.set(t.si, tt); }
      }
      // evaluate against working copies so later assignments see earlier ones
      const wrows = env.rows.map((r, i) => touched.get(i)?.work ?? r);
      for (const t of targets) {
        const tt = touched.get(t.si);
        if (!tt) continue;
        const nv = coerce(t.cd, coerceInput(ev(t.e, { rows: wrows, parent: env.parent }, this.cx)), 'update');
        tt.work[t.cd.name] = nv instanceof Decimal128 ? new Dec(parseFloat(nv.toString()), t.cd.scale ?? 0) : nv;
        tt.changes[t.cd.name] = nv;
      }
      for (const [si, tt] of touched) {
        const td = srcs[si].td!;
        const key = td.name + ':' + tt.row._id;
        if (done.has(key)) continue;
        done.add(key);
        matched++;
        const changed: Record<string, any> = {}, before: Record<string, any> = {};
        // the loaded row is already decoded; compare against its stored form
        for (const [k, v] of Object.entries(tt.changes)) {
          const old = encodeStored(tt.row[k]);
          if (!sameStored(old, v)) { changed[k] = v; before[k] = old; }
        }
        if (!Object.keys(changed).length) continue;
        const dependent = targets.filter((t) => t.si === si && !t.constant);
        if (dependent.length) await this.updateGuarded(td, tt.row, changed, before, targets.filter((t) => t.si === si), env, srcs, si);
        else {
          await db.collection(td.name).updateOne({ _id: tt.row._id }, { $set: changed });
          this.tx?.undo.push(async () => { await db.collection(td.name).updateOne({ _id: tt.row._id }, { $set: before }); });
        }
      }
    }
    return { affectedRows: matched, insertId: 0 };
  }

  /** Read-modify-write with an optimistic guard (the MySQL statement `x = x + 1` is atomic; emulate by retrying on conflict). */
  private async updateGuarded(td: TableDef, row: any, changed: Record<string, any>, before: Record<string, any>, targets: any[], env: Env, srcs: Src[], si: number) {
    const db = await getDb();
    const colsRead = new Set<string>();
    for (const t of targets) walk(t.e, (n) => { if (n.k === 'col' && n.up === 0 && n.si === si) colsRead.add(n.key); });
    let curChanged = changed, curBefore = before, cur = row;
    for (let attempt = 0; attempt < 8; attempt++) {
      const guard: any = { _id: row._id };
      for (const c of colsRead) guard[c] = encodeStored(cur[c]);
      const r = await db.collection(td.name).updateOne(guard, { $set: curChanged });
      if (r.matchedCount) { const b = curBefore; this.tx?.undo.push(async () => { await db.collection(td.name).updateOne({ _id: row._id }, { $set: b }); }); return; }
      // someone else changed the row: reload it and recompute the assignments
      const fresh = await db.collection(td.name).findOne({ _id: row._id });
      if (!fresh) return;
      cur = decodeDoc(fresh, td);
      const rows = env.rows.slice(); rows[si] = { ...cur };
      const work = rows[si];
      curChanged = {}; curBefore = {};
      for (const t of targets) {
        const nv = coerce(t.cd, coerceInput(ev(t.e, { rows: rows.map((x, i) => (i === si ? work : x)), parent: env.parent }, this.cx)), 'update');
        work[t.cd.name] = nv instanceof Decimal128 ? new Dec(parseFloat(nv.toString()), t.cd.scale ?? 0) : nv;
        const old = encodeStored(cur[t.cd.name]);
        if (!sameStored(old, nv)) { curChanged[t.cd.name] = nv; curBefore[t.cd.name] = old; }
      }
      if (!Object.keys(curChanged).length) return;
    }
    throw new Error('Could not update the record because it is being changed by someone else. Please try again.');
  }

  private async execDelete(st: Extract<Stmt, { kind: 'delete' }>): Promise<WriteResult> {
    const { srcs, envs } = await this.matchRows({ table: st.table, alias: st.table }, [], st.where, st.order, st.limit);
    const td = srcs[0].td!;
    const ids = envs.map((e) => e.rows[0]._id);
    if (!ids.length) return { affectedRows: 0, insertId: 0 };
    const db = await getDb();
    const docs = this.tx ? await db.collection(td.name).find({ _id: { $in: ids } }).toArray() : [];
    const r = await db.collection(td.name).deleteMany({ _id: { $in: ids } });
    if (this.tx) this.tx.undo.push(async () => { if (docs.length) await db.collection(td.name).insertMany(docs as any[]); });
    return { affectedRows: r.deletedCount, insertId: 0 };
  }

  /* ---------------------------------------------------------------- SHOW COLUMNS */
  private async execShowCols(st: Extract<Stmt, { kind: 'showcols' }>): Promise<any[]> {
    const td = await tableDef(st.table);
    const rows = td.cols.map((c) => ({
      Field: c.name,
      Type: c.full,
      Null: c.nullable ? 'YES' : 'NO',
      Key: c.key,
      Default: c.def,
      Extra: c.auto ? 'auto_increment' : c.defGenerated ? 'DEFAULT_GENERATED' : '',
    }));
    return st.like ? rows.filter((r) => likeMatch(r.Field, st.like) === 1) : rows;
  }
}

/* ---------------------------------------------------------------- helpers */
const isIntType = (t: string) => ['int', 'tinyint', 'smallint', 'mediumint', 'bigint', 'year'].includes(t);
const isStrCol = (c: ColDef) => ['varchar', 'char', 'text', 'tinytext', 'mediumtext', 'longtext'].includes(c.type);

function srcRefsAny(e: Expr): boolean {
  let any = false;
  walk(e, (n) => { if (n.k === 'col' || n.k === 'sub' || n.k === 'exists' || (n.k === 'in' && n.sub) || (n.k === 'fn' && (n.agg || n.name === 'VALUES'))) any = true; });
  return any;
}

function colName(it: SelectItem): string { return it.alias ?? (it.e?.k === 'col' ? it.e.name : it.text); }

function resolveOrdinal(e: Expr, items: SelectItem[]): Expr {
  if (e.k === 'lit' && typeof e.v === 'number' && Number.isInteger(e.v)) {
    const it = items[e.v - 1];
    if (!it) throw new Error(`Unknown column '${e.v}' in 'order clause'`);
    return it.e;
  }
  return e;
}

function neededColumns(srcs: Src[], exprs: (Expr | undefined)[]): Set<string>[] {
  const sets = srcs.map(() => new Set<string>());
  for (const e of exprs) if (e) walk(e, (n) => {
    if (n.k === 'col' && n.bound && !n.aliasExpr && n.up === 0) sets[n.si].add(n.key);
    if (n.k === 'col' && n.aliasExpr) walk(n.aliasExpr, (m) => { if (m.k === 'col' && m.bound && !m.aliasExpr && m.up === 0) sets[m.si].add(m.key); });
  });
  return sets;
}

function collectOuterRefs(q: Select, scope: Scope, out: { up: number; si: number; key: string }[]) {
  const seen = new Set<string>();
  const visit = (e: Expr | undefined) => { if (!e) return; walk(e, (n) => {
    if (n.k !== 'col') return;
    // an unqualified/qualified name that resolves in the outer scope
    try {
      const r = resolveCol(scope, n.table, n.name);
      if (r.up === 0) { const k = r.si + ':' + r.key; if (!seen.has(k)) { seen.add(k); out.push(r); } }
    } catch { /* belongs to the sub-select itself */ }
  }); };
  [q.where, q.having, ...q.items.map((i) => i.e), ...q.order.map((o) => o.e), ...q.group, ...q.joins.map((j) => j.on)].forEach(visit);
}

function cloneSelect(q: Select): Select {
  // expressions are bound in place, so each execution needs a fresh tree
  return JSON.parse(JSON.stringify(q, (_k, v) => (v instanceof Dec ? { __dec: v.v, s: v.s } : v)), (_k, v) => (v && typeof v === 'object' && '__dec' in v ? new Dec(v.__dec, v.s) : v));
}

function normParam(p: any): any {
  if (p === undefined) return null;
  if (typeof p === 'boolean') return p ? 1 : 0;
  if (p instanceof Date) return fmtDateTime(new Date(p.getTime() + 5.5 * 3600e3));
  if (typeof p === 'bigint') return Number(p);
  return p;
}
function coerceInput(v: any) { return Array.isArray(v) ? (() => { throw new Error('Cannot use a list here'); })() : v; }

function encodeStored(v: any): any {
  if (v instanceof Dec) return Decimal128.fromString(v.toString());
  return v === undefined ? null : v;
}
function sameStored(a: any, b: any): boolean {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  if (a === null || b === null) return a === b;
  if (a instanceof Decimal128 || b instanceof Decimal128) return String(a) === String(b) || parseFloat(String(a)) === parseFloat(String(b));
  if (Buffer.isBuffer(a) || Buffer.isBuffer(b)) return String(a) === String(b);
  return a === b;
}

export { toStr, istNow, cmp, getCatalog };
