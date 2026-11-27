// Máximos de tramo (aplicación / proyecto / ensamblaje) y unidades de montaje del ensamblaje
import { useState } from 'react';
import { useStore } from '../core/store';
import { Modal } from './Panels';
import { segCfg, unitInfo, fitUnit, deleteUnit, segmentAll } from './hvacops';

export default function SegUnitsDialog({ onClose }: { onClose: () => void }) {
  const s = useStore(); const cf = segCfg();
  const a = s.asm.segCfg ?? {}, pj = s.project?.fdp?.options, st = s.settings;
  const [L, setL] = useState(a.maxL != null ? String(a.maxL) : ''), [K, setK] = useState(a.maxKg != null ? String(a.maxKg) : '');
  const apply = () => {
    const maxL = L.trim() ? Math.max(200, Number(L.replace(',', '.'))) : undefined, maxKg = K.trim() ? Math.max(5, Number(K.replace(',', '.'))) : undefined;
    s.commitAsm((d) => { if (maxL == null && maxKg == null) delete d.segCfg; else d.segCfg = { ...(maxL != null ? { maxL } : {}), ...(maxKg != null ? { maxKg } : {}) }; });
    s.notify(`Máximos de tramo de este ensamblaje: ${maxL ?? 'heredada'} mm / ${maxKg ?? 'heredado'} kg · se revisan los tramos y las unidades`);
  };
  const units = s.asm.segUnits ?? [];
  return (
    <Modal title="Máximos de tramo y unidades de montaje" onClose={onClose} wide>
      <p className="phelp">Longitud y peso máximos de cada tramo y de cada unidad de montaje, con bridas y juntas. Se aplica el primero definido: <b>ensamblaje</b> → <b>proyecto</b> (Archivo › Proyectos (.fdp) › Opciones{pj ? `: ${pj.segMaxL ?? '—'} mm / ${pj.segMaxKg ?? '—'} kg` : ', sin proyecto activo'}) → <b>aplicación</b> (Archivo › Opciones: {st.segMaxL ?? 1500} mm / {st.segMaxKg ?? 80} kg).</p>
      <div className="ai-row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <label>Longitud máx. (mm) <input type="number" min={200} step={50} placeholder={String(pj?.segMaxL ?? st.segMaxL ?? 1500)} value={L} onChange={(e) => setL(e.target.value)} onKeyDown={(e) => e.stopPropagation()} style={{ width: 90 }} /></label>
        <label>Peso máx. (kg) <input type="number" min={5} step={5} placeholder={String(pj?.segMaxKg ?? st.segMaxKg ?? 80)} value={K} onChange={(e) => setK(e.target.value)} onKeyDown={(e) => e.stopPropagation()} style={{ width: 70 }} /></label>
        <button className="btn primary" onClick={apply}>Aplicar a este ensamblaje</button>
        <span>En uso: <b>{cf.maxL} mm / {cf.maxKg} kg</b> ({cf.src})</span>
      </div>
      <div className="plabel" style={{ marginTop: 10 }}>Unidades de montaje</div>
      <p className="phelp">Conjuntos de piezas que se fabrican y transportan juntos (p. ej. codo con sus rectos, compuerta con su tramo). Clic derecho sobre una pieza › <i>Unidad de montaje ▸</i> para crearlas eligiendo las piezas con el ratón. Longitud = lado mayor de la caja envolvente; si se pasan, se cortan sus tramos rectos de los extremos (brida + junta en el corte).</p>
      {units.length ? (
        <table className="bom-table"><thead><tr><th>Unidad</th><th>Piezas</th><th>Longitud mm</th><th>Peso kg</th><th /><th /></tr></thead>
          <tbody>{units.map((u) => { const i = unitInfo(u); return (
            <tr key={u.id}>
              <td><a href="#" onClick={(e) => { e.preventDefault(); useStore.setState({ selGroup: [...u.occs], selItem: u.occs[0] }); }}>{u.name}</a></td>
              <td>{i.ids.length}</td><td>{Math.round(i.len)}</td><td>{i.kg.toFixed(1)}</td>
              <td style={{ color: i.ok ? '#1f8a4c' : '#c0392b', fontWeight: 600 }}>{i.ready ? (i.ok ? '✓' : '✗ supera') : '…'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn sm" onClick={() => useStore.setState({ unitPick: { id: u.id }, selGroup: [...u.occs], selItem: null })}>Piezas…</button>
                <button className="btn sm" disabled={i.ok} onClick={() => fitUnit(u.id)}>Ajustar</button>
                <button className="btn sm" onClick={() => deleteUnit(u.id)}>✕</button>
              </td>
            </tr>); })}</tbody></table>
      ) : <p className="phelp">No hay unidades de montaje.</p>}
      <div className="modal-btns">
        <button className="btn" onClick={() => useStore.setState({ unitPick: {}, selGroup: [], selItem: null })}>Nueva unidad…</button>
        <button className="btn" onClick={() => segmentAll()}>Revisar todos los tramos</button>
        <span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}
