// Generador de tubería: tubos, bridas y accesorios como piezas paramétricas INV3D.
import { newDoc, type PartDoc, type SkEntity, type Feature } from './doc';
import {
  ASME_PIPE, pipeOD, pipeWall, EN_OD, EN_S, b165, b1647, en1092, B169, REDUCER_H, RTEE_M, B1611, DN_NPS, EN3D_R, NPS_DN,
  type FlangeDims, type ENType,
} from './pipedata';

export type PipeKind = 'pipe' | 'flange' | 'elbow' | 'tee' | 'rtee' | 'cross' | 'reducer' | 'cap' | 'stub' | 'coupling';
export type FlangeStd = 'B16.5' | 'B16.47A' | 'B16.47B' | 'EN1092';
export type AsmeFlType = 'WN' | 'SO' | 'BL' | 'LJ' | 'SW' | 'TH';
export interface PipeSpec {
  kind: PipeKind; norm: 'ASME' | 'EN';
  /** NPS (ASME, p. ej. "4") o DN (EN, p. ej. "100") */
  size: string;
  /** Segundo tamaño: salida de te reducida o extremo pequeño de reducción */
  size2?: string;
  sch?: string; wall?: number; wall2?: number;
  length?: number;
  flStd?: FlangeStd; rating?: number; flType?: string; facing?: 'RF' | 'FF';
  elbow?: 'LR' | 'SR' | '3D' | '5D'; angle?: 45 | 90 | 180;
  ecc?: boolean;
  cls?: 3000 | 6000; sw?: boolean; half?: boolean;
  material: string;
}

const f1 = (x: number) => String(Math.round(x * 1000) / 1000);
const XY = (o = 0) => ({ kind: 'std' as const, name: 'XY' as const, offset: f1(o) });
const XZ = { kind: 'std' as const, name: 'XZ' as const, offset: '0' };
const YZ = { kind: 'std' as const, name: 'YZ' as const, offset: '0' };
const circ = (id: string, d: number | string, cx: number | string = 0, cy: number | string = 0): SkEntity => ({ id, type: 'circle', cx: String(cx), cy: String(cy), d: String(d) });
const poly = (id: string, pts: [number, number][]): SkEntity => ({ id, type: 'poly', pts: pts.map(([x, y]) => [f1(x), f1(y)]) });

/** Diámetro exterior y espesor del tubo para un tamaño. */
export function od(spec: Pick<PipeSpec, 'norm'>, size: string): number { return spec.norm === 'ASME' ? pipeOD(size) : EN_OD[Number(size)] ?? 0; }
export function wallOf(spec: Pick<PipeSpec, 'norm' | 'sch' | 'wall'>, size: string, second = false): number {
  if (spec.norm === 'ASME') return pipeWall(size, spec.sch ?? 'STD');
  const w = second ? undefined : spec.wall;
  return w && w > 0 ? w : EN_S[Number(size)] ?? 3;
}
/** Datos de accesorios B16.9 (EN 10253 usa las mismas medidas de referencia por DN). */
const fit = (spec: PipeSpec, size: string) => B169[spec.norm === 'ASME' ? size : DN_NPS[Number(size)] ?? ''];
const npsOf = (spec: PipeSpec, size: string) => (spec.norm === 'ASME' ? size : DN_NPS[Number(size)] ?? '');
const label = (spec: PipeSpec, size: string) => (spec.norm === 'ASME' ? `${size}"` : `DN${size}`);
const wallLabel = (spec: PipeSpec) => (spec.norm === 'ASME' ? `Sch ${spec.sch ?? 'STD'}` : `${wallOf(spec, spec.size)} mm`);

function base(pn: string, desc: string, material: string): PartDoc {
  const d = newDoc();
  d.iProperties = { partNumber: pn, description: desc, designer: 'Centro de contenido · Tubería', material, revision: '' };
  return d;
}

// ---------- Bridas ----------
export function flangeDims(spec: PipeSpec): FlangeDims | null {
  const t = spec.flType ?? 'WN';
  switch (spec.flStd ?? (spec.norm === 'EN' ? 'EN1092' : 'B16.5')) {
    case 'B16.5': return b165(spec.rating ?? 150, spec.size);
    case 'B16.47A': return b1647('A', spec.rating ?? 150, spec.size, t === 'BL');
    case 'B16.47B': return b1647('B', spec.rating ?? 150, spec.size, t === 'BL');
    default: return en1092(spec.rating ?? 16, Number(spec.size), t as ENType);
  }
}

function makeFlange(spec: PipeSpec): PartDoc {
  const fd = flangeDims(spec);
  if (!fd) throw new Error('Esa combinación de tamaño y clase no existe en la norma');
  const enStd = (spec.flStd ?? 'EN1092') === 'EN1092' && spec.norm === 'EN';
  const type = spec.flType ?? (enStd ? '11' : 'WN');
  const kind: AsmeFlType = enStd ? ({ '01': 'SO', '05': 'BL', '11': 'WN', '12': 'SO', '13': 'TH' } as Record<string, AsmeFlType>)[type] ?? 'WN' : (type as AsmeFlType);
  const plateOnly = enStd && type === '01';
  const ff = spec.facing === 'FF' || kind === 'LJ';
  const A = fd.pipeOD, t = wallOf(spec, spec.size);
  const rfH = ff ? 0 : fd.rfH;
  const plate = fd.tf - (fd.rfIncluded ? fd.rfH : 0);
  const zb = rfH + plate; // cara posterior del plato
  const R = fd.D / 2, X = fd.hubX / 2;
  const bore = kind === 'WN' ? A / 2 - t : kind === 'BL' ? 0 : kind === 'LJ' ? A / 2 + 1.5 : kind === 'TH' ? A / 2 - 0.8 : A / 2 + (A < 100 ? 0.4 : A < 300 ? 1.1 : 2);
  const zEnd = kind === 'WN' ? Math.max(fd.Y, zb + 3) : kind === 'BL' || plateOnly ? zb : Math.max(fd.ySO, zb + 2);
  const pts: [number, number][] = [];
  // cara de junta
  if (bore > 0) pts.push([bore, 0]); else pts.push([0, 0]);
  if (rfH > 0) { pts.push([fd.rf / 2, 0], [fd.rf / 2, rfH]); }
  pts.push([R, rfH], [R, zb]);
  if (zEnd > zb + 0.01) {
    if (kind === 'WN') { const xs = Math.max(X, A / 2 + 2); pts.push([xs, zb], [A / 2, zEnd]); }
    else pts.push([Math.max(X, bore + 3), zb], [Math.max(X, bore + 3) - (kind === 'LJ' ? 0 : 1), zEnd]);
  }
  if (bore > 0) {
    if (kind === 'SW') {
      // encaje para soldar: alojamiento del tubo + paso al diámetro interior
      // el tubo entra por detrás hasta el fondo del encaje; por la cara queda el diámetro interior
      const J = Math.min(B1611[spec.size]?.[3] ?? 13, zEnd - 2), ri = A / 2 - t;
      pts.push([A / 2 + 0.4, zEnd], [A / 2 + 0.4, zEnd - J], [ri, zEnd - J]);
      pts[0] = [ri, 0];
    } else pts.push([bore, zEnd]);
  } else pts.push([0, zEnd]);
  const holes: SkEntity[] = Array.from({ length: fd.n }, (_, i) => {
    const a = (Math.PI * 2 * (i + 0.5)) / fd.n;
    return circ(`h${i}`, 'Lt', `K/2*${f1(Math.cos(a))}`, `K/2*${f1(Math.sin(a))}`);
  });
  const nameType = enStd ? `Tipo ${type}` : ({ WN: 'cuello para soldar (WN)', SO: 'deslizante (SO)', BL: 'ciega (BL)', LJ: 'loca (LJ)', SW: 'socket weld (SW)', TH: 'roscada (TH)' } as Record<string, string>)[kind];
  const face = ff ? 'FF' : enStd ? 'B1' : 'RF';
  const pn = `${fd.std} ${fd.rating} ${fd.size} ${enStd ? type : kind}-${face}${kind === 'WN' ? ` ${wallLabel(spec)}` : ''}`;
  const d = base(pn, `Brida ${nameType} ${fd.size} ${fd.rating} ${face} · ${fd.std}`, spec.material);
  d.parameters = [
    { name: 'D', expr: `${fd.D} mm`, comment: 'Diámetro exterior' }, { name: 'C', expr: `${fd.tf} mm`, comment: 'Espesor' },
    { name: 'K', expr: `${fd.bc} mm`, comment: 'Círculo de pernos' }, { name: 'Lt', expr: `${fd.hole} mm`, comment: `Taladros (${fd.n} × ${fd.bolt})` },
    { name: 'n', expr: `${fd.n}`, comment: 'Nº de pernos' },
  ];
  d.features = [
    { id: 's1', name: 'Perfil', type: 'sketch', plane: XZ, entities: [poly('p', pts)] },
    { id: 'f1', name: 'Revolución1', type: 'revolve', profile: 's1', axis: 'sy', angle: '360 deg', op: 'join' },
    { id: 's2', name: 'Taladros', type: 'sketch', plane: XY(-1), entities: holes },
    { id: 'f2', name: 'Taladros', type: 'extrude', profile: 's2', distance: f1(zb + 2), dir: 'normal', op: 'cut' },
  ];
  return d;
}

// ---------- Tubo ----------
function makePipe(spec: PipeSpec): PartDoc {
  const D = od(spec, spec.size), t = wallOf(spec, spec.size), L = spec.length ?? 1000;
  if (!D) throw new Error('Tamaño no disponible');
  const std = spec.norm === 'ASME' ? 'ASME B36.10M/B36.19M' : 'EN 10220';
  const d = base(`Tubo ${label(spec, spec.size)} ${wallLabel(spec)} L=${L}`, `Tubo ${label(spec, spec.size)} Ø${D}×${t} ${std}`, spec.material);
  d.parameters = [{ name: 'OD', expr: `${D} mm`, comment: 'Diámetro exterior' }, { name: 't', expr: `${t} mm`, comment: 'Espesor' }, { name: 'L', expr: `${L} mm`, comment: 'Longitud' }];
  d.features = [
    { id: 's1', name: 'Sección', type: 'sketch', plane: XY(), entities: [circ('o', 'OD'), circ('i', 'OD - 2*t')] },
    { id: 'f1', name: 'Extrusión1', type: 'extrude', profile: 's1', distance: 'L', dir: 'normal', op: 'join' },
  ];
  return d;
}

// ---------- Codos ----------
function makeElbow(spec: PipeSpec): PartDoc {
  const D = od(spec, spec.size), t = wallOf(spec, spec.size), F = fit(spec, spec.size);
  if (!D || !F) throw new Error('Tamaño no disponible para codos');
  const type = spec.elbow ?? 'LR', ang = spec.angle ?? 90;
  let R = type === 'LR' || type === '3D' ? F[0] : type === 'SR' ? F[2] : 2.5 * D;
  if (type === '3D' && spec.norm === 'EN' && EN3D_R[Number(spec.size)]) R = EN3D_R[Number(spec.size)];
  if (type === '5D') R = Math.round(2.5 * D);
  if (!R) throw new Error('Codo de radio corto no normalizado para ese tamaño');
  const std = spec.norm === 'ASME' ? 'ASME B16.9' : 'EN 10253';
  const tname = { LR: 'radio largo (1,5D)', SR: 'radio corto (1D)', '3D': 'radio 3D', '5D': 'radio 5D (2,5·OD)' }[type];
  const d = base(`Codo ${ang}° ${type} ${label(spec, spec.size)} ${wallLabel(spec)}`, `Codo ${ang}° ${tname} ${label(spec, spec.size)} · ${std}`, spec.material);
  d.parameters = [{ name: 'OD', expr: `${D} mm`, comment: '' }, { name: 't', expr: `${t} mm`, comment: '' }, { name: 'R', expr: `${R} mm`, comment: 'Radio de curvatura' }, { name: 'ang', expr: `${ang} deg`, comment: '' }];
  d.features = [
    { id: 's1', name: 'Sección', type: 'sketch', plane: XY(), entities: [circ('o', 'OD'), circ('i', 'OD - 2*t'), { id: 'ax', type: 'line', a: ['R', '-10'], b: ['R', '10'], construction: true }] },
    { id: 'f1', name: 'Revolución1', type: 'revolve', profile: 's1', axis: 'ax', angle: 'ang', op: 'join' },
  ];
  return d;
}

// ---------- Tes y cruces ----------
function makeTee(spec: PipeSpec): PartDoc {
  const D = od(spec, spec.size), t = wallOf(spec, spec.size), F = fit(spec, spec.size);
  if (!D || !F) throw new Error('Tamaño no disponible para tes');
  const red = spec.kind === 'rtee' && spec.size2 && spec.size2 !== spec.size;
  const s2 = red ? spec.size2! : spec.size;
  const D2 = od(spec, s2), t2 = red ? wallOf(spec, s2, true) : t;
  const C = F[3];
  const M = red ? RTEE_M[`${npsOf(spec, spec.size)}x${npsOf(spec, s2)}`] ?? C : C;
  const cross = spec.kind === 'cross';
  const std = spec.norm === 'ASME' ? 'ASME B16.9' : 'EN 10253';
  const nm = cross ? 'Cruz' : red ? 'Te reducida' : 'Te';
  const sz = red ? `${label(spec, spec.size)}×${label(spec, s2)}` : label(spec, spec.size);
  const d = base(`${nm} ${sz} ${wallLabel(spec)}`, `${nm} ${sz} · ${std}`, spec.material);
  d.parameters = [
    { name: 'OD', expr: `${D} mm`, comment: 'Principal' }, { name: 't', expr: `${t} mm`, comment: '' }, { name: 'C', expr: `${C} mm`, comment: 'Centro a extremo (principal)' },
    { name: 'OD2', expr: `${D2} mm`, comment: 'Derivación' }, { name: 't2', expr: `${t2} mm`, comment: '' }, { name: 'M', expr: `${M} mm`, comment: 'Centro a extremo (derivación)' },
  ];
  const f: Feature[] = [
    { id: 's1', name: 'Principal', type: 'sketch', plane: YZ, entities: [circ('o', 'OD')] },
    { id: 'f1', name: 'Principal', type: 'extrude', profile: 's1', distance: '2*C', dir: 'symmetric', op: 'join' },
    { id: 's2', name: 'Derivación', type: 'sketch', plane: XY(), entities: [circ('o', 'OD2')] },
    { id: 'f2', name: 'Derivación', type: 'extrude', profile: 's2', distance: cross ? '2*M' : 'M', dir: cross ? 'symmetric' : 'normal', op: 'join' },
    { id: 's3', name: 'Paso principal', type: 'sketch', plane: YZ, entities: [circ('i', 'OD - 2*t')] },
    { id: 'f3', name: 'Paso principal', type: 'extrude', profile: 's3', distance: '2*C + 2', dir: 'symmetric', op: 'cut' },
    { id: 's4', name: 'Paso derivación', type: 'sketch', plane: XY(), entities: [circ('i', 'OD2 - 2*t2')] },
    { id: 'f4', name: 'Paso derivación', type: 'extrude', profile: 's4', distance: cross ? '2*M + 2' : 'M + 1', dir: cross ? 'symmetric' : 'normal', op: 'cut' },
  ];
  d.features = f;
  return d;
}

// ---------- Reducciones ----------
function makeReducer(spec: PipeSpec): PartDoc {
  const s2 = spec.size2;
  if (!s2) throw new Error('Elige el tamaño pequeño');
  const D1 = od(spec, spec.size), D2 = od(spec, s2), t1 = wallOf(spec, spec.size), t2 = spec.norm === 'EN' ? (spec.wall2 || EN_S[Number(s2)] || t1) : pipeWall(s2, spec.sch ?? 'STD');
  const H = REDUCER_H[npsOf(spec, spec.size)];
  if (!D1 || !D2 || !H) throw new Error('Reducción no normalizada');
  const std = spec.norm === 'ASME' ? 'ASME B16.9' : 'EN 10253';
  const nm = spec.ecc ? 'Reducción excéntrica' : 'Reducción concéntrica';
  const sz = `${label(spec, spec.size)}×${label(spec, s2)}`;
  const d = base(`${spec.ecc ? 'Red. exc.' : 'Red. conc.'} ${sz} ${wallLabel(spec)}`, `${nm} ${sz} · ${std}`, spec.material);
  d.parameters = [{ name: 'OD1', expr: `${D1} mm`, comment: '' }, { name: 't1', expr: `${t1} mm`, comment: '' }, { name: 'OD2', expr: `${D2} mm`, comment: '' }, { name: 't2', expr: `${t2} mm`, comment: '' }, { name: 'H', expr: `${H} mm`, comment: 'Longitud' }];
  if (!spec.ecc) {
    const a = Math.min(H * 0.15, 25), r1 = D1 / 2, r2 = D2 / 2;
    d.features = [
      { id: 's1', name: 'Perfil', type: 'sketch', plane: XZ, entities: [poly('p', [[r1 - t1, 0], [r1, 0], [r1, a], [r2, H - a], [r2, H], [r2 - t2, H], [r2 - t2, H - a], [r1 - t1, a]])] },
      { id: 'f1', name: 'Revolución1', type: 'revolve', profile: 's1', axis: 'sy', angle: '360 deg', op: 'join' },
    ];
  } else {
    const e = -(D1 - D2) / 2; // lado plano abajo (−Y)
    d.features = [
      { id: 's1', name: 'Extremo grande', type: 'sketch', plane: XY(), entities: [circ('o', 'OD1')] },
      { id: 's2', name: 'Extremo pequeño', type: 'sketch', plane: XY(H), entities: [circ('o', 'OD2', 0, f1(e))] },
      { id: 'f1', name: 'Solevación1', type: 'loft', sections: ['s1', 's2'], ruled: true, op: 'join' },
      { id: 's3', name: 'Interior grande', type: 'sketch', plane: XY(-0.5), entities: [circ('i', 'OD1 - 2*t1')] },
      { id: 's4', name: 'Interior pequeño', type: 'sketch', plane: XY(H + 0.5), entities: [circ('i', 'OD2 - 2*t2', 0, f1(e))] },
      { id: 'f2', name: 'Interior', type: 'loft', sections: ['s3', 's4'], ruled: true, op: 'cut' },
    ];
  }
  return d;
}

// ---------- Casquetes ----------
function makeCap(spec: PipeSpec): PartDoc {
  const D = od(spec, spec.size), t = wallOf(spec, spec.size), F = fit(spec, spec.size);
  if (!D || !F) throw new Error('Tamaño no disponible');
  const E = F[4], R = D / 2, b = Math.min(R / 2, E * 0.8), h = E - b;
  const pts: [number, number][] = [[R - t, 0], [R, 0], [R, h]];
  for (let i = 1; i <= 12; i++) { const a = (i / 12) * Math.PI / 2; pts.push([R * Math.cos(a), h + b * Math.sin(a)]); }
  const ri = R - t, bi = Math.max(b - t, 1);
  for (let i = 12; i >= 0; i--) { const a = (i / 12) * Math.PI / 2; pts.push([Math.max(0, ri * Math.cos(a)), h + bi * Math.sin(a)]); }
  pts[pts.length - 1] = [R - t, h];
  const fixed = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-3);
  const std = spec.norm === 'ASME' ? 'ASME B16.9' : 'EN 10253';
  const d = base(`Casquete ${label(spec, spec.size)} ${wallLabel(spec)}`, `Casquete (tapón) ${label(spec, spec.size)} · ${std}`, spec.material);
  d.parameters = [{ name: 'OD', expr: `${D} mm`, comment: '' }, { name: 'E', expr: `${E} mm`, comment: 'Longitud' }];
  d.features = [
    { id: 's1', name: 'Perfil', type: 'sketch', plane: XZ, entities: [poly('p', fixed)] },
    { id: 'f1', name: 'Revolución1', type: 'revolve', profile: 's1', axis: 'sy', angle: '360 deg', op: 'join' },
  ];
  return d;
}

// ---------- Portabridas (stub end) ----------
function makeStub(spec: PipeSpec): PartDoc {
  const D = od(spec, spec.size), t = wallOf(spec, spec.size), F = fit(spec, spec.size);
  if (!D || !F || !F[5]) throw new Error('Portabridas normalizados hasta 24"');
  const L = spec.length === 1 ? F[6] : F[5], G = F[7];
  const d = base(`Portabridas ${label(spec, spec.size)} ${spec.length === 1 ? 'corto' : 'largo'} ${wallLabel(spec)}`, `Portabridas (stub end) ${label(spec, spec.size)} · ASME B16.9`, spec.material);
  d.features = [
    { id: 's1', name: 'Perfil', type: 'sketch', plane: XZ, entities: [poly('p', [[D / 2 - t, 0], [G / 2, 0], [G / 2, t], [D / 2, t], [D / 2, L], [D / 2 - t, L]])] },
    { id: 'f1', name: 'Revolución1', type: 'revolve', profile: 's1', axis: 'sy', angle: '360 deg', op: 'join' },
  ];
  return d;
}

// ---------- Manguitos B16.11 ----------
function makeCoupling(spec: PipeSpec): PartDoc {
  const nps = npsOf(spec, spec.size), row = B1611[nps];
  if (!row) throw new Error('Manguitos forjados B16.11 hasta 4"');
  const A = pipeOD(nps), cls = spec.cls ?? 3000;
  const Do = cls === 6000 ? row[1] : row[0], Lf = row[2], J = row[3];
  const sw = !!spec.sw, half = !!spec.half;
  const L = sw ? (half ? J + 6 : 2 * J + 6.4) : half ? Lf / 2 : Lf;
  const ri = A / 2 - pipeWall(nps, cls === 6000 ? '160' : '80');
  const pts: [number, number][] = sw
    ? (half ? [[A / 2 + 0.4, 0], [Do / 2, 0], [Do / 2, L], [ri, L], [ri, J], [A / 2 + 0.4, J]]
      : [[A / 2 + 0.4, 0], [Do / 2, 0], [Do / 2, L], [A / 2 + 0.4, L], [A / 2 + 0.4, L - J], [ri, L - J], [ri, J], [A / 2 + 0.4, J]])
    : [[A / 2 - 0.8, 0], [Do / 2, 0], [Do / 2, L], [A / 2 - 0.8, L]];
  const nm = `${half ? 'Medio manguito' : 'Manguito'} ${sw ? 'socket weld' : 'roscado NPT'}`;
  const d = base(`${nm} ${spec.norm === 'ASME' ? `${nps}"` : `DN${spec.size}`} ${cls}#`, `${nm} ${nps}" clase ${cls} · ASME B16.11`, spec.material);
  d.features = [
    { id: 's1', name: 'Perfil', type: 'sketch', plane: XZ, entities: [poly('p', pts)] },
    { id: 'f1', name: 'Revolución1', type: 'revolve', profile: 's1', axis: 'sy', angle: '360 deg', op: 'join' },
  ];
  if (!sw) d.features.push({ id: 'th', name: 'Rosca NPT', type: 'thread', faces: [[A / 2 - 0.8, 0, L / 2]], designation: `${nps}" NPT`, length: f1(half ? L : L / 2), full: !!half });
  return d;
}

export function makePipePart(spec: PipeSpec): PartDoc {
  switch (spec.kind) {
    case 'pipe': return makePipe(spec);
    case 'flange': return makeFlange(spec);
    case 'elbow': return makeElbow(spec);
    case 'tee': case 'rtee': case 'cross': return makeTee(spec);
    case 'reducer': return makeReducer(spec);
    case 'cap': return makeCap(spec);
    case 'stub': return makeStub(spec);
    case 'coupling': return makeCoupling(spec);
  }
}

export const PIPE_KINDS: Record<PipeKind, string> = {
  pipe: 'Tubo', flange: 'Brida', elbow: 'Codo', tee: 'Te', rtee: 'Te reducida', cross: 'Cruz', reducer: 'Reducción', cap: 'Casquete', stub: 'Portabridas', coupling: 'Manguito',
};
export const ASME_SIZES = Object.keys(ASME_PIPE);
export { NPS_DN };
