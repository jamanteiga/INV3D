// Acciones de los comandos de la cinta (pieza, ensamblaje y plano).
import { useStore, type SkOp } from '../core/store';
import { uid, v3, newDoc, type V3, type SketchF } from '../core/doc';
import { IDENTITY, q as qq, type FrameMember, type BoltGroup, type EndType } from '../core/asm';
import { CONTENT } from '../core/content';
import { makeEval } from '../core/expr';
import { cad } from '../core/cadClient';
import { projectedDir, SHEETS, SCALES, VIEW_NAMES, scaleLabel, type DView } from '../core/drawing';
import { writeDxf, type DxfDoc } from '../core/dxf';
import { saveText } from '../core/files';
import { getProjection, viewGeom, sheetPrims } from './DrawingView';
import { hatchLines } from '../core/sheet';
import type { P2 } from '../core/svgpath';
import type { CandLine } from './AsmViewport';

const S = () => useStore.getState();

export const partActions = {
  startSketch: () => { const s = S(); if (s.mode === 'sketch') s.finishSketch(); s.setTool(s.tool === 'pickPlane' ? null : 'pickPlane'); },
  toggleConstruction: () => {
    const s = S();
    const sk = s.doc.features.find((f) => f.id === s.sketchId) as SketchF | undefined;
    const e = sk?.entities.find((x) => x.id === s.selEntity);
    const ids = s.selEntities.length ? s.selEntities : e ? [e.id] : [];
    if (!ids.length) return s.notify('Selecciona geometría', 'error');
    const on = !sk!.entities.find((x) => x.id === ids[0])?.construction;
    s.sketchCommit((k) => { for (const x of k.entities) if (ids.includes(x.id)) x.construction = on; });
  },
  skop: (op: SkOp) => {
    const s = S();
    const def: Record<SkOp, Record<string, string>> = {
      offset: { dist: '5 mm' }, mirror: {}, rpattern: { nx: '3', dx: '20 mm', ny: '1', dy: '20 mm' }, cpattern: { n: '6', angle: '360 deg' },
      move: { dx: '10 mm', dy: '0 mm' }, copy: { dx: '20 mm', dy: '0 mm' }, rotate: { angle: '90 deg', copy: '0' }, scale: { f: '2', copy: '0' },
      fillet: {}, chamfer: {}, text: {},
    };
    s.set({ dialog: { kind: 'skop', op, params: def[op], step: 0 }, tool: op === 'mirror' ? 'skpick' : null });
  },
  emboss: () => {
    const s = S();
    s.openFeatureDialog('extrude');
    s.updateDraft({ distance: '1 mm', op: S().result?.mesh ? 'cut' : 'join' });
    s.notify('Relieve: extrusión corta del texto o perfil (Cortar = grabado, Unir = relieve)');
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
  placeContent: (fam: string, size: string, len: number) => {
    const s = S();
    const F = CONTENT.find((f) => f.id === fam); if (!F) return;
    const doc = F.make(size, len);
    const fn = doc.iProperties.partNumber.replace(/[\\/:*?"<>|]+/g, '_').replace(/ - /g, ' ') + '.i3p';
    const existing = s.docs.find((d) => d.fileName === fn);
    const pid = existing?.id ?? s.addDocument('part', doc, fn, false);
    asmActions.placePart(pid);
    s.notify(`${doc.iProperties.description} colocado`);
  },
  patternComponent: (occId: string, p: Record<string, string>) => {
    const s = S();
    const o = s.asm.occurrences.find((x) => x.id === occId); if (!o) return;
    const ev = (x: string) => { try { return makeEval([])(x); } catch { return NaN; } };
    const AX: Record<string, V3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
    const copies: { pos: V3; quat: [number, number, number, number] }[] = [];
    if (p.kind === 'rect') {
      const n1 = Math.max(1, Math.round(ev(p.n))), d1 = ev(p.d), n2 = p.dir2 ? Math.max(1, Math.round(ev(p.n2))) : 1, d2 = p.dir2 ? ev(p.d2) : 0;
      for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) {
        if (!i && !j) continue;
        const t = v3.add(v3.mul(AX[p.dir], i * d1), p.dir2 ? v3.mul(AX[p.dir2], j * d2) : [0, 0, 0]);
        copies.push({ pos: v3.add(o.xf.pos, t), quat: [...o.xf.quat] as [number, number, number, number] });
      }
    } else {
      const n = Math.max(2, Math.round(ev(p.count))), tot = ev(p.angle), step = Math.abs(tot - 360) < 1e-9 ? 360 / n : tot / (n - 1);
      for (let k = 1; k < n; k++) {
        const rq = qq.axisAngle(AX[p.dir], (step * k * Math.PI) / 180);
        copies.push({ pos: qq.rotate(rq, o.xf.pos), quat: qq.norm(qq.mul(rq, o.xf.quat)) });
      }
    }
    if (copies.length > 400) return s.notify('Demasiados elementos (máx. 400)', 'error');
    const base = o.name.replace(/:\d+$/, '');
    s.commitAsm((a) => {
      let k = a.occurrences.filter((x) => x.part === o.part).length;
      for (const c of copies) a.occurrences.push({ id: uid('o'), name: `${base}:${++k}`, part: o.part, xf: c, grounded: true });
    });
    s.notify(`Patrón: ${copies.length} copias (fijas)`);
  },
  interference: async () => {
    const s = S();
    const ids = [...new Set(s.asm.occurrences.map((o) => o.part))];
    try { const r = await cad.interference(s.asm, s.partsMap(ids)); S().set({ interf: r }); }
    catch (e) { s.notify((e as Error).message, 'error'); }
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

/** Polilíneas, textos y rellenos de la hoja para PDF y DXF (el rayado se convierte en líneas). */
async function sheetEntities() {
  const s = S();
  const { W, H, prims } = await sheetPrims(s);
  const out = { W, H, lines: [] as { cls: string; pts: P2[] }[], fills: [] as P2[][], texts: [] as { x: number; y: number; h: number; text: string; rot?: number; anchor?: string; bold?: boolean }[] };
  for (const p of prims) {
    if (p.t === 'pl') out.lines.push({ cls: p.cls, pts: p.pts });
    else if (p.t === 'circ') { const pts: P2[] = []; for (let i = 0; i <= 64; i++) { const t = (i / 64) * Math.PI * 2; pts.push([p.c[0] + p.r * Math.cos(t), p.c[1] + p.r * Math.sin(t)]); } out.lines.push({ cls: p.cls, pts }); }
    else if (p.t === 'fill') { if (p.cls === 'hatch') { for (const l of hatchLines(p.loops)) out.lines.push({ cls: 'hatch', pts: l }); for (const l of p.loops) out.lines.push({ cls: 'vis', pts: [...l, l[0]] }); } else out.fills.push(...p.loops); }
    else out.texts.push({ x: p.x, y: p.y, h: p.h, text: p.text, rot: p.rot, anchor: p.anchor, bold: p.bold });
  }
  return out;
}

export const drwActions = {
  selView,
  placeBase: async (source: string, dir: DView['dir'], scale: number, hidden: boolean) => {
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
    // Escala automática: la vista base ocupa como mucho ~40 % de la hoja
    const v0 = S().drw.views.find((x) => x.id === id)!;
    const p = getProjection(S(), v0);
    if (p) {
      const pd = await p;
      const bw = pd.bbox[2] - pd.bbox[0], bh = pd.bbox[3] - pd.bbox[1];
      const fit = SCALES.find((k) => bw * k <= W * 0.4 && bh * k <= H * 0.36) ?? SCALES[SCALES.length - 1];
      const sc = Math.min(scale, fit);
      S().commitDrw((d) => { const t = d.views.find((x) => x.id === id); if (!t) return; t.scale = sc; t.x = 30 + (bw * sc) / 2; t.y = H - 32 - (bh * sc) / 2; d.title.scale = scaleLabel(sc); });
    }
  },
  project: async (side: 'right' | 'down' | 'iso' | 'left' | 'up') => {
    const s = S(); const v = selView(); if (!v) return;
    const p = getProjection(s, v); if (!p) return;
    await p;
    const g = viewGeom(S(), v); if (!g) return;
    const w = g.rect[2] - g.rect[0], h = g.rect[3] - g.rect[1];
    const dir = side === 'iso' ? 'iso' : projectedDir(v.dir, side);
    const id = uid('v');
    const nv: DView = { id, name: VIEW_NAMES[dir], source: v.source, dir, scale: v.scale, x: v.x, y: v.y, hidden: side === 'iso' ? false : v.hidden, parent: side === 'iso' ? undefined : v.id, kind: side === 'iso' ? 'iso' : 'proj' };
    const pc = getProjection(s, nv); if (!pc) return;
    await pc;
    const tmp = { ...S(), drw: { ...S().drw, views: [...S().drw.views, nv] } } as typeof s;
    const gc = viewGeom(tmp, nv); if (!gc) return;
    const wc = gc.rect[2] - gc.rect[0], hc = gc.rect[3] - gc.rect[1];
    const [W, H] = SHEETS[s.drw.sheet];
    if (side === 'right') nv.x = v.x + w / 2 + 20 + wc / 2;
    else if (side === 'left') nv.x = v.x - w / 2 - 20 - wc / 2;
    else if (side === 'down') nv.y = v.y - h / 2 - 20 - hc / 2;
    else if (side === 'up') nv.y = v.y + h / 2 + 20 + hc / 2;
    else { nv.x = W - 15 - wc / 2; nv.y = H - 15 - hc / 2; }
    s.commitDrw((d) => { d.views.push(nv); });
    useStore.setState({ selItem: id });
  },
  autoCenters: () => { const s = S(); const v = selView(); if (!v) return s.notify('Selecciona una vista', 'error'); s.commitDrw((d) => { const t = d.views.find((x) => x.id === v.id)!; t.centers = !t.centers; }); },
  flipSection: () => {
    const s = S(); const v = selView(); if (!v || v.kind !== 'section' || !v.section) return;
    s.commitDrw((d) => {
      const t = d.views.find((x) => x.id === v.id)!; const sc = t.section!;
      const pv = d.views.find((x) => x.id === t.parent);
      const n = v3.mul(sc.normal, -1), x = v3.mul(sc.x, -1), n2: [number, number] = [-sc.n2[0], -sc.n2[1]];
      t.section = { ...sc, normal: n, x, n2 };
      if (pv) { t.x = pv.x + (t.x - pv.x) * -1; t.y = pv.y + (t.y - pv.y) * -1; }
    });
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
    const layerOf: Record<string, string> = { frame: 'MARCO', tb: 'MARCO', vis: 'VISIBLES', hid: 'OCULTAS', dim: 'COTAS', center: 'EJES', cutline: 'EJES', hatch: 'RAYADO', thin: 'ANOTACIONES', thick: 'ANOTACIONES', ann: 'ANOTACIONES', cutend: 'ANOTACIONES' };
    const doc: DxfDoc = {
      layers: [{ name: 'MARCO', color: 7 }, { name: 'VISIBLES', color: 7 }, { name: 'OCULTAS', color: 8, ltype: 'DASHED' }, { name: 'COTAS', color: 3 }, { name: 'EJES', color: 1, ltype: 'CENTER' }, { name: 'RAYADO', color: 9 }, { name: 'ANOTACIONES', color: 4 }, { name: 'TEXTO', color: 7 }],
      lines: [...e.lines.map((l) => ({ layer: layerOf[l.cls] ?? 'ANOTACIONES', pts: l.pts })), ...e.fills.map((f) => ({ layer: 'COTAS', pts: [...f, f[0]] }))],
      texts: e.texts.map((t) => ({ layer: 'TEXTO', x: t.anchor === 'middle' ? t.x - t.text.length * t.h * 0.3 : t.anchor === 'end' ? t.x - t.text.length * t.h * 0.6 : t.x, y: t.y, h: t.h, text: t.text, rot: t.rot })),
    };
    await saveText(writeDxf(doc), s.fileName.replace(/\.[^.]+$/, '.dxf'), 'DXF', '.dxf', 'application/dxf');
  },
  exportPdf: async () => {
    const s = S();
    const e = await sheetEntities();
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: e.W > e.H ? 'landscape' : 'portrait', unit: 'mm', format: [e.W, e.H] });
    const Y = (y: number) => e.H - y;
    const W: Record<string, number> = { frame: 0.5, tb: 0.35, vis: 0.5, hid: 0.25, dim: 0.18, center: 0.18, cutline: 0.18, hatch: 0.13, thin: 0.18, thick: 0.6, ann: 0.35, cutend: 0.7 };
    const DASH: Record<string, number[]> = { hid: [2, 1], center: [6, 1, 1, 1], cutline: [6, 1, 1, 1] };
    for (const l of e.lines) {
      pdf.setLineWidth(W[l.cls] ?? 0.25); pdf.setLineDashPattern(DASH[l.cls] ?? [], 0);
      for (let i = 0; i + 1 < l.pts.length; i++) pdf.line(l.pts[i][0], Y(l.pts[i][1]), l.pts[i + 1][0], Y(l.pts[i + 1][1]));
    }
    pdf.setLineDashPattern([], 0); pdf.setFillColor(0, 0, 0);
    for (const f of e.fills) if (f.length >= 3) pdf.triangle(f[0][0], Y(f[0][1]), f[1][0], Y(f[1][1]), f[2][0], Y(f[2][1]), 'F');
    for (const t of e.texts) {
      pdf.setFont('helvetica', t.bold ? 'bold' : 'normal'); pdf.setFontSize(t.h * 2.83);
      pdf.text(t.text, t.x, Y(t.y), { angle: t.rot ?? 0, align: (t.anchor === 'middle' ? 'center' : t.anchor === 'end' ? 'right' : 'left') as 'left' });
    }
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
    style.textContent = `.sh-paper{fill:#fff}.sh-frame,.tb-cell{fill:none;stroke:#000;stroke-width:.35}.ln-vis{fill:none;stroke:#000;stroke-width:.35}.ln-hid{fill:none;stroke:#555;stroke-width:.18;stroke-dasharray:1.5 1}.ln-dim{fill:none;stroke:#000;stroke-width:.18}.arrow{fill:#000}text{font-family:Arial,sans-serif;fill:#000}.dim-text{font-size:3.5px}.view-label{font-size:3px}.tb-label{font-size:1.8px;fill:#555}.tb-val{font-size:2.5px}.tb-big{font-size:5px;font-weight:bold}.sel-box,.snap-pt,.snap-hover{display:none}.proj-sym *{fill:none;stroke:#000;stroke-width:.25}.ln-center,.ln-cut{fill:none;stroke:#000;stroke-width:.18;stroke-dasharray:6 1 1 1}.ln-thin{fill:none;stroke:#000;stroke-width:.18}.ln-thick{fill:none;stroke:#000;stroke-width:.7}.ln-ann{fill:none;stroke:#000;stroke-width:.35}.hatch{fill:url(#hatch45)}.view-hit{fill:none;stroke:none}.ln-preview,.snap-circle,.snap-seg{display:none}*{vector-effect:none!important}`;
    clone.insertBefore(style, clone.firstChild);
    await saveText(new XMLSerializer().serializeToString(clone), s.fileName.replace(/\.[^.]+$/, '.svg'), 'SVG', '.svg', 'image/svg+xml');
  },
};
