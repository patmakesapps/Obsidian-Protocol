import { Level } from './Level.js';
import { JungleLevel } from './JungleLevel.js';
import { CONFIG } from '../config.js';

/**
 * Level registry.
 *
 * A level is a class implementing four things the rest of the game calls:
 * `build()`, `heightAt(x, z)`, `isOpenGround(x, z)` and `randomSpawnPoint(rand)`,
 * plus optional `update(dt)` for anything animated. Everything else — layout,
 * props, atmosphere — is the level's own business.
 */
export const LEVELS = {
  arcology: {
    id: 'arcology',
    name: 'OBSIDIAN ARCOLOGY',
    Level,
    sky: 'arcology',
    loadingLabel: 'BUILDING CITY',
  },
  basin: {
    id: 'basin',
    name: 'VERDANT BASIN',
    Level: JungleLevel,
    sky: 'basin',
    loadingLabel: 'SEEDING THE BASIN',
  },
};

/**
 * Chooses the level: `?level=basin` in the URL wins, then the config default.
 * The query string is there so a level can be linked to and reloaded into
 * directly without touching config, which is how testing actually happens.
 */
export function resolveLevel() {
  let requested = null;
  if (typeof window !== 'undefined') {
    requested = new URLSearchParams(window.location.search).get('level');
  }
  const id = requested ?? CONFIG.world.level;
  if (!LEVELS[id]) {
    console.warn(`[levels] unknown level "${id}" — falling back to "${CONFIG.world.level}".`);
    return LEVELS[CONFIG.world.level] ?? LEVELS.arcology;
  }
  return LEVELS[id];
}
