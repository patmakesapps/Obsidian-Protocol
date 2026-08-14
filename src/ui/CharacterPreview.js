import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Character } from '../entities/Character.js';

/**
 * The menu's character carousel viewport: one live, slowly turning 3D model
 * per selectable character, swapped by the arrow buttons.
 *
 * Self-contained on purpose — it runs before (and independently of) the Game,
 * with its own small renderer and loader. Models are cached after first view,
 * and the browser's HTTP cache means the game's own load of the same GLB later
 * costs nothing extra.
 */
export class CharacterPreview {
  constructor(canvas, characters) {
    this.canvas = canvas;
    this.characters = characters; // [{ id, label, model }]
    this.index = 0;
    this.onChange = null;

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth || 280, canvas.clientHeight || 320, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, (canvas.clientWidth || 280) / (canvas.clientHeight || 320), 0.1, 20);
    this.camera.position.set(0, 1.15, 3.6);
    this.camera.lookAt(0, 0.95, 0);

    // Violet-tinted key/fill matching the menu, plus a rim so dark models
    // don't melt into the dark backdrop.
    this.scene.add(new THREE.HemisphereLight(0xdcd6ff, 0x3a3050, 1.4));
    const key = new THREE.DirectionalLight(0xfff6ff, 2.4);
    key.position.set(1.6, 2.4, 2.2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xc4a6ff, 1.6);
    rim.position.set(-2, 1.4, -2.4);
    this.scene.add(rim);

    // Glowing dais under the model — echoes the in-game identity ring.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.72, 48),
      new THREE.MeshBasicMaterial({ color: 0xc4a6ff, transparent: true, opacity: 0.65, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    this.scene.add(ring);

    this.loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    this.loader.setDRACOLoader(draco);

    this._slots = new Map(); // char id -> { group, mixer } | 'loading'
    this._clock = new THREE.Clock();
    this._disposed = false;

    this.setIndex(0, false);
    this._loop();
  }

  get current() {
    return this.characters[this.index];
  }

  next() {
    this.setIndex((this.index + 1) % this.characters.length);
  }

  prev() {
    this.setIndex((this.index + this.characters.length - 1) % this.characters.length);
  }

  setIndex(index, fire = true) {
    this.index = index;
    const id = this.current.id;
    for (const [charId, slot] of this._slots) {
      if (slot !== 'loading' && slot?.group) slot.group.visible = charId === id;
    }
    if (!this._slots.has(id)) this._load(this.current);
    if (fire) this.onChange?.(this.current);
  }

  setCharById(id) {
    const i = this.characters.findIndex((c) => c.id === id);
    if (i >= 0) this.setIndex(i, false);
  }

  async _load(char) {
    this._slots.set(char.id, 'loading');
    let gltf;
    try {
      gltf = await this.loader.loadAsync(char.model);
    } catch {
      this._slots.delete(char.id);
      return;
    }
    if (this._disposed) return;

    // The game's own Character wrapper handles the skinned-mesh sizing traps
    // (bind-pose measurement, foot calibration) — a naive Box3 fit measures a
    // rigged export's transforms and crops the model to its legs.
    const character = new Character(
      { scene: gltf.scene, animations: gltf.animations ?? [] },
      { targetHeight: char.height ?? 1.72 },
    );

    const group = new THREE.Group();
    group.add(character.root);
    group.position.y = char.lift ?? 0;
    group.visible = char.id === this.current.id;
    this.scene.add(group);

    character.play('idle');
    // Needs the root in the scene and the clip playing to sample the foot bone.
    character.calibrateToFeet();

    this._slots.set(char.id, { group, character });
  }

  _loop = () => {
    if (this._disposed) return;
    requestAnimationFrame(this._loop);

    // Parked (menu hidden) — skip the GPU work but keep ticking.
    if (!this.canvas.offsetParent) return;

    const dt = this._clock.getDelta();
    for (const slot of this._slots.values()) {
      if (slot === 'loading' || !slot) continue;
      if (slot.group.visible) {
        slot.group.rotation.y += dt * 0.7;
        slot.character.update(dt);
      }
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this._disposed = true;
    this.renderer.dispose();
  }
}
