import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * First/third-person player on a Rapier kinematic capsule.
 *
 * `position` is the *feet* position, not the capsule centre — that way
 * crouching can resize the capsule without the player sinking into or popping
 * out of the ground. The centre is derived when we push the transform back
 * into Rapier.
 */
export class Player {
  constructor({ physics, input, audio, level, hud, scene }) {
    this.physics = physics;
    this.input = input;
    this.audio = audio;
    this.level = level;
    this.hud = hud;
    this.scene = scene;

    this.isPlayer = true;
    this.faction = 'player';
    this.height = CONFIG.player.standHeight;
    this.targetHeight = this.height;

    const spawn = new THREE.Vector3(0, level.heightAt(0, 0) + 0.5, 6);
    this.position = spawn.clone();
    this.velocity = new THREE.Vector3();

    this.yaw = Math.PI;
    this.pitch = 0;
    this.recoil = new THREE.Vector2();

    this.grounded = false;
    this.timeSinceGrounded = 99;
    this.jumpBufferedAt = -99;
    this.time = 0;

    this.health = CONFIG.player.maxHealth;
    this.lastDamageTime = -99;
    this.alive = true;

    this.bobPhase = 0;
    this.bobAmount = 0;
    this.cameraBobOffset = new THREE.Vector3();
    this.strafeRoll = 0;
    this._lastFootstep = 0;

    const rig = physics.addCharacter(
      { x: spawn.x, y: spawn.y + this.height / 2, z: spawn.z },
      CONFIG.player.radius,
      this.height,
      this,
    );
    this.body = rig.body;
    this.collider = rig.collider;
    this.controller = rig.controller;
    this._canResizeCapsule = typeof this.collider.setHalfHeight === 'function';

    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._wish = new THREE.Vector3();
  }

  get speedForStance() {
    const cfg = CONFIG.player;
    if (this.isCrouching) return cfg.crouchSpeed;
    if (this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight')) {
      if (this.input.isDown('KeyW')) return cfg.sprintSpeed;
    }
    return cfg.walkSpeed;
  }

  get isCrouching() {
    return this.input.isDown('ControlLeft') || this.input.isDown('KeyC');
  }

  get eyePosition() {
    return new THREE.Vector3(
      this.position.x,
      this.position.y + this.height - CONFIG.player.eyeDrop,
      this.position.z,
    );
  }

  get lookDirection() {
    const euler = new THREE.Euler(this.pitch + this.recoil.y, this.yaw + this.recoil.x, 0, 'YXZ');
    return new THREE.Vector3(0, 0, -1).applyEuler(euler);
  }

  /** Mouse look and presentation run per rendered frame for smoothness. */
  update(dt, cameraRig) {
    const cfg = CONFIG.player;
    this.time += dt;

    if (this.alive && this.input.locked) {
      this.yaw -= this.input.mouse.dx * cfg.mouseSensitivity;
      this.pitch -= this.input.mouse.dy * cfg.mouseSensitivity;
      const limit = cameraRig?.pitchLimit ?? cfg.pitchLimit;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -limit, limit);
    }

    const recovery = Math.min(1, 9 * dt);
    this.recoil.multiplyScalar(1 - recovery);

    if (this.input.wasPressed('Space')) this.jumpBufferedAt = this.time;

    if (this.alive && this.time - this.lastDamageTime > cfg.regenDelay && this.health < cfg.maxHealth) {
      this.health = Math.min(cfg.maxHealth, this.health + cfg.regenRate * dt);
      this.hud?.setHealth(this.health, cfg.maxHealth);
    }

    this._updatePresentation(dt, cameraRig);
  }

  _updatePresentation(dt, cameraRig) {
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = this.grounded && horizontalSpeed > 0.5;

    const targetBob = moving
      ? THREE.MathUtils.clamp(horizontalSpeed / CONFIG.player.sprintSpeed, 0, 1)
      : 0;
    this.bobAmount = THREE.MathUtils.damp(this.bobAmount, targetBob, 8, dt);
    if (moving) this.bobPhase += dt * (5.4 + horizontalSpeed * 0.85);

    this.cameraBobOffset.set(
      Math.cos(this.bobPhase) * 0.045 * this.bobAmount,
      Math.sin(this.bobPhase * 2) * 0.035 * this.bobAmount,
      0,
    );

    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const strafe = this._right.dot(this.velocity) / CONFIG.player.sprintSpeed;
    this.strafeRoll = THREE.MathUtils.clamp(-strafe * 0.03, -0.05, 0.05);

    if (moving && this.audio && this.time - this._lastFootstep > 0.62 - horizontalSpeed * 0.035) {
      this.audio.footstep();
      this._lastFootstep = this.time;
    }
  }

  fixedUpdate(dt) {
    if (!this.alive) return;
    this._updateStance(dt);
    this._buildWishDirection();
    this._applyAcceleration(dt);
    this._applyGravityAndJump(dt);
    this._move(dt);
  }

  _updateStance(dt) {
    const cfg = CONFIG.player;
    this.targetHeight = this.isCrouching ? cfg.crouchHeight : cfg.standHeight;
    const next = THREE.MathUtils.damp(this.height, this.targetHeight, 14, dt);
    if (Math.abs(next - this.height) > 1e-5) {
      this.height = next;
      if (this._canResizeCapsule) {
        this.collider.setHalfHeight(Math.max(0.01, this.height / 2 - cfg.radius));
      }
    }
  }

  _buildWishDirection() {
    this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this._wish.set(0, 0, 0);
    if (this.input.isDown('KeyW')) this._wish.add(this._forward);
    if (this.input.isDown('KeyS')) this._wish.sub(this._forward);
    if (this.input.isDown('KeyD')) this._wish.add(this._right);
    if (this.input.isDown('KeyA')) this._wish.sub(this._right);
    if (this._wish.lengthSq() > 0) this._wish.normalize();
  }

  _applyAcceleration(dt) {
    const cfg = CONFIG.player;
    const maxSpeed = this.speedForStance;
    const accel = this.grounded ? cfg.groundAccel : cfg.airAccel;
    const target = this._wish.clone().multiplyScalar(maxSpeed);
    const horiz = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);

    if (this._wish.lengthSq() > 0) {
      const delta = target.sub(horiz);
      const step = Math.min(delta.length(), accel * dt);
      if (step > 0) horiz.addScaledVector(delta.normalize(), step);
    } else if (this.grounded) {
      const drop = cfg.groundFriction * dt;
      const speed = horiz.length();
      const newSpeed = Math.max(0, speed - Math.max(drop, speed * drop));
      if (speed > 0) horiz.multiplyScalar(newSpeed / speed);
    }

    this.velocity.x = horiz.x;
    this.velocity.z = horiz.z;
  }

  _applyGravityAndJump(dt) {
    const cfg = CONFIG.player;
    if (this.grounded) {
      this.timeSinceGrounded = 0;
      if (this.velocity.y < 0) this.velocity.y = -2;
    } else {
      this.timeSinceGrounded += dt;
      this.velocity.y += CONFIG.world.gravity * dt;
    }

    const canJump = this.timeSinceGrounded <= cfg.coyoteTime;
    const wantsJump = this.time - this.jumpBufferedAt <= cfg.jumpBuffer;
    if (canJump && wantsJump) {
      this.velocity.y = cfg.jumpSpeed;
      this.jumpBufferedAt = -99;
      this.timeSinceGrounded = 99;
      this.grounded = false;
    }
  }

  _move(dt) {
    const desired = {
      x: this.velocity.x * dt,
      y: this.velocity.y * dt,
      z: this.velocity.z * dt,
    };
    this.controller.computeColliderMovement(this.collider, desired);
    const moved = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();

    this.position.x += moved.x;
    this.position.y += moved.y;
    this.position.z += moved.z;

    if (Math.abs(moved.y) < Math.abs(desired.y) * 0.5 && desired.y > 0) {
      this.velocity.y = Math.min(this.velocity.y, 0);
    }
    if (this.grounded && !wasGrounded) this.audio?.footstep();

    this.body.setNextKinematicTranslation({
      x: this.position.x,
      y: this.position.y + this.height / 2,
      z: this.position.z,
    });
  }

  addRecoil(pitch, yaw) {
    this.recoil.y += pitch;
    this.recoil.x += yaw;
  }

  heal(amount) {
    const before = this.health;
    this.health = Math.min(CONFIG.player.maxHealth, this.health + amount);
    this.hud?.setHealth(this.health, CONFIG.player.maxHealth);
    return this.health - before;
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.health -= amount;
    this.lastDamageTime = this.time;
    this.audio?.playerHurt();
    this.hud?.setHealth(Math.max(0, this.health), CONFIG.player.maxHealth);
    this.hud?.flashDamage();
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.hud?.showDeath();
    }
  }

  respawn() {
    const spawn = new THREE.Vector3(0, 0.5, 6);
    this.position.copy(spawn);
    this.velocity.set(0, 0, 0);
    this.health = CONFIG.player.maxHealth;
    this.alive = true;
    this.body.setTranslation(
      { x: spawn.x, y: spawn.y + this.height / 2, z: spawn.z },
      true,
    );
    this.hud?.setHealth(this.health, CONFIG.player.maxHealth);
    this.hud?.hideDeath();
  }
}
