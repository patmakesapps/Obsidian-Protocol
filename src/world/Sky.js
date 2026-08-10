import * as THREE from 'three';
import { PALETTE } from '../config.js';

const VERT = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldDir = normalize(world.xyz - cameraPosition);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vWorldDir;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uBloomColor;
  uniform float uStars;
  uniform float uGradient;

  // Cheap hash for the starfield — no texture needed.
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    float h = dir.y;

    vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), uGradient));
    sky = mix(uGround, sky, smoothstep(-0.05, 0.04, h));

    // Stars, fading out near the bright horizon. uStars is 0 on daylit levels,
    // which lets the compiler drop the whole branch's contribution.
    if (uStars > 0.0) {
      vec3 cell = floor(dir * 340.0);
      float star = step(0.9975, hash(cell));
      float twinkle = 0.55 + 0.45 * hash(cell + 3.3);
      sky += vec3(0.85, 0.82, 1.0) * star * twinkle * smoothstep(0.05, 0.5, h) * uStars;
    }

    // Sun disc plus a soft bloom halo around it.
    float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
    sky += uSunColor * pow(sunDot, 1400.0) * 8.0;
    sky += uBloomColor * pow(sunDot, 18.0) * 0.30;

    gl_FragColor = vec4(sky, 1.0);
  }
`;

/**
 * Per-level atmosphere.
 *
 * A level is as much its light as its geometry: the same white modules read as
 * a night arcology under violet, and as a humid daylit outpost under pale
 * green. Everything that differs between the two lives in this table.
 */
export const SKY_PRESETS = {
  arcology: {
    sunDir: [-0.34, 0.82, -0.46],
    horizon: 0xd9d2f2,
    zenith: 0x1a1435,
    ground: 0x8f86bd,
    sunColor: 0xffffff,
    bloomColor: 0x9e80f2,
    stars: 0.9,
    gradient: 0.45,
    sunLight: { color: 0xfff6ff, intensity: 2.9 },
    bounce: { color: PALETTE.purpleBright, intensity: 0.7, position: [40, 25, 60] },
    ambient: { sky: 0xdcd6ff, ground: 0x6b6392, intensity: 1.05 },
    fog: { color: 0xb9b0e2, density: 0.0038 },
    worldSize: 430,
  },

  // Verdant Basin: humid mid-morning. The fog is deliberately dense — it hides
  // the point where the cliff ring stops being geometry, and the shafts of it
  // between the trees are most of what sells the place.
  basin: {
    sunDir: [0.28, 0.74, 0.61],
    horizon: 0xdfe7dc,
    zenith: 0x5f8fb4,
    ground: 0x7d8a72,
    sunColor: 0xfffaf0,
    bloomColor: 0xbfd6a8,
    stars: 0.0,
    gradient: 0.62,
    sunLight: { color: 0xfff3dd, intensity: 3.3 },
    bounce: { color: 0x9bc47a, intensity: 0.65, position: [-50, 30, -40] },
    ambient: { sky: 0xe2ecdf, ground: 0x46543c, intensity: 1.15 },
    // Light enough to read as humid haze, thin enough that the cliff ring keeps
    // its form. At 0.007 the cliffs washed out into flat white cutouts.
    fog: { color: 0xb9c8bc, density: 0.0044 },
    worldSize: 420,
  },
};

export function createSky(scene, presetName = 'arcology') {
  const preset = SKY_PRESETS[presetName] ?? SKY_PRESETS.arcology;

  // A high sun is the fix for the crawling shadow blob: at a low elevation the
  // world shadows itself across enormous distances and the shadow camera can't
  // contain it. ~50-55 degrees keeps shadows short, crisp and contained.
  const sunDir = new THREE.Vector3(...preset.sunDir).normalize();

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uHorizon: { value: new THREE.Color(preset.horizon) },
      uZenith: { value: new THREE.Color(preset.zenith) },
      uGround: { value: new THREE.Color(preset.ground) },
      uSunDir: { value: sunDir },
      uSunColor: { value: new THREE.Color(preset.sunColor) },
      uBloomColor: { value: new THREE.Color(preset.bloomColor) },
      uStars: { value: preset.stars },
      uGradient: { value: preset.gradient },
    },
  });

  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  dome.scale.setScalar(preset.worldSize * 3);
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  scene.add(dome);

  const sun = new THREE.DirectionalLight(preset.sunLight.color, preset.sunLight.intensity);
  sun.position.copy(sunDir).multiplyScalar(90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);

  // Tight frustum: only the play area immediately around the player needs
  // shadows, and a smaller box means far more texels per metre.
  const span = 55;
  sun.shadow.camera.left = -span;
  sun.shadow.camera.right = span;
  sun.shadow.camera.top = span;
  sun.shadow.camera.bottom = -span;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);
  scene.add(sun.target);

  // Fill light so shadowed faces read as lit-by-the-environment, not as black
  // holes: violet off the city, green off the canopy.
  const bounce = new THREE.DirectionalLight(preset.bounce.color, preset.bounce.intensity);
  bounce.position.set(...preset.bounce.position);
  scene.add(bounce);

  const ambient = new THREE.HemisphereLight(
    preset.ambient.sky,
    preset.ambient.ground,
    preset.ambient.intensity,
  );
  scene.add(ambient);

  scene.fog = new THREE.FogExp2(preset.fog.color, preset.fog.density);

  return { dome, sun, bounce, ambient, sunDir, shadowSpan: span, preset };
}
