import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { AnchorPt } from '../../game/contracts';
import { Input } from '../../core/input';
import { params } from '../../core/util';
import type { Nav } from './nav';

/**
 * DEBUG HELPERS
 *   ?fly            free-fly camera (WASD + mouse, Shift fast, Space/E up, C/Q down)
 *   ?debug          anchor markers (+ nav graph with ?nav)
 *   window.__world  { cam(x,y,z,yaw,pitch), fly(on) } for screenshot scripts
 */
export interface DebugCam { update(dt: number): void; dispose(): void }

export function installDebug(game: Game, root: THREE.Group, anchors: Record<string, AnchorPt>, nav: Nav): DebugCam {
  const group = new THREE.Group();
  group.name = 'world-debug';
  root.add(group);
  if (game.debug) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3366, depthTest: false });
    for (const [name, a] of Object.entries(anchors)) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 6), mat);
      m.position.set(a.p[0], a.p[1] + 0.25, a.p[2]);
      m.rotation.x = Math.PI;
      m.name = 'anchor:' + name;
      m.renderOrder = 999;
      group.add(m);
    }
    if (params.has('nav')) {
      const pts: number[] = [];
      for (const n of nav.nodes) for (const e of n.e) if (e.to > n.id) { const b = nav.nodes[e.to].p; pts.push(n.p.x, n.p.y + 0.1, n.p.z, b.x, b.y + 0.1, b.z); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x33ffcc, depthTest: false }));
      l.renderOrder = 998;
      group.add(l);
    }
  }
  let flying = params.has('fly');
  let yaw = 0, pitch = 0;
  const pos = new THREE.Vector3();
  let started = false;
  const setFly = (on: boolean) => {
    flying = on;
    if (on) {
      const cam = game.camera;
      pos.copy(cam.position);
      const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
      yaw = e.y; pitch = e.x;
      game.player?.setMode('external');
      Input.setWantLock(true);
    } else game.player?.setMode('play');
  };
  const api = {
    /** place the camera (enables fly mode) */
    cam(x: number, y: number, z: number, yw = 0, pt = 0) {
      if (!flying) setFly(true);
      pos.set(x, y, z); yaw = yw; pitch = pt;
      apply();
    },
    fly: setFly,
    get on() { return flying; },
    /** raycast from the camera through NDC (x,y) → what static world piece is there */
    pick(nx: number, ny: number) {
      const rc = new THREE.Raycaster();
      rc.setFromCamera(new THREE.Vector2(nx, ny), game.camera);
      const hits = rc.intersectObject(root, true).slice(0, 3);
      return hits.map((h) => {
        const g = (h.object as THREE.Mesh).geometry;
        const ex = g.getAttribute('aExtra');
        const i = h.face ? h.face.a : 0;
        return { name: h.object.name, d: +h.distance.toFixed(2), p: h.point.toArray().map((v) => +v.toFixed(2)), extra: ex ? [ex.getX(i), ex.getY(i), ex.getZ(i), ex.getW(i)] : null };
      });
    },
  };
  (window as any).__world = api;
  const apply = () => {
    const cam = game.camera;
    cam.position.copy(pos);
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
  };
  // hide the local player's own body while flying (it stays where it was standing)
  let hidden: THREE.Object3D[] = [];
  const hideSelf = (on: boolean) => {
    if (!on) { for (const o of hidden) o.visible = true; hidden = []; return; }
    const vs = (game as any).views?.of?.(game.localPlayerId) ?? [];
    for (const v of vs) if (v?.object && v.object.visible) { v.object.visible = false; hidden.push(v.object); }
  };
  return {
    update(dt: number) {
      if (!started && flying) { started = true; setFly(true); }
      if (!flying) { if (hidden.length) hideSelf(false); return; }
      hideSelf(true);
      if (Input.locked) { yaw -= Input.mouseDX * Input.sensitivity; pitch = Math.max(-1.5, Math.min(1.5, pitch - Input.mouseDY * Input.sensitivity)); }
      const sp = (Input.isDown('ShiftLeft') ? 22 : 6) * dt;
      const f = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      if (Input.isDown('KeyW')) pos.addScaledVector(f, sp);
      if (Input.isDown('KeyS')) pos.addScaledVector(f, -sp);
      if (Input.isDown('KeyA')) pos.addScaledVector(r, -sp);
      if (Input.isDown('KeyD')) pos.addScaledVector(r, sp);
      if (Input.isDown('Space') || Input.isDown('KeyE')) pos.y += sp;
      if (Input.isDown('KeyC') || Input.isDown('KeyQ')) pos.y -= sp;
      apply();
    },
    dispose() { if ((window as any).__world === api) delete (window as any).__world; },
  };
}
