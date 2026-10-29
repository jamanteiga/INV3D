// Boceto paramétrico: acceso a la geometría, restricciones geométricas, cotas y solver numérico.
// El solver es de Gauss-Newton con paso de norma mínima ponderada: la geometría no restringida no se mueve.
import {
  uid, splineBeziers, entityOutline,
  type SketchF, type SkEntity, type SkConstraint, type GRef, type V2, type DimKind, type ConstraintType,
} from './doc';

export type Ev = (s: string) => number;

const LIT = /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*(mm|deg)?\s*$/i;
/** Un campo es variable del solver si contiene un número literal; una expresión (parámetros) lo fija. */
export const isLiteral = (s: string) => LIT.test(s);
export const num = (x: number) => String(Number((Math.abs(x) < 1e-9 ? 0 : x).toFixed(6)));

// ---------------- Campos ----------------
export function entityFields(e: SkEntity): string[] {
  switch (e.type) {
    case 'line': return ['a.0', 'a.1', 'b.0', 'b.1'];
    case 'rect': return ['x', 'y', 'w', 'h'];
    case 'circle': return ['cx', 'cy', 'd'];
    case 'arc': return ['cx', 'cy', 'r', 'a0', 'a1'];
    case 'poly': case 'spline': return e.pts.flatMap((_, i) => [`pts.${i}.0`, `pts.${i}.1`]);
    case 'npoly': return ['cx', 'cy', 'd', 'rot'];
    case 'point': return ['cx', 'cy'];
    case 'slot': return ['x1', 'y1', 'x2', 'y2', 'w'];
    case 'ellipse': return ['cx', 'cy', 'rx', 'ry', 'rot'];
    case 'text': return ['x', 'y', 'size', 'rot'];
  }
}
export function getField(e: SkEntity, path: string): string {
  let o: any = e;
  for (const k of path.split('.')) o = o?.[k];
  return String(o ?? '0');
}
export function setField(e: SkEntity, path: string, v: string) {
  const ks = path.split('.');
  let o: any = e;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = v;
}

type G = (path: string) => number;
const D2R = Math.PI / 180;

// ---------------- Puntos, tramos y curvas ----------------
export function pointKeys(e: SkEntity): string[] {
  switch (e.type) {
    case 'line': return ['a', 'b'];
    case 'rect': return ['p0', 'p1', 'p2', 'p3', 'c'];
    case 'circle': case 'npoly': case 'point': case 'ellipse': return ['c'];
    case 'arc': return ['c', 's', 'e'];
    case 'poly': case 'spline': return e.pts.map((_, i) => `p${i}`);
    case 'slot': return ['c1', 'c2'];
    case 'text': return ['c'];
  }
}
export function pointOf(e: SkEntity, k: string, g: G): V2 {
  switch (e.type) {
    case 'line': return k === 'a' ? [g('a.0'), g('a.1')] : k === 'b' ? [g('b.0'), g('b.1')] : [(g('a.0') + g('b.0')) / 2, (g('a.1') + g('b.1')) / 2];
    case 'rect': {
      const x = g('x'), y = g('y'), w = g('w'), h = g('h');
      return k === 'p0' ? [x, y] : k === 'p1' ? [x + w, y] : k === 'p2' ? [x + w, y + h] : k === 'p3' ? [x, y + h] : [x + w / 2, y + h / 2];
    }
    case 'arc': {
      const cx = g('cx'), cy = g('cy');
      if (k === 's' || k === 'e') { const r = g('r'), a = g(k === 's' ? 'a0' : 'a1') * D2R; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
      return [cx, cy];
    }
    case 'poly': case 'spline': { const i = parseInt(k.slice(1), 10) || 0; return [g(`pts.${i}.0`), g(`pts.${i}.1`)]; }
    case 'slot': return k === 'c2' ? [g('x2'), g('y2')] : [g('x1'), g('y1')];
    case 'text': return [g('x'), g('y')];
    default: return [g('cx'), g('cy')];
  }
}
export function segKeys(e: SkEntity): string[] {
  if (e.type === 'line') return [''];
  if (e.type === 'rect') return ['s0', 's1', 's2', 's3'];
  if (e.type === 'poly') return e.pts.map((_, i) => `s${i}`);
  return [];
}
export function segOf(e: SkEntity, k: string, g: G): [V2, V2] {
  if (e.type === 'line') return [pointOf(e, 'a', g), pointOf(e, 'b', g)];
  if (e.type === 'rect') { const i = parseInt(k.slice(1), 10) || 0; return [pointOf(e, `p${i}`, g), pointOf(e, `p${(i + 1) % 4}`, g)]; }
  if (e.type === 'poly') { const i = parseInt(k.slice(1), 10) || 0; return [pointOf(e, `p${i}`, g), pointOf(e, `p${(i + 1) % e.pts.length}`, g)]; }
  throw new Error('No es una línea');
}
export const isCurve = (e: SkEntity) => e.type === 'circle' || e.type === 'arc';
export function curveOf(e: SkEntity, g: G): { c: V2; r: number } {
  if (e.type === 'circle') return { c: [g('cx'), g('cy')], r: g('d') / 2 };
  if (e.type === 'arc') return { c: [g('cx'), g('cy')], r: g('r') };
  if (e.type === 'npoly') return { c: [g('cx'), g('cy')], r: g('d') / 2 };
  throw new Error('No es un círculo ni un arco');
}

/** Tipo de una referencia: punto, línea o curva circular. */
export function refKind(sk: SketchF, r: GRef): 'point' | 'line' | 'curve' | null {
  if (r.e === 'O') return 'point';
  if (r.e === 'X' || r.e === 'Y') return 'line';
  const e = sk.entities.find((x) => x.id === r.e);
  if (!e) return null;
  if (r.k !== undefined && pointKeys(e).includes(r.k)) return 'point';
  if (e.type === 'point') return 'point';
  if (e.type === 'line' || (r.k && segKeys(e).includes(r.k))) return 'line';
  if (isCurve(e)) return 'curve';
  return null;
}

// ---------------- Contexto numérico ----------------
interface Slot { v?: number; c?: number }
export interface SolveCtx {
  sk: SketchF; ev: Ev;
  vars: { e: string; path: string }[];
  x0: number[];
  slots: Map<string, Map<string, Slot>>;
  ents: Map<string, SkEntity>;
}
export function buildCtx(sk: SketchF, ev: Ev): SolveCtx {
  const vars: { e: string; path: string }[] = [], x0: number[] = [];
  const slots = new Map<string, Map<string, Slot>>();
  const ents = new Map<string, SkEntity>();
  for (const e of sk.entities) {
    ents.set(e.id, e);
    const m = new Map<string, Slot>();
    for (const p of entityFields(e)) {
      const s = getField(e, p);
      let val: number; try { val = ev(s); } catch { val = NaN; }
      if (!e.ref && isLiteral(s) && !(e.type === 'npoly' && p === 'n')) { m.set(p, { v: vars.length }); vars.push({ e: e.id, path: p }); x0.push(val); }
      else m.set(p, { c: val });
    }
    slots.set(e.id, m);
  }
  return { sk, ev, vars, x0, slots, ents };
}

class Geo {
  constructor(private ctx: SolveCtx, private x: number[]) {}
  g(eid: string): G {
    const m = this.ctx.slots.get(eid);
    if (!m) throw new Error('Geometría no encontrada');
    return (p) => { const s = m.get(p); if (!s) return 0; return s.v !== undefined ? this.x[s.v] : s.c!; };
  }
  P(r: GRef): V2 {
    if (r.e === 'O') return [0, 0];
    const e = this.ctx.ents.get(r.e)!;
    if (!e) throw new Error('Punto no encontrado');
    return pointOf(e, r.k ?? 'c', this.g(r.e));
  }
  L(r: GRef): [V2, V2] {
    if (r.e === 'X') return [[0, 0], [1, 0]];
    if (r.e === 'Y') return [[0, 0], [0, 1]];
    const e = this.ctx.ents.get(r.e)!;
    return segOf(e, r.k ?? '', this.g(r.e));
  }
  C(r: GRef) { return curveOf(this.ctx.ents.get(r.e)!, this.g(r.e)); }
}

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const cross = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const len = (a: V2) => Math.hypot(a[0], a[1]);

/** Distancia con signo de P a la recta AB (positiva a la izquierda de A→B). */
const sdist = (P: V2, A: V2, B: V2) => cross(sub(B, A), sub(P, A)) / (len(sub(B, A)) || 1e-12);
const signedAngle = (u: V2, v: V2) => Math.atan2(cross(u, v), dot(u, v));

/** Valor medido actual de una cota (en mm o grados) y su signo natural. */
export function measure(kind: DimKind, a: GRef, b: GRef | undefined, G0: Geo, sk: SketchF): { v: number; sense: number } {
  switch (kind) {
    case 'len': { const [A, B] = G0.L(a); return { v: len(sub(B, A)), sense: 1 }; }
    case 'radius': return { v: G0.C(a).r, sense: 1 };
    case 'diameter': return { v: G0.C(a).r * 2, sense: 1 };
    case 'dist': { const ka = refKind(sk, a); if (ka === 'line') { const [A, B] = G0.L(a); return { v: len(sub(B, A)), sense: 1 }; } return { v: len(sub(G0.P(b!), G0.P(a))), sense: 1 }; }
    case 'hdist': { const d = G0.P(b!)[0] - G0.P(a)[0]; return { v: Math.abs(d), sense: d < 0 ? -1 : 1 }; }
    case 'vdist': { const d = G0.P(b!)[1] - G0.P(a)[1]; return { v: Math.abs(d), sense: d < 0 ? -1 : 1 }; }
    case 'pldist': { const [A, B] = G0.L(b!); const d = sdist(G0.P(a), A, B); return { v: Math.abs(d), sense: d < 0 ? -1 : 1 }; }
    case 'lldist': { const [A, B] = G0.L(a), [C] = G0.L(b!); const d = sdist(C, A, B); return { v: Math.abs(d), sense: d < 0 ? -1 : 1 }; }
    case 'angle': {
      const [A, B] = G0.L(a), [C, D] = G0.L(b!);
      const t = signedAngle(sub(B, A), sub(D, C));
      return { v: Math.abs(t) / D2R, sense: t < 0 ? -1 : 1 };
    }
  }
}

function residuals(c: SkConstraint, G0: Geo, sk: SketchF, ev: Ev): number[] {
  const { a, b } = c;
  switch (c.type) {
    case 'coincident': { const p = G0.P(a), q = G0.P(b!); return [p[0] - q[0], p[1] - q[1]]; }
    case 'onobject': {
      const kb = refKind(sk, b!);
      const P = G0.P(a);
      if (kb === 'line') { const [A, B] = G0.L(b!); return [sdist(P, A, B)]; }
      const C = G0.C(b!); return [len(sub(P, C.c)) - C.r];
    }
    case 'horizontal': case 'vertical': {
      const [A, B] = b ? [G0.P(a), G0.P(b)] : G0.L(a);
      return [c.type === 'horizontal' ? A[1] - B[1] : A[0] - B[0]];
    }
    case 'parallel': case 'perpendicular': case 'collinear': {
      const [A, B] = G0.L(a), [C, D] = G0.L(b!);
      const u = sub(B, A), v = sub(D, C), lu = len(u) || 1e-12, lv = len(v) || 1e-12;
      if (c.type === 'perpendicular') return [dot(u, v) / (lu * lv)];
      const par = cross(u, v) / (lu * lv);
      return c.type === 'parallel' ? [par] : [par, sdist(C, A, B)];
    }
    case 'equal': {
      const ka = refKind(sk, a);
      if (ka === 'line') { const [A, B] = G0.L(a), [C, D] = G0.L(b!); return [len(sub(B, A)) - len(sub(D, C))]; }
      return [G0.C(a).r - G0.C(b!).r];
    }
    case 'concentric': { const p = G0.C(a).c, q = G0.C(b!).c; return [p[0] - q[0], p[1] - q[1]]; }
    case 'tangent': {
      const ka = refKind(sk, a), kb = refKind(sk, b!);
      if (ka === 'line' || kb === 'line') {
        const L = ka === 'line' ? a : b!, Cr = ka === 'line' ? b! : a;
        const [A, B] = G0.L(L), C = G0.C(Cr);
        return [sdist(C.c, A, B) - (c.sense ?? 1) * C.r];
      }
      const p = G0.C(a), q = G0.C(b!), d = len(sub(p.c, q.c));
      return [c.inner ? d - Math.abs(p.r - q.r) : d - (p.r + q.r)];
    }
    case 'midpoint': {
      const P = G0.P(a), [A, B] = G0.L(b!);
      return [P[0] - (A[0] + B[0]) / 2, P[1] - (A[1] + B[1]) / 2];
    }
    case 'symmetric': {
      const P = G0.P(a), Q = G0.P(b!), [A, B] = G0.L(c.c!);
      const M: V2 = [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2], u = sub(B, A), lu = len(u) || 1e-12;
      return [sdist(M, A, B), dot(sub(Q, P), u) / lu];
    }
    case 'fix': { const P = G0.P(a), at = c.at ?? [0, 0]; return [P[0] - at[0], P[1] - at[1]]; }
    case 'dim': {
      if (c.driven) return [];
      let val: number; try { val = ev(c.expr ?? '0'); } catch { return []; }
      if (!isFinite(val)) return [];
      const s = c.sense ?? 1;
      switch (c.kind!) {
        case 'len': { const [A, B] = G0.L(a); return [len(sub(B, A)) - val]; }
        case 'radius': return [G0.C(a).r - val];
        case 'diameter': return [2 * G0.C(a).r - val];
        case 'dist': {
          if (refKind(sk, a) === 'line') { const [A, B] = G0.L(a); return [len(sub(B, A)) - val]; }
          return [len(sub(G0.P(b!), G0.P(a))) - val];
        }
        case 'hdist': return [G0.P(b!)[0] - G0.P(a)[0] - s * val];
        case 'vdist': return [G0.P(b!)[1] - G0.P(a)[1] - s * val];
        case 'pldist': { const [A, B] = G0.L(b!); return [sdist(G0.P(a), A, B) - s * val]; }
        case 'lldist': {
          const [A, B] = G0.L(a), [C, D] = G0.L(b!);
          const u = sub(B, A), v = sub(D, C);
          return [sdist(C, A, B) - s * val, cross(u, v) / ((len(u) || 1e-12) * (len(v) || 1e-12))];
        }
        case 'angle': {
          const [A, B] = G0.L(a), [C, D] = G0.L(b!);
          const t = signedAngle(sub(B, A), sub(D, C)) - s * val * D2R;
          return [Math.atan2(Math.sin(t), Math.cos(t))];
        }
      }
    }
  }
  return [];
}

function allResiduals(ctx: SolveCtx, x: number[], list: SkConstraint[], extra: { v: number; target: number; w: number }[] = []): number[] {
  const G0 = new Geo(ctx, x), out: number[] = [];
  for (const c of list) {
    try { for (const r of residuals(c, G0, ctx.sk, ctx.ev)) out.push(isFinite(r) ? r : 0); } catch { /* referencia rota: se ignora */ }
  }
  for (const d of extra) out.push((x[d.v] - d.target) * d.w);
  return out;
}

function jacobian(ctx: SolveCtx, x: number[], list: SkConstraint[], r0: number[]): number[][] {
  const n = x.length, m = r0.length;
  const J: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
  const xx = x.slice();
  for (let j = 0; j < n; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(x[j]));
    xx[j] = x[j] + h; const rp = allResiduals(ctx, xx, list);
    xx[j] = x[j] - h; const rm = allResiduals(ctx, xx, list);
    xx[j] = x[j];
    for (let i = 0; i < m; i++) J[i][j] = (rp[i] - rm[i]) / (2 * h);
  }
  return J;
}

/** Resuelve A y = b (A cuadrada, simétrica definida positiva tras regularizar) por eliminación con pivote. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let k = 0; k < n; k++) {
    let p = k; for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    [M[k], M[p]] = [M[p], M[k]];
    const d = M[k][k]; if (Math.abs(d) < 1e-300) continue;
    for (let i = k + 1; i < n; i++) { const f = M[i][k] / d; if (!f) continue; for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j]; }
  }
  const y = new Array(n).fill(0);
  for (let k = n - 1; k >= 0; k--) { let s = M[k][n]; for (let j = k + 1; j < n; j++) s -= M[k][j] * y[j]; y[k] = Math.abs(M[k][k]) > 1e-300 ? s / M[k][k] : 0; }
  return y;
}

const norm2 = (r: number[]) => r.reduce((s, v) => s + v * v, 0);

/** Rango y columnas libres (espacio nulo) de J por escalonamiento reducido. */
function rref(J: number[][], n: number) {
  const M = J.map((r) => r.slice()), m = M.length;
  const pivots: number[] = [];
  let row = 0;
  const scale = Math.max(1e-12, ...M.flat().map(Math.abs));
  const tol = 1e-7 * scale;
  for (let col = 0; col < n && row < m; col++) {
    let p = row; for (let i = row + 1; i < m; i++) if (Math.abs(M[i][col]) > Math.abs(M[p][col])) p = i;
    if (Math.abs(M[p][col]) <= tol) continue;
    [M[row], M[p]] = [M[p], M[row]];
    const d = M[row][col];
    for (let j = col; j < n; j++) M[row][j] /= d;
    for (let i = 0; i < m; i++) if (i !== row && M[i][col]) { const f = M[i][col]; for (let j = col; j < n; j++) M[i][j] -= f * M[row][j]; }
    pivots.push(col); row++;
  }
  // Variables no determinadas: las libres y las pivote que dependen de alguna libre
  const free = new Set<number>();
  const pivSet = new Set(pivots);
  for (let j = 0; j < n; j++) if (!pivSet.has(j)) free.add(j);
  pivots.forEach((pc, ri) => { for (const f of [...free]) if (!pivSet.has(f) && Math.abs(M[ri][f]) > 1e-6) { free.add(pc); break; } });
  return { rank: pivots.length, free };
}

export interface SolveResult {
  ok: boolean; residual: number; dof: number;
  /** valores por entidad y campo */
  values: Map<string, Map<string, number>>;
  /** entidades no totalmente restringidas */
  underIds: Set<string>;
  rank: number;
}

export function solve(sk: SketchF, ev: Ev, opts: { drag?: { e: string; path: string; target: number }[]; list?: SkConstraint[]; analyse?: boolean; maxIt?: number; tol?: number } = {}): SolveResult {
  const ctx = buildCtx(sk, ev);
  const list = opts.list ?? sk.constraints ?? [];
  const n = ctx.vars.length;
  let x = ctx.x0.slice();
  // Arrastre: se lleva el punto al cursor y se resuelve con alto coste para moverlo de ahí
  const w = new Array(n).fill(1);
  if (opts.drag) for (const d of opts.drag) {
    const s = ctx.slots.get(d.e)?.get(d.path);
    if (s?.v !== undefined) { x[s.v] = d.target; w[s.v] = 1e-4; }
  }
  let r = allResiduals(ctx, x, list);
  let f = norm2(r);
  const maxIt = opts.maxIt ?? 60;
  for (let it = 0; it < maxIt && f > 1e-18 && n > 0; it++) {
    const J = jacobian(ctx, x, list, r);
    const m = r.length;
    // (J W J^T + λI) y = r ;  dx = -W J^T y
    const A: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
    for (let i = 0; i < m; i++) for (let k = i; k < m; k++) {
      let s = 0; for (let j = 0; j < n; j++) s += J[i][j] * w[j] * J[k][j];
      A[i][k] = s; A[k][i] = s;
    }
    const lam = 1e-10 * Math.max(1, ...A.map((row, i) => row[i]));
    for (let i = 0; i < m; i++) A[i][i] += lam;
    const y = solveLinear(A, r);
    const dx = new Array(n).fill(0);
    for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < m; i++) s += J[i][j] * y[i]; dx[j] = -w[j] * s; }
    let alpha = 1, improved = false;
    for (let ls = 0; ls < 14; ls++) {
      const xn = x.map((v, j) => v + alpha * dx[j]);
      const rn = allResiduals(ctx, xn, list), fn = norm2(rn);
      if (fn < f) { x = xn; r = rn; f = fn; improved = true; break; }
      alpha /= 2;
    }
    if (!improved) break;
  }
  const ok = Math.sqrt(f) < (opts.tol ?? 1e-5);
  const values = new Map<string, Map<string, number>>();
  ctx.vars.forEach((v, i) => { if (!values.has(v.e)) values.set(v.e, new Map()); values.get(v.e)!.set(v.path, x[i]); });
  let dof = n, rank = 0;
  const underIds = new Set<string>();
  if (opts.analyse !== false && n > 0) {
    const r0 = allResiduals(ctx, x, list);
    const J = r0.length ? jacobian(ctx, x, list, r0) : [];
    const rr = rref(J, n);
    rank = rr.rank; dof = n - rr.rank;
    for (const j of rr.free) underIds.add(ctx.vars[j].e);
  }
  return { ok, residual: Math.sqrt(f), dof, values, underIds, rank };
}

/** Escribe en el boceto los valores resueltos (solo campos literales). */
export function applySolution(sk: SketchF, res: SolveResult) {
  for (const e of sk.entities) {
    const m = res.values.get(e.id); if (!m) continue;
    for (const [p, v] of m) setField(e, p, num(v));
    if (e.type === 'arc') {
      // ángulos normalizados a (-360, 360)
      for (const k of ['a0', 'a1'] as const) if (isLiteral(e[k])) { let a = parseFloat(e[k]); while (a > 360) a -= 360; while (a < -360) a += 360; e[k] = num(a); }
    }
  }
}

/** Resuelve un boceto en el sitio. Devuelve el resultado (sin escribir si no converge). */
export function solveInPlace(sk: SketchF, ev: Ev, analyse = false): SolveResult | null {
  if (!sk.constraints?.length) return null;
  const res = solve(sk, ev, { analyse });
  if (res.ok) applySolution(sk, res);
  return res;
}

/** Comprueba si una restricción nueva sobrerrestringe el boceto. */
export function checkNew(sk: SketchF, ev: Ev, c: SkConstraint): { ok: boolean; reason?: string } {
  const before = solve(sk, ev, { maxIt: 0 });
  const tmp: SketchF = { ...sk, constraints: [...(sk.constraints ?? []), c] };
  const after = solve(tmp, ev, {});
  if (!after.ok) return { ok: false, reason: after.residual < 1e-2 ? 'Sobrerrestringe el boceto (restricción redundante). Puedes crearla como cota de referencia.' : 'La restricción entra en conflicto con las existentes' };
  if (c.type !== 'dim' || !c.driven) {
    // residuos aportados por la nueva restricción
    const ctx = buildCtx(tmp, ev);
    const added = allResiduals(ctx, ctx.x0, [c]).length;
    if (added && after.rank - before.rank < added) return { ok: false, reason: 'Sobrerrestringe el boceto (restricción redundante). Puedes crearla como cota de referencia.' };
  }
  return { ok: true };
}

// ---------------- Nombres e iconos ----------------
export const CONSTRAINT_NAMES: Record<ConstraintType, string> = {
  coincident: 'Coincidente', onobject: 'Coincidente (sobre curva)', horizontal: 'Horizontal', vertical: 'Vertical', parallel: 'Paralela',
  perpendicular: 'Perpendicular', collinear: 'Colineal', equal: 'Igual', tangent: 'Tangente', concentric: 'Concéntrica',
  midpoint: 'Punto medio', symmetric: 'Simétrica', fix: 'Fija', dim: 'Cota',
};
export const CONSTRAINT_GLYPH: Record<ConstraintType, string> = {
  coincident: '•', onobject: '⊙', horizontal: '—', vertical: '|', parallel: '∥', perpendicular: '⊥', collinear: '⋯',
  equal: '=', tangent: '◡', concentric: '◎', midpoint: '△', symmetric: '⇋', fix: '🔒', dim: '↔',
};

/** Siguiente nombre de cota (d0, d1…), único en la pieza. */
export function nextDimName(used: Set<string>): string { let i = 0; while (used.has(`d${i}`)) i++; return `d${i}`; }

// ---------------- Geometría auxiliar: evaluación directa ----------------
export function entG(e: SkEntity, ev: Ev): G { return (p) => { try { return ev(getField(e, p)); } catch { return NaN; } }; }
export function refPoint(sk: SketchF, r: GRef, ev: Ev): V2 | null {
  if (r.e === 'O') return [0, 0];
  const e = sk.entities.find((x) => x.id === r.e); if (!e) return null;
  try { return pointOf(e, r.k ?? 'c', entG(e, ev)); } catch { return null; }
}
export function refLine(sk: SketchF, r: GRef, ev: Ev): [V2, V2] | null {
  if (r.e === 'X') return [[0, 0], [1, 0]];
  if (r.e === 'Y') return [[0, 0], [0, 1]];
  const e = sk.entities.find((x) => x.id === r.e); if (!e) return null;
  try { return segOf(e, r.k ?? '', entG(e, ev)); } catch { return null; }
}
export function refCurve(sk: SketchF, r: GRef, ev: Ev) {
  const e = sk.entities.find((x) => x.id === r.e); if (!e) return null;
  try { return curveOf(e, entG(e, ev)); } catch { return null; }
}

/** Crea una restricción de cota midiendo su valor actual (para el valor inicial y el sentido). */
export function makeDim(sk: SketchF, ev: Ev, kind: DimKind, a: GRef, b: GRef | undefined, pos: V2, name: string): SkConstraint {
  const ctx = buildCtx(sk, ev), G0 = new Geo(ctx, ctx.x0);
  const m = measure(kind, a, b, G0, sk);
  return { id: uid('k'), type: 'dim', kind, a, b, pos, name, sense: m.sense, expr: num(Number(m.v.toFixed(kind === 'angle' ? 4 : 3))) + (kind === 'angle' ? ' deg' : ' mm') };
}
export function dimValue(sk: SketchF, ev: Ev, c: SkConstraint): number {
  try { const ctx = buildCtx(sk, ev), G0 = new Geo(ctx, ctx.x0); return measure(c.kind!, c.a, c.b, G0, sk).v; } catch { return NaN; }
}
/** Crea una restricción geométrica con el sentido/variante ajustado a la situación actual. */
export function makeConstraint(sk: SketchF, ev: Ev, type: ConstraintType, a: GRef, b?: GRef, c?: GRef): SkConstraint {
  const k: SkConstraint = { id: uid('k'), type, a, b, c };
  if (type === 'tangent' && b) {
    const ka = refKind(sk, a), kb = refKind(sk, b);
    if (ka === 'line' || kb === 'line') {
      const L = ka === 'line' ? a : b, C = ka === 'line' ? b : a;
      const ln = refLine(sk, L, ev), cv = refCurve(sk, C, ev);
      if (ln && cv) k.sense = sdist(cv.c, ln[0], ln[1]) < 0 ? -1 : 1;
    } else {
      const p = refCurve(sk, a, ev), q = refCurve(sk, b, ev);
      if (p && q) { const d = len(sub(p.c, q.c)); k.inner = Math.abs(d - Math.abs(p.r - q.r)) < Math.abs(d - (p.r + q.r)); }
    }
  }
  if (type === 'fix') k.at = refPoint(sk, a, ev) ?? [0, 0];
  return k;
}

// ---------------- Perfiles: lazos de líneas, arcos y splines ----------------
export type Seg =
  | { kind: 'line'; a: V2; b: V2; id: string }
  | { kind: 'arc'; a: V2; b: V2; mid: V2; id: string }
  | { kind: 'spline'; a: V2; b: V2; bez: [V2, V2, V2, V2][]; id: string };

export function openSegments(sk: SketchF, ev: Ev): Seg[] {
  const out: Seg[] = [];
  for (const e of sk.entities) {
    if (e.construction) continue;
    const g = entG(e, ev);
    if (e.type === 'line') out.push({ kind: 'line', a: pointOf(e, 'a', g), b: pointOf(e, 'b', g), id: e.id });
    else if (e.type === 'arc') {
      const cx = g('cx'), cy = g('cy'), r = g('r'), a0 = g('a0');
      let sw = g('a1') - a0; while (sw <= 0) sw += 360; while (sw > 360) sw -= 360;
      const P = (deg: number): V2 => [cx + r * Math.cos(deg * D2R), cy + r * Math.sin(deg * D2R)];
      out.push({ kind: 'arc', a: P(a0), b: P(a0 + sw), mid: P(a0 + sw / 2), id: e.id });
    } else if (e.type === 'spline' && !e.closed) {
      const P = e.pts.map((p) => [ev(p[0]), ev(p[1])] as V2);
      if (P.length >= 2) out.push({ kind: 'spline', a: P[0], b: P[P.length - 1], bez: splineBeziers(P, false), id: e.id });
    }
  }
  return out;
}

/** Lazos cerrados formados por tramos abiertos encadenados (cada extremo compartido por exactamente dos tramos). */
export function findLoops(segs: Seg[], tol = 1e-5): { loops: { seg: Seg; rev: boolean }[][]; dangling: number; branched: boolean } {
  const key = (p: V2) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  // agrupar extremos cercanos (tolerancia real, no solo por rejilla)
  const nodes: V2[] = [];
  const nodeOf = (p: V2) => { for (let i = 0; i < nodes.length; i++) if (Math.hypot(nodes[i][0] - p[0], nodes[i][1] - p[1]) < tol * 10) return i; nodes.push(p); return nodes.length - 1; };
  void key;
  const ends = segs.map((s) => [nodeOf(s.a), nodeOf(s.b)] as [number, number]);
  const adj = new Map<number, number[]>();
  ends.forEach(([u, v], i) => { if (u === v) return; (adj.get(u) ?? adj.set(u, []).get(u)!).push(i); (adj.get(v) ?? adj.set(v, []).get(v)!).push(i); });
  const used = new Set<number>();
  const loops: { seg: Seg; rev: boolean }[][] = [];
  let dangling = 0, branched = false;
  for (const [, list] of adj) { if (list.length === 1) dangling++; if (list.length > 2) branched = true; }
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i) || ends[i][0] === ends[i][1]) continue;
    // Recorrido desde i siguiendo nodos de grado 2
    const loop: { seg: Seg; rev: boolean }[] = [];
    let cur = i, start = ends[i][0], node = ends[i][1], ok = true;
    const local = new Set<number>([i]);
    loop.push({ seg: segs[i], rev: false });
    while (node !== start) {
      const nb = (adj.get(node) ?? []).filter((j) => !local.has(j));
      if ((adj.get(node) ?? []).length !== 2 || nb.length !== 1) { ok = false; break; }
      cur = nb[0]; local.add(cur);
      const rev = ends[cur][1] === node;
      loop.push({ seg: segs[cur], rev });
      node = rev ? ends[cur][0] : ends[cur][1];
    }
    if (ok && (adj.get(start) ?? []).length === 2) { loops.push(loop); local.forEach((j) => used.add(j)); }
  }
  return { loops, dangling, branched };
}

/** Polilínea de un lazo (para área, contención y dibujo). */
export function loopPolyline(loop: { seg: Seg; rev: boolean }[]): V2[] {
  const out: V2[] = [];
  for (const { seg, rev } of loop) {
    let pts: V2[];
    if (seg.kind === 'line') pts = [seg.a, seg.b];
    else if (seg.kind === 'arc') {
      const c = circleFrom3(seg.a, seg.mid, seg.b);
      pts = c ? arcPts(c, seg.a, seg.mid, seg.b) : [seg.a, seg.mid, seg.b];
    } else {
      pts = [];
      seg.bez.forEach(([a, b, c, d], i) => { for (let k = i === 0 ? 0 : 1; k <= 12; k++) { const t = k / 12, u = 1 - t; pts.push([u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]]); } });
    }
    if (rev) pts = pts.reverse();
    out.push(...(out.length ? pts.slice(1) : pts));
  }
  if (out.length > 1) out.pop();
  return out;
}

export function circleFrom3(a: V2, b: V2, c: V2): { c: V2; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2;
  const ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { c: [ux, uy], r: Math.hypot(a[0] - ux, a[1] - uy) };
}
function arcPts(C: { c: V2; r: number }, a: V2, m: V2, b: V2): V2[] {
  const ang = (p: V2) => Math.atan2(p[1] - C.c[1], p[0] - C.c[0]);
  const t0 = ang(a), tm = ang(m);
  let t1 = ang(b);
  // sentido que pasa por el punto medio
  const norm = (t: number) => { while (t < t0) t += 2 * Math.PI; while (t >= t0 + 2 * Math.PI) t -= 2 * Math.PI; return t; };
  const ccw = norm(tm) < norm(t1);
  let sw = ccw ? norm(t1) - t0 : -(2 * Math.PI - (norm(t1) - t0));
  if (Math.abs(sw) < 1e-9) sw = 2 * Math.PI;
  t1 = t0 + sw;
  const n = Math.max(6, Math.ceil(Math.abs(sw) / (4 * D2R))), out: V2[] = [];
  for (let i = 0; i <= n; i++) { const t = t0 + (sw * i) / n; out.push([C.c[0] + C.r * Math.cos(t), C.c[1] + C.r * Math.sin(t)]); }
  return out;
}

export function polyArea(p: V2[]) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
export function pointInPoly(pt: V2, poly: V2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------- Intersecciones (para recortar / alargar) ----------------
type Prim = { kind: 'seg'; a: V2; b: V2; id: string; k?: string } | { kind: 'circ'; c: V2; r: number; a0?: number; sw?: number; id: string };

export function primitives(sk: SketchF, ev: Ev, skip?: string): Prim[] {
  const out: Prim[] = [];
  for (const e of sk.entities) {
    if (e.id === skip) continue;
    const g = entG(e, ev);
    try {
      if (e.type === 'line') out.push({ kind: 'seg', a: pointOf(e, 'a', g), b: pointOf(e, 'b', g), id: e.id });
      else if (e.type === 'rect' || e.type === 'poly') for (const k of segKeys(e)) { const [a, b] = segOf(e, k, g); out.push({ kind: 'seg', a, b, id: e.id, k }); }
      else if (e.type === 'circle') out.push({ kind: 'circ', c: [g('cx'), g('cy')], r: g('d') / 2, id: e.id });
      else if (e.type === 'arc') {
        let sw = g('a1') - g('a0'); while (sw <= 0) sw += 360;
        out.push({ kind: 'circ', c: [g('cx'), g('cy')], r: g('r'), a0: g('a0'), sw, id: e.id });
      } else if (e.type === 'npoly' || e.type === 'slot' || e.type === 'ellipse' || e.type === 'spline') {
        const o = e.type === 'spline' ? { pts: entityPts(e, ev), closed: !!e.closed } : { pts: entityPts(e, ev), closed: true };
        for (let i = 0; i < o.pts.length - (o.closed ? 0 : 1); i++) out.push({ kind: 'seg', a: o.pts[i], b: o.pts[(i + 1) % o.pts.length], id: e.id });
      }
    } catch { /* ignorar */ }
  }
  return out;
}
const entityPts = (e: SkEntity, ev: Ev) => entityOutline(e, ev).pts;

const onArc = (p: Prim & { kind: 'circ' }, pt: V2) => {
  if (p.a0 === undefined) return true;
  let a = (Math.atan2(pt[1] - p.c[1], pt[0] - p.c[0]) / D2R) - p.a0;
  while (a < -1e-7) a += 360; while (a > 360) a -= 360;
  return a <= p.sw! + 1e-7;
};

/** Intersecciones de la recta infinita A + t(B-A) con una primitiva: valores de t. */
export function lineHits(A: V2, B: V2, p: Prim): number[] {
  const d = sub(B, A), out: number[] = [];
  if (p.kind === 'seg') {
    const e = sub(p.b, p.a), den = cross(d, e);
    if (Math.abs(den) < 1e-12) return out;
    const w = sub(p.a, A), t = cross(w, e) / den, u = cross(w, d) / den;
    if (u >= -1e-9 && u <= 1 + 1e-9) out.push(t);
    return out;
  }
  const f = sub(A, p.c), a = dot(d, d), b = 2 * dot(f, d), c = dot(f, f) - p.r * p.r, disc = b * b - 4 * a * c;
  if (disc < 0 || a < 1e-18) return out;
  for (const s of [-1, 1]) { const t = (-b + s * Math.sqrt(disc)) / (2 * a); if (onArc(p, [A[0] + t * d[0], A[1] + t * d[1]])) out.push(t); }
  return out;
}
/** Intersecciones de una circunferencia (c, r) con una primitiva: ángulos en grados. */
export function circleHits(c: V2, r: number, p: Prim): number[] {
  const ang = (q: V2) => Math.atan2(q[1] - c[1], q[0] - c[0]) / D2R;
  if (p.kind === 'seg') {
    const self: Prim = { kind: 'circ', c, r, id: '' };
    return lineHits(p.a, p.b, self).filter((t) => t >= -1e-9 && t <= 1 + 1e-9).map((t) => ang([p.a[0] + t * (p.b[0] - p.a[0]), p.a[1] + t * (p.b[1] - p.a[1])]));
  }
  const d = len(sub(p.c, c));
  if (d < 1e-12 || d > r + p.r + 1e-9 || d < Math.abs(r - p.r) - 1e-9) return [];
  const a = (r * r - p.r * p.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r * r - a * a));
  const u: V2 = [(p.c[0] - c[0]) / d, (p.c[1] - c[1]) / d], m: V2 = [c[0] + u[0] * a, c[1] + u[1] * a];
  const pts: V2[] = h < 1e-9 ? [m] : [[m[0] - u[1] * h, m[1] + u[0] * h], [m[0] + u[1] * h, m[1] - u[0] * h]];
  return pts.filter((q) => onArc(p, q)).map(ang);
}

// ---------------- Operaciones de edición ----------------
const cloneSk = (sk: SketchF): SketchF => structuredClone(sk);
const refsEntity = (c: SkConstraint, id: string) => [c.a, c.b, c.c].some((r) => r?.e === id);
const refsPoint = (c: SkConstraint, id: string, k: string) => [c.a, c.b, c.c].some((r) => r?.e === id && r.k === k);

/** Convierte un rectángulo o contorno en líneas sueltas con sus restricciones. */
export function explode(sk: SketchF, id: string, ev: Ev): SketchF {
  const out = cloneSk(sk);
  const e = out.entities.find((x) => x.id === id);
  if (!e || (e.type !== 'rect' && e.type !== 'poly')) return out;
  const g = entG(e, ev), keys = segKeys(e);
  const ids = keys.map(() => uid('l'));
  const lines: SkEntity[] = keys.map((k, i) => { const [a, b] = segOf(e, k, g); return { id: ids[i], type: 'line', a: [num(a[0]), num(a[1])], b: [num(b[0]), num(b[1])], construction: e.construction }; });
  const cons: SkConstraint[] = keys.map((_, i) => ({ id: uid('k'), type: 'coincident' as const, a: { e: ids[i], k: 'b' }, b: { e: ids[(i + 1) % ids.length], k: 'a' } }));
  if (e.type === 'rect') cons.push(
    { id: uid('k'), type: 'horizontal', a: { e: ids[0] } }, { id: uid('k'), type: 'horizontal', a: { e: ids[2] } },
    { id: uid('k'), type: 'vertical', a: { e: ids[1] } }, { id: uid('k'), type: 'vertical', a: { e: ids[3] } });
  // Reasignar referencias al rectángulo/contorno
  const remap = (r?: GRef): GRef | undefined => {
    if (!r || r.e !== id) return r;
    if (r.k?.startsWith('p')) { const i = parseInt(r.k.slice(1), 10); return { e: ids[i % ids.length], k: 'a' }; }
    if (r.k?.startsWith('s')) { const i = parseInt(r.k.slice(1), 10); return { e: ids[i] }; }
    return undefined;
  };
  out.constraints = (out.constraints ?? []).flatMap((c) => {
    const a = remap(c.a), b = remap(c.b), cc = remap(c.c);
    if (!a || (c.b && !b) || (c.c && !cc)) return [];
    return [{ ...c, a, b, c: cc }];
  });
  out.entities = out.entities.filter((x) => x.id !== id).concat(lines);
  out.constraints.push(...cons);
  return out;
}

/** Recorta la parte de una línea, arco o círculo comprendida entre las intersecciones más próximas al punto de clic. */
export function trim(sk0: SketchF, id: string, click: V2, ev: Ev): SketchF {
  let sk = cloneSk(sk0);
  let e = sk.entities.find((x) => x.id === id);
  if (!e) return sk;
  if (e.type === 'rect' || e.type === 'poly') {
    // recorta el tramo más cercano tras convertir a líneas
    sk = explode(sk, id, ev);
    let best = '', bd = Infinity;
    for (const x of sk.entities) if (x.type === 'line') { const [a, b] = segOf(x, '', entG(x, ev)); const d = distToSeg(click, a, b); if (d < bd) { bd = d; best = x.id; } }
    if (!best) return sk;
    return trim(sk, best, click, ev);
  }
  const prims = primitives(sk, ev, id);
  const cons = sk.constraints ?? (sk.constraints = []);
  const g = entG(e, ev);
  if (e.type === 'line') {
    const A = pointOf(e, 'a', g), B = pointOf(e, 'b', g);
    const ts = prims.flatMap((p) => lineHits(A, B, p).map((t) => ({ t, p }))).filter((h) => h.t > 1e-7 && h.t < 1 - 1e-7).sort((x, y) => x.t - y.t);
    const d = sub(B, A), tc = dot(sub(click, A), d) / dot(d, d);
    const lo = [...ts].reverse().find((h) => h.t < tc), hi = ts.find((h) => h.t > tc);
    const P = (t: number): [string, string] => [num(A[0] + d[0] * t), num(A[1] + d[1] * t)];
    if (!lo && !hi) { sk.entities = sk.entities.filter((x) => x.id !== id); sk.constraints = cons.filter((c) => !refsEntity(c, id)); return sk; }
    const onCutter = (p: Prim, ref: GRef): SkConstraint | null => p.kind === 'circ' || !p.k ? { id: uid('k'), type: 'onobject', a: ref, b: { e: p.id, k: p.kind === 'seg' ? p.k : undefined } } : null;
    if (!lo) {
      sk.constraints = cons.filter((c) => !refsPoint(c, id, 'a') && !(c.type === 'dim' && refsEntity(c, id)));
      (e as any).a = P(hi!.t);
      const k = onCutter(hi!.p, { e: id, k: 'a' }); if (k) sk.constraints.push(k);
    } else if (!hi) {
      sk.constraints = cons.filter((c) => !refsPoint(c, id, 'b') && !(c.type === 'dim' && refsEntity(c, id)));
      (e as any).b = P(lo.t);
      const k = onCutter(lo.p, { e: id, k: 'b' }); if (k) sk.constraints.push(k);
    } else {
      const nid = uid('l');
      const ne: SkEntity = { id: nid, type: 'line', a: P(hi.t), b: [(e as any).b[0], (e as any).b[1]], construction: e.construction };
      (e as any).b = P(lo.t);
      sk.constraints = cons.filter((c) => !(c.type === 'dim' && refsEntity(c, id))).map((c) => {
        const mv = (r?: GRef) => (r && r.e === id && r.k === 'b' ? { e: nid, k: 'b' } : r);
        return { ...c, a: mv(c.a)!, b: mv(c.b), c: mv(c.c) };
      });
      sk.entities.push(ne);
      sk.constraints.push({ id: uid('k'), type: 'collinear', a: { e: id }, b: { e: nid } });
      for (const [h, ref] of [[lo, { e: id, k: 'b' }], [hi, { e: nid, k: 'a' }]] as const) { const k = onCutter(h.p, ref); if (k) sk.constraints.push(k); }
    }
    return sk;
  }
  if (e.type === 'circle' || e.type === 'arc') {
    const c: V2 = [g('cx'), g('cy')], r = e.type === 'circle' ? g('d') / 2 : g('r');
    const a0 = e.type === 'arc' ? g('a0') : 0;
    let sw = e.type === 'arc' ? g('a1') - a0 : 360; while (sw <= 0) sw += 360;
    const rel = (deg: number) => { let x = deg - a0; while (x < 0) x += 360; while (x >= 360) x -= 360; return x; };
    const hits = prims.flatMap((p) => circleHits(c, r, p)).map(rel).map((x) => (x > 360 - 1e-7 ? 0 : x))
      .filter((x) => e.type === 'circle' || (x > 1e-6 && x < sw - 1e-6)).sort((x, y) => x - y);
    const tc = rel(Math.atan2(click[1] - c[1], click[0] - c[0]) / D2R);
    if (e.type === 'circle') {
      if (hits.length < 2) { sk.entities = sk.entities.filter((x) => x.id !== id); sk.constraints = cons.filter((k) => !refsEntity(k, id)); return sk; }
      const lo = [...hits].reverse().find((h) => h < tc) ?? hits[hits.length - 1], hi = hits.find((h) => h > tc) ?? hits[0];
      const arc: SkEntity = { id, type: 'arc', cx: num(c[0]), cy: num(c[1]), r: num(r), a0: num(hi), a1: num(lo), construction: e.construction };
      sk.entities = sk.entities.map((x) => (x.id === id ? arc : x));
      sk.constraints = cons.map((k) => (k.type === 'dim' && k.a.e === id && k.kind === 'diameter' ? { ...k, kind: 'radius' as const, expr: `(${k.expr}) / 2` } : k));
      return sk;
    }
    const lo = [...hits].reverse().find((h) => h < tc), hi = hits.find((h) => h > tc);
    if (lo === undefined && hi === undefined) { sk.entities = sk.entities.filter((x) => x.id !== id); sk.constraints = cons.filter((k) => !refsEntity(k, id)); return sk; }
    const ar = e as Extract<SkEntity, { type: 'arc' }>;
    if (lo === undefined) { ar.a0 = num(a0 + hi!); sk.constraints = cons.filter((k) => !refsPoint(k, id, 's')); }
    else if (hi === undefined) { ar.a1 = num(a0 + lo); sk.constraints = cons.filter((k) => !refsPoint(k, id, 'e')); }
    else {
      const nid = uid('a');
      sk.entities.push({ id: nid, type: 'arc', cx: ar.cx, cy: ar.cy, r: ar.r, a0: num(a0 + hi), a1: ar.a1, construction: e.construction });
      ar.a1 = num(a0 + lo);
      sk.constraints = cons.map((k) => { const mv = (r?: GRef) => (r && r.e === id && r.k === 'e' ? { e: nid, k: 'e' } : r); return { ...k, a: mv(k.a)!, b: mv(k.b), c: mv(k.c) }; });
      sk.constraints.push({ id: uid('k'), type: 'concentric', a: { e: id }, b: { e: nid } }, { id: uid('k'), type: 'equal', a: { e: id }, b: { e: nid } });
    }
    return sk;
  }
  throw new Error('Solo se recortan líneas, arcos, círculos, rectángulos y contornos');
}

/** Alarga el extremo de una línea (o arco) más cercano al clic hasta la siguiente intersección. */
export function extend(sk0: SketchF, id: string, click: V2, ev: Ev): SketchF {
  const sk = cloneSk(sk0);
  const e = sk.entities.find((x) => x.id === id);
  if (!e || e.type !== 'line') throw new Error('Solo se alargan líneas');
  const g = entG(e, ev), A = pointOf(e, 'a', g), B = pointOf(e, 'b', g);
  const nearB = len(sub(click, B)) < len(sub(click, A));
  const prims = primitives(sk, ev, id);
  const ts = prims.flatMap((p) => lineHits(A, B, p));
  const t = nearB ? Math.min(...ts.filter((x) => x > 1 + 1e-7)) : Math.max(...ts.filter((x) => x < -1e-7));
  if (!isFinite(t)) throw new Error('No hay geometría con la que intersecar');
  const d = sub(B, A), P: [string, string] = [num(A[0] + d[0] * t), num(A[1] + d[1] * t)];
  if (nearB) (e as any).b = P; else (e as any).a = P;
  return sk;
}

export function distToSeg(p: V2, a: V2, b: V2) {
  const d = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), d) / Math.max(dot(d, d), 1e-18)));
  return len(sub(p, [a[0] + d[0] * t, a[1] + d[1] * t]));
}

/** Empalme (o chaflán) entre dos líneas que comparten extremo, en el vértice más próximo al clic. */
export function filletCorner(sk0: SketchF, click: V2, radius: number, ev: Ev, chamfer = false): SketchF {
  let sk = cloneSk(sk0);
  // explotar rectángulos/contornos con un vértice cercano
  for (const e of [...sk.entities]) if ((e.type === 'rect' || e.type === 'poly') && pointKeys(e).some((k) => k !== 'c' && len(sub(pointOf(e, k, entG(e, ev)), click)) < radius * 4 + 1)) sk = explode(sk, e.id, ev);
  const lines = sk.entities.filter((e): e is Extract<SkEntity, { type: 'line' }> => e.type === 'line' && !e.construction);
  let best: { l1: typeof lines[number]; k1: 'a' | 'b'; l2: typeof lines[number]; k2: 'a' | 'b'; P: V2 } | null = null, bd = Infinity;
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) for (const k1 of ['a', 'b'] as const) for (const k2 of ['a', 'b'] as const) {
    const p = pointOf(lines[i], k1, entG(lines[i], ev)), q = pointOf(lines[j], k2, entG(lines[j], ev));
    if (len(sub(p, q)) > 1e-5) continue;
    const d = len(sub(p, click)); if (d < bd) { bd = d; best = { l1: lines[i], k1, l2: lines[j], k2, P: p }; }
  }
  if (!best) throw new Error('Haz clic cerca de un vértice entre dos líneas');
  const { l1, k1, l2, k2, P } = best;
  const o1 = pointOf(l1, k1 === 'a' ? 'b' : 'a', entG(l1, ev)), o2 = pointOf(l2, k2 === 'a' ? 'b' : 'a', entG(l2, ev));
  const u1 = sub(o1, P), u2 = sub(o2, P), L1 = len(u1), L2 = len(u2);
  const n1: V2 = [u1[0] / L1, u1[1] / L1], n2: V2 = [u2[0] / L2, u2[1] / L2];
  const th = Math.acos(Math.max(-1, Math.min(1, dot(n1, n2))));
  if (th < 1e-3 || th > Math.PI - 1e-3) throw new Error('Las líneas son paralelas');
  const t = chamfer ? radius : radius / Math.tan(th / 2);
  if (t >= L1 - 1e-6 || t >= L2 - 1e-6) throw new Error('El radio es demasiado grande para estas líneas');
  const T1: V2 = [P[0] + n1[0] * t, P[1] + n1[1] * t], T2: V2 = [P[0] + n2[0] * t, P[1] + n2[1] * t];
  const cons = (sk.constraints ?? []).filter((c) => !(c.type === 'coincident' && [c.a, c.b].some((r) => r?.e === l1.id && r.k === k1) && [c.a, c.b].some((r) => r?.e === l2.id && r.k === k2)));
  (l1 as any)[k1] = [num(T1[0]), num(T1[1])];
  (l2 as any)[k2] = [num(T2[0]), num(T2[1])];
  sk.constraints = cons.filter((c) => !(c.type === 'dim' && (refsEntity(c, l1.id) || refsEntity(c, l2.id)) && (c.kind === 'len')));
  if (chamfer) {
    const id = uid('l');
    sk.entities.push({ id, type: 'line', a: [num(T1[0]), num(T1[1])], b: [num(T2[0]), num(T2[1])] });
    sk.constraints.push({ id: uid('k'), type: 'coincident', a: { e: l1.id, k: k1 }, b: { e: id, k: 'a' } }, { id: uid('k'), type: 'coincident', a: { e: l2.id, k: k2 }, b: { e: id, k: 'b' } });
    return sk;
  }
  const bis: V2 = [n1[0] + n2[0], n1[1] + n2[1]], bl = len(bis);
  const C: V2 = [P[0] + (bis[0] / bl) * (radius / Math.sin(th / 2)), P[1] + (bis[1] / bl) * (radius / Math.sin(th / 2))];
  let a0 = Math.atan2(T1[1] - C[1], T1[0] - C[0]) / D2R, a1 = Math.atan2(T2[1] - C[1], T2[0] - C[0]) / D2R;
  let first = { e: l1.id, k: k1 }, second = { e: l2.id, k: k2 };
  let sw = a1 - a0; while (sw <= 0) sw += 360;
  if (sw > 180) { [a0, a1] = [a1, a0]; [first, second] = [second, first]; }
  const id = uid('a');
  sk.entities.push({ id, type: 'arc', cx: num(C[0]), cy: num(C[1]), r: num(radius), a0: num(a0), a1: num(a1) });
  sk.constraints.push(
    { id: uid('k'), type: 'coincident', a: first, b: { e: id, k: 's' } },
    { id: uid('k'), type: 'coincident', a: second, b: { e: id, k: 'e' } },
  );
  sk.constraints.push(makeConstraint(sk, ev, 'tangent', { e: l1.id }, { e: id }), makeConstraint(sk, ev, 'tangent', { e: l2.id }, { e: id }));
  return sk;
}

/** Copia transformada de entidades (simetría, patrones, mover, girar, escalar). */
export function transformEntities(sk0: SketchF, ids: string[], ev: Ev, f: (p: V2) => V2, opts: { copy: boolean; scale?: number; mirror?: boolean; rot?: number }): { sk: SketchF; map: Map<string, string> } {
  const sk = cloneSk(sk0);
  const map = new Map<string, string>();
  const P = (x: string, y: string): [string, string] => { const q = f([ev(x), ev(y)]); return [num(q[0]), num(q[1])]; };
  const S = (v: string) => num(ev(v) * (opts.scale ?? 1));
  const newOnes: SkEntity[] = [];
  for (const id of ids) {
    const e0 = sk.entities.find((x) => x.id === id); if (!e0) continue;
    const e: any = structuredClone(e0);
    delete e.ref;
    switch (e.type) {
      case 'line': e.a = P(e.a[0], e.a[1]); e.b = P(e.b[0], e.b[1]); break;
      case 'poly': case 'spline': e.pts = e.pts.map((p: [string, string]) => P(p[0], p[1])); if (opts.mirror) e.pts.reverse(); break;
      case 'circle': case 'npoly': case 'point': case 'ellipse': case 'text': {
        const kx = e.type === 'text' ? 'x' : 'cx', ky = e.type === 'text' ? 'y' : 'cy';
        [e[kx], e[ky]] = P(e[kx], e[ky]);
        if (e.d) e.d = S(e.d);
        if (e.type === 'ellipse') { e.rx = S(e.rx); e.ry = S(e.ry); }
        if (e.type === 'text') e.size = S(e.size);
        if ('rot' in e) e.rot = num(opts.mirror ? -ev(e.rot) : ev(e.rot) + (opts.rot ?? 0));
        break;
      }
      case 'rect': {
        const g = entG(e0, ev), pts = ['p0', 'p1', 'p2', 'p3'].map((k) => f(pointOf(e0, k, g)));
        if (opts.rot && Math.abs(((opts.rot % 90) + 90) % 90) > 1e-9) {
          e.type = 'poly'; e.pts = pts.map((q) => [num(q[0]), num(q[1])]); delete e.x; delete e.y; delete e.w; delete e.h;
        } else {
          const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
          e.x = num(Math.min(...xs)); e.y = num(Math.min(...ys)); e.w = num(Math.max(...xs) - Math.min(...xs)); e.h = num(Math.max(...ys) - Math.min(...ys));
        }
        break;
      }
      case 'arc': {
        const g = entG(e0, ev), s = f(pointOf(e0, 's', g)), en = f(pointOf(e0, 'e', g)), c = f(pointOf(e0, 'c', g));
        e.cx = num(c[0]); e.cy = num(c[1]); e.r = S(e.r);
        const as = Math.atan2(s[1] - c[1], s[0] - c[0]) / D2R, ae = Math.atan2(en[1] - c[1], en[0] - c[0]) / D2R;
        if (opts.mirror) { e.a0 = num(ae); e.a1 = num(as); } else { e.a0 = num(as); e.a1 = num(ae); }
        break;
      }
      case 'slot': { [e.x1, e.y1] = P(e.x1, e.y1); [e.x2, e.y2] = P(e.x2, e.y2); e.w = S(e.w); break; }
    }
    if (opts.copy) { e.id = uid(e.type[0]); newOnes.push(e); map.set(id, e.id); }
    else { const i = sk.entities.findIndex((x) => x.id === id); sk.entities[i] = e; map.set(id, id); }
  }
  sk.entities.push(...newOnes);
  if (opts.copy) {
    // copiar también las restricciones internas al conjunto (salvo fijas y cotas no lineales)
    const inside = (r?: GRef) => !r || map.has(r.e) || r.e === 'O' || r.e === 'X' || r.e === 'Y';
    const rm = (r?: GRef) => (r && map.has(r.e) ? { ...r, e: map.get(r.e)! } : r);
    for (const c of sk0.constraints ?? []) {
      if (!map.has(c.a.e) || !inside(c.b) || !inside(c.c)) continue;
      if (c.type === 'fix' || c.type === 'horizontal' || c.type === 'vertical' || (c.type === 'dim' && (c.kind === 'hdist' || c.kind === 'vdist' || c.kind === 'angle' || c.kind === 'pldist' || c.kind === 'lldist'))) continue;
      if ([c.a, c.b, c.c].some((r) => r && (r.e === 'O' || r.e === 'X' || r.e === 'Y'))) continue;
      sk.constraints = [...(sk.constraints ?? []), { ...c, id: uid('k'), a: rm(c.a)!, b: rm(c.b), c: rm(c.c), name: undefined, expr: c.type === 'dim' && c.name ? c.name : c.expr }];
    }
  } else {
    // al mover/girar se eliminan fijaciones y cotas absolutas que lo impedirían
    sk.constraints = (sk.constraints ?? []).filter((c) => !(map.has(c.a.e) && (c.type === 'fix')));
  }
  return { sk, map };
}

/** Desfase de una entidad cerrada o de una cadena de líneas conectada. */
export function offsetEntity(sk0: SketchF, id: string, d: number, ev: Ev): SketchF {
  const sk = cloneSk(sk0);
  const e = sk.entities.find((x) => x.id === id); if (!e) return sk;
  const add = (x: SkEntity) => { sk.entities.push(x); return x.id; };
  const g = entG(e, ev);
  switch (e.type) {
    case 'circle': { const nid = add({ id: uid('c'), type: 'circle', cx: e.cx, cy: e.cy, d: num(g('d') + 2 * d) }); (sk.constraints ??= []).push({ id: uid('k'), type: 'concentric', a: { e: id }, b: { e: nid } }); return sk; }
    case 'arc': { const nid = add({ id: uid('a'), type: 'arc', cx: e.cx, cy: e.cy, r: num(g('r') + d), a0: e.a0, a1: e.a1 }); (sk.constraints ??= []).push({ id: uid('k'), type: 'concentric', a: { e: id }, b: { e: nid } }); return sk; }
    case 'rect': { add({ id: uid('r'), type: 'rect', x: num(g('x') - d), y: num(g('y') - d), w: num(g('w') + 2 * d), h: num(g('h') + 2 * d) }); return sk; }
    case 'slot': { add({ id: uid('sl'), type: 'slot', x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, w: num(g('w') + 2 * d) }); return sk; }
    case 'npoly': { add({ ...structuredClone(e), id: uid('n'), d: num(g('d') + (2 * d) / Math.cos(Math.PI / Math.max(3, Math.round(g('n'))))) }); return sk; }
    case 'ellipse': { add({ ...structuredClone(e), id: uid('el'), rx: num(g('rx') + d), ry: num(g('ry') + d) }); return sk; }
    case 'poly': case 'line': {
      // cadena de líneas: polígono cerrado o abierto
      let pts: V2[]; let closed: boolean;
      if (e.type === 'poly') { pts = e.pts.map((p) => [ev(p[0]), ev(p[1])] as V2); closed = true; }
      else {
        const segs = openSegments(sk, ev).filter((s) => s.kind === 'line');
        const { loops } = findLoops(segs);
        const lp = loops.find((l) => l.some((x) => x.seg.id === id));
        if (lp) { pts = loopPolyline(lp); closed = true; }
        else { const [a, b] = segOf(e, '', g); pts = [a, b]; closed = false; }
      }
      const s = closed && polyArea(pts) > 0 ? -1 : 1; // positivo = hacia fuera en lazos antihorarios
      const n = pts.length, segs = closed ? n : n - 1;
      const offL: [V2, V2][] = [];
      for (let i = 0; i < segs; i++) {
        const a = pts[i], b = pts[(i + 1) % n], u = sub(b, a), L = len(u) || 1, nn: V2 = [(-u[1] / L) * d * s, (u[0] / L) * d * s];
        offL.push([[a[0] + nn[0], a[1] + nn[1]], [b[0] + nn[0], b[1] + nn[1]]]);
      }
      const isect = (p: [V2, V2], q: [V2, V2]): V2 => {
        const r = sub(p[1], p[0]), t2 = sub(q[1], q[0]), den = cross(r, t2);
        if (Math.abs(den) < 1e-12) return p[1];
        const t = cross(sub(q[0], p[0]), t2) / den; return [p[0][0] + r[0] * t, p[0][1] + r[1] * t];
      };
      const out: V2[] = [];
      for (let i = 0; i < segs; i++) {
        const prev = closed ? offL[(i - 1 + segs) % segs] : i > 0 ? offL[i - 1] : null;
        out.push(prev ? isect(prev, offL[i]) : offL[i][0]);
      }
      if (!closed) out.push(offL[segs - 1][1]);
      if (closed && e.type === 'poly') add({ id: uid('p'), type: 'poly', pts: out.map((q) => [num(q[0]), num(q[1])]) });
      else {
        const ids = out.slice(0, closed ? out.length : out.length - 1).map(() => uid('l'));
        ids.forEach((lid, i) => { const a = out[i], b = out[(i + 1) % out.length]; add({ id: lid, type: 'line', a: [num(a[0]), num(a[1])], b: [num(b[0]), num(b[1])] }); });
        const cs = sk.constraints ??= [];
        for (let i = 0; i < ids.length - (closed ? 0 : 1); i++) cs.push({ id: uid('k'), type: 'coincident', a: { e: ids[i], k: 'b' }, b: { e: ids[(i + 1) % ids.length], k: 'a' } });
      }
      return sk;
    }
    default: throw new Error('Desfase no disponible para esta geometría');
  }
}

/** Todos los puntos seleccionables de un boceto (extremos, centros) con su referencia. */
export function sketchPoints(sk: SketchF, ev: Ev): { ref: GRef; p: V2 }[] {
  const out: { ref: GRef; p: V2 }[] = [{ ref: { e: 'O' }, p: [0, 0] }];
  for (const e of sk.entities) {
    const g = entG(e, ev);
    for (const k of pointKeys(e)) { try { const p = pointOf(e, k, g); if (isFinite(p[0]) && isFinite(p[1])) out.push({ ref: { e: e.id, k }, p }); } catch { /* */ } }
  }
  return out;
}
