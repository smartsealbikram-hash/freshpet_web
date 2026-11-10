import type { NextRequest } from 'next/server';
import { cleanRel, publicUrl } from '@/lib/storage';

// Logos uploaded in Site Settings live in Cloudinary as public files. Logos that ship with the app are static files in /public and
// win over this route; only names that do not exist there are rewritten here (see next.config.mjs, `fallback`).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  let rel: string;
  try { rel = cleanRel('img/logo/' + parts.map(decodeURIComponent).join('/')); } catch { return new Response('Forbidden', { status: 403 }); }
  const url = publicUrl(rel);
  if (!url) return new Response('Not found', { status: 404 });
  return Response.redirect(url, 302);
}
