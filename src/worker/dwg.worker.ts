// Lectura de DWG con LibreDWG en un worker (aislado de la página)
import { dwgDbToGeo } from '../core/cad2d';
self.onmessage = async (ev: MessageEvent<{ buf: ArrayBuffer; base: string }>) => {
  try {
    const m: any = await import('@mlightcad/libredwg-web');
    const lib = await m.LibreDwg.create(ev.data.base);
    const ptr = lib.dwg_read_data(ev.data.buf, m.Dwg_File_Type.DWG);
    if (ptr == null) throw new Error('No se pudo leer el DWG');
    const db = lib.convert(ptr);
    try { lib.dwg_free(ptr); } catch { /* */ }
    (self as unknown as Worker).postMessage({ geo: dwgDbToGeo(db) });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    (self as unknown as Worker).postMessage({ error: /memory access|unreachable|abort/i.test(msg) ? 'Este DWG (probablemente R14/2000) no es compatible con el lector. Guárdalo como DWG 2004 o posterior, o como DXF.' : msg });
  }
};
