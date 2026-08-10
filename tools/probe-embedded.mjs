/**
 * Reports actors standing inside level geometry.
 *
 *   node tools/probe-embedded.mjs arcology
 *
 * Tests actor positions against the level's own building footprints, which is
 * independent of the isOpenGround() check used to place them — so it can't
 * agree with the placement logic by construction. Samples at spawn and again
 * after everyone has been moving for a while, since actors can also walk into
 * geometry rather than only spawn in it.
 */
import { chromium } from 'playwright-core';

const LEVEL = process.argv[2] ?? 'arcology';
const BASE = process.env.GAME_URL ?? 'http://127.0.0.1:5173/';

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on('pageerror', (e) => console.error('page error:', e.message));

await page.goto(`${BASE}?level=${LEVEL}&style=clean`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(
  () => (document.getElementById('overlay-status')?.textContent ?? '').includes('NOMINAL'),
  { timeout: 180000 },
);

const check = () =>
  page.evaluate(() => {
    const game = window.game;
    const buildings = game.level.buildings ?? [];
    const offenders = [];

    const actors = [
      ...game.enemies.map((a) => ({ a, kind: 'enemy' })),
      ...game.allies.map((a) => ({ a, kind: 'ally' })),
    ];

    for (const { a, kind } of actors) {
      if (a.removed || a.health <= 0) continue;
      // Drones fly; being over a rooftop is legitimate for them.
      const flying = a.constructor.name === 'Drone';
      for (const b of buildings) {
        const insideXZ =
          Math.abs(a.position.x - b.x) < b.w / 2 && Math.abs(a.position.z - b.z) < b.d / 2;
        if (!insideXZ) continue;
        if (flying && a.position.y > b.h) continue;
        offenders.push({
          kind,
          at: [Math.round(a.position.x), Math.round(a.position.y), Math.round(a.position.z)],
          building: [Math.round(b.x), Math.round(b.z)],
        });
        break;
      }
    }

    // What the previous code did: take a known-good anchor from the level's
    // spawn list and offset it by up to +/- squadSpread/2 with no re-check.
    // Replaying that here shows the failure rate the validation removed,
    // without needing a second build to compare against.
    const spread = game.CONFIG.enemy.squadSpread;
    let trials = 0;
    let intoBuilding = 0;
    let intoProp = 0;
    for (const p of game.level.spawnPoints) {
      for (let k = 0; k < 8; k++) {
        const x = p.x + (Math.random() - 0.5) * spread;
        const z = p.z + (Math.random() - 0.5) * spread;
        trials++;
        if (buildings.some((b) => Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2)) {
          intoBuilding++;
        } else if (!game.level.isOpenGround(x, z)) {
          intoProp++;
        }
      }
    }

    return {
      actors: actors.filter(({ a }) => !a.removed && a.health > 0).length,
      buildings: buildings.length,
      embedded: offenders.length,
      sample: offenders.slice(0, 5),
      uncheckedOffsetTrials: trials,
      wouldLandInBuilding: `${((intoBuilding / trials) * 100).toFixed(1)}%`,
      wouldLandInProp: `${((intoProp / trials) * 100).toFixed(1)}%`,
    };
  });

const atSpawn = await check();

await page.evaluate(() => {
  const game = window.game;
  game.start();
  document.getElementById('overlay')?.classList.add('hidden');
  Object.defineProperty(game.player, 'health', { get: () => 1e9, set: () => {} });
  for (const e of game.enemies) e.alerted = true;
});
await page.waitForTimeout(25000);
const afterMoving = await check();

await browser.close();
console.log(JSON.stringify({ level: LEVEL, atSpawn, afterMoving }, null, 2));
