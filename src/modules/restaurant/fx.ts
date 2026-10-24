import * as THREE from 'three';
import { Assets } from '../../core/assets';
import { F } from '../../core/fonts';
import { canvasTexture } from '../../ui3d/text';
import { asset } from '../../core/util';

/* =============================================================================================
 * Restaurant VFX (client-local): table mess decal (real food photos masked by fbm), wash-tub water
 * + soap foam shader, soap bubbles / splashes, flies over dirty tables, floating paper order
 * tickets & review slips (real paper photo + looped handwriting font).
 * ============================================================================================= */

const NOISE = /* glsl */ `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.03+1.7; a*=0.5; } return s; }
`;

const VERT = /* glsl */ `varying vec2 vUv; varying vec3 vW; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`;

// ------------------------------------------------------------------ table mess decal

let foodTex: THREE.Texture[] | null = null;
function foodTextures() {
  if (!foodTex) foodTex = [Assets.texture('textures/food/kaphrao_full_tile.jpg', { repeat: 1 }), Assets.texture('textures/food/rice_cooked_tile.jpg', { repeat: 1 })];
  return foodTex;
}

/** Per-table material: sauce smears + rice grains + drips that grow with uMess (0..1). */
export function messMaterial(seed: number) {
  const [sauce, rice] = foodTextures();
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { uMess: { value: 0 }, uSeed: { value: seed }, uSauce: { value: sauce }, uRice: { value: rice }, uWet: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: NOISE + /* glsl */ `
      uniform float uMess, uSeed, uWet; uniform sampler2D uSauce, uRice; varying vec2 vUv;
      void main(){
        vec2 p = vUv * vec2(3.0, 2.2) + uSeed * 7.3;
        float blob = fbm(p * 1.3);
        float spots = fbm(p * 5.0 + 3.1);
        float sauceM = smoothstep(0.78 - uMess * 0.36, 0.8 - uMess * 0.36 + 0.05, blob);
        float riceM = smoothstep(0.86 - uMess * 0.3, 0.9 - uMess * 0.3, spots) * step(0.15, uMess);
        float ring = smoothstep(0.02, 0.0, abs(length(fract(p * 0.7) - 0.5) - 0.32)) * step(0.45, uMess) * 0.5 * step(0.6, fbm(p*0.4+9.0));
        vec3 sc = texture2D(uSauce, vUv * 1.7).rgb * 0.75;
        vec3 rc = texture2D(uRice, vUv * 3.1).rgb;
        float a = max(sauceM * 0.85, max(riceM, ring));
        vec3 col = mix(sc, rc, riceM / max(0.001, a)) ;
        col = mix(col, sc * 0.6, ring);
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a * min(1.0, uMess * 2.2));
        #include <colorspace_fragment>
      }`,
  });
}

// ------------------------------------------------------------------ wash tub water + foam

export function waterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uSoap: { value: 1 }, uDirt: { value: 0 }, uStir: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: NOISE + /* glsl */ `
      uniform float uTime, uSoap, uDirt, uStir; varying vec2 vUv;
      void main(){
        vec2 c = vUv - 0.5; float r = length(c);
        if (r > 0.5) discard;
        vec2 p = vUv * 9.0;
        float t = uTime * (0.25 + uStir * 2.0);
        float ripple = fbm(p + vec2(t, -t * 0.7));
        vec3 water = mix(vec3(0.42, 0.55, 0.58), vec3(0.45, 0.36, 0.22), uDirt) * (0.75 + ripple * 0.35);
        // foam: cellular-ish bubbles from layered fbm, more at the rim and while scrubbing
        float cells = fbm(p * 2.6 + vec2(t * 0.6, t * 0.3));
        float bub = smoothstep(0.42, 0.62, cells) * (1.0 - smoothstep(0.62, 0.7, cells) * 0.5);
        float foamAmt = uSoap * (0.45 + smoothstep(0.25, 0.5, r) * 0.4 + uStir * 0.5);
        float foam = smoothstep(1.0 - foamAmt, 1.0 - foamAmt + 0.18, fbm(p * 0.9 + t * 0.2) + bub * 0.35);
        vec3 fc = mix(vec3(0.97, 0.97, 0.95), vec3(0.85, 0.8, 0.7), uDirt * 0.6) * (0.85 + bub * 0.2);
        vec3 col = mix(water, fc, foam);
        float spec = pow(max(0.0, ripple - 0.55) * 2.2, 3.0) * (1.0 - foam);
        gl_FragColor = vec4(col + spec * 0.5, mix(0.82, 0.97, foam));
        #include <colorspace_fragment>
      }`,
  });
}

// ------------------------------------------------------------------ particles: soap bubbles, splash droplets

const PART_VERT = /* glsl */ `
attribute float aSize; attribute float aLife; attribute float aKind; varying float vLife; varying float vKind;
void main(){ vLife=aLife; vKind=aKind; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`;
const PART_FRAG = /* glsl */ `
varying float vLife; varying float vKind;
void main(){
  vec2 c = gl_PointCoord - 0.5; float r = length(c);
  if (r > 0.5) discard;
  if (vKind < 0.5) {
    // soap bubble: thin iridescent rim + highlight
    float rim = smoothstep(0.5, 0.42, r) * smoothstep(0.3, 0.46, r);
    vec3 iri = 0.6 + 0.4 * cos(6.2831 * (r * 2.0 + vec3(0.0, 0.33, 0.67)) + vLife * 3.0);
    float hi = smoothstep(0.12, 0.0, length(c - vec2(-0.15, 0.15)));
    gl_FragColor = vec4(iri * rim + hi, (rim * 0.75 + hi) * smoothstep(0.0, 0.2, vLife));
  } else {
    float a = smoothstep(0.5, 0.2, r);
    gl_FragColor = vec4(vec3(0.75, 0.85, 0.9), a * 0.7 * vLife);
  }
}`;

interface P { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; size: number; kind: number }

export class RestFX {
  private parts: P[] = [];
  private pts: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private N = 260;
  private flies: THREE.InstancedMesh;
  private flyCenters: { p: THREE.Vector3; n: number }[] = [];
  private t = 0;
  root = new THREE.Group();

  constructor() {
    this.root.name = 'restaurant-fx';
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.N * 3), 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(this.N), 1));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(this.N), 1));
    this.geo.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(this.N), 1));
    this.pts = new THREE.Points(this.geo, new THREE.ShaderMaterial({ vertexShader: PART_VERT, fragmentShader: PART_FRAG, transparent: true, depthWrite: false }));
    this.pts.frustumCulled = false;
    this.pts.raycast = () => {};
    this.root.add(this.pts);
    // flies: tiny dark bodies with blurred wings
    const body = new THREE.SphereGeometry(0.004, 5, 3); body.scale(1, 0.8, 1.6);
    const wing = new THREE.PlaneGeometry(0.009, 0.005); wing.rotateX(-Math.PI / 2); wing.translate(0, 0.002, 0);
    const g = new THREE.BufferGeometry();
    const merged = [body.toNonIndexed(), wing.toNonIndexed()];
    const pos = new Float32Array(merged.reduce((a, m) => a + m.getAttribute('position').count * 3, 0));
    let o = 0; for (const m of merged) { pos.set(m.getAttribute('position').array as Float32Array, o); o += m.getAttribute('position').array.length; }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals();
    this.flies = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.5, transparent: true, opacity: 0.85 }), 48);
    this.flies.count = 0;
    this.flies.frustumCulled = false;
    this.flies.raycast = () => {};
    this.root.add(this.flies);
  }

  attach(scene: THREE.Scene) { scene.add(this.root); }
  detach() { this.root.removeFromParent(); this.parts = []; }

  bubbles(at: THREE.Vector3, n = 6, spread = 0.18) {
    for (let i = 0; i < n && this.parts.length < this.N; i++) {
      const a = Math.random() * 6.28, r = Math.random() * spread;
      this.parts.push({ p: at.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.02, Math.sin(a) * r)), v: new THREE.Vector3((Math.random() - 0.5) * 0.1, 0.12 + Math.random() * 0.25, (Math.random() - 0.5) * 0.1), life: 1, max: 1.2 + Math.random() * 1.6, size: 0.012 + Math.random() * 0.03, kind: 0 });
    }
  }

  splash(at: THREE.Vector3, n = 10, k = 1) {
    for (let i = 0; i < n && this.parts.length < this.N; i++) {
      const a = Math.random() * 6.28;
      this.parts.push({ p: at.clone(), v: new THREE.Vector3(Math.cos(a) * 0.6 * k * Math.random(), (0.8 + Math.random() * 1.2) * k, Math.sin(a) * 0.6 * k * Math.random()), life: 1, max: 0.5 + Math.random() * 0.4, size: 0.006 + Math.random() * 0.01, kind: 1 });
    }
  }

  /** Dirty spots (table centres / trash) that attract flies: [{p, n}] */
  setFlies(c: { p: THREE.Vector3; n: number }[]) { this.flyCenters = c; }

  update(dt: number) {
    this.t += dt;
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const size = this.geo.getAttribute('aSize') as THREE.BufferAttribute;
    const life = this.geo.getAttribute('aLife') as THREE.BufferAttribute;
    const kind = this.geo.getAttribute('aKind') as THREE.BufferAttribute;
    let w = 0;
    for (const q of this.parts) {
      q.life -= dt / q.max;
      if (q.life <= 0) continue;
      if (q.kind === 1) q.v.y -= 6 * dt; else { q.v.x += Math.sin(this.t * 3 + q.p.y * 20) * 0.05 * dt; q.v.multiplyScalar(0.995); }
      q.p.addScaledVector(q.v, dt);
      this.parts[w++] = q;
    }
    this.parts.length = w;
    for (let i = 0; i < this.N; i++) {
      const q = this.parts[i];
      if (q) { pos.setXYZ(i, q.p.x, q.p.y, q.p.z); size.setX(i, q.size); life.setX(i, q.life); kind.setX(i, q.kind); }
      else { pos.setXYZ(i, 0, -999, 0); size.setX(i, 0); }
    }
    pos.needsUpdate = size.needsUpdate = life.needsUpdate = kind.needsUpdate = true;
    // flies: lissajous swarms
    let k = 0;
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    for (const c of this.flyCenters) {
      for (let i = 0; i < c.n && k < 48; i++, k++) {
        const ph = i * 2.1 + k * 0.37, sp = 1.3 + (i % 3) * 0.4;
        const tt = this.t * sp + ph;
        p.set(c.p.x + Math.sin(tt * 1.3) * 0.22 + Math.sin(tt * 3.7) * 0.05, c.p.y + 0.12 + Math.abs(Math.sin(tt * 0.9)) * 0.25 + Math.sin(tt * 5.1) * 0.02, c.p.z + Math.cos(tt * 1.1) * 0.2);
        // occasionally land
        if (Math.sin(tt * 0.31) > 0.8) p.y = c.p.y + 0.005;
        qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tt * 2);
        m.compose(p, qq, s);
        this.flies.setMatrixAt(k, m);
      }
    }
    this.flies.count = k;
    this.flies.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ paper (real photo) for tickets & review slips

let paperImg: HTMLImageElement | null = null;
let paperReq = false;
function paper(): HTMLImageElement | null {
  if (!paperReq) {
    paperReq = true;
    const e: any = (Assets.pbrManifest as any).paper_creased;
    const f = e ? (e.albedo.includes('/') ? e.albedo : `textures/pbr/paper_creased/${e.albedo}`) : null;
    if (f) Assets.image(f).then((im) => { paperImg = im; }).catch(() => {});
  }
  return paperImg;
}
void asset;

/** Paint a small order slip / review slip on real paper. lines: [text, size, color, font?] */
export function paperCanvas(w: number, h: number, lines: [string, number, string, string?][], o: { tint?: string; stamp?: string } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  const im = paper();
  if (im) c.drawImage(im, (im.width * 0.3) | 0, (im.height * 0.3) | 0, (im.width * 0.4) | 0, (im.height * 0.4 * h / w) | 0, 0, 0, w, h);
  else { c.fillStyle = '#f3efe4'; c.fillRect(0, 0, w, h); }
  if (o.tint) { c.globalCompositeOperation = 'multiply'; c.fillStyle = o.tint; c.fillRect(0, 0, w, h); c.globalCompositeOperation = 'source-over'; }
  // ruled pad lines + red margin like a Thai order pad
  c.strokeStyle = 'rgba(70,90,160,0.25)'; c.lineWidth = 2;
  for (let y = h * 0.28; y < h; y += h * 0.18) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  c.strokeStyle = 'rgba(200,40,40,0.4)'; c.beginPath(); c.moveTo(w * 0.1, 0); c.lineTo(w * 0.1, h); c.stroke();
  let y = h * 0.08;
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (const [t, s, col, font] of lines) {
    c.font = `400 ${s}px ${font ?? F.hand}, ${F.body}`;
    c.fillStyle = col;
    c.save(); c.translate(w / 2 + (Math.random() - 0.5) * 4, y); c.rotate((Math.random() - 0.5) * 0.04);
    let tt = t;
    while (c.measureText(tt).width > w * 0.86 && tt.length > 3) tt = tt.slice(0, -2) + '…';
    c.fillText(tt, 0, 0); c.restore();
    y += s * 1.18;
  }
  if (o.stamp) {
    c.save(); c.translate(w * 0.78, h * 0.78); c.rotate(-0.3);
    c.strokeStyle = 'rgba(200,30,30,0.75)'; c.lineWidth = 5; c.strokeRect(-w * 0.17, -h * 0.09, w * 0.34, h * 0.18);
    c.fillStyle = 'rgba(200,30,30,0.8)'; c.font = `700 ${(h * 0.12) | 0}px ${F.heavy}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(o.stamp, 0, 0);
    c.restore();
  }
  return cv;
}

export function paperMesh(cv: HTMLCanvasElement, wm: number) {
  const tex = canvasTexture(cv);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(wm, wm * cv.height / cv.width), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, toneMapped: false }));
  m.raycast = () => {};
  return m;
}
