// Barra «Modo de recorte»: corta el modelo (pieza o ensamblaje) por planos para ver su interior.
//  · Plano (1.er botón): oculta un lado de un plano XY / XZ / YZ o libre «*»; el deslizador de la izquierda lo mueve por el modelo.
//  · Franja (2.º botón): solo se ve la rodaja entre dos planos (espesor = valor del paso).
//  · M (manual): plano por un punto 3D, perpendicular al eje; −X oculta todo lo que queda en −X, +X lo de +X…
//    Las flechas lo mueven el valor del paso; el deslizador de la derecha lo lleva del punto (0 %) al final del modelo (100 %).
//  · Planos con «c»: la cara cortada se rellena (tapa). R invierte el lado oculto. × quita el recorte.
//  · ⌖ abre la ventana «Punto 3D»: tipo de designación, coordenadas con unidades y desfase, modo Esperar y vector.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useStore, CLIP0, type ClipTool, type ClipDir, type ClipPlaneName } from '../core/store';
import { activeView, type PickKind, type AdvKind, type PickRes } from './view3d';
import { makeEval } from '../core/expr';
import { docParams } from '../core/doc';
import { partEPoints } from '../core/epoints';

type V3 = [number, number, number];
const PLANES: ClipPlaneName[] = ['XYc', 'XZc', 'YZc', 'XY', 'XZ', 'YZ', '*'];
const PLANE_TIP: Record<ClipPlaneName, string> = {
  XYc: 'Plano XY con la cara cortada rellena', XZc: 'Plano XZ con la cara cortada rellena', YZc: 'Plano YZ con la cara cortada rellena',
  XY: 'Plano XY (solo recorte)', XZ: 'Plano XZ (solo recorte)', YZ: 'Plano YZ (solo recorte)', '*': 'Plano libre: por el punto 3D y el vector (o la normal de la cara)',
};
const DIRS: ClipDir[] = ['-x', '+x', '-y', '+y', '-z', '+z'];
const r2 = (x: number) => (Math.round(x * 100) / 100).toFixed(2);
const axOfPlane = (p: ClipPlaneName) => (p.startsWith('XY') ? 2 : p.startsWith('XZ') ? 1 : 0);

const IcoPlane = () => <svg width="18" height="16" viewBox="0 0 18 16" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="3.5" y="5.5" width="11" height="5" /><path d="M9 1.5v13" strokeWidth="1.6" /></svg>;
const IcoSlab = () => <svg width="18" height="16" viewBox="0 0 18 16" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="3.5" y="5.5" width="11" height="5" /><path d="M7 1.5v13M11 1.5v13" strokeWidth="1.4" /><rect x="7" y="5.5" width="4" height="5" fill="currentColor" fillOpacity=".22" stroke="none" /></svg>;

/** Coordenada de un punto en el eje del plano vigente */
function planeCoord(ct: ClipTool, bb: THREE.Box3) {
  if (ct.mode === 'manual') {
    const ax = 'xyz'.indexOf(ct.dir[1]), hideNeg = ct.dir[0] === '-' ? !ct.flip : ct.flip;
    const p0 = ct.pt[ax], end = hideNeg ? bb.max.getComponent(ax) : bb.min.getComponent(ax);
    return p0 + ct.mpos * (end - p0);
  }
  if (ct.plane === '*') return 0;
  const ax = axOfPlane(ct.plane);
  return bb.min.getComponent(ax) + ct.pos * (bb.max.getComponent(ax) - bb.min.getComponent(ax));
}

/** Aplica un punto (y normal) designado al recorte vigente */
function applyPoint(p: V3, n?: V3) {
  const c = useStore.getState().clipTool, bb = activeView?.bbox; if (!c) return;
  if (c.mode === 'manual') useStore.setState({ clipTool: { ...c, pt: p, normal: n ?? c.normal, mpos: 0 } });
  else if (c.plane === '*') useStore.setState({ clipTool: { ...c, pt: p, normal: n ?? c.normal, pos: 0.5 } });
  else if (bb) {
    const ax = axOfPlane(c.plane), L = Math.max(1e-6, bb.max.getComponent(ax) - bb.min.getComponent(ax));
    useStore.setState({ clipTool: { ...c, pt: p, pos: Math.min(1, Math.max(0, (p[ax] - bb.min.getComponent(ax)) / L)) } });
  }
}

export default function ClipBar() {
  const ct = useStore((s) => s.clipTool);
  const set = (p: Partial<ClipTool>) => { const c = useStore.getState().clipTool; if (c) useStore.setState({ clipTool: { ...c, ...p } }); };
  const [ptOpen, setPtOpen] = useState(false);
  const [coord, setCoord] = useState('0.00');
  const [stepTxt, setStepTxt] = useState('100.00');
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const bb = activeView?.bbox;
  const curCoord = ct && bb ? planeCoord(ct, bb) : 0;
  useEffect(() => { setCoord(r2(curCoord)); }, [curCoord]);
  useEffect(() => { if (ct) setStepTxt(r2(ct.step)); }, [ct?.step]);
  useEffect(() => { if (!ct) setPtOpen(false); }, [!ct]);
  if (!ct) return null;
  const M = ct.mode === 'manual', S = ct.mode === 'slab';
  const axisLen = (() => {
    if (!bb) return 1;
    if (M) { const ax = 'xyz'.indexOf(ct.dir[1]); return Math.max(1e-6, bb.max.getComponent(ax) - bb.min.getComponent(ax)); }
    if (ct.plane === '*') return Math.max(1e-6, bb.getSize(new THREE.Vector3()).length());
    const ax = axOfPlane(ct.plane); return Math.max(1e-6, bb.max.getComponent(ax) - bb.min.getComponent(ax));
  })();
  /** Flechas: desplazan el plano el valor del paso */
  const nudge = (sgn: number) => {
    const d = sgn * ct.step;
    if (M) { const ax = 'xyz'.indexOf(ct.dir[1]); const pt = [...ct.pt] as V3; pt[ax] = curCoord + d; set({ pt, mpos: 0 }); }
    else set({ pos: Math.min(1, Math.max(0, ct.pos + d / axisLen)) });
  };
  /** Coordenada escrita a mano: lleva el plano a esa coordenada del eje */
  const applyCoord = () => {
    const v = parseFloat(coord.replace(',', '.')); if (!isFinite(v) || !bb) { setCoord(r2(curCoord)); return; }
    if (M) { const ax = 'xyz'.indexOf(ct.dir[1]); const pt = [...ct.pt] as V3; pt[ax] = v; set({ pt, mpos: 0 }); }
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
  const close = () => { activeView?.stopPick(); setPtOpen(false); useStore.setState({ clipTool: null }); };

  return (
    <>
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
            <button className={`cb-b ${M ? 'on' : ''}`} title="M: plano por un punto 3D, perpendicular al eje elegido (−X oculta lo que queda en −X)" onClick={() => set({ mode: 'manual', mpos: 0 })}>M</button>
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
            {DIRS.map((d) => <button key={d} className={`cb-b cb-d ${M && ct.dir === d ? 'on' : ''}`} disabled={!M} title={`Ocultar todo lo que queda en ${d.toUpperCase()} del plano`} onClick={() => set({ dir: d, mpos: 0, flip: false })}>{d}</button>)}
            <button className={`cb-b cb-d ${ct.flip ? 'on' : ''}`} disabled={S} title="R: invierte el lado que se oculta" onClick={() => set({ flip: !ct.flip })}>R</button>
          </div>
          <div className="cb-row">
            <input className="cb-num" value={coord} disabled={!M && ct.plane === '*'} title="Coordenada del plano en su eje (mm) · Intro aplica" onChange={(e) => setCoord(e.target.value)} onBlur={applyCoord} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') applyCoord(); }} />
            <button className={`cb-b cb-pt ${ptOpen ? 'on' : ''}`} title="Punto 3D: por dónde pasa el plano" onClick={() => setPtOpen(!ptOpen)}>⌖</button>
            <button className="cb-arrow" title="Mover el plano hacia − el valor del paso" onClick={() => nudge(-1)}>🡄</button>
            <input className="cb-num cb-step" value={stepTxt} title="Paso de las flechas y espesor de la franja (mm)" onChange={(e) => setStepTxt(e.target.value)}
              onBlur={() => { const v = parseFloat(stepTxt.replace(',', '.')); if (v > 0) set({ step: v }); else setStepTxt(r2(ct.step)); }}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
            <button className="cb-arrow" title="Mover el plano hacia + el valor del paso" onClick={() => nudge(1)}>🡆</button>
            <input className="cb-slider cb-slider-r" type="range" min={0} max={1000} disabled={!M} value={M ? Math.round(ct.mpos * 1000) : 0} onChange={(e) => set({ mpos: +e.target.value / 1000 })} title="Modo M: lleva el plano desde el punto (0 %) hasta el final del modelo (100 %)" />
            <span className="cb-pct">{M ? pct(ct.mpos) : '0%'}</span>
          </div>
        </div>
      </div>
      {ptOpen && <Point3D at={(() => { const el = ref.current, W = (el?.offsetParent as HTMLElement | null)?.clientWidth ?? 1200, w = 330; if (!el) return { x: 8, y: 130 }; const right = el.offsetLeft + el.offsetWidth + 8; return right + w <= W ? { x: right, y: el.offsetTop } : { x: Math.max(8, W - w - 8), y: el.offsetTop + el.offsetHeight + 6 }; })()} onClose={() => setPtOpen(false)} />}
    </>
  );
}

// ---------------- Ventana «Punto 3D» ----------------
const UNITS: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };
const KINDS: [PickKind, string, string][] = [
  ['cursor3d', 'Cursor 3D', 'Punto bajo el cursor sobre el modelo; fuera de él, en el plano de la pantalla'],
  ['vertex', 'Vértice', 'Vértice (esquina) de una arista más cercano al cursor'],
  ['face', 'Sobre Cara', 'Punto sobre una cara (con su normal)'],
  ['pcon', 'Pcon', 'Punto de control: vértices, puntos medios de aristas y centros de arcos'],
  ['aux', 'Punto Auxiliar', 'Origen, centro del modelo, puntos de trabajo y ePoints'],
  ['cursor2d', 'Cursor 2D', 'Punto en el plano de la pantalla que pasa por el punto actual'],
  ['edge', 'Sobre Arista', 'Punto sobre la arista más cercana al cursor'],
];
const ADV: [AdvKind, string][] = [['mid', 'Punto medio de arista'], ['center', 'Centro de arco o circunferencia'], ['facec', 'Centro de cara'], ['two', 'Punto medio entre dos puntos'], ['bbox', 'Centro del modelo'], ['origin', 'Origen (0, 0, 0)']];

/** Puntos auxiliares disponibles */
function auxPoints(): { id: string; name: string; p: V3; n?: V3 }[] {
  const s = useStore.getState(), out: { id: string; name: string; p: V3; n?: V3 }[] = [{ id: 'o', name: 'Origen', p: [0, 0, 0] }];
  const bb = activeView?.bbox; if (bb && !bb.isEmpty()) { const c = bb.getCenter(new THREE.Vector3()); out.push({ id: 'c', name: 'Centro del modelo', p: [c.x, c.y, c.z] }); }
  const doc: any = (s as any).doc;
  if (doc && Array.isArray(doc.features)) {
    try {
      const ev = makeEval(docParams(doc));
      for (const f of doc.features) if (f.type === 'workpoint' && !f.suppressed) { const p = f.origin.map((x: string) => ev(x)) as V3; if (p.every(isFinite)) out.push({ id: 'w' + f.id, name: f.name, p }); }
    } catch { /* expresión inválida */ }
    try { for (const e of partEPoints(doc)) if (e.kind !== 'composite') out.push({ id: 'e' + e.id, name: `ePoint ${e.name}`, p: e.point, n: e.dir }); } catch { /* sin ePoints */ }
  }
  return out;
}

/** Campo numérico con unidades (el valor interno siempre en mm) */
function NumU({ mm, unit, onMm, disabled }: { mm: number; unit: string; onMm: (v: number) => void; disabled?: boolean }) {
  const [txt, setTxt] = useState(r2(mm / UNITS[unit]));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setTxt(r2(mm / UNITS[unit])); }, [mm, unit, focus]);
  const commit = () => { const v = parseFloat(txt.replace(',', '.')); if (isFinite(v)) onMm(v * UNITS[unit]); else setTxt(r2(mm / UNITS[unit])); };
  return <input className="p3-num" value={txt} disabled={disabled} onFocus={() => setFocus(true)} onChange={(e) => setTxt(e.target.value)}
    onBlur={() => { setFocus(false); commit(); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

function Point3D({ onClose, at }: { onClose: () => void; at: { x: number; y: number } }) {
  const ct0 = useRef(useStore.getState().clipTool);
  const [kind, setKind] = useState<PickKind>('vertex');
  const [adv, setAdv] = useState<AdvKind>('mid');
  const [aux, setAux] = useState('o');
  const [p, setP] = useState<V3>([...(ct0.current?.pt ?? [0, 0, 0])] as V3);
  const [off, setOff] = useState<V3>([0, 0, 0]);
  const [un, setUn] = useState<string[]>(['mm', 'mm', 'mm']);
  const [uo, setUo] = useState<string[]>(['mm', 'mm', 'mm']);
  const [wait, setWait] = useState(false);
  const [vec, setVec] = useState<V3>([...(ct0.current?.normal ?? [0, 0, 1])] as V3);
  const [vecOpen, setVecOpen] = useState(false);
  const [vecPick, setVecPick] = useState(false);
  const [last, setLast] = useState<string>('');
  const [pos, setPos] = useState<{ x: number; y: number }>(at);
  const waitRef = useRef(wait); waitRef.current = wait;
  const offRef = useRef(off); offRef.current = off;
  const auxList = auxPoints();
  const total = (q: V3, o: V3 = off) => q.map((v, i) => Math.round((v + o[i]) * 1000) / 1000) as V3;

  // marca del punto elegido y punto de referencia del cursor 2D
  useEffect(() => { activeView?.showPoint(total(p)); if (activeView) activeView.refPoint.set(...total(p)); }, [p, off]);
  useEffect(() => () => { activeView?.stopPick(); activeView?.showPoint(null); }, []);

  const accept = (q: V3 = p, n?: V3) => {
    const c = useStore.getState().clipTool;
    const nn = n ?? (c?.plane === '*' || c?.mode === 'manual' ? vec : undefined);
    applyPoint(total(q, offRef.current), nn); onClose();
  };
  const cancel = () => { const c = ct0.current, cur = useStore.getState().clipTool; if (c && cur) useStore.setState({ clipTool: { ...cur, pt: c.pt, normal: c.normal, pos: c.pos, mpos: c.mpos } }); onClose(); };

  // designación en el modelo
  useEffect(() => {
    const V = activeView; if (!V) return;
    if (vecPick) {
      V.startPick('face', 'mid', (r: PickRes) => { if (r.n) setVec([r.n.x, r.n.y, r.n.z].map((x) => Math.round(x * 1e4) / 1e4) as V3); setVecPick(false); });
      return () => V.stopPick();
    }
    if (kind === 'aux' || (kind === 'adv' && (adv === 'bbox' || adv === 'origin'))) { V.stopPick(); return; }
    V.startPick(kind, adv, (r: PickRes) => {
      const q: V3 = [r.p.x, r.p.y, r.p.z], n = r.n ? ([r.n.x, r.n.y, r.n.z] as V3) : undefined;
      setP(q); setLast(r.what); if (n && kind !== 'cursor2d') setVec(n.map((x) => Math.round(x * 1e4) / 1e4) as V3);
      if (!waitRef.current) accept(q, n);
      else { const c = useStore.getState().clipTool; applyPoint(total(q, offRef.current), c?.plane === '*' ? n : undefined); } // vista previa
    });
    return () => V.stopPick();
  }, [kind, adv, vecPick]);

  // puntos sin clic: auxiliares, centro del modelo, origen
  useEffect(() => {
    if (kind === 'aux') { const a = auxList.find((x) => x.id === aux) ?? auxList[0]; if (a) { setP(a.p); setLast(a.name); if (a.n) setVec(a.n); } }
    if (kind === 'adv' && adv === 'origin') { setP([0, 0, 0]); setLast('Origen'); }
    if (kind === 'adv' && adv === 'bbox') { const a = auxList.find((x) => x.id === 'c'); if (a) { setP(a.p); setLast(a.name); } }
  }, [kind, adv, aux]);

  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const x0 = e.clientX - pos.x, y0 = e.clientY - pos.y;
    const mv = (ev: PointerEvent) => setPos({ x: Math.max(0, ev.clientX - x0), y: Math.max(0, ev.clientY - y0) });
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const selOpts = kind === 'aux' ? auxList.map((a) => [a.id, a.name] as [string, string]) : ADV;
  const selVal = kind === 'aux' ? aux : adv;
  const hint = vecPick ? 'Haz clic en una cara para tomar su normal como vector.'
    : kind === 'aux' ? 'Elige el punto auxiliar en la lista.'
    : kind === 'adv' && adv === 'two' ? 'Haz clic en dos puntos: se toma el punto medio.'
    : kind === 'adv' && (adv === 'bbox' || adv === 'origin') ? 'Punto fijo: pulsa Aceptar.'
    : wait ? 'Haz clic en el modelo; los valores se actualizan y esperan a Aceptar.' : 'Haz clic en el modelo: el punto se aplica al momento.';

  return (
    <div className="p3" style={{ left: pos.x, top: pos.y }} role="dialog" aria-label="Punto 3D"
      onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') cancel(); }}>
      <div className="p3-ttl" onPointerDown={drag}>
        <span className="p3-logo">⌖</span><span>Punto 3D</span><span style={{ flex: 1 }} />
        <button className="p3-close" title="Cerrar (Cancelar)" onClick={cancel}>✕</button>
      </div>
      <div className="p3-body">
        <fieldset className="p3-fs">
          <legend>Opciones de punto</legend>
          <div className="p3-grid">
            {KINDS.map(([k, l, t]) => (
              <label key={k} className="p3-r" title={t}><input type="radio" name="p3k" checked={kind === k} onChange={() => setKind(k)} /> {l}</label>
            ))}
            <span />
            <label className="p3-r" title="Designaciones avanzadas"><input type="radio" name="p3k" checked={kind === 'adv'} onChange={() => setKind('adv')} /> Avanzado</label>
            <select className="p3-sel" disabled={kind !== 'adv' && kind !== 'aux'} value={kind === 'adv' || kind === 'aux' ? selVal : ''} onChange={(e) => (kind === 'aux' ? setAux(e.target.value) : setAdv(e.target.value as AdvKind))}>
              {kind !== 'adv' && kind !== 'aux' && <option value="">Seleccione una opción…</option>}
              {selOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </fieldset>
        <fieldset className="p3-fs">
          <legend>Coordenadas</legend>
          {(['X', 'Y', 'Z'] as const).map((L, i) => (
            <div key={L} className="p3-co">
              <span className="p3-l">{L}:</span>
              <NumU mm={p[i]} unit={un[i]} onMm={(v) => { const q = [...p] as V3; q[i] = v; setP(q); setLast('Coordenadas'); }} />
              <select className="p3-u" value={un[i]} onChange={(e) => { const u = [...un]; u[i] = e.target.value; setUn(u); }}>{Object.keys(UNITS).map((u) => <option key={u}>{u}</option>)}</select>
              <span className="p3-plus">+</span>
              <NumU mm={off[i]} unit={uo[i]} onMm={(v) => { const q = [...off] as V3; q[i] = v; setOff(q); }} />
              <select className="p3-u" value={uo[i]} onChange={(e) => { const u = [...uo]; u[i] = e.target.value; setUo(u); }}>{Object.keys(UNITS).map((u) => <option key={u}>{u}</option>)}</select>
            </div>
          ))}
        </fieldset>
        <div className="p3-two">
          <fieldset className="p3-fs p3-modo">
            <legend>Modo</legend>
            <label className="p3-r" title="Activado: cada clic actualiza los valores y espera a Aceptar. Desactivado: el primer clic aplica el punto y cierra."><input type="checkbox" checked={wait} onChange={(e) => setWait(e.target.checked)} /> Esperar</label>
          </fieldset>
          <fieldset className="p3-fs p3-vec">
            <legend>Vector</legend>
            <button className={`p3-btn ${vecOpen ? 'on' : ''}`} title="Dirección del plano libre «*» (normal del plano)" onClick={() => setVecOpen(!vecOpen)}>Vector</button>
          </fieldset>
        </div>
        {vecOpen && (
          <div className="p3-vrow">
            {(['i', 'j', 'k'] as const).map((L, i) => (
              <label key={L}>{L} <input className="p3-num p3-vn" type="number" step="any" value={vec[i]} onChange={(e) => { const v = [...vec] as V3; v[i] = parseFloat(e.target.value) || 0; setVec(v); }} onKeyDown={(e) => e.stopPropagation()} /></label>
            ))}
            <button className={`p3-btn sm ${vecPick ? 'on' : ''}`} title="Toma la normal de una cara" onClick={() => setVecPick(!vecPick)}>Normal de cara</button>
            <button className="p3-btn sm" title="Dirección de la vista actual" onClick={() => { const d = (activeView as any)?.camDir?.() as THREE.Vector3 | undefined; if (d) setVec([d.x, d.y, d.z].map((x) => Math.round(-x * 1e4) / 1e4) as V3); }}>Vista</button>
          </div>
        )}
        <div className="p3-hint">{last ? <b>{last}: </b> : null}{hint}</div>
        <div className="p3-foot">
          <button className="p3-btn p3-ok" onClick={() => { const c = useStore.getState().clipTool; if (vecOpen && c && c.mode !== 'manual' && c.plane !== '*') set0({ plane: '*' }); accept(p, vecOpen || kind === 'face' ? vec : undefined); }}>Aceptar</button>
          <button className="p3-btn" onClick={cancel}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
const set0 = (p: Partial<ClipTool>) => { const c = useStore.getState().clipTool; if (c) useStore.setState({ clipTool: { ...c, ...p } }); };

/** Abre o cierra el modo de recorte */
export function toggleClipTool() {
  const s = useStore.getState();
  if (s.clipTool) { activeView?.stopPick(); useStore.setState({ clipTool: null }); return; }
  const b = activeView?.bbox, c = b && !b.isEmpty() ? b.getCenter(new THREE.Vector3()) : null;
  useStore.setState({ clipTool: { ...CLIP0, pt: c ? [c.x, c.y, c.z] : [0, 0, 0] }, clip: '' });
}
