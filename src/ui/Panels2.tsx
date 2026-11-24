// Diálogos de Anotar, Inspeccionar, Herramientas, Administrar y Entornos (pieza).
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { Modal, Row, Seg, Expr } from './Panels';
import { uid, newDoc, MATERIALS, docParams, planeFrame, resolveWorkPlanes, entityOutline, type V3, type PartDoc, type Feature, type SketchF } from '../core/doc';
import { makeEval } from '../core/expr';
import { PMI_NAMES, GDT, pmiText, stackResult, LIMIT_NAMES, type Pmi, type PmiKind, type Limit, type TolStack, type TolRow, type Rule } from '../core/pmi';
import { partDims } from '../core/partdims';
import { runRule, ruleApi } from './rules';
import { download, exportMesh, exportIFC } from '../core/files';
import { writeDxf } from '../core/dxf';
import { toB64 } from '../core/meshfit';
import { PROFILES, type ProfileShape } from '../core/catalog';
import { CONTENT } from '../core/content';

const S = () => useStore.getState();
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const btns = (ok: () => void, close: () => void, okLabel = 'Aceptar', disabled = false, extra?: React.ReactNode) => (
  <div className="modal-btns">{extra}<span className="grow" /><button className="btn primary" disabled={disabled} onClick={ok}>{okLabel}</button><button className="btn" onClick={close}>Cancelar</button></div>
);
function modelSize(): number { const b = S().result?.props?.bbox; return b ? Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1], b[1][2] - b[0][2]) || 50 : 50; }
/** activa la designación de puntos en el modelo mientras el diálogo está abierto */
function usePicks(tool: 'pmiPick' | 'regionPick' | 'limitPick', on = true) {
  useEffect(() => {
    if (!on) return;
    useStore.setState({ picks: [], tool });
    return () => { const t = S(); useStore.setState({ picks: [], ...(t.tool === tool ? { tool: null } : {}) }); };
  }, [on]);
  return useStore((s) => s.picks);
}

// ===================== ANOTAR =====================
const NEED: Record<PmiKind, number> = { dim: 2, note: 1, gnote: 0, hole: 1, surf: 1, weld: 1, datum: 1, target: 1, fcf: 1, tolfeat: 1, profile: 0 };
export function PmiDialog({ kind, editId, onClose }: { kind: PmiKind; editId?: string; onClose: () => void }) {
  const s = useStore();
  const ex = (s.doc.pmi ?? []).find((a) => a.id === editId);
  const [a, setA] = useState<Pmi>(() => ex ? structuredClone(ex) : { id: uid('pm'), kind, p: [0, 0, 0], off: [0, 0, 0], text: kind === 'gnote' ? 'Aristas vivas matadas 0,5×45°' : kind === 'profile' ? '0,2 (perfil de superficie general)' : '', tol: '', sym: '⌖', val: 'Ø0,1', datums: 'A B C', ra: '3,2', letter: nextLetter(s.doc.pmi ?? [], kind), weld: { type: 'ángulo', a: '4', l: '', field: false, around: false } });
  const need = ex ? 0 : NEED[kind];
  const picks = usePicks('pmiPick', need > 0);
  const [dist, setDist] = useState(() => (ex ? Math.hypot(...ex.off) : r3(modelSize() * 0.12)));
  const up = (p: Partial<Pmi>) => setA({ ...a, ...p });
  // con los puntos elegidos: anclaje, desplazamiento y texto automático
  useEffect(() => {
    if (ex || !need || picks.length < need) return;
    const pk = picks.slice(-need);
    const n = pk[0].n;
    const next: Partial<Pmi> = { p: pk[0].p, off: [n[0] * dist, n[1] * dist, n[2] * dist] };
    if (need === 2) next.p2 = pk[1].p;
    const fid = S().result?.faceFeat?.[pk[0].group];
    if (fid) next.feature = fid;
    if (kind === 'hole' && fid) {
      const f = S().doc.features.find((x) => x.id === fid);
      if (f && f.type === 'hole') next.text = f.thread ? `${f.thread}${f.depth && !f.through ? ` ↧${f.depth}` : ''}` : `Ø${f.dia}${f.through ? ' pasante' : ` ↧${f.depth}`}`.replace(/ mm/g, '');
      else next.text = 'Taladro';
    }
    if (kind === 'tolfeat' && fid) next.text = S().doc.features.find((x) => x.id === fid)?.name ?? '';
    setA((x) => ({ ...x, ...next }));
  }, [picks.length]);
  const ready = need === 0 || picks.length >= need || !!ex;
  const save = () => {
    const off = Math.hypot(...a.off) > 1e-9 ? a.off.map((v) => (v / Math.hypot(...a.off)) * dist) as V3 : [0, 0, dist] as V3;
    const out = { ...a, off };
    S().commit((d) => { const l = d.pmi ?? []; const i = l.findIndex((x) => x.id === out.id); if (i >= 0) l[i] = out; else l.push(out); d.pmi = l; });
    onClose();
  };
  const del = () => { S().commit((d) => { d.pmi = (d.pmi ?? []).filter((x) => x.id !== a.id); }); onClose(); };
  const dd = a.p2 ? Math.hypot(a.p2[0] - a.p[0], a.p2[1] - a.p[1], a.p2[2] - a.p[2]) : undefined;
  return (
    <Modal title={PMI_NAMES[kind]} onClose={onClose} float>
      {need > 0 && <div className="pick-info">{picks.length >= need ? `Puntos elegidos (${picks.length}) · clic para cambiar` : need === 2 ? `Clic en el ${picks.length ? 'segundo' : 'primer'} punto (vértices y aristas atraen)` : 'Clic en la cara o arista a anotar'}</div>}
      {(kind === 'dim') && <><Row label="Prefijo"><input value={a.text ?? ''} onChange={(e) => up({ text: e.target.value })} placeholder="Ø, R, 2×…" /></Row><Row label="Tolerancia"><input value={a.tol ?? ''} onChange={(e) => up({ tol: e.target.value })} placeholder="±0,1 · H7 · +0,2/-0" /></Row>{dd != null && <div className="phelp">Medida: {dd.toFixed(3)} mm</div>}</>}
      {(kind === 'note' || kind === 'gnote' || kind === 'profile' || kind === 'hole' || kind === 'tolfeat') && <Row label="Texto"><textarea rows={2} value={a.text ?? ''} onChange={(e) => up({ text: e.target.value })} style={{ flex: 1 }} /></Row>}
      {kind === 'tolfeat' && <Row label="Tolerancia"><input value={a.tol ?? ''} onChange={(e) => up({ tol: e.target.value })} placeholder="±0,05 · h6" /></Row>}
      {kind === 'surf' && <><Row label="Ra (µm)"><select value={a.ra} onChange={(e) => up({ ra: e.target.value })}>{['0,1', '0,2', '0,4', '0,8', '1,6', '3,2', '6,3', '12,5', '25'].map((x) => <option key={x}>{x}</option>)}</select></Row><Row label="Proceso / estrías"><input value={a.lay ?? ''} onChange={(e) => up({ lay: e.target.value })} placeholder="rectificado ⊥" /></Row></>}
      {(kind === 'datum' || kind === 'target') && <Row label={kind === 'datum' ? 'Letra' : 'Objetivo'}><input value={a.letter ?? ''} onChange={(e) => up({ letter: e.target.value.toUpperCase() })} style={{ width: 60 }} /></Row>}
      {kind === 'target' && <Row label="Tamaño"><input value={a.text ?? ''} onChange={(e) => up({ text: e.target.value })} placeholder="Ø6" /></Row>}
      {kind === 'fcf' && <>
        <Row label="Característica"><select value={a.sym} onChange={(e) => up({ sym: e.target.value })}>{GDT.map(([g, n]) => <option key={g} value={g}>{g} {n}</option>)}</select></Row>
        <Row label="Tolerancia"><input value={a.val ?? ''} onChange={(e) => up({ val: e.target.value })} placeholder="Ø0,1 Ⓜ" /></Row>
        <Row label="Referencias"><input value={a.datums ?? ''} onChange={(e) => up({ datums: e.target.value.toUpperCase() })} placeholder="A B C" /></Row>
      </>}
      {kind === 'weld' && a.weld && <>
        <Row label="Tipo"><select value={a.weld.type} onChange={(e) => up({ weld: { ...a.weld!, type: e.target.value } })}>{['ángulo', 'a tope en V', 'a tope en X', 'en I', 'tapón', 'puntos'].map((x) => <option key={x}>{x}</option>)}</select></Row>
        <Row label="Garganta a"><input value={a.weld.a} onChange={(e) => up({ weld: { ...a.weld!, a: e.target.value } })} style={{ width: 70 }} /> mm</Row>
        <Row label="Longitud"><input value={a.weld.l} onChange={(e) => up({ weld: { ...a.weld!, l: e.target.value } })} style={{ width: 70 }} placeholder="continua" /></Row>
        <label className="check"><input type="checkbox" checked={a.weld.around} onChange={(e) => up({ weld: { ...a.weld!, around: e.target.checked } })} />Todo alrededor</label>
        <label className="check"><input type="checkbox" checked={a.weld.field} onChange={(e) => up({ weld: { ...a.weld!, field: e.target.checked } })} />En obra</label>
      </>}
      {need > 0 || ex ? (kind !== 'gnote' && kind !== 'profile') && <Row label="Separación del rótulo"><input className="num" type="number" value={dist} onChange={(e) => setDist(parseFloat(e.target.value) || 0)} /> mm</Row> : null}
      <div className="phelp">Vista previa: <b>{pmiText({ ...a }, dd)}</b></div>
      {btns(save, onClose, ex ? 'Guardar' : 'Crear', !ready, ex ? <button className="btn danger" onClick={del}>Eliminar</button> : undefined)}
    </Modal>
  );
}
function nextLetter(l: Pmi[], kind: PmiKind) {
  if (kind === 'target') return 'A1';
  const used = new Set(l.filter((x) => x.kind === 'datum').map((x) => x.letter));
  return 'ABCDEFGHJKLMNPRSTUVWXYZ'.split('').find((c) => !used.has(c)) ?? 'A';
}

export function DrfDialog({ onClose }: { onClose: () => void }) {
  const picks = usePicks('pmiPick');
  const s = useStore();
  const letters = ['A', 'B', 'C'];
  const save = () => {
    const d0 = r3(modelSize() * 0.1);
    S().commit((d) => { const l = d.pmi ?? []; picks.slice(0, 3).forEach((k, i) => l.push({ id: uid('pm'), kind: 'datum', p: k.p, off: [k.n[0] * d0, k.n[1] * d0, k.n[2] * d0], letter: letters[i] })); d.pmi = l; });
    onClose();
  };
  void s;
  return (
    <Modal title="Sistema de referencia (SRD)" onClose={onClose} float>
      <div className="pick-info">{picks.length < 3 ? `Clic en la cara de la referencia ${letters[picks.length]} (primaria, secundaria y terciaria)` : 'Referencias A, B y C elegidas'}</div>
      <p className="phelp">Crea los identificadores de referencia A (primaria), B y C sobre las caras elegidas, para usarlas en los marcos de control.</p>
      {btns(save, onClose, 'Crear', picks.length < 1)}
    </Modal>
  );
}

export function PromoteDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const dims = useMemo(() => partDims(s.doc).filter((d) => d.unit), [s.doc]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const ev = makeEval(docParams(s.doc));
  const anchor = (path: (string | number)[]): V3 => {
    const fid = String(path[0]), m = S().result?.mesh, ff = S().result?.faceFeat;
    const f = s.doc.features.find((x) => x.id === fid);
    if (m && ff) {
      const owner = f?.type === 'sketch' ? s.doc.features.find((x) => Object.values(x).includes(fid) && x.type !== 'sketch')?.id ?? fid : fid;
      const gi = ff.findIndex((x) => x === owner);
      if (gi >= 0) { const g = m.faceGroups[gi]; let c: V3 = [0, 0, 0]; for (let i = g.start; i < g.start + g.count; i++) { const v = m.triangles[i] * 3; c = [c[0] + m.vertices[v], c[1] + m.vertices[v + 1], c[2] + m.vertices[v + 2]]; } return c.map((x) => x / g.count) as V3; }
    }
    if (f?.type === 'sketch') { const fr = planeFrame(f.plane, ev, resolveWorkPlanes(s.doc, ev)); return fr.origin; }
    return [0, 0, 0];
  };
  const go = () => {
    const d0 = r3(modelSize() * 0.12);
    S().commit((d) => { const l = d.pmi ?? []; [...sel].forEach((i, k) => { const dm = dims[i]; let v = NaN; try { v = ev(dm.expr); } catch { /* */ } l.push({ id: uid('pm'), kind: 'tolfeat', p: anchor(dm.path), off: [d0 * 0.3 * (k % 3), d0 * 0.3, d0], text: `${dm.group} · ${dm.label} ${isFinite(v) ? (dm.unit === 'deg' ? v.toFixed(1) + '°' : (dm.label.startsWith('Ø') || /diám/i.test(dm.label) ? 'Ø' : '') + v.toFixed(2)) : dm.expr}`, feature: String(dm.path[0]) }); }); d.pmi = l; });
    onClose();
  };
  return (
    <Modal title="Promover cotas" onClose={onClose} wide>
      <p className="phelp">Cotas de bocetos y operaciones que se muestran como anotaciones 3D (se actualizan al regenerar si las editas).</p>
      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        {dims.map((d, i) => <label key={i} className="check"><input type="checkbox" checked={sel.has(i)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(i); else n.delete(i); setSel(n); }} />{d.group} · {d.label} = {d.expr}</label>)}
        {!dims.length && <p className="phelp">La pieza no tiene cotas.</p>}
      </div>
      {btns(go, onClose, `Promover (${sel.size})`, !sel.size, <button className="btn" onClick={() => setSel(new Set(dims.map((_, i) => i)))}>Todas</button>)}
    </Modal>
  );
}

export function TolAdvisorDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const l = s.doc.pmi ?? [];
  const datums = new Set(l.filter((a) => a.kind === 'datum').map((a) => a.letter));
  const msgs: [string, string][] = [];
  if (!l.length) msgs.push(['info', 'La pieza no tiene anotaciones 3D.']);
  if (l.length && !datums.size && l.some((a) => a.kind === 'fcf')) msgs.push(['warn', 'Hay marcos de control pero ninguna referencia (crea un SRD).']);
  for (const a of l) {
    if (a.kind === 'fcf') { const miss = (a.datums ?? '').split(/[ ,|]+/).filter((x) => x && !datums.has(x)); if (miss.length) msgs.push(['err', `Marco ${a.sym} ${a.val}: referencias no definidas ${miss.join(', ')}`]); if (['∥', '⟂', '∠', '⌖', '◎', '⌯', '↗', '⌰'].includes(a.sym ?? '') && !a.datums?.trim()) msgs.push(['err', `Marco ${a.sym}: esta característica necesita referencias`]); }
    if (a.kind === 'dim' && !a.tol && !s.doc.docset?.genTol) msgs.push(['warn', `Cota ${pmiText(a)} sin tolerancia (ni tolerancia general en Configuración del documento)`]);
  }
  const dup = [...datums].filter((x) => l.filter((a) => a.kind === 'datum' && a.letter === x).length > 1); if (dup.length) msgs.push(['err', `Referencias repetidas: ${dup.join(', ')}`]);
  if (l.length && !msgs.length) msgs.push(['ok', `Correcto: ${l.length} anotaciones, referencias ${[...datums].join(', ') || '—'}${s.doc.docset?.genTol ? `, tolerancia general ${s.doc.docset.genTol}` : ''}.`]);
  const col: Record<string, string> = { ok: '#2a9d4b', info: 'var(--fg-2)', warn: '#c98a00', err: 'var(--danger)' };
  return (
    <Modal title="Asesor de tolerancias" onClose={onClose}>
      {msgs.map(([k, m], i) => <div key={i} style={{ color: col[k], margin: '4px 0' }}>{k === 'err' ? '✖' : k === 'warn' ? '⚠' : k === 'ok' ? '✔' : 'ℹ'} {m}</div>)}
      <div className="modal-btns"><span className="grow" /><button className="btn" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}

export function TolStackDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [stacks, setStacks] = useState<TolStack[]>(() => structuredClone(s.doc.tolStacks ?? [{ id: uid('ts'), name: 'Cadena 1', rows: [{ name: 'A', nominal: 50, up: 0.1, lo: -0.1, sign: 1 }, { name: 'B', nominal: 30, up: 0.05, lo: -0.05, sign: -1 }] }]));
  const [cur, setCur] = useState(0);
  const st = stacks[cur];
  const upd = (rows: TolRow[]) => setStacks(stacks.map((x, i) => (i === cur ? { ...x, rows } : x)));
  const res = st ? stackResult(st) : null;
  const n = (v: number, on: (x: number) => void) => <input className="num" type="number" step={0.01} value={v} onChange={(e) => on(parseFloat(e.target.value) || 0)} style={{ width: 74 }} />;
  const pass = (x: number) => (st?.lsl == null || x >= st.lsl) && (st?.usl == null || x <= st.usl);
  return (
    <Modal title="Análisis de tolerancias" onClose={onClose} wide>
      <div className="ai-row" style={{ gap: 6, marginBottom: 6 }}>
        <select value={cur} onChange={(e) => setCur(+e.target.value)}>{stacks.map((x, i) => <option key={x.id} value={i}>{x.name}</option>)}</select>
        <input value={st?.name ?? ''} onChange={(e) => setStacks(stacks.map((x, i) => (i === cur ? { ...x, name: e.target.value } : x)))} style={{ width: 140 }} />
        <button className="btn" onClick={() => { setStacks([...stacks, { id: uid('ts'), name: `Cadena ${stacks.length + 1}`, rows: [] }]); setCur(stacks.length); }}>+ Cadena</button>
      </div>
      {st && <table className="ptable" style={{ fontSize: 12.5 }}><thead><tr><th>Eslabón</th><th>Sentido</th><th>Nominal</th><th>Desv. sup.</th><th>Desv. inf.</th><th /></tr></thead><tbody>
        {st.rows.map((r, i) => <tr key={i}>
          <td><input value={r.name} onChange={(e) => upd(st.rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} style={{ width: 90 }} /></td>
          <td><select value={r.sign} onChange={(e) => upd(st.rows.map((x, j) => (j === i ? { ...x, sign: +e.target.value as 1 | -1 } : x)))}><option value={1}>+ (aumenta)</option><option value={-1}>− (reduce)</option></select></td>
          <td>{n(r.nominal, (v) => upd(st.rows.map((x, j) => (j === i ? { ...x, nominal: v } : x))))}</td>
          <td>{n(r.up, (v) => upd(st.rows.map((x, j) => (j === i ? { ...x, up: v } : x))))}</td>
          <td>{n(r.lo, (v) => upd(st.rows.map((x, j) => (j === i ? { ...x, lo: v } : x))))}</td>
          <td><button className="btn sm" onClick={() => upd(st.rows.filter((_, j) => j !== i))}>✕</button></td>
        </tr>)}
      </tbody></table>}
      <div className="ai-row" style={{ gap: 6 }}><button className="btn" onClick={() => st && upd([...st.rows, { name: String.fromCharCode(65 + st.rows.length), nominal: 10, up: 0.1, lo: -0.1, sign: 1 }])}>+ Eslabón</button>
        <span className="phelp" style={{ margin: 0 }}>Límites del cierre: mín. </span>{st && n(st.lsl ?? NaN, (v) => setStacks(stacks.map((x, i) => (i === cur ? { ...x, lsl: isFinite(v) ? v : undefined } : x))))}<span className="phelp" style={{ margin: 0 }}>máx. </span>{st && n(st.usl ?? NaN, (v) => setStacks(stacks.map((x, i) => (i === cur ? { ...x, usl: isFinite(v) ? v : undefined } : x))))}</div>
      {res && <table className="ptable" style={{ marginTop: 8 }}><tbody>
        <tr><td>Cota de cierre nominal</td><td className="num">{res.nominal.toFixed(3)}</td></tr>
        <tr><td>Peor caso: mín. / máx.</td><td className="num" style={{ color: pass(res.min) && pass(res.max) ? undefined : 'var(--danger)' }}>{res.min.toFixed(3)} / {res.max.toFixed(3)}</td></tr>
        <tr><td>Estadístico (RSS, ±3σ): mín. / máx.</td><td className="num" style={{ color: pass(res.rssMin) && pass(res.rssMax) ? undefined : 'var(--danger)' }}>{res.rssMin.toFixed(3)} / {res.rssMax.toFixed(3)}</td></tr>
      </tbody></table>}
      {btns(() => { S().commit((d) => { d.tolStacks = stacks; }); onClose(); }, onClose, 'Guardar')}
    </Modal>
  );
}

// ===================== INSPECCIONAR =====================
export function AnalysisDialog({ onClose }: { onClose: () => void }) {
  const cur = useStore((s) => s.analysis);
  const [a, setA] = useState(cur ?? { kind: 'zebra' as const, dir: 'Z' as const, angle: 1, stripes: 12 });
  useEffect(() => { useStore.setState({ analysis: a }); }, [a]);
  return (
    <Modal title="Análisis de superficie" onClose={onClose} float>
      <Row label="Tipo"><Seg value={a.kind} onChange={(k) => setA({ ...a, kind: k })} options={[['zebra', 'Cebra'], ['draft', 'Inclinación'], ['curv', 'Curvatura']]} /></Row>
      {a.kind === 'zebra' && <Row label="Franjas"><input className="num" type="number" min={2} max={60} value={a.stripes} onChange={(e) => setA({ ...a, stripes: parseFloat(e.target.value) || 12 })} /></Row>}
      {a.kind === 'draft' && <><Row label="Desmoldeo"><Seg value={a.dir} onChange={(d) => setA({ ...a, dir: d })} options={[['X', 'X'], ['Y', 'Y'], ['Z', 'Z']]} /></Row><Row label="Ángulo mín."><input className="num" type="number" step={0.5} value={a.angle} onChange={(e) => setA({ ...a, angle: parseFloat(e.target.value) || 0 })} /> °</Row>
        <p className="phelp"><span style={{ color: '#2a9d4b' }}>■</span> inclinación suficiente · <span style={{ color: '#c9a000' }}>■</span> casi vertical · <span style={{ color: '#d0382c' }}>■</span> contrasalida</p></>}
      {a.kind === 'zebra' && <p className="phelp">Las franjas continuas indican caras tangentes (G1); si además no se quiebran, curvatura continua (G2).</p>}
      {a.kind === 'curv' && <p className="phelp">Azul: plano o poca curvatura · rojo: curvatura alta (radios pequeños).</p>}
      <div className="modal-btns"><span className="grow" /><button className="btn" onClick={() => { useStore.setState({ analysis: null }); onClose(); }}>Quitar análisis</button><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}

export function RegionDialog({ onClose }: { onClose: () => void }) {
  const picks = usePicks('regionPick');
  const m = useStore((s) => s.result?.mesh);
  const res = useMemo(() => {
    if (!m || !picks.length) return null;
    let A = 0, cx = 0, cy = 0, cz = 0, per = 0;
    for (const k of picks) {
      const g = m.faceGroups[k.group]; if (!g) continue;
      const ec = new Map<string, [number, number]>();
      for (let i = g.start; i < g.start + g.count; i += 3) {
        const ids = [m.triangles[i], m.triangles[i + 1], m.triangles[i + 2]], P = ids.map((v) => [m.vertices[v * 3], m.vertices[v * 3 + 1], m.vertices[v * 3 + 2]]);
        const e1 = P[1].map((x, j) => x - P[0][j]), e2 = P[2].map((x, j) => x - P[0][j]);
        const a = 0.5 * Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
        A += a; cx += a * (P[0][0] + P[1][0] + P[2][0]) / 3; cy += a * (P[0][1] + P[1][1] + P[2][1]) / 3; cz += a * (P[0][2] + P[1][2] + P[2][2]) / 3;
        for (let j = 0; j < 3; j++) { const p = P[j], q = P[(j + 1) % 3]; const kk = [p, q].map((x) => x.map((y) => y.toFixed(4)).join(',')).sort().join('|'); const e = ec.get(kk); if (e) e[1]++; else ec.set(kk, [Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]), 1]); }
      }
      for (const [l, c] of ec.values()) if (c === 1) per += l;
    }
    return { A, per, c: [cx / A, cy / A, cz / A] };
  }, [picks, m]);
  return (
    <Modal title="Propiedades de región" onClose={onClose} float>
      <div className="pick-info">Clic en caras del modelo (se suman) · {picks.length} elegida(s)</div>
      {res && <table className="ptable"><tbody>
        <tr><td>Área</td><td className="num">{res.A.toFixed(2)} mm² ({(res.A / 100).toFixed(3)} cm²)</td></tr>
        <tr><td>Perímetro</td><td className="num">{res.per.toFixed(2)} mm</td></tr>
        <tr><td>Centroide</td><td className="num">{res.c.map((x) => x.toFixed(2)).join('; ')}</td></tr>
      </tbody></table>}
      <div className="modal-btns"><button className="btn" onClick={() => useStore.setState({ picks: [] })}>Limpiar</button><span className="grow" /><button className="btn" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}

export function limitValue(l: Limit): number {
  const s = S(), pr = s.result?.props; if (!pr) return NaN;
  const rho = MATERIALS.find((m) => m.name === s.doc.iProperties.material)?.density ?? 7850;
  switch (l.kind) {
    case 'mass': return pr.volume * 1e-9 * rho;
    case 'volume': return pr.volume;
    case 'area': return pr.area;
    case 'bx': return pr.bbox[1][0] - pr.bbox[0][0];
    case 'by': return pr.bbox[1][1] - pr.bbox[0][1];
    case 'bz': return pr.bbox[1][2] - pr.bbox[0][2];
    case 'dist': return l.p && l.p2 ? Math.hypot(l.p2[0] - l.p[0], l.p2[1] - l.p[1], l.p2[2] - l.p[2]) : NaN;
  }
}
export function LimitsDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [list, setList] = useState<Limit[]>(() => structuredClone(s.doc.limits ?? []));
  const [pickFor, setPickFor] = useState<number | null>(null);
  const picks = usePicks('limitPick', pickFor !== null);
  useEffect(() => { if (pickFor !== null && picks.length >= 2) { setList(list.map((x, i) => (i === pickFor ? { ...x, p: picks[0].p, p2: picks[1].p } : x))); setPickFor(null); } }, [picks.length]);
  const ev = makeEval(docParams(s.doc)), num = (x: string) => { try { return x.trim() ? ev(x) : NaN; } catch { return NaN; } };
  return (
    <Modal title="AutoLímites" onClose={onClose} wide>
      <table className="ptable" style={{ fontSize: 12.5 }}><thead><tr><th /><th>Nombre</th><th>Magnitud</th><th>Mín.</th><th>Máx.</th><th>Valor</th><th /></tr></thead><tbody>
        {list.map((l, i) => { const v = limitValue(l), lo = num(l.min), hi = num(l.max), ok = isFinite(v) && (!isFinite(lo) || v >= lo) && (!isFinite(hi) || v <= hi); const u = (p: Partial<Limit>) => setList(list.map((x, j) => (j === i ? { ...x, ...p } : x))); return (
          <tr key={l.id}><td style={{ color: !isFinite(v) ? 'var(--fg-3)' : ok ? '#2a9d4b' : 'var(--danger)', fontSize: 16 }}>●</td>
            <td><input value={l.name} onChange={(e) => u({ name: e.target.value })} style={{ width: 110 }} /></td>
            <td><select value={l.kind} onChange={(e) => u({ kind: e.target.value as Limit['kind'] })}>{Object.entries(LIMIT_NAMES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>{l.kind === 'dist' && <button className="btn sm" onClick={() => setPickFor(i)}>{pickFor === i ? `Elige 2 puntos (${picks.length})` : 'Puntos…'}</button>}</td>
            <td><input value={l.min} onChange={(e) => u({ min: e.target.value })} style={{ width: 70 }} /></td>
            <td><input value={l.max} onChange={(e) => u({ max: e.target.value })} style={{ width: 70 }} /></td>
            <td className="num">{isFinite(v) ? (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(3)) : '—'}</td>
            <td><button className="btn sm" onClick={() => setList(list.filter((_, j) => j !== i))}>✕</button></td></tr>
        ); })}
      </tbody></table>
      <button className="btn" onClick={() => setList([...list, { id: uid('lm'), name: `Límite ${list.length + 1}`, kind: 'mass', min: '', max: '' }])}>+ Añadir límite</button>
      <p className="phelp">Los valores se actualizan con cada cambio de la pieza. En verde si están dentro de los límites, en rojo si no.</p>
      {btns(() => { S().commit((d) => { d.limits = list; }); onClose(); }, onClose, 'Guardar')}
    </Modal>
  );
}

// ===================== HERRAMIENTAS =====================
export function MaterialDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const all = [...MATERIALS, ...(s.settings as unknown as { userMaterials?: typeof MATERIALS }).userMaterials ?? []];
  const [q, setQ] = useState('');
  return (
    <Modal title="Material" onClose={onClose}>
      <input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 6 }} />
      <div style={{ maxHeight: 340, overflow: 'auto' }}>
        {all.filter((m) => m.name.toLowerCase().includes(q.toLowerCase())).map((m) => (
          <div key={m.name} className={`tree-row ${s.doc.iProperties.material === m.name ? 'sel' : ''}`} onClick={() => { S().commit((d) => { d.iProperties.material = m.name; }); }} style={{ cursor: 'pointer' }}>
            <span style={{ width: 16, height: 16, background: m.color, border: '1px solid var(--line)', borderRadius: 3, display: 'inline-block', marginRight: 8 }} /><span className="tree-name">{m.name}</span><span className="tree-count">{m.density} kg/m³</span>
          </div>
        ))}
      </div>
      <div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}
export function AppearanceDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const base = MATERIALS.find((m) => m.name === s.doc.iProperties.material)?.color ?? '#c3c8cf';
  const [a, setA] = useState(() => s.doc.appearance ?? { color: base, opacity: 1, metal: 0.25, rough: 0.55 });
  const set = (p: Partial<typeof a>) => { const n = { ...a, ...p }; setA(n); S().commit((d) => { d.appearance = n; }); };
  const PRESETS: [string, Partial<typeof a>][] = [['Acero pulido', { color: '#c8ccd2', metal: 0.9, rough: 0.2 }], ['Pintura roja', { color: '#b8312f', metal: 0.05, rough: 0.45 }], ['RAL 7035', { color: '#cbd0cc', metal: 0, rough: 0.6 }], ['RAL 5010', { color: '#0e4c92', metal: 0.05, rough: 0.45 }], ['Galvanizado', { color: '#aab3ba', metal: 0.7, rough: 0.45 }], ['Aluminio anodizado', { color: '#9aa4ad', metal: 0.6, rough: 0.35 }], ['Latón', { color: '#c9a53b', metal: 0.85, rough: 0.3 }], ['Vidrio', { color: '#bfe3f2', metal: 0, rough: 0.05, opacity: 0.35 }], ['Plástico negro', { color: '#202224', metal: 0, rough: 0.5 }]];
  return (
    <Modal title="Aspecto" onClose={onClose} float>
      <div className="chips">{PRESETS.map(([n, p]) => <button key={n} className="chip" onClick={() => set(p)}><span style={{ display: 'inline-block', width: 10, height: 10, background: p.color, marginRight: 4, border: '1px solid #0003' }} />{n}</button>)}</div>
      <Row label="Color"><input type="color" value={a.color} onChange={(e) => set({ color: e.target.value })} /></Row>
      <Row label="Metálico"><input type="range" min={0} max={1} step={0.05} value={a.metal} onChange={(e) => set({ metal: +e.target.value })} /></Row>
      <Row label="Rugosidad"><input type="range" min={0} max={1} step={0.05} value={a.rough} onChange={(e) => set({ rough: +e.target.value })} /></Row>
      <Row label="Opacidad"><input type="range" min={0.1} max={1} step={0.05} value={a.opacity} onChange={(e) => set({ opacity: +e.target.value })} /></Row>
      <div className="modal-btns"><button className="btn" onClick={() => { S().commit((d) => { delete d.appearance; }); onClose(); }}>Borrar (color del material)</button><span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}
export function DocSetDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [d, setD] = useState(() => s.doc.docset ?? { decimals: 2, angDecimals: 1, genTol: 'ISO 2768-m', units: 'mm' as const });
  const [sc, setSc] = useState(s.doc.pmiScale ?? 12);
  return (
    <Modal title="Configuración del documento" onClose={onClose}>
      <Row label="Unidades"><Seg value={d.units} onChange={(u) => setD({ ...d, units: u })} options={[['mm', 'mm'], ['in', 'pulgadas']]} /></Row>
      <Row label="Decimales lineales"><input className="num" type="number" min={0} max={6} value={d.decimals} onChange={(e) => setD({ ...d, decimals: Math.max(0, Math.min(6, +e.target.value)) })} /></Row>
      <Row label="Decimales angulares"><input className="num" type="number" min={0} max={4} value={d.angDecimals} onChange={(e) => setD({ ...d, angDecimals: Math.max(0, Math.min(4, +e.target.value)) })} /></Row>
      <Row label="Tolerancia general"><select value={d.genTol} onChange={(e) => setD({ ...d, genTol: e.target.value })}>{['', 'ISO 2768-f', 'ISO 2768-m', 'ISO 2768-c', 'ISO 2768-v', 'ISO 2768-mK', 'ISO 13920-B', 'ISO 13920-C'].map((x) => <option key={x} value={x}>{x || '— ninguna —'}</option>)}</select></Row>
      <Row label="Tamaño de las anotaciones 3D"><input className="num" type="number" min={8} max={28} value={sc} onChange={(e) => setSc(+e.target.value || 12)} /> px</Row>
      {btns(() => { S().commit((x) => { x.docset = d; x.pmiScale = sc; }); onClose(); }, onClose)}
    </Modal>
  );
}
const NEWS: [string, string][] = [
  ['0.33', 'Pestañas Anotar, Administrar y Entornos; Inspeccionar y Herramientas ampliadas: anotaciones 3D (cotas, GD&T, notas, textura, soldadura, referencias), análisis de cebra/inclinación/curvatura, AutoLímites, análisis de tolerancias, reglas, nube de puntos, molde, estudio de render, impresión 3D.'],
  ['0.32', 'Modelo 3D completo: ranura, directa, eliminar cara, acabado, calcomanía, desenrollar, generador de formas, forma libre, superficies avanzadas, simplificar, convertir a chapa y ajustar a malla.'],
  ['0.31', 'Fin de pieza arrastrable.'],
  ['0.30', 'Patrón plano de chapa en el visor 3D y en el árbol.'],
  ['0.29', 'Herramientas de chapa completas.'],
];
export function NewsDialog({ onClose }: { onClose: () => void }) {
  return (<Modal title="Novedades" onClose={onClose}>{NEWS.map(([v, t]) => <div key={v} style={{ margin: '6px 0' }}><b>v{v}</b> · {t}</div>)}<div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div></Modal>);
}
export function LinksDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const links = s.doc.features.filter((f) => f.type === 'derive' || f.type === 'simplify' || f.type === 'mold' || f.type === 'meshref' || f.type === 'pointcloud' || f.type === 'import');
  return (
    <Modal title="Vínculos" onClose={onClose} wide>
      {!links.length && !s.doc.attachments?.length && <p className="phelp">La pieza no tiene vínculos a otros ficheros.</p>}
      {links.map((f) => { const src = (f as { source?: string; sourceName?: string }); const open = src.source ? s.docs.some((d) => d.id === src.source) : false; return (
        <div key={f.id} className="ai-row" style={{ gap: 8, margin: '4px 0' }}><b>{f.name}</b><span className="phelp" style={{ margin: 0 }}>{(f as { fileName?: string }).fileName ?? src.sourceName ?? ''} {src.source ? (open ? '· abierto: se actualiza solo' : '· copia guardada en la pieza') : ''}</span><span className="grow" />
          {src.source && <button className="btn sm" onClick={() => S().commit((d) => { const x = d.features.find((y) => y.id === f.id) as { source?: string }; if (x) x.source = ''; })}>Romper vínculo</button>}</div>
      ); })}
      {(s.doc.attachments ?? []).map((a) => <div key={a.id} className="ai-row" style={{ gap: 8 }}>📎 {a.name}</div>)}
      <div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}
export const MODULE_TABS: [string, string][] = [['pipe', 'Mecánica'], ['hvac', 'HVAC'], ['annotate', 'Anotar'], ['manage', 'Administrar'], ['env', 'Entornos'], ['weld', 'Soldadura'], ['present', 'Presentación'], ['design', 'Diseño']];
export function AddinsDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const hidden = new Set((s.settings as unknown as { hiddenTabs?: string[] }).hiddenTabs ?? []);
  const tog = (k: string) => { const h = new Set(hidden); if (h.has(k)) h.delete(k); else h.add(k); S().set({ settings: { ...s.settings, hiddenTabs: [...h] } as never }); };
  return (
    <Modal title="Complementos" onClose={onClose}>
      <p className="phelp">Módulos de la aplicación: desactiva los que no uses para simplificar la cinta.</p>
      {MODULE_TABS.map(([k, n]) => <label key={k} className="check"><input type="checkbox" checked={!hidden.has(k)} onChange={() => tog(k)} />{n}</label>)}
      <div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}
const MACROS_LS = 'inv3d.macros';
export function MacrosDialog({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<{ name: string; code: string }[]>(() => { try { return JSON.parse(localStorage.getItem(MACROS_LS) || '[]'); } catch { return []; } });
  const [i, setI] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const save = (l: typeof list) => { setList(l); try { localStorage.setItem(MACROS_LS, JSON.stringify(l)); } catch { /* */ } };
  const cur = list[i];
  const run = () => { if (!cur) return; setLog([]); const out: string[] = []; runRule({ id: 'm', name: cur.name, code: cur.code, on: ['manual'] }, (x) => out.push(x)); setLog(out.length ? out : ['(sin salida)']); };
  return (
    <Modal title="Macros" onClose={onClose} wide>
      <div className="ai-row" style={{ gap: 6 }}>
        <select value={i} onChange={(e) => setI(+e.target.value)}>{list.map((m, k) => <option key={k} value={k}>{m.name}</option>)}</select>
        <button className="btn" onClick={() => { save([...list, { name: `Macro ${list.length + 1}`, code: "// Ejemplo\nLog('Volumen: ' + Volume().toFixed(0) + ' mm³');\nLog('Masa: ' + Mass().toFixed(3) + ' kg');" }]); setI(list.length); }}>+ Nueva</button>
        {cur && <><input value={cur.name} onChange={(e) => save(list.map((m, k) => (k === i ? { ...m, name: e.target.value } : m)))} /><button className="btn" onClick={() => { save(list.filter((_, k) => k !== i)); setI(0); }}>Eliminar</button></>}
      </div>
      {cur && <textarea spellCheck={false} value={cur.code} onChange={(e) => save(list.map((m, k) => (k === i ? { ...m, code: e.target.value } : m)))} onKeyDown={(e) => e.stopPropagation()} style={{ width: '100%', height: 220, fontFamily: 'monospace', fontSize: 12.5, marginTop: 6 }} />}
      <p className="phelp">JavaScript con: Param(nombre[, valor]), iProp(campo[, valor]), Suppress(operación, sí/no), Features(), Material([nombre]), Mass(), Volume(), Msg(texto), Log(texto), Math. Las macros se guardan en este navegador.</p>
      {log.length > 0 && <pre style={{ background: 'var(--bg-2)', padding: 6, maxHeight: 120, overflow: 'auto' }}>{log.join('\n')}</pre>}
      <div className="modal-btns"><span className="grow" /><button className="btn primary" disabled={!cur} onClick={run}>Ejecutar</button><button className="btn" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}
export function RulesDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [rules, setRules] = useState<Rule[]>(() => structuredClone(s.doc.rules ?? []));
  const [i, setI] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const cur = rules[i];
  const u = (p: Partial<Rule>) => setRules(rules.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const EV: [Rule['on'][number], string][] = [['manual', 'Manual'], ['param', 'Al cambiar parámetros'], ['save', 'Al guardar'], ['trigger', 'iTrigger']];
  void ruleApi;
  return (
    <Modal title="Reglas" onClose={onClose} wide>
      <div className="ai-row" style={{ gap: 6 }}>
        <select value={i} onChange={(e) => setI(+e.target.value)}>{rules.map((r, k) => <option key={r.id} value={k}>{r.off ? '⏸ ' : ''}{r.name}</option>)}</select>
        <button className="btn" onClick={() => { setRules([...rules, { id: uid('ru'), name: `Regla${rules.length + 1}`, code: "// Ejemplo: espesor según anchura\nif (Param('ancho') > 200) Param('e', 10); else Param('e', 6);", on: ['manual', 'param'] }]); setI(rules.length); }}>+ Agregar regla</button>
        {cur && <><input value={cur.name} onChange={(e) => u({ name: e.target.value })} /><label className="check"><input type="checkbox" checked={!cur.off} onChange={(e) => u({ off: !e.target.checked })} />Activa</label><button className="btn" onClick={() => { setRules(rules.filter((_, k) => k !== i)); setI(0); }}>Eliminar</button></>}
      </div>
      {cur && <>
        <div className="chips" style={{ marginTop: 6 }}>{EV.map(([k, n]) => <button key={k} className={`chip ${cur.on.includes(k) ? 'on' : ''}`} onClick={() => u({ on: cur.on.includes(k) ? cur.on.filter((x) => x !== k) : [...cur.on, k] })}>{n}</button>)}</div>
        <textarea spellCheck={false} value={cur.code} onChange={(e) => u({ code: e.target.value })} onKeyDown={(e) => e.stopPropagation()} style={{ width: '100%', height: 200, fontFamily: 'monospace', fontSize: 12.5, marginTop: 6 }} />
      </>}
      <p className="phelp">Las reglas se guardan con la pieza. API: Param, iProp, Suppress, Features, Material, Mass, Volume, Msg, Log. «iTrigger» las ejecuta con el botón iTrigger de Administrar.</p>
      {log.length > 0 && <pre style={{ background: 'var(--bg-2)', padding: 6, maxHeight: 110, overflow: 'auto' }}>{log.join('\n')}</pre>}
      <div className="modal-btns">
        <button className="btn" disabled={!cur} onClick={() => { S().commit((d) => { d.rules = rules; }); const out: string[] = []; runRule(cur, (x) => out.push(x)); setLog(out.length ? out : ['Ejecutada']); }}>Guardar y ejecutar</button>
        <span className="grow" /><button className="btn primary" onClick={() => { S().commit((d) => { d.rules = rules; }); onClose(); }}>Guardar</button><button className="btn" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}
export function FindDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [q, setQ] = useState('');
  const items: { id: string; name: string; type: string }[] = s.kind === 'part' ? s.doc.features.map((f) => ({ id: f.id, name: f.name, type: f.type })) : s.kind === 'assembly' ? s.asm.occurrences.map((o) => ({ id: o.id, name: o.name, type: 'componente' })) : [];
  const hits = q ? items.filter((x) => x.name.toLowerCase().includes(q.toLowerCase()) || x.type.includes(q.toLowerCase())) : items;
  return (
    <Modal title="Buscar" onClose={onClose}>
      <input autoFocus placeholder="Nombre o tipo…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} style={{ width: '100%' }} />
      <div style={{ maxHeight: 320, overflow: 'auto', marginTop: 6 }}>{hits.map((x) => <div key={x.id} className="tree-row" style={{ cursor: 'pointer' }} onClick={() => { if (S().kind === 'part') S().set({ selFeature: x.id }); else S().set({ selItem: x.id }); }}><span className="tree-name">{x.name}</span><span className="tree-count">{x.type}</span></div>)}</div>
      <div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}
// Copiar / pegar operaciones entre piezas
let clip: Feature[] | null = null;
export function copyFeatures(cut = false) {
  const s = S(); if (s.kind !== 'part' || !s.selFeature) { s.notify('Selecciona una operación en el árbol', 'info'); return; }
  const f = s.doc.features.find((x) => x.id === s.selFeature)!;
  const refs = new Set(Object.values(f).flat().filter((v) => typeof v === 'string') as string[]);
  const deps = s.doc.features.filter((x) => x.id !== f.id && refs.has(x.id) && (x.type === 'sketch' || x.type === 'sketch3d'));
  clip = structuredClone([...deps, f]);
  try { navigator.clipboard?.writeText(JSON.stringify({ inv3dFeatures: clip })); } catch { /* */ }
  if (cut) s.commit((d) => { d.features = d.features.filter((x) => x.id !== f.id && !deps.some((y) => y.id === x.id)); });
  s.notify(`${cut ? 'Cortada' : 'Copiada'}: ${f.name}${deps.length ? ` (+${deps.length} boceto)` : ''}`);
}
export function pasteFeatures() {
  const s = S(); if (s.kind !== 'part') return;
  if (!clip) { s.notify('No hay operaciones copiadas', 'info'); return; }
  const map = new Map(clip.map((f) => [f.id, uid('f')] as [string, string]));
  let js = JSON.stringify(clip);
  for (const [a, b] of map) js = js.split(`"${a}"`).join(`"${b}"`);
  const fs = JSON.parse(js) as Feature[];
  const names = new Set(s.doc.features.map((f) => f.name));
  for (const f of fs) { let n = f.name, k = 2; while (names.has(n)) n = `${f.name}_${k++}`; f.name = n; names.add(n); }
  s.commit((d) => { d.features.push(...fs); });
  s.notify(`Pegadas ${fs.length} operación(es)`);
}
export function PurgeDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const text = JSON.stringify(s.doc.features) + JSON.stringify(s.doc.parameters.map((p) => p.expr)) + JSON.stringify(s.doc.rules ?? []);
  const unusedP = s.doc.parameters.filter((p) => !new RegExp(`\\b${p.name}\\b`).test(text.split(`"name":"${p.name}"`).join('')));
  const used = new Set<string>(); for (const f of s.doc.features) for (const v of Object.values(f)) { if (typeof v === 'string') used.add(v); if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && used.add(x)); }
  const unusedSk = s.doc.features.filter((f) => f.type === 'sketch' && !used.has(f.id) && !(f as SketchF).entities.length);
  const [sel, setSel] = useState<Set<string>>(new Set([...unusedP.map((p) => 'p:' + p.name), ...unusedSk.map((f) => 'f:' + f.id)]));
  const tog = (k: string) => { const n = new Set(sel); if (n.has(k)) n.delete(k); else n.add(k); setSel(n); };
  return (
    <Modal title="Limpiar" onClose={onClose}>
      {!unusedP.length && !unusedSk.length && <p className="phelp">No hay parámetros sin usar ni bocetos vacíos.</p>}
      {unusedP.map((p) => <label key={p.name} className="check"><input type="checkbox" checked={sel.has('p:' + p.name)} onChange={() => tog('p:' + p.name)} />Parámetro {p.name} = {p.expr}</label>)}
      {unusedSk.map((f) => <label key={f.id} className="check"><input type="checkbox" checked={sel.has('f:' + f.id)} onChange={() => tog('f:' + f.id)} />Boceto vacío {f.name}</label>)}
      {btns(() => { S().commit((d) => { d.parameters = d.parameters.filter((p) => !sel.has('p:' + p.name)); d.features = d.features.filter((f) => !sel.has('f:' + f.id)); }); onClose(); }, onClose, `Limpiar (${sel.size})`, !sel.size)}
    </Modal>
  );
}

// ===================== ADMINISTRAR =====================
export function InsertObjDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const add = () => { const i = document.createElement('input'); i.type = 'file'; i.onchange = () => { const f = i.files?.[0]; if (!f) return; if (f.size > 8e6) { S().notify('Fichero demasiado grande (máx. 8 MB)', 'error'); return; } const r = new FileReader(); r.onload = () => S().commit((d) => { d.attachments = [...(d.attachments ?? []), { id: uid('at'), name: f.name, type: f.type, data: String(r.result) }]; }); r.readAsDataURL(f); }; i.click(); };
  return (
    <Modal title="Insertar objeto" onClose={onClose}>
      <p className="phelp">Adjunta ficheros a la pieza (hojas de cálculo, PDF de cálculo, fotos, certificados…). Se guardan dentro del .i3p.</p>
      {(s.doc.attachments ?? []).map((a) => <div key={a.id} className="ai-row" style={{ gap: 6 }}>📎 {a.name}<span className="grow" /><button className="btn sm" onClick={() => { const l = document.createElement('a'); l.href = a.data; l.download = a.name; l.click(); }}>Abrir</button><button className="btn sm" onClick={() => S().commit((d) => { d.attachments = (d.attachments ?? []).filter((x) => x.id !== a.id); })}>✕</button></div>)}
      <div className="modal-btns"><button className="btn" onClick={add}>Adjuntar fichero…</button><span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}
export function ExportObjDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const sks = s.doc.features.filter((f) => f.type === 'sketch') as SketchF[];
  const [id, setId] = useState(sks[sks.length - 1]?.id ?? '');
  const go = () => {
    const sk = sks.find((x) => x.id === id); if (!sk) return;
    const ev = makeEval(docParams(s.doc));
    const lines = sk.entities.map((e) => { try { const o = entityOutline(e, (x) => ev(x)); return { layer: e.construction ? 'CONSTRUCCION' : 'CONTORNO', pts: (o.closed ? [...o.pts, o.pts[0]] : o.pts) as [number, number][] }; } catch { return null; } }).filter((x) => x && x.pts.length > 1) as { layer: string; pts: [number, number][] }[];
    download(writeDxf({ layers: [{ name: 'CONTORNO', color: 7 }, { name: 'CONSTRUCCION', color: 8 }], lines } as never), `${sk.name}.dxf`, 'application/dxf');
    onClose();
  };
  return (
    <Modal title="Exportar objetos" onClose={onClose}>
      <Row label="Boceto"><select value={id} onChange={(e) => setId(e.target.value)}>{sks.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></Row>
      <p className="phelp">Exporta la geometría del boceto (en su plano) a DXF para corte, plantillas u otros programas.</p>
      {btns(go, onClose, 'Exportar DXF', !id)}
    </Modal>
  );
}
const UP_LS = 'inv3d.userProfiles';
export function loadUserProfiles() {
  try {
    const l = JSON.parse(localStorage.getItem(UP_LS) || '[]') as { name: string; shape: ProfileShape }[];
    const fam = PROFILES.find((f) => f.id === 'USER');
    const sizes = Object.fromEntries(l.map((x) => [x.name, x.shape]));
    if (fam) fam.sizes = sizes; else if (l.length) PROFILES.push({ id: 'USER', name: 'Usuario', standard: 'propio', sizes });
  } catch { /* */ }
}
export function StructShapeDialog({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<{ name: string; shape: ProfileShape }[]>(() => { try { return JSON.parse(localStorage.getItem(UP_LS) || '[]'); } catch { return []; } });
  const [kind, setKind] = useState<ProfileShape['kind']>('RHS');
  const [name, setName] = useState('RHS 120×60×5');
  const F: Record<string, string[]> = { I: ['h', 'b', 'tw', 'tf', 'r'], U: ['h', 'b', 'tw', 'tf', 'r'], L: ['a', 'b', 't', 'r'], RHS: ['h', 'b', 't'], CHS: ['d', 't'], FLAT: ['b', 't'], ROUND: ['d'] };
  const [v, setV] = useState<Record<string, number>>({ h: 120, b: 60, t: 5, tw: 6, tf: 9, r: 8, a: 60, d: 60 });
  const save = (l: typeof list) => { setList(l); try { localStorage.setItem(UP_LS, JSON.stringify(l)); } catch { /* */ } loadUserProfiles(); };
  return (
    <Modal title="Forma estructural" onClose={onClose}>
      <p className="phelp">Perfiles propios para el generador de estructuras (familia «Usuario»).</p>
      <Row label="Tipo"><Seg value={kind} onChange={setKind} options={[['I', 'I/H'], ['U', 'U'], ['L', 'L'], ['RHS', 'Rect.'], ['CHS', 'Tubo'], ['FLAT', 'Pletina'], ['ROUND', 'Redondo']]} /></Row>
      <Row label="Nombre"><input value={name} onChange={(e) => setName(e.target.value)} /></Row>
      <div className="prow3">{F[kind].map((k) => <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{k}<input className="num" type="number" value={v[k] ?? 0} onChange={(e) => setV({ ...v, [k]: parseFloat(e.target.value) || 0 })} /></label>)}</div>
      <button className="btn" onClick={() => { const sh = { kind, ...Object.fromEntries(F[kind].map((k) => [k, v[k] ?? 0])) } as unknown as ProfileShape; if (kind === 'L' && !(sh as { b?: number }).b) (sh as { b: number }).b = v.a; save([...list.filter((x) => x.name !== name), { name, shape: sh }]); }}>Guardar perfil</button>
      {list.map((x) => <div key={x.name} className="ai-row" style={{ gap: 6 }}>{x.name} <span className="phelp" style={{ margin: 0 }}>{x.shape.kind}</span><span className="grow" /><button className="btn sm" onClick={() => save(list.filter((y) => y.name !== x.name))}>✕</button></div>)}
      <div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}
export function CloudDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const clouds = s.doc.features.filter((f) => f.type === 'pointcloud') as Extract<Feature, { type: 'pointcloud' }>[];
  const attach = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.xyz,.txt,.csv,.pts,.ply'; i.onchange = async () => { const f = i.files?.[0]; if (!f) return; const txt = await f.text(); const out: number[] = []; let body = txt; if (/^ply/.test(txt)) { const k = txt.indexOf('end_header'); body = txt.slice(k + 10); } for (const line of body.split(/\r?\n/)) { const n = line.trim().split(/[\s,;]+/).map(Number); if (n.length >= 3 && n.slice(0, 3).every(isFinite)) out.push(n[0], n[1], n[2]); if (out.length > 3e6) break; } if (!out.length) { S().notify('No se encontraron puntos (formato x y z por línea)', 'error'); return; } S().commit((d) => { d.features.push({ id: uid('f'), name: f.name.replace(/\.[^.]+$/, ''), type: 'pointcloud', fileName: f.name, data: toB64(new Float32Array(out)), crop: null }); }); S().notify(`${(out.length / 3).toLocaleString('es-ES')} puntos`); }; i.click(); };
  const tool = useStore((x) => x.tool);
  useEffect(() => () => { if (S().tool === 'cloudPick') S().set({ tool: null }); }, []);
  return (
    <Modal title="Nube de puntos" onClose={onClose} float>
      {clouds.map((c) => { const cr = c.crop; const setCrop = (v: [V3, V3] | null) => S().commit((d) => { const x = d.features.find((y) => y.id === c.id) as typeof c; if (x) x.crop = v; }); return (
        <div key={c.id} style={{ marginBottom: 6 }}><b>{c.name}</b> <span className="phelp">{(c.data.length * 0.75 / 12).toFixed(0)} puntos</span>
          <label className="check"><input type="checkbox" checked={!!cr} onChange={(e) => { const b = S().result?.props?.bbox; setCrop(e.target.checked ? (b ? [b[0], b[1]] : [[-100, -100, -100], [100, 100, 100]]) : null); }} />Recorte por caja</label>
          {cr && [0, 1].map((k) => <div key={k} className="prow3"><span className="plabel">{k ? 'Máx.' : 'Mín.'}</span>{[0, 1, 2].map((j) => <input key={j} className="num" type="number" value={cr[k][j]} onChange={(e) => { const n = structuredClone(cr); n[k][j] = parseFloat(e.target.value) || 0; setCrop(n); }} />)}</div>)}
        </div>
      ); })}
      <div className="modal-btns"><button className="btn" onClick={attach}>Adjuntar (XYZ, CSV, PLY)…</button><button className={`btn ${tool === 'cloudPick' ? 'primary' : ''}`} disabled={!clouds.length} onClick={() => S().set({ tool: tool === 'cloudPick' ? null : 'cloudPick' })}>Punto de nube</button><span className="grow" /><button className="btn" onClick={onClose}>Cerrar</button></div>
      {tool === 'cloudPick' && <div className="pick-info">Clic en un punto de la nube: crea un punto de trabajo</div>}
    </Modal>
  );
}
// Biblioteca de usuario del centro de contenido
const UC_LS = 'inv3d.userContent';
export function userContent(): { name: string; doc: PartDoc }[] { try { return JSON.parse(localStorage.getItem(UC_LS) || '[]'); } catch { return []; } }
export function registerUserContent() {
  if (CONTENT.some((f) => f.id === 'user')) return;
  CONTENT.push({ id: 'user', name: 'Biblioteca de usuario', std: 'propia', category: 'Usuario', get sizes() { return userContent().map((x) => x.name); }, make: (size: string) => { const it = userContent().find((x) => x.name === size); if (!it) throw new Error('Pieza no encontrada en la biblioteca'); return structuredClone(it.doc); } } as never);
}
export function PublishDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [lib, setLib] = useState(userContent());
  const save = (l: typeof lib) => { setLib(l); try { localStorage.setItem(UC_LS, JSON.stringify(l)); } catch { S().notify('No caben más piezas en la biblioteca del navegador', 'error'); } };
  const pub = (name: string, doc: PartDoc) => save([...lib.filter((x) => x.name !== name), { name, doc: structuredClone(doc) }]);
  const [name, setName] = useState(s.doc.iProperties.partNumber || s.fileName.replace(/\.i3p$/i, ''));
  return (
    <Modal title="Publicar en el centro de contenido" onClose={onClose}>
      <Row label="Nombre"><input value={name} onChange={(e) => setName(e.target.value)} /></Row>
      <div className="ai-row" style={{ gap: 6 }}><button className="btn primary" disabled={s.kind !== 'part'} onClick={() => pub(name, S().doc)}>Publicar pieza</button>
        <button className="btn" onClick={() => { let n = 0; for (const d of S().docs) if (d.kind === 'part') { const dd = S().docData(d.id) as PartDoc; if (dd) { pub(dd.iProperties.partNumber || d.fileName, dd); n++; } } S().notify(`${n} piezas publicadas`); setLib(userContent()); }}>Publicación por lotes (piezas abiertas)</button></div>
      <p className="phelp">Las piezas publicadas aparecen en Ensamblar › Centro de contenido › Biblioteca de usuario (en este navegador). Para operaciones reutilizables: Herramientas › eOperaciones.</p>
      {lib.map((x) => <div key={x.name} className="ai-row" style={{ gap: 6 }}>{x.name}<span className="grow" /><button className="btn sm" onClick={() => save(lib.filter((y) => y.name !== x.name))}>✕</button></div>)}
      <div className="modal-btns"><span className="grow" /><button className="btn" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}

// ===================== ENTORNOS =====================
export function StudioDialog({ onClose }: { onClose: () => void }) {
  const on = useStore((s) => s.studio);
  useEffect(() => { useStore.setState({ studio: true }); }, []);
  const shot = (k = 2) => {
    const V = (window as unknown as { __v3d: { renderer: { domElement: HTMLCanvasElement; setPixelRatio: (x: number) => void; getPixelRatio: () => number; render: (a: unknown, b: unknown) => void }; scene: unknown; camera: unknown } }).__v3d;
    const r = V.renderer, pr = r.getPixelRatio(); r.setPixelRatio(pr * k); r.render(V.scene, V.camera);
    const url = r.domElement.toDataURL('image/png'); r.setPixelRatio(pr); r.render(V.scene, V.camera);
    const a = document.createElement('a'); a.href = url; a.download = `${S().doc.iProperties.partNumber || 'render'}.png`; a.click();
  };
  return (
    <Modal title="Estudio de render" onClose={onClose} float>
      <label className="check"><input type="checkbox" checked={on} onChange={(e) => useStore.setState({ studio: e.target.checked })} />Modo estudio (iluminación de entorno, sombras y suelo)</label>
      <p className="phelp">Cambia materiales con Herramientas › Aspecto. Orienta la vista y captura la imagen.</p>
      <div className="modal-btns"><button className="btn" onClick={() => shot(2)}>Capturar imagen (×2)</button><button className="btn" onClick={() => shot(4)}>Capturar (×4)</button><span className="grow" /><button className="btn" onClick={() => { useStore.setState({ studio: false }); onClose(); }}>Salir del estudio</button><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}
export function MoldDialog({ onClose }: { onClose: () => void }) {
  const [shrink, setShrink] = useState('0.5');
  const [margin, setMargin] = useState('20 mm');
  const [plane, setPlane] = useState<'XY' | 'XZ' | 'YZ'>('XY');
  const go = () => {
    const s = S(), nd = newDoc();
    nd.iProperties = { ...s.doc.iProperties, partNumber: s.doc.iProperties.partNumber + '-MOLDE', description: `Molde de ${s.doc.iProperties.partNumber}`, material: 'Acero 1.2311 (molde)' };
    nd.features = [{ id: uid('f'), name: 'Molde', type: 'mold', source: s.active, sourceName: s.fileName, doc: structuredClone(s.doc), shrink, margin, plane }];
    s.addDocument('part', nd, s.fileName.replace(/\.i3p$/i, '') + '-MOLDE.i3p', true);
    onClose();
  };
  return (
    <Modal title="Crear diseño de molde" onClose={onClose}>
      <Row label="Contracción"><Expr value={shrink} unit="" onCommit={setShrink} /> %</Row>
      <Row label="Margen del bloque"><Expr value={margin} onCommit={setMargin} /></Row>
      <Row label="Plano de partición"><Seg value={plane} onChange={setPlane} options={[['XY', 'XY'], ['XZ', 'XZ'], ['YZ', 'YZ']]} /></Row>
      <p className="phelp">Pieza nueva con el bloque de molde menos la pieza (escalada por la contracción), dividido en macho y hembra por el plano de partición que pasa por el centro de la pieza.</p>
      {btns(go, onClose, 'Crear molde')}
    </Modal>
  );
}
const IFC_CLASSES = ['IfcBuildingElementProxy', 'IfcBeam', 'IfcColumn', 'IfcMember', 'IfcPlate', 'IfcDuctSegment', 'IfcDuctFitting', 'IfcPipeSegment', 'IfcPipeFitting', 'IfcFlowTerminal', 'IfcValve', 'IfcPump', 'IfcTank', 'IfcFurnishingElement', 'IfcMechanicalFastener'];
export function BimDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [b, setB] = useState(() => s.doc.bim ?? { ifcClass: 'IfcBuildingElementProxy', props: [{ name: 'Fabricante', value: '' }, { name: 'Modelo', value: '' }] });
  return (
    <Modal title="Contenido BIM" onClose={onClose}>
      <Row label="Clase IFC"><select value={b.ifcClass} onChange={(e) => setB({ ...b, ifcClass: e.target.value })}>{IFC_CLASSES.map((c) => <option key={c}>{c}</option>)}</select></Row>
      {b.props.map((p, i) => <div key={i} className="ai-row" style={{ gap: 6 }}><input value={p.name} onChange={(e) => setB({ ...b, props: b.props.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} style={{ width: 130 }} /><input value={p.value} onChange={(e) => setB({ ...b, props: b.props.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} style={{ flex: 1 }} /><button className="btn sm" onClick={() => setB({ ...b, props: b.props.filter((_, j) => j !== i) })}>✕</button></div>)}
      <button className="btn" onClick={() => setB({ ...b, props: [...b.props, { name: '', value: '' }] })}>+ Propiedad</button>
      <div className="modal-btns"><button className="btn" onClick={() => { S().commit((d) => { d.bim = b; }); exportIFC(); }}>Guardar y exportar IFC</button><span className="grow" /><button className="btn primary" onClick={() => { S().commit((d) => { d.bim = b; }); onClose(); }}>Guardar</button><button className="btn" onClick={onClose}>Cancelar</button></div>
    </Modal>
  );
}
const PRINTERS: [string, V3][] = [['Prusa MK4 (250×210×220)', [250, 210, 220]], ['Bambu X1/P1 (256×256×256)', [256, 256, 256]], ['Creality Ender 3 (220×220×250)', [220, 220, 250]], ['Formlabs Form 3 (145×145×185)', [145, 145, 185]]];
export function Print3dDialog({ onClose }: { onClose: () => void }) {
  const b = useStore((s) => s.result?.props?.bbox);
  const [pr, setPr] = useState(0);
  const dims = b ? [b[1][0] - b[0][0], b[1][1] - b[0][1], b[1][2] - b[0][2]] : [0, 0, 0];
  const bed = PRINTERS[pr][1];
  const fits = (o: number[]) => o.every((x, i) => x <= bed[i] + 1e-6);
  const perms = [[0, 1, 2], [1, 0, 2], [0, 2, 1], [2, 0, 1], [1, 2, 0], [2, 1, 0]].map((p) => p.map((i) => dims[i]));
  const ok = perms.find(fits);
  return (
    <Modal title="Impresión 3D" onClose={onClose}>
      <Row label="Impresora"><select value={pr} onChange={(e) => setPr(+e.target.value)}>{PRINTERS.map(([n], i) => <option key={i} value={i}>{n}</option>)}</select></Row>
      <p>Pieza: {dims.map((x) => x.toFixed(1)).join(' × ')} mm · {ok ? <span style={{ color: '#2a9d4b' }}>cabe en la bandeja{fits(dims) ? '' : ' (girándola)'}</span> : <span style={{ color: 'var(--danger)' }}>no cabe: divídela o escálala</span>}</p>
      <p className="phelp">3MF conserva unidades y color (recomendado para PrusaSlicer, Bambu Studio y Cura); STL para cualquier laminador.</p>
      <div className="modal-btns"><button className="btn primary" onClick={() => exportMesh('3mf')}>Exportar 3MF</button><button className="btn" onClick={() => exportMesh('obj')}>OBJ</button><span className="grow" /><button className="btn" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}
export function ShareDialog({ onClose }: { onClose: () => void }) {
  const pdf = async () => {
    const V = (window as unknown as { __v3d: { renderer: { domElement: HTMLCanvasElement } } }).__v3d;
    const img = V.renderer.domElement.toDataURL('image/png');
    const { jsPDF } = await import('jspdf');
    const s = S(), doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(14); doc.text(`${s.doc.iProperties.partNumber} · ${s.doc.iProperties.description || ''}`, 12, 12);
    const cv = V.renderer.domElement, w = 180, h = (w * cv.height) / cv.width;
    doc.addImage(img, 'PNG', 12, 18, w, Math.min(h, 170));
    doc.setFontSize(9); let y = 22;
    doc.text(`Material: ${s.doc.iProperties.material}`, 200, y); y += 5;
    if (s.doc.docset?.genTol) { doc.text(`Tolerancia general: ${s.doc.docset.genTol}`, 200, y); y += 5; }
    doc.text('Anotaciones 3D:', 200, (y += 3)); y += 5;
    for (const a of s.doc.pmi ?? []) { const d = a.p2 ? Math.hypot(a.p2[0] - a.p[0], a.p2[1] - a.p[1], a.p2[2] - a.p[2]) : undefined; doc.text(`• ${PMI_NAMES[a.kind]}: ${pmiText(a, d)}`.slice(0, 60), 200, y); y += 4.5; if (y > 200) break; }
    doc.save(`${s.doc.iProperties.partNumber || 'pieza'}-3D.pdf`);
  };
  return (
    <Modal title="Exportar y compartir" onClose={onClose}>
      <p className="phelp">PDF con la vista actual del modelo y la lista de anotaciones 3D; glTF para visores web y realidad aumentada; STEP para otros programas CAD.</p>
      <div className="modal-btns" style={{ flexWrap: 'wrap', gap: 6 }}><button className="btn primary" onClick={pdf}>PDF (vista + anotaciones)</button><button className="btn" onClick={() => exportMesh('glb')}>glTF (.glb)</button><button className="btn" onClick={async () => (await import('../core/files')).exportSTEP()}>Formato CAD (STEP)</button><span className="grow" /><button className="btn" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}
