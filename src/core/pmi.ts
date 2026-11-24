// Anotaciones 3D (PMI), AutoLímites, análisis de tolerancias y reglas.
import type { V3 } from './doc';

export type PmiKind = 'dim' | 'note' | 'gnote' | 'hole' | 'surf' | 'weld' | 'datum' | 'target' | 'fcf' | 'tolfeat' | 'profile';
export interface Pmi {
  id: string; kind: PmiKind;
  /** punto de anclaje (y segundo punto en cotas) */
  p: V3; p2?: V3;
  /** desplazamiento del rótulo respecto al anclaje (modelo) */
  off: V3;
  text?: string;
  /** tolerancia: «±0,1», «+0,2/-0», «H7»… */
  tol?: string;
  /** GD&T: símbolo, valor y referencias */
  sym?: string; val?: string; datums?: string;
  /** textura superficial: Ra y proceso */
  ra?: string; lay?: string;
  /** letra de referencia o de objetivo («A», «A1») */
  letter?: string;
  /** soldadura: tipo, garganta, longitud, en obra, todo alrededor */
  weld?: { type: string; a: string; l: string; field: boolean; around: boolean };
  /** operación asociada (notas de taladro, tolerancias de operación) */
  feature?: string;
}
export const PMI_NAMES: Record<PmiKind, string> = {
  dim: 'Cota', note: 'Texto con directriz', gnote: 'Nota general', hole: 'Nota de taladro/rosca', surf: 'Textura superficial', weld: 'Símbolo de soldadura',
  datum: 'Identificador de referencia', target: 'Objetivo de referencia', fcf: 'Marco de control', tolfeat: 'Tolerancia de operación', profile: 'Nota de perfil general',
};
/** Símbolos de tolerancia geométrica ISO 1101 */
export const GDT: [string, string][] = [
  ['⏤', 'Rectitud'], ['⏥', 'Planitud'], ['○', 'Redondez'], ['⌭', 'Cilindricidad'], ['⌒', 'Forma de línea'], ['⌓', 'Forma de superficie'],
  ['∥', 'Paralelismo'], ['⟂', 'Perpendicularidad'], ['∠', 'Inclinación'], ['⌖', 'Posición'], ['◎', 'Concentricidad'], ['⌯', 'Simetría'], ['↗', 'Oscilación circular'], ['⌰', 'Oscilación total'],
];
export const pmiText = (a: Pmi, dist?: number, dec = 2): string => {
  const f = (x: number) => x.toFixed(dec).replace('.', ',');
  switch (a.kind) {
    case 'dim': return `${a.text ? a.text + ' ' : ''}${dist != null ? f(dist) : ''}${a.tol ? ' ' + a.tol : ''}`;
    case 'tolfeat': return `${a.text ?? ''}${a.tol ? ' ' + a.tol : ''}`;
    case 'surf': return `√ Ra ${a.ra ?? '3,2'}${a.lay ? ' ' + a.lay : ''}`;
    case 'datum': return a.letter ?? 'A';
    case 'target': return `⊗ ${a.letter ?? 'A1'}${a.text ? ' ' + a.text : ''}`;
    case 'weld': return `◺ a${a.weld?.a ?? '4'}${a.weld?.l ? ' × ' + a.weld.l : ''}${a.weld?.around ? ' ○' : ''}${a.weld?.field ? ' ⚑' : ''}`;
    case 'fcf': return `${a.sym ?? '⌖'} | ${a.val ?? 'Ø0,1'}${a.datums ? ' | ' + a.datums.split(/[ ,|]+/).filter(Boolean).join(' | ') : ''}`;
    default: return a.text ?? '';
  }
};

export type LimitKind = 'mass' | 'volume' | 'area' | 'bx' | 'by' | 'bz' | 'dist';
export interface Limit { id: string; name: string; kind: LimitKind; min: string; max: string; p?: V3; p2?: V3 }
export const LIMIT_NAMES: Record<LimitKind, string> = { mass: 'Masa (kg)', volume: 'Volumen (mm³)', area: 'Área (mm²)', bx: 'Medida X (mm)', by: 'Medida Y (mm)', bz: 'Medida Z (mm)', dist: 'Distancia entre 2 puntos (mm)' };

export interface TolRow { name: string; nominal: number; up: number; lo: number; sign: 1 | -1 }
export interface TolStack { id: string; name: string; rows: TolRow[]; lsl?: number; usl?: number }
/** Cadena de cotas: peor caso y estadístico (RSS) */
export function stackResult(st: TolStack) {
  let max = 0, min = 0, mean = 0, rss = 0, nominal = 0;
  for (const r of st.rows) {
    nominal += r.sign * r.nominal;
    max += r.sign > 0 ? r.nominal + r.up : -(r.nominal + r.lo);
    min += r.sign > 0 ? r.nominal + r.lo : -(r.nominal + r.up);
    mean += r.sign * (r.nominal + (r.up + r.lo) / 2);
    rss += ((r.up - r.lo) / 2) ** 2;
  }
  const s = Math.sqrt(rss);
  return { nominal, max, min, mean, rssMax: mean + s, rssMin: mean - s };
}

export interface Rule { id: string; name: string; code: string; on: ('manual' | 'param' | 'save' | 'open' | 'trigger')[]; off?: boolean }
