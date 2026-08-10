/**
 * DOM-based HUD. Kept out of the WebGL scene so text stays crisp at any
 * resolution and so restyling is a CSS change, not a shader change.
 */
export class HUD {
  constructor() {
    this.root = document.getElementById('hud');
    this.healthFill = document.getElementById('health-fill');
    this.healthValue = document.getElementById('health-value');
    this.ammoMag = document.getElementById('ammo-mag');
    this.ammoReserve = document.getElementById('ammo-reserve');
    this.reloadPrompt = document.getElementById('reload-prompt');
    this.hitmarker = document.getElementById('hitmarker');
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

  setReloading(active) {
    this.reloadPrompt.classList.toggle('hidden', !active);
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
