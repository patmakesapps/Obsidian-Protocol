/**
 * Measures how many hostiles are running on the spot.
 *
 *   node tools/probe-stuck.mjs basin            # with sidestep behaviour
 *   node tools/probe-stuck.mjs basin --baseline # with it disabled, for comparison
 *
 * Alerts every hostile so they all try to close on the player, then samples
 * positions. An actor that wants to move but whose net displacement over the
 * window is tiny is stuck. Net displacement is the right measure — a jammed
 * actor still has velocity and still plays its run cycle, it just doesn't go
 * anywhere.
 */
import { chromium } from 'playwright-core';

const LEVEL = process.argv[2] ?? 'basin';
const BASELINE = process.argv.includes('--baseline');
const NO_SLOT = process.argv.includes('--noslot');
const BASE = process.env.GAME_URL ?? 'http://127.0.0.1:5173/';

const SAMPLE_MS = 500;
const SAMPLES = 40; // 20 seconds
const WINDOW = 8; // 4-second window
const STUCK_DISTANCE = 1.5; // metres of net travel below which we call it stuck

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on('pageerror', (e) => console.error('page error:', e.message));

await page.goto(`${BASE}?level=${LEVEL}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(
  () => (document.getElementById('overlay-status')?.textContent ?? '').includes('NOMINAL'),
  { timeout: 180000 },
);

await page.evaluate(({ baseline, noSlot }) => {
  const game = window.game;

  if (noSlot) {
    // Collapse the per-actor advance offsets so every hostile steers at the
    // exact same point again — isolates what the spread is actually worth.
    for (const e of game.enemies) e._advanceSlot?.set(0, 0, 0);
  }

  if (baseline) {
    // Walk up to the shared Actor prototype and neuter the sidestep, so the
    // same build can produce a before/after comparison.
    let proto = Object.getPrototypeOf(game.enemies[0]);
    while (proto && !Object.prototype.hasOwnProperty.call(proto, '_trackBlockage')) {
      proto = Object.getPrototypeOf(proto);
    }
    if (proto) proto._trackBlockage = function () {};
    else console.warn('baseline: _trackBlockage not found');
  }

  game.start();
  document.getElementById('overlay')?.classList.add('hidden');
  // Make the player unkillable and stationary so the test measures pathing,
  // not a moving target or a death respawn.
  game.player.health = 1e9;
  Object.defineProperty(game.player, 'health', { get: () => 1e9, set: () => {} });
  for (const e of game.enemies) e.alerted = true;
}, { baseline: BASELINE, noSlot: NO_SLOT });

const track = new Map();
for (let s = 0; s < SAMPLES; s++) {
  const snapshot = await page.evaluate(() =>
    window.game.enemies
      .filter((e) => e.health > 0 && !e.removed)
      .map((e) => ({
        id: e.uuid ?? e.root.uuid,
        x: e.position.x,
        z: e.position.z,
        state: e.state,
      })),
  );
  for (const a of snapshot) {
    if (!track.has(a.id)) track.set(a.id, []);
    track.get(a.id).push(a);
  }
  await page.waitForTimeout(SAMPLE_MS);
}

await browser.close();

let stuckActors = 0;
let stuckWindows = 0;
let movingWindows = 0;

for (const samples of track.values()) {
  let wasStuck = false;
  for (let i = WINDOW; i < samples.length; i++) {
    const a = samples[i - WINDOW];
    const b = samples[i];
    // ADVANCE only. An ENGAGE actor is deliberately holding its standoff range
    // and strafing, so near-zero net travel there is correct behaviour, not a
    // jam — counting it drowns the signal we care about.
    if (a.state !== 'advance' || b.state !== 'advance') continue;
    const net = Math.hypot(b.x - a.x, b.z - a.z);
    if (net < STUCK_DISTANCE) {
      stuckWindows++;
      wasStuck = true;
    } else {
      movingWindows++;
    }
  }
  if (wasStuck) stuckActors++;
}

const total = stuckWindows + movingWindows;
console.log(
  JSON.stringify(
    {
      mode: `${BASELINE ? 'baseline (sidestep off)' : 'sidestep on'}${NO_SLOT ? ', advance spread off' : ''}`,
      actorsTracked: track.size,
      actorsEverStuck: stuckActors,
      stuckWindows,
      movingWindows,
      stuckPercent: total ? `${((stuckWindows / total) * 100).toFixed(1)}%` : 'n/a',
    },
    null,
    2,
  ),
);
