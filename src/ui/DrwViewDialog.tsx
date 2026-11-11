import { useState } from 'react';
import { useStore } from '../core/store';
import { SCALES, scaleLabel, VIEW_NAMES, type DView, type ViewDir } from '../core/drawing';
import { drwActions } from './actions';
import { Modal } from './Panels';

const KIND: Record<string, string> = { base: 'Vista base', proj: 'Vista proyectada', iso: 'Vista isométrica', section: 'Sección', detail: 'Detalle', aux: 'Vista auxiliar', flat: 'Desarrollo' };

/** «1:5», «2:1», «0,25» o «5» (= 1:5 si es mayor que 1 sin dos puntos se interpreta como 1:n) */
function parseScale(t: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*:\s*(\d+(?:[.,]\d+)?)\s*$/.exec(t);
  if (m) { const a = parseFloat(m[1].replace(',', '.')), b = parseFloat(m[2].replace(',', '.')); return a > 0 && b > 0 ? a / b : null; }
  const x = parseFloat(t.replace(',', '.'));
  return x > 0 ? x : null;
}

/** Propiedades de una vista del plano (doble clic): escala, etiqueta, aristas ocultas, marcas de centro, contorno del detalle */
export default function DrwViewDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const s = useStore();
  const v0 = s.drw.views.find((x) => x.id === id);
  const parent = v0?.parent ? s.drw.views.find((x) => x.id === v0.parent) : null;
  const [v, setV] = useState<DView | null>(() => (v0 ? structuredClone(v0) : null));
  const [custom, setCustom] = useState(() => (v0 && !SCALES.includes(v0.scale) ? scaleLabel(v0.scale) : ''));
  if (!v0 || !v) return null;
  const kind = v.kind ?? 'base';
  const follows = !!parent && kind !== 'detail' && !v.ownScale;
  const up = (p: Partial<DView>) => setV({ ...v, ...p });
  const customVal = custom ? parseScale(custom) : null;
  const scaleNow = follows ? parent!.scale : customVal ?? v.scale;
  const children = s.drw.views.filter((x) => x.parent === v.id && x.kind !== 'detail' && !x.ownScale);

  const accept = () => {
    if (custom && !customVal) { s.notify('Escala no válida: escribe por ejemplo 1:7,5 o 3:1', 'error'); return; }
    const sc = scaleNow;
    s.commitDrw((d) => {
      const t = d.views.find((x) => x.id === v.id); if (!t) return;
      const old = t.scale;
      Object.assign(t, { ...v, x: t.x, y: t.y, scale: sc, ownScale: parent && kind !== 'detail' ? !!v.ownScale : undefined });
      if (old !== sc) {
        // las vistas que dependen de esta siguen su escala
        const walk = (pid: string, scale: number) => { for (const c of d.views) if (c.parent === pid && c.kind !== 'detail' && !c.ownScale) { c.scale = scale; walk(c.id, scale); } };
        walk(t.id, sc);
        if (!t.parent) d.title.scale = scaleLabel(sc);
      }
    });
    onClose();
  };

  return (
    <Modal title={`${KIND[kind] ?? 'Vista'}${v.label ? ` ${v.label}` : ''} · propiedades`} onClose={onClose}>
      <table className="ptable vprops"><tbody>
        <tr><td>Tipo</td><td>{KIND[kind]}{parent ? ` de «${parent.kind === 'section' ? `Sección ${parent.label}` : parent.name}»` : ''}</td></tr>
        <tr><td>Modelo</td><td>{s.docs.find((x) => x.id === v.source)?.fileName ?? '—'}</td></tr>
        {(kind === 'section' || kind === 'detail' || kind === 'aux') && <tr><td>Etiqueta</td><td><input value={v.label ?? ''} maxLength={3} onChange={(e) => up({ label: e.target.value.toUpperCase() })} onKeyDown={(e) => e.stopPropagation()} style={{ width: 60 }} /></td></tr>}
        {(kind === 'base' || kind === 'iso') && <tr><td>Orientación</td><td><select value={v.dir} onChange={(e) => up({ dir: e.target.value as ViewDir, name: VIEW_NAMES[e.target.value as ViewDir] })}>{Object.entries(VIEW_NAMES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></td></tr>}
        {parent && kind !== 'detail' && (
          <tr><td>Escala</td><td>
            <label className="check"><input type="radio" checked={!v.ownScale} onChange={() => up({ ownScale: false })} /> Usar la de la vista padre ({scaleLabel(parent.scale)})</label>
            <label className="check"><input type="radio" checked={!!v.ownScale} onChange={() => up({ ownScale: true })} /> Escala propia</label>
          </td></tr>
        )}
        {!follows && (
          <tr><td>{parent && kind !== 'detail' ? '' : 'Escala'}</td><td className="vprops-scale">
            <select value={custom ? 'c' : String(v.scale)} onChange={(e) => { if (e.target.value === 'c') setCustom(scaleLabel(v.scale)); else { setCustom(''); up({ scale: Number(e.target.value) }); } }}>
              {SCALES.map((x) => <option key={x} value={x}>{scaleLabel(x)}</option>)}
              <option value="c">Personalizada…</option>
            </select>
            {custom !== '' && <input className={customVal ? '' : 'bad'} value={custom} placeholder="1:7,5" onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') accept(); }} style={{ width: 80 }} />}
          </td></tr>
        )}
        {children.length > 0 && <tr><td /><td className="muted" style={{ fontSize: 11.5 }}>Las {children.length} vistas dependientes que usan la escala de esta vista también cambian.</td></tr>}
        {kind === 'detail' && v.detail && <>
          <tr><td>Radio de la zona</td><td><input type="number" min={2} value={v.detail.r} onChange={(e) => up({ detail: { ...v.detail!, r: Math.max(2, Number(e.target.value) || 2) } })} style={{ width: 70 }} /> mm (en la vista padre)</td></tr>
          <tr><td>Contorno del origen</td><td>
            <label className="check"><input type="radio" checked={!v.detail.solid} onChange={() => up({ detail: { ...v.detail!, solid: false } })} /> Círculo discontinuo</label>
            <label className="check"><input type="radio" checked={!!v.detail.solid} onChange={() => up({ detail: { ...v.detail!, solid: true } })} /> Círculo continuo</label>
          </td></tr>
        </>}
        <tr><td>Mostrar</td><td>
          <label className="check"><input type="checkbox" checked={v.hidden} onChange={(e) => up({ hidden: e.target.checked })} /> Aristas ocultas</label>
          <label className="check"><input type="checkbox" checked={!!v.centers} onChange={(e) => up({ centers: e.target.checked })} /> Marcas de centro automáticas</label>
        </td></tr>
      </tbody></table>
      {kind === 'section' && <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => { onClose(); useStore.setState({ selItem: v.id }); drwActions.flipSection(); }}>Invertir dirección de la sección</button>}
      <p className="muted" style={{ fontSize: 11.5 }}>Arrastrar: las proyectadas se mueven alineadas con su vista padre; secciones, detalles e isométricas, libres. <b>Ctrl + arrastrar</b> mueve en bloque la vista base con todas sus vistas.</p>
      <div className="modal-btns occp-foot">
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={accept}>Aceptar</button>
      </div>
    </Modal>
  );
}
