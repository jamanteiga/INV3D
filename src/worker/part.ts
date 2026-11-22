// Reconstrucción de piezas (incluida chapa) sobre OpenCascade vía replicad.
import {
  Plane, draw, drawRectangle, drawCircle, drawEllipse, drawText, loadFont, importSTEP, compoundShapes, genericSweep, makeHelix, FaceFinder, EdgeFinder, getOC, cast, measureShapeVolumeProperties,
  makeLine, makeBSplineApproximation, assembleWire, makeNonPlanarFace, makeAx1, loft, makeSolid, Vector, makeBox, measureVolume,
} from 'replicad';
import { openSegments, findLoops, loopPolyline, polyArea, pointInPoly, type Seg } from '../core/sketch';
import type { Drawing, Shape3D } from 'replicad';
import { makeEval } from '../core/expr';
import {
  docParams, planeFrame, entityOutline, npolyPoints, toWorld, v3, workPlaneFrame, registerAux, splineBeziers,
  type PartDoc, type SkEntity, type SketchF, type Feature, type EdgeSel, type Frame, type V3, type V2,
  type WorkPlanes, type BoolOp, type SmFlangeF, type SmPunchF, type Sketch3dF, type E3, type SmSeamF, type SmFoldF, type SmRollF, type SmBendF,
} from '../core/doc';
import { flattenPath } from '../core/svgpath';

export interface FeatStatus { ok: boolean; error?: string }
type Ev = (s: string) => number;

function polyDrawing(pts: V2[]): Drawing {
  let pen = draw(pts[0]);
  for (let i = 1; i < pts.length; i++) pen = pen.lineTo(pts[i]);
  return pen.close();
}

function entityDrawing(e: SkEntity, ev: Ev): Drawing | null {
  switch (e.type) {
    case 'rect': {
      const x = ev(e.x), y = ev(e.y), w = ev(e.w), h = ev(e.h);
      if (!(Math.abs(w) > 1e-6 && Math.abs(h) > 1e-6)) throw new Error('Rectángulo de tamaño nulo');
      return drawRectangle(Math.abs(w), Math.abs(h)).translate(x + w / 2, y + h / 2);
    }
    case 'circle': {
      const d = ev(e.d);
      if (!(d > 1e-6)) throw new Error('Círculo de diámetro nulo');
      return drawCircle(d / 2).translate(ev(e.cx), ev(e.cy));
    }
    case 'poly': case 'npoly': {
      const pts = e.type === 'poly' ? e.pts.map((p) => [ev(p[0]), ev(p[1])] as V2) : npolyPoints(ev(e.cx), ev(e.cy), ev(e.d), Math.round(ev(e.n)), ev(e.rot));
      if (pts.length < 3) throw new Error('Contorno con menos de 3 puntos');
      return polyDrawing(pts);
    }
    case 'slot': {
      const x1 = ev(e.x1), y1 = ev(e.y1), x2 = ev(e.x2), y2 = ev(e.y2), w = ev(e.w);
      const L = Math.hypot(x2 - x1, y2 - y1);
      if (!(w > 0)) throw new Error('Ranura de anchura nula');
      if (L < 1e-6) return drawCircle(w / 2).translate(x1, y1);
      const a = Math.atan2(y2 - y1, x2 - x1), nx = -Math.sin(a) * w / 2, ny = Math.cos(a) * w / 2;
      return draw([x1 + nx, y1 + ny]).lineTo([x2 + nx, y2 + ny])
        .threePointsArcTo([x2 - nx, y2 - ny], [x2 + Math.cos(a) * w / 2, y2 + Math.sin(a) * w / 2])
        .lineTo([x1 - nx, y1 - ny])
        .threePointsArcTo([x1 + nx, y1 + ny], [x1 - Math.cos(a) * w / 2, y1 - Math.sin(a) * w / 2])
        .close();
    }
    case 'ellipse': {
      let rx = Math.abs(ev(e.rx)), ry = Math.abs(ev(e.ry)), rot = ev(e.rot);
      if (!(rx > 1e-6 && ry > 1e-6)) throw new Error('Elipse de tamaño nulo');
      if (ry > rx) { [rx, ry] = [ry, rx]; rot += 90; }
      return drawEllipse(rx, ry).rotate(rot, [0, 0]).translate(ev(e.cx), ev(e.cy));
    }
    case 'spline': {
      if (!e.closed) return null;
      const P = e.pts.map((p) => [ev(p[0]), ev(p[1])] as V2);
      if (P.length < 3) throw new Error('Spline cerrada con menos de 3 puntos');
      let pen: any = draw(P[0]);
      splineBeziers(P, true).forEach(([, c1, c2, d], i, arr) => { pen = pen.cubicBezierCurveTo(i === arr.length - 1 ? P[0] : d, c1, c2); });
      return pen.close();
    }
    default: return null;
  }
}

/** Dibujo de un lazo de tramos encadenados (líneas, arcos y splines). */
function loopDrawing(loop: { seg: Seg; rev: boolean }[]): Drawing {
  const start = loop[0].rev ? loop[0].seg.b : loop[0].seg.a;
  let pen: any = draw(start);
  loop.forEach(({ seg, rev }, i) => {
    const end = i === loop.length - 1 ? start : rev ? seg.a : seg.b;
    if (seg.kind === 'line') pen = pen.lineTo(end);
    else if (seg.kind === 'arc') pen = pen.threePointsArcTo(end, seg.mid);
    else {
      const bz = rev ? [...seg.bez].reverse().map(([a, b, c, d]) => [d, c, b, a] as [V2, V2, V2, V2]) : seg.bez;
      bz.forEach(([, c1, c2, d], j) => { pen = pen.cubicBezierCurveTo(j === bz.length - 1 ? end : d, c1, c2); });
    }
  });
  return pen.close();
}

let fontReady: Promise<unknown> | null = null;
/** Carga (una vez) la tipografía para los textos de boceto. */
export function ensureFont(base: string) { fontReady ??= loadFont(new URL('../fonts/DejaVuSans.ttf', base).href, 'DejaVu'); return fontReady; }

/** Perfil de un boceto: contornos cerrados y lazos de líneas/arcos; los interiores a un número impar de contornos son huecos. */
export function sketchProfile(sk: SketchF, ev: Ev, outerOnly = false): Drawing {
  type Item = { make: () => Drawing; poly: V2[]; area: number };
  const items: Item[] = [];
  for (const e of sk.entities) {
    if (e.construction || e.type === 'line' || e.type === 'arc' || e.type === 'point' || e.type === 'text' || (e.type === 'spline' && !e.closed)) continue;
    const poly = entityOutline(e, ev).pts;
    items.push({ make: () => entityDrawing(e, ev)!, poly, area: Math.abs(polyArea(poly)) });
  }
  const { loops, dangling, branched } = findLoops(openSegments(sk, ev));
  for (const lp of loops) { const poly = loopPolyline(lp); items.push({ make: () => loopDrawing(lp), poly, area: Math.abs(polyArea(poly)) }); }
  const texts = sk.entities.filter((e) => e.type === 'text' && !e.construction) as Extract<SkEntity, { type: 'text' }>[];
  if (!items.length && !texts.length) {
    if (branched) throw new Error(`${sk.name}: hay líneas que se cruzan o ramifican; recórtalas para cerrar el perfil`);
    throw new Error(`${sk.name} no tiene perfiles cerrados${dangling ? ` (${dangling} extremos sueltos)` : ''}`);
  }
  items.sort((a, b) => b.area - a.area);
  if (outerOnly && items.length) return items[0].make();
  let result: Drawing | null = null;
  const placed: Item[] = [];
  for (const it of items) {
    const step = Math.max(1, Math.floor(it.poly.length / 8));
    const samples = it.poly.filter((_, i) => i % step === 0);
    const depth = placed.filter((p) => p.area > it.area && samples.every((q) => pointInPoly(q, p.poly))).length;
    const d = it.make();
    result = result ? (depth % 2 === 1 ? result.cut(d) : result.fuse(d)) : d;
    placed.push(it);
  }
  for (const t of texts) {
    const d = drawText(t.text || ' ', { startX: 0, startY: 0, fontSize: ev(t.size), fontFamily: 'DejaVu' }).rotate(ev(t.rot), [0, 0]).translate(ev(t.x), ev(t.y));
    result = result ? result.fuse(d) : d;
  }
  return result!;
}

/** Trayectoria abierta (líneas y arcos encadenados) de un boceto, para barridos. */
function sketchPath(sk: SketchF, ev: Ev): Drawing {
  const segs = openSegments({ ...sk, entities: sk.entities.map((e) => ({ ...e, construction: false })) as SkEntity[] }, ev);
  if (!segs.length) throw new Error(`${sk.name} no tiene líneas ni arcos para la trayectoria`);
  const near = (p: V2, q: V2) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-4;
  // Encadenar a partir de un extremo libre
  const ends = (p: V2) => segs.filter((s) => near(s.a, p) || near(s.b, p)).length;
  const start = segs.find((s) => ends(s.a) === 1 || ends(s.b) === 1) ?? segs[0];
  let cur: V2 = ends(start.a) === 1 ? start.a : start.b;
  const used = new Set<Seg>();
  let pen = draw(cur);
  while (used.size < segs.length) {
    const s = segs.find((x) => !used.has(x) && (near(x.a, cur) || near(x.b, cur)));
    if (!s) break;
    used.add(s);
    const rev = !near(s.a, cur), to = rev ? s.a : s.b;
    if (s.kind === 'arc') pen = (pen as any).threePointsArcTo(to, s.mid);
    else if (s.kind === 'line') pen = pen.lineTo(to);
    else { const bz = rev ? [...s.bez].reverse().map(([a, b, c, d]) => [d, c, b, a] as [V2, V2, V2, V2]) : s.bez; for (const [, c1, c2, d] of bz) pen = (pen as any).cubicBezierCurveTo(d, c1, c2); }
    cur = to;
  }
  if (used.size < segs.length) throw new Error('La trayectoria no es continua');
  return (pen as any).done();
}

export const makePlane = (f: Frame, shift = 0) => new Plane(v3.add(f.origin, v3.mul(f.normal, shift)), f.xDir, f.normal);

function combine(base: Shape3D | null, tool: Shape3D, op: BoolOp): Shape3D {
  if (!base) {
    if (op === 'cut' || op === 'intersect') throw new Error('No hay sólido sobre el que operar');
    return tool;
  }
  switch (op) {
    case 'cut': return base.cut(tool);
    case 'intersect': return base.intersect(tool) as Shape3D;
    case 'new': return compoundShapes([base, tool]) as unknown as Shape3D;
    default: return base.fuse(tool);
  }
}

function edgeFilter(sel: EdgeSel) {
  return (f: EdgeFinder) => {
    switch (sel.mode) {
      case 'X': case 'Y': case 'Z': return f.inDirection(sel.mode);
      case 'circle': return f.ofCurveType('CIRCLE');
      case 'picked':
        if (!sel.points.length) throw new Error('No hay aristas seleccionadas');
        return f.either(sel.points.map((p) => (g: EdgeFinder) => g.withinDistance(1e-3, p)));
      default: return f;
    }
  };
}

const AXES: Record<string, V3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

interface Ctx {
  ev: Ev; sketches: Map<string, SketchF>; work: WorkPlanes;
  tools: Map<string, { solid: Shape3D; op: BoolOp }>;
  sheet: SheetCtx | null;
  /** estado desplegado (Desplegar … Volver a plegar) */
  unfold?: { folded: Shape3D | null; core: FlatCore; from: number };
  sk3d: Map<string, Sketch3dF>;
  surfaces: Map<string, Shape3D>;
}

// ---------- Boceto 3D y superficies ----------
const e3 = (p: E3, ev: Ev): V3 => [ev(p[0]), ev(p[1]), ev(p[2])];
/** Alambre de un boceto 3D (las entidades se encadenan en el orden en que están). */
export function wire3d(f: Sketch3dF, ev: Ev): any {
  const parts: any[] = [];
  for (const e of f.entities) {
    if (e.type === 'line3') { const a = e3(e.a, ev), b = e3(e.b, ev); if (v3.len(v3.sub(b, a)) < 1e-9) throw new Error('Línea 3D de longitud nula'); parts.push(makeLine(a, b)); }
    else if (e.type === 'spline3') { if (e.pts.length < 2) throw new Error('La spline 3D necesita al menos 2 puntos'); parts.push(makeBSplineApproximation(e.pts.map((p) => e3(p, ev)) as any)); }
    else {
      const r = ev(e.radius), pitch = ev(e.pitch), h = ev(e.height);
      if (!(r > 0 && pitch > 0 && h > 0)) throw new Error('Hélice: radio, paso y altura deben ser mayores que 0');
      const dir: V3 = e.axis === 'X' ? [1, 0, 0] : e.axis === 'Y' ? [0, 1, 0] : [0, 0, 1];
      parts.push(makeHelix(pitch, h, r, e3(e.origin, ev), dir, !!e.left));
    }
  }
  if (!parts.length) throw new Error('El boceto 3D está vacío');
  return parts.length === 1 && parts[0].constructor?.name === 'Wire' ? parts[0] : assembleWire(parts);
}
/** Alambre de un boceto 2D (trayectoria abierta o contorno exterior) o de un boceto 3D. */
function wireOf(id: string, ctx: Ctx): any {
  const s3 = ctx.sk3d.get(id); if (s3) return wire3d(s3, ctx.ev);
  const sk = ctx.sketches.get(id); if (!sk) throw new Error('Boceto no encontrado o con errores');
  const pl = makePlane(planeFrame(sk.plane, ctx.ev, ctx.work));
  try { return (sketchPath(sk, ctx.ev).sketchOnPlane(pl) as any).wire; }
  catch { return (sketchProfile(sk, ctx.ev, true).sketchOnPlane(pl) as any).wire; }
}
function closedWireOf(id: string, ctx: Ctx): any {
  const s3 = ctx.sk3d.get(id); if (s3) return wire3d(s3, ctx.ev);
  const sk = ctx.sketches.get(id); if (!sk) throw new Error('Boceto no encontrado o con errores');
  return (sketchProfile(sk, ctx.ev, true).sketchOnPlane(makePlane(planeFrame(sk.plane, ctx.ev, ctx.work))) as any).wire;
}
const castShape = (x: unknown) => cast(x as any) as unknown as Shape3D;
function prismOf(sh: any, vec: V3): Shape3D {
  const oc = getOC() as any;
  const v = new Vector(vec);
  const mk = new oc.BRepPrimAPI_MakePrism(sh.wrapped, v.wrapped, false, true);
  const r = castShape(mk.Shape()); mk.delete(); v.delete();
  return r;
}
function revolOf(sh: any, origin: V3, dir: V3, angDeg: number): Shape3D {
  const oc = getOC() as any;
  const ax = makeAx1(origin, dir);
  const mk = new oc.BRepPrimAPI_MakeRevol(sh.wrapped, ax, (angDeg * Math.PI) / 180, false);
  const r = castShape(mk.Shape()); mk.delete(); ax.delete();
  return r;
}
function thickOf(sh: Shape3D, d: number): Shape3D {
  const oc = getOC() as any;
  const mk = new oc.BRepOffsetAPI_MakeThickSolid();
  mk.MakeThickSolidBySimple((sh as any).wrapped, d);
  mk.Build(new oc.Message_ProgressRange());
  let sol = castShape(mk.Shape());
  mk.delete();
  if (measureShapeVolumeProperties(sol).volume < 0) sol = castShape((sol as any).wrapped.Reversed());
  return sol;
}
/** Cose superficies; devuelve sólido si quedan cerradas. */
function sewOf(shapes: Shape3D[]): { shape: Shape3D; solid: boolean } {
  const oc = getOC() as any;
  const sw = new oc.BRepBuilderAPI_Sewing(1e-3, true, true, true, false);
  for (const x of shapes) sw.Add((x as any).wrapped);
  sw.Perform(new oc.Message_ProgressRange());
  const res = castShape(sw.SewedShape()); sw.delete();
  try {
    const sol = makeSolid([res as any]) as unknown as Shape3D;
    const vol = measureShapeVolumeProperties(sol).volume;
    if (Math.abs(vol) > 1e-6) return { shape: vol < 0 ? castShape((sol as any).wrapped.Reversed()) : sol, solid: true };
  } catch { /* abierta */ }
  return { shape: res, solid: false };
}
/** Puntos equiespaciados de un contorno cerrado (para desarrollar transiciones de chapa). */
export function sampleClosed(w: any, n: number): V3[] {
  // reparto por longitud, con un punto en el inicio de cada arista (las esquinas se conservan)
  const edges = w.edges as any[];
  const lens = edges.map((e) => e.length as number), tot = lens.reduce((a, b) => a + b, 0);
  const cnt = lens.map((l) => Math.max(1, Math.round((n * l) / tot)));
  let diff = n - cnt.reduce((a, b) => a + b, 0);
  while (diff !== 0) { const i = lens.indexOf(Math.max(...lens.filter((_, k) => diff > 0 || cnt[k] > 1))); cnt[i] += Math.sign(diff); diff -= Math.sign(diff); }
  const P = (e: any, t: number): V3 => { const p = e.pointAt(t); const r: V3 = [p.x, p.y, p.z]; p.delete?.(); return r; };
  const ends = edges.map((e) => [P(e, 0), P(e, 1)] as [V3, V3]);
  const d = (a: V3, b: V3) => v3.len(v3.sub(a, b));
  // sentido de cada arista para que el recorrido sea continuo
  const rev: boolean[] = [];
  let cur: V3;
  if (edges.length > 1) { const [s0, e0] = ends[0], [s1, e1] = ends[1]; rev[0] = Math.min(d(s0, s1), d(s0, e1)) < Math.min(d(e0, s1), d(e0, e1)); }
  else rev[0] = false;
  cur = rev[0] ? ends[0][0] : ends[0][1];
  for (let k = 1; k < edges.length; k++) { rev[k] = d(ends[k][1], cur) < d(ends[k][0], cur); cur = rev[k] ? ends[k][0] : ends[k][1]; }
  const out: V3[] = [];
  edges.forEach((e, k) => { for (let j = 0; j < cnt[k]; j++) { const t = j / cnt[k]; out.push(P(e, rev[k] ? 1 - t : t)); } });
  return out;
}

/** Sólido herramienta de un agujero (revolución de la media sección) en un punto. */
/** Ranura recta (coliso) centrada en el origen a lo largo de X: longitud entre centros «len», anchura «w» */
function stadium(len: number, w: number): Drawing {
  if (len < 1e-6) return drawCircle(w / 2);
  const x1 = -len / 2, x2 = len / 2, r = w / 2;
  return draw([x1, r]).lineTo([x2, r]).threePointsArcTo([x2, -r], [x2 + r, 0]).lineTo([x1, -r]).threePointsArcTo([x1, r], [x1 - r, 0]).close();
}
/** Herramienta de taladro (asistente tipo SolidWorks): escariado, avellanado, taladro, roscado, roscado cónico,
 *  heredado, ranuras (simple, escariada, avellanada) y avanzado (escalonado). Se corta hacia −n desde P. */
function holeTool(f: Extract<Feature, { type: 'hole' }>, P: V3, n: V3, ev: Ev, through: number, xd: V3 = [1, 0, 0]): Shape3D {
  const kind = f.kind ?? 'simple';
  const d = ev(f.dia);
  if (!(d > 0)) throw new Error('Diámetro no válido');
  const L = f.through ? through : ev(f.depth);
  if (!(L > 0)) throw new Error('Profundidad no válida');
  const e = 0.05, D2 = Math.PI / 180;
  let u = v3.cross(n, [0, 0, 1]); if (v3.len(u) < 1e-6) u = v3.cross(n, [1, 0, 0]);
  u = v3.norm(u);
  // ---- ranuras: se extruye un coliso ----
  if (kind === 'slot' || kind === 'cbslot' || kind === 'csslot') {
    const len = ev(f.slotLen || '20 mm'), ang = ev(f.slotAng || '0 deg') * D2;
    const x0 = v3.norm(v3.sub(xd, v3.mul(n, v3.dot(xd, n)))), y0 = v3.cross(n, x0);
    const x = v3.add(v3.mul(x0, Math.cos(ang)), v3.mul(y0, Math.sin(ang)));
    const neg = v3.mul(n, -1);
    const at = (o: V3) => new Plane(o, x, neg);
    let tool = (stadium(len, d).sketchOnPlane(at(v3.add(P, v3.mul(n, e)))) as any).extrude(L + e) as Shape3D;
    if (kind === 'cbslot') {
      const cb = ev(f.cbDia), cbd = ev(f.cbDepth);
      if (!(cb > d && cbd > 0)) throw new Error('El escariado de la ranura debe ser mayor que la ranura');
      tool = tool.fuse((stadium(len, cb).sketchOnPlane(at(v3.add(P, v3.mul(n, e)))) as any).extrude(cbd + e));
    } else if (kind === 'csslot') {
      const cs = ev(f.csDia), a = ev(f.csAngle || '90 deg');
      if (!(cs > d)) throw new Error('El avellanado de la ranura debe ser mayor que la ranura');
      const h = (cs - d) / 2 / Math.tan((a / 2) * D2);
      const top = (stadium(len, cs).sketchOnPlane(at(P)) as any), bot = (stadium(len, d).sketchOnPlane(at(v3.add(P, v3.mul(n, -h)))) as any);
      tool = tool.fuse(top.loftWith([bot]) as Shape3D);
    }
    return tool;
  }
  // ---- taladros redondos: perfil de revolución (radio, altura sobre P) ----
  const pts: V2[] = [];
  const csTop = (csD: number, ang: number) => { if (!(csD > d)) throw new Error('Avellanado mayor que el taladro'); const h = (csD - d) / 2 / Math.tan((ang / 2) * D2); pts.push([0, e], [csD / 2, e], [csD / 2, 0], [d / 2, -h]); };
  const cbTop = (cb: number, cbd: number) => { if (!(cb > d && cbd > 0)) throw new Error('Escariado mayor que el taladro'); pts.push([0, e], [cb / 2, e], [cb / 2, -cbd], [d / 2, -cbd]); };
  const sub = kind === 'legacy' ? f.legacyKind ?? 'simple' : kind === 'adv' ? f.advNear ?? 'cbore' : kind;
  if (sub === 'cbore') cbTop(ev(f.cbDia), ev(f.cbDepth));
  else if (sub === 'csink') csTop(ev(f.csDia), ev(f.csAngle || '90 deg'));
  else if (sub === 'cdrill') { // abocardado: escariado con fondo cónico a 118°
    const cb = ev(f.cbDia), cbd = ev(f.cbDepth); if (!(cb > d && cbd > 0)) throw new Error('Abocardado mayor que el taladro');
    pts.push([0, e], [cb / 2, e], [cb / 2, -cbd], [d / 2, -cbd - (cb - d) / 2 / Math.tan(59 * D2)]);
  } else if (f.nearCs) csTop(ev(f.nearCsDia || `${d * 1.6} mm`), ev(f.nearCsAngle || '90 deg'));
  else pts.push([0, e], [d / 2, e]);
  if (kind === 'ptap') pts.push([d / 2 - L / 32, -L]); // conicidad 1:16 en diámetro
  else pts.push([d / 2, -L]);
  let bottom = -L;
  // taladro avanzado: segundo diámetro tras el primero
  if (kind === 'adv' && !f.through && f.step2Dia) {
    const d2 = ev(f.step2Dia), l2 = ev(f.step2Depth || '10 mm');
    if (d2 > 0 && d2 < d && l2 > 0) { pts.push([d2 / 2, -L], [d2 / 2, -L - l2]); bottom = -L - l2; }
  }
  const rb = kind === 'adv' && bottom !== -L ? ev(f.step2Dia!) / 2 : kind === 'ptap' ? d / 2 - L / 32 : d / 2;
  const tipA = ev(f.tipAngle || '118 deg');
  if (!f.through && tipA > 0 && tipA < 180) pts.push([0, bottom - rb / Math.tan((tipA / 2) * D2)]); else pts.push([0, bottom]);
  const pl = new Plane(P, u, v3.cross(u, n));
  return (polyDrawing(pts).sketchOnPlane(pl) as any).revolve(n, { origin: P });
}

/** Desahogo de esquina: si otra pestaña nace en una arista contigua (mismo vértice, no paralela), esta pestaña se recorta
 *  en ese extremo lo que ocupa el pliegue de la otra (R + t) más la holgura, para que los pliegues no se pisen. */
export interface SheetCtx { t: number; r: number; k: number; gap?: number; flanges?: SmFlangeF[]; seams?: { a: string; b: string; gap: number; kind: SmSeamF['kind'] }[]; ev?: Ev }
export function sheetCtx(doc: PartDoc, ev: Ev): SheetCtx | null {
  if (!doc.sheet) return null;
  const live = doc.features.filter((x) => !x.suppressed);
  return {
    t: ev(doc.sheet.t), r: ev(doc.sheet.r), k: ev(doc.sheet.k), gap: doc.sheet.gap != null && doc.sheet.gap !== '' ? ev(doc.sheet.gap) : 0.5,
    flanges: live.filter((x): x is SmFlangeF => x.type === 'sm_flange' && !!x.edge),
    seams: live.filter((x): x is SmSeamF => x.type === 'sm_seam').map((x) => { let g = 0.5; try { g = ev(x.gap); } catch { /* */ } return { a: x.a, b: x.b, gap: g, kind: x.kind }; }),
    ev,
  };
}
export function flangeEnds(f: SmFlangeF, sh: SheetCtx): { p0: V3; p1: V3; trim0: number; trim1: number; ext0: number; ext1: number } {
  let { p0, p1 } = f.edge!;
  const n = v3.norm(f.edge!.n), w = v3.norm(f.edge!.w);
  if (v3.dot(v3.cross(w, n), v3.sub(p1, p0)) < 0) [p0, p1] = [p1, p0];
  // Costuras de esquina: el tramo recto se alarga en el extremo común con la otra pestaña
  let ext0 = 0, ext1 = 0;
  const near = (P: V3, Q: V3) => v3.len(v3.sub(P, Q)) <= sh.t + 0.1;
  for (const sm of sh.seams ?? []) {
    if (sm.a !== f.id && sm.b !== f.id) continue;
    const o = sh.flanges?.find((x) => x.id === (sm.a === f.id ? sm.b : sm.a)); if (!o?.edge) continue;
    let tho = Math.PI / 2; try { if (sh.ev) tho = (sh.ev(o.angle) * Math.PI) / 180; } catch { /* */ }
    const cover = sm.kind === 'overlap' ? f.id === sm.a : f.id === sm.b;
    const e = Math.max(0, cover ? (sh.r + sh.t) * Math.sin(tho) : sh.r * Math.sin(tho) - sm.gap);
    if (near(p0, o.edge.p0) || near(p0, o.edge.p1)) ext0 = e;
    else if (near(p1, o.edge.p0) || near(p1, o.edge.p1)) ext1 = e;
  }
  const g = sh.gap ?? 0.5;
  if (g < 0 || !sh.flanges) return { p0, p1, trim0: 0, trim1: 0, ext0, ext1 };
  const ax = v3.norm(v3.sub(p1, p0)), tol = sh.t + 0.1;
  const trimAt = (P: V3) => sh.flanges!.some((o) => {
    if (o.id === f.id || !o.edge) return false;
    const oa = v3.norm(v3.sub(o.edge.p1, o.edge.p0));
    if (Math.abs(v3.dot(oa, ax)) > 0.95) return false;                               // paralela: no es esquina
    if (Math.abs(v3.dot(v3.norm(o.edge.n), n)) < 0.9) return false;                  // otra cara
    return v3.len(v3.sub(o.edge.p0, P)) <= tol || v3.len(v3.sub(o.edge.p1, P)) <= tol;
  });
  const s = sh.r + sh.t + g;
  const len = v3.len(v3.sub(p1, p0));
  const trim0 = trimAt(p0) ? Math.min(s, len / 2 - 0.5) : 0, trim1 = trimAt(p1) ? Math.min(s, len / 2 - 0.5) : 0;
  // el alargamiento de la costura se cuenta desde el extremo recortado
  return { p0: v3.add(p0, v3.mul(ax, trim0)), p1: v3.sub(p1, v3.mul(ax, trim1)), trim0, trim1, ext0: ext0 ? ext0 + trim0 : 0, ext1: ext1 ? ext1 + trim1 : 0 };
}

function flangeSolid(f: SmFlangeF, sh: SheetCtx, ev: Ev): Shape3D {
  if (!f.edge) throw new Error('Selecciona la arista de la pestaña');
  const { t, r } = sh;
  const L = ev(f.length), th = (ev(f.angle) * Math.PI) / 180;
  if (!(L > 0)) throw new Error('Longitud no válida');
  if (!(th > 0 && th <= Math.PI)) throw new Error('Ángulo entre 0 y 180°');
  const { p0, p1, ext0, ext1 } = flangeEnds(f, sh);
  const n = v3.norm(f.edge.n), w = v3.norm(f.edge.w);
  const ax = v3.norm(v3.sub(p1, p0));
  const len = v3.len(v3.sub(p1, p0));
  const ri = r, ro = r + t;
  const arc = (rad: number, a: number): V2 => [rad * Math.sin(a), r - rad * Math.cos(a)];
  // Dirección del tramo recto tras el pliegue (tangente al arco en su final)
  const d: V2 = [Math.cos(th), Math.sin(th)];
  const iE = arc(ri, th), oE = arc(ro, th), iM = arc(ri, th / 2), oM = arc(ro, th / 2);
  let pts = { s: [0, 0] as V2, iM, iE, iF: [iE[0] + L * d[0], iE[1] + L * d[1]] as V2, oF: [oE[0] + L * d[0], oE[1] + L * d[1]] as V2, oE, oM, oS: [0, -t] as V2 };
  if (f.dir === 'down') {
    const m = (p: V2): V2 => [p[0], -t - p[1]];
    pts = { s: m(pts.s), iM: m(pts.iM), iE: m(pts.iE), iF: m(pts.iF), oF: m(pts.oF), oE: m(pts.oE), oM: m(pts.oM), oS: m(pts.oS) };
  }
  const dr = (draw(pts.s) as any).threePointsArcTo(pts.iE, pts.iM).lineTo(pts.iF).lineTo(pts.oF).lineTo(pts.oE)
    .threePointsArcTo(pts.oS, pts.oM).close();
  // Plano de la sección: x = w (hacia fuera), y = n; su normal coincide con el eje de la arista
  const pl = new Plane(p0, w, ax);
  let solid = (dr.sketchOnPlane(pl) as any).extrude(len) as Shape3D;
  // costura de esquina: tramo recto alargado más allá de los extremos
  if (ext0 > 1e-6 || ext1 > 1e-6) {
    const st = (draw(pts.iE) as any).lineTo(pts.iF).lineTo(pts.oF).lineTo(pts.oE).close();
    if (ext1 > 1e-6) solid = solid.fuse((st.sketchOnPlane(new Plane(p1, w, ax)) as any).extrude(ext1));
    if (ext0 > 1e-6) solid = solid.fuse((st.sketchOnPlane(new Plane(p0, w, ax)) as any).extrude(ext0, { extrusionDirection: v3.mul(ax, -1) }));
  }
  return solid;
}

/** Contorno 2D de un punzonado en los puntos dados (coordenadas del boceto) */
function punchDrawing(f: SmPunchF, ev: Ev, pts: V2[]): Drawing {
  const d = ev(f.d), w = ev(f.w), h = ev(f.h), rot = ev(f.rot);
  const one = (): Drawing => {
    switch (f.shape) {
      case 'round': if (!(d > 0)) throw new Error('Diámetro no válido'); return drawCircle(d / 2);
      case 'square': if (!(w > 0)) throw new Error('Lado no válido'); return drawRectangle(w, w);
      case 'rect': if (!(w > 0 && h > 0)) throw new Error('Medidas no válidas'); return drawRectangle(w, h);
      case 'slot': { if (!(w > h && h > 0)) throw new Error('Ranura: longitud mayor que anchura'); const L = w - h; return draw([-L / 2, -h / 2]).lineTo([L / 2, -h / 2]).threePointsArcTo([L / 2, h / 2], [L / 2 + h / 2, 0]).lineTo([-L / 2, h / 2]).threePointsArcTo([-L / 2, -h / 2], [-L / 2 - h / 2, 0]).close(); }
    }
    throw new Error('Forma de punzonado no válida');
  };
  let dr: Drawing | null = null;
  for (const p of pts) { const x = one().rotate(rot, [0, 0]).translate(p[0], p[1]); dr = dr ? dr.fuse(x) : x; }
  return dr!;
}

/** Polilínea ordenada de una cadena abierta de líneas de boceto. */
function lineChain(sk: SketchF, ev: Ev): V2[] {
  const segs = openSegments(sk, ev);
  if (segs.some((x) => x.kind !== 'line')) throw new Error('La pestaña de contorno usa solo líneas: los pliegues se redondean solos con el radio de la chapa');
  if (!segs.length) throw new Error(`${sk.name} no tiene líneas`);
  const near = (p: V2, q: V2) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-4;
  const deg = (p: V2) => segs.filter((x) => near(x.a, p) || near(x.b, p)).length;
  const first = segs.find((x) => deg(x.a) === 1 || deg(x.b) === 1);
  if (!first) throw new Error('El contorno debe ser abierto');
  let cur: V2 = deg(first.a) === 1 ? first.a : first.b;
  const pts: V2[] = [cur]; const used = new Set<typeof first>();
  for (;;) {
    const n = segs.find((x) => !used.has(x) && (near(x.a, cur) || near(x.b, cur)));
    if (!n) break;
    used.add(n); cur = near(n.a, cur) ? n.b : n.a; pts.push(cur);
  }
  if (used.size !== segs.length) throw new Error('Las líneas del contorno no forman una única cadena');
  return pts;
}

/** Pestaña de contorno: perfil grueso con pliegues de radio interior R y su desarrollo. */
export function contourGeometry(pts: V2[], t: number, R: number, K: number, side: 'in' | 'out') {
  const s = side === 'in' ? 1 : -1;
  const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
  const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
  const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
  const unit = (a: V2): V2 => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
  const left = (u: V2): V2 => [-u[1], u[0]];
  type It = { kind: 'L'; to: V2 } | { kind: 'A'; to: V2; mid: V2; c: V2; r: number; dir: number };
  const A: It[] = [], B: It[] = [];
  const n = pts.length;
  const us: V2[] = []; for (let i = 0; i + 1 < n; i++) us.push(unit(sub(pts[i + 1], pts[i])));
  const off = (p: V2, u: V2) => add(p, mul(left(u), t * s));
  const A0 = pts[0], B0 = off(pts[0], us[0]);
  const straight: number[] = []; const bends: { angle: number; up: boolean }[] = [];
  let prevT: V2 = A0;
  for (let i = 1; i < n - 1; i++) {
    const uin = us[i - 1], uout = us[i];
    const cr = uin[0] * uout[1] - uin[1] * uout[0], th = Math.atan2(cr, uin[0] * uout[0] + uin[1] * uout[1]);
    if (Math.abs(th) < 1e-6) continue;
    const dir = Math.sign(th);
    const rA = dir === s ? R + t : R;
    const d = rA * Math.tan(Math.abs(th) / 2);
    const T1 = sub(pts[i], mul(uin, d)), T2 = add(pts[i], mul(uout, d));
    const C = add(T1, mul(left(uin), rA * dir));
    const M = add(C, mul(unit(sub(mul(add(T1, T2), 0.5), C)), rA));
    const rB = rA - t * s * dir;
    const T1b = off(T1, uin), T2b = off(T2, uout), Mb = add(C, mul(unit(sub(M, C)), rB));
    const along = (T1[0] - prevT[0]) * uin[0] + (T1[1] - prevT[1]) * uin[1];
    if (along < -1e-6) throw new Error('Tramo demasiado corto para el radio de pliegue');
    straight.push(along);
    A.push({ kind: 'L', to: T1 }, { kind: 'A', to: T2, mid: M, c: C, r: rA, dir });
    B.push({ kind: 'L', to: T1b }, { kind: 'A', to: T2b, mid: Mb, c: C, r: rB, dir });
    bends.push({ angle: Math.abs(th), up: dir === s });
    prevT = T2;
  }
  const An = pts[n - 1], Bn = off(pts[n - 1], us[n - 2]);
  const lastU = us[n - 2], alongN = (An[0] - prevT[0]) * lastU[0] + (An[1] - prevT[1]) * lastU[1];
  if (alongN < -1e-6) throw new Error('Tramo demasiado corto para el radio de pliegue');
  straight.push(alongN);
  A.push({ kind: 'L', to: An }); B.push({ kind: 'L', to: Bn });
  let pen: any = draw(A0);
  for (const it of A) pen = it.kind === 'L' ? pen.lineTo(it.to) : pen.threePointsArcTo(it.to, it.mid);
  pen = pen.lineTo(Bn);
  const Brev: { to: V2; mid?: V2 }[] = [];
  for (let i = B.length - 1; i >= 0; i--) { const start = i > 0 ? B[i - 1].to : B0; const it = B[i]; Brev.push(it.kind === 'L' ? { to: start } : { to: start, mid: it.mid }); }
  for (const it of Brev) pen = it.mid ? pen.threePointsArcTo(it.to, it.mid) : pen.lineTo(it.to);
  const profile = pen.close() as Drawing;
  // Desarrollo: tramos rectos + márgenes de pliegue θ(R + K·t)
  let x = 0;
  const flatBends: { x: number; angle: number; up: boolean; ba: number }[] = [];
  straight.forEach((L, i) => { x += L; if (i < bends.length) { const ba = bends[i].angle * (R + K * t); flatBends.push({ x: x + ba / 2, angle: bends[i].angle, up: bends[i].up, ba }); x += ba; } });
  return { profile, flatLength: x, flatBends };
}

function bodyTool(f: Feature, ctx: Ctx, shape: Shape3D | null): { solid: Shape3D; op: BoolOp } | null {
  const { ev, sketches, work } = ctx;
  const getSk = (id: string) => { const s = sketches.get(id); if (!s) throw new Error('Boceto no encontrado o con errores'); return s; };
  switch (f.type) {
    case 'extrude': {
      const sk = getSk(f.profile);
      const fr = planeFrame(sk.plane, ev, work);
      let d = ev(f.distance);
      let through = 0;
      if (f.extent === 'through') {
        if (shape) { const b = shape.boundingBox.bounds; through = v3.len(v3.sub(b[1] as V3, b[0] as V3)) * 2 + 10; } else through = 1000;
        d = through;
      }
      if (!(d > 1e-6)) throw new Error('La distancia debe ser mayor que 0');
      const prof = sketchProfile(sk, ev);
      const taper = f.taper ? ev(f.taper) : 0;
      const ext = (dist: number, sign: 1 | -1): Shape3D => {
        if (Math.abs(taper) > 1e-9) {
          if (Math.abs(taper) >= 89) throw new Error('Ángulo de inclinación no válido');
          const base = sketchProfile(sk, ev, true);
          const off = -dist * Math.tan((taper * Math.PI) / 180);
          const top = base.offset(off);
          const p0 = (base.sketchOnPlane(makePlane(fr)) as any), p1 = (top.sketchOnPlane(makePlane(fr, sign * dist)) as any);
          return p0.loftWith([p1], { ruled: true });
        }
        if (sign < 0) return (prof.sketchOnPlane(makePlane(fr)) as any).extrude(dist, { extrusionDirection: v3.mul(fr.normal, -1) });
        return (prof.sketchOnPlane(makePlane(fr)) as any).extrude(dist);
      };
      let solid: Shape3D;
      if (f.dir === 'symmetric') solid = Math.abs(taper) > 1e-9 ? ext(d / 2, 1).fuse(ext(d / 2, -1)) : (prof.sketchOnPlane(makePlane(fr, -d / 2)) as any).extrude(d);
      else if (f.dir === 'reverse') solid = ext(d, -1);
      else if (f.dir === 'two') {
        const d2 = f.extent === 'through' ? through : ev(f.distance2 ?? '0');
        if (!(d2 > 1e-6)) throw new Error('La segunda distancia debe ser mayor que 0');
        solid = ext(d, 1).fuse(ext(d2, -1));
      } else solid = ext(d, 1);
      return { solid, op: f.op };
    }
    case 'rib': {
      const sk = getSk(f.profile);
      const fr = planeFrame(sk.plane, ev, work);
      const t = ev(f.thickness), D = ev(f.depth);
      if (!(t > 0 && D > 0)) throw new Error('Espesor y profundidad deben ser mayores que 0');
      const lines = openSegments(sk, ev).filter((x) => x.kind === 'line');
      if (!lines.length) throw new Error(`${sk.name} no tiene líneas para el nervio`);
      let tool: Shape3D | null = null;
      for (const ln of lines) {
        const u: V2 = [ln.b[0] - ln.a[0], ln.b[1] - ln.a[1]], L = Math.hypot(u[0], u[1]);
        if (L < 1e-9) continue;
        const sgn = f.flip ? -1 : 1, n: V2 = [(-u[1] / L) * D * sgn, (u[0] / L) * D * sgn];
        const pts: V2[] = [ln.a, ln.b, [ln.b[0] + n[0], ln.b[1] + n[1]], [ln.a[0] + n[0], ln.a[1] + n[1]]];
        const sol = (polyDrawing(pts).sketchOnPlane(makePlane(fr, -t / 2)) as any).extrude(t) as Shape3D;
        tool = tool ? tool.fuse(sol) : sol;
      }
      if (!tool) throw new Error('Nervio vacío');
      return { solid: tool, op: f.op };
    }
    case 'coil': {
      const sk = getSk(f.profile);
      const fr = planeFrame(sk.plane, ev, work);
      const pitch = ev(f.pitch), turns = ev(f.turns);
      if (!(pitch > 0 && turns > 0)) throw new Error('Paso y número de vueltas deben ser mayores que 0');
      let O: V3 = fr.origin, dir: V3;
      if (f.axis === 'sx') dir = fr.xDir;
      else if (f.axis === 'sy') dir = fr.yDir;
      else {
        const ln = sk.entities.find((e) => e.id === f.axis);
        if (!ln || ln.type !== 'line') throw new Error('Eje de la bobina no encontrado');
        const a = toWorld(fr, ev(ln.a[0]), ev(ln.a[1])), b = toWorld(fr, ev(ln.b[0]), ev(ln.b[1]));
        O = a; dir = v3.norm(v3.sub(b, a));
      }
      const outer = sketchProfile({ ...sk, entities: sk.entities.filter((e) => e.id !== f.axis) }, ev, true);
      const prof = outer.sketchOnPlane(makePlane(fr)) as any;
      const bb = outer.boundingBox; const c2: V2 = [(bb.bounds[0][0] + bb.bounds[1][0]) / 2, (bb.bounds[0][1] + bb.bounds[1][1]) / 2];
      const C = toWorld(fr, c2[0], c2[1]);
      const rel = v3.sub(C, O), ax = v3.dot(rel, dir), radial = v3.sub(rel, v3.mul(dir, ax)), R = v3.len(radial);
      if (R < 1e-6) throw new Error('El perfil no puede estar sobre el eje');
      const center = v3.add(O, v3.mul(dir, ax));
      let helix = makeHelix(pitch, pitch * turns, R, center, dir, f.left) as any;
      const sp = helix.startPoint; const s0 = v3.sub([sp.x, sp.y, sp.z] as V3, center);
      const ang = Math.atan2(v3.dot(v3.cross(s0, radial), dir), v3.dot(s0, radial)) * 180 / Math.PI;
      if (Math.abs(ang) > 1e-6) helix = helix.rotate(ang, center, dir);
      const solid = genericSweep(prof.wire, helix, { frenet: true }, false) as Shape3D;
      return { solid, op: f.op };
    }
    case 'thicken': {
      const d = ev(f.distance); if (!(Math.abs(d) > 1e-6)) throw new Error('Distancia no válida');
      if (f.surface) { const sf = ctx.surfaces.get(f.surface); if (!sf) throw new Error('Superficie no encontrada'); return { solid: thickOf(sf, d), op: f.op }; }
      if (!shape) throw new Error('No hay sólido');
      if (!f.faces.length) throw new Error('Selecciona caras');
      let tool: Shape3D | null = null;
      for (const p of f.faces) {
        const faces = new FaceFinder().containsPoint(p).find(shape) as any[];
        if (!faces.length) throw new Error('Cara no encontrada (la geometría ha cambiado)');
        const oc = getOC() as any;
        const mk = new oc.BRepOffsetAPI_MakeThickSolid();
        mk.MakeThickSolidBySimple(faces[0].wrapped, d);
        mk.Build(new oc.Message_ProgressRange());
        let sol = cast(mk.Shape()) as unknown as Shape3D;
        mk.delete();
        // el sólido puede salir con la orientación invertida (volumen negativo)
        if (measureShapeVolumeProperties(sol).volume < 0) sol = cast((sol as any).wrapped.Reversed()) as unknown as Shape3D;
        tool = tool ? tool.fuse(sol) : sol;
      }
      return { solid: tool!, op: f.op };
    }
    case 'revolve': {
      const sk = getSk(f.profile);
      const fr = planeFrame(sk.plane, ev, work);
      const ang = ev(f.angle);
      if (!(ang > 0 && ang <= 360)) throw new Error('Ángulo entre 0 y 360°');
      let origin: V3 = fr.origin, dir: V3;
      if (f.axis === 'sx') dir = fr.xDir;
      else if (f.axis === 'sy') dir = fr.yDir;
      else {
        const ln = sk.entities.find((e) => e.id === f.axis);
        if (!ln || ln.type !== 'line') throw new Error('Eje de revolución no encontrado');
        const a = toWorld(fr, ev(ln.a[0]), ev(ln.a[1])), b = toWorld(fr, ev(ln.b[0]), ev(ln.b[1]));
        origin = a; dir = v3.norm(v3.sub(b, a));
      }
      const prof = sketchProfile(sk, ev);
      return { solid: (prof.sketchOnPlane(makePlane(fr)) as any).revolve(dir, { origin, angle: ang }), op: f.op };
    }
    case 'hole': {
      let fr: Frame; const centers: V2[] = [];
      if (f.face) {
        // en una cara: centro a las distancias d1 y d2 de las dos aristas de referencia
        const F = f.face, n0 = v3.norm(F.normal as V3), P = F.point as V3;
        let x = v3.cross([0, 0, 1], n0); if (v3.len(x) < 1e-6) x = [1, 0, 0]; x = v3.norm(x);
        fr = { origin: P, xDir: x, normal: n0, yDir: v3.cross(n0, x) };
        const loc = (q: V3): V2 => { const d = v3.sub(q, P); return [v3.dot(d, fr.xDir), v3.dot(d, fr.yDir)]; };
        if (F.e1 && F.e2 && F.d1 && F.d2) {
          const L = [F.e1, F.e2].map((e) => { const A = loc(e.a as V3), B = loc(e.b as V3); const u: V2 = [B[0] - A[0], B[1] - A[1]]; const l = Math.hypot(u[0], u[1]) || 1; let w: V2 = [-u[1] / l, u[0] / l]; if (-(A[0] * w[0] + A[1] * w[1]) < 0) w = [-w[0], -w[1]]; return { A, w }; });
          const d = [ev(F.d1), ev(F.d2)];
          // (C − A_i)·w_i = d_i
          const [a1, b1] = L[0].w, [a2, b2] = L[1].w, r1 = d[0] + L[0].A[0] * a1 + L[0].A[1] * b1, r2 = d[1] + L[1].A[0] * a2 + L[1].A[1] * b2;
          const det = a1 * b2 - a2 * b1; if (Math.abs(det) < 1e-9) throw new Error('Las aristas de referencia son paralelas');
          centers.push([(r1 * b2 - r2 * b1) / det, (a1 * r2 - a2 * r1) / det]);
        } else centers.push([0, 0]);
      } else {
        const sk = getSk(f.sketch);
        fr = planeFrame(sk.plane, ev, work);
        for (const e of sk.entities) {
          if (e.type === 'point') centers.push([ev(e.cx), ev(e.cy)]);
          else if (e.type === 'circle') centers.push([ev(e.cx), ev(e.cy)]);
        }
      }
      if (!centers.length) throw new Error('El boceto no tiene puntos para los agujeros');
      let through = 1000;
      if (shape) { const b = shape.boundingBox.bounds; through = v3.len(v3.sub(b[1] as V3, b[0] as V3)) * 2 + 10; }
      // dirección: hacia el lado con material (como Inventor/SolidWorks); «flip» la invierte
      let n = fr.normal;
      if (shape && f.dirMode !== 'normal') {
        const vol = (dir: V3) => { try { return measureShapeVolumeProperties(shape!.clone().intersect(holeTool(f, toWorld(fr, centers[0][0], centers[0][1]), dir, ev, through, fr.xDir))).volume; } catch { return 0; } };
        const a = vol(n), b = vol(v3.mul(n, -1));
        if (b > a * 1.0001) n = v3.mul(n, -1);
        if (Math.max(a, b) < 1e-9) throw new Error('El taladro no toca la pieza: el boceto está fuera del material');
      }
      if (f.flip) n = v3.mul(n, -1);
      let tool: Shape3D | null = null;
      for (const c of centers) {
        const t = holeTool(f, toWorld(fr, c[0], c[1]), n, ev, through, fr.xDir);
        tool = tool ? tool.fuse(t) : t;
      }
      return { solid: tool!, op: 'cut' };
    }
    case 'loft': {
      if (f.sections.length < 2) throw new Error('Selecciona al menos dos bocetos');
      const sks = f.sections.map((id) => {
        const sk = getSk(id);
        return (sketchProfile(sk, ev, true).sketchOnPlane(makePlane(planeFrame(sk.plane, ev, work))) as any);
      });
      return { solid: sks[0].loftWith(sks.slice(1), { ruled: f.ruled }), op: f.op };
    }
    case 'sweep': {
      const skP = getSk(f.profile);
      const prof = (sketchProfile(skP, ev, true).sketchOnPlane(makePlane(planeFrame(skP.plane, ev, work))) as any);
      const pathW = wireOf(f.path, ctx);
      const solid = genericSweep(prof.wire, pathW, { frenet: true, transitionMode: f.transition ?? 'round' }, false);
      return { solid, op: f.op };
    }
    case 'sm_face': {
      if (!ctx.sheet) throw new Error('La pieza no es de chapa');
      const sk = getSk(f.profile);
      const fr = planeFrame(sk.plane, ev, work);
      return { solid: (sketchProfile(sk, ev).sketchOnPlane(makePlane(fr)) as any).extrude(ctx.sheet.t), op: 'join' };
    }
    case 'sm_flange': {
      if (!ctx.sheet) throw new Error('La pieza no es de chapa');
      return { solid: flangeSolid(f, ctx.sheet, ev), op: 'join' };
    }
    case 'sm_contour': {
      if (!ctx.sheet) throw new Error('La pieza no es de chapa');
      const sk = getSk(f.profile), fr = planeFrame(sk.plane, ev, work);
      const W = ev(f.width); if (!(W > 0)) throw new Error('Anchura no válida');
      const g = contourGeometry(lineChain(sk, ev), ctx.sheet.t, ctx.sheet.r, ctx.sheet.k, f.side);
      const solid = f.dir === 'symmetric' ? (g.profile.sketchOnPlane(makePlane(fr, -W / 2)) as any).extrude(W)
        : f.dir === 'reverse' ? (g.profile.sketchOnPlane(makePlane(fr)) as any).extrude(W, { extrusionDirection: v3.mul(fr.normal, -1) })
          : (g.profile.sketchOnPlane(makePlane(fr)) as any).extrude(W);
      return { solid, op: 'join' };
    }
    case 'sm_roll': {
      if (!ctx.sheet) throw new Error('La pieza no es de chapa');
      const sk = getSk(f.profile), fr = planeFrame(sk.plane, ev, work);
      const ang = ev(f.angle); if (!(ang > 0 && ang <= 360)) throw new Error('Ángulo entre 0 y 360°');
      const { g, ax } = rollGeometry(f, sk, ev, ctx.sheet.t, ctx.sheet.r, ctx.sheet.k);
      const face = (g.profile.sketchOnPlane(makePlane(fr)) as any).face();
      const o3 = toWorld(fr, ax.o[0], ax.o[1]), d3 = v3.norm(v3.add(v3.mul(fr.xDir, ax.d[0]), v3.mul(fr.yDir, ax.d[1])));
      return { solid: revolOf(face, o3, d3, ang), op: 'join' };
    }
    case 'sm_rip': {
      const sk = getSk(f.sketch), fr = planeFrame(sk.plane, ev, work);
      const dr = ripDrawing(sk, ev, ev(f.gap));
      let L = 1000; if (shape) { const b = shape.boundingBox.bounds; L = v3.len(v3.sub(b[1] as V3, b[0] as V3)) * 2 + 10; }
      return { solid: (dr.sketchOnPlane(makePlane(fr, -L / 2)) as any).extrude(L), op: 'cut' };
    }
    case 'sm_punch': {
      const sk = getSk(f.sketch), fr = planeFrame(sk.plane, ev, work);
      const pts: V2[] = [];
      for (const e of sk.entities) { if (e.type === 'point' && !e.construction) pts.push([ev(e.cx), ev(e.cy)]); }
      if (!pts.length) throw new Error(`${sk.name}: coloca puntos de boceto como centros de punzonado`);
      const dr = punchDrawing(f, ev, pts);
      let L = 1000; if (shape) { const b = shape.boundingBox.bounds; L = v3.len(v3.sub(b[1] as V3, b[0] as V3)) * 2 + 10; }
      return { solid: (dr!.sketchOnPlane(makePlane(fr, -L / 2)) as any).extrude(L), op: 'cut' };
    }
    default: return null;
  }
}

export interface PartBuild { shape: Shape3D | null; status: Record<string, FeatStatus>; surfaces: Shape3D | null; owners?: Map<string, string> }
/** Firma de una cara que no cambia al recortarla: plano (normal y distancia) o tipo de superficie y centro.
 *  Sirve para saber qué operación creó cada cara (doble clic → editar la operación). */
export function faceSig(fc: any): string {
  const r = (x: number, k = 3) => (Math.round(x * 10 ** k) / 10 ** k).toFixed(k);
  const xyz = (v: any): [number, number, number] => (Array.isArray(v) ? [v[0], v[1], v[2]] : [v.x, v.y, v.z]);
  try {
    const t = String(fc.geomType);
    const c = xyz(fc.center);
    if (t === 'PLANE') { const n = xyz(fc.normalAt()); return `P${r(n[0])},${r(n[1])},${r(n[2])},${r(n[0] * c[0] + n[1] * c[1] + n[2] * c[2], 2)}`; }
    return `${t}${r(c[0], 1)},${r(c[1], 1)},${r(c[2], 1)}`;
  } catch { return ''; }
}

export async function buildPart(doc: PartDoc, upTo?: number): Promise<PartBuild> {
  const ev = makeEval(docParams(doc));
  const status: Record<string, FeatStatus> = {};
  const ctx: Ctx = {
    ev, sketches: new Map(), work: new Map(), tools: new Map(),
    sheet: sheetCtx(doc, ev),
    sk3d: new Map(), surfaces: new Map(),
  };
  let shape: Shape3D | null = null;
  const feats = upTo !== undefined ? doc.features.slice(0, upTo) : doc.features;
  const owners = new Map<string, string>();
  for (const f of feats) {
    if (f.suppressed) { status[f.id] = { ok: true }; continue; }
    const before: Shape3D | null = shape;
    try {
      switch (f.type) {
        case 'sketch':
          for (const e of f.entities) entityOutline(e, ev);
          planeFrame(f.plane, ev, ctx.work);
          ctx.sketches.set(f.id, f);
          break;
        case 'workplane': case 'workpoint': case 'workaxis':
          registerAux(ctx.work, f, ev);
          break;
        case 'sketch3d':
          wire3d(f, ev);
          ctx.sk3d.set(f.id, f);
          break;
        case 'surf_extrude': {
          const sk = ctx.sketches.get(f.profile); if (!sk) throw new Error('Boceto no encontrado');
          const fr = planeFrame(sk.plane, ev, ctx.work), d = ev(f.distance);
          if (!(d > 0)) throw new Error('La distancia debe ser mayor que 0');
          let w = wireOf(f.profile, ctx);
          if (f.dir === 'symmetric') w = w.clone().translate(v3.mul(fr.normal, -d / 2));
          ctx.surfaces.set(f.id, prismOf(w, v3.mul(fr.normal, f.dir === 'reverse' ? -d : d)));
          break;
        }
        case 'surf_revolve': {
          const sk = ctx.sketches.get(f.profile); if (!sk) throw new Error('Boceto no encontrado');
          const fr = planeFrame(sk.plane, ev, ctx.work), ang = ev(f.angle);
          if (!(ang > 0 && ang <= 360)) throw new Error('Ángulo entre 0 y 360°');
          let origin: V3 = fr.origin, dir: V3 = f.axis === 'sx' ? fr.xDir : fr.yDir;
          if (f.axis !== 'sx' && f.axis !== 'sy') {
            const ln = sk.entities.find((e) => e.id === f.axis);
            if (!ln || ln.type !== 'line') throw new Error('Eje de revolución no encontrado');
            const a = toWorld(fr, ev(ln.a[0]), ev(ln.a[1])), b = toWorld(fr, ev(ln.b[0]), ev(ln.b[1]));
            origin = a; dir = v3.norm(v3.sub(b, a));
          }
          ctx.surfaces.set(f.id, revolOf(wireOf(f.profile, ctx), origin, dir, ang));
          break;
        }
        case 'surf_loft': {
          if (f.sections.length < 2) throw new Error('Selecciona al menos dos bocetos');
          ctx.surfaces.set(f.id, loft(f.sections.map((id) => wireOf(id, ctx)), { ruled: f.ruled }, true) as unknown as Shape3D);
          break;
        }
        case 'surf_patch': {
          if (ctx.sk3d.has(f.sketch)) ctx.surfaces.set(f.id, makeNonPlanarFace(wire3d(ctx.sk3d.get(f.sketch)!, ev)) as unknown as Shape3D);
          else {
            const sk = ctx.sketches.get(f.sketch); if (!sk) throw new Error('Boceto no encontrado');
            ctx.surfaces.set(f.id, (sketchProfile(sk, ev).sketchOnPlane(makePlane(planeFrame(sk.plane, ev, ctx.work))) as any).face());
          }
          break;
        }
        case 'stitch': {
          const parts = f.surfaces.map((id) => { const x = ctx.surfaces.get(id); if (!x) throw new Error('Superficie no encontrada'); return x; });
          if (!parts.length) throw new Error('Selecciona superficies');
          const r = sewOf(parts);
          if (!f.keep) for (const id of f.surfaces) ctx.surfaces.delete(id);
          if (r.solid) { ctx.tools.set(f.id, { solid: r.shape.clone(), op: f.op }); shape = combine(shape, r.shape, f.op); }
          else { ctx.surfaces.set(f.id, r.shape); status[f.id] = { ok: true, error: 'Las superficies no cierran un volumen: queda como superficie cosida' }; }
          break;
        }
        case 'sm_loft': {
          if (!ctx.sheet) throw new Error('La pieza no es de chapa');
          const wa = closedWireOf(f.a, ctx), wb = closedWireOf(f.b, ctx);
          const shell = loft([wa, wb], { ruled: true }, true) as unknown as Shape3D;
          const t = ctx.sheet.t;
          const sol = thickOf(shell, f.side === 'in' ? -t : t);
          ctx.tools.set(f.id, { solid: sol.clone(), op: 'join' });
          shape = combine(shape, sol, 'join');
          break;
        }
        case 'import': {
          const s = (await importSTEP(new Blob([f.step]))) as Shape3D;
          shape = shape ? shape.fuse(s) : s;
          break;
        }
        case 'fillet': case 'chamfer': {
          if (!shape) throw new Error('No hay sólido');
          const r = ev(f.type === 'fillet' ? f.radius : f.distance); if (!(r > 0)) throw new Error(f.type === 'fillet' ? 'Radio no válido' : 'Distancia no válida');
          const r2 = f.type === 'fillet' && f.radius2 ? ev(f.radius2) : NaN;
          const R: any = f.type === 'fillet' && r2 > 0 && Math.abs(r2 - r) > 1e-9 ? [r, r2] : r; // radio variable: inicial → final
          const faces = f.faces ?? [];
          if (faces.length) {
            // aristas de las caras elegidas + aristas elegidas una a una
            const sel: any[] = [];
            for (const p of faces) for (const fc of new FaceFinder().containsPoint(p).find(shape) as any[]) sel.push(...fc.edges);
            if (f.edges.mode === 'picked' && f.edges.points.length) { const fd = new EdgeFinder(); edgeFilter(f.edges)(fd); sel.push(...(fd.find(shape) as any[])); }
            else if (f.edges.mode !== 'picked') { const fd = new EdgeFinder(); edgeFilter(f.edges)(fd); sel.push(...(fd.find(shape) as any[])); }
            if (!sel.length) throw new Error('No se encuentran aristas en las caras elegidas');
            const fn = (e: any) => (sel.some((x) => x.isSame(e)) ? R : 0);
            shape = f.type === 'fillet' ? shape.fillet(fn as any) : shape.chamfer(((e: any) => (sel.some((x) => x.isSame(e)) ? r : 0)) as any);
          } else shape = f.type === 'fillet' ? shape.fillet(R, edgeFilter(f.edges) as any) : shape.chamfer(r, edgeFilter(f.edges) as any);
          break;
        }
        case 'split': {
          if (!shape) throw new Error('No hay sólido');
          const fr = planeFrame(f.plane, ev, ctx.work);
          const r = shape.split(new Plane(fr.origin, fr.xDir, fr.normal));
          const keep = f.keep === 'neg' ? r.negative : r.positive;
          if (!keep) throw new Error('El plano no corta el sólido por ese lado');
          shape = keep as unknown as Shape3D;
          break;
        }
        case 'draft': {
          if (!shape) throw new Error('No hay sólido');
          const a = ev(f.angle); if (!(Math.abs(a) > 1e-6 && Math.abs(a) < 60)) throw new Error('Ángulo entre 0 y 60°');
          if (!f.faces.length) throw new Error('Selecciona las caras a inclinar');
          const fr = planeFrame(f.plane, ev, ctx.work);
          shape = shape.draft(a, ((ff: FaceFinder) => ff.either(f.faces.map((p) => (g: FaceFinder) => g.containsPoint(p)))) as any, new Plane(fr.origin, fr.xDir, fr.normal));
          break;
        }
        case 'thread': {
          if (!shape) throw new Error('No hay sólido');
          if (!f.faces.length) throw new Error('Selecciona la cara cilíndrica');
          for (const p of f.faces) {
            const faces = new FaceFinder().containsPoint(p).find(shape) as any[];
            if (!faces.length) throw new Error('Cara no encontrada');
            if (faces[0].geomType !== 'CYLINDRE') throw new Error('La rosca necesita una cara cilíndrica');
          }
          break;
        }
        case 'combine': {
          if (!shape) throw new Error('No hay sólidos');
          const solids = ((shape as any).solids ?? [shape]) as Shape3D[];
          if (f.faces.length < 2) throw new Error('Selecciona el cuerpo base y al menos un cuerpo herramienta');
          const owner = (p: V3) => solids.findIndex((so) => (new FaceFinder().containsPoint(p).find(so) as any[]).length > 0);
          const bi = owner(f.faces[0]); if (bi < 0) throw new Error('Cuerpo base no encontrado');
          const ti = [...new Set(f.faces.slice(1).map(owner))].filter((i) => i >= 0 && i !== bi);
          if (!ti.length) throw new Error('Cuerpos herramienta no encontrados (deben ser cuerpos distintos del base)');
          let res: Shape3D = solids[bi];
          for (const i of ti) res = f.op === 'cut' ? res.cut(solids[i]) : f.op === 'intersect' ? (res.intersect(solids[i]) as Shape3D) : res.fuse(solids[i]);
          const rest = solids.filter((_, i) => i !== bi && (f.keep || !ti.includes(i)));
          shape = rest.length ? (compoundShapes([res, ...rest]) as unknown as Shape3D) : res;
          break;
        }
        case 'movebody': {
          if (!shape) throw new Error('No hay sólidos');
          const solids = ((shape as any).solids ?? [shape]) as Shape3D[];
          const sel = f.faces.length ? [...new Set(f.faces.map((p) => solids.findIndex((so) => (new FaceFinder().containsPoint(p).find(so) as any[]).length > 0)))].filter((i) => i >= 0) : solids.map((_, i) => i);
          if (!sel.length) throw new Error('Cuerpo no encontrado');
          const T: V3 = [ev(f.dx), ev(f.dy), ev(f.dz)], ang = ev(f.angle);
          const moved = sel.map((i) => { let x = solids[i].clone(); if (Math.abs(ang) > 1e-9) x = x.rotate(ang, [0, 0, 0], AXES[f.axis]); if (v3.len(T) > 1e-9) x = x.translate(T); return x; });
          const others = solids.filter((_, i) => f.copy || !sel.includes(i));
          const all = [...others, ...moved];
          shape = all.length > 1 ? (compoundShapes(all) as unknown as Shape3D) : all[0];
          break;
        }
        case 'derive': {
          if (!f.doc) throw new Error('Pieza de origen no disponible');
          const sub = await buildPart(f.doc);
          if (!sub.shape) throw new Error('La pieza de origen no tiene sólido');
          let x = sub.shape.clone();
          if (f.body != null) { const so = ((x as any).solids ?? [x]) as Shape3D[]; if (!so[f.body]) throw new Error('Cuerpo no encontrado en la pieza origen'); x = so[f.body]; }
          const k = ev(f.scale);
          if (!(k > 0)) throw new Error('Escala no válida');
          if (Math.abs(k - 1) > 1e-9) x = x.scale(k, [0, 0, 0]);
          if (f.mirror) x = x.mirror(f.mirror as any);
          ctx.tools.set(f.id, { solid: x.clone(), op: f.op });
          shape = combine(shape, x, f.op);
          break;
        }
        case 'pathpattern': {
          if (!shape) throw new Error('No hay sólido');
          const sk = ctx.sketches.get(f.path); if (!sk) throw new Error('Trayectoria no encontrada');
          const wire = (sketchPath(sk, ev).sketchOnPlane(makePlane(planeFrame(sk.plane, ev, ctx.work))) as any).wire;
          const n = Math.round(ev(f.count)); if (n < 2 || n > 400) throw new Error('Número de elementos no válido');
          const P = (u: number): V3 => { const p = wire.pointAt(u); return [p.x, p.y, p.z]; };
          const Tn = (u: number): V3 => { const p = wire.tangentAt(u); return v3.norm([p.x, p.y, p.z]); };
          const p0 = P(0), t0 = Tn(0);
          const srcs = f.features.map((id) => ctx.tools.get(id)).filter(Boolean) as { solid: Shape3D; op: BoolOp }[];
          if (!srcs.length) throw new Error('Selecciona operaciones a repetir');
          for (const src of srcs) {
            let tool: Shape3D | null = null;
            for (let i = 1; i < n; i++) {
              const u = i / (n - 1), pi = P(u);
              let c = src.solid.clone();
              if (f.align) {
                const ti = Tn(u), ax = v3.cross(t0, ti), sn = v3.len(ax), cs = v3.dot(t0, ti);
                const ang = (Math.atan2(sn, cs) * 180) / Math.PI;
                if (sn > 1e-9 && Math.abs(ang) > 1e-6) c = c.rotate(ang, p0, v3.norm(ax));
              }
              c = c.translate(v3.sub(pi, p0));
              tool = tool ? tool.fuse(c) : c;
            }
            if (tool) shape = combine(shape, tool, src.op === 'new' ? 'join' : src.op);
          }
          break;
        }
        case 'skpattern': {
          if (!shape) throw new Error('No hay sólido');
          const sk = ctx.sketches.get(f.sketch); if (!sk) throw new Error('Boceto de puntos no encontrado');
          const fr = planeFrame(sk.plane, ev, ctx.work);
          const pts = sk.entities.filter((e) => e.type === 'point' && !e.construction).map((e) => toWorld(fr, ev((e as { cx: string }).cx), ev((e as { cy: string }).cy)));
          if (pts.length < 2) throw new Error('El boceto necesita al menos dos puntos (el primero es la base)');
          const srcs = f.features.map((id) => ctx.tools.get(id)).filter(Boolean) as { solid: Shape3D; op: BoolOp }[];
          if (!srcs.length) throw new Error('Selecciona operaciones a repetir');
          for (const src of srcs) {
            let tool: Shape3D | null = null;
            for (const P of pts.slice(1)) { const c = src.solid.clone().translate(v3.sub(P, pts[0])); tool = tool ? tool.fuse(c) : c; }
            if (tool) shape = combine(shape, tool, src.op === 'new' ? 'join' : src.op);
          }
          break;
        }
        case 'sm_fold': {
          if (!ctx.sheet) throw new Error('La pieza no es de chapa');
          if (!shape) throw new Error('No hay chapa que plegar');
          const sk = ctx.sketches.get(f.sketch); if (!sk) throw new Error('Boceto no encontrado');
          const ln = (sk.entities.find((e) => e.id === f.line && e.type === 'line') ?? sk.entities.find((e) => e.type === 'line' && !e.construction)) as Extract<SkEntity, { type: 'line' }> | undefined;
          if (!ln) throw new Error('El boceto no tiene línea de plegado');
          const fr = planeFrame(sk.plane, ev, ctx.work);
          const A3 = toWorld(fr, ev(ln.a[0]), ev(ln.a[1])), B3 = toWorld(fr, ev(ln.b[0]), ev(ln.b[1]));
          if (v3.len(v3.sub(B3, A3)) < 1e-6) throw new Error('Línea de plegado de longitud nula');
          const { t, r, k } = ctx.sheet;
          const thD = ev(f.angle), th = (thD * Math.PI) / 180; if (!(th > 0 && th <= Math.PI)) throw new Error('Ángulo entre 0 y 180°');
          const M = v3.mul(v3.add(A3, B3), 0.5), h = Math.min(t / 4, 0.2);
          const inside = (c: V3) => { try { return measureVolume(shape!.clone().intersect(makeBox(v3.sub(c, [h, h, h]), v3.add(c, [h, h, h])))) > 1e-9; } catch { return false; } };
          const matPlus = inside(v3.add(M, v3.mul(fr.normal, t / 2)));
          if (!matPlus && !inside(v3.sub(M, v3.mul(fr.normal, t / 2)))) throw new Error('La línea de plegado no está sobre la chapa');
          const G = foldGeom(A3, B3, fr.normal, matPlus, t, r, k, th, f.dir, f.flip);
          const bb = shape.boundingBox.bounds, big = v3.len(v3.sub(bb[1] as V3, bb[0] as V3)) * 3 + 100;
          const half = (origin: V3) => (drawRectangle(big, big).sketchOnPlane(new Plane(origin, G.a, G.m)) as any).extrude(big) as Shape3D;
          const fixed: Shape3D = shape.clone().cut(half(G.T0));
          const moving = shape.clone().intersect(half(v3.add(G.L0, v3.mul(G.m, G.half))));
          if (measureVolume(moving) < 1e-6) throw new Error('No hay chapa al lado que se pliega (cambia «Lado que pliega»)');
          const bends: Shape3D[] = [];
          for (const fc of (fixed as any).faces as any[]) {
            try {
              if (String(fc.geomType) !== 'PLANE') continue;
              const nn = fc.normalAt(), c = fc.center; const nv: V3 = Array.isArray(nn) ? [nn[0], nn[1], nn[2]] : [nn.x, nn.y, nn.z]; const cv: V3 = Array.isArray(c) ? [c[0], c[1], c[2]] : [c.x, c.y, c.z];
              if (Math.abs(Math.abs(v3.dot(nv, G.m)) - 1) < 1e-6 && Math.abs(v3.dot(v3.sub(cv, G.T0), G.m)) < 1e-4) bends.push(revolOf(fc, G.C, G.k, thD));
            } catch { /* cara no válida */ }
          }
          if (!bends.length) throw new Error('No se encuentra la sección de la chapa en la línea de plegado');
          let res: Shape3D = fixed.fuse(moving.translate(v3.mul(G.m, -G.BA)).rotate(thD, G.C, G.k));
          for (const b of bends) res = res.fuse(b);
          shape = res;
          break;
        }
        case 'sm_bend': {
          if (!ctx.sheet) throw new Error('La pieza no es de chapa');
          const A = f.edgeA, B = f.edgeB;
          if (!A || !B) throw new Error('Selecciona las aristas de las dos caras');
          const { t, r, k } = ctx.sheet;
          const ax = v3.norm(v3.sub(A.p1, A.p0)), axB = v3.norm(v3.sub(B.p1, B.p0));
          if (Math.abs(v3.dot(ax, axB)) < 0.999) throw new Error('Las aristas deben ser paralelas');
          const X = v3.norm(A.w), Y = v3.norm(A.n);
          const to2 = (P: V3): V2 => { const d = v3.sub(P, A.p0); return [v3.dot(d, X), v3.dot(d, Y)]; };
          const d2 = (v: V3): V2 => [v3.dot(v, X), v3.dot(v, Y)];
          let b0 = to2(B.p0), nB = d2(v3.norm(B.n));
          const wB = d2(v3.norm(B.w)), wl = Math.hypot(wB[0], wB[1]);
          if (wl < 0.5) throw new Error('Las aristas deben ser perpendiculares a la sección');
          const wb: V2 = [wB[0] / wl, wB[1] / wl];
          // la cara de B elegida debe continuar la cara de A (si no, se toma la opuesta)
          if (-(-wb[1]) * nB[0] + (-wb[0]) * nB[1] < 0) { b0 = [b0[0] - nB[0] * t, b0[1] - nB[1] * t]; nB = [-nB[0], -nB[1]]; }
          const cr = 1 * wb[1] - 0 * wb[0];
          let pts: V2[];
          if (Math.abs(cr) < 1e-6) {
            if (wb[0] > -0.99) throw new Error('Caras paralelas: las aristas deben estar enfrentadas');
            if (Math.abs(b0[1]) < 1e-6) pts = [[0, 0], b0];
            else { const s4 = b0[0] / 4; if (!(s4 > 0)) throw new Error('Las aristas no están enfrentadas'); pts = [[0, 0], [s4, 0], [b0[0] - s4, b0[1]], b0]; }
          } else {
            // corte de la recta y = 0 con la recta b0 + u·wb
            const u = -b0[1] / wb[1], C: V2 = [b0[0] + u * wb[0], 0];
            if (C[0] < -1e-6 || u < -1e-6) throw new Error('Las caras no se encuentran por delante de las aristas');
            pts = [[0, 0], C, b0];
          }
          const g = contourGeometry(pts, t, r, k, 'out');
          const aA = [0, v3.len(v3.sub(A.p1, A.p0))], aB = [v3.dot(v3.sub(B.p0, A.p0), ax), v3.dot(v3.sub(B.p1, A.p0), ax)].sort((p, q) => p - q);
          const lo = Math.max(aA[0], aB[0]), hi = Math.min(aA[1], aB[1]);
          if (hi - lo < 1e-3) throw new Error('Las aristas no se solapan a lo largo');
          const N = v3.norm(v3.cross(X, Y));
          const org = v3.add(A.p0, v3.mul(ax, v3.dot(N, ax) > 0 ? lo : hi));
          const sol = (g.profile.sketchOnPlane(new Plane(org, X, N)) as any).extrude(hi - lo) as Shape3D;
          ctx.tools.set(f.id, { solid: sol.clone(), op: 'join' });
          shape = combine(shape, sol, 'join');
          break;
        }
        case 'sm_seam': {
          const fl = ctx.sheet?.flanges ?? [];
          const a = fl.find((x) => x.id === f.a), b = fl.find((x) => x.id === f.b);
          if (!a || !b) throw new Error('Elige dos pestañas');
          if (a.id === b.id) throw new Error('Elige dos pestañas distintas');
          const tol = (ctx.sheet?.t ?? 1) + 0.1, near = (P: V3, Q: V3) => v3.len(v3.sub(P, Q)) <= tol;
          if (![a.edge!.p0, a.edge!.p1].some((P) => near(P, b.edge!.p0) || near(P, b.edge!.p1))) throw new Error('Las pestañas no comparten esquina');
          break;   // el alargamiento se aplica al construir las pestañas
        }
        case 'sm_mark': {
          const sk = ctx.sketches.get(f.sketch); if (!sk) throw new Error('Boceto no encontrado');
          if (!sk.entities.some((e) => !e.construction)) throw new Error('El boceto de la marca está vacío');
          break;   // sin cambio de geometría: va al desarrollo (capa MARCADO)
        }
        case 'sm_unfold': {
          if (!ctx.sheet) throw new Error('La pieza no es de chapa');
          if (!shape) throw new Error('No hay chapa que desplegar');
          if (ctx.unfold) throw new Error('El modelo ya está desplegado');
          const i = doc.features.indexOf(f);
          const u = unfoldedSolid(doc, i);
          ctx.unfold = { folded: shape, core: u.core, from: i };
          shape = u.solid;
          break;
        }
        case 'sm_refold': {
          const u = ctx.unfold; if (!u || !u.folded) throw new Error('No hay un «Desplegar» anterior');
          const i = doc.features.indexOf(f);
          const r = refoldCuts(u.folded, u.core, doc.features.slice(u.from + 1, i).filter((x) => !x.suppressed), ctx.sketches, ctx.work);
          shape = r.shape; ctx.unfold = undefined;
          if (r.skipped.length) status[f.id] = { ok: true, error: `Cruzan un pliegue (no se aplican en la zona del pliegue): ${r.skipped.join(', ')}` };
          break;
        }
        case 'shell': {
          if (!shape) throw new Error('No hay sólido');
          const t = ev(f.thickness); if (!(t > 0)) throw new Error('Espesor no válido');
          if (!f.faces.length) throw new Error('Selecciona al menos una cara a eliminar');
          shape = shape.shell(t, ((ff: FaceFinder) => ff.either(f.faces.map((p) => (g: FaceFinder) => g.containsPoint(p)))) as any);
          break;
        }
        case 'pattern': {
          if (!shape) throw new Error('No hay sólido');
          const srcs = f.features.map((id) => ctx.tools.get(id)).filter(Boolean) as { solid: Shape3D; op: BoolOp }[];
          if (!srcs.length) throw new Error('Selecciona operaciones a repetir');
          for (const src of srcs) {
            const copies: Shape3D[] = [];
            if (f.ptype === 'rect') {
              const n1 = Math.round(ev(f.n1)), d1 = ev(f.d1), n2 = f.dir2 ? Math.round(ev(f.n2)) : 1, d2 = f.dir2 ? ev(f.d2) : 0;
              if (n1 < 1 || n2 < 1 || n1 * n2 > 400) throw new Error('Número de elementos no válido (máx. 400)');
              for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) {
                if (!i && !j) continue;
                const t = v3.add(v3.mul(AXES[f.dir1], i * d1), f.dir2 ? v3.mul(AXES[f.dir2], j * d2) : [0, 0, 0]);
                copies.push(src.solid.clone().translate(t));
              }
            } else {
              const n = Math.round(ev(f.count)), ang = ev(f.angle);
              if (n < 2 || n > 400) throw new Error('Número de elementos no válido');
              const step = Math.abs(ang - 360) < 1e-6 ? 360 / n : ang / (n - 1);
              let o: V3 = [0, 0, 0], ax: V3 = AXES[f.axis];
              if (!ax) {
                const wa = doc.features.find((x) => x.id === f.axis);
                if (!wa || wa.type !== 'workaxis') throw new Error('Eje no encontrado');
                o = wa.origin.map((x) => ev(x)) as V3; ax = v3.norm(wa.dir.map((x) => ev(x)) as V3);
              }
              for (let k = 1; k < n; k++) copies.push(src.solid.clone().rotate(step * k, o, ax));
            }
            let tool = copies[0];
            for (const c of copies.slice(1)) tool = tool.fuse(c);
            if (tool) shape = combine(shape, tool, src.op === 'new' ? 'join' : src.op);
          }
          break;
        }
        case 'mirror': {
          if (!shape) throw new Error('No hay sólido');
          if (!f.features.length) shape = shape.fuse(shape.clone().mirror(f.plane));
          else {
            for (const id of f.features) {
              const src = ctx.tools.get(id);
              if (src) shape = combine(shape, src.solid.clone().mirror(f.plane), src.op === 'new' ? 'join' : src.op);
            }
          }
          break;
        }
        default: {
          const t = bodyTool(f, ctx, shape);
          if (t) {
            ctx.tools.set(f.id, { solid: t.solid.clone(), op: t.op });
            shape = combine(shape, t.solid, t.op);
          }
        }
      }
      status[f.id] = status[f.id] ?? { ok: true };
      // caras nuevas de esta operación
      if (shape && shape !== before) { try { for (const fc of (shape as any).faces) { const k = faceSig(fc); if (k && !owners.has(k)) owners.set(k, f.id); } } catch { /* sin caras */ } }
    } catch (e) {
      status[f.id] = { ok: false, error: (e as Error)?.message || 'Error de geometría (OpenCascade)' };
    }
  }
  const surfs = [...ctx.surfaces.values()];
  return { shape, status, surfaces: surfs.length ? (surfs.length === 1 ? surfs[0] : compoundShapes(surfs) as unknown as Shape3D) : null, owners };
}

/** Desarrollo de chapa (cara base + pestañas en sus aristas). Devuelve trayectorias SVG en el plano de la cara. */
/** Desarrollo de una transición por triangulación (generatrices A[i]–B[i]); la costura está en i = 0. */
export function developTransition(A0: V3[], B0: V3[]): { outline: V2[]; lines: [V2, V2][] } {
  const N = A0.length;
  // alinear el contorno B con A: mismo sentido de recorrido y arranque más cercano
  const cA = A0.reduce((s, p) => v3.add(s, p), [0, 0, 0] as V3).map((x) => x / N) as V3;
  const cB = B0.reduce((s, p) => v3.add(s, p), [0, 0, 0] as V3).map((x) => x / N) as V3;
  const area = (P: V3[], c: V3) => P.reduce((s, p, i) => v3.add(s, v3.cross(v3.sub(p, c), v3.sub(P[(i + 1) % P.length], c))), [0, 0, 0] as V3);
  let B = [...B0];
  if (v3.dot(area(A0, cA), area(B, cB)) < 0) B = [B[0], ...B.slice(1).reverse()];
  let best = 0, bd = Infinity;
  for (let i = 0; i < N; i++) { const d = v3.len(v3.sub(v3.sub(B[i], cB), v3.sub(A0[0], cA))); if (d < bd) { bd = d; best = i; } }
  B = [...B.slice(best), ...B.slice(0, best)];
  const A = [...A0, A0[0]]; B = [...B, B[0]];
  const D = (p: V3, q: V3) => v3.len(v3.sub(p, q));
  // colocar un punto a distancias da (de p) y db (de q), en el lado contrario a «opp» (el triángulo anterior)
  const place = (p: V2, q: V2, da: number, db: number, opp: V2 | null): V2 => {
    const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1e-9;
    const a = (da * da - db * db + L * L) / (2 * L), h = Math.sqrt(Math.max(0, da * da - a * a));
    const ux = dx / L, uy = dy / L;
    const c1: V2 = [p[0] + a * ux - h * uy, p[1] + a * uy + h * ux], c2: V2 = [p[0] + a * ux + h * uy, p[1] + a * uy - h * ux];
    if (!opp) return c1;
    const side = (X: V2) => Math.sign(dx * (X[1] - p[1]) - dy * (X[0] - p[0]));
    return side(c1) !== side(opp) ? c1 : c2;
  };
  const a2: V2[] = [[0, 0]], b2: V2[] = [[0, D(A[0], B[0])]];
  let prev: V2 | null = null;
  for (let i = 0; i < N; i++) {
    // triángulos (A_i, B_i, A_i+1) y (A_i+1, B_i, B_i+1)
    a2.push(place(a2[i], b2[i], D(A[i], A[i + 1]), D(B[i], A[i + 1]), prev));
    b2.push(place(a2[i + 1], b2[i], D(A[i + 1], B[i + 1]), D(B[i], B[i + 1]), a2[i]));
    prev = b2[i];
  }
  const lines: [V2, V2][] = [];
  for (let i = 1; i < N; i++) lines.push([a2[i], b2[i]]);
  return { outline: [...a2, ...[...b2].reverse()], lines };
}

// ---------- Chapa: geometría auxiliar (plegado, rodillo, rasgadura) ----------
const rotV = (v: V3, k: V3, th: number): V3 => { const c = Math.cos(th), sn = Math.sin(th); return v3.add(v3.add(v3.mul(v, c), v3.mul(v3.cross(k, v), sn)), v3.mul(k, v3.dot(k, v) * (1 - c))); };
const rotP = (P: V3, C: V3, k: V3, th: number): V3 => v3.add(C, rotV(v3.sub(P, C), k, th));

/** Plegado por la línea A–B (eje del pliegue centrado). o = normal del boceto; matPlus = el material está del lado +o del plano del boceto. */
function foldGeom(A3: V3, B3: V3, n: V3, matPlus: boolean, t: number, R: number, K: number, th: number, dir: 'up' | 'down', flip: boolean) {
  const a = v3.norm(v3.sub(B3, A3)), o = v3.norm(n);
  const L0 = v3.add(A3, v3.mul(o, matPlus ? t : 0));                 // sobre la cara del lado o
  let m = v3.norm(v3.cross(o, a)); if (flip) m = v3.mul(m, -1);
  const BA = th * (R + K * t), half = BA / 2;
  const T0 = v3.sub(L0, v3.mul(m, half));
  const up = dir === 'up';
  const C = up ? v3.add(T0, v3.mul(o, R)) : v3.sub(T0, v3.mul(o, R + t));
  const k = v3.norm(up ? v3.cross(m, o) : v3.cross(o, m));
  return { a, o, m, L0, T0, C, k, BA, half };
}

/** Eje de un rodillo de contorno en coordenadas del boceto */
function rollAxis(sk: SketchF, axis: string, ev: Ev): { o: V2; d: V2 } {
  if (axis === 'sx') return { o: [0, 0], d: [1, 0] };
  if (axis === 'sy') return { o: [0, 0], d: [0, 1] };
  const ln = sk.entities.find((e) => e.id === axis);
  if (!ln || ln.type !== 'line') throw new Error('Eje del rodillo no encontrado');
  const A: V2 = [ev(ln.a[0]), ev(ln.a[1])], B: V2 = [ev(ln.b[0]), ev(ln.b[1])], l = Math.hypot(B[0] - A[0], B[1] - A[1]);
  if (l < 1e-9) throw new Error('Eje de longitud nula');
  return { o: A, d: [(B[0] - A[0]) / l, (B[1] - A[1]) / l] };
}
function rollGeometry(f: SmRollF, sk: SketchF, ev: Ev, t: number, R: number, K: number) {
  const ax = rollAxis(sk, f.axis, ev);
  const pts = lineChain({ ...sk, entities: sk.entities.filter((e) => e.id !== f.axis) }, ev);
  const g = contourGeometry(pts, t, R, K, f.side);
  // radio neutro medio (ponderado por longitud) para el desarrollo
  const dist = (p: V2) => Math.abs((p[0] - ax.o[0]) * ax.d[1] - (p[1] - ax.o[1]) * ax.d[0]);
  const s = f.side === 'in' ? 1 : -1;
  let sw = 0, sl = 0, conic = false;
  for (let i = 0; i + 1 < pts.length; i++) {
    const u: V2 = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]], l = Math.hypot(u[0], u[1]); if (l < 1e-9) continue;
    const un: V2 = [u[0] / l, u[1] / l], mid: V2 = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
    if (Math.abs(un[0] * ax.d[1] - un[1] * ax.d[0]) > 1e-3) conic = true;
    const od: V2 = [-un[1] * s, un[0] * s], d0 = dist(mid), outward = dist([mid[0] + od[0] * 0.01, mid[1] + od[1] * 0.01]) > d0;
    sw += (outward ? d0 + K * t : d0 - t + K * t) * l; sl += l;
  }
  const rN = sl ? sw / sl : 0;
  return { g, ax, rN, conic };
}

/** Rasgadura: rectángulos finos a lo largo de las líneas del boceto */
function ripDrawing(sk: SketchF, ev: Ev, gap: number): Drawing {
  if (!(gap > 0)) throw new Error('Holgura no válida');
  let dr: Drawing | null = null;
  for (const e of sk.entities) {
    if (e.type !== 'line' || e.construction) continue;
    const A: V2 = [ev(e.a[0]), ev(e.a[1])], B: V2 = [ev(e.b[0]), ev(e.b[1])], L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (L < 1e-6) continue;
    const x = drawRectangle(L, gap).rotate((Math.atan2(B[1] - A[1], B[0] - A[0]) * 180) / Math.PI, [0, 0]).translate((A[0] + B[0]) / 2, (A[1] + B[1]) / 2);
    dr = dr ? dr.fuse(x) : x;
  }
  if (!dr) throw new Error(`${sk.name}: dibuja las líneas de la rasgadura`);
  return dr;
}

/** Contornos 2D (en su boceto) de las operaciones que quitan material de la chapa */
function cutDrawings(f: Feature, sketches: Map<string, SketchF>, ev: Ev, work: WorkPlanes): { dr: Drawing; fr: Frame }[] {
  if (f.suppressed) return [];
  if (f.type === 'extrude' && f.op === 'cut') { const sk = sketches.get(f.profile); return sk ? [{ dr: sketchProfile(sk, ev), fr: planeFrame(sk.plane, ev, work) }] : []; }
  if (f.type === 'sm_rip') { const sk = sketches.get(f.sketch); return sk ? [{ dr: ripDrawing(sk, ev, ev(f.gap)), fr: planeFrame(sk.plane, ev, work) }] : []; }
  if (f.type === 'sm_punch') {
    const sk = sketches.get(f.sketch); if (!sk) return [];
    const pts: V2[] = sk.entities.filter((e) => e.type === 'point' && !e.construction).map((e) => [ev((e as { cx: string }).cx), ev((e as { cy: string }).cy)] as V2);
    return pts.length ? [{ dr: punchDrawing(f, ev, pts), fr: planeFrame(sk.plane, ev, work) }] : [];
  }
  if (f.type === 'hole') {
    const D = ev(f.dia); if (!(D > 0)) return [];
    let fr: Frame; const cs: V2[] = [];
    if (f.face) {
      const F = f.face, n0 = v3.norm(F.normal as V3), P = F.point as V3;
      let x = v3.cross([0, 0, 1], n0); if (v3.len(x) < 1e-6) x = [1, 0, 0]; x = v3.norm(x);
      fr = { origin: P, xDir: x, normal: n0, yDir: v3.cross(n0, x) };
      const loc = (q: V3): V2 => { const d = v3.sub(q, P); return [v3.dot(d, fr.xDir), v3.dot(d, fr.yDir)]; };
      if (F.e1 && F.e2 && F.d1 && F.d2) {
        const L = [F.e1, F.e2].map((e) => { const A = loc(e.a as V3), B = loc(e.b as V3); const u: V2 = [B[0] - A[0], B[1] - A[1]]; const l = Math.hypot(u[0], u[1]) || 1; let w: V2 = [-u[1] / l, u[0] / l]; if (-(A[0] * w[0] + A[1] * w[1]) < 0) w = [-w[0], -w[1]]; return { A, w }; });
        const dd = [ev(F.d1), ev(F.d2)];
        const [a1, b1] = L[0].w, [a2, b2] = L[1].w, r1 = dd[0] + L[0].A[0] * a1 + L[0].A[1] * b1, r2 = dd[1] + L[1].A[0] * a2 + L[1].A[1] * b2, det = a1 * b2 - a2 * b1;
        if (Math.abs(det) > 1e-9) cs.push([(r1 * b2 - r2 * b1) / det, (a1 * r2 - a2 * r1) / det]);
      } else cs.push([0, 0]);
    } else {
      const sk = sketches.get(f.sketch); if (!sk) return [];
      fr = planeFrame(sk.plane, ev, work);
      for (const e of sk.entities) if (e.type === 'point' || e.type === 'circle') cs.push([ev(e.cx), ev(e.cy)]);
    }
    let dr: Drawing | null = null;
    for (const c of cs) { const x = drawCircle(D / 2).translate(c[0], c[1]); dr = dr ? dr.fuse(x) : x; }
    return dr ? [{ dr, fr }] : [];
  }
  return [];
}

/** Lleva un dibujo en coordenadas de su boceto (marco fr) al desarrollo con la aplicación m (3D → plano) */
function mapDrawing(dr: Drawing, fr: Frame, m: (P: V3) => V2): Drawing {
  const A = m(fr.origin), X = m(v3.add(fr.origin, fr.xDir)), Y = m(v3.add(fr.origin, fr.yDir));
  const bx: V2 = [X[0] - A[0], X[1] - A[1]], by: V2 = [Y[0] - A[0], Y[1] - A[1]];
  let d2 = dr;
  if (bx[0] * by[1] - bx[1] * by[0] < 0) d2 = d2.mirror([1, 0], [0, 0], 'plane');   // simetría respecto al eje X (y → −y)
  return d2.rotate((Math.atan2(bx[1], bx[0]) * 180) / Math.PI, [0, 0]).translate(A[0], A[1]);
}

interface Panel { p0: V3; ax: V3; iE: V3; d: V3; nF: V3; L: number; BA: number; pf: V2; eF: V2; uF: V2; region: V2[] }
export interface FlatCore {
  t: number; r: number; k: number; ev: Ev; work: WorkPlanes; sketches: Map<string, SketchF>;
  base: { fr: Frame; prof: Drawing } | null;
  flat: Drawing; bends: { a: V2; b: V2; label: string }[]; panels: Panel[]; bendStrips: V2[][]; foldZones: V2[][]; notes: string[];
  mapOf: (fr: Frame) => ((P: V3) => V2) | null;
}
/** Plano 3D de un tramo plano (pestaña o lado plegado) cuyas coordenadas 2D son las del desarrollo */
function panelPlane(pn: Panel, shift: number): Plane {
  const X = v3.add(v3.mul(pn.ax, pn.eF[0]), v3.mul(pn.d, pn.uF[0])), Y = v3.add(v3.mul(pn.ax, pn.eF[1]), v3.mul(pn.d, pn.uF[1]));
  const N = v3.norm(v3.cross(X, Y));
  const O = v3.sub(v3.sub(pn.iE, v3.mul(pn.ax, pn.pf[0] * pn.eF[0] + pn.pf[1] * pn.eF[1])), v3.mul(pn.d, pn.pf[0] * pn.uF[0] + pn.pf[1] * pn.uF[1] + pn.BA));
  return new Plane(v3.add(O, v3.mul(N, shift)), X, N);
}
const BIG = 1e5;

/** Desarrollo base: cara base, pestañas (sobre la base o sobre otras pestañas), plegados, pestaña de contorno, rodillo y pestaña solevada. */
export function flatCore(doc: PartDoc): FlatCore {
  if (!doc.sheet) throw new Error('La pieza no es de chapa');
  const ev = makeEval(docParams(doc));
  const sh = sheetCtx(doc, ev)!;
  const { t, r, k } = sh;
  const work: WorkPlanes = new Map();
  const sketches = new Map<string, SketchF>();
  let base: { fr: Frame; prof: Drawing } | null = null;
  const bends: { a: V2; b: V2; label: string }[] = [];
  let flat: Drawing | null = null;
  const sk3 = new Map<string, Sketch3dF>();
  const notes: string[] = [];
  const panels: Panel[] = [], bendStrips: V2[][] = [], foldZones: V2[][] = [];
  const toB = (P: V3): V2 => { const d = v3.sub(P, base!.fr.origin); return [v3.dot(d, base!.fr.xDir), v3.dot(d, base!.fr.yDir)]; };
  const dirB = (v: V3): V2 => [v3.dot(v, base!.fr.xDir), v3.dot(v, base!.fr.yDir)];
  const deg = (x: number) => Math.round((x * 180) / Math.PI);
  let unfolded = false;
  for (const f of doc.features) {
    if (f.suppressed) continue;
    if (f.type === 'sm_unfold') { unfolded = true; continue; }
    if (f.type === 'sm_refold') { unfolded = false; continue; }
    if (f.type === 'sketch') sketches.set(f.id, f);
    if (f.type === 'sketch3d') sk3.set(f.id, f);
    if (f.type === 'workplane' || f.type === 'workpoint' || f.type === 'workaxis') registerAux(work, f, ev);
    if (unfolded) continue;
    if (f.type === 'sm_loft' && !base && !flat) {
      const wire = (id: string) => { const a = sk3.get(id); if (a) return wire3d(a, ev); const sk = sketches.get(id); if (!sk) throw new Error('Boceto no encontrado'); return (sketchProfile(sk, ev, true).sketchOnPlane(makePlane(planeFrame(sk.plane, ev, work))) as any).wire; };
      const N = Math.max(8, Math.min(200, Math.round(ev(f.segments) || 24)));
      // costura en el centro del primer lado del contorno 1 (no en una esquina)
      const wa = wire(f.a), es = wa.edges as any[], tot = es.reduce((t: number, e: any) => t + e.length, 0);
      const k0 = Math.floor(Math.max(1, Math.round((N * es[0].length) / tot)) / 2) % N;
      const SA = sampleClosed(wa, N), A = [...SA.slice(k0), ...SA.slice(0, k0)];
      const dev = developTransition(A, sampleClosed(wire(f.b), N));
      flat = polyDrawing(dev.outline);
      for (const [a, b] of dev.lines) bends.push({ a, b, label: '' });
      continue;
    }
    if ((f.type === 'sm_contour' || f.type === 'sm_roll') && !base && !flat) {
      const sk = sketches.get(f.profile); if (!sk) continue;
      let W: number, g: ReturnType<typeof contourGeometry>;
      if (f.type === 'sm_contour') { W = ev(f.width); g = contourGeometry(lineChain(sk, ev), t, r, k, f.side); }
      else {
        const rg = rollGeometry(f, sk, ev, t, r, k); g = rg.g; W = (ev(f.angle) * Math.PI / 180) * rg.rN;
        if (rg.conic) notes.push(`${f.name}: tramos cónicos; desarrollo aproximado con el radio neutro medio (R ${Math.round(rg.rN * 10) / 10})`);
      }
      flat = polyDrawing([[0, 0], [g.flatLength, 0], [g.flatLength, W], [0, W]]);
      for (const b of g.flatBends) bends.push({ a: [b.x, 0], b: [b.x, W], label: `${b.up ? 'ARRIBA' : 'ABAJO'} ${deg(b.angle)}° R${r}` });
      if (f.type === 'sm_roll') bends.push({ a: [0, W / 2], b: [g.flatLength, W / 2], label: `ROLAR ${Math.round(ev(f.angle))}° Rn ${Math.round(rollGeometry(f, sk, ev, t, r, k).rN * 10) / 10}` });
      continue;
    }
    if (f.type === 'sm_face' && base) { notes.push(`${f.name}: solo se desarrolla la primera cara base`); continue; }
    if (f.type === 'sm_bend') { notes.push(`${f.name}: el pliegue entre caras no se desarrolla`); continue; }
    if (f.type === 'sm_face' && !base) {
      const sk = sketches.get(f.profile); if (!sk) continue;
      base = { fr: planeFrame(sk.plane, ev, work), prof: sketchProfile(sk, ev) };
      flat = base.prof;
    }
    if (f.type === 'sm_fold' && base) {
      const sk = sketches.get(f.sketch); if (!sk) continue;
      const ln = (sk.entities.find((e) => e.id === f.line && e.type === 'line') ?? sk.entities.find((e) => e.type === 'line')) as Extract<SkEntity, { type: 'line' }> | undefined; if (!ln) continue;
      const fr = planeFrame(sk.plane, ev, work), bf = base.fr;
      const sgn = v3.dot(fr.normal, bf.normal), dn = v3.dot(v3.sub(fr.origin, bf.origin), bf.normal);
      const inMat = (x: number) => x > 0 && x < t;
      const matPlus = inMat(dn + sgn * t / 2);
      if (Math.abs(Math.abs(sgn) - 1) > 1e-3 || (!matPlus && !inMat(dn - sgn * t / 2))) { notes.push(`${f.name}: solo se desarrolla el plegado sobre la cara base`); continue; }
      const A3 = toWorld(fr, ev(ln.a[0]), ev(ln.a[1])), B3 = toWorld(fr, ev(ln.b[0]), ev(ln.b[1]));
      const th = (ev(f.angle) * Math.PI) / 180;
      const G = foldGeom(A3, B3, fr.normal, matPlus, t, r, k, th, f.dir, f.flip);
      const pf = toB(G.T0), eF = dirB(G.a), uF = dirB(G.m);
      const d = rotV(G.m, G.k, th);
      const at = (p: V2, e: number, u: number): V2 => [p[0] + eF[0] * e + uF[0] * u, p[1] + eF[1] * e + uF[1] * u];
      panels.push({ p0: G.T0, ax: G.a, iE: rotP(G.T0, G.C, G.k, th), d, nF: v3.norm(v3.cross(G.a, d)), L: 1e6, BA: G.BA, pf, eF, uF, region: [at(pf, -BIG, G.BA), at(pf, BIG, G.BA), at(pf, BIG, G.BA + BIG), at(pf, -BIG, G.BA + BIG)] });
      bendStrips.push([at(pf, -BIG, 0), at(pf, BIG, 0), at(pf, BIG, G.BA), at(pf, -BIG, G.BA)]);
      foldZones.push([at(pf, -BIG, 0), at(pf, BIG, 0), at(pf, BIG, BIG), at(pf, -BIG, BIG)]);
      bends.push({ a: toB(A3), b: toB(B3), label: `${f.dir === 'up' ? 'ARRIBA' : 'ABAJO'} ${deg(th)}° R${r}` });
      continue;
    }
    if (f.type === 'sm_flange' && base && f.edge) {
      const th = (ev(f.angle) * Math.PI) / 180, L = ev(f.length);
      const BA = th * (r + k * t);
      // misma orientación de la arista que en flangeSolid
      const { p0, p1, ext0, ext1 } = flangeEnds(f, sh);
      const n3 = v3.norm(f.edge.n), w3 = v3.norm(f.edge.w);
      // ¿sobre qué tramo plano está la arista? la cara base o una pestaña / lado plegado anterior
      const fr = base.fr, tol = t + 0.05;
      let toFlat: ((P: V3) => V2) | null = null, dirFlat: ((v: V3) => V2) | null = null;
      if (Math.abs(v3.dot(v3.sub(p0, fr.origin), fr.normal)) <= tol && Math.abs(v3.dot(v3.sub(p1, fr.origin), fr.normal)) <= tol && Math.abs(v3.dot(w3, fr.normal)) < 0.2) {
        toFlat = toB; dirFlat = dirB;
      } else {
        for (const pn of [...panels].reverse()) {
          const on = (P: V3) => { const sAlong = v3.dot(v3.sub(P, pn.iE), pn.d), off = v3.dot(v3.sub(P, pn.iE), pn.nF); return sAlong > -0.05 && sAlong < pn.L + tol && Math.abs(off) <= tol; };
          if (on(p0) && on(p1) && Math.abs(v3.dot(w3, pn.nF)) < 0.2) {
            toFlat = (P) => { const a = v3.dot(v3.sub(P, pn.p0), pn.ax), sA = Math.min(pn.L, Math.max(0, v3.dot(v3.sub(P, pn.iE), pn.d))); return [pn.pf[0] + pn.eF[0] * a + pn.uF[0] * (pn.BA + sA), pn.pf[1] + pn.eF[1] * a + pn.uF[1] * (pn.BA + sA)]; };
            dirFlat = (v) => { const a = v3.dot(v, pn.ax), b2 = v3.dot(v, pn.d); return [pn.eF[0] * a + pn.uF[0] * b2, pn.eF[1] * a + pn.uF[1] * b2]; };
            break;
          }
        }
      }
      if (!toFlat || !dirFlat) throw new Error(`${f.name}: la arista no está sobre la cara base ni sobre una pestaña anterior`);
      const q0 = toFlat(p0), q1 = toFlat(p1);
      const e2: V2 = [q1[0] - q0[0], q1[1] - q0[1]], el = Math.hypot(e2[0], e2[1]) || 1;
      const eF: V2 = [e2[0] / el, e2[1] / el];
      let wv = dirFlat(w3); const along = wv[0] * eF[0] + wv[1] * eF[1]; wv = [wv[0] - eF[0] * along, wv[1] - eF[1] * along];
      const wl = Math.hypot(wv[0], wv[1]);
      if (wl < 0.3) throw new Error(`${f.name}: dirección de la pestaña no válida para el desarrollo`);
      const u: V2 = [wv[0] / wl, wv[1] / wl], ext = BA + L;
      const q = (p: V2, s2: number, e = 0): V2 => [p[0] + u[0] * s2 + eF[0] * e, p[1] + u[1] * s2 + eF[1] * e];
      const straight = [q(q0, BA, -ext0), q(q1, BA, ext1), q(q1, ext, ext1), q(q0, ext, -ext0)];
      flat = ext0 || ext1 ? flat!.fuse(polyDrawing([q0, q1, q(q1, BA), q(q0, BA)])).fuse(polyDrawing(straight)) : flat!.fuse(polyDrawing([q0, q1, q(q1, ext), q(q0, ext)]));
      bends.push({ a: q(q0, BA / 2), b: q(q1, BA / 2), label: `${f.dir === 'up' ? 'ARRIBA' : 'ABAJO'} ${deg(th)}° R${r}` });
      bendStrips.push([q0, q1, q(q1, BA), q(q0, BA)]);
      // tramo plano de esta pestaña en 3D (como en flangeSolid) para las pestañas que cuelguen de ella
      const sg = f.dir === 'down' ? -1 : 1;
      const iEx = r * Math.sin(th), iEy = f.dir === 'down' ? -t - (r - r * Math.cos(th)) : r - r * Math.cos(th);
      const iE = v3.add(p0, v3.add(v3.mul(w3, iEx), v3.mul(n3, iEy)));
      const d3 = v3.norm(v3.add(v3.mul(w3, Math.cos(th)), v3.mul(n3, sg * Math.sin(th))));
      const ax = v3.norm(v3.sub(p1, p0));
      panels.push({ p0, ax, iE, d: d3, nF: v3.norm(v3.cross(ax, d3)), L, BA, pf: q0, eF, uF: u, region: straight });
    }
  }
  if (!flat) throw new Error('No hay cara base de chapa');
  const tolP = t + 0.05;
  const mapOf = (fr: Frame): ((P: V3) => V2) | null => {
    if (!base) return null;
    const bf = base.fr;
    if (Math.abs(Math.abs(v3.dot(fr.normal, bf.normal)) - 1) < 1e-3 && Math.abs(v3.dot(v3.sub(fr.origin, bf.origin), bf.normal)) <= tolP + 1e-6) return toB;
    for (const pn of panels) if (Math.abs(Math.abs(v3.dot(fr.normal, pn.nF)) - 1) < 1e-3 && Math.abs(v3.dot(v3.sub(fr.origin, pn.iE), pn.nF)) <= tolP + 1e-6)
      return (P) => { const a = v3.dot(v3.sub(P, pn.p0), pn.ax), sA = v3.dot(v3.sub(P, pn.iE), pn.d); return [pn.pf[0] + pn.eF[0] * a + pn.uF[0] * (pn.BA + sA), pn.pf[1] + pn.eF[1] * a + pn.uF[1] * (pn.BA + sA)]; };
    return null;
  };
  return { t, r, k, ev, work, sketches, base, flat, bends, panels, bendStrips, foldZones, notes, mapOf };
}

/** Desarrollo con los cortes, agujeros, punzonados y rasgaduras que caen en tramos planos */
function flatWithCuts(core: FlatCore, doc: PartDoc, upTo = doc.features.length): { flat: Drawing; skipped: string[] } {
  let flat = core.flat;
  const skipped: string[] = [];
  if (!core.base) return { flat, skipped };
  for (const f of doc.features.slice(0, upTo)) {
    try {
      for (const { dr, fr } of cutDrawings(f, core.sketches, core.ev, core.work)) {
        const m = core.mapOf(fr);
        if (!m) { skipped.push(f.name); continue; }
        try { flat = flat.cut(mapDrawing(dr, fr, m)); } catch { skipped.push(f.name); }
      }
    } catch { skipped.push(f.name); }
  }
  return { flat, skipped };
}

export function flatPattern(doc: PartDoc) {
  const core = flatCore(doc);
  const { t, r, k, ev } = core;
  const { flat: flat0, skipped } = flatWithCuts(core, doc);
  let flat = flat0;
  const notes = [...core.notes];
  if (skipped.length) notes.push(`No se llevan al desarrollo (no están en un tramo plano): ${[...new Set(skipped)].join(', ')}`);
  // Marcas: geometría de boceto que va al desarrollo sin cortar
  const marks: V2[][] = [];
  for (const f of doc.features) {
    if (f.suppressed || f.type !== 'sm_mark') continue;
    const sk = core.sketches.get(f.sketch); if (!sk) continue;
    const fr = planeFrame(sk.plane, ev, core.work), m = core.mapOf(fr);
    if (!m) { notes.push(`${f.name}: la marca no está en un tramo plano`); continue; }
    const P = (p: V2): V2 => m(toWorld(fr, p[0], p[1]));
    for (const e of sk.entities) {
      if (e.construction) continue;
      try {
        if (e.type === 'text') {
          const d = drawText(e.text || ' ', { startX: 0, startY: 0, fontSize: ev(e.size), fontFamily: 'DejaVu' }).rotate(ev(e.rot), [0, 0]).translate(ev(e.x), ev(e.y));
          const sv = d.toSVGPaths() as unknown; const paths = (Array.isArray((sv as unknown[])[0]) ? (sv as string[][]).flat() : sv) as string[];
          for (const pth of paths) for (const pl of flattenPath(pth)) marks.push(pl.map(([x, y]) => P([x, y])));
        } else if (e.type !== 'point') {
          const o = entityOutline(e, ev); if (o.pts.length < 2) continue;
          marks.push((o.closed ? [...o.pts, o.pts[0]] : o.pts).map(P));
        }
      } catch { /* entidad sin contorno */ }
    }
  }
  let bends = core.bends;
  // Cara A: el desarrollo se ve desde la cara A (si es la opuesta a la del boceto base, se refleja)
  if (doc.sheet?.aSide && core.base && v3.dot(doc.sheet.aSide as V3, core.base.fr.normal) < 0) {
    const fy = (p: V2): V2 => [p[0], -p[1]];
    flat = flat.mirror([1, 0], [0, 0], 'plane');
    bends = bends.map((b) => ({ a: fy(b.a), b: fy(b.b), label: b.label.replace(/^ARRIBA/, '§').replace(/^ABAJO/, 'ARRIBA').replace(/^§/, 'ABAJO') }));
    for (let i = 0; i < marks.length; i++) marks[i] = marks[i].map(fy);
  }
  const paths = flat.toSVGPaths();
  return { paths: (Array.isArray(paths[0]) ? (paths as string[][]).flat() : paths) as string[], bends, t, r, k, notes, marks };
}

/** Desplegar: chapa plana sobre la cara base con los cortes hechos hasta ahora */
export function unfoldedSolid(doc: PartDoc, upTo: number): { solid: Shape3D; core: FlatCore } {
  const sub = { ...doc, features: doc.features.slice(0, upTo) };
  const core = flatCore(sub);
  if (!core.base) throw new Error('Desplegar necesita una cara base (Cara)');
  const { flat } = flatWithCuts(core, sub);
  return { solid: (flat.sketchOnPlane(makePlane(core.base.fr)) as any).extrude(core.t) as Shape3D, core };
}

/** Volver a plegar: los cortes hechos sobre el desarrollo se llevan a la cara base y a los tramos planos plegados */
export function refoldCuts(folded: Shape3D, core: FlatCore, feats: Feature[], sketches: Map<string, SketchF>, work: WorkPlanes): { shape: Shape3D; skipped: string[] } {
  let shape = folded;
  const skipped: string[] = [];
  const { t } = core, bf = core.base!.fr;
  let baseReg = core.base!.prof;
  for (const z of core.foldZones) { try { baseReg = baseReg.cut(polyDrawing(z)); } catch { /* */ } }
  const has = (d: Drawing) => { try { return d.toSVGPaths().length > 0; } catch { return false; } };
  for (const f of feats) {
    let list: { dr: Drawing; fr: Frame }[] = [];
    try { list = cutDrawings(f, sketches, core.ev, work); } catch { skipped.push(f.name); continue; }
    for (const { dr, fr } of list) {
      const m = core.mapOf(fr);
      if (!m) { skipped.push(f.name); continue; }
      const d2 = mapDrawing(dr, fr, m);
      try { const db = d2.intersect(baseReg); if (has(db)) shape = shape.cut((db.sketchOnPlane(makePlane(bf, -1)) as any).extrude(t + 2)); } catch { /* fuera de la base */ }
      for (const pn of core.panels) {
        try { const dp = d2.intersect(polyDrawing(pn.region)); if (has(dp)) shape = shape.cut((dp.sketchOnPlane(panelPlane(pn, -(t + 1))) as any).extrude(2 * t + 2)); } catch { /* fuera del tramo */ }
      }
      for (const bs of core.bendStrips) { try { if (has(d2.intersect(polyDrawing(bs)))) skipped.push(f.name); } catch { /* */ } }
    }
  }
  return { shape, skipped: [...new Set(skipped)] };
}
