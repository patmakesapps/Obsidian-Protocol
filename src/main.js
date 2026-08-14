import { Game } from './core/Game.js';
import { levelList, resolveLevel } from './world/levels.js';
import { isUnlocked, isComplete } from './game/progress.js';
import { NetClient } from './net/NetClient.js';

const canvas = document.getElementById('viewport');
const overlay = document.getElementById('overlay');
const status = document.getElementById('overlay-status');
const startButton = document.getElementById('start-button');

/** Navigates to a level. A reload is the level-change mechanism — see below. */
function goToLevel(id) {
  const url = new URL(window.location.href);
  url.searchParams.set('level', id);
  // Switching level is leaving the match — the match's level is fixed.
  url.searchParams.delete('mp');
  url.searchParams.delete('room');
  window.location.assign(url);
}

/**
 * Builds the deployment-zone picker from the level registry.
 *
 * Switching reloads with `?level=`. Rebuilding the world in place would mean a
 * teardown path for physics bodies, scene graph, actors and pooled projectiles
 * that nothing else needs — a reload is one line and can't leak.
 *
 * Locked levels are rendered but not clickable, so the campaign shows what's
 * ahead rather than hiding it.
 */
function buildLevelSelect(currentId) {
  const select = document.getElementById('level-select');
  const options = document.getElementById('level-options');
  if (!select || !options) return;

  options.innerHTML = '';

  for (const level of levelList()) {
    const unlocked = isUnlocked(level);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `level-option${unlocked ? '' : ' locked'}`;
    button.textContent = unlocked ? level.name : `${level.name} · LOCKED`;

    const isCurrent = level.id === currentId;
    button.setAttribute('aria-current', String(isCurrent));

    if (!unlocked) {
      button.disabled = true;
      button.title = 'Complete the previous deployment to unlock';
    } else if (isComplete(level.id)) {
      button.classList.add('cleared');
    }

    if (unlocked && !isCurrent) {
      button.addEventListener('click', () => goToLevel(level.id));
    }
    options.appendChild(button);
  }
  select.classList.remove('hidden');
}

// ----------------------------------------------------------- multiplayer

/** ?mp=1&room=CODE&name=CALLSIGN — set by the lobby, consumed on the next load. */
function mpParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    active: p.get('mp') === '1' && !!p.get('room'),
    room: (p.get('room') ?? '').toUpperCase(),
    // No name in the URL (an invite link someone clicked) — use their own
    // saved callsign, so a shared link doesn't hand out the sender's name.
    name: p.get('name') ?? localStorage.getItem('op-callsign') ?? '',
  };
}

/** The relay's HTTP side (leaderboard), derived from its websocket URL. */
function serverHttpUrl() {
  return NetClient.defaultUrl().replace(/^ws/, 'http');
}

function setMpStatus(text, kind = '') {
  const el = document.getElementById('mp-status');
  if (!el) return;
  el.textContent = text;
  el.className = kind;
}

/**
 * Navigates into a match. A reload is already the level-change mechanism, so
 * it's the match-join mechanism too — the room code survives in the URL and
 * the socket reconnects on the other side.
 */
function goToMatch(levelId, code, name) {
  const url = new URL(window.location.href);
  url.searchParams.set('level', levelId);
  url.searchParams.set('mp', '1');
  url.searchParams.set('room', code);
  url.searchParams.set('name', name);
  window.location.assign(url);
}

/** The player's saved multiplayer character, defaulting to the white trooper. */
function savedCharacter() {
  const char = localStorage.getItem('op-character');
  return ['ivory', 'obsidian', 'drone'].includes(char) ? char : 'ivory';
}

/** CAMPAIGN / MULTIPLAYER tabs; one panel visible at a time. */
function setupMenuTabs(startInMp) {
  const tabs = [...document.querySelectorAll('.menu-tab')];
  const select = (panelId) => {
    for (const tab of tabs) {
      const on = tab.dataset.panel === panelId;
      tab.classList.toggle('active', on);
      document.getElementById(tab.dataset.panel)?.classList.toggle('hidden', !on);
    }
    // The multiplayer panel is tall; the fixed footer strip would overlap it
    // on smaller windows, and its keybind hints are campaign trivia anyway.
    document.getElementById('overlay-foot')?.classList.toggle('hidden', panelId === 'panel-mp');
  };
  for (const tab of tabs) tab.addEventListener('click', () => select(tab.dataset.panel));
  if (startInMp) select('panel-mp');
}

/** Lobby controls on the start screen: create, join, leaderboard. */
function setupMultiplayerMenu() {
  const nameInput = document.getElementById('mp-name');
  const codeInput = document.getElementById('mp-code');
  const createBtn = document.getElementById('mp-create');
  const joinBtn = document.getElementById('mp-join');
  const boardToggle = document.getElementById('mp-board-toggle');
  const boardPanel = document.getElementById('mp-leaderboard');
  const boardRows = document.getElementById('mp-board-rows');
  if (!nameInput || !createBtn) return;

  nameInput.value = localStorage.getItem('op-callsign') ?? '';

  // Character picker — cosmetic, remembered per browser.
  const charButtons = [...document.querySelectorAll('#char-options .pick-option')];
  const pickChar = (char) => {
    localStorage.setItem('op-character', char);
    for (const b of charButtons) b.classList.toggle('active', b.dataset.char === char);
  };
  for (const b of charButtons) b.addEventListener('click', () => pickChar(b.dataset.char));
  pickChar(savedCharacter());

  // Arena picker — multiplayer can use any level, locks don't apply. Defaults
  // to The Pit, the purpose-built arena.
  let mpLevel = localStorage.getItem('op-mp-level') ?? 'pit';
  const levelHolder = document.getElementById('mp-level-options');
  if (levelHolder) {
    for (const level of levelList()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick-option';
      b.textContent = level.name;
      b.dataset.level = level.id;
      b.addEventListener('click', () => {
        mpLevel = level.id;
        localStorage.setItem('op-mp-level', mpLevel);
        for (const o of levelHolder.children) o.classList.toggle('active', o === b);
      });
      levelHolder.appendChild(b);
    }
    for (const o of levelHolder.children) o.classList.toggle('active', o.dataset.level === mpLevel);
  }

  // Hostiles picker — whether AI joins the deathmatch.
  let bots = localStorage.getItem('op-mp-bots') === '1';
  const botButtons = [...document.querySelectorAll('#bots-options .pick-option')];
  const pickBots = (on) => {
    bots = on;
    localStorage.setItem('op-mp-bots', on ? '1' : '0');
    for (const b of botButtons) b.classList.toggle('active', (b.dataset.bots === '1') === on);
  };
  for (const b of botButtons) b.addEventListener('click', () => pickBots(b.dataset.bots === '1'));
  pickBots(bots);

  const callsign = () => {
    const name = nameInput.value.trim().toUpperCase() || 'OPERATIVE';
    localStorage.setItem('op-callsign', name);
    return name;
  };

  const busy = (on) => {
    createBtn.disabled = on;
    joinBtn.disabled = on;
  };

  createBtn.addEventListener('click', async () => {
    busy(true);
    setMpStatus('CONTACTING SERVER…');
    try {
      const client = new NetClient(NetClient.defaultUrl());
      await client.connect();
      const reply = await client.request({ t: 'create', level: mpLevel, bots }, ['created', 'error']);
      client.close();
      if (reply.t === 'error') throw new Error(reply.message);
      goToMatch(mpLevel, reply.code, callsign());
    } catch (err) {
      setMpStatus(err.message ?? 'SERVER UNREACHABLE', 'error');
      busy(false);
    }
  });

  joinBtn.addEventListener('click', async () => {
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 4) return setMpStatus('ENTER THE 4-LETTER MATCH CODE', 'error');
    busy(true);
    setMpStatus('LOCATING MATCH…');
    try {
      const client = new NetClient(NetClient.defaultUrl());
      await client.connect();
      // Peek first so we load the match's level BEFORE joining — joining on
      // the wrong level would put players in different worlds.
      const reply = await client.request({ t: 'peek', code }, ['peeked', 'error']);
      client.close();
      if (reply.t === 'error') throw new Error(reply.message);
      if (reply.players >= reply.max) throw new Error('MATCH FULL');
      goToMatch(reply.level, code, callsign());
    } catch (err) {
      setMpStatus(err.message ?? 'SERVER UNREACHABLE', 'error');
      busy(false);
    }
  });

  boardToggle?.addEventListener('click', async () => {
    boardPanel.classList.toggle('hidden');
    if (boardPanel.classList.contains('hidden')) return;
    boardRows.textContent = 'FETCHING…';
    try {
      const res = await fetch(`${serverHttpUrl()}/api/leaderboard`);
      const { rows } = await res.json();
      if (!rows.length) {
        boardRows.textContent = 'NO MATCHES RECORDED YET';
        return;
      }
      boardRows.innerHTML =
        `<div class="board-row head"><span class="b-rank">#</span><span class="b-name">OPERATIVE</span>` +
        `<span class="b-stat">WINS</span><span class="b-stat">ELIMS</span><span class="b-stat">DOWNS</span></div>` +
        rows
          .map(
            (r, i) =>
              `<div class="board-row"><span class="b-rank">${i + 1}</span><span class="b-name">${r.name}</span>` +
              `<span class="b-stat">${r.wins}</span><span class="b-stat">${r.kills}</span><span class="b-stat">${r.deaths}</span></div>`,
          )
          .join('');
    } catch {
      boardRows.textContent = 'LEADERBOARD UNAVAILABLE — IS THE SERVER RUNNING?';
    }
  });
}

/** Connects and joins the room named in the URL. Returns Game's netSession. */
async function joinFromUrl(mp, activeLevelId) {
  const client = new NetClient(NetClient.defaultUrl());
  await client.connect();
  const session = await client.request(
    { t: 'join', code: mp.room, name: mp.name || 'OPERATIVE', char: savedCharacter() },
    ['joined', 'error'],
  );
  if (session.t === 'error') {
    client.close();
    throw new Error(session.message);
  }
  // The room's level always wins. Normally the lobby already put it in the
  // URL; a hand-typed link gets bounced through one corrective reload.
  if (session.level !== activeLevelId) {
    goToMatch(session.level, mp.room, mp.name);
    throw new Error('SWITCHING LEVEL');
  }
  return { client, session };
}

async function boot() {
  const active = resolveLevel();
  const mp = mpParams();

  // Shown before loading starts, so the picker is usable while the world builds
  // and a mis-click doesn't mean waiting out a load first.
  buildLevelSelect(active.id);
  setupMenuTabs(mp.active);
  setupMultiplayerMenu();

  let netSession = null;
  if (mp.active) {
    status.textContent = 'JOINING MATCH…';
    try {
      netSession = await joinFromUrl(mp, active.id);
    } catch (err) {
      if (err.message === 'SWITCHING LEVEL') return; // corrective reload underway
      console.error(err);
      setMpStatus(err.message ?? 'JOIN FAILED', 'error');
      status.textContent = 'MATCH UNAVAILABLE — SOLO LOAD';
    }
  }

  const game = new Game(canvas, { netSession });
  window.game = game; // handy for tweaking values from the console

  try {
    await game.load((message) => {
      status.textContent = message;
    });
  } catch (err) {
    console.error(err);
    status.textContent = 'FAILED TO LOAD — SEE CONSOLE';
    return;
  }

  if (netSession) {
    // Drop the name param so the address bar becomes a clean invite link:
    // anyone who clicks it joins this match under their own callsign.
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('name');
    window.history.replaceState(null, '', cleanUrl);

    const others = netSession.session.players.length;
    status.textContent = `MATCH ${netSession.session.code} · ${others + 1} OPERATIVE${others ? 'S' : ''} IN`;
    setMpStatus(`IN MATCH ${netSession.session.code} — SEND THIS PAGE'S URL TO INVITE`, 'good');
  } else {
    status.textContent = 'ALL SYSTEMS NOMINAL';
  }
  startButton.disabled = false;

  const tag = document.getElementById('overlay-tag');
  const btnLabel = startButton.querySelector('.btn-label');

  // What the primary button does right now. Mission complete repoints it at
  // the next level; everything else resumes or starts.
  let primaryAction = null;

  // Only the tag, status and button label change — the title markup holds the
  // gradient spans, so it must not be overwritten with textContent.
  const showOverlay = (headline, sub, buttonLabel, action = null) => {
    tag.textContent = headline;
    status.textContent = sub;
    btnLabel.textContent = buttonLabel;
    primaryAction = action;
    overlay.classList.remove('hidden', 'fading');
  };

  const hideOverlay = () => {
    overlay.classList.add('fading');
    setTimeout(() => overlay.classList.add('hidden'), 360);
  };

  startButton.addEventListener('click', () => {
    if (primaryAction) {
      primaryAction();
      return;
    }
    hideOverlay();
    if (game.started) game.resume();
    else game.start();
  });

  // Losing pointer lock (Esc) pauses into this menu. Nothing re-captures the
  // cursor on its own — the player has to click Resume.
  game.onPause = () => {
    showOverlay('PAUSED', 'CURSOR RELEASED', 'RESUME');
  };

  game.onMissionCompleteUI = ({ level, next, unlocked, score }) => {
    // Rebuilt so a newly unlocked level stops showing as locked.
    buildLevelSelect(level.id);

    const scoreLine = `${level.name} CLEARED · SCORE ${score.toLocaleString()}`;

    if (unlocked) {
      showOverlay(
        `NEW ZONE UNLOCKED — ${unlocked.name}`,
        scoreLine,
        `DEPLOY TO ${unlocked.name}`,
        () => goToLevel(unlocked.id),
      );
    } else if (next) {
      // Already unlocked from a previous run — still offer the trip.
      showOverlay('MISSION COMPLETE', scoreLine, `DEPLOY TO ${next.name}`, () =>
        goToLevel(next.id),
      );
    } else {
      showOverlay('CAMPAIGN COMPLETE', scoreLine, 'KEEP FIGHTING');
    }
  };
}

boot();
