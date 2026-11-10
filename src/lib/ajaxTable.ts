import { deleteFolderFiles, putFile } from './storage';
import { Ctx } from './ctx';
import { hasAccess } from './functions';
import { STORAGE_DIR } from './functions';
import { date, strtotime } from './php';

export interface AjaxCol {
  name: string;
  filter_name: string;
  select_name?: string;
  sort_name?: string;
  type?: 'date' | 'datetime';
  /** map of lower-case search term -> SQL fragment (appended after the column), e.g. { active: '= 2' } */
  filter_map?: Record<string, string>;
}

const OPS = new Set(['=', '!=', '<>', '<', '>', '<=', '>=']);

/**
 * Parameterised port of prepareAjaxTable(): runs the count + data queries for a gs-datatable request.
 * Column/table names come from trusted config; all user-supplied terms are bound as parameters.
 */
export async function ajaxTable(ctx: Ctx, opts: { columns: AjaxCol[]; primaryTable: string; joins: string; perm: string; exportAll?: boolean }) {
  const { db } = ctx;
  const state = JSON.parse(ctx.post.gs_table_request);
  const { columns, primaryTable: T } = opts;
  const rows: any = hasAccess(ctx, 'rows', opts.perm);
  const isScoped = rows !== true && rows !== false;

  let from = `FROM ${T} `;
  if (isScoped && rows[0] === '*') from = `FROM (SELECT * FROM ${T} ORDER BY id DESC LIMIT ${Number(rows[1]) || 0}) ${T} `;
  from += opts.joins;

  const params: any[] = [];
  let where = '';
  let conn = /\bWHERE\b/i.test(opts.joins) ? ' AND ' : ' WHERE ';
  if (isScoped && rows[0] !== '*') {
    where += `${conn}${T}.id >= ?`; params.push(Number(rows[0]) || 0); conn = ' AND ';
    if (rows[1] !== '*') { where += ` AND ${T}.id <= ?`; params.push(Number(rows[1]) || 0); }
  }
  const baseWhere = where, baseParams = [...params];
  let hasFilters = false;

  for (const f of state.filters ?? []) {
    const col = columns[f.column];
    if (!col) continue;
    hasFilters = true;
    const term = String(f.term ?? '');
    if (col.filter_map && col.filter_map[term.toLowerCase()]) { where += `${conn}${col.filter_name} ${col.filter_map[term.toLowerCase()]} `; conn = ' AND '; continue; }
    const op = OPS.has(f.comparison) ? f.comparison : '=';
    if (col.type === 'datetime' && term.includes(':')) { where += `${conn}${col.filter_name} ${op} ?`; params.push(date('Y-m-d H:i:s', strtotime(term) as number)); }
    else if (col.type === 'date' || col.type === 'datetime') {
      if (term.includes(' - ')) { const [a, b] = term.split(' - '); where += `${conn}DATE(${col.filter_name}) >= ? AND DATE(${col.filter_name}) <= ?`; params.push(date('Y-m-d', strtotime(a) as number), date('Y-m-d', strtotime(b) as number)); }
      else { where += `${conn}DATE(${col.filter_name}) ${op} ?`; params.push(date('Y-m-d', strtotime(term) as number)); }
    } else if (f.comparison === '~') { where += `${conn}${col.filter_name} LIKE ?`; params.push(`%${term}%`); }
    else { where += `${conn}${col.filter_name} ${op} ?`; params.push(term); }
    conn = ' AND ';
  }
  if (state.search) {
    hasFilters = true;
    const q = String(state.search);
    const parts: string[] = [];
    for (const c of columns) {
      if (c.filter_map && c.filter_map[q.toLowerCase()]) { parts.push(`${c.filter_name} ${c.filter_map[q.toLowerCase()]}`); continue; }
      parts.push(`${c.filter_name} LIKE ?`); params.push(`%${q}%`);
    }
    where += `${conn} (${parts.join(' OR ')})`;
  }

  const total: any = await db.selectOne(`SELECT COUNT(${T}.id) as total ${from}${baseWhere}`, baseParams);
  const filtered: any = hasFilters ? await db.selectOne(`SELECT COUNT(${T}.id) as total ${from}${where}`, params) : total;

  const select = columns.map((c) => c.select_name ?? c.filter_name).join(', ');
  const sortCol = columns[state.sortBy?.col] ?? columns[0];
  const dir = state.sortBy?.dir === 'desc' ? 'desc' : 'asc';
  let sql = `SELECT ${select} ${from}${where} ORDER BY ${sortCol.sort_name ?? sortCol.filter_name} ${dir}`;
  const dataParams = [...params];
  if (!opts.exportAll) {
    const per = Math.max(1, parseInt(state.recordsPerPage, 10) || 10), page = Math.max(0, parseInt(state.currentPage, 10) || 0);
    sql += ` LIMIT ${page * per}, ${per}`;
  }
  const data = await db.selectAll(sql, dataParams);
  return { numRecords: Number(total.total), numFilteredRecords: Number(filtered.total), data, query: sql };
}

/** Write an export CSV under storage/docs/exports and return its public link. */
export async function writeExport(filename: string, lines: any[][]) {
  await deleteFolderFiles('docs/exports');
  const cell = (v: any) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  await putFile(`docs/exports/${filename}`, Buffer.from('﻿' + lines.map((l) => l.map(cell).join(',')).join('\n') + '\n', 'utf8'));
  return { filename, link: `docs/exports/${filename}` };
}
