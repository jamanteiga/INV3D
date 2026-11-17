// Tornillería y juntas normalizadas (ASME y EN/ISO) y cálculo de fijaciones.
//  EN/ISO: tornillo ISO 4014/4017, espárrago (varilla roscada DIN 976-1 / EN 1515-1), tuerca ISO 4032, arandela ISO 7089,
//          juntas EN 1514-1 (plana IBC) y EN 1514-2 (espirometálica).
//  ASME:   tornillo hexagonal pesado B18.2.1, espárrago B18.31.2 (bridas B16.5), tuerca hexagonal pesada B18.2.2 (2H),
//          arandela ASTM F436, juntas B16.21 (plana) y B16.20 (espirometálica).
import { newDoc, type PartDoc, type SkEntity, type V3 } from './doc';
import { flangeDims } from './piping';
import { b165Sizes, B165_CLASSES, type FlangeDims } from './pipedata';

const IN = 25.4;
const r2 = (x: number) => Math.round(x * 100) / 100;

export type FStd = 'EN' | 'ASME';
/** Medidas comunes en mm: d nominal, p paso, s entrecaras, k altura de cabeza, m altura de tuerca, dw/dwi arandela ext./int., h espesor arandela */
export interface FSize { name: string; d: number; p: number; s: number; k: number; m: number; dw: number; dwi: number; h: number; thread: string; hole: number }

/** ISO: [d, p, s, k, m (ISO 4032), d2 arandela, h arandela, d1 arandela] */
const ISO: Record<string, [number, number, number, number, number, number, number, number]> = {
  M6: [6, 1, 10, 4, 5.2, 12, 1.6, 6.4], M8: [8, 1.25, 13, 5.3, 6.8, 16, 1.6, 8.4], M10: [10, 1.5, 16, 6.4, 8.4, 20, 2, 10.5],
  M12: [12, 1.75, 18, 7.5, 10.8, 24, 2.5, 13], M14: [14, 2, 21, 8.8, 12.8, 28, 2.5, 15], M16: [16, 2, 24, 10, 14.8, 30, 3, 17],
  M20: [20, 2.5, 30, 12.5, 18, 37, 3, 21], M22: [22, 2.5, 34, 14, 19.4, 39, 3, 23], M24: [24, 3, 36, 15, 21.5, 44, 4, 25],
  M27: [27, 3, 41, 17, 23.8, 50, 4, 28], M30: [30, 3.5, 46, 18.7, 25.6, 56, 4, 31], M33: [33, 3.5, 50, 21, 28.7, 60, 5, 34],
  M36: [36, 4, 55, 22.5, 31, 66, 5, 37], M39: [39, 4, 60, 25, 33.4, 72, 6, 42], M42: [42, 4.5, 65, 26, 34, 78, 8, 45],
  M45: [45, 4.5, 70, 28, 36, 85, 8, 48], M48: [48, 5, 75, 30, 38, 92, 8, 50], M52: [52, 5, 80, 33, 42, 98, 10, 54],
  M56: [56, 5.5, 85, 35, 45, 105, 10, 58], M64: [64, 6, 95, 40, 51, 115, 10, 66],
};
const holeISO = (d: number) => d + (d <= 10 ? 1 : d <= 24 ? 2 : 3);

/** ASME (pulgadas): [nombre, D, hilos/pulgada, altura cabeza tornillo pesado B18.2.1, Ø ext. arandela F436] */
const ASME: [string, number, number, number, number][] = [
  ['1/2', 0.5, 13, 11 / 32, 1.063], ['5/8', 0.625, 11, 27 / 64, 1.313], ['3/4', 0.75, 10, 1 / 2, 1.469], ['7/8', 0.875, 9, 37 / 64, 1.75],
  ['1', 1, 8, 43 / 64, 2], ['1-1/8', 1.125, 8, 3 / 4, 2.25], ['1-1/4', 1.25, 8, 27 / 32, 2.5], ['1-3/8', 1.375, 8, 29 / 32, 2.75],
  ['1-1/2', 1.5, 8, 1, 3], ['1-5/8', 1.625, 8, 1.09, 3.25], ['1-3/4', 1.75, 8, 1.17, 3.375], ['1-7/8', 1.875, 8, 1.25, 3.5],
  ['2', 2, 8, 1.33, 3.75], ['2-1/4', 2.25, 8, 1.5, 4], ['2-1/2', 2.5, 8, 1.66, 4.5], ['2-3/4', 2.75, 8, 1.83, 4.75],
  ['3', 3, 8, 2, 5.25], ['3-1/4', 3.25, 8, 2.16, 5.5], ['3-1/2', 3.5, 8, 2.33, 6], ['3-3/4', 3.75, 8, 2.5, 6.25], ['4', 4, 8, 2.66, 6.5],
];

export const FASTENER_SIZES: Record<FStd, string[]> = { EN: Object.keys(ISO), ASME: ASME.map((a) => `${a[0]}"`) };

export function fsize(std: FStd, size: string): FSize | null {
  if (std === 'EN') {
    const r = ISO[size]; if (!r) return null;
    const [d, p, s, k, m, d2, h, d1] = r;
    return { name: size, d, p, s, k, m, dw: d2, dwi: d1, h, thread: `${size}x${p}`, hole: holeISO(d) };
  }
  const a = ASME.find((x) => `${x[0]}"` === size || x[0] === size); if (!a) return null;
  const [n, D, tpi, Hb, OD] = a;
  const F = 1.5 * D + 0.125;                                       // entrecaras hexagonal pesado (tornillo y tuerca)
  const Hn = D <= 1.125 ? D - 1 / 64 : D - 1 / 32;                 // altura tuerca hexagonal pesada B18.2.2
  const ID = D <= 0.625 ? D + 1 / 32 : D <= 0.875 ? D + 1 / 16 : D + 1 / 8;   // F436
  const T = D <= 1.5 ? 0.156 : 0.25;                               // F436 espesor nominal
  const thread = D <= 1 ? `${n}-${tpi} UNC` : `${n}-8 UN`;
  return { name: `${n}"`, d: r2(D * IN), p: r2(IN / tpi), s: r2(F * IN), k: r2(Hb * IN), m: r2(Hn * IN), dw: r2(OD * IN), dwi: r2(ID * IN), h: r2(T * IN), thread, hole: r2((D + (D < 1.75 ? 0.125 : 0.25)) * IN) };
}

/** Saliente mínimo por encima de la tuerca: 2 hilos (ASME) o 10 mm (métrica) */
export const projection = (std: FStd, f: FSize) => (std === 'ASME' ? 2 * f.p : 10);

const ISO_LEN = [10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200, 220, 240, 260, 280, 300, 320, 340, 360, 380, 400, 420, 440, 460, 480, 500];
/** Longitud comercial ≥ need: métrica (serie ISO 4014 para tornillos, de 5 en 5 mm para espárragos); ASME de 1/4" en 1/4" */
export function roundLength(std: FStd, kind: 'bolt' | 'stud', need: number): number {
  if (std === 'ASME') return r2(Math.ceil(need / (IN / 4) - 1e-6) * (IN / 4));
  if (kind === 'stud') return Math.ceil(need / 5 - 1e-6) * 5;
  return ISO_LEN.find((l) => l >= need - 1e-6) ?? Math.ceil(need / 20) * 20;
}
export const lengthLabel = (std: FStd, L: number) => {
  if (std === 'EN') return `${L}`;
  const q = Math.round(L / IN * 4), w = Math.floor(q / 4), f = q % 4;
  return `${w ? w : ''}${w && f ? '-' : ''}${f ? (f === 2 ? '1/2' : `${f}/4`) : ''}"`;
};

/** Métrica mayor que entra en un taladro de Ø dado */
export function sizeForHole(std: FStd, holeD: number): string | null {
  const list = FASTENER_SIZES[std].map((n) => fsize(std, n)!).filter((f) => f.d <= holeD - (std === 'EN' ? 0.9 : 1.5));
  return list.length ? list[list.length - 1].name : null;
}

// ---------- Piezas ----------
const XY = (offset = '0') => ({ kind: 'std' as const, name: 'XY' as const, offset });
const circle = (id: string, d: number | string): SkEntity => ({ id, type: 'circle', cx: '0', cy: '0', d: String(d) });
const hex = (id: string, s: number | string): SkEntity => ({ id, type: 'npoly', cx: '0', cy: '0', d: `${s} / cos(30)`, n: '6', rot: '30' });
function base(pn: string, desc: string, material: string): PartDoc {
  const d = newDoc();
  d.iProperties = { partNumber: pn, description: desc, designer: 'Centro de contenido', material, revision: '' };
  return d;
}
const MAT = 'Acero S275JR';

/** Tornillo hexagonal: cabeza en z ∈ [0, k], caña hacia −Z */
export function makeBolt(std: FStd, size: string, L: number, grade?: string): PartDoc {
  const f = fsize(std, size)!;
  const g = grade ?? (std === 'EN' ? '8.8' : 'A193 B7');
  const pn = std === 'EN' ? `ISO 4014 - ${size}x${L} - ${g}` : `ASME B18.2.1 HH - ${f.thread} x ${lengthLabel(std, L)} - ${g}`;
  const d = base(pn, std === 'EN' ? `Tornillo hexagonal ${size}×${L}` : `Tornillo hexagonal pesado ${f.name} × ${lengthLabel(std, L)}`, MAT);
  // longitud roscada: ISO 4014 b = 2d+6 (L ≤ 125), 2d+12 (L ≤ 200), 2d+25; ASME 2D + 1/4" (L ≤ 6"), 2D + 1/2"
  const b = std === 'EN' ? (L <= 125 ? 2 * f.d + 6 : L <= 200 ? 2 * f.d + 12 : 2 * f.d + 25) : (L <= 6 * IN ? 2 * f.d + 6.35 : 2 * f.d + 12.7);
  d.parameters = [{ name: 'd', expr: `${f.d} mm`, comment: 'Diámetro nominal' }, { name: 'L', expr: `${L} mm`, comment: 'Longitud' }, { name: 's', expr: `${f.s} mm`, comment: 'Entrecaras' }, { name: 'k', expr: `${f.k} mm`, comment: 'Altura de cabeza' }];
  d.features = [
    { id: 's1', name: 'Cabeza', type: 'sketch', plane: XY(), entities: [hex('h', 's')] },
    { id: 'f1', name: 'Extrusión1', type: 'extrude', profile: 's1', distance: 'k', dir: 'normal', op: 'join' },
    { id: 's2', name: 'Caña', type: 'sketch', plane: XY(), entities: [circle('c', 'd')] },
    { id: 'f2', name: 'Extrusión2', type: 'extrude', profile: 's2', distance: 'L', dir: 'reverse', op: 'join' },
    { id: 'f3', name: 'Chaflán1', type: 'chamfer', distance: `${r2(Math.max(0.5, f.p * 0.7))} mm`, edges: { mode: 'picked', points: [[f.d / 2, 0, -L]] } },
    { id: 'f4', name: 'Rosca1', type: 'thread', faces: [[f.d / 2, 0, -L / 2]], designation: f.thread, length: `${r2(Math.min(L, b))} mm`, full: L <= b },
  ] as PartDoc['features'];
  return d;
}

/** Espárrago totalmente roscado: z ∈ [0, L] */
export function makeStud(std: FStd, size: string, L: number, grade?: string): PartDoc {
  const f = fsize(std, size)!;
  const g = grade ?? (std === 'EN' ? '8.8' : 'A193 B7');
  const pn = std === 'EN' ? `Espárrago ${size}x${L} - ${g} (DIN 976-1 / EN 1515-1)` : `ASME B18.31.2 Stud ${f.thread} x ${lengthLabel(std, L)} - ${g}`;
  const d = base(pn, std === 'EN' ? `Espárrago ${size}×${L}` : `Espárrago ${f.name} × ${lengthLabel(std, L)}`, MAT);
  const c = r2(Math.max(0.5, f.p * 0.8));
  d.parameters = [{ name: 'd', expr: `${f.d} mm`, comment: 'Diámetro nominal' }, { name: 'L', expr: `${L} mm`, comment: 'Longitud' }];
  d.features = [
    { id: 's1', name: 'Caña', type: 'sketch', plane: XY(), entities: [circle('c', 'd')] },
    { id: 'f1', name: 'Extrusión1', type: 'extrude', profile: 's1', distance: 'L', dir: 'normal', op: 'join' },
    { id: 'f2', name: 'Chaflán1', type: 'chamfer', distance: `${c} mm`, edges: { mode: 'circle', points: [] } },
    { id: 'f3', name: 'Rosca1', type: 'thread', faces: [[f.d / 2, 0, L / 2]], designation: f.thread, length: `${L} mm`, full: true },
  ] as PartDoc['features'];
  return d;
}

/** Tuerca: z ∈ [0, m] */
export function makeNut(std: FStd, size: string, grade?: string): PartDoc {
  const f = fsize(std, size)!;
  const g = grade ?? (std === 'EN' ? '8' : 'A194 2H');
  const d = base(std === 'EN' ? `ISO 4032 - ${size} - ${g}` : `ASME B18.2.2 HH Nut - ${f.thread} - ${g}`, std === 'EN' ? `Tuerca hexagonal ${size}` : `Tuerca hexagonal pesada ${f.name}`, MAT);
  d.parameters = [{ name: 'd', expr: `${f.d} mm`, comment: '' }, { name: 's', expr: `${f.s} mm`, comment: 'Entrecaras' }, { name: 'm', expr: `${f.m} mm`, comment: 'Altura' }];
  d.features = [
    { id: 's1', name: 'Boceto1', type: 'sketch', plane: XY(), entities: [hex('h', 's'), circle('c', 'd')] },
    { id: 'f1', name: 'Extrusión1', type: 'extrude', profile: 's1', distance: 'm', dir: 'normal', op: 'join' },
    { id: 'f2', name: 'Rosca1', type: 'thread', faces: [[f.d / 2, 0, f.m / 2]], designation: f.thread, length: `${f.m} mm`, full: true },
  ] as PartDoc['features'];
  return d;
}

/** Arandela plana: z ∈ [0, h] */
export function makeWasher(std: FStd, size: string): PartDoc {
  const f = fsize(std, size)!;
  const d = base(std === 'EN' ? `ISO 7089 - ${f.d} - 200 HV` : `ASTM F436 - ${f.name}`, std === 'EN' ? `Arandela ${size}` : `Arandela endurecida ${f.name}`, MAT);
  d.parameters = [{ name: 'd1', expr: `${f.dwi} mm`, comment: 'Ø interior' }, { name: 'd2', expr: `${f.dw} mm`, comment: 'Ø exterior' }, { name: 'h', expr: `${f.h} mm`, comment: 'Espesor' }];
  d.features = [
    { id: 's1', name: 'Boceto1', type: 'sketch', plane: XY(), entities: [circle('c1', 'd2'), circle('c2', 'd1')] },
    { id: 'f1', name: 'Extrusión1', type: 'extrude', profile: 's1', distance: 'h', dir: 'normal', op: 'join' },
  ] as PartDoc['features'];
  return d;
}

// ---------- Juntas ----------
export type GasketType = 'flat' | 'spiral';
/** Tamaños de junta: «NPS 4 · Clase 150» (ASME B16.5) o «DN100 · PN16» (EN 1092-1) */
export function gasketSizes(std: FStd): string[] {
  if (std === 'ASME') return B165_CLASSES.filter((c) => c <= 2500).flatMap((c) => b165Sizes(c).map((n) => `NPS ${n} · Clase ${c}`));
  const out: string[] = [];
  for (const pn of [6, 10, 16, 25, 40, 63, 100]) for (const dn of [10, 15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600])
    if (flangeDims({ kind: 'flange', norm: 'EN', size: String(dn), rating: pn, flType: '11' } as never)) out.push(`DN${dn} · PN${pn}`);
  return out;
}
function gasketFlange(std: FStd, key: string): FlangeDims | null {
  const m = std === 'ASME' ? /^NPS (\S+) · Clase (\d+)/.exec(key) : /^DN(\d+) · PN(\d+)/.exec(key);
  if (!m) return null;
  return std === 'ASME' ? flangeDims({ kind: 'flange', norm: 'ASME', size: m[1], rating: +m[2], flType: 'WN', flStd: 'B16.5' } as never)
    : flangeDims({ kind: 'flange', norm: 'EN', size: m[1], rating: +m[2], flType: '11' } as never);
}
/** Bolt Ø en mm a partir de la designación de la brida (5/8" o M16) */
function boltDia(fd: FlangeDims): number {
  const b = fd.bolt.replace('"', '');
  if (/^M\d+/.test(b)) return Number(b.slice(1));
  const [w, fr] = b.includes('-') ? b.split('-') : /\//.test(b) ? ['0', b] : [b, ''];
  const [a, c] = fr ? fr.split('/').map(Number) : [0, 1];
  return (Number(w) + (fr ? a / c : 0)) * IN;
}
/** Junta (z ∈ [0, t]). Plana: Ø int. = Ø ext. del tubo, Ø ext. tangente a los pernos (B16.21 / EN 1514-1 IBC).
 *  Espirometálica: aro interior, espiral y aro de centrado (B16.20 / EN 1514-2) — medidas aproximadas a partir de la brida. */
export function makeGasket(std: FStd, key: string, type: GasketType, t: number): PartDoc {
  const fd = gasketFlange(std, key); if (!fd) throw new Error('Brida no encontrada para esa junta');
  const A = fd.pipeOD, bd = boltDia(fd), OD = r2(fd.bc - bd - (std === 'EN' ? 2 : 0));
  const stdName = type === 'flat' ? (std === 'ASME' ? 'ASME B16.21' : 'EN 1514-1 IBC') : (std === 'ASME' ? 'ASME B16.20' : 'EN 1514-2');
  const d = base(`${stdName} - ${key.replace(' · ', ' ')} - ${type === 'flat' ? `${t} mm` : 'SW'}`, `Junta ${type === 'flat' ? 'plana' : 'espirometálica'} ${key}`, type === 'flat' ? 'Caucho EPDM' : 'Acero inoxidable AISI 316L');
  if (type === 'flat') {
    d.parameters = [{ name: 'Di', expr: `${r2(A)} mm`, comment: 'Ø interior' }, { name: 'De', expr: `${OD} mm`, comment: 'Ø exterior (centrada en los pernos)' }, { name: 't', expr: `${t} mm`, comment: 'Espesor' }];
    d.features = [
      { id: 's1', name: 'Boceto1', type: 'sketch', plane: XY(), entities: [circle('c1', 'De'), circle('c2', 'Di')] },
      { id: 'f1', name: 'Extrusión1', type: 'extrude', profile: 's1', distance: 't', dir: 'normal', op: 'join' },
    ] as PartDoc['features'];
    return d;
  }
  // espirometálica: espiral de espesor t (4,5 mm típico) y aros de 3,2 mm centrados en su espesor
  const wID = r2(A + 6.35), wOD = r2(Math.max(wID + 12, fd.rf - 8)), iID = r2(A - 9.5), ring = 3.2, z0 = r2((t - ring) / 2);
  d.parameters = [{ name: 'Dri', expr: `${iID} mm`, comment: 'Ø int. aro interior' }, { name: 'Dwi', expr: `${wID} mm`, comment: 'Ø int. espiral' }, { name: 'Dwe', expr: `${wOD} mm`, comment: 'Ø ext. espiral' }, { name: 'Dc', expr: `${OD} mm`, comment: 'Ø ext. aro de centrado' }, { name: 't', expr: `${t} mm`, comment: 'Espesor de la espiral' }];
  d.features = [
    { id: 's1', name: 'Espiral', type: 'sketch', plane: XY(), entities: [circle('c1', 'Dwe'), circle('c2', 'Dwi')] },
    { id: 'f1', name: 'Extrusión1', type: 'extrude', profile: 's1', distance: 't', dir: 'normal', op: 'join' },
    { id: 's2', name: 'Aros', type: 'sketch', plane: XY(String(z0)), entities: [circle('c3', 'Dc'), circle('c4', 'Dwe'), circle('c5', 'Dwi'), circle('c6', 'Dri')] },
    { id: 'f2', name: 'Extrusión2', type: 'extrude', profile: 's2', distance: `${ring} mm`, dir: 'normal', op: 'join' },
  ] as PartDoc['features'];
  return d;
}

// ---------- Fijación (conjunto) ----------
export type FixKind = 'bolt' | 'stud';
export interface FixPlan {
  std: FStd; size: string; kind: FixKind; L: number; lengthLbl: string; projection: number; minProj: number;
  /** piezas desde el lado de inicio hacia fuera / dentro, con su posición a lo largo del eje (z0 desde la cara de inicio, positivo hacia fuera) y su orientación */
  items: { part: 'bolt' | 'stud' | 'nut' | 'washer'; z0: number; outward: boolean }[];
}
/** Plan de una fijación para un espesor a abarcar «grip» (incluida la junta si se indica aparte en gasket).
 *  bolt: [arandela bajo cabeza] + tornillo + arandela + tuerca · stud: tuerca + arandela + espárrago + arandela + tuerca. */
export function planFix(std: FStd, size: string, kind: FixKind, grip: number, gasket: number, headWasher: boolean): FixPlan | null {
  const f = fsize(std, size); if (!f) return null;
  const minProj = projection(std, f), G = grip + gasket;
  const items: FixPlan['items'] = [];
  if (kind === 'bolt') {
    const hw = headWasher ? f.h : 0;
    const need = hw + G + f.h + f.m + minProj;
    const L = roundLength(std, 'bolt', need);
    if (headWasher) items.push({ part: 'washer', z0: 0, outward: true });
    items.push({ part: 'bolt', z0: hw, outward: true });                       // cara de apoyo de la cabeza
    items.push({ part: 'washer', z0: -G, outward: false }, { part: 'nut', z0: -G - f.h, outward: false });
    return { std, size: f.name, kind, L, lengthLbl: lengthLabel(std, L), projection: r2(L - (need - minProj)), minProj, items };
  }
  const need = G + 2 * (f.h + f.m + minProj);
  const L = roundLength(std, 'stud', need);
  const extra = (L - need) / 2, out = f.h + f.m + minProj + extra;
  items.push({ part: 'washer', z0: 0, outward: true }, { part: 'nut', z0: f.h, outward: true });
  items.push({ part: 'stud', z0: out, outward: false });                        // el espárrago empieza fuera y entra
  items.push({ part: 'washer', z0: -G, outward: false }, { part: 'nut', z0: -G - f.h, outward: false });
  return { std, size: f.name, kind, L, lengthLbl: lengthLabel(std, L), projection: r2(minProj + extra), minProj, items };
}

/** Cuaternión [x,y,z,w] que lleva +Z a v (unitario) */
export function quatZTo(v: V3): [number, number, number, number] {
  const [x, y, z] = v;
  if (z < -0.999999) return [1, 0, 0, 0];
  const q: [number, number, number, number] = [-y, x, 0, 1 + z];
  const n = Math.hypot(...q); return q.map((c) => c / n) as [number, number, number, number];
}
