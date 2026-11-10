import { Ctx, exit } from '@/lib/ctx';
import { curlRequest, sanitize } from '@/lib/functions';
import { env } from '@/lib/env';

export default async function (ctx: Ctx) {
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (ctx.post.action === 'job_status') {
    const r = await curlRequest(`${env.AI_URL}/job-status/${sanitize(ctx.post.job_id)}`, { type: 'GET', headers: ['X-API-Key: ' + env.AI_SERVER_KEY] });
    return exit(new Response(r.response_body || '{"status":"not_found"}', { headers: { 'content-type': 'application/json' } }));
  }
  return undefined;
}
