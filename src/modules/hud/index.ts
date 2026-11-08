import * as THREE from 'three';
import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { F } from '../../core/fonts';
import { Input } from '../../core/input';
import { Sound } from '../../core/audio';
import type { HudApi, HudObjective, HudText } from './api';
import { IconBaker } from './icons';
import { thinkLine } from './monologue';

/* ============================================================================================
 * MODULE `hud` — the screen-space game HUD (DOM, local to each peer):
 *   top-left  : wallet (counts up/down, floating +/- deltas) · clock + day (sun/moon)
 *   top-right : objectives (tutorial / story / quests) with tick + strike-out on completion
 *   on screen : objective marker (diamond + metres), clamped to the screen edge with an arrow
 *   bottom    : 5-slot inventory hotbar with real 3D item icons, selected name, weight meter
 *   top-centre: toasts · bottom-centre: inner monologue ("talk to yourself", key T)
 * Hidden in menus/cutscenes/conversations; letterbox via setCinematic(). API: ./api.ts
 * ========================================================================================== */

const txt = (t: HudText | undefined): { th: string; en: string } =>
  !t ? { th: '', en: '' } : typeof t === 'string' ? { th: t, en: '' } : { th: t.th, en: t.en ?? '' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

const CSS = `
.hud{position:fixed;inset:0;pointer-events:none;z-index:9;font-family:${F.ui},sans-serif;color:#fff7e8;
  --gold:#ffcf5a;--glass:rgba(16,13,10,.58);--line:rgba(255,236,200,.16);transition:opacity .35s;}
.hud.off{opacity:0}
.hud .panel{background:var(--glass);border:1px solid var(--line);border-radius:14px;backdrop-filter:blur(6px);
  box-shadow:0 6px 24px rgba(0,0,0,.35)}
.hud-tl{position:absolute;left:clamp(10px,1.6vw,24px);top:clamp(10px,1.6vw,24px);display:flex;flex-direction:column;gap:8px}
.hud-wallet{display:flex;align-items:center;gap:10px;padding:8px 16px 8px 10px;font:800 clamp(20px,2.1vw,30px)/1 ${F.ui};
  letter-spacing:.01em;position:relative}
.hud-wallet .coin{width:1.15em;height:1.15em;border-radius:50%;flex:none;background:radial-gradient(circle at 35% 30%,#fff1b0,#f2b72f 45%,#a56a10 100%);
  box-shadow:inset 0 0 0 2px rgba(120,70,0,.55),0 2px 6px rgba(0,0,0,.4);display:grid;place-items:center;font:900 .62em ${F.ui};color:#7a4a00}
.hud-wallet.up{animation:hudPulse .45s}.hud-wallet.down{animation:hudShake .4s}
.hud-delta{position:absolute;left:100%;top:50%;margin-left:10px;font:800 clamp(16px,1.6vw,22px) ${F.ui};white-space:nowrap;
  animation:hudDelta 1.5s ease-out forwards;text-shadow:0 2px 6px rgba(0,0,0,.7)}
.hud-delta.p{color:#8dff9b}.hud-delta.n{color:#ff8c7a}
.hud-clock{display:flex;align-items:center;gap:8px;padding:6px 14px 6px 10px;font:700 clamp(14px,1.3vw,18px)/1 ${F.ui};width:max-content}
.hud-clock .ico{width:18px;height:18px;border-radius:50%;flex:none}
.hud-clock .ico.sun{background:radial-gradient(circle,#fff6c4 30%,#ffbf3a 62%,rgba(255,180,40,0) 70%)}
.hud-clock .ico.moon{background:radial-gradient(circle at 65% 35%,transparent 38%,#e8ecff 40%);box-shadow:none}
.hud-clock small{opacity:.7;font-weight:500}
.hud-tr{position:absolute;right:clamp(10px,1.6vw,24px);top:clamp(10px,1.6vw,24px);width:min(31vw,380px);display:flex;flex-direction:column;gap:8px;align-items:stretch}
.hud-obj{padding:10px 14px 11px 14px;position:relative;overflow:hidden;animation:hudIn .5s cubic-bezier(.2,1.4,.4,1) both}
.hud-obj .tag{font:800 10.5px/1 ${F.ui};letter-spacing:.14em;color:var(--gold);opacity:.95;margin-bottom:5px;text-transform:uppercase}
.hud-obj .t{font:700 clamp(15px,1.3vw,19px)/1.25 ${F.ui};display:flex;gap:8px;align-items:flex-start}
.hud-obj .t i{flex:none;width:9px;height:9px;margin-top:.42em;transform:rotate(45deg);border:2px solid var(--gold);border-radius:2px}
.hud-obj .en{font:500 clamp(11px,.95vw,13px)/1.3 ${F.ui};opacity:.62;margin:2px 0 0 17px}
.hud-obj .sub{font:500 clamp(12px,1vw,14px)/1.35 ${F.ui};opacity:.88;margin:5px 0 0 17px;color:#ffe9c2}
.hud-obj .pr{margin:6px 0 0 17px;height:4px;border-radius:2px;background:rgba(255,255,255,.14);overflow:hidden}
.hud-obj .pr b{display:block;height:100%;background:var(--gold);transition:width .4s}
.hud-obj.flash{animation:hudFlash .7s}
.hud-obj.done .t{color:#9dffaa}.hud-obj.done .t i{background:#9dffaa;border-color:#9dffaa}
.hud-obj.done .t span{text-decoration:line-through;text-decoration-thickness:2px}
.hud-obj.out{animation:hudOut .5s ease-in forwards}
.hud-mark{position:absolute;left:0;top:0;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:3px;transition:opacity .25s}
.hud-mark .d{width:16px;height:16px;transform:rotate(45deg);border:2.5px solid var(--gold);background:rgba(255,207,90,.25);
  box-shadow:0 0 12px rgba(255,200,80,.6);animation:hudBob 1.6s ease-in-out infinite}
.hud-mark .m{font:700 12px ${F.ui};text-shadow:0 1px 4px #000;white-space:nowrap}
.hud-mark .a{position:absolute;width:0;height:0;border:8px solid transparent;border-left:12px solid var(--gold);left:50%;top:8px;
  transform-origin:0 50%;filter:drop-shadow(0 0 4px rgba(0,0,0,.6));display:none}
.hud-mark.edge .a{display:block}.hud-mark.edge .d{animation:none}
.hud-bar{position:absolute;left:50%;bottom:clamp(10px,1.8vh,22px);transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:7px}
.hud-name{font:700 clamp(13px,1.15vw,16px) ${F.ui};text-shadow:0 2px 6px rgba(0,0,0,.85);opacity:0;transition:opacity .3s;white-space:nowrap}
.hud-name.on{opacity:1}
.hud-slots{display:flex;gap:6px;padding:6px;border-radius:16px}
.hud-slot{width:clamp(46px,4.3vw,62px);height:clamp(46px,4.3vw,62px);border-radius:11px;position:relative;background:rgba(255,255,255,.06);
  border:1.5px solid rgba(255,255,255,.12);transition:transform .15s,border-color .15s,background .15s}
.hud-slot.sel{border-color:var(--gold);background:rgba(255,207,90,.16);transform:translateY(-4px) scale(1.06);box-shadow:0 0 16px rgba(255,200,80,.35)}
.hud-slot .k{position:absolute;left:5px;top:3px;font:700 10px ${F.ui};opacity:.55}
.hud-slot img{position:absolute;inset:4px;width:calc(100% - 8px);height:calc(100% - 8px);object-fit:contain;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))}
.hud-slot .ph{position:absolute;inset:0;display:grid;place-items:center;font:700 10px/1.1 ${F.ui};text-align:center;padding:4px;opacity:.85}
.hud-slot.cont{border-left-color:transparent;margin-left:-8px;width:calc(clamp(46px,4.3vw,62px) + 2px);border-top-left-radius:0;border-bottom-left-radius:0}
.hud-slot.cont .k{display:none}
.hud-weight{width:100%;height:4px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden}
.hud-weight b{display:block;height:100%;background:linear-gradient(90deg,#9dffaa,#ffcf5a 60%,#ff7a5a);transition:width .3s}
.hud-over{font:800 13px ${F.ui};color:#ff9b85;text-shadow:0 1px 4px #000;display:none;animation:hudBlink 1s infinite}
.hud-over.on{display:block}
.hud-toasts{position:absolute;left:50%;top:clamp(12px,2.2vh,26px);transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;align-items:center}
.hud-toast{padding:8px 18px;font:700 clamp(13px,1.2vw,16px) ${F.ui};animation:hudToast var(--life,3s) ease both;white-space:nowrap}
.hud-toast.good{border-color:rgba(140,255,160,.45)}.hud-toast.bad{border-color:rgba(255,130,110,.5)}
.hud-mono{position:absolute;left:50%;bottom:calc(clamp(10px,1.8vh,22px) + clamp(46px,4.3vw,62px) + 52px);transform:translateX(-50%);
  max-width:min(70vw,860px);text-align:center;font:italic 600 clamp(15px,1.5vw,21px)/1.35 ${F.ui};color:#fff3da;
  text-shadow:0 2px 8px rgba(0,0,0,.9),0 0 2px #000;opacity:0;transition:opacity .35s}
.hud-mono.on{opacity:1}
.hud-mono .q{display:block;font:800 10px/1 ${F.ui};letter-spacing:.18em;color:var(--gold);margin-bottom:4px;font-style:normal}
.hud-mono small{display:block;font:italic 500 .68em/1.3 ${F.ui};opacity:.7;margin-top:2px}
.hud-lb{position:absolute;left:0;right:0;height:0;background:#000;transition:height .7s cubic-bezier(.6,0,.2,1);z-index:2}
.hud-lb.t{top:0}.hud-lb.b{bottom:0}
.hud-help{position:absolute;right:clamp(10px,1.6vw,24px);bottom:clamp(10px,1.8vh,22px);font:500 11.5px/1.6 ${F.ui};opacity:.6;text-align:right;text-shadow:0 1px 3px #000}
.hud-help kbd{display:inline-block;min-width:1.5em;padding:0 .3em;border:1px solid rgba(255,255,255,.4);border-bottom-width:2px;border-radius:4px;font:700 10.5px ${F.ui};text-align:center;margin-left:3px}
@keyframes hudPulse{0%{transform:scale(1)}35%{transform:scale(1.08)}100%{transform:scale(1)}}
@keyframes hudShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
@keyframes hudDelta{0%{opacity:0;transform:translate(-6px,-50%)}12%{opacity:1;transform:translate(0,-50%)}100%{opacity:0;transform:translate(10px,-140%)}}
@keyframes hudIn{from{opacity:0;transform:translateX(30px) scale(.96)}to{opacity:1;transform:none}}
@keyframes hudOut{to{opacity:0;transform:translateX(40px);max-height:0;padding-top:0;padding-bottom:0;margin-top:-8px}}
@keyframes hudFlash{0%{box-shadow:0 0 0 0 rgba(255,207,90,.8)}100%{box-shadow:0 0 0 14px rgba(255,207,90,0)}}
@keyframes hudBob{0%,100%{transform:rotate(45deg) translate(0,0)}50%{transform:rotate(45deg) translate(-3px,-3px)}}
@keyframes hudBlink{50%{opacity:.45}}
@keyframes hudToast{0%{opacity:0;transform:translateY(-10px) scale(.95)}8%{opacity:1;transform:none}85%{opacity:1}100%{opacity:0;transform:translateY(-6px)}}
`;

interface ObjView { o: HudObjective; el: HTMLDivElement; sig: string; leaving: boolean }

class Hud implements HudApi {
  private root!: HTMLDivElement;
  private wallet!: HTMLDivElement;
  private walletNum!: HTMLSpanElement;
  private clock!: HTMLDivElement;
  private objBox!: HTMLDivElement;
  private mark!: HTMLDivElement;
  private slotsEl!: HTMLDivElement;
  private nameEl!: HTMLDivElement;
  private weightEl!: HTMLElement;
  private overEl!: HTMLDivElement;
  private toastBox!: HTMLDivElement;
  private mono!: HTMLDivElement;
  private lb: HTMLDivElement[] = [];
  private objs = new Map<string, ObjView>();
  private shownWallet = 0;
  private targetWallet = 0;
  private clockSig = '';
  private slotSig = '';
  private selSig = -1;
  private nameT = 0;
  private monoT = 0;
  private cine = false;
  hidden = false;
  private icons: IconBaker;
  private v = new THREE.Vector3();
  private thinkCd = 0;
  private t = 0;

  constructor(private game: Game) {
    this.icons = new IconBaker(game);
    this.icons.onChange(() => { this.slotSig = ''; });
    this.build();
    game.events.on('money', (d: { player: number; delta: number; wallet: number }) => {
      if (d.player !== game.localPlayerId) return;
      this.targetWallet = d.wallet;
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
      <div class="hud-tl">
        <div class="hud-wallet panel"><div class="coin">฿</div><span>0</span></div>
        <div class="hud-clock panel"><div class="ico sun"></div><span></span></div>
      </div>
      <div class="hud-tr"></div>
      <div class="hud-mark"><div class="a"></div><div class="d"></div><div class="m"></div></div>
      <div class="hud-toasts"></div>
      <div class="hud-mono"></div>
      <div class="hud-bar">
        <div class="hud-over">หนักเกินไป! กด Q วางของ · OVERLOADED — press Q to drop</div>
        <div class="hud-name"></div>
        <div class="hud-slots panel"></div>
        <div class="hud-weight"><b style="width:0%"></b></div>
      </div>
      <div class="hud-help"><span>มุมกล้อง<kbd>V</kbd></span> · <span>คิดในใจ<kbd>T</kbd></span> · <span>วางของ<kbd>Q</kbd></span></div>`;
    document.body.appendChild(r);
    const q = <T extends HTMLElement>(s: string) => r.querySelector(s) as T;
    this.wallet = q('.hud-wallet'); this.walletNum = q('.hud-wallet span');
    this.clock = q('.hud-clock'); this.objBox = q('.hud-tr'); this.mark = q('.hud-mark');
    this.slotsEl = q('.hud-slots'); this.nameEl = q('.hud-name'); this.weightEl = q('.hud-weight b');
    this.overEl = q('.hud-over'); this.toastBox = q('.hud-toasts'); this.mono = q('.hud-mono');
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
    el.className = 'hud-obj panel';
    this.fillObj(el, o);
    const v: ObjView = { o, el, sig, leaving: false };
    this.objs.set(o.id, v);
    this.sortObjs();
    if (!this.hidden) Sound.play('whoosh_text', { vol: 0.18, pitch: 1.3 });
  }

  clearObjective(id: string, completed = false) {
    const v = this.objs.get(id);
    if (!v || v.leaving) return;
    v.leaving = true;
    if (completed) {
      v.el.classList.add('done');
      Sound.play('coins', { vol: 0.15, pitch: 1.5 });
      setTimeout(() => v.el.classList.add('out'), 900);
      setTimeout(() => { v.el.remove(); if (this.objs.get(id) === v) this.objs.delete(id); }, 1450);
    } else {
      v.el.classList.add('out');
      setTimeout(() => { v.el.remove(); if (this.objs.get(id) === v) this.objs.delete(id); }, 520);
    }
  }

  toast(text: HudText, opts: { kind?: 'info' | 'good' | 'bad'; dur?: number } = {}) {
    const t = txt(text);
    const el = document.createElement('div');
    const dur = opts.dur ?? 3;
    el.className = 'hud-toast panel ' + (opts.kind ?? 'info');
    el.style.setProperty('--life', dur + 's');
    el.innerHTML = esc(t.th) + (t.en ? ` <span style="opacity:.6;font-weight:500">· ${esc(t.en)}</span>` : '');
    this.toastBox.appendChild(el);
    while (this.toastBox.children.length > 3) this.toastBox.firstElementChild?.remove();
    setTimeout(() => el.remove(), dur * 1000 + 100);
  }

  monologue(text: HudText, dur?: number) {
    const t = txt(text);
    const d = dur ?? Math.min(6.5, 2.2 + t.th.length * 0.055);
    this.mono.innerHTML = `<span class="q">คิดในใจ · THINKING</span>${esc(t.th)}${t.en ? `<small>${esc(t.en)}</small>` : ''}`;
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
    const pr = o.progress ? Math.max(0, Math.min(1, o.progress.have / Math.max(1, o.progress.need))) : -1;
    const tag = (o.priority ?? 10) <= 0 ? 'บทเรียน · TUTORIAL' : (o.priority ?? 10) < 10 ? 'เนื้อเรื่อง · STORY' : 'ภารกิจ · QUEST';
    el.innerHTML = `<div class="tag">${tag}</div>
      <div class="t"><i></i><span>${esc(t.th)}${o.progress ? ` <b style="color:var(--gold)">${o.progress.have}/${o.progress.need}</b>` : ''}</span></div>
      ${t.en ? `<div class="en">${esc(t.en)}</div>` : ''}
      ${s.th ? `<div class="sub">${esc(s.th)}${s.en ? ` <span style="opacity:.6">· ${esc(s.en)}</span>` : ''}</div>` : ''}
      ${pr >= 0 ? `<div class="pr"><b style="width:${(pr * 100).toFixed(0)}%"></b></div>` : ''}`;
  }

  private sortObjs() {
    const list = [...this.objs.values()].filter((v) => !v.leaving).sort((a, b) => (a.o.priority ?? 10) - (b.o.priority ?? 10));
    list.forEach((v, i) => {
      if (this.objBox.children[i] !== v.el) this.objBox.insertBefore(v.el, this.objBox.children[i] ?? null);
    });
    // at most 4 visible
    list.forEach((v, i) => { v.el.style.display = i < 4 ? '' : 'none'; });
  }

  private delta(d: number) {
    if (!d || this.hidden) return;
    const el = document.createElement('div');
    el.className = 'hud-delta ' + (d > 0 ? 'p' : 'n');
    el.textContent = (d > 0 ? '+' : '−') + fmt(Math.abs(d)) + ' ฿';
    this.wallet.appendChild(el);
    setTimeout(() => el.remove(), 1600);
    this.wallet.classList.remove('up', 'down'); void this.wallet.offsetWidth;
    this.wallet.classList.add(d > 0 ? 'up' : 'down');
  }

  private target(o: HudObjective): THREE.Vector3 | null {
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
    // letterbox stays visible in cinematic mode, everything else hides
    for (const el of [this.root.querySelector('.hud-tl'), this.objBox, this.mark, this.root.querySelector('.hud-bar'), this.root.querySelector('.hud-help')] as HTMLElement[])
      el.style.opacity = show ? '' : '0';
    if (!inWorld || !me) return;
    this.icons.update(this.t);

    // ---- wallet (count toward the real value)
    this.targetWallet = me.wallet ?? 0;
    if (Math.abs(this.shownWallet - this.targetWallet) > 0.5) {
      this.shownWallet += (this.targetWallet - this.shownWallet) * Math.min(1, dt * 7);
      if (Math.abs(this.shownWallet - this.targetWallet) < 0.6) this.shownWallet = this.targetWallet;
      this.walletNum.textContent = fmt(this.shownWallet);
    } else if (this.walletNum.textContent === '0' && this.targetWallet) { this.shownWallet = this.targetWallet; this.walletNum.textContent = fmt(this.targetWallet); }

    // ---- clock
    const clk = (game as any).clock;
    if (clk) {
      const sig = clk.label() + '|' + (game.g.day ?? 1);
      if (sig !== this.clockSig) {
        this.clockSig = sig;
        const night = clk.isNight;
        (this.clock.firstElementChild as HTMLElement).className = 'ico ' + (night ? 'moon' : 'sun');
        (this.clock.lastElementChild as HTMLElement).innerHTML = `${clk.label()} <small>· วันที่ ${game.g.day ?? 1}</small>`;
      }
    }

    // ---- hotbar
    const inv: (number | null)[] = me.inv ?? [null, null, null, null, null];
    const sel = me.sel ?? 0;
    const sig = inv.join(',') + '|' + sel;
    if (sig !== this.slotSig) {
      this.slotSig = sig;
      let html = '';
      for (let i = 0; i < 5; i++) {
        const id = inv[i];
        const cont = i > 0 && id != null && inv[i - 1] === id;
        const e = id != null ? game.state.get(id) : null;
        let inner = `<span class="k">${i + 1}</span>`;
        if (e && !cont) {
          const url = this.icons.get(e);
          inner += url ? `<img src="${url}" alt="">` : `<div class="ph">${esc(game.items.name(e).th)}</div>`;
        }
        const isSel = sel === i || (cont && inv[sel] === id);
        html += `<div class="hud-slot${isSel ? ' sel' : ''}${cont ? ' cont' : ''}">${inner}</div>`;
      }
      this.slotsEl.innerHTML = html;
      if (sel !== this.selSig) { this.selSig = sel; this.nameT = 2.2; }
      const e = inv[sel] != null ? game.state.get(inv[sel]!) : null;
      this.nameEl.textContent = e ? game.items.name(e).th + (game.items.name(e).en ? ' · ' + game.items.name(e).en : '') : '';
      if (e) this.nameT = Math.max(this.nameT, 2.2);
    }
    this.nameT -= dt;
    this.nameEl.classList.toggle('on', this.nameT > 0 && !!this.nameEl.textContent);
    const w = game.items.weight(me);
    this.weightEl.style.width = Math.min(100, (w / 25) * 100).toFixed(0) + '%';
    this.overEl.classList.toggle('on', game.items.isOverloaded(me));

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
      tgt = this.target(v.o);
      if (tgt) break;
    }
    const cam = game.camera;
    if (tgt && show) {
      const d = Math.hypot(tgt.x - game.player.pos.x, tgt.z - game.player.pos.z);
      this.v.copy(tgt).project(cam);
      const behind = this.v.z > 1;
      let x = this.v.x, y = this.v.y;
      if (behind) { x = -x; y = -y; }
      const W = innerWidth, H = innerHeight, pad = 46;
      let sx = (x * 0.5 + 0.5) * W, sy = (-y * 0.5 + 0.5) * H;
      const off = behind || sx < pad || sx > W - pad || sy < pad || sy > H - pad;
      if (off) {
        // clamp onto the screen rectangle along the direction from the centre
        const cx = W / 2, cy = H / 2;
        let dx = sx - cx, dy = sy - cy;
        if (behind && Math.abs(dy) < 1) dy = H;
        const k = Math.min((W / 2 - pad) / Math.max(1e-3, Math.abs(dx)), (H / 2 - pad) / Math.max(1e-3, Math.abs(dy)));
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
