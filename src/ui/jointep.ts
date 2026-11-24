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
