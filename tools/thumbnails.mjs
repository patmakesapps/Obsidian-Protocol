/**
 * Renders a PNG preview of every GLB in a folder so unnamed Meshy exports can
 * be told apart at a glance. Needs the dev server running.
 *
 *   node tools/thumbnails.mjs public/models/incoming
 */
import { chromium } from 'playwright-core';
import { readdirSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const dir = process.argv[2] ?? 'public/models/incoming';
const outDir = 'tools/shots/models';
const BASE = process.env.GAME_URL ?? 'http://127.0.0.1:5173';

const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.glb'));
if (!files.length) {
  console.error(`no .glb files in ${dir}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'],
});
const page = await browser.newPage({ viewport: { width: 512, height: 640 } });
page.on('pageerror', (e) => console.error('  page error:', e.message));

for (const file of files) {
  // Serve path relative to /public, which vite exposes at the web root.
  const webPath = `/${join(dir, file).replace(/\\/g, '/').replace(/^public\//, '')}`;
  // Keep the numeric id — Meshy reuses prompt names across generations, so the
  // stripped name alone collides and thumbnails overwrite each other.
  const stripped = basename(file, '.glb').replace(/^Meshy_AI_/, '');
  const id = (stripped.match(/_(\d+)_texture$/)?.[1] ?? '').slice(-4);
  const short = `${stripped.replace(/_\d+_texture$/, '')}_${id}`;

  try {
    await page.goto(`${BASE}/thumb.html?model=${encodeURIComponent(webPath)}`, {
      waitUntil: 'load',
      timeout: 60000,
    });
    await page.waitForFunction(() => window.__ready === true, { timeout: 60000 });
    const info = await page.evaluate(() => window.__info);
    const out = join(outDir, `${short}.png`);
    await page.screenshot({ path: out });
    console.log(
      `${short.padEnd(30)} size ${info.size.join(' x ')}  clips:${info.clips.length || 'none'}  -> ${out}`,
    );
  } catch (err) {
    console.error(`${short.padEnd(30)} FAILED: ${err.message}`);
  }
}

await browser.close();
