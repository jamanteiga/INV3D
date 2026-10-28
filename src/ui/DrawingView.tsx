import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type State } from '../core/store';
import { cad, type ProjSource } from '../core/cadClient';
import { flattenPath, bboxOf, type P2 } from '../core/svgpath';
import { SHEETS, VIEW_CAMERAS, VIEW_NAMES, scaleLabel, type DrawingDoc, type DView } from '../core/drawing';
import type { PartDoc } from '../core/doc';
import type { AsmDoc } from '../core/asm';
import { uid } from '../core/doc';
import { fmt } from '../core/expr';
import { bomRows } from './bom';

export interface ProjData { vis: P2[][]; hid: P2[][]; bbox: [number, number, number, number] }

const projStore = new WeakMap<object, Map<string, Promise<ProjData>>>();

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

export function getProjection(s: State, v: DView): Promise<ProjData> | null {
  const src = sourceFor(s, v.source);
  if (!src) return null;
  const key = src.kind === 'part' ? src.doc : src.asm;
  let m = projStore.get(key);
  if (!m) { m = new Map(); projStore.set(key, m); }
  const k = v.dir;
  if (!m.has(k)) {
    const cam = VIEW_CAMERAS[v.dir];
    // replicad: la dirección de la cámara apunta hacia el observador y el eje Y de la vista es X × dir.
    // Se pasa la dirección invertida (vista desde fuera) y se invierte Y para dejarla hacia arriba.
    const towardViewer = [-cam.dir[0], -cam.dir[1], -cam.dir[2]] as [number, number, number];
    m.set(k, cad.project(src, towardViewer, cam.x).then((r) => {
      const flip = (polys: P2[][]) => polys.map((pp) => pp.map(([x, y]) => [x, -y] as P2));
      const vis = flip(r.visible.flatMap((d) => flattenPath(d)));
      const hid = flip(r.hidden.flatMap((d) => flattenPath(d)));
      return { vis, hid, bbox: bboxOf([...vis, ...hid]) };
    }));
  }
  return m.get(k)!;
}

/** Geometría de una vista en coordenadas de hoja (mm, Y arriba). */
export function viewGeometry(v: DView, p: ProjData) {
  const [x0, y0, x1, y1] = p.bbox, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const T = (q: P2): P2 => [v.x + (q[0] - cx) * v.scale, v.y + (q[1] - cy) * v.scale];
  return {
    vis: p.vis.map((l) => l.map(T)),
    hid: v.hidden ? p.hid.map((l) => l.map(T)) : [],
    rect: [v.x - ((x1 - x0) * v.scale) / 2, v.y - ((y1 - y0) * v.scale) / 2, v.x + ((x1 - x0) * v.scale) / 2, v.y + ((y1 - y0) * v.scale) / 2] as [number, number, number, number],
  };
}

export function dimValue(d: DrawingDoc['dims'][number], v: DView): number {
  const dx = d.b[0] - d.a[0], dy = d.b[1] - d.a[1];
  const L = d.kind === 'h' ? Math.abs(dx) : d.kind === 'v' ? Math.abs(dy) : Math.hypot(dx, dy);
  return L / v.scale;
}

/** Elementos de una cota en coordenadas de hoja: líneas y posición del texto. */
export function dimGeometry(d: DrawingDoc['dims'][number], v: DView) {
  const A: P2 = [v.x + d.a[0], v.y + d.a[1]], B: P2 = [v.x + d.b[0], v.y + d.b[1]];
  let p1: P2, p2: P2, n: P2;
  if (d.kind === 'h') { const y = Math.max(A[1], B[1]) + d.offset; p1 = [A[0], y]; p2 = [B[0], y]; n = [0, Math.sign(d.offset) || 1]; }
  else if (d.kind === 'v') { const x = Math.max(A[0], B[0]) + d.offset; p1 = [x, A[1]]; p2 = [x, B[1]]; n = [Math.sign(d.offset) || 1, 0]; }
  else {
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1; n = [-(B[1] - A[1]) / L, (B[0] - A[0]) / L];
    p1 = [A[0] + n[0] * d.offset, A[1] + n[1] * d.offset]; p2 = [B[0] + n[0] * d.offset, B[1] + n[1] * d.offset];
  }
  const ext = (P: P2, Q: P2): P2[] => { const dx = Q[0] - P[0], dy = Q[1] - P[1], L = Math.hypot(dx, dy) || 1; return [[P[0] + (dx / L) * 1, P[1] + (dy / L) * 1], [Q[0] + (dx / L) * 2, Q[1] + (dy / L) * 2]]; };
  const dl = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1, ux = (p2[0] - p1[0]) / dl, uy = (p2[1] - p1[1]) / dl;
  const ah = 3, aw = 0.9;
  const arrow = (P: P2, s: number): P2[] => [P, [P[0] + s * ux * ah - uy * aw, P[1] + s * uy * ah + ux * aw], [P[0] + s * ux * ah + uy * aw, P[1] + s * uy * ah - ux * aw]];
  const ang = (Math.atan2(uy, ux) * 180) / Math.PI;
  const mid: P2 = [(p1[0] + p2[0]) / 2 + n[0] * 1.2, (p1[1] + p2[1]) / 2 + n[1] * 1.2];
  return { lines: [ext(A, p1), ext(B, p2), [p1, p2]], arrows: [arrow(p1, 1), arrow(p2, -1)], text: d.text ?? fmt(dimValue(d, v), 2), mid, ang: ang > 90 || ang < -90 ? ang + 180 : ang };
}

const TB_W = 180, TB_H = 32;
/** Cajetín (ISO 7200, simplificado) en la esquina inferior derecha. */
export function titleBlockGeometry(drw: DrawingDoc) {
  const [W] = SHEETS[drw.sheet];
  const x0 = W - 10 - TB_W, y0 = 10;
  const t = drw.title;
  const cells: { x: number; y: number; w: number; h: number; label: string; value: string; big?: boolean }[] = [
    { x: 0, y: 16, w: 60, h: 16, label: 'Empresa', value: t.company },
    { x: 60, y: 16, w: 80, h: 16, label: 'Título', value: t.title, big: true },
    { x: 140, y: 16, w: 40, h: 16, label: 'Nº de plano', value: t.partNumber, big: true },
    { x: 0, y: 8, w: 30, h: 8, label: 'Dibujado', value: t.designer },
    { x: 30, y: 8, w: 30, h: 8, label: 'Revisado', value: t.checker },
    { x: 60, y: 8, w: 50, h: 8, label: 'Material', value: t.material },
    { x: 110, y: 8, w: 30, h: 8, label: 'Escala', value: t.scale },
    { x: 140, y: 8, w: 20, h: 8, label: 'Rev.', value: t.revision },
    { x: 160, y: 8, w: 20, h: 8, label: 'Hoja', value: '1/1' },
    { x: 0, y: 0, w: 30, h: 8, label: 'Fecha', value: t.date },
    { x: 30, y: 0, w: 80, h: 8, label: 'Formato', value: `${drw.sheet} · medidas en mm` },
    { x: 110, y: 0, w: 70, h: 8, label: 'Proyección', value: 'europea (ISO E)' },
  ];
  return { x0, y0, cells: cells.map((c) => ({ ...c, x: x0 + c.x, y: y0 + c.y })) };
}

export default function DrawingView() {
  const drw = useStore((s) => s.drw);
  const sel = useStore((s) => s.selItem);
  const tool = useStore((s) => s.tool);
  const docsVersion = useStore((s) => s.docs);
  const [proj, setProj] = useState<Record<string, ProjData | 'loading' | string>>({});
  const svgRef = useRef<SVGSVGElement>(null);
  const [W, H] = SHEETS[drw.sheet];
  const [vb, setVb] = useState<[number, number, number, number]>([-10, -10, W + 20, H + 20]);
  useEffect(() => setVb([-10, -10, W + 20, H + 20]), [W, H]);
  const [dimPts, setDimPts] = useState<{ view: string; pts: P2[] } | null>(null);
  const [cursor, setCursor] = useState<P2 | null>(null);
  const drag = useRef<{ id: string; kind: 'view' | 'note'; start: P2; orig: P2; pushed?: boolean } | null>(null);
  const pan = useRef<{ start: [number, number]; vb: [number, number, number, number] } | null>(null);

  // Cargar proyecciones
  useEffect(() => {
    const s = useStore.getState();
    for (const v of drw.views) {
      const p = getProjection(s, v);
      if (!p) { setProj((m) => ({ ...m, [v.id]: 'Documento de origen no abierto' })); continue; }
      setProj((m) => (m[v.id] && typeof m[v.id] === 'object' ? m : { ...m, [v.id]: 'loading' }));
      p.then((r) => setProj((m) => ({ ...m, [v.id]: r }))).catch((e) => setProj((m) => ({ ...m, [v.id]: (e as Error).message })));
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

  const geoms = useMemo(() => {
    const out: Record<string, ReturnType<typeof viewGeometry>> = {};
    for (const v of drw.views) { const p = proj[v.id]; if (p && typeof p === 'object') out[v.id] = viewGeometry(v, p); }
    return out;
  }, [drw.views, proj]);

  const snapPoint = (p: P2): { view: string; pt: P2 } | null => {
    const tol = 8 / pxPerMm();
    let best: { view: string; pt: P2 } | null = null, bd = tol;
    for (const v of drw.views) {
      const g = geoms[v.id]; if (!g) continue;
      for (const l of g.vis) for (const q of [l[0], l[l.length - 1]]) {
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = { view: v.id, pt: q }; }
      }
    }
    return best;
  };
  const viewAt = (p: P2) => drw.views.find((v) => { const g = geoms[v.id]; return g && p[0] >= g.rect[0] - 3 && p[0] <= g.rect[2] + 3 && p[1] >= g.rect[1] - 3 && p[1] <= g.rect[3] + 3; });

  const onDown = (e: React.PointerEvent) => {
    const s = useStore.getState();
    if (e.button === 1 || e.button === 2) { pan.current = { start: [e.clientX, e.clientY], vb }; (e.target as Element).setPointerCapture?.(e.pointerId); return; }
    const p = toSheet(e);
    if (tool === 'drwDim') {
      if (!dimPts || dimPts.pts.length < 2) {
        const sp = snapPoint(p);
        if (!sp) return;
        if (!dimPts) setDimPts({ view: sp.view, pts: [sp.pt] });
        else if (sp.view === dimPts.view) setDimPts({ view: dimPts.view, pts: [...dimPts.pts, sp.pt] });
        return;
      }
      const v = drw.views.find((x) => x.id === dimPts.view)!;
      const [A, B] = dimPts.pts;
      const mid: P2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      const dx = Math.abs(p[0] - mid[0]), dy = Math.abs(p[1] - mid[1]);
      const kind: 'h' | 'v' = Math.abs(B[0] - A[0]) < 1e-6 ? 'v' : Math.abs(B[1] - A[1]) < 1e-6 ? 'h' : dy >= dx ? 'h' : 'v';
      const offset = kind === 'h' ? p[1] - Math.max(A[1], B[1]) : p[0] - Math.max(A[0], B[0]);
      s.commitDrw((d) => { d.dims.push({ id: uid('dm'), view: v.id, a: [A[0] - v.x, A[1] - v.y], b: [B[0] - v.x, B[1] - v.y], offset, kind }); });
      setDimPts(null);
      return;
    }
    if (tool === 'drwNote') {
      s.commitDrw((d) => { d.notes.push({ id: uid('nt'), x: p[0], y: p[1], text: 'Nota', size: 3.5 }); });
      s.setTool(null);
      return;
    }
    const note = drw.notes.find((n) => Math.abs(n.x - p[0]) < 30 && p[1] >= n.y - 2 && p[1] <= n.y + n.size + 2);
    if (note) { useStore.setState({ selItem: note.id }); drag.current = { id: note.id, kind: 'note', start: p, orig: [note.x, note.y] }; return; }
    const v = viewAt(p);
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
      useStore.setState((s) => ({ drw: { ...s.drw,
        views: dr.kind === 'view' ? moveView(s.drw.views, dr.id, dr.orig[0] + dx, dr.orig[1] + dy) : s.drw.views,
        notes: dr.kind === 'note' ? s.drw.notes.map((n) => (n.id === dr.id ? { ...n, x: dr.orig[0] + dx, y: dr.orig[1] + dy } : n)) : s.drw.notes } }));
    }
  };
  const onUp = () => {
    pan.current = null;
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    const p = toSheet(e); const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const yTop = H - p[1];
    setVb([p[0] - (p[0] - vb[0]) * k, yTop - (yTop - vb[1]) * k, vb[2] * k, vb[3] * k]);
  };
  useEffect(() => { if (tool !== 'drwDim') setDimPts(null); }, [tool]);

  const Y = (y: number) => H - y;
  const pl = (pts: P2[]) => pts.map((q) => `${q[0].toFixed(3)},${Y(q[1]).toFixed(3)}`).join(' ');
  const tb = titleBlockGeometry(drw);
  const bom = drw.bom ? bomForDrawing(drw) : null;

  return (
    <div className="drawing-host">
      <svg ref={svgRef} className="sheet-svg" viewBox={vb.join(' ')} preserveAspectRatio="xMidYMid meet"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()}
        style={{ cursor: tool ? 'crosshair' : 'default' }}>
        <rect x={0} y={0} width={W} height={H} className="sh-paper" />
        <rect x={10} y={10} width={W - 20} height={H - 20} className="sh-frame" />
        {/* Marcas de centrado */}
        <path d={`M${W / 2} 0V10M${W / 2} ${H - 10}V${H}M0 ${H / 2}H10M${W - 10} ${H / 2}H${W}`} className="sh-frame" />
        {drw.views.map((v) => {
          const g = geoms[v.id], p = proj[v.id];
          return (
            <g key={v.id}>
              {g ? (<>
                {g.hid.map((l, i) => <polyline key={'h' + i} points={pl(l)} className="ln-hid" />)}
                {g.vis.map((l, i) => <polyline key={'v' + i} points={pl(l)} className="ln-vis" />)}
                {sel === v.id && <rect x={g.rect[0] - 3} y={Y(g.rect[3] + 3)} width={g.rect[2] - g.rect[0] + 6} height={g.rect[3] - g.rect[1] + 6} className="sel-box" />}
                <text x={(g.rect[0] + g.rect[2]) / 2} y={Y(g.rect[1] - 7)} className="view-label" textAnchor="middle">{v.name} · {scaleLabel(v.scale)}</text>
              </>) : (
                <text x={v.x} y={Y(v.y)} className="view-label" textAnchor="middle">{p === 'loading' || !p ? 'Calculando vista…' : String(p)}</text>
              )}
            </g>
          );
        })}
        {drw.dims.map((d) => {
          const v = drw.views.find((x) => x.id === d.view); if (!v) return null;
          const g = dimGeometry(d, v);
          return (
            <g key={d.id} className={`dimg ${sel === d.id ? 'on' : ''}`} onPointerDown={(e) => { e.stopPropagation(); useStore.setState({ selItem: d.id }); }}>
              {g.lines.map((l, i) => <polyline key={i} points={pl(l)} className="ln-dim" />)}
              {g.arrows.map((a, i) => <polygon key={'a' + i} points={pl(a)} className="arrow" />)}
              <text x={g.mid[0]} y={Y(g.mid[1])} transform={`rotate(${-g.ang} ${g.mid[0]} ${Y(g.mid[1])})`} className="dim-text" textAnchor="middle">{g.text}</text>
            </g>
          );
        })}
        {dimPts && dimPts.pts.map((q, i) => <circle key={i} cx={q[0]} cy={Y(q[1])} r={1.2} className="snap-pt" />)}
        {tool === 'drwDim' && cursor && (() => { const sp = snapPoint(cursor); return sp ? <circle cx={sp.pt[0]} cy={Y(sp.pt[1])} r={1.6} className="snap-hover" /> : null; })()}
        {drw.notes.map((n) => (
          <text key={n.id} x={n.x} y={Y(n.y)} className={`note-text ${sel === n.id ? 'on' : ''}`} style={{ fontSize: n.size }}>{n.text}</text>
        ))}
        {/* Cajetín */}
        <g className="tb">
          {tb.cells.map((c, i) => (
            <g key={i}>
              <rect x={c.x} y={Y(c.y + c.h)} width={c.w} height={c.h} className="tb-cell" />
              <text x={c.x + 1.2} y={Y(c.y + c.h) + 2.6} className="tb-label">{c.label}</text>
              <text x={c.x + 1.2} y={Y(c.y) - (c.big ? 3 : 1.4)} className={c.big ? 'tb-big' : 'tb-val'}>{c.value}</text>
            </g>
          ))}
          {/* Símbolo de proyección europea */}
          <g transform={`translate(${tb.x0 + 168} ${Y(tb.y0 + 4)})`} className="proj-sym">
            <circle cx={-6} cy={0} r={2.6} /><circle cx={-6} cy={0} r={1.2} />
            <path d="M-1 -2.6 L4 -1.6 L4 1.6 L-1 2.6 Z" />
          </g>
        </g>
        {bom && (
          <g className="tb">
            {bom.map((row, i) => (
              <g key={i}>
                {row.cells.map((c, j) => (
                  <g key={j}>
                    <rect x={c.x} y={Y(c.y + 6)} width={c.w} height={6} className={i === 0 ? 'tb-cell head' : 'tb-cell'} />
                    <text x={c.x + 1.2} y={Y(c.y) - 1.8} className="tb-val">{c.text}</text>
                  </g>
                ))}
              </g>
            ))}
          </g>
        )}
      </svg>
      {tool === 'drwDim' && <div className="vp-hint">{!dimPts ? 'Cota: primer punto (extremo de línea)' : dimPts.pts.length === 1 ? 'Segundo punto de la misma vista' : 'Posición de la línea de cota'}</div>}
      {tool === 'drwNote' && <div className="vp-hint">Clic donde colocar la nota</div>}
      {!drw.views.length && <div className="drw-empty">Hoja vacía. Usa <b>Vista base</b> en la cinta para colocar una pieza o un ensamblaje abierto.</div>}
    </div>
  );
}

/** Mueve una vista; las vistas proyectadas de ella mantienen la alineación. */
export function moveView(views: DView[], id: string, x: number, y: number): DView[] {
  const v = views.find((q) => q.id === id)!;
  const dx = x - v.x, dy = y - v.y;
  return views.map((q) => {
    if (q.id === id) return { ...q, x, y };
    if (q.parent === id) {
      const horiz = Math.abs(q.y - v.y) < 1e-6, vert = Math.abs(q.x - v.x) < 1e-6;
      return { ...q, x: q.x + (vert ? dx : 0), y: q.y + (horiz ? dy : 0) };
    }
    if (v.parent === q.id) return q;
    return q;
  });
}

/** Tabla de lista de piezas para el plano (encima del cajetín). */
function bomForDrawing(drw: DrawingDoc) {
  const s = useStore.getState();
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

export const VIEW_LABELS = VIEW_NAMES;
