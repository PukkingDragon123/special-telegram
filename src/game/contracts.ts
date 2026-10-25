import type * as THREE from 'three';
import type { Ent } from '../sim/state';
import type { TL } from '../core/util';
import type { Game } from './game';

/* ============================================================================================
 * SHARED CONTRACTS between modules. Read docs/ARCHITECTURE.md. Keep these stable.
 * ========================================================================================== */

// ---------------------------------------------------------------- characters (module: characters)

export type Sex = 'm' | 'f';
/** Appearance. Replicated on player entities as `look`, on NPCs as `look`. Plain JSON. */
export interface Look {
  sex: Sex;
  /** metres, ~1.5–1.85 */
  height: number;
  /** 0 = skinny … 1 = chubby */
  build: number;
  /** skin colour hex '#c69472' */
  skin: string;
  /** face texture id (public/assets/textures/faces/manifest.json) */
  face: string;
  hair: { style: string; color: string };
  /** clothing ids from the characters module catalogue; colour overrides optional */
  top: { id: string; color?: string };
  bottom: { id: string; color?: string };
  shoes: { id: string; color?: string };
  /** accessory ids: 'sunglasses', 'headband_white', 'cap_*', 'bucket_hat', 'gold_chain', 'watch_casio', 'towel_neck', ... */
  acc: string[];
}

export type AnimName =
  | 'idle' | 'walk' | 'run' | 'tpose' | 'sit' | 'sit_floor' | 'sleep' | 'lie_cardboard'
  | 'slap' | 'get_slapped' | 'highfive' | 'think' | 'scream_run' | 'drunk' | 'celebrate' | 'dance'
  | 'eat' | 'drink' | 'cook_stir' | 'chop' | 'wash' | 'wipe' | 'point' | 'wave' | 'talk' | 'angry'
  | 'push_cart' | 'sad' | 'tug' | 'give' | 'pray' | 'carry_heavy' | 'fall' | 'jenga_pull' | 'stand_cool'
  | 'casino_cheer' | 'casino_despair' | 'wake_up' | 'shrug' | 'count_coins';

export type FaceVariant = 'neutral' | 'think' | 'drunk' | 'sleep' | 'shock' | 'scream';

export type AttachPoint = 'hand_r' | 'hand_l' | 'arm_r' | 'arm_l' | 'head' | 'back' | 'mouth' | 'chest' | 'hip';

export interface CarryPose {
  /** right/left hand holding something, or both hands around a big item */
  r: boolean; l: boolean; two: boolean;
  /** something balanced on the head (one arm up to steady it) */
  head: boolean;
  /** 0..1 total load → hunched posture, wobble */
  load: number;
}

/** A posed, animated, textured low-poly person. */
export interface CharacterRig {
  readonly root: THREE.Object3D;
  look: Look;
  readonly height: number;
  setLook(look: Look): void;
  /** Play an animation (cross-fades). Locomotion is automatic when you call setMove(). */
  play(anim: AnimName, opts?: { loop?: boolean; speed?: number; fade?: number; onEnd?: () => void }): void;
  /** Current horizontal speed in m/s → idle / walk / run blend (unless a one-shot or pose overrides). */
  setMove(speed: number): void;
  setCarry(pose: CarryPose): void;
  /** Static face texture swap (faces never animate). */
  setFace(v: FaceVariant): void;
  /** Turn head toward a world point (or null). */
  lookAt(p: THREE.Vector3 | null): void;
  /** Object3D that follows a body part; parent carried items to it. */
  attach(point: AttachPoint): THREE.Object3D;
  /** Dark featureless silhouette (main menu empty slots). */
  setSilhouette(on: boolean): void;
  /** First-person owner: invisible to camera but still casts shadows. */
  setFirstPerson(on: boolean): void;
  update(dt: number): void;
  dispose(): void;
}

export interface CharacterFactory {
  create(look: Look, opts?: { lod?: 'high' | 'low'; castShadow?: boolean }): CharacterRig;
  /** A random plausible Thai NPC look for an archetype (e.g. 'auntie_vendor', 'office_worker', 'student', 'moto_taxi'). */
  randomLook(archetype?: string, seed?: number): Look;
  /** Default player look for slot 0–3 (the four album-cover outfits). */
  playerLook(slot: number): Look;
  /** Catalogue for the customization magazine. */
  catalogue(): { tops: CatalogItem[]; bottoms: CatalogItem[]; shoes: CatalogItem[]; acc: CatalogItem[]; hair: CatalogItem[]; faces: CatalogItem[]; skins: string[] };
}
export interface CatalogItem { id: string; name: TL; price?: number; colors?: string[]; sex?: Sex | 'u' }

// ---------------------------------------------------------------- world (module: world)

export type ZoneKind = 'soi' | 'market' | 'office' | 'mainroad' | 'rural' | 'temple' | 'canal' | 'shop';

export interface Zone {
  id: string;
  kind: ZoneKind;
  name: TL;
  /** axis-aligned rect [minX, minZ, maxX, maxZ] */
  rect: [number, number, number, number];
  /** price expectation multiplier for food (1 = soi baseline) */
  priceFactor: number;
  /** relative customer flow 0..2 */
  traffic: number;
}

export interface AnchorPt { p: [number, number, number]; yaw?: number; r?: number }

export interface NavGraph {
  /** waypoint path along sidewalks/streets between two points (includes the end point) */
  path(from: THREE.Vector3, to: THREE.Vector3, opts?: { avoidRoads?: boolean }): THREE.Vector3[];
  randomPoint(zone?: string, rng?: () => number): THREE.Vector3;
  nearest(p: THREE.Vector3): THREE.Vector3;
}

export interface WorldAPI {
  /** Named points every module relies on (see docs/MAP_PLAN.md for the full list). */
  anchors: Record<string, AnchorPt>;
  anchor(name: string): AnchorPt;
  zones: Zone[];
  zoneAt(p: ArrayLike<number>): Zone | null;
  nav: NavGraph;
  /** Ground height at x,z. */
  groundY(x: number, z: number): number;
  /** Root object of the static world (added to the world scene). */
  root: THREE.Object3D;
  /** Night lights that should switch on at dusk (modules may register theirs too). */
  addNightLight(light: THREE.Light | THREE.Object3D, intensity?: number): void;
  /** Street drains (manholes / grates with an open shaft), set once the world is built. Critters & water use them. */
  drains?: { p: [number, number, number]; kind: 'manhole' | 'grate' }[];
}

// ---------------------------------------------------------------- modules

export interface GameModule {
  id: string;
  /** Other module ids that must init first. */
  deps?: string[];
  /** Once at boot on every peer: define items, views, intents, event handlers. */
  init?(game: Game): void | Promise<void>;
  /** When the gameplay world scene is entered (every peer). Build visuals, colliders. */
  buildWorld?(game: Game): void | Promise<void>;
  /** HOST only, ~30 Hz: simulation (AI, cooking, economy). */
  hostUpdate?(game: Game, dt: number): void;
  /** Every rendered frame on every peer (visuals, local effects). */
  frame?(game: Game, dt: number): void;
  /** HOST: a new day begins (after sleeping). */
  onNewDay?(game: Game, day: number): void;
}

export function defineModule(m: GameModule): GameModule { return m; }

// ---------------------------------------------------------------- dishes (module: cooking ⇄ restaurant)

/** Recipe ids (menu items). */
export type RecipeId = 'kaphrao_moo' | 'khai_dao' | 'khai_jiao' | 'khao_phat' | 'phat_phrik_kaeng' | 'phat_si_io' | 'rat_na' | 'tom_yam' | 'moo_kratiam' | 'phat_phak_bung' | string;

/**
 * `data` of a finished dish item (kind 'dish'): what customers judge.
 * scores are 0..1 (1 = perfect), `issues` are machine-readable complaints.
 */
export interface DishData {
  recipe: RecipeId;
  /** with fried egg on top? */
  egg?: 'none' | 'crispy' | 'runny' | 'burnt' | 'raw';
  rice: number;            // grams of rice
  portion: number;         // grams of the main
  taste: number;           // overall taste score 0..1
  salty: number;           // -1 bland … 0 good … +1 too salty
  spicy: number;           // 0 none … 1 nuclear
  sweet: number;           // -1 … +1
  cooked: number;          // -1 raw … 0 perfect … +1 burnt
  temp: number;            // 0 cold … 1 hot (cools over time)
  issues: string[];        // 'burnt_garlic','raw_pork','soggy_basil','no_basil','too_oily','burnt','cold','no_rice','no_spoon'...
  cook?: number;           // player entity id who cooked it (XP)
  spoon?: boolean;         // spoon & fork on the plate
  takeaway?: boolean;      // in a bag/box
}

// ---------------------------------------------------------------- misc

export interface Price { base: number; day?: number }
export type { Ent, TL };
