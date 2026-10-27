import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../core/store';
import { Icon } from './icons';
import { openFile, saveDoc, exportSTEP, exportSTL, importStep, newIpj } from '../core/files';
import { newDoc, demoDoc, MATERIALS } from '../core/doc';

type Tab = 'model' | 'sketch' | 'inspect' | 'tools' | 'view' | 'env';

function Big({ icon, label, onClick, active, disabled, title, kbd }: { icon: string; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; title?: string; kbd?: string }) {
  return (
    <button className={`rb-big ${active ? 'on' : ''}`} onClick={onClick} disabled={disabled} title={title ?? (kbd ? `${label} (${kbd})` : label)}>
      <Icon name={icon} size={30} />
      <span>{label}</span>
    </button>
  );
}
function Small({ icon, label, onClick, active, disabled, title }: { icon: string; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button className={`rb-small ${active ? 'on' : ''}`} onClick={onClick} disabled={disabled} title={title ?? label}>
      <Icon name={icon} size={18} /><span>{label}</span>
    </button>
  );
}
const Group = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="rb-group"><div className="rb-items">{children}</div><div className="rb-label">{label}</div></div>
);

export async function confirmDiscard() {
  const s = useStore.getState();
  return !s.dirty || s.ask('Hay cambios sin guardar en la pieza. ¿Descartarlos?', 'Descartar cambios');
}
const guarded = (fn: () => unknown) => async () => { if (await confirmDiscard()) fn(); };

export default function Ribbon() {
  const s = useStore();
  const [tab, setTab] = useState<Tab>('model');
  const inSketch = s.mode === 'sketch';
  useEffect(() => { setTab(inSketch ? 'sketch' : 'model'); }, [inSketch]);
  const hasSolid = !!s.result?.mesh;
  const tool = s.tool;
  const T = (t: typeof tool) => () => s.setTool(tool === t ? null : t);

  const tabs: [Tab, string][] = [
    ...(inSketch ? [['sketch', 'Boceto'] as [Tab, string]] : []),
    ['model', 'Modelo 3D'], ['inspect', 'Inspeccionar'], ['tools', 'Herramientas'], ['view', 'Vista'], ['env', 'Entornos'],
  ];

  return (
    <header className="ribbon">
      <div className="qat">
        <div className="brand" title="INV3D">
          <svg viewBox="0 0 32 32" width="22" height="22"><rect width="32" height="32" rx="6" fill="var(--accent)" /><path d="M16 6l9 5v10l-9 5-9-5V11z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" /><path d="M7 11l9 5 9-5M16 16v10" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" /></svg>
        </div>
        <button className="qat-b" title="Nuevo (Ctrl+N)" onClick={guarded(() => s.load(newDoc(), 'Pieza1.i3p'))}><Icon name="newfile" size={18} /></button>
        <button className="qat-b" title="Abrir (Ctrl+O)" onClick={guarded(() => openFile())}><Icon name="open" size={18} /></button>
        <button className="qat-b" title="Guardar (Ctrl+S)" onClick={saveDoc}><Icon name="save" size={18} /></button>
        <span className="qat-sep" />
        <button className="qat-b" title="Deshacer (Ctrl+Z)" disabled={!s.past.length} onClick={s.undo}><Icon name="undo" size={18} /></button>
        <button className="qat-b" title="Rehacer (Ctrl+Y)" disabled={!s.future.length} onClick={s.redo}><Icon name="redo" size={18} /></button>
        <span className="qat-sep" />
        <select className="qat-sel" value={s.doc.iProperties.material} title="Material"
          onChange={(e) => s.commit((d) => { d.iProperties.material = e.target.value; })}>
          {MATERIALS.map((m) => <option key={m.name}>{m.name}</option>)}
        </select>
        <div className="title">INV3D <span className="title-sep">·</span> {s.fileName}{s.dirty ? ' *' : ''}</div>
        <button className="qat-b" title="Atajos de teclado" onClick={() => s.open({ kind: 'shortcuts' })}><Icon name="help" size={18} /></button>
      </div>
      <nav className="tabs">
        <button className={`tab file ${s.menuOpen ? 'on' : ''}`} onClick={() => s.set({ menuOpen: !s.menuOpen })}>Archivo</button>
        {tabs.map(([k, l]) => (
          <button key={k} className={`tab ${tab === k ? 'on' : ''} ${k === 'sketch' ? 'ctx' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>
      <div className="panel-row">
        {tab === 'sketch' && inSketch && (<>
          <Group label="Crear">
            <Big icon="line" label="Línea" kbd="L" active={tool === 'line'} onClick={T('line')} />
            <Big icon="rect" label="Rectángulo" kbd="R" active={tool === 'rect'} onClick={T('rect')} />
            <Big icon="circle" label="Círculo" kbd="C" active={tool === 'circle'} onClick={T('circle')} />
            <Big icon="npoly" label="Polígono" kbd="P" active={tool === 'npoly'} onClick={T('npoly')} />
          </Group>
          <Group label="Restringir">
            <Big icon="dim" label="Cota" title="Doble clic sobre una cota del boceto para editarla. Admite expresiones y parámetros (p. ej. L/2)" onClick={() => s.notify('Doble clic sobre una cota para editarla; admite parámetros, p. ej. L/2')} />
          </Group>
          <Group label="Formato">
            <Small icon="axis" label="Construcción" disabled={!s.selEntity}
              title="Convierte la línea seleccionada en línea de construcción (eje)"
              onClick={() => {
                const sk = s.doc.features.find((f) => f.id === s.sketchId);
                const e = sk && sk.type === 'sketch' ? sk.entities.find((x) => x.id === s.selEntity) : null;
                if (e?.type === 'line') s.updateEntity(e.id, { construction: !e.construction } as never);
                else s.notify('Selecciona una línea', 'error');
              }} />
          </Group>
          <Group label="Insertar">
            <Big icon="params" label="Parámetros" onClick={() => s.open({ kind: 'params' })} />
          </Group>
          <Group label="Salir">
            <Big icon="finish" label="Terminar boceto" onClick={s.finishSketch} kbd="Esc" />
          </Group>
        </>)}
        {tab === 'model' && (<>
          <Group label="Boceto">
            <Big icon="sketch" label="Iniciar boceto 2D" kbd="S" active={tool === 'pickPlane'}
              onClick={() => { if (inSketch) s.finishSketch(); s.setTool(tool === 'pickPlane' ? null : 'pickPlane'); }} />
          </Group>
          <Group label="Crear">
            <Big icon="extrude" label="Extrusión" kbd="E" onClick={() => s.openFeatureDialog('extrude')} />
            <Big icon="revolve" label="Revolución" kbd="R" onClick={() => s.openFeatureDialog('revolve')} />
            <div className="rb-col">
              <Small icon="import" label="Importar STEP" onClick={() => importStep().catch((e) => s.notify(e.message, 'error'))} />
            </div>
          </Group>
          <Group label="Modificar">
            <Big icon="fillet" label="Empalme" kbd="F" disabled={!hasSolid} onClick={() => s.openFeatureDialog('fillet')} />
            <Big icon="chamfer" label="Chaflán" kbd="Ctrl+Mayús+K" disabled={!hasSolid} onClick={() => s.openFeatureDialog('chamfer')} />
          </Group>
          <Group label="Parámetros">
            <Big icon="params" label="Parámetros" onClick={() => s.open({ kind: 'params' })} />
          </Group>
        </>)}
        {tab === 'inspect' && (
          <Group label="Medir">
            <Big icon="mass" label="Propiedades físicas" onClick={() => s.open({ kind: 'iprops' })} />
          </Group>
        )}
        {tab === 'tools' && (<>
          <Group label="Opciones">
            <Big icon="params" label="Parámetros" onClick={() => s.open({ kind: 'params' })} />
            <Big icon="iprops" label="iProperties" onClick={() => s.open({ kind: 'iprops' })} />
            <Big icon="project" label="Proyectos" onClick={() => s.open({ kind: 'project' })} />
          </Group>
          <Group label="Ejemplo">
            <Big icon="part" label="Brida de ejemplo" onClick={guarded(() => s.load(demoDoc(), 'Brida-DN80.i3p'))} />
          </Group>
        </>)}
        {tab === 'view' && (<>
          <Group label="Navegar">
            <Big icon="home" label="Inicio" kbd="F6" onClick={() => s.setView('home')} />
            <Big icon="fit" label="Ajustar" kbd="Inicio" onClick={() => s.setView('fit')} />
          </Group>
          <Group label="Orientación">
            <Small icon="front" label="Frontal" onClick={() => s.setView('front')} />
            <Small icon="top" label="Superior" onClick={() => s.setView('top')} />
            <Small icon="right" label="Derecha" onClick={() => s.setView('right')} />
          </Group>
          <Group label="Aspecto">
            <Big icon="edges" label="Aristas" active={s.showEdges} onClick={() => s.set({ showEdges: !s.showEdges })} />
          </Group>
        </>)}
        {tab === 'env' && (<>
          <Group label="Entornos de pieza">
            <Big icon="sheet" label="Chapa" disabled title="Chapa — fase F4" />
          </Group>
          <Group label="Ensamblaje">
            <Big icon="assembly" label="Ensamblaje" disabled title="Ensamblaje (.i3a) — fase F2" />
            <Big icon="frame" label="Estructura" disabled title="Frame Generator — fase F3" />
            <Big icon="weld" label="Soldadura" disabled title="Weldment — fase F3" />
            <Big icon="bolt" label="Tornillería" disabled title="Conexión atornillada — fase F3" />
          </Group>
          <Group label="Documentación">
            <Big icon="drawing" label="Dibujo" disabled title="Planos (.i3d) — fase F1" />
            <Big icon="presentation" label="Presentación" disabled title="Explosionados (.i3n) — fase F4" />
          </Group>
          <div className="rb-note">Entornos previstos en el roadmap. Pasa el ratón para ver la fase.</div>
        </>)}
      </div>
      {s.menuOpen && <FileMenu />}
    </header>
  );
}

function FileMenu() {
  const s = useStore();
  const close = () => s.set({ menuOpen: false });
  const act = (fn: () => unknown) => () => { close(); Promise.resolve(fn()).catch((e) => s.notify((e as Error).message, 'error')); };
  return (
    <>
      <div className="menu-shade" onClick={close} />
      <div className="file-menu" role="menu">
        <button onClick={act(async () => { if (await confirmDiscard()) s.load(newDoc(), 'Pieza1.i3p'); })}><Icon name="newfile" size={22} />Nuevo<kbd>Ctrl+N</kbd></button>
        <button onClick={act(async () => { if (await confirmDiscard()) await openFile(); })}><Icon name="open" size={22} />Abrir…<kbd>Ctrl+O</kbd></button>
        <button onClick={act(saveDoc)}><Icon name="save" size={22} />Guardar<kbd>Ctrl+S</kbd></button>
        <hr />
        <button onClick={act(() => importStep())}><Icon name="import" size={22} />Importar STEP en la pieza</button>
        <button onClick={act(exportSTEP)}><Icon name="step" size={22} />Exportar STEP</button>
        <button onClick={act(exportSTL)}><Icon name="stl" size={22} />Exportar STL</button>
        <hr />
        <button onClick={act(() => s.open({ kind: 'project' }))}><Icon name="project" size={22} />Proyectos (.ipj)…</button>
        <button onClick={act(() => newIpj(s.doc.iProperties.partNumber || 'Proyecto'))}><Icon name="project" size={22} />Crear proyecto .ipj</button>
        <button onClick={act(() => s.open({ kind: 'iprops' }))}><Icon name="iprops" size={22} />iProperties</button>
        <hr />
        <button onClick={act(() => s.open({ kind: 'about' }))}><Icon name="help" size={22} />Acerca de INV3D</button>
        <div className="fm-foot">Abre .i3p, .step/.stp, .ipj · lee metadatos de .ipt, .iam, .idw, .ipn y .dwg</div>
      </div>
    </>
  );
}
