import { Ctx, Page } from '@/lib/ctx';
import { date, time } from '@/lib/php';
import { P, V, halt } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (P(ctx, 'production_reports') === 0) halt('You do not have access to this item.');
  let days = '';
  for (let i = 0; i < 5; i++) {
    const t = time() - i * 86400;
    days += `<li data-url="daily-production-report?d=${date('Y-m-d', t)}"><span class="left-assist material-icons">event</span><div class="content">${date('d M, Y', t)}</div></li>`;
  }
  const years = await ctx.db.selectAll('SELECT YEAR(shift_date) year FROM production_logs GROUP BY YEAR(shift_date) ORDER BY id DESC');
  return {
    metaTitle: 'Production Reports', pageTitle: 'Production Reports', metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>
	<h3>Daily Reports</h3><ul class="list link-list left-assist">${days}<li id="get-date"><span class="left-assist material-icons">keyboard</span>Enter Date</li></ul>
	<h3 class="mt2">Monthly Reports</h3><ul class="list link-list left-assist">${years.map((r: any) => `<li data-url="yearly-production-report?y=${r.year}"><span class="left-assist material-icons">calendar_month</span><div class="content">${r.year} - ${r.year + 1}</div></li>`).join('')}</ul>
	</div></div></div></section>`,
    js: `<script type="module">
	import { initLinksList } from './js/functions.mjs?v=${V}';
	initLinksList();
	document.getElementById('get-date').addEventListener('click', () => {
		G.dialog({
			title: 'Enter Date',
			description: \`<div class="input-field"><input type="text" required><label>Select Date</label></div>\`,
			onLoad: function(d){ G(d.querySelector('.input-field input')).textInput(); G(d.querySelector('.input-field input')).datepicker({ endDate: dayjs() }); },
			confirmingAction: { text: 'Show Report', onPress: function(d){ const input = d.querySelector('input'); locationHandler('daily-production-report?d='+input.value); } },
			dismissiveAction: { text: 'Cancel' }
		});
	});
</script>`,
  };
}
