import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Assets } from '../../core/assets';
import { tex } from './util';

/* ============================================================================================
 * The border casino set: red/gold carpet, damask walls, gold coffered ceiling with chandeliers,
 * a blackjack/baccarat table, a roulette table with a real spinning wheel, slot-machine banks with
 * real (photo) screens, a bar with real Thai beer/whisky labels and an archway onto a second hall.
 * Every surface uses real-photo textures (gen/intro, PBR library). Origin = card table centre.
 * ========================================================================================== */

export const TABLE_Y = 0.78;
export const ROULETTE = { x: 5.6, z: -3.4, wheelX: -0.95, y: 0.82 };
export const SLOTS_POS: { p: [number, number, number]; yaw: number; col: number }[] = [];

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();

function pbr(id: string, repeat: number | [number, number], o: any = {}) {
  const m = Assets.pbr(id, { repeat, ...o });
  return m;
}

/** Lathe [r, y] profile, uv.v = height 0..1, uv.u = angle (front of label at u=0.5 facing +Z). */
export function lathe(profile: [number, number][], segs = 18) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y)), segs, -Math.PI, Math.PI * 2);
  const ys = profile.map((p) => p[1]);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pos = g.getAttribute('position'), uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, uv.getX(i), (pos.getY(i) - y0) / (y1 - y0));
  g.computeVertexNormals();
  return g;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], shadow = true) {
  const o = new THREE.Mesh(g, m);
  o.castShadow = shadow; o.receiveShadow = true;
  return o;
}

/** Glowing, unlit-ish material for screens / neon (bloom picks it up). */
function glow(map: THREE.Texture | null, color: THREE.ColorRepresentation, k = 1.6, o: Partial<THREE.MeshBasicMaterialParameters> = {}) {
  const m = new THREE.MeshBasicMaterial({ map, color: new THREE.Color(color).multiplyScalar(k), ...o });
  return m;
}

export interface CasinoSet {
  root: THREE.Group;
  wheel: THREE.Group;          // spinning roulette disc
  ball: THREE.Mesh;
  wheelCenter: THREE.Vector3;  // world
  slotScreens: THREE.Material[];
  neon: THREE.MeshBasicMaterial;
  stripLights: THREE.InstancedMesh;
  flickerLights: THREE.PointLight[];
  key: THREE.SpotLight;
  rouletteSpot: THREE.SpotLight;
  update(t: number, dt: number): void;
  dispose(): void;
}

export function buildCasino(): CasinoSet {
  const root = new THREE.Group();
  root.name = 'casino-set';
  const W = 28, D = 22, H = 5.2, Z0 = -12, Z1 = 10, X0 = -14, X1 = 14;

  // ---------------------------------------------------------------- floor
  const carpetMap = tex('carpet.jpg', { repeat: [W / 1.35, D / 1.35] });
  const carpetN = Assets.texture('textures/pbr/carpet_casino/normal.jpg', { srgb: false, repeat: [W / 0.8, D / 0.8] });
  const floor = mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: carpetMap, normalMap: carpetN, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.96, color: 0xe6d0c6 }), false);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, (Z0 + Z1) / 2);
  root.add(floor);

  // ---------------------------------------------------------------- walls (damask over teak wainscot, brass rails)
  const damask = new THREE.MeshStandardMaterial({ map: tex('damask.jpg', { repeat: [1, 1] }), roughness: 0.8, color: 0xd8c4bc });
  const teak = pbr('wood_teak', [1, 1]);
  const brass = pbr('brass_gold', [2, 2], { roughness: 0.55 });
  const walls: THREE.BufferGeometry[] = [], wains: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [];
  const wall = (x: number, z: number, len: number, yaw: number, y0 = 1.1, y1 = H) => {
    const g = new THREE.PlaneGeometry(len, y1 - y0);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 1.5, uv.getY(i) * (y1 - y0) / 1.5);
    g.rotateY(yaw).translate(x, (y0 + y1) / 2, z);
    walls.push(g);
  };
  const wain = (x: number, z: number, len: number, yaw: number) => {
    const g = new THREE.BoxGeometry(len, 1.1, 0.06);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 2, uv.getY(i) * 0.55);
    g.rotateY(yaw).translate(x, 0.55, z);
    wains.push(g);
    const r = new THREE.BoxGeometry(len, 0.06, 0.1).rotateY(yaw).translate(x, 1.12, z);
    const r2 = new THREE.BoxGeometry(len, 0.18, 0.14).rotateY(yaw).translate(x, H - 0.09, z);
    rails.push(r, r2);
  };
  // back wall with an archway opening (x -3.2..3.2, height 4)
  const AW = 3.2, AH = 4.0;
  wall((X0 - AW) / 2, Z0, -AW - X0, 0); wall((X1 + AW) / 2, Z0, X1 - AW, 0);
  wall(0, Z0, AW * 2, 0, AH, H);
  wain((X0 - AW) / 2, Z0 + 0.03, -AW - X0, 0); wain((X1 + AW) / 2, Z0 + 0.03, X1 - AW, 0);
  wall(0, Z1, W, Math.PI); wain(0, Z1 - 0.03, W, Math.PI);
  wall(X0, (Z0 + Z1) / 2, D, Math.PI / 2); wain(X0 + 0.03, (Z0 + Z1) / 2, D, Math.PI / 2);
  wall(X1, (Z0 + Z1) / 2, D, -Math.PI / 2); wain(X1 - 0.03, (Z0 + Z1) / 2, D, -Math.PI / 2);
  root.add(mesh(mergeGeometries(walls), damask, false), mesh(mergeGeometries(wains), teak, false), mesh(mergeGeometries(rails), brass, false));

  // archway: brass frame + a corridor into a second hall (real casino-floor photo, seen out of focus)
  const arch = new THREE.Group();
  const frame = [new THREE.BoxGeometry(0.35, AH, 0.4).translate(-AW - 0.17, AH / 2, Z0), new THREE.BoxGeometry(0.35, AH, 0.4).translate(AW + 0.17, AH / 2, Z0), new THREE.BoxGeometry(AW * 2 + 0.7, 0.4, 0.4).translate(0, AH + 0.2, Z0)];
  arch.add(mesh(mergeGeometries(frame), brass));
  const corrMat = damask.clone(); corrMat.color.set(0x8a6a60);
  const corr = [new THREE.PlaneGeometry(6, 4).rotateY(Math.PI / 2).translate(-AW, 2, Z0 - 3), new THREE.PlaneGeometry(6, 4).rotateY(-Math.PI / 2).translate(AW, 2, Z0 - 3)];
  arch.add(mesh(mergeGeometries(corr), corrMat, false));
  const cfloor = mesh(new THREE.PlaneGeometry(AW * 2, 6), floor.material as THREE.Material, false);
  cfloor.rotation.x = -Math.PI / 2; cfloor.position.set(0, 0.001, Z0 - 3);
  arch.add(cfloor);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 6.4), glow(tex('backdrop_baccarat.jpg'), 0xffffff, 1.15, { fog: false }));
  back.position.set(0, 2.6, Z0 - 6.2);
  arch.add(back);
  root.add(arch);

  // neon CASINO letters over the arch (real neon sign, keyed)
  const neon = glow(tex('neon_casino.png'), 0xffd890, 2.4, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const neonM = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 1.0), neon);
  neonM.position.set(0, AH + 0.75, Z0 + 0.02);
  root.add(neonM);

  // ---------------------------------------------------------------- ceiling: dark panels in a gold coffer grid
  const ceilMat = pbr('plaster_painted_clean', [6, 5], { color: '#4a2c1a', roughness: 0.9 });
  const ceil = mesh(new THREE.PlaneGeometry(W, D), ceilMat, false);
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H, (Z0 + Z1) / 2);
  root.add(ceil);
  const beams: THREE.BufferGeometry[] = [];
  for (let x = X0 + 3.5; x < X1; x += 3.5) beams.push(new THREE.BoxGeometry(0.28, 0.32, D).translate(x, H - 0.16, (Z0 + Z1) / 2));
  for (let z = Z0 + 3.66; z < Z1; z += 3.66) beams.push(new THREE.BoxGeometry(W, 0.32, 0.28).translate(0, H - 0.16, z));
  root.add(mesh(mergeGeometries(beams), brass, false));
  // photo chandeliers hanging in the coffers (billboards)
  const chMat = new THREE.SpriteMaterial({ map: tex('chandelier.png'), color: 0xfff0d8, transparent: true, depthWrite: false, fog: true });
  for (let x = X0 + 1.75; x < X1; x += 3.5) for (let z = Z0 + 1.83; z < Z1; z += 3.66) {
    if (Math.abs(x) < 2.5 && Math.abs(z) < 2.5) continue;
    const s = new THREE.Sprite(chMat);
    s.scale.set(1.25, 0.94, 1);
    s.position.set(x, H - 0.62, z);
    root.add(s);
  }

  // ---------------------------------------------------------------- 3D crystal chandeliers over the tables
  const chand = buildChandelier(brass);
  for (const [x, z] of [[0, 0], [ROULETTE.x, ROULETTE.z]] as [number, number][]) {
    const c = chand.clone();
    c.position.set(x, H - 0.05, z);
    root.add(c);
  }

  // ---------------------------------------------------------------- columns
  const colG = lathe([[0.42, 0], [0.42, 0.25], [0.32, 0.4], [0.28, 0.6], [0.26, 4.4], [0.32, 4.6], [0.44, 4.85], [0.44, H]], 20);
  for (const [x, z] of [[-7.5, -6.5], [7.5, -6.5], [-7.5, 4.5], [9.5, 4.5]] as [number, number][]) {
    const c = mesh(colG, brass);
    c.position.set(x, 0, z);
    root.add(c);
  }

  // ---------------------------------------------------------------- card table (kidney / half-moon) at the origin
  root.add(buildCardTable(teak));

  // ---------------------------------------------------------------- roulette table + wheel
  const rt = buildRoulette(teak, brass);
  root.add(rt.group);

  // ---------------------------------------------------------------- slot machine banks
  const slots = buildSlots();
  root.add(slots.group);

  // ---------------------------------------------------------------- bar with real Thai labels
  root.add(buildBar(teak, brass));

  // ---------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(0xffe2b8, 0x3a0d0a, 1.1);
  root.add(hemi);
  const key = new THREE.SpotLight(0xffd7a0, 200, 14, 0.62, 0.55, 1.4);
  key.position.set(0.2, H - 0.4, 0.4);
  key.target.position.set(0, TABLE_Y, 0.15);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.camera.near = 1; key.shadow.camera.far = 8;
  root.add(key, key.target);
  const rouletteSpot = new THREE.SpotLight(0xffd7a0, 170, 12, 0.6, 0.6, 1.4);
  rouletteSpot.position.set(ROULETTE.x, H - 0.4, ROULETTE.z + 0.2);
  rouletteSpot.target.position.set(ROULETTE.x, ROULETTE.y, ROULETTE.z);
  root.add(rouletteSpot, rouletteSpot.target);
  const warm = (x: number, y: number, z: number, i: number, d = 12) => { const l = new THREE.PointLight(0xffc27a, i, d, 1.6); l.position.set(x, y, z); root.add(l); return l; };
  warm(0, H - 1.0, 0, 34); warm(ROULETTE.x, H - 1.0, ROULETTE.z, 28); warm(10.5, 3.2, 0, 26); warm(-4, 3.6, -8, 22); warm(0, 3.2, 6, 22); warm(-9, 3.4, 4, 18);
  const flickerLights = [new THREE.PointLight(0xff3fd2, 9, 7, 1.6), new THREE.PointLight(0x3fd8ff, 7, 7, 1.6), new THREE.PointLight(0xffb03f, 8, 7, 1.6)];
  flickerLights[0].position.set(-12.2, 1.6, -6); flickerLights[1].position.set(-8.5, 1.8, -3); flickerLights[2].position.set(-12.2, 1.6, -1.5);
  root.add(...flickerLights);

  const set: CasinoSet = {
    root,
    wheel: rt.wheel, ball: rt.ball, wheelCenter: rt.center,
    slotScreens: slots.screens, neon, stripLights: slots.strips, flickerLights, key, rouletteSpot,
    update(t: number) {
      // slot screens & strips pulse at 2–6 Hz (NOTES: coloured rim light flicker)
      slots.screens.forEach((m: any, i) => { const k = 1.25 + 0.25 * Math.sin(t * (3 + i * 1.7)) + (Math.sin(t * 13 + i) > 0.96 ? 0.6 : 0); m.color.setScalar(k); });
      flickerLights.forEach((l, i) => { l.intensity = 6 + 4 * Math.max(0, Math.sin(t * (2.2 + i * 1.3) + i * 2)); });
      neon.color.setRGB(2.4 + Math.sin(t * 9) * 0.15, 2.0, 1.4);
      const sc = slots.strips;
      const c = new THREE.Color();
      for (let i = 0; i < sc.count; i++) { const h = (t * 0.25 + i * 0.13) % 1; c.setHSL(h, 1, 0.55).multiplyScalar(1.8); sc.setColorAt(i, c); }
      if (sc.instanceColor) sc.instanceColor.needsUpdate = true;
    },
    dispose() {
      root.traverse((o: any) => { o.geometry?.dispose?.(); });
    },
  };
  return set;
}

// ------------------------------------------------------------------ pieces

function buildChandelier(brass: THREE.Material) {
  const g = new THREE.Group();
  const body = lathe([[0.02, 0], [0.06, -0.3], [0.16, -0.62], [0.24, -0.7], [0.08, -0.78], [0.11, -0.95], [0.02, -1.1]], 16);
  const arms: THREE.BufferGeometry[] = [body];
  const bulbs: THREE.BufferGeometry[] = [];
  const drops: THREE.BufferGeometry[] = [];
  const N = 10;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(ca * 0.12, -0.68, sa * 0.12), new THREE.Vector3(ca * 0.45, -0.9, sa * 0.45), new THREE.Vector3(ca * 0.7, -0.78, sa * 0.7), new THREE.Vector3(ca * 0.74, -0.6, sa * 0.74)]);
    arms.push(new THREE.TubeGeometry(curve, 12, 0.014, 5));
    arms.push(new THREE.CylinderGeometry(0.035, 0.025, 0.04, 8).translate(ca * 0.74, -0.6, sa * 0.74));
    bulbs.push(new THREE.SphereGeometry(0.03, 8, 6).scale(1, 1.5, 1).translate(ca * 0.74, -0.53, sa * 0.74));
    for (let k = 0; k < 3; k++) {
      const r = 0.25 + k * 0.17;
      drops.push(new THREE.OctahedronGeometry(0.022, 0).scale(1, 1.8, 1).translate(Math.cos(a + k * 0.3) * r, -0.86 - k * 0.04 - Math.random() * 0.05, Math.sin(a + k * 0.3) * r));
    }
  }
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    drops.push(new THREE.OctahedronGeometry(0.018, 0).scale(1, 2, 1).translate(Math.cos(a) * 0.2, -1.0 - (i % 3) * 0.05, Math.sin(a) * 0.2));
  }
  g.add(mesh(mergeGeometries(arms), brass, false));
  g.add(new THREE.Mesh(mergeGeometries(bulbs), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0c8).multiplyScalar(4) })));
  const crystal = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.04, envMapIntensity: 3 });
  g.add(new THREE.Mesh(mergeGeometries(drops), crystal));
  return g;
}

function buildCardTable(teak: THREE.Material) {
  const g = new THREE.Group();
  g.name = 'card-table';
  const shape = new THREE.Shape();
  shape.moveTo(-1.35, 0.55);
  shape.lineTo(1.35, 0.55);
  shape.absellipse(0, 0.55, 1.35, 1.3, 0, Math.PI, true);
  const felt = Assets.pbr('felt_casino_green', { repeat: 2.2, color: '#6f7d6c' });
  const top = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 1, curveSegments: 36 });
  top.rotateX(-Math.PI / 2).translate(0, TABLE_Y - 0.04, 0);
  g.add(mesh(top, felt));
  const skirt = new THREE.ExtrudeGeometry(shape, { depth: 0.66, bevelEnabled: false, curveSegments: 36 });
  skirt.scale(0.92, 0.92, 1).rotateX(-Math.PI / 2).translate(0, 0.06, 0);
  g.add(mesh(skirt, teak));
  // padded leather arm rest along the curve
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) { const a = Math.PI + (i / 40) * Math.PI; pts.push(new THREE.Vector3(Math.cos(a) * 1.36, TABLE_Y + 0.01, -(0.55 + Math.sin(a) * 1.31))); }
  const rail = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.055, 8);
  g.add(mesh(rail, Assets.pbr('leather_black', { repeat: [12, 1] })));
  // dealer chip tray + card shoe
  const tray = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.05, 0.22, 2, 0.01), Assets.pbr('chrome', { repeat: 1, roughness: 0.4 }));
  tray.position.set(0, TABLE_Y + 0.005, -0.42);
  g.add(tray);
  const shoe = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.1, 0.3, 2, 0.015), Assets.pbr('plastic_glossy', { repeat: 1, color: '#2a1a12' }));
  shoe.position.set(0.62, TABLE_Y + 0.05, -0.36); shoe.rotation.y = 0.4;
  g.add(shoe);
  // betting circles: thin brass rings on the felt
  const rings: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) { const a = Math.PI * (0.18 + i * 0.16); rings.push(new THREE.RingGeometry(0.075, 0.085, 28).rotateX(-Math.PI / 2).translate(Math.cos(a) * 0.95, TABLE_Y + 0.002, -0.55 + Math.sin(a) * 0.95)); }
  g.add(new THREE.Mesh(mergeGeometries(rings), new THREE.MeshStandardMaterial({ color: 0xe8c66a, metalness: 0.6, roughness: 0.4 })));
  return g;
}

function buildRoulette(teak: THREE.Material, brass: THREE.Material) {
  const group = new THREE.Group();
  group.position.set(ROULETTE.x, 0, ROULETTE.z);
  const felt = Assets.pbr('felt_casino_green', { repeat: [5, 2.5], color: '#6f7d6c' });
  const top = new THREE.Mesh(new RoundedBoxGeometry(2.8, 0.08, 1.3, 2, 0.03), felt);
  top.position.set(0.25, ROULETTE.y - 0.04, 0); top.receiveShadow = true;
  group.add(top);
  const base = mesh(new RoundedBoxGeometry(2.6, 0.72, 1.1, 2, 0.04), teak);
  base.position.set(0.25, 0.38, 0);
  group.add(base);
  // number grid lines (brass inlay strips) on the layout
  const lines: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= 12; i++) lines.push(new THREE.BoxGeometry(0.008, 0.002, 0.66).translate(-0.1 + i * 0.12, ROULETTE.y + 0.001, 0.05));
  for (let j = 0; j <= 3; j++) lines.push(new THREE.BoxGeometry(1.44, 0.002, 0.008).translate(0.62, ROULETTE.y + 0.001, -0.28 + j * 0.22));
  group.add(new THREE.Mesh(mergeGeometries(lines), new THREE.MeshStandardMaterial({ color: 0xf2e6c0, roughness: 0.6 })));
  // wheel bowl
  const wx = ROULETTE.wheelX;
  const bowl = mesh(lathe([[0.0, 0.0], [0.5, 0.0], [0.55, 0.06], [0.55, 0.12], [0.5, 0.13], [0.46, 0.08], [0.42, 0.06]], 40), teak);
  bowl.position.set(wx, ROULETTE.y, 0);
  group.add(bowl);
  const wheel = new THREE.Group();
  wheel.position.set(wx, ROULETTE.y + 0.06, 0);
  const discG = new THREE.CylinderGeometry(0.42, 0.4, 0.03, 48, 1);
  const discMat = new THREE.MeshStandardMaterial({ map: tex('roulette.jpg'), roughness: 0.45, metalness: 0.1, color: 0xb8b0a8 });
  const discSide = Assets.pbr('wood_teak', { repeat: [4, 0.2] });
  const disc = new THREE.Mesh(discG, [discSide, discMat, discSide]);
  disc.receiveShadow = true;
  wheel.add(disc);
  const turret = mesh(lathe([[0.06, 0], [0.05, 0.03], [0.018, 0.05], [0.014, 0.16], [0.03, 0.18], [0.012, 0.2], [0.002, 0.22]], 16), brass);
  turret.position.y = 0.015;
  wheel.add(turret);
  for (let i = 0; i < 4; i++) { const arm = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6).rotateZ(Math.PI / 2).translate(0.08, 0.18, 0), brass, false); arm.rotation.y = (i * Math.PI) / 2; wheel.add(arm); }
  group.add(wheel);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.011, 12, 8), new THREE.MeshStandardMaterial({ color: 0xfafaf4, roughness: 0.15 }));
  ball.castShadow = true;
  group.add(ball);
  const center = new THREE.Vector3(ROULETTE.x + wx, ROULETTE.y + 0.075, ROULETTE.z);
  return { group, wheel, ball, center };
}

function buildSlots() {
  const group = new THREE.Group();
  group.name = 'slots';
  SLOTS_POS.length = 0;
  for (let i = 0; i < 9; i++) SLOTS_POS.push({ p: [-13.45, 0, -10.2 + i * 1.08], yaw: Math.PI / 2, col: i % 3 });
  for (let i = 0; i < 4; i++) {
    SLOTS_POS.push({ p: [-8.9, 0, -8.2 + i * 1.08], yaw: -Math.PI / 2, col: (i + 1) % 3 });
    SLOTS_POS.push({ p: [-8.1, 0, -8.2 + i * 1.08], yaw: Math.PI / 2, col: (i + 2) % 3 });
  }
  const N = SLOTS_POS.length;
  const cab = Assets.pbr('plastic_glossy', { repeat: 1, color: '#2a1418', roughness: 0.35 });
  const chrome = Assets.pbr('chrome', { repeat: 1, roughness: 0.25 });
  const leather = Assets.pbr('leather_red_quilted', { repeat: 1 });
  const parts: { g: THREE.BufferGeometry; m: THREE.Material; shadow?: boolean }[] = [
    { g: new THREE.BoxGeometry(0.62, 0.16, 0.55).translate(0, 0.08, 0), m: chrome },
    { g: new RoundedBoxGeometry(0.66, 1.25, 0.58, 2, 0.04).translate(0, 0.78, 0), m: cab, shadow: true },
    { g: new RoundedBoxGeometry(0.64, 0.34, 0.5, 2, 0.06).translate(0, 1.6, -0.02), m: cab },
    { g: new THREE.BoxGeometry(0.6, 0.07, 0.24).rotateX(0.25).translate(0, 0.6, 0.36), m: chrome },
    { g: new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16).translate(0, 0.62, 0.95), m: leather },
    { g: new THREE.CylinderGeometry(0.025, 0.025, 0.58, 8).translate(0, 0.31, 0.95), m: chrome },
    { g: new THREE.CylinderGeometry(0.22, 0.24, 0.03, 16).translate(0, 0.015, 0.95), m: chrome },
  ];
  const place = (im: THREE.InstancedMesh, filter?: (i: number) => boolean) => {
    let n = 0;
    for (let i = 0; i < N; i++) {
      if (filter && !filter(i)) continue;
      const s = SLOTS_POS[i];
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
      im.setMatrixAt(n++, _m.compose(_p.set(s.p[0], s.p[1], s.p[2]), _q, _s));
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
  };
  for (const pt of parts) {
    const im = new THREE.InstancedMesh(pt.g, pt.m, N);
    im.castShadow = !!pt.shadow; im.receiveShadow = true;
    place(im);
    group.add(im);
  }
  // screens: 3 materials (one per photo column of the atlas)
  const screens: THREE.Material[] = [];
  const atlas = tex('slots.jpg', { wrap: false });
  for (let c = 0; c < 3; c++) {
    const t = atlas.clone();
    t.repeat.set(341 / 1024, 1); t.offset.set((c * 341) / 1024, 0); t.needsUpdate = true;
    const m = new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.3, 1.3, 1.3) });
    screens.push(m);
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.5, 0.75).rotateX(-0.1).translate(0, 1.02, 0.296), m, N);
    place(im, (i) => SLOTS_POS[i].col === c);
    group.add(im);
  }
  // topper glow panel (top sign) and coloured edge light strips
  const topGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.56, 0.24).translate(0, 1.6, 0.235), new THREE.MeshBasicMaterial({ map: atlas, color: new THREE.Color(1.6, 1.4, 1.2) }), N);
  (topGlow.material as any).map = (() => { const t = atlas.clone(); t.repeat.set(330 / 1024, 0.16); t.offset.set(690 / 1024, 0.82); t.needsUpdate = true; return t; })();
  place(topGlow);
  group.add(topGlow);
  const sg = mergeGeometries([new THREE.BoxGeometry(0.018, 1.18, 0.018).translate(-0.335, 0.8, 0.29), new THREE.BoxGeometry(0.018, 1.18, 0.018).translate(0.335, 0.8, 0.29), new THREE.BoxGeometry(0.66, 0.018, 0.018).translate(0, 1.44, 0.29)]);
  const strips = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: 0xffffff }), N);
  place(strips);
  for (let i = 0; i < N; i++) strips.setColorAt(i, new THREE.Color().setHSL(i / N, 1, 0.6));
  group.add(strips);
  return { group, screens, strips };
}

function buildBar(teak: THREE.Material, brass: THREE.Material) {
  const g = new THREE.Group();
  g.name = 'bar';
  const X = 12.4;
  const counter = mesh(new RoundedBoxGeometry(0.8, 1.08, 7, 2, 0.04), teak);
  counter.position.set(X - 1.2, 0.54, -1);
  g.add(counter);
  const marble = mesh(new RoundedBoxGeometry(0.95, 0.06, 7.2, 2, 0.02), Assets.pbr('marble_white', { repeat: [1, 6] }));
  marble.position.set(X - 1.2, 1.11, -1);
  g.add(marble);
  const shelfG: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) shelfG.push(new THREE.BoxGeometry(0.4, 0.04, 6.6).translate(X + 1.3, 1.2 + k * 0.55, -1));
  g.add(mesh(mergeGeometries(shelfG), brass, false));
  // bottles on the shelves (real labels: Singha, Chang, Leo, SangSom, a Bordeaux, a sparkling)
  const kinds = ['singha', 'chang', 'leo', 'sangsom', 'wine', 'champagne'];
  let n = 0;
  for (let k = 0; k < 3; k++) for (let i = 0; i < 16; i++) {
    const b = makeBottle(kinds[(i + k * 2) % kinds.length]);
    b.position.set(X + 1.3 + (i % 2) * 0.08, 1.22 + k * 0.55, -4 + i * 0.38 + (k % 2) * 0.1);
    b.rotation.y = -Math.PI / 2 + (Math.random() - 0.5) * 0.5;
    g.add(b);
    n++;
  }
  // back-bar mirror glow
  const mirror = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 1.8), new THREE.MeshStandardMaterial({ color: 0x6a4a30, metalness: 1, roughness: 0.12, envMapIntensity: 1.4 }));
  mirror.rotation.y = -Math.PI / 2; mirror.position.set(13.9, 2, -1);
  g.add(mirror);
  return g;
}

// ------------------------------------------------------------------ bottles & glasses (real labels)

const bottleCache = new Map<string, { g: THREE.BufferGeometry; glass: THREE.Material; label: THREE.Material; lg: THREE.BufferGeometry; extra?: [THREE.BufferGeometry, THREE.Material] }>();

const LABELS: Record<string, { file: string; gen?: boolean }> = {
  singha: { file: 'img/labels/beer_singha_bottle.png' }, chang: { file: 'img/labels/beer_chang_bottle.png' }, leo: { file: 'img/labels/beer_leo_bottle.png' },
  sangsom: { file: 'img/labels/whisky_sangsom.png' }, wine: { file: 'wine_label.jpg', gen: true }, champagne: { file: 'champagne_label.jpg', gen: true },
};

/** A drink bottle with its real label. Origin = bottom centre. */
export function makeBottle(kind: string): THREE.Group {
  let c = bottleCache.get(kind);
  if (!c) {
    const beer = kind === 'singha' || kind === 'chang' || kind === 'leo';
    const prof: [number, number][] = beer
      ? [[0.0, 0], [0.032, 0], [0.034, 0.01], [0.034, 0.15], [0.03, 0.18], [0.014, 0.22], [0.012, 0.26], [0.014, 0.265], [0.0, 0.268]]
      : kind === 'sangsom'
        ? [[0, 0], [0.04, 0], [0.042, 0.01], [0.042, 0.17], [0.034, 0.2], [0.015, 0.23], [0.014, 0.28], [0.016, 0.285], [0, 0.29]]
        : [[0, 0], [0.037, 0], [0.039, 0.012], [0.039, 0.2], [0.032, 0.24], [0.014, 0.27], [0.013, 0.31], [0.015, 0.315], [0, 0.318]];
    const g = lathe(prof, 14);
    const glassColor = kind === 'chang' || kind === 'wine' || kind === 'champagne' ? 0x1e4a22 : kind === 'sangsom' ? 0x5a2a0c : 0x4a2608;
    const glass = new THREE.MeshStandardMaterial({ color: glassColor, roughness: 0.08, metalness: 0.1, envMapIntensity: 2.2, transparent: true, opacity: 0.88 });
    const L = LABELS[kind] ?? LABELS.singha;
    const map = L.gen ? tex(L.file) : Assets.texture(L.file, { srgb: true, wrap: false });
    const r = (beer ? 0.0345 : kind === 'sangsom' ? 0.0425 : 0.0395);
    const h = beer ? 0.07 : 0.09;
    const lg = new THREE.CylinderGeometry(r, r, h, 16, 1, true, -Math.PI / 2 - 1.1, 2.2).translate(0, beer ? 0.085 : 0.11, 0);
    const label = new THREE.MeshStandardMaterial({ map, roughness: 0.55, side: THREE.DoubleSide });
    let extra: [THREE.BufferGeometry, THREE.Material] | undefined;
    if (kind === 'champagne') extra = [new THREE.CylinderGeometry(0.016, 0.03, 0.1, 12, 1, true).translate(0, 0.27, 0), Assets.pbr('brass_gold', { repeat: 1, roughness: 0.3 })];
    c = { g, glass, label, lg, extra };
    bottleCache.set(kind, c);
  }
  const grp = new THREE.Group();
  const b = new THREE.Mesh(c.g, c.glass); b.castShadow = true;
  grp.add(b, new THREE.Mesh(c.lg, c.label));
  if (c.extra) grp.add(new THREE.Mesh(c.extra[0], c.extra[1]));
  return grp;
}

export function makeGlass(kind: 'wine' | 'beer'): THREE.Group {
  const g = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, envMapIntensity: 2.5, depthWrite: false });
  if (kind === 'wine') {
    g.add(new THREE.Mesh(lathe([[0.035, 0], [0.004, 0.006], [0.004, 0.09], [0.03, 0.11], [0.042, 0.15], [0.036, 0.2]], 16), glass));
    const liq = new THREE.Mesh(lathe([[0.0, 0.1], [0.026, 0.112], [0.038, 0.14], [0.0, 0.14]], 16), new THREE.MeshStandardMaterial({ color: 0x5a0410, roughness: 0.1 }));
    g.add(liq);
  } else {
    g.add(new THREE.Mesh(lathe([[0.03, 0], [0.033, 0.005], [0.04, 0.16], [0.0, 0.16]].slice(0, 3) as any, 16), glass));
    g.add(new THREE.Mesh(lathe([[0.0, 0.004], [0.031, 0.006], [0.037, 0.12], [0.0, 0.12]], 16), new THREE.MeshStandardMaterial({ color: 0xc8860c, roughness: 0.15, transparent: true, opacity: 0.85 })));
    g.add(new THREE.Mesh(lathe([[0.0, 0.12], [0.037, 0.12], [0.039, 0.145], [0.0, 0.15]], 16), new THREE.MeshStandardMaterial({ color: 0xfff6e2, roughness: 0.9 })));
  }
  return g;
}
