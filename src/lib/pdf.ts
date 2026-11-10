import fs from 'fs';
import path from 'path';
import { env } from './env';

/**
 * HTML -> PDF (replaces PHP's Dompdf). Uses puppeteer-core with a locally installed Chrome/Chromium/Edge.
 * Set CHROME_PATH in .env.local (e.g. C:\Program Files\Google\Chrome\Application\chrome.exe).
 */
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean) as string[];

export class PdfUnavailable extends Error {}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const exe = CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new PdfUnavailable('PDF generation needs Chrome/Chromium. Set CHROME_PATH in your environment.');
  const puppeteer: any = await import('puppeteer-core');
  const pp = puppeteer.default ?? puppeteer;
  const browser = await pp.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    // relative assets such as img/letter-head.jpg resolve against the public folder
    const base = `file:///${path.join(process.cwd(), 'public').replace(/\\/g, '/')}/`;
    await page.setContent(html.replace('<head>', `<head><base href="${base}">`), { waitUntil: 'load' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export const pdfResponse = (buf: Buffer, name: string, inline = false) =>
  new Response(new Uint8Array(buf), { headers: { 'content-type': 'application/pdf', 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/"/g, '')}"` } });

void env;
