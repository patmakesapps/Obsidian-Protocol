import * as THREE from 'three';
import { PALETTE } from '../config.js';

/**
 * Mission structure: a linear chain of objectives with a world waypoint and a
 * HUD readout.
 *
 * Three verbs cover most of what a shooter needs, and they compose:
 *   - eliminate: kill N hostiles
 *   - reach:     get to a marked position
 *   - hold:      stay near a position for N seconds while under attack
 *
 * Each objective is data, so re-ordering or adding a mission is an edit to the
 * list below rather than new logic.
 */
export class Objectives {
  constructor({ scene, level, player, hud, audio, game }) {
    this.scene = scene;
    this.level = level;
    this.player = player;
    this.hud = hud;
    this.audio = audio;
    this.game = game;

    this.index = -1;
    this.current = null;
    this.complete = false;
    this.kills = 0;
    this.time = 0;

    this.waypoint = this._buildWaypoint();
    this.scene.add(this.waypoint);
    this.waypoint.visible = false;

    this.list = [
      {
        id: 'sweep',
        type: 'eliminate',
        title: 'CLEAR THE LANDING ZONE',
        detail: 'Eliminate hostile patrols',
        count: 8,
      },
      {
        id: 'advance',
        type: 'reach',
        title: 'ADVANCE TO THE RELAY',
        detail: 'Move to the marked position',
        radius: 6,
        pick: () => this._pointAtRange(110, 150),
      },
      {
        id: 'hold',
        type: 'hold',
        title: 'HOLD THE RELAY',
        detail: 'Defend the position until uplink completes',
        radius: 14,
        duration: 45,
        atCurrentWaypoint: true,
      },
      {
        id: 'purge',
        type: 'eliminate',
        title: 'PURGE REMAINING FORCES',
        detail: 'Eliminate hostile forces',
        count: 14,
      },
    ];
  }

  start() {
    this._advance();
  }

  // ------------------------------------------------------------------ events

  notifyKill() {
    if (!this.current || this.current.type !== 'eliminate') return;
    this.kills++;
    this._refreshHud();
    if (this.kills >= this.current.count) this._completeCurrent();
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    this.time += dt;
    if (!this.current || this.complete) return;

    if (this.current.type === 'reach') {
      const d = this._distanceToWaypoint();
      if (d <= this.current.radius) this._completeCurrent();
      else this._refreshHud();
    } else if (this.current.type === 'hold') {
      const inside = this._distanceToWaypoint() <= this.current.radius;
      // The timer only runs while the player is actually holding the ground.
      if (inside) this.held = Math.min(this.current.duration, this.held + dt);
      this._refreshHud();
      if (this.held >= this.current.duration) this._completeCurrent();
    }

    this._animateWaypoint(dt);
  }

  _distanceToWaypoint() {
    if (!this.waypoint.visible) return Infinity;
    const a = this.player.position;
    const b = this.waypoint.position;
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  // ------------------------------------------------------------------- flow

  _advance() {
    this.index++;
    if (this.index >= this.list.length) {
      this.current = null;
      this.complete = true;
      this.waypoint.visible = false;
      this.hud?.setObjective({
        title: 'ALL OBJECTIVES COMPLETE',
        detail: 'Sector secured',
        progress: '',
        done: true,
      });
      return;
    }

    this.current = this.list[this.index];
    this.kills = 0;
    this.held = 0;

    if (this.current.type === 'reach') {
      const at = this.current.pick();
      this.waypoint.position.set(at.x, 0, at.z);
      this.waypoint.visible = true;
    } else if (this.current.type === 'hold') {
      // Reuses whatever the previous objective marked, so "get there" flows
      // naturally into "hold there".
      if (!this.current.atCurrentWaypoint) {
        const at = this._pointAtRange(60, 110);
        this.waypoint.position.set(at.x, 0, at.z);
      }
      this.waypoint.visible = true;
    } else {
      this.waypoint.visible = false;
    }

    this.audio?.objective?.();
    this._refreshHud(true);
  }

  _completeCurrent() {
    this.audio?.objectiveComplete?.();
    this.hud?.showToast(`OBJECTIVE COMPLETE — ${this.current.title}`, 0x6effc4);
    this.game?.onObjectiveComplete?.(this.current);
    this._advance();
  }

  _refreshHud(isNew = false) {
    if (!this.current) return;
    let progress = '';

    if (this.current.type === 'eliminate') {
      progress = `${this.kills} / ${this.current.count}`;
    } else if (this.current.type === 'reach') {
      const d = this._distanceToWaypoint();
      progress = Number.isFinite(d) ? `${Math.round(d)} m` : '';
    } else if (this.current.type === 'hold') {
      const remaining = Math.max(0, this.current.duration - this.held);
      const inside = this._distanceToWaypoint() <= this.current.radius;
      progress = inside ? `${remaining.toFixed(0)}s` : 'RETURN TO ZONE';
    }

    this.hud?.setObjective({
      title: this.current.title,
      detail: this.current.detail,
      progress,
      isNew,
    });
  }

  /** A navigable street position at a given distance band from the player. */
  _pointAtRange(min, max) {
    for (let attempt = 0; attempt < 120; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = min + Math.random() * (max - min);
      const x = this.player.position.x + Math.cos(angle) * radius;
      const z = this.player.position.z + Math.sin(angle) * radius;
      if (this.level.isOpenGround(x, z)) return { x, z };
    }
    const fallback = this.level.randomSpawnPoint();
    return { x: fallback?.x ?? 0, z: fallback?.z ?? 0 };
  }

  // ---------------------------------------------------------------- visuals

  _buildWaypoint() {
    const group = new THREE.Group();
    const colour = PALETTE.purpleBright;

    // Tall beam, visible over buildings from across the map.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 1.1, 90, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    beam.position.y = 45;
    group.add(beam);

    // Ground ring, solid so it reads against the white plaza.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.4, 3.2, 40),
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    group.add(ring);

    const pulse = new THREE.Mesh(
      new THREE.RingGeometry(3.4, 3.7, 40),
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    pulse.rotation.x = -Math.PI / 2;
    pulse.position.y = 0.05;
    group.add(pulse);
    group.userData.pulse = pulse;

    return group;
  }

  _animateWaypoint(dt) {
    if (!this.waypoint.visible) return;
    const pulse = this.waypoint.userData.pulse;
    const t = (this.time * 0.6) % 1;
    pulse.scale.setScalar(1 + t * 1.8);
    pulse.material.opacity = 0.6 * (1 - t);
  }
}
