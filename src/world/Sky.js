import * as THREE from 'three';
import { CONFIG, PALETTE } from '../config.js';

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

  // Cheap hash for the starfield — no texture needed.
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    float h = dir.y;

    // Pale violet haze at the horizon rising into a deep indigo zenith.
    vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.45));
    sky = mix(uGround, sky, smoothstep(-0.05, 0.04, h));

    // Stars, fading out near the bright horizon.
    vec3 cell = floor(dir * 340.0);
    float star = step(0.9975, hash(cell));
    float twinkle = 0.55 + 0.45 * hash(cell + 3.3);
    sky += vec3(0.85, 0.82, 1.0) * star * twinkle * smoothstep(0.05, 0.5, h) * 0.9;

    // A single cold-white sun with a soft violet bloom around it.
    float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
    sky += uSunColor * pow(sunDot, 1400.0) * 8.0;
    sky += vec3(0.62, 0.50, 0.95) * pow(sunDot, 18.0) * 0.30;

    gl_FragColor = vec4(sky, 1.0);
  }
`;

export function createSky(scene) {
  // A high sun is the fix for the crawling shadow blob: at a low elevation the
  // world shadows itself across enormous distances and the shadow camera can't
  // contain it. ~55 degrees keeps shadows short, crisp and contained.
  const sunDir = new THREE.Vector3(-0.34, 0.82, -0.46).normalize();

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uHorizon: { value: new THREE.Color(0xd9d2f2) },
      uZenith: { value: new THREE.Color(0x1a1435) },
      uGround: { value: new THREE.Color(0x8f86bd) },
      uSunDir: { value: sunDir },
      uSunColor: { value: new THREE.Color(0xffffff) },
    },
  });

  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  dome.scale.setScalar(CONFIG.world.citySize * 3);
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  scene.add(dome);

  const sun = new THREE.DirectionalLight(0xfff6ff, 2.9);
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

  // Violet bounce so shadowed faces read as lit-by-the-city, not black holes.
  const bounce = new THREE.DirectionalLight(PALETTE.purpleBright, 0.7);
  bounce.position.set(40, 25, 60);
  scene.add(bounce);

  const ambient = new THREE.HemisphereLight(0xdcd6ff, 0x6b6392, 1.05);
  scene.add(ambient);

  scene.fog = new THREE.FogExp2(CONFIG.world.fogColor, CONFIG.world.fogDensity);

  return { dome, sun, bounce, ambient, sunDir, shadowSpan: span };
}
