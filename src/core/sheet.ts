// Geometría de la hoja de plano: vistas (incluidas secciones y detalles), cotas, anotaciones, cajetín
// y lista de piezas, como primitivas comunes para la pantalla (SVG) y las exportaciones (PDF, DXF, SVG).
import { SHEETS, scaleLabel, type DrawingDoc, type DView, type DDim, type DAnn } from './drawing';
import type { P2 } from './svgpath';
import type { V3 } from './doc';
import { fmt } from './expr';

export interface Circ { c: P2; r: number; full: boolean }
export interface ProjData { vis: P2[][]; hid: P2[][]; cut: P2[][]; bbox: [number, number, number, number]; circles: Circ[]; center: V3 }

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

// ---------- Geometría de una vista ----------
export interface ViewGeom {
  vis: P2[][]; hid: P2[][]; cut: P2[][];
  rect: [number, number, number, number];
  circles: Circ[];
  /** modelo 2D → hoja, y su inversa */
  T: (q: P2) => P2; inv: (p: P2) => P2;
  clip?: { c: P2; r: number };
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
  const T = (q: P2): P2 => [v.x + (q[0] - cx) * v.scale, v.y + (q[1] - cy) * v.scale];
  const inv = (s: P2): P2 => [cx + (s[0] - v.x) / v.scale, cy + (s[1] - v.y) / v.scale];
  return {
    vis: p.vis.map((l) => l.map(T)),
    hid: v.hidden ? p.hid.map((l) => l.map(T)) : [],
    cut: p.cut.map((l) => l.map(T)),
    rect: [v.x - ((x1 - x0) * v.scale) / 2, v.y - ((y1 - y0) * v.scale) / 2, v.x + ((x1 - x0) * v.scale) / 2, v.y + ((y1 - y0) * v.scale) / 2],
    circles: p.circles.map((c) => ({ c: T(c.c), r: c.r * v.scale, full: c.full })),
    T, inv,
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
  const dx = d.b[0] - d.a[0], dy = d.b[1] - d.a[1];
  const L = d.kind === 'h' ? Math.abs(dx) : d.kind === 'v' ? Math.abs(dy) : Math.hypot(dx, dy);
  return L / v.scale;
}
export function dimText(d: DDim, v: DView): string {
  if (d.text) return d.text;
  const val = dimValue(d, v);
  const base = d.kind === 'd' ? `Ø${fmt(val, 2)}` : d.kind === 'r' ? `R${fmt(val, 2)}` : d.kind === 'ang' ? `${fmt(val, 1)}°` : fmt(val, 2);
  return d.tol ? `${base} ${d.tol}` : base;
}
const arrowTri = (P: P2, dir: P2, L = 3, W = 0.9): P2[] => { const u = unit(dir), n: P2 = [-u[1], u[0]]; const b = sub(P, mul(u, L)); return [P, add(b, mul(n, W)), sub(b, mul(n, W))]; };

/** Elementos de una cota en coordenadas de hoja: líneas, flechas y texto. */
export function dimGeometry(d: DDim, v: DView) {
  const O: P2 = [v.x, v.y];
  const text = dimText(d, v);
  if (d.kind === 'd' || d.kind === 'r') {
    const A = add(O, d.a), B = add(O, d.b), r = d.r ?? 0, u = unit(sub(B, A));
    const P2_ = add(A, mul(u, r)), P1 = sub(A, mul(u, r));
    const lines: P2[][] = d.kind === 'd' ? [[P1, P2_]] : [[A, P2_]];
    if (len(sub(B, A)) > r) lines.push([P2_, B], [B, add(B, [u[0] >= 0 ? 6 : -6, 0])]);
    const arrows = d.kind === 'd' ? [arrowTri(P2_, u), arrowTri(P1, mul(u, -1))] : [arrowTri(P2_, u)];
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
    return { lines, arrows: [arrowTri(arc[0], mul(t1, -1)), arrowTri(arc[arc.length - 1], t2)], text, mid: [V[0] + (R + 3) * Math.cos(am), V[1] + (R + 3) * Math.sin(am)] as P2, ang: 0, anchor: 'middle' as const };
  }
  const A: P2 = add(O, d.a), B: P2 = add(O, d.b);
  let p1: P2, p2: P2, n: P2;
  if (d.kind === 'h') { const y = Math.max(A[1], B[1]) + d.offset; p1 = [A[0], y]; p2 = [B[0], y]; n = [0, Math.sign(d.offset) || 1]; }
  else if (d.kind === 'v') { const x = Math.max(A[0], B[0]) + d.offset; p1 = [x, A[1]]; p2 = [x, B[1]]; n = [Math.sign(d.offset) || 1, 0]; }
  else {
    const L = len(sub(B, A)) || 1; n = [-(B[1] - A[1]) / L, (B[0] - A[0]) / L];
    p1 = add(A, mul(n, d.offset)); p2 = add(B, mul(n, d.offset));
  }
  const ext = (P: P2, Q: P2): P2[] => { const u = unit(sub(Q, P)); return [add(P, mul(u, 1)), add(Q, mul(u, 2))]; };
  const u = unit(sub(p2, p1));
  const ang = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
  const mid: P2 = add(mul(add(p1, p2), 0.5), mul(n, 1.2));
  return { lines: [ext(A, p1), ext(B, p2), [p1, p2]], arrows: [arrowTri(p1, mul(u, -1)), arrowTri(p2, u)], text, mid, ang: ang > 90 || ang < -90 ? ang + 180 : ang, anchor: 'middle' as const };
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
  }
  return out;
}
const dot = (c: P2, r: number): P2[] => { const o: P2[] = []; for (let i = 0; i < 10; i++) { const t = (i / 10) * Math.PI * 2; o.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]); } return o; };

// ---------- Cajetín ----------
const TB_W = 180;
export function titleBlockGeometry(drw: DrawingDoc) {
  const [W] = SHEETS[drw.sheet];
  const x0 = W - 10 - TB_W, y0 = 10;
  const t = drw.title;
  const cells: { x: number; y: number; w: number; h: number; label: string; value: string; big?: boolean }[] = [
    { x: 0, y: 16, w: 60, h: 16, label: 'Empresa', value: t.company },
    { x: 60, y: 16, w: 80, h: 16, label: 'Título', value: t.title, big: true },
    { x: 140, y: 16, w: 40, h: 16, label: 'Nº de plano', value: t.partNumber, big: true },
    { x: 0, y: 8, w: 30, h: 8, label: 'Dibujado', value: t.designer },
    { x: 30, y: 8, w: 30, h: 8, label: 'Revisado', value: t.checker },
    { x: 60, y: 8, w: 50, h: 8, label: 'Material', value: t.material },
    { x: 110, y: 8, w: 30, h: 8, label: 'Escala', value: t.scale },
    { x: 140, y: 8, w: 20, h: 8, label: 'Rev.', value: t.revision },
    { x: 160, y: 8, w: 20, h: 8, label: 'Hoja', value: '1/1' },
    { x: 0, y: 0, w: 30, h: 8, label: 'Fecha', value: t.date },
    { x: 30, y: 0, w: 80, h: 8, label: 'Formato', value: `${drw.sheet} · medidas en mm` },
    { x: 110, y: 0, w: 70, h: 8, label: 'Proyección', value: 'europea (ISO E)' },
  ];
  return { x0, y0, cells: cells.map((c) => ({ ...c, x: x0 + c.x, y: y0 + c.y })) };
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
    const label = v.kind === 'section' ? `SECCIÓN ${v.label}-${v.label} (${scaleLabel(v.scale)})` : v.kind === 'detail' ? `DETALLE ${v.label} (${scaleLabel(v.scale)})` : `${v.name} · ${scaleLabel(v.scale)}`;
    P.push({ t: 'txt', cls: v.kind === 'section' || v.kind === 'detail' ? 'vlabel big' : 'vlabel', x: (g.rect[0] + g.rect[2]) / 2, y: g.rect[1] - 7, h: v.kind === 'section' || v.kind === 'detail' ? 3.5 : 3, text: label, anchor: 'middle', id: v.id });
  }
  // Indicaciones de sección y detalle sobre la vista padre
  for (const v of drw.views) {
    const pv = drw.views.find((x) => x.id === v.parent); if (!pv) continue;
    if (v.kind === 'section' && v.section) {
      const A = add([pv.x, pv.y], v.section.a), B = add([pv.x, pv.y], v.section.b), u = unit(sub(B, A));
      const A2 = sub(A, mul(u, 4)), B2 = add(B, mul(u, 4));
      P.push({ t: 'pl', cls: 'cutline', pts: [A2, B2], id: v.id });
      P.push({ t: 'pl', cls: 'cutend', pts: [A2, add(A2, mul(u, 6))], id: v.id }, { t: 'pl', cls: 'cutend', pts: [sub(B2, mul(u, 6)), B2], id: v.id });
      // flechas en la dirección de la mirada (proyección en la hoja de la normal)
      const nv: P2 = unit(v.section.n2 ?? [0, 0]);
      for (const E of [A2, B2]) {
        const tail = add(E, mul(nv, -0.1)), tip = add(E, mul(nv, 7));
        P.push({ t: 'pl', cls: 'thick', pts: [tail, tip], id: v.id }, { t: 'fill', cls: 'arrow', loops: [arrowTri(tip, nv, 3.5, 1.2)], id: v.id });
        P.push({ t: 'txt', cls: 'vlabel big', x: E[0] + nv[0] * 10 - u[0] * 2, y: E[1] + nv[1] * 10 - 1.7 - u[1] * 2, h: 5, text: v.label ?? 'A', anchor: 'middle', id: v.id, bold: true });
      }
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
    P.push({ t: 'txt', cls: 'dimt', x: g.mid[0], y: g.mid[1], h: 3.5, text: g.text, rot: g.ang, anchor: 'middle', id: d.id });
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
  for (const n of drw.notes) P.push({ t: 'txt', cls: 'note', x: n.x, y: n.y, h: n.size, text: n.text, id: n.id });
  // Cajetín
  const tb = titleBlockGeometry(drw);
  for (const c of tb.cells) {
    P.push({ t: 'pl', cls: 'tb', pts: [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h], [c.x, c.y]] });
    P.push({ t: 'txt', cls: 'tbl', x: c.x + 1.2, y: c.y + c.h - 2.6, h: 1.8, text: c.label });
    if (c.value) P.push({ t: 'txt', cls: c.big ? 'tbb' : 'tbv', x: c.x + 1.2, y: c.y + (c.big ? 3 : 1.4), h: c.big ? 5 : 2.5, text: c.value, bold: c.big });
  }
  // Símbolo de proyección europea
  const sx = tb.x0 + 168, sy = tb.y0 + 4;
  P.push({ t: 'circ', cls: 'tb', c: [sx - 6, sy], r: 2.6 }, { t: 'circ', cls: 'tb', c: [sx - 6, sy], r: 1.2 });
  P.push({ t: 'pl', cls: 'tb', pts: [[sx - 1, sy + 2.6], [sx + 4, sy + 1.6], [sx + 4, sy - 1.6], [sx - 1, sy - 2.6], [sx - 1, sy + 2.6]] });
  if (bom) for (const [i, row] of bom.entries()) for (const c of row.cells) {
    P.push({ t: 'pl', cls: 'tb', pts: [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + 6], [c.x, c.y + 6], [c.x, c.y]] });
    P.push({ t: 'txt', cls: i === bom.length - 1 ? 'tbb' : 'tbv', x: c.x + 1.2, y: c.y + 1.8, h: 2.5, text: c.text, bold: i === bom.length - 1 });
  }
  return P;
}

/** Rayado a 45° de lazos (regla par-impar) para PDF y DXF. */
export function hatchLines(loops: P2[][], step = 2.5): P2[][] {
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
