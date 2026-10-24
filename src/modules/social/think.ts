import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Assets } from '../../core/assets';
import { Input } from '../../core/input';
import { Sound } from '../../core/audio';
import { F } from '../../core/fonts';
import { Ease, clamp, damp, tl } from '../../core/util';
import { G } from '../../sim/physics';
import { ThoughtCloud, dreamGlow } from './cloud';
import { FlyText, FlySlot } from './flytext';
import { Sparkles, headPos, rigOf, GEN } from './fx';
import { SKILLS, SKILL, SkillDef, BRANCH_NAME, BRANCHES, Branch, XpSkill, lvProgress, skillState, totalLevel } from './skills';
import { buildMoney } from './money';
import { lines } from './lines';
import { isPlayer } from './state';

/* ============================================================================================
 * THINK MODE — Tab. Third-person camera swings in front of your character (anim 'think',
 * dumb 'think' face); a big volumetric thought cloud inflates above your head (trailing puffs
 * pop up from the head), and inside it a dreamy skill tree GROWS: curved tapered branches,
 * nodes = spinning real 3D items (game.items.def(kind).build) with soft glows, floating กะเพรา,
 * drifting spatulas, a fried egg UFO, twinkles; DOF + 'dream' grading + dreamy music; skill names
 * & descriptions fly in character by character. Click a glowing node to spend points.
 * Replicated as player.mode 'think' → everyone sees your cloud and can SLAP you out of it.
 *   intent 'think.set' {on}
 * ========================================================================================== */

const CLOUD_UP = 1.42;     // cloud centre above the head
const RX = 1.5, RY = 1.0, RZ = 0.75;

// ------------------------------------------------------------------ item icons

/** Build a spinning icon for a node: first existing item kind wins, else a real-texture fallback. */
function buildIcon(game: Game, kinds: string[]): THREE.Object3D {
  for (const k of kinds) {
    if (k === '__coin10') return buildMoney(10);
    if (k === '__hand') return handIcon();
    if (k === '__cardboard') return cardboardIcon();
    const def = game.items.def(k);
    if (!def) continue;
    try {
      const fake: any = { id: -1, t: 'item', k, data: def.data?.() ?? {}, p: [0, 0, 0] };
      const o = def.build(fake, game);
      try { def.refresh?.(o, fake, game); } catch {}
      return o;
    } catch (e) { console.warn('[social] icon build failed', k, e); }
  }
  return fallbackIcon(kinds[0]);
}

function handIcon() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.2), new THREE.MeshStandardMaterial({ map: Assets.texture(GEN + 'handprint_red.png', { wrap: false }), transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.7 }));
  const g = new THREE.Group(); g.add(m); return g;
}
function cardboardIcon() {
  const t = Assets.texture('textures/props/cardboard_mat_mama.jpg', { wrap: false });
  const box = new THREE.BoxGeometry(0.2, 0.012, 0.2);
  const m = new THREE.Mesh(box, [Assets.pbr('cardboard_worn'), Assets.pbr('cardboard_worn'), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }), Assets.pbr('cardboard_worn'), Assets.pbr('cardboard_worn'), Assets.pbr('cardboard_worn')]);
  m.rotation.x = 0.9;
  const g = new THREE.Group(); g.add(m); return g;
}
/** Only used when the cooking/restaurant modules are not loaded (e.g. ?only=social). Real PBR photo textures. */
function fallbackIcon(kind: string) {
  const g = new THREE.Group();
  const steel = Assets.pbr('stainless_brushed');
  const iron = Assets.pbr('cast_iron_wok');
  const wood = Assets.pbr('wood_teak');
  if (/wok|pan/.test(kind)) {
    const pts = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.02 + 0.17 * Math.sin(t * Math.PI / 2), 0.09 * (1 - Math.cos(t * Math.PI / 2)))); }
    const bowl = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), iron); bowl.material.side = THREE.DoubleSide; g.add(bowl);
  } else if (/cleaver|knife/.test(kind)) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.004), steel); b.position.y = 0.06; g.add(b);
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.1, 8), wood); h.rotation.z = Math.PI / 2; h.position.set(-0.13, 0.08, 0); g.add(h);
  } else if (/plate|bowl|dish|takeaway/.test(kind)) {
    const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(0.08, 0.004), new THREE.Vector2(0.11, 0.02), new THREE.Vector2(0.115, 0.024)];
    g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 24), Assets.pbr('plastic_glossy', { color: 0xf4f0e8 })));
  } else {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.005, 0.11), steel); s.position.set(0, 0.01, 0.06); g.add(s);
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.16, 8), wood); h.rotation.x = Math.PI / 2; h.position.set(0, 0.015, -0.07); g.add(h);
  }
  return g;
}

/** Normalize an object so its largest dimension = size and it's centred on the origin. */
function normalize(o: THREE.Object3D, size: number) {
  const holder = new THREE.Group();
  holder.add(o);
  o.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(o);
  if (b.isEmpty()) return holder;
  const s = b.getSize(new THREE.Vector3());
  const c = b.getCenter(new THREE.Vector3());
  const k = size / Math.max(s.x, s.y, s.z, 1e-4);
  o.position.sub(c).multiplyScalar(1);
  o.position.set(-c.x, -c.y, -c.z);
  holder.scale.setScalar(k);
  const outer = new THREE.Group();
  outer.add(holder);
  return outer;
}

// ------------------------------------------------------------------ tree layout (cloud-local)

const BR_ANG: Record<Exclude<Branch, 'life'>, number> = { cook: -0.92, clean: 0.92, prep: -2.02, serve: 2.02 };
const TRUNK_TOP = new THREE.Vector3(0, -0.12, 0.12);

function nodePos(s: SkillDef): THREE.Vector3 {
  if (s.branch === 'life') {
    if (s.id === 'iron_cheek') return new THREE.Vector3(-0.34, -0.6, 0.2);
    if (s.id === 'tug_strong') return new THREE.Vector3(0.34, -0.6, 0.2);
    return new THREE.Vector3(0, 0.4, 0.05);
  }
  const sign = BR_ANG[s.branch] < 0 ? -1 : 1;
  const r = 0.36 + 0.185 * s.tier;
  const a = BR_ANG[s.branch] - sign * s.tier * 0.06 + Math.sin(s.tier * 1.7) * 0.05;
  return new THREE.Vector3(Math.sin(a) * r * 1.22, Math.cos(a) * r * 0.86 - 0.04, 0.2 - s.tier * 0.045 + Math.sin(s.tier * 2.3) * 0.03);
}

/** tapered tube along a curve, with aT (0..1 along) for grow & glow */
function taperTube(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, seg = 48, rad = 7) {
  const frames = curve.computeFrenetFrames(seg, false);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], at: number[] = [], idx: number[] = [];
  const len = curve.getLength();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const p = curve.getPointAt(t);
    const N = frames.normals[i], B = frames.binormals[i];
    const r = (r0 + (r1 - r0) * t) * (1 + 0.12 * Math.sin(t * 23) * (1 - t));
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * Math.PI * 2;
      const n = new THREE.Vector3().addScaledVector(N, Math.cos(a)).addScaledVector(B, Math.sin(a)).normalize();
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      nor.push(n.x, n.y, n.z);
      uv.push(t * len / 0.25, j / rad);
      at.push(t);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < rad; j++) {
    const a = i * (rad + 1) + j, b = a + rad + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1));
  g.setIndex(idx);
  return g;
}

function branchMaterial() {
  const m = Assets.pbr('bamboo_poles', { color: 0xb8d68a }).clone();
  m.emissive = new THREE.Color(0xffd27a);
  m.emissiveIntensity = 0;
  const u = { uGrow: { value: 0 }, uLit: { value: 0 }, uTime: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aT;\nvarying float vT;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvT = aT;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGrow, uLit, uTime;\nvarying float vT;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vT > uGrow) discard;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n float lit = smoothstep(uLit + 0.02, uLit - 0.02, vT);\n float pulse = 0.5 + 0.5 * sin(vT * 30.0 - uTime * 4.0);\n totalEmissiveRadiance = vec3(1.0, 0.82, 0.45) * (lit * (0.55 + 0.35 * pulse) + smoothstep(uGrow - 0.06, uGrow, vT) * 1.2);');
  };
  m.customProgramCacheKey = () => 'social-branch';
  (m as any).userData.u = u;
  return m;
}

// ------------------------------------------------------------------ twinkles (looping)

const twVert = `attribute vec4 aD; uniform float uTime, uK; varying float vA;
void main(){ vec3 p = position + vec3(sin(uTime*aD.x+aD.y)*0.05, mod(uTime*0.05*aD.z + aD.y, 1.0)*0.4 - 0.2, cos(uTime*aD.x*0.7+aD.y)*0.04);
 vec4 mv = modelViewMatrix * vec4(p,1.0); gl_Position = projectionMatrix*mv;
 float tw = pow(0.5+0.5*sin(uTime*aD.x*3.0+aD.y*7.0), 6.0);
 vA = tw * uK; gl_PointSize = (0.02 + 0.05*tw) * aD.w * 360.0 / max(0.3, -mv.z); }`;
const twFrag = `varying float vA; void main(){ vec2 p = gl_PointCoord*2.0-1.0; float r = length(p);
 float c = exp(-r*r*10.0) + (exp(-abs(p.x)*16.0)*exp(-abs(p.y)*2.5) + exp(-abs(p.y)*16.0)*exp(-abs(p.x)*2.5))*0.6;
 float a = c * vA; gl_FragColor = vec4(vec3(1.0,0.94,0.8)*a*1.5, a); }`;

function twinkles(n: number, rx: number, ry: number, rz: number) {
  const pos = new Float32Array(n * 3), d = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * Math.PI * 2, v = Math.acos(2 * Math.random() - 1), r = Math.cbrt(Math.random());
    pos[i * 3] = Math.cos(u) * Math.sin(v) * rx * r; pos[i * 3 + 1] = Math.cos(v) * ry * r; pos[i * 3 + 2] = Math.abs(Math.sin(u) * Math.sin(v) * rz * r) * 0.8;
    d[i * 4] = 0.5 + Math.random() * 1.5; d[i * 4 + 1] = Math.random() * 10; d[i * 4 + 2] = 0.5 + Math.random(); d[i * 4 + 3] = 0.6 + Math.random() * 0.8;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aD', new THREE.BufferAttribute(d, 4));
  const m = new THREE.ShaderMaterial({ vertexShader: twVert, fragmentShader: twFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uK: { value: 0 } } });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = 25;
  return p;
}

// ------------------------------------------------------------------ floating dream junk (basil, spatulas, egg)

function floaters(game: Game, n: number) {
  const group = new THREE.Group();
  const items: { o: THREE.Object3D; base: THREE.Vector3; sp: THREE.Vector3; ph: number }[] = [];
  const leafTex = Assets.texture('textures/food/basil_sprig_fresh.png', { wrap: false });
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.6, emissive: 0x1a3010, emissiveIntensity: 0.3 });
  const leafGeo = new THREE.PlaneGeometry(0.2, 0.2, 4, 4);
  const lp = leafGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < lp.count; i++) { const x = lp.getX(i), y = lp.getY(i); lp.setZ(i, (x * x + y * y) * 1.2); }
  leafGeo.computeVertexNormals();
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(leafGeo, leafMat);
    const base = new THREE.Vector3((Math.random() - 0.5) * RX * 1.6, (Math.random() - 0.5) * RY * 1.3, 0.1 + Math.random() * 0.35);
    m.scale.setScalar(0.6 + Math.random() * 0.6);
    group.add(m);
    items.push({ o: m, base, sp: new THREE.Vector3(0.3 + Math.random() * 0.5, 0.4 + Math.random() * 0.6, 0.3 + Math.random()), ph: Math.random() * 10 });
  }
  for (const k of [['spatula'], ['spatula'], ['ladle', 'spatula']]) {
    const o = normalize(buildIcon(game, k), 0.3);
    const base = new THREE.Vector3((Math.random() - 0.5) * RX * 1.5, (Math.random() - 0.5) * RY * 1.1, 0.0 + Math.random() * 0.3);
    group.add(o);
    items.push({ o, base, sp: new THREE.Vector3(0.2 + Math.random() * 0.3, 0.3 + Math.random() * 0.3, 0.2), ph: Math.random() * 10 });
  }
  const egg = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshStandardMaterial({ map: Assets.texture('textures/food/egg_fried_runny.png', { wrap: false }), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.4 }));
  group.add(egg);
  items.push({ o: egg, base: new THREE.Vector3(RX * 0.55, RY * 0.62, -0.1), sp: new THREE.Vector3(0.25, 0.2, 0.15), ph: 0 });
  return {
    group,
    update(t: number) {
      for (const it of items) {
        const ph = it.ph + t;
        it.o.position.set(it.base.x + Math.sin(ph * it.sp.x) * 0.12, it.base.y + Math.sin(ph * it.sp.y * 0.7) * 0.1, it.base.z + Math.cos(ph * it.sp.z * 0.5) * 0.06);
        it.o.rotation.set(Math.sin(ph * 0.6) * 1.2, ph * 0.5 * it.sp.z, Math.cos(ph * 0.4) * 0.8);
      }
      egg.rotation.set(-1.1 + Math.sin(t * 0.8) * 0.15, 0, t * 0.6);
    },
  };
}

// ------------------------------------------------------------------ the skill tree inside the cloud

interface NodeV { s: SkillDef; root: THREE.Group; icon: THREE.Object3D; glow: THREE.Mesh; pos: THREE.Vector3; hover: number; bounce: number; shake: number; state: string; appearAt: number }

class SkillTree {
  readonly group = new THREE.Group();
  readonly cloud: ThoughtCloud;
  private nodes: NodeV[] = [];
  private branches = new Map<string, { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; u: any }>();
  private glowBack: THREE.Mesh;
  private tw: THREE.Points;
  private fl: ReturnType<typeof floaters>;
  private info = new FlySlot();
  private labels: { ft: FlyText; key: string; br: string }[] = [];
  private t = 0;
  private grow = 0;
  hovered: NodeV | null = null;
  private thoughtIdx = Math.floor(Math.random() * 100);
  private lastThought = -99;
  private flash: { text: string; t: number } | null = null;

  constructor(private game: Game, private me: Ent) {
    this.cloud = new ThoughtCloud({ rx: RX, ry: RY, rz: RZ, head: new THREE.Vector3(0, -CLOUD_UP + 0.12, 0.25), seed: 7, detail: 5 });
    this.group.add(this.cloud.group);
    this.glowBack = dreamGlow(RX * 2.2, RY * 2.1, 0xffe9f6);
    this.glowBack.position.set(0, 0, -0.35);
    this.group.add(this.glowBack);
    this.tw = twinkles(90, RX * 0.95, RY * 0.9, RZ);
    this.group.add(this.tw);
    this.fl = floaters(game, 12);
    this.group.add(this.fl.group);
    this.fl.group.visible = false;
    // trunk + branches
    const trunk = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -RY * 0.95, 0.12), new THREE.Vector3(0.05, -0.6, 0.14), new THREE.Vector3(-0.03, -0.35, 0.12), TRUNK_TOP]);
    this.addBranch('trunk', trunk, 0.05, 0.034);
    for (const b of BRANCHES) {
      const pts = [TRUNK_TOP.clone(), ...SKILLS.filter((s) => s.branch === b).sort((a, c) => a.tier - c.tier).map(nodePos)];
      const mid = pts[0].clone().lerp(pts[1], 0.5); mid.z += 0.06; mid.y += 0.04;
      pts.splice(1, 0, mid);
      this.addBranch(b, new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4), 0.032, 0.012);
    }
    for (const s of SKILLS.filter((s) => s.branch === 'life')) {
      const p = nodePos(s);
      const from = s.id === 'sleep_well' ? TRUNK_TOP.clone() : new THREE.Vector3(0, p.y + 0.02, 0.12);
      const c = new THREE.CatmullRomCurve3([from, from.clone().lerp(p, 0.5).add(new THREE.Vector3(0, 0.05, 0.04)), p]);
      this.addBranch('life_' + s.id, c, 0.022, 0.01);
    }
    // nodes
    SKILLS.forEach((s) => {
      const root = new THREE.Group();
      const pos = nodePos(s);
      root.position.copy(pos);
      const icon = normalize(buildIcon(game, s.icon), s.branch === 'life' ? 0.17 : 0.2);
      icon.traverse((o: any) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.material = Array.isArray(o.material) ? o.material.map((m: any) => m.clone()) : o.material.clone(); } });
      const glow = dreamGlow(0.46, 0.46, 0xffd88a);
      glow.position.z = -0.05;
      root.add(glow, icon);
      root.scale.setScalar(0.001);
      this.group.add(root);
      const appearAt = 0.55 + (s.branch === 'life' ? 0.2 + s.tier * 0.1 : 0.15 + s.tier * 0.17);
      this.nodes.push({ s, root, icon, glow, pos, hover: 0, bounce: 0, shake: 0, state: '', appearAt });
    });
    this.info.group.position.set(0, RY * 0.73, 0.42);
    this.group.add(this.info.group);
    this.refreshStates(true);
    this.cloud.show(true);
  }

  private addBranch(key: string, curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number) {
    const mat = branchMaterial();
    const mesh = new THREE.Mesh(taperTube(curve, r0, r1), mat);
    mesh.castShadow = false;
    this.group.add(mesh);
    this.branches.set(key, { mesh, mat, u: (mat as any).userData.u });
  }

  refreshStates(force = false) {
    const me = this.game.state.get(this.me.id) ?? this.me;
    for (const n of this.nodes) {
      const st = skillState(me, n.s).st;
      if (st === n.state && !force) continue;
      const prev = n.state;
      n.state = st;
      const owned = st === 'owned', ready = st === 'ready';
      const col = owned ? 0xffe2a0 : ready ? 0xffc75a : st === 'poor' ? 0xbfc6ff : 0x8a93b8;
      (n.glow.material as THREE.ShaderMaterial).uniforms.uCol.value.set(col);
      n.icon.traverse((o: any) => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m.color) continue;
          m.userData.baseColor ??= m.color.clone();
          m.color.copy(m.userData.baseColor).multiplyScalar(owned || ready ? 1 : 0.42);
          if (m.emissive) { m.emissive.set(owned ? 0x302010 : 0x000000); }
        }
      });
      if (prev && owned && prev !== 'owned') n.bounce = 1;
    }
    // branch glow up to the last owned node
    for (const b of BRANCHES) {
      const owned = SKILLS.filter((s) => s.branch === b && me.skills?.includes(s.id)).map((s) => s.tier);
      const lit = owned.length ? (Math.max(...owned) + 1) / 6 + 0.02 : 0;
      const br = this.branches.get(b);
      if (br) br.u.uLit.value = lit;
    }
    for (const s of SKILLS.filter((s) => s.branch === 'life')) {
      const br = this.branches.get('life_' + s.id);
      if (br) br.u.uLit.value = me.skills?.includes(s.id) ? 1.02 : 0;
    }
    const tr = this.branches.get('trunk');
    if (tr) tr.u.uLit.value = (me.skills?.length ?? 0) > 0 ? 1.02 : 0;
    this.makeLabels(me);
  }

  private makeLabels(me: Ent) {
    for (const b of BRANCHES) {
      const p = lvProgress(b as XpSkill, me.xp?.[b] ?? 0);
      const key = `${b}:${p.lv}:${p.cur}`;
      const old = this.labels.find((l) => l.br === b);
      if (old && old.key === key) continue;
      if (old) { old.ft.dispose(); this.labels.splice(this.labels.indexOf(old), 1); }
      const ft = new FlyText([
        { text: `${BRANCH_NAME[b].th}  Lv.${p.lv}`, style: { font: F.bubbly, size: 46, weight: 700, color: '#5a3d1e', stroke: '#fff8ea', strokeWidth: 6 } },
        { text: p.lv >= 15 ? 'MAX' : `${p.cur}/${p.need} xp`, style: { font: F.body, size: 26, weight: 600, color: '#7a6250', stroke: '#fff8ea', strokeWidth: 4 } },
      ], { px: 0.00085, stagger: 0.02, depthTest: false });
      const tip = nodePos(SKILLS.find((s) => s.branch === b && s.tier === 0)!);
      const ang = BR_ANG[b as Exclude<Branch, 'life'>];
      ft.mesh.position.set(tip.x * 0.55 + Math.sign(ang) * 0.02, tip.y * 0.5 + (Math.abs(ang) > 1.5 ? -0.13 : 0.14), 0.32);
      ft.t = -0.9 - BRANCHES.indexOf(b as any) * 0.12;
      this.group.add(ft.mesh);
      this.labels.push({ ft, key, br: b });
    }
  }

  /** returns node under the mouse ray */
  pick(ray: THREE.Ray): NodeV | null {
    let best: NodeV | null = null, bd = Infinity;
    const wp = new THREE.Vector3();
    for (const n of this.nodes) {
      if (n.root.scale.x < 0.5) continue;
      n.root.getWorldPosition(wp);
      const d = ray.distanceSqToPoint(wp);
      const r = 0.14 * this.group.scale.x;
      if (d < r * r) { const t = wp.distanceTo(ray.origin); if (t < bd) { bd = t; best = n; } }
    }
    return best;
  }

  setInfo(n: NodeV | null) {
    const me = this.game.state.get(this.me.id) ?? this.me;
    if (this.flash && this.t - this.flash.t < 1.6) {
      const key = 'flash:' + this.flash.text;
      this.info.set(key, () => new FlyText([{ text: this.flash!.text, style: { font: F.heavy, size: 50, weight: 800, color: '#c0392b', stroke: '#fff7ea', strokeWidth: 7 } }], { px: 0.0009, depthTest: false, stagger: 0.012 }));
      return;
    }
    if (n) {
      const st = skillState(me, n.s);
      const status = st.st === 'owned' ? 'ปลดแล้ว ✓' : st.st === 'ready' ? `คลิกเพื่อปลด · ใช้ ${n.s.cost} แต้ม (มี ${me.sp ?? 0})` : st.why?.th ?? '';
      const key = `node:${n.s.id}:${st.st}:${me.sp}`;
      this.info.set(key, () => new FlyText([
        { text: n.s.name.th, style: { font: F.bubbly, size: 66, weight: 700, color: '#3b2614', stroke: '#fff9ee', strokeWidth: 9, maxWidth: 1500 } },
        { text: n.s.desc.th, style: { font: F.ui, size: 34, weight: 600, color: '#4a3424', stroke: '#fff9ee', strokeWidth: 6, maxWidth: 1300 } },
        { text: `${n.s.name.en} — ${n.s.desc.en}`, style: { font: F.body, size: 24, weight: 500, color: '#6e5a48', stroke: '#fff9ee', strokeWidth: 4, maxWidth: 1400 } },
        { text: status, style: { font: F.ui, size: 30, weight: 700, color: st.st === 'ready' ? '#b36b00' : st.st === 'owned' ? '#3c7d2e' : '#7a5a8a', stroke: '#fff9ee', strokeWidth: 6 } },
      ], { px: 0.00078, depthTest: false, stagger: 0.012, dur: 0.45 }));
      return;
    }
    if (this.t - this.lastThought > 6 || !this.info.key.startsWith('thought')) {
      const ths = lines('skill_tree_thoughts');
      if (this.t - this.lastThought > 6) { this.thoughtIdx++; this.lastThought = this.t; }
      const th = ths[this.thoughtIdx % ths.length];
      const key = `thought:${this.thoughtIdx}:${me.sp ?? 0}`;
      this.info.set(key, () => new FlyText([
        { text: th.th, style: { font: F.hand, size: 52, weight: 400, color: '#4a3424', stroke: '#fff9ee', strokeWidth: 7, maxWidth: 1400 } },
        ...(th.en ? [{ text: th.en, style: { font: F.body, size: 24, weight: 500, color: '#7a6654', stroke: '#fff9ee', strokeWidth: 4 } }] : []),
        { text: `แต้มสกิล ${me.sp ?? 0} แต้ม · เลเวลรวม ${totalLevel(me)}`, style: { font: F.ui, size: 30, weight: 700, color: (me.sp ?? 0) > 0 ? '#b36b00' : '#6e5a48', stroke: '#fff9ee', strokeWidth: 6 } },
      ], { px: 0.00078, depthTest: false, stagger: 0.016 }));
    }
  }

  fail(n: NodeV, why: string) { n.shake = 1; this.flash = { text: why, t: this.t }; }
  celebrate(id: string, sparks: Sparkles) {
    const n = this.nodes.find((x) => x.s.id === id);
    if (!n) return;
    n.bounce = 1;
    const wp = n.root.getWorldPosition(new THREE.Vector3());
    sparks.burst(wp, 70, { color: 0xffe08a, color2: 0xffffff, speed: 1.6 * this.group.scale.x, size: 0.05 * this.group.scale.x, life: 1.1, up: 0.5 });
  }

  close() { this.cloud.show(false); this.info.clear(); for (const l of this.labels) l.ft.leave(); }
  get closed() { return this.cloud.done; }

  update(dt: number, camQ: THREE.Quaternion, night: number) {
    this.t += dt;
    this.cloud.update(dt, night);
    const k = this.cloud.visibleK;
    const closing = (this.cloud as any).target === 0;
    if (!closing) this.grow = Math.min(1, this.grow + dt * (k > 0.45 ? 0.9 : 0));
    else this.grow = Math.max(0, this.grow - dt * 3);
    for (const b of this.branches.values()) { b.u.uGrow.value = Ease.inOutCubic(this.grow) * 1.02; b.u.uTime.value = this.t; b.mesh.visible = this.grow > 0.001; }
    (this.glowBack.material as THREE.ShaderMaterial).uniforms.uK.value = k * 0.55;
    (this.glowBack.material as THREE.ShaderMaterial).uniforms.uTime.value = this.t;
    (this.tw.material as THREE.ShaderMaterial).uniforms.uTime.value = this.t;
    (this.tw.material as THREE.ShaderMaterial).uniforms.uK.value = k;
    this.fl.group.visible = k > 0.6;
    this.fl.update(this.t);
    for (const n of this.nodes) {
      const app = clamp((this.grow - n.appearAt + 0.55) / 0.18);
      const want = closing ? 0 : app;
      n.hover += ((this.hovered === n ? 1 : 0) - n.hover) * damp(12, dt);
      n.bounce = Math.max(0, n.bounce - dt * 1.4);
      n.shake = Math.max(0, n.shake - dt * 2.5);
      const pop = want <= 0 ? 0 : Ease.outBack(want, 2.4);
      const bounce = Math.sin(n.bounce * 14) * n.bounce * 0.35;
      const s = Math.max(0.001, pop * (1 + n.hover * 0.38 + bounce));
      n.root.scale.setScalar(s);
      n.root.position.copy(n.pos);
      n.root.position.y += Math.sin(this.t * 1.3 + n.pos.x * 4) * 0.012;
      n.root.position.x += Math.sin(this.t * 60) * n.shake * 0.02;
      n.root.position.z += n.hover * 0.12;
      const spin = n.state === 'owned' ? 1.1 : n.state === 'ready' ? 0.8 : 0.35;
      n.icon.rotation.set(0.35 + Math.sin(this.t * 0.7 + n.pos.y) * 0.15, this.t * spin + n.pos.x * 3, Math.sin(this.t * 0.5 + n.pos.x) * 0.1);
      const gu = (n.glow.material as THREE.ShaderMaterial).uniforms;
      gu.uTime.value = this.t + n.pos.x * 10;
      const pulse = n.state === 'ready' ? 0.7 + 0.3 * Math.sin(this.t * 4 + n.pos.x * 3) : n.state === 'owned' ? 0.85 : 0.35;
      gu.uK.value = (pulse + n.hover * 0.5) * k;
      n.glow.quaternion.copy(this.group.quaternion).invert().multiply(camQ);
    }
    this.info.update(dt);
    this.info.group.quaternion.copy(this.group.quaternion).invert().multiply(camQ);
    for (const l of this.labels) { l.ft.update(dt); l.ft.mesh.quaternion.copy(this.group.quaternion).invert().multiply(camQ); }
  }

  dispose() {
    this.cloud.dispose();
    this.info.dispose();
    for (const l of this.labels) l.ft.dispose();
    this.group.traverse((o: any) => { if (o.isMesh || o.isPoints) { if (o !== this.cloud.mesh) o.geometry?.dispose?.(); } });
    this.group.removeFromParent();
  }
}

// ------------------------------------------------------------------ remote thinkers (what others see)

class RemoteCloud {
  readonly group = new THREE.Group();
  private cloud: ThoughtCloud;
  private icons: THREE.Object3D[] = [];
  private tw: THREE.Points;
  private t = Math.random() * 10;
  constructor(game: Game) {
    this.cloud = new ThoughtCloud({ rx: RX, ry: RY, rz: RZ, head: new THREE.Vector3(0, -CLOUD_UP + 0.12, 0.25), seed: 7, detail: 3 });
    this.group.add(this.cloud.group);
    for (const k of [['wok'], ['spatula'], ['holy_basil', 'cleaver'], ['plate']]) {
      const o = normalize(buildIcon(game, k), 0.32);
      o.traverse((m: any) => { if (m.isMesh) { m.castShadow = false; } });
      this.group.add(o);
      this.icons.push(o);
    }
    this.tw = twinkles(40, RX * 0.9, RY * 0.85, RZ);
    this.group.add(this.tw);
    this.cloud.show(true);
  }
  close() { this.cloud.show(false); }
  get done() { return this.cloud.done; }
  update(dt: number, night: number) {
    this.t += dt;
    this.cloud.update(dt, night);
    const k = this.cloud.visibleK;
    this.icons.forEach((o, i) => {
      const a = this.t * 0.5 + (i / this.icons.length) * Math.PI * 2;
      o.position.set(Math.cos(a) * RX * 0.45, Math.sin(a * 1.3) * RY * 0.25, 0.2 + Math.sin(a) * 0.15);
      o.rotation.set(0.4, this.t * 1.2 + i, 0);
      o.scale.setScalar(Math.max(0.001, clamp((k - 0.5) * 2)));
    });
    const u = (this.tw.material as THREE.ShaderMaterial).uniforms;
    u.uTime.value = this.t; u.uK.value = k;
  }
  dispose() { this.cloud.dispose(); this.group.traverse((o: any) => { if (o.isPoints) o.geometry.dispose(); }); this.group.removeFromParent(); }
}

// ------------------------------------------------------------------ controller

export function installThink(game: Game, sparks: Sparkles, canStart: () => boolean) {
  game.onIntent('think.set', (pl, d: { on: boolean }) => {
    if (d?.on) {
      if (pl.mode && pl.mode !== 'free') return;
      pl.mode = 'think';
      pl.anim = 'think'; pl.animLoop = true; pl.animT = (pl.animT ?? 0) + 1.001;
      game.emit('social:think', { id: pl.id, on: true });
    } else if (pl.mode === 'think') {
      pl.mode = 'free';
      pl.anim = 'idle'; pl.animLoop = true; pl.animT = (pl.animT ?? 0) + 1.001;
      game.emit('social:think', { id: pl.id, on: false });
    }
  });
  game.on('social:think', (d: { id: number; on: boolean }) => {
    const p = headPos(game, d.id);
    if (p) Sound.play('cloud_poof', { pos: p.add(new THREE.Vector3(0, 0.6, 0)), vol: d.on ? 0.7 : 0.5, pitch: d.on ? 1 : 1.3 });
  });

  let local: {
    tree: SkillTree; t: number; leaving: boolean; camPos: THREE.Vector3; camLook: THREE.Vector3; prevMusic: string; fov0: number; bloom0: number;
    cloudPos: THREE.Vector3; cloudYaw: number; lookK: number; startPos: THREE.Vector3; startQ: THREE.Quaternion;
  } | null = null;
  const remotes = new Map<number, RemoteCloud>();
  const ray = new THREE.Raycaster();
  let lateOff: (() => void) | null = null;

  function start() {
    const me = game.me;
    const pl = game.player;
    if (!me || !pl || !game.scene || local) return;
    if (pl.mode !== 'play' || (me.mode && me.mode !== 'free')) return;
    game.intent('think.set', { on: true });
    const tree = new SkillTree(game, me);
    game.scene.add(tree.group);
    const cam = game.camera;
    const post = game.engine.post;
    local = {
      tree, t: 0, leaving: false, camPos: cam.position.clone(), camLook: new THREE.Vector3(), prevMusic: (Sound as any).musicKey ?? '', fov0: cam.fov, bloom0: post.bloom.intensity,
      cloudPos: new THREE.Vector3(), cloudYaw: pl.yaw, lookK: 0, startPos: cam.position.clone(), startQ: cam.quaternion.clone(),
    };
    pl.setMode('external');
    Sound.music('skill_tree_dreamy', 1.5);
    Sound.play('whoosh_text', { vol: 0.5 });
    const rig = rigOf(game, me.id);
    rig?.setFace?.('think');
    if (!lateOff) lateOff = game.engine.onLate(() => { if (local) game.engine.post.setLook('dream', Math.min(1, local.lookK) * 0.12); });
  }

  function stop(popped = false) {
    if (!local || local.leaving) return;
    local.leaving = true;
    local.t = 0;
    local.tree.close();
    const me = game.me;
    if (me?.mode === 'think') game.intent('think.set', { on: false });
    Sound.music(local.prevMusic || '', 1.0);
    Sound.play(popped ? 'bonk' : 'cloud_poof', { vol: 0.6, pitch: popped ? 1 : 1.2 });
    if (popped) {
      const p = headPos(game, game.localPlayerId);
      if (p) sparks.burst(p.add(new THREE.Vector3(0, CLOUD_UP, 0)), 80, { color: 0xffffff, color2: 0xe8dcff, speed: 3, size: 0.09, life: 0.8 });
    }
  }

  function finish() {
    if (!local) return;
    const pl = game.player;
    const cam = game.camera;
    local.tree.dispose();
    const post = game.engine.post;
    post.setDOF(false);
    (post as any).dof.target = null;
    post.bloom.intensity = local.bloom0;
    cam.fov = local.fov0; cam.updateProjectionMatrix();
    const rig = rigOf(game, game.localPlayerId);
    rig?.setFace?.(null as any);
    if (pl && pl.mode === 'external') pl.setMode('play');
    local = null;
  }

  return {
    get active() { return !!local && !local.leaving; },
    stop,
    onUnlock(d: { id: number; skill: string }) {
      if (!local || d.id !== game.localPlayerId) return;
      local.tree.celebrate(d.skill, sparks);
      Sound.play('level_up_fanfare', { vol: 0.7 });
      Sound.play('sparkle_chime', { vol: 0.7, delay: 0.1 });
    },
    frame(dt: number) {
      const me = game.me;
      const pl = game.player;
      // ---- toggle
      if (pl && me && Input.wasPressed('Tab')) {
        Input.consume('Tab');
        if (local && !local.leaving) stop();
        else if (!local && canStart()) start();
      }
      if (local && !local.leaving && (Input.wasPressed('Escape') || Input.wasPressed('KeyQ'))) stop();
      // knocked out by the host (slap, snatch, bedtime…)
      if (local && !local.leaving && local.t > 1.0 && me && me.mode !== 'think') stop(true);

      // ---- local thinker visuals & camera
      if (local && pl && me) {
        local.t += dt;
        const cam = game.camera;
        const head = headPos(game, me.id) ?? pl.pos.clone().add(new THREE.Vector3(0, 1.75, 0));
        const yaw = local.cloudYaw;
        const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        local.cloudPos.copy(head).add(new THREE.Vector3(0, CLOUD_UP, 0));
        const g = local.tree.group;
        g.position.copy(local.cloudPos);
        g.rotation.set(0, yaw, 0);
        const night = game.clock.nightFactor;
        local.tree.update(dt, cam.quaternion, night);
        // camera: swing from first person to the front-side of the character, slow orbit
        const orbit = Math.sin(local.t * 0.25) * 0.18 + 0.32;
        const dist = 3.75;
        const off = fwd.clone().multiplyScalar(Math.cos(orbit) * dist).addScaledVector(right, Math.sin(orbit) * dist);
        let want = head.clone().add(off).add(new THREE.Vector3(0, 0.55 + Math.sin(local.t * 0.33) * 0.06, 0));
        const look = head.clone().add(new THREE.Vector3(0, 1.0, 0));
        // keep the camera out of walls
        if (game.physics) {
          const dir = want.clone().sub(look);
          const L = dir.length();
          dir.normalize();
          const hit = game.physics.raycast(look, dir, L, G.STATIC);
          if (hit) want = look.clone().addScaledVector(dir, Math.max(1.2, hit.toi - 0.25));
        }
        const inK = local.leaving ? 1 - clamp(local.t / 0.55) : clamp(local.t / 1.1);
        const e = Ease.inOutCubic(inK);
        cam.position.copy(local.startPos).lerp(want, e);
        const qWant = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(want, look, new THREE.Vector3(0, 1, 0)));
        cam.quaternion.copy(local.startQ).slerp(qWant, e);
        const fov = local.fov0 + (52 - local.fov0) * e;
        if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
        cam.updateMatrixWorld();
        local.lookK = e;
        const post = game.engine.post;
        if (!local.leaving && local.t > 0.3) { post.setDOF(true, want.distanceTo(local.cloudPos), 2.2); post.focusOn(local.cloudPos.clone().add(new THREE.Vector3(0, -0.1, 0.3).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw))); }
        post.bloom.intensity = local.bloom0 + 0.25 * e;
        const rig = rigOf(game, me.id);
        if (!local.leaving) rig?.setFace?.('think');
        // ---- hover / click (cursor is free in external mode)
        if (!local.leaving && local.t > 1.0) {
          ray.setFromCamera(new THREE.Vector2(Input.ndc.x, Input.ndc.y), cam);
          const h = local.tree.pick(ray.ray);
          if (h !== local.tree.hovered) { local.tree.hovered = h; if (h) Sound.play('bubble_pop', { vol: 0.3, pitch: 1.5 + Math.random() * 0.3 }); }
          local.tree.setInfo(h);
          if (Input.mousePressed(0)) {
            Input.consumeMouse(0);
            if (h) {
              const st = skillState(game.state.get(me.id) ?? me, h.s);
              if (st.st === 'ready') game.intent('skill.unlock', { id: h.s.id });
              else if (st.st === 'owned') { Sound.play('bubble_pop', { vol: 0.4, pitch: 0.8 }); h.bounce = 0.5; }
              else { Sound.play('wrong_buzz', { vol: 0.5 }); local.tree.fail(h, st.why?.th ?? 'ยังไม่ได้'); }
            }
          }
          local.tree.refreshStates();
        }
        if (local.leaving && local.t > 0.6 && local.tree.closed) finish();
        else if (local.leaving && local.t > 1.6) finish();
      }

      // ---- remote thinkers' clouds
      const seen = new Set<number>();
      for (const p of game.players()) {
        if (p.mode !== 'think' || (local && p.id === game.localPlayerId)) continue;
        if (p.id === game.localPlayerId) continue;
        seen.add(p.id);
        let rc = remotes.get(p.id);
        if (!rc) { rc = new RemoteCloud(game); remotes.set(p.id, rc); game.scene?.add(rc.group); }
        const hp = headPos(game, p.id);
        if (hp) {
          rc.group.position.copy(hp).add(new THREE.Vector3(0, CLOUD_UP * 0.62, 0));
          rc.group.scale.setScalar(0.62);
          const cp = game.camera.getWorldPosition(new THREE.Vector3());
          rc.group.rotation.set(0, Math.atan2(cp.x - rc.group.position.x, cp.z - rc.group.position.z), 0);
        }
        rc.update(dt, game.clock.nightFactor);
        const rig = rigOf(game, p.id);
        rig?.setFace?.('think');
      }
      for (const [id, rc] of remotes) {
        if (seen.has(id)) continue;
        if (!(rc as any)._closing) {
          (rc as any)._closing = true;
          rc.close();
          rigOf(game, id)?.setFace?.(null as any);
          const p = game.state.get(id);
          if (p && p.mode !== 'think') { const hp = headPos(game, id); if (hp) sparks.burst(hp.add(new THREE.Vector3(0, 0.9, 0)), 40, { color: 0xffffff, color2: 0xe8dcff, speed: 2, size: 0.07, life: 0.7 }); }
        }
        rc.update(dt, game.clock.nightFactor);
        if (rc.done || !game.state.get(id)) { rc.dispose(); remotes.delete(id); }
      }
    },
    dispose() {
      if (local) { local.tree.dispose(); local = null; }
      for (const rc of remotes.values()) rc.dispose();
      remotes.clear();
    },
  };
}

export type ThinkCtl = ReturnType<typeof installThink>;
export { tl, isPlayer, SKILL };
