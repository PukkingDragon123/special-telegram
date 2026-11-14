import type { Game } from '../../game/game';
import { F } from '../../core/fonts';
import { Input } from '../../core/input';
import { loadSettings, saveSettings, applySettings, QUALITIES } from './settings';
import { sfx } from './sfx';

/* ============================================================================================
 * In-game pause menu (Esc, or pointer lock lost). Clean screen-space panel: no tilt, no glow,
 * no yellow, little text. Pages: main (resume / settings / controls / room code / main menu /
 * quit), settings (quality incl. AUTO, volume, mouse sensitivity, invert Y, camera view, FOV,
 * motion blur when the renderer supports it, text size), controls.
 * Opened by world-scene.pause(true); closes with Esc / "เล่นต่อ".
 * ========================================================================================== */

const SH = '1px 0 0 #0b0907,-1px 0 0 #0b0907,0 1px 0 #0b0907,0 -1px 0 #0b0907,0 2px 3px rgba(0,0,0,.5)';
const CSS = `
.pz{position:fixed;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:rgba(8,7,6,.62);font-family:${F.ui},sans-serif;color:#fff;animation:pzIn .18s ease-out}
.pz *{box-sizing:border-box}
.pz-box{width:min(92vw,520px);max-height:90vh;overflow:auto;padding:28px 30px 24px}
.pz h1{margin:0 0 18px;font:800 clamp(30px,3.4vw,44px)/1.1 ${F.ui};text-shadow:${SH};letter-spacing:.01em}
.pz h2{margin:0 0 14px;font:800 26px/1.1 ${F.ui};text-shadow:${SH}}
.pz-btn{display:block;width:100%;text-align:left;background:none;border:0;border-left:4px solid transparent;color:#fff;
  font:700 clamp(18px,1.7vw,22px)/1.2 ${F.ui};padding:9px 12px;margin:2px 0;cursor:pointer;text-shadow:${SH};transition:background .12s,border-color .12s}
.pz-btn:hover,.pz-btn:focus-visible{background:rgba(255,255,255,.08);border-left-color:#4caf50;outline:none}
.pz-btn.dim{opacity:.7}
.pz-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08)}
.pz-row label{font:600 16px/1.2 ${F.ui};text-shadow:${SH}}
.pz-opts{display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end}
.pz-opt{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);color:#fff;font:600 14px ${F.ui};padding:5px 10px;border-radius:4px;cursor:pointer}
.pz-opt.on{background:#2f7a24;border-color:#4caf50}
.pz input[type=range]{width:170px;accent-color:#4caf50}
.pz-keys{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font:600 15px/1.3 ${F.ui};text-shadow:${SH}}
.pz-keys kbd{font:700 13px ${F.ui};border:1px solid rgba(255,255,255,.5);border-bottom-width:2px;border-radius:4px;padding:1px 7px;text-align:center;justify-self:start}
.pz-code{font:800 22px ${F.ui};letter-spacing:.12em;margin:6px 0 10px 12px;text-shadow:${SH}}
@keyframes pzIn{from{opacity:0}to{opacity:1}}
`;

export interface ExtraSettings { invertY: boolean; fov: number; view: 'fp' | 'tp'; textScale: number; motionBlur: boolean }
const XKEY = 'hp.settings2';
export function loadExtra(): ExtraSettings {
  let s: any = null;
  try { s = JSON.parse(localStorage.getItem(XKEY) || 'null'); } catch { /* storage blocked */ }
  return { invertY: !!s?.invertY, fov: Math.max(60, Math.min(95, s?.fov ?? 72)), view: s?.view === 'tp' ? 'tp' : 'fp', textScale: Math.max(0.85, Math.min(1.35, s?.textScale ?? 1)), motionBlur: s?.motionBlur !== false };
}
function saveExtra(x: ExtraSettings) { try { localStorage.setItem(XKEY, JSON.stringify(x)); } catch { /* storage blocked */ } }

/** apply the extra settings to the running game (safe to call any time) */
export function applyExtra(game: Game, x: ExtraSettings) {
  Input.invertY = x.invertY;
  const pl: any = game.player;
  if (pl) {
    pl.baseFov = x.fov;
    if (pl.view !== x.view) pl.setView?.(x.view);
  }
  document.documentElement.style.setProperty('--hp-text', String(x.textScale));
  for (const sel of ['.hud', '.ui3d-subs', '.hp-ov']) { const el = document.querySelector(sel) as HTMLElement | null; if (el) (el.style as any).zoom = String(x.textScale); }
  const post: any = game.engine?.post;
  if (typeof post?.setMotionBlur === 'function') post.setMotionBlur(x.motionBlur);
  else if (post && 'motionBlur' in post) post.motionBlur = x.motionBlur;
}
function hasMotionBlur(game: Game) { const p: any = game.engine?.post; return !!p && (typeof p.setMotionBlur === 'function' || 'motionBlur' in p); }

const QTH: Record<string, string> = { auto: 'อัตโนมัติ', low: 'ต่ำ', medium: 'กลาง', high: 'สูง', ultra: 'สูงสุด' };

export class PauseMenu {
  private el: HTMLDivElement | null = null;
  private page: 'main' | 'settings' | 'controls' = 'main';
  private static css = false;
  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Escape' || !this.el) return;
    e.preventDefault();
    if (this.page !== 'main') { this.page = 'main'; this.render(); return; }
    this.resume();
  };

  constructor(private game: Game, private onResume: () => void) {}

  get open() { return !!this.el; }

  show() {
    if (this.el) return;
    if (!PauseMenu.css) { const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); PauseMenu.css = true; }
    const d = (this.el = document.createElement('div'));
    d.className = 'pz';
    d.addEventListener('pointerdown', (e) => { if (e.target === d) this.resume(); });
    document.body.appendChild(d);
    this.page = 'main';
    this.render();
    // the Esc that unlocked the pointer is still "down": listen from the next frame on
    setTimeout(() => window.addEventListener('keydown', this.onKey), 0);
  }

  hide() {
    window.removeEventListener('keydown', this.onKey);
    this.el?.remove();
    this.el = null;
  }

  private resume() { sfx.click?.(); this.hide(); this.onResume(); }

  private btn(label: string, fn: () => void, dim = false) {
    const b = document.createElement('button');
    b.className = 'pz-btn' + (dim ? ' dim' : '');
    b.textContent = label;
    b.onclick = () => { try { sfx.click?.(); } catch { /* */ } fn(); };
    return b;
  }

  private render() {
    const d = this.el;
    if (!d) return;
    d.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'pz-box';
    d.appendChild(box);
    const game = this.game;
    if (this.page === 'main') {
      const h = document.createElement('h1'); h.textContent = 'พักเกม'; box.appendChild(h);
      box.appendChild(this.btn('เล่นต่อ', () => this.resume()));
      box.appendChild(this.btn('ตั้งค่า', () => { this.page = 'settings'; this.render(); }));
      box.appendChild(this.btn('ปุ่มควบคุม', () => { this.page = 'controls'; this.render(); }));
      if (game.session?.online && game.session.room) {
        const c = document.createElement('div'); c.className = 'pz-code'; c.textContent = 'ห้อง ' + game.session.room; box.appendChild(c);
      }
      box.appendChild(this.btn('กลับเมนูหลัก', () => {
        try { (game as any).save?.save?.(); } catch { /* */ }
        location.href = location.pathname;
      }, true));
      if ((window as any).process?.versions?.electron || /Electron/i.test(navigator.userAgent)) box.appendChild(this.btn('ออกจากเกม', () => { try { (game as any).save?.save?.(); } catch { /* */ } window.close(); }, true));
      setTimeout(() => (box.querySelector('.pz-btn') as HTMLElement | null)?.focus(), 0);
      return;
    }
    const back = this.btn('‹ กลับ', () => { this.page = 'main'; this.render(); });
    if (this.page === 'controls') {
      const h = document.createElement('h2'); h.textContent = 'ปุ่มควบคุม'; box.appendChild(h);
      const k = document.createElement('div'); k.className = 'pz-keys';
      const rows: [string, string][] = [
        ['W A S D', 'เดิน'], ['Shift', 'วิ่ง'], ['Ctrl / C', 'ย่อ / ย่อง'], ['Space', 'กระโดด'], ['E', 'ใช้ / หยิบ / คุย'],
        ['Q', 'วางของ'], ['1–5 / ล้อเมาส์', 'เลือกช่องของ'], ['V', 'มุมกล้อง'], ['T', 'คิดในใจ'], ['B', 'โหมดจัดร้าน'], ['Esc', 'พักเกม'],
      ];
      for (const [a, b] of rows) { const kb = document.createElement('kbd'); kb.textContent = a; const s = document.createElement('span'); s.textContent = b; k.append(kb, s); }
      box.appendChild(k);
      box.appendChild(back);
      return;
    }
    // ---- settings
    const h = document.createElement('h2'); h.textContent = 'ตั้งค่า'; box.appendChild(h);
    const st = loadSettings();
    const x = loadExtra();
    const row = (label: string, ctl: HTMLElement) => { const r = document.createElement('div'); r.className = 'pz-row'; const l = document.createElement('label'); l.textContent = label; r.append(l, ctl); box.appendChild(r); };
    const opts = (items: { v: string; t: string }[], cur: string, set: (v: string) => void) => {
      const w = document.createElement('div'); w.className = 'pz-opts';
      for (const it of items) {
        const b = document.createElement('button'); b.className = 'pz-opt' + (it.v === cur ? ' on' : ''); b.textContent = it.t;
        b.onclick = () => { set(it.v); for (const c of w.children) c.classList.toggle('on', c === b); };
        w.appendChild(b);
      }
      return w;
    };
    const slider = (min: number, max: number, step: number, val: number, set: (v: number) => void) => {
      const r = document.createElement('input'); r.type = 'range'; r.min = String(min); r.max = String(max); r.step = String(step); r.value = String(val);
      r.oninput = () => set(Number(r.value));
      return r;
    };
    const eng: any = game.engine;
    row('คุณภาพภาพ', opts(QUALITIES.map((q) => ({ v: q.q, t: QTH[q.q] ?? q.th })), eng.qualityMode ?? eng.quality, (v) => { eng.setQuality(v); }));
    row('ความดังเสียง', slider(0, 1, 0.05, st.volume, (v) => { st.volume = v; applySettings(st); saveSettings(st); }));
    row('ความไวเมาส์', slider(0.2, 2, 0.05, st.sens, (v) => { st.sens = v; applySettings(st); saveSettings(st); }));
    row('กลับแกนเมาส์', opts([{ v: '0', t: 'ปิด' }, { v: '1', t: 'เปิด' }], x.invertY ? '1' : '0', (v) => { x.invertY = v === '1'; saveExtra(x); applyExtra(game, x); }));
    const curView = (game.player as any)?.view ?? x.view;
    row('มุมกล้อง', opts([{ v: 'fp', t: 'บุคคลที่หนึ่ง' }, { v: 'tp', t: 'บุคคลที่สาม' }], curView, (v) => { x.view = v as 'fp' | 'tp'; saveExtra(x); applyExtra(game, x); }));
    row('มุมมอง (FOV)', slider(60, 95, 1, x.fov, (v) => { x.fov = v; saveExtra(x); applyExtra(game, x); }));
    if (hasMotionBlur(game)) row('เบลอตอนเคลื่อนไหว', opts([{ v: '1', t: 'เปิด' }, { v: '0', t: 'ปิด' }], x.motionBlur ? '1' : '0', (v) => { x.motionBlur = v === '1'; saveExtra(x); applyExtra(game, x); }));
    row('ขนาดตัวหนังสือ', opts([{ v: '0.9', t: 'เล็ก' }, { v: '1', t: 'ปกติ' }, { v: '1.2', t: 'ใหญ่' }], String(x.textScale), (v) => { x.textScale = Number(v); saveExtra(x); applyExtra(game, x); }));
    box.appendChild(back);
  }
}
