import { Level } from './Level.js';
import { JungleLevel } from './JungleLevel.js';
import { ArenaLevel } from './ArenaLevel.js';
import { CONFIG } from '../config.js';
import { isUnlocked } from '../game/progress.js';

/**
 * Level registry.
 *
 * A level is a class implementing four things the rest of the game calls:
 * `build()`, `heightAt(x, z)`, `isOpenGround(x, z)` and `randomSpawnPoint(rand)`,
 * plus optional `update(dt)` for anything animated. Everything else — layout,
 * props, atmosphere — is the level's own business.
 *
 * `requires` chains the campaign: a level stays locked until the level it names
 * has been completed. `order` is only for display.
 */
export const LEVELS = {
  arcology: {
    id: 'arcology',
    name: 'OBSIDIAN ARCOLOGY',
    Level,
    sky: 'arcology',
    loadingLabel: 'BUILDING CITY',
    order: 0,
    requires: null,
  },
  basin: {
    id: 'basin',
    name: 'VERDANT BASIN',
    Level: JungleLevel,
    sky: 'basin',
    loadingLabel: 'SEEDING THE BASIN',
    order: 1,
    requires: 'arcology',
  },
  pit: {
    id: 'pit',
    name: 'THE PIT',
    Level: ArenaLevel,
    sky: 'pit',
    loadingLabel: 'FORGING THE PIT',
    order: 2,
    // Always open: it's the multiplayer arena, and a fine skirmish map solo.
    requires: null,
    // A 96m box cannot hold the campaign population — the full 26 hostiles
    // plus drones is an instant death sentence at spawn.
    population: { enemies: 9, drones: 2, allies: 2 },
  },
};

/** Registry order, for menus. */
export function levelList() {
  return Object.values(LEVELS).sort((a, b) => a.order - b.order);
}

/** The level that follows `id` in campaign order, or null if it's the last. */
export function nextLevel(id) {
  const ordered = levelList();
  const index = ordered.findIndex((l) => l.id === id);
  if (index < 0) return null;
  return ordered[index + 1] ?? null;
}

/**
 * Chooses the level: `?level=basin` in the URL wins, then the config default.
 * A locked level is refused whichever way it was asked for — otherwise the
 * query string is a one-line bypass of the whole campaign.
 */
export function resolveLevel() {
  let requested = null;
  let multiplayer = false;
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    requested = params.get('level');
    multiplayer = params.get('mp') === '1';
  }

  const id = requested ?? CONFIG.world.level;
  const level = LEVELS[id];

  if (!level) {
    console.warn(`[levels] unknown level "${id}" — falling back to "${CONFIG.world.level}".`);
    return LEVELS[CONFIG.world.level] ?? LEVELS.arcology;
  }
  // Multiplayer matches play on whatever level the match was created on —
  // campaign progress belongs to the host, not to whoever joins.
  if (!multiplayer && !isUnlocked(level)) {
    console.info(`[levels] "${id}" is locked — starting the campaign instead.`);
    return levelList()[0];
  }
  return level;
}
