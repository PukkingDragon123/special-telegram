import * as THREE from 'three';
import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { F } from '../../core/fonts';
import { Input } from '../../core/input';
import { Sound } from '../../core/audio';
import type { HudApi, HudObjective, HudText } from './api';
import { Hotbar3D } from './hotbar3d';
import { thinkLine } from './monologue';

/* ============================================================================================
 * MODULE `hud` — the screen-space game HUD (DOM, local to each peer):
 * Everything is plain floating text (no panels/boxes) except the inventory, which shows the real 3D items:
 *   top-left  : money (counts up/down, floating +/- deltas)
 *   top-right : objectives (tutorial / story / quests), strike-out on completion
 *   on screen : objective marker (diamond + metres), clamped to the screen edge with an arrow
 *   bottom    : 3D hotbar (hotbar3d.ts): the actual item models turning, selected one lifted + glowing
 *   top-centre: toasts · above the hotbar: inner monologue ("talk to yourself", key T)
 * Hidden in menus/cutscenes/conversations; letterbox via setCinematic(). API: ./api.ts
 * ========================================================================================== */

const txt = (t: HudText | undefined): { th: string; en: string } =>
  !t ? { th: '', en: '' } : typeof t === 'string' ? { th: t, en: '' } : { th: t.th, en: t.en ?? '' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

const CSS = `
.hud{position:fixed;inset:0;pointer-events:none;z-index:9;font-family:${F.ui},sans-serif;color:#fffaf0;--gold:#ffffff;transition:opacity .35s;
  --sh:1px 0 0 #0b0907,-1px 0 0 #0b0907,0 1px 0 #0b0907,0 -1px 0 #0b0907,1px 1px 0 #0b0907,-1px 1px 0 #0b0907,1px -1px 0 #0b0907,-1px -1px 0 #0b0907,0 2px 3px rgba(0,0,0,.55)}
.hud.off{opacity:0}
.hud-money{position:absolute;left:clamp(14px,2vw,30px);top:clamp(10px,1.8vw,26px);font:900 clamp(26px,2.7vw,40px)/1 ${F.ui};
  letter-spacing:.01em;text-shadow:var(--sh);display:flex;align-items:baseline;gap:.22em}
.hud-money b{color:#fff;font-weight:900}
.hud-money.up{animation:hudPop .45s}.hud-money.down{animation:hudShake .4s}
.hud-delta{position:absolute;left:100%;top:.1em;margin-left:.45em;font:800 .62em ${F.ui};white-space:nowrap;animation:hudDelta 1.6s ease-out forwards}
.hud-delta.p{color:#a6ffb0}.hud-delta.n{color:#ff9b8a}
.hud-q{position:absolute;right:clamp(14px,2vw,30px);top:clamp(12px,2vw,28px);width:min(36vw,440px);display:flex;flex-direction:column;gap:14px;text-align:right}
.hud-obj{animation:hudIn .55s cubic-bezier(.2,1.3,.4,1) both;text-shadow:var(--sh)}
.hud-obj .t{font:800 clamp(16px,1.45vw,21px)/1.22 ${F.ui}}
.hud-obj .t i{display:inline-block;width:.38em;height:.38em;transform:rotate(45deg) translateY(-.1em);background:#fff;margin-left:.45em;outline:1.5px solid #0b0907}
.hud-obj .en{font:500 clamp(11px,.95vw,13px)/1.3 ${F.ui};opacity:.7;margin-top:1px}
.hud-obj .sub{font:600 clamp(12.5px,1.05vw,15px)/1.35 ${F.ui};color:#f2f2f2;margin-top:4px}
.hud-obj .pr{color:#fff}
.hud-obj.flash .t{animation:hudPop .4s}
.hud-obj.done .t{color:#9be8a5}.hud-obj.done .t span{text-decoration:line-through;text-decoration-thickness:2px}
.hud-obj.out{animation:hudOut .5s ease-in forwards}
.hud-mark{position:absolute;left:0;top:0;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:2px;transition:opacity .25s;text-shadow:var(--sh)}
.hud-mark .d{width:10px;height:10px;transform:rotate(45deg);background:#fff;outline:1.5px solid rgba(10,8,6,.85)}
.hud-mark .m{font:700 11px ${F.ui};color:#fff;white-space:nowrap}
.hud-mark .a{position:absolute;width:0;height:0;border:6px solid transparent;border-left:9px solid #fff;left:50%;top:5px;transform-origin:0 50%;display:none;filter:drop-shadow(0 0 1px #000)}
.hud-mark.edge .a{display:block}
.hud-keys{position:absolute;left:50%;bottom:0;width:0;height:0}
.hud-keys span{position:absolute;transform:translate(-50%,0);font:800 11px ${F.ui};opacity:.45;text-shadow:var(--sh);transition:opacity .2s,color .2s}
.hud-keys span.sel{opacity:1;color:#fff}
.hud-name{position:absolute;left:50%;transform:translateX(-50%);font:800 clamp(14px,1.25vw,18px) ${F.ui};text-shadow:var(--sh);opacity:0;transition:opacity .3s;white-space:nowrap}
.hud-name.on{opacity:1}
.hud-name small{font-weight:500;opacity:.7}
.hud-over{position:absolute;left:50%;transform:translateX(-50%);font:800 14px ${F.ui};color:#ff9a86;text-shadow:var(--sh);display:none;animation:hudBlink 1s infinite;white-space:nowrap}
.hud-over.on{display:block}
.hud-toasts{position:absolute;left:50%;top:clamp(14px,3vh,34px);transform:translateX(-50%);display:flex;flex-direction:column;gap:4px;align-items:center}
.hud-toast{font:800 clamp(15px,1.4vw,20px) ${F.ui};text-shadow:var(--sh);animation:hudToast var(--life,3s) ease both;white-space:nowrap}
.hud-toast.good{color:#9be8a5}.hud-toast.bad{color:#ff9a86}
.hud-toast small{font-weight:500;opacity:.65}
.hud-mono{position:absolute;left:50%;transform:translateX(-50%);max-width:min(70vw,860px);text-align:center;
  font:italic 600 clamp(15px,1.5vw,21px)/1.35 ${F.ui};color:#fff3da;text-shadow:var(--sh);opacity:0;transition:opacity .35s}
.hud-mono.on{opacity:1}
.hud-mono small{display:block;font:italic 500 .68em/1.3 ${F.ui};opacity:.7;margin-top:2px}
.hud-lb{position:absolute;left:0;right:0;height:0;background:#000;transition:height .7s cubic-bezier(.6,0,.2,1);z-index:2}
.hud-lb.t{top:0}.hud-lb.b{bottom:0}
@keyframes hudPop{0%{transform:scale(1)}35%{transform:scale(1.12)}100%{transform:scale(1)}}
@keyframes hudShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
@keyframes hudDelta{0%{opacity:0;transform:translate(-6px,0)}12%{opacity:1;transform:none}100%{opacity:0;transform:translate(8px,-28px)}}
@keyframes hudIn{from{opacity:0;transform:translateX(24px);filter:blur(4px)}to{opacity:1;transform:none;filter:none}}
@keyframes hudOut{to{opacity:0;transform:translateX(30px);filter:blur(4px)}}
@keyframes hudBob{0%,100%{transform:rotate(45deg) translate(0,0)}50%{transform:rotate(45deg) translate(-3px,-3px)}}
@keyframes hudBlink{50%{opacity:.45}}
@keyframes hudToast{0%{opacity:0;transform:translateY(-8px)}8%{opacity:1;transform:none}85%{opacity:1}100%{opacity:0;transform:translateY(-6px)}}
`;

interface ObjView { o: HudObjective; el: HTMLDivElement; sig: string; leaving: boolean }

class Hud implements HudApi {
  private root!: HTMLDivElement;
  private money!: HTMLDivElement;
  private moneyNum!: HTMLSpanElement;
  private objBox!: HTMLDivElement;
  private mark!: HTMLDivElement;
  private keys!: HTMLDivElement;
  private nameEl!: HTMLDivElement;
  private overEl!: HTMLDivElement;
  private toastBox!: HTMLDivElement;
  private mono!: HTMLDivElement;
  private lb: HTMLDivElement[] = [];
  private objs = new Map<string, ObjView>();
  private shown = 0;
  private target = 0;
  private selSig = -1;
  private invSig = '';
  private nameT = 0;
  private monoT = 0;
  private cine = false;
  hidden = false;
  private bar: Hotbar3D;
  private v = new THREE.Vector3();
  private thinkCd = 0;
  private t = 0;

  constructor(private game: Game) {
    this.bar = new Hotbar3D(game);
    this.build();
    game.events.on('money', (d: { player: number; delta: number; wallet: number }) => {
      if (d.player !== game.localPlayerId) return;
      this.target = d.wallet;
      this.delta(d.delta);
    });
  }

  private build() {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    const r = (this.root = document.createElement('div'));
    r.className = 'hud off';
    r.innerHTML = `
      <div class="hud-lb t"></div><div class="hud-lb b"></div>
      <div class="hud-money"><b>฿</b><span>0</span></div>
      <div class="hud-q"></div>
      <div class="hud-mark"><div class="a"></div><div class="d"></div><div class="m"></div></div>
      <div class="hud-toasts"></div>
      <div class="hud-mono"></div>
      <div class="hud-keys">${[1, 2, 3, 4, 5].map((n) => `<span>${n}</span>`).join('')}</div>
      <div class="hud-name"></div>
      <div class="hud-over">หนักเกินไป! กด Q วางของ</div>`;
    document.body.appendChild(r);
    const q = <T extends HTMLElement>(sel: string) => r.querySelector(sel) as T;
    this.money = q('.hud-money'); this.moneyNum = q('.hud-money span');
    this.objBox = q('.hud-q'); this.mark = q('.hud-mark'); this.keys = q('.hud-keys');
    this.nameEl = q('.hud-name'); this.overEl = q('.hud-over'); this.toastBox = q('.hud-toasts'); this.mono = q('.hud-mono');
    this.lb = [q('.hud-lb.t'), q('.hud-lb.b')];
  }

  // ------------------------------------------------------------------ API
  setObjective(o: HudObjective) {
    const ex = this.objs.get(o.id);
    const t = txt(o.text), s = txt(o.sub);
    const sig = t.th + '|' + t.en + '|' + s.th + '|' + s.en + '|' + (o.progress ? o.progress.have + '/' + o.progress.need : '');
    if (ex && !ex.leaving) {
      ex.o = o;
      if (ex.sig !== sig) { ex.sig = sig; this.fillObj(ex.el, o); ex.el.classList.remove('flash'); void ex.el.offsetWidth; ex.el.classList.add('flash'); }
      return;
    }
    const el = document.createElement('div');
    el.className = 'hud-obj';
    this.fillObj(el, o);
    this.objs.set(o.id, { o, el, sig, leaving: false });
    this.sortObjs();
    if (!this.hidden) Sound.play('whoosh_text', { vol: 0.18, pitch: 1.3 });
  }

  clearObjective(id: string, completed = false) {
    const v = this.objs.get(id);
    if (!v || v.leaving) return;
    v.leaving = true;
    const kill = (ms: number) => setTimeout(() => { v.el.remove(); if (this.objs.get(id) === v) this.objs.delete(id); }, ms);
    if (completed) {
      v.el.classList.add('done');
      Sound.play('coins', { vol: 0.15, pitch: 1.5 });
      setTimeout(() => v.el.classList.add('out'), 900); kill(1450);
    } else { v.el.classList.add('out'); kill(520); }
  }

  toast(text: HudText, opts: { kind?: 'info' | 'good' | 'bad'; dur?: number } = {}) {
    const t = txt(text);
    const el = document.createElement('div');
    const dur = opts.dur ?? 3;
    el.className = 'hud-toast ' + (opts.kind ?? 'info');
    el.style.setProperty('--life', dur + 's');
    el.textContent = t.th;
    this.toastBox.appendChild(el);
    while (this.toastBox.children.length > 3) this.toastBox.firstElementChild?.remove();
    setTimeout(() => el.remove(), dur * 1000 + 100);
  }

  monologue(text: HudText, dur?: number) {
    const t = txt(text);
    const d = dur ?? Math.min(6.5, 2.2 + t.th.length * 0.055);
    this.mono.textContent = `“${t.th}”`;
    this.mono.classList.add('on');
    this.monoT = d;
  }

  setCinematic(on: boolean) {
    this.cine = on;
    for (const b of this.lb) b.style.height = on ? '10.5vh' : '0';
  }

  // ------------------------------------------------------------------ internals
  private fillObj(el: HTMLDivElement, o: HudObjective) {
    const t = txt(o.text), s = txt(o.sub);
    el.innerHTML = `<div class="t"><span>${esc(t.th)}</span>${o.progress ? ` <span class="pr">${o.progress.have}/${o.progress.need}</span>` : ''}<i></i></div>
      ${s.th ? `<div class="sub">${esc(s.th)}</div>` : ''}`;
  }

  private sortObjs() {
    const list = [...this.objs.values()].filter((v) => !v.leaving).sort((a, b) => (a.o.priority ?? 10) - (b.o.priority ?? 10));
    list.forEach((v, i) => { if (this.objBox.children[i] !== v.el) this.objBox.insertBefore(v.el, this.objBox.children[i] ?? null); });
    list.forEach((v, i) => { v.el.style.display = i < 3 ? '' : 'none'; });
  }

  private delta(d: number) {
    if (!d || this.hidden) return;
    const el = document.createElement('div');
    el.className = 'hud-delta ' + (d > 0 ? 'p' : 'n');
    el.textContent = (d > 0 ? '+' : '−') + fmt(Math.abs(d));
    this.money.appendChild(el);
    setTimeout(() => el.remove(), 1700);
    this.money.classList.remove('up', 'down'); void this.money.offsetWidth;
    this.money.classList.add(d > 0 ? 'up' : 'down');
  }

  private targetOf(o: HudObjective): THREE.Vector3 | null {
    const t = o.target;
    if (!t) return null;
    try { return typeof t === 'function' ? t() : t; } catch { return null; }
  }

  frame(dt: number) {
    const game = this.game;
    this.t += dt;
    const me = game.me;
    const inWorld = game.scenes.currentName === 'world' && !!me && !!game.player;
    const mode = game.player?.mode;
    const talking = !!(game as any).questTalking?.();
    const show = inWorld && !this.hidden && !this.cine && mode !== 'external' && !talking;
    this.root.classList.toggle('off', !show && !this.cine);
    for (const el of [this.money, this.objBox, this.mark, this.keys, this.nameEl, this.overEl] as HTMLElement[]) el.style.opacity = show ? '' : '0';
    this.bar.update(dt, me, show);
    if (!inWorld || !me) return;

    // ---- money (counts toward the real value)
    this.target = me.wallet ?? 0;
    if (Math.abs(this.shown - this.target) > 0.5) {
      this.shown += (this.target - this.shown) * Math.min(1, dt * 7);
      if (Math.abs(this.shown - this.target) < 0.6) this.shown = this.target;
      this.moneyNum.textContent = fmt(this.shown);
    } else if (this.moneyNum.textContent !== fmt(this.target)) { this.shown = this.target; this.moneyNum.textContent = fmt(this.target); }

    // ---- hotbar labels (numbers under the 3D items, selected name above)
    const inv: (number | null)[] = me.inv ?? [];
    const sel = me.sel ?? 0;
    const H = innerHeight;
    const ky = this.bar.baseY - this.bar.slotSize * 0.62;
    const spans = this.keys.children;
    for (let i = 0; i < 5; i++) {
      const el = spans[i] as HTMLElement;
      el.style.left = this.bar.slotX[i].toFixed(1) + 'px';
      el.style.bottom = Math.max(4, ky - 14).toFixed(1) + 'px';
      el.classList.toggle('sel', i === sel);
    }
    const isig = inv.join(',') + '|' + sel;
    if (isig !== this.invSig) {
      this.invSig = isig;
      if (sel !== this.selSig) { this.selSig = sel; this.nameT = 2.2; }
      const e = inv[sel] != null ? game.state.get(inv[sel]!) : null;
      const n = e ? game.items.name(e) : null;
      this.nameEl.textContent = n ? n.th : '';
      if (e) this.nameT = Math.max(this.nameT, 2.2);
    }
    this.nameT -= dt;
    this.nameEl.style.bottom = (this.bar.baseY + this.bar.slotSize * 0.85).toFixed(1) + 'px';
    this.nameEl.classList.toggle('on', this.nameT > 0 && !!this.nameEl.textContent);
    const over = game.items.isOverloaded(me);
    this.overEl.style.bottom = (this.bar.baseY + this.bar.slotSize * 0.85 + 26).toFixed(1) + 'px';
    this.overEl.classList.toggle('on', over);
    this.mono.style.bottom = (this.bar.baseY + this.bar.slotSize * 0.85 + (over ? 56 : 34)).toFixed(1) + 'px';
    void H;

    // ---- monologue
    if (this.monoT > 0) { this.monoT -= dt; if (this.monoT <= 0) this.mono.classList.remove('on'); }

    // ---- "talk to yourself" (T): think out loud — everyone sees the thought bubble
    this.thinkCd -= dt;
    if (show && mode === 'play' && Input.wasPressed('KeyT') && this.thinkCd <= 0 && !game.ui.choosing) {
      this.thinkCd = 1.2;
      const line = thinkLine(game);
      this.monologue(line);
      game.intent('hud.think', { th: line.th, en: line.en });
    }

    // ---- objective marker (first objective with a target)
    let tgt: THREE.Vector3 | null = null;
    for (const v of [...this.objs.values()].sort((a, b) => (a.o.priority ?? 10) - (b.o.priority ?? 10))) {
      if (v.leaving) continue;
      tgt = this.targetOf(v.o);
      if (tgt) break;
    }
    const cam = game.camera;
    if (tgt && show) {
      const d = Math.hypot(tgt.x - game.player.pos.x, tgt.z - game.player.pos.z);
      this.v.copy(tgt).project(cam);
      const behind = this.v.z > 1;
      let x = this.v.x, y = this.v.y;
      if (behind) { x = -x; y = -y; }
      const W = innerWidth, Hh = innerHeight, pad = 46;
      let sx = (x * 0.5 + 0.5) * W, sy = (-y * 0.5 + 0.5) * Hh;
      const off = behind || sx < pad || sx > W - pad || sy < pad || sy > Hh - pad;
      if (off) {
        const cx = W / 2, cy = Hh / 2;
        const dx = sx - cx; let dy = sy - cy;
        if (behind && Math.abs(dy) < 1) dy = Hh;
        const k = Math.min((W / 2 - pad) / Math.max(1e-3, Math.abs(dx)), (Hh / 2 - pad) / Math.max(1e-3, Math.abs(dy)));
        sx = cx + dx * k; sy = cy + dy * k;
        (this.mark.firstElementChild as HTMLElement).style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      }
      this.mark.classList.toggle('edge', off);
      this.mark.style.left = sx.toFixed(1) + 'px';
      this.mark.style.top = sy.toFixed(1) + 'px';
      this.mark.style.opacity = d < 2.5 ? '0' : '1';
      (this.mark.lastElementChild as HTMLElement).textContent = Math.round(d) + ' ม.';
    } else this.mark.style.opacity = '0';
  }
}

let hud: Hud | null = null;
let errLogged = false;

export default defineModule({
  id: 'hud',
  deps: ['characters'],
  init(game: Game) {
    hud = new Hud(game);
    (game as any).hud = hud;
    // host relays think-out-loud as a thought bubble over the player's head for everyone
    game.onIntent('hud.think', (pl: Ent, d: { th: string; en?: string }) => {
      if (typeof d?.th !== 'string') return;
      game.say(pl.id, { th: d.th.slice(0, 140), en: d.en?.slice(0, 160) }, { style: 'thought', duration: 3.5 });
    });
  },
  frame(game: Game, dt: number) {
    try { hud?.frame(dt); } catch (e) { if (!errLogged) { errLogged = true; console.error('[hud]', e); } }
  },
});
