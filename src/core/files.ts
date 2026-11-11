// Entrada/salida de ficheros: .i3p propio, STEP/STL, .ipj de Inventor y lectura de metadatos OLE (.ipt/.iam/.idw/.ipn).
import * as CFB from 'cfb';
import { useStore, type FileInfo } from './store';
import { cad } from './cadClient';
import { newDoc, uid, validateDoc, nextName, type PartDoc } from './doc';
import { newAsm, validateAsm, IDENTITY, type AsmDoc } from './asm';
import { validateDrawing, type DrawingDoc } from './drawing';
import { zipStore } from './zip';
import { readDxf } from './dxfread';

export function download(data: BlobPart, name: string, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Dentro de claude.ai la página no puede descargar directamente: se usa la capacidad "downloads",
// que solo admite ciertas extensiones, así que los formatos CAD se entregan dentro de un .zip.
type Downloads = { save: (r: { filename: string; data: Blob | ArrayBuffer | string | Uint8Array }) => Promise<unknown> } | null;
let dlPromise: Promise<Downloads> | null = null;
function hostDownloads(): Promise<Downloads> {
  const c = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (!c?.use) return Promise.resolve(null);
  dlPromise ??= c.use('downloads').then((d) => (d as Downloads) ?? null).catch(() => null);
  return dlPromise;
}

async function toBytes(data: BlobPart): Promise<Uint8Array> {
  return new Uint8Array(await new Blob([data]).arrayBuffer());
}

/** Guardar: capacidad del anfitrión, diálogo nativo del navegador o descarga. */
async function saveAs(data: BlobPart, name: string, desc: string, ext: string, mime: string) {
  const host = await hostDownloads();
  if (host) {
    const zipName = `${name}.zip`;
    try {
      await host.save({ filename: zipName, data: new Blob([zipStore([{ name, data: await toBytes(data) }])]) });
      return name;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') return null;
      throw new Error(`No se pudo guardar (${code ?? 'error'})`);
    }
  }
  const w = window as unknown as { showSaveFilePicker?: (o: object) => Promise<any> };
  if (w.showSaveFilePicker) {
    try {
      const h = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: desc, accept: { [mime]: [ext] } }] });
      const ws = await h.createWritable(); await ws.write(new Blob([data], { type: mime })); await ws.close();
      return h.name as string;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
    }
  }
  download(data, name, mime);
  return name;
}

const baseName = (n: string) => n.replace(/\.[^.]+$/, '');

/** Documentos de pieza referenciados (para embeber en .i3a / .i3d). */
function embedFor(ids: string[]) {
  const s = useStore.getState();
  const out: Record<string, { fileName: string; kind: string; data: unknown }> = {};
  const add = (id: string) => {
    if (out[id]) return;
    const e = s.docs.find((d) => d.id === id); const data = s.docData(id);
    if (!e || !data) return;
    out[id] = { fileName: e.fileName, kind: e.kind, data };
    if (e.kind === 'assembly') (data as AsmDoc).occurrences.forEach((o) => add(o.part));
  };
  ids.forEach(add);
  return out;
}

export async function saveDoc() {
  const s = useStore.getState();
  let content: string, desc: string, ext: string;
  if (s.kind === 'part') { content = JSON.stringify(s.doc, null, 1); desc = 'Pieza INV3D'; ext = '.i3p'; }
  else if (s.kind === 'assembly') {
    content = JSON.stringify({ ...s.asm, embedded: embedFor([...new Set(s.asm.occurrences.map((o) => o.part))]) }); desc = 'Ensamblaje INV3D'; ext = '.i3a';
  } else {
    content = JSON.stringify({ ...s.drw, embedded: embedFor([...new Set(s.drw.views.map((v) => v.source))]) }); desc = 'Plano INV3D'; ext = '.i3d';
  }
  const fn = s.fileName.endsWith(ext) ? s.fileName : `${baseName(s.fileName)}${ext}`;
  const name = await saveAs(content, fn, desc, ext, 'application/json');
  if (name) {
    useStore.setState({ fileName: name, dirty: false, docs: useStore.getState().docs.map((d) => (d.id === s.active ? { ...d, fileName: name, dirty: false } : d)) });
    s.notify(`Guardado ${name}`);
  }
}

export async function saveText(data: BlobPart, name: string, desc: string, ext: string, mime: string) {
  try { await saveAs(data, name, desc, ext, mime); } catch (e) { useStore.getState().notify((e as Error).message, 'error'); }
}

export async function exportSTEP() {
  const s = useStore.getState();
  try {
    if (s.kind === 'drawing') throw new Error('Exporta el plano desde la pestaña Exportar (DXF, PDF, SVG)');
    const txt = await cad.exportSTEP(s.kind === 'assembly' ? 'asm' : 'part');
    await saveAs(txt, `${baseName(s.fileName)}.stp`, 'STEP AP214', '.stp', 'application/step');
  } catch (e) { s.notify((e as Error).message, 'error'); }
}

export async function exportSTL() {
  const s = useStore.getState();
  try {
    if (s.kind === 'drawing') throw new Error('Un plano no se exporta a STL');
    const buf = await cad.exportSTL(s.kind === 'assembly' ? 'asm' : 'part');
    await saveAs(buf, `${baseName(s.fileName)}.stl`, 'STL binario', '.stl', 'model/stl');
  } catch (e) { s.notify((e as Error).message, 'error'); }
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => res(inp.files?.[0] ?? null);
    inp.click();
  });
}

export const OPEN_ACCEPT = '.i3p,.i3a,.i3d,.json,.zip,.step,.stp,.ipj,.ipt,.iam,.idw,.ipn,.dwg,.dxf';

export async function openFile(file?: File | null) {
  const s = useStore.getState();
  file ??= await pickFile(OPEN_ACCEPT);
  if (!file) return;
  try {
    if (/\.zip$/i.test(file.name)) file = await unzipFirst(file);
    const ext = file.name.split('.').pop()!.toLowerCase();
    if (ext === 'i3p' || ext === 'json') {
      const doc = validateDoc(JSON.parse(await file.text()));
      s.load(doc, file.name);
      s.notify(`Abierto ${file.name}`);
    } else if (ext === 'i3a' || ext === 'i3d') {
      const raw = JSON.parse(await file.text());
      const embedded = (raw.embedded ?? {}) as Record<string, { fileName: string; kind: string; data: unknown }>;
      delete raw.embedded;
      for (const [id, e] of Object.entries(embedded)) {
        if (s.docs.some((d) => d.id === id)) continue;
        if (e.kind === 'part') s.addDocument('part', validateDoc(e.data), e.fileName, false, id);
        else if (e.kind === 'assembly') s.addDocument('assembly', validateAsm(e.data), e.fileName, false, id);
      }
      if (ext === 'i3a') s.addDocument('assembly', validateAsm(raw), file.name);
      else s.addDocument('drawing', validateDrawing(raw) as DrawingDoc, file.name);
      s.notify(`Abierto ${file.name}`);
    } else if (ext === 'step' || ext === 'stp') {
      await importStep(file, true);
    } else if (ext === 'dxf') {
      s.open({ kind: 'fileinfo', title: 'Dibujo DXF', info: await dwgInfo(file, true) });
    } else if (ext === 'ipj') {
      await openIpj(file);
    } else if (['ipt', 'iam', 'idw', 'ipn'].includes(ext)) {
      s.open({ kind: 'fileinfo', title: 'Fichero de Autodesk Inventor', info: await inventorInfo(file) });
    } else if (ext === 'dwg') {
      s.open({ kind: 'fileinfo', title: 'Dibujo DWG', info: await dwgInfo(file) });
    } else {
      throw new Error(`Formato .${ext} no soportado`);
    }
  } catch (e) {
    s.notify((e as Error).message, 'error');
  }
}

/** Abre el primer fichero de un .zip guardado por INV3D (método store o deflate). */
async function unzipFirst(file: File): Promise<File> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  if (dv.getUint32(0, true) !== 0x04034b50) throw new Error('ZIP no válido');
  const method = dv.getUint16(8, true), csize = dv.getUint32(18, true), nlen = dv.getUint16(26, true), xlen = dv.getUint16(28, true);
  const name = new TextDecoder().decode(buf.subarray(30, 30 + nlen));
  let data = buf.subarray(30 + nlen + xlen, 30 + nlen + xlen + csize);
  if (method === 8) {
    const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    data = new Uint8Array(await new Response(ds).arrayBuffer());
  } else if (method !== 0) throw new Error('Compresión ZIP no soportada');
  return new File([data], name);
}

export async function importStep(file?: File | null, asNew = false) {
  const s = useStore.getState();
  file ??= await pickFile('.step,.stp');
  if (!file) return;
  const text = await file.text();
  if (!/ISO-10303-21/.test(text.slice(0, 200))) throw new Error('El fichero no es un STEP (ISO 10303-21)');
  s.notify('Leyendo STEP…');
  const info = await cad.checkSTEP(text);
  if (asNew && info.solids > 1 && await s.ask(`El STEP contiene ${info.solids} sólidos. ¿Abrirlo como ensamblaje, con un componente por sólido?`, 'Abrir como ensamblaje')) {
    const steps = await cad.splitSTEP(text);
    const asm = newAsm();
    asm.iProperties.partNumber = baseName(file.name);
    steps.forEach((st, i) => {
      const d = newDoc();
      d.iProperties.partNumber = `${baseName(file!.name)}-${String(i + 1).padStart(2, '0')}`;
      d.features.push({ id: uid('f'), name: 'Sólido importado1', type: 'import', fileName: file!.name, step: st });
      const pid = s.addDocument('part', d, `${d.iProperties.partNumber}.i3p`, false);
      asm.occurrences.push({ id: uid('o'), name: `${d.iProperties.partNumber}:1`, part: pid, xf: { ...IDENTITY }, grounded: i === 0 });
    });
    s.addDocument('assembly', asm, `${baseName(file.name)}.i3a`);
    s.notify(`Importado ${file.name}: ${steps.length} componentes`);
    return;
  }
  if (asNew) {
    const d = newDoc();
    d.iProperties.partNumber = baseName(file.name);
    d.features.push({ id: uid('f'), name: 'Sólido importado1', type: 'import', fileName: file.name, step: text });
    s.load(d, `${baseName(file.name)}.i3p`);
  } else {
    s.commit((d) => { d.features.push({ id: uid('f'), name: nextName(d, 'import'), type: 'import', fileName: file!.name, step: text }); });
  }
  s.notify(`Importado ${file.name}`);
}

// ---------- Proyecto .ipj (XML de Inventor) ----------
export async function openIpj(file: File) {
  const xml = await file.text();
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.querySelector('parsererror')) throw new Error('El .ipj no es XML válido');
  const entries: { label: string; value: string }[] = [];
  const walk = (el: Element, path: string) => {
    const kids = [...el.children];
    const p = path ? `${path} › ${el.tagName}` : el.tagName;
    if (!kids.length) {
      const v = el.textContent?.trim();
      if (v) entries.push({ label: p, value: v });
    }
    for (const a of el.attributes) if (!/schema/i.test(a.name)) entries.push({ label: `${p} @${a.name}`, value: a.value });
    kids.forEach((k) => walk(k, path === '' && el === dom.documentElement ? '' : p));
  };
  walk(dom.documentElement, '');
  useStore.setState({ project: { name: baseName(file.name), fileName: file.name, entries, xml } });
  useStore.getState().open({ kind: 'project' });
}

export function newIpj(name: string) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<InventorProject schemarevid="4" xmlns="http://schemas.autodesk.com/inventor/projects/2006">
  <ProjectType>Single User</ProjectType>
  <Workspace>
    <Path>.\\</Path>
  </Workspace>
  <IncludeLibraryPaths />
  <ContentCenterPath>.\\Content Center Files\\</ContentCenterPath>
  <OldVersionsToKeep>1</OldVersionsToKeep>
  <UsingStyleLibrary>Read Only</UsingStyleLibrary>
  <!-- Creado con INV3D -->
</InventorProject>
`;
  return saveAs(xml, `${name}.ipj`, 'Proyecto de Inventor', '.ipj', 'application/xml');
}

// ---------- Metadatos de ficheros OLE de Inventor ----------
const SUMMARY: Record<number, string> = { 2: 'Título', 3: 'Asunto', 4: 'Autor', 5: 'Palabras clave', 6: 'Comentarios', 8: 'Último autor', 9: 'Revisión', 12: 'Creado', 13: 'Guardado', 18: 'Aplicación' };
const DOCSUMMARY: Record<number, string> = { 2: 'Categoría', 14: 'Responsable', 15: 'Empresa' };

function readPropertySet(buf: Uint8Array) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: { id: number; value: string | Uint8Array }[] = [];
  if (buf.length < 48 || dv.getUint16(0, true) !== 0xfffe) return out;
  const nSec = dv.getUint32(24, true);
  for (let s = 0; s < Math.min(nSec, 4); s++) {
    const secOff = dv.getUint32(28 + s * 20 + 16, true);
    if (secOff + 8 > buf.length) continue;
    const nProps = dv.getUint32(secOff + 4, true);
    let codepage = 1252;
    const items: [number, number][] = [];
    for (let i = 0; i < Math.min(nProps, 512); i++) {
      const o = secOff + 8 + i * 8;
      if (o + 8 > buf.length) break;
      items.push([dv.getUint32(o, true), dv.getUint32(o + 4, true)]);
    }
    for (const [id, off] of items) if (id === 1) codepage = dv.getUint16(secOff + off + 4, true);
    for (const [id, off] of items) {
      const p = secOff + off;
      if (id <= 1 || p + 4 > buf.length) continue;
      const vt = dv.getUint16(p, true);
      try {
        if (vt === 30) { // VT_LPSTR
          const n = dv.getUint32(p + 4, true);
          const enc = codepage === 65001 ? 'utf-8' : codepage === 1200 ? 'utf-16le' : 'windows-1252';
          out.push({ id, value: new TextDecoder(enc).decode(buf.subarray(p + 8, p + 8 + n)).replace(/\0+$/, '') });
        } else if (vt === 31) { // VT_LPWSTR
          const n = dv.getUint32(p + 4, true);
          out.push({ id, value: new TextDecoder('utf-16le').decode(buf.subarray(p + 8, p + 8 + n * 2)).replace(/\0+$/, '') });
        } else if (vt === 3) out.push({ id, value: String(dv.getInt32(p + 4, true)) });
        else if (vt === 5) out.push({ id, value: String(dv.getFloat64(p + 4, true)) });
        else if (vt === 11) out.push({ id, value: dv.getUint16(p + 4, true) ? 'Sí' : 'No' });
        else if (vt === 64) { // FILETIME
          const lo = dv.getUint32(p + 4, true), hi = dv.getUint32(p + 8, true);
          const ms = (hi * 2 ** 32 + lo) / 1e4 - 11644473600000;
          if (ms > 0) out.push({ id, value: new Date(ms).toLocaleString('es-ES') });
        } else if (vt === 71) { // VT_CF (miniatura)
          const n = dv.getUint32(p + 4, true);
          out.push({ id, value: buf.slice(p + 8, p + 8 + n) });
        }
      } catch { /* propiedad ilegible */ }
    }
  }
  return out;
}

function thumbFromCF(cf: Uint8Array): string | undefined {
  const find = (sig: number[]) => {
    for (let i = 0; i < Math.min(cf.length, 64); i++) if (sig.every((b, k) => cf[i + k] === b)) return i;
    return -1;
  };
  const png = find([0x89, 0x50, 0x4e, 0x47]);
  if (png >= 0) return URL.createObjectURL(new Blob([cf.subarray(png)], { type: 'image/png' }));
  // CF_DIB: cabecera de formato (-1, 8) y BITMAPINFOHEADER → se le antepone cabecera BMP
  const dv = new DataView(cf.buffer, cf.byteOffset, cf.byteLength);
  if (cf.length > 48 && dv.getInt32(0, true) === -1 && dv.getUint32(4, true) === 8) {
    const dib = cf.subarray(8);
    const ddv = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
    const hdr = ddv.getUint32(0, true), bpp = ddv.getUint16(14, true), clr = ddv.getUint32(32, true);
    const pal = (bpp <= 8 ? (clr || 1 << bpp) : clr) * 4;
    const file = new Uint8Array(14 + dib.length);
    const fdv = new DataView(file.buffer);
    fdv.setUint16(0, 0x4d42, true); fdv.setUint32(2, file.length, true); fdv.setUint32(10, 14 + hdr + pal, true);
    file.set(dib, 14);
    return URL.createObjectURL(new Blob([file], { type: 'image/bmp' }));
  }
  return undefined;
}

export async function inventorInfo(file: File): Promise<FileInfo> {
  const ext = file.name.split('.').pop()!.toLowerCase();
  const kinds: Record<string, string> = { ipt: 'Pieza (.ipt)', iam: 'Ensamblaje (.iam)', idw: 'Dibujo (.idw)', ipn: 'Presentación (.ipn)' };
  const buf = new Uint8Array(await file.arrayBuffer());
  const info: FileInfo = {
    fileName: file.name, kind: kinds[ext] ?? ext,
    message: 'La geometría de Inventor está en un formato cerrado de Autodesk y no puede reconstruirse. Para editarla aquí, en Inventor usa Archivo › Exportar › Formato CAD › STEP y abre el .stp en INV3D.',
    props: [], streams: [],
  };
  let cfb: CFB.CFB$Container;
  try { cfb = CFB.read(buf, { type: 'array' }); } catch { info.message = 'El fichero no es un contenedor OLE de Inventor válido.'; return info; }
  info.streams = cfb.FullPaths.filter((p) => !p.endsWith('/')).map((p) => p.replace(/^Root Entry\//, '')).slice(0, 60);
  for (let i = 0; i < cfb.FileIndex.length; i++) {
    const ent = cfb.FileIndex[i];
    if (!ent.name.startsWith('\u0005') || !ent.content) continue;
    const isSum = ent.name === '\u0005SummaryInformation';
    const isDoc = ent.name === '\u0005DocumentSummaryInformation';
    const props = readPropertySet(ent.content as Uint8Array);
    for (const p of props) {
      if (p.value instanceof Uint8Array) {
        if (!info.thumbnail) info.thumbnail = thumbFromCF(p.value);
        continue;
      }
      if (!p.value) continue;
      const label = isSum ? SUMMARY[p.id] : isDoc ? DOCSUMMARY[p.id] : undefined;
      info.props!.push({ label: label ?? `${ent.name.slice(1, 9)}… #${p.id}`, value: p.value });
    }
  }
  return info;
}

let dwgLib: Promise<any> | null = null;
/** Visor DWG/DXF con LibreDWG (WebAssembly, GPL-3.0), cargado solo cuando hace falta. */
async function dwgInfo(file: File, dxf = false): Promise<FileInfo> {
  const head = new TextDecoder('ascii').decode(new Uint8Array(await file.slice(0, 6).arrayBuffer()));
  const ver: Record<string, string> = { AC1015: 'AutoCAD 2000', AC1018: 'AutoCAD 2004', AC1021: 'AutoCAD 2007', AC1024: 'AutoCAD 2010', AC1027: 'AutoCAD 2013', AC1032: 'AutoCAD 2018+' };
  const info: FileInfo = {
    fileName: file.name, kind: dxf ? 'Dibujo DXF' : 'Dibujo DWG',
    message: 'Vista de solo lectura del dibujo 2D (LibreDWG).',
    props: [...(dxf ? [] : [{ label: 'Versión', value: `${head} ${ver[head] ?? ''}`.trim() }]), { label: 'Tamaño', value: `${(file.size / 1024).toFixed(1)} kB` }],
  };
  if (dxf) {
    try {
      const r = readDxf(await file.text());
      info.svg = r.svg;
      info.message = 'Vista de solo lectura del dibujo 2D.';
      info.props!.push({ label: 'Entidades', value: String(r.entities) }, { label: 'Capas', value: r.layers.join(', ') });
    } catch (e) { info.message = `No se pudo interpretar el DXF: ${(e as Error).message}`; }
    return info;
  }
  try {
    dwgLib ??= import('@mlightcad/libredwg-web').then(async (m: any) => ({ m, lib: await m.LibreDwg.create(new URL('./dwg', document.baseURI).href.replace(/\/$/, '')) }));
    const { m, lib } = await dwgLib;
    const ptr = lib.dwg_read_data(await file.arrayBuffer(), dxf ? m.Dwg_File_Type.DXF : m.Dwg_File_Type.DWG);
    if (ptr == null) throw new Error('No se pudo leer el fichero');
    const db = lib.convert(ptr);
    lib.dwg_free(ptr);
    info.svg = lib.dwg_to_svg(db);
    const ents = db.entities?.length ?? 0;
    info.props!.push({ label: 'Entidades', value: String(ents) }, { label: 'Capas', value: String(db.tables?.LAYER?.entries?.length ?? '—') });
  } catch (e) {
    info.message = `No se pudo interpretar el dibujo: ${(e as Error).message}`;
  }
  return info;
}
