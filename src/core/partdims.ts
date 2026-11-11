// Cotas editables de una pieza (para cambiarlas desde el ensamblaje): parámetros de usuario, cotas de boceto,
// medidas de entidades sin cotas (rectángulos, círculos…) y distancias/espesores de las operaciones.
import type { PartDoc } from './doc';

export interface PartDim { group: string; label: string; expr: string; unit: 'mm' | 'deg' | ''; path: (string | number)[] }

const FEAT_FIELDS: Record<string, [string, string, PartDim['unit']][]> = {
  extrude: [['distance', 'Longitud', 'mm'], ['distance2', 'Longitud 2', 'mm'], ['taper', 'Inclinación', 'deg']],
  revolve: [['angle', 'Ángulo', 'deg']],
  fillet: [['radius', 'Radio', 'mm']],
  chamfer: [['distance', 'Distancia', 'mm']],
  shell: [['thickness', 'Espesor', 'mm']],
  hole: [['dia', 'Diámetro', 'mm'], ['depth', 'Profundidad', 'mm'], ['cbDia', 'Ø refrentado', 'mm'], ['cbDepth', 'Prof. refrentado', 'mm'], ['csDia', 'Ø avellanado', 'mm']],
  rib: [['thickness', 'Espesor', 'mm'], ['depth', 'Profundidad', 'mm']],
  coil: [['pitch', 'Paso', 'mm'], ['turns', 'Vueltas', '']],
  thicken: [['distance', 'Espesor', 'mm']],
  pattern: [['n1', 'Nº dir. 1', ''], ['d1', 'Separación 1', 'mm'], ['n2', 'Nº dir. 2', ''], ['d2', 'Separación 2', 'mm'], ['count', 'Nº de elementos', ''], ['angle', 'Ángulo total', 'deg']],
  pathpattern: [['count', 'Nº de elementos', '']],
  workplane: [['offset', 'Desfase', 'mm'], ['angle', 'Ángulo', 'deg']],
  sm_flange: [['length', 'Longitud', 'mm'], ['angle', 'Ángulo', 'deg']],
  sm_contour: [['width', 'Anchura', 'mm']],
  sm_punch: [['d', 'Diámetro', 'mm'], ['w', 'Ancho', 'mm'], ['h', 'Alto', 'mm']],
  surf_extrude: [['distance', 'Longitud', 'mm']],
  movebody: [['dx', 'Desplaz. X', 'mm'], ['dy', 'Desplaz. Y', 'mm'], ['dz', 'Desplaz. Z', 'mm'], ['angle', 'Giro', 'deg']],
};
const ENT_FIELDS: Record<string, [string, string, PartDim['unit']][]> = {
  rect: [['w', 'Ancho', 'mm'], ['h', 'Alto', 'mm']],
  circle: [['d', 'Diámetro', 'mm']],
  npoly: [['d', 'Ø circunscrito', 'mm'], ['n', 'Nº de lados', '']],
  arc: [['r', 'Radio', 'mm']],
  slot: [['w', 'Anchura ranura', 'mm']],
  ellipse: [['rx', 'Semieje X', 'mm'], ['ry', 'Semieje Y', 'mm']],
};
const DIM_KIND: Record<string, string> = { dist: 'Distancia', hdist: 'Dist. horizontal', vdist: 'Dist. vertical', len: 'Longitud', radius: 'Radio', diameter: 'Diámetro', angle: 'Ángulo', pldist: 'Dist. punto-línea', lldist: 'Dist. entre paralelas' };

export function partDims(doc: PartDoc): PartDim[] {
  const out: PartDim[] = [];
  doc.parameters.forEach((p, i) => out.push({ group: 'Parámetros', label: p.name + (p.comment ? ` · ${p.comment}` : ''), expr: p.expr, unit: '', path: ['parameters', i, 'expr'] }));
  if (doc.sheet) out.push({ group: 'Chapa', label: 'Espesor', expr: String(doc.sheet.t), unit: 'mm', path: ['sheet', 't'] });
  doc.features.forEach((f, fi) => {
    if (f.suppressed) return;
    if (f.type === 'sketch') {
      const cons = (f.constraints ?? []).map((c, ci) => ({ c, ci })).filter(({ c }) => c.type === 'dim' && !c.driven && c.expr != null);
      cons.forEach(({ c, ci }) => out.push({ group: f.name, label: `${DIM_KIND[c.kind ?? 'dist'] ?? 'Cota'}${c.name ? ` (${c.name})` : ''}`, expr: c.expr!, unit: c.kind === 'angle' ? 'deg' : 'mm', path: ['features', fi, 'constraints', ci, 'expr'] }));
      // sin cotas, las medidas viven en las entidades
      if (!cons.length) {
        const count: Record<string, number> = {};
        f.entities.forEach((e, ei) => {
          const fl = ENT_FIELDS[e.type]; if (!fl) return;
          const n = (count[e.type] = (count[e.type] ?? 0) + 1);
          const many = f.entities.filter((x) => x.type === e.type).length > 1;
          for (const [k, l, u] of fl) {
            const v = (e as unknown as Record<string, string>)[k];
            if (v != null) out.push({ group: f.name, label: `${l}${many ? ` ${n}` : ''}`, expr: v, unit: u, path: ['features', fi, 'entities', ei, k] });
          }
        });
      }
      return;
    }
    const fl = FEAT_FIELDS[f.type]; if (!fl) return;
    for (const [k, l, u] of fl) {
      const v = (f as unknown as Record<string, unknown>)[k];
      if (typeof v !== 'string' || v === '') continue;
      if (f.type === 'extrude' && k === 'distance2' && f.dir !== 'two') continue;
      if (f.type === 'extrude' && k === 'distance' && f.extent === 'through') continue;
      if (f.type === 'hole' && ((k === 'depth' && f.through) || (k.startsWith('cb') && f.kind !== 'cbore') || (k.startsWith('cs') && f.kind !== 'csink'))) continue;
      if (f.type === 'pattern' && ((f.ptype === 'rect') !== ['n1', 'd1', 'n2', 'd2'].includes(k) || ((k === 'n2' || k === 'd2') && !f.dir2))) continue;
      if (f.type === 'extrude' && k === 'taper' && !parseFloat(v)) continue;
      out.push({ group: f.name, label: l, expr: v, unit: u, path: ['features', fi, k] });
    }
  });
  return out;
}

/** Copia de la pieza con la cota cambiada */
export function setPartDim(doc: PartDoc, path: PartDim['path'], expr: string): PartDoc {
  const d = structuredClone(doc) as unknown as Record<string | number, unknown>;
  let o = d as Record<string | number, unknown>;
  for (let i = 0; i < path.length - 1; i++) o = o[path[i]] as Record<string | number, unknown>;
  const last = path[path.length - 1];
  o[last] = expr;
  return d as unknown as PartDoc;
}
