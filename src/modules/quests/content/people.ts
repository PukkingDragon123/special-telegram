import type { TL } from '../../../core/util';
import { Dialogues, TalkTarget, DlgCtx } from '../api';
import { T, pick, role, back, info, wallet, hour, isUnlocked } from './common';

/* ============================================================================================
 * People of the soi: ลุงพเนจร (homeless: give money, life story, ritual hints), the old cart owner, the วิน
 * guys, the gossip aunties, the walking lottery lady, and small talk for EVERY other person (by archetype).
 * ========================================================================================== */

/** small talk per archetype keyword: [hi lines, about-the-soi lines, reaction to "eat at my shop!"] */
const SMALL: [RegExp, TL[], TL[], TL[]][] = [
  [/monk/, [T('เจริญพร โยม', 'Blessings, layman')], [T('ซอยนี้สงบดี… ยกเว้นตอนกลางคืนที่มีคนเห็นผี', 'This soi is peaceful… except the nights people see ghosts')], [T('อาตมาฉันได้ก่อนเที่ยงเท่านั้นนะโยม ถ้าจะใส่บาตรพรุ่งนี้เช้าก็อนุโมทนา', 'A monk only eats before noon. If you offer alms tomorrow morning, I rejoice')]],
  [/police/, [T('มีอะไรครับ? ใบขับขี่มีไหม… ล้อเล่น', 'Yes? Licence please… just kidding')], [T('ซอยนี้มีปัญหาเดียวคือคนจอดมอไซค์ขวางทาง กับเรื่องผี', 'Only problems here: parked motorbikes everywhere, and ghosts')], [T('ถ้าอร่อยจริงเดี๋ยวพาลูกน้องไปกินทั้งโรงพัก', "If it's good I'll bring the whole station")]],
  [/tourist|backpacker/, [T('Hello! Sawasdee krub! Is this… the famous street food?', 'Hello! Sawasdee krub!')], [T('This street is amazing! So many cables! So many cats!', 'So many cables and cats!')], [T('Pad kra-pao? Not spicy please… okay maybe a little spicy… okay Thai spicy!', 'Not spicy… okay Thai spicy!')]],
  [/student|teen|gamer|kid/, [T('หวัดดีครับพี่ / ค่ะพี่', 'Hi!'), T('พี่เป็นยูทูบเบอร์ป่ะ?', 'Are you a YouTuber?'), T('เชี่ย เกมแพ้อีกแล้ว ทีมโคตรกาก', 'Damn, lost the game again, my team is trash')], [T('ร้านเกมปากซอยปิดไปแล้ว เศร้ามาก', 'The game shop at the soi mouth closed, so sad'), T('ครูบอกว่าห้ามเดินท้ายซอยตอนกลางคืน', 'Teacher says never walk to the end of the soi at night')], [T('ผัดกะเพราราคานักเรียนได้ไหมพี่ สามสิบบาท', 'Student price? 30 baht?')]],
  [/office/, [T('สวัสดีค่ะ/ครับ รีบอยู่นิดนึงนะ', 'Hi, in a bit of a rush')], [T('เที่ยงทีไรหาร้านกินยากมาก คิวยาวทุกร้าน', 'Lunch is a war, queues everywhere')], [T('ถ้าได้เร็วภายในห้านาทีจะไปกินทุกวันเลย!', 'If it comes in five minutes I will eat there every day!')]],
  [/auntie|housewife|old_lady|temple_lady|grandma/, [T('ว่าไงลูก หน้าตาคุ้นๆ นะ', 'Hello dear, you look familiar'), T('อุ๊ย หล่อจัง/สวยจัง มีแฟนยัง', 'Oh so good-looking, single?')], [T('ราคาผักขึ้นอีกแล้ว อยู่ยากจริงๆ', 'Veg prices went up again'), T('ได้ยินว่าเจ้าของห้องแถวปิดๆ จะให้เช่า', 'Heard the closed shophouse is for rent')], [T('ป้าจะไปลองนะ ถ้าไม่อร่อยป้าจะบอกทั้งซอยเลย', "I'll try it. If it's bad, the whole soi will know")]],
  [/uncle|grandpa|karaoke/, [T('ไงไอ้หนุ่ม/สาว', 'Hey there, youngster'), T('ไอ้เด็กเวร มาทำอะไรแถวนี้', 'You little punk, what are you doing round here'), T('เออ ว่าไง ลุงเพิ่งตื่น ปวดหลังชิบหาย', 'Yeah what? Just woke up, my back hurts like hell')], [T('สมัยลุงหนุ่มๆ ซอยนี้มีแต่ต้นมะม่วง', 'When I was young this soi was all mango trees'), T('ไอ้พวกมอไซค์แม่งขับเร็วชิบหาย เดี๋ยวก็ตายห่ากันหมด', 'Those damn bikers ride like maniacs, they\'ll all get themselves killed')], [T('เผ็ดน้อยนะ ลุงความดันขึ้น', 'Not too spicy, my blood pressure')]],
  [/delivery|rider/, [T('ขอทางหน่อยพี่ ออเดอร์จะเย็นแล้ว!', 'Excuse me, my order is getting cold!'), T('เชี่ย ลูกค้าให้ดาวเดียวอีกแล้ว แม่ง', 'Damn, another one-star rating, ugh')], [T('ซอยนี้ GPS พาวนสามรอบทุกที', 'GPS sends me round this soi three times')], [T('เปิดในแอปยังพี่? ถ้ามีในแอปผมรับส่งให้เลย', 'Are you on the app? I can deliver for you')]],
  [/construction|worker|sweeper|guard/, [T('ว่าไงพี่ ร้อนเนอะวันนี้', 'Hot today, huh'), T('ร้อนชิบหาย เหงื่อท่วมตูดแล้วเนี่ย', 'Hot as hell, I\'m sweating buckets'), T('หัวหน้าแม่งด่าทั้งวัน เบื่อว่ะ', 'The boss chews me out all day, sick of it')], [T('ทำงานทั้งวันหิวมาก ข้าวจานเดียวไม่พอ', 'Working all day, one plate is never enough')], [T('พิเศษไข่ดาวสองฟองได้ป่ะพี่', 'Extra two fried eggs?')]],
  [/gangster/, [T('มองหน้าหาเรื่องเหรอ… ล้อเล่น หิวข้าวว่ะ', 'You looking at me? …kidding, I\'m hungry'), T('มึงมองไรวะ… เออ ไม่มีไร ไปๆ', 'What the hell you looking at… eh, nothing, beat it'), T('ไอ้สัส ตกใจหมด นึกว่าตำรวจ', 'Jeez, you scared the crap out of me, thought you were a cop')], [T('ซอยนี้ใครก็รู้จักพี่', 'Everyone in this soi knows me')], [T('ไม่เผ็ดไม่กินนะ บอกไว้ก่อน', "If it's not spicy, I'm not eating")]],
  [/sexy_girl/, [T('กรี๊ดดดด! อ้าว ขอโทษ ตกใจนึกว่าแมลงสาบ', 'EEEEK! Oh sorry, thought you were a cockroach')], [T('ซอยนี้แมลงสาบเยอะมาก กรี๊ด!', 'So many roaches here, EEEK!')], [T('ร้านสะอาดไหม? มีแมลงสาบไหม? กรี๊ดดด', 'Is it clean? Any roaches? EEEK')]],
];
function small(t: TalkTarget): [TL[], TL[], TL[]] {
  const r = t.role.toLowerCase();
  for (const [re, a, b, c] of SMALL) if (re.test(r)) return [a, b, c];
  return [[T('สวัสดีครับ/ค่ะ', 'Hello'), T('ว่าไง', 'Hey')], [T('ซอยนี้อยู่สบายดี มีของกินเยอะ', 'Nice soi, lots of food')], [T('เดี๋ยวลองไปกินนะ!', "I'll come try it!")]];
}

export function registerPeople() {
  // ---------------------------------------------------------------- ลุงพเนจร
  Dialogues.register({
    id: 'p_homeless', match: role('homeless'), priority: 1, voice: 0.7,
    barks: [T('เศษเงินเศษทองไหมหลาน…', 'spare a coin…'), T('ลุงเคยรวยนะ…', 'I was rich once…'), T('เที่ยงคืน… ท้ายซอย… น้ำแดง…', 'midnight… end of the soi… red soda…')],
    start: (c) => (hour(c.game) >= 22 || hour(c.game) < 5 ? 'night' : 'hi'),
    nodes: [
      { id: 'hi', say: (c) => T(pick(['หลานเอ๋ย… วันนี้ลุงยังไม่ได้กินอะไรเลย', 'ว่าไงหลาน ขายดีไหม? ลุงเห็นนะ ลุงเห็นทุกอย่าง', 'ชีวิตก็เหมือนข้าวผัด… บางทีก็แฉะ บางทีก็ไหม้']), pick(["Haven't eaten all day, child", 'Selling well? I see everything', 'Life is like fried rice… sometimes mushy, sometimes burnt'])), face: 'think', options: [
        { text: T('ให้ลุง 5 บาทครับ', 'Here, 5 baht'), lock: (c) => (wallet(c) < 5 ? 'ไม่มีตังค์' : null), do: (c) => c.game.intent('life.give', { amount: 5 }), next: 'thanks' },
        { text: T('ให้ลุง 20 บาทเลย', 'Here, 20 baht'), lock: (c) => (wallet(c) < 20 ? 'ไม่มีตังค์' : null), do: (c) => c.game.intent('life.give', { amount: 20 }), next: 'thanks' },
        { text: T('ลุงมาอยู่ตรงนี้ได้ไง?', 'How did you end up here?'), next: 'story' },
        { text: T('ซอยนี้มีอะไรแปลกๆ ไหมลุง?', 'Anything strange in this soi?'), next: 'strange' },
      ] },
      { id: 'night', say: T('ชู่ว… ดึกแล้ว อย่าเสียงดัง พวก "เขา" ออกมาเดินแล้ว', 'Shh… it\'s late, keep quiet. "They" are walking about'), face: 'shock', options: [
        { text: T('"เขา" ใครครับ?', 'Who are "they"?'), next: 'strange' },
        ...back('hi', T('ขนลุกแล้วครับ ไปละ', 'Goosebumps, bye')),
      ] },
      info('thanks', T('ขอบใจหลาน… บุญรักษานะ ขอให้ขายดี ลูกค้าเต็มร้าน ผีไม่หลอก', 'Thank you, child… may merit protect you. Full tables, no ghosts'), 'hi', { anim: 'pray' }),
      info('story', T('ลุงเคยเปิดร้านเกมปากซอย… มีคอมสามสิบเครื่อง เด็กๆ เต็มร้าน แล้วมือถือก็มา… ตอนนี้ลุงเหลือแต่ลังกระดาษกับความทรงจำ', 'I once ran the game shop at the soi mouth… thirty PCs, full of kids. Then smartphones came… now I have cardboard and memories'), 'hi', { face: 'think', anim: 'sad' }),
      { id: 'strange', say: T('เที่ยงคืน… ท้ายซอย… น้ำแดง… ศาลพระภูมิท้ายซอยไง ตอนห้าทุ่มกว่าๆ มีคนเห็นแสงไฟ ได้ยินเสียงไลฟ์สด… ลุงรู้วิธีเรียก "เขา" ออกมานะ แต่ความลับไม่ได้ฟรีหรอก', 'Midnight… end of the soi… red soda… The spirit house at the end of the soi: after eleven, lights, a live-stream voice… I know how to call "them". But secrets aren\'t free'), face: 'think', options: [
        { text: T('ต้องแลกกับอะไรครับ?', 'What does it cost?'), next: 'cost' },
        ...back('hi'),
      ] },
      info('cost', (c: DlgCtx) => ((c.game.g as any).ritualHint
        ? T('ลุงบอกไปแล้วไง ของไหว้ห้าอย่าง น้ำแดงใส่หลอด ไข่ต้ม มาลัย ม้าลาย ธูปสามดอก วางที่โต๊ะหน้าศาล ห้าทุ่มถึงเที่ยงคืน แล้วสวดให้ถูก… คาถาน่ะ ไปขอซื้อตำราจากตาขายพระหน้าวัด', 'Told you: five offerings: red soda with a straw, boiled eggs, a garland, a zebra, three incense sticks, on the table by the shrine, 11pm to midnight, then chant right… buy the spell book from the amulet grandpa at the temple')
        : T('ข้าวสักจาน… ลุงหิว ท้องว่างพูดเรื่องผีไม่ได้ เดี๋ยวผีมันกินเรา', "A plate of food… can't talk ghosts on an empty stomach, they'd eat US")), 'hi'),
    ],
  });

  // ---------------------------------------------------------------- the old cart owner
  Dialogues.register({
    id: 'p_oldman', match: (t: TalkTarget) => t.role === 'oldman' || t.role === 'oldman_visit', priority: 1, voice: 0.68,
    barks: [T('รถเข็นลุงสบายดีไหม…', 'is my cart well…'), T('ไฟแรงๆ นะหลาน', 'high heat, child')],
    start: () => 'hi',
    nodes: [
      { id: 'hi', say: T('อ้าว หลาน… รถเข็นลุงเป็นไงบ้าง ยังวิ่งดีไหม ล้อซ้ายมันชอบออดนะ', "Ah, child… how's my old cart? Still rolling? The left wheel squeaks"), anim: 'talk', options: [
        { text: T('ลุงขายรถเข็นมานานไหมครับ?', 'How long did you sell from it?'), next: 'story' },
        { text: T('ลุงมีสูตรอะไรอีกไหมครับ?', 'Got more recipes, uncle?'), next: 'recipes' },
      ] },
      info('story', T('สี่สิบปี! ขายตั้งแต่ข้าวจานละห้าบาท ลุงเลี้ยงลูกสามคนจบมหาลัยด้วยรถคันนี้ ดูแลมันดีๆ นะ อย่าเอาไปชนเสาไฟอีก', 'Forty years! From five-baht plates. Put three kids through university with that cart. Treat her well, stop crashing her into poles'), 'hi', { face: 'think' }),
      info('recipes', (c: DlgCtx) => (isUnlocked(c.game, 'khai_jiao')
        ? T('ลุงมีอีกเยอะ แต่ต้องค่อยๆ ให้ เดี๋ยวหลานทำไม่ทัน ไปช่วยคนในซอยบ้าง เดี๋ยวเค้าก็สอนสูตรให้เอง', 'Plenty more, slowly. Help the people in the soi, they will teach you their own recipes')
        : T('พรุ่งนี้เช้าลุงจะเอาหน้ากระดาษสูตรไข่เจียวมาให้ ทำง่ายแต่ทำให้ฟูยาก', "Tomorrow morning I'll bring the omelette page. Easy to make, hard to make fluffy")), 'hi'),
    ],
  });

  // ---------------------------------------------------------------- the วิน guys (crowd set piece, local talkers)
  Dialogues.register({
    id: 'p_moto', match: role('moto_taxi'), priority: 1, voice: 0.95,
    barks: [T('ไปไหนครับพี่!', 'where to, bro?'), T('วินซอยนี้ราคามิตรภาพ', 'friendly prices here'), T('เอ้า! หมากฮอสอีกตา', 'one more game of checkers!')],
    start: () => 'hi',
    nodes: [
      { id: 'hi', say: (c) => T(pick(['ไปไหนครับพี่! ปากซอยยี่สิบ ท้ายซอยสามสิบ', 'พี่ครับ เล่นหมากฮอสด้วยกันไหม ใช้ฝาขวดเป็นตัวหมาก', 'ร้านพี่ใช่ไหมที่กลิ่นกะเพราหอมไปทั้งซอย']), pick(['Where to? 20 to the mouth, 30 to the end', 'Checkers with bottle caps?', "Is that your shop smelling of basil all down the soi?"])), anim: 'wave', options: [
        { text: T('ซอยนี้มีอะไรน่าสนใจบ้างครับ?', "What's interesting around here?"), next: 'soi' },
        { text: T('พี่วินขี่มากี่ปีแล้ว?', 'How long have you been riding?'), next: 'years' },
      ] },
      info('soi', T('ห้องแถวหลังรถเข็นพี่ไง เจ้าของเค้าจะให้เช่า! ถ้าพี่เปิดร้านจริงๆ พวกผมจะพาลูกค้าไปส่งหน้าร้านเลย', "The shophouse behind your cart is for rent! Open a real shop and we'll drop customers right at your door"), 'hi'),
      info('years', T('สิบห้าปีครับ เสื้อวินตัวนี้ซักมาพันครั้ง สีส้มจางเป็นสีพีชแล้ว', 'Fifteen years. Washed this vest a thousand times, the orange faded to peach'), 'hi', { anim: 'stand_cool' }),
    ],
  });

  // ---------------------------------------------------------------- the gossip aunties at the market entrance
  Dialogues.register({
    id: 'p_gossip', match: role('gossip'), priority: 1, voice: 1.18,
    barks: [T('รู้ยัง! รู้ยัง!', 'did you hear!'), T('อุ๊ยตาย จริงเหรอ', 'oh my, really?'), T('อย่าไปบอกใครนะ', "don't tell anyone")],
    start: () => 'hi',
    nodes: [
      { id: 'hi', say: (c) => T(pick(['อุ๊ย หนุ่ม/สาวรถเข็นนี่นา! มาๆ ป้าจะเล่าให้ฟัง', 'ชู่ว! เราคุยเรื่องสำคัญกันอยู่… เรื่องของเธอนั่นแหละ', 'รู้ยัง! ลุงหมึกกับป้าแดงทะเลาะกันเรื่องราคาหมูอีกแล้ว']), pick(['The cart kid! Come, listen', "Shh! We're discussing important things… about you", 'Did you hear! Uncle Muek and Auntie Daeng fought over pork prices again'])), anim: 'talk', options: [
        { text: T('เล่าหน่อยครับป้า', 'Tell me, aunties'), next: 'tell' },
        { text: T('พวกป้าพูดถึงผมว่าอะไรบ้าง?', 'What do you say about me?'), next: 'me' },
      ] },
      info('tell', (c: DlgCtx) => T(pick(['เจ๊หมวยไปซื้อทองมาอีกเส้น! รวยจริงหรือแค่ใส่หลอก!', 'เค้าว่าน้องฟ้าที่ 8-Twelve เป็นหุ่นยนต์ เพราะไม่เคยเห็นกินข้าวเลย', 'ศาลพระภูมิท้ายซอย มีคนเอาน้ำแดงไปถวาย แล้วตอนเช้าน้ำแดงหมด! ใครกิน!?']), pick(['Jeh Muay bought another gold chain! Rich or fake?', 'They say Fah at 8-Twelve is a robot, never seen her eat', 'Someone offers red soda at the spirit house and by morning it\'s gone! Who drinks it!?'])), 'hi', { face: 'shock' }),
      info('me', (c: DlgCtx) => (Number((c.game.g as any).reputation ?? 3) >= 3.5
        ? T('ว่ากะเพราร้านเธออร่อยที่สุดในซอย! แต่อย่าหยิ่งนะ เดี๋ยวป้าเลิกชม', 'That your kaphrao is the best in the soi! Don\'t get cocky or we stop praising')
        : T('ว่าเธอนอนบนลังกระดาษ… แล้วก็ว่ากะเพราร้านเธอยังจืดไปหน่อย ฮิๆ', 'That you sleep on cardboard… and your kaphrao is a bit bland. Hehe')), 'hi'),
    ],
  });

  // ---------------------------------------------------------------- the walking lottery lady (crowd)
  Dialogues.register({
    id: 'p_lotto_walker', match: role('lottery_walker'), priority: 1, voice: 1.05,
    barks: [T('ลอตเตอรี่จ้า เลขสวยๆ!', 'lottery! lucky numbers!'), T('งวดนี้ออกแน่!', 'this draw for sure!')],
    start: () => 'hi',
    nodes: [
      { id: 'hi', say: T('ลอตเตอรี่ไหมจ๊ะ งวดนี้เลขสวย ป้าฝันเห็นงูเมื่อคืน!', 'Lottery? Lucky numbers, I dreamt of a snake last night!'), anim: 'talk', options: [
        { text: T('ฝันเห็นงูแปลว่าเลขอะไรครับ?', 'What number is a snake?'), next: 'snake' },
        { text: T('ผมไม่เล่นหวยครับ', "I don't gamble"), next: 'nogamble' },
      ] },
      info('snake', T('งูตัวเล็กห้าหก งูตัวใหญ่เจ็ดแปด ถ้างูกินไข่ดาวก็… เลขร้านหลานไง! ฮ่าๆ', 'Small snake 5-6, big snake 7-8, and a snake eating a fried egg… YOUR shop\'s number! Haha'), 'hi', { anim: 'celebrate' }),
      info('nogamble', T('ไม่เล่นหวย? แต่หลานเพิ่งเสียเงินหมดตัวที่คาสิโนนะ ป้ารู้นะ ทั้งซอยรู้!', "You don't gamble? You just lost everything at a casino! I know, the whole soi knows!"), 'hi', { face: 'shock' }),
    ],
  });

  // ---------------------------------------------------------------- everyone else: small talk by archetype (fallback)
  Dialogues.register({
    id: 'p_smalltalk', match: (t) => !t.role.startsWith('ghost') && t.role !== 'cat' && t.role !== 'dog' && !t.role.startsWith('shopkeeper:'), priority: -10,
    barks: (t) => small(t)[0],
    start: () => 'hi',
    nodes: [
      { id: 'hi', say: (c) => pick(small(c.target)[0]), anim: 'wave', options: [
        { text: T('แถวนี้เป็นไงบ้างครับ?', "How's this area?"), next: 'soi' },
        { text: T('มาลองกินกะเพราร้านผมสิครับ!', 'Come try my kaphrao!'), next: 'ad' },
      ] },
      info('soi', (c: DlgCtx) => pick(small(c.target)[1]), 'hi'),
      info('ad', (c: DlgCtx) => pick(small(c.target)[2]), 'hi', { anim: 'celebrate' }),
    ],
  });
}
