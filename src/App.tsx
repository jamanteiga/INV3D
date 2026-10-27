import { useEffect, useState } from 'react';
import { useStore, activeSketch, startCad } from './core/store';
import Ribbon, { confirmDiscard } from './ui/Ribbon';
import Browser from './ui/Browser';
import Viewport from './ui/Viewport';
import { PropertyPanel, Modals } from './ui/Panels';
import { saveDoc, openFile } from './core/files';
import { newDoc } from './core/doc';
import { fmt } from './core/expr';

function StatusBar() {
  const s = useStore();
  const sk = activeSketch(s);
  const msg = s.tool === 'pickPlane' ? 'Selecciona un plano de origen o una cara plana para el boceto'
    : s.tool === 'line' ? 'Línea: clic en puntos sucesivos · cerrar en el primer punto crea un contorno · doble clic o Esc termina'
    : s.tool === 'rect' ? 'Rectángulo: clic en dos esquinas opuestas'
    : s.tool === 'circle' ? 'Círculo: clic en el centro y después en el radio'
    : s.tool === 'npoly' ? 'Polígono: clic en el centro y después en un vértice'
    : s.tool === 'pickEdges' ? 'Selecciona aristas en la pantalla'
    : sk ? `Editando ${sk.name}` : 'Preparado';
  return (
    <footer className="status">
      <span className="st-msg">{msg}</span>
      <span className="grow" />
      {s.cursor && s.mode === 'sketch' && <span className="st-item mono">X {fmt(s.cursor[0], 2)} · Y {fmt(s.cursor[1], 2)} mm</span>}
      {s.busy && <span className="st-item">Regenerando…</span>}
      {!s.busy && s.result && <span className="st-item">{fmt(s.result.ms, 0)} ms</span>}
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
        {s.oc === 'error' ? (
          <p className="errtxt">No se pudo cargar el núcleo geométrico: {s.ocError}</p>
        ) : (<>
          <p>Cargando el núcleo geométrico OpenCascade (23 MB, solo la primera vez)…</p>
          <div className="bar"><div style={{ width: `${Math.max(6, s.ocProgress * 100)}%` }} /></div>
        </>)}
      </div>
    </div>
  );
}

export default function App() {
  useEffect(() => { startCad(); }, []);

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
        else if (k === 'o') { e.preventDefault(); confirmDiscard().then((ok) => { if (ok) openFile(); }); }
        else if (k === 'n') { e.preventDefault(); confirmDiscard().then((ok) => ok && s.load(newDoc(), 'Pieza1.i3p')); }
        else if (k === 'k' && e.shiftKey) { e.preventDefault(); s.openFeatureDialog('chamfer'); }
        return;
      }
      if (s.confirmBox || (s.dialog && !('draft' in s.dialog))) return;
      if (e.key === 'Escape') {
        if (s.menuOpen) return s.set({ menuOpen: false });
        if (s.dialog) return s.closeDialog();
        if (s.tool) return s.setTool(null);
        if (s.mode === 'sketch') return s.finishSketch();
        return s.set({ selFeature: null });
      }
      if (e.key === 'F6') { e.preventDefault(); return s.setView('home'); }
      if (e.key === 'Home') return s.setView('fit');
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.mode === 'sketch' && s.selEntity) return s.deleteEntity(s.selEntity);
        if (s.mode === 'model' && s.selFeature && !s.dialog) return s.deleteFeature(s.selFeature);
      }
      if (s.mode === 'sketch') {
        const map: Record<string, typeof s.tool> = { l: 'line', r: 'rect', c: 'circle', p: 'npoly' };
        if (map[k]) { e.preventDefault(); s.setTool(map[k]); }
        return;
      }
      if (s.dialog) return;
      // preventDefault: la tecla no debe llegar al campo que recibe el foco al abrir el diálogo
      if (k === 's') { e.preventDefault(); s.setTool('pickPlane'); }
      else if (k === 'e') { e.preventDefault(); s.openFeatureDialog('extrude'); }
      else if (k === 'r') { e.preventDefault(); s.openFeatureDialog('revolve'); }
      else if (k === 'f' && s.result?.mesh) { e.preventDefault(); s.openFeatureDialog('fillet'); }
    };
    window.addEventListener('keydown', onKey);
    const onBefore = (e: BeforeUnloadEvent) => { if (useStore.getState().dirty) { e.preventDefault(); } };
    window.addEventListener('beforeunload', onBefore);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onBefore); };
  }, []);

  const [drag, setDrag] = useState(false);
  return (
    <div className="app"
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) confirmDiscard().then((ok) => { if (ok) openFile(f); }); }}>
      <Ribbon />
      <main className="work">
        <Browser />
        <Viewport />
        <PropertyPanel />
      </main>
      <StatusBar />
      <Modals />
      <ConfirmBox />
      <Toast />
      <Loader />
      {drag && <div className="dropzone">Suelta un .i3p, .step, .ipj, .ipt, .iam, .idw o .dwg</div>}
    </div>
  );
}
