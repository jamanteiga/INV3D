// Aislamiento asociado: cada pieza con `ins` lleva su pieza de aislamiento, que se rehace sola al cortar, dividir,
// cambiar longitud o sección, mover o borrar la pieza (en el mismo paso de deshacer)
import { useStore, asmPostHooks } from '../core/store';
import type { AsmDoc, Occurrence, Xform } from '../core/asm';
import { compose } from '../core/subasm';
import { MATERIALS, type PartDoc, type V3 } from '../core/doc';
import { makeHvacPart, autoT, type HvacSpec } from '../core/hvac';
import { partFor } from './hvacops';

const S = () => useStore.getState();
export type InsType = NonNullable<Occurrence['ins']>['type'];
export const INS_TYPES: Record<InsType, { name: string; mat: string; clad?: string }> = {
  mw: { name: 'Lana mineral', mat: 'Lana mineral 40 kg/m³' },
  'mw-al': { name: 'Lana mineral + aluminio', mat: 'Lana mineral 40 kg/m³', clad: 'Acabado aluminio' },
  'mw-steel': { name: 'Lana mineral + chapa 0,6 (exterior)', mat: 'Lana mineral 70 kg/m³ (panel)', clad: 'Forro de chapa galvanizada 0,6' },
  elast: { name: 'Espuma elastomérica', mat: 'Espuma elastomérica' },
  inner: { name: 'Interior (lana con velo)', mat: 'Lana mineral 70 kg/m³ (panel)' },
};
const NOINS = new Set(['gasket', 'support', 'insulation', 'penetration', 'flange', 'grille', 'diffuser']);
const specOf = (pid: string) => (S().docData(pid) as (PartDoc & { hvacSpec?: HvacSpec }) | null)?.hvacSpec;
export const insulable = (o: Occurrence) => !o.tag && !!specOf(o.part) && !NOINS.has(specOf(o.part)!.kind);

/** Pieza de aislamiento para la pieza `pid` (null si aún no se puede: sin malla) y su desfase local */
function insPart(pid: string, ins: NonNullable<Occurrence['ins']>): { pid: string; off: V3; area: number; out: number } | null {
  const sp = specOf(pid); if (!sp) return null;
  const T = INS_TYPES[ins.type], e = ins.e, inner = ins.type === 'inner', t = autoT(sp);
  const fin = (d: PartDoc, pn: string, desc: string) => { d.iProperties.partNumber = pn; d.iProperties.description = desc; d.iProperties.material = T.mat; return d; };
  const per = (g: number) => (sp.shape === 'round' ? Math.PI * (sp.D + g) : sp.shape === 'oval' ? Math.PI * (sp.H + g) + 2 * (sp.W - sp.H) : 2 * (sp.W + sp.H + 2 * g));
  const sz = sp.shape === 'round' ? `Ø${sp.D}` : `${sp.W}×${sp.H}`;
  if (sp.kind === 'duct') {
    const d = makeHvacPart({ ...sp, kind: 'insulation', ins: e, insIn: inner, ends: 'none', endsAt: undefined, material: T.mat });
    return { pid: partFor(fin(d, `Aislamiento ${T.name} ${sz} e=${e} L=${sp.L}`, `${T.name}${T.clad ? ' · ' + T.clad : ''} de ${e} mm, conducto ${sz} L ${sp.L}`)), off: [0, 0, 0], area: (per(inner ? 0 : 2 * t) * sp.L) / 1e6, out: (per(inner ? 0 : 2 * t + 2 * e) * sp.L) / 1e6 };
  }
  if (sp.kind === 'elbow' && !(sp.shape === 'rect' && sp.elbowType === 'square')) {
    const base = sp.shape === 'round' ? sp.D : sp.W, rw = sp.rw ?? (sp.shape === 'round' ? 1.5 : 1), Rc = rw * base, g = inner ? -2 * e : 2 * t;
    const isp: HvacSpec = { ...sp, W: sp.W + g, H: sp.H + g, D: sp.D + g, t: e, rw: Rc / (base + g), ends: 'none', endsAt: undefined, material: T.mat };
    try {
      const d = makeHvacPart(isp);
      return { pid: partFor(fin(d, `Aislamiento ${T.name} codo ${sp.angle ?? 90} ${sz} e=${e}`, `${T.name}${T.clad ? ' · ' + T.clad : ''} de ${e} mm, codo ${sz} ${sp.angle ?? 90}°`)), off: [0, 0, 0], area: (per(inner ? 0 : 2 * t) * Rc * ((sp.angle ?? 90) * Math.PI) / 180) / 1e6, out: (per(inner ? 0 : 2 * t + 2 * e) * Rc * ((sp.angle ?? 90) * Math.PI) / 180) / 1e6 };
    } catch { /* geometría imposible: envolvente */ }
  }
  // resto (transiciones, tes, compuertas, plenums, codos rectos…): funda rectangular sobre la caja de la pieza (eje Z local)
  const m = S().asmResult?.parts[pid]?.mesh; if (!m) return null;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.vertices.length; i += 3) for (let k = 0; k < 3; k++) { const v = m.vertices[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  const W = Math.round(mx[0] - mn[0]), H = Math.round(mx[1] - mn[1]), L = Math.round(mx[2] - mn[2]); if (!(W > 0 && H > 0 && L > 0)) return null;
  const d = makeHvacPart({ kind: 'insulation', shape: 'rect', W, H, D: 0, L, t: 0.001, ins: e, ends: 'none', material: T.mat } as HvacSpec);
  return { pid: partFor(fin(d, `Aislamiento ${T.name} funda ${W}×${H} L=${L} e=${e}`, `${T.name}${T.clad ? ' · ' + T.clad : ''} de ${e} mm, funda sobre ${sp.kind} ${sz} (envolvente)`)), off: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, mn[2]], area: (2 * (W + H) * L) / 1e6, out: (2 * (W + H + 4 * e) * L) / 1e6 };
}

/** Sincroniza las piezas de aislamiento con sus piezas (añade, rehace, recoloca y borra) sobre el ensamblaje `a` */
export function syncInsulation(a: AsmDoc): boolean {
  let changed = false;
  const hosts = new Map(a.occurrences.filter((o) => o.ins && !o.suppressed && !o.tag).map((o) => [o.id, o]));
  // fuera las de piezas que ya no existen o ya no se aíslan
  const before = a.occurrences.length;
  a.occurrences = a.occurrences.filter((o) => !(o.tag === 'insulation' && o.host && !hosts.has(o.host)));
  if (a.occurrences.length !== before) changed = true;
  const cnt = new Map<string, number>(); for (const x of a.occurrences) cnt.set(x.part, (cnt.get(x.part) ?? 0) + 1);
  for (const h of hosts.values()) {
    const r = insPart(h.part, h.ins!); const cur = a.occurrences.find((x) => x.tag === 'insulation' && x.host === h.id);
    if (!r) continue;
    const xf: Xform = compose(h.xf, { pos: r.off, quat: [0, 0, 0, 1] });
    if (!cur) { const n = (cnt.get(r.pid) ?? 0) + 1; cnt.set(r.pid, n); a.occurrences.push({ id: `${h.id}_ins`, name: `${(S().docData(r.pid) as PartDoc | null)?.iProperties.partNumber ?? 'Aislamiento'}:${n}`, part: r.pid, xf, grounded: true, tag: 'insulation', host: h.id, insOff: r.off, ...(h.system ? { system: h.system } : {}) } as Occurrence); changed = true; continue; }
    const same = cur.part === r.pid && cur.xf.pos.every((v, i) => Math.abs(v - xf.pos[i]) < 1e-3) && cur.xf.quat.every((v, i) => Math.abs(v - xf.quat[i]) < 1e-7);
    if (!same) { cur.part = r.pid; cur.xf = xf; cur.insOff = r.off; changed = true; }
  }
  return changed;
}
asmPostHooks.push((a) => { syncInsulation(a); });
// piezas cuya malla aún no estaba (fundas): se completan al llegar el cálculo, sin paso de deshacer
let lastRes: unknown = null;
useStore.subscribe((st) => {
  if (st.kind !== 'assembly' || st.asmResult === lastRes) return; lastRes = st.asmResult;
  if (!st.asm.occurrences.some((o) => o.ins && !st.asm.occurrences.some((x) => x.host === o.id && x.tag === 'insulation'))) return;
  setTimeout(() => { const a = structuredClone(S().asm); if (syncInsulation(a)) useStore.setState({ asm: a }); }, 0);
});

/** Aísla (o quita el aislamiento con e = 0) las piezas indicadas o todas */
export function insulate(e: number, type: InsType, scope?: string[], kinds: { duct: boolean; elbow: boolean; other: boolean } = { duct: true, elbow: true, other: true }) {
  const s = S(); let n = 0;
  s.commitAsm((a) => {
    // aislamiento antiguo (sin pieza asociada) en el ámbito: fuera
    a.occurrences = a.occurrences.filter((o) => !(o.tag === 'insulation' && !o.host && !scope));
    for (const o of a.occurrences) {
      if (scope && !scope.includes(o.id)) continue; if (!insulable(o)) continue;
      const k = specOf(o.part)!.kind; const ok = k === 'duct' ? kinds.duct : k === 'elbow' ? kinds.elbow : kinds.other; if (!ok) continue;
      if (e > 0) o.ins = { e, type }; else delete o.ins; n++;
    }
  });
  s.notify(e > 0 ? `${INS_TYPES[type].name} de ${e} mm en ${n} pieza(s); se actualiza solo al cortar, dividir, cambiar o mover las piezas` : `Aislamiento quitado de ${n} pieza(s)`);
}

/** Mediciones de aislamiento por tipo y espesor */
export function insTakeoff() {
  const s = S(); const rows = new Map<string, { type: InsType; e: number; m2: number; m3: number; kg: number; clad: number; n: number }>();
  for (const o of s.asm.occurrences) {
    if (!o.ins || o.suppressed || o.tag) continue; const r = insPart(o.part, o.ins); if (!r) continue;
    const k = `${o.ins.type}|${o.ins.e}`; const T = INS_TYPES[o.ins.type];
    const row = rows.get(k) ?? rows.set(k, { type: o.ins.type, e: o.ins.e, m2: 0, m3: 0, kg: 0, clad: 0, n: 0 }).get(k)!;
    const v = r.area * o.ins.e / 1000; row.n++; row.m2 += r.area; row.m3 += v; row.kg += v * (MATERIALS.find((m) => m.name === T.mat)?.density ?? 40);
    if (T.clad) row.clad += r.out;
  }
  return [...rows.values()].sort((x, y) => x.type.localeCompare(y.type) || x.e - y.e);
}
