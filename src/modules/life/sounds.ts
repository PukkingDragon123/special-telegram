import * as THREE from 'three';
import { Sound, SoundHandle, SoundOpts } from '../../core/audio';
import { Assets } from '../../core/assets';
import type { Game } from '../../game/game';

/* ============================================================================================
 * life sounds. The shared manifest (public/assets/audio/manifest.json, curated by the audio
 * research agent) is preferred; our own files in public/assets/gen/life/audio/ (keys `life_*`,
 * manifest public/assets/gen/life/audio/manifest.json) are merged in at init and used as
 * fallbacks. Code uses LOGICAL names → first key that exists.
 * ========================================================================================== */

const ALIAS: Record<string, string[]> = {
  // dog / cat
  bark: ['dog_bark', 'life_dog_bark'],
  whine: ['dog_whine', 'life_dog_whine'],
  dog_eat: ['dog_eat', 'life_dog_eat', 'eat_chomp'],
  pant: ['dog_happy_pant', 'life_dog_pant'],
  growl: ['life_dog_growl', 'dog_growl'],
  howl: ['dog_howl_night', 'life_dog_howl'],
  meow: ['cat_meow', 'life_cat_meow'],
  purr: ['cat_purr_loop', 'life_cat_purr'],
  hiss: ['life_cat_hiss', 'cat_hiss', 'cat_meow'],
  // traffic
  moto_pass: ['motorbike_pass', 'life_moto_pass'],
  moto_idle: ['scooter_idle_loop', 'life_moto_idle'],
  moto_horn: ['life_moto_horn', 'motorbike_horn', 'car_horn_short'],
  amb_chatter: ['crowd_chatter_loop'],
  amb_night: ['street_ambience_night_loop', 'night_loop'],
  car_horn: ['car_horn_short', 'life_car_horn'],
  truck_horn: ['truck_horn', 'life_truck_horn', 'car_horn_short'],
  tuktuk: ['tuktuk_engine_loop', 'life_tuktuk_loop'],
  diesel: ['songthaew_engine_loop', 'life_diesel_loop'],
  bus_engine: ['life_bus_loop', 'songthaew_engine_loop'],
  car_engine: ['life_car_loop', 'songthaew_engine_loop'],
  airbrake: ['bus_airbrake', 'life_airbrake'],
  siren: ['siren_distant', 'life_siren'],
  icecream_bell: ['icecream_cart_bell', 'life_icecream_bell'],
  junk_speaker: ['junk_buyer_loudspeaker', 'life_junk_speaker'],
  // ambience beds
  amb_traffic: ['traffic_bangkok_loop', 'life_amb_traffic'],
  amb_market: ['market_crowd_loop', 'life_amb_market'],
  amb_day: ['street_ambience_day_loop', 'life_amb_day'],
  amb_cicadas: ['cicadas_loop', 'life_amb_cicadas'],
  amb_crickets: ['crickets_frogs_night_loop', 'life_amb_crickets'],
  amb_birds: ['birds_loop', 'life_amb_birds'],
  amb_canal: ['life_amb_canal', 'canal_water_loop', 'water_lapping_loop', 'crickets_frogs_night_loop'],
  amb_wind: ['wind_loop', 'life_amb_wind'],
  amb_tv: ['tv_muffled_loop', 'life_amb_tv'],
  amb_radio: ['radio_distant_loop', 'life_amb_radio'],
  amb_karaoke: ['life_amb_karaoke', 'karaoke_loop', 'radio_distant_loop'],
  gecko: ['tokay_gecko', 'life_gecko'],
  rooster: ['rooster', 'life_rooster'],
  temple_bell: ['temple_bell', 'life_temple_bell'],
  gong: ['gong', 'life_gong'],
  crow: ['crow', 'life_crow'],
  pigeons: ['pigeons'],
  // people
  laugh: ['crowd_laugh', 'laugh_track', 'life_laugh'],
  gasp: ['gasp', 'crowd_aww'],
  scream_f: ['female_scream_comedic', 'life_scream_f'],
  scream_m: ['female_scream_comedic', 'gasp'],
  coin: ['coin_clink'],
  coins: ['coins_handful'],
  // ghosts
  ghost_amb: ['eerie_drone_loop', 'night_loop', 'life_ghost_amb'],
  ghost_sting: ['ghost_scare_sting', 'dun_dun_dunn', 'life_ghost_sting'],
  ghost_whisper: ['whisper', 'life_ghost_whisper'],
  ghost_moto: ['motorcycle_ghost_engine_loop', 'life_ghost_moto'],
  ghost_wail: ['wind_howl', 'bells_eerie', 'life_ghost_wail'],
  ghost_laugh: ['ghost_laugh_female', 'life_ghost_laugh'],
  ghost_cry: ['whisper', 'life_ghost_cry'],
  krasue_buzz: ['heartbeat_slow', 'eerie_drone_loop'],
  whoosh: ['whoosh_swing'],
  flicker: ['life_light_flicker', 'fluorescent_buzz_loop'],
  pray: ['temple_bell', 'sparkle_chime'],
  merit: ['sparkle_chime', 'temple_bell'],
  heart: ['bubble_pop', 'pickup'],
  knock: ['drop_plastic', 'drop_metal'],
};

let ownLoaded = false;

/** Merge our own manifest into the shared one (keys never override shared entries). */
export async function loadLifeSounds() {
  if (ownLoaded) return;
  ownLoaded = true;
  const own = await Assets.jsonSafe<Record<string, any>>('gen/life/audio/manifest.json', {});
  for (const [k, v] of Object.entries(own)) {
    if (k.startsWith('_') || Sound.manifest[k]) continue;
    const files = (v.files ?? (v.file ? [v.file] : [])).map((f: string) => (f.startsWith('../') ? f : '../gen/life/audio/' + f));
    Sound.manifest[k] = { ...v, files };
  }
}

const resolved = new Map<string, string>();
/** Logical name → manifest key ('' when nothing exists). */
export function sk(name: string): string {
  const hit = resolved.get(name);
  if (hit !== undefined) return hit;
  const cands = ALIAS[name] ?? [name];
  const k = cands.find((c) => Sound.has(c)) ?? '';
  if (Sound.manifest && Object.keys(Sound.manifest).length) resolved.set(name, k);
  return k;
}
export const hasSound = (name: string) => !!sk(name);

/** Local positional one-shot (logical name). */
export function play(name: string, o: SoundOpts = {}): SoundHandle | null {
  const k = sk(name);
  if (!k) return null;
  return Sound.play(k, { loop: false, ...o });
}
/** Local loop (logical name). */
export function loop(name: string, o: SoundOpts = {}): SoundHandle | null {
  const k = sk(name);
  if (!k) return null;
  return Sound.loop(k, o);
}
/** Networked one-shot (host → everyone). */
export function sfx(game: Game, name: string, pos: ArrayLike<number> | THREE.Vector3 | null, o: Omit<SoundOpts, 'pos'> = {}) {
  const k = sk(name);
  if (!k) return;
  game.sfx(k, pos, { loop: false, ...o });
}
