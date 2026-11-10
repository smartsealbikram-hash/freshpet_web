import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';
import { sanitize, toInt } from '@/lib/functions';

export default async function (ctx: Ctx): Promise<Page | undefined> {
  const { db, S, post } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();

  if (post.action === 'visit') {
    const deptId = toInt(post.dept);
    S.user.settings ??= {};
    S.user.settings.most_visited_depts ??= {};
    S.user.settings.most_visited_depts[deptId] = (S.user.settings.most_visited_depts[deptId] ?? 0) + 1;
    ctx.session.touch();
    try { await db.update('users', { settings: JSON.stringify(S.user.settings) }, 'id = ?', [S.user.id]); } catch { /* ignore */ }
    return jsonExit({});
  }

  const hour = parseInt(date('G'), 10);
  const location: any = await db.selectOne('SELECT name FROM locations WHERE id = ?', [ctx.settings.location]);
  const greeting = hour >= 5 && hour < 12 ? 'Good Morning' : hour >= 12 && hour < 17 ? 'Good Afternoon' : hour >= 17 && hour < 20 ? 'Good Evening' : 'Hello';
  const shift = hour >= 6 && hour < 14
    ? '<span class="material-icons">wb_twilight</span> Morning Shift'
    : hour >= 14 && hour < 22
      ? '<span class="material-icons">sunny</span> Evening Shift'
      : '<span class="material-icons">moon_stars</span> Night Shift';
  const departments = await db.selectAll('SELECT * FROM departments WHERE status = 2 ORDER BY name');
  void strtotime; void sanitize;

  return {
    metaTitle: 'FreshPet',
    pageTitle: 'FreshPet',
    metaDescription: '',
    css: `<style type="text/css">
	.navigation .back-button{ width: 0; padding: 0; opacity: 0; }
	.navigation .emblem{ display: block !important; }
	.navigation .emblem img{ background: var(--surface-color-2); border-radius: var(--border-radius-s); max-height: 2.3rem !important; }
	.navigation.top .page-title{ display: inline-flex; margin-left: 0.4rem; }
	h1.page-title{ display: none; }
	main{ margin-top: 2rem; }
	.greeting{ background: linear-gradient(75deg, var(--primary-color), var(--primary-container)); color: var(--on-primary-color); }
	.greeting small{ opacity: 0.7; }
	#right-icon{ position: absolute; right: 1rem; top: 1rem; font-size: 2rem; background: var(--primary-color); padding: 0.7rem; border-radius: var(--border-radius-s); width: auto; opacity: 0.8; }
	.greeting .footer{ background: var(--primary-color); border-radius: 0 0 var(--border-radius-m) var(--border-radius-m); padding: 0.3rem 1rem; }
	.greeting .footer p{ display: flex; justify-content: space-between; align-items: center; }
</style>`,
    content: `<section>
	<div class="container">
		<div class="row center-aligned">
			<div class="col xs12 s10 m8">
				<div id="global-msg-cont"></div>
				<div class="card greeting mb2">
					<div class="content">
						<p class="no-margin"><small>${greeting}</small></p>
						<h2 class="no-margin">${esc(location?.name)} Plant</h2>
						<span class="material-icons" id="right-icon">factory</span>
					</div>
					<div class="footer">
						<p class="no-margin">${date('D, d M Y')}<br><small>${shift}</small></p>
					</div>
				</div>
				<div class="row tiles">
					${departments.map((row: any) => `<div class="col xs6 s4 m3">
						<div class="item">
							<a href="department?d=${row.id}" data-id="${row.id}" class="waves">
								<span class="material-icons">${esc(row.icon)}</span>
								<span class="name">${esc(row.name)}</span>
							</a>
						</div>
					</div>`).join('')}
				</div>
			</div>
		</div>
	</div>
</section>`,
    js: `<script>
	G('.tiles a').on('click', e => {
		const a = e.target.closest('a');
		G.ajax({ type: 'POST', data: { action: 'visit', dept: a.dataset.id } }).then(data => {}).catch(xhr => {});
	})
</script>`,
  };
}
