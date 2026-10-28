import type { V2, V3, M4 } from './types';

export const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: V3) => Math.hypot(a[0], a[1], a[2]),
  dist: (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  norm: (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  neg: (a: V3): V3 => [-a[0], -a[1], -a[2]],
  lerp: (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  eq: (a: V3, b: V3, tol = 1e-6) => Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol && Math.abs(a[2] - b[2]) < tol,
  /** Any unit vector perpendicular to a */
  perp: (a: V3): V3 => {
    const n = v3.norm(a);
    const t: V3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    return v3.norm(v3.cross(t, n));
  },
};

export const v2 = {
  add: (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]],
  sub: (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]],
  mul: (a: V2, s: number): V2 => [a[0] * s, a[1] * s],
  dot: (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1],
  cross: (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0],
  len: (a: V2) => Math.hypot(a[0], a[1]),
  dist: (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]),
  norm: (a: V2): V2 => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; },
  rot: (a: V2, ang: number): V2 => [a[0] * Math.cos(ang) - a[1] * Math.sin(ang), a[0] * Math.sin(ang) + a[1] * Math.cos(ang)],
};

/* ---------- 4x4 matrices, column-major ---------- */
export const m4 = {
  identity: (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  mul(a: M4, b: M4): M4 {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  translation: (t: V3): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1],
  /** Rotation from axis-angle (radians) */
  rotation(axis: V3, ang: number): M4 {
    const [x, y, z] = v3.norm(axis), c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    return [
      t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
      t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
      t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
      0, 0, 0, 1,
    ];
  },
  /** Rotation about an axis passing through point o */
  rotationAbout(o: V3, axis: V3, ang: number): M4 {
    return m4.mul(m4.translation(o), m4.mul(m4.rotation(axis, ang), m4.translation(v3.neg(o))));
  },
  /** Mirror about plane (point o, normal n) */
  mirror(o: V3, n: V3): M4 {
    const [a, b, c] = v3.norm(n);
    const d = -v3.dot(v3.norm(n), o);
    return [
      1 - 2 * a * a, -2 * a * b, -2 * a * c, 0,
      -2 * a * b, 1 - 2 * b * b, -2 * b * c, 0,
      -2 * a * c, -2 * b * c, 1 - 2 * c * c, 0,
      -2 * a * d, -2 * b * d, -2 * c * d, 1,
    ];
  },
  fromBasis(x: V3, y: V3, z: V3, o: V3): M4 { return [...x, 0, ...y, 0, ...z, 0, ...o, 1]; },
  point: (m: M4, p: V3): V3 => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ],
  dir: (m: M4, d: V3): V3 => [
    m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
    m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
    m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
  ],
  /** Inverse of a rigid (or mirror) transform */
  invert(m: M4): M4 {
    // general 4x4 inverse
    const a = m, inv = new Array(16);
    inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
    inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
    inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
    inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
    inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
    inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
    inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
    inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
    inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
    inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
    inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
    inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
    inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
    inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
    inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
    inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
    let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
    det = det || 1e-12;
    return inv.map((x: number) => x / det);
  },
  det3: (m: M4) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]),
  /** Apply small rotation vector + translation to a matrix (left-multiply), used by the assembly solver */
  perturb(m: M4, q: number[]): M4 {
    const rv: V3 = [q[3], q[4], q[5]];
    const ang = v3.len(rv);
    const R = ang > 1e-12 ? m4.rotation(rv, ang) : m4.identity();
    // rotate about the occurrence origin
    const o: V3 = [m[12], m[13], m[14]];
    const T = m4.mul(m4.translation(v3.add(o, [q[0], q[1], q[2]])), m4.mul(R, m4.translation(v3.neg(o))));
    return m4.mul(T, m);
  },
  approxEq: (a: M4, b: M4, tol = 1e-9) => a.every((x, i) => Math.abs(x - b[i]) < tol),
};

export const deg = (r: number) => (r * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const r3 = (x: number) => Math.round(x * 1000) / 1000;

let _seq = 0;
export const uid = (p = 'x') => `${p}${Date.now().toString(36).slice(-5)}${(_seq++).toString(36)}${Math.floor(Math.random() * 36).toString(36)}`;

/** Simple stable hash (for cache keys) */
export function hashStr(s: string): string {
  let h1 = 0xdeadbeef ^ s.length, h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
