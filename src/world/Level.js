import * as THREE from 'three';
import { CONFIG, PALETTE } from '../config.js';
import { makeRandom } from '../core/noise.js';

const SEED = 90210;

/**
 * A white sci-fi city on a regular block grid.
 *
 * Layout is deterministic from SEED: towers sit on blocks, everything between
 * them is walkable street, and the centre blocks are cleared for a plaza with a
 * landed star cruiser as the visual anchor. Prop GLBs are scattered onto the
 * streets as cover, each getting a box collider sized from its own bounds.
 */
export class Level {
  /** Box around the player's start that no prop collider may intrude on. */
  static SPAWN_KEEPOUT = new THREE.Box3(
    new THREE.Vector3(-8, -1, -4),
    new THREE.Vector3(8, 14, 16),
  );

  constructor(scene, physics, assets) {
    this.scene = scene;
    this.physics = physics;
    this.assets = assets;
    this.spawnPoints = [];
    this.coverPoints = [];
    this.buildings = [];
    this._placedProps = [];
  }

  get cellSize() {
    return CONFIG.world.blockSize + CONFIG.world.streetWidth;
  }

  /** Ground is flat; kept as a function so spawn code stays terrain-agnostic. */
  heightAt() {
    return 0;
  }

  /** True when the point is on a street/plaza rather than inside a block. */
  isOpenGround(x, z) {
    const half = CONFIG.world.citySize / 2;
    if (Math.abs(x) > half - 6 || Math.abs(z) > half - 6) return false;
    const localX = this._local(x);
    const localZ = this._local(z);
    const b = CONFIG.world.blockSize;
    return localX >= b || localZ >= b || this._isPlazaBlock(x, z);
  }

  _local(v) {
    const C = this.cellSize;
    const t = v + CONFIG.world.citySize / 2;
    return t - Math.floor(t / C) * C;
  }

  _isPlazaBlock(x, z) {
    return Math.hypot(x, z) < 62;
  }

  async build() {
    this._buildGround();
    this._buildBuildings();
    this._buildBoundary();
    this._buildStreetLights();
    this._buildCover();
    await this._placeProps();
    this._buildSpawnPoints();
  }

  // ------------------------------------------------------------------ ground

  _buildGround() {
    const size = CONFIG.world.citySize;

    const material = new THREE.MeshStandardMaterial({
      color: PALETTE.white,
      roughness: 0.72,
      metalness: 0.04,
      map: makePavingTexture(),
    });
    material.map.repeat.set(size / 8, size / 8);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;

    // A thick slab rather than a plane collider so nothing can tunnel through.
    this.physics.addStaticBox(
      { x: size / 2, y: 2, z: size / 2 },
      { x: 0, y: -2, z: 0 },
      null,
      { type: 'ground' },
    );

    // Purple inlay strips running down the middle of each avenue.
    const inlayMat = new THREE.MeshStandardMaterial({
      color: PALETTE.black,
      emissive: PALETTE.purple,
      emissiveIntensity: 1.6,
      roughness: 0.35,
      metalness: 0.5,
    });
    const inlays = new THREE.Group();
    const C = this.cellSize;
    const count = Math.floor(size / C);
    for (let i = 0; i <= count; i++) {
      const p = -size / 2 + i * C + CONFIG.world.blockSize + CONFIG.world.streetWidth / 2;
      if (Math.abs(p) > size / 2) continue;
      for (const axis of ['x', 'z']) {
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(size, 0.35), inlayMat);
        strip.rotation.x = -Math.PI / 2;
        if (axis === 'x') strip.position.set(0, 0.02, p);
        else {
          strip.rotation.z = Math.PI / 2;
          strip.position.set(p, 0.02, 0);
        }
        inlays.add(strip);
      }
    }
    this.scene.add(inlays);
  }

  // --------------------------------------------------------------- buildings

  _buildBuildings() {
    const rand = makeRandom(SEED);
    const size = CONFIG.world.citySize;
    const C = this.cellSize;
    const b = CONFIG.world.blockSize;
    const cells = Math.floor(size / C);

    const facade = makeFacadeTextures();
    const roofMat = new THREE.MeshStandardMaterial({
      color: PALETTE.charcoal,
      roughness: 0.6,
      metalness: 0.4,
    });
    const crownMat = new THREE.MeshStandardMaterial({
      color: PALETTE.black,
      emissive: PALETTE.purpleBright,
      emissiveIntensity: 2.2,
      roughness: 0.3,
      metalness: 0.6,
    });
    const plinthMat = new THREE.MeshStandardMaterial({
      color: PALETTE.charcoal,
      roughness: 0.55,
      metalness: 0.35,
    });

    const group = new THREE.Group();

    for (let ix = 0; ix < cells; ix++) {
      for (let iz = 0; iz < cells; iz++) {
        const cx = -size / 2 + ix * C + b / 2;
        const cz = -size / 2 + iz * C + b / 2;
        if (this._isPlazaBlock(cx, cz)) continue;

        // Two towers per block, occasionally one big one.
        const towers = rand() < 0.35 ? 1 : 2;
        for (let t = 0; t < towers; t++) {
          const footprint =
            towers === 1 ? b * (0.55 + rand() * 0.25) : b * (0.28 + rand() * 0.16);
          const w = footprint;
          const d = footprint * (0.85 + rand() * 0.3);

          const edgeFromRing = Math.max(Math.abs(cx), Math.abs(cz)) / (size / 2);
          // Taller towers toward the outside so the skyline frames the plaza.
          const h = 14 + rand() * 34 + edgeFromRing * 34;

          const ox = towers === 1 ? 0 : (t === 0 ? -1 : 1) * (b * 0.22);
          const oz = (rand() - 0.5) * b * 0.2;
          const px = cx + ox;
          const pz = cz + oz;

          const mat = new THREE.MeshStandardMaterial({
            color: PALETTE.white,
            roughness: 0.5,
            metalness: 0.12,
            map: facade.map.clone(),
            emissiveMap: facade.emissive.clone(),
            emissive: new THREE.Color(PALETTE.purpleBright),
            emissiveIntensity: rand() < 0.25 ? 1.9 : 0.9,
          });
          mat.map.repeat.set(Math.max(1, Math.round(w / 6)), Math.max(2, Math.round(h / 4)));
          mat.emissiveMap.repeat.copy(mat.map.repeat);

          const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
          tower.position.set(px, h / 2, pz);
          tower.castShadow = true;
          tower.receiveShadow = true;
          group.add(tower);

          const plinth = new THREE.Mesh(new THREE.BoxGeometry(w * 1.14, 1.6, d * 1.14), plinthMat);
          plinth.position.set(px, 0.8, pz);
          plinth.castShadow = true;
          plinth.receiveShadow = true;
          group.add(plinth);

          const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 1.06, 0.8, d * 1.06), roofMat);
          roof.position.set(px, h + 0.4, pz);
          roof.castShadow = true;
          group.add(roof);

          const crown = new THREE.Mesh(new THREE.BoxGeometry(w * 1.09, 0.22, d * 1.09), crownMat);
          crown.position.set(px, h + 0.95, pz);
          group.add(crown);

          this.physics.addStaticBox(
            { x: w / 2, y: h / 2 + 1, z: d / 2 },
            { x: px, y: h / 2, z: pz },
            null,
            { type: 'building' },
          );
          this.buildings.push({ x: px, z: pz, w, d, h });
        }
      }
    }

    this.scene.add(group);
  }

  _buildBoundary() {
    const half = CONFIG.world.citySize / 2;
    const h = 120;
    const t = 3;
    for (const w of [
      { pos: { x: 0, y: h / 2, z: -half }, he: { x: half, y: h, z: t } },
      { pos: { x: 0, y: h / 2, z: half }, he: { x: half, y: h, z: t } },
      { pos: { x: -half, y: h / 2, z: 0 }, he: { x: t, y: h, z: half } },
      { pos: { x: half, y: h / 2, z: 0 }, he: { x: t, y: h, z: half } },
    ]) {
      this.physics.addStaticBox(w.he, w.pos, null, { type: 'boundary' });
    }
  }

  /** Slim lamp posts along the avenues — the main source of violet accent. */
  _buildStreetLights() {
    const rand = makeRandom(SEED + 12);
    const size = CONFIG.world.citySize;
    const C = this.cellSize;
    const cells = Math.floor(size / C);

    const postMat = new THREE.MeshStandardMaterial({
      color: PALETTE.offWhite,
      roughness: 0.35,
      metalness: 0.7,
    });
    const lampMat = new THREE.MeshStandardMaterial({
      color: PALETTE.black,
      emissive: PALETTE.purpleBright,
      emissiveIntensity: 3.4,
      roughness: 0.3,
    });

    const postGeo = new THREE.CylinderGeometry(0.09, 0.13, 6.4, 6);
    const lampGeo = new THREE.BoxGeometry(0.5, 0.16, 0.5);
    const positions = [];

    for (let ix = 0; ix <= cells; ix++) {
      for (let iz = 0; iz <= cells; iz++) {
        const x = -size / 2 + ix * C + CONFIG.world.blockSize + CONFIG.world.streetWidth / 2;
        const z = -size / 2 + iz * C + CONFIG.world.blockSize + CONFIG.world.streetWidth / 2;
        if (Math.abs(x) > size / 2 - 4 || Math.abs(z) > size / 2 - 4) continue;
        positions.push([x, z]);
      }
    }

    const posts = new THREE.InstancedMesh(postGeo, postMat, positions.length);
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, positions.length);
    const dummy = new THREE.Object3D();
    positions.forEach(([x, z], i) => {
      dummy.position.set(x, 3.2, z);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, 6.5, z);
      dummy.updateMatrix();
      lamps.setMatrixAt(i, dummy.matrix);
    });
    posts.castShadow = false; // thin posts contribute nothing to the shadow map
    this.scene.add(posts, lamps);

    // Deliberately no point lights here. Every real light costs per-fragment
    // shading across the whole scene, and 20+ lamp lights was the single
    // biggest frame-rate sink. The emissive lamp material still glows.
  }

  /**
   * Chest-high street barriers. Purely procedural so they match the towers,
   * and they're what makes the firefights playable — without cover the AI's
   * standoff range just becomes an open shooting gallery.
   */
  _buildCover() {
    const rand = makeRandom(SEED + 55);
    const shell = new THREE.MeshStandardMaterial({
      color: PALETTE.white,
      roughness: 0.45,
      metalness: 0.15,
    });
    const trim = new THREE.MeshStandardMaterial({
      color: PALETTE.black,
      emissive: PALETTE.purpleBright,
      emissiveIntensity: 1.7,
      roughness: 0.35,
      metalness: 0.5,
    });

    const H = 1.15;
    const placements = [];
    let guard = 0;
    while (placements.length < 90 && guard++ < 6000) {
      const half = CONFIG.world.citySize / 2 - 20;
      const x = (rand() * 2 - 1) * half;
      const z = (rand() * 2 - 1) * half;
      if (!this.isOpenGround(x, z)) continue;
      if (Math.hypot(x, z) < 22) continue;
      if (placements.some((p) => Math.hypot(p.x - x, p.z - z) < 11)) continue;

      const long = 3.2 + rand() * 3.6;
      const alongX = rand() < 0.5;
      placements.push({ x, z, w: alongX ? long : 0.85, d: alongX ? 0.85 : long });
    }

    const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(1, H, 1), shell, placements.length);
    const caps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.1, 1), trim, placements.length);
    bodies.castShadow = true;
    bodies.receiveShadow = true;

    const dummy = new THREE.Object3D();
    placements.forEach((p, i) => {
      dummy.position.set(p.x, H / 2, p.z);
      dummy.scale.set(p.w, 1, p.d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);

      dummy.position.set(p.x, H + 0.05, p.z);
      dummy.scale.set(p.w * 1.06, 1, p.d * 1.06);
      dummy.updateMatrix();
      caps.setMatrixAt(i, dummy.matrix);

      this.physics.addStaticBox(
        { x: p.w / 2, y: H / 2, z: p.d / 2 },
        { x: p.x, y: H / 2, z: p.z },
        null,
        { type: 'cover' },
      );
      this.coverPoints.push(new THREE.Vector3(p.x, 0, p.z));
    });

    bodies.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    this.scene.add(bodies, caps);
  }

  // ------------------------------------------------------------------- props

  /**
   * Places GLB props. Each is measured, scaled to a sensible real-world size,
   * dropped so it sits on the ground, and given a collider from its bounds.
   */
  async _placeProps() {
    if (!CONFIG.world.useGlbProps) return;
    const rand = makeRandom(SEED + 77);

    // targetSize is the prop's LONGEST dimension in metres. Scaling by a named
    // axis is a trap: Meshy normalises every export to ~1.9 on its own longest
    // axis, so picking the wrong one silently inflates the model many times
    // over — that's how the cruiser ended up 61 metres deep and swallowing the
    // player spawn.
    const defs = [
      { url: '/models/cruiser.glb', targetSize: 46, count: 1, hero: true },
      { url: '/models/prop_tower.glb', targetSize: 9, count: 6 },
      { url: '/models/prop_booth.glb', targetSize: 4.2, count: 8 },
      { url: '/models/prop_wall_door.glb', targetSize: 9, count: 7 },
      { url: '/models/prop_wall_low.glb', targetSize: 7, count: 10, cover: true },
      { url: '/models/prop_barricade.glb', targetSize: 6, count: 12, cover: true },
      { url: '/models/prop_barrier.glb', targetSize: 3.4, count: 14, cover: true },
      { url: '/models/prop_cargo.glb', targetSize: 3.0, count: 20, cover: true },
      { url: '/models/prop_beacon.glb', targetSize: 3.2, count: 12, glow: true },
    ];

    for (const def of defs) {
      const source = await this.assets.loadModel(def.url);
      if (!source) continue;

      for (let i = 0; i < def.count; i++) {
        const instance = await this.assets.instantiate(def.url);
        if (!instance) break;
        const object = instance.scene;

        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const longest = Math.max(size.x, size.y, size.z);
        object.scale.setScalar(def.targetSize / Math.max(0.001, longest));

        let position;
        if (def.hero) {
          position = new THREE.Vector3(4, 0, -62);
          object.rotation.y = -0.42;
        } else {
          position = this._findOpenSpot(rand, def.targetSize * 0.6);
          if (!position) break;
          object.rotation.y = Math.round(rand() * 4) * (Math.PI / 2) + (rand() - 0.5) * 0.25;
        }

        object.position.copy(position);
        object.updateMatrixWorld(true);

        // Re-measure after scale/rotation, then sit it exactly on the ground.
        const placed = new THREE.Box3().setFromObject(object);
        object.position.y -= placed.min.y;
        object.updateMatrixWorld(true);

        // Only sizeable props earn a place in the shadow map; small street
        // clutter casting shadows costs a lot for almost no visual gain.
        const castsShadow = def.targetSize >= 5;
        object.traverse((n) => {
          if (n.isMesh) {
            n.castShadow = castsShadow;
            n.receiveShadow = true;
          }
        });
        const final = new THREE.Box3().setFromObject(object);

        // Hard guard: nothing may enclose the player spawn. A prop that scales
        // or rotates unexpectedly would otherwise trap the player inside a
        // static collider with no way to move.
        if (final.intersectsBox(Level.SPAWN_KEEPOUT)) {
          console.warn(
            `[Level] "${def.url}" overlapped the spawn keep-out and was skipped.`,
            final.getSize(new THREE.Vector3()),
          );
          object.removeFromParent();
          continue;
        }

        this.scene.add(object);

        const fs = final.getSize(new THREE.Vector3());
        const fc = final.getCenter(new THREE.Vector3());
        this.physics.addStaticBox(
          { x: fs.x / 2, y: fs.y / 2, z: fs.z / 2 },
          { x: fc.x, y: fc.y, z: fc.z },
          null,
          { type: 'prop' },
        );

        if (def.cover) this.coverPoints.push(new THREE.Vector3(fc.x, 0, fc.z));
        if (def.hero) this.cruiser = object;
      }
    }
  }

  /** Rejection-samples a street position with clearance from other props. */
  _findOpenSpot(rand, clearance) {
    const half = CONFIG.world.citySize / 2 - 14;
    const candidate = new THREE.Vector3();
    for (let attempt = 0; attempt < 120; attempt++) {
      const x = (rand() * 2 - 1) * half;
      const z = (rand() * 2 - 1) * half;
      if (!this.isOpenGround(x, z)) continue;
      if (Math.hypot(x, z) < 26) continue; // keep the immediate spawn area clear

      candidate.set(x, 0, z);
      const minGap = clearance + 3;
      const tooClose = this._placedProps.some((p) => p.distanceTo(candidate) < minGap);
      if (tooClose) continue;

      const spot = candidate.clone();
      this._placedProps.push(spot);
      return spot;
    }
    return null;
  }

  _buildSpawnPoints() {
    const rand = makeRandom(SEED + 404);
    let guard = 0;
    while (this.spawnPoints.length < 80 && guard++ < 4000) {
      const half = CONFIG.world.citySize / 2 - 20;
      const x = (rand() * 2 - 1) * half;
      const z = (rand() * 2 - 1) * half;
      if (!this.isOpenGround(x, z)) continue;
      if (Math.hypot(x, z) < 30) continue;
      this.spawnPoints.push(new THREE.Vector3(x, 0, z));
    }
  }

  randomSpawnPoint(rand = Math.random) {
    return this.spawnPoints[Math.floor(rand() * this.spawnPoints.length)];
  }
}

// ------------------------------------------------------------------ textures

/** White paving slabs with fine dark grout. */
function makePavingTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#eef0f7';
  ctx.fillRect(0, 0, size, size);

  // Subtle panel noise so large floors don't look like flat plastic.
  for (let i = 0; i < 2600; i++) {
    const v = 226 + Math.random() * 26;
    ctx.fillStyle = `rgba(${v},${v},${v + 4},0.30)`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }

  ctx.strokeStyle = 'rgba(40,42,58,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(40,42,58,0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Tower facade: white panels split by black glazing bands, plus a matching
 * emissive map so only the glazing glows violet at night.
 */
function makeFacadeTextures() {
  const w = 128;
  const h = 128;

  const base = document.createElement('canvas');
  base.width = w;
  base.height = h;
  const bc = base.getContext('2d');
  bc.fillStyle = '#f2f4fa';
  bc.fillRect(0, 0, w, h);

  const glow = document.createElement('canvas');
  glow.width = w;
  glow.height = h;
  const gc = glow.getContext('2d');
  gc.fillStyle = '#000000';
  gc.fillRect(0, 0, w, h);

  // Two glazing bands per tile, inset from the panel edges.
  for (const bandY of [26, 82]) {
    bc.fillStyle = '#15161f';
    bc.fillRect(6, bandY, w - 12, 26);

    // Individual lit windows within the band.
    for (let x = 10; x < w - 14; x += 14) {
      const lit = Math.random() < 0.45;
      gc.fillStyle = lit ? `rgba(190,160,255,${0.55 + Math.random() * 0.45})` : '#000';
      gc.fillRect(x, bandY + 4, 10, 18);
      if (lit) {
        bc.fillStyle = 'rgba(150,120,220,0.35)';
        bc.fillRect(x, bandY + 4, 10, 18);
      }
    }
  }

  // Panel seam lines.
  bc.strokeStyle = 'rgba(60,62,84,0.35)';
  bc.lineWidth = 1;
  bc.strokeRect(0.5, 0.5, w - 1, h - 1);

  const map = new THREE.CanvasTexture(base);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  map.colorSpace = THREE.SRGBColorSpace;

  const emissive = new THREE.CanvasTexture(glow);
  emissive.wrapS = emissive.wrapT = THREE.RepeatWrapping;
  emissive.anisotropy = 4;
  emissive.colorSpace = THREE.SRGBColorSpace;

  return { map, emissive };
}
