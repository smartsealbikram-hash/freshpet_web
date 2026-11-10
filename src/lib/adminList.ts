import { Ctx, Page, exit, jsonExit } from './ctx';
import { hasAccess } from './functions';
import { env } from './env';
import { esc } from './html';

export interface Col {
  label: string;
  /** extra attributes on <th>, e.g. 'data-type="int" data-sort="desc"' */
  th?: string;
  /** cell html (already escaped) */
  cell: (row: any, ctx: Ctx) => string;
  /** value for data-sort on <td> */
  sort?: (row: any) => string | number;
}
export interface ListCfg {
  title: string;
  /** e.g. 'clients' => /admin/clients */
  path: string;
  /** permission key for view/rows */
  view: string;
  editPerm?: string; deletePerm?: string; addPerm?: string;
  /** SQL up to (and incl.) any WHERE; ordering clause not required */
  sql: string;
  idCol: string;
  cols: Col[];
  addHref: string;
  /** wrapper column classes e.g. 'col xs12 l10' */
  colClass?: string;
  /** extra html appended after the card (e.g. dialogs) */
  after?: string;
  js?: string;
}

/** Appends the per-profile row restriction exactly like the PHP list pages do (but works with or without WHERE). */
export function rowScope(ctx: Ctx, perm: string, sql: string, idCol: string) {
  const rows: any = hasAccess(ctx, 'rows', perm);
  if (rows === true || rows === false) return sql;
  const joiner = / WHERE /i.test(sql) ? ' AND ' : ' WHERE ';
  if (rows[0] === '*') return `${sql} ORDER BY ${idCol} DESC LIMIT ${Number(rows[1]) || 0}`;
  if (rows[1] === '*') return `${sql}${joiner}${idCol} >= ${Number(rows[0]) || 0}`;
  return `${sql}${joiner}${idCol} >= ${Number(rows[0]) || 0} AND ${idCol} <= ${Number(rows[1]) || 0}`;
}

export const noAccess = (): never => jsonExit({ message: { type: 'error', content: 'You do not have access to that page.' }, action: 'halt' });

export const statusSwitch = (row: any, type: string, canEdit: boolean) =>
  `<div class="input-field switch no-margin"><input type="checkbox" id="status${row.id}" class="change-status" data-id="${row.id}" data-type="${type}" ${row.status == 2 ? 'checked' : ''}${canEdit ? '' : ' disabled'}><label for="status${row.id}">&nbsp;</label></div>`;

export const editBtn = (href: string, small = false) => `<a href="${href}" class="btn icon${small ? ' small' : ''} edit"><span class="material-icons">edit</span></a>`;
export const delBtn = (type: string, id: any, msg = '') => `<button type="button" data-type="${type}" data-id="${id}" class="btn icon delete"${msg ? ` data-msg="${esc(msg)}"` : ''}><span class="material-icons">delete</span></button>`;

export async function adminList(ctx: Ctx, cfg: ListCfg): Promise<Page> {
  if (!hasAccess(ctx, 'view', cfg.view)) noAccess();
  const pathName = `/admin/${cfg.path}`;
  ctx.S.current_page = env.SITE_URL + pathName;
  const rows = await ctx.db.selectAll(rowScope(ctx, cfg.view, cfg.sql, cfg.idCol));
  const wide = ctx.S.user.settings?.table_width?.[pathName] === 'extended' ? ' extended' : '';
  const body = rows.map((r) => `<tr>${cfg.cols.map((c) => `<td${c.sort ? ` data-sort="${esc(c.sort(r))}"` : ''}>${c.cell(r, ctx)}</td>`).join('')}</tr>`).join('');
  return {
    metaTitle: cfg.title, pageTitle: cfg.title, metaDescription: '',
    content: `<section><div class="container${wide}"><h1 class="page-title">${esc(cfg.title)}</h1><div id="global-msg-cont"></div>
	<div class="row"><div class="${cfg.colClass ?? 'col xs12 l10'}"><div class="card"><table id="datatable"><thead><tr>${cfg.cols.map((c) => `<th ${c.th ?? ''}>${c.label}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div></div></div></div></section>
${hasAccess(ctx, 'add', cfg.addPerm ?? cfg.view) ? `<div class="fab-cont"><a href="${cfg.addHref}" class="fab extended tooltip" title="Alt + A"><span class="material-icons">add</span> Add New</a></div>` : ''}${cfg.after ?? ''}`,
    ...(cfg.js ? { js: cfg.js } : {}),
  };
}

export const OPTIONS_TH = 'data-filterable="false" data-sortable="false"';
export { exit };
