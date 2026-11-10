import type { NextRequest } from 'next/server';
import { Ctx, Exit, Page, UploadedFile, json } from './ctx';
import { Account, deviceInfo } from './account';
import { db } from './db';
import { env } from './env';
import { Session, SESSION_COOKIE } from './session';
import { date, nowStr, setPhpKey, time, todayStr } from './php';
import { renderAdminShell, renderAppShell } from './shell';
import { registry } from '@/modules';
import { Raw } from './html';
import { fixModuleScripts } from './functions';

/** Replaces the 10-minute `$_SESSION['settings']` cache from config.php */
let settingsCache: { at: number; data: Record<string, any> } | null = null;
export function clearSettingsCache() { settingsCache = null; }
async function loadSettings() {
  if (!settingsCache || time() - settingsCache.at > 600) {
    const rows = await db.selectAll('SELECT * FROM settings');
    const data: Record<string, any> = {};
    for (const r of rows) data[r._key] = r._value;
    settingsCache = { at: time(), data };
  }
  return settingsCache.data;
}

function parseCookies(header: string | null) {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore bad cookie */ }
  }
  return out;
}

async function buildCtx(req: NextRequest, area: 'app' | 'admin', route: string): Promise<Ctx> {
  const ctx = new Ctx();
  ctx.req = req;
  ctx.method = req.method;
  ctx.url = new URL(req.url);
  ctx.area = area;
  ctx.route = route;
  ctx.isSpa = req.headers.has('x-spa');
  ctx.ua = req.headers.get('user-agent') ?? '';
  ctx.ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
  ctx.cookies = parseCookies(req.headers.get('cookie'));
  ctx.now = nowStr();
  ctx.today = todayStr();
  ctx.fullUrl = env.SITE_URL + ctx.url.pathname + ctx.url.search;

  ctx.get = {};
  ctx.url.searchParams.forEach((v, k) => setPhpKey(ctx.get, k, v));
  ctx.post = {};
  ctx.files = {};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const type = req.headers.get('content-type') ?? '';
    try {
      if (type.includes('application/json')) ctx.post = await req.json();
      else if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
        const fd = await req.formData();
        for (const [k, v] of fd.entries()) {
          if (typeof v === 'string') setPhpKey(ctx.post, k, v);
          else {
            const f = v as File;
            const key = k.replace(/\[\]$/, '');
            (ctx.files[key] ??= []).push({ name: f.name, type: f.type, size: f.size, buffer: Buffer.from(await f.arrayBuffer()) } as UploadedFile);
          }
        }
      }
    } catch (e) {
      console.error('Body parse failed', e);
    }
  }

  ctx.session = await Session.load(ctx.cookies[SESSION_COOKIE]);
  ctx.S = ctx.session.data;
  ctx.settings = { ...(await loadSettings()) };
  ctx.device = deviceInfo(ctx.ua);

  const account = new Account(ctx);
  ctx.account = account;
  ctx.isLoggedIn = await account.isLoggedIn();
  if (ctx.isLoggedIn && !ctx.get.logout) {
    ctx.userId = Number(account.id);
    // every 5 minutes re-check the device / account status (force logout, deactivation)
    if (time() - (ctx.S.user.device?.last_activity ?? 0) > 5 * 60) {
      const dev: any = await db.selectOne('SELECT ud.id, u.status, force_logout FROM user_devices ud LEFT JOIN users u ON ud.user = u.id WHERE ud.id = ?', [ctx.S.user.device.id]);
      if (dev) {
        if (dev.status < 2 || dev.force_logout) {
          if (dev.force_logout) await db.update('user_devices', { force_logout: 0 }, 'id = ?', [ctx.S.user.device.id]);
          account.logout();
        }
        ctx.S.user.device.last_activity = time();
        ctx.session.touch();
      } else account.logout();
    }
  }
  if (!ctx.S.theme) {
    if (ctx.isLoggedIn && ctx.S.user?.settings?.theme) { ctx.S.theme = ctx.S.user.settings.theme; ctx.S.themeDefault = ctx.S.user.settings.theme_default ?? 1; }
    else { ctx.S.theme = 'light'; ctx.S.themeDefault = 1; }
    ctx.session.touch();
  }
  if (ctx.isLoggedIn) ctx.settings.location = ctx.S.locationOverride ?? ctx.S.user.location;
  return ctx;
}

/** Departments map ($_SESSION['departments']) */
export async function departments(ctx: Ctx) {
  const rows = await ctx.db.selectAll('SELECT id, name FROM departments WHERE status = 2');
  return Object.fromEntries(rows.map((r: any) => [r.id, r.name]));
}

function cookieHeader(name: string, value: string, o: Record<string, any>) {
  let s = `${name}=${encodeURIComponent(value)}`;
  if (o.maxAge !== undefined) s += `; Max-Age=${o.maxAge}`;
  s += `; Path=${o.path ?? '/'}`;
  if (o.httpOnly) s += '; HttpOnly';
  if (o.secure) s += '; Secure';
  s += `; SameSite=${o.sameSite ?? 'lax'}`;
  return s;
}

function resolveRoute(pathname: string): { area: 'app' | 'admin'; route: string } {
  let p = decodeURIComponent(pathname);
  let area: 'app' | 'admin' = 'app';
  if (p === '/admin' || p.startsWith('/admin/')) { area = 'admin'; p = p.slice('/admin'.length); }
  if (p === '' || p.endsWith('/')) p += 'home';
  p = p.replace(/^\/+/, '').replace(/\.php$/, '');
  return { area, route: p };
}

const NO_CURRENT = /(404|login|signup|maintenance|offline|account-nav|settings)/i;

export async function handle(req: NextRequest): Promise<Response> {
  const { pathname } = new URL(req.url);
  const { area, route } = resolveRoute(pathname);
  let ctx: Ctx | undefined;
  try {
    ctx = await buildCtx(req, area, route);
  } catch (e: any) {
    if (e instanceof Exit) {
      // buildCtx can exit (e.g. forced logout) before we have a full ctx; session saving is best-effort there
      return resultToResponse(e.result, undefined as any);
    }
    console.error('Context build failed:', e);
    return new Response('Could not connect to database.', { status: 501 });
  }

  let result: any;
  try {
    // access control that admin/index.php applies before including any admin page
    if (area === 'admin') {
      if (route !== 'login' && !ctx.isLoggedIn) ctx.account.logout();
      if (ctx.isLoggedIn && ctx.S.user.access_level < 4) return finish(ctx, new Response(null, { status: 302, headers: { location: env.SITE_URL } }));
    }
    const key = area === 'admin' ? `admin/${route}` : route;
    const loader = registry[key];
    if (!loader) {
      result = await notFound(ctx);
    } else {
      const mod = await loader();
      result = await mod.default(ctx);
      if (result && !(result instanceof Response) && !(result instanceof Raw)) {
        const page = result as Page;
        if (page.response_code) {
          if (page.response_code === 404) result = await notFound(ctx);
        } else if (!NO_CURRENT.test(ctx.fullUrl) && ctx.method === 'GET' && !ctx.isSpa) {
          ctx.S.current_page = ctx.fullUrl;
          ctx.session.touch();
        }
      }
    }
  } catch (e: any) {
    if (e instanceof Exit) result = e.result;
    else {
      console.error(`[${req.method} ${pathname}]`, e);
      const msg = env.DEBUG >= 3 ? String(e?.message ?? e) : 'An error occurred processing the request';
      result = ctx.method !== 'GET' || ctx.isSpa ? json({ error: msg }, 500) : new Response(msg, { status: 500 });
    }
  }
  return finish(ctx, result);
}

async function notFound(ctx: Ctx): Promise<Page> {
  const mod = await registry['404']();
  const page = (await mod.default(ctx)) as Page;
  page.response_code = 404;
  return page;
}

async function finish(ctx: Ctx, result: any): Promise<Response> {
  const res = await resultToResponse(result, ctx);
  try { await ctx.session.save(); } catch (e) { console.error('session save failed', e); }
  res.headers.append('set-cookie', cookieHeader(SESSION_COOKIE, ctx.session.id, { maxAge: ctx.session.destroyed ? 0 : 60 * 60 * 24 * 60, httpOnly: true, sameSite: 'lax', secure: env.SITE_URL.startsWith('https') }));
  for (const c of ctx.outCookies) res.headers.append('set-cookie', cookieHeader(c.name, c.value, c.opts));
  for (const [k, v] of Object.entries(ctx.headers)) res.headers.set(k, v);
  return res;
}

async function resultToResponse(result: any, ctx: Ctx): Promise<Response> {
  if (result instanceof Response) return result;
  if (!ctx) return json(result ?? {});
  const isPage = result && typeof result === 'object';
  // POST/AJAX/SPA calls get the page as JSON (index.php: echo json_encode($page); exit;)
  if (ctx.isSpa || ctx.method !== 'GET') {
    if (!isPage) return new Response('', { status: 200 });
    return json(normalizePage(result), result.response_code ?? 200);
  }
  const page = normalizePage(result ?? {});
  // show any flash message the previous request left behind (snackbar/banner)
  const flash = ctx.S.msg;
  if (flash && flash.content) {
    delete ctx.S.msg;
    ctx.session.touch();
    if (flash.type === 'snackbar') page.js = String(page.js ?? '') + `<script>(function w(){ if (typeof G!='undefined' && typeof G.snackbar==='function') G.snackbar(${JSON.stringify(flash.content)}); else setTimeout(w,200); })();</script>`;
    else page.content = `<div class="text-banner light mb1 ${flash.type === 'alert' || flash.type === 'error' ? 'error' : flash.type}">${flash.content}</div>` + page.content;
  }
  const html = ctx.area === 'admin' ? renderAdminShell(ctx, page) : await renderAppShell(ctx, page);
  return new Response(html, { status: result?.response_code ?? 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, no-cache, must-revalidate, max-age=0' } });
}

/** Raw instances -> strings so JSON.stringify/pages are plain */
function normalizePage(p: any): Page {
  const out: any = { ...p };
  for (const k of ['content', 'css', 'js']) if (out[k] instanceof Raw) out[k] = out[k].value;
  if (out.content === undefined) out.content = '';
  if (typeof out.js === 'string') out.js = fixModuleScripts(out.js);
  return out;
}

export { date };
