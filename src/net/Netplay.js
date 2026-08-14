import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { RemotePlayers } from './RemotePlayers.js';

// Movement state goes out at this rate. 15Hz + client-side interpolation reads
// smoother than 60Hz raw would, and is a tenth of the bandwidth.
const SEND_HZ = 15;
const RESPAWN_DELAY = 3.0;

/**
 * Multiplayer match logic on the client: free-for-all deathmatch.
 *
 * Wires the relay socket into the running game — remote avatars, PvP damage,
 * deaths and auto-respawn, the scoreboard, the kill feed and match flow. The
 * division of authority is: each client owns its own player (movement and
 * health), the shooter owns its hitscan, and the server owns the social truth
 * (who's in the match, scores, when it ends).
 */
export class Netplay {
  constructor({ game, client, session }) {
    this.game = game;
    this.client = client;
    this.myId = session.id;
    this.myName = session.name;
    this.myColor = session.color;
    this.roomCode = session.code;
    this.killLimit = session.limit ?? 20;
    this.matchState = session.state ?? 'live';

    this.rows = session.rows ?? [];
    this._sendAccum = 0;
    this._lastAttacker = null;
    this._lastAttackHeadshot = false;
    this._respawnAt = null;
    this._scoreboardVisible = false;

    this.remotes = new RemotePlayers({
      scene: game.scene,
      physics: game.physics,
      assets: game.assets,
      audio: game.audio,
      projectiles: game.projectiles,
    });
    // Local hitscan connected with a remote avatar → tell their client.
    this.remotes.onLocalHit = (player, damage, headshot) => {
      this.client.send({ t: 'hit', target: player.id, damage, headshot });
    };

    for (const p of session.players ?? []) this.remotes.ensure(p);

    // The local weapon reports every shot through this hook.
    game.player.net = this;

    this._wireHandlers();
    this._refreshObjective();
    this.game.hud.setScores?.(this.rows, this.myId, this.killLimit);
    // Announce our spawn right away so nobody renders us at the world origin.
    this._sendState();
  }

  _wireHandlers() {
    const c = this.client;
    const hud = this.game.hud;

    c.on('playerJoined', (msg) => {
      this.remotes.ensure(msg);
      hud.showToast(`${msg.name} JOINED`, msg.color);
    });

    c.on('playerLeft', (msg) => {
      this.remotes.remove(msg.id);
      hud.showToast(`${msg.name} LEFT`, 0xff7a6e);
    });

    c.on('state', (msg) => {
      // A packet can outrun the join notice after a reconnect — treat an
      // unknown id as an implicit join with a neutral colour.
      if (!this.remotes.players.has(msg.id)) {
        this.remotes.ensure({ id: msg.id, name: `OPERATIVE-${msg.id}`, color: 0xc4a6ff });
      }
      this.remotes.state(msg, performance.now() / 1000);
    });

    c.on('fire', (msg) => this.remotes.fire(msg));

    c.on('hit', (msg) => this._onIncomingHit(msg));

    c.on('kill', (msg) => this._onKill(msg));

    c.on('scores', (msg) => {
      this.rows = msg.rows;
      this.killLimit = msg.limit ?? this.killLimit;
      hud.setScores?.(this.rows, this.myId, this.killLimit);
      this._refreshObjective();
    });

    c.on('matchEnd', (msg) => {
      this.matchState = 'intermission';
      this.rows = msg.rows;
      hud.setScores?.(this.rows, this.myId, this.killLimit);
      const won = msg.winner === this.myId;
      this.game.audio?.victory?.();
      hud.showMatchEnd?.({
        winnerName: msg.winnerName,
        winnerColor: msg.winnerColor,
        won,
        rows: msg.rows,
        restartIn: msg.restartIn ?? 12,
        myId: this.myId,
      });
    });

    c.on('matchStart', (msg) => {
      this.matchState = 'live';
      this.rows = msg.rows;
      hud.hideMatchEnd?.();
      hud.setScores?.(this.rows, this.myId, this.killLimit);
      hud.showToast('NEW MATCH — GO', 0x6effc4);
      this._refreshObjective();
      // Fresh footing for the new round.
      if (this.game.player.alive) this._respawnLocal();
    });

    c.onClose = () => {
      hud.showToast('CONNECTION LOST', 0xff4b6b);
    };
  }

  // ------------------------------------------------------------ local hooks

  /** Called by the local Weapon for every hitscan shot. */
  onLocalFire(muzzleWorld, end, weaponId) {
    this.client.send({
      t: 'fire',
      from: [+muzzleWorld.x.toFixed(2), +muzzleWorld.y.toFixed(2), +muzzleWorld.z.toFixed(2)],
      to: [+end.x.toFixed(2), +end.y.toFixed(2), +end.z.toFixed(2)],
      w: weaponId,
    });
  }

  _onIncomingHit(msg) {
    const player = this.game.player;
    if (!player.alive) return;

    this._lastAttacker = msg.from;
    this._lastAttackHeadshot = !!msg.headshot;
    player.takeDamage(msg.damage);
    this.game.cameraRig?.addShake(CONFIG.camera.shakeOnHit);

    if (!player.alive) {
      // Our death is ours to announce; the server turns it into a kill.
      this.client.send({ t: 'death', killer: this._lastAttacker, headshot: this._lastAttackHeadshot });
      this._respawnAt = player.time + RESPAWN_DELAY;
    }
  }

  _onKill(msg) {
    const hud = this.game.hud;
    hud.showKillFeed?.(msg);

    if (msg.killer === this.myId) {
      const points = msg.headshot ? 150 : 100;
      hud.addScore(points);
      hud.showKill({ headshot: msg.headshot, label: `ELIMINATED ${msg.victimName}` });
      this.game.cameraRig?.addShake(CONFIG.camera.shakeOnKill);
    }
  }

  _respawnLocal() {
    const player = this.game.player;
    const level = this.game.level;
    const at = level.randomSpawnPoint?.(Math.random)?.clone() ?? new THREE.Vector3(0, 0.5, 6);
    at.y = (level.heightAt?.(at.x, at.z) ?? 0) + 0.5;
    player.respawn(at);
    this.client.send({ t: 'respawn' });
    this._sendState(); // don't let others see a corpse at the old spot for a tick
  }

  // ---------------------------------------------------------------- update

  update(dt) {
    const now = performance.now() / 1000;
    this.remotes.update(dt, now);

    this._sendAccum += dt;
    if (this._sendAccum >= 1 / SEND_HZ) {
      this._sendAccum %= 1 / SEND_HZ;
      this._sendState();
    }

    // Auto-redeploy, Call of Duty style — no button needed.
    if (this._respawnAt !== null && this.game.player.time >= this._respawnAt) {
      this._respawnAt = null;
      this._respawnLocal();
    }

    // Hold Tab for the scoreboard.
    const wantBoard = this.game.input.isDown('Tab');
    if (wantBoard !== this._scoreboardVisible) {
      this._scoreboardVisible = wantBoard;
      this.game.hud.setScoreboardVisible?.(wantBoard, this.rows, this.myId, this.killLimit);
    }
  }

  _sendState() {
    const p = this.game.player;
    this.client.send({
      t: 'state',
      p: [+p.position.x.toFixed(2), +p.position.y.toFixed(2), +p.position.z.toFixed(2)],
      yaw: +p.yaw.toFixed(3),
      alive: p.alive,
    });
  }

  _refreshObjective() {
    const mine = this.rows.find((r) => r.id === this.myId);
    const leader = this.rows[0];
    this.game.hud.setObjective({
      title: `FREE-FOR-ALL · ${this.roomCode}`,
      detail: `FIRST TO ${this.killLimit} ELIMINATIONS`,
      progress: leader
        ? `LEADER ${leader.name} ${leader.kills} · YOU ${mine?.kills ?? 0}`
        : '',
    });
  }

  dispose() {
    this.remotes.dispose();
    this.client.close();
  }
}
