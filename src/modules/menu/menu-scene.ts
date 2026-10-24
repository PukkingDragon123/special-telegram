import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { SceneDef } from '../../game/scenes';
import type { CharacterRig, Look } from '../../game/contracts';
import { Session, NetKind } from '../../net/session';
import { Assets } from '../../core/assets';
import { Sound } from '../../core/audio';
import { Input } from '../../core/input';
import { params, disposeObject, damp, asset } from '../../core/util';
import { F } from '../../core/fonts';
import { ALBUM_CAM, SLOTS, buildBackdrop, buildRug, buildSofa, buildTable, buildJenga, buildPanton, buildShellChair, buildLights, JENGA_COLORS, Jenga } from './album';
import { StickerUI, Sticker, plateCanvas, preloadUi } from './ui';
import { COVER, DANGER, GOLD, DISABLED, HOVER, LetterStyle, albumText, loadImg, mulberry } from './lettering';
import { sfx, musicKey } from './sfx';
import { loadSettings, saveSettings, applySettings, QUALITIES } from './settings';
import { CustomizeView } from './customize';

/* ============================================================================================
 * 'menu' scene: the album cover (ref4) as a live 3D set + the lobby as album-print stickers.
 * The four guys are the four player slots (slot i ↔ G(i+1), matches characters.playerLook(i)).
 * Empty slots are dark silhouettes; when a friend joins he pops in (confetti + sax jingle).
 * Click your own guy (bobbing arrow "คุณ") → customize (street + fashion magazine, customize.ts).
 * ========================================================================================== */

let devParamsDone = false;
const CODE_ALPHABET = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

interface SlotView {
  i: number;
  root: THREE.Group;
  rig: CharacterRig | null;
  lookKey: string;
  pid: number | null;
  occupied: boolean;
  tag: Sticker | null;
  tagKey: string;
  ready: Sticker | null;
  pop: number;
  block?: THREE.Mesh;
}

interface Bit { m: THREE.Matrix4; p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; av: THREE.Vector3; life: number; s: number }

export class MenuScene implements SceneDef {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(ALBUM_CAM.fov, innerWidth / innerHeight, 0.05, 60);
  private refCam = new THREE.PerspectiveCamera(ALBUM_CAM.fov, innerWidth / innerHeight, 0.05, 60);
  ui!: StickerUI;
  private mode: 'album' | 'customize' = 'album';
  custom: CustomizeView | null = null;
  private backdrop!: ReturnType<typeof buildBackdrop>;
  private jenga!: Jenga;
  private slots: SlotView[] = [];
  private arrow!: THREE.Group;
  private arrowTag: Sticker | null = null;
  private t = 0;
  private offs: (() => void)[] = [];
  private stickers: Record<string, Sticker | null> = {};
  private uiKey = '';
  private sub: 'main' | 'host' | 'join' | 'settings' | 'busy' = 'main';
  private code = '';
  private typing: { close(): void } | null = null;
  private busy = false;
  private hoverMe = 0;
  private push = 0; private pushTarget = 0;
  private shake = 0;
  private confetti!: THREE.InstancedMesh;
  private bits: Bit[] = [];
  private starting = false;
  private envTex: THREE.Texture | null = null;
  private raycaster = new THREE.Raycaster();
  private nameEdit: { close(): void } | null = null;
  private nameDraft = '';
  private firstSync = true;
  private settings = loadSettings();
  private customizeOnEnter = false;

  constructor(private game: Game, startMode: 'album' | 'customize' = 'album') {
    this.customizeOnEnter = startMode === 'customize';
  }

  // ------------------------------------------------------------------ lifecycle

  async enter() {
    const game = this.game;
    this.scene.name = 'menu_album';
    this.scene.background = new THREE.Color(0x14110a);
    this.scene.add(this.camera);
    this.setupCamera();
    this.ui = new StickerUI();
    preloadUi(['btn_host', 'btn_join', 'btn_start', 'btn_quit', 'btn_customize', 'title_hiaphat', 'tagline_roi_baht_sang_tua', 'label_waiting_friend', 'plate_room_code', 'plate_player_name']);
    // ---- set
    this.backdrop = buildBackdrop(this.refCam);
    this.scene.add(this.backdrop.mesh);
    this.scene.add(buildRug());
    this.scene.add(buildSofa());
    this.scene.add(buildTable());
    this.jenga = buildJenga();
    this.scene.add(this.jenga.group);
    const panton = buildPanton();
    panton.position.copy(SLOTS[0].pos).add(new THREE.Vector3(0.02, 0, 0.06));
    panton.rotation.y = SLOTS[0].yaw + Math.PI;
    this.scene.add(panton);
    const shell = buildShellChair();
    shell.position.copy(SLOTS[3].pos).add(new THREE.Vector3(0.04, 0, 0.0));
    shell.rotation.y = SLOTS[3].yaw + Math.PI;
    this.scene.add(shell);
    buildLights(this.scene);
    this.loadEnv();
    // ---- confetti (paper bits in Jenga colours)
    const cg = new THREE.PlaneGeometry(0.03, 0.018);
    this.confetti = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8, map: Assets.texture('gen/menu/paper_backdrop.jpg', { srgb: true }) }), 160);
    this.confetti.count = 0;
    this.confetti.frustumCulled = false;
    this.scene.add(this.confetti);
    // ---- the four guys
    for (let i = 0; i < 4; i++) {
      const root = new THREE.Group();
      root.position.copy(SLOTS[i].pos);
      root.rotation.y = SLOTS[i].yaw;
      root.name = 'slot' + i;
      this.scene.add(root);
      this.slots.push({ i, root, rig: null, lookKey: '', pid: null, occupied: false, tag: null, tagKey: '', ready: null, pop: 0 });
    }
    this.arrow = makeArrow();
    this.scene.add(this.arrow);
    // ---- view & post
    game.engine.setView(this.scene, this.camera);
    game.ui.setScene(this.scene, this.camera);
    const post = game.engine.post;
    post.setLook('album', 1);
    post.setDOF(false);
    post.fade = 0;
    post.bloom.intensity = 0.6;
    Input.setWantLock(false);
    // ---- static stickers
    this.stickers.title = this.ui.add({ img: 'title_hiaphat', imgVariants: false, anchor: 'b', x: 0, y: 178, width: 500, passive: true, delay: 0.25, z: 2 });
    this.stickers.tagline = this.ui.add({ img: 'tagline_roi_baht_sang_tua', imgVariants: false, anchor: 'b', x: 0, y: 62, width: 250, passive: true, delay: 0.55, tilt: -1.5, z: 2 });
    // ---- input
    const cv = game.engine.canvas;
    const onMove = () => this.pick();
    const onDown = (e: PointerEvent) => { if (e.button === 0) this.click(); };
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerdown', onDown);
    this.offs.push(() => { cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerdown', onDown); cv.style.cursor = ''; });
    const onKey = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener('keydown', onKey);
    this.offs.push(() => window.removeEventListener('keydown', onKey));
    const onResize = () => this.setupCamera();
    window.addEventListener('resize', onResize);
    this.offs.push(() => window.removeEventListener('resize', onResize));
    // ---- network events
    this.offs.push(game.on('net:full', () => { this.toast('ห้องเต็มแล้ว!', 'room is full (4/4)'); this.toLocal(); }));
    this.offs.push(game.on('net:closed', (d: any) => {
      if (game.session.kind === 'local' || this.game.isHost) return;
      const r = d?.reason;
      this.toast(r === 'kicked' ? 'โดนเตะออกจากห้อง' : r === 'host-timeout' ? 'หัวห้องหลุดไปแล้ว' : r === 'host-left' ? 'หัวห้องปิดห้องไปแล้ว' : 'การเชื่อมต่อหลุด', 'disconnected from the room');
      this.toLocal();
    }));
    this.offs.push(game.on('menu:start', () => this.playStart()));
    this.offs.push(game.on('player:joined', () => sfx.join()));
    Sound.music(musicKey('menu'));
    this.devParams();
    if (this.customizeOnEnter) setTimeout(() => this.openCustomize(true), 50);
  }

  private setupCamera() {
    const a = innerWidth / innerHeight;
    // keep ≥ 40° horizontal on narrow screens
    const vfov = a < 1 ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(20.5)) / a)) : ALBUM_CAM.fov;
    for (const c of [this.camera, this.refCam]) {
      c.fov = vfov;
      c.aspect = a;
      c.position.copy(ALBUM_CAM.pos);
      c.lookAt(ALBUM_CAM.look);
      c.updateProjectionMatrix();
    }
    this.backdrop?.updateRef();
  }

  private async loadEnv() {
    try {
      const hdr = await Assets.hdr('hdri/studio_neutral_1k.hdr');
      const pm = new THREE.PMREMGenerator(this.game.engine.renderer);
      this.envTex = pm.fromEquirectangular(hdr).texture;
      pm.dispose();
      hdr.dispose();
      this.scene.environment = this.envTex;
      (this.scene as any).environmentIntensity = 0.35;
    } catch (e) { console.warn('[menu] env', e); }
  }

  private devParams() {
    if (devParamsDone) return;
    devParamsDone = true;
    const game = this.game;
    const net = (params.get('net') as NetKind) || 'peer';
    const next = () => (game.scenes.has('casino') && !params.has('skipintro') ? 'casino' : 'world');
    if (params.get('join')) {
      this.code = params.get('join')!.toUpperCase();
      this.join(net, this.code);
    } else if (params.get('host')) {
      this.host(params.get('host') as NetKind, () => { if (params.has('autostart')) setTimeout(() => game.scenes.request('world'), 300); });
    } else if (params.has('autostart')) {
      setTimeout(() => game.scenes.request(next()), 100);
    } else if (params.has('customize')) {
      setTimeout(() => this.openCustomize(true), 400);
    }
  }

  update(dt: number) {
    const rdt = Math.min(0.05, dt);
    this.t += rdt;
    if (this.mode === 'customize' && this.custom) {
      this.custom.update(rdt);
      this.ui.update(rdt);
      return;
    }
    // ---- camera: slow sway + breath + push-in
    this.push += (this.pushTarget - this.push) * damp(this.pushTarget > this.push ? 5 : 3, rdt);
    const c = this.camera;
    const sway = Math.sin(this.t * (Math.PI * 2 / 7.5)) * THREE.MathUtils.degToRad(0.6);
    const mx = Input.ndc.x * 0.012, my = Input.ndc.y * 0.008;
    c.position.set(ALBUM_CAM.pos.x + mx, ALBUM_CAM.pos.y + my + Math.sin(this.t * 0.8) * 0.004, ALBUM_CAM.pos.z - this.push);
    c.lookAt(ALBUM_CAM.look.x + Math.sin(sway) * 3, ALBUM_CAM.look.y, ALBUM_CAM.look.z);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - rdt * 2.5);
      c.position.x += (Math.random() - 0.5) * this.shake * 0.02;
      c.position.y += (Math.random() - 0.5) * this.shake * 0.02;
    }
    this.backdrop.uniforms.uTime.value = this.t;
    this.backdrop.uniforms.uPulse.value = Math.max(0, this.backdrop.uniforms.uPulse.value - rdt * 1.5);
    // ---- set life
    const nPlayers = this.game.players().length;
    this.jenga.wobble(nPlayers >= 4 ? 1 : 0);
    this.jenga.update(rdt, this.t);
    this.syncSlots();
    for (const s of this.slots) {
      if (!s.rig) continue;
      if (s.pop > 0) {
        s.pop = Math.max(0, s.pop - rdt);
        const k = 1 - s.pop / 0.7;
        const sq = k < 0.25 ? 1 - Math.sin(k / 0.25 * Math.PI) * 0.18 : 1 + Math.sin((k - 0.25) / 0.75 * Math.PI) * 0.12 * (1 - k);
        s.rig.root.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      } else s.rig.root.scale.setScalar(1);
      s.rig.update(rdt);
    }
    this.updateArrow(rdt);
    this.updateBits(rdt);
    this.refreshUI();
    this.ui.update(rdt);
  }

  async exit() {
    this.typing?.close();
    this.nameEdit?.close();
    this.custom?.dispose();
    this.custom = null;
    for (const o of this.offs) o();
    this.offs = [];
    for (const s of this.slots) s.rig?.dispose();
    this.ui.dispose();
    disposeObject(this.scene);
    this.envTex?.dispose();
    const post = this.game.engine.post;
    post.setDOF(false);
    post.fade = 0;
    post.setLook('thaiDay', 1);
  }

  // ------------------------------------------------------------------ slots / characters

  private syncSlots() {
    const game = this.game;
    const ps = game.players();
    const online = game.session.online;
    for (const s of this.slots) {
      const p = ps.find((x) => x.slot === s.i);
      const occ = !!p;
      const look: Look = p?.look ?? game.chars.playerLook(s.i);
      const key = JSON.stringify(look) + '|' + occ;
      if (key !== s.lookKey) {
        const wasOcc = s.occupied;
        const lookChanged = !s.rig || JSON.stringify(s.rig.look) !== JSON.stringify(look);
        if (lookChanged) {
          s.rig?.dispose();
          if (s.rig) s.root.remove(s.rig.root);
          s.rig = game.chars.create(look, { lod: 'high', castShadow: true });
          s.root.add(s.rig.root);
          s.rig.root.position.y = SLOTS[s.i].pose === 'sit' || s.i === 2 || s.i === 3 ? 0 : 0;
          const pose = SLOTS[s.i].pose;
          s.rig.play(pose as any, { loop: true, fade: 0 });
          s.rig.setMove(0);
          if (s.i === 0) {
            // G1 holds a blue block
            const b = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.015, 0.025), new THREE.MeshStandardMaterial({ color: JENGA_COLORS[3], roughness: 0.5, map: Assets.texture('gen/menu/jenga_wood_grain.jpg', { srgb: true }) }));
            b.rotation.set(0.3, 0.6, 0.2);
            s.rig.attach('hand_r').add(b);
            s.block = b;
          }
        }
        s.rig!.setSilhouette(!occ);
        s.occupied = occ;
        s.lookKey = key;
        if (!this.firstSync && occ !== wasOcc) this.popSlot(s, occ);
      }
      s.pid = p?.id ?? null;
      // ---- name tag / waiting label / ready marker
      const isMe = !!p && p.id === game.localPlayerId;
      const hostPeer = game.session.hostId;
      const tagKey = !p ? (online ? 'wait' : 'none') : `${p.name}|${isMe}|${p.peer === hostPeer && online}|${this.nameEdit ? this.nameDraft + '#' : ''}`;
      if (tagKey !== s.tagKey) {
        s.tagKey = tagKey;
        this.ui.remove(s.tag); s.tag = null;
        const follow = () => this.project(this.tagAnchor(s.i));
        if (!p) {
          if (online) s.tag = this.ui.add({ img: 'label_waiting_friend', imgVariants: false, width: 128, follow, passive: true, bob: 2.5, delay: 0.2 });
        } else {
          const lines: any[] = [{ text: this.nameEdit && isMe ? (this.nameDraft || ' ') + '|' : p.name, size: 34, font: F.looped, weight: 900 }];
          if (p.peer === hostPeer && online) lines.push({ text: 'หัวห้อง', size: 18, font: F.looped, weight: 800, gap: -6, band: 0.8, style: GOLD });
          else if (isMe && !this.nameEdit) lines.push({ text: 'แก้ชื่อ ✎', size: 15, font: F.looped, weight: 800, gap: -6, band: 0.7 });
          s.tag = this.ui.add({ lines, follow, passive: !isMe, tilt: (s.i % 2 ? 2 : -2), onClick: isMe ? () => this.editName() : undefined, delay: this.firstSync ? 0.6 + s.i * 0.08 : 0 });
        }
      }
      const rdy = !!p?.ready && online;
      if (rdy !== !!s.ready) {
        if (rdy) s.ready = this.ui.add({ lines: [{ text: 'พร้อม!', size: 26, font: F.looped, weight: 900 }], style: GOLD, follow: () => { const q = this.project(this.tagAnchor(s.i)); return q ? { ...q, y: q.y - 34 * this.ui.u } : null; }, passive: true, tilt: 8, bob: 1.5 });
        else { this.ui.remove(s.ready); s.ready = null; }
      }
    }
    this.firstSync = false;
  }

  /** world point for a slot's name tag */
  private tagAnchor(i: number): THREE.Vector3 {
    const s = this.slots[i];
    const h = s.rig?.height ?? 1.72;
    const P = SLOTS[i].pos;
    switch (i) {
      case 0: return new THREE.Vector3(P.x - 0.12, 1.28, P.z + 0.05);
      case 1: return new THREE.Vector3(P.x - 0.42, 1.12, P.z);
      case 2: return new THREE.Vector3(P.x + 0.05, 1.22, P.z);
      default: return new THREE.Vector3(P.x + 0.12, 1.32 + (h - 1.72) * 0.5, P.z);
    }
  }

  private project(p: THREE.Vector3) {
    const v = p.clone().project(this.camera);
    if (v.z > 1) return { x: -999, y: -999, visible: false };
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, visible: this.mode === 'album' };
  }

  private popSlot(s: SlotView, joined: boolean) {
    s.pop = 0.7;
    const head = new THREE.Vector3(SLOTS[s.i].pos.x, s.i === 1 ? 1.5 : 1.0, SLOTS[s.i].pos.z);
    this.burst(head, joined ? 60 : 24);
    sfx.pop();
    if (joined) this.backdrop.uniforms.uPulse.value = 1;
  }

  private burst(at: THREE.Vector3, n: number) {
    const rnd = Math.random;
    for (let k = 0; k < n && this.bits.length < 160; k++) {
      const v = new THREE.Vector3((rnd() - 0.5) * 2.2, 1.2 + rnd() * 2.2, (rnd() - 0.2) * 1.6);
      this.bits.push({ m: new THREE.Matrix4(), p: at.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3, 0)), v, r: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6), av: new THREE.Vector3((rnd() - 0.5) * 18, (rnd() - 0.5) * 18, (rnd() - 0.5) * 18), life: 2.2 + rnd() * 0.8, s: 0.7 + rnd() * 0.7 });
      this.confetti.setColorAt(this.bits.length - 1, new THREE.Color(JENGA_COLORS[Math.floor(rnd() * JENGA_COLORS.length)]));
    }
    if (this.confetti.instanceColor) this.confetti.instanceColor.needsUpdate = true;
  }

  private updateBits(dt: number) {
    const q = new THREE.Quaternion(), sc = new THREE.Vector3();
    this.bits = this.bits.filter((b) => (b.life -= dt) > 0);
    this.bits.forEach((b, i) => {
      b.v.y -= 3.2 * dt;
      b.v.multiplyScalar(1 - 2.4 * dt);
      b.v.x += Math.sin(this.t * 3 + i) * 0.6 * dt;
      b.p.addScaledVector(b.v, dt);
      if (b.p.y < 0.02) { b.p.y = 0.02; b.v.set(0, 0, 0); b.av.set(0, 0, 0); }
      b.r.x += b.av.x * dt; b.r.y += b.av.y * dt; b.r.z += b.av.z * dt;
      q.setFromEuler(b.r);
      sc.setScalar(b.s * Math.min(1, b.life * 2));
      b.m.compose(b.p, q, sc);
      this.confetti.setMatrixAt(i, b.m);
    });
    this.confetti.count = this.bits.length;
    this.confetti.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ "you" arrow + click yourself

  private mySlot(): SlotView | null {
    const me = this.game.me;
    return me ? this.slots[me.slot] ?? null : null;
  }

  private arrowPos(i: number): THREE.Vector3 {
    const P = SLOTS[i].pos;
    switch (i) {
      case 0: return new THREE.Vector3(P.x + 0.05, 1.5, P.z + 0.05);
      case 1: return new THREE.Vector3(P.x - 0.42, 1.62, P.z + 0.1);
      case 2: return new THREE.Vector3(P.x + 0.02, 1.45, P.z);
      default: return new THREE.Vector3(P.x + 0.1, 1.55, P.z);
    }
  }

  private updateArrow(dt: number) {
    const s = this.mySlot();
    const a = this.arrow;
    a.visible = !!s && !this.starting;
    if (!s) { if (this.arrowTag) { this.ui.remove(this.arrowTag); this.arrowTag = null; } return; }
    this.hoverMe += ((this.hovering ? 1 : 0) - this.hoverMe) * damp(10, dt);
    const base = this.arrowPos(s.i);
    const ph = this.t * (3.0 + this.hoverMe * 3);
    const bob = Math.sin(ph);
    a.position.copy(base).add(new THREE.Vector3(0, bob * 0.035, 0));
    // squash at the bottom of the bob, stretch going up
    const sq = 1 + Math.cos(ph) * 0.08;
    a.scale.set((1 + this.hoverMe * 0.2) / Math.sqrt(sq), (1 + this.hoverMe * 0.2) * sq, 1 + this.hoverMe * 0.2);
    a.rotation.set(0, Math.sin(this.t * 1.3) * 0.5 + this.t * this.hoverMe * 4, Math.sin(this.t * 2.1) * 0.08);
    if (!this.arrowTag) {
      this.arrowTag = this.ui.add({ lines: [{ text: 'คุณ', size: 30, font: F.looped, weight: 900 }], follow: () => { const p = this.project(this.arrow.position.clone().add(new THREE.Vector3(0, 0.15, 0))); return p; }, onClick: () => this.openCustomize(), bob: 0, tilt: -4, delay: 0.9 });
    }
    s.rig?.root.scale.multiplyScalar(1 + this.hoverMe * 0.025);
  }

  private hovering = false;
  private pick() {
    if (this.mode !== 'album' || this.starting) return;
    const s = this.mySlot();
    if (!s?.rig) { this.hovering = false; return; }
    this.raycaster.setFromCamera(new THREE.Vector2(Input.ndc.x, Input.ndc.y), this.camera);
    const hits = this.raycaster.intersectObjects([s.rig.root, this.arrow], true);
    const h = hits.length > 0;
    if (h && !this.hovering) sfx.hover();
    this.hovering = h;
    this.game.engine.canvas.style.cursor = h ? 'pointer' : '';
  }

  private click() {
    if (this.mode !== 'album' || this.starting) return;
    this.pick();
    if (this.hovering) this.openCustomize();
  }

  openCustomize(instant = false) {
    if (this.mode === 'customize' || this.starting) return;
    this.typing?.close(); this.typing = null;
    this.nameEdit?.close(); this.nameEdit = null;
    if (this.sub !== 'main') { this.sub = 'main'; this.uiKey = ''; }
    sfx.whoosh();
    this.mode = 'customize';
    this.hovering = false;
    this.game.engine.canvas.style.cursor = '';
    for (const k of Object.keys(this.stickers)) { this.ui.remove(this.stickers[k]); this.stickers[k] = null; }
    for (const s of this.slots) { this.ui.remove(s.tag); s.tag = null; s.tagKey = ''; this.ui.remove(s.ready); s.ready = null; }
    this.ui.remove(this.arrowTag); this.arrowTag = null;
    this.uiKey = '';
    const post = this.game.engine.post;
    const go = () => {
      this.custom = new CustomizeView(this.game, this.ui, () => this.closeCustomize());
      this.custom.enter();
    };
    if (instant) { go(); return; }
    // push into the character, white-out → cut to the street
    this.pushTarget = 0.9;
    this.game.engine.tween(0.32, (k) => { post.fade = k; }).then(() => { go(); this.pushTarget = 0; this.push = 0; this.game.engine.tween(0.45, (k) => { post.fade = 1 - k; }); });
  }

  closeCustomize() {
    if (this.mode !== 'customize') return;
    const post = this.game.engine.post;
    this.game.engine.tween(0.3, (k) => { post.fade = k; }).then(() => {
      this.custom?.dispose();
      this.custom = null;
      this.mode = 'album';
      this.game.engine.setView(this.scene, this.camera);
      this.game.ui.setScene(this.scene, this.camera);
      post.setLook('album', 1);
      post.setDOF(false);
      Sound.music(musicKey('menu'));
      this.stickers.title = this.ui.add({ img: 'title_hiaphat', imgVariants: false, anchor: 'b', x: 0, y: 178, width: 500, passive: true, delay: 0.15, z: 2 });
      this.stickers.tagline = this.ui.add({ img: 'tagline_roi_baht_sang_tua', imgVariants: false, anchor: 'b', x: 0, y: 62, width: 250, passive: true, delay: 0.3, tilt: -1.5, z: 2 });
      this.uiKey = '';
      for (const s of this.slots) s.lookKey = '';
      const ms = this.mySlot();
      if (ms) { ms.pop = 0.7; this.burst(new THREE.Vector3(SLOTS[ms.i].pos.x, 1.1, SLOTS[ms.i].pos.z), 50); sfx.join(); }
      this.game.engine.tween(0.5, (k) => { post.fade = 1 - k; });
    });
  }

  // ------------------------------------------------------------------ lobby UI

  private uiState() {
    const g = this.game;
    const s = g.session;
    const save = (g as any).save;
    let hasSave = false;
    try { hasSave = !!save?.has?.(); } catch {}
    const me = g.me;
    return `${this.sub}|${s.kind}|${s.isHost}|${s.room}|${hasSave}|${!!me?.ready}|${this.busy}|${g.players().length}`;
  }

  private refreshUI() {
    if (this.starting) return;
    const key = this.uiState();
    if (key === this.uiKey) {
      // live code plate (caret blink)
      if (this.sub === 'join' && this.stickers.code && Math.floor(this.t * 2) !== Math.floor((this.t - 0.02) * 2)) this.stickers.code.repaint();
      return;
    }
    this.uiKey = key;
    const keep = new Set(['title', 'tagline']);
    for (const k of Object.keys(this.stickers)) if (!keep.has(k)) { this.ui.remove(this.stickers[k]); this.stickers[k] = null; }
    const g = this.game, s = g.session;
    const add = (k: string, o: any) => (this.stickers[k] = this.ui.add(o));
    const L = (text: string, en?: string, size = 54): any[] => {
      const a: any[] = [{ text, size, font: F.looped, weight: 900 }];
      if (en) a.push({ text: en, size: Math.round(size * 0.36), font: F.looped, weight: 900, gap: -Math.round(size * 0.14), band: 0.9, spacing: 2 });
      return a;
    };
    const next = () => (g.scenes.has('casino') && !params.has('skipintro') ? 'casino' : 'world');
    // settings (always, top-right)
    if (this.sub !== 'settings') add('settings', { lines: L('ตั้งค่า', 'SETTINGS', 30), anchor: 'tr', x: 92, y: 50, tilt: 3, onClick: () => this.openSettings(), delay: 0.5 });
    if (this.sub === 'settings') { this.buildSettings(add); return; }
    if (this.busy || this.sub === 'busy') {
      add('busy', { lines: L('กำลังต่อเน็ต…', 'CONNECTING', 44), anchor: 'r', x: 200, y: -10, passive: true, bob: 4, tilt: -3 });
      return;
    }
    const save = (g as any).save;
    let hasSave = false;
    try { hasSave = !!save?.has?.(); } catch {}
    if (!s.online) {
      if (this.sub === 'main') {
        add('start', { img: 'btn_start', anchor: 'l', x: 150, y: -60, width: 230, tilt: -4, onClick: () => this.startGame(next()), delay: 0.35 });
        if (hasSave) add('continue', { lines: L('เล่นต่อ', 'CONTINUE', 44), anchor: 'l', x: 150, y: 58, tilt: 3, onClick: () => this.continueGame(), delay: 0.45 });
        add('host', { img: 'btn_host', anchor: 'b', x: -350, y: 72, width: 200, tilt: -3, onClick: () => { this.sub = 'host'; this.uiKey = ''; }, delay: 0.5 });
        add('join', { img: 'btn_join', anchor: 'b', x: 350, y: 72, width: 180, tilt: 3, onClick: () => this.openJoin(), delay: 0.55 });
      } else if (this.sub === 'host') {
        add('h_online', { lines: L('ออนไลน์', 'ONLINE · PEERJS', 46), anchor: 'b', x: -390, y: 150, tilt: -4, onClick: () => this.host('peer') });
        add('h_tabs', { lines: L('หลายแท็บ', 'BROWSER TABS (DEV)', 34), anchor: 'b', x: -300, y: 70, tilt: 2, onClick: () => this.host('tabs') });
        add('h_back', { lines: L('ยกเลิก', 'BACK', 28), anchor: 'b', x: -470, y: 60, tilt: -6, onClick: () => { this.sub = 'main'; this.uiKey = ''; sfx.close(); } });
        add('join', { img: 'btn_join', anchor: 'b', x: 350, y: 72, width: 180, tilt: 3, onClick: () => this.openJoin() });
      } else if (this.sub === 'join') {
        add('code_cap', { lines: L('ใส่รหัสห้องของเพื่อน', 'ENTER YOUR FRIEND’S ROOM CODE', 26), anchor: 'r', x: 200, y: -128, passive: true, tilt: -2 });
        add('code', { paint: () => plateCanvas(this.code, { caret: true, placeholder: '•••••' }), anchor: 'r', x: 200, y: -50, width: 300, tilt: -2, onClick: () => this.focusCode() });
        add('j_go', { lines: L('เข้าเลย!', 'JOIN', 46), anchor: 'r', x: 245, y: 48, tilt: 3, disabled: this.code.length < 4, onClick: () => this.join('peer', this.code) });
        add('j_tabs', { lines: L('แท็บ', 'TABS (DEV)', 26), anchor: 'r', x: 110, y: 52, tilt: -5, disabled: this.code.length < 4, onClick: () => this.join('tabs', this.code) });
        add('j_back', { lines: L('ยกเลิก', 'BACK', 28), anchor: 'r', x: 200, y: 128, tilt: 2, onClick: () => { this.typing?.close(); this.typing = null; this.sub = 'main'; this.uiKey = ''; sfx.close(); } });
        add('host', { img: 'btn_host', anchor: 'b', x: -350, y: 72, width: 200, tilt: -3, onClick: () => { this.typing?.close(); this.typing = null; this.sub = 'host'; this.uiKey = ''; } });
      }
      return;
    }
    // ---- in a room
    add('code_cap', { lines: L(s.isHost ? 'ส่งรหัสนี้ให้เพื่อน' : 'ห้องของเพื่อน', s.isHost ? 'SHARE THIS ROOM CODE' : 'ROOM', 26), anchor: 'r', x: 200, y: -128, passive: true, tilt: -2 });
    add('code', { paint: () => plateCanvas(s.room), anchor: 'r', x: 200, y: -50, width: 300, tilt: -2, onClick: () => this.copyCode() });
    add('code_kind', { lines: L(s.kind === 'tabs' ? 'โหมดแท็บ (ทดสอบ)' : 'ออนไลน์', s.kind === 'tabs' ? 'TABS · DEV' : 'PEERJS', 20), anchor: 'r', x: 200, y: 22, passive: true, tilt: 2 });
    if (s.isHost) {
      const others = g.players().filter((p) => p.id !== g.localPlayerId);
      const allReady = others.every((p) => p.ready);
      add('start', { img: 'btn_start', anchor: 'l', x: 150, y: -60, width: 230, tilt: -4, onClick: () => this.startGame(next()) });
      add('start_cap', { lines: L(others.length === 0 ? 'รอเพื่อนก่อนก็ได้นะ' : allReady ? 'ทุกคนพร้อมแล้ว!' : 'เพื่อนยังไม่พร้อม', others.length === 0 ? 'or start alone' : allReady ? 'everyone is ready' : 'friends not ready yet', 24), style: allReady && others.length ? GOLD : COVER, anchor: 'l', x: 150, y: 30, passive: true, tilt: 2 });
    } else {
      const ready = !!g.me?.ready;
      add('ready', { lines: L(ready ? 'พร้อมแล้ว!' : 'พร้อม?', ready ? 'READY!' : 'CLICK WHEN READY', 50), style: ready ? GOLD : COVER, anchor: 'l', x: 150, y: -60, tilt: -4, onClick: () => { g.intent('menu.ready', { ready: !ready }); sfx.confirm(); } });
      add('wait_cap', { lines: L('รอหัวห้องกดเริ่ม…', 'WAITING FOR THE HOST', 24), anchor: 'l', x: 150, y: 30, passive: true, bob: 2, tilt: 2 });
    }
    add('leave', { img: 'btn_quit', anchor: 'b', x: 350, y: 72, width: 120, tilt: 4, onClick: () => { sfx.close(); this.toLocal(); } });
  }

  private onKey(e: KeyboardEvent) {
    if (this.mode === 'customize') { if (e.key === 'Escape') this.custom?.done(); return; }
    if (e.key === 'Escape') {
      if (this.nameEdit || this.typing) return;
      if (this.sub !== 'main') { this.sub = 'main'; this.uiKey = ''; sfx.close(); if (this.pushTarget) { this.pushTarget = 0; this.game.engine.post.setDOF(false); } }
    }
  }

  private openJoin() {
    this.sub = 'join';
    this.uiKey = '';
    sfx.open();
    this.focusCode();
  }

  private focusCode() {
    this.typing?.close();
    this.typing = this.ui.typeInto({
      value: this.code, max: 6,
      filter: (v) => v.toUpperCase().replace(CODE_ALPHABET, ''),
      onChange: (v) => { const was = this.code.length >= 4; this.code = v; this.stickers.code?.repaint(); if ((v.length >= 4) !== was) this.uiKey = ''; },
      onSubmit: (v) => { this.typing = null; if (v.length >= 4 && this.sub === 'join') this.join('peer', v); },
      onCancel: () => { this.typing = null; this.sub = 'main'; this.uiKey = ''; },
    });
  }

  private copyCode() {
    const room = this.game.session.room;
    try { navigator.clipboard?.writeText(room); } catch {}
    this.toast('คัดลอกรหัสแล้ว!', 'code copied: ' + room, GOLD);
  }

  private editName() {
    if (this.nameEdit) return;
    const me = this.game.me;
    if (!me) return;
    this.nameDraft = me.name;
    sfx.open();
    this.nameEdit = this.ui.typeInto({
      value: me.name, max: 16,
      onChange: (v) => { this.nameDraft = v; },
      onSubmit: (v) => this.commitName(v),
      onCancel: () => { this.nameEdit = null; },
    });
  }

  private commitName(v: string) {
    this.nameEdit = null;
    const name = v.trim().slice(0, 16);
    if (!name) return;
    this.game.profile.name = name;
    this.game.saveProfile();
    this.game.intent('menu.setName', { name });
    sfx.confirm();
  }

  // ------------------------------------------------------------------ settings

  private openSettings() {
    this.sub = 'settings';
    this.uiKey = '';
    sfx.open();
    this.pushTarget = 0.35;
    this.game.engine.post.setDOF(true, 2.3, 4);
  }

  private closeSettings() {
    this.sub = 'main';
    this.uiKey = '';
    sfx.close();
    this.pushTarget = 0;
    this.game.engine.post.setDOF(false);
    saveSettings(this.settings);
  }

  private buildSettings(add: (k: string, o: any) => Sticker) {
    const L = (text: string, en?: string, size = 40): any[] => {
      const a: any[] = [{ text, size, font: F.looped, weight: 900 }];
      if (en) a.push({ text: en, size: Math.round(size * 0.38), font: F.looped, weight: 900, gap: -Math.round(size * 0.14), band: 0.9, spacing: 2 });
      return a;
    };
    const g = this.game;
    add('s_title', { lines: L('ตั้งค่า', 'SETTINGS', 70), anchor: 'c', x: 0, y: -250, passive: true, tilt: -2 });
    add('s_q', { lines: L('ความสวยของภาพ', 'GRAPHICS QUALITY', 30), anchor: 'c', x: 0, y: -165, passive: true });
    QUALITIES.forEach((q, i) => {
      const on = g.engine.quality === q.q;
      add('s_q' + i, { lines: L(q.th, q.en, 34), style: on ? GOLD : COVER, anchor: 'c', x: (i - 1.5) * 165, y: -100, tilt: (i % 2 ? 3 : -3), onClick: () => { g.engine.setQuality(q.q); this.uiKey = ''; sfx.play('menu_toggle'); } });
    });
    const meter = (key: string, label: string, en: string, y: number, val: number, set: (v: number) => void) => {
      add(key + '_l', { lines: L(label, en, 30), anchor: 'c', x: 0, y, passive: true });
      for (let i = 0; i < 5; i++) {
        const on = val >= (i + 1) / 5 - 0.001;
        add(key + i, { paint: () => blockCanvas(JENGA_COLORS[i], on, i + 1), anchor: 'c', x: (i - 2) * 92, y: y + 60, width: 82, tilt: (i % 2 ? 4 : -4), onClick: () => { set((i + 1) / 5); this.uiKey = ''; sfx.wood(); } });
      }
    };
    meter('s_v', 'ความดังเสียง', 'VOLUME', -15, this.settings.volume, (v) => { this.settings.volume = v; applySettings(this.settings); });
    meter('s_m', 'ความไวเมาส์', 'MOUSE SENSITIVITY', 120, this.settings.sens / 2, (v) => { this.settings.sens = v * 2; applySettings(this.settings); });
    add('s_close', { lines: L('ปิด', 'CLOSE', 44), anchor: 'c', x: 0, y: 285, tilt: 3, onClick: () => this.closeSettings() });
  }

  // ------------------------------------------------------------------ sessions

  private async host(kind: NetKind, after?: () => void) {
    if (this.busy) return;
    this.busy = true;
    this.uiKey = '';
    try {
      const s = await Session.host(kind);
      this.game.setSession(s);
      this.sub = 'main';
      sfx.confirm();
      after?.();
    } catch (e: any) {
      this.toast(...errText(e, true));
    } finally {
      this.busy = false;
      this.uiKey = '';
    }
  }

  private async join(kind: NetKind, code: string) {
    if (this.busy) return;
    if (!code || code.length < 4) { this.toast('ใส่รหัสห้องก่อน', 'enter a room code'); return; }
    this.typing?.close(); this.typing = null;
    this.busy = true;
    this.uiKey = '';
    try {
      const s = await Session.join(kind, code);
      this.game.setSession(s);
      this.sub = 'main';
      sfx.confirm();
    } catch (e: any) {
      this.toast(...errText(e, false));
      this.sub = 'join';
    } finally {
      this.busy = false;
      this.uiKey = '';
    }
  }

  private toLocal() {
    this.game.setSession(Session.local());
    this.sub = 'main';
    this.uiKey = '';
  }

  private toastSt: Sticker | null = null;
  private toastTimer: any = null;
  toast(th: string, en?: string, style: LetterStyle = DANGER) {
    this.ui.remove(this.toastSt);
    clearTimeout(this.toastTimer);
    const lines: any[] = [{ text: th, size: 46, font: F.looped, weight: 900 }];
    if (en) lines.push({ text: en, size: 18, font: F.looped, weight: 900, gap: -6, band: 0.9, spacing: 1 });
    this.toastSt = this.ui.add({ lines, style, anchor: 't', x: 0, y: 92, tilt: -2, passive: true, z: 5 });
    this.toastSt.shake = style === DANGER ? 0.6 : 0;
    if (style === DANGER) sfx.error(); else sfx.confirm();
    const st = this.toastSt;
    this.toastTimer = setTimeout(() => this.ui.remove(st), 3200);
  }

  // ------------------------------------------------------------------ start / continue

  private startGame(scene: string) {
    if (!this.game.isHost || this.starting) return;
    this.game.emit('menu:start', { scene });
    setTimeout(() => this.game.scenes.request(scene), 1500);
  }

  private continueGame() {
    const s = (this.game as any).save;
    try {
      if (s?.continue) { s.continue(); return; }
      s?.load?.();
    } catch (e) { console.error('[menu] continue', e); }
    this.startGame('world');
  }

  /** Every peer: the Jenga tower collapses, sax sting, camera kick → the host switches scenes. */
  private playStart() {
    if (this.starting) return;
    this.starting = true;
    this.typing?.close();
    this.nameEdit?.close();
    this.jenga.collapse();
    sfx.start();
    for (let i = 0; i < 6; i++) setTimeout(() => sfx.wood(), 120 + i * 90 + Math.random() * 60);
    this.shake = 0.8;
    this.pushTarget = 0.5;
    this.backdrop.uniforms.uPulse.value = 1;
    this.burst(new THREE.Vector3(0, 0.6, -2.5), 90);
    for (const k of Object.keys(this.stickers)) if (k !== 'title') { this.ui.remove(this.stickers[k]); this.stickers[k] = null; }
    for (const s of this.slots) { this.ui.remove(s.tag); s.tag = null; this.ui.remove(s.ready); s.ready = null; }
    this.ui.remove(this.arrowTag); this.arrowTag = null;
    if (this.stickers.title) { this.stickers.title.vs += 8; this.stickers.title.vr += 90; }
    this.uiKey = 'starting';
    Sound.music('', 1.2);
  }
}

// ------------------------------------------------------------------ helpers

function errText(e: any, hosting: boolean): [string, string] {
  const m = String(e?.message ?? e ?? '');
  if (m === 'notfound') return ['ไม่เจอห้องนี้!', 'room not found – check the code'];
  if (m === 'timeout') return ['ต่อไม่ติด ลองใหม่อีกที', 'connection timed out'];
  if (m === 'taken') return ['ห้องชนกัน ลองใหม่', 'room code clash, try again'];
  if (/browser/.test(m)) return ['เบราว์เซอร์นี้เล่นออนไลน์ไม่ได้', 'this browser has no WebRTC'];
  if (/network|server|socket|disconnect/.test(m)) return ['เน็ตมีปัญหา', 'network problem: ' + m];
  return [hosting ? 'เปิดห้องไม่ได้' : 'เข้าห้องไม่ได้', m || 'unknown error'];
}

/** 3D "you" arrow: chunky extruded arrow, white face + green band like the cover lettering. */
function makeArrow() {
  const s = new THREE.Shape();
  const w = 0.055, hw = 0.11, h = 0.13, tip = 0.12;
  s.moveTo(-w, h); s.lineTo(w, h); s.lineTo(w, 0); s.lineTo(hw, 0); s.lineTo(0, -tip); s.lineTo(-hw, 0); s.lineTo(-w, 0); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3, curveSegments: 4 });
  geo.translate(0, 0, -0.0175);
  const face = new THREE.MeshStandardMaterial({ color: 0xfbfdf8, roughness: 0.55, emissive: 0xfbfdf8, emissiveIntensity: 0.25 });
  const side = new THREE.MeshStandardMaterial({ color: 0x6cbf4b, roughness: 0.5, emissive: 0x2d5a1e, emissiveIntensity: 0.25 });
  const m = new THREE.Mesh(geo, [face, side]);
  m.castShadow = true;
  // dark green outline (inverted hull)
  const og = geo.clone();
  const outline = new THREE.Mesh(og, new THREE.MeshBasicMaterial({ color: 0x1e3314, side: THREE.BackSide }));
  outline.scale.setScalar(1.09);
  const g = new THREE.Group();
  g.add(m, outline);
  g.name = 'menu_arrow';
  return g;
}

/** Settings meter block: a painted Jenga block (real wood grain photo) – lit when `on`. */
let grainImg: HTMLImageElement | null = null;
loadImg(asset('gen/menu/jenga_wood_grain.jpg')).then((im) => { grainImg = im; });
function blockCanvas(color: string, on: boolean, n: number) {
  const cv = document.createElement('canvas') as any;
  const W = 240, H = 110;
  cv.width = W; cv.height = H; cv.cssW = W / 2; cv.cssH = H / 2;
  const ctx = cv.getContext('2d')!;
  const rnd = mulberry(n * 31);
  ctx.save();
  ctx.translate(6, 8);
  const w = W - 18, h = H - 22;
  // shadow
  ctx.fillStyle = 'rgba(15,26,11,0.85)';
  roundRect(ctx, 6, 8, w, h, 12); ctx.fill();
  // outer edge + band
  ctx.fillStyle = '#1E3314'; roundRect(ctx, -2, -2, w + 4, h + 4, 14); ctx.fill();
  ctx.fillStyle = on ? color : '#8f8a78';
  roundRect(ctx, 0, 0, w, h, 12); ctx.fill();
  if (grainImg) { ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.9; ctx.drawImage(grainImg, rnd() * 200, rnd() * 200, 300, 140, 0, 0, w, h); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
  const gr = ctx.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.0)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = gr; roundRect(ctx, 0, 0, w, h, 12); ctx.fill();
  if (!on) { ctx.fillStyle = 'rgba(20,17,10,0.35)'; roundRect(ctx, 0, 0, w, h, 12); ctx.fill(); }
  ctx.restore();
  return cv;
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export { HOVER, DISABLED, albumText };
