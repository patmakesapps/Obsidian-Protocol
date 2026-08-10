import * as THREE from 'three';
import { CONFIG, PALETTE } from '../config.js';
import { makeRandom } from '../core/noise.js';
import { scatter, place } from './props.js';

const SEED = 31337;

/**
 * Inner cliff slabs are fitted to this longest dimension. The source mesh is
 * 27.41 tall x 17.89 wide x 13.57 deep, and height is its longest axis, so a
 * slab ends up CLIFF_SIZE tall and these fractions across and through.
 */
const CLIFF_SIZE = 62;
const CLIFF_WIDTH = CLIFF_SIZE * (17.89 / 27.41);
const CLIFF_DEPTH = CLIFF_SIZE * (13.57 / 27.41);

/**
 * Verdant Basin — an abandoned research outpost grown over by jungle.
 *
 * The floor is deliberately, entirely flat. The AI has no navmesh and steers in
 * straight lines, so any real terrain would strand hostiles on geometry they
 * can't path around. All the verticality here is *scenery*: the habitat discs
 * hang overhead on piers, the cliff ring is out past the boundary wall, and
 * nothing the player fights on is ever more than a step high. What the level
 * gets from the concept art is its silhouette and its light, not its
 * topography.
 *
 * Cover comes from boulders, crates and tree trunks scattered on that flat
 * plane, spaced far enough apart that a hostile walking a straight line at you
 * still finds a way through.
 */
export class JungleLevel {
  /** Box around the player's start that no prop collider may intrude on. */
  static SPAWN_KEEPOUT = new THREE.Box3(
    new THREE.Vector3(-8, -1, -4),
    new THREE.Vector3(8, 14, 16),
  );

  static SKY = 'basin';
  static NAME = 'VERDANT BASIN';
  static LOADING_LABEL = 'SEEDING THE BASIN';

  constructor(scene, physics, assets) {
    this.scene = scene;
    this.physics = physics;
    this.assets = assets;

    this.spawnPoints = [];
    this.coverPoints = [];
    this.buildings = [];

    this.radius = CONFIG.world.basinRadius;
    this.time = 0;

    // `_solids` is what gameplay must not spawn inside — structures, boulders,
    // trunks, pools. `_claims` additionally holds the spacing reservations of
    // every scattered fern and bush, which matter for placement but shouldn't
    // stop a supply crate from dropping in the undergrowth.
    this._solids = [];
    this._claims = [];
    this._falls = [];
    this._mist = [];

    // Declared up front because the treeline has to leave gaps for them —
    // planted blind, the cliff-base skirt grew straight over every waterfall.
    // Heights are matched to the cliff band behind each one.
    this.fallSpecs = [
      { angle: -1.95, width: 14, height: 86 },
      { angle: -1.35, width: 9, height: 74 },
      { angle: -2.6, width: 11, height: 80 },
      { angle: 0.9, width: 10, height: 66 },
      { angle: 2.6, width: 12, height: 72 },
    ];
  }

  /** True when this bearing is inside the clear window in front of a waterfall. */
  _facesWaterfall(angle, window = 0.16) {
    return this.fallSpecs.some((f) => {
      const delta = Math.abs(((angle - f.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      return delta < window;
    });
  }

  /** Flat by design — see the class comment. */
  heightAt() {
    return 0;
  }

  isOpenGround(x, z) {
    if (x * x + z * z > (this.radius - 10) ** 2) return false;
    for (const s of this._solids) {
      const dx = s.x - x;
      const dz = s.z - z;
      if (dx * dx + dz * dz < s.r * s.r) return false;
    }
    return true;
  }

  async build() {
    this._buildGround();
    this._buildBoundary();
    await this._buildCliffRing();
    await this._buildOutpost();
    await this._buildScatter();
    this._buildWater();
    this._buildSpawnPoints();
  }

  // ------------------------------------------------------------------ ground

  _buildGround() {
    const material = new THREE.MeshStandardMaterial({
      color: 0xa9b39c,
      roughness: 0.95,
      metalness: 0.0,
      map: makeBasinTexture(),
    });
    material.map.repeat.set(this.radius / 5, this.radius / 5);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(this.radius + 14, 64), material);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.ground = floor;

    // A thick slab rather than a plane collider so nothing can tunnel through.
    this.physics.addStaticBox(
      { x: this.radius + 20, y: 2, z: this.radius + 20 },
      { x: 0, y: -2, z: 0 },
      null,
      { type: 'ground' },
    );

    // Darker mulch patches break up the flat colour where the canopy is thick.
    const rand = makeRandom(SEED + 3);
    const patchMat = new THREE.MeshStandardMaterial({
      color: 0x6f7d5f,
      roughness: 0.98,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const patches = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 10), patchMat, 90);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 90; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * (this.radius - 12);
      dummy.position.set(Math.cos(a) * d, 0.015, Math.sin(a) * d);
      dummy.rotation.set(-Math.PI / 2, 0, rand() * Math.PI);
      dummy.scale.setScalar(4 + rand() * 9);
      dummy.updateMatrix();
      patches.setMatrixAt(i, dummy.matrix);
    }
    patches.receiveShadow = true;
    this.scene.add(patches);
  }

  /**
   * A ring of boxes standing in for the cliff wall. The cliff meshes themselves
   * are decorative and sit further out — colliding against their real shape
   * would let the player wedge into crevices the AI can't follow them into.
   */
  _buildBoundary() {
    const segments = 36;
    const r = this.radius;
    const width = 2 * r * Math.sin(Math.PI / segments) + 4;

    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const x = Math.cos(a) * (r + 1.5);
      const z = Math.sin(a) * (r + 1.5);
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0));
      this.physics.addStaticBox(
        { x: width / 2, y: 60, z: 2 },
        { x, y: 30, z },
        { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
        { type: 'boundary' },
      );
    }
  }

  // ------------------------------------------------------------------- cliffs

  async _buildCliffRing() {
    const rand = makeRandom(SEED + 11);

    // Inner wall: what the player actually reads as "the canyon side".
    // The polar coordinates of each slab are kept, because the foliage pass
    // needs to know where the rock actually *is* — see _buildCanopyWall.
    const inner = [];
    const innerCount = 44;
    for (let i = 0; i < innerCount; i++) {
      const a = (i / innerCount) * Math.PI * 2 + (rand() - 0.5) * 0.05;
      const d = this.radius + 14 + rand() * 8;
      const scale = 0.85 + rand() * 0.55;
      inner.push({
        position: new THREE.Vector3(Math.cos(a) * d, -4 - rand() * 5, Math.sin(a) * d),
        rotationY: -a + Math.PI / 2 + (rand() - 0.5) * 0.5,
        scale,
        tilt: { x: (rand() - 0.5) * 0.12, z: (rand() - 0.5) * 0.12 },
        angle: a,
        dist: d,
      });
    }
    await scatter(this.scene, this.assets, '/models/jungle/jungle_cliff.glb', inner, {
      targetSize: CLIFF_SIZE,
      castShadow: true,
    });
    this._innerCliffs = inner;

    // Outer massif: taller, hazier, purely a backdrop. No shadow casting — it
    // is well outside the shadow frustum and would only cost fill.
    const outer = [];
    const outerCount = 30;
    for (let i = 0; i < outerCount; i++) {
      const a = (i / outerCount) * Math.PI * 2 + rand() * 0.1;
      const d = this.radius + 62 + rand() * 40;
      outer.push({
        position: new THREE.Vector3(Math.cos(a) * d, -8 - rand() * 10, Math.sin(a) * d),
        rotationY: -a + Math.PI / 2 + (rand() - 0.5) * 0.6,
        scale: 1.5 + rand() * 1.1,
        tilt: { x: (rand() - 0.5) * 0.1, z: (rand() - 0.5) * 0.1 },
      });
    }
    await scatter(this.scene, this.assets, '/models/jungle/jungle_cliff.glb', outer, {
      targetSize: 85,
      castShadow: false,
      receiveShadow: false,
    });

    await this._buildCanopyWall(rand);
  }

  /**
   * Vegetation on and below the cliff ring.
   *
   * Bare cliff geometry reads as grey cutouts — the concept art's canyon is
   * green all the way up, and it's the growth on the rock that makes the
   * outpost look reclaimed rather than newly built. These are pure backdrop:
   * they sit beyond the boundary wall, get no colliders, and cast no shadows.
   */
  async _buildCanopyWall(rand) {
    // Anything on the cliff is placed *per slab*, not on a blind ring around
    // the basin. The slabs vary in radius, height and scale and don't tile
    // edge to edge, so a ring at a fixed radius drops a third of its foliage
    // into the gaps between them, hanging in mid-air.
    const onCliffs = [];
    const onLedges = [];

    for (const cliff of this._innerCliffs ?? []) {
      const height = CLIFF_SIZE * cliff.scale;
      const top = cliff.position.y + height;
      // Half the slab's width expressed as an angle at its own radius, so
      // offsets stay inside the rock face however far out the slab sits.
      const halfArc = (CLIFF_WIDTH * cliff.scale * 0.42) / cliff.dist;

      // Clifftop canopy: sunk a few metres into the top so it reads as planted
      // rather than balanced on the edge.
      for (let i = 0; i < 3; i++) {
        const a = cliff.angle + (rand() - 0.5) * 2 * halfArc;
        const d = cliff.dist + (rand() - 0.5) * CLIFF_DEPTH * cliff.scale * 0.5;
        onCliffs.push({
          position: new THREE.Vector3(Math.cos(a) * d, top - 3 - rand() * 4, Math.sin(a) * d),
          rotationY: rand() * Math.PI * 2,
          scale: 0.8 + rand() * 0.7,
        });
      }

      // Growth on the inner face, set just inside the rock so it pokes out of
      // it instead of floating in front.
      for (let i = 0; i < 4; i++) {
        const a = cliff.angle + (rand() - 0.5) * 2 * halfArc;
        const d = cliff.dist - CLIFF_DEPTH * cliff.scale * 0.4;
        onLedges.push({
          position: new THREE.Vector3(
            Math.cos(a) * d,
            6 + rand() * (height * 0.62),
            Math.sin(a) * d,
          ),
          rotationY: rand() * Math.PI * 2,
          scale: 1.2 + rand() * 1.6,
        });
      }
    }

    await scatter(this.scene, this.assets, '/models/jungle/jungle_tree.glb', onCliffs, {
      targetSize: 15,
      castShadow: false,
      receiveShadow: false,
    });
    await scatter(this.scene, this.assets, '/models/jungle/jungle_bush.glb', onLedges, {
      targetSize: 4.5,
      castShadow: false,
      receiveShadow: false,
    });

    // A dense skirt at the cliff base, which is what actually hides the seam
    // where the boundary wall meets the flat floor.
    const skirt = [];
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2 + rand() * 0.06;
      if (this._facesWaterfall(a)) continue;
      const d = this.radius - 8 + rand() * 20;
      skirt.push({
        position: new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d),
        rotationY: rand() * Math.PI * 2,
        scale: 0.75 + rand() * 0.7,
      });
    }
    await scatter(this.scene, this.assets, '/models/jungle/jungle_tree.glb', skirt, {
      targetSize: 15,
      castShadow: false,
    });

    const palms = [];
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2 + rand() * 0.1;
      if (this._facesWaterfall(a)) continue;
      const d = this.radius - 12 + rand() * 22;
      palms.push({
        position: new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d),
        rotationY: rand() * Math.PI * 2,
        scale: 0.8 + rand() * 0.6,
      });
    }
    await scatter(this.scene, this.assets, '/models/jungle/jungle_palm.glb', palms, {
      targetSize: 13,
      castShadow: false,
    });
  }

  // ------------------------------------------------------------------ outpost

  /**
   * The habitat modules. Anything above head height is decoration and gets no
   * collider; anything on the floor gets one from its own bounds.
   */
  async _buildOutpost() {
    const rand = makeRandom(SEED + 21);

    // --- Hero: two disc habitats on piers, framing the basin's far side.
    const piers = [
      { at: new THREE.Vector3(-38, 0, -118), pier: 34, disc: 34, spin: 0.4 },
      { at: new THREE.Vector3(66, 0, -96), pier: 26, disc: 24, spin: -1.1 },
    ];
    for (const p of piers) {
      const column = await place(this.scene, this.assets, '/models/jungle/jungle_column.glb', {
        position: p.at,
        rotationY: p.spin,
        targetSize: p.pier,
      });
      if (column) {
        this._addBoxCollider(column.box, 'structure', 0.55);
        this._claim(p.at.x, p.at.z, p.pier * 0.25, true);
      }

      await place(this.scene, this.assets, '/models/jungle/jungle_hab_disc.glb', {
        position: new THREE.Vector3(p.at.x, p.pier - 1.5, p.at.z),
        rotationY: p.spin + 0.6,
        targetSize: p.disc,
      });
    }

    // --- Modules cantilevered off the cliff ring, at canopy height.
    // Anchored to specific cliff slabs and set back into the rock, so each one
    // reads as bolted to a face. Placed on a plain ring they hung in the gaps
    // between slabs with nothing behind them.
    const perched = [];
    const podPerch = [];
    const slabs = this._innerCliffs ?? [];
    for (let i = 0; i < 8 && slabs.length; i++) {
      const cliff = slabs[Math.floor((i / 8) * slabs.length + 2) % slabs.length];
      const height = CLIFF_SIZE * cliff.scale;
      const inset = CLIFF_DEPTH * cliff.scale * 0.42;
      const a = cliff.angle + (rand() - 0.5) * 0.06;
      const d = cliff.dist - inset;
      const target = i % 2 === 0 ? perched : podPerch;
      target.push({
        // Kept in the lower half of the slab so a module never pokes out above
        // the clifftop it is supposed to be hanging from.
        position: new THREE.Vector3(
          Math.cos(a) * d,
          14 + rand() * Math.max(6, height * 0.35),
          Math.sin(a) * d,
        ),
        rotationY: -a + Math.PI / 2 + (rand() - 0.5) * 0.2,
        scale: 0.85 + rand() * 0.4,
      });
    }
    await scatter(this.scene, this.assets, '/models/jungle/jungle_hab_block.glb', perched, {
      targetSize: 16,
    });
    await scatter(this.scene, this.assets, '/models/jungle/jungle_hab_pod.glb', podPerch, {
      targetSize: 11,
    });

    // --- Ground level. These are the pieces the fight actually happens around.
    const grounded = [
      { url: 'jungle_hab_dome', at: [46, 0, 34], size: 13, rot: -0.8, radius: 8 },
      { url: 'jungle_hab_dome', at: [-64, 0, -22], size: 15, rot: 2.1, radius: 9 },
      { url: 'jungle_hab_dome', at: [12, 0, 96], size: 12, rot: 0.4, radius: 8 },
      { url: 'jungle_landing_pad', at: [-30, 0, 58], size: 17, rot: 0.9, radius: 9 },
      { url: 'jungle_landing_pad', at: [88, 0, -18], size: 15, rot: -2.2, radius: 8 },
      { url: 'jungle_hab_pod', at: [-92, 0, 62], size: 11, rot: 1.4, radius: 6 },
      { url: 'jungle_hab_pod', at: [58, 0, 88], size: 10, rot: -0.5, radius: 6 },
      { url: 'jungle_hab_pod', at: [-14, 0, -66], size: 11, rot: 2.7, radius: 6 },
      { url: 'jungle_antenna', at: [24, 0, -34], size: 10, rot: 0.2, radius: 3 },
      { url: 'jungle_antenna', at: [-76, 0, 14], size: 9, rot: 1.1, radius: 3 },
      { url: 'jungle_antenna', at: [104, 0, 46], size: 11, rot: -1.6, radius: 3 },
      { url: 'jungle_antenna', at: [-40, 0, 118], size: 10, rot: 2.4, radius: 3 },
    ];

    for (const def of grounded) {
      const position = new THREE.Vector3(def.at[0], 0, def.at[2]);
      const result = await place(this.scene, this.assets, `/models/jungle/${def.url}.glb`, {
        position,
        rotationY: def.rot,
        targetSize: def.size,
      });
      if (!result) continue;

      if (result.box.intersectsBox(JungleLevel.SPAWN_KEEPOUT)) {
        console.warn(`[JungleLevel] "${def.url}" overlapped the spawn keep-out and was skipped.`);
        result.object.removeFromParent();
        continue;
      }

      this._addBoxCollider(result.box, 'structure');
      this._claim(position.x, position.z, def.radius, true);

      // Real measured extents, not targetSize. targetSize is the LONGEST axis,
      // which for a mast or a column is its height — recording that as the
      // footprint claims a 10 m square of ground for a 3 m pole.
      const extent = result.box.getSize(new THREE.Vector3());
      this.buildings.push({
        x: position.x,
        z: position.z,
        w: extent.x,
        d: extent.z,
        h: extent.y,
      });
      this.coverPoints.push(new THREE.Vector3(position.x, 0, position.z));
    }

    // --- Catwalks ledged along the cliff faces. Decorative only, and anchored
    // to slabs for the same reason the modules are.
    const walks = [];
    for (let i = 0; i < 6 && slabs.length; i++) {
      const cliff = slabs[Math.floor((i / 6) * slabs.length + 5) % slabs.length];
      const a = cliff.angle + (rand() - 0.5) * 0.05;
      const d = cliff.dist - CLIFF_DEPTH * cliff.scale * 0.46;
      walks.push({
        position: new THREE.Vector3(Math.cos(a) * d, 12 + rand() * 18, Math.sin(a) * d),
        rotationY: -a,
        scale: 1,
      });
    }
    await scatter(this.scene, this.assets, '/models/jungle/jungle_catwalk.glb', walks, {
      targetSize: 14,
      castShadow: false,
    });
  }

  // ------------------------------------------------------------------ scatter

  async _buildScatter() {
    const rand = makeRandom(SEED + 42);

    // Order matters: the big pieces claim their ground first, then the small
    // stuff fills whatever is left. Each entry's `clearance` is the radius it
    // reserves against everything placed before it.
    const passes = [
      {
        url: 'jungle_rock_b', count: 16, targetSize: 8, clearance: 7,
        scale: [0.8, 1.4], cover: true, collide: 'bounds', solid: 4.0, minFromSpawn: 26,
      },
      {
        url: 'jungle_rock_a', count: 26, targetSize: 4.6, clearance: 5,
        scale: [0.75, 1.35], cover: true, collide: 'bounds', solid: 2.6, minFromSpawn: 20,
      },
      {
        url: 'jungle_tree', count: 78, targetSize: 14, clearance: 7.5,
        scale: [0.7, 1.35], collide: 'trunk', trunk: 0.55, solid: 1.8, minFromSpawn: 22,
      },
      {
        url: 'jungle_palm', count: 46, targetSize: 12, clearance: 6.5,
        scale: [0.75, 1.3], collide: 'trunk', trunk: 0.42, solid: 1.5, minFromSpawn: 22,
      },
      {
        url: 'jungle_crate', count: 30, targetSize: 2.0, clearance: 4,
        scale: [0.85, 1.2], cover: true, collide: 'bounds', solid: 1.7, minFromSpawn: 16,
      },
      {
        url: 'jungle_rock_c', count: 40, targetSize: 2.4, clearance: 3,
        scale: [0.7, 1.5], collide: 'bounds', solid: 1.4, minFromSpawn: 14,
      },
      // Ground cover: no colliders at all. Walking through a fern is correct,
      // and 300 extra static bodies for zero gameplay value is not. They also
      // stay out of `_solids`, so supply drops can still land in undergrowth.
      {
        url: 'jungle_bush', count: 130, targetSize: 2.8, clearance: 2.4,
        scale: [0.7, 1.5], collide: null, minFromSpawn: 10, shadow: false,
      },
      {
        url: 'jungle_fern', count: 190, targetSize: 2.6, clearance: 1.8,
        scale: [0.7, 1.4], collide: null, minFromSpawn: 6, shadow: false,
      },
    ];

    for (const pass of passes) {
      const placements = [];
      let guard = 0;
      while (placements.length < pass.count && guard++ < pass.count * 60) {
        const a = rand() * Math.PI * 2;
        // sqrt keeps the distribution even in area rather than crowding the middle.
        const d = Math.sqrt(rand()) * (this.radius - 14);
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;

        if (Math.hypot(x, z) < pass.minFromSpawn) continue;
        if (!this.isOpenGround(x, z)) continue;
        if (this._occupied(x, z, pass.clearance)) continue;

        placements.push({
          position: new THREE.Vector3(x, 0, z),
          rotationY: rand() * Math.PI * 2,
          scale: pass.scale[0] + rand() * (pass.scale[1] - pass.scale[0]),
        });
        const scale = placements[placements.length - 1].scale;
        this._claim(x, z, pass.clearance, false);
        if (pass.solid) this._solids.push({ x, z, r: pass.solid * scale });
      }

      const result = await scatter(
        this.scene, this.assets, `/models/jungle/${pass.url}.glb`, placements,
        { targetSize: pass.targetSize, castShadow: pass.shadow !== false },
      );
      if (!result) continue;

      placements.forEach((p, i) => {
        const box = result.boxes[i];
        if (box.intersectsBox(JungleLevel.SPAWN_KEEPOUT)) return;

        if (pass.collide === 'bounds') {
          this._addBoxCollider(box, 'prop', 0.9);
        } else if (pass.collide === 'trunk') {
          // Only the trunk blocks. A tree's canopy AABB is 7 m across; using it
          // would turn the treeline into a wall the AI grinds against.
          const height = box.max.y - box.min.y;
          const r = pass.trunk * p.scale;
          this.physics.addStaticBox(
            { x: r, y: height / 2, z: r },
            { x: p.position.x, y: height / 2, z: p.position.z },
            null,
            { type: 'prop' },
          );
        }

        if (pass.cover) this.coverPoints.push(p.position.clone());
      });
    }
  }

  _occupied(x, z, clearance) {
    for (const s of this._claims) {
      const reach = s.r + clearance;
      const dx = s.x - x;
      const dz = s.z - z;
      if (dx * dx + dz * dz < reach * reach) return true;
    }
    return false;
  }

  /** `solid` also blocks gameplay spawns, not just neighbouring scatter. */
  _claim(x, z, r, solid = false) {
    const entry = { x, z, r };
    this._claims.push(entry);
    if (solid) this._solids.push(entry);
  }

  _addBoxCollider(box, type, shrink = 1.0) {
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    this.physics.addStaticBox(
      { x: (size.x / 2) * shrink, y: size.y / 2, z: (size.z / 2) * shrink },
      { x: centre.x, y: centre.y, z: centre.z },
      null,
      { type },
    );
  }

  // -------------------------------------------------------------------- water

  /**
   * Waterfalls down the cliff ring, with a pool and low mist at each base.
   * These are the only animated things in the level; everything else is static.
   */
  _buildWater() {
    const rand = makeRandom(SEED + 77);
    const falls = this.fallSpecs;
    const streakTexture = makeWaterTexture();

    for (const fall of falls) {
      // Just *inside* the boundary wall. Placed at the cliff radius the sheets
      // ended up buried in the rock, since a cliff instance is 30 m deep.
      const d = this.radius - 2;
      const x = Math.cos(fall.angle) * d;
      const z = Math.sin(fall.angle) * d;
      const facing = Math.atan2(-x, -z);

      const material = new THREE.MeshBasicMaterial({
        map: streakTexture.clone(),
        color: 0xffffff,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true,
      });
      material.map.wrapS = material.map.wrapT = THREE.RepeatWrapping;
      // Few, long repeats. Tiling the streaks tightly squashes them into a
      // uniform grey smear that doesn't read as moving water at all.
      material.map.repeat.set(1, Math.max(2, Math.round(fall.height / 26)));

      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(fall.width, fall.height), material);
      sheet.position.set(x, fall.height / 2 - 4, z);
      sheet.rotation.y = facing;
      this.scene.add(sheet);
      this._falls.push({ mesh: sheet, speed: 0.9 + rand() * 0.5 });

      // A wider, fainter spray sheet in front sells the volume cheaply.
      const sprayMat = material.clone();
      sprayMat.map = material.map.clone();
      sprayMat.map.needsUpdate = true;
      sprayMat.opacity = 0.3;
      const spray = new THREE.Mesh(
        new THREE.PlaneGeometry(fall.width * 1.7, fall.height * 0.95),
        sprayMat,
      );
      spray.position.set(x * 0.985, fall.height / 2 - 6, z * 0.985);
      spray.rotation.y = facing;
      this.scene.add(spray);
      this._falls.push({ mesh: spray, speed: 0.55 + rand() * 0.3 });

      // Plunge pool.
      const pool = new THREE.Mesh(
        new THREE.CircleGeometry(fall.width * 1.1, 24),
        new THREE.MeshStandardMaterial({
          color: 0xa8c6cc,
          roughness: 0.12,
          metalness: 0.2,
          transparent: true,
          opacity: 0.75,
          depthWrite: false,
        }),
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x * 0.96, 0.03, z * 0.96);
      this.scene.add(pool);
      this._claim(x * 0.96, z * 0.96, fall.width * 1.2, true);

      // Low mist discs, drifting and breathing.
      for (let i = 0; i < 3; i++) {
        const mist = new THREE.Mesh(
          new THREE.CircleGeometry(fall.width * (1.4 + i * 0.5), 20),
          new THREE.MeshBasicMaterial({
            color: 0xe8f0ee,
            transparent: true,
            opacity: 0.18,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        mist.rotation.x = -Math.PI / 2;
        mist.position.set(x * 0.94, 1.2 + i * 1.6, z * 0.94);
        this.scene.add(mist);
        this._mist.push({ mesh: mist, phase: rand() * Math.PI * 2, base: 0.18 - i * 0.03 });
      }
    }
  }

  update(dt) {
    this.time += dt;

    // Scrolling the UV is what makes a static quad read as falling water.
    for (const fall of this._falls) {
      const map = fall.mesh.material.map;
      if (map) map.offset.y = (map.offset.y - dt * fall.speed) % 1;
    }

    for (const m of this._mist) {
      m.phase += dt * 0.55;
      m.mesh.material.opacity = m.base * (0.72 + Math.sin(m.phase) * 0.28);
      m.mesh.rotation.z += dt * 0.06;
    }
  }

  // ------------------------------------------------------------------ spawns

  _buildSpawnPoints() {
    const rand = makeRandom(SEED + 404);
    let guard = 0;
    while (this.spawnPoints.length < 90 && guard++ < 6000) {
      const a = rand() * Math.PI * 2;
      const d = 30 + Math.sqrt(rand()) * (this.radius - 45);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (!this.isOpenGround(x, z)) continue;
      this.spawnPoints.push(new THREE.Vector3(x, 0, z));
    }
  }

  randomSpawnPoint(rand = Math.random) {
    return this.spawnPoints[Math.floor(rand() * this.spawnPoints.length)];
  }
}

// ------------------------------------------------------------------ textures

/** Damp forest floor: mottled greens over grey stone, with leaf litter. */
function makeBasinTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#8d9a7e';
  ctx.fillRect(0, 0, size, size);

  // Broad mottling first, then fine speckle on top.
  for (let i = 0; i < 90; i++) {
    const shade = ['#7c8a6f', '#7a8a6c', '#98a487', '#6f7d62', '#a3ac93'][i % 5];
    ctx.fillStyle = shade;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 6 + Math.random() * 16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (let i = 0; i < 2400; i++) {
    const v = 110 + Math.random() * 60;
    ctx.fillStyle = `rgba(${v * 0.85},${v},${v * 0.72},0.35)`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }

  // Leaf litter flecks.
  for (let i = 0; i < 180; i++) {
    ctx.fillStyle = ['rgba(96,84,52,0.5)', 'rgba(126,110,68,0.45)', 'rgba(72,88,56,0.5)'][i % 3];
    ctx.fillRect(Math.random() * size, Math.random() * size, 3 + Math.random() * 3, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Vertical streaks with soft edges — scrolled to become falling water. */
function makeWaterTexture() {
  const w = 64;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(226,240,244,0.42)';
  ctx.fillRect(0, 0, w, h);

  // Bright core down the middle so the sheet has a lit spine rather than
  // reading as an even grey wash.
  const core = ctx.createLinearGradient(0, 0, w, 0);
  core.addColorStop(0, 'rgba(255,255,255,0)');
  core.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, w, h);

  // Streaks are drawn without wrapping so they stay unbroken lines; a stroke
  // that wraps past the bottom edge shows up as a hard horizontal seam.
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const len = 60 + Math.random() * 190;
    ctx.strokeStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.65})`;
    ctx.lineWidth = 1 + Math.random() * 3.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 3, Math.min(h, y + len));
    ctx.stroke();
  }

  // Feather the left and right edges so the sheet doesn't end on a hard line.
  const fade = ctx.createLinearGradient(0, 0, w, 0);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.18, 'rgba(0,0,0,0)');
  fade.addColorStop(0.82, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
