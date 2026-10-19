import * as THREE from 'three';

/**
 * Organic bubble / cloud shader (SDF + fbm noise) used by speech bubbles, thought puffs and tags.
 * Never a flat circle: wobbly hand-inked outline, paper fibres, drop shadow, typewriter text reveal.
 * Output is premultiplied alpha.
 */
export const CLOUD_STYLE = { speech: 0, thought: 1, tag: 2, shout: 3 } as const;

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
uniform sampler2D uText;
uniform float uHasText;
uniform vec2 uSize;
uniform vec4 uTextRect;
uniform float uTime, uReveal, uLines, uOpacity, uPuff, uSeed, uStyle, uTailSpace, uTailX;
uniform vec3 uFill, uInk;
uniform float uFillAlpha;
varying vec2 vUv;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), u.x), mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
float sdRoundBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0); return mix(b, a, h) - k*h*(1.0-h); }

float shape(vec2 p) {
  float asp = uSize.x / uSize.y;
  float m = 0.07;
  vec2 q = p - vec2(0.0, uTailSpace * 0.5);
  vec2 b = vec2(asp * 0.5 - m, 0.5 - uTailSpace * 0.5 - m);
  vec2 tip = vec2(uTailX * (asp * 0.5 - 0.1), -0.5 + 0.03);
  float d;
  if (uStyle < 0.5 || uStyle > 2.5) {
    float r = min(b.x, b.y) * (uStyle > 2.5 ? 0.35 : 0.8);
    d = sdRoundBox(q, b, r);
    if (uStyle > 2.5) {
      // shout: spiky starburst edge
      float a = atan(q.y / b.y, q.x / b.x);
      d -= 0.035 * (0.5 + 0.5 * sin(a * 18.0 + uSeed * 3.0)) ;
    }
    if (uTailSpace > 0.0) {
      vec2 base = vec2(clamp(tip.x * 0.55, -b.x + 0.12, b.x - 0.12), uTailSpace * 0.5 - b.y + 0.06);
      vec2 pa = p - base, ba = tip - base;
      float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      // curved tail: bend the axis a little
      pa.x += sin(h * 3.14159) * 0.035 * sign(uTailX + 0.001);
      float w = mix(0.085, 0.004, h);
      d = smin(d, length(pa - ba * h) - w, 0.07);
    }
  } else if (uStyle < 1.5) {
    // thought cloud: core ellipse + ring of puffs + trailing puffs
    vec2 bb = b * 0.82;
    d = (length(q / bb) - 1.0) * min(bb.x, bb.y);
    for (int i = 0; i < 18; i++) {
      float fi = float(i);
      float a = fi / 18.0 * 6.28318 + uSeed;
      vec2 c = vec2(cos(a) * bb.x, sin(a) * bb.y);
      float rr = min(b.x, b.y) * (0.28 + 0.12 * hash(vec2(fi, uSeed)));
      d = smin(d, length(q - c) - rr, 0.04);
    }
    if (uTailSpace > 0.0) {
      for (int j = 0; j < 3; j++) {
        float t = (float(j) + 1.0) / 3.6;
        vec2 c = mix(vec2(tip.x * 0.5, uTailSpace * 0.5 - b.y), tip, t);
        d = min(d, length(p - c) - 0.055 * (1.15 - t));
      }
    }
  } else {
    d = sdRoundBox(q, b + vec2(m * 0.6), 0.09);
  }
  d += (fbm(p * 5.0 + uSeed + uTime * 0.12) - 0.5) * 0.03 * uPuff;
  return d;
}

void main() {
  float asp = uSize.x / uSize.y;
  vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
  float d = shape(p);
  float aa = max(fwidth(d) * 1.1, 0.0008);
  float ds = shape(p - vec2(0.02, -0.03));
  float shadowA = (1.0 - smoothstep(-0.03, 0.05, ds)) * 0.25 * uOpacity;
  float inside = 1.0 - smoothstep(-aa, aa, d);

  vec3 fill = uFill;
  if (uStyle < 1.5 || uStyle > 2.5) {
    float grad = 0.93 + 0.07 * vUv.y;
    float paper = 0.965 + 0.035 * fbm(vUv * vec2(asp, 1.0) * 38.0 + uSeed);
    fill *= grad * paper;
    fill *= 1.0 - smoothstep(-0.06, 0.0, d) * 0.1;
    if (uStyle > 0.5 && uStyle < 1.5) fill += vec3(0.05, 0.05, 0.08) * smoothstep(0.1, -0.2, p.y);
  } else {
    fill *= 0.9 + 0.1 * fbm(vUv * vec2(asp, 1.0) * 30.0 + uSeed);
  }
  float iw = (uStyle > 1.5 && uStyle < 2.5) ? 0.0 : 0.007 + 0.006 * fbm(p * 6.0 + uSeed * 3.0);
  float ink = iw > 0.0 ? 1.0 - smoothstep(iw - aa, iw + aa, abs(d + iw * 0.5)) : 0.0;
  vec3 col = mix(fill, uInk, ink * 0.9);
  float a = max(inside * uFillAlpha, ink);

  if (uHasText > 0.5) {
    vec2 tuv = (vUv - uTextRect.xy) / (uTextRect.zw - uTextRect.xy);
    if (tuv.x >= 0.0 && tuv.x <= 1.0 && tuv.y >= 0.0 && tuv.y <= 1.0) {
      vec4 tx = texture2D(uText, tuv);
      float line = floor((1.0 - tuv.y) * uLines);
      float lp = uReveal - line;
      float vis = lp >= 1.0 ? 1.0 : (lp <= 0.0 ? 0.0 : step(tuv.x, lp));
      float ta = tx.a * vis;
      col = mix(col, tx.rgb, ta);
      a = max(a, ta * inside);
    }
  }
  a *= uOpacity;
  // premultiplied composite over drop shadow
  vec3 pm = col * a;
  float outA = a + shadowA * (1.0 - a);
  gl_FragColor = vec4(pm, outA);
}`;

export interface CloudParams {
  style?: keyof typeof CLOUD_STYLE;
  fill?: THREE.ColorRepresentation;
  ink?: THREE.ColorRepresentation;
  fillAlpha?: number;
  puff?: number;
  tailSpace?: number;   // 0..0.4 fraction of height reserved for the tail
  tailX?: number;       // -1..1 tail tip horizontal position
  depthTest?: boolean;
}

export function makeCloudMaterial(o: CloudParams = {}) {
  const m = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    depthTest: o.depthTest ?? true,
    side: THREE.DoubleSide,
    uniforms: {
      uText: { value: null },
      uHasText: { value: 0 },
      uSize: { value: new THREE.Vector2(2, 1) },
      uTextRect: { value: new THREE.Vector4(0.1, 0.2, 0.9, 0.9) },
      uTime: { value: 0 },
      uReveal: { value: 99 },
      uLines: { value: 1 },
      uOpacity: { value: 1 },
      uPuff: { value: o.puff ?? 1 },
      uSeed: { value: Math.random() * 10 },
      uStyle: { value: CLOUD_STYLE[o.style ?? 'speech'] },
      uTailSpace: { value: o.tailSpace ?? 0.18 },
      uTailX: { value: o.tailX ?? -0.4 },
      uFill: { value: new THREE.Color(o.fill ?? 0xfffaf0) },
      uInk: { value: new THREE.Color(o.ink ?? 0x2a2420) },
      uFillAlpha: { value: o.fillAlpha ?? 1 },
    },
  });
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return m;
}
