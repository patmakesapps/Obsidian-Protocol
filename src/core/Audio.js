// Fully synthesised SFX — no audio files to ship, and it means the game has
// weight before any real sound design happens. Swap for sampled audio later by
// replacing these methods.

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.enabled = true;
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
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this._makeNoise(1.0);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  _noiseBurst({ duration = 0.12, gain = 0.6, filterType = 'lowpass', freq = 1200, q = 1 }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = this.ctx.createGain();
    const now = this.ctx.currentTime;
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.connect(filter).connect(env).connect(this.master);
    src.start(now);
    src.stop(now + duration + 0.02);
  }

  _tone({ freq = 440, duration = 0.1, gain = 0.2, type = 'sine', slideTo = null }) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    const env = this.ctx.createGain();
    const now = this.ctx.currentTime;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(env).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  shoot() {
    if (!this.ctx) return;
    // Layered: a bright transient crack over a low thump, plus a synth "pulse"
    // whine so it reads as energy weapon rather than ballistic.
    this._noiseBurst({ duration: 0.09, gain: 0.55, filterType: 'highpass', freq: 1800 });
    this._noiseBurst({ duration: 0.16, gain: 0.4, filterType: 'lowpass', freq: 420 });
    this._tone({ freq: 900, slideTo: 180, duration: 0.12, gain: 0.14, type: 'sawtooth' });
  }

  dryFire() {
    if (!this.ctx) return;
    this._noiseBurst({ duration: 0.04, gain: 0.25, filterType: 'bandpass', freq: 2600, q: 6 });
  }

  reload() {
    if (!this.ctx) return;
    this._noiseBurst({ duration: 0.07, gain: 0.3, filterType: 'bandpass', freq: 1400, q: 3 });
    setTimeout(() => this.ctx && this._tone({ freq: 320, duration: 0.06, gain: 0.15, type: 'square' }), 240);
    setTimeout(() => this.ctx && this._noiseBurst({ duration: 0.08, gain: 0.32, filterType: 'bandpass', freq: 900, q: 4 }), 900);
  }

  impact() {
    if (!this.ctx) return;
    this._noiseBurst({ duration: 0.07, gain: 0.22, filterType: 'bandpass', freq: 3000, q: 2 });
  }

  hitConfirm(isHeadshot = false) {
    if (!this.ctx) return;
    this._tone({ freq: isHeadshot ? 2100 : 1400, duration: 0.05, gain: 0.18, type: 'sine' });
    if (isHeadshot) this._tone({ freq: 2800, duration: 0.07, gain: 0.1, type: 'triangle' });
  }

  /** Supersonic crack of a round passing close by. `closeness` is 0..1. */
  whizz(closeness = 0.5) {
    if (!this.ctx) return;
    const near = 1 - closeness;
    this._noiseBurst({
      duration: 0.05 + near * 0.05,
      gain: 0.1 + near * 0.22,
      filterType: 'bandpass',
      freq: 1400 + near * 2600,
      q: 1.5,
    });
    this._tone({
      freq: 2600 + near * 1200,
      slideTo: 500,
      duration: 0.07,
      gain: 0.05 + near * 0.09,
      type: 'sine',
    });
  }

  enemyDeath() {
    if (!this.ctx) return;
    this._tone({ freq: 420, slideTo: 60, duration: 0.55, gain: 0.2, type: 'sawtooth' });
    this._noiseBurst({ duration: 0.4, gain: 0.3, filterType: 'lowpass', freq: 700 });
  }

  playerHurt() {
    if (!this.ctx) return;
    this._tone({ freq: 180, slideTo: 70, duration: 0.3, gain: 0.25, type: 'triangle' });
  }

  footstep() {
    if (!this.ctx) return;
    this._noiseBurst({ duration: 0.08, gain: 0.12, filterType: 'lowpass', freq: 900 });
  }

  weaponSwitch() {
    if (!this.ctx) return;
    this._noiseBurst({ duration: 0.05, gain: 0.22, filterType: 'bandpass', freq: 1800, q: 5 });
    this._tone({ freq: 520, slideTo: 880, duration: 0.09, gain: 0.11, type: 'square' });
  }

  /** Incoming fire is pitched lower than the player's own gun so it's distinct. */
  enemyShoot(faction = 'enemy') {
    if (!this.ctx) return;
    const ally = faction === 'ally';
    this._noiseBurst({
      duration: 0.07,
      gain: ally ? 0.16 : 0.22,
      filterType: 'highpass',
      freq: ally ? 1500 : 900,
    });
    this._tone({
      freq: ally ? 700 : 380,
      slideTo: ally ? 200 : 110,
      duration: 0.1,
      gain: 0.08,
      type: 'sawtooth',
    });
  }

  /** Two-note rising chime for a new objective. */
  objective() {
    if (!this.ctx) return;
    this._tone({ freq: 520, duration: 0.12, gain: 0.11, type: 'sine' });
    setTimeout(() => this.ctx && this._tone({ freq: 780, duration: 0.18, gain: 0.1, type: 'sine' }), 110);
  }

  objectiveComplete() {
    if (!this.ctx) return;
    this._tone({ freq: 660, duration: 0.1, gain: 0.13, type: 'sine' });
    setTimeout(() => this.ctx && this._tone({ freq: 880, duration: 0.1, gain: 0.13, type: 'sine' }), 90);
    setTimeout(() => this.ctx && this._tone({ freq: 1320, duration: 0.26, gain: 0.12, type: 'sine' }), 190);
  }

  /** Low percussive thump with a bright leading crack. */
  explosion() {
    if (!this.ctx) return;
    this._noiseBurst({ duration: 0.09, gain: 0.5, filterType: 'highpass', freq: 2200 });
    this._noiseBurst({ duration: 0.55, gain: 0.6, filterType: 'lowpass', freq: 260 });
    this._tone({ freq: 150, slideTo: 34, duration: 0.5, gain: 0.32, type: 'sine' });
    this._tone({ freq: 620, slideTo: 90, duration: 0.22, gain: 0.14, type: 'sawtooth' });
  }

  pickup() {
    if (!this.ctx) return;
    this._tone({ freq: 660, slideTo: 1320, duration: 0.14, gain: 0.16, type: 'sine' });
    this._tone({ freq: 990, duration: 0.1, gain: 0.08, type: 'triangle' });
  }
}
