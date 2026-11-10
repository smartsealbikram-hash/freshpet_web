import { Ctx, Page, exit, jsonExit } from '@/lib/ctx';
import { date, number_format, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { sanitize } from '@/lib/functions';
import { P, halt, notFound } from '@/lib/h';
import { htmlToPdf, pdfResponse } from '@/lib/pdf';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, S } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'production_reports') === 0) halt('You do not have access to this item.');
  if (ctx.get.d === undefined) notFound();
  const d = sanitize(ctx.get.d, 'number');
  const start = strtotime(`${d} 06:00:00`) as number;
  const next = start + 86400;

  let q = "SELECT instance_id, shift, production, total_pcs, good_pack, rejection, lumps, u.name as created_by, CONCAT_WS(' ', p.weight, p.type) as product, pi.color, plt.lot_id, resin, m.name as machine_name FROM production_logs pl JOIN production_instances pi ON pl.instance_id = pi.id JOIN products p ON pi.product = p.id JOIN production_lots plt ON pi.lot_id = plt.id JOIN machines m ON plt.machine = m.id JOIN users u ON pl.created_by = u.id WHERE shift_date = ?";
  const a: any[] = [d];
  if (S.user.department != 10) { q += ' AND m.location = ?'; a.push(ctx.settings.location); }
  const logs = await db.selectAll(q, a);
  if (!logs.length) return jsonExit({ message: { type: 'warning', content: 'No logs available for this date.' }, action: 'halt' });

  const engineers: Record<string, string[]> = { 'Shift A': [], 'Shift B': [], 'Shift C': [] };
  const machines: Record<string, any> = {};
  for (const r of await db.selectAll('SELECT name FROM machines WHERE status = 2'))
    machines[r.name] = { lot_id: '', instance_id: [], resin: '', preform: '', color: '', production: 0, good_pcs: 0, good_pack: 0, rejection: { A: 0, B: 0, C: 0 }, lumps: { A: 0, B: 0, C: 0 }, total_rejection: 0, total_lumps: 0, bags: [] };

  for (const r of logs) {
    (engineers[r.shift] ??= []);
    if (!engineers[r.shift].includes(r.created_by)) engineers[r.shift].push(r.created_by);
    const t = (machines[r.machine_name] ??= { lot_id: '', instance_id: [], resin: '', preform: '', color: '', production: 0, good_pcs: 0, good_pack: 0, rejection: { A: 0, B: 0, C: 0 }, lumps: { A: 0, B: 0, C: 0 }, total_rejection: 0, total_lumps: 0, bags: [] });
    if (!t.lot_id.includes(r.lot_id)) t.lot_id += r.lot_id + ', ';
    if (!t.instance_id.includes(r.instance_id)) t.instance_id.push(r.instance_id);
    if (!t.resin.includes(r.resin)) t.resin += r.resin + ', ';
    if (!t.preform.includes(r.product)) t.preform += r.product + ', ';
    if (!t.color.includes(r.color)) t.color += r.color + ', ';
    t.production += Number(r.production); t.good_pcs += Number(r.total_pcs); t.good_pack += Number(r.good_pack);
    const k = String(r.shift).replace('Shift ', '');
    t.rejection[k] = (t.rejection[k] ?? 0) + Number(r.rejection); t.lumps[k] = (t.lumps[k] ?? 0) + Number(r.lumps);
    t.total_rejection += Number(r.rejection); t.total_lumps += Number(r.lumps);
  }
  for (const v of Object.values<any>(machines)) {
    if (!v.instance_id.length) continue;
    const mats = await db.selectAll(`SELECT bag_no, date_added FROM production_materials WHERE type = 'resin' AND instance IN (${v.instance_id.map(() => '?').join(',')}) ORDER BY date_added ASC`, v.instance_id);
    let seq = 1;
    for (const m of mats) { const t = strtotime(m.date_added) as number; if (t >= start && t < next) v.bags.push(`${seq}: ${m.bag_no}`); seq++; }
  }
  const names = Object.keys(machines);
  const row = (label: string, f: (v: any) => string) => `<tr><td>${label}</td>${names.map((n) => `<td>${f(machines[n])}</td>`).join('')}</tr>`;
  const trim = (s: string) => esc(s.replace(/, $/, ''));
  const perShift = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `<strong>${k}:</strong> ${v}`).join('<br>');
  const table = `<table class="h-borders v-borders"><thead><tr><th></th>${names.map((n) => `<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>
	${row('Lot ID', (v) => (v.lot_id ? trim(v.lot_id) : 'No Plan'))}${row('Resin', (v) => trim(v.resin))}${row('Preform', (v) => trim(v.preform))}${row('Color', (v) => trim(v.color))}
	${row('Production (kg)', (v) => number_format(v.production))}${row('Good Pcs', (v) => number_format(v.good_pcs))}${row('Good Boxes', (v) => String(v.good_pack))}${row('Total Pallets', (v) => String(Math.ceil(v.good_pack / 25)))}
	${row('Rejection', (v) => perShift(v.rejection))}${row('Lumps', (v) => perShift(v.lumps))}${row('Total Rejection', (v) => `<strong>R:</strong> ${v.total_rejection}<br><strong>L:</strong> ${v.total_lumps}`)}
	${row('Bags Loaded', (v) => v.bags.map(esc).join('<br>'))}</tbody></table>`;

  if (ctx.get.download !== undefined) {
    let eng = '';
    let i = 1;
    for (const [k, v] of Object.entries(engineers)) if (v.length) { eng += (i > 1 ? '<span style="padding-left: 100px">' : '') + `${k} - ${v.map(esc).join(', ')}` + (i > 1 ? '</span>' : '') + '<br>'; i++; }
    const html = `<!DOCTYPE html><html lang="en"><head><title></title><meta charset="utf-8"><style>*{box-sizing:border-box}body{font-family:sans-serif;font-size:14px}.center{text-align:center}table{border:1px solid;border-collapse:collapse}table th,table td{padding:6px;border:1px solid}</style></head><body>
		<div class="center"><h1>FreshPet Pvt Ltd</h1><h3 style="margin-top: -1rem">Daily Production Report</h3></div><p>Date of Production: ${date('d M, Y', start)}<br>Shift Engineers: ${eng}${table}</body></html>`;
    let pdf: Buffer;
    try { pdf = await htmlToPdf(html); } catch (e: any) { return exit(new Response(String(e?.message ?? 'PDF generation failed'), { status: 501 })); }
    return exit(pdfResponse(pdf, `Daily Production Report ${d}.pdf`));
  }

  return {
    metaTitle: 'Daily Production Report', pageTitle: 'Daily Production Report', metaDescription: '', subTitle: date('d M, Y', start),
    content: `<section><div class="container"><div id="global-msg-cont"></div><div class="row"><div class="col xs12 s10 m8"><div class="card"><div class="content"><h4>Shift Engineers</h4><dl class="horizontal">
	${Object.entries(engineers).filter(([, v]) => v.length).map(([k, v]) => `<dt>${k}</dt><dd>${v.map(esc).join(', ')}</dd>`).join('')}</dl></div></div></div></div>
	<div class="card mt2"><div class="content"><h4>Production Summary</h4><div class="responsive-table">${table}</div></div></div>
	<p class="mt1"><a href="daily-production-report?d=${esc(d)}&download=1" class="btn text" download><span class="material-icons">download</span> Download PDF</a></p></div></section>`,
  };
}
