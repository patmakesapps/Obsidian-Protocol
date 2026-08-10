/**
 * Reports scattered instances that are hanging in the air inside the play area.
 *
 *   node tools/probe-floaters.mjs basin
 *
 * Walks every InstancedMesh, transforms the source geometry bounds by each
 * instance matrix, and lists the ones whose lowest point sits above ground
 * while being inside the walkable radius — i.e. things the player will see
 * floating.
 */
import { chromium } from 'playwright-core';

const LEVEL = process.argv[2] ?? 'basin';
const BASE = process.env.GAME_URL ?? 'http://127.0.0.1:5173/';

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', (e) => console.error('page error:', e.message));

await page.goto(`${BASE}?level=${LEVEL}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(
  () => (document.getElementById('overlay-status')?.textContent ?? '').includes('NOMINAL'),
  { timeout: 180000 },
);

const report = await page.evaluate(() => {
  const groups = new Map();

  // Deliberately no THREE import: the page doesn't expose the module, and
  // transforming eight corners by a column-major matrix is four lines.
  const transformBounds = (bounds, e) => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 8; c++) {
      const x = c & 1 ? bounds.max.x : bounds.min.x;
      const y = c & 2 ? bounds.max.y : bounds.min.y;
      const z = c & 4 ? bounds.max.z : bounds.min.z;
      const p = [
        e[0] * x + e[4] * y + e[8] * z + e[12],
        e[1] * x + e[5] * y + e[9] * z + e[13],
        e[2] * x + e[6] * y + e[10] * z + e[14],
      ];
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], p[i]);
        hi[i] = Math.max(hi[i], p[i]);
      }
    }
    return { lo, hi };
  };

  // An asset is split into one InstancedMesh per material, and its parts share
  // instance indices. A tree's canopy part is *supposed* to be 8 m up, so the
  // only meaningful question is whether the LOWEST part of a given instance
  // touches the ground — hence the min across parts, keyed on asset + index.
  const lowest = new Map();

  window.game.scene.traverse((node) => {
    if (!node.isInstancedMesh) return;
    node.geometry.computeBoundingBox();
    const bounds = node.geometry.boundingBox;
    const array = node.instanceMatrix.array;
    const asset = (node.name || node.geometry.uuid.slice(0, 8)).split('#')[0];

    for (let i = 0; i < node.count; i++) {
      const { lo, hi } = transformBounds(bounds, array.subarray(i * 16, i * 16 + 16));
      const key = `${asset}|${i}`;
      const prev = lowest.get(key);
      if (!prev || lo[1] < prev.gap) {
        lowest.set(key, {
          asset,
          gap: lo[1],
          x: (lo[0] + hi[0]) / 2,
          z: (lo[2] + hi[2]) / 2,
        });
      }
    }
  });

  // Well inside the walkable floor: cliff dressing is meant to be in the air.
  const PLAY_RADIUS = 140;

  for (const entry of lowest.values()) {
    const radius = Math.hypot(entry.x, entry.z);
    if (radius > PLAY_RADIUS) continue;

    if (!groups.has(entry.asset)) {
      groups.set(entry.asset, { inPlay: 0, floating: 0, worstGap: 0, worstAt: null });
    }
    const g = groups.get(entry.asset);
    g.inPlay++;

    if (entry.gap > 0.35) {
      g.floating++;
      if (entry.gap > g.worstGap) {
        g.worstGap = Math.round(entry.gap * 100) / 100;
        g.worstAt = [Math.round(entry.x), Math.round(entry.z)];
      }
    }
  }

  return [...groups.entries()]
    .map(([name, g]) => ({ name, ...g }))
    .filter((g) => g.floating > 0)
    .sort((a, b) => b.floating - a.floating);
});

console.log(JSON.stringify(report, null, 2));
await browser.close();
