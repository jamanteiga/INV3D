// Tuberías y presión: red de tuberías, comprobaciones a presión (tubo, bridas, derivaciones, soportes) y recipientes EN 13445.
import { useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { uid, type V3 } from '../core/doc';
import { buildGraph, leaves, termName } from '../core/ductnet';
import { calcPipe, generatePipe, newPipeNet, pipeSizes, sizeLabel, type PipeNet } from '../core/pipenet';
import { PIPE_MATERIALS, B165_CLASSES, EN_PN, SCHEDULES, ASME_PIPE, EN_OD, NPS_DN } from '../core/pipedata';
import { STRESS, stressAt, pipeThickness, pipeMaxP, b165Rating, B165_GROUPS, enRating, branchReinf, pipeSpan, MSS_SPAN, vesselThickness, vesselVolume, pedVessel, hydroTest, nextPlate, HEAD_NAMES, type HeadType } from '../core/pressure';
import { makeVessel, type Nozzle } from '../core/vessel';
import { od, wallOf } from '../core/piping';
import { downloadXlsx } from '../core/xlsx';
import { newDrawing, SCALES, type DrawingDoc } from '../core/drawing';
import { fmt } from '../core/expr';
import { asmActions } from './actions';
import { Modal, Row, Seg } from './Panels';

const f = (x: number, d = 1) => (isFinite(x) ? fmt(x, d) : '—');
const OK = ({ ok }: { ok: boolean }) => <b style={{ color: ok ? 'var(--ok, #2b8a3e)' : 'var(--danger, #c0392b)' }}>{ok ? '✓ cumple' : '✗ no cumple'}</b>;
const Num = ({ v, on, step = 1 }: { v: number; on: (x: number) => void; step?: number }) => <input type="number" step={step} value={v} onChange={(e) => on(Number(e.target.value))} onKeyDown={(e) => e.stopPropagation()} />;

// =================== Red de tuberías ===================
export function PipeNetDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [net, setNet] = useState<PipeNet>(() => structuredClone((s.asm as { pipeNets?: PipeNet[] }).pipeNets?.[0] ?? newPipeNet(uid('pn'))));
  const [tab, setTab] = useState<'route' | 'calc' | 'check'>('route');
  const up = (p: Partial<PipeNet>) => setNet({ ...net, ...p });
  const g = useMemo(() => buildGraph(s.asm, net), [s.asm, net]);
  const lv = leaves(g);
  const c = useMemo(() => calcPipe(s.asm, net), [s.asm, net]);
  const gen = useMemo(() => { try { return generatePipe(net, c); } catch (e) { return { items: [], warnings: [(e as Error).message] }; } }, [net, c]);
  const srcKey = c.source >= 0 ? g.nodes[c.source]?.key : '';
  const save = (n = net) => s.commitAsm((a) => { (a as { pipeNets?: PipeNet[] }).pipeNets = [n]; });
  const sizes = pipeSizes(net.norm);
  const mats = (use: 'pipe' | 'fitting' | 'flange') => PIPE_MATERIALS.filter((m) => m.std === net.norm && m.use.includes(use)).map((m) => m.name);
  const setNorm = (norm: 'ASME' | 'EN') => {
    const p0 = mats('pipe');
    const pick = (use: 'pipe' | 'fitting' | 'flange') => PIPE_MATERIALS.find((m) => m.std === norm && m.use.includes(use))?.name ?? '';
    void p0;
    setNet({ ...net, norm, size: norm === 'ASME' ? '4' : '100', rating: norm === 'ASME' ? 150 : 16, code: norm === 'ASME' ? 'B31.3' : 'EN', material: pick('pipe'), fitMaterial: pick('fitting'), flMaterial: pick('flange'), stressMat: STRESS.find((m) => m.code === (norm === 'ASME' ? 'B31.3' : 'EN'))!.name });
  };
  const generate = () => {
    if (c.errors.length) { s.notify(c.errors[0], 'error'); return; }
    const ids = asmActions.placeGenerated(net.id, gen.items, net.generated);
    const n2 = { ...net, generated: ids }; setNet(n2); save(n2);
    s.notify(`Red de tuberías generada: ${gen.items.length} piezas${gen.warnings.length ? ` · ${gen.warnings.length} avisos` : ''}`, gen.warnings.length ? 'error' : undefined);
  };
  const toExcel = () => downloadXlsx([
    { name: 'Líneas', rows: [['Línea', 'Tamaño', 'L (m)', 'Q (m³/h)', 'v (m/s)', 'R (Pa/m)', 'Δp (bar)', 'Δp acum. (bar)'], ...c.rows.map((r) => [r.name, r.size, +(r.L / 1000).toFixed(2), r.q, +r.v.toFixed(2), +r.R.toFixed(0), +r.dp.toFixed(4), +r.dpTot.toFixed(4)])] },
    { name: 'Comprobación', rows: [['Tamaño', 'OD (mm)', 'e nominal (mm)', 'e mín. + c (mm)', 'e nominal necesario (mm)', 'Cumple', 'Categoría PED', 'Tabla', 'Vano máx. (m)'], ...c.check.map((k) => [k.size, k.D, k.tn, +k.treq.toFixed(2), +k.tNom.toFixed(2), k.ok ? 'Sí' : 'No', k.ped, k.table, +(k.span / 1000).toFixed(2)])] },
    { name: 'Piezas', rows: [['Línea', 'Código', 'Descripción'], ...gen.items.map((i) => [c.rows[i.seg]?.name ?? '', i.code, i.desc])] },
  ], `${s.asm.iProperties.partNumber}-${net.name}`);
  const iso = () => {
    const pts = g.nodes.map((n) => n.p);
    const ext = pts.length ? Math.max(...[0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k])))) : 1000;
    const sc = SCALES.find((x) => ext * 1.3 * x <= 240) ?? SCALES[SCALES.length - 1];
    const dw: DrawingDoc = newDrawing();
    dw.sheet = 'A3'; dw.std = s.settings.drawingStd;
    dw.title = { ...dw.title, title: `${net.name} · isométrico`, partNumber: `${s.asm.iProperties.partNumber}-ISO-T`, designer: s.settings.userName, company: s.settings.company, scale: sc >= 1 ? `${sc}:1` : `1:${Math.round(1 / sc)}`, date: new Date().toLocaleDateString('es-ES') };
    const vid = uid('v');
    dw.views = [{ id: vid, name: 'Isométrica', source: s.active, dir: 'iso', scale: sc, x: 150, y: 165, hidden: false, kind: 'iso' }];
    dw.bom = { view: vid, x: 0, y: 0 };
    const lines = [`${net.name} · PS ${net.P} bar · TS ${net.T} °C · ${net.code === 'B31.3' ? 'ASME B31.3' : 'EN 13480'} · ${net.material}`, ...c.rows.map((r) => `${r.name}  ${r.size}  L ${f(r.L / 1000, 2)} m  Q ${r.q} m³/h  v ${f(r.v, 2)} m/s`), ...c.check.map((k) => `${k.size}: PED ${k.ped} · vano máx. ${f(k.span / 1000, 1)} m`)];
    dw.notes = lines.map((t, i) => ({ id: uid('n'), x: 20, y: 60 - i * 4.5 + lines.length * 4.5, text: t, size: i ? 2.5 : 3 }));
    s.addDocument('drawing', dw, `${s.asm.iProperties.partNumber}-ISO-T.i3d`);
  };
  return (
    <Modal title={`Red de tuberías — ${net.name}`} onClose={() => { save(); onClose(); }} xwide>
      <Row label="Ver"><Seg value={tab} onChange={setTab} options={[['route', 'Trazado y caudales'], ['calc', 'Pérdidas de carga'], ['check', 'Espesores, PED y soportes']]} /></Row>
      {c.errors.map((e) => <div key={e} className="fdlg-err">{e}</div>)}
      {tab === 'route' && (<div className="net-grid">
        <div>
          <p className="phelp">Trazado: líneas 3D del esqueleto ({g.edges.length} tramos, {lv.length} extremos). Las derivaciones se detectan donde una línea llega a otra.</p>
          <div className="modal-btns" style={{ justifyContent: 'flex-start', marginTop: 0 }}><button className="btn" onClick={() => { save(); onClose(); asmActions.openSkel(); }}>Dibujar trazado (Línea 3D)</button></div>
          <Row label="Nombre"><input value={net.name} onChange={(e) => up({ name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></Row>
          <Row label="Origen"><select value={srcKey} onChange={(e) => { const n = g.nodes.find((x) => x.key === e.target.value); if (n) up({ source: [...n.p] as V3 }); }}>{lv.map((n) => <option key={n.key} value={n.key}>({n.key.replace(/,/g, '; ')})</option>)}</select></Row>
          <Row label="Norma"><Seg value={net.norm} onChange={setNorm} options={[['EN', 'EN (DN, EN 10253 / EN 1092-1)'], ['ASME', 'ASME (NPS, B16.9 / B16.5)']]} /></Row>
          <Row label="Tamaño"><Seg value={net.sizing} onChange={(v) => up({ sizing: v })} options={[['vel', 'Por velocidad'], ['fixed', 'Fijo']]} /></Row>
          {net.sizing === 'vel' ? <Row label="v máx. (m/s)"><Num v={net.vmax} step={0.1} on={(x) => up({ vmax: x || 0.5 })} /></Row>
            : <Row label="Tamaño"><select value={net.size} onChange={(e) => up({ size: e.target.value })}>{sizes.map((z) => <option key={z} value={z}>{sizeLabel(net, z)}</option>)}</select></Row>}
          {net.norm === 'ASME' ? <Row label="Schedule"><select value={net.sch} onChange={(e) => up({ sch: e.target.value })}>{SCHEDULES.map((x) => <option key={x}>{x}</option>)}</select></Row>
            : <Row label="Espesor (mm)"><Num v={net.wall} step={0.1} on={(x) => up({ wall: x })} /><span className="ro" style={{ marginLeft: 6 }}>0 = serie habitual</span></Row>}
          <Row label="Codos"><Seg value={net.elbow} onChange={(v) => up({ elbow: v })} options={[['LR', 'Radio largo 1,5D'], ['SR', 'Radio corto 1D']]} /></Row>
          <label className="check"><input type="checkbox" checked={net.flanges} onChange={(e) => up({ flanges: e.target.checked })} />Bridas WN en el origen y en los extremos</label>
          {net.flanges && <Row label={net.norm === 'ASME' ? 'Clase' : 'PN'}><select value={net.rating} onChange={(e) => up({ rating: Number(e.target.value) })}>{(net.norm === 'ASME' ? B165_CLASSES : Object.keys(EN_PN).map(Number)).map((r) => <option key={r} value={r}>{net.norm === 'ASME' ? `Clase ${r}` : `PN ${r}`}</option>)}</select></Row>}
          <Row label="Tubo"><select value={net.material} onChange={(e) => up({ material: e.target.value })}>{mats('pipe').map((m) => <option key={m}>{m}</option>)}</select></Row>
          <Row label="Accesorios"><select value={net.fitMaterial} onChange={(e) => up({ fitMaterial: e.target.value })}>{mats('fitting').map((m) => <option key={m}>{m}</option>)}</select></Row>
          <Row label="Bridas"><select value={net.flMaterial} onChange={(e) => up({ flMaterial: e.target.value })}>{mats('flange').map((m) => <option key={m}>{m}</option>)}</select></Row>
        </div>
        <div>
          <div className="psec-title">Consumos (extremos)</div>
          <table className="ptable"><thead><tr><th>Extremo</th><th>Posición</th><th className="num">Q (m³/h)</th></tr></thead>
            <tbody>{lv.filter((n) => n.key !== srcKey).map((n) => { const t = net.terminals[n.key] ?? { q: 10 }; return (
              <tr key={n.key}><td><input value={t.name ?? termName(g, c.source, n.id)} onChange={(e) => up({ terminals: { ...net.terminals, [n.key]: { ...t, name: e.target.value } } })} onKeyDown={(e) => e.stopPropagation()} /></td><td className="ro">{n.key.replace(/,/g, '; ')}</td>
                <td className="num"><Num v={t.q} on={(x) => up({ terminals: { ...net.terminals, [n.key]: { ...t, q: x } } })} /></td></tr>); })}</tbody></table>
          <div className="psec-title">Fluido y diseño</div>
          <Row label="Densidad (kg/m³)"><Num v={net.rho} on={(x) => up({ rho: x || 1 })} /></Row>
          <Row label="Viscosidad (Pa·s)"><Num v={net.mu} step={0.0001} on={(x) => up({ mu: x || 1e-5 })} /></Row>
          <Row label="Estado / grupo PED"><span style={{ display: 'flex', gap: 6 }}><Seg value={net.state} onChange={(v) => up({ state: v })} options={[['liquid', 'Líquido'], ['gas', 'Gas']]} /><Seg value={String(net.group) as '1' | '2'} onChange={(v) => up({ group: Number(v) as 1 | 2 })} options={[['1', 'Grupo 1'], ['2', 'Grupo 2']]} /></span></Row>
          <Row label="PS (bar) / TS (°C)"><span style={{ display: 'flex', gap: 6 }}><Num v={net.P} on={(x) => up({ P: x })} /><Num v={net.T} on={(x) => up({ T: x })} /></span></Row>
        </div>
      </div>)}
      {tab === 'calc' && (<table className="ptable bom"><thead><tr><th>Línea</th><th>Tamaño</th><th className="num">L (m)</th><th className="num">Q (m³/h)</th><th className="num">v (m/s)</th><th className="num">R (Pa/m)</th><th className="num">Δp (bar)</th><th className="num">Δp acum. (bar)</th></tr></thead>
        <tbody>{c.rows.map((r) => <tr key={r.seg} className={r.v > net.vmax * 1.01 ? 'warn' : ''}><td>{r.name}</td><td>{r.size}</td><td className="num">{f(r.L / 1000, 2)}</td><td className="num">{r.q}</td><td className="num">{f(r.v, 2)}</td><td className="num">{f(r.R, 0)}</td><td className="num">{f(r.dp, 4)}</td><td className="num">{f(r.dpTot, 4)}</td></tr>)}</tbody></table>)}
      {tab === 'check' && (<>
        <div className="net-grid">
          <div>
            <Row label="Código"><Seg value={net.code} onChange={(v) => up({ code: v, stressMat: STRESS.find((m) => m.code === v)!.name })} options={[['EN', 'EN 13480-3'], ['B31.3', 'ASME B31.3']]} /></Row>
            <Row label="Tensión admisible"><select value={net.stressMat} onChange={(e) => up({ stressMat: e.target.value })}>{STRESS.filter((m) => m.code === net.code).map((m) => <option key={m.name}>{m.name}</option>)}</select></Row>
            <Row label="f / S a TS"><span className="ro">{f(c.S, 1)} MPa</span></Row>
          </div>
          <div>
            <Row label="Sobrespesor c (mm)"><Num v={net.c} step={0.5} on={(x) => up({ c: x })} /></Row>
            <Row label="Tolerancia (%)"><Num v={net.tol} step={0.5} on={(x) => up({ tol: x })} /></Row>
            <Row label="Aislamiento (mm)"><Num v={net.ins} step={10} on={(x) => up({ ins: x })} /></Row>
          </div>
        </div>
        <table className="ptable bom"><thead><tr><th>Tamaño</th><th className="num">OD</th><th className="num">e nominal</th><th className="num">e mín. + c</th><th className="num">e nominal nec.</th><th>Espesor</th><th>Categoría PED</th><th className="num">Vano máx. (m)</th></tr></thead>
          <tbody>{c.check.map((k) => <tr key={k.size}><td>{k.size}</td><td className="num">{k.D}</td><td className="num">{f(k.tn, 2)}</td><td className="num">{f(k.treq, 2)}</td><td className="num">{f(k.tNom, 2)}</td><td><OK ok={k.ok} /></td><td title={k.table}>{k.ped}</td><td className="num">{f(k.span / 1000, 2)}</td></tr>)}</tbody></table>
        <p className="phelp">Espesor de tubo recto ({net.code === 'B31.3' ? 'B31.3 §304.1.2, Y = 0,4' : 'EN 13480-3 §6.1, z = 1'}). Categoría según la Directiva 2014/68/UE, Anexo II (orientativa). Vano entre soportes con tubo lleno: flexión ≤ 10,3 MPa y flecha ≤ 2,5 mm (criterio MSS SP-58). Valores orientativos: verifica con la edición vigente de cada norma.</p>
      </>)}
      {gen.warnings.map((w) => <div key={w} className="fdlg-err">{w}</div>)}
      <div className="modal-btns">
        <button className="btn" onClick={toExcel}>Exportar Excel</button>
        <button className="btn" disabled={!net.generated?.length} onClick={() => { save(); iso(); }}>Plano isométrico</button>
        <span className="grow" />
        <button className="btn" onClick={() => { save(); onClose(); }}>Cerrar</button>
        <button className="btn primary" disabled={!!c.errors.length || !gen.items.length} onClick={generate}>{net.generated?.length ? 'Regenerar en el ensamblaje' : 'Generar en el ensamblaje'}</button>
      </div>
    </Modal>
  );
}

// =================== Comprobación a presión ===================
export function PressureDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'pipe' | 'flange' | 'branch' | 'span'>('pipe');
  const [norm, setNorm] = useState<'ASME' | 'EN'>('EN');
  const [code, setCode] = useState<'B31.3' | 'EN'>('EN');
  const [mat, setMat] = useState('P235GH (EN 10216-2)');
  const [P, setP] = useState(16), [T, setT] = useState(120), [c, setC] = useState(1), [tol, setTol] = useState(12.5), [E, setE] = useState(1);
  const [size, setSize] = useState('100'), [sch, setSch] = useState('STD'), [wall, setWall] = useState(0);
  const [grp, setGrp] = useState('1.1'), [cls, setCls] = useState(150), [enG, setEnG] = useState<'3E0' | '13E0'>('3E0'), [pn, setPn] = useState(16);
  const [size2, setSize2] = useState('50'), [beta, setBeta] = useState(90), [padT, setPadT] = useState(0), [padD, setPadD] = useState(0);
  const [rhoF, setRhoF] = useState(1000), [ins, setIns] = useState(0), [rhoI, setRhoI] = useState(100);
  const m = STRESS.find((x) => x.name === mat) ?? STRESS[0];
  const S = stressAt(m, T);
  const spec = { norm, sch, wall: wall || undefined };
  const sizes = norm === 'ASME' ? Object.keys(ASME_PIPE) : Object.keys(EN_OD);
  const D = od(spec, size), tn = wallOf(spec, size), D2 = od(spec, size2), tn2 = wallOf(spec, size2);
  const r = pipeThickness({ code, P, D, S, E, c, tol });
  const pmax = pipeMaxP({ code, tn, D, S, E, c, tol });
  const rr = pipeThickness({ code, P, D: D2, S, E, c, tol });
  const br = branchReinf({ Dh: D, Th: tn * (1 - tol / 100), th: r.t, Db: D2, Tb: tn2 * (1 - tol / 100), tb: rr.t, c, beta, padT, padD });
  const sp = pipeSpan({ D, t: tn, rhoPipe: 7850, rhoFluid: rhoF, insE: ins, rhoIns: rhoI, S, E: m.E });
  const nps = norm === 'ASME' ? size : Object.entries(NPS_DN).find(([, dn]) => dn === Number(size))?.[0] ?? '';
  const lab = (z: string) => (norm === 'ASME' ? `${z}"` : `DN${z}`);
  const rating = norm === 'ASME' ? b165Rating(grp, cls, T) : enRating(enG, pn, T);
  const minCls = norm === 'ASME' ? B165_CLASSES.find((k) => b165Rating(grp, k, T) >= P) : Object.keys(EN_PN).map(Number).find((k) => enRating(enG, k, T) >= P);
  return (
    <Modal title="Comprobación a presión" onClose={onClose} xwide>
      <Row label="Ver"><Seg value={tab} onChange={setTab} options={[['pipe', 'Espesor de tubo'], ['flange', 'Bridas P-T'], ['branch', 'Refuerzo de derivación'], ['span', 'Vanos entre soportes']]} /></Row>
      <div className="net-grid">
        <div>
          <Row label="Norma de tubo"><Seg value={norm} onChange={(v) => { setNorm(v); setSize(v === 'ASME' ? '4' : '100'); setSize2(v === 'ASME' ? '2' : '50'); }} options={[['EN', 'EN (DN)'], ['ASME', 'ASME (NPS)']]} /></Row>
          <Row label="Código de cálculo"><Seg value={code} onChange={(v) => { setCode(v); setMat(STRESS.find((x) => x.code === v)!.name); }} options={[['EN', 'EN 13480-3'], ['B31.3', 'ASME B31.3']]} /></Row>
          <Row label="Material"><select value={mat} onChange={(e) => setMat(e.target.value)}>{STRESS.filter((x) => x.code === code).map((x) => <option key={x.name}>{x.name}</option>)}</select></Row>
          <Row label="P (bar) / T (°C)"><span style={{ display: 'flex', gap: 6 }}><Num v={P} on={setP} /><Num v={T} on={setT} /></span></Row>
          <Row label={code === 'B31.3' ? 'S a T' : 'f a T'}><span className="ro">{f(S, 1)} MPa{!isFinite(S) ? ' (fuera de tabla)' : ''}</span></Row>
        </div>
        <div>
          <Row label="Tamaño"><select value={size} onChange={(e) => setSize(e.target.value)}>{sizes.map((z) => <option key={z} value={z}>{lab(z)}</option>)}</select></Row>
          {norm === 'ASME' ? <Row label="Schedule"><select value={sch} onChange={(e) => setSch(e.target.value)}>{SCHEDULES.map((x) => <option key={x}>{x}</option>)}</select></Row> : <Row label="Espesor (mm)"><Num v={wall} step={0.1} on={setWall} /><span className="ro" style={{ marginLeft: 6 }}>0 = serie</span></Row>}
          <Row label="c (mm) · tol. (%)"><span style={{ display: 'flex', gap: 6 }}><Num v={c} step={0.5} on={setC} /><Num v={tol} step={0.5} on={setTol} /></span></Row>
          <Row label={code === 'B31.3' ? 'E (soldadura)' : 'z (soldadura)'}><select value={E} onChange={(e) => setE(Number(e.target.value))}><option value={1}>1,0 (sin costura)</option><option value={0.85}>0,85</option><option value={0.8}>0,8</option><option value={0.7}>0,7</option></select></Row>
        </div>
      </div>
      {tab === 'pipe' && (<div className="calc-box">
        <Row label="Tubo"><span className="ro">{lab(size)} · Ø{D} × {f(tn, 2)} mm</span></Row>
        <Row label="Espesor de cálculo t"><span className="ro">{f(r.t, 2)} mm</span></Row>
        <Row label="t + c (mínimo)"><span className="ro">{f(r.tm, 2)} mm</span></Row>
        <Row label="Nominal necesario"><span className="ro"><b>{f(r.tNom, 2)} mm</b> → {tn >= r.tNom ? <OK ok /> : <OK ok={false} />}</span></Row>
        <Row label="P máx. admisible"><span className="ro">{f(pmax, 1)} bar</span></Row>
        <p className="phelp">{code === 'B31.3' ? 't = P·D / [2(S·E·W + P·Y)] con Y = 0,4, W = 1 (B31.3 §304.1.2, ec. 3a)' : 'e = p·Do / (2·f·z + p) (EN 13480-3 §6.1, ec. 6.1-2)'}; nominal = (t + c)/(1 − tol).</p>
      </div>)}
      {tab === 'flange' && (<div className="calc-box">
        {norm === 'ASME' ? (<>
          <Row label="Grupo de material"><select value={grp} onChange={(e) => setGrp(e.target.value)}>{Object.entries(B165_GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Row>
          <Row label="Clase"><select value={cls} onChange={(e) => setCls(Number(e.target.value))}>{B165_CLASSES.map((k) => <option key={k} value={k}>{k}</option>)}</select></Row>
        </>) : (<>
          <Row label="Grupo de material"><select value={enG} onChange={(e) => setEnG(e.target.value as '3E0')}><option value="3E0">3E0 · P245GH, P250GH</option><option value="13E0">13E0 · 1.4307, 1.4404</option></select></Row>
          <Row label="PN"><select value={pn} onChange={(e) => setPn(Number(e.target.value))}>{Object.keys(EN_PN).map((k) => <option key={k} value={k}>PN {k}</option>)}</select></Row>
        </>)}
        <Row label="Presión admisible a T"><span className="ro"><b>{f(rating, 1)} bar</b> → <OK ok={rating >= P} /></span></Row>
        <Row label="Mínimo que cumple"><span className="ro">{minCls ? (norm === 'ASME' ? `Clase ${minCls}` : `PN ${minCls}`) : 'ninguno'}</span></Row>
        <p className="phelp">{norm === 'ASME' ? 'ASME B16.5 tabla 2 (clases 150 y 300 tabuladas; el resto en proporción a la clase 300).' : 'EN 1092-1: PS ≈ PN · Rp0,2(T)/Rp0,2(RT), aproximación por grupo de material.'} Orientativo: verifica con la tabla P-T de la edición vigente.</p>
      </div>)}
      {tab === 'branch' && (<div className="calc-box">
        <Row label="Derivación"><select value={size2} onChange={(e) => setSize2(e.target.value)}>{sizes.filter((z) => od(spec, z) <= D).map((z) => <option key={z} value={z}>{lab(z)}</option>)}</select><span className="ro" style={{ marginLeft: 6 }}>Ø{D2} × {f(tn2, 2)}</span></Row>
        <Row label="Ángulo β (°)"><Num v={beta} on={(x) => setBeta(Math.min(90, Math.max(45, x)))} /></Row>
        <Row label="Placa de refuerzo"><span style={{ display: 'flex', gap: 6 }}><Num v={padT} on={setPadT} /><Num v={padD} on={setPadD} /></span><span className="ro" style={{ marginLeft: 6 }}>espesor · Ø exterior (mm)</span></Row>
        <table className="ptable"><tbody>
          <tr><td>A1 · área a reponer</td><td className="num">{f(br.A1, 0)} mm²</td></tr>
          <tr><td>A2 · exceso en el colector</td><td className="num">{f(br.A2, 0)} mm²</td></tr>
          <tr><td>A3 · exceso en la derivación (L4 = {f(br.L4, 1)})</td><td className="num">{f(br.A3, 0)} mm²</td></tr>
          <tr><td>A4 · placa de refuerzo</td><td className="num">{f(br.A4, 0)} mm²</td></tr>
          <tr><td><b>A2 + A3 + A4 ≥ A1</b></td><td className="num"><OK ok={br.ok} /></td></tr>
        </tbody></table>
        <p className="phelp">Compensación de áreas ASME B31.3 §304.3.3 (sin contar las soldaduras), d1 = {f(br.d1, 1)} mm, d2 = {f(br.d2, 1)} mm. EN 13480-3 §8 usa un método análogo de compensación de áreas.</p>
      </div>)}
      {tab === 'span' && (<div className="calc-box">
        <Row label="Fluido (kg/m³)"><Num v={rhoF} on={setRhoF} /></Row>
        <Row label="Aislamiento"><span style={{ display: 'flex', gap: 6 }}><Num v={ins} step={10} on={setIns} /><Num v={rhoI} step={10} on={setRhoI} /></span><span className="ro" style={{ marginLeft: 6 }}>mm · kg/m³</span></Row>
        <Row label="Peso lineal"><span className="ro">{f(sp.w, 0)} N/m</span></Row>
        <Row label="Vano por resistencia"><span className="ro">{f(sp.Ls / 1000, 2)} m</span></Row>
        <Row label="Vano por flecha 2,5 mm"><span className="ro">{f(sp.Ld / 1000, 2)} m</span></Row>
        <Row label="Vano máximo"><span className="ro"><b>{f(sp.L / 1000, 2)} m</b>{MSS_SPAN[nps] ? ` · MSS SP-58 (agua): ${MSS_SPAN[nps]} m` : ''}</span></Row>
        <p className="phelp">Viga simplemente apoyada con tubo lleno: flexión ≤ 10,3 MPa (1500 psi) y flecha ≤ 2,5 mm. Reduce el vano junto a cargas concentradas (válvulas, bridas) y en cambios de dirección.</p>
      </div>)}
      <div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}

// =================== Recipiente EN 13445 ===================
export function VesselDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [P, setP] = useState(10), [T, setT] = useState(100), [mat, setMat] = useState('P265GH (EN 10216-2)'), [z, setZ] = useState(0.85);
  const [c, setC] = useState(1), [tolP, setTolP] = useState(0.3), [Di, setDi] = useState(1000), [Ltt, setLtt] = useState(2000), [head, setHead] = useState<HeadType>('klopper');
  const [support, setSupport] = useState<'legs' | 'saddles' | 'skirt' | 'none'>('legs');
  const [state, setState] = useState<'gas' | 'liquid'>('gas'), [group, setGroup] = useState<1 | 2>(2);
  const [nz, setNz] = useState<Nozzle[]>([
    { name: 'N1 Entrada', dn: 100, pos: 'shell', z: 1600, angle: 0, proj: 200, pn: 16 },
    { name: 'N2 Salida', dn: 100, pos: 'shell', z: 400, angle: 180, proj: 200, pn: 16 },
    { name: 'N3 Purga', dn: 50, pos: 'bottom', z: 0, angle: 0, proj: 150, pn: 16 },
    { name: 'N4 Válvula seg.', dn: 50, pos: 'top', z: 0, angle: 0, proj: 150, pn: 16 },
    { name: 'M1 Boca de hombre', dn: 500, pos: 'shell', z: 1000, angle: 90, proj: 250, pn: 16 },
  ]);
  const m = STRESS.find((x) => x.name === mat) ?? STRESS[0];
  const fT = stressAt(m, T), f20 = m.S[0];
  const th = vesselThickness({ P, Di, f: fT, z, head });
  const eS = nextPlate(th.eShell + c + tolP), eH = nextPlate(th.eHead + c + tolP + Math.max(0.1 * th.eHead, 1));
  const V = vesselVolume(Di, Ltt, head);
  const ped = pedVessel(state, group, P, V);
  const Pt = hydroTest(P, f20, fT);
  const build = () => makeVessel({ Di, Ltt, eShell: eS, eHead: eH, head, support, nozzles: nz, material: mat, name: `RP-${Di}x${Ltt}`, desc: `Recipiente Ø${Di} × ${Ltt} (TT) · PS ${P} bar · TS ${T} °C · virola ${eS} mm · fondos ${HEAD_NAMES[head].split(' (')[0]} ${eH} mm · ${f(V, 0)} L · PED cat. ${ped.cat}` });
  const create = (place: boolean) => {
    try {
      const d = build(), fnm = `${d.iProperties.partNumber}.i3p`;
      onClose();
      if (place && s.kind === 'assembly') asmActions.startPlace(s.addDocument('part', d, fnm, false));
      else s.addDocument('part', d, fnm);
    } catch (e) { s.notify((e as Error).message, 'error'); }
  };
  const upN = (i: number, p: Partial<Nozzle>) => setNz(nz.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const enMats = STRESS.filter((x) => x.code === 'EN');
  return (
    <Modal title="Recipiente a presión · EN 13445" onClose={onClose} xwide>
      <div className="net-grid">
        <div>
          <div className="psec-title">Diseño</div>
          <Row label="PS (bar) / TS (°C)"><span style={{ display: 'flex', gap: 6 }}><Num v={P} on={setP} /><Num v={T} on={setT} /></span></Row>
          <Row label="Material"><select value={mat} onChange={(e) => setMat(e.target.value)}>{enMats.map((x) => <option key={x.name}>{x.name}</option>)}</select></Row>
          <Row label="f a TS / a 20 °C"><span className="ro">{f(fT, 1)} / {f(f20, 0)} MPa</span></Row>
          <Row label="Coef. de soldadura z"><select value={z} onChange={(e) => setZ(Number(e.target.value))}><option value={1}>1 (grupo de ensayo 1–2)</option><option value={0.85}>0,85 (grupo 3)</option><option value={0.7}>0,7 (grupo 4)</option></select></Row>
          <Row label="c corrosión · tol. chapa"><span style={{ display: 'flex', gap: 6 }}><Num v={c} step={0.5} on={setC} /><Num v={tolP} step={0.1} on={setTolP} /></span></Row>
          <Row label="Di · L entre tangentes"><span style={{ display: 'flex', gap: 6 }}><Num v={Di} step={50} on={setDi} /><Num v={Ltt} step={100} on={setLtt} /></span></Row>
          <Row label="Fondos"><select value={head} onChange={(e) => setHead(e.target.value as HeadType)}>{Object.entries(HEAD_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Row>
          <Row label="Soporte"><select value={support} onChange={(e) => setSupport(e.target.value as 'legs')}><option value="legs">Vertical · 4 patas</option><option value="skirt">Vertical · faldón</option><option value="saddles">Horizontal · 2 cunas</option><option value="none">Sin soportes</option></select></Row>
          <Row label="Fluido PED"><span style={{ display: 'flex', gap: 6 }}><Seg value={state} onChange={setState} options={[['gas', 'Gas'], ['liquid', 'Líquido']]} /><Seg value={String(group) as '1' | '2'} onChange={(v) => setGroup(Number(v) as 1 | 2)} options={[['1', 'Grupo 1'], ['2', 'Grupo 2']]} /></span></Row>
        </div>
        <div>
          <div className="psec-title">Resultados (EN 13445-3)</div>
          <table className="ptable"><tbody>
            <tr><td>Virola §7.4.2: e = P·Di/(2fz − P)</td><td className="num">{f(th.eShell, 2)} mm</td></tr>
            <tr><td>Fondo, casquete (7.5-1)</td><td className="num">{f(th.eHeadCrown, 2)} mm</td></tr>
            <tr><td>Fondo, rótula (7.5-2, β)</td><td className="num">{f(th.eHeadKnuckle, 2)} mm</td></tr>
            <tr><td><b>Chapa virola</b> (+c +tol.)</td><td className="num"><b>{eS} mm</b></td></tr>
            <tr><td><b>Chapa fondos</b> (+c +tol. +10 % conformado)</td><td className="num"><b>{eH} mm</b></td></tr>
            <tr><td>Volumen</td><td className="num">{f(V, 0)} L</td></tr>
            <tr><td>PS·V</td><td className="num">{f(P * V, 0)} bar·L</td></tr>
            <tr><td><b>Categoría PED</b> · {ped.table}</td><td className="num"><b>{ped.cat}</b></td></tr>
            <tr><td>Prueba hidráulica EN 13445-5 §10.2.3.3</td><td className="num">{f(Pt, 1)} bar</td></tr>
          </tbody></table>
          <p className="phelp">Valores orientativos para predimensionar; las tubuladuras (§9) y los soportes (§16) requieren su propio cálculo.</p>
        </div>
      </div>
      <div className="psec-title">Tubuladuras</div>
      <table className="ptable"><thead><tr><th>Nombre</th><th>DN</th><th>Posición</th><th className="num">Altura z / desplaz.</th><th className="num">Ángulo (°)</th><th className="num">Proyección</th><th>PN</th><th /></tr></thead>
        <tbody>{nz.map((n, i) => (<tr key={i}>
          <td><input value={n.name} onChange={(e) => upN(i, { name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></td>
          <td><select value={n.dn} onChange={(e) => upN(i, { dn: Number(e.target.value) })}>{Object.keys(EN_OD).map(Number).filter((x) => x >= 15 && x <= 600).map((x) => <option key={x} value={x}>{x}</option>)}</select></td>
          <td><select value={n.pos} onChange={(e) => upN(i, { pos: e.target.value as 'shell' })}><option value="shell">Virola</option><option value="top">Fondo superior</option><option value="bottom">Fondo inferior</option></select></td>
          <td className="num"><Num v={n.z} step={50} on={(x) => upN(i, { z: x })} /></td>
          <td className="num"><Num v={n.angle} step={15} on={(x) => upN(i, { angle: x })} /></td>
          <td className="num"><Num v={n.proj} step={25} on={(x) => upN(i, { proj: x })} /></td>
          <td><select value={n.pn} onChange={(e) => upN(i, { pn: Number(e.target.value) })}>{Object.keys(EN_PN).map((k) => <option key={k} value={k}>{k}</option>)}</select></td>
          <td><button className="btn icon" onClick={() => setNz(nz.filter((_, k) => k !== i))}>×</button></td>
        </tr>))}</tbody></table>
      <div className="modal-btns">
        <button className="btn" onClick={() => setNz([...nz, { name: `N${nz.length + 1}`, dn: 50, pos: 'shell', z: Ltt / 2, angle: 270, proj: 150, pn: 16 }])}>Añadir tubuladura</button>
        <span className="grow" />
        <button className="btn" onClick={onClose}>Cerrar</button>
        <button className="btn" onClick={() => create(false)}>Abrir como pieza</button>
        {s.kind === 'assembly' && <button className="btn primary" onClick={() => create(true)}>Colocar</button>}
      </div>
    </Modal>
  );
}
