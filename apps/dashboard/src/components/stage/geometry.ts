import type { Curve, Vec3 } from './math.js';

export interface MeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint16Array;
}

/** Axis-aligned box centred on the origin, flat-shaded (24 vertices). */
export function box(hx: number, hy: number, hz: number): MeshData {
  const faces: Array<{ n: Vec3; corners: Vec3[] }> = [
    { n: [0, 0, 1], corners: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, 0, -1], corners: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
    { n: [1, 0, 0], corners: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
    { n: [-1, 0, 0], corners: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    { n: [0, 1, 0], corners: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
    { n: [0, -1, 0], corners: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  faces.forEach((face, f) => {
    for (const c of face.corners) {
      positions.push(...c);
      normals.push(...face.n);
    }
    const o = f * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

/** Rounded bevels keep the broad slab faces readable under the stage's studio light. */
export function bevelledBox(hx: number, hy: number, hz: number, bevel: number, steps = 3): MeshData {
  const half: Vec3 = [hx, hy, hz];
  const radius = Math.min(bevel, hx, hy, hz);
  const core = half.map((h) => h - radius);
  const source = box(hx, hy, hz);
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const fractions = (size: number) => {
    const edge = radius / size;
    return [0, ...Array.from({ length: steps }, (_, i) => edge * (i + 1) / steps),
      ...Array.from({ length: steps }, (_, i) => 1 - edge * (steps - i) / steps), 1];
  };
  for (let face = 0; face < 6; face++) {
    const offset = face * 12;
    const a = [...source.positions.slice(offset, offset + 3)];
    const u = a.map((value, axis) => (source.positions[offset + 3 + axis] ?? 0) - value);
    const v = a.map((value, axis) => (source.positions[offset + 9 + axis] ?? 0) - value);
    const us = fractions(Math.hypot(...u));
    const vs = fractions(Math.hypot(...v));
    const start = positions.length / 3;
    for (const y of vs) {
      for (const x of us) {
        const point = a.map((value, axis) => value + (u[axis] ?? 0) * x + (v[axis] ?? 0) * y);
        const closest = point.map((value, axis) => Math.max(-(core[axis] ?? 0), Math.min(core[axis] ?? 0, value)));
        const direction = point.map((value, axis) => value - (closest[axis] ?? 0));
        const length = Math.hypot(...direction) || 1;
        const normal = direction.map((value) => value / length);
        positions.push(...closest.map((value, axis) => value + (normal[axis] ?? 0) * radius));
        normals.push(...normal);
      }
    }
    for (let y = 0; y < vs.length - 1; y++) {
      for (let x = 0; x < us.length - 1; x++) {
        const a = start + y * us.length + x;
        const b = a + us.length;
        indices.push(a, a + 1, b + 1, a, b + 1, b);
      }
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

export function sphere(radius: number, segments = 40, rings = 24): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const v = r / rings;
    const phi = v * Math.PI;
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const n: Vec3 = [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
      normals.push(...n);
      positions.push(n[0] * radius, n[1] * radius, n[2] * radius);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

/** Torus in the XZ plane. */
export function torus(major: number, minor: number, segments = 96, sides = 14): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = (i / segments) * Math.PI * 2;
    const cu = Math.cos(u);
    const su = Math.sin(u);
    for (let j = 0; j <= sides; j++) {
      const v = (j / sides) * Math.PI * 2;
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      positions.push((major + minor * cv) * cu, minor * sv, (major + minor * cv) * su);
      normals.push(cv * cu, sv, cv * su);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j;
      const b = a + sides + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

/** Flat-shaded octahedron. */
export function octahedron(radius: number): MeshData {
  const v: Vec3[] = [
    [radius, 0, 0], [-radius, 0, 0], [0, radius * 1.25, 0], [0, -radius * 1.25, 0], [0, 0, radius], [0, 0, -radius],
  ];
  const tris: Array<[number, number, number]> = [
    [0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  tris.forEach(([ia, ib, ic], t) => {
    const a = v[ia] ?? [0, 0, 0];
    const b = v[ib] ?? [0, 0, 0];
    const c = v[ic] ?? [0, 0, 0];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) {
      positions.push(...p);
      normals.push(nx, ny, nz);
    }
    indices.push(t * 3, t * 3 + 1, t * 3 + 2);
  });
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

/**
 * Screen-space ribbon data for a curve, drawn as a triangle strip. Each sample emits two
 * vertices (side −1 and +1) carrying their neighbours so the vertex shader can extrude a
 * constant pixel width facing the camera.
 */
export function ribbon(curve: Curve): Float32Array {
  const { points, lengths, total } = curve;
  const stride = 11; // pos3 prev3 next3 side1 t1
  const out = new Float32Array(points.length * 2 * stride);
  points.forEach((p, i) => {
    const prev = points[Math.max(0, i - 1)] ?? p;
    const next = points[Math.min(points.length - 1, i + 1)] ?? p;
    const t = (lengths[i] ?? 0) / total;
    for (let k = 0; k < 2; k++) {
      const o = (i * 2 + k) * stride;
      out.set(p, o);
      out.set(prev, o + 3);
      out.set(next, o + 6);
      out[o + 9] = k === 0 ? -1 : 1;
      out[o + 10] = t;
    }
  });
  return out;
}

/** Deterministic pseudo-random field of dust motes around the stage. */
export function dustField(count: number, seed = 7): Float32Array {
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const out = new Float32Array(count * 5); // pos3 seed1 size1
  for (let i = 0; i < count; i++) {
    const near = rand() < 0.05;
    out[i * 5] = (rand() - 0.5) * (near ? 16 : 26);
    out[i * 5 + 1] = rand() * (near ? 6 : 9) - 0.6;
    out[i * 5 + 2] = near ? 3 + rand() * 4.5 : (rand() - 0.75) * 18;
    out[i * 5 + 3] = rand();
    out[i * 5 + 4] = near ? 0.12 + rand() * 0.24 : 0.012 + rand() * 0.035;
  }
  return out;
}
