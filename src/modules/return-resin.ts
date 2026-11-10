import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { esc } from '@/lib/html';
import { sanitize } from '@/lib/functions';
import { P, SITE_URL, V, halt } from '@/lib/h';
import { resinScanJs, scanForm } from '@/lib/resin';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (!(P(ctx, 'production_instances') === 3 || S.user.role == 13 || S.user.role == 18)) halt('You do not have access to this item.');
  S['current-page'] = `${SITE_URL}/return-resin`;

  if (post.verify !== undefined) {
    const code = sanitize(post.verify);
    const pr: any = await db.selectOne('SELECT is_loaded, machine, m.name as machine_name FROM pm_rm_scans prs JOIN pm_rm_items pri ON prs.pri_id = pri.id JOIN machines m ON pri.machine = m.id WHERE bag_no = ?', [code]);
    let r: any;
    if (pr) {
      if (pr.is_loaded) {
        const f: any = await db.selectOne("SELECT plt.lot_id FROM production_materials pm JOIN production_instances pi ON pm.instance = pi.id JOIN production_lots plt ON pi.lot_id = plt.id WHERE type = 'resin' AND bag_no = ?", [code]);
        r = { success: false, message: '<span class="material-icons">cancel</span> This bag has already been loaded' + (f ? ` on ${esc(f.lot_id)}` : '. Bag number was not found in any lot however, contact support.') };
      } else r = { success: true };
    } else r = { success: false, message: '<span class="material-icons">cancel</span> Unidentified code. The bag was probably not issued in the first place.' };
    return jsonExit(r);
  } else if (post.scanned_items !== undefined) {
    let r: any;
    try {
      const codes = [...new Set<string>(JSON.parse(post.scanned_items).map((x: any) => x.code))];
      if (codes.length) await db.run(`UPDATE pm_rm_scans prs JOIN pm_rm_items pri ON prs.pri_id = pri.id SET is_returned = 1, units_issued = units_issued - 1 WHERE is_loaded = 0 AND is_returned = 0 AND bag_no IN (${codes.map(() => '?').join(',')})`, codes);
      r = { action: 'refresh', message: { type: 'success', content: `${codes.length} Bags returned` } };
    } catch (e: any) { r = { error: e.message }; }
    return jsonExit(r);
  }
  return {
    metaTitle: 'Return Resin', pageTitle: 'Return Resin', metaDescription: '',
    content: `<section style="min-height: 80vh;"><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${scanForm}</div></div></div></section>`,
    js: `<script type="module">${resinScanJs(V)}
	if(form) codeScanner(form, createList, processScannedItems);
	initAjaxForms();
</script>`,
  };
}
