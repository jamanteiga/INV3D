// Aislamiento asociado: tipo, espesor (mínimos RITE), piezas y ámbito; vista y mediciones
import { useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { saveText } from '../core/files';
import { Modal } from './Panels';
import { insulate, insTakeoff, INS_TYPES, type InsType } from './insul';
import { riteMin } from './asmcalc';

const f = (x: number, d = 2) => x.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function InsulateDialog({ onClose, scope }: { onClose: () => void; scope?: string[] }) {
  const s = useStore();
  const [type, setType] = useState<InsType>('mw'), [e, setE] = useState(riteMin('int', 'cold'));
  const [k, setK] = useState({ duct: true, elbow: true, other: true });
  const rows = useMemo(() => insTakeoff(), [s.asm, s.asmResult]);
  const view = s.settings.insView ?? 'transp';
  const n = scope ? scope.length : s.asm.occurrences.filter((o) => !o.tag && !o.suppressed).length;
  const base = s.fileName.replace(/\.[^.]+$/, '');
  return (
    <Modal title={`Aislamiento${scope ? ` · ${scope.length} pieza(s)` : ' · todo el ensamblaje'}`} onClose={onClose} wide>
      <p className="phelp">El aislamiento queda <b>asociado a cada pieza</b>: se rehace solo al cortar, dividir, cambiar longitud o sección, mover o borrar la pieza. Rectos y codos con su forma; transiciones, tes, compuertas, plenums y codos con álabes con una funda sobre su envolvente. Mínimos RITE IT 1.2.4.2.1 (λ 0,04): interior {riteMin('int', 'cold')} mm frío / {riteMin('int', 'hot')} mm calor; exterior {riteMin('ext', 'cold')} / {riteMin('ext', 'hot')} mm.</p>
      <div className="ai-row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <label>Tipo <select value={type} onChange={(ev) => setType(ev.target.value as InsType)}>{(Object.keys(INS_TYPES) as InsType[]).map((t) => <option key={t} value={t}>{INS_TYPES[t].name}</option>)}</select></label>
        <label>Espesor (mm) <input type="number" min={5} step={5} value={e} onChange={(ev) => setE(Math.max(0, Number(ev.target.value) || 0))} onKeyDown={(ev) => ev.stopPropagation()} style={{ width: 64 }} /></label>
        {[20, 25, 30, 40, 50].map((x) => <button key={x} className={`btn sm ${e === x ? 'primary' : ''}`} onClick={() => setE(x)}>{x}</button>)}
      </div>
      <div className="ai-row" style={{ gap: 12 }}>
        <label className="check"><input type="checkbox" checked={k.duct} onChange={(ev) => setK({ ...k, duct: ev.target.checked })} />Tramos rectos</label>
        <label className="check"><input type="checkbox" checked={k.elbow} onChange={(ev) => setK({ ...k, elbow: ev.target.checked })} />Codos</label>
        <label className="check"><input type="checkbox" checked={k.other} onChange={(ev) => setK({ ...k, other: ev.target.checked })} />Transiciones, tes y accesorios</label>
      </div>
      {type === 'inner' && <p className="phelp">Interior: reduce la sección libre en 2 × {e} mm; el cálculo (Calcular) usa la sección libre.</p>}
      <div className="ai-row" style={{ gap: 8 }}>
        <button className="btn primary" disabled={!(e > 0)} onClick={() => insulate(e, type, scope, k)}>Aislar {scope ? 'la selección' : 'todo'} ({n})</button>
        <button className="btn" onClick={() => insulate(0, type, scope, k)}>Quitar aislamiento</button>
        <span className="grow" />
        <label>Ver <select value={view} onChange={(ev) => s.set({ settings: { ...s.settings, insView: ev.target.value as 'transp' } })}><option value="transp">translúcido</option><option value="solid">opaco</option><option value="hidden">oculto</option></select></label>
      </div>
      <div className="plabel" style={{ marginTop: 10 }}>Mediciones</div>
      {rows.length ? <table className="bom-table"><thead><tr><th>Tipo</th><th>e mm</th><th>Piezas</th><th>m² (superficie de conducto)</th><th>m³</th><th>kg</th><th>Acabado m²</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td>{INS_TYPES[r.type].name}</td><td>{r.e}</td><td>{r.n}</td><td>{f(r.m2)}</td><td>{f(r.m3, 3)}</td><td>{f(r.kg, 1)}</td><td>{r.clad ? `${f(r.clad)} (${INS_TYPES[r.type].clad})` : '—'}</td></tr>)}</tbody></table>
        : <p className="phelp">Sin aislamiento.</p>}
      <div className="modal-btns">
        <button className="btn" disabled={!rows.length} onClick={() => saveText('﻿' + [['Tipo', 'Espesor mm', 'Piezas', 'm2', 'm3', 'kg', 'Acabado m2'].join(';'), ...rows.map((r) => [INS_TYPES[r.type].name, r.e, r.n, f(r.m2), f(r.m3, 3), f(r.kg, 1), r.clad ? f(r.clad) : ''].join(';'))].join('\r\n'), `${base}-aislamiento.csv`, 'CSV', '.csv', 'text/csv')}>CSV</button>
        <button className="btn" disabled={!rows.length} onClick={() => saveText(bc3(rows, base), `${base}-aislamiento.bc3`, 'BC3', '.bc3', 'text/plain')}>BC3</button>
        <span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}

/** FIEBDC-3: capítulo de aislamiento con una partida por tipo/espesor (m²) y otra de acabado */
function bc3(rows: ReturnType<typeof insTakeoff>, base: string) {
  const d = new Date(); const dt = `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`;
  const L = [`~V|INV3D|FIEBDC-3/2016\\${dt}|INV3D|\\|ANSI|`, `~K|\\2\\2\\3\\2\\2\\2\\2\\EUR\\|`, `~C|${base.toUpperCase().slice(0, 18)}##||Aislamiento ${base}|0|${dt}|0|`, `~C|AIS#||Aislamiento térmico de conductos|0|${dt}|0|`];
  const dec: string[] = []; const meas: string[] = [];
  rows.forEach((r, i) => {
    const c = `AIS${String(i + 1).padStart(3, '0')}`; L.push(`~C|${c}|m2|${INS_TYPES[r.type].name} e=${r.e} mm|0|${dt}|0|`); L.push(`~T|${c}|${INS_TYPES[r.type].name} de ${r.e} mm en conductos (RITE IT 1.2.4.2.1), incluso cortes, adhesivo y cinta. Medida la superficie de conducto.|`);
    dec.push(`${c}\\1\\${f(r.m2).replace(/\./g, '').replace(',', '.')}\\`); meas.push(`~M|AIS#\\${c}|1\\${i + 1}|${r.m2.toFixed(2)}|\\${r.n} piezas\\\\\\\\${r.m2.toFixed(2)}\\|`);
    if (r.clad) { const cc = `ACB${String(i + 1).padStart(3, '0')}`; L.push(`~C|${cc}|m2|${INS_TYPES[r.type].clad} sobre aislamiento e=${r.e}|0|${dt}|0|`); dec.push(`${cc}\\1\\${r.clad.toFixed(2)}\\`); }
  });
  L.push(`~D|${base.toUpperCase().slice(0, 18)}##|AIS#\\1\\1\\|`, `~D|AIS#|${dec.join('')}|`, ...meas);
  return L.join('\r\n') + '\r\n';
}
