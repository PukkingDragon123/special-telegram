import * as THREE from 'three';
import { weatherSign } from '../world/signfx';
import type { Game } from '../../game/game';
import type { CharacterRig } from '../../game/contracts';
import type { SoundHandle } from '../../core/audio';
import { Assets } from '../../core/assets';
import { F } from '../../core/fonts';
import { lifeTex, loadImage } from './tex';
import { line } from './lines';
import { loop, play } from './sounds';
import type { Life } from './index';
import { libModel } from '../world/lib';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { tl } from '../../core/util';
import { LocalTalkers, type TalkTarget } from '../quests/api';
import { Secrets } from './egg-secrets';

/* ============================================================================================
 * THAI MEME EASTER EGGS & small life (every peer, local):
 *  - หมูเด้ง Moo Deng baby-hippo plush (real sculpted hippo, Moo Deng photo skin) + photo poster
 *    in the 8-Twelve window,
 *  - "สวัสดีวันจันทร์" flower-greeting posters on the poles (real rose photo, weekday colour,
 *    looped Thai font) — the text follows the in-game weekday,
 *  - a lottery stand (real lottery-board photo) with its seller, an amulet stall at the temple,
 *  - an uncle singing karaoke loudly at night, tokay geckos on the walls at night (real model,
 *    "ตุ๊กแก!"), crows on the vacant lot that take off when you come close.
 * The lottery lady (role 'lottery_lady') and the amulet grandpa (role 'amulet_grandpa') are talkable while on
 * duty: registered as quests/api LocalTalkers + interact targets {kind:'talker', data:{key, role, name}}
 * (their dialogues live in src/modules/ritual/talk.ts).
 * ========================================================================================== */

const DAYS = [
  { th: 'วันอาทิตย์', c: '#e0322a' }, { th: 'วันจันทร์', c: '#f2c21a' }, { th: 'วันอังคาร', c: '#f06aa8' }, { th: 'วันพุธ', c: '#3caa4a' },
  { th: 'วันพฤหัสบดี', c: '#f08a22' }, { th: 'วันศุกร์', c: '#3a7ae0' }, { th: 'วันเสาร์', c: '#8a4ac8' },
];

interface Npc { rig: CharacterRig; from: number; to: number; anim: string; lines?: string; talkT: number; pos: THREE.Vector3; talk?: { target: TalkTarget; on: boolean } }

export class Eggs {
  private group: THREE.Group | null = null;
  private npcs: Npc[] = [];
  private karaoke: SoundHandle | null = null;
  private geckos: { obj: THREE.Object3D; mixer: THREE.AnimationMixer; t: number }[] = [];
  private crows: { obj: THREE.Object3D; mixer: THREE.AnimationMixer; act: THREE.AnimationAction | null; home: THREE.Vector3; fly: number }[] = [];
  private posters: { tex: THREE.CanvasTexture; day: number; draw: (d: number) => void }[] = [];
  private night = false;
  private secrets: Secrets | null = null;

  constructor(private game: Game, private life: Life) {}
  init() {}

  async build() {
    const game = this.game;
    if (!game.scene || this.group) return;
    const g = (this.group = new THREE.Group());
    g.name = 'life:eggs';
    game.scene.add(g);
    this.mooDeng(new THREE.Vector3(5.92, 0.95, -5.2));
    this.greetingPoster(new THREE.Vector3(-3.8, 1.75, -35), Math.PI / 2);
    this.greetingPoster(new THREE.Vector3(-3.8, 1.75, -4.2), Math.PI / 2);
    this.greetingPoster(new THREE.Vector3(3.8, 1.75, -51), -Math.PI / 2);
    this.lotteryStand(new THREE.Vector3(-5.2, 0.15, -2.6));
    this.amuletStall(new THREE.Vector3(15.5, 0.15, -155.4));
    this.karaokeUncle(new THREE.Vector3(-7.4, 0.15, -118));
    this.addGecko(new THREE.Vector3(-6.03, 2.7, -40.5), -1);
    this.addGecko(new THREE.Vector3(6.03, 2.4, -88), 1);
    this.addGecko(new THREE.Vector3(-6.03, 3.1, -131), -1);
    this.addCrow(new THREE.Vector3(-18, 0.15, -84));
    this.addCrow(new THREE.Vector3(-16.6, 0.15, -85.3));
    this.addCrow(new THREE.Vector3(38, 0.15, -79));
    // secrets: the baby photo shelf (only if the photo file exists) + the snow-leopard kitten
    this.secrets = new Secrets(game);
    this.secrets.build(g);
  }

  /** a talkable seller by role ('lottery_lady' | 'amulet_grandpa'), for the ritual module */
  talker(role: string): { target: TalkTarget; rig: CharacterRig; pos: THREE.Vector3; on: boolean } | null {
    const n = this.npcs.find((x) => x.talk?.target.role === role);
    return n ? { target: n.talk!.target, rig: n.rig, pos: n.pos, on: n.talk!.on } : null;
  }

  dispose() {
    for (const n of this.npcs) { if (n.talk?.on) { LocalTalkers.remove(n.talk.target.key); this.game.interact.unregister(n.rig.root); } n.rig.dispose(); }
    this.npcs = [];
    this.karaoke?.stop(0.5); this.karaoke = null;
    this.secrets?.dispose(); this.secrets = null;
    this.group?.removeFromParent(); this.group = null;
    this.geckos = []; this.crows = []; this.posters = [];
  }

  // ------------------------------------------------------------------ pieces

  private mooDeng(p: THREE.Vector3) {
    const g = this.group!;
    Assets.glb('gen/life/models/moodeng_plush.glb').then((gl: any) => {
      const m = gl.scene.clone(true);
      // plush: soft wet-grey/pink baby-hippo skin from a real Moo Deng photo, chubby squash
      const skin = lifeTex('moodeng_skin.jpg', { fallback: '#8a7a80' });
      m.traverse((o: any) => { if (o.isMesh) { o.material = new THREE.MeshStandardMaterial({ map: skin, color: '#e8d0d6', roughness: 0.95 }); o.castShadow = true; } });
      m.scale.set(1.15, 0.95, 1.0);
      m.position.copy(p);
      m.rotation.y = -Math.PI / 2 + 0.4;
      g.add(m);
    }).catch(() => {});
    // the photo poster above it (real photo + looped-font caption)
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 640;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    loadImage('moodeng_photo.jpg').then((im) => {
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = '#fff6f0'; ctx.fillRect(0, 0, 512, 640);
      if (im) ctx.drawImage(im, 20, 20, 472, 350);
      ctx.fillStyle = '#d23a6a'; ctx.font = `700 92px ${F.bubbly}`; ctx.textAlign = 'center'; ctx.fillText('หมูเด้ง', 256, 470);
      ctx.fillStyle = '#3a2a2a'; ctx.font = `600 38px ${F.ui}`; ctx.fillText('ตุ๊กตามาใหม่! เด้งดึ๋ง', 256, 530);
      ctx.font = `500 30px ${F.body}`; ctx.fillText('Moo Deng plush · 199.-', 256, 580);
      tex.needsUpdate = true;
    });
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.52), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    poster.position.set(p.x - 0.01, p.y + 0.62, p.z - 0.55);
    poster.rotation.y = -Math.PI / 2;
    g.add(poster);
  }

  private greetingPoster(p: THREE.Vector3, yaw: number) {
    const cv = document.createElement('canvas'); cv.width = 384; cv.height = 512;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    let rose: HTMLImageElement | null = null;
    const draw = (day: number) => {
      const d = DAYS[day % 7];
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = d.c; ctx.fillRect(0, 0, 384, 512);
      if (rose) {
        ctx.save();
        ctx.globalAlpha = 0.95; ctx.drawImage(rose, 12, 60, 360, 360);
        // weekday tint over the (real) yellow rose — Thai colour of the day
        ctx.globalCompositeOperation = 'color'; ctx.globalAlpha = day % 7 === 1 ? 0 : 0.55; ctx.fillStyle = d.c; ctx.fillRect(12, 60, 360, 360);
        ctx.restore();
      }
      ctx.textAlign = 'center';
      ctx.lineWidth = 10; ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#c81e5a';
      ctx.font = `700 64px ${F.fancy}`;
      ctx.strokeText('สวัสดี', 192, 70); ctx.fillText('สวัสดี', 192, 70);
      ctx.font = `700 60px ${F.fancy}`;
      ctx.strokeText(d.th, 192, 470); ctx.fillText(d.th, 192, 470);
      ctx.font = `600 26px ${F.hand}`; ctx.fillStyle = '#2a1a1a'; ctx.lineWidth = 6; ctx.strokeText('ขอให้มีความสุขมากๆ นะคะ', 192, 500); ctx.fillText('ขอให้มีความสุขมากๆ นะคะ', 192, 500);
      weatherSign(ctx, 384, 512, { seed: day + 3, surface: 'paper', wear: 0.5 });
      tex.needsUpdate = true;
    };
    loadImage('rose_yellow.jpg').then((im) => { rose = im; draw(this.weekday()); });
    draw(this.weekday());
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.56), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }));
    m.position.copy(p);
    m.rotation.y = yaw;
    m.rotation.z = (Math.random() - 0.5) * 0.06;
    this.group!.add(m);
    this.posters.push({ tex, day: this.weekday(), draw });
  }
  private weekday() { return ((this.game.g.day ?? 1) % 7); } // day 1 = Monday

  /** the library Thai stainless table (real model) with a display board on top (real photo: lottery sheets /
   *  amulets under glass). `tilt` leans the board toward the customer like real lottery stands. */
  private table(p: THREE.Vector3, topTex: string, tilt = 0, glass = false) {
    const g = new THREE.Group();
    g.add(libModel('thai_table_steel'));
    const photo = new THREE.MeshStandardMaterial({ map: lifeTex(topTex, { fallback: '#c8c0b0', clamp: true }), roughness: glass ? 0.25 : 0.7 });
    const edge = new THREE.MeshStandardMaterial({ color: glass ? '#8a6a3a' : '#2a3a5a', roughness: 0.5, metalness: glass ? 0.3 : 0.1 });
    const board = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.02, 0.54, 2, 0.006), [edge, edge, photo, edge, edge, edge]);
    board.position.set(0, 0.735 + (tilt ? 0.07 : 0), 0);
    board.rotation.x = tilt;
    board.castShadow = true; board.receiveShadow = true;
    g.add(board);
    if (tilt) {
      // the prop block that tilts the board (a folded towel on a crate edge)
      const prop = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.1, 0.06, 2, 0.02), new THREE.MeshStandardMaterial({ color: '#c84a3a', roughness: 0.95 }));
      prop.position.set(0, 0.77, -0.22); g.add(prop);
    }
    if (glass) {
      // glass display case over the amulets
      const gl = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.1, 0.54, 2, 0.008), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, transmission: 0.0, transparent: true, opacity: 0.18, metalness: 0 }));
      gl.position.set(0, 0.8, 0); g.add(gl);
    }
    g.position.copy(p);
    this.group!.add(g);
    return g;
  }

  private seller(arch: string, p: THREE.Vector3, yaw: number, anim: string, from: number, to: number, lines?: string) {
    try {
      const rig = this.game.chars.create(this.game.chars.randomLook(arch, Math.floor(p.x * 31 + p.z * 7)), { lod: 'low', castShadow: true });
      rig.root.position.copy(p); rig.root.rotation.y = yaw;
      this.group!.add(rig.root);
      try { rig.play(anim as any, { loop: true }); } catch {}
      this.npcs.push({ rig, from, to, anim, lines, talkT: 0, pos: p.clone() });
      // sitting sellers get a real red plastic stool under them (library model), a little behind the pelvis
      if (anim === 'sit') {
        const st = libModel('thai_stool');
        st.position.set(p.x + Math.sin(yaw) * 0.08, p.y, p.z + Math.cos(yaw) * 0.08);
        st.rotation.y = yaw + 0.3;
        this.group!.add(st);
      }
      return rig;
    } catch { return null; }
  }

  private lotteryStand(p: THREE.Vector3) {
    const t = this.table(p, 'lottery_board.jpg', -0.25);
    t.rotation.y = Math.PI / 2;
    this.seller('old_lady', new THREE.Vector3(p.x - 0.75, p.y, p.z), -Math.PI / 2, 'sit', 7.5, 18.5, 'lottery');
    this.makeTalkable('egg:lottery', 'lottery_lady', tl('ป้าสมพร คนขายหวย', 'Auntie Somporn, lottery seller'));
  }
  private amuletStall(p: THREE.Vector3) {
    this.table(p, 'amulet_table.jpg', 0, true);
    this.seller('grandpa', new THREE.Vector3(p.x, p.y, p.z - 0.75), Math.PI, 'sit', 7, 17);   // behind the table, facing his customers
    this.makeTalkable('egg:amulet', 'amulet_grandpa', tl('ตาเปลี่ยน แผงพระ', 'Grandpa Plian, amulet stall'));
  }

  /** the last seller becomes a talk target (registered only while on duty, see frame()) */
  private makeTalkable(key: string, role: string, name: { th: string; en?: string }) {
    const n = this.npcs[this.npcs.length - 1];
    if (!n) return;
    const rig = n.rig;
    const head = () => { const h = (rig as any).headWorld?.(new THREE.Vector3()); return h ?? n.pos.clone().setY(n.pos.y + (n.anim === 'sit' ? 1.25 : 1.65)); };
    const target: TalkTarget = {
      kind: 'local', key, role, name, head,
      act: (anim, face) => { try { if (anim) rig.play(anim as any, { loop: false, onEnd: () => { try { rig.play(n.anim as any, { loop: true }); } catch {} } } as any); if (face) rig.setFace?.(face as any); } catch {} },
    };
    n.talk = { target, on: false };
  }

  private karaokeUncle(p: THREE.Vector3) {
    const rig = this.seller('karaoke_uncle', p, -Math.PI / 2, 'dance', 19, 23.7, 'karaoke');
    if (rig) {
      const mic = handMic();
      mic.rotation.x = Math.PI / 2;
      try { rig.attach('hand_r').add(mic); } catch {}
    }
    // his portable karaoke speaker (real boombox model) on a red plastic stool, with a coiled mic cable
    const spk = libModel('boombox');
    spk.position.set(p.x - 0.45, 0.15, p.z + 0.85);
    spk.rotation.y = -Math.PI / 2 + 0.3;
    this.group!.add(spk);
  }

  private addGecko(p: THREE.Vector3, side: number) {
    Assets.glb('gen/life/models/gecko.glb').then((gl: any) => {
      const m = cloneSkinned(gl.scene);
      // stick to the wall: model lies in XZ → rotate so the belly faces the wall
      m.rotation.set(0, 0, side * Math.PI / 2);
      m.rotateX(Math.random() * Math.PI * 2);
      m.position.copy(p);
      m.visible = false;
      this.group?.add(m);
      const mixer = new THREE.AnimationMixer(m);
      const clip = gl.animations[0];
      if (clip) { const a = mixer.clipAction(clip); a.timeScale = 0.4; a.play(); }
      this.geckos.push({ obj: m, mixer, t: Math.random() * 20 });
    }).catch(() => {});
  }

  private addCrow(p: THREE.Vector3) {
    Assets.glb('gen/life/models/crow.glb').then((gl: any) => {
      const m = cloneSkinned(gl.scene);
      m.position.copy(p);
      m.rotation.y = Math.random() * 6.28;
      this.group?.add(m);
      const mixer = new THREE.AnimationMixer(m);
      const clip = gl.animations[0];
      let act: THREE.AnimationAction | null = null;
      if (clip) { act = mixer.clipAction(clip); act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; act.play(); act.paused = true; act.time = 0; }
      this.crows.push({ obj: m, mixer, act, home: p.clone(), fly: 0 });
    }).catch(() => {});
  }

  // ------------------------------------------------------------------ frame

  frame(dt: number) {
    if (!this.group) return;
    this.secrets?.frame(dt);
    const game = this.game;
    const h = game.clock.time;
    const cam = game.camera.getWorldPosition(new THREE.Vector3());
    const night = game.clock.nightFactor > 0.5;
    // posters follow the weekday
    const wd = this.weekday();
    for (const p of this.posters) if (p.day !== wd) { p.day = wd; p.draw(wd); }
    // sellers / uncle by hour
    for (const n of this.npcs) {
      const on = h >= n.from && h <= n.to;
      n.rig.root.visible = on;
      if (n.talk && n.talk.on !== on) {
        n.talk.on = on;
        if (on) { LocalTalkers.add(n.talk.target, n.rig.root); game.interact.register(n.rig.root, { kind: 'talker', data: { key: n.talk.target.key, role: n.talk.target.role, name: n.talk.target.name } }); }
        else { LocalTalkers.remove(n.talk.target.key); game.interact.unregister(n.rig.root); }
      }
      if (!on) continue;
      const d = n.pos.distanceTo(cam);
      if (d < 45) n.rig.update(dt);
      if (n.lines && d < 18 && this.life.clock.t > n.talkT) {
        n.talkT = this.life.clock.t + (n.lines === 'karaoke' ? 7 : 12) + Math.random() * 6;
        game.ui.say(n.pos.clone().setY(n.pos.y + 1.9), line(n.lines), { duration: 3, style: n.lines === 'karaoke' ? 'shout' : 'speech' } as any);
      }
    }
    // karaoke loop (night)
    const kOn = h >= 19 && h <= 23.7;
    if (kOn && !this.karaoke) this.karaoke = loop('amb_karaoke', { pos: new THREE.Vector3(-7.4, 1.5, -118), vol: 0.9, ref: 4, max: 45, pitch: 1.08 });
    if (!kOn && this.karaoke) { this.karaoke.stop(1); this.karaoke = null; }
    // geckos at night, chirping when close
    for (const gk of this.geckos) {
      gk.obj.visible = night;
      if (!night) continue;
      gk.t -= dt;
      if (gk.obj.position.distanceTo(cam) < 30) gk.mixer.update(dt);
      if (gk.t < 0) { gk.t = 25 + Math.random() * 30; if (gk.obj.position.distanceTo(cam) < 25) play('gecko', { pos: gk.obj.position, vol: 0.9, ref: 3, max: 35 }); }
    }
    // crows: take off when someone gets close, come back later
    for (const c of this.crows) {
      c.obj.visible = !night;
      if (night) continue;
      let near = c.obj.position.distanceTo(cam) < 4;
      for (const pl of game.players()) if (pl.p && Math.hypot(pl.p[0] - c.home.x, pl.p[2] - c.home.z) < 4) near = true;
      if (near && c.fly <= 0) { c.fly = 1; if (c.act) { c.act.paused = false; c.act.reset().play(); } play('crow', { pos: c.obj.position, vol: 0.7 }); }
      if (c.fly > 0) {
        c.fly += dt;
        c.obj.position.y += dt * (1.5 + c.fly * 2);
        c.obj.position.x += dt * 3;
        if (c.fly > 9) { c.fly = 0; c.obj.position.copy(c.home); if (c.act) { c.act.reset(); c.act.paused = true; } }
      }
      c.mixer.update(dt);
    }
  }
}

import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

/** a handheld dynamic microphone: lathe body (matte black, tapered), steel mesh-grille ball head, silver ring */
function handMic(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.LatheGeometry([[0.0001, 0], [0.011, 0], [0.013, 0.01], [0.016, 0.09], [0.019, 0.13], [0.0001, 0.13]].map(([x, y]) => new THREE.Vector2(x, y)), 18), new THREE.MeshStandardMaterial({ color: '#1a1a1c', roughness: 0.45, metalness: 0.3 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.0035, 6, 20), new THREE.MeshStandardMaterial({ color: '#c8c8cc', roughness: 0.25, metalness: 0.9 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.13;
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  const c = cv.getContext('2d')!; c.fillStyle = '#9a9aa0'; c.fillRect(0, 0, 64, 64); c.fillStyle = '#2a2a2e';
  for (let y = 0; y < 64; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < 64; x += 4) c.fillRect(x, y, 2, 2);
  const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(6, 3);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.026, 16, 12), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.8 }));
  head.position.y = 0.152;
  g.add(body, ring, head);
  g.traverse((o: any) => { if (o.isMesh) o.castShadow = true; });
  g.position.set(0, -0.04, 0);
  return g;
}
function cloneSkinned(o: THREE.Object3D) { return skClone(o); }
