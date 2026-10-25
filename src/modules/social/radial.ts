import * as THREE from 'three';
import type { Game } from '../../game/game';
import { canvasTexture } from '../../ui3d/text';
import { Text3D, Text3DOpts } from '../../ui3d/text3d';
import { Input } from '../../core/input';
import { Sound } from '../../core/audio';
import { Assets } from '../../core/assets';
import { Ease, clamp } from '../../core/util';
import { bodyPos, GEN } from './fx';
import { AMOUNTS, buildMoney, moneyLabel } from './money';

/* ============================================================================================
 * RIGHT-CLICK RADIAL — a small organic 3D pick that blooms next to the friend you right-clicked:
 *   ① ตบ (left) · ② ไฮไฟว์ (up) · ③ ให้เงิน (right)
 * Pick by sliding the mouse toward a petal (pointer stays locked, the view doesn't turn), or 1/2/3,
 * confirm with a click. "ให้เงิน" turns the bloom into an arc of real 3D Thai coins / banknotes
 * (5 · 10 · 20 · 50 · 100): wheel / mouse / 1-5, click to hand it over. Esc / Q cancels.
 * Local-only UI: results go to the host via intents (see actions.ts).
 * ========================================================================================== */

const images: Record<string, HTMLImageElement | null> = {};
export function preloadRadialImages() {
  for (const k of ['handprint_red.png', 'money/note100.jpg', 'money/note20.jpg']) {
    if (k in images) continue;
    images[k] = null;
    Assets.image(GEN + k).then((im) => { images[k] = im; }).catch(() => {});
  }
}

type PetalId = 'slap' | 'highfive' | 'money';
const PETALS: { id: PetalId; th: string; en: string; dir: THREE.Vector2; key: string }[] = [
  { id: 'slap', th: 'ตบ', en: 'slap', dir: new THREE.Vector2(-1, -0.12).normalize(), key: '1' },
  { id: 'highfive', th: 'ไฮไฟว์', en: 'high five', dir: new THREE.Vector2(0, 1), key: '2' },
  { id: 'money', th: 'ให้เงิน', en: 'give money', dir: new THREE.Vector2(1, -0.12).normalize(), key: '3' },
];

// petal labels are real floating 3D lettering (no bubble); the hand / banknote pictures stay real images
const PETAL_TXT: Text3DOpts = { font: 'bubbly', size: 0.032, depth: 0.4, bevel: 0.07, color: 0xfff0d2, side: 0x5a2c14, emissive: 0.3, shadow: 0.5, xray: true, castShadow: false, valign: 'top' };
const PETAL_HOT: Partial<Text3DOpts> = { color: 0xffe28a, side: 0x8a1c0a, emissive: 0.8, rim: 0xffb347, rimStrength: 1.2 };
const PETAL_SUB: Text3DOpts = { font: 'ui', size: 0.013, depth: 0.2, bevel: 0.05, color: 0xeadfcc, side: 0x33271f, emissive: 0.3, shadow: 0.5, xray: true, castShadow: false, valign: 'top' };

function petalCanvas(p: (typeof PETALS)[number]) {
  const iconH = 120;
  const cv = document.createElement('canvas');
  cv.width = 260;
  cv.height = iconH;
  const ctx = cv.getContext('2d')!;
  const cx = cv.width / 2, cy = iconH / 2 + 6;
  const hand = images['handprint_red.png'];
  if (p.id === 'slap' && hand) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.35); ctx.drawImage(hand, -48, -56, 96, 108); ctx.restore();
  } else if (p.id === 'highfive' && hand) {
    ctx.save(); ctx.translate(cx - 34, cy); ctx.rotate(0.25); ctx.scale(-1, 1); ctx.drawImage(hand, -40, -48, 80, 92); ctx.restore();
    ctx.save(); ctx.translate(cx + 34, cy); ctx.rotate(-0.25); ctx.drawImage(hand, -40, -48, 80, 92); ctx.restore();
  } else if (p.id === 'money') {
    const n = images['money/note100.jpg'], n2 = images['money/note20.jpg'];
    if (n2) { ctx.save(); ctx.translate(cx - 10, cy + 6); ctx.rotate(-0.25); ctx.drawImage(n2, -70, -36, 140, 72); ctx.restore(); }
    if (n) { ctx.save(); ctx.translate(cx + 10, cy - 4); ctx.rotate(0.12); ctx.drawImage(n, -70, -36, 140, 72); ctx.restore(); }
  }
  return cv;
}

interface Petal { id: PetalId; mesh: THREE.Group; icon: THREE.Mesh; txt: Text3D; sub: Text3D; hot: boolean; base: THREE.Vector3; dir: THREE.Vector2 }

export class Radial {
  readonly group = new THREE.Group();
  private petals: Petal[] = [];
  private core: THREE.Mesh;
  private coreMat: THREE.MeshStandardMaterial;
  private t = 0;
  private sel = -1;
  private aim = new THREE.Vector2();
  private phase: 'radial' | 'money' | 'closing' = 'radial';
  private closeT = 0;
  private money: { obj: THREE.Group; v: number; base: THREE.Vector3 }[] = [];
  private msel = 1;
  private macc = 0;
  private label: THREE.Group | null = null;
  private labelKey = '';
  alive = true;
  private wasMode: string | null = null;

  constructor(private game: Game, readonly target: number, private onPick: (id: PetalId, amount?: number) => void) {
    const S = 0.00078;
    PETALS.forEach((p) => {
      const cv = petalCanvas(p);
      const mesh = new THREE.Group();
      const icon = new THREE.Mesh(new THREE.PlaneGeometry(cv.width * S, cv.height * S), new THREE.MeshBasicMaterial({ map: canvasTexture(cv), transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
      icon.position.y = cv.height * S * 0.5 + 0.004;
      icon.renderOrder = 2100;
      const txt = new Text3D(`${p.key}. ${p.th}`, PETAL_TXT);
      const sub = new Text3D(p.en, PETAL_SUB);
      txt.popIn(0.03);
      sub.popIn(0.015);
      mesh.add(icon, txt, sub);
      const base = new THREE.Vector3(p.dir.x * 0.36, p.dir.y * 0.3 + 0.02, 0);
      this.group.add(mesh);
      this.petals.push({ id: p.id, mesh, icon, txt, sub, hot: false, base, dir: p.dir });
    });
    // aim bead (a little glowing 3D pearl that slides toward the petal you aim at)
    this.coreMat = new THREE.MeshStandardMaterial({ color: 0xfff3dc, emissive: 0x6a5030, roughness: 0.3, metalness: 0.1, transparent: true, depthTest: false, depthWrite: false });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), this.coreMat);
    this.core.renderOrder = 2099;
    this.group.add(this.core);
    this.group.renderOrder = 2100;
    game.scene?.add(this.group);
    Sound.play('cloud_poof', { vol: 0.45, pitch: 1.3 });
    const pl = game.player;
    if (pl && pl.mode === 'play') { this.wasMode = 'play'; pl.setMode('frozen'); }
  }

  private anchor(out: THREE.Vector3) {
    const cam = this.game.camera;
    const b = bodyPos(this.game, this.target, out);
    if (!b) return null;
    out.y += 1.3;
    const cp = cam.getWorldPosition(new THREE.Vector3());
    out.lerp(cp, 0.42);
    return out;
  }

  private openMoney() {
    this.phase = 'money';
    this.t = 0;
    Sound.play('coins_handful', { vol: 0.5 });
    AMOUNTS.forEach((v, i) => {
      const obj = buildMoney(v);
      const s = v <= 10 ? 4.2 : 1.55;
      obj.scale.setScalar(s);
      obj.rotation.x = v <= 10 ? Math.PI / 2 : 0;
      obj.traverse((o: any) => { if (o.isMesh) { o.renderOrder = 2101; o.material = o.material.clone(); o.material.depthTest = false; o.material.transparent = true; } });
      const x = (i - 2) * 0.2;
      const base = new THREE.Vector3(x, -0.06 - Math.abs(i - 2) * 0.035, 0);
      obj.position.copy(base);
      this.group.add(obj);
      this.money.push({ obj, v, base });
    });
    const wallet = this.game.me?.wallet ?? 0;
    this.msel = Math.max(0, AMOUNTS.findIndex((v) => v === 20 && v <= wallet));
    if (AMOUNTS[this.msel] > wallet) this.msel = 0;
  }

  private setLabel(text: string, sub: string) {
    const key = text + '|' + sub;
    if (key === this.labelKey) return;
    this.labelKey = key;
    if (this.label) {
      // relayout in place (3D lettering; glyph geometry is cached)
      (this.label.children[0] as Text3D).setText(text);
      (this.label.children[1] as Text3D).setText(sub);
      return;
    }
    const m = new THREE.Group();
    const main = new Text3D(text, { font: 'heavy', size: 0.026, depth: 0.45, bevel: 0.08, color: 0xffd45a, metalness: 0.85, roughness: 0.25, emissive: 0.1, keyLight: 0.55, bevelFace: true, shadow: 0.35, xray: true, castShadow: false, valign: 'bottom' });
    const subT = new Text3D(sub, { font: 'ui', size: 0.0095, depth: 0.2, bevel: 0.05, color: 0xffe9c0, side: 0x3a2410, emissive: 0.3, shadow: 0.5, xray: true, castShadow: false, valign: 'top', maxWidth: 0.6 });
    main.popIn(0.03);
    subT.position.y = -0.004;
    m.add(main, subT);
    m.position.set(0, -0.2, 0.01);
    this.group.add(m);
    this.label = m;
  }

  close(pick?: () => void) {
    if (this.phase === 'closing') return;
    this.phase = 'closing';
    this.closeT = 0;
    pick?.();
    const pl = this.game.player;
    if (pl && this.wasMode === 'play' && pl.mode === 'frozen') pl.setMode('play');
  }

  /** returns false when finished */
  update(dt: number): boolean {
    if (!this.alive) return false;
    const game = this.game;
    this.t += dt;
    const cam = game.camera;
    const a = this.anchor(new THREE.Vector3());
    const tgt = game.state.get(this.target);
    if (!a || !tgt || !cam) { this.close(); }
    else {
      this.group.position.copy(a);
      this.group.quaternion.copy(cam.quaternion);
      const d = a.distanceTo(cam.getWorldPosition(new THREE.Vector3()));
      const pop = this.phase === 'closing' ? 1 - Ease.inQuad(clamp(this.closeT / 0.18)) : Ease.outBack(clamp(this.t / 0.28), 2);
      this.group.scale.setScalar(Math.max(0.001, pop) * clamp(d * 0.95, 0.6, 3));
      const me = game.me;
      if (me?.p && tgt.p && Math.hypot(me.p[0] - tgt.p[0], me.p[2] - tgt.p[2]) > 4.5 && this.phase !== 'closing') this.close();
    }
    for (const p of this.petals) p.sub.position.y = -p.txt.height - 0.003;

    if (this.phase === 'closing') {
      this.closeT += dt;
      if (this.closeT > 0.2) { this.dispose(); return false; }
      return true;
    }
    // ---- input (eat look & slot keys so the game doesn't react underneath)
    const dx = Input.mouseDX, dy = Input.mouseDY;
    Input.mouseDX = 0; Input.mouseDY = 0;
    const wheel = Input.wheel; Input.wheel = 0;
    for (let i = 1; i <= 5; i++) if (Input.wasPressed('Digit' + i)) { Input.consume('Digit' + i); this.key(i); if (!this.alive || this.phase !== 'radial' && this.phase !== 'money') return true; }
    if (Input.wasPressed('Escape') || Input.wasPressed('KeyQ')) { Input.consume('KeyQ'); Sound.play('bubble_pop', { vol: 0.3, pitch: 0.7 }); this.close(); return true; }
    if (this.t > 12) { this.close(); return true; }

    if (this.phase === 'radial') {
      this.aim.x = clamp(this.aim.x + dx, -140, 140);
      this.aim.y = clamp(this.aim.y - dy, -140, 140);
      if (this.aim.length() > 140) this.aim.setLength(140);
      let sel = -1;
      if (this.aim.length() > 28) {
        let best = -2;
        this.petals.forEach((p, i) => { const dd = p.dir.dot(this.aim.clone().normalize()); if (dd > best) { best = dd; sel = i; } });
      }
      if (sel !== this.sel) { this.sel = sel; if (sel >= 0) Sound.play('bubble_pop', { vol: 0.25, pitch: 1.4 + sel * 0.15 }); }
      // core puff slides toward the aim
      const ak = Math.min(1, this.aim.length() / 140);
      this.core.position.set(this.aim.x / 140 * 0.12 * ak, this.aim.y / 140 * 0.1 * ak, 0.002);
      this.petals.forEach((p, i) => {
        const pop = Ease.outBack(clamp((this.t - i * 0.05) / 0.3), 2.2);
        const hi = i === this.sel ? 1 : 0;
        p.mesh.scale.setScalar(Math.max(0.001, pop) * (1 + hi * 0.18));
        p.mesh.position.copy(p.base).addScaledVector(new THREE.Vector3(p.dir.x, p.dir.y, 0), hi * 0.035);
        p.mesh.position.y += Math.sin(this.t * 3 + i * 2) * 0.006;
        if (!!hi !== p.hot) { p.hot = !!hi; p.txt.setLook(hi ? PETAL_HOT : { color: PETAL_TXT.color, side: PETAL_TXT.side, emissive: PETAL_TXT.emissive, rimStrength: 0 }); }
      });
      if (Input.mousePressed(0) || Input.mousePressed(2)) {
        Input.consumeMouse(0); Input.consumeMouse(2);
        if (this.sel >= 0) this.choose(this.sel);
        else if (this.t > 0.25) this.close();
      }
    } else if (this.phase === 'money') {
      this.macc += dx;
      if (Math.abs(this.macc) > 70) { this.moveMoney(Math.sign(this.macc)); this.macc = 0; }
      if (wheel) this.moveMoney(wheel);
      const wallet = game.me?.wallet ?? 0;
      this.petals.forEach((p) => { p.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 12)); });
      this.core.scale.setScalar(Math.max(0.001, this.core.scale.x * (1 - dt * 10)));
      this.money.forEach((m, i) => {
        const pop = Ease.outBack(clamp((this.t - i * 0.05) / 0.3), 2);
        const hi = i === this.msel ? 1 : 0;
        const can = m.v <= wallet;
        const s = (m.v <= 10 ? 4.2 : 1.55) * Math.max(0.001, pop) * (1 + hi * 0.45);
        m.obj.scale.setScalar(s);
        m.obj.position.copy(m.base).add(new THREE.Vector3(0, hi * 0.06 + Math.sin(this.t * 2.4 + i) * 0.006, hi * 0.05));
        m.obj.rotation.y = Math.sin(this.t * 1.6 + i) * 0.35 + (hi ? this.t * 1.8 : 0);
        m.obj.traverse((o: any) => { if (o.isMesh) o.material.opacity = can ? 1 : 0.35; });
      });
      const v = AMOUNTS[this.msel];
      this.setLabel(`${v} บาท`, v > wallet ? `ตังค์ไม่พอ! มีแค่ ${wallet} ฿` : `${moneyLabel(v)} · ในกระเป๋า ${wallet} ฿ · คลิกเพื่อให้`);
      if (Input.mousePressed(0) || Input.mousePressed(2)) {
        Input.consumeMouse(0); Input.consumeMouse(2);
        if (v <= wallet) { const amt = v; this.close(() => this.onPick('money', amt)); }
        else Sound.play('wrong_buzz', { vol: 0.4 });
      }
    }
    return true;
  }

  private moveMoney(d: number) {
    const n = Math.max(0, Math.min(AMOUNTS.length - 1, this.msel + d));
    if (n !== this.msel) { this.msel = n; Sound.play('coin_clink', { vol: 0.35, pitch: 1.1 + n * 0.08 }); }
  }

  private key(i: number) {
    if (this.phase === 'radial' && i <= 3) this.choose(i - 1);
    else if (this.phase === 'money' && i <= 5) {
      this.msel = i - 1;
      const v = AMOUNTS[this.msel];
      if (v <= (this.game.me?.wallet ?? 0)) this.close(() => this.onPick('money', v));
      else Sound.play('wrong_buzz', { vol: 0.4 });
    }
  }

  private choose(i: number) {
    const p = this.petals[i];
    if (!p) return;
    Sound.play('bubble_pop', { vol: 0.5, pitch: 1.1 });
    if (p.id === 'money') { this.openMoney(); return; }
    const id = p.id;
    this.close(() => this.onPick(id));
  }

  dispose() {
    this.alive = false;
    this.group.removeFromParent();
    for (const p of this.petals) { p.icon.geometry.dispose(); ((p.icon.material as any).map as THREE.Texture)?.dispose(); (p.icon.material as THREE.Material).dispose(); p.txt.dispose(); p.sub.dispose(); }
    this.core.geometry.dispose(); this.coreMat.dispose();
    for (const m of this.money) m.obj.traverse((o: any) => { if (o.isMesh) o.material.dispose(); });
    if (this.label) for (const c of [...this.label.children]) (c as Text3D).dispose();
    const pl = this.game.player;
    if (pl && this.wasMode === 'play' && pl.mode === 'frozen') pl.setMode('play');
  }
}
