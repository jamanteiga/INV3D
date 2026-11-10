// Datos de conductos HVAC (EN / SMACNA). Valores orientativos de práctica habitual: verificar con el proyecto.
export const INCH = 25.4;

/** Materiales de conductos, aislamiento y equipos (densidad kg/m³). */
export const HVAC_MATERIALS = [
  { name: 'Acero galvanizado DX51D+Z275', density: 7850, color: '#b9c0c7' },
  { name: 'Acero inoxidable 1.4301 (conducto)', density: 7900, color: '#cfd4da' },
  { name: 'Aluminio EN AW-3003', density: 2730, color: '#d6dade' },
  { name: 'Lana mineral 40 kg/m³', density: 40, color: '#e9d98b' },
  { name: 'Lana mineral 70 kg/m³ (panel)', density: 70, color: '#e3cf73' },
  { name: 'Espuma elastomérica', density: 60, color: '#3a3d42' },
  { name: 'Panel sándwich UTA 50 mm (equivalente)', density: 300, color: '#c9ced6' },
  { name: 'Lona flexible / aluminio', density: 300, color: '#c8c8c0' },
] as const;

/** EN 1505: lados preferentes de conductos rectangulares (mm, dimensiones interiores). */
export const EN_RECT = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1800, 2000, 2200, 2400, 2500];
/** EN 1506: diámetros nominales de conductos circulares (mm). */
export const EN_ROUND = [63, 80, 100, 112, 125, 140, 160, 180, 200, 224, 250, 280, 315, 355, 400, 450, 500, 560, 630, 710, 800, 900, 1000, 1120, 1250, 1400, 1600];
/** SMACNA: tamaños habituales (pulgadas). */
export const SM_RECT = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 42, 44, 48, 54, 60, 66, 72, 78, 84, 90, 96];
export const SM_ROUND = [3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 42, 48, 54, 60];

/** Espesor de chapa galvanizada (mm) según el lado mayor o el diámetro. */
export function sheetThickness(std: 'EN' | 'SMACNA', shape: 'rect' | 'round' | 'oval', size: number): { t: number; label: string } {
  if (std === 'EN') {
    if (shape === 'rect') {
      const t = size <= 300 ? 0.6 : size <= 750 ? 0.8 : size <= 1200 ? 1.0 : size <= 2000 ? 1.2 : 1.5;
      return { t, label: `${String(t).replace('.', ',')} mm (lado mayor ${size} mm · UNE 100102 / EN 1507, orientativo)` };
    }
    const t = size <= 250 ? 0.5 : size <= 500 ? 0.6 : size <= 800 ? 0.8 : size <= 1250 ? 1.0 : 1.2;
    return { t, label: `${String(t).replace('.', ',')} mm (${shape === 'oval' ? `oval, eje mayor ${size}` : `Ø${size}`} · EN 12237 helicoidal, orientativo)` };
  }
  const inch = size / INCH;
  const g: [number, number, number][] = shape === 'rect'
    ? [[12, 26, 0.55], [30, 24, 0.70], [54, 22, 0.85], [84, 20, 1.00], [1e9, 18, 1.31]]
    : [[14, 26, 0.55], [26, 24, 0.70], [36, 22, 0.85], [50, 20, 1.00], [1e9, 18, 1.31]];
  const [, ga, t] = g.find(([lim]) => inch <= lim)!;
  return { t, label: `calibre ${ga} (${t} mm) · SMACNA 2" c.a., orientativo` };
}

/** Pérdidas singulares típicas (ζ referido a la velocidad del tramo) o pérdida fija en Pa. */
export const FITTING_LOSSES: { id: string; name: string; zeta?: number; dp?: number }[] = [
  { id: 'elbow_r', name: 'Codo rectangular con radio (R/W = 1)', zeta: 0.21 },
  { id: 'elbow_r15', name: 'Codo rectangular con radio (R/W = 1,5)', zeta: 0.17 },
  { id: 'elbow_v', name: 'Codo recto con álabes', zeta: 0.25 },
  { id: 'elbow_sq', name: 'Codo recto sin álabes', zeta: 1.2 },
  { id: 'elbow_round', name: 'Codo circular 90° (R/D = 1,5)', zeta: 0.24 },
  { id: 'elbow_45', name: 'Codo 45°', zeta: 0.15 },
  { id: 'tee_branch', name: 'Te: paso a derivación', zeta: 1.0 },
  { id: 'tee_run', name: 'Te: paso recto', zeta: 0.1 },
  { id: 'shoe', name: 'Toma de zapato (45°): derivación', zeta: 0.5 },
  { id: 'trans', name: 'Transición / reducción gradual', zeta: 0.05 },
  { id: 'exp', name: 'Ampliación brusca', zeta: 0.5 },
  { id: 'entry', name: 'Entrada a conducto', zeta: 0.5 },
  { id: 'exit', name: 'Salida libre', zeta: 1.0 },
  { id: 'damper', name: 'Compuerta de regulación abierta', zeta: 0.2 },
  { id: 'fire', name: 'Compuerta cortafuegos', dp: 15 },
  { id: 'grille', name: 'Rejilla', dp: 20 },
  { id: 'diffuser', name: 'Difusor', dp: 25 },
  { id: 'silencer', name: 'Silenciador', dp: 40 },
  { id: 'flex', name: 'Conducto flexible (1 m)', dp: 8 },
];

/** Diámetro equivalente de Huebscher (misma pérdida de carga y caudal). */
export const huebscher = (a: number, b: number) => (1.3 * Math.pow(a * b, 0.625)) / Math.pow(a + b, 0.25);
/** Factor de fricción de Colebrook-White (iterativo). */
export function colebrook(Re: number, relRough: number): number {
  if (Re < 2300) return 64 / Math.max(Re, 1);
  let f = 0.02;
  for (let i = 0; i < 40; i++) { const g = -2 * Math.log10(relRough / 3.7 + 2.51 / (Re * Math.sqrt(f))); f = 1 / (g * g); }
  return f;
}
export interface SegCalc { v: number; dh: number; de: number; Re: number; lambda: number; R: number }
/** Velocidad, diámetro hidráulico y pérdida por fricción (Pa/m) de un conducto (mm, m³/h). */
export function ductFriction(shape: 'rect' | 'round', a: number, b: number, q: number, roughMm = 0.15, rho = 1.2, nu = 1.5e-5): SegCalc {
  const A = shape === 'rect' ? (a * b) / 1e6 : (Math.PI * a * a) / 4e6;
  const P = shape === 'rect' ? (2 * (a + b)) / 1e3 : (Math.PI * a) / 1e3;
  const dh = (4 * A) / P, v = q / 3600 / A, Re = (v * dh) / nu;
  const lambda = colebrook(Re, roughMm / 1000 / dh);
  return { v, dh: dh * 1000, de: shape === 'rect' ? huebscher(a, b) : a, Re, lambda, R: (lambda / dh) * (rho * v * v) / 2 };
}
