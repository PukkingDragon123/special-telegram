import * as THREE from 'three';
import type { Game } from '../game';
import type { WorldAPI } from '../contracts';
import { ANCHORS, ZONES, zoneAt, MAP_BOUNDS } from '../mapplan';
import { Assets } from '../../core/assets';
import { noiseMaterial } from '../../core/proctex';

/**
 * PLACEHOLDER world (flat blocks laid out per the map plan) so gameplay modules can be built and
 * tested before the real `world` module lands. The world module sets game.world itself.
 */
export function buildStubWorld(game: Game): WorldAPI {
  const root = new THREE.Group();
  root.name = 'stub-world';
  const phys = game.physics;
  const W = MAP_BOUNDS.maxX - MAP_BOUNDS.minX, D = MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ;
  const cx = (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) / 2, cz = (MAP_BOUNDS.minZ + MAP_BOUNDS.maxZ) / 2;

  const mat = (id: string, fallback: number, rep = 1) => (Assets.hasPbr(id) ? Assets.pbr(id, { repeat: rep }) : noiseMaterial(fallback, 'concrete'));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat('concrete_old', 0x8d877c, 60));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, 0, cz);
  ground.receiveShadow = true;
  root.add(ground);
  phys.addBox([cx, -0.5, cz], [W, 1, D]);

  const box = (x0: number, z0: number, x1: number, z1: number, h: number, color: number, y = 0, collide = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, h, z1 - z0), noiseMaterial(color, 'grime'));
    m.position.set((x0 + x1) / 2, y + h / 2, (z0 + z1) / 2);
    m.castShadow = m.receiveShadow = true;
    root.add(m);
    if (collide) phys.addBox([m.position.x, m.position.y, m.position.z], [x1 - x0, h, z1 - z0]);
    return m;
  };
  // roads (dark) & sidewalks (raised)
  const road = (x0: number, z0: number, x1: number, z1: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), noiseMaterial(0x3b3a38, 'concrete', { roughness: 0.95 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, 0.005, (z0 + z1) / 2);
    m.receiveShadow = true;
    root.add(m);
  };
  road(-130, 6, 130, 22);
  road(-3.5, -160, 3.5, 6);
  road(-130, -162, 130, -158);
  box(-130, 2, -3.5, 6, 0.15, 0xa59f93, 0);
  box(3.5, 2, 130, 6, 0.15, 0xa59f93, 0);
  box(-130, 22, 130, 26, 0.15, 0xa59f93, 0);
  box(-6, -158, -3.5, 2, 0.15, 0xa59f93, 0);
  box(3.5, -158, 6, 2, 0.15, 0xa59f93, 0);
  // building blocks
  const shop = 0xc9bba3;
  box(-60, -40, -20, -4, 28, 0x9aa3a8); // office tower
  for (let z = -2; z > -150; z -= 4.2) {
    if (z < -75 && z > -100) continue; // vacant lot (west)
    box(-14, z - 4.1, -6.2, z, 10 + ((z * 7) % 3), shop + ((z * 13) & 0x0f0f0f));
  }
  for (let z = -2; z > -150; z -= 4.2) {
    if (z < -40 && z > -80) continue; // market
    if (z < -16 && z > -30) { box(8, z - 4.1, 16, z, 9, 0xb8a990); continue; } // closed shophouse set back (tables area)
    box(6.2, z - 4.1, 14, z, 10 + ((z * 5) % 3), shop - ((z * 7) & 0x0f0f0f));
  }
  // market shed roof on posts
  const roof = box(6, -80, 50, -40, 0.25, 0x6f6a62, 5.2, false);
  roof.castShadow = true;
  for (let x = 8; x <= 48; x += 8) for (let z = -78; z <= -42; z += 9) box(x - 0.15, z - 0.15, x + 0.15, z + 0.15, 5.2, 0x555049);
  box(30, 28, 110, 80, 12, 0xd4d0c6); // wholesale
  box(-120, 30, 20, 60, 9, shop); // south shophouses
  // canal water
  const water = new THREE.Mesh(new THREE.PlaneGeometry(260, 10), new THREE.MeshStandardMaterial({ color: 0x3c4a3a, roughness: 0.15, metalness: 0.1 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.4, -170);
  root.add(water);
  box(-1.8, -175, 1.8, -165, 0.6, 0x8a8478); // bridge

  // markers for anchors in debug mode
  if (game.debug) for (const [name, a] of Object.entries(ANCHORS)) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.5, 6), new THREE.MeshBasicMaterial({ color: 0xff3366 }));
    m.position.set(a.p[0], a.p[1] + 0.25, a.p[2]);
    m.name = 'anchor:' + name;
    root.add(m);
  }

  // basic atmosphere (real world module replaces with sky shader, HDRI, day/night)
  const sun = new THREE.DirectionalLight(0xfff1d6, 3.2);
  sun.position.set(30, 60, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.far = 200;
  sun.shadow.bias = -0.0004;
  root.add(sun, sun.target);
  root.add(new THREE.HemisphereLight(0xdfe8f0, 0x6b5a48, 1.1));
  game.engine.onLate(() => {
    const p = game.player?.pos;
    if (!p) return;
    sun.target.position.set(p.x, 0, p.z);
    sun.position.set(p.x + 30, 60, p.z + 20);
  });

  const api: WorldAPI = {
    anchors: ANCHORS,
    anchor: (n) => ANCHORS[n] ?? { p: [0, 0, 0] },
    zones: ZONES,
    zoneAt,
    nav: {
      path: (_from, to) => [to.clone()],
      randomPoint: (_zone, r = Math.random) => new THREE.Vector3(-4.8 + (r() < 0.5 ? 0 : 9.6), 0.15, -r() * 140),
      nearest: (p) => p.clone(),
    },
    groundY: (x, z) => (Math.abs(x) > 3.5 && Math.abs(x) < 6 && z < 2 && z > -158 ? 0.15 : 0),
    root,
    addNightLight: () => {},
  };
  game.scene!.add(root);
  if (game.scene) {
    game.scene.background = new THREE.Color(0xc9d3d6);
    game.scene.fog = new THREE.Fog(0xc8cdc6, 30, 220);
  }
  return api;
}
