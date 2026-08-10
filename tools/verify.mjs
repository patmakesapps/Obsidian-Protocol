/**
 * Headless smoke test. Boots the game in Chromium, watches for console/page
 * errors, then exercises the live systems and reports state. Needs the dev
 * server up:
 *
 *   node tools/verify.mjs
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5173/';
const SHOT_DIR = process.env.SHOT_DIR ?? 'tools/shots';

const errors = [];
const warnings = [];
let failures = 0;

const log = (label, value) => console.log(`  ${String(label).padEnd(30)} ${value}`);
const section = (name) => console.log(`\n--- ${name} ---`);
function check(label, actual, expected, tolerance = 0) {
  const ok =
    typeof expected === 'number'
      ? Math.abs(actual - expected) <= tolerance
      : typeof expected === 'function'
        ? expected(actual)
        : actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${String(label).padEnd(34)} ${actual}`);
  return ok;
}

const browser = await chromium.launch({
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

page.on('console', (msg) => {
  const t = msg.text();
  if (msg.type() === 'error') errors.push(t);
  else if (msg.type() === 'warning') warnings.push(t);
});
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));

console.log(`\nbooting ${URL}`);
await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(
  () => {
    const s = document.getElementById('overlay-status')?.textContent ?? '';
    return s.includes('NOMINAL') || s.includes('FAILED');
  },
  { timeout: 180000 },
);

const status = await page.textContent('#overlay-status');
if (status.includes('FAILED')) {
  console.error('\nLoad failed:\n', errors.join('\n'));
  await browser.close();
  process.exit(1);
}

section('boot');
log('status', status);
await page.evaluate(() => {
  window.game.start();
  // Started programmatically, so the menu never dismissed itself.
  document.getElementById('overlay')?.classList.add('hidden');
});
await page.waitForTimeout(3000);

// ------------------------------------------------------------------ world
section('world');
const world = await page.evaluate(() => {
  const g = window.game;
  return {
    grounded: g.player.grounded,
    feetY: +g.player.position.y.toFixed(3),
    enemies: g.enemies.length,
    drones: g.enemies.filter((e) => e.constructor.name === 'Drone').length,
    allies: g.allies.length,
    riggedModels: [...g.enemies, ...g.allies].filter((a) => a.character.isRigged).length,
    props: g.level._placedProps.length,
    spawnPoints: g.level.spawnPoints.length,
    buildings: g.level.buildings.length,
  };
});
check('player grounded', world.grounded, true);
check('player feet on ground plane', world.feetY, 0, 0.06);
check('enemies spawned', world.enemies, (n) => n >= 15);
check('drones among them', world.drones, (n) => n >= 4);
check('allies spawned', world.allies, (n) => n === 3);
check('buildings generated', world.buildings, (n) => n > 40);
check('props placed', world.props, (n) => n > 50);
log('rigged character models', `${world.riggedModels} (0 expected — Meshy exports are static)`);

// ------------------------------------------------------------------ camera
section('camera');
const cam = await page.evaluate(async () => {
  const g = window.game;
  const third = { blend: g.cameraRig.blend, dist: g.cameraRig.currentDistance, visible: g.player.character.root.visible };
  g.cameraRig.toggle();
  for (let i = 0; i < 40; i++) await new Promise((r) => requestAnimationFrame(r));
  const first = { blend: g.cameraRig.blend, dist: g.cameraRig.currentDistance, visible: g.player.character.root.visible };
  g.cameraRig.toggle();
  for (let i = 0; i < 40; i++) await new Promise((r) => requestAnimationFrame(r));
  return { third, first, back: g.cameraRig.blend };
});
check('starts in third person', cam.third.blend, 1, 0.05);
check('body visible in third', cam.third.visible, true);
check('toggles to first person', cam.first.blend, 0, 0.05);
check('body hidden in first', cam.first.visible, false);
check('toggles back to third', cam.back, 1, 0.05);

// ------------------------------------------------------------------ combat
section('player weapon');
const combat = await page.evaluate(async () => {
  const g = window.game;
  const w = g.loadout.current;
  Object.defineProperty(w, 'currentSpread', { value: 0, configurable: true });

  const target = g.enemies
    .filter((e) => e.constructor.name === 'Enemy' && !e.isDead)
    .sort((a, b) => a.distanceTo(g.player) - b.distanceTo(g.player))[0];
  if (!target) return { error: 'no enemy' };

  // Stand next to the target so terrain can't occlude, then aim precisely.
  const place = (t, dz) => {
    g.player.position.set(t.position.x, t.position.y, t.position.z - dz);
    g.player.body.setTranslation(
      { x: g.player.position.x, y: g.player.position.y + g.player.height / 2, z: g.player.position.z },
      true,
    );
  };
  const aim = (t, frac) => {
    const dx = t.position.x - g.player.position.x;
    const dz = t.position.z - g.player.position.z;
    const dy = t.position.y + t.height * frac - g.player.eyePosition.y;
    g.player.yaw = Math.atan2(-dx, -dz);
    g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    g.player.recoil.set(0, 0);
  };

  place(target, 6);
  aim(target, 0.5);
  await new Promise((r) => requestAnimationFrame(r)); // let the aim ray update
  aim(target, 0.5);

  const before = target.health;
  for (let i = 0; i < 2; i++) {
    aim(target, 0.5);
    w.nextShotAt = 0;
    w.tryFire();
  }
  const bodyDamage = +(before - target.health).toFixed(1);

  const head = g.enemies.filter((e) => e.constructor.name === 'Enemy' && !e.isDead && e !== target)[0];
  let headDamage = null;
  if (head) {
    place(head, 6);
    aim(head, 0.9);
    await new Promise((r) => requestAnimationFrame(r));
    const h0 = head.health;
    for (let i = 0; i < 2; i++) {
      aim(head, 0.9);
      w.nextShotAt = 0;
      w.tryFire();
    }
    headDamage = +(h0 - head.health).toFixed(1);
  }

  return {
    weapon: w.def.name,
    bodyDamage,
    expectedBody: w.def.damage * 2,
    headDamage,
    expectedHead: w.def.damage * w.def.headshotMultiplier * 2,
    mag: w.mag,
  };
});
if (combat.error) {
  console.log(`  FAIL  ${combat.error}`);
  failures++;
} else {
  log('equipped', combat.weapon);
  check('2 body shots', combat.bodyDamage, combat.expectedBody, 0.5);
  check('2 head shots', combat.headDamage, combat.expectedHead, 0.5);
}

// -------------------------------------------------------- enemy return fire
section('enemy return fire');
const returnFire = await page.evaluate(async () => {
  const g = window.game;
  // Drop the player into the middle of the hostiles and stand still.
  const e = g.enemies.filter((x) => !x.isDead)[0];
  g.player.position.set(e.position.x, 0, e.position.z + 22);
  g.player.body.setTranslation(
    { x: g.player.position.x, y: g.player.position.y + g.player.height / 2, z: g.player.position.z },
    true,
  );
  g.player.health = 100;

  const start = g.player.health;
  let peakProjectiles = 0;
  let telegraphs = 0;
  for (const en of g.enemies) {
    const orig = en.onTelegraph;
    en.onTelegraph = () => {
      telegraphs++;
      orig?.();
    };
  }

  const t0 = performance.now();
  while (performance.now() - t0 < 9000) {
    await new Promise((r) => requestAnimationFrame(r));
    peakProjectiles = Math.max(peakProjectiles, g.projectiles.activeCount);
  }

  return {
    telegraphs,
    peakProjectiles,
    damageTaken: +(start - g.player.health).toFixed(1),
    engaging: g.enemies.filter((x) => x.state === 'engage' || x.state === 'advance').length,
  };
});
check('enemies telegraphed shots', returnFire.telegraphs, (n) => n > 0);
check('projectiles in flight', returnFire.peakProjectiles, (n) => n > 0);
check('player took damage', returnFire.damageTaken, (n) => n > 0);
log('enemies engaging', returnFire.engaging);

// --------------------------------------------------------------- ally fire
section('allies');
const allyState = await page.evaluate(() => {
  const g = window.game;
  return {
    alive: g.allies.filter((a) => !a.isDead).length,
    withTargets: g.allies.filter((a) => a.target).length,
    ammoUsed: g.allies.reduce((n, a) => n + (a.cfg.magSize ?? 0), 0),
    distances: g.allies.map((a) => +a.distanceTo(g.player).toFixed(1)),
  };
});
check('allies alive', allyState.alive, (n) => n > 0);
log('allies with a target', allyState.withTargets);
log('ally distances to player', allyState.distances.join(', '));

// ---------------------------------------------------------------- weapons
section('weapon switching');
const switching = await page.evaluate(async () => {
  const g = window.game;
  const before = g.loadout.weapons.length;
  const added = await g.loadout.add('thunder');
  added?.addAmmo(60);
  const switched = g.loadout.equipById('thunder');
  const slots = document.querySelectorAll('.weapon-slot').length;
  const activeSlot = document.querySelector('.weapon-slot.active')?.textContent ?? '';
  return {
    before,
    after: g.loadout.weapons.length,
    switched,
    current: g.loadout.current.def.id,
    slots,
    activeSlot,
    viewmodelVisible: g.loadout.current.viewmodel.visible,
    worldModelVisible: g.loadout.current.worldModel.visible,
  };
});
check('second weapon added', switching.after, switching.before + 1);
check('switched to it', switching.current, 'thunder');
check('HUD shows both slots', switching.slots, switching.after);
check('third-person model shown', switching.worldModelVisible, true);
check('viewmodel hidden in third', switching.viewmodelVisible, false);

// ---------------------------------------------------------------- pickups
section('pickups');
const pickups = await page.evaluate(async () => {
  const g = window.game;
  const w = g.loadout.current;
  // Starve the player so the supply spawner has a reason to fire.
  w.reserve = 0;
  w.mag = 1;
  g.player.health = 30;
  g.pickups.nextSupplyAt = 0;

  const t0 = performance.now();
  while (performance.now() - t0 < 2500 && g.pickups.items.length === 0) {
    await new Promise((r) => requestAnimationFrame(r));
  }
  const spawned = g.pickups.items.length;
  const types = g.pickups.items.map((i) => i.type);

  // Walk the player onto the first crate.
  let collected = false;
  if (g.pickups.items[0]) {
    const item = g.pickups.items[0];
    g.player.position.set(item.root.position.x, 0, item.root.position.z);
    const healthBefore = g.player.health;
    const ammoBefore = w.reserve;
    const t1 = performance.now();
    while (performance.now() - t1 < 1200) await new Promise((r) => requestAnimationFrame(r));
    collected = g.player.health > healthBefore || w.reserve > ammoBefore;
  }

  // Dropped weapon from a kill.
  const victim = g.enemies.find((e) => !e.isDead);
  const dropsBefore = g.pickups.items.filter((i) => i.type === 'weapon').length;
  if (victim) {
    victim.cfg = { ...victim.cfg, dropChance: 1 };
    victim.takeDamage(9999);
  }
  await new Promise((r) => setTimeout(r, 500));
  const dropsAfter = g.pickups.items.filter((i) => i.type === 'weapon').length;

  return { spawned, types, collected, dropsBefore, dropsAfter };
});
check('supply crate spawned when low', pickups.spawned, (n) => n > 0);
log('crate types', pickups.types.join(', '));
check('crate collected on contact', pickups.collected, true);
check('dead enemy dropped a weapon', pickups.dropsAfter, (n) => n > pickups.dropsBefore);

// ------------------------------------------------------------------ shots
mkdirSync(SHOT_DIR, { recursive: true });
await page.evaluate(() => {
  const g = window.game;
  g.player.position.set(0, 0, 30);
  g.player.body.setTranslation({ x: 0, y: 0.9, z: 30 }, true);
  g.player.yaw = Math.PI;
  g.player.pitch = -0.05;
  g.player.health = 100;
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOT_DIR}/city-third.png` });

await page.evaluate(() => window.game.cameraRig.toggle());
await page.waitForTimeout(900);
await page.screenshot({ path: `${SHOT_DIR}/city-first.png` });

await page.evaluate(() => {
  const g = window.game;
  g.cameraRig.toggle();
  g.player.position.set(60, 0, 60);
  g.player.body.setTranslation({ x: 60, y: 0.9, z: 60 }, true);
  g.player.yaw = Math.PI * 1.25;
  g.player.pitch = 0.08;
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOT_DIR}/city-street.png` });

section('summary');
const fps = await page.textContent('#fps-counter');
log('framerate (swiftshader)', fps);
log('console errors', errors.length);
errors.slice(0, 15).forEach((e) => console.log(`   ERR  ${e.slice(0, 200)}`));
log('console warnings', warnings.length);
warnings.slice(0, 6).forEach((w) => console.log(`   WARN ${w.slice(0, 160)}`));
log('failed checks', failures);

await browser.close();
process.exit(failures || errors.length ? 1 : 0);
