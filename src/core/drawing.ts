// Modelo de datos del plano INV3D (.i3d): hojas, vistas proyectadas, cotas, notas y cajetín.
import type { V3 } from './doc';

export type SheetSize = 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
export const SHEETS: Record<SheetSize, [number, number]> = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };

export type ViewDir = 'front' | 'top' | 'right' | 'left' | 'back' | 'bottom' | 'iso';
export const VIEW_NAMES: Record<ViewDir, string> = {
  front: 'Alzado', top: 'Planta', right: 'Perfil derecho', left: 'Perfil izquierdo', back: 'Posterior', bottom: 'Inferior', iso: 'Isométrica',
};

/** Dirección de la mirada (desde la cámara hacia la pieza) y eje X de la vista, con Z arriba (proyección europea). */
export const VIEW_CAMERAS: Record<ViewDir, { dir: V3; x: V3 }> = {
  front: { dir: [0, 1, 0], x: [1, 0, 0] },
  back: { dir: [0, -1, 0], x: [-1, 0, 0] },
  right: { dir: [-1, 0, 0], x: [0, 1, 0] },
  left: { dir: [1, 0, 0], x: [0, -1, 0] },
  top: { dir: [0, 0, -1], x: [1, 0, 0] },
  bottom: { dir: [0, 0, 1], x: [1, 0, 0] },
  iso: { dir: [-0.5774, 0.5774, -0.5774], x: [0.7071, 0.7071, 0] },
};

export type P2d = [number, number];
export interface DView {
  id: string; name: string;
  source: string;           // id del documento (pieza o ensamblaje)
  dir: ViewDir;
  scale: number;            // 1:n → 1/n
  x: number; y: number;     // centro en la hoja (mm)
  hidden: boolean;          // mostrar aristas ocultas
  parent?: string;          // vista base de la que se proyecta
  kind?: 'base' | 'proj' | 'iso' | 'section' | 'detail' | 'aux' | 'flat';
  /** Vista auxiliar: dirección hacia el observador y eje X de la vista */
  aux?: { toward: V3; x: V3; a: P2d; n2: P2d };
  /** Vista partida: tramos suprimidos en coordenadas del modelo relativas al centro (mm reales) */
  breaks?: DBreak[];
  /** Vista recortada: rectángulo relativo al centro de la vista (mm de hoja) */
  crop?: [number, number, number, number];
  label?: string;           // A, B… (secciones y detalles)
  /** Sección: plano de corte (punto y normal = dirección de la mirada) y ejes de la vista */
  section?: { origin: V3; normal: V3; x: V3; a: P2d; b: P2d; n2: P2d;
    /** Sección escalonada/alineada: puntos de la línea de corte (hoja, relativos a la padre) y en 3D, y eje de la vista padre */
    pts?: P2d[]; path?: V3[]; toward?: V3; aligned?: boolean };
  /** Corte parcial (Break Out): contorno en 3D y profundidad desde la cara más cercana (mm) */
  breakout?: { loop: V3[]; depth: number };
  /** Detalle: centro y radio en coordenadas de la vista padre (relativas a su centro, mm de hoja) */
  detail?: { c: P2d; r: number };
  /** Marcas de centro automáticas en círculos */
  centers?: boolean;
}
export interface DBreak { axis: 'x' | 'y'; a: number; b: number }
export type DimKind2 = 'h' | 'v' | 'a' | 'r' | 'd' | 'ang' | 'ord';
export interface DDim {
  id: string; view: string; a: P2d; b: P2d; offset: number; kind: DimKind2; text?: string;
  /** Radio/diámetro: radio en la hoja; ángulo: tercer punto */
  r?: number; c?: P2d;
  /** Tolerancia: «±0.1», «+0.2/-0», «H7»… */
  tol?: string;
  /** Cota por coordenadas: eje medido (a = origen, b = punto, c = posición del texto) */
  axis?: 'x' | 'y';
  /** Cota recuperada del modelo (asociativa): boceto + restricción, u operación */
  ref?: { sk?: string; con?: string; feat?: string; ent?: string };
  /** La referencia del modelo ya no existe */
  orphan?: boolean;
}
export interface DNote { id: string; x: number; y: number; text: string; size: number }
export type AnnKind = 'balloon' | 'leader' | 'surface' | 'weld' | 'centerline' | 'centermark' | 'hole' | 'fcf' | 'datum';
export type GdtSym = 'straight' | 'flat' | 'circ' | 'cyl' | 'profl' | 'profs' | 'perp' | 'angle' | 'par' | 'pos' | 'conc' | 'sym' | 'runout' | 'truns';
export const GDT_NAMES: Record<GdtSym, string> = {
  straight: 'Rectitud', flat: 'Planitud', circ: 'Redondez', cyl: 'Cilindricidad', profl: 'Forma de una línea', profs: 'Forma de una superficie',
  perp: 'Perpendicularidad', angle: 'Inclinación', par: 'Paralelismo', pos: 'Posición', conc: 'Concentricidad', sym: 'Simetría', runout: 'Oscilación circular', truns: 'Oscilación total',
};
export const GDT_DATUM: Record<GdtSym, boolean> = { straight: false, flat: false, circ: false, cyl: false, profl: false, profs: false, perp: true, angle: true, par: true, pos: true, conc: true, sym: true, runout: true, truns: true };
/** Anotaciones con posición absoluta en la hoja (mm). */
export interface DAnn {
  id: string; kind: AnnKind; pts: P2d[]; text?: string; r?: number; side?: 'arrow' | 'other' | 'both'; allAround?: boolean;
  /** Tolerancia geométrica: símbolo, Ø delante del valor y referencias («A», «A|B»…) */
  sym?: GdtSym; dia?: boolean; datums?: string;
  /** Globo automático de esta vista (se sustituye al regenerar) */
  view?: string;
}
export type TableKind = 'hole' | 'rev' | 'bend';
/** Tablas colocadas en la hoja (x, y = esquina superior izquierda). */
export interface DTable { id: string; kind: TableKind; view?: string; x: number; y: number }
export interface DRev { rev: string; desc: string; date: string; by: string }
/** Contenido propio de cada hoja. */
export interface SheetPage { name: string; sheet: SheetSize; views: DView[]; dims: DDim[]; notes: DNote[]; anns: DAnn[]; tables: DTable[]; bom: DrawingDoc['bom'] }
export interface TitleBlock {
  title: string; partNumber: string; material: string; designer: string; checker: string; date: string; company: string; revision: string; scale: string;
  project?: string; description?: string; approved?: string; approvedDate?: string; generalTol?: string; finish?: string; mass?: string; stock?: string;
  /** Campos propios de la plantilla de cajetín */
  custom?: Record<string, string>;
}

/** Celda de cajetín: posición en mm desde la esquina inferior izquierda del cajetín.
 *  field: clave del cajetín (title, partNumber…), «#sheet» (hoja n/N), «#format», «#proj» (método de proyección),
 *  «custom:Nombre» (campo propio) o «=texto» (texto fijo). */
export interface TbCell { x: number; y: number; w: number; h: number; label: string; field: string; big?: boolean }
export interface TbTemplate { name: string; w: number; h: number; cells: TbCell[]; /** símbolo de proyección (centro, relativo al cajetín) */ proj?: { x: number; y: number } | null }
export const TB_FIELDS: [string, string][] = [
  ['title', 'Título'], ['partNumber', 'Nº de plano'], ['description', 'Descripción'], ['company', 'Empresa'], ['project', 'Proyecto'],
  ['designer', 'Dibujado'], ['checker', 'Revisado'], ['approved', 'Aprobado'], ['approvedDate', 'Fecha aprob.'], ['date', 'Fecha'],
  ['material', 'Material'], ['scale', 'Escala'], ['revision', 'Revisión'], ['mass', 'Masa'], ['generalTol', 'Tolerancias generales'], ['finish', 'Acabado'], ['stock', 'Bruto'],
  ['#sheet', 'Hoja n/N'], ['#format', 'Formato'], ['#proj', 'Proyección'],
];
export const TB_PRESETS: TbTemplate[] = [
  { name: 'INV3D (180 × 40)', w: 180, h: 40, proj: { x: 165, y: 4 }, cells: [
    { x: 0, y: 16, w: 60, h: 16, label: 'Empresa', field: 'company' }, { x: 60, y: 16, w: 80, h: 16, label: 'Título', field: 'title', big: true }, { x: 140, y: 16, w: 40, h: 16, label: 'Nº de plano', field: 'partNumber', big: true },
    { x: 0, y: 8, w: 30, h: 8, label: 'Dibujado', field: 'designer' }, { x: 30, y: 8, w: 30, h: 8, label: 'Revisado', field: 'checker' }, { x: 60, y: 8, w: 50, h: 8, label: 'Material', field: 'material' }, { x: 110, y: 8, w: 30, h: 8, label: 'Escala', field: 'scale' }, { x: 140, y: 8, w: 20, h: 8, label: 'Rev.', field: 'revision' }, { x: 160, y: 8, w: 20, h: 8, label: 'Hoja', field: '#sheet' },
    { x: 0, y: 0, w: 30, h: 8, label: 'Fecha', field: 'date' }, { x: 30, y: 0, w: 45, h: 8, label: 'Formato', field: '#format' }, { x: 75, y: 0, w: 35, h: 8, label: 'Masa', field: 'mass' }, { x: 110, y: 0, w: 70, h: 8, label: 'Proyección', field: '#proj' },
    { x: 0, y: 32, w: 40, h: 8, label: 'Proyecto', field: 'project' }, { x: 40, y: 32, w: 40, h: 8, label: 'Tolerancias generales', field: 'generalTol' }, { x: 80, y: 32, w: 40, h: 8, label: 'Acabado', field: 'finish' }, { x: 120, y: 32, w: 30, h: 8, label: 'Aprobado', field: 'approved' }, { x: 150, y: 32, w: 30, h: 8, label: 'Fecha aprob.', field: 'approvedDate' },
  ] },
  { name: 'ISO 7200 (180 × 36)', w: 180, h: 36, proj: { x: 102, y: 7 }, cells: [
    { x: 0, y: 18, w: 50, h: 18, label: 'Propietario legal', field: 'company' }, { x: 50, y: 27, w: 30, h: 9, label: 'Responsable', field: 'designer' }, { x: 80, y: 27, w: 30, h: 9, label: 'Referencia técnica', field: 'checker' }, { x: 110, y: 27, w: 35, h: 9, label: 'Aprobado por', field: 'approved' }, { x: 145, y: 27, w: 35, h: 9, label: 'Tipo de documento', field: '=PLANO DE CONJUNTO' },
    { x: 50, y: 18, w: 60, h: 9, label: 'Estado del documento', field: 'custom:Estado' }, { x: 110, y: 18, w: 70, h: 9, label: 'Departamento', field: 'custom:Departamento' },
    { x: 0, y: 0, w: 92, h: 18, label: 'Título, título complementario', field: 'title', big: true }, { x: 92, y: 0, w: 18, h: 18, label: 'Proyección', field: '' }, { x: 110, y: 9, w: 70, h: 9, label: 'Nº de identificación', field: 'partNumber', big: true },
    { x: 110, y: 0, w: 18, h: 9, label: 'Rev.', field: 'revision' }, { x: 128, y: 0, w: 26, h: 9, label: 'Fecha de edición', field: 'date' }, { x: 154, y: 0, w: 12, h: 9, label: 'Idioma', field: '=es' }, { x: 166, y: 0, w: 14, h: 9, label: 'Hoja', field: '#sheet' },
  ] },
  { name: 'Compacto (120 × 24)', w: 120, h: 24, proj: { x: 112, y: 4 }, cells: [
    { x: 0, y: 8, w: 80, h: 16, label: 'Título', field: 'title', big: true }, { x: 80, y: 8, w: 40, h: 16, label: 'Nº de plano', field: 'partNumber', big: true },
    { x: 0, y: 0, w: 30, h: 8, label: 'Dibujado', field: 'designer' }, { x: 30, y: 0, w: 22, h: 8, label: 'Fecha', field: 'date' }, { x: 52, y: 0, w: 18, h: 8, label: 'Escala', field: 'scale' }, { x: 70, y: 0, w: 14, h: 8, label: 'Hoja', field: '#sheet' }, { x: 84, y: 0, w: 20, h: 8, label: 'Rev.', field: 'revision' },
  ] },
];
export const tbTemplate = (d: Pick<DrawingDoc, 'tbTpl'>): TbTemplate => d.tbTpl ?? TB_PRESETS[0];

export interface DrawingDoc {
  format: 'inv3d.drawing';
  version: 1;
  sheet: SheetSize;
  views: DView[];
  dims: DDim[];
  notes: DNote[];
  anns?: DAnn[];
  title: TitleBlock;
  /** Plantilla de cajetín (por defecto, la de INV3D) */
  tbTpl?: TbTemplate;
  bom?: { view: string; x: number; y: number } | null;
  tables?: DTable[];
  revisions?: DRev[];
  /** Norma de dibujo (estilos de cota, texto y proyección) */
  std?: 'ISO' | 'DIN' | 'ANSI';
  /** Estilo personalizado sobre la norma */
  style?: Partial<DrawStyle>;
  /** Varias hojas: la activa vive en los campos de arriba; pages guarda todas (la activa puede estar desfasada). */
  pages?: SheetPage[];
  page?: number;
}

/** Estilo de dibujo (Gestor de estilos): texto, cotas, flechas, grosores y proyección. */
export interface DrawStyle {
  textH: number; dimTextH: number; font: string;
  arrow: 'closed' | 'open' | 'tick' | 'dot'; arrowL: number; arrowW: number;
  extGap: number; extOver: number;
  decSep: ',' | '.'; precision: number; trailingZeros: boolean; units: 'mm' | 'in';
  thick: number; thin: number;
  projection: 'first' | 'third';
  hatchAngle: number; hatchStep: number;
  centerExt: number;
}
export const DRAW_STD: Record<'ISO' | 'DIN' | 'ANSI', DrawStyle> = {
  ISO: { textH: 3.5, dimTextH: 3.5, font: 'Arial', arrow: 'closed', arrowL: 3, arrowW: 1, extGap: 1, extOver: 2, decSep: ',', precision: 2, trailingZeros: false, units: 'mm', thick: 0.5, thin: 0.25, projection: 'first', hatchAngle: 45, hatchStep: 2.5, centerExt: 2.5 },
  DIN: { textH: 3.5, dimTextH: 3.5, font: 'Arial', arrow: 'closed', arrowL: 2.5, arrowW: 0.9, extGap: 0, extOver: 2, decSep: ',', precision: 2, trailingZeros: false, units: 'mm', thick: 0.5, thin: 0.25, projection: 'first', hatchAngle: 45, hatchStep: 2.5, centerExt: 2 },
  ANSI: { textH: 3.2, dimTextH: 3.2, font: 'Arial', arrow: 'closed', arrowL: 3.2, arrowW: 1.07, extGap: 1.6, extOver: 3.2, decSep: '.', precision: 3, trailingZeros: true, units: 'in', thick: 0.6, thin: 0.3, projection: 'third', hatchAngle: 45, hatchStep: 3.2, centerExt: 3.2 },
};
export function drawStyle(d: Pick<DrawingDoc, 'std' | 'style'>): DrawStyle { return { ...DRAW_STD[d.std ?? 'ISO'], ...(d.style ?? {}) }; }

export function extractPage(d: DrawingDoc, name?: string): SheetPage {
  return { name: name ?? d.pages?.[d.page ?? 0]?.name ?? `Hoja${(d.page ?? 0) + 1}`, sheet: d.sheet, views: d.views, dims: d.dims, notes: d.notes, anns: d.anns ?? [], tables: d.tables ?? [], bom: d.bom ?? null };
}
/** Todas las hojas con la activa al día. */
export function allPages(d: DrawingDoc): SheetPage[] {
  const pages = d.pages?.length ? [...d.pages] : [extractPage(d, 'Hoja1')];
  pages[d.page ?? 0] = extractPage(d);
  return pages;
}
export function loadPage(d: DrawingDoc, i: number) {
  const pages = allPages(d); const p = pages[i]; if (!p) return;
  d.pages = pages; d.page = i;
  d.sheet = p.sheet; d.views = p.views; d.dims = p.dims; d.notes = p.notes; d.anns = p.anns; d.tables = p.tables; d.bom = p.bom;
}

/** Plantilla de cajetín elegida como predeterminada (Plantilla de cajetín › Por defecto) */
function defaultTb(): TbTemplate | null { try { const t = typeof localStorage !== 'undefined' ? localStorage.getItem('inv3d.tbtpl.default') : null; return t ? JSON.parse(t) : null; } catch { return null; } }
export function newDrawing(): DrawingDoc {
  return {
    format: 'inv3d.drawing', version: 1, sheet: 'A3', views: [], dims: [], notes: [], anns: [],
    title: { title: '', partNumber: '', material: '', designer: '', checker: '', date: new Date().toLocaleDateString('es-ES'), company: '', revision: 'A', scale: '1:1', generalTol: 'ISO 2768-m' },
    bom: null, tables: [], revisions: [{ rev: 'A', desc: 'Primera edición', date: new Date().toLocaleDateString('es-ES'), by: '' }],
    ...(defaultTb() ? { tbTpl: defaultTb()! } : {}),
  };
}
export function validateDrawing(x: unknown): DrawingDoc {
  const d = x as DrawingDoc;
  if (!d || d.format !== 'inv3d.drawing') throw new Error('No es un plano INV3D (.i3d) válido');
  d.dims ??= []; d.notes ??= []; d.views ??= []; d.anns ??= []; d.tables ??= []; d.revisions ??= [];
  return d;
}

export const SCALES = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.04, 0.02, 0.01];
export const scaleLabel = (s: number) => (s >= 1 ? `${s}:1` : `1:${Math.round(1 / s)}`);

/** Proyección europea (ISO E): a partir de la vista base, la proyectada a la derecha es el perfil izquierdo, etc. */
export function projectedDir(base: ViewDir, side: 'right' | 'left' | 'up' | 'down', third = false): ViewDir {
  if (third) {
    // Tercer diedro (ANSI): cada vista se coloca del lado desde el que se mira
    if (base === 'front') return side === 'right' ? 'right' : side === 'left' ? 'left' : side === 'down' ? 'bottom' : 'top';
    if (base === 'top') return side === 'up' ? 'back' : side === 'down' ? 'front' : side === 'right' ? 'right' : 'left';
    return 'iso';
  }
  if (base === 'front') return side === 'right' ? 'left' : side === 'left' ? 'right' : side === 'down' ? 'top' : 'bottom';
  if (base === 'top') return side === 'up' ? 'front' : side === 'down' ? 'back' : side === 'right' ? 'left' : 'right';
  return 'iso';
}

/** Siguiente letra libre para secciones y detalles. */
export function nextLabel(views: DView[], extraUsed: string[] = []): string {
  const used = new Set(views.map((v) => v.label).filter(Boolean));
  for (const a of extraUsed) used.add(a);
  for (const c of 'ABCDEFGHJKLMNPRSTUVWXYZ') if (!used.has(c)) return c;
  return 'Z';
}
