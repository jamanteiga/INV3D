import type React from "react";
import { useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { TB_PRESETS, TB_FIELDS, SHEETS, ZONES, tbTemplate, type TbTemplate, type TbCell, type TbLabel, type SheetOverlay, type Corner } from '../core/drawing';
import { dxfToGeo, dwgToGeo, dgnToGeo, normalizeGeo, fieldForTag } from '../core/cad2d';
import { tbValue } from '../core/sheet';
import { saveText, pickFile } from '../core/files';
import { Modal, Row } from './Panels';

const LIB_KEY = 'inv3d.tbtpls';
export const DEF_KEY = 'inv3d.tbtpl.default';
const loadLib = (): TbTemplate[] => { try { return JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); } catch { return []; } };
const saveLib = (l: TbTemplate[]) => { try { localStorage.setItem(LIB_KEY, JSON.stringify(l)); } catch { /* sin almacenamiento */ } };

function valid(x: unknown): TbTemplate {
  const t = x as TbTemplate;
  if (!t || typeof t.name !== 'string' || !Array.isArray(t.cells) || !(t.w > 0) || !(t.h > 0)) throw new Error('No es una plantilla de cajetín válida');
  return {
    name: t.name, w: +t.w, h: +t.h, proj: t.proj ?? null, source: t.source,
    cells: t.cells.map((c) => ({ x: +c.x || 0, y: +c.y || 0, w: +c.w || 10, h: +c.h || 8, label: String(c.label ?? ''), field: String(c.field ?? ''), big: !!c.big })),
    geo: t.geo && Array.isArray(t.geo.lines) ? { lines: t.geo.lines, texts: t.geo.texts ?? [] } : undefined,
    labels: Array.isArray(t.labels) ? t.labels.map((l) => ({ x: +l.x || 0, y: +l.y || 0, h: +l.h || 2.5, field: String(l.field ?? ''), label: String(l.label ?? ''), rot: +(l.rot ?? 0) || 0, anchor: l.anchor })) : [],
  };
}

export default function TbTplDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [tpl, setTpl] = useState<TbTemplate>(() => structuredClone(tbTemplate(s.drw)));
  const [lib, setLib] = useState(loadLib);
  const [sel, setSel] = useState(-1);
  const [selL, setSelL] = useState(-1);
  const [impScale, setImpScale] = useState(1);
  const [tab, setTab] = useState<'labels' | 'cells'>(() => (tbTemplate(s.drw).geo ? 'labels' : 'cells'));
  const labels = tpl.labels ?? [];
  const updL = (i: number, p: Partial<TbLabel>) => setTpl({ ...tpl, labels: labels.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const all = [...TB_PRESETS, ...lib];
  const upd = (i: number, p: Partial<TbCell>) => setTpl({ ...tpl, cells: tpl.cells.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const fieldOpts = useMemo(() => {
    const custom = [...new Set([...tpl.cells.map((c) => c.field), ...(tpl.labels ?? []).map((l) => l.field)].filter((f) => f.startsWith('custom:')))];
    return [...TB_FIELDS, ...custom.map((c) => [c, `Propio: ${c.slice(7)}`] as [string, string])];
  }, [tpl]);
  // vista previa a escala
  const k = Math.min(560 / tpl.w, 200 / tpl.h);
  const drwPrev = { ...s.drw, tbTpl: tpl };
  const errs: string[] = [];
  tpl.cells.forEach((c, i) => { if (c.x < 0 || c.y < 0 || c.x + c.w > tpl.w + 1e-6 || c.y + c.h > tpl.h + 1e-6) errs.push(`Celda ${i + 1} fuera del cajetín`); });
  (tpl.labels ?? []).forEach((l, i) => { if (!l.field) errs.push(`Etiqueta ${i + 1}: indica a qué hace referencia`); });

  const apply = () => { s.commitDrw((d) => { d.tbTpl = structuredClone(tpl); }); s.notify(`Plantilla «${tpl.name}» aplicada`); onClose(); };
  const toLib = () => {
    const l = [...lib.filter((x) => x.name !== tpl.name), structuredClone(tpl)];
    setLib(l); saveLib(l); s.notify(`«${tpl.name}» guardada en la biblioteca`);
  };
  const asDefault = () => { try { localStorage.setItem(DEF_KEY, JSON.stringify(tpl)); s.notify(`Los planos nuevos usarán «${tpl.name}»`); } catch { /* */ } };
  // Dibujo externo como cajetín: DXF, DWG o DGN (V7); los atributos pasan a etiquetas enlazadas a campos
  const impDraw = async () => {
    const f = await pickFile('.dxf,.dwg,.dgn'); if (!f) return;
    try {
      const ext = f.name.split('.').pop()!.toLowerCase();
      const raw = ext === 'dxf' ? dxfToGeo(await f.text()) : ext === 'dwg' ? await dwgToGeo(await f.arrayBuffer()) : dgnToGeo(await f.arrayBuffer());
      const n = normalizeGeo(raw, impScale || 1);
      const labs: TbLabel[] = n.geo.tags.map((t) => ({ x: t.x, y: t.y, h: t.h, rot: t.rot || 0, field: fieldForTag(t.tag), label: t.tag }));
      setTpl({ name: f.name.replace(/\.[^.]+$/, ''), w: Math.round(n.w * 100) / 100, h: Math.round(n.h * 100) / 100, cells: [], proj: null, source: f.name,
        geo: { lines: n.geo.lines, texts: n.geo.texts.map(({ x, y, h, text, rot }) => ({ x, y, h, text, rot })) }, labels: labs });
      setTab('labels'); setSel(-1); setSelL(-1);
      s.notify(`${f.name}: ${n.geo.lines.length} líneas, ${n.geo.texts.length} textos y ${labs.length} atributos convertidos en etiquetas (${Math.round(n.w)} × ${Math.round(n.h)} mm)`);
    } catch (e) { s.notify((e as Error).message, 'error'); }
  };
  const imp = async () => {
    const f = await pickFile('.json,.i3tb'); if (!f) return;
    try { setTpl(valid(JSON.parse(await f.text()))); } catch (e) { s.notify((e as Error).message, 'error'); }
  };

  return (
    <Modal title="Plantilla de cajetín" onClose={onClose} xwide>
      <div className="modal-btns">
        <select value="" onChange={(e) => { const t = all[+e.target.value]; if (t) { setTpl(structuredClone(t)); setSel(-1); } }}>
          <option value="">Cargar plantilla…</option>
          {all.map((t, i) => <option key={i} value={i}>{i >= TB_PRESETS.length ? '★ ' : ''}{t.name}</option>)}
        </select>
        <label>Nombre <input value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} style={{ width: 180 }} /></label>
        <label>Ancho <input className="num" type="number" value={tpl.w} onChange={(e) => setTpl({ ...tpl, w: +e.target.value || 10 })} style={{ width: 60 }} /></label>
        <label>Alto <input className="num" type="number" value={tpl.h} onChange={(e) => setTpl({ ...tpl, h: +e.target.value || 10 })} style={{ width: 60 }} /></label>
        <label><input type="checkbox" checked={!!tpl.proj} onChange={(e) => setTpl({ ...tpl, proj: e.target.checked ? { x: tpl.w - 12, y: 4 } : null })} /> Símbolo de proyección</label>
        {tpl.proj && <>x <input className="num" type="number" value={tpl.proj.x} onChange={(e) => setTpl({ ...tpl, proj: { ...tpl.proj!, x: +e.target.value } })} style={{ width: 56 }} /> y <input className="num" type="number" value={tpl.proj.y} onChange={(e) => setTpl({ ...tpl, proj: { ...tpl.proj!, y: +e.target.value } })} style={{ width: 50 }} /></>}
      </div>
      <svg viewBox={`-2 -2 ${tpl.w * k + 4} ${tpl.h * k + 4}`} style={{ width: '100%', maxHeight: 240, background: 'var(--panel-2)', borderRadius: 6, cursor: tab === 'labels' && selL >= 0 ? 'crosshair' : 'default' }}
        onClick={(e) => {
          if (tab !== 'labels' || selL < 0) return;
          const svg = e.currentTarget, pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
          const q = pt.matrixTransform(svg.getScreenCTM()!.inverse());
          updL(selL, { x: Math.round((q.x / k) * 10) / 10, y: Math.round((tpl.h - q.y / k) * 10) / 10 });
        }}>
        <rect x={0} y={0} width={tpl.w * k} height={tpl.h * k} fill="#fff" stroke={tpl.geo ? '#ccc' : '#222'} strokeWidth={tpl.geo ? 0.5 : 1.2} strokeDasharray={tpl.geo ? '3 2' : undefined} />
        {tpl.geo?.lines.map((l, i) => <polyline key={'g' + i} points={l.map(([x, y]) => `${x * k},${(tpl.h - y) * k}`).join(' ')} fill="none" stroke="#222" strokeWidth={0.7} />)}
        {tpl.geo?.texts.map((t, i) => <text key={'t' + i} x={t.x * k} y={(tpl.h - t.y) * k} fontSize={t.h * k} fill="#333" fontFamily="Arial" transform={t.rot ? `rotate(${-t.rot} ${t.x * k} ${(tpl.h - t.y) * k})` : undefined}>{t.text}</text>)}
        {labels.map((l, i) => {
          const v = tbValue(drwPrev, l.field) || `‹${l.label || l.field.replace('custom:', '')}›`, X = l.x * k, Y = (tpl.h - l.y) * k;
          return <g key={'l' + i} onClick={(e) => { e.stopPropagation(); setTab('labels'); setSelL(i); }} style={{ cursor: 'pointer' }}>
            <text x={X} y={Y} fontSize={l.h * k} fill={selL === i ? '#1665c1' : '#0b6b2e'} fontFamily="Arial" fontWeight={600} textAnchor={l.anchor ?? 'start'} transform={l.rot ? `rotate(${-l.rot} ${X} ${Y})` : undefined}>{v}</text>
            <circle cx={X} cy={Y} r={1.6} fill={selL === i ? '#1665c1' : '#0b6b2e'} />
          </g>;
        })}
        {tpl.cells.map((c, i) => {
          const X = c.x * k, Y = (tpl.h - c.y - c.h) * k, val = tbValue(drwPrev, c.field) || (!c.field || c.field.startsWith('#') || c.field.startsWith('=') ? '' : `‹${c.field.replace('custom:', '')}›`);
          return (
            <g key={i} onClick={() => setSel(i)} style={{ cursor: 'pointer' }}>
              <rect x={X} y={Y} width={c.w * k} height={c.h * k} fill={sel === i ? 'rgba(47,111,224,.15)' : 'transparent'} stroke="#222" strokeWidth={0.8} />
              <text x={X + 1.2 * k} y={Y + 2.4 * k} fontSize={1.8 * k} fill="#555">{c.label}</text>
              <text x={X + 1.2 * k} y={Y + c.h * k - (c.big ? 3 : 1.4) * k} fontSize={(c.big ? 5 : 2.5) * k} fontWeight={c.big ? 700 : 400} fill="#111">{val}</text>
            </g>
          );
        })}
        {tpl.proj && <g stroke="#222" fill="none" strokeWidth={0.8}><circle cx={(tpl.proj.x - 3) * k} cy={(tpl.h - tpl.proj.y) * k} r={2.6 * k} /><circle cx={(tpl.proj.x - 3) * k} cy={(tpl.h - tpl.proj.y) * k} r={1.2 * k} /></g>}
      </svg>
      {errs.length > 0 && <p style={{ color: 'var(--danger)', fontSize: 12 }}>{errs.join(' · ')}</p>}
      <div className="modal-btns">
        <div className="seg-mini">
          <button className={tab === 'labels' ? 'on' : ''} onClick={() => setTab('labels')}>Etiquetas ({labels.length})</button>
          <button className={tab === 'cells' ? 'on' : ''} onClick={() => setTab('cells')}>Celdas ({tpl.cells.length})</button>
        </div>
        <span style={{ flex: 1 }} />
        <label title="Factor aplicado a las coordenadas del dibujo importado (p. ej. 1000 si está en metros sin unidades)">Escala al importar <input className="num" type="number" value={impScale} onChange={(e) => setImpScale(+e.target.value || 1)} style={{ width: 64 }} /></label>
        <button className="btn" onClick={impDraw} title="Usa un cajetín dibujado en otro programa: DXF, DWG o DGN (V7). Los atributos del bloque se convierten en etiquetas">Importar DXF / DWG / DGN…</button>
        {tpl.geo && <button className="btn" onClick={() => setTpl({ ...tpl, geo: undefined, source: undefined })}>Quitar dibujo</button>}
      </div>
      {tab === 'labels' && <div style={{ maxHeight: 260, overflow: 'auto' }}>
        <table className="ptable">
          <thead><tr><th>#</th><th>Etiqueta</th><th>Hace referencia a</th><th>x</th><th>y</th><th>altura</th><th>giro</th><th>alineación</th><th /></tr></thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={i} style={selL === i ? { background: 'rgba(47,111,224,.08)' } : undefined} onClick={() => setSelL(i)}>
                <td className="num">{i + 1}</td>
                <td><input value={l.label} placeholder="Descripción" onChange={(e) => updL(i, { label: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></td>
                <td style={{ minWidth: 190 }}>
                  <select value={l.field.startsWith('=') ? '=' : fieldOpts.some(([f]) => f === l.field) ? l.field : ''} className={l.field ? '' : 'bad'} onChange={(e) => {
                    const v = e.target.value;
                    if (v === '=') updL(i, { field: '=' + (l.field.startsWith('=') ? l.field.slice(1) : l.label) });
                    else if (v === '+') { const n = prompt('Nombre del campo propio'); if (n) updL(i, { field: 'custom:' + n.trim(), label: l.label || n.trim() }); }
                    else updL(i, { field: v });
                  }}>
                    <option value="">— elegir —</option>
                    {fieldOpts.map(([f, lb]) => <option key={f} value={f}>{lb}</option>)}
                    <option value="=">Texto fijo</option>
                    <option value="+">Campo propio nuevo…</option>
                  </select>
                  {l.field.startsWith('=') && <input value={l.field.slice(1)} onChange={(e) => updL(i, { field: '=' + e.target.value })} onKeyDown={(e) => e.stopPropagation()} />}
                </td>
                {(['x', 'y', 'h', 'rot'] as const).map((key) => <td key={key}><input type="number" value={l[key] ?? 0} onChange={(e) => updL(i, { [key]: +e.target.value || 0 })} style={{ width: 54 }} /></td>)}
                <td><select value={l.anchor ?? 'start'} onChange={(e) => updL(i, { anchor: e.target.value as TbLabel['anchor'] })}><option value="start">Izquierda</option><option value="middle">Centro</option><option value="end">Derecha</option></select></td>
                <td><button className="btn sm" title="Quitar etiqueta" onClick={(e) => { e.stopPropagation(); setTpl({ ...tpl, labels: labels.filter((_, j) => j !== i) }); setSelL(-1); }}>✕</button></td>
              </tr>
            ))}
            {!labels.length && <tr><td colSpan={9} className="empty">Sin etiquetas. «+ Etiqueta» añade una; elige a qué campo hace referencia y haz clic en la vista previa para situarla.</td></tr>}
          </tbody>
        </table>
      </div>}
      {tab === 'cells' && <div style={{ maxHeight: 260, overflow: 'auto' }}>
        <table className="ptable">
          <thead><tr><th>#</th><th>Etiqueta</th><th>Contenido</th><th>x</th><th>y</th><th>ancho</th><th>alto</th><th>Grande</th><th /></tr></thead>
          <tbody>
            {tpl.cells.map((c, i) => (
              <tr key={i} style={sel === i ? { background: 'rgba(47,111,224,.08)' } : undefined} onClick={() => setSel(i)}>
                <td className="num">{i + 1}</td>
                <td><input value={c.label} onChange={(e) => upd(i, { label: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></td>
                <td style={{ minWidth: 190 }}>
                  <select value={c.field.startsWith('=') ? '=' : fieldOpts.some(([f]) => f === c.field) ? c.field : ''} onChange={(e) => {
                    const v = e.target.value;
                    if (v === '=') upd(i, { field: '=' + (c.field.startsWith('=') ? c.field.slice(1) : c.label) });
                    else if (v === '+') { const n = prompt('Nombre del campo propio'); if (n) upd(i, { field: 'custom:' + n.trim(), label: c.label || n.trim() }); }
                    else upd(i, { field: v });
                  }}>
                    <option value="">(vacía)</option>
                    {fieldOpts.map(([f, l]) => <option key={f} value={f}>{l}</option>)}
                    <option value="=">Texto fijo</option>
                    <option value="+">Campo propio nuevo…</option>
                  </select>
                  {c.field.startsWith('=') && <input value={c.field.slice(1)} onChange={(e) => upd(i, { field: '=' + e.target.value })} onKeyDown={(e) => e.stopPropagation()} />}
                </td>
                {(['x', 'y', 'w', 'h'] as const).map((key) => <td key={key}><input type="number" value={c[key]} onChange={(e) => upd(i, { [key]: +e.target.value || 0 })} style={{ width: 54 }} /></td>)}
                <td><input type="checkbox" checked={!!c.big} onChange={(e) => upd(i, { big: e.target.checked })} /></td>
                <td><button className="btn sm" title="Quitar celda" onClick={(e) => { e.stopPropagation(); setTpl({ ...tpl, cells: tpl.cells.filter((_, j) => j !== i) }); setSel(-1); }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      <div className="modal-btns">
        <button className="btn" onClick={() => { setTab('labels'); setTpl({ ...tpl, labels: [...labels, { x: 4, y: 4, h: 2.5, field: '', label: 'Etiqueta ' + (labels.length + 1) }] }); setSelL(labels.length); }}>+ Etiqueta</button>
        <button className="btn" onClick={() => { setTab('cells'); setTpl({ ...tpl, cells: [...tpl.cells, { x: 0, y: 0, w: 30, h: 8, label: 'Nueva', field: 'custom:Nueva' }] }); setSel(tpl.cells.length); }}>+ Celda</button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={imp}>Importar plantilla…</button>
        <button className="btn" onClick={() => saveText(JSON.stringify(tpl, null, 1), `${tpl.name.replace(/[^\w\-]+/g, '_')}.i3tb`, 'Plantilla de cajetín', '.i3tb', 'application/json')}>Exportar</button>
        <button className="btn" onClick={toLib} title="Guardar en la biblioteca de este navegador">Guardar en biblioteca</button>
        {lib.some((x) => x.name === tpl.name) && <button className="btn" onClick={() => { const l = lib.filter((x) => x.name !== tpl.name); setLib(l); saveLib(l); }}>Quitar de biblioteca</button>}
        <button className="btn" onClick={asDefault} title="Plantilla por defecto de los planos nuevos">Por defecto</button>
        <button className="btn primary" disabled={errs.length > 0} onClick={apply}>Aplicar al plano</button>
      </div>
    </Modal>
  );
}

/** Lee un DXF/DWG/DGN como dibujo de hoja (líneas, textos y atributos → etiquetas enlazadas a campos) */
async function readOverlay(f: File, scale: number): Promise<SheetOverlay> {
  const ext = f.name.split('.').pop()!.toLowerCase();
  const raw = ext === 'dxf' ? dxfToGeo(await f.text()) : ext === 'dwg' ? await dwgToGeo(await f.arrayBuffer()) : dgnToGeo(await f.arrayBuffer());
  const n = normalizeGeo(raw, scale || 1);
  return {
    name: f.name.replace(/\.[^.]+$/, ''), source: f.name, w: Math.round(n.w * 100) / 100, h: Math.round(n.h * 100) / 100,
    geo: { lines: n.geo.lines, texts: n.geo.texts.map(({ x, y, h, text, rot }) => ({ x, y, h, text, rot })) },
    labels: n.geo.tags.map((t) => ({ x: t.x, y: t.y, h: t.h, rot: t.rot || 0, field: fieldForTag(t.tag), label: t.tag })),
  };
}

/** Plantillas de la hoja: zonas, plano completo, bordes, cajetín principal, cajetín de revisiones y copyright */
export function SheetTplDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const d = s.drw;
  const [W, H] = SHEETS[d.sheet];
  const [scale, setScale] = useState(1);
  const imp = async (key: 'sheetTpl' | 'borderTpl' | 'revTpl' | 'copyright') => {
    const f = await pickFile('.dxf,.dwg,.dgn'); if (!f) return;
    try {
      const o = await readOverlay(f, scale);
      s.commitDrw((dd) => {
        if (key === 'copyright') dd.copyright = { ...o, corner: dd.copyright?.corner ?? 'bl' };
        else if (key === 'sheetTpl') dd.sheetTpl = { ...o, hideTb: dd.sheetTpl?.hideTb ?? true };
        else dd[key] = o;
      });
      const warn = (key === 'sheetTpl' || key === 'borderTpl') && (Math.abs(o.w - W) > 2 || Math.abs(o.h - H) > 2) ? ` · ojo: el formato ${d.sheet} mide ${W} × ${H}` : '';
      s.notify(`${f.name}: ${o.geo.lines.length} líneas, ${o.geo.texts.length} textos, ${o.labels?.length ?? 0} atributos (${Math.round(o.w)} × ${Math.round(o.h)} mm)${warn}`);
    } catch (e) { s.notify((e as Error).message, 'error'); }
  };
  const rm = (key: 'sheetTpl' | 'borderTpl' | 'revTpl' | 'copyright') => s.commitDrw((dd) => { delete dd[key]; });
  const Item = ({ k, label, help, children }: { k: 'sheetTpl' | 'borderTpl' | 'revTpl' | 'copyright'; label: string; help: string; children?: React.ReactNode }) => (
    <div className="psec" style={{ marginBottom: 8 }}>
      <div className="psec-title">{label}</div>
      <p className="phelp" style={{ margin: '2px 0 6px' }}>{help}</p>
      <div className="modal-btns" style={{ justifyContent: 'flex-start', margin: 0 }}>
        <span className="ro" style={{ minWidth: 180 }}>{d[k] ? `${d[k]!.source ?? d[k]!.name} · ${Math.round(d[k]!.w)} × ${Math.round(d[k]!.h)} mm` : 'Ninguno'}</span>
        <button className="btn" onClick={() => imp(k)}>Importar DXF / DWG…</button>
        {d[k] && <button className="btn" onClick={() => rm(k)}>Quitar</button>}
        {children}
      </div>
    </div>
  );
  return (
    <Modal title="Plantillas de hoja" onClose={onClose} wide>
      <label className="check"><input type="checkbox" checked={d.zones !== false} onChange={(e) => s.commitDrw((dd) => { dd.zones = e.target.checked; })} />Separadores de zona en los bordes (1, 2, 3… y A, B, C…) · {d.sheet}: {ZONES[d.sheet][0]} × {ZONES[d.sheet][1]}</label>
      <Row label="Escala al importar"><input className="num" type="number" value={scale} onChange={(e) => setScale(+e.target.value || 1)} style={{ width: 70 }} /><span className="ro" style={{ marginLeft: 6 }}>1000 si el dibujo está en metros</span></Row>
      <Item k="sheetTpl" label="Plano completo" help="Dibujo de la hoja entera (marco, zonas y cajetín) colocado en la esquina inferior izquierda; sustituye al marco generado. Los atributos se enlazan a los campos del cajetín.">
        {d.sheetTpl && <label className="check"><input type="checkbox" checked={!!d.sheetTpl.hideTb} onChange={(e) => s.commitDrw((dd) => { if (dd.sheetTpl) dd.sheetTpl.hideTb = e.target.checked; })} />Incluye el cajetín (oculta el de INV3D)</label>}
      </Item>
      <Item k="borderTpl" label="Bordes" help="Solo el marco y las zonas; el cajetín sigue siendo la plantilla de cajetín." />
      <div className="psec" style={{ marginBottom: 8 }}>
        <div className="psec-title">Cajetín de datos principales</div>
        <div className="modal-btns" style={{ justifyContent: 'flex-start', margin: 0 }}><span className="ro" style={{ minWidth: 180 }}>{tbTemplate(d).name}</span><button className="btn" onClick={() => s.open({ kind: 'tbtpl' })}>Editar / importar…</button><span className="ro">(también con doble clic sobre el cajetín)</span></div>
      </div>
      <Item k="revTpl" label="Cajetín de revisiones" help="Se coloca encima del cajetín principal, alineado a la derecha. La tabla de revisiones (Anotar › Tabla › Revisiones) sigue disponible." />
      <Item k="copyright" label="Copyright" help="Bloque de texto o logotipo desde un DXF/DWG, en la esquina que elijas dentro del marco.">
        {d.copyright && <select value={d.copyright.corner} onChange={(e) => s.commitDrw((dd) => { if (dd.copyright) dd.copyright.corner = e.target.value as Corner; })}>
          <option value="bl">Abajo a la izquierda</option><option value="br">Abajo a la derecha (sobre el cajetín)</option><option value="tl">Arriba a la izquierda</option><option value="tr">Arriba a la derecha</option>
        </select>}
      </Item>
      <div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}
