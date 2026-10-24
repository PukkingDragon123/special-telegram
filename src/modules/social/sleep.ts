import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { Ctx, Action } from '../../game/interact';
import { Assets } from '../../core/assets';
import { Input } from '../../core/input';
import { Sound, SoundHandle } from '../../core/audio';
import { F } from '../../core/fonts';
import { Ease, clamp, damp, tl } from '../../core/util';
import { HOURS_PER_SECOND } from '../../game/clock';
import { ANCHORS } from '../../game/mapplan';
import { FlyText } from './flytext';
import { Sparkles, headPos, bodyPos, rigOf } from './fx';
import { pick } from './lines';
import { hostTimers, localTimers, anim, isPlayer } from './state';

/* ============================================================================================
 * DAY CYCLE & SLEEP — at 'day:midnight' (host) everyone must sleep on CARDBOARD:
 *   [E] the cardboard pile (anchor cardboard_pile) → a folded 'cardboard' (real Mama / Chang /
 *   plain carton prints) · [LMB] on the ground → lays it flat ('cardboard_bed') · [E] on it → lie
 *   down (anim lie_cardboard, snoring, funny lines). At 00:30 stragglers pass out where they stand
 *   (sore back next morning). When everybody sleeps → fade → clock.newDay() → auto-save →
 *   morning newspaper (menu module: (game as any).newspaper.show(stats)) → wake up.
 *   g.night = { phase: 'none'|'bed'|'dream'|'morning', late (hours past midnight), t }
 *   g.dayHistory = [stats…] · g.unlocks.recipes grows by day (+1 day early at ≥4★ reputation);
 *   new recipes are brought by the old man (npc role 'oldman_visit', emits 'unlock:recipe').
 *   intents cardboard.take · cardboard.lay {slot,pos,yaw} · cardboard.fold {bed} · sleep.lie {bed}
 *           · sleep.up · sleep.wake
 * ========================================================================================== */

export const RECIPE_SCHEDULE: Record<number, string[]> = {
  1: ['kaphrao_moo', 'khai_dao'],
  2: ['khai_jiao'],
  3: ['khao_phat', 'phat_phrik_kaeng'],
  4: ['moo_kratiam', 'phat_phak_bung'],
  5: ['phat_si_io', 'rat_na'],
  6: ['tom_yam'],
};
const RECIPE_TH: Record<string, string> = {
  kaphrao_moo: 'กะเพราหมูสับ', khai_dao: 'ไข่ดาว', khai_jiao: 'ไข่เจียว', khao_phat: 'ข้าวผัด', phat_phrik_kaeng: 'ผัดพริกแกง',
  moo_kratiam: 'หมูกระเทียม', phat_phak_bung: 'ผัดผักบุ้ง', phat_si_io: 'ผัดซีอิ๊ว', rat_na: 'ราดหน้า', tom_yam: 'ต้มยำ',
};

/** reputation → stars (restaurant may use 0..5 or 0..100) */
function stars(game: Game) {
  const r = Number(game.g.reputation ?? 0) || 0;
  return r > 5 ? r / 20 : r;
}
export function recipesFor(game: Game, day: number): string[] {
  const bonus = stars(game) >= 4 ? 1 : 0;
  const out: string[] = [];
  for (const [d, ids] of Object.entries(RECIPE_SCHEDULE)) if (Number(d) <= day + bonus) out.push(...ids);
  return out;
}

// ------------------------------------------------------------------ cardboard visuals (real carton prints)

const VARIANTS = ['cardboard_mat_mama.jpg', 'cardboard_mat_chang.jpg', 'cardboard_mat_plain.jpg'];
const VAR_TH = ['ลังมาม่า', 'ลังเบียร์ช้าง', 'ลังเปล่า'];
const matCache = new Map<string, THREE.Material>();
function topMat(v: number) {
  const k = 'top' + v;
  let m = matCache.get(k);
  if (!m) {
    const map = Assets.texture('textures/props/' + VARIANTS[v % 3], { wrap: false });
    const nrm = Assets.texture('textures/props/cardboard_corrugated_tile_n.jpg', { srgb: false, repeat: 2 });
    m = new THREE.MeshStandardMaterial({ map, normalMap: nrm, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.93, metalness: 0 });
    matCache.set(k, m);
  }
  return m;
}
function sideMat() {
  let m = matCache.get('side');
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: Assets.texture('textures/props/cardboard_corrugated_tile.jpg', { repeat: [4, 0.25] }), normalMap: Assets.texture('textures/props/cardboard_corrugated_tile_n.jpg', { srgb: false, repeat: [4, 0.25] }), roughness: 0.95 });
    matCache.set('side', m);
  }
  return m;
}
function bottomMat() {
  let m = matCache.get('bottom');
  if (!m) { m = new THREE.MeshStandardMaterial({ map: Assets.texture('textures/props/cardboard_corrugated_tile.jpg', { repeat: 2 }), roughness: 0.96, color: 0xd8c8b0 }); matCache.set('bottom', m); }
  return m;
}

/** a flattened carton panel: w × d, thin, slightly warped, origin bottom-centre */
function panel(w: number, d: number, v: number, seed: number, warp = 0.012) {
  const t = 0.006;
  const g = new THREE.BoxGeometry(w, t, d, 8, 1, 8);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / w, z = pos.getZ(i) / d;
    const y = Math.sin(x * 5.1 + seed) * Math.cos(z * 4.3 + seed * 2) * warp + (Math.abs(x) > 0.42 || Math.abs(z) > 0.42 ? warp * 0.8 * Math.sin(seed * 7 + x * 9) : 0);
    pos.setY(i, pos.getY(i) + t / 2 + y + warp);
  }
  g.computeVertexNormals();
  const s = sideMat();
  return new THREE.Mesh(g, [s, s, topMat(v), bottomMat(), s, s]);
}

function buildFolded(v: number) {
  const g = new THREE.Group();
  const a = panel(0.58, 0.44, v, 1.3 + v, 0.004);
  const b = panel(0.58, 0.44, v, 2.1 + v, 0.004);
  b.position.y = 0.012; b.rotation.y = 0.05;
  const c = panel(0.58, 0.44, (v + 1) % 3, 3.7, 0.004);
  c.position.y = 0.024; c.rotation.y = -0.04;
  g.add(a, b, c);
  return g;
}

function buildBed(v: number) {
  const g = new THREE.Group();
  const a = panel(0.82, 0.86, v, 0.7 + v);
  a.position.z = -0.42;
  const b = panel(0.82, 0.86, (v + 1) % 3, 4.1 + v);
  b.position.set(0.02, 0.003, 0.42);
  b.rotation.y = Math.PI + 0.04;
  g.add(a, b);
  return g;
}

export function buildPile() {
  const g = new THREE.Group();
  let y = 0;
  for (let i = 0; i < 7; i++) {
    const p = panel(0.62 + (i % 2) * 0.1, 0.5 + (i % 3) * 0.06, i % 3, i * 1.7, 0.008);
    p.position.set((Math.sin(i * 2.1)) * 0.06, y, Math.cos(i * 1.3) * 0.05);
    p.rotation.y = Math.sin(i * 3.7) * 0.5;
    y += 0.016;
    g.add(p);
  }
  // two cartons leaning on the pile
  for (let i = 0; i < 2; i++) {
    const p = panel(0.6, 0.55, (i + 1) % 3, 9 + i, 0.006);
    p.rotation.set(0, i * 1.2 + 0.4, 1.15 - i * 0.2);
    p.position.set(0.42 - i * 0.82, 0.06, 0.1 - i * 0.15);
    g.add(p);
  }
  g.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ------------------------------------------------------------------ install

export function installSleep(game: Game, sparks: Sparkles, save: () => void) {
  game.items.define({
    kind: 'cardboard', name: tl('ลังกระดาษ', 'cardboard'), weight: 0.7, carry: 'underarm', tags: ['bed', 'cardboard'], price: 0,
    data: () => ({ v: Math.floor(Math.random() * 3) }),
    build: (e) => buildFolded(e.data?.v ?? 0),
    label: (e) => tl(`${VAR_TH[(e.data?.v ?? 0) % 3]} (ปูนอน)`, 'cardboard (sleep on it)'),
    hold: { pos: [0, -0.08, -0.05], rot: [0.9, -0.4, 0.1], scale: 0.6 },
  });
  game.items.define({
    kind: 'cardboard_bed', name: tl('ที่นอนลังกระดาษ', 'cardboard bed'), weight: 0.7, fixed: true, noPickup: true, tags: ['bed', 'cardboard'],
    shape: { type: 'box', size: [0.84, 0.03, 1.72] },
    data: () => ({ v: 0, by: null }),
    build: (e) => buildBed(e.data?.v ?? 0),
    label: (e) => (e.data?.by ? tl('มีคนนอนอยู่', 'occupied') : tl('ที่นอนห้าดาว (ลัง)', 'five-star cardboard bed')),
  });

  // ------------------------------------------------------------------ interaction (local)
  game.interact.provide((ctx: Ctx) => {
    const acts: Action[] = [];
    const h = ctx.hit;
    if (h?.kind === 'cardboard_pile') {
      acts.push(game.items.freeSlots(ctx.me) > 0
        ? { key: 'E', label: tl('หยิบลังกระดาษ', 'take cardboard'), priority: 5, run: () => game.intent('cardboard.take', {}) }
        : { key: 'E', label: tl('หยิบลัง', 'take'), disabled: tl('มือเต็ม', 'hands full') });
    }
    const e = h?.ent;
    if (e?.t === 'item' && e.k === 'cardboard_bed') {
      const occ = e.data?.by && game.state.get(e.data.by);
      if (!occ) {
        acts.push({ key: 'E', label: tl('นอน', 'lie down'), priority: 6, run: () => game.intent('sleep.lie', { bed: e.id }) });
        acts.push({ key: 'R', label: tl('พับเก็บ', 'fold up'), priority: 4, run: () => game.intent('cardboard.fold', { bed: e.id }) });
      }
    }
    if (ctx.held?.k === 'cardboard' && ctx.surface && ctx.surface.normal.y > 0.8) {
      const pt = ctx.surface.point;
      acts.push({ key: 'LMB', label: tl('ปูลังนอน', 'lay it down'), priority: 6, run: () => game.intent('cardboard.lay', { slot: ctx.me.sel ?? 0, pos: [pt.x, pt.y, pt.z], yaw: ctx.me.yaw }) });
    }
    return acts;
  }, 12);

  // ------------------------------------------------------------------ HOST intents
  const pileAt = () => game.world?.anchors?.cardboard_pile?.p ?? ANCHORS.cardboard_pile.p;
  game.onIntent('cardboard.take', (pl) => {
    const a = pileAt();
    if (!pl.p || Math.hypot(pl.p[0] - a[0], pl.p[2] - a[2]) > 3.6) return;
    if (game.items.freeSlots(pl) < 1) return;
    game.items.give(pl, 'cardboard', { data: { v: Math.floor(Math.random() * 3) } });
    game.sfx('cardboard', pl.p, { vol: 0.8 });
    if (Math.random() < 0.5) game.say(pl.id, pick('sleeping_on_cardboard', 0.15), { duration: 2.4 });
  });
  game.onIntent('cardboard.lay', (pl, d: { slot: number; pos: number[]; yaw: number }) => {
    const it = game.state.get(pl.inv?.[d?.slot ?? pl.sel ?? 0]);
    if (!it || it.k !== 'cardboard' || !Array.isArray(d.pos) || !pl.p) return;
    if (Math.hypot(pl.p[0] - d.pos[0], pl.p[2] - d.pos[2]) > 3.4) return;
    const v = it.data?.v ?? 0;
    game.items.remove(it);
    game.items.spawn('cardboard_bed', [d.pos[0], d.pos[1] + 0.002, d.pos[2]], { yaw: (d.yaw ?? pl.yaw ?? 0), data: { v, by: null, owner: pl.id } });
    game.sfx('cardboard', d.pos, { vol: 0.9 });
  });
  game.onIntent('cardboard.fold', (pl, d: { bed: number }) => {
    const b = game.state.get(d?.bed);
    if (!b || b.k !== 'cardboard_bed' || (b.data?.by && game.state.get(b.data.by))) return;
    if (!pl.p || !b.p || Math.hypot(pl.p[0] - b.p[0], pl.p[2] - b.p[2]) > 3.4) return;
    if (game.items.freeSlots(pl) < 1) return;
    const v = b.data?.v ?? 0;
    game.items.remove(b);
    game.items.give(pl, 'cardboard', { data: { v } });
    game.sfx('cardboard', pl.p, { vol: 0.8 });
  });
  game.onIntent('sleep.lie', (pl, d: { bed: number }) => {
    const b = game.state.get(d?.bed);
    if (!b || b.k !== 'cardboard_bed' || !b.p || !pl.p) return;
    if (b.data?.by && b.data.by !== pl.id && game.state.get(b.data.by)) return;
    if (Math.hypot(pl.p[0] - b.p[0], pl.p[2] - b.p[2]) > 3.4) return;
    if (pl.mode && pl.mode !== 'free') return;
    lieDown(pl, b);
  });
  game.onIntent('sleep.up', (pl) => {
    const ph = game.g.night?.phase ?? 'none';
    if (pl.mode !== 'sleep' || ph === 'dream' || ph === 'morning') return;
    getUp(pl, false);
  });
  game.onIntent('sleep.wake', (pl) => {
    if (pl.mode !== 'sleep') return;
    getUp(pl, true);
  });

  function lieDown(pl: Ent, b: Ent) {
    // drop a held cardboard back to the floor first? no — keep inventory
    pl.mode = 'sleep';
    pl.bed = b.id;
    pl.sore = 0;
    b.data = { ...(b.data ?? {}), by: pl.id };
    const yaw = 2 * Math.atan2(b.q?.[1] ?? 0, b.q?.[3] ?? 1);
    anim(pl, 'lie_cardboard', true);
    game.emit('social:lie', { id: pl.id, p: [b.p![0], b.p![1] + 0.03, b.p![2]], yaw });
    game.sfx('cardboard', b.p, { vol: 0.6 });
    hostTimers.after(1.2, () => { if (pl.mode === 'sleep') game.say(pl.id, pick('sleeping_on_cardboard'), { style: 'thought', duration: 2.6, voice: 0 }); });
  }

  function getUp(pl: Ent, morning: boolean) {
    const b = game.state.get(pl.bed);
    if (b?.data?.by === pl.id) b.data = { ...b.data, by: null };
    pl.bed = null;
    pl.mode = 'free';
    anim(pl, 'wake_up');
    hostTimers.after(2.7, () => { if (game.state.get(pl.id) && pl.anim === 'wake_up') anim(pl, 'idle', true); });
    if (morning) {
      game.say(pl.id, pl.sore ? pick('wake_sore') : pick('wake'), { duration: 2.6 });
      if (game.hasSkill(pl, 'sleep_well') && !pl.sore) { pl.hype = 1; pl._hypeUntil = hostTimers.now + 120; }
    }
  }

  function passOut(pl: Ent) {
    pl.mode = 'sleep';
    pl.bed = null;
    pl.sore = 1;
    anim(pl, 'fall');
    game.emit('social:passout', { id: pl.id });
    game.say(pl.id, pick('pass_out'), { style: 'thought', duration: 2.4, voice: 0 });
    const s = { ...(game.g.social ?? {}) };
    s.passedOut = (s.passedOut ?? 0) + 1;
    s.passedOutNames = [...(s.passedOutNames ?? []), pl.name];
    game.g.social = s;
  }

  function night() { return game.g.night ?? { phase: 'none', late: 0, t: 0 }; }

  game.events.on('day:midnight', () => {
    if (!game.isHost) return;
    if (night().phase !== 'none') return;
    game.g.night = { phase: 'bed', late: 0, t: 0 };
    game.emit('social:bedtime', {});
    for (const p of game.players()) if (p.mode !== 'sleep') game.say(p.id, pick('bedtime'), { duration: 3 });
  });

  /** HOST: the whole new-day routine (stats → newDay → save → newspaper). */
  function morning() {
    const g = game.g;
    const ds = { ...(g.dayStats ?? {}) };
    const soc = { ...(g.social ?? {}) };
    const events: string[] = Array.isArray(ds.events) ? ds.events.map((e: any) => (typeof e === 'string' ? e : e?.th ?? '')).filter(Boolean) : [];
    if (soc.slaps) events.push(`เพื่อนตบกันเอง ${soc.slaps} ฉาด กลางซอย`);
    if (soc.hanging) events.push(`ชายหนุ่มยกมือไฮไฟว์ค้าง ${soc.hanging} ครั้ง ไม่มีใครแปะ`);
    if (soc.tugs) events.push(`แย่งของกันชักเย่อ ${soc.tugs} รอบ`);
    if (soc.passedOutNames?.length) events.push(`${soc.passedOutNames.join(', ')} หลับกลางถนน ไม่มีลังรอง`);
    if (soc.given) events.push(`เพื่อนให้เงินกันรวม ${soc.given} บาท`);
    const stats = { ...ds, day: g.day ?? 1, events, social: soc, players: game.players().map((p) => ({ name: p.name, wallet: p.wallet, lv: p.lv })) };
    g.dayHistory = [...(g.dayHistory ?? []), stats].slice(-30);
    g.social = {};
    game.clock.newDay();
    g.night = { phase: 'morning', late: 0, t: 0, stats };
    for (const p of game.players()) if (p.mode !== 'sleep') { p.mode = 'sleep'; anim(p, 'lie_cardboard', true); }
    try { save(); } catch (e) { console.error('[social] save failed', e); }
    game.emit('social:morning', { stats, day: g.day });
  }

  // ------------------------------------------------------------------ old man brings new recipe pages
  function unlockNow(recipes: string[]) {
    const have: string[] = Array.isArray(game.g.unlocks?.recipes) ? game.g.unlocks.recipes : [];
    game.g.unlocks = { ...(game.g.unlocks ?? {}), recipes: [...new Set([...have, ...recipes])] };
  }
  let visit: { npc: Ent; t: number; stage: number } | null = null;
  function startVisit() {
    const recipes: string[] = game.g.pendingRecipes ?? [];
    if (!recipes.length || visit || !game.world) return;
    const cart = game.state.find('cart', () => true);
    const a = cart?.p ?? game.world.anchor('cart_start').p;
    const look = game.chars.randomLook('old_man_cart_owner', 7);
    const start = [a[0] - 1.0, a[1], a[2] - 16];
    const npc = game.state.spawn('npc', { role: 'oldman_visit', look, p: start, yaw: Math.PI, hold: 'recipe_book', name: tl('ลุงเจ้าของรถเข็นคนเดิม', 'the old cart man'), lookAt: null });
    visit = { npc, t: 0, stage: 0 };
    game.npcs.go(npc, [a[0] - 1.2, a[1], a[2] - 1.4], {
      speed: 1.05,
      onArrive: () => {
        if (!visit) return;
        visit.stage = 1;
        const names = recipes.map((r) => RECIPE_TH[r] ?? r).join(' กับ ');
        const near = game.nearestPlayer(npc.p!, 30);
        npc.lookAt = near?.id ?? null;
        anim(npc, 'give');
        game.say(npc.id, tl(`${pick('unlock_old_man').th} — ${names}!`, `New recipe: ${recipes.join(', ')}`), { duration: 4.5, voice: 0.75 });
        game.g.pendingRecipes = [];
        unlockNow(recipes);
        game.emit('unlock:recipe', { recipes, by: npc.id });
        hostTimers.after(6.5, () => {
          if (!visit) return;
          npc.lookAt = null;
          game.npcs.go(npc, start, { speed: 1.1, onArrive: () => { game.state.despawn(npc); visit = null; } });
        });
      },
    });
  }

  game.on('unlock:recipe', (d: { recipes: string[]; by?: number }) => {
    const p = d.by != null ? headPos(game, d.by) : headPos(game, game.localPlayerId);
    if (p) {
      Sound.play('tada', { pos: p, vol: 0.8 });
      Sound.play('page_turn', { pos: p, vol: 0.7, delay: 0.3 });
      sparks.burst(p.clone().add(new THREE.Vector3(0, 0.3, 0)), 50, { color: 0xfff0b0, speed: 1.8, size: 0.05, life: 1.2 });
      game.ui.popup(p.clone().add(new THREE.Vector3(0, 0.45, 0)), `สูตรใหม่! ${d.recipes.map((r) => RECIPE_TH[r] ?? r).join(' · ')}`, { style: { font: F.heavy, size: 64, weight: 800, color: '#ffe066', stroke: '#2a1408', strokeWidth: 9 }, dur: 3.5, rise: 0.7 });
    }
  });

  // ------------------------------------------------------------------ client state
  const snores = new Map<number, SoundHandle>();
  const zzz: { ft: FlyText; id: number; t: number }[] = [];
  let zAcc = 0;
  let localSleep: { cam: THREE.Vector3; t: number; yaw: number; waking: boolean } | null = null;
  let fadeK = 0, fadeWant = 0;
  let lastPhase = 'none';
  let morningStats: any = null;
  let morningBusy = false;
  let pileObj: THREE.Object3D | null = null;
  let bedtimeTag: any = null;

  game.on('social:lie', (d: { id: number; p: number[]; yaw: number }) => {
    if (d.id !== game.localPlayerId || !game.player) return;
    game.player.teleport(d.p, d.yaw);
    enterSleepCam();
  });
  game.on('social:passout', (d: { id: number }) => {
    const p = headPos(game, d.id);
    Sound.play('slide_whistle_down', { pos: p ?? undefined, vol: 0.6 });
    localTimers.after(0.8, () => Sound.play('body_thud', { pos: headPos(game, d.id) ?? undefined, vol: 0.9 }));
    if (d.id === game.localPlayerId) localTimers.after(0.4, () => enterSleepCam());
  });
  game.on('social:bedtime', () => {
    Sound.play('yawn', { vol: 0.8 });
    game.interact.hintOnce('social_bed', 'เที่ยงคืนแล้ว! หาลังกระดาษที่ลานว่าง [E] หยิบ · [คลิก] ปู · [E] นอน', 9);
  });
  game.on('social:morning', (d: { stats: any }) => { morningStats = d.stats; });

  function enterSleepCam() {
    const pl = game.player;
    if (!pl || localSleep) return;
    if (pl.mode !== 'external') pl.setMode('external');
    localSleep = { cam: game.camera.position.clone(), t: 0, yaw: pl.yaw, waking: false };
  }
  function exitSleepCam() {
    const pl = game.player;
    localSleep = null;
    if (pl && pl.mode === 'external') pl.setMode('play');
  }

  async function runMorning() {
    if (morningBusy) return;
    morningBusy = true;
    try {
      await new Promise((r) => setTimeout(r, 600));
      fadeWant = 0;
      Sound.music('', 2);
      Sound.play('rooster', { vol: 0.9 });
      await new Promise((r) => setTimeout(r, 2200));
      const np = (game as any).newspaper;
      if (np?.show) { try { await np.show(morningStats ?? game.g.night?.stats ?? game.g.dayStats); } catch (e) { console.error(e); } }
      else await new Promise((r) => setTimeout(r, 1500));
      Sound.play('yawn', { vol: 0.8 });
      game.intent('sleep.wake', {});
    } finally { morningBusy = false; }
  }

  return {
    buildWorld() {
      const a = game.world?.anchors?.cardboard_pile?.p ?? ANCHORS.cardboard_pile.p;
      const gy = game.physics?.groundY(a[0], a[2]) ?? a[1];
      pileObj = buildPile();
      pileObj.position.set(a[0], gy, a[2]);
      pileObj.name = 'cardboard-pile';
      game.scene?.add(pileObj);
      game.interact.register(pileObj, { kind: 'cardboard_pile', data: { name: tl('กองลังกระดาษ', 'cardboard pile') } });
      game.physics?.addBox([a[0], gy + 0.08, a[2]], [0.75, 0.16, 0.6]);
    },
    hostUpdate(dt: number) {
      const g = game.g;
      const n = night();
      // hype buff expiry
      for (const p of game.players()) if (p.hype && (p._hypeUntil ?? 0) < hostTimers.now) p.hype = 0;
      if (g.scene !== 'world') return;
      const players = game.players();
      const allAsleep = players.length > 0 && players.every((p) => p.mode === 'sleep');
      if (n.phase === 'none') {
        if (allAsleep && (g.time ?? 7) >= 21) { g.night = { phase: 'bed', late: 0, t: 0 }; }
        if (visit) visit.t += dt;
        else if ((g.pendingRecipes ?? []).length) {
          if ((g.time ?? 7) >= 10) { const r = g.pendingRecipes; g.pendingRecipes = []; unlockNow(r); game.emit('unlock:recipe', { recipes: r }); }
          else { g._visitT = (g._visitT ?? 0) + dt; if (g._visitT > 9) { g._visitT = 0; startVisit(); } }
        }
        return;
      }
      const nn = { ...n, t: (n.t ?? 0) + dt };
      if (n.phase === 'bed') {
        nn.late = (n.late ?? 0) + dt * HOURS_PER_SECOND * game.clock.speed;
        if (allAsleep) { nn.phase = 'dream'; nn.t = 0; }
        else if (nn.late >= 0.5) for (const p of players) if (p.mode !== 'sleep') passOut(p);
      } else if (n.phase === 'dream') {
        if (nn.t >= 3.4) { morning(); return; }
      } else if (n.phase === 'morning') {
        const awake = players.every((p) => p.mode !== 'sleep');
        if (awake || nn.t > 60) {
          for (const p of players) if (p.mode === 'sleep') getUp(p, true);
          nn.phase = 'none'; nn.t = 0;
          hostTimers.after(40, () => { for (const b of game.state.all('item')) if (b.k === 'cardboard_bed' && !(b.data?.by && game.state.get(b.data.by))) game.items.remove(b); });
        }
      }
      g.night = nn;
    },
    frame(dt: number) {
      const me = game.me;
      const pl = game.player;
      const n = night();
      // ---- phase transitions (local)
      if (n.phase !== lastPhase) {
        if (n.phase === 'dream') { fadeWant = 1; Sound.music('sleep_lullaby', 2); }
        if (n.phase === 'morning') { fadeK = 1; fadeWant = 1; runMorning(); }
        if (n.phase === 'bed') {
          const a = game.world?.anchors?.cardboard_pile?.p ?? ANCHORS.cardboard_pile.p;
          bedtimeTag?.remove?.();
          bedtimeTag = game.ui.tag(new THREE.Vector3(a[0], a[1] + 1.4, a[2]), 'ลังกระดาษ — ที่นอนห้าดาว', 'cardboard pile · sleep here', { scale: 1.1 });
        }
        if (n.phase === 'none' && bedtimeTag) { bedtimeTag.remove(); bedtimeTag = null; }
        lastPhase = n.phase;
      }
      if (n.phase !== 'bed' && n.phase !== 'dream' && bedtimeTag) { bedtimeTag.remove(); bedtimeTag = null; }
      // fade through the grade pass
      fadeK += (fadeWant - fadeK) * damp(fadeWant > fadeK ? 1.6 : 1.2, dt);
      const post = game.engine.post;
      if (n.phase === 'dream' || n.phase === 'morning' || fadeK > 0.002) post.fade = clamp(fadeK);
      if (n.phase === 'none' && fadeWant === 1) fadeWant = 0;

      // ---- my sleep camera
      if (me && pl) {
        if (me.mode === 'sleep' && !localSleep && pl.mode === 'play') enterSleepCam();
        if (localSleep && me.mode !== 'sleep') exitSleepCam();
        if (localSleep && me.mode === 'sleep') {
          localSleep.t += dt;
          if (pl.mode !== 'external') pl.setMode('external');
          const body = pl.pos.clone();
          const yaw = localSleep.yaw;
          const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
          const want = body.clone().add(new THREE.Vector3(0, 2.2 + Math.sin(localSleep.t * 0.2) * 0.1, 0)).addScaledVector(side, 1.3).add(new THREE.Vector3(Math.sin(localSleep.t * 0.13) * 0.3, 0, 0));
          localSleep.cam.lerp(want, damp(1.5, dt));
          const cam = game.camera;
          cam.position.copy(localSleep.cam);
          cam.lookAt(body.x, body.y + 0.25, body.z);
          // get up early (not once the night is over)
          const ph = n.phase;
          if (ph !== 'dream' && ph !== 'morning' && localSleep.t > 1.2 && (Input.wasPressed('Space') || Input.wasPressed('KeyW') || Input.wasPressed('KeyE'))) game.intent('sleep.up', {});
        }
      }

      // ---- snoring + floating Zzz for every sleeper
      const sleepers = game.players().filter((p) => p.mode === 'sleep');
      const ids = new Set(sleepers.map((p) => p.id));
      for (const p of sleepers) {
        const hp = headPos(game, p.id) ?? bodyPos(game, p.id);
        if (!hp) continue;
        let s = snores.get(p.id);
        if (!s) { s = Sound.loop('snore_loop', { pos: hp, vol: 0.55 }); snores.set(p.id, s); }
        s.setPos(hp);
      }
      for (const [id, s] of snores) if (!ids.has(id)) { s.stop(0.5); snores.delete(id); }
      zAcc += dt;
      if (zAcc > 1.4 && sleepers.length) {
        zAcc = 0;
        for (const p of sleepers) {
          const ft = new FlyText([{ text: Math.random() < 0.5 ? 'Z z z' : 'คร่อก~', style: { font: F.bubbly, size: 60, weight: 700, color: '#eef3ff', stroke: '#2a3150', strokeWidth: 7 } }], { px: 0.0012, stagger: 0.08, dur: 0.6 });
          game.scene?.add(ft.mesh);
          zzz.push({ ft, id: p.id, t: 0 });
        }
      }
      for (let i = zzz.length - 1; i >= 0; i--) {
        const z = zzz[i];
        z.t += dt;
        z.ft.update(dt);
        const b = bodyPos(game, z.id);
        if (b) z.ft.mesh.position.set(b.x + Math.sin(z.t * 2) * 0.15, b.y + 0.5 + z.t * 0.35, b.z);
        z.ft.mesh.quaternion.copy(game.camera.quaternion);
        z.ft.mesh.scale.setScalar(0.6 + z.t * 0.25);
        if (z.t > 2.2 && z.ft.out < 0) z.ft.leave();
        if (z.ft.gone || z.t > 4) { z.ft.dispose(); zzz.splice(i, 1); }
      }
      void rigOf; void Ease;
    },
    dispose() {
      for (const s of snores.values()) s.stop(0.2);
      snores.clear();
      for (const z of zzz) z.ft.dispose();
      zzz.length = 0;
      pileObj?.removeFromParent();
      pileObj = null;
      localSleep = null;
    },
  };
}
