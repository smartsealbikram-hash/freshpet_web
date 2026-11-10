import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { ajaxTable, writeExport } from '@/lib/ajaxTable';
import { hasAccess } from '@/lib/functions';
import { env } from '@/lib/env';
import { esc } from '@/lib/html';
import { noAccess } from '@/lib/adminList';

export default async function (ctx: Ctx): Promise<Page> {
  if (!hasAccess(ctx, 'view', 'production')) noAccess();
  if (ctx.post.gs_table_request !== undefined) {
    const columns = [
      { name: 'ID', filter_name: 'production_logs.id' }, { name: 'Lot', filter_name: 'pl.lot_id' },
      { name: 'Instance', filter_name: 'CONCAT_WS(" ", weight, type, color)', select_name: 'weight, type, color' },
      { name: 'Date', filter_name: 'shift_date', type: 'datetime' as const }, { name: 'Shift', filter_name: 'shift' },
      { name: 'Production (kg)', filter_name: 'production' }, { name: 'Total Pcs', filter_name: 'total_pcs' },
    ];
    // selected columns need extra aliases to render
    const cols = columns.map((c) => (c.name === 'ID' ? { ...c, select_name: 'production_logs.id as id' } : c.name === 'Lot' ? { ...c, select_name: 'pl.lot_id as lot_id' } : c));
    const exp = ctx.post.export !== undefined;
    const res = await ajaxTable(ctx, { columns: cols as any, primaryTable: 'production_logs', joins: 'JOIN production_instances pi ON production_logs.instance_id = pi.id JOIN production_lots pl ON pi.lot_id = pl.id JOIN products p ON pi.product = p.id', perm: 'production', exportAll: exp });
    const out: any = { numRecords: res.numRecords, numFilteredRecords: res.numFilteredRecords, data: [] };
    const canEdit = hasAccess(ctx, 'edit', 'production'), canDel = hasAccess(ctx, 'delete', 'production');
    const lines: any[][] = [columns.map((c) => c.name)];
    for (const r of res.data) {
      const inst = `${r.weight}gms ${r.type}, ${r.color}`;
      if (exp) lines.push([r.id, r.lot_id, inst, r.shift_date, r.shift, r.production, r.total_pcs]);
      else out.data.push([r.id, esc(r.lot_id), esc(inst), esc(r.shift_date), esc(r.shift), esc(r.production), esc(r.total_pcs),
        (canEdit ? `<a href="production-log?id=${r.id}" class="btn icon small"><span class="material-icons">edit</span></a>` : '') + (canDel ? `<button type="button" data-type="production_logs" data-id="${r.id}" class="btn icon small delete"><span class="material-icons">delete</span></button>` : '')]);
    }
    if (exp) Object.assign(out, await writeExport('production-logs.csv', lines));
    if (env.DEBUG >= 3) out.query = res.query;
    return jsonExit(out);
  }
  const pathName = '/admin/production-logs';
  ctx.S.current_page = env.SITE_URL + pathName;
  return {
    metaTitle: 'Production Logs', pageTitle: 'Production Logs', metaDescription: '',
    content: `<section><div class="container${ctx.S.user.settings?.table_width?.[pathName] === 'extended' ? ' extended' : ''}"><h1 class="page-title">Production Logs</h1><div id="global-msg-cont"></div>
	<div class="card"><table id="datatable-ajax"><thead><tr><th data-type="int" data-sort="desc">ID</th><th>Lot</th><th>Instance</th><th>Date</th><th>Shift</th><th>Production (kg)</th><th>Total Pcs</th><th data-filterable="false" data-sortable="false">Options</th></tr></thead><tbody></tbody></table></div></div></section>
${hasAccess(ctx, 'add', 'production') ? '<div class="fab-cont"><a href="production-log" class="fab extended tooltip" title="Alt + A"><span class="material-icons">add</span> Add New</a></div>' : ''}`,
  };
}
