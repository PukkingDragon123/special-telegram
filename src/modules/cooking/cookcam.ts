import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { damp } from '../../core/util';

/* =============================================================================================
 * COOKING CLOSE-UP — like a cooking game: when you stand at the cart and look at the wok (or the
 * chopping board / mortar / rice pot / a plate being filled), the gameplay camera dollies in along
 * your view onto the work surface, narrows its FOV and gets a little handheld life; it eases back
 * out when you look away or step back.
 *
 * Hooked through `game.camAdjust(camera, dt)` (called by player.ts right after it placed the
 * camera, before interaction rays): the dolly is ALONG the view axis, so the crosshair keeps
 * pointing at exactly the same thing. In third person the close-up starts from the eyes instead of
 * the over-the-shoulder spot (returns true → the player aims through this camera).
 * Never runs while another module owns the camera (mode 'external': cutscenes, tutorial shots).
 * ============================================================================================= */

const FOCUS_KINDS = new Set(['wok', 'chopping_board', 'mortar', 'rice_pot', 'pot', 'plate', 'bowl', 'takeaway_box']);
const ENTER_ANG = THREE.MathUtils.degToRad(30);
const STAY_ANG = THREE.MathUtils.degToRad(46);
const RANGE_IN = 1.9, RANGE_OUT = 2.35;

const _eye = new THREE.Vector3(), _fwd = new THREE.Vector3(), _to = new THREE.Vector3(), _p = new THREE.Vector3();

export class CookCam {
  /** 0..1 blend of the close-up */
  k = 0;
  private target: Ent | null = null;
  private lost = 0;
  private t = 0;
  private dist = 0.62;
  private focusPt = new THREE.Vector3();
  private smoothPt = new THREE.Vector3();
  private hasPt = false;

  constructor(private game: Game) {
    (game as any).camAdjust = (cam: THREE.PerspectiveCamera, dt: number) => this.apply(cam, dt);
    (game as any).cookCam = this;
  }

  get active() { return this.k > 0.02; }

  /** a cleaver hit / toss: short downward punch of the close-up camera */
  private shake = 0;
  kick(a = 1) { this.shake = Math.min(1.2, this.shake + a); }

  /** world point to frame for an item (top of the vessel / board) */
  private pointOf(e: Ent, out: THREE.Vector3): boolean {
    const p = this.game.items.worldPos(e);
    if (!p) return false;
    out.copy(p);
    out.y += e.k === 'wok' ? 0.06 : e.k === 'rice_pot' || e.k === 'pot' ? 0.12 : 0.03;
    return true;
  }

  private pick(eye: THREE.Vector3, fwd: THREE.Vector3): { e: Ent; ang: number; d: number } | null {
    const game = this.game;
    const me = game.me;
    let best: { e: Ent; ang: number; d: number } | null = null;
    for (const e of game.state.all('item')) {
      if (!FOCUS_KINDS.has(e.k)) continue;
      if (e.holder != null) continue;                         // carried things aren't a work surface
      // plates/bowls only count while they sit on the cart (plating), not on tables everywhere
      if ((e.k === 'plate' || e.k === 'bowl' || e.k === 'takeaway_box') && !(e.in != null && game.state.get(e.in)?.t === 'cart')) continue;
      if (!this.pointOf(e, _p)) continue;
      const d = _p.distanceTo(eye);
      if (d > RANGE_OUT) continue;
      _to.copy(_p).sub(eye).normalize();
      const ang = Math.acos(THREE.MathUtils.clamp(_to.dot(fwd), -1, 1));
      // the wok on the burner wins ties: it's where the action is
      const score = ang - (e.k === 'wok' ? 0.08 : 0);
      if (!best || score < best.ang) best = { e, ang: score, d };
    }
    void me;
    return best;
  }

  apply(cam: THREE.PerspectiveCamera, dt: number): boolean {
    const game = this.game;
    const pl: any = game.player;
    if (!pl || !game.me || pl.mode !== 'play' || game.scenes.currentName !== 'world') { this.k = 0; this.target = null; return false; }
    if ((game as any).buildActive || game.ui?.choosing) { this.k = Math.max(0, this.k - dt * 4); }
    this.t += dt;
    // decide from the EYES (same in first and third person)
    pl.eyePos(_eye);
    _fwd.set(-Math.sin(pl.yaw) * Math.cos(pl.pitch), Math.sin(pl.pitch), -Math.cos(pl.yaw) * Math.cos(pl.pitch));
    const c = this.pick(_eye, _fwd);
    let want = 0;
    if (c) {
      const stay = this.target && c.e.id === this.target.id;
      if ((stay && c.ang < STAY_ANG && c.d < RANGE_OUT) || (c.ang < ENTER_ANG && c.d < RANGE_IN)) {
        this.target = c.e; this.lost = 0; want = 1;
      }
    }
    if (!want && this.target) {
      this.lost += dt;
      if (this.lost < 0.35) want = 1; else this.target = null;
    }
    if ((game as any).buildActive || game.ui?.choosing) want = 0;
    // ease: in a bit slower than out (feels deliberate), smoothstep shaped
    this.k += ((want ? 1 : 0) - this.k) * Math.min(1, dt * (want ? 4.2 : 5.5));
    if (this.k < 0.002) { this.k = 0; this.hasPt = false; return false; }
    if (this.target && this.pointOf(this.target, this.focusPt)) {
      if (!this.hasPt) { this.smoothPt.copy(this.focusPt); this.hasPt = true; }
      this.smoothPt.lerp(this.focusPt, damp(10, dt));
    }
    const k = this.k * this.k * (3 - 2 * this.k);
    // dolly along the view axis toward the work surface: stop ~0.6 m short of it (closer for boards)
    const stopAt = this.target?.k === 'wok' ? 0.8 : this.target?.k === 'chopping_board' || this.target?.k === 'mortar' ? 0.5 : 0.62;
    this.dist += (stopAt - this.dist) * damp(6, dt);
    const along = Math.max(0, _to.copy(this.smoothPt).sub(_eye).dot(_fwd) - this.dist);
    _p.copy(_eye).addScaledVector(_fwd, along);
    // handheld life: tiny drift + breathing (position only, so the aim stays exact)
    const h = 0.0045 * k;
    _p.x += Math.sin(this.t * 1.31) * h; _p.y += Math.sin(this.t * 1.07 + 1.3) * h * 0.8; _p.z += Math.cos(this.t * 0.93) * h;
    if (this.shake > 0.001) { _p.y -= this.shake * 0.011 * k; _p.addScaledVector(_fwd, this.shake * 0.008 * k); this.shake *= Math.exp(-dt * 16); }
    // first person: blend from the eye camera; third person: from the shoulder camera to the eye line
    cam.position.lerp(_p, k);
    const fov = cam.fov + (50 - cam.fov) * k;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    // third person aims through this camera once it is mostly on the eye line
    return pl.view === 'tp' ? k > 0.5 : false;
  }
}
