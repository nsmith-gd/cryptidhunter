// Keyboard + mouse state. Uses event.code so layouts don't matter.
export class Input {
  constructor(element) {
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.element = element;
    this.locked = false;

    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      // Stop Ctrl+W & friends from hijacking the page while crouching.
      if (e.ctrlKey && e.code !== 'ControlLeft' && e.code !== 'ControlRight') e.preventDefault();
      if (this.locked) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === element;
      if (!this.locked) this.keys.clear();
    });
  }

  requestLock() { this.element.requestPointerLock?.(); }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }

  consumeMouse() {
    const d = [this.mouseDX, this.mouseDY];
    this.mouseDX = this.mouseDY = 0;
    return d;
  }
}
