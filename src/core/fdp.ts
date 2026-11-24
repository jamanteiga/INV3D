// Proyectos .fdp de INV3D, con las opciones de un proyecto de Inventor 2027:
// tipo, fichero incluido, espacio de trabajo, rutas de búsqueda de grupo de trabajo, bibliotecas (solo lectura),
// subcarpetas de uso frecuente, opciones de carpeta (estilos, plantillas, centro de contenido) y opciones
// (versiones antiguas al guardar, nombres de fichero únicos, nombre, acceso directo, propietario, ID de versión).
// Las rutas son relativas a la carpeta del proyecto (la carpeta que contiene el .fdp).
import { useStore } from './store';

export type FdpRole = '' | 'part' | 'assembly' | 'drawing' | 'content' | 'export';
export const FDP_ROLES: Record<FdpRole, string> = { '': '—', part: 'Piezas', assembly: 'Ensamblajes', drawing: 'Planos', content: 'Centro de contenido', export: 'Exportados' };
export interface FdpSub { path: string; role: FdpRole }
export interface FdpPath { name: string; path: string }
export interface FdpProject {
  format: 'inv3d.project'; version: 2; name: string;
  type: 'single' | 'vault';
  /** directorio de trabajo: carpeta del proyecto (nombre o ruta) */
  workspace: string;
  /** espacio de trabajo dentro de la carpeta del proyecto («.» = la propia carpeta) */
  wsPath: string;
  included: string;
  workgroups: FdpPath[];
  libraries: FdpPath[];
  favorites: FdpPath[];
  folders: { styles: string; templates: string; content: string };
  options: { oldVersions: number; uniqueNames: boolean; shortcut: string; owner: string; releaseId: string; contentAutoSave: boolean };
  /** subcarpetas del espacio de trabajo con su uso (dónde se proponen los documentos nuevos) */
  subdirs: FdpSub[];
  created: string; author?: string; notes?: string;
}
export const DEFAULT_SUBS: FdpSub[] = [
  { path: 'Piezas', role: 'part' }, { path: 'Ensamblajes', role: 'assembly' }, { path: 'Planos', role: 'drawing' }, { path: 'Exportados', role: 'export' },
];
export function newFdp(name: string, workspace: string, subdirs: FdpSub[] = DEFAULT_SUBS): FdpProject {
  return {
    format: 'inv3d.project', version: 2, name, type: 'single', workspace, wsPath: '.', included: '',
    workgroups: [], libraries: [{ name: 'Biblioteca', path: 'Bibliotecas' }], favorites: subdirs.map((x) => ({ name: x.path, path: x.path })),
    folders: { styles: 'Datos de diseño', templates: 'Plantillas', content: 'Centro de contenido' },
    options: { oldVersions: 1, uniqueNames: true, shortcut: name, owner: useStore.getState().settings?.userName ?? '', releaseId: '', contentAutoSave: true },
    subdirs: subdirs.map((x) => ({ ...x })), created: new Date().toISOString(), author: useStore.getState().settings?.userName || undefined,
  };
}
/** Lee un .fdp (también los de la versión 1, sin las opciones de Inventor) */
export function parseFdp(txt: string): FdpProject {
  const p = JSON.parse(txt) as Partial<FdpProject> & { format?: string };
  if (p?.format !== 'inv3d.project') throw new Error('No es un proyecto .fdp de INV3D');
  const base = newFdp(p.name ?? 'Proyecto', p.workspace ?? '', (p.subdirs ?? []).map((x) => (typeof x === 'string' ? { path: x, role: '' as FdpRole } : x)));
  return { ...base, ...p, version: 2, folders: { ...base.folders, ...(p.folders ?? {}) }, options: { ...base.options, ...(p.options ?? {}) }, workgroups: p.workgroups ?? [], libraries: p.libraries ?? (p.version === 2 ? [] : base.libraries), favorites: p.favorites ?? base.favorites, subdirs: base.subdirs } as FdpProject;
}
export const fdpText = (p: FdpProject) => JSON.stringify(p, null, 2);

const norm = (x: string) => x.replace(/\\/g, '/').replace(/^\.\/?/, '').replace(/^\/+|\/+$/g, '');
const join = (...xs: string[]) => xs.map(norm).filter(Boolean).join('/');
const active = () => useStore.getState().project?.fdp ?? null;
/** Ruta (relativa a la carpeta del proyecto) dentro del espacio de trabajo */
export const wsJoin = (p: FdpProject, x: string) => join(p.wsPath, x);

/** Subcarpeta donde se propone guardar un documento nuevo de ese tipo */
export function subdirFor(kind: string): string {
  const p = active(); if (!p) return '';
  const role: FdpRole = kind === 'part' ? 'part' : kind === 'assembly' ? 'assembly' : kind === 'drawing' ? 'drawing' : '';
  const sub = p.subdirs.find((x) => x.role === role)?.path;
  return sub ? wsJoin(p, sub) : norm(p.wsPath);
}
/** Orden de búsqueda de ficheros (como Inventor): espacio de trabajo y sus subcarpetas, grupos de trabajo, bibliotecas, centro de contenido */
export function searchPaths(): string[] {
  const p = active(); if (!p) return [''];
  const out = [norm(p.wsPath), ...p.subdirs.map((x) => wsJoin(p, x.path)), ...p.workgroups.map((x) => norm(x.path)), ...p.libraries.map((x) => norm(x.path)), norm(p.folders.content)];
  return [...new Set(out)];
}
/** ¿La ruta está en una biblioteca (solo lectura)? */
export function isLibraryPath(path: string): string | null {
  const p = active(); if (!p) return null;
  const n = norm(path);
  const l = p.libraries.find((x) => norm(x.path) && (n === norm(x.path) || n.startsWith(norm(x.path) + '/')));
  return l ? l.name : null;
}
/** Busca un fichero por nombre siguiendo las rutas del proyecto */
export async function resolveFile(fileName: string, hint?: string): Promise<{ file: File; path: string } | null> {
  const { readFromFolder } = await import('./persist');
  const cands = [...(hint ? [hint] : []), ...searchPaths().map((d) => join(d, fileName))];
  for (const c of [...new Set(cands)]) { try { return { file: await readFromFolder(c), path: c }; } catch { /* sigue */ } }
  return null;
}
/** Versiones antiguas: antes de sobrescribir, copia el fichero a OldVersions/nombre.0001.ext y conserva las N últimas */
export async function keepOldVersion(path: string) {
  const p = active(); const n = p?.options.oldVersions ?? 0; if (!p || n <= 0) return;
  const { readFromFolder, writeInFolder, listDirInFolder, removeInFolder } = await import('./persist');
  let old: File; try { old = await readFromFolder(path); } catch { return; }
  const parts = norm(path).split('/'), file = parts.pop()!, dir = join(...parts, 'OldVersions');
  const m = /^(.*?)(\.[^.]+)$/.exec(file), base = m ? m[1] : file, ext = m ? m[2] : '';
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${esc}\\.(\\d{4})${ext.replace('.', '\\.')}$`);
  const have = (await listDirInFolder(dir)).map((x) => re.exec(x)).filter(Boolean).map((x) => +x![1]).sort((a, b) => a - b);
  const k = (have[have.length - 1] ?? 0) + 1;
  await writeInFolder(join(dir, `${base}.${String(k).padStart(4, '0')}${ext}`), await old.arrayBuffer(), 'application/octet-stream');
  const all = [...have, k];
  for (const x of all.slice(0, Math.max(0, all.length - n))) { try { await removeInFolder(join(dir, `${base}.${String(x).padStart(4, '0')}${ext}`)); } catch { /* */ } }
}
/** Nombres únicos: ¿hay otro fichero con el mismo nombre en otra carpeta del proyecto? */
export async function duplicateName(path: string): Promise<string | null> {
  const p = active(); if (!p?.options.uniqueNames) return null;
  const { listFolder } = await import('./persist');
  const name = norm(path).split('/').pop()!.toLowerCase();
  const hit = (await listFolder(5)).find((e) => e.name.toLowerCase() === name && norm(e.path) !== norm(path) && !e.path.includes('OldVersions/'));
  return hit?.path ?? null;
}
/** Plantillas del proyecto (.i3p/.i3a/.i3d de la carpeta de plantillas) */
export async function listTemplates(): Promise<string[]> {
  const p = active(); if (!p || useStore.getState().folder.state !== 'granted') return [];
  const { listDirInFolder } = await import('./persist');
  return (await listDirInFolder(norm(p.folders.templates))).filter((x) => /\.(i3p|i3a|i3d)$/i.test(x)).map((x) => join(p.folders.templates, x));
}
/** Las piezas nuevas del centro de contenido se guardan en su carpeta */
export async function saveContentPart(docId: string) {
  const p = active(), s = useStore.getState();
  if (!p?.options.contentAutoSave || s.folder.state !== 'granted') return;
  const e = s.docs.find((d) => d.id === docId); if (!e || e.path || e.kind !== 'part') return;
  const des = (s.docData(docId) as { iProperties?: { designer?: string } } | null)?.iProperties?.designer ?? '';
  if (!des.startsWith('Centro de contenido')) return;
  const sub = des.includes('HVAC') || des.includes('Espirotubo') ? 'HVAC' : des.includes('Tubería') ? 'Tubería' : 'Mecánica';
  const path = join(p.folders.content, sub, e.fileName.endsWith('.i3p') ? e.fileName : `${e.fileName}.i3p`);
  const { writeInFolder, existsInFolder } = await import('./persist');
  try {
    if (!(await existsInFolder(path))) { const { serializeDoc } = await import('./files'); await writeInFolder(path, serializeDoc(docId), 'application/json'); }
    const { markSaved } = await import('../ui/session'); markSaved(docId, path);
  } catch { /* sin permiso */ }
}

// ---------- Lista de proyectos y proyecto activo ----------
const LS = 'inv3d.project', LSL = 'inv3d.projects';
export interface FdpEntry { fileName: string; p: FdpProject }
export function projectList(): FdpEntry[] { try { return (JSON.parse(localStorage.getItem(LSL) ?? '[]') as FdpEntry[]).map((x) => ({ ...x, p: parseFdp(JSON.stringify(x.p)) })); } catch { return []; } }
export function storeInList(p: FdpProject, fileName: string) {
  const l = projectList().filter((x) => x.p.name !== p.name); l.unshift({ fileName, p });
  try { localStorage.setItem(LSL, JSON.stringify(l.slice(0, 30))); } catch { /* */ }
}
export function removeFromList(name: string) { try { localStorage.setItem(LSL, JSON.stringify(projectList().filter((x) => x.p.name !== name))); } catch { /* */ } }
export function rememberProject(p: FdpProject | null, fileName?: string) {
  try { if (p) localStorage.setItem(LS, JSON.stringify({ p, fileName })); else localStorage.removeItem(LS); } catch { /* sin almacenamiento */ }
}
export function recallProject(): { p: FdpProject; fileName: string } | null {
  try { const x = JSON.parse(localStorage.getItem(LS) ?? 'null'); return x?.p ? { p: parseFdp(JSON.stringify(x.p)), fileName: x.fileName ?? `${x.p.name}.fdp` } : null; } catch { return null; }
}
export const fdpEntries = (p: FdpProject) => [
  { label: 'Tipo', value: p.type === 'vault' ? 'Vault' : 'Usuario único' },
  { label: 'Directorio de trabajo', value: p.workspace || '—' },
  { label: 'Espacio de trabajo', value: p.wsPath || '.' },
  ...p.workgroups.map((x) => ({ label: `Grupo de trabajo · ${x.name}`, value: x.path })),
  ...p.libraries.map((x) => ({ label: `Biblioteca · ${x.name}`, value: x.path })),
  { label: 'Plantillas', value: p.folders.templates }, { label: 'Centro de contenido', value: p.folders.content },
];
/** Activa el proyecto en la aplicación */
export function activateProject(p: FdpProject, fileName: string) {
  useStore.setState({ project: { name: p.name, fileName, entries: fdpEntries(p), xml: '', fdp: p } });
  rememberProject(p, fileName); storeInList(p, fileName);
}
/** Crea las carpetas y el .fdp en la carpeta del proyecto (o descarga el .fdp si no hay acceso a carpetas) */
export async function writeProject(p: FdpProject): Promise<string> {
  const s = useStore.getState(), fn = `${p.name}.fdp`;
  if (s.folder.state === 'granted') {
    const { mkdirInFolder, writeInFolder } = await import('./persist');
    const dirs = [p.wsPath, ...p.subdirs.map((x) => wsJoin(p, x.path)), ...p.workgroups.map((x) => x.path), ...p.libraries.map((x) => x.path), ...p.favorites.map((x) => x.path), p.folders.styles, p.folders.templates, p.folders.content].map(norm).filter(Boolean);
    for (const d of [...new Set(dirs)]) await mkdirInFolder(d);
    await writeInFolder(fn, fdpText(p), 'application/json');
    return `${fn} y ${new Set(dirs).size} carpeta(s) en ${s.folder.name}`;
  }
  const { saveText } = await import('./files');
  await saveText(fdpText(p), fn, 'Proyecto INV3D (.fdp)', '.fdp', 'application/json');
  return `${fn} guardado (sin acceso a carpetas en este navegador: crea las carpetas a mano)`;
}
export async function openFdp(file: File) {
  let p = parseFdp(await file.text());
  // fichero incluido: añade sus grupos de trabajo y bibliotecas
  if (p.included && useStore.getState().folder.state === 'granted') {
    try { const { readFromFolder } = await import('./persist'); const inc = parseFdp(await (await readFromFolder(p.included)).text()); p = { ...p, workgroups: [...p.workgroups, ...inc.workgroups], libraries: [...p.libraries, ...inc.libraries] }; } catch { /* no accesible */ }
  }
  activateProject(p, file.name);
  const s = useStore.getState();
  s.open({ kind: 'project' });
  if (s.folder.state !== 'granted') s.notify(`Proyecto ${p.name} activo · elige su carpeta (${p.workspace}) en Proyectos › Elegir carpeta`);
}
