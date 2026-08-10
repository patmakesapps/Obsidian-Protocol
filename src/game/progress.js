/**
 * Campaign progress, persisted to localStorage.
 *
 * Levels unlock in order: a level with a `requires` id stays locked until that
 * level has been completed. Everything here degrades to "nothing unlocked
 * beyond the first level" if storage is unavailable (private browsing, a
 * cleared profile, a `file://` origin), which is the safe direction to fail —
 * a player who loses their save replays content, rather than the campaign
 * refusing to start.
 */

const KEY = 'obsidian-protocol.progress.v1';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { completed: [] };
    const parsed = JSON.parse(raw);
    return { completed: Array.isArray(parsed.completed) ? parsed.completed : [] };
  } catch {
    return { completed: [] };
  }
}

function write(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked. Progress is a convenience, not a requirement.
  }
}

export function completedLevels() {
  return read().completed;
}

export function isComplete(id) {
  return read().completed.includes(id);
}

/** @returns true if this was the first time — i.e. something new was unlocked. */
export function markComplete(id) {
  const state = read();
  if (state.completed.includes(id)) return false;
  state.completed.push(id);
  write(state);
  return true;
}

/** A level with no `requires`, or whose prerequisite is complete. */
export function isUnlocked(level) {
  if (!level?.requires) return true;
  return isComplete(level.requires);
}

export function reset() {
  write({ completed: [] });
}
