// Subensamblajes: un componente del ensamblaje puede ser otro ensamblaje (.i3a).
// Para resolver, el subensamblaje se trata como un único sólido rígido (su ocurrencia de nivel superior);
// las referencias a caras de sus piezas («padre/hijo») se llevan a coordenadas del subensamblaje.
// Para dibujar y calcular la geometría se «aplana» en ocurrencias virtuales con id «padre/hijo».
import { solveAssembly, xfPoint, xfDir, q, type AsmDoc, type FaceRef, type Occurrence, type Xform } from './asm';

export type GetDoc = (id: string) => { kind: string; data: unknown } | null;
export interface FlatOcc extends Occurrence { /** ocurrencia de nivel superior a la que pertenece */ sub?: string; /** pose relativa al subensamblaje */ local?: Xform }

export const compose = (a: Xform, b: Xform): Xform => ({ pos: xfPoint(a, b.pos), quat: q.mul(a.quat, b.quat) });

/** Piezas de un subensamblaje con su pose respecto a su origen (recursivo, resuelve sus restricciones). */
export function subChildren(asmId: string, get: GetDoc, ev: (s: string) => number, depth = 0): { id: string; name: string; part: string; xf: Xform; hidden?: boolean }[] {
  const e = get(asmId); if (!e || e.kind !== 'assembly' || depth > 6) return [];
  const a = e.data as AsmDoc;
  const sol = solveAssembly(normalizeAsm(a, get, ev), ev).xf;
  const out: { id: string; name: string; part: string; xf: Xform; hidden?: boolean }[] = [];
  for (const o of a.occurrences) {
    if (o.suppressed) continue;
    const x = sol[o.id] ?? o.xf;
    const c = get(o.part);
    if (c?.kind === 'assembly') for (const k of subChildren(o.part, get, ev, depth + 1)) out.push({ id: `${o.id}/${k.id}`, name: `${o.name}/${k.name}`, part: k.part, xf: compose(x, k.xf), hidden: o.hidden || k.hidden });
    else out.push({ id: o.id, name: o.name, part: o.part, xf: x, hidden: o.hidden });
  }
  return out;
}

/** Pose local (dentro del subensamblaje de nivel superior) de una ocurrencia virtual «padre/hijo…». */
function localOf(id: string, asm: AsmDoc, get: GetDoc, ev: (s: string) => number, cache: Map<string, Xform | null>): { top: string; local: Xform } | null {
  const i = id.indexOf('/'); if (i < 0) return null;
  const top = id.slice(0, i), rest = id.slice(i + 1);
  const o = asm.occurrences.find((x) => x.id === top); if (!o) return null;
  const key = `${o.part}|${rest}`;
  if (!cache.has(key)) cache.set(key, subChildren(o.part, get, ev).find((k) => k.id === rest)?.xf ?? null);
  const local = cache.get(key);
  return local ? { top, local } : null;
}

/** Copia del ensamblaje con las referencias «padre/hijo» expresadas en el subensamblaje de nivel superior. */
export function normalizeAsm(asm: AsmDoc, get: GetDoc, ev: (s: string) => number): AsmDoc {
  if (!asm.joints.some((j) => j.a.occ.includes('/') || j.b.occ.includes('/') || j.c?.occ.includes('/'))) return asm;
  const cache = new Map<string, Xform | null>();
  const fix = (r: FaceRef): FaceRef => {
    const l = r.occ.includes('/') ? localOf(r.occ, asm, get, ev, cache) : null;
    if (!l) return r;
    return { ...r, occ: l.top, point: xfPoint(l.local, r.point), normal: xfDir(l.local, r.normal), center: r.center ? xfPoint(l.local, r.center) : undefined, xdir: r.xdir ? xfDir(l.local, r.xdir) : undefined };
  };
  return { ...asm, joints: asm.joints.map((j) => ({ ...j, a: fix(j.a), b: fix(j.b), c: j.c ? fix(j.c) : undefined })) };
}

export const hasSubs = (asm: AsmDoc, get: GetDoc) => asm.occurrences.some((o) => get(o.part)?.kind === 'assembly');

/** Ensamblaje aplanado para dibujar y calcular: las ocurrencias de subensamblaje se sustituyen por sus piezas. */
export function expandAsm(asm: AsmDoc, solved: Record<string, Xform>, get: GetDoc, ev: (s: string) => number): AsmDoc & { occurrences: FlatOcc[] } {
  const occ: FlatOcc[] = [];
  for (const o of asm.occurrences) {
    const x = solved[o.id] ?? o.xf;
    if (get(o.part)?.kind !== 'assembly') { occ.push({ ...o, xf: x }); continue; }
    if (o.suppressed) continue;
    for (const k of subChildren(o.part, get, ev)) occ.push({ id: `${o.id}/${k.id}`, name: `${o.name}/${k.name}`, part: k.part, xf: compose(x, k.xf), local: k.xf, grounded: true, hidden: o.hidden || k.hidden, sub: o.id });
  }
  return { ...asm, occurrences: occ, joints: [], patterns: [] };
}
