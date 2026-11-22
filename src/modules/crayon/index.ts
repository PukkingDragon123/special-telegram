import * as THREE from 'three';
import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Input } from '../../core/input';
import { Sound } from '../../core/audio';
import { T, onLang } from '../../core/lang';
import { asset, tl, round } from '../../core/util';
import { G } from '../../sim/physics';
import { Overlay } from '../../ui3d/overlay';
import { F } from '../../core/fonts';
import { buildCrayon, buildSign, drawSign, colorOf, CRAYON_COLORS, SIGN_W, SIGN_H } from './models';
import { crayonText, CrayonBrush, hashStr } from './wax';
import { crl } from './lines';

/* ============================================================================================
 * MODULE `crayon` — สีเทียน. Everybody gets a crayon after the intro (more at 8-Twelve, 12 ฿).
 *   • [Enter] with a crayon + a cardboard (กองลัง / ลังนอน): write a hand-scrawled sign and hold it up.
 *     Friends see it on your chest (and as a subtitle when you're off-screen / far): talk without a mic.
 *   • hold [LMB] with the crayon at a wall / shutter / parked car / road: freehand graffiti.
 *     [Enter] while aiming at a wall: write words on it.
 *   • vandalism is noticed: a passer-by yells → the owner (or an auntie) comes to fight → a gang with
 *     pistols turns up and can kill you; police get dispatched from the combat module's heat.
 *
 * Entities: item 'crayon' {c: colour idx}, item 'cardboard_sign' {msg, c: hex, s: seed},
 *           't: graffiti' patches {c, n, u, s, ops[]} (replicated, so late joiners see them; session only).
 * Intents:  crayon.write {item, msg} · crayon.draw {pts, n, ns} · crayon.wall {msg, p, n}
 * Events:   crayon:sign {id, msg} · crayon:yell {p, text} · crayon:given {id}
 * ========================================================================================== */

const PATCH = 1.6;            // graffiti patch size (m)
const PX = 512;               // patch canvas size (px)
const REACH = 2.6;
const MAX_MSG = 60;

type Op = { l: 1; c: number; w: number; p: number[] } | { t: string; c: number; x: number; y: number; w: number; h: number; s: number };

const V = (a: ArrayLike<number>) => new THREE.Vector3(a[0], a[1], a[2]);
const clean = (s: string) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_MSG);

function carriedCrayon(game: Game, pl: Ent): Ent | null {
  const sel = game.items.selected(pl);
  if (sel?.k === 'crayon') return sel;
  return game.items.carried(pl).find((e) => e.k === 'crayon') ?? null;
}
function carriedBoard(game: Game, pl: Ent): Ent | null {
  const sel = game.items.selected(pl);
  if (sel && (sel.k === 'cardboard_sign' || sel.k === 'cardboard')) return sel;
  const all = game.items.carried(pl);
  return all.find((e) => e.k === 'cardboard_sign') ?? all.find((e) => e.k === 'cardboard') ?? null;
}

/** patch basis from a surface normal: u = along the wall (horizontal), v = up the wall */
function basis(n: THREE.Vector3) {
  const up = Math.abs(n.y) > 0.8 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(up, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  return { u, v };
}

// ------------------------------------------------------------------ graffiti view (every peer)
function graffitiView(e: Ent, game: Game) {
  const c = document.createElement('canvas'); c.width = c.height = PX;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.62, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(e.s ?? PATCH, e.s ?? PATCH), mat);
  mesh.renderOrder = 3;
  mesh.castShadow = false; mesh.receiveShadow = true;
  const n = V(e.n), u = V(e.u), v = new THREE.Vector3().crossVectors(n, u);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, n));
  mesh.position.copy(V(e.c)).addScaledVector(n, 0.008);
  const brush = new CrayonBrush(c);
  /** points already drawn per op (strokes grow while the player draws: only the new piece is drawn) */
  const done: number[] = [];
  const draw = (ops: Op[]) => {
    const g = c.getContext('2d')!;
    if (ops.length < done.length) { g.clearRect(0, 0, PX, PX); done.length = 0; }
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i] as any;
      const have = done[i] ?? 0;
      if (op.l) {
        if (op.p.length <= have) continue;
        const from = Math.max(0, have - 2);
        brush.stroke(op.p.slice(from), colorOf(op.c).c, op.w, (e.id * 131 + i * 17 + have) >>> 0);
        done[i] = op.p.length;
      } else if (op.t && !have) {
        const tc = document.createElement('canvas'); tc.width = op.w; tc.height = op.h;
        crayonText(tc, op.t, { color: colorOf(op.c).c, seed: op.s, pad: 0.04, weight: 700 });
        g.drawImage(tc, op.x - op.w / 2, op.y - op.h / 2);
        done[i] = 1;
      }
    }
    tex.needsUpdate = true;
  };
  let sig = '';
  return {
    object: mesh,
    update: (e: Ent) => {
      const ops: Op[] = e.ops ?? [];
      const s = ops.length + ':' + ((ops[ops.length - 1] as any)?.p?.length ?? 0);
      if (s !== sig) { sig = s; draw(ops); }
    },
    dispose: () => { mesh.geometry.dispose(); mat.dispose(); tex.dispose(); },
  };
}

// ------------------------------------------------------------------ the writing box (local)
class Writer {
  private el: HTMLDivElement | null = null;
  private inp: HTMLInputElement | null = null;
  private prev: HTMLCanvasElement | null = null;
  private t: any = 0;
  open = false;
  constructor(private game: Game) {}
  show(mode: 'sign' | 'wall', color: string, start: string, onSubmit: (msg: string) => void) {
    this.close();
    this.open = true;
    const el = (this.el = document.createElement('div'));
    const bg = mode === 'sign' ? `url(${asset('textures/props/cardboard_mat_plain.jpg')}) center/cover, #b58c5c` : '#8d8a84';
    el.style.cssText = `position:fixed;left:50%;bottom:16vh;transform:translateX(-50%);z-index:30;display:flex;flex-direction:column;align-items:center;gap:10px;font-family:${F.ui},sans-serif;color:#fff;pointer-events:auto`;
    const pc = (this.prev = document.createElement('canvas'));
    pc.width = 448; pc.height = Math.round(448 * SIGN_H / SIGN_W);
    pc.style.cssText = `width:min(52vw,448px);border-radius:4px;background:${bg};box-shadow:0 10px 30px rgba(0,0,0,.45)`;
    const inp = (this.inp = document.createElement('input'));
    inp.maxLength = MAX_MSG; inp.value = start;
    inp.placeholder = T(mode === 'sign' ? tl('เขียนอะไรดี…', 'write something…') : tl('เขียนกำแพง…', 'write on the wall…'));
    inp.style.cssText = `width:min(52vw,448px);box-sizing:border-box;padding:10px 14px;font:600 20px ${F.ui};border:2px solid #fff;border-radius:6px;background:rgba(10,10,12,.78);color:#fff;outline:none`;
    const hint = document.createElement('div');
    hint.style.cssText = 'font:600 15px/1.2 ' + F.ui + ';text-shadow:0 1px 3px #000;opacity:.9';
    hint.textContent = T(tl('[Enter] เขียน · [Esc] ยกเลิก', '[Enter] write · [Esc] cancel'));
    el.append(pc, inp, hint);
    document.body.appendChild(el);
    const redraw = () => { crayonText(pc, inp.value, { color, seed: hashStr(inp.value), maxSize: pc.height * 0.34, weight: 560 }); };
    redraw();
    inp.addEventListener('input', () => { clearTimeout(this.t); this.t = setTimeout(redraw, 140); Sound.play('paper_rustle', { vol: 0.08, pitch: 1.8 + Math.random() * 0.4 }); });
    inp.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); const v = clean(inp.value); this.close(); if (v) onSubmit(v); }
      else if (ev.key === 'Escape') { ev.preventDefault(); this.close(); }
    });
    inp.addEventListener('blur', () => setTimeout(() => { if (this.open && document.activeElement !== inp) this.close(); }, 150));
    setTimeout(() => inp.focus(), 0);
  }
  close() {
    if (!this.open) return;
    this.open = false;
    clearTimeout(this.t);
    this.inp?.blur();
    this.el?.remove();
    this.el = this.inp = this.prev = null;
  }
}

// ------------------------------------------------------------------ module
let writer: Writer | null = null;
const draw = { on: false, pts: [] as number[], n: null as THREE.Vector3 | null, ns: true, sendT: 0, last: new THREE.Vector3(), moved: 0 };
let scribble: any = null;
let hinted = false;
const _o = new THREE.Vector3(), _d = new THREE.Vector3();

/** host-side vandalism bookkeeping */
interface Vandal { amt: number; tier: number; lastAt: number[]; last: number[] | null; patch: number | null; op: number; }
const vandals = new Map<number, Vandal>();
let hostNow = 0;

function aimSurface(game: Game, reach = REACH): { p: THREE.Vector3; n: THREE.Vector3 } | null {
  const cam = game.camera, me = game.me, phys = game.physics;
  if (!cam || !me?.p || !phys) return null;
  cam.getWorldPosition(_o);
  cam.getWorldDirection(_d);
  const eye = V(me.p); eye.y += 1.6;
  const extra = _o.distanceTo(eye);
  const h = phys.raycast(_o, _d, reach + extra, G.STATIC);
  if (!h) return null;
  if (h.point.distanceTo(eye) > reach + 0.2) return null;
  const n = h.normal.clone().normalize();
  if (n.dot(_d) > 0) n.negate();
  return { p: h.point, n };
}

function hostDraw(game: Game, pl: Ent, d: { pts: number[]; n: number[]; ns?: boolean }) {
  const cr = game.items.selected(pl);
  if (!cr || cr.k !== 'crayon' || !pl.p || !Array.isArray(d?.pts) || !Array.isArray(d.n) || d.pts.length < 3 || d.pts.length > 600) return;
  const N = V(d.n).normalize();
  if (!isFinite(N.x) || N.lengthSq() < 0.5) return;
  const col = cr.data?.c ?? 0;
  let vd = vandals.get(pl.id);
  if (!vd) vandals.set(pl.id, (vd = { amt: 0, tier: 0, lastAt: [0, 0, 0], last: null, patch: null, op: -1 }));
  if (d.ns) { vd.last = null; vd.patch = null; }
  const P = new THREE.Vector3();
  const me = V(pl.p);
  for (let i = 0; i + 2 < d.pts.length; i += 3) {
    P.set(d.pts[i], d.pts[i + 1], d.pts[i + 2]);
    if (!isFinite(P.x) || P.distanceTo(me) > REACH + 2) continue;
    // which patch?
    let patch = vd.patch != null ? game.state.get(vd.patch) : null;
    const inPatch = (g: Ent) => {
      const n = V(g.n);
      if (n.dot(N) < 0.9) return null;
      const rel = P.clone().sub(V(g.c));
      if (Math.abs(rel.dot(n)) > 0.06) return null;
      const u = V(g.u), v = new THREE.Vector3().crossVectors(n, u);
      const x = rel.dot(u) / g.s + 0.5, y = 0.5 - rel.dot(v) / g.s;
      return x > 0.03 && x < 0.97 && y > 0.03 && y < 0.97 ? [Math.round(x * PX), Math.round(y * PX)] : null;
    };
    let uv = patch ? inPatch(patch) : null;
    if (!uv) {
      patch = null;
      for (const g of game.state.all('graffiti')) { if ((g.ops?.length ?? 0) >= 80) continue; uv = inPatch(g); if (uv) { patch = g; break; } }
      if (!patch) {
        const { u } = basis(N);
        patch = game.state.spawn('graffiti', { c: [round(P.x, 3), round(P.y, 3), round(P.z, 3)], n: [round(N.x, 3), round(N.y, 3), round(N.z, 3)], u: [round(u.x, 4), round(u.y, 4), round(u.z, 4)], s: PATCH, ops: [], by: pl.id });
        uv = inPatch(patch);
        if (!uv) continue;
      }
      // continue the line into the new patch from the previous point
      vd.patch = patch.id;
      const op: Op = { l: 1, c: col, w: 4 + (col % 2), p: [] };
      patch.ops = [...(patch.ops ?? []), op];
      vd.op = patch.ops.length - 1;
      if (vd.last) { const P2 = P.clone(); P.set(vd.last[0], vd.last[1], vd.last[2]); const uv0 = inPatch(patch); if (uv0) op.p.push(uv0[0], uv0[1]); P.copy(P2); }
    }
    const op = patch.ops[vd.op] as any;
    if (!op?.l || op.p.length > 1600) { const nop: Op = { l: 1, c: col, w: 4, p: [] }; patch.ops = [...patch.ops, nop]; vd.op = patch.ops.length - 1; }
    const cur = patch.ops[vd.op] as any;
    if (vd.last) vd.amt += Math.min(0.3, Math.hypot(P.x - vd.last[0], P.y - vd.last[1], P.z - vd.last[2]));
    cur.p = [...cur.p, uv[0], uv[1]];
    patch.ops = [...patch.ops];   // new array → replicated
    vd.last = [P.x, P.y, P.z];
  }
  vandalism(game, pl, vd);
}

function hostWall(game: Game, pl: Ent, d: { msg: string; p: number[]; n: number[] }) {
  const cr = carriedCrayon(game, pl);
  const msg = clean(d?.msg);
  if (!cr || !msg || !pl.p || !Array.isArray(d.p) || !Array.isArray(d.n)) return;
  const P = V(d.p), N = V(d.n).normalize();
  if (!isFinite(P.x) || P.distanceTo(V(pl.p)) > REACH + 2) return;
  const { u } = basis(N);
  const e = game.state.spawn('graffiti', { c: [round(P.x, 3), round(P.y, 3), round(P.z, 3)], n: [round(N.x, 3), round(N.y, 3), round(N.z, 3)], u: [round(u.x, 4), round(u.y, 4), round(u.z, 4)], s: PATCH, by: pl.id, ops: [] as Op[] });
  const w = Math.min(PX - 16, 160 + msg.length * 26), h = Math.round(w * 0.5);
  e.ops = [{ t: msg, c: cr.data?.c ?? 0, x: PX / 2, y: PX / 2, w, h, s: hashStr(msg + e.id) }];
  let vd = vandals.get(pl.id);
  if (!vd) vandals.set(pl.id, (vd = { amt: 0, tier: 0, lastAt: [0, 0, 0], last: null, patch: null, op: -1 }));
  vd.amt += 1.2 + msg.length * 0.06;
  game.sfx('paper_rustle', d.p, { vol: 0.6, pitch: 1.7 });
  vandalism(game, pl, vd);
}

/** escalate: someone yells → the owner / an auntie comes to fight → a gang with guns */
function vandalism(game: Game, pl: Ent, vd: Vandal) {
  const host: any = (game as any).combat?.host;
  if (!pl.p) return;
  const P = V(pl.p);
  const crowd: any = (game as any).life?.crowd;
  const npcNear = game.state.all('npc').filter((e) => e.p && e.cbSt !== 'ko' && e.cbSt !== 'dead' && Math.hypot(e.p[0] - P.x, e.p[2] - P.z) < 16);
  const walker = crowd?.find?.(P, 18) ?? null;
  const zone = game.world?.zoneAt(pl.p);
  const t: number = (game.g as any).time ?? 12;
  const night = t < 5 || t >= 22;
  const witnessed = npcNear.length > 0 || !!walker;
  if (!witnessed && Math.random() < 0.85) return;         // nobody saw it (mostly)
  const gangTurf = zone?.kind === 'soi' && night;
  if (vd.tier < 1 && vd.amt > 0.5) {
    vd.tier = 1; vd.lastAt[0] = hostNow;
    const who = npcNear[0];
    if (who) game.say(who.id, crl('notice'), { style: 'shout', duration: 2.6 });
    else game.emit('crayon:yell', { p: walker?.p ?? [P.x, P.y, P.z], text: crl('notice') });
  }
  if (vd.tier < 2 && vd.amt > (gangTurf ? 1.6 : 2.6) && host?.provoke) {
    vd.tier = 2; vd.lastAt[1] = hostNow;
    if (gangTurf) host.provoke(pl, pl.p, { kind: 'thug', n: 2, gun: true, heat: 2, line: crl('gang'), dist: 9 });
    else {
      const auntie = Math.random() < 0.4;
      host.provoke(pl, pl.p, { kind: auntie ? 'auntie' : 'tough', n: 1, heat: 1.5, line: crl(auntie ? 'auntie' : 'owner'), dist: 5 });
    }
  }
  if (vd.tier < 3 && vd.amt > 5.5 && host?.provoke) {
    vd.tier = 3; vd.lastAt[2] = hostNow;
    host.provoke(pl, pl.p, { kind: 'thug', n: 2 + (Math.random() < 0.5 ? 1 : 0), gun: true, heat: 2.5, line: crl('gang'), dist: 11 });
  }
}

function hostWrite(game: Game, pl: Ent, d: { item: number; msg: string }) {
  const msg = clean(d?.msg);
  const it = game.state.get(d?.item);
  const cr = carriedCrayon(game, pl);
  if (!msg || !cr || !it || it.holder !== pl.id || (it.k !== 'cardboard' && it.k !== 'cardboard_sign')) return;
  const color = colorOf(cr.data?.c ?? 0).c;
  const data = { msg, c: color, s: hashStr(msg + it.id) };
  if (it.k === 'cardboard') {
    game.items.remove(it);
    if (!game.items.give(pl, 'cardboard_sign', { data })) return;
  } else it.data = data;
  game.sfx('cardboard', pl.p, { vol: 0.5, pitch: 1.2 });
  game.emit('crayon:sign', { id: pl.id, msg });
  // somebody nearby reads it
  setTimeout(() => {
    if (!pl.p) return;
    const r = game.state.all('npc').filter((e) => e.p && e.cbSt !== 'ko' && e.cbSt !== 'dead' && Math.hypot(e.p[0] - pl.p![0], e.p[2] - pl.p![2]) < 9);
    if (r.length && Math.random() < 0.7) game.say(r[(Math.random() * r.length) | 0].id, crl('readSign'), { style: 'speech', duration: 2.8 });
    else if (Math.random() < 0.5) {
      const w = (game as any).life?.crowd?.find?.(V(pl.p), 10);
      if (w) game.emit('crayon:yell', { p: w.p, text: crl('readSign'), soft: true });
    }
  }, 1800);
}

export default defineModule({
  id: 'crayon',
  deps: ['world'],
  init(game: Game) {
    writer = new Writer(game);
    game.items.define({
      kind: 'crayon', name: tl('สีเทียน', 'crayon'), weight: 0.02, price: 12, tags: ['crayon', 'tool', 'small'],
      shape: { type: 'box', size: [0.09, 0.011, 0.011] }, pickRadius: 0.25,
      data: () => ({ c: (Math.random() * CRAYON_COLORS.length) | 0 }),
      build: (e) => buildCrayon(e.data?.c ?? 0),
      label: (e) => { const c = colorOf(e.data?.c ?? 0); return tl('สีเทียน' + c.th, c.en + ' crayon'); },
      hold: { pos: [0.03, -0.03, -0.1], rot: [0.35, Math.PI / 2 + 0.25, 0.2], scale: 1.4 },
    });
    game.items.define({
      kind: 'cardboard_sign', name: tl('ป้ายลังกระดาษ', 'cardboard sign'), weight: 0.6, carry: 'twohand', tags: ['cardboard', 'sign'], price: 0,
      shape: { type: 'box', size: [SIGN_W, SIGN_H, 0.014] },
      data: () => ({ msg: '', c: '#1d1b1c', s: 1 }),
      build: () => buildSign(),
      refresh: (o, e) => drawSign(o, e.data?.msg ?? '', e.data?.c ?? '#1d1b1c', e.data?.s),
      label: (e) => { const m = String(e.data?.msg ?? ''); const s = m.length > 18 ? m.slice(0, 17) + '…' : m; return m ? tl(`ป้าย “${s}”`, `sign “${s}”`) : tl('ป้ายลังกระดาษ', 'cardboard sign'); },
      hold: { pos: [0, -0.16, -0.2], rot: [-0.12, 0, 0], scale: 0.55 },
    });
    game.registerView('graffiti', graffitiView);

    // ---- host
    game.onIntent('crayon.write', (pl, d) => hostWrite(game, pl, d));
    game.onIntent('crayon.draw', (pl, d) => hostDraw(game, pl, d));
    game.onIntent('crayon.wall', (pl, d) => hostWall(game, pl, d));
    game.events.on('world:exit', () => { vandals.clear(); writer?.close(); });

    // ---- every peer
    game.on('crayon:sign', (d: { id: number; msg: string }) => {
      const me = game.me;
      if (d.id === game.localPlayerId) {
        // hold the new sign up
        setTimeout(() => {
          const m = game.me; if (!m) return;
          const i = (m.inv ?? []).findIndex((id: number | null) => id != null && game.state.get(id)?.k === 'cardboard_sign');
          if (i >= 0) (game.player as any)?.select?.(i);
        }, 120);
        return;
      }
      // a friend's sign: show it as a subtitle when it's off-screen or too far to read
      const pl = game.state.get(d.id);
      if (!pl?.p || !me?.p) return;
      const p = V(pl.p); p.y += 1.5;
      const dist = p.distanceTo(V(me.p));
      if (dist > 60) return;
      const v = p.clone().project(game.camera);
      const off = v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1;
      if (off || dist > 6) (game.ui as any).subtitle?.('✎ ' + d.msg, pl.name, 6);
    });
    game.on('crayon:yell', (d: { p: number[]; text: any; soft?: boolean }) => {
      const p = V(d.p); p.y += 1.85;
      game.ui.say(p, d.text, { style: d.soft ? 'speech' : 'shout', duration: 2.6 });
    });
    game.on('crayon:given', (d: { id: number }) => {
      if (d.id !== game.localPlayerId) return;
      (game as any).hud?.toast?.(tl('มีสีเทียนติดตัว ✎  [Enter] เขียนป้าย · [คลิกค้าง] ขีดเขียน', 'You have a crayon ✎  [Enter] write a sign · [hold click] draw'), { kind: 'info', dur: 6 });
    });
    onLang(() => writer?.close());
  },

  hostUpdate(game: Game, dt: number) {
    hostNow += dt;
    for (const [id, vd] of vandals) {
      vd.amt = Math.max(0, vd.amt - dt * 0.04);
      if (vd.amt < 0.25 && vd.tier > 0 && hostNow - Math.max(...vd.lastAt) > 40) vd.tier = 0;
      if (!game.state.get(id)) vandals.delete(id);
    }
    // everybody gets a crayon once the intro is over
    const g: any = game.g;
    if (g.scene !== 'world' || (g.introStep && g.introStep !== 'done')) return;
    for (const pl of game.players()) {
      if (pl._crayon || !pl.p) continue;
      if (game.items.carried(pl).some((e) => e.k === 'crayon')) { pl._crayon = true; continue; }
      if (game.items.freeSlots(pl) < 2) continue;
      pl._crayon = true;
      if (game.items.give(pl, 'crayon')) game.emit('crayon:given', { id: pl.id });
    }
  },

  frame(game: Game, dt: number) {
    const me = game.me;
    if (!me || game.scenes.currentName !== 'world') { endDraw(game); return; }
    const pl = game.player;
    const playing = pl?.mode === 'play' && Input.locked && !game.ui.choosing && !(game as any).buildActive;
    const held = game.items.selected(me);
    const hasCrayon = !!carriedCrayon(game, me);
    // ---- hint the first time the crayon is in hand
    if (held?.k === 'crayon' && !hinted) {
      hinted = true;
      Overlay.showHint(T(tl('สีเทียน: [คลิกค้าง] ขีดเขียนกำแพง · [Enter] เขียนคำ / เขียนป้ายลัง', 'Crayon: [hold click] draw on walls · [Enter] write words / a cardboard sign')), 6);
    }
    // ---- [Enter]: write (sign or wall)
    if (playing && !writer!.open && (Input.wasPressed('Enter') || Input.wasPressed('NumpadEnter')) && (held?.k === 'crayon' || held?.k === 'cardboard' || held?.k === 'cardboard_sign')) {
      const cr = carriedCrayon(game, me);
      const color = colorOf(cr?.data?.c ?? 0).c;
      const wall = held?.k === 'crayon' ? aimSurface(game) : null;
      const board = carriedBoard(game, me);
      if (!cr) Overlay.showHint(T(tl('ต้องมีสีเทียน (8-Twelve แท่งละ 12 ฿)', 'You need a crayon (8-Twelve, 12 ฿)')), 3);
      else if (wall) {
        const wp = wall.p.clone(), wn = wall.n.clone();
        writer!.show('wall', color, '', (msg) => game.intent('crayon.wall', { msg, p: [round(wp.x, 3), round(wp.y, 3), round(wp.z, 3)], n: [round(wn.x, 3), round(wn.y, 3), round(wn.z, 3)] }));
      } else if (board) {
        const id = board.id;
        writer!.show('sign', color, board.k === 'cardboard_sign' ? String(board.data?.msg ?? '') : '', (msg) => game.intent('crayon.write', { item: id, msg }));
      } else Overlay.showHint(T(tl('ไม่มีลังกระดาษ — ไปหยิบที่กองลัง หรือเล็งกำแพงแล้วกด Enter', 'No cardboard — grab one from the cardboard pile, or aim at a wall and press Enter')), 4);
    }
    // ---- hold LMB with the crayon: draw on what you aim at
    const lmbFree = !game.interact.actions.some((a) => a.key === 'LMB');
    if (playing && hasCrayon && held?.k === 'crayon' && !writer!.open && Input.mouseDown(0) && (draw.on || lmbFree)) {
      const s = aimSurface(game);
      if (!draw.on) { draw.on = true; draw.ns = true; draw.pts = []; draw.n = null; draw.sendT = 0; draw.moved = 0; }
      if (s) {
        if (draw.n && draw.n.dot(s.n) < 0.88) flush(game);
        if (!draw.n) draw.n = s.n.clone();
        const far = draw.pts.length === 0 || s.p.distanceTo(draw.last) > 0.006;
        if (far) {
          if (draw.pts.length) draw.moved += s.p.distanceTo(draw.last);
          draw.pts.push(round(s.p.x, 3), round(s.p.y, 3), round(s.p.z, 3));
          draw.last.copy(s.p);
        }
        // scribble sound while the tip moves
        if (far && !scribble) scribble = Sound.play('scrub_loop', { vol: 0.16, pitch: 1.9, loop: true } as any);
        if (!far && scribble) { scribble.stop?.(0.08); scribble = null; }
      } else if (draw.pts.length) { flush(game); draw.ns = true; }
      draw.sendT += dt;
      if (draw.sendT > 0.1 && draw.pts.length >= 6) flush(game);
    } else endDraw(game);
  },
});

function flush(game: Game) {
  if (draw.pts.length >= 3 && draw.n) {
    game.intent('crayon.draw', { pts: draw.pts, n: [round(draw.n.x, 3), round(draw.n.y, 3), round(draw.n.z, 3)], ns: draw.ns });
    draw.ns = false;
  }
  draw.pts = [];
  draw.n = null;
  draw.sendT = 0;
}
function endDraw(game: Game) {
  if (draw.on) { flush(game); draw.on = false; draw.ns = true; }
  if (scribble) { scribble.stop?.(0.08); scribble = null; }
}
