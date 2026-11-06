export type Vec3 = readonly [number, number, number];
export type Mat4 = Float32Array;

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = normalize(sub(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  const out = new Float32Array(16);
  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[12] = -dot(x, eye);
  out[13] = -dot(y, eye);
  out[14] = -dot(z, eye);
  out[15] = 1;
  return out;
}

/** Column-major a × b. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0);
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** Translation × rotationY × scale. */
export function model(position: Vec3, yaw = 0, size: Vec3 = [1, 1, 1], pitch = 0): Mat4 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);
  // R = Ry * Rx
  const out = new Float32Array(16);
  out[0] = cy * size[0];
  out[1] = 0;
  out[2] = -sy * size[0];
  out[4] = sy * sx * size[1];
  out[5] = cx * size[1];
  out[6] = cy * sx * size[1];
  out[8] = sy * cx * size[2];
  out[9] = -sx * size[2];
  out[10] = cy * cx * size[2];
  out[12] = position[0];
  out[13] = position[1];
  out[14] = position[2];
  out[15] = 1;
  return out;
}

/** Clip-space position of a world point. */
export function project(m: Mat4, p: Vec3): [number, number, number, number] {
  const x = p[0];
  const y = p[1];
  const z = p[2];
  return [
    (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
    (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
    (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0),
    (m[3] ?? 0) * x + (m[7] ?? 0) * y + (m[11] ?? 0) * z + (m[15] ?? 0),
  ];
}

/** A sampled curve with arc-length lookup. */
export interface Curve {
  readonly points: readonly Vec3[];
  readonly lengths: readonly number[];
  readonly total: number;
}

function catmull(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])];
}

export function curveThrough(controls: readonly Vec3[], samplesPerSegment = 32): Curve {
  const points: Vec3[] = [];
  const at = (i: number): Vec3 => controls[Math.max(0, Math.min(controls.length - 1, i))] ?? [0, 0, 0];
  for (let i = 0; i < controls.length - 1; i++) {
    for (let s = 0; s < samplesPerSegment; s++) {
      points.push(catmull(at(i - 1), at(i), at(i + 1), at(i + 2), s / samplesPerSegment));
    }
  }
  points.push(at(controls.length - 1));
  const lengths: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1] ?? points[0] ?? [0, 0, 0];
    const cur = points[i] ?? prev;
    lengths.push((lengths[i - 1] ?? 0) + length(sub(cur, prev)));
  }
  return { points, lengths, total: lengths[lengths.length - 1] ?? 1 };
}

/** Point at arc-length fraction t ∈ [0, 1]. */
export function pointAt(curve: Curve, t: number): Vec3 {
  const target = Math.max(0, Math.min(1, t)) * curve.total;
  let lo = 0;
  let hi = curve.lengths.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if ((curve.lengths[mid] ?? 0) < target) lo = mid;
    else hi = mid;
  }
  const a = curve.lengths[lo] ?? 0;
  const b = curve.lengths[hi] ?? a;
  const f = b > a ? (target - a) / (b - a) : 0;
  const pa = curve.points[lo] ?? [0, 0, 0];
  const pb = curve.points[hi] ?? pa;
  return lerp(pa, pb, f);
}

/** Arc-length fraction of the sample closest to p. */
export function fractionNearest(curve: Curve, p: Vec3): number {
  let best = 0;
  let bestDistance = Infinity;
  curve.points.forEach((point, index) => {
    const d = length(sub(point, p));
    if (d < bestDistance) {
      bestDistance = d;
      best = index;
    }
  });
  return (curve.lengths[best] ?? 0) / curve.total;
}

export function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}
