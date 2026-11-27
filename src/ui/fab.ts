// Fabricación desde el ensamblaje: anidado de desarrollos en chapas, spools de tubería (numeración, soldaduras,
// isométrico) y planos automáticos (taller por pieza y montaje con globos y lista de piezas).
import * as THREE from 'three';
import { useStore } from '../core/store';
import type { PartDoc } from '../core/doc';
import type { HvacSpec } from '../core/hvac';
import type { PipeSpec } from '../core/piping';
import { hvacFlatPieces, hvacThick, type P2 } from '../core/hvacflat';
import { cad } from '../core/cadClient';
import { flattenPath, bboxOf } from '../core/svgpath';
import { writeDxf } from '../core/dxf';
import { partEPoints } from '../core/epoints';
import { epFrame } from './hvacroute';
import { drwActions } from './actions';

const S = () => useStore.getState();
type XPart = PartDoc & { hvacSpec?: HvacSpec; pipeSpec?: PipeSpec };
const partOf = (pid: string) => S().docData(pid) as XPart | null;
const live = () => S().asm.occurrences.filter((o) => !o.suppressed && !o.tag);

// ======================= ANIDADO =======================
export interface NestPiece { name: string; part: string; t: number; material: string; polys: P2[][]; w: number; h: number; area: number }
export interface NestPlaced { p: NestPiece; x: number; y: number; rot: boolean }
export interface NestSheet { W: number; H: number; t: number; material: string; items: NestPlaced[]; usage: number }
const polyArea = (pl: P2[]) => { let a = 0; for (let i = 0; i + 1 < pl.length; i++) a += pl[i][0] * pl[i + 1][1] - pl[i + 1][0] * pl[i][1]; return Math.abs(a) / 2; };
const norm = (polys: P2[][]) => { const [x0, y0, x1, y1] = bboxOf(polys); return { polys: polys.map((pl) => pl.map(([x, y]) => [x - x0, y - y0] as P2)), w: x1 - x0, h: y1 - y0 }; };
const netArea = (polys: P2[][]) => { const a = polys.map(polyArea).sort((x, y) => y - x); return a.length ? a[0] - a.slice(1).reduce((s, x) => s + x, 0) : 0; };

/** Desarrollos de todas las piezas de chapa del ensamblaje (una entrada por unidad a cortar) */
export async function collectFlats(): Promise<{ pieces: NestPiece[]; skipped: string[] }> {
  const count = new Map<string, number>();
  for (const o of live()) count.set(o.part, (count.get(o.part) ?? 0) + 1);
  const pieces: NestPiece[] = [], skipped: string[] = [];
  for (const [pid, n] of count) {
    const pd = partOf(pid); if (!pd || !('features' in pd)) continue;
    const name = pd.iProperties?.partNumber ?? pid, mat = pd.iProperties?.material ?? '';
    const push = (nm: string, polys: P2[][], t: number, q: number) => { const z = norm(polys); const area = netArea(z.polys); for (let i = 0; i < q * n; i++) pieces.push({ name: nm, part: pid, t, material: mat, ...z, area }); };
    if (pd.hvacSpec) {
      const r = hvacFlatPieces(pd.hvacSpec);
      if (r) { if (!r.pieces.length) skipped.push(`${name} (no desarrollable)`); for (const p of r.pieces) push(`${name} · ${p.name}`, p.polys, hvacThick(pd.hvacSpec), p.qty); continue; }
    }
    if (pd.features.some((f) => String(f.type).startsWith('sm_'))) {
      try { const fr = await cad.flat(pd); push(name, fr.paths.flatMap((d) => flattenPath(d)).map((pl) => pl.map(([x, y]) => [x, -y] as P2)), fr.t, 1); }
      catch (e) { skipped.push(`${name} (${(e as Error).message})`); }
    }
  }
  return { pieces, skipped };
}

/** Anidado por estanterías (piezas por rectángulo envolvente, giro de 90° permitido), agrupado por espesor y material */
export function nest(pieces: NestPiece[], W: number, H: number, gap = 10, margin = 10): { sheets: NestSheet[]; tooBig: string[] } {
  const sheets: NestSheet[] = [], tooBig: string[] = [];
  const groups = new Map<string, NestPiece[]>();
  for (const p of pieces) { const k = `${p.t}|${p.material}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(p); }
  const UW = W - 2 * margin, UH = H - 2 * margin;
  for (const list of groups.values()) {
    // orientación: el lado largo en horizontal si cabe; si no, girada
    const items = list.map((p) => {
      let rot = p.h > p.w; let w = rot ? p.h : p.w, h = rot ? p.w : p.h;
      if (w > UW && h <= UW && w <= UH) { rot = !rot; [w, h] = [h, w]; }
      return { p, rot, w, h };
    }).filter((it) => (it.w <= UW && it.h <= UH) || (tooBig.push(`${it.p.name} (${Math.round(it.p.w)}×${Math.round(it.p.h)})`), false));
    items.sort((a, b) => b.h - a.h || b.w - a.w);
    // primer ajuste por estanterías en todas las chapas del grupo (la pieza puede girarse para entrar en una estantería)
    const shelves: { sh: NestSheet; y: number; h: number; x: number }[] = [], used = new Map<NestSheet, number>();
    const put = (sh: NestSheet, it: typeof items[0], x: number, y: number, rot: boolean) => sh.items.push({ p: it.p, x: margin + x, y: margin + y, rot });
    for (const it of items) {
      let done = false;
      for (const sf of shelves) {
        for (const [w, h, r] of [[it.w, it.h, it.rot], [it.h, it.w, !it.rot]] as [number, number, boolean][]) {
          if (h <= sf.h && sf.x + w <= UW) { put(sf.sh, it, sf.x, sf.y, r); sf.x += w + gap; done = true; break; }
        }
        if (done) break;
      }
      if (done) continue;
      let sh = [...used.keys()].find((x) => used.get(x)! + it.h <= UH);
      if (!sh) { sh = { W, H, t: list[0].t, material: list[0].material, items: [], usage: 0 }; sheets.push(sh); used.set(sh, 0); }
      const y = used.get(sh)!; shelves.push({ sh, y, h: it.h, x: it.w + gap }); used.set(sh, y + it.h + gap);
      put(sh, it, 0, y, it.rot);
    }
  }
  for (const sh of sheets) sh.usage = sh.items.reduce((s, it) => s + it.p.area, 0) / (sh.W * sh.H);
  return { sheets, tooBig };
}

/** Polilíneas de una pieza colocada, en coordenadas de la chapa */
export function placedPolys(it: NestPlaced): P2[][] {
  const { p } = it;
  return p.polys.map((pl) => pl.map(([x, y]) => (it.rot ? [it.x + (p.h - y), it.y + x] : [it.x + x, it.y + y]) as P2));
}

export function nestDxf(sheets: NestSheet[]): string {
  const lines: { layer: string; pts: P2[] }[] = [], texts: { layer: string; x: number; y: number; h: number; text: string }[] = [];
  let ox = 0;
  sheets.forEach((sh, i) => {
    lines.push({ layer: 'HOJA', pts: [[ox, 0], [ox + sh.W, 0], [ox + sh.W, sh.H], [ox, sh.H], [ox, 0]] });
    texts.push({ layer: 'TEXTO', x: ox, y: sh.H + 20, h: 14, text: `Chapa ${i + 1} · ${sh.W}x${sh.H} · e ${sh.t} · ${sh.material} · ${(sh.usage * 100).toFixed(1)} %` });
    for (const it of sh.items) {
      const pp = placedPolys(it);
      for (const pl of pp) lines.push({ layer: 'CORTE', pts: pl.map(([x, y]) => [x + ox, y] as P2) });
      const w = it.rot ? it.p.h : it.p.w, h = it.rot ? it.p.w : it.p.h;
      texts.push({ layer: 'TEXTO', x: ox + it.x + w / 2 - Math.min(w * 0.4, it.p.name.length * 2.5), y: it.y + h / 2, h: Math.min(8, Math.max(3, h / 12)), text: it.p.name });
    }
    ox += sh.W + 200;
  });
  return writeDxf({ layers: [{ name: 'HOJA', color: 8 }, { name: 'CORTE', color: 7 }, { name: 'TEXTO', color: 3 }], lines, texts });
}

// ======================= SPOOLS =======================
export interface Weld { id: string; a: string; b: string; type: 'BW' | 'SW'; size: string; p: THREE.Vector3 }
export interface Spool { id: string; occs: string[]; welds: Weld[]; cut: { name: string; len?: number; qty: number }[]; segs: [THREE.Vector3, THREE.Vector3][]; marks: { p: THREE.Vector3; kind: 'weld' | 'flange' | 'open'; label?: string }[]; lens: { a: THREE.Vector3; b: THREE.Vector3; L: number }[]; material: string; size: string }

const lineMeet = (P1: THREE.Vector3, D1: THREE.Vector3, P2v: THREE.Vector3, D2: THREE.Vector3) => {
  const w = P1.clone().sub(P2v), a = D1.dot(D1), b = D1.dot(D2), c = D2.dot(D2), d = D1.dot(w), e = D2.dot(w), den = a * c - b * b;
  if (Math.abs(den) < 1e-6) return null;
  const s = (b * e - c * d) / den, t = (a * e - b * d) / den;
  return P1.clone().addScaledVector(D1, s).add(P2v.clone().addScaledVector(D2, t)).multiplyScalar(0.5);
};

/** Divide la tubería del ensamblaje en spools (cortes en caras de brida y en equipos/válvulas) y numera soldaduras */
export function buildSpools(): Spool[] {
  const s = S();
  const pipeOcc = new Map(live().filter((o) => partOf(o.part)?.pipeSpec).map((o) => [o.id, o]));
  const face = (occ: string, ep: string) => partOf(pipeOcc.get(occ)!.part)?.pipeSpec?.kind === 'flange' && ep === 'ep1';
  const adj = new Map<string, { to: string; my: string; other: string }[]>();
  for (const j of s.asm.joints) {
    if (!j.ep || j.suppressed || !pipeOcc.has(j.a.occ) || !pipeOcc.has(j.b.occ)) continue;
    if (face(j.a.occ, j.ep.a) || face(j.b.occ, j.ep.b)) continue; // unión embridada: frontera de spool
    (adj.get(j.a.occ) ?? adj.set(j.a.occ, []).get(j.a.occ)!).push({ to: j.b.occ, my: j.ep.a, other: j.ep.b });
    (adj.get(j.b.occ) ?? adj.set(j.b.occ, []).get(j.b.occ)!).push({ to: j.a.occ, my: j.ep.b, other: j.ep.a });
  }
  const seen = new Set<string>(), spools: Spool[] = []; let wn = 0;
  for (const start of pipeOcc.keys()) {
    if (seen.has(start)) continue;
    const comp: string[] = [], st = [start]; seen.add(start);
    while (st.length) { const c = st.pop()!; comp.push(c); for (const e of adj.get(c) ?? []) if (!seen.has(e.to)) { seen.add(e.to); st.push(e.to); } }
    const sp: Spool = { id: `S-${String(spools.length + 1).padStart(2, '0')}`, occs: comp, welds: [], cut: [], segs: [], marks: [], lens: [], material: '', size: '' };
    const wdone = new Set<string>();
    for (const occ of comp) {
      const o = pipeOcc.get(occ)!, pd = partOf(o.part)!, ps = pd.pipeSpec!;
      sp.material ||= ps.material; sp.size ||= ps.norm === 'ASME' ? `${ps.size}"` : `DN${ps.size}`;
      const eps = partEPoints(pd).filter((e) => e.kind !== 'composite' && !e.inactive && !e.isDefault);
      const F = eps.map((e) => epFrame(occ, e.id)).filter(Boolean) as NonNullable<ReturnType<typeof epFrame>>[];
      // línea central de la pieza
      if (F.length === 2) {
        const m = Math.abs(F[0].D.dot(F[1].D)) > 0.999 ? null : lineMeet(F[0].P, F[0].D, F[1].P, F[1].D);
        if (m) { sp.segs.push([F[0].P, m], [m, F[1].P]); } else sp.segs.push([F[0].P, F[1].P]);
        if (ps.kind === 'pipe') sp.lens.push({ a: F[0].P, b: F[1].P, L: ps.length ?? F[0].P.distanceTo(F[1].P) });
      } else if (F.length > 2) {
        const c = lineMeet(F[0].P, F[0].D, F[1].P, F[1].D) ?? F[0].P.clone().add(F[1].P).multiplyScalar(0.5);
        for (const f of F) sp.segs.push([c, f.P]);
      }
      // extremos: soldadura (dentro del spool), brida (cara) o extremo libre/de unión a otro spool
      for (const f of F) {
        const link = adj.get(occ)?.find((e) => e.my === f.e.id);
        if (link) {
          const key = [occ, link.to].sort().join('|') + f.P.toArray().map((x) => Math.round(x)).join(',');
          if (wdone.has(key)) continue; wdone.add(key);
          const w: Weld = { id: `W-${String(++wn).padStart(3, '0')}`, a: o.name, b: pipeOcc.get(link.to)!.name, type: ps.sw || ps.flType === 'SW' ? 'SW' : 'BW', size: sp.size, p: f.P };
          sp.welds.push(w); sp.marks.push({ p: f.P, kind: 'weld', label: w.id });
        } else if (ps.kind === 'flange' && f.e.id === 'ep1') sp.marks.push({ p: f.P, kind: 'flange' });
        else sp.marks.push({ p: f.P, kind: 'open' });
      }
      const nm = pd.iProperties?.description || pd.iProperties?.partNumber || o.name;
      const ex = sp.cut.find((c) => c.name === nm && c.len === (ps.kind === 'pipe' ? ps.length : undefined));
      if (ex) ex.qty++; else sp.cut.push({ name: nm, len: ps.kind === 'pipe' ? ps.length ?? 0 : undefined, qty: 1 });
    }
    spools.push(sp);
  }
  return spools;
}

/** Isométrico del spool en SVG (Z arriba, ejes a 30°) con cotas de tubos y marcas de soldadura */
export function spoolSvg(sp: Spool, W = 520, H = 380): string {
  const c30 = Math.cos(Math.PI / 6), s30 = 0.5;
  const pr = (v: THREE.Vector3): P2 => [(v.x - v.y) * c30, -((v.x + v.y) * s30 + v.z)];
  const all = [...sp.segs.flat(), ...sp.marks.map((m) => m.p)].map(pr);
  if (!all.length) return '';
  const [x0, y0, x1, y1] = bboxOf([all]); const pad = 50, k = Math.min((W - 2 * pad) / Math.max(1, x1 - x0), (H - 2 * pad - 30) / Math.max(1, y1 - y0));
  const T = (v: THREE.Vector3) => { const [x, y] = pr(v); return [pad + (x - x0) * k, pad + 20 + (y - y0) * k] as P2; };
  const L = (a: P2, b: P2, st: string) => `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" ${st}/>`;
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Arial" font-size="10"><rect width="${W}" height="${H}" fill="#fff"/>`,
    `<text x="10" y="18" font-size="13" font-weight="bold">${sp.id} · ${sp.size} · ${sp.material}</text><text x="${W - 10}" y="18" text-anchor="end">${sp.welds.length} soldadura(s)</text>`];
  for (const [a, b] of sp.segs) out.push(L(T(a), T(b), 'stroke="#111" stroke-width="2.4" stroke-linecap="round"'));
  for (const l of sp.lens) {
    const a = T(l.a), b = T(l.b), dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1, ox = (-dy / n) * 12, oy = (dx / n) * 12;
    const A: P2 = [a[0] + ox, a[1] + oy], B: P2 = [b[0] + ox, b[1] + oy], ang = (Math.atan2(dy, dx) * 180) / Math.PI, rot = ang > 90 || ang < -90 ? ang + 180 : ang;
    out.push(L(A, B, 'stroke="#1e6fd9" stroke-width="0.7"'), `<text x="${((A[0] + B[0]) / 2 + ox * 0.4).toFixed(1)}" y="${((A[1] + B[1]) / 2 + oy * 0.4).toFixed(1)}" fill="#1e6fd9" text-anchor="middle" transform="rotate(${rot.toFixed(1)} ${((A[0] + B[0]) / 2 + ox * 0.4).toFixed(1)} ${((A[1] + B[1]) / 2 + oy * 0.4).toFixed(1)})">${Math.round(l.L)}</text>`);
  }
  for (const m of sp.marks) {
    const [x, y] = T(m.p);
    if (m.kind === 'weld') out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#d33"/><text x="${(x + 6).toFixed(1)}" y="${(y - 6).toFixed(1)}" fill="#d33">${m.label}</text>`);
    else if (m.kind === 'flange') out.push(`<rect x="${(x - 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" width="4" height="16" fill="#111"/>`);
    else out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#fff" stroke="#111"/>`);
  }
  out.push(`<g transform="translate(30 ${H - 30})" stroke="#888" font-size="9" fill="#888"><line x1="0" y1="0" x2="${(18 * c30).toFixed(1)}" y2="9"/><text x="18" y="16">X</text><line x1="0" y1="0" x2="${(-18 * c30).toFixed(1)}" y2="9"/><text x="-22" y="16">Y</text><line x1="0" y1="0" x2="0" y2="-18"/><text x="3" y="-18">Z</text></g></svg>`);
  return out.join('');
}

export function spoolsCsv(sps: Spool[]): string {
  const f = (x: number) => String(Math.round(x));
  const L = ['Spool;Elemento;Longitud corte mm;Cantidad', ...sps.flatMap((s) => s.cut.map((c) => [s.id, c.name, c.len != null ? f(c.len) : '', c.qty].join(';'))), '', 'Soldadura;Spool;Tipo;Tamaño;Entre;Y;X;Y;Z',
    ...sps.flatMap((s) => s.welds.map((w) => [w.id, s.id, w.type, w.size, w.a, w.b, f(w.p.x), f(w.p.y), f(w.p.z)].join(';')))];
  return '﻿' + L.join('\r\n');
}

// ======================= PLANOS AUTOMÁTICOS =======================
const sel = (id: string) => useStore.setState({ selItem: id });
const lastView = () => S().drw.views[S().drw.views.length - 1]?.id;

/** Plano de montaje: vista frontal, superior e isométrica del ensamblaje activo, globos y lista de piezas */
export async function assemblyDrawing() {
  const s = S(); const asmId = s.active, nm = s.fileName.replace(/\.[^.]+$/, '');
  if (s.kind !== 'assembly') return s.notify('Abre el ensamblaje', 'error');
  s.newDocument('drawing');
  await drwActions.placeBase(asmId, 'front', 1, false); const base = lastView();
  await drwActions.project('down'); sel(base);
  await drwActions.project('iso'); const iso = lastView();
  sel(iso); await drwActions.autoBalloons();
  S().commitDrw((d) => { d.title.title ||= `Montaje ${nm}`; });
  S().notify(`Plano de montaje de ${nm}: vistas, globos y lista de piezas`);
}

/** Planos de taller: uno por pieza distinta (alzado, planta, perfil, isométrica y desarrollo si es de chapa) */
export async function partDrawings(max = 25) {
  const s = S(); if (s.kind !== 'assembly') return s.notify('Abre el ensamblaje', 'error');
  const parts = [...new Set(live().map((o) => o.part))].filter((p) => { const d = partOf(p); return d && 'features' in d; });
  const todo = parts.slice(0, max); let n = 0;
  for (const pid of todo) {
    S().newDocument('drawing');
    await drwActions.placeBase(pid, 'front', 1, false); const base = lastView();
    await drwActions.project('right'); sel(base);
    await drwActions.project('down'); sel(base);
    await drwActions.project('iso');
    const pd = partOf(pid)!;
    if (pd.features.some((f) => String(f.type).startsWith('sm_'))) { drwActions.addSheet(); await drwActions.placeFlat(pid); }
    n++;
  }
  S().notify(`${n} plano(s) de taller creados${parts.length > max ? ` (de ${parts.length}; máximo ${max} por orden)` : ''}`);
}
