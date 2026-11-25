// Tender conductos (HVAC › Tender): partiendo de una boca libre (ePoint) se encadenan rectos, codos, transiciones,
// tes, compuertas… Cada pieza toma la sección de la boca, se coloca encajada (lado W con W) y queda unida por ePoints.
import { useState } from 'react';
import * as THREE from 'three';
import { create } from 'zustand';
import { useStore } from '../core/store';
import { uid, type PartDoc, type V3 } from '../core/doc';
import { partEPoints, epJoint, type EPoint, type Mouth } from '../core/epoints';
import { makeHvacPart, type HvacSpec, type HvacKind, type DuctShape } from '../core/hvac';
import { makeSpiroPart, type SpiroSpec, type SpiroKind } from '../core/spiro';
import type { AsmDoc, Xform } from '../core/asm';

export interface Active { occ: string; ep: string }
interface Step { occs: string[]; joints: string[]; prev: Active | null }
interface RouteState {
  active: Active | null; stack: Step[];
  L: number; angle: number; dir: 'up' | 'down' | 'left' | 'right'; roll: number;
  W2: number; H2: number; D2: number; shape2: DuctShape | ''; follow: 'run' | 'branch'; bW: number; bH: number; bD: number;
}
export const useRoute = create<RouteState>(() => ({ active: null, stack: [], L: 1200, angle: 90, dir: 'right', roll: 0, W2: 400, H2: 300, D2: 200, shape2: '', follow: 'run', bW: 300, bH: 200, bD: 160 }));
const S = () => useStore.getState();
const MAT = 'Acero galvanizado DX51D+Z275';
const tv = (v: V3) => new THREE.Vector3(v[0], v[1], v[2]);

/** Sección de una boca (también en piezas antiguas, por el nombre del ePoint) */
export function mouthOf(e: EPoint, designer = ''): Mouth | null {
  if (e.mouth) return e.mouth;
  const d = e.dir, X: V3 = Math.abs(d[0]) > 0.9 ? [0, 0, 1] : [1, 0, 0];
  const r = /Ø\s*(\d+(?:[.,]\d+)?)/.exec(e.name);
  if (r) { const D = parseFloat(r[1].replace(',', '.')); return { shape: 'round', W: D, H: D, D, xdir: X, spiral: /Espirotubo/.test(designer) }; }
  const m = /(\d+(?:[.,]\d+)?)\s*[×x]\s*(\d+(?:[.,]\d+)?)(\s*oval)?/.exec(e.name);
  if (m) { const W = parseFloat(m[1].replace(',', '.')), H = parseFloat(m[2].replace(',', '.')); return { shape: m[3] ? 'oval' : 'rect', W, H, D: 0, xdir: X }; }
  return null;
}
/** Boca en coordenadas globales */
export function mouthWorld(a: Active) {
  const s = S(); const o = s.asm.occurrences.find((x) => x.id === a.occ); if (!o) return null;
  const pd = s.docData(o.part) as PartDoc | null; if (!pd) return null;
  const e = partEPoints(pd).find((x) => x.id === a.ep); if (!e) return null;
  const m = mouthOf(e, pd.iProperties?.designer); if (!m) return null;
  const X: Xform = s.asmResult?.xf[o.id] ?? o.xf;
  const q = new THREE.Quaternion(...X.quat);
  const P = tv(e.point).applyQuaternion(q).add(tv(X.pos)), D = tv(e.dir).applyQuaternion(q).normalize();
  let Xw = tv(m.xdir).applyQuaternion(q); Xw.sub(D.clone().multiplyScalar(Xw.dot(D))); if (Xw.lengthSq() < 1e-9) Xw = new THREE.Vector3(1, 0, 0).cross(D); Xw.normalize();
  return { P, D, X: Xw, Y: D.clone().cross(Xw).normalize(), m, e, o, name: `${o.name} · ${e.name}` };
}
type MW = NonNullable<ReturnType<typeof mouthWorld>>;
export const systemOf = (m: Mouth) => (m.shape === 'round' ? (m.spiral ? 'spiral' : 'round') : m.shape);
export const SYSTEM_NAMES: Record<string, string> = { rect: 'Rectangular', round: 'Circular', spiral: 'Espirotubo (EN 12237)', oval: 'Oval plano' };

/** Dirección de giro (codos, derivaciones) en el sistema de la boca: arriba/abajo respecto al eje Z global; en tramos verticales, ±X y ±Y globales */
export function turnDir(A: MW, dir: RouteState['dir'], roll: number): THREE.Vector3 {
  const Z = new THREE.Vector3(0, 0, 1);
  let up: THREE.Vector3, right: THREE.Vector3;
  const perp = (v: THREE.Vector3) => v.clone().sub(A.D.clone().multiplyScalar(v.dot(A.D))).normalize();
  if (Math.abs(A.D.dot(Z)) > 0.9) { up = perp(new THREE.Vector3(0, 1, 0)); right = perp(new THREE.Vector3(1, 0, 0)); } // tramo vertical: ±X y ±Y globales
  else { up = perp(Z); right = A.D.clone().cross(up).normalize(); }
  let T = dir === 'up' ? up : dir === 'down' ? up.clone().negate() : dir === 'right' ? right : right.clone().negate();
  if (roll) T = T.clone().applyAxisAngle(A.D, (roll * Math.PI) / 180);
  return T;
}
export const isVertical = (A: MW) => Math.abs(A.D.z) > 0.9;
export const DIR_LABELS = (vert: boolean): Record<RouteState['dir'], string> => (vert ? { up: '+Y', down: '−Y', right: '+X', left: '−X' } : { up: 'Arriba', down: 'Abajo', right: 'Derecha', left: 'Izquierda' });

// ---------- Construcción de piezas ----------
type Item = { doc: PartDoc; inlet: string; outlet?: string; others?: string[]; swap?: boolean; bendLocal?: boolean };
const hv = (A: MW, o: Partial<HvacSpec>, swap = false): HvacSpec => {
  const m = A.m; const W = swap ? m.H : m.W, H = swap ? m.W : m.H;
  return { kind: 'duct', std: 'EN', shape: m.shape, seam: m.shape === 'round' ? 'long' : undefined, W: m.shape === 'round' ? m.D : W, H: m.shape === 'round' ? m.D : H, D: m.D || m.W, L: 1200, ends: 'none', material: MAT, ...o } as HvacSpec;
};
const sp = (A: MW, o: Partial<SpiroSpec>): SpiroSpec => ({ kind: 'tube', D: A.m.D, gasket: true, material: MAT, ...o } as SpiroSpec);

/** ¿El giro T pide la pieza con W y H intercambiados? (rectangular: el codo y la derivación giran hacia su lado W) */
export function needSwap(A: MW, T: THREE.Vector3) { return A.m.shape !== 'round' && Math.abs(T.dot(A.Y)) > Math.abs(T.dot(A.X)); }

export type RouteKind = 'straight' | 'elbow' | 'transition' | 'tee' | 'coupling' | 'damper' | 'firedamper' | 'silencer' | 'flex' | 'cap';
export const ROUTE_NAMES: Record<RouteKind, string> = { straight: 'Recto', elbow: 'Codo', transition: 'Transición', tee: 'Te / derivación', coupling: 'Manguito', damper: 'Compuerta', firedamper: 'Cortafuegos', silencer: 'Silenciador', flex: 'Flexible', cap: 'Tapa' };
export function kindsFor(sys: string): RouteKind[] {
  if (sys === 'spiral') return ['straight', 'elbow', 'transition', 'tee', 'damper', 'cap'];
  if (sys === 'oval') return ['straight', 'elbow', 'transition', 'coupling', 'cap'];
  return ['straight', 'elbow', 'transition', 'tee', 'coupling', 'damper', 'firedamper', 'silencer', 'flex', 'cap'];
}

function build(A: MW, k: RouteKind, R: RouteState, T: THREE.Vector3): Item {
  const sys = systemOf(A.m);
  if (sys === 'spiral') {
    const D = A.m.D;
    switch (k) {
      case 'straight': return { doc: makeSpiroPart(sp(A, { kind: 'tube', L: R.L })), inlet: 'ep1', outlet: 'ep2' };
      case 'elbow': return { doc: makeSpiroPart(sp(A, { kind: 'elbow', angle: R.angle, rd: 1 })), inlet: 'ep1', outlet: 'ep2', bendLocal: true };
      case 'transition': { if (!(R.D2 < D)) throw new Error('La reducción de espirotubo necesita un Ø menor'); return { doc: makeSpiroPart(sp(A, { kind: 'reducer', D2: R.D2 })), inlet: 'ep1', outlet: 'ep2' }; }
      case 'tee': { const it = { doc: makeSpiroPart(sp(A, { kind: 'tee', D2: Math.min(R.bD, D) })), inlet: 'ep1', bendLocal: true } as Item; it.outlet = R.follow === 'branch' ? 'ep3' : 'ep2'; it.others = [R.follow === 'branch' ? 'ep2' : 'ep3']; return it; }
      case 'damper': return { doc: makeSpiroPart(sp(A, { kind: 'damper' })), inlet: 'ep1', outlet: 'ep2' };
      case 'cap': return { doc: makeSpiroPart(sp(A, { kind: A.m.male ? 'capF' : 'capM' })), inlet: 'ep1' };
      default: throw new Error(`${ROUTE_NAMES[k]}: no disponible en espirotubo`);
    }
  }
  const swap = (k === 'elbow' || k === 'tee') && needSwap(A, T);
  if (swap && sys === 'oval') throw new Error('Oval plano: los codos solo giran hacia el lado ancho');
  const H = (o: Partial<HvacSpec>, sw = false) => makeHvacPart(hv(A, o, sw));
  switch (k) {
    case 'straight': return { doc: H({ kind: 'duct', L: R.L }), inlet: 'ep1', outlet: 'ep2' };
    case 'elbow': return { doc: H({ kind: 'elbow', angle: R.angle }, swap), inlet: 'ep1', outlet: 'ep2', swap, bendLocal: true };
    case 'transition': {
      const sh2 = (R.shape2 || A.m.shape) as DuctShape;
      return { doc: H({ kind: 'transition', L: 300, shape2: sh2, W2: sh2 === 'round' ? R.D2 : R.W2, H2: sh2 === 'round' ? R.D2 : R.H2, D2: R.D2 }), inlet: 'ep1', outlet: 'ep2' };
    }
    case 'tee': {
      const sh = A.m.shape === 'round' ? 'round' : 'rect';
      const doc = H({ kind: 'branch', branch: 'tee', L: Math.max(300, (sh === 'round' ? R.bD : R.bW) + 200), shape2: sh, W2: R.bW, H2: Math.min(R.bH, swap ? A.m.W : A.m.H), D2: Math.min(R.bD, A.m.D || 1e9) }, swap);
      return { doc, inlet: 'ep1', outlet: R.follow === 'branch' ? 'ep3' : 'ep2', others: [R.follow === 'branch' ? 'ep2' : 'ep3'], swap, bendLocal: true };
    }
    case 'coupling': return { doc: H({ kind: 'coupling', L: 150 }), inlet: 'ep1', outlet: 'ep2' };
    case 'damper': return { doc: H({ kind: 'damper', L: 0 }), inlet: 'ep1', outlet: 'ep2' };
    case 'firedamper': return { doc: H({ kind: 'firedamper', L: 0 }), inlet: 'ep1', outlet: 'ep2' };
    case 'silencer': return { doc: H({ kind: 'silencer', L: 900 }), inlet: 'ep1', outlet: 'ep2' };
    case 'flex': return { doc: H({ kind: 'flex', L: Math.min(R.L, 1500) }), inlet: 'ep1', outlet: 'ep2' };
    case 'cap': return { doc: H({ kind: 'cap' as HvacKind }), inlet: 'ep1' };
  }
}

/** Orientación: la boca de entrada de la pieza contra la boca activa, lado W con W (o hacia el giro en codos y tes) */
function placeXf(A: MW, inlet: EPoint, im: Mouth, T: THREE.Vector3 | null, swap: boolean): Xform {
  const fl = tv(inlet.dir).negate().normalize(), xl0 = tv(im.xdir); const xl = xl0.sub(fl.clone().multiplyScalar(xl0.dot(fl))).normalize();
  const yl = fl.clone().cross(xl);
  const fw = A.D.clone();
  let xw: THREE.Vector3;
  if (T) xw = T.clone().sub(fw.clone().multiplyScalar(T.dot(fw))).normalize(); // la pieza gira hacia su +X local
  else xw = swap ? A.Y.clone() : A.X.clone();
  const yw = fw.clone().cross(xw);
  const Ml = new THREE.Matrix4().makeBasis(fl, xl, yl), Mw = new THREE.Matrix4().makeBasis(fw, xw, yw);
  const R = Mw.multiply(Ml.transpose());
  const q = new THREE.Quaternion().setFromRotationMatrix(R).normalize();
  const p = A.P.clone().sub(tv(inlet.point).applyQuaternion(q));
  const r = (x: number) => Math.round(x * 1e4) / 1e4;
  return { pos: [r(p.x), r(p.y), r(p.z)], quat: [q.x, q.y, q.z, q.w] };
}

/** Coloca una pieza en la boca activa; devuelve la nueva boca activa */
function placeOne(A: MW, it: Item, T: THREE.Vector3 | null, step: Step): Active | null {
  const s = S();
  const fn = `${it.doc.iProperties.partNumber}.i3p`.replace(/[\\/:*?"<>|]/g, '_');
  const ex = s.docs.find((d) => d.kind === 'part' && d.fileName === fn);
  const pid = ex?.id ?? s.addDocument('part', it.doc, fn, false);
  const pd = (S().docData(pid) as PartDoc | null) ?? it.doc;
  const eps = partEPoints(pd);
  const inlet = eps.find((e) => e.id === it.inlet); if (!inlet) throw new Error('La pieza no tiene boca de entrada');
  const im = mouthOf(inlet, pd.iProperties.designer)!;
  const te = it.bendLocal ? T : null;
  const xf = placeXf(A, inlet, im, te, !!it.swap && !te);
  const occ = uid('o'); let jid = '';
  s.commitAsm((a: AsmDoc) => {
    const base = fn.replace(/\.i3p$/, ''); let k = 1; while (a.occurrences.some((o) => o.name === `${base}:${k}`)) k++;
    a.occurrences.push({ id: occ, name: `${base}:${k}`, part: pid, xf });
    const j = epJoint(a, occ, inlet, A.o.id, A.e, uid); jid = j.id; a.joints.push(j);
  });
  step.occs.push(occ); step.joints.push(jid);
  return it.outlet ? { occ, ep: it.outlet } : null;
}

/** Pone la pieza elegida (con adaptador si hace falta en espirotubo) y avanza la boca activa */
export function routeAdd(k: RouteKind) {
  const R = useRoute.getState(); const s = S();
  if (!R.active) { s.notify('Haz clic primero en una boca libre (ePoint) de un conducto', 'error'); return; }
  const A = mouthWorld(R.active); if (!A) { s.notify('Boca no válida', 'error'); return; }
  const T = turnDir(A, R.dir, systemOf(A.m) === 'rect' || systemOf(A.m) === 'oval' ? 0 : R.roll);
  const step: Step = { occs: [], joints: [], prev: R.active };
  try {
    let cur = A;
    const it = build(cur, k, R, T);
    // espirotubo: hembra con hembra → manguito macho; macho con macho → manguito hembra
    if (systemOf(A.m) === 'spiral') {
      const pd = it.doc, inl = partEPoints(pd).find((e) => e.id === it.inlet), m2 = inl && mouthOf(inl, pd.iProperties.designer);
      if (m2 && !!m2.male === !!A.m.male) {
        const adapter: Item = { doc: makeSpiroPart(sp(A, { kind: A.m.male ? 'sleeve' : 'nipple' })), inlet: 'ep1', outlet: 'ep2' };
        const nx = placeOne(cur, adapter, null, step); const c2 = nx && mouthWorld(nx); if (!c2) throw new Error('No se pudo colocar el manguito');
        cur = c2;
      }
    }
    const next = placeOne(cur, it, T, step);
    useRoute.setState({ active: next, stack: [...R.stack, step] });
    s.notify(`${ROUTE_NAMES[k]} colocado${next ? '' : ' · tramo cerrado'}${it.others?.length ? ' · la otra boca queda libre (clic en ella para seguir por ahí)' : ''}`);
  } catch (e) {
    if (step.occs.length) undoStep(step);
    s.notify((e as Error).message, 'error');
  }
}
function undoStep(st: Step) {
  S().commitAsm((a) => { a.occurrences = a.occurrences.filter((o) => !st.occs.includes(o.id)); a.joints = a.joints.filter((j) => !st.joints.includes(j.id)); });
}
export function routeUndo() {
  const R = useRoute.getState(); const st = R.stack[R.stack.length - 1]; if (!st) return;
  undoStep(st); useRoute.setState({ stack: R.stack.slice(0, -1), active: st.prev });
}
export function routeStart(a?: Active) {
  useRoute.setState({ active: a ?? null, stack: [] });
  S().setTool('hvacRoute');
  if (!a) S().notify('Tender conductos: haz clic en una boca libre (ePoint) de un conducto o accesorio');
}

// ---------- Panel ----------
export function RoutePanel() {
  const s = useStore(); const R = useRoute();
  const [, force] = useState(0);
  if (s.tool !== 'hvacRoute') return null;
  const A = R.active ? mouthWorld(R.active) : null;
  const sys = A ? systemOf(A.m) : '';
  const set = (p: Partial<RouteState>) => useRoute.setState(p);
  const num = (v: number, on: (x: number) => void, w = 70) => <input className="num" style={{ width: w }} type="number" value={v} onChange={(e) => on(Number(e.target.value) || 0)} onKeyDown={(e) => e.stopPropagation()} />;
  const vert = A ? isVertical(A) : false; const DL = DIR_LABELS(vert);
  return (
    <div className="measure-panel route-panel" onPointerDown={(e) => e.stopPropagation()} data-testid="route-panel">
      <div className="mp-head"><b>Tender conductos</b><button className="x" title="Terminar (Esc)" onClick={() => S().setTool(null)}>✕</button></div>
      <div className="mp-slot full"><span className="dot" style={{ background: A ? '#1f8fb3' : '#999' }} /><span className="t">{A ? `Boca activa: ${A.name}` : 'Haz clic en una boca libre (ePoint) de un conducto o accesorio'}</span></div>
      {A && (<>
        <div className="mp-hint">{SYSTEM_NAMES[sys]} · {A.m.shape === 'round' ? `Ø${A.m.D}` : `${A.m.W}×${A.m.H}`}{A.m.spiral ? (A.m.male ? ' · macho' : ' · hembra') : ''}</div>
        <div className="plabel">Giro (codos y derivaciones)</div>
        <div className="mp-modes">{(['up', 'down', 'left', 'right'] as const).map((d) => { const bad = sys === 'oval' && needSwap(A, turnDir(A, d, 0)); return <button key={d} disabled={bad} title={bad ? 'Oval plano: los codos solo giran hacia el lado ancho' : ''} className={R.dir === d ? 'on' : ''} onClick={() => set({ dir: d })}>{DL[d]}</button>; })}</div>
        <div className="mp-opts">
          <label>Longitud recto {num(R.L, (x) => set({ L: x }))}</label>
          <label>Ángulo codo <select value={R.angle} onChange={(e) => set({ angle: Number(e.target.value) })}>{[90, 60, 45, 30, 15].map((a) => <option key={a} value={a}>{a}°</option>)}</select></label>
          {(sys === 'round' || sys === 'spiral') && <label>Giro extra ° {num(R.roll, (x) => set({ roll: x }), 55)}</label>}
        </div>
        <div className="mp-btns">{kindsFor(sys).map((k) => <button key={k} className="btn" onClick={() => { routeAdd(k); force((n) => n + 1); }}>{ROUTE_NAMES[k]}</button>)}</div>
        <details><summary>Transición / reducción y derivación</summary>
          <div className="mp-opts">
            {sys !== 'spiral' && <label>Sección 2 <select value={R.shape2} onChange={(e) => set({ shape2: e.target.value as DuctShape | '' })}><option value="">Igual</option><option value="rect">Rectangular</option><option value="round">Circular</option>{sys === 'oval' || sys === 'rect' ? <option value="oval">Oval</option> : null}</select></label>}
            {(R.shape2 || A.m.shape) === 'round' || sys === 'spiral' ? <label>Ø2 {num(R.D2, (x) => set({ D2: x }))}</label> : <><label>W2 {num(R.W2, (x) => set({ W2: x }))}</label><label>H2 {num(R.H2, (x) => set({ H2: x }))}</label></>}
          </div>
          <div className="mp-opts">
            {A.m.shape === 'round' ? <label>Ø derivación {num(R.bD, (x) => set({ bD: x }))}</label> : <><label>W deriv. {num(R.bW, (x) => set({ bW: x }))}</label><label>H deriv. {num(R.bH, (x) => set({ bH: x }))}</label></>}
            <label>Seguir por <select value={R.follow} onChange={(e) => set({ follow: e.target.value as 'run' | 'branch' })}><option value="run">Recto</option><option value="branch">Derivación</option></select></label>
          </div>
        </details>
      </>)}
      <div className="mp-btns">
        <button className="btn" disabled={!R.stack.length} onClick={routeUndo}>Deshacer última</button>
        <button className="btn primary" onClick={() => S().setTool(null)}>Terminar</button>
      </div>
      <div className="mp-hint">Clic en cualquier boca libre para seguir desde ella. {R.stack.length ? `${R.stack.reduce((n, x) => n + x.occs.length, 0)} pieza(s) colocadas.` : ''}</div>
    </div>
  );
}
