import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { ajaxTable, writeExport } from '@/lib/ajaxTable';
import { hasAccess, sanitize } from '@/lib/functions';
import { number_format, date, strtotime } from '@/lib/php';
import { env } from '@/lib/env';
import { esc } from '@/lib/html';
import { noAccess } from '@/lib/adminList';

export default async function (ctx: Ctx): Promise<Page> {
  if (!hasAccess(ctx, 'view', 'admins')) noAccess();
  const type = sanitize(ctx.get.t) === 'srn' ? 'srn' : 'grn';
  const title = `${type.toUpperCase()} Register`;
  const pathName = `/admin/receiving-notes?t=${type}`;
  ctx.S.current_page = env.SITE_URL + pathName;

  if (ctx.post.gs_table_request !== undefined) {
    const columns = [
      { name: 'ID', filter_name: 'receiving_notes.id' }, { name: 'Register ID', filter_name: 'register_id' },
      { name: 'Location', filter_name: 'l.name', select_name: 'l.name as location' }, { name: 'Party', filter_name: 'party_name' },
      { name: 'Received On', filter_name: 'date_received' }, { name: 'Amount', filter_name: 'amount' },
    ];
    const exp = ctx.post.export !== undefined;
    const res = await ajaxTable(ctx, { columns, primaryTable: 'receiving_notes', joins: ` JOIN locations l ON receiving_notes.location = l.id WHERE type = '${type}'`, perm: 'receiving_notes', exportAll: exp });
    // the select list above renders receiving_notes.id as "id" etc.; map by name
    const out: any = { numRecords: res.numRecords, numFilteredRecords: res.numFilteredRecords, data: [] };
    const canEdit = hasAccess(ctx, 'edit', 'receiving_notes'), canDel = hasAccess(ctx, 'delete', 'receiving_notes');
    const lines: any[][] = [columns.map((c) => c.name)];
    for (const r of res.data) {
      const ts = strtotime(r.date_received) as number;
      const shown = date('d M Y h:i A', ts);
      if (exp) lines.push([r.id, r.register_id, r.location, r.party_name, shown, '₹' + r.amount]);
      else out.data.push([
        r.id, esc(r.register_id), esc(r.location), esc(r.party_name), { display: shown, sort: ts }, { display: '₹' + number_format(r.amount), sort: r.amount },
        (canEdit ? `<a href="${type}-register-entry?id=${r.id}" class="btn icon small"><span class="material-icons">edit</span></a>` : '') + (canDel ? `<button type="button" data-type="receiving_notes" data-id="${r.id}" class="btn icon delete"><span class="material-icons">delete</span></button>` : ''),
      ]);
    }
    if (exp) Object.assign(out, await writeExport('receiving-notes.csv', lines));
    if (env.DEBUG >= 3) out.query = res.query;
    return jsonExit(out);
  }
  return {
    metaTitle: title, pageTitle: title, metaDescription: '',
    content: `<section><div class="container${ctx.S.user.settings?.table_width?.[pathName] === 'extended' ? ' extended' : ''}"><h1 class="page-title">${esc(title)}</h1><div id="global-msg-cont"></div>
	<div class="card"><table id="datatable-ajax"><thead><tr><th data-type="int" data-sort="desc">ID</th><th>Register ID</th><th>Location</th><th>Party</th><th data-type="date">Received On</th><th data-type="int">Amount</th><th data-filterable="false" data-sortable="false">Options</th></tr></thead><tbody></tbody></table></div></div></section>
${hasAccess(ctx, 'add', 'receiving_notes') ? `<div class="fab-cont"><a href="${type}-register-entry" class="fab extended tooltip" title="Alt + A"><span class="material-icons">add</span> Add New</a></div>` : ''}`,
  };
}
