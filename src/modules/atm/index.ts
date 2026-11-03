import * as THREE from 'three';
import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import { tl, params } from '../../core/util';
import { Input } from '../../core/input';
import { AtmUnit, AtmUI } from './flow';
import { installBank, bankNewDay, atmState } from './bank';
import { BRANDS, HOME, fmtSatang } from './brand';
import { receiptTexture, ReceiptData } from './tex';
import { atmSfx } from './sfx';

/* ============================================================================================
 * MODULE `atm` — a fully working street ATM (fictional ธนาคารซอยทอง / SOI THONG BANK).
 *   E on the machine → focus mode: camera eases to the screen, cursor free; press the real 3D keys
 *   (4+4 function keys beside the screen, 4×4 keypad), tap the touch screen, or type 0-9 · Enter ·
 *   Backspace · Esc. Card in → language → PIN (set on first use, 3 wrong → card retained until
 *   tomorrow) → withdraw (cash slides out of the shutter, take it or it is retracted), deposit
 *   (notes 20/50/100 from your wallet), PromptPay transfer to a friend, balance, change PIN,
 *   printed receipt (an item you keep), idle timeout with a countdown.
 *   Bank accounts: g.atm.acc[slot] (host-authoritative, saved with g). See bank.ts / flow.ts.
 * World: anchor 'atm:store' (outside the corner store, set by world/buildings.ts) → home bank;
 *        a second machine of another bank (฿15 fee) by the market road.
 * Dev: ?atm (teleport in front of the store ATM after load) · window.__atm = { ui, units, enter() }
 * ========================================================================================== */

let units: AtmUnit[] = [];
let ui: AtmUI | null = null;
let tAcc = 0;

/** extra machines placed by this module: [id, brand, x, z, yaw (model +Z front)] */
const EXTRA: [string, string, number, number, number][] = [
  // ธนาคารตลาดสด by the fresh market, other bank → ฿15 withdrawal fee for the players' cards
  ['market', 'taladsot', 5.45, -37.5, -Math.PI / 2],
];

function receiptItem(d: Partial<ReceiptData>) {
  const data: ReceiptData = {
    bank: d.bank ?? HOME.id, atm: d.atm ?? '811-0001', date: d.date ?? '', time: d.time ?? '', type: d.type ?? 'รายการ', typeEn: d.typeEn ?? '',
    amount: d.amount ?? 0, fee: d.fee ?? 0, bal: d.bal ?? 0, acct: d.acct ?? '', ref: d.ref ?? '', to: d.to, name: d.name ?? '', interest: d.interest,
  };
  const tex = receiptTexture(data, BRANDS[data.bank] ?? HOME);
  const g = new THREE.PlaneGeometry(0.078, 0.13, 1, 8);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) { const z = pos.getZ(i); pos.setY(i, 0.0015 + Math.pow(Math.abs(z) / 0.065, 2) * 0.008 + Math.sin(z * 60) * 0.0006); }
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  const grp = new THREE.Group();
  grp.add(mesh);
  return grp;
}

export default defineModule({
  id: 'atm',
  deps: ['world', 'social'],
  init(game: Game) {
    installBank(game);
    ui = new AtmUI(game);
    game.items.define({
      kind: 'atm_receipt', name: tl('สลิป ATM', 'ATM receipt'), weight: 0.003, carry: 'hand', tags: ['paper', 'trash'],
      shape: { type: 'box', size: [0.078, 0.01, 0.13] }, mass: 0.004,
      phys: { linDamp: 3.5, angDamp: 3, friction: 0.9, restitution: 0.05 },
      data: () => ({}),
      build: (e) => receiptItem(e.data ?? {}),
      label: (e) => tl(`สลิป ATM · ${e.data?.type ?? ''} ฿${fmtSatang(e.data?.amount ?? 0)}`, `ATM receipt · ${e.data?.typeEn ?? ''}`),
      hold: { pos: [0, 0.02, 0], rot: [-1.15, 0, 0.12], scale: 1.5 },
      pickRadius: 0.12,
    });
    game.interact.provide((ctx) => {
      if (ctx.hit?.kind !== 'atm' || !ui) return;
      const u = units.find((x) => x.id === ctx.hit!.data?.atm);
      if (!u) return;
      const busy = (game.g as any).atm?.busy?.[u.id];
      const other = busy && busy.id !== game.localPlayerId && game.state.get(busy.id);
      return {
        key: 'E', label: tl('ใช้ตู้ ATM', 'use the ATM'), priority: 6,
        disabled: other ? tl('มีคนใช้อยู่', 'in use') : undefined,
        run: () => { Input.consume('KeyE'); ui!.enter(u); },
      };
    });
    // PromptPay notification for the recipient
    game.on('atm:received', (d: { to: number; from: string; amount: number }) => {
      if (d.to !== game.localPlayerId) return;
      const me = game.me;
      if (me?.p) game.ui?.popup?.(new THREE.Vector3(me.p[0], me.p[1] + 1.9, me.p[2]), `+฿${fmtSatang(d.amount)} โอนจาก ${d.from}`);
      atmSfx('ok', null, 0.8);
      game.interact.hintOnce('atm.rx' + Date.now(), `📱 พร้อมเพย์: ได้รับเงิน ฿${fmtSatang(d.amount)} จาก ${d.from} (เข้าบัญชี ไปกดที่ตู้ ATM)`, 5);
    });
    game.events.on('world:exit', () => { if (ui?.active) ui.exit(); for (const u of units) u.dispose(); units = []; });
    (window as any).__atm = {
      get ui() { return ui; }, get units() { return units; },
      enter: (i = 0) => { const u = units[i]; if (u && ui) ui.enter(u); },
      go: (i = 0) => {
        const u = units[i];
        if (!u || !game.player) return;
        const p = u.local([0, 0, 1.25]);
        p.y = game.world?.groundY(p.x, p.z) ?? p.y;
        game.player.teleport([p.x, p.y, p.z], u.yaw);
      },
      state: () => atmState(game),
    };
  },
  async buildWorld(game: Game) {
    for (const u of units) u.dispose();
    units = [];
    if (game.isHost) atmState(game).busy = {};
    const scene = game.scene;
    if (!scene) return;
    const anchors = game.world?.anchors ?? {};
    const place = (id: string, brand: string, p: ArrayLike<number>, yaw: number) => {
      const u = new AtmUnit(game, id, brand, p, yaw);
      scene.add(u.root);
      units.push(u);
      return u;
    };
    const a = anchors['atm:store'];
    if (a) place('store', HOME.id, a.p, a.yaw ?? -Math.PI / 2);
    else place('store', HOME.id, [5.55, 0.15, -13.3], -Math.PI / 2);
    for (const [id, brand, x, z, yaw] of EXTRA) {
      const y = game.world?.groundY(x, z) ?? 0.15;
      place(id, brand, [x, y, z], yaw);
      const c = new THREE.Vector3(0, 1.0, 0.08).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(x, y, z));
      game.physics?.addBox?.([c.x, c.y, c.z], [0.76, 2.0, 0.88], yaw);
    }
    if (params.has('atm')) {
      const off = game.events.on('world:ready', () => { off(); setTimeout(() => (window as any).__atm?.go(0), 1500); });
    }
  },
  frame(game: Game, dt: number) {
    if (!units.length || !game.camera) return;
    tAcc += dt;
    const camPos = game.camera.getWorldPosition(new THREE.Vector3());
    for (const u of units) {
      if (ui && ui.unit === u) { ui.frame(dt); continue; }
      const busy = (game.g as any).atm?.busy?.[u.id];
      const other = busy && busy.id !== game.localPlayerId && game.state.get(busy.id);
      u.frame(dt, tAcc, other ? { kind: 'busy' } : { kind: 'attract' }, camPos);
    }
    if (ui && !ui.unit) ui.frame(dt);
  },
  onNewDay(game: Game, day: number) { bankNewDay(game, day); },
});
