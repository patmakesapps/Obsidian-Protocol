import * as THREE from 'three';
import { CONFIG, WEAPONS } from '../config.js';
import { Character, buildPlaceholderTrooper } from './Character.js';

export const STATE = {
  IDLE: 'idle',
  ADVANCE: 'advance',
  ENGAGE: 'engage',
  BACKPEDAL: 'backpedal',
  MELEE: 'melee',
  DEAD: 'dead',
};

// Obstacle sidestep tuning. An actor achieving less than BLOCK_RATIO of the
// movement it asked for is being obstructed; once that has held for BLOCK_TIME
// it steers AVOID_ANGLE off its goal for AVOID_TIME before trying again.
// The angle is past 90 degrees on purpose — at exactly 90 an actor slides along
// a flat face forever without ever getting round the end of it.
const BLOCK_RATIO = 0.45;
const BLOCK_TIME = 0.2;
const AVOID_TIME = 1.5;
const AVOID_ANGLE = (105 * Math.PI) / 180;
// Getting re-blocked within this long of a sidestep ending means that side
// didn't work, so try the other one next time.
const AVOID_RETRY = 0.7;

/**
 * Shared behaviour for every walking combatant — enemies and allies alike.
 *
 * Subclasses supply a faction, a config block and a target-selection rule;
 * movement, line-of-sight, the telegraph→burst→cooldown firing cycle, damage,
 * death and weapon drops are all handled here so the two sides genuinely play
 * by the same rules.
 */
export class Actor {
  constructor({ scene, physics, level, audio, projectiles, position, cfg, faction, model, weaponModel }) {
    this.scene = scene;
    this.physics = physics;
    this.level = level;
    this.audio = audio;
    this.projectiles = projectiles;
    this.cfg = cfg;
    this.faction = faction;

    this.health = cfg.health;
    this.maxHealth = cfg.health;
    this.height = cfg.height;
    this.state = STATE.IDLE;
    this.time = 0;
    this.removed = false;
    this.deadAt = 0;

    this.position = position.clone();
    this.velocity = new THREE.Vector3();
    this.grounded = false;
    this.facing = Math.random() * Math.PI * 2;

    this.target = null;
    this.lastSeenAt = -99;
    this.nextFireAt = 0;
    this.telegraphUntil = 0;
    this.burstRemaining = 0;
    this.nextBurstShotAt = 0;
    this.lastMeleeAt = -99;
    this._animLockUntil = -99;

    // Squad members stay dormant until one of them notices the player, then
    // the whole group engages together.
    this.squad = null;
    this.alerted = !cfg.activationRange;

    this.weaponId = cfg.weapon;
    this.weaponDef = WEAPONS[this.weaponId] ?? null;
    // Drones and anything else without a named weapon carry unlimited charge —
    // otherwise they start at zero ammo and silently never fire.
    this.ammoRemaining = this.weaponDef
      ? Math.floor(this.weaponDef.magSize * (1 + Math.random() * 2))
      : Infinity;

    // How a hit on this actor reads: organic spray, or sparks for machines.
    this.hitEffect = 'blood';

    this.character = new Character(
      model ?? { scene: buildPlaceholderTrooper(cfg.height, faction === 'ally' ? 0xdfe3ef : 0x23242e) },
      { targetHeight: cfg.height },
    );
    this.root = this.character.root;
    this.root.position.copy(this.position);
    scene.add(this.root);

    // Weapons are baked into the character GLB, parented to the right hand
    // bone in Blender using the aiming pose's own geometry. Attaching one at
    // runtime is only a fallback for a model that doesn't already carry one.
    if (weaponModel) this._attachWeaponModel(weaponModel);

    const rig = physics.addCharacter(
      { x: position.x, y: position.y + cfg.height / 2, z: position.z },
      cfg.radius,
      cfg.height,
      this,
    );
    this.body = rig.body;
    this.collider = rig.collider;
    this.controller = rig.controller;

    this.character.play('idle');
    // Must run after the root is in the scene and idle is playing, so the foot
    // bone can be sampled in its animated pose.
    this.character.calibrateToFeet();

    this._toTarget = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._targetEye = new THREE.Vector3();
    this._aim = new THREE.Vector3();
    this._strafeBias = Math.random() < 0.5 ? -1 : 1;
    this._wanderPhase = Math.random() * Math.PI * 2;

    // Obstacle sidestep. There is no navmesh — actors steer straight at their
    // goal — so anything between them and it (a trunk, a boulder, a squadmate)
    // means walking on the spot forever. These track how long movement has been
    // obstructed and which way to peel off when it has been too long.
    this._blockedFor = 0;
    this._avoidUntil = -99;
    this._avoidSign = this._strafeBias;

    // A fixed personal offset around the target while advancing, so a whole
    // squad approaches as a spread rather than a single-file queue. Scaled down
    // as they close in, so it never pushes anyone out of firing range.
    const slotAngle = Math.random() * Math.PI * 2;
    const slotRange = 4 + Math.random() * 5;
    this._advanceSlot = new THREE.Vector3(
      Math.cos(slotAngle) * slotRange,
      0,
      Math.sin(slotAngle) * slotRange,
    );
  }

  /**
   * Mounts the gun on the right hand bone so it follows the animation. Falls
   * back to a fixed offset on the body if the model has no rig.
   */
  _attachWeaponModel(object3d) {
    // The GLB is pre-baked in Blender: barrel down -Z, origin at the pistol
    // grip, real-world scale. So no rotation or re-centring here — the hand
    // bone position IS the grip position.
    object3d.traverse((n) => {
      if (n.isMesh) n.castShadow = true;
    });

    // Wrap it: the inner model keeps the yaw that points its barrel down -Z,
    // while the wrapper takes the bone alignment. Rotating the model directly
    // would destroy that orientation.
    const holder = new THREE.Group();
    holder.add(object3d);

    const grip = this.weaponDef?.handGrip ?? {};
    const mounted = this.character.alignToBoneFacing(holder, 'mixamorig:RightHand', {
      position: grip.position,
      yaw: grip.yaw,
      pitch: grip.pitch,
      scale: grip.scale,
    });

    if (!mounted) {
      holder.position.set(0.3, this.cfg.height * 0.6, -0.28);
      this.character.root.add(holder);
    }
    this.weaponModel = holder;
  }

  get isDead() {
    return this.state === STATE.DEAD;
  }

  get eyePosition() {
    return this._eye.set(this.position.x, this.position.y + this.height * 0.82, this.position.z);
  }

  /** Muzzle roughly where the pinned weapon sits. */
  get muzzlePosition() {
    const forward = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    return new THREE.Vector3(
      this.position.x + forward.x * 0.5,
      this.position.y + this.height * 0.62,
      this.position.z + forward.z * 0.5,
    );
  }

  /** Subclasses decide who they're fighting. */
  acquireTarget() {
    return null;
  }

  /** Where the actor wants to stand this tick. Subclasses override. */
  desiredPosition() {
    return null;
  }

  hasLineOfSight(target) {
    if (!target) return false;
    const from = this.eyePosition.clone();
    const to = this._targetEye.set(
      target.position.x,
      target.position.y + (target.height ?? 1.8) * 0.8,
      target.position.z,
    );
    const dir = to.clone().sub(from);
    const distance = dir.length();
    if (distance < 0.001) return true;
    dir.divideScalar(distance);

    const hit = this.physics.raycast(from, dir, distance, this.collider);
    if (!hit) return true;
    // Anything on our own side doesn't count as blocking.
    return hit.owner === target || hit.owner?.faction === this.faction;
  }

  distanceTo(other) {
    return other ? this.position.distanceTo(other.position) : Infinity;
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    this.time += dt;
    this.character.update(dt);

    if (this.isDead) {
      this._updateDeath(dt);
      return;
    }

    this._updateFacing(dt);
    this.root.position.copy(this.position);

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.character.setLocomotion(speed / (this.cfg.sprintSpeed || 6));
    this._updateLocomotionClip(speed);
  }

  /** Idle/walk/run selection that doesn't stomp on a playing one-shot. */
  _updateLocomotionClip(speed) {
    if (!this.character.isRigged) return;
    if (this.time < this._animLockUntil) return;

    if (speed > (this.cfg.speed ?? 4) * 1.15 && this.character.has('run')) {
      this.character.play('run');
    } else if (speed > 0.6) {
      this.character.play('walk');
    } else {
      this.character.play('idle');
    }
  }

  /** Play a one-shot and hold off locomotion until it finishes. */
  _playOneShot(intent, duration = 0.5, opts = {}) {
    if (!this.character.play(intent, { loop: false, clampWhenFinished: false, fade: 0.08, ...opts })) {
      return false;
    }
    this._animLockUntil = this.time + duration;
    return true;
  }

  _updateFacing(dt) {
    const look = this.target ?? null;
    if (!look) return;
    this._toTarget.subVectors(look.position, this.position);
    this._toTarget.y = 0;
    if (this._toTarget.lengthSq() < 1e-6) return;

    const desired = Math.atan2(this._toTarget.x, this._toTarget.z);
    let delta = desired - this.facing;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.facing += delta * Math.min(1, this.cfg.turnRate * dt);
    this.root.rotation.y = this.facing;
  }

  _updateDeath(dt) {
    // Gate on the clip, not on whether the model is rigged: a rigged character
    // with no death animation would otherwise freeze bolt upright.
    if (!this.character.has('death')) {
      this.character.body.rotation.x = THREE.MathUtils.damp(
        this.character.body.rotation.x,
        Math.PI / 2.1,
        4,
        dt,
      );
      this.root.position.y = THREE.MathUtils.damp(this.root.position.y, this.position.y - 0.5, 1.1, dt);
    }
    if (this.time - this.deadAt > 6.0 && !this.removed) this.dispose();
  }

  fixedUpdate(dt) {
    if (this.isDead) return;

    this.target = this.acquireTarget();
    const distance = this.distanceTo(this.target);
    const canSee = this.target && distance < this.cfg.sightRange && this.hasLineOfSight(this.target);
    if (canSee) this.lastSeenAt = this.time;

    this._chooseState(distance, canSee);
    this._steer(dt);
    this._applyGravity(dt);
    this._integrate(dt);

    if (canSee) this._updateCombat(dt, distance);
  }

  /** Wake this actor and everyone in its squad. */
  alert() {
    if (this.alerted) return;
    this.alerted = true;
    if (this.squad) for (const mate of this.squad) mate.alerted = true;
  }

  _chooseState(distance, canSee) {
    const cfg = this.cfg;

    if (!this.alerted) {
      if (!this.target || distance > cfg.activationRange) {
        this.state = STATE.IDLE;
        return;
      }
      this.alert();
    }

    if (!this.target) {
      this.state = STATE.IDLE;
    } else if (cfg.meleeRange && distance <= cfg.meleeRange) {
      this.state = STATE.MELEE;
    } else if (canSee && distance < cfg.tooCloseRange) {
      this.state = STATE.BACKPEDAL;
    } else if (canSee && distance <= cfg.fireRange) {
      this.state = STATE.ENGAGE;
    } else {
      // Out of sight or out of range: close the distance rather than standing
      // around. Without this, hostiles scattered across a 430m city simply
      // never find the player and the map feels empty.
      this.state = STATE.ADVANCE;
    }
  }

  _steer(dt) {
    const cfg = this.cfg;
    const custom = this.desiredPosition();

    if (this.state === STATE.IDLE && !custom) {
      this.velocity.x *= 0.84;
      this.velocity.z *= 0.84;
      return;
    }

    let goal;
    if (custom) {
      goal = custom;
    } else if (!this.target) {
      return;
    } else {
      this._toTarget.subVectors(this.target.position, this.position);
      this._toTarget.y = 0;
      const dist = this._toTarget.length() || 1;
      const dir = this._toTarget.clone().divideScalar(dist);

      if (this.state === STATE.BACKPEDAL) {
        goal = this.position.clone().addScaledVector(dir, -(cfg.tooCloseRange - dist + 2));
      } else if (this.state === STATE.ENGAGE) {
        // Hold near the preferred range and strafe, rather than walking in.
        const offset = dist - cfg.preferredRange;
        const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(
          this._strafeBias * Math.sin(this.time * 0.8 + this._wanderPhase) * 4.5,
        );
        goal = this.position.clone().addScaledVector(dir, offset).add(side);
      } else if (this.state === STATE.MELEE) {
        goal = this.position.clone();
      } else {
        // ADVANCE: head for a personal slot around the target, not the target
        // itself. Two dozen hostiles all steering at one identical point
        // converge into a scrum and jam each other well before they arrive —
        // which looks exactly like being stuck on scenery.
        goal = this.target.position
          .clone()
          .addScaledVector(this._advanceSlot, Math.min(1, dist / 24));
      }
    }

    this._desired.subVectors(goal, this.position);
    this._desired.y = 0;
    const distance = this._desired.length();
    if (distance < 0.35) {
      this.velocity.x *= 0.8;
      this.velocity.z *= 0.8;
      return;
    }

    const speed =
      this.state === STATE.ADVANCE || distance > 12 ? cfg.sprintSpeed : cfg.speed;
    this._desired.divideScalar(distance);

    // Peel off around whatever is in the way. Rotating the heading rather than
    // adding a sideways nudge matters: a nudge still points most of the actor's
    // speed into the obstacle, so it keeps grinding against it.
    if (this.time < this._avoidUntil) {
      const angle = AVOID_ANGLE * this._avoidSign;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const x = this._desired.x;
      const z = this._desired.z;
      this._desired.x = x * cos - z * sin;
      this._desired.z = x * sin + z * cos;
    }

    this._desired.multiplyScalar(speed);

    // Ease toward the wanted velocity so direction changes aren't instant.
    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, this._desired.x, 8, dt);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, this._desired.z, 8, dt);
  }

  _applyGravity(dt) {
    if (this.grounded) {
      if (this.velocity.y < 0) this.velocity.y = -2;
    } else {
      this.velocity.y += CONFIG.world.gravity * dt;
    }
  }

  _integrate(dt) {
    const desired = {
      x: this.velocity.x * dt,
      y: this.velocity.y * dt,
      z: this.velocity.z * dt,
    };
    this.controller.computeColliderMovement(this.collider, desired);
    const moved = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();

    this._trackBlockage(dt, desired, moved);

    this.position.x += moved.x;
    this.position.y += moved.y;
    this.position.z += moved.z;

    this.body.setNextKinematicTranslation({
      x: this.position.x,
      y: this.position.y + this.height / 2,
      z: this.position.z,
    });
  }

  /**
   * Detects "running on the spot" and schedules a sidestep.
   *
   * The character controller already slides along surfaces, so a glancing hit
   * resolves itself. What doesn't resolve is walking square into something:
   * the slide direction is perpendicular to the desired one, movement drops to
   * near zero, and the actor stays there for as long as it wants to reach a
   * goal on the far side. Comparing wanted against achieved horizontal
   * movement catches that without needing to know what was hit.
   */
  _trackBlockage(dt, desired, moved) {
    const wanted = Math.hypot(desired.x, desired.z);
    if (wanted < 1e-4) {
      this._blockedFor = 0;
      return;
    }

    const achieved = Math.hypot(moved.x, moved.z);
    if (achieved / wanted < BLOCK_RATIO) {
      this._blockedFor += dt;
    } else {
      // Decay rather than reset: shuffling past an obstacle in fits and starts
      // should still eventually count as stuck.
      this._blockedFor = Math.max(0, this._blockedFor - dt * 2);
    }

    if (this._blockedFor > BLOCK_TIME && this.time >= this._avoidUntil) {
      // Commit to one side and keep it. Flipping on every trigger makes actors
      // ping-pong left-right against the same obstacle and travel nowhere —
      // measurably worse than not sidestepping at all. Only reverse when a
      // manoeuvre has just ended and we're immediately stuck again.
      if (this.time - this._avoidUntil < AVOID_RETRY) this._avoidSign = -this._avoidSign;
      this._avoidUntil = this.time + AVOID_TIME + Math.random() * 0.5;
      this._blockedFor = 0;
    }
  }

  // ------------------------------------------------------------------ combat

  _updateCombat(dt, distance) {
    const cfg = this.cfg;

    if (cfg.meleeRange && distance <= cfg.meleeRange) {
      this._tryMelee();
      return;
    }
    if (distance > cfg.fireRange) return;

    // Burst in progress.
    if (this.burstRemaining > 0) {
      if (this.time >= this.nextBurstShotAt) {
        this._fireShot();
        this.burstRemaining--;
        this.nextBurstShotAt = this.time + cfg.burstDelay;
        if (this.burstRemaining === 0) this.nextFireAt = this.time + cfg.fireCooldown;
      }
      return;
    }

    // Telegraph finished -> start the burst.
    if (this.telegraphUntil > 0 && this.time >= this.telegraphUntil) {
      this.telegraphUntil = 0;
      this.burstRemaining = cfg.burstCount;
      this.nextBurstShotAt = this.time;
      return;
    }
    if (this.telegraphUntil > 0) return;

    if (this.time >= this.nextFireAt && this.ammoRemaining > 0) {
      // A brief wind-up with a visible flash gives the player time to react.
      this.telegraphUntil = this.time + cfg.telegraphTime;
      this._playOneShot('attack', cfg.telegraphTime + cfg.burstCount * cfg.burstDelay);
      this.onTelegraph?.();
    }
  }

  _fireShot() {
    const cfg = this.cfg;
    if (this.ammoRemaining <= 0) return;
    this.ammoRemaining--;

    const origin = this.muzzlePosition;
    this._aim
      .set(
        this.target.position.x,
        this.target.position.y + (this.target.height ?? 1.8) * 0.62,
        this.target.position.z,
      )
      .sub(origin)
      .normalize();

    // Lead the shot slightly so strafing targets aren't trivially safe.
    if (this.target.velocity) {
      const flightTime = origin.distanceTo(this.target.position) / cfg.projectileSpeed;
      this._aim
        .addScaledVector(this.target.velocity, flightTime * 0.55 / Math.max(1, cfg.projectileSpeed))
        .normalize();
    }

    const spread = cfg.aimSpread;
    this._aim.x += (Math.random() - 0.5) * 2 * spread;
    this._aim.y += (Math.random() - 0.5) * 2 * spread;
    this._aim.z += (Math.random() - 0.5) * 2 * spread;
    this._aim.normalize();

    this.projectiles.spawn({
      origin,
      direction: this._aim,
      speed: cfg.projectileSpeed,
      damage: cfg.projectileDamage,
      faction: this.faction,
      owner: this,
      color: this.faction === 'ally' ? 0xc4a6ff : 0xff8a5c,
    });

    // Visible flash at the shooter's muzzle — the main cue for "where is that
    // fire coming from" in an open street fight.
    this.projectiles.flash(origin, this.faction === 'ally' ? 0xc4a6ff : 0xffb07a, 34);

    this.audio?.enemyShoot(this.faction);
    this.onFire?.();
  }

  _tryMelee() {
    const cfg = this.cfg;
    if (!cfg.meleeDamage) return;
    if (this.time - this.lastMeleeAt < cfg.meleeCooldown) return;
    this.lastMeleeAt = this.time;
    this._playOneShot('attack', 0.6);

    const victim = this.target;
    const strikeDelay = 260;
    setTimeout(() => {
      if (this.isDead || !victim || victim.alive === false) return;
      if (this.distanceTo(victim) <= cfg.meleeRange * 1.4) victim.takeDamage(cfg.meleeDamage);
    }, strikeDelay);
  }

  takeDamage(amount) {
    if (this.isDead) return;
    this.health -= amount;
    this.character.flash(1);
    // Getting shot wakes the whole squad, even if nobody saw you.
    this.alert();

    if (this.health <= 0) {
      this._die();
    } else if (this.character.has('hit')) {
      this._playOneShot('hit', 0.45, { fade: 0.06 });
    }
  }

  _die() {
    this.state = STATE.DEAD;
    this.deadAt = this.time;
    this.velocity.set(0, 0, 0);
    this.audio?.enemyDeath();
    this.character.play('death', { loop: false, clampWhenFinished: true, fade: 0.12 });

    // Stop colliding immediately so corpses don't block shots or bodies.
    this.physics.removeCharacter({
      body: this.body,
      collider: this.collider,
      controller: this.controller,
    });
    this.body = null;
    this.collider = null;
    this.controller = null;

    this.onDeath?.(this);
  }

  dispose() {
    if (this.removed) return;
    this.removed = true;
    if (this.collider || this.body || this.controller) {
      this.physics.removeCharacter({
        body: this.body,
        collider: this.collider,
        controller: this.controller,
      });
    }
    this.character.dispose();
  }
}
