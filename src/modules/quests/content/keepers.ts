import { Dialogues } from '../api';
import { T, pick, role, back, info, wallet, hour, day, isUnlocked } from './common';
import type { DlgCtx, DlgOption } from '../api';
import type { TL } from '../../../core/util';

/** a "buy this recipe card" option (hidden once known; locked while too poor or `need` fails) */
function card(id: string, text: TL, price: number, from: string, next: string, need?: (c: DlgCtx) => string | null): DlgOption {
  return {
    text, next, if: (c) => !isUnlocked(c.game, id),
    lock: (c) => need?.(c) ?? (wallet(c) < price ? `ต้องมี ${price} ฿ (มี ${wallet(c)} ฿)` : null),
    do: (c) => c.game.intent('quest.buyRecipe', { id, price, from }),
  };
}

/* ============================================================================================
 * The nine shopkeepers. Personalities from shops/data.ts:
 *   ป้าแดง soft_auntie · ลุงหมึก stingy_uncle · ป้าศรี chatty_auntie · เจ๊หมวย business_jeh · เจ๊ติ๋ม chatty_auntie
 *   เฮียเส็ง polite_hia · ลุงหนวด gruff_uncle · น้องฟ้า robot_clerk · แคชเชียร์แม็กโคร่ง cashier
 * Every one has: a greeting that changes with the time of day, a useful cooking / shopping tip, soi gossip
 * (hints at the ghost ritual, the landlord, the restaurant), a cheeky option with a reaction, and a goodbye.
 * Quest offers / hand-ins are injected by the quests runtime on top of these.
 * ========================================================================================== */

export function registerKeepers() {
  // ---------------------------------------------------------------- ป้าแดง (Auntie Daeng)
  Dialogues.register({
    id: 'k_auntie', match: role('shopkeeper:auntie_stall'), voice: 1.28,
    barks: [T('หนูจ๋า หมูสับสดๆ จ้า', 'fresh minced pork, dear'), T('กะเพราเพิ่งมาเมื่อเช้า หอมเลย', 'basil came in this morning'), T('กินข้าวยังลูก?', 'eaten yet, dear?')],
    start: (c) => (hour(c.game) < 9 ? 'early' : 'hi'),
    nodes: [
      { id: 'early', say: T('ตายแล้ว มาแต่เช้าเลยหนู ขยันจริงๆ ป้าเพิ่งตั้งแผงเสร็จเอง', 'Oh my, so early! Auntie only just set up the stall'), anim: 'wave', options: [
        { text: T('รีบมาซื้อของก่อนหมดครับป้า', 'Came early before it sells out'), next: 'hi' },
        { text: T('นอนบนลังกระดาษมันเมื่อยครับ เลยตื่นเช้า', 'Cardboard beds hurt, so I woke up early'), next: 'cardboard' },
      ] },
      { id: 'hi', say: (c) => T(pick(['ว่าไงหนู วันนี้จะเอาอะไรดีลูก?', 'มาแล้วเหรอหนู ป้ารออยู่เลย', 'หนูหน้าตาซูบไปนะ กินข้าวบ้างหรือเปล่า?']), pick(['What will it be today, dear?', 'There you are, dear!', 'You look thin, are you eating?'])), anim: 'talk', options: [
        { text: T('ป้ามีเคล็ดลับทำกะเพราไหมครับ?', 'Any tips for kaphrao?'), next: 'tip' },
        { text: T('ช่วงนี้ในซอยมีข่าวอะไรบ้างครับ?', 'Any news in the soi?'), next: 'gossip' },
        { text: T('ป้าสวยขึ้นนะครับวันนี้', 'You look pretty today, auntie'), next: 'flirt' },
      ] },
      { id: 'cardboard', say: T('โถ… มานี่ ป้าให้ไข่ไปทอดกินฟองนึง ไม่ต้องจ่ายๆ (แต่วันหลังซื้อหมูป้านะ)', 'Aww… have an egg on me. Free! (but buy my pork next time)'), face: 'think', options: back('hi') },
      info('tip', T('จำไว้นะลูก ไฟต้องแรงสุด ใส่กระเทียมพริกก่อน หมูตาม กะเพราใส่ตอนท้ายสุดแล้วปิดไฟเลย เดี๋ยวใบดำ', 'Max heat. Garlic and chili first, then pork. Basil goes in LAST, then off the heat or it turns black'), 'hi'),
      info('gossip', T('ได้ยินว่าห้องแถวปิดๆ ข้างหลังรถเข็นหนูน่ะ เจ๊เจ้าของเค้าอยากปล่อยเช่านะ ถ้าหนูขายดีๆ ลองไปคุยดู เปิดร้านจริงจังไปเลย!', 'The closed shophouse behind your cart? The owner wants to rent it out. Sell well and go talk to her, open a real restaurant!'), 'hi'),
      { id: 'flirt', say: T('ปากหวานแบบนี้ ป้าลดให้ไม่ได้หรอกนะ… …เอาไปเถอะ ห้าบาทพอ (ล้อเล่น)', "Sweet talk won't get you a discount… …fine, five baht. (Joking)"), face: 'shock', anim: 'celebrate', options: back('hi', T('ฮ่าๆ ไปละครับป้า', 'Haha, bye auntie')) },
    ],
  });

  // ---------------------------------------------------------------- ลุงหมึก (Uncle Muek, butcher, stingy)
  Dialogues.register({
    id: 'k_butcher', match: role('shopkeeper:butcher_stall'), voice: 0.78,
    barks: [T('หมูสดๆ ไม่สดไม่ขาย!', 'fresh pork, or no deal!'), T('จะซื้อก็ซื้อ ไม่ซื้อก็หลบ', 'buy or move aside'), T('เขียงนี้ลุงใช้มาสามสิบปี', 'thirty years on this block')],
    start: () => 'hi',
    nodes: [
      { id: 'hi', say: (c) => T(pick(['อะไรไอ้หนู จะเอาหมูส่วนไหน พูดมาเร็วๆ', 'ไอ้หนูนี่อีกแล้ว วันนี้มีตังค์มาหรือเปล่า?', 'หมูดีที่สุดในซอยอยู่ตรงนี้ ไม่ต้องไปหาที่อื่น']), pick(['What cut? Speak up', 'You again. Brought money today?', 'Best pork in the soi, right here'])), anim: 'talk', options: [
        { text: T('หมูสับกับหมูชิ้นต่างกันยังไงครับลุง?', "What's the difference, minced vs sliced?"), next: 'tip' },
        { text: T('ลุงขายมานานแค่ไหนแล้วครับ?', 'How long have you sold here?'), next: 'story' },
        { text: T('ลุงลดให้หน่อยได้ไหมครับ', 'Can I get a discount?'), next: 'discount' },
        { text: T('ลุงหน้าเหมือนหมูเลยครับ', 'You look like a pig, uncle'), next: 'rude' },
      ] },
      info('tip', T('หมูสับทำกะเพรา หมูชิ้นทำกระเทียม ผัดซีอิ๊ว ราดหน้า หมูชิ้นต้องหมักนิดนึง ผัดไฟแรงๆ ไม่งั้นเหนียวเหมือนรองเท้า', 'Minced for kaphrao. Sliced for garlic pork, see ew, rad na: marinate a bit and sear hot or it gets chewy like a shoe'), 'hi'),
      info('story', T('สามสิบปี! ตั้งแต่ซอยนี้ยังเป็นทุ่งนา… เมียลุงยังบอกว่าลุงรักเขียงมากกว่าเมีย ก็จริงของมันนะ', "Thirty years! Since this soi was rice fields… my wife says I love this block more than her. She's right"), 'hi'),
      info('discount', T('ลด? ไอ้หนู หมูกิโลละเท่าไหร่รู้ไหม! …กด R ต่อราคาเอาเองแล้วกัน ลุงไม่ใจอ่อนหรอก', 'Discount? Know what pork costs?! …haggle with R if you dare, I never soften'), 'hi', { face: 'neutral', anim: 'shrug' }),
      { id: 'rude', say: T('ว่าไงนะ!? เอามีดอีโต้มาดิ๊… อ้าว มีดหายไปไหนวะ!', 'WHAT?! Give me my cleaver… huh, where did my cleaver go?!'), face: 'scream', anim: 'angry', options: [{ text: T('ขอโทษครับลุง!', 'Sorry uncle!'), end: true }] },
    ],
  });

  // ---------------------------------------------------------------- ป้าศรี (Auntie Sri, veg, chatty)
  Dialogues.register({
    id: 'k_veg', match: role('shopkeeper:veg_stall'), voice: 1.2,
    barks: [T('ผักบุ้งงามๆ น้อง!', 'lovely morning glory!'), T('พริกขี้หนูเผ็ดถึงใจ', 'bird chilies, proper hot'), T('รู้ไหม… เจ๊หมวยน่ะนะ…', 'did you hear… about Jeh Muay…')],
    start: () => 'hi',
    nodes: [
      { id: 'hi', say: (c) => T(pick(['น้องๆ มานี่ๆ ป้ามีเรื่องจะเล่า!', 'ผักสดๆ จ้าน้อง วันนี้ป้าอารมณ์ดี', 'ว้าย น้องคนเดิม! ไปทำอะไรมาหน้ามันเชียว']), pick(['Come here, auntie has a story!', "Fresh veg! I'm in a good mood", 'You again! Why so oily-faced?'])), anim: 'wave', options: [
        { text: T('มีเรื่องอะไรเหรอป้า?', "What's the story?"), next: 'gossip' },
        { text: T('ผักอะไรใช้ทำอะไรบ้างครับ?', 'Which veg for which dish?'), next: 'tip' },
        { text: T('ป้าพูดเยอะจังครับ', 'You talk a lot, auntie'), next: 'rude' },
      ] },
      { id: 'gossip', say: T('ป้าจะบอกให้นะ ลุงพเนจรท้ายซอยน่ะ เค้าว่าตอนดึกๆ ใกล้เที่ยงคืน ศาลพระภูมิท้ายซอยมีคนเห็นผีมานั่งกินน้ำแดง! ป้าไม่เชื่อหรอก… แต่ป้าไม่ไปนะ', "Listen. The homeless uncle says near midnight, at the spirit house at the end of the soi, people saw a ghost sipping red soda! Auntie doesn't believe it… but auntie won't go"), face: 'shock', options: [
        { text: T('เรื่องจริงเหรอป้า!?', 'For real?!'), next: 'gossip2' },
        ...back('hi'),
      ] },
      info('gossip2', T('จริงไม่จริงไม่รู้ ไปถามลุงพเนจรดูสิ ซื้อข้าวไปฝากลุงด้วยนะ ลุงชอบไข่ดาว', "Who knows. Ask the homeless uncle, and bring him food. He loves fried eggs"), 'hi'),
      info('tip', T('ผักบุ้งผัดไฟแดง ถั่วฝักยาวใส่กะเพรา คะน้าใส่ผัดซีอิ๊ว มะนาวตะไคร้ข่าใบมะกรูดเก็บไว้ต้มยำ ผักป้าสดทุกอย่าง (ยกเว้นที่เหี่ยว)', 'Morning glory for the flaming stir-fry, long beans in kaphrao, kale in see ew, lime/lemongrass/galangal/kaffir for tom yum. All fresh (except the wilted ones)'), 'hi'),
      { id: 'rude', say: T('ป้าพูดเยอะ? ป้าเนี่ยนะ? ใครบอก! เมื่อวานป้าพูดน้อยกว่านี้อีก ป้าแค่… ห๊ะ? ไปซะไป๊!', "Me? Talk a lot? Who said that! Yesterday I talked even less, I just… huh? Shoo!"), face: 'shock', anim: 'angry', options: [{ text: T('ไปแล้วครับ!', 'Going!'), end: true }] },
    ],
  });

  // ---------------------------------------------------------------- เจ๊หมวย (Jeh Muay, eggs & dry goods, business)
  Dialogues.register({
    id: 'k_egg', match: role('shopkeeper:egg_stall'), voice: 1.1,
    barks: [T('ไข่เบอร์ศูนย์ ฟองละสี่บาท!', 'jumbo eggs, four baht!'), T('ซื้อแผงถูกกว่านะน้อง', 'cheaper by the tray'), T('น้ำปลาขวดใหญ่ คุ้มกว่า', 'big fish sauce, better value')],
    start: () => 'hi',
    nodes: [
      { id: 'hi', say: T('น้องมาซื้อของหรือมาคุย? เจ๊เวลาเป็นเงินเป็นทองนะ', 'Buying or chatting? Time is money, kid'), anim: 'talk', options: [
        { text: T('ซื้อยังไงให้คุ้มที่สุดครับเจ๊?', "How do I get the best value?"), next: 'tip' },
        { text: T('เจ๊รวยแล้วยังขายอยู่อีกเหรอครับ', "You're rich, why still sell?"), next: 'rich' },
        { text: T('เจ๊ครับ ป้าศรีเค้าว่าเจ๊…', 'Auntie Sri says you…'), next: 'gossip' },
      ] },
      info('tip', T('ซื้อเป็นแผง เป็นขวดใหญ่ ถูกกว่าเยอะ ร้านอาหารตามสั่งกำไรอยู่ที่ต้นทุนนะน้อง จานละห้าสิบ ต้นทุนต้องไม่เกินยี่สิบ', 'Buy by the tray, big bottles. Profit is in the cost: a 50 ฿ plate must cost under 20'), 'hi'),
      info('rich', T('รวยที่ไหน! เจ๊มีลูกสามคน คอนโดสองห้อง รถหนึ่งคัน หนี้สี่ก้อน… อ้าว พูดเยอะไปละ', "Rich?! Three kids, two condos, one car, four debts… oops, said too much"), 'hi', { face: 'shock' }),
      info('gossip', T('อีศรีอีกแล้ว! ปากอย่างกับลำโพงวัด บอกมันนะว่าไข่เจ๊ไม่เคยเน่า มีแต่ "สุกเกินไปนิดนึง"', "Sri again! Mouth like a temple loudspeaker. Tell her my eggs are never rotten, just 'a little over-ripe'"), 'hi', { face: 'scream', anim: 'angry' }),
    ],
  });

  // ---------------------------------------------------------------- เจ๊ติ๋ม (Jeh Tim, plastic & furniture, chatty)
  Dialogues.register({
    id: 'k_plastic', match: role('shopkeeper:plastic_shop'), voice: 1.2,
    barks: [T('เก้าอี้แดงๆ ตัวละหกสิบห้า!', 'red stools, 65 each!'), T('โต๊ะพับก็มีนะน้อง', 'folding tables too'), T('ร่มใหญ่กันแดดกันฝน', 'big umbrellas, sun and rain')],
    start: () => 'hi',
    nodes: [
      { id: 'hi', say: T('มาๆ น้อง เปิดร้านต้องมีเก้าอี้มีโต๊ะ ลูกค้าจะได้นั่ง ไม่ใช่ยืนกินเหมือนม้า', 'Come! A shop needs stools and tables, or customers eat standing like horses'), anim: 'wave', options: [
        { text: T('ร้านผมต้องมีอะไรบ้างครับ?', 'What does my shop need?'), next: 'tip' },
        { text: T('เก้าอี้พลาสติกแดงทำไมถึงฮิตครับ?', 'Why are red plastic stools so popular?'), next: 'stool' },
      ] },
      info('tip', T('โต๊ะหนึ่งตัวกับเก้าอี้สองสามตัว ลูกค้านั่งได้ ขายได้มากขึ้น! มีถังขยะ ทิชชู่ ตู้กดน้ำ ลูกค้าจะให้ดาวเยอะๆ แล้วถ้าจะเปิดร้านใหญ่ ร้านเฟอร์นิเจอร์มีของสวยๆ นะ', 'A table and two or three stools: more seats, more sales! A bin, tissues, a water dispenser get you more stars. For a big shop, the furniture store has nice things'), 'hi'),
      info('stool', T('ถูก ทน ซ้อนได้ เปื้อนแกงก็ล้างออก แถมสีแดงทำให้คนหิว! (เจ๊อ่านมาจากเฟซ)', 'Cheap, tough, stackable, wipes clean, and red makes people hungry! (Jeh read it on Facebook)'), 'hi'),
    ],
  });

  // ---------------------------------------------------------------- เฮียเส็ง (Hia Seng, kitchenware, polite) — sells a recipe card
  Dialogues.register({
    id: 'k_kitchen', match: role('shopkeeper:kitchen_shop'), voice: 0.9,
    barks: [T('กระทะเหล็กแท้ อาตี๋', 'real iron woks, young man'), T('ตะหลิวดีๆ ผัดมือไม่เมื่อย', 'a good spatula saves your wrist'), T('อั๊วมีสูตรลับนะ', 'I have a secret recipe')],
    start: () => 'hi',
    nodes: [
      { id: 'hi', say: T('อ้า อาตี๋ มาๆ อั๊วมีของดีจะให้ดู', 'Ah, young man! Come, I have something good'), anim: 'talk', options: [
        { text: T('เฮียมีสูตรลับอะไรครับ?', 'What secret recipe?'), next: 'card', if: (c) => !isUnlocked(c.game, 'phat_si_io') },
        { text: T('กระทะแบบไหนดีครับ?', 'Which wok is best?'), next: 'tip' },
        { text: T('เฮียเคยเป็นนักร้องคาราโอเกะเหรอครับ?', 'Were you a karaoke singer?'), next: 'karaoke' },
      ] },
      { id: 'card', say: T('สูตรผัดซีอิ๊วของอาม่าอั๊ว เส้นหอมกลิ่นกระทะ ใส่ซีอิ๊วดำนิดเดียวพอ ขายให้ลื้อสามร้อย ไม่แพงนะ อาม่าทำมาหกสิบปี', "My grandma's pad see ew: smoky noodles, just a dash of dark soy. 300 ฿ for you, a bargain, she made it 60 years"), face: 'think', options: [
        { text: T('เอาครับ! (300 ฿)', "Deal! (300 ฿)"), lock: (c) => (wallet(c) < 300 ? `ต้องมี 300 ฿ (มี ${wallet(c)} ฿)` : null), do: (c) => c.game.intent('quest.buyRecipe', { id: 'phat_si_io', price: 300, from: 'kitchen_shop' }), next: 'bought' },
        { text: T('แพงไปครับเฮีย', 'Too pricey'), next: 'pricey' },
      ] },
      info('bought', T('อาม่าคงดีใจ… อย่าลืมนะ ไฟแรงๆ ให้เส้นไหม้นิดๆ แต่ไม่ใช่ไหม้หมดนะ!', 'Grandma would be happy… remember: high heat, char the noodles a little, not a lot!'), 'hi', { anim: 'celebrate' }),
      info('pricey', T('งั้นไปเก็บเงินก่อน หรือฝึกผัดเยอะๆ เดี๋ยวก็คิดสูตรเองได้ (อั๊วไม่บอกนะว่าต้องเลเวลสี่)', 'Then save up, or practise a lot and figure it out yourself (I did NOT say cooking level 4)'), 'hi', { anim: 'shrug' }),
      info('tip', T('กระทะเหล็กแท้ ต้องเผาก่อนใช้ ล้างแล้วเช็ดให้แห้ง ทาน้ำมันนิดนึง อยู่ได้เป็นสิบปี กระทะเทฟลอนน่ะ ผัดกะเพราไม่ได้กลิ่นกระทะหรอก', 'Real iron: season it, dry it, oil it, lasts ten years. Non-stick never gets that wok smell'), 'hi'),
      info('karaoke', T('ลื้อรู้ได้ไง! ทุกคืนวันศุกร์อั๊วร้องเพลงสุนทราภรณ์ที่ร้านลุงข้างวัด เสียงอั๊วนุ่มเหมือนตะหลิวไม้', 'How did you know?! Every Friday I sing old Suntaraporn songs by the temple. My voice is smooth as a wooden spatula'), 'hi', { anim: 'dance' }),
    ],
  });

  // ---------------------------------------------------------------- ลุงหนวด (Uncle Nuad, gas, gruff)
  Dialogues.register({
    id: 'k_gas', match: role('shopkeeper:gas_shop'), voice: 0.72,
    barks: [T('แก๊สหมดเมื่อไหร่ มาเปลี่ยน', 'out of gas? swap here'), T('น้ำแข็งหลอดเย็นเจี๊ยบ', 'ice, freezing cold'), T('อย่าสูบบุหรี่แถวนี้!', 'no smoking here!')],
    start: () => 'hi',
    nodes: [
      { id: 'hi', say: T('ว่าไงไอ้น้อง แก๊สหมดหรือมาขอน้ำแข็ง?', 'Out of gas, or begging for ice?'), anim: 'talk', options: [
        { text: T('เปลี่ยนแก๊สยังไงครับลุง?', 'How do I swap gas?'), next: 'tip' },
        { text: T('ลุงชอบกินอะไรครับ?', 'What do you like to eat?'), next: 'food' },
        { text: T('หนวดลุงเท่จังครับ', 'Cool moustache, uncle'), next: 'stache' },
      ] },
      info('tip', T('ยกถังเปล่ามาวาง จ่ายค่าแก๊ส ลุงเปลี่ยนถังเต็มให้ ถังสิบห้าโลหนักนะ แบกดีๆ อย่าให้หลังพัง ต่อหัวแก๊สแน่นๆ ได้ยินเสียงฟู่ปิดก่อน!', 'Bring the empty tank, pay for the gas, I swap a full one. 15 kg is heavy, lift with your legs. Tighten the regulator, if it hisses, shut it!'), 'hi'),
      info('food', T('เผ็ด! เผ็ดจนน้ำตาไหล ร้านไหนทำเผ็ดไม่ถึง ลุงไม่กินซ้ำ ไอ้หนุ่มรุ่นนี้ทำอาหารจืดเหมือนน้ำล้างจาน', 'SPICY! Spicy till I cry. Not spicy enough, I never go back. You young ones cook like dishwater'), 'hi', { face: 'neutral' }),
      info('stache', T('หนวดนี้ไว้มาตั้งแต่สมัยเป็นทหาร เมียลุงขู่ว่าถ้าโกนจะหย่า… ลุงเลยไม่โกน (เพราะกลัวเมียจะอยู่ต่อ)', "Grew it in the army. My wife threatened divorce if I shave… so I don't (I'm afraid she'd stay)"), 'hi', { anim: 'stand_cool' }),
    ],
  });

  // ---------------------------------------------------------------- น้องฟ้า (robot clerk, 8-Twelve)
  Dialogues.register({
    id: 'k_store', match: role('shopkeeper:convenience_store'), voice: 1.45,
    barks: [T('สวัสดีค่ะ 8-Twelve ยินดีต้อนรับค่ะ', 'hello, welcome to 8-Twelve'), T('รับซาลาเปาเพิ่มไหมคะ', 'add a steamed bun?'), T('สะสมแสตมป์ไหมคะ', 'collecting stamps?')],
    start: () => 'hi',
    nodes: [
      { id: 'hi', say: T('สวัสดีค่ะ 8-Twelve ยินดีต้อนรับค่ะ รับซาลาเปาเพิ่มไหมคะ', 'Hello, welcome to 8-Twelve. Would you like a steamed bun?'), anim: 'talk', options: [
        { text: T('ไม่รับครับ', 'No thanks'), next: 'no' },
        { text: T('น้องฟ้าเหนื่อยไหมครับ ยืนทั้งวัน', "Aren't you tired, standing all day?"), next: 'tired' },
        { text: T('ร้านนี้เปิดกี่โมงครับ?', 'What are the hours?'), next: 'hours' },
      ] },
      info('no', T('รับทราบค่ะ รับไส้กรอกเพิ่มไหมคะ', 'Understood. Would you like a sausage?'), 'hi'),
      info('tired', T('…ระบบไม่สามารถประมวลผลคำถามนี้ได้ค่ะ… (กระซิบ) เหนื่อยมากพี่ ช่วยด้วย', '…the system cannot process this question… (whispers) so tired, help'), 'hi', { face: 'sleep' }),
      info('hours', T('เปิดยี่สิบสี่ชั่วโมงค่ะ เหล้าเบียร์ขายได้สิบเอ็ดโมงถึงบ่ายสอง และห้าโมงเย็นถึงเที่ยงคืนค่ะ ตามกฎหมายค่ะ', 'Open 24 hours. Alcohol only 11:00–14:00 and 17:00–24:00, by law'), 'hi'),
    ],
  });

  // ---------------------------------------------------------------- Makrong cashier
  Dialogues.register({
    id: 'k_wholesale', match: role('shopkeeper:wholesale'), voice: 1.3,
    barks: [T('บัตรสมาชิกมีไหมคะ', 'membership card?'), T('ช่องนี้สิบชิ้นค่ะ', 'ten items or less')],
    start: () => 'hi',
    nodes: [
      { id: 'hi', say: T('สวัสดีค่ะ แม็กโคร่งค่ะ มีบัตรสมาชิกไหมคะ?', 'Hello, Makrong. Do you have a membership card?'), anim: 'talk', options: [
        { text: T('ไม่มีครับ สมัครยังไง?', "No, how do I join?"), next: 'card' },
        { text: T('ซื้อเยอะๆ ถูกจริงไหมครับ?', 'Is bulk really cheaper?'), next: 'tip' },
      ] },
      info('card', T('ต้องมีทะเบียนการค้าค่ะ… พี่มีรถเข็นใช่ไหมคะ? งั้นก็นับเป็นธุรกิจค่ะ ยินดีด้วยค่ะ พี่เป็นเจ้าของกิจการแล้ว', "You need a business registration… you own a food cart? Then that counts. Congratulations, you're a business owner"), 'hi', { anim: 'celebrate' }),
      info('tip', T('ถูกกว่าตลาดค่ะ แต่ซื้อทีต้องแบกเยอะนะคะ น้ำมันห้าลิตร ข้าวสารห้ากิโล พี่แบกไหวไหมคะ', 'Cheaper than the market, but you carry a lot: 5 L of oil, 5 kg of rice. Can you lift it?'), 'hi'),
    ],
  });

  // ---------------------------------------------------------------- เจ๊ปลา (Jeh Pla, seafood, loud & funny)
  Dialogues.register({
    id: 'k_seafood', match: role('shopkeeper:seafood_stall'), voice: 1.05,
    barks: [T('กุ้งเป็นๆ ดีดได้!', 'live prawns, still jumping!'), T('ปลาสดตาใส ไม่สดเจ๊กินเอง!', 'clear-eyed fish, if not fresh I eat it myself!'), T('ปูม้าไข่แน่นๆ จ้า', 'blue crabs full of roe!'), T('อาตี๋ หลบน้ำแข็งด้วย!', 'mind the ice, kid!')],
    start: (c) => (hour(c.game) < 7 ? 'early' : 'hi'),
    nodes: [
      { id: 'early', say: T('เรือเพิ่งเข้าเมื่อตีสี่! อาตี๋มาทันของดีพอดี ดูกุ้งแม่น้ำนี่ ตัวเท่าแขนเจ๊!', 'The boat came in at 4! You made it for the good stuff, look at these river prawns, big as my arm!'), anim: 'wave', options: [{ text: T('ว้าว ตัวโตจริง', 'Whoa, huge'), next: 'hi' }] },
      { id: 'hi', say: (c) => T(pick(['ว่าไงอาตี๋ วันนี้เอาทะเลหรือเอาน้ำจืด?', 'มาๆ อาตี๋ ปลาตาใสๆ ไม่ใสเจ๊ควักตาให้ดูเลย!', 'อาตี๋ ทำหน้าเหมือนปลาเค็มเลย อดนอนมาเหรอ?']), pick(['Sea or river today?', 'Clear-eyed fish! If not, I pop the eye out for you!', 'You look like salted fish, no sleep?'])), anim: 'talk', options: [
        { text: T('เจ๊มีสูตรทะเลขายไหมครับ?', 'Selling any seafood recipes?'), next: 'cards' },
        { text: T('สูตรแพงๆ สำหรับลูกค้ารวยมีไหมครับ?', 'Something pricey for rich customers?'), next: 'prem', if: (c) => day(c.game) >= 2 },
        { text: T('ทำปลา ทำกุ้งยังไงครับ?', 'How do I clean fish and prawns?'), next: 'tip' },
        { text: T('เจ๊สวยเหมือนนางเงือกเลยครับ', 'You look like a mermaid, Jeh'), next: 'flirt' },
      ] },
      { id: 'cards', say: T('สูตรเจ๊ได้มาจากแม่ค้าข้าวแกงท่าเรือ สามสิบปีไม่เคยบอกใคร… วันนี้บอกอาตี๋ เพราะอาตี๋จ่ายตังค์', 'Got these from the pier curry lady, 30 years secret… telling you today, because you pay'), face: 'think', options: [
        card('kaphrao_talay', T('กะเพราทะเล (80 ฿)', 'Seafood kaphrao (80 ฿)'), 80, 'seafood_stall', 'bought'),
        card('muek_khai_khem', T('ปลาหมึกผัดไข่เค็ม (120 ฿)', 'Squid with salted egg (120 ฿)'), 120, 'seafood_stall', 'bought'),
        card('hoi_thot', T('หอยทอดกรอบ (150 ฿)', 'Crispy oyster omelette (150 ฿)'), 150, 'seafood_stall', 'bought'),
        { text: T('ไว้ก่อนครับ', 'Maybe later'), next: 'hi' },
      ] },
      { id: 'prem', say: T('ของไฮโซ! ลูกค้ากระเป๋าหนักเขาสั่งกันจานละหลายร้อย ของแพง ทำพังเจ๊ไม่รับคืนนะ', 'Hi-so stuff! Deep-pocket customers pay hundreds a plate. Expensive ingredients, ruin them and no refunds'), face: 'think', options: [
        card('kung_phao', T('กุ้งแม่น้ำเผา (350 ฿)', 'Grilled river prawns (350 ฿)'), 350, 'seafood_stall', 'bought'),
        card('khao_phat_pu', T('ข้าวผัดปู (250 ฿)', 'Crab fried rice (250 ฿)'), 250, 'seafood_stall', 'bought'),
        card('pu_phat_phong_kari', T('ปูผัดผงกะหรี่ (450 ฿)', 'Curry-powder crab (450 ฿)'), 450, 'seafood_stall', 'bought', (c) => (day(c.game) < 3 ? 'วันที่ 3 ขึ้นไป' : null)),
        card('pla_neung_manao', T('ปลากะพงนึ่งมะนาว (400 ฿)', 'Steamed lime sea bass (400 ฿)'), 400, 'seafood_stall', 'bought'),
        { text: T('มีอีกไหมครับ', 'More?'), next: 'prem2' },
        { text: T('ไว้ก่อนครับ', 'Maybe later'), next: 'hi' },
      ] },
      { id: 'prem2', say: T('อันนี้ของแพงจริง เจ๊เองยังไม่กล้ากิน', "These are seriously pricey, even I don't dare eat them"), face: 'think', options: [
        card('tom_yam_nam_khon', T('ต้มยำกุ้งน้ำข้น (300 ฿)', 'Creamy tom yum (300 ฿)'), 300, 'seafood_stall', 'bought', (c) => (!isUnlocked(c.game, 'tom_yam') ? 'ต้องทำต้มยำเป็นก่อน' : null)),
        card('yam_salmon', T('ยำแซลมอน (350 ฿)', 'Spicy salmon salad (350 ฿)'), 350, 'seafood_stall', 'bought'),
        card('hoi_shell_noei', T('หอยเชลล์ผัดเนย (500 ฿)', 'Butter scallops (500 ฿)'), 500, 'seafood_stall', 'bought'),
        card('kaphrao_wagyu', T('กะเพราวากิวทรัฟเฟิล (900 ฿)', 'Truffle wagyu kaphrao (900 ฿)'), 900, 'seafood_stall', 'wagyu', (c) => (day(c.game) < 3 ? 'วันที่ 3 ขึ้นไป' : null)),
        { text: T('ไว้ก่อนครับ', 'Maybe later'), next: 'hi' },
      ] },
      info('bought', T('จำไว้นะอาตี๋ ทะเลต้องไฟแรง ผัดเร็ว ปลาหมึกผัดนานเหนียวเหมือนยางรถ กุ้งพอแดงก็ยกเลย!', 'Seafood: high heat, fast. Overcook squid and it turns to tyre rubber; prawns go red, take them off!'), 'hi', { anim: 'celebrate' }),
      info('wagyu', T('กะเพราวากิว! ใส่น้ำมันทรัฟเฟิลสามหยดพอ เกินนั้นลูกค้าไฮโซจะบอกว่าเหม็นถุงเท้า… ไปซื้อวากิวที่แม็กโคร่งห้องเย็นนะ เจ๊ไม่ขายของบ้าบอแบบนั้น', 'Wagyu kaphrao! Three drops of truffle oil, more and the rich folk say it smells of socks… buy wagyu at Makrong\'s cold room, I don\'t sell nonsense like that'), 'hi', { anim: 'celebrate', face: 'shock' }),
      info('tip', T('ปลาทั้งตัวเอาไปวางบนเขียง ล้างก่อน แล้วขอดเกล็ด ควักไส้ แล่ตามจังหวะ ปูก็เหมือนกัน ล้างแล้วสับ ถ้าขี้เกียจก็ซื้อกุ้งแกะแล้ว แพงกว่านิดเดียว', 'Whole fish on the board: rinse, scale, gut, fillet on the beat. Crab too: rinse then chop. Lazy? Buy peeled prawns, a bit pricier'), 'hi'),
      { id: 'flirt', say: T('นางเงือก!? ฮ่าๆๆๆ เจ๊ชอบ! แต่ปากหวานไม่ทำให้ปลาสดนะอาตี๋ ราคาเดิม!', 'A MERMAID?! Hahaha, I like you! But sweet talk does not make fish fresh. Same price!'), face: 'shock', anim: 'celebrate', options: back('hi', T('ฮ่าๆ ไปละครับเจ๊', 'Haha, bye Jeh')) },
    ],
  });

  // ---------------------------------------------------------------- ป้าหวาน (Auntie Waan, desserts, sweet)
  Dialogues.register({
    id: 'k_dessert', match: role('shopkeeper:dessert_stall'), voice: 1.32,
    barks: [T('ขนมหวานจ้า หวานเหมือนคนขาย', 'sweets, sweet as the seller!'), T('มะม่วงน้ำดอกไม้ลูกสุดท้ายจ้า', 'last nam dok mai mangoes!'), T('กะทิคั้นสดๆ หอมๆ', 'freshly pressed coconut milk'), T('กินคาวต้องกินหวานนะลูก', 'after savoury comes sweet, dear')],
    start: () => 'hi',
    nodes: [
      { id: 'hi', say: (c) => T(pick(['มาจ้ะหนู ชิมบัวลอยป้าก่อนไหม?', 'หนูขายของคาวใช่ไหม ขายหวานด้วยสิ ลูกค้ากินเสร็จเขาอยากได้ของหวาน', 'วันนี้ร้อน ทับทิมกรอบขายดีแน่ลูก']), pick(['Try my bua loi first?', 'You sell savoury? Sell sweets too, customers want dessert after', 'Hot today, red rubies will sell'])), anim: 'talk', options: [
        { text: T('ป้าสอนทำขนมหน่อยครับ', 'Teach me a dessert?'), next: 'free', if: (c) => !isUnlocked(c.game, 'bua_loi') || !isUnlocked(c.game, 'kluay_buat_chi') },
        { text: T('ป้ามีสูตรขนมขายไหมครับ?', 'Selling dessert recipes?'), next: 'cards' },
        { text: T('ขนมต้องทำยังไงครับ?', 'How do desserts work?'), next: 'tip' },
        { text: T('ป้าหวานกว่าขนมอีกครับ', "You're sweeter than your desserts"), next: 'flirt' },
      ] },
      { id: 'free', say: T('สอนฟรีจ้ะ ป้าไม่หวง บัวลอยกับกล้วยบวชชี ต้มกะทิกับน้ำตาลมะพร้าว ใส่กระทะไฟอ่อนๆ อย่าให้เดือดพล่าน กะทิจะแตกมัน', "Free, auntie doesn't mind. Bua loi and bananas in coconut milk: simmer coconut milk and palm sugar in the wok, gentle heat, never a hard boil or it splits"), anim: 'celebrate', options: [
        { text: T('ขอบคุณครับป้า!', 'Thank you, auntie!'), do: (c) => { for (const id of ['bua_loi', 'kluay_buat_chi']) if (!isUnlocked(c.game, id)) c.game.intent('quest.buyRecipe', { id, price: 0, from: 'dessert_stall' }); }, next: 'hi' },
      ] },
      { id: 'cards', say: T('อันนี้สูตรขายจ้ะ ป้าก็ต้องกินต้องใช้ แต่ไม่แพงหรอก', 'These ones I sell, auntie has to eat too, but cheap'), face: 'think', options: [
        card('khao_niao_mamuang', T('ข้าวเหนียวมะม่วง (100 ฿)', 'Mango sticky rice (100 ฿)'), 100, 'dessert_stall', 'bought'),
        card('thapthim_krop', T('ทับทิมกรอบ (80 ฿)', 'Red rubies (80 ฿)'), 80, 'dessert_stall', 'bought'),
        card('lot_chong_nam_kathi', T('ลอดช่องน้ำกะทิ (60 ฿)', 'Lod chong (60 ฿)'), 60, 'dessert_stall', 'bought'),
        card('itim_kathi', T('ไอติมกะทิ (60 ฿)', 'Coconut ice cream (60 ฿)'), 60, 'dessert_stall', 'bought'),
        { text: T('มีอีกไหมครับ', 'More?'), next: 'cards2' },
        { text: T('ไว้ก่อนครับ', 'Maybe later'), next: 'hi' },
      ] },
      { id: 'cards2', say: T('ของวัยรุ่นจ้ะ เด็กๆ ชอบ', 'The trendy ones, kids love them'), options: [
        card('bingsu_mamuang', T('บิงซูมะม่วง (150 ฿)', 'Mango bingsu (150 ฿)'), 150, 'dessert_stall', 'bought'),
        card('roti_kluay_khai', T('โรตีกล้วยไข่ (100 ฿)', 'Banana-egg roti (100 ฿)'), 100, 'dessert_stall', 'bought'),
        { text: T('ไว้ก่อนครับ', 'Maybe later'), next: 'hi' },
      ] },
      info('bought', T('ของหวานเย็นๆ ทำในกะละมังผสมขนมนะลูก ไม่ใช่กระทะร้อนๆ น้ำแข็งละลายหมด แล้วรีบเสิร์ฟ อย่าวางทิ้งไว้', 'Cold desserts go in the dessert basin, not a hot wok, or the ice melts. Then serve quickly, don\'t let it sit'), 'hi', { anim: 'celebrate' }),
      info('tip', T('ขนมร้อนอย่างบัวลอยใช้กระทะไฟอ่อน ขนมเย็นอย่างทับทิมกรอบ ลอดช่อง บิงซู ใส่กะละมังผสม (ป้าขายใบละ 120) ตักใส่ถ้วย ลูกค้ากินข้าวเสร็จเขาสั่งของหวานต่อ ได้ตังค์สองต่อ!', 'Hot sweets like bua loi: wok, low heat. Cold ones like rubies, lod chong, bingsu: in the dessert basin (I sell it, 120). Customers order dessert after their meal, double money!'), 'hi'),
      { id: 'flirt', say: T('อุ๊ยตาย! ปากหวานแบบนี้ ป้าแถมกะทิให้ถุงนึงเลย (ไม่จริงจ้ะ แต่ต่อราคาได้นะ)', 'Oh my! With a mouth that sweet you get a free bag of coconut milk (not really, but go ahead and haggle)'), face: 'shock', anim: 'celebrate', options: back('hi', T('ฮ่าๆ ไปละครับป้า', 'Haha, bye auntie')) },
    ],
  });
}
