// Centro de gravedad (CDG) de la pieza o del ensamblaje, para mostrarlo en el 3D.
import type { State } from '../core/store';
import { MATERIALS, type PartDoc, type V3 } from '../core/doc';
import { q, type AsmDoc } from '../core/asm';
import type { View3D } from './view3d';

const dens = (mat?: string) => MATERIALS.find((m) => m.name === mat)?.density ?? 7850;
const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

/** CDG de la pieza activa: posición (mm) y masa (kg) */
export function partCog(s: State): { c: V3; m: number } | null {
  const p = s.result?.props; if (!p || !(p.volume > 0)) return null;
  return { c: p.cog, m: p.volume * 1e-9 * dens(s.doc.iProperties.material) };
}
/** CDG del ensamblaje: piezas (con su material y posición) y barras de estructura */
export function asmCog(s: State): { c: V3; m: number } | null {
  const r = s.asmResult; if (!r) return null;
  const a: AsmDoc = r.view ?? s.asm;
  let M = 0; const acc: V3 = [0, 0, 0];
  const add = (c: V3, m: number) => { if (!(m > 0) || !c.every(isFinite)) return; M += m; for (let k = 0; k < 3; k++) acc[k] += c[k] * m; };
  for (const o of a.occurrences) {
    if (o.suppressed) continue;
    const d = s.docData(o.part) as PartDoc | null;
    if (!d || !('features' in d)) continue; // los subensamblajes van aplanados
    const pr = r.occCut[o.id]?.props ?? r.parts[o.part]?.props; if (!pr) continue;
    const xf = r.xf[o.id] ?? o.xf;
    const rc = q.rotate(xf.quat, pr.cog);
    add([xf.pos[0] + rc[0], xf.pos[1] + rc[1], xf.pos[2] + rc[2]], pr.volume * 1e-9 * dens(d.iProperties.material));
  }
  for (const mb of r.members) {
    const f = s.asm.frames.find((x) => x.id === mb.id); if (!f) continue;
    add([(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2, (f.a[2] + f.b[2]) / 2], mb.volume * 1e-9 * dens(f.material));
  }
  return M > 0 ? { c: acc.map((v) => v / M) as V3, m: M } : null;
}

const memo = new WeakMap<View3D, unknown[]>();
/** Actualiza el símbolo de CDG del visor (solo si cambia algo) */
export function updateCog(V: View3D, s: State, kind: 'part' | 'asm') {
  const key = [s.hud.cog, kind === 'part' ? s.result : s.asmResult, kind === 'part' ? s.doc.iProperties.material : s.asm];
  const prev = memo.get(V);
  if (prev && prev.every((x, i) => x === key[i])) return;
  memo.set(V, key);
  if (!s.hud.cog) { V.setCog(null); return; }
  const r = kind === 'part' ? partCog(s) : asmCog(s);
  if (!r) { V.setCog(null); return; }
  V.setCog(r.c, `CDG  (${r.c.map(f1).join('; ')}) mm\nMasa ${r.m < 10 ? r.m.toFixed(3) : r.m.toFixed(1)} kg`);
}
