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
];

export async function loadSigns(): Promise<SignSys | null> {
  const items: AtlasItem[] = [];
  const list: { id: string; cat: string[]; glow: number }[] = [];
  for (const [f, cat, glow] of DELIVERED) {
    const id = 'd:' + f;
    const big = cat.startsWith('poster') || cat.startsWith('menu') || cat.startsWith('street_dir') || cat.startsWith('moto');
    items.push({ id, url: `img/signs/${f}.png`, w: big ? 512 : 768, h: big ? 512 : 256 });
    list.push({ id, cat: cat.split(','), glow });
  }
  const gen = await Assets.jsonSafe<any>('gen/world/signs.json', null);
  for (const it of gen?.items ?? []) {
    const id = 'g:' + it.id;
    const big = (it.cat as string).startsWith('interior') || (it.cat as string).startsWith('facade');
    const w = it.w ?? (big ? 768 : 512), h = it.h ?? Math.round(w / (it.aspect ?? 3));
    items.push({ id, url: 'gen/world/' + it.file, w, h });
    list.push({ id, cat: String(it.cat).split(','), glow: it.glow ?? 0 });
  }
  // streets research agent's signs (if delivered)
  const man = await Assets.jsonSafe<any>('img/signs/manifest.json', null);
  if (man) {
    const arr = Array.isArray(man) ? man : man.items ?? Object.entries(man).map(([k, v]: any) => ({ id: k, ...v }));
    for (const it of arr) {
      const f = it.file ?? it.src ?? it.path;
      if (!f) continue;
      const id = 's:' + (it.id ?? f);
      const cat = it.cat ?? it.category ?? it.tags?.[0] ?? 'shop';
      items.push({ id, url: f.startsWith('img/') ? f : 'img/signs/' + f, w: it.w ?? 512, h: it.h ?? 192 });
      list.push({ id, cat: String(cat).split(','), glow: it.glow ?? (it.lightbox ? 1 : 0) });
    }
  }
  if (!items.length) return null;
  const atlas = await Atlas.build(items, 4096, 3, '#202020');
  return new SignSys(atlas, list);
}
