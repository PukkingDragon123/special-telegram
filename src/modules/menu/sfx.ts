import { Sound, SoundOpts } from '../../core/audio';

/* ============================================================================================
 * Menu sounds. Our own files live in public/assets/gen/menu/sfx (credits: references/credits/menu.md)
 * and are registered into the shared Sound manifest at init (keys prefixed `menu_`), unless the
 * audio module already ships a key with the same purpose (then we prefer theirs).
 * ========================================================================================== */

const F = (n: string) => '../gen/menu/sfx/' + n;
const OWN: Record<string, { files: string[]; vol?: number; cat?: string; loop?: boolean; pitchVar?: number }> = {
  menu_click: { files: [F('ui_click_1.mp3'), F('ui_click_2.mp3')], vol: 0.55, cat: 'ui', pitchVar: 0.06 },
  menu_hover: { files: [F('ui_hover_1.mp3'), F('ui_hover_2.mp3')], vol: 0.28, cat: 'ui', pitchVar: 0.1 },
  menu_toggle: { files: [F('ui_toggle.mp3')], vol: 0.5, cat: 'ui' },
  menu_confirm: { files: [F('ui_confirm.mp3')], vol: 0.55, cat: 'ui' },
  menu_error: { files: [F('ui_error_1.mp3'), F('ui_error_2.mp3')], vol: 0.55, cat: 'ui' },
  menu_open: { files: [F('ui_open.mp3')], vol: 0.45, cat: 'ui' },
  menu_close: { files: [F('ui_close.mp3')], vol: 0.45, cat: 'ui' },
  menu_pop: { files: [F('ui_pop_1.mp3'), F('ui_pop_2.mp3')], vol: 0.4, cat: 'ui', pitchVar: 0.12 },
  menu_select: { files: [F('ui_select.mp3')], vol: 0.5, cat: 'ui' },
  menu_join_jingle: { files: [F('join_jingle_1.mp3'), F('join_jingle_2.mp3')], vol: 0.55, cat: 'music', pitchVar: 0 },
  menu_start_jingle: { files: [F('start_jingle.mp3')], vol: 0.6, cat: 'music', pitchVar: 0 },
  menu_scream: { files: [F('scream_1.mp3'), F('scream_2.mp3'), F('scream_3.mp3'), F('scream_4.mp3'), F('scream_5.mp3')], vol: 0.85, cat: 'voice', pitchVar: 0.08 },
  menu_music_groove: { files: [F('music_menu_groove.mp3')], vol: 0.75, cat: 'music', loop: true, pitchVar: 0 },
  menu_music_magazine: { files: [F('music_magazine_funk.mp3')], vol: 0.6, cat: 'music', loop: true, pitchVar: 0 },
};

let installed = false;
export function installSounds() {
  if (installed) return;
  installed = true;
  for (const [k, v] of Object.entries(OWN)) if (!Sound.manifest[k]) (Sound.manifest as any)[k] = v;
}

/** first key that exists in the manifest */
const pick = (...keys: string[]) => keys.find((k) => Sound.has(k)) ?? keys[keys.length - 1];

let lastHover = 0;
export const sfx = {
  play(key: string, o: SoundOpts = {}) { installSounds(); return Sound.play(key, o); },
  click(key?: string) { this.play(key || pick('ui_click', 'menu_click')); },
  hover() { const t = performance.now(); if (t - lastHover < 60) return; lastHover = t; this.play(pick('ui_hover', 'menu_hover')); },
  pop() { this.play(pick('menu_pop'), { vol: 0.8 }); },
  type() { this.play(pick('menu_hover'), { vol: 0.6, pitch: 1.4 }); },
  error() { this.play(pick('ui_error', 'menu_error')); },
  confirm() { this.play(pick('ui_confirm', 'menu_confirm')); },
  open() { this.play('menu_open'); },
  close() { this.play('menu_close'); },
  whoosh() { this.play(pick('whoosh_swing', 'menu_open'), { vol: 0.7 }); },
  page() { this.play(pick('page_turn', 'paper_rustle'), { vol: 0.8 }); },
  paper() { this.play(pick('paper_rustle', 'page_turn'), { vol: 0.8 }); },
  wood() { this.play(pick('drop_wood'), { vol: 0.5, pitch: 1.6 }); },
  join() { this.play('menu_join_jingle'); },
  start() { this.play('menu_start_jingle'); },
  scream(pos?: any) { return this.play(pick('scream_female', 'girl_scream', 'menu_scream'), pos ? { pos, ref: 4, max: 60 } : {}); },
};

export function musicKey(which: 'menu' | 'magazine') {
  if (which === 'menu') return pick('main_menu', 'menu_music', 'menu_music_groove');
  return pick('customize', 'menu_music_magazine');
}
