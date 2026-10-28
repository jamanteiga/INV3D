/// <reference lib="webworker" />
// Núcleo geométrico: OpenCascade (vía replicad) ejecutándose fuera del hilo de la interfaz.
import opencascade from 'replicad-opencascadejs';
import {
  setOC, importSTEP, exportSTEP, compoundShapes, drawProjection, ProjectionCamera,
  measureShapeVolumeProperties, measureShapeSurfaceProperties,
} from 'replicad';
import type { Shape3D } from 'replicad';
import { v3, type PartDoc, type V3 } from '../core/doc';
import type { AsmDoc } from '../core/asm';
import { buildPart, flatPattern, type FeatStatus } from './part';
import { buildAsmGeometry, xfShape, cutHolesLocal } from './asm';

let ready: Promise<void> | null = null;
let ocBase = '';
let lastPart: Shape3D | null = null;
let lastAsm: { shape: Shape3D; name: string }[] = [];

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
  ready ??= (async () => {
    const wasmBinary = await loadWasm();
    const OC = await (opencascade as unknown as (o: object) => Promise<unknown>)({ wasmBinary });
    setOC(OC as never);
  })();
  return ready;
}

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

export function hashStr(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

function meshShape(shape: Shape3D, fine = false) {
  const tol = fine ? 0.02 : 0.05;
  const faces = shape.mesh({ tolerance: tol, angularTolerance: 12 });
  const edges = shape.meshEdges({ tolerance: tol, angularTolerance: 12 });
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

// ---- Caché de piezas por contenido ----
interface PartEntry { shape: Shape3D | null; status: Record<string, FeatStatus>; props: ReturnType<typeof props> }
const partCache = new Map<string, PartEntry>();
async function getPart(doc: PartDoc): Promise<{ key: string; entry: PartEntry }> {
  const key = hashStr(JSON.stringify(doc));
  let entry = partCache.get(key);
  if (!entry) {
    const b = await buildPart(doc);
    entry = { shape: b.shape, status: b.status, props: b.shape ? props(b.shape) : null };
    partCache.set(key, entry);
    if (partCache.size > 60) partCache.delete(partCache.keys().next().value!);
  }
  return { key, entry };
}

/** Longitud de corte de una barra: extensión de sus vértices sobre el eje. */
function extentAlong(mesh: { vertices: Float32Array }, axis: V3): number {
  let lo = Infinity, hi = -Infinity;
  const v = mesh.vertices;
  for (let i = 0; i < v.length; i += 3) { const d = v[i] * axis[0] + v[i + 1] * axis[1] + v[i + 2] * axis[2]; if (d < lo) lo = d; if (d > hi) hi = d; }
  return hi - lo;
}

async function regenAsm(asm: AsmDoc, parts: Record<string, PartDoc>, have: string[]) {
  const t0 = performance.now();
  const transfer: Transferable[] = [];
  const known = new Set(have);
  const outParts: Record<string, { key: string; mesh?: unknown; props: unknown; ok: boolean; error?: string }> = {};
  const shapes: Record<string, Shape3D | null> = {};
  for (const [id, doc] of Object.entries(parts)) {
    const { key, entry } = await getPart(doc);
    shapes[id] = entry.shape;
    const bad = Object.values(entry.status).find((s) => !s.ok);
    const rec: (typeof outParts)[string] = { key, props: entry.props, ok: !bad, error: bad?.error };
    if (entry.shape && !known.has(key)) { const m = meshShape(entry.shape); rec.mesh = m.mesh; transfer.push(...m.transfer); }
    outParts[id] = rec;
  }
  const g = buildAsmGeometry(asm);
  const allHoles = asm.bolts.filter((b) => b.cutHoles && !b.suppressed).flatMap((b) => g.bolts.find((x) => x.id === b.id)?.holes ?? []);
  const occCut: Record<string, unknown> = {};
  lastAsm = [];
  for (const o of asm.occurrences) {
    if (o.suppressed) continue;
    const base = shapes[o.part];
    if (!base) continue;
    const xf = g.xf[o.id];
    let local = base;
    if (allHoles.length) {
      try {
        const cut = cutHolesLocal(base, xf, allHoles);
        if (cut) { local = cut; const m = meshShape(cut); occCut[o.id] = { mesh: m.mesh, props: props(cut) }; transfer.push(...m.transfer); }
      } catch { /* sin taladros */ }
    }
    lastAsm.push({ shape: xfShape(local, xf), name: o.name });
  }
  const members = g.members.map((m) => {
    const mm = meshShape(m.shape);
    transfer.push(...mm.transfer);
    const fr = asm.frames.find((f) => f.id === m.id)!;
    const axis = v3.norm(v3.sub(fr.b, fr.a));
    const p = props(m.shape);
    lastAsm.push({ shape: m.shape, name: fr.name });
    return { id: m.id, mesh: mm.mesh, length: extentAlong(mm.mesh, axis), cutAngles: m.cutAngles, volume: p?.volume ?? 0 };
  });
  const welds = g.welds.map((w) => {
    const mm = meshShape(w.shape); transfer.push(...mm.transfer);
    lastAsm.push({ shape: w.shape, name: asm.welds.find((x) => x.id === w.id)?.name ?? 'Cordón' });
    return { id: w.id, mesh: mm.mesh, length: w.length, area: w.area };
  });
  const bolts = g.bolts.map((b) => {
    const mm = meshShape(b.shape); transfer.push(...mm.transfer);
    lastAsm.push({ shape: b.shape, name: asm.bolts.find((x) => x.id === b.id)?.name ?? 'Tornillería' });
    return { id: b.id, mesh: mm.mesh, length: b.length, count: b.count };
  });
  return {
    result: {
      parts: outParts, xf: g.xf, occCut, members, welds, bolts,
      errors: { ...g.jointErrors, ...g.memberErrors, ...g.weldErrors, ...g.boltErrors },
      ms: performance.now() - t0,
    },
    transfer,
  };
}

async function sourceShape(src: { kind: 'part'; doc: PartDoc } | { kind: 'asm'; asm: AsmDoc; parts: Record<string, PartDoc> }): Promise<Shape3D> {
  if (src.kind === 'part') {
    const { entry } = await getPart(src.doc);
    if (!entry.shape) throw new Error('La pieza no tiene sólido');
    return entry.shape;
  }
  await regenAsm(src.asm, src.parts, []);
  if (!lastAsm.length) throw new Error('El ensamblaje está vacío');
  return compoundShapes(lastAsm.map((x) => x.shape)) as unknown as Shape3D;
}

const projCache = new Map<string, unknown>();

self.onmessage = async (ev: MessageEvent) => {
  const { id, type } = ev.data;
  if (ev.data.ocBase) ocBase = ev.data.ocBase;
  try {
    await init();
    if (type === 'init') return post({ id, ok: true });
    if (type === 'regen') {
      const t0 = performance.now();
      const doc = ev.data.doc as PartDoc;
      let shape: Shape3D | null, status: Record<string, FeatStatus>;
      if (ev.data.upTo !== undefined) { const b = await buildPart(doc, ev.data.upTo); shape = b.shape; status = b.status; }
      else { const { entry } = await getPart(doc); shape = entry.shape; status = entry.status; }
      if (!ev.data.preview) lastPart = shape;
      if (!shape) return post({ id, ok: true, result: { mesh: null, status, props: null, ms: performance.now() - t0 } });
      const { mesh, transfer } = meshShape(shape);
      return post({ id, ok: true, result: { mesh, status, props: props(shape), ms: performance.now() - t0 } }, transfer);
    }
    if (type === 'asm') {
      const { result, transfer } = await regenAsm(ev.data.asm, ev.data.parts, ev.data.have ?? []);
      return post({ id, ok: true, result }, transfer);
    }
    if (type === 'exportSTEP' || type === 'exportSTL') {
      let shape: Shape3D;
      if (ev.data.target === 'asm') {
        if (!lastAsm.length) throw new Error('El ensamblaje está vacío');
        if (type === 'exportSTEP') return post({ id, ok: true, result: await exportSTEP(lastAsm.map((x) => ({ shape: x.shape, name: x.name }))).text() });
        shape = compoundShapes(lastAsm.map((x) => x.shape)) as unknown as Shape3D;
      } else {
        if (!lastPart) throw new Error('No hay sólido que exportar');
        shape = lastPart;
      }
      if (type === 'exportSTEP') return post({ id, ok: true, result: await shape.blobSTEP().text() });
      const buf = await shape.blobSTL({ binary: true, tolerance: 0.02, angularTolerance: 5 } as any).arrayBuffer();
      return post({ id, ok: true, result: buf }, [buf]);
    }
    if (type === 'checkSTEP') {
      const s = await importSTEP(new Blob([ev.data.text])) as Shape3D;
      return post({ id, ok: true, result: { bbox: s.boundingBox.bounds, solids: s.solids.length } });
    }
    if (type === 'splitSTEP') {
      const s = await importSTEP(new Blob([ev.data.text])) as Shape3D;
      const solids = s.solids;
      if (!solids.length) throw new Error('El STEP no contiene sólidos');
      const out: string[] = [];
      for (const so of solids) out.push(await exportSTEP([{ shape: so }]).text());
      return post({ id, ok: true, result: out });
    }
    if (type === 'project') {
      const key = hashStr(JSON.stringify([ev.data.source, ev.data.dir, ev.data.x]));
      if (projCache.has(key)) return post({ id, ok: true, result: projCache.get(key) });
      const shape = await sourceShape(ev.data.source);
      const dir = v3.norm(ev.data.dir as V3), x = v3.norm(ev.data.x as V3);
      const bb = shape.boundingBox;
      const c = bb.center as V3;
      const cam = new ProjectionCamera(v3.sub(c, v3.mul(dir, 10000)), dir, x);
      const { visible, hidden } = drawProjection(shape, cam);
      const flat = (p: string[] | string[][]) => (Array.isArray(p[0]) ? (p as string[][]).flat() : (p as string[]));
      const result = { visible: flat(visible.toSVGPaths()), hidden: flat(hidden.toSVGPaths()) };
      projCache.set(key, result);
      if (projCache.size > 40) projCache.delete(projCache.keys().next().value!);
      return post({ id, ok: true, result });
    }
    if (type === 'flat') return post({ id, ok: true, result: flatPattern(ev.data.doc) });
    throw new Error(`Mensaje desconocido: ${type}`);
  } catch (e) {
    post({ id, ok: false, error: (e as Error)?.message || String(e) });
  }
};
