import { Ctx, Page, exit, jsonExit } from '@/lib/ctx';
import { esc } from '@/lib/html';
import { sanitize, toInt } from '@/lib/functions';
import { P, SITE_URL, V, halt } from '@/lib/h';
import { resinScanJs, scanForm } from '@/lib/resin';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (!(P(ctx, 'production_instances') === 3 || S.user.role == 13 || S.user.role == 18)) halt('You do not have access to this item.');
  S['current-page'] = `${SITE_URL}/load-resin`;

  if (ctx.get.m !== undefined) {
    const machineId = toInt(ctx.get.m);
    if (post.verify !== undefined) {
      const code = sanitize(post.verify);
      const pr: any = await db.selectOne('SELECT is_loaded, machine, m.name as machine_name FROM pm_rm_scans prs JOIN pm_rm_items pri ON prs.pri_id = pri.id JOIN machines m ON pri.machine = m.id WHERE bag_no = ? AND is_returned = 0', [code]);
      let r: any;
      if (pr) {
        if (pr.is_loaded) {
          const f: any = await db.selectOne("SELECT plt.lot_id FROM production_materials pm JOIN production_instances pi ON pm.instance = pi.id JOIN production_lots plt ON pi.lot_id = plt.id WHERE type = 'resin' AND bag_no = ?", [code]);
          r = { success: false, message: '<span class="material-icons">cancel</span> This bag has already been loaded' + (f ? ` on ${esc(f.lot_id)}` : '. Bag number was not found in any lot however, contact support.') };
        } else if (pr.machine != machineId) r = { success: false, message: `<span class="material-icons">cancel</span> This bag has been issued for ${esc(pr.machine_name)}` };
        else r = { success: true };
      } else r = { success: false, message: '<span class="material-icons">cancel</span> Unidentified code. Check if this bag was issued properly.' };
      return jsonExit(r);
    } else if (post.scanned_items !== undefined) {
      let r: any;
      try {
        const codes = [...new Set<string>(JSON.parse(post.scanned_items).map((x: any) => x.code))];
        if (!codes.length) throw new Error('Enter a valid bag code to load resin');
        const active: any = await db.selectOne('SELECT pi.id, pi.status, pi.lot_id, plt.status as lot_status FROM production_instances pi JOIN production_lots plt ON pi.lot_id = plt.id WHERE machine = ? AND pi.status BETWEEN 2 AND 5 ORDER BY id DESC', [machineId]);
        if (!active) throw new Error('No active instance to accept resin.');
        const rows = await db.selectAll(`SELECT prs.id, bag_no, weight, is_loaded, is_returned, machine FROM pm_rm_scans prs JOIN pm_rm_items pri ON prs.pri_id = pri.id WHERE bag_no IN (${codes.map(() => '?').join(',')})`, codes);
        for (const row of rows) {
          if (row.is_loaded == 0 && row.is_returned == 0 && row.machine == machineId) {
            await db.insert('production_materials', { instance: active.id, type: 'resin', bag_no: row.bag_no, weight: row.weight, date_added: now, added_by: S.user.id });
            await db.update('pm_rm_scans', { is_loaded: 1 }, 'id = ?', [row.id]);
            if (active.status == 2) {
              await db.update('production_instances', { status: 3, resin_load_by: S.user.id, date_resin_load: now }, 'id = ?', [active.id]);
              active.status = 3;
              if (active.lot_status == 3) await db.update('production_lots', { status: 4 }, 'id = ?', [active.lot_id]);
            }
          }
        }
        ctx.flash('success', 'Bags saved');
        r = { action: 'reload' };
      } catch (e: any) { r = { error: e.message }; }
      return jsonExit(r);
    }
  }

  if (post.action === 'view-bags') {
    const bags = await db.selectAll(`SELECT bag_no FROM pm_rm_scans prs JOIN pm_rm_items pri ON prs.pri_id = pri.id WHERE machine = ? AND is_loaded = 0 AND is_returned = ${post.type === 'returned' ? 1 : 0}`, [post.machine]);
    const out = bags.length ? `<ul class="list">${bags.map((r: any) => `<li>${esc(r.bag_no)}</li>`).join('')}</ul>`
      : post.type === 'returned' ? '<p class="center">There are no bags returned from this machine.</p>' : '<p class="center">There are no bags issued on this machine that has not been loaded yet.</p>';
    return exit(new Response(out, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  }

  let body: string;
  if (ctx.get.m !== undefined) body = scanForm;
  else {
    let q = 'SELECT id, name FROM machines WHERE status = 2';
    const a: any[] = [];
    if (S.user.department != 10) { q += ' AND location = ?'; a.push(ctx.settings.location); }
    let tiles = '';
    for (const m of await db.selectAll(q, a)) {
      const b: any = await db.selectOne('SELECT COUNT(CASE WHEN is_loaded = 0 AND is_returned = 0 THEN 1 END) AS issued, COUNT(CASE WHEN is_loaded = 0 AND is_returned = 1 THEN 1 END) AS returned FROM pm_rm_scans prs JOIN pm_rm_items pri ON prs.pri_id = pri.id WHERE machine = ?', [m.id]);
      tiles += `<div class="col xs6 s4 m3"><div class="item"><a href="load-resin?m=${m.id}" class="waves"><span class="material-icons">manufacturing</span><span class="name">${esc(m.name)}</span></a>
			<div class="footer"><button type="button" class="btn tonal small view-bags" data-machine="${m.id}" data-type="issued">${b?.issued ?? 0} Bags<br>Issued</button><button type="button" class="btn tonal small view-bags" data-machine="${m.id}" data-type="returned">${b?.returned ?? 0} Bags<br>Returned</button></div></div></div>`;
    }
    body = `<div class="row tiles">${tiles}</div>`;
  }
  return {
    metaTitle: 'Load Resin', pageTitle: 'Load Resin', metaDescription: '',
    content: `<section style="min-height: 80vh;"><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>`,
    js: `<script type="module">${resinScanJs(V)}
	G('.view-bags').on('click', e => {
		const title = e.target.dataset.type == 'issued' ? 'Issued Bags' : 'Returned Bags';
		const sheet = setupSheet(title);
		G.ajax({ type: 'POST', data: { action: 'view-bags', machine: e.target.dataset.machine, type: e.target.dataset.type } }).then(data => { sheet.body.innerHTML = data.responseText; }).catch(xhr => { console.log('Failed', xhr); G.snackbar('An error occurred.'); });
	});
	if(form) codeScanner(form, createList, processScannedItems);
	initInputs(); initAjaxForms();
</script>`,
  };
}
