import { create } from 'zustand';
import {
  newDoc, uid, nextName, consumedSketches, newSheetDoc,
  type PartDoc, type Feature, type PlaneRef, type SkEntity, type SketchF, type V3,
} from './doc';
import { newAsm, type AsmDoc } from './asm';
import { newDrawing, type DrawingDoc } from './drawing';
import { cad, type RegenResult, type AsmResult, type MeshData } from './cadClient';

export type DocKind = 'part' | 'assembly' | 'drawing';
export type AnyDoc = PartDoc | AsmDoc | DrawingDoc;
export interface DocEntry { id: string; kind: DocKind; fileName: string; data: AnyDoc; past: AnyDoc[]; future: AnyDoc[]; dirty: boolean }

export type Mode = 'model' | 'sketch' | 'present';
export type Tool = null
  | 'line' | 'rect' | 'circle' | 'npoly' | 'arc' | 'slot' | 'point'
  | 'pickPlane' | 'pickEdges' | 'pickFaces' | 'pickFlangeEdge'
  | 'asmFace' | 'frameLine' | 'skelPoint' | 'weldFace' | 'boltFace' | 'move' | 'pickMember'
  | 'drwDim' | 'drwNote';
export type FeatDialogKind = 'extrude' | 'revolve' | 'fillet' | 'chamfer' | 'hole' | 'pattern' | 'mirror' | 'shell'
  | 'workplane' | 'loft' | 'sweep' | 'sm_face' | 'sm_flange';
export type AsmDialogKind = 'joint' | 'frame' | 'weld' | 'bolt' | 'skel' | 'endtreat';
export type Dialog =
  | null
  | { kind: FeatDialogKind; editId?: string; draft: Feature }
  | { kind: AsmDialogKind; editId?: string; draft: any; step?: number }
  | { kind: 'params' | 'iprops' | 'project' | 'about' | 'shortcuts' | 'place' | 'bom' | 'sheetstyle' | 'flat' | 'newdoc' | 'ilogic' | 'drwview' }
  | { kind: 'fileinfo'; title: string; info: FileInfo };

export interface FileInfo {
  fileName: string; kind: string; message: string;
  props?: { label: string; value: string }[];
  streams?: string[];
  thumbnail?: string;
  svg?: string;
}
export interface ProjectInfo { name: string; fileName: string; entries: { label: string; value: string }[]; xml: string }

export interface State {
  docs: DocEntry[];
  active: string;
  kind: DocKind;
  doc: PartDoc;
  asm: AsmDoc;
  drw: DrawingDoc;
  past: AnyDoc[];
  future: AnyDoc[];
  fileName: string;
  dirty: boolean;

  mode: Mode;
  sketchId: string | null;
  tool: Tool;
  selFeature: string | null;
  selEntity: string | null;
  selItem: string | null;        // ensamblaje: componente/barra/cordón/tornillo/unión; plano: vista
  dialog: Dialog;
  result: RegenResult | null;
  preview: RegenResult | null;
  pickBase: RegenResult | null;
  asmResult: AsmResult | null;
  explodeT: number;
  busy: boolean;
  oc: 'loading' | 'ready' | 'error';
  ocProgress: number;
  ocError: string;
  view: { name: string; n: number };
  showEdges: boolean;
  project: ProjectInfo | null;
  toast: { text: string; kind: 'info' | 'error'; n: number } | null;
  cursor: [number, number] | null;
  menuOpen: boolean;
  confirmBox: { text: string; ok: string; resolve: (v: boolean) => void } | null;
  ask: (text: string, ok?: string) => Promise<boolean>;

  // Documentos
  newDocument: (kind: 'part' | 'sheet' | 'assembly' | 'weldment' | 'drawing') => string;
  addDocument: (kind: DocKind, data: AnyDoc, fileName: string, activate?: boolean, id?: string) => string;
  activate: (id: string) => void;
  closeDocument: (id: string) => void;
  docData: (id: string) => AnyDoc | null;
  partsMap: (ids?: string[]) => Record<string, PartDoc>;

  commit: (fn: (d: PartDoc) => void) => void;
  commitAsm: (fn: (d: AsmDoc) => void) => void;
  commitDrw: (fn: (d: DrawingDoc) => void) => void;
  undo: () => void;
  redo: () => void;
  load: (doc: PartDoc, fileName: string) => void;
  startSketch: (plane: PlaneRef) => void;
  editSketch: (id: string) => void;
  finishSketch: () => void;
  setTool: (t: Tool) => void;
  addEntity: (e: SkEntity) => void;
  updateEntity: (id: string, patch: Partial<SkEntity>) => void;
  deleteEntity: (id: string) => void;
  openFeatureDialog: (kind: FeatDialogKind, editId?: string) => void;
  openAsmDialog: (kind: AsmDialogKind, draft: any, editId?: string, tool?: Tool) => void;
  updateDraft: (patch: Record<string, unknown>) => void;
  applyDialog: (close?: boolean) => void;
  closeDialog: () => void;
  open: (d: Dialog) => void;
  deleteFeature: (id: string) => void;
  toggleSuppress: (id: string) => void;
  renameFeature: (id: string, name: string) => void;
  setView: (name: string) => void;
  notify: (text: string, kind?: 'info' | 'error') => void;
  set: (p: Partial<State>) => void;
}

const clone = <T,>(x: T): T => structuredClone(x);

export const activeSketch = (s: State): SketchF | null => {
  if (s.kind !== 'part') return null;
  const f = s.doc.features.find((x) => x.id === s.sketchId);
  return f && f.type === 'sketch' ? f : null;
};

function defaultProfile(doc: PartDoc): string {
  const used = consumedSketches(doc);
  const sks = doc.features.filter((f): f is SketchF => f.type === 'sketch' && f.entities.some((e) => e.type !== 'line' && e.type !== 'point' && e.type !== 'arc'));
  const free = sks.filter((s) => !used.has(s.id));
  return (free[free.length - 1] ?? sks[sks.length - 1])?.id ?? '';
}
function lastSketch(doc: PartDoc, pred: (s: SketchF) => boolean): string {
  const used = consumedSketches(doc);
  const sks = doc.features.filter((f): f is SketchF => f.type === 'sketch' && pred(f));
  const free = sks.filter((s) => !used.has(s.id));
  return (free[free.length - 1] ?? sks[sks.length - 1])?.id ?? '';
}
const lastBody = (doc: PartDoc) => [...doc.features].reverse().find((f) => ['extrude', 'revolve', 'hole', 'loft', 'sweep'].includes(f.type))?.id;

const firstPart = newDoc();
const FIRST_ID = 'd1';

const baseName = (n: string) => n.replace(/\.[^.]+$/, '');
const uniqueName = (docs: DocEntry[], base: string, ext: string) => {
  let i = 1; const names = new Set(docs.map((d) => d.fileName));
  while (names.has(`${base}${i}${ext}`)) i++;
  return `${base}${i}${ext}`;
};

export const useStore = create<State>((set, get) => ({
  docs: [{ id: FIRST_ID, kind: 'part', fileName: 'Pieza1.i3p', data: firstPart, past: [], future: [], dirty: false }],
  active: FIRST_ID,
  kind: 'part',
  doc: firstPart,
  asm: newAsm(),
  drw: newDrawing(),
  past: [], future: [],
  fileName: 'Pieza1.i3p',
  dirty: false,
  mode: 'model', sketchId: null, tool: null,
  selFeature: null, selEntity: null, selItem: null,
  dialog: null,
  result: null, preview: null, pickBase: null, asmResult: null, explodeT: 0, busy: false,
  oc: 'loading', ocProgress: 0, ocError: '',
  view: { name: 'home', n: 0 },
  showEdges: true,
  project: null,
  toast: null,
  cursor: null,
  menuOpen: false,
  confirmBox: null,
  ask: (text, ok = 'Continuar') => new Promise<boolean>((resolve) => set({ confirmBox: { text, ok, resolve }, menuOpen: false })),

  // ---------- Espacio de trabajo ----------
  docData: (id) => {
    const s = get();
    if (id === s.active) return s.kind === 'part' ? s.doc : s.kind === 'assembly' ? s.asm : s.drw;
    return s.docs.find((d) => d.id === id)?.data ?? null;
  },
  partsMap: (ids) => {
    const s = get();
    const out: Record<string, PartDoc> = {};
    for (const d of s.docs) if (d.kind === 'part' && (!ids || ids.includes(d.id))) out[d.id] = s.docData(d.id) as PartDoc;
    return out;
  },
  addDocument: (kind, data, fileName, activate = true, id) => {
    const nid = id ?? uid('d');
    set({ docs: [...get().docs, { id: nid, kind, fileName, data, past: [], future: [], dirty: false }] });
    if (activate) get().activate(nid);
    return nid;
  },
  newDocument: (k) => {
    const docs = get().docs;
    if (k === 'part' || k === 'sheet') {
      const d = k === 'sheet' ? newSheetDoc() : newDoc();
      const fn = uniqueName(docs, k === 'sheet' ? 'Chapa' : 'Pieza', '.i3p');
      d.iProperties.partNumber = baseName(fn);
      return get().addDocument('part', d, fn);
    }
    if (k === 'assembly' || k === 'weldment') {
      const a = newAsm(k);
      const fn = uniqueName(docs, k === 'weldment' ? 'Soldadura' : 'Ensamblaje', '.i3a');
      a.iProperties.partNumber = baseName(fn);
      return get().addDocument('assembly', a, fn);
    }
    const fn = uniqueName(docs, 'Dibujo', '.i3d');
    return get().addDocument('drawing', newDrawing(), fn);
  },
  activate: (id) => {
    const s = get();
    if (id === s.active) return;
    // Guardar el documento activo en el registro
    const docs = s.docs.map((d) => (d.id === s.active ? { ...d, data: s.docData(s.active)!, past: s.past, future: s.future, dirty: s.dirty, fileName: s.fileName } : d));
    const t = docs.find((d) => d.id === id);
    if (!t) return;
    const common = {
      docs, active: id, kind: t.kind, past: t.past, future: t.future, dirty: t.dirty, fileName: t.fileName,
      mode: 'model' as Mode, sketchId: null, tool: null, selFeature: null, selEntity: null, selItem: null, dialog: null,
      preview: null, pickBase: null, menuOpen: false, view: { name: 'home', n: s.view.n + 1 },
    };
    if (t.kind === 'part') set({ ...common, doc: t.data as PartDoc, result: null });
    else if (t.kind === 'assembly') set({ ...common, asm: t.data as AsmDoc, asmResult: null, explodeT: 0 });
    else set({ ...common, drw: t.data as DrawingDoc });
  },
  closeDocument: (id) => {
    const s = get();
    const rest = s.docs.filter((d) => d.id !== id);
    if (!rest.length) {
      const d = newDoc();
      set({ docs: [{ id: 'd' + Date.now(), kind: 'part', fileName: 'Pieza1.i3p', data: d, past: [], future: [], dirty: false }] });
      get().activate(get().docs[0].id);
      return;
    }
    if (id === s.active) {
      set({ docs: rest, active: '__none' });
      get().activate(rest[rest.length - 1].id);
    } else set({ docs: rest });
  },

  commit: (fn) => {
    const { doc, past } = get();
    const next = clone(doc);
    fn(next);
    set({ doc: next, past: [...past.slice(-99), doc], future: [], dirty: true });
  },
  commitAsm: (fn) => {
    const { asm, past } = get();
    const next = clone(asm);
    fn(next);
    set({ asm: next, past: [...past.slice(-99), asm], future: [], dirty: true });
  },
  commitDrw: (fn) => {
    const { drw, past } = get();
    const next = clone(drw);
    fn(next);
    set({ drw: next, past: [...past.slice(-99), drw], future: [], dirty: true });
  },
  undo: () => {
    const s = get();
    if (!s.past.length) return;
    const prev = s.past[s.past.length - 1];
    const cur = s.docData(s.active)!;
    const key = s.kind === 'part' ? 'doc' : s.kind === 'assembly' ? 'asm' : 'drw';
    const extra = s.kind === 'part' && !(prev as PartDoc).features.some((f) => f.id === s.sketchId) ? { mode: 'model' as Mode, sketchId: null, tool: null } : {};
    set({ [key]: prev, past: s.past.slice(0, -1), future: [cur, ...s.future], dirty: true, selEntity: null, ...extra } as Partial<State>);
  },
  redo: () => {
    const s = get();
    if (!s.future.length) return;
    const key = s.kind === 'part' ? 'doc' : s.kind === 'assembly' ? 'asm' : 'drw';
    set({ [key]: s.future[0], past: [...s.past, s.docData(s.active)!], future: s.future.slice(1), dirty: true } as Partial<State>);
  },
  /** Sustituye el documento de pieza activo (abrir fichero) o crea uno nuevo si el activo no es pieza. */
  load: (doc, fileName) => {
    const s = get();
    const cur = s.docs.find((d) => d.id === s.active);
    const pristine = s.kind === 'part' && !s.dirty && cur && (s.doc.features.length === 0);
    if (!pristine) { get().addDocument('part', doc, fileName); return; }
    set({
      doc, fileName, past: [], future: [], dirty: false, mode: 'model', sketchId: null, tool: null,
      selFeature: null, selEntity: null, dialog: null, preview: null, view: { name: 'home', n: get().view.n + 1 },
      docs: s.docs.map((d) => (d.id === s.active ? { ...d, data: doc, fileName } : d)),
    });
  },

  startSketch: (plane) => {
    const id = uid('s');
    get().commit((d) => { d.features.push({ id, name: nextName(d, 'sketch'), type: 'sketch', plane, entities: [] }); });
    set({ mode: 'sketch', sketchId: id, tool: 'line', selFeature: id, selEntity: null, view: { name: 'sketch', n: get().view.n + 1 } });
  },
  editSketch: (id) => set({ mode: 'sketch', sketchId: id, tool: null, selFeature: id, selEntity: null, dialog: null, view: { name: 'sketch', n: get().view.n + 1 } }),
  finishSketch: () => set({ mode: 'model', sketchId: null, tool: null, selEntity: null, view: { name: 'restore', n: get().view.n + 1 } }),
  setTool: (tool) => set({ tool }),

  addEntity: (e) => {
    const sid = get().sketchId;
    if (!sid) return;
    get().commit((d) => { const s = d.features.find((f) => f.id === sid) as SketchF; s.entities.push(e); });
    set({ selEntity: e.id });
  },
  updateEntity: (id, patch) => {
    const sid = get().sketchId;
    get().commit((d) => {
      const s = d.features.find((f) => f.id === sid) as SketchF;
      const e = s?.entities.find((x) => x.id === id);
      if (e) Object.assign(e, patch);
    });
  },
  deleteEntity: (id) => {
    const sid = get().sketchId;
    get().commit((d) => { const s = d.features.find((f) => f.id === sid) as SketchF; s.entities = s.entities.filter((x) => x.id !== id); });
    set({ selEntity: null });
  },

  openFeatureDialog: (kind, editId) => {
    const { doc } = get();
    if (get().kind !== 'part') return;
    if (get().mode === 'sketch') get().finishSketch();
    let draft: Feature;
    if (editId) {
      draft = clone(doc.features.find((f) => f.id === editId)!);
    } else {
      const id = uid('f'), name = nextName(doc, kind);
      const profile = defaultProfile(doc);
      const body = lastBody(doc);
      switch (kind) {
        case 'extrude': draft = { id, name, type: 'extrude', profile, distance: '10 mm', dir: 'normal', op: 'join' }; break;
        case 'revolve': {
          const sk = doc.features.find((f) => f.id === profile) as SketchF | undefined;
          const line = sk?.entities.find((e) => e.type === 'line');
          draft = { id, name, type: 'revolve', profile, axis: line?.id ?? 'sy', angle: '360 deg', op: 'join' }; break;
        }
        case 'fillet': draft = { id, name, type: 'fillet', radius: '2 mm', edges: { mode: 'picked', points: [] } }; break;
        case 'chamfer': draft = { id, name, type: 'chamfer', distance: '1 mm', edges: { mode: 'picked', points: [] } }; break;
        case 'hole': draft = { id, name, type: 'hole', sketch: lastSketch(doc, (s) => s.entities.some((e) => e.type === 'point' || e.type === 'circle')),
          dia: '10 mm', depth: '20 mm', through: true, kind: 'simple', cbDia: '18 mm', cbDepth: '10 mm', csDia: '20 mm', csAngle: '90 deg', thread: '' }; break;
        case 'pattern': draft = { id, name, type: 'pattern', ptype: 'rect', features: body ? [body] : [], dir1: 'X', n1: '3', d1: '30 mm', dir2: '', n2: '2', d2: '30 mm', axis: 'Z', count: '6', angle: '360 deg' }; break;
        case 'mirror': draft = { id, name, type: 'mirror', features: [], plane: 'YZ' }; break;
        case 'shell': draft = { id, name, type: 'shell', thickness: '2 mm', faces: [] }; break;
        case 'workplane': draft = { id, name, type: 'workplane', base: { kind: 'std', name: 'XY', offset: '0' }, offset: '50 mm', angle: '0 deg' }; break;
        case 'loft': draft = { id, name, type: 'loft', sections: doc.features.filter((f) => f.type === 'sketch' && !consumedSketches(doc).has(f.id)).map((f) => f.id).slice(-2), ruled: false, op: 'join' }; break;
        case 'sweep': {
          const pathSk = lastSketch(doc, (s) => s.entities.length > 0 && s.entities.every((e) => e.type === 'line' || e.type === 'arc'));
          draft = { id, name, type: 'sweep', profile, path: pathSk, op: 'join' }; break;
        }
        case 'sm_face': draft = { id, name, type: 'sm_face', profile }; break;
        case 'sm_flange': draft = { id, name, type: 'sm_flange', edge: null, length: '20 mm', angle: '90 deg', dir: 'up' }; break;
      }
    }
    const tool = toolFor(draft);
    set({ dialog: { kind, editId, draft }, tool, preview: null, pickBase: null });
    if (tool === 'pickEdges' || tool === 'pickFaces' || tool === 'pickFlangeEdge') runPickBase(draft.id);
  },
  openAsmDialog: (kind, draft, editId, tool = null) => set({ dialog: { kind, editId, draft, step: 0 }, tool, menuOpen: false }),
  updateDraft: (patch) => {
    const d = get().dialog;
    if (!d || !('draft' in d)) return;
    const draft = { ...d.draft, ...patch };
    if (get().kind === 'part') set({ dialog: { ...d, draft } as Dialog, tool: toolFor(draft as Feature) });
    else set({ dialog: { ...d, draft } as Dialog });
  },
  applyDialog: (close = true) => {
    const s = get();
    const d = s.dialog;
    if (!d || !('draft' in d)) return;
    const draft = clone(d.draft);
    if (s.kind === 'part') {
      s.commit((doc) => {
        const i = doc.features.findIndex((f) => f.id === draft.id);
        if (i >= 0) doc.features[i] = draft; else doc.features.push(draft);
      });
      set({ selFeature: draft.id });
      if (close) set({ dialog: null, tool: null, preview: null, pickBase: null });
      else get().openFeatureDialog(d.kind as FeatDialogKind);
      return;
    }
    if (s.kind === 'assembly') {
      const coll = ({ joint: 'joints', frame: 'frames', weld: 'welds', bolt: 'bolts', skel: 'skeleton', endtreat: 'frames' } as const)[d.kind as AsmDialogKind];
      const items: any[] = Array.isArray(draft) ? draft : [draft];
      s.commitAsm((a) => {
        const arr = (a as any)[coll] as any[];
        for (const it of items) {
          const i = arr.findIndex((x) => x.id === it.id);
          if (i >= 0) arr[i] = it; else arr.push(it);
        }
      });
      set({ selItem: items[0]?.id ?? null });
      if (close) set({ dialog: null, tool: null });
    }
  },
  closeDialog: () => set({ dialog: null, tool: get().mode === 'sketch' ? get().tool : null, preview: null, pickBase: null }),
  open: (dialog) => set({ dialog, menuOpen: false }),

  deleteFeature: (id) => {
    const { doc } = get();
    const f = doc.features.find((x) => x.id === id);
    if (!f) return;
    get().commit((d) => {
      d.features = d.features.filter((x) => x.id !== id);
      if (f.type === 'extrude' || f.type === 'revolve' || f.type === 'sm_face') {
        const still = consumedSketches(d).has(f.profile);
        if (!still) d.features = d.features.filter((x) => x.id !== f.profile);
      }
    });
    if (get().sketchId === id) get().finishSketch();
    set({ selFeature: null });
  },
  toggleSuppress: (id) => get().commit((d) => { const f = d.features.find((x) => x.id === id); if (f) f.suppressed = !f.suppressed; }),
  renameFeature: (id, name) => get().commit((d) => { const f = d.features.find((x) => x.id === id); if (f && name.trim()) f.name = name.trim(); }),
  setView: (name) => set({ view: { name, n: get().view.n + 1 } }),
  notify: (text, kind = 'info') => set({ toast: { text, kind, n: (get().toast?.n ?? 0) + 1 } }),
  set: (p) => set(p),
}));

function toolFor(f: Feature): Tool {
  if ((f.type === 'fillet' || f.type === 'chamfer') && f.edges.mode === 'picked') return 'pickEdges';
  if (f.type === 'shell') return 'pickFaces';
  if (f.type === 'sm_flange') return 'pickFlangeEdge';
  return null;
}

/** Documento con el borrador del diálogo aplicado (para la vista previa). */
export function previewDoc(s: State): PartDoc | null {
  const d = s.dialog;
  if (s.kind !== 'part' || !d || !('draft' in d)) return null;
  const doc = clone(s.doc);
  const i = doc.features.findIndex((f) => f.id === d.draft.id);
  if (i >= 0) doc.features[i] = d.draft; else doc.features.push(d.draft);
  return doc;
}

// ---- Reconstrucción automática ----
let regenSeq = 0, previewSeq = 0, asmSeq = 0;
let regenTimer: ReturnType<typeof setTimeout> | undefined;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let asmTimer: ReturnType<typeof setTimeout> | undefined;
/** Mallas de piezas ya recibidas, por clave de contenido (se reutilizan entre ensamblajes). */
export const meshCache = new Map<string, MeshData>();

async function runRegen() {
  const s = useStore.getState();
  if (s.oc !== 'ready' || s.kind !== 'part') return;
  const my = ++regenSeq;
  useStore.setState({ busy: true });
  try {
    const r = await cad.regen(s.doc);
    if (my === regenSeq && useStore.getState().kind === 'part') useStore.setState({ result: r, busy: false });
    else useStore.setState({ busy: false });
  } catch (e) {
    if (my === regenSeq) { useStore.setState({ busy: false }); useStore.getState().notify((e as Error).message, 'error'); }
  }
}
async function runAsm() {
  const s = useStore.getState();
  if (s.oc !== 'ready' || s.kind !== 'assembly') return;
  const my = ++asmSeq;
  useStore.setState({ busy: true });
  try {
    const ids = [...new Set(s.asm.occurrences.map((o) => o.part))];
    const r = await cad.asm(s.asm, s.partsMap(ids), [...meshCache.keys()]);
    for (const p of Object.values(r.parts)) {
      if (p.mesh) meshCache.set(p.key, p.mesh); else p.mesh = meshCache.get(p.key);
    }
    if (my === asmSeq && useStore.getState().kind === 'assembly') useStore.setState({ asmResult: r, busy: false });
    else useStore.setState({ busy: false });
  } catch (e) {
    if (my === asmSeq) { useStore.setState({ busy: false }); useStore.getState().notify((e as Error).message, 'error'); }
  }
}
async function runPickBase(featureId: string) {
  const s = useStore.getState();
  if (s.oc !== 'ready') return;
  const i = s.doc.features.findIndex((f) => f.id === featureId);
  const doc = { ...s.doc, features: i >= 0 ? s.doc.features.slice(0, i) : s.doc.features };
  try {
    const r = await cad.regen(doc, true);
    const d = useStore.getState().dialog;
    if (d && 'draft' in d && d.draft.id === featureId) useStore.setState({ pickBase: r });
  } catch { /* opcional */ }
}
async function runPreview() {
  const s = useStore.getState();
  const doc = previewDoc(s);
  if (!doc || s.oc !== 'ready') return;
  const my = ++previewSeq;
  try {
    const r = await cad.regen(doc, true);
    if (my === previewSeq && useStore.getState().dialog) useStore.setState({ preview: r });
  } catch { /* la vista previa es opcional */ }
}

useStore.subscribe((s, prev) => {
  const ocNow = s.oc === 'ready' && prev.oc !== 'ready';
  if (s.kind === 'part' && (s.doc !== prev.doc || ocNow || s.active !== prev.active)) {
    clearTimeout(regenTimer); regenTimer = setTimeout(runRegen, 30);
  }
  if (s.kind === 'assembly' && (s.asm !== prev.asm || ocNow || s.active !== prev.active)) {
    clearTimeout(asmTimer); asmTimer = setTimeout(runAsm, 40);
  }
  if (s.kind === 'part') {
    const dd = s.dialog && 'draft' in s.dialog ? s.dialog.draft : null;
    const pd = prev.dialog && 'draft' in prev.dialog ? prev.dialog.draft : null;
    if (dd && (dd !== pd || s.doc !== prev.doc)) { clearTimeout(previewTimer); previewTimer = setTimeout(runPreview, 120); }
  }
});

export function startCad() {
  cad.onProgress = (v) => useStore.setState({ ocProgress: v });
  cad.init()
    .then(() => useStore.setState({ oc: 'ready', ocProgress: 1 }))
    .catch((e) => useStore.setState({ oc: 'error', ocError: (e as Error).message }));
}

export type { V3 };
