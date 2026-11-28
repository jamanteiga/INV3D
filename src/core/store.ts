import { create } from 'zustand';
import {
  newDoc, uid, nextName, consumedSketches, newSheetDoc, docParams,
  type PartDoc, type Feature, type PlaneRef, type SkEntity, type SketchF, type V3, type ConstraintType, type SkConstraint,
  syncModelParams,
  syncCenterAxes, eopIndex, eopNormalize } from './doc';
import { makeEval } from './expr';
import { migrateHvacDoc } from './hvac';
import { updateAnchors } from './epanchor';
import { refreshEpRefs } from './epoints';
import { solve, applySolution, checkNew } from './sketch';
import { newAsm, solveAssembly, applyAssociative, type AsmDoc, type Xform } from './asm';
import { normalizeAsm, expandAsm, hasSubs } from './subasm';
import { type SheetSize, newDrawing, type DrawingDoc } from './drawing';
import { cad, type RegenResult, type AsmResult, type MeshData } from './cadClient';
import { DEFAULT_SETTINGS, type AppSettings, type UserLibs, type RecentItem } from './persist';

export type DocKind = 'part' | 'assembly' | 'drawing';
export type AnyDoc = PartDoc | AsmDoc | DrawingDoc;
export interface DocEntry { id: string; kind: DocKind; fileName: string; data: AnyDoc; past: AnyDoc[]; future: AnyDoc[]; dirty: boolean; /** ruta relativa en la carpeta de trabajo */ path?: string; /** pieza cargada solo como referencia de un ensamblaje (en memoria, sin pestaña), */ hidden?: boolean; /** pieza vacía de arranque: se descarta sola al abrir o crear otro documento si no se ha tocado */ blank?: boolean }

export type Mode = 'model' | 'sketch' | 'present';
export interface FemLoad { faces: number[]; kind: 'force' | 'pressure'; F: [number, number, number]; p: number }
export interface FemState {
  part: string; pick: 'fixed' | number; fixed: number[]; loads: FemLoad[]; h: number;
  res?: { vm: Float32Array; disp: Float32Array; vmMax: number; dispMax: number; nVox: number; nDof: number; iters: number; ms: number; mesh: MeshData; disp3: { vertices: Float32Array; normals: Float32Array; triangles: Uint32Array } };
  show: 'vm' | 'disp'; running?: boolean;
  /** Generador de formas: fracción de masa, iteraciones y forma resultante */
  frac?: number; iters?: number;
  shapeRes?: { vertices: Float32Array; normals: Float32Array; triangles: Uint32Array; kept: number; ms: number; nVox: number };
}
export type ClipPlaneName = 'XYc' | 'XZc' | 'YZc' | 'XY' | 'XZ' | 'YZ' | '*';
export type ClipDir = '-x' | '+x' | '-y' | '+y' | '-z' | '+z';
export interface ClipTool {
  /** plano: oculta un lado · franja: solo se ve la rodaja entre dos planos · manual (M): punto + sentido */
  mode: 'plane' | 'slab' | 'manual';
  plane: ClipPlaneName;
  /** posición del plano (0–1 del tamaño del modelo) en los modos plano y franja */
  pos: number;
  dir: ClipDir;
  /** punto del modo M (y del plano libre «*») y normal del plano libre */
  pt: [number, number, number]; normal: [number, number, number];
  /** paso de las flechas y espesor de la franja (mm) */
  step: number;
  /** modo M: parte visible del modelo (1 = 100 %, no se oculta nada; 0 = se oculta todo) */
  mpos: number;
  /** modo M: ya se ha designado un punto 3D */
  ptSet?: boolean;
  /** R: invierte el lado que se oculta */
  flip: boolean;
  /** mostrar el plano en el 3D */
  show: boolean;
}
export const CLIP0: ClipTool = { mode: 'plane', plane: 'XYc', pos: 0.5, dir: '-x', pt: [0, 0, 0], normal: [0, 0, 1], step: 100, mpos: 1, flip: false, show: true, ptSet: false };
/** Modo M: coordenadas del plano en su eje para «nada oculto» (100 %) y «todo oculto» (0 %), con un pequeño margen */
export function manualRange(ct: ClipTool, mn: number[], mx: number[]) {
  const ax = 'xyz'.indexOf(ct.dir[1]), hideNeg = ct.dir[0] === '-' ? !ct.flip : ct.flip;
  const m = Math.max(0.5, 0.005 * (mx[ax] - mn[ax])), lo = mn[ax] - m, hi = mx[ax] + m;
  return { ax, hideNeg, none: hideNeg ? lo : hi, all: hideNeg ? hi : lo };
}
/** Modo M: coordenada del plano */
export function manualX(ct: ClipTool, mn: number[], mx: number[]) { const r = manualRange(ct, mn, mx); return r.all + ct.mpos * (r.none - r.all); }
/** Modo M: porcentaje visible que deja el plano en la coordenada X */
export function manualMpos(ct: ClipTool, mn: number[], mx: number[], X: number) {
  const r = manualRange(ct, mn, mx), d = r.none - r.all;
  return Math.min(1, Math.max(0, Math.abs(d) < 1e-9 ? 1 : (X - r.all) / d));
}
export interface HudState {
  style: 'shaded' | 'hlr' | 'hlv';
  clipOff: number; clipFlip: boolean;
  origin: boolean; sketches: boolean; triad: boolean; cube: boolean;
  /** mostrar el centro de gravedad (CDG) */
  cog?: boolean;
  /** ocultar las anotaciones 3D */
  pmiHidden?: boolean;
  /** mostrar los ePoints de los componentes en el ensamblaje (por defecto, sí) */
  epoints?: boolean;
  scene: 'grad' | 'white' | 'studio' | 'dark' | 'blue';
}
const HUD0: HudState = { style: 'shaded', clipOff: 0, clipFlip: false, origin: true, sketches: true, triad: true, cube: true, scene: 'grad' };
function loadHud(): HudState { try { return { ...HUD0, ...JSON.parse(localStorage.getItem('inv3d.hud') || '{}'), clipOff: 0, clipFlip: false }; } catch { return HUD0; } }
export type Tool = null
  | 'meshPick' | 'pmiPick' | 'regionPick' | 'limitPick' | 'cloudPick'
  | 'line' | 'rect' | 'circle' | 'npoly' | 'arc' | 'slot' | 'point'
  | 'arc3' | 'arctan' | 'rect3' | 'rectc' | 'circle3' | 'spline' | 'ellipse' | 'text'
  | 'skdim' | 'constrain' | 'trim' | 'extend' | 'fillet2d' | 'chamfer2d' | 'projectGeom' | 'skpick' | 'pickWorkBase' | 'measure' | 'asmCreatePick' | 'hvacRoute' | 'epMove'
  | 'pickPlane' | 'pickEdges' | 'pickFaces' | 'pickFlangeEdge' | 'femFace' | 'epPick' | 'epEdge' | 'holeFace' | 'holeEdge1' | 'holeEdge2' | 'projFace' | 'projSurf' | 'fastHole'
  | 'asmFace' | 'frameLine' | 'skelPoint' | 'weldFace' | 'boltFace' | 'move' | 'pickMember' | 'place'
  | 'drwDim' | 'drwNote' | 'drwDimD' | 'drwDimR' | 'drwDimA' | 'drwBalloon' | 'drwLeader' | 'drwHole' | 'drwSurface' | 'drwWeld' | 'drwCenterline' | 'drwCenterMark' | 'drwSection' | 'drwDetail' | 'drwAux' | 'drwBreak' | 'drwCrop' | 'drwOrd' | 'drwBaseline' | 'drwFcf' | 'drwDatum' | 'drwSectionPath' | 'drwBreakout';
export type FeatDialogKind = 'extrude' | 'revolve' | 'fillet' | 'chamfer' | 'hole' | 'pattern' | 'mirror' | 'shell'
  | 'workplane' | 'loft' | 'sweep' | 'sm_face' | 'sm_flange' | 'rib' | 'coil' | 'split' | 'draft' | 'thicken' | 'thread' | 'workaxis' | 'workpoint'
  | 'combine' | 'movebody' | 'derive' | 'pathpattern' | 'sm_contour' | 'sm_punch'
  | 'surf_extrude' | 'surf_revolve' | 'surf_loft' | 'surf_patch' | 'stitch' | 'sm_loft'
  | 'sm_roll' | 'sm_bend' | 'sm_fold' | 'sm_seam' | 'sm_rip' | 'sm_unfold' | 'sm_refold' | 'sm_mark' | 'skpattern'
  | 'slot' | 'direct' | 'delface' | 'finish' | 'decal' | 'unwrap' | 'ruled' | 'surftrim' | 'surfextend' | 'sculpt' | 'replaceface' | 'repair' | 'ffbox' | 'ffface';
export type AsmDialogKind = 'joint' | 'frame' | 'weld' | 'bolt' | 'skel' | 'endtreat' | 'asmwp';
export type Dialog =
  | null
  | { kind: FeatDialogKind; editId?: string; draft: Feature }
  | { kind: AsmDialogKind; editId?: string; draft: any; step?: number }
  | { kind: 'newdoc'; start: true }
  | { kind: 'firstplace'; pid: string; extras?: string[] }
  | { kind: 'routeto'; occ: string; ep: string }
  | { kind: 'params' | 'iprops' | 'project' | 'about' | 'shortcuts' | 'place' | 'bom' | 'sheetstyle' | 'flat' | 'asmcalc' | 'newdoc' | 'ilogic' | 'drwview' | 'content' | 'cpattern' | 'interf' | 'spacemouse' | 'drive' | 'replace' | 'viewreps' | 'mstates' | 'ductnet' | 'pipenet' | 'pressure' | 'vessel' | 'framecalc' | 'jointcalc' | 'gen' | 'tbtpl' | 'ifc' | 'epoint' | 'drwsection' | 'drwdetail' | 'options' | 'folder' | 'drwstyle' | 'retrieve' | 'motion' | 'ipart' | 'ifeature' | 'osnap' | 'projsk' | 'sheettpl' | 'ucs' | 'simplify' | 'meshfit' }
  | { kind: 'fem'; shape?: boolean }
  | { kind: 'fab'; tab?: 'nest' | 'spools' | 'draw' | 'units' | 'labels' | 'bolts' | 'budget' | 'status' | 'rev' }
  | { kind: 'segunits' }
  | { kind: 'insulate'; scope?: string[] }
  | { kind: 'pmi'; pmiKind: import('./pmi').PmiKind; editId?: string }
  | { kind: 'tolstack' | 'toladvisor' | 'promote' | 'drf' | 'analysis' | 'region' | 'limits' | 'material' | 'appearance' | 'docset' | 'news' | 'links' | 'addins' | 'macros' | 'find' | 'purge' | 'insertobj' | 'exportobj' | 'structshape' | 'cloud' | 'rules' | 'publish' | 'studio' | 'mold' | 'bim' | 'print3d' | 'share' }
  | { kind: 'savenewpart'; part: string; occ: string }
  | { kind: 'createcomp' }
  | { kind: 'toolbars' }
  | { kind: 'contentf'; fam: string }
  | { kind: 'fastener'; fx: Record<string, unknown> }
  | { kind: 'projto'; mode: 'face' | 'surf' }
  | { kind: 'auxsketch'; init?: { pt?: string; ax?: string } }
  | { kind: 'asmaux'; aux: 'axis' | 'point' }
  | { kind: 'sketch3d'; id?: string }
  | { kind: 'piping'; pk: string; norm: 'ASME' | 'EN'; edit?: { pid: string; spec: unknown }; init?: { size?: string; sch?: string; wall?: number; material?: string; flStd?: string; rating?: number; flType?: string } }
  | { kind: 'hvac'; hk: string; shape?: 'rect' | 'round' | 'oval'; init?: unknown; edit?: { pid: string; spec: unknown } }
  | { kind: 'flat'; pid?: string }
  | { kind: 'spiro'; sk: string }
  | { kind: 'ductcalc' }
  | { kind: 'occprops'; occ: string }
  | { kind: 'drwviewprops'; view: string }
  | { kind: 'fileinfo'; title: string; info: FileInfo }
  | { kind: 'skop'; op: SkOp; params: Record<string, string>; step: number; base?: string };
export type SkOp = 'offset' | 'mirror' | 'rpattern' | 'cpattern' | 'move' | 'copy' | 'rotate' | 'scale' | 'fillet' | 'chamfer' | 'text';
export interface SketchInfo { dof: number; under: string[]; ok: boolean }

export interface FileInfo {
  fileName: string; kind: string; message: string;
  props?: { label: string; value: string }[];
  streams?: string[];
  thumbnail?: string;
  svg?: string;
}
export interface ProjectInfo { name: string; fileName: string; entries: { label: string; value: string }[]; xml: string; fdp?: import('./fdp').FdpProject }

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
  /** Selección múltiple de geometría de boceto (Ctrl+clic) */
  selEntities: string[];
  /** Restricción o cota seleccionada */
  selCon: string | null;
  conType: ConstraintType;
  showCons: boolean;
  /** estilo de la geometría nueva del boceto: normal, construcción (fina discontinua) o línea eje (trazo y punto) */
  skStyle: 'normal' | 'construction' | 'center';
  skInfo: SketchInfo | null;
  /** Grados de libertad de los componentes del ensamblaje activo */
  asmDof: Record<string, number> | null;
  /** Resultado del análisis de interferencias (resaltado en el visor) */
  interf: { a: string; b: string; volume: number; mesh: MeshData }[] | null;
  /** Parámetros de la herramienta de boceto activa (radio de empalme, etc.) */
  toolParam: string;
  /** Colocación interactiva: componente pendiente que sigue al cursor */
  /** Edición en contexto: pieza que se edita dentro de un ensamblaje y geometría del resto de componentes (en coordenadas de la pieza) */
  /** Aprovechamiento de las barras tras el cálculo (para colorearlas) */
  memberUtil: Record<string, number> | null;
  /** Análisis FEM lineal de la pieza activa: caras elegidas y resultado (σ von Mises y desplazamiento por vértice) */
  fem: FemState | null;
  /** Última cara elegida para un ePoint (punto, dirección y, si es cilíndrica, radio) */
  epPick: { point: V3; dir: V3; radius?: number; axis: boolean; n: number; anchor?: import('./epanchor').EpAnchor } | null;
  /** Creación de ePoints: punto de la cara, centro de cara, círculo, 3 aristas (conducto rectangular) u oval (2 aristas) */
  /** boceto origen para «Proyectar sobre cara/plano» y «Proyectar sobre superficie» */
  projSrc: string | null;
  epMode: 'face' | 'facec' | 'circle' | 'edges3' | 'oval2';
  epEdges: number[];
  /** Detección de colisiones al mover componentes */
  collide: boolean;
  ctxEdit: { asm: string; occ: string; part: string; asmName: string; mesh: MeshData | null; isNew?: boolean } | null;
  placing: { part: string; occ: string; quat: [number, number, number, number]; extras?: string[] } | null;
  /** Ensamblaje: componentes con su origen (planos y ejes de la pieza) visible */
  asmOrigins: string[];
  /** Ensamblaje: ePoint elegido esperando el ePoint de otro componente para conectarlos */
  epConnect: { occ: string; ep: string; label: string } | null;
  /** Crear componente: geometría elegida a la que se restringirá la pieza del centro de contenido */
  /** Crear componente: familia elegida (HVAC o Mecánica); null = según la pieza de referencia */
  createCat: 'hvac' | 'mech' | null;
  /** Crear componente recursivo: tras colocar una pieza se sigue desde su boca libre */
  createRecursive: boolean;
  /** Giro libre (G): componente que gira siguiendo al ratón hasta clic (aceptar) o Esc (cancelar) */
  freeRot: string | null;
  /** Foran: pieza a la que se busca otra boca de destino (Cambiar boca) */
  reattach: string | null;
  /** Insertar en línea: tramo y distancia desde su entrada */
  inlineAt: { occ: string; d: number } | null;
  /** Tender hasta: boca de salida, mientras se elige la de destino */
  routePick: { occ: string; ep: string } | null;
  /** Ramal seleccionado (componentes resaltados) */
  selGroup: string[] | null;
  /** Elegir con el ratón las piezas de una unidad de montaje (id: la que se edita) */
  unitPick: { id?: string } | null;
  /** Mover desde el ePoint: componente con la tríada */
  epMove: string | null;
  createTarget: { occ: string; ref: import('./asm').FaceRef; ep?: string; epKind?: string; label: string; pW: V3; nW: V3 } | null;
  /** Ensamblaje › Rotar: arrastrar una pieza la gira sola (temporal si está restringida o fija) */
  asmRotate: boolean;
  /** Panel del asistente IA abierto */
  aiOpen: boolean;
  /** Chapa: el visor muestra el patrón plano */
  flatView: boolean;
  /** Ajustar a malla: zona elegida de una malla de referencia y su ajuste */
  /** Análisis visual de superficie: cebra, inclinación (desmoldeo) o curvatura */
  analysis: { kind: 'zebra' | 'draft' | 'curv'; dir: 'X' | 'Y' | 'Z'; angle: number; stripes: number } | null;
  /** Modo estudio (render realista: entorno, sombras y suelo) */
  studio: boolean;
  /** Puntos elegidos en el modelo para una anotación, AutoLímite o región (con su normal) */
  picks: { p: V3; n: V3; group: number }[];
  meshSel: { ref: string; tris: number[]; fit?: import('./meshfit').MeshFit; err?: string } | null;
  /** Cara plana seleccionada en el modelo: plano listo para «Iniciar boceto 2D» */
  selFacePlane: PlaneRef | null;
  /** Operación que espera un boceto (corte, punzonado…): al terminar el boceto se reabre con él */
  pendingFeature: { type: string; draft: Record<string, unknown> } | null;
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
  /** Estilo visual: alámbrico y vista de corte 3D (plano X, Y o Z por el centro) */
  wire: boolean;
  /** Nombre del ratón 3D conectado ('' si no hay) */
  spaceMouse: string;
  clip: '' | 'X' | 'Y' | 'Z';
  /** Barra de vista: estilo, sección, visibilidad y escena */
  hud: HudState;
  /** Modo de recorte (barra de recorte): plano, franja o manual */
  clipTool: ClipTool | null;
  project: ProjectInfo | null;
  /** Configuración persistente */
  settings: AppSettings;
  libs: UserLibs;
  recent: RecentItem[];
  folder: { name: string; state: 'none' | 'prompt' | 'granted' };
  toast: { text: string; kind: 'info' | 'error'; n: number } | null;
  cursor: [number, number] | null;
  menuOpen: boolean;
  confirmBox: { text: string; ok: string; resolve: (v: boolean) => void } | null;
  ask: (text: string, ok?: string) => Promise<boolean>;

  // Documentos
  newDocument: (kind: 'part' | 'sheet' | 'assembly' | 'weldment' | 'drawing' | 'asmHvac' | 'asmMech', sheet?: SheetSize) => string;
  addDocument: (kind: DocKind, data: AnyDoc, fileName: string, activate?: boolean, id?: string) => string;
  activate: (id: string) => void;
  closeDocument: (id: string) => void;
  /** Quita la pestaña de una pieza que usa un ensamblaje (queda en memoria) */
  hideDocument: (id: string) => void;
  docData: (id: string) => AnyDoc | null;
  partsMap: (ids?: string[]) => Record<string, PartDoc>;

  commit: (fn: (d: PartDoc) => void) => void;
  commitAsm: (fn: (d: AsmDoc) => void) => void;
  /** Cambia una pieza abierta en memoria (no activa) y recalcula el ensamblaje activo */
  editPartDoc: (id: string, next: PartDoc) => void;
  /** Vista previa: cambia la pieza sin historial ni marca de modificado (Cancelar la restaura) */
  previewPartDoc: (id: string, data: PartDoc, dirty?: boolean) => void;
  /** Acepta los cambios de la vista previa: guarda el original en el historial y marca la pieza como modificada */
  commitPartDoc: (id: string, orig: PartDoc) => void;
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
  /** Modifica el boceto activo y lo resuelve; si no converge se descarta el cambio. */
  sketchCommit: (fn: (sk: SketchF) => SketchF | void, msgOnFail?: string) => boolean;
  addConstraint: (c: SkConstraint, opts?: { force?: boolean }) => boolean;
  deleteConstraint: (id: string) => void;
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

// En chapa solo se proponen bocetos libres: reutilizar el de la cara base haría que un corte se llevara toda la chapa
function defaultProfile(doc: PartDoc): string {
  const used = consumedSketches(doc);
  const sks = doc.features.filter((f): f is SketchF => f.type === 'sketch' && f.entities.some((e) => e.type !== 'point' && !e.construction));
  const free = sks.filter((s) => !used.has(s.id));
  return (free[free.length - 1] ?? (doc.sheet ? undefined : sks[sks.length - 1]))?.id ?? '';
}
function lastSketch(doc: PartDoc, pred: (s: SketchF) => boolean): string {
  const used = consumedSketches(doc);
  const sks = doc.features.filter((f): f is SketchF => f.type === 'sketch' && pred(f));
  const free = sks.filter((s) => !used.has(s.id));
  return (free[free.length - 1] ?? (doc.sheet ? undefined : sks[sks.length - 1]))?.id ?? '';
}
const lastBody = (doc: PartDoc) => [...doc.features].reverse().find((f) => ['extrude', 'revolve', 'hole', 'loft', 'sweep', 'rib', 'coil'].includes(f.type))?.id;

/** Aplica el estilo activo (construcción / línea eje) a una entidad nueva */
export function styled(e: SkEntity, st: 'normal' | 'construction' | 'center'): SkEntity {
  if (st === 'normal' || e.type === 'point' || e.type === 'text' || e.construction) return e;
  if (st === 'center') return e.type === 'line' ? { ...e, center: true, construction: true } : e;
  return { ...e, construction: true };
}
/** Materiales ASTM antiguos → designación ASME Sección II (SA-…; ASTM A105 → SA-105N). Las normas ASTM F (arandelas F436) no cambian. */
export function migrateMaterials<T>(data: T): T {
  const j = JSON.stringify(data);
  if (!/ASTM A\d|"A19[34] /.test(j) && !/A19[34] (B7|2H)/.test(j)) return data;
  return JSON.parse(j.replace(/ASTM A105\b/g, 'SA-105N').replace(/ASTM A(\d+)/g, 'SA-$1').replace(/(^|[^-])\bA193 B7/g, '$1SA-193 B7').replace(/(^|[^-])\bA194 2H/g, '$1SA-194 2H')) as T;
}
function makeSafeEval(doc: PartDoc) { const e = makeEval(docParams(doc)); return (x: string) => { try { return e(x); } catch { return NaN; } }; }
/** Vuelve a resolver los bocetos con restricciones (p. ej. tras cambiar un parámetro). */
function resolveAll(doc: PartDoc, skip?: string) {
  syncModelParams(doc); // c1, c2… para los valores nuevos de las operaciones
  let ev: ((x: string) => number) | null = null;
  for (const f of doc.features) {
    if (f.type !== 'sketch' || !f.constraints?.length || f.id === skip) continue;
    ev ??= makeSafeEval(doc);
    const r = solve(f, ev, { analyse: false, maxIt: 40 });
    if (r.ok) applySolution(f, r);
  }
}
/** Grados de libertad del boceto activo (para colores y barra de estado). */
export function sketchInfo(s: State): SketchInfo | null {
  const sk = activeSketch(s); if (!sk) return null;
  const r = solve(sk, makeSafeEval(s.doc), { maxIt: 0, tol: 1e-3 });
  return { dof: r.dof, under: [...r.underIds], ok: r.ok };
}

const firstPart = newDoc();
const FIRST_ID = 'd1';

const baseName = (n: string) => n.replace(/\.[^.]+$/, '');
const uniqueName = (docs: DocEntry[], base: string, ext: string) => {
  let i = 1; const names = new Set(docs.map((d) => d.fileName));
  while (names.has(`${base}${i}${ext}`)) i++;
  return `${base}${i}${ext}`;
};

/** Ajustes automáticos tras cada cambio del ensamblaje, en el mismo paso de deshacer (p. ej. aislamiento asociado) */
export const asmPostHooks: ((a: AsmDoc) => void)[] = [];

export const useStore = create<State>((set, get) => ({
  docs: [{ id: FIRST_ID, kind: 'part', fileName: 'Pieza1.i3p', data: firstPart, past: [], future: [], dirty: false, blank: true }],
  active: FIRST_ID,
  kind: 'part',
  doc: firstPart,
  asm: newAsm(),
  drw: newDrawing(),
  past: [], future: [],
  fileName: 'Pieza1.i3p',
  dirty: false,
  mode: 'model', sketchId: null, tool: null,
  selFeature: null, selEntity: null, selItem: null, selEntities: [], selCon: null, conType: 'coincident', showCons: true, skStyle: 'normal', skInfo: null, asmDof: null, interf: null, toolParam: '', placing: null, asmOrigins: [], epConnect: null, createCat: null, createRecursive: (() => { try { return localStorage.getItem('inv3d.recursive') !== '0'; } catch { return true; } })(), freeRot: null, createTarget: null, reattach: null, inlineAt: null, routePick: null, selGroup: null, unitPick: null, epMove: null, asmRotate: false, aiOpen: false, flatView: false, meshSel: null, analysis: null, studio: false, picks: [], selFacePlane: null, pendingFeature: null, ctxEdit: null, collide: false, memberUtil: null, fem: null, epPick: null, projSrc: null, epMode: 'facec', epEdges: [],
  dialog: null,
  result: null, preview: null, pickBase: null, asmResult: null, explodeT: 0, busy: false,
  oc: 'loading', ocProgress: 0, ocError: '',
  view: { name: 'home', n: 0 },
  showEdges: true, wire: false, spaceMouse: '', clip: '', hud: loadHud(), clipTool: null,
  project: null,
  settings: { ...DEFAULT_SETTINGS },
  libs: { materials: [] },
  recent: [],
  folder: { name: '', state: 'none' },
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
    for (const d of s.docs) if (d.kind === 'part' && (!ids || ids.includes(d.id))) out[d.id] = liveDerive(s.docData(d.id) as PartDoc);
    return out;
  },
  addDocument: (kind, data, fileName, activate = true, id) => {
    const nid = id ?? uid('d');
    data = migrateMaterials(data);
    if (kind === 'part') { data = clone(data); migrateHvacDoc(data as PartDoc); resolveAll(data as PartDoc); }
    set({ docs: [...get().docs, { id: nid, kind, fileName, data, past: [], future: [], dirty: false, hidden: !activate && kind !== 'drawing' ? true : undefined }] });
    if (activate) get().activate(nid);
    return nid;
  },
  newDocument: (k, sheet) => {
    const s0 = get(); const docs = s0.docs.filter((d) => !(d.blank && d.id === s0.active && !s0.dirty && !s0.past.length)); // la pieza vacía de arranque no cuenta para el nombre
    if (k === 'part' || k === 'sheet') {
      const d = k === 'sheet' ? newSheetDoc() : newDoc();
      const fn = uniqueName(docs, k === 'sheet' ? 'Chapa' : 'Pieza', '.i3p');
      d.iProperties.partNumber = baseName(fn);
      const st = get().settings;
      if (st.defaultMaterial && k === 'part') d.iProperties.material = st.defaultMaterial;
      if (st.userName) d.iProperties.designer = st.userName;
      if (st.company) d.iProperties.company = st.company;
      return get().addDocument('part', d, fn);
    }
    if (k === 'assembly' || k === 'weldment' || k === 'asmHvac' || k === 'asmMech') {
      const a = newAsm(k === 'weldment' ? 'weldment' : 'assembly');
      if (k === 'asmHvac') a.env = { type: 'hvac', hvac: true, mech: false };
      if (k === 'asmMech') a.env = { type: 'mech', hvac: false, mech: true };
      const fn = uniqueName(docs, k === 'weldment' ? 'Soldadura' : k === 'asmHvac' ? 'HVAC' : k === 'asmMech' ? 'Mecanica' : 'Ensamblaje', '.i3a');
      a.iProperties.partNumber = baseName(fn);
      return get().addDocument('assembly', a, fn);
    }
    const fn = uniqueName(docs, 'Dibujo', '.i3d');
    const st = get().settings, dw = newDrawing();
    dw.sheet = sheet ?? st.sheetDefault; dw.title.designer = st.userName; dw.title.company = st.company; dw.std = st.drawingStd;
    return get().addDocument('drawing', dw, fn);
  },
  activate: (id) => {
    const s = get();
    if (id === s.active) return;
    if (s.ctxEdit && id !== s.ctxEdit.part) set({ ctxEdit: null });
    // Colocación pendiente: se descarta el componente que seguía al cursor
    if (s.placing && s.kind === 'assembly') { const pend = s.placing.occ; set({ asm: { ...s.asm, occurrences: s.asm.occurrences.filter((o) => o.id !== pend) }, placing: null }); return get().activate(id); }
    // Guardar el documento activo en el registro
    const docs = s.docs.map((d) => (d.id === s.active ? { ...d, data: s.docData(s.active)!, past: s.past, future: s.future, dirty: s.dirty, fileName: s.fileName } : d.id === id && d.hidden ? { ...d, hidden: undefined } : d));
    const t = docs.find((d) => d.id === id);
    if (!t) return;
    const common = {
      docs, active: id, kind: t.kind, past: t.past, future: t.future, dirty: t.dirty, fileName: t.fileName,
      mode: 'model' as Mode, sketchId: null, tool: null, selFeature: null, selEntity: null, selItem: null, dialog: null,
      preview: null, pickBase: null, menuOpen: false, view: { name: 'home', n: s.view.n + 1 },
    };
    // la pieza vacía de arranque, sin tocar, se descarta al pasar a otro documento
    const prev = docs.find((d) => d.id === s.active);
    if (prev?.blank && !s.dirty && !s.past.length) common.docs = docs.filter((d) => d !== prev);
    if (t.kind === 'part') set({ ...common, doc: t.data as PartDoc, result: null });
    else if (t.kind === 'assembly') set({ ...common, asm: t.data as AsmDoc, asmResult: null, explodeT: 0 });
    else set({ ...common, drw: t.data as DrawingDoc });
  },
  hideDocument: (id) => {
    const s = get();
    if (id === s.active) {
      const asmId = s.docs.find((o) => o.kind === 'assembly' && !o.hidden && ((o.data as any)?.occurrences ?? []).some((x: any) => x.part === id))?.id
        ?? s.docs.find((o) => o.id !== id && !o.hidden)?.id;
      if (!asmId) return;
      get().activate(asmId);
    }
    set({ docs: get().docs.map((d) => (d.id === id ? { ...d, hidden: true } : d)) });
  },
  closeDocument: (id) => {
    const s = get();
    let rest = s.docs.filter((d) => d.id !== id);
    // Piezas en memoria que ya no usa ningún documento abierto: se descargan
    const used = new Set<string>();
    for (const d of rest) {
      const data = (d.id === s.active ? s.docData(d.id) : d.data) as any;
      if (d.kind === 'assembly') for (const o of data?.occurrences ?? []) used.add(o.part);
      if (d.kind === 'drawing') for (const v of data?.views ?? []) used.add(v.source);
    }
    rest = rest.filter((d) => !d.hidden || used.has(d.id));
    if (!rest.some((d) => !d.hidden)) rest = rest.map((d) => ({ ...d, hidden: undefined }));
    if (!rest.length) {
      const d = newDoc();
      set({ docs: [{ id: 'd' + Date.now(), kind: 'part', fileName: 'Pieza1.i3p', data: d, past: [], future: [], dirty: false, blank: true }] });
      get().activate(get().docs[0].id);
      // sin documentos abiertos: se pregunta qué crear o abrir
      set({ dialog: { kind: 'newdoc', start: true } });
      return;
    }
    if (id === s.active || !rest.some((d) => d.id === s.active)) {
      set({ docs: rest, active: '__none' });
      const vis = rest.filter((d) => !d.hidden);
      get().activate((vis[vis.length - 1] ?? rest[rest.length - 1]).id);
    } else set({ docs: rest });
  },

  commit: (fn) => {
    const { doc, past } = get();
    const next = clone(doc);
    fn(next);
    eopNormalize(doc, next);
    resolveAll(next);
    set({ doc: next, past: [...past.slice(-99), doc], future: [], dirty: true });
  },
  sketchCommit: (fn, msgOnFail) => {
    const s = get(), sid = s.sketchId;
    if (!sid) return false;
    const next = clone(s.doc);
    const i = next.features.findIndex((f) => f.id === sid);
    if (i < 0) return false;
    let sk = next.features[i] as SketchF;
    try { const r = fn(sk); if (r) { sk = r; next.features[i] = r; } }
    catch (e) { s.notify((e as Error).message, 'error'); return false; }
    if (sk.constraints?.length) {
      const res = solve(sk, makeSafeEval(next), { analyse: false });
      if (!res.ok) { s.notify(msgOnFail ?? 'El boceto no se puede resolver con esta modificación', 'error'); return false; }
      applySolution(sk, res);
    }
    resolveAll(next, sid);
    set({ doc: next, past: [...s.past.slice(-99), s.doc], future: [], dirty: true });
    return true;
  },
  addConstraint: (c, opts = {}) => {
    const s = get(); const sk = activeSketch(s); if (!sk) return false;
    if (!opts.force) {
      const chk = checkNew(sk, makeSafeEval(s.doc), c);
      if (!chk.ok) {
        if (c.type === 'dim') { c.driven = true; s.notify('Cota de referencia (la geometría ya está restringida)'); }
        else { s.notify(chk.reason!, 'error'); return false; }
      }
    }
    const ok = get().sketchCommit((k) => { (k.constraints ??= []).push(c); });
    if (ok) set({ selCon: c.id });
    return ok;
  },
  deleteConstraint: (id) => { get().sketchCommit((k) => { k.constraints = (k.constraints ?? []).filter((c) => c.id !== id); }); set({ selCon: null }); },
  commitAsm: (fn) => {
    const { asm, past } = get();
    const next = clone(asm);
    fn(next);
    // Restricciones: se resuelven aquí y se guardan las posiciones resultantes
    if (next.joints.some((j) => !j.suppressed)) {
      const r = solveAssembly(normalizeAsm(next, docGetter(get()), (x) => { try { return makeEval([])(x); } catch { return NaN; } }), (x) => { try { return makeEval([])(x); } catch { return NaN; } });
      for (const o of next.occurrences) if (r.xf[o.id] && !o.grounded) o.xf = { pos: r.xf[o.id].pos.map((v) => Number(v.toFixed(6))) as V3, quat: r.xf[o.id].quat.map((v) => Number(v.toFixed(9))) as [number, number, number, number] };
    }
    if (next.patterns?.length || next.occurrences.some((o) => o.mirrorOf)) applyAssociative(next, (x) => { try { return makeEval([])(x); } catch { return NaN; } }, uid);
    for (const h of asmPostHooks) { try { h(next); } catch (e) { console.warn('asm hook', e); } }
    set({ asm: next, past: [...past.slice(-99), asm], future: [], dirty: true });
  },
  editPartDoc: (id, next) => {
    const s = get();
    set({ docs: s.docs.map((d) => (d.id === id ? { ...d, data: next, past: [...d.past.slice(-99), d.data], future: [], dirty: true } : d)) });
    if (s.kind === 'assembly') set({ asm: { ...get().asm } });
  },
  previewPartDoc: (id, data, dirty) => {
    const s = get();
    set({ docs: s.docs.map((d) => (d.id === id ? { ...d, data, ...(dirty != null ? { dirty } : {}) } : d)) });
    if (s.kind === 'assembly') set({ asm: { ...get().asm } });
  },
  commitPartDoc: (id, orig) => {
    set({ docs: get().docs.map((d) => (d.id === id && d.data !== orig ? { ...d, past: [...d.past.slice(-99), orig], future: [], dirty: true } : d)) });
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
    doc = clone(doc); resolveAll(doc);
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
  editSketch: (id) => set({ mode: 'sketch', sketchId: id, tool: null, selFeature: id, selEntity: null, selEntities: [], selCon: null, dialog: null, view: { name: 'sketch', n: get().view.n + 1 } }),
  finishSketch: () => {
    const s0 = get();
    if (s0.sketchId) {
      const id = s0.sketchId, ev = makeSafeEval(s0.doc);
      const probe = structuredClone(s0.doc);
      if (syncCenterAxes(probe, id, ev)) s0.commit((d) => { syncCenterAxes(d, id, ev); });
    }
    const skId = s0.sketchId, pf = s0.pendingFeature;
    set({ mode: 'model', sketchId: null, tool: null, selEntity: null, selEntities: [], selCon: null, skInfo: null, view: { name: 'restore', n: get().view.n + 1 }, skStyle: 'normal', pendingFeature: null });
    // se vuelve a la operación que pidió el boceto, ya con él seleccionado
    if (pf && skId) setTimeout(() => {
      const st = get(); st.openFeatureDialog(pf.type as FeatDialogKind);
      const usesSketch = ['sm_punch', 'hole', 'sm_fold', 'sm_rip', 'sm_mark', 'skpattern'].includes(pf.type);
      const extra: Record<string, unknown> = {};
      if (pf.type === 'sm_fold') { const sk = st.doc.features.find((f) => f.id === skId) as SketchF | undefined; extra.line = sk?.entities.find((e) => e.type === 'line' && !e.construction)?.id ?? ''; }
      st.updateDraft({ ...pf.draft, ...(usesSketch ? { sketch: skId } : { profile: skId }), ...extra });
    }, 0);
  },
  setTool: (tool) => {
    const s = get();
    if (s.placing && tool !== 'place') { const pend = s.placing.occ; set({ asm: { ...s.asm, occurrences: s.asm.occurrences.filter((o) => o.id !== pend) }, placing: null }); }
    set({ tool });
  },

  addEntity: (e) => {
    const sid = get().sketchId;
    if (!sid) return;
    e = styled(e, get().skStyle);
    get().commit((d) => { const s = d.features.find((f) => f.id === sid) as SketchF; s.entities.push(e); });
    set({ selEntity: e.id });
  },
  updateEntity: (id, patch) => {
    get().sketchCommit((s) => {
      const e = s?.entities.find((x) => x.id === id);
      if (e) Object.assign(e, patch);
    });
  },
  deleteEntity: (id) => {
    const ids = new Set([id, ...get().selEntities]);
    get().sketchCommit((s) => {
      s.entities = s.entities.filter((x) => !ids.has(x.id));
      s.constraints = (s.constraints ?? []).filter((c) => ![c.a, c.b, c.c].some((r) => r && ids.has(r.e)));
    });
    set({ selEntity: null, selEntities: [] });
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
          const line = sk?.entities.find((e) => e.type === 'line' && e.center) ?? sk?.entities.find((e) => e.type === 'line' && e.construction) ?? sk?.entities.find((e) => e.type === 'line');
          draft = { id, name, type: 'revolve', profile, axis: line?.id ?? 'sy', angle: '360 deg', op: 'join' }; break;
        }
        case 'fillet': draft = { id, name, type: 'fillet', radius: '2 mm', edges: { mode: 'picked', points: [] } }; break;
        case 'chamfer': draft = { id, name, type: 'chamfer', distance: '1 mm', edges: { mode: 'picked', points: [] } }; break;
        case 'hole': draft = { id, name, type: 'hole', sketch: lastSketch(doc, (s) => s.entities.some((e) => e.type === 'point' || e.type === 'circle')),
          dia: '11 mm', depth: '20 mm', through: true, kind: 'simple', cbDia: '18 mm', cbDepth: '10.6 mm', csDia: '22.8 mm', csAngle: '90 deg', thread: '',
          std: 'M', fastener: 'iso4762', size: '10', fit: 'normal', tipAngle: '118 deg', tapDepth: '15 mm', cosmetic: true, slotLen: '20 mm', slotAng: '0 deg' }; break;
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
        case 'surf_extrude': draft = { id, name, type: 'surf_extrude', profile: lastSketch(doc, () => true), distance: '20 mm', dir: 'normal' }; break;
        case 'surf_revolve': draft = { id, name, type: 'surf_revolve', profile: lastSketch(doc, () => true), axis: 'sy', angle: '360 deg' }; break;
        case 'surf_loft': draft = { id, name, type: 'surf_loft', sections: doc.features.filter((f) => (f.type === 'sketch' || f.type === 'sketch3d') && !consumedSketches(doc).has(f.id)).map((f) => f.id).slice(-2), ruled: true }; break;
        case 'surf_patch': draft = { id, name, type: 'surf_patch', sketch: [...doc.features].reverse().find((f) => (f.type === 'sketch' || f.type === 'sketch3d') && !consumedSketches(doc).has(f.id))?.id ?? '' }; break;
        case 'stitch': draft = { id, name, type: 'stitch', surfaces: doc.features.filter((f) => ['surf_extrude', 'surf_revolve', 'surf_loft', 'surf_patch'].includes(f.type) && !consumedSketches(doc).has(f.id)).map((f) => f.id), op: 'join' }; break;
        case 'sm_loft': {
          const free = doc.features.filter((f) => (f.type === 'sketch' || f.type === 'sketch3d') && !consumedSketches(doc).has(f.id)).map((f) => f.id);
          draft = { id, name, type: 'sm_loft', a: free[free.length - 2] ?? '', b: free[free.length - 1] ?? '', side: 'in', segments: '24' }; break;
        }
        case 'sm_flange': draft = { id, name, type: 'sm_flange', edge: null, length: '20 mm', angle: '90 deg', dir: 'up' }; break;
        case 'rib': draft = { id, name, type: 'rib', profile: lastSketch(doc, (s) => s.entities.some((e) => e.type === 'line' && !e.construction)), thickness: '5 mm', depth: '30 mm', flip: false, op: 'join' }; break;
        case 'coil': {
          const sk = doc.features.find((f) => f.id === profile) as SketchF | undefined;
          const line = sk?.entities.find((e) => e.type === 'line' && e.construction) ?? sk?.entities.find((e) => e.type === 'line');
          draft = { id, name, type: 'coil', profile, axis: line?.id ?? 'sy', pitch: '10 mm', turns: '5', left: false, op: 'join' }; break;
        }
        case 'split': draft = { id, name, type: 'split', plane: { kind: 'std', name: 'XY', offset: '0' }, keep: 'pos' }; break;
        case 'draft': draft = { id, name, type: 'draft', faces: [], angle: '3 deg', plane: { kind: 'std', name: 'XY', offset: '0' } }; break;
        case 'thicken': draft = { id, name, type: 'thicken', faces: [], distance: '2 mm', op: 'join' }; break;
        case 'thread': draft = { id, name, type: 'thread', faces: [], designation: 'M10x1.5', length: '20 mm', full: true, std: 'M', offset: '0 mm' }; break;
        case 'workaxis': draft = { id, name, type: 'workaxis', origin: ['0', '0', '0'], dir: ['0', '0', '1'] }; break;
        case 'workpoint': draft = { id, name, type: 'workpoint', origin: ['0', '0', '0'] }; break;
        case 'combine': draft = { id, name, type: 'combine', faces: [], op: 'join', keep: false }; break;
        case 'movebody': draft = { id, name, type: 'movebody', faces: [], dx: '0 mm', dy: '0 mm', dz: '0 mm', axis: 'Z', angle: '0 deg', copy: false }; break;
        case 'derive': {
          const src = get().docs.find((x) => x.kind === 'part' && x.id !== get().active);
          const sd = src ? (get().docData(src.id) as PartDoc) : null;
          draft = { id, name, type: 'derive', source: src?.id ?? '', sourceName: src?.fileName ?? '', doc: sd ? clone(sd) : null, scale: '1', mirror: '', op: 'join' }; break;
        }
        case 'pathpattern': draft = { id, name, type: 'pathpattern', features: body ? [body] : [], path: lastSketch(doc, (k) => k.entities.some((e) => e.type === 'line' || e.type === 'arc' || e.type === 'spline')), count: '5', align: false }; break;
        case 'sm_contour': draft = { id, name, type: 'sm_contour', profile: lastSketch(doc, (k) => k.entities.some((e) => e.type === 'line' && !e.construction)), width: '100 mm', dir: 'normal', side: 'in' }; break;
        case 'slot': draft = { id, name, type: 'slot', sketch: lastSketch(doc, (k) => k.entities.some((e) => (e.type === 'line' || e.type === 'point') && !e.construction)), width: '10 mm', length: '20 mm', depth: '5 mm', extent: 'through', flip: false }; break;
        case 'direct': draft = { id, name, type: 'direct', faces: [], distance: '5 mm' }; break;
        case 'delface': draft = { id, name, type: 'delface', faces: [], heal: true }; break;
        case 'finish': draft = { id, name, type: 'finish', faces: [], kind: 'Pintura', color: '#c0392b' }; break;
        case 'decal': draft = { id, name, type: 'decal', plane: null, center: null, image: '', width: '50 mm', rot: '0 deg' }; break;
        case 'unwrap': draft = { id, name, type: 'unwrap', faces: [] }; break;
        case 'ruled': draft = { id, name, type: 'ruled', edges: { mode: 'picked', points: [] }, mode: 'normal', distance: '10 mm', dir: ['0', '0', '1'], flip: false }; break;
        case 'surftrim': { const sf = surfaceIds(doc); draft = { id, name, type: 'surftrim', surface: sf[sf.length - 1] ?? '', sketch: lastSketch(doc, (k) => k.entities.length > 0), keep: 'outside' }; break; }
        case 'surfextend': { const sf = surfaceIds(doc); draft = { id, name, type: 'surfextend', surface: sf[sf.length - 1] ?? '', distance: '10 mm' }; break; }
        case 'sculpt': draft = { id, name, type: 'sculpt', surfaces: surfaceIds(doc), mode: 'add', flip: false }; break;
        case 'replaceface': { const sf = surfaceIds(doc); draft = { id, name, type: 'replaceface', faces: [], surface: sf[sf.length - 1] ?? '' }; break; }
        case 'repair': draft = { id, name, type: 'repair', tol: '0.01 mm' }; break;
        case 'ffbox': {
          const b = get().result?.props?.bbox;
          const o = b ? b[0] : [0, 0, 0], sz = b ? [b[1][0] - b[0][0], b[1][1] - b[0][1], b[1][2] - b[0][2]] : [50, 50, 50];
          const r = (x: number) => String(Math.round(x * 1000) / 1000);
          draft = { id, name, type: 'ffbox', origin: [r(o[0]), r(o[1]), r(o[2])], size: [r(sz[0] || 50) + ' mm', r(sz[1] || 50) + ' mm', r(sz[2] || 50) + ' mm'], n: [3, 3, 3], pts: {}, sel: '1,1,2', op: body ? 'join' : 'new' }; break;
        }
        case 'ffface': draft = { id, name, type: 'ffface', plane: { kind: 'std', name: 'XY', offset: '0' }, size: ['100 mm', '100 mm'], n: [4, 4], pts: {}, sel: '1,1' }; break;
        case 'sm_roll': {
          const pid = lastSketch(doc, (k) => k.entities.some((e) => e.type === 'line' && !e.construction && !e.center));
          const sk = doc.features.find((f) => f.id === pid) as SketchF | undefined;
          const ax = sk?.entities.find((e) => e.type === 'line' && e.center) ?? sk?.entities.find((e) => e.type === 'line' && e.construction);
          draft = { id, name, type: 'sm_roll', profile: pid, axis: ax?.id ?? 'sy', angle: '360 deg', side: 'in' }; break;
        }
        case 'sm_bend': draft = { id, name, type: 'sm_bend', edgeA: null, edgeB: null, pick: 'a' }; break;
        case 'sm_fold': {
          const sid = lastSketch(doc, (k) => k.entities.some((e) => e.type === 'line'));
          const sk = doc.features.find((f) => f.id === sid) as SketchF | undefined;
          draft = { id, name, type: 'sm_fold', sketch: sid, line: sk?.entities.find((e) => e.type === 'line')?.id ?? '', angle: '90 deg', dir: 'up', flip: false }; break;
        }
        case 'sm_seam': {
          const fl = doc.features.filter((f) => f.type === 'sm_flange' && !f.suppressed);
          draft = { id, name, type: 'sm_seam', a: fl[fl.length - 2]?.id ?? '', b: fl[fl.length - 1]?.id ?? '', gap: '0.5 mm', kind: 'overlap' }; break;
        }
        case 'sm_rip': draft = { id, name, type: 'sm_rip', sketch: lastSketch(doc, (k) => k.entities.some((e) => e.type === 'line')), gap: '0.5 mm' }; break;
        case 'sm_unfold': draft = { id, name, type: 'sm_unfold' }; break;
        case 'sm_refold': draft = { id, name, type: 'sm_refold' }; break;
        case 'sm_mark': draft = { id, name, type: 'sm_mark', sketch: lastSketch(doc, (k) => k.entities.length > 0) }; break;
        case 'skpattern': draft = { id, name, type: 'skpattern', features: body ? [body] : [], sketch: lastSketch(doc, (k) => k.entities.filter((e) => e.type === 'point').length > 1) }; break;
        case 'sm_punch': draft = { id, name, type: 'sm_punch', sketch: lastSketch(doc, (k) => k.entities.some((e) => e.type === 'point')), shape: 'round', d: '10 mm', w: '20 mm', h: '10 mm', rot: '0 deg' }; break;
      }
    }
    const tool = toolFor(draft);
    set({ dialog: { kind, editId, draft }, tool, preview: null, pickBase: null });
    if (tool === 'pickEdges' || tool === 'pickFaces' || tool === 'pickFlangeEdge') runPickBase(draft.id);
  },
  openAsmDialog: (kind, draft, editId, tool = null) => { get().setTool(tool); set({ dialog: { kind, editId, draft, step: 0 }, tool, menuOpen: false }); },
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
      const coll = ({ joint: 'joints', frame: 'frames', weld: 'welds', bolt: 'bolts', skel: 'skeleton', endtreat: 'frames', asmwp: 'workPlanes' } as const)[d.kind as AsmDialogKind];
      const items: any[] = Array.isArray(draft) ? draft : [draft];
      s.commitAsm((a) => {
        const arr = ((a as any)[coll] ??= []) as any[];
        for (const it of items) {
          const i = arr.findIndex((x) => x.id === it.id);
          if (i >= 0) arr[i] = it; else arr.push(it);
        }
      });
      set({ selItem: items[0]?.id ?? null });
      if (close) set({ dialog: null, tool: null });
    }
  },
  closeDialog: () => { const s = get(); const keep = s.mode === 'sketch' || s.tool === 'place'; set({ dialog: null, tool: keep ? s.tool : null, preview: null, pickBase: null }); },
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

/** Operaciones que dejan una superficie (para elegirlas en recortar, alargar, esculpir…) */
export function surfaceIds(doc: PartDoc): string[] {
  return doc.features.filter((f) => !f.suppressed && (['surf_extrude', 'surf_revolve', 'surf_loft', 'surf_patch', 'stitch', 'unwrap', 'ruled', 'ffface', 'meshface'].includes(f.type) || (f.type === 'delface' && !f.heal))).map((f) => f.id);
}
function toolFor(f: Feature): Tool {
  if ((f.type === 'fillet' || f.type === 'chamfer') && f.edges.mode === 'picked') return 'pickEdges';
  if (f.type === 'shell' || f.type === 'draft' || f.type === 'thicken' || f.type === 'thread' || f.type === 'combine' || f.type === 'movebody' || f.type === 'direct' || f.type === 'delface' || f.type === 'finish' || f.type === 'unwrap' || f.type === 'replaceface' || f.type === 'decal') return 'pickFaces';
  if (f.type === 'ruled') return 'pickEdges';
  if (f.type === 'sm_flange' || f.type === 'sm_bend') return 'pickFlangeEdge';
  // taladro sin boceto con puntos: se coloca en una cara
  if (f.type === 'hole' && !f.sketch && !f.face) return 'holeFace';
  return null;
}

/** Documento con el borrador del diálogo aplicado (para la vista previa). */
export function previewDoc(s: State): PartDoc | null {
  const d = s.dialog;
  if (s.kind !== 'part' || !d || !('draft' in d)) return null;
  const doc = clone(s.doc);
  const i = doc.features.findIndex((f) => f.id === d.draft.id);
  if (i >= 0) doc.features[i] = d.draft; else { const k = eopIndex(doc); doc.features.splice(k, 0, d.draft); if (doc.eop !== undefined) doc.eop = d.draft.id; }
  return doc;
}

// ---- Reconstrucción automática ----
let regenSeq = 0, previewSeq = 0, asmSeq = 0;
let regenTimer: ReturnType<typeof setTimeout> | undefined;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let asmTimer: ReturnType<typeof setTimeout> | undefined;
/** Mallas de piezas ya recibidas, por clave de contenido (se reutilizan entre ensamblajes). */
export const meshCache = new Map<string, MeshData>();

/** Piezas derivadas asociativas: si la pieza de origen está abierta se usa su versión actual. */
export function liveDerive(doc: PartDoc, depth = 0): PartDoc {
  if (depth > 4 || !doc.features.some((f) => f.type === 'derive')) return doc;
  const s = useStore.getState();
  let changed = false;
  const features = doc.features.map((f) => {
    if (f.type !== 'derive') return f;
    const src = s.docData(f.source) as PartDoc | null;
    if (!src || src.format !== 'inv3d.part' || src === f.doc) return f;
    changed = true;
    return { ...f, doc: liveDerive(src, depth + 1) };
  });
  return changed ? { ...doc, features } : doc;
}
async function runRegen() {
  const s = useStore.getState();
  if (s.oc !== 'ready' || s.kind !== 'part') return;
  const my = ++regenSeq;
  useStore.setState({ busy: true });
  try {
    const r = await cad.regen(liveDerive(s.doc));
    if (my === regenSeq && useStore.getState().kind === 'part') {
      useStore.setState({ result: r, busy: false });
      // ePoints anclados a caras: se recolocan con la geometría nueva (sin historial)
      const t = useStore.getState(); const eps = t.doc === s.doc ? updateAnchors(t.doc, r.mesh) : null;
      if (eps) useStore.setState({ doc: { ...t.doc, epoints: eps }, dirty: true });
    }
    else useStore.setState({ busy: false });
  } catch (e) {
    if (my === regenSeq) { useStore.setState({ busy: false }); useStore.getState().notify((e as Error).message, 'error'); }
  }
}
/** Acceso a los datos de cualquier documento abierto (para subensamblajes) */
export const docGetter = (s: State) => (id: string) => { const e = s.docs.find((d) => d.id === id); return e ? { kind: e.kind, data: s.docData(id) } : null; };
async function runAsm() {
  const s = useStore.getState();
  if (s.oc !== 'ready' || s.kind !== 'assembly') return;
  const my = ++asmSeq;
  useStore.setState({ busy: true });
  try {
    const get = docGetter(s), ev = (x: string) => { try { return makeEval([])(x); } catch { return NaN; } };
    // Con subensamblajes se resuelve aquí y se envía al núcleo el ensamblaje aplanado
    let send = s.asm, view: AsmDoc | undefined, errs: Record<string, string> = {}, solXf: Record<string, Xform> = {};
    if (hasSubs(s.asm, get)) {
      const sol = solveAssembly(normalizeAsm(s.asm, get, ev), ev);
      view = expandAsm(s.asm, sol.xf, get, ev); send = view; errs = sol.errors; solXf = sol.xf;
    }
    send = refreshEpRefs(send, (id) => { const g = get(id); return g?.kind === 'part' ? (g.data as PartDoc) : null; });
    const ids = [...new Set(send.occurrences.map((o) => o.part))];
    const r = await cad.asm(send, s.partsMap(ids), [...meshCache.keys()]);
    if (view) { r.view = view; r.errors = { ...r.errors, ...errs }; for (const [k, v] of Object.entries(solXf)) r.xf[k] ??= v; }
    for (const p of Object.values(r.parts)) {
      if (p.mesh) meshCache.set(p.key, p.mesh); else p.mesh = meshCache.get(p.key);
    }
    if (my === asmSeq && useStore.getState().kind === 'assembly') {
      useStore.setState({ asmResult: r, busy: false });
      // ePoints anclados de las piezas: si la pieza cambió, se recolocan y el ensamblaje se vuelve a resolver
      const t = useStore.getState(); let n = 0;
      for (const [pid, pr] of Object.entries(r.parts)) {
        const pd = t.docData(pid) as PartDoc | null; if (!pd || pd.format !== 'inv3d.part') continue;
        const eps = updateAnchors(pd, pr.mesh); if (eps) { useStore.getState().previewPartDoc(pid, { ...pd, epoints: eps }, true); n++; }
      }
      void n;
    }
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

useStore.subscribe((s, p) => { if (s.hud !== p.hud) { try { localStorage.setItem('inv3d.hud', JSON.stringify(s.hud)); } catch { /* sin almacenamiento */ } } });
let infoTimer: ReturnType<typeof setTimeout> | undefined;
let dofTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (s.kind === 'part' && s.mode === 'sketch' && (s.doc !== prev.doc || s.sketchId !== prev.sketchId || s.mode !== prev.mode)) {
    clearTimeout(infoTimer);
    infoTimer = setTimeout(() => { const st = useStore.getState(); if (st.mode === 'sketch') useStore.setState({ skInfo: sketchInfo(st) }); }, 20);
  }
  if (s.kind === 'assembly' && (s.asm !== prev.asm || s.active !== prev.active)) {
    clearTimeout(dofTimer);
    dofTimer = setTimeout(() => { const st = useStore.getState(); if (st.kind === 'assembly') useStore.setState({ asmDof: solveAssembly(normalizeAsm(st.asm, docGetter(st), (x) => { try { return makeEval([])(x); } catch { return NaN; } }), (x) => { try { return makeEval([])(x); } catch { return NaN; } }, { dof: true }).dof }); }, 200);
  }
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

/** Actualizar todo (Mayús+F2): vuelve a calcular la pieza o el ensamblaje con todas sus piezas, ePoints y uniones */
export function rebuildAll() {
  const s = useStore.getState();
  meshCache.clear();
  if (s.kind === 'part') { void runRegen(); s.notify('Pieza actualizada'); return; }
  if (s.kind === 'assembly') {
    // las piezas en memoria recolocan sus ePoints anclados y el ensamblaje se resuelve de nuevo
    void runAsm().then(() => { setTimeout(() => { void runAsm(); }, 50); useStore.getState().notify('Ensamblaje actualizado (piezas, ePoints y restricciones)'); });
    return;
  }
  useStore.setState({ drw: structuredClone(s.drw) }); s.notify('Plano actualizado');
}

export function startCad() {
  cad.onProgress = (v) => useStore.setState({ ocProgress: v });
  cad.init()
    .then(() => useStore.setState({ oc: 'ready', ocProgress: 1 }))
    .catch((e) => useStore.setState({ oc: 'error', ocError: (e as Error).message }));
}

export type { V3 };
