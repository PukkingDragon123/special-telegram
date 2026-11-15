import * as THREE from 'three';
import { TT } from '../../core/lang';
import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import { Sound } from '../../core/audio';
import { F } from '../../core/fonts';
import { sfxTexture, sfxDataURL, SfxStyle } from './lettering';

/* ============================================================================================
 * MODULE `memes` — manga onomatopoeia + original takes on meme formats, all event-driven and local
 * (every peer reacts to the replicated events on its own screen):
 *   world SFX lettering (ドン!! バキッ バーン!! ズキュウウン チーン…) at hits / shots / knock-outs
 *   screen stamps (CRITICAL!!, なにィ?!, カチッ) + short meme cards (ภารกิจสำเร็จ! RESPECT ++,
 *   ดาเมจทางใจ!!, ตลกตายห่า, อีหยังวะ, ไม่นะ ไม่ๆๆๆ, ตังค์หมด…, มันส์พะยะค่ะ, เอาแล้วไง)
 *   "nani" FOV punch-in, sad violin at ฿0, fanfare on the first sale, kira-kira on secrets
 * Sounds are original syntheses in public/assets/audio/meme/anime/ (manifest cat 'meme').
 * Text rules: white with a dark outline, no glow, short; SFX glyphs are slanted manga art.
 * API: (game as any).memes = { sfx(text, pos, style?, size?), stamp(text, style, o?), card(th, sub?), nani() }
 * ========================================================================================== */

const CSS = `
.mm{position:fixed;inset:0;pointer-events:none;z-index:12;overflow:hidden}
.mm-st{position:absolute;transform:translate(-50%,-50%);animation:mmStamp var(--life,1.1s) cubic-bezier(.2,1.6,.4,1) both;will-change:transform,opacity}
.mm-st img{display:block;width:100%;height:auto}
.mm-card{position:absolute;left:50%;top:22%;transform:translateX(-50%);text-align:center;color:#fff;font:900 clamp(26px,3.4vw,46px)/1.05 ${F.ui};
  letter-spacing:.01em;-webkit-text-stroke:2px #0a0a0a;paint-order:stroke fill;text-shadow:0 3px 0 #0a0a0a;animation:mmCard var(--life,2.2s) ease both;white-space:nowrap}
.mm-card small{display:block;font:800 clamp(13px,1.3vw,18px) ${F.ui};-webkit-text-stroke:1px #0a0a0a;margin-top:6px;opacity:.95;letter-spacing:.12em}
.mm-card.mp{top:30%;font-size:clamp(30px,4vw,56px)}
.mm-card.mp small{color:#b8f5c0}
.mm-flash{position:absolute;inset:0;background:#fff;opacity:0;animation:mmFlash .28s ease-out both}
.mm-gray{position:absolute;inset:0;backdrop-filter:grayscale(1) contrast(1.25);opacity:0;transition:opacity .12s}
.mm-gray.on{opacity:1}
@keyframes mmStamp{0%{opacity:0;transform:translate(-50%,-50%) scale(2.2) rotate(var(--r,0deg))}12%{opacity:1;transform:translate(-50%,-50%) scale(.92) rotate(var(--r,0deg))}
  20%{transform:translate(-50%,-50%) scale(1.04) rotate(var(--r,0deg))}28%{transform:translate(-49%,-51%) scale(1) rotate(var(--r,0deg))}
  34%{transform:translate(-51%,-49%) scale(1) rotate(var(--r,0deg))}80%{opacity:1;transform:translate(-50%,-52%) scale(1) rotate(var(--r,0deg))}
  100%{opacity:0;transform:translate(-50%,-58%) scale(1.06) rotate(var(--r,0deg))}}
@keyframes mmCard{0%{opacity:0;transform:translateX(-50%) scale(1.6)}10%{opacity:1;transform:translateX(-50%) scale(.96)}16%{transform:translateX(-50%) scale(1)}
  85%{opacity:1}100%{opacity:0;transform:translateX(-50%) translateY(-10px)}}
@keyframes mmFlash{0%{opacity:.55}100%{opacity:0}}
`;

interface WSfx { s: THREE.Sprite; t: number; life: number; base: number; asp: number; vel: THREE.Vector3; rot: number; shake: number }

const pick = <T,>(a: T[]): T => a[(Math.random() * a.length) | 0];
const HIT_WORDS: [string, SfxStyle][] = [['バキッ', 'impact'], ['ドゴッ', 'impact'], ['ボコッ', 'pop'], ['ตุ้บ!', 'thai'], ['พลั่ก!', 'thai'], ['ゴッ', 'impact']];
const CRIT_WORDS: [string, SfxStyle][] = [['ドンッ!!', 'blood'], ['ドォン!!', 'blood'], ['ตูม!!', 'thai'], ['バーン!!', 'blood']];

class Memes {
  private root!: HTMLDivElement;
  private gray!: HTMLDivElement;
  private world = new THREE.Group();
  private items: WSfx[] = [];
  private cd = new Map<string, number>();
  private now = 0;
  private firstSale = false;
  private standAt = -99;
  private nani: { t: number; base: number; pl: any } | null = null;

  constructor(private game: Game) {
    this.world.name = 'meme-sfx';
    this.world.renderOrder = 30;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.root = document.createElement('div'); this.root.className = 'mm';
    this.gray = document.createElement('div'); this.gray.className = 'mm-gray';
    this.root.appendChild(this.gray);
    document.body.appendChild(this.root);
    this.hook();
  }

  private ok(key: string, sec: number) {
    const t = this.cd.get(key) ?? -1e9;
    if (this.now - t < sec) return false;
    this.cd.set(key, this.now);
    return true;
  }
  private inWorld() { return this.game.scenes.currentName === 'world' && !!this.game.scene; }
  private near(p: ArrayLike<number> | THREE.Vector3 | null | undefined, r = 30) {
    if (!p) return false;
    const c = this.game.camera.position;
    const x = (p as any).x ?? (p as any)[0], z = (p as any).z ?? (p as any)[2];
    return Math.hypot(x - c.x, z - c.z) < r;
  }
  private headOf(id: number, lift = 0.35): THREE.Vector3 | null {
    const o = this.game.views.objectOf(id);
    if (o) return o.localToWorld(new THREE.Vector3(0, ((o.userData.headHeight as number) ?? 1.8) + lift - 0.2, 0));
    const e = this.game.state.get(id);
    return e?.p ? new THREE.Vector3(e.p[0], e.p[1] + 1.8 + lift, e.p[2]) : null;
  }
  private snd(key: string, vol = 1, pos?: THREE.Vector3 | null) { if (Sound.has(key)) Sound.play(key, { vol, pos: pos ?? undefined, bus: 'meme' }); }

  // ------------------------------------------------------------------ API
  /** world-space manga SFX lettering that pops, shakes and drifts */
  sfx(text: string, pos: THREE.Vector3, style: SfxStyle = 'impact', size = 0.42, life = 1.1) {
    if (!this.inWorld()) return;
    if (this.world.parent !== this.game.scene) this.game.scene!.add(this.world);
    const tex = sfxTexture(text, style, 180);
    const img: any = tex.image;
    const mat = new THREE.SpriteMaterial({ map: tex, color: 0xececec, transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
    const s = new THREE.Sprite(mat);
    s.renderOrder = 30;
    s.position.copy(pos);
    this.world.add(s);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.game.camera.quaternion);
    this.items.push({ s, t: 0, life, base: size, asp: img ? img.width / img.height : 2, vel: right.multiplyScalar((Math.random() - 0.5) * 0.3).add(new THREE.Vector3(0, 0.45, 0)), rot: (Math.random() - 0.5) * 0.18 - 0.06, shake: 1 });
    while (this.items.length > 14) this.kill(this.items.shift()!);
  }

  /** screen-space SFX stamp (x/y 0..1 of the viewport, size = fraction of viewport height) */
  stamp(text: string, style: SfxStyle = 'impact', o: { x?: number; y?: number; size?: number; life?: number; rot?: number } = {}) {
    const el = document.createElement('div');
    el.className = 'mm-st';
    const h = (o.size ?? 0.16) * innerHeight;
    const img = document.createElement('img');
    img.src = sfxDataURL(text, style, 180);
    img.onload = () => { el.style.width = (h * img.naturalWidth / img.naturalHeight).toFixed(0) + 'px'; };
    el.style.width = (h * 2.2).toFixed(0) + 'px';
    el.style.left = ((o.x ?? 0.5) * 100).toFixed(1) + '%';
    el.style.top = ((o.y ?? 0.4) * 100).toFixed(1) + '%';
    el.style.setProperty('--life', (o.life ?? 1.1) + 's');
    el.style.setProperty('--r', ((o.rot ?? -4)).toFixed(1) + 'deg');
    el.appendChild(img);
    this.root.appendChild(el);
    setTimeout(() => el.remove(), (o.life ?? 1.1) * 1000 + 80);
  }

  /** short meme card (white, outlined, no glow) */
  card(th: string, sub?: string, cls = '', life = 2.2) {
    const el = document.createElement('div');
    el.className = 'mm-card ' + cls;
    el.style.setProperty('--life', life + 's');
    // one language only: an English sub-line is the English version of the card
    el.textContent = sub && !/[\u0E00-\u0E7F]/.test(sub) ? TT(th, sub) : th;
    if (sub && /[\u0E00-\u0E7F]/.test(sub)) { const s = document.createElement('small'); s.textContent = sub; el.appendChild(s); }
    for (const c of [...this.root.querySelectorAll('.mm-card')]) c.remove();
    this.root.appendChild(el);
    setTimeout(() => el.remove(), life * 1000 + 80);
  }

  flash() {
    const f = document.createElement('div'); f.className = 'mm-flash'; this.root.appendChild(f);
    setTimeout(() => f.remove(), 320);
  }

  /** "nani?!" — dramatic punch-in on the gameplay camera + grayscale beat + stamp */
  naniZoom(text = 'なにィ?!') {
    const pl: any = this.game.player;
    if (!pl || pl.mode !== 'play' || this.nani) return;
    this.nani = { t: 0, base: pl.baseFov, pl };
    this.gray.classList.add('on');
    this.stamp(text, 'menace', { x: 0.5, y: 0.3, size: 0.2, life: 1.3, rot: -6 });
    this.snd('anime_zoom_sting', 0.9);
  }

  // ------------------------------------------------------------------ events
  private hook() {
    const g = this.game;
    // ---- combat
    g.on('combat:hit', (d: { to: number; by: number; p?: number[]; crit?: boolean }) => {
      const at = this.headOf(d.to, 0.1) ?? (d.p ? new THREE.Vector3(d.p[0], d.p[1] + 1.4, d.p[2]) : null);
      if (!at || !this.near(at, 28)) return;
      if (d.crit) {
        const [w, s] = pick(CRIT_WORDS);
        this.sfx(w, at, s, 0.7, 1.3);
        if (d.by === g.localPlayerId) { this.stamp('CRITICAL!!', 'blood', { x: 0.5, y: 0.2, size: 0.11, life: 0.9, rot: -3 }); this.flash(); }
        this.snd('anime_punch_crit', 0.8, at);
        if (this.ok('wow', 14)) setTimeout(() => this.snd('meme_crowd_wow', 0.45, at), 350);
      } else if (this.ok('hitword', 0.12)) {
        const [w, s] = pick(HIT_WORDS);
        this.sfx(w, at, s, 0.36, 0.85);
        this.snd('anime_punch', 0.55, at);
        if (Math.random() < 0.18 && this.ok('chip', 6)) this.snd('meme_chipmunk', 0.5, at);
        // bystanders whip their phones out (combat/host.ts turns nearby NPCs into filmers)
        if (Math.random() < 0.5 && this.ok('shutter', 2.5)) setTimeout(() => this.snd('meme_camera_shutter', 0.55, at), 400 + Math.random() * 600);
      }
    });
    g.on('combat:ko', (d: { id: number }) => {
      const at = this.headOf(d.id, 0.3); if (!at || !this.near(at, 28)) return;
      this.sfx('ズキュウウン', at, 'menace', 0.62, 1.6);
      if (this.ok('ooh', 7)) this.snd('crowd_ooh', 0.6, at);
      else if (this.ok('boing', 5)) this.snd(Math.random() < 0.5 ? 'meme_boing' : 'meme_slide_whistle', 0.55, at);
    });
    g.on('combat:dead', (d: { id: number }) => {
      const at = this.headOf(d.id, 0.2); if (!at || !this.near(at, 28)) return;
      this.sfx('チーン…', at, 'white', 0.5, 2.0);
      if (this.ok('gong', 10)) this.snd('meme_gong', 0.45, at);
    });
    g.on('combat:shot', (d: { from: number }) => {
      const at = this.headOf(d.from, -0.2); if (!at || !this.near(at, 35)) return;
      this.sfx('バーン!!', at, 'blood', 0.55, 1.0);
      this.snd('cartoon_bang', 0.35, at);
    });
    g.on('combat:aim', (d: { to: number }) => {
      if (d.to === g.localPlayerId && this.ok('nani', 25)) this.naniZoom('なにィ?!');
    });
    g.on('combat:down', (d: { id: number }) => {
      if (d.id !== g.localPlayerId) return;
      this.stamp('หมดสภาพ', 'blood', { x: 0.5, y: 0.33, size: 0.2, life: 2.6, rot: -2 });
      this.snd('ko_sting', 0.8);
      setTimeout(() => this.snd('meme_slide_whistle', 0.5), 250);
    });
    g.on('combat:cop', (d: { pl: number }) => {
      if (d.pl === g.localPlayerId && this.ok('cop', 30)) { this.card('เอาแล้วไง', 'POLICE?!'); this.snd(Math.random() < 0.5 ? 'meme_scratch_2' : 'meme_scratch_3', 0.6); setTimeout(() => this.snd('dramatic_dun', 0.8), 380); }
    });
    // ---- surprise moments → nani zoom
    g.on('life:jumpscare', (d: { player: number }) => { if (d.player === g.localPlayerId && this.ok('nani', 20)) { this.naniZoom('ヒィッ!?'); this.snd('meme_chipmunk', 0.6); } });
    // ---- money: sad violin at ฿0, mission-passed on the first sale
    g.events.on('money', (d: { player: number; delta: number; reason: string; wallet: number }) => {
      if (d.player !== g.localPlayerId || !this.inWorld()) return;
      if (d.delta < 0 && d.wallet <= 0 && this.ok('broke', 60)) { this.card('ตังค์หมด…', 'BROKE'); this.snd('sad_violin', 0.7); }
      if (d.delta >= 20 && /restaurant|sale|serve|pay|tip/.test(d.reason ?? '') && this.ok('kaching', 3.5)) this.snd('meme_ka_ching', 0.5);
      if (d.delta > 0 && !this.firstSale && /restaurant|first_sale/.test(d.reason ?? '')) {
        this.firstSale = true;
        setTimeout(() => { this.card('ภารกิจสำเร็จ!', 'RESPECT ++', 'mp', 3.2); this.snd('mission_fanfare', 0.75); }, 600);
      }
    });
    g.on('quest:done', () => { if (this.ok('qdone', 8)) { this.card('ภารกิจสำเร็จ!', 'RESPECT ++', 'mp', 3.0); this.snd('mission_fanfare', 0.7); setTimeout(() => this.snd('meme_airhorn', 0.4), 900); } });
    g.on('unlock:recipe', () => { if (this.inWorld() && this.ok('ding', 3)) this.snd('meme_ding', 0.55); });
    g.on('rest:grand', () => { if (this.ok('grand', 20)) { this.snd('meme_airhorn', 0.5); setTimeout(() => this.snd('meme_crowd_wow', 0.5), 700); } });
    g.on('rest:mad', (d: { pid: number }) => { if (d.pid === g.localPlayerId && this.ok('mad', 10)) this.snd('meme_huh_low', 0.6); });
    // ---- the dog steals your food
    g.events.on('life:dog_steal', () => {
      if (!this.inWorld() || !this.ok('dog', 12)) return;
      this.card('ไม่นะ ไม่ๆๆๆ', 'OH NO NO NO');
      this.snd('oh_no_slide', 0.75);
      setTimeout(() => this.snd('meme_cartoon_run', 0.5), 900);
    });
    // ---- burnt dish (unless the stand just rewound it)
    g.events.on('cook:dish', (d: { player: number; data: any }) => {
      const iss: string[] = d.data?.issues ?? [];
      if (!iss.some((x) => /burn/.test(x))) { if (iss.length && d.player === g.localPlayerId && this.ok('wrong', 15)) this.snd('meme_wrong_buzzer', 0.4); return; }
      if (this.now - this.standAt < 12 || !this.ok('burnt', 20)) return;
      this.stamp('ไหม้!!', 'blood', { x: 0.5, y: 0.36, size: 0.15, life: 1.2 });
      if (d.player === g.localPlayerId) setTimeout(() => this.card('อีหยังวะ', 'WHAT IS THIS'), 400);
      this.snd('boom_heavy', 0.7);
    });
    g.on('stand:go', () => { this.standAt = this.now; this.snd('meme_gong', 0.4); });
    // ---- five-star review
    g.on('rest:review', (d: { stars: number }) => {
      if ((d.stars ?? 0) >= 5 && this.ok('5star', 25)) { this.card('มันส์พะยะค่ะ', '★★★★★'); this.snd('meme_crowd_wow', 0.55); }
      else if ((d.stars ?? 5) <= 1 && this.ok('1star', 25)) this.snd('meme_huh_low', 0.6);
    });
    // ---- conversation punchlines (NPC reaction lines after a comeback)
    g.on('talk:line', (d: { by: number; th: string }) => {
      if (d.by !== g.localPlayerId || !d.th) return;
      if (/555|ฮ่า|ขำ|ตลก/.test(d.th) && Math.random() < 0.45 && this.ok('laugh', 25)) { this.card('ตลกตายห่า', 'LMAO'); this.snd('boom_heavy', 0.7); setTimeout(() => this.snd('meme_laugh_track', 0.45), 300); }
      else if (/อะไร|หา\?|ห๊ะ|ไม่เข้าใจ|งง/.test(d.th) && this.ok('huh', 20)) this.snd('meme_huh_low', 0.6);
      else if (/ไอ้|มึง|เชี่ย|แม่ง|สัส|ห่า|ควาย/.test(d.th) && Math.random() < 0.4 && this.ok('damage', 25)) { this.card('ดาเมจทางใจ!!', 'EMOTIONAL DAMMIT'); this.snd('savage_hit', 0.8); }
    });
    // ---- secrets / easter eggs
    for (const ev of ['egg:found', 'life:egg_found', 'eggs:found']) g.on(ev, () => { if (this.ok('kira', 6)) { this.stamp('キラキラ', 'ice', { x: 0.5, y: 0.3, size: 0.1, life: 1.4, rot: 0 }); this.snd('kira_kira', 0.7); } });
  }

  // ------------------------------------------------------------------ frame
  private kill(i: WSfx) { i.s.removeFromParent(); (i.s.material as THREE.Material).dispose(); }

  frame(dt: number) {
    this.now += dt;
    const cam = this.game.camera;
    for (const it of this.items) {
      it.t += dt;
      const k = it.t / it.life;
      it.s.position.addScaledVector(it.vel, dt);
      it.vel.multiplyScalar(Math.exp(-dt * 2.5));
      const pop = k < 0.08 ? (k / 0.08) * 1.35 : k < 0.16 ? 1.35 - ((k - 0.08) / 0.08) * 0.35 : 1;
      const sh = it.t < 0.25 ? (Math.random() - 0.5) * 0.04 : 0;
      it.s.scale.set(it.base * pop * it.asp, it.base * pop, 1);
      it.s.position.x += sh; it.s.position.y += sh * 0.5;
      const m = it.s.material as THREE.SpriteMaterial;
      m.rotation = it.rot;
      m.opacity = k > 0.72 ? Math.max(0, 1 - (k - 0.72) / 0.28) : 1;
    }
    this.items = this.items.filter((i) => { if (i.t < i.life) return true; this.kill(i); return false; });
    void cam;
    // nani FOV punch: in fast, hold, out
    if (this.nani) {
      const N = this.nani;
      N.t += dt;
      const z = N.t < 0.12 ? N.t / 0.12 : N.t < 0.75 ? 1 : Math.max(0, 1 - (N.t - 0.75) / 0.5);
      N.pl.baseFov = N.base - 16 * z;
      if (N.t > 0.7) this.gray.classList.remove('on');
      if (N.t >= 1.25) { N.pl.baseFov = N.base; this.nani = null; }
    }
  }
}

let memes: Memes | null = null;

export default defineModule({
  id: 'memes',
  deps: ['characters'],
  init(game: Game) {
    memes = new Memes(game);
    (game as any).memes = memes;
    game.events.on('world:exit', () => { /* sprites live in the world scene and die with it */ });
  },
  frame(game: Game, dt: number) {
    try { memes?.frame(dt); } catch (e) { console.warn('[memes]', e); }
  },
});
