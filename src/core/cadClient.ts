// Cliente RPC del Web Worker geométrico.
import type { PartDoc, V3 } from './doc';

export interface MeshData {
  vertices: Float32Array; normals: Float32Array; triangles: Uint32Array;
  faceGroups: { start: number; count: number; faceId: number }[];
  lines: Float32Array; edgeGroups: { start: number; count: number; edgeId: number }[];
}
export interface MassProps { volume: number; area: number; cog: V3; bbox: [V3, V3] }
export interface RegenResult {
  mesh: MeshData | null;
  status: Record<string, { ok: boolean; error?: string }>;
  props: MassProps | null;
  ms: number;
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

class CadClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  onProgress: (v: number) => void = () => {};

  constructor() {
    this.worker = new Worker(new URL('../worker/cad.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') return this.onProgress(m.value);
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Fallo del núcleo geométrico'));
      this.pending.clear();
    };
  }

  private call<T>(type: string, data: object = {}, transfer: Transferable[] = []): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, ocBase: new URL('./oc/', document.baseURI).href, ...data }, transfer);
    });
  }

  init() { return this.call<void>('init'); }
  regen(doc: PartDoc, preview = false) { return this.call<RegenResult>('regen', { doc, preview }); }
  exportSTEP() { return this.call<string>('exportSTEP'); }
  exportSTL() { return this.call<ArrayBuffer>('exportSTL'); }
  checkSTEP(text: string) { return this.call<{ bbox: [V3, V3] }>('checkSTEP', { text }); }
}

export const cad = new CadClient();
