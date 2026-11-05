// Formatos de malla para impresión 3D y visualización: 3MF, OBJ y glTF binario (.glb),
// generados a partir del STL binario que produce el núcleo.
import { zipStore } from './zip';

export interface Mesh { pos: Float32Array; idx: Uint32Array }

/** Lee un STL binario y suelda los vértices repetidos. */
export function parseSTL(buf: ArrayBuffer): Mesh {
  const dv = new DataView(buf);
  const n = dv.getUint32(80, true);
  const map = new Map<string, number>();
  const pos: number[] = [], idx = new Uint32Array(n * 3);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    for (let k = 0; k < 3; k++) {
      const x = dv.getFloat32(o + k * 12, true), y = dv.getFloat32(o + k * 12 + 4, true), z = dv.getFloat32(o + k * 12 + 8, true);
      const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
      let i = map.get(key);
      if (i === undefined) { i = pos.length / 3; map.set(key, i); pos.push(x, y, z); }
      idx[t * 3 + k] = i;
    }
  }
  return { pos: new Float32Array(pos), idx };
}

const enc = new TextEncoder();
const xmlEsc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

export function to3MF(m: Mesh, name: string, color = '#B9BEC6'): Uint8Array {
  const v: string[] = [], t: string[] = [];
  for (let i = 0; i < m.pos.length; i += 3) v.push(`<vertex x="${+m.pos[i].toFixed(5)}" y="${+m.pos[i + 1].toFixed(5)}" z="${+m.pos[i + 2].toFixed(5)}"/>`);
  for (let i = 0; i < m.idx.length; i += 3) t.push(`<triangle v1="${m.idx[i]}" v2="${m.idx[i + 1]}" v3="${m.idx[i + 2]}"/>`);
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="es-ES" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">INV3D</metadata><metadata name="Title">${xmlEsc(name)}</metadata>
<resources><basematerials id="1"><base name="Material" displaycolor="${color.toUpperCase()}"/></basematerials>
<object id="2" name="${xmlEsc(name)}" type="model" pid="1" pindex="0"><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object></resources>
<build><item objectid="2"/></build></model>`;
  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
    { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
    { name: '3D/3dmodel.model', data: enc.encode(model) },
  ]);
}

export function toOBJ(m: Mesh, name: string): string {
  const out = [`# INV3D · ${name} · mm`, `o ${name.replace(/\s+/g, '_')}`];
  for (let i = 0; i < m.pos.length; i += 3) out.push(`v ${+m.pos[i].toFixed(5)} ${+m.pos[i + 1].toFixed(5)} ${+m.pos[i + 2].toFixed(5)}`);
  for (let i = 0; i < m.idx.length; i += 3) out.push(`f ${m.idx[i] + 1} ${m.idx[i + 1] + 1} ${m.idx[i + 2] + 1}`);
  return out.join('\n') + '\n';
}

/** glTF 2.0 binario. glTF usa metros con Y hacia arriba: se escala y se gira (Z arriba → Y arriba). */
export function toGLB(m: Mesh, name: string, color = '#B9BEC6'): Uint8Array {
  const nv = m.pos.length / 3;
  const pos = new Float32Array(m.pos.length);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) {
    const x = m.pos[i * 3] / 1000, y = m.pos[i * 3 + 2] / 1000, z = -m.pos[i * 3 + 1] / 1000;
    pos.set([x, y, z], i * 3);
    [x, y, z].forEach((c, k) => { if (c < min[k]) min[k] = c; if (c > max[k]) max[k] = c; });
  }
  const ib = new Uint8Array(m.idx.buffer.slice(0)), pb = new Uint8Array(pos.buffer);
  const pad4 = (n: number) => (n + 3) & ~3;
  const binLen = pad4(ib.byteLength) + pb.byteLength;
  const c = color.replace('#', ''), rgb = [0, 2, 4].map((k) => (parseInt(c.slice(k, k + 2), 16) / 255) ** 2.2);
  const json = {
    asset: { version: '2.0', generator: 'INV3D' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 1 }, indices: 0, material: 0 }] }],
    materials: [{ name: 'Material', pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: 0.6, roughnessFactor: 0.45 } }],
    buffers: [{ byteLength: binLen }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: ib.byteLength, target: 34963 }, { buffer: 0, byteOffset: pad4(ib.byteLength), byteLength: pb.byteLength, target: 34962 }],
    accessors: [
      { bufferView: 0, componentType: 5125, count: m.idx.length, type: 'SCALAR' },
      { bufferView: 1, componentType: 5126, count: nv, type: 'VEC3', min, max },
    ],
  };
  let js = enc.encode(JSON.stringify(json));
  const jl = pad4(js.byteLength); const jsp = new Uint8Array(jl).fill(0x20); jsp.set(js); js = jsp;
  const total = 12 + 8 + jl + 8 + binLen;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
  const b0 = 20 + jl;
  dv.setUint32(b0, binLen, true); dv.setUint32(b0 + 4, 0x004e4942, true);
  out.set(ib, b0 + 8); out.set(pb, b0 + 8 + pad4(ib.byteLength));
  return out;
}
