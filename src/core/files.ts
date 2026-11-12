// Entrada/salida de ficheros: .i3p propio, STEP/STL, proyectos .ipj y lectura de metadatos OLE (.ipt/.iam/.idw/.ipn).
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

/** Fichero de cada documento (API de acceso a ficheros): tras el primer guardado o al abrirlo, se guarda en él sin preguntar */
export const fileHandles = new Map<string, any>();
async function writeHandle(h: any, data: BlobPart, mime: string): Promise<boolean> {
  try {
    if (h.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
    const ws = await h.createWritable(); await ws.write(new Blob([data], { type: mime })); await ws.close();
    return true;
  } catch { return false; }
}
let lastHandle: any = null;

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
      lastHandle = h;
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
  const out: Record<string, { fileName: string; kind: string; data: unknown; path?: string }> = {};
  const add = (id: string) => {
    if (out[id]) return;
    const e = s.docs.find((d) => d.id === id); const data = s.docData(id);
    if (!e || !data) return;
    out[id] = { fileName: e.fileName, kind: e.kind, data, ...(e.path ? { path: e.path } : {}) };
    if (e.kind === 'assembly') (data as AsmDoc).occurrences.forEach((o) => add(o.part));
  };
  ids.forEach(add);
  return out;
}

/** Contenido de un documento abierto (.i3p/.i3a/.i3d) con las piezas referenciadas embebidas. */
export function serializeDoc(id?: string): string {
  const s = useStore.getState();
  id ??= s.active;
  const e = s.docs.find((d) => d.id === id); const data = s.docData(id);
  if (!e || !data) throw new Error('Documento no encontrado');
  if (e.kind === 'part') return JSON.stringify(data, null, 1);
  if (e.kind === 'assembly') { const a = data as AsmDoc; return JSON.stringify({ ...a, embedded: embedFor([...new Set(a.occurrences.map((o) => o.part))]) }); }
  const d = data as DrawingDoc;
  return JSON.stringify({ ...d, embedded: embedFor([...new Set(d.views.map((v) => v.source))]) });
}
const DOC_EXT = { part: ['.i3p', 'Pieza INV3D'], assembly: ['.i3a', 'Ensamblaje INV3D'], drawing: ['.i3d', 'Plano INV3D'] } as const;

/** Guardar el documento activo. Tras el primer guardado se escribe en el mismo sitio sin preguntar
 *  (carpeta de trabajo o fichero elegido); «Guardar como» pregunta siempre. Al guardar una pieza se
 *  actualizan los ensamblajes y planos abiertos que la usan. */
export async function saveDoc(as = false) {
  const s = useStore.getState();
  const ok = await saveDocById(s.active, { as });
  if (ok && s.kind === 'part') await propagatePart(s.active);
}

/** Guarda un documento abierto. silent: solo si ya tiene sitio (ruta en la carpeta o fichero), sin diálogos. */
export async function saveDocById(id: string, o: { as?: boolean; silent?: boolean } = {}): Promise<boolean> {
  const s = useStore.getState();
  const cur = s.docs.find((d) => d.id === id); if (!cur) return false;
  const kind = cur.kind;
  const [ext, desc] = DOC_EXT[kind];
  const content = serializeDoc(id);
  const name0 = id === s.active ? s.fileName : cur.fileName;
  const fn = name0.endsWith(ext) ? name0 : `${baseName(name0)}${ext}`;
  const { markSaved, addRecent } = await import('../ui/session');
  const done = (name: string, path?: string) => {
    if (path) markSaved(id, path);
    else useStore.setState({ ...(id === useStore.getState().active ? { fileName: name, dirty: false } : {}), docs: useStore.getState().docs.map((d) => (d.id === id ? { ...d, fileName: name, dirty: false } : d)) });
    if (!o.silent) addRecent(path?.split('/').pop() ?? name, kind, path, content);
  };
  if (s.folder.state === 'granted' && (cur.path || !fileHandles.has(id) || o.as)) {
    let path = cur.path ?? fn;
    if (o.as || !cur.path) {
      if (o.silent) return false;
      const p = prompt(`Guardar en la carpeta «${s.folder.name}» como (puedes poner subcarpetas, p. ej. Piezas/${fn}):`, path);
      if (!p) return false;
      path = p.endsWith(ext) ? p : `${p}${ext}`;
      const { existsInFolder } = await import('./persist');
      if (path !== cur.path && await existsInFolder(path) && !(await s.ask(`${path} ya existe. ¿Sustituirlo?`, 'Sustituir'))) return false;
    }
    try {
      const { writeInFolder } = await import('./persist');
      await writeInFolder(path, content, 'application/json');
      done(path.split('/').pop()!, path);
      if (!o.silent) s.notify(`Guardado ${path} en ${s.folder.name}`);
      return true;
    } catch (e) { if (o.silent) return false; s.notify(`No se pudo escribir en la carpeta (${(e as Error).message}); se usa el diálogo`, 'error'); }
  }
  // mismo fichero que la última vez: sin diálogo
  const h = fileHandles.get(id);
  if (h && !o.as) {
    if (await writeHandle(h, content, 'application/json')) { done(h.name ?? fn); if (!o.silent) s.notify(`Guardado ${h.name ?? fn}`); return true; }
    if (o.silent) return false;
  }
  if (o.silent) return false;
  lastHandle = null;
  const name = await saveAs(content, fn, desc, ext, 'application/json');
  if (!name) return false;
  if (lastHandle) fileHandles.set(id, lastHandle);
  done(name);
  s.notify(`Guardado ${name}`);
  return true;
}

/** La pieza guardada se actualiza en los ensamblajes y planos abiertos que la usan (se guardan si ya tienen sitio). */
export async function propagatePart(partId: string) {
  const s = useStore.getState();
  const uses = (id: string, depth = 0): boolean => {
    const e = s.docs.find((d) => d.id === id), data = s.docData(id) as any; if (!e || !data || depth > 6) return false;
    if (e.kind === 'assembly') return (data.occurrences ?? []).some((o: any) => o.part === partId || uses(o.part, depth + 1));
    if (e.kind === 'drawing') return (data.views ?? []).some((v: any) => v.source === partId || uses(v.source, depth + 1));
    return false;
  };
  const users = s.docs.filter((d) => d.id !== partId && (d.kind === 'assembly' || d.kind === 'drawing') && uses(d.id));
  const saved: string[] = [];
  for (const d of users) { if (await saveDocById(d.id, { silent: true })) saved.push(d.fileName); else useStore.setState({ docs: useStore.getState().docs.map((x) => (x.id === d.id ? { ...x, dirty: true } : x)) }); }
  if (saved.length) s.notify(`Pieza actualizada también en ${saved.join(', ')}`);
  else if (users.length) s.notify(`La pieza se actualizará en ${users.map((d) => d.fileName).join(', ')} al guardarlos`);
}

/** Autoguardado: documentos con cambios que ya tienen sitio (carpeta o fichero) */
export async function autosaveAll(): Promise<number> {
  const s = useStore.getState(); let n = 0;
  for (const d of s.docs) {
    const dirty = d.id === s.active ? s.dirty : d.dirty;
    if (!dirty || !(d.path || fileHandles.has(d.id))) continue;
    if (await saveDocById(d.id, { silent: true })) n++;
  }
  return n;
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

/** IFC4 para BIM: un elemento por componente (barras, conductos, tuberías, chapas, tornillería…) con material y propiedades. */
export async function exportIFC() {
  const s = useStore.getState();
  try {
    if (s.kind === 'drawing') throw new Error('Un plano no se exporta a IFC');
    const { toIfc, ifcClassFor } = await import('./ifc');
    const { HVAC_MATERIALS } = await import('./hvacdata');
    const { PIPE_MATERIALS } = await import('./pipedata');
    const hv = new Set<string>(HVAC_MATERIALS.map((m) => m.name)), pp = new Set(PIPE_MATERIALS.map((m) => m.name));
    const items = await cad.meshItems(s.kind === 'assembly' ? 'asm' : 'part');
    const view = s.kind === 'assembly' ? (s.asmResult?.view ?? s.asm) : null;
    const partInfo = (doc: PartDoc | null, name: string) => {
      const ip = doc?.iProperties;
      const desc = ip?.description || '', mat = ip?.material || '';
      return { name, desc, tag: ip?.partNumber || name, material: mat, cls: ifcClassFor(`${desc} ${ip?.partNumber ?? ''}`.trim(), mat, { hvac: hv.has(mat), pipe: pp.has(mat) }) };
    };
    const out = items.map((it) => {
      if (s.kind === 'part') return { ...partInfo(s.doc as PartDoc, baseName(s.fileName)), vertices: it.vertices, triangles: it.triangles };
      const occ = view?.occurrences.find((o) => o.id === it.id);
      if (occ) return { ...partInfo(s.docData(occ.part) as PartDoc | null, occ.name), vertices: it.vertices, triangles: it.triangles };
      const fr = view?.frames.find((m) => m.id === it.id);
      if (fr) {
        // barra: pilar si es casi vertical, viga si es casi horizontal
        let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < it.vertices.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], it.vertices[i + k]); mx[k] = Math.max(mx[k], it.vertices[i + k]); }
        const d = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
        const cls = d[2] > 3 * Math.max(d[0], d[1]) ? 'IfcColumn' : d[2] < 0.35 * Math.max(d[0], d[1]) ? 'IfcBeam' : 'IfcMember';
        const f = fr;
        return { cls, name: it.name, desc: `${f.family} ${f.size}`.trim(), tag: it.name, material: f.material || 'Acero S275JR', vertices: it.vertices, triangles: it.triangles };
      }
      const bolt = /torniller|tornillo/i.test(it.name);
      return { cls: bolt ? 'IfcMechanicalFastener' : 'IfcBuildingElementProxy', name: it.name, desc: bolt ? 'Tornillería' : 'Cordón de soldadura', tag: it.name, material: '', vertices: it.vertices, triangles: it.triangles };
    });
    const name = baseName(s.fileName);
    const txt = toIfc(out, { project: name, fileName: `${name}.ifc`, author: s.settings.userName, org: s.settings.company });
    await saveAs(txt, `${name}.ifc`, 'IFC4 (BIM)', '.ifc', 'application/x-step');
  } catch (e) { s.notify((e as Error).message, 'error'); }
}

/** 3MF (impresión 3D), OBJ o glTF binario a partir de la malla del sólido. */
export async function exportMesh(fmt: '3mf' | 'obj' | 'glb') {
  const s = useStore.getState();
  try {
    if (s.kind === 'drawing') throw new Error('Un plano no se exporta como malla');
    const { parseSTL, to3MF, toOBJ, toGLB } = await import('./meshexport');
    const m = parseSTL(await cad.exportSTL(s.kind === 'assembly' ? 'asm' : 'part'));
    const name = baseName(s.fileName);
    if (fmt === '3mf') await saveAs(to3MF(m, name), `${name}.3mf`, '3MF (impresión 3D)', '.3mf', 'model/3mf');
    else if (fmt === 'obj') await saveAs(toOBJ(m, name), `${name}.obj`, 'OBJ', '.obj', 'model/obj');
    else await saveAs(toGLB(m, name), `${name}.glb`, 'glTF binario', '.glb', 'model/gltf-binary');
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

export async function openFile(file?: File | null, handle?: any) {
  const s = useStore.getState();
  if (!file) {
    // con la API de ficheros se recuerda el fichero abierto para guardar en él sin preguntar
    const w = window as unknown as { showOpenFilePicker?: (o: object) => Promise<any[]> };
    if (w.showOpenFilePicker) {
      try {
        const [h] = await w.showOpenFilePicker({ types: [{ description: 'INV3D y CAD', accept: { 'application/octet-stream': OPEN_ACCEPT.split(',') } }], excludeAcceptAllOption: false });
        handle = h; file = await h.getFile();
      } catch (e) { if ((e as Error).name === 'AbortError') return; file = await pickFile(OPEN_ACCEPT); }
    } else file = await pickFile(OPEN_ACCEPT);
  }
  if (!file) return;
  const rememberHandle = () => { if (handle && /\.(i3p|i3a|i3d|json)$/i.test(file!.name)) fileHandles.set(useStore.getState().active, handle); };
  try {
    if (/\.zip$/i.test(file.name)) file = await unzipFirst(file);
    const ext = file.name.split('.').pop()!.toLowerCase();
    if (ext === 'i3p' || ext === 'json') {
      const doc = validateDoc(JSON.parse(await file.text()));
      s.load(doc, file.name);
      rememberHandle();
      s.notify(`Abierto ${file.name}`);
      remember(file);
    } else if (ext === 'i3a' || ext === 'i3d') {
      const raw = JSON.parse(await file.text());
      const embedded = (raw.embedded ?? {}) as Record<string, { fileName: string; kind: string; data: unknown }>;
      delete raw.embedded;
      // con la carpeta de trabajo conectada, las piezas se toman de su fichero (la versión guardada más reciente)
      const { readFromFolder } = await import('./persist');
      for (const [id, e] of Object.entries(embedded)) {
        if (s.docs.some((d) => d.id === id)) continue;
        if (e.kind === 'part' && useStore.getState().folder.state === 'granted') {
          try { const f = await readFromFolder((e as any).path ?? e.fileName); const pd = validateDoc(JSON.parse(await f.text())); s.addDocument('part', { ...pd } as never, e.fileName, false, id); const ne = useStore.getState().docs.find((d) => d.id === id); if (ne && (e as any).path) ne.path = (e as any).path; continue; } catch { /* no está en la carpeta */ }
        }
        if (e.kind === 'part') s.addDocument('part', validateDoc(e.data), e.fileName, false, id);
        else if (e.kind === 'assembly') s.addDocument('assembly', validateAsm(e.data), e.fileName, false, id);
      }
      if (ext === 'i3a') s.addDocument('assembly', validateAsm(raw), file.name);
      else s.addDocument('drawing', validateDrawing(raw) as DrawingDoc, file.name);
      rememberHandle();
      s.notify(`Abierto ${file.name}`);
      remember(file);
    } else if (ext === 'step' || ext === 'stp') {
      await importStep(file, true);
    } else if (ext === 'dxf') {
      s.open({ kind: 'fileinfo', title: 'Dibujo DXF', info: await dwgInfo(file, true) });
    } else if (ext === 'ipj') {
      await openIpj(file);
    } else if (['ipt', 'iam', 'idw', 'ipn'].includes(ext)) {
      s.open({ kind: 'fileinfo', title: 'Fichero .ipt/.iam/.idw/.ipn', info: await oleFileInfo(file) });
    } else if (ext === 'dwg') {
      s.open({ kind: 'fileinfo', title: 'Dibujo DWG', info: await dwgInfo(file) });
    } else {
      throw new Error(`Formato .${ext} no soportado`);
    }
  } catch (e) {
    s.notify((e as Error).message, 'error');
  }
}

/** Carga una pieza (.i3p o STEP) como documento en segundo plano, sin activarla, para colocarla en el ensamblaje.
 *  Si ya está abierta con el mismo nombre se reutiliza. Devuelve el id del documento. */
export async function loadPartForPlace(file: File): Promise<string | null> {
  const s = useStore.getState();
  try {
    if (/\.zip$/i.test(file.name)) file = await unzipFirst(file);
    const ext = file.name.split('.').pop()!.toLowerCase();
    const same = (fn: string) => s.docs.find((d) => d.kind === 'part' && d.fileName === fn)?.id;
    if (ext === 'i3p' || ext === 'json') {
      const fn = file.name.replace(/\.json$/i, '.i3p');
      const ex = same(fn); if (ex) return ex;
      const id = s.addDocument('part', validateDoc(JSON.parse(await file.text())), fn, false);
      remember(file);
      return id;
    }
    if (ext === 'step' || ext === 'stp') {
      const fn = `${baseName(file.name)}.i3p`;
      const ex = same(fn); if (ex) return ex;
      const text = await file.text();
      if (!/ISO-10303-21/.test(text.slice(0, 200))) throw new Error('El fichero no es un STEP (ISO 10303-21)');
      const d = newDoc();
      d.iProperties.partNumber = baseName(file.name);
      d.features.push({ id: uid('f'), name: 'Sólido importado1', type: 'import', fileName: file.name, step: text });
      return s.addDocument('part', d, fn, false);
    }
    if (ext === 'i3a') {
      const ex = s.docs.find((d) => d.kind === 'assembly' && d.fileName === file.name)?.id;
      if (ex) return ex;
      const raw = JSON.parse(await file.text());
      const embedded = (raw.embedded ?? {}) as Record<string, { fileName: string; kind: string; data: unknown }>;
      delete raw.embedded;
      for (const [id, e] of Object.entries(embedded)) {
        if (s.docs.some((d) => d.id === id)) continue;
        if (e.kind === 'part') s.addDocument('part', validateDoc(e.data), e.fileName, false, id);
        else if (e.kind === 'assembly') s.addDocument('assembly', validateAsm(e.data), e.fileName, false, id);
      }
      remember(file);
      return s.addDocument('assembly', validateAsm(raw), file.name, false);
    }
    throw new Error(`Formato .${ext} no se puede colocar (usa .i3p, .i3a o STEP)`);
  } catch (e) { s.notify((e as Error).message, 'error'); return null; }
}

export const recentCtl = { skip: false };
function remember(file: File) {
  if (recentCtl.skip) return;
  import('../ui/session').then(({ addRecent }) => {
    addRecent(file.name, file.name.split('.').pop() ?? '', undefined, file);
  });
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

// ---------- Proyecto .ipj (XML) ----------
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
  return saveAs(xml, `${name}.ipj`, 'Proyecto .ipj', '.ipj', 'application/xml');
}

// ---------- Metadatos de ficheros OLE (.ipt/.iam/.idw/.ipn) ----------
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

export async function oleFileInfo(file: File): Promise<FileInfo> {
  const ext = file.name.split('.').pop()!.toLowerCase();
  const kinds: Record<string, string> = { ipt: 'Pieza (.ipt)', iam: 'Ensamblaje (.iam)', idw: 'Dibujo (.idw)', ipn: 'Presentación (.ipn)' };
  const buf = new Uint8Array(await file.arrayBuffer());
  const info: FileInfo = {
    fileName: file.name, kind: kinds[ext] ?? ext,
    message: 'La geometría de este fichero está en un formato cerrado y no puede reconstruirse. Para editarla aquí, expórtala a STEP desde el programa de origen y abre el .stp en INV3D.',
    props: [], streams: [],
  };
  let cfb: CFB.CFB$Container;
  try { cfb = CFB.read(buf, { type: 'array' }); } catch { info.message = 'El fichero no es un contenedor OLE válido.'; return info; }
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
  // LibreDWG falla (y puede cerrar la página) con DWG anteriores a 2004
  if (!/^AC10(1[89]|2\d|3\d)/.test(head)) { info.message = `Vista no disponible para DWG ${ver[head] ?? head}: guárdalo como DWG 2004 o posterior, o como DXF.`; return info; }
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
