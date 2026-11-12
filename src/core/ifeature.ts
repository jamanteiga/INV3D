// eFamily (familias de piezas por tabla) y eOperaciones (operaciones reutilizables con parámetros).
import { uid, docParams, type PartDoc, type Feature, type SketchF, type PlaneRef } from './doc';

// ---------- eFamily ----------
export interface IPartTable { cols: string[]; rows: { name: string; values: string[] }[]; active: number }

/** Nombres que se pueden poner como columnas: parámetros de usuario y cotas de boceto. */
export function ipartCandidates(doc: PartDoc): string[] {
  const out = doc.parameters.map((p) => p.name);
  for (const f of doc.features) if (f.type === 'sketch') for (const c of f.constraints ?? []) if (c.type === 'dim' && c.name && !c.driven) out.push(c.name);
  return [...new Set(out)];
}
export function currentValue(doc: PartDoc, name: string): string {
  const p = doc.parameters.find((x) => x.name === name); if (p) return p.expr;
  for (const f of doc.features) if (f.type === 'sketch') for (const c of f.constraints ?? []) if (c.name === name) return c.expr ?? '';
  return '';
}
/** Aplica una fila de la tabla al documento (mutación). */
export function applyIPartRow(doc: PartDoc, t: IPartTable, i: number) {
  const row = t.rows[i]; if (!row) return;
  t.cols.forEach((name, k) => {
    const v = row.values[k]; if (v === undefined || v === '') return;
    const p = doc.parameters.find((x) => x.name === name);
    if (p) { p.expr = v; return; }
    for (const f of doc.features) if (f.type === 'sketch') for (const c of f.constraints ?? []) if (c.name === name) c.expr = v;
  });
  t.active = i;
  doc.iProperties.partNumber = row.name;
}

// ---------- eOperaciones ----------
export interface IFeatureDef { name: string; desc?: string; features: Feature[]; at: number }
export interface IFParam { key: string; label: string; expr: string }

const refsSketch = (f: Feature, id: string) => Object.values(f as unknown as Record<string, unknown>).some((v) => v === id || (typeof v === 'string' && v.startsWith(id + ':')) || (Array.isArray(v) && v.includes(id)));

/** Extrae un boceto y las operaciones que lo usan. */
export function extractIFeature(doc: PartDoc, sketchId: string, name: string): IFeatureDef {
  const sk = doc.features.find((f) => f.id === sketchId);
  if (!sk || sk.type !== 'sketch') throw new Error('Elige un boceto');
  const feats = [sk, ...doc.features.filter((f) => f.id !== sketchId && f.type !== 'sketch' && refsSketch(f, sketchId))];
  return { name, features: JSON.parse(JSON.stringify(feats)), at: Date.now() };
}

const NUM_FIELDS = ['distance', 'distance2', 'depth', 'dia', 'angle', 'thickness', 'radius', 'width', 'length', 'cbDia', 'cbDepth', 'csDia', 'd', 'w', 'h', 'pitch', 'turns', 'count', 'taper'] as const;
const FIELD_NAMES: Record<string, string> = { distance: 'Distancia', distance2: 'Distancia 2', depth: 'Profundidad', dia: 'Diámetro', angle: 'Ángulo', thickness: 'Espesor', radius: 'Radio', width: 'Anchura', length: 'Longitud', cbDia: 'Ø refrentado', cbDepth: 'Prof. refrentado', csDia: 'Ø avellanado', d: 'Diámetro', w: 'Anchura', h: 'Altura', pitch: 'Paso', turns: 'Vueltas', count: 'Cantidad', taper: 'Inclinación' };

/** Parámetros editables al insertar: cotas del boceto y valores de las operaciones. */
export function ifParams(def: IFeatureDef): IFParam[] {
  const out: IFParam[] = [];
  for (const f of def.features) {
    if (f.type === 'sketch') { for (const c of f.constraints ?? []) if (c.type === 'dim' && !c.driven && c.expr) out.push({ key: `c:${f.id}:${c.id}`, label: `${f.name} · ${c.name ?? 'cota'}`, expr: c.expr }); }
    else for (const k of NUM_FIELDS) { const v = (f as unknown as Record<string, unknown>)[k]; if (typeof v === 'string' && v) out.push({ key: `f:${f.id}:${k}`, label: `${f.name} · ${FIELD_NAMES[k]}`, expr: v }); }
  }
  return out;
}

/** Inserta la eOperación en un plano (mutación del documento). Las cotas se renombran para no chocar. */
export function insertIFeature(doc: PartDoc, def: IFeatureDef, plane: PlaneRef, values: Record<string, string>) {
  const feats: Feature[] = JSON.parse(JSON.stringify(def.features));
  // valores
  for (const [key, v] of Object.entries(values)) {
    const [t, fid, sub] = key.split(':');
    const f = feats.find((x) => x.id === fid); if (!f) continue;
    if (t === 'c' && f.type === 'sketch') { const c = (f.constraints ?? []).find((x) => x.id === sub); if (c) c.expr = v; }
    else if (t === 'f') (f as unknown as Record<string, unknown>)[sub] = v;
  }
  // nombres de cota nuevos
  const used = new Set(docParams(doc).map((p) => p.name));
  let n = 0;
  const rename = new Map<string, string>();
  for (const f of feats) if (f.type === 'sketch') for (const c of f.constraints ?? []) if (c.name) {
    while (used.has(`d${n}`)) n++;
    rename.set(c.name, `d${n}`); used.add(`d${n}`); c.name = `d${n}`;
  }
  const re = rename.size ? new RegExp(`\\b(${[...rename.keys()].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g') : null;
  // ids nuevos y referencias
  const ids = new Map(feats.map((f) => [f.id, uid('f')]));
  const fix = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (ids.has(v)) return ids.get(v);
      const pre = v.split(':')[0]; if (v.includes(':') && ids.has(pre)) return ids.get(pre) + v.slice(pre.length);
      return re ? v.replace(re, (m) => rename.get(m) ?? m) : v;
    }
    if (Array.isArray(v)) return v.map(fix);
    if (v && typeof v === 'object') { const o: Record<string, unknown> = {}; for (const [k, x] of Object.entries(v)) o[k] = k === 'entities' || k === 'name' || k === 'id' ? x : fix(x); return o; }
    return v;
  };
  const used2 = new Set(doc.features.map((f) => f.name));
  const out = feats.map((f) => {
    const g = fix(f) as Feature;
    g.id = ids.get(f.id)!;
    let nm = `${def.name}:${f.name}`, k = 1; while (used2.has(nm)) nm = `${def.name}${++k}:${f.name}`; used2.add(nm);
    g.name = nm;
    return g;
  });
  const sk = out.find((f) => f.type === 'sketch') as SketchF | undefined;
  if (sk) sk.plane = plane;
  doc.features.push(...out);
}
