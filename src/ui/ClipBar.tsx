// Barra «Modo de recorte»: corta el modelo (pieza o ensamblaje) por planos para ver su interior.
//  · Plano (1.er botón): oculta un lado de un plano XY / XZ / YZ o libre «*»; el deslizador de la izquierda lo mueve por el modelo.
//  · Franja (2.º botón): solo se ve la rodaja entre dos planos (espesor = valor del paso).
//  · M (manual): plano perpendicular al eje; −X oculta todo lo que queda en −X, +X lo de +X…
//    El deslizador de la derecha es la parte visible: al 100 % no se oculta nada; al bajar se va ocultando.
//    ⌖ (o Shift+F cara, Shift+G arista, Shift+V vértice) designa en el modelo el punto por el que pasa el plano.
//    Las flechas lo mueven el valor del paso.
//  · Planos con «c»: la cara cortada se rellena (tapa). R invierte el lado oculto. × quita el recorte.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useStore, CLIP0, manualX, manualMpos, type ClipTool, type ClipDir, type ClipPlaneName } from '../core/store';
import { activeView, type PickKind, type PickRes } from './view3d';

type V3 = [number, number, number];
const PLANES: ClipPlaneName[] = ['XYc', 'XZc', 'YZc', 'XY', 'XZ', 'YZ', '*'];
const PLANE_TIP: Record<ClipPlaneName, string> = {
  XYc: 'Plano XY con la cara cortada rellena', XZc: 'Plano XZ con la cara cortada rellena', YZc: 'Plano YZ con la cara cortada rellena',
  XY: 'Plano XY (solo recorte)', XZ: 'Plano XZ (solo recorte)', YZ: 'Plano YZ (solo recorte)', '*': 'Plano libre: por el punto designado y la normal de la cara',
};
const DIRS: ClipDir[] = ['-x', '+x', '-y', '+y', '-z', '+z'];
const r2 = (x: number) => (Math.round(x * 100) / 100).toFixed(2);
const axOfPlane = (p: ClipPlaneName) => (p.startsWith('XY') ? 2 : p.startsWith('XZ') ? 1 : 0);
const KIND_NAME: Partial<Record<PickKind, string>> = { auto: 'cara, arista o vértice', face: 'una cara', edge: 'una arista', vertex: 'un vértice' };
const ext = () => { const b = activeView?.bbox; return b && !b.isEmpty() ? { mn: b.min.toArray(), mx: b.max.toArray() } : { mn: [0, 0, 0], mx: [0, 0, 0] }; };

/** Flechas del paso (dibujadas, no dependen de la fuente) y cruz del punto 3D */
const ArrowL = () => <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden><path d="M1 7l7-6v4h11v4H8v4z" fill="currentColor" /></svg>;
const ArrowR = () => <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden><path d="M19 7l-7-6v4H1v4h11v4z" fill="currentColor" /></svg>;
const Cross = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden><circle cx="7" cy="7" r="3.2" /><path d="M7 0.5v4M7 9.5v4M0.5 7h4M9.5 7h4" /><circle cx="7" cy="7" r=".9" fill="currentColor" stroke="none" /></svg>;
const IcoPlane = () => <svg width="18" height="16" viewBox="0 0 18 16" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="3.5" y="5.5" width="11" height="5" /><path d="M9 1.5v13" strokeWidth="1.6" /></svg>;
const IcoSlab = () => <svg width="18" height="16" viewBox="0 0 18 16" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="3.5" y="5.5" width="11" height="5" /><path d="M7 1.5v13M11 1.5v13" strokeWidth="1.4" /><rect x="7" y="5.5" width="4" height="5" fill="currentColor" fillOpacity=".22" stroke="none" /></svg>;

/** Coordenada del plano vigente en su eje */
function planeCoord(ct: ClipTool, bb: THREE.Box3) {
  if (ct.mode === 'manual') { const { mn, mx } = ext(); return manualX(ct, mn, mx); }
  if (ct.plane === '*') return 0;
  const ax = axOfPlane(ct.plane);
  return bb.min.getComponent(ax) + ct.pos * (bb.max.getComponent(ax) - bb.min.getComponent(ax));
}

/** Aplica un punto (y normal) designado al recorte vigente */
function applyPoint(p: V3, n?: V3) {
  const c = useStore.getState().clipTool, bb = activeView?.bbox; if (!c) return;
  if (c.mode === 'manual') { const { mn, mx } = ext(), ax = 'xyz'.indexOf(c.dir[1]); useStore.setState({ clipTool: { ...c, pt: p, ptSet: true, mpos: manualMpos(c, mn, mx, p[ax]) } }); }
  else if (c.plane === '*') useStore.setState({ clipTool: { ...c, pt: p, normal: n ?? c.normal, pos: 0.5 } });
  else if (bb) {
    const ax = axOfPlane(c.plane), L = Math.max(1e-6, bb.max.getComponent(ax) - bb.min.getComponent(ax));
    useStore.setState({ clipTool: { ...c, pt: p, pos: Math.min(1, Math.max(0, (p[ax] - bb.min.getComponent(ax)) / L)) } });
  }
}

export default function ClipBar() {
  const ct = useStore((s) => s.clipTool);
  const set = (p: Partial<ClipTool>) => { const c = useStore.getState().clipTool; if (c) useStore.setState({ clipTool: { ...c, ...p } }); };
  /** Modo M: cambia dirección o R manteniendo el plano en el punto designado (o al 100 % si aún no hay punto) */
  const setM = (p: Partial<ClipTool>) => {
    const c = useStore.getState().clipTool; if (!c) return;
    const { mn, mx } = ext(), X = manualX(c, mn, mx), nc = { ...c, ...p };
    const ax = 'xyz'.indexOf(nc.dir[1]);
    const mpos = nc.ptSet ? manualMpos(nc, mn, mx, p.dir ? nc.pt[ax] : X) : 1;
    useStore.setState({ clipTool: { ...nc, mpos } });
  };
  // Designación del punto en el modelo: ⌖ = automático (cara, arista o vértice); Shift+F cara, Shift+G arista, Shift+V vértice; Esc cancela
  const [picking, setPicking] = useState<PickKind | null>(null);
  useEffect(() => {
    if (!ct) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === 'Escape') { setPicking((k) => { if (k) e.stopPropagation(); return null; }); return; }
      if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      const k = ({ KeyF: 'face', KeyG: 'edge', KeyV: 'vertex' } as Record<string, PickKind>)[e.code]; if (!k) return;
      e.preventDefault(); e.stopPropagation(); setPicking(k);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [!ct]);
  useEffect(() => {
    const V = activeView; if (!picking || !V || !ct) return;
    const c = V.bbox.getCenter(new THREE.Vector3()); V.refPoint.copy(c);
    V.startPick(picking, 'mid', (r: PickRes) => {
      applyPoint([r.p.x, r.p.y, r.p.z], r.n ? [r.n.x, r.n.y, r.n.z].map((x) => Math.round(x * 1e4) / 1e4) as V3 : undefined);
      setPicking(null);
    });
    return () => V.stopPick();
  }, [picking, !ct]);
  const [coord, setCoord] = useState('0.00');
  const [stepTxt, setStepTxt] = useState('100.00');
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const bb = activeView?.bbox;
  const curCoord = ct && bb ? planeCoord(ct, bb) : 0;
  useEffect(() => { setCoord(r2(curCoord)); }, [curCoord]);
  useEffect(() => { if (ct) setStepTxt(r2(ct.step)); }, [ct?.step]);
  useEffect(() => { if (!ct) setPicking(null); }, [!ct]);
  if (!ct) return null;
  const M = ct.mode === 'manual', S = ct.mode === 'slab';
  const axisLen = (() => {
    if (!bb) return 1;
    if (ct.plane === '*') return Math.max(1e-6, bb.getSize(new THREE.Vector3()).length());
    const ax = axOfPlane(ct.plane); return Math.max(1e-6, bb.max.getComponent(ax) - bb.min.getComponent(ax));
  })();
  /** Flechas: desplazan el plano el valor del paso (− / +) */
  const nudge = (sgn: number) => {
    const d = sgn * ct.step;
    if (M) { const { mn, mx } = ext(); set({ mpos: manualMpos(ct, mn, mx, curCoord + d) }); }
    else set({ pos: Math.min(1, Math.max(0, ct.pos + d / axisLen)) });
  };
  /** Coordenada escrita a mano: lleva el plano a esa coordenada del eje */
  const applyCoord = () => {
    const v = parseFloat(coord.replace(',', '.')); if (!isFinite(v) || !bb) { setCoord(r2(curCoord)); return; }
    if (M) { const { mn, mx } = ext(); set({ mpos: manualMpos(ct, mn, mx, v) }); }
    else if (ct.plane !== '*') { const ax = axOfPlane(ct.plane); set({ pos: Math.min(1, Math.max(0, (v - bb.min.getComponent(ax)) / axisLen)) }); }
  };
  /** Arrastre de la barra por el asa */
  const grip = (e: React.PointerEvent) => {
    const el = ref.current, par = el?.offsetParent as HTMLElement | null; if (!el || !par) return;
    e.preventDefault();
    const r0 = el.getBoundingClientRect(), pr = par.getBoundingClientRect(), dx = e.clientX - r0.left, dy = e.clientY - r0.top;
    const mv = (ev: PointerEvent) => setPos({ x: Math.min(Math.max(0, ev.clientX - pr.left - dx), pr.width - r0.width), y: Math.min(Math.max(0, ev.clientY - pr.top - dy), pr.height - r0.height) });
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const close = () => { activeView?.stopPick(); setPicking(null); useStore.setState({ clipTool: null }); };

  return (
    <div className="clipbar" ref={ref} style={pos ? { left: pos.x, top: pos.y } : undefined}
      onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="toolbar" aria-label="Modo de recorte">
      <div className="cb-left">
        <div className="cb-grip" title="Arrastrar la barra" onPointerDown={grip} />
        <button className="cb-x" title="Quitar el recorte y cerrar la barra" onClick={close}>✕</button>
      </div>
      <div className="cb-col">
        <div className="cb-row">
          <button className={`cb-b ${ct.mode === 'plane' ? 'on' : ''}`} title="Plano de corte: oculta un lado del plano" onClick={() => set({ mode: 'plane' })}><IcoPlane /></button>
          <button className={`cb-b ${S ? 'on' : ''}`} title="Franja: solo se ve la rodaja entre dos planos (espesor = paso)" onClick={() => set({ mode: 'slab' })}><IcoSlab /></button>
          <button className={`cb-b ${M ? 'on' : ''}`} title="M: plano perpendicular al eje elegido; −X oculta lo que queda en −X. Deslizador derecho al 100 % = nada oculto" onClick={() => { set({ mode: 'manual' }); setM({}); }}>M</button>
        </div>
        <div className="cb-row">
          <div className="cb-tick">
            <input className="cb-slider" type="range" min={0} max={1000} disabled={M} value={M ? 0 : Math.round(ct.pos * 1000)} onChange={(e) => set({ pos: +e.target.value / 1000 })} title="Posición del plano a lo largo del modelo" />
            <div className="cb-ticks">{[0, 1, 2, 3, 4, 5].map((i) => <i key={i} />)}</div>
          </div>
          <span className="cb-pct">{M ? '0%' : pct(ct.pos)}</span>
        </div>
      </div>
      <div className="cb-sep" />
      <div className="cb-col">
        <div className="cb-row">
          <select className="cb-sel" value={ct.plane} disabled={M} onChange={(e) => set({ plane: e.target.value as ClipPlaneName, pos: e.target.value === '*' ? 0.5 : ct.pos })} title={PLANE_TIP[ct.plane]}>
            {PLANES.map((p) => <option key={p} value={p} title={PLANE_TIP[p]}>{p}</option>)}
          </select>
          {DIRS.map((d) => <button key={d} className={`cb-b cb-d ${M && ct.dir === d ? 'on' : ''}`} disabled={!M} title={`Ocultar todo lo que queda en ${d.toUpperCase()} del plano`} onClick={() => setM({ dir: d, flip: false })}>{d}</button>)}
          <button className={`cb-b cb-d ${ct.flip ? 'on' : ''}`} disabled={S} title="R: invierte el lado que se oculta" onClick={() => (M ? setM({ flip: !ct.flip }) : set({ flip: !ct.flip }))}>R</button>
        </div>
        <div className="cb-row">
          <input className="cb-num" value={coord} disabled={!M && ct.plane === '*'} title="Coordenada del plano en su eje (mm) · Intro aplica" onChange={(e) => setCoord(e.target.value)} onBlur={applyCoord} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') applyCoord(); }} />
          <button className={`cb-b cb-pt ${picking ? 'on' : ''}`} title="Punto 3D: haz clic en una cara, arista o vértice del modelo (Shift+F cara · Shift+G arista · Shift+V vértice · Esc cancela)" onClick={() => setPicking(picking ? null : 'auto')}><Cross /></button>
          <button className="cb-arrow" title="Menos: mueve el plano hacia − el valor del paso" onClick={() => nudge(-1)}><ArrowL /></button>
          <input className="cb-num cb-step" value={stepTxt} title="Paso de las flechas y espesor de la franja (mm)" onChange={(e) => setStepTxt(e.target.value)}
            onBlur={() => { const v = parseFloat(stepTxt.replace(',', '.')); if (v > 0) set({ step: v }); else setStepTxt(r2(ct.step)); }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          <button className="cb-arrow" title="Más: mueve el plano hacia + el valor del paso" onClick={() => nudge(1)}><ArrowR /></button>
          <input className="cb-slider cb-slider-r" type="range" min={0} max={1000} disabled={!M} value={M ? Math.round(ct.mpos * 1000) : 1000} onChange={(e) => set({ mpos: +e.target.value / 1000 })} title="Modo M: parte visible. 100 % = no se oculta nada; al deslizar a la izquierda se va ocultando" />
          <span className="cb-pct">{M ? pct(ct.mpos) : '100%'}</span>
        </div>
      </div>
      {picking && <div className="cb-hint">Designa {KIND_NAME[picking]} en el modelo · Shift+F cara · Shift+G arista · Shift+V vértice · Esc cancela</div>}
    </div>
  );
}

/** Abre o cierra el modo de recorte */
export function toggleClipTool() {
  const s = useStore.getState();
  if (s.clipTool) { activeView?.stopPick(); useStore.setState({ clipTool: null }); return; }
  const b = activeView?.bbox, c = b && !b.isEmpty() ? b.getCenter(new THREE.Vector3()) : null;
  useStore.setState({ clipTool: { ...CLIP0, pt: c ? [c.x, c.y, c.z] : [0, 0, 0] }, clip: '' });
}
