import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { env } from '@/lib/env';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { sanitize, toInt } from '@/lib/functions';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();

  if (post['deleted-holidays'] !== undefined) {
    const response: any = {};
    try {
      if (post['deleted-holidays'] !== '') {
        const ids = String(post['deleted-holidays']).split(',').filter(Boolean).map((x) => toInt(x));
        if (ids.length) await db.delete('holidays', `id IN (${ids.map(() => '?').join(',')})`, ids);
      }
      const hid: string[] = [].concat(post['holiday-id'] ?? []);
      for (let i = 0; i < hid.length; i++) {
        const payload = { holiday_date: sanitize(post.holiday_date[i]), name: sanitize(post.name[i]) };
        if (!hid[i]) await db.insert('holidays', payload);
        else await db.update('holidays', payload, 'id = ?', [toInt(hid[i])]);
      }
      response.action = 'goback';
    } catch (e: any) {
      response.message = { type: 'warning', content: e.message };
    }
    return jsonExit(response);
  }

  const currentYear = date('Y');
  const todayTS = strtotime(ctx.today) as number;
  const entries: any[] = await db.selectAll('SELECT * FROM holidays WHERE YEAR(holiday_date) >= ? ORDER BY holiday_date', [currentYear]);
  entries.push({ eatme: true });
  let pastHdr = false, presentHdr = false;
  let list = '';
  for (const row of entries) {
    if (row.holiday_date && (strtotime(row.holiday_date) as number) <= todayTS) {
      if (!pastHdr) { list += '<li><h4>Past Holidays</h4></li>'; pastHdr = true; }
      list += `<li><div class="row mb1"><div class="col xs5">${date('d M Y', strtotime(row.holiday_date) as number)}</div><div class="col xs7">${esc(row.name)}</div></div></li>`;
    } else {
      if (!presentHdr) { list += '<li><h4>Upcoming Holidays</h4></li>'; presentHdr = true; }
      list += `<li class="item${row.eatme ? ' eat-me' : ''}">
					<input type="text" name="holiday-id[]" value="${esc(row.id ?? '')}" hidden>
					<div class="row">
						<div class="input-field col xs5"><input type="text" name="holiday_date[]" class="datepicker-future" value="${esc(row.holiday_date ?? '')}" required><label>Date</label></div>
						<div class="input-field col xs7"><input type="text" name="name[]" maxlength="30" value="${esc(row.name ?? '')}" required><label>Name</label></div>
					</div>
					<button type="button" class="btn icon delete" data-itemid="${esc(row.id ?? '')}"><span class="material-icons">delete</span></button>
				</li>`;
    }
  }

  return {
    metaTitle: 'Holidays',
    pageTitle: 'Holidays',
    metaDescription: '',
    content: `<section>
	<div class="container">
		<div class="row center-aligned">
			<form method="post" class="col xs12 s10 m8 ajax">
				<ul class="dyno-content">
					<input type="text" name="deleted-holidays" hidden>
					${list}
				</ul>
				<button type="button" class="btn small tonal add-dyno"><span class="material-icons">add</span> Add Holiday</button>
				<br><br>
				<button type="submit" class="btn filled">Save</button>
			</form>
		</div>
	</div>
</section>`,
    js: `<script type="module">
	import { initInputs, initAjaxForms, initializeDyno } from './js/functions.mjs?v=${env.VERSION}';
	initializeDyno(G('.add-dyno'));
	initInputs();
	initAjaxForms();
	G('.datepicker-future').datepicker({ startDate: dayjs() });
</script>`,
  };
}
