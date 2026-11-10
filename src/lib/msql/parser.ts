import { Dec } from './value';

/* ---------------------------------------------------------------- tokens */
export interface Tok { t: 'word' | 'qid' | 'str' | 'num' | 'op' | 'param' | 'eof'; v: string; u: string; s: number; e: number }

export function tokenize(sql: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && sql[i + 1] === '-' && /\s/.test(sql[i + 2] ?? ' ')) { while (i < n && sql[i] !== '\n') i++; continue; }
    if (c === '#') { while (i < n && sql[i] !== '\n') i++; continue; }
    if (c === '/' && sql[i + 1] === '*') { const j = sql.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; continue; }
    const s = i;
    if (c === '`') {
      let j = i + 1, v = '';
      while (j < n) { if (sql[j] === '`') { if (sql[j + 1] === '`') { v += '`'; j += 2; continue; } break; } v += sql[j++]; }
      out.push({ t: 'qid', v, u: v.toUpperCase(), s, e: j + 1 }); i = j + 1; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1, v = '';
      while (j < n) {
        const d = sql[j];
        if (d === '\\' && j + 1 < n) {
          const x = sql[j + 1];
          const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', b: '\b', Z: '\x1a' };
          if (x === '%' || x === '_') v += '\\' + x; else v += map[x] ?? x;
          j += 2; continue;
        }
        if (d === c) { if (sql[j + 1] === c) { v += c; j += 2; continue; } break; }
        v += d; j++;
      }
      out.push({ t: 'str', v, u: v, s, e: j + 1 }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] ?? ''))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(sql.slice(i))!;
      out.push({ t: 'num', v: m[0], u: m[0], s, e: i + m[0].length }); i += m[0].length; continue;
    }
    if (/[A-Za-z_$\u0080-￿]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$\u0080-￿]/.test(sql[j])) j++;
      const v = sql.slice(i, j);
      out.push({ t: 'word', v, u: v.toUpperCase(), s, e: j }); i = j; continue;
    }
    if (c === '?') { out.push({ t: 'param', v: '?', u: '?', s, e: i + 1 }); i++; continue; }
    const two = sql.slice(i, i + 3) === '<=>' ? '<=>' : sql.slice(i, i + 2);
    if (['<=>', '<=', '>=', '<>', '!=', '||', '&&', '<<', '>>', ':='].includes(two)) { out.push({ t: 'op', v: two, u: two, s, e: i + two.length }); i += two.length; continue; }
    if ('=<>+-*/%(),.;!&|^~'.includes(c)) { out.push({ t: 'op', v: c, u: c, s, e: i + 1 }); i++; continue; }
    throw new Error(`SQL syntax: unexpected character '${c}' at ${i}`);
  }
  out.push({ t: 'eof', v: '', u: '', s: n, e: n });
  return out;
}

/* ---------------------------------------------------------------- AST (loosely typed on purpose) */
export type Expr = any;
export interface SelectItem { e: Expr; alias?: string; text: string; star?: boolean; starTable?: string }
export interface SourceRef { table?: string; sub?: Select; alias: string }
export interface JoinRef { type: 'inner' | 'left' | 'cross'; src: SourceRef; on?: Expr }
export interface Select {
  kind: 'select';
  distinct: boolean;
  items: SelectItem[];
  from?: SourceRef;
  joins: JoinRef[];
  where?: Expr;
  group: Expr[];
  having?: Expr;
  order: { e: Expr; desc: boolean }[];
  limit?: { offset: Expr | null; count: Expr };
  unions?: { all: boolean; sel: Select }[];
}
export type Stmt =
  | Select
  | { kind: 'insert'; table: string; cols: string[] | null; rows: Expr[][]; dup?: { col: string; e: Expr }[]; ignore: boolean }
  | { kind: 'update'; from: SourceRef; joins: JoinRef[]; sets: { table?: string; col: string; e: Expr }[]; where?: Expr; order: { e: Expr; desc: boolean }[]; limit?: Expr }
  | { kind: 'delete'; table: string; where?: Expr; order: { e: Expr; desc: boolean }[]; limit?: Expr }
  | { kind: 'showcols'; table: string; like?: string }
  | { kind: 'noop' };

const RESERVED = new Set(['FROM', 'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'HAVING', 'UNION', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'CROSS', 'NATURAL', 'ON', 'USING', 'SET', 'VALUES', 'SELECT', 'AND', 'OR', 'NOT', 'AS', 'FOR', 'INTO', 'STRAIGHT_JOIN', 'OUTER', 'LOCK']);
const AGGS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'GROUP_CONCAT']);

class P {
  toks: Tok[];
  p = 0;
  pi = 0; // placeholder counter
  constructor(public sql: string) { this.toks = tokenize(sql); }
  get cur() { return this.toks[this.p]; }
  peek(k = 0) { return this.toks[Math.min(this.p + k, this.toks.length - 1)]; }
  isWord(...ws: string[]) { const t = this.cur; return t.t === 'word' && ws.includes(t.u); }
  isOp(...os: string[]) { const t = this.cur; return t.t === 'op' && os.includes(t.v); }
  acceptWord(...ws: string[]) { if (this.isWord(...ws)) { this.p++; return true; } return false; }
  acceptOp(...os: string[]) { if (this.isOp(...os)) { this.p++; return true; } return false; }
  err(msg: string): never { throw new Error(`SQL syntax: ${msg} near '${this.sql.slice(this.cur.s, this.cur.s + 40)}'`); }
  expectWord(w: string) { if (!this.acceptWord(w)) this.err(`expected ${w}`); }
  expectOp(o: string) { if (!this.acceptOp(o)) this.err(`expected ${o}`); }
  ident(): string {
    const t = this.cur;
    if (t.t === 'word' || t.t === 'qid') { this.p++; return t.v; }
    this.err('expected identifier');
  }

  /* ---- statements ---- */
  statement(): Stmt {
    let st: Stmt;
    if (this.isWord('SELECT') || this.isOp('(')) st = this.selectUnion();
    else if (this.acceptWord('INSERT')) st = this.insert();
    else if (this.acceptWord('UPDATE')) st = this.update();
    else if (this.acceptWord('DELETE')) st = this.del();
    else if (this.acceptWord('SHOW')) st = this.show();
    else if (this.isWord('SET', 'CREATE', 'ALTER', 'DROP')) { this.p = this.toks.length - 1; st = { kind: 'noop' }; }
    else this.err('unsupported statement');
    this.acceptOp(';');
    if (this.cur.t !== 'eof') this.err('unexpected trailing input');
    return st;
  }

  selectUnion(): Select {
    let first: Select;
    if (this.acceptOp('(')) { first = this.selectUnion(); this.expectOp(')'); } else first = this.select();
    while (this.isWord('UNION')) {
      this.p++;
      const all = this.acceptWord('ALL'); if (!all) this.acceptWord('DISTINCT');
      let nxt: Select;
      if (this.acceptOp('(')) { nxt = this.selectUnion(); this.expectOp(')'); } else nxt = this.select();
      (first.unions ??= []).push({ all, sel: nxt });
    }
    // trailing ORDER BY / LIMIT after a union applies to the whole union
    if (first.unions) {
      if (this.isWord('ORDER')) first.order = this.orderBy();
      if (this.isWord('LIMIT')) first.limit = this.limit();
    }
    return first;
  }

  select(): Select {
    this.expectWord('SELECT');
    const sel: Select = { kind: 'select', distinct: false, items: [], joins: [], group: [], order: [] };
    if (this.acceptWord('DISTINCT')) sel.distinct = true; else this.acceptWord('ALL');
    do {
      sel.items.push(this.selectItem());
    } while (this.acceptOp(','));
    if (this.acceptWord('FROM')) {
      sel.from = this.sourceRef();
      for (;;) {
        if (this.acceptOp(',')) { sel.joins.push({ type: 'cross', src: this.sourceRef() }); continue; }
        let type: 'inner' | 'left' | 'cross' | null = null;
        if (this.isWord('JOIN')) { this.p++; type = 'inner'; }
        else if (this.isWord('INNER')) { this.p++; this.expectWord('JOIN'); type = 'inner'; }
        else if (this.isWord('CROSS')) { this.p++; this.expectWord('JOIN'); type = 'cross'; }
        else if (this.isWord('LEFT')) { this.p++; this.acceptWord('OUTER'); this.expectWord('JOIN'); type = 'left'; }
        else if (this.isWord('RIGHT')) this.err('RIGHT JOIN is not supported');
        else break;
        const src = this.sourceRef();
        let on: Expr;
        if (this.acceptWord('ON')) on = this.expr();
        else if (type !== 'cross') this.err('JOIN without ON is not supported');
        sel.joins.push({ type, src, on });
      }
    }
    if (this.acceptWord('WHERE')) sel.where = this.expr();
    if (this.isWord('GROUP')) { this.p++; this.expectWord('BY'); do { sel.group.push(this.expr()); } while (this.acceptOp(',')); }
    if (this.acceptWord('HAVING')) sel.having = this.expr();
    if (this.isWord('ORDER')) sel.order = this.orderBy();
    if (this.isWord('LIMIT')) sel.limit = this.limit();
    if (this.isWord('FOR')) this.err('FOR UPDATE / locking reads are not supported');
    return sel;
  }

  orderBy() {
    this.expectWord('ORDER'); this.expectWord('BY');
    const out: { e: Expr; desc: boolean }[] = [];
    do {
      const e = this.expr();
      let desc = false;
      if (this.acceptWord('DESC')) desc = true; else this.acceptWord('ASC');
      out.push({ e, desc });
    } while (this.acceptOp(','));
    return out;
  }

  limit() {
    this.expectWord('LIMIT');
    const a = this.expr();
    if (this.acceptOp(',')) { const b = this.expr(); return { offset: a, count: b }; }
    if (this.acceptWord('OFFSET')) { const b = this.expr(); return { offset: b, count: a }; }
    return { offset: null, count: a };
  }

  selectItem(): SelectItem {
    const startTok = this.cur;
    if (this.isOp('*')) { this.p++; return { e: null, text: '*', star: true }; }
    if ((this.cur.t === 'word' || this.cur.t === 'qid') && this.peek(1).v === '.' && this.peek(2).v === '*' && this.peek(1).t === 'op') {
      const tbl = this.cur.v; this.p += 3; return { e: null, text: tbl + '.*', star: true, starTable: tbl };
    }
    const e = this.expr();
    const endTok = this.toks[this.p - 1];
    const text = this.sql.slice(startTok.s, endTok.e);
    let alias: string | undefined;
    if (this.acceptWord('AS')) {
      const t = this.cur;
      if (t.t === 'str' || t.t === 'word' || t.t === 'qid') { alias = t.v; this.p++; } else this.err('expected alias');
    } else {
      const t = this.cur;
      if (t.t === 'qid' || t.t === 'str' || (t.t === 'word' && !RESERVED.has(t.u))) { alias = t.v; this.p++; }
    }
    return { e, alias, text };
  }

  sourceRef(): SourceRef {
    if (this.acceptOp('(')) {
      const sub = this.selectUnion();
      this.expectOp(')');
      this.acceptWord('AS');
      const alias = this.ident();
      return { sub, alias };
    }
    const table = this.ident();
    let alias = table;
    if (this.acceptWord('AS')) alias = this.ident();
    else if ((this.cur.t === 'word' && !RESERVED.has(this.cur.u)) || this.cur.t === 'qid') alias = this.ident();
    return { table, alias };
  }

  insert(): Stmt {
    const ignore = this.acceptWord('IGNORE');
    this.expectWord('INTO');
    const table = this.ident();
    let cols: string[] | null = null;
    if (this.acceptOp('(')) { cols = []; do { cols.push(this.ident()); } while (this.acceptOp(',')); this.expectOp(')'); }
    if (this.isWord('SELECT')) this.err('INSERT ... SELECT is not supported');
    if (!this.acceptWord('VALUES') && !this.acceptWord('VALUE')) this.err('expected VALUES');
    const rows: Expr[][] = [];
    do {
      this.expectOp('(');
      const r: Expr[] = [];
      if (!this.isOp(')')) do { r.push(this.expr()); } while (this.acceptOp(','));
      this.expectOp(')');
      rows.push(r);
    } while (this.acceptOp(','));
    let dup: { col: string; e: Expr }[] | undefined;
    if (this.isWord('ON')) {
      this.p++; this.expectWord('DUPLICATE'); this.expectWord('KEY'); this.expectWord('UPDATE');
      dup = [];
      do { const col = this.colName(); this.expectOp('='); dup.push({ col, e: this.expr() }); } while (this.acceptOp(','));
    }
    return { kind: 'insert', table, cols, rows, dup, ignore };
  }

  colName(): string {
    let c = this.ident();
    if (this.acceptOp('.')) c = this.ident();
    return c;
  }

  update(): Stmt {
    const from = this.sourceRef();
    const joins: JoinRef[] = [];
    for (;;) {
      let type: 'inner' | 'left' | null = null;
      if (this.isWord('JOIN')) { this.p++; type = 'inner'; }
      else if (this.isWord('INNER')) { this.p++; this.expectWord('JOIN'); type = 'inner'; }
      else if (this.isWord('LEFT')) { this.p++; this.acceptWord('OUTER'); this.expectWord('JOIN'); type = 'left'; }
      else break;
      const src = this.sourceRef(); this.expectWord('ON');
      joins.push({ type, src, on: this.expr() });
    }
    this.expectWord('SET');
    const sets: { table?: string; col: string; e: Expr }[] = [];
    do {
      let table: string | undefined;
      let col = this.ident();
      if (this.acceptOp('.')) { table = col; col = this.ident(); }
      this.expectOp('=');
      sets.push({ table, col, e: this.expr() });
    } while (this.acceptOp(','));
    let where: Expr, order: { e: Expr; desc: boolean }[] = [], limit: Expr;
    if (this.acceptWord('WHERE')) where = this.expr();
    if (this.isWord('ORDER')) order = this.orderBy();
    if (this.acceptWord('LIMIT')) limit = this.expr();
    return { kind: 'update', from, joins, sets, where, order, limit };
  }

  del(): Stmt {
    this.expectWord('FROM');
    const table = this.ident();
    let where: Expr, order: { e: Expr; desc: boolean }[] = [], limit: Expr;
    if (this.acceptWord('WHERE')) where = this.expr();
    if (this.isWord('ORDER')) order = this.orderBy();
    if (this.acceptWord('LIMIT')) limit = this.expr();
    return { kind: 'delete', table, where, order, limit };
  }

  show(): Stmt {
    this.acceptWord('FULL');
    if (!this.acceptWord('COLUMNS') && !this.acceptWord('FIELDS')) this.err('only SHOW COLUMNS is supported');
    if (!this.acceptWord('FROM') && !this.acceptWord('IN')) this.err('expected FROM');
    const table = this.ident();
    let like: string | undefined;
    if (this.acceptWord('LIKE')) { const t = this.cur; if (t.t !== 'str') this.err('expected string'); like = t.v; this.p++; }
    return { kind: 'showcols', table, like };
  }

  /* ---- expressions ---- */
  expr(): Expr { return this.or(); }
  or(): Expr {
    let l = this.xor();
    while (this.isWord('OR') || this.isOp('||')) { this.p++; l = { k: 'bin', op: 'OR', l, r: this.xor() }; }
    return l;
  }
  xor(): Expr {
    let l = this.and();
    while (this.isWord('XOR')) { this.p++; l = { k: 'bin', op: 'XOR', l, r: this.and() }; }
    return l;
  }
  and(): Expr {
    let l = this.not();
    while (this.isWord('AND') || this.isOp('&&')) { this.p++; l = { k: 'bin', op: 'AND', l, r: this.not() }; }
    return l;
  }
  not(): Expr {
    if (this.isWord('NOT') && !(this.peek(1).t === 'word' && this.peek(1).u === 'EXISTS')) { this.p++; return { k: 'un', op: 'NOT', e: this.not() }; }
    if (this.isOp('!')) { this.p++; return { k: 'un', op: 'NOT', e: this.not() }; }
    return this.predicate();
  }
  predicate(): Expr {
    let l = this.add();
    for (;;) {
      const t = this.cur;
      if (t.t === 'op' && ['=', '<', '>', '<=', '>=', '<>', '!=', '<=>'].includes(t.v)) {
        this.p++;
        // ANY/ALL/SOME subqueries are not supported
        l = { k: 'bin', op: t.v === '<>' ? '!=' : t.v, l, r: this.add() };
        continue;
      }
      if (this.isWord('IS')) {
        this.p++;
        const not = this.acceptWord('NOT');
        if (this.acceptWord('NULL')) { l = { k: 'isnull', e: l, not }; continue; }
        if (this.acceptWord('TRUE')) { l = { k: 'istrue', e: l, not, val: 1 }; continue; }
        if (this.acceptWord('FALSE')) { l = { k: 'istrue', e: l, not, val: 0 }; continue; }
        this.err('unsupported IS');
      }
      let not = false;
      const save = this.p;
      if (this.isWord('NOT')) { this.p++; not = true; }
      if (this.isWord('LIKE')) {
        this.p++;
        const pat = this.add();
        let esc: string | undefined;
        if (this.acceptWord('ESCAPE')) { const s = this.cur; if (s.t !== 'str') this.err('expected string'); esc = s.v; this.p++; }
        l = { k: 'like', e: l, pat, not, esc }; continue;
      }
      if (this.isWord('REGEXP', 'RLIKE')) { this.p++; l = { k: 'regexp', e: l, pat: this.add(), not }; continue; }
      if (this.isWord('IN')) {
        this.p++; this.expectOp('(');
        if (this.isWord('SELECT')) { const q = this.selectUnion(); this.expectOp(')'); l = { k: 'in', e: l, sub: q, not }; continue; }
        const list: Expr[] = [];
        do { list.push(this.expr()); } while (this.acceptOp(','));
        this.expectOp(')');
        l = { k: 'in', e: l, list, not }; continue;
      }
      if (this.isWord('BETWEEN')) {
        this.p++;
        const lo = this.add(); this.expectWord('AND'); const hi = this.add();
        l = { k: 'between', e: l, lo, hi, not }; continue;
      }
      if (not) this.p = save;
      break;
    }
    return l;
  }
  add(): Expr {
    let l = this.mul();
    while (this.isOp('+', '-')) { const op = this.cur.v; this.p++; l = { k: 'bin', op, l, r: this.mul() }; }
    return l;
  }
  mul(): Expr {
    let l = this.unary();
    for (;;) {
      if (this.isOp('*', '/', '%')) { const op = this.cur.v; this.p++; l = { k: 'bin', op, l, r: this.unary() }; }
      else if (this.isWord('DIV', 'MOD')) { const op = this.cur.u; this.p++; l = { k: 'bin', op, l, r: this.unary() }; }
      else break;
    }
    return l;
  }
  unary(): Expr {
    if (this.isOp('-')) { this.p++; const e = this.unary(); if (e.k === 'lit' && typeof e.v === 'number') return { k: 'lit', v: -e.v }; if (e.k === 'lit' && e.v instanceof Dec) return { k: 'lit', v: new Dec(-e.v.v, e.v.s) }; return { k: 'un', op: '-', e }; }
    if (this.isOp('+')) { this.p++; return this.unary(); }
    return this.primary();
  }

  primary(): Expr {
    const t = this.cur;
    if (t.t === 'num') {
      this.p++;
      if (/[eE]/.test(t.v)) return { k: 'lit', v: parseFloat(t.v) };
      if (t.v.includes('.')) return { k: 'lit', v: new Dec(parseFloat(t.v), t.v.split('.')[1].length) };
      return { k: 'lit', v: parseInt(t.v, 10) };
    }
    if (t.t === 'str') {
      this.p++;
      let v = t.v;
      while (this.cur.t === 'str') { v += this.cur.v; this.p++; }
      return { k: 'lit', v };
    }
    if (t.t === 'param') { this.p++; return { k: 'param', i: this.pi++ }; }
    if (t.t === 'op' && t.v === '(') {
      this.p++;
      if (this.isWord('SELECT')) { const q = this.selectUnion(); this.expectOp(')'); return { k: 'sub', q }; }
      const e = this.expr();
      if (this.isOp(',')) this.err('row constructors are not supported');
      this.expectOp(')');
      return { k: 'paren', e };
    }
    if (t.t === 'word') {
      const u = t.u;
      if (u === 'NULL') { this.p++; return { k: 'lit', v: null }; }
      if (u === 'TRUE') { this.p++; return { k: 'lit', v: 1 }; }
      if (u === 'FALSE') { this.p++; return { k: 'lit', v: 0 }; }
      if (u === 'CASE') return this.caseExpr();
      if (u === 'EXISTS' || (u === 'NOT' && this.peek(1).u === 'EXISTS')) {
        let not = false;
        if (u === 'NOT') { this.p++; not = true; }
        this.p++; this.expectOp('(');
        const q = this.selectUnion(); this.expectOp(')');
        return { k: 'exists', q, not };
      }
      if (u === 'INTERVAL') {
        this.p++;
        const e = this.add();
        const unit = this.ident().toUpperCase();
        return { k: 'interval', e, unit };
      }
      if (u === 'CAST' && this.peek(1).v === '(') {
        this.p += 2;
        const e = this.expr(); this.expectWord('AS');
        let type = this.ident().toUpperCase();
        if (type === 'SIGNED' || type === 'UNSIGNED') this.acceptWord('INTEGER');
        if (this.acceptOp('(')) { while (!this.acceptOp(')')) this.p++; }
        this.expectOp(')');
        return { k: 'cast', e, type };
      }
      if ((u === 'CURRENT_DATE' || u === 'CURRENT_TIMESTAMP' || u === 'CURRENT_TIME' || u === 'LOCALTIME' || u === 'LOCALTIMESTAMP') && this.peek(1).v !== '(') {
        this.p++; return { k: 'fn', name: u, args: [] };
      }
    }
    if (t.t === 'word' || t.t === 'qid') {
      // function call
      if (t.t === 'word' && this.peek(1).t === 'op' && this.peek(1).v === '(') return this.funcCall();
      // column reference
      this.p++;
      if (this.isOp('.') && (this.peek(1).t === 'word' || this.peek(1).t === 'qid')) {
        this.p++;
        const c = this.cur; this.p++;
        return { k: 'col', table: t.v, name: c.v };
      }
      return { k: 'col', name: t.v };
    }
    this.err('unexpected token');
  }

  caseExpr(): Expr {
    this.expectWord('CASE');
    let operand: Expr;
    if (!this.isWord('WHEN')) operand = this.expr();
    const whens: [Expr, Expr][] = [];
    while (this.acceptWord('WHEN')) { const c = this.expr(); this.expectWord('THEN'); whens.push([c, this.expr()]); }
    let els: Expr;
    if (this.acceptWord('ELSE')) els = this.expr();
    this.expectWord('END');
    return { k: 'case', operand, whens, els };
  }

  funcCall(): Expr {
    const name = this.cur.u;
    this.p += 2; // name (
    const node: any = { k: 'fn', name, args: [] as Expr[] };
    if (AGGS.has(name)) {
      node.agg = true;
      if (this.acceptWord('DISTINCT')) node.distinct = true;
      if (name === 'COUNT' && this.isOp('*')) { this.p++; node.star = true; }
      else if (!this.isOp(')')) {
        do { node.args.push(this.expr()); } while (name !== 'GROUP_CONCAT' && this.acceptOp(','));
        if (name === 'GROUP_CONCAT') {
          while (this.acceptOp(',')) node.args.push(this.expr());
          if (this.isWord('ORDER')) node.order = this.orderBy();
          if (this.acceptWord('SEPARATOR')) { const s = this.cur; if (s.t !== 'str') this.err('expected string'); node.sep = s.v; this.p++; }
        }
      }
      this.expectOp(')');
      return node;
    }
    if (!this.isOp(')')) do { node.args.push(this.expr()); } while (this.acceptOp(','));
    this.expectOp(')');
    return node;
  }
}

export function parseSql(sql: string): { stmt: Stmt; nparams: number } {
  const p = new P(sql);
  const stmt = p.statement();
  return { stmt, nparams: p.pi };
}
