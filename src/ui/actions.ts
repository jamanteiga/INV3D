import { normalizeAsm } from '../core/subasm';
import { recR, K_DEFAULT } from '../core/sheetrec';
import { autoEPointJoints, partEPoints, epJoint, epRef, type EPoint } from '../core/epoints';
import * as R from './hvacroute';
const partOf = (s: ReturnType<typeof useStore.getState>, id: string): PartDoc | null => { const d = s.docData(id) as PartDoc | null; return d && d.format === 'inv3d.part' ? d : null; };
import { docGetter } from '../core/store';
// Acciones de los comandos de la cinta (pieza, ensamblaje y plano).
import { useStore, type SkOp } from '../core/store';
import { uid, v3, newDoc, MATERIALS, planeFrame, resolveWorkPlanes, docParams, entityOutline, type V3, type SketchF, type PartDoc, type SkEntity, type Frame } from '../core/doc';
import { IDENTITY, auxName, solveAssembly, patternPoses, mirrorPose, xfPoint, q as qq, q, type Occurrence, type Joint, type FrameMember, type BoltGroup, type EndType, type Xform } from '../core/asm';
import { CONTENT } from '../core/content';
import { FASTENER_SIZES, fsize, planFix, makeBolt, makeStud, makeNut, makeWasher, quatZTo, type FStd, type FixKind } from '../core/fasteners';
import { makeEval, fmt } from '../core/expr';
import { cad, type MeshData } from '../core/cadClient';
import { projectedDir, drawStyle, SHEETS, SCALES, VIEW_NAMES, scaleLabel, allPages, loadPage, extractPage, type DView, type TableKind } from '../core/drawing';
import { writeDxf, type DxfDoc } from '../core/dxf';
import { saveText } from '../core/files';
import { getProjection, viewGeom, sheetPrims } from './DrawingView';
import { hatchLines } from '../core/sheet';

import type { P2 } from '../core/svgpath';
import type { CandLine } from './AsmViewport';

const S = () => useStore.getState();

function P_style(st: 'construction' | 'center') {
  const s = S();
  const sk = s.doc.features.find((f) => f.id === s.sketchId) as SketchF | undefined;
  const ids = s.selEntities.length ? s.selEntities : s.selEntity ? [s.selEntity] : [];
  if (!sk) return;
  if (!ids.length) { s.set({ skStyle: s.skStyle === st ? 'normal' : st }); return; }
  const first = sk.entities.find((x) => x.id === ids[0]);
  const on = st === 'center' ? !(first && first.type === 'line' && first.center) : !(first?.construction && !(first.type === 'line' && first.center));
  s.sketchCommit((k) => {
    for (const x of k.entities) {
      if (!ids.includes(x.id) || x.type === 'point' || x.type === 'text') continue;
      if (st === 'center') { if (x.type !== 'line') continue; x.center = on; x.construction = on; }
      else { x.center = false; x.construction = on; }
    }
  });
}

export const partActions = {
  /** Modelo 3D › Convertir a chapa: la primera extrusión de placa pasa a Cara de chapa con su espesor */
  convertToSheet: () => {
    const s = S();
    if (s.doc.sheet) { s.notify('La pieza ya es de chapa (pestaña Chapa)', 'info'); return; }
    const ev = makeEval(docParams(s.doc));
    const ex = s.doc.features.find((f) => f.type === 'extrude' && !f.suppressed && (f.op === 'new' || f.op === 'join') && (f.extent ?? 'distance') === 'distance');
    let t = 2;
    if (ex && ex.type === 'extrude') { try { t = ev(ex.distance); } catch { /* */ } }
    if (!(t > 0) || t > 25) t = 2;
    const r = recR(t);
    S().commit((d) => {
      d.sheet = { t: `${t} mm`, r: `${r} mm`, k: String(K_DEFAULT) };
      const i = ex ? d.features.findIndex((f) => f.id === ex.id) : -1;
      if (i >= 0 && ex && ex.type === 'extrude') {
        const sym = ex.dir === 'symmetric', rev = ex.dir === 'reverse';
        d.features[i] = { id: ex.id, name: ex.name.replace(/Extrusión/i, 'Cara'), type: 'sm_face', profile: ex.profile };
        if (sym || rev) {
          // la cara de chapa crece hacia +normal desde el boceto: se desplaza el boceto para conservar la posición
          const sk = d.features.find((f) => f.id === ex.profile);
          if (sk && sk.type === 'sketch' && sk.plane.kind === 'std') sk.plane = { ...sk.plane, offset: `(${sk.plane.offset || '0'}) - ${sym ? t / 2 : t}` };
        }
      }
    });
    S().notify(ex ? `Convertida a chapa: ${ex.name} es ahora la cara base (t = ${t} mm, R = ${r} mm). Pestaña Chapa` : `Pieza de chapa (t = ${t} mm). Crea la cara base con Chapa › Cara`);
  },
  /** Modelo 3D › Simplificar: pieza nueva con la envolvente o sin taladros pequeños */
  makeSimplified: (mode: 'bbox' | 'cyl' | 'holes', axis: 'X' | 'Y' | 'Z', holeMax: string) => {
    const s = S();
    const src = s.doc, srcName = s.fileName;
    const nd = newDoc();
    nd.iProperties = { ...src.iProperties, partNumber: src.iProperties.partNumber + '-SIMP', description: `${src.iProperties.description || src.iProperties.partNumber} (simplificada)` };
    nd.features = [{ id: uid('f'), name: 'Simplificación', type: 'simplify', source: s.active, sourceName: srcName, doc: structuredClone(src), mode, axis, holeMax }];
    s.addDocument('part', nd, srcName.replace(/\.i3p$/i, '') + '-SIMP.i3p', true);
    s.notify('Pieza simplificada creada en una pestaña nueva');
  },
  /** Chapa › Desarrollo: crea (si no existe) el patrón plano y lo muestra en el visor; si ya se ve, vuelve al modelo plegado */
  flatPattern: () => {
    const s = S();
    if (!s.doc.sheet) return;
    if (s.flatView) { useStore.setState({ flatView: false }); return; }
    if (s.mode === 'sketch') s.finishSketch();
    if (S().dialog) S().closeDialog();
    if (!S().doc.sheet?.flat) S().commit((d) => { if (d.sheet) d.sheet.flat = true; });
    useStore.setState({ flatView: true });
  },
  /** Chapa › Definir cara A: la cara plana seleccionada es la cara A del desarrollo */
  defineASide: () => {
    const s = S();
    const pl = s.selFacePlane;
    if (!pl || pl.kind !== 'custom') { s.notify('Haz clic en una cara plana de la chapa y vuelve a pulsar «Definir cara A»', 'info'); return; }
    s.commit((d) => { if (d.sheet) d.sheet.aSide = [...pl.normal] as V3; });
    s.notify('Cara A definida: el desarrollo se ve desde esa cara');
  },
  /** Chapa › Crear pieza: pieza derivada (copia asociada en el momento) de la chapa activa */
  makePart: () => {
    const s = S();
    const src = s.doc, srcName = s.fileName;
    const nd = newDoc();
    nd.iProperties = { ...src.iProperties, partNumber: src.iProperties.partNumber + '-DER', description: `${src.iProperties.description || src.iProperties.partNumber} (derivada)` };
    nd.features = [{ id: uid('f'), name: 'Derivada', type: 'derive', source: s.active, sourceName: srcName, doc: structuredClone(src), scale: '1', mirror: '', op: 'join' }];
    s.addDocument('part', nd, srcName.replace(/\.i3p$/i, '') + '-DER.i3p', true);
    s.notify('Pieza derivada creada');
  },
  /** Chapa › Crear componentes: una pieza por cuerpo y un ensamblaje con todas en su sitio */
  makeComponents: () => {
    const s = S();
    const n = s.result?.props?.bodies ?? 1;
    if (n < 2) { s.notify('La pieza tiene un solo cuerpo. Crea varios cuerpos con «Nuevo sólido» (Combinar, Extrusión…) para separarlos en componentes', 'info'); return; }
    const src = s.doc, srcName = s.fileName, base = srcName.replace(/\.i3p$/i, '');
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const nd = newDoc();
      nd.iProperties = { ...src.iProperties, partNumber: `${src.iProperties.partNumber}-${i + 1}`, description: `${src.iProperties.description || src.iProperties.partNumber} · cuerpo ${i + 1}` };
      nd.features = [{ id: uid('f'), name: `Cuerpo ${i + 1}`, type: 'derive', source: s.active, sourceName: srcName, doc: structuredClone(src), scale: '1', mirror: '', op: 'join', body: i }];
      ids.push(s.addDocument('part', nd, `${base}-${i + 1}.i3p`, false));
    }
    S().newDocument('assembly');
    S().commitAsm((a) => { ids.forEach((pid, i) => a.occurrences.push({ id: uid('o'), name: `${base}-${i + 1}:1`, part: pid, xf: { ...IDENTITY, pos: [0, 0, 0], quat: [0, 0, 0, 1] }, grounded: true })); });
    S().notify(`${n} componentes creados en un ensamblaje nuevo`);
  },
  /** SCU: punto, tres planos y tres ejes de trabajo de un sistema de coordenadas de usuario */
  addUcs: (o: V3, rz: number, rx: number) => {
    const s = S();
    const rad = Math.PI / 180, cz = Math.cos(rz * rad), sz = Math.sin(rz * rad), cx = Math.cos(rx * rad), sx = Math.sin(rx * rad);
    // giro Z y luego X (sobre el nuevo eje X)
    const X: V3 = [cz, sz, 0];
    const Y: V3 = [-sz * cx, cz * cx, sx];
    const Z: V3 = v3.cross(X, Y);
    const r6 = (v: V3) => v.map((x) => Math.round(x * 1e6) / 1e6) as V3;
    const str = (v: V3) => r6(v).map(String) as [string, string, string];
    let k = 1; const names = new Set(s.doc.features.map((f) => f.name)); while (names.has(`SCU${k} XY`)) k++;
    const N = `SCU${k}`;
    s.commit((d) => {
      d.features.push({ id: uid('f'), name: `${N} origen`, type: 'workpoint', origin: str(o) });
      for (const [nm, x, nrm] of [['XY', X, Z], ['XZ', X, v3.mul(Y, -1)], ['YZ', Y, X]] as [string, V3, V3][])
        d.features.push({ id: uid('f'), name: `${N} ${nm}`, type: 'workplane', base: { kind: 'custom', label: `${N} ${nm}`, origin: r6(o), xDir: r6(x), normal: r6(nrm) }, offset: '0 mm', angle: '0 deg' });
      for (const [nm, dv] of [['X', X], ['Y', Y], ['Z', Z]] as [string, V3][])
        d.features.push({ id: uid('f'), name: `${N} eje ${nm}`, type: 'workaxis', origin: str(o), dir: str(dv) });
    });
    s.notify(`${N}: origen, planos XY/XZ/YZ y ejes X/Y/Z creados`);
  },
  startSketch: () => {
    const s = S();
    // cara plana seleccionada antes: boceto directamente en ella
    if (s.mode !== 'sketch' && !s.tool && s.selFacePlane) { const pl = s.selFacePlane; s.set({ selFacePlane: null }); s.startSketch(pl); return; }
    if (s.mode === 'sketch') s.finishSketch(); s.setTool(s.tool === 'pickPlane' ? null : 'pickPlane');
  },
  /** Con selección: cambia el estilo de lo seleccionado. Sin selección: estilo para la geometría que se dibuje a continuación */
  toggleConstruction: () => P_style('construction'),
  toggleCenterline: () => P_style('center'),
  /** Proyecta toda la geometría de otro boceto (otra operación) sobre el boceto activo, como referencia fija */
  projectSketch: (srcId: string) => {
    const s = S();
    const sk = s.doc.features.find((f) => f.id === s.sketchId) as SketchF | undefined;
    const src = s.doc.features.find((f) => f.id === srcId) as SketchF | undefined;
    if (!sk || !src || src.type !== 'sketch') return;
    const ev = (x: string) => { try { return makeEval(docParams(s.doc))(x); } catch { return NaN; } };
    const W = resolveWorkPlanes(s.doc, ev);
    let A: Frame, B: Frame; try { A = planeFrame(src.plane, ev, W); B = planeFrame(sk.plane, ev, W); } catch { return s.notify('Plano no válido', 'error'); }
    const f3 = (x: number) => String(Math.round(x * 1000) / 1000);
    const toB = (u: number, v: number): [number, number] => { const P = v3.add(A.origin, v3.add(v3.mul(A.xDir, u), v3.mul(A.yDir, v))); const d = v3.sub(P, B.origin); return [v3.dot(d, B.xDir), v3.dot(d, B.yDir)]; };
    const par = Math.abs(Math.abs(v3.dot(A.normal, B.normal)) - 1) < 1e-6, flip = v3.dot(A.normal, B.normal) < 0;
    const ang = (p: [number, number], c: [number, number]) => Math.atan2(p[1] - c[1], p[0] - c[0]) * 180 / Math.PI;
    const out: SkEntity[] = [];
    for (const e of src.entities) {
      if (e.type === 'text') continue;
      if (e.type === 'point') { const p = toB(ev(e.cx), ev(e.cy)); out.push({ id: uid('pp'), type: 'point', cx: f3(p[0]), cy: f3(p[1]), ref: true } as SkEntity); continue; }
      if (e.type === 'line') { const a = toB(ev(e.a[0]), ev(e.a[1])), b = toB(ev(e.b[0]), ev(e.b[1])); if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue; out.push({ id: uid('pl'), type: 'line', a: [f3(a[0]), f3(a[1])], b: [f3(b[0]), f3(b[1])], ref: true, construction: e.construction, center: e.center } as SkEntity); continue; }
      if (par && e.type === 'circle') { const c = toB(ev(e.cx), ev(e.cy)); out.push({ id: uid('pc'), type: 'circle', cx: f3(c[0]), cy: f3(c[1]), d: f3(ev(e.d)), ref: true, construction: e.construction } as SkEntity); continue; }
      if (par && e.type === 'arc') {
        const cx = ev(e.cx), cy = ev(e.cy), r = ev(e.r), a0 = ev(e.a0) * Math.PI / 180, a1 = ev(e.a1) * Math.PI / 180;
        const c = toB(cx, cy), p0 = toB(cx + r * Math.cos(a0), cy + r * Math.sin(a0)), p1 = toB(cx + r * Math.cos(a1), cy + r * Math.sin(a1));
        const [s0, s1] = flip ? [ang(p1, c), ang(p0, c)] : [ang(p0, c), ang(p1, c)];
        out.push({ id: uid('pa'), type: 'arc', cx: f3(c[0]), cy: f3(c[1]), r: f3(r), a0: f3(s0), a1: f3(s1), ref: true, construction: e.construction } as SkEntity); continue;
      }
      let o; try { o = entityOutline(e, ev); } catch { continue; }
      const pts = o.pts.map((q) => toB(q[0], q[1]));
      if (pts.length < 2) continue;
      if (o.closed || pts.length > 2) {
        // polígonos y rectángulos: segmentos; curvas: spline por puntos
        const curve = e.type === 'spline' || e.type === 'ellipse' || e.type === 'circle' || e.type === 'arc' || e.type === 'slot';
        if (!curve) { const n = pts.length; for (let i = 0; i < (o.closed ? n : n - 1); i++) { const a = pts[i], b = pts[(i + 1) % n]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6) out.push({ id: uid('pl'), type: 'line', a: [f3(a[0]), f3(a[1])], b: [f3(b[0]), f3(b[1])], ref: true, construction: e.construction } as SkEntity); } continue; }
        const step = Math.max(1, Math.floor(pts.length / 32)), sp = pts.filter((_, i) => i % step === 0);
        out.push({ id: uid('ps'), type: 'spline', pts: sp.map((p) => [f3(p[0]), f3(p[1])] as [string, string]), closed: o.closed, ref: true, construction: e.construction } as SkEntity);
      }
    }
    if (!out.length) return s.notify('Nada que proyectar', 'error');
    s.sketchCommit((k) => { k.entities.push(...out); });
    s.notify(`Proyectadas ${out.length} entidades de «${src.name}» (referencia fija)`);
  },
  /** Proyecta los ejes principales X, Y, Z (y el origen) sobre el plano del boceto como geometría de referencia */
  projectAxes: () => {
    const s = S();
    const sk = s.doc.features.find((f) => f.id === s.sketchId) as SketchF | undefined;
    if (!sk) return;
    const ev = (x: string) => { try { return makeEval(docParams(s.doc))(x); } catch { return NaN; } };
    let fr: Frame; try { fr = planeFrame(sk.plane, ev, resolveWorkPlanes(s.doc, ev)); } catch { return s.notify('Plano del boceto no válido', 'error'); }
    const L = 100, f3 = (x: number) => String(Math.round(x * 1000) / 1000);
    const uv = (p: V3): [number, number] => { const d = v3.sub(p, fr.origin); return [v3.dot(d, fr.xDir), v3.dot(d, fr.yDir)]; };
    const ents: SkEntity[] = [];
    for (const [n, ax] of [['X', [1, 0, 0]], ['Y', [0, 1, 0]], ['Z', [0, 0, 1]]] as [string, V3][]) {
      const a = uv(v3.mul(ax, -L)), b = uv(v3.mul(ax, L));
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) {
        // eje normal al plano: se proyecta como punto
        ents.push({ id: uid('pax'), type: 'point', cx: f3(a[0]), cy: f3(a[1]), ref: true } as SkEntity); continue;
      }
      if (sk.entities.some((e) => e.type === 'line' && e.ref && e.center && (e as any).axis === n)) continue;
      ents.push({ id: uid('pax'), type: 'line', a: [f3(a[0]), f3(a[1])], b: [f3(b[0]), f3(b[1])], ref: true, center: true, construction: true, axis: n } as SkEntity);
    }
    if (!ents.length) return s.notify('Los ejes ya están proyectados');
    s.sketchCommit((k) => { k.entities.push(...ents); });
    s.notify(`Ejes proyectados: ${ents.length}`);
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
/** Pose de b expresada en el sistema de a (a⁻¹·b) */
function rel(a: Xform, b: Xform): Xform {
  const qi: [number, number, number, number] = [-a.quat[0], -a.quat[1], -a.quat[2], a.quat[3]];
  return { pos: q.rotate(qi, [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]]), quat: q.mul(qi, b.quat) };
}
/** Une varias mallas transformadas en una sola (para mostrar y seleccionar el contexto del ensamblaje). */
function mergeMeshes(list: { m: MeshData; xf: Xform }[]): MeshData {
  let nv = 0, nt = 0, nl = 0;
  for (const { m } of list) { nv += m.vertices.length; nt += m.triangles.length; nl += m.lines.length; }
  const V = new Float32Array(nv), N = new Float32Array(nv), T = new Uint32Array(nt), L = new Float32Array(nl);
  const fg: MeshData['faceGroups'] = [], eg: MeshData['edgeGroups'] = [];
  let ov = 0, ot = 0, ol = 0, fid = 0, eid = 0;
  for (const { m, xf } of list) {
    for (let i = 0; i < m.vertices.length; i += 3) {
      const p = xfPoint(xf, [m.vertices[i], m.vertices[i + 1], m.vertices[i + 2]]), n = q.rotate(xf.quat, [m.normals[i], m.normals[i + 1], m.normals[i + 2]]);
      V.set(p, ov + i); N.set(n, ov + i);
    }
    for (let i = 0; i < m.lines.length; i += 3) L.set(xfPoint(xf, [m.lines[i], m.lines[i + 1], m.lines[i + 2]]), ol + i);
    const base = ov / 3;
    for (let i = 0; i < m.triangles.length; i++) T[ot + i] = m.triangles[i] + base;
    for (const g of m.faceGroups) fg.push({ start: g.start + ot, count: g.count, faceId: fid++ });
    for (const g of m.edgeGroups) eg.push({ start: g.start + ol / 3, count: g.count, edgeId: eid++ });
    ov += m.vertices.length; ot += m.triangles.length; ol += m.lines.length;
  }
  return { vertices: V, normals: N, triangles: T, faceGroups: fg, lines: L, edgeGroups: eg };
}
/** Nombre libre «Pieza:n» para una nueva ocurrencia de la pieza. */
function occName(a: { occurrences: { name: string }[] }, partId: string) {
  const base = (S().docs.find((d) => d.id === partId)?.fileName ?? 'Pieza').replace(/\.[^.]+$/, '');
  let k = 1; while (a.occurrences.some((o) => o.name === `${base}:${k}`)) k++;
  return `${base}:${k}`;
}
export const asmActions = {
  createPart: () => {
    const s = S();
    const asmId = s.active;
    const d = newDoc();
    const n = s.docs.filter((x) => x.kind === 'part').length + 1;
    d.iProperties.partNumber = `Pieza${n}`;
    const pid = s.addDocument('part', d, `Pieza${n}.i3p`, false);
    const oid = uid('o');
    // la pieza nueva queda fija donde se crea y se edita en contexto
    s.commitAsm((a) => { a.occurrences.push({ id: oid, name: `Pieza${n}:1`, part: pid, xf: { ...IDENTITY }, grounded: true }); });
    void asmId;
    asmActions.editInPlace(oid);
    const c = S().ctxEdit; if (c) useStore.setState({ ctxEdit: { ...c, isNew: true } });
    S().setTool('pickPlane');
    S().notify('Pieza nueva en contexto: elige una cara de otro componente o un plano para el primer boceto · «Volver» para regresar al ensamblaje');
  },
  /** Edición en contexto: la pieza se edita viendo el resto del ensamblaje en transparente.
   *  Sus caras sirven como plano de boceto y sus aristas se pueden proyectar (sin actualización automática). */
  editInPlace: (occId: string) => {
    const s = S(); const r = s.asmResult;
    const flat = (r?.view?.occurrences ?? s.asm.occurrences) as (Occurrence & { sub?: string })[];
    const me = flat.find((o) => o.id === occId) ?? s.asm.occurrences.find((o) => o.id === occId);
    if (!me) return;
    const X = r?.xf[me.id] ?? me.xf;
    const meshes: { m: MeshData; xf: Xform }[] = [];
    for (const o of flat) {
      if (o.id === me.id || o.suppressed || o.hidden) continue;
      const m = r?.occCut[o.id]?.mesh ?? r?.parts[o.part]?.mesh; if (!m) continue;
      meshes.push({ m, xf: rel(X, r?.xf[o.id] ?? o.xf) });
    }
    for (const fm of r?.members ?? []) meshes.push({ m: fm.mesh, xf: rel(X, IDENTITY) });
    useStore.setState({ ctxEdit: { asm: s.active, occ: me.id, part: me.part, asmName: s.fileName, mesh: meshes.length ? mergeMeshes(meshes) : null } });
    s.activate(me.part);
  },
  /** Termina la edición en contexto y vuelve al ensamblaje (la pestaña de la pieza se cierra; sigue en memoria). */
  returnToAsm: () => {
    const s = S(); const c = s.ctxEdit; if (!c) return;
    if (s.mode === 'sketch') s.finishSketch();
    const solid = !!S().result?.props?.volume;
    useStore.setState({ ctxEdit: null });
    s.activate(c.asm);
    S().hideDocument(c.part);
    if (!c.isNew) return;
    if (!solid) {
      // pieza nueva sin sólido: se descarta
      S().commitAsm((a) => { a.occurrences = a.occurrences.filter((o) => o.id !== c.occ); });
      S().closeDocument(c.part);
      S().notify('Pieza nueva sin sólido: se ha descartado');
      return;
    }
    // libre para poder restringirla donde interese; se pide guardarla
    S().commitAsm((a) => { const o = a.occurrences.find((x) => x.id === c.occ); if (o) o.grounded = false; });
    useStore.setState({ dialog: { kind: 'savenewpart', part: c.part, occ: c.occ } });
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
  /** Colocar: el primer componente queda fijo en el origen; después cada copia sigue al cursor y se suelta con un clic.
   *  Esc o clic derecho terminan. X/Y/Z giran 90° la copia pendiente. */
  /** Crear componente: 1) geometría de un componente (ePoint o cara), 2) centro de contenido HVAC / Mecánica o pieza modelada, 3) restricción automática */
  createComponent: (cat: 'hvac' | 'mech' | null = null) => {
    const s = S(); if (s.kind !== 'assembly') return;
    useStore.setState({ createCat: cat, reattach: null });
    if (s.placing) s.setTool(null);
    useStore.setState({ createTarget: null });
    if (!s.asm.occurrences.some((o) => !o.suppressed)) { s.open({ kind: 'createcomp' }); return; }
    s.setTool('asmCreatePick');
    s.notify(`Crear componente${cat === 'hvac' ? ' HVAC' : cat === 'mech' ? ' de Mecánica' : ''}: elige la geometría de un componente donde irá la pieza (ePoint o cara) · Esc: sin referencia`);
  },
  /** Coloca la pieza del centro de contenido restringida a la geometría elegida en «Crear componente» */
  placeAtTarget: (partId: string, extras: string[] = [], opts: { noRecurse?: boolean } = {}): boolean => {
    const s = S(); const T = s.createTarget; if (!T || s.kind !== 'assembly') return false;
    const e = s.docs.find((d) => d.id === partId); if (!e) return false;
    useStore.setState({ createTarget: null });
    const pd = partOf(s, partId)!;
    const eps = partEPoints(pd).filter((x) => !x.inactive && x.kind !== 'composite');
    const own = eps.filter((x) => !x.isDefault);
    const base = e.fileName.replace(/\.[^.]+$/, '');
    const conj = (a: [number, number, number, number]): [number, number, number, number] => [-a[0], -a[1], -a[2], a[3]];
    let ne: EPoint | undefined;
    let xf: Xform = { pos: [...T.pW] as V3, quat: [0, 0, 0, 1] };
    const F = T.ep ? R.epFrame(T.occ, T.ep) : null;
    if (F) {
      // boca contra boca: entrada de la pieza nueva, encajada (W con W) y girada hacia el giro elegido
      ne = R.inletFor(pd, F);
      if (ne) xf = R.placeOnFrame(F, pd, ne, R.turnOf(F));
    } else {
      // ePoint de la pieza nueva: el del mismo tipo que el elegido (o inserción si la cara es cilíndrica); si no, el de inserción
      const wantInsert = T.epKind ? T.epKind === 'insert' : T.ref.kind === 'axis';
      ne = own.find((x) => (x.kind === 'insert') === wantInsert) ?? own[0] ?? eps[0];
      // posición inicial: el ePoint de la pieza sobre el punto elegido y con su dirección opuesta a la normal
      if (ne) { const quat = qq.mul(quatZTo(v3.mul(T.nW, -1)), conj(quatZTo(v3.norm(ne.dir)))); xf = { pos: v3.sub(T.pW, qq.rotate(quat, ne.point)), quat }; }
    }
    const occ = uid('o'); let jn = '';
    s.commitAsm((a) => {
      let k = 1; while (a.occurrences.some((o) => o.name === `${base}:${k}`)) k++;
      a.occurrences.push({ id: occ, name: `${base}:${k}`, part: partId, xf: { pos: [...xf.pos] as V3, quat: [...xf.quat] as Xform['quat'] } });
      for (const x of extras) a.occurrences.push({ id: uid('o'), name: occName(a, x), part: x, xf: { pos: [...xf.pos] as V3, quat: [...xf.quat] as Xform['quat'] } });
      if (!ne) return;
      let j: Joint;
      if (T.ep) {
        const ob = a.occurrences.find((o) => o.id === T.occ);
        const te = ob && partEPoints(partOf(S(), ob.part)).find((x) => x.id === T.ep);
        if (!te) return;
        j = epJoint(a, occ, ne, T.occ, te, uid);
        // bocas sin sección (tubería): se bloquea el giro sobre el eje con la orientación con la que se ha colocado
        if (j.type === 'insert' && !j.lock && F) {
          const Xt = S().asmResult?.xf[T.occ] ?? ob!.xf, W: V3 = [F.X.x, F.X.y, F.X.z];
          const loc = (q: [number, number, number, number]) => v3.norm(qq.rotate(conj(q), W));
          const xd = (o: string) => (o === occ ? loc(xf.quat as [number, number, number, number]) : loc(Xt.quat as [number, number, number, number]));
          j = { ...j, lock: true, a: { ...j.a, xdir: xd(j.a.occ) }, b: { ...j.b, xdir: xd(j.b.occ) } };
        }
      } else {
        const nr = epRef(ne, occ);
        const b = T.ref.kind === 'axis' && ne.kind === 'insert' ? nr : { occ, point: ne.point, normal: ne.dir, kind: 'plane' as const, xdir: nr.xdir };
        j = { id: uid('j'), name: `Unión${a.joints.length + 1}`, type: T.ref.kind === 'axis' && ne.kind === 'insert' ? 'insert' : 'mate', a: T.ref, b, offset: '0 mm', angle: '0 deg', aligned: T.ref.kind === 'axis' ? false : undefined };
      }
      a.joints.push(j); jn = `${j.name} (${j.type === 'insert' ? 'Insertar' : 'Coincidir'})`;
    });
    useStore.setState({ selItem: occ, dialog: null, tool: null });
    // recursivo: la siguiente boca libre de la pieza nueva pasa a ser la referencia y se vuelve a abrir el centro de contenido
    const nx = ne && S().createRecursive && !opts.noRecurse ? R.nextPort(pd, ne) : undefined;
    if (nx) {
      const F2 = R.epFrame(occ, nx.id);
      if (F2) {
        useStore.setState({ createTarget: { occ, ref: epRef(nx, occ), ep: nx.id, epKind: nx.kind, label: `${base}:… · ${nx.name}`, pW: [F2.P.x, F2.P.y, F2.P.z], nW: [F2.D.x, F2.D.y, F2.D.z] }, dialog: { kind: 'createcomp' } });
        s.notify(`${base} colocada y restringida (${jn}). Siguiente pieza desde su boca libre · desactiva «Recursivo» o pulsa Terminar para acabar`);
        return true;
      }
    }
    if (ne?.isDefault && T.ep) { s.notify(`${base} no tiene bocas (ePoints propios): se ha unido por su ePoint de inserción (origen). Define sus ePoints en la pieza (Modelo 3D › ePoint) o ajústala con Restringir (R)`, 'error'); return true; }
    s.notify(jn ? `${base} colocada y restringida a ${T.label} · ${jn}. Ajusta o añade restricciones con Restringir (R)` : `${base} colocada en ${T.label} (sin ePoint propio: restríngela con Restringir)`);
    return true;
  },
  startPlace: (partId: string, extras: string[] = [], firstAt?: { pos: [number, number, number]; quat?: [number, number, number, number]; grounded: boolean; label?: string }) => {
    const s = S();
    if (s.kind !== 'assembly') return;
    const e = s.docs.find((d) => d.id === partId); if (!e) return;
    void import('../core/fdp').then((m) => { for (const x of [partId, ...extras]) void m.saveContentPart(x); });
    if (s.createTarget && asmActions.placeAtTarget(partId, extras)) return;
    // Filosofía Foran: la pieza entra ya unida por ePoints a la boca libre de la pieza seleccionada (o de la última)
    if ((s.settings.insertMode ?? 'foran') === 'foran' && s.asm.occurrences.length) {
      const T = foranTarget(s.selItem);
      if (T) {
        if (s.placing) s.setTool(null);
        useStore.setState({ createTarget: T });
        if (asmActions.placeAtTarget(partId, extras, { noRecurse: true })) return;
      } else s.notify('Inserción espacial: no hay ninguna boca (ePoint) libre a la que unir la pieza; se coloca con el cursor', 'error');
    }
    if (s.placing) s.setTool(null);
    const base = e.fileName.replace(/\.[^.]+$/, '');
    const nextName = (a: { occurrences: { name: string }[] }) => { let k = 1; while (a.occurrences.some((o) => o.name === `${base}:${k}`)) k++; return `${base}:${k}`; };
    const first = !s.asm.occurrences.length;
    // primer componente: se pregunta el ePoint, el punto de destino y la orientación
    if (first && !firstAt) { if (s.placing) s.setTool(null); useStore.setState({ dialog: { kind: 'firstplace', pid: partId, extras } }); return; }
    const occ = uid('o');
    s.commitAsm((a) => {
      if (first) {
        // primer componente: por su ePoint (u origen) en las coordenadas indicadas (por defecto 0,0,0)
        const xf0 = firstAt ? { pos: [...firstAt.pos] as [number, number, number], quat: [...(firstAt.quat ?? [0, 0, 0, 1])] as [number, number, number, number] } : { ...IDENTITY };
        const g = firstAt ? firstAt.grounded : true;
        a.occurrences.push({ id: uid('o'), name: nextName(a), part: partId, xf: xf0, grounded: g });
        for (const x of extras) a.occurrences.push({ id: uid('o'), name: occName(a, x), part: x, xf: { pos: [...xf0.pos], quat: [...xf0.quat] }, grounded: g });
      }
      a.occurrences.push({ id: occ, name: nextName(a), part: partId, xf: { pos: [0, 0, 0], quat: [0, 0, 0, 1] } });
    });
    if (first && (s.settings.insertMode ?? 'foran') === 'foran') {
      // Foran: solo el primer componente; las piezas siguientes se conectan a sus ePoints
      s.commitAsm((a) => { a.occurrences = a.occurrences.filter((o) => o.id !== occ); });
      const f0 = S().asm.occurrences[0];
      useStore.setState({ placing: null, tool: null, dialog: null, selItem: f0?.id ?? null });
      s.notify(`${base}: primer componente ${firstAt?.label ?? 'fijo en el origen'}. Las piezas siguientes se conectarán a sus bocas libres`);
      return;
    }
    useStore.setState({ placing: { part: partId, occ, quat: [0, 0, 0, 1], extras }, tool: 'place', selItem: null, dialog: null });
    s.notify(first ? `${base}: primer componente ${firstAt?.label ?? 'fijo en el origen'}. Clic para colocar más copias · Esc para terminar` : `${base}: clic para colocar · X/Y/Z gira 90° · Esc o clic derecho para terminar`);
  },
  /** Suelta la copia pendiente en la posición indicada y prepara la siguiente. */
  dropPlace: (xf: Xform, snap?: { a: string; occ: string; ep: string }) => {
    const s = S(); const p = s.placing; if (!p) return;
    const e = s.docs.find((d) => d.id === p.part);
    const base = (e?.fileName ?? 'Pieza').replace(/\.[^.]+$/, '');
    const occ = uid('o');
    let nj = 0;
    s.commitAsm((a) => {
      const o = a.occurrences.find((x) => x.id === p.occ); if (o) o.xf = xf;
      // imán: unión entre el ePoint de la pieza nueva y el del componente sobre el que se soltó
      if (snap && o) {
        const pa = partEPoints(partOf(S(), p.part)).find((e) => e.id === snap.a);
        const ob = a.occurrences.find((x) => x.id === snap.occ), pb = ob && partEPoints(partOf(S(), ob.part)).find((e) => e.id === snap.ep);
        if (pa && pb) { a.joints.push(epJoint(a, o.id, pa, snap.occ, pb, uid)); nj++; }
      }
      for (const x of p.extras ?? []) a.occurrences.push({ id: uid('o'), name: occName(a, x), part: x, xf: { pos: [...xf.pos], quat: [...xf.quat] } });
      // ePoints del mismo nombre: se conectan solos al soltar la pieza
      // (solo los que han quedado en el mismo sitio)
      const X = (id: string) => (id === p.occ ? xf : S().asmResult?.xf[id] ?? a.occurrences.find((x) => x.id === id)?.xf ?? IDENTITY);
      const js = autoEPointJoints(a, (id) => partOf(S(), id), [p.occ], uid, { pos: (id, pt) => xfPoint(X(id), pt), tol: 1 }); a.joints.push(...js); nj += js.length;
      let k = 1; while (a.occurrences.some((x) => x.name === `${base}:${k}`)) k++;
      a.occurrences.push({ id: occ, name: `${base}:${k}`, part: p.part, xf: { pos: [...xf.pos], quat: [...p.quat] } });
    });
    useStore.setState({ placing: { ...p, occ }, selItem: null });
    if (nj) s.notify(`${nj} ePoint${nj > 1 ? 's conectados' : ' conectado'} automáticamente`);
  },
  /** Conecta todos los ePoints compatibles (mismo nombre y tipo) entre los componentes del ensamblaje */
  connectEPoints: () => {
    const s = S(); let n = 0;
    s.commitAsm((a) => { const js = autoEPointJoints(a, (id) => partOf(S(), id), undefined, uid); a.joints.push(...js); n = js.length; });
    s.notify(n ? `${n} uniones creadas a partir de ePoints` : 'No hay ePoints libres con el mismo nombre en componentes distintos (créalos en la pieza: Modelo 3D › ePoint)', n ? 'info' : 'error');
  },
  finishPlace: () => { const s = S(); if (s.placing) { s.setTool(null); s.notify('Colocación terminada · Restringir (R) para relacionar los componentes'); } },
  rotatePlace: (axis: 0 | 1 | 2) => {
    const s = S(); const p = s.placing; if (!p) return;
    const h = Math.SQRT1_2, r: [number, number, number, number] = [axis === 0 ? h : 0, axis === 1 ? h : 0, axis === 2 ? h : 0, h];
    const [ax, ay, az, aw] = r, [bx, by, bz, bw] = p.quat;
    const qn: [number, number, number, number] = [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
    const l = Math.hypot(...qn) * (qn[3] < 0 ? -1 : 1);
    useStore.setState({ placing: { ...p, quat: qn.map((v) => (Math.abs(v / l) < 1e-12 ? 0 : v / l)) as typeof qn } });
  },
  placeContent: (fam: string, size: string, len: number) => {
    const s = S();
    const F = CONTENT.find((f) => f.id === fam); if (!F) return;
    let doc: PartDoc; try { doc = F.make(size, len); } catch (e) { return s.notify((e as Error).message, 'error'); }
    const fn = doc.iProperties.partNumber.replace(/"/g, 'in').replace(/\//g, '-').replace(/[\\:*?<>|]+/g, '_').replace(/ - /g, ' ') + '.i3p';
    const existing = s.docs.find((d) => d.fileName === fn);
    if (s.kind !== 'assembly') { if (existing) s.activate(existing.id); else s.addDocument('part', doc, fn, true); return; }
    const pid = existing?.id ?? s.addDocument('part', doc, fn, false);
    asmActions.startPlace(pid);
  },
  /** Mecánica › Fijación: crea tornillo/espárrago, tuercas y arandelas y los coloca en cada taladro elegido */
  placeFasteners: () => {
    const s = S();
    const dl = s.dialog; if (dl?.kind !== 'fastener') return;
    const fx = dl.fx as { std?: FStd; kind?: FixKind; size?: string; grip?: string; gasket?: boolean; gasketT?: string; headWasher?: boolean; holes?: { p: V3; d: V3; grip: number; occ?: string; pL?: V3; dL?: V3; r?: number }[] };
    const std = fx.std ?? 'EN', kind = fx.kind ?? 'bolt';
    const sizes = FASTENER_SIZES[std], size = fx.size && sizes.includes(fx.size) ? fx.size : sizes[std === 'EN' ? 5 : 1];
    const gk = fx.gasket ? Number(fx.gasketT ?? (std === 'EN' ? 2 : 3.2)) : 0;
    const holes = fx.holes ?? []; if (!holes.length) return s.notify('Elige antes un taladro', 'error');
    const userGrip = Number(fx.grip ?? holes[0].grip);
    const docId = (doc: PartDoc) => {
      const fn = doc.iProperties.partNumber.replace(/"/g, 'in').replace(/\//g, '-').replace(/[\\:*?<>|]+/g, '_').replace(/ - /g, ' ') + '.i3p';
      return S().docs.find((d) => d.fileName === fn)?.id ?? S().addDocument('part', doc, fn, false);
    };
    const occs: Occurrence[] = [], joints: Joint[] = [];
    const f = fsize(std, size); if (!f) return s.notify('Métrica no disponible', 'error');
    const names = new Map<string, number>();
    const nameOf = (pid: string) => { const b = (S().docs.find((d) => d.id === pid)?.fileName ?? 'Pieza').replace(/\.[^.]+$/, ''); let k = names.get(pid) ?? 1; while (S().asm.occurrences.some((o) => o.name === `${b}:${k}`) || occs.some((o) => o.name === `${b}:${k}`)) k++; names.set(pid, k + 1); return `${b}:${k}`; };
    let summary = '';
    for (const h of holes) {
      // si el usuario corrigió el espesor del primero, se aplica la misma diferencia a todos
      const grip = Math.max(0.5, h.grip + (userGrip - holes[0].grip));
      const plan = planFix(std, size, kind, grip, gk, !!fx.headWasher); if (!plan) return s.notify('Métrica no disponible', 'error');
      const parts = {
        bolt: () => docId(makeBolt(std, size, plan.L)), stud: () => docId(makeStud(std, size, plan.L)),
        nut: () => docId(makeNut(std, size)), washer: () => docId(makeWasher(std, size)),
      };
      for (const it of plan.items) {
        const pid = parts[it.part]();
        const pos = v3.add(h.p, v3.mul(h.d, it.z0));
        const id = uid('o');
        occs.push({ id, name: nameOf(pid), part: pid, xf: { pos: pos.map((x) => Math.round(x * 1e4) / 1e4) as V3, quat: quatZTo(it.outward ? h.d : v3.mul(h.d, -1)) } });
        // restricción Insertar al agujero: ejes coaxiales y apoyo a la distancia z0 de la cara de inicio
        if (h.occ && h.pL && h.dL && s.asm.occurrences.some((o) => o.id === h.occ)) {
          joints.push({ id: uid('j'), name: `Insertar ${occs[occs.length - 1].name}`, type: 'insert', offset: String(Math.round(it.z0 * 1000) / 1000), angle: '0',
            a: { occ: h.occ, point: h.pL, normal: h.dL, kind: 'axis', radius: h.r ?? f.d / 2 + 1, convex: false },
            b: { occ: id, point: [0, 0, 0], normal: it.outward ? [0, 0, -1] : [0, 0, 1], kind: 'axis', radius: f.d / 2, convex: true } });
        }
      }
      summary = `${kind === 'bolt' ? 'Tornillo' : 'Espárrago'} ${plan.size} × ${plan.lengthLbl} · sobresale ${plan.projection} mm`;
    }
    s.commitAsm((a) => { a.occurrences.push(...occs); a.joints.push(...joints); });
    s.set({ dialog: null, tool: null });
    s.notify(`${holes.length} fijación(es): ${summary}${joints.length ? ` · ${joints.length} restricciones Insertar al agujero` : ''}`);
  },
  patternComponent: (occId: string, p: Record<string, string>) => {
    const s = S();
    const o = s.asm.occurrences.find((x) => x.id === occId); if (!o) return;
    const ev = (x: string) => { try { return makeEval([])(x); } catch { return NaN; } };
    const n = patternPoses(o.xf, p, ev).length;
    if (!n) return s.notify('El patrón no crea copias', 'error');
    s.commitAsm((a) => { (a.patterns ??= []).push({ id: uid('cp'), name: `Patrón de componentes${(a.patterns?.length ?? 0) + 1}`, parent: occId, p, members: [] }); });
    s.notify(`Patrón asociativo: ${n} copias (siguen al componente original)`);
  },
  /** Componente simétrico respecto a un plano de origen del ensamblaje (pieza derivada en espejo). */
  mirrorComponent: (occId: string, plane: 'YZ' | 'XZ' | 'XY') => {
    const s = S();
    const o = s.asm.occurrences.find((x) => x.id === occId); if (!o) return;
    const src = s.docData(o.part) as PartDoc | null; if (!src) return s.notify('Pieza de origen no disponible', 'error');
    const srcName = s.docs.find((d) => d.id === o.part)?.fileName ?? 'Pieza.i3p';
    const name = srcName.replace(/\.i3p$/i, '') + `_SIM_${plane}.i3p`;
    const nd = newDoc();
    nd.iProperties = { ...src.iProperties, partNumber: src.iProperties.partNumber + '-SIM', description: `${src.iProperties.description} (simétrica)` };
    nd.features = [{ id: uid('f'), name: 'Derivada', type: 'derive', source: o.part, sourceName: srcName, doc: structuredClone(src), scale: '1', mirror: plane, op: 'join' }];
    const pid = s.addDocument('part', nd, name, false);
    const xf = mirrorPose(o.xf, plane);
    s.commitAsm((a) => { a.occurrences.push({ id: uid('o'), name: name.replace(/\.i3p$/i, '') + ':1', part: pid, xf, grounded: true, mirrorOf: { occ: o.id, plane } }); });
    s.notify('Componente simétrico asociativo creado (sigue la forma y la posición del original)');
  },
  replaceComponent: (occId: string, partId: string, all: boolean) => {
    const s = S();
    const o = s.asm.occurrences.find((x) => x.id === occId); if (!o) return;
    const name = (s.docs.find((d) => d.id === partId)?.fileName ?? 'Pieza').replace(/\.i3p$/i, '');
    s.commitAsm((a) => { let k = 0; for (const t of a.occurrences) if (t.id === occId || (all && t.part === o.part)) { t.part = partId; t.name = `${name}:${++k}`; } });
    s.notify('Componente sustituido: revisa las restricciones que usaban sus caras');
  },
  /** Conduce una unión de rotación o corredera entre dos valores (animación sin historial). */
  drive: async (jid: string, from: number, to: number, steps: number, ms: number) => {
    const s = S();
    const base = s.asm;
    const j = base.joints.find((x) => x.id === jid); if (!j) return;
    const ev = (x: string) => { try { return makeEval([])(x); } catch { return NaN; } };
    for (let i = 0; i <= steps; i++) {
      const v = from + ((to - from) * i) / steps;
      const a = structuredClone(base);
      const t = a.joints.find((x) => x.id === jid)!;
      t.lock = true;
      if (t.type === 'rot') t.angle = `${v} deg`; else t.offset = `${v} mm`;
      const r = solveAssembly(normalizeAsm(a, docGetter(S()), ev), ev);
      for (const o of a.occurrences) if (r.xf[o.id] && !o.grounded) o.xf = r.xf[o.id];
      useStore.setState({ asm: a });
      await new Promise((res) => setTimeout(res, ms));
    }
  },
  /** Coloca en el ensamblaje las piezas generadas por una red (conductos/tuberías), sustituyendo las de la generación anterior. */
  placeGenerated: (genId: string, items: { fileName: string; make: () => PartDoc; xf: Xform }[], old: string[] = []): string[] => {
    const s = S(); const prev = new Set(old);
    const byFile = new Map<string, string>();
    for (const it of items) {
      if (byFile.has(it.fileName)) continue;
      const ex = s.docs.find((d) => d.fileName === it.fileName)?.id;
      byFile.set(it.fileName, ex ?? s.addDocument('part', it.make(), it.fileName, false));
    }
    const ids: string[] = [];
    S().commitAsm((a) => {
      a.occurrences = a.occurrences.filter((o) => !prev.has(o.id) && o.gen !== genId);
      a.joints = a.joints.filter((j) => !prev.has(j.a.occ) && !prev.has(j.b.occ));
      const cnt = new Map<string, number>();
      for (const it of items) {
        const id = uid('o'); ids.push(id);
        const base = it.fileName.replace(/\.i3p$/, ''); const k = (cnt.get(base) ?? 0) + 1; cnt.set(base, k);
        a.occurrences.push({ id, name: `${base}:${k}`, part: byFile.get(it.fileName)!, xf: it.xf, grounded: true, gen: genId });
      }
    });
    return ids;
  },
  /** Estados de modelo: supresiones y posiciones guardadas con nombre */
  saveModelState: (name: string) => S().commitAsm((a) => {
    const sup = [...a.occurrences, ...a.frames, ...a.welds, ...a.bolts].filter((x) => x.suppressed).map((x) => x.id);
    const pos: Record<string, Xform> = {}; for (const o of a.occurrences) if (!o.grounded) pos[o.id] = { pos: [...o.xf.pos], quat: [...o.xf.quat] };
    const id = uid('ms'); (a.modelStates ??= []).push({ id, name, suppressed: sup, positions: pos }); a.activeState = id;
  }),
  applyModelState: (id: string | null) => S().commitAsm((a) => {
    const st = id ? a.modelStates?.find((x) => x.id === id) : null;
    const sup = new Set(st?.suppressed ?? []);
    for (const x of [...a.occurrences, ...a.frames, ...a.welds, ...a.bolts]) x.suppressed = sup.has(x.id) || undefined;
    if (st?.positions) for (const o of a.occurrences) { const p = st.positions[o.id]; if (p && !o.grounded) o.xf = { pos: [...p.pos], quat: [...p.quat] }; }
    a.activeState = st?.id;
  }),
  saveViewRep: (name: string) => S().commitAsm((a) => { (a.viewReps ??= []).push({ id: uid('vr'), name, hidden: a.occurrences.filter((o) => o.hidden).map((o) => o.id) }); }),
  applyViewRep: (id: string) => S().commitAsm((a) => { const r = a.viewReps?.find((x) => x.id === id); if (!r) return; for (const o of a.occurrences) o.hidden = r.hidden.includes(o.id); }),
  /** Tras mover un componente: comprueba si choca con otros (detección de colisiones activada) */
  checkCollision: async (occId: string) => {
    const s0 = S(); if (!s0.collide || s0.kind !== 'assembly') return;
    // espera a que el ensamblaje se recalcule con la nueva posición
    await new Promise((r) => setTimeout(r, 600));
    const s = S(); const A = s.asmResult?.view ?? s.asm;
    const mine = (id: string) => id === occId || id.startsWith(occId + '/');
    const ids = [...new Set(A.occurrences.map((o) => o.part))];
    try {
      const r = (await cad.interference(A, s.partsMap(ids))).filter((x) => mine(x.a) !== mine(x.b) && (mine(x.a) || mine(x.b)));
      if (r.length) {
        const nm = (id: string) => A.occurrences.find((o) => o.id === id)?.name ?? id;
        S().set({ interf: r });
        S().notify(`Colisión: ${r.map((x) => `${nm(mine(x.a) ? x.b : x.a)} (${fmt(x.volume / 1000, 2)} cm³)`).join(', ')} · Ctrl+Z para deshacer el movimiento`, 'error');
      } else if (S().interf) S().set({ interf: null });
    } catch { /* sin comprobación */ }
  },
  interference: async () => {
    const s = S();
    const A = s.asmResult?.view ?? s.asm;
    const ids = [...new Set(A.occurrences.map((o) => o.part))];
    try { const r = await cad.interference(A, s.partsMap(ids)); S().set({ interf: r }); }
    catch (e) { s.notify((e as Error).message, 'error'); }
  },
  /** Foran: gira la pieza (y lo que cuelga de ella) sobre el eje de su unión por ePoints; queda fija en el nuevo ángulo */
  foranSpin: (occ: string, deg: number) => {
    const s = S(); const j = foranJoint(occ); if (!j) return;
    const side = j.a.occ === occ ? 'a' : 'b', other = side === 'a' ? j.b : j.a, me = j[side];
    const X = xfOf(occ); const u = v3.norm(xfDirW(X, me.normal)), P = xfPoint(X, me.point);
    const th = (deg * Math.PI) / 180;
    const jj = ensureLock(j);
    const sub = subtree(occ, j);
    const rq = axisQuat(u, th);
    s.commitAsm((a) => {
      for (const id of sub) { const o = a.occurrences.find((x) => x.id === id); if (!o) continue; const X0 = xfOf(id); o.xf = { pos: v3.add(P, qq.rotate(rq, v3.sub(X0.pos, P))) as V3, quat: qq.mul(rq, X0.quat) as Xform['quat'] }; }
      // el giro se guarda en la unión (las bocas de conducto vuelven a tomar su orientación de la sección)
      const sp = Math.round((((jj.spin ?? 0) - deg) % 360) * 1e6) / 1e6;
      const k = a.joints.findIndex((x) => x.id === j.id); if (k >= 0) a.joints[k] = { ...jj, spin: sp || undefined } as Joint;
    });
    const Fm = R.epFrame(other.occ, j.ep![side === 'a' ? 'b' : 'a'])?.m;
    const odd = Math.abs(((deg % 180) + 180) % 180) > 1e-6;
    if (odd && Fm && Fm.shape !== 'round' && Math.abs(Fm.W - Fm.H) > 0.5) s.notify(`Girada ${deg > 0 ? '+' : ''}${deg}° sobre su unión. Aviso: la boca rectangular ${Fm.W}×${Fm.H} queda girada respecto a la anterior y no encaja${Math.abs(((deg % 180) + 180) % 180 - 90) < 1e-6 ? ' (W contra H: para girar hacia el lado H usa una pieza con W y H cambiados; Añadir lo hace solo)' : ''}`, 'error');
    else s.notify(`Girada ${deg > 0 ? '+' : ''}${deg}° sobre su unión`);
  },
  /** Editar un componente (doble clic): las piezas generadas (HVAC, tubería) vuelven a abrir su generador con sus valores;
   *  las demás, sus propiedades y cotas editables. */
  editComponent: (occ: string) => {
    const s = S(); const o = s.asm.occurrences.find((x) => x.id === occ); if (!o) return;
    const d = s.docs.find((x) => x.id === o.part);
    if (d?.kind !== 'part') { s.activate(o.part); return; }
    const pd = s.docData(o.part) as PartDoc & { hvacSpec?: { kind: string; shape?: string }; pipeSpec?: { kind: string; norm: 'ASME' | 'EN'; size: string; sch?: string; wall?: number; material: string; flStd?: string; rating?: number; flType?: string } };
    if (pd?.hvacSpec) { s.open({ kind: 'hvac', hk: pd.hvacSpec.kind, edit: { pid: o.part, spec: pd.hvacSpec } } as never); return; }
    if (pd?.pipeSpec) { const p = pd.pipeSpec; s.open({ kind: 'piping', pk: p.kind, norm: p.norm, init: { size: p.size, sch: p.sch, wall: p.wall, material: p.material, flStd: p.flStd, rating: p.rating, flType: p.flType }, edit: { pid: o.part, spec: p } } as never); return; }
    s.open({ kind: 'occprops', occ });
  },
  /** Tras editar una pieza generada: nombre de fichero y de los componentes según la nueva designación (si no está guardada en disco) */
  renameGenerated: (pid: string, nd: PartDoc) => {
    const s = S(); const d = s.docs.find((x) => x.id === pid); if (!d || d.path) return;
    const fn = nd.iProperties.partNumber.replace(/[\\/:*?"<>|]+/g, '_') + '.i3p';
    if (fn === d.fileName || s.docs.some((x) => x.id !== pid && x.fileName === fn)) return;
    const base = fn.replace(/\.i3p$/, '');
    useStore.setState({ docs: s.docs.map((x) => (x.id === pid ? { ...x, fileName: fn } : x)) });
    let n = 0; S().commitAsm((a) => { for (const o of a.occurrences) if (o.part === pid) o.name = `${base}:${++n}`; });
  },
  /** ¿La pieza es de chapa (tiene desarrollo)? */
  isSheet: (part: string) => { const pd = S().docData(part) as PartDoc | null; return !!pd && 'features' in pd && pd.features.some((f) => String(f.type).startsWith('sm_')); },
  /** Gira el componente y todo lo que arrastra detrás sobre su ePoint: el de su unión o, en el componente raíz (fijo), su ePoint de conexión */
  epRotate: (occ: string, deg: number) => {
    if (foranJoint(occ)) { asmActions.foranSpin(occ, deg); return; }
    const s = S(); const F = rootFrame(occ); if (!F) { s.notify('El componente no tiene ePoints', 'error'); return; }
    const u: V3 = [F.D.x, F.D.y, F.D.z], P: V3 = [F.P.x, F.P.y, F.P.z];
    const rq = axisQuat(v3.norm(u), (deg * Math.PI) / 180), sub = linked(occ);
    s.commitAsm((a) => { for (const id of sub) { const o = a.occurrences.find((x) => x.id === id); if (!o) continue; const X0 = xfOf(id); o.xf = { pos: v3.add(P, qq.rotate(rq, v3.sub(X0.pos, P))) as V3, quat: qq.mul(rq, X0.quat) as Xform['quat'] }; } });
    s.notify(`Girado ${deg > 0 ? '+' : ''}${deg}° sobre «${F.name}»${sub.length > 1 ? ` con ${sub.length - 1} componente(s) unidos` : ''}`);
  },
  /** Gira el componente (y lo que arrastra detrás) sobre cualquier eje (mundial) que pasa por su ePoint.
   *  Sobre el eje de su unión es un giro de la unión; sobre otro eje se suelta de la pieza anterior y queda fijo. */
  epRotateAxis: (occ: string, axis: V3, deg: number) => {
    const s = S(); const F = epOfOcc(occ); if (!F || !deg) return;
    const u = v3.norm(axis); const P: V3 = [F.P.x, F.P.y, F.P.z];
    const j = foranJoint(occ);
    const dj = v3.dot(u, [F.D.x, F.D.y, F.D.z]);
    if (j && Math.abs(Math.abs(dj) - 1) < 1e-6) { asmActions.foranSpin(occ, dj > 0 ? deg : -deg); return; }
    if (!j && Math.abs(Math.abs(dj) - 1) < 1e-6) { asmActions.epRotate(occ, dj > 0 ? deg : -deg); return; }
    const sub = j ? subtree(occ, j) : linked(occ);
    const rq = axisQuat(u, (deg * Math.PI) / 180);
    s.commitAsm((a) => {
      if (j) a.joints = a.joints.filter((x) => x.id !== j.id);
      for (const id of sub) { const o = a.occurrences.find((x) => x.id === id); if (!o) continue; const X0 = xfOf(id); o.xf = { pos: v3.add(P, qq.rotate(rq, v3.sub(X0.pos, P))) as V3, quat: qq.mul(rq, X0.quat) as Xform['quat'] }; if (j && id === occ) o.grounded = true; }
    });
    const ax = Math.abs(u[0]) > 0.999 ? 'X' : Math.abs(u[1]) > 0.999 ? 'Y' : Math.abs(u[2]) > 0.999 ? 'Z' : 'eje';
    s.notify(`Girado ${deg > 0 ? '+' : ''}${deg}° sobre ${ax} por «${F.name}»${sub.length > 1 ? ` con ${sub.length - 1} componente(s) detrás` : ''}${j ? '. Se ha soltado de la pieza anterior y queda fijo (para volver a unirlo: clic derecho › Cambiar boca de destino)' : ''}`);
  },
  /** Mueve el componente (y lo que arrastra detrás) un vector desde su ePoint. Unido: a lo largo de la unión es un desfase;
   *  en otra dirección se suelta de la pieza anterior y queda fijo en la nueva posición. */
  epMove: (occ: string, d: V3) => {
    const s = S(); const L = Math.hypot(...d); if (!(L > 1e-9)) return;
    const j = foranJoint(occ);
    if (j) {
      const side = j.a.occ === occ ? 'a' : 'b';
      const na = v3.norm(xfDirW(xfOf(j.a.occ), j.a.normal)); const away = side === 'a' ? v3.mul(na, -1) : na;
      const along = v3.dot(d, away);
      if (Math.abs(Math.abs(along) - L) < 1e-6 * Math.max(1, L)) {
        const ev = (x: string) => { try { return makeEval([])(x); } catch { return 0; } };
        asmActions.foranOffset(occ, Math.round(((ev(j.offset || '0') || 0) + along) * 1000) / 1000); return;
      }
      const sub = subtree(occ, j);
      s.commitAsm((a) => {
        a.joints = a.joints.filter((x) => x.id !== j.id);
        for (const id of sub) { const o = a.occurrences.find((x) => x.id === id); if (!o) continue; const X0 = xfOf(id); o.xf = { pos: v3.add(X0.pos, d) as V3, quat: [...X0.quat] as Xform['quat'] }; if (id === occ) o.grounded = true; }
      });
      s.notify(`Movido ${d.map((v) => +v.toFixed(2)).join(', ')} mm: se ha separado de la pieza anterior y queda fijo (para volver a unirlo: clic derecho › Cambiar boca de destino)`);
      return;
    }
    const sub = linked(occ);
    s.commitAsm((a) => { for (const id of sub) { const o = a.occurrences.find((x) => x.id === id); if (!o) continue; const X0 = xfOf(id); o.xf = { pos: v3.add(X0.pos, d) as V3, quat: [...X0.quat] as Xform['quat'] }; } });
    s.notify(`Movido ${d.map((v) => +v.toFixed(2)).join(', ')} mm${sub.length > 1 ? ` con ${sub.length - 1} componente(s) unidos` : ''}`);
  },
  /** Foran: separa la pieza a lo largo del eje de su unión (desfase de la unión) */
  foranOffset: (occ: string, d: number) => {
    const s = S(); const j = foranJoint(occ); if (!j) return;
    const side = j.a.occ === occ ? 'a' : 'b';
    const ev = (x: string) => { try { return makeEval([])(x); } catch { return 0; } };
    const old = ev(j.offset || '0') || 0, dd = d - old;
    const XA = xfOf(j.a.occ); const na = v3.norm(xfDirW(XA, j.a.normal));
    const dir = side === 'a' ? v3.mul(na, -1) : na;
    const sub = subtree(occ, j);
    s.commitAsm((a) => {
      for (const id of sub) { const o = a.occurrences.find((x) => x.id === id); if (!o) continue; const X0 = xfOf(id); o.xf = { pos: v3.add(X0.pos, v3.mul(dir, dd)) as V3, quat: [...X0.quat] as Xform['quat'] }; }
      const t = a.joints.find((x) => x.id === j.id); if (t) t.offset = `${d} mm`;
    });
    s.notify(d ? `Desplazada ${d} mm a lo largo de su unión` : 'Desfase quitado: vuelve a estar encajada');
  },
  /** Foran: une la pieza por otra de sus bocas libres a la misma boca de destino */
  foranOtherPort: (occ: string) => {
    const s = S(); const j = foranJoint(occ); if (!j) return;
    const side = j.a.occ === occ ? 'a' : 'b', other = side === 'a' ? j.b : j.a, cur = j.ep?.[side];
    const o = s.asm.occurrences.find((x) => x.id === occ); const pd = o && partOf(s, o.part); if (!pd) return;
    const used = usedEps(occ, j.id);
    const ports = R.portsOf(pd).filter((e) => !e.isDefault);
    const i = ports.findIndex((e) => e.id === cur);
    const nx = [...ports.slice(i + 1), ...ports.slice(0, i + 1)].find((e) => e.id !== cur && !used.has(e.id));
    if (!nx) { s.notify('La pieza no tiene otra boca libre', 'error'); return; }
    const F = R.epFrame(other.occ, j.ep![side === 'a' ? 'b' : 'a']); if (!F) return;
    foranJoin(occ, pd, nx, other.occ, F, j.id);
    s.notify(`Unida por su boca «${nx.name}»`);
  },
  /** Foran: elegir en pantalla otra boca de destino para la pieza */
  foranReattach: (occ: string) => {
    const s = S(); if (s.placing) s.setTool(null);
    useStore.setState({ reattach: occ, createTarget: null });
    s.setTool('asmCreatePick');
    s.notify('Cambiar boca: haz clic en la boca (ePoint) libre donde quieres unir la pieza · Esc cancela');
  },
  /** (lo llama el visor al elegir la boca) */
  foranReattachTo: (occ: string, toOcc: string, toEp: string) => {
    const s = S(); useStore.setState({ reattach: null, tool: null });
    if (toOcc === occ) { s.notify('Elige una boca de otro componente', 'error'); return; }
    const o = s.asm.occurrences.find((x) => x.id === occ); const pd = o && partOf(s, o.part); if (!pd) return;
    const F = R.epFrame(toOcc, toEp); if (!F) return;
    const j = foranJoint(occ);
    const cur = j?.ep?.[j.a.occ === occ ? 'a' : 'b'];
    const used = usedEps(occ, j?.id);
    const ne = (cur && !used.has(cur) ? R.portsOf(pd).find((e) => e.id === cur) : undefined) ?? R.inletFor(pd, F);
    if (!ne) return;
    foranJoin(occ, pd, ne, toOcc, F, j?.id);
    s.notify(`Unida a ${F.name}`);
  },
  /** Foran: quita la unión y deja la pieza libre para moverla o girarla con el gizmo */
  foranFree: (occ: string) => {
    const s = S(); const j = foranJoint(occ);
    if (j) s.commitAsm((a) => { a.joints = a.joints.filter((x) => x.id !== j.id); });
    useStore.setState({ selItem: occ });
    s.setTool('move');
    s.notify('Pieza libre: muévela o gírala con el gizmo (o G para giro libre). Para volver a unirla: clic derecho › Cambiar boca de destino');
  },
  toggleGround: () => { const s = S(); s.commitAsm((a) => { const o = a.occurrences.find((x) => x.id === s.selItem); if (o) o.grounded = !o.grounded; }); },
  openJoint: () => {
    const s = S(); const pre = s.selItem && s.asm.occurrences.some((o) => o.id === s.selItem) ? s.selItem : undefined;
    s.openAsmDialog('joint', { id: uid('j'), name: `Unión${s.asm.joints.length + 1}`, type: 'mate', offset: '0 mm', angle: '0 deg', ...(pre ? { pre } : {}) }, undefined, 'asmFace');
    if (pre) s.notify(`Restringir ${s.asm.occurrences.find((o) => o.id === pre)?.name}: elige su cara, eje o ePoint y después la geometría de la otra pieza`);
  },
  openWorkPlane: () => S().openAsmDialog('asmwp', { id: uid('wp'), name: auxName('P', S().asm.workPlanes ?? []), base: 'XY', offset: '0 mm', angle: '0 deg' }, undefined, 'asmFace'),
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
const pageFields = (p: ReturnType<typeof extractPage>) => ({ sheet: p.sheet, views: p.views, dims: p.dims, notes: p.notes, anns: p.anns, tables: p.tables, bom: p.bom });
async function sheetEntities(st?: ReturnType<typeof S>) {
  const s = st ?? S();
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
        d.title.project ||= src.iProperties.project ?? '';
        d.title.description ||= src.iProperties.description ?? '';
        d.title.finish ||= src.iProperties.finish ?? '';
        d.title.approved ||= src.iProperties.approvedBy ?? '';
        if (src.format === 'inv3d.part' && s.active === source && s.result?.props) {
          const dens = MATERIALS.find((m: { name: string }) => m.name === src.iProperties.material)?.density ?? 7850;
          d.title.mass = `${(s.result.props.volume * 1e-9 * dens).toFixed(3).replace('.', ',')} kg`;
        }
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
    const dir = side === 'iso' ? 'iso' : projectedDir(v.dir, side, drawStyle(s.drw).projection === 'third');
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
  // ---------- Hojas ----------
  addSheet: () => S().commitDrw((d) => {
    const pages = allPages(d);
    pages.push({ name: `Hoja${pages.length + 1}`, sheet: d.sheet, views: [], dims: [], notes: [], anns: [], tables: [], bom: null });
    d.pages = pages; loadPage(d, pages.length - 1);
  }),
  gotoSheet: (i: number) => { const s = S(); if ((s.drw.page ?? 0) === i) return; s.commitDrw((d) => loadPage(d, i)); useStore.setState({ selItem: null }); },
  deleteSheet: (i: number) => S().commitDrw((d) => {
    const pages = allPages(d); if (pages.length < 2) return;
    pages.splice(i, 1); d.pages = pages; d.page = Math.min(d.page ?? 0, pages.length - 1);
    const cur = d.page; d.page = -1 as unknown as number; // forzar recarga
    d.page = cur; const p = pages[cur]; Object.assign(d, { sheet: p.sheet, views: p.views, dims: p.dims, notes: p.notes, anns: p.anns, tables: p.tables, bom: p.bom });
  }),
  renameSheet: (i: number, name: string) => S().commitDrw((d) => { const pages = allPages(d); pages[i].name = name; d.pages = pages; }),
  // ---------- Vistas especiales ----------
  placeFlat: async (source: string) => {
    const s = S();
    const src = s.docData(source) as PartDoc | null;
    if (!src || src.format !== 'inv3d.part' || !src.features.some((f) => f.type.startsWith('sm_'))) return s.notify('Elige una pieza de chapa abierta', 'error');
    const [W, H] = SHEETS[s.drw.sheet];
    const id = uid('v');
    s.commitDrw((d) => { d.views.push({ id, name: 'Desarrollo', source, dir: 'top', scale: 1, x: W * 0.35, y: H * 0.45, hidden: false, kind: 'flat' }); });
    useStore.setState({ selItem: id, dialog: null });
    const p = getProjection(S(), S().drw.views.find((x) => x.id === id)!);
    if (!p) return;
    try {
      const pd = await p;
      const bw = pd.bbox[2] - pd.bbox[0], bh = pd.bbox[3] - pd.bbox[1];
      const sc = SCALES.find((k) => bw * k <= W * 0.5 && bh * k <= H * 0.45) ?? SCALES[SCALES.length - 1];
      S().commitDrw((d) => { const t = d.views.find((x) => x.id === id); if (t) t.scale = sc; });
    } catch (e) { s.notify(`Desarrollo: ${(e as Error).message}`, 'error'); }
  },
  clearBreaks: () => { const v = selView(); if (v) S().commitDrw((d) => { const t = d.views.find((x) => x.id === v.id)!; delete t.breaks; delete t.crop; }); },
  // ---------- Tablas ----------
  addTable: (kind: TableKind) => {
    const s = S(); const [W, H] = SHEETS[s.drw.sheet];
    let view: string | undefined;
    if (kind !== 'rev') {
      const sv = selView();
      const ok = (v: DView) => (kind === 'bend' ? v.kind === 'flat' : v.kind !== 'iso' && v.kind !== 'flat');
      view = (sv && ok(sv) ? sv : s.drw.views.find(ok))?.id;
      if (!view) return s.notify(kind === 'bend' ? 'Coloca antes una vista de desarrollo (Colocar vistas › Desarrollo)' : 'Selecciona una vista con taladros', 'error');
    }
    const id = uid('tb');
    const pos = kind === 'rev' ? { x: W - 10 - 140, y: H - 10 } : { x: 15, y: 62 };
    s.commitDrw((d) => { (d.tables ??= []).push({ id, kind, view, ...pos }); if (kind === 'rev') (d.revisions ??= []).length || d.revisions.push({ rev: d.title.revision || 'A', desc: 'Primera edición', date: d.title.date, by: d.title.approved ?? '' }); });
    useStore.setState({ selItem: id });
  },
  addRevision: () => S().commitDrw((d) => {
    const revs = (d.revisions ??= []);
    const last = revs[revs.length - 1]?.rev ?? '@';
    const next = /^[A-Z]$/.test(last) ? String.fromCharCode(last.charCodeAt(0) + 1) : String(revs.length + 1);
    revs.push({ rev: next, desc: '', date: new Date().toLocaleDateString('es-ES'), by: '' });
    d.title.revision = next;
  }),
  autoCenters: () => { const s = S(); const v = selView(); if (!v) return s.notify('Selecciona una vista', 'error'); s.commitDrw((d) => { const t = d.views.find((x) => x.id === v.id)!; t.centers = t.centers === false; }); },
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
  /** Globos automáticos: uno por elemento de la lista de piezas, en columnas a ambos lados de la vista */
  autoBalloons: async () => {
    const s = S();
    const isAsm = (v: DView) => (s.docData(v.source) as { format?: string } | null)?.format === 'inv3d.assembly' && v.kind !== 'detail' && v.kind !== 'flat';
    const sv = selView();
    const v = sv && isAsm(sv) ? sv : s.drw.views.find((x) => x.id === s.drw.bom?.view && isAsm(x)) ?? s.drw.views.find(isAsm);
    if (!v) return s.notify('Los globos automáticos necesitan una vista de un ensamblaje', 'error');
    const pr = getProjection(s, v); if (!pr) return;
    const pd = await pr;
    const g = viewGeom(S(), v);
    if (!g || !pd.anchors?.length) { return s.notify('No se han podido situar los componentes en la vista', 'error'); }
    const asm = s.docData(v.source) as import('../core/asm').AsmDoc;
    // número de elemento = orden de la lista de piezas (nivel superior): piezas en orden de aparición
    const item = new Map<string, number>(), occPart = new Map<string, string>();
    for (const o of asm.occurrences) if (!o.suppressed) { occPart.set(o.id, o.part); if (!item.has(o.part)) item.set(o.part, item.size + 1); }
    // mejor anclaje por elemento: el componente más grande en la vista y más cercano al observador
    const best = new Map<number, { a: P2; area: number }>();
    for (const an of pd.anchors) {
      const top = an.id.split('/')[0], part = occPart.get(top); if (!part) continue;
      const n = item.get(part)!;
      const area = (an.r[2] - an.r[0]) * (an.r[3] - an.r[1]);
      const prev = best.get(n); if (prev && prev.area >= area) continue;
      // se ajusta al punto de línea visible más cercano al centro dentro de su caja, evitando las cajas de componentes más pequeños delante
      const box = (r: [number, number, number, number]) => { const A = g.T([r[0], r[1]]), B = g.T([r[2], r[3]]); return [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[0], B[0]), Math.max(A[1], B[1])]; };
      const C = g.T(an.c), [rx0, ry0, rx1, ry1] = box(an.r);
      const others = pd.anchors.filter((o) => o !== an && (o.r[2] - o.r[0]) * (o.r[3] - o.r[1]) < area * 0.9).map((o) => box(o.r));
      const inside = (q: P2, b: number[], m = 0) => q[0] > b[0] - m && q[0] < b[2] + m && q[1] > b[1] - m && q[1] < b[3] + m;
      let bp: P2 = C, bd = Infinity;
      for (const pl of g.vis) for (let i = 0; i + 1 < pl.length; i++) {
        const A = pl[i], B = pl[i + 1], dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((C[0] - A[0]) * dx + (C[1] - A[1]) * dy) / L2)) : 0;
        // varios candidatos por segmento: el más cercano y puntos intermedios (para salir de cajas ajenas)
        for (const tt of [t, 0.25, 0.5, 0.75]) {
          const q: P2 = [A[0] + dx * tt, A[1] + dy * tt];
          if (!inside(q, [rx0, ry0, rx1, ry1], 0.01) || others.some((o) => inside(q, o, 0.5))) continue;
          const d = Math.hypot(q[0] - C[0], q[1] - C[1]); if (d < bd) { bd = d; bp = q; }
        }
      }
      best.set(n, { a: bp, area });
    }
    if (!best.size) return s.notify('No hay componentes visibles en la vista', 'error');
    const [x0, y0, x1, y1] = g.rect, cx = (x0 + x1) / 2;
    const left = [...best.entries()].filter(([, b]) => b.a[0] < cx), right = [...best.entries()].filter(([, b]) => b.a[0] >= cx);
    const anns: import('../core/drawing').DAnn[] = [];
    const column = (list: typeof left, X: number) => {
      list.sort((a, b) => b[1].a[1] - a[1].a[1]);
      const gap = 10, n = list.length, H = (n - 1) * gap;
      let Y = Math.min(y1 + 4, Math.max(y0 - 4 + H, (y0 + y1) / 2 + H / 2));
      for (const [num, b] of list) { anns.push({ id: uid('an'), kind: 'balloon', pts: [b.a, [X, Y]], text: String(num), view: v.id }); Y -= gap; }
    };
    column(left, x0 - 14); column(right, x1 + 14);
    s.commitDrw((d) => {
      d.anns = [...(d.anns ?? []).filter((a) => !(a.kind === 'balloon' && a.view === v.id)), ...anns];
      if (!d.bom) d.bom = { view: v.id, x: 0, y: 0 };
    });
    s.notify(`${anns.length} globos colocados · la lista de piezas usa la misma numeración`);
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
    const layerOf: Record<string, string> = { frame: 'MARCO', tb: 'MARCO', vis: 'VISIBLES', hid: 'OCULTAS', dim: 'COTAS', center: 'EJES', cutline: 'EJES', hatch: 'RAYADO', thin: 'ANOTACIONES', thick: 'ANOTACIONES', ann: 'ANOTACIONES', cutend: 'ANOTACIONES', detailc: 'DETALLES' };
    const doc: DxfDoc = {
      layers: [{ name: 'MARCO', color: 7 }, { name: 'VISIBLES', color: 7 }, { name: 'OCULTAS', color: 8, ltype: 'DASHED' }, { name: 'COTAS', color: 3 }, { name: 'EJES', color: 1, ltype: 'CENTER' }, { name: 'RAYADO', color: 9 }, { name: 'ANOTACIONES', color: 4 }, { name: 'DETALLES', color: 4, ltype: 'DASHED' }, { name: 'TEXTO', color: 7 }],
      lines: [...e.lines.map((l) => ({ layer: layerOf[l.cls] ?? 'ANOTACIONES', pts: l.pts })), ...e.fills.map((f) => ({ layer: 'COTAS', pts: [...f, f[0]] }))],
      texts: e.texts.map((t) => ({ layer: 'TEXTO', x: t.anchor === 'middle' ? t.x - t.text.length * t.h * 0.3 : t.anchor === 'end' ? t.x - t.text.length * t.h * 0.6 : t.x, y: t.y, h: t.h, text: t.text, rot: t.rot })),
    };
    await saveText(writeDxf(doc), s.fileName.replace(/\.[^.]+$/, '.dxf'), 'DXF', '.dxf', 'application/dxf');
  },
  exportPdf: async () => {
    const s = S();
    const { jsPDF } = await import('jspdf');
    const pages = allPages(s.drw);
    let pdf: InstanceType<typeof jsPDF> | null = null;
    for (let pi = 0; pi < pages.length; pi++) {
    const drw = { ...s.drw, page: pi, pages, ...pageFields(pages[pi]) };
    const e = await sheetEntities({ ...S(), drw } as ReturnType<typeof S>);
    if (!pdf) pdf = new jsPDF({ orientation: e.W > e.H ? 'landscape' : 'portrait', unit: 'mm', format: [e.W, e.H] });
    else pdf.addPage([e.W, e.H], e.W > e.H ? 'landscape' : 'portrait');
    const Y = (y: number) => e.H - y;
    const ds = drawStyle(drw), tk = ds.thick, tn = ds.thin;
    const W: Record<string, number> = { frame: tk, tb: tk * 0.7, vis: tk, hid: tn, dim: tn * 0.72, center: tn * 0.72, cutline: tn * 0.72, hatch: tn * 0.5, thin: tn * 0.72, thick: tk * 1.2, ann: tk * 0.7, cutend: tk * 1.4, detailc: tk * 0.8 };
    const DASH: Record<string, number[]> = { detailc: [3, 1.5], hid: [2, 1], center: [6, 1, 1, 1], cutline: [6, 1, 1, 1] };
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
    }
    if (!pdf) return;
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

// ---------- Filosofía Foran: piezas unidas por ePoints ----------
const xfOf = (id: string): Xform => { const s = S(); return s.asmResult?.xf[id] ?? s.asm.occurrences.find((o) => o.id === id)?.xf ?? IDENTITY; };
const xfDirW = (X: Xform, d: V3): V3 => qq.rotate(X.quat, d) as V3;
const axisQuat = (u: V3, th: number): Xform['quat'] => { const h = Math.sin(th / 2); return [u[0] * h, u[1] * h, u[2] * h, Math.cos(th / 2)]; };
/** Rodrigues: gira v sobre el eje unitario k */
const rodr = (v: V3, k: V3, th: number): V3 => { const c = Math.cos(th), sn = Math.sin(th), kv = v3.cross(k, v), kd = v3.dot(k, v); return v3.norm(v3.add(v3.add(v3.mul(v, c), v3.mul(kv, sn)), v3.mul(k, kd * (1 - c)))) as V3; };
/** ePoints de la pieza ya usados por uniones (salvo la indicada) */
function usedEps(occ: string, except?: string) {
  const u = new Set<string>();
  for (const j of S().asm.joints) { if (j.id === except || !j.ep) continue; if (j.a.occ === occ) u.add(j.ep.a); if (j.b.occ === occ) u.add(j.ep.b); }
  return u;
}
/** Unión por ePoints que «sujeta» la pieza: la que la une a su pieza anterior */
export function foranJoint(occ: string): Joint | undefined {
  // un componente fijo no «cuelga» de nadie: se gira y mueve desde su propio ePoint, arrastrando a los demás
  if (S().asm.occurrences.find((o) => o.id === occ)?.grounded) return undefined;
  const js = S().asm.joints.filter((j) => j.ep && !j.suppressed && (j.a.occ === occ || j.b.occ === occ));
  return js.find((j) => j.a.occ === occ) ?? js[0];
}
/** Bloqueo de giro con xdir en los dos lados (si la unión no lo tenía, con la orientación actual) */
function ensureLock(j: Joint): Joint {
  if (j.lock && j.a.xdir && j.b.xdir) return j;
  const XA = xfOf(j.a.occ), XB = xfOf(j.b.occ);
  const n = v3.norm(xfDirW(XA, j.a.normal));
  let W = v3.cross(n, Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0]); W = v3.norm(W);
  const loc = (X: Xform) => v3.norm(qq.rotate([-X.quat[0], -X.quat[1], -X.quat[2], X.quat[3]], W)) as V3;
  return { ...j, lock: true, a: { ...j.a, xdir: loc(XA) }, b: { ...j.b, xdir: loc(XB) } };
}
/** Piezas que se mueven con «occ» al girarla o desplazarla: ella y lo que cuelga de ella (sin cruzar la unión j ni componentes fijos) */
function subtree(occ: string, j: Joint): string[] {
  const s = S(); const other = j.a.occ === occ ? j.b.occ : j.a.occ;
  const fixed = new Set(s.asm.occurrences.filter((o) => o.grounded).map((o) => o.id));
  const seen = new Set([occ]); const q2 = [occ];
  while (q2.length) {
    const c = q2.shift()!;
    for (const x of s.asm.joints) {
      if (x.id === j.id || x.suppressed) continue;
      const n = x.a.occ === c ? x.b.occ : x.b.occ === c ? x.a.occ : null;
      if (!n || seen.has(n) || n === '__asm__' || n.startsWith('__')) continue;
      if (n === other) return [occ]; // lazo cerrado: solo la pieza
      if (fixed.has(n)) continue;
      seen.add(n); q2.push(n);
    }
  }
  return [...seen];
}
/** Coloca «occ» con su boca ne contra la boca F (de toOcc) y la une con el giro bloqueado; sustituye la unión `replace` */
function foranJoin(occ: string, pd: PartDoc, ne: EPoint, toOcc: string, F: NonNullable<ReturnType<typeof R.epFrame>>, replace?: string) {
  const s = S();
  const xf = R.placeOnFrame(F, pd, ne, R.turnOf(F));
  s.commitAsm((a) => {
    const o = a.occurrences.find((x) => x.id === occ); if (!o) return;
    o.xf = { pos: [...xf.pos] as V3, quat: [...xf.quat] as Xform['quat'] };
    if (replace) a.joints = a.joints.filter((x) => x.id !== replace);
    const ob = a.occurrences.find((x) => x.id === toOcc);
    const te = ob && partEPoints(partOf(S(), ob.part)).find((x) => x.id === F.e.id); if (!te) return;
    let j = epJoint(a, occ, ne, toOcc, te, uid);
    if (j.type === 'insert' && !j.lock) {
      const W: V3 = [F.X.x, F.X.y, F.X.z];
      const loc = (q: Xform['quat']) => v3.norm(qq.rotate([-q[0], -q[1], -q[2], q[3]], W)) as V3;
      const Xt = xfOf(toOcc);
      j = { ...j, lock: true, a: { ...j.a, xdir: loc(j.a.occ === occ ? xf.quat as Xform['quat'] : Xt.quat) }, b: { ...j.b, xdir: loc(j.b.occ === occ ? xf.quat as Xform['quat'] : Xt.quat) } };
    }
    a.joints.push(j);
  });
}
/** Boca libre a la que se une la pieza nueva en modo Foran: la de la pieza seleccionada; si no, la de la última insertada */
export function foranTarget(sel: string | null): NonNullable<ReturnType<typeof S>['createTarget']> | null {
  const s = S();
  const occs = s.asm.occurrences.filter((o) => !o.suppressed);
  const order = [...(sel ? occs.filter((o) => o.id === sel) : []), ...[...occs].reverse().filter((o) => o.id !== sel)];
  for (const o of order) {
    const pd = partOf(s, o.part); if (!pd) continue;
    const used = usedEps(o.id);
    const ports = R.portsOf(pd).filter((e) => !e.isDefault && !used.has(e.id));
    if (!ports.length) continue;
    // la «salida»: la siguiente a la boca por la que está unida (en un conducto, el otro extremo)
    const inn = R.portsOf(pd).find((e) => used.has(e.id));
    const nx = inn ? R.nextPort(pd, inn) : undefined;
    const e = (nx && !used.has(nx.id) ? nx : undefined) ?? ports[ports.length - 1];
    const F = R.epFrame(o.id, e.id); if (!F) continue;
    return { occ: o.id, ref: epRef(e, o.id), ep: e.id, epKind: e.kind, label: F.name, pW: [F.P.x, F.P.y, F.P.z], nW: [F.D.x, F.D.y, F.D.z] };
  }
  return null;
}

/** ePoint de conexión de un componente: el de su unión; si no tiene, su primera boca (ep1) o el de inserción */
export function epOfOcc(occ: string) {
  const j = foranJoint(occ);
  if (j?.ep) return R.epFrame(occ, j.ep[j.a.occ === occ ? 'a' : 'b']);
  return rootFrame(occ);
}
function rootFrame(occ: string) {
  const s = S(); const o = s.asm.occurrences.find((x) => x.id === occ); const pd = o && partOf(s, o.part); if (!pd) return null;
  const eps = partEPoints(pd).filter((e) => !e.inactive && e.kind !== 'composite');
  const e = eps.find((x) => x.id === 'ep1') ?? eps.find((x) => !x.isDefault) ?? eps[0];
  return e ? R.epFrame(occ, e.id) : null;
}
/** Todo lo que está unido al componente (por cualquier unión), sin cruzar otros componentes fijos */
function linked(occ: string): string[] {
  const s = S(); const fixed = new Set(s.asm.occurrences.filter((o) => o.grounded && o.id !== occ).map((o) => o.id));
  const seen = new Set([occ]); const q2 = [occ];
  while (q2.length) { const c = q2.shift()!; for (const x of s.asm.joints) { if (x.suppressed) continue; const n = x.a.occ === c ? x.b.occ : x.b.occ === c ? x.a.occ : null; if (!n || seen.has(n) || n.startsWith('__') || fixed.has(n)) continue; seen.add(n); q2.push(n); } }
  return [...seen];
}

/** Componentes que se mueven con «occ» al girarlo o moverlo desde su ePoint (él y lo que arrastra detrás) */
export function epGroup(occ: string): string[] { const j = foranJoint(occ); return j ? subtree(occ, j) : linked(occ); }
