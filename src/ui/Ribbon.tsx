import { openRecent } from './session';
import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../core/store';
import { Icon } from './icons';
import { ICON_THEMES, iconThemeOf } from '../core/persist';
import { toggleClipTool } from './ClipBar';
import { openFile, saveDoc, exportSTEP, exportSTL, exportMesh, exportIFC, importStep, newIpj } from '../core/files';
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
/** Botón grande con desplegable de variantes (Arco ▾, Rectángulo ▾…). Recuerda la última usada. */
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
      ['model', 'Modelo 3D'], ['pipe', 'Mecánica'], ['hvac', 'HVAC'], ['inspect', 'Inspeccionar'], ['tools', 'Herramientas'], ['view', 'Vista'],
    ];
    if (k === 'assembly') return [['asm', 'Ensamblar'], ['design', 'Diseño'], ['pipe', 'Mecánica'], ['hvac', 'HVAC'], ['weld', 'Soldadura'], ['present', 'Presentación'], ['inspect', 'Inspeccionar'], ['tools', 'Herramientas'], ['view', 'Vista']];
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
        <button className="qat-b" title="Guardar (Ctrl+S)" onClick={() => saveDoc()}><Icon name="save" size={16} /></button>
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
              <Small icon="projectgeom" label="Proyectar geometría" active={tool === 'projectGeom'} onClick={T('projectGeom')} disabled={!hasSolid && !s.ctxEdit} />
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
            <Big icon="smcontour" label="Pestaña de contorno" onClick={() => s.openFeatureDialog('sm_contour')} title="Perfil abierto de líneas con pliegues automáticos" />
            <Big icon="smflange" label="Pestaña" disabled={!hasSolid} onClick={() => s.openFeatureDialog('sm_flange')} />
            <Big icon="smloft" label="Pestaña solevada" onClick={() => s.openFeatureDialog('sm_loft')} title="Transición entre dos contornos (rectangular a circular, reducciones) con desarrollo por triangulación" />
            <Col>
              <Small icon="hem" label="Dobladillo" disabled={!hasSolid} onClick={() => { s.openFeatureDialog('sm_flange'); s.updateDraft({ angle: '180 deg', length: '10 mm', name: 'Dobladillo' }); }} title="Pestaña plegada a 180°" />
              <Small icon="fillet" label="Redondeo de esquina" disabled={!hasSolid} onClick={() => { s.openFeatureDialog('fillet'); s.updateDraft({ radius: '5 mm' }); }} />
              <Small icon="chamfer" label="Chaflán de esquina" disabled={!hasSolid} onClick={() => s.openFeatureDialog('chamfer')} />
            </Col>
          </Group>
          <Group label="Modificar">
            <Big icon="extrude" label="Corte" disabled={!hasSolid} title="Corte a través de la chapa" onClick={() => { s.openFeatureDialog('extrude'); s.updateDraft({ op: 'cut', dir: 'symmetric', extent: 'through' }); }} />
            <Big icon="punch" label="Punzonado" disabled={!hasSolid} onClick={() => s.openFeatureDialog('sm_punch')} title="Punzonado redondo, cuadrado, rectangular o coliso en puntos de boceto" />
            <Col>
              <Small icon="hole" label="Agujero" disabled={!hasSolid} onClick={() => s.openFeatureDialog('hole')} />
              <Small icon="mirror" label="Simetría" disabled={!hasSolid} onClick={() => s.openFeatureDialog('mirror')} />
              <Small icon="prect" label="Patrón" disabled={!hasSolid} onClick={() => s.openFeatureDialog('pattern')} />
            </Col>
          </Group>
          <Group label="Desarrollo"><Big icon="flat" label="Desarrollo" disabled={!hasSolid} onClick={() => s.open({ kind: 'flat' })} title="Patrón desarrollado y DXF para corte" /></Group>
        </>)}
        {cur === 'hvac' && (() => { const H = (hk: string) => () => s.open({ kind: 'hvac', hk }); return (<>
          <Group label="Conductos (EN 1505/1506 · SMACNA)">
            <Big icon="hduct" label="Conducto" onClick={H('duct')} title="Conducto recto rectangular, circular, espiral u oval plano" />
            <Big icon="helbow" label="Codo" onClick={H('elbow')} title="Codo con radio, recto con álabes, prensado o por gajos" />
            <Col>
              <Small icon="htrans" label="Transición" onClick={H('transition')} title="Transición, reducción o desvío (rectangular, circular u oval) con desarrollo para corte" />
              <Small icon="hbranch" label="Derivación" onClick={H('branch')} title="Te, toma de zapato, collarín, derivación a 45° y pantalón" />
              <Small icon="hcap" label="Tapa" onClick={H('cap')} />
            </Col>
            <Col><Small icon="hplenum" label="Plenum" onClick={H('plenum')} /><Small icon="hflange" label="Manguito" onClick={H('coupling')} title="Manguito de unión interior para conducto espiral (circular u oval)" /></Col>
          </Group>
          <Group label="Terminales y equipos">
            <Col>
              <Small icon="hgrille" label="Rejilla" onClick={H('grille')} />
              <Small icon="hdiff" label="Difusor" onClick={H('diffuser')} />
              <Small icon="hflex" label="Flexible" onClick={H('flex')} />
            </Col>
            <Col>
              <Small icon="hdamper" label="Compuerta" onClick={H('damper')} />
              <Small icon="hfire" label="Cortafuegos" onClick={H('firedamper')} />
              <Small icon="hsil" label="Silenciador" onClick={H('silencer')} />
            </Col>
            <Col>
              <Small icon="hahu" label="UTA" onClick={H('ahu')} />
              <Small icon="hfc" label="Fancoil" onClick={H('fancoil')} />
            </Col>
          </Group>
          <Group label="Uniones, soportes y aislamiento">
            <Col>
              <Small icon="hflange" label="Brida / marco" onClick={H('flange')} />
              <Small icon="hsupport" label="Soporte" onClick={H('support')} />
              <Small icon="hins" label="Aislamiento" onClick={H('insulation')} />
            </Col>
          </Group>
          <Group label="Red de conductos">
            <Big icon="hbranch" label="Red" disabled={k !== 'assembly'} onClick={() => s.open({ kind: 'ductnet' })} title={k === 'assembly' ? 'Red de conductos: trazado, dimensionado, cálculo, equilibrado, ventilador, ruido, aislamiento, mediciones y generación automática' : 'Disponible en un ensamblaje'} />
            <Col><Small icon="skel" label="Trazado" disabled={k !== 'assembly'} onClick={() => A.openSkel()} title="Dibuja los ejes de la red con líneas 3D (esqueleto)" /></Col>
          </Group>
                    <Group label="Espirotubo comercial">
            <Big icon="hduct" label="Espirotubo" onClick={() => s.open({ kind: 'spiro', sk: 'tube' })} title="Tubo espiral y accesorios comerciales con extremos macho: diámetros y espesores de catálogo" />
            <Col>
              <Small icon="helbow" label="Codo 15-90°" onClick={() => s.open({ kind: 'spiro', sk: 'elbow' })} title="Codos de espirotubo de 15, 30, 45, 60 y 90° prensados o por gajos" />
              <Small icon="hbranch" label="Te / injerto" onClick={() => s.open({ kind: 'spiro', sk: 'tee' })} title="Te 90°, te 45°, cruz y toma de silla" />
              <Small icon="htrans" label="Reducción" onClick={() => s.open({ kind: 'spiro', sk: 'reducer' })} title="Reducciones concéntricas y excéntricas" />
            </Col>
          </Group>
                    <Group label="Cálculo"><Big icon="hcalc" label="Dimensionar" onClick={() => s.open({ kind: 'ductcalc' })} title="Dimensionado de conductos por pérdida de carga o velocidad (Darcy-Weisbach / Colebrook)" /></Group>
        </>); })()}
        {cur === 'pipe' && (<>
          {([['ASME', 'Tubería ASME (B36.10 · B16.5 · B16.47 · B16.9 · B16.11)'], ['EN', 'Tubería EN (EN 10220 · EN 1092-1 · EN 10253)']] as const).map(([norm, lbl]) => (
            <Group key={norm} label={lbl}>
              <Big icon="pipe" label="Tubo" onClick={() => s.open({ kind: 'piping', pk: 'pipe', norm })} />
              <Big icon="pflange" label="Brida" onClick={() => s.open({ kind: 'piping', pk: 'flange', norm })} />
              <Big icon="pelbow" label="Codo" onClick={() => s.open({ kind: 'piping', pk: 'elbow', norm })} />
              <Col>
                <Small icon="ptee" label="Te" onClick={() => s.open({ kind: 'piping', pk: 'tee', norm })} />
                <Small icon="ptee" label="Te reducida" onClick={() => s.open({ kind: 'piping', pk: 'rtee', norm })} />
                <Small icon="pcross" label="Cruz" onClick={() => s.open({ kind: 'piping', pk: 'cross', norm })} />
              </Col>
              <Col>
                <Small icon="preducer" label="Reducción" onClick={() => s.open({ kind: 'piping', pk: 'reducer', norm })} />
                <Small icon="pcap" label="Casquete" onClick={() => s.open({ kind: 'piping', pk: 'cap', norm })} />
                <Small icon="pcoupling" label="Manguito" onClick={() => s.open({ kind: 'piping', pk: 'coupling', norm })} />
              </Col>
              {norm === 'ASME' && <Col><Small icon="pstub" label="Portabridas" onClick={() => s.open({ kind: 'piping', pk: 'stub', norm })} /></Col>}
            </Group>
          ))}
          <Group label="Redes y cálculo a presión">
            <Big icon="pipe" label="Red de tuberías" disabled={k !== 'assembly'} onClick={() => s.open({ kind: 'pipenet' })} title={k === 'assembly' ? 'Trazado, dimensionado, pérdidas, espesores, PED, vanos, generación e isométrico' : 'Disponible en un ensamblaje'} />
            <Big icon="hcalc" label="Comprobar a presión" onClick={() => s.open({ kind: 'pressure' })} title="Espesor de tubo (B31.3 / EN 13480), bridas P-T (B16.5 / EN 1092-1), refuerzo de derivaciones y vanos entre soportes" />
            <Big icon="pcap" label="Recipiente EN 13445" onClick={() => s.open({ kind: 'vessel' })} title="Recipiente a presión: espesores, prueba hidráulica, categoría PED y modelo 3D con tubuladuras y soportes" />
            <Col><Small icon="skel" label="Trazado" disabled={k !== 'assembly'} onClick={() => A.openSkel()} title="Ejes de la red con líneas 3D" /></Col>
          </Group>
        </>)}
        {k === 'part' && cur === 'model' && (<>
          <Group label="Boceto">
            <Big icon="sketch" label="Iniciar boceto 2D" kbd="S" active={tool === 'pickPlane'} onClick={P.startSketch} />
            <Big icon="sketch3d" label="Boceto 3D" onClick={() => s.open({ kind: 'sketch3d' })} title="Líneas, splines y hélices en el espacio (trayectorias y contornos)" />
            <Big icon="workpoint" label="Boceto en auxiliar" onClick={() => s.open({ kind: 'auxsketch' })} title="Boceto por un punto auxiliar (paralelo a XY/XZ/YZ) o por punto y eje auxiliar (normal al eje)" />
          </Group>
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
            <Col>
              <Small icon="derive" label="Derivar" onClick={() => s.openFeatureDialog('derive')} title="Pieza derivada: copia de otra pieza con escala y simetría" />
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
            <Col>
              <Small icon="combine" label="Combinar" disabled={!hasSolid} onClick={() => s.openFeatureDialog('combine')} title="Unir, cortar o intersecar cuerpos" />
              <Small icon="move" label="Mover cuerpo" disabled={!hasSolid} onClick={() => s.openFeatureDialog('movebody')} />
              <Small icon="copy2d" label="Copiar cuerpo" disabled={!hasSolid} onClick={() => { s.openFeatureDialog('movebody'); s.updateDraft({ copy: true, name: 'Copiar cuerpo' }); }} />
            </Col>
          </Group>
          <Group label="Superficie">
            <Col>
              <Small icon="surfext" label="Extruir" onClick={() => s.openFeatureDialog('surf_extrude')} title="Superficie extruida desde un perfil abierto o cerrado" />
              <Small icon="surfrev" label="Revolución" onClick={() => s.openFeatureDialog('surf_revolve')} title="Superficie de revolución" />
              <Small icon="surfloft" label="Solevación" onClick={() => s.openFeatureDialog('surf_loft')} title="Superficie solevada o reglada entre contornos" />
            </Col>
            <Col>
              <Small icon="patch" label="Parche" onClick={() => s.openFeatureDialog('surf_patch')} title="Superficie limitada por un contorno cerrado 2D o 3D" />
              <Small icon="stitch" label="Coser" onClick={() => s.openFeatureDialog('stitch')} title="Une superficies; si cierran un volumen crea un sólido" />
              <Small icon="thicken" label="Engrosar sup." onClick={() => { s.openFeatureDialog('thicken'); const sf = s.doc.features.filter((f) => f.type.startsWith('surf_') || f.type === 'stitch').pop(); if (sf) s.updateDraft({ surface: sf.id }); }} title="Da espesor a una superficie" />
            </Col>
          </Group>
          <Group label="Operaciones de trabajo">
            <Big icon="workplane" label="Plano" onClick={() => s.openFeatureDialog('workplane')} title="Plano de trabajo desfasado o girado" />
            <Big icon="epoint" label="ePoint" onClick={() => s.open({ kind: 'epoint' })} title="Puntos de conexión de la pieza: coincidencia, inserción y compuesto. Al colocar la pieza en un ensamblaje se conectan solos con los del mismo nombre" />
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
            <Col>
              <Small icon="pathpattern" label="Por trayectoria" disabled={!hasSolid} onClick={() => s.openFeatureDialog('pathpattern')} />
            </Col>
          </Group>
          <Group label="Parámetros">
            <Big icon="params" label="Parámetros" onClick={() => s.open({ kind: 'params' })} />
            <Col>
              <Small icon="ipart" label="Tabla eFamily" onClick={() => s.open({ kind: 'ipart' })} title="Familia de piezas: una fila por miembro" />
              <Small icon="ifeature" label="eOperaciones" onClick={() => s.open({ kind: 'ifeature' })} title="Extraer o insertar operaciones reutilizables" />
            </Col>
          </Group>
        </>)}
        {k === 'part' && cur === 'inspect' && (<>
          <Group label="Medir">
            <Big icon="measure" label="Medir" active={tool === 'measure'} onClick={T('measure')} title="Distancia entre puntos, longitud de aristas, radios" />
            <Big icon="mass" label="Propiedades físicas" onClick={() => s.open({ kind: 'iprops' })} />
          </Group>
          <Group label="Simulación">
            <Big icon="fem" label="Análisis de tensiones" onClick={() => s.open({ kind: 'fem' })} title="Cálculo estático lineal por elementos finitos: elige caras fijas y caras cargadas" />
            {s.fem?.res && s.fem.part === s.active && <Big icon="close" label="Quitar resultados" onClick={() => s.set({ fem: null })} />}
          </Group>
        </>)}
        {/* ---------- ENSAMBLAJE ---------- */}
        {k === 'assembly' && cur === 'asm' && (<>
          <Group label="Componente">
            <SplitBig onPick={(t) => s.open({ kind: t as 'place' | 'content' })} items={[
              { key: 'place', icon: 'place', label: 'Colocar', title: 'Colocar pieza (P)' }, { key: 'content', icon: 'content', label: 'Centro de contenido', title: 'Tornillería, pasadores, rodamientos y chavetas normalizados' }]} />
            <Big icon="newpart" label="Crear" title="Crear una pieza nueva en contexto: elige una cara de otro componente para su primer boceto" onClick={A.createPart} />
            <Big icon="part" label="Editar" disabled={!s.asm.occurrences.some((o) => o.id === s.selItem && s.docs.find((d) => d.id === o.part)?.kind === 'part')} onClick={() => A.editInPlace(s.selItem!)} title="Editar la pieza seleccionada en contexto (doble clic sobre el componente)" />
            <Col>
              <Small icon="pattern_comp" label="Patrón" disabled={!s.asm.occurrences.some((o) => o.id === s.selItem)} onClick={() => s.open({ kind: 'cpattern' })} title="Patrón rectangular o circular del componente seleccionado" />
              <Small icon="content" label="Centro de contenido" onClick={() => s.open({ kind: 'content' })} />
              <Small icon="mirror" label="Simetría" disabled={!s.asm.occurrences.some((o) => o.id === s.selItem)} onClick={() => A.mirrorComponent(s.selItem!, 'YZ')} title="Componente simétrico respecto al plano YZ (más planos con clic derecho en el navegador)" />
            </Col>
            <Col>
              <Small icon="replace" label="Sustituir" disabled={!s.asm.occurrences.some((o) => o.id === s.selItem)} onClick={() => s.open({ kind: 'replace' })} />
              <Small icon="eye" label="Representaciones" onClick={() => s.open({ kind: 'viewreps' })} title="Representaciones de vista (componentes ocultos)" />
              <Small icon="params" label="Estados de modelo" onClick={() => s.open({ kind: 'mstates' })} title="Estados de modelo: variantes con elementos suprimidos y posiciones" />
            </Col>
          </Group>
          <Group label="Posición">
            <Big icon="move" label="Mover" active={tool === 'move'} onClick={T('move')} title="Mover o girar el componente seleccionado con el gizmo (respeta las restricciones)" />
            <Col>
              <Small icon="ground" label="Fijar / liberar" disabled={!s.asm.occurrences.some((o) => o.id === s.selItem)} onClick={A.toggleGround} />
            </Col>
          </Group>
          <Group label="Relaciones">
            <Big icon="constraint3d" label="Restringir" kbd="J" onClick={() => A.openJoint()} title="Coincidir, al ras, ángulo, perpendicular, tangente, insertar, simetría o rígida, entre componentes o con planos/ejes de origen (J). También con clic derecho sobre una cara" />
            <Big icon="joint" label="Unión" onClick={() => { A.openJoint(); s.updateDraft({ type: 'rot', name: 'Unión' }); }} title="Unión de rotación, corredera, cilíndrica, planar o bola" />
            <Big icon="epoint" label="Conectar ePoints" onClick={() => A.connectEPoints()} title="Une automáticamente los ePoints del mismo nombre y tipo de los componentes (coincidencia, inserción y compuestos)" />
            <Col>
              <Small icon="insert3d" label="Insertar" onClick={() => { A.openJoint(); s.updateDraft({ type: 'insert' }); }} />
              <Small icon="angle3d" label="Ángulo" onClick={() => { A.openJoint(); s.updateDraft({ type: 'angle', angle: '90 deg' }); }} />
              <Small icon="c_tangent" label="Tangente" onClick={() => { A.openJoint(); s.updateDraft({ type: 'tangent' }); }} />
            </Col>
            <Col>
              <Small icon="joint2" label="Movimiento" disabled={!s.asm.joints.some((j) => j.type === 'rot' || j.type === 'cyl')} onClick={() => s.open({ kind: 'motion' })} title="Restricción de movimiento: engranajes (rotación-rotación) y piñón-cremallera (rotación-traslación)" />
              <Small icon="drive" label="Conducir" disabled={!s.asm.joints.some((j) => j.type === 'rot' || j.type === 'slider')} onClick={() => s.open({ kind: 'drive' })} title="Animar una unión de rotación o corredera" />
            </Col>
          </Group>
          <Group label="Geometría de trabajo">
            <Big icon="workplane" label="Plano" onClick={() => A.openWorkPlane()} title="Plano auxiliar del ensamblaje (P1, P2…): desfase de un plano de origen o de una cara" />
            <Col>
              <Small icon="workaxis" label="Eje" onClick={() => s.open({ kind: 'asmaux', aux: 'axis' })} title="Eje auxiliar del ensamblaje (E1, E2…)" />
              <Small icon="workpoint" label="Punto" onClick={() => s.open({ kind: 'asmaux', aux: 'point' })} title="Punto auxiliar del ensamblaje (pt1, pt2…)" />
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
          <Group label="Cálculo">
            <Big icon="hcalc" label="Calcular estructura" disabled={!s.asm.frames.length} onClick={() => s.open({ kind: 'framecalc' })} title="Pórtico espacial: esfuerzos, reacciones, flechas y comprobación EN 1993-1-1 de las barras" />
            <Big icon="bolt" label="Uniones EC3" onClick={() => s.open({ kind: 'jointcalc' })} title="Tornillos y soldaduras en ángulo según EN 1993-1-8" />
          </Group>
          <Group label="Generadores">
            <Big icon="gear" label="Generadores" onClick={() => s.open({ kind: 'gen' })} title="Ejes, engranajes, rodamientos, muelles y chavetas con su cálculo" />
          </Group>
        </>)}
        {k === 'assembly' && cur === 'weld' && (<>
          <Group label="Soldadura">
            <Big icon="weld" label="Cordón en ángulo" onClick={() => A.openWeld()} title="Cordón entre dos caras que forman rincón (ISO 2553)" />
          </Group>
          <Group label="Informes">
            <Big icon="bom" label="Lista de soldaduras" onClick={() => s.open({ kind: 'bom' })} />
          </Group>
          <Group label="Cálculo"><Big icon="hcalc" label="Comprobar soldadura" onClick={() => s.open({ kind: 'jointcalc' })} title="Soldadura en ángulo EN 1993-1-8 (simplificado y direccional)" /></Group>
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
          <Group label="Interferencias"><Big icon="interf" label="Analizar interferencias" onClick={() => s.open({ kind: 'interf' })} />
            <Big icon="interf" label="Colisiones al mover" active={s.collide} onClick={() => { s.set({ collide: !s.collide }); s.notify(!s.collide ? 'Detección de colisiones activada: se comprueba cada vez que mueves un componente' : 'Detección de colisiones desactivada'); }} title="Comprueba si el componente choca con otros al arrastrarlo o moverlo con el gizmo" /></Group>
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
            <Col>
              <Small icon="auxview" label="Auxiliar" active={tool === 'drwAux'} onClick={T('drwAux')} title="Vista auxiliar perpendicular a una arista (verdadera magnitud)" />
              <Small icon="flat" label="Desarrollo" onClick={() => { const p = s.docs.find((d) => d.kind === 'part' && ((s.docData(d.id) as any)?.features ?? []).some((f: any) => String(f.type).startsWith('sm_'))); if (!p) s.notify('Abre una pieza de chapa', 'error'); else D.placeFlat(p.id); }} title="Vista del desarrollo de chapa con líneas de pliegue" />
            </Col>
          </Group>
          <Group label="Modificar">
            <Col>
              <Small icon="breakview" label="Partir" active={tool === 'drwBreak'} onClick={T('drwBreak')} title="Vista partida: suprime un tramo largo" />
              <Small icon="cropview" label="Recortar" active={tool === 'drwCrop'} onClick={T('drwCrop')} title="Recorta la vista a un rectángulo" />
            </Col>
            <Col>
              <Small icon="section" label="Sección escalonada" active={tool === 'drwSectionPath'} onClick={T('drwSectionPath')} title="Sección por una línea quebrada (escalonada o alineada): clic en los puntos, Intro para terminar" />
              <Small icon="breakout" label="Corte parcial" active={tool === 'drwBreakout'} onClick={T('drwBreakout')} title="Corte parcial (Break Out): rectángulo sobre la vista y profundidad" />
            </Col>
            <Col>
              <Small icon="centermark" label="Marcas de centro auto." disabled={!D.selView()} active={!!D.selView()?.centers} onClick={D.autoCenters} />
              <Small icon="section" label="Invertir sección" disabled={D.selView()?.kind !== 'section'} onClick={D.flipSection} />
            </Col>
          </Group>
          <Group label="Hoja">
            <Big icon="sheets" label="Nueva hoja" onClick={D.addSheet} title="Añade una hoja al plano (cambia de hoja en el navegador)" />
            <Big icon="style" label={`Estilos ${s.drw.std ?? 'ISO'}`} onClick={() => s.open({ kind: 'drwstyle' })} title="Gestor de estilos: norma ISO/DIN/ANSI, cotas, flechas, líneas y proyección" />
            <Big icon="revtable" label="Cajetín" onClick={() => s.open({ kind: 'tbtpl' })} title="Plantilla de cajetín: celdas, campos propios, biblioteca y plantilla por defecto" />
            <div className="rb-grid sheets">
              {(['A4', 'A3', 'A2', 'A1', 'A0'] as const).map((z) => <button key={z} className={`rb-txt ${s.drw.sheet === z ? 'on' : ''}`} onClick={() => s.commitDrw((d) => { d.sheet = z; })}>{z}</button>)}
            </div>
          </Group>
        </>)}
        {k === 'drawing' && cur === 'annotate' && (<>
          <Group label="Cota">
            <Big icon="dim" label="Cota" kbd="D" active={tool === 'drwDim'} onClick={T('drwDim')} title="Cota lineal entre dos puntos (D)" />
            <Big icon="retrieve" label="Recuperar" onClick={() => s.open({ kind: 'retrieve' })} title="Recuperar las cotas del modelo en la vista seleccionada (asociativas)" />
            <Col>
              <Small icon="dimdia" label="Diámetro" active={tool === 'drwDimD'} onClick={T('drwDimD')} />
              <Small icon="dimrad" label="Radio" active={tool === 'drwDimR'} onClick={T('drwDimR')} />
              <Small icon="dimang" label="Ángulo" active={tool === 'drwDimA'} onClick={T('drwDimA')} />
            </Col>
            <Col>
              <Small icon="dimbase" label="Línea base" active={tool === 'drwBaseline'} onClick={T('drwBaseline')} title="Varias cotas desde un mismo punto base (Intro para crear)" />
              <Small icon="dimord" label="Coordenadas" active={tool === 'drwOrd'} onClick={T('drwOrd')} title="Cotas por coordenadas desde un origen" />
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
            <Col>
              <Small icon="fcf" label="Tolerancia geom." active={tool === 'drwFcf'} onClick={T('drwFcf')} title="Marco de tolerancia geométrica ISO 1101" />
              <Small icon="datum" label="Referencia" active={tool === 'drwDatum'} onClick={T('drwDatum')} title="Símbolo de referencia (datum)" />
            </Col>
          </Group>
          <Group label="Tabla">
            <Big icon="bom" label="Lista de piezas" active={!!s.drw.bom} onClick={D.toggleBom} title="Lista de piezas del ensamblaje sobre el cajetín" />
            <Big icon="balloon" label="Globo" active={tool === 'drwBalloon'} onClick={T('drwBalloon')} title="Referencia a la lista de piezas" />
            <Big icon="balloon" label="Globos automáticos" onClick={() => D.autoBalloons()} title="Un globo por elemento de la lista de piezas en la vista seleccionada del ensamblaje (activa también la lista de piezas)" />
            <Col>
              <Small icon="holetable" label="Taladros" onClick={() => D.addTable('hole')} title="Tabla de taladros de la vista seleccionada" />
              <Small icon="revtable" label="Revisiones" onClick={() => D.addTable('rev')} title="Tabla de revisiones" />
              <Small icon="flat" label="Pliegues" onClick={() => D.addTable('bend')} title="Tabla de pliegues de la vista de desarrollo" />
            </Col>
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
            {(k === 'part' || k === 'assembly') && <Big icon="workpoint" label="Referencias a objetos" kbd="F3" onClick={() => s.open({ kind: 'osnap' })} title="Punto final, medio, centro, cuadrante, intersección, perpendicular, tangente, cercano, nodo, origen" />}
          </Group>
          <Group label="Intercambio">
            <Big icon="ilogic" label="Regla de exportación" onClick={() => s.open({ kind: 'ilogic' })} title="Regla (VB.NET) para exportar un proyecto .ipj a STEP y DWG" />
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
            {(k === 'part' || k === 'assembly') && <Big icon="workpoint" label="Ver/ocultar CDG" active={!!s.hud.cog} onClick={() => s.set({ hud: { ...s.hud, cog: !s.hud.cog } })} title="Centro de gravedad de la pieza o del ensamblaje (con su masa según el material)" />}
          </Group>
          <Group label="Vista de corte">
            <Big icon="section" label="Modo de recorte" active={!!s.clipTool} onClick={() => toggleClipTool()} title="Barra de recorte: plano, franja o manual (punto y sentido ±X/±Y/±Z), con la cara cortada rellena" />
            <Col>
              {(['X', 'Y', 'Z'] as const).map((a) => <Small key={a} icon="section" label={`Corte plano ${a === 'X' ? 'YZ' : a === 'Y' ? 'XZ' : 'XY'}`} active={s.clip === a} onClick={() => s.set({ clip: s.clip === a ? '' : a })} />)}
            </Col>
          </Group>
          <Group label="Estilo de iconos">
            <Col>
              {ICON_THEMES.slice(0, 2).map(([k, l]) => <Small key={k} icon="extrude" label={l} active={(iconThemeOf(s.settings.iconTheme)) === k} onClick={() => s.set({ settings: { ...s.settings, iconTheme: k } })} />)}
            </Col>
            <Col>
              {ICON_THEMES.slice(2).map(([k, l]) => <Small key={k} icon="extrude" label={l} active={(iconThemeOf(s.settings.iconTheme)) === k} onClick={() => s.set({ settings: { ...s.settings, iconTheme: k } })} />)}
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
        <button onClick={act(() => saveDoc())}><Icon name="save" size={20} />Guardar{s.folder.state === 'granted' ? ` en ${s.folder.name}` : ''}<kbd>Ctrl+S</kbd></button>
        <button onClick={act(() => saveDoc(true))}><Icon name="save" size={20} />Guardar como…<kbd>Ctrl+Mayús+S</kbd></button>
        <button onClick={act(() => s.open({ kind: 'folder' }))}><Icon name="folder" size={20} />Carpeta de trabajo{s.folder.name ? `: ${s.folder.name}` : '…'}</button>
        {s.recent.length > 0 && (<>
          <div className="fm-sub">Recientes</div>
          {s.recent.slice(0, 8).map((r) => (
            <button key={r.path ?? r.name} className="fm-recent" title={r.path ?? r.name} onClick={act(() => openRecent(r))}><Icon name={r.kind === 'i3a' || r.kind === 'assembly' ? 'assembly' : r.kind === 'i3d' || r.kind === 'drawing' ? 'drawing' : 'part'} size={16} />{r.path ?? r.name}</button>
          ))}
        </>)}
        <hr />
        {s.kind === 'part' && <button onClick={act(() => importStep())}><Icon name="import" size={20} />Importar STEP en la pieza</button>}
        {s.kind !== 'drawing' && <button onClick={act(exportSTEP)}><Icon name="step" size={20} />Exportar STEP</button>}
        {s.kind !== 'drawing' && <button onClick={act(exportSTL)}><Icon name="stl" size={20} />Exportar STL</button>}
        {s.kind !== 'drawing' && <button onClick={act(() => exportMesh('3mf'))}><Icon name="stl" size={20} />Exportar 3MF (impresión 3D)</button>}
        {s.kind !== 'drawing' && <button onClick={act(() => exportMesh('obj'))}><Icon name="stl" size={20} />Exportar OBJ</button>}
        {s.kind !== 'drawing' && <button onClick={act(() => exportMesh('glb'))}><Icon name="stl" size={20} />Exportar glTF (.glb)</button>}
        {s.kind !== 'drawing' && <button onClick={act(() => exportIFC())}><Icon name="stl" size={20} />Exportar IFC4 (BIM)</button>}
        {s.kind === 'drawing' && <button onClick={act(drwActions.exportDxf)}><Icon name="dxf" size={20} />Exportar DXF</button>}
        {s.kind === 'drawing' && <button onClick={act(drwActions.exportPdf)}><Icon name="pdf" size={20} />Exportar PDF</button>}
        <hr />
        <button onClick={act(() => s.open({ kind: 'project' }))}><Icon name="project" size={20} />Proyectos (.ipj)…</button>
        <button onClick={act(() => newIpj(s.docData(s.active) && 'iProperties' in (s.docData(s.active) as object) ? (s.docData(s.active) as any).iProperties.partNumber : 'Proyecto'))}><Icon name="project" size={20} />Crear proyecto .ipj</button>
        <button onClick={act(() => s.open({ kind: 'iprops' }))}><Icon name="iprops" size={20} />iProperties</button>
        <hr />
        <button onClick={act(() => s.open({ kind: 'options' }))}><Icon name="settings" size={20} />Opciones de la aplicación…</button>
        <button onClick={act(() => s.open({ kind: 'about' }))}><Icon name="help" size={20} />Acerca de INV3D</button>
        <div className="fm-foot">Abre .i3p, .i3a, .i3d, .step/.stp, .ipj, .dwg, .dxf · lee metadatos y miniatura de .ipt, .iam, .idw, .ipn</div>
      </div>
    </>
  );
}

