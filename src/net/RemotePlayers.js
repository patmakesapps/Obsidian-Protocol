import * as THREE from 'three';
import { CONFIG, WEAPONS } from '../config.js';
import { Character, buildPlaceholderTrooper } from '../entities/Character.js';

/**
 * Selectable multiplayer characters. Purely cosmetic — every choice keeps the
 * standard player capsule so nobody buys a smaller hitbox. The drone hovers:
 * its model floats at chest height inside the same capsule.
 */
export const CHARACTERS = {
  ivory: { label: 'IVORY TROOPER', model: () => CONFIG.ally.model, hover: 0, modelHeight: null },
  obsidian: { label: 'OBSIDIAN TROOPER', model: () => CONFIG.enemy.model, hover: 0, modelHeight: null },
  drone: { label: 'DRONE', model: () => CONFIG.drone.model, hover: 1.05, modelHeight: 0.9 },
};

/** A valid character id, falling back to the default trooper. */
export function normalizeChar(id) {
  return CHARACTERS[id] ? id : 'ivory';
}

const REMOTE_TRACERS = 16;
// Render remote players this far in the past, so there are always two known
// snapshots to interpolate between. 120ms of latency you can't feel in a
// target; rubber-banding you can.
const INTERP_DELAY = 0.12;
const SNAPSHOT_KEEP = 1.5; // seconds of history to hold

/**
 * Billboard name tag drawn once into a canvas. DOM would be crisper, but a
 * sprite clips behind walls correctly for free, which matters more — a name
 * glowing through solid cover is a wallhack.
 */
function makeNameTag(name, colorHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const color = `#${colorHex.toString(16).padStart(6, '0')}`;

  ctx.font = '700 64px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  ctx.fillText(name, 256, 56);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(1.7, 0.42, 1);
  return sprite;
}

/**
 * One other player in the match.
 *
 * Owns a character model, a name tag, the glowing identity ring at its feet,
 * and a kinematic capsule so local hitscan and projectiles connect with it.
 * It renders from a buffer of timestamped snapshots rather than snapping to
 * the latest packet — see INTERP_DELAY.
 */
export class RemotePlayer {
  constructor({ scene, physics, id, name, color, model, position, char = 'ivory' }) {
    this.scene = scene;
    this.physics = physics;
    this.id = id;
    this.name = name;
    this.color = color;
    this.char = CHARACTERS[char] ? char : 'ivory';

    this.faction = 'remote'; // its own faction: shootable, no friendly-fire skip
    this.height = CONFIG.player.standHeight;
    this.alive = true;
    this.health = CONFIG.player.maxHealth; // mirror for hit prediction only
    this.removed = false;

    this.position = position?.clone() ?? new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.time = 0;
    this._deadFor = 0;

    /** @type {Array<{t:number,x:number,y:number,z:number,yaw:number,alive:boolean}>} */
    this.snapshots = [];

    const def = CHARACTERS[this.char];
    this.character = new Character(
      model ?? { scene: buildPlaceholderTrooper(this.height, 0x3a3d52) },
      { targetHeight: def.modelHeight ?? this.height },
    );
    this.root = this.character.root;
    this.root.position.copy(this.position);
    // Invisible until the first state packet places them — otherwise a joiner
    // stands at the world origin for a beat.
    this.root.visible = false;
    scene.add(this.root);
    this.character.play('idle');
    this.character.calibrateToFeet();
    // Drones float: lift the model inside the capsule, ring stays grounded.
    if (def.hover) this.character.body.position.y += def.hover;

    // Identity ring: a flat glowing band at the feet in the player's colour,
    // so you can tell who is who at a glance across the map.
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.78, 40),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.06;
    this.root.add(this.ring);

    // A dimmer solid disc inside the band, so the ring reads even on bright ground.
    this.ringFill = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.ringFill.rotation.x = -Math.PI / 2;
    this.ringFill.position.y = 0.055;
    this.root.add(this.ringFill);

    this.nameTag = makeNameTag(name, color);
    this.nameTag.position.y = def.hover
      ? def.hover + (def.modelHeight ?? 1) * 0.5 + 0.5
      : this.height + 0.42;
    this.root.add(this.nameTag);

    this._addBody();
  }

  _addBody() {
    if (this.body) return;
    const rig = this.physics.addCharacter(
      { x: this.position.x, y: this.position.y + this.height / 2, z: this.position.z },
      CONFIG.player.radius,
      this.height,
      this,
    );
    this.body = rig.body;
    this.collider = rig.collider;
    this.controller = rig.controller;
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

  get isDead() {
    return !this.alive;
  }

  get eyePosition() {
    return new THREE.Vector3(
      this.position.x,
      this.position.y + this.height - CONFIG.player.eyeDrop,
      this.position.z,
    );
  }

  /**
   * Something local connected with this avatar. Damage is not applied here —
   * the victim's own client owns its health. What we do is route by source:
   * the local player's shots become PvP hit messages, and (on the sim host)
   * AI bolts/melee become forwarded AI damage. Health only mirrors so
   * kill-shot prediction reads right.
   */
  takeDamage(amount) {
    const fromAI = this.lastHitFaction === 'enemy';
    this.lastHitFaction = null;
    this.character.flash(1);
    if (fromAI) {
      this.onAIHit?.(this, amount);
      return;
    }
    this.health = Math.max(0, this.health - amount);
    this.onLocalHit?.(this, amount, !!this.lastHitWasHeadshot);
  }

  /** Fresh state packet from the network. */
  pushSnapshot(msg, now) {
    if (!this.root.visible && !this.snapshots.length) {
      this.root.visible = true;
      this.position.set(msg.p[0], msg.p[1], msg.p[2]);
    }
    const wasAlive = this.snapshots.length ? this.snapshots[this.snapshots.length - 1].alive : true;
    this.snapshots.push({
      t: now,
      x: msg.p[0],
      y: msg.p[1],
      z: msg.p[2],
      yaw: msg.yaw ?? 0,
      alive: msg.alive !== false,
    });
    while (this.snapshots.length > 2 && now - this.snapshots[0].t > SNAPSHOT_KEEP) {
      this.snapshots.shift();
    }
    if (!wasAlive && msg.alive !== false) this._onRespawned();
    if (wasAlive && msg.alive === false) this._onDied();
  }

  _onDied() {
    this.alive = false;
    this._deadFor = 0;
    this.health = 0;
    // Corpses stop blocking shots immediately, same rule as AI actors.
    this._removeBody();
    this.ring.visible = false;
    this.ringFill.visible = false;
    this.nameTag.visible = false;
    if (!this.character.play('death', { loop: false, clampWhenFinished: true, fade: 0.12 })) {
      this._proceduralTopple = true;
    }
  }

  _onRespawned() {
    this.alive = true;
    this.health = CONFIG.player.maxHealth;
    this._proceduralTopple = false;
    this.character.body.rotation.x = 0;
    this.character.root.visible = true;
    this.ring.visible = true;
    this.ringFill.visible = true;
    this.nameTag.visible = true;
    this.character.play('idle');
    this._addBody();
    // Old snapshots point at the corpse; render from the respawn only.
    this.snapshots = this.snapshots.slice(-1);
  }

  update(dt, now) {
    this.time += dt;
    this.character.update(dt);

    this._interpolate(now);
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;

    if (!this.alive) {
      this._deadFor += dt;
      if (this._proceduralTopple) {
        this.character.body.rotation.x = THREE.MathUtils.damp(
          this.character.body.rotation.x,
          Math.PI / 2.1,
          4,
          dt,
        );
      }
      // Fade the body out after a few seconds; the respawn packet brings it back.
      if (this._deadFor > 4) this.character.root.visible = false;
      return;
    }

    // Ring pulse — enough motion to draw the eye, not enough to distract.
    const pulse = 1 + Math.sin(this.time * 3.2) * 0.06;
    this.ring.scale.setScalar(pulse);

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.character.setLocomotion(speed / CONFIG.player.sprintSpeed);
    if (this.character.isRigged) {
      if (speed > CONFIG.player.walkSpeed * 1.1 && this.character.has('run')) this.character.play('run');
      else if (speed > 0.6) this.character.play('walk');
      else this.character.play('idle');
    }

    if (this.body) {
      this.body.setNextKinematicTranslation({
        x: this.position.x,
        y: this.position.y + this.height / 2,
        z: this.position.z,
      });
    }
  }

  _interpolate(now) {
    const snaps = this.snapshots;
    if (!snaps.length) return;

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

    const prevX = this.position.x;
    const prevZ = this.position.z;
    this.position.set(
      THREE.MathUtils.lerp(a.x, b.x, t),
      THREE.MathUtils.lerp(a.y, b.y, t),
      THREE.MathUtils.lerp(a.z, b.z, t),
    );

    // Derive velocity from actual rendered motion — used only for animation.
    const invDt = 1 / Math.max(1e-3, span * (t > 0 ? 1 : 1));
    this.velocity.set((b.x - a.x) * invDt, 0, (b.z - a.z) * invDt);
    if (Number.isNaN(this.velocity.x)) this.velocity.set(this.position.x - prevX, 0, this.position.z - prevZ);

    let dyaw = b.yaw - a.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    this.yaw = a.yaw + dyaw * t;
  }

  dispose() {
    if (this.removed) return;
    this.removed = true;
    this._removeBody();
    this.character.dispose();
  }
}

/**
 * The set of everyone else in the match, plus the shared visuals for their
 * fire: a tracer pool and muzzle flashes routed through the existing
 * projectile flash pool (no new lights — light count changes recompile every
 * shader in the scene).
 */
export class RemotePlayers {
  constructor({ scene, physics, assets, audio, projectiles }) {
    this.scene = scene;
    this.physics = physics;
    this.assets = assets;
    this.audio = audio;
    this.projectiles = projectiles;

    /** @type {Map<number, RemotePlayer>} */
    this.players = new Map();
    this.onLocalHit = null;

    this._buildTracerPool();
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
  }

  get count() {
    return this.players.size;
  }

  /** Spawns an avatar for a newly seen player. Async because the model loads lazily. */
  async ensure({ id, name, color, char = 'ivory' }) {
    if (this.players.has(id)) return this.players.get(id);

    // Reserve the slot synchronously so a burst of state packets while the
    // model loads doesn't spawn duplicates.
    this.players.set(id, null);
    const def = CHARACTERS[char] ?? CHARACTERS.ivory;
    const model = await this.assets.instantiate(def.model());
    if (!this.players.has(id)) return null; // removed while the model loaded

    const player = new RemotePlayer({
      scene: this.scene,
      physics: this.physics,
      id,
      name,
      color,
      char,
      model,
    });
    player.onLocalHit = (p, damage, headshot) => this.onLocalHit?.(p, damage, headshot);
    player.onAIHit = (p, damage) => this.onAIHit?.(p, damage);
    this.players.set(id, player);
    return player;
  }

  get(id) {
    return this.players.get(id) ?? null;
  }

  remove(id) {
    const player = this.players.get(id);
    player?.dispose();
    this.players.delete(id);
  }

  state(msg, now) {
    const player = this.players.get(msg.id);
    if (!player) return; // still loading (null) or unknown — caller handles unknown ids

    // Character rides along in every state packet, so a pick that was missed
    // at join time (or changed mid-match) converges within a tick: rebuild
    // the avatar with the right model.
    if (msg.c && player.char !== normalizeChar(msg.c)) {
      const { name, color } = player;
      this.remove(msg.id);
      this.ensure({ id: msg.id, name, color, char: msg.c });
      return;
    }
    player.pushSnapshot(msg, now);
  }

  /** Remote shot: tracer from their muzzle to their hit point, flash, report. */
  fire(msg) {
    const def = WEAPONS[msg.w] ?? WEAPONS.vanguard;
    this._from.fromArray(msg.from);
    this._to.fromArray(msg.to);
    this._spawnTracer(this._from, this._to, def.tracerColor);
    this.projectiles.flash(this._from, def.muzzleColor, 26);
    this.audio?.enemyShoot?.('ally');
  }

  update(dt, now) {
    for (const player of this.players.values()) player?.update(dt, now);
    this._updateTracers(dt);
  }

  dispose() {
    for (const player of this.players.values()) player?.dispose();
    this.players.clear();
  }

  // ---------------------------------------------------------------- tracers

  _buildTracerPool() {
    this.tracers = [];
    const geo = new THREE.CylinderGeometry(0.013, 0.013, 1, 5, 1, true);
    geo.translate(0, 0.5, 0);
    geo.rotateX(Math.PI / 2);
    for (let i = 0; i < REMOTE_TRACERS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
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

  _spawnTracer(from, to, color) {
    const t = this.tracers[this._tracerCursor];
    this._tracerCursor = (this._tracerCursor + 1) % this.tracers.length;
    t.mesh.material.color.setHex(color);
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, from.distanceTo(to));
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
}
