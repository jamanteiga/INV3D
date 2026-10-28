// Structural profile library (EN/DIN dimensions) with computed section properties.
import type { V2 } from '../core/types';

export type Seg2D =
  | { t: 'line'; a: V2; b: V2 }
  | { t: 'arc'; a: V2; m: V2; b: V2 }
  | { t: 'circle'; c: V2; r: number };
export interface Loop2D { segs: Seg2D[] }
export interface Region2D { outer: Loop2D; holes: Loop2D[] }

export interface SectionProps {
  A: number;      // mm²
  Iy: number;     // mm⁴ (strong axis, about horizontal axis through centroid)
  Iz: number;     // mm⁴ (weak axis)
  Wy: number;     // mm³
  Wz: number;     // mm³
  J: number;      // mm⁴ torsion constant
  cy: number; cz: number; // centroid in profile coords (mm)
  h: number; b: number;   // overall height (local y) and width (local x)
  massPerM: number;       // kg/m (steel 7850)
}

export interface ProfileFamily {
  standard: string;
  family: string;
  category: 'I' | 'H' | 'U' | 'L' | 'RHS' | 'SHS' | 'CHS' | 'FLAT' | 'ROUND';
  sizes: { size: string; dims: Record<string, number> }[];
}

const I = (s: string, h: number, b: number, tw: number, tf: number, r: number) => ({ size: s, dims: { h, b, tw, tf, r } });
const RHS = (h: number, b: number, t: number) => ({ size: `${h} x ${b} x ${t}`, dims: { h, b, t, ro: t <= 6 ? 2 * t : 2.5 * t } });
const SHS = (a: number, t: number) => ({ size: `${a} x ${a} x ${t}`, dims: { h: a, b: a, t, ro: t <= 6 ? 2 * t : 2.5 * t } });
const CHS = (d: number, t: number) => ({ size: `${d} x ${t}`, dims: { d, t } });
const L = (a: number, t: number, r: number) => ({ size: `${a} x ${a} x ${t}`, dims: { a, t, r } });
const FL = (b: number, t: number) => ({ size: `${b} x ${t}`, dims: { b, t } });
const RD = (d: number) => ({ size: `${d}`, dims: { d } });

export const PROFILES: ProfileFamily[] = [
  {
    standard: 'DIN', family: 'DIN 1025-5 (IPE)', category: 'I', sizes: [
      I('IPE 80', 80, 46, 3.8, 5.2, 5), I('IPE 100', 100, 55, 4.1, 5.7, 7), I('IPE 120', 120, 64, 4.4, 6.3, 7),
      I('IPE 140', 140, 73, 4.7, 6.9, 7), I('IPE 160', 160, 82, 5, 7.4, 9), I('IPE 180', 180, 91, 5.3, 8, 9),
      I('IPE 200', 200, 100, 5.6, 8.5, 12), I('IPE 220', 220, 110, 5.9, 9.2, 12), I('IPE 240', 240, 120, 6.2, 9.8, 15),
      I('IPE 270', 270, 135, 6.6, 10.2, 15), I('IPE 300', 300, 150, 7.1, 10.7, 15), I('IPE 330', 330, 160, 7.5, 11.5, 18),
      I('IPE 360', 360, 170, 8, 12.7, 18), I('IPE 400', 400, 180, 8.6, 13.5, 21), I('IPE 450', 450, 190, 9.4, 14.6, 21),
      I('IPE 500', 500, 200, 10.2, 16, 21), I('IPE 550', 550, 210, 11.1, 17.2, 24), I('IPE 600', 600, 220, 12, 19, 24),
    ],
  },
  {
    standard: 'DIN', family: 'DIN 1025-3 (HEA)', category: 'H', sizes: [
      I('HEA 100', 96, 100, 5, 8, 12), I('HEA 120', 114, 120, 5, 8, 12), I('HEA 140', 133, 140, 5.5, 8.5, 12),
      I('HEA 160', 152, 160, 6, 9, 15), I('HEA 180', 171, 180, 6, 9.5, 15), I('HEA 200', 190, 200, 6.5, 10, 18),
      I('HEA 220', 210, 220, 7, 11, 18), I('HEA 240', 230, 240, 7.5, 12, 21), I('HEA 260', 250, 260, 7.5, 12.5, 24),
      I('HEA 280', 270, 280, 8, 13, 24), I('HEA 300', 290, 300, 8.5, 14, 27), I('HEA 320', 310, 300, 9, 15.5, 27),
      I('HEA 340', 330, 300, 9.5, 16.5, 27), I('HEA 360', 350, 300, 10, 17.5, 27), I('HEA 400', 390, 300, 11, 19, 27),
      I('HEA 450', 440, 300, 11.5, 21, 27), I('HEA 500', 490, 300, 12, 23, 27),
    ],
  },
  {
    standard: 'DIN', family: 'DIN 1025-2 (HEB)', category: 'H', sizes: [
      I('HEB 100', 100, 100, 6, 10, 12), I('HEB 120', 120, 120, 6.5, 11, 12), I('HEB 140', 140, 140, 7, 12, 12),
      I('HEB 160', 160, 160, 8, 13, 15), I('HEB 180', 180, 180, 8.5, 14, 15), I('HEB 200', 200, 200, 9, 15, 18),
      I('HEB 220', 220, 220, 9.5, 16, 18), I('HEB 240', 240, 240, 10, 17, 21), I('HEB 260', 260, 260, 10, 17.5, 24),
      I('HEB 280', 280, 280, 10.5, 18, 24), I('HEB 300', 300, 300, 11, 19, 27), I('HEB 320', 320, 300, 11.5, 20.5, 27),
      I('HEB 340', 340, 300, 12, 21.5, 27), I('HEB 360', 360, 300, 12.5, 22.5, 27), I('HEB 400', 400, 300, 13.5, 24, 27),
      I('HEB 450', 450, 300, 14, 26, 27), I('HEB 500', 500, 300, 14.5, 28, 27),
    ],
  },
  {
    standard: 'DIN', family: 'DIN 1026-1 (UPN)', category: 'U', sizes: [
      I('UPN 80', 80, 45, 6, 8, 8), I('UPN 100', 100, 50, 6, 8.5, 8.5), I('UPN 120', 120, 55, 7, 9, 9),
      I('UPN 140', 140, 60, 7, 10, 10), I('UPN 160', 160, 65, 7.5, 10.5, 10.5), I('UPN 180', 180, 70, 8, 11, 11),
      I('UPN 200', 200, 75, 8.5, 11.5, 11.5), I('UPN 220', 220, 80, 9, 12.5, 12.5), I('UPN 240', 240, 85, 9.5, 13, 13),
      I('UPN 260', 260, 90, 10, 14, 14), I('UPN 280', 280, 95, 10, 15, 15), I('UPN 300', 300, 100, 10, 16, 16),
    ],
  },
  {
    standard: 'DIN', family: 'DIN EN 10056-1 (Equal Angle)', category: 'L', sizes: [
      L(20, 3, 3.5), L(25, 3, 3.5), L(30, 3, 5), L(40, 4, 6), L(45, 5, 7), L(50, 5, 7), L(60, 6, 8), L(70, 7, 9),
      L(80, 8, 10), L(90, 9, 11), L(100, 10, 12), L(120, 12, 13), L(150, 15, 16), L(200, 20, 18),
    ],
  },
  {
    standard: 'DIN', family: 'DIN EN 10219-2 (Rectangular)', category: 'RHS', sizes: [
      RHS(40, 20, 2), RHS(50, 30, 3), RHS(60, 40, 3), RHS(80, 40, 3), RHS(80, 40, 4), RHS(100, 50, 4), RHS(100, 60, 5),
      RHS(120, 60, 5), RHS(120, 80, 6), RHS(150, 100, 6), RHS(160, 80, 6), RHS(200, 100, 8), RHS(250, 150, 8), RHS(300, 200, 10),
    ],
  },
  {
    standard: 'DIN', family: 'DIN EN 10219-2 (Square)', category: 'SHS', sizes: [
      SHS(20, 2), SHS(30, 3), SHS(40, 3), SHS(40, 4), SHS(50, 4), SHS(60, 4), SHS(70, 5), SHS(80, 5), SHS(90, 6),
      SHS(100, 6), SHS(120, 6), SHS(150, 8), SHS(200, 10), SHS(250, 10),
    ],
  },
  {
    standard: 'DIN', family: 'DIN EN 10219-2 (Circular)', category: 'CHS', sizes: [
      CHS(21.3, 2.6), CHS(26.9, 2.6), CHS(33.7, 3.2), CHS(42.4, 3.2), CHS(48.3, 3.2), CHS(60.3, 4), CHS(76.1, 4),
      CHS(88.9, 5), CHS(114.3, 6), CHS(139.7, 6.3), CHS(168.3, 8), CHS(219.1, 8), CHS(273, 10),
    ],
  },
  {
    standard: 'DIN', family: 'DIN EN 10058 (Flat Bar)', category: 'FLAT', sizes: [
      FL(20, 3), FL(30, 5), FL(40, 5), FL(40, 8), FL(50, 6), FL(50, 10), FL(60, 8), FL(80, 8), FL(80, 10), FL(100, 10), FL(120, 12), FL(150, 15),
    ],
  },
  {
    standard: 'DIN', family: 'DIN EN 10060 (Round Bar)', category: 'ROUND', sizes: [RD(10), RD(12), RD(16), RD(20), RD(25), RD(30), RD(40), RD(50), RD(60), RD(80), RD(100)],
  },
];

export const findProfile = (family: string, size: string) => {
  const f = PROFILES.find((p) => p.family === family) ?? PROFILES[5];
  const s = f.sizes.find((x) => x.size === size) ?? f.sizes[0];
  return { family: f, size: s };
};

/* -------- outline geometry (profile local coords: x = width, y = height, origin at centroid of bounding box) -------- */
const rectLoop = (x0: number, y0: number, x1: number, y1: number): Loop2D => ({
  segs: [
    { t: 'line', a: [x0, y0], b: [x1, y0] }, { t: 'line', a: [x1, y0], b: [x1, y1] },
    { t: 'line', a: [x1, y1], b: [x0, y1] }, { t: 'line', a: [x0, y1], b: [x0, y0] },
  ],
});
const polyLoop = (pts: V2[]): Loop2D => ({ segs: pts.map((a, i) => ({ t: 'line', a, b: pts[(i + 1) % pts.length] }) as Seg2D) });

/** Rounded rectangle (outer radius r) as loop with arcs */
function roundRectLoop(w: number, h: number, r: number): Loop2D {
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
  r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3);
  if (r <= 0.01) return rectLoop(x0, y0, x1, y1);
  const k = r * (1 - Math.SQRT1_2);
  return {
    segs: [
      { t: 'line', a: [x0 + r, y0], b: [x1 - r, y0] },
      { t: 'arc', a: [x1 - r, y0], m: [x1 - k, y0 + k], b: [x1, y0 + r] },
      { t: 'line', a: [x1, y0 + r], b: [x1, y1 - r] },
      { t: 'arc', a: [x1, y1 - r], m: [x1 - k, y1 - k], b: [x1 - r, y1] },
      { t: 'line', a: [x1 - r, y1], b: [x0 + r, y1] },
      { t: 'arc', a: [x0 + r, y1], m: [x0 + k, y1 - k], b: [x0, y1 - r] },
      { t: 'line', a: [x0, y1 - r], b: [x0, y0 + r] },
      { t: 'arc', a: [x0, y0 + r], m: [x0 + k, y0 + k], b: [x0 + r, y0] },
    ],
  };
}

export function profileRegion(family: string, size: string): Region2D {
  const { family: f, size: s } = findProfile(family, size);
  const d = s.dims;
  switch (f.category) {
    case 'I': case 'H': {
      const { h, b, tw, tf } = d;
      const pts: V2[] = [
        [-b / 2, -h / 2], [b / 2, -h / 2], [b / 2, -h / 2 + tf], [tw / 2, -h / 2 + tf], [tw / 2, h / 2 - tf], [b / 2, h / 2 - tf],
        [b / 2, h / 2], [-b / 2, h / 2], [-b / 2, h / 2 - tf], [-tw / 2, h / 2 - tf], [-tw / 2, -h / 2 + tf], [-b / 2, -h / 2 + tf],
      ];
      return { outer: polyLoop(pts), holes: [] };
    }
    case 'U': {
      const { h, b, tw, tf } = d;
      const x0 = -b / 2, x1 = b / 2;
      const pts: V2[] = [[x0, -h / 2], [x1, -h / 2], [x1, -h / 2 + tf], [x0 + tw, -h / 2 + tf], [x0 + tw, h / 2 - tf], [x1, h / 2 - tf], [x1, h / 2], [x0, h / 2]];
      return { outer: polyLoop(pts), holes: [] };
    }
    case 'L': {
      const { a, t } = d;
      const o = -a / 2;
      const pts: V2[] = [[o, o], [o + a, o], [o + a, o + t], [o + t, o + t], [o + t, o + a], [o, o + a]];
      return { outer: polyLoop(pts), holes: [] };
    }
    case 'RHS': case 'SHS': {
      const { h, b, t, ro } = d;
      return { outer: roundRectLoop(b, h, ro), holes: [roundRectLoop(b - 2 * t, h - 2 * t, Math.max(0, ro - t))] };
    }
    case 'CHS': return { outer: { segs: [{ t: 'circle', c: [0, 0], r: d.d / 2 }] }, holes: [{ segs: [{ t: 'circle', c: [0, 0], r: d.d / 2 - d.t }] }] };
    case 'FLAT': return { outer: rectLoop(-d.b / 2, -d.t / 2, d.b / 2, d.t / 2), holes: [] };
    case 'ROUND': return { outer: { segs: [{ t: 'circle', c: [0, 0], r: d.d / 2 }] }, holes: [] };
  }
}

/* -------- section properties via polygon integration -------- */
function loopPolygon(l: Loop2D, n = 16): V2[] {
  const pts: V2[] = [];
  for (const s of l.segs) {
    if (s.t === 'line') pts.push(s.a);
    else if (s.t === 'arc') {
      // circle through a, m, b
      const c = circumcenter(s.a, s.m, s.b);
      const r = Math.hypot(s.a[0] - c[0], s.a[1] - c[1]);
      let a0 = Math.atan2(s.a[1] - c[1], s.a[0] - c[0]);
      let a1 = Math.atan2(s.b[1] - c[1], s.b[0] - c[0]);
      const am = Math.atan2(s.m[1] - c[1], s.m[0] - c[0]);
      // choose direction passing through m
      const ccw = ((am - a0 + 4 * Math.PI) % (2 * Math.PI)) < ((a1 - a0 + 4 * Math.PI) % (2 * Math.PI));
      let sweep = ((a1 - a0 + 4 * Math.PI) % (2 * Math.PI));
      if (!ccw) sweep = sweep - 2 * Math.PI;
      for (let i = 0; i < n; i++) { const a = a0 + (sweep * i) / n; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
      void a1;
    } else {
      for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; pts.push([s.c[0] + s.r * Math.cos(a), s.c[1] + s.r * Math.sin(a)]); }
    }
  }
  return pts;
}
export function circumcenter(a: V2, b: V2, c: V2): V2 {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])) || 1e-12;
  const ux = ((a[0] ** 2 + a[1] ** 2) * (b[1] - c[1]) + (b[0] ** 2 + b[1] ** 2) * (c[1] - a[1]) + (c[0] ** 2 + c[1] ** 2) * (a[1] - b[1])) / d;
  const uy = ((a[0] ** 2 + a[1] ** 2) * (c[0] - b[0]) + (b[0] ** 2 + b[1] ** 2) * (a[0] - c[0]) + (c[0] ** 2 + c[1] ** 2) * (b[0] - a[0])) / d;
  return [ux, uy];
}

function polyMoments(p: V2[]) {
  let A = 0, Sx = 0, Sy = 0, Ixx = 0, Iyy = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
    const c = x0 * y1 - x1 * y0;
    A += c / 2;
    Sx += ((x0 + x1) * c) / 6;
    Sy += ((y0 + y1) * c) / 6;
    Ixx += ((y0 * y0 + y0 * y1 + y1 * y1) * c) / 12; // ∫y² dA
    Iyy += ((x0 * x0 + x0 * x1 + x1 * x1) * c) / 12; // ∫x² dA
  }
  const s = Math.sign(A) || 1;
  return { A: A * s, Sx: Sx * s, Sy: Sy * s, Ixx: Ixx * s, Iyy: Iyy * s };
}

const propCache = new Map<string, SectionProps>();
export function sectionProps(family: string, size: string): SectionProps {
  const key = family + '|' + size;
  const hit = propCache.get(key);
  if (hit) return hit;
  const { family: f, size: s } = findProfile(family, size);
  const reg = profileRegion(family, size);
  const outer = polyMoments(loopPolygon(reg.outer));
  let A = outer.A, Sx = outer.Sx, Sy = outer.Sy, Ixx = outer.Ixx, Iyy = outer.Iyy;
  for (const h of reg.holes) { const m = polyMoments(loopPolygon(h)); A -= m.A; Sx -= m.Sx; Sy -= m.Sy; Ixx -= m.Ixx; Iyy -= m.Iyy; }
  // root-radius fillet area for rolled sections (4 fillets between web and flange)
  const d = s.dims;
  if ((f.category === 'I' || f.category === 'H' || f.category === 'U') && d.r) {
    const af = (1 - Math.PI / 4) * d.r * d.r;
    const n = f.category === 'U' ? 2 : 4;
    A += n * af;
    const yf = d.h / 2 - d.tf - d.r * 0.2234;
    Ixx += n * af * yf * yf;
    const xf = f.category === 'U' ? -d.b / 2 + d.tw + d.r * 0.2234 : d.tw / 2 + d.r * 0.2234;
    Iyy += n * af * xf * xf;
  }
  const cx = Sx / A, cy = Sy / A;
  const Iy = Ixx - A * cy * cy; // strong axis (about horizontal)
  const Iz = Iyy - A * cx * cx;
  const ys = loopPolygon(reg.outer).map((p) => p[1]), xs = loopPolygon(reg.outer).map((p) => p[0]);
  const h = Math.max(...ys) - Math.min(...ys), b = Math.max(...xs) - Math.min(...xs);
  const ymax = Math.max(Math.max(...ys) - cy, cy - Math.min(...ys));
  const xmax = Math.max(Math.max(...xs) - cx, cx - Math.min(...xs));
  let J = 0;
  switch (f.category) {
    case 'I': case 'H': J = (2 * d.b * d.tf ** 3 + (d.h - 2 * d.tf) * d.tw ** 3) / 3; break;
    case 'U': J = (2 * d.b * d.tf ** 3 + (d.h - 2 * d.tf) * d.tw ** 3) / 3; break;
    case 'L': J = (2 * d.a - d.t) * d.t ** 3 / 3; break;
    case 'RHS': case 'SHS': { const hm = d.h - d.t, bm = d.b - d.t; const Am = hm * bm; J = (4 * Am * Am * d.t) / (2 * (hm + bm)); break; }
    case 'CHS': { const ro = d.d / 2, ri = ro - d.t; J = (Math.PI / 2) * (ro ** 4 - ri ** 4); break; }
    case 'FLAT': { const a = Math.max(d.b, d.t), c = Math.min(d.b, d.t); J = (a * c ** 3) * (1 / 3 - 0.21 * (c / a) * (1 - c ** 4 / (12 * a ** 4))); break; }
    case 'ROUND': J = (Math.PI * d.d ** 4) / 32; break;
  }
  const out: SectionProps = { A, Iy, Iz, Wy: Iy / ymax, Wz: Iz / xmax, J, cy, cz: cx, h, b, massPerM: (A * 1e-6) * 7850 };
  propCache.set(key, out);
  return out;
}
