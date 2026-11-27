// Taller: centro de gravedad y peso de izado por unidad, etiquetas con QR, tornillería de uniones y presupuesto
import qrcode from 'qrcode-generator';
import { useStore } from '../core/store';
import type { PartDoc } from '../core/doc';
import type { HvacSpec } from '../core/hvac';
import type { PipeSpec } from '../core/piping';
import { xfPoint } from '../core/asm';
import { occKg, unitInfo, unitOf, segCfg } from './hvacops';
import { STATUS_NAMES } from './asmcalc';
import { buildSpools } from './fab';

const S = () => useStore.getState();
type XPart = PartDoc & { hvacSpec?: HvacSpec; pipeSpec?: PipeSpec };
const partOf = (pid: string) => S().docData(pid) as XPart | null;
const occs = () => S().asm.occurrences.filter((o) => !o.suppressed);
const f1 = (x: number, d = 1) => x.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------- Centro de gravedad e izado ----------
export function cogOf(ids: string[]) {
  const s = S(), r = s.asmResult; let m = 0; const c = [0, 0, 0];
  for (const id of ids) {
    const o = s.asm.occurrences.find((x) => x.id === id); if (!o) continue;
    const k = occKg(id); if (!(k > 0)) continue;
    const pr = r?.parts[o.part]?.props; const X = r?.xf[id] ?? o.xf;
    const p = pr ? xfPoint(X, pr.cog) : X.pos;
    for (let i = 0; i < 3; i++) c[i] += p[i] * k; m += k;
  }
  return { kg: m, cog: m ? c.map((x) => x / m) : [0, 0, 0] };
}
export function unitRows() {
  const rig = S().settings.liftExtra ?? 10;
  return (S().asm.segUnits ?? []).map((u) => {
    const i = unitInfo(u), g = cogOf(i.ids);
    return { u, n: i.ids.length, len: i.len, dims: i.dims, kg: i.kg, ok: i.ok, cog: g.cog, lift: i.kg * (1 + rig / 100) };
  });
}

// ---------- Etiquetas ----------
export interface Label { code: string; title: string; lines: string[]; qr: string }
export function labelItems(what: 'pieces' | 'units'): Label[] {
  const s = S(); const proj = s.project?.fdp?.name ?? s.asm.iProperties.project ?? '', asmName = s.fileName.replace(/\.[^.]+$/, '');
  if (what === 'units') return unitRows().map((r) => ({
    code: r.u.name, title: `Unidad de montaje ${r.u.name}`,
    lines: [`${r.n} piezas · ${Math.round(r.dims[0])}×${Math.round(r.dims[1])}×${Math.round(r.dims[2])} mm`, `Peso ${f1(r.kg)} kg · izado ${f1(r.lift)} kg`, `CdG ${r.cog.map((x) => Math.round(x)).join(', ')}`, `${asmName}${proj ? ' · ' + proj : ''}`],
    qr: `INV3D|${proj}|${asmName}|${r.u.name}|${r.kg.toFixed(1)}kg`,
  }));
  return occs().filter((o) => !o.tag).map((o) => {
    const pd = partOf(o.part); const kg = occKg(o.id); const u = unitOf(o.id);
    const sz = pd?.hvacSpec ? (pd.hvacSpec.shape === 'round' ? `Ø${pd.hvacSpec.D}` : `${pd.hvacSpec.W}×${pd.hvacSpec.H}`) + (pd.hvacSpec.kind === 'duct' ? ` L=${pd.hvacSpec.L}` : '') : pd?.pipeSpec ? `${pd.pipeSpec.size}${pd.pipeSpec.norm === 'ASME' ? '"' : ''}${pd.pipeSpec.length ? ' L=' + pd.pipeSpec.length : ''}` : '';
    return { code: o.name, title: pd?.iProperties?.description?.slice(0, 60) || o.name,
      lines: [`${sz}${sz ? ' · ' : ''}${pd?.iProperties?.material ?? ''}`.slice(0, 60), `${Number.isFinite(kg) ? f1(kg) + ' kg' : ''}${o.system ? ' · ' + o.system : ''}${u ? ' · ' + u.name : ''}`, `Estado: ${STATUS_NAMES[o.status ?? 'design']}`, `${asmName}${proj ? ' · ' + proj : ''}`],
      qr: `INV3D|${proj}|${asmName}|${o.name}|${u?.name ?? ''}|${Number.isFinite(kg) ? kg.toFixed(1) : ''}kg` };
  });
}
/** PDF de etiquetas: A4 con 2×7 etiquetas de 105×42 mm (o 1 por página de 100×50 para etiquetadora) */
export async function labelsPdf(items: Label[], fmt: 'a4' | 'roll' = 'a4') {
  const { jsPDF } = await import('jspdf');
  const doc = fmt === 'a4' ? new jsPDF({ unit: 'mm', format: 'a4' }) : new jsPDF({ unit: 'mm', format: [100, 50], orientation: 'landscape' });
  const W = fmt === 'a4' ? 105 : 100, H = fmt === 'a4' ? 42.4 : 50, per = fmt === 'a4' ? 14 : 1;
  items.forEach((it, i) => {
    if (i && i % per === 0) doc.addPage();
    const k = i % per, x = fmt === 'a4' ? (k % 2) * W : 0, y = fmt === 'a4' ? 0.6 + Math.floor(k / 2) * H : 0;
    const q = qrcode(0, 'M'); q.addData(it.qr); q.make();
    const n = q.getModuleCount(), qs = H - 8, cell = qs / n, qx = x + 4, qy = y + 4;
    doc.setFillColor(0, 0, 0);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) doc.rect(qx + c * cell, qy + r * cell, cell + 0.01, cell + 0.01, 'F');
    const tx = qx + qs + 3, tw = W - (tx - x) - 3;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(doc.splitTextToSize(it.code, tw)[0], tx, y + 9);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.text(doc.splitTextToSize(it.title, tw).slice(0, 2), tx, y + 14);
    doc.setFontSize(7.5); it.lines.forEach((l, j) => doc.text(doc.splitTextToSize(l, tw)[0] ?? '', tx, y + 23 + j * 4));
    if (fmt === 'a4') { doc.setDrawColor(210); doc.rect(x + 0.5, y + 0.5, W - 1, H - 1); }
  });
  return doc.output('blob');
}

// ---------- Tornillería y accesorios de unión ----------
export interface BoltRow { item: string; qty: number; unit: string; note: string }
/** Uniones embridadas del ensamblaje: TDC (esquineras, tornillos, clips, sellante), marco angular (tornillos M8 cada 150 mm)
 *  y bridas de tubería (espárragos, tuercas y junta por par de bridas) */
export function boltList(): { rows: BoltRow[]; joints: number } {
  const s = S(); const map = new Map<string, BoltRow>(); let joints = 0;
  const add = (item: string, qty: number, unit = 'ud', note = '') => { const r = map.get(item); if (r) r.qty += qty; else map.set(item, { item, qty, unit, note }); };
  const hv = (id: string) => partOf(s.asm.occurrences.find((o) => o.id === id)?.part ?? '')?.hvacSpec;
  // HVAC: cada junta es una unión; uniones brida-brida sin junta modelada también
  const done = new Set<string>();
  const hvJoint = (sp: HvacSpec, e: string) => {
    joints++;
    const per = sp.shape === 'round' ? Math.PI * sp.D : sp.shape === 'oval' ? Math.PI * sp.H + 2 * (sp.W - sp.H) : 2 * (sp.W + sp.H);
    const big = Math.max(sp.W ?? 0, sp.H ?? 0, sp.D ?? 0) > 1000;
    if (e === 'angle' || sp.shape !== 'rect') {
      const n = sp.shape === 'rect' ? 2 * (Math.ceil(sp.W / 150) + 1) + 2 * (Math.ceil(sp.H / 150) - 1) : Math.max(4, Math.ceil(per / 150));
      add('Tornillo M8×25 DIN 933 galv. + tuerca + arandela', n, 'ud', 'marco/aro angular, paso ≤ 150 mm');
    } else {
      add(`Esquinera TDC ${big ? '40' : '30'}`, 8, 'ud', '4 por brida'); add('Tornillo M8×25 DIN 933 galv. + tuerca', 4, 'ud', 'esquinas');
      const clips = 2 * Math.max(0, Math.ceil(sp.W / 300) - 1) * 2 + 2 * Math.max(0, Math.ceil(sp.H / 300) - 1) * 2;
      if (clips) add('Clip (grapa) TDC', clips, 'ud', 'cada 300 mm por lado, en las dos caras');
      add('Masilla/cordón sellante', Math.round(per) / 1000, 'm', 'esquinas y perímetro');
    }
  };
  for (const o of occs()) {
    const sp = hv(o.id); if (sp?.kind === 'gasket') { hvJoint(sp, (sp.ends as string) ?? 'tdc'); done.add(o.id); add(`Junta EPDM ${sp.shape === 'round' ? 'Ø' + sp.D : sp.W + '×' + sp.H}`, 1, 'ud', 'modelada'); }
  }
  for (const j of s.asm.joints) {
    if (!j.ep || j.suppressed) continue;
    const A = hv(j.a.occ), B = hv(j.b.occ);
    if (A && B && A.kind !== 'gasket' && B.kind !== 'gasket') {
      const fl = (sp: HvacSpec, ep: string) => { const on = sp.ends === 'tdc' || sp.ends === 'angle'; const at = sp.endsAt ?? 'both'; return on && (ep === 'ep1' ? at !== 'end' : at !== 'start'); };
      if (fl(A, j.ep.a) && fl(B, j.ep.b)) { hvJoint(A, A.ends as string); add(`Junta EPDM (no modelada) ${A.shape === 'round' ? 'Ø' + A.D : A.W + '×' + A.H}`, 1, 'ud', 'unión sin junta en el modelo'); }
    }
    // tubería: brida con brida por la cara
    const pa = partOf(s.asm.occurrences.find((o) => o.id === j.a.occ)?.part ?? ''), pb = partOf(s.asm.occurrences.find((o) => o.id === j.b.occ)?.part ?? '');
    if (pa?.pipeSpec?.kind === 'flange' && pb?.pipeSpec?.kind === 'flange' && j.ep.a === 'ep1' && j.ep.b === 'ep1') {
      joints++;
      const n = Number(pa.parameters.find((p) => p.name === 'n')?.expr ?? 4), bolt = /×\s*([^)]+)\)/.exec(pa.parameters.find((p) => p.name === 'Lt')?.comment ?? '')?.[1] ?? '';
      const asme = pa.pipeSpec.norm === 'ASME';
      add(`${asme ? 'Espárrago B18.31.2 SA-193 B7' : 'Tornillo/espárrago EN 1515-1'} ${bolt}`.trim(), n, 'ud', `${pa.pipeSpec.size}${asme ? '"' : ''} ${asme ? 'clase ' + pa.pipeSpec.rating : 'PN' + pa.pipeSpec.rating}`);
      add(`${asme ? 'Tuerca SA-194 2H' : 'Tuerca ISO 4032'} ${bolt}`.trim(), asme ? 2 * n : n, 'ud', '');
      add(`Junta ${asme ? 'espirometálica B16.20' : 'plana EN 1514-1'} ${pa.pipeSpec.size}${asme ? '" cl.' + pa.pipeSpec.rating : ' PN' + pa.pipeSpec.rating}`, 1, 'ud', '');
    }
  }
  const rows = [...map.values()].map((r) => ({ ...r, qty: r.unit === 'm' ? Math.round(r.qty * 10) / 10 : r.qty }));
  return { rows, joints };
}

// ---------- Presupuesto ----------
export interface Prices { sheet: number; pipe: number; other: number; insul: number; support: number; boltSet: number; shopH: number; siteH: number; rate: number; weld: number }
export const DEFAULT_PRICES: Prices = { sheet: 3.2, pipe: 4.5, other: 6, insul: 22, support: 35, boltSet: 6, shopH: 0.06, siteH: 0.08, rate: 38, weld: 28 };
export function budget(p: Prices) {
  const s = S(); let sheetKg = 0, pipeKg = 0, otherKg = 0, insulM2 = 0, supports = 0, missing = 0;
  for (const o of occs()) {
    const pd = partOf(o.part); const kg = occKg(o.id);
    if (o.tag === 'support') { supports++; continue; }
    if (o.tag === 'insulation') { const sp = pd?.hvacSpec; if (sp) { const e = 0; const per = sp.shape === 'round' ? Math.PI * sp.D : 2 * (sp.W + sp.H); insulM2 += ((per + e) * sp.L) / 1e6; } continue; }
    if (!Number.isFinite(kg)) { missing++; continue; }
    if (pd?.hvacSpec?.kind === 'gasket') continue; if (pd?.hvacSpec) sheetKg += kg; else if (pd?.pipeSpec) pipeKg += kg; else otherKg += kg;
  }
  const bj = boltList(); const welds = buildSpools().reduce((a, x) => a + x.welds.length, 0);
  const lines = [
    { k: 'Chapa y accesorios HVAC', q: sheetKg, u: 'kg', pu: p.sheet },
    { k: 'Tubería, bridas y accesorios', q: pipeKg, u: 'kg', pu: p.pipe },
    { k: 'Otros componentes (por peso)', q: otherKg, u: 'kg', pu: p.other },
    { k: 'Aislamiento', q: insulM2, u: 'm²', pu: p.insul },
    { k: 'Soportes', q: supports, u: 'ud', pu: p.support },
    { k: 'Juegos de unión (tornillería, juntas, clips)', q: bj.joints, u: 'ud', pu: p.boltSet },
    { k: 'Soldaduras de tubería', q: welds, u: 'ud', pu: p.weld },
    { k: 'Mano de obra de taller', q: (sheetKg + pipeKg) * p.shopH, u: 'h', pu: p.rate },
    { k: 'Mano de obra de montaje', q: (sheetKg + pipeKg + otherKg) * p.siteH, u: 'h', pu: p.rate },
  ].map((l) => ({ ...l, tot: l.q * l.pu }));
  return { lines, total: lines.reduce((a, l) => a + l.tot, 0), missing, kg: sheetKg + pipeKg + otherKg, cfg: segCfg() };
}
