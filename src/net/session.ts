import { Transport, LocalTransport, BroadcastTransport, PeerTransport, makeRoomCode } from './transport';
import { Signal } from '../core/events';

export type NetKind = 'local' | 'tabs' | 'peer';
type MsgHandler = (from: string, data: any) => void;

/**
 * Typed messages over a Transport. Envelope: [type, data].
 * The host is also a "client" of itself: toHost() on the host dispatches locally (same code path).
 */
export class Session {
  private handlers = new Map<string, Set<MsgHandler>>();
  readonly peerJoined = new Signal<string>();
  readonly peerLeft = new Signal<string>();
  readonly closed = new Signal<string>();
  /** bytes sent (rough, for debug overlay) */
  bytesOut = 0;

  constructor(public t: Transport) { this.wire(); }

  private wire() {
    this.t.onMessage = (from, d) => {
      if (!Array.isArray(d)) return;
      this.dispatch(from, d[0], d[1]);
    };
    this.t.onPeerJoin = (p) => this.peerJoined.emit(p);
    this.t.onPeerLeave = (p) => this.peerLeft.emit(p);
    this.t.onClose = (r) => this.closed.emit(r);
  }

  get isHost() { return this.t.isHost; }
  get selfId() { return this.t.selfId; }
  get hostId() { return this.t.hostId; }
  get room() { return this.t.room; }
  get kind(): NetKind { return this.t.kind; }
  get peers() { return this.t.peers(); }
  get online() { return this.t.kind !== 'local'; }

  on(type: string, fn: MsgHandler) {
    let s = this.handlers.get(type);
    if (!s) this.handlers.set(type, (s = new Set()));
    s.add(fn);
    return () => s!.delete(fn);
  }

  private dispatch(from: string, type: string, data: any) {
    const s = this.handlers.get(type);
    if (!s) return;
    for (const fn of s) {
      try { fn(from, data); } catch (e) { console.error(`[net ${type}]`, e); }
    }
  }

  private pack(type: string, data: any) {
    const m = [type, data];
    if (this.online) this.bytesOut += 40; // cheap estimate; real size measured in debug only
    return m;
  }

  /** Client → host (on host: local dispatch). */
  toHost(type: string, data?: any) {
    if (this.isHost) this.dispatch(this.selfId, type, data);
    else this.t.send(this.t.hostId, this.pack(type, data));
  }
  /** Host → one client (to self: local dispatch). */
  sendTo(peer: string, type: string, data?: any) {
    if (peer === this.selfId) this.dispatch(peer, type, data);
    else this.t.send(peer, this.pack(type, data));
  }
  /** Host → all clients (not self). */
  broadcast(type: string, data?: any) {
    if (this.isHost && this.online) this.t.broadcast(this.pack(type, data));
  }
  /** Host → all clients AND self. */
  broadcastAll(type: string, data?: any) {
    this.broadcast(type, data);
    this.dispatch(this.selfId, type, data);
  }

  close() { this.t.close(); this.handlers.clear(); }

  static local() { return new Session(new LocalTransport()); }

  static async host(kind: NetKind): Promise<Session> {
    if (kind === 'local') return Session.local();
    for (let i = 0; i < 4; i++) {
      const code = makeRoomCode();
      try {
        const t = kind === 'tabs' ? await BroadcastTransport.host(code) : await PeerTransport.host(code);
        return new Session(t);
      } catch (e: any) {
        if (e.message !== 'taken') throw e;
      }
    }
    throw new Error('could not allocate room');
  }

  static async join(kind: NetKind, code: string): Promise<Session> {
    const c = code.trim().toUpperCase();
    const t = kind === 'tabs' ? await BroadcastTransport.join(c) : await PeerTransport.join(c);
    return new Session(t);
  }
}
