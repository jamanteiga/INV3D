// Barra «Modo de recorte»: corta el modelo (pieza o ensamblaje) por un plano para ver su interior.
//  · Plano: oculta un lado de un plano XY / XZ / YZ (o libre «*»); el deslizador lo mueve por el modelo.
//  · Franja: solo se ve la rodaja entre dos planos (espesor = valor central).
//  · M (manual): plano por un punto, perpendicular al eje elegido; −X oculta todo lo que queda en −X, +X lo de +X.
//  · Planos con «c»: la cara cortada se rellena (tapa). R invierte el lado oculto. × quita el recorte.
import { useEffect, useRef, useState } from 'react';
import { useStore, CLIP0, type ClipTool, type ClipDir, type ClipPlaneName } from '../core/store';
import { activeView } from './view3d';

const PLANES: ClipPlaneName[] = ['XYc', 'XZc', 'YZc', 'XY', 'XZ', 'YZ', '*'];
const PLANE_TIP: Record<ClipPlaneName, string> = {
  XYc: 'Plano XY con la cara cortada rellena', XZc: 'Plano XZ con la cara cortada rellena', YZc: 'Plano YZ con la cara cortada rellena',
  XY: 'Plano XY (solo recorte)', XZ: 'Plano XZ (solo recorte)', YZ: 'Plano YZ (solo recorte)', '*': 'Plano libre: por un punto de una cara y su normal',
};
const DIRS: ClipDir[] = ['-x', '+x', '-y', '+y', '-z', '+z'];
const r2 = (x: number) => (Math.round(x * 100) / 100).toFixed(2);

/** Iconos de los modos (plano y franja) */
const IcoPlane = () => <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="3" y="6" width="12" height="7" /><path d="M9 2v14" strokeWidth="2" /></svg>;
const IcoSlab = () => <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="3" y="6" width="12" height="7" /><path d="M7 2v14M11 2v14" strokeWidth="1.6" /><rect x="7" y="6" width="4" height="7" fill="currentColor" fillOpacity=".25" stroke="none" /></svg>;

export default function ClipBar() {
  const ct = useStore((s) => s.clipTool);
  const set = (p: Partial<ClipTool>) => { const c = useStore.getState().clipTool; if (c) useStore.setState({ clipTool: { ...c, ...p } }); };
  const [ptOpen, setPtOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [snap, setSnap] = useState(true);
  const [coord, setCoord] = useState('0.00');
  const [stepTxt, setStepTxt] = useState('100.00');
  const ref = useRef<HTMLDivElement>(null);
  const bb = activeView?.bbox;
  // valor del campo de coordenada: coordenada actual del plano en el eje elegido
  const curCoord = (() => {
    if (!ct || !bb) return 0;
    if (ct.mode === 'manual') {
      const ax = 'xyz'.indexOf(ct.dir[1]), hideNeg = ct.dir[0] === '-' ? !ct.flip : ct.flip;
      const p0 = ct.pt[ax], end = hideNeg ? bb.max.getComponent(ax) : bb.min.getComponent(ax);
      return p0 + ct.mpos * (end - p0);
    }
    if (ct.plane === '*') return 0;
    const ax = ct.plane.startsWith('XY') ? 2 : ct.plane.startsWith('XZ') ? 1 : 0;
    return bb.min.getComponent(ax) + ct.pos * (bb.max.getComponent(ax) - bb.min.getComponent(ax));
  })();
  useEffect(() => { setCoord(r2(curCoord)); }, [curCoord]);
  useEffect(() => { if (ct) setStepTxt(r2(ct.step)); }, [ct?.step]);
  useEffect(() => () => { activeView?.pickPoint && setPicking(false); }, []);
  if (!ct) return null;
  const M = ct.mode === 'manual';
  const axisLen = (() => {
    if (!bb) return 1;
    if (M) return Math.max(1e-6, bb.max.getComponent('xyz'.indexOf(ct.dir[1])) - bb.min.getComponent('xyz'.indexOf(ct.dir[1])));
    if (ct.plane === '*') return Math.max(1e-6, bb.getSize(new (bb.min.constructor as any)()).length());
    const ax = ct.plane.startsWith('XY') ? 2 : ct.plane.startsWith('XZ') ? 1 : 0;
    return Math.max(1e-6, bb.max.getComponent(ax) - bb.min.getComponent(ax));
  })();
  /** Flechas: desplazan el plano el valor del paso (− / +) */
  const nudge = (sgn: number) => {
    const d = sgn * ct.step;
    if (M) { const ax = 'xyz'.indexOf(ct.dir[1]); const pt = [...ct.pt] as ClipTool['pt']; pt[ax] = curCoord + d; set({ pt, mpos: 0 }); }
    else set({ pos: Math.min(1, Math.max(0, ct.pos + d / axisLen)) });
  };
  /** Coordenada escrita a mano: coloca el plano en esa coordenada del eje */
  const applyCoord = () => {
    const v = parseFloat(coord.replace(',', '.')); if (!isFinite(v) || !bb) return;
    if (M) { const ax = 'xyz'.indexOf(ct.dir[1]); const pt = [...ct.pt] as ClipTool['pt']; pt[ax] = v; set({ pt, mpos: 0 }); }
    else if (ct.plane !== '*') { const ax = ct.plane.startsWith('XY') ? 2 : ct.plane.startsWith('XZ') ? 1 : 0; set({ pos: Math.min(1, Math.max(0, (v - bb.min.getComponent(ax)) / axisLen)) }); }
  };
  const pick = () => {
    if (!activeView) return;
    setPicking(true);
    activeView.pickPoint(snap, (p, n) => {
      setPicking(false);
      const c = useStore.getState().clipTool; if (!c) return;
      if (c.mode === 'manual') useStore.setState({ clipTool: { ...c, pt: p, normal: n, mpos: 0 } });
      else if (c.plane === '*') useStore.setState({ clipTool: { ...c, pt: p, normal: n, pos: 0.5 } });
      else {
        const ax = c.plane.startsWith('XY') ? 2 : c.plane.startsWith('XZ') ? 1 : 0, b = activeView!.bbox;
        useStore.setState({ clipTool: { ...c, pt: p, pos: Math.min(1, Math.max(0, (p[ax] - b.min.getComponent(ax)) / Math.max(1e-6, b.max.getComponent(ax) - b.min.getComponent(ax)))) } });
      }
    });
  };
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <div className="clipbar" ref={ref} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="toolbar" aria-label="Modo de recorte">
      <div className="cb-grip" title="Modo de recorte" />
      <div className="cb-col">
        <div className="cb-row">
          <button className={`cb-b ${ct.mode === 'plane' ? 'on' : ''}`} title="Plano de corte: oculta un lado" onClick={() => set({ mode: 'plane', plane: ct.plane })}><IcoPlane /></button>
          <button className={`cb-b ${ct.mode === 'slab' ? 'on' : ''}`} title="Franja: solo se ve la rodaja entre dos planos (espesor = valor central)" onClick={() => set({ mode: 'slab' })}><IcoSlab /></button>
          <button className={`cb-b ${M ? 'on' : ''}`} title="Manual: plano por un punto, perpendicular al eje; −X oculta lo que queda en −X" onClick={() => set({ mode: 'manual', mpos: 0 })}>M</button>
        </div>
        <div className="cb-row">
          <button className="cb-x" title="Quitar el recorte y cerrar" onClick={() => { activeView?.pickPoint && setPicking(false); useStore.setState({ clipTool: null }); }}>✕</button>
          <input className="cb-slider" type="range" min={0} max={1000} disabled={M} value={Math.round(ct.pos * 1000)} onChange={(e) => set({ pos: +e.target.value / 1000 })} title="Posición del plano en el modelo" />
          <span className="cb-pct">{M ? '0%' : pct(ct.pos)}</span>
        </div>
      </div>
      <div className="cb-sep" />
      <div className="cb-col">
        <div className="cb-row">
          <select className="cb-sel" value={ct.plane} disabled={false} onChange={(e) => set({ plane: e.target.value as ClipPlaneName, pos: e.target.value === '*' ? 0.5 : ct.pos })} title={PLANE_TIP[ct.plane]}>
            {PLANES.map((p) => <option key={p} value={p} title={PLANE_TIP[p]}>{p}</option>)}
          </select>
          {DIRS.map((d) => <button key={d} className={`cb-b cb-d ${M && ct.dir === d ? 'on' : ''}`} disabled={!M} title={`Ocultar todo lo que queda en ${d.toUpperCase()} del plano`} onClick={() => set({ dir: d, mpos: 0, flip: false, pt: (() => { const pt = [...ct.pt] as ClipTool['pt']; return pt; })() })}>{d}</button>)}
          <button className={`cb-b cb-d ${ct.flip ? 'on' : ''}`} disabled={ct.mode === 'slab'} title="R: invierte el lado que se oculta" onClick={() => set({ flip: !ct.flip })}>R</button>
        </div>
        <div className="cb-row">
          <input className="cb-num" value={coord} disabled={!M && ct.plane === '*'} title="Coordenada del plano (mm) · Intro para aplicar" onChange={(e) => setCoord(e.target.value)} onBlur={applyCoord} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') applyCoord(); }} />
          <div className="cb-ptwrap">
            <button className={`cb-b cb-pt ${ptOpen || picking ? 'on' : ''}`} title="Punto 3D: elige en el modelo el punto (y la cara) por donde pasa el plano" onClick={() => setPtOpen(!ptOpen)}>⌖</button>
            {ptOpen && (
              <div className="cb-pop" role="dialog" aria-label="Punto 3D">
                <div className="cb-ttl">Punto 3D</div>
                <label className="cb-r"><input type="radio" checked={!snap} onChange={() => setSnap(false)} /> Sobre cara</label>
                <label className="cb-r"><input type="radio" checked={snap} onChange={() => setSnap(true)} /> Vértice</label>
                <div className="cb-xyz">
                  {(['X', 'Y', 'Z'] as const).map((L, i) => (
                    <label key={L}>{L} <input className="cb-num" type="number" step="any" value={ct.pt[i]} onChange={(e) => { const pt = [...ct.pt] as ClipTool['pt']; pt[i] = parseFloat(e.target.value) || 0; set({ pt, mpos: 0 }); }} /> mm</label>
                  ))}
                </div>
                <div className="cb-prow">
                  <button className="btn sm" onClick={pick}>{picking ? 'Haz clic en el modelo…' : 'Elegir en el modelo'}</button>
                  <span style={{ flex: 1 }} />
                  <button className="btn sm primary" onClick={() => setPtOpen(false)}>Aceptar</button>
                </div>
                <p className="muted" style={{ fontSize: 11, margin: 0 }}>Clic en una cara: el plano pasa por ese punto{ct.plane === '*' && !M ? ' con la orientación de la cara' : ''}. Esc cancela.</p>
              </div>
            )}
          </div>
          <button className="cb-arrow" title="Mover el plano hacia − el valor del paso" onClick={() => nudge(-1)}>⬅</button>
          <input className="cb-num" value={stepTxt} title="Paso de las flechas y espesor de la franja (mm)" onChange={(e) => setStepTxt(e.target.value)}
            onBlur={() => { const v = parseFloat(stepTxt.replace(',', '.')); if (v > 0) set({ step: v }); else setStepTxt(r2(ct.step)); }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          <button className="cb-arrow" title="Mover el plano hacia + el valor del paso" onClick={() => nudge(1)}>➡</button>
          <input className="cb-slider" type="range" min={0} max={1000} disabled={!M} value={Math.round(ct.mpos * 1000)} onChange={(e) => set({ mpos: +e.target.value / 1000 })} title="Modo M: desplaza el plano desde el punto (0 %) hasta el final del modelo (100 %)" />
          <span className="cb-pct">{M ? pct(ct.mpos) : '0%'}</span>
        </div>
      </div>
      <button className="cb-eye" title={ct.show ? 'Ocultar el contorno del plano' : 'Mostrar el contorno del plano'} onClick={() => set({ show: !ct.show })}>{ct.show ? '◫' : '□'}</button>
    </div>
  );
}

/** Abre o cierra el modo de recorte */
export function toggleClipTool() {
  const s = useStore.getState();
  if (s.clipTool) { useStore.setState({ clipTool: null }); return; }
  const b = activeView?.bbox, c = b && !b.isEmpty() ? b.getCenter(new (b.min.constructor as any)()) : null;
  useStore.setState({ clipTool: { ...CLIP0, pt: c ? [c.x, c.y, c.z] : [0, 0, 0] }, clip: '' });
}
