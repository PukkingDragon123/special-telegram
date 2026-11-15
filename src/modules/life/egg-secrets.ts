import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ctx } from '../../game/interact';
import { Sound } from '../../core/audio';
import { asset, tl } from '../../core/util';
import { F } from '../../core/fonts';

/* ============================================================================================
 * A small secret (local, every peer): a framed baby photo on a little wall shelf at the far end of
 * the soi (garland, candle, a toy car). Optional: the photo file (public/assets/gen/eggs/baby_photo.jpg)
 * is kept out of the public repo — when it's missing the shelf is simply not built (one HEAD request,
 * no retry). Look at it: sparkle + a funny thought; [E] "ดูรูป".
 * ========================================================================================== */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const PHOTO_URL = 'gen/eggs/baby_photo.jpg';
/** wall shelf at the north end of the soi, on the west facades (facing +x into the soi) */
const SHELF_AT = V(-5.98, 1.55, -146.5);
// ------------------------------------------------------------------ the class

export class Secrets {
  private group: THREE.Group | null = null;
  private shelf: THREE.Group | null = null;
  private photoSeen = false;
  private sparkle: THREE.Sprite | null = null;
  private provider = false;
  private t = 0;

  constructor(private game: Game) {}

  build(parent: THREE.Object3D) {
    if (this.group) return;
    const g = (this.group = new THREE.Group());
    g.name = 'life:secrets';
    parent.add(g);
    this.buildShelf();
    if (!this.provider) { this.provider = true; this.game.interact.provide((ctx) => this.actions(ctx), 30); }
  }

  dispose() {
    this.group?.removeFromParent();
    if (this.shelf) this.game.interact.unregister(this.shelf);
    this.group = null; this.shelf = null; this.sparkle = null;
  }

  private snd(key: string, pos: THREE.Vector3, vol = 0.8) {
    if (!Sound.has(key)) return null;
    return Sound.play(key, { pos, vol, ref: 2.5, max: 25 } as any);
  }

  // ---- baby photo shelf (only if the photo exists)
  private buildShelf() {
    const url = asset(PHOTO_URL);
    fetch(url, { method: 'HEAD' }).then((r) => {
      if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image')) return;
      const im = new Image();
      im.onload = () => { if (this.group) this.makeShelf(im); };
      im.src = url;
    }).catch(() => { /* no photo: no shelf */ });
  }

  private makeShelf(im: HTMLImageElement) {
    const g = new THREE.Group();
    g.position.copy(SHELF_AT);
    g.rotation.y = Math.PI / 2;   // facing +x (into the soi)
    // a small red-lacquer wall shelf
    const lac = new THREE.MeshStandardMaterial({ color: 0x8a1e16, roughness: 0.45, metalness: 0.1 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.025, 0.16), lac); board.position.set(0, -0.2, 0.08); g.add(board);
    const backB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.015), lac); backB.position.set(0, 0, 0.008); g.add(backB);
    for (const sx of [-1, 1]) { const br = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.14), lac); br.position.set(sx * 0.2, -0.24, 0.07); g.add(br); }
    // framed photo (the photo is drawn into a canvas with a white mat — no stretching)
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 400;
    const x = cv.getContext('2d')!;
    x.fillStyle = '#f6f2ea'; x.fillRect(0, 0, 320, 400);
    const ar = im.width / im.height, bw = 270, bh = 330;
    let w = bw, h = bw / ar; if (h > bh) { h = bh; w = bh * ar; }
    x.drawImage(im, (320 - w) / 2, 22 + (bh - h) / 2, w, h);
    x.fillStyle = '#5a3a2a'; x.font = `600 22px ${F.ui}`; x.textAlign = 'center'; x.fillText('เจ้าตัวเล็ก ♥', 160, 382);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.23, 0.018), new THREE.MeshStandardMaterial({ color: 0xc8a050, roughness: 0.35, metalness: 0.7 }));
    const fg = new THREE.Group(); fg.add(frame); pic.position.z = 0.0095; fg.add(pic);
    fg.position.set(-0.05, -0.07, 0.07); fg.rotation.x = -0.12;
    g.add(fg);
    // jasmine garland (small beads), a candle and a little toy car
    const jas = new THREE.MeshStandardMaterial({ color: 0xf4f0e2, roughness: 0.7 });
    for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI; const b = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 5), jas); b.position.set(-0.05 + Math.cos(a) * 0.09, 0.05 - Math.sin(a) * 0.14, 0.085); g.add(b); }
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 10), new THREE.MeshStandardMaterial({ color: 0xf2e6c0, roughness: 0.6 })); candle.position.set(0.14, -0.15, 0.1); g.add(candle);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc860 })); flame.scale.y = 1.8; flame.position.set(0.14, -0.105, 0.1); g.add(flame);
    const car = new THREE.Group();
    const cb = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.025, 0.035), new THREE.MeshStandardMaterial({ color: 0x2f6ad0, roughness: 0.4, metalness: 0.3 })); cb.position.y = 0.022; car.add(cb);
    for (const [wx, wz] of [[-0.022, 0.018], [0.022, 0.018], [-0.022, -0.018], [0.022, -0.018]]) { const w2 = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.008, 10), new THREE.MeshStandardMaterial({ color: 0x111111 })); w2.rotation.x = Math.PI / 2; w2.position.set(wx, 0.01, wz); car.add(w2); }
    car.position.set(0.12, -0.188, 0.06); car.rotation.y = 0.5; g.add(car);
    // sparkle sprite (shows when you're close and looking at it, until you've seen it once)
    const sc = document.createElement('canvas'); sc.width = sc.height = 64;
    const sx = sc.getContext('2d')!; const gr = sx.createRadialGradient(32, 32, 0, 32, 32, 30); gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.25, 'rgba(255,230,150,0.6)'); gr.addColorStop(1, 'rgba(255,220,120,0)');
    sx.fillStyle = gr; sx.fillRect(0, 0, 64, 64);
    const st = new THREE.CanvasTexture(sc);
    this.sparkle = new THREE.Sprite(new THREE.SpriteMaterial({ map: st, transparent: true, depthWrite: false, opacity: 0 }));
    this.sparkle.scale.setScalar(0.12);
    this.sparkle.position.set(0.02, 0.02, 0.09);
    g.add(this.sparkle);
    g.traverse((o: any) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    this.group!.add(g);
    this.shelf = g;
    this.game.interact.register(g, { kind: 'egg', data: { name: tl('รูปเด็ก', 'baby photo') }, reach: 2.6 });
  }

  // ---- interactions
  private actions(ctx: Ctx) {
    const root = ctx.hit?.object;
    if (!root) return;
    if (this.shelf && root === this.shelf) {
      return { key: 'E' as const, label: tl('ดูรูป', 'look at the photo'), priority: 7, run: () => this.lookPhoto() };
    }
  }

  private lookPhoto() {
    this.photoSeen = true;
    const me = this.game.me;
    if (this.shelf) this.snd('sparkle_chime', this.shelf.position, 0.6);
    const lines = [tl('ใครเอารูปเด็กมาวางไว้ตรงนี้… น่ารักเกินไปแล้ว', 'Who put a baby photo here… way too cute'), tl('แก้มยุ้ยชิบหาย… เหมือนกูตอนเด็กเลย', 'Those chubby cheeks… looks like me as a kid'), tl('ขอให้หนูโตมาไม่ติดบาคาร่าแบบเฮียนะ', 'Grow up and never gamble like me, kiddo')];
    if (me) this.game.say(me.id, lines[Math.floor(Math.random() * lines.length)], { style: 'thought', duration: 3.4 });
  }

  // ---- frame
  frame(dt: number) {
    if (!this.group) return;
    this.t += dt;
    const cam = this.game.camera.getWorldPosition(V(0, 0, 0));
    if (this.shelf && this.sparkle) {
      const d = this.shelf.position.distanceTo(cam);
      const want = !this.photoSeen && d < 6 ? 0.85 : 0;
      const m = this.sparkle.material as THREE.SpriteMaterial;
      m.opacity += (want * (0.6 + 0.4 * Math.sin(this.t * 5)) - m.opacity) * Math.min(1, dt * 4);
      this.sparkle.visible = m.opacity > 0.02;
    }
  }
}
