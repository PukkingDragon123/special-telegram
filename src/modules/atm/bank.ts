import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { BRANDS, HOME, fmtSatang } from './brand';

/* ============================================================================================
 * HOST bank. Accounts live in the replicated global entity (g.atm.acc[slot]) so they replicate,
 * survive the day transition and are saved with g by the social save system.
 *   acc = { bal (satang), pin (hash|null), tries, lock (day the card was retained), pending (cash
 *           sitting in the shutter, satang), no (account number), name, lastInt, res }
 *   g.atm.busy[atmId] = { id: playerEnt, t } — who is standing at which machine.
 * One intent 'atm.op' {seq, op, atm, …}; the answer is written to acc.res = {seq, op, ok, code, …}
 * which the client watches (works the same solo and online).
 * PIN auth is a host-only session (not replicated), sliding 10 minutes, cleared by 'end'.
 * Balances can never go negative: every debit checks first.
 * ========================================================================================== */

export interface Acc {
  bal: number; pin: string | null; tries: number; lock: number; pending: number; no: string; name: string; lastInt?: number;
  res?: Res;
}
export interface Res {
  seq: number; op: string; ok: boolean; code?: string;
  amount?: number; fee?: number; bal?: number; ref?: string; to?: string; tries?: number; pinSet?: boolean; interest?: number;
}

const START_BAL = [3725, 1250, 8875, 300];   // satang: ฿37.25, ฿12.50, ฿88.75, ฿3.00 — they lost everything at the casino
const AUTH_SEC = 600;
const MAX_WD = 20000;
/** atm id → brand id (registered by every peer when the world is built) */
export const atmBrand = new Map<string, string>();

function hash(pin: string, slot: number) {
  let h = 5381;
  const s = `hp-atm:${slot}:${pin}`;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function atmState(game: Game) {
  const g = game.g as any;
  if (!g.atm || typeof g.atm !== 'object') g.atm = { acc: {}, busy: {} };
  g.atm.acc ??= {};
  g.atm.busy ??= {};
  return g.atm as { acc: Record<string, Acc>; busy: Record<string, { id: number; t: number } | null> };
}

/** read-only on any peer */
export function accountOf(game: Game, slot: number): Acc | null {
  return ((game.g as any).atm?.acc?.[slot] as Acc) ?? null;
}

function ensure(game: Game, pl: Ent): Acc {
  const st = atmState(game);
  let a = st.acc[pl.slot];
  if (!a) {
    const n = (pl.slot * 7919 + 3) % 100000;
    a = st.acc[pl.slot] = {
      bal: START_BAL[pl.slot] ?? 2000, pin: null, tries: 0, lock: 0, pending: 0,
      no: `${HOME.code}-${pl.slot + 1}-${String(n).padStart(5, '0')}-${(pl.slot * 3 + 7) % 10}`, name: pl.name ?? `Player ${pl.slot + 1}`,
    };
  }
  if (pl.name && a.name !== pl.name) a.name = pl.name;
  return a;
}

export function installBank(game: Game) {
  const auth = new Map<number, number>();       // player id → real time of PIN ok
  let refN = Math.floor(Math.random() * 9000) + 1000;
  const now = () => performance.now() / 1000;
  /** PIN session: sliding window, refreshed by every authenticated operation */
  const authed = (pl: Ent) => {
    const ok = (auth.get(pl.id) ?? -1e9) > now() - AUTH_SEC;
    if (ok) auth.set(pl.id, now());
    return ok;
  };

  game.onIntent('atm.use', (pl, d: { atm: string; on: boolean }) => {
    const st = atmState(game);
    const cur = st.busy[d.atm];
    if (d.on) {
      const other = cur && cur.id !== pl.id && game.state.get(cur.id);
      if (other) return;
      st.busy[d.atm] = { id: pl.id, t: game.g.time ?? 0 };
      ensure(game, pl);
    } else if (!cur || cur.id === pl.id) {
      st.busy[d.atm] = null;
      auth.delete(pl.id);
      // walked away with cash still in the shutter → it is retracted back into the account
      const a = ensure(game, pl);
      if (a.pending > 0) { a.bal += a.pending; a.pending = 0; }
    }
  });

  game.onIntent('atm.op', (pl, d: any) => {
    const a = ensure(game, pl);
    const day = game.g.day ?? 1;
    const seq = Number(d?.seq) || 0;
    const reply = (ok: boolean, extra: Partial<Res> = {}) => { a.res = { seq, op: String(d?.op), ok, bal: a.bal, pinSet: !!a.pin, tries: a.tries, ...extra }; };
    const brand = BRANDS[atmBrand.get(String(d?.atm)) ?? 'soithong'] ?? HOME;
    const ref = () => `${brand.code}${String(day).padStart(2, '0')}${String(++refN % 10000).padStart(4, '0')}`;
    const amt = Math.floor(Number(d?.amount) || 0);
    if (a.lock && a.lock >= day && d?.op !== 'end') { reply(false, { code: 'retained' }); return; }
    switch (d?.op) {
      case 'insert': reply(true); return;
      case 'setpin': {
        if (a.pin && !authed(pl)) { reply(false, { code: 'auth' }); return; }
        if (!/^\d{4}$/.test(String(d.pin))) { reply(false, { code: 'format' }); return; }
        a.pin = hash(String(d.pin), pl.slot); a.tries = 0; auth.set(pl.id, now());
        reply(true); return;
      }
      case 'verify': {
        if (!a.pin) { reply(false, { code: 'nopin' }); return; }
        if (hash(String(d.pin), pl.slot) === a.pin) { a.tries = 0; auth.set(pl.id, now()); reply(true); return; }
        a.tries++;
        if (a.tries >= 3) { a.lock = day; auth.delete(pl.id); reply(false, { code: 'retained' }); return; }
        reply(false, { code: 'wrong' }); return;
      }
      case 'changepin': {
        if (!authed(pl) || !a.pin) { reply(false, { code: 'auth' }); return; }
        if (hash(String(d.old), pl.slot) !== a.pin) { reply(false, { code: 'wrong' }); return; }
        if (!/^\d{4}$/.test(String(d.pin))) { reply(false, { code: 'format' }); return; }
        a.pin = hash(String(d.pin), pl.slot); reply(true); return;
      }
      case 'balance': {
        if (!authed(pl)) { reply(false, { code: 'auth' }); return; }
        reply(true, { ref: ref(), interest: a.lastInt ?? 0 }); return;
      }
      case 'withdraw': {
        if (!authed(pl)) { reply(false, { code: 'auth' }); return; }
        if (amt <= 0 || amt % 100 !== 0) { reply(false, { code: 'notes' }); return; }
        if (amt > MAX_WD) { reply(false, { code: 'limit' }); return; }
        if (a.pending > 0) { reply(false, { code: 'pending' }); return; }
        const fee = brand.id === HOME.id ? 0 : brand.fee * 100;
        if (a.bal < amt * 100 + fee) { reply(false, { code: 'funds', fee }); return; }
        a.bal -= amt * 100 + fee;
        a.pending = amt * 100;
        reply(true, { amount: amt * 100, fee, ref: ref() }); return;
      }
      case 'take': {
        if (a.pending <= 0) { reply(false, { code: 'none' }); return; }
        const baht = Math.round(a.pending / 100);
        a.pending = 0;
        game.money(pl.id, baht, 'atm');
        reply(true, { amount: baht * 100 }); return;
      }
      case 'retract': {
        if (a.pending <= 0) { reply(false, { code: 'none' }); return; }
        const back = a.pending;
        a.bal += back; a.pending = 0;
        reply(true, { amount: back }); return;
      }
      case 'deposit': {
        if (!authed(pl)) { reply(false, { code: 'auth' }); return; }
        if (amt < 20 || amt % 10 !== 0 || amt === 30) { reply(false, { code: 'notes' }); return; }
        if (!game.money(pl.id, -amt, 'atm deposit')) { reply(false, { code: 'nocash' }); return; }
        a.bal += amt * 100;
        reply(true, { amount: amt * 100, ref: ref() }); return;
      }
      case 'transfer': {
        if (!authed(pl)) { reply(false, { code: 'auth' }); return; }
        const to = game.players().find((p) => p.slot === Number(d.to));
        if (!to || to.id === pl.id) { reply(false, { code: 'noacct' }); return; }
        if (amt <= 0 || amt > MAX_WD) { reply(false, { code: 'limit' }); return; }
        if (a.bal < amt * 100) { reply(false, { code: 'funds' }); return; }
        const b = ensure(game, to);
        a.bal -= amt * 100; b.bal += amt * 100;
        game.emit('atm:received', { to: to.id, from: a.name, amount: amt * 100 });
        reply(true, { amount: amt * 100, to: b.name, ref: ref() }); return;
      }
      case 'receipt': {
        const r = d?.rcpt;
        if (!r || typeof r !== 'object') { reply(false, { code: 'none' }); return; }
        const safe: any = {};
        for (const k of ['bank', 'atm', 'date', 'time', 'type', 'typeEn', 'acct', 'ref', 'to', 'name']) if (r[k] !== undefined) safe[k] = String(r[k]).slice(0, 40);
        for (const k of ['amount', 'fee', 'bal', 'interest']) if (r[k] !== undefined) safe[k] = Math.round(Number(r[k]) || 0);
        game.items.give(pl, 'atm_receipt', { data: safe });
        reply(true); return;
      }
      case 'end': auth.delete(pl.id); reply(true); return;
    }
  });
}

/** HOST, new day: retained cards come back, a microscopic interest payment. */
export function bankNewDay(game: Game, day: number) {
  const st = atmState(game);
  for (const k of Object.keys(st.acc)) {
    const a = st.acc[k];
    if (a.lock && a.lock < day) { a.lock = 0; a.tries = 0; }
    if (a.bal > 0) { const i = Math.max(1, Math.round(a.bal * 0.004 / 365)); a.bal += i; a.lastInt = i; }
    a.res = undefined;
  }
  st.busy = {};
}

export { fmtSatang };
