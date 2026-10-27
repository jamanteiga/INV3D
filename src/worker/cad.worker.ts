/// <reference lib="webworker" />
// Núcleo geométrico: OpenCascade (vía replicad) ejecutándose fuera del hilo de la interfaz.
import opencascade from 'replicad-opencascadejs';
import {
  setOC, Plane, draw, drawRectangle, drawCircle, importSTEP, compoundShapes,
  measureShapeVolumeProperties, measureShapeSurfaceProperties,
} from 'replicad';
import type { Drawing, Shape3D, EdgeFinder } from 'replicad';
import { makeEval } from '../core/expr';
import {
  planeFrame, entityArea, entityOutline, npolyPoints, toWorld, v3,
  type PartDoc, type SkEntity, type SketchF, type Feature, type EdgeSel, type Frame, type V3,
} from '../core/doc';

let ready: Promise<void> | null = null;
let lastShape: Shape3D | null = null;
let ocBase = '';

async function loadWasm(): Promise<ArrayBuffer> {
  const base = new URL(ocBase || './oc/', self.location.href);
  const man = await (await fetch(new URL('manifest.json', base))).json() as { size: number; parts: string[] };
  const out = new Uint8Array(man.size);
  let off = 0, done = 0;
  const bufs = await Promise.all(man.parts.map(async (p) => {
    const b = new Uint8Array(await (await fetch(new URL(p, base))).arrayBuffer());
    done++; post({ type: 'progress', value: done / man.parts.length });
    return b;
  }));
  for (const b of bufs) { out.set(b, off); off += b.length; }
  return out.buffer;
}

function init() {
  if (!ready) {
    ready = (async () => {
      const wasmBinary = await loadWasm();
      const OC = await (opencascade as unknown as (o: object) => Promise<unknown>)({ wasmBinary });
      setOC(OC as never);
    })();
  }
  return ready;
}

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

function entityDrawing(e: SkEntity, ev: (s: string) => number): Drawing | null {
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
      const pts = e.type === 'poly' ? e.pts.map((p) => [ev(p[0]), ev(p[1])] as [number, number]) : npolyPoints(ev(e.cx), ev(e.cy), ev(e.d), Math.round(ev(e.n)), ev(e.rot));
      if (pts.length < 3) throw new Error('Contorno con menos de 3 puntos');
      let pen = draw(pts[0]);
      for (let i = 1; i < pts.length; i++) pen = pen.lineTo(pts[i]);
      return pen.close();
    }
    default: return null;
  }
}

/** Perfil de un boceto: une contornos y resta los que quedan dentro de otros (islas/taladros). */
function sketchProfile(sk: SketchF, ev: (s: string) => number): Drawing {
  const closed = sk.entities.filter((e) => e.type !== 'line')
    .map((e) => {
      const o = entityOutline(e, ev);
      const xs = o.pts.map((p) => p[0]), ys = o.pts.map((p) => p[1]);
      return { e, area: entityArea(e, ev), bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    })
    .sort((a, b) => b.area - a.area);
  if (!closed.length) throw new Error(`${sk.name} no tiene perfiles cerrados`);
  let result: Drawing | null = null;
  const placed: { bb: number[]; hole: boolean }[] = [];
  for (const c of closed) {
    const d = entityDrawing(c.e, ev)!;
    const inside = placed.filter((p) => c.bb[0] >= p.bb[0] - 1e-6 && c.bb[1] >= p.bb[1] - 1e-6 && c.bb[2] <= p.bb[2] + 1e-6 && c.bb[3] <= p.bb[3] + 1e-6);
    // Dentro de un número impar de contornos → agujero; par → isla.
    const hole = inside.length % 2 === 1;
    result = result ? (hole ? result.cut(d) : result.fuse(d)) : d;
    placed.push({ bb: c.bb, hole });
  }
  return result!;
}

const makePlane = (f: Frame, shift = 0) => new Plane(v3.add(f.origin, v3.mul(f.normal, shift)), f.xDir, f.normal);

function combine(base: Shape3D | null, tool: Shape3D, op: string): Shape3D {
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

interface FeatStatus { ok: boolean; error?: string }

function meshShape(shape: Shape3D) {
  const faces = shape.mesh({ tolerance: 0.05, angularTolerance: 12 });
  const edges = shape.meshEdges({ tolerance: 0.05, angularTolerance: 12 });
  const vertices = new Float32Array(faces.vertices);
  const normals = new Float32Array(faces.normals);
  const triangles = new Uint32Array(faces.triangles);
  const lines = new Float32Array(edges.lines);
  return {
    mesh: { vertices, normals, triangles, faceGroups: faces.faceGroups, lines, edgeGroups: edges.edgeGroups },
    transfer: [vertices.buffer, normals.buffer, triangles.buffer, lines.buffer] as Transferable[],
  };
}

function props(shape: Shape3D) {
  try {
    const vp = measureShapeVolumeProperties(shape);
    const sp = measureShapeSurfaceProperties(shape);
    const bb = shape.boundingBox;
    const c = vp.centerOfMass;
    const out = { volume: vp.volume, area: sp.area, cog: [c[0], c[1], c[2]] as V3, bbox: [bb.bounds[0], bb.bounds[1]] as [V3, V3] };
    vp.delete?.(); sp.delete?.();
    return out;
  } catch { return null; }
}

self.onmessage = async (ev: MessageEvent) => {
  const { id, type } = ev.data;
  if (ev.data.ocBase) ocBase = ev.data.ocBase;
  try {
    await init();
    if (type === 'init') return post({ id, ok: true });
    if (type === 'regen') {
      const t0 = performance.now();
      const doc = ev.data.doc as PartDoc;
      const { shape, status } = await regen(doc);
      if (!ev.data.preview) lastShape = shape;
      if (!shape) return post({ id, ok: true, result: { mesh: null, status, props: null, ms: performance.now() - t0 } });
      const { mesh, transfer } = meshShape(shape);
      return post({ id, ok: true, result: { mesh, status, props: props(shape), ms: performance.now() - t0 } }, transfer);
    }
    if (type === 'exportSTEP') {
      if (!lastShape) throw new Error('No hay sólido que exportar');
      return post({ id, ok: true, result: await lastShape.blobSTEP().text() });
    }
    if (type === 'exportSTL') {
      if (!lastShape) throw new Error('No hay sólido que exportar');
      const buf = await lastShape.blobSTL({ binary: true, tolerance: 0.02, angularTolerance: 5 } as any).arrayBuffer();
      return post({ id, ok: true, result: buf }, [buf]);
    }
    if (type === 'checkSTEP') {
      const s = await importSTEP(new Blob([ev.data.text])) as Shape3D;
      const bb = s.boundingBox.bounds;
      return post({ id, ok: true, result: { bbox: bb } });
    }
    throw new Error(`Mensaje desconocido: ${type}`);
  } catch (e) {
    post({ id, ok: false, error: (e as Error)?.message || String(e) });
  }
};

/** Reconstrucción completa en orden, con soporte de sólidos importados. */
async function regen(doc: PartDoc) {
  const ev = makeEval(doc.parameters);
  const evs = (s: string) => ev(s);
  const status: Record<string, FeatStatus> = {};
  const sketches = new Map<string, SketchF>();
  let shape: Shape3D | null = null;
  for (const f of doc.features) {
    if (f.suppressed) { status[f.id] = { ok: true }; continue; }
    try {
      if (f.type === 'import') {
        const s = (await importSTEP(new Blob([f.step]))) as Shape3D;
        shape = shape ? shape.fuse(s) : s;
      } else {
        shape = applyFeature(f, shape, sketches, ev, evs);
      }
      status[f.id] = { ok: true };
    } catch (e) {
      status[f.id] = { ok: false, error: (e as Error)?.message || 'Error de geometría (OpenCascade)' };
    }
  }
  return { shape, status };
}

function applyFeature(f: Feature, shape: Shape3D | null, sketches: Map<string, SketchF>, ev: (s: string) => number, evs: (s: string) => number): Shape3D | null {
  switch (f.type) {
    case 'sketch': {
      for (const e of f.entities) entityOutline(e, evs);
      planeFrame(f.plane, evs);
      sketches.set(f.id, f);
      return shape;
    }
    case 'extrude': {
      const sk = sketches.get(f.profile);
      if (!sk) throw new Error('Boceto de perfil no encontrado o con errores');
      const fr = planeFrame(sk.plane, evs);
      const d = ev(f.distance);
      if (!(d > 1e-6)) throw new Error('La distancia debe ser mayor que 0');
      const prof = sketchProfile(sk, evs);
      let solid: Shape3D;
      if (f.dir === 'symmetric') solid = (prof.sketchOnPlane(makePlane(fr, -d / 2)) as any).extrude(d);
      else if (f.dir === 'reverse') solid = (prof.sketchOnPlane(makePlane(fr)) as any).extrude(d, { extrusionDirection: v3.mul(fr.normal, -1) });
      else solid = (prof.sketchOnPlane(makePlane(fr)) as any).extrude(d);
      return combine(shape, solid, f.op);
    }
    case 'revolve': {
      const sk = sketches.get(f.profile);
      if (!sk) throw new Error('Boceto de perfil no encontrado o con errores');
      const fr = planeFrame(sk.plane, evs);
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
      const prof = sketchProfile(sk, evs);
      const solid = (prof.sketchOnPlane(makePlane(fr)) as any).revolve(dir, { origin, angle: ang });
      return combine(shape, solid, f.op);
    }
    case 'fillet': {
      if (!shape) throw new Error('No hay sólido');
      const r = ev(f.radius);
      if (!(r > 0)) throw new Error('Radio no válido');
      return shape.fillet(r, edgeFilter(f.edges) as any);
    }
    case 'chamfer': {
      if (!shape) throw new Error('No hay sólido');
      const r = ev(f.distance);
      if (!(r > 0)) throw new Error('Distancia no válida');
      return shape.chamfer(r, edgeFilter(f.edges) as any);
    }
    default: return shape;
  }
}
