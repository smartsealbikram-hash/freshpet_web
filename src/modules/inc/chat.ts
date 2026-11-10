import { Ctx, exit } from '@/lib/ctx';
import { date, strtotime } from '@/lib/php';
import { esc } from '@/lib/html';

const text = (s: string) => new Response(s, { headers: { 'content-type': 'text/html; charset=utf-8' } });

export default async function (ctx: Ctx) {
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (ctx.post.action === 'load-chat') {
    const chat: any = await ctx.db.selectOne('SELECT id FROM chats WHERE user_1 = 0 AND user_2 = ?', [ctx.userId]);
    if (!chat) return exit(text('<h3 class="error-color">No conversation has been started with FAI yet.</h3>'));
    const messages = await ctx.db.selectAll('SELECT * FROM chat_messages WHERE chat = ? ORDER BY id DESC LIMIT 50', [chat.id]);
    let out = '';
    let unread = false;
    for (const row of messages) {
      out += `<li class="${row.sender == ctx.userId ? 'mine' : 'their'}">
				<div class="msg">${esc(row.message)}</div>
				<small class="timestamp">${date('d M Y h:i A', strtotime(row.date_sent) as number)}</small>
			</li>`;
      if (!row.is_read) unread = true;
    }
    if (unread) await ctx.db.update('chat_messages', { is_read: 1 }, 'chat = ?', [chat.id]);
    return exit(text(out));
  }
  return undefined;
}
