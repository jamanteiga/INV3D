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
/** Sección de una boca de conducto. xdir: dirección del lado W (rectangular/oval). male: extremo macho de espirotubo */
export interface Mouth { shape: 'rect' | 'round' | 'oval'; W: number; H: number; D: number; xdir: V3; male?: boolean; spiral?: boolean }
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
  /** Anclaje a la geometría: centro de cara plana o extremo de cara cilíndrica (se recoloca al cambiar la pieza) */
  anchor?: import('./epanchor').EpAnchor;
  /** Plantilla ligada a los parámetros de la pieza: punto, radio y nombre ({expr} se sustituye por su valor) */
  tpl?: { point?: [string, string, string]; radius?: string; name?: string; mw?: string; mh?: string };
  /** Boca de conducto: sección (para tender conductos y que las piezas encajen alineadas) */
  mouth?: Mouth;
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
    if (n.mouth && (e.tpl.mw || e.tpl.mh)) { const w = e.tpl.mw ? ev(e.tpl.mw) : NaN, h = e.tpl.mh ? ev(e.tpl.mh) : NaN; n.mouth = { ...n.mouth, ...(Number.isFinite(w) ? { W: r3(w) } : {}), ...(Number.isFinite(h) ? { H: r3(h) } : {}) }; }
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
  ? { occ, point: e.point, normal: e.dir, kind: 'axis', radius: e.radius ?? 5, center: e.point, ...(e.mouth ? { xdir: e.mouth.xdir } : {}) }
  : { occ, point: e.point, normal: e.dir, kind: 'plane', center: e.point });
/** Referencia de un ePoint dentro de una unión: si los dos no son de inserción, ambos actúan como plano (punto y normal) */
const jref = (e: EPoint, occ: string, insert: boolean): FaceRef => (insert ? ref(e, occ) : { occ, point: e.point, normal: e.dir, kind: 'plane', center: e.point });

/** Conecta automáticamente los ePoints del mismo nombre y tipo entre componentes.
 *  `only`: ocurrencias recién colocadas (si se omite, todas). Devuelve las uniones nuevas. */
export function autoEPointJoints(asm: AsmDoc, getPart: (id: string) => PartDoc | null, only?: string[], uid: (p: string) => string = (p) => p + Math.random().toString(36).slice(2, 8),
  /** si se da: solo se conectan ePoints que coinciden en el espacio (a menos de `tol` mm) */
  at?: { pos: (occ: string, p: [number, number, number]) => [number, number, number]; tol: number }): Joint[] {
  const out: Joint[] = [];
  // nunca dos uniones automáticas entre el mismo par de componentes (p. ej. un codo con sus dos bocas del mismo nombre que el conducto)
  const pairs = new Set<string>();
  const pk = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  for (const j of asm.joints) pairs.add(pk(j.a.occ, j.b.occ));
  const near = (oA: string, eA: EPoint, oB: string, eB: EPoint) => { if (!at) return true; const a = at.pos(oA, eA.point), b = at.pos(oB, eB.point); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= at.tol; };
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
        if (pairs.has(pk(o.id, p.id))) continue;
        const f = (eps.get(p.id) ?? []).find((x) => x.name === e.name && x.kind === e.kind && !used.has(`${p.id}:${x.id}`) && (e.kind === 'composite' || near(o.id, e, p.id, x)));
        if (!f) continue;
        pairs.add(pk(o.id, p.id));
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
  return { id: uid('j'), name: `ePoint ${ea.name}–${eb.name}`, type: insert ? 'insert' : 'mate', a: jref(ea, A, insert), b: jref(eb, B, insert), ...(insert && ea.mouth && eb.mouth ? { lock: true } : {}), offset: ea.offset || eb.offset || '0', angle: '0', ep: { a: ea.id, b: eb.id, name: ea.name } };
}

/** Las uniones entre ePoints toman la posición actual de sus ePoints (si la pieza cambia, la unión la sigue) */
export function refreshEpRefs(asm: AsmDoc, partDoc: (partId: string) => PartDoc | null): AsmDoc {
  if (!asm.joints.some((j) => j.ep)) return asm;
  let changed = false;
  const joints = asm.joints.map((j) => {
    if (!j.ep || j.a.occ.includes('/') || j.b.occ.includes('/')) return j;
    const get = (occ: string, id: string) => { const o = asm.occurrences.find((x) => x.id === occ); return o ? partEPoints(partDoc(o.part)).find((e) => e.id === id) : undefined; };
    const ea = get(j.a.occ, j.ep.a), eb = get(j.b.occ, j.ep.b); if (!ea || !eb) return j;
    const ins = j.type === 'insert'; const a = jref(ea, j.a.occ, ins), b = jref(eb, j.b.occ, ins);
    const same = (x: FaceRef, y: FaceRef) => JSON.stringify([x.point, x.normal, x.radius, x.xdir]) === JSON.stringify([y.point, y.normal, y.radius, y.xdir]);
    if (same(a, j.a) && same(b, j.b)) return j;
    changed = true; return { ...j, a: { ...j.a, ...a }, b: { ...j.b, ...b } };
  });
  return changed ? { ...asm, joints } : asm;
}
