import Peer, { DataConnection } from 'peerjs';
import { params } from '../core/util';

/**
 * Transport = raw message pipe between the HOST and its clients (star topology).
 *  - LocalTransport: single player (host, no peers)
 *  - BroadcastTransport: several tabs of the same browser (dev/testing, LAN-less)
 *  - PeerTransport: internet play via WebRTC (PeerJS cloud signalling by default)
 */
export interface Transport {
  readonly kind: 'local' | 'tabs' | 'peer';
  readonly isHost: boolean;
  readonly selfId: string;
  readonly room: string;
  readonly hostId: string;
  peers(): string[];
  send(to: string, data: any): void;
  broadcast(data: any): void;
  onMessage: (from: string, data: any) => void;
  onPeerJoin: (peer: string) => void;
  onPeerLeave: (peer: string) => void;
  onClose: (reason: string) => void;
  close(): void;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRoomCode(n = 5) {
  let s = '';
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  for (let i = 0; i < n; i++) s += ALPHABET[a[i] % ALPHABET.length];
  return s;
}
const rid = () => Math.random().toString(36).slice(2, 10);
const noop = () => {};

export class LocalTransport implements Transport {
  readonly kind = 'local';
  readonly isHost = true;
  readonly selfId = 'local-' + rid();
  readonly room = 'SOLO';
  get hostId() { return this.selfId; }
  peers() { return []; }
  send() {}
  broadcast() {}
  onMessage: Transport['onMessage'] = noop;
  onPeerJoin: Transport['onPeerJoin'] = noop;
  onPeerLeave: Transport['onPeerLeave'] = noop;
  onClose: Transport['onClose'] = noop;
  close() {}
}

/** Same-origin tabs via BroadcastChannel. */
export class BroadcastTransport implements Transport {
  readonly kind = 'tabs';
  readonly selfId = 'tab-' + rid();
  hostId = '';
  private ch: BroadcastChannel;
  private lastSeen = new Map<string, number>();
  private timer: any;
  onMessage: Transport['onMessage'] = noop;
  onPeerJoin: Transport['onPeerJoin'] = noop;
  onPeerLeave: Transport['onPeerLeave'] = noop;
  onClose: Transport['onClose'] = noop;

  private constructor(readonly room: string, readonly isHost: boolean) {
    this.ch = new BroadcastChannel('hiaphat:' + room);
    if (isHost) this.hostId = this.selfId;
    this.ch.onmessage = (ev) => this.recv(ev.data);
    window.addEventListener('beforeunload', () => this.post('*', { _: 'bye' }));
    this.timer = setInterval(() => this.heartbeat(), 1000);
  }

  static host(room: string) { return Promise.resolve(new BroadcastTransport(room, true)); }

  static join(room: string): Promise<BroadcastTransport> {
    return new Promise((resolve, reject) => {
      const t = new BroadcastTransport(room, false);
      let tries = 0;
      const iv = setInterval(() => {
        if (t.hostId) { clearInterval(iv); resolve(t); return; }
        if (++tries > 16) { clearInterval(iv); t.close(); reject(new Error('notfound')); return; }
        t.post('*', { _: 'hello' });
      }, 250);
    });
  }

  private post(to: string, d: any) { this.ch.postMessage({ f: this.selfId, t: to, d }); }

  private recv(m: { f: string; t: string; d: any }) {
    if (m.t !== '*' && m.t !== this.selfId) return;
    const ctl = m.d && m.d._;
    if (this.isHost) {
      if (ctl === 'hello') {
        if (!this.lastSeen.has(m.f)) { this.lastSeen.set(m.f, Date.now()); this.post(m.f, { _: 'welcome' }); this.onPeerJoin(m.f); }
        return;
      }
      if (!this.lastSeen.has(m.f)) return;
      this.lastSeen.set(m.f, Date.now());
      if (ctl === 'bye') { this.drop(m.f); return; }
      if (ctl) return;
      this.onMessage(m.f, m.d);
    } else {
      if (ctl === 'welcome' && !this.hostId) { this.hostId = m.f; this.lastSeen.set(m.f, Date.now()); return; }
      if (m.f !== this.hostId) return;
      this.lastSeen.set(m.f, Date.now());
      if (ctl === 'bye' || ctl === 'kick') { this.onClose(ctl === 'kick' ? 'kicked' : 'host-left'); this.close(); return; }
      if (ctl) return;
      this.onMessage(m.f, m.d);
    }
  }

  private heartbeat() {
    const now = Date.now();
    if (this.isHost) {
      this.post('*', { _: 'ping' });
      for (const [p, t] of this.lastSeen) if (now - t > 6000) this.drop(p);
    } else if (this.hostId) {
      this.post(this.hostId, { _: 'ping' });
      if (now - (this.lastSeen.get(this.hostId) ?? now) > 6000) { this.onClose('host-timeout'); this.close(); }
    }
  }

  private drop(p: string) {
    if (!this.lastSeen.delete(p)) return;
    this.onPeerLeave(p);
  }

  peers() { return this.isHost ? [...this.lastSeen.keys()] : this.hostId ? [this.hostId] : []; }
  send(to: string, data: any) { this.post(to, data); }
  broadcast(data: any) { if (this.isHost) this.post('*', data); }
  kick(p: string) { this.post(p, { _: 'kick' }); this.drop(p); }
  close() {
    clearInterval(this.timer);
    try { this.post('*', { _: 'bye' }); this.ch.close(); } catch {}
  }
}

const PREFIX = 'hiaphat-v1-';

function peerOptions(): any {
  const ice: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ];
  if (params.get('turn')) ice.push({ urls: params.get('turn')!, username: params.get('turnUser') ?? '', credential: params.get('turnCred') ?? '' });
  const o: any = { config: { iceServers: ice }, debug: params.has('netdebug') ? 2 : 0 };
  if (params.get('peerHost')) {
    o.host = params.get('peerHost');
    o.port = Number(params.get('peerPort') ?? 443);
    o.path = params.get('peerPath') ?? '/';
    o.secure = params.get('peerSecure') !== '0';
  }
  return o;
}

/** Internet play (WebRTC data channels via PeerJS). */
export class PeerTransport implements Transport {
  readonly kind = 'peer';
  private conns = new Map<string, DataConnection>();
  onMessage: Transport['onMessage'] = noop;
  onPeerJoin: Transport['onPeerJoin'] = noop;
  onPeerLeave: Transport['onPeerLeave'] = noop;
  onClose: Transport['onClose'] = noop;
  hostId = '';

  private constructor(private peer: Peer, readonly room: string, readonly isHost: boolean) {}
  get selfId() { return this.peer.id; }

  static host(room: string): Promise<PeerTransport> {
    return new Promise((resolve, reject) => {
      const peer = new Peer(PREFIX + room, peerOptions());
      const t = new PeerTransport(peer, room, true);
      t.hostId = PREFIX + room;
      const to = setTimeout(() => reject(new Error('timeout')), 15000);
      peer.on('open', () => { clearTimeout(to); resolve(t); });
      peer.on('error', (e: any) => {
        clearTimeout(to);
        if (e.type === 'unavailable-id') reject(new Error('taken'));
        else if (!t.conns.size) reject(new Error(e.type || 'error'));
        else console.warn('[peer]', e);
      });
      peer.on('connection', (conn) => {
        conn.on('open', () => { t.conns.set(conn.peer, conn); t.onPeerJoin(conn.peer); });
        conn.on('data', (d) => t.onMessage(conn.peer, d));
        const gone = () => { if (t.conns.delete(conn.peer)) t.onPeerLeave(conn.peer); };
        conn.on('close', gone);
        conn.on('error', gone);
      });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
    });
  }

  static join(room: string): Promise<PeerTransport> {
    return new Promise((resolve, reject) => {
      const peer = new Peer(peerOptions());
      const t = new PeerTransport(peer, room, false);
      const to = setTimeout(() => { reject(new Error('timeout')); try { peer.destroy(); } catch {} }, 15000);
      peer.on('error', (e: any) => {
        clearTimeout(to);
        reject(new Error(e.type === 'peer-unavailable' ? 'notfound' : e.type || 'error'));
      });
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + room, { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          clearTimeout(to);
          t.hostId = conn.peer;
          t.conns.set(conn.peer, conn);
          resolve(t);
        });
        conn.on('data', (d) => t.onMessage(conn.peer, d));
        conn.on('close', () => t.onClose('host-left'));
        conn.on('error', () => t.onClose('error'));
      });
    });
  }

  peers() { return [...this.conns.keys()]; }
  send(to: string, data: any) { const c = this.conns.get(to); if (c && c.open) c.send(data); }
  broadcast(data: any) { for (const c of this.conns.values()) if (c.open) c.send(data); }
  close() { try { this.peer.destroy(); } catch {} }
}
