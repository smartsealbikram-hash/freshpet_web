import { Ctx, Page } from '@/lib/ctx';
import { esc } from '@/lib/html';
import { env } from '@/lib/env';

export default async function (ctx: Ctx): Promise<Page> {
  if (!ctx.isLoggedIn) ctx.account.logout();
  const title = ctx.S.user.name;
  return {
    metaTitle: title,
    pageTitle: title,
    metaDescription: '',
    content: `<section>
	<div class="container">
		<div class="row center-aligned">
			<div class="col xs12 s10 m8">
				<ul class="list left-assist dividers link-list">
					<li class="show-on-browser"><span class="material-icons">file_download</span> <a class="install-app no-borders" href="#">Install App</a></li>
					<li><span class="material-icons">devices</span> <a href="devices" class="no-borders">Devices</a></li>
					<li><span class="material-icons">exit_to_app</span> <a href="login?logout=1" class="no-borders">Logout</a></li>
				</ul>
			</div>
		</div>
	</div>
</section>`,
    js: `<script type="module">
	import { initLinksList } from './js/functions.mjs?v=${env.VERSION}';
	initLinksList();
</script>`,
  };
  void esc;
}
