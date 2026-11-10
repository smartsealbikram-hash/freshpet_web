import { Ctx, Page } from '@/lib/ctx';

export default async function (_ctx: Ctx): Promise<Page> {
  return {
    metaTitle: 'Page not found',
    metaDescription: '',
    css: '<meta name="robots" content="noindex">',
    content: `<section>
	<div class="container center">
		<div id="global-msg-cont"><div id="global-msg-cont"></div></div>
		<h1 class="section-title">404</h1>
		<p>The page you're looking for is not available. It may have been removed or moved.</p>
	</div>
</section>`,
  };
}
