import * as THREE from 'three';
import { CONFIG, PALETTE } from '../config.js';
import { Physics } from './Physics.js';
import { Input } from './Input.js';
import { Assets } from './Assets.js';
import { Audio } from './Audio.js';
import { createSky } from '../world/Sky.js';
import { Level } from '../world/Level.js';
import { Player } from '../player/Player.js';
import { CameraRig } from '../player/CameraRig.js';
import { Weapon } from '../player/Weapon.js';
import { Loadout } from '../player/Loadout.js';
import { Projectiles } from '../combat/Projectiles.js';
import { Enemy, Ally, Drone } from '../entities/Combatants.js';
import { Pickups } from '../items/Pickups.js';
import { Objectives } from '../game/Objectives.js';
import { HUD } from '../ui/HUD.js';
import { makeRandom } from './noise.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.CONFIG = CONFIG;
    this.running = false;
    this.started = false;
    this.elapsed = 0;
    this._lastFrameAt = 0;
    this.rand = makeRandom(20260810);

    this.enemies = [];
    this.allies = [];
    this.squads = [];
    this.pendingSpawns = [];

    this._setupRenderer();
    this._setupScene();
  }

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    // A 4K display at devicePixelRatio 2 means shading 4x the pixels. 1.5 is
    // visually near-identical and a large win on heavy scenes.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this._onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', this._onResize);
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.camera.fov,
      window.innerWidth / window.innerHeight,
      0.05,
      1400,
    );
    // The viewmodel is parented to the camera, so the camera must be in the
    // scene graph for it to render.
    this.scene.add(this.camera);
  }

  async load(onProgress = () => {}) {
    onProgress('INITIALISING PHYSICS');
    await Physics.load();
    this.physics = new Physics();

    this.assets = new Assets();
    this.audio = new Audio();
    this.hud = new HUD();
    this.input = new Input(this.canvas);

    onProgress('BUILDING CITY');
    this.sky = createSky(this.scene);
    this.level = new Level(this.scene, this.physics, this.assets);
    await this.level.build();

    onProgress('DEPLOYING OPERATIVE');
    this.player = new Player({
      physics: this.physics,
      input: this.input,
      audio: this.audio,
      level: this.level,
      hud: this.hud,
      scene: this.scene,
    });
    this.cameraRig = new CameraRig({
      camera: this.camera,
      player: this.player,
      physics: this.physics,
      input: this.input,
    });

    this.projectiles = new Projectiles(this.scene, this.physics, {
      listener: this.player,
      onPlayerHit: () => {
        this.hud.flashDamage();
        this.cameraRig.addShake(CONFIG.camera.shakeOnHit);
      },
      onNearMiss: (closeness) => {
        this.audio.whizz(closeness);
        this.cameraRig.addShake(0.004 * (1 - closeness));
      },
    });

    onProgress('ISSUING ORDNANCE');
    this.loadout = new Loadout({
      hud: this.hud,
      audio: this.audio,
      startingIds: CONFIG.player.loadout,
      createWeapon: (def) => this._createWeapon(def),
    });
    await this.loadout.init();

    this.pickups = new Pickups({
      scene: this.scene,
      level: this.level,
      player: this.player,
      loadout: this.loadout,
      hud: this.hud,
      audio: this.audio,
      assets: this.assets,
    });

    this.world = {
      player: this.player,
      enemies: this.enemies,
      allies: this.allies,
    };

    onProgress('SPAWNING SQUAD');
    for (let i = 0; i < CONFIG.ally.count; i++) await this._spawnAlly(i);

    onProgress('DEPLOYING HOSTILES');
    await this._spawnSquads(CONFIG.enemy.count);
    for (let i = 0; i < CONFIG.drone.count; i++) await this._spawnDrone();

    this.objectives = new Objectives({
      scene: this.scene,
      level: this.level,
      player: this.player,
      hud: this.hud,
      audio: this.audio,
      game: this,
    });
    this.objectives.start();

    this.hud.setHealth(this.player.health, CONFIG.player.maxHealth);

    this.input.onLockChange = (locked) => {
      if (!locked && this.running && this.player.alive) this.pause();
    };

    // Render one frame so the world is visible behind the start overlay.
    this.player.update(0.016, this.cameraRig);
    this.cameraRig.update(0.016);
    this.renderer.render(this.scene, this.camera);

    return this;
  }

  async _createWeapon(def) {
    const weapon = new Weapon({
      scene: this.scene,
      camera: this.camera,
      physics: this.physics,
      player: this.player,
      audio: this.audio,
      hud: this.hud,
      cameraRig: this.cameraRig,
      projectiles: this.projectiles,
      def,
    });

    const instance = await this.assets.instantiate(def.model);
    if (instance) weapon.attachModel(instance.scene);

    return weapon;
  }

  // ------------------------------------------------------------------ spawns

  /**
   * Spawns hostiles as squads clustered around scattered anchors rather than
   * sprinkled individually. Combined with squad-wide alerting, that turns the
   * map into a series of encounters instead of one continuous trickle.
   */
  async _spawnSquads(total) {
    const cfg = CONFIG.enemy;
    let remaining = total;

    while (remaining > 0) {
      const anchor = this._pickSpawnPoint(70);
      const size = Math.min(remaining, cfg.squadSize);
      const squad = [];

      for (let i = 0; i < size; i++) {
        const spread = cfg.squadSpread;
        const at = anchor.clone().add(
          new THREE.Vector3((this.rand() - 0.5) * spread, 0, (this.rand() - 0.5) * spread),
        );
        const enemy = await this._spawnEnemy(0, at);
        enemy.squad = squad;
        // Vary standoff distance within a squad so they don't stack up on one
        // line: some push in close, others hang back and suppress.
        enemy.cfg = {
          ...enemy.cfg,
          preferredRange: cfg.preferredRange * (0.6 + i * 0.28),
        };
        squad.push(enemy);
        remaining--;
      }
      this.squads.push(squad);
    }
  }

  async _spawnEnemy(minDistanceFromPlayer = 45, at = null) {
    const point = at ?? this._pickSpawnPoint(minDistanceFromPlayer);
    const enemy = new Enemy({
      scene: this.scene,
      physics: this.physics,
      level: this.level,
      audio: this.audio,
      projectiles: this.projectiles,
      world: this.world,
      position: point,
      model: await this.assets.instantiate(CONFIG.enemy.model),
    });
    enemy.onDeath = (a) => {
      this.pickups?.dropWeapon(a);
      this.objectives?.notifyKill();
      this.pendingSpawns.push({ at: this.elapsed + 8 + this.rand() * 8, kind: 'enemy' });
    };
    this.enemies.push(enemy);
    return enemy;
  }

  async _spawnDrone() {
    const point = this._pickSpawnPoint(50);
    const drone = new Drone({
      scene: this.scene,
      physics: this.physics,
      level: this.level,
      audio: this.audio,
      projectiles: this.projectiles,
      world: this.world,
      position: point,
      model: await this.assets.instantiate(CONFIG.drone.model),
    });
    drone.onDeath = () => {
      this.objectives?.notifyKill();
      this.pendingSpawns.push({ at: this.elapsed + 14 + this.rand() * 10, kind: 'drone' });
    };
    this.enemies.push(drone);
    return drone;
  }

  async _spawnAlly(slot) {
    const angle = Math.PI + (slot - 1) * 0.7;
    const point = new THREE.Vector3(
      this.player.position.x + Math.sin(angle) * 5,
      0,
      this.player.position.z + Math.cos(angle) * 5,
    );
    const ally = new Ally({
      scene: this.scene,
      physics: this.physics,
      level: this.level,
      audio: this.audio,
      projectiles: this.projectiles,
      world: this.world,
      position: point,
      slot,
      model: await this.assets.instantiate(CONFIG.ally.model),
    });
    ally.onDeath = (a) => {
      this.pickups?.dropWeapon(a);
      this.pendingSpawns.push({ at: this.elapsed + 25, kind: 'ally', slot });
    };
    this.allies.push(ally);
    return ally;
  }

  _pickSpawnPoint(minDistance) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const candidate = this.level.randomSpawnPoint(this.rand);
      if (!candidate) break;
      if (!this.player || candidate.distanceTo(this.player.position) >= minDistance) {
        return candidate.clone();
      }
    }
    return (this.level.randomSpawnPoint(this.rand) ?? new THREE.Vector3(30, 0, 30)).clone();
  }

  // -------------------------------------------------------------------- loop

  start() {
    if (this.running) return;
    this.running = true;
    this.started = true;
    this.audio.resume();
    this.hud.show();
    this.input.requestLock();
    this._lastFrameAt = performance.now();
    this._loop();
  }

  pause() {
    this.running = false;
    this.onPause?.();
  }

  resume() {
    if (this.running) return;
    this.running = true;
    this._lastFrameAt = performance.now();
    this.input.requestLock();
    this._loop();
  }

  _loop = () => {
    if (!this.running) return;
    requestAnimationFrame(this._loop);

    const now = performance.now();
    const dt = Math.min((now - this._lastFrameAt) / 1000, 0.1);
    this._lastFrameAt = now;
    this.elapsed += dt;

    // Physics + movement on a fixed step; presentation per frame.
    this.physics.update(dt, (step) => {
      this.player.fixedUpdate(step);
      for (const enemy of this.enemies) enemy.fixedUpdate(step);
      for (const ally of this.allies) ally.fixedUpdate(step);
    });

    this.player.update(dt, this.cameraRig);
    this.cameraRig.update(dt);
    this.loadout.update(dt, this.input);
    this.projectiles.update(dt);
    this.pickups.update(dt);
    this.objectives.update(dt);

    for (const enemy of this.enemies) enemy.update(dt);
    for (const ally of this.allies) ally.update(dt);

    this._cullAndRespawn();
    this._trackShadows();

    if (!this.player.alive && this.input.wasPressed('Enter')) {
      this.player.respawn();
      this.input.requestLock();
    }

    this.hud.updateFps(dt);
    if (this.input.wasPressed('F3')) this._debug = !this._debug;
    if (this._debug) this._reportDebug();
    else if (this._debugWasOn) this.hud.setDebug(null);
    this._debugWasOn = this._debug;

    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  };

  _reportDebug() {
    const p = this.player;
    const rig = this.cameraRig;
    const info = this.renderer.info;
    const weapon = this.loadout.current;
    const fmt = (v) => v.toFixed(2).padStart(7);

    this.hud.setDebug([
      `fps        ${this.hud.lastFps}   draws ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k`,
      `player     x${fmt(p.position.x)} y${fmt(p.position.y)} z${fmt(p.position.z)}`,
      `velocity   x${fmt(p.velocity.x)} y${fmt(p.velocity.y)} z${fmt(p.velocity.z)}`,
      `grounded   ${p.grounded}   height ${p.height.toFixed(2)}  alive ${p.alive}`,
      `camera     shake ${rig.shake.toFixed(3)}  fov ${this.camera.fov.toFixed(0)}`,
      `cam pos    x${fmt(this.camera.position.x)} y${fmt(this.camera.position.y)} z${fmt(this.camera.position.z)}`,
      `look       yaw ${p.yaw.toFixed(2)} pitch ${p.pitch.toFixed(2)}`,
      `weapon     ${weapon ? weapon.def.id : 'none'}  ${weapon ? weapon.mag : 0}/${weapon ? weapon.reserve : 0}`,
      `actors     ${this.enemies.length} hostile  ${this.allies.length} allied  ${this.projectiles.activeCount} bolts`,
      `lights     ${info.render.calls > 0 ? this._countLights() : '?'}`,
    ]);
  }

  _countLights() {
    if (this._lightCount === undefined) {
      let n = 0;
      this.scene.traverse((o) => {
        if (o.isLight) n++;
      });
      this._lightCount = n;
    }
    return this._lightCount;
  }

  _cullAndRespawn() {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].removed) this.enemies.splice(i, 1);
    }
    for (let i = this.allies.length - 1; i >= 0; i--) {
      if (this.allies[i].removed) this.allies.splice(i, 1);
    }

    while (this.pendingSpawns.length && this.pendingSpawns[0].at <= this.elapsed) {
      const job = this.pendingSpawns.shift();
      if (job.kind === 'enemy') this._spawnEnemy();
      else if (job.kind === 'drone') this._spawnDrone();
      else if (job.kind === 'ally') this._spawnAlly(job.slot ?? 0);
    }
  }

  /**
   * Keeps the shadow frustum centred on the player, snapped to whole shadow
   * texels. Without the snap the whole shadow map crawls as you walk.
   */
  _trackShadows() {
    const p = this.player.position;
    const span = this.sky.shadowSpan;
    const texel = (span * 2) / this.sky.sun.shadow.mapSize.x;
    const sx = Math.round(p.x / texel) * texel;
    const sz = Math.round(p.z / texel) * texel;

    this.sky.sun.position.set(
      sx + this.sky.sunDir.x * 90,
      this.sky.sunDir.y * 90,
      sz + this.sky.sunDir.z * 90,
    );
    this.sky.sun.target.position.set(sx, 0, sz);
    this.sky.sun.target.updateMatrixWorld();
    this.sky.dome.position.set(p.x, 0, p.z);
  }

  dispose() {
    this.running = false;
    window.removeEventListener('resize', this._onResize);
    this.input?.dispose();
    this.renderer.dispose();
  }
}
