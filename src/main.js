import { Game } from './core/Game.js';
import { levelList, resolveLevel } from './world/levels.js';
import { isUnlocked, isComplete } from './game/progress.js';

const canvas = document.getElementById('viewport');
const overlay = document.getElementById('overlay');
const status = document.getElementById('overlay-status');
const startButton = document.getElementById('start-button');

/** Navigates to a level. A reload is the level-change mechanism — see below. */
function goToLevel(id) {
  const url = new URL(window.location.href);
  url.searchParams.set('level', id);
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

async function boot() {
  const active = resolveLevel();

  // Shown before loading starts, so the picker is usable while the world builds
  // and a mis-click doesn't mean waiting out a load first.
  buildLevelSelect(active.id);

  const game = new Game(canvas);
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

  status.textContent = 'ALL SYSTEMS NOMINAL';
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
