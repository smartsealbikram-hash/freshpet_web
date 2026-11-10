import { Ctx, Page } from '@/lib/ctx';
import { productionInstanceStatusLegend, productionStatusLegend } from '@/lib/config';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { P, halt } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, S } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'production_instances') === 0) halt('You do not have access to this item.');
  const page: Page = { metaTitle: 'Machines Status', pageTitle: 'Machines Status', metaDescription: '' };
  if (P(ctx, 'production_reports') > 0) page.subTitle = '<a href="production-reports" class="btn outline small"><span class="material-icons left-icon">area_chart</span> View Reports</a>';
  page.css = `<style type="text/css">a.card{ display: block; border-bottom: none; color: inherit; } .chip{ margin-top: -0.4rem; max-width: none !important; } .card .action{ border-color: transparent !important; } .card .action .progress{ margin: -1rem -1rem 1rem; }</style>`;

  let eff = '';
  if (S.user.role == 13) {
    const q = `SELECT SUM(CASE WHEN end_hour - start_hour <= 0 THEN end_hour - start_hour + 24 ELSE end_hour - start_hour END) as total_hrs, SUM(breakdown_time) as breakdown_hrs FROM production_logs WHERE created_by = ? AND shift_date >= CURDATE() - INTERVAL `;
    const pct = async (interval: string) => { const d: any = await db.selectOne(q + interval, [S.user.id]); return d.total_hrs > 0 ? Math.round(((d.total_hrs - d.breakdown_hrs) / d.total_hrs) * 100) + '%' : ''; };
    eff = `<div class="card mb1"><div class="content"><div class="row v-center"><div class="col xs6">Your efficiency</div><div class="col xs3 center"><h3 class="mb0">${await pct('7 DAY')}</h3><small>Week</small></div><div class="col xs3 center"><h3 class="mb0">${await pct('1 MONTH')}</h3><small>Month</small></div></div></div></div>`;
  }
  const locations: Record<number, string> = {};
  for (const r of await db.selectAll('SELECT * FROM locations')) locations[r.id] = r.name;
  let mq = 'SELECT id, name, location FROM machines WHERE status = 2';
  const ma: any[] = [];
  if (S.user.department != 10) { mq += ' AND location = ?'; ma.push(ctx.settings.location); }
  let cards = '';
  for (const m of await db.selectAll(mq, ma)) {
    const lot: any = await db.selectOne('SELECT id, lot_id, status FROM production_lots WHERE machine = ? ORDER BY id DESC', [m.id]);
    if (!lot) continue;
    const instances = await db.selectAll('SELECT pi.id, lot_id, pi.status, product, quantity, date_production, p.weight, p.type FROM production_instances pi LEFT JOIN products p ON pi.product = p.id WHERE lot_id = ? ORDER BY pi.id', [lot.id]);
    let planned = 0, production = 0, ins: any;
    for (const i of instances) { planned += Number(i.quantity); ins = i; }
    if (instances.length) {
      const l: any = await db.selectOne(`SELECT SUM(production) as production FROM production_logs WHERE instance_id IN (${instances.map(() => '?').join(',')})`, instances.map((i: any) => i.id));
      production = Math.round(Number(l.production) / 1000) || 0;
    }
    let progress = 0;
    if (planned) { progress = Math.min(100, (production / planned) * 100); } else production = 0;
    cards += `<div class="col xs12 s6 l4"><a href="production-lot?id=${lot.id}" class="card"><div class="content"><h3>${esc(m.name)}&emsp;<small class="right neutral-color-4"><small>${esc(locations[m.location])}</small></small></h3>
		<p class="no-margin"><strong>${esc(lot.lot_id)}</strong>&emsp;<span class="neutral-color-4">${!planned ? 'No instance</span>' : `${date('d M Y', strtotime(ins.date_production) as number)}</span><br>${esc(ins.weight)}gm ${esc(ins.type)}`}</p></div>
		<div class="action divider" data-progress="${progress}"><p class="no-margin">${production}/${planned}MT <span class="chip right">${lot.status == 4 || lot.status == 5 ? productionInstanceStatusLegend[ins?.status] : productionStatusLegend[lot.status]}</span></p></div></a></div>`;
  }
  page.content = `<section><div class="container"><div class="row center-aligned"><div class="col xs12 "><div id="global-msg-cont"></div>${eff}<div class="row center-aligned">${cards}</div></div></div></div></section>
${P(ctx, 'production_instances') >= 2 ? '<div class="fab-cont"><a href="production-lot?edit=1" class="fab extended"><span class="material-icons">add</span> Add New</a></div>' : ''}`;
  page.js = `<script type="module">
	let delay = 200;
	G('.action.divider').each(el => {
		const progress = G(el).progress({ process: 'determinate' });
		setTimeout(function() { progress[0].dataset.progress = el.dataset.progress; progress.progress('update'); }, delay);
		delay += 200;
	});
</script>`;
  return page;
}
