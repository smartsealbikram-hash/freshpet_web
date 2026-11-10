import { Ctx, Page } from '@/lib/ctx';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { noData } from '@/lib/functions';

export default async function (ctx: Ctx): Promise<Page> {
  if (!ctx.isLoggedIn) ctx.account.logout();
  const rows = await ctx.db.selectAll('SELECT * FROM holidays WHERE holiday_date >= ? ORDER BY holiday_date', [ctx.today]);
  const canAdd = Number(ctx.S.user.permissions?.holidays?.access ?? 0) >= 2;
  return {
    metaTitle: 'Holidays',
    pageTitle: 'Holidays',
    metaDescription: '',
    content: `<section>
	<div class="container">
		<div class="row center-aligned">
			<div class="col xs12 s10 m8">
				<div id="global-msg-cont"></div>
				${rows.length
          ? `<table class="edged"><tbody>${rows.map((r: any) => `<tr><td>${date('d M Y', strtotime(r.holiday_date) as number)}</td><td>${esc(r.name)}</td></tr>`).join('')}</tbody></table>`
          : noData('Holidays')}
			</div>
		</div>
	</div>
</section>
${canAdd ? `<div class="fab-cont"><a href="holiday" class="fab extended"><span class="material-icons">add</span> Add New</a></div>` : ''}`,
  };
}
