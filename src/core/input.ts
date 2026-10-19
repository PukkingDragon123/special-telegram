/**
 * Keyboard + mouse input with pointer lock. Per-frame edge detection (pressed/released).
 * Call `endFrame()` once per rendered frame (the Engine does this).
 *
 * Bindings (see docs/ARCHITECTURE.md): WASD move, Shift run, Ctrl crouch, Space jump,
 * E pick up / interact, Q drop, 1-5 / wheel select slot, LMB use, RMB social / alt,
 * Tab skill tree (think), F read/inspect, Esc pause.
 */
export type MouseButton = 0 | 1 | 2;

class InputSys {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  private mDown = new Set<number>();
  private mPressed = new Set<number>();
  private mReleased = new Set<number>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  /** Normalized device coords of the cursor (for menus when the pointer is not locked). */
  ndc = { x: 0, y: 0 };
  clientX = 0;
  clientY = 0;
  locked = false;
  /** >0 while a text field / modal owns the keyboard. */
  private blockCount = 0;
  sensitivity = 0.0022;
  invertY = false;
  private el: HTMLElement | null = null;
  private wantLock = false;
  /** Fired when pointer lock is lost unexpectedly (Esc) → pause menu. */
  onUnlock: (() => void) | null = null;

  attach(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if (this.isTypingTarget(e.target)) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'F1', 'F3'].includes(e.code)) e.preventDefault();
      if (e.ctrlKey && ['KeyW', 'KeyS', 'KeyD', 'KeyE', 'KeyQ'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => {
      for (const c of this.down) this.released.add(c);
      this.down.clear();
      this.mDown.clear();
    });
    el.addEventListener('mousedown', (e) => {
      if (this.wantLock && !this.locked) this.lock();
      this.mDown.add(e.button);
      this.mPressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.mDown.delete(e.button);
      this.mReleased.add(e.button);
    });
    window.addEventListener('mousemove', (e) => {
      this.clientX = e.clientX;
      this.clientY = e.clientY;
      this.ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
      if (this.locked) {
        // Guard against browser spikes on lock change.
        if (Math.abs(e.movementX) < 400 && Math.abs(e.movementY) < 400) {
          this.mouseDX += e.movementX;
          this.mouseDY += e.movementY;
        }
      }
    });
    el.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.el;
      if (was && !this.locked && this.wantLock) this.onUnlock?.();
    });
  }

  private isTypingTarget(t: EventTarget | null) {
    const el = t as HTMLElement;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  /** Gameplay wants pointer lock (first-person). The lock is requested on the next click if the browser refused. */
  setWantLock(v: boolean) {
    this.wantLock = v;
    if (v) this.lock();
    else if (document.pointerLockElement) document.exitPointerLock();
  }
  lock() {
    if (!this.el || this.locked) return;
    try {
      const p = (this.el as any).requestPointerLock?.({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { (this.el as any).requestPointerLock?.(); } catch {} });
    } catch {}
  }

  block() { this.blockCount++; }
  unblock() { this.blockCount = Math.max(0, this.blockCount - 1); }
  get blocked() { return this.blockCount > 0; }

  isDown(code: string) { return !this.blocked && this.down.has(code); }
  wasPressed(code: string) { return !this.blocked && this.pressed.has(code); }
  wasReleased(code: string) { return this.released.has(code); }
  mouseDown(b: MouseButton) { return !this.blocked && this.mDown.has(b); }
  mousePressed(b: MouseButton) { return !this.blocked && this.mPressed.has(b); }
  mouseReleased(b: MouseButton) { return this.mReleased.has(b); }
  /** Consume an edge so other systems in the same frame don't also react. */
  consume(code: string) { this.pressed.delete(code); }
  consumeMouse(b: MouseButton) { this.mPressed.delete(b); }

  /** Simulated key events (tests / scripted demos). */
  simulate(code: string, down: boolean) {
    if (down) { if (!this.down.has(code)) this.pressed.add(code); this.down.add(code); }
    else { this.down.delete(code); this.released.add(code); }
  }
  simulateMouse(b: MouseButton, down: boolean) {
    if (down) { this.mDown.add(b); this.mPressed.add(b); } else { this.mDown.delete(b); this.mReleased.add(b); }
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mPressed.clear();
    this.mReleased.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}

export const Input = new InputSys();
