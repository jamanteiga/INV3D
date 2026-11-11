// Cálculo a presión (orientativo; comprobar siempre con la edición vigente de cada norma):
// · espesor de tubo recto ASME B31.3 §304.1.2 y EN 13480-3 §6.1
// · presión-temperatura admisible de bridas ASME B16.5 (grupos 1.1, 2.2, 2.3) y EN 1092-1 (aprox. por Rp0,2(T))
// · refuerzo de derivaciones por compensación de áreas ASME B31.3 §304.3.3
// · luces máximas entre soportes (resistencia y flecha) con referencia MSS SP-58
// · recipientes EN 13445-3: virola §7.4, fondos toriesféricos y elípticos §7.5, prueba hidráulica y categoría PED (Directiva 2014/68/UE)

export interface MatStress { name: string; code: 'B31.3' | 'EN'; T: number[]; S: number[]; E: number }
const TT = [20, 100, 150, 200, 250, 300, 350, 400];
/** Tensión admisible S (B31.3, MPa) o tensión de diseño f (EN 13480 / 13445, MPa) a temperatura */
export const STRESS: MatStress[] = [
  { name: 'ASTM A106 Gr. B', code: 'B31.3', T: TT, S: [138, 138, 138, 138, 130, 119, 116, 90], E: 203e3 },
  { name: 'ASTM A53 Gr. B', code: 'B31.3', T: TT, S: [138, 138, 138, 138, 130, 119, 116, 90], E: 203e3 },
  { name: 'API 5L Gr. B', code: 'B31.3', T: TT, S: [138, 138, 138, 138, 130, 119, 116, 90], E: 203e3 },
  { name: 'ASTM A333 Gr. 6', code: 'B31.3', T: TT, S: [138, 138, 138, 138, 130, 119, 116, 90], E: 203e3 },
  { name: 'ASTM A335 P11', code: 'B31.3', T: TT, S: [138, 138, 138, 138, 138, 135, 132, 128], E: 203e3 },
  { name: 'ASTM A335 P22', code: 'B31.3', T: TT, S: [138, 138, 138, 138, 138, 136, 134, 131], E: 203e3 },
  { name: 'ASTM A312 TP304L', code: 'B31.3', T: TT, S: [115, 115, 110, 103, 98, 94, 90, 88], E: 195e3 },
  { name: 'ASTM A312 TP316L', code: 'B31.3', T: TT, S: [115, 115, 108, 101, 97, 92, 88, 86], E: 195e3 },
  { name: 'ASTM A790 S31803 (dúplex)', code: 'B31.3', T: TT, S: [207, 207, 199, 192, 187, 184, 184, 184], E: 200e3 },
  { name: 'P235GH (EN 10216-2)', code: 'EN', T: TT, S: [150, 132, 125, 113, 100, 88, 80, 75], E: 210e3 },
  { name: 'P265GH (EN 10216-2)', code: 'EN', T: TT, S: [171, 151, 142, 128, 114, 103, 94, 89], E: 210e3 },
  { name: 'L245NB (EN ISO 3183)', code: 'EN', T: TT, S: [163, 138, 130, 118, 104, 92, 84, 78], E: 210e3 },
  { name: 'P355N (EN 10216-3)', code: 'EN', T: TT, S: [204, 203, 189, 170, 157, 144, 131, 111], E: 210e3 },
  { name: '16Mo3 (EN 10216-2)', code: 'EN', T: TT, S: [187, 162, 158, 149, 137, 115, 106, 104], E: 210e3 },
  { name: '13CrMo4-5 (EN 10216-2)', code: 'EN', T: TT, S: [183, 176, 169, 163, 157, 128, 121, 116], E: 210e3 },
  { name: '1.4307 X2CrNi18-9', code: 'EN', T: TT, S: [147, 118, 108, 100, 94, 89, 85, 81], E: 200e3 },
  { name: '1.4404 X2CrNiMo17-12-2', code: 'EN', T: TT, S: [160, 133, 121, 112, 105, 100, 95, 92], E: 200e3 },
  { name: '1.4462 X2CrNiMoN22-5-3 (dúplex)', code: 'EN', T: TT, S: [307, 240, 227, 213, 207, 200, 200, 200], E: 200e3 },
];
const interp = (xs: number[], ys: number[], x: number) => {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  return NaN; // fuera del rango tabulado
};
export const stressAt = (m: MatStress, T: number) => interp(m.T, m.S, T);

/** Espesor necesario de tubo recto. P en bar, D exterior en mm. */
export function pipeThickness(o: { code: 'B31.3' | 'EN'; P: number; D: number; S: number; E?: number; W?: number; Y?: number; c: number; tol: number }) {
  const p = o.P / 10; // MPa
  const t = o.code === 'B31.3'
    ? (p * o.D) / (2 * (o.S * (o.E ?? 1) * (o.W ?? 1) + p * (o.Y ?? 0.4)))   // B31.3 (3a)
    : (p * o.D) / (2 * o.S * (o.E ?? 1) + p);                               // EN 13480-3 (6.1-2)
  const tm = t + o.c;
  return { t, tm, tNom: tm / (1 - o.tol / 100) };
}
/** Presión admisible de un tubo con espesor nominal tn (bar) */
export function pipeMaxP(o: { code: 'B31.3' | 'EN'; tn: number; D: number; S: number; E?: number; W?: number; Y?: number; c: number; tol: number }) {
  const t = o.tn * (1 - o.tol / 100) - o.c; if (t <= 0) return 0;
  const p = o.code === 'B31.3' ? (2 * t * o.S * (o.E ?? 1) * (o.W ?? 1)) / (o.D - 2 * t * (o.Y ?? 0.4)) : (2 * o.S * (o.E ?? 1) * t) / (o.D - t);
  return p * 10;
}

// ---------- Bridas ----------
const B165_T = [38, 50, 100, 150, 200, 250, 300, 325, 350, 375, 400, 425];
/** ASME B16.5 tabla 2: clase 300 por grupo (bar); el resto de clases se obtiene en proporción */
const B165_300: Record<string, number[]> = {
  '1.1': [51.1, 50.1, 46.6, 45.1, 43.8, 41.9, 39.8, 38.7, 37.6, 36.4, 34.7, 28.8],
  '2.2': [49.6, 48.1, 42.2, 38.5, 35.7, 33.4, 31.6, 30.9, 30.3, 29.9, 29.4, 29.1],
  '2.3': [41.4, 40.0, 34.8, 31.4, 29.2, 27.5, 26.1, 25.5, 25.1, 24.8, 24.3, 23.9],
};
const B165_150: Record<string, number[]> = {
  '1.1': [19.6, 19.2, 17.7, 15.8, 13.8, 12.1, 10.2, 9.3, 8.4, 7.4, 6.5, 5.5],
  '2.2': [19.0, 18.4, 16.2, 14.8, 13.7, 12.1, 10.2, 9.3, 8.4, 7.4, 6.5, 5.5],
  '2.3': [15.9, 15.3, 13.3, 12.0, 11.2, 10.5, 10.0, 9.3, 8.4, 7.4, 6.5, 5.5],
};
export const B165_GROUPS: Record<string, string> = { '1.1': 'Grupo 1.1 · A105, A216 WCB, A350 LF2', '2.2': 'Grupo 2.2 · A182 F316, F304', '2.3': 'Grupo 2.3 · A182 F304L, F316L' };
export function b165Rating(group: string, cls: number, T: number): number {
  if (cls === 150) return interp(B165_T, B165_150[group] ?? B165_150['1.1'], Math.max(38, T));
  return interp(B165_T, B165_300[group] ?? B165_300['1.1'], Math.max(38, T)) * (cls / 300);
}
/** EN 1092-1: PS ≈ PN · Rp0,2(T)/Rp0,2(RT) (grupos de acero al carbono 3E0 / inoxidables 13E0 aproximados) */
const EN_F: Record<string, number[]> = { '3E0': [1, 0.84, 0.79, 0.72, 0.64, 0.56, 0.52, 0.49], '13E0': [1, 0.83, 0.75, 0.69, 0.64, 0.61, 0.58, 0.56] };
export function enRating(group: '3E0' | '13E0', pn: number, T: number) { return pn * interp(TT, EN_F[group], Math.max(20, T)); }

// ---------- Refuerzo de derivaciones (B31.3 §304.3.3) ----------
export function branchReinf(o: { Dh: number; Th: number; th: number; Db: number; Tb: number; tb: number; c: number; beta?: number; padT?: number; padD?: number }) {
  const sb = Math.sin(((o.beta ?? 90) * Math.PI) / 180);
  const d1 = (o.Db - 2 * (o.Tb - o.c)) / sb;
  const d2 = Math.min(o.Dh, Math.max(d1, o.Tb - o.c + (o.Th - o.c) + d1 / 2));
  const L4 = Math.min(2.5 * (o.Th - o.c), 2.5 * (o.Tb - o.c) + (o.padT ?? 0));
  const A1 = o.th * d1 * (2 - sb);
  const A2 = Math.max(0, (2 * d2 - d1) * (o.Th - o.th - o.c));
  const A3 = Math.max(0, (2 * L4 * (o.Tb - o.tb - o.c)) / sb);
  const A4 = o.padT && o.padD ? Math.max(0, (o.padD - o.Db / sb) * o.padT) : 0;
  return { d1, d2, L4, A1, A2, A3, A4, ok: A2 + A3 + A4 >= A1 };
}

// ---------- Luces entre soportes ----------
export function pipeSpan(o: { D: number; t: number; rhoPipe: number; rhoFluid: number; insE: number; rhoIns: number; S: number; E: number; defl?: number; sigma?: number }) {
  const Di = o.D - 2 * o.t;
  const As = (Math.PI / 4) * (o.D ** 2 - Di ** 2) / 1e6, Af = (Math.PI / 4) * Di ** 2 / 1e6, Ai = (Math.PI / 4) * ((o.D + 2 * o.insE) ** 2 - o.D ** 2) / 1e6;
  const w = 9.81 * (As * o.rhoPipe + Af * o.rhoFluid + Ai * o.rhoIns); // N/m
  const I = (Math.PI / 64) * (o.D ** 4 - Di ** 4); // mm⁴
  const Z = (2 * I) / o.D; // mm³
  // criterio MSS SP-58/SP-69: viga simplemente apoyada, tensión de flexión ≤ 10,3 MPa (1500 psi) y flecha ≤ 2,5 mm
  const wmm = w / 1000, sb = o.sigma ?? 10.3;
  const Ls = Math.sqrt((8 * Z * sb) / wmm);
  const Ld = Math.pow((384 * o.E * I * (o.defl ?? 2.5)) / (5 * wmm), 0.25);
  return { w, I, Z, Ls, Ld, L: Math.min(Ls, Ld) };
}
/** MSS SP-58: separación máxima recomendada para tubo de acero con agua (m), por NPS */
export const MSS_SPAN: Record<string, number> = { '1': 2.1, '1-1/2': 2.7, '2': 3.0, '2-1/2': 3.4, '3': 3.7, '4': 4.3, '6': 5.2, '8': 5.8, '10': 6.7, '12': 7.0, '14': 7.6, '16': 8.2, '18': 8.5, '20': 9.1, '24': 9.8 };

// ---------- Recipientes EN 13445-3 ----------
export type HeadType = 'klopper' | 'korbbogen' | 'ellip';
export const HEAD_NAMES: Record<HeadType, string> = { klopper: 'Toriesférico Klöpper (R = Di, r = 0,1·Di)', korbbogen: 'Toriesférico Korbbogen (R = 0,8·Di, r = 0,154·Di)', ellip: 'Elíptico 2:1' };
export const headGeom = (t: HeadType, Di: number) => (t === 'klopper' ? { R: Di, r: 0.1 * Di } : t === 'korbbogen' ? { R: 0.8 * Di, r: 0.154 * Di } : { R: 0.9 * Di, r: 0.17 * Di }); // elíptico: equivalente §7.5.4 (K = 2)

/** Factor β de fondos toriesféricos (EN 13445-3 §7.5.3.5) */
function betaTori(e: number, R: number, r: number, Di: number) {
  const Y = Math.min(e / R, 0.04), Z = Math.log10(1 / Y), X = r / Di;
  const N = 1.006 - 1 / (6.2 + Math.pow(90 * Y, 4));
  const b06 = N * (-0.3635 * Z ** 3 + 2.2124 * Z ** 2 - 3.2937 * Z + 1.8873);
  const b1 = N * (-0.1833 * Z ** 3 + 1.0383 * Z ** 2 - 1.2943 * Z + 0.837);
  const b2 = Math.max(0.95 * (0.56 - 1.94 * Y - 82.5 * Y * Y), 0.5);
  if (X <= 0.1) return b06 + ((b1 - b06) * (X - 0.06)) / 0.04;
  return b1 + ((b2 - b1) * (X - 0.1)) / 0.1;
}
/** Espesores necesarios (mm). P en bar, f en MPa, Di en mm */
export function vesselThickness(o: { P: number; Di: number; f: number; z: number; head: HeadType }) {
  const p = o.P / 10;
  const eShell = (p * o.Di) / (2 * o.f * o.z - p); // §7.4.2
  const { R, r } = headGeom(o.head, o.Di);
  const es = (p * R) / (2 * o.f * o.z - 0.5 * p); // casquete §7.5.3.2 (7.5-1)
  // rótula (7.5-2): ey = β·P·(0,75R + 0,2Di)/f, iterando β(e)
  let ey = es;
  for (let i = 0; i < 30; i++) { const b = betaTori(Math.max(ey, 0.1), R, r, o.Di); const n = (b * p * (0.75 * R + 0.2 * o.Di)) / o.f; if (Math.abs(n - ey) < 1e-4) { ey = n; break; } ey = n; }
  return { eShell, eHeadCrown: es, eHeadKnuckle: ey, eHead: Math.max(es, ey), R, r };
}
export const PLATES = [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100];
export const nextPlate = (e: number) => PLATES.find((x) => x >= e - 1e-9) ?? Math.ceil(e);

/** Volumen interior (litros): virola + dos fondos (aprox. por la fórmula de cada tipo) */
export function vesselVolume(Di: number, Ltt: number, head: HeadType) {
  const cyl = (Math.PI / 4) * Di * Di * Ltt;
  const hv = head === 'ellip' ? (Math.PI / 24) * Di ** 3 : head === 'klopper' ? 0.0998 * Di ** 3 : 0.1298 * Di ** 3;
  return (cyl + 2 * hv) / 1e6;
}
/** Altura interior del fondo (sin pestaña recta) */
export function headDepth(Di: number, head: HeadType) {
  if (head === 'ellip') return Di / 4;
  const { R, r } = headGeom(head, Di);
  const xk = Di / 2 - r, zc = Math.sqrt((R - r) ** 2 - xk ** 2);
  return R - zc;
}

// ---------- Categoría PED (Anexo II, orientativa) ----------
export type FluidGroup = 1 | 2;
export type Category = 'Art. 4.3 (SEP)' | 'I' | 'II' | 'III' | 'IV';
export function pedVessel(state: 'gas' | 'liquid', group: FluidGroup, PS: number, V: number): { cat: Category; table: string } {
  const PV = PS * V;
  if (state === 'gas' && group === 1) {
    const t = 'Tabla 1 (recipientes · gas · grupo 1)';
    if (V <= 1) return { cat: PS <= 200 ? 'Art. 4.3 (SEP)' : PS <= 1000 ? 'III' : 'IV', table: t };
    return { cat: PV <= 25 ? 'Art. 4.3 (SEP)' : PV <= 50 ? 'I' : PV <= 200 ? 'II' : PV <= 1000 ? 'III' : 'IV', table: t };
  }
  if (state === 'gas') {
    const t = 'Tabla 2 (recipientes · gas · grupo 2)';
    if (V <= 1) return { cat: PS <= 1000 ? 'Art. 4.3 (SEP)' : 'IV', table: t };
    return { cat: PV <= 50 ? 'Art. 4.3 (SEP)' : PV <= 200 ? 'I' : PV <= 1000 ? 'II' : PV <= 3000 ? 'III' : 'IV', table: t };
  }
  if (group === 1) {
    const t = 'Tabla 3 (recipientes · líquido · grupo 1)';
    if (PV <= 200 || (V <= 1 && PS <= 500)) return { cat: 'Art. 4.3 (SEP)', table: t };
    return { cat: PS <= 10 ? 'I' : PS <= 500 ? 'II' : 'III', table: t };
  }
  const t = 'Tabla 4 (recipientes · líquido · grupo 2)';
  if (PS <= 10 || PV <= 10000) return { cat: PS > 1000 ? 'I' : 'Art. 4.3 (SEP)', table: t };
  return { cat: PS <= 500 ? 'I' : PS <= 1000 ? 'II' : 'III', table: t };
}
export function pedPiping(state: 'gas' | 'liquid', group: FluidGroup, PS: number, DN: number): { cat: Category; table: string } {
  const PD = PS * DN;
  if (state === 'gas' && group === 1) return { table: 'Tabla 6 (tuberías · gas · grupo 1)', cat: DN <= 25 ? 'Art. 4.3 (SEP)' : PD <= 1000 ? 'I' : PD <= 3500 && DN <= 100 ? 'II' : 'III' };
  if (state === 'gas') return { table: 'Tabla 7 (tuberías · gas · grupo 2)', cat: DN <= 32 || PD <= 1000 ? 'Art. 4.3 (SEP)' : PD <= 3500 && DN <= 100 ? 'I' : PD <= 5000 && DN <= 250 ? 'II' : 'III' };
  if (group === 1) return { table: 'Tabla 8 (tuberías · líquido · grupo 1)', cat: DN <= 25 || PD <= 2000 ? 'Art. 4.3 (SEP)' : PS <= 10 ? 'I' : PS <= 500 ? 'II' : 'III' };
  return { table: 'Tabla 9 (tuberías · líquido · grupo 2)', cat: PS <= 10 || DN <= 200 || PD <= 5000 ? 'Art. 4.3 (SEP)' : PS <= 500 ? 'I' : 'II' };
}
/** Presión de prueba hidráulica EN 13445-5 §10.2.3.3: max(1,25·Pd·f20/fT ; 1,43·Pd) */
export const hydroTest = (P: number, f20: number, fT: number) => Math.max(1.25 * P * (f20 / fT), 1.43 * P);
