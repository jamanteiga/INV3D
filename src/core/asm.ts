// Modelo de datos del ensamblaje INV3D (.i3a): componentes, uniones, estructura (Frame Generator),
// soldaduras, tornillería y explosionado (presentación).
import { v3, type V3, type IProps, type PartDoc } from './doc';

/** Transformación de un componente: posición + rotación (cuaternión x,y,z,w). */
export interface Xform { pos: V3; quat: [number, number, number, number] }
export const IDENTITY: Xform = { pos: [0, 0, 0], quat: [0, 0, 0, 1] };

export interface Occurrence {
  id: string; name: string;
  /** id del documento de pieza (en el espacio de trabajo / embebido) */
  part: string;
  xf: Xform;
  grounded?: boolean;
  suppressed?: boolean;
  hidden?: boolean;
  /** Simetría asociativa: sigue la posición del componente original respecto al plano */
  mirrorOf?: { occ: string; plane: 'YZ' | 'XZ' | 'XY' };
  /** Elemento de un patrón de componentes asociativo */
  patternOf?: string;
  /** Generado automáticamente (id de la red de conductos o tuberías) */
  gen?: string;
}
/** Patrón de componentes asociativo: los elementos se recolocan al mover el padre o cambiar los parámetros. */
export interface CompPattern { id: string; name: string; parent: string; p: Record<string, string>; members: string[]; suppressed?: boolean }

/** Referencia geométrica de un componente, en coordenadas locales de la pieza:
 *  cara plana (punto + normal) o eje de una cara cilíndrica (punto del eje + dirección + radio). */
export interface FaceRef { occ: string; point: V3; normal: V3; kind?: 'plane' | 'axis'; radius?: number; convex?: boolean; /** dirección de referencia X y centro de la cara (uniones) */ xdir?: V3; center?: V3 }

/** Coincidir, al ras, rígida, ángulo, tangente e insertar. */
export type JointType = 'mate' | 'flush' | 'rigid' | 'angle' | 'tangent' | 'insert' | 'perp' | 'sym' | 'rot' | 'slider' | 'cyl' | 'planar' | 'ball';
export const JOINT_NAMES: Record<JointType, string> = { mate: 'Coincidir', flush: 'Al ras', rigid: 'Rígida', angle: 'Ángulo', tangent: 'Tangente', insert: 'Insertar', perp: 'Perpendicular', sym: 'Simetría',
  rot: 'Unión de rotación', slider: 'Unión corredera', cyl: 'Unión cilíndrica', planar: 'Unión planar', ball: 'Unión de bola' };
/** Uniones (orígenes con eje): grados de libertad que dejan libres */
export const JOINT_DOF: Partial<Record<JointType, string>> = { rot: '1 giro', slider: '1 traslación', cyl: '1 giro + 1 traslación', planar: '2 traslaciones + 1 giro', ball: '3 giros', rigid: 'ninguno' };
export interface Joint {
  id: string; name: string; type: JointType;
  a: FaceRef; b: FaceRef;
  /** Simetría: plano de simetría */
  c?: FaceRef;
  offset: string; angle: string;
  /** Insertar: ejes en el mismo sentido (alineada) en lugar de opuestos */
  aligned?: boolean;
  /** Rotación/corredera: fija el ángulo (rotación) o la posición (corredera) en el valor indicado (para conducir) */
  lock?: boolean;
  /** Límites de recorrido (rotación en grados, corredera en mm) */
  min?: string; max?: string;
  suppressed?: boolean;
  /** Creada al conectar ePoints (ids en A y B y nombre) */
  ep?: { a: string; b: string; name: string };
}
/** Restricciones de movimiento entre dos uniones: engranaje (rotación-rotación) y piñón-cremallera (rotación-traslación). */
export interface Motion { id: string; name: string; type: 'gear' | 'rack'; j1: string; j2: string; ratio: string; reverse?: boolean; base: number; suppressed?: boolean }
export const MOTION_NAMES = { gear: 'Rotación-rotación', rack: 'Rotación-traslación' } as const;

export type EndType = 'none' | 'miter' | 'trim';
export interface EndTreat { type: EndType; other?: string; gap?: string }

/** Barra de estructura (Frame Generator) entre dos puntos del esqueleto. */
export interface FrameMember {
  id: string; name: string;
  family: string; size: string;
  material: string;
  a: V3; b: V3;
  rot: string;            // giro del perfil sobre su eje, grados
  offX: string; offY: string;   // desfase del perfil respecto a la línea
  mirror?: boolean;
  ends: [EndTreat, EndTreat];
  ext: [string, string];  // alargamiento en cada extremo (mm)
  suppressed?: boolean;
}

/** Geometría de referencia del propio ensamblaje (planos y ejes de origen, planos de trabajo): componente virtual fijo. */
export const ASM_REF = '__asm';
/** Plano de trabajo (auxiliar) del ensamblaje, en coordenadas del ensamblaje */
export interface AsmWorkPlane { id: string; name: string; origin: V3; normal: V3; xdir: V3; hidden?: boolean }
export const ORIGIN_REFS: { key: string; label: string; ref: FaceRef }[] = [
  { key: 'YZ', label: 'Plano YZ', ref: { occ: ASM_REF, point: [0, 0, 0], normal: [1, 0, 0], kind: 'plane', center: [0, 0, 0], xdir: [0, 1, 0] } },
  { key: 'XZ', label: 'Plano XZ', ref: { occ: ASM_REF, point: [0, 0, 0], normal: [0, 1, 0], kind: 'plane', center: [0, 0, 0], xdir: [1, 0, 0] } },
  { key: 'XY', label: 'Plano XY', ref: { occ: ASM_REF, point: [0, 0, 0], normal: [0, 0, 1], kind: 'plane', center: [0, 0, 0], xdir: [1, 0, 0] } },
  { key: 'X', label: 'Eje X', ref: { occ: ASM_REF, point: [0, 0, 0], normal: [1, 0, 0], kind: 'axis', radius: 0, center: [0, 0, 0], xdir: [0, 1, 0] } },
  { key: 'Y', label: 'Eje Y', ref: { occ: ASM_REF, point: [0, 0, 0], normal: [0, 1, 0], kind: 'axis', radius: 0, center: [0, 0, 0], xdir: [1, 0, 0] } },
  { key: 'Z', label: 'Eje Z', ref: { occ: ASM_REF, point: [0, 0, 0], normal: [0, 0, 1], kind: 'axis', radius: 0, center: [0, 0, 0], xdir: [1, 0, 0] } },
];
export const workPlaneRef = (w: AsmWorkPlane): FaceRef => ({ occ: ASM_REF, point: w.origin, normal: w.normal, kind: 'plane', center: w.origin, xdir: w.xdir });

/** Línea de esqueleto 3D del ensamblaje. */
export interface SkelLine { id: string; a: V3; b: V3 }

/** Cordón de soldadura en ángulo entre dos caras planas. */
export interface Weld {
  id: string; name: string;
  throat: string;     // a (garganta), mm
  p0: V3; p1: V3;     // línea de raíz
  dA: V3; dB: V3;     // direcciones de las alas (unitarias, sobre cada cara)
  process: string;    // 135 MAG, 111, 141 TIG…
  allAround?: boolean;
  suppressed?: boolean;
}

/** Conexión atornillada: grupo de tornillos sobre una cara de inicio. */
export interface BoltGroup {
  id: string; name: string;
  size: string; grade: string;
  origin: V3; dir: V3;  // punto en la cara de inicio y dirección de apriete (hacia el material)
  u: V3;                // dirección de filas sobre la cara
  n1: string; p1: string; n2: string; p2: string;
  grip: string;         // espesor apretado (mm)
  washers: number; nut: boolean;
  cutHoles: boolean;
  calc: BoltCalc;
  suppressed?: boolean;
}
export interface BoltCalc {
  FvEd: string; FtEd: string;        // kN, totales del grupo
  planes: string;                    // planos de cortadura
  threadInShear: boolean;
  steel: string; tmin: string;
  e1: string; e2: string;            // distancias a borde (dirección de carga / perpendicular)
}

/** Patrón de componentes (copias de uno o varios componentes). */

/** Representación de vista: componentes ocultos */
export interface ViewRep { id: string; name: string; hidden: string[]; /** colores por componente y cámara (opcionales) */ colors?: Record<string, string> }
/** Estado de modelo: qué componentes, barras, cordones y tornillos están suprimidos, y posiciones de los no restringidos */
export interface ModelState { id: string; name: string; suppressed: string[]; positions?: Record<string, Xform> }

export interface AsmDoc {
  format: 'inv3d.assembly';
  viewReps?: ViewRep[];
  modelStates?: ModelState[];
  ductNets?: import('./ductnet').DuctNet[];
  pipeNets?: import('./pipenet').PipeNet[];
  frameLoads?: import('./frame3d').FrameLoads;
  activeState?: string;
  patterns?: CompPattern[];
  motions?: Motion[];
  version: 1;
  iProperties: IProps;
  kind: 'assembly' | 'weldment';
  occurrences: Occurrence[];
  joints: Joint[];
  skeleton: SkelLine[];
  frames: FrameMember[];
  welds: Weld[];
  bolts: BoltGroup[];
  workPlanes?: AsmWorkPlane[];
  /** desplazamientos de explosionado por id (componente o barra) */
  explode: Record<string, V3>;
}

export function newAsm(kind: AsmDoc['kind'] = 'assembly'): AsmDoc {
  return {
    format: 'inv3d.assembly', version: 1, kind,
    iProperties: { partNumber: kind === 'weldment' ? 'Soldadura1' : 'Ensamblaje1', description: '', designer: '', material: 'Acero S275JR', revision: 'A' },
    occurrences: [], joints: [], skeleton: [], frames: [], welds: [], bolts: [], explode: {},
  };
}

export function validateAsm(x: unknown): AsmDoc {
  const d = x as AsmDoc;
  if (!d || d.format !== 'inv3d.assembly') throw new Error('No es un ensamblaje INV3D (.i3a) válido');
  const n = newAsm();
  for (const k of ['occurrences', 'joints', 'skeleton', 'frames', 'welds', 'bolts'] as const) (d as any)[k] ??= (n as any)[k];
  d.explode ??= {};
  d.kind ??= 'assembly';
  return d;
}

// ---------- Cuaterniones ----------
export type Quat = [number, number, number, number];
export const q = {
  mul: (a: Quat, b: Quat): Quat => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ],
  axisAngle: (axis: V3, rad: number): Quat => { const n = v3.norm(axis), s = Math.sin(rad / 2); return [n[0] * s, n[1] * s, n[2] * s, Math.cos(rad / 2)]; },
  rotate: (qq: Quat, v: V3): V3 => {
    const [x, y, z, w] = qq;
    const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
  },
  /** Rotación mínima que lleva el vector unitario a sobre b. */
  between: (a: V3, b: V3): Quat => {
    const d = v3.dot(a, b);
    if (d > 0.999999) return [0, 0, 0, 1];
    if (d < -0.999999) {
      let ax = v3.cross([1, 0, 0], a); if (v3.len(ax) < 1e-6) ax = v3.cross([0, 1, 0], a);
      return q.axisAngle(ax, Math.PI);
    }
    const c = v3.cross(a, b), w = 1 + d, n = Math.hypot(c[0], c[1], c[2], w);
    return [c[0] / n, c[1] / n, c[2] / n, w / n];
  },
  norm: (a: Quat): Quat => { const n = Math.hypot(...a) || 1; return [a[0] / n, a[1] / n, a[2] / n, a[3] / n]; },
  /** Matriz de rotación (filas) → cuaternión */
  fromMatrix: (m: number[][]): Quat => {
    const tr = m[0][0] + m[1][1] + m[2][2];
    if (tr > 0) { const S = Math.sqrt(tr + 1) * 2; return q.norm([(m[2][1] - m[1][2]) / S, (m[0][2] - m[2][0]) / S, (m[1][0] - m[0][1]) / S, 0.25 * S]); }
    if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const S = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; return q.norm([0.25 * S, (m[0][1] + m[1][0]) / S, (m[0][2] + m[2][0]) / S, (m[2][1] - m[1][2]) / S]); }
    if (m[1][1] > m[2][2]) { const S = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; return q.norm([(m[0][1] + m[1][0]) / S, 0.25 * S, (m[1][2] + m[2][1]) / S, (m[0][2] - m[2][0]) / S]); }
    const S = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; return q.norm([(m[0][2] + m[2][0]) / S, (m[1][2] + m[2][1]) / S, 0.25 * S, (m[1][0] - m[0][1]) / S]);
  },
  toMatrix: (qq: Quat): number[][] => { const c = (v: V3) => q.rotate(qq, v); const X = c([1, 0, 0]), Y = c([0, 1, 0]), Z = c([0, 0, 1]); return [[X[0], Y[0], Z[0]], [X[1], Y[1], Z[1]], [X[2], Y[2], Z[2]]]; },
};
export const xfPoint = (x: Xform, p: V3): V3 => v3.add(q.rotate(x.quat, p), x.pos);
export const xfDir = (x: Xform, d: V3): V3 => q.rotate(x.quat, d);
export const xfInvPoint = (x: Xform, p: V3): V3 => q.rotate([-x.quat[0], -x.quat[1], -x.quat[2], x.quat[3]], v3.sub(p, x.pos));
export const xfInvDir = (x: Xform, d: V3): V3 => q.rotate([-x.quat[0], -x.quat[1], -x.quat[2], x.quat[3]], d);

/**
 * Resolución secuencial de uniones:
 * cada unión mueve el componente B para cumplirla respecto a A.
 */
export function solveJoints(asm: AsmDoc, ev: (s: string) => number): { xf: Record<string, Xform>; errors: Record<string, string> } {
  const xf: Record<string, Xform> = {};
  for (const o of asm.occurrences) xf[o.id] = { pos: [...o.xf.pos], quat: [...o.xf.quat] };
  xf[ASM_REF] = { pos: [0, 0, 0], quat: [0, 0, 0, 1] };
  const errors: Record<string, string> = {};
  const grounded = new Set([ASM_REF, ...asm.occurrences.filter((o) => o.grounded).map((o) => o.id)]);
  for (const j of asm.joints) {
    if (j.suppressed) continue;
    const A = xf[j.a.occ], B = xf[j.b.occ];
    if (!A || !B || (j.c && !xf[j.c.occ])) { errors[j.id] = 'Componente no encontrado'; continue; }
    if (grounded.has(j.b.occ) && !grounded.has(j.a.occ)) { errors[j.id] = 'El componente B está fijo; invierte la selección'; continue; }
    try {
      const pa = xfPoint(A, j.a.point), na = v3.norm(xfDir(A, j.a.normal));
      const nbW = v3.norm(xfDir(B, j.b.normal));
      if (j.type === 'angle' || j.type === 'tangent' || j.type === 'perp' || j.type === 'sym') continue; // los resuelve el método numérico
      const pac = xfPoint(A, j.a.center ?? j.a.point);
      if (j.type === 'ball') { xf[j.b.occ] = { pos: v3.add(B.pos, v3.sub(pac, xfPoint(B, j.b.center ?? j.b.point))), quat: B.quat }; continue; }
      if (j.type === 'rot' || j.type === 'slider' || j.type === 'cyl' || j.type === 'planar') {
        const rot0 = q.between(nbW, v3.mul(na, -1));
        const nq = q.norm(q.mul(rot0, B.quat)), nb0: Xform = { pos: B.pos, quat: nq };
        const pb0 = xfPoint(nb0, j.b.center ?? j.b.point), w = v3.sub(pb0, pac);
        const sh = j.type === 'rot' ? v3.mul(w, -1) : j.type === 'planar' ? v3.mul(na, -v3.dot(w, na)) : v3.mul(v3.sub(w, v3.mul(na, v3.dot(w, na))), -1);
        xf[j.b.occ] = { pos: v3.add(B.pos, sh), quat: nq };
        continue;
      }
      const axes = j.a.kind === 'axis' && j.b.kind === 'axis';
      if ((j.a.kind === 'axis') !== (j.b.kind === 'axis')) continue;
      // Coincidente: normales opuestas. Al ras: normales iguales. Ejes: se alinean en el sentido más próximo.
      const target = j.type === 'flush' || (j.type === 'insert' && j.aligned) ? na : axes && j.type === 'mate' && v3.dot(na, nbW) > 0 ? na : v3.mul(na, -1);
      let rot = q.between(nbW, target);
      const ang = ev(j.angle || '0');
      if (ang) rot = q.mul(q.axisAngle(target, (ang * Math.PI) / 180), rot);
      const newQuat = q.norm(q.mul(rot, B.quat));
      const nb: Xform = { pos: B.pos, quat: newQuat };
      const pb = xfPoint(nb, j.b.point);
      const off = ev(j.offset || '0');
      let shift: V3;
      if (j.type === 'rigid' || axes) {
        shift = v3.sub(v3.add(pa, v3.mul(na, j.type === 'insert' || j.type === 'rigid' ? off : 0)), pb);
        if (axes && j.type === 'mate') { const w = v3.sub(pb, pa); shift = v3.mul(v3.sub(w, v3.mul(na, v3.dot(w, na))), -1); }
      } else {
        // Solo se impone la distancia normal entre planos; el componente conserva su posición en el plano.
        const dist = v3.dot(v3.sub(pb, pa), na) - off;
        shift = v3.mul(na, -dist);
      }
      xf[j.b.occ] = { pos: v3.add(nb.pos, shift), quat: newQuat };
    } catch (e) { errors[j.id] = (e as Error).message; }
  }
  return { xf, errors };
}

/** Sistema local de una barra: z = eje, y = "arriba" del perfil, x = ancho. */
export function memberFrame(a: V3, b: V3, rotDeg: number) {
  const z = v3.norm(v3.sub(b, a));
  let up: V3 = Math.abs(z[2]) > 0.995 ? [0, 1, 0] : [0, 0, 1];
  up = v3.norm(v3.sub(up, v3.mul(z, v3.dot(up, z))));
  let x = v3.norm(v3.cross(up, z));
  let y = up;
  if (rotDeg) {
    const r = (rotDeg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    const nx = v3.add(v3.mul(x, c), v3.mul(y, s)), ny = v3.add(v3.mul(y, c), v3.mul(x, -s));
    x = nx; y = ny;
  }
  return { x, y, z, len: v3.len(v3.sub(b, a)) };
}

export const embeddedParts = (asm: AsmDoc) => [...new Set(asm.occurrences.map((o) => o.part))];
export type PartMap = Record<string, PartDoc>;

/**
 * Línea de raíz de un cordón en ángulo entre dos caras planas (en coordenadas de mundo):
 * intersección de los planos, recortada al tramo común de ambas caras.
 * Las alas van por cada cara hacia el lado libre (el de la normal de la otra cara).
 */
export function weldFromFaces(nA: V3, vertsA: V3[], nB: V3, vertsB: V3[]): { p0: V3; p1: V3; dA: V3; dB: V3 } {
  const n1 = v3.norm(nA), n2 = v3.norm(nB);
  const e0 = v3.cross(n1, n2);
  if (v3.len(e0) < 1e-3) throw new Error('Las caras son paralelas: no forman un rincón');
  const e = v3.norm(e0);
  const d1 = v3.dot(n1, vertsA[0]), d2 = v3.dot(n2, vertsB[0]);
  // Punto de la recta: combinación de n1 y n2 que cumple ambas ecuaciones de plano
  const c = v3.dot(n1, n2), den = 1 - c * c;
  const a = (d1 - d2 * c) / den, b = (d2 - d1 * c) / den;
  const P = v3.add(v3.mul(n1, a), v3.mul(n2, b));
  const span = (vs: V3[]) => { const t = vs.map((v) => v3.dot(v3.sub(v, P), e)); return [Math.min(...t), Math.max(...t)]; };
  const [a1, b1] = span(vertsA), [a2, b2] = span(vertsB);
  const t0 = Math.max(a1, a2), t1 = Math.min(b1, b2);
  if (t1 - t0 < 1e-3) throw new Error('Las caras no se tocan a lo largo de una arista común');
  // Rincón real: la recta queda dentro de la extensión de cada cara y al menos una la toca con una arista
  const perpSpan = (vs: V3[], n: V3) => { const qd = v3.norm(v3.cross(n, e)); const t = vs.map((v) => v3.dot(v3.sub(v, P), qd)); return [Math.min(...t), Math.max(...t)]; };
  const inside = (vs: V3[], n: V3) => { const [lo, hi] = perpSpan(vs, n); return lo <= 0.5 && hi >= -0.5; };
  const touch = (vs: V3[], n: V3) => { const [lo, hi] = perpSpan(vs, n); return Math.abs(lo) < 0.5 || Math.abs(hi) < 0.5; };
  if (!inside(vertsA, n1) || !inside(vertsB, n2) || !(touch(vertsA, n1) || touch(vertsB, n2)))
    throw new Error('Las caras no forman un rincón (no llegan a la arista común)');
  const perp = (d: V3, n: V3) => { let x = v3.sub(d, v3.mul(e, v3.dot(d, e))); x = v3.sub(x, v3.mul(n, v3.dot(x, n))); return v3.norm(x); };
  return { p0: v3.add(P, v3.mul(e, t0)), p1: v3.add(P, v3.mul(e, t1)), dA: perp(n2, n1), dB: perp(n1, n2) };
}


// ---------- Resolución simultánea de restricciones (Gauss-Newton de norma mínima) ----------
const sub3 = v3.sub, dot3 = v3.dot, cross3 = v3.cross;

/** Residuos de una restricción con las poses dadas de A y B. */
const UNION = new Set<JointType>(['rot', 'slider', 'cyl', 'planar', 'ball']);
export function jointResiduals(j: Joint, A: Xform, B: Xform, ev: (s: string) => number, C?: Xform): number[] {
  const u = UNION.has(j.type);
  const pa = xfPoint(A, u ? j.a.center ?? j.a.point : j.a.point), na = v3.norm(xfDir(A, j.a.normal));
  const pb = xfPoint(B, u ? j.b.center ?? j.b.point : j.b.point), nb = v3.norm(xfDir(B, j.b.normal));
  const off = ev(j.offset || '0') || 0;
  const ka = j.a.kind ?? 'plane', kb = j.b.kind ?? 'plane';
  const perp = (w: V3, d: V3) => sub3(w, v3.mul(d, dot3(w, d)));
  switch (j.type) {
    case 'mate': {
      if (ka === 'plane' && kb === 'plane') return [...v3.add(na, nb), dot3(sub3(pb, pa), na) - off];
      if (ka === 'axis' && kb === 'axis') return [...cross3(na, nb), ...perp(sub3(pb, pa), na)];
      // eje sobre plano
      const [P, N, Q, D] = ka === 'plane' ? [pa, na, pb, nb] : [pb, nb, pa, na];
      return [dot3(N, D), dot3(sub3(Q, P), N) - off];
    }
    case 'flush': return [...sub3(na, nb), dot3(sub3(pb, pa), na) - off];
    case 'perp': return [dot3(na, nb)];
    case 'sym': {
      if (!j.c || !C) return [];
      // reflejo de la geometría A en el plano C: B debe coincidir con ese reflejo
      const pc = xfPoint(C, j.c.point), nc = v3.norm(xfDir(C, j.c.normal));
      const ra = sub3(pa, v3.mul(nc, 2 * dot3(sub3(pa, pc), nc))), rn = sub3(na, v3.mul(nc, 2 * dot3(na, nc)));
      if (ka === 'axis' && kb === 'axis') return [...cross3(rn, nb), ...perp(sub3(pb, ra), rn)];
      return [...sub3(rn, nb), dot3(sub3(pb, ra), nb)];
    }
    case 'insert': return [...(j.aligned ? sub3(na, nb) : v3.add(na, nb)), ...perp(sub3(pb, pa), na), dot3(sub3(pb, pa), na) - off];
    case 'rigid': return [...v3.add(na, nb), ...sub3(pb, v3.add(pa, v3.mul(na, off)))];
    case 'angle': return [dot3(na, nb) - Math.cos(((ev(j.angle || '0') || 0) * Math.PI) / 180)];
    case 'ball': return [...sub3(pb, pa)];
    case 'planar': return [...v3.add(na, nb), dot3(sub3(pb, pa), na) - off];
    case 'cyl': return [...cross3(na, nb), ...perp(sub3(pb, pa), na)];
    case 'rot': case 'slider': {
      const out = [...v3.add(na, nb), ...(j.type === 'rot' ? sub3(pb, pa) : perp(sub3(pb, pa), na))];
      const xa = j.a.xdir ? v3.norm(xfDir(A, j.a.xdir)) : null, xb = j.b.xdir ? v3.norm(xfDir(B, j.b.xdir)) : null;
      if (j.type === 'slider' && xa && xb) out.push(dot3(cross3(xa, xb), na));
      if (j.lock) {
        if (j.type === 'rot' && xa && xb) { const th = ((ev(j.angle || '0') || 0) * Math.PI) / 180; out.push(dot3(xa, xb) - Math.cos(th), dot3(cross3(xa, xb), na) - Math.sin(th)); }
        if (j.type === 'slider') out.push(dot3(sub3(pb, pa), na) - off);
      }
      return out;
    }
    case 'tangent': {
      if (ka === 'axis' && kb === 'axis') { const r = (j.a.radius ?? 0) + (j.b.radius ?? 0) + off; return [...cross3(na, nb), v3.len(perp(sub3(pb, pa), na)) - r]; }
      const [P, N, Q, D, r] = ka === 'plane' ? [pa, na, pb, nb, j.b.radius ?? 0] : [pb, nb, pa, na, j.a.radius ?? 0];
      return [dot3(N, D), dot3(sub3(Q, P), N) - (r + off)];
    }
  }
}

/** Valor actual de una unión: ángulo (°) para rotación/cilíndrica, posición (mm) para corredera. */
export function jointValue(j: Joint, A: Xform, B: Xform): number {
  const na = v3.norm(xfDir(A, j.a.normal));
  if (j.type === 'slider') {
    const u = UNION.has(j.type);
    return dot3(sub3(xfPoint(B, u ? j.b.center ?? j.b.point : j.b.point), xfPoint(A, u ? j.a.center ?? j.a.point : j.a.point)), na);
  }
  if (!j.a.xdir || !j.b.xdir) return 0;
  const xa = v3.norm(xfDir(A, j.a.xdir)), xb = v3.norm(xfDir(B, j.b.xdir));
  return (Math.atan2(dot3(cross3(xa, xb), na), dot3(xa, xb)) * 180) / Math.PI;
}
const wrap180 = (a: number) => { let x = ((a + 180) % 360 + 360) % 360 - 180; if (x === -180) x = 180; return x; };
/** Residuos de una restricción de movimiento (el valor de la unión 1 bloqueada se toma sin envolver). */
export function motionResidual(m: Motion, j1: Joint, j2: Joint, P: (id: string) => Xform, ev: (s: string) => number): number {
  const v1 = j1.lock && (j1.type === 'rot' || j1.type === 'slider') ? (j1.type === 'rot' ? ev(j1.angle || '0') : ev(j1.offset || '0')) : jointValue(j1, P(j1.a.occ), P(j1.b.occ));
  const v2 = jointValue(j2, P(j2.a.occ), P(j2.b.occ));
  const k = (ev(m.ratio || '1') || 1) * (m.reverse ? -1 : 1);
  if (m.type === 'gear') return (wrap180(v2 - (k * v1 + m.base)) * Math.PI) / 180;
  return v2 - ((k * v1) / 360 + m.base); // k = avance en mm por vuelta
}
/** Valor base al crear la restricción de movimiento, para que el mecanismo no salte. */
export function motionBase(type: Motion['type'], ratio: number, j1: Joint, j2: Joint, P: (id: string) => Xform): number {
  const v1 = jointValue(j1, P(j1.a.occ), P(j1.b.occ)), v2 = jointValue(j2, P(j2.a.occ), P(j2.b.occ));
  return type === 'gear' ? v2 - ratio * v1 : v2 - (ratio * v1) / 360;
}
function limitResidual(j: Joint, A: Xform, B: Xform, ev: (s: string) => number): number[] {
  if ((j.type !== 'rot' && j.type !== 'slider') || j.lock || (!j.min && !j.max)) return [];
  const v = jointValue(j, A, B), lo = j.min ? ev(j.min) : -Infinity, hi = j.max ? ev(j.max) : Infinity;
  const r = v > hi ? v - hi : v < lo ? v - lo : 0;
  return [j.type === 'rot' ? (r * Math.PI) / 180 : r];
}

const poseWith = (x0: Xform, v: number[], o: number): Xform => {
  const r: V3 = [v[o + 3], v[o + 4], v[o + 5]], ang = v3.len(r);
  const dq = ang > 1e-12 ? q.axisAngle(r, ang) : [0, 0, 0, 1] as Quat;
  return { pos: [x0.pos[0] + v[o], x0.pos[1] + v[o + 1], x0.pos[2] + v[o + 2]], quat: q.norm(q.mul(dq, x0.quat)) };
};

/**
 * Resuelve todas las restricciones a la vez. Parte de la solución secuencial (que resuelve los giros de 180°)
 * y la afina; los componentes se mueven lo mínimo (los giros cuestan más que las traslaciones).
 */
export function solveAssembly(asm: AsmDoc, ev: (s: string) => number, opts: { dof?: boolean } = {}): { xf: Record<string, Xform>; errors: Record<string, string>; dof: Record<string, number> } {
  const seq = solveJoints(asm, ev);
  const xf0 = seq.xf;
  const errors: Record<string, string> = {};
  const active = asm.joints.filter((j) => !j.suppressed && xf0[j.a.occ] && xf0[j.b.occ] && (!j.c || xf0[j.c.occ]) && (j.type !== 'sym' || j.c));
  const grounded = new Set([ASM_REF, ...asm.occurrences.filter((o) => o.grounded).map((o) => o.id)]);
  const movers = [...new Set(active.flatMap((j) => [j.a.occ, j.b.occ, ...(j.c ? [j.c.occ] : [])]))].filter((id) => !grounded.has(id));
  const idx = new Map(movers.map((id, i) => [id, i * 6]));
  const n = movers.length * 6;
  const pose = (v: number[], id: string) => (idx.has(id) ? poseWith(xf0[id], v, idx.get(id)!) : xf0[id]);
  const motions = (asm.motions ?? []).filter((m) => !m.suppressed).map((m) => ({ m, j1: active.find((j) => j.id === m.j1), j2: active.find((j) => j.id === m.j2) })).filter((x) => x.j1 && x.j2) as { m: Motion; j1: Joint; j2: Joint }[];
  const R = (v: number[]) => [
    ...active.flatMap((j) => { try { return [...jointResiduals(j, pose(v, j.a.occ), pose(v, j.b.occ), ev, j.c ? pose(v, j.c.occ) : undefined), ...limitResidual(j, pose(v, j.a.occ), pose(v, j.b.occ), ev)].map((x) => (isFinite(x) ? x : 0)); } catch { return []; } }),
    ...motions.map(({ m, j1, j2 }) => { try { const r = motionResidual(m, j1, j2, (id) => pose(v, id), ev); return isFinite(r) ? r : 0; } catch { return 0; } }),
  ];
  let x = new Array(n).fill(0);
  const w = new Array(n).fill(0).map((_, i) => (i % 6 < 3 ? 1 : 1e-4));
  const norm2 = (r: number[]) => r.reduce((a, b) => a + b * b, 0);
  let r = R(x), f = norm2(r);
  const jac = (xx: number[], m: number) => {
    const J = Array.from({ length: m }, () => new Array(n).fill(0)), y = xx.slice();
    for (let k = 0; k < n; k++) {
      const h = k % 6 < 3 ? 1e-5 : 1e-7;
      y[k] = xx[k] + h; const rp = R(y); y[k] = xx[k] - h; const rm = R(y); y[k] = xx[k];
      for (let i = 0; i < m; i++) J[i][k] = (rp[i] - rm[i]) / (2 * h);
    }
    return J;
  };
  for (let it = 0; it < 50 && f > 1e-16 && n; it++) {
    const m = r.length, J = jac(x, m);
    const A = Array.from({ length: m }, () => new Array(m).fill(0));
    for (let i = 0; i < m; i++) for (let k = i; k < m; k++) { let sm = 0; for (let c = 0; c < n; c++) sm += J[i][c] * w[c] * J[k][c]; A[i][k] = sm; A[k][i] = sm; }
    const lam = 1e-9 * Math.max(1e-12, ...A.map((row, i) => row[i]));
    for (let i = 0; i < m; i++) A[i][i] += lam;
    const yv = gauss(A, r);
    const dx = new Array(n).fill(0).map((_, c) => { let sm = 0; for (let i = 0; i < m; i++) sm += J[i][c] * yv[i]; return -w[c] * sm; });
    let alpha = 1, ok = false;
    for (let ls = 0; ls < 12; ls++) { const xn = x.map((v, c) => v + alpha * dx[c]); const rn = R(xn), fn = norm2(rn); if (fn < f) { x = xn; r = rn; f = fn; ok = true; break; } alpha /= 2; }
    if (!ok) break;
  }
  const xf: Record<string, Xform> = { ...xf0 };
  for (const id of movers) xf[id] = pose(x, id);
  for (const j of active) {
    try { const rr = jointResiduals(j, xf[j.a.occ], xf[j.b.occ], ev, j.c ? xf[j.c.occ] : undefined); if (Math.sqrt(norm2(rr)) > 1e-3) errors[j.id] = 'Restricción no satisfecha (conflicto con otras o con componentes fijos)'; } catch (e) { errors[j.id] = (e as Error).message; }
  }
  for (const [k, v] of Object.entries(seq.errors)) if (!/invierte/.test(v)) errors[k] ??= v;
  // Grados de libertad por componente
  const dof: Record<string, number> = {};
  for (const o of asm.occurrences) dof[o.id] = grounded.has(o.id) ? 0 : 6;
  if (opts.dof && n) {
    const r0 = R(x), J = r0.length ? jac(x, r0.length) : [];
    const ns = nullspace(J, n);
    for (const id of movers) {
      const o = idx.get(id)!;
      const sub = ns.map((vec) => vec.slice(o, o + 6));
      dof[id] = rankOf(sub);
    }
  }
  return { xf, errors, dof };
}

function gauss(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let k = 0; k < n; k++) {
    let p = k; for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    [M[k], M[p]] = [M[p], M[k]];
    const d = M[k][k]; if (Math.abs(d) < 1e-300) continue;
    for (let i = k + 1; i < n; i++) { const f = M[i][k] / d; if (f) for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j]; }
  }
  const y = new Array(n).fill(0);
  for (let k = n - 1; k >= 0; k--) { let s = M[k][n]; for (let j = k + 1; j < n; j++) s -= M[k][j] * y[j]; y[k] = Math.abs(M[k][k]) > 1e-300 ? s / M[k][k] : 0; }
  return y;
}
/** Base del espacio nulo de J (m×n) por escalonamiento reducido. */
function nullspace(J: number[][], n: number): number[][] {
  const M = J.map((r) => r.slice()), m = M.length, piv: number[] = [];
  const scale = Math.max(1e-12, ...M.flat().map(Math.abs)), tol = 1e-7 * scale;
  let row = 0;
  for (let c = 0; c < n && row < m; c++) {
    let p = row; for (let i = row + 1; i < m; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) <= tol) continue;
    [M[row], M[p]] = [M[p], M[row]];
    const d = M[row][c]; for (let j = c; j < n; j++) M[row][j] /= d;
    for (let i = 0; i < m; i++) if (i !== row && M[i][c]) { const f = M[i][c]; for (let j = c; j < n; j++) M[i][j] -= f * M[row][j]; }
    piv.push(c); row++;
  }
  const pivSet = new Set(piv), out: number[][] = [];
  for (let fcol = 0; fcol < n; fcol++) {
    if (pivSet.has(fcol)) continue;
    const v = new Array(n).fill(0); v[fcol] = 1;
    piv.forEach((pc, ri) => { v[pc] = -M[ri][fcol]; });
    out.push(v);
  }
  return out;
}
function rankOf(vecs: number[][]): number {
  const M = vecs.map((r) => r.slice()); if (!M.length) return 0;
  const n = M[0].length; let rank = 0;
  for (let c = 0; c < n && rank < M.length; c++) {
    let p = rank; for (let i = rank + 1; i < M.length; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) < 1e-6) continue;
    [M[rank], M[p]] = [M[p], M[rank]];
    for (let i = 0; i < M.length; i++) if (i !== rank) { const f = M[i][c] / M[rank][c]; for (let j = c; j < n; j++) M[i][j] -= f * M[rank][j]; }
    rank++;
  }
  return rank;
}

// ---------- Patrones y simetrías asociativos ----------
const AXV: Record<string, V3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
/** Posiciones de las copias de un patrón (sin el original). */
export function patternPoses(xf: Xform, p: Record<string, string>, ev: (s: string) => number): Xform[] {
  const out: Xform[] = [];
  if (p.kind === 'rect') {
    const n1 = Math.max(1, Math.round(ev(p.n))), d1 = ev(p.d), n2 = p.dir2 ? Math.max(1, Math.round(ev(p.n2))) : 1, d2 = p.dir2 ? ev(p.d2) : 0;
    for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) {
      if (!i && !j) continue;
      const t = v3.add(v3.mul(AXV[p.dir] ?? AXV.X, i * d1), p.dir2 ? v3.mul(AXV[p.dir2], j * d2) : [0, 0, 0]);
      out.push({ pos: v3.add(xf.pos, t), quat: [...xf.quat] as Quat });
    }
  } else {
    const n = Math.max(2, Math.round(ev(p.count))), tot = ev(p.angle), step = Math.abs(tot - 360) < 1e-9 ? 360 / n : tot / (n - 1);
    for (let k = 1; k < n; k++) {
      const rq = q.axisAngle(AXV[p.dir] ?? AXV.Z, (step * k * Math.PI) / 180);
      out.push({ pos: q.rotate(rq, xf.pos), quat: q.norm(q.mul(rq, xf.quat)) });
    }
  }
  return out.slice(0, 400);
}
export function mirrorPose(xf: Xform, plane: 'YZ' | 'XZ' | 'XY'): Xform {
  const M = plane === 'YZ' ? [-1, 1, 1] : plane === 'XZ' ? [1, -1, 1] : [1, 1, -1];
  const R = q.toMatrix(xf.quat);
  const R2 = R.map((row, i) => row.map((v, j) => M[i] * v * M[j]));
  return { pos: xf.pos.map((v, i) => v * M[i]) as V3, quat: q.fromMatrix(R2) };
}
/** Recoloca simetrías y patrones a partir de sus originales; añade o quita elementos si cambia el número. */
export function applyAssociative(a: AsmDoc, ev: (s: string) => number, uidFn: (p: string) => string) {
  const byId = () => new Map(a.occurrences.map((o) => [o.id, o]));
  for (const pt of a.patterns ?? []) {
    let m = byId();
    const par = m.get(pt.parent);
    if (!par) { a.occurrences = a.occurrences.filter((o) => o.patternOf !== pt.id); pt.members = []; continue; }
    const poses = pt.suppressed ? [] : patternPoses(par.xf, pt.p, ev);
    pt.members = pt.members.filter((id) => m.has(id));
    while (pt.members.length > poses.length) {
      const id = pt.members.pop()!;
      a.occurrences = a.occurrences.filter((o) => o.id !== id);
      a.joints = a.joints.filter((j) => j.a.occ !== id && j.b.occ !== id);
    }
    const base = par.name.replace(/:\d+$/, '');
    while (pt.members.length < poses.length) {
      const id = uidFn('o');
      a.occurrences.push({ id, name: `${base}:${a.occurrences.filter((x) => x.part === par.part).length + 1}`, part: par.part, xf: poses[pt.members.length], grounded: true, patternOf: pt.id });
      pt.members.push(id);
    }
    m = byId();
    pt.members.forEach((id, i) => { const o = m.get(id); if (o) { o.xf = poses[i]; o.part = par.part; o.suppressed = par.suppressed; } });
  }
  const m = byId();
  for (const o of a.occurrences) if (o.mirrorOf) { const src = m.get(o.mirrorOf.occ); if (src) o.xf = mirrorPose(src.xf, o.mirrorOf.plane); }
}
