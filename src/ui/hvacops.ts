// Operaciones de tendido sobre tramos rectos de conducto: cortar (bridas + junta), insertar en línea,
// dividir en tramos (longitud/peso máximos), cambiar la longitud. El tramo se sustituye por una cadena de
// piezas colineales unidas por ePoints, con las uniones de antes y de después reconectadas.
import { useStore } from '../core/store';
import { uid, v3, MATERIALS, type V3, type PartDoc } from '../core/doc';
import { epJoint, partEPoints, type EPoint } from '../core/epoints';
import { q as qq, xfPoint, type Xform, type Joint } from '../core/asm';
import { makeHvacPart, type HvacSpec } from '../core/hvac';
import { autoT } from '../core/hvac';
import { foranJoint, xfOf } from './actions';

const S = () => useStore.getState();
type Q = Xform['quat'];
const conj = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]];
const ROTX180: Q = [1, 0, 0, 0];
type HPart = PartDoc & { hvacSpec?: HvacSpec };
const specOf = (pid: string) => (S().docData(pid) as HPart | null)?.hvacSpec;

/** Máximos de tramo: los del ensamblaje, si no los del proyecto activo (.fdp), si no los de la aplicación */
export const segCfg = () => {
  const s = S(), st = s.settings, a = s.kind === 'assembly' ? s.asm.segCfg : undefined, pj = s.project?.fdp?.options;
  return { maxL: a?.maxL ?? pj?.segMaxL ?? st.segMaxL ?? 1500, maxKg: a?.maxKg ?? pj?.segMaxKg ?? st.segMaxKg ?? 80, joint: st.segJoint ?? 'tdc', g: st.segGasket ?? 4, auto: st.segAuto ?? true,
    src: a?.maxL != null || a?.maxKg != null ? 'ensamblaje' : pj?.segMaxL != null || pj?.segMaxKg != null ? `proyecto ${s.project?.fdp?.name}` : 'aplicación' };
};

/** ¿Es un tramo recto de conducto (con especificación)? */
export function isStraightDuct(occ: string) { const o = S().asm.occurrences.find((x) => x.id === occ); const sp = o && specOf(o.part); return !!sp && sp.kind === 'duct'; }

/** Peso (kg) de un tramo: chapa + bridas (las mismas medidas que el modelo: TDC o marco angular con su ala, acero 7850)
 *  + juntas (EPDM 1200 kg/m³, espesor g). La longitud L ya incluye las bridas (van dentro del tramo). */
export function ductKg(sp: HvacSpec, L: number, flanges = 0, gaskets = 0, g = segCfg().g, joint: 'tdc' | 'angle' = segCfg().joint) {
  const t = autoT(sp), st = 7.85e-6, epdm = 1.2e-6;
  const e = sp.ends && sp.ends !== 'none' && sp.ends !== 'socket' ? sp.ends : joint;
  const fh = e === 'tdc' ? (Math.max(sp.W ?? 0, sp.H ?? 0, sp.D ?? 0) > 1000 ? 40 : 30) : 30, ft = e === 'tdc' ? Math.max(t, 0.8) * 1.5 : 3, coll = e === 'angle' ? 30 : 0;
  // área de la sección exterior al crecer `x` (mm) por cada lado
  const sec = (x: number) => sp.shape === 'round' ? (Math.PI / 4) * (sp.D + 2 * x) ** 2
    : sp.shape === 'oval' ? (Math.PI / 4) * (sp.H + 2 * x) ** 2 + (sp.W - sp.H) * (sp.H + 2 * x) : (sp.W + 2 * x) * (sp.H + 2 * x);
  const ring = (x0: number, x1: number) => sec(x1) - sec(x0);
  const sheet = ring(0, t) * L * st;
  const flange = (ring(t, t + fh) * ft + (coll ? ring(t, t + ft) * coll : 0)) * st;
  const gasket = ring(t, t + fh) * g * epdm;
  return sheet + flanges * flange + gaskets * gasket;
}

/** Documento de pieza (reutiliza el ya abierto con el mismo nombre) */
export function partFor(doc: PartDoc) {
  const s = S(); const fn = doc.iProperties.partNumber.replace(/[\\/:*?"<>|]+/g, '_') + '.i3p';
  return s.docs.find((d) => d.fileName === fn)?.id ?? s.addDocument('part', doc, fn, false);
}
/** Tramo recto con bridas en el inicio y/o el final */
function ductDoc(sp: HvacSpec, L: number, f0: boolean, f1: boolean, joint: 'tdc' | 'angle') {
  const orig = sp.ends && sp.ends !== 'none' && sp.ends !== 'socket' ? sp.ends : null;
  const e = orig ?? joint;
  const ends = f0 || f1 ? e : 'none';
  const endsAt = f0 && f1 ? 'both' : f0 ? 'start' : 'end';
  const d = makeHvacPart({ ...sp, L: Math.round(L * 10) / 10, ends: ends as HvacSpec['ends'], endsAt: ends === 'none' ? undefined : endsAt });
  if (ends !== 'none') { const c = f0 && f1 ? 'BB' : f0 ? 'B-' : '-B'; d.iProperties.partNumber += ` ${e === 'tdc' ? 'TDC' : 'AL'} ${c}`; }
  return partFor(d);
}
function gasketDoc(sp: HvacSpec, g: number, joint: 'tdc' | 'angle') { return partFor(makeHvacPart({ ...sp, kind: 'gasket', L: g, ends: joint, material: 'Junta EPDM' })); }

/** Extremos del tramo original con brida */
function origFlanges(sp: HvacSpec) {
  const on = !!sp.ends && sp.ends !== 'none' && sp.ends !== 'socket'; const at = sp.endsAt ?? 'both';
  return { f0: on && at !== 'end', f1: on && at !== 'start' };
}

/** Sustituye el tramo `occ` por una cadena de piezas colineales (ep1 → ep2 de cada una), en el sentido de su boca de entrada */
function replaceByChain(occ: string, chain: string[], label: string) {
  const s = S(); const o = s.asm.occurrences.find((x) => x.id === occ); if (!o) throw new Error('No existe el componente');
  const sp = specOf(o.part)!; const L = sp.L;
  const jIn = foranJoint(occ); const eIn = jIn?.ep ? (jIn.a.occ === occ ? jIn.ep.a : jIn.ep.b) : 'ep1';
  const X = xfOf(occ);
  const rev = eIn === 'ep2';
  const qb: Q = rev ? (qq.mul(X.quat, ROTX180) as Q) : X.quat;
  const Ob: V3 = rev ? (v3.add(X.pos, qq.rotate(X.quat, [0, 0, L])) as V3) : X.pos;
  const eOut = rev ? 'ep1' : 'ep2';
  // posiciones de las piezas
  const ids = chain.map(() => uid('o'));
  const eps = chain.map((pid) => partEPoints(s.docData(pid) as PartDoc));
  const xfs: Xform[] = []; let c: V3 = [0, 0, 0];
  for (const e of eps) {
    const e1 = e.find((x) => x.id === 'ep1')!, e2 = e.find((x) => x.id === 'ep2')!;
    const p0 = v3.sub(c, e1.point as V3) as V3;
    xfs.push({ pos: v3.add(Ob, qq.rotate(qb, p0)) as V3, quat: [...qb] as Q });
    c = v3.add(p0, e2.point as V3) as V3;
  }
  const W = v3.norm(qq.rotate(qb, [1, 0, 0])) as V3;
  const loc = (q: Q) => v3.norm(qq.rotate(conj(q), W)) as V3;
  const ep = (k: number, id: string) => eps[k].find((x) => x.id === id) as EPoint;
  const base = (pid: string) => (S().docs.find((d) => d.id === pid)?.fileName ?? 'Pieza').replace(/\.i3p$/, '');
  s.commitAsm((a) => {
    const at = a.occurrences.findIndex((x) => x.id === occ);
    const cnt = new Map<string, number>(); for (const x of a.occurrences) cnt.set(x.part, (cnt.get(x.part) ?? 0) + 1);
    const news = chain.map((pid, k) => { const n = (cnt.get(pid) ?? 0) + 1; cnt.set(pid, n); return { id: ids[k], name: `${base(pid)}:${n}`, part: pid, xf: xfs[k], ...(k === 0 && o.grounded ? { grounded: true } : {}), ...(o.system ? { system: o.system } : {}), ...(o.ins && specOf(pid)?.kind !== 'gasket' ? { ins: { ...o.ins } } : {}) }; });
    a.occurrences.splice(at, 1, ...(news as typeof a.occurrences));
    for (const u of a.segUnits ?? []) if (u.occs.includes(occ)) u.occs = [...u.occs.filter((x) => x !== occ), ...ids];
    const oq = X.quat;
    const keep: Joint[] = [];
    for (const j of a.joints) {
      if (j.a.occ !== occ && j.b.occ !== occ) { keep.push(j); continue; }
      if (!j.ep) continue; // otras restricciones sobre el tramo se pierden
      const side = j.a.occ === occ ? 'a' : 'b'; const e = j.ep[side];
      const k = e === eIn ? 0 : e === eOut ? chain.length - 1 : -1; if (k < 0) continue;
      const newEp = e === eIn ? 'ep1' : 'ep2'; // (con una sola pieza k = 0 también en la salida)
      if (j === jIn || (k === 0 && j.id === jIn?.id)) {
        // unión con la pieza anterior: se rehace con la primera pieza
        const other = side === 'a' ? j.b : j.a; const oe = j.ep[side === 'a' ? 'b' : 'a'];
        const ob = a.occurrences.find((x) => x.id === other.occ);
        const te = ob && partEPoints(S().docData(ob.part) as PartDoc).find((x) => x.id === oe);
        if (!te) continue;
        let nj = epJoint(a, ids[0], ep(0, 'ep1'), other.occ, te, uid);
        if (nj.type === 'insert') { const Xt = xfOf(other.occ); nj = { ...nj, lock: true, a: { ...nj.a, xdir: loc(nj.a.occ === ids[0] ? xfs[0].quat : Xt.quat) }, b: { ...nj.b, xdir: loc(nj.b.occ === ids[0] ? xfs[0].quat : Xt.quat) } }; }
        keep.push(nj); continue;
      }
      // uniones de después (o de la boca de entrada si el tramo era la raíz): pasan a la pieza del extremo
      const sideRef = j[side]; const wx = sideRef.xdir ? qq.rotate(oq, sideRef.xdir) : null;
      keep.push({ ...j, [side]: { ...sideRef, occ: ids[k], ...(wx ? { xdir: v3.norm(qq.rotate(conj(xfs[k].quat), wx as V3)) } : {}) }, ep: { ...j.ep, [side]: newEp } } as Joint);
    }
    // uniones entre las piezas nuevas
    for (let k = 0; k + 1 < chain.length; k++) {
      let nj = epJoint(a, ids[k + 1], ep(k + 1, 'ep1'), ids[k], ep(k, 'ep2'), uid);
      nj = { ...nj, lock: true, a: { ...nj.a, xdir: loc(xfs[nj.a.occ === ids[k] ? k : k + 1].quat) }, b: { ...nj.b, xdir: loc(xfs[nj.b.occ === ids[k] ? k : k + 1].quat) } };
      keep.push(nj);
    }
    a.joints = keep;
  });
  useStore.setState({ selItem: ids[ids.length - 1] });
  s.notify(label);
  return ids;
}

/** Posición (mm desde la boca de entrada del tramo) de un punto del 3D sobre su eje */
export function distAlong(occ: string, pW: V3) {
  const s = S(); const o = s.asm.occurrences.find((x) => x.id === occ)!; const sp = specOf(o.part)!;
  const X = xfOf(occ); const z = qq.rotate(conj(X.quat), v3.sub(pW, X.pos) as V3)[2];
  const jIn = foranJoint(occ); const eIn = jIn?.ep ? (jIn.a.occ === occ ? jIn.ep.a : jIn.ep.b) : 'ep1';
  return Math.max(0, Math.min(sp.L, eIn === 'ep2' ? sp.L - z : z));
}

/** Cortar el tramo a `d` mm de su entrada: dos tramos con bridas en el corte y junta entre ellas */
export function cutDuct(occ: string, d: number) {
  const s = S(); const o = s.asm.occurrences.find((x) => x.id === occ); const sp = o && specOf(o.part);
  if (!sp || sp.kind !== 'duct') { s.notify('Cortar: elige un tramo recto de conducto', 'error'); return; }
  const { joint, g } = segCfg(); const L = sp.L;
  if (d < 50 || d > L - g - 50) { s.notify(`El corte debe quedar entre 50 y ${Math.round(L - g - 50)} mm de la entrada`, 'error'); return; }
  const { f0, f1 } = orient(occ, sp);
  return replaceByChain(occ, [ductDoc(sp, d, f0, true, joint), gasketDoc(sp, g, joint), ductDoc(sp, L - d - g, true, f1, joint)],
    `Conducto cortado a ${Math.round(d)} mm: ${Math.round(d)} + junta ${g} + ${Math.round(L - d - g)} mm, con bridas ${joint === 'tdc' ? 'TDC' : 'de marco angular'} en el corte`);
}
/** Bridas del tramo según el sentido de la cadena (entrada → salida) */
function orient(occ: string, sp: HvacSpec) {
  const f = origFlanges(sp); const jIn = foranJoint(occ); const eIn = jIn?.ep ? (jIn.a.occ === occ ? jIn.ep.a : jIn.ep.b) : 'ep1';
  return eIn === 'ep2' ? { f0: f.f1, f1: f.f0 } : f;
}

/** ¿Hay una junta unida a la boca `ep` del componente? */
function gasketAt(occ: string, ep: string) {
  const s = S();
  return s.asm.joints.some((j) => { if (!j.ep || j.suppressed) return false; const me = j.a.occ === occ ? 'a' : j.b.occ === occ ? 'b' : null; if (!me || j.ep[me] !== ep) return false;
    const other = s.asm.occurrences.find((x) => x.id === (me === 'a' ? j.b.occ : j.a.occ)); return specOf(other?.part ?? '')?.kind === 'gasket'; });
}
/** Bocas de entrada y salida del tramo (la de entrada es la de su unión con la pieza anterior) */
export const inOutOf = (occ: string) => inOut(occ);
function inOut(occ: string) { const jIn = foranJoint(occ); const eIn = jIn?.ep ? (jIn.a.occ === occ ? jIn.ep.a : jIn.ep.b) : 'ep1'; return { eIn, eOut: eIn === 'ep2' ? 'ep1' : 'ep2' }; }

/** Longitud máxima (mm) de una parte con `nf` bridas y `ng` juntas que cumple la longitud y el peso máximos */
function maxPart(sp: HvacSpec, nf: number, ng: number) {
  const { maxL, maxKg, joint, g } = segCfg();
  const b = ductKg(sp, 0, nf, ng, g, joint), a = ductKg(sp, 1000, 0, 0, g, joint) / 1000;
  return Math.floor(Math.min(maxL - ng * g, (maxKg - b) / a));
}
/** Peso y longitud de un tramo con sus bridas y la junta de su salida */
export function ductCheck(occ: string) {
  const o = S().asm.occurrences.find((x) => x.id === occ); const sp = o && specOf(o.part); if (!sp || sp.kind !== 'duct') return null;
  const { maxL, maxKg, joint, g } = segCfg(); const fo = origFlanges(sp), nf = (fo.f0 ? 1 : 0) + (fo.f1 ? 1 : 0), ng = gasketAt(occ, inOut(occ).eOut) ? 1 : 0;
  const kg = ductKg(sp, sp.L, nf, ng, g, joint), len = sp.L + ng * g;
  return { kg, len, ok: kg <= maxKg + 1e-6 && len <= maxL + 1e-6 };
}

/** Divide el tramo: partes de la longitud máxima que cumple (longitud y peso con sus bridas y la junta de su salida)
 *  y el resto en la última; o en partes iguales (Archivo › Opciones › Tramos) */
export function segmentDuct(occ: string, quiet = false) {
  const s = S(); const o = s.asm.occurrences.find((x) => x.id === occ); const sp = o && specOf(o.part);
  if (!sp || sp.kind !== 'duct') { if (!quiet) s.notify('Dividir: elige un tramo recto de conducto', 'error'); return null; }
  const { maxL, maxKg, joint, g } = segCfg(); const L = sp.L, mode = s.settings.segMode ?? 'max';
  const chk = ductCheck(occ)!;
  if (chk.ok) { if (!quiet) s.notify(`El tramo (${L} mm, ≈${chk.kg.toFixed(1)} kg con bridas y juntas) no supera ${maxL} mm ni ${maxKg} kg`); return null; }
  const { f0, f1 } = orient(occ, sp); const gOut = gasketAt(occ, inOut(occ).eOut) ? 1 : 0;
  const lens: number[] = [];
  if (mode === 'equal') {
    let n = 2;
    const fits = (n: number) => { const seg = (L - (n - 1) * g) / n; return seg <= maxPart(sp, 2, 1) && seg <= maxPart(sp, 1 + (f1 ? 1 : 0), gOut); };
    while (n < 200 && !fits(n)) n++;
    const r = Math.round((L - (n - 1) * g) / n); for (let k = 0; k < n - 1; k++) lens.push(r); lens.push(L - (n - 1) * (r + g));
  } else {
    let rem = L, k = 0;
    while (k < 200) {
      const fs = k === 0 ? (f0 ? 1 : 0) : 1;
      const lastMax = maxPart(sp, fs + (f1 ? 1 : 0), gOut);
      if (rem <= lastMax && k > 0) { lens.push(rem); break; }
      const Lk = maxPart(sp, fs + 1, 1);
      if (Lk < 50) { s.notify('Con esa sección el peso máximo no permite tramos útiles: revisa Archivo › Opciones › Tramos', 'error'); return null; }
      if (rem <= Lk + g) { const a = Math.floor((rem - g) / 2); lens.push(a, rem - g - a); break; } // la última no cabría entera: se reparten las dos
      lens.push(Lk); rem -= Lk + g; k++;
    }
  }
  // remate mínimo: si la última queda más corta que el mínimo, las dos últimas se reparten a partes iguales
  const minL = s.settings.segMinL ?? 300;
  if (lens.length >= 2 && lens[lens.length - 1] < minL) { const t = lens[lens.length - 2] + g + lens[lens.length - 1], a = Math.ceil((t - g) / 2); lens.splice(-2, 2, a, t - g - a); }
  const n = lens.length; if (n < 2) return null;
  const chain: string[] = [];
  lens.forEach((len, k) => { chain.push(ductDoc(sp, len, k === 0 ? f0 : true, k === n - 1 ? f1 : true, joint)); if (k < n - 1) chain.push(gasketDoc(sp, g, joint)); });
  const kgs = lens.map((len, k) => ductKg(sp, len, (k === 0 ? (f0 ? 1 : 0) : 1) + (k === n - 1 ? (f1 ? 1 : 0) : 1), k < n - 1 ? 1 : gOut, g, joint));
  return replaceByChain(occ, chain, `Tramo de ${L} mm dividido en ${n} partes: ${lens.map((x, k) => `${Math.round(x)} mm (${kgs[k].toFixed(1)} kg)`).join(' + ')} · máx. ${maxL} mm / ${maxKg} kg con bridas y juntas`);
}

// ---------- Unidades de montaje (conjunto de piezas que se fabrica y transporta junto) ----------
type Unit = { id: string; name: string; occs: string[] };
const partOfOcc = (id: string) => S().asm.occurrences.find((x) => x.id === id);
/** Peso (kg) de un componente: tramos y juntas con su cálculo de chapa/bridas/EPDM; el resto, volumen del modelo × densidad */
export function occKg(id: string) {
  const s = S(); const o = partOfOcc(id); if (!o) return 0; const sp = specOf(o.part); const { g, joint } = segCfg();
  if (sp?.kind === 'duct') { const f = origFlanges(sp); return ductKg(sp, sp.L, (f.f0 ? 1 : 0) + (f.f1 ? 1 : 0), 0, g, joint); }
  if (sp?.kind === 'gasket') return ductKg({ ...sp, kind: 'duct' }, 0, 0, 1, sp.L > 0 && sp.L < 20 ? sp.L : g, (sp.ends as 'tdc' | 'angle') ?? joint);
  const pd = s.docData(o.part) as PartDoc | null; const v = s.asmResult?.parts[o.part]?.props?.volume;
  const dens = (MATERIALS.find((m) => m.name === pd?.iProperties?.material)?.density ?? 7850);
  return v != null ? v * 1e-9 * dens : NaN;
}
/** Vértices del componente en coordenadas del ensamblaje (null si aún no hay malla) */
function occVerts(id: string): number[][] | null {
  const s = S(); const o = partOfOcc(id); const r = s.asmResult; const m = o && r?.parts[o.part]?.mesh; if (!m) return null;
  const X = r!.xf[id] ?? o!.xf; const out: number[][] = []; const P = m.vertices;
  for (let i = 0; i < P.length; i += 3) out.push(xfPoint(X, [P[i], P[i + 1], P[i + 2]]) as number[]);
  return out;
}
/** Medidas de la unidad: longitud = mayor lado de la caja envolvente (con bridas y juntas), peso = suma */
export function unitInfo(u: Unit) {
  const ids = u.occs.filter((id) => partOfOcc(id) && !partOfOcc(id)!.suppressed);
  const insK = S().asm.occurrences.filter((o) => o.tag === 'insulation' && o.host && ids.includes(o.host)).map((o) => o.id);
  const kg = [...ids, ...insK].reduce((a, id) => a + (occKg(id) || 0), 0);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; let ready = true;
  for (const id of ids) { const V = occVerts(id); if (!V) { ready = false; continue; } for (const p of V) for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; } }
  const dims = [0, 1, 2].map((k) => (isFinite(mx[k] - mn[k]) ? mx[k] - mn[k] : 0));
  const { maxL, maxKg } = segCfg();
  return { ids, kg, dims, len: Math.max(...dims), ready: ready && !Number.isNaN(kg), ok: Math.max(...dims) <= maxL + 0.5 && kg <= maxKg + 1e-6 };
}
/** Crea o redefine una unidad de montaje con los componentes indicados */
export function setUnit(occs: string[], id?: string, name?: string) {
  if (occs.length < 1) return;
  S().commitAsm((a) => {
    const L = (a.segUnits ??= []);
    for (const u of L) if (u.id !== id) u.occs = u.occs.filter((x) => !occs.includes(x)); // una pieza solo en una unidad
    const ex = id ? L.find((u) => u.id === id) : undefined;
    if (ex) { ex.occs = [...occs]; if (name) ex.name = name; }
    else L.push({ id: uid('su'), name: name ?? `U-${String(L.length + 1).padStart(2, '0')}`, occs: [...occs] });
    a.segUnits = L.filter((u) => u.occs.length);
  });
}
export function deleteUnit(id: string) { S().commitAsm((a) => { a.segUnits = (a.segUnits ?? []).filter((u) => u.id !== id); }); }
export const unitOf = (occ: string) => (S().asm.segUnits ?? []).find((u) => u.occs.includes(occ));

/** Ajusta la unidad a los máximos cortando sus tramos rectos de los extremos (brida + junta en el corte).
 *  Devuelve true si ha cortado algo. */
export function fitUnit(uid0: string, quiet = false): boolean {
  const s = S(); const u = (s.asm.segUnits ?? []).find((x) => x.id === uid0); if (!u) return false;
  const info = unitInfo(u); if (!info.ready || info.ok) { if (!quiet && info.ok) s.notify(`${u.name}: ${Math.round(info.len)} mm · ${info.kg.toFixed(1)} kg, dentro de ${segCfg().maxL} mm / ${segCfg().maxKg} kg`); return false; }
  const { maxL, maxKg, g, joint } = segCfg();
  const isG = (id: string) => specOf(partOfOcc(id)?.part ?? '')?.kind === 'gasket';
  const set = new Set(info.ids.filter((id) => !isG(id))); // las juntas de los extremos no cuentan como vecinas
  // tramos rectos de la unidad con la boca por la que siguen unidos a ella
  const cands: { id: string; L: number; keepIn: boolean; dir: number[]; sp: HvacSpec }[] = [];
  for (const id of info.ids) {
    const o = partOfOcc(id)!; const sp = specOf(o.part); if (sp?.kind !== 'duct') continue;
    const { eIn, eOut } = inOut(id);
    const nb = (ep: string) => s.asm.joints.some((j) => j.ep && !j.suppressed && ((j.a.occ === id && j.ep.a === ep && set.has(j.b.occ)) || (j.b.occ === id && j.ep.b === ep && set.has(j.a.occ))));
    const inU = nb(eIn), outU = nb(eOut);
    if (inU && outU && info.ids.length > 1) continue; // en medio de la unidad: no se acorta
    const F = R.epFrame(id, 'ep1'), G = R.epFrame(id, 'ep2'); if (!F || !G) continue;
    const d = G.P.clone().sub(F.P).normalize();
    cands.push({ id, L: sp.L, keepIn: inU || !outU, dir: [Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)], sp });
  }
  if (!cands.length) { if (!quiet) s.notify(`${u.name}: ${Math.round(info.len)} mm · ${info.kg.toFixed(1)} kg supera ${maxL} mm / ${maxKg} kg y no tiene tramos rectos en sus extremos para cortar`, 'error'); return false; }
  // por longitud: el tramo más alineado con el lado mayor; por peso: el más largo
  const axis = info.dims.indexOf(Math.max(...info.dims));
  const overL = info.len - maxL, overKg = info.kg - maxKg;
  const c = overL > 0.5 ? cands.sort((a, b) => b.dir[axis] - a.dir[axis] || b.L - a.L)[0] : cands.sort((a, b) => b.L - a.L)[0];
  const a = ductKg(c.sp, 1000, 0, 0, g, joint) / 1000;            // kg por mm de chapa
  const fl = ductKg(c.sp, 0, 1, 0, g, joint), gk = ductKg(c.sp, 0, 0, 1, g, joint);
  let keep = c.L;
  if (overL > 0.5 && c.dir[axis] > 0.7) keep = Math.min(keep, c.L - overL / c.dir[axis] - g);
  // peso: se quita chapa y se añaden la brida del corte y la junta
  const rest = info.kg - ductKg(c.sp, c.L, 0, 0, g, joint);
  keep = Math.min(keep, (maxKg - rest - fl - gk) / a);
  keep = Math.floor(keep);
  // si al otro lado de la brida del extremo ya hay junta + tramo recto fuera de la unidad, se le pasa la longitud que sobra
  const bEp = c.keepIn ? inOut(c.id).eOut : inOut(c.id).eIn;
  const nbr = (occ: string, ep?: string) => s.asm.joints.filter((j) => j.ep && !j.suppressed && ((j.a.occ === occ && (!ep || j.ep.a === ep)) || (j.b.occ === occ && (!ep || j.ep.b === ep)))).map((j) => (j.a.occ === occ ? j.b.occ : j.a.occ));
  const gNb = nbr(c.id, bEp).find((x) => specOf(partOfOcc(x)?.part ?? '')?.kind === 'gasket');
  const outer = gNb ? nbr(gNb).find((x) => x !== c.id && !set.has(x) && isStraightDuct(x)) : undefined;
  if (outer && keep >= 100 && keep < c.L) {
    const oL = specOf(partOfOcc(outer)!.part)!.L, delta = c.L - keep;
    setDuctLength(c.id, keep); setDuctLength(outer, oL + delta);
    S().notify(`${u.name}: ${Math.round(info.len)} mm / ${info.kg.toFixed(1)} kg → ${partOfOcc(c.id)?.name ?? 'tramo'} acortado a ${keep} mm y el tramo contiguo alargado ${Math.round(delta)} mm (máx. ${maxL} mm / ${maxKg} kg)`);
    return true;
  }
  if (keep < 100 || keep > c.L - g - 50) { if (!quiet) s.notify(`${u.name}: no se puede ajustar cortando ${partOfOcc(c.id)?.name} (quedaría ${keep} mm); revisa la unidad`, 'error'); return false; }
  const d = c.keepIn ? keep : c.L - keep - g;
  const ids = cutDuct(c.id, d); if (!ids) return false;
  const drop = c.keepIn ? ids[2] : ids[0]; // la parte cortada sale de la unidad (la junta del corte se queda)
  S().commitAsm((A) => {
    const uu = (A.segUnits ?? []).find((x) => x.id === uid0); if (!uu) return;
    uu.occs = uu.occs.filter((x) => x !== drop);
    // juntas que ya no tocan ninguna pieza de la unidad (quedaron en la parte cortada): fuera
    const gk = (id: string) => specOf(A.occurrences.find((o) => o.id === id)?.part ?? '')?.kind === 'gasket';
    const solid = new Set(uu.occs.filter((x) => !gk(x)));
    uu.occs = uu.occs.filter((x) => !gk(x) || A.joints.some((j) => (j.a.occ === x && solid.has(j.b.occ)) || (j.b.occ === x && solid.has(j.a.occ))));
  });
  S().notify(`${u.name}: ${Math.round(info.len)} mm / ${info.kg.toFixed(1)} kg → tramo cortado a ${keep} mm para cumplir ${maxL} mm / ${maxKg} kg (bridas y junta en el corte)`);
  return true;
}

// ---------- Actualización automática: al cambiar el ensamblaje o una pieza, los tramos que pasen de los máximos se dividen ----------
let autoTm: ReturnType<typeof setTimeout> | null = null, busy = false, lastAsm: unknown = null, lastDocs: unknown = null, lastRes: unknown = null;
useStore.subscribe((st) => {
  if (busy || st.kind !== 'assembly' || !(st.settings.segAuto ?? true)) return;
  if (st.asm === lastAsm && st.docs === lastDocs && st.asmResult === lastRes) return; lastAsm = st.asm; lastDocs = st.docs; lastRes = st.asmResult;
  if (st.future.length) return; // tras deshacer no se vuelve a dividir
  if (autoTm) clearTimeout(autoTm);
  autoTm = setTimeout(() => {
    const s = S(); if (s.kind !== 'assembly' || s.future.length) return;
    const inUnit = new Set((s.asm.segUnits ?? []).flatMap((u) => u.occs));
    const bad = s.asm.occurrences.filter((o) => !o.suppressed && !inUnit.has(o.id) && isStraightDuct(o.id) && ductCheck(o.id)?.ok === false).map((o) => o.id);
    let changed = false;
    busy = true;
    try {
      let n = 0; for (const id of bad) if (segmentDuct(id, true)) n++; if (n > 1) s.notify(`${n} tramos ajustados a ${segCfg().maxL} mm / ${segCfg().maxKg} kg con bridas y juntas`);
      changed = n > 0;
      if (!changed) for (const u of S().asm.segUnits ?? []) { if (fitUnit(u.id, true)) { changed = true; break; } }
    }
    finally { busy = false; lastAsm = S().asm; lastDocs = S().docs; lastRes = S().asmResult; }
  }, 400);
});

/** Divide todos los tramos rectos del ensamblaje que superen los máximos */
export function segmentAll() {
  const ids = S().asm.occurrences.filter((o) => isStraightDuct(o.id)).map((o) => o.id);
  let n = 0; for (const id of ids) if (segmentDuct(id, true)) n++;
  S().notify(n ? `${n} tramo(s) divididos (máx. ${segCfg().maxL} mm / ${segCfg().maxKg} kg)` : 'Ningún tramo supera la longitud ni el peso máximos');
}

/** Inserta la pieza `pid` (dos bocas en línea: compuerta, silenciador, cortafuegos, manguito, transición…) a `d` mm de la entrada del tramo */
export function insertInline(occ: string, d: number, pid: string) {
  const s = S(); const o = s.asm.occurrences.find((x) => x.id === occ); const sp = o && specOf(o.part);
  if (!sp || sp.kind !== 'duct') { s.notify('Insertar en línea: elige un tramo recto de conducto', 'error'); return; }
  const eps = partEPoints(s.docData(pid) as PartDoc);
  const e1 = eps.find((e) => e.id === 'ep1'), e2 = eps.find((e) => e.id === 'ep2');
  const ok = e1 && e2 && Math.abs(e1.dir[2] + 1) < 1e-6 && Math.abs(e2.dir[2] - 1) < 1e-6;
  if (!ok) { s.notify('Esa pieza no tiene dos bocas en línea (entrada y salida opuestas): no se puede insertar dentro del tramo', 'error'); return; }
  const Lc = e2!.point[2] - e1!.point[2]; const L = sp.L;
  if (d < 50 || d + Lc > L - 50) { s.notify(`No cabe: la pieza mide ${Math.round(Lc)} mm y el tramo ${L} mm (deja al menos 50 mm a cada lado)`, 'error'); return; }
  const m2 = e2!.mouth; const { f0, f1 } = orient(occ, sp);
  const sp2: HvacSpec = m2 ? { ...sp, shape: m2.shape, W: m2.W, H: m2.H, D: m2.D } : sp;
  const name = (S().docs.find((x) => x.id === pid)?.fileName ?? 'pieza').replace(/\.i3p$/, '');
  return replaceByChain(occ, [ductDoc(sp, d, f0, false, 'tdc'), pid, ductDoc(sp2, L - d - Lc, false, f1, 'tdc')], `${name} insertado en línea a ${Math.round(d)} mm (tramos de ${Math.round(d)} y ${Math.round(L - d - Lc)} mm)`);
}

/** Cambiar la longitud de un tramo recto (lo de detrás se recoloca) */
export function setDuctLength(occ: string, L: number) {
  const s = S(); const o = s.asm.occurrences.find((x) => x.id === occ); const sp = o && specOf(o.part);
  if (!sp || sp.kind !== 'duct') { s.notify('Longitud: elige un tramo recto de conducto', 'error'); return; }
  if (!(L >= 20)) { s.notify('Longitud no válida', 'error'); return; }
  const { f0, f1 } = orient(occ, sp);
  return replaceByChain(occ, [ductDoc(sp, L, f0, f1, (sp.ends === 'angle' ? 'angle' : 'tdc'))], `Tramo: ${sp.L} → ${L} mm`);
}

// ---------- Ramal: el componente y todo lo que arrastra detrás ----------
import { epGroup, asmActions as AA, foranJoinExt } from './actions';
import * as R from './hvacroute';

export function deleteBranch(occ: string) {
  const ids = new Set(epGroup(occ));
  S().commitAsm((a) => { a.occurrences = a.occurrences.filter((o) => !ids.has(o.id)); a.joints = a.joints.filter((j) => !ids.has(j.a.occ) && !ids.has(j.b.occ)); });
  useStore.setState({ selItem: null, selGroup: null });
  S().notify(`Ramal borrado: ${ids.size} componente(s)`);
}
/** Copia el ramal desplazado `d` (las uniones internas se copian; la copia queda fija por su primera pieza) */
export function copyBranch(occ: string, d: V3) {
  const ids = epGroup(occ); const map = new Map(ids.map((id) => [id, uid('o')]));
  S().commitAsm((a) => {
    const cnt = new Map<string, number>(); for (const x of a.occurrences) cnt.set(x.part, (cnt.get(x.part) ?? 0) + 1);
    for (const id of ids) {
      const o = a.occurrences.find((x) => x.id === id); if (!o) continue; const X = xfOf(id); const n = (cnt.get(o.part) ?? 0) + 1; cnt.set(o.part, n);
      a.occurrences.push({ ...o, id: map.get(id)!, name: o.name.replace(/:\d+$/, `:${n}`), xf: { pos: v3.add(X.pos, d) as V3, quat: [...X.quat] as Q }, grounded: id === occ ? true : undefined } as typeof o);
    }
    for (const j of [...a.joints]) if (map.has(j.a.occ) && map.has(j.b.occ)) a.joints.push({ ...j, id: uid('j'), name: `${j.name} (copia)`, a: { ...j.a, occ: map.get(j.a.occ)! }, b: { ...j.b, occ: map.get(j.b.occ)! } });
  });
  useStore.setState({ selItem: map.get(occ)!, selGroup: [...map.values()] });
  S().notify(`Ramal copiado (${ids.length} componentes) desplazado ${d.join(', ')} mm; la copia queda fija por su primera pieza`);
}
/** Cambiar la sección del ramal (desde la pieza hacia delante) con una reducción en la unión con la pieza anterior */
export function changeSection(occ: string, sec: { W?: number; H?: number; D?: number }, trL = 300) {
  const s = S(); const o0 = s.asm.occurrences.find((x) => x.id === occ); const sp0 = o0 && specOf(o0.part);
  if (!sp0) { s.notify('Cambiar sección: el componente no es una pieza HVAC generada', 'error'); return; }
  const old = { shape: sp0.shape, W: sp0.W, H: sp0.H, D: sp0.D };
  const ids = epGroup(occ); let n = 0;
  const repl = new Map<string, string>();
  for (const id of ids) {
    const o = s.asm.occurrences.find((x) => x.id === id); const sp = o && specOf(o.part); if (!sp || sp.shape !== old.shape) continue;
    let nsp: HvacSpec | null = null;
    if (old.shape === 'round') { if (Math.abs(sp.D - old.D) < 0.5 && sec.D) nsp = { ...sp, D: sec.D }; }
    else if (sec.W && sec.H) {
      if (Math.abs(sp.W - old.W) < 0.5 && Math.abs(sp.H - old.H) < 0.5) nsp = { ...sp, W: sec.W, H: sec.H };
      else if (Math.abs(sp.W - old.H) < 0.5 && Math.abs(sp.H - old.W) < 0.5) nsp = { ...sp, W: sec.H, H: sec.W };
    }
    if (!nsp) continue;
    try { repl.set(id, partFor(makeHvacPart(nsp))); n++; } catch (e) { s.notify(`${o!.name}: ${(e as Error).message}`, 'error'); }
  }
  if (!n) { s.notify('Ninguna pieza del ramal tiene esa sección', 'error'); return; }
  const jIn = foranJoint(occ);
  s.commitAsm((a) => { for (const o of a.occurrences) if (repl.has(o.id)) { o.part = repl.get(o.id)!; o.name = `${(S().docs.find((d) => d.id === o.part)?.fileName ?? o.name).replace(/\.i3p$/, '')}:${o.name.split(':').pop()}`; } });
  // reducción en la unión con la pieza anterior
  if (jIn?.ep) {
    const side = jIn.a.occ === occ ? 'a' : 'b'; const up = side === 'a' ? jIn.b : jIn.a; const upEp = jIn.ep[side === 'a' ? 'b' : 'a']; const myEp = jIn.ep[side];
    const Fu = R.epFrame(up.occ, upEp); const m = Fu?.m;
    if (Fu && m) {
      const tr = partFor(makeHvacPart({ ...sp0, kind: 'transition', shape: m.shape, W: m.W, H: m.H, D: m.D, shape2: old.shape, W2: sec.W ?? sp0.W, H2: sec.H ?? sp0.H, D2: sec.D ?? sp0.D, L: trL, ex: 0, ey: 0, ends: 'none' }));
      const tid = uid('o');
      s.commitAsm((a) => { a.joints = a.joints.filter((j) => j.id !== jIn.id); a.occurrences.push({ id: tid, name: `${(S().docs.find((d) => d.id === tr)?.fileName ?? 'Reducción').replace(/\.i3p$/, '')}:1`, part: tr, xf: { pos: [0, 0, 0], quat: [0, 0, 0, 1] } }); });
      const trPd = S().docData(tr) as PartDoc; const e1 = partEPoints(trPd).find((e) => e.id === 'ep1')!;
      foranJoinExt(tid, trPd, e1, up.occ, Fu);
      const F2 = R.epFrame(tid, 'ep2'); const myPd = S().docData(repl.get(occ) ?? o0!.part) as PartDoc; const me = partEPoints(myPd).find((e) => e.id === myEp);
      if (F2 && me) foranJoinExt(occ, myPd, me, tid, F2);
    }
  }
  useStore.setState({ selItem: occ, selGroup: null });
  s.notify(`Sección del ramal: ${old.shape === 'round' ? `Ø${old.D} → Ø${sec.D}` : `${old.W}×${old.H} → ${sec.W}×${sec.H}`} en ${n} pieza(s)${jIn ? `, con reducción de ${trL} mm` : ''}`);
  void AA;
}
export function changeSectionPrompt(occ: string) {
  const o = S().asm.occurrences.find((x) => x.id === occ); const sp = o && specOf(o.part);
  if (!sp) { S().notify('Cambiar sección: el componente no es una pieza HVAC generada', 'error'); return; }
  const v = prompt(sp.shape === 'round' ? `Nuevo diámetro (actual Ø${sp.D})` : `Nueva sección W×H (actual ${sp.W}×${sp.H})`, sp.shape === 'round' ? String(sp.D) : `${sp.W}x${sp.H}`);
  if (!v) return;
  const n = v.split(/[x×*,; ]+/i).map((x) => parseFloat(x.replace(',', '.'))).filter((x) => x > 0);
  if (sp.shape === 'round') { if (n[0]) changeSection(occ, { D: n[0] }); }
  else if (n.length >= 2) changeSection(occ, { W: n[0], H: n[1] });
}
