// Project workspace persisted in IndexedDB (falls back to memory when storage is unavailable).
// A project is the equivalent of an Inventor .ipj workspace: a set of files referenced by name.

export interface ProjectInfo { id: string; name: string; created: string; ipj?: string; libraryPaths?: string[] }
export interface StoredFile { project: string; name: string; data: string; modified: string; size: number; thumb?: string }

const DB = 'inv3d-workspace';
let dbp: Promise<IDBDatabase | null> | null = null;
const mem = { projects: new Map<string, ProjectInfo>(), files: new Map<string, StoredFile>() };

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) {
          const s = db.createObjectStore('files', { keyPath: ['project', 'name'] });
          s.createIndex('project', 'project');
        }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then((db) => new Promise((res) => {
    if (!db) return res(undefined);
    try {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req ? (req as IDBRequest<T>).result : undefined);
      t.onerror = () => res(undefined);
    } catch { res(undefined); }
  }));
}

export const workspace = {
  async listProjects(): Promise<ProjectInfo[]> {
    const r = await tx<ProjectInfo[]>('projects', 'readonly', (s) => s.getAll());
    const list = r ?? [...mem.projects.values()];
    return list.sort((a, b) => a.name.localeCompare(b.name));
  },
  async saveProject(p: ProjectInfo) {
    mem.projects.set(p.id, p);
    await tx('projects', 'readwrite', (s) => s.put(p));
  },
  async deleteProject(id: string) {
    mem.projects.delete(id);
    const files = await workspace.listFiles(id);
    for (const f of files) await workspace.deleteFile(id, f.name);
    await tx('projects', 'readwrite', (s) => s.delete(id));
  },
  async listFiles(project: string): Promise<StoredFile[]> {
    const r = await open().then((db) => new Promise<StoredFile[] | undefined>((res) => {
      if (!db) return res(undefined);
      try {
        const t = db.transaction('files', 'readonly');
        const q = t.objectStore('files').index('project').getAll(project);
        q.onsuccess = () => res(q.result as StoredFile[]);
        q.onerror = () => res(undefined);
      } catch { res(undefined); }
    }));
    const list = r ?? [...mem.files.values()].filter((f) => f.project === project);
    return list.sort((a, b) => b.modified.localeCompare(a.modified));
  },
  async readFile(project: string, name: string): Promise<StoredFile | undefined> {
    const r = await tx<StoredFile>('files', 'readonly', (s) => s.get([project, name]));
    return r ?? mem.files.get(project + '/' + name);
  },
  async writeFile(project: string, name: string, data: string, thumb?: string) {
    const f: StoredFile = { project, name, data, modified: new Date().toISOString(), size: data.length, thumb };
    mem.files.set(project + '/' + name, f);
    await tx('files', 'readwrite', (s) => s.put(f));
    return f;
  },
  async deleteFile(project: string, name: string) {
    mem.files.delete(project + '/' + name);
    await tx('files', 'readwrite', (s) => s.delete([project, name]));
  },
};

export const DEFAULT_PROJECT: ProjectInfo = { id: 'default', name: 'Default', created: new Date().toISOString() };
