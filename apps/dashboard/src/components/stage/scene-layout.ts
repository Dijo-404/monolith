import { curveThrough, type Curve, type Vec3 } from './math.js';

/**
 * World layout of the route stage. The browser sits left, the endpoint slab right; the lanes
 * between them are the three paths a read can take, plus the bypassing widget's leak path and
 * the non-anonymous bootstrap lookup.
 */

export const CLIENT: Vec3 = [-4.6, 1.35, 0.4];
export const RELAYS: readonly Vec3[] = [
  [-2.3, 2.75, -0.5],
  [0.0, 3.25, -0.8],
  [2.2, 2.85, -0.6],
];
export const WIDGET: Vec3 = [-3.45, 0.42, 1.65];
export const LEDGER: Vec3 = [1.5, 0.22, 3.15];
export const BOOTSTRAP: Vec3 = [-6.4, 3.35, -1.6];

/** Slab proportions 1 : 4 : 9 (depth : width : height). */
export const SLAB_HALF: Vec3 = [0.88, 1.98, 0.22];
export const SLAB_CENTER: Vec3 = [4.4, SLAB_HALF[1], -0.4];
export const SLAB_YAW = -0.7;

/** World point on the slab's front face from face-local x/y (relative to its centre). */
export function slabFront(localX: number, localY: number): Vec3 {
  const c = Math.cos(SLAB_YAW);
  const s = Math.sin(SLAB_YAW);
  const z = SLAB_HALF[2];
  return [
    SLAB_CENTER[0] + c * localX + s * z,
    SLAB_CENTER[1] + localY,
    SLAB_CENTER[2] - s * localX + c * z,
  ];
}

export const ANON_END = slabFront(-0.25, 0.62);
export const DIRECT_END = slabFront(-0.05, -0.42);
export const LEAK_END = slabFront(0.22, -0.88);

export type LaneKey = 'anon' | 'direct' | 'leak' | 'passthrough' | 'settlement' | 'bootstrap';

export const LANE_CURVES: Readonly<Record<LaneKey, Curve>> = {
  anon: curveThrough([CLIENT, [-3.55, 2.35, -0.1], ...RELAYS, ANON_END], 36),
  direct: curveThrough([CLIENT, [-1.5, 1.05, 1.15], [1.8, 1.12, 1.0], DIRECT_END], 40),
  passthrough: curveThrough([CLIENT, [-1.2, 2.05, 0.55], [2.0, 2.1, 0.3], ANON_END], 40),
  leak: curveThrough([WIDGET, [-1.0, 0.55, 1.9], [2.1, 0.72, 1.35], LEAK_END], 40),
  settlement: curveThrough([CLIENT, [-2.7, 0.62, 2.1], [-0.4, 0.34, 3.0], LEDGER], 40),
  bootstrap: curveThrough([BOOTSTRAP, [-5.7, 2.75, -0.7], CLIENT], 36),
};

/** Points (with room for their labels) that must stay inside the free frame. */
export const FIT_POINTS: readonly Vec3[] = [
  [CLIENT[0] - 1.1, CLIENT[1] - 1.0, CLIENT[2]],
  [CLIENT[0] - 1.1, CLIENT[1] + 1.1, CLIENT[2]],
  [BOOTSTRAP[0] - 0.4, BOOTSTRAP[1] + 0.5, BOOTSTRAP[2]],
  ...RELAYS.map((relay): Vec3 => [relay[0], relay[1] + 0.9, relay[2]]),
  [WIDGET[0] - 0.6, WIDGET[1] - 0.6, WIDGET[2]],
  slabFront(-0.95, SLAB_HALF[1] + 0.45),
  slabFront(0.95, SLAB_HALF[1] + 0.1),
  slabFront(0.95, -SLAB_HALF[1]),
  slabFront(-0.95, -SLAB_HALF[1]),
  [SLAB_CENTER[0] + 1.3, SLAB_CENTER[1], SLAB_CENTER[2] - 0.6],
];

export const SCENE_CENTER: Vec3 = [-0.4, 1.8, 0.4];
export const CAMERA_EYE: Vec3 = [0.6, 3.1, 11.8];
export const CAMERA_TARGET: Vec3 = [-0.2, 1.7, 0.6];

export type AnchorId =
  | 'client'
  | 'worker'
  | 'relay-0'
  | 'relay-1'
  | 'relay-2'
  | 'endpoint'
  | 'endpoint-face'
  | 'widget'
  | 'ledger'
  | 'bootstrap'
  | 'lane-anon'
  | 'lane-direct'
  | 'lane-settlement';

export const ANCHORS: Readonly<Record<AnchorId, Vec3>> = {
  client: [CLIENT[0], CLIENT[1] - 0.82, CLIENT[2]],
  worker: [CLIENT[0], CLIENT[1] + 0.86, CLIENT[2]],
  'relay-0': [RELAYS[0]![0], RELAYS[0]![1] - 0.48, RELAYS[0]![2]],
  'relay-1': [RELAYS[1]![0], RELAYS[1]![1] - 0.48, RELAYS[1]![2]],
  'relay-2': [RELAYS[2]![0], RELAYS[2]![1] - 0.48, RELAYS[2]![2]],
  endpoint: slabFront(-0.95, SLAB_HALF[1] + 0.28),
  'endpoint-face': slabFront(SLAB_HALF[0], 1.1),
  widget: [WIDGET[0], WIDGET[1] - 0.48, WIDGET[2]],
  ledger: [LEDGER[0], LEDGER[1] - 0.38, LEDGER[2]],
  bootstrap: [BOOTSTRAP[0] + 0.35, BOOTSTRAP[1] + 0.05, BOOTSTRAP[2]],
  'lane-anon': [-0.2, 3.95, -0.8],
  'lane-direct': [0.2, 0.86, 1.2],
  'lane-settlement': [-1.4, 0.18, 2.75],
};
