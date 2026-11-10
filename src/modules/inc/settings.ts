import { Ctx } from '@/lib/ctx';
import { sanitize, toInt } from '@/lib/functions';

export default async function (ctx: Ctx) {
  const { post, S } = ctx;
  if (post.theme !== undefined) {
    S.theme = sanitize(post.theme);
    S.themeDefault = 1;
    ctx.session.touch();
    if (!ctx.isLoggedIn) return undefined;
    if (post.theme === 'light') S.user.settings.theme = 'light';
    else if (post.theme === 'dark') S.user.settings.theme = 'dark';
    S.user.settings.theme_default = 1;
  } else if (post.changeLocation !== undefined) {
    S.locationOverride = toInt(post.changeLocation);
    ctx.session.touch();
  }
  return undefined;
}
