// Reconstrucción de piezas (incluida chapa) sobre OpenCascade vía replicad.
import {
  Plane, draw, drawRectangle, drawCircle, drawEllipse, drawText, loadFont, importSTEP, compoundShapes, genericSweep, makeHelix, FaceFinder, getOC, cast, measureShapeVolumeProperties,
} from 'replicad';
import { openSegments, findLoops, loopPolyline, polyArea, pointInPoly, type Seg } from '../core/sketch';
import type { Drawing, Shape3D, EdgeFinder } from 'replicad';
import { makeEval } from '../core/expr';
import {
  docParams, planeFrame, entityOutline, npolyPoints, toWorld, v3, workPlaneFrame, splineBeziers,
  type PartDoc, type SkEntity, type SketchF, type Feature, type EdgeSel, type Frame, type V3, type V2,
  type WorkPlanes, type BoolOp, type SmFlangeF,
} from '../core/doc';

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
  sheet: { t: number; r: number; k: number } | null;
}

/** Sólido herramienta de un agujero (revolución de la media sección) en un punto. */
function holeTool(f: Extract<Feature, { type: 'hole' }>, P: V3, n: V3, ev: Ev, through: number): Shape3D {
  const d = ev(f.dia);
  if (!(d > 0)) throw new Error('Diámetro no válido');
  const L = f.through ? through : ev(f.depth);
  if (!(L > 0)) throw new Error('Profundidad no válida');
  const e = 0.05;
  const pts: V2[] = [[0, e]];
  if (f.kind === 'cbore') {
    const cb = ev(f.cbDia) / 2, cbd = ev(f.cbDepth);
    if (!(cb * 2 > d && cbd > 0)) throw new Error('Refrentado mayor que el taladro');
    pts.push([cb, e], [cb, -cbd], [d / 2, -cbd]);
  } else if (f.kind === 'csink') {
    const cs = ev(f.csDia) / 2, ang = ev(f.csAngle);
    if (!(cs * 2 > d)) throw new Error('Avellanado mayor que el taladro');
    const depth = (cs - d / 2) / Math.tan((ang * Math.PI) / 360);
    pts.push([cs, e], [cs, 0], [d / 2, -depth]);
  } else pts.push([d / 2, e]);
  pts.push([d / 2, -L]);
  // Punta de broca a 118° en agujeros ciegos
  if (!f.through) pts.push([0, -L - (d / 2) / Math.tan((59 * Math.PI) / 180)]); else pts.push([0, -L]);
  let u = v3.cross(n, [0, 0, 1]); if (v3.len(u) < 1e-6) u = v3.cross(n, [1, 0, 0]);
  u = v3.norm(u);
  const pl = new Plane(P, u, v3.cross(u, n));
  return (polyDrawing(pts).sketchOnPlane(pl) as any).revolve(n, { origin: P });
}

function flangeSolid(f: SmFlangeF, sh: { t: number; r: number }, ev: Ev): Shape3D {
  if (!f.edge) throw new Error('Selecciona la arista de la pestaña');
  const { t, r } = sh;
  const L = ev(f.length), th = (ev(f.angle) * Math.PI) / 180;
  if (!(L > 0)) throw new Error('Longitud no válida');
  if (!(th > 0 && th <= Math.PI)) throw new Error('Ángulo entre 0 y 180°');
  let { p0, p1 } = f.edge;
  const n = v3.norm(f.edge.n), w = v3.norm(f.edge.w);
  let ax = v3.cross(w, n);
  if (v3.dot(ax, v3.sub(p1, p0)) < 0) { [p0, p1] = [p1, p0]; }
  ax = v3.norm(v3.sub(p1, p0));
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
  // Pequeño solape con la chapa base para que la unión sea sólida
  return (dr.sketchOnPlane(pl) as any).extrude(len);
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
      if (!shape) throw new Error('No hay sólido');
      const d = ev(f.distance); if (!(Math.abs(d) > 1e-6)) throw new Error('Distancia no válida');
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
      const sk = getSk(f.sketch);
      const fr = planeFrame(sk.plane, ev, work);
      const centers: V2[] = [];
      for (const e of sk.entities) {
        if (e.type === 'point') centers.push([ev(e.cx), ev(e.cy)]);
        else if (e.type === 'circle') centers.push([ev(e.cx), ev(e.cy)]);
      }
      if (!centers.length) throw new Error(`${sk.name} no tiene puntos para los agujeros`);
      let through = 1000;
      if (shape) { const b = shape.boundingBox.bounds; through = v3.len(v3.sub(b[1] as V3, b[0] as V3)) * 2 + 10; }
      let tool: Shape3D | null = null;
      for (const c of centers) {
        const t = holeTool(f, toWorld(fr, c[0], c[1]), fr.normal, ev, through);
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
      const skP = getSk(f.profile), skT = getSk(f.path);
      const prof = (sketchProfile(skP, ev, true).sketchOnPlane(makePlane(planeFrame(skP.plane, ev, work))) as any);
      const path = (sketchPath(skT, ev).sketchOnPlane(makePlane(planeFrame(skT.plane, ev, work))) as any);
      const solid = genericSweep(prof.wire, path.wire, { frenet: true, transitionMode: 'round' }, false);
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
    case 'sm_punch': {
      const sk = getSk(f.sketch), fr = planeFrame(sk.plane, ev, work);
      const pts: V2[] = [];
      for (const e of sk.entities) { if (e.type === 'point' && !e.construction) pts.push([ev(e.cx), ev(e.cy)]); }
      if (!pts.length) throw new Error(`${sk.name}: coloca puntos de boceto como centros de punzonado`);
      const d = ev(f.d), w = ev(f.w), h = ev(f.h), rot = ev(f.rot);
      const one = (): Drawing => {
        switch (f.shape) {
          case 'round': if (!(d > 0)) throw new Error('Diámetro no válido'); return drawCircle(d / 2);
          case 'square': if (!(w > 0)) throw new Error('Lado no válido'); return drawRectangle(w, w);
          case 'rect': if (!(w > 0 && h > 0)) throw new Error('Medidas no válidas'); return drawRectangle(w, h);
          case 'slot': { if (!(w > h && h > 0)) throw new Error('Ranura: longitud mayor que anchura'); const L = w - h; return draw([-L / 2, -h / 2]).lineTo([L / 2, -h / 2]).threePointsArcTo([L / 2, h / 2], [L / 2 + h / 2, 0]).lineTo([-L / 2, h / 2]).threePointsArcTo([-L / 2, -h / 2], [-L / 2 - h / 2, 0]).close(); }
        }
      };
      let dr: Drawing | null = null;
      for (const p of pts) { const x = one().rotate(rot, [0, 0]).translate(p[0], p[1]); dr = dr ? dr.fuse(x) : x; }
      let L = 1000; if (shape) { const b = shape.boundingBox.bounds; L = v3.len(v3.sub(b[1] as V3, b[0] as V3)) * 2 + 10; }
      return { solid: (dr!.sketchOnPlane(makePlane(fr, -L / 2)) as any).extrude(L), op: 'cut' };
    }
    default: return null;
  }
}

export interface PartBuild { shape: Shape3D | null; status: Record<string, FeatStatus> }

export async function buildPart(doc: PartDoc, upTo?: number): Promise<PartBuild> {
  const ev = makeEval(docParams(doc));
  const status: Record<string, FeatStatus> = {};
  const ctx: Ctx = {
    ev, sketches: new Map(), work: new Map(), tools: new Map(),
    sheet: doc.sheet ? { t: ev(doc.sheet.t), r: ev(doc.sheet.r), k: ev(doc.sheet.k) } : null,
  };
  let shape: Shape3D | null = null;
  const feats = upTo !== undefined ? doc.features.slice(0, upTo) : doc.features;
  for (const f of feats) {
    if (f.suppressed) { status[f.id] = { ok: true }; continue; }
    try {
      switch (f.type) {
        case 'sketch':
          for (const e of f.entities) entityOutline(e, ev);
          planeFrame(f.plane, ev, ctx.work);
          ctx.sketches.set(f.id, f);
          break;
        case 'workplane':
          ctx.work.set(f.id, workPlaneFrame(f, ev, ctx.work));
          break;
        case 'import': {
          const s = (await importSTEP(new Blob([f.step]))) as Shape3D;
          shape = shape ? shape.fuse(s) : s;
          break;
        }
        case 'fillet': {
          if (!shape) throw new Error('No hay sólido');
          const r = ev(f.radius); if (!(r > 0)) throw new Error('Radio no válido');
          shape = shape.fillet(r, edgeFilter(f.edges) as any);
          break;
        }
        case 'chamfer': {
          if (!shape) throw new Error('No hay sólido');
          const r = ev(f.distance); if (!(r > 0)) throw new Error('Distancia no válida');
          shape = shape.chamfer(r, edgeFilter(f.edges) as any);
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
        case 'workaxis': case 'workpoint': break;
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
      status[f.id] = { ok: true };
    } catch (e) {
      status[f.id] = { ok: false, error: (e as Error)?.message || 'Error de geometría (OpenCascade)' };
    }
  }
  return { shape, status };
}

/** Desarrollo de chapa (cara base + pestañas en sus aristas). Devuelve trayectorias SVG en el plano de la cara. */
export function flatPattern(doc: PartDoc) {
  if (!doc.sheet) throw new Error('La pieza no es de chapa');
  const ev = makeEval(docParams(doc));
  const t = ev(doc.sheet.t), r = ev(doc.sheet.r), k = ev(doc.sheet.k);
  const work: WorkPlanes = new Map();
  const sketches = new Map<string, SketchF>();
  let base: { fr: Frame; prof: Drawing } | null = null;
  const bends: { a: V2; b: V2; label: string }[] = [];
  let flat: Drawing | null = null;
  for (const f of doc.features) {
    if (f.suppressed) continue;
    if (f.type === 'sketch') sketches.set(f.id, f);
    if (f.type === 'workplane') work.set(f.id, workPlaneFrame(f, ev, work));
    if (f.type === 'sm_contour' && !base && !flat) {
      const sk = sketches.get(f.profile); if (!sk) continue;
      const W = ev(f.width);
      const g = contourGeometry(lineChain(sk, ev), t, r, k, f.side);
      flat = polyDrawing([[0, 0], [g.flatLength, 0], [g.flatLength, W], [0, W]]);
      for (const b of g.flatBends) bends.push({ a: [b.x, 0], b: [b.x, W], label: `${b.up ? 'ARRIBA' : 'ABAJO'} ${Math.round((b.angle * 180) / Math.PI)}° R${r}` });
      continue;
    }
    if (f.type === 'sm_face' && !base) {
      const sk = sketches.get(f.profile); if (!sk) continue;
      base = { fr: planeFrame(sk.plane, ev, work), prof: sketchProfile(sk, ev) };
      flat = base.prof;
    }
    if (f.type === 'sm_flange' && base && f.edge) {
      const th = (ev(f.angle) * Math.PI) / 180, L = ev(f.length);
      const BA = th * (r + k * t);
      const fr = base.fr;
      const loc = (p: V3): V2 => { const d = v3.sub(p, fr.origin); return [v3.dot(d, fr.xDir), v3.dot(d, fr.yDir)]; };
      const p0 = loc(f.edge.p0), p1 = loc(f.edge.p1);
      const w: V2 = [v3.dot(f.edge.w, fr.xDir), v3.dot(f.edge.w, fr.yDir)];
      const wl = Math.hypot(w[0], w[1]);
      if (wl < 0.5) throw new Error(`${f.name}: solo se desarrollan pestañas sobre aristas de la cara base`);
      const u: V2 = [w[0] / wl, w[1] / wl], ext = BA + L;
      const q = (p: V2, s: number): V2 => [p[0] + u[0] * s, p[1] + u[1] * s];
      flat = flat!.fuse(polyDrawing([p0, p1, q(p1, ext), q(p0, ext)]));
      bends.push({ a: q(p0, BA / 2), b: q(p1, BA / 2), label: `${f.dir === 'up' ? 'ARRIBA' : 'ABAJO'} ${Math.round((th * 180) / Math.PI)}° R${r}` });
    }
  }
  if (!flat) throw new Error('No hay cara base de chapa');
  const paths = flat.toSVGPaths();
  return { paths: (Array.isArray(paths[0]) ? (paths as string[][]).flat() : paths) as string[], bends, t, r, k };
}
