// Redes de conductos: trazado sobre líneas 3D del esqueleto del ensamblaje, dimensionado, cálculo de la red
// (pérdidas, índice, equilibrado y ventilador), ruido (VDI 2081, orientativo), térmico (RITE IT 1.2.4.2),
// mediciones y generación automática de tubos y accesorios (espirotubo o rectangular).
import type { V3, PartDoc } from './doc';
import type { AsmDoc, Xform } from './asm';
import { q } from './asm';
import { ductFriction, EN_RECT, sheetThickness } from './hvacdata';
import { makeSpiroPart, SPIRO_D, tubeT, fitT, spigotL, type SpiroSpec } from './spiro';
import { makeHvacPart, type HvacSpec } from './hvac';

export interface DuctNet {
  id: string; name: string;
  /** líneas del esqueleto que forman el trazado (vacío = todas) */
  lines: string[];
  /** nodo de origen (impulsión del ventilador / UTA) */
  source?: V3;
  /** caudal y pérdida en cada terminal, por clave de nodo */
  terminals: Record<string, { q: number; name?: string }>;
  shape: 'spiro' | 'rect';
  method: 'vel' | 'fric';
  vmax: number; rmax: number; hmax: number;
  material: string; gasket: boolean;
  /** pérdida en cada terminal (difusor/rejilla), Pa */
  termDp: number;
  ins: { e: number; lambda: number; where: 'int' | 'ext'; mode: 'cold' | 'hot'; tAir: number; tAmb: number };
  nrTarget: number;
  generated?: string[];
}
export const newDuctNet = (id: string): DuctNet => ({
  id, name: 'Red de conductos', lines: [], terminals: {}, shape: 'spiro', method: 'vel', vmax: 6, rmax: 1, hmax: 400,
  material: 'Acero galvanizado DX51D+Z275', gasket: true, termDp: 30,
  ins: { e: 30, lambda: 0.04, where: 'int', mode: 'cold', tAir: 14, tAmb: 26 }, nrTarget: 35,
});

const v = {
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: V3) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
export const nodeKey = (p: V3) => p.map((x) => Math.round(x)).join(',');

// ---------- Grafo ----------
export interface NetNode { id: number; p: V3; key: string; edges: number[] }
export interface NetEdge { id: number; a: number; b: number }
export interface Graph { nodes: NetNode[]; edges: NetEdge[] }

/** Une extremos coincidentes y parte las líneas en los puntos donde llega otra línea (derivaciones en T). */
export function buildGraph(asm: AsmDoc, net: DuctNet): Graph {
  const lines = asm.skeleton.filter((l) => !net.lines.length || net.lines.includes(l.id)).map((l) => [l.a, l.b] as [V3, V3]);
  // partir en los extremos de otras líneas que caen en su interior
  const pts = lines.flatMap((l) => l);
  const segs: [V3, V3][] = [];
  for (const [a, b] of lines) {
    const d = v.sub(b, a), L = v.len(d); if (L < 1) continue;
    const u = v.mul(d, 1 / L);
    const ts = [0, L];
    for (const p of pts) { const t = v.dot(v.sub(p, a), u); if (t > 1 && t < L - 1 && v.len(v.sub(v.add(a, v.mul(u, t)), p)) < 1) ts.push(t); }
    ts.sort((x, y) => x - y);
    for (let i = 0; i + 1 < ts.length; i++) if (ts[i + 1] - ts[i] > 1) segs.push([v.add(a, v.mul(u, ts[i])), v.add(a, v.mul(u, ts[i + 1]))]);
  }
  const nodes: NetNode[] = [], edges: NetEdge[] = [];
  const nodeAt = (p: V3) => { let n = nodes.find((x) => v.len(v.sub(x.p, p)) < 1); if (!n) { n = { id: nodes.length, p, key: nodeKey(p), edges: [] }; nodes.push(n); } return n.id; };
  for (const [a, b] of segs) { const ia = nodeAt(a), ib = nodeAt(b); if (ia === ib) continue; const e = { id: edges.length, a: ia, b: ib }; edges.push(e); nodes[ia].edges.push(e.id); nodes[ib].edges.push(e.id); }
  return { nodes, edges };
}
export const leaves = (g: Graph) => g.nodes.filter((n) => n.edges.length === 1);
/** Nombre por defecto de un terminal: numeración correlativa de los extremos (sin contar el origen) */
export const termName = (g: Graph, src: number, node: number) => `Terminal ${leaves(g).filter((n) => n.id !== src).findIndex((n) => n.id === node) + 1}`;

// ---------- Árbol, caudales y dimensionado ----------
export interface Seg {
  edge: number; from: number; to: number; parent: number | null; children: number[];
  dir: V3; L: number; q: number;
  /** circular: D; rectangular: W (eje x del marco) × H (eje y) */
  D: number; W: number; H: number;
  /** marco de la sección (rectangular) */
  fx: V3; fy: V3;
  v: number; R: number; t: number;
}
export interface NetCalc {
  g: Graph; segs: Seg[]; source: number; errors: string[];
  /** por terminal: pérdida acumulada y presión a compensar */
  terms: { node: number; key: string; name: string; q: number; dp: number; excess: number }[];
  fan: { q: number; dp: number };
  rows: CalcRow[];
}
export interface CalcRow { seg: number; name: string; size: string; L: number; q: number; v: number; R: number; dpF: number; zeta: number; dpS: number; dpTot: number; lw: number; nr: number; tIn: number; tOut: number; qLoss: number; insOk: boolean; eMin: number }

const rho = 1.2, cp = 1005;
const sizeOf = (net: DuctNet, s: Seg) => (net.shape === 'spiro' ? `Ø${s.D}` : `${s.W}×${s.H}`);

function sizeRound(q: number, net: DuctNet, maxD?: number) {
  const list = SPIRO_D.filter((d) => !maxD || d <= maxD);
  for (const D of list) {
    const f = ductFriction('round', D, D, q);
    if (net.method === 'vel' ? f.v <= net.vmax : f.R <= net.rmax && f.v <= net.vmax * 1.5) return D;
  }
  return list[list.length - 1];
}
function sizeRect(q: number, net: DuctNet) {
  let best: [number, number] | null = null, per = Infinity;
  for (const H of EN_RECT) {
    if (H > net.hmax) break;
    for (const W of EN_RECT) {
      if (W < H || W > 4 * H) continue;
      const f = ductFriction('rect', W, H, q);
      const ok = net.method === 'vel' ? f.v <= net.vmax : f.R <= net.rmax && f.v <= net.vmax * 1.5;
      if (ok && W + H < per) { per = W + H; best = [W, H]; }
    }
  }
  return best ?? [EN_RECT[EN_RECT.length - 1], Math.min(net.hmax, 1000)];
}
/** Rotación mínima que lleva a sobre b, aplicada a un vector */
const rotBetween = (a: V3, b: V3, x: V3): V3 => q.rotate(q.between(a, b), x);

export function calcNet(asm: AsmDoc, net: DuctNet): NetCalc {
  const g = buildGraph(asm, net);
  const errors: string[] = [];
  if (!g.edges.length) return { g, segs: [], source: -1, errors: ['Dibuja el trazado con Línea 3D (esqueleto) en el ensamblaje'], terms: [], fan: { q: 0, dp: 0 }, rows: [] };
  const lv = leaves(g);
  let src = net.source ? g.nodes.reduce((b, n) => (v.len(v.sub(n.p, net.source!)) < v.len(v.sub(g.nodes[b].p, net.source!)) ? n.id : b), 0) : lv[0]?.id ?? 0;
  if (g.nodes[src].edges.length !== 1) errors.push('El origen debería ser un extremo libre del trazado');
  // árbol por recorrido en anchura
  const segs: Seg[] = [];
  const segOfEdge = new Map<number, number>();
  const seen = new Set([src]);
  const queue: [number, number | null][] = [[src, null]];
  while (queue.length) {
    const [n, parentSeg] = queue.shift()!;
    for (const eid of g.nodes[n].edges) {
      if (segOfEdge.has(eid)) continue;
      const e = g.edges[eid], to = e.a === n ? e.b : e.a;
      if (seen.has(to)) { errors.push('El trazado tiene un circuito cerrado: la red debe ser ramificada'); continue; }
      seen.add(to);
      const d = v.sub(g.nodes[to].p, g.nodes[n].p), L = v.len(d);
      const s: Seg = { edge: eid, from: n, to, parent: parentSeg, children: [], dir: v.norm(d), L, q: 0, D: 0, W: 0, H: 0, fx: [1, 0, 0], fy: [0, 0, 1], v: 0, R: 0, t: 0 };
      segOfEdge.set(eid, segs.length); segs.push(s);
      if (parentSeg !== null) segs[parentSeg].children.push(segs.length - 1);
      queue.push([to, segs.length - 1]);
    }
  }
  if (seen.size < g.nodes.length) errors.push('Hay tramos del trazado sin conectar al origen');
  // caudales (de las hojas hacia el origen)
  const termQ = (n: NetNode) => net.terminals[n.key]?.q ?? 500;
  const flow = (i: number): number => { const s = segs[i]; s.q = s.children.length ? s.children.reduce((a, c) => a + flow(c), 0) : termQ(g.nodes[s.to]); return s.q; };
  for (let i = 0; i < segs.length; i++) if (segs[i].parent === null) flow(i);
  // dimensionado y marcos de sección
  for (const s of segs) {
    const p = s.parent !== null ? segs[s.parent] : null;
    if (net.shape === 'spiro') { s.D = sizeRound(s.q, net, p?.D); s.W = s.H = s.D; }
    else { [s.W, s.H] = sizeRect(s.q, net); }
    if (!p) {
      let fx = v.cross([0, 0, 1], s.dir); if (v.len(fx) < 0.3) fx = [1, 0, 0];
      s.fx = v.norm(fx); s.fy = v.norm(v.cross(s.dir, s.fx));
    } else { s.fx = v.norm(rotBetween(p.dir, s.dir, p.fx)); s.fy = v.norm(rotBetween(p.dir, s.dir, p.fy)); }
    // la sección rectangular se orienta con la anchura en el eje x del marco heredado (sin girar el conducto)
    const f = net.shape === 'spiro' ? ductFriction('round', s.D, s.D, s.q) : ductFriction('rect', s.W, s.H, s.q);
    s.v = f.v; s.R = f.R;
    s.t = net.shape === 'spiro' ? tubeT(s.D) : sheetThickness('EN', 'rect', Math.max(s.W, s.H)).t;
  }
  // pérdidas: fricción + singulares en el nodo final de cada tramo (pertenecen al tramo que entra)
  const pd = (s: Seg) => 0.5 * rho * s.v * s.v;
  const rows: CalcRow[] = [];
  const pathDp = new Map<number, number>(), tempAt = new Map<number, number>();
  const ins = net.ins, lam = ins.lambda || 0.04;
  const eRef = ins.where === 'int' ? (ins.mode === 'hot' ? 20 : 30) : ins.mode === 'hot' ? 30 : 50;
  const eMin = Math.round(eRef * (lam / 0.04));
  const order = segs.map((_, i) => i); // en anchura: el padre siempre antes que el hijo
  for (const i of order) {
    const s = segs[i], p = s.parent !== null ? segs[s.parent] : null;
    let zeta = 0;
    if (p) {
      const ang = Math.acos(Math.max(-1, Math.min(1, v.dot(p.dir, s.dir)))) * 180 / Math.PI;
      const siblings = p.children.length;
      if (siblings === 1) { if (ang > 3) zeta += (net.shape === 'spiro' ? 0.3 : 0.21) * Math.pow(ang / 90, 0.7); }
      else zeta += ang < 10 ? 0.1 : ang < 60 ? 0.5 : 1.0;
      const area = (x: Seg) => (net.shape === 'spiro' ? x.D * x.D * Math.PI / 4 : x.W * x.H);
      if (area(s) < area(p) * 0.98) zeta += 0.05;
    } else zeta += 0.5; // entrada / unión al equipo
    const dpF = s.R * s.L / 1000, dpS = zeta * pd(s);
    const isLeaf = !s.children.length;
    const dpTot = (p ? pathDp.get(s.parent!)! : 0) + dpF + dpS + (isLeaf ? net.termDp : 0);
    pathDp.set(i, dpTot);
    // ruido regenerado en el tramo (VDI 2081): Lw = 10 + 50·log v + 10·log A
    const A = net.shape === 'spiro' ? Math.PI * s.D * s.D / 4e6 : s.W * s.H / 1e6;
    const lw = 10 + 50 * Math.log10(Math.max(0.1, s.v)) + 10 * Math.log10(A);
    // térmico: pérdida por metro a través del aislamiento (película exterior h = 8 W/m²K interior, 15 exterior)
    const Pm = net.shape === 'spiro' ? Math.PI * (s.D + ins.e) / 1000 : 2 * (s.W + s.H + 4 * ins.e / 2) / 1000;
    const Po = net.shape === 'spiro' ? Math.PI * (s.D + 2 * ins.e) / 1000 : 2 * (s.W + s.H + 4 * ins.e) / 1000;
    const tIn = p ? tempAt.get(s.parent!)! : ins.tAir;
    const Rp = (ins.e > 0 ? ins.e / 1000 / (lam * Pm) : 0) + 1 / ((ins.where === 'int' ? 8 : 15) * Po);
    const qm = (tIn - ins.tAmb) / Rp; // W/m (positivo = pierde calor)
    const mdot = rho * s.q / 3600;
    const tOut = tIn - (qm * s.L / 1000) / (mdot * cp);
    tempAt.set(i, tOut);
    rows.push({ seg: i, name: `T${i + 1}`, size: sizeOf(net, s), L: s.L, q: s.q, v: s.v, R: s.R, dpF, zeta, dpS, dpTot, lw, nr: Math.round(lw - 8), tIn, tOut, qLoss: qm * s.L / 1000, insOk: ins.e >= eMin, eMin });
  }
  const terms = segs.map((s, i) => ({ s, i })).filter(({ s }) => !s.children.length).map(({ s, i }) => {
    const n = g.nodes[s.to];
    return { node: n.id, key: n.key, name: net.terminals[n.key]?.name ?? termName(g, src, n.id), q: s.q, dp: pathDp.get(i)!, excess: 0 };
  });
  const idx = Math.max(0, ...terms.map((t) => t.dp));
  for (const t of terms) t.excess = idx - t.dp;
  const qTot = segs.filter((s) => s.parent === null).reduce((a, s) => a + s.q, 0);
  return { g, segs, source: src, errors, terms, fan: { q: qTot, dp: idx }, rows };
}

// ---------- Mediciones ----------
export interface Measure { group: string; code: string; desc: string; unit: string; qty: number }
export function measureNet(net: DuctNet, c: NetCalc, gen?: GenItem[]): Measure[] {
  const out: Measure[] = [];
  const add = (group: string, code: string, desc: string, unit: string, qty: number) => {
    const m = out.find((x) => x.code === code); if (m) m.qty += qty; else out.push({ group, code, desc, unit, qty });
  };
  for (const s of c.segs) {
    const L = s.L / 1000;
    if (net.shape === 'spiro') {
      add('Conductos', `TUBO-Ø${s.D}`, `Espirotubo Ø${s.D} mm, chapa ${String(s.t).replace('.', ',')} mm, ${net.material}`, 'm', L);
      add('Chapa', `CHAPA-${s.t}`, `Superficie de chapa e = ${String(s.t).replace('.', ',')} mm`, 'm²', Math.PI * s.D / 1000 * L);
    } else {
      add('Conductos', `RECT-${s.W}x${s.H}`, `Conducto rectangular ${s.W}×${s.H} mm, chapa ${String(s.t).replace('.', ',')} mm`, 'm', L);
      add('Chapa', `CHAPA-${s.t}`, `Superficie de chapa e = ${String(s.t).replace('.', ',')} mm`, 'm²', 2 * (s.W + s.H) / 1000 * L);
    }
    if (net.ins.e > 0) add('Aislamiento', `AISL-${net.ins.e}`, `Aislamiento e = ${net.ins.e} mm, λ = ${String(net.ins.lambda).replace('.', ',')} W/m·K`, 'm²',
      (net.shape === 'spiro' ? Math.PI * (s.D + 2 * net.ins.e) : 2 * (s.W + s.H + 4 * net.ins.e)) / 1000 * L);
    add('Soportes', net.shape === 'spiro' ? `ABR-Ø${s.D}` : `SOP-${s.W}`, net.shape === 'spiro' ? `Abrazadera de suspensión Ø${s.D} con varilla roscada` : `Soporte de perfil para conducto de ${s.W} mm`, 'ud', Math.max(1, Math.ceil(L / (net.shape === 'spiro' ? 3 : 2.5))));
  }
  for (const it of gen ?? []) if (it.kind !== 'tube' && it.kind !== 'duct') add('Accesorios', it.code, it.desc, 'ud', 1);
  for (const t of c.terms) add('Terminales', 'TERM', 'Unidad terminal (difusor / rejilla) con plénum', 'ud', 1);
  return out.map((m) => ({ ...m, qty: Math.round(m.qty * 100) / 100 }));
}

/** Texto a bytes Windows-1252 (juego «ANSI» que declara el BC3) */
export function cp1252(t: string): Uint8Array {
  const ex: Record<string, number> = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };
  const out = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i), ch = t[i]; out[i] = ex[ch] ?? (c < 256 && (c < 0x80 || c > 0x9f) ? c : 0x3f); }
  return out;
}

/** Presupuesto en formato FIEBDC-3 (BC3) con capítulos y mediciones, sin precios */
export function toBC3(name: string, ms: Measure[]): string {
  const date = new Date(), d = `${String(date.getDate()).padStart(2, '0')}${String(date.getMonth() + 1).padStart(2, '0')}${date.getFullYear()}`;
  const groups = [...new Set(ms.map((m) => m.group))];
  const cap = (gname: string, i: number) => `C${String(i + 1).padStart(2, '0')}#`;
  const L: string[] = [];
  L.push(`~V|INV3D|FIEBDC-3/2016\\${d}|INV3D|\\|ANSI|`);
  L.push('~K|\\2\\2\\3\\2\\2\\2\\2\\EUR\\|');
  L.push(`~C|${name.replace(/[|\\~]/g, ' ').slice(0, 20)}##||${name}|0|${d}|0|`);
  L.push(`~D|${name.replace(/[|\\~]/g, ' ').slice(0, 20)}##|${groups.map((gname, i) => `${cap(gname, i)}\\1\\1\\`).join('')}|`);
  groups.forEach((gname, i) => {
    L.push(`~C|${cap(gname, i)}||${gname}|0|${d}|0|`);
    const items = ms.filter((m) => m.group === gname);
    L.push(`~D|${cap(gname, i)}|${items.map((m) => `${m.code.replace(/[|\\~]/g, '-')}\\1\\${m.qty}\\`).join('')}|`);
    for (const m of items) L.push(`~C|${m.code.replace(/[|\\~]/g, '-')}|${m.unit}|${m.desc.replace(/[|\\~]/g, ' ')}|0|${d}|0|`);
  });
  return L.join('\r\n') + '\r\n';
}

// ---------- Generación de piezas ----------
export interface GenItem { kind: string; code: string; desc: string; fileName: string; make: () => PartDoc; xf: Xform; seg: number }

/** Pose a partir de los ejes locales X, Y, Z expresados en el mundo y del origen */
export function frameXf(origin: V3, X: V3, Z: V3): Xform {
  const x = v.norm(X), z = v.norm(Z), y = v.norm(v.cross(z, x));
  const m = [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
  const tr = m[0][0] + m[1][1] + m[2][2];
  let qx: number, qy: number, qz: number, qw: number;
  if (tr > 0) { const S = Math.sqrt(tr + 1) * 2; qw = 0.25 * S; qx = (m[2][1] - m[1][2]) / S; qy = (m[0][2] - m[2][0]) / S; qz = (m[1][0] - m[0][1]) / S; }
  else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const S = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; qw = (m[2][1] - m[1][2]) / S; qx = 0.25 * S; qy = (m[0][1] + m[1][0]) / S; qz = (m[0][2] + m[2][0]) / S; }
  else if (m[1][1] > m[2][2]) { const S = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; qw = (m[0][2] - m[2][0]) / S; qx = (m[0][1] + m[1][0]) / S; qy = 0.25 * S; qz = (m[1][2] + m[2][1]) / S; }
  else { const S = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; qw = (m[1][0] - m[0][1]) / S; qx = (m[0][2] + m[2][0]) / S; qy = (m[1][2] + m[2][1]) / S; qz = 0.25 * S; }
  if (qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; }
  return { pos: [...origin], quat: [qx, qy, qz, qw] };
}
const anyPerp = (d: V3): V3 => { let x = v.cross([0, 0, 1], d); if (v.len(x) < 0.3) x = v.cross([0, 1, 0], d); return v.norm(x); };
const fn = (pn: string) => pn.replace(/[\\/:*?"<>|]+/g, '_') + '.i3p';

export function generateNet(net: DuctNet, c: NetCalc): { items: GenItem[]; warnings: string[] } {
  const items: GenItem[] = [], warnings: string[] = [];
  const P = (n: number) => c.g.nodes[n].p;
  const spiro = (o: Partial<SpiroSpec>, xf: Xform, seg: number, kind: string) => {
    const spec: SpiroSpec = { kind: 'tube', D: 200, gasket: net.gasket, material: net.material, ...o } as SpiroSpec;
    const d = makeSpiroPart(spec); // para el nombre y la descripción
    items.push({ kind, code: d.iProperties.partNumber, desc: d.iProperties.description, fileName: fn(d.iProperties.partNumber), make: () => makeSpiroPart(spec), xf, seg });
  };
  const rectP = (o: Partial<HvacSpec>, xf: Xform, seg: number, kind: string) => {
    const spec: HvacSpec = { kind: 'duct', std: 'EN', shape: 'rect', W: 400, H: 300, D: 300, L: 1000, ends: 'tdc', material: net.material, ...o } as HvacSpec;
    const d = makeHvacPart(spec);
    items.push({ kind, code: d.iProperties.partNumber, desc: d.iProperties.description, fileName: fn(d.iProperties.partNumber), make: () => makeHvacPart(spec), xf, seg });
  };
  // reservas (longitud ocupada por accesorios) al principio y al final de cada tramo
  const startA = c.segs.map(() => 0), endA = c.segs.map(() => 0);
  const sizeIn = c.segs.map((s) => ({ D: s.D, W: s.W, H: s.H })); // sección con la que empieza el tramo (antes de la reducción)
  for (let i = 0; i < c.segs.length; i++) {
    const s = c.segs[i], node = P(s.to), u = s.dir;
    const kids = s.children.map((k) => c.segs[k]);
    if (kids.length === 1) {
      const k = kids[0], ang = Math.acos(Math.max(-1, Math.min(1, v.dot(u, k.dir))));
      sizeIn[s.children[0]] = { D: s.D, W: s.W, H: s.H };
      if (ang * 180 / Math.PI < 2) continue; // tramo recto: la reducción, si la hay, va en el hijo
      const X = v.norm(v.sub(k.dir, v.mul(u, v.dot(k.dir, u)))), deg = Math.round(ang * 180 / Math.PI);
      if (net.shape === 'spiro') {
        const Rc = s.D, T = Rc * Math.tan(ang / 2), Lm = spigotL(s.D);
        spiro({ kind: 'elbow', D: s.D, angle: deg, rd: 1 }, frameXf(v.sub(node, v.mul(u, T + Lm)), X, u), i, 'elbow');
        endA[i] = T; startA[s.children[0]] = T;
        if (![15, 30, 45, 60, 90].includes(deg)) warnings.push(`Codo de ${deg}° en ${c.rows[i]?.name ?? ''}: no es un ángulo comercial`);
      } else {
        const alongX = Math.abs(v.dot(s.fx, X)) > 0.5;
        const W = alongX ? s.W : s.H, H = alongX ? s.H : s.W, Rc = W, T = Rc * Math.tan(ang / 2);
        rectP({ kind: 'elbow', W, H, angle: deg, rw: 1, elbowType: 'radius', ends: 'none' }, frameXf(v.sub(node, v.mul(u, T)), X, u), i, 'elbow');
        endA[i] = T; startA[s.children[0]] = T;
      }
    } else if (kids.length >= 2) {
      // derivación: el hijo más alineado continúa el tramo principal
      const run = s.children.reduce((b, k) => (v.dot(c.segs[k].dir, u) > v.dot(c.segs[b].dir, u) ? k : b), s.children[0]);
      const brs = s.children.filter((k) => k !== run);
      if (v.dot(c.segs[run].dir, u) < 0.95) warnings.push(`Derivación en ${c.rows[i]?.name}: ningún tramo continúa recto; se usa el más alineado`);
      sizeIn[run] = { D: s.D, W: s.W, H: s.H };
      const br = c.segs[brs[0]];
      const w = v.norm(v.sub(br.dir, v.mul(u, v.dot(br.dir, u))));
      const angB = Math.acos(Math.max(-1, Math.min(1, v.dot(u, br.dir)))) * 180 / Math.PI;
      const cross = brs.length === 2 && v.dot(c.segs[brs[0]].dir, c.segs[brs[1]].dir) < -0.95;
      if (brs.length > 1 && !cross) warnings.push(`Nudo con ${kids.length} salidas en ${c.rows[i]?.name}: solo se modela la primera derivación`);
      if (net.shape === 'spiro') {
        const D = s.D, D2 = Math.min(br.D, D), Lm = spigotL(D), Lm2 = spigotL(D2), half = (D - 1) / 2;
        const t45 = angB < 60 && !cross;
        const k = t45 ? 'tee45' : cross ? 'cross' : 'tee';
        const L = t45 ? Math.round(D2 * Math.SQRT2 + 2 * Lm + 100) : D2 + 2 * Lm + 100, zb = L / 2;
        const zn = t45 ? zb - half : zb; // posición del nudo en el eje de la te
        spiro({ kind: k as SpiroSpec['kind'], D, D2 }, frameXf(v.sub(node, v.mul(u, zn)), w, u), i, 'tee');
        endA[i] = zn - Lm; startA[run] = L - Lm - zn;
        const arm = t45 ? half / Math.sin(Math.PI / 4) + 50 + Lm2 - Lm2 : half + 50;
        for (const b of brs) { startA[b] = arm; sizeIn[b] = { D: D2, W: D2, H: D2 }; }
      } else {
        const alongX = Math.abs(v.dot(s.fx, w)) > 0.5;
        const W = alongX ? s.W : s.H, H = alongX ? s.H : s.W;
        // la derivación: anchura a lo largo del principal, altura según el eje Y local de la te
        const W2 = Math.abs(v.dot(br.fx, u)) > 0.5 ? br.W : br.H, H2 = Math.abs(v.dot(br.fx, u)) > 0.5 ? br.H : br.W;
        const L = W2 + 200, zb = L / 2, half = W / 2;
        rectP({ kind: 'branch', branch: 'tee', W, H, shape2: 'rect', W2, H2: Math.min(H2, H), L, ends: 'none' }, frameXf(v.sub(node, v.mul(u, zb)), w, u), i, 'tee');
        endA[i] = zb; startA[run] = zb;
        for (const b of brs) { startA[b] = half + 150; sizeIn[b] = { D: 0, W: c.segs[b].W, H: c.segs[b].H }; }
      }
    }
  }
  // tramos rectos con reducción inicial si cambia la sección
  for (let i = 0; i < c.segs.length; i++) {
    const s = c.segs[i], a = P(s.from), u = s.dir;
    let st = startA[i];
    const inS = sizeIn[i];
    if (net.shape === 'spiro' && inS.D > s.D) {
      const Lm1 = spigotL(inS.D), Lc = Math.max(60, Math.round(inS.D - s.D));
      const pos = st + (st > 0 ? 150 : 0); // tubo corto del diámetro mayor si viene de un accesorio
      if (pos > st) spiroTube(i, inS.D, st, pos);
      spiro({ kind: 'reducer', D: inS.D, D2: s.D }, frameXf(v.add(a, v.mul(u, pos - Lm1)), anyPerp(u), u), i, 'reducer');
      st = pos + Lc;
    } else if (net.shape === 'rect' && (inS.W !== s.W || inS.H !== s.H)) {
      const Lt = 300;
      rectP({ kind: 'transition', W: inS.W, H: inS.H, shape2: 'rect', W2: s.W, H2: s.H, L: Lt, ends: 'none' }, frameXf(v.add(a, v.mul(u, st)), s.fx, u), i, 'transition');
      st += Lt;
    }
    const en = s.L - endA[i];
    if (en - st < -1) warnings.push(`${c.rows[i]?.name}: el tramo es demasiado corto para sus accesorios (faltan ${Math.round(st - en)} mm)`);
    if (en - st > 1) { if (net.shape === 'spiro') spiroTube(i, s.D, st, en); else rectDuct(i, st, en); }
  }
  function spiroTube(i: number, D: number, z0: number, z1: number) {
    const s = c.segs[i], a = P(s.from), u = s.dir, X = anyPerp(u);
    const total = z1 - z0, n = Math.ceil(total / 3000 - 1e-6);
    for (let k = 0; k < n; k++) {
      const l0 = z0 + (k * total) / n, l = total / n;
      spiro({ kind: 'tube', D, L: Math.round(l) }, frameXf(v.add(a, v.mul(u, l0)), X, u), i, 'tube');
      if (k > 0) { const Lm = spigotL(D); spiro({ kind: 'nipple', D }, frameXf(v.add(a, v.mul(u, l0 - Lm - 5)), X, u), i, 'nipple'); }
    }
  }
  function rectDuct(i: number, z0: number, z1: number) {
    const s = c.segs[i], a = P(s.from), u = s.dir;
    const total = z1 - z0, n = Math.ceil(total / 1500 - 1e-6);
    for (let k = 0; k < n; k++) {
      const l0 = z0 + (k * total) / n, l = total / n;
      rectP({ kind: 'duct', W: s.W, H: s.H, L: Math.round(l), ends: 'tdc' }, frameXf(v.add(a, v.mul(u, l0)), s.fx, u), i, 'duct');
    }
  }
  return { items, warnings };
}
