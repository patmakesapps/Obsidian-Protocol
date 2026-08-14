import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Character, buildPlaceholderTrooper } from '../entities/Character.js';

// Snapshots arrive at 10Hz; render 150ms back so there's always a pair to
// interpolate between.
const INTERP_DELAY = 0.15;
// A bot absent from snapshots this long is gone (despawned on the sim host).
const STALE_AFTER = 2.5;

/**
 * AI hostiles as seen by everyone who is NOT simulating them.
 *
 * The sim host runs real `Enemy` actors; this renders the rest of the room's
 * view of them: interpolated enemy-model puppets with kinematic capsules so
 * local hitscan connects. A hit is forwarded to the sim host (via Netplay's
 * `onLocalHit`), which applies it to the real actor — puppets never take
 * authoritative damage themselves.
 */
class Puppet {
  constructor({ scene, physics, id, model }) {
    this.scene = scene;
    this.physics = physics;
    this.id = id;

    this.faction = 'enemy';
    this.height = CONFIG.enemy.height;
    this.health = CONFIG.enemy.health; // mirror for kill prediction
    this.alive = true;
    this.lastSeen = 0;

    this.position = new THREE.Vector3();
    this.facing = 0;
    this.snapshots = [];

    this.character = new Character(
      model ?? { scene: buildPlaceholderTrooper(this.height, 0x23242e) },
      { targetHeight: this.height },
    );
    this.root = this.character.root;
    this.root.visible = false;
    scene.add(this.root);
    this.character.play('idle');
    this.character.calibrateToFeet();

    const rig = physics.addCharacter(
      { x: 0, y: -50, z: 0 }, // parked out of the world until the first snapshot
      CONFIG.enemy.radius,
      this.height,
      this,
    );
    this.body = rig.body;
    this.collider = rig.collider;
    this.controller = rig.controller;
  }

  get isDead() {
    return !this.alive;
  }

  /** Local shot landed. Forwarded to the sim host; flash for feedback. */
  takeDamage(amount) {
    this.health = Math.max(0, this.health - amount);
    this.character.flash(1);
    this.onLocalHit?.(this, amount, !!this.lastHitWasHeadshot);
  }

  push(s, now) {
    this.lastSeen = now;
    if (!this.root.visible && !this.snapshots.length) {
      this.root.visible = true;
      this.position.set(s.x, s.y, s.z);
    }
    this.snapshots.push({ t: now, ...s });
    while (this.snapshots.length > 2 && now - this.snapshots[0].t > 1.2) this.snapshots.shift();

    this.health = s.h;
    if (this.alive && s.dead) this._die();
  }

  _die() {
    this.alive = false;
    this._removeBody();
    if (!this.character.play('death', { loop: false, clampWhenFinished: true, fade: 0.12 })) {
      this._topple = true;
    }
  }

  _removeBody() {
    if (!this.body) return;
    this.physics.removeCharacter({
      body: this.body,
      collider: this.collider,
      controller: this.controller,
    });
    this.body = null;
    this.collider = null;
    this.controller = null;
  }

  update(dt, now) {
    this.character.update(dt);

    // Interpolate between snapshots, same policy as remote players.
    const snaps = this.snapshots;
    if (snaps.length) {
      const renderAt = now - INTERP_DELAY;
      let a = snaps[0];
      let b = snaps[snaps.length - 1];
      for (let i = snaps.length - 1; i > 0; i--) {
        if (snaps[i - 1].t <= renderAt) {
          a = snaps[i - 1];
          b = snaps[i];
          break;
        }
      }
      const span = Math.max(1e-4, b.t - a.t);
      const t = THREE.MathUtils.clamp((renderAt - a.t) / span, 0, 1);
      this.position.set(
        THREE.MathUtils.lerp(a.x, b.x, t),
        THREE.MathUtils.lerp(a.y, b.y, t),
        THREE.MathUtils.lerp(a.z, b.z, t),
      );
      let df = b.f - a.f;
      while (df > Math.PI) df -= Math.PI * 2;
      while (df < -Math.PI) df += Math.PI * 2;
      this.facing = a.f + df * t;

      if (this.alive && this.character.isRigged) {
        const speed = Math.hypot(b.x - a.x, b.z - a.z) / span;
        this.character.setLocomotion(speed / CONFIG.enemy.sprintSpeed);
        if (speed > CONFIG.enemy.speed * 1.15 && this.character.has('run')) this.character.play('run');
        else if (speed > 0.6) this.character.play('walk');
        else this.character.play('idle');
      }
    }

    this.root.position.copy(this.position);
    this.root.rotation.y = this.facing;

    if (!this.alive && this._topple) {
      this.character.body.rotation.x = THREE.MathUtils.damp(this.character.body.rotation.x, Math.PI / 2.1, 4, dt);
    }

    if (this.body) {
      this.body.setNextKinematicTranslation({
        x: this.position.x,
        y: this.position.y + this.height / 2,
        z: this.position.z,
      });
    }
  }

  dispose() {
    this._removeBody();
    this.character.dispose();
  }
}

/** The full set of puppet hostiles, keyed by the sim host's bot ids. */
export class Puppets {
  constructor({ scene, physics, assets }) {
    this.scene = scene;
    this.physics = physics;
    this.assets = assets;
    /** @type {Map<number, Puppet>} */
    this.bots = new Map();
    this.onLocalHit = null;
  }

  /** Applies one sim-host snapshot: [[id, x, y, z, facing, health, dead], …] */
  apply(list, now) {
    for (const [id, x, y, z, f, h, dead] of list) {
      let bot = this.bots.get(id);
      if (bot === undefined) {
        this._spawn(id);
        bot = this.bots.get(id);
      }
      bot?.push({ x, y, z, f, h, dead: !!dead }, now);
    }
  }

  async _spawn(id) {
    this.bots.set(id, null); // reserve against packet bursts mid-load
    const model = await this.assets.instantiate(CONFIG.enemy.model);
    if (!this.bots.has(id)) return;
    const puppet = new Puppet({ scene: this.scene, physics: this.physics, id, model });
    puppet.onLocalHit = (p, damage, headshot) => this.onLocalHit?.(p, damage, headshot);
    this.bots.set(id, puppet);
  }

  update(dt, now) {
    for (const [id, bot] of this.bots) {
      if (!bot) continue;
      bot.update(dt, now);
      // Corpses linger briefly; anything the host stopped reporting is gone.
      if (now - bot.lastSeen > STALE_AFTER) {
        bot.dispose();
        this.bots.delete(id);
      }
    }
  }

  dispose() {
    for (const bot of this.bots.values()) bot?.dispose();
    this.bots.clear();
  }
}
