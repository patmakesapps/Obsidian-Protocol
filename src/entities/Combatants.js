import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Actor, STATE } from './Actor.js';

/**
 * Hostile ground trooper. Targets whichever of the player or their squad is
 * closest and actually visible, so allies genuinely draw fire.
 */
export class Enemy extends Actor {
  constructor(opts) {
    super({ ...opts, cfg: CONFIG.enemy, faction: 'enemy' });
    this.world = opts.world;
  }

  acquireTarget() {
    // `remotes` is other human players, present only in multiplayer matches
    // with hostiles enabled — the AI hunts everyone equally.
    const candidates = [this.world.player, ...this.world.allies, ...(this.world.remotes ?? [])].filter(
      (c) => c && c.alive !== false && !c.isDead,
    );
    let best = null;
    let bestScore = Infinity;
    for (const c of candidates) {
      const d = this.distanceTo(c);
      if (d > this.cfg.sightRange) continue;
      // Prefer a visible far target over a hidden near one.
      const score = this.hasLineOfSight(c) ? d : d + 40;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best ?? this.world.player;
  }
}

/**
 * Friendly squadmate. Fights enemies when there are any in reach, otherwise
 * falls back into a loose formation slot around the player.
 */
export class Ally extends Actor {
  constructor(opts) {
    super({ ...opts, cfg: CONFIG.ally, faction: 'ally' });
    this.world = opts.world;
    this.slot = opts.slot ?? 0;
    this._formation = new THREE.Vector3();
  }

  acquireTarget() {
    const player = this.world.player;
    let best = null;
    let bestDistance = Infinity;
    for (const enemy of this.world.enemies) {
      if (enemy.isDead) continue;
      // Leashed to the player: allies that chase across the map stop being a
      // squad and get picked off alone.
      if (player && enemy.position.distanceTo(player.position) > this.cfg.maxLeash) continue;
      const d = this.distanceTo(enemy);
      if (d > this.cfg.sightRange) continue;
      const score = this.hasLineOfSight(enemy) ? d : d + 30;
      if (score < bestDistance) {
        bestDistance = score;
        best = enemy;
      }
    }
    return best;
  }

  /** With no enemy to fight, hold a slot behind the player. */
  desiredPosition() {
    if (this.target && this.distanceTo(this.target) < this.cfg.sightRange) return null;

    const player = this.world.player;
    if (!player) return null;

    const angle = player.yaw + Math.PI + (this.slot - 1) * 0.7;
    this._formation.set(
      player.position.x + Math.sin(angle) * this.cfg.followDistance,
      player.position.y,
      player.position.z + Math.cos(angle) * this.cfg.followDistance,
    );

    // Already in position — stand easy rather than jittering on the spot.
    if (this._formation.distanceTo(this.position) < 2.2) return null;
    return this._formation;
  }

  _updateFacing(dt) {
    if (this.target) return super._updateFacing(dt);
    // Idle: face the way the player is facing so the squad reads as coherent.
    const player = this.world.player;
    if (!player) return;
    let delta = player.yaw + Math.PI - this.facing;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.facing += delta * Math.min(1, this.cfg.turnRate * dt * 0.5);
    this.root.rotation.y = this.facing;
  }
}

/**
 * Hovering gun platform. Reuses the Actor combat cycle but replaces ground
 * movement entirely: it flies, ignores gravity, and holds altitude above
 * whatever is beneath it.
 */
export class Drone extends Actor {
  constructor(opts) {
    super({
      ...opts,
      cfg: { ...CONFIG.drone, speed: CONFIG.drone.speed, sprintSpeed: CONFIG.drone.speed },
      faction: 'enemy',
    });
    this.world = opts.world;
    this._bobPhase = Math.random() * Math.PI * 2;
    this._spin = 0;
    this.position.y = CONFIG.drone.hoverHeight;
    this.hitEffect = 'sparks'; // it's a machine — no blood
  }

  /** Machines throw sparks and shed armour chips rather than bleeding. */
  onHitEffect(weapon, point, direction) {
    weapon._spawnSparks(point, { x: -direction.x, y: -direction.y + 0.4, z: -direction.z }, 0x9fd8ff);
    weapon._spawnSparks(point, { x: -direction.x, y: -direction.y, z: -direction.z }, 0xffb066);
  }

  acquireTarget() {
    const candidates = [this.world.player, ...this.world.allies, ...(this.world.remotes ?? [])].filter(
      (c) => c && c.alive !== false && !c.isDead,
    );
    let best = null;
    let bestScore = Infinity;
    for (const c of candidates) {
      const d = this.distanceTo(c);
      if (d > this.cfg.sightRange) continue;
      const score = this.hasLineOfSight(c) ? d : d + 40;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  get eyePosition() {
    return this._eye.set(this.position.x, this.position.y, this.position.z);
  }

  get muzzlePosition() {
    return new THREE.Vector3(this.position.x, this.position.y - 0.2, this.position.z);
  }

  /** Drones float: no gravity, hold altitude, bob gently. */
  _applyGravity() {
    const targetY = CONFIG.drone.hoverHeight + Math.sin(this._bobPhase) * CONFIG.drone.bobAmount;
    this.velocity.y = (targetY - this.position.y) * 2.4;
  }

  _integrate(dt) {
    this._bobPhase += dt * 1.6;

    const desired = {
      x: this.velocity.x * dt,
      y: this.velocity.y * dt,
      z: this.velocity.z * dt,
    };
    this.controller.computeColliderMovement(this.collider, desired);
    const moved = this.controller.computedMovement();

    this.position.x += moved.x;
    this.position.y += moved.y;
    this.position.z += moved.z;
    this.grounded = false;

    this.body.setNextKinematicTranslation({
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
    });
  }

  _chooseState(distance, canSee) {
    if (!this.target || !canSee) this.state = STATE.IDLE;
    else if (distance < this.cfg.preferredRange * 0.6) this.state = STATE.BACKPEDAL;
    else if (distance <= this.cfg.fireRange) this.state = STATE.ENGAGE;
    else this.state = STATE.ADVANCE;
  }

  update(dt) {
    super.update(dt);
    if (this.isDead) return;
    // Constant yaw drift plus a bank into the direction of travel.
    this._spin += dt * 0.6;
    this.root.position.y = this.position.y;
    this.character.body.rotation.z = THREE.MathUtils.clamp(-this.velocity.x * 0.05, -0.3, 0.3);
    this.character.body.rotation.x = THREE.MathUtils.clamp(this.velocity.z * 0.05, -0.3, 0.3);
  }

  _die() {
    // Detonate where it's hovering rather than tumbling to the ground — it's a
    // hovering machine, and a mid-air blast reads far better than a corpse.
    const at = this.position.clone();
    super._die();
    this.projectiles.explode(at, { color: 0xff8a3c, coreColor: 0xfff2d6, bursts: 7, radius: 1.2 });
    this.audio?.explosion?.();
    this._explodedAt = this.time;
  }

  _updateDeath(dt) {
    // Shrink and fade out over a few frames, leaving only the blast.
    const t = Math.min(1, (this.time - this.deadAt) / 0.22);
    const scale = Math.max(0.001, 1 - t);
    this.character.root.scale.setScalar(scale);
    this.character.root.visible = t < 1;
    if (t >= 1 && !this.removed) this.dispose();
  }
}
