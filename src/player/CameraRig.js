import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * First-person camera.
 *
 * Also owns the aim point — what the crosshair is actually over — because
 * weapons fire from the player's eye toward that point rather than blindly
 * down the camera axis, and screen shake, which is applied here so it can't
 * pollute the player's actual look angles.
 */
export class CameraRig {
  constructor({ camera, player, physics, input }) {
    this.camera = camera;
    this.player = player;
    this.physics = physics;
    this.input = input;

    this.camera.fov = CONFIG.camera.fov;
    this.camera.updateProjectionMatrix();

    this.aimPoint = new THREE.Vector3();
    this.shake = 0;

    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._shakeOffset = new THREE.Vector3();
  }

  get pitchLimit() {
    return CONFIG.player.pitchLimit;
  }

  /** Impulse-style kick; decays on its own. */
  addShake(amount) {
    this.shake = Math.min(0.35, this.shake + amount);
  }

  update(dt) {
    const cfg = CONFIG.camera;

    // Zoom follows the player's aim blend. Only touch the projection matrix
    // when the value actually moves — recomputing it every frame is wasted
    // work once the transition has settled.
    const wantedFov = THREE.MathUtils.lerp(cfg.fov, cfg.aimFov, this.player.aimBlend);
    if (Math.abs(this.camera.fov - wantedFov) > 0.01) {
      this.camera.fov = wantedFov;
      this.camera.updateProjectionMatrix();
    }

    const pitch = this.player.pitch + this.player.recoil.y;
    const yaw = this.player.yaw + this.player.recoil.x;
    this._euler.set(pitch, yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this._euler);

    this._dir.set(0, 0, -1).applyEuler(this._euler);
    this._right.set(1, 0, 0).applyEuler(this._euler);

    const eye = this.player.eyePosition;
    const bob = this.player.cameraBobOffset;
    this.camera.position.copy(eye).addScaledVector(this._right, bob.x);
    this.camera.position.y += bob.y;

    // Shake is positional, not angular, so it never fights the player's aim.
    if (this.shake > 0.0001) {
      this.shake = Math.max(0, this.shake - cfg.shakeDecay * this.shake * dt);
      const s = this.shake;
      this._shakeOffset.set(
        (Math.random() - 0.5) * 2 * s,
        (Math.random() - 0.5) * 2 * s,
        (Math.random() - 0.5) * 2 * s,
      );
      this.camera.position.add(this._shakeOffset);
      this.camera.rotateZ((Math.random() - 0.5) * s * 0.6);
    }

    if (this.player.strafeRoll !== 0) this.camera.rotateZ(this.player.strafeRoll);

    this._updateAimPoint();
  }

  /**
   * What the crosshair is over. Falls back to a far point along the view ray
   * when nothing is hit, so aiming at empty sky still works.
   */
  _updateAimPoint() {
    const maxRange = 320;
    const hit = this.physics.raycast(
      this.camera.position,
      this._dir,
      maxRange,
      this.player.collider,
    );
    if (hit) {
      this.aimPoint.set(hit.point.x, hit.point.y, hit.point.z);
    } else {
      this.aimPoint.copy(this.camera.position).addScaledVector(this._dir, maxRange);
    }
  }

  /** Direction from the player's eye to whatever the crosshair is over. */
  getAimDirection(fromPoint) {
    return this.aimPoint.clone().sub(fromPoint).normalize();
  }
}
