import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { Ctx } from '../../game/interact';
import { tl, TL } from '../../core/util';
import { Assets } from '../../core/assets';
import { anchorP, dist2, proxyMaterial } from './util';
import { line } from './lines';
import { sfx } from './sounds';
import { lifeTex } from './tex';
import type { Life } from './index';

/* ============================================================================================
 * HOMELESS MAN — npc (role 'homeless') sitting on cardboard at homeless_spot.
 *  [E] ให้เงิน → quick choice 1 / 5 / 20 ฿ (game.money) → blessing + funny street wisdom.
 *  Remembers kindness (g.homeless): tomorrow's tip boost (life.tipMul()), luck per player,
 *  one-time gifts (flashlight at 20 ฿ total, amulet at 50 ฿ total). Grumbles when ignored.
 * ========================================================================================== */

interface HState { given: Record<string, number>; today: number; day: number; gifts: Record<string, string[]> }

export class Homeless {
  private props: THREE.Group | null = null;
  private asked = new Map<number, number>();      // playerId → time asked
  private grumbled = new Map<number, number>();
  private wisdomT = 0;
  private sleepSnore: number = 0;

  constructor(private game: Game, private life: Life) {}

  get now() { return this.life.clock.t; }
  npc(): Ent | null { return this.game.state.find('npc', (e) => e.role === 'homeless') ?? null; }
  private st(): HState {
    const g = this.game.g;
    if (!g.homeless) g.homeless = { given: {}, today: 0, day: g.day ?? 1, gifts: {} };
    return g.homeless;
  }

  init() {
    const game = this.game;
    game.onIntent('life.give', (pl, d: { amount: number }) => this.hostGive(pl, d.amount));
    game.interact.provide((ctx: Ctx) => {
      const h = ctx.hit;
      if (!h) return;
      const isHim = h.kind === 'homeless' || (h.ent?.t === 'npc' && h.ent?.role === 'homeless');
      if (!isHim) return;
      return [{
        key: 'E', label: tl('ให้เงิน', 'give money'), priority: 7,
        run: () => {
          const npc = this.npc();
          if (npc) game.ui.shout(() => this.headPos(), line('homeless_ask', 0), { duration: 4 });
          game.ui.choose({
            prompt: tl('ให้ลุงเท่าไหร่ดี?', 'how much?'),
            options: [tl('1 บาท', 'one baht'), tl('5 บาท', 'five baht'), tl('20 บาท', 'twenty baht')],
            seconds: 6,
            onPick: (i: number) => { if (i >= 0) game.intent('life.give', { amount: [1, 5, 20][i] }); },
          } as any);
        },
      }];
    }, 11);
    // fallback npc view if the characters module doesn't provide one
    game.events.on('world:ready', () => {
      const f = (game.views as any).factories as Map<string, any> | undefined;
      if (f && !f.has('npc')) game.registerView('npc', (e: Ent) => fallbackNpcView(game, e));
    });
  }

  private headPos(): THREE.Vector3 {
    const n = this.npc();
    const o = n ? this.game.views.objectOf(n.id) : null;
    if (o) return o.localToWorld(new THREE.Vector3(0, 1.25, 0));
    const p = n?.p ?? [0, 0, 0];
    return new THREE.Vector3(p[0], p[1] + 1.2, p[2]);
  }

  // ------------------------------------------------------------------ host

  hostEnsure() {
    const game = this.game;
    let n = this.npc();
    const a = anchorP(game, 'homeless_spot', [-7.2, 0.15, -80]);
    if (!n) {
      const look = game.chars.randomLook('homeless_man', (game.g.seed ?? 1) + 77);
      n = game.state.spawn('npc', {
        role: 'homeless', look, p: [a.x, a.y, a.z], yaw: -Math.PI / 2, anim: 'sit_floor', animT: 1, animLoop: true,
        name: tl('ลุงพเนจร', 'old wanderer'), face: 'neutral', lookAt: null, hold: null,
      });
    }
    this.buildProps();
  }

  labMove(p: THREE.Vector3) {
    const n = this.npc();
    if (n) { n.p = [p.x, p.y, p.z]; }
    this.placeProps();
  }

  private setAnim(n: Ent, anim: string, loop = true) { n.anim = anim; n.animT = this.now + Math.random() * 0.01; n.animLoop = loop; }

  hostUpdate(_dt: number) {
    const game = this.game;
    const n = this.npc();
    if (!n?.p) return;
    const now = this.now;
    const t = game.clock.time;
    // sleep late at night
    const sleeping = t >= 22.5;
    if (sleeping && n.anim !== 'lie_cardboard') { this.setAnim(n, 'lie_cardboard'); n.face = 'sleep'; }
    if (!sleeping && n.anim === 'lie_cardboard') { this.setAnim(n, 'sit_floor'); n.face = 'neutral'; }
    if (sleeping) {
      if (now > this.sleepSnore) { this.sleepSnore = now + 6; sfx(game, 'snore_loop', n.p, { vol: 0.25, max: 14 }); }
      return;
    }
    // ask passers-by, grumble when ignored
    let closest: Ent | null = null, cd = 4;
    for (const pl of game.players()) {
      if (!pl.p) continue;
      const d = dist2(pl.p, n.p);
      if (d < cd) { cd = d; closest = pl; }
      const asked = this.asked.get(pl.id);
      if (d < 3.6 && (asked === undefined || now - asked > 70)) {
        this.asked.set(pl.id, now);
        const lucky = this.st().today >= 0 && game.g.luckTipDay === game.g.day && (game.g.luckFrom ?? []).includes(pl.id);
        game.say(n.id, lucky ? line('homeless_luck') : line('homeless_ask'), { duration: 3.5 });
      }
      if (asked !== undefined && now - asked < 30 && d > 8 && !(this.grumbled.get(pl.id)! > asked)) {
        this.grumbled.set(pl.id, now);
        game.say(n.id, line('homeless_ignored'), { duration: 3 });
      }
    }
    n.lookAt = closest ? closest.id : null;
    // mutter wisdom to himself now and then
    if (now > this.wisdomT && closest) {
      this.wisdomT = now + 45 + Math.random() * 40;
      if (Math.random() < 0.5) game.say(n.id, line('homeless_wisdom'), { duration: 4, style: 'thought' });
    }
  }

  private hostGive(pl: Ent, amount: number) {
    const game = this.game;
    const n = this.npc();
    if (!n?.p || !pl.p || dist2(pl.p, n.p) > 4) return;
    amount = [1, 5, 20].includes(amount) ? amount : 1;
    if (!game.money(pl.id, -amount, 'homeless', [n.p[0], n.p[1] + 1.1, n.p[2]])) {
      game.say(n.id, line('homeless_broke'), { duration: 3 });
      return;
    }
    const s = this.st();
    if (s.day !== game.g.day) { s.day = game.g.day; s.today = 0; }
    s.today += amount;
    s.given[pl.id] = (s.given[pl.id] ?? 0) + amount;
    this.grumbled.set(pl.id, this.now + 999);
    sfx(game, 'coin', n.p, { vol: 0.8 });
    this.setAnim(n, 'pray', false);
    setTimeout(() => { if (this.npc() === n && n.anim === 'pray') this.setAnim(n, 'sit_floor'); }, 1800);
    const key = amount >= 20 ? 'homeless_big' : amount >= 5 ? 'homeless_thanks' : 'homeless_thanks_small';
    game.say(n.id, line(key), { duration: 3.8 });
    if (amount >= 5 && Math.random() < 0.6) setTimeout(() => game.say(n.id, line('homeless_wisdom'), { duration: 4.5, style: 'thought' }), 4200);
    // gifts
    const gifts = (s.gifts[pl.id] ??= []);
    const total = s.given[pl.id];
    const gift = (kind: string, text: TL) => {
      if (gifts.includes(kind)) return;
      gifts.push(kind);
      setTimeout(() => {
        const it = game.items.give(pl, kind);
        if (it) game.say(n.id, text, { duration: 4.5 });
      }, 5200);
    };
    if (total >= 50) gift('amulet', tl('เอ้า… เหรียญหลวงพ่อ ลุงให้ พกไว้ ผีไม่กล้าเข้าใกล้', 'here, an amulet — ghosts keep away'));
    else if (total >= 20) gift('flashlight', tl('ไฟฉายลุงเก็บได้ เอาไปส่องผีท้ายซอยนะ', 'a flashlight i found — for the ghosts'));
    game.events.emit('life:gave', { player: pl.id, amount, total });
  }

  onNewDay(day: number) {
    const s = this.st();
    const g = this.game.g;
    // kindness yesterday → tip boost today
    if (s.today >= 5) {
      g.luckTip = 1 + Math.min(0.3, s.today / 80);
      g.luckTipDay = day;
      g.luckFrom = Object.keys(s.given).map(Number);
    }
    s.today = 0;
    s.day = day;
    this.asked.clear();
  }

  tipMul(): number {
    const g = this.game.g;
    return g.luckTipDay === g.day ? (g.luckTip ?? 1) : 1;
  }
  luck(playerId: number): number {
    const s = this.game.g.homeless as HState | undefined;
    const merit = this.game.g.merit?.[playerId] ?? 0;
    return Math.min(1, ((s?.given?.[playerId] ?? 0) / 100) + merit * 0.1);
  }

  // ------------------------------------------------------------------ props (every peer)

  private buildProps() {
    const game = this.game;
    if (this.props || !game.scene) return;
    const g = new THREE.Group();
    g.name = 'life:homeless-props';
    // cardboard sheet (real cardboard photo PBR)
    const card = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.012, 0.85), Assets.pbr('cardboard_worn', { repeat: 1, fallback: 0xa9824f }));
    card.position.set(0.05, 0.006, 0);
    card.rotation.y = 0.08;
    card.receiveShadow = true;
    g.add(card);
    const card2 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.01, 0.55), Assets.pbr('cardboard_worn', { repeat: 0.7, fallback: 0xa9824f }));
    card2.position.set(-0.55, 0.014, 0.35);
    card2.rotation.y = -0.4;
    g.add(card2);
    // tin cup for coins (photo of a dented tin can)
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.09, 12, 1, true), new THREE.MeshStandardMaterial({ map: lifeTex('tin_can.jpg', { fallback: '#9a9a96', kind: 'metal' }), metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide }));
    cup.position.set(0.55, 0.05, -0.3);
    cup.castShadow = true;
    g.add(cup);
    const coins = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 10), new THREE.MeshStandardMaterial({ color: '#c9b37a', metalness: 0.9, roughness: 0.3 }));
    coins.position.set(0.55, 0.02, -0.3);
    g.add(coins);
    // bundle of belongings: a stuffed rice sack (real woven sack photo)
    const sack = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshStandardMaterial({ map: lifeTex('rice_sack.jpg', { fallback: '#d8d2bf' }), roughness: 0.9 }));
    sack.scale.set(1, 0.75, 0.8);
    sack.position.set(-0.45, 0.16, -0.38);
    sack.castShadow = true;
    g.add(sack);
    // interaction proxy around him
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.9), proxyMaterial());
    proxy.position.set(0, 0.6, 0);
    g.add(proxy);
    game.interact.register(proxy, { kind: 'homeless', data: { name: tl('ลุงพเนจร', 'old wanderer') } });
    proxy.userData.interact.eid = undefined;
    game.scene.add(g);
    this.props = g;
    this.placeProps();
    game.events.on('world:exit', () => { game.interact.unregister(proxy); this.props = null; });
  }

  private placeProps() {
    const n = this.npc();
    if (!this.props) return;
    const p = n?.p ?? anchorP(this.game, 'homeless_spot', [-7.2, 0.15, -80]).toArray();
    this.props.position.set(p[0], p[1], p[2]);
    this.props.rotation.y = (n?.yaw ?? -Math.PI / 2);
  }
}

/** Minimal npc view used only when the characters module hasn't registered one. */
function fallbackNpcView(game: Game, e: Ent) {
  const rig = game.chars.create(e.look ?? game.chars.randomLook('', e.id), { lod: 'high' });
  const root = new THREE.Group();
  root.add(rig.root);
  root.userData.headHeight = (e.look?.height ?? 1.65) + 0.2;
  if (e.p) root.position.set(e.p[0], e.p[1], e.p[2]);
  root.rotation.y = e.yaw ?? 0;
  game.interact.register(root, { kind: 'npc', eid: e.id, data: { name: e.name ?? tl('คน') } });
  let lastT = -1;
  const prev = root.position.clone();
  let speed = 0;
  return {
    object: root,
    rig,
    update: (e: Ent, dt: number) => {
      if (e.p) { root.position.lerp(new THREE.Vector3(e.p[0], e.p[1], e.p[2]), 1 - Math.exp(-12 * dt)); }
      root.rotation.y += (((e.yaw ?? 0) - root.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * (1 - Math.exp(-10 * dt));
      const d = root.position.distanceTo(prev) / Math.max(dt, 1e-4);
      speed += (Math.min(d, 8) - speed) * (1 - Math.exp(-8 * dt));
      prev.copy(root.position);
      if (e.animT !== undefined && e.animT !== lastT) { lastT = e.animT; if (e.anim) rig.play(e.anim, { loop: !!e.animLoop }); }
      rig.setMove(speed);
      rig.update(dt);
    },
    dispose: () => { game.interact.unregister(root); rig.dispose(); },
  };
}
