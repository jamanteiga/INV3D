// Herramientas › Barras flotantes: crear, ordenar y rellenar barras de herramientas personalizadas
import { useState } from 'react';
import { useStore } from '../core/store';
import { Modal } from './Panels';
import { Icon } from './icons';
import { COMMANDS, CTX_NAMES } from './commands';
import { useBars, barsApi, newBar, ribbonItems, collectRibbon, cmdItem, type BarItem } from './toolbars';

const KIND: Record<string, string> = { part: 'Pieza', assembly: 'Ensamblaje', drawing: 'Dibujo' };

export default function ToolbarsDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const { bars } = useBars();
  const [sel, setSel] = useState(bars[0]?.id ?? '');
  const [q, setQ] = useState('');
  const [src, setSrc] = useState<'ribbon' | 'cmd'>('ribbon');
  const [, force] = useState(0);
  const b = bars.find((x) => x.id === sel);
  const items: BarItem[] = src === 'ribbon'
    ? ribbonItems().map((r) => ({ key: r.key, label: r.label, icon: r.icon, kind: r.kind, tab: r.tab, tabLabel: r.tabLabel }))
    : COMMANDS.map((c) => cmdItem(c.id));
  const shown = items.filter((x) => !q || `${x.label} ${x.tabLabel ?? ''}`.toLowerCase().includes(q.toLowerCase())).sort((a, c) => (a.tabLabel ?? '').localeCompare(c.tabLabel ?? '') || a.label.localeCompare(c.label));
  const setItems = (v: BarItem[]) => b && barsApi.update(b.id, { items: v });
  const create = () => { const nb = newBar(`Barra ${bars.length + 1}`); barsApi.add(nb); setSel(nb.id); };
  return (
    <Modal title="Barras flotantes personalizadas" onClose={onClose} xwide>
      <div className="tb-ed">
        <div className="tb-col">
          <div className="plabel">Barras</div>
          <div className="tb-list">
            {bars.map((x) => (
              <div key={x.id} className={`tb-row ${x.id === sel ? 'sel' : ''}`} onClick={() => setSel(x.id)}>
                <input type="checkbox" checked={x.visible} title="Visible" onClick={(e) => e.stopPropagation()} onChange={(e) => barsApi.update(x.id, { visible: e.target.checked })} />
                <span>{x.name}</span><span className="muted">{x.items.length}</span>
              </div>))}
            {!bars.length && <p className="phelp">Aún no hay barras.</p>}
          </div>
          <div className="mp-btns"><button className="btn sm" onClick={create}>＋ Nueva</button>{b && <button className="btn sm" onClick={() => { barsApi.remove(b.id); setSel(bars.find((x) => x.id !== b.id)?.id ?? ''); }}>Eliminar</button>}</div>
          {b && (<>
            <div className="plabel">Propiedades</div>
            <input value={b.name} onChange={(e) => barsApi.update(b.id, { name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
            <label className="check"><input type="checkbox" checked={b.vertical} onChange={(e) => barsApi.update(b.id, { vertical: e.target.checked })} />Vertical</label>
            <label className="check"><input type="checkbox" checked={b.big} onChange={(e) => barsApi.update(b.id, { big: e.target.checked })} />Iconos grandes con texto</label>
            <button className="btn sm" onClick={() => barsApi.update(b.id, { x: 260, y: 170, visible: true })}>Recolocar en pantalla</button>
          </>)}
        </div>
        <div className="tb-col grow">
          <div className="plabel">Botones de «{b?.name ?? '—'}»</div>
          <div className="tb-list">
            {b?.items.map((it, i) => (
              <div key={it.key} className="tb-row">
                <Icon name={it.icon} size={18} /><span>{it.label}</span><span className="muted">{it.cmd ? 'Comando' : `${KIND[it.kind ?? ''] ?? ''} · ${it.tabLabel ?? ''}`}</span>
                <span className="grow" />
                <button className="btn sm" disabled={i === 0} onClick={() => { const c = [...b.items]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; setItems(c); }}>↑</button>
                <button className="btn sm" disabled={i === b.items.length - 1} onClick={() => { const c = [...b.items]; [c[i + 1], c[i]] = [c[i], c[i + 1]]; setItems(c); }}>↓</button>
                <button className="btn sm" onClick={() => setItems(b.items.filter((_, j) => j !== i))}>✕</button>
              </div>))}
            {b && !b.items.length && <p className="phelp">Añade botones de la lista de la derecha, o con clic derecho sobre cualquier botón de la cinta.</p>}
          </div>
        </div>
        <div className="tb-col grow">
          <div className="plabel">Disponibles</div>
          <div className="mp-modes">
            <button className={src === 'ribbon' ? 'on' : ''} onClick={() => setSrc('ribbon')}>Cinta ({KIND[s.kind]})</button>
            <button className={src === 'cmd' ? 'on' : ''} onClick={() => setSrc('cmd')}>Comandos</button>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input style={{ flex: 1 }} placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            {src === 'ribbon' && <button className="btn sm" title="Recorre todas las pestañas de la cinta para listar sus botones" onClick={() => void collectRibbon().then(() => force((n) => n + 1))}>Leer toda la cinta</button>}
          </div>
          <div className="tb-list">
            {shown.map((it) => {
              const c = it.cmd ? COMMANDS.find((x) => x.id === it.cmd) : null;
              return (
                <div key={it.key} className="tb-row" onDoubleClick={() => b && barsApi.addItem(b.id, it)}>
                  <Icon name={it.icon} size={18} /><span>{it.label}</span><span className="muted">{c ? CTX_NAMES[c.ctx] : it.tabLabel}</span><span className="grow" />
                  <button className="btn sm" disabled={!b || b.items.some((x) => x.key === it.key)} onClick={() => b && barsApi.addItem(b.id, it)}>＋</button>
                </div>);
            })}
            {!shown.length && <p className="phelp">Sin resultados{src === 'ribbon' ? ': pulsa «Leer toda la cinta»' : ''}.</p>}
          </div>
        </div>
      </div>
      <p className="phelp">Las barras se arrastran por el asa ⋮⋮ y se recuerdan. Los botones de otro entorno (pieza, ensamblaje, dibujo) se ven desactivados. Clic derecho en cualquier botón de la cinta › Añadir a barra.</p>
      <div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}
