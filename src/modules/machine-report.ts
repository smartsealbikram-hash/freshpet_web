import { Ctx, Page, exit } from '@/lib/ctx';
import { date, number_format, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { permalink, sanitize, toInt } from '@/lib/functions';
import { P, halt, notFound } from '@/lib/h';

const HEADINGS = ['Date', 'Shift', 'Total Pcs', 'Good Packs', 'Hold Packs', 'Total Packs', 'Production (kg)', 'Rejection (kg)', 'Lumps (kg)', 'Total Rejection (kg)', 'Rejection %', 'Run Time (hr)', 'Mold Change Time (hr)', 'Breakdown Time (hr)', 'Cycle Time (sec)'];
const csvCell = (v: any) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'production_reports') === 0) halt('You do not have access to this item.');
  if (ctx.get.m === undefined) notFound();
  const machine = toInt(ctx.get.m);
  const mrow: any = await db.selectOne('SELECT name FROM machines WHERE id = ?', [machine]);
  if (!mrow) notFound();
  const machineName = mrow.name;

  if ((post.action === 'load-data') || ctx.get.export !== undefined) {
    const src = String(ctx.get.export !== undefined ? ctx.get.month : post.month).split('-');
    const month = `${sanitize(src[0], 'number')}-${String(sanitize(src[1], 'number')).padStart(2, '0')}`;
    const rows = await db.selectAll("SELECT pl.*, p.weight, p.type, cycle_time, cavities, pi.color, plt.resin FROM production_logs pl JOIN production_instances pi ON pl.instance_id = pi.id JOIN production_lots plt ON pi.lot_id = plt.id JOIN products p ON pi.product = p.id WHERE plt.machine = ? AND DATE_FORMAT(shift_date, '%Y-%m') = ? ORDER BY shift_date DESC", [machine, month]);
    let tPcs = 0, tProd = 0, tGood = 0, tPacks = 0, tRej = 0, run = 0, mold = 0, brk = 0;
    const tHold = 0;
    for (const r of rows) {
      tPcs += Number(r.total_pcs); tProd += Number(r.production); tGood += Number(r.good_pack); tPacks += Number(r.total_pack); tRej += Number(r.rejection) + Number(r.lumps);
      run += Number(r.running_hrs); mold += Number(r.mold_change_time); brk += Number(r.breakdown_time);
    }
    const rejPct = tProd ? (tRej / tProd * 100).toFixed(1) : 'NA';

    if (ctx.get.export !== undefined) {
      const lines: any[][] = [['Resin', 'Product', 'Product Wt. (gm)', 'Color', ...HEADINGS]];
      for (const r of rows) lines.push([r.resin, r.type, r.weight, r.color, r.shift_date, r.shift, r.total_pcs, r.good_pack, r.total_pack, r.production, r.rejection, r.lumps, Number(r.rejection) + Number(r.lumps), r.rejection_percent, r.running_hrs, r.mold_change_time, r.breakdown_time, r.cycle_time]);
      lines.push(['Total', '', '', '', '', '', tPcs, tGood, tHold, tPacks, tProd, '', '', tRej, rejPct, run, mold, brk]);
      const csv = lines.map((l) => l.map(csvCell).join(',')).join('\n') + '\n';
      return exit(new Response(csv, { headers: { 'content-type': 'application/csv', 'content-disposition': `attachment; filename="${permalink(machineName)}-${month}-Report.csv"` } }));
    }

    const th = `<tr>${HEADINGS.map((h) => `<th>${h}</th>`).join('')}</tr>`;
    let lastResin = '', lastProduct = '', body = '';
    let packs = 0;
    for (const r of rows) {
      if (lastResin != r.resin) { body += `<tr><td colspan="15"><h3 class="mb0">Resin: ${esc(r.resin)}</h3></td></tr>`; lastResin = r.resin; }
      const fp = `${r.weight}${r.type}${r.color}`;
      if (lastProduct != fp) { body += `<tr><td colspan="15"><h4 class="mb0">${esc(r.type)} ${esc(r.weight)}gms, ${esc(r.color)}</h4></td></tr>`; lastProduct = fp; }
      body += `<tr><td>${date('d M Y', strtotime(r.shift_date) as number)}</td><td>${esc(r.shift)}</td><td>${number_format(r.total_pcs ?? 0)}</td><td>${esc(r.good_pack)}</td><td>${esc(r.total_pack)}</td><td>${esc(r.production)}</td><td>${esc(r.rejection)}</td><td>${esc(r.lumps)}</td><td>${Number(r.rejection) + Number(r.lumps)}</td><td>${esc(r.rejection_percent)}</td><td>${esc(r.running_hrs)}</td><td>${esc(r.mold_change_time)}</td><td>${esc(r.breakdown_time)}</td><td>${esc(r.cycle_time)}</td></tr>`;
      packs += Number(r.good_pack);
    }
    const out = `<div class="responsive-table"><table class="h-borders"><thead>${th}</thead><tbody>${body}</tbody><tfoot>${th}</tfoot></table></div>
		<div class="card mt1"><div class="content"><h3>Total</h3><dl class="horizontal"><dt>Pcs</dt><dd>${number_format(tPcs)}</dd><dt>Production</dt><dd>${number_format(tProd, 2)}kgs</dd><dt>Good Packs</dt><dd>${packs} boxes/bags</dd>
		<dt>Hold Packs</dt><dd>${tHold} boxes/bags</dd><dt>Rejection</dt><dd>${tRej}kgs (${rejPct}%)</dd><dt>Running Hrs</dt><dd>${run}hr</dd><dt>Mold Change Time</dt><dd>${mold}hr</dd><dt>Breakdown Time</dt><dd>${brk}hr</dd></dl></div></div>`;
    return exit(new Response(out, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  }

  const months = await db.selectAll('SELECT shift_date FROM production_logs pl JOIN production_instances pi ON pl.instance_id = pi.id JOIN production_lots plt ON pi.lot_id = plt.id WHERE plt.machine = ? GROUP BY YEAR(shift_date), MONTH(shift_date) ORDER BY pl.id DESC', [machine]);
  if (!months.length) notFound();
  const want = ctx.get.month;
  const opts = months.map((r: any, i: number) => {
    const sel = want !== undefined ? (date('Y-n', strtotime(r.shift_date) as number) == want ? ' selected' : '') : i === 0 ? ' selected' : '';
    return `<option value="${esc(r.shift_date)}"${sel}>${date('M Y', strtotime(r.shift_date) as number)}</option>`;
  }).join('');
  return {
    metaTitle: machineName, pageTitle: machineName, metaDescription: '',
    content: `<section class="overflows"><div class="container"><div id="global-msg-cont"></div><div class="row v-center">
	<div class="col xs6 s3 l2 input-field mb0"><select name="month"><option></option>${opts}</select><label>Month</label></div>
	<div class="col xs6 s9 l10 text-right"><button type="button" class="btn tonal" id="export-report"><span class="material-icons left-icon">download</span> Export</button></div></div>
	<div id="report-cont" class="mt2"></div></div></section>`,
    js: `<script type="module">
	const monthSelect = document.querySelector('select[name="month"]'), reportsCont = document.getElementById('report-cont');
	function loadData(){
		reportsCont.innerHTML = ''; G(reportsCont).progress({ type: 'circular' });
		G.ajax({ type: 'POST', data: { action: 'load-data', month: monthSelect.value } }).then(data => { reportsCont.innerHTML = data.responseText; }).catch(xhr => { console.log('Failed', xhr); G.snackbar('An error occurred.'); });
	}
	G(monthSelect).selectInput(); loadData();
	monthSelect.addEventListener('change', e => { loadData(); });
	document.getElementById('export-report').addEventListener('click', () => { location.href = location.href+'&month='+monthSelect.value+'&export=1'; });
</script>`,
  };
}
