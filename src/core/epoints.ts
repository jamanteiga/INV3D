// ePoints: puntos de conexión guardados en la pieza para ensamblar automáticamente.
//  · Coincidencia: punto + normal de una cara (se enfrenta con otro ePoint de coincidencia del mismo nombre).
//  · Inserción: punto del eje en el extremo + dirección del eje + radio (tornillo ↔ taladro).
//  · Compuesto: grupo de ePoints que se conectan a la vez con otro compuesto del mismo nombre.
// Toda pieza tiene además un ePoint de inserción por defecto (el origen, o el que se defina), que es el punto
// por el que se coge la pieza al colocarla.
import { docParams, type PartDoc, type V3 } from './doc';
import { makeEval } from './expr';
import type { AsmDoc, FaceRef, Joint } from './asm';

export type EPointKind = 'mate' | 'insert' | 'composite';
export const EP_KIND_NAMES: Record<EPointKind, string> = { mate: 'Coincidencia', insert: 'Inserción', composite: 'Compuesto' };
export interface EPoint {
  id: string; name: string; kind: EPointKind;
  point: V3; dir: V3;
  /** Inserción: radio del cilindro (solo informativo) */
  radius?: number;
  /** Compuesto: ids de los ePoints que agrupa */
  members?: string[];
  /** Desfase al conectar (mm) */
  offset?: string;
  /** ePoint de inserción por defecto de la pieza */
  isDefault?: boolean;
  /** Desactivado por el diseñador: no se conecta ni se ofrece al colocar */
  inactive?: boolean;
  /** Plantilla ligada a los parámetros de la pieza: punto, radio y nombre ({expr} se sustituye por su valor) */
  tpl?: { point?: [string, string, string]; radius?: string; name?: string };
  /** Oculto en el modelo (solo visualización) */
  hidden?: boolean;
}

/** ePoints de la pieza, con el de inserción por defecto en primer lugar */
const tplCache = new WeakMap<PartDoc, EPoint[]>();
/** Resuelve los ePoints con plantilla según los parámetros actuales de la pieza */
function withTpl(doc: PartDoc): EPoint[] {
  const list = doc.epoints ?? [];
  if (!list.some((e) => e.tpl)) return list;
  const hit = tplCache.get(doc); if (hit) return hit;
  let ev: (s: string) => number;
  try { const e0 = makeEval(docParams(doc)); ev = (s) => { try { const v = e0(s); return Number.isFinite(v) ? v : NaN; } catch { return NaN; } }; } catch { return list; }
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const out = list.map((e) => {
    if (!e.tpl) return e;
    const n: EPoint = { ...e };
    if (e.tpl.point) { const p = e.tpl.point.map(ev); if (p.every(Number.isFinite)) n.point = p.map(r3) as V3; }
    if (e.tpl.radius) { const r = ev(e.tpl.radius); if (Number.isFinite(r)) n.radius = r3(r); }
    if (e.tpl.name) n.name = e.tpl.name.replace(/\{([^}]+)\}/g, (_, x: string) => { const v = ev(x); return Number.isFinite(v) ? String(Math.round(v * 10) / 10).replace('.', ',') : '?'; });
    return n;
  });
  tplCache.set(doc, out); return out;
}
export function partEPoints(doc: PartDoc | null | undefined): EPoint[] {
  if (!doc) return [];
  const list = withTpl(doc);
  const def = list.find((e) => e.isDefault);
  return def ? [def, ...list.filter((e) => e !== def)] : [{ id: 'ep0', name: 'ePoint de inserción', kind: 'insert', point: [0, 0, 0], dir: [0, 0, 1], isDefault: true }, ...list];
}
/** ePoints activos (los desactivados no se conectan ni se ofrecen al colocar) */
export const activeEPoints = (doc: PartDoc | null | undefined) => partEPoints(doc).filter((e) => !e.inactive);
/** Punto por el que se coge la pieza: su ePoint de inserción (si está desactivado, el origen) */
export const insertPoint = (doc: PartDoc | null | undefined): V3 => { const d = partEPoints(doc)[0]; return d && !d.inactive ? d.point : [0, 0, 0]; };

/** Referencia de unión de un ePoint de un componente */
export const epRef = (e: EPoint, occ: string): FaceRef => ref(e, occ);
const ref = (e: EPoint, occ: string): FaceRef => (e.kind === 'insert'
  ? { occ, point: e.point, normal: e.dir, kind: 'axis', radius: e.radius ?? 5, center: e.point }
  : { occ, point: e.point, normal: e.dir, kind: 'plane', center: e.point });

/** Conecta automáticamente los ePoints del mismo nombre y tipo entre componentes.
 *  `only`: ocurrencias recién colocadas (si se omite, todas). Devuelve las uniones nuevas. */
export function autoEPointJoints(asm: AsmDoc, getPart: (id: string) => PartDoc | null, only?: string[], uid: (p: string) => string = (p) => p + Math.random().toString(36).slice(2, 8)): Joint[] {
  const out: Joint[] = [];
  const used = new Set<string>(); // «occ:ePoint» ya conectados
  for (const j of asm.joints) { if (j.ep) { used.add(`${j.a.occ}:${j.ep.a}`); used.add(`${j.b.occ}:${j.ep.b}`); } }
  const occs = asm.occurrences.filter((o) => !o.suppressed);
  const eps = new Map(occs.map((o) => [o.id, partEPoints(getPart(o.part)).filter((e) => !e.isDefault && !e.inactive)]));
  const fixed = (id: string) => !!asm.occurrences.find((o) => o.id === id)?.grounded;
  const connect = (oA: string, eA: EPoint, oB: string, eB: EPoint, n: number) => {
    // se mueve el componente nuevo (o el libre)
    let [A, a, B, b] = [oA, eA, oB, eB];
    if (fixed(B) && !fixed(A)) [A, a, B, b] = [B, b, A, a];
    out.push({
      id: uid('j'), name: `ePoint ${a.name}${n > 1 ? ` ${n}` : ''}`, type: a.kind === 'insert' ? 'insert' : 'mate',
      a: ref(a, A), b: ref(b, B), offset: a.offset || b.offset || '0', angle: '0', ep: { a: a.id, b: b.id, name: a.name },
    });
    used.add(`${A}:${a.id}`); used.add(`${B}:${b.id}`);
  };
  const targets = only ? occs.filter((o) => only.includes(o.id)) : occs;
  for (const o of targets) {
    for (const e of eps.get(o.id) ?? []) {
      if (used.has(`${o.id}:${e.id}`)) continue;
      // otro componente con un ePoint libre del mismo nombre y tipo
      for (const p of occs) {
        if (p.id === o.id || (only && only.includes(p.id) && occs.indexOf(p) > occs.indexOf(o))) continue;
        const f = (eps.get(p.id) ?? []).find((x) => x.name === e.name && x.kind === e.kind && !used.has(`${p.id}:${x.id}`));
        if (!f) continue;
        if (e.kind === 'composite') {
          const mine = (e.members ?? []).map((id) => (eps.get(o.id) ?? []).find((x) => x.id === id)).filter(Boolean) as EPoint[];
          const theirs = (f.members ?? []).map((id) => (eps.get(p.id) ?? []).find((x) => x.id === id)).filter(Boolean) as EPoint[];
          let n = 0;
          for (const m of mine) {
            const t = theirs.find((x) => x.name === m.name && x.kind === m.kind) ?? theirs[mine.indexOf(m)];
            if (t && t.kind !== 'composite' && t.kind === m.kind) connect(p.id, t, o.id, m, ++n);
          }
          used.add(`${o.id}:${e.id}`); used.add(`${p.id}:${f.id}`);
        } else connect(p.id, f, o.id, e, 1);
        break;
      }
    }
  }
  return out;
}

/** Unión entre dos ePoints de componentes distintos (mueve el no fijo) */
export function epJoint(asm: AsmDoc, occA: string, a: EPoint, occB: string, b: EPoint, uid: (p: string) => string): Joint {
  let [A, ea, B, eb] = [occA, a, occB, b];
  const fixed = (id: string) => !!asm.occurrences.find((o) => o.id === id)?.grounded;
  if (fixed(A) && !fixed(B)) [A, ea, B, eb] = [B, b, A, a];
  const insert = ea.kind === 'insert' && eb.kind === 'insert';
  return { id: uid('j'), name: `ePoint ${ea.name}–${eb.name}`, type: insert ? 'insert' : 'mate', a: ref(ea, A), b: ref(eb, B), offset: ea.offset || eb.offset || '0', angle: '0', ep: { a: ea.id, b: eb.id, name: ea.name } };
}
