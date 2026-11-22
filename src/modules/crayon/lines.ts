import { tl, TL } from '../../core/util';

/* Reactions to crayon graffiti & cardboard signs (Thai street register, everyday swearing, no slurs). */
export const CRL: Record<string, TL[]> = {
  // a passer-by notices the scribbling
  notice: [tl('เฮ้ย! ขีดเขียนอะไรกำแพงวะ!', 'Hey! Why are you scribbling on the wall!'), tl('ไอ้เด็กเวร! เลิกเขียนเดี๋ยวนี้!', 'You brat! Stop that right now!'),
    tl('มือบอนนะมึง!', 'Can\'t keep your hands to yourself, huh!'), tl('ศิลปินไส้แห้งเหรอ ไปเขียนบ้านตัวเองไป!', 'Starving artist? Go draw on your own house!'),
    tl('สีเทียนอนุบาลยังเขียนสวยกว่ามึง', 'Kindergarten kids draw better than you')],
  // the owner comes out
  owner: [tl('นั่นกำแพงร้านกู! ไอ้ห่า!', 'That\'s MY shop wall, you bastard!'), tl('ทาสีใหม่เป็นพันนะเว้ย! มานี่เลย!', 'Repainting costs thousands! Get over here!'),
    tl('จับได้แล้วไอ้มือบอน!', 'Got you, scribbler!'), tl('เขียนอีกตัวเดียว กูตบหัวทิ่ม!', 'One more letter and I slap you flat!')],
  auntie: [tl('ไอ้เด็กเปรต! กำแพงป้าเพิ่งทาสี!', 'You little demon! Auntie just painted that wall!'), tl('แม่มึงไม่สอนเหรอ! โดนรองเท้าแตะ!', 'Didn\'t your mom teach you?! Eat slipper!')],
  // gang turf: they don't argue
  gang: [tl('เขียนทับป้ายแก๊งกูเหรอ… มึงตายแน่', 'Writing over our gang tag… you\'re dead'), tl('ซอยนี้ใครเขียนกำแพง โดนยิง', 'In this soi, you tag the wall, you get shot'),
    tl('สีเทียน? ใจกล้านะไอ้น้อง', 'A crayon? Brave little guy'), tl('จำหน้ามันไว้ เก็บมัน', 'Remember that face. Get them')],
  // somebody reads your cardboard sign
  readSign: [tl('ป้ายอะไรของมึงวะ 555', 'What the hell is your sign lol'), tl('ลายมือหมาเขี่ยชัดๆ', 'Handwriting like a chicken scratch'),
    tl('อ่านไม่ออก แต่เห็นด้วย!', 'Can\'t read it, but I agree!'), tl('ประท้วงอะไรอีกเนี่ย', 'What are we protesting now'),
    tl('เขียนผิดอีกแล้ว ไอ้ควาย', 'Spelled it wrong again, dumbass'), tl('ขอถ่ายรูปป้ายหน่อย ลงเฟซ', 'Let me take a pic of that for Facebook'),
    tl('ไปสมัครเป็นนักการเมืองเลยไป', 'Go run for office already')],
};
export const crl = (k: string): TL => { const a = CRL[k] ?? [tl(k)]; return a[(Math.random() * a.length) | 0]; };
