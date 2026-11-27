// Ensamblaje: revisiones (comparar versiones), plantillas de tendido y pasos por mamparo
import * as THREE from 'three';
import { useStore } from '../core/store';
import { uid, type V3, type PartDoc } from '../core/doc';
import { q as qq, xfPoint, type Xform } from '../core/asm';
import { makeHvacPart, type HvacSpec } from '../core/hvac';
import { epFrame } from './hvacroute';
import { xfOf, asmActions } from './actions';
import { partFor, inOutOf } from './hvacops';
import { useAsmCalc } from './asmcalc';

const S = () => useStore.getState();
type Q = Xform['quat'];
const specOf = (pid: string) => (S().docData(pid) as (PartDoc & { hvacSpec?: HvacSpec }) | null)?.hvacSpec;
const pnOf = (pid: string) => (S().docData(pid) as PartDoc | null)?.iProperties?.partNumber ?? pid;

// ======================= REVISIONES =======================
export interface Rev { id: string; name: string; date: string; snap: Record<string, { pn: string; name: string; pos: V3; quat: Q }> }
export function saveRevision(name: string) {
  const s = S(); const snap: Rev['snap'] = {};
  for (const o of s.asm.occurrences) if (!o.suppressed) { const X = xfOf(o.id); snap[o.id] = { pn: pnOf(o.part), name: o.name, pos: [...X.pos] as V3, quat: [...X.quat] as Q }; }
  s.commitAsm((a) => { ((a as { revisions?: Rev[] }).revisions ??= []).push({ id: uid('rv'), name, date: new Date().toISOString().slice(0, 16).replace('T', ' '), snap }); });
  s.notify(`Revisión «${name}» guardada (${Object.keys(snap).length} componentes)`);
}
export const revisions = () => ((S().asm as { revisions?: Rev[] }).revisions ?? []);
export interface RevDiff { added: string[]; changed: { id: string; why: string }[]; removed: { name: string; pn: string }[] }
export function compareRevision(id: string): RevDiff | null {
  const r = revisions().find((x) => x.id === id); if (!r) return null;
  const s = S(); const out: RevDiff = { added: [], changed: [], removed: [] }; const seen = new Set<string>();
  for (const o of s.asm.occurrences) {
    if (o.suppressed) continue; const old = r.snap[o.id];
    if (!old) { out.added.push(o.id); continue; } seen.add(o.id);
    const X = xfOf(o.id), d = Math.hypot(X.pos[0] - old.pos[0], X.pos[1] - old.pos[1], X.pos[2] - old.pos[2]);
    const dq = Math.abs(X.quat[0] * old.quat[0] + X.quat[1] * old.quat[1] + X.quat[2] * old.quat[2] + X.quat[3] * old.quat[3]);
    const why = [pnOf(o.part) !== old.pn ? `pieza: ${old.pn} → ${pnOf(o.part)}` : '', d > 1 ? `movida ${Math.round(d)} mm` : '', dq < 0.99999 ? 'girada' : ''].filter(Boolean).join(' · ');
    if (why) out.changed.push({ id: o.id, why });
  }
  for (const [id, v] of Object.entries(r.snap)) if (!seen.has(id) && !s.asm.occurrences.some((o) => o.id === id)) out.removed.push({ name: v.name, pn: v.pn });
  useAsmCalc.setState({ colorBy: 'revision' as never, revDiff: { added: new Set(out.added), changed: new Set(out.changed.map((c) => c.id)) } } as never);
  return out;
}
export function deleteRevision(id: string) { S().commitAsm((a) => { const A = a as { revisions?: Rev[] }; A.revisions = (A.revisions ?? []).filter((r) => r.id !== id); }); }

// ======================= PLANTILLAS DE TENDIDO =======================
export interface Tpl { name: string; date: string; docs: Record<string, PartDoc>; items: { key: string; part: string; name: string; xf: Xform; tag?: string }[]; joints: unknown[]; anchor: { key: string; ep: string; P: V3; D: V3; X: V3 } }
const TKEY = 'inv3d.routeTemplates';
export const templates = (): Tpl[] => { try { return JSON.parse(localStorage.getItem(TKEY) ?? '[]'); } catch { return []; } };
const storeTpl = (L: Tpl[]) => { try { localStorage.setItem(TKEY, JSON.stringify(L)); return true; } catch (e) { S().notify(`No se pudo guardar la plantilla: ${(e as Error).message}`, 'error'); return false; } };
/** Guarda como plantilla los componentes `ids`; se insertará por la boca de entrada de `anchor` */
export function saveTemplate(name: string, ids: string[], anchor: string) {
  const s = S(); const set = new Set(ids); const F = epFrame(anchor, inOutOf(anchor).eIn); if (!F) { s.notify('La pieza de arranque no tiene boca de entrada', 'error'); return; }
  const docs: Tpl['docs'] = {}; const items: Tpl['items'] = [];
  for (const id of ids) { const o = s.asm.occurrences.find((x) => x.id === id); if (!o) continue; const d = s.docData(o.part) as PartDoc | null; if (!d) continue; docs[o.part] = structuredClone(d); items.push({ key: id, part: o.part, name: o.name.replace(/:\d+$/, ''), xf: structuredClone(xfOf(id)), tag: o.tag }); }
  const joints = s.asm.joints.filter((j) => set.has(j.a.occ) && set.has(j.b.occ)).map((j) => structuredClone(j));
  const t: Tpl = { name, date: new Date().toISOString().slice(0, 10), docs, items, joints, anchor: { key: anchor, ep: inOutOf(anchor).eIn, P: F.P.toArray() as V3, D: F.D.toArray() as V3, X: F.X.toArray() as V3 } };
  if (storeTpl([...templates().filter((x) => x.name !== name), t])) s.notify(`Plantilla «${name}» guardada (${items.length} piezas)`);
}
export function deleteTemplate(name: string) { storeTpl(templates().filter((x) => x.name !== name)); }
/** Inserta la plantilla con su boca de arranque unida a la boca libre (occ, ep) */
export function insertTemplate(name: string, occ: string, ep: string) {
  const s = S(); const t = templates().find((x) => x.name === name); const F = epFrame(occ, ep);
  if (!t || !F) { s.notify('Plantilla o boca no encontradas', 'error'); return; }
  const basis = (X: THREE.Vector3, Z: THREE.Vector3) => { const Y = Z.clone().cross(X).normalize(); return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z)); };
  const qa = basis(new THREE.Vector3(...t.anchor.X), new THREE.Vector3(...t.anchor.D));
  const Dt = F.D.clone().negate(); const qt = basis(F.X.clone(), Dt);
  const R = qt.clone().multiply(qa.clone().invert());
  const Pa = new THREE.Vector3(...t.anchor.P);
  const pmap = new Map<string, string>(); for (const [k, d] of Object.entries(t.docs)) pmap.set(k, partFor(structuredClone(d)));
  const kmap = new Map(t.items.map((it) => [it.key, uid('o')]));
  s.commitAsm((a) => {
    const cnt = new Map<string, number>(); for (const x of a.occurrences) cnt.set(x.part, (cnt.get(x.part) ?? 0) + 1);
    for (const it of t.items) {
      const pid = pmap.get(it.part)!; const n = (cnt.get(pid) ?? 0) + 1; cnt.set(pid, n);
      const p = new THREE.Vector3(...it.xf.pos).sub(Pa).applyQuaternion(R).add(F.P);
      const q = R.clone().multiply(new THREE.Quaternion(...it.xf.quat));
      a.occurrences.push({ id: kmap.get(it.key)!, name: `${it.name}:${n}`, part: pid, xf: { pos: p.toArray() as V3, quat: [q.x, q.y, q.z, q.w] as Q }, ...(it.tag ? { tag: it.tag as never, grounded: true } : {}), ...(s.asm.occurrences.find((o) => o.id === occ)?.system ? { system: s.asm.occurrences.find((o) => o.id === occ)!.system } : {}) } as typeof a.occurrences[number]);
    }
    for (const j0 of t.joints as { id: string; a: { occ: string }; b: { occ: string } }[]) a.joints.push({ ...(structuredClone(j0) as object), id: uid('j'), a: { ...j0.a, occ: kmap.get(j0.a.occ)! }, b: { ...j0.b, occ: kmap.get(j0.b.occ)! } } as never);
  });
  asmActions.foranJoinFixed(kmap.get(t.anchor.key)!, t.anchor.ep, occ, ep);
  useStore.setState({ selGroup: [...kmap.values()], selItem: kmap.get(t.anchor.key)! });
  s.notify(`Plantilla «${name}» insertada (${t.items.length} piezas) y unida a la boca`);
}

// ======================= PASOS POR MAMPARO =======================
/** Paso por mamparo/cubierta en el tramo `occ` a `d` mm de su entrada (A-60: aislamiento `ins` mm; estanco: 0) */
export function addPenetration(occ: string, d: number, ins = 0) {
  const s = S(); const o = s.asm.occurrences.find((x) => x.id === occ); const sp = o && specOf(o.part);
  if (!sp || sp.kind !== 'duct') { s.notify('Paso por mamparo: elige un tramo recto de conducto', 'error'); return; }
  const doc = makeHvacPart({ ...sp, kind: 'penetration', L: 300, ins, ends: 'none', endsAt: undefined, material: 'Acero S235' } as HvacSpec);
  const pid = partFor(doc); const X = xfOf(occ); const { eIn } = inOutOf(occ); const z = eIn === 'ep2' ? sp.L - d : d;
  s.commitAsm((a) => { const n = a.occurrences.filter((x) => x.part === pid).length + 1; a.occurrences.push({ id: uid('o'), name: `${doc.iProperties.partNumber}:${n}`, part: pid, xf: { pos: xfPoint(X, [0, 0, z]) as V3, quat: [...X.quat] as Q }, grounded: true, tag: 'penetration', host: occ } as typeof a.occurrences[number]); });
  s.notify(`Paso por mamparo ${ins ? 'A-60' : 'estanco'} a ${Math.round(d)} mm de la entrada del tramo`);
}
export { qq };
