// Tender hasta un punto o una boca: tramos rectos y codos de 90° ortogonales, con las longitudes calculadas
// descontando lo que ocupa cada codo (los tramos largos se dividen solos si así está en Opciones).
import * as THREE from 'three';
import { useStore } from '../core/store';
import { partEPoints } from '../core/epoints';
import type { PartDoc } from '../core/doc';
import * as R from './hvacroute';
import { execAsmTool, hvacDocFor, pipeDocFor, setTurn } from '../ai/asmtools';

const S = () => useStore.getState();
type Frame = NonNullable<ReturnType<typeof R.epFrame>>;
const AXN = ['X', 'Y', 'Z'] as const;
const comp = (v: THREE.Vector3, i: number) => (i === 0 ? v.x : i === 1 ? v.y : v.z);
const axisOf = (d: THREE.Vector3) => { const a = [Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)]; const i = a.indexOf(Math.max(...a)); return a[i] > 0.999 ? i : -1; };
const unit = (i: number, sg: number) => new THREE.Vector3(i === 0 ? sg : 0, i === 1 ? sg : 0, i === 2 ? sg : 0);
const dirName = (u: THREE.Vector3) => `${u.x + u.y + u.z > 0 ? '+' : '-'}${AXN[axisOf(u)]}`;

/** Ocupación de un codo de 90°: distancia de cada boca a la esquina (intersección de los ejes) */
function takeoff(doc: PartDoc) {
  const eps = partEPoints(doc); const e1 = eps.find((e) => e.id === 'ep1')!, e2 = eps.find((e) => e.id === 'ep2')!;
  const P1 = new THREE.Vector3(...e1.point), P2 = new THREE.Vector3(...e2.point), d1 = new THREE.Vector3(...e1.dir), d2 = new THREE.Vector3(...e2.dir);
  const v = P2.clone().sub(P1); return { a: -v.dot(d1), b: v.dot(d2) };
}
const kindAt = (F: Frame): 'hvac' | 'pipe' => { const pd = S().docData(F.o.part) as PartDoc & { hvacSpec?: unknown; pipeSpec?: unknown }; return pd?.pipeSpec && !pd.hvacSpec ? 'pipe' : 'hvac'; };

/** Plan de tramos: lista de direcciones y longitudes de eje (entre esquinas) */
function plan(F: Frame, T: THREE.Vector3, Dt: THREE.Vector3 | null) {
  const c = T.clone().sub(F.P);
  const i0 = axisOf(F.D); if (i0 < 0) throw new Error('La boca de salida no está alineada con X, Y o Z: gírala antes');
  const i1 = Dt ? axisOf(Dt) : -1; if (Dt && i1 < 0) throw new Error('La boca de destino no está alineada con X, Y o Z');
  const big = (i: number) => Math.abs(comp(c, i)) > 1;
  const others = [0, 1, 2].filter((i) => i !== i0 && i !== i1 && big(i)).sort((x, y) => Math.abs(comp(c, y)) - Math.abs(comp(c, x)));
  let segs: { i: number; len: number }[];
  if (Dt && i1 === i0) {
    const h = comp(c, i0) / 2;
    segs = others.length ? [{ i: i0, len: h }, ...others.map((i) => ({ i, len: comp(c, i) })), { i: i0, len: h }] : [{ i: i0, len: comp(c, i0) }];
  } else {
    segs = [{ i: i0, len: comp(c, i0) }, ...others.map((i) => ({ i, len: comp(c, i) })), ...(Dt ? [{ i: i1, len: comp(c, i1) }] : [])];
  }
  // sentido de cada tramo
  const out = segs.filter((sg, k) => k === 0 || Math.abs(sg.len) > 1).map((sg) => ({ u: unit(sg.i, Math.sign(sg.len) || 1), len: Math.abs(sg.len) }));
  if (out[0].u.dot(F.D) < 0) throw new Error(`El destino queda por detrás de la boca (${dirName(F.D)}): tiende primero hacia delante o elige otra boca`);
  if (Dt && out[out.length - 1].u.dot(Dt) > 0) throw new Error('No se puede entrar en la boca de destino por detrás: debe quedar mirando hacia el tendido');
  return out;
}

/** Tiende desde la boca (occ, ep) hasta el punto T o hasta la boca de destino `to` */
export async function routeTo(occ: string, ep: string, target: { point?: [number, number, number]; to?: { occ: string; ep: string } }) {
  const s = S(); const F0 = R.epFrame(occ, ep); if (!F0) { s.notify('No existe la boca de salida', 'error'); return; }
  let T: THREE.Vector3, Dt: THREE.Vector3 | null = null;
  if (target.to) { const Ft = R.epFrame(target.to.occ, target.to.ep); if (!Ft) { s.notify('No existe la boca de destino', 'error'); return; } T = Ft.P.clone(); Dt = Ft.D.clone(); }
  else T = new THREE.Vector3(...(target.point ?? [0, 0, 0]));
  const kind = kindAt(F0);
  let segs: ReturnType<typeof plan>;
  try { segs = plan(F0, T, Dt); } catch (e) { s.notify((e as Error).message, 'error'); return; }
  useStore.setState({ selItem: occ });
  let F: Frame = F0, prevOut = 0, placed = 0;
  const tool = kind === 'hvac' ? 'insert_hvac' : 'insert_pipe';
  const at = (f: Frame) => JSON.stringify({ occ: f.o.id, ep: f.e.id });
  for (let k = 0; k < segs.length; k++) {
    const last = k === segs.length - 1;
    let a = 0, b = 0, towards = '';
    if (!last) {
      towards = dirName(segs[k + 1].u);
      setTurn(F, towards, 0);
      const doc = kind === 'hvac' ? hvacDocFor({ kind: 'elbow' }, F) : pipeDocFor({ kind: 'elbow' }, F);
      ({ a, b } = takeoff(doc));
    }
    const straight = segs[k].len - prevOut - a;
    if (straight < -0.5) { s.notify(`No cabe: el tramo ${k + 1} (${Math.round(segs[k].len)} mm) es más corto que lo que ocupan los codos (${Math.round(prevOut + a)} mm)`, 'error'); return; }
    if (straight > 0.5) {
      const r = await execAsmTool(tool, { spec: JSON.stringify(kind === 'hvac' ? { kind: 'duct', L: Math.round(straight) } : { kind: 'pipe', length: Math.round(straight) }), at: at(F) }) as { error?: string };
      if (r?.error) { s.notify(r.error, 'error'); return; }
      placed++;
      const nf = nextFree(); if (!nf) return; F = nf;
    }
    if (!last) {
      const r = await execAsmTool(tool, { spec: JSON.stringify({ kind: 'elbow' }), at: at(F), towards }) as { error?: string };
      if (r?.error) { s.notify(r.error, 'error'); return; }
      placed++;
      const nf = nextFree(); if (!nf) return; F = nf;
    }
    prevOut = b;
  }
  // con boca de destino: se une el final a ella (cierra el tendido)
  let joined = '';
  if (target.to) {
    const Ft = R.epFrame(target.to.occ, target.to.ep)!; const d = F.P.distanceTo(Ft.P);
    if (d < 1) { const { asmActions } = await import('./actions'); asmActions.foranJoinFixed?.(F.o.id, F.e.id, target.to.occ, target.to.ep); joined = ' y unido a la boca de destino'; }
    else joined = ` (queda a ${d.toFixed(1)} mm de la boca de destino)`;
  }
  s.notify(`Tendido hasta ${target.to ? 'la boca' : `(${T.toArray().map((v) => Math.round(v)).join(', ')})`}: ${placed} pieza(s)${joined}`);
}
/** Boca libre de la última pieza colocada (la seleccionada) */
function nextFree(): Frame | null {
  const s = S(); const sel = s.selItem; if (!sel) return null;
  const used = new Set<string>(); for (const j of s.asm.joints) if (j.ep) { used.add(`${j.a.occ}:${j.ep.a}`); used.add(`${j.b.occ}:${j.ep.b}`); }
  const pd = s.docData(s.asm.occurrences.find((o) => o.id === sel)!.part) as PartDoc;
  const e = R.portsOf(pd).filter((x) => !x.isDefault && !used.has(`${sel}:${x.id}`));
  const pick = e.find((x) => x.id === 'ep2') ?? e[0];
  return pick ? R.epFrame(sel, pick.id) : null;
}
