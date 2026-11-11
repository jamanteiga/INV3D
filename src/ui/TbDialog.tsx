import { useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { TB_PRESETS, TB_FIELDS, tbTemplate, type TbTemplate, type TbCell } from '../core/drawing';
import { tbValue } from '../core/sheet';
import { saveText, pickFile } from '../core/files';
import { Modal } from './Panels';

const LIB_KEY = 'inv3d.tbtpls';
export const DEF_KEY = 'inv3d.tbtpl.default';
const loadLib = (): TbTemplate[] => { try { return JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); } catch { return []; } };
const saveLib = (l: TbTemplate[]) => { try { localStorage.setItem(LIB_KEY, JSON.stringify(l)); } catch { /* sin almacenamiento */ } };

function valid(x: unknown): TbTemplate {
  const t = x as TbTemplate;
  if (!t || typeof t.name !== 'string' || !Array.isArray(t.cells) || !(t.w > 0) || !(t.h > 0)) throw new Error('No es una plantilla de cajetín válida');
  return { name: t.name, w: +t.w, h: +t.h, proj: t.proj ?? null, cells: t.cells.map((c) => ({ x: +c.x || 0, y: +c.y || 0, w: +c.w || 10, h: +c.h || 8, label: String(c.label ?? ''), field: String(c.field ?? ''), big: !!c.big })) };
}

export default function TbTplDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [tpl, setTpl] = useState<TbTemplate>(() => structuredClone(tbTemplate(s.drw)));
  const [lib, setLib] = useState(loadLib);
  const [sel, setSel] = useState(-1);
  const all = [...TB_PRESETS, ...lib];
  const upd = (i: number, p: Partial<TbCell>) => setTpl({ ...tpl, cells: tpl.cells.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const fieldOpts = useMemo(() => {
    const custom = [...new Set(tpl.cells.filter((c) => c.field.startsWith('custom:')).map((c) => c.field))];
    return [...TB_FIELDS, ...custom.map((c) => [c, `Propio: ${c.slice(7)}`] as [string, string])];
  }, [tpl]);
  // vista previa a escala
  const k = Math.min(560 / tpl.w, 200 / tpl.h);
  const drwPrev = { ...s.drw, tbTpl: tpl };
  const errs: string[] = [];
  tpl.cells.forEach((c, i) => { if (c.x < 0 || c.y < 0 || c.x + c.w > tpl.w + 1e-6 || c.y + c.h > tpl.h + 1e-6) errs.push(`Celda ${i + 1} fuera del cajetín`); });

  const apply = () => { s.commitDrw((d) => { d.tbTpl = structuredClone(tpl); }); s.notify(`Plantilla «${tpl.name}» aplicada`); onClose(); };
  const toLib = () => {
    const l = [...lib.filter((x) => x.name !== tpl.name), structuredClone(tpl)];
    setLib(l); saveLib(l); s.notify(`«${tpl.name}» guardada en la biblioteca`);
  };
  const asDefault = () => { try { localStorage.setItem(DEF_KEY, JSON.stringify(tpl)); s.notify(`Los planos nuevos usarán «${tpl.name}»`); } catch { /* */ } };
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
      <svg viewBox={`-2 -2 ${tpl.w * k + 4} ${tpl.h * k + 4}`} style={{ width: '100%', maxHeight: 220, background: 'var(--panel-2)', borderRadius: 6 }}>
        <rect x={0} y={0} width={tpl.w * k} height={tpl.h * k} fill="#fff" stroke="#222" strokeWidth={1.2} />
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
      <div style={{ maxHeight: 260, overflow: 'auto' }}>
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
      </div>
      <div className="modal-btns">
        <button className="btn" onClick={() => { setTpl({ ...tpl, cells: [...tpl.cells, { x: 0, y: 0, w: 30, h: 8, label: 'Nueva', field: 'custom:Nueva' }] }); setSel(tpl.cells.length); }}>+ Celda</button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={imp}>Importar…</button>
        <button className="btn" onClick={() => saveText(JSON.stringify(tpl, null, 1), `${tpl.name.replace(/[^\w\-]+/g, '_')}.i3tb`, 'Plantilla de cajetín', '.i3tb', 'application/json')}>Exportar</button>
        <button className="btn" onClick={toLib} title="Guardar en la biblioteca de este navegador">Guardar en biblioteca</button>
        {lib.some((x) => x.name === tpl.name) && <button className="btn" onClick={() => { const l = lib.filter((x) => x.name !== tpl.name); setLib(l); saveLib(l); }}>Quitar de biblioteca</button>}
        <button className="btn" onClick={asDefault} title="Plantilla por defecto de los planos nuevos">Por defecto</button>
        <button className="btn primary" disabled={errs.length > 0} onClick={apply}>Aplicar al plano</button>
      </div>
    </Modal>
  );
}
