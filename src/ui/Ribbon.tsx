import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../core/store';
import { Icon } from './icons';
import { openFile, saveDoc, exportSTEP, exportSTL, importStep, newIpj } from '../core/files';
import { demoDoc, MATERIALS } from '../core/doc';
import { asmActions, drwActions, partActions } from './actions';
import { demoStair } from './demo';

type Tab = string;

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
const Col = ({ children }: { children: ReactNode }) => <div className="rb-col">{children}</div>;

export async function confirmDiscard() {
  const s = useStore.getState();
  return !s.dirty || s.ask('Hay cambios sin guardar en el documento. ¿Descartarlos?', 'Descartar cambios');
}

export default function Ribbon() {
  const s = useStore();
  const k = s.kind;
  const inSketch = s.mode === 'sketch';
  const isSheet = k === 'part' && !!s.doc.sheet;
  const tabsFor = (): [Tab, string][] => {
    if (k === 'part') return [
      ...(inSketch ? [['sketch', 'Boceto'] as [Tab, string]] : []),
      ...(isSheet ? [['sheet', 'Chapa'] as [Tab, string]] : []),
      ['model', 'Modelo 3D'], ['inspect', 'Inspeccionar'], ['tools', 'Herramientas'], ['view', 'Vista'],
    ];
    if (k === 'assembly') return [['asm', 'Ensamblar'], ['design', 'Diseño'], ['weld', 'Soldadura'], ['present', 'Presentación'], ['inspect', 'Inspeccionar'], ['tools', 'Herramientas'], ['view', 'Vista']];
    return [['place', 'Colocar vistas'], ['annotate', 'Anotar'], ['export', 'Exportar'], ['tools', 'Herramientas']];
  };
  const tabs = tabsFor();
  const [tab, setTab] = useState<Tab>(tabs[0][0]);
  useEffect(() => { setTab(tabsFor()[0][0]); }, [k, inSketch, isSheet, s.active]);
  const cur = tabs.some((t) => t[0] === tab) ? tab : tabs[0][0];
  const tool = s.tool;
  const T = (t: typeof tool) => () => s.setTool(tool === t ? null : t);
  const P = partActions, A = asmActions, D = drwActions;
  const hasSolid = !!s.result?.mesh;

  return (
    <header className="ribbon">
      <div className="qat">
        <div className="brand" title="INV3D">
          <svg viewBox="0 0 32 32" width="22" height="22"><rect width="32" height="32" rx="6" fill="var(--accent)" /><path d="M16 6l9 5v10l-9 5-9-5V11z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" /><path d="M7 11l9 5 9-5M16 16v10" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" /></svg>
        </div>
        <button className="qat-b" title="Nuevo (Ctrl+N)" onClick={() => s.open({ kind: 'newdoc' })}><Icon name="newfile" size={18} /></button>
        <button className="qat-b" title="Abrir (Ctrl+O)" onClick={() => openFile()}><Icon name="open" size={18} /></button>
        <button className="qat-b" title="Guardar (Ctrl+S)" onClick={saveDoc}><Icon name="save" size={18} /></button>
        <span className="qat-sep" />
        <button className="qat-b" title="Deshacer (Ctrl+Z)" disabled={!s.past.length} onClick={s.undo}><Icon name="undo" size={18} /></button>
        <button className="qat-b" title="Rehacer (Ctrl+Y)" disabled={!s.future.length} onClick={s.redo}><Icon name="redo" size={18} /></button>
        <span className="qat-sep" />
        {k === 'part' && (
          <select className="qat-sel" value={s.doc.iProperties.material} title="Material"
            onChange={(e) => s.commit((d) => { d.iProperties.material = e.target.value; })}>
            {MATERIALS.map((m) => <option key={m.name}>{m.name}</option>)}
          </select>
        )}
        <div className="title">INV3D <span className="title-sep">·</span> {s.fileName}{s.dirty ? ' *' : ''}</div>
        <button className="qat-b" title="Atajos de teclado" onClick={() => s.open({ kind: 'shortcuts' })}><Icon name="help" size={18} /></button>
      </div>
      <nav className="tabs">
        <button className={`tab file ${s.menuOpen ? 'on' : ''}`} onClick={() => s.set({ menuOpen: !s.menuOpen })}>Archivo</button>
        {tabs.map(([id, l]) => (
          <button key={id} className={`tab ${cur === id ? 'on' : ''} ${id === 'sketch' || id === 'present' ? 'ctxtab' : ''}`} onClick={() => setTab(id)}>{l}</button>
        ))}
      </nav>
      <div className="panel-row">
        {/* ---------- PIEZA ---------- */}
        {k === 'part' && cur === 'sketch' && inSketch && (<>
          <Group label="Crear">
            <Big icon="line" label="Línea" kbd="L" active={tool === 'line'} onClick={T('line')} />
            <Big icon="circle" label="Círculo" kbd="C" active={tool === 'circle'} onClick={T('circle')} />
            <Big icon="arc" label="Arco" kbd="A" active={tool === 'arc'} onClick={T('arc')} title="Arco por centro, inicio y fin (A)" />
            <Big icon="rect" label="Rectángulo" kbd="R" active={tool === 'rect'} onClick={T('rect')} />
            <Col>
              <Small icon="slot" label="Ranura" active={tool === 'slot'} onClick={T('slot')} title="Ranura: centro 1, centro 2 y anchura" />
              <Small icon="npoly" label="Polígono" active={tool === 'npoly'} onClick={T('npoly')} />
              <Small icon="pointtool" label="Punto" active={tool === 'point'} onClick={T('point')} title="Punto (centros de agujero)" />
            </Col>
          </Group>
          <Group label="Restringir">
            <Big icon="dim" label="Cota" title="Doble clic sobre una cota del boceto para editarla. Admite expresiones y parámetros (p. ej. L/2)" onClick={() => s.notify('Doble clic sobre una cota para editarla; admite parámetros, p. ej. L/2')} />
          </Group>
          <Group label="Formato">
            <Small icon="axis" label="Construcción" disabled={!s.selEntity} title="Línea o arco de construcción (ejes y trayectorias auxiliares)" onClick={P.toggleConstruction} />
          </Group>
          <Group label="Insertar"><Big icon="params" label="Parámetros" onClick={() => s.open({ kind: 'params' })} /></Group>
          <Group label="Salir"><Big icon="finish" label="Terminar boceto" onClick={s.finishSketch} kbd="Esc" /></Group>
        </>)}
        {k === 'part' && cur === 'sheet' && (<>
          <Group label="Boceto"><Big icon="sketch" label="Iniciar boceto 2D" kbd="S" active={tool === 'pickPlane'} onClick={P.startSketch} /></Group>
          <Group label="Configuración"><Big icon="style" label="Estilo de chapa" onClick={() => s.open({ kind: 'sheetstyle' })} title="Espesor, radio de plegado y factor K" /></Group>
          <Group label="Crear">
            <Big icon="smface" label="Cara" onClick={() => s.openFeatureDialog('sm_face')} />
            <Big icon="smflange" label="Pestaña" disabled={!hasSolid} onClick={() => s.openFeatureDialog('sm_flange')} />
          </Group>
          <Group label="Modificar">
            <Big icon="hole" label="Agujero" disabled={!hasSolid} onClick={() => s.openFeatureDialog('hole')} />
            <Big icon="extrude" label="Corte" disabled={!hasSolid} title="Extrusión de corte a través de la chapa" onClick={() => { s.openFeatureDialog('extrude'); s.updateDraft({ op: 'cut', dir: 'symmetric', distance: '50 mm' }); }} />
          </Group>
          <Group label="Desarrollo"><Big icon="flat" label="Desarrollo" disabled={!hasSolid} onClick={() => s.open({ kind: 'flat' })} title="Patrón desarrollado y DXF para corte" /></Group>
        </>)}
        {k === 'part' && cur === 'model' && (<>
          <Group label="Boceto"><Big icon="sketch" label="Iniciar boceto 2D" kbd="S" active={tool === 'pickPlane'} onClick={P.startSketch} /></Group>
          <Group label="Crear">
            <Big icon="extrude" label="Extrusión" kbd="E" onClick={() => s.openFeatureDialog('extrude')} />
            <Big icon="revolve" label="Revolución" kbd="R" onClick={() => s.openFeatureDialog('revolve')} />
            <Col>
              <Small icon="loft" label="Solevación" onClick={() => s.openFeatureDialog('loft')} />
              <Small icon="sweep" label="Barrido" onClick={() => s.openFeatureDialog('sweep')} />
              <Small icon="import" label="Importar" onClick={() => importStep().catch((e) => s.notify(e.message, 'error'))} title="Importar STEP en la pieza" />
            </Col>
          </Group>
          <Group label="Modificar">
            <Big icon="hole" label="Agujero" kbd="H" disabled={!hasSolid} onClick={() => s.openFeatureDialog('hole')} />
            <Big icon="fillet" label="Empalme" kbd="F" disabled={!hasSolid} onClick={() => s.openFeatureDialog('fillet')} />
            <Col>
              <Small icon="chamfer" label="Chaflán" disabled={!hasSolid} onClick={() => s.openFeatureDialog('chamfer')} />
              <Small icon="shell" label="Vaciado" disabled={!hasSolid} onClick={() => s.openFeatureDialog('shell')} />
            </Col>
          </Group>
          <Group label="Patrón">
            <Col>
              <Small icon="prect" label="Rectangular" disabled={!hasSolid} onClick={() => s.openFeatureDialog('pattern')} />
              <Small icon="pcirc" label="Circular" disabled={!hasSolid} onClick={() => { s.openFeatureDialog('pattern'); s.updateDraft({ ptype: 'circ' }); }} />
              <Small icon="mirror" label="Simetría" disabled={!hasSolid} onClick={() => s.openFeatureDialog('mirror')} />
            </Col>
          </Group>
          <Group label="Operaciones de trabajo"><Big icon="workplane" label="Plano" onClick={() => s.openFeatureDialog('workplane')} title="Plano de trabajo desfasado o girado" /></Group>
          <Group label="Parámetros"><Big icon="params" label="Parámetros" onClick={() => s.open({ kind: 'params' })} /></Group>
        </>)}
        {k === 'part' && cur === 'inspect' && (<Group label="Medir"><Big icon="mass" label="Propiedades físicas" onClick={() => s.open({ kind: 'iprops' })} /></Group>)}
        {/* ---------- ENSAMBLAJE ---------- */}
        {k === 'assembly' && cur === 'asm' && (<>
          <Group label="Componente">
            <Big icon="place" label="Colocar" kbd="P" onClick={() => s.open({ kind: 'place' })} />
            <Big icon="newpart" label="Crear" title="Crear una pieza nueva y colocarla" onClick={A.createPart} />
          </Group>
          <Group label="Posición">
            <Big icon="move" label="Mover" active={tool === 'move'} onClick={T('move')} title="Mover o girar el componente seleccionado con el gizmo" />
            <Col>
              <Small icon="ground" label="Fijar / liberar" disabled={!s.asm.occurrences.some((o) => o.id === s.selItem)} onClick={A.toggleGround} />
            </Col>
          </Group>
          <Group label="Relaciones">
            <Big icon="joint" label="Unir" kbd="J" onClick={() => A.openJoint()} title="Unión entre caras planas: coincidente, al ras o rígida" />
          </Group>
          <Group label="Esqueleto">
            <Big icon="skel" label="Línea 3D" onClick={() => A.openSkel()} title="Línea de esqueleto para la estructura" />
          </Group>
          <Group label="Gestión">
            <Big icon="bom" label="Lista de materiales" onClick={() => s.open({ kind: 'bom' })} />
          </Group>
        </>)}
        {k === 'assembly' && cur === 'design' && (<>
          <Group label="Estructura">
            <Big icon="frame" label="Insertar perfil" onClick={() => A.openFrame()} title="Frame Generator: perfiles EN sobre líneas de esqueleto" />
            <Col>
              <Small icon="miter" label="Inglete" onClick={() => A.openEnd('miter')} />
              <Small icon="trim" label="Recortar / alargar" onClick={() => A.openEnd('trim')} />
            </Col>
          </Group>
          <Group label="Uniones">
            <Big icon="bolt" label="Conexión atornillada" onClick={() => A.openBolt()} title="Design Accelerator: tornillería ISO con cálculo EN 1993-1-8" />
          </Group>
        </>)}
        {k === 'assembly' && cur === 'weld' && (<>
          <Group label="Soldadura">
            <Big icon="weld" label="Cordón en ángulo" onClick={() => A.openWeld()} title="Cordón entre dos caras que forman rincón (ISO 2553)" />
          </Group>
          <Group label="Informes">
            <Big icon="bom" label="Lista de soldaduras" onClick={() => s.open({ kind: 'bom' })} />
          </Group>
        </>)}
        {k === 'assembly' && cur === 'present' && (<>
          <Group label="Escena">
            <Big icon="explode" label="Explosionar" onClick={A.autoExplode} title="Desplazamientos automáticos desde el centro" />
            <Big icon="play" label={s.mode === 'present' ? 'Salir' : 'Presentación'} active={s.mode === 'present'} onClick={() => s.set({ mode: s.mode === 'present' ? 'model' : 'present', explodeT: s.mode === 'present' ? 0 : 1 })} />
          </Group>
          <Group label="Animación">
            <Big icon="play" label="Animar" onClick={A.animate} />
            <Big icon="record" label="Grabar vídeo" onClick={A.record} title="Graba la animación del explosionado (WebM)" />
          </Group>
        </>)}
        {k === 'assembly' && cur === 'inspect' && (<>
          <Group label="Medir"><Big icon="mass" label="Propiedades" onClick={() => s.open({ kind: 'bom' })} /></Group>
        </>)}
        {/* ---------- PLANO ---------- */}
        {k === 'drawing' && cur === 'place' && (<>
          <Group label="Crear">
            <Big icon="baseview" label="Vista base" onClick={() => s.open({ kind: 'drwview' })} />
            <Col>
              <Small icon="projview" label="Proyectada derecha" disabled={!D.selView()} onClick={() => D.project('right')} />
              <Small icon="projview" label="Proyectada abajo" disabled={!D.selView()} onClick={() => D.project('down')} />
              <Small icon="iso" label="Isométrica" disabled={!D.selView()} onClick={() => D.project('iso')} />
            </Col>
          </Group>
          <Group label="Hoja">
            <Col>
              {(['A4', 'A3', 'A2', 'A1'] as const).map((z) => <Small key={z} icon="sheetsize" label={`Formato ${z}`} active={s.drw.sheet === z} onClick={() => s.commitDrw((d) => { d.sheet = z; })} />)}
            </Col>
          </Group>
        </>)}
        {k === 'drawing' && cur === 'annotate' && (<>
          <Group label="Cota"><Big icon="dim" label="Cota" kbd="D" active={tool === 'drwDim'} onClick={T('drwDim')} /></Group>
          <Group label="Texto"><Big icon="note" label="Nota" active={tool === 'drwNote'} onClick={T('drwNote')} /></Group>
          <Group label="Tabla"><Big icon="bom" label="Lista de piezas" active={!!s.drw.bom} onClick={D.toggleBom} title="Lista de piezas del ensamblaje sobre el cajetín" /></Group>
        </>)}
        {k === 'drawing' && cur === 'export' && (<>
          <Group label="Exportar">
            <Big icon="dxf" label="DXF" onClick={D.exportDxf} />
            <Big icon="pdf" label="PDF" onClick={D.exportPdf} />
            <Big icon="svgfile" label="SVG" onClick={D.exportSvg} />
          </Group>
        </>)}
        {/* ---------- COMUNES ---------- */}
        {cur === 'tools' && (<>
          <Group label="Opciones">
            {k === 'part' && <Big icon="params" label="Parámetros" onClick={() => s.open({ kind: 'params' })} />}
            <Big icon="iprops" label="iProperties" onClick={() => s.open({ kind: 'iprops' })} />
            <Big icon="project" label="Proyectos" onClick={() => s.open({ kind: 'project' })} />
          </Group>
          <Group label="Inventor">
            <Big icon="ilogic" label="Regla de exportación" onClick={() => s.open({ kind: 'ilogic' })} title="Regla iLogic para exportar un proyecto de Inventor a STEP y DWG" />
          </Group>
          <Group label="Ejemplos">
            <Big icon="part" label="Brida" onClick={() => s.addDocument('part', demoDoc(), 'Brida-DN80.i3p')} />
            <Big icon="frame" label="Escalera" onClick={demoStair} title="Estructura de escalera con perfiles, ingletes y soldaduras" />
          </Group>
        </>)}
        {cur === 'view' && (<>
          <Group label="Navegar">
            <Big icon="home" label="Inicio" kbd="F6" onClick={() => s.setView('home')} />
            <Big icon="fit" label="Ajustar" kbd="Inicio" onClick={() => s.setView('fit')} />
          </Group>
          <Group label="Orientación">
            <Col>
              <Small icon="front" label="Frontal" onClick={() => s.setView('front')} />
              <Small icon="top" label="Superior" onClick={() => s.setView('top')} />
              <Small icon="right" label="Derecha" onClick={() => s.setView('right')} />
            </Col>
          </Group>
          <Group label="Aspecto"><Big icon="edges" label="Aristas" active={s.showEdges} onClick={() => s.set({ showEdges: !s.showEdges })} /></Group>
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
        <button onClick={act(() => s.open({ kind: 'newdoc' }))}><Icon name="newfile" size={22} />Nuevo…<kbd>Ctrl+N</kbd></button>
        <button onClick={act(() => openFile())}><Icon name="open" size={22} />Abrir…<kbd>Ctrl+O</kbd></button>
        <button onClick={act(saveDoc)}><Icon name="save" size={22} />Guardar<kbd>Ctrl+S</kbd></button>
        <hr />
        {s.kind === 'part' && <button onClick={act(() => importStep())}><Icon name="import" size={22} />Importar STEP en la pieza</button>}
        {s.kind !== 'drawing' && <button onClick={act(exportSTEP)}><Icon name="step" size={22} />Exportar STEP</button>}
        {s.kind !== 'drawing' && <button onClick={act(exportSTL)}><Icon name="stl" size={22} />Exportar STL</button>}
        {s.kind === 'drawing' && <button onClick={act(drwActions.exportDxf)}><Icon name="dxf" size={22} />Exportar DXF</button>}
        {s.kind === 'drawing' && <button onClick={act(drwActions.exportPdf)}><Icon name="pdf" size={22} />Exportar PDF</button>}
        <hr />
        <button onClick={act(() => s.open({ kind: 'project' }))}><Icon name="project" size={22} />Proyectos (.ipj)…</button>
        <button onClick={act(() => newIpj(s.docData(s.active) && 'iProperties' in (s.docData(s.active) as object) ? (s.docData(s.active) as any).iProperties.partNumber : 'Proyecto'))}><Icon name="project" size={22} />Crear proyecto .ipj</button>
        <button onClick={act(() => s.open({ kind: 'iprops' }))}><Icon name="iprops" size={22} />iProperties</button>
        <hr />
        <button onClick={act(() => s.open({ kind: 'about' }))}><Icon name="help" size={22} />Acerca de INV3D</button>
        <div className="fm-foot">Abre .i3p, .i3a, .i3d, .step/.stp, .ipj, .dwg, .dxf · lee metadatos y miniatura de .ipt, .iam, .idw, .ipn</div>
      </div>
    </>
  );
}

