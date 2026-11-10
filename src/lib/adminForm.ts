import { Ctx, Exit, Page, jsonExit } from './ctx';
import { hasAccess, hasAccessToRow, toInt } from './functions';
import { env } from './env';
import { esc } from './html';

export interface FormCfg {
  /** singular name used in messages, e.g. "transporter" */
  noun: string;
  /** url path of this page ("transporter") and its list page ("transporters") */
  path: string; listPath: string;
  /** permission key */
  perm: string;
  table: string;
  titleNew: string; titleEdit: string;
  /** POST field that identifies a submit */
  postKey: string;
  /** SQL to load the row, receives id */
  loadSql?: string;
  /** inner html of the .content block */
  fields: (row: any, ctx: Ctx) => string | Promise<string>;
  /** column payload from POST */
  payload: (post: any, ctx: Ctx, row: any) => Record<string, any> | Promise<Record<string, any>>;
  /** extra work after insert/update, id is the row id */
  after?: (id: number, ctx: Ctx, isNew: boolean) => Promise<void>;
  savedMsg?: string;
  /** html appended inside the card content below the fields */
  extra?: (row: any, ctx: Ctx) => string | Promise<string>;
  /** whole column classes */
  colClass?: string;
  showAnother?: boolean;
  js?: string;
  /** which payload keys are required to exist to treat edit access check */
  title?: (row: any) => string;
  /** html placed after the card inside the main column / as a sibling column / below the row */
  outside?: (row: any, ctx: Ctx) => string | Promise<string>;
  side?: (row: any, ctx: Ctx) => string | Promise<string>;
  below?: (row: any, ctx: Ctx) => string | Promise<string>;
  /** additional POST actions handled before the main save (e.g. 'transfer', 'save-params'); must exit via jsonExit */
  onPost?: { keys: string[]; run: (ctx: Ctx, id: number) => Promise<void> };
}

export async function adminForm(ctx: Ctx, cfg: FormCfg): Promise<Page> {
  const { db, post, S } = ctx;
  if (!hasAccess(ctx, 'view', cfg.perm)) jsonExit({ message: { type: 'error', content: 'You do not have access to that page.' }, action: 'halt' });
  const pathName = `/admin/${cfg.path}`;
  S.current_page = env.SITE_URL + pathName;
  let title = cfg.titleNew, row: any = {}, id = 0;
  const hasId = ctx.get.id !== undefined;

  if (cfg.onPost && cfg.onPost.keys.some((k) => post[k] !== undefined) && post[cfg.postKey] === undefined) {
    await cfg.onPost.run(ctx, toInt(ctx.get.id));
  }
  if (post[cfg.postKey] !== undefined) {
    let response: any = {};
    try {
      if (hasId && hasAccess(ctx, 'edit', cfg.perm) && (await hasAccessToRow(ctx, toInt(ctx.get.id), cfg.perm))) {
        id = toInt(ctx.get.id);
        const cur = cfg.loadSql ? await db.selectOne(cfg.loadSql, [id]) : await db.selectOne(`SELECT * FROM ${cfg.table} WHERE id = ?`, [id]);
        await db.update(cfg.table, await cfg.payload(post, ctx, cur || {}), 'id = ?', [id]);
        if (cfg.after) await cfg.after(id, ctx, false);
      } else if (!hasId && hasAccess(ctx, 'add', cfg.perm)) {
        id = await db.insert(cfg.table, await cfg.payload(post, ctx, {}));
        if (cfg.after) await cfg.after(id, ctx, true);
      } else throw new Error('You do not have permission for this operation');
      if (!hasId) {
        if (post.another !== undefined) response = { message: { type: 'snackbar', content: cfg.savedMsg ?? `${cfg.noun} Saved.` }, action: 'refresh' };
        else response.action = 'goback';
      }
    } catch (e: any) { if (e instanceof Exit) throw e; response = { message: { type: 'warning', content: e.message } }; }
    return jsonExit(response);
  } else if (hasId && (await hasAccessToRow(ctx, toInt(ctx.get.id), cfg.perm))) {
    id = toInt(ctx.get.id);
    row = await db.selectOne(cfg.loadSql ?? `SELECT * FROM ${cfg.table} WHERE id = ? AND status > 0`, [id]);
    if (row) { title = cfg.titleEdit; S.current_page += `?id=${id}`; }
    else jsonExit({ message: { type: 'error', content: `No ${cfg.noun} found. Please select one from the list.` }, action: 'halt' });
  }
  const canSave = hasAccess(ctx, 'edit', cfg.perm) || hasAccess(ctx, 'add', cfg.perm);
  return {
    metaTitle: title, pageTitle: title, metaDescription: '', nav: { refLink: `${env.SITE_URL}/admin/${cfg.listPath}` },
    content: `<section><div class="container"><h1 class="page-title">${esc(title)}</h1><div class="row"><div class="${cfg.colClass ?? 'col xs12 m10 l8'}"><form method="post" class="card ajax"><div class="content">${await cfg.fields(row, ctx)}${cfg.extra ? await cfg.extra(row, ctx) : ''}</div>
	${canSave ? `<div class="action"><button type="submit" class="btn filled">Save</button>${!hasId && cfg.showAnother !== false ? '<button type="submit" class="btn outline" name="another">Save and Add Another</button>' : ''}<div id="global-msg-cont"></div></div>` : ''}</form>${cfg.outside ? await cfg.outside(row, ctx) : ''}</div>${cfg.side ? await cfg.side(row, ctx) : ''}</div>${cfg.below ? await cfg.below(row, ctx) : ''}</div></section>`,
    js: `<script type="module">import { initInputs, initAjaxForms } from '../js/functions.mjs'; initInputs(); initAjaxForms();${cfg.js ?? ''}</script>`,
  };
}

/** common building blocks */
export const textField = (name: string, label: string, value: any, extra = '', helper = '') =>
  `<div class="input-field sidelabel"><input type="text" name="${name}" value="${esc(value ?? '')}" ${extra}><label>${label}</label>${helper ? `<span class="helper">${helper}</span>` : ''}</div>`;
export const statusField = (cur: any) =>
  `<div class="input-field sidelabel"><p class="label">Status</p><div class="segmented-control"><input type="radio" name="status" id="status-active" value="2"${cur == 2 ? ' checked' : ''} required><label for="status-active">Active</label><input type="radio" name="status" id="status-inactive" value="1"${cur == 1 ? ' checked' : ''}><label for="status-inactive">Inactive</label></div></div>`;
