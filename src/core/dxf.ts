// Escritor DXF R12 (ASCII) mínimo: capas, polilíneas como LINE, textos.
import type { P2 } from './svgpath';

export interface DxfLayer { name: string; color: number; ltype?: 'CONTINUOUS' | 'DASHED' | 'CENTER' }
export interface DxfDoc { layers: DxfLayer[]; lines: { layer: string; pts: P2[]; closed?: boolean }[]; texts: { layer: string; x: number; y: number; h: number; text: string; rot?: number }[] }

const f = (n: number) => (Math.round(n * 10000) / 10000).toString();

export function writeDxf(doc: DxfDoc): string {
  const o: string[] = [];
  const g = (code: number, val: string | number) => { o.push(String(code), String(val)); };
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 3);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'LTYPE'); g(2, 'DASHED'); g(70, 0); g(3, '__ __ __'); g(72, 65); g(73, 2); g(40, 4.5); g(49, 3); g(49, -1.5);
  g(0, 'LTYPE'); g(2, 'CENTER'); g(70, 0); g(3, '____ _ ____'); g(72, 65); g(73, 4); g(40, 20); g(49, 12); g(49, -3); g(49, 2); g(49, -3);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, doc.layers.length);
  for (const l of doc.layers) { g(0, 'LAYER'); g(2, l.name); g(70, 0); g(62, l.color); g(6, l.ltype ?? 'CONTINUOUS'); }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const ln of doc.lines) {
    const pts = ln.closed ? [...ln.pts, ln.pts[0]] : ln.pts;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue;
      g(0, 'LINE'); g(8, ln.layer); g(10, f(a[0])); g(20, f(a[1])); g(30, 0); g(11, f(b[0])); g(21, f(b[1])); g(31, 0);
    }
  }
  for (const t of doc.texts) {
    g(0, 'TEXT'); g(8, t.layer); g(10, f(t.x)); g(20, f(t.y)); g(30, 0); g(40, f(t.h)); g(1, t.text.replace(/\n/g, ' ')); if (t.rot) g(50, f(t.rot));
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  return o.join('\r\n') + '\r\n';
}
