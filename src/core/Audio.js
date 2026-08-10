// Sampled SFX. Clips live in public/audio/ and are listed in MANIFEST below;
// a clip that is missing (or fails to decode) simply plays nothing, so an
// empty slot costs a fetch at load time and nothing after that. Multiple
// files under one key are random-picked variants.
//
// Music: `music_<levelId>` (e.g. music_arcology.mp3, music_basin.mp3) is that
// level's looping track. Levels without one fall back to the shared `music`
// playlist, played back-to-back on repeat.

const MANIFEST = {
  shoot: ['shoot_1'],
  enemy_shoot: ['enemy_shoot_1'],
  ally_shoot: ['ally_shoot_1'],
  impact: ['impact_1'],
  explosion: ['explosion_1', 'explosion_2', 'explosion_3', 'explosion_4'],
  enemy_death: ['enemy_death_1'],
  pickup: ['pickup_1'],
  health_pickup: ['health_pickup_1'],
  deploy: ['deploy_1'],
  dry_fire: ['dry_fire_1'],
  reload: ['reload_1'],
  hit_confirm: ['hit_confirm_1'],
  headshot: ['headshot_1'],
  whizz: ['whizz_1', 'whizz_2'],
  player_hurt: ['player_hurt_1'],
  footstep: ['footstep_1'],
  run_loop: ['run_loop_1'],
  walk_loop: ['walk_loop_1'],
  weapon_switch: ['weapon_switch_1'],
  objective: ['objective_1'],
  objective_complete: ['objective_complete_1'],
  victory: ['victory_1'],
  music: ['music_1', 'music_2'],
  music_arcology: ['music_arcology'],
  music_basin: ['music_basin'],
};

const EXTENSIONS = ['mp3', 'wav', 'ogg'];
const MASTER_GAIN = 0.35;
const MUSIC_GAIN = 0.5; // relative to master
const MUTE_KEY = 'op_audio_muted';

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.enabled = true;
    this.buffers = {};
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
    /** Set by Game before resume() so music can pick the level's track. */
    this.levelId = null;
    this._lastPlayed = {};
    this._moveState = null;
    this._moveSrc = null;
    this._musicStarted = false;
    this._musicIndex = 0;
    this._musicSrc = null;
  }

  /** Must be called from a user gesture (the deploy button). */
  resume() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        this.enabled = false;
        return;
      }
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = MUSIC_GAIN;
      this.musicBus.connect(this.master);
      this._loadAll();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** Flip mute on/off, persist it, and return the new muted state. */
  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    if (this.master) {
      // Short ramp instead of a hard cut so the toggle itself doesn't click.
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_GAIN, now, 0.03);
    }
    return this.muted;
  }

  /**
   * Looping movement bed: 'run' | 'walk' | null. Called every frame with the
   * player's current state; starts, swaps or fades out the loop on change.
   */
  setMovement(state) {
    // Same state with the loop already going (or nothing to go to) — no work.
    // A same-state call with no source retries, which covers clips that were
    // still decoding the first time the state was requested.
    if (state === this._moveState && (this._moveSrc || !state)) return;
    this._moveState = state;

    if (this._moveSrc) {
      const { src, env } = this._moveSrc;
      const now = this.ctx.currentTime;
      // Fade rather than cut — a hard stop mid-waveform clicks.
      env.gain.setTargetAtTime(0, now, 0.05);
      src.stop(now + 0.3);
      this._moveSrc = null;
    }

    if (!state || !this.ctx) return;
    const list = this.buffers[`${state}_loop`];
    if (!list || !list.length) return;

    const src = this.ctx.createBufferSource();
    src.buffer = list[0];
    src.loop = true;
    const env = this.ctx.createGain();
    env.gain.value = 0;
    env.gain.setTargetAtTime(state === 'run' ? 0.4 : 0.3, this.ctx.currentTime, 0.04);
    src.connect(env).connect(this.master);
    src.start();
    this._moveSrc = { src, env };
  }

  /** Stops music and releases the context. A disposed Audio stays silent. */
  dispose() {
    if (this._musicSrc) {
      this._musicSrc.onended = null;
      try {
        this._musicSrc.stop();
      } catch {
        /* already stopped */
      }
      this._musicSrc = null;
    }
    this.ctx?.close();
    this.ctx = null;
  }

  // ------------------------------------------------------------- sample bank

  async _loadAll() {
    const jobs = [];
    for (const [key, names] of Object.entries(MANIFEST)) {
      for (const name of names) jobs.push(this._loadClip(key, name));
    }
    await Promise.all(jobs);
    if (!this.ctx) return; // disposed while decoding
    // Music and the deploy stinger want the decoded buffers, so they start
    // here rather than in resume().
    this._play('deploy', { gain: 0.5, jitter: 0 });
    this._startMusic();
  }

  async _loadClip(key, name) {
    for (const ext of EXTENSIONS) {
      try {
        const res = await fetch(`audio/${name}.${ext}`);
        if (!res.ok) continue;
        const raw = await res.arrayBuffer();
        const buffer = await this.ctx.decodeAudioData(raw);
        (this.buffers[key] ??= []).push(buffer);
        return;
      } catch {
        // Missing or undecodable — try the next extension, else the slot
        // stays empty and the sound is silent.
      }
    }
  }

  /**
   * Play a random variant of `key`. `minInterval` (seconds) throttles keys
   * whose clips are long enough to stack badly when retriggered fast.
   */
  _play(key, { gain = 1, rate = 1, jitter = 0.05, minInterval = 0 } = {}) {
    if (!this.ctx) return false;
    const list = this.buffers[key];
    if (!list || !list.length) return false;
    const now = this.ctx.currentTime;
    if (minInterval && now - (this._lastPlayed[key] ?? -Infinity) < minInterval) return true;
    this._lastPlayed[key] = now;
    const src = this.ctx.createBufferSource();
    src.buffer = list[(Math.random() * list.length) | 0];
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);
    const env = this.ctx.createGain();
    env.gain.value = gain;
    src.connect(env).connect(this.master);
    src.start();
    return true;
  }

  // ------------------------------------------------------------------- music

  _startMusic() {
    if (this._musicStarted) return;
    // A per-level track loops alone; otherwise the shared playlist rotates.
    const tracks = this.buffers[`music_${this.levelId}`] ?? this.buffers.music;
    if (!tracks || !tracks.length) return;
    this._musicStarted = true;

    const playNext = () => {
      if (!this.ctx) return;
      const src = this.ctx.createBufferSource();
      src.buffer = tracks[this._musicIndex % tracks.length];
      this._musicIndex++;
      src.connect(this.musicBus);
      src.onended = playNext;
      src.start();
      this._musicSrc = src;
    };
    playNext();
  }

  // --------------------------------------------------------------------- sfx

  shoot() {
    this._play('shoot', { gain: 0.7 });
  }

  dryFire() {
    this._play('dry_fire', { gain: 0.4 });
  }

  reload() {
    this._play('reload', { gain: 0.5, jitter: 0 });
  }

  impact() {
    this._play('impact', { gain: 0.45 });
  }

  hitConfirm(isHeadshot = false) {
    if (isHeadshot) {
      // The headshot sting is seconds long; retriggering it on every rapid
      // follow-up headshot stacks into mush, so it gets a cooldown.
      if (this._play('headshot', { gain: 0.5, jitter: 0, minInterval: 2 })) return;
    }
    this._play('hit_confirm', { gain: 0.5, jitter: 0 });
  }

  /** Supersonic crack of a round passing close by. `closeness` is 0..1. */
  whizz(closeness = 0.5) {
    this._play('whizz', { gain: 0.15 + (1 - closeness) * 0.5 });
  }

  enemyDeath() {
    this._play('enemy_death', { gain: 0.6 });
  }

  playerHurt() {
    this._play('player_hurt', { gain: 0.6 });
  }

  footstep() {
    this._play('footstep', { gain: 0.3, jitter: 0.12 });
  }

  weaponSwitch() {
    this._play('weapon_switch', { gain: 0.5, jitter: 0 });
  }

  /** Incoming fire is pitched up for allies so it reads as friendly. */
  enemyShoot(faction = 'enemy') {
    const ally = faction === 'ally';
    if (ally && this._play('ally_shoot', { gain: 0.35, rate: 1.15 })) return;
    this._play('enemy_shoot', { gain: ally ? 0.35 : 0.5, rate: ally ? 1.3 : 1 });
  }

  objective() {
    this._play('objective', { gain: 0.5, jitter: 0 });
  }

  objectiveComplete() {
    this._play('objective_complete', { gain: 0.5, jitter: 0 });
  }

  /** Mission complete sting. */
  victory() {
    this._play('victory', { gain: 0.6, jitter: 0 });
  }

  explosion() {
    this._play('explosion', { gain: 0.8 });
  }

  /** `kind` is 'health' | 'ammo' | 'weapon' — health has its own clip. */
  pickup(kind = 'ammo') {
    if (kind === 'health' && this._play('health_pickup', { gain: 0.45, jitter: 0 })) return;
    this._play('pickup', { gain: 0.45, jitter: 0 });
  }
}
