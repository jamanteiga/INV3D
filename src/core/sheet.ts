// Geometría de la hoja de plano: vistas (incluidas secciones y detalles), cotas, anotaciones, cajetín
// y lista de piezas, como primitivas comunes para la pantalla (SVG) y las exportaciones (PDF, DXF, SVG).
import { SHEETS, scaleLabel, drawStyle, DRAW_STD, tbTemplate, type DrawingDoc, type DView, type DDim, type DAnn, type DBreak, type GdtSym, type DrawStyle } from './drawing';

/** Estilo activo (lo fija buildSheet con la norma del plano). */
let ST: DrawStyle = DRAW_STD.ISO;
export function setDrawStyle(s: DrawStyle) { ST = s; }
export const curStyle = () => ST;
/** Número con la precisión, separador decimal y unidades de la norma. */
export function fmtD(mm: number, prec = ST.precision): string {
  const v = ST.units === 'in' ? mm / 25.4 : mm;
  let t = v.toFixed(prec);
  if (!ST.trailingZeros && t.includes('.')) t = t.replace(/0+$/, '').replace(/\.$/, '');
  return ST.decSep === ',' ? t.replace('.', ',') : t;
}
import type { P2 } from './svgpath';
import type { V3 } from './doc';
import { fmt } from './expr';

export interface Circ { c: P2; r: number; full: boolean }
export interface Bend { a: P2; b: P2; label: string }
export interface ProjData { vis: P2[][]; hid: P2[][]; cut: P2[][]; bbox: [number, number, number, number]; circles: Circ[]; center: V3; bends?: Bend[]; flat?: { t: number; r: number; k: number }; anchors?: { id: string; c: P2; r: [number, number, number, number]; z: number }[] }

export type Prim =
  | { t: 'pl'; cls: string; pts: P2[]; id?: string }
  | { t: 'fill'; cls: string; loops: P2[][]; id?: string }
  | { t: 'circ'; cls: string; c: P2; r: number; id?: string }
  | { t: 'txt'; cls: string; x: number; y: number; h: number; text: string; rot?: number; anchor?: 'start' | 'middle' | 'end'; id?: string; bold?: boolean };

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P2, k: number): P2 => [a[0] * k, a[1] * k];
const len = (a: P2) => Math.hypot(a[0], a[1]);
const unit = (a: P2): P2 => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };

// ---------- Datos de proyección ----------
function circle3(a: P2, b: P2, c: P2): { c: P2; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2;
  const ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { c: [ux, uy], r: Math.hypot(a[0] - ux, a[1] - uy) };
}
/** Círculos y arcos reconocidos en las polilíneas proyectadas (para cotas de radio/diámetro y marcas de centro). */
export function detectCircles(polys: P2[][]): Circ[] {
  const out: Circ[] = [];
  for (const p of polys) {
    if (p.length < 6) continue;
    const C = circle3(p[0], p[Math.floor(p.length / 3)], p[Math.floor((2 * p.length) / 3)]);
    if (!C || C.r > 1e5) continue;
    const tol = Math.max(1e-3, C.r * 3e-3);
    if (!p.every((q) => Math.abs(Math.hypot(q[0] - C.c[0], q[1] - C.c[1]) - C.r) < tol)) continue;
    const full = Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < tol * 2;
    const dup = out.find((o) => Math.hypot(o.c[0] - C.c[0], o.c[1] - C.c[1]) < tol && Math.abs(o.r - C.r) < tol);
    if (dup) { dup.full ||= full; continue; }
    out.push({ c: C.c, r: C.r, full });
  }
  // Dos semicircunferencias del mismo círculo cuentan como completo
  return out;
}
/** Encadena segmentos sueltos (x0,y0,x1,y1,…) en lazos. */
export function chainSegments(flat: number[], tol = 1e-4): P2[][] {
  const segs: [P2, P2][] = [];
  for (let i = 0; i + 3 < flat.length; i += 4) segs.push([[flat[i], flat[i + 1]], [flat[i + 2], flat[i + 3]]]);
  const used = new Array(segs.length).fill(false), loops: P2[][] = [];
  const near = (a: P2, b: P2) => Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol;
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const loop: P2[] = [segs[i][0], segs[i][1]];
    let grown = true;
    while (grown) {
      grown = false;
      const end = loop[loop.length - 1];
      for (let j = 0; j < segs.length; j++) {
        if (used[j]) continue;
        if (near(segs[j][0], end)) { loop.push(segs[j][1]); used[j] = true; grown = true; break; }
        if (near(segs[j][1], end)) { loop.push(segs[j][0]); used[j] = true; grown = true; break; }
      }
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

// ---------- Recorte por círculo (vistas de detalle) ----------
function clipPolyCircle(poly: P2[], c: P2, r: number): P2[][] {
  const out: P2[][] = [];
  let cur: P2[] = [];
  const inside = (p: P2) => Math.hypot(p[0] - c[0], p[1] - c[1]) <= r;
  for (let i = 0; i + 1 < poly.length; i++) {
    const A = poly[i], B = poly[i + 1], d = sub(B, A), f = sub(A, c);
    const a = d[0] ** 2 + d[1] ** 2, b = 2 * (f[0] * d[0] + f[1] * d[1]), cc = f[0] ** 2 + f[1] ** 2 - r * r;
    const ts: number[] = [];
    const disc = b * b - 4 * a * cc;
    if (a > 1e-18 && disc > 0) { for (const s of [-1, 1]) { const t = (-b + s * Math.sqrt(disc)) / (2 * a); if (t > 0 && t < 1) ts.push(t); } }
    const pts: { p: P2; t: number }[] = [{ p: A, t: 0 }, ...ts.map((t) => ({ p: add(A, mul(d, t)), t })), { p: B, t: 1 }];
    for (let k = 0; k + 1 < pts.length; k++) {
      const m = add(A, mul(d, (pts[k].t + pts[k + 1].t) / 2));
      if (inside(m)) { if (!cur.length) cur.push(pts[k].p); cur.push(pts[k + 1].p); }
      else if (cur.length) { out.push(cur); cur = []; }
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Recorte genérico: parte cada segmento por los parámetros ts y conserva los tramos cuyo punto medio cumple keep. */
function clipBy(poly: P2[], ts: (A: P2, B: P2) => number[], keep: (p: P2) => boolean): P2[][] {
  const out: P2[][] = []; let cur: P2[] = [];
  for (let i = 0; i + 1 < poly.length; i++) {
    const A = poly[i], B = poly[i + 1], d = sub(B, A);
    const tt = [0, ...ts(A, B).filter((t) => t > 1e-9 && t < 1 - 1e-9).sort((a, b) => a - b), 1];
    for (let k = 0; k + 1 < tt.length; k++) {
      const P = add(A, mul(d, tt[k])), Q = add(A, mul(d, tt[k + 1]));
      if (keep(add(A, mul(d, (tt[k] + tt[k + 1]) / 2)))) { if (!cur.length) cur.push(P); cur.push(Q); }
      else if (cur.length) { out.push(cur); cur = []; }
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}
const lineTs = (axis: 0 | 1, vals: number[]) => (A: P2, B: P2) => { const dd = B[axis] - A[axis]; return Math.abs(dd) < 1e-12 ? [] : vals.map((v) => (v - A[axis]) / dd); };

/** Correspondencia de las vistas partidas entre coordenadas del modelo (relativas al centro) y de la hoja (relativas al centro). */
export const BREAK_GAP = 6;
export function breakMap(v: DView) {
  const s = v.scale, G = BREAK_GAP;
  const list = (axis: 'x' | 'y'): DBreak[] => (v.breaks ?? []).filter((b) => b.axis === axis).map((b) => ({ axis, a: Math.min(b.a, b.b), b: Math.max(b.a, b.b) })).sort((x, y) => x.a - y.a);
  const L = { x: list('x'), y: list('y') };
  const tot = (axis: 'x' | 'y') => L[axis].reduce((t, b) => t + (b.b - b.a) * s - G, 0);
  const fwd = (axis: 'x' | 'y', m: number) => {
    let off = 0;
    for (const b of L[axis]) { if (m >= b.b) off -= (b.b - b.a) * s - G; else if (m > b.a) off -= (m - b.a) * s; }
    return m * s + off + tot(axis) / 2;
  };
  const inv = (axis: 'x' | 'y', u: number) => {
    const x = u - tot(axis) / 2; let off = 0;
    for (const b of L[axis]) {
      const as = b.a * s + off;
      if (x <= as) break;
      if (x < as + G) return b.a + ((x - as) / G) * (b.b - b.a);
      off -= (b.b - b.a) * s - G;
    }
    return (x - off) / s;
  };
  return { L, fwd, inv, any: L.x.length + L.y.length > 0 };
}
/** Distancia real (sin partir) entre dos puntos de hoja relativos al centro de la vista. */
export function unbreak(v: DView, p: P2): P2 {
  const bm = breakMap(v); if (!bm.any) return p;
  return [bm.inv('x', p[0]) * v.scale, bm.inv('y', p[1]) * v.scale];
}

// ---------- Geometría de una vista ----------
export interface ViewGeom {
  vis: P2[][]; hid: P2[][]; cut: P2[][];
  rect: [number, number, number, number];
  circles: Circ[];
  /** modelo 2D → hoja, y su inversa */
  T: (q: P2) => P2; inv: (p: P2) => P2;
  clip?: { c: P2; r: number };
  /** Líneas de rotura (vistas partidas) */
  brk?: P2[][];
  bends?: Bend[];
}
export function viewGeometry(v: DView, p: ProjData, parent?: { v: DView; p: ProjData }): ViewGeom {
  if (v.kind === 'detail' && v.detail && parent) {
    const [x0, y0, x1, y1] = parent.p.bbox, pcx = (x0 + x1) / 2, pcy = (y0 + y1) / 2;
    const mc: P2 = [pcx + v.detail.c[0] / parent.v.scale, pcy + v.detail.c[1] / parent.v.scale], rm = v.detail.r / parent.v.scale;
    const T = (q: P2): P2 => [v.x + (q[0] - mc[0]) * v.scale, v.y + (q[1] - mc[1]) * v.scale];
    const inv = (s: P2): P2 => [mc[0] + (s[0] - v.x) / v.scale, mc[1] + (s[1] - v.y) / v.scale];
    const clipAll = (polys: P2[][]) => polys.flatMap((pl) => clipPolyCircle(pl, mc, rm)).map((pl) => pl.map(T));
    const R = rm * v.scale;
    return {
      vis: clipAll(parent.p.vis), hid: v.hidden ? clipAll(parent.p.hid) : [], cut: [],
      rect: [v.x - R, v.y - R, v.x + R, v.y + R],
      circles: parent.p.circles.filter((c) => Math.hypot(c.c[0] - mc[0], c.c[1] - mc[1]) + c.r <= rm + 1e-6).map((c) => ({ c: T(c.c), r: c.r * v.scale, full: c.full })),
      T, inv, clip: { c: [v.x, v.y], r: R },
    };
  }
  const [x0, y0, x1, y1] = p.bbox, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const bm = breakMap(v);
  const T = (q: P2): P2 => [v.x + bm.fwd('x', q[0] - cx), v.y + bm.fwd('y', q[1] - cy)];
  const inv = (s: P2): P2 => [cx + bm.inv('x', s[0] - v.x), cy + bm.inv('y', s[1] - v.y)];
  let rect: [number, number, number, number] = [...T([x0, y0]), ...T([x1, y1])] as [number, number, number, number];
  // Vistas partidas: se suprimen los tramos interiores a cada rotura (en coordenadas del modelo)
  const inBreak = (q: P2) => bm.L.x.some((b) => q[0] - cx > b.a && q[0] - cx < b.b) || bm.L.y.some((b) => q[1] - cy > b.a && q[1] - cy < b.b);
  const brkTs = (A: P2, B: P2) => [...lineTs(0, bm.L.x.flatMap((b) => [b.a + cx, b.b + cx]))(A, B), ...lineTs(1, bm.L.y.flatMap((b) => [b.a + cy, b.b + cy]))(A, B)];
  const cutB = (polys: P2[][]) => (bm.any ? polys.flatMap((pl) => clipBy(pl, brkTs, (q) => !inBreak(q))) : polys);
  // Vista recortada
  let cropR: [number, number, number, number] | null = null;
  if (v.crop) {
    const c = v.crop;
    cropR = [v.x + Math.min(c[0], c[2]), v.y + Math.min(c[1], c[3]), v.x + Math.max(c[0], c[2]), v.y + Math.max(c[1], c[3])];
    rect = [Math.max(rect[0], cropR[0]), Math.max(rect[1], cropR[1]), Math.min(rect[2], cropR[2]), Math.min(rect[3], cropR[3])];
  }
  const R = cropR;
  const inCrop = (q: P2) => !R || (q[0] >= R[0] - 1e-9 && q[0] <= R[2] + 1e-9 && q[1] >= R[1] - 1e-9 && q[1] <= R[3] + 1e-9);
  const cropTs = (A: P2, B: P2) => (R ? [...lineTs(0, [R[0], R[2]])(A, B), ...lineTs(1, [R[1], R[3]])(A, B)] : []);
  const cutC = (polys: P2[][]) => (R ? polys.flatMap((pl) => clipBy(pl, cropTs, inCrop)) : polys);
  const map = (polys: P2[][]) => cutC(cutB(polys).map((l) => l.map(T)));
  const brk: P2[][] = [];
  const [ry0, ry1, rx0, rx1] = [rect[1] - 2, rect[3] + 2, rect[0] - 2, rect[2] + 2];
  for (const b of bm.L.x) for (const m of [b.a, b.b]) {
    const X = v.x + bm.fwd('x', m) + (m === b.a ? 0 : 0), ym = (ry0 + ry1) / 2;
    brk.push([[X, ry0], [X, ym - 2], [X - 1.5, ym - 0.7], [X + 1.5, ym + 0.7], [X, ym + 2], [X, ry1]]);
  }
  for (const b of bm.L.y) for (const m of [b.a, b.b]) {
    const Y = v.y + bm.fwd('y', m), xm = (rx0 + rx1) / 2;
    brk.push([[rx0, Y], [xm - 2, Y], [xm - 0.7, Y - 1.5], [xm + 0.7, Y + 1.5], [xm + 2, Y], [rx1, Y]]);
  }
  return {
    vis: map(p.vis),
    hid: v.hidden ? map(p.hid) : [],
    cut: map(p.cut),
    rect,
    circles: p.circles.filter((c) => !inBreak(c.c)).map((c) => ({ c: T(c.c), r: c.r * v.scale, full: c.full })).filter((c) => inCrop(c.c)),
    T, inv, brk,
    bends: p.bends?.map((b) => ({ a: T(b.a), b: T(b.b), label: b.label })),
  };
}

// ---------- Cotas ----------
export function dimValue(d: DDim, v: DView): number {
  if (d.kind === 'd') return ((d.r ?? 0) * 2) / v.scale;
  if (d.kind === 'r') return (d.r ?? 0) / v.scale;
  if (d.kind === 'ang') {
    const u = sub(d.b, d.a), w = sub(d.c ?? d.b, d.a);
    return Math.abs((Math.atan2(u[0] * w[1] - u[1] * w[0], u[0] * w[0] + u[1] * w[1]) * 180) / Math.PI);
  }
  const A = unbreak(v, d.a), B = unbreak(v, d.b);
  if (d.kind === 'ord') return Math.abs(d.axis === 'y' ? B[1] - A[1] : B[0] - A[0]) / v.scale;
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const L = d.kind === 'h' ? Math.abs(dx) : d.kind === 'v' ? Math.abs(dy) : Math.hypot(dx, dy);
  return L / v.scale;
}
export function dimText(d: DDim, v: DView): string {
  if (d.text) return d.text;
  const val = dimValue(d, v);
  const base = d.kind === 'd' ? `Ø${fmtD(val)}` : d.kind === 'r' ? `R${fmtD(val)}` : d.kind === 'ang' ? `${fmt(val, 1).replace('.', ST.decSep)}°` : fmtD(val);
  return d.tol ? `${base} ${d.tol}` : base;
}
const arrowTri = (P: P2, dir: P2, L = 3, W = 0.9): P2[] => { const u = unit(dir), n: P2 = [-u[1], u[0]]; const b = sub(P, mul(u, L)); return [P, add(b, mul(n, W)), sub(b, mul(n, W))]; };
/** Terminaciones de cota según la norma: llena, abierta, trazo oblicuo o punto. */
function dimEnds(ends: [P2, P2][]): { fills: P2[][]; lines: P2[][] } {
  const fills: P2[][] = [], lines: P2[][] = [];
  for (const [P, dir] of ends) {
    const u = unit(dir), n: P2 = [-u[1], u[0]], L = ST.arrowL, W = ST.arrowW;
    if (ST.arrow === 'closed') fills.push(arrowTri(P, dir, L, W));
    else if (ST.arrow === 'open') { const b = sub(P, mul(u, L)); lines.push([add(b, mul(n, W)), P, sub(b, mul(n, W))]); }
    else if (ST.arrow === 'tick') { const k = L * 0.5; lines.push([sub(P, mul(add(u, n), k * 0.707)), add(P, mul(add(u, n), k * 0.707))]); }
    else { const r = W * 0.6, c: P2[] = []; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; c.push([P[0] + r * Math.cos(a), P[1] + r * Math.sin(a)]); } fills.push(c.slice(0, 3), [c[0], c[3], c[6]], [c[0], c[6], c[9]], c.slice(3, 7), c.slice(6, 10), [c[9], c[10], c[11], c[0]]); }
  }
  return { fills, lines };
}

/** Elementos de una cota en coordenadas de hoja: líneas, flechas y texto. */
export function dimGeometry(d: DDim, v: DView) {
  const O: P2 = [v.x, v.y];
  const text = dimText(d, v);
  if (d.kind === 'd' || d.kind === 'r') {
    const A = add(O, d.a), B = add(O, d.b), r = d.r ?? 0, u = unit(sub(B, A));
    const P2_ = add(A, mul(u, r)), P1 = sub(A, mul(u, r));
    const lines: P2[][] = d.kind === 'd' ? [[P1, P2_]] : [[A, P2_]];
    if (len(sub(B, A)) > r) lines.push([P2_, B], [B, add(B, [u[0] >= 0 ? 6 : -6, 0])]);
    const e = dimEnds(d.kind === 'd' ? [[P2_, u], [P1, mul(u, -1)]] : [[P2_, u]]);
    const arrows = e.fills; lines.push(...e.lines);
    const tx: P2 = len(sub(B, A)) > r ? add(B, [u[0] >= 0 ? 3 : -3, 1]) : add(A, mul(u, r * 0.5));
    return { lines, arrows, text, mid: tx, ang: 0, anchor: (u[0] >= 0 ? 'middle' : 'middle') as 'middle' };
  }
  if (d.kind === 'ang') {
    const V = add(O, d.a), P = add(O, d.b), Q = add(O, d.c ?? d.b), R = Math.max(4, d.offset);
    const a1 = Math.atan2(P[1] - V[1], P[0] - V[0]); let a2 = Math.atan2(Q[1] - V[1], Q[0] - V[0]);
    let sw = a2 - a1; while (sw > Math.PI) sw -= 2 * Math.PI; while (sw < -Math.PI) sw += 2 * Math.PI; a2 = a1 + sw;
    const arc: P2[] = []; for (let i = 0; i <= 32; i++) { const a = a1 + (sw * i) / 32; arc.push([V[0] + R * Math.cos(a), V[1] + R * Math.sin(a)]); }
    const ext = (A: P2, ang: number): P2[] => { const e: P2 = [V[0] + (R + 2) * Math.cos(ang), V[1] + (R + 2) * Math.sin(ang)]; return len(sub(A, V)) < R ? [A, e] : []; };
    const lines = [arc, ext(P, a1), ext(Q, a2)].filter((l) => l.length);
    const t1: P2 = [-Math.sin(a1) * Math.sign(sw), Math.cos(a1) * Math.sign(sw)], t2: P2 = [-Math.sin(a2) * Math.sign(sw), Math.cos(a2) * Math.sign(sw)];
    const am = a1 + sw / 2;
    const e = dimEnds([[arc[0], mul(t1, -1)], [arc[arc.length - 1], t2]]); lines.push(...e.lines);
    return { lines, arrows: e.fills, text, mid: [V[0] + (R + 3) * Math.cos(am), V[1] + (R + 3) * Math.sin(am)] as P2, ang: 0, anchor: 'middle' as const };
  }
  if (d.kind === 'ord') {
    const B = add(O, d.b), C = add(O, d.c ?? d.b), tl = text.length * 2.1;
    if (d.axis === 'y') {
      const sg = Math.sign(C[0] - B[0]) || 1, xm = B[0] + (C[0] - B[0]) * 0.6;
      const lines: P2[][] = [[[B[0] + sg * 1.5, B[1]], [xm, B[1]], [xm + sg * 2, C[1]], C]];
      return { lines, arrows: [] as P2[][], text, mid: [C[0] + sg * (tl / 2 + 1), C[1] - 1.2] as P2, ang: 0, anchor: 'middle' as const };
    }
    const sg = Math.sign(C[1] - B[1]) || 1, ym = B[1] + (C[1] - B[1]) * 0.6;
    const lines: P2[][] = [[[B[0], B[1] + sg * 1.5], [B[0], ym], [C[0], ym + sg * 2], C]];
    return { lines, arrows: [] as P2[][], text, mid: [C[0] + 1.2, C[1] + sg * (tl / 2 + 1)] as P2, ang: 90, anchor: 'middle' as const };
  }
  const A: P2 = add(O, d.a), B: P2 = add(O, d.b);
  let p1: P2, p2: P2, n: P2;
  if (d.kind === 'h') { const y = Math.max(A[1], B[1]) + d.offset; p1 = [A[0], y]; p2 = [B[0], y]; n = [0, Math.sign(d.offset) || 1]; }
  else if (d.kind === 'v') { const x = Math.max(A[0], B[0]) + d.offset; p1 = [x, A[1]]; p2 = [x, B[1]]; n = [Math.sign(d.offset) || 1, 0]; }
  else {
    const L = len(sub(B, A)) || 1; n = [-(B[1] - A[1]) / L, (B[0] - A[0]) / L];
    p1 = add(A, mul(n, d.offset)); p2 = add(B, mul(n, d.offset));
  }
  const ext = (P: P2, Q: P2): P2[] => { const u = unit(sub(Q, P)); return [add(P, mul(u, ST.extGap)), add(Q, mul(u, ST.extOver))]; };
  const u = unit(sub(p2, p1));
  const ang = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
  const mid: P2 = add(mul(add(p1, p2), 0.5), mul(n, 1.2));
  const e = dimEnds([[p1, mul(u, -1)], [p2, u]]);
  return { lines: [ext(A, p1), ext(B, p2), [p1, p2], ...e.lines], arrows: e.fills, text, mid, ang: ang > 90 || ang < -90 ? ang + 180 : ang, anchor: 'middle' as const };
}

// ---------- Anotaciones ----------
export function annGeometry(a: DAnn): { lines: P2[][]; thin: P2[][]; fills: P2[][]; circles: { c: P2; r: number }[]; texts: { x: number; y: number; h: number; text: string; anchor?: 'start' | 'middle' | 'end' }[]; center: P2[][] } {
  const out = { lines: [] as P2[][], thin: [] as P2[][], fills: [] as P2[][], circles: [] as { c: P2; r: number }[], texts: [] as { x: number; y: number; h: number; text: string; anchor?: 'start' | 'middle' | 'end' }[], center: [] as P2[][] };
  const [p0, p1] = a.pts;
  switch (a.kind) {
    case 'balloon': {
      const R = 4.5, u = unit(sub(p0, p1));
      out.circles.push({ c: p1, r: R });
      out.thin.push([p0, add(p1, mul(u, R))]);
      out.fills.push(dot(p0, 0.6));
      out.texts.push({ x: p1[0], y: p1[1] - 1.3, h: 3.5, text: a.text ?? '1', anchor: 'middle' });
      break;
    }
    case 'leader': case 'hole': {
      const pts = a.pts, last = pts[pts.length - 1], prev = pts[pts.length - 2] ?? p0;
      const right = last[0] >= prev[0];
      const tw = (a.text ?? '').length * 2.2 + 2;
      const sh: P2 = add(last, [right ? tw : -tw, 0]);
      out.thin.push([...pts, sh]);
      out.fills.push(arrowTri(p0, sub(p0, pts[1] ?? last)));
      out.texts.push({ x: last[0] + (right ? 1 : -1), y: last[1] + 1, h: 3.5, text: a.text ?? '', anchor: right ? 'start' : 'end' });
      break;
    }
    case 'surface': {
      const P = p0, t = a.text ?? 'Ra 3,2';
      const L: P2 = [P[0] - 2.6, P[1] + 4.5], Rr: P2 = [P[0] + 5.2, P[1] + 9];
      out.thin.push([L, P, Rr], [Rr, [Rr[0] + Math.max(10, t.length * 2.1), Rr[1]]], [L, [P[0] + 2.6, P[1] + 4.5]]);
      out.texts.push({ x: Rr[0] + 1, y: Rr[1] + 1, h: 3, text: t, anchor: 'start' });
      break;
    }
    case 'weld': {
      // ISO 2553: flecha, línea de referencia, línea de identificación discontinua y símbolo de ángulo
      const tip = p0, j = p1, L = 22;
      out.thin.push([tip, j], [j, [j[0] + L, j[1]]]);
      out.fills.push(arrowTri(tip, sub(tip, j)));
      out.center.push([[j[0], j[1] - 1.6], [j[0] + L, j[1] - 1.6]]);
      const x0 = j[0] + 8;
      if (a.side !== 'other') out.lines.push([[x0, j[1]], [x0, j[1] - 4], [x0 + 4, j[1]]]);
      if (a.side === 'other' || a.side === 'both') out.lines.push([[x0, j[1]], [x0, j[1] + 4], [x0 + 4, j[1]]]);
      out.texts.push({ x: x0 - 1, y: a.side === 'other' ? j[1] + 1 : j[1] - 3.6, h: 3, text: a.text ?? 'a4', anchor: 'end' });
      if (a.allAround) out.circles.push({ c: j, r: 1.6 });
      break;
    }
    case 'centerline': {
      const u = unit(sub(p1, p0));
      out.center.push([sub(p0, mul(u, 2)), add(p1, mul(u, 2))]);
      break;
    }
    case 'centermark': {
      const r = (a.r ?? 3) + 2.5;
      out.center.push([[p0[0] - r, p0[1]], [p0[0] + r, p0[1]]], [[p0[0], p0[1] - r], [p0[0], p0[1] + r]]);
      break;
    }
    case 'fcf': {
      // Marco de tolerancia geométrica ISO 1101: [símbolo | (Ø)valor | A | B…]
      const pos = a.pts.length > 1 ? p1 : p0, h = 6;
      if (a.pts.length > 1) { out.thin.push([p0, pos]); out.fills.push(arrowTri(p0, sub(p0, pos))); }
      const tol = `${a.dia ? 'Ø' : ''}${a.text ?? '0,05'}`;
      const dats = (a.datums ?? '').split(/[|,; ]+/).filter(Boolean);
      const cells = [h, Math.max(10, tol.length * 2.3 + 3), ...dats.map((d) => Math.max(h, d.length * 2.4 + 2.5))];
      let x = pos[0];
      const yb = pos[1] - h / 2, yt = pos[1] + h / 2;
      out.thin.push([[x, yb], [x + cells.reduce((t, c) => t + c, 0), yb], [x + cells.reduce((t, c) => t + c, 0), yt], [x, yt], [x, yb]]);
      cells.forEach((w, i) => {
        if (i > 0) out.thin.push([[x, yb], [x, yt]]);
        const c: P2 = [x + w / 2, pos[1]];
        if (i === 0) gdtGlyph(a.sym ?? 'flat', c, out);
        else out.texts.push({ x: c[0], y: pos[1] - 1.25, h: 3.5, text: i === 1 ? tol : dats[i - 2], anchor: 'middle' });
        x += w;
      });
      break;
    }
    case 'datum': {
      // Símbolo de referencia: triángulo lleno sobre la superficie, línea y recuadro con la letra
      const u = unit(sub(p1, p0)), n: P2 = [-u[1], u[0]];
      out.fills.push([add(p0, mul(n, 1.8)), sub(p0, mul(n, 1.8)), add(p0, mul(u, 3.1))]);
      const box = 7;
      const e: P2 = Math.abs(u[0]) > Math.abs(u[1]) ? [p1[0] - Math.sign(u[0]) * box / 2, p1[1]] : [p1[0], p1[1] - Math.sign(u[1]) * box / 2];
      out.thin.push([add(p0, mul(u, 3)), e]);
      out.thin.push([[p1[0] - box / 2, p1[1] - box / 2], [p1[0] + box / 2, p1[1] - box / 2], [p1[0] + box / 2, p1[1] + box / 2], [p1[0] - box / 2, p1[1] + box / 2], [p1[0] - box / 2, p1[1] - box / 2]]);
      out.texts.push({ x: p1[0], y: p1[1] - 1.6, h: 4.5, text: a.text ?? 'A', anchor: 'middle' });
      break;
    }
  }
  return out;
}
/** Dibuja el símbolo de característica geométrica centrado en c (celda de 6 mm). */
function gdtGlyph(sym: GdtSym, c: P2, out: { thin: P2[][]; circles: { c: P2; r: number }[]; fills: P2[][] }) {
  const [x, y] = c, k = 2;
  const L = (...pts: P2[]) => out.thin.push(pts);
  switch (sym) {
    case 'straight': L([x - k, y], [x + k, y]); break;
    case 'flat': L([x - k, y - 1], [x + k - 0.8, y - 1], [x + k, y + 1], [x - k + 0.8, y + 1], [x - k, y - 1]); break;
    case 'circ': out.circles.push({ c, r: 1.8 }); break;
    case 'cyl': out.circles.push({ c, r: 1.4 }); L([x - 2.2, y - 1.6], [x - 0.6, y + 1.6]); L([x + 0.6, y - 1.6], [x + 2.2, y + 1.6]); break;
    case 'profl': case 'profs': { const a: P2[] = []; for (let i = 0; i <= 16; i++) { const t = (Math.PI * i) / 16; a.push([x + 2 * Math.cos(t), y - 1 + 2 * Math.sin(t)]); } if (sym === 'profs') a.push(a[0]); L(...a); break; }
    case 'perp': L([x - k, y - 1.6], [x + k, y - 1.6]); L([x, y - 1.6], [x, y + 2]); break;
    case 'angle': L([x + k, y - 1.6], [x - k, y - 1.6], [x + k, y + 1.4]); break;
    case 'par': L([x - 1.8, y - 1.6], [x - 0.4, y + 1.8]); L([x + 0.4, y - 1.6], [x + 1.8, y + 1.8]); break;
    case 'pos': out.circles.push({ c, r: 1.3 }); L([x - 2.2, y], [x + 2.2, y]); L([x, y - 2.2], [x, y + 2.2]); break;
    case 'conc': out.circles.push({ c, r: 0.9 }, { c, r: 1.9 }); break;
    case 'sym': L([x - 1.2, y + 1.2], [x + 1.2, y + 1.2]); L([x - 2.2, y], [x + 2.2, y]); L([x - 1.2, y - 1.2], [x + 1.2, y - 1.2]); break;
    case 'runout': L([x - 1.5, y - 1.8], [x + 1, y + 1.3]); out.fills.push(arrowTri([x + 1.6, y + 2], [1, 1.2], 1.6, 0.6)); break;
    case 'truns': L([x - 2, y - 1.8], [x + 0.4, y - 1.8]); L([x - 2, y - 1.8], [x - 0.6, y + 1.3]); L([x + 0.4, y - 1.8], [x + 1.8, y + 1.3]); out.fills.push(arrowTri([x - 0.3, y + 2], [0.6, 1.2], 1.5, 0.55), arrowTri([x + 2.1, y + 2], [0.6, 1.2], 1.5, 0.55)); break;
  }
}
const dot = (c: P2, r: number): P2[] => { const o: P2[] = []; for (let i = 0; i < 10; i++) { const t = (i / 10) * Math.PI * 2; o.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]); } return o; };

// ---------- Cajetín ----------
/** Altura del cajetín (para colocar encima la lista de piezas) */
export const tbHeight = (drw: DrawingDoc) => tbTemplate(drw).h;
export function tbValue(drw: DrawingDoc, field: string): string {
  const t = drw.title as unknown as Record<string, string | undefined>;
  if (field === '#sheet') return `${(drw.page ?? 0) + 1}/${Math.max(1, drw.pages?.length ?? 1)}`;
  if (field === '#format') return `${drw.sheet} · mm`;
  if (field === '#proj') return drawStyle(drw).projection === 'third' ? `americana (${drw.std ?? 'ANSI'})` : `europea (${drw.std ?? 'ISO'} E)`;
  if (field.startsWith('=')) return field.slice(1);
  if (field.startsWith('custom:')) return drw.title.custom?.[field.slice(7)] ?? '';
  return t[field] ?? '';
}
export function titleBlockGeometry(drw: DrawingDoc) {
  const [W] = SHEETS[drw.sheet];
  const tpl = tbTemplate(drw);
  const x0 = W - 10 - tpl.w, y0 = 10;
  return {
    x0, y0, w: tpl.w, h: tpl.h, proj: tpl.proj ? { x: x0 + tpl.proj.x, y: y0 + tpl.proj.y } : null,
    cells: tpl.cells.map((c) => ({ x: x0 + c.x, y: y0 + c.y, w: c.w, h: c.h, label: c.label, value: tbValue(drw, c.field), big: c.big })),
  };
}

// ---------- Hoja completa ----------
export interface SheetInput {
  drw: DrawingDoc;
  proj: (v: DView) => ProjData | null;
  bom?: { cells: { x: number; y: number; w: number; text: string }[] }[] | null;
  /** id de elemento seleccionado (para resaltar) */
  sel?: string | null;
}
export function geomOf(drw: DrawingDoc, proj: (v: DView) => ProjData | null, v: DView): ViewGeom | null {
  const p = v.kind === 'detail' ? null : proj(v);
  if (v.kind === 'detail') {
    const pv = drw.views.find((x) => x.id === v.parent); if (!pv) return null;
    const pp = proj(pv); if (!pp) return null;
    return viewGeometry(v, pp, { v: pv, p: pp });
  }
  return p ? viewGeometry(v, p) : null;
}

export function buildSheet({ drw, proj, bom }: SheetInput): Prim[] {
  ST = drawStyle(drw);
  const [W, H] = SHEETS[drw.sheet];
  const P: Prim[] = [];
  P.push({ t: 'pl', cls: 'frame', pts: [[10, 10], [W - 10, 10], [W - 10, H - 10], [10, H - 10], [10, 10]] });
  P.push({ t: 'pl', cls: 'frame', pts: [[W / 2, 0], [W / 2, 10]] }, { t: 'pl', cls: 'frame', pts: [[W / 2, H - 10], [W / 2, H]] }, { t: 'pl', cls: 'frame', pts: [[0, H / 2], [10, H / 2]] }, { t: 'pl', cls: 'frame', pts: [[W - 10, H / 2], [W, H / 2]] });
  // Vistas
  for (const v of drw.views) {
    const g = geomOf(drw, proj, v); if (!g) continue;
    if (g.cut.length) P.push({ t: 'fill', cls: 'hatch', loops: g.cut, id: v.id });
    for (const l of g.hid) P.push({ t: 'pl', cls: 'hid', pts: l, id: v.id });
    for (const l of g.vis) P.push({ t: 'pl', cls: 'vis', pts: l, id: v.id });
    if (v.centers) for (const c of g.circles) if (c.full && c.r > 0.8) {
      const r = c.r + 2.5;
      P.push({ t: 'pl', cls: 'center', pts: [[c.c[0] - r, c.c[1]], [c.c[0] + r, c.c[1]]], id: v.id }, { t: 'pl', cls: 'center', pts: [[c.c[0], c.c[1] - r], [c.c[0], c.c[1] + r]], id: v.id });
    }
    if (g.clip) P.push({ t: 'circ', cls: 'thin', c: g.clip.c, r: g.clip.r, id: v.id });
    for (const l of g.brk ?? []) P.push({ t: 'pl', cls: 'thin', pts: l, id: v.id });
    for (const [i, b] of (g.bends ?? []).entries()) {
      P.push({ t: 'pl', cls: 'center', pts: [b.a, b.b], id: v.id });
      P.push({ t: 'txt', cls: 'annt', x: b.b[0], y: b.b[1] + 2, h: 2.5, text: `P${i + 1}`, anchor: 'middle', id: v.id });
    }
    const label = v.kind === 'aux' ? `VISTA ${v.label} (${scaleLabel(v.scale)})` : v.kind === 'flat' ? `DESARROLLO (${scaleLabel(v.scale)})` : v.kind === 'section' ? `SECCIÓN ${v.label}-${v.label} (${scaleLabel(v.scale)})` : v.kind === 'detail' ? `DETALLE ${v.label} (${scaleLabel(v.scale)})` : `${v.name} · ${scaleLabel(v.scale)}`;
    P.push({ t: 'txt', cls: v.kind === 'section' || v.kind === 'detail' || v.kind === 'aux' ? 'vlabel big' : 'vlabel', x: (g.rect[0] + g.rect[2]) / 2, y: g.rect[1] - 7, h: v.kind === 'section' || v.kind === 'detail' ? 3.5 : 3, text: label, anchor: 'middle', id: v.id });
  }
  // Indicaciones de sección y detalle sobre la vista padre
  for (const v of drw.views) {
    const pv = drw.views.find((x) => x.id === v.parent); if (!pv) continue;
    if (v.kind === 'section' && v.section) {
      const O: P2 = [pv.x, pv.y];
      const pts = (v.section.pts ?? [v.section.a, v.section.b]).map((q) => add(O, q));
      const A = pts[0], B = pts[pts.length - 1];
      const u = unit(sub(pts[1], A)), uB = unit(sub(B, pts[pts.length - 2]));
      const A2 = sub(A, mul(u, 4)), B2 = add(B, mul(uB, 4));
      P.push({ t: 'pl', cls: 'cutline', pts: [A2, ...pts.slice(1, -1), B2], id: v.id });
      P.push({ t: 'pl', cls: 'cutend', pts: [A2, add(A2, mul(u, 6))], id: v.id }, { t: 'pl', cls: 'cutend', pts: [sub(B2, mul(uB, 6)), B2], id: v.id });
      // trazos gruesos en los cambios de dirección
      for (let i = 1; i < pts.length - 1; i++) {
        const a = unit(sub(pts[i - 1], pts[i])), b = unit(sub(pts[i + 1], pts[i]));
        P.push({ t: 'pl', cls: 'cutend', pts: [add(pts[i], mul(a, 3)), pts[i], add(pts[i], mul(b, 3))], id: v.id });
      }
      // flechas en la dirección de la mirada (proyección en la hoja de la normal)
      const nv: P2 = unit(v.section.n2 ?? [0, 0]);
      for (const E of [A2, B2]) {
        const tail = add(E, mul(nv, -0.1)), tip = add(E, mul(nv, 7));
        P.push({ t: 'pl', cls: 'thick', pts: [tail, tip], id: v.id }, { t: 'fill', cls: 'arrow', loops: [arrowTri(tip, nv, 3.5, 1.2)], id: v.id });
        P.push({ t: 'txt', cls: 'vlabel big', x: E[0] + nv[0] * 10 - u[0] * 2, y: E[1] + nv[1] * 10 - 1.7 - u[1] * 2, h: 5, text: v.label ?? 'A', anchor: 'middle', id: v.id, bold: true });
      }
    }
    if (v.kind === 'aux' && v.aux) {
      // flecha de dirección de la vista auxiliar junto a la arista elegida
      const A = add([pv.x, pv.y], v.aux.a), nv: P2 = unit(v.aux.n2);
      const tail = add(A, mul(nv, 14)), tip = add(A, mul(nv, 4));
      P.push({ t: 'pl', cls: 'thick', pts: [tail, tip], id: v.id }, { t: 'fill', cls: 'arrow', loops: [arrowTri(tip, mul(nv, -1), 3.5, 1.2)], id: v.id });
      P.push({ t: 'txt', cls: 'vlabel big', x: tail[0] + nv[0] * 3, y: tail[1] + nv[1] * 3 - 1.7, h: 5, text: v.label ?? 'A', anchor: 'middle', id: v.id, bold: true });
    }
    if (v.kind === 'detail' && v.detail) {
      const c = add([pv.x, pv.y], v.detail.c);
      P.push({ t: 'circ', cls: 'thick', c, r: v.detail.r, id: v.id });
      P.push({ t: 'txt', cls: 'vlabel big', x: c[0] + v.detail.r * 0.75 + 2, y: c[1] + v.detail.r * 0.75 + 2, h: 5, text: v.label ?? 'B', anchor: 'start', id: v.id, bold: true });
    }
  }
  // Cotas
  for (const d of drw.dims) {
    const v = drw.views.find((x) => x.id === d.view); if (!v) continue;
    const g = dimGeometry(d, v);
    for (const l of g.lines) P.push({ t: 'pl', cls: 'dim', pts: l, id: d.id });
    P.push({ t: 'fill', cls: 'arrow', loops: g.arrows, id: d.id });
    P.push({ t: 'txt', cls: 'dimt', x: g.mid[0], y: g.mid[1], h: ST.dimTextH, text: g.text, rot: g.ang, anchor: 'middle', id: d.id });
  }
  // Anotaciones
  for (const a of drw.anns ?? []) {
    const g = annGeometry(a);
    for (const l of g.lines) P.push({ t: 'pl', cls: 'ann', pts: l, id: a.id });
    for (const l of g.thin) P.push({ t: 'pl', cls: 'thin', pts: l, id: a.id });
    for (const l of g.center) P.push({ t: 'pl', cls: 'center', pts: l, id: a.id });
    if (g.fills.length) P.push({ t: 'fill', cls: 'arrow', loops: g.fills, id: a.id });
    for (const c of g.circles) P.push({ t: 'circ', cls: 'thin', c: c.c, r: c.r, id: a.id });
    for (const t of g.texts) P.push({ t: 'txt', cls: 'annt', ...t, id: a.id });
  }
  // Tablas
  for (const tb of drw.tables ?? []) {
    const tab = tableData(drw, proj, tb);
    if (!tab) continue;
    for (const p of tab.extra) P.push({ ...p, id: tb.id } as Prim);
    let y = tb.y;
    const tw = tab.cols.reduce((t, c) => t + c, 0);
    P.push({ t: 'pl', cls: 'tb', pts: [[tb.x, y], [tb.x + tw, y], [tb.x + tw, y - 7], [tb.x, y - 7], [tb.x, y]], id: tb.id });
    P.push({ t: 'txt', cls: 'tbb', x: tb.x + tw / 2, y: y - 5, h: 3, text: tab.title, anchor: 'middle', bold: true, id: tb.id });
    y -= 7;
    for (const [ri, row] of tab.rows.entries()) {
      let x = tb.x;
      row.forEach((txt, ci) => {
        const w = tab.cols[ci];
        P.push({ t: 'pl', cls: 'tb', pts: [[x, y], [x + w, y], [x + w, y - 6], [x, y - 6], [x, y]], id: tb.id });
        P.push({ t: 'txt', cls: ri === 0 ? 'tbl' : 'tbv', x: x + 1.2, y: y - 4.3, h: ri === 0 ? 2.2 : 2.5, text: txt, bold: ri === 0, id: tb.id });
        x += w;
      });
      y -= 6;
    }
  }
  for (const n of drw.notes) P.push({ t: 'txt', cls: 'note', x: n.x, y: n.y, h: n.size, text: n.text, id: n.id });
  // Cajetín
  const tb = titleBlockGeometry(drw);
  for (const c of tb.cells) {
    P.push({ t: 'pl', cls: 'tb', pts: [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h], [c.x, c.y]] });
    P.push({ t: 'txt', cls: 'tbl', x: c.x + 1.2, y: c.y + c.h - 2.6, h: 1.8, text: c.label });
    if (c.value) P.push({ t: 'txt', cls: c.big ? 'tbb' : 'tbv', x: c.x + 1.2, y: c.y + (c.big ? 3 : 1.4), h: c.big ? 5 : 2.5, text: c.value, bold: c.big });
  }
  // Símbolo de proyección (europea: círculos a la izquierda del cono; americana: a la derecha)
  if (tb.proj) {
  const sx = tb.proj.x + 3, sy = tb.proj.y, third = ST.projection === 'third';
  const cx = third ? sx + 3 : sx - 6, kx = third ? sx - 7 : sx - 1;
  P.push({ t: 'circ', cls: 'tb', c: [cx, sy], r: 2.6 }, { t: 'circ', cls: 'tb', c: [cx, sy], r: 1.2 });
  P.push({ t: 'pl', cls: 'tb', pts: [[kx, sy + 2.6], [kx + 5, sy + 1.6], [kx + 5, sy - 1.6], [kx, sy - 2.6], [kx, sy + 2.6]] });
  }
  if (bom) for (const [i, row] of bom.entries()) for (const c of row.cells) {
    P.push({ t: 'pl', cls: 'tb', pts: [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + 6], [c.x, c.y + 6], [c.x, c.y]] });
    P.push({ t: 'txt', cls: i === bom.length - 1 ? 'tbb' : 'tbv', x: c.x + 1.2, y: c.y + 1.8, h: 2.5, text: c.text, bold: i === bom.length - 1 });
  }
  return P;
}

// ---------- Tablas (taladros, revisiones, pliegues) ----------
export function tableData(drw: DrawingDoc, proj: (v: DView) => ProjData | null, tb: { kind: string; view?: string }): { title: string; cols: number[]; rows: string[][]; extra: Prim[] } | null {
  if (tb.kind === 'rev') {
    const revs = drw.revisions ?? [];
    return { title: 'REVISIONES', cols: [12, 78, 24, 26], rows: [['Rev.', 'Descripción', 'Fecha', 'Aprobado'], ...revs.map((r) => [r.rev, r.desc, r.date, r.by])], extra: [] };
  }
  const v = drw.views.find((x) => x.id === tb.view); if (!v) return null;
  if (tb.kind === 'bend') {
    const pd = proj(v); if (!pd?.bends) return null;
    const rows = pd.bends.map((b, i) => {
      const m = /(ARRIBA|ABAJO)\s+(\d+(?:[.,]\d+)?)°\s*R?([\d.,]+)?/.exec(b.label);
      return [`P${i + 1}`, m ? (m[1] === 'ARRIBA' ? 'Arriba' : 'Abajo') : '', m ? `${m[2]}°` : b.label, m?.[3] ? `R${m[3]}` : pd.flat ? `R${fmt(pd.flat.r, 2)}` : ''];
    });
    return { title: 'TABLA DE PLIEGUES', cols: [14, 22, 20, 22], rows: [['Pliegue', 'Dirección', 'Ángulo', 'Radio'], ...rows], extra: [] };
  }
  // Tabla de taladros: círculos completos de la vista, agrupados por centro, con origen en la esquina inferior izquierda
  const g = geomOf(drw, proj, v); if (!g) return null;
  const groups: { c: P2; ds: number[] }[] = [];
  for (const c of g.circles) {
    if (!c.full || c.r < 0.4) continue;
    const gr = groups.find((x) => Math.hypot(x.c[0] - c.c[0], x.c[1] - c.c[1]) < 0.05);
    const d = (2 * c.r) / v.scale;
    if (gr) { if (!gr.ds.some((x) => Math.abs(x - d) < 0.01)) gr.ds.push(d); } else groups.push({ c: c.c, ds: [d] });
  }
  // descartar el contorno exterior de piezas de revolución (círculo que llena la vista)
  const W0 = g.rect[2] - g.rect[0], H0 = g.rect[3] - g.rect[1];
  const holes = groups.filter((x) => !(Math.min(...x.ds) * v.scale > Math.min(W0, H0) * 0.95));
  const o: P2 = [g.rect[0], g.rect[1]];
  holes.sort((a, b) => (Math.abs(a.c[1] - b.c[1]) > 0.5 ? a.c[1] - b.c[1] : a.c[0] - b.c[0]));
  const extra: Prim[] = [];
  extra.push({ t: 'pl', cls: 'thin', pts: [[o[0] - 3, o[1]], [o[0] + 8, o[1]]] }, { t: 'pl', cls: 'thin', pts: [[o[0], o[1] - 3], [o[0], o[1] + 8]] });
  extra.push({ t: 'txt', cls: 'annt', x: o[0] - 1, y: o[1] - 4, h: 2.5, text: '0,0', anchor: 'end' });
  const rows = holes.map((h, i) => {
    const tag = `A${i + 1}`;
    const r = (Math.max(...h.ds) * v.scale) / 2;
    extra.push({ t: 'txt', cls: 'annt', x: h.c[0] + r * 0.75 + 0.8, y: h.c[1] + r * 0.75 + 0.8, h: 2.5, text: tag });
    const rel = unbreak(v, [h.c[0] - v.x, h.c[1] - v.y]), relO = unbreak(v, [o[0] - v.x, o[1] - v.y]);
    return [tag, fmt((rel[0] - relO[0]) / v.scale, 2), fmt((rel[1] - relO[1]) / v.scale, 2), h.ds.sort((a, b) => a - b).map((d) => `Ø${fmt(d, 2)}`).join(' / ')];
  });
  return { title: 'TABLA DE TALADROS', cols: [12, 22, 22, 34], rows: [['Ref.', 'X', 'Y', 'Descripción'], ...rows], extra };
}

/** Rayado a 45° de lazos (regla par-impar) para PDF y DXF. */
export function hatchLines(loops: P2[][], step = ST.hatchStep): P2[][] {
  const out: P2[][] = [];
  if (!loops.length) return out;
  // Girar 45°: u = (x+y)/√2 constante en cada línea de rayado
  const k = Math.SQRT1_2;
  let umin = Infinity, umax = -Infinity;
  for (const l of loops) for (const p of l) { const u = (p[0] + p[1]) * k; umin = Math.min(umin, u); umax = Math.max(umax, u); }
  for (let u = Math.ceil(umin / step) * step; u <= umax; u += step) {
    const ts: number[] = [];
    for (const l of loops) for (let i = 0; i < l.length; i++) {
      const A = l[i], B = l[(i + 1) % l.length];
      const ua = (A[0] + A[1]) * k, ub = (B[0] + B[1]) * k;
      if ((ua - u) * (ub - u) < 0) { const t = (u - ua) / (ub - ua); ts.push(((A[0] - A[1]) + t * ((B[0] - B[1]) - (A[0] - A[1]))) * k); }
    }
    ts.sort((a, b) => a - b);
    for (let i = 0; i + 1 < ts.length; i += 2) {
      const w0 = ts[i], w1 = ts[i + 1];
      // x = (u + w)/√2, y = (u - w)/√2
      out.push([[(u + w0) * k, (u - w0) * k], [(u + w1) * k, (u - w1) * k]]);
    }
  }
  return out;
}
