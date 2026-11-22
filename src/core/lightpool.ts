import * as THREE from 'three';

/* ============================================================================================
 * Pooled lights. The number / kind of lights in a scene is part of every lit material's shader key, so a light
 * that is created (or hidden / shown) mid-game makes EVERY lit material recompile on that frame — a big hitch.
 * The world therefore owns these lights from the start, at intensity 0, and features borrow them:
 *   torch  — the hand-held flashlight (SpotLight, follows the item in world space)
 *   card   — the warm key light on the "new recipe" card (PointLight, child of the camera)
 * A borrower stamps the light every frame it wants it; a light nobody stamped for 3 frames goes to 0 by itself
 * (so a dropped / despawned item can't leave it on).
 * ========================================================================================== */

interface Slot<L extends THREE.Light> { light: L | null; base: number; t: number }

const torch: Slot<THREE.SpotLight> = { light: null, base: 30, t: 0 };
const card: Slot<THREE.PointLight> = { light: null, base: 2.2, t: 0 };
// staleness counted in animation frames (not ms): at a low frame rate a ms timeout would switch a light off
// between two frames that both still want it
let tick = 0, running = false;
function sweep() {
  tick++;
  for (const s of [torch, card] as Slot<THREE.Light>[]) if (s.light && s.light.intensity > 0 && tick - s.t > 3) s.light.intensity = 0;
  requestAnimationFrame(sweep);
}

export const LightPool = {
  /** create the pooled lights in a (new) world scene — call once per world build, before shaders are compiled */
  install(scene: THREE.Scene, camera: THREE.Camera) {
    torch.light?.target.removeFromParent(); torch.light?.removeFromParent();
    card.light?.removeFromParent();
    const s = new THREE.SpotLight(0xfff1d0, 0, 22, 0.42, 0.55, 1.6);
    s.name = 'pool:torch'; s.castShadow = false; s.userData.lifeNoFlicker = true;
    scene.add(s, s.target);
    torch.light = s;
    const p = new THREE.PointLight(0xfff0d8, 0, 1.6, 1.5);
    p.name = 'pool:card'; p.castShadow = false; p.userData.lifeNoFlicker = true;
    camera.add(p);
    card.light = p;
    if (!running && typeof requestAnimationFrame === 'function') { running = true; requestAnimationFrame(sweep); }
  },

  /** flashlight on this frame: from `from` towards `to` (world space) */
  torch(from: THREE.Vector3, to: THREE.Vector3, intensity = torch.base) {
    const l = torch.light;
    if (!l) return;
    torch.t = tick;
    l.position.copy(from);
    l.target.position.copy(to);
    l.updateMatrixWorld(); l.target.updateMatrixWorld();
    l.intensity = intensity;
  },
  torchOff() { if (torch.light) torch.light.intensity = 0; },

  /** recipe-card light this frame, at a position in CAMERA space */
  card(local: THREE.Vector3, intensity = card.base) {
    const l = card.light;
    if (!l) return;
    card.t = tick;
    l.position.copy(local);
    l.intensity = intensity;
  },
  cardOff() { if (card.light) card.light.intensity = 0; },
};
