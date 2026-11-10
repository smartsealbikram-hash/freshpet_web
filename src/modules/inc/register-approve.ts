import { Ctx, exit } from '@/lib/ctx';
import { registerApprovalButtons, toInt } from '@/lib/functions';

/**
 * NOTE: inc/register-approve.php was referenced by register.php but is not present in the exported
 * source, so this endpoint is reconstructed from registerApprovalButtons() (approvals JSON = [{staff, decision}],
 * locked once `number_of_approvals_required` decisions exist). Review against your server's copy if you have it.
 */
export default async function (ctx: Ctx) {
  const { db, post, S } = ctx;
  if (!ctx.isLoggedIn) exit(new Response('', { status: 401 }));
  const entry: any = await db.selectOne('SELECT * FROM register_data WHERE id = ?', [toInt(post.entry)]);
  const register: any = entry && (await db.selectOne('SELECT * FROM registers WHERE id = ? AND status = 2', [entry.register]));
  if (!entry || !register || register.approving_staff_role != S.user.role || entry.approvals_locked)
    return exit(new Response('Not allowed', { status: 403 }));
  const approvals: any[] = entry.approvals ? JSON.parse(entry.approvals) : [];
  if (approvals.some((a) => a.staff == S.user.id)) return exit(new Response('Already decided', { status: 400 }));
  approvals.push({ staff: S.user.id, decision: post.action === 'approve' ? 1 : 0 });
  const locked = approvals.length >= register.number_of_approvals_required || post.action !== 'approve' ? 1 : 0;
  await db.update('register_data', { approvals: JSON.stringify(approvals), approvals_locked: locked }, 'id = ?', [entry.id]);
  entry.approvals = JSON.stringify(approvals);
  entry.approvals_locked = locked;
  return exit(new Response(registerApprovalButtons(ctx, register, entry), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
}
