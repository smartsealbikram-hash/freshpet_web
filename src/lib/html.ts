/**
 * Tiny HTML templating: `h` auto-escapes interpolated values (unlike PHP's raw echo),
 * so ported pages are XSS-safe by default. Use raw() for trusted HTML fragments.
 */
export class Raw {
  constructor(public value: string) {}
  toString() { return this.value; }
}

export const raw = (s: any) => new Raw(s === null || s === undefined ? '' : String(s));

export function esc(v: any): string {
  if (v === null || v === undefined || v === false) return '';
  // The data was saved HTML-escaped by the original app (e.g. "L &amp; T") and its pages printed it as is, so an existing entity
  // must not be encoded a second time (same as PHP htmlspecialchars with double_encode=false).
  return String(v)
    .replace(/&(?!(?:amp|lt|gt|quot|#0?39|#\d+|#x[0-9a-f]+);)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function render(v: any): string {
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

/** html`<td>${userValue}</td>` -> Raw */
export function h(strings: TemplateStringsArray, ...values: any[]): Raw {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += render(values[i]);
  });
  return new Raw(out);
}

/** Escape for use inside a JS string literal within an inline <script>. */
export const jsStr = (v: any) => JSON.stringify(v ?? '').replace(/</g, '\\u003c');

export const hsc = esc;
export const str = (v: any) => (v instanceof Raw ? v.value : String(v ?? ''));
