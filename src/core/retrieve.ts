// Cotas recuperadas del modelo: las cotas de los bocetos y las distancias de extrusión se proyectan
// en la vista del plano y quedan asociadas (si cambia la pieza, la cota se mueve y cambia su valor).
import { v3, planeFrame, toWorld, resolveWorkPlanes, docParams, type PartDoc, type SketchF, type V3, type ExtrudeF } from './doc';
import { makeEval } from './expr';
import { refPoint, refLine, refCurve } from './sketch';
import type { DDim, DView } from './drawing';
import type { ProjData, ViewGeom } from './sheet';

type P2 = [number, number];
export interface Cam { toward: V3; x: V3; up: V3 }
export interface ModelDimRef { sk?: string; con?: string; feat?: string; ent?: string }
export interface ModelDim { ref: ModelDimRef; kind: DDim['kind']; a: P2; b: P2; r?: number; label: string }

const evFor = (doc: PartDoc) => { const e = makeEval(docParams(doc)); return (s: string) => { try { return e(s); } catch { return NaN; } }; };

/** Todas las cotas del modelo que se ven en verdadera magnitud en la vista. */
export function modelDims(doc: PartDoc, v: DView, cam: Cam, pd: ProjData, g: ViewGeom): ModelDim[] {
  const ev = evFor(doc), work = resolveWorkPlanes(doc, ev);
  const toSheet = (P: V3): P2 => { const d = v3.sub(P, pd.center); const s = g.T([v3.dot(d, cam.x), v3.dot(d, cam.up)]); return [s[0] - v.x, s[1] - v.y]; };
  const out: ModelDim[] = [];
  const sketches = doc.features.filter((f): f is SketchF => f.type === 'sketch' && !f.suppressed);
  for (const sk of sketches) {
    let fr; try { fr = planeFrame(sk.plane, ev, work); } catch { continue; }
    const W = (p: [number, number]) => toWorld(fr, p[0], p[1]);
    const facing = Math.abs(v3.dot(v3.norm(fr.normal), cam.toward)) > 0.999;
    // Cotas de boceto (solo en vistas paralelas al plano del boceto)
    if (facing) for (const c of sk.constraints ?? []) {
      if (c.type !== 'dim' || !c.kind || c.kind === 'angle') continue;
      const ref = { sk: sk.id, con: c.id }, label = `${sk.name}: ${c.name ?? ''} = ${c.expr ?? ''}`;
      if (c.kind === 'radius' || c.kind === 'diameter') {
        const cv = refCurve(sk, c.a, ev) as { c?: [number, number]; r?: number } | null;
        if (!cv?.c || !cv.r) continue;
        const C = toSheet(W(cv.c)), Q = toSheet(W([cv.c[0] + cv.r * Math.cos(0.8), cv.c[1] + cv.r * Math.sin(0.8)]));
        const r = Math.hypot(Q[0] - C[0], Q[1] - C[1]);
        const dir = [Q[0] - C[0], Q[1] - C[1]].map((x) => x / r) as P2;
        out.push({ ref, kind: c.kind === 'radius' ? 'r' : 'd', a: C, b: [C[0] + dir[0] * (r + 8), C[1] + dir[1] * (r + 8)], r, label });
        continue;
      }
      let A: [number, number] | null = null, B: [number, number] | null = null;
      if (c.kind === 'len') { const l = refLine(sk, c.a, ev); if (l) [A, B] = l; }
      else if (c.kind === 'pldist' || c.kind === 'lldist') {
        const l = refLine(sk, c.kind === 'pldist' ? c.b! : c.a, ev);
        const p = c.kind === 'pldist' ? refPoint(sk, c.a, ev) : (() => { const l2 = refLine(sk, c.b!, ev); return l2 ? l2[0] : null; })();
        if (l && p) { const d = [l[1][0] - l[0][0], l[1][1] - l[0][1]], L2 = d[0] ** 2 + d[1] ** 2 || 1; const t = ((p[0] - l[0][0]) * d[0] + (p[1] - l[0][1]) * d[1]) / L2; A = p; B = [l[0][0] + d[0] * t, l[0][1] + d[1] * t]; }
      } else { A = refPoint(sk, c.a, ev); B = c.b ? refPoint(sk, c.b, ev) : null; }
      if (!A || !B) continue;
      const a = toSheet(W(A)), b = toSheet(W(B));
      let kind: DDim['kind'] = 'a';
      if (c.kind === 'hdist' || c.kind === 'vdist') {
        const ax = v3.norm(c.kind === 'hdist' ? fr.xDir : fr.yDir);
        kind = Math.abs(v3.dot(ax, cam.x)) > Math.abs(v3.dot(ax, cam.up)) ? 'h' : 'v';
      } else if (Math.abs(a[1] - b[1]) < 1e-6) kind = 'h';
      else if (Math.abs(a[0] - b[0]) < 1e-6) kind = 'v';
      out.push({ ref, kind, a, b, label });
    }
    // Diámetros y radios definidos en la propia geometría (sin cota de boceto)
    if (facing) for (const en of sk.entities) {
      if ((en as { construction?: boolean }).construction || (en.type !== 'circle' && en.type !== 'arc')) continue;
      if ((sk.constraints ?? []).some((c) => c.type === 'dim' && (c.kind === 'radius' || c.kind === 'diameter') && c.a.e === en.id)) continue;
      const cv = refCurve(sk, { e: en.id }, ev); if (!cv) continue;
      const C = toSheet(W(cv.c)), Q = toSheet(W([cv.c[0] + cv.r * Math.cos(0.8), cv.c[1] + cv.r * Math.sin(0.8)]));
      const r = Math.hypot(Q[0] - C[0], Q[1] - C[1]); if (r < 0.3) continue;
      const dir = [(Q[0] - C[0]) / r, (Q[1] - C[1]) / r];
      const kind: DDim['kind'] = en.type === 'circle' ? 'd' : 'r';
      out.push({ ref: { sk: sk.id, ent: en.id }, kind, a: C, b: [C[0] + dir[0] * (r + 8), C[1] + dir[1] * (r + 8)], r, label: `${sk.name}: ${kind === 'd' ? 'Ø' : 'R'} ${en.type === 'circle' ? (en as { d?: string }).d ?? '' : (en as { r?: string }).r ?? ''}` });
    }
    // Distancia de extrusión (vistas perpendiculares al boceto)
    if (Math.abs(v3.dot(v3.norm(fr.normal), cam.toward)) < 0.01) {
      for (const f of doc.features) {
        if (f.type !== 'extrude' || f.suppressed) continue;
        const e = f as ExtrudeF;
        if (e.profile.split(':')[0] !== sk.id || e.extent === 'through') continue;
        const d = ev(e.distance); if (!(d > 0)) continue;
        const pts: [number, number][] = [];
        for (const en of sk.entities) { const p = refPoint(sk, { e: en.id, k: en.type === 'circle' ? 'c' : 'a' }, ev); if (p) pts.push(p); }
        if (!pts.length) continue;
        // punto del contorno más alejado del centro de la vista, para dejar la cota por fuera
        const P0 = pts.map((p) => W(p)).reduce((best, P) => (v3.dot(P, cam.x) + v3.dot(P, cam.up) > v3.dot(best, cam.x) + v3.dot(best, cam.up) ? P : best));
        const n = v3.mul(v3.norm(fr.normal), e.dir === 'reverse' ? -1 : 1);
        const start = e.dir === 'symmetric' ? v3.sub(P0, v3.mul(n, d / 2)) : P0;
        const a = toSheet(start), b = toSheet(v3.add(start, v3.mul(n, d)));
        const kind: DDim['kind'] = Math.abs(a[1] - b[1]) < 1e-6 ? 'h' : Math.abs(a[0] - b[0]) < 1e-6 ? 'v' : 'a';
        out.push({ ref: { feat: e.id }, kind, a, b, label: `${e.name}: ${e.distance}` });
      }
    }
  }
  // quitar duplicadas (misma geometría en la hoja)
  const seen = new Set<string>();
  return out.filter((m) => { const k = `${m.kind}|${m.a.map((x) => x.toFixed(2))}|${m.b.map((x) => x.toFixed(2))}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

const sameRef = (a: ModelDimRef, b: ModelDimRef) => a.sk === b.sk && a.con === b.con && a.feat === b.feat && a.ent === b.ent;

/** Actualiza las cotas asociadas al modelo con la geometría actual. */
export function refreshModelDims(dims: DDim[], v: DView, all: ModelDim[]): DDim[] {
  return dims.map((d) => {
    if (d.view !== v.id || !d.ref) return d;
    const m = all.find((x) => sameRef(x.ref, d.ref!));
    if (!m) return { ...d, orphan: true };
    if (d.kind === 'd' || d.kind === 'r') {
      // conservar la dirección de la directriz elegida por el usuario
      const dir = [d.b[0] - d.a[0], d.b[1] - d.a[1]], L = Math.hypot(dir[0], dir[1]) || 1, oldR = d.r ?? 0;
      const k = (L - oldR + (m.r ?? 0)) / L;
      return { ...d, a: m.a, b: [m.a[0] + dir[0] * k, m.a[1] + dir[1] * k], r: m.r, orphan: false };
    }
    return { ...d, a: m.a, b: m.b, orphan: false };
  });
}
