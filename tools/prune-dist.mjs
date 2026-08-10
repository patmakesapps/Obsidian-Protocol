/**
 * Strips non-shipping assets out of dist/ after a build.
 *
 * Vite copies everything in `public/` verbatim, which includes 336 MB of raw
 * Meshy exports in `models/incoming/` that the game never loads, plus the
 * superseded `prop_*.glb` street props. Left alone, `dist/` is over 400 MB.
 *
 * This is a deny-list on purpose. Several models are requested through
 * template literals (`jungle_${pass.url}.glb`), so anything that decides what
 * to keep by scanning the source for string literals will silently delete
 * assets the game needs at runtime and only fail once it's live.
 */
import { rm, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

const DROP_DIRS = [
  // Raw generator output. Documented in public/models/README.md as inputs.
  'models/incoming',
];

const DROP_GLOBS = [
  // Replaced by the modelled city/ set; nothing references them any more.
  { dir: 'models', prefix: 'prop_', suffix: '.glb' },
];

async function dirSize(path) {
  if (!existsSync(path)) return 0;
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    total += entry.isDirectory() ? await dirSize(full) : (await stat(full)).size;
  }
  return total;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

if (!existsSync(DIST)) {
  console.error(`[prune] no ${DIST}/ — run the build first.`);
  process.exit(1);
}

const before = await dirSize(DIST);

for (const dir of DROP_DIRS) {
  const path = join(DIST, dir);
  if (!existsSync(path)) continue;
  const size = await dirSize(path);
  await rm(path, { recursive: true, force: true });
  console.log(`[prune] removed ${dir}/  (${mb(size)})`);
}

for (const { dir, prefix, suffix } of DROP_GLOBS) {
  const path = join(DIST, dir);
  if (!existsSync(path)) continue;
  for (const name of await readdir(path)) {
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
    const full = join(path, name);
    const { size } = await stat(full);
    await rm(full, { force: true });
    console.log(`[prune] removed ${dir}/${name}  (${mb(size)})`);
  }
}

const after = await dirSize(DIST);
console.log(`[prune] dist ${mb(before)} -> ${mb(after)}  (saved ${mb(before - after)})`);
