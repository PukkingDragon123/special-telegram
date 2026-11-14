import { tl, TL } from '../../core/util';

/* Short combat barks (Thai street register + short English). No slurs, nothing sexual. */
export const CL: Record<string, TL[]> = {
  flinch: [tl('โอ๊ย! ไอ้บ้า!', 'Ow! You maniac!'), tl('เชี่ย! ตีกูทำไม!', 'What the hell, why hit me!'), tl('ห่าเอ๊ย เจ็บนะเว้ย!', 'Damn, that hurts!'), tl('มึงเป็นไรวะ!', 'What is wrong with you!'), tl('อุ๊ย! แม่จ๋า!', 'Ow! Mommy!')],
  flee: [tl('ช่วยด้วยยย! คนบ้า!', 'Help! A lunatic!'), tl('หนีเร็ว! มันบ้าแล้ว!', 'Run! He\'s lost it!'), tl('ตำรวจ! ตำรวจอยู่ไหน!', 'Police! Where are the police!'), tl('กรี๊ดดด!', 'AAAH!')],
  push: [tl('อย่ามาแตะกูนะ!', 'Don\'t you touch me!'), tl('ถอยไปไอ้ควาย!', 'Back off, idiot!'), tl('อยากโดนเหรอ!', 'You want some?!')],
  fight: [tl('มาดิ! มาเลย!', 'Come on then!'), tl('กูจะตบให้หน้าหัน!', 'I\'ll slap your face sideways!'), tl('ซอยนี้ของกู!', 'This is MY soi!'), tl('แน่จริงอย่าหนีนะ!', 'Don\'t run if you\'re so tough!')],
  gun: [tl('เอาไงล่ะ ทีนี้!', 'What now, huh?!'), tl('หมอบไป ไอ้เวร!', 'Get down, punk!'), tl('ยิ้มให้กล้องหน่อย', 'Smile for the camera')],
  gunAway: [tl('ไปละ ขี้เกียจติดคุก', 'I\'m off, can\'t be bothered with jail'), tl('สอนมวยฟรีวันนี้ 555', 'Free boxing lesson today lol')],
  auntie: [tl('ไอ้เด็กเวร! โดนรองเท้าแตะซะ!', 'You brat! Eat slipper!'), tl('กล้าตีป้าเหรอ!', 'You dare hit auntie?!'), tl('แม่มึงไม่สอนเหรอ!', 'Didn\'t your mother teach you?!')],
  ko: [tl('ดาว… ดาวเต็มฟ้า…', 'Stars… so many stars…'), tl('แม่… หนูเห็นแสง…', 'Mom… I see the light…'), tl('อย่าบอกเมียนะ…', 'Don\'t tell my wife…')],
  wake: [tl('ใครตบกูวะ…', 'Who hit me…'), tl('จำหน้ามึงไว้แล้ว!', 'I\'ll remember your face!')],
  film: [tl('ไลฟ์สด! ไลฟ์สด!', 'Going live! Live!'), tl('ยอดวิวพุ่งแน่งานนี้', 'This is going viral'), tl('5555 ตีกันอีกแล้ว', 'Lol another fight'), tl('กดไลก์กดแชร์!', 'Like and share!')],
  ghost: [tl('ตายแล้วยังโดนตบ… ชีวิตกู', 'Even dead I get slapped… my life'), tl('ขอส่วนบุญหน่อย… ไอ้คนตบ', 'Share some merit… you slapper')],
  police: [tl('หยุด! ตำรวจ!', 'Stop! Police!'), tl('ทำร้ายร่างกาย ค่าปรับสองร้อย!', 'Assault — 200 baht fine!'), tl('จ่ายมาซะดีๆ ไม่งั้นไปโรงพัก', 'Pay up nicely or it\'s the station')],
  policeGone: [tl('คราวหน้าไม่ปล่อยนะ', 'Next time I won\'t let it go'), tl('ไปทำมาหากินดีๆ ไป', 'Go earn an honest living')],
  playerDown: [tl('สลบเหมือด', 'out cold')],
};

export const cl = (k: string): TL => { const a = CL[k] ?? [tl(k)]; return a[(Math.random() * a.length) | 0]; };
