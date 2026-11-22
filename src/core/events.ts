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
  /** emit, then wait for every promise a handler returned (staged world build: async world:built work) */
  async emitAsync<T = any>(type: string, data?: T): Promise<void> {
    const s = this.map.get(type);
    if (!s) return;
    const waits: Promise<unknown>[] = [];
    for (const fn of [...s]) {
      try { const r: any = (fn as any)(data); if (r && typeof r.then === 'function') waits.push(r.catch((e: unknown) => console.error(`[event ${type}]`, e))); }
      catch (e) { console.error(`[event ${type}]`, e); }
    }
    await Promise.all(waits);
  }
  emit<T = any>(type: string, data?: T) {
    const s = this.map.get(type);
    if (!s) return;
    // slow-handler timing for the scene switch (window.__hpMarks['ev:<type>#<i>'] = ms, only ≥ 20 ms)
    const timed = type === 'world:ready' || type === 'world:built';
    let i = 0;
    for (const fn of [...s]) {
      const t0 = timed ? performance.now() : 0;
      try { fn(data); } catch (e) { console.error(`[event ${type}]`, e); }
      if (timed) {
        const ms = performance.now() - t0;
        const m = (globalThis as any).__hpMarks;
        if (m && ms >= 20) m[`ev:${type}#${i}`] = `${Math.round(ms)} ${String(fn).replace(/\s+/g, ' ').slice(0, 70)}`;
      }
      i++;
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
