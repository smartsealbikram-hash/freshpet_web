import path from 'path';
import type { NextRequest } from 'next/server';
import { Session, SESSION_COOKIE } from '@/lib/session';
import { cleanRel, getFile } from '@/lib/storage';

// Serves user uploads (rewritten from /docs/*, /img/registers/* ...) from the file store (Cloudinary, or ./storage in development).
// Uploads are only for logged-in users: the browser never gets a Cloudinary link, this route fetches the file with a signed request.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.svg': 'image/svg+xml',
  '.csv': 'text/csv', '.mp4': 'video/mp4', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const sid = req.cookies.get(SESSION_COOKIE)?.value;
  const sess = await Session.load(sid);
  if (!sess.data.user) return new Response('Unauthorized', { status: 401 });
  const { path: parts } = await params;
  let rel: string;
  try { rel = cleanRel(parts.map(decodeURIComponent).join('/')); } catch { return new Response('Forbidden', { status: 403 }); }
  try {
    const buf = await getFile(rel);
    if (!buf) return new Response('Not found', { status: 404 });
    return new Response(new Uint8Array(buf), { headers: { 'content-type': TYPES[path.extname(rel).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600' } });
  } catch (e: any) {
    console.error('file read failed:', rel, e?.message);
    return new Response('File storage unavailable', { status: 502 });
  }
}
