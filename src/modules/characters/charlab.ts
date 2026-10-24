import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { SceneDef } from '../../game/scenes';
import type { AnimName, FaceVariant, Look } from '../../game/contracts';
import { Assets } from '../../core/assets';
import { params } from '../../core/util';
import { RigWorld, atlasQueueLength } from './rig';
import { createRig, AnyRig } from './rigglb';
import { ANIM_NAMES } from './anims';
import { ARCHETYPES, HAIRS, TOPS, BOTTOMS, playerLook, randomLook } from './defs';

/* ============================================================================================
 * 'charlab' dev scene (?charlab): a Thai street-ish backdrop with lineups for screenshots.
 *   &lab=lineup (default) | players | anims | faces | hair | clothes | crowd | tpose
 *   &anim=<AnimName> (force), &face=<variant>, &who=<archetype|p0..p3>, &n=<crowd size>,
 *   &cam=x,y,z,lx,ly,lz, &cycle (cycle anims)
 * window.__charlab = { rigs, setAnim, setFace, cam, focus }
 * ========================================================================================== */

interface Entry { rig: AnyRig; label?: THREE.Sprite; anim?: AnimName; base: THREE.Vector3; yaw: number; walk?: { r: number; a: number; sp: number; c: THREE.Vector3 } }

export class CharLab implements SceneDef {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 300);
  private entries: Entry[] = [];
  private t = 0;
  private sun!: THREE.DirectionalLight;
  private camTarget = new THREE.Vector3();
  fade = true;
  constructor(private game: Game) {}

  async enter() {
    const g = this.game;
    this.scene.background = new THREE.Color(0xc9d1d0);
    this.scene.fog = new THREE.Fog(0xc9cfcc, 25, 90);
    g.engine.setView(this.scene, this.camera);
    g.engine.post.setLook('thaiDay');
    this.buildSet();
    try {
      const hdr = await Assets.hdr('hdri/day_hazy_street_1k.hdr');
      const pm = new THREE.PMREMGenerator(g.engine.renderer);
      this.scene.environment = pm.fromEquirectangular(hdr).texture;
      this.scene.environmentIntensity = 0.75;
      pm.dispose();
    } catch { /* no HDRI → hemisphere light only */ }
    const lab = params.get('lab') ?? 'lineup';
    switch (lab) {
      case 'players': this.players(); break;
      case 'anims': this.anims(); break;
      case 'faces': this.faces(); break;
      case 'hair': this.hairs(); break;
      case 'clothes': this.clothes(); break;
      case 'crowd': this.crowd(); break;
      case 'tpose': this.tpose(); break;
      default: this.lineup();
    }
    const cam = params.get('cam')?.split(',').map(Number);
    if (cam && cam.length >= 6) { this.camera.position.set(cam[0], cam[1], cam[2]); this.camTarget.set(cam[3], cam[4], cam[5]); }
    this.camera.lookAt(this.camTarget);
    const forced = params.get('anim') as AnimName | null;
    if (forced) this.setAnim(forced);
    const face = params.get('face') as FaceVariant | null;
    if (face) this.setFace(face);
    (window as any).__charlab = { rigs: this.entries.map((e) => e.rig), setAnim: (a: AnimName) => this.setAnim(a), setFace: (f: FaceVariant) => this.setFace(f), cam: (x: number, y: number, z: number, lx: number, ly: number, lz: number) => { this.camera.position.set(x, y, z); this.camTarget.set(lx, ly, lz); this.camera.lookAt(this.camTarget); }, focus: (i: number, d = 2.2) => this.focus(i, d), queue: () => atlasQueueLength(), lab: this };
  }

  // ---------------------------------------------------------------- set dressing

  private buildSet() {
    const s = this.scene;
    const hemi = new THREE.HemisphereLight(0xe6eef5, 0x7a6a58, 0.9);
    s.add(hemi);
    const sun = (this.sun = new THREE.DirectionalLight(0xfff0d8, 2.6));
    sun.position.set(-6, 14, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.far = 60;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    s.add(sun, sun.target);
    // ground: worn concrete + a sidewalk strip with a red-white curb
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.rotation.x = rx; m.receiveShadow = true; m.castShadow = false; s.add(m); return m; };
    const pbr = (id: string, rep: number | [number, number], fb: number) => (Assets.hasPbr(id) ? Assets.pbr(id, { repeat: rep }) : new THREE.MeshStandardMaterial({ color: fb, roughness: 0.9 }));
    mk(new THREE.PlaneGeometry(80, 40), pbr('concrete_soi_road', [20, 10], 0x8a857c), [0, 0, 6], -Math.PI / 2);
    mk(new THREE.PlaneGeometry(80, 4.2), pbr('sidewalk_pavers_square', [40, 2], 0x9a958c), [0, 0.12, -3.1], -Math.PI / 2);
    const curb = new THREE.Mesh(new THREE.BoxGeometry(80, 0.15, 0.18), pbr('concrete_streaked', [40, 1], 0xd8d2c8));
    curb.position.set(0, 0.06, -1.0); curb.receiveShadow = true; s.add(curb);
    // red-white curb paint
    const stripes = new THREE.Group();
    for (let x = -40; x < 40; x += 1) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.152, 0.182), new THREE.MeshStandardMaterial({ color: 0xb8322a, roughness: 0.8 })); b.position.set(x + 0.25, 0.06, -1.0); stripes.add(b); }
    s.add(stripes);
    // shophouse facades
    const wall = pbr('plaster_painted_dirty', [3, 1.2], 0xcfc4b0);
    const shutter = pbr('shutter_roller_rusty', [2, 1], 0x7a7066);
    for (let i = -5; i <= 5; i++) {
      const x = i * 4.2;
      mk(new THREE.BoxGeometry(4.1, 7.5, 0.4), wall, [x, 3.75, -5.4]);
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.8), shutter);
      sh.position.set(x, 1.55, -5.19); s.add(sh);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.7, 0.1), new THREE.MeshStandardMaterial({ color: [0xc8a23a, 0x2f6a9a, 0xb8322a, 0x3a7a4a][(i + 5) % 4], roughness: 0.6 }));
      sign.position.set(x, 3.4, -5.12); s.add(sign);
    }
    // a few plastic stools (for sit tests)
    for (let i = 0; i < 3; i++) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.45, 12), new THREE.MeshStandardMaterial({ color: [0xc8322a, 0x2f6ab8, 0x3a8a4a][i], roughness: 0.5 }));
      st.position.set(9 + i * 0.9, 0.225, 3.2); st.castShadow = true; st.receiveShadow = true; s.add(st);
    }
  }

  private label(text: string, sub = '') {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 128;
    const g = cv.getContext('2d')!;
    g.fillStyle = 'rgba(20,16,12,0.72)';
    g.beginPath(); (g as any).roundRect?.(8, 8, 496, 112, 18); g.fill();
    g.fillStyle = '#fff4dc'; g.textAlign = 'center';
    g.font = '600 46px "Sarabun", "Noto Sans Thai Looped", sans-serif';
    g.fillText(text, 256, 62);
    if (sub) { g.font = '400 28px "Sarabun", sans-serif'; g.fillStyle = '#d8ccb4'; g.fillText(sub, 256, 104); }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    sp.scale.set(0.9, 0.225, 1);
    sp.renderOrder = 10;
    return sp;
  }

  private add(look: Look, pos: THREE.Vector3, yaw = Math.PI, anim: AnimName = 'idle', label?: string, sub?: string, lod?: 'high' | 'low') {
    const rig = createRig(look, { lod: lod ?? (params.has('hq') ? 'high' : undefined) });
    rig.root.position.copy(pos);
    rig.root.rotation.y = yaw;
    this.scene.add(rig.root);
    rig.play(anim, { loop: true, fade: 0 });
    const e: Entry = { rig, base: pos.clone(), yaw, anim };
    if (label && !params.has('nolabel')) { e.label = this.label(label, sub); e.label.position.set(pos.x, 0.25, pos.z + 0.45); this.scene.add(e.label); }
    this.entries.push(e);
    return e;
  }

  // ---------------------------------------------------------------- labs

  private lineup() {
    const ids = Object.keys(ARCHETYPES);
    const perRow = 9;
    ids.forEach((id, i) => {
      const row = Math.floor(i / perRow), col = i % perRow;
      const x = (col - (perRow - 1) / 2) * 1.05, z = row * 1.6;
      this.add(randomLook(id, 7 + i * 13), new THREE.Vector3(x, 0, z), Math.PI, 'idle', ARCHETYPES[id].name.th, id);
    });
    const rows = Math.ceil(ids.length / perRow);
    for (let s = 0; s < 4; s++) this.add(playerLook(s), new THREE.Vector3((s - 1.5) * 1.1, 0, rows * 1.6), Math.PI, 'idle', 'ผู้เล่น ' + (s + 1), 'player ' + s);
    this.camera.position.set(0, 3.2, rows * 1.6 + 7.5);
    this.camTarget.set(0, 0.9, rows * 0.8 - 0.3);
    if (params.has('cycle')) this.cycleAll = true;
  }

  private players() {
    for (let s = 0; s < 4; s++) this.add(playerLook(s), new THREE.Vector3((s - 1.5) * 0.9, 0, 0), Math.PI, 'idle', undefined, undefined, 'high');
    this.camera.position.set(0, 1.45, 4.6);
    this.camTarget.set(0, 1.05, 0);
  }

  private whoLook(): Look {
    const who = params.get('who') ?? 'p1';
    if (/^p\d$/.test(who)) return playerLook(+who[1]);
    return randomLook(who, +(params.get('seed') ?? 11));
  }

  private anims() {
    const look = this.whoLook();
    const perRow = 7;
    ANIM_NAMES.forEach((a, i) => {
      const row = Math.floor(i / perRow), col = i % perRow;
      const e = this.add(look, new THREE.Vector3((col - (perRow - 1) / 2) * 1.5, 0, row * 1.9), Math.PI, a, a);
      if (a === 'walk' || a === 'run' || a === 'scream_run' || a === 'push_cart' || a === 'carry_heavy' || a === 'drunk') e.rig.setMove(a === 'run' || a === 'scream_run' ? 4.8 : 1.3);
      if (a === 'sit' || a === 'jenga_pull') { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, a === 'sit' ? 0.45 : 0.42, 12), new THREE.MeshStandardMaterial({ color: 0xc8322a, roughness: 0.5 })); st.position.set(e.base.x, (a === 'sit' ? 0.225 : 0.21), e.base.z - 0.08); st.castShadow = true; this.scene.add(st); }
      if (a === 'eat' || a === 'drink' || a === 'count_coins') e.rig.setPosture('stand');
    });
    const rows = Math.ceil(ANIM_NAMES.length / perRow);
    this.camera.position.set(0, 6.5, rows * 1.9 + 6);
    this.camTarget.set(0, 0.6, rows * 0.95 - 0.5);
  }

  private faces() {
    const variants: FaceVariant[] = ['neutral', 'think', 'drunk', 'sleep', 'shock', 'scream'];
    const looks = [playerLook(0), playerLook(1), playerLook(2), playerLook(3), randomLook('auntie_vendor', 3), randomLook('student_f', 4), randomLook('grandpa', 5), randomLook('sexy_girl_who_screams', 6)];
    looks.forEach((lk, r) => variants.forEach((v, c) => {
      const e = this.add(lk, new THREE.Vector3((c - 2.5) * 0.42, 0, r * 0.6), Math.PI, 'idle', undefined, undefined, 'high');
      e.rig.setFace(v);
      (e.rig as any).fidgetWait = 1e9;
    }));
    this.camera.position.set(0, 2.6, -1.4);
    this.camTarget.set(0, 1.6, 2.2);
    this.camera.position.set(0, 1.62, 4.6 + 4);
    this.camTarget.set(0, 1.5, 0);
  }

  private hairs() {
    const ids = HAIRS.map((h) => h.id);
    ids.forEach((h, i) => {
      const lk = randomLook(i % 2 ? 'office_worker_f' : 'office_worker_m', 30 + i);
      lk.hair = { style: h, color: ['#141110', '#2a1d16', '#5c2c1c', '#8f8b86'][i % 4] };
      lk.acc = [];
      const col = i % 9, row = Math.floor(i / 9);
      const e = this.add(lk, new THREE.Vector3((col - 4) * 0.62, 0, row * 1.2), Math.PI, 'idle', h, undefined, 'high');
      (e.rig as any).fidgetWait = 1e9;
    });
    this.camera.position.set(0, 2.0, 5.2);
    this.camTarget.set(0, 1.45, 0.6);
  }

  private clothes() {
    const tops = TOPS.map((t) => t.id), bots = BOTTOMS.map((b) => b.id);
    const n = Math.max(tops.length, bots.length);
    for (let i = 0; i < n; i++) {
      const lk = randomLook(i % 3 === 1 ? 'office_worker_f' : 'office_worker_m', 50 + i);
      lk.top = { id: tops[i % tops.length] };
      lk.bottom = { id: bots[i % bots.length] };
      lk.acc = [];
      const col = i % 11, row = Math.floor(i / 11);
      this.add(lk, new THREE.Vector3((col - 5) * 0.95, 0, row * 1.6), Math.PI, 'idle', tops[i % tops.length], bots[i % bots.length]);
    }
    this.camera.position.set(0, 3.0, 9.5);
    this.camTarget.set(0, 0.9, 1.4);
  }

  private crowd() {
    const n = +(params.get('n') ?? 80);
    const ids = Object.keys(ARCHETYPES);
    for (let i = 0; i < n; i++) {
      const lk = randomLook(ids[i % ids.length], 100 + i);
      const r = 3 + (i % 7) * 1.6, a = (i / n) * Math.PI * 2;
      const e = this.add(lk, new THREE.Vector3(Math.cos(a) * r, 0, 8 + Math.sin(a) * r), 0, 'walk');
      e.walk = { r, a, sp: (0.9 + (i % 5) * 0.25) * (i % 2 ? 1 : -1), c: new THREE.Vector3(0, 0, 8) };
    }
    this.camera.position.set(0, 7, 24);
    this.camTarget.set(0, 0.8, 7);
  }

  private tpose() {
    const me = this.add(playerLook(0), new THREE.Vector3(0, 0, 2), Math.PI, 'tpose', undefined, undefined, 'high');
    me.rig.setFace('neutral');
    const girl = this.add(randomLook('sexy_girl_who_screams', 9), new THREE.Vector3(-3, 0, 3), -Math.PI / 2, 'scream_run', undefined, undefined, 'high');
    girl.walk = { r: 0, a: 0, sp: 3.6, c: new THREE.Vector3() };
    this.camera.position.set(0.3, 1.5, 6.2);
    this.camTarget.set(0, 1.1, 2);
  }

  // ---------------------------------------------------------------- controls

  private cycleAll = params.has('cycle');
  setAnim(a: AnimName) { for (const e of this.entries) { e.anim = a; e.rig.play(a, { loop: true }); } }
  setFace(f: FaceVariant) { for (const e of this.entries) e.rig.setFace(f); }
  focus(i: number, d = 2.2) {
    const e = this.entries[i];
    if (!e) return;
    const p = e.rig.root.position;
    this.camera.position.set(p.x, 1.55 * (e.rig.height / 1.7), p.z + d);
    this.camTarget.set(p.x, 1.45 * (e.rig.height / 1.7), p.z);
    this.camera.lookAt(this.camTarget);
  }

  update(dt: number) {
    this.t += dt;
    RigWorld.cam.copy(this.camera.position);
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.walk) {
        const w = e.walk;
        if (w.r > 0) {
          w.a += (w.sp / w.r) * dt;
          e.rig.root.position.set(w.c.x + Math.cos(w.a) * w.r, 0, w.c.z + Math.sin(w.a) * w.r);
          const tx = -Math.sin(w.a) * Math.sign(w.sp), tz = Math.cos(w.a) * Math.sign(w.sp);
          e.rig.root.rotation.y = Math.atan2(-tx, -tz);
          e.rig.setMove(Math.abs(w.sp));
        } else {
          // tpose lab: the girl runs past screaming, then loops
          const x = -3 + ((this.t * w.sp) % 12);
          e.rig.root.position.set(x, 0, 3.2);
          e.rig.root.rotation.y = -Math.PI / 2;
          e.rig.setMove(w.sp);
          const me = this.entries[0];
          if (me !== e) e.rig.lookAt(me.rig.headWorld(new THREE.Vector3()));
        }
      }
      if (this.cycleAll && !params.get('anim')) {
        const slot = Math.floor((this.t + i * 1.7) / 4.5);
        const a = ANIM_NAMES[(slot + i * 3) % ANIM_NAMES.length];
        if (a !== e.anim) { e.anim = a; e.rig.play(a, { loop: true }); }
      }
      e.rig.update(dt);
    }
    // let the camera follow nothing; keep sun shadows around the lineup
    this.sun.target.position.copy(this.camTarget);
    this.sun.position.copy(this.camTarget).add(new THREE.Vector3(-6, 14, 9));
    this.camera.lookAt(this.camTarget);
  }

  exit() {
    for (const e of this.entries) { e.rig.dispose(); e.label?.material.map?.dispose(); }
    this.entries = [];
    this.scene.environment?.dispose();
    delete (window as any).__charlab;
  }
}
