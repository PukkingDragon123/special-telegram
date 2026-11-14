import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ctx } from '../../game/interact';
import { Sound } from '../../core/audio';
import { asset, tl } from '../../core/util';
import { F } from '../../core/fonts';

/* ============================================================================================
 * Two small secrets (local, every peer):
 *  1. A framed baby photo on a little wall shelf at the far end of the soi (garland, candle, a
 *     toy car). Optional: the photo file (public/assets/gen/eggs/baby_photo.jpg) is kept out of the
 *     public repo — when it's missing the whole shelf is simply not built (one HEAD request, no retry).
 *     Look at it: sparkle + a funny thought; [E] "ดูรูป".
 *  2. น้องเสือดาวหิมะ — an ORIGINAL fluffy snow-leopard kitten (procedural, shell-fur, its own
 *     rosette coat) sitting on a crate behind the temple amulet stall. When you come close it
 *     raises one paw toward you; [E] high-five → paw bump, meow, purr, little hearts.
 * ========================================================================================== */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const PHOTO_URL = 'gen/eggs/baby_photo.jpg';
/** wall shelf at the north end of the soi, on the west facades (facing +x into the soi) */
const SHELF_AT = V(-5.98, 1.55, -146.5);
/** kitten on a crate behind the temple amulet stall */
const KITTEN_AT = V(13.6, 0.15, -157.6);

// ------------------------------------------------------------------ snow-leopard coat (procedural)

function coatCanvas(): HTMLCanvasElement {
  const W = 512, H = 256;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#d9d6cf'); g.addColorStop(0.55, '#ebe8e1'); g.addColorStop(1, '#f6f4ef');   // paler belly (bottom of the sphere UV)
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // fur noise
  for (let i = 0; i < 6000; i++) { const a = Math.random(); x.fillStyle = a < 0.5 ? 'rgba(120,118,112,0.08)' : 'rgba(255,255,255,0.12)'; x.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 3 + Math.random() * 4); }
  // rosettes: broken dark rings with a slightly darker grey centre, smaller toward the top (head/back)
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 70; i++) {
    const cx = rnd() * W, cy = 20 + rnd() * (H * 0.72), r = 6 + rnd() * 9 * (cy / H + 0.4);
    x.fillStyle = 'rgba(150,146,140,0.45)'; x.beginPath(); x.ellipse(cx, cy, r * 0.8, r * 0.6, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#25221f'; x.lineWidth = 2.6 + rnd() * 1.6; x.lineCap = 'round';
    const segs = 3 + Math.floor(rnd() * 3);
    for (let s = 0; s < segs; s++) { const a0 = (s / segs) * Math.PI * 2 + rnd() * 0.5; x.beginPath(); x.ellipse(cx, cy, r, r * 0.75, 0, a0, a0 + (Math.PI * 2) / segs * 0.65); x.stroke(); }
  }
  // small solid spots
  for (let i = 0; i < 120; i++) { x.fillStyle = '#2a2622'; x.beginPath(); x.arc(rnd() * W, rnd() * H * 0.8, 1.2 + rnd() * 2.2, 0, Math.PI * 2); x.fill(); }
  return cv;
}

/** alpha-tested fur strands for the shells */
function furAlpha(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const x = cv.getContext('2d')!;
  x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) { const v = 120 + Math.random() * 135; x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(Math.random() * S, Math.random() * S, 1.2, 1.2); }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 3);
  return t;
}

interface Kitten {
  root: THREE.Group;
  head: THREE.Group;
  paw: THREE.Group;
  pad: THREE.Group;
  tail: THREE.Group;
  eyes: THREE.Mesh[];
  body: THREE.Mesh;
  raise: number;
  bump: number;
  blink: number;
  meowT: number;
  hearts: { m: THREE.Sprite; t: number; v: THREE.Vector3 }[];
  heartMat: THREE.SpriteMaterial;
  purr: { stop(f?: number): void } | null;
  purrT: number;
}

function buildKitten(): Kitten {
  const coat = new THREE.CanvasTexture(coatCanvas());
  coat.colorSpace = THREE.SRGBColorSpace;
  const fur = new THREE.MeshStandardMaterial({ map: coat, roughness: 0.95 });
  const fa = furAlpha();
  const root = new THREE.Group();
  root.name = 'egg:snow_kitten';
  const shells = (mesh: THREE.Mesh, n = 6, len = 0.012) => {
    // shell fur: inflated copies (children of the base mesh) with alpha-tested strands, sparser further out
    const r = Math.max(0.03, mesh.scale.x);
    for (let i = 1; i <= n; i++) {
      const m = new THREE.MeshStandardMaterial({ map: coat, alphaMap: fa, alphaTest: 0.35 + (i / n) * 0.45, roughness: 1 });
      const s = new THREE.Mesh(mesh.geometry, m);
      const k = 1 + (len * i) / r;
      s.scale.set(k, k, k);
      s.castShadow = false;
      mesh.add(s);
    }
  };
  // body: an upright egg (sitting)
  const bodyGeo = new THREE.SphereGeometry(1, 24, 16);
  bodyGeo.computeBoundingSphere();
  const body = new THREE.Mesh(bodyGeo, fur);
  body.scale.set(0.105, 0.13, 0.115);
  body.position.set(0, 0.13, 0);
  body.castShadow = true;
  root.add(body);
  shells(body, 5, 0.01);
  // haunches
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(bodyGeo, fur);
    h.scale.set(0.06, 0.055, 0.085); h.position.set(sx * 0.065, 0.055, -0.01);
    root.add(h);
  }
  // head
  const head = new THREE.Group();
  head.position.set(0, 0.29, 0.03);
  root.add(head);
  const skull = new THREE.Mesh(bodyGeo, fur);
  skull.scale.set(0.085, 0.078, 0.08);
  head.add(skull);
  shells(skull, 5, 0.008);
  for (const sx of [-1, 1]) {   // fluffy cheeks
    const ch = new THREE.Mesh(bodyGeo, fur); ch.scale.set(0.04, 0.032, 0.035); ch.position.set(sx * 0.052, -0.03, 0.035); head.add(ch);
    // ears: rounded little cones, dark backs
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.045, 12), new THREE.MeshStandardMaterial({ color: 0xcfcac2, roughness: 0.95 }));
    ear.position.set(sx * 0.05, 0.07, -0.005); ear.rotation.z = -sx * 0.35; ear.scale.z = 0.55; head.add(ear);
    const back = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.04, 12), new THREE.MeshStandardMaterial({ color: 0x2e2a27, roughness: 0.9 }));
    back.position.set(sx * 0.05, 0.069, -0.012); back.rotation.z = -sx * 0.35; back.scale.z = 0.4; head.add(back);
  }
  // huge glossy dark eyes (big, round, a little sad — "please")
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0806, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 });
  const eyes: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.SphereGeometry(0.0265, 16, 12), new THREE.MeshStandardMaterial({ color: 0x5a5048, roughness: 0.6 }));
    ring.position.set(sx * 0.034, 0.008, 0.062); ring.scale.z = 0.5; head.add(ring);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 12), eyeMat);
    e.position.set(sx * 0.034, 0.008, 0.066); e.scale.z = 0.55;
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    hl.position.set(-0.008, 0.009, 0.02); e.add(hl);
    head.add(e); eyes.push(e);
  }
  // nose + mouth
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), new THREE.MeshStandardMaterial({ color: 0x5a4a48, roughness: 0.5 }));
  nose.position.set(0, -0.018, 0.08); nose.scale.set(1.2, 0.8, 0.7); head.add(nose);
  // front paws: left resting, right on a pivot (raised toward you)
  // chubby front legs: short thick fur capsules ending in round mitts
  const pawGeo = new THREE.CapsuleGeometry(0.028, 0.07, 4, 12);
  const mittGeo = new THREE.SphereGeometry(0.032, 14, 10);
  const lm = new THREE.Mesh(mittGeo, fur); lm.scale.set(1.05, 0.75, 1.25); lm.position.set(-0.04, 0.022, 0.095); root.add(lm);
  const paw = new THREE.Group(); paw.position.set(0.045, 0.17, 0.07); root.add(paw);
  const arm = new THREE.Mesh(pawGeo, fur); arm.position.set(0, -0.05, 0); paw.add(arm);
  shells(arm, 3, 0.006);
  const pad = new THREE.Group(); pad.position.set(0, -0.105, 0.006); paw.add(pad);
  const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), fur); mitt.scale.set(1, 0.9, 0.7); pad.add(mitt);
  const padMat = new THREE.MeshStandardMaterial({ color: 0x1a1614, roughness: 0.6 });
  const big = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), padMat); big.position.set(0, -0.006, 0.019); big.scale.set(1.2, 0.9, 0.4); pad.add(big);
  for (let i = 0; i < 4; i++) { const tp = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 8, 6), padMat); tp.position.set(-0.016 + i * 0.0107, 0.013 + (i === 1 || i === 2 ? 0.004 : 0), 0.018); tp.scale.z = 0.45; pad.add(tp); }
  // big fluffy tail curled around the feet
  const tail = new THREE.Group(); tail.position.set(0.0, 0.03, -0.08); root.add(tail);
  const curve = new THREE.CatmullRomCurve3([V(0, 0, 0), V(0.1, 0, -0.04), V(0.16, 0.0, 0.06), V(0.1, 0.01, 0.16), V(-0.02, 0.02, 0.2)]);
  const tailM = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.032, 10, false), fur); tail.add(tailM);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 8), new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.95 })); tip.position.copy(curve.getPoint(1)); tail.add(tip);
  root.traverse((o: any) => { if (o.isMesh && o.material !== eyeMat) o.receiveShadow = true; });
  // hearts
  const hc = document.createElement('canvas'); hc.width = hc.height = 64;
  const hx = hc.getContext('2d')!; hx.font = `700 52px ${F.ui}`; hx.textAlign = 'center'; hx.textBaseline = 'middle'; hx.fillStyle = '#ff5a8a'; hx.fillText('♥', 32, 34);
  const ht = new THREE.CanvasTexture(hc); ht.colorSpace = THREE.SRGBColorSpace;
  const heartMat = new THREE.SpriteMaterial({ map: ht, transparent: true, depthWrite: false });
  return { root, head, paw, pad, tail, eyes, body, raise: 0, bump: 0, blink: 3, meowT: 2, hearts: [], heartMat, purr: null, purrT: 0 };
}

// ------------------------------------------------------------------ the class

export class Secrets {
  private group: THREE.Group | null = null;
  private kitten: Kitten | null = null;
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
    this.buildKitten();
    this.buildShelf();
    if (!this.provider) { this.provider = true; this.game.interact.provide((ctx) => this.actions(ctx), 30); }
  }

  dispose() {
    this.kitten?.purr?.stop(0.2);
    this.group?.removeFromParent();
    if (this.kitten) this.game.interact.unregister(this.kitten.root);
    if (this.shelf) this.game.interact.unregister(this.shelf);
    this.group = null; this.kitten = null; this.shelf = null; this.sparkle = null;
  }

  private snd(key: string, pos: THREE.Vector3, vol = 0.8) {
    if (!Sound.has(key)) return null;
    return Sound.play(key, { pos, vol, ref: 2.5, max: 25 } as any);
  }

  // ---- kitten
  private buildKitten() {
    const k = buildKitten();
    const gy = (this.game.world as any)?.groundY?.(KITTEN_AT.x, KITTEN_AT.z) ?? KITTEN_AT.y;
    // a weathered wooden crate to sit on
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.34, 0.38), new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.9 }));
    crate.position.set(KITTEN_AT.x, gy + 0.17, KITTEN_AT.z);
    crate.castShadow = true; crate.receiveShadow = true;
    this.group!.add(crate);
    k.root.position.set(KITTEN_AT.x, gy + 0.34, KITTEN_AT.z);
    k.root.rotation.y = -Math.PI / 2;   // facing -x (toward the temple path)
    k.root.scale.setScalar(1.25);
    this.group!.add(k.root);
    this.game.interact.register(k.root, { kind: 'egg', data: { name: tl('น้องเสือดาวหิมะ', 'snow-leopard kitten') }, reach: 2.4 });
    this.kitten = k;
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
    if (this.kitten && root === this.kitten.root) {
      return { key: 'E' as const, label: tl('แปะมือ', 'high-five'), priority: 7, run: () => this.highFive() };
    }
    if (this.shelf && root === this.shelf) {
      return { key: 'E' as const, label: tl('ดูรูป', 'look at the photo'), priority: 7, run: () => this.lookPhoto() };
    }
  }

  private highFive() {
    const k = this.kitten;
    if (!k) return;
    k.bump = 1;
    const p = k.root.position.clone().add(V(0, 0.35, 0));
    this.snd('cat_meow', p, 0.9);
    if (!k.purr) { k.purr = this.snd('cat_purr_loop', p, 0.55) as any; k.purrT = 4; }
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Sprite(k.heartMat);
      m.scale.setScalar(0.07 + Math.random() * 0.04);
      m.position.copy(p).add(V((Math.random() - 0.5) * 0.15, 0, (Math.random() - 0.5) * 0.15));
      this.group!.add(m);
      k.hearts.push({ m, t: 0, v: V((Math.random() - 0.5) * 0.25, 0.45 + Math.random() * 0.3, (Math.random() - 0.5) * 0.25) });
    }
    const me = this.game.me;
    const lines = [tl('แปะ! …โอ๊ย อุ้งเท้านุ่มชิบหาย', 'High-five! …damn, that paw is SO soft'), tl('น้องเสือดาวหิมะ… ใครเอามาปล่อยแถววัดเนี่ย', 'A snow-leopard kitten… who left it by the temple?'), tl('ขอโทษนะ เฮียไม่มีปลาทู', 'Sorry kid, no fish today')];
    if (me) this.game.say(me.id, lines[Math.floor(Math.random() * lines.length)], { style: 'thought', duration: 3 });
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
    const k = this.kitten;
    if (k) {
      const d = k.root.position.distanceTo(cam);
      const near = d < 3.6;
      if (d < 30) {
        // breathe, look at you, raise a paw when you're close, blink
        k.body.scale.y = 0.13 * (1 + Math.sin(this.t * 2.4) * 0.025);
        const local = k.root.worldToLocal(cam.clone());
        const yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -0.9, 0.9);
        const pitch = THREE.MathUtils.clamp(-Math.atan2(local.y - 0.3, Math.hypot(local.x, local.z)) * 0.6, -0.4, 0.35);
        k.head.rotation.y += (yaw - k.head.rotation.y) * Math.min(1, dt * 4);
        k.head.rotation.x += (pitch - k.head.rotation.x) * Math.min(1, dt * 4);
        k.raise += ((near ? 1 : 0) - k.raise) * Math.min(1, dt * (near ? 3 : 1.5));
        k.bump = Math.max(0, k.bump - dt * 2.5);
        // raised paw: forearm up and forward, pad facing you; the bump pushes it forward
        k.paw.rotation.x = -k.raise * 2.0 - Math.sin(k.bump * Math.PI) * 0.35;
        k.paw.rotation.z = -k.raise * 0.3;
        k.pad.rotation.x = k.raise * 1.75;   // the pink-black toe beans face you, like a high-five
        k.paw.position.z = 0.06 + Math.sin(k.bump * Math.PI) * 0.05;
        k.tail.rotation.y = Math.sin(this.t * 1.3) * 0.12;
        k.blink -= dt;
        const closed = k.blink < 0.12;
        for (const e of k.eyes) e.scale.y = closed ? 0.12 : 1;
        if (k.blink < 0) k.blink = 2.5 + Math.random() * 3;
        if (near) { k.meowT -= dt; if (k.meowT < 0) { k.meowT = 7 + Math.random() * 6; this.snd('cat_meow', k.root.position.clone().add(V(0, 0.3, 0)), 0.5); } }
        if (k.purr) { k.purrT -= dt; if (k.purrT < 0 || !near) { k.purr.stop(0.6); k.purr = null; } }
      }
      for (const h of k.hearts) { h.t += dt; h.m.position.addScaledVector(h.v, dt); h.m.material.opacity = Math.max(0, 1 - h.t / 1.4); }
      k.hearts = k.hearts.filter((h) => { if (h.t > 1.4) { h.m.removeFromParent(); return false; } return true; });
    }
    if (this.shelf && this.sparkle) {
      const d = this.shelf.position.distanceTo(cam);
      const want = !this.photoSeen && d < 6 ? 0.85 : 0;
      const m = this.sparkle.material as THREE.SpriteMaterial;
      m.opacity += (want * (0.6 + 0.4 * Math.sin(this.t * 5)) - m.opacity) * Math.min(1, dt * 4);
      this.sparkle.visible = m.opacity > 0.02;
    }
  }
}
