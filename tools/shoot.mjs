/**
 * Fast screenshot pass — boots a level and captures a few framings without
 * running the whole verification suite. For eyeballing art changes.
 *
 *   node tools/shoot.mjs              # default level from config
 *   node tools/shoot.mjs basin        # a specific level id
 *
 * Shots are named per level, so successive runs don't overwrite each other.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const LEVEL = process.argv[2] ?? null;
const BASE = process.env.GAME_URL ?? 'http://127.0.0.1:5173/';
const URL = LEVEL ? `${BASE}?level=${LEVEL}` : BASE;
const OUT = process.env.SHOT_DIR ?? 'tools/shots';
mkdirSync(OUT, { recursive: true });

// pos is [x, z]; the camera is always first person now, so pitch matters more
// than it used to — a shot with pitch 0 stares at the horizon.
const FRAMINGS = {
  arcology: [
    { name: 'plaza', pos: [0, 34], yaw: Math.PI, pitch: -0.02 },
    { name: 'street', pos: [62, 62], yaw: Math.PI * 1.25, pitch: 0.06 },
    { name: 'skyline', pos: [-40, 90], yaw: Math.PI * 0.85, pitch: 0.22 },
    { name: 'cruiser', pos: [0, 8], yaw: Math.PI, pitch: 0.05 },
  ],
  basin: [
    { name: 'spawn', pos: [0, 20], yaw: Math.PI, pitch: 0.08 },
    { name: 'piers', pos: [-20, -60], yaw: Math.PI * 0.95, pitch: 0.16 },
    { name: 'dome', pos: [40, 48], yaw: Math.PI * 1.75, pitch: 0.04 },
    { name: 'falls', pos: [-40, -100], yaw: 0.4, pitch: 0.3 },
    { name: 'canopy', pos: [90, 30], yaw: Math.PI * 0.45, pitch: 0.02 },
  ],
};

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`console ${m.type()}:`, m.text());
});

await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(
  () => (document.getElementById('overlay-status')?.textContent ?? '').includes('NOMINAL'),
  { timeout: 180000 },
);

await page.screenshot({ path: `${OUT}/menu.png` });
console.log('captured menu');

const levelId = await page.evaluate(() => {
  window.game.start();
  document.getElementById('overlay')?.classList.add('hidden');
  return window.game.levelDef?.id ?? 'unknown';
});
console.log(`level: ${levelId}`);
await page.waitForTimeout(2500);

// A pickups framing is appended to every level: they're spawned on demand in
// play, so they'd otherwise never appear in a screenshot pass.
const shots = [
  ...(FRAMINGS[levelId] ?? FRAMINGS.arcology),
  { name: 'pickups', pos: [0, 10], yaw: Math.PI, pitch: -0.16, spawnPickups: true },
  // Same framing twice, hip then scoped, so the aim pose can be compared.
  { name: 'hipfire', pos: [0, 40], yaw: Math.PI, pitch: 0.0 },
  { name: 'aiming', pos: [0, 40], yaw: Math.PI, pitch: 0.0, aim: true },
];

for (const shot of shots) {
  await page.evaluate(async (s) => {
    const g = window.game;
    g.player.position.set(s.pos[0], 0.9, s.pos[1]);
    g.player.body.setTranslation({ x: s.pos[0], y: 0.9, z: s.pos[1] }, true);
    g.player.yaw = s.yaw;
    g.player.pitch = s.pitch;
    g.player.health = 100;

    // Set the toggle directly rather than faking a click — the blend still
    // eases in over the wait below, so the shot shows the settled pose.
    g.player.aiming = !!s.aim;

    if (s.spawnPickups) {
      const THREE = g.scene.constructor;
      const at = (x, z) => {
        const v = g.player.position.clone();
        v.set(s.pos[0] + x, 0, s.pos[1] + z);
        return v;
      };
      // yaw = PI faces +z, so these sit in front of the player and just out of
      // pickup range, where they won't collect themselves before the shutter.
      await g.pickups.spawn('ammo', at(-1.6, 4));
      await g.pickups.spawn('health', at(1.6, 4));
      await g.pickups.spawn('weapon', at(0, 6.5), { weaponId: 'thunder', ammo: 40 });
    }
  }, shot);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${levelId}-${shot.name}.png` });
  console.log(`captured ${levelId}-${shot.name}`);
}

const stats = await page.evaluate(() => ({
  fps: window.game.hud.lastFps,
  style: window.game.style?.id,
  // Post chain leaves renderer.info describing a full-screen quad.
  draws: window.game.postFx?.sceneStats.calls ?? window.game.renderer.info.render.calls,
  tris: window.game.postFx?.sceneStats.triangles ?? window.game.renderer.info.render.triangles,
  enemies: window.game.enemies.length,
  spawnPoints: window.game.level.spawnPoints.length,
}));
console.log('stats:', JSON.stringify(stats));

await browser.close();
