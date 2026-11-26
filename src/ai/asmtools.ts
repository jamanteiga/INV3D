// Herramientas de ensamblaje del asistente IA: generadores (HVAC, tubería) colocados y unidos por ePoints (filosofía Foran),
// giro/desplazamiento/cambio de boca de las uniones y revisión del ensamblaje.
import * as THREE from 'three';
import { useStore } from '../core/store';
import { makeHvacPart, type HvacSpec } from '../core/hvac';
import { makePipePart, type PipeSpec } from '../core/piping';
import { PIPE_MATERIALS } from '../core/pipedata';
import { partEPoints } from '../core/epoints';
import { q as qq } from '../core/asm';
import { asmActions, foranTarget, foranJoint } from '../ui/actions';
import * as R from '../ui/hvacroute';
import type { PartDoc } from '../core/doc';
import type { GTool } from './gemini';

type V3 = [number, number, number];
const S = () => useStore.getState();
const r1 = (x: number) => Math.round(x * 10) / 10;
const AX: Record<string, V3> = { '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0], '+Z': [0, 0, 1], '-Z': [0, 0, -1] };
const parseJ = <T,>(t: unknown): T => (typeof t === 'string' ? (JSON.parse(t) as T) : (t as T));
const wait = async () => { await new Promise((r) => setTimeout(r, 200)); const t0 = Date.now(); while (S().busy && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 150)); await new Promise((r) => setTimeout(r, 300)); };

/** Bocas libres (ePoints sin unir) de todos los componentes, con su sección y su posición/dirección en el ensamblaje */
export function freePorts() {
  const s = S(); const out: { occ: string; comp: string; ep: string; name: string; section: string; P: number[]; dir: number[] }[] = [];
  const used = new Set<string>(); for (const j of s.asm.joints) if (j.ep && !j.suppressed) { used.add(`${j.a.occ}:${j.ep.a}`); used.add(`${j.b.occ}:${j.ep.b}`); }
  for (const o of s.asm.occurrences) {
    if (o.suppressed) continue;
    const pd = s.docData(o.part) as PartDoc | null; if (!pd || !('features' in pd)) continue;
    for (const e of R.portsOf(pd)) {
      if (e.isDefault || used.has(`${o.id}:${e.id}`)) continue;
      const F = R.epFrame(o.id, e.id); if (!F) continue;
      const m = F.m; const section = m ? (m.shape === 'round' ? `Ø${m.D}` : `${m.shape === 'oval' ? 'oval ' : ''}${m.W}×${m.H}`) : e.name;
      out.push({ occ: o.id, comp: o.name, ep: e.id, name: e.name, section, P: [r1(F.P.x), r1(F.P.y), r1(F.P.z)], dir: [F.D.x, F.D.y, F.D.z].map((v) => Math.round(v * 1000) / 1000) });
    }
  }
  return out;
}
export function portsContext(): string {
  const f = freePorts(); if (!f.length) return '';
  return 'Bocas libres (occ · ep · sección · punto · dirección): ' + f.slice(0, 40).map((p) => `${p.occ}·${p.ep}·${p.section}·(${p.P.join(', ')})·(${p.dir.join(', ')})`).join('; ');
}

interface Placement { at?: { occ: string; ep: string }; towards?: string; roll?: number; first?: { ep?: string; pos?: number[]; face?: string; roll?: number; grounded?: boolean } }
/** Boca de destino (la indicada o la de la filosofía Foran) */
function targetOf(pl: Placement) {
  const s = S();
  if (pl.at) { const F = R.epFrame(pl.at.occ, pl.at.ep); if (!F) throw new Error(`No existe la boca ${pl.at.occ}·${pl.at.ep}`); return F; }
  const T = foranTarget(s.selItem); if (!T || !T.ep) return null;
  return R.epFrame(T.occ, T.ep);
}
/** Elige el giro (arriba/abajo/izquierda/derecha) cuya dirección se acerca más a la dirección mundial pedida */
function setTurn(F: NonNullable<ReturnType<typeof R.epFrame>>, towards?: string, roll = 0) {
  R.useRoute.setState({ roll });
  if (!towards) return;
  const w = AX[towards.toUpperCase().replace('−', '-')]; if (!w) throw new Error(`Dirección no válida: ${towards} (usa +X, -X, +Y, -Y, +Z o -Z)`);
  const W = new THREE.Vector3(...w);
  let best: 'up' | 'down' | 'left' | 'right' = 'right', bd = -2;
  for (const d of ['up', 'down', 'left', 'right'] as const) { const T = R.turnDir(F as never, d, 0); const v = T.dot(W); if (v > bd) { bd = v; best = d; } }
  R.useRoute.setState({ dir: best });
}
const fileOf = (doc: PartDoc) => doc.iProperties.partNumber.replace(/[\\/:*?"<>|]+/g, '_') + '.i3p';
function addPart(doc: PartDoc) { const s = S(); const fn = fileOf(doc); return s.docs.find((d) => d.fileName === fn)?.id ?? s.addDocument('part', doc, fn, false); }

/** Coloca la pieza pid en el ensamblaje activo según la colocación pedida y devuelve el componente nuevo */
async function placeDoc(pid: string, pl: Placement, F: ReturnType<typeof targetOf>) {
  const s = S();
  const before = new Set(s.asm.occurrences.map((o) => o.id));
  if (!s.asm.occurrences.length) {
    const pd = s.docData(pid) as PartDoc;
    const eps = partEPoints(pd).filter((e) => !e.inactive && e.kind !== 'composite');
    const e = eps.find((x) => x.id === pl.first?.ep) ?? eps.find((x) => !x.isDefault) ?? eps[0];
    const p: V3 = (e?.point ?? [0, 0, 0]) as V3, from = new THREE.Vector3(...((e?.dir ?? [0, 0, 1]) as V3)).normalize();
    const to = pl.first?.face ? new THREE.Vector3(...AX[pl.first.face.toUpperCase()] ?? [0, 0, 1]) : from.clone();
    const q1 = new THREE.Quaternion().setFromUnitVectors(from, to);
    const qr = new THREE.Quaternion().setFromAxisAngle(to, ((pl.first?.roll ?? 0) * Math.PI) / 180);
    const qt = qr.multiply(q1); const quat: [number, number, number, number] = [qt.x, qt.y, qt.z, qt.w];
    const pr = qq.rotate(quat, p); const D = (pl.first?.pos ?? [0, 0, 0]) as V3;
    asmActions.startPlace(pid, [], { pos: [D[0] - pr[0], D[1] - pr[1], D[2] - pr[2]], quat, grounded: pl.first?.grounded ?? true, label: 'por el asistente' });
  } else {
    if (!F) throw new Error('No hay ninguna boca libre a la que unir la pieza: indica «at» o coloca antes el primer componente');
    const e = F.e;
    useStore.setState({ createTarget: { occ: F.o.id, ref: { occ: F.o.id, point: e.point, normal: e.dir, kind: 'plane' }, ep: e.id, epKind: e.kind, label: F.name, pW: [F.P.x, F.P.y, F.P.z], nW: [F.D.x, F.D.y, F.D.z] } });
    if (!asmActions.placeAtTarget(pid, [], { noRecurse: true })) throw new Error('No se pudo unir la pieza a la boca');
  }
  if (S().placing) S().setTool(null);
  useStore.setState({ dialog: null });
  await wait();
  const occ = S().asm.occurrences.find((o) => !before.has(o.id));
  if (!occ) throw new Error('No se ha colocado el componente');
  const st = S();
  const jErr = Object.entries(st.asmResult?.errors ?? {}).map(([k, v]) => `${st.asm.joints.find((j) => j.id === k)?.name ?? k}: ${v}`);
  return { occ: occ.id, name: occ.name, dof: st.asmDof?.[occ.id], jointErrors: jErr, freePorts: freePorts().filter((p) => p.occ === occ.id) };
}

export const ASM_TOOLS: GTool[] = [
  { name: 'list_free_ports', description: 'Bocas libres (ePoints sin unir) de los componentes del ensamblaje activo: occ, ep, sección, punto y dirección hacia fuera.' },
  { name: 'insert_hvac', description: 'Genera una pieza HVAC (conducto, codo, transición, derivación, compuerta, terminal…) y, en un ensamblaje, la coloca UNIDA por ePoints a una boca (filosofía Foran) con 0 GDL. Si spec no da la sección, toma la de la boca de destino. En codos y derivaciones rectangulares hacia el lado H se cambian W y H solos.',
    parameters: { type: 'OBJECT', properties: {
      spec: { type: 'STRING', description: 'JSON HvacSpec: {"kind":"duct|elbow|transition|branch|coupling|cap|plenum|grille|diffuser|damper|firedamper|silencer|flex|ahu|fancoil|flange","shape":"rect|round|oval","W":600,"H":400,"D":400,"L":1200,"angle":90,"elbowType":"radius|square|segmented|smooth","shape2":"rect|round","W2":400,"H2":300,"D2":250,"branch":"tee|shoe|y|collar","seam":"long|spiral","ends":"none|tdc|angle|socket"} (W anchura, H altura, D diámetro, mm; L longitud)' },
      at: { type: 'STRING', description: 'JSON {"occ":"...","ep":"ep2"}: boca de destino. Si se omite: la boca libre del componente seleccionado o del último insertado' },
      towards: { type: 'STRING', description: 'Codos/derivaciones: dirección mundial hacia la que gira la salida (+X, -X, +Y, -Y, +Z, -Z)' },
      roll: { type: 'NUMBER', description: 'Giro extra en grados (solo circulares)' },
      first: { type: 'STRING', description: 'Solo si el ensamblaje está vacío: JSON {"ep":"ep1","pos":[x,y,z],"face":"+X","roll":0,"grounded":true} (ePoint que va al punto pos, hacia dónde mira y giro sobre su eje)' },
      summary: { type: 'STRING' } }, required: ['spec', 'summary'] } },
  { name: 'insert_pipe', description: 'Genera una pieza de tubería ASME/EN (tubo, brida, codo, te, te reducida, cruz, reducción, casquete, portabridas, manguito) y, en un ensamblaje, la coloca unida por ePoints a un extremo libre (Foran), con 0 GDL. Si spec no da norma/tamaño/schedule/material, los toma de la pieza de destino.',
    parameters: { type: 'OBJECT', properties: {
      spec: { type: 'STRING', description: 'JSON PipeSpec: {"kind":"pipe|flange|elbow|tee|rtee|cross|reducer|cap|stub|coupling","norm":"ASME|EN","size":"4" (NPS) o "100" (DN),"size2":"3","sch":"40|STD|80…","wall":3.6 (EN),"length":1000,"flStd":"B16.5|B16.47A|B16.47B|EN1092","rating":150 (clase) o 16 (PN),"flType":"WN|SO|BL|LJ|SW|TH" o tipo EN "01|05|11|12|13","elbow":"LR|SR|3D|5D","angle":90,"ecc":false,"material":"…"}' },
      at: { type: 'STRING', description: 'JSON {"occ":"...","ep":"ep2"} extremo de destino (si se omite: el libre del seleccionado o del último)' },
      towards: { type: 'STRING', description: 'Codos/tes: dirección mundial de la salida (+X…-Z)' },
      roll: { type: 'NUMBER' },
      first: { type: 'STRING', description: 'Solo con el ensamblaje vacío: JSON {"ep":"ep1","pos":[x,y,z],"face":"+X","roll":0}' },
      summary: { type: 'STRING' } }, required: ['spec', 'summary'] } },
  { name: 'insert_open_part', description: 'Coloca en el ensamblaje una pieza ya abierta (por su nombre de fichero) unida por ePoints a una boca libre.',
    parameters: { type: 'OBJECT', properties: { fileName: { type: 'STRING' }, at: { type: 'STRING' }, towards: { type: 'STRING' }, first: { type: 'STRING' }, summary: { type: 'STRING' } }, required: ['fileName', 'summary'] } },
  { name: 'spin_component', description: 'Gira un componente unido por ePoints (y lo que cuelga de él) sobre el eje de su unión.', parameters: { type: 'OBJECT', properties: { occ: { type: 'STRING' }, deg: { type: 'NUMBER' }, summary: { type: 'STRING' } }, required: ['occ', 'deg', 'summary'] } },
  { name: 'offset_component', description: 'Separa un componente unido a lo largo del eje de su unión (mm; 0 = encajado).', parameters: { type: 'OBJECT', properties: { occ: { type: 'STRING' }, mm: { type: 'NUMBER' }, summary: { type: 'STRING' } }, required: ['occ', 'mm', 'summary'] } },
  { name: 'reconnect_component', description: 'Une un componente a otra boca libre (toOcc·toEp), quitando su unión anterior.', parameters: { type: 'OBJECT', properties: { occ: { type: 'STRING' }, toOcc: { type: 'STRING' }, toEp: { type: 'STRING' }, summary: { type: 'STRING' } }, required: ['occ', 'toOcc', 'toEp', 'summary'] } },
  { name: 'delete_components', description: 'Elimina componentes del ensamblaje (y sus uniones).', parameters: { type: 'OBJECT', properties: { occs: { type: 'ARRAY', items: { type: 'STRING' } }, summary: { type: 'STRING' } }, required: ['occs', 'summary'] } },
  { name: 'check_assembly', description: 'Revisa el ensamblaje: bocas libres, uniones con secciones que no casan, componentes con GDL, restricciones con error.' },
];
export const ASM_MODIFY = new Set(['insert_hvac', 'insert_pipe', 'insert_open_part', 'spin_component', 'offset_component', 'reconnect_component', 'delete_components']);

export async function execAsmTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const s = S();
  if (name === 'list_free_ports') return { ports: freePorts() };
  if (name === 'check_assembly') return checkAssembly();
  const pl: Placement = { at: args.at ? parseJ(args.at) : undefined, towards: args.towards as string | undefined, roll: Number(args.roll ?? 0) || 0, first: args.first ? parseJ(args.first) : undefined };
  if (name === 'insert_hvac' || name === 'insert_pipe' || name === 'insert_open_part') {
    const asm = s.kind === 'assembly';
    const F = asm && s.asm.occurrences.length ? targetOf(pl) : null;
    if (F) setTurn(F, pl.towards, pl.roll);
    let pid: string;
    if (name === 'insert_open_part') {
      const d = s.docs.find((x) => x.fileName === args.fileName || x.fileName === `${args.fileName}.i3p`); if (!d) return { error: `No está abierta: ${args.fileName}` }; pid = d.id;
    } else if (name === 'insert_hvac') {
      const sp = parseJ<Partial<HvacSpec>>(args.spec);
      const m = F?.m;
      const spec: HvacSpec = { std: 'EN', ends: 'none', material: 'Acero galvanizado DX51D+Z275', L: 1200, angle: 90, elbowType: 'radius', W: m?.W ?? 600, H: m?.H ?? 400, D: m?.D ?? 400, shape: m?.shape ?? 'rect', ...sp } as HvacSpec;
      if (!sp.shape && m) spec.shape = m.shape;
      // codos y derivaciones rectangulares hacia el lado H: W y H cambiados para que las bocas casen
      if (F && (spec.kind === 'elbow' || spec.kind === 'branch') && spec.shape !== 'round' && R.turnNeedsSwap(F, R.turnOf(F)) && sp.W == null) { const w = spec.W; spec.W = spec.H; spec.H = w; }
      const doc = makeHvacPart(spec);
      if (!asm) { s.addDocument('part', doc, fileOf(doc)); return { ok: true, part: doc.iProperties.description }; }
      pid = addPart(doc);
    } else {
      const sp = parseJ<Partial<PipeSpec>>(args.spec);
      const tp = F ? ((S().docData(S().asm.occurrences.find((o) => o.id === F.o.id)!.part) as PartDoc & { pipeSpec?: PipeSpec }).pipeSpec) : undefined;
      const norm = sp.norm ?? tp?.norm ?? 'ASME';
      const use = sp.kind === 'pipe' ? 'pipe' : sp.kind === 'flange' ? 'flange' : 'fitting';
      const defMat = PIPE_MATERIALS.find((x) => x.std === norm && (x.use as string[]).includes(use))?.name ?? (norm === 'ASME' ? 'SA-106 Gr. B' : 'P235GH (EN 10216-2)');
      const spec = { norm, size: tp?.size ?? (norm === 'ASME' ? '4' : '100'), sch: tp?.sch, wall: tp?.wall, length: 1000, angle: 90, elbow: 'LR', ...(sp.kind === 'flange' && tp?.kind === 'flange' ? { flStd: tp.flStd, rating: tp.rating, flType: tp.flType } : {}), ...(sp.kind === 'flange' && !sp.flStd && !tp?.flStd ? { flStd: norm === 'ASME' ? 'B16.5' : 'EN1092', rating: norm === 'ASME' ? 150 : 16, flType: norm === 'ASME' ? 'WN' : '11' } : {}), ...sp, material: sp.material ?? (tp?.kind === sp.kind ? tp?.material : undefined) ?? defMat } as PipeSpec;
      const doc = makePipePart(spec);
      if (!asm) { s.addDocument('part', doc, fileOf(doc)); return { ok: true, part: doc.iProperties.description }; }
      pid = addPart(doc);
    }
    if (!asm) { s.activate(pid); return { ok: true }; }
    return placeDoc(pid, pl, F);
  }
  if (s.kind !== 'assembly') return { error: 'El documento activo no es un ensamblaje' };
  const occ = String(args.occ ?? '');
  switch (name) {
    case 'spin_component': if (!foranJoint(occ)) return { error: 'El componente no está unido por ePoints' }; asmActions.foranSpin(occ, Number(args.deg)); await wait(); return { ok: true, check: checkAssembly() };
    case 'offset_component': if (!foranJoint(occ)) return { error: 'El componente no está unido por ePoints' }; asmActions.foranOffset(occ, Number(args.mm)); await wait(); return { ok: true };
    case 'reconnect_component': asmActions.foranReattachTo(occ, String(args.toOcc), String(args.toEp)); await wait(); return { ok: true, check: checkAssembly() };
    case 'delete_components': { const ids = (args.occs as string[]) ?? []; s.commitAsm((a) => { a.occurrences = a.occurrences.filter((o) => !ids.includes(o.id)); a.joints = a.joints.filter((j) => !ids.includes(j.a.occ) && !ids.includes(j.b.occ)); }); await wait(); return { ok: true }; }
  }
  return { error: `Herramienta desconocida: ${name}` };
}

/** Revisión rápida del ensamblaje */
export function checkAssembly() {
  const s = S();
  const mismatch: string[] = [];
  for (const j of s.asm.joints) {
    if (!j.ep || j.suppressed) continue;
    const a = R.epFrame(j.a.occ, j.ep.a), b = R.epFrame(j.b.occ, j.ep.b); if (!a || !b) continue;
    if (a.m && b.m) {
      // se compara en el espacio: la anchura de una boca contra la medida de la otra en esa misma dirección
      const eq = (x: number, y: number) => Math.abs(x - y) < 0.5;
      const par = Math.abs(a.X.dot(b.X)) > 0.7;
      const ok = a.m.shape === b.m.shape && (a.m.shape === 'round' ? eq(a.m.D, b.m.D) : par ? eq(a.m.W, b.m.W) && eq(a.m.H, b.m.H) : eq(a.m.W, b.m.H) && eq(a.m.H, b.m.W));
      if (!ok) mismatch.push(`${j.name}: ${a.name} con ${b.name} (las secciones no casan${a.m.shape !== 'round' && eq(a.m.W, b.m.W) && eq(a.m.H, b.m.H) ? ': giradas 90°, W contra H' : ''})`);
    }
    const d = a.P.distanceTo(b.P); if (d > 0.5 && !parseFloat(j.offset || '0')) mismatch.push(`${j.name}: bocas separadas ${d.toFixed(1)} mm`);
  }
  const dof = Object.entries(s.asmDof ?? {}).filter(([, v]) => v > 0).map(([k, v]) => `${s.asm.occurrences.find((o) => o.id === k)?.name ?? k}: ${v} GDL`);
  const errors = Object.entries(s.asmResult?.errors ?? {}).map(([k, v]) => `${s.asm.joints.find((j) => j.id === k)?.name ?? k}: ${v}`);
  return { components: s.asm.occurrences.length, joints: s.asm.joints.length, freePorts: freePorts(), mismatch, dof, errors };
}
