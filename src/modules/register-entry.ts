import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { esc } from '@/lib/html';
import { sanitize, toInt, uploadImage } from '@/lib/functions';
import { V, arr, msgWarn, notFound } from '@/lib/h';

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post, S, now } = ctx;
  if (!ctx.isLoggedIn) ctx.account.logout();
  if (ctx.get.r === undefined) notFound();
  const id = toInt(ctx.get.r);
  let q = 'SELECT * FROM registers r JOIN register_access ra ON r.id = ra.register WHERE r.id = ? AND r.status = 2';
  const a: any[] = [id];
  if (S.user.department != 10) { q += ' AND ra.department = ?'; a.push(S.user.department); }
  const register: any = await db.selectOne(q, a);
  if (!register) notFound();

  const printFields = (rows: any[], data: any = {}) => rows.map((row) => {
    const suffix = row.multiple ? '[]' : '';
    const rnd = Math.floor(100 + Math.random() * 900);
    const value = data[row.name] ?? '';
    const nm = `${esc(row.name)}${suffix}`;
    if (row.type === 'file') {
      let o = '<div class="file-input sidelabel">';
      if (value) o += `<img src="../img/registers/${id}/${esc(value[0])}/${esc(value[1])}/${esc(value)}" class="upload-sideimage expandable"><input type="text" name="old_file_${nm}" value="${esc(value)}" hidden>`;
      return o + `<input type="file" name="${nm}" accept="image/*"><label>${esc(row.display_name)}</label><button type="button" class="btn outline">Select File</button><span class="file-name">No file selected</span></div>`;
    }
    let o = '<div class="input-field sidelabel">';
    if (row.type === 'checkbox') o += `<input type="checkbox" name="${nm}" id="check${esc(row.name)}${rnd}"${value ? ' checked' : ''}><label for="check${esc(row.name)}${rnd}">${esc(row.display_name)}</label>`;
    else {
      if (['text', 'datepicker', 'timepicker', 'number'].includes(row.type))
        o += `<input type="${row.type === 'number' ? 'number" step="0.001' : 'text'}" name="${nm}"${row.type === 'datepicker' || row.type === 'timepicker' ? ` class="${row.type}"` : ''} value="${esc(value)}">`;
      else if (row.type === 'textarea') o += `<textarea name="${nm}" rows="3">${esc(value)}</textarea>`;
      else if (row.type === 'select')
        o += `<select name="${nm}"><option></option>${String(row.options ?? '').split(',').map((k) => `<option value="${esc(k.trim())}"${value && value == k.trim() ? ' selected' : ''}>${esc(k.trim())}</option>`).join('')}</select>`;
      o += `<label>${esc(row.display_name)}</label>`;
    }
    return o + '</div>';
  }).join('');

  if (post['save-entry'] !== undefined) {
    // entryDataJson(): clean posted values, store uploaded image filenames
    const entry: Record<string, any> = {};
    const oldFiles: Record<string, any> = {};
    for (const [key, value] of Object.entries(post)) {
      if (key === 'save-entry') continue;
      const isOld = key.includes('old_file_');
      const name = isOld ? key.substring(9) : key;
      const target = isOld ? oldFiles : entry;
      if (Array.isArray(value)) value.forEach((v, i) => { (target[name] ??= [])[i] = sanitize(v); });
      else if (value !== '' && value !== undefined) target[name] = sanitize(value);
    }
    for (const [key, files] of Object.entries(ctx.files)) {
      const real = files.filter((f) => f.size > 0);
      if (real.length) {
        const up = await uploadImage(ctx, real, `img/registers/${id}`, { maxSize: 300, tree: 2 });
        if (!up) { const m = S.msg?.content; delete S.msg; return jsonExit({ error: m }); }
        if (files.length > 1 || Array.isArray(oldFiles[key])) {
          let j = 0;
          for (let i = 0; i < files.length; i++) {
            if (!files[i].size && oldFiles[key]?.[i]) (entry[key] ??= [])[i] = oldFiles[key][i];
            else if (files[i].size && up[j]) (entry[key] ??= [])[i] = up[j++].filename;
          }
        } else entry[key] = up[0].filename;
      } else if (oldFiles[key] !== undefined) entry[key] = oldFiles[key];
    }
    for (const [k, v] of Object.entries(oldFiles)) if (entry[k] === undefined && !ctx.files[k]) entry[k] = v;

    const last: any = await db.selectOne('SELECT MAX(sequence) as sequence FROM register_data WHERE register = ?', [id]);
    const seq = last.sequence === null ? register.starting_id : Number(last.sequence) + 1;
    let r: any = {};
    try {
      await db.insert('register_data', { register: id, sequence: seq, data: JSON.stringify(entry), date_added: now, added_by: ctx.userId });
      r = { action: 'goback' };
    } catch (e) { r = msgWarn(e); }
    return jsonExit(r);
  }

  const fields = await db.selectAll('SELECT * FROM register_fields WHERE register = ? ORDER BY group_number', [id]);
  const groups: Record<string, any[]> = {};
  for (const f of fields) (groups[f.group_number] ??= []).push(f);
  let form = '';
  for (const rows of Object.values(groups)) {
    if (rows[0].multiple == 1)
      form += `<ul class="dyno-content"><input type="text" name="deleted-fields" hidden><li class="item">${printFields(rows)}</li><li class="item eat-me">${printFields(rows)}<a href="#" class="fab red delete"><span class="material-icons">delete</span></a></li></ul><button type="button" class="btn tonal small add-dyno mb1"><span class="material-icons">add</span> Add More</button>`;
    else form += printFields(rows);
    form += '<hr class="mb2">';
  }
  void arr;
  return {
    metaTitle: register.name, pageTitle: register.name, metaDescription: '',
    content: `<section><div class="container"><div class="row center-aligned"><div class="col xs12 s10 m8"><div id="global-msg-cont"></div>
	<p>Enter the requested information below to add an entry into this register.</p>
	<form method="post" enctype="multipart/form-data" class="ajax">${form}<div class="center"><input type="text" name="save-entry" hidden><button type="submit" class="btn filled">Save Entry</button></div></form></div></div></div></section>`,
    js: `<script src="js/dayjs.min.js?v=${V}"></script>
<script type="module">
	import { initInputs, initAjaxForms } from './js/functions.mjs?v=${V}';
	initInputs(); initAjaxForms();
	G('.timepicker').datepicker({ type: 'time' });
</script>`,
  };
}
