import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { esc } from '@/lib/html';
import { sanitize, toInt } from '@/lib/functions';
import { P, V, halt, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'material_requisition') < 3) halt('You do not have access to this item.');
  if (ctx.get.pri === undefined) notFound();
  const pri = toInt(ctx.get.pri);
  const item: any = await db.selectOne('SELECT pri.*, pr.id as request_id FROM pm_rm_items pri JOIN pm_rm_requests pr ON pri.mr_id = pr.id WHERE pri.id = ?', [pri]);
  if (!item) notFound();
  const scanned = (await db.selectAll('SELECT * FROM pm_rm_scans WHERE pri_id = ? AND is_returned = 0', [pri])).map((r: any) => ({ ...r, code: r.bag_no }));

  if (post.scanned_items !== undefined) {
    const fallback = sanitize(post.bag_weight, 'number');
    const list: any[] = JSON.parse(post.scanned_items);
    const response: any = {};
    try {
      await db.transaction(async (tx) => {
        if (!list.length) throw new Error('Scan at least 1 bag to save.');
        if (post.deleted_items) {
          const del = String(post.deleted_items).split(',').filter(Boolean).map((x) => toInt(x));
          if (del.length) await tx.delete('pm_rm_scans', `pri_id = ? AND id IN (${del.map(() => '?').join(',')})`, [pri, ...del]);
        }
        if (list.length > item.units_requested) throw new Error(`You have scanned more bags than requested. Please remove ${list.length - item.units_requested} extra bags to continue.`);
        for (const v of list) {
          const p: any = { pri_id: pri, bag_no: sanitize(v.code), scanned_text: v.scanned_text, is_returned: 0 };
          if (v.bag_id !== undefined) { p.bag_id = sanitize(v.bag_id); p.weight = sanitize(v.bag_weight, 'number'); }
          else {
            if (!fallback) throw new Error(`Error with bag ${v.bag_no}: Provide a fallback weight in case weight is not part of scanned code.`);
            p.weight = fallback;
          }
          const chk: any = await tx.selectOne('SELECT id FROM pm_rm_scans WHERE bag_no = ? AND is_returned = 1', [v.code]);
          if (chk) await tx.update('pm_rm_scans', p, 'id = ?', [chk.id]);
          else if (v.id !== undefined) await tx.update('pm_rm_scans', p, 'id = ?', [v.id]);
          else await tx.insert('pm_rm_scans', p);
        }
        const n = await tx.count('pm_rm_scans', 'pri_id = ?', [pri]);
        await tx.update('pm_rm_items', { units_issued: n }, 'id = ?', [pri]);
      });
      response.action = 'goback';
    } catch (e: any) { response.error = e.message; }
    return jsonExit(response);
  }

  return {
    metaTitle: item.material, pageTitle: item.material, metaDescription: '', subTitle: `PM Request #${item.request_id}`,
    css: '<style type="text/css">.list:not(:empty) { border: 1px solid var(--neutral-color-5); border-radius: var(--border-radius-m); }</style>',
    content: `<section style="min-height: 80vh;"><div class="container"><div class="row center-aligned"><div class="col xs12 s9 m7 l5">
	<h2 class="section-title">Scan Bags to Issue</h2>
	<form id="materials-form" class="ajax">
		<div class="input-field"><input type="number" name="bag_weight" step="0.1" min="0"><label>Bag Weight</label><span class="helper">Specify fallback value here</span></div>
		<input type="text" name="scanned_items" value="${scanned.length ? esc(JSON.stringify(scanned)) : ''}" hidden>
		<input type="text" name="deleted_items" hidden>
		<div id="scan-module" class="mt2">
			<div class="center relative"><span class="material-icons giant">barcode_scanner</span><p class="text-banner mt1 light neutral">Not listening. Tap to start</p><input type="text" id="scanner-input"></div>
			<h4 class="success-color mb0 hide" id="scanned-total" data-requested="${esc(item.units_requested)}">Scanned Bags: <span class="right">0</span></h4>
			<ul class="list right-assist compact mb2"></ul>
		</div>
		<div class="fab-cont center"><button type="submit" class="fab extended"><span class="material-icons">save</span> Save</button></div>
	</form></div></div></div></section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms, codeScanner} from './js/functions.mjs?v=${V}';
	const form = document.getElementById('materials-form'), scannedList = document.querySelector('#scan-module .list'), scanSummary = document.getElementById('scanned-total');
	initInputs(); initAjaxForms();
	function createList(listInput, list){
		scannedList.innerHTML = '';
		scanSummary.querySelector('span').textContent = list.length+'/'+scanSummary.dataset.requested;
		scanSummary.classList.remove('hide');
		list.forEach(item => { scannedList.insertAdjacentHTML('beforeend', '<li><div class="content">'+item.code+'</div><div class="right-assist"><button type="button" class="btn icon"><span class="material-icons">delete</span></button></div></li>'); });
		listInput.value = JSON.stringify(list);
	}
	function processScannedItems(input, list){
		const scannedParts = input.split(' '), search = list.find(item => item.code == scannedParts[0]);
		if(search) throw new Error('Bag has already been added.');
		if(scannedParts.length == 1){ return { 'code': scannedParts[0], 'scanned_text': input } }
		else {
			let resin = scannedParts[2], bagIdIndex = 3;
			if(scannedParts[bagIdIndex].length == 1){ resin += scannedParts[bagIdIndex]; bagIdIndex++; }
			let bagId = scannedParts[bagIdIndex].slice(0, 10), bagWeight = scannedParts[bagIdIndex].slice(10);
			return { 'code': scannedParts[0], 'bag_id': bagId, 'resin': resin, 'bag_weight': bagWeight, 'scanned_text': input }
		}
	}
	codeScanner(form, createList, processScannedItems);
</script>`,
  };
}
