import * as THREE from 'three';

// Animation clips get named inconsistently across exporters (Meshy, Mixamo,
// Blender). Rather than force one convention, match on substrings and let the
// first hit win.
const CLIP_ALIASES = {
  idle: ['idle', 'stand', 'breathing', 'rest'],
  walk: ['walk', 'move', 'locomotion'],
  run: ['run', 'sprint', 'jog', 'charge'],
  // "firing" doesn't contain "fire", so Mixamo's "Firing Rifle" needs its own
  // entry — matching is plain substring, not stemming.
  attack: ['attack', 'firing', 'fire', 'shoot', 'aim', 'punch', 'swing', 'strike', 'melee', 'bite'],
  hit: ['hit', 'impact', 'flinch', 'damage', 'react'],
  death: ['death', 'die', 'dying', 'defeat', 'fall'],
};

/**
 * A character body — rigged or not.
 *
 * If the GLB ships a skeleton and clips, this drives an AnimationMixer and
 * resolves clips by intent ("run", "attack") rather than exact export name.
 * If it doesn't — which is what raw Meshy text-to-3D output gives you — it
 * falls back to procedural motion on the whole mesh so the model at least
 * leans, bobs and settles instead of sliding around as a rigid statue.
 */
export class Character {
  constructor({ scene, animations = [] } = {}, options = {}) {
    this.root = new THREE.Group();
    this.body = scene ?? new THREE.Group();
    this.root.add(this.body);

    this.mixer = null;
    this.actions = new Map();
    this.current = null;
    this.available = new Set();
    this.resolved = {};

    this.locomotion = 0; // 0 idle .. 1 sprinting
    this._phase = Math.random() * Math.PI * 2;
    this._lean = 0;
    this._flash = 0;

    if (animations.length) {
      this.mixer = new THREE.AnimationMixer(this.body);
      for (const clip of animations) {
        this.actions.set(clip.name.toLowerCase(), this.mixer.clipAction(clip));
      }
      this._resolveAliases(animations);
    }

    if (options.targetHeight) this.normalizeHeight(options.targetHeight);
    if (options.faceZ) this.faceForward(options.faceZ);
  }

  get isRigged() {
    return this.mixer !== null;
  }

  _resolveAliases(animations) {
    for (const [intent, patterns] of Object.entries(CLIP_ALIASES)) {
      const match = animations.find((clip) => {
        const name = clip.name.toLowerCase();
        return patterns.some((p) => name.includes(p));
      });
      if (match) {
        this.resolved[intent] = match.name.toLowerCase();
        this.available.add(intent);
      }
    }
    if (!this.resolved.idle && animations.length) {
      this.resolved.idle = animations[0].name.toLowerCase();
      this.available.add('idle');
    }
  }

  /**
   * Meshy normalises every export to ~1.9 units regardless of subject, so
   * scale by measured bounds and drop the feet to the group origin.
   */
  normalizeHeight(targetHeight) {
    const skinned = this._findSkinnedMesh();

    if (skinned) {
      // Rigged path. A skinned mesh's node transform is ignored at render time
      // (glTF spec) — the joints position it — but Box3.setFromObject applies
      // it anyway. Blender's exporter puts a 90-degree X rotation on the
      // armature root for its Z-up/Y-up conversion, so a world-space box
      // measures the model's DEPTH as its height and the character comes out
      // roughly 4x too large. Measure the bind-pose geometry directly instead.
      skinned.geometry.computeBoundingBox();
      const bb = skinned.geometry.boundingBox;
      const bindHeight = bb.max.y - bb.min.y;
      if (bindHeight > 0.001) this.body.scale.setScalar(targetHeight / bindHeight);
      // Vertical placement is deliberately NOT done here: for a rigged model
      // only the bones know where the feet are. calibrateToFeet() handles it.
      this.body.updateMatrixWorld(true);
      return this;
    }

    const box = new THREE.Box3().setFromObject(this.body);
    const size = box.getSize(new THREE.Vector3());
    if (size.y > 0.001) {
      this.body.scale.setScalar(targetHeight / size.y);
      this.body.updateMatrixWorld(true);
      const scaled = new THREE.Box3().setFromObject(this.body);
      this.body.position.y -= scaled.min.y;
      // Centre horizontally so rotation spins about the body, not an offset.
      const centre = scaled.getCenter(new THREE.Vector3());
      this.body.position.x -= centre.x;
      this.body.position.z -= centre.z;
    }
    return this;
  }

  _findSkinnedMesh() {
    let found = null;
    this.body.traverse((n) => {
      if (!found && n.isSkinnedMesh) found = n;
    });
    return found;
  }

  /** Rotate so the model's front faces -Z, which is what the AI assumes. */
  faceForward(yawOffset = 0) {
    this.body.rotation.y += yawOffset;
    return this;
  }

  has(intent) {
    return this.available.has(intent);
  }

  /**
   * Finds a bone by name. Exporters vary on whether Mixamo's `mixamorig:Hips`
   * keeps its colon, so try the common manglings before giving up.
   */
  getBone(name) {
    if (!this._boneCache) {
      this._boneCache = new Map();
      this.body.traverse((n) => {
        if (n.isBone) this._boneCache.set(n.name, n);
      });
    }
    const variants = [
      name,
      name.replace(':', '_'),
      name.replace(':', ''),
      `mixamorig:${name}`,
      `mixamorig_${name}`,
    ];
    for (const v of variants) {
      const bone = this._boneCache.get(v);
      if (bone) return bone;
    }
    // Last resort: case-insensitive suffix match.
    const wanted = name.split(':').pop().toLowerCase();
    for (const [key, bone] of this._boneCache) {
      if (key.toLowerCase().endsWith(wanted)) return bone;
    }
    return null;
  }

  /**
   * Parents an object to a bone so it follows the animation. Returns false if
   * the bone doesn't exist, letting callers fall back to a fixed offset.
   */
  attachToBone(object, boneName, { position, rotation, scale = 1 } = {}) {
    const bone = this.getBone(boneName);
    if (!bone) return false;

    // The caller has already sized the object in world units. Parenting to a
    // bone would multiply that by the bone's own world scale, so divide it back
    // out — and MULTIPLY the caller's scale rather than replacing it, otherwise
    // a fitted model snaps back to its native size.
    bone.updateWorldMatrix(true, false);
    const boneScale = new THREE.Vector3();
    bone.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), boneScale);
    const compensation = 1 / (boneScale.x || 1);

    if (position) object.position.fromArray(position).multiplyScalar(compensation);
    if (rotation) object.rotation.fromArray(rotation);
    object.scale.multiplyScalar(scale * compensation);

    bone.add(object);
    return true;
  }

  /**
   * Parents an object to a bone but orients it along the character's facing
   * rather than the bone's own axes.
   *
   * Guessing a hand bone's local rotation is hopeless — Mixamo's axes aren't
   * documented and differ per joint. Instead, derive it: we know the world
   * rotation we WANT (the character's forward), and we can read the bone's
   * world rotation, so the required local rotation is simply
   * inverse(boneWorld) * desiredWorld.
   */
  alignToBoneFacing(object, boneName, { position = [0, 0, 0], yaw = Math.PI, pitch = 0, scale = 1 } = {}) {
    const bone = this.getBone(boneName);
    if (!bone) return false;

    this.root.updateMatrixWorld(true);
    bone.updateWorldMatrix(true, false);

    const boneQ = new THREE.Quaternion();
    const rootQ = new THREE.Quaternion();
    const boneScale = new THREE.Vector3();
    bone.getWorldQuaternion(boneQ);
    this.root.getWorldQuaternion(rootQ);
    bone.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), boneScale);

    // Character forward is +Z in root space, and a fitted weapon points down
    // -Z, hence the default half-turn.
    const facing = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    const desiredWorld = rootQ.clone().multiply(facing);
    object.quaternion.copy(boneQ.invert().multiply(desiredWorld));

    const compensation = 1 / (boneScale.x || 1);
    object.position.fromArray(position).multiplyScalar(compensation);
    object.scale.multiplyScalar(scale * compensation);

    bone.add(object);
    return true;
  }

  get boneNames() {
    this.getBone('Hips');
    return [...this._boneCache.keys()];
  }

  /**
   * Plants the feet on the ground.
   *
   * `normalizeHeight` measures the *bind pose* bounding box, which is all a
   * static mesh has. Once a Mixamo clip is driving the rig the hips carry their
   * own vertical offset, so the bind-pose measurement is wrong and the
   * character ends up hovering. Fix it by evaluating one frame of the animation
   * and reading where the foot bone actually lands.
   */
  calibrateToFeet(soleClearance = 0.03) {
    if (!this.mixer) return false;

    const foot =
      this.getBone('mixamorig:LeftToeBase') ||
      this.getBone('mixamorig:LeftFoot') ||
      this.getBone('mixamorig:RightFoot');
    if (!foot) return false;

    // Force the clip to full weight before sampling — it's mid-fade-in, so at
    // near-zero weight the bones would still be in bind pose and the
    // measurement would be meaningless.
    this.current?.setEffectiveWeight(1);
    this.mixer.update(0.016);
    this.root.updateMatrixWorld(true);

    const footWorld = new THREE.Vector3();
    const rootWorld = new THREE.Vector3();
    foot.getWorldPosition(footWorld);
    this.root.getWorldPosition(rootWorld);

    const above = footWorld.y - rootWorld.y;
    this.body.position.y -= above - soleClearance;
    this._cachedBaseY = this.body.position.y;
    this.root.updateMatrixWorld(true);
    return true;
  }

  play(intent, { fade = 0.22, loop = true, clampWhenFinished = false } = {}) {
    if (!this.mixer) return false;
    const key = this.resolved[intent];
    if (!key) return false;

    const action = this.actions.get(key);
    if (!action || action === this.current) return true;

    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = clampWhenFinished;
    action.enabled = true;
    action.setEffectiveWeight(1);

    if (this.current) {
      this.current.crossFadeTo(action, fade, false);
      action.play();
    } else {
      action.fadeIn(fade).play();
    }
    this.current = action;
    return true;
  }

  /** Feed normalised movement speed so the fallback animation has something to react to. */
  setLocomotion(speed01) {
    this.locomotion = THREE.MathUtils.clamp(speed01, 0, 1);
  }

  update(dt) {
    if (this.mixer) {
      this.mixer.update(dt);
    } else {
      this._updateProcedural(dt);
    }

    if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - dt * 5);
      this._applyFlash(this._flash);
    }
  }

  /**
   * Fallback motion for unrigged meshes: a two-beat vertical bounce with a
   * matching side rock and a forward lean that scales with speed. It reads as
   * "moving with weight" without any bones to work with.
   */
  _updateProcedural(dt) {
    const moving = this.locomotion > 0.02;
    this._phase += dt * (moving ? 4.5 + this.locomotion * 5.5 : 1.4);

    const stride = this.locomotion;
    const bounce = Math.abs(Math.sin(this._phase)) * 0.075 * stride;
    const idleBreath = Math.sin(this._phase * 0.9) * 0.012 * (1 - stride);
    const rock = Math.sin(this._phase) * 0.055 * stride;
    const targetLean = stride * 0.14;

    this._lean = THREE.MathUtils.damp(this._lean, targetLean, 7, dt);

    this.body.position.y = this._baseY() + bounce + idleBreath;
    this.body.rotation.x = this._lean;
    this.body.rotation.z = rock;
  }

  _baseY() {
    if (this._cachedBaseY === undefined) this._cachedBaseY = this.body.position.y;
    return this._cachedBaseY;
  }

  flash(strength = 1) {
    this._flash = strength;
    this._applyFlash(strength);
  }

  _applyFlash(strength, color = 0xff4b6b) {
    this.body.traverse((n) => {
      if (!n.isMesh || !n.material) return;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      for (const m of mats) {
        if (!m.emissive) continue;
        if (!m.userData.__baseEmissive) {
          m.userData.__baseEmissive = m.emissive.clone();
          m.userData.__baseIntensity = m.emissiveIntensity ?? 1;
        }
        if (strength <= 0) {
          m.emissive.copy(m.userData.__baseEmissive);
          m.emissiveIntensity = m.userData.__baseIntensity;
        } else {
          m.emissive.setHex(color);
          m.emissiveIntensity = m.userData.__baseIntensity + strength * 2.2;
        }
      }
    });
  }

  setVisible(visible) {
    this.root.visible = visible;
  }

  dispose() {
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
  }
}

/**
 * Primitive stand-in used when a GLB is missing, so the game is always
 * playable. Colour-matched to the project palette.
 */
export function buildPlaceholderTrooper(height = 1.9, bodyColor = 0x2b2d3a, accent = 0xc4a6ff) {
  const group = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.55, metalness: 0.35 });
  const under = new THREE.MeshStandardMaterial({ color: 0x14151d, roughness: 0.8, metalness: 0.15 });
  const visor = new THREE.MeshStandardMaterial({
    color: 0x0a0b10,
    emissive: accent,
    emissiveIntensity: 3.0,
    roughness: 0.25,
    metalness: 0.5,
  });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, height * 0.4, 6, 12), shell);
  torso.position.y = height * 0.6;
  group.add(torso);

  const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, height * 0.1, 4, 10), under);
  hips.position.y = height * 0.4;
  group.add(hips);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 12), shell);
  head.position.y = height * 0.9;
  group.add(head);

  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.06), visor);
  eye.position.set(0, height * 0.9, -0.16);
  group.add(eye);

  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, height * 0.34, 4, 8), shell);
    arm.position.set(side * 0.36, height * 0.58, 0);
    group.add(arm);

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, height * 0.32, 4, 8), under);
    leg.position.set(side * 0.14, height * 0.2, 0);
    group.add(leg);
  }

  group.traverse((n) => {
    if (n.isMesh) {
      n.castShadow = true;
      n.receiveShadow = true;
    }
  });
  return group;
}
