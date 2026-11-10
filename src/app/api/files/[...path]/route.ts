import fs from 'fs/promises';
import path from 'path';
import type { NextRequest } from 'next/server';
import { Session, SESSION_COOKIE } from '@/lib/session';
import { STORAGE_DIR } from '@/lib/functions';

// Serves user uploads from ./storage (rewritten from /docs/*, /img/registers/* ...).
// Uploads of a logged-out visitor are not exposed: a valid session is required.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.csv': 'text/csv', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  // uploads (resumes, offer letters, invoices, photos) are only for logged-in users
  const sid = req.cookies.get(SESSION_COOKIE)?.value;
  const sess = await Session.load(sid);
  if (!sess.data.user) return new Response('Unauthorized', { status: 401 });
  const { path: parts } = await params;
  const rel = parts.map(decodeURIComponent).join('/');
  const abs = path.resolve(STORAGE_DIR, rel);
  if (!abs.startsWith(path.resolve(STORAGE_DIR) + path.sep)) return new Response('Forbidden', { status: 403 });
  try {
    const buf = await fs.readFile(abs);
    return new Response(new Uint8Array(buf), { headers: { 'content-type': TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
