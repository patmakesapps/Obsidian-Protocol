// Central tuning table. Everything gameplay-feel-related lives here so balance
// passes don't require hunting through systems.

export const FIXED_DT = 1 / 60;

// Art direction: bright white architecture, black inlays and glass, violet
// light. Everything visual pulls from this palette, so a colour change is one
// edit rather than a hunt through every material.
export const PALETTE = {
  white: 0xf4f5fa,
  offWhite: 0xdde2ef,
  concrete: 0xc3c9da,
  black: 0x0d0d13,
  charcoal: 0x1c1d27,
  purple: 0x8b5cf6,
  purpleBright: 0xc4a6ff,
  purpleDeep: 0x4c1d95,
  amber: 0xff9a3c,
  danger: 0xff4b6b,
};

/**
 * Weapon definitions. Every gun the player, allies and enemies can carry is
 * described here; the Weapon class is generic and just reads one of these.
 */
export const WEAPONS = {
  vanguard: {
    id: 'vanguard',
    name: 'WHITEOUT VANGUARD',
    model: '/models/weapon_vanguard.glb',
    damage: 22,
    headshotMultiplier: 2.5,
    rpm: 700,
    magSize: 30,
    reserveMax: 240,
    startingReserve: 150,
    reloadTime: 1.8,
    range: 220,
    spreadHip: 0.015,
    spreadMoving: 0.030,
    recoilPitch: 0.019,
    recoilYaw: 0.007,
    tracerColor: 0xc4a6ff,
    muzzleColor: 0xd9c2ff,
    // Extra yaw applied to the GLB. Set to Math.PI if the gun points backwards.
    modelYaw: 0,
    // Where the gun sits in the right hand bone's local space. Tune these three
    // numbers if the rifle floats away from the grip — they're in bone space,
    // so small values move it a long way.
    // First-person framing. `viewmodelOffset` is where the gun sits relative to
    // the camera; `viewmodelSlide` pushes it back along its own barrel so you
    // see the front of the weapon rather than the whole thing.
    viewmodelOffset: [0.25, -0.23, -0.5],
    viewmodelSlide: 0.16,
    // Third-person hold. `yaw`/`pitch` are relative to the character's facing,
    // not the hand bone, so they're intuitive to tune: yaw swings the barrel
    // left/right, pitch tips it up/down. `position` is a nudge in hand space.
    handGrip: {
      position: [0, 0, 0],
      yaw: Math.PI,
      pitch: 0,
      scale: 1.0,
    },
  },
  thunder: {
    id: 'thunder',
    name: 'OBSIDIAN THUNDER',
    model: '/models/weapon_thunder.glb',
    damage: 41,
    headshotMultiplier: 2.5,
    rpm: 300,
    magSize: 20,
    reserveMax: 160,
    startingReserve: 60,
    reloadTime: 2.25,
    range: 280,
    spreadHip: 0.008,
    spreadMoving: 0.042,
    recoilPitch: 0.048,
    recoilYaw: 0.013,
    tracerColor: 0xff9a3c,
    muzzleColor: 0xffc98a,
    modelYaw: 0,
    // First-person framing. `viewmodelOffset` is where the gun sits relative to
    // the camera; `viewmodelSlide` pushes it back along its own barrel so you
    // see the front of the weapon rather than the whole thing.
    viewmodelOffset: [0.25, -0.23, -0.5],
    viewmodelSlide: 0.16,
    // Third-person hold. `yaw`/`pitch` are relative to the character's facing,
    // not the hand bone, so they're intuitive to tune: yaw swings the barrel
    // left/right, pitch tips it up/down. `position` is a nudge in hand space.
    handGrip: {
      position: [0, 0, 0],
      yaw: Math.PI,
      pitch: 0,
      scale: 1.0,
    },
  },
};

export const CONFIG = {
  world: {
    gravity: -24,
    citySize: 430,
    blockSize: 44,
    streetWidth: 18,
    fogColor: 0xb9b0e2,
    fogDensity: 0.0038,
    // The imported Meshy props read as gritty industrial clutter against the
    // clean white towers, so they're off. Flip to true to bring them back —
    // the placement code is intact.
    useGlbProps: false,
  },

  // First person only. Third person is gone: it needed a camera-collision
  // system, a visible player body, a duplicate world weapon model and its own
  // aiming path, all to serve a mode this game doesn't want.
  camera: {
    fov: 78,
    shakeDecay: 8.0,
    shakeOnHit: 0.06,
    shakeOnKill: 0.02,
  },

  // Hit feedback. Combat reads as weightless without this.
  feedback: {
    bloodParticles: 22,
    bloodSpeed: 6.5,
    bloodColor: 0xc0203a,
    sparkColor: 0xc4a6ff,
    // A bolt passing within this radius of the player's head cracks past them.
    whizzRadius: 2.2,
    whizzCooldown: 0.12,
  },

  player: {
    standHeight: 1.8,
    crouchHeight: 1.15,
    radius: 0.34,
    eyeDrop: 0.16, // eye sits this far below the top of the capsule

    walkSpeed: 5.4,
    sprintSpeed: 9.0,
    crouchSpeed: 2.5,
    groundAccel: 55,
    airAccel: 14,
    groundFriction: 11,

    jumpSpeed: 8.0,
    coyoteTime: 0.12,
    jumpBuffer: 0.14,

    maxSlopeClimbAngle: (50 * Math.PI) / 180,
    minSlopeSlideAngle: (38 * Math.PI) / 180,
    stepHeight: 0.45,
    snapToGround: 0.35,

    mouseSensitivity: 0.0021,
    pitchLimit: (89 * Math.PI) / 180,

    maxHealth: 100,
    regenDelay: 6.0,
    regenRate: 8.0,

    model: '/models/player.glb',
    loadout: ['vanguard'],
  },

  enemy: {
    model: '/models/enemy.glb',
    health: 90,
    speed: 3.8,
    sprintSpeed: 5.8,
    radius: 0.42,
    height: 1.9,
    turnRate: 6.0,
    count: 26,
    // Hostiles are spawned in squads around scattered anchors and stay dormant
    // until the player closes in, so you meet them in fights rather than as one
    // 26-strong swarm converging from every direction at once.
    squadSize: 4,
    squadSpread: 9,
    activationRange: 78,

    sightRange: 70,
    fireRange: 52,
    preferredRange: 19, // holds this distance and shoots
    tooCloseRange: 8, // backs off below this
    meleeRange: 2.3,
    meleeDamage: 12,
    meleeCooldown: 1.1,

    // Ranged fire: a telegraph flash, then a short burst, then a cooldown.
    telegraphTime: 0.42,
    burstCount: 3,
    burstDelay: 0.13,
    fireCooldown: 1.9,
    aimSpread: 0.042,
    projectileSpeed: 62,
    projectileDamage: 9,
    weapon: 'thunder',
    dropChance: 0.55,
  },

  ally: {
    model: '/models/ally.glb',
    // Tougher than hostiles on purpose: a squad that dies in the first
    // engagement may as well not exist.
    health: 190,
    // Never chase an enemy further than this from the player.
    maxLeash: 26,
    speed: 4.2,
    sprintSpeed: 7.2,
    radius: 0.4,
    height: 1.9,
    turnRate: 7.0,
    count: 3,

    followDistance: 7,
    followSpread: 3.2,
    sightRange: 62,
    fireRange: 48,
    preferredRange: 16,

    telegraphTime: 0.25,
    burstCount: 4,
    burstDelay: 0.1,
    fireCooldown: 1.5,
    aimSpread: 0.030,
    projectileSpeed: 70,
    projectileDamage: 11,
    weapon: 'vanguard',
    dropChance: 1.0,
  },

  drone: {
    model: '/models/drone.glb',
    health: 48,
    radius: 0.55,
    height: 0.6,

    count: 6,
    hoverHeight: 7.0,
    speed: 8.5,
    bobAmount: 0.35,
    turnRate: 4.0,

    sightRange: 75,
    fireRange: 44,
    preferredRange: 22,
    telegraphTime: 0.5,
    burstCount: 2,
    burstDelay: 0.16,
    fireCooldown: 2.4,
    aimSpread: 0.035,
    projectileSpeed: 58,
    projectileDamage: 7,
  },

  pickups: {
    // Ammo/health crates appear near the player when they're actually needed,
    // rather than littering the map from the start.
    lowAmmoFraction: 0.35,
    lowHealthFraction: 0.55,
    spawnCooldown: 12,
    maxActive: 6,
    spawnRadiusMin: 14,
    spawnRadiusMax: 34,
    ammoAmount: 90,
    healthAmount: 40,
    pickupRadius: 1.5,
    despawnTime: 60,
    droppedWeaponLifetime: 45,
  },
};
