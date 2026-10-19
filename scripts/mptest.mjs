#!/usr/bin/env node
/**
 * Multiplayer smoke test over the BroadcastChannel ("tabs") transport.
 *   node scripts/mptest.mjs [extraQuery]
 * Host page: ?host=tabs&autostart&skipintro ; client page joins with the room code.
 * Verifies: join/welcome, both see 2 players, client movement replicates, client item pickup replicates.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const extra = process.argv[2] || '';
const base = process.env.HP_URL || 'http://127.0.0.1:5173/';
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 400, height: 225 } });
const logs = [];
const mk = async (name, q) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => logs.push(`${name} PAGEERROR ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') logs.push(`${name} console.error ${m.text().slice(0, 200)}`); });
  await p.goto(base + q, { waitUntil: 'domcontentloaded' });
  return p;
};
const host = await mk('host', `?host=tabs&autostart&skipintro&quality=low&debug${extra}`);
await host.waitForFunction(() => window.__hp?.game?.session?.online, null, { timeout: 60000 });
const room = await host.evaluate(() => window.__hp.game.session.room);
console.log('room', room);
const client = await mk('client', `?join=${room}&net=tabs&quality=low&debug${extra}`);
await client.waitForFunction(() => window.__hp?.game?.session?.online && window.__hp.game.localPlayerId > 0, null, { timeout: 90000 });
try {
  await client.waitForFunction(() => window.__hp.game.g.scene === 'world' && window.__hp.game.player, null, { timeout: 90000 });
} catch (e) {
  const dbg = await client.evaluate(() => { const g = window.__hp.game; return { scene: g.g.scene, cur: g.scenes.currentName, busy: g.scenes.busy, me: g.localPlayerId, hidden: document.hidden, players: g.players().length, online: g.session.online, kind: g.session.kind, msg: document.querySelector('#hp-msg')?.textContent, url: location.search }; });
  const dbgH = await host.evaluate(() => ({ hidden: document.hidden, scene: window.__hp.game.scenes.currentName }));
  console.log('CLIENT DEBUG', JSON.stringify(dbg), 'HOST', JSON.stringify(dbgH));
  console.log(logs.slice(0, 30).join('\n'));
  await browser.close();
  process.exit(1);
}
await host.waitForTimeout(3000);
const r1 = await host.evaluate(() => window.__hp.game.players().map((p) => ({ id: p.id, slot: p.slot, name: p.name, p: p.p })));
const r2 = await client.evaluate(() => window.__hp.game.players().map((p) => ({ id: p.id, slot: p.slot, name: p.name, p: p.p })));
console.log('host sees', JSON.stringify(r1));
console.log('client sees', JSON.stringify(r2));
// client moves
await client.evaluate(() => window.__hp.game.player.teleport([0, 0.1, -10], 0));
await host.waitForTimeout(1500);
const moved = await host.evaluate(() => { const g = window.__hp.game; const c = g.players().find((p) => p.id !== g.localPlayerId); return c && c.p; });
console.log('host sees client at', JSON.stringify(moved));
// host spawns a crate near client; client picks it up
const crate = await host.evaluate(() => { const g = window.__hp.game; const c = g.players().find((p) => p.id !== g.localPlayerId); const e = g.items.spawn('dev_crate', [c.p[0] + 0.6, c.p[1] + 0.6, c.p[2]]); return e.id; });
await client.waitForTimeout(1500);
await client.evaluate((id) => window.__hp.game.intent('item.pickup', { id }), crate);
await host.waitForTimeout(1500);
const invHost = await host.evaluate(() => { const g = window.__hp.game; const c = g.players().find((p) => p.id !== g.localPlayerId); return c.inv; });
const invClient = await client.evaluate(() => window.__hp.game.me.inv);
console.log('client inv (host view)', JSON.stringify(invHost), '(client view)', JSON.stringify(invClient));
// client emits a network bubble
await client.evaluate(() => window.__hp.game.say(window.__hp.game.localPlayerId, { th: 'สวัสดีครับ', en: 'hello' }));
await host.waitForTimeout(800);
await host.screenshot({ path: process.env.SHOT_HOST || '/tmp/mp_host.png' });
await client.screenshot({ path: process.env.SHOT_CLIENT || '/tmp/mp_client.png' });
const ok = r1.length === 2 && r2.length === 2 && moved && Math.abs(moved[2] + 10) < 0.5 && invHost.includes(crate) && invClient.includes(crate);
console.log(logs.slice(0, 20).join('\n'));
console.log(ok ? 'MP-OK' : 'MP-FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
