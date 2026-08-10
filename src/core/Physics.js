import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG, FIXED_DT } from '../config.js';

/**
 * Thin wrapper over the Rapier world.
 *
 * Two things it buys us over touching Rapier directly:
 *  - a collider-handle -> game-object map, so a raycast hit can be resolved
 *    back to the Enemy/prop that owns it
 *  - a fixed-timestep accumulator, so physics and character movement stay
 *    deterministic regardless of frame rate
 */
export class Physics {
  static async load() {
    await RAPIER.init();
  }

  constructor() {
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: CONFIG.world.gravity, z: 0 });
    this.world.timestep = FIXED_DT;
    this.owners = new Map();
    this._accumulator = 0;
  }

  register(collider, owner) {
    this.owners.set(collider.handle, owner);
    return collider;
  }

  unregister(collider) {
    this.owners.delete(collider.handle);
  }

  ownerOf(collider) {
    return collider ? this.owners.get(collider.handle) : undefined;
  }

  /** Static trimesh from raw buffers — used for terrain and level geometry. */
  addTrimesh(vertices, indices, owner = null) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(vertices, indices),
      body,
    );
    if (owner) this.register(collider, owner);
    return { body, collider };
  }

  addStaticBox(halfExtents, position, quaternion = null, owner = null) {
    let desc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
    if (quaternion) desc = desc.setRotation(quaternion);
    const body = this.world.createRigidBody(desc);
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z),
      body,
    );
    if (owner) this.register(collider, owner);
    return { body, collider };
  }

  /**
   * Kinematic capsule + character controller. This is the standard rig for
   * anything that walks: the player and every enemy use it.
   */
  addCharacter(position, radius, height, owner = null) {
    const halfHeight = Math.max(0.01, height / 2 - radius);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        position.x,
        position.y,
        position.z,
      ),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius),
      body,
    );
    if (owner) this.register(collider, owner);

    const controller = this.world.createCharacterController(0.02);
    controller.enableAutostep(CONFIG.player.stepHeight, radius * 0.6, true);
    controller.enableSnapToGround(CONFIG.player.snapToGround);
    controller.setMaxSlopeClimbAngle(CONFIG.player.maxSlopeClimbAngle);
    controller.setMinSlopeSlideAngle(CONFIG.player.minSlopeSlideAngle);
    controller.setApplyImpulsesToDynamicBodies(true);
    controller.setCharacterMass(80);

    return { body, collider, controller, halfHeight };
  }

  removeCharacter({ body, collider, controller }) {
    if (collider) this.unregister(collider);
    if (controller) this.world.removeCharacterController(controller);
    if (body) this.world.removeRigidBody(body);
  }

  /**
   * @returns {{point: {x,y,z}, normal: {x,y,z}, distance: number, collider, owner}|null}
   */
  raycast(origin, direction, maxDistance, excludeCollider = null) {
    const ray = new RAPIER.Ray(origin, direction);
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDistance,
      true,
      undefined,
      undefined,
      excludeCollider ?? undefined,
    );
    if (!hit) return null;

    // Rapier renamed `toi` to `timeOfImpact`; accept either so a dependency
    // bump doesn't silently break every raycast in the game.
    const distance = hit.timeOfImpact ?? hit.toi;
    return {
      distance,
      point: {
        x: origin.x + direction.x * distance,
        y: origin.y + direction.y * distance,
        z: origin.z + direction.z * distance,
      },
      normal: hit.normal,
      collider: hit.collider,
      owner: this.ownerOf(hit.collider),
    };
  }

  /**
   * Advances the simulation in fixed steps, calling `stepCallback(FIXED_DT)`
   * before each one so movement code runs at the same rate as the solver.
   * Capped at 5 substeps so a stalled tab can't spiral into a death loop.
   */
  update(dt, stepCallback) {
    this._accumulator += Math.min(dt, 0.25);
    let steps = 0;
    while (this._accumulator >= FIXED_DT && steps < 5) {
      stepCallback(FIXED_DT);
      this.world.step();
      this._accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === 5) this._accumulator = 0;
    return this._accumulator / FIXED_DT; // interpolation alpha, for later use
  }
}
