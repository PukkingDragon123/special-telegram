import * as THREE from 'three';
import type { Game } from '../../game/game';
import { Assets } from '../../core/assets';
import { Ease, clamp } from '../../core/util';

/* ============================================================================================
 * Shared local FX for the social module: glint/sparkle bursts (one pooled Points draw call),
 * camera shake + roll applied after the player placed the camera, red hand-print decals on
 * cheeks, sweat drops and small helpers to find a player's rig / head.
 * ========================================================================================== */

export const GEN = 'gen/social/';

// ------------------------------------------------------------------ rig helpers

export function rigOf(game: Game, id: number | null | undefined): any {
  if (id == null) return null;
  return (game.views.of(id).find((v: any) => v.rig) as any)?.rig ?? null;
}

/** World position of a player's/npc's head top (falls back to entity p + 1.75). */
export function headPos(game: Game, id: number, out = new THREE.Vector3()): THREE.Vector3 | null {
  const rig = rigOf(game, id);
  if (rig?.headWorld) return rig.headWorld(out);
  if (rig?.root) { rig.root.getWorldPosition(out); out.y += (rig.height ?? 1.7) + 0.05; return out; }
  const e = game.state.get(id);
  if (!e?.p) return null;
  return out.set(e.p[0], e.p[1] + 1.75, e.p[2]);
}

/** World position of an entity's body (feet), following the view (smooth) when there is one. */
export function bodyPos(game: Game, id: number, out = new THREE.Vector3()): THREE.Vector3 | null {
  if (id === game.localPlayerId && game.player) return out.copy(game.player.pos);
  const o = game.views.objectOf(id);
  if (o) return o.getWorldPosition(out);
  const e = game.state.get(id);
  return e?.p ? out.set(e.p[0], e.p[1], e.p[2]) : null;
}

export function handPos(game: Game, id: number, side: 'r' | 'l' = 'r', out = new THREE.Vector3()): THREE.Vector3 | null {
  const rig = rigOf(game, id);
  if (rig) { rig.attach(side === 'r' ? 'hand_r' : 'hand_l').getWorldPosition(out); if (out.lengthSq() > 0) return out; }
  const b = bodyPos(game, id, out);
  if (b) b.y += 1.1;
  return b;
}

// ------------------------------------------------------------------ sparkles (pooled)

const SPARK_N = 600;
const sparkVert = /* glsl */ `
attribute vec4 aVel;   // xyz velocity, w = size
attribute vec4 aCol;   // rgb, a = birth time
attribute float aLife;
uniform float uTime;
varying vec4 vCol;
varying float vK;
void main() {
  float age = uTime - aCol.a;
  float k = clamp(age / max(aLife, 0.001), 0.0, 1.0);
  vK = (age < 0.0 || age > aLife) ? 2.0 : k;
  vec3 p = position + aVel.xyz * (age - age * age * 0.35) + vec3(0.0, -0.6, 0.0) * age * age * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = aVel.w * (1.0 - k * 0.6) * (0.75 + 0.25 * sin(age * 30.0 + aLife * 40.0));
  gl_PointSize = vK > 1.5 ? 0.0 : s * 320.0 / max(0.2, -mv.z);
  vCol = aCol;
}`;
const sparkFrag = /* glsl */ `
varying vec4 vCol;
varying float vK;
void main() {
  if (vK > 1.5) discard;
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  float core = exp(-r * r * 9.0);
  float cross = exp(-abs(p.x) * 14.0) * exp(-abs(p.y) * 2.2) + exp(-abs(p.y) * 14.0) * exp(-abs(p.x) * 2.2);
  float a = (core + cross * 0.7) * (1.0 - vK) * (1.0 - smoothstep(0.85, 1.0, r));
  gl_FragColor = vec4(vCol.rgb * a * 1.6, a);
}`;

export class Sparkles {
  readonly points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array(SPARK_N * 3);
  private vel = new Float32Array(SPARK_N * 4);
  private col = new Float32Array(SPARK_N * 4);
  private life = new Float32Array(SPARK_N);
  private head = 0;
  private mat: THREE.ShaderMaterial;
  time = 0;

  constructor() {
    for (let i = 0; i < SPARK_N; i++) this.col[i * 4 + 3] = -100;
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aVel', new THREE.BufferAttribute(this.vel, 4));
    this.geo.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: sparkVert, fragmentShader: sparkFrag, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 } },
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    this.points.name = 'social-sparkles';
  }

  burst(p: THREE.Vector3, n = 30, o: { color?: THREE.ColorRepresentation; color2?: THREE.ColorRepresentation; speed?: number; size?: number; life?: number; up?: number; spread?: THREE.Vector3 } = {}) {
    const c1 = new THREE.Color(o.color ?? 0xffe9a0), c2 = new THREE.Color(o.color2 ?? 0xffffff);
    const sp = o.speed ?? 1.6, size = o.size ?? 0.05, life = o.life ?? 0.9, up = o.up ?? 0.8;
    for (let k = 0; k < n; k++) {
      const i = this.head; this.head = (this.head + 1) % SPARK_N;
      const s = o.spread;
      this.pos[i * 3] = p.x + (s ? (Math.random() - 0.5) * s.x : 0);
      this.pos[i * 3 + 1] = p.y + (s ? (Math.random() - 0.5) * s.y : 0);
      this.pos[i * 3 + 2] = p.z + (s ? (Math.random() - 0.5) * s.z : 0);
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const v = sp * (0.35 + Math.random() * 0.65);
      this.vel[i * 4] = Math.cos(a) * r * v;
      this.vel[i * 4 + 1] = u * v + up;
      this.vel[i * 4 + 2] = Math.sin(a) * r * v;
      this.vel[i * 4 + 3] = size * (0.5 + Math.random());
      const c = c1.clone().lerp(c2, Math.random());
      this.col[i * 4] = c.r; this.col[i * 4 + 1] = c.g; this.col[i * 4 + 2] = c.b;
      this.col[i * 4 + 3] = this.time + Math.random() * 0.08;
      this.life[i] = life * (0.6 + Math.random() * 0.6);
    }
    for (const k of ['position', 'aVel', 'aCol', 'aLife']) (this.geo.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
  }

  update(dt: number) {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
  }
}

// ------------------------------------------------------------------ camera shake (local)

interface Shake { t: number; dur: number; amp: number; roll: number; freq: number }
const shakes: Shake[] = [];
let shakeOff: (() => void) | null = null;

/** Local camera shake (+ optional roll) applied after everyone placed the camera this frame. */
export function shake(game: Game, amp = 0.05, dur = 0.4, roll = 0, freq = 28) {
  shakes.push({ t: 0, dur, amp, roll, freq });
  if (!shakeOff) {
    shakeOff = game.engine.onLate((f) => {
      const cam = game.engine.camera;
      let dx = 0, dy = 0, rz = 0;
      for (const s of shakes) {
        s.t += f.rawDt;
        const k = 1 - clamp(s.t / s.dur);
        const e = k * k;
        dx += Math.sin(s.t * s.freq * 1.13 + 1.7) * s.amp * e;
        dy += Math.sin(s.t * s.freq + 0.3) * s.amp * e;
        rz += Math.sin(s.t * s.freq * 0.5) * s.roll * e;
      }
      for (let i = shakes.length - 1; i >= 0; i--) if (shakes[i].t >= shakes[i].dur) shakes.splice(i, 1);
      if (cam) {
        cam.rotateX(dy);
        cam.rotateY(dx);
        cam.rotateZ(rz);
        cam.updateMatrixWorld();
      }
      if (!shakes.length) { shakeOff?.(); shakeOff = null; }
    });
  }
}

// ------------------------------------------------------------------ hand print decal

let handTex: THREE.Texture | null = null;
export function handTexture() {
  if (!handTex) handTex = Assets.texture(GEN + 'handprint_red.png', { wrap: false });
  return handTex;
}

const decals = new Map<number, { mesh: THREE.Mesh; t: number; life: number }>();

/** Red hand print on a player's (left) cheek for `life` seconds. */
export function cheekPrint(game: Game, id: number, life = 28) {
  const rig = rigOf(game, id);
  if (!rig) return;
  const old = decals.get(id);
  if (old) { old.t = 0; old.life = life; return; }
  const mat = new THREE.MeshStandardMaterial({ map: handTexture(), transparent: true, depthWrite: false, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -4, color: 0xffffff });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.095, 0.105), mat);
  mesh.name = 'cheek-print';
  mesh.renderOrder = 3;
  // head attach frame: +Z forward, +X character's left, origin at the top of the hair
  const h = (rig.look?.height ?? 1.7) / 1.7;
  mesh.position.set(0.062 * h, -0.155 * h, 0.07 * h);
  mesh.rotation.set(0, 0.95, -0.2);
  rig.attach('head').add(mesh);
  decals.set(id, { mesh, t: 0, life });
}

export function updateDecals(game: Game, dt: number) {
  for (const [id, d] of decals) {
    d.t += dt;
    const k = d.t / d.life;
    const m = d.mesh.material as THREE.MeshStandardMaterial;
    m.opacity = k < 0.05 ? Ease.outBack(k / 0.05) : 1 - clamp((k - 0.75) / 0.25);
    const local = id === game.localPlayerId && game.player?.firstPerson;
    d.mesh.visible = !local;
    if (k >= 1 || !game.state.get(id) || !d.mesh.parent) {
      d.mesh.removeFromParent();
      d.mesh.geometry.dispose();
      m.dispose();
      decals.delete(id);
    }
  }
}

export function clearDecals() {
  for (const d of decals.values()) { d.mesh.removeFromParent(); d.mesh.geometry.dispose(); (d.mesh.material as THREE.Material).dispose(); }
  decals.clear();
}

// ------------------------------------------------------------------ lens hand print (victim's own view)

/** A red hand print smacked onto the local camera "lens" (first person victim), fading out. */
export function lensSmack(game: Game) {
  const cam = game.camera;
  if (!cam) return;
  const mat = new THREE.MeshBasicMaterial({ map: handTexture(), transparent: true, depthTest: false, depthWrite: false, opacity: 0.85, toneMapped: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.18), mat);
  m.position.set(-0.07 + Math.random() * 0.04, 0.01, -0.3);
  m.rotation.z = (Math.random() - 0.5) * 0.8;
  m.renderOrder = 2500;
  cam.add(m);
  game.engine.tween(1.1, (k) => {
    mat.opacity = 0.85 * (1 - k);
    m.scale.setScalar(1 + k * 0.25);
  }, Ease.inQuad).then(() => { m.removeFromParent(); m.geometry.dispose(); mat.dispose(); });
}

// ------------------------------------------------------------------ sweat drops

let dropTex: THREE.Texture | null = null;
export function dropTexture() {
  if (!dropTex) dropTex = Assets.texture(GEN + 'sweat_drop.png', { wrap: false });
  return dropTex;
}

export class SweatDrops {
  readonly group = new THREE.Group();
  private drops: { s: THREE.Sprite; v: THREE.Vector3; t: number }[] = [];
  private mat = new THREE.SpriteMaterial({ map: dropTexture(), transparent: true, depthWrite: false });
  emit(p: THREE.Vector3, n = 2) {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(this.mat);
      s.scale.setScalar(0.035 + Math.random() * 0.02);
      s.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 0.12, Math.random() * 0.06, (Math.random() - 0.5) * 0.12));
      this.group.add(s);
      this.drops.push({ s, v: new THREE.Vector3((Math.random() - 0.5) * 1.4, 1.2 + Math.random() * 0.8, (Math.random() - 0.5) * 1.4), t: 0 });
    }
  }
  update(dt: number) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t += dt;
      d.v.y -= 6 * dt;
      d.s.position.addScaledVector(d.v, dt);
      if (d.t > 0.8) { d.s.removeFromParent(); this.drops.splice(i, 1); }
    }
  }
}
