import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { RemotePlayers, normalizeChar, CHARACTERS } from './RemotePlayers.js';
import { Puppets } from './Puppets.js';

// Movement state goes out at this rate. 15Hz + client-side interpolation reads
// smoother than 60Hz raw would, and is a tenth of the bandwidth.
const SEND_HZ = 15;
// AI snapshots are chunkier (whole bot list) and AI movement is slower, so a
// lower rate reads fine.
const BOTS_HZ = 10;
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
    // What the server accepted at join — the single source of truth for what
    // everyone else renders us as. Storage is a last resort and may be blocked.
    let stored = null;
    try {
      stored = localStorage.getItem('op-character');
    } catch {
      /* blocked storage */
    }
    this.myChar = normalizeChar(session.char ?? stored);
    this._sendAccum = 0;
    this._lastAttacker = null;
    this._lastAttackerAt = -99;
    this._lastAttackHeadshot = false;
    this._lastHitWasAI = false;
    this._respawnAt = null;
    this._deathHandled = false;
    this._scoreboardVisible = false;

    // Hostiles: `bots` is the room setting; `simHost` means THIS client runs
    // the real AI and streams it. Everyone else renders puppets.
    this.bots = !!session.bots;
    this.simHost = !!session.simHost;
    this._botsAccum = 0;
    this._nextBotId = 1;

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
    // Sim host only: the AI hurt another player's avatar in our simulation.
    this.remotes.onAIHit = (player, damage) => {
      this.client.send({ t: 'aihit', target: player.id, damage });
    };

    if (this.bots && !this.simHost) {
      this.puppets = new Puppets({ scene: game.scene, physics: game.physics, assets: game.assets });
      this.puppets.onLocalHit = (bot, damage, headshot) => {
        this.client.send({ t: 'botHit', bot: bot.id, damage, headshot });
      };
    }

    for (const p of session.players ?? []) this.remotes.ensure(p);

    // The local weapon reports every shot through this hook.
    game.player.net = this;

    this._wireHandlers();
    this._refreshObjective();
    this.game.hud.setScores?.(this.rows, this.myId, this.killLimit);
    // Announce our spawn right away so nobody renders us at the world origin.
    this._sendState();

    // You can't see your own body in first person — confirm the pick loudly
    // so "did my character apply" is never a mystery again.
    const charLabel = CHARACTERS[this.myChar]?.label ?? this.myChar.toUpperCase();
    this.game.hud.showToast(`DEPLOYED AS ${charLabel}`, this.myColor);
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
        this.remotes.ensure({ id: msg.id, name: `OPERATIVE-${msg.id}`, color: 0xc4a6ff, char: msg.c });
      }
      this.remotes.state(msg, performance.now() / 1000);
    });

    c.on('fire', (msg) => this.remotes.fire(msg));

    c.on('hit', (msg) => this._onIncomingHit(msg));

    // ---- hostiles

    c.on('bots', (msg) => this.puppets?.apply(msg.list, performance.now() / 1000));

    // AI bolt replica: visual only (damage 0) — real damage arrives as 'aihit'.
    c.on('botFire', (msg) => {
      const origin = new THREE.Vector3().fromArray(msg.from);
      this.game.projectiles.spawn({
        origin,
        direction: new THREE.Vector3().fromArray(msg.dir),
        speed: msg.s,
        damage: 0,
        faction: 'enemy',
        owner: null,
        color: 0xff8a5c,
      });
      this.game.projectiles.flash(origin, 0xffb07a, 30);
      this.game.audio?.enemyShoot?.('enemy');
    });

    // Sim host: another player shot one of our real hostiles.
    c.on('botHit', (msg) => {
      const enemy = this.game.enemies.find((e) => e._netId === msg.bot && !e.isDead);
      if (!enemy) return;
      enemy.lastHitWasHeadshot = !!msg.headshot;
      enemy.killedByPlayer = false; // last hitter wins the credit
      enemy._lastShotBy = msg.from;
      enemy.lastHitFaction = 'player';
      enemy.takeDamage(msg.damage);
    });

    // The sim host's AI got us.
    c.on('aihit', (msg) => this._onIncomingHit({ from: null, damage: msg.damage, ai: true }));

    // The previous sim host left — we inherit the AI.
    c.on('simHost', () => this._becomeSimHost());

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
    this._lastAttackerAt = player.time;
    this._lastAttackHeadshot = !!msg.headshot;
    this._lastHitWasAI = !!msg.ai;
    player.takeDamage(msg.damage);
    this.game.cameraRig?.addShake(CONFIG.camera.shakeOnHit);
    // Death is noticed centrally in update() — a kill can also come from the
    // local simulation (AI bolts and melee on the sim host), which never
    // passes through this handler.
  }

  /** Any local death — network hit, local AI bolt, anything — starts the redeploy. */
  _watchForDeath() {
    const player = this.game.player;
    if (player.alive) {
      this._deathHandled = false;
      return;
    }
    if (this._deathHandled) return;
    this._deathHandled = true;

    // Attribute to the last attacker only if the hit was recent; otherwise it
    // was the local simulation (AI), or a mystery we call misadventure.
    const recent = player.time - this._lastAttackerAt < 5;
    const killer = recent ? this._lastAttacker : null;
    const byAI = recent ? this._lastHitWasAI : this.bots;
    this.client.send({
      t: 'death',
      killer,
      headshot: recent && this._lastAttackHeadshot,
      ai: byAI,
    });
    this._respawnAt = player.time + RESPAWN_DELAY;
  }

  /** Promoted to sim host mid-match: spawn a fresh set of real hostiles. */
  _becomeSimHost() {
    if (this.simHost) return;
    this.simHost = true;
    // Puppets stop receiving snapshots and stale out on their own while the
    // real actors spawn in.
    this.game.hud.showToast('HOSTILE CONTROL TRANSFERRED TO YOU', 0xff9a3c);
    this.game._spawnSquads(CONFIG.enemy.mpCount ?? 8);
  }

  /** Sim host: stream the AI's state to everyone else. */
  _sendBots() {
    const list = [];
    for (const e of this.game.enemies) {
      if (e.removed) continue;
      if (!e._netId) {
        e._netId = this._nextBotId++;
        // Replicate this actor's bolts so everyone sees and hears its fire.
        e.onFireShot = (origin, dir, speed) => {
          this.client.send({
            t: 'botFire',
            from: [+origin.x.toFixed(2), +origin.y.toFixed(2), +origin.z.toFixed(2)],
            dir: [+dir.x.toFixed(3), +dir.y.toFixed(3), +dir.z.toFixed(3)],
            s: speed,
          });
        };
      }

      // Death transition → credit whoever landed the last hit.
      if (e.isDead && !e._deathReported) {
        e._deathReported = true;
        const by = e.killedByPlayer ? this.myId : e._lastShotBy ?? null;
        if (by !== null) {
          this.client.send({ t: 'botKill', by, headshot: !!e.lastHitWasHeadshot });
        }
      }

      list.push([
        e._netId,
        +e.position.x.toFixed(2),
        +e.position.y.toFixed(2),
        +e.position.z.toFixed(2),
        +e.facing.toFixed(3),
        Math.round(e.health),
        e.isDead ? 1 : 0,
      ]);
    }
    this.client.send({ t: 'bots', list });
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
    player.invulnUntil = player.time + 2.5; // spawn protection
    this.client.send({ t: 'respawn' });
    this._sendState(); // don't let others see a corpse at the old spot for a tick
  }

  // ---------------------------------------------------------------- update

  update(dt) {
    const now = performance.now() / 1000;
    this.remotes.update(dt, now);
    this.puppets?.update(dt, now);
    this._watchForDeath();

    this._sendAccum += dt;
    if (this._sendAccum >= 1 / SEND_HZ) {
      this._sendAccum %= 1 / SEND_HZ;
      this._sendState();
    }

    if (this.bots && this.simHost) {
      // The AI needs the other players on its target list, and only the sim
      // host's world has authoritative AI.
      this.game.world.remotes = [...this.remotes.players.values()].filter(
        (p) => p && p.alive && p.body,
      );
      this._botsAccum += dt;
      if (this._botsAccum >= 1 / BOTS_HZ) {
        this._botsAccum %= 1 / BOTS_HZ;
        this._sendBots();
      }
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
      // Character rides in every packet so late joiners, dropped join notices
      // and mid-match re-picks all converge on the right model.
      c: this.myChar,
    });
  }

  _refreshObjective() {
    const mine = this.rows.find((r) => r.id === this.myId);
    const leader = this.rows[0];
    const charLabel = CHARACTERS[this.myChar]?.label ?? '';
    this.game.hud.setObjective({
      title: `FREE-FOR-ALL · ${this.roomCode}`,
      detail: `FIRST TO ${this.killLimit} · YOU ARE ${charLabel}`,
      progress: leader
        ? `LEADER ${leader.name} ${leader.kills} · YOU ${mine?.kills ?? 0}`
        : '',
    });
  }

  dispose() {
    this.remotes.dispose();
    this.puppets?.dispose();
    this.client.close();
  }
}
