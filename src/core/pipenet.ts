// Redes de tuberías: trazado sobre líneas 3D, dimensionado por velocidad, pérdidas (Darcy-Weisbach / Colebrook),
// comprobación de espesor (B31.3 / EN 13480), categoría PED por línea, luces entre soportes y generación
// automática de tubos, codos, tes, reducciones y bridas (ASME B16.9/B16.5 o EN 10253/EN 1092-1).
import type { V3, PartDoc } from './doc';
import type { AsmDoc } from './asm';
import { buildGraph, leaves, termName, frameXf, type Graph, type GenItem } from './ductnet';
import { makePipePart, od, wallOf, flangeDims, type PipeSpec } from './piping';
import { B169, REDUCER_H, RTEE_M, DN_NPS, NPS_DN, EN_OD, ASME_PIPE, PIPE_MATERIALS } from './pipedata';
import { colebrook } from './hvacdata';
import { STRESS, stressAt, pipeThickness, pedPiping, pipeSpan, type FluidGroup } from './pressure';

export interface PipeNet {
  id: string; name: string; lines: string[]; source?: V3;
  terminals: Record<string, { q: number; name?: string }>;
  norm: 'ASME' | 'EN';
  sizing: 'fixed' | 'vel'; size: string; vmax: number;
  sch: string; wall: number;
  elbow: 'LR' | 'SR';
  flanges: boolean; rating: number;
  material: string; fitMaterial: string; flMaterial: string;
  /** fluido */
  rho: number; mu: number; state: 'gas' | 'liquid'; group: FluidGroup;
  /** diseño */
  P: number; T: number; c: number; tol: number; code: 'B31.3' | 'EN'; stressMat: string;
  ins: number;
  generated?: string[];
}
export const newPipeNet = (id: string): PipeNet => ({
  id, name: 'Red de tuberías', lines: [], terminals: {}, norm: 'EN', sizing: 'vel', size: '100', vmax: 2, sch: 'STD', wall: 0, elbow: 'LR',
  flanges: true, rating: 16, material: 'P235GH (EN 10216-2)', fitMaterial: 'P235GH (EN 10216-2)', flMaterial: 'P245GH (EN 10222-2)',
  rho: 1000, mu: 0.001, state: 'liquid', group: 2, P: 10, T: 80, c: 1, tol: 12.5, code: 'EN', stressMat: 'P235GH (EN 10216-2)', ins: 0,
});

const v = {
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a: V3) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
};
const anyPerp = (d: V3): V3 => { let x = v.cross([0, 0, 1], d); if (v.len(x) < 0.3) x = v.cross([0, 1, 0], d); return v.norm(x); };

/** Tamaños disponibles con accesorios B16.9 */
export const pipeSizes = (norm: 'ASME' | 'EN') => (norm === 'ASME' ? Object.keys(ASME_PIPE).filter((s) => B169[s]) : Object.keys(EN_OD).filter((d) => DN_NPS[Number(d)] && B169[DN_NPS[Number(d)]]));
const nps = (net: PipeNet, size: string) => (net.norm === 'ASME' ? size : DN_NPS[Number(size)] ?? '');
const dnOf = (net: PipeNet, size: string) => (net.norm === 'ASME' ? NPS_DN[size] ?? 0 : Number(size));
export const sizeLabel = (net: PipeNet, size: string) => (net.norm === 'ASME' ? `${size}"` : `DN${size}`);

export interface PSeg { edge: number; from: number; to: number; parent: number | null; children: number[]; dir: V3; L: number; q: number; size: string; D: number; t: number; v: number; R: number }
export interface PipeCalc {
  g: Graph; segs: PSeg[]; source: number; errors: string[];
  rows: { seg: number; name: string; size: string; L: number; q: number; v: number; R: number; dp: number; dpTot: number }[];
  terms: { key: string; name: string; q: number; dp: number }[];
  check: { size: string; D: number; tn: number; treq: number; tNom: number; ok: boolean; ped: string; table: string; span: number; spanS: number; spanD: number }[];
  S: number;
}

export function calcPipe(asm: AsmDoc, net: PipeNet): PipeCalc {
  const g = buildGraph(asm, net), errors: string[] = [];
  const S = stressAt(STRESS.find((m) => m.name === net.stressMat) ?? STRESS[0], net.T);
  if (!g.edges.length) return { g, segs: [], source: -1, errors: ['Dibuja el trazado con Línea 3D (esqueleto) en el ensamblaje'], rows: [], terms: [], check: [], S };
  const lv = leaves(g);
  const src = net.source ? g.nodes.reduce((b, n) => (v.len(v.sub(n.p, net.source!)) < v.len(v.sub(g.nodes[b].p, net.source!)) ? n.id : b), 0) : lv[0]?.id ?? 0;
  const segs: PSeg[] = []; const used = new Set<number>(); const seen = new Set([src]);
  const queue: [number, number | null][] = [[src, null]];
  while (queue.length) {
    const [n, ps] = queue.shift()!;
    for (const eid of g.nodes[n].edges) {
      if (used.has(eid)) continue; used.add(eid);
      const e = g.edges[eid], to = e.a === n ? e.b : e.a;
      if (seen.has(to)) { errors.push('El trazado tiene un circuito cerrado'); continue; }
      seen.add(to);
      const d = v.sub(g.nodes[to].p, g.nodes[n].p);
      segs.push({ edge: eid, from: n, to, parent: ps, children: [], dir: v.norm(d), L: v.len(d), q: 0, size: net.size, D: 0, t: 0, v: 0, R: 0 });
      if (ps !== null) segs[ps].children.push(segs.length - 1);
      queue.push([to, segs.length - 1]);
    }
  }
  const tq = (k: string) => net.terminals[k]?.q ?? 10;
  const flow = (i: number): number => { const s = segs[i]; s.q = s.children.length ? s.children.reduce((a, c) => a + flow(c), 0) : tq(g.nodes[s.to].key); return s.q; };
  for (let i = 0; i < segs.length; i++) if (segs[i].parent === null) flow(i);
  const sizes = pipeSizes(net.norm);
  for (const s of segs) {
    const p = s.parent !== null ? segs[s.parent] : null;
    if (net.sizing === 'vel') {
      const maxI = p ? sizes.indexOf(p.size) : sizes.length - 1;
      let pick = sizes[Math.max(0, maxI)];
      for (let i = 0; i <= Math.max(0, maxI); i++) {
        const sz = sizes[i], D = od(net, sz), t = wallOf(net, sz), Di = (D - 2 * t) / 1000;
        if ((s.q / 3600) / (Math.PI * Di * Di / 4) <= net.vmax) { pick = sz; break; }
      }
      s.size = pick;
    }
    s.D = od(net, s.size); s.t = wallOf(net, s.size);
    const Di = (s.D - 2 * s.t) / 1000, A = Math.PI * Di * Di / 4;
    s.v = s.q / 3600 / A;
    const Re = (net.rho * s.v * Di) / net.mu, lam = Re > 2300 ? colebrook(Re, 0.045e-3 / Di) : 64 / Math.max(Re, 1);
    s.R = (lam / Di) * net.rho * s.v * s.v / 2;
  }
  // pérdidas acumuladas (accesorios con K típicos: codo RL 0,25 · RC 0,4 · te paso 0,4 / derivación 1,0 · reducción 0,1)
  const rows: PipeCalc['rows'] = [], acc = new Map<number, number>();
  segs.forEach((s, i) => {
    const p = s.parent !== null ? segs[s.parent] : null;
    let K = p ? 0 : 0.5;
    if (p) {
      const ang = Math.acos(Math.max(-1, Math.min(1, v.dot(p.dir, s.dir)))) * 180 / Math.PI;
      if (p.children.length > 1) K += ang < 10 ? 0.4 : 1.0;
      else if (ang > 2) K += (net.elbow === 'LR' ? 0.25 : 0.4) * Math.pow(ang / 90, 0.7);
      if (s.D < p.D) K += 0.1;
    }
    const dp = (s.R * s.L / 1000 + K * net.rho * s.v * s.v / 2) / 1e5; // bar
    const tot = (p ? acc.get(s.parent!)! : 0) + dp;
    acc.set(i, tot);
    rows.push({ seg: i, name: `L${i + 1}`, size: sizeLabel(net, s.size), L: s.L, q: s.q, v: s.v, R: s.R, dp, dpTot: tot });
  });
  const terms = segs.map((s, i) => ({ s, i })).filter(({ s }) => !s.children.length).map(({ s, i }) => ({ key: g.nodes[s.to].key, name: net.terminals[g.nodes[s.to].key]?.name ?? termName(g, src, s.to), q: s.q, dp: acc.get(i)! }));
  // comprobaciones por tamaño
  const mat = STRESS.find((m) => m.name === net.stressMat) ?? STRESS[0];
  const dens = PIPE_MATERIALS.find((m) => m.name === net.material)?.density ?? 7850;
  const check = [...new Set(segs.map((s) => s.size))].map((sz) => {
    const D = od(net, sz), tn = wallOf(net, sz);
    const r = pipeThickness({ code: net.code, P: net.P, D, S, c: net.c, tol: net.tol });
    const ped = pedPiping(net.state, net.group, net.P, dnOf(net, sz));
    const sp = pipeSpan({ D, t: tn, rhoPipe: dens, rhoFluid: net.rho, insE: net.ins, rhoIns: 100, S, E: mat.E });
    return { size: sizeLabel(net, sz), D, tn, treq: r.tm, tNom: r.tNom, ok: tn >= r.tNom, ped: ped.cat, table: ped.table, span: sp.L, spanS: sp.Ls, spanD: sp.Ld };
  });
  if (!isFinite(S)) errors.push('Temperatura fuera del rango tabulado para el material');
  return { g, segs, source: src, errors, rows, terms, check, S };
}

// ---------- Generación ----------
const fn = (pn: string) => pn.replace(/[\\/:*?"<>|]+/g, '_') + '.i3p';
export function generatePipe(net: PipeNet, c: PipeCalc): { items: GenItem[]; warnings: string[] } {
  const items: GenItem[] = [], warnings: string[] = [];
  const P = (n: number) => c.g.nodes[n].p;
  const put = (o: Partial<PipeSpec>, xf: GenItem['xf'], seg: number, kind: string) => {
    const spec: PipeSpec = { kind: 'pipe', norm: net.norm, size: net.size, sch: net.sch, wall: net.wall || undefined, material: kind === 'pipe' ? net.material : kind === 'flange' ? net.flMaterial : net.fitMaterial, ...o } as PipeSpec;
    let d: PartDoc; try { d = makePipePart(spec); } catch (e) { warnings.push(`${(e as Error).message} (${kind} ${spec.size})`); return; }
    items.push({ kind, code: d.iProperties.partNumber, desc: d.iProperties.description, fileName: fn(d.iProperties.partNumber), make: () => makePipePart(spec), xf, seg });
  };
  const startA = c.segs.map(() => 0), endA = c.segs.map(() => 0);
  const inSize = c.segs.map((s) => s.size);
  const flY = (size: string) => { const fd = flangeDims({ kind: 'flange', norm: net.norm, size, rating: net.rating, flType: net.norm === 'EN' ? '11' : 'WN', material: '' } as PipeSpec); return fd ? Math.max(fd.Y, fd.tf) : 0; };
  // bridas en el origen y en los terminales
  if (net.flanges) {
    for (let i = 0; i < c.segs.length; i++) {
      const s = c.segs[i];
      const fl = (node: V3, into: V3) => put({ kind: 'flange', size: s.size, rating: net.rating, flType: net.norm === 'EN' ? '11' : 'WN', facing: 'RF' }, frameXf(node, anyPerp(into), into), i, 'flange');
      if (s.parent === null) { fl(P(s.from), s.dir); startA[i] = flY(s.size); }
      if (!s.children.length) { fl(P(s.to), v.mul(s.dir, -1)); endA[i] = flY(s.size); }
    }
  }
  for (let i = 0; i < c.segs.length; i++) {
    const s = c.segs[i], node = P(s.to), u = s.dir, kids = s.children;
    const F = B169[nps(net, s.size)];
    if (!F) { warnings.push(`Sin accesorios B16.9 para ${sizeLabel(net, s.size)}`); continue; }
    if (kids.length === 1) {
      const k = c.segs[kids[0]], ang = Math.acos(Math.max(-1, Math.min(1, v.dot(u, k.dir))));
      inSize[kids[0]] = s.size;
      if (ang * 180 / Math.PI < 2) continue;
      const deg = Math.round(ang * 180 / Math.PI), R = net.elbow === 'LR' ? F[0] : F[2] || F[0];
      if (deg !== 90 && deg !== 45) warnings.push(`${c.rows[i].name}: codo de ${deg}° (B16.9 normaliza 45° y 90°; se modela a medida)`);
      const T = R * Math.tan(ang / 2), X = v.norm(v.sub(k.dir, v.mul(u, v.dot(k.dir, u))));
      put({ kind: 'elbow', size: s.size, elbow: net.elbow, angle: deg as 90 }, frameXf(v.sub(node, v.mul(u, T)), X, u), i, 'elbow');
      endA[i] = T; startA[kids[0]] = T;
    } else if (kids.length >= 2) {
      const run = kids.reduce((b, k) => (v.dot(c.segs[k].dir, u) > v.dot(c.segs[b].dir, u) ? k : b), kids[0]);
      const brs = kids.filter((k) => k !== run), br = c.segs[brs[0]];
      const w = v.norm(v.sub(br.dir, v.mul(u, v.dot(br.dir, u))));
      const red = br.size !== s.size;
      const C = F[3], M = red ? RTEE_M[`${nps(net, s.size)}x${nps(net, br.size)}`] ?? C : C;
      if (red && !RTEE_M[`${nps(net, s.size)}x${nps(net, br.size)}`]) warnings.push(`Te reducida ${sizeLabel(net, s.size)}×${sizeLabel(net, br.size)} no normalizada`);
      put({ kind: red ? 'rtee' : brs.length === 2 ? 'cross' : 'tee', size: s.size, size2: red ? br.size : undefined }, frameXf(node, u, w), i, 'tee');
      endA[i] = C; startA[run] = C; inSize[run] = s.size;
      for (const b of brs) { startA[b] = M; inSize[b] = red ? br.size : s.size; }
    }
  }
  for (let i = 0; i < c.segs.length; i++) {
    const s = c.segs[i], a = P(s.from), u = s.dir;
    let st = startA[i];
    if (inSize[i] !== s.size) {
      const H = REDUCER_H[nps(net, inSize[i])] ?? 100;
      put({ kind: 'reducer', size: inSize[i], size2: s.size }, frameXf(v.add(a, v.mul(u, st)), anyPerp(u), u), i, 'reducer');
      st += H;
    }
    const en = s.L - endA[i];
    if (en - st < -1) warnings.push(`${c.rows[i].name}: tramo demasiado corto para sus accesorios (faltan ${Math.round(st - en)} mm)`);
    if (en - st > 1) {
      const total = en - st, n = Math.ceil(total / 6000 - 1e-6);
      for (let k = 0; k < n; k++) put({ kind: 'pipe', size: s.size, length: Math.round(total / n) }, frameXf(v.add(a, v.mul(u, st + (k * total) / n)), anyPerp(u), u), i, 'pipe');
    }
  }
  return { items, warnings };
}
