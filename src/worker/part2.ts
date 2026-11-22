// Operaciones de modelado avanzadas: edición directa, eliminar cara, desenrollar, superficies regladas,
// recorte/alargamiento de superficies, esculpir, sustituir cara, reparar, forma libre y simplificar.
import {
  getOC, cast, FaceFinder, EdgeFinder, makeSolid, measureShapeVolumeProperties, compoundShapes, Vector, makeCylinder, makeBox, makePolygon,
  type Shape3D,
} from 'replicad';
import { v3, type V3, type V2 } from '../core/doc';

const oc = () => getOC() as any;
const S3 = (x: unknown) => cast(x as any) as unknown as Shape3D;
const P = (v: any): V3 => (Array.isArray(v) ? [v[0], v[1], v[2]] : [v.x, v.y, v.z]);
const gpP = (p: V3) => new (oc().gp_Pnt)(p[0], p[1], p[2]);
const volOf = (s: Shape3D) => { try { return Math.abs(measureShapeVolumeProperties(s).volume); } catch { return 0; } };

/** punto en el interior de una cara (centro de su dominio UV) */
function midPoint(f: any): V3 { const b = f.UVBounds; return P(f.pointOnSurface((b.uMin + b.uMax) / 2, (b.vMin + b.vMax) / 2)); }
export function facesAt(shape: Shape3D, p: V3): any[] { return new FaceFinder().containsPoint(p).find(shape) as any[]; }
export function faceAt(shape: Shape3D, p: V3): any {
  const f = facesAt(shape, p)[0];
  if (!f) throw new Error('Cara no encontrada (¿ha cambiado la pieza?)');
  return f;
}
function prism(sh: any, vec: V3): Shape3D {
  const v = new Vector(vec);
  const mk = new (oc().BRepPrimAPI_MakePrism)(sh.wrapped, v.wrapped, false, true);
  const r = S3(mk.Shape()); mk.delete(); v.delete();
  return r;
}
/** Cose caras/cuerpos; si cierran volumen devuelve un sólido */
export function sew(shapes: any[], tol = 1e-3): { shape: Shape3D; solid: boolean } {
  const sw = new (oc().BRepBuilderAPI_Sewing)(tol, true, true, true, false);
  for (const x of shapes) sw.Add(x.wrapped);
  sw.Perform(new (oc().Message_ProgressRange)());
  const res = S3(sw.SewedShape()); sw.delete();
  try {
    const sol = makeSolid([res as any]) as unknown as Shape3D;
    const vol = measureShapeVolumeProperties(sol).volume;
    if (Math.abs(vol) > 1e-6) return { shape: vol < 0 ? S3((sol as any).wrapped.Reversed()) : sol, solid: true };
  } catch { /* abierta */ }
  return { shape: res, solid: false };
}
/** booleana genérica (también para caras y superficies) */
export function boolOp(a: Shape3D, b: Shape3D, op: 'cut' | 'common'): Shape3D {
  const mk = op === 'cut' ? new (oc().BRepAlgoAPI_Cut)((a as any).wrapped, (b as any).wrapped, new (oc().Message_ProgressRange)()) : new (oc().BRepAlgoAPI_Common)((a as any).wrapped, (b as any).wrapped, new (oc().Message_ProgressRange)());
  const r = S3(mk.Shape()); mk.delete();
  return r;
}
const tidy = (s: Shape3D) => { try { return (s as any).simplify() as Shape3D; } catch { return s; } };

// ---------- Edición directa: empujar / tirar de caras planas ----------
export function pushPull(shape: Shape3D, pts: V3[], d: number): Shape3D {
  if (!pts.length) throw new Error('Selecciona caras planas');
  if (Math.abs(d) < 1e-9) return shape;
  let res = shape;
  for (const p of pts) {
    const f = faceAt(res, p);
    if (f.geomType !== 'PLANE') throw new Error('Edición directa: solo caras planas');
    const n = v3.norm(P(f.normalAt(p)));
    const tool = prism(f, v3.mul(n, d));
    res = d > 0 ? res.fuse(tool) : res.cut(tool);
  }
  return tidy(res);
}

// ---------- Eliminar cara ----------
function cylInfo(f: any) {
  const ad = f._geomAdaptor(); const cy = ad.Cylinder(); const ax = cy.Axis();
  const o: V3 = [ax.Location().X(), ax.Location().Y(), ax.Location().Z()], d: V3 = v3.norm([ax.Direction().X(), ax.Direction().Y(), ax.Direction().Z()]);
  return { o, d, r: cy.Radius() as number };
}
/** extensión a lo largo de un eje de los puntos de las aristas de una cara */
function extentAlong(f: any, o: V3, d: V3): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const e of f.edges as any[]) for (let i = 0; i <= 8; i++) { const q = P(e.pointAt(i / 8)); const t = v3.dot(v3.sub(q, o), d); lo = Math.min(lo, t); hi = Math.max(hi, t); }
  return [lo, hi];
}
export function deleteFaces(shape: Shape3D, pts: V3[], heal: boolean): { solid: Shape3D | null; surface: Shape3D | null } {
  if (!pts.length) throw new Error('Selecciona caras');
  if (!heal) {
    const sel = pts.map((p) => faceAt(shape, p));
    const rest = ((shape as any).faces as any[]).filter((f) => !sel.some((x) => x.isSame(f)));
    if (!rest.length) throw new Error('No quedan caras');
    return { solid: null, surface: sew(rest).shape };
  }
  let res = shape;
  for (const p of pts) {
    const f = faceAt(res, p);
    if (f.geomType === 'CYLINDRE') {
      const { o, d, r } = cylInfo(f);
      const n = v3.norm(P(f.normalAt(p))), radial = v3.sub(p, v3.add(o, v3.mul(d, v3.dot(v3.sub(p, o), d))));
      if (v3.dot(n, radial) < 0) {
        // cara cóncava (taladro): se rellena con un cilindro del mismo radio y extensión
        const [lo, hi] = extentAlong(f, o, d);
        const c = makeCylinder(r, hi - lo + 1e-3, v3.add(o, v3.mul(d, lo - 5e-4)), d) as unknown as Shape3D;
        res = tidy(res.fuse(c));
        continue;
      }
    }
    // cualquier otra cara: se quita y el hueco se cierra con una superficie de relleno apoyada en su contorno
    const all = (res as any).faces as any[];
    const rest = all.filter((x) => !x.isSame(f));
    const mk = new (oc().BRepOffsetAPI_MakeFilling)();
    for (const e of f.outerWire().edges as any[]) mk.Add(e.wrapped, oc().GeomAbs_Shape.GeomAbs_C0, true);
    mk.Build(new (oc().Message_ProgressRange)());
    if (!mk.IsDone()) { mk.delete(); throw new Error('No se puede cerrar el hueco de la cara'); }
    const patch = S3(mk.Shape()); mk.delete();
    const r = sew([...rest, patch], 1e-2);
    if (!r.solid) throw new Error('Al eliminar la cara el cuerpo queda abierto');
    res = tidy(r.shape);
  }
  return { solid: res, surface: null };
}

/** Cadenas cerradas a partir de polilíneas de aristas (se unen por extremos cercanos) */
function chainLoops(polys: V3[][], tol: number): V3[][] {
  const left = polys.filter((q) => q.length > 1).map((q) => [...q]), loops: V3[][] = [];
  const near = (a: V3, b: V3) => v3.len(v3.sub(a, b)) <= tol;
  while (left.length) {
    let cur = left.shift()!;
    for (let guard = 0; guard < 500 && !near(cur[0], cur[cur.length - 1]); guard++) {
      const end = cur[cur.length - 1];
      const i = left.findIndex((q) => near(q[0], end) || near(q[q.length - 1], end)); if (i < 0) break;
      const q = left.splice(i, 1)[0]; cur = cur.concat(near(q[0], end) ? q.slice(1) : [...q].reverse().slice(1));
    }
    if (near(cur[0], cur[cur.length - 1]) && cur.length > 3) loops.push(cur.slice(0, -1));
  }
  return loops;
}
const sampleEdge = (e: any): V3[] => { const n = Math.max(4, Math.min(160, Math.ceil(e.length / 1.5))); const out: V3[] = []; for (let i = 0; i <= n; i++) out.push(P(e.pointAt(i / n))); return out; };
const area2 = (l: V2[]) => { let a = 0; for (let i = 0; i < l.length; i++) { const p = l[i], q = l[(i + 1) % l.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };

// ---------- Desenrollar ----------
export function unwrapFace(shape: Shape3D, p: V3): Shape3D {
  const f = faceAt(shape, p);
  const edges = (f.edges as any[]).map(sampleEdge);
  const bb = shape.boundingBox.bounds, tol = Math.max(1e-4, v3.len(v3.sub(P(bb[1]), P(bb[0]))) * 1e-5);
  const n0 = v3.norm(P(f.normalAt(p)));
  if (f.geomType === 'PLANE') {
    let x = v3.cross([0, 0, 1], n0); if (v3.len(x) < 1e-6) x = [1, 0, 0]; x = v3.norm(x);
    const y = v3.cross(n0, x), to2 = (q: V3): V2 => [v3.dot(v3.sub(q, p), x), v3.dot(v3.sub(q, p), y)];
    const loops = chainLoops(edges, tol * 50).map((l) => l.map(to2)).sort((a2, b2) => area2(b2) - area2(a2));
    if (!loops.length) throw new Error('No se puede recorrer el contorno de la cara');
    return planarFrom(loops, { o: p, x, y });
  }
  let dev: (q: V3, prev: number | null) => [V2, number], frame: { o: V3; x: V3; y: V3 };
  if (f.geomType === 'CYLINDRE') {
    const { o, d, r } = cylInfo(f);
    const e1 = v3.norm(v3.sub(p, v3.add(o, v3.mul(d, v3.dot(v3.sub(p, o), d))))), e2 = v3.cross(d, e1), h0 = v3.dot(v3.sub(p, o), d);
    dev = (q, prev) => { const w = v3.sub(q, o); let a = Math.atan2(v3.dot(w, e2), v3.dot(w, e1)); if (prev !== null) { while (a - prev > Math.PI) a -= 2 * Math.PI; while (a - prev < -Math.PI) a += 2 * Math.PI; } return [[a * r, v3.dot(w, d) - h0], a]; };
    const pOn = v3.add(o, v3.add(v3.mul(d, h0), v3.mul(e1, r)));
    frame = { o: v3.add(pOn, v3.mul(e1, 0.01)), x: e2, y: d };
  } else if (f.geomType === 'CONE') {
    const cn = f._geomAdaptor().Cone(), A = cn.Apex(), ax = cn.Axis();
    const apex: V3 = [A.X(), A.Y(), A.Z()], d = v3.norm([ax.Direction().X(), ax.Direction().Y(), ax.Direction().Z()]), sa = Math.abs(cn.SemiAngle());
    const e1 = v3.norm(v3.sub(p, v3.add(apex, v3.mul(d, v3.dot(v3.sub(p, apex), d))))), e2 = v3.cross(d, e1);
    dev = (q, prev) => { const w = v3.sub(q, apex); let a = Math.atan2(v3.dot(w, e2), v3.dot(w, e1)); if (prev !== null) { while (a - prev > Math.PI) a -= 2 * Math.PI; while (a - prev < -Math.PI) a += 2 * Math.PI; } const sd = v3.len(w), phi = a * Math.sin(sa); return [[sd * Math.sin(phi), sd * Math.cos(phi)], a]; };
    const gen = v3.norm(v3.sub(p, apex));
    frame = { o: apex, x: v3.norm(v3.cross(gen, v3.cross(e2, gen))) , y: gen };
    frame.x = e2;
  } else throw new Error('Desenrollar: solo caras planas, cilíndricas o cónicas');
  // contorno exterior: borde del dominio UV de la cara; interiores: aristas que no están en ese borde
  const b = f.UVBounds, N = 64, outer3: V3[] = [];
  const at = (u: number, v: number) => P(f.pointOnSurface(u, v));
  for (let i = 0; i < N; i++) outer3.push(at(b.uMin + ((b.uMax - b.uMin) * i) / N, b.vMin));
  for (let i = 0; i < N; i++) outer3.push(at(b.uMax, b.vMin + ((b.vMax - b.vMin) * i) / N));
  for (let i = 0; i < N; i++) outer3.push(at(b.uMax - ((b.uMax - b.uMin) * i) / N, b.vMax));
  for (let i = 0; i < N; i++) outer3.push(at(b.uMin, b.vMax - ((b.vMax - b.vMin) * i) / N));
  const devLoop = (l: V3[]) => { let prev: number | null = null; return l.map((q) => { const [xy, a] = dev(q, prev); prev = a; return xy; }); };
  const onB = (q: V3) => { try { const [u, v] = f.uvCoordinates(q); const du = (b.uMax - b.uMin) * 1e-3, dv = (b.vMax - b.vMin) * 1e-3; return Math.abs(u - b.uMin) < du || Math.abs(u - b.uMax) < du || Math.abs(v - b.vMin) < dv || Math.abs(v - b.vMax) < dv; } catch { return true; } };
  const inner = chainLoops(edges.filter((l) => !l.every(onB)), tol * 50);
  return planarFrom([devLoop(outer3), ...inner.map(devLoop)], frame);
}
function planarFrom(loops: V2[][], fr: { o: V3; x: V3; y: V3 }): Shape3D {
  const w3 = (l: V2[]) => l.map((q) => v3.add(fr.o, v3.add(v3.mul(fr.x, q[0]), v3.mul(fr.y, q[1]))));
  let face = makePolygon(w3(loops[0]) as any) as unknown as Shape3D;
  for (const l of loops.slice(1)) { try { face = face.cut(makePolygon(w3(l) as any) as unknown as Shape3D); } catch { /* contorno interior no válido */ } }
  return face;
}

// ---------- Superficie reglada ----------
export function ruledSurface(shape: Shape3D, pts: V3[], mode: 'normal' | 'tangent' | 'vector', dist: number, dirv: V3, flip: boolean): Shape3D {
  if (!pts.length) throw new Error('Selecciona aristas');
  const out: Shape3D[] = [];
  for (const p of pts) {
    const e = (new EdgeFinder().containsPoint(p).find(shape) as any[])[0];
    if (!e) throw new Error('Arista no encontrada');
    let dir: V3;
    if (mode === 'vector') { dir = v3.norm(dirv); if (!isFinite(dir[0])) throw new Error('Vector no válido'); }
    else {
      const fs = (facesAt(shape, p)).filter((f) => f.geomType === 'PLANE');
      if (!fs.length) throw new Error('La arista necesita una cara plana adyacente');
      const f = fs[0], n = v3.norm(P(f.normalAt(p)));
      if (mode === 'normal') dir = n;
      else { const t = v3.norm(P(e.tangentAt(0.5))); dir = v3.norm(v3.cross(n, t)); if (v3.dot(dir, v3.sub(p, P(f.center))) < 0) dir = v3.mul(dir, -1); }
    }
    if (flip) dir = v3.mul(dir, -1);
    out.push(prism(e, v3.mul(dir, dist)));
  }
  return out.length === 1 ? out[0] : (compoundShapes(out) as unknown as Shape3D);
}

// ---------- Alargar superficie plana ----------
export function extendPlanar(surf: Shape3D, d: number): Shape3D {
  const faces = (surf as any).faces as any[];
  const out: Shape3D[] = [];
  for (const f of faces) {
    if (f.geomType !== 'PLANE') throw new Error('Alargar: solo superficies planas');
    const mk = new (oc().BRepOffsetAPI_MakeOffset)(f.wrapped, oc().GeomAbs_JoinType.GeomAbs_Intersection, false);
    mk.Perform(d, 0);
    if (!mk.IsDone()) { mk.delete(); throw new Error('No se puede alargar el contorno'); }
    const wire = mk.Shape(); mk.delete();
    const w = oc().TopoDS.Wire(wire);
    const mf = new (oc().BRepBuilderAPI_MakeFace)(w, true);
    out.push(S3(mf.Face())); mf.delete();
  }
  return out.length === 1 ? out[0] : (compoundShapes(out) as unknown as Shape3D);
}

// ---------- Esculpir / sustituir cara ----------
function split(arg: Shape3D, tools: Shape3D[]): Shape3D[] {
  const A = new (oc().NCollection_List_TopoDS_Shape)(); A.Append((arg as any).wrapped);
  const T = new (oc().NCollection_List_TopoDS_Shape)(); for (const t of tools) T.Append((t as any).wrapped);
  const sp = new (oc().BRepAlgoAPI_Splitter)();
  sp.SetArguments(A); sp.SetTools(T); sp.Build(new (oc().Message_ProgressRange)());
  if (sp.HasErrors()) { sp.delete(); throw new Error('No se puede dividir con las superficies'); }
  const r = S3(sp.Shape()); sp.delete();
  return ((r as any).solids ?? [r]) as Shape3D[];
}
/** semiespacio del lado de la normal de la superficie (o el contrario) */
function halfSpace(surf: Shape3D, normalSide: boolean): Shape3D {
  const f = ((surf as any).faces as any[])[0]; if (!f) throw new Error('Superficie vacía');
  const c = midPoint(f), n = v3.norm(P(f.normalAt(c)));
  const ref = v3.add(c, v3.mul(n, normalSide ? 1 : -1));
  const many = (surf as any).faces.length > 1;
  const mk = many ? new (oc().BRepPrimAPI_MakeHalfSpace)(oc().TopoDS.Shell((sew((surf as any).faces).shape as any).wrapped), gpP(ref)) : new (oc().BRepPrimAPI_MakeHalfSpace)(oc().TopoDS.Face(f.wrapped), gpP(ref));
  const sol = S3(mk.Solid()); mk.delete();
  return sol;
}
const bboxOf = (s: Shape3D) => { const b = s.boundingBox.bounds; return [P(b[0]), P(b[1])] as [V3, V3]; };
/** Celdas cerradas entre superficies y el sólido (fuera del sólido) */
function enclosedCells(shape: Shape3D | null, surfs: Shape3D[]): Shape3D[] {
  const parts = [...(shape ? [shape] : []), ...surfs];
  let lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const x of parts) { const [a, b] = bboxOf(x); lo = [Math.min(lo[0], a[0]), Math.min(lo[1], a[1]), Math.min(lo[2], a[2])]; hi = [Math.max(hi[0], b[0]), Math.max(hi[1], b[1]), Math.max(hi[2], b[2])]; }
  const m = Math.max(1, v3.len(v3.sub(hi, lo)) * 0.05);
  const L: V3 = v3.sub(lo, [m, m, m]), H: V3 = v3.add(hi, [m, m, m]);
  const box = makeBox(L, H) as unknown as Shape3D;
  const tools = [...surfs, ...(shape ? ((shape as any).faces as any[]).map((f) => S3(f.wrapped)) : [])];
  const cells = split(box, tools);
  const eps = m * 0.25;
  return cells.filter((c) => {
    const [a, b] = bboxOf(c);
    if (a[0] < L[0] + eps || a[1] < L[1] + eps || a[2] < L[2] + eps || b[0] > H[0] - eps || b[1] > H[1] - eps || b[2] > H[2] - eps) return false;  // toca la caja: no está cerrada
    if (shape) { try { const iv = volOf(c.clone().intersect(shape.clone()) as Shape3D); if (iv > volOf(c) * 0.5) return false; } catch { /* */ } }
    return volOf(c) > 1e-6;
  });
}
export function sculpt(shape: Shape3D | null, surfs: Shape3D[], mode: 'add' | 'remove', flip: boolean): Shape3D {
  if (!surfs.length) throw new Error('Selecciona superficies');
  if (mode === 'remove') {
    if (!shape) throw new Error('No hay sólido');
    let res = shape;
    for (const s of surfs) res = res.cut(halfSpace(s, !flip));
    if (volOf(res) < 1e-6) throw new Error('Se quitaría todo el sólido (prueba «Invertir»)');
    return tidy(res);
  }
  const cells = enclosedCells(shape, surfs);
  if (!cells.length) throw new Error('Las superficies no cierran un volumen con el sólido');
  let res = shape;
  for (const c of cells) res = res ? res.fuse(c) : c;
  return tidy(res!);
}
export function replaceFace(shape: Shape3D, pts: V3[], surf: Shape3D): Shape3D {
  if (!pts.length) throw new Error('Selecciona las caras a sustituir');
  const pieces = split(shape, [surf]);
  const touches = (c: Shape3D) => pts.some((p) => facesAt(c, p).length > 0);
  if (pieces.length > 1) {
    // la superficie corta el sólido: se quita el trozo que contiene las caras elegidas
    const keep = pieces.filter((c) => !touches(c));
    if (!keep.length) throw new Error('Se quitaría todo el sólido');
    let res = keep[0]; for (const c of keep.slice(1)) res = res.fuse(c);
    return tidy(res);
  }
  // la superficie está fuera: se añade el volumen entre la cara y la superficie
  const cells = enclosedCells(shape, [surf]).filter(touches);
  if (!cells.length) throw new Error('La superficie no cierra un volumen con las caras elegidas');
  let res = shape; for (const c of cells) res = res.fuse(c);
  return tidy(res);
}

// ---------- Reparar ----------
export function repair(shape: Shape3D, tol: number): { shape: Shape3D; note: string } {
  const faces = (shape as any).faces as any[];
  const r = sew(faces, tol);
  return { shape: tidy(r.shape), note: r.solid ? `${faces.length} caras cosidas en un sólido cerrado` : `${faces.length} caras cosidas; el cuerpo sigue abierto (aumenta la tolerancia)` };
}

// ---------- Forma libre (FFD de Bernstein) ----------
const binom = (n: number, k: number) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
const bern = (n: number, i: number, t: number) => binom(n, i) * t ** i * (1 - t) ** (n - i);
function bsplineFace(grid: V3[][]): Shape3D {
  const nu = grid.length, nv = grid[0].length;
  const arr = new (oc().NCollection_Array2_gp_Pnt)(1, nu, 1, nv);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) arr.SetValue(i + 1, j + 1, gpP(grid[i][j]));
  const ap = new (oc().GeomAPI_PointsToBSplineSurface)();
  ap.Init(arr, 3, 8, oc().GeomAbs_Shape.GeomAbs_C2, 1e-3);
  if (!ap.IsDone()) throw new Error('No se puede aproximar la superficie');
  const srf = ap.Surface();
  const mf = new (oc().BRepBuilderAPI_MakeFace)(srf, 1e-6);
  const f = S3(mf.Face()); mf.delete(); ap.delete();
  return f;
}
export function ffBox(o: V3, size: V3, n: [number, number, number], pts: Record<string, [number, number, number]>, samples = 10): Shape3D {
  const [nx, ny, nz] = n.map((x) => Math.max(2, Math.min(6, Math.round(x)))) as [number, number, number];
  const cp = (i: number, j: number, k: number): V3 => { const d = pts[`${i},${j},${k}`] ?? [0, 0, 0]; return [o[0] + (size[0] * i) / (nx - 1) + d[0], o[1] + (size[1] * j) / (ny - 1) + d[1], o[2] + (size[2] * k) / (nz - 1) + d[2]]; };
  const map = (s: number, t: number, u: number): V3 => {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < nx; i++) { const bi = bern(nx - 1, i, s); if (!bi) continue; for (let j = 0; j < ny; j++) { const bj = bern(ny - 1, j, t); if (!bj) continue; for (let k = 0; k < nz; k++) { const w = bi * bj * bern(nz - 1, k, u); if (!w) continue; const q = cp(i, j, k); x += w * q[0]; y += w * q[1]; z += w * q[2]; } } }
    return [x, y, z];
  };
  const N = Math.max(4, samples);
  const g = (f: (a: number, b: number) => V3) => Array.from({ length: N + 1 }, (_, a) => Array.from({ length: N + 1 }, (_, b) => f(a / N, b / N)));
  const faces = [
    g((a, b) => map(a, b, 0)), g((a, b) => map(a, b, 1)),
    g((a, b) => map(a, 0, b)), g((a, b) => map(a, 1, b)),
    g((a, b) => map(0, a, b)), g((a, b) => map(1, a, b)),
  ].map(bsplineFace);
  const r = sew(faces, Math.max(1e-3, Math.max(...size) * 2e-4));
  if (!r.solid) throw new Error('La forma libre no cierra (reduce las deformaciones)');
  return r.shape;
}
export function ffFace(o: V3, x: V3, y: V3, nrm: V3, size: [number, number], n: [number, number], pts: Record<string, number>, samples = 14): Shape3D {
  const [nu, nv] = n.map((q) => Math.max(2, Math.min(8, Math.round(q)))) as [number, number];
  const map = (s: number, t: number): V3 => {
    let h = 0;
    for (let i = 0; i < nu; i++) { const bi = bern(nu - 1, i, s); for (let j = 0; j < nv; j++) h += bi * bern(nv - 1, j, t) * (pts[`${i},${j}`] ?? 0); }
    return v3.add(o, v3.add(v3.add(v3.mul(x, (s - 0.5) * size[0]), v3.mul(y, (t - 0.5) * size[1])), v3.mul(nrm, h)));
  };
  const N = Math.max(4, samples);
  return bsplineFace(Array.from({ length: N + 1 }, (_, a) => Array.from({ length: N + 1 }, (_, b) => map(a / N, b / N))));
}

// ---------- Simplificar ----------
export function simplifyShape(src: Shape3D, mode: 'bbox' | 'cyl' | 'holes', axis: 'X' | 'Y' | 'Z', holeMax: number): Shape3D {
  const [a, b] = bboxOf(src);
  if (mode === 'bbox') return makeBox(a, b) as unknown as Shape3D;
  if (mode === 'cyl') {
    const k = axis === 'X' ? 0 : axis === 'Y' ? 1 : 2, d: V3 = [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0];
    const c: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    // radio: distancia máxima al eje de los vértices
    let r = 0; for (const v of (src as any).vertices ?? []) { const p = P(v.center ?? v.point ?? v); const w = v3.sub(p, c); w[k] = 0; r = Math.max(r, v3.len(w)); }
    if (!r) { const w = v3.sub(b, a); w[k] = 0; r = v3.len(w) / 2; }
    const base: V3 = [...c] as V3; base[k] = a[k];
    return makeCylinder(r, b[k] - a[k], base, d) as unknown as Shape3D;
  }
  // sin taladros de diámetro ≤ holeMax
  let res = src;
  for (let pass = 0; pass < 200; pass++) {
    const f = ((res as any).faces as any[]).find((x) => {
      if (x.geomType !== 'CYLINDRE') return false;
      const { o, d, r } = cylInfo(x); if (2 * r > holeMax + 1e-9) return false;
      const c = midPoint(x), n = v3.norm(P(x.normalAt(c))), radial = v3.sub(c, v3.add(o, v3.mul(d, v3.dot(v3.sub(c, o), d))));
      return v3.dot(n, radial) < 0;
    });
    if (!f) break;
    const { o, d, r } = cylInfo(f), [lo, hi] = extentAlong(f, o, d);
    res = tidy(res.fuse(makeCylinder(r, hi - lo + 1e-3, v3.add(o, v3.mul(d, lo - 5e-4)), d) as unknown as Shape3D));
  }
  return res;
}
