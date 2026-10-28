// Catálogos normalizados: perfiles laminados y conformados (EN) y tornillería (ISO).
// Dimensiones nominales en mm. Los UPN se modelan con alas paralelas (espesor medio).

export type ProfileShape =
  | { kind: 'I'; h: number; b: number; tw: number; tf: number; r: number }
  | { kind: 'U'; h: number; b: number; tw: number; tf: number; r: number }
  | { kind: 'L'; a: number; b: number; t: number; r: number }
  | { kind: 'RHS'; h: number; b: number; t: number }
  | { kind: 'CHS'; d: number; t: number }
  | { kind: 'FLAT'; b: number; t: number }
  | { kind: 'ROUND'; d: number };

export interface ProfileFamily { id: string; name: string; standard: string; sizes: Record<string, ProfileShape> }

const I = (h: number, b: number, tw: number, tf: number, r: number): ProfileShape => ({ kind: 'I', h, b, tw, tf, r });
const U = (h: number, b: number, tw: number, tf: number, r: number): ProfileShape => ({ kind: 'U', h, b, tw, tf, r });
const L = (a: number, t: number, r: number): ProfileShape => ({ kind: 'L', a, b: a, t, r });
const R = (h: number, b: number, t: number): ProfileShape => ({ kind: 'RHS', h, b, t });
const C = (d: number, t: number): ProfileShape => ({ kind: 'CHS', d, t });

export const PROFILES: ProfileFamily[] = [
  { id: 'IPE', name: 'IPE', standard: 'EN 10365', sizes: {
    '80': I(80, 46, 3.8, 5.2, 5), '100': I(100, 55, 4.1, 5.7, 7), '120': I(120, 64, 4.4, 6.3, 7), '140': I(140, 73, 4.7, 6.9, 7),
    '160': I(160, 82, 5, 7.4, 9), '180': I(180, 91, 5.3, 8, 9), '200': I(200, 100, 5.6, 8.5, 12), '220': I(220, 110, 5.9, 9.2, 12),
    '240': I(240, 120, 6.2, 9.8, 15), '270': I(270, 135, 6.6, 10.2, 15), '300': I(300, 150, 7.1, 10.7, 15), '330': I(330, 160, 7.5, 11.5, 18),
    '360': I(360, 170, 8, 12.7, 18), '400': I(400, 180, 8.6, 13.5, 21), '450': I(450, 190, 9.4, 14.6, 21), '500': I(500, 200, 10.2, 16, 21),
    '600': I(600, 220, 12, 19, 24),
  } },
  { id: 'HEA', name: 'HEA', standard: 'EN 10365', sizes: {
    '100': I(96, 100, 5, 8, 12), '120': I(114, 120, 5, 8, 12), '140': I(133, 140, 5.5, 8.5, 12), '160': I(152, 160, 6, 9, 15),
    '180': I(171, 180, 6, 9.5, 15), '200': I(190, 200, 6.5, 10, 18), '220': I(210, 220, 7, 11, 18), '240': I(230, 240, 7.5, 12, 21),
    '260': I(250, 260, 7.5, 12.5, 24), '280': I(270, 280, 8, 13, 24), '300': I(290, 300, 8.5, 14, 27),
  } },
  { id: 'HEB', name: 'HEB', standard: 'EN 10365', sizes: {
    '100': I(100, 100, 6, 10, 12), '120': I(120, 120, 6.5, 11, 12), '140': I(140, 140, 7, 12, 12), '160': I(160, 160, 8, 13, 15),
    '180': I(180, 180, 8.5, 14, 15), '200': I(200, 200, 9, 15, 18), '220': I(220, 220, 9.5, 16, 18), '240': I(240, 240, 10, 17, 21),
    '260': I(260, 260, 10, 17.5, 24), '280': I(280, 280, 10.5, 18, 24), '300': I(300, 300, 11, 19, 27),
  } },
  { id: 'UPN', name: 'UPN', standard: 'EN 10365', sizes: {
    '80': U(80, 45, 6, 8, 8), '100': U(100, 50, 6, 8.5, 8.5), '120': U(120, 55, 7, 9, 9), '140': U(140, 60, 7, 10, 10),
    '160': U(160, 65, 7.5, 10.5, 10.5), '180': U(180, 70, 8, 11, 11), '200': U(200, 75, 8.5, 11.5, 11.5), '220': U(220, 80, 9, 12.5, 12.5),
    '240': U(240, 85, 9.5, 13, 13), '260': U(260, 90, 10, 14, 14), '300': U(300, 100, 10, 16, 16),
  } },
  { id: 'L', name: 'Angular L', standard: 'EN 10056-1', sizes: {
    '20x3': L(20, 3, 3.5), '25x3': L(25, 3, 3.5), '30x3': L(30, 3, 5), '40x4': L(40, 4, 6), '50x5': L(50, 5, 7), '60x6': L(60, 6, 8),
    '70x7': L(70, 7, 9), '80x8': L(80, 8, 10), '90x9': L(90, 9, 11), '100x10': L(100, 10, 12), '120x12': L(120, 12, 13),
    '150x15': L(150, 15, 16), '200x20': L(200, 20, 18),
  } },
  { id: 'SHS', name: 'Tubo cuadrado', standard: 'EN 10219', sizes: {
    '20x2': R(20, 20, 2), '30x3': R(30, 30, 3), '40x3': R(40, 40, 3), '40x4': R(40, 40, 4), '50x3': R(50, 50, 3), '50x5': R(50, 50, 5),
    '60x4': R(60, 60, 4), '80x4': R(80, 80, 4), '80x5': R(80, 80, 5), '100x5': R(100, 100, 5), '100x6': R(100, 100, 6),
    '120x6': R(120, 120, 6), '150x8': R(150, 150, 8), '200x8': R(200, 200, 8),
  } },
  { id: 'RHS', name: 'Tubo rectangular', standard: 'EN 10219', sizes: {
    '40x20x2': R(40, 20, 2), '50x30x3': R(50, 30, 3), '60x40x3': R(60, 40, 3), '80x40x4': R(80, 40, 4), '100x50x4': R(100, 50, 4),
    '120x60x5': R(120, 60, 5), '150x100x6': R(150, 100, 6), '200x100x8': R(200, 100, 8),
  } },
  { id: 'CHS', name: 'Tubo redondo', standard: 'EN 10219', sizes: {
    '21.3x2.6': C(21.3, 2.6), '26.9x2.6': C(26.9, 2.6), '33.7x3.2': C(33.7, 3.2), '42.4x3.2': C(42.4, 3.2), '48.3x3.2': C(48.3, 3.2),
    '60.3x3.6': C(60.3, 3.6), '76.1x3.6': C(76.1, 3.6), '88.9x4': C(88.9, 4), '114.3x4': C(114.3, 4), '139.7x5': C(139.7, 5),
    '168.3x5': C(168.3, 5), '219.1x6.3': C(219.1, 6.3),
  } },
  { id: 'FLAT', name: 'Pletina', standard: 'EN 10058', sizes: {
    '30x5': { kind: 'FLAT', b: 30, t: 5 }, '40x5': { kind: 'FLAT', b: 40, t: 5 }, '50x6': { kind: 'FLAT', b: 50, t: 6 },
    '60x8': { kind: 'FLAT', b: 60, t: 8 }, '80x10': { kind: 'FLAT', b: 80, t: 10 }, '100x10': { kind: 'FLAT', b: 100, t: 10 },
  } },
  { id: 'ROUND', name: 'Redondo macizo', standard: 'EN 10060', sizes: {
    '10': { kind: 'ROUND', d: 10 }, '12': { kind: 'ROUND', d: 12 }, '16': { kind: 'ROUND', d: 16 }, '20': { kind: 'ROUND', d: 20 }, '25': { kind: 'ROUND', d: 25 },
  } },
];

export function getProfile(family: string, size: string): ProfileShape {
  const f = PROFILES.find((x) => x.id === family);
  const p = f?.sizes[size];
  if (!p) throw new Error(`Perfil ${family} ${size} no está en el catálogo`);
  return p;
}
export const profileLabel = (family: string, size: string) => {
  const f = PROFILES.find((x) => x.id === family);
  if (!f) return `${family} ${size}`;
  if (family === 'L') return `L ${size}`;
  if (family === 'SHS' || family === 'RHS') return `${family} ${size}`;
  if (family === 'CHS') return `CHS Ø${size}`;
  if (family === 'FLAT') return `Pletina ${size}`;
  if (family === 'ROUND') return `Redondo Ø${size}`;
  return `${f.name} ${size}`;
};

/** Semiextensión del perfil en sus ejes locales (x: ancho, y: canto), para recortes. */
export function profileHalf(p: ProfileShape): [number, number] {
  switch (p.kind) {
    case 'I': case 'U': return [p.b / 2, p.h / 2];
    case 'L': return [p.a / 2, p.b / 2];
    case 'RHS': return [p.b / 2, p.h / 2];
    case 'CHS': return [p.d / 2, p.d / 2];
    case 'FLAT': return [p.b / 2, p.t / 2];
    case 'ROUND': return [p.d / 2, p.d / 2];
  }
}

// ---------------- Tornillería ISO ----------------
export interface BoltSize {
  d: number; p: number; s: number; k: number; m: number; d2: number; h: number; As: number; d0: number;
}
/** ISO 4014/4017 (cabeza), ISO 4032 (tuerca), ISO 7089 (arandela). d0 = taladro normal EN 1090-2. */
export const BOLTS: Record<string, BoltSize> = {
  M6: { d: 6, p: 1, s: 10, k: 4, m: 5.2, d2: 12, h: 1.6, As: 20.1, d0: 7 },
  M8: { d: 8, p: 1.25, s: 13, k: 5.3, m: 6.8, d2: 16, h: 1.6, As: 36.6, d0: 9 },
  M10: { d: 10, p: 1.5, s: 16, k: 6.4, m: 8.4, d2: 20, h: 2, As: 58, d0: 11 },
  M12: { d: 12, p: 1.75, s: 18, k: 7.5, m: 10.8, d2: 24, h: 2.5, As: 84.3, d0: 13 },
  M16: { d: 16, p: 2, s: 24, k: 10, m: 14.8, d2: 30, h: 3, As: 157, d0: 18 },
  M20: { d: 20, p: 2.5, s: 30, k: 12.5, m: 18, d2: 37, h: 3, As: 245, d0: 22 },
  M24: { d: 24, p: 3, s: 36, k: 15, m: 21.5, d2: 44, h: 4, As: 353, d0: 26 },
  M27: { d: 27, p: 3, s: 41, k: 17, m: 23.8, d2: 50, h: 4, As: 459, d0: 30 },
  M30: { d: 30, p: 3.5, s: 46, k: 18.7, m: 25.6, d2: 56, h: 4, As: 561, d0: 33 },
};

export const BOLT_GRADES: Record<string, { fub: number; fyb: number }> = {
  '4.6': { fub: 400, fyb: 240 }, '5.6': { fub: 500, fyb: 300 }, '8.8': { fub: 800, fyb: 640 }, '10.9': { fub: 1000, fyb: 900 },
};
export const STEEL_FU: Record<string, number> = { S235: 360, S275: 430, S355: 490 };

/** Longitud comercial del tornillo para un apriete dado (con arandelas, tuerca y 2 hilos sobresalientes). */
export function boltLength(size: string, grip: number, washers: number, nut: boolean): number {
  const b = BOLTS[size];
  const need = grip + washers * b.h + (nut ? b.m + 2 * b.p : 0);
  const std = [10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200, 220, 240, 260, 280, 300];
  return std.find((l) => l >= need) ?? Math.ceil(need / 20) * 20;
}
