/**
 * Small PHP-compat helpers so ported code stays close to the original.
 * All dates are handled in Asia/Kolkata (fixed +05:30, no DST) regardless of server TZ.
 */
const IST = 19800; // seconds

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number, l = 2) => String(n).padStart(l, '0');

export const time = () => Math.floor(Date.now() / 1000);

/** PHP date(): format a unix timestamp (seconds) in IST. */
export function date(format: string, ts: number | false | null = time()): string {
  if (ts === false || ts === null || ts === undefined || Number.isNaN(ts)) ts = time();
  const d = new Date((ts + IST) * 1000);
  const Y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate(), w = d.getUTCDay();
  const H = d.getUTCHours(), i = d.getUTCMinutes(), s = d.getUTCSeconds();
  const h12 = H % 12 === 0 ? 12 : H % 12;
  const daysInMonth = new Date(Date.UTC(Y, m + 1, 0)).getUTCDate();
  const startOfYear = Date.UTC(Y, 0, 1);
  const z = Math.floor((Date.UTC(Y, m, day) - startOfYear) / 86400000);
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  let out = '';
  for (let k = 0; k < format.length; k++) {
    const c = format[k];
    switch (c) {
      case 'd': out += pad(day); break;
      case 'D': out += DAYS[w].slice(0, 3); break;
      case 'j': out += day; break;
      case 'l': out += DAYS[w]; break;
      case 'N': out += w === 0 ? 7 : w; break;
      case 'w': out += w; break;
      case 'z': out += z; break;
      case 'S': out += suffix; break;
      case 'F': out += MONTHS[m]; break;
      case 'm': out += pad(m + 1); break;
      case 'M': out += MONTHS[m].slice(0, 3); break;
      case 'n': out += m + 1; break;
      case 't': out += daysInMonth; break;
      case 'L': out += (Y % 4 === 0 && Y % 100 !== 0) || Y % 400 === 0 ? 1 : 0; break;
      case 'Y': out += Y; break;
      case 'y': out += String(Y).slice(-2); break;
      case 'a': out += H < 12 ? 'am' : 'pm'; break;
      case 'A': out += H < 12 ? 'AM' : 'PM'; break;
      case 'g': out += h12; break;
      case 'G': out += H; break;
      case 'h': out += pad(h12); break;
      case 'H': out += pad(H); break;
      case 'i': out += pad(i); break;
      case 's': out += pad(s); break;
      case 'U': out += ts; break;
      case 'e': out += 'Asia/Kolkata'; break;
      case 'T': out += 'IST'; break;
      case 'P': out += '+05:30'; break;
      case 'O': out += '+0530'; break;
      case 'c': out += date('Y-m-d\\TH:i:sP', ts); break;
      case '\\': k++; out += format[k] ?? ''; break;
      default: out += c;
    }
  }
  return out;
}

function mk(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  return Math.floor(Date.UTC(y, mo, d, h, mi, s) / 1000) - IST;
}

/** Subset of PHP strtotime(): ISO dates/datetimes, "d M Y", keywords and relative offsets. */
export function strtotime(input: any, base: number = time()): number | false {
  if (input === null || input === undefined) return false;
  let str = String(input).trim().toLowerCase();
  if (!str || str.startsWith('0000-00-00')) return false;
  let ts = base;
  const b = new Date((base + IST) * 1000);
  const todayMid = mk(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());

  // absolute: 2026-11-05[ T]13:45[:10]
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    ts = mk(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
    str = str.slice(m[0].length).trim();
  } else if ((m = str.match(/^(\d{1,2})[ -]([a-z]{3,9})[ ,-]+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/))) {
    const mo = MONTHS.findIndex((x) => x.toLowerCase().startsWith(m![2].slice(0, 3)));
    if (mo < 0) return false;
    let hh = +(m[4] ?? 0);
    if (m[7] === 'pm' && hh < 12) hh += 12;
    if (m[7] === 'am' && hh === 12) hh = 0;
    ts = mk(+m[3], mo, +m[1], hh, +(m[5] ?? 0), +(m[6] ?? 0));
    str = str.slice(m[0].length).trim();
  } else if ((m = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/))) {
    let hh = +m[1];
    if (m[4] === 'pm' && hh < 12) hh += 12;
    if (m[4] === 'am' && hh === 12) hh = 0;
    ts = todayMid + hh * 3600 + +m[2] * 60 + +(m[3] ?? 0);
    str = str.slice(m[0].length).trim();
  } else if (/^(now)/.test(str)) {
    str = str.replace(/^now/, '').trim();
  } else if (/^today/.test(str)) { ts = todayMid; str = str.replace(/^today/, '').trim(); }
  else if (/^midnight/.test(str)) { ts = todayMid; str = str.replace(/^midnight/, '').trim(); }
  else if (/^yesterday/.test(str)) { ts = todayMid - 86400; str = str.replace(/^yesterday/, '').trim(); }
  else if (/^tomorrow/.test(str)) { ts = todayMid + 86400; str = str.replace(/^tomorrow/, '').trim(); }
  else if (!/^[+-]?\s*\d+\s*[a-z]/.test(str) && !/^(first|last|next|previous)/.test(str)) {
    const p = Date.parse(str);
    return Number.isNaN(p) ? false : Math.floor(p / 1000);
  }

  // relative parts: "+1 day", "-2 weeks", "first day of next month", "last day of this month"
  const rel = /([+-]?\s*\d+)\s*(second|sec|minute|min|hour|day|week|month|year)s?(\s+ago)?/g;
  let r: RegExpExecArray | null;
  while ((r = rel.exec(str))) {
    let n = parseInt(r[1].replace(/\s+/g, ''), 10);
    if (r[3]) n = -n;
    const u = r[2];
    if (u === 'second' || u === 'sec') ts += n;
    else if (u === 'minute' || u === 'min') ts += n * 60;
    else if (u === 'hour') ts += n * 3600;
    else if (u === 'day') ts += n * 86400;
    else if (u === 'week') ts += n * 7 * 86400;
    else {
      const d = new Date((ts + IST) * 1000);
      const months = u === 'year' ? n * 12 : n;
      const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
      ts = Math.floor(target.getTime() / 1000) - IST;
    }
  }
  const fl = str.match(/(first|last) day of (this|next|last|previous) month/);
  if (fl) {
    const d = new Date((ts + IST) * 1000);
    const off = fl[2] === 'next' ? 1 : fl[2] === 'this' ? 0 : -1;
    const y = d.getUTCFullYear(), mo = d.getUTCMonth() + off;
    ts = fl[1] === 'first' ? mk(y, mo, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) : mk(y, mo + 1, 0, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  }
  return ts;
}

/** Date helpers returning strings in IST. */
export const nowStr = () => date('Y-m-d H:i:s');
export const todayStr = () => date('Y-m-d');

export const ucfirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const isset = (v: any) => v !== undefined && v !== null;
export const empty = (v: any) => v === undefined || v === null || v === '' || v === 0 || v === '0' || v === false || (Array.isArray(v) && v.length === 0);

/** PHP-style number_format */
export function number_format(n: any, decimals = 0, dec = '.', thou = ','): string {
  const v = Number(n) || 0;
  const fixed = Math.abs(v).toFixed(decimals);
  const [i, f] = fixed.split('.');
  const withThou = i.replace(/\B(?=(\d{3})+(?!\d))/g, thou);
  return (v < 0 ? '-' : '') + withThou + (f ? dec + f : '');
}

export function array_column<T = any>(rows: any[], col: string, indexKey?: string): any {
  if (indexKey) return Object.fromEntries(rows.map((r) => [r[indexKey], r[col]]));
  return rows.map((r) => r[col]);
}

/** Parse the keys of a multipart/urlencoded body the way PHP does (`a[]`, `a[b]`, `a[0][b]`). */
export function setPhpKey(target: Record<string, any>, key: string, value: any) {
  const m = key.match(/^([^\[]+)((?:\[[^\]]*\])*)$/);
  if (!m || !m[2]) { target[key] = value; return; }
  const parts = [m[1], ...Array.from(m[2].matchAll(/\[([^\]]*)\]/g)).map((x) => x[1])];
  let cur: any = target;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const last = i === parts.length - 1;
    if (p === '') {
      // push
      if (!Array.isArray(cur)) return;
      if (last) cur.push(value);
      else { const n: any = parts[i + 1] === '' ? [] : {}; cur.push(n); cur = n; }
    } else if (last) {
      cur[p] = value;
    } else {
      if (cur[p] === undefined || typeof cur[p] !== 'object') cur[p] = parts[i + 1] === '' ? [] : {};
      cur = cur[p];
    }
  }
}
