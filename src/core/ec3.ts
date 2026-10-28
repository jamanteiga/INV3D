// Comprobación de tornillos según EN 1993-1-8, tabla 3.4 (categorías A/D: aplastamiento y tracción).
import { BOLTS, BOLT_GRADES, STEEL_FU } from './catalog';

export interface BoltCheckInput {
  size: string; grade: string; nBolts: number;
  FvEd: number; FtEd: number;   // kN totales
  planes: number; threadInShear: boolean;
  steel: string; tmin: number; e1: number; e2: number; p1: number; p2: number;
}
export interface CheckRow { label: string; formula: string; value: number; unit: string; util?: number }
export interface BoltCheck { rows: CheckRow[]; maxUtil: number; ok: boolean; warnings: string[] }

const GM2 = 1.25;

export function checkBolts(i: BoltCheckInput): BoltCheck {
  const b = BOLTS[i.size], g = BOLT_GRADES[i.grade], fu = STEEL_FU[i.steel] ?? 430;
  const warnings: string[] = [];
  const d0 = b.d0, d = b.d;
  const A = i.threadInShear ? b.As : (Math.PI * d * d) / 4;
  const av = i.threadInShear && i.grade === '10.9' ? 0.5 : i.threadInShear && (i.grade === '4.6' || i.grade === '5.6' || i.grade === '8.8') ? 0.6 : 0.6;
  const n = Math.max(1, i.nBolts);
  const FvEd1 = i.FvEd / n, FtEd1 = i.FtEd / n;

  const FvRd = (av * g.fub * A * i.planes) / GM2 / 1000;
  // Aplastamiento (tornillo de borde, caso más desfavorable)
  const ad = Math.min(i.e1 / (3 * d0), i.p1 > 0 ? i.p1 / (3 * d0) - 0.25 : Infinity);
  const ab = Math.min(ad, g.fub / fu, 1);
  const k1 = Math.min(2.8 * (i.e2 / d0) - 1.7, i.p2 > 0 ? 1.4 * (i.p2 / d0) - 1.7 : Infinity, 2.5);
  const FbRd = (k1 * ab * fu * d * i.tmin) / GM2 / 1000;
  const FtRd = (0.9 * g.fub * b.As) / GM2 / 1000;
  const dm = (b.s + b.s / Math.cos(Math.PI / 6)) / 2;
  const BpRd = (0.6 * Math.PI * dm * i.tmin * fu) / GM2 / 1000;

  if (i.e1 < 1.2 * d0) warnings.push(`e1 = ${i.e1} mm < 1,2·d0 = ${(1.2 * d0).toFixed(1)} mm (EN 1993-1-8 tabla 3.3)`);
  if (i.e2 < 1.2 * d0) warnings.push(`e2 = ${i.e2} mm < 1,2·d0 = ${(1.2 * d0).toFixed(1)} mm`);
  if (i.p1 > 0 && i.p1 < 2.2 * d0) warnings.push(`p1 = ${i.p1} mm < 2,2·d0 = ${(2.2 * d0).toFixed(1)} mm`);
  if (i.p2 > 0 && i.p2 < 2.4 * d0) warnings.push(`p2 = ${i.p2} mm < 2,4·d0 = ${(2.4 * d0).toFixed(1)} mm`);
  if (k1 <= 0) warnings.push('k1 ≤ 0: distancia e2 insuficiente');

  const uV = FvEd1 / FvRd, uB = FvEd1 / Math.max(FbRd, 1e-9), uT = FtEd1 / FtRd, uP = FtEd1 / BpRd;
  const uVT = FvEd1 / FvRd + FtEd1 / (1.4 * FtRd);
  const rows: CheckRow[] = [
    { label: 'Esfuerzo por tornillo (cortante)', formula: 'Fv,Ed / n', value: FvEd1, unit: 'kN' },
    { label: 'Esfuerzo por tornillo (tracción)', formula: 'Ft,Ed / n', value: FtEd1, unit: 'kN' },
    { label: 'Cortadura Fv,Rd', formula: `αv·fub·A·m/γM2  (αv=${av}, A=${A.toFixed(1)} mm²)`, value: FvRd, unit: 'kN', util: uV },
    { label: 'Aplastamiento Fb,Rd', formula: `k1·αb·fu·d·t/γM2  (k1=${k1.toFixed(2)}, αb=${ab.toFixed(2)})`, value: FbRd, unit: 'kN', util: uB },
    { label: 'Tracción Ft,Rd', formula: 'k2·fub·As/γM2  (k2=0,9)', value: FtRd, unit: 'kN', util: uT },
    { label: 'Punzonamiento Bp,Rd', formula: `0,6·π·dm·tp·fu/γM2  (dm=${dm.toFixed(1)})`, value: BpRd, unit: 'kN', util: uP },
    { label: 'Cortante + tracción', formula: 'Fv,Ed/Fv,Rd + Ft,Ed/(1,4·Ft,Rd)', value: uVT, unit: '—', util: uVT },
  ];
  const maxUtil = Math.max(...rows.filter((r) => r.util !== undefined).map((r) => r.util!));
  return { rows, maxUtil, ok: maxUtil <= 1 && k1 > 0, warnings };
}
