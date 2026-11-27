// Desarrollos de piezas HVAC que no se modelan como chapa: codos rectangulares (tapas y chapas curvas exterior e
// interior), codos rectos con álabes, codos circulares por gajos y conductos circulares de costura longitudinal.
import { autoT, type HvacSpec } from './hvac';
import type { FlatResult } from './cadClient';

export type P2 = [number, number];
export interface FlatPiece { name: string; qty: number; polys: P2[][]; bends?: { a: P2; b: P2; label: string }[] }

const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 48): P2[] => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as P2; });
const rectP = (w: number, h: number): P2[] => [[0, 0], [w, 0], [w, h], [0, h], [0, 0]];
const thick = (s: HvacSpec) => autoT(s);
export const hvacThick = (s: HvacSpec) => thick(s);
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Piezas planas de la pieza HVAC, o null si se desarrolla como chapa (o no es desarrollable) */
export function hvacFlatPieces(s: HvacSpec): { pieces: FlatPiece[]; notes: string[] } | null {
  const t = thick(s), notes: string[] = [];
  if (s.kind === 'duct' && s.shape === 'round' && s.seam !== 'spiral') {
    const C = Math.PI * (s.D + t);
    notes.push(`Virola: desarrollo π·(D+t) = ${r1(C)} mm × L ${s.L} mm (sin solape de costura)`);
    return { pieces: [{ name: `Virola Ø${s.D} L${s.L}`, qty: 1, polys: [rectP(C, s.L)] }], notes };
  }
  if (s.kind !== 'elbow') return null;
  const ang = s.angle ?? 90, th = (ang * Math.PI) / 180;
  const kind = s.shape === 'round' ? (s.elbowType === 'segmented' ? 'segmented' : 'smooth') : s.shape === 'rect' && s.elbowType === 'square' ? 'square' : 'radius';
  if (s.shape === 'oval') return null;
  if (kind === 'smooth') { notes.push('Codo prensado: no desarrollable (se fabrica por estampación)'); return { pieces: [], notes }; }
  if (kind === 'radius') {
    const rw = s.rw ?? 1, Rc = rw * s.W, Ri = Rc - s.W / 2, Ro = Rc + s.W / 2;
    // tapas: sectores de corona (dos iguales)
    const cheek: P2[] = [...arc(0, 0, Ro, 0, th), ...arc(0, 0, Ri, th, 0)]; cheek.push(cheek[0]);
    const Li = Ri * th, Lo = Ro * th;
    notes.push(`Codo ${ang}° R/W ${rw}: tapas (×2) corona Ri ${r1(Ri)} – Re ${r1(Ro)} mm; chapa interior ${r1(Li)} × ${s.H}; chapa exterior ${r1(Lo)} × ${s.H} mm (medidas interiores, sin pestañas de unión)`);
    return { pieces: [
      { name: `Tapa codo ${s.W}×${s.H}`, qty: 2, polys: [cheek] },
      { name: `Chapa interior (garganta) ${r1(Li)}×${s.H}`, qty: 1, polys: [rectP(Li, s.H)] },
      { name: `Chapa exterior (talón) ${r1(Lo)}×${s.H}`, qty: 1, polys: [rectP(Lo, s.H)] },
    ], notes };
  }
  if (kind === 'square') {
    const a = s.W / 2, L = a + 60;
    const cheek: P2[] = [[-a, 0], [a, 0], [a, L - a], [L + a, L - a], [L + a, L + a], [-a, L + a], [-a, 0]].map(([x, y]) => [x + a, y]) as P2[];
    notes.push(`Codo recto ${s.W}×${s.H}: tapas en L (×2), chapas exteriores ${r1(L + a)} y ${r1(L + 2 * a)} × ${s.H}, interiores ${r1(L - a)} × ${s.H} (×2); álabes aparte`);
    return { pieces: [
      { name: `Tapa codo recto ${s.W}×${s.H}`, qty: 2, polys: [cheek] },
      { name: 'Chapa exterior 1', qty: 1, polys: [rectP(L + a, s.H)] },
      { name: 'Chapa exterior 2', qty: 1, polys: [rectP(L + 2 * a, s.H)] },
      { name: 'Chapa interior', qty: 2, polys: [rectP(L - a, s.H)] },
    ], notes };
  }
  // gajos: n segmentos, los de los extremos con un solo corte a dl/2
  const n = Math.max(3, s.gores ?? (ang >= 90 ? 5 : 3)), rw = s.rw ?? 1.5, Rc = rw * s.D, dl = ((ang / (n - 1)) * Math.PI) / 180, full = 2 * Rc * Math.tan(dl / 2);
  const Dm = s.D + t, C = Math.PI * Dm, k = (Dm / 2) * Math.tan(dl / 2), N = 72;
  // perfil del corte: altura extra k·cos(θ) (θ = 0 en el talón)
  const gore = (h0: number, two: boolean): P2[] => {
    const top: P2[] = Array.from({ length: N + 1 }, (_, i) => { const x = (C * i) / N, a = (2 * Math.PI * i) / N; return [x, h0 + k * Math.cos(a)] as P2; });
    const bot: P2[] = Array.from({ length: N + 1 }, (_, i) => { const x = (C * (N - i)) / N, a = (2 * Math.PI * (N - i)) / N; return [x, two ? -k * Math.cos(a) : 0] as P2; });
    const p = [...bot.reverse().reverse(), ...top]; return [...p, p[0]];
  };
  notes.push(`Codo por gajos ${ang}°: ${n} gajos (2 extremos + ${n - 2} centrales), R/D ${rw}, desarrollo π·(D+t) = ${r1(C)} mm; trazar a partir de la línea de talón (θ = 0)`);
  return { pieces: [
    { name: `Gajo extremo Ø${s.D}`, qty: 2, polys: [gore(full / 2, false)] },
    ...(n > 2 ? [{ name: `Gajo central Ø${s.D}`, qty: n - 2, polys: [gore(full / 2, true).map(([x, y]) => [x, y + k] as P2)] }] : []),
  ], notes };
}

/** Como resultado de desarrollo (para el cuadro de desarrollo): piezas en fila */
export function hvacFlatResult(s: HvacSpec): FlatResult | null {
  const r = hvacFlatPieces(s); if (!r) return null;
  const paths: string[] = []; let x = 0;
  const notes = [...r.notes];
  for (const p of r.pieces) {
    const xs = p.polys.flat().map((q) => q[0]), ys = p.polys.flat().map((q) => q[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    for (const pl of p.polys) paths.push('M ' + pl.map(([a, b]) => `${(a - x0 + x).toFixed(2)} ${(-(b - y0)).toFixed(2)}`).join(' L ') + ' Z');
    notes.push(`${p.name}: ${p.qty} ud · ${r1(Math.max(...xs) - x0)} × ${r1(Math.max(...ys) - y0)} mm`);
    x += Math.max(...xs) - x0 + 40;
  }
  return { paths, bends: [], t: thick(s), r: 0, k: 0, notes };
}
