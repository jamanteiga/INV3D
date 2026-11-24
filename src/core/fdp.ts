// Proyectos .fdp de INV3D: nombre, directorio de trabajo y subdirectorios (con su uso: piezas, ensamblajes, planos…)
import { useStore } from './store';

export type FdpRole = '' | 'part' | 'assembly' | 'drawing' | 'content' | 'export';
export const FDP_ROLES: Record<FdpRole, string> = { '': '—', part: 'Piezas', assembly: 'Ensamblajes', drawing: 'Planos', content: 'Centro de contenido', export: 'Exportados' };
export interface FdpSub { path: string; role: FdpRole }
export interface FdpProject {
  format: 'inv3d.project'; version: 1; name: string;
  /** directorio de trabajo (ruta indicada por el usuario o nombre de la carpeta elegida) */
  workspace: string;
  subdirs: FdpSub[];
  created: string; author?: string; notes?: string;
}
export const DEFAULT_SUBS: FdpSub[] = [
  { path: 'Piezas', role: 'part' }, { path: 'Ensamblajes', role: 'assembly' }, { path: 'Planos', role: 'drawing' },
  { path: 'Centro de contenido', role: 'content' }, { path: 'Exportados', role: 'export' },
];
export const newFdp = (name: string, workspace: string, subdirs: FdpSub[] = DEFAULT_SUBS): FdpProject =>
  ({ format: 'inv3d.project', version: 1, name, workspace, subdirs: subdirs.map((x) => ({ ...x })), created: new Date().toISOString(), author: useStore.getState().settings?.userName || undefined });

export function parseFdp(txt: string): FdpProject {
  const p = JSON.parse(txt) as FdpProject;
  if (p?.format !== 'inv3d.project') throw new Error('No es un proyecto .fdp de INV3D');
  return { ...p, subdirs: (p.subdirs ?? []).map((x) => (typeof x === 'string' ? { path: x, role: '' as FdpRole } : x)) };
}
export const fdpText = (p: FdpProject) => JSON.stringify(p, null, 2);

/** Subcarpeta del proyecto activo donde se guarda un documento de ese tipo */
export function subdirFor(kind: string): string {
  const p = useStore.getState().project?.fdp; if (!p) return '';
  const role: FdpRole = kind === 'part' ? 'part' : kind === 'assembly' ? 'assembly' : kind === 'drawing' ? 'drawing' : '';
  return p.subdirs.find((x) => x.role === role)?.path ?? '';
}

const LS = 'inv3d.project';
export function rememberProject(p: FdpProject | null, fileName?: string) {
  try { if (p) localStorage.setItem(LS, JSON.stringify({ p, fileName })); else localStorage.removeItem(LS); } catch { /* sin almacenamiento */ }
}
export function recallProject(): { p: FdpProject; fileName: string } | null {
  try { const x = JSON.parse(localStorage.getItem(LS) ?? 'null'); return x?.p ? { p: parseFdp(JSON.stringify(x.p)), fileName: x.fileName ?? `${x.p.name}.fdp` } : null; } catch { return null; }
}
export const fdpEntries = (p: FdpProject) => [
  { label: 'Directorio de trabajo', value: p.workspace || '—' },
  ...p.subdirs.map((x) => ({ label: `Subdirectorio${x.role ? ` · ${FDP_ROLES[x.role]}` : ''}`, value: x.path })),
  { label: 'Creado', value: new Date(p.created).toLocaleString('es-ES') },
  ...(p.author ? [{ label: 'Autor', value: p.author }] : []),
];
/** Activa el proyecto en la aplicación */
export function activateProject(p: FdpProject, fileName: string) {
  useStore.setState({ project: { name: p.name, fileName, entries: fdpEntries(p), xml: '', fdp: p } });
  rememberProject(p, fileName);
}
/** Crea los subdirectorios y el .fdp en la carpeta de trabajo (o descarga el .fdp si no hay acceso a carpetas) */
export async function writeProject(p: FdpProject): Promise<string> {
  const s = useStore.getState(), fn = `${p.name}.fdp`;
  if (s.folder.state === 'granted') {
    const { mkdirInFolder, writeInFolder } = await import('./persist');
    for (const x of p.subdirs) await mkdirInFolder(x.path);
    await writeInFolder(fn, fdpText(p), 'application/json');
    return `${fn} y ${p.subdirs.length} subdirectorio(s) creados en ${s.folder.name}`;
  }
  const { saveText } = await import('./files');
  await saveText(fdpText(p), fn, 'Proyecto INV3D (.fdp)', '.fdp', 'application/json');
  return `${fn} guardado (sin acceso a carpetas en este navegador: crea los subdirectorios a mano)`;
}
export async function openFdp(file: File) {
  const p = parseFdp(await file.text());
  activateProject(p, file.name);
  const s = useStore.getState();
  s.open({ kind: 'project' });
  if (s.folder.state !== 'granted') s.notify(`Proyecto ${p.name} activo · elige su directorio de trabajo (${p.workspace}) en Proyectos › Elegir carpeta`);
}
