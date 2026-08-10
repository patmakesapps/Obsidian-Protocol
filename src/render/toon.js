import * as THREE from 'three';

/**
 * Converts standard PBR materials to banded toon shading.
 *
 * Only `MeshStandardMaterial` / `MeshPhysicalMaterial` are touched. That
 * exclusion is doing real work: the sky is a raw ShaderMaterial, and every
 * pickup beam, waypoint column, muzzle flash and tracer is a `MeshBasicMaterial`
 * — all already unlit, and all things that would look wrong with an ink-banded
 * ramp applied to them. Checking for "is this lit by the scene" is exactly the
 * right filter.
 */

const _ramps = new Map();

/**
 * A gradient ramp for MeshToonMaterial: N discrete steps, nearest-filtered so
 * the transitions stay hard. Linear filtering here would smear the bands back
 * into an ordinary diffuse falloff and undo the whole effect.
 */
export function gradientRamp(bands) {
  if (_ramps.has(bands)) return _ramps.get(bands);

  const data = new Uint8Array(bands);
  for (let i = 0; i < bands; i++) {
    // Start well above black: the darkest band is ambient-lit, not unlit, and
    // a ramp that reaches 0 makes every shadowed face read as a hole.
    const t = bands === 1 ? 1 : i / (bands - 1);
    data[i] = Math.round(THREE.MathUtils.lerp(74, 255, t));
  }

  const texture = new THREE.DataTexture(data, bands, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  _ramps.set(bands, texture);
  return texture;
}

// Keyed on the source material so every mesh sharing one keeps sharing its
// replacement — converting per-mesh would multiply the material count and
// destroy instanced batching.
const _converted = new Map();

function convert(material, ramp) {
  if (!material || (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial)) {
    return material;
  }

  const existing = _converted.get(material);
  if (existing) return existing;

  const toon = new THREE.MeshToonMaterial({
    name: `${material.name || 'material'}_toon`,
    color: material.color,
    map: material.map,
    gradientMap: ramp,
    emissive: material.emissive,
    emissiveMap: material.emissiveMap,
    emissiveIntensity: material.emissiveIntensity,
    normalMap: material.normalMap,
    normalScale: material.normalScale,
    alphaMap: material.alphaMap,
    aoMap: material.aoMap,
    aoMapIntensity: material.aoMapIntensity,
    lightMap: material.lightMap,
    transparent: material.transparent,
    opacity: material.opacity,
    alphaTest: material.alphaTest,
    side: material.side,
    vertexColors: material.vertexColors,
    fog: material.fog,
    depthWrite: material.depthWrite,
    depthTest: material.depthTest,
  });

  _converted.set(material, toon);
  return toon;
}

/** Walks an object tree and swaps every lit material for its toon equivalent. */
export function applyToon(root, bands) {
  if (!root) return root;
  const ramp = gradientRamp(bands);

  root.traverse((node) => {
    if (!node.isMesh && !node.isSkinnedMesh && !node.isInstancedMesh) return;
    if (Array.isArray(node.material)) {
      node.material = node.material.map((m) => convert(m, ramp));
    } else {
      node.material = convert(node.material, ramp);
    }
  });

  return root;
}
