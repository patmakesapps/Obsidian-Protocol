// Keyboard + mouse with pointer lock. Exposes edge-triggered "pressed" queries
// so gameplay code can ask "was this tapped this frame" without tracking state.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressedThisFrame = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, wheel: 0 };
    this.locked = false;

    this._onWheel = (e) => {
      if (!this.locked) return;
      // Normalise to -1 / +1 notches; trackpads emit tiny deltas constantly.
      this.mouse.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    };

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      const code = e.code;
      this.keys.add(code);
      this.pressedThisFrame.add(code);
      // Stop the browser stealing gameplay keys once we're in the game.
      if (this.locked && ['Space', 'Tab', 'F1'].includes(code)) e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);

    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    };
    this._onMouseDown = (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.mouse.left = true;
        this.mouse.leftPressed = true;
      }
      if (e.button === 2) this.mouse.right = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.keys.clear();
        this.mouse.left = false;
        this.mouse.right = false;
      }
      this.onLockChange?.(this.locked);
    };
    this._onContextMenu = (e) => e.preventDefault();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('contextmenu', this._onContextMenu);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  requestLock() {
    this.canvas.requestPointerLock?.();
  }

  isDown(code) {
    return this.keys.has(code);
  }

  wasPressed(code) {
    return this.pressedThisFrame.has(code);
  }

  /** Consume per-frame edge state. Call once at the very end of each frame. */
  endFrame() {
    this.pressedThisFrame.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.leftPressed = false;
    this.mouse.wheel = 0;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('contextmenu', this._onContextMenu);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}
