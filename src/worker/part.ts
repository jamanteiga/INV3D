// Reconstrucción de piezas (incluida chapa) sobre OpenCascade vía replicad.
import {
  Plane, draw, drawRectangle, drawCircle, importSTEP, compoundShapes, genericSweep,
} from 'replicad';
import type { Drawing, Shape3D, EdgeFinder, FaceFinder } from 'replicad';
import { makeEval } from '../core/expr';
import {
  planeFrame, entityArea, entityOutline, npolyPoints, slotPoints, toWorld, v3, workPlaneFrame,
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
    default: return null;
  }
}

/** Perfil de un boceto: une contornos y resta los que quedan dentro de otros (islas/taladros). */
export function sketchProfile(sk: SketchF, ev: Ev, outerOnly = false): Drawing {
  const closed = sk.entities.filter((e) => e.type === 'rect' || e.type === 'circle' || e.type === 'poly' || e.type === 'npoly' || e.type === 'slot')
    .map((e) => {
      const o = entityOutline(e, ev);
      const xs = o.pts.map((p) => p[0]), ys = o.pts.map((p) => p[1]);
      return { e, area: entityArea(e, ev), bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    })
    .sort((a, b) => b.area - a.area);
  if (!closed.length) throw new Error(`${sk.name} no tiene perfiles cerrados`);
  if (outerOnly) return entityDrawing(closed[0].e, ev)!;
  let result: Drawing | null = null;
  const placed: { bb: number[] }[] = [];
  for (const c of closed) {
    const d = entityDrawing(c.e, ev)!;
    const inside = placed.filter((p) => c.bb[0] >= p.bb[0] - 1e-6 && c.bb[1] >= p.bb[1] - 1e-6 && c.bb[2] <= p.bb[2] + 1e-6 && c.bb[3] <= p.bb[3] + 1e-6);
    const hole = inside.length % 2 === 1;
    result = result ? (hole ? result.cut(d) : result.fuse(d)) : d;
    placed.push({ bb: c.bb });
  }
  return result!;
}

/** Trayectoria abierta (líneas y arcos encadenados) de un boceto, para barridos. */
function sketchPath(sk: SketchF, ev: Ev): Drawing {
  type Seg = { a: V2; b: V2; mid?: V2 };
  const segs: Seg[] = [];
  for (const e of sk.entities) {
    if (e.type === 'line') segs.push({ a: [ev(e.a[0]), ev(e.a[1])], b: [ev(e.b[0]), ev(e.b[1])] });
    else if (e.type === 'arc') {
      const cx = ev(e.cx), cy = ev(e.cy), r = ev(e.r), a0 = ev(e.a0), a1 = ev(e.a1);
      let sw = a1 - a0; while (sw <= 0) sw += 360;
      const P = (deg: number): V2 => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
      segs.push({ a: P(a0), b: P(a0 + sw), mid: P(a0 + sw / 2) });
    }
  }
  if (!segs.length) throw new Error(`${sk.name} no tiene líneas ni arcos para la trayectoria`);
  const near = (p: V2, q: V2) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-4;
  // Encadenar a partir de un extremo libre
  const ends = (p: V2) => segs.filter((s) => near(s.a, p) || near(s.b, p)).length;
  let start = segs.find((s) => ends(s.a) === 1) ?? segs[0];
  let cur: V2 = ends(start.a) === 1 ? start.a : start.b;
  const used = new Set<Seg>();
  let pen = draw(cur);
  while (used.size < segs.length) {
    const s = segs.find((x) => !used.has(x) && (near(x.a, cur) || near(x.b, cur)));
    if (!s) break;
    used.add(s);
    const to = near(s.a, cur) ? s.b : s.a;
    pen = s.mid ? (pen as any).threePointsArcTo(to, s.mid) : pen.lineTo(to);
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

function bodyTool(f: Feature, ctx: Ctx, shape: Shape3D | null): { solid: Shape3D; op: BoolOp } | null {
  const { ev, sketches, work } = ctx;
  const getSk = (id: string) => { const s = sketches.get(id); if (!s) throw new Error('Boceto no encontrado o con errores'); return s; };
  switch (f.type) {
    case 'extrude': {
      const sk = getSk(f.profile);
      const fr = planeFrame(sk.plane, ev, work);
      const d = ev(f.distance);
      if (!(d > 1e-6)) throw new Error('La distancia debe ser mayor que 0');
      const prof = sketchProfile(sk, ev);
      let solid: Shape3D;
      if (f.dir === 'symmetric') solid = (prof.sketchOnPlane(makePlane(fr, -d / 2)) as any).extrude(d);
      else if (f.dir === 'reverse') solid = (prof.sketchOnPlane(makePlane(fr)) as any).extrude(d, { extrusionDirection: v3.mul(fr.normal, -1) });
      else solid = (prof.sketchOnPlane(makePlane(fr)) as any).extrude(d);
      return { solid, op: f.op };
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
    default: return null;
  }
}

export interface PartBuild { shape: Shape3D | null; status: Record<string, FeatStatus> }

export async function buildPart(doc: PartDoc, upTo?: number): Promise<PartBuild> {
  const ev = makeEval(doc.parameters);
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
              for (let k = 1; k < n; k++) copies.push(src.solid.clone().rotate(step * k, [0, 0, 0], AXES[f.axis]));
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
  const ev = makeEval(doc.parameters);
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
