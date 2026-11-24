// ePoints asociativos: los creados en el centro de una cara plana o en el extremo de una cara cilíndrica
// se recolocan solos cuando cambia la pieza (p. ej. al cambiar la longitud de un conducto).
import type { MeshData } from './cadClient';
import type { PartDoc, V3 } from './doc';
import type { EPoint } from './epoints';

export interface EpAnchor { mode: 'facec' | 'cyl'; /** normal de la cara o eje del cilindro (sentido del ePoint) */ n: V3 }

type G = { planar: boolean; n: V3; c: V3; area: number; verts: V3[] };
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

function groups(m: MeshData): G[] {
  const out: G[] = [];
  const V = (i: number): V3 => [m.vertices[i * 3], m.vertices[i * 3 + 1], m.vertices[i * 3 + 2]];
  for (const g of m.faceGroups) {
    let area = 0; const c: V3 = [0, 0, 0], ns: V3 = [0, 0, 0]; let planar = true, n0: V3 | null = null; const verts: V3[] = [];
    for (let i = g.start; i + 2 < g.start + g.count; i += 3) {
      const a = V(m.triangles[i]), b = V(m.triangles[i + 1]), d = V(m.triangles[i + 2]);
      verts.push(a, b, d);
      const cr = cross(sub(b, a), sub(d, a)), ar = len(cr) / 2; if (ar < 1e-12) continue;
      const n = nrm(cr); if (!n0) n0 = n; else if (dot(n, n0) < 1 - 1e-5) planar = false;
      area += ar; for (let k = 0; k < 3; k++) { c[k] += ((a[k] + b[k] + d[k]) / 3) * ar; ns[k] += n[k] * ar; }
    }
    if (area <= 0) { out.push({ planar: false, n: [0, 0, 1], c: [0, 0, 0], area: 0, verts }); continue; }
    out.push({ planar, n: nrm(ns), c: [c[0] / area, c[1] / area, c[2] / area], area, verts });
  }
  return out;
}

/** Recoloca los ePoints con anclaje según la malla actual de la pieza. Devuelve null si no cambia nada. */
export function updateAnchors(doc: PartDoc, mesh: MeshData | null | undefined): EPoint[] | null {
  const eps = doc.epoints; if (!mesh || !eps?.some((e) => e.anchor || (e.kind === 'mate' && !e.tpl && !e.isDefault))) return null;
  const G = groups(mesh);
  const bb = mesh.vertices.length ? (() => { let mn = Infinity, mx = -Infinity; for (const v of mesh.vertices) { mn = Math.min(mn, v); mx = Math.max(mx, v); } return mx - mn; })() : 1000;
  const tol = Math.max(1, bb * 0.05);
  let changed = false;
  const out = eps.map((e0) => {
    let e = e0;
    if (e.tpl || e.isDefault || e.kind === 'composite') return e;
    let A = e.anchor;
    if (!A && e.kind === 'mate') {
      // ePoints antiguos sin anclaje: si está en el centro de una cara con su misma normal se ancla; si esa cara se
      // ha desplazado a lo largo de la normal (p. ej. cambió la longitud) y es la única candidata, se recoloca
      const dn = nrm(e.dir);
      const cand = G.filter((g) => g.planar && dot(g.n, dn) > 0.9999).map((g) => { const D = sub(g.c, e.point), off = dot(D, dn); return { g, off, inPl: len(sub(D, [dn[0] * off, dn[1] * off, dn[2] * off])) }; }).filter((x) => x.inPl < 0.05);
      const onCentre = cand.some((x) => Math.abs(x.off) < 0.01);
      if (onCentre || cand.length === 1) { A = { mode: 'facec', n: dn }; changed = true; e = { ...e, anchor: A }; }
    }
    if (!A) return e;
    let np: V3 | null = null;
    if (A.mode === 'facec') {
      let best: { d: number; off: number; c: V3 } | null = null;
      for (const g of G) {
        if (!g.planar || dot(g.n, A.n) < 0.9999) continue;
        const D = sub(g.c, e.point), off = dot(D, A.n), inPl = len(sub(D, [A.n[0] * off, A.n[1] * off, A.n[2] * off]));
        if (inPl > tol) continue;
        if (!best || inPl < best.d - 1e-3 || (Math.abs(inPl - best.d) <= 1e-3 && Math.abs(off) < Math.abs(best.off))) best = { d: inPl, off, c: g.c };
      }
      if (best) np = best.c;
    } else {
      // extremo de cara cilíndrica: eje paralelo que pasa cerca del punto anterior; extremo en el sentido del ePoint
      const ax = nrm(A.n);
      let best: { d: number; p: V3 } | null = null;
      for (const g of G) {
        if (g.planar || g.verts.length < 6) continue;
        // ¿todas las normales ⟂ al eje? (comprobación aproximada por los vértices: distancia al eje constante)
        const proj = (v: V3) => { const t = dot(v, ax); return [sub(v, [ax[0] * t, ax[1] * t, ax[2] * t]), t] as const; };
        const pe = proj(e.point)[0];
        const ds = g.verts.map((v) => len(sub(proj(v)[0], pe)));
        const r0 = ds[0]; if (!g.verts.every((_, i) => Math.abs(ds[i] - r0) < Math.max(0.01, r0 * 0.01))) continue;
        if (Math.abs(r0 - (e.radius ?? r0)) > Math.max(0.05, r0 * 0.02)) continue;
        const ts = g.verts.map((v) => dot(v, ax)), tEnd = Math.max(...ts);
        const p: V3 = [pe[0] + ax[0] * tEnd, pe[1] + ax[1] * tEnd, pe[2] + ax[2] * tEnd];
        const d = Math.abs(tEnd - dot(e.point, ax));
        if (!best || d < best.d) best = { d, p };
      }
      if (best) np = best.p;
    }
    if (!np) return e;
    const p: V3 = [r4(np[0]), r4(np[1]), r4(np[2])];
    if (Math.abs(p[0] - e.point[0]) + Math.abs(p[1] - e.point[1]) + Math.abs(p[2] - e.point[2]) < 1e-3) return e;
    changed = true; return { ...e, point: p };
  });
  return changed ? out : null;
}
