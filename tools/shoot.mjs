/**
 * Fast screenshot pass — boots the game and captures a few framings without
 * running the whole verification suite. For eyeballing art changes.
 *
 *   node tools/shoot.mjs
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5173/';
const OUT = process.env.SHOT_DIR ?? 'tools/shots';
mkdirSync(OUT, { recursive: true });

const SHOTS = [
  { name: 'plaza', pos: [0, 34], yaw: Math.PI, pitch: -0.02, third: true },
  { name: 'plaza-first', pos: [0, 34], yaw: Math.PI, pitch: -0.02, third: false },
  { name: 'street', pos: [62, 62], yaw: Math.PI * 1.25, pitch: 0.06, third: true },
  { name: 'skyline', pos: [-40, 90], yaw: Math.PI * 0.85, pitch: 0.22, third: true },
  { name: 'cruiser', pos: [0, 8], yaw: Math.PI, pitch: 0.05, third: true },
];

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('page error:', e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(
  () => (document.getElementById('overlay-status')?.textContent ?? '').includes('NOMINAL'),
  { timeout: 180000 },
);
await page.evaluate(() => {
  window.game.start();
  document.getElementById('overlay')?.classList.add('hidden');
});
await page.waitForTimeout(2000);

for (const shot of SHOTS) {
  await page.evaluate((s) => {
    const g = window.game;
    g.player.position.set(s.pos[0], 0, s.pos[1]);
    g.player.body.setTranslation({ x: s.pos[0], y: 0.9, z: s.pos[1] }, true);
    g.player.yaw = s.yaw;
    g.player.pitch = s.pitch;
    g.player.health = 100;
    if (g.cameraRig.isThirdPerson !== s.third) g.cameraRig.toggle();
  }, shot);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/${shot.name}.png` });
  console.log(`captured ${shot.name}`);
}

await browser.close();
