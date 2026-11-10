import path from 'path';
import fs from 'fs/promises';
import { Ctx, Page, jsonExit } from '@/lib/ctx';
import { hasAccess, sanitize } from '@/lib/functions';
import { env } from '@/lib/env';
import { esc } from '@/lib/html';
import { noAccess } from '@/lib/adminList';
import { clearSettingsCache } from '@/lib/server';

const LOGO_DIR = path.join(process.cwd(), 'public', 'img', 'logo');
const FILES: Record<string, { fixed?: string; key?: string; height?: number; width?: number }> = {
  logo: { key: 'logo_light', height: 72 }, logo_dark: { key: 'logo_dark', height: 72 },
  logo_favicon_32: { fixed: 'favicon-32.png', width: 32 }, logo_favicon_180: { fixed: 'favicon-180.png', width: 180 },
  logo_favicon_192: { fixed: 'favicon-192.png', width: 192 }, logo_favicon_512: { fixed: 'favicon-512.png', width: 512 },
};

export default async function (ctx: Ctx): Promise<Page> {
  const { db, post } = ctx;
  if (!hasAccess(ctx, 'view', 'settings')) noAccess();
  ctx.S.current_page = `${env.SITE_URL}/admin/settings`;

  if (post.logos !== undefined) {
    const sharp = (await import('sharp')).default;
    await fs.mkdir(LOGO_DIR, { recursive: true });
    for (const [field, cfg] of Object.entries(FILES)) {
      const f = ctx.files[field]?.[0];
      if (!f || !f.size) continue;
      const safe = cfg.fixed ?? f.name.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
      const out = await sharp(f.buffer).resize({ width: cfg.width, height: cfg.height, withoutEnlargement: true }).toBuffer();
      await fs.writeFile(path.join(LOGO_DIR, safe), out);
      if (cfg.key) await db.update('settings', { _value: safe }, '_key = ?', [cfg.key]);
    }
    clearSettingsCache();
    return jsonExit({});
  }
  if ((post.phone !== undefined || post.before_closing_head !== undefined) && hasAccess(ctx, 'edit', 'settings')) {
    let r: any = {};
    try {
      for (const [key, value] of Object.entries(post)) {
        const v = key === 'before_closing_head' || key === 'before_closing_body' ? sanitize(value, 'html') : sanitize(value);
        await db.update('settings', { _value: v }, '_key = ?', [key]);
      }
    } catch (e: any) { r.message = { type: 'warning', content: e.message }; }
    clearSettingsCache();
    return jsonExit(r);
  }
  const s = ctx.settings;
  const fi = (name: string, src: string, alt: string, label: string, helper = '') => `<div class="col xs12 s6 m4 file-input"><img class="upload-sideimage" data-src="../img/logo/${esc(src)}" alt="${alt}"><input type="file" name="${name}"><label>${label}</label><button type="button" class="btn outline">Select File</button><span class="file-name">No file selected</span>${helper ? `<span class="helper">${helper}</span>` : ''}</div>`;
  return {
    metaTitle: 'Site Settings', pageTitle: 'Site Settings', metaDescription: '',
    content: `<section><div class="container"><h1 class="page-title">Site Settings</h1><div id="global-msg-cont"></div><form method="post" enctype="multipart/form-data" class="card ajax"><div class="content"><h4 class="text-uppercase">Logos</h4><div class="row">
	${fi('logo', s.logo_light, 'Logo', 'Logo (Light Mode)')}${fi('logo_dark', s.logo_dark, 'Logo Dark Mode', 'Logo (Dark Mode)')}
	${fi('logo_favicon_32', 'favicon-32.png', 'Favicon 32px', 'Favicon (32 x 32px PNG)', 'Filename should be favicon-32.png')}${fi('logo_favicon_180', 'favicon-180.png', 'App Icon 180px', 'App Icon (180 x 180px PNG - No Transparency)', 'Filename should be favicon-180.png')}
	${fi('logo_favicon_192', 'favicon-192.png', 'App Icon 192px', 'App Icon (192 x 192px PNG)', 'Filename should be favicon-192.png')}${fi('logo_favicon_512', 'favicon-512.png', 'App Icon 512px', 'App Icon (512 x 512px PNG)', 'Filename should be favicon-512.png')}
	</div></div><div class="action"><input type="text" name="logos" value="6" hidden><button type="submit" class="btn filled">Save</button></div></form></div></section>`,
    js: `<script type="module">import { initInputs, initAjaxForms } from '../js/functions.mjs'; initInputs(); initAjaxForms();</script>`,
  };
}
