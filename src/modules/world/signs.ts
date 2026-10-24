import { Assets } from '../../core/assets';
import { RNG } from '../../core/rng';
import { Atlas, AtlasItem, AtlasRect } from './atlas';
import type { SignPick, SignSource } from './shophouse';

/**
 * REAL-PHOTO SIGNS — shop signs, light boxes, banners, posters, shop-interior photos and graffiti
 * cut from real photographs (see public/assets/gen/world/signs.json + credits). Also reads the
 * streets research agent's img/signs/manifest.json when it exists.
 *
 * gen/world/signs.json: { items: [{ id, file, cat: 'gold'|'food'|…|'vertical'|'interior:grocery'|'poster'|'graffiti', glow?: 0..1, w?, h? }] }
 */

export interface SignEntry { id: string; cat: string[]; glow: number; aspect: number }

export class SignSys implements SignSource {
  entries: SignEntry[] = [];
  constructor(public atlas: Atlas, list: { id: string; cat: string[]; glow: number }[]) {
    for (const e of list) {
      const r = atlas.get(e.id);
      if (r) this.entries.push({ ...e, aspect: r.aspect });
    }
  }
  private byCat(cat: string) { return this.entries.filter((e) => e.cat.includes(cat)); }

  pick(cat: string, aspect: number, rng: RNG): SignPick | null {
    const alias: Record<string, string[]> = {
      food: ['food', 'eatery', 'noodle'], eatery: ['food', 'eatery', 'noodle'], noodle: ['noodle', 'food'], coffee: ['coffee', 'food', 'shop'],
      gold: ['gold'], pharmacy: ['pharmacy', 'clinic'], clinic: ['clinic', 'pharmacy'], barber: ['barber', 'salon', 'shop'], salon: ['salon', 'barber', 'shop'],
      massage: ['massage', 'salon'], grocery: ['grocery', 'shop'], hardware: ['hardware', 'shop'], repair: ['repair', 'hardware', 'shop'],
      phone: ['phone', 'shop'], laundry: ['laundry', 'shop'], print: ['shop'], kitchen: ['kitchen', 'hardware', 'shop'], plastic: ['plastic', 'shop'],
      gas: ['gas', 'shop'], old: ['old', 'shop'], vertical: ['vertical'], open: ['shop'], shop: ['shop'],
    };
    const cats = alias[cat] ?? [cat, 'shop'];
    for (const c of cats) {
      let pool = this.byCat(c);
      if (c !== 'vertical') pool = pool.filter((e) => e.aspect > 1.2);
      if (!pool.length) continue;
      // prefer aspect ratios close to the slot (but never stretch more than ~35 %)
      pool.sort((a, b) => Math.abs(Math.log(a.aspect / aspect)) - Math.abs(Math.log(b.aspect / aspect)));
      const top = pool.slice(0, Math.max(3, Math.ceil(pool.length * 0.6)));
      const e = top[rng.int(0, top.length - 1)];
      const r = this.atlas.get(e.id)!;
      return { r: this.fit(r, aspect), glow: e.glow, id: e.id };
    }
    return null;
  }

  /** crop the atlas rect so the image fills the slot aspect without distortion */
  private fit(r: AtlasRect, aspect: number): AtlasRect {
    const ia = r.aspect;
    if (Math.abs(Math.log(ia / aspect)) < 0.3) return r;
    if (ia > aspect) { // image wider → crop sides
      const keep = aspect / ia, du = (r.u1 - r.u0) * (1 - keep) / 2;
      return { ...r, u0: r.u0 + du, u1: r.u1 - du, aspect };
    }
    const keep = ia / aspect, dv = (r.v1 - r.v0) * (1 - keep) / 2;
    return { ...r, v0: r.v0 + dv, v1: r.v1 - dv, aspect };
  }

  interior(cat: string, rng: RNG): AtlasRect | null {
    const pool = this.byCat('interior:' + cat).concat(cat === 'eatery' || cat === 'noodle' ? this.byCat('interior:food') : []);
    const p = pool.length ? pool : this.byCat('interior:shop');
    if (!p.length) return null;
    return this.atlas.get(p[rng.int(0, p.length - 1)].id) ?? null;
  }
  poster(rng: RNG): AtlasRect | null {
    const p = this.byCat('poster');
    return p.length ? this.atlas.get(p[rng.int(0, p.length - 1)].id) ?? null : null;
  }
  graffiti(rng: RNG): AtlasRect | null {
    const p = this.byCat('graffiti');
    return p.length ? this.atlas.get(p[rng.int(0, p.length - 1)].id) ?? null : null;
  }
  any(cat: string, rng: RNG): AtlasRect | null {
    const p = this.byCat(cat);
    return p.length ? this.atlas.get(p[rng.int(0, p.length - 1)].id) ?? null : null;
  }
}

/** delivered real-photo sign cut-outs in img/signs (streets research agent) → categories, glow */
const DELIVERED: [string, string, number][] = [
  ['shop_gold_jinhuaheng_neon_white', 'gold', 1], ['shop_gold_yulongkimkee_horizontal', 'gold', 0.6],
  ['shop_gold_vertical_green_white_cn', 'vertical,gold', 0.3], ['shop_gold_yulongkimkee_vertical_cn', 'vertical,gold', 0.3],
  ['shop_pharmacy_ruamphesatchakon', 'pharmacy,shop', 0], ['shop_pharmacy_world_lightbox', 'pharmacy,clinic', 1],
  ['shop_noodle_neon_logo', 'noodle', 1], ['shop_noodle_paord_night', 'noodle,food,shop', 1],
  ['shop_chicken_rice_hoksuang', 'food,shop', 0], ['shop_chicken_rice_midnight_korat_lightbox', 'food,noodle', 1],
  ['shop_coffee_boran_green_blue', 'coffee,food,shop', 0.4], ['shop_tamsang_pongpaeng_board', 'food,eatery,shop', 0],
  ['banner_tamsang_paksaep_vinyl', 'food,eatery,banner', 0], ['shop_barber_noi_lightbox', 'barber,salon', 1],
  ['shop_hardware_leevittaya', 'hardware,kitchen,repair,shop', 0], ['shop_massage_bosque_band', 'massage,salon', 0.5],
  ['shop_makro_facade_sign', 'wholesale', 1], ['shop_7eleven_fascia_band', 'convenience', 1],
  ['shop_7eleven_fascia_dusk', 'convenience2', 1], ['shop_7eleven_front_small', 'convenience3', 1],
  ['banner_laundry_open_vinyl', 'laundry,banner,shop', 0], ['sign_laundry_service_price', 'laundry_small', 0],
  ['sign_room_for_rent_lightbox', 'apartment,old,shop', 1], ['banner_private_land_no_dumping', 'lot', 0],
  ['flyer_loan_ngern_duan_bw', 'poster,flyer', 0], ['poster_lottery_results_sheet', 'poster', 0], ['poster_phone_shop_film', 'poster,phone', 0.3],
  ['menu_chicken_rice_photo_strip', 'menu', 0.3], ['menu_coffee_boran_handpainted', 'menu', 0],
  ['market_arch_700rai_sattahip', 'market', 0.6], ['sign_winmoto_price_list', 'moto', 0], ['sign_no_dog_poop_no_litter', 'wallsign', 0],
  ['street_sign_directional_rama1_green', 'street_dir', 0], ['street_sign_district_pathumwan_green', 'street_dir', 0],
  ['street_sign_maharaj3_ornate', 'street', 0], ['street_sign_soi_ekkachai46_blue', 'street,soi', 0], ['street_sign_soi_gate_masjid_banglaung', 'soigate', 0],
  ['street_sign_thaniya_blue', 'street', 0], ['street_sign_yaowarat_blue', 'street', 0],
  ['traffic_no_parking_round', 'traffic', 0], ['traffic_no_parking_timeplate', 'traffic_plate', 0],
  ['plate_car_private_kt1063_udonthani', 'plate', 0], ['plate_car_private_kt2058_chachoengsao', 'plate', 0], ['plate_car_private_red_sk234_nonthaburi', 'plate', 0],
  ['plate_pickup_green_2tr1387_bangkok', 'plate', 0], ['plate_pickup_green_bt4772_nakhonsawan', 'plate', 0],
  ['plate_moto_1kth2933_chumphon', 'plate_moto', 0], ['plate_moto_khns660_rayong', 'plate_moto', 0], ['plate_moto_phlkh772_bangkok', 'plate_moto', 0],
  ['plate_taxi_yellow_31-4304_bangkok', 'plate', 0], ['plate_public_yellow_70-2157_udonthani', 'plate', 0], ['plate_temporary_red_ph1301_bangkok', 'plate', 0],
  ['shop_clinic_ent_skin_vd', 'clinic,pharmacy,shop', 0.8], ['shop_dental_clinic_tooth', 'clinic,shop', 0.8],
  ['shop_massage_nuat_red', 'massage,salon,shop', 0.5], ['traffic_no_uturn_round', 'traffic,traffic_uturn', 0],
];
const KIND_CAT: [RegExp, string][] = [
  [/gold/, 'gold'], [/pharmacy/, 'pharmacy,shop'], [/clinic/, 'clinic,shop'], [/noodle/, 'noodle,food'], [/khao man gai|tam sang|food/, 'food,shop'],
  [/coffee/, 'coffee,food'], [/barber|salon/, 'barber,salon'], [/massage/, 'massage,salon'], [/hardware/, 'hardware,shop'], [/laundry/, 'laundry,shop'],
  [/licen[cs]e plate/, 'plate'], [/traffic/, 'traffic'], [/poster|flyer/, 'poster'], [/menu/, 'menu'], [/street|soi|district|direction/, 'street'],
  [/warning/, 'wallsign'], [/convenience/, 'convenience'], [/banner/, 'banner,shop'],
];

export async function loadSigns(atlasSize = 4096): Promise<SignSys | null> {
  const items: AtlasItem[] = [];
  const list: { id: string; cat: string[]; glow: number }[] = [];
  // streets research agent's manifest: { signs: [{ file, kind, px:[w,h], real_size_m, mount }] }
  const man = await Assets.jsonSafe<any>('img/signs/manifest.json', null);
  const marr: any[] = Array.isArray(man) ? man : man?.signs ?? man?.items ?? [];
  const px = new Map<string, [number, number]>();
  for (const it of marr) if (it?.file && Array.isArray(it.px)) px.set(String(it.file).replace(/\.png$/, ''), it.px);
  const fit = (f: string, mx: number, dw: number, dh: number) => {
    const p = px.get(f); if (!p) return [dw, dh];
    const a = p[0] / Math.max(1, p[1]);
    return a >= 1 ? [mx, Math.max(48, Math.round(mx / a))] : [Math.max(48, Math.round(mx * a)), mx];
  };
  const known = new Set<string>();
  for (const [f, cat, glow] of DELIVERED) {
    const id = 'd:' + f;
    const sq = /^(poster|menu|street_dir|moto|traffic|plate|wallsign|laundry_small|vertical)/.test(cat);
    const [w, h] = fit(f, cat.startsWith('plate') ? 256 : sq ? 360 : 640, sq ? 320 : 640, sq ? 320 : 200);
    items.push({ id, url: `img/signs/${f}.png`, w, h });
    list.push({ id, cat: cat.split(','), glow });
    known.add(f);
  }
  const gen = await Assets.jsonSafe<any>('gen/world/signs.json', null);
  for (const it of gen?.items ?? []) {
    const id = 'g:' + it.id;
    const big = /interior|facade|produce/.test(String(it.cat));
    const a = it.aspect ?? 3;
    const mx = big ? 440 : 640;
    const w = a >= 1 ? mx : Math.round(mx * a), h = a >= 1 ? Math.round(mx / a) : mx;
    items.push({ id, url: 'gen/world/' + it.file, w, h });
    list.push({ id, cat: String(it.cat).split(','), glow: it.glow ?? 0 });
  }
  // anything new in the manifest (player-shop hiaphat_*, blank carriers and emissive masks are not world dressing)
  for (const it of marr) {
    const f = String(it?.file ?? '').replace(/\.png$/, '');
    if (!f || known.has(f) || /^hiaphat_|^blank_|emissive/.test(f)) continue;
    const kind = String(it.kind ?? '');
    const cat = KIND_CAT.find(([re]) => re.test(kind))?.[1] ?? 'shop';
    const id = 's:' + f;
    const [w, h] = fit(f, 512, 512, 192);
    items.push({ id, url: 'img/signs/' + f + '.png', w, h });
    list.push({ id, cat: cat.split(','), glow: /lightbox|neon/.test(kind + f) ? 1 : 0 });
  }
  if (!items.length) return null;
  const atlas = await Atlas.build(items, atlasSize, 3, '#202020');
  return new SignSys(atlas, list);
}
