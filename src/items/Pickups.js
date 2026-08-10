import * as THREE from 'three';
import { CONFIG, PALETTE, WEAPONS } from '../config.js';

const TYPE = {
  AMMO: 'ammo',
  HEALTH: 'health',
  WEAPON: 'weapon',
};

/**
 * World pickups: ammo crates, med canisters, and guns dropped by the dead.
 *
 * Ammo and health only appear when the player is actually short of them, so
 * supply tracks need rather than littering the city from the first frame.
 * Dropped weapons carry whatever ammo their owner had left.
 */
export class Pickups {
  constructor({ scene, level, player, loadout, hud, audio, assets }) {
    this.scene = scene;
    this.level = level;
    this.player = player;
    this.loadout = loadout;
    this.hud = hud;
    this.audio = audio;
    this.assets = assets;

    this.items = [];
    this.time = 0;
    this.nextSupplyAt = 8;

    this._tmp = new THREE.Vector3();
  }

  // ------------------------------------------------------------------ spawns

  /** A crate the player can walk over. */
  async spawn(type, position, payload = {}) {
    const cfg = CONFIG.pickups;
    if (this.items.length >= cfg.maxActive + 8) return null;

    const root = new THREE.Group();
    root.position.copy(position);
    root.position.y += 0.65;

    let color = PALETTE.purpleBright;
    let label = 'AMMO';

    if (type === TYPE.HEALTH) {
      color = 0x6effc4;
      label = 'MED';
    } else if (type === TYPE.WEAPON) {
      color = WEAPONS[payload.weaponId]?.tracerColor ?? PALETTE.purpleBright;
      label = WEAPONS[payload.weaponId]?.name ?? 'WEAPON';
    }

    // Every pickup body is a GLB fitted to a fixed size and re-centred on its
    // own bounds, so the hover and spin animate around the visual centre
    // regardless of where the artist put the origin.
    let modelUrl = null;
    let modelSize = cfg.modelSize;
    if (type === TYPE.WEAPON) {
      modelUrl = WEAPONS[payload.weaponId]?.model ?? null;
      modelSize = 0.95;
    } else if (type === TYPE.HEALTH) {
      modelUrl = cfg.healthModel;
    } else if (type === TYPE.AMMO) {
      modelUrl = cfg.ammoModel;
    }

    const body = modelUrl ? await this._buildModel(modelUrl, modelSize) : null;
    root.add(body ?? this._buildCrate(color));

    // Ground ring. Deliberately NOT additive: the plaza is near-white, and
    // additive blending over white saturates to white — invisible exactly
    // where the player needs to see it.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.95, 24),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.62;
    root.add(ring);

    // Vertical beam — the thing that actually makes loot findable at range.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.28, 7, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    beam.position.y = 3.0;
    root.add(beam);
    root.userData.beam = beam;

    this.scene.add(root);

    const item = {
      type,
      root,
      ring,
      color,
      label,
      payload,
      bornAt: this.time,
      lifetime: type === TYPE.WEAPON ? CONFIG.pickups.droppedWeaponLifetime : CONFIG.pickups.despawnTime,
      phase: Math.random() * Math.PI * 2,
      baseY: root.position.y,
    };
    this.items.push(item);
    return item;
  }

  /** Loads a GLB, fits it to `size` metres, and centres it. Null if missing. */
  async _buildModel(url, size) {
    const instance = await this.assets.instantiate(url);
    if (!instance) return null;

    const object = instance.scene;
    const bounds = new THREE.Box3().setFromObject(object);
    const extent = bounds.getSize(new THREE.Vector3());
    const longest = Math.max(extent.x, extent.y, extent.z);
    object.scale.setScalar(size / Math.max(0.001, longest));
    object.updateMatrixWorld(true);

    const centred = new THREE.Box3().setFromObject(object);
    object.position.sub(centred.getCenter(new THREE.Vector3()));
    object.traverse((n) => {
      if (n.isMesh) n.castShadow = true;
    });
    return object;
  }

  /** Fallback shell with glowing bands, used when a pickup GLB is missing. */
  _buildCrate(color) {
    const group = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.56, 0.72),
      new THREE.MeshStandardMaterial({
        color: PALETTE.charcoal,
        roughness: 0.42,
        metalness: 0.6,
      }),
    );
    shell.castShadow = true;
    group.add(shell);

    // Glowing band on every axis so it's identifiable from any angle.
    const bandMat = new THREE.MeshStandardMaterial({
      color: PALETTE.black,
      emissive: color,
      emissiveIntensity: 3.4,
      roughness: 0.3,
    });
    for (const dims of [
      [0.76, 0.14, 0.76],
      [0.14, 0.6, 0.76],
      [0.76, 0.6, 0.14],
    ]) {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(...dims), bandMat));
    }

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.06, 0.5),
      new THREE.MeshBasicMaterial({ color }),
    );
    cap.position.y = 0.3;
    group.add(cap);
    return group;
  }

  /** Called from an actor's death — leaves their gun with its leftover ammo. */
  dropWeapon(actor) {
    const cfg = actor.cfg ?? {};
    if (!actor.weaponId) return;
    if (Math.random() > (cfg.dropChance ?? 0.5)) return;

    const ammo = Math.max(WEAPONS[actor.weaponId]?.magSize ?? 20, actor.ammoRemaining);
    this.spawn(TYPE.WEAPON, new THREE.Vector3(actor.position.x, 0, actor.position.z), {
      weaponId: actor.weaponId,
      ammo,
    });
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    this.time += dt;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];

      // Idle motion: slow spin and a gentle hover.
      item.phase += dt * 2;
      item.root.rotation.y += dt * 1.1;
      item.root.position.y = item.baseY + Math.sin(item.phase) * 0.09;
      item.ring.scale.setScalar(1 + Math.sin(item.phase * 1.6) * 0.12);
      const beam = item.root.userData.beam;
      if (beam) beam.material.opacity = 0.2 + Math.sin(item.phase * 1.4) * 0.09;

      const age = this.time - item.bornAt;
      if (age > item.lifetime) {
        this._remove(i);
        continue;
      }
      // Blink out over the last three seconds so despawns aren't a surprise.
      const remaining = item.lifetime - age;
      if (remaining < 3) item.root.visible = Math.sin(remaining * 12) > -0.35;

      if (this.player.alive && this._distanceToPlayer(item) < CONFIG.pickups.pickupRadius) {
        if (this._collect(item)) this._remove(i);
      }
    }

    this._maybeSpawnSupplies();
  }

  _distanceToPlayer(item) {
    this._tmp.copy(item.root.position);
    this._tmp.y = this.player.position.y;
    return this._tmp.distanceTo(this.player.position);
  }

  /** @returns true when the item was consumed. */
  _collect(item) {
    if (item.type === TYPE.HEALTH) {
      const healed = this.player.heal(CONFIG.pickups.healthAmount);
      if (healed <= 0) return false; // already full — leave it for later
      this.audio?.pickup();
      this.hud?.showToast(`+${Math.round(healed)} INTEGRITY`, item.color);
      return true;
    }

    if (item.type === TYPE.AMMO) {
      const weapon = this.loadout.current;
      if (!weapon) return false;
      const taken = weapon.addAmmo(CONFIG.pickups.ammoAmount);
      if (taken <= 0) return false;
      this.audio?.pickup();
      this.hud?.showToast(`+${taken} ${weapon.def.name}`, item.color);
      return true;
    }

    if (item.type === TYPE.WEAPON) {
      const { weaponId, ammo } = item.payload;
      const existing = this.loadout.find(weaponId);
      if (existing) {
        const taken = existing.addAmmo(ammo);
        if (taken <= 0) return false;
        this.audio?.pickup();
        this.hud?.showToast(`+${taken} ${existing.def.name}`, item.color);
        return true;
      }
      // New gun: add it, load it, and switch to it.
      this.loadout.add(weaponId).then((weapon) => {
        if (!weapon) return;
        weapon.addAmmo(ammo);
        this.loadout.equipById(weaponId);
        this.hud?.showToast(`PICKED UP ${weapon.def.name}`, item.color);
      });
      this.audio?.pickup();
      return true;
    }
    return false;
  }

  /**
   * Drip-feeds crates near the player when they're running dry. Placement is
   * biased to open ground within sight, never on top of them.
   */
  _maybeSpawnSupplies() {
    const cfg = CONFIG.pickups;
    if (this.time < this.nextSupplyAt) return;
    if (this.items.filter((i) => i.type !== TYPE.WEAPON).length >= cfg.maxActive) return;
    if (!this.player.alive) return;

    const weapon = this.loadout.current;
    const ammoLow =
      weapon && weapon.totalAmmo < weapon.def.magSize + weapon.def.reserveMax * cfg.lowAmmoFraction;
    const healthLow = this.player.health < CONFIG.player.maxHealth * cfg.lowHealthFraction;

    if (!ammoLow && !healthLow) {
      this.nextSupplyAt = this.time + 3;
      return;
    }

    const spot = this._findSpotNearPlayer();
    if (!spot) {
      this.nextSupplyAt = this.time + 3;
      return;
    }

    // If both are low, alternate so the player isn't flooded with one type.
    const type = healthLow && (!ammoLow || Math.random() < 0.5) ? TYPE.HEALTH : TYPE.AMMO;
    this.spawn(type, spot);
    this.hud?.showToast(`SUPPLY DROP — ${type === TYPE.HEALTH ? 'MEDICAL' : 'AMMUNITION'}`, PALETTE.purpleBright);
    this.nextSupplyAt = this.time + cfg.spawnCooldown;
  }

  _findSpotNearPlayer() {
    const cfg = CONFIG.pickups;
    for (let attempt = 0; attempt < 40; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = cfg.spawnRadiusMin + Math.random() * (cfg.spawnRadiusMax - cfg.spawnRadiusMin);
      const x = this.player.position.x + Math.cos(angle) * radius;
      const z = this.player.position.z + Math.sin(angle) * radius;
      if (!this.level.isOpenGround(x, z)) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return null;
  }

  _remove(index) {
    const item = this.items[index];
    item.root.removeFromParent();
    this.items.splice(index, 1);
  }
}

export { TYPE as PICKUP_TYPE };
