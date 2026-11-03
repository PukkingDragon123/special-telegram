import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Input } from '../../core/input';
import { Sound } from '../../core/audio';
import { tl } from '../../core/util';
import { G } from '../../sim/physics';
import { text3d, type Text3D } from '../../ui3d/text3d';
import type { TagHandle } from '../../ui3d/bubbles';
import { footprintOf, isFurniture, FURN_BY_KIND, type Footprint } from './catalog';
import { check, blockers, floorAt, ceilingAt, yawOfQ, WHY_TEXT, type Why } from './place';
import { TABLE_SIZE } from '../restaurant/furniture';

/* =============================================================================================
 * BUILD MODE (client) — โหมดจัดร้าน.
 *   B toggles; holding a furniture piece + click also enters it.
 *   Placing (a piece in your hands): a translucent GHOST follows the crosshair on the floor (or the wall / ceiling /
 *   counter top it mounts on), with a glowing footprint grid. Green = fits, red = blocked (reason floats above it).
 *   Snaps to a 10 cm grid (hold Shift for free placement), slides flush against walls (cabinets, fridges,
 *   counters…), stools & chairs snap around tables facing them, tables line up with neighbouring tables.
 *   R = rotate 90° (Shift+R back), mouse wheel = 15° steps, click = place (thunk, dust puff, squash bounce).
 *   Arranging (empty hands): look at placed furniture → click-and-HOLD to lift it and drag it around (everyone
 *   sees it float), release to drop; R rotates it in place, E lifts it into your arms, X sells it back (50 %).
 * The host validates every move (intents build.*) with the same footprint maths (place.ts).
 * ============================================================================================= */

const GRID = 0.1;
const WALL_SNAP_ROLES = new Set(['storage', 'appliance', 'counter']);
const _ray = new THREE.Raycaster();
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector2();

type Target = { pos: THREE.Vector3; yaw: number; why: Why };

export class BuildMode {
  active = false;
  yaw = 0;
  private ghosts = new Map<string, THREE.Group>();
  private ghost: THREE.Group | null = null;
  private ghostKind = '';
  private okMat = new THREE.MeshStandardMaterial({ color: 0x5cff9a, emissive: 0x2ad070, emissiveIntensity: 0.55, roughness: 0.6, transparent: true, opacity: 0.42, depthWrite: false });
  private badMat = new THREE.MeshStandardMaterial({ color: 0xff5a4a, emissive: 0xd02818, emissiveIntensity: 0.6, roughness: 0.6, transparent: true, opacity: 0.42, depthWrite: false });
  private pad: THREE.Mesh;
  private padMat: THREE.MeshBasicMaterial;
  private target: Target | null = null;
  private drag: { id: number; kind: string; t: number } | null = null;
  private hover: Ent | null = null;
  private hint: Text3D | null = null;
  private hintKey = '';
  private title: Text3D | null = null;
  private tag: TagHandle | null = null;
  private tagText = '';
  private shake = 0;
  private lastHeld: number | null = null;
  private autoYaw = false;
  readonly root = new THREE.Group();

  constructor(private game: Game) {
    this.root.name = 'build-mode';
    // footprint pad: 10 cm grid with a bright rim (canvas texture, tinted green / red)
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const x = cv.getContext('2d')!;
    x.clearRect(0, 0, 256, 256);
    x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 2;
    for (let i = 0; i <= 10; i++) { const t = (i / 10) * 256; x.beginPath(); x.moveTo(t, 0); x.lineTo(t, 256); x.stroke(); x.beginPath(); x.moveTo(0, t); x.lineTo(256, t); x.stroke(); }
    x.strokeStyle = 'rgba(255,255,255,1)'; x.lineWidth = 12; x.strokeRect(6, 6, 244, 244);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    this.padMat = new THREE.MeshBasicMaterial({ map: tex, color: 0x5cff9a, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.pad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.padMat);
    this.pad.renderOrder = 3;
    this.root.add(this.pad);
    this.pad.visible = false;
  }

  // ------------------------------------------------------------------ lifecycle

  toggle(on = !this.active) {
    const g = this.game;
    if (on === this.active) return;
    this.active = on;
    (g as any).buildActive = on;
    if (on) {
      if (!this.root.parent) g.scene?.add(this.root);
      Sound.play('whoosh_text', { vol: 0.35, pitch: 1.2 });
      g.interact.hintOnce('build', 'โหมดจัดร้าน: ถือเฟอร์นิเจอร์แล้วคลิกวาง · คลิกค้างที่ของเพื่อลากย้าย');
    } else {
      if (this.drag) this.cancelDrag();
      this.hideGhost();
      this.tag?.remove(); this.tag = null; this.tagText = '';
      this.setHint('');
      Sound.play('whoosh_text', { vol: 0.25, pitch: 0.8 });
    }
  }

  dispose() { this.toggle(false); this.root.removeFromParent(); this.hint?.dispose(); this.title?.dispose(); this.hint = this.title = null; }

  // ------------------------------------------------------------------ ghosts

  private ghostFor(kind: string): THREE.Group {
    let gh = this.ghosts.get(kind);
    if (gh) return gh;
    const def = this.game.items.def(kind);
    gh = new THREE.Group(); gh.name = 'ghost:' + kind;
    try {
      const fake = { id: -1, t: 'item', k: kind, p: [0, 0, 0], data: def?.data?.() ?? {} } as any;
      const o = def!.build(fake, this.game);
      gh.add(o);
    } catch (e) { console.warn('[build] ghost', kind, e); }
    this.ghosts.set(kind, gh);
    return gh;
  }
  /** library models fill in async: keep re-skinning new meshes with the ghost material */
  private skin(gh: THREE.Group, ok: boolean) {
    const m = ok ? this.okMat : this.badMat;
    gh.traverse((o: any) => {
      if (!o.isMesh) return;
      if (o.material !== m) { o.material = m; o.castShadow = false; o.receiveShadow = false; o.raycast = () => {}; }
    });
  }
  private hideGhost() { if (this.ghost) this.ghost.visible = false; this.pad.visible = false; }

  // ------------------------------------------------------------------ hints (floating 3D text under the crosshair)

  private setHint(text: string, titled = true) {
    if (text === this.hintKey) { if (this.title) this.title.visible = titled; return; }
    this.hintKey = text;
    const cam = this.game.engine.camera;
    if (!text) { this.hint?.removeFromParent(); this.title?.removeFromParent(); return; }
    if (!this.hint) {
      this.hint = text3d(text, { font: 'ui', size: 0.0135, color: 0xfff6e2, side: 0x3a2a12, emissive: 0.9, align: 'center', maxWidth: 0.62, xray: true, depth: 0.12, castShadow: false });
      this.title = text3d('โหมดจัดร้าน · BUILD', { font: 'heavy', size: 0.02, color: 0xffd25a, side: 0x5a3008, emissive: 0.9, align: 'center', xray: true, depth: 0.15, castShadow: false });
    } else this.hint.setText(text);
    if (this.hint.parent !== cam) { cam.add(this.hint); cam.add(this.title!); }
    this.hint.position.set(0, -0.255, -0.72);
    this.title!.position.set(0, 0.29, -0.72);
    this.title!.visible = titled;
  }

  // ------------------------------------------------------------------ frame

  frame(dt: number) {
    const g = this.game;
    const me = g.me;
    const pl = g.player;
    if (!me || !pl || !g.scene) return;
    // B toggles (only while walking around freely)
    if (pl.mode === 'play' && !g.ui.choosing && Input.wasPressed('KeyB')) { Input.consume('KeyB'); this.toggle(); }
    const held = g.items.selected(me);
    const heldKind = held && isFurniture(held.k) && !held.unpaid && !held.disp ? held.k : null;
    // implicit placing preview while you hold a (paid) furniture piece; full arranging only in build mode (B)
    const live = this.active || !!heldKind || !!this.drag;
    if (!live || pl.mode !== 'play' || g.ui.choosing) {
      this.hideGhost();
      if (!live) { this.tagSet(null, ''); this.setHint(''); this.target = null; this.hover = null; }
      return;
    }
    if (!this.root.parent) g.scene.add(this.root);   // the implicit preview (holding a piece) needs it too, not only B
    if (held?.id !== this.lastHeld) { this.lastHeld = held?.id ?? null; if (heldKind) { this.yaw = this.snapYawToPlayer(); this.autoYaw = true; } }
    const shift = Input.isDown('ShiftLeft') || Input.isDown('ShiftRight');
    // rotation: R (unless you're aiming at a person / shop to haggle), wheel only in build mode (else it switches slots)
    const busyTarget = !this.active && g.interact.current && g.interact.current.kind !== 'item';
    if (!busyTarget && Input.wasPressed('KeyR')) { Input.consume('KeyR'); this.rotate((shift ? -1 : 1) * Math.PI / 2); }
    if (this.active && Input.wheel) { this.rotate(Input.wheel * (Math.PI / 12)); Input.wheel = 0; }

    const kind = this.drag?.kind ?? heldKind;
    if (kind) this.placing(kind, held, shift, dt);
    else this.selecting();
    // hint text
    const f = kind ? FURN_BY_KIND[kind] : null;
    const name = kind ? (g.items.def(kind)?.name.th ?? kind) : '';
    this.setHint(this.drag
      ? `ลาก ${name}  ·  ปล่อยคลิก = วาง  ·  [R] หมุน 90°  ·  [ล้อเมาส์] หมุน 15°  ·  [Shift] ไม่ล็อกกริด`
      : heldKind
        ? `${name}${f ? '  ฿' + f.price.toLocaleString() : ''}  ·  [คลิก] วาง  ·  [R] หมุน 90°${this.active ? '  ·  [ล้อเมาส์] หมุนละเอียด' : ''}  ·  [Shift] วางอิสระ  ·  ${this.active ? '[B] ออก' : '[B] โหมดจัดร้าน'}`
        : `เล็งของแล้ว [คลิกค้าง] ลากย้าย  ·  [R] หมุน  ·  [E] ยกขึ้น  ·  [X] ขายคืน 50%  ·  [B] ออก`, this.active);
    // shake the ghost after a refused click
    if (this.ghost && this.shake > 0) { this.shake = Math.max(0, this.shake - dt); this.ghost.position.x += Math.sin(this.shake * 70) * this.shake * 0.08; }
  }

  private rotate(d: number) {
    this.autoYaw = false;
    if (this.drag || this.target || !this.hover) { this.yaw = normYaw(this.yaw + d); Sound.play('plastic_chair_scrape', { vol: 0.12, pitch: 1.6 }); return; }
    if (this.hover) this.game.intent('build.rotate', { id: this.hover.id, d });
  }

  private snapYawToPlayer() {
    const p = this.game.player!;
    // face the player (things are placed facing you), rounded to 90°
    return normYaw(Math.round((p.yaw + Math.PI) / (Math.PI / 2)) * (Math.PI / 2));
  }

  // ------------------------------------------------------------------ placing (held piece or dragged piece)

  private placing(kind: string, held: Ent | null, shift: boolean, _dt: number) {
    const g = this.game;
    const f = footprintOf(kind)!;
    const t = this.aim(kind, f, shift);
    this.target = t;
    // ghost
    if (this.ghostKind !== kind) { if (this.ghost) this.ghost.visible = false; this.ghost = this.ghostFor(kind); this.ghostKind = kind; this.root.add(this.ghost); }
    const gh = this.ghost!;
    if (!t) { this.hideGhost(); this.tagSet(null, ''); return; }
    gh.visible = true;
    const ok = !t.why;
    this.skin(gh, ok);
    gh.position.lerp(t.pos, gh.position.distanceTo(t.pos) > 1.5 ? 1 : 0.45);
    const cy = gh.rotation.y, dy = Math.atan2(Math.sin(t.yaw - cy), Math.cos(t.yaw - cy));
    gh.rotation.y = cy + dy * 0.5;
    // footprint pad (floor & top pieces)
    this.pad.visible = f.mount === 'floor' || f.mount === 'top';
    if (this.pad.visible) {
      this.pad.scale.set(f.size[0] + 0.06, 1, f.size[2] + 0.06);
      this.pad.position.set(gh.position.x, t.pos.y + 0.012, gh.position.z);
      this.pad.rotation.y = gh.rotation.y;
      this.padMat.color.set(ok ? 0x5cff9a : 0xff5a4a);
    }
    const label = (g.items.def(kind)?.name.th ?? kind) + (ok ? '' : '  ✗ ' + WHY_TEXT[t.why!].th);
    this.tagSet(t.pos.clone().setY(t.pos.y + f.size[1] + 0.25), label, ok ? (g.items.def(kind)?.name.en ?? '') : WHY_TEXT[t.why!].en);
    const pos = [+t.pos.x.toFixed(3), +t.pos.y.toFixed(3), +t.pos.z.toFixed(3)];
    if (this.drag) {
      // stream the drag so everyone sees the piece float along
      const now = performance.now();
      if (now - this.drag.t > 100) { this.drag.t = now; g.intent('build.drag', { id: this.drag.id, pos, yaw: t.yaw }); }
      if (Input.mouseReleased(0) || !Input.mouseDown(0)) {
        if (ok) { g.intent('build.drop', { id: this.drag.id, pos, yaw: t.yaw }); this.unhide(this.drag.id); this.drag = null; }
        else { this.refuse(); this.cancelDrag(); }
      }
      return;
    }
    if (held && Input.mousePressed(0)) {
      Input.consumeMouse(0);
      if (!ok) { this.refuse(); return; }
      if (held.unpaid || held.data?.unpaid) { this.refuse(); g.ui.popup(t.pos.clone().setY(t.pos.y + 1), 'จ่ายเงินก่อนนะ!'); return; }
      g.intent('build.place', { slot: g.me!.sel ?? 0, pos, yaw: t.yaw });
    }
  }

  private refuse() { this.shake = 0.35; Sound.play('shop_buzz', { vol: 0.4 }); }

  /** where the crosshair puts this piece (with snapping) */
  private aim(kind: string, f: Footprint, free: boolean): Target | null {
    const g = this.game;
    const cam = g.engine.camera;
    const o = cam.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    const phys = g.physics;
    if (!phys) return null;
    const hit = phys.raycast(o, dir, 7, G.STATIC);
    // counter / table / shelf tops for table-top pieces (item bodies only exist on the host: raycast the views)
    let top: { point: THREE.Vector3; dist: number } | null = null;
    if (f.mount === 'top') {
      _ray.set(o, dir); _ray.far = 6;
      const objs: THREE.Object3D[] = [];
      for (const b of blockers(g, this.drag?.id)) { if (b.f.role === 'seat' || b.f.mount !== 'floor') continue; const ob = g.views.objectOf(b.e.id); if (ob) objs.push(ob); }
      const hs = _ray.intersectObjects(objs, true);
      for (const h of hs) { const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : null; if (n && n.y > 0.7) { top = { point: h.point, dist: h.distance }; break; } }
    }
    let pos: THREE.Vector3, yaw = this.yaw, mountOk = true;
    const me = g.me!;
    const pp = new THREE.Vector3(me.p![0], me.p![1], me.p![2]);
    if (f.mount === 'wall') {
      if (!hit) return null;
      const n = hit.normal;
      if (Math.abs(n.y) > 0.35) {
        // aimed at floor / ceiling: preview where you look, but it can't go there
        mountOk = false;
        pos = hit.point.clone();
      } else {
        yaw = Math.atan2(n.x, n.z);
        pos = hit.point.clone().addScaledVector(new THREE.Vector3(n.x, 0, n.z).normalize(), f.size[2] / 2 + 0.005);
        pos.y = hit.point.y - f.size[1] / 2;
        if (!free) {
          const along = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
          const s = pos.x * along.x + pos.z * along.z, sn = Math.round(s / GRID) * GRID;
          pos.addScaledVector(along, sn - s);
          pos.y = Math.round(pos.y / 0.05) * 0.05;
        }
        const fl = floorAt(g, pos.x, Math.min(pos.y, pp.y + 0.5), pos.z) ?? pp.y;
        pos.y = Math.max(fl + 0.25, pos.y);
      }
    } else if (f.mount === 'ceiling') {
      if (!hit) return null;
      let ceil: number | null = null;
      if (hit.normal.y < -0.6) ceil = hit.point.y;
      else ceil = ceilingAt(g, hit.point.x, hit.point.y, hit.point.z);
      pos = hit.point.clone();
      if (ceil == null) { mountOk = false; pos.y = hit.point.y + 2.2; }
      else pos.y = ceil - f.size[1];
      if (!free) { pos.x = Math.round(pos.x / GRID) * GRID; pos.z = Math.round(pos.z / GRID) * GRID; }
    } else {
      const useTop = top && (!hit || top.dist < hit.toi + 0.05);
      if (!hit && !useTop) return null;
      pos = useTop ? top!.point.clone() : hit!.point.clone();
      if (!useTop && hit!.normal.y < 0.6) {
        // aiming at a wall: stand the piece in front of it, on the floor
        pos.addScaledVector(hit!.normal, Math.max(f.size[0], f.size[2]) / 2 + 0.02);
        const fl = floorAt(g, pos.x, Math.min(pos.y, pp.y + 0.3), pos.z);
        if (fl == null) return null;
        pos.y = fl;
      }
      if (!free) { pos.x = Math.round(pos.x / GRID) * GRID; pos.z = Math.round(pos.z / GRID) * GRID; }
      if (!free && f.mount === 'floor') {
        const s = this.snapFloor(kind, f, pos, yaw);
        pos = s.pos; yaw = s.yaw;
      }
    }
    // reach
    let why: Why = null;
    if (pos.distanceTo(pp) > 5.5) why = 'far';
    else why = check(g, kind, [pos.x, pos.y, pos.z], yaw, { exclude: this.drag?.id, mountOk });
    return { pos, yaw, why };
  }

  /** floor snapping: flush to walls, seats around tables, tables in rows */
  private snapFloor(kind: string, f: Footprint, pos: THREE.Vector3, yaw: number): { pos: THREE.Vector3; yaw: number } {
    const g = this.game;
    const phys = g.physics!;
    // seats: take the closest side of a nearby table, facing it
    if (f.role === 'seat') {
      let best: { p: THREE.Vector3; yaw: number; d: number } | null = null;
      for (const b of blockers(g, this.drag?.id)) {
        if (b.f.role !== 'table') continue;
        const t = b.e;
        const ty = yawOfQ(t.q);
        const [W, D] = TABLE_SIZE[t.k] ?? [b.f.size[0], b.f.size[2]];
        const c = Math.cos(ty), s = Math.sin(ty);
        const dx = pos.x - t.p![0], dz = pos.z - t.p![2];
        if (dx * dx + dz * dz > 1.6 * 1.6) continue;
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        // candidate spots: along both long sides (two per side on wide tables) + the two ends
        const gap = f.size[2] / 2 + 0.12;
        const cands: [number, number][] = [];
        const nx = W > 0.85 ? [-W / 4, W / 4] : [0];
        for (const x of nx) { cands.push([x, D / 2 + gap], [x, -D / 2 - gap]); }
        cands.push([W / 2 + gap, 0], [-W / 2 - gap, 0]);
        for (const [cx, cz] of cands) {
          const d = Math.hypot(lx - cx, lz - cz);
          if (d > 0.55 || (best && d >= best.d)) continue;
          const wx = t.p![0] + cx * c + cz * s, wz = t.p![2] - cx * s + cz * c;
          best = { p: new THREE.Vector3(wx, pos.y, wz), yaw: Math.atan2(t.p![0] - wx, t.p![2] - wz), d };
        }
      }
      if (best) return { pos: best.p, yaw: best.yaw };
      return { pos, yaw };
    }
    // tables: align with a neighbouring table and butt up against it when close
    if (f.role === 'table') {
      for (const b of blockers(g, this.drag?.id)) {
        if (b.f.role !== 'table') continue;
        const t = b.e;
        const dx = pos.x - t.p![0], dz = pos.z - t.p![2];
        if (dx * dx + dz * dz > 1.4 * 1.4) continue;
        const ty = yawOfQ(t.q);
        const c = Math.cos(ty), s = Math.sin(ty);
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        const [W, D] = [b.f.size[0], b.f.size[2]];
        const nyaw = ty + Math.round(normYaw(yaw - ty) / (Math.PI / 2)) * (Math.PI / 2);
        const rot = Math.abs(Math.sin(nyaw - ty)) > 0.5;
        const myW = rot ? f.size[2] : f.size[0], myD = rot ? f.size[0] : f.size[2];
        let sx = lx, sz = lz;
        if (Math.abs(lx) > Math.abs(lz) * (W / Math.max(0.01, D))) { sx = Math.sign(lx) * (W / 2 + myW / 2 + 0.005); sz = Math.abs(lz) < 0.2 ? 0 : lz; }
        else { sz = Math.sign(lz) * (D / 2 + myD / 2 + 0.005); sx = Math.abs(lx) < 0.2 ? 0 : lx; }
        if (Math.hypot(sx - lx, sz - lz) > 0.3) continue;
        return { pos: new THREE.Vector3(t.p![0] + sx * c + sz * s, pos.y, t.p![2] - sx * s + sz * c), yaw: nyaw };
      }
      return { pos, yaw };
    }
    // cabinets, fridges, counters, shelves: slide flush against a wall behind / beside them, back to the wall
    if (WALL_SNAP_ROLES.has(f.role) || kind === 'chalkboard' || kind === 'planter_box') {
      let best: { n: THREE.Vector3; d: number } | null = null;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        _d.set(Math.sin(a), 0, Math.cos(a));
        const h = phys.raycast(_v.set(pos.x, pos.y + 0.5, pos.z), _d, 1.1, G.STATIC);
        if (h && Math.abs(h.normal.y) < 0.3 && (!best || h.toi < best.d)) best = { n: h.normal.clone().setY(0).normalize(), d: h.toi };
      }
      if (best) {
        const wy = Math.atan2(best.n.x, best.n.z);
        const half = f.size[2] / 2;
        if (best.d < half + 0.6) {
          const p2 = pos.clone().addScaledVector(best.n, half + 0.01 - best.d);
          return { pos: p2, yaw: wy };
        }
      }
    }
    return { pos, yaw };
  }

  // ------------------------------------------------------------------ arranging (empty hands)

  private selecting() {
    const g = this.game;
    this.target = null;
    this.hideGhost();
    const cam = g.engine.camera;
    _ray.setFromCamera(_c.set(0, 0), cam); _ray.far = 6;
    const list: { e: Ent; o: THREE.Object3D }[] = [];
    for (const b of blockers(g)) { const o = g.views.objectOf(b.e.id); if (o && o.visible) list.push({ e: b.e, o }); }
    const hs = _ray.intersectObjects(list.map((x) => x.o), true);
    let hover: Ent | null = null;
    if (hs.length) {
      let p: THREE.Object3D | null = hs[0].object;
      while (p && !list.some((x) => x.o === p)) p = p.parent;
      hover = p ? list.find((x) => x.o === p)!.e : null;
    }
    this.hover = hover;
    if (!hover) { this.tagSet(null, ''); return; }
    const f = footprintOf(hover.k)!;
    const shop = !!hover.disp;
    const price = g.items.def(hover.k)?.price ?? 0;
    this.tagSet(new THREE.Vector3(hover.p![0], hover.p![1] + f.size[1] + 0.3, hover.p![2]), (g.items.def(hover.k)?.name.th ?? hover.k) + (shop ? `  ฿${price.toLocaleString()}` : ''), shop ? 'ของในร้าน — หยิบไปจ่ายเงินก่อน' : `ขายคืนได้ ฿${Math.round(price * 0.5).toLocaleString()}`);
    if (shop) return;
    if (Input.mousePressed(0)) {
      Input.consumeMouse(0);
      this.drag = { id: hover.id, kind: hover.k, t: 0 };
      this.yaw = yawOfQ(hover.q);
      g.intent('build.grab', { id: hover.id });
      const o = g.views.objectOf(hover.id);
      if (o?.children[0]) o.children[0].visible = false;      // the ghost stands in for it while you drag
      Sound.play('table_drag', { vol: 0.35, pitch: 1.1 });
      return;
    }
    if (Input.wasPressed('KeyX')) {
      Input.consume('KeyX');
      const id = hover.id;
      const refund = Math.round(price * 0.5);
      g.ui.choose({
        prompt: tl(`ขาย${g.items.def(hover.k)?.name.th ?? ''}คืน ได้ ${refund.toLocaleString()} ฿?`, `sell it back for ${refund} ฿?`),
        options: [tl('ขายเลย', 'sell'), tl('ไม่ขาย', 'keep it')], seconds: 6,
        onPick: (i) => { if (i === 0) g.intent('build.sell', { id }); },
      });
    }
  }

  private unhide(id: number) { const o = this.game.views.objectOf(id); if (o?.children[0]) o.children[0].visible = true; }
  private cancelDrag() {
    if (!this.drag) return;
    this.game.intent('build.cancel', { id: this.drag.id });
    this.unhide(this.drag.id);
    this.drag = null;
  }

  private tagSet(at: THREE.Vector3 | null, text: string, sub = '') {
    const key = text + '|' + sub;
    if (!at || !text) { this.tag?.remove(); this.tag = null; this.tagText = ''; return; }
    if (!this.tag || key !== this.tagText) {
      this.tag?.remove();
      const pos = at.clone();
      this.tag = this.game.ui.tag(() => pos, text, sub, { scale: 0.85 });
      (this.tag as any)._pos = pos;
      this.tagText = key;
    } else (this.tag as any)._pos?.copy(at);
  }
}

export function normYaw(a: number) { return Math.atan2(Math.sin(a), Math.cos(a)); }
