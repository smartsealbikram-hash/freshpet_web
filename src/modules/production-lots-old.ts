import { Ctx, Page } from '@/lib/ctx';
import { productionInstanceStatusLegend, productionStatusLegend } from '@/lib/config';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { noData, toInt } from '@/lib/functions';
import { P, V, halt } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'production_instances') === 0) halt('You do not have access to this item.');
  let machine: any, machineId = 0;
  if (ctx.get.m !== undefined) { machineId = toInt(ctx.get.m); machine = await db.selectOne('SELECT name FROM machines WHERE id = ? AND status > 0', [machineId]); }
  const page: Page = { metaTitle: 'Planning', pageTitle: 'Planning', metaDescription: '' };
  if (machine) page.subTitle = machine.name;
  let body: string;
  if (machine) {
    let q = 'SELECT pl.id, pl.lot_id, pl.status, machine, resin, pi.quantity, pi.date_production, p.weight, p.type, SUM(production) production FROM production_lots pl LEFT JOIN production_instances pi ON pl.id = pi.lot_id LEFT JOIN products p ON pi.product = p.id LEFT JOIN production_logs plg ON pi.id = plg.instance_id WHERE machine = ?';
    if (P(ctx, 'production_instances') < 3) q += ' AND pi.status > 0';
    q += ' GROUP BY pl.id ORDER BY pl.id DESC';
    const rows = await db.selectAll(q, [machineId]);
    if (rows.length) {
      let out = '<ul class="list three-line dividers link-list right-assist">';
      for (const r of rows) {
        out += `<li data-url="production-lot?id=${r.id}"><div class="content"><p class="no-margin">${esc(r.lot_id)}</p><p class="headline">`;
        if (r.quantity === null) out += `No instance</p></div><div class="right-assist"><span class="chip">${productionStatusLegend[r.status]}</span></div></li>`;
        else {
          let status: string | null = null;
          if (r.status == 5) {
            const i: any = await db.selectOne('SELECT status FROM production_instances WHERE lot_id = ? ORDER BY id DESC', [r.id]);
            if (i.status != 8) status = productionInstanceStatusLegend[i.status];
          }
          if (status === null) status = productionStatusLegend[r.status];
          out += `${esc(r.weight)}gm ${esc(r.type)}</p><p class="helper-text">Production: ${Math.round(Number(r.production) / 1000) || 0}/${esc(r.quantity)}MT</p></div><div class="right-assist"><p class="no-margin">${date('d M Y', strtotime(r.date_production) as number)}</p><span class="chip">${status}</span></div></li>`;
        }
      }
      body = out + '</ul>';
    } else body = noData('Production lots');
  } else {
    const ms = await db.selectAll('SELECT id, name FROM machines WHERE status = 2');
    body = `<p>Select a machine</p><ul class="list compact link-list dividers">${ms.map((r: any) => `<li data-url="production-lots-old?m=${r.id}">${esc(r.name)}</li>`).join('')}</ul>`;
  }
  page.content = `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>${body}</div></div></div></section>`;
  page.js = `<script type="module">import { initLinksList } from './js/functions.mjs?v=${V}'; initLinksList();</script>`;
  return page;
}
