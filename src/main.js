import { Game } from './core/Game.js';

const canvas = document.getElementById('viewport');
const overlay = document.getElementById('overlay');
const status = document.getElementById('overlay-status');
const startButton = document.getElementById('start-button');

async function boot() {
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
