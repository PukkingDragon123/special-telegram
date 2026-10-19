/* ============================================================================================
 * Texture atlas layout shared by the geometry generator (UVs) and the painter.
 * Coordinates are in a virtual 1024×1024 canvas (y down); textures use flipY=false so
 * uv.y == canvas y / size. Every region keeps an INSET margin that the painter fills with the
 * same content (mip bleeding guard).
 * ========================================================================================== */

export interface Region { x: number; y: number; w: number; h: number }
export const ATLAS = 1024;
export const INSET = 5;

export const R = {
  torso: { x: 0, y: 0, w: 512, h: 400 },
  leg: { x: 512, y: 0, w: 288, h: 512 },
  arm: { x: 800, y: 0, w: 224, h: 400 },
  face: { x: 0, y: 400, w: 320, h: 320 },
  scalp: { x: 320, y: 400, w: 192, h: 160 },
  neck: { x: 320, y: 560, w: 192, h: 64 },
  hand: { x: 320, y: 624, w: 192, h: 96 },
  foot: { x: 512, y: 512, w: 192, h: 160 },
  hair: { x: 704, y: 400, w: 320, h: 272 },
  skirt: { x: 0, y: 720, w: 400, h: 200 },
  apron: { x: 400, y: 720, w: 128, h: 200 },
  hat: { x: 528, y: 672, w: 256, h: 128 },
  collar: { x: 784, y: 672, w: 240, h: 48 },
  band: { x: 784, y: 720, w: 240, h: 32 },
  towel: { x: 784, y: 752, w: 240, h: 64 },
  mask: { x: 528, y: 800, w: 128, h: 96 },
  pack: { x: 656, y: 800, w: 128, h: 128 },
  sole: { x: 784, y: 816, w: 120, h: 64 },
  ear: { x: 904, y: 816, w: 120, h: 64 },
} satisfies Record<string, Region>;
export type RegionName = keyof typeof R;

/** region-local (s,t ∈ 0..1) → atlas uv (0..1) */
export function ruv(reg: Region, s: number, t: number): [number, number] {
  const cs = s < 0 ? 0 : s > 1 ? 1 : s, ct = t < 0 ? 0 : t > 1 ? 1 : t;
  return [(reg.x + INSET + cs * (reg.w - 2 * INSET)) / ATLAS, (reg.y + INSET + ct * (reg.h - 2 * INSET)) / ATLAS];
}

// ---- landmark mappings (reference body: 1.70 m, metres)

/** torso: t = (TOP - y) / (TOP - BOT) */
export const TORSO_TOP = 1.5, TORSO_BOT = 0.78;
export const torsoT = (y: number) => (TORSO_TOP - y) / (TORSO_TOP - TORSO_BOT);
/** legs: t = (TOP - y) / (TOP - BOT) */
export const LEG_TOP = 1.0, LEG_BOT = 0.0;
export const legT = (y: number) => (LEG_TOP - y) / (LEG_TOP - LEG_BOT);
/** arms: distance d along the arm from the shoulder joint (dome top is negative) */
export const ARM_D0 = -0.06, ARM_D1 = 0.56;
export const armT = (d: number) => (d - ARM_D0) / (ARM_D1 - ARM_D0);
/** neck: by height */
export const NECK_TOP = 1.62, NECK_BOT = 1.4;
export const neckT = (y: number) => (NECK_TOP - y) / (NECK_TOP - NECK_BOT);
/** hand: distance along the hand from the wrist */
export const HAND_D0 = -0.015, HAND_D1 = 0.2;
export const handT = (d: number) => (d - HAND_D0) / (HAND_D1 - HAND_D0);
/** foot: z from heel to toe */
export const FOOT_Z0 = -0.085, FOOT_Z1 = 0.245;
export const footT = (z: number) => (z - FOOT_Z0) / (FOOT_Z1 - FOOT_Z0);

/**
 * Face projection (head-local, relative to the head bone): the 512² face photos are eye-aligned
 * with eye centres at (0.36, 0.44) / (0.64, 0.44) and mouth centre at (0.5, 0.73).
 * Our head has eyes at x=±EYE_X, y=EYE_Y → image u = 0.5 + x / FACE_W, v = 0.44 + (EYE_Y - y) / FACE_H.
 */
export const EYE_X = 0.032, EYE_Y = 0.112, MOUTH_Y = 0.045;
export const FACE_W = EYE_X / 0.14; // 0.2286 m across the image
export const FACE_H = (EYE_Y - MOUTH_Y) / 0.29; // 0.231 m down the image
export const faceU = (x: number) => 0.5 + x / FACE_W;
export const faceV = (y: number) => 0.44 + (EYE_Y - y) / FACE_H;
/** scalp (back of head): cylindrical, angle from ±100° around the back, by height */
export const SCALP_A0 = (100 / 180) * Math.PI;
export const SCALP_TOP = 0.235, SCALP_BOT = -0.035;
