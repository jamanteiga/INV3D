// Mallas de referencia (STL/OBJ) y ajuste de planos, cilindros y esferas a zonas de la malla.
import type { V3, V2 } from './doc';

/** Lee STL (binario o ASCII) u OBJ y devuelve los triángulos como lista de vértices (x,y,z ×3 por triángulo) */
export function parseMesh(buf: ArrayBuffer, name: string): Float32Array {
  const low = name.toLowerCase();
  if (low.endsWith('.obj')) {
    const txt = new TextDecoder().decode(buf), vs: number[][] = [], out: number[] = [];
    for (const line of txt.split(/\r?\n/)) {
      const t = line.trim().split(/\s+/);
      if (t[0] === 'v') vs.push([+t[1], +t[2], +t[3]]);
      else if (t[0] === 'f') {
        const idx = t.slice(1).map((x) => { const i = parseInt(x.split('/')[0]); return i < 0 ? vs.length + i : i - 1; });
        for (let k = 1; k + 1 < idx.length; k++) for (const q of [idx[0], idx[k], idx[k + 1]]) out.push(...(vs[q] ?? [0, 0, 0]));
      }
    }
    return new Float32Array(out);
  }
  const dv = new DataView(buf);
  const n = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  if (n && 84 + n * 50 === buf.byteLength) {
    const out = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) out[t * 9 + k] = dv.getFloat32(84 + t * 50 + 12 + k * 4, true);
    return out;
  }
  const txt = new TextDecoder().decode(buf), out: number[] = [];
  for (const m of txt.matchAll(/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g)) out.push(+m[1], +m[2], +m[3]);
  if (!out.length) throw new Error('Formato de malla no reconocido (STL u OBJ)');
  return new Float32Array(out);
}
export const toB64 = (a: Float32Array) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
export const fromB64 = (s: string) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new Float32Array(u.buffer); };

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const tri = (P: Float32Array, t: number): [V3, V3, V3] => [[P[t * 9], P[t * 9 + 1], P[t * 9 + 2]], [P[t * 9 + 3], P[t * 9 + 4], P[t * 9 + 5]], [P[t * 9 + 6], P[t * 9 + 7], P[t * 9 + 8]]];
const triN = (P: Float32Array, t: number) => { const [a, b, c] = tri(P, t); return norm(cross(sub(b, a), sub(c, a))); };

/** Zona lisa alrededor del triángulo semilla: se crece mientras el ángulo entre normales vecinas sea menor que la tolerancia */
export function growRegion(P: Float32Array, seed: number, tolDeg: number): number[] {
  const nT = P.length / 9, q = 1e-4;
  const key = (i: number) => `${Math.round(P[i] / q)},${Math.round(P[i + 1] / q)},${Math.round(P[i + 2] / q)}`;
  const vid = new Map<string, number>(), tv = new Int32Array(nT * 3);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) { const kk = key(t * 9 + k * 3); let v = vid.get(kk); if (v === undefined) { v = vid.size; vid.set(kk, v); } tv[t * 3 + k] = v; }
  const edges = new Map<string, number[]>();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) { const a = tv[t * 3 + k], b = tv[t * 3 + ((k + 1) % 3)]; const e = a < b ? `${a}_${b}` : `${b}_${a}`; const l = edges.get(e); if (l) l.push(t); else edges.set(e, [t]); }
  const cosT = Math.cos((tolDeg * Math.PI) / 180), seen = new Uint8Array(nT), out: number[] = [], stack = [seed];
  seen[seed] = 1;
  while (stack.length) {
    const t = stack.pop()!; out.push(t); const nt = triN(P, t);
    for (let k = 0; k < 3; k++) {
      const a = tv[t * 3 + k], b = tv[t * 3 + ((k + 1) % 3)];
      for (const u of edges.get(a < b ? `${a}_${b}` : `${b}_${a}`) ?? []) if (!seen[u] && dot(nt, triN(P, u)) >= cosT) { seen[u] = 1; stack.push(u); }
    }
    if (out.length > 400000) break;
  }
  return out;
}

/** Autovectores de una matriz simétrica 3×3 (Jacobi); devuelve [valores, vectores] de menor a mayor */
function eig3(A: number[][]): [number[], V3[]] {
  const a = A.map((r) => [...r]), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sw = 0; sw < 50; sw++) {
    let off = 0; for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += a[i][j] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
    }
  }
  const idx = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return [idx.map((i) => a[i][i]), idx.map((i) => [v[0][i], v[1][i], v[2][i]] as V3)];
}
function solve(M: number[][], b: number[]): number[] {
  const n = b.length, A = M.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    if (Math.abs(A[c][c]) < 1e-14) throw new Error('Ajuste mal condicionado');
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map((r, i) => r[n] / r[i]);
}
function hull(pts: V2[]): V2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (p.length < 3) return p;
  const cr = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: V2[] = [], up: V2[] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

export type MeshFit =
  | { kind: 'plane'; o: V3; n: V3; x: V3; poly: V2[]; rms: number }
  | { kind: 'cyl'; o: V3; d: V3; e1: V3; r: number; h0: number; h1: number; a0: number; a1: number; rms: number }
  | { kind: 'sphere'; c: V3; r: number; rms: number };

export function fitRegion(P: Float32Array, tris: number[], kind: 'auto' | 'plane' | 'cyl' | 'sphere'): MeshFit {
  const pts: V3[] = [], nrm: V3[] = [];
  const seenV = new Set<string>();
  for (const t of tris) { const n = triN(P, t); for (const v of tri(P, t)) { const k = v.map((x) => Math.round(x * 1e4)).join(','); if (!seenV.has(k)) { seenV.add(k); pts.push(v); } } nrm.push(n); }
  if (pts.length < 4) throw new Error('Zona demasiado pequeña');
  const c: V3 = [0, 0, 0]; for (const p of pts) { c[0] += p[0] / pts.length; c[1] += p[1] / pts.length; c[2] += p[2] / pts.length; }
  const cov = (arr: V3[], m: V3) => { const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const p of arr) { const d = sub(p, m); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]; } return C; };
  const size = Math.max(...[0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k])))) || 1;
  const plane = (): MeshFit => {
    const [, vec] = eig3(cov(pts, c)); const n = norm(vec[0]); let x = cross([0, 0, 1], n); if (Math.hypot(...x) < 1e-6) x = [1, 0, 0]; x = norm(x); const y = cross(n, x);
    let ss = 0; const p2 = pts.map((p) => { const d = sub(p, c); ss += dot(d, n) ** 2; return [dot(d, x), dot(d, y)] as V2; });
    return { kind: 'plane', o: c, n, x, poly: hull(p2), rms: Math.sqrt(ss / pts.length) };
  };
  const sphere = (): MeshFit => {
    const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], b = [0, 0, 0, 0];
    for (const p of pts) { const row = [p[0], p[1], p[2], 1], rhs = -(p[0] ** 2 + p[1] ** 2 + p[2] ** 2); for (let i = 0; i < 4; i++) { b[i] += row[i] * rhs; for (let j = 0; j < 4; j++) M[i][j] += row[i] * row[j]; } }
    const [D, E, F, G] = solve(M, b), cc: V3 = [-D / 2, -E / 2, -F / 2], r = Math.sqrt(Math.max(0, dot(cc, cc) - G));
    let ss = 0; for (const p of pts) ss += (Math.hypot(...sub(p, cc)) - r) ** 2;
    return { kind: 'sphere', c: cc, r, rms: Math.sqrt(ss / pts.length) };
  };
  const cyl = (): MeshFit => {
    const mn: V3 = [0, 0, 0]; for (const n of nrm) { mn[0] += n[0] / nrm.length; mn[1] += n[1] / nrm.length; mn[2] += n[2] / nrm.length; }
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const n of nrm) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += n[i] * n[j];
    const [, vec] = eig3(C); const d = norm(vec[0]);
    let e1 = cross(d, [0, 0, 1]); if (Math.hypot(...e1) < 1e-6) e1 = cross(d, [1, 0, 0]); e1 = norm(e1); const e2 = cross(d, e1);
    const p2 = pts.map((p) => { const w = sub(p, c); return [dot(w, e1), dot(w, e2)] as V2; });
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
    for (const [x, y] of p2) { const row = [x, y, 1], rhs = -(x * x + y * y); for (let i = 0; i < 3; i++) { b[i] += row[i] * rhs; for (let j = 0; j < 3; j++) M[i][j] += row[i] * row[j]; } }
    const [D, E, F] = solve(M, b), cx = -D / 2, cy = -E / 2, r = Math.sqrt(Math.max(0, cx * cx + cy * cy - F));
    const o: V3 = [c[0] + e1[0] * cx + e2[0] * cy, c[1] + e1[1] * cx + e2[1] * cy, c[2] + e1[2] * cx + e2[2] * cy];
    let ss = 0, h0 = Infinity, h1 = -Infinity; const angs: number[] = [];
    let ref = e1;
    for (const p of pts) { const w = sub(p, o), h = dot(w, d); h0 = Math.min(h0, h); h1 = Math.max(h1, h); const rad = sub(w, [d[0] * h, d[1] * h, d[2] * h]); ss += (Math.hypot(...rad) - r) ** 2; angs.push(Math.atan2(dot(rad, e2), dot(rad, e1))); }
    // arco ocupado: el complemento del mayor hueco entre ángulos
    angs.sort((x, y) => x - y);
    let gap = angs[0] + 2 * Math.PI - angs[angs.length - 1], gi = angs.length - 1;
    for (let i = 0; i + 1 < angs.length; i++) if (angs[i + 1] - angs[i] > gap) { gap = angs[i + 1] - angs[i]; gi = i; }
    let a0 = angs[(gi + 1) % angs.length], a1 = angs[gi]; if (a1 < a0) a1 += 2 * Math.PI;
    if (gap < (10 * Math.PI) / 180) { a0 = 0; a1 = 2 * Math.PI; }
    ref = e1;
    return { kind: 'cyl', o, d, e1: ref, r, h0, h1, a0, a1, rms: Math.sqrt(ss / pts.length) };
  };
  if (kind === 'plane') return plane();
  if (kind === 'cyl') return cyl();
  if (kind === 'sphere') return sphere();
  const pl = plane(); if (pl.rms < size * 2e-3) return pl;
  const cands: MeshFit[] = [pl];
  try { cands.push(cyl()); } catch { /* */ }
  try { cands.push(sphere()); } catch { /* */ }
  return cands.sort((a, b) => a.rms - b.rms)[0];
}
export const fitLabel = (f: MeshFit) => f.kind === 'plane' ? 'Plano' : f.kind === 'cyl' ? `Cilindro Ø${(f.r * 2).toFixed(3)}` : `Esfera Ø${(f.r * 2).toFixed(3)}`;
