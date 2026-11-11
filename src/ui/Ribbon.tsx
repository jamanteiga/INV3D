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
      <Icon name={icon} size={32} />
      <span>{label}</span>
    </button>
  );
}
function Small({ icon, label, onClick, active, disabled, title }: { icon: string; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button className={`rb-small ${active ? 'on' : ''}`} onClick={onClick} disabled={disabled} title={title ?? label}>
      <Icon name={icon} size={16} /><span>{label}</span>
    </button>
  );
}
/** Botón grande con desplegable de variantes (como los de Inventor: Arco ▾, Rectángulo ▾…). Recuerda la última usada. */
function SplitBig({ items, activeKey, onPick }: { items: { key: string; icon: string; label: string; title?: string }[]; activeKey?: string | null; onPick: (k: string) => void }) {
  const [open, setOpen] = useState<null | { x: number; y: number }>(null);
  const [last, setLast] = useState(items[0].key);
  const cur = items.find((i) => i.key === activeKey) ?? items.find((i) => i.key === last) ?? items[0];
  return (
    <div className="rb-split">
      <button className={`rb-big ${items.some((i) => i.key === activeKey) ? 'on' : ''}`} onClick={() => { setLast(cur.key); onPick(cur.key); }} title={cur.title ?? cur.label}>
        <Icon name={cur.icon} size={32} /><span>{cur.label}</span>
      </button>
      <button className="rb-drop" onClick={(e) => { const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect(); setOpen(open ? null : { x: r.left, y: r.bottom }); }} aria-label="Más opciones">▾</button>
      {open && (<>
        <div className="menu-shade clear" onClick={() => setOpen(null)} />
        <div className="rb-menu" style={{ position: 'fixed', left: open.x, top: open.y }}>{items.map((i) => (
          <button key={i.key} className={i.key === activeKey ? 'on' : ''} onClick={() => { setOpen(null); setLast(i.key); onPick(i.key); }}><Icon name={i.icon} size={20} />{i.label}</button>
        ))}</div>
      </>)}
    </div>
  );
}
/** Botón solo icono (rejilla de restricciones). */
function IconBtn({ icon, title, onClick, active, disabled }: { icon: string; title: string; onClick?: () => void; active?: boolean; disabled?: boolean }) {
  return <button className={`rb-ico ${active ? 'on' : ''}`} title={title} onClick={onClick} disabled={disabled}><Icon name={icon} size={20} /></button>;
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
        <button className="qat-b" title="Nuevo (Ctrl+N)" onClick={() => s.open({ kind: 'newdoc' })}><Icon name="newfile" size={16} /></button>
        <button className="qat-b" title="Abrir (Ctrl+O)" onClick={() => openFile()}><Icon name="open" size={16} /></button>
        <button className="qat-b" title="Guardar (Ctrl+S)" onClick={saveDoc}><Icon name="save" size={16} /></button>
        <span className="qat-sep" />
        <button className="qat-b" title="Deshacer (Ctrl+Z)" disabled={!s.past.length} onClick={s.undo}><Icon name="undo" size={16} /></button>
        <button className="qat-b" title="Rehacer (Ctrl+Y)" disabled={!s.future.length} onClick={s.redo}><Icon name="redo" size={16} /></button>
        <span className="qat-sep" />
        {k === 'part' && (
          <select className="qat-sel" value={s.doc.iProperties.material} title="Material"
            onChange={(e) => s.commit((d) => { d.iProperties.material = e.target.value; })}>
            {MATERIALS.map((m) => <option key={m.name}>{m.name}</option>)}
          </select>
        )}
        <div className="title">INV3D <span className="title-sep">·</span> {s.fileName}{s.dirty ? ' *' : ''}</div>
        <button className="qat-b" title="Atajos de teclado" onClick={() => s.open({ kind: 'shortcuts' })}><Icon name="help" size={16} /></button>
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
            <SplitBig activeKey={tool} onPick={(t) => s.setTool(t as never)} items={[
              { key: 'circle', icon: 'circle', label: 'Círculo', title: 'Círculo por centro (C)' }, { key: 'circle3', icon: 'circle3', label: 'Círculo 3 puntos' }]} />
            <SplitBig activeKey={tool} onPick={(t) => s.setTool(t as never)} items={[
              { key: 'arc3', icon: 'arc3', label: 'Arco 3 puntos', title: 'Arco: inicio, fin y punto intermedio (A)' }, { key: 'arc', icon: 'arc', label: 'Arco centro' }, { key: 'arctan', icon: 'arctan', label: 'Arco tangente' }]} />
            <SplitBig activeKey={tool} onPick={(t) => s.setTool(t as never)} items={[
              { key: 'rect', icon: 'rect', label: 'Rectángulo', title: 'Rectángulo de dos puntos (R)' }, { key: 'rect3', icon: 'rect3', label: 'Rect. 3 puntos' }, { key: 'rectc', icon: 'rectc', label: 'Rect. por centro' }]} />
            <Col>
              <Small icon="fillet2d" label="Empalme" active={tool === 'fillet2d'} onClick={T('fillet2d')} title="Empalme 2D entre dos líneas" />
              <Small icon="chamfer2d" label="Chaflán" active={tool === 'chamfer2d'} onClick={T('chamfer2d')} />
              <Small icon="text" label="Texto" active={tool === 'text'} onClick={T('text')} />
            </Col>
            <Col>
              <Small icon="splinetool" label="Spline" active={tool === 'spline'} onClick={T('spline')} title="Spline de interpolación" />
              <Small icon="ellipsetool" label="Elipse" active={tool === 'ellipse'} onClick={T('ellipse')} />
              <Small icon="npoly" label="Polígono" active={tool === 'npoly'} onClick={T('npoly')} />
            </Col>
            <Col>
              <Small icon="slot" label="Ranura" active={tool === 'slot'} onClick={T('slot')} title="Ranura: centro 1, centro 2 y anchura" />
              <Small icon="pointtool" label="Punto" active={tool === 'point'} onClick={T('point')} title="Punto (centros de agujero)" />
              <Small icon="projectgeom" label="Proyectar geometría" active={tool === 'projectGeom'} onClick={T('projectGeom')} disabled={!hasSolid} />
            </Col>
          </Group>
          <Group label="Modificar">
            <Col>
              <Small icon="move" label="Mover" onClick={() => P.skop('move')} />
              <Small icon="copy2d" label="Copiar" onClick={() => P.skop('copy')} />
              <Small icon="rotate2d" label="Girar" onClick={() => P.skop('rotate')} />
            </Col>
            <Col>
              <Small icon="trimtool" label="Recortar" active={tool === 'trim'} onClick={T('trim')} title="Recortar (X)" />
              <Small icon="extendtool" label="Alargar" active={tool === 'extend'} onClick={T('extend')} />
              <Small icon="offset2d" label="Desfase" onClick={() => P.skop('offset')} />
            </Col>
            <Col>
              <Small icon="scale2d" label="Escala" onClick={() => P.skop('scale')} />
            </Col>
          </Group>
          <Group label="Patrón">
            <Col>
              <Small icon="prect" label="Rectangular" onClick={() => P.skop('rpattern')} />
              <Small icon="pcirc" label="Circular" onClick={() => P.skop('cpattern')} />
              <Small icon="mirror" label="Simetría" onClick={() => P.skop('mirror')} />
            </Col>
          </Group>
          <Group label="Restringir">
            <Big icon="dim" label="Cota" kbd="D" active={tool === 'skdim'} onClick={T('skdim')} title="Cota general: longitud, distancia, radio, diámetro o ángulo según la geometría elegida (D)" />
            <div className="rb-grid">
              {([['coincident', 'c_coincident', 'Coincidente'], ['collinear', 'c_collinear', 'Colineal'], ['concentric', 'c_concentric', 'Concéntrica'], ['fix', 'c_fix', 'Fija'],
                ['parallel', 'c_parallel', 'Paralela'], ['perpendicular', 'c_perpendicular', 'Perpendicular'], ['horizontal', 'c_horizontal', 'Horizontal'], ['vertical', 'c_vertical', 'Vertical'],
                ['tangent', 'c_tangent', 'Tangente'], ['midpoint', 'c_midpoint', 'Punto medio'], ['symmetric', 'c_symmetric', 'Simétrica'], ['equal', 'c_equal', 'Igual']] as const).map(([c, ic, l]) => (
                <IconBtn key={c} icon={ic} title={`Restricción ${l}`} active={tool === 'constrain' && s.conType === c} onClick={() => { if (tool === 'constrain' && s.conType === c) s.setTool(null); else { s.set({ conType: c }); s.setTool('constrain'); } }} />
              ))}
            </div>
            <Col>
              <Small icon="showcons" label="Mostrar restricciones" active={s.showCons} onClick={() => s.set({ showCons: !s.showCons })} title="Mostrar u ocultar los símbolos de restricción (F8)" />
              <Small icon="axis" label="Construcción" disabled={!s.selEntity} onClick={P.toggleConstruction} title="Geometría de construcción (no forma perfiles)" />
            </Col>
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
              <Small icon="rib" label="Nervio" onClick={() => s.openFeatureDialog('rib')} />
            </Col>
            <Col>
              <Small icon="coil" label="Bobina" onClick={() => s.openFeatureDialog('coil')} title="Muelle o rosca modelada: perfil girado en hélice" />
              <Small icon="emboss" label="Relieve" onClick={P.emboss} title="Grabar o dar relieve a un texto o perfil" />
              <Small icon="import" label="Importar" onClick={() => importStep().catch((e) => s.notify(e.message, 'error'))} title="Importar STEP en la pieza" />
            </Col>
          </Group>
          <Group label="Modificar">
            <Big icon="hole" label="Agujero" kbd="H" disabled={!hasSolid} onClick={() => s.openFeatureDialog('hole')} />
            <Big icon="fillet" label="Empalme" kbd="F" disabled={!hasSolid} onClick={() => s.openFeatureDialog('fillet')} />
            <Col>
              <Small icon="chamfer" label="Chaflán" disabled={!hasSolid} onClick={() => s.openFeatureDialog('chamfer')} />
              <Small icon="shell" label="Vaciado" disabled={!hasSolid} onClick={() => s.openFeatureDialog('shell')} />
              <Small icon="draft" label="Inclinación" disabled={!hasSolid} onClick={() => s.openFeatureDialog('draft')} title="Ángulo de desmoldeo en caras" />
            </Col>
            <Col>
              <Small icon="thread" label="Rosca" disabled={!hasSolid} onClick={() => s.openFeatureDialog('thread')} title="Rosca cosmética en cara cilíndrica" />
              <Small icon="split" label="Dividir" disabled={!hasSolid} onClick={() => s.openFeatureDialog('split')} title="Divide el sólido por un plano y conserva un lado" />
              <Small icon="thicken" label="Engrosar" disabled={!hasSolid} onClick={() => s.openFeatureDialog('thicken')} />
            </Col>
          </Group>
          <Group label="Operaciones de trabajo">
            <Big icon="workplane" label="Plano" onClick={() => s.openFeatureDialog('workplane')} title="Plano de trabajo desfasado o girado" />
            <Col>
              <Small icon="workaxis" label="Eje" onClick={() => s.openFeatureDialog('workaxis')} />
              <Small icon="workpoint" label="Punto" onClick={() => s.openFeatureDialog('workpoint')} />
            </Col>
          </Group>
          <Group label="Patrón">
            <Col>
              <Small icon="prect" label="Rectangular" disabled={!hasSolid} onClick={() => s.openFeatureDialog('pattern')} />
              <Small icon="pcirc" label="Circular" disabled={!hasSolid} onClick={() => { s.openFeatureDialog('pattern'); s.updateDraft({ ptype: 'circ' }); }} />
              <Small icon="mirror" label="Simetría" disabled={!hasSolid} onClick={() => s.openFeatureDialog('mirror')} />
            </Col>
          </Group>
          <Group label="Parámetros"><Big icon="params" label="Parámetros" onClick={() => s.open({ kind: 'params' })} /></Group>
        </>)}
        {k === 'part' && cur === 'inspect' && (<>
          <Group label="Medir">
            <Big icon="measure" label="Medir" active={tool === 'measure'} onClick={T('measure')} title="Distancia entre puntos, longitud de aristas, radios" />
            <Big icon="mass" label="Propiedades físicas" onClick={() => s.open({ kind: 'iprops' })} />
          </Group>
        </>)}
        {/* ---------- ENSAMBLAJE ---------- */}
        {k === 'assembly' && cur === 'asm' && (<>
          <Group label="Componente">
            <SplitBig onPick={(t) => s.open({ kind: t as 'place' | 'content' })} items={[
              { key: 'place', icon: 'place', label: 'Colocar', title: 'Colocar pieza (P)' }, { key: 'content', icon: 'content', label: 'Centro de contenido', title: 'Tornillería, pasadores, rodamientos y chavetas normalizados' }]} />
            <Big icon="newpart" label="Crear" title="Crear una pieza nueva y colocarla" onClick={A.createPart} />
            <Col>
              <Small icon="pattern_comp" label="Patrón" disabled={!s.asm.occurrences.some((o) => o.id === s.selItem)} onClick={() => s.open({ kind: 'cpattern' })} title="Patrón rectangular o circular del componente seleccionado" />
              <Small icon="content" label="Centro de contenido" onClick={() => s.open({ kind: 'content' })} />
            </Col>
          </Group>
          <Group label="Posición">
            <Big icon="move" label="Mover" active={tool === 'move'} onClick={T('move')} title="Mover o girar el componente seleccionado con el gizmo (respeta las restricciones)" />
            <Col>
              <Small icon="ground" label="Fijar / liberar" disabled={!s.asm.occurrences.some((o) => o.id === s.selItem)} onClick={A.toggleGround} />
            </Col>
          </Group>
          <Group label="Relaciones">
            <Big icon="constraint3d" label="Restringir" kbd="J" onClick={() => A.openJoint()} title="Coincidir, al ras, ángulo, tangente, insertar o rígida (J)" />
            <Col>
              <Small icon="insert3d" label="Insertar" onClick={() => { A.openJoint(); s.updateDraft({ type: 'insert' }); }} />
              <Small icon="angle3d" label="Ángulo" onClick={() => { A.openJoint(); s.updateDraft({ type: 'angle', angle: '90 deg' }); }} />
              <Small icon="c_tangent" label="Tangente" onClick={() => { A.openJoint(); s.updateDraft({ type: 'tangent' }); }} />
            </Col>
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
          <Group label="Interferencias"><Big icon="interf" label="Analizar interferencias" onClick={() => s.open({ kind: 'interf' })} /></Group>
          <Group label="Medir"><Big icon="mass" label="Propiedades" onClick={() => s.open({ kind: 'bom' })} /></Group>
        </>)}
        {/* ---------- PLANO ---------- */}
        {k === 'drawing' && cur === 'place' && (<>
          <Group label="Crear">
            <Big icon="baseview" label="Base" onClick={() => s.open({ kind: 'drwview' })} title="Vista base de una pieza o ensamblaje abierto" />
            <SplitBig onPick={(t) => D.project(t as 'right')} items={[
              { key: 'right', icon: 'projview', label: 'Proyectada', title: 'Vista proyectada a la derecha (perfil izquierdo, proyección europea)' }, { key: 'down', icon: 'projview', label: 'Proyectada abajo' },
              { key: 'left', icon: 'projview', label: 'Proyectada izquierda' }, { key: 'up', icon: 'projview', label: 'Proyectada arriba' }, { key: 'iso', icon: 'iso', label: 'Isométrica' }]} />
            <Big icon="section" label="Sección" active={tool === 'drwSection'} onClick={T('drwSection')} title="Vista de sección con rayado: dibuja la línea de corte sobre una vista" />
            <Big icon="detail" label="Detalle" active={tool === 'drwDetail'} onClick={T('drwDetail')} title="Vista de detalle ampliada (2:1) de una zona circular" />
          </Group>
          <Group label="Modificar">
            <Col>
              <Small icon="centermark" label="Marcas de centro auto." disabled={!D.selView()} active={!!D.selView()?.centers} onClick={D.autoCenters} />
              <Small icon="section" label="Invertir sección" disabled={D.selView()?.kind !== 'section'} onClick={D.flipSection} />
            </Col>
          </Group>
          <Group label="Hoja">
            <div className="rb-grid sheets">
              {(['A4', 'A3', 'A2', 'A1', 'A0'] as const).map((z) => <button key={z} className={`rb-txt ${s.drw.sheet === z ? 'on' : ''}`} onClick={() => s.commitDrw((d) => { d.sheet = z; })}>{z}</button>)}
            </div>
          </Group>
        </>)}
        {k === 'drawing' && cur === 'annotate' && (<>
          <Group label="Cota">
            <Big icon="dim" label="Cota" kbd="D" active={tool === 'drwDim'} onClick={T('drwDim')} title="Cota lineal entre dos puntos (D)" />
            <Col>
              <Small icon="dimdia" label="Diámetro" active={tool === 'drwDimD'} onClick={T('drwDimD')} />
              <Small icon="dimrad" label="Radio" active={tool === 'drwDimR'} onClick={T('drwDimR')} />
              <Small icon="dimang" label="Ángulo" active={tool === 'drwDimA'} onClick={T('drwDimA')} />
            </Col>
          </Group>
          <Group label="Notas de taladro y rosca"><Big icon="holenote" label="Taladro / rosca" active={tool === 'drwHole'} onClick={T('drwHole')} /></Group>
          <Group label="Funciones">
            <Col>
              <Small icon="centermark" label="Marca de centro" active={tool === 'drwCenterMark'} onClick={T('drwCenterMark')} />
              <Small icon="centerline" label="Línea de centro" active={tool === 'drwCenterline'} onClick={T('drwCenterline')} />
            </Col>
          </Group>
          <Group label="Texto">
            <Big icon="note" label="Texto" active={tool === 'drwNote'} onClick={T('drwNote')} />
            <Big icon="leader" label="Directriz" active={tool === 'drwLeader'} onClick={T('drwLeader')} title="Texto con directriz" />
          </Group>
          <Group label="Símbolos">
            <Col>
              <Small icon="surface" label="Acabado superficial" active={tool === 'drwSurface'} onClick={T('drwSurface')} />
              <Small icon="weldsym" label="Soldadura" active={tool === 'drwWeld'} onClick={T('drwWeld')} title="Símbolo de soldadura ISO 2553" />
            </Col>
          </Group>
          <Group label="Tabla">
            <Big icon="bom" label="Lista de piezas" active={!!s.drw.bom} onClick={D.toggleBom} title="Lista de piezas del ensamblaje sobre el cajetín" />
            <Big icon="balloon" label="Globo" active={tool === 'drwBalloon'} onClick={T('drwBalloon')} title="Referencia a la lista de piezas" />
          </Group>
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
          <Group label="Aspecto">
            <Big icon="edges" label="Aristas" active={s.showEdges} onClick={() => s.set({ showEdges: !s.showEdges })} title="Sombreado con aristas" />
            <Big icon="iso" label="Alámbrico" active={s.wire} onClick={() => s.set({ wire: !s.wire, showEdges: true })} />
          </Group>
          <Group label="Vista de corte">
            <Col>
              {(['X', 'Y', 'Z'] as const).map((a) => <Small key={a} icon="section" label={`Corte plano ${a === 'X' ? 'YZ' : a === 'Y' ? 'XZ' : 'XY'}`} active={s.clip === a} onClick={() => s.set({ clip: s.clip === a ? '' : a })} />)}
            </Col>
          </Group>
          <Group label="Ratón 3D">
            <Big icon="spacemouse" label={s.spaceMouse ? 'SpaceMouse ✓' : 'SpaceMouse'} active={!!s.spaceMouse} onClick={() => s.open({ kind: 'spacemouse' })} title="Conectar y configurar un ratón 3D 3Dconnexion" />
          </Group>
          <Group label="Ventanas">
            <Col>
              <Small icon="newfile" label="Nuevo documento" onClick={() => s.open({ kind: 'newdoc' })} />
              <Small icon="help" label="Atajos de teclado" onClick={() => s.open({ kind: 'shortcuts' })} />
            </Col>
          </Group>
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
        <button onClick={act(() => s.open({ kind: 'newdoc' }))}><Icon name="newfile" size={20} />Nuevo…<kbd>Ctrl+N</kbd></button>
        <button onClick={act(() => openFile())}><Icon name="open" size={20} />Abrir…<kbd>Ctrl+O</kbd></button>
        <button onClick={act(saveDoc)}><Icon name="save" size={20} />Guardar<kbd>Ctrl+S</kbd></button>
        <hr />
        {s.kind === 'part' && <button onClick={act(() => importStep())}><Icon name="import" size={20} />Importar STEP en la pieza</button>}
        {s.kind !== 'drawing' && <button onClick={act(exportSTEP)}><Icon name="step" size={20} />Exportar STEP</button>}
        {s.kind !== 'drawing' && <button onClick={act(exportSTL)}><Icon name="stl" size={20} />Exportar STL</button>}
        {s.kind === 'drawing' && <button onClick={act(drwActions.exportDxf)}><Icon name="dxf" size={20} />Exportar DXF</button>}
        {s.kind === 'drawing' && <button onClick={act(drwActions.exportPdf)}><Icon name="pdf" size={20} />Exportar PDF</button>}
        <hr />
        <button onClick={act(() => s.open({ kind: 'project' }))}><Icon name="project" size={20} />Proyectos (.ipj)…</button>
        <button onClick={act(() => newIpj(s.docData(s.active) && 'iProperties' in (s.docData(s.active) as object) ? (s.docData(s.active) as any).iProperties.partNumber : 'Proyecto'))}><Icon name="project" size={20} />Crear proyecto .ipj</button>
        <button onClick={act(() => s.open({ kind: 'iprops' }))}><Icon name="iprops" size={20} />iProperties</button>
        <hr />
        <button onClick={act(() => s.open({ kind: 'about' }))}><Icon name="help" size={20} />Acerca de INV3D</button>
        <div className="fm-foot">Abre .i3p, .i3a, .i3d, .step/.stp, .ipj, .dwg, .dxf · lee metadatos y miniatura de .ipt, .iam, .idw, .ipn</div>
      </div>
    </>
  );
}

