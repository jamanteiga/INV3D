// Restricción ePoint–ePoint del diálogo Restringir: cada ePoint de su componente
import { useStore } from '../core/store';
import { partEPoints, epRef, type EPoint } from '../core/epoints';
import type { PartDoc } from '../core/doc';

/** ePoints elegibles de un componente (activos y no compuestos) */
export function occEPoints(occ: string): EPoint[] {
  const s = useStore.getState(); const o = s.asm.occurrences.find((x) => x.id === occ); if (!o) return [];
  const d = s.docs.find((x) => x.id === o.part); if (!d || d.kind !== 'part') return [];
  return partEPoints(s.docData(o.part) as PartDoc).filter((e) => e.kind !== 'composite' && !e.inactive);
}
/** Pone un ePoint en la siguiente casilla del diálogo Restringir (1 y luego 2) */
export function setJointEPoint(occ: string, epId: string, slot?: 'a' | 'b') {
  const s = useStore.getState(); const dlg = s.dialog as { kind: string; draft: Record<string, unknown> & { a?: { occ: string }; b?: { occ: string }; aEpK?: string; bEpK?: string }; step?: number } | null;
  if (dlg?.kind !== 'joint') return;
  const e = occEPoints(occ).find((x) => x.id === epId); if (!e) return;
  const d = dlg.draft, sl = slot ?? ((dlg.step ?? 0) === 0 ? 'a' : 'b');
  const other = sl === 'a' ? d.b : d.a;
  if (other && other.occ === occ) { s.notify('El otro ePoint es del mismo componente: elige uno de otra pieza', 'error'); return; }
  const name = s.asm.occurrences.find((o) => o.id === occ)?.name ?? '';
  const next = { ...d, [sl]: epRef(e, occ), [`${sl}L`]: `${name} · ePoint ${e.name}`, [`${sl}Ep`]: e.id, [`${sl}EpK`]: e.kind, [`${sl}W`]: undefined };
  const ka = sl === 'a' ? e.kind : d.aEpK, kb = sl === 'b' ? e.kind : d.bEpK;
  next.type = ka === 'insert' && kb === 'insert' ? 'insert' : 'mate';
  useStore.setState({ dialog: { ...dlg, draft: next, step: sl === 'a' ? 1 : 0 } as never });
}

import { q as qq, xfPoint, type AsmDoc, type Xform } from '../core/asm';
import { quatZTo } from '../core/fasteners';
import { v3, type V3 } from '../core/doc';
/** Antes de resolver: coloca el componente que se mueve con su ePoint sobre el otro y en sentido opuesto
 *  (así el solver no tiene que dar media vuelta, que es donde puede quedarse atascado) */
export function preAlign(a: AsmDoc, movOcc: string, eMov: EPoint, fixOcc: string, eFix: EPoint) {
  const s = useStore.getState();
  const om = a.occurrences.find((o) => o.id === movOcc), of = a.occurrences.find((o) => o.id === fixOcc);
  if (!om || !of || om.grounded || a.joints.some((j) => [j.a, j.b, j.c].some((f) => f?.occ === movOcc))) return;
  const Xf: Xform = s.asmResult?.xf[fixOcc] ?? of.xf;
  const pT = xfPoint(Xf, eFix.point), nT = v3.norm(qq.rotate(Xf.quat, eFix.dir));
  const conj = (x: [number, number, number, number]): [number, number, number, number] => [-x[0], -x[1], -x[2], x[3]];
  const quat = qq.mul(quatZTo(v3.mul(nT, -1) as V3), conj(quatZTo(v3.norm(eMov.dir))));
  om.xf = { pos: v3.sub(pT, qq.rotate(quat, eMov.point)) as V3, quat };
}
