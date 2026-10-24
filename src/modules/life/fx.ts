import * as THREE from 'three';
import type { Game } from '../../game/game';
import { glowTexture } from './tex';

/* ============================================================================================
 * life FX: hearts, noise-shader mist (ghost trails / auras), glowing noise sprites, and a
 * translucent "ghost" material override for character rigs. All mist/glow is fbm noise in GLSL.
 * ========================================================================================== */

export function hearts(game: Game, obj: THREE.Object3D, n = 5) {
  const base = obj.getWorldPosition(new THREE.Vector3());
  const h = (obj.userData.headHeight as number) ?? 0.8;
  for (let i = 0; i < n; i++) {
    setTimeout(() => {
      const p = base.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, h + Math.random() * 0.2, (Math.random() - 0.5) * 0.5));
      game.ui.popup(p, '♥', { style: { font: '"Kodchasan"', size: 54 + Math.random() * 20, weight: 700, color: '#ff5c8a', stroke: '#5a0f24', strokeWidth: 6 } } as any);
    }, i * 140);
  }
}

export const NOISE = /* glsl */`
float lh(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float ln(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(lh(i+vec3(0,0,0)),lh(i+vec3(1,0,0)),f.x), mix(lh(i+vec3(0,1,0)),lh(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(lh(i+vec3(0,0,1)),lh(i+vec3(1,0,1)),f.x), mix(lh(i+vec3(0,1,1)),lh(i+vec3(1,1,1)),f.x),f.y), f.z); }
float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*ln(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }
`;

/** Billboard mist puffs (instanced). Call emit() to add a puff; update() every frame. */
export class Mist {
  readonly mesh: THREE.InstancedMesh;
  private life: Float32Array;
  private max: number;
  private vel: THREE.Vector3[] = [];
  private pos: THREE.Vector3[] = [];
  private size: Float32Array;
  private ttl: Float32Array;
  private i = 0;
  private mat: THREE.ShaderMaterial;
  private aSeed: THREE.InstancedBufferAttribute;
  private aFade: THREE.InstancedBufferAttribute;

  constructor(max = 48, color = new THREE.Color(0.75, 0.8, 0.85), opacity = 0.35) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uColor: { value: color }, uOpacity: { value: opacity } },
      vertexShader: /* glsl */`
        attribute float aSeed; attribute float aFade;
        varying vec2 vUv; varying float vSeed; varying float vFade;
        void main(){
          vUv = uv; vSeed = aSeed; vFade = aFade;
          vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0);
          float s = length(instanceMatrix[0].xyz);
          c.xy += position.xy * s;
          gl_Position = projectionMatrix * c;
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform vec3 uColor; uniform float uOpacity;
        varying vec2 vUv; varying float vSeed; varying float vFade;
        ${NOISE}
        void main(){
          vec2 q = vUv - 0.5;
          float r = length(q) * 2.0;
          float n = fbm(vec3(q * 3.0 + vSeed * 7.0, uTime * 0.25 + vSeed));
          float a = smoothstep(1.0, 0.15, r + (n - 0.5) * 0.9) * vFade * uOpacity;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor * (0.85 + n * 0.3), a);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.life = new Float32Array(max);
    this.size = new Float32Array(max);
    this.ttl = new Float32Array(max).fill(1);
    const seeds = new Float32Array(max);
    for (let i = 0; i < max; i++) { seeds[i] = Math.random(); this.vel.push(new THREE.Vector3()); this.pos.push(new THREE.Vector3()); }
    this.aSeed = new THREE.InstancedBufferAttribute(seeds, 1);
    this.aFade = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    geo.setAttribute('aSeed', this.aSeed);
    geo.setAttribute('aFade', this.aFade);
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, m);
  }

  emit(p: THREE.Vector3, size = 1, ttl = 2.5, vel?: THREE.Vector3) {
    const i = this.i = (this.i + 1) % this.max;
    this.pos[i].copy(p);
    this.vel[i].copy(vel ?? new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.15 + Math.random() * 0.2, (Math.random() - 0.5) * 0.3));
    this.life[i] = ttl; this.ttl[i] = ttl; this.size[i] = size;
  }

  private m = new THREE.Matrix4();
  update(dt: number, t: number) {
    this.mat.uniforms.uTime.value = t;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.aFade.setX(i, 0); continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.ttl[i]);
      this.pos[i].addScaledVector(this.vel[i], dt);
      this.vel[i].multiplyScalar(1 - dt * 0.6);
      const s = this.size[i] * (1.6 - k * 0.6);
      this.m.makeScale(s, s, s).setPosition(this.pos[i]);
      this.mesh.setMatrixAt(i, this.m);
      this.aFade.setX(i, Math.sin(Math.min(1, (1 - k) * 4) * Math.PI * 0.5) * k);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aFade.needsUpdate = true;
  }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); }
}

/** Additive glowing sprite with noise flicker (krasue entrails, will-o'-wisps, lamps). */
export function glowSprite(color: THREE.ColorRepresentation, size = 1, opacity = 0.8): THREE.Sprite {
  const m = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  s.renderOrder = 6;
  return s;
}

/** Glowing noise-shader material for organic emissive shapes (entrails, aura shells). */
export function glowNoiseMaterial(c1: THREE.ColorRepresentation, c2: THREE.ColorRepresentation, o: { additive?: boolean; opacity?: number; fresnel?: number } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uC1: { value: new THREE.Color(c1) }, uC2: { value: new THREE.Color(c2) }, uOpacity: { value: o.opacity ?? 1 }, uFres: { value: o.fresnel ?? 1.5 } },
    vertexShader: /* glsl */`
      varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vP = position; vN = normalize(normalMatrix * normal);
        vec4 mv = viewMatrix * wp; vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uC1; uniform vec3 uC2; uniform float uOpacity; uniform float uFres;
      varying vec3 vP; varying vec3 vN; varying vec3 vV;
      ${NOISE}
      void main(){
        float n = fbm(vP * 9.0 + vec3(0.0, uTime * 0.9, uTime * 0.3));
        float pulse = 0.75 + 0.25 * sin(uTime * 6.0 + vP.y * 20.0);
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uFres);
        vec3 c = mix(uC1, uC2, smoothstep(0.35, 0.75, n));
        float a = (0.35 + f * 0.9) * (0.6 + n * 0.6) * pulse * uOpacity;
        gl_FragColor = vec4(c * (0.8 + n), clamp(a, 0.0, 1.0));
      }`,
  });
}

/**
 * Turn a character rig (or any object) into a translucent ghost: keeps each mesh's texture,
 * adds a pale fresnel rim + fbm noise dissolve. Returns a setter for visibility (0..1).
 */
export function ghostify(obj: THREE.Object3D, tint = new THREE.Color(0.75, 0.9, 0.85)) {
  const mats: THREE.Material[] = [];
  const uniforms = { uVis: { value: 1 }, uTime: { value: 0 }, uTint: { value: tint } };
  obj.traverse((o: any) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const out = list.map((m: THREE.Material) => {
      const c = (m as any).clone() as THREE.MeshStandardMaterial;
      c.transparent = true;
      c.depthWrite = false;
      (c as any).emissive = new THREE.Color(0x000000);
      c.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, uniforms);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>\nuniform float uVis; uniform float uTime; uniform vec3 uTint; varying vec3 vGP;\n${NOISE}`)
          .replace('#include <dithering_fragment>', `#include <dithering_fragment>
            float gn = fbm(vGP * 2.6 + vec3(0.0, -uTime * 0.6, uTime * 0.2));
            vec3 V = normalize(cameraPosition - vGP);
            float fr = pow(1.0 - abs(dot(normalize(vNormal), normalize((viewMatrix * vec4(V, 0.0)).xyz))), 2.0);
            gl_FragColor.rgb = mix(gl_FragColor.rgb * 0.55, uTint, 0.35 + fr * 0.5);
            gl_FragColor.rgb += uTint * fr * 0.6;
            float edge = smoothstep(uVis - 0.15, uVis + 0.05, gn * 1.1);
            gl_FragColor.a *= (1.0 - edge) * (0.55 + fr * 0.4) * clamp(uVis * 1.5, 0.0, 1.0);`);
      };
      c.customProgramCacheKey = () => 'life_ghostify';
      mats.push(c);
      return c;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
  return {
    set: (vis: number, t: number) => { uniforms.uVis.value = vis; uniforms.uTime.value = t; },
    dispose: () => { for (const m of mats) m.dispose(); },
  };
}
