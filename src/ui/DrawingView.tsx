import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type State } from '../core/store';
import { cad, type ProjSource } from '../core/cadClient';
import { flattenPath, bboxOf, type P2 } from '../core/svgpath';
import { SHEETS, VIEW_CAMERAS, VIEW_NAMES, nextLabel, type DrawingDoc, type DView, type DAnn } from '../core/drawing';
import { v3, uid, type PartDoc, type V3 } from '../core/doc';
import type { AsmDoc } from '../core/asm';
import { fmt } from '../core/expr';
import { bomRows } from './bom';
import { buildSheet, geomOf, detectCircles, chainSegments, type ProjData, type Prim, type ViewGeom } from '../core/sheet';

export type { ProjData };
const projStore = new WeakMap<object, Map<string, Promise<ProjData>>>();
/** Proyecciones ya resueltas (para dibujar de forma síncrona). */
const resolved = new WeakMap<Promise<ProjData>, ProjData>();

export function sourceFor(s: State, id: string): ProjSource | null {
  const d = s.docData(id);
  if (!d) return null;
  if ((d as PartDoc).format === 'inv3d.part') return { kind: 'part', doc: d as PartDoc };
  if ((d as AsmDoc).format === 'inv3d.assembly') {
    const a = d as AsmDoc;
    return { kind: 'asm', asm: a, parts: s.partsMap([...new Set(a.occurrences.map((o) => o.part))]) };
  }
  return null;
}

/** Cámara de una vista: dirección hacia el observador y eje X de la hoja. */
export function viewCamera(v: DView): { toward: V3; x: V3; up: V3 } {
  if (v.kind === 'section' && v.section) {
    const toward = v3.mul(v3.norm(v.section.normal), -1), x = v3.norm(v.section.x);
    return { toward, x, up: v3.cross(toward, x) };
  }
  const cam = VIEW_CAMERAS[v.dir];
  const toward: V3 = [-cam.dir[0], -cam.dir[1], -cam.dir[2]];
  return { toward, x: cam.x, up: v3.cross(toward, cam.x) };
}

export function getProjection(s: State, v: DView): Promise<ProjData> | null {
  if (v.kind === 'detail') { const pv = s.drw.views.find((x) => x.id === v.parent); return pv ? getProjection(s, pv) : null; }
  const src = sourceFor(s, v.source);
  if (!src) return null;
  const key = src.kind === 'part' ? src.doc : src.asm;
  let m = projStore.get(key);
  if (!m) { m = new Map(); projStore.set(key, m); }
  const k = v.kind === 'section' ? JSON.stringify(v.section && [v.section.origin, v.section.normal, v.section.x]) : v.dir;
  if (!m.has(k)) {
    const cam = viewCamera(v);
    const pr = cad.project(src, cam.toward, cam.x, v.kind === 'section' && v.section ? { origin: v.section.origin, normal: v.section.normal } : undefined).then((r) => {
      // replicad devuelve Y hacia abajo: se invierte para tener Y hacia arriba (coincide con (p - c)·arriba)
      const flip = (polys: P2[][]) => polys.map((pp) => pp.map(([x, y]) => [x, -y] as P2));
      const vis = flip(r.visible.flatMap((d) => flattenPath(d)));
      const hid = flip(r.hidden.flatMap((d) => flattenPath(d)));
      const cut = chainSegments(r.cut ?? []);
      const data: ProjData = { vis, hid, cut, bbox: bboxOf([...vis, ...hid]), circles: detectCircles(vis), center: r.center };
      resolved.set(pr, data);
      return data;
    });
    m.set(k, pr);
  }
  return m.get(k)!;
}
const projNow = (s: State) => (v: DView): ProjData | null => { const p = getProjection(s, v); return p ? resolved.get(p) ?? null : null; };

/** Tabla de lista de piezas para el plano (encima del cajetín). */
export function bomForDrawing(s: State, drw: DrawingDoc) {
  if (!drw.bom) return null;
  const v = drw.views.find((x) => x.id === drw.bom!.view) ?? drw.views[0];
  if (!v) return null;
  const d = s.docData(v.source) as AsmDoc | null;
  if (!d || d.format !== 'inv3d.assembly') return null;
  const rows = bomRows(s, d);
  const [W] = SHEETS[drw.sheet];
  const cols = [{ w: 10, k: 'item' }, { w: 12, k: 'qty' }, { w: 45, k: 'pn' }, { w: 63, k: 'desc' }, { w: 30, k: 'mat' }, { w: 20, k: 'mass' }] as const;
  const x0 = W - 10 - 180, y0 = 10 + 32;
  const all = [{ item: 'Pos.', qty: 'Cant.', pn: 'Nº de pieza', desc: 'Descripción', mat: 'Material', mass: 'Masa kg' }, ...rows.slice(0, 30).map((r, i) => ({
    item: String(i + 1), qty: String(r.qty), pn: r.pn, desc: r.desc, mat: r.material, mass: r.mass ? fmt(r.mass, 2) : '',
  }))];
  return all.reverse().map((r, i) => {
    let x = x0;
    return { cells: cols.map((c) => { const cell = { x, y: y0 + i * 6, w: c.w, text: (r as any)[c.k] as string }; x += c.w; return cell; }) };
  });
}

/** Primitivas de la hoja con todas las proyecciones resueltas (para exportar). */
export async function sheetPrims(s: State): Promise<{ W: number; H: number; prims: Prim[] }> {
  const drw = s.drw;
  await Promise.all(drw.views.map((v) => getProjection(s, v)).filter(Boolean));
  const [W, H] = SHEETS[drw.sheet];
  return { W, H, prims: buildSheet({ drw, proj: projNow(s), bom: bomForDrawing(s, drw) }) };
}

export function viewGeom(s: State, v: DView): ViewGeom | null { return geomOf(s.drw, projNow(s), v); }

const TOOL_HINT: Record<string, string[]> = {
  drwDim: ['Cota: primer punto (extremo o centro)', 'Segundo punto de la misma vista', 'Posición de la línea de cota'],
  drwDimD: ['Diámetro: elige un círculo', 'Posición del texto'],
  drwDimR: ['Radio: elige un arco o círculo', 'Posición del texto'],
  drwDimA: ['Ángulo: primera línea', 'Segunda línea', 'Posición del arco'],
  drwBalloon: ['Globo: punto de la pieza', 'Posición del globo'],
  drwLeader: ['Nota con directriz: punta de la flecha', 'Posición del texto'],
  drwHole: ['Nota de taladro: elige un círculo', 'Posición del texto'],
  drwSurface: ['Acabado superficial: punto sobre la superficie'],
  drwWeld: ['Símbolo de soldadura: punta de la flecha', 'Inicio de la línea de referencia'],
  drwCenterline: ['Línea de centro: primer punto', 'Segundo punto'],
  drwCenterMark: ['Marca de centro: elige un círculo'],
  drwSection: ['Sección: primer punto de la línea de corte', 'Segundo punto de la línea de corte'],
  drwDetail: ['Detalle: centro de la zona', 'Radio de la zona'],
  drwNote: ['Nota: clic para colocar'],
};

export default function DrawingView() {
  const drw = useStore((s) => s.drw);
  const sel = useStore((s) => s.selItem);
  const tool = useStore((s) => s.tool);
  const docsVersion = useStore((s) => s.docs);
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState<Record<string, string>>({});
  const svgRef = useRef<SVGSVGElement>(null);
  const [W, H] = SHEETS[drw.sheet];
  const [vb, setVb] = useState<[number, number, number, number]>([-10, -10, W + 20, H + 20]);
  useEffect(() => setVb([-10, -10, W + 20, H + 20]), [W, H]);
  const [clicks, setClicks] = useState<{ view?: string; pts: P2[]; refs: any[] }>({ pts: [], refs: [] });
  const [cursor, setCursor] = useState<P2 | null>(null);
  const drag = useRef<{ id: string; kind: 'view' | 'note' | 'ann' | 'dim'; start: P2; orig: any; pushed?: boolean } | null>(null);
  const pan = useRef<{ start: [number, number]; vb: [number, number, number, number] } | null>(null);

  // Cargar proyecciones
  useEffect(() => {
    const s = useStore.getState();
    for (const v of drw.views) {
      const p = getProjection(s, v);
      if (!p) { setLoading((m) => ({ ...m, [v.id]: 'Documento de origen no abierto' })); continue; }
      if (!resolved.get(p)) setLoading((m) => ({ ...m, [v.id]: 'Calculando vista…' }));
      p.then(() => { setLoading((m) => { const n = { ...m }; delete n[v.id]; return n; }); setTick((t) => t + 1); })
        .catch((e) => setLoading((m) => ({ ...m, [v.id]: (e as Error).message })));
    }
  }, [drw.views, docsVersion]);

  const toSheet = (e: { clientX: number; clientY: number }): P2 => {
    const svg = svgRef.current!, r = svg.getBoundingClientRect();
    const sx = vb[2] / r.width, sy = vb[3] / r.height, s = Math.max(sx, sy);
    const ox = (r.width * s - vb[2]) / 2, oy = (r.height * s - vb[3]) / 2;
    const x = vb[0] + (e.clientX - r.left) * s - ox, yTop = vb[1] + (e.clientY - r.top) * s - oy;
    return [x, H - yTop];
  };
  const pxPerMm = () => { const r = svgRef.current?.getBoundingClientRect(); return r ? Math.min(r.width / vb[2], r.height / vb[3]) : 1; };

  const s0 = useStore.getState();
  const prims = useMemo(() => buildSheet({ drw, proj: projNow(useStore.getState()), bom: bomForDrawing(useStore.getState(), drw) }), [drw, docsVersion, loading, s0.asm]);
  const geoms = useMemo(() => { const out: Record<string, ViewGeom> = {}; for (const v of drw.views) { const g = viewGeom(useStore.getState(), v); if (g) out[v.id] = g; } return out; }, [drw, docsVersion, loading]);

  // ---------- Forzado ----------
  const tolMm = () => 8 / pxPerMm();
  const snapPoint = (p: P2): { view: string; pt: P2 } | null => {
    let best: { view: string; pt: P2 } | null = null, bd = tolMm();
    for (const v of drw.views) {
      const g = geoms[v.id]; if (!g) continue;
      const test = (q: P2) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = { view: v.id, pt: q }; } };
      for (const l of g.vis) { test(l[0]); test(l[l.length - 1]); if (l.length === 2) test([(l[0][0] + l[1][0]) / 2, (l[0][1] + l[1][1]) / 2]); }
      for (const c of g.circles) { test(c.c); for (const a of [0, 90, 180, 270]) test([c.c[0] + c.r * Math.cos((a * Math.PI) / 180), c.c[1] + c.r * Math.sin((a * Math.PI) / 180)]); }
    }
    return best;
  };
  const circleAt = (p: P2): { view: string; c: P2; r: number } | null => {
    let best: { view: string; c: P2; r: number } | null = null, bd = tolMm();
    for (const v of drw.views) for (const c of geoms[v.id]?.circles ?? []) { const d = Math.abs(Math.hypot(c.c[0] - p[0], c.c[1] - p[1]) - c.r); if (d < bd) { bd = d; best = { view: v.id, c: c.c, r: c.r }; } }
    return best;
  };
  const segAt = (p: P2): { view: string; a: P2; b: P2 } | null => {
    let best: { view: string; a: P2; b: P2 } | null = null, bd = tolMm();
    for (const v of drw.views) for (const l of geoms[v.id]?.vis ?? []) for (let i = 0; i + 1 < l.length; i++) {
      const A = l[i], B = l[i + 1], d = [B[0] - A[0], B[1] - A[1]], L2 = d[0] ** 2 + d[1] ** 2; if (L2 < 1e-6) continue;
      if (l.length > 2) { const C = [l[0], l[l.length - 1]]; void C; }
      const t = Math.max(0, Math.min(1, ((p[0] - A[0]) * d[0] + (p[1] - A[1]) * d[1]) / L2));
      const dd = Math.hypot(A[0] + d[0] * t - p[0], A[1] + d[1] * t - p[1]);
      if (dd < bd) { bd = dd; best = { view: v.id, a: A, b: B }; }
    }
    return best;
  };
  const viewAt = (p: P2) => drw.views.find((v) => { const g = geoms[v.id]; return g && p[0] >= g.rect[0] - 3 && p[0] <= g.rect[2] + 3 && p[1] >= g.rect[1] - 3 && p[1] <= g.rect[3] + 3; });
  const rel = (v: DView, p: P2): [number, number] => [p[0] - v.x, p[1] - v.y];

  const addAnn = (a: Omit<DAnn, 'id'>) => { const id = uid('an'); useStore.getState().commitDrw((d) => { (d.anns ??= []).push({ ...a, id }); }); useStore.setState({ selItem: id }); };
  const reset = () => setClicks({ pts: [], refs: [] });

  const onDown = (e: React.PointerEvent) => {
    const s = useStore.getState();
    if (e.button === 1 || e.button === 2) { pan.current = { start: [e.clientX, e.clientY], vb }; (e.target as Element).setPointerCapture?.(e.pointerId); return; }
    const p = toSheet(e);
    const P = clicks.pts;
    if (tool) {
      e.preventDefault();
      if (tool === 'drwDim') {
        if (P.length < 2) {
          const sp = snapPoint(p); if (!sp) return;
          if (!P.length) setClicks({ view: sp.view, pts: [sp.pt], refs: [] });
          else if (sp.view === clicks.view) setClicks({ ...clicks, pts: [...P, sp.pt] });
          return;
        }
        const v = drw.views.find((x) => x.id === clicks.view)!;
        const [A, B] = P;
        const mid: P2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
        const dx = Math.abs(p[0] - mid[0]), dy = Math.abs(p[1] - mid[1]);
        const kind: 'h' | 'v' = Math.abs(B[0] - A[0]) < 1e-6 ? 'v' : Math.abs(B[1] - A[1]) < 1e-6 ? 'h' : dy >= dx ? 'h' : 'v';
        const offset = kind === 'h' ? p[1] - Math.max(A[1], B[1]) : p[0] - Math.max(A[0], B[0]);
        s.commitDrw((d) => { d.dims.push({ id: uid('dm'), view: v.id, a: rel(v, A), b: rel(v, B), offset, kind }); });
        reset(); return;
      }
      if (tool === 'drwDimD' || tool === 'drwDimR' || tool === 'drwHole' || tool === 'drwCenterMark') {
        if (!P.length) {
          const c = circleAt(p); if (!c) { s.notify('Haz clic sobre un círculo o arco de una vista', 'error'); return; }
          if (tool === 'drwCenterMark') { addAnn({ kind: 'centermark', pts: [c.c], r: c.r }); return; }
          setClicks({ view: c.view, pts: [c.c], refs: [c.r] }); return;
        }
        const v = drw.views.find((x) => x.id === clicks.view)!, r = clicks.refs[0] as number;
        if (tool === 'drwHole') {
          const dia = (2 * r) / v.scale;
          const u = [p[0] - P[0][0], p[1] - P[0][1]], ul = Math.hypot(u[0], u[1]) || 1;
          addAnn({ kind: 'hole', pts: [[P[0][0] + (u[0] / ul) * r, P[0][1] + (u[1] / ul) * r], p], text: holeText(s, v, dia) });
        } else s.commitDrw((d) => { d.dims.push({ id: uid('dm'), view: v.id, kind: tool === 'drwDimD' ? 'd' : 'r', a: rel(v, P[0]), b: rel(v, p), r, offset: 0 }); });
        reset(); return;
      }
      if (tool === 'drwDimA') {
        if (clicks.refs.length < 2) {
          const sg = segAt(p); if (!sg) return;
          if (clicks.refs.length === 1 && sg.view !== clicks.view) return;
          setClicks({ view: sg.view, pts: [...P, p], refs: [...clicks.refs, sg] }); return;
        }
        const [s1, s2] = clicks.refs as { a: P2; b: P2 }[];
        const d1 = [s1.b[0] - s1.a[0], s1.b[1] - s1.a[1]], d2 = [s2.b[0] - s2.a[0], s2.b[1] - s2.a[1]];
        const den = d1[0] * d2[1] - d1[1] * d2[0];
        if (Math.abs(den) < 1e-9) { s.notify('Las líneas son paralelas', 'error'); reset(); return; }
        const t = ((s2.a[0] - s1.a[0]) * d2[1] - (s2.a[1] - s1.a[1]) * d2[0]) / den;
        const V: P2 = [s1.a[0] + d1[0] * t, s1.a[1] + d1[1] * t];
        // Lado de cada línea hacia el que se coloca la etiqueta
        const side = (sg: { a: P2; b: P2 }, d: number[]): P2 => { const dl = Math.hypot(d[0], d[1]); const u: P2 = [d[0] / dl, d[1] / dl]; const s_ = (p[0] - V[0]) * u[0] + (p[1] - V[1]) * u[1] >= 0 ? 1 : -1; return [V[0] + u[0] * s_ * 10, V[1] + u[1] * s_ * 10]; };
        const v = drw.views.find((x) => x.id === clicks.view)!;
        const Pp = side(s1, d1), Qq = side(s2, d2);
        s.commitDrw((d) => { d.dims.push({ id: uid('dm'), view: v.id, kind: 'ang', a: rel(v, V), b: rel(v, Pp), c: rel(v, Qq), offset: Math.hypot(p[0] - V[0], p[1] - V[1]) }); });
        reset(); return;
      }
      if (tool === 'drwBalloon') {
        if (!P.length) { const v = viewAt(p); setClicks({ view: v?.id, pts: [p], refs: [] }); return; }
        const n = (drw.anns ?? []).filter((a) => a.kind === 'balloon').length + 1;
        addAnn({ kind: 'balloon', pts: [P[0], p], text: String(n) }); reset(); return;
      }
      if (tool === 'drwLeader' || tool === 'drwWeld' || tool === 'drwCenterline') {
        const q = (snapPoint(p)?.pt ?? p);
        if (!P.length) { setClicks({ pts: [q], refs: [] }); return; }
        if (tool === 'drwLeader') addAnn({ kind: 'leader', pts: [P[0], p], text: 'Nota' });
        else if (tool === 'drwWeld') addAnn({ kind: 'weld', pts: [P[0], p], text: 'a4', side: 'arrow' });
        else addAnn({ kind: 'centerline', pts: [P[0], q] });
        reset(); return;
      }
      if (tool === 'drwSurface') { addAnn({ kind: 'surface', pts: [snapPoint(p)?.pt ?? p], text: 'Ra 3,2' }); return; }
      if (tool === 'drwSection') {
        if (!P.length) { const v = viewAt(p); if (!v || v.kind === 'detail' || v.dir === 'iso') { s.notify('Haz clic sobre una vista ortogonal', 'error'); return; } setClicks({ view: v.id, pts: [snapPoint(p)?.pt ?? p], refs: [] }); return; }
        let B = snapPoint(p)?.pt ?? p;
        const A = P[0];
        // forzar horizontal/vertical si casi lo es
        if (Math.abs(B[1] - A[1]) < Math.abs(B[0] - A[0]) * 0.08) B = [B[0], A[1]];
        else if (Math.abs(B[0] - A[0]) < Math.abs(B[1] - A[1]) * 0.08) B = [A[0], B[1]];
        createSection(drw.views.find((x) => x.id === clicks.view)!, A, B);
        reset(); s.setTool(null); return;
      }
      if (tool === 'drwDetail') {
        if (!P.length) { const v = viewAt(p); if (!v) { s.notify('Haz clic dentro de una vista', 'error'); return; } setClicks({ view: v.id, pts: [p], refs: [] }); return; }
        createDetail(drw.views.find((x) => x.id === clicks.view)!, P[0], Math.hypot(p[0] - P[0][0], p[1] - P[0][1]));
        reset(); s.setTool(null); return;
      }
      if (tool === 'drwNote') {
        s.commitDrw((d) => { d.notes.push({ id: uid('nt'), x: p[0], y: p[1], text: 'Nota', size: 3.5 }); });
        s.setTool(null); return;
      }
      return;
    }
    // Selección y arrastre
    const hitId = (e.target as Element).closest?.('[data-id]')?.getAttribute('data-id');
    const note = drw.notes.find((n) => n.id === hitId) ?? drw.notes.find((n) => Math.abs(n.x - p[0]) < 30 && p[1] >= n.y - 2 && p[1] <= n.y + n.size + 2);
    if (note) { useStore.setState({ selItem: note.id }); drag.current = { id: note.id, kind: 'note', start: p, orig: [note.x, note.y] }; return; }
    const ann = (drw.anns ?? []).find((a) => a.id === hitId);
    if (ann) { useStore.setState({ selItem: ann.id }); drag.current = { id: ann.id, kind: 'ann', start: p, orig: ann.pts.map((q) => [...q]) }; return; }
    const dim = drw.dims.find((d) => d.id === hitId);
    if (dim) { useStore.setState({ selItem: dim.id }); drag.current = { id: dim.id, kind: 'dim', start: p, orig: { offset: dim.offset, b: [...dim.b] } }; return; }
    const v = (hitId && drw.views.find((x) => x.id === hitId)) || viewAt(p);
    useStore.setState({ selItem: v?.id ?? null });
    if (v) drag.current = { id: v.id, kind: 'view', start: p, orig: [v.x, v.y] };
  };
  const onMove = (e: React.PointerEvent) => {
    if (pan.current) {
      const r = svgRef.current!.getBoundingClientRect(); const k = pan.current.vb[2] / r.width;
      setVb([pan.current.vb[0] - (e.clientX - pan.current.start[0]) * k, pan.current.vb[1] - (e.clientY - pan.current.start[1]) * k, pan.current.vb[2], pan.current.vb[3]]);
      return;
    }
    const p = toSheet(e);
    setCursor(p);
    const dr = drag.current;
    if (dr && (e.buttons & 1)) {
      const dx = p[0] - dr.start[0], dy = p[1] - dr.start[1];
      if (Math.hypot(dx, dy) < 0.5) return;
      if (!dr.pushed) { dr.pushed = true; const st = useStore.getState(); useStore.setState({ past: [...st.past.slice(-99), st.drw], future: [], dirty: true }); }
      useStore.setState((s) => {
        const d = s.drw;
        if (dr.kind === 'view') return { drw: { ...d, views: moveView(d.views, dr.id, dr.orig[0] + dx, dr.orig[1] + dy) } };
        if (dr.kind === 'note') return { drw: { ...d, notes: d.notes.map((n) => (n.id === dr.id ? { ...n, x: dr.orig[0] + dx, y: dr.orig[1] + dy } : n)) } };
        if (dr.kind === 'ann') return { drw: { ...d, anns: (d.anns ?? []).map((a) => (a.id === dr.id ? { ...a, pts: (dr.orig as P2[]).map((q, i) => (i === 0 && a.kind !== 'surface' && a.kind !== 'centermark' && a.kind !== 'centerline' ? q : [q[0] + dx, q[1] + dy] as P2)) } : a)) } };
        return { drw: { ...d, dims: d.dims.map((m) => {
          if (m.id !== dr.id) return m;
          if (m.kind === 'h') return { ...m, offset: dr.orig.offset + dy };
          if (m.kind === 'v') return { ...m, offset: dr.orig.offset + dx };
          if (m.kind === 'a') { const L = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]) || 1; return { ...m, offset: dr.orig.offset + (-(m.b[1] - m.a[1]) * dx + (m.b[0] - m.a[0]) * dy) / L }; }
          if (m.kind === 'ang') return { ...m, offset: Math.max(4, dr.orig.offset + Math.hypot(dx, dy) * Math.sign(dx + dy)) };
          return { ...m, b: [dr.orig.b[0] + dx, dr.orig.b[1] + dy] as P2 };
        }) } };
      });
    }
  };
  const onUp = () => { pan.current = null; drag.current = null; };
  const onWheel = (e: React.WheelEvent) => {
    const p = toSheet(e); const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const yTop = H - p[1];
    setVb([p[0] - (p[0] - vb[0]) * k, yTop - (yTop - vb[1]) * k, vb[2] * k, vb[3] * k]);
  };
  useEffect(() => { reset(); }, [tool]);

  const Y = (y: number) => H - y;
  const pl = (pts: P2[]) => pts.map((q) => `${q[0].toFixed(3)},${Y(q[1]).toFixed(3)}`).join(' ');
  const loopsPath = (loops: P2[][]) => loops.map((l) => 'M' + l.map((q) => `${q[0].toFixed(3)} ${Y(q[1]).toFixed(3)}`).join('L') + 'Z').join('');
  const CLS: Record<string, string> = { vis: 'ln-vis', hid: 'ln-hid', frame: 'sh-frame', dim: 'ln-dim', center: 'ln-center', thin: 'ln-thin', thick: 'ln-thick', ann: 'ln-ann', cutline: 'ln-cut', cutend: 'ln-thick', tb: 'tb-cell' };
  const TCLS: Record<string, string> = { vlabel: 'view-label', 'vlabel big': 'view-label big', dimt: 'dim-text', annt: 'ann-text', note: 'note-text', tbl: 'tb-label', tbv: 'tb-val', tbb: 'tb-big' };
  const viewClip = (id?: string) => { const v = id ? drw.views.find((x) => x.id === id) : null; return v?.kind === 'detail' ? `url(#clip-${v.id})` : undefined; };
  void viewClip;
  const hints = tool ? TOOL_HINT[tool] : null;

  return (
    <div className="drawing-host">
      <svg ref={svgRef} className="sheet-svg" viewBox={vb.join(' ')} preserveAspectRatio="xMidYMid meet"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel} onContextMenu={(e) => { e.preventDefault(); reset(); }}
        style={{ cursor: tool ? 'crosshair' : 'default' }}>
        <defs>
          <pattern id="hatch45" patternUnits="userSpaceOnUse" width="2.5" height="2.5" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="2.5" stroke="#000" strokeWidth="0.22" />
          </pattern>
        </defs>
        <rect x={0} y={0} width={W} height={H} className="sh-paper" />
        {prims.map((p, i) => {
          const on = p.id && p.id === sel ? ' on' : '';
          if (p.t === 'pl') return <polyline key={i} data-id={p.id} points={pl(p.pts)} className={(CLS[p.cls] ?? 'ln-thin') + on} />;
          if (p.t === 'fill') return <path key={i} data-id={p.id} d={loopsPath(p.loops)} className={(p.cls === 'hatch' ? 'hatch' : 'arrow') + on} fillRule="evenodd" />;
          if (p.t === 'circ') return <circle key={i} data-id={p.id} cx={p.c[0]} cy={Y(p.c[1])} r={p.r} className={(CLS[p.cls] ?? 'ln-thin') + on} />;
          return (
            <text key={i} data-id={p.id} x={p.x} y={Y(p.y)} className={(TCLS[p.cls] ?? 'note-text') + on} style={{ fontSize: p.h, fontWeight: p.bold ? 600 : undefined }}
              textAnchor={p.anchor ?? 'start'} transform={p.rot ? `rotate(${-p.rot} ${p.x} ${Y(p.y)})` : undefined}>{p.text}</text>
          );
        })}
        {drw.views.map((v) => {
          const g = geoms[v.id];
          if (!g) return <text key={v.id} x={v.x} y={Y(v.y)} className="view-label" textAnchor="middle">{loading[v.id] ?? 'Calculando vista…'}</text>;
          return (
            <g key={v.id}>
              <rect data-id={v.id} x={g.rect[0] - 3} y={Y(g.rect[3] + 3)} width={g.rect[2] - g.rect[0] + 6} height={g.rect[3] - g.rect[1] + 6} className={`view-hit ${sel === v.id ? 'sel-box' : ''}`} />
            </g>
          );
        })}
        {clicks.pts.map((q, i) => <circle key={i} cx={q[0]} cy={Y(q[1])} r={1.2} className="snap-pt" />)}
        {tool === 'drwDetail' && clicks.pts.length === 1 && cursor && <circle cx={clicks.pts[0][0]} cy={Y(clicks.pts[0][1])} r={Math.hypot(cursor[0] - clicks.pts[0][0], cursor[1] - clicks.pts[0][1])} className="ln-preview" />}
        {(tool === 'drwSection' || tool === 'drwCenterline' || tool === 'drwLeader' || tool === 'drwWeld' || tool === 'drwBalloon') && clicks.pts.length === 1 && cursor && <polyline points={pl([clicks.pts[0], cursor])} className="ln-preview" />}
        {(tool === 'drwDim' || tool === 'drwLeader' || tool === 'drwCenterline' || tool === 'drwSection' || tool === 'drwSurface') && cursor && (() => { const sp = snapPoint(cursor); return sp ? <circle cx={sp.pt[0]} cy={Y(sp.pt[1])} r={1.6} className="snap-hover" /> : null; })()}
        {(tool === 'drwDimD' || tool === 'drwDimR' || tool === 'drwHole' || tool === 'drwCenterMark') && cursor && !clicks.pts.length && (() => { const c = circleAt(cursor); return c ? <circle cx={c.c[0]} cy={Y(c.c[1])} r={c.r} className="snap-circle" /> : null; })()}
        {tool === 'drwDimA' && cursor && (() => { const sg = segAt(cursor); return sg ? <polyline points={pl([sg.a, sg.b])} className="snap-seg" /> : null; })()}
      </svg>
      {hints && <div className="vp-hint">{hints[Math.min(tool === 'drwDimA' ? clicks.refs.length + (clicks.refs.length === 2 ? 0 : 0) : clicks.pts.length, hints.length - 1)]}</div>}
      {!drw.views.length && <div className="drw-empty">Hoja vacía. Usa <b>Vista base</b> en la cinta para colocar una pieza o un ensamblaje abierto.</div>}
    </div>
  );
}

/** Nota de taladro: diámetro, y rosca si la pieza tiene una rosca de ese diámetro. */
function holeText(s: State, v: DView, dia: number) {
  const d = s.docData(v.source) as PartDoc | null;
  if (d?.format === 'inv3d.part') {
    const th = d.features.find((f) => f.type === 'thread' && Math.abs(parseFloat(f.designation.slice(1)) - dia) < 0.6);
    if (th && th.type === 'thread') return `${th.designation.replace('x', ' × ')}`;
    const h = d.features.find((f) => f.type === 'hole');
    if (h && h.type === 'hole') return `Ø${fmt(dia, 1)} ${h.through ? 'pasante' : `× ${h.depth}`}`;
  }
  return `Ø${fmt(dia, 2)}`;
}

/** Crea una vista de sección a partir de una línea de corte dibujada sobre una vista. */
function createSection(pv: DView, A: P2, B: P2) {
  const s = useStore.getState();
  const g = viewGeom(s, pv), p = getProjection(s, pv), pd = p ? resolved.get(p) : null;
  if (!g || !pd) { s.notify('La vista aún no está calculada', 'error'); return; }
  if (Math.hypot(B[0] - A[0], B[1] - A[1]) < 2) { s.notify('Línea de corte demasiado corta', 'error'); return; }
  const cam = viewCamera(pv);
  const to3 = (q: P2): V3 => { const m = g.inv(q); return v3.add(pd.center, v3.add(v3.mul(cam.x, m[0]), v3.mul(cam.up, m[1]))); };
  const A3 = to3(A), B3 = to3(B);
  let n = v3.norm(v3.cross(v3.sub(B3, A3), cam.toward));
  // mirada hacia el lado de la vista padre en que no queda el cursor no se conoce: se toma la normal que apunta «hacia abajo/derecha» en la hoja
  const n2raw: P2 = [v3.dot(n, cam.x), v3.dot(n, cam.up)];
  if (n2raw[1] > 0.01 || (Math.abs(n2raw[1]) <= 0.01 && n2raw[0] < 0)) n = v3.mul(n, -1);
  const n2: P2 = [v3.dot(n, cam.x), v3.dot(n, cam.up)];
  let up = v3.sub(cam.up, v3.mul(n, v3.dot(cam.up, n)));
  if (v3.len(up) < 0.2) { const t = v3.mul(cam.toward, -1); up = v3.sub(t, v3.mul(n, v3.dot(t, n))); }
  up = v3.norm(up);
  const towardS = v3.mul(n, -1), x = v3.norm(v3.cross(up, towardS));
  const label = nextLabel(s.drw.views);
  const id = uid('v');
  const w = g.rect[2] - g.rect[0], h = g.rect[3] - g.rect[1];
  const dist = Math.abs(n2[0]) > Math.abs(n2[1]) ? w + 25 : h + 25;
  const [SW, SH] = SHEETS[s.drw.sheet];
  let px = pv.x + n2[0] * dist, py = pv.y + n2[1] * dist;
  // si se sale de la hoja, se coloca en el hueco libre más amplio a la derecha o arriba
  if (px - w / 2 < 12 || px + w / 2 > SW - 12 || py - h / 2 < 12 || py + h / 2 > SH - 12) {
    const used = s.drw.views.map((x) => viewGeom(s, x)?.rect).filter(Boolean) as [number, number, number, number][];
    const maxX = Math.max(...used.map((r) => r[2])), cand: [number, number][] = [[maxX + 20 + w / 2, pv.y], [maxX + 20 + w / 2, SH - 20 - h / 2], [pv.x, SH - 20 - h / 2]];
    const fits = (c: [number, number]) => c[0] + w / 2 < SW - 12 && c[1] + h / 2 < SH - 12 && c[1] - h / 2 > 45 && !used.some((r) => c[0] - w / 2 < r[2] && c[0] + w / 2 > r[0] && c[1] - h / 2 < r[3] && c[1] + h / 2 > r[1]);
    [px, py] = cand.find(fits) ?? cand[0];
  }
  const nv: DView = {
    id, name: `Sección ${label}-${label}`, source: pv.source, dir: pv.dir, scale: pv.scale, hidden: false, parent: pv.id, kind: 'section', label,
    x: px, y: py,
    section: { origin: A3, normal: n, x, a: [A[0] - pv.x, A[1] - pv.y], b: [B[0] - pv.x, B[1] - pv.y], n2 },
  };
  s.commitDrw((d) => { d.views.push(nv); });
  useStore.setState({ selItem: id });
}

/** Crea una vista de detalle (círculo sobre la vista padre, escala doble). */
function createDetail(pv: DView, C: P2, r: number) {
  const s = useStore.getState();
  const g = viewGeom(s, pv); if (!g) return;
  if (r < 2) { s.notify('Radio demasiado pequeño', 'error'); return; }
  const label = nextLabel(s.drw.views);
  const id = uid('v');
  const k = 2, [W] = SHEETS[s.drw.sheet];
  const nv: DView = {
    id, name: `Detalle ${label}`, source: pv.source, dir: pv.dir, scale: pv.scale * k, hidden: pv.hidden, parent: pv.id, kind: 'detail', label,
    x: Math.min(W - 15 - r * k, g.rect[2] + 20 + r * k), y: C[1], detail: { c: [C[0] - pv.x, C[1] - pv.y], r },
  };
  s.commitDrw((d) => { d.views.push(nv); });
  useStore.setState({ selItem: id });
}

/** Mueve una vista; las vistas proyectadas de ella mantienen la alineación. */
export function moveView(views: DView[], id: string, x: number, y: number): DView[] {
  const v = views.find((q) => q.id === id)!;
  const dx = x - v.x, dy = y - v.y;
  return views.map((q) => {
    if (q.id === id) return { ...q, x, y };
    if (q.parent === id && q.kind !== 'detail') {
      const horiz = Math.abs(q.y - v.y) < 1e-6, vert = Math.abs(q.x - v.x) < 1e-6;
      return { ...q, x: q.x + (vert ? dx : 0), y: q.y + (horiz ? dy : 0) };
    }
    return q;
  });
}

export const VIEW_LABELS = VIEW_NAMES;
