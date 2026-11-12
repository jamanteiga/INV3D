// Configuración persistente: ajustes, bibliotecas, recientes y sesión en IndexedDB del navegador,
// y carpeta de trabajo local (File System Access API, Chrome/Edge) recordada entre sesiones.
import { MATERIALS } from './doc';
import type { SheetSize } from './drawing';

export type IconTheme = 'e1' | 'e2' | 'e3' | 'e4';
export const ICON_THEMES: [IconTheme, string][] = [['e1', 'Estilo 1'], ['e2', 'Estilo 2'], ['e3', 'Estilo 3'], ['e4', 'Estilo 4']];
/** Estilo de iconos vigente (convierte los nombres antiguos) */
export function iconThemeOf(v: string | undefined): IconTheme { return v === 'e2' || v === 'inventor' ? 'e2' : v === 'e3' || v === 'solidworks' ? 'e3' : v === 'e4' || v === 'catia' ? 'e4' : 'e1'; }
export type DrawStd = 'ISO' | 'DIN' | 'ANSI';
export interface AppSettings {
  userName: string; company: string;
  defaultMaterial: string;
  restoreSession: boolean;
  autosave: boolean;
  /** Autoguardado en la carpeta de trabajo de los documentos ya guardados allí (además de la sesión) */
  autosaveFolder: boolean;
  drawingStd: DrawStd;
  sheetDefault: SheetSize;
  showEdges: boolean;
  /** Estilo de iconos de la interfaz */
  iconTheme?: IconTheme;
  /** Referencias a objetos (tipo osnap): activadas y modos */
  osnap?: { on: boolean; modes: string[] };
}
export const DEFAULT_SETTINGS: AppSettings = {
  userName: '', company: '', defaultMaterial: 'Acero S275JR', restoreSession: true, autosave: true, autosaveFolder: false,
  drawingStd: 'ISO', sheetDefault: 'A3', showEdges: true,
};
export interface UserMaterial { name: string; density: number; color: string }
export interface UserLibs { materials: UserMaterial[]; ifeatures?: import('./ifeature').IFeatureDef[]; sheetStyles?: { name: string; t: string; r: string; k: string }[] }
export interface RecentItem { name: string; path?: string; kind: string; at: number }
export interface Config { v: 1; settings: AppSettings; libs: UserLibs; savedAt: number }

// ---------- IndexedDB clave-valor ----------
let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  dbp ??= new Promise((res) => {
    try {
      const r = indexedDB.open('inv3d', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}
export async function kvGet<T>(key: string): Promise<T | undefined> {
  const d = await db(); if (!d) return undefined;
  return new Promise((res) => {
    try { const q = d.transaction('kv').objectStore('kv').get(key); q.onsuccess = () => res(q.result as T); q.onerror = () => res(undefined); }
    catch { res(undefined); }
  });
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  const d = await db(); if (!d) return;
  return new Promise((res) => {
    try { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(value, key); t.oncomplete = () => res(); t.onerror = () => res(); }
    catch { res(); }
  });
}
export async function kvDel(key: string) {
  const d = await db(); if (!d) return;
  try { d.transaction('kv', 'readwrite').objectStore('kv').delete(key); } catch { /* nada */ }
}

// ---------- Bibliotecas ----------
const BUILTIN_MATERIALS = MATERIALS.length;
/** Añade los materiales del usuario a la lista global (sin duplicar nombres). */
export function applyLibs(l: UserLibs) {
  MATERIALS.splice(BUILTIN_MATERIALS);
  for (const m of l.materials ?? []) if (m.name && !MATERIALS.some((x) => x.name === m.name)) MATERIALS.push({ name: m.name, density: Number(m.density) || 1000, color: m.color || '#c3c8cf' });
}

// ---------- Carpeta de trabajo ----------
type DirHandle = {
  name: string; kind: 'directory';
  queryPermission: (o: object) => Promise<PermissionState>;
  requestPermission: (o: object) => Promise<PermissionState>;
  getDirectoryHandle: (n: string, o?: object) => Promise<DirHandle>;
  getFileHandle: (n: string, o?: object) => Promise<{ getFile: () => Promise<File>; createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }> }>;
  values: () => AsyncIterable<{ kind: 'file' | 'directory'; name: string }>;
};
let dir: DirHandle | null = null;
export const folderSupported = () => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function' && window.top === window.self;
export const folderName = () => dir?.name ?? '';

/** Recupera la carpeta recordada; devuelve el estado del permiso. */
export async function restoreFolder(): Promise<'none' | 'prompt' | 'granted'> {
  if (!folderSupported()) return 'none';
  const h = await kvGet<DirHandle>('dir');
  if (!h) return 'none';
  dir = h;
  try { return (await h.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'granted' : 'prompt'; } catch { return 'prompt'; }
}
/** Pide de nuevo el permiso (necesita un clic del usuario). */
export async function reconnectFolder(): Promise<boolean> {
  if (!dir) return false;
  try { return (await dir.requestPermission({ mode: 'readwrite' })) === 'granted'; } catch { return false; }
}
export async function chooseFolder(): Promise<string | null> {
  const w = window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> };
  try {
    const h = await w.showDirectoryPicker({ id: 'inv3d', mode: 'readwrite' });
    dir = h; await kvSet('dir', h);
    return h.name;
  } catch { return null; }
}
export async function forgetFolder() { dir = null; await kvDel('dir'); }

async function walk(path: string, create: boolean): Promise<{ d: DirHandle; name: string }> {
  if (!dir) throw new Error('No hay carpeta de trabajo');
  const parts = path.split(/[\\/]/).filter(Boolean);
  const name = parts.pop()!;
  let d = dir;
  for (const p of parts) d = await d.getDirectoryHandle(p, { create });
  return { d, name };
}
export async function writeInFolder(path: string, data: BlobPart, mime = 'application/octet-stream') {
  const { d, name } = await walk(path, true);
  const fh = await d.getFileHandle(name, { create: true });
  const ws = await fh.createWritable(); await ws.write(new Blob([data], { type: mime })); await ws.close();
}
export async function readFromFolder(path: string): Promise<File> {
  const { d, name } = await walk(path, false);
  return (await d.getFileHandle(name)).getFile();
}
export async function existsInFolder(path: string) { try { await readFromFolder(path); return true; } catch { return false; } }

export interface FolderEntry { path: string; name: string; size: number; modified: number }
const LISTED = /\.(i3p|i3a|i3d|ipj|step|stp|dxf|dwg|ipt|iam|idw|ipn|json|stl|igs|iges|3mf)$/i;
/** Lista los ficheros CAD de la carpeta (hasta 3 niveles). */
export async function listFolder(maxDepth = 3): Promise<FolderEntry[]> {
  if (!dir) return [];
  const out: FolderEntry[] = [];
  const rec = async (d: DirHandle, prefix: string, depth: number) => {
    for await (const e of d.values()) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      if (e.kind === 'directory') { if (depth < maxDepth) await rec(await d.getDirectoryHandle(e.name), `${prefix}${e.name}/`, depth + 1); }
      else if (LISTED.test(e.name) && e.name !== CONFIG_FILE) {
        try { const f = await (await d.getFileHandle(e.name)).getFile(); out.push({ path: prefix + e.name, name: e.name, size: f.size, modified: f.lastModified }); } catch { /* sin acceso */ }
      }
      if (out.length > 2000) return;
    }
  };
  await rec(dir, '', 0);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// ---------- Fichero de configuración en la carpeta (para llevarla a otro PC con OneDrive, etc.) ----------
export const CONFIG_FILE = 'inv3d-config.json';
export async function readFolderConfig(): Promise<Config | null> {
  try { return JSON.parse(await (await readFromFolder(CONFIG_FILE)).text()) as Config; } catch { return null; }
}
export async function writeFolderConfig(c: Config) { try { await writeInFolder(CONFIG_FILE, JSON.stringify(c, null, 1), 'application/json'); } catch { /* sin permiso */ } }
