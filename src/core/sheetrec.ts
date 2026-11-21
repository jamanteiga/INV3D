// Valores recomendados de chapa según espesor.
// R: radio interior mínimo de plegado en frío, DIN 6935 (acero S235, plegado transversal a la laminación).
// K: posición de la fibra neutra según DIN 6935: k = 0,65 + 0,5·log10(R/t) (R/t < 5), K = k/2.

export const K_DEFAULT = 0.273;

const R_DIN: [number, number][] = [[1, 1], [1.5, 1.6], [2.5, 2.5], [3, 3], [4, 5], [5, 6], [6, 8], [7, 10], [8, 12], [10, 16], [12, 20], [14, 25], [16, 28], [18, 36], [20, 40]];

/** Radio interior recomendado (mm) para el espesor t (mm) */
export function recR(t: number): number {
  for (const [tm, r] of R_DIN) if (t <= tm + 1e-9) return r;
  return Math.round(2 * t);
}
/** Factor K recomendado (DIN 6935) para R y t */
export function recK(r: number, t: number): number {
  if (!(t > 0) || !(r > 0)) return K_DEFAULT;
  const q = r / t;
  if (q >= 5) return 0.5;
  return Math.min(0.5, Math.max(0.25, Math.round(((0.65 + 0.5 * Math.log10(q)) / 2) * 1000) / 1000));
}
export const REC_THK = [0.5, 0.6, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15];
const c = (n: number) => String(n).replace('.', ',');
/** Estilos de biblioteca por espesor con los valores recomendados */
export const REC_STYLES = REC_THK.map((t) => { const r = recR(t); return { name: `t ${c(t)} · R ${c(r)}`, t: `${t} mm`, r: `${r} mm`, k: String(recK(r, t)) }; });
