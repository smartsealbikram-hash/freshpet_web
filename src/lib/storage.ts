import fs from 'fs/promises';
import path from 'path';
import { v2 as cloudinary } from 'cloudinary';

/**
 * File storage for everything users upload or the app generates (photos, signatures, PDFs, letters, exports ...).
 *
 *  - Cloudinary (when CLOUDINARY_URL, or CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET, is set):
 *    files are stored as "raw" assets (byte-for-byte, no transformation) with `type: authenticated`, so they can only be fetched
 *    with a signed request made by this server. The public id is the same relative path the database already stores
 *    (e.g. docs/jobs/74/offer.pdf), so no database value has to change.
 *  - Otherwise the local ./storage folder is used (development).
 *
 * Public files (the site logos) use `type: upload` and are readable by anyone.
 */
export const STORAGE_DIR = path.join(process.cwd(), 'storage');
export const PUBLIC_DIR = path.join(process.cwd(), 'public');

interface Cfg { cloud_name: string; api_key: string; api_secret: string }
let cfg: Cfg | null | undefined;
function config(): Cfg | null {
  if (cfg !== undefined) return cfg;
  const e = process.env;
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec((e.CLOUDINARY_URL ?? '').trim());
  if (m) cfg = { api_key: m[1], api_secret: m[2], cloud_name: m[3] };
  else if (e.CLOUDINARY_CLOUD_NAME && e.CLOUDINARY_API_KEY && e.CLOUDINARY_API_SECRET) cfg = { cloud_name: e.CLOUDINARY_CLOUD_NAME, api_key: e.CLOUDINARY_API_KEY, api_secret: e.CLOUDINARY_API_SECRET };
  else cfg = null;
  if (cfg) cloudinary.config({ ...cfg, secure: true });
  return cfg;
}
export const cloudEnabled = () => config() !== null;

/** relative path, no leading slash, no traversal */
export function cleanRel(rel: string): string {
  const r = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  if (r.split('/').some((p) => p === '..' || p === '')) throw new Error('Invalid file path');
  return r;
}
/** Cloudinary public ids are restricted; encode anything outside [A-Za-z0-9._/-] as ~XX (deterministic and reversible). */
export function publicId(rel: string): string {
  return cleanRel(rel).replace(/[^A-Za-z0-9._/-]/g, (c) => [...Buffer.from(c, 'utf8')].map((b) => '~' + b.toString(16).padStart(2, '0')).join(''));
}
const TYPE = (isPublic?: boolean) => (isPublic ? 'upload' : 'authenticated');
const localPath = (rel: string, isPublic?: boolean) => path.join(isPublic ? PUBLIC_DIR : STORAGE_DIR, cleanRel(rel));

function signedUrl(rel: string, isPublic?: boolean) {
  return cloudinary.url(publicId(rel), { resource_type: 'raw', type: TYPE(isPublic), sign_url: !isPublic, secure: true });
}

async function retry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e: any) { last = e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  throw new Error(`File storage failed: ${last?.error?.message ?? last?.message ?? last}`);
}

/** Cloudinary needs a moment before a new file can be read; wait until it can (so a read right after a save never says "not found"). */
async function waitVisible(rel: string, isPublic?: boolean) {
  for (let i = 0; i < 25; i++) {
    const r = await fetch(signedUrl(rel, isPublic) + (isPublic ? '?' : '&') + 'v=' + i + Date.now().toString(36)).catch(() => null);
    await r?.body?.cancel().catch(() => {});
    if (r?.ok) return;
    await new Promise((res) => setTimeout(res, 400));
  }
}

/** Save (or replace) a file. `wait: false` skips waiting until it is readable (bulk migration). */
export async function putFile(rel: string, data: Buffer, opts: { public?: boolean; wait?: boolean } = {}): Promise<void> {
  if (!config()) {
    const abs = localPath(rel, opts.public);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, data);
    return;
  }
  await retry(() => new Promise<void>((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { resource_type: 'raw', type: TYPE(opts.public), public_id: publicId(rel), overwrite: true, invalidate: true, use_filename: false, unique_filename: false },
      (err, res) => (err || !res ? reject(err ?? new Error('no response')) : resolve()),
    ).end(data);
  }));
  if (opts.wait !== false) await waitVisible(rel, opts.public);
}

/** Read a file, or null when it does not exist. */
export async function getFile(rel: string, opts: { public?: boolean } = {}): Promise<Buffer | null> {
  if (!config()) {
    try { return await fs.readFile(localPath(rel, opts.public)); } catch { return null; }
  }
  const r = await retry(() => fetch(signedUrl(rel, opts.public)));
  if (r.status === 404 || r.status === 401 || r.status === 403) return null;
  if (!r.ok) throw new Error(`File storage failed: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export async function fileExists(rel: string, opts: { public?: boolean } = {}): Promise<boolean> {
  return (await fileSize(rel, opts)) !== null;
}

/** First free name in `dir`: `name.ext`, `name-1.ext`, ... (same scheme the original app used). */
export async function uniqueName(dir: string, base: string, ext: string): Promise<string> {
  const d = dir.replace(/\/+$/, '');
  let name = ext ? `${base}.${ext}` : base, c = 1;
  while (await fileExists(`${d}/${name}`)) name = ext ? `${base}-${c++}.${ext}` : `${base}-${c++}`;
  return name;
}

export async function deleteFile(rel: string, opts: { public?: boolean } = {}): Promise<void> {
  if (!config()) { await fs.rm(localPath(rel, opts.public), { force: true }); return; }
  await cloudinary.uploader.destroy(publicId(rel), { resource_type: 'raw', type: TYPE(opts.public), invalidate: true });
}

/** Delete every file below a folder (used to clear old exports). */
export async function deleteFolderFiles(dirRel: string): Promise<void> {
  const dir = cleanRel(dirRel).replace(/\/+$/, '');
  if (!config()) {
    const abs = localPath(dir);
    await fs.mkdir(abs, { recursive: true });
    for (const f of await fs.readdir(abs)) await fs.rm(path.join(abs, f), { force: true }).catch(() => {});
    return;
  }
  await cloudinary.api.delete_resources_by_prefix(publicId(dir) + '/', { resource_type: 'raw', type: 'authenticated', invalidate: true }).catch(() => {});
}

/** URL for a public file (logos): the Cloudinary CDN address. */
export function publicUrl(rel: string): string | null {
  const c = config();
  return c ? `https://res.cloudinary.com/${c.cloud_name}/raw/upload/${publicId(rel)}` : null;
}

/**
 * Size in bytes of a stored file, or null when it does not exist.
 * Uses a GET (and drops the body) rather than HEAD: the CDN caches "not found" answers to HEAD requests, which made a file look
 * missing right after it had been uploaded.
 */
export async function fileSize(rel: string, opts: { public?: boolean } = {}): Promise<number | null> {
  if (!config()) return fs.stat(localPath(rel, opts.public)).then((s) => s.size, () => null);
  const r = await retry(() => fetch(signedUrl(rel, opts.public) + (signedUrl(rel, opts.public).includes('?') ? '&' : '?') + 'chk=' + Date.now().toString(36)));
  if (!r.ok) { await r.body?.cancel().catch(() => {}); return null; }
  const n = Number(r.headers.get('content-length'));
  await r.body?.cancel().catch(() => {});
  return Number.isFinite(n) && n > 0 ? n : (await getFile(rel, opts))?.length ?? null;
}
