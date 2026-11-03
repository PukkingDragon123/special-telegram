import type { Game } from '../../../game/game';
import type { Ent } from '../../../sim/state';
import { Quests, QuestDef, DlgCtx, DlgOption, TalkTarget } from '../api';
import { questState } from '../runtime';
import { T, role, carried, carriedDish, day, hour, isUnlocked } from './common';

/* ============================================================================================
 * SIDE QUESTS (10). Givers get a floating "!" when a quest is available, a "?" where it is handed in.
 * Host-validated hand-ins go through quest.op; dialogue checks the same conditions locally first.
 *   auntie_taste      ป้าแดง wants to taste your kaphrao               → ข้าวผัด
 *   cleaver_lost      the soi dog stole ลุงหมึก's cleaver                → หมูกระเทียม
 *   spicy_challenge   ลุงหนวด: "cook me something that makes me cry"     → ผัดพริกแกง
 *   morning_glory     ป้าศรี's morning glory delivery to the gossip aunties → ผัดผักบุ้ง
 *   moto_energy       the วิน guys want 3 M-150s
 *   lost_cat          เจ๊ติ๋ม's cat มะลิ is missing again
 *   robot_greeting    learn the sacred 8-Twelve greeting from น้องฟ้า
 *   homeless_meal     feed ลุงพเนจร → he tells you the midnight ritual
 *   egg_omelette      เจ๊หมวย wants the fluffiest omelette in the soi
 *   wok_test          เฮียเส็ง needs a dish worthy of his new wok
 * ========================================================================================== */

const DISH_TH: Record<string, string> = { kaphrao_moo: 'กะเพราหมูสับ', khai_dao: 'ข้าวไข่ดาว', khai_jiao: 'ข้าวไข่เจียว' };

/** HOST: find + remove an item the player carries */
function takeFrom(game: Game, pl: Ent, pred: (e: Ent) => boolean, n = 1): number {
  const ids = [...new Set<number>((pl.inv ?? []).filter((x: any) => x !== null))];
  let took = 0;
  for (const id of ids) {
    if (took >= n) break;
    const e = game.state.get(id);
    if (e && pred(e)) { game.items.remove(e); took++; }
  }
  return took;
}
const anyHolds = (game: Game, pred: (e: Ent) => boolean) => game.players().some((p) => (p.inv ?? []).some((id: any) => { const e = id !== null ? game.state.get(id) : null; return !!e && pred(e); }));
const isDishOf = (recipe: string | null, minTaste: number) => (e: Ent) => e.k === 'dish' && (!recipe || e.data?.recipe === recipe) && (e.data?.taste ?? 0) >= minTaste;
const isM150 = (e: Ent) => /m150|energy/.test(String(e.k));
const active = (game: Game, id: string, step?: number) => { const s = questState(game, id); return !!s && s.status === 'active' && (step === undefined || s.step === step); };
const at = (r: string) => (t: TalkTarget) => t.role === r;
const say = (game: Game, eid: number | undefined, th: string, en: string) => { if (eid !== undefined) game.say(eid, T(th, en), { duration: 3 }); };

function handIn(id: string, who: string, step: number, o: { text: DlgOption['text']; can: (c: DlgCtx) => boolean; op?: string; ok: DlgOption['text']; no?: { text: DlgOption['text']; say: DlgOption['text'] } }): QuestDef['dialog'] {
  return [{
    who: at(who),
    options: (c) => {
      if (!active(c.game, id, step)) return [];
      const out: DlgOption[] = [];
      if (o.can(c)) out.push({ text: o.text, next: `${id}:ok`, do: (cc) => cc.game.intent('quest.op', { id, op: o.op ?? 'give' }) });
      else if (o.no) out.push({ text: o.no.text, next: `${id}:no` });
      return out;
    },
    nodes: [
      { id: `${id}:ok`, say: o.ok as any, anim: 'celebrate', face: 'shock' },
      ...(o.no ? [{ id: `${id}:no`, say: o.no.say as any, face: 'think' as const }] : []),
    ],
  }];
}

export function registerQuests() {
  // ---------------------------------------------------------------- 1. ป้าแดง tastes your kaphrao → fried rice
  Quests.register({
    id: 'auntie_taste', order: 1, title: T('ป้าแดงขอชิม', "Auntie Daeng's taste test"), giver: 'shopkeeper:auntie_stall',
    available: (g) => hour(g) >= 6 && hour(g) < 15,
    offer: T('หนูขายกะเพรามาหลายจานแล้วใช่ไหม ป้าอยากชิมฝีมือหนูหน่อย ถ้าอร่อย ป้าจะสอนข้าวผัดสูตรป้าให้ ใช้ข้าวเหลือๆ ก็อร่อย', "You've sold plenty of kaphrao, right? Let Auntie taste it. If it's good, I'll teach you my fried rice"),
    startLine: T('ทำกะเพราร้อนๆ มาให้ป้าจานนึงนะหนู', 'Bring me a hot plate of kaphrao, dear'),
    steps: [
      { id: 'cook', text: T('ทำกะเพราหมูสับอร่อยๆ หนึ่งจาน', 'Cook a tasty kaphrao moo'), done: (g) => anyHolds(g, isDishOf('kaphrao_moo', 0.5)) },
      { id: 'give', text: T('เอาไปให้ป้าแดงชิม (ตลาดสด)', 'Bring it to Auntie Daeng (market)'), at: 'shopkeeper:auntie_stall' },
    ],
    ops: { give: (g, pl) => takeFrom(g, pl, isDishOf('kaphrao_moo', 0.5)) > 0 },
    dialog: handIn('auntie_taste', 'shopkeeper:auntie_stall', 1, {
      text: T('ป้าครับ กะเพราร้อนๆ มาแล้ว!', 'Hot kaphrao, auntie!'), can: (c) => !!carriedDish(c, (d) => d.recipe === 'kaphrao_moo' && d.taste >= 0.5),
      ok: T('…อื้อหือ! หนูทำได้ไง หอมกระทะเชียว! เอ้า ป้าสอนข้าวผัดให้ ข้าวต้องเป็นข้าวค้างคืนนะ ผัดแล้วไม่แฉะ', '…Wow! So smoky! Here, the fried rice secret: use day-old rice so it never goes mushy'),
      no: { text: T('ลองชิมนี่ก่อนไหมครับป้า', 'Try this, auntie?'), say: T('นี่ไม่ใช่กะเพรา หรือไม่ก็… ไม่อร่อยลูก ลองใหม่นะ ป้ารอได้', "That's not kaphrao, or… it's not good, dear. Try again, Auntie can wait") },
    }),
    reward: { money: 40, recipes: ['khao_phat'], rep: 0.1, xp: { skill: 'cook', amount: 30 } },
  });

  // ---------------------------------------------------------------- 2. ลุงหมึก's cleaver (the soi dog took it) → garlic pork
  Quests.register({
    id: 'cleaver_lost', order: 2, title: T('มีดอีโต้หายไปไหน', 'Where is the cleaver?'), giver: 'shopkeeper:butcher_stall',
    available: (g) => day(g) >= 2 && hour(g) >= 5 && hour(g) < 15,
    offer: T('ไอ้หนู! มีดอีโต้คู่ใจลุงหายไป ลุงสงสัยไอ้ตูบท้ายซอยมันคาบไป เพราะมีดลุงกลิ่นหมูหอม ไปหาให้ลุงที ลุงจะสอนหมูทอดกระเทียมให้', "Kid! My beloved cleaver is gone. I bet that mutt at the end of the soi took it, it smells of pork. Find it and I'll teach you garlic pork"),
    startLine: T('ไปดูที่นอนไอ้ตูบท้ายซอยนะ', "Check the dog's bed at the end of the soi"),
    onStart: (g) => {
      const a = g.world?.anchor('dog_home').p ?? [-11, 0.15, -90];
      const base = g.items.def('cleaver')?.data?.() ?? {};
      g.items.spawn('cleaver', [a[0] + 0.7, (a[1] ?? 0.15) + 0.05, a[2] + 0.4], { yaw: 1.2, data: { ...base, quest: 'cleaver_lost' } });
    },
    steps: [
      { id: 'find', text: T('ตามหามีดอีโต้ (ที่นอนหมาท้ายซอย)', "Find the cleaver (the dog's bed)"), done: (g) => anyHolds(g, (e) => e.data?.quest === 'cleaver_lost'),
        where: (g) => { const e = g.state.find('item', (i) => i.data?.quest === 'cleaver_lost' && i.holder == null); return e?.p ? [e.p[0], e.p[1], e.p[2]] : null; } },
      { id: 'give', text: T('เอามีดไปคืนลุงหมึก', 'Return it to Uncle Muek'), at: 'shopkeeper:butcher_stall' },
    ],
    ops: { give: (g, pl) => takeFrom(g, pl, (e) => e.data?.quest === 'cleaver_lost') > 0 },
    dialog: handIn('cleaver_lost', 'shopkeeper:butcher_stall', 1, {
      text: T('ลุงครับ มีดลุงอยู่นี่!', 'Uncle, your cleaver!'), can: (c) => carried(c).some((e) => e.data?.quest === 'cleaver_lost'),
      ok: T('มีดคู่ใจลุง!! มีรอยฟันหมาด้วย… ช่างมัน ได้คืนก็พอ เอ้า หมูทอดกระเทียม: กระเทียมเยอะๆ ทอดไฟกลางให้เหลืองกรอบ อย่าให้ไหม้ ขม!', 'My beloved!! Dog teeth marks… whatever. Garlic pork: LOTS of garlic, medium heat till golden. Never burnt, it goes bitter!'),
    }),
    reward: { money: 80, recipes: ['moo_kratiam'], rep: 0.1 },
  });

  // ---------------------------------------------------------------- 3. ลุงหนวด's spicy challenge → red curry stir-fry
  Quests.register({
    id: 'spicy_challenge', order: 3, title: T('เผ็ดให้ลุงร้องไห้', 'Make Uncle Nuad cry'), giver: 'shopkeeper:gas_shop',
    available: (g) => day(g) >= 2,
    offer: T('ไอ้น้อง ลุงไม่เคยเจออาหารร้านไหนเผ็ดถึงใจลุงเลยสักร้าน ถ้าแกทำให้ลุงน้ำตาไหลได้ ลุงจะบอกสูตรผัดพริกแกงสมัยลุงอยู่ค่ายทหาร', "Kid, no shop has ever made a dish spicy enough for me. Make me cry and I'll give you my army-camp red curry stir-fry"),
    startLine: T('ใส่พริกเยอะๆ นะ ไม่ใช่พริกเด็กเล่น', 'Real chilies, not baby chilies'),
    steps: [
      { id: 'cook', text: T('ทำอาหารเผ็ดมากๆ หนึ่งจาน (พริกเยอะๆ)', 'Cook something VERY spicy'), done: (g) => anyHolds(g, (e) => e.k === 'dish' && (e.data?.spicy ?? 0) >= 0.6) },
      { id: 'give', text: T('เอาไปให้ลุงหนวดชิม (ร้านแก๊ส)', 'Bring it to Uncle Nuad (gas shop)'), at: 'shopkeeper:gas_shop' },
    ],
    ops: { give: (g, pl) => takeFrom(g, pl, (e) => e.k === 'dish' && (e.data?.spicy ?? 0) >= 0.6) > 0 },
    dialog: handIn('spicy_challenge', 'shopkeeper:gas_shop', 1, {
      text: T('ลองนี่ลุง เผ็ดถึงใจแน่!', 'Try this, uncle, real spicy!'), can: (c) => !!carriedDish(c, (d) => (d.spicy ?? 0) >= 0.6),
      ok: T('…ฮึก… ฮือออ… (น้ำตาไหลพราก) ลุงไม่ได้ร้องไห้นะ! ฝุ่นเข้าตา! …เอ้า ผัดพริกแกง สูตรค่ายทหาร พริกแกงต้องผัดกับน้ำมันให้หอมก่อน!', '…sniff… (tears streaming) I am NOT crying! Dust in my eye! …Red curry stir-fry, army style: fry the paste in oil till fragrant first!'),
      no: { text: T('ลองนี่ก่อนไหมลุง', 'Try this?'), say: T('จืด! เหมือนน้ำล้างจาน! พริกอยู่ไหน!? ไปใส่มาอีกสิบเม็ด!', 'Bland! Dishwater! Where are the chilies? Ten more!') },
    }),
    reward: { money: 60, recipes: ['phat_phrik_kaeng'], rep: 0.1, note: T('ลุงหนวดยอมรับในตัวคุณแล้ว', 'Uncle Nuad respects you now') },
  });

  // ---------------------------------------------------------------- 4. ป้าศรี's morning glory delivery → flaming morning glory
  Quests.register({
    id: 'morning_glory', order: 4, title: T('ผักบุ้งส่งด่วน', 'Morning glory express'), giver: 'shopkeeper:veg_stall',
    available: (g) => day(g) >= 3 && hour(g) >= 6 && hour(g) < 14,
    offer: T('น้องๆ ช่วยป้าเอาผักบุ้งไปส่งให้ป้าๆ ที่ยืนเม้าท์อยู่ปากทางตลาดหน่อย ป้าออกจากแผงไม่ได้ เดี๋ยวพลาดข่าว… เอ้ย เดี๋ยวลูกค้ามา', "Help Auntie deliver morning glory to the gossip aunties at the market entrance. I can't leave, I'd miss the news… er, the customers"),
    startLine: T('สองกำนะ อย่าแอบกิน!', "Two bunches, don't eat them!"),
    onStart: (g, st, pl) => { for (let i = 0; i < 2; i++) { const e = g.items.give(pl, 'morning_glory'); if (e) e.data = { ...(e.data ?? {}), quest: 'morning_glory' }; } },
    steps: [
      { id: 'deliver', text: T('เอาผักบุ้งไปให้ป้าๆ ปากทางตลาด', 'Deliver it to the aunties at the market entrance'), at: 'gossip' },
      { id: 'report', text: T('กลับไปบอกป้าศรี', 'Report back to Auntie Sri'), at: 'shopkeeper:veg_stall' },
    ],
    ops: {
      deliver: (g, pl) => takeFrom(g, pl, (e) => e.k === 'morning_glory', 2) > 0,
      report: () => true,
    },
    dialog: [
      ...handIn('morning_glory', 'gossip', 0, {
        text: T('ป้าศรีฝากผักบุ้งมาครับ', 'Auntie Sri sent morning glory'), op: 'deliver', can: (c) => carried(c).some((e) => e.k === 'morning_glory'),
        ok: T('อุ๊ย ผักบุ้งป้าศรี! ฝากบอกมันด้วยนะว่าเมื่อเช้าเจ๊หมวยไปซื้อทองมา… อ้าว ไม่ต้องบอก เดี๋ยวพวกป้าไปบอกเอง!', "Ooh, Sri's morning glory! Tell her Jeh Muay bought gold this morning… no wait, we'll tell her ourselves!"),
        no: { text: T('เอ่อ… ผักบุ้งหายไปไหนแล้ว', 'Er… where did the veg go'), say: T('ผักบุ้งล่ะ!? อย่าบอกนะว่าเอาไปผัดกินแล้ว!', "Where's the veg?! Don't say you ate it!") },
      })!,
      ...handIn('morning_glory', 'shopkeeper:veg_stall', 1, {
        text: T('ส่งผักบุ้งเรียบร้อยครับป้า', 'Delivered, auntie'), op: 'report', can: () => true,
        ok: T('เก่งมาก! พวกนั้นเม้าท์อะไรป้ามั่งล่ะ… ช่างเถอะ เอ้า สูตรผัดผักบุ้งไฟแดง ไฟต้องลุกพรึ่บ! ใส่เต้าเจี้ยว น้ำมันหอย ผัดแป๊บเดียวพอ', "Good job! What did they say about me… never mind. Flaming morning glory: the wok must FLARE! Bean paste, oyster sauce, a few seconds only"),
      })!,
    ],
    reward: { money: 50, recipes: ['phat_phak_bung'], rep: 0.05 },
  });

  // ---------------------------------------------------------------- 5. the วิน guys want M-150
  Quests.register({
    id: 'moto_energy', order: 5, title: T('เติมพลังวินมอไซค์', 'Recharge the moto-taxi gang'), giver: 'moto_taxi',
    available: (g) => day(g) >= 2 && hour(g) >= 7 && hour(g) < 22,
    offer: T('น้องๆ พวกพี่ขี่มาทั้งวัน หมดแรงแล้ว ไปซื้อเอ็มร้อยห้าสิบที่ 8-Twelve มาให้พี่สามขวดดิ เดี๋ยวพี่จ่ายให้ แถมโปรโมทร้านน้องให้ทั้งซอย!', "Kid, we've ridden all day, we're dead. Grab us three M-150s from the 8-Twelve? We'll pay you back and tell the whole soi about your shop!"),
    startLine: T('สามขวดนะ เย็นๆ ด้วย', 'Three bottles, cold ones'),
    steps: [{ id: 'give', text: T('ซื้อ M-150 สามขวดไปให้พี่วิน (8-Twelve)', 'Bring 3 M-150s to the moto guys (8-Twelve)'), at: 'moto_taxi' }],
    ops: { give: (g, pl) => { const ids = [...new Set<number>((pl.inv ?? []).filter((x: any) => x !== null))]; const have = ids.map((id) => g.state.get(id)).filter((e) => !!e && isM150(e as Ent)).length; return have >= 3 && takeFrom(g, pl, isM150, 3) >= 3; } },
    dialog: handIn('moto_energy', 'moto_taxi', 0, {
      text: T('เอ็มร้อยมาแล้วพี่! สามขวด', 'Three M-150s!'), can: (c) => carried(c).filter(isM150).length >= 3,
      ok: T('เย้! พลังวินกลับมาแล้ว! (ซดรวดเดียว) เดี๋ยวพี่บอกลูกค้าทั้งซอยว่าร้านน้องอร่อย ไปส่งฟรีด้วย!', 'YES! Moto power is back! (chugs) We will tell the whole soi your food is great!'),
      no: { text: T('ยังไม่ครบครับพี่', 'Not all three yet'), say: T('สามขวดนะน้อง สาม! พี่มีกันสามคน', 'Three, kid! There are three of us') },
    }),
    reward: { money: 100, rep: 0.15, note: T('วินซอยช่วยโปรโมทร้าน', 'the moto gang promotes your shop') },
  });

  // ---------------------------------------------------------------- 6. เจ๊ติ๋ม's cat
  Quests.register({
    id: 'lost_cat', order: 6, title: T('ตามหามะลิ', 'Find Mali the cat'), giver: 'shopkeeper:plastic_shop',
    available: (g) => day(g) >= 2 && g.state.all('cat').length > 0,
    offer: T('น้องๆ เห็นแมวเจ๊ไหม ชื่อมะลิ ตัวอ้วนๆ ชอบไปนอนแถวท้ายซอย หายไปตั้งแต่เมื่อคืน เจ๊ไม่มีกะจิตกะใจขายของเลย', "Seen my cat? Mali, chubby, loves sleeping at the end of the soi. Gone since last night, I can't even sell"),
    startLine: T('เจอแล้วกลับมาบอกเจ๊นะ', 'Come tell me when you find her'),
    steps: [
      { id: 'find', text: T('ตามหามะลิ (แมวอ้วน)', 'Find Mali (chubby cat)'),
        done: (g) => { const cats = g.state.all('cat'); return g.players().some((p) => p.p && cats.some((c) => c.p && Math.hypot(c.p[0] - p.p[0], c.p[2] - p.p[2]) < 2.4)); },
        where: (g) => { const c = g.state.all('cat')[0]; return c?.p ? [c.p[0], c.p[1], c.p[2]] : null; } },
      { id: 'report', text: T('กลับไปบอกเจ๊ติ๋ม', 'Tell Jeh Tim'), at: 'shopkeeper:plastic_shop' },
    ],
    ops: { report: () => true },
    dialog: handIn('lost_cat', 'shopkeeper:plastic_shop', 1, {
      text: T('เจอมะลิแล้วครับเจ๊!', 'Found Mali!'), op: 'report', can: () => true,
      ok: T('จริงเหรอ!! นอนอยู่ไหน… หา? นอนบนเบาะมอไซค์ชาวบ้าน? ตามนิสัยเลย! ขอบใจนะน้อง เจ๊ให้รางวัล!', 'Really!! Where… on some stranger\'s motorbike seat? Typical! Thanks, have a reward!'),
    }),
    reward: { money: 60, rep: 0.05, note: T('เจ๊ติ๋มชอบคุณขึ้นมาก', 'Jeh Tim likes you a lot more') },
  });

  // ---------------------------------------------------------------- 7. the sacred 8-Twelve greeting (choice minigame)
  const GREET: { ok: string; bad: string[] }[] = [
    { ok: 'สวัสดีค่ะ', bad: ['หวัดดีจ้ะสุดหล่อ', 'โย่ว ว่าไง'] },
    { ok: '8-Twelve ยินดีต้อนรับค่ะ', bad: ['ยินดีต้อนรับสู่ตลาดนัด', 'ร้านปิดแล้วค่ะ'] },
    { ok: 'รับซาลาเปาเพิ่มไหมคะ', bad: ['รับหมูกระทะเพิ่มไหมคะ', 'รับแฟนเพิ่มไหมคะ'] },
  ];
  const roundNode = (i: number) => {
    const opts = [{ t: GREET[i].ok, good: true }, ...GREET[i].bad.map((b) => ({ t: b, good: false }))];
    // fixed shuffle per round (so it isn't always the first answer)
    const order = [[1, 0, 2], [2, 1, 0], [0, 2, 1]][i];
    return {
      id: `robot_greeting:r${i}`, say: T(['ประโยคแรกค่ะ เมื่อลูกค้าเดินเข้าร้าน พนักงานต้องพูดว่า…', 'ประโยคที่สองค่ะ…', 'ประโยคสุดท้าย ศักดิ์สิทธิ์ที่สุดค่ะ…'][i], ['First line, when a customer walks in, you say…', 'Second line…', 'The last and most sacred line…'][i]),
      options: order.map((k) => ({ text: T(opts[k].t), next: opts[k].good ? (i === 2 ? 'robot_greeting:win' : `robot_greeting:r${i + 1}`) : 'robot_greeting:fail' })),
    };
  };
  Quests.register({
    id: 'robot_greeting', order: 7, title: T('คาถา 8-Twelve', 'The sacred 8-Twelve greeting'), giver: 'shopkeeper:convenience_store',
    available: (g) => day(g) >= 1,
    offer: T('ระบบตรวจพบว่าคุณลูกค้ามาที่ร้านบ่อยมากค่ะ ต้องการทดสอบเป็นพนักงานกิตติมศักดิ์ไหมคะ ต้องพูดประโยคทักทายให้ถูกทั้งสามประโยคค่ะ', 'The system detects you visit very often. Want to try out as an honorary clerk? Say all three greeting lines correctly'),
    startLine: T('เริ่มการทดสอบค่ะ', 'Starting the test'),
    steps: [{ id: 'test', text: T('ท่องคาถาทักทาย 8-Twelve ให้ถูก (คุยกับน้องฟ้า)', 'Recite the 8-Twelve greeting (talk to Fah)'), at: 'shopkeeper:convenience_store' }],
    ops: { pass: () => true },
    dialog: [{
      who: at('shopkeeper:convenience_store'),
      options: (c) => (active(c.game, 'robot_greeting', 0) ? [{ text: T('ขอสอบคาถาทักทายครับ', "I'm ready for the greeting test"), next: 'robot_greeting:r0' }] : []),
      nodes: [
        roundNode(0), roundNode(1), roundNode(2),
        { id: 'robot_greeting:fail', say: T('ผิดค่ะ! ระบบจะรีเซ็ต… ถ้าพูดแบบนี้ ผู้จัดการจะหักเงินเดือนค่ะ ลองใหม่นะคะ', 'Wrong! Resetting… say that and the manager docks your pay. Try again'), face: 'shock', options: [{ text: T('ขอลองใหม่', 'Again'), next: 'robot_greeting:r0' }, { text: T('ยอมแพ้ก่อน', 'I give up for now'), end: true }] },
        { id: 'robot_greeting:win', say: T('ถูกต้องทั้งหมดค่ะ!! ยินดีด้วยค่ะ คุณคือพนักงานกิตติมศักดิ์ 8-Twelve รับซาลาเปาเพิ่มไหมคะ', 'All correct!! You are now an honorary 8-Twelve clerk. Would you like a steamed bun?'), anim: 'celebrate', do: (c) => c.game.intent('quest.op', { id: 'robot_greeting', op: 'pass' }) },
      ],
    }],
    reward: { money: 50, rep: 0.05, note: T('บัตรพนักงานกิตติมศักดิ์ 8-Twelve', 'honorary 8-Twelve clerk card') },
  });

  // ---------------------------------------------------------------- 8. feed ลุงพเนจร → the midnight ritual
  Quests.register({
    id: 'homeless_meal', order: 8, title: T('ข้าวจานนี้เพื่อลุง', 'A plate for the old wanderer'), giver: 'homeless',
    available: (g) => day(g) >= 2,
    offer: T('หนุ่มน้อย… ลุงไม่ได้กินข้าวมาสองวันแล้ว ข้าวไข่ดาวสักจานได้ไหม แลกกับความลับของซอยนี้… ที่ลุงไม่เคยบอกใคร', "Young one… I haven't eaten in two days. A plate of fried egg on rice? In exchange for this soi's secret… one I've told no one"),
    startLine: T('ไข่ดาวกรอบๆ นะ ลุงชอบ', 'Crispy egg, the way I like it'),
    steps: [{ id: 'give', text: T('เอาข้าวไข่ดาว (หรืออาหารอร่อยๆ) ไปให้ลุงพเนจร', 'Bring the old wanderer a fried-egg rice (or any good dish)'), at: 'homeless' }],
    ops: { give: (g, pl) => takeFrom(g, pl, (e) => e.k === 'dish' && (e.data?.taste ?? 0) >= 0.45) > 0 },
    dialog: handIn('homeless_meal', 'homeless', 0, {
      text: T('ข้าวมาแล้วครับลุง', 'Your food, uncle'), can: (c) => !!carriedDish(c, (d) => (d.taste ?? 0) >= 0.45),
      ok: T('(กินหมดในสามคำ) …ความลับนะ… ศาลพระภูมิท้ายซอย ของไหว้ห้าอย่าง: น้ำแดงใส่หลอด ไข่ต้ม มาลัย ม้าลาย ธูปสามดอก ห้าทุ่มถึงเที่ยงคืน คุกเข่าแล้วสวดให้ถูก… คาถาอยู่ในตำราของตาขายพระหน้าวัด แล้วแกจะได้เจอ… "เขา" (ลุงไม่รับผิดชอบนะ)', '(gone in three bites) …the secret… the spirit house at the end of the soi. Five offerings: red soda with a straw, boiled eggs, a garland, a zebra, three incense sticks. 11pm to midnight, kneel and chant it right… the words are in the amulet grandpa\'s book at the temple. Then you meet… "them" (not my responsibility)'),
      no: { text: T('ลุงกินนี่ไหมครับ', 'Want this, uncle?'), say: T('ลุงจนแต่ลุงก็มีมาตรฐานนะ… ขอที่มันอร่อยหน่อย', "I'm poor, not without standards… something tasty please") },
    }),
    reward: { rep: 0.2, xp: { skill: 'serve', amount: 40 }, note: T('ลุงบอกความลับพิธีเที่ยงคืน', 'he told you the midnight ritual'), apply: (g) => { (g.g as any).ritualHint = true; } },
  });

  // ---------------------------------------------------------------- 9. เจ๊หมวย's fluffy omelette
  Quests.register({
    id: 'egg_omelette', order: 9, title: T('ไข่เจียวฟูที่สุดในซอย', 'The fluffiest omelette in the soi'), giver: 'shopkeeper:egg_stall',
    available: (g) => day(g) >= 2 && isUnlocked(g, 'khai_jiao'),
    offer: T('น้อง เจ๊พนันกับอีศรีไว้ ว่าไข่เจ๊ทำไข่เจียวได้ฟูที่สุดในซอย ช่วยทำมาให้เจ๊ดูหน่อย ฟูๆ กรอบๆ ห้ามไหม้! ชนะแล้วเจ๊แบ่งให้', "I bet Sri my eggs make the fluffiest omelette in the soi. Make one for me: puffy, crispy, NOT burnt! Win and I'll share the prize"),
    startLine: T('ตีไข่ให้แตกนะ น้ำมันเยอะๆ ร้อนๆ', 'Whisk well, lots of hot oil'),
    steps: [{ id: 'give', text: T('ทำข้าวไข่เจียวฟูๆ ไปให้เจ๊หมวย', 'Bring Jeh Muay a fluffy omelette on rice'), at: 'shopkeeper:egg_stall' }],
    ops: { give: (g, pl) => takeFrom(g, pl, (e) => e.k === 'dish' && e.data?.recipe === 'khai_jiao' && (e.data?.taste ?? 0) >= 0.55 && !(e.data?.issues ?? []).includes('burnt')) > 0 },
    dialog: handIn('egg_omelette', 'shopkeeper:egg_stall', 0, {
      text: T('ไข่เจียวฟูๆ มาแล้วเจ๊!', 'Fluffy omelette!'), can: (c) => !!carriedDish(c, (d) => d.recipe === 'khai_jiao' && (d.taste ?? 0) >= 0.55 && !(d.issues ?? []).includes('burnt')),
      ok: T('ฟู! กรอบ! สวย! อีศรีแพ้แน่! (ถ่ายรูปลงเฟซ) เอ้า เจ๊ให้ไข่ไปแผงนึงเลย', 'Puffy! Crispy! Gorgeous! Sri is SO going to lose! (posts it on Facebook) Here, a whole tray of eggs'),
      no: { text: T('อันนี้ได้ไหมเจ๊', 'Will this do?'), say: T('นี่ไม่ใช่ไข่เจียวฟู! นี่มันแผ่นยาง! ทำใหม่!', "That's not fluffy, it's a rubber mat! Again!") },
    }),
    reward: { money: 60, items: ['egg_tray'], rep: 0.05 },
  });

  // ---------------------------------------------------------------- 10. เฮียเส็ง's wok test
  Quests.register({
    id: 'wok_test', order: 10, title: T('กระทะใบใหม่ของเฮีย', "Hia Seng's new wok"), giver: 'shopkeeper:kitchen_shop',
    available: (g) => day(g) >= 3,
    offer: T('อาตี๋ อั๊วเพิ่งได้กระทะเหล็กล็อตใหม่มา อยากรู้ว่าดีจริงไหม ลื้อช่วยผัดอะไรอร่อยๆ มาให้อั๊วชิมหน่อย อร่อยระดับ "อร่อย" ขึ้นไปนะ', "Young man, I got a new batch of iron woks. Cook me something truly good (at least 'delicious') so I know they're worth it"),
    startLine: T('ใช้ไฟแรงๆ นะ กระทะนี้ชอบไฟแรง', 'High heat, this wok loves it'),
    steps: [{ id: 'give', text: T('ทำอาหารระดับ "อร่อย" ไปให้เฮียเส็ง', "Bring Hia Seng a 'delicious' dish"), at: 'shopkeeper:kitchen_shop' }],
    ops: { give: (g, pl) => takeFrom(g, pl, isDishOf(null, 0.75)) > 0 },
    dialog: handIn('wok_test', 'shopkeeper:kitchen_shop', 0, {
      text: T('ลองชิมเลยเฮีย!', 'Taste it, Hia!'), can: (c) => !!carriedDish(c, (d) => (d.taste ?? 0) >= 0.75),
      ok: T('โอ้โห… ลื้อมีฝีมือนะเนี่ย! กลิ่นกระทะ (เวยฮัว) ครบ! อั๊วจะเอาไปอวดอาม่า เอ้า ค่าจ้าง', 'Ohh… you have real skill! Perfect wok hei! I must tell grandma. Here, your fee'),
      no: { text: T('อันนี้พอได้ไหมเฮีย', 'Is this good enough?'), say: T('ยังไม่ถึงนะอาตี๋… กระทะดีแล้ว ฝีมือลื้อยังไม่ดี ฮ่าๆ', 'Not yet… the wok is fine, your skill is not. Haha') },
    }),
    reward: { money: 150, rep: 0.1, xp: { skill: 'cook', amount: 50 } },
  });
}

export { DISH_TH, say };
