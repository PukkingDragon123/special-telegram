import * as THREE from 'three';
import { NOISE, beamMaterial } from './heavenenv';

/* ============================================================================================
 * The street side of the Skill Heaven:
 *  - SkyOpening: when you press Tab the camera tilts up to the real sky; right where you look,
 *    noise-shader clouds swirl and part, warm heavenly light pours out of the hole and soft god
 *    rays stream down onto you (drawn over the world so roofs never hide the miracle).
 *  - ThinkerBeam: what friends see while you are up there — your body standing still, looking up,
 *    inside a faint golden light column with motes drifting up.
 * ========================================================================================== */

const openFrag = /* glsl */ `
uniform float uTime, uOpen, uK;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float sw = uTime * 0.25 + (1.0 - r) * 1.6;            // swirl
  vec2 q = vec2(cos(a + sw), sin(a + sw)) * r;
  float n = fbm(vec3(q * 3.2, uTime * 0.12));
  float n2 = fbm(vec3(q * 7.0 + 3.0, uTime * 0.2));
  float hole = uOpen * 0.42;
  float edge = r - hole - (n - 0.5) * 0.3;
  float core = 1.0 - smoothstep(-0.08, 0.06, edge);
  float outer = 1.0 - smoothstep(0.3, 0.95, r + (n2 - 0.5) * 0.5);
  float dens = smoothstep(0.32, 0.72, n * 0.7 + n2 * 0.45);
  float cloud = smoothstep(-0.02, 0.14, edge) * outer * dens;
  vec3 light = mix(vec3(1.0, 0.8, 0.52), vec3(1.0, 0.97, 0.9), smoothstep(hole + 0.05, 0.0, r)) * (2.0 + 3.0 * exp(-r * r * 9.0));
  vec3 cloudCol = mix(vec3(0.74, 0.7, 0.86), vec3(1.15, 1.04, 0.94), smoothstep(0.4, 0.0, edge)) * (0.78 + 0.4 * n2)
                + vec3(1.0, 0.72, 0.4) * smoothstep(0.16, 0.0, edge) * 1.4;
  float glow = exp(-r * r * 3.0) * 0.55 * uOpen;
  vec3 col = core * light + (1.0 - core) * (cloud * cloudCol + glow * vec3(1.0, 0.84, 0.58) * (1.0 - cloud));
  float alpha = clamp(max(core, max(cloud * 0.95, glow * 0.6)), 0.0, 1.0) * uK;
  gl_FragColor = vec4(col, alpha);
}`;

const streakVert = /* glsl */ `
attribute vec3 aA;      // top (at the opening)
attribute vec4 aB;      // xyz bottom (around you), w width
attribute float aS;
uniform float uTime;
varying vec2 vUv; varying float vS;
void main() {
  vUv = uv; vS = aS;
  vec3 axis = aB.xyz - aA;
  vec3 mid = mix(aA, aB.xyz, uv.y);
  vec3 side = normalize(cross(axis, cameraPosition - mid));
  float w = aB.w * mix(2.2, 0.6, uv.y);
  vec3 wp = mid + side * (uv.x - 0.5) * w;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const streakFrag = /* glsl */ `
uniform float uTime, uK;
varying vec2 vUv; varying float vS;
${NOISE}
void main() {
  float x = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float along = smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
  float fl = 0.55 + 0.45 * vn(vec3(vS * 9.0, vUv.y * 3.0 - uTime * 0.6, uTime * 0.1));
  float a = pow(x, 1.8) * along * fl * uK * 0.75;
  gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * a, a);
}`;

export class SkyOpening {
  readonly group = new THREE.Group();
  private disc: THREE.Mesh;
  private streaks: THREE.Mesh;
  private dm: THREE.ShaderMaterial;
  private sm: THREE.ShaderMaterial;
  private aA: THREE.InstancedBufferAttribute;
  private aB: THREE.InstancedBufferAttribute;
  private t = 0;
  private readonly N = 11;
  private _v = new THREE.Vector3();
  private _c = new THREE.Vector3();
  private _r = new THREE.Vector3();
  private _u = new THREE.Vector3();
  private _t = new THREE.Vector3();

  constructor() {
    this.dm = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: openFrag, transparent: true, depthWrite: false, depthTest: false, fog: false,
      uniforms: { uTime: { value: 0 }, uOpen: { value: 0 }, uK: { value: 0 } },
    });
    this.disc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.dm);
    this.disc.renderOrder = 2000;
    this.disc.frustumCulled = false;
    const plane = new THREE.PlaneGeometry(1, 1, 1, 6).translate(0.5, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute('position', plane.getAttribute('position'));
    g.setAttribute('uv', plane.getAttribute('uv'));
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(this.N * 3), 3);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(this.N * 4), 4);
    const s = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) s[i] = Math.random();
    g.setAttribute('aA', this.aA); g.setAttribute('aB', this.aB); g.setAttribute('aS', new THREE.InstancedBufferAttribute(s, 1));
    g.instanceCount = this.N;
    this.sm = new THREE.ShaderMaterial({
      vertexShader: streakVert, fragmentShader: streakFrag, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uK: { value: 0 } },
    });
    this.streaks = new THREE.Mesh(g, this.sm);
    this.streaks.renderOrder = 2001;
    this.streaks.frustumCulled = false;
    this.group.add(this.disc, this.streaks);
    this.group.name = 'sky-opening';
  }

  /**
   * k: visibility, open: how far the clouds have parted (0..1)
   * feet: the thinker's feet, yaw: facing; the opening sits up the line of sight (pitch ≈ 1.3).
   */
  update(dt: number, k: number, open: number, feet: THREE.Vector3, yaw: number, cam: THREE.Camera) {
    this.t += dt;
    this.group.visible = k > 0.002;
    if (!this.group.visible) return;
    const pitch = 1.3, D = 70;
    const dir = this._v.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const centre = this._c.copy(feet);
    centre.y += 1.6;
    centre.addScaledVector(dir, D);
    this.disc.position.copy(centre);
    this.disc.scale.setScalar(D * 1.25);
    this.disc.quaternion.copy(cam.quaternion);
    this.dm.uniforms.uTime.value = this.t;
    this.dm.uniforms.uOpen.value = open;
    this.dm.uniforms.uK.value = k;
    this.sm.uniforms.uTime.value = this.t;
    this.sm.uniforms.uK.value = k * open;
    const right = this._r.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const up2 = this._u.crossVectors(right, dir).normalize();
    for (let i = 0; i < this.N; i++) {
      const a = (i / this.N) * Math.PI * 2 + i * 0.37;
      const rTop = D * 0.62 * 0.5 * open * (0.55 + 0.4 * ((i * 0.618) % 1));
      const top = this._t.copy(centre).addScaledVector(right, Math.cos(a) * rTop).addScaledVector(up2, Math.sin(a) * rTop);
      const rb = 0.7 + ((i * 0.37) % 1) * 2.2;
      this.aA.setXYZ(i, top.x, top.y, top.z);
      this.aB.setXYZW(i, feet.x + Math.cos(a * 1.3) * rb, feet.y, feet.z + Math.sin(a * 1.3) * rb, 1.2 + ((i * 0.71) % 1) * 1.8);
    }
    this.aA.needsUpdate = true;
    this.aB.needsUpdate = true;
  }

  dispose() {
    this.disc.geometry.dispose(); this.streaks.geometry.dispose();
    this.dm.dispose(); this.sm.dispose();
    this.group.removeFromParent();
  }
}

// ------------------------------------------------------------------ what friends see

const moteVert = /* glsl */ `
attribute vec4 aD; uniform float uTime, uK; varying float vA;
void main() {
  vec3 p = position;
  float y = mod(aD.y + uTime * (0.35 + aD.z * 0.4), 4.5);
  p.y = y;
  p.x += sin(uTime * 1.3 + aD.x * 6.0) * 0.06; p.z += cos(uTime * 1.1 + aD.x * 4.0) * 0.06;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vA = uK * smoothstep(0.0, 0.6, y) * (1.0 - smoothstep(3.0, 4.5, y)) * (0.4 + 0.6 * pow(0.5 + 0.5 * sin(uTime * 4.0 + aD.x * 20.0), 3.0));
  gl_PointSize = (0.025 + 0.02 * aD.w) * 600.0 / max(0.5, -mv.z);
}`;
const moteFrag = /* glsl */ `
varying float vA;
void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float a = exp(-dot(p, p) * 5.0) * vA; gl_FragColor = vec4(vec3(1.0, 0.9, 0.65) * a, a); }`;

export class ThinkerBeam {
  readonly group = new THREE.Group();
  private beam: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private motes: THREE.Points;
  private mm: THREE.ShaderMaterial;
  k = 0;
  target = 1;
  private t = Math.random() * 10;

  constructor() {
    const geo = new THREE.CylinderGeometry(0.32, 0.72, 14, 20, 1, true).translate(0, 7, 0);
    this.mat = beamMaterial(0xffd690, 0, 0.02, 0.2);
    this.beam = new THREE.Mesh(geo, this.mat);
    this.beam.renderOrder = 9;
    const n = 26;
    const pos = new Float32Array(n * 3), d = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 0.45;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 2] = Math.sin(a) * r;
      d[i * 4] = Math.random(); d[i * 4 + 1] = Math.random() * 4.5; d[i * 4 + 2] = Math.random(); d[i * 4 + 3] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aD', new THREE.BufferAttribute(d, 4));
    this.mm = new THREE.ShaderMaterial({ vertexShader: moteVert, fragmentShader: moteFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uK: { value: 0 } } });
    this.motes = new THREE.Points(g, this.mm);
    this.motes.frustumCulled = false;
    this.group.add(this.beam, this.motes);
    this.group.name = 'thinker-beam';
  }

  get gone() { return this.target === 0 && this.k <= 0.001; }

  update(dt: number, feet: THREE.Vector3 | null) {
    this.t += dt;
    this.k += Math.sign(this.target - this.k) * Math.min(Math.abs(this.target - this.k), dt * (this.target > this.k ? 0.8 : 1.6));
    if (feet) this.group.position.copy(feet);
    this.mat.uniforms.uTime.value = this.t;
    this.mat.uniforms.uK.value = this.k * 1.1;
    this.mm.uniforms.uTime.value = this.t;
    this.mm.uniforms.uK.value = this.k;
    this.group.visible = this.k > 0.002;
  }

  dispose() { this.beam.geometry.dispose(); this.mat.dispose(); this.motes.geometry.dispose(); this.mm.dispose(); this.group.removeFromParent(); }
}
