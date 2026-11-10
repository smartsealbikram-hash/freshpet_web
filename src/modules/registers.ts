import { Ctx, Page } from '@/lib/ctx';
import { esc } from '@/lib/html';
import { noData, toInt } from '@/lib/functions';
import { V, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, S } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (ctx.get.d === undefined) notFound();
  const d: any = await db.selectOne('SELECT id, name FROM departments WHERE id = ?', [toInt(ctx.get.d)]);
  if (!d) notFound();
  let q = 'SELECT r.id, name FROM registers r JOIN register_access ra ON r.id = ra.register WHERE r.status = 2 AND ra.department = ?';
  const a: any[] = [d.id];
  if (S.user.department != 10) { q += ' AND ra.department = ?'; a.push(S.user.department); }
  q += ' ORDER BY name ASC';
  const rows = await db.selectAll(q, a);
  const title = `${d.name} Registers`;
  return {
    metaTitle: title, pageTitle: title, metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>
	${rows.length ? `<ul class="list dividers link-list">${rows.map((r: any) => `<li data-url="register?id=${r.id}">${esc(r.name)}</li>`).join('')}</ul>` : noData('Registers')}</div></div></div></section>`,
    js: `<script type="module">import { initLinksList } from './js/functions.mjs?v=${V}'; initLinksList();</script>`,
  };
}
