import { useState } from 'react';
import { useStore } from '../core/store';
import { Icon } from './icons';
import { planeLabel, ENTITY_NAMES, type Feature, type StdPlane } from '../core/doc';

const ICON: Record<Feature['type'], string> = { sketch: 'sketch', extrude: 'extrude', revolve: 'revolve', fillet: 'fillet', chamfer: 'chamfer', import: 'import' };

export default function Browser() {
  const s = useStore();
  const [originOpen, setOriginOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const status = s.result?.status ?? {};
  const consumedBy = (id: string) => s.doc.features.find((f) => (f.type === 'extrude' || f.type === 'revolve') && f.profile === id);
  // Bocetos consumidos se anidan bajo su operación, como en Inventor
  const nested = new Set(s.doc.features.filter((f) => f.type === 'extrude' || f.type === 'revolve').map((f) => (f as { profile: string }).profile));

  const edit = (f: Feature) => {
    if (f.type === 'sketch') s.editSketch(f.id);
    else if (f.type === 'import') s.notify('Un sólido importado no tiene parámetros editables');
    else s.openFeatureDialog(f.type, f.id);
  };

  const row = (f: Feature, depth = 0) => {
    const st = status[f.id];
    const sel = s.selFeature === f.id;
    const kids = (f.type === 'extrude' || f.type === 'revolve') ? s.doc.features.filter((x) => x.id === f.profile) : [];
    return (
      <div key={f.id}>
        <div className={`tree-row ${sel ? 'sel' : ''} ${f.suppressed ? 'supp' : ''} ${s.sketchId === f.id ? 'active' : ''}`}
          style={{ paddingLeft: 10 + depth * 16 }}
          onClick={() => s.set({ selFeature: f.id })}
          onDoubleClick={() => edit(f)}
          onContextMenu={(e) => { e.preventDefault(); s.set({ selFeature: f.id }); setMenu({ x: e.clientX, y: e.clientY, id: f.id }); }}
          title={st && !st.ok ? st.error : f.type === 'sketch' ? planeLabel(f.plane) : undefined}>
          <Icon name={ICON[f.type]} size={17} />
          {renaming === f.id ? (
            <input className="tree-rename" autoFocus defaultValue={f.name}
              onKeyDown={(e) => { if (e.key === 'Enter') { s.renameFeature(f.id, (e.target as HTMLInputElement).value); setRenaming(null); } if (e.key === 'Escape') setRenaming(null); e.stopPropagation(); }}
              onBlur={(e) => { s.renameFeature(f.id, e.target.value); setRenaming(null); }} />
          ) : <span className="tree-name">{f.name}</span>}
          {st && !st.ok && <span className="tree-err"><Icon name="error" size={14} /></span>}
        </div>
        {kids.map((k) => row(k, depth + 1))}
        {s.sketchId === f.id && f.type === 'sketch' && f.entities.map((e) => (
          <div key={e.id} className={`tree-row ent ${s.selEntity === e.id ? 'sel' : ''}`} style={{ paddingLeft: 28 + depth * 16 }}
            onClick={() => s.set({ selEntity: e.id })}>
            <span className="ent-dot" />{ENTITY_NAMES[e.type]}{e.type === 'line' && e.construction ? ' (constr.)' : ''}
          </div>
        ))}
      </div>
    );
  };

  const f = menu ? s.doc.features.find((x) => x.id === menu.id) : null;
  const pickPlane = (name: StdPlane) => { if (s.mode === 'sketch') s.finishSketch(); s.startSketch({ kind: 'std', name, offset: '0' }); };

  return (
    <aside className="browser" onClick={() => setMenu(null)}>
      <div className="br-head"><span>Modelo</span></div>
      <div className="tree">
        <div className="tree-row root"><Icon name="part" size={17} /><span className="tree-name">{s.doc.iProperties.partNumber || s.fileName}</span></div>
        <div className="tree-row" style={{ paddingLeft: 10 }} onClick={() => setOriginOpen(!originOpen)}>
          <span className={`caret ${originOpen ? 'open' : ''}`}>▸</span><Icon name="origin" size={17} /><span className="tree-name">Origen</span>
        </div>
        {originOpen && (<>
          {(['YZ', 'XZ', 'XY'] as StdPlane[]).map((p) => (
            <div key={p} className="tree-row" style={{ paddingLeft: 30 }} title="Doble clic: nuevo boceto en este plano" onDoubleClick={() => pickPlane(p)}>
              <Icon name="plane" size={16} /><span className="tree-name">Plano {p}</span>
            </div>
          ))}
          {['X', 'Y', 'Z'].map((a) => <div key={a} className="tree-row" style={{ paddingLeft: 30 }}><Icon name="axis" size={16} /><span className="tree-name">Eje {a}</span></div>)}
          <div className="tree-row" style={{ paddingLeft: 30 }}><Icon name="point" size={16} /><span className="tree-name">Punto central</span></div>
        </>)}
        {s.doc.features.filter((x) => !(x.type === 'sketch' && nested.has(x.id))).map((x) => row(x))}
        <div className="tree-row eop" style={{ paddingLeft: 10 }}><span className="eop-mark" />Fin de pieza</div>
      </div>
      {menu && f && (
        <div className="ctx" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { setMenu(null); edit(f); }}>{f.type === 'sketch' ? 'Editar boceto' : 'Editar operación'}</button>
          {(f.type === 'extrude' || f.type === 'revolve') && <button onClick={() => { setMenu(null); s.editSketch(f.profile); }}>Editar boceto</button>}
          <button onClick={() => { setMenu(null); setRenaming(f.id); }}>Cambiar nombre</button>
          <button onClick={() => { setMenu(null); s.toggleSuppress(f.id); }}>{f.suppressed ? 'Reanudar operación' : 'Suprimir operación'}</button>
          <hr />
          <button className="danger" onClick={async () => {
            setMenu(null);
            const user = f.type === 'sketch' ? consumedBy(f.id) : null;
            if (user && !(await s.ask(`${user.name} usa ${f.name}. ¿Eliminar el boceto igualmente?`, 'Eliminar'))) return;
            s.deleteFeature(f.id);
          }}>Eliminar</button>
        </div>
      )}
    </aside>
  );
}
