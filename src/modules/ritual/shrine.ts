import * as THREE from 'three';
import type { Game } from '../../game/game';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Assets } from '../../core/assets';
import { F } from '../../core/fonts';
import { text3d, type Text3D } from '../../ui3d/text3d';
import { libModel } from '../world/lib';
import { Mist } from '../life/fx';
import { FLYER_LINES, OFFER_KINDS, type OfferKind } from './lines';
import type { RitualState } from './state';

/* ============================================================================================
 * The ritual corner at the spirit house at the back of the soi (client visuals, every peer):
 *  - a red-lacquer Thai offering table (turned legs, gold trim, carved apron) in front of the ศาลพระภูมิ,
 *    with a silver ขัน of sand as the incense pot (old burnt stubs in it)
 *  - the five offering slots, filled from g.ritual.off (built with the real item models)
 *  - lit incense smoke (spirals and thickens while summoning), the summoning mist
 *  - a torn flyer stapled to a bamboo stake (hint)
 *  - the ghost's lucky numbers floating where she wrote them (until the next morning)
 * ========================================================================================== */

export interface ShrineFrame { pos: THREE.Vector3; yaw: number; kneel: THREE.Vector3; top: number }

/** table local slot positions (front = +z, toward the players) */
const SLOT: Record<OfferKind, [number, number, number, number]> = {
  red_soda: [-0.33, 0, -0.08, 0.3],
  boiled_eggs: [-0.12, 0, 0.06, 0],
  incense: [0.06, 0.055, -0.1, 0],
  garland: [0.23, 0, 0.1, 0.5],
  zebra_figurine: [0.36, 0, -0.05, 0],
};
const TOP = 0.42;

export function shrineFrame(game: Game): ShrineFrame {
  const a = game.world?.anchor?.('spirit_house')?.p ?? [-8, 0.15, -152];
  // the spirit house faces +x (toward the soi): the table stands in front of it, players kneel in front of that
  const pos = new THREE.Vector3(a[0] + 1.45, a[1], a[2] - 0.45);
  const yaw = Math.PI / 2;
  const kneel = pos.clone().add(new THREE.Vector3(0.95, 0, 0));
  return { pos, yaw, kneel, top: TOP };
}

export class Shrine {
  readonly root = new THREE.Group();
  readonly table = new THREE.Group();
  readonly flyer = new THREE.Group();
  private slots = new Map<OfferKind, THREE.Object3D | null>();
  private mist = new Mist(90, new THREE.Color(0.78, 0.84, 0.9), 0.32);
  private smoke = new Mist(60, new THREE.Color(0.86, 0.86, 0.84), 0.28);
  private t = 0;
  private emitT = 0;
  private mistT = 0;
  private numbers: { key: string; obj: THREE.Group; texts: Text3D[] } | null = null;
  readonly frame: ShrineFrame;
  /** 0..1 how much the summoning mist / smoke spiral is on (set by the ritual FX) */
  storm = 0;

  constructor(private game: Game) {
    this.frame = shrineFrame(game);
    this.root.name = 'ritual';
    this.buildTable();
    this.buildFlyer();
    this.root.add(this.mist.mesh, this.smoke.mesh);
  }

  /** world point of a slot (top of the table) */
  slotWorld(k: OfferKind, out = new THREE.Vector3()) {
    const s = SLOT[k];
    return this.table.localToWorld(out.set(s[0], TOP + s[1], s[2]));
  }
  incenseTip(out = new THREE.Vector3()) { return this.table.localToWorld(out.set(SLOT.incense[0], TOP + 0.055 + 0.3, SLOT.incense[2])); }

  // ------------------------------------------------------------------ models

  private buildTable() {
    const f = this.frame;
    const t = this.table;
    t.position.copy(f.pos);
    t.rotation.y = f.yaw;
    const lacquer = new THREE.MeshPhysicalMaterial({ color: '#7e1410', roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.18, metalness: 0 });
    const gold = new THREE.MeshStandardMaterial({ color: '#c8962e', roughness: 0.32, metalness: 0.95 });
    const wood = Assets.pbr('wood_teak', { color: '#5a1a12', roughness: 0.8 });
    // top (bevelled lacquer slab) + gold edge band
    const top = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.035, 0.5, 3, 0.01), lacquer);
    top.position.y = TOP - 0.0175;
    const band = new THREE.Mesh(new RoundedBoxGeometry(0.915, 0.014, 0.515, 2, 0.005), gold);
    band.position.y = TOP - 0.04;
    t.add(top, band);
    // carved apron: gold kanok pattern painted on red (canvas), all four sides
    const apronTex = (() => {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64;
      const c = cv.getContext('2d')!;
      c.fillStyle = '#6e120e'; c.fillRect(0, 0, 512, 64);
      c.strokeStyle = '#d8a63a'; c.lineWidth = 3; c.strokeRect(4, 6, 504, 52);
      c.fillStyle = '#d8a63a';
      for (let x = 24; x < 512; x += 48) {
        c.beginPath(); c.moveTo(x, 50); c.quadraticCurveTo(x - 14, 30, x, 12); c.quadraticCurveTo(x + 14, 30, x, 50); c.fill();
        c.beginPath(); c.arc(x + 24, 32, 5, 0, 6.28); c.fill();
      }
      const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
      return tx;
    })();
    const apronM = new THREE.MeshStandardMaterial({ map: apronTex, roughness: 0.45, metalness: 0.2 });
    for (const [w, x, z, ry] of [[0.82, 0, 0.235, 0], [0.82, 0, -0.235, Math.PI], [0.43, 0.435, 0, Math.PI / 2], [0.43, -0.435, 0, -Math.PI / 2]] as [number, number, number, number][]) {
      const ap = new THREE.Mesh(new RoundedBoxGeometry(w, 0.07, 0.016, 2, 0.004), [apronM, apronM, wood, wood, apronM, apronM]);
      ap.position.set(x, TOP - 0.085, z); ap.rotation.y = ry;
      t.add(ap);
    }
    // turned legs (lathe) with gold collars, slightly splayed
    const prof = [[0.0001, 0], [0.026, 0], [0.028, 0.02], [0.02, 0.05], [0.018, 0.12], [0.024, 0.16], [0.019, 0.2], [0.016, 0.3], [0.022, 0.33], [0.024, 0.36], [0.0001, 0.36]].map(([x, y]) => new THREE.Vector2(x, y));
    const legG = new THREE.LatheGeometry(prof, 14);
    const collar = new THREE.TorusGeometry(0.023, 0.004, 6, 16);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legG, lacquer);
      leg.position.set(sx * 0.4, 0, sz * 0.21);
      leg.rotation.set(-sz * 0.03, 0, sx * 0.03);
      const c1 = new THREE.Mesh(collar, gold); c1.rotation.x = Math.PI / 2; c1.position.y = 0.16; leg.add(c1);
      const c2 = new THREE.Mesh(collar, gold); c2.rotation.x = Math.PI / 2; c2.position.y = 0.33; leg.add(c2);
      t.add(leg);
    }
    // the incense pot: a silver ขัน full of sand, old burnt stubs stuck in it
    const pot = libModel('khan_bowl');
    pot.position.set(SLOT.incense[0], TOP, SLOT.incense[2]);
    pot.scale.setScalar(0.85);
    t.add(pot);
    const sand = new THREE.Mesh(new THREE.CircleGeometry(0.078, 24), Assets.pbr('gravel_crushed', { color: '#d8c8a0', repeat: 0.3 }));
    sand.rotation.x = -Math.PI / 2; sand.position.set(SLOT.incense[0], TOP + 0.052, SLOT.incense[2]);
    t.add(sand);
    const stubM = new THREE.MeshStandardMaterial({ color: '#a8241c', roughness: 0.7 });
    const stubG = new THREE.CylinderGeometry(0.0015, 0.0015, 0.05, 4);
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Mesh(stubG, stubM);
      const a = i * 2.4, r = 0.015 + (i % 5) * 0.011;
      s.position.set(SLOT.incense[0] + Math.cos(a) * r, TOP + 0.07, SLOT.incense[2] + Math.sin(a) * r);
      s.rotation.set((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4);
      t.add(s);
    }
    // a strip of gold-red cloth runner under the offerings
    const runner = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.22), new THREE.MeshStandardMaterial({ map: apronTex, roughness: 0.8 }));
    runner.rotation.x = -Math.PI / 2; runner.position.set(0, TOP + 0.001, 0.13);
    t.add(runner);
    t.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.root.add(t);
    this.game.interact.register(t, { kind: 'ritual_shrine', data: { name: { th: 'โต๊ะของไหว้ ศาลท้ายซอย', en: 'offering table' } }, reach: 3 });
  }

  private buildFlyer() {
    const f = this.frame;
    const g = this.flyer;
    g.position.copy(f.pos).add(new THREE.Vector3(0.6, 0, -1.25));
    g.rotation.y = f.yaw;
    const bamboo = Assets.pbr('bamboo_poles', { color: '#c8b07a' });
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 1.45, 10), bamboo);
    stake.position.y = 0.72;
    stake.castShadow = true;
    g.add(stake);
    for (const y of [0.32, 0.78, 1.2]) { const n = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.004, 5, 14), bamboo); n.rotation.x = Math.PI / 2; n.position.y = y; g.add(n); }
    const cv = document.createElement('canvas'); cv.width = 400; cv.height = 560;
    const draw = () => {
      const c = cv.getContext('2d')!;
      c.clearRect(0, 0, 400, 560);
      c.fillStyle = '#f2e8cc'; c.beginPath(); c.moveTo(0, 0); c.lineTo(400, 0); c.lineTo(400, 470);
      // torn bottom edge
      for (let x = 400; x >= 0; x -= 20) c.lineTo(x, 470 + Math.sin(x * 0.37) * 30 + (x % 60 === 0 ? 40 : 0));
      c.closePath(); c.fill();
      for (let i = 0; i < 600; i++) { c.fillStyle = `rgba(110,80,40,${Math.random() * 0.06})`; c.fillRect(Math.random() * 400, Math.random() * 470, 2, 1); }
      const gr = c.createRadialGradient(300, 380, 10, 300, 380, 140); gr.addColorStop(0, 'rgba(120,90,40,0.28)'); gr.addColorStop(1, 'rgba(120,90,40,0)'); c.fillStyle = gr; c.fillRect(0, 0, 400, 500);
      c.fillStyle = '#2a1c14'; c.textAlign = 'center';
      FLYER_LINES.forEach((ln, i) => { c.font = `${i === 0 ? 700 : 500} ${i === 0 ? 36 : 25}px ${F.hand}`; c.fillText(ln, 200, 52 + i * 46); });
      c.fillStyle = '#9a9aa0'; c.fillRect(30, 12, 18, 4); c.fillRect(352, 12, 18, 4);
    };
    draw();
    (document as any).fonts?.ready?.then(() => { draw(); tex.needsUpdate = true; });
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.42, 6, 8), new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, transparent: false, side: THREE.DoubleSide, roughness: 0.9 }));
    // a little curl
    const p = paper.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, Math.sin((x + 0.15) * 7) * 0.006 + Math.max(0, -y - 0.1) * 0.08); }
    paper.geometry.computeVertexNormals();
    paper.position.set(0, 1.12, 0.03);
    paper.rotation.z = 0.04;
    paper.castShadow = true;
    g.add(paper);
    this.root.add(g);
    this.game.interact.register(g, { kind: 'ritual_flyer', data: { name: { th: 'ใบปลิวขาดๆ', en: 'torn flyer' } }, reach: 2.6 });
  }

  // ------------------------------------------------------------------ sync from state

  private build(kind: OfferKind, lit: boolean): THREE.Object3D | null {
    const def = this.game.items.def(kind);
    if (!def) return null;
    try {
      const o = def.build({ id: -9000 - OFFER_KINDS.indexOf(kind), t: 'item', k: kind, p: [0, 0, 0], data: kind === 'incense' ? { lit } : def.data?.() ?? {} } as any, this.game);
      o.traverse((m: any) => { if (m.isMesh) { m.castShadow = true; m.raycast = () => {}; } });
      return o;
    } catch { return null; }
  }

  sync(r: RitualState | null) {
    for (const k of OFFER_KINDS) {
      const want = !!r?.off?.[k];
      const have = this.slots.get(k);
      if (want && !have) {
        const o = this.build(k, true);
        if (o) {
          const s = SLOT[k];
          o.position.set(s[0], TOP + s[1], s[2]);
          o.rotation.y = s[3];
          if (k === 'garland') o.rotation.set(0, s[3], 0);
          if (k === 'incense') o.position.y -= 0.06;      // stuck into the sand
          this.table.add(o);
          this.slots.set(k, o);
        }
      } else if (!want && have) {
        have.removeFromParent();
        this.slots.set(k, null);
      }
    }
  }

  /** lucky numbers floating in the air where the ghost wrote them */
  showNumbers(r: RitualState | null, day: number) {
    const n = r?.nums;
    const show = !!n && !r?.drawn && (day < n.day || (day === n.day && (this.game.g.time ?? 7) < 12));
    const key = show ? n!.two + n!.three + (n!.p ?? []).join(',') : '';
    if (this.numbers && this.numbers.key !== key) { this.numbers.obj.removeFromParent(); for (const tx of this.numbers.texts) tx.dispose(); this.numbers = null; }
    if (!show || this.numbers) return;
    const g = new THREE.Group();
    const look = { emissive: 0.9, opacity: 0.88, rim: '#bfe8ff', rimStrength: 0.8, castShadow: false, keyLight: 0.2 } as const;
    const a = text3d('เลขเด็ด… ผีบอก', { font: 'hand', size: 0.13, depth: 0.12, color: '#d8f0ff', side: '#4a6a8a', ...look });
    const b = text3d(n!.two, { font: 'display', size: 0.42, depth: 0.2, color: '#e8fff0', side: '#3a7a5a', ...look });
    const c = text3d(n!.three, { font: 'display', size: 0.24, depth: 0.2, color: '#e8f0ff', side: '#3a4a8a', ...look });
    a.position.y = 0.62; b.position.y = 0.25; c.position.y = -0.12;
    g.add(a, b, c);
    const p = n!.p ?? [this.frame.pos.x, this.frame.pos.y, this.frame.pos.z];
    g.position.set(p[0], p[1] + 1.9, p[2]);
    this.root.add(g);
    this.numbers = { key, obj: g, texts: [a, b, c] };
  }

  tick(dt: number, r: RitualState | null, cam: THREE.Camera) {
    this.t += dt;
    // incense smoke: a lazy thread normally, a tight spiral while summoning
    if (r?.off?.incense) {
      this.emitT -= dt;
      if (this.emitT < 0) {
        this.emitT = this.storm > 0.2 ? 0.04 : 0.16;
        const tip = this.incenseTip();
        const a = this.t * (3 + this.storm * 6);
        const v = new THREE.Vector3(Math.cos(a) * 0.06 * (1 + this.storm * 3), 0.22 + this.storm * 0.5, Math.sin(a) * 0.06 * (1 + this.storm * 3));
        this.smoke.emit(tip, 0.06 + this.storm * 0.12, 3.2, v);
      }
    }
    // summoning mist rolling over the ground
    if (this.storm > 0.05) {
      this.mistT -= dt;
      if (this.mistT < 0) {
        this.mistT = 0.06 / this.storm;
        const a = Math.random() * Math.PI * 2, rr = 1 + Math.random() * 5;
        const p = this.frame.pos.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0.25, Math.sin(a) * rr));
        this.mist.emit(p, 1.4 + Math.random() * 1.6, 5, new THREE.Vector3(-Math.sin(a) * 0.4, 0.05, Math.cos(a) * 0.4));
      }
    }
    this.smoke.update(dt, this.t);
    this.mist.update(dt, this.t);
    // the numbers face the camera and bob
    if (this.numbers) {
      const g = this.numbers.obj;
      const cp = cam.getWorldPosition(new THREE.Vector3());
      g.rotation.y = Math.atan2(cp.x - g.position.x, cp.z - g.position.z);
      g.children.forEach((c, i) => { c.position.x = Math.sin(this.t * 1.3 + i) * 0.03; });
    }
  }

  dispose() {
    this.game.interact.unregister(this.table);
    this.game.interact.unregister(this.flyer);
    this.root.removeFromParent();
    this.mist.dispose(); this.smoke.dispose();
    if (this.numbers) for (const tx of this.numbers.texts) tx.dispose();
  }
}
