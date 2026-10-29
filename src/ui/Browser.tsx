import { useState, type ReactNode } from 'react';
import { useStore } from '../core/store';
import { Icon } from './icons';
import { planeLabel, ENTITY_NAMES, type Feature, type StdPlane, type PartDoc } from '../core/doc';
import { profileLabel } from '../core/catalog';
import { scaleLabel } from '../core/drawing';
import { asmActions } from './actions';
import { JOINT_NAMES } from '../core/asm';

const ICON: Record<Feature['type'], string> = {
  sketch: 'sketch', extrude: 'extrude', revolve: 'revolve', fillet: 'fillet', chamfer: 'chamfer', import: 'import',
  hole: 'hole', pattern: 'prect', mirror: 'mirror', shell: 'shell', workplane: 'workplane', loft: 'loft', sweep: 'sweep',
  sm_face: 'smface', sm_flange: 'smflange', rib: 'rib', coil: 'coil', split: 'split', draft: 'draft', thicken: 'thicken',
  thread: 'thread', workaxis: 'axis', workpoint: 'point',
};

type Menu = { x: number; y: number; items: { label: string; danger?: boolean; run: () => void }[] } | null;

function ContextMenu({ menu, close }: { menu: Menu; close: () => void }) {
  if (!menu) return null;
  return (
    <div className="ctx" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
      {menu.items.map((it, i) => it.label === '-' ? <hr key={i} /> : (
        <button key={i} className={it.danger ? 'danger' : ''} onClick={() => { close(); it.run(); }}>{it.label}</button>
      ))}
    </div>
  );
}

function Folder({ icon, label, children, defaultOpen = true, depth = 0, count }: { icon: string; label: string; children: ReactNode; defaultOpen?: boolean; depth?: number; count?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  return (<>
    <div className="tree-row" style={{ paddingLeft: 10 + depth * 16 }} onClick={() => setOpen(!open)}>
      <span className={`caret ${open ? 'open' : ''}`}>▸</span><Icon name={icon} size={17} /><span className="tree-name">{label}</span>
      {count !== undefined && <span className="tree-count">{count}</span>}
    </div>
    {open && children}
  </>);
}

export default function Browser() {
  const kind = useStore((s) => s.kind);
  const [menu, setMenu] = useState<Menu>(null);
  return (
    <aside className="browser" onClick={() => setMenu(null)}>
      <div className="br-head"><span>Modelo</span></div>
      <div className="tree">
        {kind === 'part' && <PartTree setMenu={setMenu} />}
        {kind === 'assembly' && <AsmTree setMenu={setMenu} />}
        {kind === 'drawing' && <DrwTree setMenu={setMenu} />}
      </div>
      <ContextMenu menu={menu} close={() => setMenu(null)} />
    </aside>
  );
}

function PartTree({ setMenu }: { setMenu: (m: Menu) => void }) {
  const s = useStore();
  const [renaming, setRenaming] = useState<string | null>(null);
  const status = s.result?.status ?? {};
  const nestOwner = new Map<string, string>();
  for (const f of s.doc.features) {
    if (f.type === 'extrude' || f.type === 'revolve' || f.type === 'sm_face') nestOwner.set(f.profile, f.id);
    if (f.type === 'sweep') { nestOwner.set(f.profile, f.id); nestOwner.set(f.path, f.id); }
    if (f.type === 'loft') f.sections.forEach((x) => nestOwner.set(x, f.id));
    if (f.type === 'hole') nestOwner.set(f.sketch, f.id);
  }
  const edit = (f: Feature) => {
    if (f.type === 'sketch') s.editSketch(f.id);
    else if (f.type === 'import') s.notify('Un sólido importado no tiene parámetros editables');
    else s.openFeatureDialog(f.type as never, f.id);
  };
  const row = (f: Feature, depth = 0): ReactNode => {
    const st = status[f.id];
    const kids = s.doc.features.filter((x) => nestOwner.get(x.id) === f.id);
    return (
      <div key={f.id}>
        <div className={`tree-row ${s.selFeature === f.id ? 'sel' : ''} ${f.suppressed ? 'supp' : ''} ${s.sketchId === f.id ? 'active' : ''}`}
          style={{ paddingLeft: 10 + depth * 16 }}
          onClick={() => s.set({ selFeature: f.id })}
          onDoubleClick={() => edit(f)}
          onContextMenu={(e) => {
            e.preventDefault(); s.set({ selFeature: f.id });
            const user = f.type === 'sketch' ? s.doc.features.find((x) => nestOwner.get(f.id) === x.id) : null;
            setMenu({ x: e.clientX, y: e.clientY, items: [
              { label: f.type === 'sketch' ? 'Editar boceto' : 'Editar operación', run: () => edit(f) },
              ...(kids.length && f.type !== 'sketch' ? [{ label: 'Editar boceto', run: () => s.editSketch(kids[0].id) }] : []),
              { label: 'Cambiar nombre', run: () => setRenaming(f.id) },
              { label: f.suppressed ? 'Reanudar operación' : 'Suprimir operación', run: () => s.toggleSuppress(f.id) },
              { label: '-', run: () => {} },
              { label: 'Eliminar', danger: true, run: async () => { if (user && !(await s.ask(`${user.name} usa ${f.name}. ¿Eliminar el boceto igualmente?`, 'Eliminar'))) return; s.deleteFeature(f.id); } },
            ] });
          }}
          title={st && !st.ok ? st.error : f.type === 'sketch' ? planeLabel(f.plane, s.doc) : undefined}>
          <Icon name={f.type === 'pattern' && f.ptype === 'circ' ? 'pcirc' : ICON[f.type]} size={17} />
          {renaming === f.id ? (
            <input className="tree-rename" autoFocus defaultValue={f.name}
              onKeyDown={(e) => { if (e.key === 'Enter') { s.renameFeature(f.id, (e.target as HTMLInputElement).value); setRenaming(null); } if (e.key === 'Escape') setRenaming(null); e.stopPropagation(); }}
              onBlur={(e) => { s.renameFeature(f.id, e.target.value); setRenaming(null); }} />
          ) : <span className="tree-name">{f.name}</span>}
          {st && !st.ok && <span className="tree-err"><Icon name="error" size={14} /></span>}
        </div>
        {kids.map((k) => row(k, depth + 1))}
        {s.sketchId === f.id && f.type === 'sketch' && f.entities.map((e) => (
          <div key={e.id} className={`tree-row ent ${s.selEntity === e.id ? 'sel' : ''}`} style={{ paddingLeft: 28 + depth * 16 }} onClick={() => s.set({ selEntity: e.id })}>
            <span className="ent-dot" />{ENTITY_NAMES[e.type]}{(e.type === 'line' || e.type === 'arc') && e.construction ? ' (constr.)' : ''}
          </div>
        ))}
      </div>
    );
  };
  const pickPlane = (name: StdPlane) => { if (s.mode === 'sketch') s.finishSketch(); s.startSketch({ kind: 'std', name, offset: '0' }); };
  return (<>
    <div className="tree-row root"><Icon name={s.doc.sheet ? 'sheetmetal' : 'part'} size={17} /><span className="tree-name">{s.doc.iProperties.partNumber || s.fileName}</span></div>
    <Folder icon="origin" label="Origen" defaultOpen={false}>
      {(['YZ', 'XZ', 'XY'] as StdPlane[]).map((p) => (
        <div key={p} className="tree-row" style={{ paddingLeft: 30 }} title="Doble clic: nuevo boceto en este plano" onDoubleClick={() => pickPlane(p)}>
          <Icon name="plane" size={16} /><span className="tree-name">Plano {p}</span>
        </div>
      ))}
      {['X', 'Y', 'Z'].map((a) => <div key={a} className="tree-row" style={{ paddingLeft: 30 }}><Icon name="axis" size={16} /><span className="tree-name">Eje {a}</span></div>)}
      <div className="tree-row" style={{ paddingLeft: 30 }}><Icon name="point" size={16} /><span className="tree-name">Punto central</span></div>
    </Folder>
    {s.doc.sheet && <div className="tree-row" style={{ paddingLeft: 10 }} onDoubleClick={() => s.open({ kind: 'sheetstyle' })}><Icon name="style" size={16} /><span className="tree-name">Chapa: t = {s.doc.sheet.t}</span></div>}
    {s.doc.features.filter((x) => !nestOwner.has(x.id)).map((x) => row(x))}
    <div className="tree-row eop" style={{ paddingLeft: 10 }}><span className="eop-mark" />Fin de pieza</div>
  </>);
}

function AsmTree({ setMenu }: { setMenu: (m: Menu) => void }) {
  const s = useStore();
  const errs = s.asmResult?.errors ?? {};
  const sel = (id: string) => s.set({ selItem: id });
  const rowCls = (id: string, extra = '') => `tree-row ${s.selItem === id ? 'sel' : ''} ${extra}`;
  const del = (coll: 'occurrences' | 'joints' | 'frames' | 'welds' | 'bolts' | 'skeleton', id: string) => s.commitAsm((a) => {
    (a as any)[coll] = (a as any)[coll].filter((x: { id: string }) => x.id !== id);
    if (coll === 'occurrences') a.joints = a.joints.filter((j) => j.a.occ !== id && j.b.occ !== id);
    if (coll === 'frames') for (const f of a.frames) f.ends = f.ends.map((e) => (e.other === id ? { type: 'none' } : e)) as typeof f.ends;
    delete a.explode[id];
  });
  const Err = ({ id }: { id: string }) => (errs[id] ? <span className="tree-err" title={errs[id]}><Icon name="error" size={14} /></span> : null);
  return (<>
    <div className="tree-row root"><Icon name={s.asm.kind === 'weldment' ? 'weldment' : 'assembly'} size={17} /><span className="tree-name">{s.asm.iProperties.partNumber || s.fileName}</span></div>
    <Folder icon="joint" label="Relaciones" count={s.asm.joints.length} defaultOpen={false}>
      {s.asm.joints.map((j) => (
        <div key={j.id} className={rowCls(j.id, j.suppressed ? 'supp' : '')} style={{ paddingLeft: 30 }} onClick={() => sel(j.id)} title={errs[j.id]}
          onContextMenu={(e) => { e.preventDefault(); sel(j.id); setMenu({ x: e.clientX, y: e.clientY, items: [
            { label: j.suppressed ? 'Activar' : 'Suprimir', run: () => s.commitAsm((a) => { const t = a.joints.find((x) => x.id === j.id); if (t) t.suppressed = !t.suppressed; }) },
            { label: 'Eliminar', danger: true, run: () => del('joints', j.id) },
          ] }); }}>
          <Icon name="joint" size={15} /><span className="tree-name">{j.name} ({JOINT_NAMES[j.type]})</span><Err id={j.id} />
        </div>
      ))}
    </Folder>
    {s.asm.skeleton.length > 0 && (
      <Folder icon="skel" label="Esqueleto" count={s.asm.skeleton.length} defaultOpen={false}>
        {s.asm.skeleton.map((l, i) => (
          <div key={l.id} className={rowCls(l.id)} style={{ paddingLeft: 30 }} onClick={() => sel(l.id)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Eliminar', danger: true, run: () => del('skeleton', l.id) }] }); }}>
            <Icon name="axis" size={15} /><span className="tree-name">Línea {i + 1}</span>
          </div>
        ))}
      </Folder>
    )}
    {s.asm.occurrences.map((o) => {
      const e = s.docs.find((d) => d.id === o.part);
      const bad = s.asmResult?.parts[o.part]?.ok === false;
      return (
        <div key={o.id} className={rowCls(o.id, o.suppressed ? 'supp' : '')} style={{ paddingLeft: 10 }} onClick={() => sel(o.id)}
          onDoubleClick={() => s.activate(o.part)}
          onContextMenu={(ev) => { ev.preventDefault(); sel(o.id); setMenu({ x: ev.clientX, y: ev.clientY, items: [
            { label: 'Abrir', run: () => s.activate(o.part) },
            { label: o.grounded ? 'Liberar' : 'Fijar', run: () => s.commitAsm((a) => { const t = a.occurrences.find((x) => x.id === o.id)!; t.grounded = !t.grounded; }) },
            { label: o.hidden ? 'Mostrar' : 'Ocultar', run: () => s.commitAsm((a) => { const t = a.occurrences.find((x) => x.id === o.id)!; t.hidden = !t.hidden; }) },
            { label: o.suppressed ? 'Activar' : 'Suprimir', run: () => s.commitAsm((a) => { const t = a.occurrences.find((x) => x.id === o.id)!; t.suppressed = !t.suppressed; }) },
            { label: '-', run: () => {} },
            { label: 'Eliminar', danger: true, run: () => del('occurrences', o.id) },
          ] }); }}
          title={bad ? s.asmResult?.parts[o.part]?.error : e?.fileName}>
          <Icon name="part" size={17} /><span className="tree-name">{o.name}</span>
          {o.grounded && <span className="pin" title="Fijo"><Icon name="ground" size={13} /></span>}
          {!o.grounded && s.asmDof && s.asmDof[o.id] !== undefined && <span className={`gdl ${s.asmDof[o.id] === 0 ? 'zero' : ''}`} title="Grados de libertad">{s.asmDof[o.id]} GDL</span>}
          {bad && <span className="tree-err"><Icon name="error" size={14} /></span>}
        </div>
      );
    })}
    {s.asm.frames.length > 0 && (
      <Folder icon="frame" label="Estructura" count={s.asm.frames.length}>
        {s.asm.frames.map((m) => (
          <div key={m.id} className={rowCls(m.id, m.suppressed ? 'supp' : '')} style={{ paddingLeft: 30 }} onClick={() => sel(m.id)} title={errs[m.id]}
            onContextMenu={(e) => { e.preventDefault(); sel(m.id); setMenu({ x: e.clientX, y: e.clientY, items: [
              { label: 'Inglete con…', run: () => { asmActions.openEnd('miter'); s.updateDraft({ member: m.id }); } },
              { label: 'Recortar / alargar a…', run: () => { asmActions.openEnd('trim'); s.updateDraft({ member: m.id }); } },
              { label: 'Quitar tratamientos de extremo', run: () => s.commitAsm((a) => { const t = a.frames.find((x) => x.id === m.id)!; t.ends = [{ type: 'none' }, { type: 'none' }]; }) },
              { label: '-', run: () => {} },
              { label: 'Eliminar', danger: true, run: () => del('frames', m.id) },
            ] }); }}>
            <Icon name="frame" size={15} /><span className="tree-name">{m.name || profileLabel(m.family, m.size)}</span><Err id={m.id} />
          </div>
        ))}
      </Folder>
    )}
    {s.asm.welds.length > 0 && (
      <Folder icon="weld" label="Soldaduras" count={s.asm.welds.length} defaultOpen={false}>
        {s.asm.welds.map((w) => (
          <div key={w.id} className={rowCls(w.id)} style={{ paddingLeft: 30 }} onClick={() => sel(w.id)} title={errs[w.id]}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Eliminar', danger: true, run: () => del('welds', w.id) }] }); }}>
            <Icon name="weld" size={15} /><span className="tree-name">{w.name} · a{w.throat.replace(/\s*mm/, '')}</span><Err id={w.id} />
          </div>
        ))}
      </Folder>
    )}
    {s.asm.bolts.length > 0 && (
      <Folder icon="bolt" label="Tornillería" count={s.asm.bolts.length}>
        {s.asm.bolts.map((b) => (
          <div key={b.id} className={rowCls(b.id)} style={{ paddingLeft: 30 }} onClick={() => sel(b.id)} onDoubleClick={() => asmActions.openBolt(b.id)} title={errs[b.id]}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Editar', run: () => asmActions.openBolt(b.id) }, { label: 'Eliminar', danger: true, run: () => del('bolts', b.id) }] }); }}>
            <Icon name="bolt" size={15} /><span className="tree-name">{b.name} · {b.size}</span><Err id={b.id} />
          </div>
        ))}
      </Folder>
    )}
  </>);
}

function DrwTree({ setMenu }: { setMenu: (m: Menu) => void }) {
  const s = useStore();
  const name = (id: string) => s.docs.find((d) => d.id === id)?.fileName ?? 'origen no abierto';
  return (<>
    <div className="tree-row root"><Icon name="drawing" size={17} /><span className="tree-name">{s.fileName}</span></div>
    <Folder icon="sheetsize" label={`Hoja:1 (${s.drw.sheet})`}>
      {s.drw.views.map((v) => (
        <div key={v.id} className={`tree-row ${s.selItem === v.id ? 'sel' : ''}`} style={{ paddingLeft: 30 }} onClick={() => s.set({ selItem: v.id })}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Eliminar vista', danger: true, run: () => s.commitDrw((d) => {
            const gone = new Set([v.id, ...d.views.filter((x) => x.parent === v.id).map((x) => x.id)]);
            d.views = d.views.filter((x) => !gone.has(x.id)); d.dims = d.dims.filter((x) => !gone.has(x.view));
          }) }] }); }}>
          <Icon name={v.parent ? 'projview' : 'baseview'} size={15} /><span className="tree-name">{v.name} · {scaleLabel(v.scale)}</span>
          <span className="tree-count" title={name(v.source)}>{name(v.source).replace(/\.[^.]+$/, '')}</span>
        </div>
      ))}
      {s.drw.dims.length > 0 && <div className="tree-row" style={{ paddingLeft: 30 }}><Icon name="dim" size={15} /><span className="tree-name">Cotas</span><span className="tree-count">{s.drw.dims.length}</span></div>}
      {s.drw.notes.length > 0 && <div className="tree-row" style={{ paddingLeft: 30 }}><Icon name="note" size={15} /><span className="tree-name">Notas</span><span className="tree-count">{s.drw.notes.length}</span></div>}
    </Folder>
  </>);
}

export type { PartDoc };
