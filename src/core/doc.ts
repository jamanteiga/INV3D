// Modelo de datos del formato de pieza INV3D (.i3p)
import type { Param } from './expr';

export type V3 = [number, number, number];
export type V2 = [number, number];
export type E2 = [string, string]; // punto 2D con coordenadas como expresiones

export type StdPlane = 'XY' | 'XZ' | 'YZ';
export type PlaneRef =
  | { kind: 'std'; name: StdPlane; offset: string }
  | { kind: 'custom'; label: string; origin: V3; xDir: V3; normal: V3 }
  | { kind: 'work'; id: string };

export type SkEntity =
  | { id: string; type: 'line'; a: E2; b: E2; construction?: boolean }
  | { id: string; type: 'rect'; x: string; y: string; w: string; h: string }
  | { id: string; type: 'circle'; cx: string; cy: string; d: string }
  | { id: string; type: 'poly'; pts: E2[] }
  | { id: string; type: 'npoly'; cx: string; cy: string; d: string; n: string; rot: string }
  | { id: string; type: 'point'; cx: string; cy: string }
  | { id: string; type: 'arc'; cx: string; cy: string; r: string; a0: string; a1: string; construction?: boolean }
  | { id: string; type: 'slot'; x1: string; y1: string; x2: string; y2: string; w: string };

export type BoolOp = 'join' | 'cut' | 'intersect' | 'new';
export type EdgeMode = 'all' | 'X' | 'Y' | 'Z' | 'circle' | 'picked';
export interface EdgeSel { mode: EdgeMode; points: V3[] }

interface FBase { id: string; name: string; suppressed?: boolean }
export interface SketchF extends FBase { type: 'sketch'; plane: PlaneRef; entities: SkEntity[] }
export interface ExtrudeF extends FBase { type: 'extrude'; profile: string; distance: string; dir: 'normal' | 'reverse' | 'symmetric'; op: BoolOp }
export interface RevolveF extends FBase { type: 'revolve'; profile: string; axis: string; angle: string; op: BoolOp }
export interface FilletF extends FBase { type: 'fillet'; radius: string; edges: EdgeSel }
export interface ChamferF extends FBase { type: 'chamfer'; distance: string; edges: EdgeSel }
export interface ImportF extends FBase { type: 'import'; fileName: string; step: string }
export type HoleKind = 'simple' | 'cbore' | 'csink';
export interface HoleF extends FBase {
  type: 'hole'; sketch: string; dia: string; depth: string; through: boolean; kind: HoleKind;
  cbDia: string; cbDepth: string; csDia: string; csAngle: string; thread: string;
}
export type AxisName = 'X' | 'Y' | 'Z';
export interface PatternF extends FBase {
  type: 'pattern'; ptype: 'rect' | 'circ'; features: string[];
  dir1: AxisName; n1: string; d1: string; dir2: AxisName | ''; n2: string; d2: string;
  axis: AxisName; count: string; angle: string;
}
export interface MirrorF extends FBase { type: 'mirror'; features: string[]; plane: StdPlane }
export interface ShellF extends FBase { type: 'shell'; thickness: string; faces: V3[] }
export interface WorkPlaneF extends FBase { type: 'workplane'; base: PlaneRef; offset: string; angle: string }
export interface LoftF extends FBase { type: 'loft'; sections: string[]; ruled: boolean; op: BoolOp }
export interface SweepF extends FBase { type: 'sweep'; profile: string; path: string; op: BoolOp }
export interface SmFaceF extends FBase { type: 'sm_face'; profile: string }
export interface EdgeRef { p0: V3; p1: V3; n: V3; w: V3 }
export interface SmFlangeF extends FBase { type: 'sm_flange'; edge: EdgeRef | null; length: string; angle: string; dir: 'up' | 'down' }
export type Feature = SketchF | ExtrudeF | RevolveF | FilletF | ChamferF | ImportF | HoleF | PatternF | MirrorF | ShellF
  | WorkPlaneF | LoftF | SweepF | SmFaceF | SmFlangeF;
export type FeatureType = Feature['type'];

export interface IProps { partNumber: string; description: string; designer: string; material: string; revision: string }

export interface PartDoc {
  format: 'inv3d.part';
  version: 1;
  units: 'mm';
  iProperties: IProps;
  parameters: Param[];
  features: Feature[];
  /** Pieza de chapa: espesor, radio de plegado interior y factor K */
  sheet?: { t: string; r: string; k: string };
}

export const MATERIALS: { name: string; density: number; color: string }[] = [
  { name: 'Acero S275JR', density: 7850, color: '#b9bec6' },
  { name: 'Acero S355J2', density: 7850, color: '#b4b9c1' },
  { name: 'Acero inoxidable AISI 316L', density: 8000, color: '#d3d7dc' },
  { name: 'Aluminio 6061-T6', density: 2700, color: '#d9dde2' },
  { name: 'Aluminio 5083 (naval)', density: 2660, color: '#d5dade' },
  { name: 'Fundición gris GJL-250', density: 7200, color: '#8f949a' },
  { name: 'Latón CuZn39Pb3', density: 8470, color: '#d8b75e' },
  { name: 'Cobre Cu-ETP', density: 8930, color: '#c8835a' },
  { name: 'PVC', density: 1400, color: '#9fb4c7' },
  { name: 'Polietileno PE-HD', density: 950, color: '#e9e9e4' },
  { name: 'Madera de pino', density: 500, color: '#caa472' },
  { name: 'Genérico', density: 1000, color: '#c3c8cf' },
];

export const PLANE_STD: Record<StdPlane, { xDir: V3; normal: V3 }> = {
  XY: { xDir: [1, 0, 0], normal: [0, 0, 1] },
  XZ: { xDir: [1, 0, 0], normal: [0, -1, 0] },
  YZ: { xDir: [0, 1, 0], normal: [1, 0, 0] },
};

export const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: V3) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};

export interface Frame { origin: V3; xDir: V3; yDir: V3; normal: V3 }

/** Planos de trabajo de la pieza, por id (se resuelven en orden de creación). */
export type WorkPlanes = Map<string, Frame>;

export function rotateAbout(v: V3, axis: V3, deg: number): V3 {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), k = v3.norm(axis);
  const kv = v3.cross(k, v), kd = v3.dot(k, v);
  return [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)];
}

export function planeFrame(p: PlaneRef, ev: (s: string) => number, work?: WorkPlanes): Frame {
  if (p.kind === 'work') {
    const f = work?.get(p.id);
    if (!f) throw new Error('Plano de trabajo no encontrado');
    return f;
  }
  if (p.kind === 'std') {
    const s = PLANE_STD[p.name];
    const off = ev(p.offset || '0');
    return { origin: v3.mul(s.normal, off), xDir: s.xDir, normal: s.normal, yDir: v3.cross(s.normal, s.xDir) };
  }
  const n = v3.norm(p.normal), x = v3.norm(p.xDir);
  return { origin: p.origin, xDir: x, normal: n, yDir: v3.cross(n, x) };
}

export const toWorld = (f: Frame, u: number, v: number): V3 =>
  v3.add(f.origin, v3.add(v3.mul(f.xDir, u), v3.mul(f.yDir, v)));

export const planeLabel = (p: PlaneRef, doc?: PartDoc) =>
  p.kind === 'std' ? `Plano ${p.name}${p.offset && p.offset !== '0' ? ` + ${p.offset}` : ''}`
    : p.kind === 'work' ? (doc?.features.find((f) => f.id === p.id)?.name ?? 'Plano de trabajo') : p.label;

/** Resuelve los planos de trabajo de un documento (para dibujar y para bocetos sobre ellos). */
export function resolveWorkPlanes(doc: PartDoc, ev: (s: string) => number): WorkPlanes {
  const m: WorkPlanes = new Map();
  for (const f of doc.features) {
    if (f.type !== 'workplane' || f.suppressed) continue;
    try { m.set(f.id, workPlaneFrame(f, ev, m)); } catch { /* inválido */ }
  }
  return m;
}

export function workPlaneFrame(f: WorkPlaneF, ev: (s: string) => number, work: WorkPlanes): Frame {
  const b = planeFrame(f.base, ev, work);
  const ang = ev(f.angle || '0');
  const n = rotateAbout(b.normal, b.xDir, ang);
  const y = rotateAbout(b.yDir, b.xDir, ang);
  const o = v3.add(b.origin, v3.mul(n, ev(f.offset || '0')));
  return { origin: o, xDir: b.xDir, yDir: y, normal: n };
}

/** Contorno 2D (coordenadas locales) de una entidad de boceto, para dibujar. */
export function entityOutline(e: SkEntity, ev: (s: string) => number): { pts: V2[]; closed: boolean } {
  switch (e.type) {
    case 'line': return { pts: [[ev(e.a[0]), ev(e.a[1])], [ev(e.b[0]), ev(e.b[1])]], closed: false };
    case 'rect': {
      const x = ev(e.x), y = ev(e.y), w = ev(e.w), h = ev(e.h);
      return { pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true };
    }
    case 'circle': {
      const cx = ev(e.cx), cy = ev(e.cy), r = ev(e.d) / 2;
      const pts: V2[] = [];
      for (let i = 0; i < 96; i++) { const a = (i / 96) * Math.PI * 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
      return { pts, closed: true };
    }
    case 'poly': return { pts: e.pts.map((p) => [ev(p[0]), ev(p[1])] as V2), closed: true };
    case 'npoly': return { pts: npolyPoints(ev(e.cx), ev(e.cy), ev(e.d), Math.round(ev(e.n)), ev(e.rot)), closed: true };
    case 'point': { const x = ev(e.cx), y = ev(e.cy); return { pts: [[x, y]], closed: false }; }
    case 'arc': {
      const cx = ev(e.cx), cy = ev(e.cy), r = ev(e.r), a0 = ev(e.a0), a1 = ev(e.a1);
      let sweep = a1 - a0; while (sweep <= 0) sweep += 360;
      const n = Math.max(8, Math.ceil(sweep / 4)), pts: V2[] = [];
      for (let i = 0; i <= n; i++) { const a = ((a0 + (sweep * i) / n) * Math.PI) / 180; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
      return { pts, closed: false };
    }
    case 'slot': return { pts: slotPoints(ev(e.x1), ev(e.y1), ev(e.x2), ev(e.y2), ev(e.w)), closed: true };
  }
}

/** Ranura (colisa) de centro a centro, anchura w. */
export function slotPoints(x1: number, y1: number, x2: number, y2: number, w: number): V2[] {
  const r = w / 2, a = Math.atan2(y2 - y1, x2 - x1), pts: V2[] = [];
  for (let i = 0; i <= 24; i++) { const t = a + Math.PI / 2 + (i / 24) * Math.PI; pts.push([x1 + r * Math.cos(t), y1 + r * Math.sin(t)]); }
  for (let i = 0; i <= 24; i++) { const t = a - Math.PI / 2 + (i / 24) * Math.PI; pts.push([x2 + r * Math.cos(t), y2 + r * Math.sin(t)]); }
  return pts;
}

/** Polígono regular inscrito en el diámetro d. */
export function npolyPoints(cx: number, cy: number, d: number, n: number, rotDeg: number): V2[] {
  const r = d / 2, k = Math.max(3, Math.min(64, n)), pts: V2[] = [];
  for (let i = 0; i < k; i++) {
    const a = (rotDeg * Math.PI) / 180 + (i / k) * Math.PI * 2;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

export const isClosedEntity = (e: SkEntity) => e.type !== 'line' && e.type !== 'point' && e.type !== 'arc';

export function entityArea(e: SkEntity, ev: (s: string) => number): number {
  const o = entityOutline(e, ev);
  if (!o.closed) return 0;
  let a = 0;
  for (let i = 0; i < o.pts.length; i++) {
    const p = o.pts[i], q = o.pts[(i + 1) % o.pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

export const ENTITY_NAMES: Record<SkEntity['type'], string> = {
  line: 'Línea', rect: 'Rectángulo', circle: 'Círculo', poly: 'Contorno', npoly: 'Polígono', point: 'Punto', arc: 'Arco', slot: 'Ranura',
};

export const FEATURE_NAMES: Record<FeatureType, string> = {
  sketch: 'Boceto', extrude: 'Extrusión', revolve: 'Revolución', fillet: 'Empalme', chamfer: 'Chaflán', import: 'Sólido importado',
  hole: 'Agujero', pattern: 'Patrón', mirror: 'Simetría', shell: 'Vaciado', workplane: 'Plano de trabajo', loft: 'Solevación',
  sweep: 'Barrido', sm_face: 'Cara', sm_flange: 'Pestaña',
};

export const OP_NAMES: Record<BoolOp, string> = { join: 'Unir', cut: 'Cortar', intersect: 'Intersección', new: 'Nuevo sólido' };

export function newDoc(): PartDoc {
  return {
    format: 'inv3d.part', version: 1, units: 'mm',
    iProperties: { partNumber: 'Pieza1', description: '', designer: '', material: 'Acero S275JR', revision: 'A' },
    parameters: [],
    features: [],
  };
}

let _seq = 0;
export const uid = (p = 'e') => `${p}${Date.now().toString(36)}${(_seq++).toString(36)}`;

export function nextName(doc: PartDoc, type: FeatureType): string {
  const base = FEATURE_NAMES[type];
  let n = 1;
  const names = new Set(doc.features.map((f) => f.name));
  while (names.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** Bocetos ya consumidos por alguna operación (se ocultan, como en Inventor). */
export function consumedSketches(doc: PartDoc): Set<string> {
  const s = new Set<string>();
  for (const f of doc.features) {
    if (f.type === 'extrude' || f.type === 'revolve' || f.type === 'sm_face') s.add(f.profile);
    if (f.type === 'sweep') { s.add(f.profile); s.add(f.path); }
    if (f.type === 'loft') f.sections.forEach((x) => s.add(x));
    if (f.type === 'hole') s.add(f.sketch);
  }
  return s;
}

/** Operaciones que generan o quitan material (las que se pueden repetir en patrones y simetrías). */
export const BODY_FEATURES: FeatureType[] = ['extrude', 'revolve', 'hole', 'loft', 'sweep'];

export function newSheetDoc(): PartDoc {
  const d = newDoc();
  d.iProperties.partNumber = 'Chapa1';
  d.sheet = { t: '2 mm', r: '2 mm', k: '0.44' };
  d.parameters = [];
  return d;
}

export function validateDoc(x: unknown): PartDoc {
  const d = x as PartDoc;
  if (!d || d.format !== 'inv3d.part' || !Array.isArray(d.features)) throw new Error('No es un fichero de pieza INV3D (.i3p) válido');
  d.parameters ??= [];
  d.iProperties ??= newDoc().iProperties;
  return d;
}

/** Pieza de demostración: brida con taladros y empalme, totalmente paramétrica. */
export function demoDoc(): PartDoc {
  const d = newDoc();
  d.iProperties = { partNumber: 'BRIDA-DN80', description: 'Brida ciega de ejemplo', designer: '', material: 'Acero S275JR', revision: 'A' };
  d.parameters = [
    { name: 'D_ext', expr: '200 mm', comment: 'Diámetro exterior' },
    { name: 'e', expr: '18 mm', comment: 'Espesor de la brida' },
    { name: 'D_pc', expr: '160 mm', comment: 'Diámetro de círculo de pernos' },
    { name: 'd_t', expr: '18 mm', comment: 'Diámetro de taladro' },
    { name: 'D_cuello', expr: '110 mm', comment: 'Diámetro del cuello' },
    { name: 'h_cuello', expr: '30 mm', comment: 'Altura del cuello' },
  ];
  const holes: SkEntity[] = [0, 90, 180, 270].map((a, i) => ({
    id: `h${i}`, type: 'circle',
    cx: `D_pc/2*cos(${a + 45})`, cy: `D_pc/2*sin(${a + 45})`, d: 'd_t',
  }));
  d.features = [
    { id: 's1', name: 'Boceto1', type: 'sketch', plane: { kind: 'std', name: 'XY', offset: '0' },
      entities: [{ id: 'c0', type: 'circle', cx: '0', cy: '0', d: 'D_ext' }, ...holes] },
    { id: 'f1', name: 'Extrusión1', type: 'extrude', profile: 's1', distance: 'e', dir: 'normal', op: 'join' },
    { id: 's2', name: 'Boceto2', type: 'sketch', plane: { kind: 'std', name: 'XY', offset: 'e' },
      entities: [{ id: 'c1', type: 'circle', cx: '0', cy: '0', d: 'D_cuello' }] },
    { id: 'f2', name: 'Extrusión2', type: 'extrude', profile: 's2', distance: 'h_cuello', dir: 'normal', op: 'join' },
    { id: 'f3', name: 'Empalme1', type: 'fillet', radius: '3 mm', edges: { mode: 'circle', points: [] } },
  ];
  return d;
}
