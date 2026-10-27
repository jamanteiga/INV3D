import { create } from 'zustand';
import {
  newDoc, uid, nextName, consumedSketches,
  type PartDoc, type Feature, type PlaneRef, type SkEntity, type SketchF, type V3,
} from './doc';
import { cad, type RegenResult } from './cadClient';

export type Mode = 'model' | 'sketch';
export type Tool = null | 'line' | 'rect' | 'circle' | 'npoly' | 'pickPlane' | 'pickEdges';
export type FeatDialogKind = 'extrude' | 'revolve' | 'fillet' | 'chamfer';
export type Dialog =
  | null
  | { kind: FeatDialogKind; editId?: string; draft: Feature }
  | { kind: 'params' | 'iprops' | 'project' | 'about' | 'shortcuts' }
  | { kind: 'fileinfo'; title: string; info: FileInfo };

export interface FileInfo {
  fileName: string; kind: string; message: string;
  props?: { label: string; value: string }[];
  streams?: string[];
  thumbnail?: string;
}
export interface ProjectInfo { name: string; fileName: string; entries: { label: string; value: string }[]; xml: string }

export interface State {
  doc: PartDoc;
  past: PartDoc[];
  future: PartDoc[];
  fileName: string;
  dirty: boolean;
  mode: Mode;
  sketchId: string | null;
  tool: Tool;
  selFeature: string | null;
  selEntity: string | null;
  dialog: Dialog;
  result: RegenResult | null;
  preview: RegenResult | null;
  pickBase: RegenResult | null;
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

  commit: (fn: (d: PartDoc) => void) => void;
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
  updateDraft: (patch: Partial<Feature>) => void;
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
  const f = s.doc.features.find((x) => x.id === s.sketchId);
  return f && f.type === 'sketch' ? f : null;
};

function defaultProfile(doc: PartDoc): string {
  const used = consumedSketches(doc);
  const sks = doc.features.filter((f): f is SketchF => f.type === 'sketch' && f.entities.some((e) => e.type !== 'line'));
  const free = sks.filter((s) => !used.has(s.id));
  return (free[free.length - 1] ?? sks[sks.length - 1])?.id ?? '';
}

export const useStore = create<State>((set, get) => ({
  doc: newDoc(),
  past: [], future: [],
  fileName: 'Pieza1.i3p',
  dirty: false,
  mode: 'model', sketchId: null, tool: null,
  selFeature: null, selEntity: null,
  dialog: null,
  result: null, preview: null, pickBase: null, busy: false,
  oc: 'loading', ocProgress: 0, ocError: '',
  view: { name: 'home', n: 0 },
  showEdges: true,
  project: null,
  toast: null,
  cursor: null,
  menuOpen: false,
  confirmBox: null,
  ask: (text, ok = 'Continuar') => new Promise<boolean>((resolve) => set({ confirmBox: { text, ok, resolve }, menuOpen: false })),

  commit: (fn) => {
    const { doc, past } = get();
    const next = clone(doc);
    fn(next);
    set({ doc: next, past: [...past.slice(-99), doc], future: [], dirty: true });
  },
  undo: () => {
    const { past, doc, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    const stillThere = prev.features.some((f) => f.id === get().sketchId);
    set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future], dirty: true, selEntity: null,
      ...(stillThere ? {} : { mode: 'model', sketchId: null, tool: null }) });
  },
  redo: () => {
    const { past, doc, future } = get();
    if (!future.length) return;
    set({ doc: future[0], past: [...past, doc], future: future.slice(1), dirty: true });
  },
  load: (doc, fileName) => set({
    doc, fileName, past: [], future: [], dirty: false, mode: 'model', sketchId: null, tool: null,
    selFeature: null, selEntity: null, dialog: null, preview: null, view: { name: 'home', n: get().view.n + 1 },
  }),

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
    if (get().mode === 'sketch') get().finishSketch();
    let draft: Feature;
    if (editId) {
      draft = clone(doc.features.find((f) => f.id === editId)!);
    } else {
      const id = uid('f'), name = nextName(doc, kind);
      const profile = defaultProfile(doc);
      if (kind === 'extrude') draft = { id, name, type: 'extrude', profile, distance: '10 mm', dir: 'normal', op: 'join' };
      else if (kind === 'revolve') {
        const sk = doc.features.find((f) => f.id === profile) as SketchF | undefined;
        const line = sk?.entities.find((e) => e.type === 'line');
        draft = { id, name, type: 'revolve', profile, axis: line?.id ?? 'sy', angle: '360 deg', op: 'join' };
      } else if (kind === 'fillet') draft = { id, name, type: 'fillet', radius: '2 mm', edges: { mode: 'picked', points: [] } };
      else draft = { id, name, type: 'chamfer', distance: '1 mm', edges: { mode: 'picked', points: [] } };
    }
    const pick = (draft.type === 'fillet' || draft.type === 'chamfer') && draft.edges.mode === 'picked';
    set({ dialog: { kind, editId, draft }, tool: pick ? 'pickEdges' : null, preview: null, pickBase: null });
    if (draft.type === 'fillet' || draft.type === 'chamfer') runPickBase(draft.id);
  },
  updateDraft: (patch) => {
    const d = get().dialog;
    if (!d || !('draft' in d)) return;
    const draft = { ...d.draft, ...patch } as Feature;
    const pick = (draft.type === 'fillet' || draft.type === 'chamfer') && draft.edges.mode === 'picked';
    set({ dialog: { ...d, draft }, tool: pick ? 'pickEdges' : null });
  },
  applyDialog: (close = true) => {
    const d = get().dialog;
    if (!d || !('draft' in d)) return;
    const draft = clone(d.draft);
    get().commit((doc) => {
      const i = doc.features.findIndex((f) => f.id === draft.id);
      if (i >= 0) doc.features[i] = draft; else doc.features.push(draft);
    });
    set({ selFeature: draft.id });
    if (close) set({ dialog: null, tool: null, preview: null, pickBase: null });
    else get().openFeatureDialog(d.kind as FeatDialogKind);
  },
  closeDialog: () => set({ dialog: null, tool: get().mode === 'sketch' ? get().tool : null, preview: null, pickBase: null }),
  open: (dialog) => set({ dialog, menuOpen: false }),

  deleteFeature: (id) => {
    const { doc } = get();
    const f = doc.features.find((x) => x.id === id);
    if (!f) return;
    get().commit((d) => {
      d.features = d.features.filter((x) => x.id !== id);
      // Como Inventor: al borrar una operación se borra su boceto consumido si nadie más lo usa.
      if (f.type === 'extrude' || f.type === 'revolve') {
        const still = d.features.some((x) => (x.type === 'extrude' || x.type === 'revolve') && x.profile === f.profile);
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

/** Documento con el borrador del diálogo aplicado (para la vista previa). */
export function previewDoc(s: State): PartDoc | null {
  const d = s.dialog;
  if (!d || !('draft' in d)) return null;
  const doc = clone(s.doc);
  const i = doc.features.findIndex((f) => f.id === d.draft.id);
  if (i >= 0) doc.features[i] = d.draft; else doc.features.push(d.draft);
  return doc;
}

// ---- Reconstrucción automática ----
let regenSeq = 0, previewSeq = 0;
let regenTimer: ReturnType<typeof setTimeout> | undefined;
let previewTimer: ReturnType<typeof setTimeout> | undefined;

async function runRegen() {
  const s = useStore.getState();
  if (s.oc !== 'ready') return;
  const my = ++regenSeq;
  useStore.setState({ busy: true });
  try {
    const r = await cad.regen(s.doc);
    if (my === regenSeq) useStore.setState({ result: r, busy: false });
  } catch (e) {
    if (my === regenSeq) { useStore.setState({ busy: false }); useStore.getState().notify((e as Error).message, 'error'); }
  }
}
/** Sólido sin la operación en edición: base para seleccionar aristas. */
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
  if (s.doc !== prev.doc || (s.oc === 'ready' && prev.oc !== 'ready')) {
    clearTimeout(regenTimer); regenTimer = setTimeout(runRegen, 30);
  }
  const dd = s.dialog && 'draft' in s.dialog ? s.dialog.draft : null;
  const pd = prev.dialog && 'draft' in prev.dialog ? prev.dialog.draft : null;
  if (dd && (dd !== pd || s.doc !== prev.doc)) { clearTimeout(previewTimer); previewTimer = setTimeout(runPreview, 120); }
});

export function startCad() {
  cad.onProgress = (v) => useStore.setState({ ocProgress: v });
  cad.init()
    .then(() => useStore.setState({ oc: 'ready', ocProgress: 1 }))
    .catch((e) => useStore.setState({ oc: 'error', ocError: (e as Error).message }));
}

export type { V3 };
