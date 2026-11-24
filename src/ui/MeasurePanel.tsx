// Panel de la herramienta Medir (pieza y ensamblaje)
import { useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { MATERIALS } from '../core/doc';
import { useMeasure, measureCompute, measureReset, type MMode, type MDist } from './measure';

const MODES: [MMode, string, string][] = [
  ['auto', 'Auto', 'Vértice, arista o cara según lo que haya bajo el cursor'],
  ['vertex', 'Vértice', 'Solo vértices'], ['edge', 'Arista', 'Solo aristas'], ['face', 'Cara', 'Solo caras'], ['loop', 'Bucle', 'Longitud de los bucles (contornos) de una cara'],
];

export default function MeasurePanel() {
  const s = useStore();
  const m = useMeasure();
  const [phys, setPhys] = useState(false);
  const res = useMemo(() => { try { return measureCompute(m.sel, m.dist, m.prec, m.mode === 'loop'); } catch (e) { return { rows: [['Error', String((e as Error).message)]] as [string, string][], copy: '' }; } }, [m.sel, m.dist, m.prec, m.mode]);
  if (s.tool !== 'measure') return null;
  const f = (x: number, p = m.prec) => x.toLocaleString('es-ES', { minimumFractionDigits: p, maximumFractionDigits: p });
  const props = s.kind === 'part' ? s.result?.props : null;
  const dens = MATERIALS.find((x) => x.name === s.doc.iProperties.material)?.density ?? 1000;
  const hint = m.sel.length === 0 ? (m.mode === 'loop' ? 'Haz clic en una cara para medir sus bucles' : 'Haz clic en un vértice, una arista o una cara')
    : m.sel.length === 1 ? 'Selecciona otra entidad para medir distancia y ángulo (o tres vértices para un ángulo)' : '';
  const copy = () => { navigator.clipboard?.writeText(res.copy).then(() => s.notify('Medida copiada al portapapeles'), () => {}); };
  return (
    <div className="measure-panel" onPointerDown={(e) => e.stopPropagation()} data-testid="measure-panel">
      <div className="mp-head"><b>Medir</b><button className="x" title="Cerrar (Esc)" onClick={() => { measureReset(); s.setTool(null); }}>✕</button></div>
      <div className="mp-modes">
        {MODES.map(([k, l, t]) => <button key={k} className={m.mode === k ? 'on' : ''} title={t} onClick={() => useMeasure.setState({ mode: k, sel: [] })}>{l}</button>)}
      </div>
      <div className="mp-sel">
        {[0, 1].map((i) => { const e = m.sel[i]; return (
          <div key={i} className={'mp-slot' + (e ? ' full' : '')}>
            <span className="dot" style={{ background: i === 0 ? 'var(--accent)' : '#d94f8a' }} />
            <span className="t">{e ? `${e.label}${e.owner ? ` · ${e.owner}` : ''}` : i === 0 ? 'Selección 1' : 'Selección 2'}</span>
            {e && <button className="x" title="Quitar" onClick={() => useMeasure.setState({ sel: m.sel.filter((_, j) => j !== i) })}>✕</button>}
          </div>); })}
        {m.sel.length === 3 && <div className="mp-slot full"><span className="dot" style={{ background: '#d94f8a' }} /><span className="t">Vértice 3</span></div>}
      </div>
      {hint && <div className="mp-hint">{hint}</div>}
      {res.rows.length > 0 && (
        <table className="mp-res"><tbody>
          {res.rows.map(([k, v], i) => k === '—' ? <tr key={i} className="sep"><td colSpan={2} /></tr> : <tr key={i}><td>{k}</td><td>{v}</td></tr>)}
        </tbody></table>
      )}
      <div className="mp-opts">
        <label>Distancia <select value={m.dist} onChange={(e) => useMeasure.setState({ dist: e.target.value as MDist })}>
          <option value="min">Mínima</option><option value="max">Máxima</option><option value="center">Centro a centro</option></select></label>
        <label>Precisión <select value={m.prec} onChange={(e) => useMeasure.setState({ prec: Number(e.target.value) })}>
          {[0, 1, 2, 3, 4, 5, 6].map((p) => <option key={p} value={p}>{p === 0 ? '0' : '0,' + '0'.repeat(p)}</option>)}</select></label>
      </div>
      <div className="mp-btns">
        <button className="btn" disabled={!m.sel.length} onClick={measureReset}>Restablecer</button>
        <button className="btn" disabled={!res.copy} onClick={copy}>Copiar</button>
        <button className="btn" disabled={!res.copy} onClick={() => useMeasure.setState({ history: [res.copy.split('\n')[0], ...m.history].slice(0, 12) })}>Al historial</button>
      </div>
      {m.history.length > 0 && <details className="mp-hist"><summary>Historial ({m.history.length})</summary>{m.history.map((h, i) => <div key={i}>{h}</div>)}
        <button className="btn" onClick={() => useMeasure.setState({ history: [] })}>Vaciar</button></details>}
      <div className="mp-btns">
        {s.kind === 'part' && <button className="btn" onClick={() => setPhys(!phys)}>Propiedades físicas</button>}
        {s.kind === 'part' && <button className="btn" onClick={() => s.open({ kind: 'region' })}>Propiedades de región</button>}
        {s.kind === 'assembly' && <button className="btn" onClick={() => s.open({ kind: 'bom' })}>Propiedades físicas</button>}
      </div>
      {phys && props && (
        <table className="mp-res"><tbody>
          <tr><td>Material</td><td>{s.doc.iProperties.material}</td></tr>
          <tr><td>Densidad</td><td>{f(dens / 1000, 3)} g/cm³</td></tr>
          <tr><td>Masa</td><td>{f(props.volume * dens * 1e-9)} kg</td></tr>
          <tr><td>Volumen</td><td>{f(props.volume)} mm³</td></tr>
          <tr><td>Área</td><td>{f(props.area)} mm²</td></tr>
          <tr><td>Centro de gravedad</td><td>{props.cog.map((x) => f(x)).join('; ')}</td></tr>
          <tr><td>Caja (X×Y×Z)</td><td>{[0, 1, 2].map((i) => f(props.bbox[1][i] - props.bbox[0][i])).join(' × ')} mm</td></tr>
        </tbody></table>
      )}
    </div>
  );
}
