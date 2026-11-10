import { Ctx, Exit, exit, jsonExit } from './ctx';
import { esc } from './html';
import { env } from './env';

/** Shortcuts used by the ported pages */
export const V = env.VERSION;
export const SITE_URL = env.SITE_URL;

/** exit(json_encode(['message'=>..., 'action'=>'halt'])) */
export const halt = (content: string): never => jsonExit({ message: { type: 'error', content }, action: 'halt' });

/** exit('1') / echo 1 style plain responses */
export const text = (s: string | number): never => exit(new Response(String(s), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
export const textRes = (s: string | number) => new Response(String(s), { headers: { 'content-type': 'text/html; charset=utf-8' } });

export const notFound = (): never => exit(new Response('', { status: 404 }));

export const nl2br = (s: any) => esc(s).replace(/\r?\n/g, '<br>');

/** Staff permission level for a permission key */
export const P = (ctx: Ctx, perm: string): number => Number(ctx.S.user?.permissions?.[perm]?.access ?? 0);
/** Whether the staff permission is "limited" (own records only) */
export const limited = (ctx: Ctx, perm: string): boolean => Number(ctx.S.user?.permissions?.[perm]?.limited ?? 1) === 1;

/** Standard module <script type=module> that imports helpers from js/functions.mjs */
export const fnImport = (names: string) => `import { ${names} } from './js/functions.mjs?v=${V}';`;

/** Normalise a posted value to an array (PHP: $_POST['x'][] ) */
export const arr = (v: any): any[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : typeof v === 'object' ? Object.values(v) : [v]);

/** Does a posted key exist (PHP isset) */
export const has = (o: any, k: string) => o && o[k] !== undefined && o[k] !== null;

export const resp = (r: any) => jsonExit(r ?? {});
export const msgWarn = (e: any) => {
  if (e instanceof Exit) throw e; // a deliberate exit() inside a try block must not be turned into a warning
  return { message: { type: 'warning', content: e?.message ?? String(e) } };
};
