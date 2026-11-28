// Pestañas de taller del cuadro Fabricación: unidades e izado, etiquetas, uniones, presupuesto y estados
import { useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { saveText } from '../core/files';
import { unitRows, labelItems, labelsPdf, boltList, budget, DEFAULT_PRICES, type Prices } from './fab2';
import { STATUS_NAMES, STATUS_COLORS, setStatus, useAsmCalc } from './asmcalc';
import { segCfg } from './hvacops';

const f = (x: number, d = 1) => x.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const csv = (rows: (string | number)[][]) => '﻿' + rows.map((r) => r.map((c) => (typeof c === 'number' ? f(c, 2) : c)).join(';')).join('\r\n');

export function UnitsTab({ base }: { base: string }) {
  const s = useStore(); const rows = useMemo(() => unitRows(), [s.asm, s.asmResult, s.settings.liftExtra]); const cf = segCfg();
  return (<>
    <p className="phelp">Unidades de montaje (clic derecho sobre una pieza › <i>Unidad de montaje ▸</i>): medidas de la caja envolvente, peso, <b>centro de gravedad</b> (coordenadas del ensamblaje) y <b>peso de izado</b> con el suplemento de eslingas y útiles. Máximos {cf.maxL} mm / {cf.maxKg} kg ({cf.src}).</p>
    <div className="ai-row"><label>Suplemento de izado (%) <input type="number" min={0} step={5} value={s.settings.liftExtra ?? 10} onChange={(e) => s.set({ settings: { ...s.settings, liftExtra: Math.max(0, Number(e.target.value) || 0) } })} style={{ width: 60 }} /></label></div>
    {rows.length ? <table className="bom-table"><thead><tr><th>Unidad</th><th>Piezas</th><th>Medidas mm</th><th>Peso kg</th><th>Izado kg</th><th>CdG X, Y, Z</th><th /></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.u.id}><td><a href="#" onClick={(e) => { e.preventDefault(); useStore.setState({ selGroup: [...r.u.occs], selItem: r.u.occs[0] }); }}>{r.u.name}</a></td><td>{r.n}</td><td>{r.dims.map((x) => Math.round(x)).join(' × ')}</td><td>{f(r.kg)}</td><td><b>{f(r.lift)}</b></td><td>{r.cog.map((x) => Math.round(x)).join(', ')}</td><td style={{ color: r.ok ? '#1f8a4c' : '#c0392b' }}>{r.ok ? '✓' : '✗'}</td></tr>)}</tbody></table>
      : <p className="phelp">No hay unidades de montaje.</p>}
    <div className="ai-row"><button className="btn" disabled={!rows.length} onClick={() => saveText(csv([['Unidad', 'Piezas', 'Largo', 'Ancho', 'Alto', 'Peso kg', 'Izado kg', 'CdG X', 'CdG Y', 'CdG Z', 'Cumple'], ...rows.map((r) => [r.u.name, r.n, ...r.dims.map(Math.round), r.kg, r.lift, ...r.cog.map(Math.round), r.ok ? 'sí' : 'no'])]), `${base}-unidades.csv`, 'CSV', '.csv', 'text/csv')}>Exportar CSV</button></div>
  </>);
}

export function LabelsTab({ base }: { base: string }) {
  const s = useStore(); const [what, setWhat] = useState<'pieces' | 'units'>('pieces'), [fmt, setFmt] = useState<'a4' | 'roll'>('a4');
  const items = useMemo(() => labelItems(what), [s.asm, s.asmResult, what]);
  const go = async () => { const b = await labelsPdf(items, fmt); await saveText(b, `${base}-etiquetas-${what === 'units' ? 'unidades' : 'piezas'}.pdf`, 'PDF', '.pdf', 'application/pdf'); };
  return (<>
    <p className="phelp">Etiquetas con <b>código QR</b> (proyecto | ensamblaje | pieza | unidad | peso) para marcar las piezas en taller y su recepción en obra.</p>
    <div className="ai-row" style={{ gap: 12 }}>
      <label>Etiquetas de <select value={what} onChange={(e) => setWhat(e.target.value as 'pieces' | 'units')}><option value="pieces">piezas</option><option value="units">unidades de montaje</option></select></label>
      <label>Formato <select value={fmt} onChange={(e) => setFmt(e.target.value as 'a4' | 'roll')}><option value="a4">A4, 2 × 7 (105 × 42 mm)</option><option value="roll">Etiquetadora 100 × 50 mm</option></select></label>
      <button className="btn primary" disabled={!items.length} onClick={() => void go()}>PDF de {items.length} etiqueta(s)</button>
    </div>
    <div style={{ maxHeight: 300, overflow: 'auto' }}><table className="bom-table"><thead><tr><th>Código</th><th>Descripción</th><th>Datos</th></tr></thead>
      <tbody>{items.slice(0, 200).map((it, i) => <tr key={i}><td>{it.code}</td><td>{it.title}</td><td>{it.lines.slice(0, 2).join(' · ')}</td></tr>)}</tbody></table></div>
  </>);
}

export function BoltsTab({ base }: { base: string }) {
  const s = useStore(); const r = useMemo(() => boltList(), [s.asm]);
  return (<>
    <p className="phelp">Material de unión de las {r.joints} unión(es) embridadas: TDC (4 esquineras por brida, 4 tornillos M8 en esquinas, clips cada 300 mm y sellante), marco/aro angular (M8 cada 150 mm), juntas, y en tubería espárragos, tuercas y junta por par de bridas según la norma de la brida.</p>
    <table className="bom-table"><thead><tr><th>Elemento</th><th>Cant.</th><th>Ud</th><th>Nota</th></tr></thead>
      <tbody>{r.rows.map((x, i) => <tr key={i}><td>{x.item}</td><td>{x.unit === 'm' ? f(x.qty) : x.qty}</td><td>{x.unit}</td><td>{x.note}</td></tr>)}</tbody></table>
    <div className="ai-row"><button className="btn" disabled={!r.rows.length} onClick={() => saveText(csv([['Elemento', 'Cantidad', 'Ud', 'Nota'], ...r.rows.map((x) => [x.item, x.qty, x.unit, x.note])]), `${base}-tornilleria.csv`, 'CSV', '.csv', 'text/csv')}>Exportar CSV</button></div>
  </>);
}

export function BudgetTab({ base }: { base: string }) {
  const s = useStore(); const p: Prices = { ...DEFAULT_PRICES, ...(s.settings.prices ?? {}) };
  const set = (k: keyof Prices, v: string) => s.set({ settings: { ...s.settings, prices: { ...p, [k]: Number(v.replace(',', '.')) || 0 } } });
  const b = useMemo(() => budget(p), [s.asm, s.asmResult, JSON.stringify(p)]);
  const In = ({ k, l }: { k: keyof Prices; l: string }) => <label>{l} <input type="number" step="any" defaultValue={p[k]} onBlur={(e) => set(k, e.target.value)} onKeyDown={(e) => e.stopPropagation()} style={{ width: 64 }} /></label>;
  return (<>
    <p className="phelp">Presupuesto orientativo a partir del propio ensamblaje (pesos de cálculo y del modelo, aislamiento por m², soportes, uniones y soldaduras). Los precios se guardan en este navegador.</p>
    <div className="ai-row" style={{ gap: 10, flexWrap: 'wrap' }}>
      <In k="sheet" l="Chapa €/kg" /><In k="pipe" l="Tubería €/kg" /><In k="other" l="Otros €/kg" /><In k="insul" l="Aislam. €/m² (30 mm)" /><In k="clad" l="Acabado €/m²" /><In k="support" l="Soporte €/ud" /><In k="boltSet" l="Unión €/ud" /><In k="weld" l="Soldadura €/ud" /><In k="shopH" l="Taller h/kg" /><In k="siteH" l="Montaje h/kg" /><In k="rate" l="€/h" />
    </div>
    <table className="bom-table"><thead><tr><th>Partida</th><th>Cantidad</th><th>Ud</th><th>€/ud</th><th>Importe €</th></tr></thead>
      <tbody>{b.lines.map((l, i) => <tr key={i}><td>{l.k}</td><td>{f(l.q, l.u === 'ud' ? 0 : 1)}</td><td>{l.u}</td><td>{f(l.pu, 2)}</td><td>{f(l.tot, 2)}</td></tr>)}
        <tr><td colSpan={4}><b>Total (sin IVA)</b></td><td><b>{f(b.total, 2)}</b></td></tr></tbody></table>
    {b.missing > 0 && <p className="phelp" style={{ color: '#a66a00' }}>⚠ {b.missing} componente(s) sin peso todavía (geometría en cálculo).</p>}
    <div className="ai-row"><button className="btn" onClick={() => saveText(csv([['Partida', 'Cantidad', 'Ud', '€/ud', 'Importe €'], ...b.lines.map((l) => [l.k, l.q, l.u, l.pu, l.tot]), ['Total', '', '', '', b.total]]), `${base}-presupuesto.csv`, 'CSV', '.csv', 'text/csv')}>Exportar CSV</button></div>
  </>);
}

export function StatusTab() {
  const s = useStore(); const cnt = new Map<string, number>();
  const list = s.asm.occurrences.filter((o) => !o.suppressed && !o.tag); for (const o of list) cnt.set(o.status ?? 'design', (cnt.get(o.status ?? 'design') ?? 0) + 1);
  const sel = s.selGroup?.length ? s.selGroup : s.selItem ? [s.selItem] : [];
  return (<>
    <p className="phelp">Estado de cada pieza; se ve con colores en el 3D. Se cambia aquí para la selección (pieza o ramal resaltado) o con clic derecho › <i>Estado ▸</i>.</p>
    <table className="bom-table"><thead><tr><th>Estado</th><th>Piezas</th><th>%</th><th /></tr></thead>
      <tbody>{(Object.keys(STATUS_NAMES) as (keyof typeof STATUS_NAMES)[]).map((k) => <tr key={k}><td><span style={{ display: 'inline-block', width: 12, height: 12, background: STATUS_COLORS[k], borderRadius: 3, marginRight: 6 }} />{STATUS_NAMES[k]}</td><td>{cnt.get(k) ?? 0}</td><td>{f(((cnt.get(k) ?? 0) / Math.max(1, list.length)) * 100, 0)}</td>
        <td><button className="btn sm" disabled={!sel.length} onClick={() => setStatus(sel, k)}>Aplicar a la selección ({sel.length})</button></td></tr>)}</tbody></table>
    <div className="ai-row"><button className="btn" onClick={() => useAsmCalc.setState({ colorBy: useAsmCalc.getState().colorBy === 'status' ? 'none' : 'status' })}>{useAsmCalc.getState().colorBy === 'status' ? 'Colores por material' : 'Colores por estado'}</button></div>
  </>);
}

export function RevTab({ base }: { base: string }) {
  const s = useStore(); const [mod, setMod] = useState<typeof import('./asmextra') | null>(null); const [cmp, setCmp] = useState<{ id: string; d: import('./asmextra').RevDiff } | null>(null);
  useMemo(() => { void import('./asmextra').then(setMod); }, []);
  if (!mod) return <p className="phelp">Cargando…</p>;
  const revs = mod.revisions(); const nm = (id: string) => s.asm.occurrences.find((o) => o.id === id)?.name ?? id;
  return (<>
    <p className="phelp">Guarda una <b>revisión</b> del ensamblaje (piezas y posiciones) y compárala después con el estado actual: <span style={{ color: '#27ae60' }}>■ nuevas</span>, <span style={{ color: '#f2994a' }}>■ modificadas</span> (otra pieza, movidas o giradas) en el 3D, y la lista de las eliminadas.</p>
    <div className="ai-row"><button className="btn primary" onClick={() => { const v = prompt('Nombre de la revisión', String.fromCharCode(65 + revs.length)); if (v?.trim()) mod.saveRevision(v.trim()); }}>Guardar revisión actual</button>
      {cmp && <button className="btn" onClick={() => { setCmp(null); useAsmCalc.setState({ colorBy: 'none' }); }}>Quitar colores</button>}</div>
    {revs.length ? <table className="bom-table"><thead><tr><th>Revisión</th><th>Fecha</th><th>Piezas</th><th /></tr></thead>
      <tbody>{revs.map((r) => <tr key={r.id}><td>{r.name}</td><td>{r.date}</td><td>{Object.keys(r.snap).length}</td><td style={{ whiteSpace: 'nowrap' }}><button className="btn sm" onClick={() => { const d = mod.compareRevision(r.id); if (d) setCmp({ id: r.id, d }); }}>Comparar con la actual</button> <button className="btn sm" onClick={() => mod.deleteRevision(r.id)}>✕</button></td></tr>)}</tbody></table>
      : <p className="phelp">Sin revisiones guardadas.</p>}
    {cmp && (<>
      <p className="phelp"><b>{cmp.d.added.length}</b> nuevas · <b>{cmp.d.changed.length}</b> modificadas · <b>{cmp.d.removed.length}</b> eliminadas respecto a {revs.find((r) => r.id === cmp.id)?.name}</p>
      <div style={{ maxHeight: 220, overflow: 'auto' }}><table className="bom-table"><tbody>
        {cmp.d.added.map((id) => <tr key={'a' + id}><td style={{ color: '#27ae60' }}>Nueva</td><td>{nm(id)}</td><td /></tr>)}
        {cmp.d.changed.map((c) => <tr key={'c' + c.id}><td style={{ color: '#f2994a' }}>Modificada</td><td>{nm(c.id)}</td><td>{c.why}</td></tr>)}
        {cmp.d.removed.map((r, i) => <tr key={'r' + i}><td style={{ color: '#c0392b' }}>Eliminada</td><td>{r.name}</td><td>{r.pn}</td></tr>)}
      </tbody></table></div>
      <div className="ai-row"><button className="btn" onClick={() => saveText(csv([['Cambio', 'Componente', 'Detalle'], ...cmp.d.added.map((id) => ['Nueva', nm(id), '']), ...cmp.d.changed.map((c) => ['Modificada', nm(c.id), c.why]), ...cmp.d.removed.map((r) => ['Eliminada', r.name, r.pn])]), `${base}-cambios.csv`, 'CSV', '.csv', 'text/csv')}>Exportar cambios (CSV)</button></div>
    </>)}
  </>);
}
