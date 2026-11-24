// Herramienta Medir: selección de vértices, aristas y caras (en coordenadas globales, a partir de las mallas del visor)
// y cálculo de distancias mínimas/máximas/centro a centro, ángulos, longitudes, radios, áreas, perímetros y bucles.
import * as THREE from 'three';
import { create } from 'zustand';
import type { MeshData } from '../core/cadClient';

export type MKind = 'vertex' | 'edge' | 'face';
export interface MEnt { kind: MKind; label: string; p?: number[]; seg?: number[]; tri?: number[]; owner?: string }
export type MMode = 'auto' | 'vertex' | 'edge' | 'face' | 'loop';
export type MDist = 'min' | 'max' | 'center';
interface MState { sel: MEnt[]; mode: MMode; dist: MDist; prec: number; history: string[] }
export const useMeasure = create<MState>(() => ({ sel: [], mode: 'auto', dist: 'min', prec: 3, history: [] }));
export const measureReset = () => useMeasure.setState({ sel: [] });

const v = (a: number[], i = 0) => new THREE.Vector3(a[i], a[i + 1], a[i + 2]);

// ---------- Extracción de entidades desde una malla ----------
export function edgeEnt(m: MeshData, group: number, mw: THREE.Matrix4 | null, owner?: string): MEnt {
  const g = m.edgeGroups[group], out: number[] = [], p = new THREE.Vector3();
  for (let i = g.start; i < g.start + g.count; i++) { p.set(m.lines[i * 3], m.lines[i * 3 + 1], m.lines[i * 3 + 2]); if (mw) p.applyMatrix4(mw); out.push(p.x, p.y, p.z); }
  const e: MEnt = { kind: 'edge', label: 'Arista', seg: out, owner };
  const g2 = edgeGeom(e); e.label = g2.circle ? (g2.closed ? 'Arista circular' : 'Arco') : g2.line ? 'Arista recta' : 'Arista curva';
  return e;
}
export function faceEnt(m: MeshData, faceIndex: number, mw: THREE.Matrix4 | null, owner?: string): MEnt | null {
  const gi = m.faceGroups.findIndex((g) => faceIndex * 3 >= g.start && faceIndex * 3 < g.start + g.count); if (gi < 0) return null;
  const g = m.faceGroups[gi], out: number[] = [], p = new THREE.Vector3();
  for (let i = g.start; i < g.start + g.count; i++) { const vi = m.triangles[i]; p.set(m.vertices[vi * 3], m.vertices[vi * 3 + 1], m.vertices[vi * 3 + 2]); if (mw) p.applyMatrix4(mw); out.push(p.x, p.y, p.z); }
  const e: MEnt = { kind: 'face', label: 'Cara', tri: out, owner };
  const f = faceGeom(e); e.label = f.plane ? 'Cara plana' : f.cyl ? 'Cara cilíndrica' : f.sphere ? 'Cara esférica' : 'Cara curva';
  return e;
}
export const vertexEnt = (p: THREE.Vector3, owner?: string): MEnt => ({ kind: 'vertex', label: 'Vértice', p: [p.x, p.y, p.z], owner });

/** Vértices del modelo (extremos de las aristas) cerca del cursor, en píxeles. project: mundo → píxeles locales */
export function nearestVertex(P: THREE.Vector2, lines: Float32Array, mw: THREE.Matrix4 | null, project: (p: THREE.Vector3) => { x: number; y: number }, tolPx = 9, limit?: (p: THREE.Vector3) => boolean): THREE.Vector3 | null {
  const cnt = new Map<string, { p: THREE.Vector3; n: number; dirs: THREE.Vector3[] }>(), q = new THREE.Vector3(), r = new THREE.Vector3();
  const key = (p: THREE.Vector3) => `${Math.round(p.x * 1e3)}_${Math.round(p.y * 1e3)}_${Math.round(p.z * 1e3)}`;
  for (let i = 0; i + 5 < lines.length; i += 6) {
    q.set(lines[i], lines[i + 1], lines[i + 2]); r.set(lines[i + 3], lines[i + 4], lines[i + 5]); if (mw) { q.applyMatrix4(mw); r.applyMatrix4(mw); }
    for (const [a, b] of [[q, r], [r, q]]) { const k = key(a); let c = cnt.get(k); if (!c) cnt.set(k, (c = { p: a.clone(), n: 0, dirs: [] })); c.n++; c.dirs.push(b.clone().sub(a).normalize()); }
  }
  let best: THREE.Vector3 | null = null, bd = tolPx;
  for (const c of cnt.values()) {
    // vértice real: extremo libre, unión de 3+ tramos o giro brusco
    const corner = c.n !== 2 || c.dirs[0].dot(c.dirs[1]) > -0.82;
    if (!corner) continue;
    const s = project(c.p), d = Math.hypot(s.x - P.x, s.y - P.y);
    if (d < bd && (!limit || limit(c.p))) { bd = d; best = c.p; }
  }
  return best;
}

// ---------- Geometría de las entidades ----------
export interface EdgeG { L: number; pts: THREE.Vector3[]; line?: { a: THREE.Vector3; b: THREE.Vector3; d: THREE.Vector3 }; circle?: { c: THREE.Vector3; n: THREE.Vector3; r: number; ang: number }; closed: boolean }
export function edgeGeom(e: MEnt): EdgeG {
  const s = e.seg!, segs: [THREE.Vector3, THREE.Vector3][] = [];
  for (let i = 0; i + 5 < s.length; i += 6) segs.push([v(s, i), v(s, i + 3)]);
  let L = 0; for (const [a, b] of segs) L += a.distanceTo(b);
  const pts: THREE.Vector3[] = []; const seen = new Set<string>();
  for (const [a, b] of segs) for (const p of [a, b]) { const k = `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`; if (!seen.has(k)) { seen.add(k); pts.push(p); } }
  // extremos: puntos usados una sola vez
  const use = new Map<string, number>(); for (const [a, b] of segs) for (const p of [a, b]) { const k = `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`; use.set(k, (use.get(k) ?? 0) + 1); }
  const ends = pts.filter((p) => use.get(`${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`) === 1);
  const closed = ends.length === 0 && segs.length > 2;
  const out: EdgeG = { L, pts, closed };
  const tol = Math.max(1e-3, L * 1e-4);
  if (ends.length === 2 || pts.length === 2) {
    const a = ends[0] ?? pts[0], b = ends[1] ?? pts[1], d = b.clone().sub(a);
    if (d.length() > 1e-9) { d.normalize(); const ln = new THREE.Line3(a, b); if (pts.every((p) => ln.closestPointToPoint(p, false, new THREE.Vector3()).distanceTo(p) < tol)) { out.line = { a, b, d }; return out; } }
  }
  if (pts.length >= 3) {
    const a0 = pts[0], b0 = pts[Math.floor(pts.length / 3)], c0 = pts[Math.floor((2 * pts.length) / 3)];
    const ab = b0.clone().sub(a0), ac = c0.clone().sub(a0), n = ab.clone().cross(ac);
    if (n.lengthSq() > 1e-12) {
      const cc = a0.clone().add(ac.clone().cross(n).multiplyScalar(ab.lengthSq()).add(n.clone().cross(ab).multiplyScalar(ac.lengthSq())).multiplyScalar(1 / (2 * n.lengthSq())));
      const r = cc.distanceTo(a0);
      if (pts.every((p) => Math.abs(p.distanceTo(cc) - r) < Math.max(2e-3, r * 2e-3))) {
        // corregir la cuerda: la malla subestima la longitud del arco
        const ang = closed ? 2 * Math.PI : segs.reduce((acc, [p, q]) => acc + 2 * Math.asin(Math.min(1, p.distanceTo(q) / (2 * r))), 0);
        out.circle = { c: cc, n: n.normalize(), r, ang }; out.L = r * ang;
      }
    }
  }
  return out;
}

export interface FaceG { A: number; centroid: THREE.Vector3; plane?: { n: THREE.Vector3; p: THREE.Vector3 }; cyl?: { o: THREE.Vector3; d: THREE.Vector3; r: number }; sphere?: { c: THREE.Vector3; r: number }; loops: { L: number; pts: THREE.Vector3[] }[]; P: number; tris: THREE.Triangle[] }
export function faceGeom(e: MEnt): FaceG {
  const t = e.tri!, tris: THREE.Triangle[] = [];
  for (let i = 0; i + 8 < t.length; i += 9) tris.push(new THREE.Triangle(v(t, i), v(t, i + 3), v(t, i + 6)));
  let A = 0; const cen = new THREE.Vector3(), nsum = new THREE.Vector3(), tmp = new THREE.Vector3();
  const ns: THREE.Vector3[] = [];
  for (const tr of tris) { const a = tr.getArea(); A += a; cen.addScaledVector(tr.getMidpoint(tmp), a); const n = tr.getNormal(new THREE.Vector3()); ns.push(n); nsum.addScaledVector(n, a); }
  if (A > 0) cen.multiplyScalar(1 / A);
  const out: FaceG = { A, centroid: cen, loops: [], P: 0, tris };
  // contornos: aristas de triángulo usadas una sola vez
  const K = (p: THREE.Vector3) => `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)},${Math.round(p.z * 1e4)}`;
  const pt = new Map<string, THREE.Vector3>(), cnt = new Map<string, number>();
  for (const tr of tris) { const vs = [tr.a, tr.b, tr.c]; for (let i = 0; i < 3; i++) { const ka = K(vs[i]), kb = K(vs[(i + 1) % 3]); if (ka === kb) continue; pt.set(ka, vs[i]); pt.set(kb, vs[(i + 1) % 3]); const k = ka < kb ? ka + '|' + kb : kb + '|' + ka; cnt.set(k, (cnt.get(k) ?? 0) + 1); } }
  const adj = new Map<string, string[]>();
  for (const [k, n] of cnt) if (n === 1) { const [a, b] = k.split('|'); (adj.get(a) ?? adj.set(a, []).get(a)!).push(b); (adj.get(b) ?? adj.set(b, []).get(b)!).push(a); }
  const usedE = new Set<string>();
  for (const start of adj.keys()) {
    for (const nb of adj.get(start)!) {
      const ek = start < nb ? start + '|' + nb : nb + '|' + start; if (usedE.has(ek)) continue;
      const loop = [pt.get(start)!]; let prev = start, cur = nb, L = 0; usedE.add(ek);
      for (let guard = 0; guard < 100000; guard++) {
        L += pt.get(prev)!.distanceTo(pt.get(cur)!); loop.push(pt.get(cur)!);
        if (cur === start) break;
        const nx = (adj.get(cur) ?? []).find((x) => { const k2 = cur < x ? cur + '|' + x : x + '|' + cur; return !usedE.has(k2); });
        if (!nx) break;
        usedE.add(cur < nx ? cur + '|' + nx : nx + '|' + cur); prev = cur; cur = nx;
      }
      if (loop.length >= 8) { const c = circ3(loop); if (c && loop.every((q) => Math.abs(q.distanceTo(c.c) - c.r) < Math.max(2e-3, c.r * 2e-3))) L = 2 * Math.PI * c.r; }
      out.loops.push({ L, pts: loop });
    }
  }
  out.loops.sort((a, b) => b.L - a.L);
  out.P = out.loops.reduce((a, l) => a + l.L, 0);
  // tipo de superficie
  const n0 = nsum.clone().normalize();
  if (ns.every((n) => n.dot(n0) > 1 - 1e-5)) { out.plane = { n: n0, p: cen.clone() }; return out; }
  const V = tris.flatMap((tr) => [tr.a, tr.b, tr.c]);
  // esfera: centro por mínimos cuadrados (|p|² = 2c·p + k)
  const sph = fitSphere(V);
  if (sph && V.every((p) => Math.abs(p.distanceTo(sph.c) - sph.r) < Math.max(5e-3, sph.r * 5e-3))) {
    // ¿es en realidad un cilindro? (todas las normales perpendiculares a una dirección)
    const cy = fitCyl(tris, ns);
    if (!cy) { out.sphere = sph; return out; }
  }
  const cy = fitCyl(tris, ns); if (cy) out.cyl = cy;
  return out;
}
function circ3(pts: THREE.Vector3[]): { c: THREE.Vector3; r: number } | null {
  const a0 = pts[0], b0 = pts[Math.floor(pts.length / 3)], c0 = pts[Math.floor((2 * pts.length) / 3)];
  const ab = b0.clone().sub(a0), ac = c0.clone().sub(a0), n = ab.clone().cross(ac);
  if (n.lengthSq() < 1e-12) return null;
  const c = a0.clone().add(ac.clone().cross(n).multiplyScalar(ab.lengthSq()).add(n.clone().cross(ab).multiplyScalar(ac.lengthSq())).multiplyScalar(1 / (2 * n.lengthSq())));
  return { c, r: c.distanceTo(a0) };
}
function fitCyl(tris: THREE.Triangle[], ns: THREE.Vector3[]): FaceG['cyl'] | undefined {
  // eje: dirección perpendicular a todas las normales (vector propio menor de Σ n nᵀ)
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const n of ns) { const a = [n.x, n.y, n.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += a[i] * a[j]; }
  const d = minEig(M); if (!d) return;
  if (ns.some((n) => Math.abs(n.dot(d)) > 2e-3)) return;
  // proyectar centros sobre el plano ⟂ al eje y ajustar circunferencia (2D)
  const u = Math.abs(d.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0); u.sub(d.clone().multiplyScalar(u.dot(d))).normalize(); const w = d.clone().cross(u);
  const P2 = tris.flatMap((t) => [t.a, t.b, t.c]).map((p) => [p.dot(u), p.dot(w)]);
  let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0; const n = P2.length;
  for (const [x, y] of P2) { const z = x * x + y * y; Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y; Sxz += x * z; Syz += y * z; Sz += z; }
  const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]], b = [Sxz, Syz, Sz];
  const sol = solve3(A, b); if (!sol) return;
  const cx = sol[0] / 2, cy = sol[1] / 2, r = Math.sqrt(Math.max(0, sol[2] + cx * cx + cy * cy));
  if (!(r > 1e-6) || P2.some(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - r) > Math.max(5e-3, r * 5e-3))) return;
  const o = u.clone().multiplyScalar(cx).add(w.clone().multiplyScalar(cy));
  // situar el origen a la altura media de la cara
  const hs = tris.flatMap((t) => [t.a, t.b, t.c]).map((p) => p.dot(d)), hm = (Math.min(...hs) + Math.max(...hs)) / 2;
  o.addScaledVector(d, hm);
  return { o, d, r };
}
function fitSphere(V: THREE.Vector3[]): { c: THREE.Vector3; r: number } | null {
  if (V.length < 4) return null;
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], b = [0, 0, 0, 0];
  for (const p of V) { const row = [2 * p.x, 2 * p.y, 2 * p.z, 1], z = p.lengthSq(); for (let i = 0; i < 4; i++) { b[i] += row[i] * z; for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j]; } }
  const s = solveN(A, b); if (!s) return null;
  const c = new THREE.Vector3(s[0], s[1], s[2]), r = Math.sqrt(Math.max(0, s[3] + c.lengthSq()));
  return r > 1e-6 ? { c, r } : null;
}
function solve3(A: number[][], b: number[]) { return solveN(A.map((r) => [...r]), [...b]); }
function solveN(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null; [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function minEig(M: number[][]): THREE.Vector3 | null {
  // iteración inversa con desplazamiento pequeño
  const A = M.map((r, i) => r.map((x, j) => x + (i === j ? 1e-9 : 0)));
  let x = [0.577, 0.577, 0.577];
  for (let it = 0; it < 60; it++) { const y = solveN(A, x); if (!y) return null; const l = Math.hypot(...y); x = y.map((t) => t / l); }
  return new THREE.Vector3(x[0], x[1], x[2]).normalize();
}

// ---------- Primitivas para distancias ----------
interface Prims { P: THREE.Vector3[]; S: THREE.Line3[]; T: THREE.Triangle[] }
function prims(e: MEnt): Prims {
  if (e.kind === 'vertex') return { P: [v(e.p!)], S: [], T: [] };
  if (e.kind === 'edge') { const s = e.seg!, S: THREE.Line3[] = []; for (let i = 0; i + 5 < s.length; i += 6) S.push(new THREE.Line3(v(s, i), v(s, i + 3))); return { P: S.flatMap((l) => [l.start, l.end]), S, T: [] }; }
  const g = faceGeom(e), S: THREE.Line3[] = [];
  for (const lp of g.loops) for (let i = 0; i + 1 < lp.pts.length; i++) S.push(new THREE.Line3(lp.pts[i], lp.pts[i + 1]));
  return { P: g.tris.flatMap((t) => [t.a, t.b, t.c]), S, T: g.tris };
}
function segSeg(a: THREE.Line3, b: THREE.Line3): [THREE.Vector3, THREE.Vector3] {
  // Ericson, Real-Time Collision Detection 5.1.9
  const d1 = a.delta(new THREE.Vector3()), d2 = b.delta(new THREE.Vector3()), r = a.start.clone().sub(b.start);
  const A = d1.dot(d1), E = d2.dot(d2), F = d2.dot(r); let s = 0, t = 0;
  if (A <= 1e-12 && E <= 1e-12) return [a.start.clone(), b.start.clone()];
  if (A <= 1e-12) t = THREE.MathUtils.clamp(F / E, 0, 1);
  else { const C = d1.dot(r); if (E <= 1e-12) s = THREE.MathUtils.clamp(-C / A, 0, 1); else { const B = d1.dot(d2), den = A * E - B * B; s = den > 1e-12 ? THREE.MathUtils.clamp((B * F - C * E) / den, 0, 1) : 0; t = (B * s + F) / E; if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-C / A, 0, 1); } else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((B - C) / A, 0, 1); } } }
  return [a.start.clone().addScaledVector(d1, s), b.start.clone().addScaledVector(d2, t)];
}
function minDist(A: Prims, B: Prims): { d: number; a: THREE.Vector3; b: THREE.Vector3 } {
  let best = { d: Infinity, a: new THREE.Vector3(), b: new THREE.Vector3() };
  const q = new THREE.Vector3();
  const tryPair = (a: THREE.Vector3, b: THREE.Vector3) => { const d = a.distanceTo(b); if (d < best.d) best = { d, a: a.clone(), b: b.clone() }; };
  const one = (X: Prims, Y: Prims, swap: boolean) => {
    for (const p of X.P) {
      for (const t of Y.T) { t.closestPointToPoint(p, q); swap ? tryPair(q, p) : tryPair(p, q); }
      for (const s of Y.S) { s.closestPointToPoint(p, true, q); swap ? tryPair(q, p) : tryPair(p, q); }
      for (const p2 of Y.P) if (!Y.T.length && !Y.S.length) swap ? tryPair(p2, p) : tryPair(p, p2);
    }
  };
  one(A, B, false); one(B, A, true);
  for (const s of A.S) for (const t of B.S) { const [a, b] = segSeg(s, t); tryPair(a, b); }
  return best;
}
function maxDist(A: Prims, B: Prims) {
  let best = { d: -1, a: new THREE.Vector3(), b: new THREE.Vector3() };
  for (const a of A.P) for (const b of B.P) { const d = a.distanceTo(b); if (d > best.d) best = { d, a, b }; }
  return best;
}
/** Centro de la entidad: vértice, centro de circunferencia, punto medio de arista, eje de cilindro o centroide */
function centerOf(e: MEnt): THREE.Vector3 {
  if (e.kind === 'vertex') return v(e.p!);
  if (e.kind === 'edge') { const g = edgeGeom(e); if (g.circle) return g.circle.c; if (g.line) return g.line.a.clone().add(g.line.b).multiplyScalar(0.5); return g.pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / g.pts.length); }
  const f = faceGeom(e); return f.cyl ? f.cyl.o : f.sphere ? f.sphere.c : f.centroid;
}
/** Dirección característica: recta (arista recta, eje) o normal (cara plana) */
function dirOf(e: MEnt): { d: THREE.Vector3; kind: 'line' | 'normal' } | null {
  if (e.kind === 'edge') { const g = edgeGeom(e); if (g.line) return { d: g.line.d, kind: 'line' }; if (g.circle) return { d: g.circle.n, kind: 'normal' }; return null; }
  if (e.kind === 'face') { const f = faceGeom(e); if (f.plane) return { d: f.plane.n, kind: 'normal' }; if (f.cyl) return { d: f.cyl.d, kind: 'line' }; }
  return null;
}

// ---------- Resultado ----------
export interface MRes { rows: [string, string][]; line?: [THREE.Vector3, THREE.Vector3]; arc?: { c: THREE.Vector3; a: THREE.Vector3; b: THREE.Vector3 }; copy: string }
const deg = (r: number) => (r * 180) / Math.PI;
export function measureCompute(sel: MEnt[], dist: MDist, prec: number, loop = false): MRes {
  const f = (x: number, p = prec) => x.toLocaleString('es-ES', { minimumFractionDigits: p, maximumFractionDigits: p });
  const mm = (x: number) => `${f(x)} mm`, mm2 = (x: number) => `${f(x)} mm²`, dg = (x: number) => `${f(x, Math.min(prec, 4))}°`;
  const P = (p: THREE.Vector3) => `${f(p.x)}; ${f(p.y)}; ${f(p.z)}`;
  const rows: [string, string][] = []; const res: MRes = { rows, copy: '' };
  const one = (e: MEnt, pre = '') => {
    if (e.kind === 'vertex') { const p = v(e.p!); rows.push([pre + 'X', mm(p.x)], [pre + 'Y', mm(p.y)], [pre + 'Z', mm(p.z)]); return; }
    if (e.kind === 'edge') {
      const g = edgeGeom(e); rows.push([pre + 'Longitud', mm(g.L)]);
      if (g.circle) { rows.push([pre + 'Radio', mm(g.circle.r)], [pre + 'Diámetro', mm(2 * g.circle.r)], [pre + 'Centro', P(g.circle.c)]); if (!g.closed) rows.push([pre + 'Ángulo de arco', dg(deg(g.circle.ang))]); }
      else if (g.line) { const d = g.line.b.clone().sub(g.line.a); rows.push([pre + 'ΔX', mm(Math.abs(d.x))], [pre + 'ΔY', mm(Math.abs(d.y))], [pre + 'ΔZ', mm(Math.abs(d.z))]); }
      return;
    }
    const g = faceGeom(e);
    if (loop) { g.loops.forEach((l, i) => rows.push([pre + (i === 0 ? 'Bucle exterior' : `Bucle interior ${i}`), mm(l.L)])); rows.push([pre + 'Longitud total de bucles', mm(g.P)]); return; }
    rows.push([pre + 'Área', mm2(g.A)], [pre + 'Perímetro', mm(g.P)]);
    if (g.loops.length > 1) rows.push([pre + 'Bucles', `${g.loops.length} (exterior ${mm(g.loops[0].L)})`]);
    if (g.cyl) rows.push([pre + 'Radio', mm(g.cyl.r)], [pre + 'Diámetro', mm(2 * g.cyl.r)]);
    if (g.sphere) rows.push([pre + 'Radio', mm(g.sphere.r)], [pre + 'Centro', P(g.sphere.c)]);
    if (g.plane) rows.push([pre + 'Normal', `${f(g.plane.n.x, 4)}; ${f(g.plane.n.y, 4)}; ${f(g.plane.n.z, 4)}`]);
    rows.push([pre + 'Centroide', P(g.centroid)]);
  };
  if (sel.length === 1) one(sel[0]);
  else if (sel.length === 3 && sel.every((e) => e.kind === 'vertex')) {
    const [a, b, c] = sel.map((e) => v(e.p!)), u = a.clone().sub(b), w = c.clone().sub(b);
    rows.push(['Ángulo (vértice 2)', dg(deg(u.angleTo(w)))]); res.arc = { c: b, a, b: c };
  } else if (sel.length >= 2) {
    const [A, B] = sel;
    let r: { d: number; a: THREE.Vector3; b: THREE.Vector3 };
    if (dist === 'center') { const a = centerOf(A), b = centerOf(B); r = { d: a.distanceTo(b), a, b }; }
    else if (dist === 'max') r = maxDist(prims(A), prims(B));
    else r = minDist(prims(A), prims(B));
    const dv = r.b.clone().sub(r.a);
    rows.push([dist === 'center' ? 'Distancia centro a centro' : dist === 'max' ? 'Distancia máxima' : 'Distancia mínima', mm(r.d)], ['ΔX', mm(Math.abs(dv.x))], ['ΔY', mm(Math.abs(dv.y))], ['ΔZ', mm(Math.abs(dv.z))]);
    res.line = [r.a, r.b];
    const da = dirOf(A), db = dirOf(B);
    if (da && db) {
      const c = Math.abs(da.d.dot(db.d)), th = deg(Math.acos(Math.min(1, c)));
      if (da.kind === db.kind) {
        rows.push(['Ángulo', dg(th)]);
        if (da.kind === 'normal' && A.kind === 'face' && B.kind === 'face') {
          rows.push(['Ángulo entre normales', dg(deg(Math.acos(THREE.MathUtils.clamp(da.d.dot(db.d), -1, 1))))]);
          if (c > 1 - 1e-6) rows.push(['Distancia entre planos', mm(Math.abs(centerOf(B).clone().sub(centerOf(A)).dot(da.d)))]);
        }
        if (da.kind === 'line' && c > 1 - 1e-6 && (A.kind === 'face' || B.kind === 'face' || dist === 'center')) {
          const pa = centerOf(A), pb = centerOf(B), w = pb.clone().sub(pa); rows.push(['Distancia entre ejes', mm(w.sub(da.d.clone().multiplyScalar(w.dot(da.d))).length())]);
        }
      } else rows.push(['Ángulo', dg(90 - th)]);
    }
    if (sel.length === 2) { rows.push(['—', '—']); one(A, '1 · '); one(B, '2 · '); }
  }
  res.copy = rows.filter((r) => r[0] !== '—').map((r) => `${r[0]}: ${r[1]}`).join('\n');
  return res;
}

// ---------- Superposición en el visor ----------
export function measureOverlay(sel: MEnt[], res: MRes | null, seg: (pts: number[], color: string, width: number) => THREE.Object3D, color: string, color2: string): THREE.Group {
  const g = new THREE.Group(); g.name = '__measure';
  sel.forEach((e, i) => {
    const c = i === 0 ? color : color2;
    if (e.kind === 'edge') g.add(seg(e.seg!, c, 4));
    if (e.kind === 'face') {
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(e.tri!, 3));
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35, depthTest: false, side: THREE.DoubleSide }));
      m.renderOrder = 8; m.raycast = () => {}; g.add(m);
    }
    if (e.kind === 'vertex' || e.kind === 'face' || e.kind === 'edge') {
      const p = e.kind === 'vertex' ? e.p! : null;
      if (p) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: c, size: 10, sizeAttenuation: false, depthTest: false })); pts.renderOrder = 10; pts.raycast = () => {}; g.add(pts); }
    }
  });
  if (res?.line && res.line[0].distanceTo(res.line[1]) > 1e-9) {
    const [a, b] = res.line; g.add(seg([a.x, a.y, a.z, b.x, b.y, b.z], '#e8b100', 2.5));
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z], 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#e8b100', size: 8, sizeAttenuation: false, depthTest: false })); pts.renderOrder = 10; pts.raycast = () => {}; g.add(pts);
  }
  if (res?.arc) { const { c, a, b } = res.arc; g.add(seg([c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z], '#e8b100', 2)); }
  return g;
}

/** Añade una entidad a la selección (máx. 2; 3 si son vértices para medir ángulos) */
export function measureAdd(e: MEnt) {
  const s = useMeasure.getState();
  const max = s.sel.length >= 2 && s.sel.every((x) => x.kind === 'vertex') && e.kind === 'vertex' ? 3 : 2;
  const sel = s.sel.length >= max ? [e] : [...s.sel, e];
  useMeasure.setState({ sel });
}
