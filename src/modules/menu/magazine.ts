import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { CatalogItem, Look } from '../../game/contracts';
import { asset } from '../../core/util';
import { F } from '../../core/fonts';
import { loadImg, mulberry } from './lettering';
import { sfx } from './sfx';

/* ============================================================================================
 * "ซอยสไตล์" – a realistic Thai street-fashion magazine as a 3D object in front of the camera.
 * Glossy paper (low-roughness PBR), canvas pages composed from REAL photos (Flickr CC0/CC-BY,
 * see references/credits/menu.md) + live render-to-texture product shots of every catalogue item on
 * a model from game.chars. Sticky-note tabs jump to sections, pages curl when flipped.
 * ========================================================================================== */

export type Section = 'cover' | 'tops' | 'bottoms' | 'shoes' | 'acc' | 'hair' | 'faces' | 'skins';
export interface MagItem { id: string; name: { th: string; en?: string }; price?: number; colors?: string[]; kind: Section; color?: string; sex?: string }
interface Cell { x: number; y: number; w: number; h: number; item: MagItem }
interface Page { sec: Section; idx: number; total: number; items: MagItem[]; cells: Cell[]; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; drawn: boolean; thumbs: Map<string, HTMLCanvasElement>; queued: boolean }

const PW = 0.205, PH = 0.275;
const CW = 1024, CH = Math.round(CW * PH / PW); // 1373
const IMG = (n: string) => asset('gen/menu/mag/' + n);

export const SECTIONS: { sec: Section; th: string; en: string; photo: string; caption: string; color: string }[] = [
  { sec: 'tops', th: 'เสื้อ', en: 'TOPS', photo: 'tops_tshirts.jpg', caption: 'เสื้อยืดสกรีนลายเต็มแผง ถนนข้าวสาร – ใส่แล้วเท่ ไม่เท่ไม่ว่ากัน', color: '#ffe36b' },
  { sec: 'bottoms', th: 'กางเกง', en: 'BOTTOMS', photo: 'bottoms_mannequins.jpg', caption: 'หุ่นโชว์ร้านเสื้อผ้าริมทาง: ใครเป็นหุ่น ใครเป็นแม่ค้า หาให้เจอ!', color: '#ff9fb7' },
  { sec: 'shoes', th: 'รองเท้า', en: 'SHOES', photo: 'shoes_sandals.jpg', caption: 'รองเท้าแตะประดับเพชร(ปลอม) ใส่ไปตลาดก็ปัง ใส่ไปวัดก็ได้', color: '#9fe39a' },
  { sec: 'acc', th: 'เครื่องประดับ', en: 'ACCESSORIES', photo: 'acc_hats.jpg', caption: 'งอบสีสด ๆ จากตลาดน้ำ กันแดดได้ กันเมียบ่นไม่ได้', color: '#9fd3ff' },
  { sec: 'hair', th: 'ทรงผม·หน้าตา', en: 'HAIR & FACE', photo: 'hair_barber.jpg', caption: 'ร้านตัดผมห้องแถว ตัด 80 บาท แถมคุยการเมืองฟรี (ห้ามตอบ)', color: '#ffb46b' },
  { sec: 'skins', th: 'สีผิว', en: 'SKIN TONE', photo: 'skin_lotions.jpg', caption: 'โลชั่นผิวแทน vs. โลชั่นผิวขาว ศึกตัดสินบนชั้นร้านสะดวกซื้อ', color: '#d7b3ff' },
];

// ------------------------------------------------------------------ fallback catalogue (stub characters)

function fallbackCatalogue() {
  const c = (id: string, th: string, en: string, price: number, colors?: string[]) => ({ id, name: { th, en }, price, colors } as CatalogItem);
  return {
    tops: [c('singlet_white', 'เสื้อกล้ามสีขาว', 'white singlet', 59, ['#f1eee6', '#1d1d1f']), c('tshirt', 'เสื้อยืด', 't-shirt', 99, ['#c8423a', '#2f5fa8', '#e8a33d', '#4f7d3c']), c('hawaiian_green', 'เสื้อฮาวายสีเขียว', 'green hawaiian shirt', 350, ['#7fbf5a']), c('polo_stripe_green', 'เสื้อโปโลลายขวาง', 'striped polo', 250, ['#4f9a62']), c('shirt_white', 'เสื้อเชิ้ตขาว', 'white shirt', 390, ['#f3f1ec']), c('shirt_stripe_white', 'เสื้อแขนยาวลายขวาง', 'striped long-sleeve', 290, ['#ece9e2'])],
    bottoms: [c('boxer_plaid', 'กางเกงบ็อกเซอร์ลายสก็อต', 'plaid boxers', 79, ['#3a5aa0', '#a03a3a']), c('cloth_shorts', 'กางเกงขาสั้นผ้า', 'cloth shorts', 150, ['#a8956e', '#3d4752']), c('jeans', 'กางเกงยีนส์', 'jeans', 490, ['#2c3a58', '#1d2230']), c('slacks', 'กางเกงสแล็ค', 'slacks', 390, ['#26272c'])],
    shoes: [c('flipflops', 'รองเท้าแตะฟองน้ำ', 'flip-flops', 49, ['#2f63b8', '#c8423a']), c('sneakers', 'รองเท้าผ้าใบ', 'sneakers', 890, ['#f2f1ee', '#1d1d1f']), c('sandals', 'รองเท้ารัดส้น', 'sandals', 250, ['#5a3a22']), c('barefoot', 'เท้าเปล่า', 'barefoot', 0)],
    acc: [c('sunglasses', 'แว่นกันแดด', 'sunglasses', 199), c('headband_white', 'ผ้าคาดหัวสีขาว', 'white headband', 39), c('cap_red', 'หมวกแก๊ปแดง', 'red cap', 150), c('gold_chain', 'สร้อยทอง (ปลอม)', 'fake gold chain', 99), c('watch_casio', 'นาฬิกาดิจิตอล', 'digital watch', 299), c('towel_neck', 'ผ้าขนหนูพาดคอ', 'neck towel', 59)],
    hair: [c('short', 'ทรงสั้น', 'short', 100), c('afro', 'ทรงแอฟโฟร', 'afro', 350), c('side_part', 'ทรงแสกข้าง', 'side part', 150), c('spiky', 'ทรงตั้งชี้ฟู', 'spiky', 160), c('shaggy', 'ผมยาวประบ่า', 'shaggy', 220), c('buzz', 'ทรงเกรียน', 'buzz cut', 50)],
    faces: [c('m01', 'หน้า 1', 'face 1', 0), c('m02', 'หน้า 2', 'face 2', 0), c('m03', 'หน้า 3', 'face 3', 0), c('m04', 'หน้า 4', 'face 4', 0)],
    skins: ['#ecc9a8', '#e2b893', '#d8aa84', '#cd9c76', '#c28e69', '#b6815d', '#a67250', '#956345', '#82553a'],
  };
}

const SKIN_NAMES = ['ขาวอมชมพู', 'ขาวเหลือง', 'ขาวสองสี', 'สองสีอมทอง', 'แทนน้ำผึ้ง', 'แทนสุขภาพดี', 'คล้ำแดด', 'คล้ำเข้ม', 'ดำแดงกรำงาน'];
const SKIN_EN = ['porcelain', 'ivory', 'two-tone', 'golden', 'honey tan', 'healthy tan', 'sun-kissed', 'deep tan', 'field-worker bronze'];

// ------------------------------------------------------------------ thumbnails (render-to-texture)

type Framing = 'torso' | 'legs' | 'feet' | 'head' | 'bust' | 'full';

export class Thumbnailer {
  private rt: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(28, 220 / 300, 0.05, 20);
  private queue: { look: Look; framing: Framing; cb: (c: HTMLCanvasElement) => void; tag?: number }[] = [];
  private buf: Float32Array;
  readonly W = 220; readonly H = 300;
  constructor(private game: Game) {
    this.rt = new THREE.WebGLRenderTarget(this.W, this.H, { type: THREE.FloatType, depthBuffer: true });
    this.buf = new Float32Array(this.W * this.H * 4);
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(-1.5, 2.5, 3);
    const rim = new THREE.DirectionalLight(0xfff0d0, 1.6);
    rim.position.set(2, 2, -2);
    this.scene.add(key, rim, new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 1.4));
    // a hidden "keeper" model: holds a reference to the rig shader programs of this scene so that
    // disposing each product-shot model doesn't release (and later recompile) the same programs
    try {
      this.keeper = game.chars.create(game.chars.playerLook(0), { lod: 'low', castShadow: false });
      this.keeper.root.position.set(0, 0, 12); // behind the product camera: drawn (programs acquired) but clipped
      this.keeper.root.traverse((o: any) => { o.frustumCulled = false; });
      this.scene.add(this.keeper.root);
    } catch { this.keeper = null; }
  }
  private keeper: any = null;
  request(look: Look, framing: Framing, cb: (c: HTMLCanvasElement) => void, tag?: number) { this.queue.push({ look, framing, cb, tag }); }
  /** move the jobs of one page to the front of the queue */
  front(tag: number) { const a = this.queue.filter((j) => j.tag === tag), b = this.queue.filter((j) => j.tag !== tag); this.queue = [...a, ...b]; }
  get pending() { return this.queue.length; }
  clear() { this.queue.length = 0; }

  private cool = 30;
  private cur: { job: { look: Look; framing: Framing; cb: (c: HTMLCanvasElement) => void }; rig: any; frames: number; ready: number } | null = null;

  /** true when every mesh's atlas texture of the rig has been painted (characters paint them async) */
  private painted(rig: any) {
    let ok = true;
    rig.root.traverse((o: any) => {
      if (!o.isMesh || !o.visible) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) { const im = m?.map?.image; if (im && (im.width ?? 0) <= 8) ok = false; }
    });
    return ok;
  }

  /** advance the thumbnail pipeline (call once per frame): create rig → wait for its atlas → render */
  step() {
    if (!this.cur) {
      if (--this.cool > 0) return;
      const job = this.queue.shift();
      if (!job) return;
      this.cool = 8; // spread rig builds over frames (each build costs a few ms on 'low' LOD)
      try {
        const rig: any = this.game.chars.create(job.look, { lod: 'low', castShadow: false });
        rig.play('idle', { loop: true, fade: 0 });
        rig.setMove(0);
        rig.root.rotation.y = Math.PI + 0.42; // 3/4 view toward the camera
        this.scene.add(rig.root);
        this.cur = { job, rig, frames: 0, ready: -1 };
      } catch (e) { console.warn('[menu] thumbnail rig failed', e); }
      return;
    }
    const c = this.cur;
    c.frames++;
    c.rig.update(0.1);
    if (c.ready < 0) {
      if (this.painted(c.rig) || c.frames > 240) c.ready = c.frames;
      return;
    }
    if (c.frames - c.ready < 6) return; // let the face photo land
    const r = this.game.engine.renderer;
    try {
      c.rig.root.updateMatrixWorld(true);
      const h = c.rig.height || c.job.look.height || 1.72;
      const f = c.job.framing;
      const [cy, dist, ty] = f === 'torso' ? [h * 0.74, 1.35, h * 0.72] : f === 'legs' ? [h * 0.32, 1.85, h * 0.3] : f === 'feet' ? [0.22, 0.8, 0.07] : f === 'head' ? [h * 0.93, 0.62, h * 0.92] : f === 'bust' ? [h * 0.86, 0.95, h * 0.84] : [h * 0.55, 3.6, h * 0.5];
      this.cam.position.set(0.05, cy, dist);
      this.cam.lookAt(0, ty, 0);
      this.cam.updateMatrixWorld(true);
      const prevRT = r.getRenderTarget();
      const prevClear = r.getClearColor(new THREE.Color());
      const prevAlpha = r.getClearAlpha();
      r.setRenderTarget(this.rt);
      r.setClearColor(0x000000, 0);
      r.clear(true, true, true);
      r.render(this.scene, this.cam);
      let ok = true;
      try { r.readRenderTargetPixels(this.rt, 0, 0, this.W, this.H, this.buf); } catch { ok = false; }
      r.setRenderTarget(prevRT);
      r.setClearColor(prevClear, prevAlpha);
      if (ok) c.job.cb(this.toCanvas());
    } catch (e) {
      console.warn('[menu] thumbnail failed', e);
    } finally {
      this.scene.remove(c.rig.root);
      c.rig.dispose();
      this.cur = null;
    }
  }

  private toCanvas() {
    const cv = document.createElement('canvas');
    cv.width = this.W; cv.height = this.H;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(this.W, this.H);
    const d = img.data, b = this.buf, W = this.W, H = this.H;
    const tm = (x: number) => {
      x *= 0.85;
      const v = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
      const c = Math.min(1, Math.max(0, v));
      return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const si = ((H - 1 - y) * W + x) * 4, di = (y * W + x) * 4;
      const a = Math.min(1, Math.max(0, b[si + 3]));
      d[di] = tm(b[si] / Math.max(a, 1e-4)) * 255;
      d[di + 1] = tm(b[si + 1] / Math.max(a, 1e-4)) * 255;
      d[di + 2] = tm(b[si + 2] / Math.max(a, 1e-4)) * 255;
      d[di + 3] = a * 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  dispose() { if (this.cur) { this.scene.remove(this.cur.rig.root); this.cur.rig.dispose(); this.cur = null; } this.keeper?.dispose(); this.rt.dispose(); this.queue.length = 0; }
}

// ------------------------------------------------------------------ the magazine

export class Magazine {
  readonly group = new THREE.Group();
  private pages: Page[] = [];
  private cur = 0;
  private frontMat: THREE.MeshStandardMaterial;
  private turnFront: THREE.Mesh;
  private turnBack: THREE.Mesh;
  private front: THREE.Mesh;
  private turnGeo: THREE.PlaneGeometry;
  private backTex!: THREE.Texture;
  private turn = { active: false, t: 0, dir: 1, from: 0, to: 0 };
  private tabs: { mesh: THREE.Mesh; sec: Section; out: number; tgt: number }[] = [];
  private marker: THREE.Mesh;
  private hover: { kind: 'item' | 'tab' | 'next' | 'prev'; cell?: Cell; tab?: number } | null = null;
  private thumbs: Thumbnailer;
  private photos = new Map<string, HTMLImageElement | null>();
  private paper: HTMLImageElement | null = null;
  private barcode: HTMLImageElement | null = null;
  private ray = new THREE.Raycaster();
  private t = 0;
  private base: Look;
  private hoverMesh: THREE.Object3D | null = null;

  constructor(private game: Game, look: Look, private getLook: () => Look, private onPick: (item: MagItem, color?: string) => void) {
    this.base = JSON.parse(JSON.stringify(look));
    this.thumbs = new Thumbnailer(game);
    // ---- build page list
    let cat = game.chars.catalogue();
    if (!cat.tops?.length) cat = fallbackCatalogue();
    const lists: Record<Section, MagItem[]> = {
      cover: [],
      tops: cat.tops.map((x) => ({ ...x, kind: 'tops' as Section })),
      bottoms: cat.bottoms.map((x) => ({ ...x, kind: 'bottoms' as Section })),
      shoes: cat.shoes.map((x) => ({ ...x, kind: 'shoes' as Section })),
      acc: [{ id: '__none', name: { th: 'ถอดออกหมด', en: 'remove all' }, price: 0, kind: 'acc' as Section }, ...cat.acc.map((x) => ({ ...x, kind: 'acc' as Section }))],
      hair: cat.hair.map((x) => ({ ...x, kind: 'hair' as Section })),
      faces: (cat.faces ?? []).slice(0, 24).map((x) => ({ ...x, kind: 'faces' as Section })),
      skins: (cat.skins ?? []).map((s, i) => ({ id: s, name: { th: SKIN_NAMES[i % SKIN_NAMES.length], en: SKIN_EN[i % SKIN_EN.length] }, price: [890, 590, 350, 199, 99, 59, 39, 20, 0][i % 9], kind: 'skins' as Section, color: s })),
    };
    this.addPage('cover', []);
    for (const S of SECTIONS) {
      const secs: Section[] = S.sec === 'hair' ? ['hair', 'faces'] : [S.sec];
      for (const sec of secs) {
        const items = lists[sec];
        const per = 6;
        const n = Math.max(1, Math.ceil(items.length / per));
        for (let i = 0; i < n; i++) this.addPage(sec, items.slice(i * per, i * per + per), i, n);
      }
    }
    // ---- meshes
    this.frontMat = this.pageMaterial(this.pages[0].tex);
    const fg = new THREE.PlaneGeometry(PW, PH, 1, 1);
    fg.translate(PW / 2, 0, 0);
    this.front = new THREE.Mesh(fg, this.frontMat);
    this.front.name = 'mag_front';
    this.group.add(this.front);
    // page block (the rest of the magazine folded back) – paper edges
    const block = new THREE.Mesh(new THREE.BoxGeometry(PW, PH, 0.006), new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.6, map: (() => { const t = new THREE.CanvasTexture(edgeCanvas()); t.colorSpace = THREE.SRGBColorSpace; return t; })() }));
    block.position.set(PW / 2 + 0.0015, -0.002, -0.0035);
    this.group.add(block);
    const adTex: THREE.CanvasTexture = new THREE.CanvasTexture(adCanvas(() => { adTex.needsUpdate = true; this.backTex.needsUpdate = true; }));
    adTex.colorSpace = THREE.SRGBColorSpace;
    this.backTex = adTex.clone();
    this.backTex.wrapS = THREE.RepeatWrapping;
    this.backTex.repeat.x = -1;
    this.backTex.offset.x = 1;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, map: adTex }));
    back.rotation.y = Math.PI;
    back.position.set(PW / 2 + 0.0015, -0.002, -0.0068);
    this.group.add(back);
    this.turnGeo = new THREE.PlaneGeometry(PW, PH, 28, 1);
    this.turnGeo.translate(PW / 2, 0, 0);
    this.turnFront = new THREE.Mesh(this.turnGeo, this.pageMaterial(this.pages[0].tex));
    (this.turnFront.material as THREE.MeshStandardMaterial).transparent = true;
    this.turnBack = new THREE.Mesh(this.turnGeo, new THREE.MeshStandardMaterial({ side: THREE.BackSide, roughness: 0.35, map: this.backTex, transparent: true }));
    this.turnFront.visible = this.turnBack.visible = false;
    this.turnFront.position.z = this.turnBack.position.z = 0.0008;
    this.group.add(this.turnFront, this.turnBack);
    // ---- sticky-note tabs (right edge)
    SECTIONS.forEach((S, i) => {
      const cv = tabCanvas(S.th, S.color, i);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.03), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide, transparent: true, alphaTest: 0.5 }));
      m.position.set(PW + 0.012, PH / 2 - 0.035 - i * 0.037, -0.0012);
      m.rotation.z = (i % 2 ? 1 : -1) * 0.025;
      m.userData.tab = i;
      this.group.add(m);
      this.tabs.push({ mesh: m, sec: S.sec, out: 0, tgt: 0 });
    });
    // ---- hover marker (red ballpoint circle)
    const mt = new THREE.CanvasTexture(markerCanvas());
    mt.colorSpace = THREE.SRGBColorSpace;
    this.marker = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: mt, transparent: true, depthWrite: false, toneMapped: false }));
    this.marker.visible = false;
    this.marker.position.z = 0.0015;
    this.group.add(this.marker);
    // ---- assets
    for (const S of SECTIONS) loadImg(IMG(S.photo)).then((im) => { this.photos.set(S.photo, im); this.redrawSec(S.sec); });
    loadImg(IMG('cover.jpg')).then((im) => { this.photos.set('cover.jpg', im); this.redraw(0); });
    loadImg(IMG('sale_sign.jpg')).then((im) => { this.photos.set('sale_sign.jpg', im); });
    loadImg(asset('gen/menu/paper_backdrop.jpg')).then((im) => { this.paper = im; for (const p of this.pages) if (p.drawn) this.draw(p); });
    loadImg(asset('img/newspaper/parts/barcode.png')).then((im) => { this.barcode = im; this.redraw(0); });
    this.draw(this.pages[0]);
    this.ensure(1);
  }

  private pageMaterial(tex: THREE.Texture) {
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3, metalness: 0, envMapIntensity: 1.2, side: THREE.FrontSide });
  }

  private addPage(sec: Section, items: MagItem[], idx = 0, total = 1) {
    const canvas = document.createElement('canvas');
    canvas.width = CW; canvas.height = CH;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.pages.push({ sec, idx, total, items, cells: [], canvas, tex, drawn: false, thumbs: new Map(), queued: false });
  }

  get pageCount() { return this.pages.length; }
  get section(): Section { return this.pages[this.cur].sec; }

  // ------------------------------------------------------------------ drawing

  private redraw(i: number) { const p = this.pages[i]; if (p?.drawn) this.draw(p); }
  private redrawSec(sec: Section) { for (const p of this.pages) if ((p.sec === sec || (sec === 'hair' && p.sec === 'faces')) && p.drawn) this.draw(p); }
  refreshWorn() { this.draw(this.pages[this.cur]); }

  /** make sure page i is drawn and its thumbnails are queued */
  private ensure(i: number) {
    const p = this.pages[i];
    if (!p) return;
    if (!p.drawn) this.draw(p);
    if (p.queued) return;
    p.queued = true;
    for (const it of p.items) {
      if (it.id === '__none' || p.sec === 'skins' && false) { /* still draw */ }
      const look = this.lookWith(it);
      if (!look) continue;
      const fr: Framing = p.sec === 'tops' ? 'torso' : p.sec === 'bottoms' ? 'legs' : p.sec === 'shoes' ? 'feet' : p.sec === 'acc' ? (/watch/.test(it.id) ? 'torso' : /apron|backpack|sash/.test(it.id) ? 'full' : /chain|towel|lanyard/.test(it.id) ? 'bust' : 'head') : p.sec === 'skins' ? 'bust' : 'head';
      this.thumbs.request(look, fr, (cv) => { p.thumbs.set(it.id, cv); this.drawCellThumb(p, it.id); }, this.pages.indexOf(p));
    }
  }

  private lookWith(it: MagItem): Look | null {
    const L: Look = JSON.parse(JSON.stringify(this.base));
    const col = it.colors?.[0];
    switch (it.kind) {
      case 'tops': L.top = { id: it.id, color: col ?? L.top.color }; break;
      case 'bottoms': L.bottom = { id: it.id, color: col ?? L.bottom.color }; break;
      case 'shoes': L.shoes = { id: it.id, color: col ?? L.shoes.color }; break;
      case 'acc': L.acc = it.id === '__none' ? [] : [it.id]; break;
      case 'hair': L.hair = { style: it.id, color: L.hair.color }; break;
      case 'faces': L.face = it.id; if (it.sex === 'f' || it.sex === 'm') L.sex = it.sex as any; break;
      case 'skins': L.skin = it.color ?? it.id; break;
      default: return null;
    }
    return L;
  }

  private isWorn(it: MagItem) {
    const L = this.getLook();
    switch (it.kind) {
      case 'tops': return L.top.id === it.id;
      case 'bottoms': return L.bottom.id === it.id;
      case 'shoes': return L.shoes.id === it.id;
      case 'acc': return it.id === '__none' ? !L.acc.length : L.acc.includes(it.id);
      case 'hair': return L.hair.style === it.id;
      case 'faces': return L.face === it.id;
      case 'skins': return L.skin.toLowerCase() === (it.color ?? it.id).toLowerCase();
    }
    return false;
  }

  private draw(p: Page) {
    p.drawn = true;
    const ctx = p.canvas.getContext('2d')!;
    ctx.save();
    ctx.fillStyle = '#fbfaf6';
    ctx.fillRect(0, 0, CW, CH);
    if (this.paper) { ctx.globalAlpha = 0.18; ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(this.paper, 0, 0, CW, CH); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    if (p.sec === 'cover') this.drawCover(ctx);
    else this.drawSection(ctx, p);
    // gloss sheen + gutter shadow near the spine
    const g = ctx.createLinearGradient(0, 0, 70, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.28)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 70, CH);
    ctx.restore();
    p.tex.needsUpdate = true;
  }

  private drawCover(ctx: CanvasRenderingContext2D) {
    const im = this.photos.get('cover.jpg');
    if (im) coverFit(ctx, im, 0, 0, CW, CH);
    else { ctx.fillStyle = '#c84a3a'; ctx.fillRect(0, 0, CW, CH); }
    // darken top/bottom for legibility (real covers do this)
    let g = ctx.createLinearGradient(0, 0, 0, 420);
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, CW, 420);
    g = ctx.createLinearGradient(0, CH - 520, 0, CH);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = g; ctx.fillRect(0, CH - 520, CW, 520);
    // masthead
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e8262b';
    ctx.font = `900 250px ${F.news}`;
    ctx.save();
    ctx.translate(46, 250);
    ctx.scale(0.86, 1);
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
    ctx.fillText('ซอย', 0, 0);
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.font = `italic 700 132px ${F.fancy}`;
    ctx.fillText('สไตล์', 560, 236);
    ctx.font = `800 30px ${F.looped}`;
    ctx.fillStyle = '#ffe36b';
    ctx.fillText('SOI STYLE · นิตยสารแฟชั่นริมทางอันดับ 1 ของซอย', 52, 300);
    // cover lines
    const line = (t: string, x: number, y: number, size: number, col: string, rot = 0, bg?: string) => {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rot);
      ctx.font = `900 ${size}px ${F.looped}`;
      const w = ctx.measureText(t).width;
      if (bg) { ctx.fillStyle = bg; ctx.fillRect(-14, -size * 0.95, w + 28, size * 1.25); }
      ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.16; ctx.strokeStyle = 'rgba(20,10,5,0.85)';
      if (!bg) ctx.strokeText(t, 0, 0);
      ctx.fillStyle = col; ctx.fillText(t, 0, 0);
      ctx.restore();
    };
    line('เสื้อกล้าม + บ็อกเซอร์', 52, 470, 62, '#ffffff');
    line('แฟชั่นที่สาวกรี๊ด!!', 52, 540, 62, '#ffe36b');
    line('แต่งตัวงบร้อยเดียว ดูแพงหมื่น', 52, CH - 330, 48, '#ffffff');
    line('ทรงผมฮิตปากซอย 2569', 52, CH - 262, 48, '#9fe39a');
    line('พิเศษ! วิธียืนกางแขนกลางถนนให้ดูเท่', 52, CH - 194, 40, '#ffffff', 0, '#e8262b');
    // price burst
    ctx.save();
    ctx.translate(CW - 170, 600);
    ctx.rotate(0.18);
    burst(ctx, 0, 0, 120, 96, '#ffe36b', 18);
    ctx.fillStyle = '#c8211c';
    ctx.textAlign = 'center';
    ctx.font = `900 34px ${F.looped}`; ctx.fillText('ราคาพิเศษ', 0, -26);
    ctx.font = `900 74px ${F.heavy}`; ctx.fillText('20.-', 0, 46);
    ctx.restore();
    // barcode + issue
    if (this.barcode) { ctx.fillStyle = '#fff'; ctx.fillRect(CW - 250, CH - 150, 210, 118); ctx.drawImage(this.barcode, CW - 240, CH - 142, 190, 100); }
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 26px ${F.body}`;
    ctx.fillText('ปีที่ 9 ฉบับที่ 100 · ตุลาคม 2569', 52, CH - 60);
    ctx.font = `700 26px ${F.looped}`;
    ctx.fillStyle = '#ffe36b';
    ctx.fillText('แปะโพสต์อิทด้านขวา เลือกหมวดได้เลย →', 52, CH - 110);
  }

  private drawSection(ctx: CanvasRenderingContext2D, p: Page) {
    const S = SECTIONS.find((s) => s.sec === p.sec || (p.sec === 'faces' && s.sec === 'hair'))!;
    // header line
    ctx.fillStyle = '#e8262b';
    ctx.fillRect(56, 44, CW - 112, 8);
    ctx.font = `900 34px ${F.news}`;
    ctx.fillText('ซอยสไตล์', 56, 100);
    ctx.fillStyle = '#6b655c';
    ctx.font = `600 22px ${F.body}`;
    ctx.textAlign = 'right';
    ctx.fillText(`หน้า ${this.pages.indexOf(p) * 2 + 10}  ·  SOI STYLE #100`, CW - 56, 98);
    ctx.textAlign = 'left';
    // section title
    const title = p.sec === 'faces' ? 'หน้าตา' : p.sec === 'hair' ? 'ทรงผม' : S.th;
    const en = p.sec === 'faces' ? 'FACES' : p.sec === 'hair' ? 'HAIR' : S.en;
    ctx.fillStyle = '#1f1c1c';
    ctx.font = `900 118px ${F.news}`;
    ctx.save(); ctx.translate(52, 238); ctx.scale(0.92, 1); ctx.fillText(title, 0, 0); ctx.restore();
    const tw = ctx.measureText(title).width * 0.92;
    ctx.fillStyle = '#e8262b';
    ctx.font = `800 30px ${F.looped}`;
    ctx.fillText(en + (p.total > 1 ? `  ${p.idx + 1}/${p.total}` : ''), 70 + tw, 230);
    // photo banner (real photo)
    const ph = this.photos.get(S.photo);
    const by = 268, bh = p.idx === 0 ? 300 : 150;
    if (ph) coverFit(ctx, ph, 56, by, CW - 112, bh, p.idx * 0.3);
    else { ctx.fillStyle = '#ddd5c5'; ctx.fillRect(56, by, CW - 112, bh); }
    ctx.fillStyle = S.color;
    ctx.fillRect(56, by + bh, CW - 112, 44);
    ctx.fillStyle = '#1f1c1c';
    ctx.font = `600 23px ${F.body}`;
    ctx.fillText('■ ' + (p.idx === 0 ? S.caption : 'เลือกได้ตามใจ คลิกที่รูปเพื่อลองใส่ทันที – ไม่ต้องจ่ายตังค์ (ช่วงโปรเปิดร้าน)'), 70, by + bh + 31);
    // grid
    const gy = by + bh + 64, cols = 2, rows = 3;
    const gw = (CW - 112 - 24) / cols, gh = (CH - gy - 96 - 24 * (rows - 1)) / rows;
    p.cells = [];
    p.items.forEach((it, i) => {
      const cx = 56 + (i % cols) * (gw + 24), cy = gy + Math.floor(i / cols) * (gh + 24);
      const cell = { x: cx, y: cy, w: gw, h: gh, item: it };
      p.cells.push(cell);
      this.drawCell(ctx, p, cell);
    });
    // footer + page-turn corner hints
    ctx.fillStyle = '#8a8378';
    ctx.font = `500 20px ${F.body}`;
    ctx.fillText('* ราคาอาจเปลี่ยนตามอารมณ์แม่ค้า  ·  ภาพประกอบจากตลาดจริง', 56, CH - 40);
    ctx.fillStyle = '#e8262b';
    ctx.font = `800 26px ${F.looped}`;
    ctx.textAlign = 'right';
    ctx.fillText('พลิกหน้า ▶', CW - 56, CH - 40);
    ctx.textAlign = 'left';
  }

  private drawCell(ctx: CanvasRenderingContext2D, p: Page, c: Cell) {
    const it = c.item;
    const worn = this.isWorn(it);
    const rnd = mulberry(hashStr(it.id));
    ctx.save();
    // soft studio card
    ctx.fillStyle = worn ? '#fff4c7' : '#f1ede4';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    const tW = Math.min(c.h * 0.74, c.w * 0.46), tH = c.h - 8;
    const tx = c.x + 4, ty = c.y + 4;
    // thumbnail (live render) or skin swatch
    if (p.sec === 'skins') {
      ctx.fillStyle = it.color ?? it.id;
      ctx.beginPath(); ctx.ellipse(tx + tW / 2, ty + tH * 0.45, tW * 0.36, tW * 0.36, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 3; ctx.stroke();
    }
    const th = p.thumbs.get(it.id);
    if (th) {
      ctx.shadowColor = 'rgba(40,30,20,0.35)'; ctx.shadowBlur = 16; ctx.shadowOffsetX = 6; ctx.shadowOffsetY = 8;
      const k = Math.min(tW / th.width, tH / th.height);
      ctx.drawImage(th, tx + (tW - th.width * k) / 2, ty + (tH - th.height * k), th.width * k, th.height * k);
      ctx.shadowColor = 'transparent';
    } else if (p.sec !== 'skins') {
      ctx.fillStyle = '#ddd6c8';
      ctx.fillRect(tx + 10, ty + 10, tW - 20, tH - 20);
      ctx.fillStyle = '#a49c8e'; ctx.font = `600 22px ${F.body}`; ctx.textAlign = 'center';
      ctx.fillText('กำลังถ่ายแบบ…', tx + tW / 2, ty + tH / 2);
      ctx.textAlign = 'left';
    }
    // text
    const x0 = tx + tW + 14, w = c.x + c.w - x0 - 10;
    ctx.fillStyle = '#1f1c1c';
    ctx.font = `800 31px ${F.looped}`;
    const lines = wrap(ctx, it.name.th, w);
    lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, x0, c.y + 44 + i * 36));
    ctx.fillStyle = '#7a7368';
    ctx.font = `500 19px ${F.body}`;
    if (it.name.en) ctx.fillText(it.name.en, x0, c.y + 44 + Math.min(2, lines.length) * 36 + 2);
    // price burst
    const price = it.price ?? 0;
    ctx.save();
    ctx.translate(x0 + 62, c.y + c.h - 62);
    ctx.rotate((rnd() - 0.5) * 0.3);
    burst(ctx, 0, 0, 58, 46, price === 0 ? '#9fe39a' : '#ffe36b', 14);
    ctx.fillStyle = '#c8211c';
    ctx.textAlign = 'center';
    ctx.font = `900 ${price >= 1000 ? 30 : 36}px ${F.heavy}`;
    ctx.fillText(price === 0 ? 'ฟรี!' : `฿${price.toLocaleString('th-TH')}`, 0, 12);
    ctx.restore();
    // colour dots
    if (it.colors && it.colors.length > 1) {
      it.colors.slice(0, 5).forEach((col, i) => {
        ctx.beginPath();
        ctx.arc(x0 + 140 + i * 30, c.y + c.h - 52, 11, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(30,25,20,0.6)'; ctx.stroke();
      });
    }
    // worn stamp
    if (worn) {
      ctx.save();
      ctx.translate(c.x + c.w - 86, c.y + 54);
      ctx.rotate(-0.22);
      ctx.strokeStyle = 'rgba(200,33,28,0.85)'; ctx.lineWidth = 5;
      ctx.strokeRect(-70, -30, 140, 56);
      ctx.fillStyle = 'rgba(200,33,28,0.9)';
      ctx.font = `900 32px ${F.looped}`; ctx.textAlign = 'center';
      ctx.fillText('ใส่อยู่!', 0, 10);
      ctx.restore();
    }
    ctx.restore();
  }

  private drawCellThumb(p: Page, id: string) {
    const c = p.cells.find((x) => x.item.id === id);
    if (!c) return;
    const ctx = p.canvas.getContext('2d')!;
    this.drawCell(ctx, p, c);
    p.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ navigation & animation

  goto(i: number) {
    i = Math.max(0, Math.min(this.pages.length - 1, i));
    if (i === this.cur || this.turn.active) return;
    const dir = i > this.cur ? 1 : -1;
    this.ensure(i);
    this.thumbs.front(i);
    this.ensure(i + 1);
    const from = this.cur;
    this.cur = i;
    // forward: the old page curls away (front shows the new page); backward: the new page curls in
    this.turn = { active: true, t: 0, dir, from, to: i };
    const tf = this.turnFront.material as THREE.MeshStandardMaterial;
    const tb = this.turnBack.material as THREE.MeshStandardMaterial;
    if (dir > 0) { tf.map = this.pages[from].tex; this.frontMat.map = this.pages[i].tex; }
    else { tf.map = this.pages[i].tex; this.frontMat.map = this.pages[from].tex; }
    this.turnFront.visible = this.turnBack.visible = true;
    this.marker.visible = false;
    sfx.page();
  }
  next() { this.goto(this.cur + 1); }
  prev() { this.goto(this.cur - 1); }
  gotoSection(sec: Section) {
    const i = this.pages.findIndex((p) => p.sec === sec);
    if (i >= 0) this.goto(i);
  }

  private curl(theta: number) {
    const pos = this.turnGeo.attributes.position as THREE.BufferAttribute;
    const nx = 28;
    const xs: number[] = [0], zs: number[] = [0];
    const ds = PW / nx;
    let x = 0, z = 0;
    for (let i = 1; i <= nx; i++) {
      const s = (i - 0.5) / nx;
      const phi = theta + 1.1 * Math.sin(theta) * Math.pow(s, 1.4);
      x += Math.cos(phi) * ds; z -= Math.sin(phi) * ds;
      xs.push(x); zs.push(z);
    }
    for (let v = 0; v < pos.count; v++) {
      const col = v % (nx + 1);
      pos.setX(v, xs[col]);
      pos.setZ(v, zs[col] * 0.55);
    }
    pos.needsUpdate = true;
    this.turnGeo.computeVertexNormals();
  }

  update(dt: number) {
    this.t += dt;
    this.thumbs.step();
    if (this.turn.active) {
      this.turn.t += dt / 0.55;
      const k = Math.min(1, this.turn.t);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const theta = (this.turn.dir > 0 ? e : 1 - e) * Math.PI;
      this.curl(theta);
      // the turned page lands on the left and slips away (we only ever show the right-hand page)
      const op = Math.min(1, Math.max(0, (Math.PI - theta) / (Math.PI * 0.35)));
      (this.turnFront.material as THREE.MeshStandardMaterial).opacity = op;
      (this.turnBack.material as THREE.MeshStandardMaterial).opacity = op;
      if (k >= 1) {
        this.turn.active = false;
        this.turnFront.visible = this.turnBack.visible = false;
        this.frontMat.map = this.pages[this.cur].tex;
        this.frontMat.needsUpdate = true;
      }
    }
    for (const tb of this.tabs) {
      const active = this.pages[this.cur].sec === tb.sec || (tb.sec === 'hair' && this.pages[this.cur].sec === 'faces');
      tb.tgt = (this.hover?.kind === 'tab' && this.hover.tab === this.tabs.indexOf(tb) ? 0.012 : 0) + (active ? 0.008 : 0);
      tb.out += (tb.tgt - tb.out) * Math.min(1, dt * 12);
      tb.mesh.position.x = PW + 0.012 + tb.out;
    }
    if (this.marker.visible) {
      const s = 1 + Math.sin(this.t * 8) * 0.03;
      this.marker.scale.set(this.marker.userData.w * s, this.marker.userData.h * s, 1);
    }
  }

  // ------------------------------------------------------------------ picking

  /** hover test with a camera ray; returns true if the magazine is under the cursor */
  pick(ndc: THREE.Vector2, cam: THREE.Camera): boolean {
    this.ray.setFromCamera(ndc, cam);
    const tabMeshes = this.tabs.map((t) => t.mesh);
    const hits = this.ray.intersectObjects([this.front, ...tabMeshes], false);
    const prev = this.hover;
    this.hover = null;
    if (hits.length && !this.turn.active) {
      const h = hits[0];
      if (h.object.userData.tab !== undefined) this.hover = { kind: 'tab', tab: h.object.userData.tab };
      else if (h.uv) {
        const px = h.uv.x * CW, py = (1 - h.uv.y) * CH;
        const p = this.pages[this.cur];
        const cell = p.cells.find((c) => px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h);
        if (cell) this.hover = { kind: 'item', cell };
        else if (px > CW * 0.6 && py > CH - 120) this.hover = { kind: 'next' };
        else if (p.sec === 'cover') this.hover = { kind: 'next' };
        else if (px < CW * 0.25 && py > CH - 120) this.hover = { kind: 'prev' };
      }
    }
    if (this.hover?.kind === 'item' && this.hover.cell) {
      const c = this.hover.cell;
      const w = (c.w / CW) * PW + 0.012, hh = (c.h / CH) * PH + 0.012;
      this.marker.userData = { w, h: hh };
      this.marker.position.set(((c.x + c.w / 2) / CW) * PW, PH / 2 - ((c.y + c.h / 2) / CH) * PH, 0.0015);
      this.marker.visible = true;
    } else this.marker.visible = false;
    const changed = JSON.stringify(prev && { k: prev.kind, t: prev.tab, i: prev.cell?.item.id }) !== JSON.stringify(this.hover && { k: this.hover.kind, t: this.hover.tab, i: this.hover.cell?.item.id });
    if (changed && this.hover) sfx.hover();
    return hits.length > 0;
  }

  /** click at the last picked position */
  click(): boolean {
    const h = this.hover;
    if (!h) return false;
    if (h.kind === 'tab' && h.tab !== undefined) { this.gotoSection(SECTIONS[h.tab].sec); return true; }
    if (h.kind === 'next') { this.next(); return true; }
    if (h.kind === 'prev') { this.prev(); return true; }
    if (h.kind === 'item' && h.cell) {
      const it = h.cell.item;
      this.onPick(it);
      this.draw(this.pages[this.cur]);
      return true;
    }
    return false;
  }

  dispose() {
    this.thumbs.dispose();
    for (const p of this.pages) p.tex.dispose();
    this.group.traverse((o: any) => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { m.map?.dispose?.(); m.dispose(); } } });
  }
}

// ------------------------------------------------------------------ canvas helpers

function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function coverFit(ctx: CanvasRenderingContext2D, im: HTMLImageElement, x: number, y: number, w: number, h: number, shift = 0) {
  const k = Math.max(w / im.width, h / im.height);
  const sw = w / k, sh = h / k;
  const sx = (im.width - sw) * 0.5, sy = Math.max(0, Math.min(im.height - sh, (im.height - sh) * (0.5 + shift)));
  ctx.drawImage(im, sx, sy, sw, sh, x, y, w, h);
}

function burst(ctx: CanvasRenderingContext2D, x: number, y: number, r1: number, r2: number, col: string, n: number) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 ? r2 : r1;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  ctx.fill();
  ctx.restore();
}

const seg: any = (Intl as any).Segmenter ? new (Intl as any).Segmenter('th', { granularity: 'word' }) : null;
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words: string[] = seg ? [...seg.segment(text)].map((s: any) => s.segment) : text.split(/(\s+)/);
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    if (line && ctx.measureText(line + w).width > maxW) { out.push(line.trim()); line = w.trimStart(); }
    else line += w;
  }
  if (line) out.push(line.trim());
  return out;
}

function tabCanvas(label: string, color: string, i: number) {
  const cv = document.createElement('canvas');
  cv.width = 300; cv.height = 120;
  const ctx = cv.getContext('2d')!;
  const rnd = mulberry(i * 97 + 3);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 6); ctx.lineTo(292 + rnd() * 6, 2 + rnd() * 4); ctx.lineTo(296, 114 - rnd() * 4); ctx.lineTo(0, 116); ctx.closePath();
  ctx.fill();
  // adhesive strip shade + curl
  const g = ctx.createLinearGradient(0, 0, 300, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.12)'); g.addColorStop(0.25, 'rgba(0,0,0,0)'); g.addColorStop(0.92, 'rgba(255,255,255,0.15)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g; ctx.fill();
  ctx.fillStyle = '#1b2b6b';
  ctx.font = `400 ${label.length > 9 ? 31 : label.length > 6 ? 42 : 58}px ${F.hand}`;
  ctx.textBaseline = 'middle';
  ctx.save(); ctx.translate(114, 62); ctx.rotate((rnd() - 0.5) * 0.06); ctx.fillText(label, 0, 0); ctx.restore();
  return cv;
}

function markerCanvas() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  const ctx = cv.getContext('2d')!;
  ctx.strokeStyle = 'rgba(214,32,30,0.9)';
  ctx.lineCap = 'round';
  const rnd = mulberry(5);
  for (let pass = 0; pass < 2; pass++) {
    ctx.lineWidth = 10 - pass * 3;
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2.15; a += 0.08) {
      const r = 236 + Math.sin(a * 3 + pass) * 6 + (rnd() - 0.5) * 3;
      const x = 256 + Math.cos(a - 0.6) * r * (1 - pass * 0.02), y = 256 + Math.sin(a - 0.6) * r * 0.97;
      if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return cv;
}

function edgeCanvas() {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 256;
  const ctx = cv.getContext('2d')!;
  for (let y = 0; y < 256; y += 2) { ctx.fillStyle = y % 4 ? '#f6f2ea' : '#d9d2c4'; ctx.fillRect(0, y, 64, 2); }
  return cv;
}

function adCanvas(onReady: () => void) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 686;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#c8211c'; ctx.fillRect(0, 0, 512, 686);
  loadImg(IMG('sale_sign.jpg')).then((im) => {
    if (!im) return;
    coverFit(ctx, im, 0, 0, 512, 686);
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 64px ${F.looped}`;
    ctx.fillText('ลดล้างสต็อก!', 30, 600);
    ctx.font = `600 26px ${F.body}`;
    ctx.fillText('ห้างดังกลางเมือง · ทุกชิ้นลด 50%', 32, 646);
    onReady();
  });
  return cv;
}
