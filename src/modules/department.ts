import { Ctx, Page, exit, json, jsonExit } from '@/lib/ctx';
import { env } from '@/lib/env';
import { esc } from '@/lib/html';
import { toInt } from '@/lib/functions';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, S } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  const P = (k: string): number => Number(S.user.permissions?.[k]?.access ?? 0);

  let dId = 0;
  let pageTitle = '';
  if (ctx.get.d !== undefined) {
    dId = toInt(ctx.get.d);
    const department: any = await db.selectOne('SELECT id, name FROM departments WHERE id = ?', [dId]);
    if (!department) return exit(new Response('', { status: 404 }));
    if (dId === 4) jsonExit({ redirect: 'quality-tickets' });
    if (dId === 5) jsonExit({ redirect: 'complaints' });
    pageTitle = department.name;
  } else {
    jsonExit({ message: { type: 'error', content: 'No department found. Please select one from the list.' }, action: 'halt' });
  }

  const items: string[] = [];
  const li = (url: string, label: string) => items.push(`<li data-url="${url}">${label}</li>`);
  switch (dId) {
    case 1:
      if (P('jobs') > 0) { li('staff-accounts', 'Staff Accounts'); li('job-vacancies', 'Job Vacancies'); }
      li('tours', 'Tours'); li('leave-applications', 'Leave Applications'); li('gate-passes', 'Gate Passes'); li('holidays', 'List of Holidays');
      break;
    case 2:
      li('material-requests', 'Material Indent');
      if (P('material_requisition') > 0) li('pm-rm-requisition', 'PM &amp; RM Requisition');
      if (P('heavy_equipment') > 0) li('heavy-equipments', 'Heavy Equipment');
      break;
    case 3:
      if (P('dispatches') > 0) {
        if (S.user.department != 1) li('dispatches?t=c', 'Client Dispatches');
        if (S.user.department != 9) li('dispatches?t=w', 'Warehouse Dispatches');
      }
      break;
    case 4: if (P('quality_tickets') > 0) li('quality-tickets', 'Quality Tickets'); break;
    case 5: if (P('complaint_tickets') > 0) li('complaints', 'Complaint Tickets'); break;
    case 6:
      if (P('production_instances') > 0) {
        li('production-lots-old', 'Production Planning'); li('load-resin', 'Load Resin'); li('return-resin', 'Return Resin'); li('production-lots', 'Machines Status');
      }
      if (S.user.role == 15 || S.user.role == 17 || S.user.department == 10) li('shifts', 'Shift Timings');
      break;
    case 7:
      li('advance-salary', 'Advance Salary');
      if (P('payments') > 0) li('payments', 'Payments');
      break;
    case 8:
      if (P('receiving_notes') > 0) { li('receiving-notes?t=grn', 'GRN Register'); li('receiving-notes?t=srn', 'SRN Register'); }
      break;
    case 10:
      if (P('store_reports') > 0) li('heavy-equipments-reports', 'Heavy Equipments Reports');
      if (P('jobs') >= 3) { li('salary-reports', 'Salary Reports'); li('leave-reports', 'Leave Reports'); }
      if (P('production_reports') > 0) { li('production-reports', 'Production Reports'); li('shift-incharge-reports', 'Shift Incharge Reports'); }
      if (P('dispatch_reports') > 0) li('transportation-report', 'Transportation Reports');
      break;
  }
  if (dId === 8) li(`registers?d=${dId}`, 'Registers');

  return {
    metaTitle: pageTitle,
    pageTitle,
    metaDescription: '',
    content: `<section>
	<div class="container">
		<div class="row center-aligned">
			<div class="col xs12 s10 m8">
				<div id="global-msg-cont"></div>
				<ul class="list dividers link-list">${items.join('\n')}</ul>
			</div>
		</div>
	</div>
</section>`,
    js: `<script type="module">
	import { initLinksList } from './js/functions.mjs?v=${env.VERSION}';
	initLinksList();
</script>`,
  };
  void esc; void json;
}
