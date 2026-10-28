// Acciones de los comandos de la cinta (pieza, ensamblaje y plano).
import { useStore } from '../core/store';
import { uid, v3, newDoc, type V3, type SketchF } from '../core/doc';
import { IDENTITY, type FrameMember, type BoltGroup, type EndType } from '../core/asm';
import { projectedDir, SHEETS, VIEW_NAMES, scaleLabel, type DView } from '../core/drawing';
import { writeDxf, type DxfDoc } from '../core/dxf';
import { saveText } from '../core/files';
import { getProjection, viewGeometry, dimGeometry, titleBlockGeometry } from './DrawingView';
import type { P2 } from '../core/svgpath';
import type { CandLine } from './AsmViewport';

const S = () => useStore.getState();

export const partActions = {
  startSketch: () => { const s = S(); if (s.mode === 'sketch') s.finishSketch(); s.setTool(s.tool === 'pickPlane' ? null : 'pickPlane'); },
  toggleConstruction: () => {
    const s = S();
    const sk = s.doc.features.find((f) => f.id === s.sketchId) as SketchF | undefined;
    const e = sk?.entities.find((x) => x.id === s.selEntity);
    if (e && (e.type === 'line' || e.type === 'arc')) s.updateEntity(e.id, { construction: !e.construction } as never);
    else s.notify('Selecciona una línea o un arco', 'error');
  },
};

// ---------------- Ensamblaje ----------------
export const asmActions = {
  createPart: () => {
    const s = S();
    const asmId = s.active;
    const d = newDoc();
    const n = s.docs.filter((x) => x.kind === 'part').length + 1;
    d.iProperties.partNumber = `Pieza${n}`;
    const pid = s.addDocument('part', d, `Pieza${n}.i3p`, false);
    s.commitAsm((a) => { a.occurrences.push({ id: uid('o'), name: `Pieza${n}:1`, part: pid, xf: { ...IDENTITY }, grounded: a.occurrences.length === 0 }); });
    void asmId;
    s.activate(pid);
    s.notify('Pieza creada en el ensamblaje: modélala y vuelve a la pestaña del ensamblaje');
  },
  placePart: (partId: string) => {
    const s = S();
    const e = s.docs.find((d) => d.id === partId);
    if (!e) return;
    const count = s.asm.occurrences.filter((o) => o.part === partId).length;
    // Se coloca desplazado a la derecha de lo existente
    const bb = s.asmResult ? Object.values(s.asmResult.parts).map((p) => p.props?.bbox).filter(Boolean) : [];
    const shift = s.asm.occurrences.length ? Math.max(100, ...bb.map((b) => b![1][0] - b![0][0])) * 1.3 * s.asm.occurrences.length : 0;
    s.commitAsm((a) => {
      a.occurrences.push({ id: uid('o'), name: `${e.fileName.replace(/\.[^.]+$/, '')}:${count + 1}`, part: partId, xf: { pos: [shift, 0, 0], quat: [0, 0, 0, 1] }, grounded: a.occurrences.length === 0 });
    });
  },
  toggleGround: () => { const s = S(); s.commitAsm((a) => { const o = a.occurrences.find((x) => x.id === s.selItem); if (o) o.grounded = !o.grounded; }); },
  openJoint: () => S().openAsmDialog('joint', { id: uid('j'), name: `Unión${S().asm.joints.length + 1}`, type: 'mate', offset: '0 mm', angle: '0 deg' }, undefined, 'asmFace'),
  openSkel: () => S().openAsmDialog('skel', { id: uid('k') }, undefined, 'skelPoint'),
  openFrame: () => S().openAsmDialog('frame', { family: 'SHS', size: '40x4', material: 'Acero S275JR', rot: '0 deg', offX: '0 mm', offY: '0 mm', lines: [], autoMiter: true }, undefined, 'frameLine'),
  openEnd: (type: EndType) => S().openAsmDialog('endtreat', { type, member: '', target: '', gap: '0 mm' }, undefined, 'pickMember'),
  openWeld: () => S().openAsmDialog('weld', { throat: '4 mm', process: '135' }, undefined, 'weldFace'),
  openBolt: (editId?: string) => {
    const s = S();
    const ex = editId ? s.asm.bolts.find((b) => b.id === editId) : null;
    const g: BoltGroup = ex ? structuredClone(ex) : {
      id: uid('b'), name: `Conexión atornillada${s.asm.bolts.length + 1}`, size: 'M12', grade: '8.8',
      origin: [0, 0, 0], dir: [0, 0, -1], u: [1, 0, 0], n1: '2', p1: '60 mm', n2: '1', p2: '60 mm', grip: '20', washers: 2, nut: true, cutHoles: true,
      calc: { FvEd: '40', FtEd: '0', planes: '1', threadInShear: true, steel: 'S275', tmin: '10', e1: '30', e2: '30' },
    };
    s.openAsmDialog('bolt', g, editId, 'boltFace');
  },
  /** Crea barras a partir de las líneas elegidas, con inglete automático en las esquinas. */
  applyFrame: (d: { family: string; size: string; material: string; rot: string; offX: string; offY: string; lines: CandLine[]; autoMiter: boolean }) => {
    const s = S();
    if (!d.lines.length) { s.notify('Selecciona al menos una línea', 'error'); return; }
    const base = s.asm.frames.length;
    const created: FrameMember[] = d.lines.map((l, i) => ({
      id: uid('m'), name: `${d.family} ${d.size}:${base + i + 1}`, family: d.family, size: d.size, material: d.material,
      a: l.a, b: l.b, rot: d.rot, offX: d.offX, offY: d.offY, ends: [{ type: 'none' }, { type: 'none' }], ext: ['0', '0'],
    }));
    s.commitAsm((a) => {
      a.frames.push(...created);
      if (d.autoMiter) autoMiter(a.frames, created.map((c) => c.id));
    });
    s.closeDialog();
    s.notify(`${created.length} barra${created.length > 1 ? 's' : ''} insertada${created.length > 1 ? 's' : ''}`);
  },
  applyEnd: (d: { type: EndType; member: string; target: string; gap: string }) => {
    const s = S();
    const m = s.asm.frames.find((x) => x.id === d.member), t = s.asm.frames.find((x) => x.id === d.target);
    if (!m || !t) { s.notify('Selecciona las dos barras', 'error'); return; }
    s.commitAsm((a) => {
      const M = a.frames.find((x) => x.id === m.id)!, T = a.frames.find((x) => x.id === t.id)!;
      if (d.type === 'miter') {
        const pairs: [number, number][] = [[0, 0], [0, 1], [1, 0], [1, 1]];
        const P = (f: FrameMember, i: number) => (i === 0 ? f.a : f.b);
        const pr = pairs.find(([i, j]) => v3.len(v3.sub(P(M, i), P(T, j))) < 1e-3);
        if (!pr) { s.notify('Las barras no comparten un extremo', 'error'); return; }
        M.ends[pr[0]] = { type: 'miter', other: T.id, gap: d.gap };
        T.ends[pr[1]] = { type: 'miter', other: M.id, gap: d.gap };
      } else {
        // Extremo de M más cercano a la línea de T
        const dir = v3.norm(v3.sub(T.b, T.a));
        const dist = (p: V3) => { const q = v3.sub(p, T.a); return v3.len(v3.sub(q, v3.mul(dir, v3.dot(q, dir)))); };
        const i = dist(M.a) <= dist(M.b) ? 0 : 1;
        M.ends[i] = { type: 'trim', other: T.id, gap: d.gap };
      }
    });
    s.set({ dialog: { kind: 'endtreat', draft: { ...d, member: '', target: '' } }, tool: 'pickMember' });
  },
  autoExplode: () => {
    const s = S(); const r = s.asmResult;
    if (!r) return;
    const centers: Record<string, V3> = {};
    const center = (m: { vertices: Float32Array }, xf?: { pos: V3; quat: [number, number, number, number] }): V3 => {
      let x = 0, y = 0, z = 0; const n = m.vertices.length / 3;
      for (let i = 0; i < m.vertices.length; i += 3) { x += m.vertices[i]; y += m.vertices[i + 1]; z += m.vertices[i + 2]; }
      const c: V3 = [x / n, y / n, z / n];
      return xf ? v3.add(xf.pos, c) : c;
    };
    for (const o of s.asm.occurrences) { const m = r.occCut[o.id]?.mesh ?? r.parts[o.part]?.mesh; if (m) centers[o.id] = center(m, r.xf[o.id]); }
    for (const m of r.members) centers[m.id] = center(m.mesh);
    const ids = Object.keys(centers);
    if (!ids.length) return;
    const C = v3.mul(ids.reduce((acc, k) => v3.add(acc, centers[k]), [0, 0, 0] as V3), 1 / ids.length);
    const span = Math.max(...ids.map((k) => v3.len(v3.sub(centers[k], C))), 50);
    s.commitAsm((a) => {
      a.explode = {};
      for (const k of ids) {
        let d = v3.sub(centers[k], C);
        if (v3.len(d) < 1e-6) d = [0, 0, 1];
        a.explode[k] = v3.mul(v3.norm(d), span * 0.6);
      }
    });
    s.set({ mode: 'present', explodeT: 1 });
  },
  animate: () => new Promise<void>((resolve) => {
    const s = S(); s.set({ mode: 'present', explodeT: 0 });
    const t0 = performance.now(), dur = 2500;
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / dur);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      useStore.setState({ explodeT: e });
      if (t < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  }),
  record: async () => {
    const s = S();
    const cvs = document.querySelector('.viewport .vp-canvas') as HTMLCanvasElement | null;
    if (!cvs || !('captureStream' in cvs) || typeof MediaRecorder === 'undefined') { s.notify('Este navegador no permite grabar vídeo', 'error'); return; }
    const stream = cvs.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise<void>((r) => { rec.onstop = () => r(); });
    rec.start();
    // Forzar repintado continuo durante la grabación
    const keep = setInterval(() => useStore.setState({ explodeT: useStore.getState().explodeT + 1e-9 }), 33);
    await asmActions.animate();
    await new Promise((r) => setTimeout(r, 400));
    clearInterval(keep);
    rec.stop();
    await done;
    await saveText(new Blob(chunks, { type: 'video/webm' }), `${s.fileName.replace(/\.[^.]+$/, '')}-explosionado.webm`, 'Vídeo WebM', '.webm', 'video/webm');
  },
};

/** Inglete en esquinas entre barras nuevas y existentes que comparten extremo (ángulo > 10°). */
export function autoMiter(frames: FrameMember[], newIds: string[]) {
  const P = (f: FrameMember, i: number) => (i === 0 ? f.a : f.b);
  const dirAt = (f: FrameMember, i: number) => v3.norm(i === 0 ? v3.sub(f.b, f.a) : v3.sub(f.a, f.b));
  for (const id of newIds) {
    const m = frames.find((f) => f.id === id)!;
    for (let i = 0; i < 2; i++) {
      if (m.ends[i].type !== 'none') continue;
      const mates = frames.flatMap((o) => (o.id === m.id ? [] : [0, 1].filter((j) => o.ends[j].type === 'none' && v3.len(v3.sub(P(o, j), P(m, i))) < 1e-3).map((j) => ({ o, j }))));
      if (mates.length !== 1) continue;
      const { o, j } = mates[0];
      const cos = v3.dot(dirAt(m, i), dirAt(o, j));
      if (cos > 0.985 || cos < -0.985) continue;
      m.ends[i] = { type: 'miter', other: o.id, gap: '0' };
      o.ends[j] = { type: 'miter', other: m.id, gap: '0' };
    }
  }
}

// ---------------- Plano ----------------
const selView = () => { const s = S(); return s.drw.views.find((v) => v.id === s.selItem) ?? null; };

async function sheetEntities() {
  const s = S(); const drw = s.drw;
  const [W, H] = SHEETS[drw.sheet];
  const vis: P2[][] = [], hid: P2[][] = [], dims: P2[][] = [], frame: P2[][] = [], texts: { x: number; y: number; h: number; text: string; rot?: number }[] = [];
  frame.push([[0, 0], [W, 0], [W, H], [0, H], [0, 0]], [[10, 10], [W - 10, 10], [W - 10, H - 10], [10, H - 10], [10, 10]]);
  for (const v of drw.views) {
    const p = getProjection(s, v); if (!p) continue;
    const g = viewGeometry(v, await p);
    vis.push(...g.vis); hid.push(...g.hid);
    texts.push({ x: (g.rect[0] + g.rect[2]) / 2 - 20, y: g.rect[1] - 8, h: 3, text: `${v.name} ${scaleLabel(v.scale)}` });
  }
  for (const d of drw.dims) {
    const v = drw.views.find((x) => x.id === d.view); if (!v) continue;
    const g = dimGeometry(d, v);
    dims.push(...g.lines, ...g.arrows.map((a) => [...a, a[0]]));
    texts.push({ x: g.mid[0] - g.text.length * 0.9, y: g.mid[1], h: 3.5, text: g.text, rot: g.ang });
  }
  for (const n of drw.notes) texts.push({ x: n.x, y: n.y, h: n.size, text: n.text });
  const tb = titleBlockGeometry(drw);
  for (const c of tb.cells) {
    frame.push([[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h], [c.x, c.y]]);
    texts.push({ x: c.x + 1.2, y: c.y + c.h - 2.6, h: 1.8, text: c.label });
    if (c.value) texts.push({ x: c.x + 1.2, y: c.y + (c.big ? 3 : 1.4), h: c.big ? 5 : 2.5, text: c.value });
  }
  return { W, H, vis, hid, dims, frame, texts };
}

export const drwActions = {
  selView,
  placeBase: (source: string, dir: DView['dir'], scale: number, hidden: boolean) => {
    const s = S();
    const [W, H] = SHEETS[s.drw.sheet];
    const id = uid('v');
    const src = s.docData(source) as any;
    s.commitDrw((d) => {
      d.views.push({ id, name: VIEW_NAMES[dir], source, dir, scale, x: W * 0.32, y: H * 0.62, hidden });
      if (!d.title.title && src?.iProperties) {
        d.title.title = src.iProperties.description || src.iProperties.partNumber;
        d.title.partNumber = src.iProperties.partNumber;
        d.title.material = src.format === 'inv3d.part' ? src.iProperties.material : 'Varios';
        d.title.designer = src.iProperties.designer;
      }
      d.title.scale = scaleLabel(scale);
    });
    useStore.setState({ selItem: id, dialog: null });
  },
  project: async (side: 'right' | 'down' | 'iso') => {
    const s = S(); const v = selView(); if (!v) return;
    const p = getProjection(s, v); if (!p) return;
    const g = viewGeometry(v, await p);
    const w = g.rect[2] - g.rect[0], h = g.rect[3] - g.rect[1];
    const dir = side === 'iso' ? 'iso' : projectedDir(v.dir, side);
    const id = uid('v');
    const nv: DView = { id, name: VIEW_NAMES[dir], source: v.source, dir, scale: v.scale, x: v.x, y: v.y, hidden: side === 'iso' ? false : v.hidden, parent: side === 'iso' ? undefined : v.id };
    // Tamaño de la vista nueva para colocarla sin solapes
    const pc = getProjection(s, nv); if (!pc) return;
    const gc = viewGeometry(nv, await pc);
    const wc = gc.rect[2] - gc.rect[0], hc = gc.rect[3] - gc.rect[1];
    const [W, H] = SHEETS[s.drw.sheet];
    if (side === 'right') nv.x = v.x + w / 2 + 20 + wc / 2;
    else if (side === 'down') nv.y = v.y - h / 2 - 20 - hc / 2;
    else { nv.x = W - 15 - wc / 2; nv.y = H - 15 - hc / 2; }
    s.commitDrw((d) => { d.views.push(nv); });
    useStore.setState({ selItem: id });
  },
  toggleBom: () => {
    const s = S();
    if (!s.drw.bom) {
      const av = s.drw.views.find((v) => (s.docData(v.source) as any)?.format === 'inv3d.assembly');
      if (!av) { s.notify('La lista de piezas necesita una vista de un ensamblaje', 'error'); return; }
      s.commitDrw((d) => { d.bom = { view: av.id, x: 0, y: 0 }; });
    } else s.commitDrw((d) => { d.bom = null; });
  },
  exportDxf: async () => {
    const s = S();
    const e = await sheetEntities();
    const doc: DxfDoc = {
      layers: [{ name: 'MARCO', color: 7 }, { name: 'VISIBLES', color: 7 }, { name: 'OCULTAS', color: 8, ltype: 'DASHED' }, { name: 'COTAS', color: 3 }, { name: 'TEXTO', color: 7 }],
      lines: [
        ...e.frame.map((pts) => ({ layer: 'MARCO', pts })), ...e.vis.map((pts) => ({ layer: 'VISIBLES', pts })),
        ...e.hid.map((pts) => ({ layer: 'OCULTAS', pts })), ...e.dims.map((pts) => ({ layer: 'COTAS', pts })),
      ],
      texts: e.texts.map((t) => ({ layer: 'TEXTO', ...t })),
    };
    await saveText(writeDxf(doc), s.fileName.replace(/\.[^.]+$/, '.dxf'), 'DXF', '.dxf', 'application/dxf');
  },
  exportPdf: async () => {
    const s = S();
    const e = await sheetEntities();
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: e.W > e.H ? 'landscape' : 'portrait', unit: 'mm', format: [e.W, e.H] });
    const Y = (y: number) => e.H - y;
    const poly = (pts: P2[]) => { for (let i = 0; i + 1 < pts.length; i++) pdf.line(pts[i][0], Y(pts[i][1]), pts[i + 1][0], Y(pts[i + 1][1])); };
    pdf.setLineWidth(0.25); e.frame.forEach(poly);
    pdf.setLineWidth(0.35); e.vis.forEach(poly);
    pdf.setLineWidth(0.18); pdf.setLineDashPattern([1.5, 1], 0); e.hid.forEach(poly); pdf.setLineDashPattern([], 0);
    pdf.setLineWidth(0.18); e.dims.forEach(poly);
    for (const t of e.texts) { pdf.setFontSize(t.h * 2.83); pdf.text(t.text, t.x, Y(t.y), { angle: t.rot ?? 0 }); }
    await saveText(pdf.output('arraybuffer'), s.fileName.replace(/\.[^.]+$/, '.pdf'), 'PDF', '.pdf', 'application/pdf');
  },
  exportSvg: async () => {
    const s = S();
    const svg = document.querySelector('.sheet-svg') as SVGSVGElement | null;
    if (!svg) return;
    const [W, H] = SHEETS[s.drw.sheet];
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('viewBox', `0 0 ${W} ${H}`); clone.setAttribute('width', `${W}mm`); clone.setAttribute('height', `${H}mm`);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = `.sh-paper{fill:#fff}.sh-frame,.tb-cell{fill:none;stroke:#000;stroke-width:.35}.ln-vis{fill:none;stroke:#000;stroke-width:.35}.ln-hid{fill:none;stroke:#555;stroke-width:.18;stroke-dasharray:1.5 1}.ln-dim{fill:none;stroke:#000;stroke-width:.18}.arrow{fill:#000}text{font-family:Arial,sans-serif;fill:#000}.dim-text{font-size:3.5px}.view-label{font-size:3px}.tb-label{font-size:1.8px;fill:#555}.tb-val{font-size:2.5px}.tb-big{font-size:5px;font-weight:bold}.sel-box,.snap-pt,.snap-hover{display:none}.proj-sym *{fill:none;stroke:#000;stroke-width:.25}`;
    clone.insertBefore(style, clone.firstChild);
    await saveText(new XMLSerializer().serializeToString(clone), s.fileName.replace(/\.[^.]+$/, '.svg'), 'SVG', '.svg', 'image/svg+xml');
  },
};
