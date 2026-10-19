import { F } from '../core/fonts';
import { DEBUG } from '../core/util';

/**
 * The ONLY 2D DOM layer: crosshair dot, fade curtain, cinematic subtitles/letterbox,
 * loading screen, pause sheet and a debug readout. Gameplay UI must be diegetic (3D).
 */
class OverlaySys {
  root!: HTMLDivElement;
  private cross!: HTMLDivElement;
  private curtain!: HTMLDivElement;
  private subs!: HTMLDivElement;
  private bars!: HTMLDivElement[];
  private loading!: HTMLDivElement;
  private debugEl!: HTMLDivElement;
  private hint!: HTMLDivElement;
  private subTimer: any;
  private hintTimer: any;

  init() {
    const st = document.createElement('style');
    st.textContent = `
      .hp-ov{position:fixed;inset:0;pointer-events:none;z-index:10;font-family:${F.ui},sans-serif;}
      .hp-cross{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;
        background:rgba(255,250,235,.85);box-shadow:0 0 0 1.5px rgba(0,0,0,.35);transition:transform .15s,opacity .2s;}
      .hp-cross.hot{transform:scale(1.8);background:#ffe9a8}
      .hp-cross.off{opacity:0}
      .hp-curtain{position:absolute;inset:0;background:#000;opacity:0;transition:opacity .6s ease;}
      .hp-bar{position:absolute;left:0;right:0;height:0;background:#000;transition:height .8s cubic-bezier(.6,0,.2,1);}
      .hp-bar.t{top:0}.hp-bar.b{bottom:0}
      .hp-subs{position:absolute;left:50%;bottom:9vh;transform:translateX(-50%);max-width:min(82vw,980px);text-align:center;
        color:#fff8e6;font:500 clamp(18px,2.3vw,30px)/1.35 ${F.ui};text-shadow:0 2px 6px rgba(0,0,0,.85),0 0 2px #000;opacity:0;transition:opacity .35s}
      .hp-subs small{display:block;font:400 clamp(12px,1.3vw,17px)/1.3 ${F.body};color:#e2d8c6;opacity:.9;margin-top:4px}
      .hp-subs.on{opacity:1}
      .hp-hint{position:absolute;left:50%;bottom:4.2vh;transform:translateX(-50%);color:#f5ecd9;font:400 clamp(12px,1.15vw,16px) ${F.body};
        text-shadow:0 1px 3px #000;opacity:0;transition:opacity .4s;white-space:nowrap}
      .hp-hint.on{opacity:.85}
      .hp-hint kbd{display:inline-block;min-width:1.4em;padding:0 .35em;margin:0 .15em;border:1px solid rgba(255,255,255,.55);border-bottom-width:2px;
        border-radius:4px;font:600 .9em ${F.tech};background:rgba(0,0,0,.35)}
      .hp-loading{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0d0a07;
        color:#f2e6cf;transition:opacity .8s;pointer-events:auto}
      .hp-loading h1{font:400 clamp(48px,9vw,120px)/1 ${F.bubbly};margin:0;color:#fff;
        -webkit-text-stroke:3px #2f7d32;paint-order:stroke fill;text-shadow:0 6px 0 #1b4d1e,0 10px 24px rgba(0,0,0,.6)}
      .hp-loading p{font:400 16px ${F.body};opacity:.75;margin-top:18px}
      .hp-loading .bar{width:min(320px,60vw);height:4px;background:rgba(255,255,255,.12);border-radius:3px;margin-top:22px;overflow:hidden}
      .hp-loading .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#e8b54a,#ffe28a);transition:width .3s}
      .hp-debug{position:absolute;left:8px;top:8px;color:#9f9;font:11px monospace;white-space:pre;text-shadow:0 1px 1px #000;opacity:.8}
    `;
    document.head.appendChild(st);
    const r = (this.root = document.createElement('div'));
    r.className = 'hp-ov';
    document.body.appendChild(r);
    this.bars = ['t', 'b'].map((c) => { const d = document.createElement('div'); d.className = 'hp-bar ' + c; r.appendChild(d); return d; });
    this.cross = el('hp-cross off', r);
    this.subs = el('hp-subs', r);
    this.hint = el('hp-hint', r);
    this.curtain = el('hp-curtain', r);
    this.loading = el('hp-loading', r);
    this.loading.innerHTML = `<h1>เฮียผัด!</h1><p>กำลังตั้งเตา… <span class="pct"></span></p><div class="bar"><i></i></div>`;
    this.debugEl = el('hp-debug', r);
    if (!DEBUG) this.debugEl.style.display = 'none';
  }

  crosshair(on: boolean, hot = false) {
    this.cross.classList.toggle('off', !on);
    this.cross.classList.toggle('hot', hot);
  }

  /** Fade the black curtain. Returns when done. */
  fade(to: number, sec = 0.6): Promise<void> {
    this.curtain.style.transition = `opacity ${sec}s ease`;
    this.curtain.style.opacity = String(to);
    return new Promise((r) => setTimeout(r, sec * 1000 + 30));
  }

  letterbox(on: boolean) { for (const b of this.bars) b.style.height = on ? '9vh' : '0'; }

  /** Cinematic subtitle line (Thai + optional English). */
  subtitle(th: string, en?: string, sec = 3) {
    clearTimeout(this.subTimer);
    this.subs.innerHTML = `${escapeHtml(th)}${en ? `<small>${escapeHtml(en)}</small>` : ''}`;
    this.subs.classList.add('on');
    this.subTimer = setTimeout(() => this.subs.classList.remove('on'), sec * 1000);
  }
  clearSubtitle() { this.subs.classList.remove('on'); }

  /** Tiny contextual hint at the bottom (e.g. first-time controls). Use rarely. `[E]` becomes a key cap. */
  showHint(text: string, sec = 4) {
    clearTimeout(this.hintTimer);
    this.hint.innerHTML = escapeHtml(text).replace(/\[([^\]]+)\]/g, '<kbd>$1</kbd>');
    this.hint.classList.add('on');
    if (sec > 0) this.hintTimer = setTimeout(() => this.hint.classList.remove('on'), sec * 1000);
  }
  hideHint() { this.hint.classList.remove('on'); }

  setLoading(pct: number, label?: string) {
    const i = this.loading.querySelector('.bar i') as HTMLElement;
    i.style.width = `${Math.round(pct * 100)}%`;
    if (label) (this.loading.querySelector('p') as HTMLElement).firstChild!.textContent = label + ' ';
  }
  hideLoading() {
    this.loading.style.opacity = '0';
    this.loading.style.pointerEvents = 'none';
    setTimeout(() => (this.loading.style.display = 'none'), 900);
  }
  showLoading(label = 'กำลังโหลด…') {
    this.loading.style.display = 'flex';
    this.loading.style.pointerEvents = 'auto';
    requestAnimationFrame(() => (this.loading.style.opacity = '1'));
    this.setLoading(0, label);
  }

  debug(text: string) { if (DEBUG) this.debugEl.textContent = text; }
}

function el(cls: string, parent: HTMLElement) {
  const d = document.createElement('div');
  d.className = cls;
  parent.appendChild(d);
  return d;
}
export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export const Overlay = new OverlaySys();
