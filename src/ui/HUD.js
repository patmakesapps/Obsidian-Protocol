import * as THREE from 'three';

/** Scratch vector for world-to-screen projection of damage numbers. */
const _projected = new THREE.Vector3();

/**
 * DOM-based HUD. Kept out of the WebGL scene so text stays crisp at any
 * resolution and so restyling is a CSS change, not a shader change.
 */
/**
 * Aim blend at which the optic takes over and the weapon disappears. Shared
 * with Weapon so the two swap on exactly the same frame — split them and you
 * get either a floating gun over the reticle or a blank frame between the two.
 */
export const SCOPE_AT = 0.45;

/** How many damage numbers can be on screen at once. */
const DAMAGE_POOL = 24;
/** Seconds a damage number lives. */
const DAMAGE_LIFE = 0.95;

export const SCORE = {
  hit: 0, // points are for kills, not chip damage
  kill: 100,
  headshotKill: 150,
  droneKill: 75,
};

export class HUD {
  constructor() {
    this.root = document.getElementById('hud');
    this.healthFill = document.getElementById('health-fill');
    this.healthValue = document.getElementById('health-value');
    this.ammoMag = document.getElementById('ammo-mag');
    this.ammoReserve = document.getElementById('ammo-reserve');
    this.reloadPrompt = document.getElementById('reload-prompt');
    this.hitmarker = document.getElementById('hitmarker');
    this.scope = document.getElementById('scope');
    this.crosshair = document.getElementById('crosshair');
    this._scoped = false;

    this.reloadBanner = document.getElementById('reload-banner');
    this.reloadFill = this.reloadBanner?.querySelector('.rl-bar i') ?? null;

    this.killBanner = document.getElementById('kill-banner');
    this.scoreValue = document.getElementById('score-value');
    this.scorePops = document.getElementById('score-pops');
    this.score = 0;

    // Damage numbers are pooled: a firefight can produce a dozen a second, and
    // creating and destroying elements at that rate thrashes the DOM.
    this.damageLayer = document.getElementById('damage-numbers');
    this._damagePool = [];
    this._damageActive = [];
    if (this.damageLayer) {
      for (let i = 0; i < DAMAGE_POOL; i++) {
        const el = document.createElement('div');
        el.className = 'dmg';
        el.style.opacity = '0';
        this.damageLayer.appendChild(el);
        this._damagePool.push(el);
      }
    }
    this.vignette = document.getElementById('damage-vignette');
    this.fpsCounter = document.getElementById('fps-counter');

    this.weaponName = document.getElementById('weapon-name');
    this.weaponSlots = document.getElementById('weapon-slots');
    this.toasts = document.getElementById('toasts');

    this._hitmarkerTimer = null;
    this._vignetteTimer = null;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this.deathScreen = null;
  }

  setWeaponName(name) {
    if (this.weaponName) this.weaponName.textContent = name;
  }

  /**
   * Raises or drops the optic. `blend` is the player's eased aim value; the
   * overlay snaps in partway through so it never sits half-open, and CSS
   * handles the short fade. Guarded on a change so this can be called every
   * frame without touching the DOM.
   */
  setScope(blend) {
    const on = blend > SCOPE_AT;
    if (on === this._scoped) return;
    this._scoped = on;
    this.scope?.classList.toggle('on', on);
    // The hip crosshair would otherwise sit on top of the reticle.
    this.crosshair?.classList.toggle('hidden', on);
  }

  /** Rebuilds the slot strip. Called when weapons are gained or switched. */
  setWeapons(list, activeIndex) {
    if (!this.weaponSlots) return;
    this.weaponSlots.innerHTML = '';
    list.forEach((w, i) => {
      const el = document.createElement('div');
      el.className = `weapon-slot${i === activeIndex ? ' active' : ''}`;
      el.innerHTML = `<span class="slot-key">${i + 1}</span><span class="slot-name">${w.name}</span>`;
      this.weaponSlots.appendChild(el);
    });
    if (list[activeIndex]) this.setWeaponName(list[activeIndex].name);
  }

  /** Transient centre-bottom message for pickups and supply drops. */
  showToast(text, color = 0xc4a6ff) {
    if (!this.toasts) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    el.style.color = `#${color.toString(16).padStart(6, '0')}`;
    this.toasts.appendChild(el);
    setTimeout(() => el.classList.add('out'), 1600);
    setTimeout(() => el.remove(), 2300);
  }

  show() {
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  setHealth(current, max) {
    const pct = Math.max(0, Math.min(1, current / max));
    this.healthFill.style.width = `${pct * 100}%`;
    this.healthFill.classList.toggle('low', pct <= 0.3);
    this.healthValue.textContent = String(Math.ceil(current));
  }

  setAmmo(mag, reserve) {
    this.ammoMag.textContent = String(mag);
    this.ammoMag.classList.toggle('empty', mag === 0);
    this.ammoReserve.textContent = `/ ${reserve}`;
  }

  /** @param duration Reload time in seconds; drives the bar so it lands on zero. */
  setReloading(active, duration = 1.5) {
    this.reloadPrompt.classList.toggle('hidden', !active);
    if (!this.reloadBanner) return;

    this.reloadBanner.classList.toggle('hidden', !active);
    if (active && this.reloadFill) {
      // Restarting a CSS animation needs the property cleared and a reflow
      // forced, or an interrupted reload leaves the bar part-filled.
      this.reloadFill.style.animation = 'none';
      void this.reloadFill.offsetWidth;
      this.reloadFill.style.animation = `rl-fill ${duration}s linear forwards`;
    }
  }

  // ------------------------------------------------------- damage numbers

  /**
   * Pops a floating number at a world position.
   *
   * The caller passes the world point; `updateDamageNumbers` projects it every
   * frame so the number stays pinned to where the hit landed as you turn,
   * rather than sliding around the screen.
   */
  showDamage(worldPoint, amount, { headshot = false, kill = false } = {}) {
    if (!this.damageLayer) return;

    const el = this._damagePool.pop();
    if (!el) return; // pool exhausted; dropping one number is harmless

    el.textContent = kill && headshot ? `${Math.round(amount)}!` : `${Math.round(amount)}`;
    el.className = `dmg${headshot ? ' head' : ''}${kill && !headshot ? ' kill' : ''}`;
    el.style.opacity = '1';

    this._damageActive.push({
      el,
      x: worldPoint.x,
      y: worldPoint.y,
      z: worldPoint.z,
      life: DAMAGE_LIFE,
      // A little lateral drift so overlapping hits on one target fan out
      // instead of stacking into an unreadable pile.
      drift: (Math.random() - 0.5) * 46,
    });
  }

  /** Projects live damage numbers to screen space. Called once per frame. */
  updateDamageNumbers(dt, camera) {
    if (!this._damageActive.length || !camera) return;

    const width = window.innerWidth;
    const height = window.innerHeight;

    for (let i = this._damageActive.length - 1; i >= 0; i--) {
      const n = this._damageActive[i];
      n.life -= dt;

      if (n.life <= 0) {
        n.el.style.opacity = '0';
        this._damagePool.push(n.el);
        this._damageActive.splice(i, 1);
        continue;
      }

      _projected.set(n.x, n.y, n.z).project(camera);

      // z > 1 means the point is behind the camera, where projection mirrors it
      // to a nonsense position on screen.
      if (_projected.z > 1) {
        n.el.style.opacity = '0';
        continue;
      }

      const t = 1 - n.life / DAMAGE_LIFE;
      const sx = (_projected.x * 0.5 + 0.5) * width + n.drift * t;
      const sy = (-_projected.y * 0.5 + 0.5) * height - t * 52;

      n.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) scale(${(1 + (1 - t) * 0.35).toFixed(2)})`;
      // Hold full opacity for the first half, then fade.
      n.el.style.opacity = t < 0.5 ? '1' : (2 - t * 2).toFixed(2);
    }
  }

  // --------------------------------------------------------- kills & score

  /** Centre-screen elimination callout. */
  showKill({ headshot = false, label = 'ELIMINATED' } = {}) {
    if (!this.killBanner) return;
    const el = document.createElement('div');
    el.className = `kill-line${headshot ? ' head' : ''}`;
    el.textContent = headshot ? `${label} · HEADSHOT` : label;
    this.killBanner.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  addScore(points) {
    if (!points) return;
    this.score += points;
    if (this.scoreValue) this.scoreValue.textContent = this.score.toLocaleString();
    if (!this.scorePops) return;

    const pop = document.createElement('div');
    pop.className = 'score-pop';
    pop.textContent = `+${points}`;
    this.scorePops.appendChild(pop);
    setTimeout(() => pop.remove(), 1200);
  }

  showHitmarker(isHeadshot = false) {
    this.hitmarker.classList.remove('show');
    this.hitmarker.classList.toggle('headshot', isHeadshot);
    // Force a reflow so the animation restarts on rapid consecutive hits.
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add('show');

    clearTimeout(this._hitmarkerTimer);
    this._hitmarkerTimer = setTimeout(() => this.hitmarker.classList.remove('show'), 240);
  }

  flashDamage() {
    this.vignette.classList.add('hit');
    clearTimeout(this._vignetteTimer);
    this._vignetteTimer = setTimeout(() => this.vignette.classList.remove('hit'), 90);
  }

  /** Mission objective banner. `isNew` triggers the slide-in animation. */
  setObjective({ title, detail = '', progress = '', isNew = false, done = false }) {
    if (!this.objectiveEl) {
      this.objectiveEl = document.getElementById('objective');
      this.objTitle = document.getElementById('obj-title');
      this.objDetail = document.getElementById('obj-detail');
      this.objProgress = document.getElementById('obj-progress');
    }
    if (!this.objectiveEl) return;

    this.objTitle.textContent = title;
    this.objDetail.textContent = detail;
    this.objProgress.textContent = progress;
    this.objectiveEl.classList.toggle('done', done);

    if (isNew) {
      this.objectiveEl.classList.remove('flash');
      void this.objectiveEl.offsetWidth; // restart the animation
      this.objectiveEl.classList.add('flash');
    }
  }

  /** F3 panel. Cheap to leave in — it only builds a string when visible. */
  setDebug(lines) {
    if (!this._debugEl) {
      const el = document.createElement('pre');
      el.id = 'debug-panel';
      el.style.cssText =
        'position:fixed;top:44px;left:40px;z-index:20;margin:0;font:11px/1.5 ui-monospace,monospace;' +
        'color:#c4a6ff;background:rgba(10,8,20,0.72);padding:10px 14px;pointer-events:none;' +
        'letter-spacing:0.04em;white-space:pre;';
      document.body.appendChild(el);
      this._debugEl = el;
    }
    this._debugEl.style.display = lines ? 'block' : 'none';
    if (lines) this._debugEl.textContent = lines.join('\n');
  }

  get lastFps() {
    return this._lastFps ?? 0;
  }

  updateFps(dt) {
    this._fpsAccum += dt;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      const fps = Math.round(this._fpsFrames / this._fpsAccum);
      this._lastFps = fps;
      this.fpsCounter.textContent = `${fps} fps`;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }
  }

  showDeath() {
    if (this.deathScreen) return;
    const el = document.createElement('div');
    el.id = 'death-screen';
    el.innerHTML = '<div><h2>SIGNAL LOST</h2><p>PRESS <kbd>ENTER</kbd> TO REDEPLOY</p></div>';
    document.body.appendChild(el);
    this.deathScreen = el;
    document.exitPointerLock?.();
  }

  hideDeath() {
    this.deathScreen?.remove();
    this.deathScreen = null;
  }
}
