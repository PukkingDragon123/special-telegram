import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { CharacterRig, Look } from '../../game/contracts';
import { Assets } from '../../core/assets';
import { Sound, SoundHandle } from '../../core/audio';
import { Input } from '../../core/input';
import { damp } from '../../core/util';
import { F } from '../../core/fonts';
import { StickerUI, Sticker } from './ui';
import { GOLD } from './lettering';
import { Magazine, MagItem } from './magazine';
import { sfx, musicKey } from './sfx';
import { screamLines } from './lines';

/* ============================================================================================
 * Customize: your guy T-poses in the middle of a busy Thai street in nothing but a singlet and
 * shorts. The street is a REAL photo (Flickr, CC BY-SA 4.0 "Pattaya Patrol" / CC BY 2.0
 * "Heidi De Vries") camera-projected onto a proxy corridor (ground + facades + far wall), so the
 * 3D characters stand inside it with correct perspective. Girls walk by, notice, scream
 * "ว้ายยย! โรคจิต!!" and run away. The UI is the "ซอยสไตล์" fashion magazine (magazine.ts).
 * ========================================================================================== */

interface Backdrop { file: string; hfov: number; vpU: number; vpV: number; height: number; left: number; right: number; far: number; mood: 'dusk' | 'day'; bright: number }
const BACKDROPS: Backdrop[] = [
  { file: 'gen/menu/street/street_dusk.jpg', hfov: 50, vpU: 0.505, vpV: 0.52, height: 1.5, left: -6.2, right: 5.6, far: -150, mood: 'dusk', bright: 1.35 },
  { file: 'gen/menu/street/soi_day.jpg', hfov: 60, vpU: 0.576, vpV: 0.612, height: 1.55, left: -3.3, right: 3.5, far: -70, mood: 'day', bright: 1.12 },
];
const PROJ_Z = 6.0;

const projVert = /* glsl */ `
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const projFrag = /* glsl */ `
uniform sampler2D map; uniform mat4 projVP; uniform float bright; uniform vec3 tint;
varying vec3 vW;
void main() {
  vec4 c = projVP * vec4(vW, 1.0);
  vec2 uv = c.xy / max(c.w, 1e-4) * 0.5 + 0.5;
  vec3 col = texture2D(map, clamp(uv, vec2(0.002), vec2(0.998))).rgb;
  float edge = smoothstep(-0.03, 0.02, uv.x) * smoothstep(1.03, 0.98, uv.x) * smoothstep(-0.03, 0.02, uv.y) * smoothstep(1.03, 0.98, uv.y);
  col = mix(col * vec3(0.35, 0.33, 0.32), col, edge) * bright * tint;
  if (c.w <= 0.0) col = vec3(0.05);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

interface Walker { rig: CharacterRig; pos: THREE.Vector3; yaw: number; speed: number; state: string; t: number; line?: { th: string; en?: string }; bubble?: any }

export class CustomizeView {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.03, 400);
  private look!: Look;
  private rig!: CharacterRig;
  private mag!: Magazine;
  private bd: Backdrop;
  private girl: Walker | null = null;
  private girlTimer = 3.2;
  private girlN = 0;
  private peds: Walker[] = [];
  private stickers: Sticker[] = [];
  private offs: (() => void)[] = [];
  private loops: SoundHandle[] = [];
  private t = 0;
  private kick = 0;
  private pop = 0;
  private ambTimer = 4;
  private envTex: THREE.Texture | null = null;
  private camBase = new THREE.Vector3(0.85, 1.3, 4.25);
  private camLook = new THREE.Vector3(0.9, 0.95, 0);
  private magRoot = new THREE.Group();
  private screams = screamLines();

  constructor(private game: Game, private ui: StickerUI, private onDone: () => void) {
    this.bd = BACKDROPS[Math.random() < 0.65 ? 0 : 1];
  }

  enter() {
    const game = this.game;
    this.scene.name = 'menu_customize';
    this.scene.background = new THREE.Color(0x1a1714);
    this.scene.add(this.camera);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(this.camLook);
    this.buildStreet();
    this.buildLights();
    // ---- the look: first time → only a singlet + shorts (+ flip-flops)
    const me = game.me;
    const cur: Look = JSON.parse(JSON.stringify(me?.look ?? game.profile.look ?? game.chars.playerLook(me?.slot ?? 0)));
    if (!game.profile.look) { cur.top = { id: 'singlet_white', color: '#f1eee6' }; cur.bottom = { id: 'boxer_plaid', color: '#3a5aa0' }; cur.shoes = { id: 'flipflops', color: '#2f63b8' }; cur.acc = []; }
    this.look = cur;
    this.rig = game.chars.create(JSON.parse(JSON.stringify(cur)), { lod: 'high', castShadow: true });
    this.rig.root.rotation.y = Math.PI - 0.2;
    this.rig.play('tpose', { loop: true, fade: 0 });
    this.rig.setMove(0);
    this.scene.add(this.rig.root);
    // ---- magazine in front of the camera
    this.mag = new Magazine(game, cur, () => this.look, (it) => this.apply(it));
    this.magRoot.add(this.mag.group);
    this.magRoot.position.set(0.035, -0.006, -0.425);
    this.camera.add(this.magRoot);
    const ml = new THREE.SpotLight(0xfff6e8, 4.5, 3, 0.9, 0.7, 1.5);
    ml.position.set(-0.25, 0.35, 0.15);
    ml.target = this.mag.group;
    this.camera.add(ml);
    // ---- passers-by on the far sidewalk
    for (let i = 0; i < 3; i++) this.peds.push(this.makeWalker(['office_worker_f', 'uncle_singlet', 'student_m', 'housewife', 'moto_taxi'][(i + Math.floor(Math.random() * 5)) % 5], new THREE.Vector3(this.bd.left + 1.2 + (i % 2) * 0.7, 0, -6 - i * 4.5), i % 2 ? 0 : Math.PI, 1.05 + i * 0.12));
    // ---- view
    game.engine.setView(this.scene, this.camera);
    game.ui.setScene(this.scene, this.camera);
    const post = game.engine.post;
    post.setLook(this.bd.mood === 'dusk' ? 'golden' : 'thaiDay', 1);
    post.setDOF(false);
    this.loadEnv();
    // ---- stickers
    const L = (text: string, en?: string, size = 54): any[] => {
      const a: any[] = [{ text, size, font: F.looped, weight: 900 }];
      if (en) a.push({ text: en, size: Math.round(size * 0.36), font: F.looped, weight: 900, gap: -Math.round(size * 0.14), band: 0.9, spacing: 2 });
      return a;
    };
    this.stickers.push(this.ui.add({ lines: L('แต่งตัว', 'CUSTOMIZE', 58), anchor: 'tl', x: 135, y: 62, passive: true, tilt: -4, delay: 0.3 }));
    this.stickers.push(this.ui.add({ lines: L('คลิกของในนิตยสารเพื่อลองใส่', 'CLICK ANYTHING IN THE MAGAZINE', 22), anchor: 'tl', x: 180, y: 128, passive: true, tilt: 1.5, delay: 0.5 }));
    this.stickers.push(this.ui.add({ lines: L('เสร็จแล้ว!', 'DONE', 56), style: GOLD, anchor: 'bl', x: 140, y: 70, tilt: -3, onClick: () => this.done(), delay: 0.7 }));
    // ---- input
    const cv = game.engine.canvas;
    const onMove = () => { const over = this.mag.pick(new THREE.Vector2(Input.ndc.x, Input.ndc.y), this.camera); cv.style.cursor = over ? 'pointer' : ''; };
    const onDown = (e: PointerEvent) => { if (e.button !== 0) return; onMove(); if (this.mag.click()) this.kick = Math.max(this.kick, 0.25); };
    const onWheel = (e: WheelEvent) => { if (e.deltaY > 0) this.mag.next(); else if (e.deltaY < 0) this.mag.prev(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'ArrowRight' || e.key === 'PageDown') this.mag.next(); else if (e.key === 'ArrowLeft' || e.key === 'PageUp') this.mag.prev(); };
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('keydown', onKey);
    this.offs.push(() => { cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerdown', onDown); cv.removeEventListener('wheel', onWheel); window.removeEventListener('keydown', onKey); cv.style.cursor = ''; });
    // ---- sound
    Sound.music(musicKey('magazine'));
    Sound.preload(['menu_scream', 'page_turn', 'motorbike_pass', 'car_horn_short']);
    for (const [k, v] of [['street_ambience_day_loop', 0.55], ['traffic_bangkok_loop', 0.32]] as [string, number][]) if (Sound.has(k)) this.loops.push(Sound.loop(k, { vol: v, bus: 'amb' }));
  }

  private buildStreet() {
    const bd = this.bd;
    const tex = Assets.texture(bd.file, { srgb: true, wrap: false });
    tex.anisotropy = 8;
    // projector camera = the photographer
    const im = { w: 2048, h: bd.file.includes('soi') ? 768 * 2 : 1365 };
    const aspect = bd.file.includes('soi') ? 1024 / 768 : 2048 / 1365;
    void im;
    const vfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(bd.hfov / 2)) / aspect));
    const pc = new THREE.PerspectiveCamera(vfov, aspect, 0.1, 500);
    pc.position.set(0, bd.height, PROJ_Z);
    pc.rotation.set(THREE.MathUtils.degToRad((bd.vpV - 0.5) * vfov), THREE.MathUtils.degToRad((bd.vpU - 0.5) * bd.hfov), 0, 'YXZ');
    pc.updateMatrixWorld(true);
    pc.updateProjectionMatrix();
    const vp = new THREE.Matrix4().multiplyMatrices(pc.projectionMatrix, pc.matrixWorldInverse);
    const mat = new THREE.ShaderMaterial({
      vertexShader: projVert, fragmentShader: projFrag,
      uniforms: { map: { value: tex }, projVP: { value: vp }, bright: { value: bd.bright }, tint: { value: new THREE.Color(1, 1, 1) } },
      side: THREE.DoubleSide,
    });
    const g = new THREE.Group();
    g.name = 'street_proxy';
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(bd.right - bd.left, PROJ_Z + 4 - bd.far), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((bd.left + bd.right) / 2, 0, (PROJ_Z + 4 + bd.far) / 2);
    const lw = new THREE.Mesh(new THREE.PlaneGeometry(PROJ_Z + 4 - bd.far, 60), mat);
    lw.rotation.y = Math.PI / 2;
    lw.position.set(bd.left, 30, (PROJ_Z + 4 + bd.far) / 2);
    const rw = lw.clone();
    rw.rotation.y = -Math.PI / 2;
    rw.position.x = bd.right;
    const fw = new THREE.Mesh(new THREE.PlaneGeometry(bd.right - bd.left, 60), mat);
    fw.position.set((bd.left + bd.right) / 2, 30, bd.far);
    // sky dome catches rays above the facades
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat);
    sky.rotation.x = Math.PI / 2;
    sky.position.set(0, 60, bd.far / 2);
    g.add(ground, lw, rw, fw, sky);
    this.scene.add(g);
    // contact shadows on the street
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.42, color: 0x1a1008 }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.004;
    sh.receiveShadow = true;
    this.scene.add(sh);
  }

  private buildLights() {
    const dusk = this.bd.mood === 'dusk';
    const key = new THREE.DirectionalLight(dusk ? 0xffc890 : 0xfff1d8, dusk ? 2.2 : 3.0);
    key.position.set(-3, 5, 4);
    key.target.position.set(0, 0.8, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -4; sc.right = 4; sc.top = 4; sc.bottom = -2; sc.near = 0.5; sc.far = 20;
    key.shadow.bias = -0.0005;
    key.shadow.radius = 5;
    const rim = new THREE.DirectionalLight(dusk ? 0x9fb4ff : 0xfff4dc, dusk ? 1.6 : 1.2);
    rim.position.set(3, 3, -5);
    const hemi = new THREE.HemisphereLight(dusk ? 0x8a9ccc : 0xe8eef8, dusk ? 0x4a3a2c : 0x7a6a58, dusk ? 0.9 : 1.1);
    this.scene.add(key, key.target, rim, hemi);
  }

  private async loadEnv() {
    try {
      const hdr = await Assets.hdr(this.bd.mood === 'dusk' ? 'hdri/dusk_blue_hour_1k.hdr' : 'hdri/day_hazy_street_1k.hdr');
      const pm = new THREE.PMREMGenerator(this.game.engine.renderer);
      this.envTex = pm.fromEquirectangular(hdr).texture;
      pm.dispose(); hdr.dispose();
      this.scene.environment = this.envTex;
      (this.scene as any).environmentIntensity = 0.5;
    } catch (e) { console.warn('[menu] customize env', e); }
  }

  // ------------------------------------------------------------------ outfit

  private apply(it: MagItem) {
    const L = this.look;
    const col = it.colors?.[0];
    switch (it.kind) {
      case 'tops': L.top = { id: it.id, color: col ?? L.top.color }; break;
      case 'bottoms': L.bottom = { id: it.id, color: col ?? L.bottom.color }; break;
      case 'shoes': L.shoes = { id: it.id, color: col ?? L.shoes.color }; break;
      case 'acc': {
        if (it.id === '__none') { L.acc = []; break; }
        const slot = (id: string) => (/cap|hat|helmet|bucket|straw/.test(id) ? 'hat' : /glass/.test(id) ? 'eyes' : /chain|towel|lanyard/.test(id) ? 'neck' : /watch/.test(id) ? 'wrist' : /mask/.test(id) ? 'face' : id);
        if (L.acc.includes(it.id)) L.acc = L.acc.filter((a) => a !== it.id);
        else { const s = slot(it.id); L.acc = [...L.acc.filter((a) => slot(a) !== s), it.id].slice(-6); }
        break;
      }
      case 'hair': L.hair = { style: it.id, color: L.hair.color }; break;
      case 'faces': L.face = it.id; if (it.sex === 'f' || it.sex === 'm') L.sex = it.sex as any; break;
      case 'skins': L.skin = it.color ?? it.id; break;
    }
    this.rig.setLook(JSON.parse(JSON.stringify(L)));
    this.rig.play('tpose', { loop: true, fade: 0 });
    this.kick = 1;
    this.pop = 0.45;
    sfx.play(Sound.has('pickup') ? 'pickup' : 'menu_select', { vol: 0.8 });
    sfx.play('menu_select', { vol: 0.5 });
  }

  done() {
    const look = JSON.parse(JSON.stringify(this.look));
    this.game.profile.look = look;
    this.game.saveProfile();
    this.game.intent('player.setLook', { look });
    sfx.confirm();
    for (const s of this.stickers) this.ui.remove(s);
    this.stickers = [];
    this.onDone();
  }

  // ------------------------------------------------------------------ the girl who screams

  private makeWalker(arch: string, pos: THREE.Vector3, yaw: number, speed: number, female = false): Walker {
    let look = this.game.chars.randomLook(arch, Math.floor(Math.random() * 1e6));
    if (female && look.sex !== 'f') look = { ...look, sex: 'f' };
    const rig = this.game.chars.create(look, { lod: 'high', castShadow: true });
    rig.root.position.copy(pos);
    rig.root.rotation.y = yaw;
    this.scene.add(rig.root);
    return { rig, pos: pos.clone(), yaw, speed, state: 'walk', t: 0 };
  }

  private spawnGirl() {
    const arch = ['sexy_girl_who_screams', 'student_f', 'office_worker_f', 'sexy_girl_who_screams', 'auntie_vendor', 'old_lady'][this.girlN++ % 6];
    const fromLeft = true;
    const z = -1.0 - Math.random() * 1.2;
    const w = this.makeWalker(arch, new THREE.Vector3(fromLeft ? -4.8 : 4, 0, z), -Math.PI / 2, 1.25 + Math.random() * 0.3, true);
    w.line = this.screams[Math.floor(Math.random() * this.screams.length)];
    w.rig.setFace('neutral');
    this.girl = w;
  }

  private updateGirl(dt: number) {
    if (!this.girl) {
      this.girlTimer -= dt;
      if (this.girlTimer <= 0) this.spawnGirl();
      return;
    }
    const g = this.girl;
    g.t += dt;
    const me = new THREE.Vector3(0, 1.5, 0);
    if (g.state === 'walk') {
      g.pos.x += g.speed * dt;
      g.rig.setMove(g.speed);
      g.yaw = -Math.PI / 2;
      if (g.pos.x > -1.35) { g.state = 'notice'; g.t = 0; g.rig.setMove(0); g.rig.setFace('shock'); g.rig.play('idle', { loop: true }); sfx.play('menu_pop', { vol: 0.3, pitch: 0.7 }); }
    } else if (g.state === 'notice') {
      // turns to look at the T-posing guy… takes it in…
      const want = Math.atan2(-(0 - g.pos.x), -(0 - g.pos.z));
      g.yaw += (want - g.yaw) * Math.min(1, dt * 6);
      g.rig.lookAt(me);
      if (g.t > 0.9) {
        g.state = 'scream'; g.t = 0;
        g.rig.setFace('scream');
        g.rig.play('scream_run', { loop: true });
        const head = () => g.rig.root.localToWorld(new THREE.Vector3(0, (g.rig.height || 1.6) + 0.15, 0));
        g.bubble = this.game.ui.shout(head, g.line!.th, { sub: g.line!.en, duration: 1.6, voice: 0 });
        sfx.scream(g.pos.clone().setY(1.5));
        this.rig.lookAt(g.pos.clone().setY(1.5));
        this.kick = Math.max(this.kick, 0.6);
      }
    } else if (g.state === 'scream') {
      if (g.t > 0.65) { g.state = 'run'; g.t = 0; }
    } else if (g.state === 'run') {
      const sp = 4.6;
      g.yaw = Math.PI / 2 - 0.25;
      g.pos.x -= sp * dt;
      g.pos.z -= sp * 0.25 * dt;
      g.rig.setMove(sp);
      if (g.pos.x < -7.5) {
        this.scene.remove(g.rig.root);
        g.rig.dispose();
        this.girl = null;
        this.girlTimer = 7 + Math.random() * 8;
        this.rig.lookAt(null);
      }
    }
    g.rig.root.position.copy(g.pos);
    g.rig.root.rotation.y = g.yaw;
    g.rig.update(dt);
  }

  private updatePeds(dt: number) {
    for (const p of this.peds) {
      const dir = p.yaw === 0 ? -1 : 1; // yaw 0 faces -Z
      p.pos.z += dir * p.speed * dt;
      if (p.pos.z < -20) { p.yaw = Math.PI; } else if (p.pos.z > -4) { p.yaw = 0; }
      p.rig.setMove(p.speed);
      p.rig.root.position.copy(p.pos);
      p.rig.root.rotation.y += ((p.yaw) - p.rig.root.rotation.y) * Math.min(1, dt * 5);
      p.rig.update(dt);
    }
  }

  // ------------------------------------------------------------------ frame

  update(dt: number) {
    this.t += dt;
    // camera: hand-held drift + kick on every outfit change
    this.kick = Math.max(0, this.kick - dt * 2.2);
    const k = this.kick;
    const c = this.camera;
    const mx = Input.ndc.x * 0.04, my = Input.ndc.y * 0.025;
    c.position.set(this.camBase.x + Math.sin(this.t * 0.7) * 0.02 + mx, this.camBase.y + Math.sin(this.t * 0.9) * 0.012 + my - k * 0.03, this.camBase.z - k * 0.12);
    c.lookAt(this.camLook.x + mx * 0.5, this.camLook.y + my * 0.5, this.camLook.z);
    c.rotateZ(Math.sin(this.t * 25) * k * 0.012);
    // magazine hand-held sway
    this.magRoot.position.set(0.035 + Math.sin(this.t * 0.8) * 0.0025, -0.006 + Math.sin(this.t * 1.1) * 0.002, -0.425);
    this.magRoot.rotation.set(-0.03 + Math.sin(this.t * 0.6) * 0.008, -0.16 + Math.sin(this.t * 0.5) * 0.01, 0.025 + Math.sin(this.t * 0.7) * 0.006);
    this.mag.update(dt);
    // the T-posing guy: squash pop on change, tiny wobble of pride
    if (this.pop > 0) this.pop = Math.max(0, this.pop - dt);
    const pk = this.pop / 0.45;
    const sq = 1 + Math.sin(pk * Math.PI) * 0.09;
    this.rig.root.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    this.rig.update(dt);
    this.updateGirl(dt);
    this.updatePeds(dt);
    // street life sounds
    this.ambTimer -= dt;
    if (this.ambTimer <= 0) {
      this.ambTimer = 4 + Math.random() * 7;
      const x = (Math.random() - 0.5) * 16, z = -4 - Math.random() * 20;
      sfx.play(Math.random() < 0.7 ? 'motorbike_pass' : 'car_horn_short', { pos: new THREE.Vector3(x, 1, z), vol: 0.6 });
    }
  }

  dispose() {
    for (const o of this.offs) o();
    this.offs = [];
    for (const l of this.loops) l.stop(0.6);
    for (const s of this.stickers) this.ui.remove(s);
    this.girl?.rig.dispose();
    for (const p of this.peds) p.rig.dispose();
    this.rig?.dispose();
    this.mag?.dispose();
    this.envTex?.dispose();
    this.scene.remove(this.game.ui.root);
    this.scene.traverse((o: any) => { if (o.geometry) o.geometry.dispose(); });
  }
}

void damp;
