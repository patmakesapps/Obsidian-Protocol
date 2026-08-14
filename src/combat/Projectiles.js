import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { getSoftParticleTexture } from '../core/textures.js';

const POOL_SIZE = 90;
// Kept deliberately tiny: each live light shades every fragment in the scene.
const LIGHT_POOL = 2;

/**
 * Pooled energy bolts, shared by every shooter that isn't hitscan.
 *
 * Collision is a swept raycast along each frame's travel segment rather than a
 * point test, so a fast bolt can't tunnel through a thin wall between frames.
 * Same-faction hits are skipped and the cast resumes past them, so squadmates
 * don't block each other's fire.
 */
export class Projectiles {
  constructor(scene, physics, { onPlayerHit, onNearMiss, listener } = {}) {
    this.scene = scene;
    this.physics = physics;
    this.onPlayerHit = onPlayerHit;
    this.onNearMiss = onNearMiss;
    this.listener = listener; // the player, for near-miss detection
    this.feedback = CONFIG.feedback;
    this._now = 0;
    this._lastWhizz = -99;

    this.pool = [];
    this.cursor = 0;

    const geo = new THREE.CapsuleGeometry(0.07, 0.5, 4, 8);
    geo.rotateX(Math.PI / 2); // lie along -Z so lookAt orients it

    for (let i = 0; i < POOL_SIZE; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.pool.push({
        mesh,
        active: false,
        position: new THREE.Vector3(),
        direction: new THREE.Vector3(),
        speed: 0,
        damage: 0,
        life: 0,
        faction: 'enemy',
        owner: null,
      });
    }

    // Every pooled light stays visible for the whole run, idling at intensity
    // zero. This looks wasteful and is the opposite — three bakes the number of
    // visible lights into every material's shader as a #define, and hiding a
    // light drops it from that count. Toggling visibility as bolts spawn and
    // die therefore forces a full shader recompile across the scene, several
    // times a second during a firefight, which is exactly what a stutter under
    // sustained fire looks like. A fixed five lights cost a small, steady
    // amount; a fluctuating count costs recompiles.
    this.lights = [];
    for (let i = 0; i < LIGHT_POOL; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 9, 2);
      scene.add(light);
      this.lights.push(light);
    }

    // Shared muzzle-flash lights. NPCs don't own lights individually — a pool
    // of two covers near-simultaneous shooters (a flash lives 0.06s) and keeps
    // the per-fragment lighting cost fixed. Every extra pooled light is paid
    // on every shaded fragment in the scene, so the pool stays minimal.
    this.flashes = [];
    for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight(0xffd9a0, 0, 16, 2);
      scene.add(light);
      this.flashes.push({ light, life: 0 });
    }
    this._flashCursor = 0;

    this._impacts = new Impacts(scene);
    this._segEnd = new THREE.Vector3();
    this._castFrom = new THREE.Vector3();
  }

  spawn({ origin, direction, speed, damage, faction, owner, color = 0xc4a6ff, life = 3.0 }) {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;

    p.active = true;
    p.position.copy(origin);
    p.direction.copy(direction).normalize();
    p.speed = speed;
    p.damage = damage;
    p.faction = faction;
    p.owner = owner;
    p.life = life;

    p.mesh.visible = true;
    p.mesh.material.color.setHex(color);
    p.mesh.position.copy(origin);
    p.mesh.lookAt(this._segEnd.copy(origin).addScaledVector(p.direction, 1));
    return p;
  }

  update(dt) {
    this._now += dt;
    for (const p of this.pool) {
      if (!p.active) continue;

      p.life -= dt;
      if (p.life <= 0) {
        this._retire(p);
        continue;
      }

      const travel = p.speed * dt;
      this._segEnd.copy(p.position).addScaledVector(p.direction, travel);

      const hit = this._castSegment(p, travel);
      if (hit) {
        this._resolveHit(p, hit);
        continue;
      }

      this._checkNearMiss(p, this._segEnd);

      p.position.copy(this._segEnd);
      p.mesh.position.copy(p.position);
      p.mesh.lookAt(this._castFrom.copy(p.position).addScaledVector(p.direction, 1));
    }

    this._updateLights();
    this._updateFlashes(dt);
    this._impacts.update(dt);
  }

  /** Brief bright flash at a gun's muzzle, bright enough to light the scene. */
  flash(position, color = 0xffd9a0, intensity = 40) {
    const f = this.flashes[this._flashCursor];
    this._flashCursor = (this._flashCursor + 1) % this.flashes.length;
    f.light.position.copy(position);
    f.light.color.setHex(color);
    f.light.intensity = intensity;
    f.life = 0.06;
  }

  /**
   * Big one-off detonation: a bright flash plus overlapping debris bursts.
   * Built from the existing pools so it costs nothing extra to have around.
   */
  explode(position, { color = 0xffb066, coreColor = 0xfff0d0, bursts = 5, radius = 1.0 } = {}) {
    this.flash(position, coreColor, 120);

    const up = { x: 0, y: 1, z: 0 };
    this._impacts.spawn(position, up, coreColor);
    for (let i = 0; i < bursts; i++) {
      const dir = {
        x: (Math.random() - 0.5) * 2,
        y: Math.random(),
        z: (Math.random() - 0.5) * 2,
      };
      const at = {
        x: position.x + (Math.random() - 0.5) * radius,
        y: position.y + (Math.random() - 0.5) * radius,
        z: position.z + (Math.random() - 0.5) * radius,
      };
      this._impacts.spawn(at, dir, i % 2 ? color : coreColor);
    }
  }

  _updateFlashes(dt) {
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      f.light.intensity *= Math.max(0, 1 - dt * 22);
      if (f.life <= 0) f.light.intensity = 0;
    }
  }

  /**
   * Fires `onNearMiss` when a hostile bolt passes close to the player's head.
   *
   * Uses point-to-segment distance over the frame's travel, not the bolt's end
   * position — at 60 m/s a projectile covers a metre per frame, so a position
   * check would miss almost every near miss it should catch.
   */
  _checkNearMiss(p, segEnd) {
    if (!this.listener || p.faction === 'player' || p.faction === 'ally') return;

    const head = this.listener.eyePosition;
    const ax = p.position.x, ay = p.position.y, az = p.position.z;
    const bx = segEnd.x - ax, by = segEnd.y - ay, bz = segEnd.z - az;
    const lenSq = bx * bx + by * by + bz * bz;
    if (lenSq < 1e-9) return;

    let t = ((head.x - ax) * bx + (head.y - ay) * by + (head.z - az) * bz) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const dx = ax + bx * t - head.x;
    const dy = ay + by * t - head.y;
    const dz = az + bz * t - head.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const fb = this.feedback;
    if (distance > fb.whizzRadius) return;
    if (this._now - this._lastWhizz < fb.whizzCooldown) return;

    this._lastWhizz = this._now;
    this.onNearMiss?.(distance / fb.whizzRadius);
  }

  /** Cast along the segment, skipping past anything on the shooter's own side. */
  _castSegment(p, travel) {
    this._castFrom.copy(p.position);
    let remaining = travel;

    for (let bounce = 0; bounce < 3 && remaining > 0.0001; bounce++) {
      const hit = this.physics.raycast(this._castFrom, p.direction, remaining, null);
      if (!hit) return null;

      const owner = hit.owner;
      const sameSide = owner?.faction && owner.faction === p.faction;
      const isSelf = owner === p.owner;

      if (!sameSide && !isSelf) return hit;

      // Step just past the friendly and keep going.
      const step = hit.distance + 0.05;
      this._castFrom.addScaledVector(p.direction, step);
      remaining -= step;
    }
    return null;
  }

  _resolveHit(p, hit) {
    const owner = hit.owner;
    const point = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);

    // Zero-damage bolts are multiplayer visual replicas — the authoritative
    // damage travels over the wire, so these must only ever spark.
    if (owner && typeof owner.takeDamage === 'function' && p.damage > 0) {
      owner.lastHitFaction = p.faction;
      owner.takeDamage(p.damage, point, p.direction);
      if (owner.isPlayer) this.onPlayerHit?.(p);
      this._impacts.spawn(point, hit.normal, 0xff7a9a);
    } else {
      this._impacts.spawn(point, hit.normal, p.mesh.material.color.getHex());
    }
    this._retire(p);
  }

  _retire(p) {
    p.active = false;
    p.mesh.visible = false;
  }

  _updateLights() {
    // Intensity only — never `visible`. See the pool comment in the constructor.
    let li = 0;
    for (const p of this.pool) {
      if (li >= this.lights.length) break;
      if (!p.active) continue;
      const light = this.lights[li++];
      light.color.copy(p.mesh.material.color);
      light.intensity = 6;
      light.position.copy(p.position);
    }
    for (; li < this.lights.length; li++) this.lights[li].intensity = 0;
  }

  get activeCount() {
    return this.pool.reduce((n, p) => n + (p.active ? 1 : 0), 0);
  }
}

/** Small pooled spark burst reused for every projectile impact. */
class Impacts {
  constructor(scene, count = 16) {
    this.items = [];
    for (let i = 0; i < count; i++) {
      const positions = new Float32Array(10 * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({
        size: 0.13,
        map: getSoftParticleTexture(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geo, mat);
      points.visible = false;
      points.frustumCulled = false;
      scene.add(points);
      this.items.push({ points, life: 0, velocities: new Float32Array(10 * 3) });
    }
    this.cursor = 0;
  }

  spawn(point, normal, color) {
    const item = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;

    const n = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
    const pos = item.points.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, point.x, point.y, point.z);
      const dir = n
        .clone()
        .add(
          new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.5),
        )
        .normalize()
        .multiplyScalar(2 + Math.random() * 4);
      item.velocities[i * 3] = dir.x;
      item.velocities[i * 3 + 1] = dir.y;
      item.velocities[i * 3 + 2] = dir.z;
    }
    pos.needsUpdate = true;
    item.points.material.color.setHex(color);
    item.points.material.opacity = 1;
    item.points.visible = true;
    item.life = 0.26;
  }

  update(dt) {
    for (const item of this.items) {
      if (item.life <= 0) continue;
      item.life -= dt;
      const pos = item.points.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        item.velocities[i * 3 + 1] -= 18 * dt;
        pos.setXYZ(
          i,
          pos.getX(i) + item.velocities[i * 3] * dt,
          pos.getY(i) + item.velocities[i * 3 + 1] * dt,
          pos.getZ(i) + item.velocities[i * 3 + 2] * dt,
        );
      }
      pos.needsUpdate = true;
      item.points.material.opacity = Math.max(0, item.life / 0.26);
      if (item.life <= 0) item.points.visible = false;
    }
  }
}
