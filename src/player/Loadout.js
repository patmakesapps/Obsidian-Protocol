import { WEAPONS } from '../config.js';

/**
 * The player's carried weapons and the switching between them.
 *
 * Weapons are created lazily: a gun the player has never picked up doesn't
 * exist, so its viewmodel is never built and its GLB is never fetched.
 */
export class Loadout {
  constructor({ createWeapon, hud, audio, startingIds = ['vanguard'] }) {
    this.createWeapon = createWeapon;
    this.hud = hud;
    this.audio = audio;

    this.weapons = [];
    this.index = 0;
    this.previousIndex = 0;
    this.switchLockUntil = 0;
    this.time = 0;

    this._pendingIds = [...startingIds];
  }

  /** Weapons need async model loads, so construction is a separate step. */
  async init() {
    for (const id of this._pendingIds) await this.add(id);
    this._pendingIds = [];
    if (this.weapons.length) {
      this.weapons[0].setActive(true);
      this.hud?.setWeapons(this.summary(), 0);
      this.hud?.setAmmo(this.current.mag, this.current.reserve);
    }
  }

  get current() {
    return this.weapons[this.index] ?? null;
  }

  has(id) {
    return this.weapons.some((w) => w.def.id === id);
  }

  find(id) {
    return this.weapons.find((w) => w.def.id === id) ?? null;
  }

  /** @returns the Weapon, existing or newly created. */
  async add(id) {
    const existing = this.find(id);
    if (existing) return existing;

    const def = WEAPONS[id];
    if (!def) {
      console.warn(`[Loadout] unknown weapon id "${id}"`);
      return null;
    }
    const weapon = await this.createWeapon(def);
    weapon.setActive(false);
    this.weapons.push(weapon);
    this.hud?.setWeapons(this.summary(), this.index);
    return weapon;
  }

  equip(index) {
    if (index < 0 || index >= this.weapons.length) return false;
    if (index === this.index) return false;
    if (this.time < this.switchLockUntil) return false;

    this.current?.setActive(false);
    this.previousIndex = this.index;
    this.index = index;
    this.current.setActive(true);
    this.switchLockUntil = this.time + 0.35;

    this.audio?.weaponSwitch();
    this.hud?.setWeapons(this.summary(), this.index);
    this.hud?.setAmmo(this.current.mag, this.current.reserve);
    this.hud?.setWeaponName(this.current.name);
    return true;
  }

  equipById(id) {
    const i = this.weapons.findIndex((w) => w.def.id === id);
    return i >= 0 ? this.equip(i) : false;
  }

  cycle(direction) {
    if (this.weapons.length < 2) return false;
    const next = (this.index + direction + this.weapons.length) % this.weapons.length;
    return this.equip(next);
  }

  swapToPrevious() {
    return this.equip(this.previousIndex);
  }

  summary() {
    return this.weapons.map((w) => ({
      id: w.def.id,
      name: w.def.name,
      mag: w.mag,
      reserve: w.reserve,
    }));
  }

  update(dt, input) {
    this.time += dt;

    if (input.locked) {
      for (let i = 0; i < Math.min(9, this.weapons.length); i++) {
        if (input.wasPressed(`Digit${i + 1}`)) this.equip(i);
      }
      if (input.wasPressed('KeyQ')) this.swapToPrevious();
      if (input.mouse.wheel !== 0) this.cycle(input.mouse.wheel > 0 ? 1 : -1);
    }

    // Every weapon ticks, not just the equipped one, so reload timers and
    // tracer fades on a just-holstered gun still resolve.
    for (const w of this.weapons) w.update(dt);

    // Only push actual changes: rewriting the ammo DOM every frame keeps the
    // HUD plate style-invalidated even when the count hasn't moved.
    const w = this.current;
    if (w && (w.mag !== this._hudMag || w.reserve !== this._hudReserve)) {
      this._hudMag = w.mag;
      this._hudReserve = w.reserve;
      this.hud?.setAmmo(w.mag, w.reserve);
    }
  }
}
