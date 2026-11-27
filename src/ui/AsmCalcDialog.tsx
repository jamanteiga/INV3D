// Cálculo del tendido HVAC sobre el ensamblaje: caudales, velocidades, pérdidas, circuito índice y ventilador
import { useEffect, useState } from 'react';
import { useStore } from '../core/store';
import { useAsmCalc, calcAssembly, type AsmCalc } from './asmcalc';
import { saveText } from '../core/files';
import { Modal } from './Panels';

const f = (x: number, d = 1) => x.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
export default function AsmCalcDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const st = useAsmCalc();
  const [c, setC] = useState<AsmCalc | null>(st.calc);
  const [err, setErr] = useState('');
  const run = () => { try { setC(calcAssembly()); setErr(''); } catch (e) { setErr((e as Error).message); } };
  useEffect(run, [s.asm]); // se recalcula al cambiar el ensamblaje
  const csv = () => {
    if (!c) return;
    const L = ['Componente;Tipo;Sección;Caudal m3/h;v m/s;R Pa/m;L mm;dp fricción Pa;zeta;dp singular Pa;dp Pa;Aviso', ...c.rows.map((r) => [r.name, r.kind, r.size, f(r.q, 0), f(r.v, 2), f(r.R, 3), f(r.L, 0), f(r.dpF, 1), f(r.zeta, 2), f(r.dpS, 1), f(r.dp, 1), r.warn ?? ''].join(';')),
      '', `Origen;${c.source}`, `Caudal total m3/h;${f(c.qTot, 0)}`, `Circuito índice Pa;${f(c.paths[0]?.dp ?? 0, 1)}`, `Ventilador (+10 %) Pa;${f(c.fanDp, 0)}`];
    saveText('﻿' + L.join('\r\n'), s.fileName.replace(/\.[^.]+$/, '-calculo.csv'), 'CSV', '.csv', 'text/csv');
  };
  return (
    <Modal title="Cálculo del tendido (HVAC)" onClose={onClose} xwide>
      <p className="phelp">Caudales desde los terminales (clic derecho › <i>Caudal de diseño…</i>) sumados hacia el origen ({c?.source ?? '—'}: UTA/fancoil o el componente fijo). Fricción Darcy-Weisbach + Colebrook-White (ε 0,15 mm, ρ 1,2 kg/m³), pérdidas singulares típicas por pieza. Se recalcula al cambiar el ensamblaje.</p>
      <div className="ai-row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <label>v máx. (m/s) <input type="number" step={0.5} value={st.vMax} onChange={(e) => { useAsmCalc.setState({ vMax: Number(e.target.value) || 8 }); setTimeout(run, 0); }} style={{ width: 60 }} /></label>
        <label>R máx. (Pa/m) <input type="number" step={0.1} value={st.rMax} onChange={(e) => { useAsmCalc.setState({ rMax: Number(e.target.value) || 1.5 }); setTimeout(run, 0); }} style={{ width: 60 }} /></label>
        <span>Colores en el 3D:</span>
        {(['none', 'velocity', 'system', 'status'] as const).map((k) => <button key={k} className={`btn sm ${st.colorBy === k ? 'primary' : ''}`} onClick={() => useAsmCalc.setState({ colorBy: k })}>{k === 'none' ? 'Material' : k === 'velocity' ? 'Velocidad' : k === 'system' ? 'Sistema' : 'Estado'}</button>)}
      </div>
      {err && <div className="fdlg-err">{err}</div>}
      {c && (<>
        <div className="ai-row" style={{ gap: 18, margin: '8px 0' }}>
          <span>Caudal total <b>{f(c.qTot, 0)} m³/h</b></span>
          <span>Circuito índice <b>{f(c.paths[0]?.dp ?? 0, 1)} Pa</b> ({c.paths[0]?.name ?? '—'})</span>
          <span>Ventilador (+10 %) <b>{f(c.fanDp, 0)} Pa</b></span>
        </div>
        <div style={{ maxHeight: 340, overflow: 'auto' }}>
          <table className="ptable"><thead><tr><th>Componente</th><th>Sección</th><th className="num">Q m³/h</th><th className="num">v m/s</th><th className="num">R Pa/m</th><th className="num">L mm</th><th className="num">ζ</th><th className="num">Δp Pa</th><th>Aviso</th></tr></thead>
            <tbody>{c.rows.map((r) => (
              <tr key={r.occ} className={r.warn ? 'warn' : c.index.includes(r.occ) ? 'hl' : ''} style={{ cursor: 'pointer' }} onClick={() => useStore.setState({ selItem: r.occ })}>
                <td>{c.index.includes(r.occ) ? '● ' : ''}{r.name}</td><td>{r.size}</td><td className="num">{f(r.q, 0)}</td><td className="num">{f(r.v, 2)}</td><td className="num">{f(r.R, 3)}</td><td className="num">{r.L ? f(r.L, 0) : ''}</td><td className="num">{r.zeta ? f(r.zeta, 2) : ''}</td><td className="num">{f(r.dp, 1)}</td><td>{r.warn ?? ''}</td>
              </tr>))}</tbody></table>
        </div>
        {c.paths.length > 1 && <p className="phelp">Equilibrado: {c.paths.map((p) => `${p.name} ${f(p.dp, 1)} Pa${p.dp < (c.paths[0].dp - 0.5) ? ` (regular ${f(c.paths[0].dp - p.dp, 1)} Pa)` : ''}`).join(' · ')}</p>}
        {c.warnings.map((w) => <div key={w} className="fdlg-err">{w}</div>)}
      </>)}
      <div className="modal-btns"><span className="grow" /><button className="btn" onClick={csv} disabled={!c}>Exportar CSV</button><button className="btn" onClick={run}>Recalcular</button><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}
