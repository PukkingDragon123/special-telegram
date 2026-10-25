import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Sound } from '../../core/audio';
import { pickKey } from './util';
import type { CookFX } from './fx';

/* =============================================================================================
 * JUICE — squash & stretch / jiggle springs on top of the rigid bodies, keyed to impact speed,
 * with a matching sound (plap, splat, squish, thud, tok, rattle…) and little particles.
 *  - client-local & never networked: every peer detects impacts from the replicated transform
 *    stream (e.p), so host and clients both get the bounce, the sound and the crumbs
 *  - pick up → tiny squash, put into a container / on the cart → settle, thrown → stretch along
 *    the velocity, landing → squash + wobble; soft things ('heap' child, yolks) jiggle on their own
 * ============================================================================================= */

let FX: CookFX | null = null;
export function setJuiceFX(fx: CookFX) { FX = fx; }

export interface JuiceProfile {
  /** squash spring stiffness / damping */
  k: number; c: number;
  /** squash impulse per m/s of impact */
  squash: number;
  /** rocking wobble gain, spring, damping */
  wob: number; wk: number; wc: number;
  /** stretch per m/s while flying fast */
  stretch: number;
  /** extra jiggle on the 'heap' child / yolks (soft insides) */
  heap?: number;
  /** impact sounds (hard / soft hits), optional layered extra on hard hits */
  snd: string[]; sndSoft?: string[]; extra?: string[]; hard?: number; vol?: number; pitch?: number;
  /** crumbs / flecks on hard hits */
  bits?: { color: number[]; n: number; size?: number; flat?: number };
  /** droplets on hard hits */
  drops?: { color: number; n: number };
  /** pick-up squash strength */
  pick?: number;
  /** Thai onomatopoeia popped (local 3D text) on really hard hits */
  word?: string[];
}

// ------------------------------------------------------------------ sounds (own CC0 / Mixkit files)

const SND: Record<string, string[]> = {
  food_plap: ['plap_1', 'plap_2', 'plap_3'],
  food_splat: ['splat_1', 'splat_2'],
  food_squish: ['squish_1', 'squish_2'],
  food_thud: ['thud_1', 'thud_2', 'thud_3'],
  food_tok: ['tok_1', 'tok_2', 'tok_3'],
  food_shell: ['shell_1', 'shell_2'],
  food_jelly: ['jelly_1', 'jelly_2'],
  food_soft: ['soft_1', 'soft_2', 'soft_3'],
  food_bounce: ['bounce_1'],
  food_rattle: ['rattle_1', 'rattle_2'],
};
const SND_VOL: Record<string, number> = { food_plap: 0.85, food_splat: 0.55, food_squish: 0.6, food_thud: 0.9, food_tok: 0.6, food_shell: 0.55, food_jelly: 0.45, food_soft: 0.7, food_bounce: 0.6, food_rattle: 0.6 };

/** Register the food impact sounds as Sound keys (the shared manifest is read-only for modules). */
export function registerFoodSounds() {
  for (const [k, files] of Object.entries(SND)) {
    if (Sound.manifest[k]) continue;
    (Sound.manifest as any)[k] = { files: files.map((f) => `../gen/cooking/audio/${f}.mp3`), vol: SND_VOL[k] ?? 0.7, cat: 'sfx', pitchVar: 0.09, desc: 'food impact (cooking module)' };
  }
  Sound.preload(Object.keys(SND));
}

// ------------------------------------------------------------------ profiles

const P = (p: JuiceProfile) => p;
export const JP = {
  meat: P({ k: 150, c: 6.5, squash: 0.055, wob: 0.16, wk: 85, wc: 4.5, stretch: 0.05, heap: 0.9, snd: ['food_plap'], sndSoft: ['food_soft', 'drop_soft'], extra: ['food_jelly'], hard: 1.8, vol: 0.95, bits: { color: [0xd98a86, 0xbf6a64, 0xf2b8ae], n: 5, size: 0.0045 }, pick: 1.3, word: ['แปะ!', 'ตุบ!'] }),
  shrimp: P({ k: 170, c: 7, squash: 0.05, wob: 0.15, wk: 90, wc: 5, stretch: 0.05, heap: 1.4, snd: ['food_plap'], sndSoft: ['food_soft'], vol: 0.8, bits: { color: [0xe8c0b0, 0xd89a8a], n: 4, size: 0.004 }, word: ['แปะ!'] }),
  herb: P({ k: 110, c: 5.5, squash: 0.07, wob: 0.24, wk: 55, wc: 3.5, stretch: 0.07, heap: 0.7, snd: ['food_squish'], sndSoft: ['food_soft'], vol: 0.55, bits: { color: [0x3f7f24, 0x5a9a30, 0x78b040], n: 7, size: 0.006, flat: 0.15 }, pick: 1.4, word: ['ฟึ่บ!'] }),
  veg: P({ k: 150, c: 6, squash: 0.06, wob: 0.18, wk: 70, wc: 4.5, stretch: 0.06, heap: 0.8, snd: ['food_squish', 'food_soft'], sndSoft: ['food_soft'], vol: 0.6, bits: { color: [0x4f8a2c, 0x6aa040], n: 5, size: 0.005, flat: 0.3 }, word: ['ฟึ่บ!'] }),
  chili: P({ k: 360, c: 8, squash: 0.05, wob: 0.13, wk: 190, wc: 7, stretch: 0.08, heap: 0.6, snd: ['food_rattle'], sndSoft: ['food_tok'], extra: ['plastic_bag_rustle'], hard: 2.0, vol: 0.7, pitch: 1.15, bits: { color: [0xd8261a, 0xb81a10, 0x5a9a2a], n: 3, size: 0.0035 }, word: ['ดึ๋ง!', 'เด้ง!'] }),
  bulb: P({ k: 320, c: 9, squash: 0.04, wob: 0.11, wk: 170, wc: 7, stretch: 0.05, heap: 0.5, snd: ['food_tok', 'food_rattle'], sndSoft: ['food_tok'], vol: 0.65, bits: { color: [0xe8dcc0, 0xc9a070], n: 3, size: 0.003 }, word: ['ป๊อก!', 'เด้ง!'] }),
  egg: P({ k: 420, c: 10, squash: 0.03, wob: 0.14, wk: 240, wc: 6, stretch: 0.07, snd: ['food_shell'], sndSoft: ['food_tok'], vol: 0.6, pitch: 1.2, pick: 0.8, word: ['ก๊อก!'] }),
  eggTray: P({ k: 260, c: 10, squash: 0.03, wob: 0.08, wk: 160, wc: 8, stretch: 0.02, snd: ['cardboard', 'food_soft'], extra: ['food_shell'], vol: 0.7 }),
  glass: P({ k: 650, c: 16, squash: 0.012, wob: 0.07, wk: 320, wc: 9, stretch: 0.025, snd: ['drop_glass'], sndSoft: ['drop_glass', 'food_tok'], vol: 0.8, drops: { color: 0x3a1c08, n: 0 }, word: ['เคร้ง!'] }),
  plastic: P({ k: 420, c: 12, squash: 0.02, wob: 0.09, wk: 220, wc: 8, stretch: 0.03, snd: ['drop_plastic'], sndSoft: ['drop_plastic'], vol: 0.8, word: ['ป๊อก!'] }),
  packet: P({ k: 130, c: 6, squash: 0.065, wob: 0.12, wk: 75, wc: 5.5, stretch: 0.04, snd: ['food_thud', 'drop_soft'], sndSoft: ['food_soft'], extra: ['sprinkle'], hard: 2.4, vol: 0.85, word: ['ตุบ!'] }),
  sack: P({ k: 85, c: 6, squash: 0.08, wob: 0.06, wk: 50, wc: 5, stretch: 0.02, snd: ['food_thud'], sndSoft: ['drop_soft'], extra: ['body_thud'], hard: 2.5, vol: 1, pick: 1.6, word: ['ตุ้บ!!'] }),
  metal: P({ k: 900, c: 22, squash: 0.008, wob: 0.06, wk: 380, wc: 6, stretch: 0.02, snd: ['drop_metal'], sndSoft: ['drop_metal'], vol: 0.75, word: ['แก๊ง!'] }),
  wok: P({ k: 700, c: 18, squash: 0.012, wob: 0.07, wk: 260, wc: 5, stretch: 0.015, heap: 0.8, snd: ['drop_metal'], extra: ['wok_toss'], hard: 3, vol: 0.9, word: ['โครม!'] }),
  plate: P({ k: 700, c: 12, squash: 0.012, wob: 0.09, wk: 420, wc: 2.8, stretch: 0.02, snd: ['plate_down', 'dishes_stack'], sndSoft: ['plate_down'], vol: 0.7, word: ['กริ๊ง!'] }),
  foam: P({ k: 200, c: 8, squash: 0.04, wob: 0.1, wk: 120, wc: 6, stretch: 0.03, snd: ['food_soft', 'drop_plastic'], vol: 0.5 }),
  wood: P({ k: 650, c: 18, squash: 0.01, wob: 0.05, wk: 260, wc: 8, stretch: 0.01, snd: ['drop_wood'], vol: 0.85, word: ['ป้อก!'] }),
  clay: P({ k: 700, c: 20, squash: 0.008, wob: 0.04, wk: 260, wc: 10, stretch: 0.01, snd: ['drop_wood', 'body_thud'], extra: ['body_thud'], hard: 2.5, vol: 0.9, word: ['ตุ้บ!'] }),
  dish: P({ k: 260, c: 8, squash: 0.035, wob: 0.13, wk: 150, wc: 4.5, stretch: 0.03, heap: 1.1, snd: ['plate_down'], sndSoft: ['plate_down'], extra: ['food_splat'], hard: 1.6, vol: 0.75, bits: { color: [0xf4efe4, 0xe8e0cc, 0x6a3a1c], n: 6, size: 0.003 }, word: ['แปะ!'] }),
  paper: P({ k: 200, c: 9, squash: 0.03, wob: 0.06, wk: 120, wc: 8, stretch: 0.02, snd: ['paper_rustle', 'drop_soft'], vol: 0.6 }),
  appliance: P({ k: 600, c: 18, squash: 0.01, wob: 0.04, wk: 220, wc: 9, stretch: 0.01, snd: ['drop_metal', 'body_thud'], vol: 0.9 }),
};
export type JuiceKind = keyof typeof JP;

// ------------------------------------------------------------------ state

interface JState {
  s: number; sv: number;          // squash spring (negative = squashed)
  wx: number; wz: number; wvx: number; wvz: number;   // rocking wobble
  hs: number; hv: number;          // soft-insides spring
  st: number;                      // stretch
  px: number; py: number; pz: number; vx: number; vy: number; vz: number; acc: number; has: boolean;
  holder: number | null; inC: number | null; cool: number; pend: number; pendHit: number; pvx: number; pvz: number;
  jA: THREE.Group; jB: THREE.Group; ident: boolean;
  heap: THREE.Object3D[] | null; h: number;
}

const _v = new THREE.Vector3(), _ax = new THREE.Vector3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _qw = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function initState(obj: THREE.Object3D, e: Ent): JState {
  // wrap the visual: obj → jA → jB → original children (jA·jB = axis-aligned squash about a pivot)
  const jA = new THREE.Group(), jB = new THREE.Group();
  jA.name = 'juiceA'; jB.name = 'juiceB';
  for (const c of [...obj.children]) jB.add(c);
  jA.add(jB);
  obj.add(jA);
  const box = new THREE.Box3().setFromObject(jB);
  const h = box.isEmpty() ? 0.05 : Math.max(0.01, (box.max.y - Math.max(0, box.min.y)) / 2);
  return {
    s: 0, sv: 0, wx: 0, wz: 0, wvx: 0, wvz: 0, hs: 0, hv: 0, st: 0,
    px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, acc: 0, has: false,
    holder: e.holder ?? null, inC: e.in ?? null, cool: 0.3, pend: 0, pendHit: 0, pvx: 0, pvz: 0,
    jA, jB, ident: true, heap: null, h,
  };
}

function softParts(obj: THREE.Object3D, st: JState) {
  if (!st.heap) {
    const out: THREE.Object3D[] = [];
    obj.traverse((o) => { if (o.name === 'heap' || o.name === 'yolk' || o.name === 'dishfood') out.push(o); });
    st.heap = out;
  }
  return st.heap;
}

/** External kick (wok toss, plating, cart placement…): squash amount (−) / stretch (+), wobble, insides. */
export function juiceKick(obj: THREE.Object3D, squash: number, wob = 0, insides = 0) {
  const st = obj.userData.jz as JState | undefined;
  if (!st) { obj.userData.jzPending = [(obj.userData.jzPending?.[0] ?? 0) + squash, wob, insides]; return; }
  st.sv += squash * 10;
  st.wvx += (Math.random() - 0.5) * wob * 4; st.wvz += (Math.random() - 0.5) * wob * 4;
  st.hv += insides * 10;
  st.heap = null; // re-scan soft parts (dish food may have been rebuilt)
}

/**
 * Per-frame juice for an item visual. Call from the item's animate hook AFTER the hook has set the
 * visual's own position/rotation for this frame.
 */
export function juice(obj: THREE.Object3D, e: Ent, dt: number, game: Game, prof: JuiceProfile | undefined) {
  if (!prof) return;
  let st = obj.userData.jz as JState | undefined;
  if (!st) {
    st = obj.userData.jz = initState(obj, e);
    const pk = obj.userData.jzPending;
    if (pk) { juiceKick(obj, pk[0], pk[1], pk[2]); obj.userData.jzPending = null; }
  }
  dt = Math.min(dt, 0.1);
  // ---- state transitions → squash kicks
  const holder = e.holder ?? null, inC = e.in ?? null;
  if (holder !== st.holder) {
    if (holder != null) { st.sv -= 2.2 * (prof.pick ?? 1); st.wvx += (Math.random() - 0.5) * 3 * prof.wob; st.wvz += (Math.random() - 0.5) * 3 * prof.wob; st.hv -= 1.5 * (prof.heap ?? 0); }
    st.holder = holder;
    st.has = false;
  }
  if (inC !== st.inC) {
    if (inC != null) { st.sv -= 1.5; st.wvx += (Math.random() - 0.5) * 2.5 * prof.wob; st.wvz += (Math.random() - 0.5) * 2.5 * prof.wob; st.hv -= 1.2 * (prof.heap ?? 0); }
    st.inC = inC;
    st.has = false;
  }
  // ---- free: impacts from the replicated transform stream
  let stretchT = 0;
  const free = holder == null && inC == null;
  if (free && e.p) {
    st.acc += dt;
    const p = e.p;
    if (p[0] !== st.px || p[1] !== st.py || p[2] !== st.pz) {
      if (st.has && st.acc < 0.3) {
        const k = 1 / Math.max(1 / 240, st.acc);
        const vx = (p[0] - st.px) * k, vy = (p[1] - st.py) * k, vz = (p[2] - st.pz) * k;
        const dvy = vy - st.vy, dvh = Math.hypot(vx - st.vx, vz - st.vz);
        let hit = 0;
        if (st.vy < -0.6 && dvy > 0.55) hit = Math.min(9, -st.vy * 0.85 + dvh * 0.3);
        else if (dvh > 1.7) hit = Math.min(6, dvh * 0.5);
        if (hit > 0.45 && st.cool <= 0 && st.pend <= 0) {
          // the visual follows e.p ~50 ms behind → land the squash when the mesh actually lands
          st.pend = 0.05; st.pendHit = hit; st.pvx = st.vx; st.pvz = st.vz;
        }
        st.vx = vx; st.vy = vy; st.vz = vz;
      } else { st.vx = st.vy = st.vz = 0; }
      st.px = p[0]; st.py = p[1]; st.pz = p[2]; st.acc = 0; st.has = true;
    } else if (st.acc > 0.25) { st.vx = st.vy = st.vz = 0; }
    const sp = Math.hypot(st.vx, st.vy, st.vz);
    if (sp > 2.2 && st.acc < 0.2) stretchT = Math.min(0.3, (sp - 2) * prof.stretch);
  } else { st.vx = st.vy = st.vz = 0; }
  st.cool -= dt;
  if (st.pend > 0) { st.pend -= dt; if (st.pend <= 0) impact(obj, st, prof, st.pendHit, st.pvx, st.pvz, game); }
  // ---- springs (sub-stepped: stiff springs at low fps)
  const n = Math.min(12, Math.ceil(dt * 150)), h = dt / Math.max(1, n);
  const hk = prof.k * 0.55, hc = prof.c * 0.6;
  for (let i = 0; i < n; i++) {
    st.sv += (-prof.k * st.s - prof.c * st.sv) * h; st.s += st.sv * h;
    st.wvx += (-prof.wk * st.wx - prof.wc * st.wvx) * h; st.wx += st.wvx * h;
    st.wvz += (-prof.wk * st.wz - prof.wc * st.wvz) * h; st.wz += st.wvz * h;
    st.hv += (-hk * st.hs - hc * st.hv) * h; st.hs += st.hv * h;
  }
  st.s = Math.max(-0.42, Math.min(0.42, st.s));
  st.wx = Math.max(-0.5, Math.min(0.5, st.wx)); st.wz = Math.max(-0.5, Math.min(0.5, st.wz));
  st.hs = Math.max(-0.45, Math.min(0.45, st.hs));
  st.st += (stretchT - st.st) * (1 - Math.exp(-14 * dt));
  // ---- apply
  const active = Math.abs(st.s) + st.st + Math.abs(st.wx) + Math.abs(st.wz) > 0.0006;
  if (active) {
    // axis in the visual's local frame: velocity while stretching, else world up
    obj.getWorldQuaternion(_qw);
    _qi.copy(_qw).invert();
    if (st.st > 0.01) _ax.set(st.vx, st.vy, st.vz).normalize().applyQuaternion(_qi);
    else _ax.copy(UP).applyQuaternion(_qi);
    if (_ax.lengthSq() < 0.5) _ax.copy(UP);
    const a = Math.max(0.55, 1 + st.s + st.st), b = 1 / Math.sqrt(a);
    _q.setFromUnitVectors(UP, _ax);
    const pv = st.h * Math.min(1, st.st * 8);
    st.jA.position.set(0, pv, 0);
    st.jA.quaternion.copy(_q);
    st.jA.scale.set(b, a, b);
    _qi.copy(_q).invert();
    st.jB.quaternion.copy(_qi);
    st.jB.position.set(0, -pv, 0).applyQuaternion(_qi);
    obj.rotation.x += st.wx;
    obj.rotation.z += st.wz;
    st.ident = false;
  } else if (!st.ident) {
    st.jA.position.set(0, 0, 0); st.jA.quaternion.identity(); st.jA.scale.set(1, 1, 1);
    st.jB.position.set(0, 0, 0); st.jB.quaternion.identity();
    st.ident = true;
  }
  // soft insides (meat in its tray, leaves, yolk, food on a plate)
  if (prof.heap) {
    const hs = st.hs;
    for (const o of softParts(obj, st)) {
      const bs = (o.userData.bs as THREE.Vector3 | undefined);
      const bx = bs?.x ?? 1, by = bs?.y ?? 1, bz = bs?.z ?? 1;
      const yolk = o.name === 'yolk' ? 1.6 : 1;
      o.scale.set(bx * (1 - hs * 0.45 * yolk), by * (1 + hs * yolk), bz * (1 - hs * 0.45 * yolk));
      if (o.name === 'yolk') { o.rotation.x = st.wx * 1.5 + hs * 0.3; o.rotation.z = st.wz * 1.5; }
    }
  }
}

let wordT = 0;
function impact(obj: THREE.Object3D, st: JState, prof: JuiceProfile, hit: number, vx: number, vz: number, game: Game) {
  st.cool = 0.09;
  st.sv -= hit * prof.squash * 7;
  const hv = Math.hypot(vx, vz);
  const dx = hv > 0.05 ? vx / hv : Math.random() - 0.5, dz = hv > 0.05 ? vz / hv : Math.random() - 0.5;
  st.wvx += dz * hit * prof.wob * 2.2 + (Math.random() - 0.5) * hit * prof.wob;
  st.wvz += -dx * hit * prof.wob * 2.2 + (Math.random() - 0.5) * hit * prof.wob;
  st.hv -= hit * (prof.heap ?? 0) * 0.9;
  const pos = obj.getWorldPosition(_v);
  const hard = hit > (prof.hard ?? 2.2);
  const keys = hard ? prof.snd : prof.sndSoft ?? prof.snd;
  const vol = Math.min(1, 0.22 + hit / 4.5) * (prof.vol ?? 0.8);
  Sound.play(pickKey(keys), { pos, vol, pitch: (prof.pitch ?? 1) * (1.12 - Math.min(0.28, hit * 0.045)) });
  if (prof.extra && hard) Sound.play(pickKey(prof.extra), { pos, vol: vol * 0.6, delay: 0.02 });
  if (FX && prof.bits && hit > 1.4) {
    FX.bits(pos.clone().add(new THREE.Vector3(0, 0.01, 0)), prof.bits.color, Math.round(prof.bits.n * Math.min(2.2, hit / 2.4)),
      { speed: 0.35 + hit * 0.16, up: 0.5 + hit * 0.28, size: prof.bits.size, floor: pos.y + 0.001, flat: prof.bits.flat, spread: 0.05 });
  }
  if (FX && prof.drops && prof.drops.n > 0 && hit > 2.2) FX.droplets(pos, prof.drops.color, prof.drops.n, { floor: pos.y + 0.001 });
  // a comic Thai sound-word on really hard hits (local 3D text, rate-limited)
  const now = performance.now() / 1000;
  if (prof.word && hit > 3.2 && now - wordT > 0.6) {
    wordT = now;
    try { game.ui?.popup(pos.clone().add(new THREE.Vector3(0, 0.12, 0)), prof.word[Math.floor(Math.random() * prof.word.length)], { scale: 0.45, dur: 0.85, rise: 0.3 }); } catch { /* ui not ready */ }
  }
}
