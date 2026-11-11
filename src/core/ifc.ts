// Exportación IFC4 (ISO 16739-1, STEP físico): un elemento por componente con geometría teselada
// (IfcTriangulatedFaceSet), clase IFC según el tipo de pieza, material y conjunto de propiedades.

export interface IfcItem {
  cls: string; // IfcBuildingElementProxy, IfcMember, IfcBeam, IfcColumn, IfcPlate, IfcDuctSegment, IfcDuctFitting, IfcPipeSegment, IfcPipeFitting, IfcAirTerminal, IfcDamper, IfcMechanicalFastener…
  name: string; desc?: string; tag?: string; material?: string;
  props?: Record<string, string>;
  vertices: Float32Array; triangles: Uint32Array;
}

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
/** GlobalId IFC: 128 bits aleatorios en 22 caracteres de la base 64 de IFC */
export function ifcGuid(): string {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  let n = 0n; for (const x of b) n = (n << 8n) | BigInt(x);
  let s = '';
  for (let i = 0; i < 22; i++) { s = B64[Number(n & 63n)] + s; n >>= 6n; }
  return s;
}
/** Cadena STEP: apóstrofos y barras duplicados, no ASCII como \X2\HHHH\X0\ */
export function stepStr(t: string | undefined | null): string {
  if (t == null || t === '') return '$';
  let o = '';
  for (const ch of t) {
    const c = ch.codePointAt(0)!;
    if (ch === "'") o += "''";
    else if (ch === '\\') o += '\\\\';
    else if (c >= 32 && c < 127) o += ch;
    else if (c < 0x10000) o += `\\X2\\${c.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`;
    else o += `\\X4\\${c.toString(16).toUpperCase().padStart(8, '0')}\\X0\\`;
  }
  return `'${o}'`;
}
const num = (x: number) => { const r = Math.round(x * 1e4) / 1e4; const s = String(r); return /[.eE]/.test(s) ? s : s + '.'; };

/** Clases con 9 atributos (IfcElement + PredefinedType) */
const NINE = new Set(['IfcBuildingElementProxy', 'IfcMember', 'IfcBeam', 'IfcColumn', 'IfcPlate', 'IfcDuctSegment', 'IfcDuctFitting', 'IfcPipeSegment', 'IfcPipeFitting', 'IfcAirTerminal', 'IfcDamper', 'IfcFlowSegment', 'IfcFlowFitting']);

export function toIfc(items: IfcItem[], o: { project: string; fileName: string; author?: string; org?: string; site?: string; building?: string; storey?: string }): string {
  const L: string[] = [];
  let n = 0;
  const add = (e: string) => { n++; L.push(`#${n}=${e};`); return `#${n}`; };
  const now = new Date();
  // unidades y contexto
  const lu = add(`IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)`);
  const au = add(`IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)`);
  const vu = add(`IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)`);
  const pu = add(`IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)`);
  const mu = add(`IFCSIUNIT(*,.MASSUNIT.,.KILO.,.GRAM.)`);
  const units = add(`IFCUNITASSIGNMENT((${lu},${au},${vu},${pu},${mu}))`);
  const o0 = add(`IFCCARTESIANPOINT((0.,0.,0.))`);
  const ax = add(`IFCAXIS2PLACEMENT3D(${o0},$,$)`);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${ax},$)`);
  const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const person = add(`IFCPERSON($,${stepStr(o.author || 'INV3D')},$,$,$,$,$,$)`);
  const organ = add(`IFCORGANIZATION($,${stepStr(o.org || 'INV3D')},$,$,$)`);
  const po = add(`IFCPERSONANDORGANIZATION(${person},${organ},$)`);
  const app = add(`IFCAPPLICATION(${organ},'0.15','INV3D','INV3D')`);
  const oh = add(`IFCOWNERHISTORY(${po},${app},$,.ADDED.,$,$,$,${Math.floor(now.getTime() / 1000)})`);
  const project = add(`IFCPROJECT('${ifcGuid()}',${oh},${stepStr(o.project)},$,$,$,$,(${ctx}),${units})`);
  const lpSite = add(`IFCLOCALPLACEMENT($,${ax})`);
  const site = add(`IFCSITE('${ifcGuid()}',${oh},${stepStr(o.site || 'Emplazamiento')},$,$,${lpSite},$,$,.ELEMENT.,$,$,$,$,$)`);
  const lpB = add(`IFCLOCALPLACEMENT(${lpSite},${ax})`);
  const bld = add(`IFCBUILDING('${ifcGuid()}',${oh},${stepStr(o.building || 'Edificio')},$,$,${lpB},$,$,.ELEMENT.,$,$,$)`);
  const lpS = add(`IFCLOCALPLACEMENT(${lpB},${ax})`);
  const storey = add(`IFCBUILDINGSTOREY('${ifcGuid()}',${oh},${stepStr(o.storey || 'Planta 0')},$,$,${lpS},$,$,.ELEMENT.,0.)`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',${oh},$,$,${project},(${site}))`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',${oh},$,$,${site},(${bld}))`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',${oh},$,$,${bld},(${storey}))`);

  const els: string[] = [];
  const byMat = new Map<string, string[]>();
  for (const it of items) {
    const V = it.vertices, T = it.triangles;
    if (!V.length || !T.length) continue;
    // coordenadas (se fusionan vértices repetidos para reducir el fichero)
    const map = new Map<string, number>(), pts: string[] = [];
    const remap = new Int32Array(V.length / 3);
    for (let i = 0; i < V.length / 3; i++) {
      const k = `${num(V[i * 3])},${num(V[i * 3 + 1])},${num(V[i * 3 + 2])}`;
      let j = map.get(k); if (j == null) { j = pts.length; map.set(k, j); pts.push(`(${k})`); }
      remap[i] = j + 1;
    }
    const tris: string[] = [];
    for (let t = 0; t < T.length; t += 3) {
      const a = remap[T[t]], b = remap[T[t + 1]], c = remap[T[t + 2]];
      if (a === b || b === c || a === c) continue;
      tris.push(`(${a},${b},${c})`); 
    }
    if (!tris.length) continue;
    const pl = add(`IFCCARTESIANPOINTLIST3D((${pts.join(',')}))`);
    const fs = add(`IFCTRIANGULATEDFACESET(${pl},$,.T.,(${tris.join(',')}),$)`);
    const rep = add(`IFCSHAPEREPRESENTATION(${body},'Body','Tessellation',(${fs}))`);
    const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
    const lp = add(`IFCLOCALPLACEMENT(${lpS},${ax})`);
    const cls = it.cls.toUpperCase();
    const head = `'${ifcGuid()}',${oh},${stepStr(it.name)},${stepStr(it.desc)},$,${lp},${pds},${stepStr(it.tag)}`;
    let el: string;
    if (it.cls === 'IfcMechanicalFastener') el = add(`IFCMECHANICALFASTENER(${head},$,$,.BOLT.)`);
    else if (NINE.has(it.cls)) el = add(`${cls}(${head},.NOTDEFINED.)`);
    else el = add(`IFCBUILDINGELEMENTPROXY(${head},.NOTDEFINED.)`);
    els.push(el);
    if (it.material) { const l = byMat.get(it.material) ?? []; l.push(el); byMat.set(it.material, l); }
    const props = Object.entries({ Referencia: it.tag ?? '', Descripcion: it.desc ?? '', Material: it.material ?? '', ...(it.props ?? {}) }).filter(([, v]) => v);
    if (props.length) {
      const ps = props.map(([k, v]) => add(`IFCPROPERTYSINGLEVALUE(${stepStr(k)},$,IFCLABEL(${stepStr(v)}),$)`));
      const pset = add(`IFCPROPERTYSET('${ifcGuid()}',${oh},'Pset_INV3D',$,(${ps.join(',')}))`);
      add(`IFCRELDEFINESBYPROPERTIES('${ifcGuid()}',${oh},$,$,(${el}),${pset})`);
    }
  }
  if (!els.length) throw new Error('No hay geometría que exportar');
  add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${ifcGuid()}',${oh},$,$,(${els.join(',')}),${storey})`);
  for (const [m, list] of byMat) {
    const mat = add(`IFCMATERIAL(${stepStr(m)},$,$)`);
    add(`IFCRELASSOCIATESMATERIAL('${ifcGuid()}',${oh},$,$,(${list.join(',')}),${mat})`);
  }
  const iso = now.toISOString().slice(0, 19);
  return [
    'ISO-10303-21;', 'HEADER;',
    `FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');`,
    `FILE_NAME(${stepStr(o.fileName)},'${iso}',(${o.author ? stepStr(o.author) : "''"}),(${o.org ? stepStr(o.org) : "''"}),'INV3D','INV3D','');`,
    `FILE_SCHEMA(('IFC4'));`, 'ENDSEC;', 'DATA;', ...L, 'ENDSEC;', 'END-ISO-10303-21;', '',
  ].join('\n');
}

/** Clase IFC orientativa a partir de la descripción y el material de la pieza */
export function ifcClassFor(desc: string, material: string, kind: { hvac: boolean; pipe: boolean }): string {
  const d = desc.toLowerCase();
  const seg = /^(tubo|conducto|espirotubo)|tramo recto|tubo espiral|tubo de/.test(d);
  if (kind.hvac || /conducto|espirotubo|rejilla|difusor/.test(d)) {
    if (/rejilla|difusor|sombrerete/.test(d)) return 'IfcAirTerminal';
    if (/compuerta/.test(d)) return 'IfcDamper';
    return seg ? 'IfcDuctSegment' : 'IfcDuctFitting';
  }
  if (kind.pipe) return seg ? 'IfcPipeSegment' : 'IfcPipeFitting';
  if (/tornillo|perno|tuerca|arandela|esp[aá]rrago|iso 4017|iso 4762|iso 4032|iso 7089/.test(d)) return 'IfcMechanicalFastener';
  if (/chapa|placa|pletina|plancha/.test(d)) return 'IfcPlate';
  void material;
  return 'IfcBuildingElementProxy';
}
