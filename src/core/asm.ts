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
}

/** Cara plana referida a un componente, en coordenadas locales de la pieza. */
export interface FaceRef { occ: string; point: V3; normal: V3 }

export type JointType = 'mate' | 'flush' | 'rigid';
export interface Joint {
  id: string; name: string; type: JointType;
  a: FaceRef; b: FaceRef;
  offset: string; angle: string;
  suppressed?: boolean;
}

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

export interface AsmDoc {
  format: 'inv3d.assembly';
  version: 1;
  iProperties: IProps;
  kind: 'assembly' | 'weldment';
  occurrences: Occurrence[];
  joints: Joint[];
  skeleton: SkelLine[];
  frames: FrameMember[];
  welds: Weld[];
  bolts: BoltGroup[];
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
};
export const xfPoint = (x: Xform, p: V3): V3 => v3.add(q.rotate(x.quat, p), x.pos);
export const xfDir = (x: Xform, d: V3): V3 => q.rotate(x.quat, d);
export const xfInvPoint = (x: Xform, p: V3): V3 => q.rotate([-x.quat[0], -x.quat[1], -x.quat[2], x.quat[3]], v3.sub(p, x.pos));
export const xfInvDir = (x: Xform, d: V3): V3 => q.rotate([-x.quat[0], -x.quat[1], -x.quat[2], x.quat[3]], d);

/**
 * Resolución secuencial de uniones (como el orden del navegador de Inventor):
 * cada unión mueve el componente B para cumplirla respecto a A.
 */
export function solveJoints(asm: AsmDoc, ev: (s: string) => number): { xf: Record<string, Xform>; errors: Record<string, string> } {
  const xf: Record<string, Xform> = {};
  for (const o of asm.occurrences) xf[o.id] = { pos: [...o.xf.pos], quat: [...o.xf.quat] };
  const errors: Record<string, string> = {};
  const grounded = new Set(asm.occurrences.filter((o) => o.grounded).map((o) => o.id));
  for (const j of asm.joints) {
    if (j.suppressed) continue;
    const A = xf[j.a.occ], B = xf[j.b.occ];
    if (!A || !B) { errors[j.id] = 'Componente no encontrado'; continue; }
    if (grounded.has(j.b.occ) && !grounded.has(j.a.occ)) { errors[j.id] = 'El componente B está fijo; invierte la selección'; continue; }
    try {
      const pa = xfPoint(A, j.a.point), na = v3.norm(xfDir(A, j.a.normal));
      const nbW = v3.norm(xfDir(B, j.b.normal));
      // Coincidente: normales opuestas. Al ras: normales iguales.
      const target = j.type === 'flush' ? na : v3.mul(na, -1);
      let rot = q.between(nbW, target);
      const ang = ev(j.angle || '0');
      if (ang) rot = q.mul(q.axisAngle(target, (ang * Math.PI) / 180), rot);
      const newQuat = q.norm(q.mul(rot, B.quat));
      const nb: Xform = { pos: B.pos, quat: newQuat };
      const pb = xfPoint(nb, j.b.point);
      const off = ev(j.offset || '0');
      let shift: V3;
      if (j.type === 'rigid') {
        shift = v3.sub(v3.add(pa, v3.mul(na, off)), pb);
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
