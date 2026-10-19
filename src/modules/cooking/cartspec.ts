/**
 * Food-cart layout (cart-local metres). +X = handle end, -X = burner end, -Z = customer side
 * (glass display), +Z = vendor side. y = 0 is the ground. Cart `yaw` rotates local → world.
 */
export const CART = {
  top: 0.86,                        // counter surface height
  body: { x0: -0.76, x1: 0.76, z0: -0.35, z1: 0.35, y0: 0.24, y1: 0.83 },
  slab: { x0: -0.8, x1: 0.8, z0: -0.38, z1: 0.38 },
  flap: { x0: 0.8, x1: 1.12, z0: -0.3, z1: 0.3, y: 0.83 },
  burner: { x: -1.0, z: 0.02, y: 0.6 },   // burner head
  stand: 0.72,                      // wok stand top (wok bottom rests here)
  glass: { x0: -0.6, x1: 0.32, z0: -0.36, z1: 0.0, y1: 1.3, shelf: 1.07 },
  handleX: 1.27,
  wheelX: 0.28, wheelR: 0.33,
  tank: { x: -1.02, z: 0.55 },
  knob: { x: -0.86, y: 0.6, z: 0.24 },
  pushLen: 1.62,                    // cart centre → pusher position
};

/** Named spots where things go on the cart (local [x, y, z, yaw]). */
export const SPOTS: Record<string, [number, number, number, number]> = {
  burner: [CART.burner.x, CART.stand, CART.burner.z, Math.PI],
  board: [0.96, CART.flap.y + 0.005, 0.0, 0],
  mortar: [-0.42, CART.top, 0.2, 0],
  rice: [0.5, CART.top, 0.18, Math.PI],
  plates: [0.1, CART.top, 0.22, 0],
  plates2: [0.1, CART.top + 0.026, 0.22, 0.4],
  plates3: [0.1, CART.top + 0.052, 0.22, 0.9],
  book: [0.62, CART.top, -0.18, 0.2],
  spatula: [-0.62, CART.top, 0.28, -1.2],
  ladle: [-0.55, CART.top, 0.32, -1.3],
  cleaver: [0.98, CART.flap.y + 0.055, 0.12, 0.3],
  spoon1: [0.28, CART.top, 0.3, 0.2],
  spoon2: [0.33, CART.top, 0.3, 0.3],
  eggs: [-0.12, CART.top, 0.2, 0],
  // sauce rack (vendor edge)
  rack0: [-0.25, CART.top, 0.31, Math.PI],
  rack1: [-0.16, CART.top, 0.31, Math.PI],
  rack2: [-0.07, CART.top, 0.31, Math.PI],
  rack3: [0.02, CART.top, 0.32, Math.PI],
  rack4: [0.62, CART.top, 0.05, Math.PI],
  rack5: [0.7, CART.top, 0.05, Math.PI],
  rack6: [0.7, CART.top, -0.06, Math.PI],
  rack7: [0.62, CART.top, -0.06, Math.PI],
  // glass display box (customer sees the ingredients)
  disp0: [-0.45, CART.top + 0.005, -0.2, 0],
  disp1: [-0.22, CART.top + 0.005, -0.2, 0],
  disp2: [0.02, CART.top + 0.005, -0.2, 0],
  disp3: [0.22, CART.top + 0.005, -0.2, 0],
  shelf0: [-0.42, CART.glass.shelf + 0.005, -0.18, 0],
  shelf1: [-0.18, CART.glass.shelf + 0.005, -0.18, 0],
  shelf2: [0.06, CART.glass.shelf + 0.005, -0.18, 0],
  shelf3: [0.24, CART.glass.shelf + 0.005, -0.18, 0],
};

/** Bounds of the cart for placing / adopting items (local). */
export const CART_BOUNDS = { x0: -1.2, x1: 1.15, z0: -0.4, z1: 0.42, y0: 0.5, y1: 1.32 };

/** Surfaces items may rest on (local rects + height). */
export const SURFACES: { x0: number; x1: number; z0: number; z1: number; y: number; name: string }[] = [
  { name: 'counter', x0: -0.79, x1: 0.79, z0: -0.37, z1: 0.37, y: CART.top },
  { name: 'flap', x0: 0.8, x1: 1.12, z0: -0.3, z1: 0.3, y: CART.flap.y },
  { name: 'shelf', x0: CART.glass.x0 + 0.02, x1: CART.glass.x1 - 0.02, z0: CART.glass.z0 + 0.02, z1: CART.glass.z1 - 0.02, y: CART.glass.shelf },
  { name: 'stand', x0: -1.18, x1: -0.82, z0: -0.18, z1: 0.22, y: CART.stand },
];

export function surfaceAt(x: number, z: number, yHint: number) {
  let best: (typeof SURFACES)[number] | null = null, bd = Infinity;
  for (const s of SURFACES) {
    if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
    const d = Math.abs(s.y - yHint);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
