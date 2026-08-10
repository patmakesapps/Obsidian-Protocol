import * as THREE from 'three';

/**
 * GLB scattering via InstancedMesh.
 *
 * The naive way to place 70 trees is 70 cloned GLB scenes, which is 70x the
 * draw calls of one tree. Instead we bake each source mesh's world transform
 * into its geometry once, then draw every copy of that geometry+material pair
 * in a single instanced call. A 17-asset jungle stays around 40 draw calls
 * rather than several hundred.
 *
 * The trade-off is that instances share one material, so nothing scattered
 * this way can be individually tinted or faded at runtime. Everything in the
 * set dressing is static, so that costs us nothing.
 */

const _box = new THREE.Box3();
const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();
const _size = new THREE.Vector3();

const _sources = new Map();

/**
 * Flattens a GLB into instancable parts, cached per URL.
 * @returns {{parts: Array<{geometry: THREE.BufferGeometry, material: THREE.Material}>,
 *            bounds: THREE.Box3, longest: number}|null}
 */
export async function loadSource(assets, url) {
  if (_sources.has(url)) return _sources.get(url);

  const promise = (async () => {
    const gltf = await assets.loadModel(url);
    if (!gltf) return null;

    const root = gltf.scene;
    root.updateMatrixWorld(true);

    const parts = [];
    root.traverse((node) => {
      if (!node.isMesh || !node.geometry) return;
      const geometry = node.geometry.clone();
      geometry.applyMatrix4(node.matrixWorld);
      // Instanced draws never need per-instance UVs here — the whole set is
      // untextured — but dropping attributes the material doesn't read keeps
      // the buffers small.
      geometry.deleteAttribute('uv1');
      geometry.deleteAttribute('tangent');
      parts.push({ geometry, material: node.material });
    });
    if (!parts.length) return null;

    const bounds = new THREE.Box3();
    for (const part of parts) {
      part.geometry.computeBoundingBox();
      bounds.union(part.geometry.boundingBox);
    }
    bounds.getSize(_size);

    return { parts, bounds, longest: Math.max(_size.x, _size.y, _size.z) };
  })();

  _sources.set(url, promise);
  return promise;
}

/**
 * Places one GLB many times as instanced meshes.
 *
 * @param placements Array of { position: Vector3, rotationY?, scale?, tilt? }.
 *   `scale` multiplies the fitted size, so 1 means "exactly targetSize".
 * @param opts.targetSize Longest dimension in metres. Omit to keep authored size.
 * @returns {{meshes: THREE.InstancedMesh[], boxes: THREE.Box3[], baseScale: number}|null}
 *   `boxes` are world-space AABBs, one per placement, for building colliders.
 */
export async function scatter(scene, assets, url, placements, opts = {}) {
  const source = await loadSource(assets, url);
  if (!source || !placements.length) return null;

  const {
    targetSize = null,
    castShadow = true,
    receiveShadow = true,
    sitOnGround = false,
  } = opts;
  const baseScale = targetSize ? targetSize / Math.max(0.001, source.longest) : 1;

  // Named after the source file so scene dumps and debug probes are readable —
  // an anonymous InstancedMesh is nearly impossible to trace back to an asset.
  const label = url.split('/').pop().replace('.glb', '');
  const meshes = source.parts.map(({ geometry, material }, i) => {
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
    mesh.name = `${label}#${i}`;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    return mesh;
  });

  const boxes = [];
  const _position = new THREE.Vector3();
  placements.forEach((p, i) => {
    const s = baseScale * (p.scale ?? 1);
    _euler.set(p.tilt?.x ?? 0, p.rotationY ?? 0, p.tilt?.z ?? 0);
    _quat.setFromEuler(_euler);
    _scale.set(s, s, s);
    // Models authored with their origin below the mesh need no correction;
    // this handles the ones that don't (most third-party exports).
    _position.copy(p.position);
    if (sitOnGround) _position.y -= source.bounds.min.y * s;
    _matrix.compose(_position, _quat, _scale);
    for (const mesh of meshes) mesh.setMatrixAt(i, _matrix);

    _box.copy(source.bounds).applyMatrix4(_matrix);
    boxes.push(_box.clone());
  });

  for (const mesh of meshes) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  return { meshes, boxes, baseScale };
}

/**
 * Places a single GLB as a normal cloned object. Used for one-off hero pieces
 * where instancing buys nothing.
 * @returns {{object: THREE.Object3D, box: THREE.Box3}|null}
 */
export async function place(scene, assets, url, {
  position, rotationY = 0, targetSize = null, tilt = null, castShadow = true, sitOnGround = false,
}) {
  const instance = await assets.instantiate(url);
  if (!instance) return null;

  const object = instance.scene;
  if (targetSize) {
    const measured = new THREE.Box3().setFromObject(object);
    measured.getSize(_size);
    object.scale.setScalar(targetSize / Math.max(0.001, Math.max(_size.x, _size.y, _size.z)));
  }
  object.rotation.set(tilt?.x ?? 0, rotationY, tilt?.z ?? 0);
  object.position.copy(position);
  object.updateMatrixWorld(true);

  if (sitOnGround) {
    // Re-measure after scale and rotation, then drop it onto y = position.y.
    const placed = new THREE.Box3().setFromObject(object);
    object.position.y += position.y - placed.min.y;
    object.updateMatrixWorld(true);
  }

  object.traverse((n) => {
    if (n.isMesh) {
      n.castShadow = castShadow;
      n.receiveShadow = true;
    }
  });

  scene.add(object);
  return { object, box: new THREE.Box3().setFromObject(object) };
}
