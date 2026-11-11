// Cliente RPC del Web Worker geométrico.
import type { PartDoc, V3, V2 } from './doc';
import type { AsmDoc, Xform } from './asm';

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
export interface AsmResult {
  parts: Record<string, { key: string; mesh?: MeshData; props: MassProps | null; ok: boolean; error?: string }>;
  xf: Record<string, Xform>;
  occCut: Record<string, { mesh: MeshData; props: MassProps | null }>;
  members: { id: string; mesh: MeshData; length: number; cutAngles: [number, number]; volume: number }[];
  welds: { id: string; mesh: MeshData; length: number; area: number }[];
  bolts: { id: string; mesh: MeshData; length: number; count: number }[];
  errors: Record<string, string>;
  ms: number;
}
export interface FlatResult { paths: string[]; bends: { a: V2; b: V2; label: string }[]; t: number; r: number; k: number }
export interface Projection { visible: string[]; hidden: string[]; center: V3; cut: number[] }
export type ProjSource = { kind: 'part'; doc: PartDoc } | { kind: 'asm'; asm: AsmDoc; parts: Record<string, PartDoc> };

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
  regen(doc: PartDoc, preview = false, upTo?: number) { return this.call<RegenResult>('regen', { doc, preview, upTo }); }
  asm(asm: AsmDoc, parts: Record<string, PartDoc>, have: string[]) { return this.call<AsmResult>('asm', { asm, parts, have }); }
  exportSTEP(target: 'part' | 'asm' = 'part') { return this.call<string>('exportSTEP', { target }); }
  exportSTL(target: 'part' | 'asm' = 'part') { return this.call<ArrayBuffer>('exportSTL', { target }); }
  checkSTEP(text: string) { return this.call<{ bbox: [V3, V3]; solids: number }>('checkSTEP', { text }); }
  splitSTEP(text: string) { return this.call<string[]>('splitSTEP', { text }); }
  project(source: ProjSource, dir: V3, x: V3, section?: { origin: V3; normal: V3 }) { return this.call<Projection>('project', { source, dir, x, section }); }
  flat(doc: PartDoc) { return this.call<FlatResult>('flat', { doc }); }
  interference(asm: AsmDoc, parts: Record<string, PartDoc>) { return this.call<{ a: string; b: string; volume: number; mesh: MeshData }[]>('interf', { asm, parts }); }
}

export const cad = new CadClient();
