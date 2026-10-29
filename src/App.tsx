import { useEffect, useState } from 'react';
import { useStore, activeSketch, startCad } from './core/store';
import Ribbon from './ui/Ribbon';
import Browser from './ui/Browser';
import PartViewport from './ui/PartViewport';
import AsmViewport from './ui/AsmViewport';
import DrawingView from './ui/DrawingView';
import { PropertyPanel, Modals } from './ui/Panels';
import { saveDoc, openFile } from './core/files';
import { fmt } from './core/expr';
import { Icon } from './ui/icons';
import { asmActions } from './ui/actions';

const TOOL_MSG: Record<string, string> = {
  pickPlane: 'Selecciona un plano de origen, un plano de trabajo o una cara plana para el boceto',
  arc3: 'Arco: punto inicial, punto final y punto intermedio', arctan: 'Arco tangente: desde el extremo de una línea', rect3: 'Rectángulo: dos puntos de un lado y la anchura',
  rectc: 'Rectángulo: centro y esquina', circle3: 'Círculo: tres puntos', ellipse: 'Elipse: centro, eje mayor y eje menor', text: 'Texto: clic para colocar',
  skdim: 'Cota: geometría y posición del texto', constrain: 'Restricción: selecciona la geometría', trim: 'Recortar', extend: 'Alargar',
  fillet2d: 'Empalme: clic cerca del vértice', chamfer2d: 'Chaflán: clic cerca del vértice', projectGeom: 'Proyectar aristas del modelo', measure: 'Medir: clic en aristas',
  line: 'Línea: clic en puntos sucesivos · cerrar en el primer punto crea un contorno · doble clic o Esc termina',
  rect: 'Rectángulo: clic en dos esquinas opuestas', circle: 'Círculo: centro y radio', npoly: 'Polígono: centro y vértice',
  arc: 'Arco: centro, punto inicial y punto final (sentido antihorario)', slot: 'Ranura: centro 1, centro 2 y anchura', point: 'Punto: clic para colocar',
  pickEdges: 'Selecciona aristas en la pantalla', pickFaces: 'Selecciona caras', pickFlangeEdge: 'Selecciona la arista de la pestaña',
  asmFace: 'Selecciona caras planas de los componentes', frameLine: 'Selecciona líneas para los perfiles', skelPoint: 'Selecciona puntos',
  weldFace: 'Selecciona las dos caras del rincón', boltFace: 'Selecciona la cara de inicio', move: 'Mover componente', pickMember: 'Selecciona barras',
  drwDim: 'Cota: dos puntos y posición', drwNote: 'Nota: clic para colocar',
};

function StatusBar() {
  const s = useStore();
  const sk = activeSketch(s);
  const msg = (s.tool && TOOL_MSG[s.tool]) || (sk ? `Editando ${sk.name}` : 'Preparado');
  const ms = s.kind === 'part' ? s.result?.ms : s.kind === 'assembly' ? s.asmResult?.ms : undefined;
  return (
    <footer className="status">
      <span className="st-msg">{msg}</span>
      {s.mode === 'sketch' && s.skInfo && <span className={`st-item dofs ${s.skInfo.dof === 0 ? 'full' : ''}`}>{s.skInfo.dof === 0 ? 'Totalmente restringido' : `Se necesitan ${s.skInfo.dof} cotas`}</span>}
      <span className="grow" />
      {s.cursor && s.mode === 'sketch' && <span className="st-item mono">X {fmt(s.cursor[0], 2)} · Y {fmt(s.cursor[1], 2)} mm</span>}
      {s.spaceMouse && <span className="st-item sm" title="Ratón 3D conectado">⬤ {s.spaceMouse}</span>}
      {s.busy && <span className="st-item">Regenerando…</span>}
      {!s.busy && ms !== undefined && <span className="st-item">{fmt(ms, 0)} ms</span>}
      <span className={`st-item oc ${s.oc}`}>{s.oc === 'ready' ? 'OpenCascade listo' : s.oc === 'error' ? 'Núcleo con error' : `Cargando núcleo ${Math.round(s.ocProgress * 100)}%`}</span>
    </footer>
  );
}

function Toast() {
  const t = useStore((s) => s.toast);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!t) return;
    setShow(true);
    const h = setTimeout(() => setShow(false), t.kind === 'error' ? 5000 : 2600);
    return () => clearTimeout(h);
  }, [t]);
  if (!t || !show) return null;
  return <div className={`toast ${t.kind}`} role="status">{t.text}</div>;
}

function ConfirmBox() {
  const c = useStore((s) => s.confirmBox);
  if (!c) return null;
  const done = (v: boolean) => { useStore.setState({ confirmBox: null }); c.resolve(v); };
  return (
    <div className="modal-shade" onKeyDown={(e) => { if (e.key === 'Escape') done(false); }}>
      <div className="modal confirm" role="alertdialog" aria-label="Confirmar">
        <div className="modal-body"><p>{c.text}</p>
          <div className="modal-btns"><span className="grow" />
            <button className="btn primary" autoFocus onClick={() => done(true)}>{c.ok}</button>
            <button className="btn" onClick={() => done(false)}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Loader() {
  const s = useStore();
  if (s.oc === 'ready') return null;
  return (
    <div className="loader">
      <div className="loader-card">
        <div className="loader-title">INV3D</div>
        {s.oc === 'error' ? <p className="errtxt">No se pudo cargar el núcleo geométrico: {s.ocError}</p> : (<>
          <p>Cargando el núcleo geométrico OpenCascade (23 MB, solo la primera vez)…</p>
          <div className="bar"><div style={{ width: `${Math.max(6, s.ocProgress * 100)}%` }} /></div>
        </>)}
      </div>
    </div>
  );
}

/** Pestañas de documentos abiertos (como la barra inferior de Inventor). */
function DocTabs() {
  const s = useStore();
  const icon = { part: 'part', assembly: 'assembly', drawing: 'drawing' } as const;
  return (
    <div className="doc-tabs" role="tablist">
      {s.docs.map((d) => {
        const on = d.id === s.active;
        const dirty = on ? s.dirty : d.dirty;
        return (
          <div key={d.id} role="tab" aria-selected={on} className={`doc-tab ${on ? 'on' : ''}`} onClick={() => s.activate(d.id)} title={d.fileName}>
            <Icon name={icon[d.kind]} size={15} /><span>{d.fileName}{dirty ? ' *' : ''}</span>
            <button className="doc-x" title="Cerrar" onClick={async (e) => {
              e.stopPropagation();
              const used = s.docs.some((o) => o.kind === 'assembly' && (s.docData(o.id) as any)?.occurrences?.some((x: any) => x.part === d.id));
              if (used) { s.notify('Esta pieza la usa un ensamblaje abierto; cierra antes el ensamblaje', 'error'); return; }
              if (dirty && !(await s.ask(`${d.fileName} tiene cambios sin guardar. ¿Cerrarlo?`, 'Cerrar sin guardar'))) return;
              s.closeDocument(d.id);
            }}>×</button>
          </div>
        );
      })}
      <button className="doc-new" title="Nuevo documento" onClick={() => s.open({ kind: 'newdoc' })}>+</button>
    </div>
  );
}

export default function App() {
  useEffect(() => { startCad(); }, []);
  const kind = useStore((s) => s.kind);
  const active = useStore((s) => s.active);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const s = useStore.getState();
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z') { e.preventDefault(); s.undo(); }
        else if (k === 'y') { e.preventDefault(); s.redo(); }
        else if (k === 's') { e.preventDefault(); saveDoc(); }
        else if (k === 'o') { e.preventDefault(); openFile(); }
        else if (k === 'n') { e.preventDefault(); s.open({ kind: 'newdoc' }); }
        return;
      }
      if (s.confirmBox || (s.dialog && !('draft' in s.dialog) && s.dialog.kind !== 'skop')) return;
      if (e.key === 'Escape') {
        if (s.menuOpen) return s.set({ menuOpen: false });
        if (s.dialog) return s.closeDialog();
        if (s.tool) return s.setTool(null);
        if (s.mode === 'sketch' && (s.selEntity || s.selCon || s.selEntities.length)) return s.set({ selEntity: null, selCon: null, selEntities: [] });
        if (s.mode === 'sketch') return s.finishSketch();
        if (s.mode === 'present') return s.set({ mode: 'model', explodeT: 0 });
        return s.set({ selFeature: null, selItem: null });
      }
      if (e.key === 'F6') { e.preventDefault(); return s.setView('home'); }
      if (e.key === 'Home') return s.setView('fit');
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.kind === 'part') {
          if (s.mode === 'sketch' && s.selCon) return s.deleteConstraint(s.selCon);
          if (s.mode === 'sketch' && (s.selEntity || s.selEntities.length)) return s.deleteEntity(s.selEntity ?? s.selEntities[0]);
          if (s.mode === 'model' && s.selFeature && !s.dialog) return s.deleteFeature(s.selFeature);
        }
        if (s.kind === 'assembly' && s.selItem && !s.dialog) {
          const id = s.selItem;
          return s.commitAsm((a) => {
            a.occurrences = a.occurrences.filter((x) => x.id !== id); a.joints = a.joints.filter((j) => j.id !== id && j.a.occ !== id && j.b.occ !== id);
            a.frames = a.frames.filter((x) => x.id !== id); for (const f of a.frames) f.ends = f.ends.map((en) => (en.other === id ? { type: 'none' } : en)) as typeof f.ends;
            a.welds = a.welds.filter((x) => x.id !== id); a.bolts = a.bolts.filter((x) => x.id !== id); a.skeleton = a.skeleton.filter((x) => x.id !== id);
          });
        }
        if (s.kind === 'drawing' && s.selItem) {
          const id = s.selItem;
          return s.commitDrw((d) => {
            d.dims = d.dims.filter((x) => x.id !== id); d.notes = d.notes.filter((x) => x.id !== id); d.anns = (d.anns ?? []).filter((x) => x.id !== id);
            if (d.views.some((v) => v.id === id)) { const gone = new Set([id, ...d.views.filter((v) => v.parent === id).map((v) => v.id)]); d.views = d.views.filter((v) => !gone.has(v.id)); d.dims = d.dims.filter((x) => !gone.has(x.view)); }
          });
        }
      }
      if (s.kind === 'part' && s.mode === 'sketch') {
        if (e.key === 'F8' || e.key === 'F9') { e.preventDefault(); return s.set({ showCons: !s.showCons }); }
        if (s.dialog) return;
        const map: Record<string, typeof s.tool> = { l: 'line', r: 'rect', c: 'circle', p: 'npoly', a: 'arc3', d: 'skdim', x: 'trim', t: 'text' };
        if (map[k]) { e.preventDefault(); s.setTool(map[k]); }
        return;
      }
      if (s.dialog) return;
      // preventDefault: la tecla no debe llegar al campo que recibe el foco al abrir el diálogo
      if (s.kind === 'part') {
        if (k === 's') { e.preventDefault(); s.setTool('pickPlane'); }
        else if (k === 'e') { e.preventDefault(); s.openFeatureDialog('extrude'); }
        else if (k === 'r') { e.preventDefault(); s.openFeatureDialog('revolve'); }
        else if (k === 'h' && s.result?.mesh) { e.preventDefault(); s.openFeatureDialog('hole'); }
        else if (k === 'f' && s.result?.mesh) { e.preventDefault(); s.openFeatureDialog('fillet'); }
      } else if (s.kind === 'assembly') {
        if (k === 'p') { e.preventDefault(); s.open({ kind: 'place' }); }
        else if (k === 'j') { e.preventDefault(); asmActions.openJoint(); }
      } else if (k === 'd') { e.preventDefault(); s.setTool('drwDim'); }
    };
    window.addEventListener('keydown', onKey);
    const onBefore = (e: BeforeUnloadEvent) => { const s = useStore.getState(); if (s.dirty || s.docs.some((d) => d.dirty)) e.preventDefault(); };
    window.addEventListener('beforeunload', onBefore);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onBefore); };
  }, []);

  const [drag, setDrag] = useState(false);
  return (
    <div className="app"
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); for (const f of e.dataTransfer.files) openFile(f); }}>
      <Ribbon />
      <main className="work">
        <Browser />
        <section className="center">
          {kind === 'part' && <PartViewport key={active} />}
          {kind === 'assembly' && <AsmViewport key={active} />}
          {kind === 'drawing' && <DrawingView key={active} />}
          <DocTabs />
        </section>
        <PropertyPanel />
      </main>
      <StatusBar />
      <Modals />
      <ConfirmBox />
      <Toast />
      <Loader />
      {drag && <div className="dropzone">Suelta .i3p, .i3a, .i3d, .step, .ipj, .ipt, .iam, .idw, .dwg o .dxf</div>}
    </div>
  );
}
