// Recordar la configuración local cada vez que se entra: ajustes, bibliotecas, proyecto, recientes,
// documentos abiertos (autoguardado) y carpeta de trabajo.
import { useStore, type DocEntry, type AnyDoc } from '../core/store';
import {
  kvGet, kvSet, applyLibs, restoreFolder, reconnectFolder, chooseFolder, forgetFolder, folderName, folderSupported,
  readFolderConfig, writeFolderConfig, writeInFolder, readFromFolder, DEFAULT_SETTINGS,
  type AppSettings, type UserLibs, type RecentItem, type Config,
} from '../core/persist';
import { openFile, recentCtl } from '../core/files';

const S = () => useStore.getState();
let ready = false;

interface SessionData { v: 1; active: string; docs: { id: string; kind: DocEntry['kind']; fileName: string; path?: string; dirty: boolean; hidden?: boolean; data: AnyDoc }[]; project?: unknown; at: number }

function configNow(): Config { const s = S(); return { v: 1, settings: s.settings, libs: s.libs, savedAt: Date.now() }; }

/** Arranque: lee todo lo guardado y restaura la sesión anterior. */
export async function initSession() {
  const [settings, libs, recent, project, sess, cfgAt] = await Promise.all([
    kvGet<AppSettings>('settings'), kvGet<UserLibs>('libs'), kvGet<RecentItem[]>('recent'), kvGet<unknown>('project'), kvGet<SessionData>('session'), kvGet<number>('configAt'),
  ]);
  const st: Record<string, unknown> = {
    settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) },
    libs: { ...(libs ?? {}), materials: libs?.materials ?? [] },
    recent: recent ?? [],
  };
  if (project) st.project = project;
  useStore.setState(st);
  applyLibs(S().libs);
  useStore.setState({ showEdges: S().settings.showEdges });

  const fs = await restoreFolder();
  useStore.setState({ folder: { name: folderName(), state: fs } });
  if (fs === 'granted') await syncFolderConfig(cfgAt ?? 0);

  if (S().settings.restoreSession && sess?.docs?.length) restoreSession(sess);
  ready = true;
  watch();
}

function restoreSession(sess: SessionData) {
  const docs: DocEntry[] = sess.docs.map((d) => ({ id: d.id, kind: d.kind, fileName: d.fileName, path: d.path, data: d.data, past: [], future: [], dirty: d.dirty, hidden: d.hidden }));
  const act = docs.find((d) => d.id === sess.active) ?? docs[docs.length - 1];
  useStore.setState({ docs, active: '__none' });
  S().activate(act.id);
  // el documento activo debe conservar su marca de cambios
  useStore.setState({ dirty: act.dirty });
  S().notify(`Sesión restaurada: ${docs.length} documento${docs.length > 1 ? 's' : ''}`);
}

/** Si la carpeta tiene inv3d-config.json más reciente que lo local, se carga; si no, se escribe. */
async function syncFolderConfig(localAt: number) {
  const c = await readFolderConfig();
  if (c && c.savedAt > localAt) {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, ...c.settings }, libs: { ...c.libs, materials: c.libs?.materials ?? [] } });
    applyLibs(S().libs);
    await kvSet('settings', S().settings); await kvSet('libs', S().libs); await kvSet('configAt', c.savedAt);
  } else await writeFolderConfig(configNow());
}

// ---------- Guardado automático ----------
let tSess: ReturnType<typeof setTimeout> | null = null, tCfg: ReturnType<typeof setTimeout> | null = null;
function watch() {
  useStore.subscribe((s, prev) => {
    if (!ready) return;
    const docChanged = s.doc !== prev.doc || s.asm !== prev.asm || s.drw !== prev.drw || s.docs !== prev.docs || s.active !== prev.active || s.fileName !== prev.fileName;
    if (docChanged && s.settings.autosave) { if (tSess) clearTimeout(tSess); tSess = setTimeout(saveSession, 1500); }
    if (s.settings !== prev.settings || s.libs !== prev.libs) { if (tCfg) clearTimeout(tCfg); tCfg = setTimeout(saveConfig, 600); }
    if (s.project !== prev.project) kvSet('project', s.project);
    if (s.recent !== prev.recent) kvSet('recent', s.recent);
    if (s.showEdges !== prev.showEdges && s.showEdges !== s.settings.showEdges) useStore.setState({ settings: { ...s.settings, showEdges: s.showEdges } });
  });
  window.addEventListener('beforeunload', () => { if (S().settings.autosave) saveSession(); });
  // Autoguardado en la carpeta de los documentos que ya tienen ruta allí
  setInterval(() => { const s = S(); if (s.settings.autosaveFolder && s.folder.state === 'granted') autosaveToFolder(); }, 60000);
}

export async function saveSession() {
  const s = S();
  const data: SessionData = {
    v: 1, active: s.active, at: Date.now(),
    docs: s.docs.map((d) => {
      const on = d.id === s.active;
      return { id: d.id, kind: d.kind, fileName: on ? s.fileName : d.fileName, path: d.path, dirty: on ? s.dirty : d.dirty, hidden: d.hidden, data: s.docData(d.id)! };
    }),
  };
  await kvSet('session', data);
}
async function saveConfig() {
  const c = configNow();
  applyLibs(c.libs);
  await kvSet('settings', c.settings); await kvSet('libs', c.libs); await kvSet('configAt', c.savedAt);
  if (S().folder.state === 'granted') await writeFolderConfig(c);
}
async function autosaveToFolder() {
  const { serializeDoc } = await import('../core/files');
  const s = S();
  for (const d of s.docs) {
    const dirty = d.id === s.active ? s.dirty : d.dirty;
    if (!dirty || !d.path) continue;
    try { await writeInFolder(d.path, serializeDoc(d.id), 'application/json'); markSaved(d.id, d.path); } catch { /* sin permiso */ }
  }
}
export function markSaved(id: string, path: string) {
  const s = S(), name = path.split('/').pop()!;
  useStore.setState({ docs: s.docs.map((d) => (d.id === id ? { ...d, path, fileName: name, dirty: false } : d)), ...(id === s.active ? { dirty: false, fileName: name } : {}) });
}

// ---------- Recientes ----------
export function addRecent(name: string, kind: string, path?: string, content?: BlobPart) {
  const s = S();
  const key = path ?? name;
  const list = [{ name, path, kind, at: Date.now() }, ...s.recent.filter((r) => (r.path ?? r.name) !== key)].slice(0, 15);
  useStore.setState({ recent: list });
  // copia en el navegador para poder reabrir aunque no haya carpeta conectada
  if (content !== undefined) new Blob([content]).arrayBuffer().then((b) => { if (b.byteLength < 30e6) kvSet(`file:${key}`, b); });
}
export async function openRecent(r: RecentItem) {
  const s = S();
  const key = r.path ?? r.name;
  let file: File | null = null;
  if (r.path && s.folder.state === 'granted') { try { file = await readFromFolder(r.path); } catch { /* movido o borrado */ } }
  if (!file) { const b = await kvGet<ArrayBuffer>(`file:${key}`); if (b) file = new File([b], r.name); }
  if (!file) { s.notify(`No se encuentra ${r.name}${r.path && s.folder.state !== 'granted' ? ' (reconecta la carpeta de trabajo)' : ''}`, 'error'); return; }
  recentCtl.skip = true; try { await openFile(file); } finally { recentCtl.skip = false; }
  if (r.path) { const a = S(); useStore.setState({ docs: a.docs.map((d) => (d.id === a.active ? { ...d, path: r.path } : d)) }); }
  addRecent(r.name, r.kind, r.path);
}
export async function openFromFolder(path: string) {
  const s = S();
  try {
    const f = await readFromFolder(path);
    recentCtl.skip = true; try { await openFile(f); } finally { recentCtl.skip = false; }
    const a = S(); useStore.setState({ docs: a.docs.map((d) => (d.id === a.active ? { ...d, path } : d)) });
    addRecent(f.name, f.name.split('.').pop() ?? '', path);
  } catch (e) { s.notify(`No se pudo abrir ${path}: ${(e as Error).message}`, 'error'); }
}

// ---------- Carpeta ----------
export const folderApi = {
  supported: folderSupported,
  choose: async () => {
    const n = await chooseFolder(); if (!n) return;
    useStore.setState({ folder: { name: n, state: 'granted' } });
    await syncFolderConfig((await kvGet<number>('configAt')) ?? 0);
    S().notify(`Carpeta de trabajo: ${n}`);
  },
  reconnect: async () => {
    const ok = await reconnectFolder();
    useStore.setState({ folder: { name: folderName(), state: ok ? 'granted' : 'prompt' } });
    if (ok) await syncFolderConfig((await kvGet<number>('configAt')) ?? 0);
  },
  forget: async () => { await forgetFolder(); useStore.setState({ folder: { name: '', state: 'none' } }); },
};

// ---------- Exportar / importar la configuración ----------
export function exportConfig(): string { return JSON.stringify(configNow(), null, 1); }
export function importConfig(txt: string) {
  const c = JSON.parse(txt) as Config;
  if (!c || c.v !== 1 || !c.settings) throw new Error('No es un fichero de configuración de INV3D');
  useStore.setState({ settings: { ...DEFAULT_SETTINGS, ...c.settings }, libs: { ...c.libs, materials: c.libs?.materials ?? [] } });
}
