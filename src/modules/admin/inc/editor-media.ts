import path from 'path';
import fs from 'fs/promises';
import { Ctx, jsonExit } from '@/lib/ctx';
import { env } from '@/lib/env';
import { STORAGE_DIR, uploadImage } from '@/lib/functions';

export default async function (ctx: Ctx) {
  const { post } = ctx;
  const r: any = {};
  if (post.picture_url !== undefined) {
    const f = ctx.files.picture?.[0];
    if (f && f.size) {
      const up = await uploadImage(ctx, [f], 'img/media/', { maxSize: 200, tree: 2 });
      if (up && up.length) r.url = `${env.SITE_URL}/${up[0].path}`;
      else { r.error = ctx.S.msg?.content; delete ctx.S.msg; }
    } else if (post.picture_url) r.url = post.picture_url;
    r.alt = post.alt; r.caption = post.caption;
  } else if (post.youtube_url !== undefined) {
    if (post.youtube_url) {
      let url = String(post.youtube_url);
      if (!url.includes('youtube')) url = 'https://www.youtube.com/embed/' + url;
      else if (url.includes('watch')) url = url.replace('watch?v=', 'embed/');
      if (url.includes('&')) url = url.slice(0, url.indexOf('&'));
      r.url = url;
    } else {
      const v = ctx.files.video?.[0];
      if (v && v.size) {
        const clean = v.name.toLowerCase().replace(/[^a-zA-Z0-9.-]+/g, '-');
        const parts = clean.split('.'); const ext = parts.pop(); const base = parts.join('.');
        if (ext === 'mp4') {
          const dir = path.join(STORAGE_DIR, 'vid/media', base[0] + '/');
          await fs.mkdir(dir, { recursive: true });
          let name = clean, c = 1;
          while (await fs.stat(path.join(dir, name)).then(() => true, () => false)) name = `${base}-${c++}.${ext}`;
          await fs.writeFile(path.join(dir, name), v.buffer);
          r.url = `${env.SITE_URL}/vid/media/${name[0]}/${name}`;
        } else r.error = 'Invalid format. Only MP4 videos are supported.';
      } else r.error = 'Please upload a video or provide a YouTube URL';
    }
  }
  return jsonExit(r);
}
