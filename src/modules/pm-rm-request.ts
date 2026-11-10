import { Ctx, Page, exit, jsonExit } from '@/lib/ctx';
import { materialRequestStatusLegend, packingMaterials } from '@/lib/config';
import { date, strtotime, ucfirst } from '@/lib/php';
import { esc } from '@/lib/html';
import { Account } from '@/lib/account';
import { notifyForApproval, sanitize, sendNotification, toInt } from '@/lib/functions';
import { P, SITE_URL, V, halt, msgWarn, notFound } from '@/lib/h';

const b64 = (s: string) => Buffer.from(s).toString('base64');
const unb64 = (s: string) => Buffer.from(s, 'base64').toString('utf8');

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  const level = P(ctx, 'material_requisition');
  if (level === 0) halt('You do not have access to this item.');

  let pageTitle = 'Create PM/RM Request', id = 0, request: any;
  if (ctx.get.id !== undefined) {
    id = toInt(ctx.get.id);
    request = await db.selectOne('SELECT mr.*, u1.name as requester_name, u2.name as issuer_name FROM pm_rm_requests mr JOIN users u1 ON mr.requested_by = u1.id LEFT JOIN users u2 ON mr.issued_by = u2.id WHERE mr.id = ?', [id]);
    if (!request) notFound();
    pageTitle = `Material Request #${id}`;
  } else request = { status: 1 };

  if (post.action !== undefined) {
    let r: any = {};
    if (post.action === 'cancel') {
      try { await db.update('pm_rm_requests', { status: 0 }, 'id = ?', [id]); r = { action: 'goback' }; } catch (e) { r = msgWarn(e); }
    } else if (post.action === 'complete') {
      try {
        await db.update('pm_rm_requests', { status: 2 }, 'id = ?', [id]);
        const emp = new Account(ctx); emp.id = request.requested_by;
        const cs: any = await emp.checkCommSettings(4);
        if (cs.push_enabled) await sendNotification(ctx, cs.push_devices, 'Material requested by you has been issued', 'Tap to view details', `${SITE_URL}/pm-rm-request?id=${id}`);
        r = { action: 'goback' };
      } catch (e) { r = msgWarn(e); }
    }
    return exit(new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json' } }));
  } else if (post['save-pm'] !== undefined) {
    if (level !== 2) return jsonExit({ error: 'Permission error. Please contact your supervisor' });
    let r: any = {};
    try {
      if (ctx.get.id !== undefined) id = toInt(ctx.get.id);
      else id = await db.insert('pm_rm_requests', { status: 1, requested_by: ctx.userId, date_requested: now });
      if (ctx.get.c !== undefined)
        await db.insert('complaint_timeline', { type: 'complaint', complaint: toInt(ctx.get.c), description: `<a href="material-request?id=${id}">Material request #${id} created</a>`, date_added: now });

      let raw = 0, packing = 0;
      const old: Record<string, any[]> = {};
      for (const row of await db.selectAll('SELECT id, type, material, machine FROM pm_rm_items WHERE mr_id = ?', [id])) (old[row.type] ??= []).push(row);

      for (const [key, v] of Object.entries(post)) {
        let type: string, material: string, machine: any;
        const value = Number(v) || 0;
        if (key.includes('resin-')) {
          const parts = key.split('-'); type = 'raw'; machine = parts[1]; material = unb64(parts[2]); raw += value;
        } else if (key.includes('packing-')) {
          type = 'packing'; material = unb64(key.replace('packing-', '')); packing += value;
        } else continue;
        let oldItem: any = false;
        for (const o of old[type] ?? []) if (o.material == material && (machine === undefined || machine == o.machine)) oldItem = o;
        if (value === 0 && oldItem !== false) await db.delete('pm_rm_items', 'id = ?', [oldItem.id]);
        else if (value > 0) {
          if (oldItem !== false) await db.update('pm_rm_items', { units_requested: value }, 'id = ?', [oldItem.id]);
          else await db.insert('pm_rm_items', { mr_id: id, type, material, machine: machine ?? null, units_requested: value });
        }
      }
      await db.update('pm_rm_requests', { raw_materials_requested: raw, packing_materials_requested: packing }, 'id = ?', [id]);
      await notifyForApproval(ctx, 'material_requisition', `Material request #${id} created`, 'Tap to start processing', `${SITE_URL}/pm-rm-request?id=${id}`);
      r = { action: 'goback' };
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  }

  let body: string;
  if (level === 2 && request.status == 1) {
    const olds: Record<string, any> = {};
    if (ctx.get.id !== undefined)
      for (const r of await db.selectAll('SELECT * FROM pm_rm_items WHERE mr_id = ?', [id])) olds[(r.machine === null ? '' : r.machine + '-') + r.material] = r.units_requested;
    const resins = await db.selectAll('SELECT m.name as machine_name, machine, resin FROM production_lots pl JOIN machines m ON pl.machine = m.id WHERE pl.status BETWEEN 3 AND 5 ORDER BY machine');
    const stepper = (name: string, val: any) => `<td class="stepper-cont"><div class="stepper-input"><button type="button" class="btn small icon filled less"><span class="material-icons">remove</span></button><input type="number" name="${name}" min="0" value="${esc(val)}" class="nospinner" required><button type="button" class="btn small icon filled more"><span class="material-icons">add</span></button></div></td>`;
    body = `<form method="post" class="col xs12 s10 m8 ajax"><h3>Raw Materials</h3><table class="compact"><tbody>
		${resins.map((r: any) => `<tr><td><small>${esc(r.machine_name)}</small><br>${esc(r.resin)}</td>${stepper(`resin-${r.machine}-${b64(r.resin)}`, olds[`${r.machine}-${r.resin}`] ?? 0)}<td>bags</td></tr>`).join('')}
		</tbody></table><h3 class="mt2">Packing Materials</h3><table class="compact"><tbody>
		${Object.entries(packingMaterials).map(([k, u]) => `<tr><td>${esc(k)}</td>${stepper(`packing-${b64(k)}`, olds[k] ?? 0)}<td>${u}</td></tr>`).join('')}
		</tbody></table><div class="mt2"><button type="submit" class="btn filled" name="save-pm">Save</button>
		${ctx.get.id !== undefined && request.status == 1 && request.requested_by == S.user.id ? '<button type="submit" class="btn outline error-color" name="cancel">Cancel Request</button>' : ''}</div></form>`;
  } else {
    const mats = await db.selectAll('SELECT pri.*, m.name as machine_name FROM pm_rm_items pri LEFT JOIN machines m ON pri.machine = m.id WHERE mr_id = ? ORDER BY pri.type', [id]);
    let rows = '', type: string | null = null;
    for (const r of mats) {
      if (type === null || type !== r.type) { rows += `<tr><td colspan="3"><strong>${ucfirst(r.type)} Material</strong></td></tr>`; type = r.type; }
      rows += `<tr><td>${r.machine !== null ? `<small class="neutral-color-3">${esc(r.machine_name)}</small><br>` : ''}${esc(r.material)}</td><td>${esc(r.units_requested)}</td><td>${esc(r.units_issued)}${packingMaterials[r.material] ? ' ' + packingMaterials[r.material] : ''}</td></tr>`;
    }
    body = `<div class="col xs12 s10 m8"><dl class="horizontal mt2"><dt>Requested By</dt><dd>${esc(request.requester_name)}</dd><dt>Date Requested</dt><dd>${date('d M Y h:i A', strtotime(request.date_requested) as number)}</dd>
		${request.issued_by !== null ? `<dt>Issued By</dt><dd>${esc(request.issuer_name)}</dd><dt>Date Issued</dt><dd>${date('d M Y h:i A', strtotime(request.date_issued) as number)}</dd>` : ''}
		<dt>Status</dt><dd>${materialRequestStatusLegend[request.status]}</dd></dl>
		<h3 class="mt2">Materials Requested</h3><table class="h-borders compact"><thead><tr><th>Material</th><th>Requested</th><th>Issued</th></tr></thead><tbody>${rows}</tbody></table>
		${level === 3 && request.status == 1 ? `<div class="center mt2"><a href="issue-materials?id=${id}" class="btn filled">Issue Materials</a><button type="button" class="btn tonal send-action" data-action="complete" data-msg="Material request can not be modified after its marked complete">Mark Complete</button></div>` : ''}</div>`;
  }
  return {
    metaTitle: pageTitle, pageTitle, metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned">${body}</div></div></section>`,
    js: `<script type="module">import { stepperInput, initAjaxForms } from './js/functions.mjs?v=${V}'; stepperInput(); initAjaxForms();</script>`,
  };
  void sanitize;
}
