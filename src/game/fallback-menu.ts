import * as THREE from 'three';
import type { Game } from './game';
import type { SceneDef } from './scenes';
import { Session, NetKind } from '../net/session';
import { params } from '../core/util';

/**
 * Minimal DEV lobby used until the `menu` module (album-cover main menu) registers 'menu'.
 * Solo / Host (internet or browser tabs) / Join by code, then Start.
 */
export class FallbackMenu implements SceneDef {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
  private el: HTMLDivElement | null = null;
  private timer: any;
  constructor(private game: Game) {}

  enter() {
    this.scene.background = new THREE.Color(0xe7b94a);
    this.game.engine.setView(this.scene, this.camera);
    const d = (this.el = document.createElement('div'));
    d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:15;font-family:"IBM Plex Sans Thai Looped",sans-serif';
    d.innerHTML = `
      <div style="background:rgba(255,248,230,.94);padding:28px 34px;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.35);min-width:340px;color:#2a2117">
        <div style="font:700 58px Kodchasan;color:#fff;-webkit-text-stroke:3px #2f7d32;paint-order:stroke fill;text-shadow:0 5px 0 #1b4d1e;text-align:center">เฮียผัด!</div>
        <div style="text-align:center;opacity:.6;font-size:13px;margin:-4px 0 14px">dev lobby (the real album-cover menu replaces this)</div>
        <input id="hp-name" placeholder="ชื่อ / name" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid #c9b48a;font:16px 'IBM Plex Sans Thai Looped';margin-bottom:10px">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button data-a="solo">เล่นคนเดียว Solo</button>
          <button data-a="host-peer">Host (online)</button>
          <button data-a="host-tabs">Host (tabs)</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <input id="hp-code" placeholder="CODE" maxlength="6" style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid #c9b48a;font:700 18px K2D;text-transform:uppercase">
          <button data-a="join-peer">Join</button><button data-a="join-tabs">Join (tabs)</button>
        </div>
        <div id="hp-lobby" style="margin-top:14px;font-size:15px"></div>
        <button data-a="start" style="margin-top:12px;width:100%;font-size:18px">เริ่ม! Start</button>
        <div id="hp-msg" style="color:#a33;margin-top:8px;min-height:1em"></div>
      </div>`;
    for (const b of d.querySelectorAll('button')) (b as HTMLButtonElement).style.cssText += ';padding:8px 12px;border-radius:8px;border:0;background:#2f7d32;color:#fff;font:600 15px "IBM Plex Sans Thai Looped";cursor:pointer';
    document.body.appendChild(d);
    const name = d.querySelector('#hp-name') as HTMLInputElement;
    name.value = this.game.profile.name;
    name.onchange = () => { this.game.profile.name = name.value.slice(0, 16); this.game.saveProfile(); };
    const msg = (t: string) => ((d.querySelector('#hp-msg') as HTMLElement).textContent = t);
    d.onclick = async (ev) => {
      const a = (ev.target as HTMLElement).dataset?.a;
      if (!a) return;
      const code = (d.querySelector('#hp-code') as HTMLInputElement).value;
      try {
        if (a === 'solo') this.game.setSession(Session.local());
        else if (a.startsWith('host')) { msg('กำลังเปิดห้อง…'); this.game.setSession(await Session.host(a.endsWith('tabs') ? 'tabs' : 'peer')); msg(''); }
        else if (a.startsWith('join')) { msg('กำลังเข้าห้อง…'); this.game.setSession(await Session.join(a.endsWith('tabs') ? 'tabs' : 'peer', code)); msg(''); }
        else if (a === 'start') {
          if (!this.game.isHost) { msg('รอหัวห้องกดเริ่ม (waiting for host)'); return; }
          this.game.scenes.request(this.game.scenes.has('casino') && !params.has('skipintro') ? 'casino' : 'world');
        }
      } catch (e: any) { msg('ผิดพลาด: ' + (e?.message ?? e)); }
    };
    this.timer = setInterval(() => this.renderLobby(), 300);
    // auto actions for tests: ?autostart, ?host=tabs, ?join=CODE&net=tabs
    const net = (params.get('net') as NetKind) || 'peer';
    if (params.get('join')) Session.join(net, params.get('join')!).then((s) => this.game.setSession(s)).catch((e) => msg(String(e)));
    else if (params.get('host')) Session.host(params.get('host') as NetKind).then((s) => { this.game.setSession(s); if (params.has('autostart')) setTimeout(() => this.game.scenes.request('world'), 300); });
    else if (params.has('autostart')) setTimeout(() => this.game.scenes.request(params.has('skipintro') || !this.game.scenes.has('casino') ? 'world' : 'casino'), 100);
  }

  private renderLobby() {
    const el = this.el?.querySelector('#hp-lobby') as HTMLElement;
    if (!el) return;
    const s = this.game.session;
    const ps = this.game.players();
    el.innerHTML = `${s.online ? `<b>ห้อง ROOM: <span style="font:800 20px K2D;letter-spacing:2px">${s.room}</span></b> (${s.kind}) ${s.isHost ? '· คุณคือหัวห้อง' : ''}<br>` : ''}` +
      [0, 1, 2, 3].map((i) => { const p = ps.find((x) => x.slot === i); return `${i + 1}. ${p ? p.name + (p.id === this.game.localPlayerId ? ' (คุณ)' : '') : '<span style="opacity:.4">— ว่าง —</span>'}`; }).join('<br>');
  }

  exit() {
    clearInterval(this.timer);
    this.el?.remove();
    this.el = null;
  }
}
