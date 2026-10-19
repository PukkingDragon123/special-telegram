/** Minimal event emitter / signal. */
export type Handler<T = any> = (data: T) => void;

export class Emitter {
  private map = new Map<string, Set<Handler>>();
  on<T = any>(type: string, fn: Handler<T>): () => void {
    let s = this.map.get(type);
    if (!s) this.map.set(type, (s = new Set()));
    s.add(fn);
    return () => s!.delete(fn);
  }
  once<T = any>(type: string, fn: Handler<T>): () => void {
    const off = this.on<T>(type, (d) => { off(); fn(d); });
    return off;
  }
  emit<T = any>(type: string, data?: T) {
    const s = this.map.get(type);
    if (!s) return;
    for (const fn of [...s]) {
      try { fn(data); } catch (e) { console.error(`[event ${type}]`, e); }
    }
  }
  clear(type?: string) { type ? this.map.delete(type) : this.map.clear(); }
}

export class Signal<T = void> {
  private fns = new Set<(d: T) => void>();
  add(fn: (d: T) => void) { this.fns.add(fn); return () => this.fns.delete(fn); }
  emit(d: T) { for (const fn of [...this.fns]) { try { fn(d); } catch (e) { console.error('[signal]', e); } } }
  clear() { this.fns.clear(); }
}
