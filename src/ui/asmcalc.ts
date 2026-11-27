// Ingeniería sobre el propio ensamblaje HVAC: caudales en los terminales, velocidad y pérdida de carga por pieza,
// circuito índice y ventilador; soportes automáticos; aislamiento RITE; holguras al insertar; sistemas con colores.
import { create } from 'zustand';
import { useStore } from '../core/store';
import { uid, v3, type V3, type PartDoc } from '../core/doc';
import { q as qq, xfPoint, type Xform } from '../core/asm';
import { makeHvacPart, autoT, type HvacSpec } from '../core/hvac';
import { ductFriction, FITTING_LOSSES } from '../core/hvacdata';
import { xfOf, epGroup } from './actions';

const S = () => useStore.getState();
type HPart = PartDoc & { hvacSpec?: HvacSpec };
const specOf = (pid: string) => (S().docData(pid) as HPart | null)?.hvacSpec;

// ---------- estado de cálculo y colores ----------
export interface PieceCalc { occ: string; name: string; kind: string; size: string; q: number; v: number; R: number; L: number; dpF: number; zeta: number; dpS: number; dp: number; warn?: string }
export interface AsmCalc { rows: PieceCalc[]; paths: { term: string; name: string; dp: number }[]; index: string[]; fanDp: number; qTot: number; source: string; warnings: string[] }
export const useAsmCalc = create<{ revDiff?: { added: Set<string>; changed: Set<string> }; calc: AsmCalc | null; colorBy: 'none' | 'velocity' | 'system' | 'status' | 'revision'; vMax: number; rMax: number }>(() => ({ calc: null, colorBy: 'none', vMax: 8, rMax: 1.5 }));

export const SYS_COLORS = ['#2f80ed', '#eb5757', '#27ae60', '#f2994a', '#9b51e0', '#56ccf2', '#bb6bd9', '#219653', '#f2c94c', '#828282'];
/** Color de un sistema (por orden de aparición en el ensamblaje) */
export function systemColor(name: string) {
  const names = [...new Set(S().asm.occurrences.map((o) => o.system).filter(Boolean))] as string[];
  const i = names.indexOf(name); return SYS_COLORS[(i < 0 ? 0 : i) % SYS_COLORS.length];
}
/** Color de un componente según el modo de coloreado (o null) */
export function calcColor(occ: string): string | null {
  const st = useAsmCalc.getState();
  if (st.colorBy !== 'none' && (S().asm.occurrences.find((x) => x.id === occ) as { tag?: string } | undefined)?.tag) return null; // soportes y aislamiento: su material
  if (st.colorBy === 'revision') return st.revDiff?.added.has(occ) ? '#27ae60' : st.revDiff?.changed.has(occ) ? '#f2994a' : '#c3c8cf';
  if (st.colorBy === 'status') { const o = S().asm.occurrences.find((x) => x.id === occ); return STATUS_COLORS[o?.status ?? 'design']; }
  if (st.colorBy === 'system') { const o = S().asm.occurrences.find((x) => x.id === occ); return o?.system ? systemColor(o.system) : '#c3c8cf'; }
  if (st.colorBy === 'velocity') {
    const r = st.calc?.rows.find((x) => x.occ === occ); if (!r || !r.q) return '#c3c8cf';
    const u = Math.min(1.25, r.v / st.vMax); return `hsl(${Math.round(Math.max(0, 220 - u * 176))}, 75%, 50%)`;
  }
  return null;
}

export const STATUS_NAMES = { design: 'Diseñada', review: 'Revisada', fab: 'Fabricada', sent: 'Enviada a obra', mounted: 'Montada' } as const;
export const STATUS_COLORS: Record<keyof typeof STATUS_NAMES, string> = { design: '#b8bec7', review: '#f2c94c', fab: '#2f80ed', sent: '#9b51e0', mounted: '#27ae60' };
/** Cambia el estado de los componentes indicados */
export function setStatus(ids: string[], st: keyof typeof STATUS_NAMES) {
  S().commitAsm((a) => { for (const o of a.occurrences) if (ids.includes(o.id)) o.status = st; });
  useAsmCalc.setState({ colorBy: 'status' });
  S().notify(`${ids.length} componente(s) → ${STATUS_NAMES[st]} (colores por estado)`);
}

// ---------- grafo del tendido ----------
function graph() {
  const s = S(); const adj = new Map<string, { to: string; myEp: string; toEp: string }[]>();
  for (const j of s.asm.joints) {
    if (!j.ep || j.suppressed) continue;
    (adj.get(j.a.occ) ?? adj.set(j.a.occ, []).get(j.a.occ)!).push({ to: j.b.occ, myEp: j.ep.a, toEp: j.ep.b });
    (adj.get(j.b.occ) ?? adj.set(j.b.occ, []).get(j.b.occ)!).push({ to: j.a.occ, myEp: j.ep.b, toEp: j.ep.a });
  }
  return adj;
}
const isTerminal = (sp?: HvacSpec) => !!sp && ['grille', 'diffuser'].includes(sp.kind);
const sizeOf = (sp: HvacSpec) => (sp.shape === 'round' ? `Ø${sp.D}` : `${sp.W}×${sp.H}`);

/** Calcula caudales, velocidades y pérdidas sobre el tendido unido por ePoints */
export function calcAssembly(): AsmCalc {
  const s = S(); const adj = graph(); const st = useAsmCalc.getState();
  const occs = s.asm.occurrences.filter((o) => !o.suppressed);
  // origen: UTA/fancoil, si no el componente fijo con más uniones
  const src = occs.find((o) => ['ahu', 'fancoil'].includes(specOf(o.part)?.kind ?? '')) ?? occs.filter((o) => o.grounded).sort((a, b) => (adj.get(b.id)?.length ?? 0) - (adj.get(a.id)?.length ?? 0))[0] ?? occs[0];
  if (!src) throw new Error('El ensamblaje está vacío');
  // árbol desde el origen
  const parent = new Map<string, string | null>([[src.id, null]]); const order = [src.id];
  for (let i = 0; i < order.length; i++) for (const e of adj.get(order[i]) ?? []) if (!parent.has(e.to)) { parent.set(e.to, order[i]); order.push(e.to); }
  const kids = new Map<string, string[]>(); for (const [c, p] of parent) if (p) (kids.get(p) ?? kids.set(p, []).get(p)!).push(c);
  // caudal: terminales (o componentes con caudal asignado) y suma aguas abajo
  const q = new Map<string, number>();
  for (const id of [...order].reverse()) { const o = s.asm.occurrences.find((x) => x.id === id)!; const own = o.flow ?? 0; q.set(id, own + (kids.get(id) ?? []).reduce((a, k) => a + (q.get(k) ?? 0), 0)); }
  const warnings: string[] = [];
  const terms = order.filter((id) => { const o = s.asm.occurrences.find((x) => x.id === id)!; return (o.flow ?? 0) > 0 || (isTerminal(specOf(o.part)) && !(kids.get(id)?.length)); });
  for (const id of terms) { const o = s.asm.occurrences.find((x) => x.id === id)!; if (!(o.flow ?? 0)) warnings.push(`${o.name}: sin caudal (clic derecho › Caudal de diseño…)`); }
  const rho = 1.2, rows: PieceCalc[] = [];
  for (const id of order) {
    const o = s.asm.occurrences.find((x) => x.id === id)!; const sp = specOf(o.part);
    const Q = q.get(id) ?? 0;
    if (!sp) { rows.push({ occ: id, name: o.name, kind: '—', size: '', q: Q, v: 0, R: 0, L: 0, dpF: 0, zeta: 0, dpS: 0, dp: 0 }); continue; }
    const sh = sp.shape === 'round' ? 'round' : 'rect';
    const a = sp.shape === 'round' ? sp.D : sp.W, b = sp.shape === 'round' ? sp.D : sp.H;
    const f = Q > 0 && a > 0 ? ductFriction(sh, a, b, Q) : { v: 0, R: 0 };
    let L = 0, zeta = 0, dpFix = 0;
    const Z = (idz: string) => FITTING_LOSSES.find((x) => x.id === idz)!;
    switch (sp.kind) {
      case 'duct': L = sp.L; break;
      case 'flex': L = sp.L; dpFix = (Z('flex').dp ?? 8) * sp.L / 1000; break;
      case 'elbow': zeta = (sp.shape === 'round' ? Z('elbow_round').zeta! : sp.elbowType === 'square' ? (sp.vanes ? Z('elbow_v').zeta! : Z('elbow_sq').zeta!) : Z('elbow_r').zeta!) * ((sp.angle ?? 90) / 90); break;
      case 'transition': zeta = Z('trans').zeta!; L = sp.L; break;
      case 'branch': zeta = Z('tee_run').zeta!; break;
      case 'damper': zeta = Z('damper').zeta!; break;
      case 'firedamper': dpFix = Z('fire').dp!; break;
      case 'silencer': dpFix = Z('silencer').dp!; break;
      case 'grille': dpFix = Z('grille').dp!; break;
      case 'diffuser': dpFix = Z('diffuser').dp!; break;
      default: break;
    }
    const dpF = f.R * L / 1000, dpS = zeta * 0.5 * rho * f.v * f.v + dpFix;
    const r: PieceCalc = { occ: id, name: o.name, kind: sp.kind, size: sizeOf(sp), q: Q, v: f.v, R: f.R, L, dpF, zeta, dpS, dp: dpF + dpS };
    if (Q > 0 && f.v > st.vMax) r.warn = `v ${f.v.toFixed(1)} > ${st.vMax} m/s`;
    else if (Q > 0 && sp.kind === 'duct' && f.R > st.rMax) r.warn = `R ${f.R.toFixed(2)} > ${st.rMax} Pa/m`;
    rows.push(r);
  }
  // pérdida acumulada del origen a cada terminal
  const dpOf = new Map(rows.map((r) => [r.occ, r.dp]));
  const paths = terms.map((t) => { let d = 0; const path: string[] = []; for (let c: string | null = t; c; c = parent.get(c) ?? null) { d += dpOf.get(c) ?? 0; path.push(c); } return { term: t, name: s.asm.occurrences.find((x) => x.id === t)!.name, dp: d, path }; }).sort((a, b) => b.dp - a.dp);
  const idx = paths[0]?.path ?? [];
  const res: AsmCalc = { rows, paths: paths.map(({ term, name, dp }) => ({ term, name, dp })), index: idx, fanDp: (paths[0]?.dp ?? 0) * 1.1, qTot: q.get(src.id) ?? 0, source: src.name, warnings };
  for (const r of rows) if (r.warn) warnings.push(`${r.name}: ${r.warn}`);
  useAsmCalc.setState({ calc: res });
  return res;
}

// ---------- soportes automáticos ----------
/** Soportes en trapecio (rectangular/oval) o abrazadera (circular) cada `spacing` mm en los tramos rectos horizontales */
export function addSupports(spacing = 2500, rod = 500, scope?: string[]) {
  const s = S(); const out: { pid: string; xf: Xform; name: string }[] = [];
  removeTagged('support', scope);
  const runs = s.asm.occurrences.filter((o) => (!scope || scope.includes(o.id)) && specOf(o.part)?.kind === 'duct');
  let skipped = 0;
  for (const o of runs) {
    const sp = specOf(o.part)!; const X = xfOf(o.id);
    const ax = v3.norm(qq.rotate(X.quat, [0, 0, 1]) as V3);
    const vert = Math.abs(ax[2]) > 0.8;
    if (!vert && Math.abs(ax[2]) > 0.2) { skipped++; continue; } // inclinado: sin soporte automático
    // vertical: ménsula a pared (el trapecio girado: brazos horizontales hacia el lado W del conducto)
    const up: V3 = vert ? v3.norm(qq.rotate(X.quat, [1, 0, 0]) as V3) : [0, 0, 1]; const xw = v3.norm(v3.cross(up, ax) as V3);
    // la anchura del soporte va en horizontal: si el lado W del conducto está en vertical se cambian W y H
    const wLocal = v3.norm(qq.rotate(X.quat, [1, 0, 0]) as V3); const swap = !vert && Math.abs(wLocal[2]) > 0.7;
    const ssp: HvacSpec = { ...sp, kind: 'support', L: vert ? 300 : rod, W: swap ? sp.H : sp.W, H: swap ? sp.W : sp.H, ends: 'none' };
    const pid = partFor(makeHvacPart(ssp));
    const n = Math.max(1, Math.round(sp.L / (vert ? Math.max(spacing, 3000) : spacing)));
    // base: X ↦ xw, Y ↦ arriba, Z ↦ eje del conducto
    const quat = quatFromBasis(xw, up, ax);
    for (let k = 0; k < n; k++) {
      const z = sp.L * (k + 0.5) / n;
      out.push({ pid, xf: { pos: xfPoint(X, [0, 0, z]) as V3, quat }, name: `${nameOf(pid)}` });
    }
  }
  s.commitAsm((a) => { const cnt = new Map<string, number>(); for (const it of out) { const c = (cnt.get(it.pid) ?? 0) + 1; cnt.set(it.pid, c); a.occurrences.push({ id: uid('o'), name: `${it.name}:${c}`, part: it.pid, xf: it.xf, grounded: true, tag: 'support' } as typeof a.occurrences[number]); } });
  s.notify(`${out.length} soporte(s) cada ≈${spacing} mm (verticales: ménsula a pared cada ≈${Math.max(spacing, 3000)} mm)${skipped ? ` · ${skipped} tramo(s) inclinado(s) sin soporte` : ''}`);
}
// ---------- aislamiento ----------
/** Espesor mínimo RITE IT 1.2.4.2.1 (λ = 0,04 W/m·K) */
export const riteMin = (where: 'int' | 'ext', mode: 'cold' | 'hot') => (where === 'int' ? (mode === 'hot' ? 20 : 30) : mode === 'hot' ? 30 : 50);
export function addInsulation(e: number, scope?: string[]) {
  const s = S(); removeTagged('insulation', scope);
  const out: { pid: string; xf: Xform }[] = []; let elb = 0, elbSkip = 0;
  for (const o of s.asm.occurrences) {
    if (scope && !scope.includes(o.id)) continue; const sp = specOf(o.part); if (!sp || (sp.kind !== 'duct' && sp.kind !== 'elbow')) continue;
    if (sp.kind === 'elbow') {
      // codo: otra «piel» de codo con el mismo eje (radio de eje igual) y el aislamiento como espesor
      const t = autoT(sp), sq = sp.shape === 'rect' && sp.elbowType === 'square'; if (sq) { elbSkip++; continue; }
      const base = sp.shape === 'round' ? sp.D : sp.W, rw = sp.rw ?? (sp.shape === 'round' ? 1.5 : 1), Rc = rw * base;
      const isp: HvacSpec = { ...sp, W: sp.W + 2 * t, H: sp.H + 2 * t, D: sp.D + 2 * t, t: e, rw: Rc / (base + 2 * t), ends: 'none', endsAt: undefined, material: 'Lana mineral 40 kg/m³' };
      try { const d = makeHvacPart(isp); d.iProperties.partNumber = `Aislamiento codo ${sp.angle ?? 90} ${sp.shape === 'round' ? 'Ø' + sp.D : sp.W + '×' + sp.H} e=${e}`; d.iProperties.description = `Aislamiento de ${e} mm para codo ${sp.shape === 'round' ? 'Ø' + sp.D : sp.W + '×' + sp.H}`; out.push({ pid: partFor(d), xf: xfOf(o.id) }); elb++; } catch { elbSkip++; }
      continue;
    }
    out.push({ pid: partFor(makeHvacPart({ ...sp, kind: 'insulation', ins: e, ends: 'none', material: 'Lana mineral 40 kg/m³' })), xf: xfOf(o.id) });
  }
  s.commitAsm((a) => { const cnt = new Map<string, number>(); for (const it of out) { const c = (cnt.get(it.pid) ?? 0) + 1; cnt.set(it.pid, c); a.occurrences.push({ id: uid('o'), name: `${nameOf(it.pid)}:${c}`, part: it.pid, xf: { pos: [...it.xf.pos] as V3, quat: [...it.xf.quat] as Xform['quat'] }, grounded: true, tag: 'insulation' } as typeof a.occurrences[number]); } });
  s.notify(`Aislamiento de ${e} mm en ${out.length - elb} tramo(s) recto(s) y ${elb} codo(s)${elbSkip ? ` · ${elbSkip} codo(s) rectos con álabes y accesorios: aislar en obra` : ' (accesorios: aislar en obra)'}`);
}
function removeTagged(tag: string, scope?: string[]) {
  const s = S(); const keep = (o: { tag?: string; xf: Xform }) => o.tag !== tag;
  if (scope) return; // en un ramal no se borran los de otros ramales
  if (s.asm.occurrences.some((o) => !keep(o as never))) s.commitAsm((a) => { a.occurrences = a.occurrences.filter((o) => keep(o as never)); });
}
// ---------- sistemas ----------
export function setSystem(occ: string, name: string, branch = true) {
  const ids = branch ? epGroup(occ) : [occ];
  S().commitAsm((a) => { for (const o of a.occurrences) if (ids.includes(o.id)) o.system = name || undefined; });
  S().notify(name ? `Sistema «${name}» en ${ids.length} componente(s)` : 'Sistema quitado');
}
// ---------- holguras ----------
/** Tras insertar: componentes no unidos a la pieza nueva cuya caja está a menos de `clear` mm */
export function clearanceCheck(occ: string, clear = 25) {
  const s = S(); const r = s.asmResult; if (!r) return [];
  const box = (id: string) => {
    const o = s.asm.occurrences.find((x) => x.id === id); const m = o && r.parts[o.part]?.mesh; if (!m) return null;
    const X = r.xf[id] ?? o.xf; const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const P = m.vertices; for (let i = 0; i < P.length; i += 3) { const w = xfPoint(X, [P[i], P[i + 1], P[i + 2]]); for (let k = 0; k < 3; k++) { if (w[k] < mn[k]) mn[k] = w[k]; if (w[k] > mx[k]) mx[k] = w[k]; } }
    return { mn, mx };
  };
  const me = box(occ); if (!me) return [];
  const linked = new Set([occ]); for (const j of s.asm.joints) { if (j.a.occ === occ) linked.add(j.b.occ); if (j.b.occ === occ) linked.add(j.a.occ); }
  const out: { id: string; name: string; gap: number }[] = [];
  for (const o of s.asm.occurrences) {
    if (linked.has(o.id) || o.suppressed || o.hidden || (o as { tag?: string }).tag) continue;
    const b = box(o.id); if (!b) continue;
    let d2 = 0, inside = true; for (let k = 0; k < 3; k++) { const g = Math.max(b.mn[k] - me.mx[k], me.mn[k] - b.mx[k]); if (g > 0) { d2 += g * g; inside = false; } }
    const gap = inside ? 0 : Math.sqrt(d2);
    if (gap < clear) out.push({ id: o.id, name: o.name, gap });
  }
  return out;
}

// ---------- utilidades ----------
function partFor(doc: PartDoc) { const s = S(); const fn = doc.iProperties.partNumber.replace(/[\\/:*?"<>|]+/g, '_') + '.i3p'; return s.docs.find((d) => d.fileName === fn)?.id ?? s.addDocument('part', doc, fn, false); }
const nameOf = (pid: string) => (S().docs.find((d) => d.id === pid)?.fileName ?? 'Pieza').replace(/\.i3p$/, '');
function quatFromBasis(x: V3, y: V3, z: V3): Xform['quat'] {
  const m = [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]]; const tr = m[0] + m[4] + m[8]; let qx, qy, qz, qw;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; qw = s / 4; qx = (m[7] - m[5]) / s; qy = (m[2] - m[6]) / s; qz = (m[3] - m[1]) / s; }
  else if (m[0] > m[4] && m[0] > m[8]) { const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; qw = (m[7] - m[5]) / s; qx = s / 4; qy = (m[1] + m[3]) / s; qz = (m[2] + m[6]) / s; }
  else if (m[4] > m[8]) { const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; qw = (m[2] - m[6]) / s; qx = (m[1] + m[3]) / s; qy = s / 4; qz = (m[5] + m[7]) / s; }
  else { const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; qw = (m[3] - m[1]) / s; qx = (m[2] + m[6]) / s; qy = (m[5] + m[7]) / s; qz = s / 4; }
  return [qx, qy, qz, qw];
}
