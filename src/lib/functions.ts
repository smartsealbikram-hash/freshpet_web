import path from 'path';
import fs from 'fs/promises';
import { Ctx, UploadedFile } from './ctx';
import { env } from './env';
import { pageToTable as p2t, pageToPermission as p2p, staffPageToPermission as sp2p } from './config';
import { date, strtotime, time } from './php';
import { Raw } from './html';

export const STORAGE_DIR = path.join(process.cwd(), 'storage');

/* ------------------------------------------------------------------ strings */
export function generatePassword(alpha = true, length = 8): string {
  const chars = alpha ? '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ' : '0123456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function sanitize(data: any, expected: 'text' | 'html' | 'none' | 'email' | 'number' | 'url' = 'text'): string {
  let s = data === null || data === undefined ? '' : String(data);
  s = s.trim();
  s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  if (expected === 'html' || expected === 'none') {
    s = s.replace(/<([^<\/>]*)>(\s*?)<\/\1>/gi, ''); // empty tags
  } else {
    s = s.replace(/<[^>]*>?/g, ''); // strip_tags
    if (expected === 'email') s = s.replace(/[^a-zA-Z0-9.!#$%&'*+/=?^_`{|}~@\[\]-]/g, '').toLowerCase();
    else if (expected === 'number') s = s.replace(/[^0-9+\-.eE]/g, '');
    else if (expected === 'url') s = s.replace(/[^a-zA-Z0-9$\-_.+!*'(),{}|\\^~\[\]`<>#%";\/?:@&=]/g, '');
  }
  return s;
}
export const sanitizeNum = (d: any) => sanitize(d, 'number');
/** like PHP (int) cast after sanitize('number') */
export const toInt = (d: any) => parseInt(sanitize(d, 'number'), 10) || 0;

export function permalink(str: string, replace: string[] = [], delimiter = '-') {
  if (replace.length) for (const r of replace) str = str.split(r).join(' ');
  let clean = str.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  clean = clean.replace(/[^a-zA-Z0-9\/_|+ -]/g, '');
  clean = clean.replace(/^-+|-+$/g, '').toLowerCase();
  return clean.replace(/[\/|_+ -]+/g, delimiter);
}
export const sentenceCase = (s: string) => { const t = String(s).replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
export const snakeCase = (s: string) => String(s).replace(/ /g, '_').toLowerCase();
export const compare = (one: any, two: any, term: string) => (Array.isArray(two) ? (two.includes(one) ? term : '') : one == two ? term : '');

export function timeSince(date1: string, date2: string | null = null, threshold = 10080, format = 'd M Y h:i A') {
  const d1 = strtotime(date1) as number;
  const d2 = date2 === null ? time() : (strtotime(date2) as number);
  const diff = Math.abs(d2 - d1);
  if (diff < threshold * 60) {
    const chunks: [number, string][] = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute'], [1, 'second']];
    let count = 0, name = 'second';
    for (const [secs, n] of chunks) { count = Math.floor(diff / secs); name = n; if (count !== 0) break; }
    let out = count === 1 ? `1 ${name}` : `${count} ${name}s`;
    if (d2 > d1) out += ' ago';
    return out;
  }
  return date(format, d1);
}

export function noData(text: string) {
  return `<div class="center">
			<img src="img/no-data.png">
			<h3 class="mb0">Nothing yet</h3>
			<p class="neutral-color-2">${text} will appear here</p>
		</div>`;
}

export function getFinancialYear() {
  let year = parseInt(date('y'), 10);
  if (parseInt(date('m'), 10) <= 3) year--;
  return year;
}

export function calculateSalary(inputs: Record<string, any>) {
  const i: Record<string, number> = {};
  for (const k of Object.keys(inputs)) i[k] = inputs[k] === '' || inputs[k] == null ? 0 : Number(inputs[k]);
  const gross = i.basic_salary + i.hra + i.ta + i.sa;
  const deductions = i.pf + i.esi + i.tds;
  const totalYearly = gross * 12;
  const totalBenefits = i.le + i.cpf + i.cesi;
  const ctcAnnual = totalYearly + totalBenefits;
  return {
    gross, deductions, netInHand: gross - deductions, totalYearly, totalBenefits, ctcAnnual,
    ctcMonthly: Math.round(ctcAnnual / 12).toLocaleString('en-US'),
  };
}

/* ---------------------------------------------------------------- page bits */

/**
 * The SPA router (router.min.js) hoists a page script's imports with /(import .*\n)/g, so every `import ... from '...';`
 * must end its own line. Ported pages sometimes put code on the same line; split them.
 */
export function fixModuleScripts(html: string): string {
  return html.replace(/(<script\b[^>]*type="module"[^>]*>)([\s\S]*?)(<\/script>)/g, (_m, open, body, close) => {
    const fixed = body.replace(/(import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+(['"])[^'"\n]+\2[ \t]*;)[ \t]*(?=[^\s])/g, '$1\n');
    return `${open}${fixed}${close}`;
  });
}

/** insertPageContents(): tags css/js so the SPA router can remove them on navigation */
export function insertPageContents(page: any, type: 'css' | 'js'): string {
  if (!page || page[type] === undefined || page[type] === null) return '';
  let payload = String(page[type]);
  if (type === 'js') payload = fixModuleScripts(payload);
  if (type === 'css') {
    payload = payload.replace(/<(link|style).*?>/g, (m, tag) =>
      m.includes('class="') ? m.replace('class="', 'class="page-css ') : m.replace(`<${tag}`, `<${tag} class="page-css"`));
  } else {
    payload = payload.replace(/<script.*?>/g, (m) => {
      if (m.includes('src=')) return m;
      if (m.includes('class="')) return m.replace('class="', 'class="page-js ');
      return m.replace('<script', '<script class="page-js"');
    });
  }
  return payload;
}

/* ------------------------------------------------------------ permissions */
export function pageToTable(page: string) { return p2t[page] ?? page; }
export function pageToPermission(page: string, staff = 0) {
  if (staff && sp2p[page]) return sp2p[page];
  if (!staff && p2p[page]) return p2p[page];
  return page;
}

/** Admin permission matrix: JSON like [view, edit, add, delete, "0-*"] */
export function hasAccess(ctx: Ctx, type: 'view' | 'edit' | 'add' | 'delete' | 'rows', page: string): any {
  const u = ctx.S.user;
  if (!u || u.access_level < 4) return false;
  let level: any;
  try { level = JSON.parse(u.permissions?.[page]); } catch { return false; }
  if (!Array.isArray(level)) return false;
  if (type === 'rows') {
    if (level[4] == '0-*' || level[4] == '*-*') return true;
    return String(level[4]).split('-');
  }
  const idx = { view: 0, edit: 1, add: 2, delete: 3 }[type];
  return level[idx] == 1;
}

export async function hasAccessToRow(ctx: Ctx, id: number, page: string): Promise<boolean> {
  const access = hasAccess(ctx, 'rows', page);
  if (access === true) return true;
  if (!access) return false;
  if (access[0] === '*') {
    const last: any = await ctx.db.selectOne(`SELECT id FROM ${page} ORDER BY id DESC LIMIT 1`);
    return id >= last.id - Number(access[1]);
  }
  if (access[1] === '*') return id >= Number(access[0]);
  return id >= Number(access[0]) && id <= Number(access[1]);
}

/** Staff permission accessor: $_SESSION['user']['permissions'][$p]['access'] */
export const staffAccess = (ctx: Ctx, perm: string): number => Number(ctx.S.user?.permissions?.[perm]?.access ?? 0);

/* ------------------------------------------------------------ integrations */
export async function curlRequest(url: string, opts: { type?: string; timeout?: number; headers?: string[] | Record<string, string>; body?: any } = {}) {
  const type = opts.type ?? 'POST';
  const headers: Record<string, string> = {};
  if (Array.isArray(opts.headers)) for (const hline of opts.headers) { const i = hline.indexOf(':'); headers[hline.slice(0, i).trim()] = hline.slice(i + 1).trim(); }
  else Object.assign(headers, opts.headers ?? {});
  let u = url;
  let body: any;
  if (type === 'GET' && opts.body) u += '?' + new URLSearchParams(opts.body).toString();
  else if (type !== 'GET' && opts.body !== undefined) body = typeof opts.body === 'string' || opts.body instanceof FormData ? opts.body : new URLSearchParams(opts.body);
  try {
    const r = await fetch(u, { method: type, headers, body, signal: AbortSignal.timeout((opts.timeout ?? 30) * 1000) });
    return { response_code: r.status, response_body: await r.text() };
  } catch (e: any) {
    return { response_code: 0, response_body: String(e?.message ?? e) };
  }
}

export async function sendWhatsapp(phone: string, _template: string, variables: string[]) {
  if (!phone.startsWith('91')) phone = '91' + phone;
  if (!env.WHATSAPP_KEY) { console.log(`[whatsapp:disabled] ${phone} -> ${variables.join(',')}`); return false; }
  const r = await curlRequest('https://app.messageautosender.com/api/v1/message/create', {
    headers: ['accept: application/json', 'Content-Type: application/json', 'x-api-key: ' + env.WHATSAPP_KEY],
    body: JSON.stringify({ receiverMobileNo: phone, message: [`Greetings!\nPlease find details for your application\nApp No.: ${variables[0]}\nRegards\nTeam Freshpet`] }),
  });
  return r.response_code === 200;
}

export async function sendSms(params: any) {
  if (!env.PRODUCTION || !env.MSG91_KEY) { console.log('[sms:disabled]', JSON.stringify(params)); return true; }
  const r = await curlRequest('https://api.msg91.com/api/v5/flow/', { headers: ['authkey: ' + env.MSG91_KEY, 'content-type: application/json'], body: JSON.stringify(params) });
  try { return JSON.parse(r.response_body).type === 'success'; } catch { return false; }
}

let transporter: any;
export async function sendmail(ctx_or_recipients: any, subjectOrRecipients?: any, contentOrSubject?: any, maybeFrom?: any): Promise<boolean> {
  // Allows both sendmail(recipients, subject, content) and sendmail(ctx, recipients, subject, content)
  let recipients: any, subject: string, content: any, from: string | undefined;
  if (ctx_or_recipients instanceof Ctx) { recipients = subjectOrRecipients; subject = contentOrSubject; content = maybeFrom; }
  else { recipients = ctx_or_recipients; subject = subjectOrRecipients; content = contentOrSubject; from = maybeFrom; }
  const list: string[] = (Array.isArray(recipients) ? recipients : [recipients]).filter(Boolean);
  const body = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;border:1px solid #ccc;border-top:5px solid #f08427;border-radius:20px 20px 0 0">
    ${content.img ? `<div style="text-align:center">${content.img}</div>` : ''}
    <div style="padding:20px">${content.text}</div>
    ${content.link ? `<div style="padding:20px;text-align:center"><a href="${content.link}" style="background:#f08427;color:#fff;border-radius:20px;padding:8px 24px;text-decoration:none">${content['link-title']}</a></div>` : ''}
    <div style="text-align:center;color:#888;border-top:1px solid #ccc;padding:30px 20px"><h3 style="margin:0">${env.SITE_NAME}</h3><p style="font-size:12px">${env.SITE_URL}</p></div></div>`;
  if (!env.SMTP_HOST) { console.log(`[mail:disabled] to=${list.join(',')} subject=${subject}`); return true; }
  const nodemailer = (await import('nodemailer')).default;
  transporter ??= nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined });
  try {
    for (const to of list)
      await transporter.sendMail({ from: from ? (from.includes(',') ? `"${from.split(',')[1]}" <${from.split(',')[0]}>` : from) : `"${env.SITE_NAME}" <${env.MAILFROM}>`, to, subject: `${subject} - ${env.SITE_NAME}`, html: body, attachments: content.attachment ? [{ filename: content.attachment.name, path: content.attachment.path + content.attachment.name }] : undefined });
    return true;
  } catch (e: any) {
    console.error('Failed to send mail:', e?.message);
    return false;
  }
}

let fcm: any;
export async function sendNotification(ctx: Ctx, devices: string[], title: string, body: string, link = '', channel = '') {
  if (!devices.length) return;
  if (!env.PRODUCTION || !env.FIREBASE_SERVICE_ACCOUNT) { console.log(`[push:disabled] ${title} :: ${body} :: ${link} -> ${devices.length} device(s)`); return; }
  try {
    if (!fcm) {
      const mod: any = await import('firebase-admin');
      const admin: any = mod.default ?? mod;
      const cred = JSON.parse(await fs.readFile(env.FIREBASE_SERVICE_ACCOUNT, 'utf8'));
      const app = admin.apps.length ? admin.app() : admin.initializeApp({ credential: admin.credential.cert(cred) });
      fcm = admin.messaging(app);
    }
    const target = link || env.SITE_URL;
    const res = await fcm.sendEachForMulticast({
      tokens: devices,
      notification: { title, body },
      webpush: { notification: { title, body, icon: `${env.SITE_URL}/img/logo/favicon-192.png` }, fcmOptions: { link: target } },
      android: { notification: { title, body, ...(channel ? { channelId: channel } : {}) } },
      apns: { headers: { 'apns-priority': '10' }, payload: { aps: { alert: { title, body } }, link: target } },
    });
    for (let i = 0; i < res.responses.length; i++) {
      const code = res.responses[i].error?.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token')
        await ctx.db.update('user_devices', { tag: null }, 'tag = ?', [devices[i]]).catch(() => {});
    }
  } catch (e: any) {
    console.error('Push notification failed:', e?.message);
  }
}

export async function notifyGroup(ctx: Ctx, groupType: 'department' | 'role', groupId: number, perm: string, level: number, title: string, desc: string, url: string) {
  let q = `SELECT DISTINCT tag FROM user_devices ud JOIN users u ON ud.user = u.id JOIN staff_permissions sp ON u.role = sp.role AND sp.type = ?`;
  let w = ` WHERE u.status = 2 AND access_level = 3 AND sp.access >= ? AND tag IS NOT NULL`;
  const args: any[] = [perm, level];
  if (groupType === 'department') { q += ' JOIN staff_roles sr ON u.role = sr.id'; w += ' AND sr.department = ?'; }
  else w += ' AND u.role = ?';
  args.push(groupId);
  const users = await ctx.db.selectAll(q + w, args);
  if (users.length) await sendNotification(ctx, users.map((r: any) => r.tag), title, desc, url);
}

export async function notifyForApproval(ctx: Ctx, perm: string, title: string, desc: string, url: string, targetDept: number | null = null): Promise<false | void> {
  if (targetDept === null) targetDept = ctx.S.user.permissions?.[perm]?.access == 3 ? 10 : ctx.S.user.department;
  const hod = await ctx.db.selectAll(
    `SELECT u.id FROM users u JOIN staff_permissions sp ON u.role = sp.role AND sp.type = ? JOIN staff_roles sr ON u.role = sr.id WHERE u.status = 2 AND access_level = 3 AND sp.access = 3 AND sr.department = ?`,
    [perm, targetDept]
  );
  if (hod.length) {
    const devices: string[] = [];
    for (const r of hod) for (const d of await ctx.db.selectAll('SELECT tag FROM user_devices WHERE user = ? AND tag IS NOT NULL', [r.id])) devices.push(d.tag);
    if (devices.length) await sendNotification(ctx, devices, title, desc, url);
  } else if (targetDept !== 10) return notifyForApproval(ctx, perm, title, desc, url, 10);
  else return false;
}

export async function loadAdminsToNotify(ctx: Ctx, permission: string, comm: number) {
  const rows = await ctx.db.selectAll(
    `SELECT * FROM ( SELECT u.id, email, p.${permission} AS perm, email_enabled, sms_enabled, push_enabled, ROW_NUMBER() OVER( PARTITION BY u.id ORDER BY IF(u.id = p.user, 0, 1) ) AS RowNum FROM users u JOIN permissions p ON u.id = p.user OR u.access_level = p.id LEFT JOIN comm_settings cs ON u.id = cs.user AND comm = ? WHERE access_level >= 4 AND status = 2 ) c WHERE RowNum = 1`,
    [comm]
  );
  const out = { email: [] as string[], push: [] as string[] };
  for (const r of rows) {
    let lvl: any; try { lvl = JSON.parse(r.perm); } catch { continue; }
    if (lvl?.[0] == 1) {
      if (r.email_enabled) out.email.push(r.email);
      if (r.push_enabled) for (const d of await ctx.db.selectAll('SELECT tag FROM user_devices WHERE user = ? AND tag IS NOT NULL', [r.id])) out.push.push(d.tag);
    }
  }
  return out;
}

/* ---------------------------------------------------------------- approvals */
export function approvalEntityTable(page: string): [string, string] {
  if (page === 'leaves' || page === 'gate_passes') return ['leave_applications', 'user'];
  return [page, 'created_by'];
}

export async function getApprovals(ctx: Ctx, entityType: string, entityId: number, num: number, department: number | null = null, width = 'normal') {
  const res = { totalApprovals: num, approved: 0, rejected: 0, html: '' };
  const rows = await ctx.db.selectAll('SELECT a.*, u.name FROM approvals a JOIN users u ON a.user = u.id WHERE entity_type = ? AND entity_id = ?', [entityType, entityId]);
  for (const r of rows) r.decision ? res.approved++ : res.rejected++;

  let canApprove = false;
  if (res.approved + res.rejected < num) {
    const permission = pageToPermission(entityType, 1);
    const [table, col] = approvalEntityTable(entityType);
    if (ctx.S.user.permissions?.[permission]?.access == 3 && !(department !== null && department != ctx.S.user.department)) {
      const ent = await ctx.db.selectOne(`SELECT id FROM ${table} WHERE id = ? AND ${col} = ?`, [entityId, ctx.S.user.id]);
      if (!ent) canApprove = true;
    }
  }
  const esc = (s: any) => String(s ?? '').replace(/&(?!(?:amp|lt|gt|quot|#0?39|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let html = '<div class="card mb1"><div class="content"><div class="row center center-aligned">';
  for (let i = 0; i < num; i++) {
    html += `<div class="col xs6${width === 'normal' ? ' s4 l3' : ''}">`;
    const a = rows[i];
    if (a?.id) {
      if (a.user == ctx.S.user.id) canApprove = false;
      html += a.decision ? '<span class="material-icons font2 success-color">check_circle</span><h4>Approved' : '<span class="material-icons font2 error-color">cancel</span><h4>Rejected';
      if (a.remarks) html += ` <button type="button" class="btn icon small"><span class="material-icons tooltip" title="${esc(a.remarks)}">message</span></button>`;
      html += `</h4><p class="neutral-color-1">By ${esc(a.name)} • ${date('d M Y', strtotime(a.date_decided) as number)}</p>`;
    } else {
      html += '<span class="material-icons font2 neutral-color-3">hourglass_top</span><h4 class="neutral-color-3">Waiting for Approval</h4>';
      if (canApprove) {
        const d = `data-entity-type="${esc(entityType)}" data-entity-id="${entityId}"`;
        html += `<button type="button" class="btn filled small success-bg mgmt-decision" data-decision="Approve" ${d}>Approve</button>
					<button type="button" class="btn filled small error-bg mgmt-decision" data-decision="Reject" ${d}>Reject</button>`;
        canApprove = false;
      }
    }
    html += '</div>';
  }
  html += '</div></div></div>';
  res.html = html;
  return res;
}

export function registerApprovalButtons(ctx: Ctx, register: any, row: any) {
  let approvals: any[] = [];
  if (!row.approvals) for (let i = 0; i < register.number_of_approvals_required; i++) approvals.push({});
  else {
    approvals = JSON.parse(row.approvals);
    for (let i = 0; i < register.number_of_approvals_required - approvals.length; i++) approvals.push({});
  }
  let out = '';
  let selfDecided = false;
  for (const v of approvals) {
    out += '<button type="button" class="btn-icon';
    if (v.staff !== undefined) out += v.decision ? ' success-color' : ' error-color';
    if (!row.approvals_locked) {
      if (register.approving_staff_role == ctx.S.user.role) {
        if (v.staff !== undefined) {
          if (v.staff == ctx.S.user.id) { out += ` register-approve" data-id="${row.id}"`; selfDecided = true; }
          else out += '" disabled';
        } else if (selfDecided) out += '" disabled';
        else { out += ` register-approve" data-id="${row.id}"`; selfDecided = true; }
      } else out += '" disabled';
    } else out += '" disabled';
    out += '><span class="material-icons">';
    out += v.staff !== undefined ? (v.decision ? 'thumb_up' : 'thumb_down') : 'thumbs_up_down';
    out += '</span></button>';
  }
  return out;
}

/* ------------------------------------------------------------------ uploads */
export interface UploadCfg { maxSize: number; width?: number; height?: number; tree?: number; prefix?: string; suffix?: string }

/**
 * Port of uploadImage(): saves images (jpg/png/gif/webp) under ./storage/<saveLocation>, shrinking to maxSize (KB).
 * Returns [{path, filename}] or false with a flash message set.
 */
export async function uploadImage(ctx: Ctx, files: UploadedFile[], saveLocation: string, cfg: UploadCfg | number, overwrite = false) {
  const sharp = (await import('sharp')).default;
  let maxSize: number, maxW = 1920, maxH = 1080, tree = 0, prefix = '', suffix = '';
  if (typeof cfg === 'object') { maxSize = cfg.maxSize * 1024; maxW = cfg.width ?? maxW; maxH = cfg.height ?? maxH; tree = cfg.tree ?? 0; prefix = cfg.prefix ?? ''; suffix = cfg.suffix ?? ''; }
  else maxSize = cfg * 1024;
  const okMime = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const okExt = ['jpeg', 'jpg', 'png', 'gif', 'webp'];
  const vault: { path: string; filename: string }[] = [];
  saveLocation = saveLocation.replace(/\/+$/, '') + '/';

  for (const f of files) {
    if (!f || !f.size) continue;
    const lower = f.name.toLowerCase();
    const parts = lower.split('.');
    const ext = parts.pop() as string;
    let name = parts.join('.');
    let dir = saveLocation;
    if (tree) {
      const letters = name.split('');
      let t = tree;
      for (let j = 0; j < t; j++) {
        if (letters[j] !== undefined) {
          if (/[^a-zA-Z0-9]/.test(letters[j])) { letters.splice(j, 1); name = name.slice(0, j) + name.slice(j + 1); t++; j--; continue; }
          dir += letters[j] + '/';
        } else { name += '0'; dir += '0/'; }
      }
    }
    let safe = prefix + name.replace(/[^a-zA-Z0-9.-]+/g, '-') + suffix;
    if (!okMime.includes(f.type) || !okExt.includes(ext)) {
      ctx.flash('error', 'Image is not in a valid format. Upload jpg, webp, png or gif files only');
      return false;
    }
    const abs = path.join(STORAGE_DIR, dir);
    await fs.mkdir(abs, { recursive: true });
    if (!overwrite) {
      let c = 1;
      const base = safe;
      while (await fs.stat(path.join(abs, `${safe}.${ext}`)).then(() => true, () => false)) safe = `${base}-${c++}`;
    }
    const out = path.join(abs, `${safe}.${ext}`);
    let buf = f.buffer;
    try {
      if (f.size >= maxSize) {
        let img = sharp(buf, { animated: ext === 'gif' }).rotate();
        const meta = await img.metadata();
        if ((meta.width ?? 0) > maxW || (meta.height ?? 0) > maxH) img = img.resize(maxW, maxH, { fit: 'inside', withoutEnlargement: true });
        const enc = (q: number, im = img) => ext === 'png' ? im.png({ compressionLevel: 9, quality: q }) : ext === 'webp' ? im.webp({ quality: q }) : ext === 'gif' ? im.gif() : im.jpeg({ quality: q });
        buf = await enc(90).toBuffer();
        for (let q = 45; buf.length > maxSize && q >= 1; q = Math.floor(q / 2)) buf = await enc(q).toBuffer();
        // png/gif: shrink dimensions until under the limit (max 3 tries, like the original)
        let w = meta.width ?? maxW;
        for (let tries = 0; buf.length > maxSize && (ext === 'png' || ext === 'gif') && tries < 3; tries++) {
          w = Math.round(w * Math.max(0.3, (maxSize / buf.length) + 0.2));
          buf = await sharp(f.buffer).resize(w).toFormat(ext as any).toBuffer();
        }
      }
    } catch (e: any) { console.error('image optimisation failed, saving original:', e?.message); buf = f.buffer; }
    await fs.writeFile(out, buf);
    vault.push({ path: dir + `${safe}.${ext}`, filename: `${safe}.${ext}` });
  }
  return vault;
}

/** Save an arbitrary (non-image) upload e.g. PDFs/docs under ./storage */
export async function saveFile(file: UploadedFile, dir: string, filename: string) {
  const abs = path.join(STORAGE_DIR, dir);
  await fs.mkdir(abs, { recursive: true });
  await fs.writeFile(path.join(abs, filename), file.buffer);
  return path.join(dir, filename);
}

export const rawStr = (r: Raw | string) => (r instanceof Raw ? r.value : r);
