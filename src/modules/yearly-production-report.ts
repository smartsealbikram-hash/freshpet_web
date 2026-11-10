import { Ctx, Page } from '@/lib/ctx';
import { date, number_format } from '@/lib/php';
import { esc } from '@/lib/html';
import { toInt } from '@/lib/functions';
import { P, halt } from '@/lib/h';

const r2 = (n: number, d = 2) => { const f = 10 ** d; return Math.round(n * f) / f; };

export default async function (ctx: Ctx): Promise<Page> {
  const { db } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'production_reports') === 0) halt('You do not have access to this item.');
  if (ctx.get.y === undefined) halt('Select a machine to view reports.');
  const year = toInt(ctx.get.y);
  const [ty, tm, td] = date('Y-m-d').split('-').map(Number);
  const total = { production: 0, rejection: 0, running_hrs: 0 };
  let dl = '';
  for (const m of await db.selectAll('SELECT id, name FROM machines WHERE status = 2')) {
    const mt = { production: 0, rejection: 0, running_hrs: 0, total_hrs: 0, num_months: 0 };
    const rows = await db.selectAll('SELECT MONTH(shift_date) month, YEAR(shift_date) year, MONTHNAME(shift_date) month_name, SUM(production) production, SUM(rejection+lumps) rejection, SUM(running_hrs) running_hrs FROM production_logs pl JOIN production_instances pi ON pl.instance_id = pi.id JOIN production_lots plt ON pi.lot_id = plt.id WHERE plt.machine = ? AND pl.shift_date BETWEEN ? AND ? GROUP BY MONTH(shift_date) ORDER BY shift_date ASC', [m.id, `${year}-04-01`, `${year + 1}-03-31`]);
    let body = '';
    for (const r of rows) {
      const prod = Number(r.production), rej = Number(r.rejection), run = Number(r.running_hrs);
      const days = ty == r.year && tm == r.month ? td - 1 : new Date(r.year, r.month, 0).getDate();
      mt.production += prod; mt.rejection += rej; mt.running_hrs += run; mt.total_hrs += days * 24; mt.num_months++;
      body += `<tr><td><a href="machine-report?m=${m.id}&month=${r.year}-${r.month}">${esc(r.month_name)}</a></td><td>${number_format(prod)}kg</td><td>${number_format(rej)}kg</td><td>${prod > 0 ? r2((rej / prod) * 100) : 0}%</td><td>${esc(r.running_hrs)}</td><td>${r2(run / 24, 1)}</td><td>${r2((run / (days * 24)) * 100)}%</td></tr>`;
    }
    const rp = mt.production > 0 ? r2((mt.rejection / mt.production) * 100) : 0;
    const util = mt.num_months > 0 ? r2((mt.running_hrs / mt.total_hrs) * 100) : 0;
    dl += `<dt>${esc(m.name)}</dt><dd><div class="responsive-table no-padding"><table class="h-borders"><thead><tr><th>Month</th><th>Production</th><th>Rejection</th><th>Rejection %</th><th>Running Hrs</th><th>Running Days</th><th>Utilization (%)</th></tr></thead><tbody>${body}</tbody>
		<tfoot><tr><th>Total</th><th>${number_format(mt.production)}kg</th><th>${number_format(mt.rejection)}kg</th><th>${rp}%</th><th>${r2(mt.running_hrs, 4)}</th><th>${r2(mt.running_hrs / 24)}</th><th>${util}%</th></tr></tfoot></table></div></dd>`;
    total.production += mt.production; total.rejection += mt.rejection; total.running_hrs += mt.running_hrs;
  }
  const title = `Yearly Report ${year}-${year + 1}`;
  return {
    metaTitle: title, pageTitle: title, metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div><dl>${dl}</dl>
	<div class="card mt2"><div class="content"><h4>Year Total</h4><div class="responsive-table"><table><thead><tr><th>Production</th><th>Rejection</th><th>Rejection %</th><th>Running Hrs</th><th>Running Days</th></tr></thead><tbody><tr>
	<td>${number_format(total.production)}kg</td><td>${number_format(total.rejection)}kg</td><td>${total.production > 0 ? r2((total.rejection / total.production) * 100) : 0}%</td><td>${r2(total.running_hrs, 4)}</td><td>${r2(total.running_hrs / 24)}</td></tr></tbody></table></div></div></div>
	</div></div></div></section>`,
    js: `<script type="text/javascript">G('dl').accordion();</script>`,
  };
}
