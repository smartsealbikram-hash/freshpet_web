import { Ctx, Page } from '@/lib/ctx';
import { env } from '@/lib/env';

export default async function (ctx: Ctx): Promise<Page> {
  ctx.S.current_page = `${env.SITE_URL}/admin/`;
  return {
    metaTitle: `Dashboard - ${env.SITE_NAME}`, metaDescription: '',
    css: '<style type="text/css">#dashboard .stats{ display: block; font-size: 2.6rem; color: var(--primary-color); } #dashboard .stats small{ font-size: 55%; margin-left: 0.5rem; } #dashboard .description{ color: var(--neutral-color-3); }</style>',
    content: '<section id="dashboard"><div class="container"><div id="global-msg-cont"></div><h1>Welcome</h1><p>Click on a menu item on the left to begin!</p></div></section>',
  };
}
