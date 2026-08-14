import * as THREE from 'three';
import { PALETTE } from '../config.js';
import { makeRandom } from '../core/noise.js';

const SEED = 777;

/** Playable square, wall to wall. Small on purpose: this is the PvP arena. */
const ARENA = 96;
const WALL_HEIGHT = 7;

/**
 * The Pit — a compact walled arena built for multiplayer.
 *
 * Everything is symmetric under a quarter turn, so no spawn quadrant owns
 * better cover than another. A raised central platform with four ramps is the
 * contested middle; barrier lines and crate clusters break up the sightlines
 * between it and the walls. All procedural — no GLB props to load, so it's
 * also the fastest level to boot.
 */
export class ArenaLevel {
  constructor(scene, physics, assets) {
    this.scene = scene;
    this.physics = physics;
    this.assets = assets;
    this.spawnPoints = [];
    this.coverPoints = [];
    this._blockers = [];

    // The Pit inverts the game's usual palette: where the arcology is white
    // architecture with violet light, this is polished obsidian with molten
    // amber seams — a black-site fighting pit, not a city block.
    this._shell = new THREE.MeshStandardMaterial({
      color: 0x757b8f,
      roughness: 0.55,
      metalness: 0.2,
    });
    this._dark = new THREE.MeshStandardMaterial({
      color: 0x3c3f4e,
      roughness: 0.65,
      metalness: 0.18,
    });
    // Molten amber — the arena's primary accent.
    this._glow = new THREE.MeshStandardMaterial({
      color: PALETTE.black,
      emissive: PALETTE.amber,
      emissiveIntensity: 3.0,
      roughness: 0.35,
      metalness: 0.5,
    });
    // Violet kept as the rare secondary accent so it still reads as the same
    // universe — pylon caps and the centre ring only.
    this._amberGlow = new THREE.MeshStandardMaterial({
      color: PALETTE.black,
      emissive: PALETTE.purple,
      emissiveIntensity: 1.9,
      roughness: 0.35,
      metalness: 0.5,
    });
  }

  heightAt() {
    // The centre platform is climbable via ramps, but the character controller
    // handles that from collision; spawns and AI treat the floor as flat and
    // simply never spawn on the platform (it's inside a blocker circle).
    return 0;
  }

  isOpenGround(x, z) {
    const half = ARENA / 2;
    if (Math.abs(x) > half - 2.5 || Math.abs(z) > half - 2.5) return false;
    for (const s of this._blockers) {
      const dx = s.x - x;
      const dz = s.z - z;
      if (dx * dx + dz * dz < s.r * s.r) return false;
    }
    return true;
  }

  async build() {
    this._buildFloor();
    this._buildWalls();
    this._buildCentre();
    this._buildCover();
    this._buildLightRibbons();
    this._buildSpawnPoints();
  }

  // ------------------------------------------------------------------ floor

  _buildFloor() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA, ARENA), this._shell);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.physics.addStaticBox(
      { x: ARENA / 2, y: 2, z: ARENA / 2 },
      { x: 0, y: -2, z: 0 },
      null,
      { type: 'ground' },
    );

    // Cross-lanes to the middle: a dark runway with a molten seam down the
    // centre of each — the seams are the arena's main light source read.
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(3.4, ARENA), this._dark);
    lane.rotation.x = -Math.PI / 2;
    lane.position.y = 0.01;
    const lane2 = lane.clone();
    lane2.rotation.z = Math.PI / 2;
    this.scene.add(lane, lane2);

    const seam = new THREE.Mesh(new THREE.PlaneGeometry(0.8, ARENA), this._glow);
    seam.rotation.x = -Math.PI / 2;
    seam.position.y = 0.02;
    const seam2 = seam.clone();
    seam2.rotation.z = Math.PI / 2;
    this.scene.add(seam, seam2);

    // Thin molten border where the floor meets the walls.
    for (const [x, z, w, d] of [
      [0, -ARENA / 2 + 1.2, ARENA - 4, 0.3],
      [0, ARENA / 2 - 1.2, ARENA - 4, 0.3],
      [-ARENA / 2 + 1.2, 0, 0.3, ARENA - 4],
      [ARENA / 2 - 1.2, 0, 0.3, ARENA - 4],
    ]) {
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this._glow);
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(x, 0.02, z);
      this.scene.add(edge);
    }
  }

  // ------------------------------------------------------------------ walls

  _buildWalls() {
    const half = ARENA / 2;
    const t = 1.2; // wall thickness

    for (const [x, z, w, d] of [
      [0, -half, ARENA + t * 2, t],
      [0, half, ARENA + t * 2, t],
      [-half, 0, t, ARENA],
      [half, 0, t, ARENA],
    ]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_HEIGHT, d), this._shell);
      wall.position.set(x, WALL_HEIGHT / 2, z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.scene.add(wall);
      this.physics.addStaticBox(
        { x: w / 2, y: WALL_HEIGHT / 2, z: d / 2 },
        { x, y: WALL_HEIGHT / 2, z },
        null,
        { type: 'boundary' },
      );

      // Glowing rail along the top so the boundary reads at a glance.
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w * 1.001, 0.22, d * 1.001), this._glow);
      rail.position.set(x, WALL_HEIGHT + 0.11, z);
      this.scene.add(rail);
    }

    // Corner pylons — landmarks for calling positions.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const px = sx * (half - 3.4);
        const pz = sz * (half - 3.4);
        const pylon = new THREE.Mesh(new THREE.BoxGeometry(2.6, WALL_HEIGHT + 4, 2.6), this._dark);
        pylon.position.set(px, (WALL_HEIGHT + 4) / 2, pz);
        pylon.castShadow = true;
        this.scene.add(pylon);
        this.physics.addStaticBox(
          { x: 1.3, y: (WALL_HEIGHT + 4) / 2, z: 1.3 },
          { x: px, y: (WALL_HEIGHT + 4) / 2, z: pz },
          null,
          { type: 'boundary' },
        );
        this._blockers.push({ x: px, z: pz, r: 2.9 });

        const cap = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.3, 2.8), this._amberGlow);
        cap.position.set(px, WALL_HEIGHT + 4.15, pz);
        this.scene.add(cap);
      }
    }
  }

  // ------------------------------------------------------------ centre stage

  _buildCentre() {
    // Raised platform, low enough to walk up via ramps (auto-step handles the
    // 0.45m lip where ramps meet it).
    const size = 14;
    const h = 1.1;

    const deck = new THREE.Mesh(new THREE.BoxGeometry(size, h, size), this._shell);
    deck.position.y = h / 2;
    deck.castShadow = true;
    deck.receiveShadow = true;
    this.scene.add(deck);
    this.physics.addStaticBox(
      { x: size / 2, y: h / 2, z: size / 2 },
      { x: 0, y: h / 2, z: 0 },
      null,
      { type: 'cover' },
    );

    const trim = new THREE.Mesh(new THREE.BoxGeometry(size + 0.3, 0.12, size + 0.3), this._glow);
    trim.position.y = h + 0.06;
    this.scene.add(trim);

    // Four ramps up, one per lane. Rotation is composed explicitly — yaw to
    // the lane, then pitch in the yawed frame — so every ramp rises toward the
    // deck, and the physics box gets the identical quaternion.
    const rampLen = 6;
    const rampW = 3.2;
    const tilt = Math.atan2(h, rampLen); // positive pitch raises the local -Z (deck-side) end
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const dist = size / 2 + rampLen / 2 - 0.2;
      const x = Math.sin(angle) * dist;
      const z = Math.cos(angle) * dist;

      // Local -Z must point at the deck: the ramp sits along +[sin,cos]·dist,
      // so yaw by `angle` puts local +Z on that outward direction.
      const q = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt));

      const ramp = new THREE.Mesh(new THREE.BoxGeometry(rampW, 0.4, rampLen + 1), this._dark);
      ramp.position.set(x, h / 2 - 0.1, z);
      ramp.quaternion.copy(q);
      ramp.receiveShadow = true;
      this.scene.add(ramp);

      this.physics.addStaticBox(
        { x: rampW / 2, y: 0.2, z: (rampLen + 1) / 2 },
        { x, y: h / 2 - 0.1, z },
        q,
        { type: 'cover' },
      );
    }

    // AI never paths onto the platform; players are free to.
    this._blockers.push({ x: 0, z: 0, r: size / 2 + rampLen + 0.5 });
    this.coverPoints.push(new THREE.Vector3(0, 0, 0));
  }

  // ------------------------------------------------------------------ cover

  /** Quarter-turn-symmetric barriers and crate clusters. */
  _buildCover() {
    const rand = makeRandom(SEED);

    // One quadrant's layout, echoed into all four by rotation.
    const quadrant = [
      { x: 22, z: 8, w: 5.2, d: 1.0, h: 1.35 }, // long barrier
      { x: 13, z: 20, w: 1.0, d: 4.6, h: 1.35 }, // long barrier, turned
      { x: 30, z: 26, w: 2.2, d: 2.2, h: 1.9 }, // tall crate — blocks sight
      { x: 33, z: 27.5, w: 1.4, d: 1.4, h: 1.0 }, // step crate beside it
      { x: 9, z: 34, w: 3.6, d: 1.0, h: 1.35 }, // wall-line barrier
    ];

    const boxes = [];
    for (let turn = 0; turn < 4; turn++) {
      const sin = Math.sin((turn * Math.PI) / 2);
      const cos = Math.cos((turn * Math.PI) / 2);
      for (const c of quadrant) {
        const x = c.x * cos - c.z * sin;
        const z = c.x * sin + c.z * cos;
        // Swap footprint on odd turns so barriers stay aligned to their lane.
        const w = turn % 2 ? c.d : c.w;
        const d = turn % 2 ? c.w : c.d;
        boxes.push({ x, z, w, d, h: c.h });
      }
    }

    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this._shell, boxes.length);
    const caps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.1, 1), this._glow, boxes.length);
    body.castShadow = true;
    body.receiveShadow = true;

    const dummy = new THREE.Object3D();
    boxes.forEach((c, i) => {
      dummy.position.set(c.x, c.h / 2, c.z);
      dummy.scale.set(c.w, c.h, c.d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      body.setMatrixAt(i, dummy.matrix);

      dummy.position.set(c.x, c.h + 0.05, c.z);
      dummy.scale.set(c.w * 1.05, 1, c.d * 1.05);
      dummy.updateMatrix();
      caps.setMatrixAt(i, dummy.matrix);

      this.physics.addStaticBox(
        { x: c.w / 2, y: c.h / 2, z: c.d / 2 },
        { x: c.x, y: c.h / 2, z: c.z },
        null,
        { type: 'cover' },
      );
      this.coverPoints.push(new THREE.Vector3(c.x, 0, c.z));
      this._blockers.push({ x: c.x, z: c.z, r: Math.hypot(c.w, c.d) / 2 + 0.8 });
    });
    body.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    this.scene.add(body, caps);

    void rand; // seed reserved for future scatter passes
  }

  /** Violet ring circling the platform — the one cool accent in a hot arena. */
  _buildLightRibbons() {
    const ring = new THREE.Mesh(new THREE.RingGeometry(11.4, 11.9, 64), this._amberGlow);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    this.scene.add(ring);
  }

  // ------------------------------------------------------------------ spawns

  _buildSpawnPoints() {
    const rand = makeRandom(SEED + 11);

    // A ring of guaranteed spots near the walls (out of centre sightlines) plus
    // random fill, all validated against cover blockers.
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const r = ARENA / 2 - 9;
      const x = Math.sin(angle) * r;
      const z = Math.cos(angle) * r;
      if (this.isOpenGround(x, z)) this.spawnPoints.push(new THREE.Vector3(x, 0, z));
    }
    let guard = 0;
    while (this.spawnPoints.length < 40 && guard++ < 3000) {
      const half = ARENA / 2 - 8;
      const x = (rand() * 2 - 1) * half;
      const z = (rand() * 2 - 1) * half;
      if (!this.isOpenGround(x, z)) continue;
      this.spawnPoints.push(new THREE.Vector3(x, 0, z));
    }
  }

  randomSpawnPoint(rand = Math.random) {
    return this.spawnPoints[Math.floor(rand() * this.spawnPoints.length)];
  }
}
