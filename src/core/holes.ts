// Asistente de taladro y roscas: normas de rosca, holguras ISO 273 y dimensiones de escariado/avellanado por tipo de tornillo.
// Valores en mm. Diámetros de broca de roscar habituales (≈ d − p en métricas; tablas de taller en roscas de tubo).

export type ThreadStd = 'M' | 'MF' | 'UNC' | 'UNF' | 'G' | 'R' | 'NPT' | 'Tr' | 'BSW';
export const THREAD_STDS: [ThreadStd, string][] = [
  ['M', 'ISO métrica gruesa'], ['MF', 'ISO métrica fina'], ['UNC', 'UNC (unificada gruesa)'], ['UNF', 'UNF (unificada fina)'],
  ['G', 'G · BSP cilíndrica (ISO 228)'], ['R', 'R · BSPT cónica (ISO 7)'], ['NPT', 'NPT cónica (ANSI B1.20.1)'], ['Tr', 'Trapecial (ISO 2904)'], ['BSW', 'Whitworth BSW'],
];
export interface ThreadDef { std: ThreadStd; name: string; d: number; p: number; tap: number; taper?: boolean }

const IN = 25.4;
const M_COARSE: [string, number, number][] = [
  ['M1.6', 1.6, 0.35], ['M2', 2, 0.4], ['M2.5', 2.5, 0.45], ['M3', 3, 0.5], ['M4', 4, 0.7], ['M5', 5, 0.8], ['M6', 6, 1], ['M8', 8, 1.25], ['M10', 10, 1.5],
  ['M12', 12, 1.75], ['M14', 14, 2], ['M16', 16, 2], ['M18', 18, 2.5], ['M20', 20, 2.5], ['M22', 22, 2.5], ['M24', 24, 3], ['M27', 27, 3], ['M30', 30, 3.5],
  ['M33', 33, 3.5], ['M36', 36, 4], ['M42', 42, 4.5], ['M48', 48, 5], ['M56', 56, 5.5], ['M64', 64, 6],
];
const M_FINE: [number, number][] = [[8, 1], [10, 1], [10, 1.25], [12, 1.25], [12, 1.5], [14, 1.5], [16, 1.5], [18, 1.5], [20, 1.5], [20, 2], [22, 1.5], [24, 2], [27, 2], [30, 2], [33, 2], [36, 3], [42, 3], [48, 3]];
const UNC: [string, number, number][] = [['#4-40', 0.112, 40], ['#6-32', 0.138, 32], ['#8-32', 0.164, 32], ['#10-24', 0.19, 24], ['1/4-20', 0.25, 20], ['5/16-18', 0.3125, 18], ['3/8-16', 0.375, 16], ['7/16-14', 0.4375, 14], ['1/2-13', 0.5, 13], ['5/8-11', 0.625, 11], ['3/4-10', 0.75, 10], ['7/8-9', 0.875, 9], ['1-8', 1, 8]];
const UNF: [string, number, number][] = [['#4-48', 0.112, 48], ['#6-40', 0.138, 40], ['#8-36', 0.164, 36], ['#10-32', 0.19, 32], ['1/4-28', 0.25, 28], ['5/16-24', 0.3125, 24], ['3/8-24', 0.375, 24], ['7/16-20', 0.4375, 20], ['1/2-20', 0.5, 20], ['5/8-18', 0.625, 18], ['3/4-16', 0.75, 16], ['7/8-14', 0.875, 14], ['1-12', 1, 12]];
// tubo: [tamaño, Ø exterior mm, hilos por pulgada, broca G, broca R/BSPT, broca NPT]
const PIPE: [string, number, number, number, number][] = [
  ['1/8', 9.728, 28, 8.8, 8.4], ['1/4', 13.157, 19, 11.8, 11.2], ['3/8', 16.662, 19, 15.25, 14.75], ['1/2', 20.955, 14, 19, 18.25], ['3/4', 26.441, 14, 24.5, 23.75],
  ['1', 33.249, 11, 30.75, 30], ['1-1/4', 41.91, 11, 39.5, 38.5], ['1-1/2', 47.803, 11, 45.25, 44.5], ['2', 59.614, 11, 57, 56],
];
const NPT: [string, number, number, number][] = [
  ['1/8', 10.287, 27, 8.4], ['1/4', 13.716, 18, 11.1], ['3/8', 17.145, 18, 14.3], ['1/2', 21.336, 14, 18], ['3/4', 26.67, 14, 23],
  ['1', 33.401, 11.5, 29], ['1-1/4', 42.164, 11.5, 38], ['1-1/2', 48.26, 11.5, 44], ['2', 60.325, 11.5, 56],
];
const TR: [number, number][] = [[10, 2], [12, 3], [16, 4], [20, 4], [24, 5], [28, 5], [32, 6], [36, 6], [40, 7], [50, 8]];
const BSW: [string, number, number][] = [['1/4', 0.25, 20], ['5/16', 0.3125, 18], ['3/8', 0.375, 16], ['1/2', 0.5, 12], ['5/8', 0.625, 11], ['3/4', 0.75, 10], ['1', 1, 8]];

const r1 = (x: number) => Math.round(x * 10) / 10;
export const THREADS: ThreadDef[] = [
  ...M_COARSE.map(([n, d, p]) => ({ std: 'M' as const, name: `${n}x${p}`, d, p, tap: r1(d - p) })),
  ...M_FINE.map(([d, p]) => ({ std: 'MF' as const, name: `M${d}x${p}`, d, p, tap: r1(d - p) })),
  ...UNC.map(([n, d, t]) => ({ std: 'UNC' as const, name: `${n} UNC`, d: d * IN, p: IN / t, tap: r1(d * IN - (IN / t) * 1.0825) })),
  ...UNF.map(([n, d, t]) => ({ std: 'UNF' as const, name: `${n} UNF`, d: d * IN, p: IN / t, tap: r1(d * IN - (IN / t) * 1.0825) })),
  ...PIPE.map(([n, d, t, g]) => ({ std: 'G' as const, name: `G${n}`, d, p: IN / t, tap: g })),
  ...PIPE.map(([n, d, t, , r]) => ({ std: 'R' as const, name: `R${n}`, d, p: IN / t, tap: r, taper: true })),
  ...NPT.map(([n, d, t, b]) => ({ std: 'NPT' as const, name: `${n} NPT`, d, p: IN / t, tap: b, taper: true })),
  ...TR.map(([d, p]) => ({ std: 'Tr' as const, name: `Tr${d}x${p}`, d, p, tap: d - p })),
  ...BSW.map(([n, d, t]) => ({ std: 'BSW' as const, name: `${n} BSW`, d: d * IN, p: IN / t, tap: r1(d * IN - (IN / t) * 1.28) })),
];
export const threadsOf = (std: ThreadStd) => THREADS.filter((t) => t.std === std);
/** Busca una rosca por su designación (admite el formato antiguo «M10x1.5») */
export function threadByName(name: string | undefined): ThreadDef | undefined {
  if (!name) return undefined;
  const t = THREADS.find((x) => x.name === name); if (t) return t;
  const m = /^M(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?$/i.exec(name.trim());
  if (m) { const d = +m[1], p = m[2] ? +m[2] : M_COARSE.find((x) => x[1] === d)?.[2]; if (p) return { std: 'M', name: `M${d}x${p}`, d, p, tap: r1(d - p) }; }
  return undefined;
}
/** Paso (mm) de una designación de rosca */
export const threadPitch = (name: string) => threadByName(name)?.p ?? (parseFloat(name.split(/x/i)[1] ?? '') || 1.5);

// ---------- Holguras ISO 273 (ajustado / normal / holgado) ----------
export type Fit = 'close' | 'normal' | 'loose';
export const FIT_NAMES: Record<Fit, string> = { close: 'Ajustado', normal: 'Normal', loose: 'Holgado' };
const ISO273: Record<number, [number, number, number]> = {
  1.6: [1.7, 1.8, 2], 2: [2.2, 2.4, 2.6], 2.5: [2.7, 2.9, 3.1], 3: [3.2, 3.4, 3.6], 4: [4.3, 4.5, 4.8], 5: [5.3, 5.5, 5.8], 6: [6.4, 6.6, 7], 8: [8.4, 9, 10],
  10: [10.5, 11, 12], 12: [13, 13.5, 14.5], 14: [15, 15.5, 16.5], 16: [17, 17.5, 18.5], 18: [19, 20, 21], 20: [21, 22, 24], 22: [23, 24, 26], 24: [25, 26, 28],
  27: [28, 30, 32], 30: [31, 33, 35], 33: [34, 36, 38], 36: [37, 39, 42], 42: [43, 45, 48], 48: [50, 52, 56], 56: [58, 62, 66], 64: [66, 70, 74],
};
export function clearance(d: number, fit: Fit): number {
  const row = ISO273[d]; const i = fit === 'close' ? 0 : fit === 'normal' ? 1 : 2;
  if (row) return row[i];
  return r1(d + (fit === 'close' ? 0.4 : fit === 'normal' ? 0.8 : 1.6) + d * 0.02); // tornillos en pulgadas
}

// ---------- Escariados (cabeza cilíndrica) y avellanados (cabeza avellanada) ----------
export type Fastener = 'iso4762' | 'din7984' | 'iso4017' | 'iso10642' | 'iso7046' | 'iso2009';
export const FASTENERS: Record<Fastener, { name: string; kind: 'cbore' | 'csink' }> = {
  iso4762: { name: 'ISO 4762 · Allen cabeza cilíndrica', kind: 'cbore' },
  din7984: { name: 'DIN 7984 · Allen cabeza baja', kind: 'cbore' },
  iso4017: { name: 'ISO 4017 · hexagonal (con llave de vaso)', kind: 'cbore' },
  iso10642: { name: 'ISO 10642 · Allen avellanado 90°', kind: 'csink' },
  iso7046: { name: 'ISO 7046 · avellanado Phillips 90°', kind: 'csink' },
  iso2009: { name: 'ISO 2009 · avellanado ranurado 90°', kind: 'csink' },
};
// [Ø escariado, profundidad] DIN 974-1 para ISO 4762
const CB4762: Record<number, [number, number]> = { 3: [6.5, 3.4], 4: [8, 4.4], 5: [10, 5.4], 6: [11, 6.4], 8: [15, 8.6], 10: [18, 10.6], 12: [20, 12.6], 14: [24, 14.6], 16: [26, 16.6], 18: [29, 18.6], 20: [33, 20.6], 22: [36, 22.8], 24: [40, 24.8], 27: [46, 27.8], 30: [48, 30.8], 36: [57, 37] };
const K7984: Record<number, number> = { 3: 2, 4: 2.8, 5: 3.5, 6: 4, 8: 5, 10: 6, 12: 7, 14: 8, 16: 9, 20: 11, 24: 13 };
const E4017: Record<number, [number, number]> = { 3: [6.01, 2], 4: [7.66, 2.8], 5: [8.79, 3.5], 6: [11.05, 4], 8: [14.38, 5.3], 10: [17.77, 6.4], 12: [20.03, 7.5], 14: [23.36, 8.8], 16: [26.75, 10], 20: [33.53, 12.5], 24: [39.98, 15], 30: [50.85, 18.7], 36: [60.79, 22.5] };
const DK10642: Record<number, number> = { 3: 6.72, 4: 8.96, 5: 11.2, 6: 13.44, 8: 17.92, 10: 22.4, 12: 26.88, 14: 30.8, 16: 33.6, 20: 40.32, 24: 40.32 * 1.2 };
const DK7046: Record<number, number> = { 2: 3.8, 2.5: 4.7, 3: 5.5, 4: 8.4, 5: 9.3, 6: 11.3, 8: 15.8, 10: 18.3 };
/** Dimensiones de escariado para el tornillo: Ø y profundidad */
export function cboreFor(f: Fastener, d: number): [number, number] {
  if (f === 'din7984') { const c = CB4762[d] ?? [r1(1.8 * d), d]; return [c[0], r1((K7984[d] ?? 0.6 * d) + 0.4)]; }
  if (f === 'iso4017') { const e = E4017[d] ?? [1.85 * d, 0.63 * d]; return [Math.ceil(e[0] + 4), r1(e[1] + 0.4)]; }
  return CB4762[d] ?? [r1(1.65 * d + 1.5), r1(d + 0.6)];
}
/** Ø de avellanado (90°) para el tornillo */
export function csinkFor(f: Fastener, d: number): number {
  const dk = f === 'iso10642' ? DK10642[d] : DK7046[d];
  return r1((dk ?? 2 * d) + 0.4);
}
/** Diámetros nominales de tornillo disponibles (métricos) */
export const SCREW_SIZES = [1.6, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 27, 30, 33, 36, 42, 48];

// ---------- Tipos de taladro (asistente) ----------
export type HoleType = 'simple' | 'cbore' | 'csink' | 'tap' | 'ptap' | 'legacy' | 'slot' | 'cbslot' | 'csslot' | 'adv';
export const HOLE_TYPES: [HoleType, string, string][] = [
  ['cbore', 'Escariado', 'Cabeza cilíndrica embutida (Allen, hexagonal)'],
  ['csink', 'Avellanado', 'Cabeza avellanada a 90°'],
  ['simple', 'Taladro', 'Paso o ciego, con holgura ISO 273 o diámetro libre'],
  ['tap', 'Taladro roscado', 'Broca de roscar y rosca (métrica, UNC/UNF, G, Tr…), con rosca cosmética'],
  ['ptap', 'Roscado cónico', 'Rosca de tubo cónica NPT o R (BSPT), conicidad 1:16'],
  ['legacy', 'Heredado', 'Taladro definido a mano: simple, escariado, avellanado o abocardado'],
  ['cbslot', 'Ranura escariada', 'Ranura con escariado para la cabeza'],
  ['csslot', 'Ranura avellanada', 'Ranura con avellanado para la cabeza'],
  ['slot', 'Ranura', 'Agujero coliso (ranura recta)'],
  ['adv', 'Taladro avanzado', 'Escalonado: elemento del lado cercano (escariado o avellanado) + taladro + segundo diámetro'],
];
