// Operaciones de tendido sobre tramos rectos de conducto: cortar (bridas + junta), insertar en línea,
// dividir en tramos (longitud/peso máximos), cambiar la longitud. El tramo se sustituye por una cadena de
// piezas colineales unidas por ePoints, con las uniones de antes y de después reconectadas.
import { useStore } from '../core/store';
import { uid, v3, type V3, type PartDoc } from '../core/doc';
import { epJoint, partEPoints, type EPoint } from '../core/epoints';
import { q as qq, type Xform, type Joint } from '../core/asm';
import { makeHvacPart, type HvacSpec } from '../core/hvac';
import { foranJoint, xfOf } from './actions';

const S = () => useStore.getState();
type Q = Xform['quat'];
const conj = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]];
const ROTX180: Q = [1, 0, 0, 0];
type HPart = PartDoc & { hvacSpec?: HvacSpec };
const specOf = (pid: string) => (S().docData(pid) as HPart | null)?.hvacSpec;

export const segCfg = () => { const st = S().settings; return { maxL: st.segMaxL ?? 1500, maxKg: st.segMaxKg ?? 80, joint: st.segJoint ?? 'tdc', g: st.segGasket ?? 4, auto: st.segAuto ?? true }; };

/** ¿Es un tramo recto de conducto (con especificación)? */
export function isStraightDuct(occ: string) { const o = S().asm.occurrences.find((x) => x.id === occ); const sp = o && specOf(o.part); return !!sp && sp.kind === 'duct'; }

/** Peso aproximado (kg) de un tramo: chapa + bridas (acero 7850 kg/m³) */
export function ductKg(sp: HvacSpec, L: number, flanges = 0) {
  const t = sp.t ?? (sp.shape === 'round' ? (sp.D <= 200 ? 0.5 : sp.D <= 500 ? 0.6 : sp.D <= 800 ? 0.8 : 1) : Math.max(sp.W, sp.H) <= 500 ? 0.6 : Math.max(sp.W, sp.H) <= 1000 ? 0.8 : Math.max(sp.W, sp.H) <= 2000 ? 1 : 1.2);
  const per = sp.shape === 'round' ? Math.PI * sp.D : sp.shape === 'oval' ? Math.PI * sp.H + 2 * (sp.W - sp.H) : 2 * (sp.W + sp.H);
  const k = 7.85e-6, sheet = per * L * t * k;
  const fl = per * 60 * 3 * k; // brida por extremo (≈ marco 30×30×3)
  return sheet + flanges * fl;
}

/** Documento de pieza (reutiliza el ya abierto con el mismo nombre) */
function partFor(doc: PartDoc) {
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
    const news = chain.map((pid, k) => { const n = (cnt.get(pid) ?? 0) + 1; cnt.set(pid, n); return { id: ids[k], name: `${base(pid)}:${n}`, part: pid, xf: xfs[k], ...(k === 0 && o.grounded ? { grounded: true } : {}), ...(o.system ? { system: o.system } : {}) }; });
    a.occurrences.splice(at, 1, ...(news as typeof a.occurrences));
    const oq = X.quat;
    const keep: Joint[] = [];
    for (const j of a.joints) {
      if (j.a.occ !== occ && j.b.occ !== occ) { keep.push(j); continue; }
      if (!j.ep) continue; // otras restricciones sobre el tramo se pierden
      const side = j.a.occ === occ ? 'a' : 'b'; const e = j.ep[side];
      const k = e === eIn ? 0 : e === eOut ? chain.length - 1 : -1; if (k < 0) continue;
      const newEp = k === 0 ? 'ep1' : 'ep2';
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

/** Dividir el tramo en partes iguales que no pasen de la longitud ni del peso máximos (bridas + junta entre partes) */
export function segmentDuct(occ: string, quiet = false) {
  const s = S(); const o = s.asm.occurrences.find((x) => x.id === occ); const sp = o && specOf(o.part);
  if (!sp || sp.kind !== 'duct') { if (!quiet) s.notify('Dividir: elige un tramo recto de conducto', 'error'); return null; }
  const { maxL, maxKg, joint, g } = segCfg(); const L = sp.L;
  let n = Math.max(1, Math.ceil(L / maxL));
  while (n < 200 && ductKg(sp, (L - (n - 1) * g) / n, 2) > maxKg) n++;
  if (n <= 1) { if (!quiet) s.notify(`El tramo (${L} mm, ≈${ductKg(sp, L).toFixed(1)} kg) no supera ${maxL} mm ni ${maxKg} kg`); return null; }
  const seg = (L - (n - 1) * g) / n, r = Math.round(seg);
  const { f0, f1 } = orient(occ, sp);
  const chain: string[] = [];
  for (let k = 0; k < n; k++) {
    const len = k < n - 1 ? r : L - (n - 1) * g - r * (n - 1);
    chain.push(ductDoc(sp, len, k === 0 ? f0 : true, k === n - 1 ? f1 : true, joint));
    if (k < n - 1) chain.push(gasketDoc(sp, g, joint));
  }
  return replaceByChain(occ, chain, `Tramo de ${L} mm dividido en ${n} partes de ≈${r} mm (≈${ductKg(sp, r, 2).toFixed(1)} kg cada una; máx. ${maxL} mm / ${maxKg} kg) con bridas y juntas`);
}
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
