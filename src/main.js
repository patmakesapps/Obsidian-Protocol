import { Game } from './core/Game.js';
import { LEVELS, resolveLevel } from './world/levels.js';

const canvas = document.getElementById('viewport');
const overlay = document.getElementById('overlay');
const status = document.getElementById('overlay-status');
const startButton = document.getElementById('start-button');

/**
 * Builds the deployment-zone picker from the level registry.
 *
 * Switching reloads with `?level=`. Rebuilding the world in place would mean a
 * teardown path for physics bodies, scene graph, actors and pooled projectiles
 * that nothing else needs — a reload is one line and can't leak.
 */
function buildLevelSelect(currentId) {
  const select = document.getElementById('level-select');
  const options = document.getElementById('level-options');
  if (!select || !options) return;

  for (const level of Object.values(LEVELS)) {
    const button = document.createElement('button');
    button.className = 'level-option';
    button.type = 'button';
    button.textContent = level.name;
    const isCurrent = level.id === currentId;
    button.setAttribute('aria-current', String(isCurrent));

    if (!isCurrent) {
      button.addEventListener('click', () => {
        const url = new URL(window.location.href);
        url.searchParams.set('level', level.id);
        window.location.assign(url);
      });
    }
    options.appendChild(button);
  }
  select.classList.remove('hidden');
}

async function boot() {
  // Shown before loading starts, so the picker is usable while the world builds
  // and a mis-click doesn't mean waiting out a load first.
  buildLevelSelect(resolveLevel().id);

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

  // Only the tag, status and button label change — the title markup holds the
  // gradient spans, so it must not be overwritten with textContent.
  const showOverlay = (headline, sub, buttonLabel) => {
    tag.textContent = headline;
    status.textContent = sub;
    btnLabel.textContent = buttonLabel;
    overlay.classList.remove('hidden', 'fading');
  };

  const hideOverlay = () => {
    overlay.classList.add('fading');
    setTimeout(() => overlay.classList.add('hidden'), 360);
  };

  startButton.addEventListener('click', () => {
    hideOverlay();
    if (game.started) game.resume();
    else game.start();
  });

  // Losing pointer lock (Esc) pauses into this menu. Nothing re-captures the
  // cursor on its own — the player has to click Resume.
  game.onPause = () => {
    showOverlay('PAUSED', 'CURSOR RELEASED', 'RESUME');
  };
}

boot();
