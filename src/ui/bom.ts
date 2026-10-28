// Lista de materiales del ensamblaje: piezas, barras de estructura (con longitud de corte), tornillería y soldadura.
import type { State } from '../core/store';
import type { AsmDoc } from '../core/asm';
import { MATERIALS, type PartDoc } from '../core/doc';
import { profileLabel, BOLTS, boltLength } from '../core/catalog';
import { makeEval, fmt } from '../core/expr';

export interface BomRow { kind: 'part' | 'member' | 'bolt' | 'nut' | 'washer' | 'weld'; qty: number; pn: string; desc: string; material: string; mass: number; length?: number; unit?: string }

const dens = (mat: string) => MATERIALS.find((m) => m.name === mat)?.density ?? 7850;

export function bomRows(s: State, asm: AsmDoc): BomRow[] {
  const r = s.kind === 'assembly' && s.asm === asm ? s.asmResult : null;
  const ev = makeEval([]);
  const rows: BomRow[] = [];
  const parts = new Map<string, number>();
  for (const o of asm.occurrences) if (!o.suppressed) parts.set(o.part, (parts.get(o.part) ?? 0) + 1);
  for (const [id, qty] of parts) {
    const d = s.docData(id) as PartDoc | null; if (!d) continue;
    const vol = r?.parts[id]?.props?.volume ?? 0;
    rows.push({ kind: 'part', qty, pn: d.iProperties.partNumber || s.docs.find((x) => x.id === id)?.fileName || 'Pieza', desc: d.iProperties.description, material: d.iProperties.material, mass: vol * 1e-9 * dens(d.iProperties.material) });
  }
  const groups = new Map<string, BomRow>();
  for (const m of asm.frames) {
    if (m.suppressed) continue;
    const res = r?.members.find((x) => x.id === m.id);
    const L = res ? Math.round(res.length * 2) / 2 : Math.round(Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]) * 2) / 2;
    const ang = res ? res.cutAngles.filter((a) => a > 0.05).map((a) => `${fmt(a, 1)}°`).join('/') : '';
    const key = `${m.family}|${m.size}|${L}|${ang}|${m.material}`;
    const g = groups.get(key);
    const mass = (res?.volume ?? 0) * 1e-9 * dens(m.material);
    if (g) { g.qty++; g.mass += mass; }
    else groups.set(key, { kind: 'member', qty: 1, pn: profileLabel(m.family, m.size), desc: `L = ${fmt(L, 1)} mm${ang ? ` · corte ${ang}` : ''}`, material: m.material, mass, length: L });
  }
  rows.push(...[...groups.values()].sort((a, b) => a.pn.localeCompare(b.pn) || (b.length ?? 0) - (a.length ?? 0)));
  for (const g of asm.bolts) {
    if (g.suppressed) continue;
    const b = BOLTS[g.size]; if (!b) continue;
    let grip = 0; try { grip = ev(g.grip); } catch { /* */ }
    const n = Math.max(1, Math.round(Number(g.n1) || 1)) * Math.max(1, Math.round(Number(g.n2) || 1));
    const L = boltLength(g.size, grip, g.washers, g.nut);
    rows.push({ kind: 'bolt', qty: n, pn: `ISO ${L > 0 ? '4017' : '4014'} ${g.size}×${L}`, desc: `Tornillo hexagonal ${g.grade}`, material: `Clase ${g.grade}`, mass: 0 });
    if (g.nut) rows.push({ kind: 'nut', qty: n, pn: `ISO 4032 ${g.size}`, desc: 'Tuerca hexagonal', material: 'Clase 8', mass: 0 });
    if (g.washers) rows.push({ kind: 'washer', qty: n * g.washers, pn: `ISO 7089 ${b.d}`, desc: 'Arandela plana', material: '200 HV', mass: 0 });
  }
  const wByA = new Map<string, { len: number; mass: number }>();
  for (const w of asm.welds) {
    if (w.suppressed) continue;
    const res = r?.welds.find((x) => x.id === w.id);
    const k = w.throat;
    const cur = wByA.get(k) ?? { len: 0, mass: 0 };
    cur.len += res?.length ?? 0; cur.mass += res ? res.area * res.length * 1e-9 * 7850 : 0;
    wByA.set(k, cur);
  }
  for (const [a, v] of wByA) rows.push({ kind: 'weld', qty: 1, pn: `Cordón a${a.replace(/\s*mm/, '')}`, desc: `Soldadura en ángulo · ${fmt(v.len, 0)} mm`, material: 'Aporte', mass: v.mass, length: v.len });
  return rows;
}

export function bomCsv(rows: BomRow[]): string {
  const esc = (x: string) => `"${x.replace(/"/g, '""')}"`;
  return ['Pos.;Cantidad;Nº de pieza;Descripción;Material;Masa (kg)', ...rows.map((r, i) => [i + 1, r.qty, esc(r.pn), esc(r.desc), esc(r.material), r.mass ? r.mass.toFixed(3).replace('.', ',') : ''].join(';'))].join('\r\n');
}
