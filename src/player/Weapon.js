import * as THREE from 'three';
import { CONFIG, PALETTE } from '../config.js';
import { getSoftParticleTexture } from '../core/textures.js';

const TRACER_POOL = 24;
const SPARK_POOL = 12;
const VIEWMODEL_LENGTH = 0.78; // metres, what a rifle should measure on screen
const WORLD_WEAPON_LENGTH = 0.9; // a real carbine, for the third-person copy

/**
 * One carried weapon, fully described by a definition from CONFIG's WEAPONS
 * table. Nothing here is specific to a particular gun — swapping stats or the
 * model is a data change.
 *
 * Fires hitscan from the player's eye toward whatever the crosshair is over,
 * which keeps third-person shots honest about cover.
 */
export class Weapon {
  constructor({ scene, camera, physics, player, audio, hud, cameraRig, def, projectiles }) {
    this.scene = scene;
    this.camera = camera;
    this.physics = physics;
    this.player = player;
    this.audio = audio;
    this.hud = hud;
    this.cameraRig = cameraRig;
    this.projectiles = projectiles;
    this.def = def;

    this.mag = def.magSize;
    this.reserve = def.startingReserve;
    this.reloading = false;
    this.reloadEndsAt = 0;
    this.nextShotAt = 0;
    this.time = 0;
    this.active = false;

    this.viewmodel = new THREE.Group();
    this.viewmodelBase = new THREE.Vector3().fromArray(def.viewmodelOffset ?? [0.24, -0.19, -0.30]);
    this.viewmodel.position.copy(this.viewmodelBase);
    this.viewmodel.visible = false;
    this.camera.add(this.viewmodel);

    this._buildFallbackModel(this.viewmodel);
    this._buildMuzzle();

    this.kick = 0;
    this.sway = new THREE.Vector2();
    this._lower = 0;

    this._buildTracerPool();
    this._buildSparkPool();

    this._origin = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._muzzleWorld = new THREE.Vector3();
  }

  get name() {
    return this.def.name;
  }

  get isFull() {
    return this.mag >= this.def.magSize;
  }

  get totalAmmo() {
    return this.mag + this.reserve;
  }

  // ------------------------------------------------------------------ models

  _buildFallbackModel(parent) {
    const body = new THREE.MeshStandardMaterial({
      color: PALETTE.offWhite,
      roughness: 0.4,
      metalness: 0.7,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: PALETTE.charcoal,
      roughness: 0.6,
      metalness: 0.5,
    });
    const glow = new THREE.MeshStandardMaterial({
      color: PALETTE.black,
      emissive: this.def.tracerColor,
      emissiveIntensity: 3,
      roughness: 0.3,
    });

    const parts = new THREE.Group();
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.1, 0.4), body);
    parts.add(receiver);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.025, 0.32, 10), accent);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.012, -0.33);
    parts.add(barrel);
    const cell = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.1, 0.085), glow);
    cell.position.set(0, -0.072, 0.02);
    parts.add(cell);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.13, 0.065), accent);
    grip.position.set(0, -0.105, 0.13);
    grip.rotation.x = -0.22;
    parts.add(grip);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.07, 0.15), body);
    stock.position.set(0, -0.02, 0.27);
    parts.add(stock);

    parts.name = 'fallback';
    parent.add(parts);
  }

  _buildMuzzle() {
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.012, -0.5);
    this.viewmodel.add(this.muzzle);

    // Wide radius and high intensity: a muzzle flash should visibly light the
    // walls and bodies around you, not just glow on the gun.
    this.muzzleFlash = new THREE.PointLight(this.def.muzzleColor, 0, 18, 2);
    this.muzzleFlash.position.copy(this.muzzle.position);
    this.viewmodel.add(this.muzzleFlash);

    this.flashSprite = new THREE.Mesh(
      new THREE.PlaneGeometry(0.17, 0.17),
      new THREE.MeshBasicMaterial({
        color: this.def.muzzleColor,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.flashSprite.position.copy(this.muzzle.position);
    this.viewmodel.add(this.flashSprite);
  }

  /**
   * Mounts the real GLB. Meshy exports normalise to ~1.9 units on the longest
   * axis, so scale by measured bounds and re-seat the muzzle at the barrel tip.
   */
  /**
   * Mounts the GLB.
   *
   * The models are pre-baked in Blender: barrel down -Z, origin at the pistol
   * grip, sized to a real carbine. So there is deliberately no orientation
   * guessing here — inferring "which way does this gun face" from a bounding
   * box is unreliable (our two rifles were authored facing opposite ways) and
   * was the source of every backwards-weapon bug.
   */
  attachModel(object3d) {
    const fallback = this.viewmodel.getObjectByName('fallback');
    if (fallback) this.viewmodel.remove(fallback);

    const box = new THREE.Box3().setFromObject(object3d);
    const size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    object3d.scale.setScalar(VIEWMODEL_LENGTH / Math.max(0.001, longest));
    object3d.updateMatrixWorld(true);

    // Centre on the bounding box. The GLB's origin is at the pistol grip,
    // which is right for a hand mount but not for a viewmodel — a viewmodel is
    // framed by its silhouette, not by where a hand would hold it.
    const centred = new THREE.Box3().setFromObject(object3d);
    object3d.position.sub(centred.getCenter(new THREE.Vector3()));
    object3d.position.y -= 0.02;
    object3d.position.z += this.def.viewmodelSlide ?? 0;
    object3d.updateMatrixWorld(true);

    object3d.traverse((n) => {
      if (n.isMesh) {
        n.castShadow = false;
        n.receiveShadow = false;
      }
    });

    this.viewmodel.add(object3d);
    this.modelRoot = object3d;

    const finalBox = new THREE.Box3().setFromObject(object3d);
    this.muzzle.position.set(0, 0.02, finalBox.min.z - 0.02);
    this.muzzleFlash.position.copy(this.muzzle.position);
    this.flashSprite.position.copy(this.muzzle.position);
  }

  /** Called when this weapon becomes / stops being the equipped one. */
  setActive(active) {
    this.active = active;
    if (!active) {
      this.reloading = false;
      this.hud?.setReloading(false);
    }
    this.viewmodel.visible = active;
  }

  // ------------------------------------------------------------------ firing

  get currentSpread() {
    const def = this.def;
    const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    const moveFactor = THREE.MathUtils.clamp(speed / CONFIG.player.sprintSpeed, 0, 1);
    let spread = THREE.MathUtils.lerp(def.spreadHip, def.spreadMoving, moveFactor);
    if (this.player.isCrouching) spread *= 0.55;
    if (!this.player.grounded) spread *= 1.8;
    return spread;
  }

  update(dt) {
    this.time += dt;
    if (!this.active) return;

    if (this.reloading && this.time >= this.reloadEndsAt) this._finishReload();
    if (this.player.input.wasPressed('KeyR')) this.startReload();

    const wantsToFire = this.player.input.mouse.left && this.player.input.locked;
    if (wantsToFire && this.player.alive) this.tryFire();

    this._updateViewmodel(dt);
    this._updateTracers(dt);
    this._updateSparks(dt);

    this.muzzleFlash.intensity *= Math.max(0, 1 - dt * 26);
    const fs = this.flashSprite.material;
    fs.opacity = Math.max(0, fs.opacity - dt * 26);
    this.flashSprite.rotation.z += dt * 12;
  }

  tryFire() {
    const def = this.def;
    if (this.reloading || this.time < this.nextShotAt) return;

    if (this.mag <= 0) {
      this.nextShotAt = this.time + 0.25;
      this.audio?.dryFire();
      this.startReload();
      return;
    }

    this.nextShotAt = this.time + 60 / def.rpm;
    this.mag--;
    this.hud?.setAmmo(this.mag, this.reserve);

    this._fireRay();

    this.kick = 1;
    this.player.addRecoil(
      def.recoilPitch * (0.75 + Math.random() * 0.5),
      (Math.random() - 0.5) * 2 * def.recoilYaw,
    );
    this.muzzleFlash.intensity = 55;
    this.flashSprite.material.opacity = 1;
    this.flashSprite.scale.setScalar(1.3 + Math.random() * 0.9);
    this.flashSprite.rotation.z = Math.random() * Math.PI;

    // Also throw a world-space flash so the environment lights up, not just
    // the viewmodel, which is what makes firing feel like it has force.
    this.muzzle.getWorldPosition(this._muzzleWorld);
    this.projectiles?.flash(this._muzzleWorld, this.def.muzzleColor, 60);

    this.audio?.shoot();
  }

  _fireRay() {
    const def = this.def;

    this._origin.copy(this.player.eyePosition);
    // Aim at what the crosshair covers, not straight down the camera axis.
    this._dir.copy(this.cameraRig.getAimDirection(this._origin));

    const spread = this.currentSpread;
    if (spread > 0) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * spread;
      const right = new THREE.Vector3().crossVectors(this._dir, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, this._dir).normalize();
      this._dir
        .addScaledVector(right, Math.cos(angle) * radius)
        .addScaledVector(up, Math.sin(angle) * radius)
        .normalize();
    }

    const hit = this.physics.raycast(this._origin, this._dir, def.range, this.player.collider);
    const end = hit
      ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z)
      : this._origin.clone().addScaledVector(this._dir, def.range);

    this.muzzle.getWorldPosition(this._muzzleWorld);
    this._spawnTracer(this._muzzleWorld, end);

    if (!hit) return;

    const owner = hit.owner;
    if (owner && typeof owner.takeDamage === 'function' && owner !== this.player) {
      if (owner.faction === 'ally') {
        // No friendly fire — still show an impact so the shot reads as blocked.
        this._spawnSparks(end, hit.normal, PALETTE.purpleBright);
        return;
      }
      const headY = owner.position ? owner.position.y + (owner.height ?? 1.9) * 0.78 : -Infinity;
      const isHead = hit.point.y >= headY;
      const damage = def.damage * (isHead ? def.headshotMultiplier : 1);
      const killed = owner.health - damage <= 0;

      owner.takeDamage(damage, end, this._dir);
      this.hud?.showHitmarker(isHead);
      this.audio?.hitConfirm(isHead);

      if (typeof owner.onHitEffect === 'function') {
        owner.onHitEffect(this, end, this._dir);
      } else {
        // Flesh hits spray back along the shot, not off the surface normal —
        // that's what sells them as impacts rather than sparks.
        const back = { x: -this._dir.x, y: -this._dir.y + 0.35, z: -this._dir.z };
        this._spawnBlood(end, back, isHead ? 1.6 : 1.0);
        if (isHead || killed) this._spawnBlood(end, back, 1.8);
      }
    } else {
      this._spawnSparks(end, hit.normal, PALETTE.purpleBright);
      this.audio?.impact();
    }
  }

  startReload() {
    const def = this.def;
    if (!this.active || this.reloading || this.mag >= def.magSize || this.reserve <= 0) return;
    this.reloading = true;
    this.reloadEndsAt = this.time + def.reloadTime;
    this.hud?.setReloading(true);
    this.audio?.reload();
  }

  _finishReload() {
    const def = this.def;
    const taken = Math.min(def.magSize - this.mag, this.reserve);
    this.mag += taken;
    this.reserve -= taken;
    this.reloading = false;
    this.hud?.setReloading(false);
    this.hud?.setAmmo(this.mag, this.reserve);
  }

  /** @returns how much was actually taken, so pickups can report a partial grab. */
  addAmmo(amount) {
    const before = this.reserve;
    this.reserve = Math.min(this.def.reserveMax, this.reserve + amount);
    if (this.active) this.hud?.setAmmo(this.mag, this.reserve);
    return this.reserve - before;
  }

  // ------------------------------------------------------------------ visual

  _updateViewmodel(dt) {
    const targetSwayX = THREE.MathUtils.clamp(-this.player.input.mouse.dx * 0.0016, -0.05, 0.05);
    const targetSwayY = THREE.MathUtils.clamp(-this.player.input.mouse.dy * 0.0016, -0.05, 0.05);
    this.sway.x = THREE.MathUtils.damp(this.sway.x, targetSwayX, 6, dt);
    this.sway.y = THREE.MathUtils.damp(this.sway.y, targetSwayY, 6, dt);
    this.kick = THREE.MathUtils.damp(this.kick, 0, 14, dt);

    const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    const bob = this.player.bobAmount;
    const phase = this.player.bobPhase;
    const bobX = Math.cos(phase) * 0.014 * bob;
    const bobY = Math.sin(phase * 2) * 0.011 * bob;

    const sprinting = speed > CONFIG.player.walkSpeed + 0.6;
    this._lower = THREE.MathUtils.damp(this._lower, sprinting ? 1 : 0, 8, dt);

    const reloadProgress = this.reloading
      ? (this.time - (this.reloadEndsAt - this.def.reloadTime)) / this.def.reloadTime
      : 0;
    const reloadDip = this.reloading ? Math.sin(THREE.MathUtils.clamp(reloadProgress, 0, 1) * Math.PI) * 0.14 : 0;

    this.viewmodel.position.set(
      this.viewmodelBase.x + this.sway.x + bobX,
      this.viewmodelBase.y + this.sway.y + bobY - this._lower * 0.09 - reloadDip,
      this.viewmodelBase.z + this.kick * 0.09,
    );
    this.viewmodel.rotation.set(
      -this.sway.y * 1.4 + this.kick * 0.22 - reloadDip * 2.2,
      -this.sway.x * 1.4 + this._lower * 0.5,
      this._lower * 0.35 + this.sway.x * 0.8,
    );
  }

  _buildTracerPool() {
    this.tracers = [];
    const geo = new THREE.CylinderGeometry(0.013, 0.013, 1, 5, 1, true);
    geo.translate(0, 0.5, 0);
    geo.rotateX(Math.PI / 2);
    for (let i = 0; i < TRACER_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: this.def.tracerColor,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.tracers.push({ mesh, life: 0 });
    }
    this._tracerCursor = 0;
  }

  _spawnTracer(from, to) {
    const t = this.tracers[this._tracerCursor];
    this._tracerCursor = (this._tracerCursor + 1) % this.tracers.length;
    const distance = from.distanceTo(to);
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, distance);
    t.mesh.visible = true;
    t.mesh.material.opacity = 0.85;
    t.life = 0.07;
  }

  _updateTracers(dt) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, (t.life / 0.07) * 0.85);
      if (t.life <= 0) t.mesh.visible = false;
    }
  }

  _buildSparkPool() {
    this.sparks = [];
    for (let i = 0; i < SPARK_POOL; i++) {
      const count = 10;
      const positions = new Float32Array(count * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({
        size: 0.09,
        map: getSoftParticleTexture(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geo, mat);
      points.visible = false;
      points.frustumCulled = false;
      this.scene.add(points);
      // No per-impact point light: additive particles read fine on their own
      // and a dozen transient lights is a measurable frame cost.
      this.sparks.push({ points, life: 0, velocities: new Float32Array(count * 3) });
    }
    this._sparkCursor = 0;
  }

  _spawnSparks(point, normal, color) {
    const s = this.sparks[this._sparkCursor];
    this._sparkCursor = (this._sparkCursor + 1) % this.sparks.length;
    const n = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
    const pos = s.points.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, point.x, point.y, point.z);
      const dir = n
        .clone()
        .add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.4))
        .normalize()
        .multiplyScalar(1.8 + Math.random() * 4);
      s.velocities[i * 3] = dir.x;
      s.velocities[i * 3 + 1] = dir.y;
      s.velocities[i * 3 + 2] = dir.z;
    }
    pos.needsUpdate = true;
    s.points.material.color.setHex(color);
    s.points.material.size = 0.09;
    s.points.material.blending = THREE.AdditiveBlending;
    s.points.material.opacity = 1;
    s.points.visible = true;
    s.life = 0.3;
    s.isBlood = false;
  }

  /**
   * Heavier, darker, gravity-affected burst for hits on a body. Reuses the
   * spark pool but with a wider cone and more of it.
   */
  _spawnBlood(point, direction, intensity = 1) {
    const fb = CONFIG.feedback;
    const s = this.sparks[this._sparkCursor];
    this._sparkCursor = (this._sparkCursor + 1) % this.sparks.length;

    const n = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
    const pos = s.points.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, point.x, point.y, point.z);
      const dir = n
        .clone()
        .add(
          new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.9),
        )
        .normalize()
        .multiplyScalar(fb.bloodSpeed * intensity * (0.4 + Math.random()));
      s.velocities[i * 3] = dir.x;
      s.velocities[i * 3 + 1] = dir.y;
      s.velocities[i * 3 + 2] = dir.z;
    }
    pos.needsUpdate = true;
    s.points.material.color.setHex(fb.bloodColor);
    s.points.material.size = 0.14 * intensity;
    s.points.material.blending = THREE.NormalBlending;
    s.points.material.opacity = 1;
    s.points.visible = true;
    s.life = 0.5;
    s.isBlood = true;
  }

  _updateSparks(dt) {
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const total = s.isBlood ? 0.5 : 0.3;
      const drag = s.isBlood ? 0.94 : 1.0;
      const pos = s.points.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        s.velocities[i * 3] *= drag;
        s.velocities[i * 3 + 2] *= drag;
        s.velocities[i * 3 + 1] += CONFIG.world.gravity * dt * (s.isBlood ? 0.9 : 0.5);
        pos.setXYZ(
          i,
          pos.getX(i) + s.velocities[i * 3] * dt,
          pos.getY(i) + s.velocities[i * 3 + 1] * dt,
          pos.getZ(i) + s.velocities[i * 3 + 2] * dt,
        );
      }
      pos.needsUpdate = true;
      s.points.material.opacity = Math.max(0, s.life / total);
      if (s.life <= 0) s.points.visible = false;
    }
  }
}
