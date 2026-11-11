import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../core/store';
import { docParams, MATERIALS, type PartDoc } from '../core/doc';
import { makeEval, fmt } from '../core/expr';
import { partDims, setPartDim, type PartDim } from '../core/partdims';
import { asmActions } from './actions';
import { Modal } from './Panels';

/** Campo de cota evaluado con los parámetros de la pieza (no con los del documento activo) */
function DimIn({ dim, ev, onCommit }: { dim: PartDim; ev: (x: string) => number; onCommit: (v: string) => void }) {
  const [txt, setTxt] = useState(dim.expr);
  useEffect(() => setTxt(dim.expr), [dim.expr]);
  const withUnit = (t: string) => (/^-?(\d+\.?\d*|\.\d+)$/.test(t.trim()) && dim.unit ? `${t.trim()} ${dim.unit}` : t);
  let val = NaN, err = '';
  try { val = ev(withUnit(txt)); if (!isFinite(val)) err = 'Valor no válido'; } catch (e) { err = (e as Error).message; }
  const commit = () => { if (!err && txt !== dim.expr) onCommit(withUnit(txt)); };
  const plain = /^-?[\d.]+\s*(mm|deg|°)?$/.test(txt.trim());
  return (
    <div className={`expr ${err ? 'bad' : ''}`} title={err || undefined}>
      <input value={txt} spellCheck={false} onChange={(e) => setTxt(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setTxt(dim.expr); e.stopPropagation(); }} />
      <span className="expr-val">{err ? '!' : plain ? (dim.unit === 'deg' ? '°' : dim.unit) : `= ${fmt(val, 3)}`}</span>
    </div>
  );
}

/** Propiedades de un componente del ensamblaje: físicas y cotas geométricas editables de su pieza */
export default function OccPropsDialog({ occ, onClose }: { occ: string; onClose: () => void }) {
  const s = useStore();
  const view = s.asmResult?.view ?? s.asm;
  const o = view.occurrences.find((x) => x.id === occ) ?? s.asm.occurrences.find((x) => x.id === occ);
  const doc = o ? (s.docData(o.part) as PartDoc | null) : null;
  const dims = useMemo(() => (doc ? partDims(doc) : []), [doc]);
  const ev = useMemo(() => { const e = doc ? makeEval(docParams(doc)) : null; return (x: string) => (e ? e(x) : NaN); }, [doc]);
  const [filter, setFilter] = useState('');
  // Estado original al abrir: Cancelar lo restaura; Aceptar lo guarda en el historial de la pieza
  const orig = useRef<{ part: string; data: PartDoc; dirty: boolean } | null>(null);
  if (!orig.current && o && doc) orig.current = { part: o.part, data: doc, dirty: !!s.docs.find((d) => d.id === o.part)?.dirty };
  const changed = !!orig.current && doc !== orig.current.data;
  const cancel = () => { const c = orig.current; if (c && useStore.getState().docData(c.part) !== c.data) useStore.getState().previewPartDoc(c.part, c.data, c.dirty); onClose(); };
  const accept = () => { const c = orig.current; if (c) useStore.getState().commitPartDoc(c.part, c.data); onClose(); };
  if (!o || !doc || doc.format !== 'inv3d.part') return <Modal title="Propiedades" onClose={onClose}><p>El componente no es una pieza.</p></Modal>;
  const r = s.asmResult?.parts[o.part];
  const p = r?.props;
  const mat = MATERIALS.find((x) => x.name === doc.iProperties.material);
  const dens = mat?.density ?? 7850;
  const copies = view.occurrences.filter((x) => x.part === o.part && !x.suppressed).length;
  const fileName = s.docs.find((d) => d.id === o.part)?.fileName ?? '';
  const edit = (next: PartDoc) => s.previewPartDoc(o.part, next);
  const groups = new Map<string, PartDim[]>();
  for (const d of dims) if (!filter || `${d.group} ${d.label}`.toLowerCase().includes(filter.toLowerCase())) { const l = groups.get(d.group) ?? []; l.push(d); groups.set(d.group, l); }
  const bb = p?.bbox;
  const size = bb ? [bb[1][0] - bb[0][0], bb[1][1] - bb[0][1], bb[1][2] - bb[0][2]] : null;

  return (
    <Modal title={`Propiedades · ${o.name}`} onClose={cancel} wide>
      <div className="occp">
        <div className="occp-col">
          <div className="psec-title">Físicas</div>
          <table className="ptable"><tbody>
            <tr><td>Pieza</td><td>{fileName}</td></tr>
            <tr><td>Nº de pieza</td><td>{doc.iProperties.partNumber}</td></tr>
            <tr><td>Material</td><td>
              <select value={doc.iProperties.material} onChange={(e) => edit({ ...doc, iProperties: { ...doc.iProperties, material: e.target.value } })}>
                {!mat && <option>{doc.iProperties.material}</option>}
                {MATERIALS.map((m) => <option key={m.name}>{m.name}</option>)}
              </select>
            </td></tr>
            <tr><td>Densidad</td><td className="num">{fmt(dens, 0)} kg/m³</td></tr>
            {p ? <>
              <tr><td>Masa</td><td className="num"><b>{fmt(p.volume * 1e-9 * dens, 3)} kg</b></td></tr>
              <tr><td>Volumen</td><td className="num">{fmt(p.volume / 1000, 2)} cm³</td></tr>
              <tr><td>Área</td><td className="num">{fmt(p.area / 100, 2)} cm²</td></tr>
              {size && <tr><td>Medidas X × Y × Z</td><td className="num">{size.map((v) => fmt(v, 1)).join(' × ')} mm</td></tr>}
              <tr><td>CdG (coord. pieza)</td><td className="num">{p.cog.map((v) => fmt(v, 1)).join(' ; ')} mm</td></tr>
            </> : <tr><td colSpan={2} className="muted">{s.busy ? 'Calculando…' : 'Sin sólido'}</td></tr>}
          </tbody></table>
          <div className="modal-btns">
            <button className="btn" title="Acepta los cambios y edita la pieza en el ensamblaje" onClick={() => { accept(); asmActions.editInPlace(o.id); }}>Editar en contexto</button>
            <button className="btn" title="Acepta los cambios y abre la pieza" onClick={() => { accept(); s.activate(o.part); }}>Abrir pieza</button>
          </div>
        </div>
        <div className="occp-col">
          <div className="psec-title">Geométricas {copies > 1 && <span className="muted" style={{ fontWeight: 400 }}>· afecta a las {copies} apariciones</span>}</div>
          {dims.length > 8 && <input className="occp-filter" placeholder="Filtrar…" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />}
          {!dims.length && <p className="muted">La pieza no tiene cotas editables (importada o solo con contornos libres).</p>}
          <div className="occp-dims">
            {[...groups].map(([g, list]) => (
              <div key={g} className="occp-grp">
                <div className="occp-gname">{g}</div>
                {list.map((d) => (
                  <div key={d.path.join('.')} className="occp-row">
                    <span>{d.label}</span>
                    <DimIn dim={d} ev={ev} onCommit={(v) => edit(setPartDim(doc, d.path, v))} />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 11.5 }}>Admite expresiones con los parámetros de la pieza (p. ej. <code>L/2 + 10</code>). Intro o salir del campo muestra el cambio en vista previa; <b>Aceptar</b> lo aplica y <b>Cancelar</b> (o Esc) deja la pieza como estaba.</p>
        </div>
      </div>
      <div className="modal-btns occp-foot">
        <span className="muted" style={{ fontSize: 12 }}>{changed ? 'Cambios en vista previa: Aceptar los aplica, Cancelar deja la pieza como estaba.' : 'Sin cambios.'}</span>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={cancel}>Cancelar</button>
        <button className="btn primary" onClick={accept}>Aceptar</button>
      </div>
    </Modal>
  );
}
