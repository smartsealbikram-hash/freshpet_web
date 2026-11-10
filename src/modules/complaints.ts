import { Ctx, Page } from '@/lib/ctx';
import { complaintStatusLegend } from '@/lib/config';
import { esc } from '@/lib/html';
import { noData } from '@/lib/functions';
import { P, V, halt } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  if (!ctx.isLoggedIn) ctx.account.logout();
  const level = P(ctx, 'complaint_tickets');
  if (level === 0) halt('You do not have access to this item.');

  let q = 'SELECT c.*, d.name as department FROM complaints c JOIN users u ON c.added_by = u.id JOIN staff_roles sr ON u.role = sr.id JOIN departments d ON sr.department = d.id ';
  const args: any[] = [];
  if (level <= 2) { q += 'WHERE c.added_by = ? '; args.push(ctx.S.user.id); }
  q += 'ORDER BY c.id DESC';
  const rows = await ctx.db.selectAll(q, args);

  return {
    metaTitle: 'Complaints',
    pageTitle: 'Complaints',
    metaDescription: '',
    content: `<section>
	<div class="container">
		<div class="row center-aligned">
			<div class="col xs12 s10 m8">
				<div id="global-msg-cont"></div>
				${rows.length
          ? `<ul class="list two-line dividers right-assist link-list">${rows.map((r: any) => `<li data-url="complaint?id=${r.id}"><div class="content">${esc(r.department)}<br><small>${esc(r.item)}</small></div><div class="right-assist"><span class="badge status-${r.status == 1 ? '1' : '2'}">${complaintStatusLegend[r.status]}</span></div></li>`).join('')}</ul>`
          : noData('Complaints')}
			</div>
		</div>
	</div>
</section>
${level >= 2 ? `<div class="fab-cont"><a href="complaint" class="fab extended"><span class="material-icons">add</span> Add New</a></div>` : ''}`,
    js: `<script type="module">
	import { initLinksList } from './js/functions.mjs?v=${V}';
	initLinksList();
</script>`,
  };
}
