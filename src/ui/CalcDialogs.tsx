// Cálculo estructural: estructura de barras (EN 1993-1-1) y uniones atornilladas y soldadas (EN 1993-1-8).
import { useMemo, useState } from 'react';
import { useStore } from '../core/store';
import type { V3 } from '../core/doc';
import { analyzeFrame, defaultLoads, nkey, type FrameLoads, type SupportType } from '../core/frame3d';
import { BOLTS, BOLT_GRADES } from '../core/catalog';
import { downloadXlsx } from '../core/xlsx';
import { fmt } from '../core/expr';
import { Modal, Row, Seg } from './Panels';

const f = (x: number, d = 1) => (isFinite(x) ? fmt(x, d) : '—');
const Num = ({ v, on, step = 1 }: { v: number; on: (x: number) => void; step?: number }) => <input type="number" step={step} value={v} onChange={(e) => on(Number(e.target.value))} onKeyDown={(e) => e.stopPropagation()} />;
const OK = ({ ok }: { ok: boolean }) => <b style={{ color: ok ? 'var(--ok, #2b8a3e)' : 'var(--danger, #c0392b)' }}>{ok ? '✓' : '✗'}</b>;

// =================== Estructura (EC3) ===================
export function FrameCalcDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [L, setL] = useState<FrameLoads>(() => ({ ...defaultLoads(), ...((s.asm as { frameLoads?: FrameLoads }).frameLoads ?? {}) }));
  const [tab, setTab] = useState<'loads' | 'res' | 'reac'>('loads');
  const up = (p: Partial<FrameLoads>) => setL({ ...L, ...p });
  const r = useMemo(() => analyzeFrame(s.asm, L), [s.asm, L]);
  const nodes = useMemo(() => {
    const out: { key: string; p: V3 }[] = [];
    for (const m of s.asm.frames) for (const p of [m.a, m.b]) if (!out.some((x) => x.key === nkey(p))) out.push({ key: nkey(p), p });
    return out.sort((a, b) => a.p[2] - b.p[2]);
  }, [s.asm.frames]);
  const zMin = nodes.length ? nodes[0].p[2] : 0;
  const supOf = (n: { key: string; p: V3 }): SupportType => L.supports[n.key] ?? (Math.abs(n.p[2] - zMin) < 1 ? 'fixed' : 'free');
  const save = () => s.commitAsm((a) => { (a as { frameLoads?: FrameLoads }).frameLoads = L; });
  const showColors = () => { s.set({ memberUtil: Object.fromEntries(r.members.map((m) => [m.id, m.u])) }); s.notify('Barras coloreadas por aprovechamiento: verde < 50 %, amarillo ≈ 80 %, rojo ≥ 100 %'); };
  const toXls = () => downloadXlsx([
    { name: 'Barras', rows: [['Barra', 'Perfil', 'L (mm)', 'N (kN)', 'Vy (kN)', 'Vz (kN)', 'T (kN·m)', 'My (kN·m)', 'Mz (kN·m)', 'Sección', 'Cortante', 'Pandeo', 'Pandeo lateral', 'Aprovechamiento', 'Flecha (mm)', 'L/flecha', 'Coeficientes'],
      ...r.members.map((m) => [m.name, m.label, Math.round(m.L), +(m.N / 1e3).toFixed(2), +(m.Vy / 1e3).toFixed(2), +(m.Vz / 1e3).toFixed(2), +(m.T / 1e6).toFixed(3), +(m.My / 1e6).toFixed(2), +(m.Mz / 1e6).toFixed(2), +m.uSec.toFixed(3), +m.uShear.toFixed(3), +m.uBuck.toFixed(3), +m.uLT.toFixed(3), +m.u.toFixed(3), +m.defl.toFixed(1), isFinite(m.deflRatio) ? Math.round(m.deflRatio) : '', m.cls])] },
    { name: 'Reacciones', rows: [['Nudo', 'Rx (kN)', 'Ry (kN)', 'Rz (kN)', 'Mx (kN·m)', 'My (kN·m)', 'Mz (kN·m)'], ...r.reactions.map((x) => [x.key, ...x.F.map((v) => +v.toFixed(2)), ...x.M.map((v) => +v.toFixed(2))])] },
  ], `${s.asm.iProperties.partNumber}-calculo-estructura`);
  const worst = r.members.reduce((a, m) => Math.max(a, m.u), 0);
  return (
    <Modal title="Cálculo de la estructura · EN 1993-1-1" onClose={() => { save(); onClose(); }} xwide>
      <Row label="Ver"><Seg value={tab} onChange={setTab} options={[['loads', 'Apoyos y cargas'], ['res', `Comprobación de barras${r.members.length ? ` (máx. ${f(worst * 100, 0)} %)` : ''}`], ['reac', 'Reacciones y desplazamientos']]} /></Row>
      {r.errors.map((e) => <div key={e} className="fdlg-err">{e}</div>)}
      {tab === 'loads' && (<div className="net-grid">
        <div>
          <div className="psec-title">Cargas (EN 1990)</div>
          <Row label="Permanente g (kN/m)"><Num v={L.g} step={0.5} on={(x) => up({ g: x })} /></Row>
          <Row label="Variable q (kN/m)"><Num v={L.q} step={0.5} on={(x) => up({ q: x })} /></Row>
          <p className="phelp">g y q actúan hacia abajo sobre las barras horizontales; el peso propio se añade a g. Combinación ELU = γG·G + γQ·Q, ELS = G + Q.</p>
          <Row label="γG · γQ"><span style={{ display: 'flex', gap: 6 }}><Num v={L.gG} step={0.05} on={(x) => up({ gG: x })} /><Num v={L.gQ} step={0.05} on={(x) => up({ gQ: x })} /></span></Row>
          <Row label="Flecha límite L/"><Num v={L.deflLim} step={50} on={(x) => up({ deflLim: x || 250 })} /></Row>
          <Row label="Pandeo: Lcr = k·L"><Num v={L.kBuck} step={0.1} on={(x) => up({ kBuck: x || 1 })} /></Row>
          <Row label="Pandeo lateral: Lb = k·L"><Num v={L.kLT} step={0.1} on={(x) => up({ kLT: x })} /><span className="ro" style={{ marginLeft: 6 }}>0 = ala arriostrada</span></Row>
        </div>
        <div>
          <div className="psec-title">Nudos: apoyos y cargas puntuales (kN, variables)</div>
          <table className="ptable"><thead><tr><th>Nudo (x; y; z)</th><th>Apoyo</th><th className="num">Fx</th><th className="num">Fy</th><th className="num">Fz</th></tr></thead>
            <tbody>{nodes.map((n) => { const F = L.nodal[n.key] ?? [0, 0, 0]; const setF = (i: number, x: number) => { const nf: V3 = [...F] as V3; nf[i] = x; up({ nodal: { ...L.nodal, [n.key]: nf } }); }; return (
              <tr key={n.key}><td className="ro">{n.key.replace(/,/g, '; ')}</td>
                <td><select value={supOf(n)} onChange={(e) => up({ supports: { ...L.supports, [n.key]: e.target.value as SupportType } })}><option value="free">Libre</option><option value="fixed">Empotrado</option><option value="pinned">Articulado</option><option value="roller">Apoyo simple (Z)</option></select></td>
                {[0, 1, 2].map((i) => <td key={i} className="num"><Num v={F[i]} on={(x) => setF(i, x)} /></td>)}</tr>); })}</tbody></table>
        </div>
      </div>)}
      {tab === 'res' && (<>
        <table className="ptable bom"><thead><tr><th>Barra</th><th>Perfil</th><th className="num">L</th><th className="num">N (kN)</th><th className="num">My (kN·m)</th><th className="num">Mz (kN·m)</th><th className="num">V (kN)</th><th className="num">Sección</th><th className="num">Pandeo</th><th className="num">P. lateral</th><th className="num">Cortante</th><th className="num">Flecha</th><th /></tr></thead>
          <tbody>{r.members.map((m) => (<tr key={m.id} className={m.u > 1 || !m.okDefl ? 'warn' : ''} title={m.cls}>
            <td>{m.name}</td><td>{m.label}</td><td className="num">{f(m.L, 0)}</td><td className="num">{f(m.N / 1e3, 1)}</td><td className="num">{f(m.My / 1e6, 2)}</td><td className="num">{f(m.Mz / 1e6, 2)}</td><td className="num">{f(Math.max(m.Vy, m.Vz) / 1e3, 1)}</td>
            <td className="num">{f(m.uSec * 100, 0)} %</td><td className="num">{f(m.uBuck * 100, 0)} %</td><td className="num">{f(m.uLT * 100, 0)} %</td><td className="num">{f(m.uShear * 100, 0)} %</td>
            <td className="num">{f(m.defl, 1)} mm (L/{isFinite(m.deflRatio) ? Math.round(m.deflRatio) : '∞'})</td><td><OK ok={m.u <= 1 && m.okDefl} /></td></tr>))}</tbody></table>
        <p className="phelp">Sección plástica (clase 1-2 supuesta), cortante con Av, pandeo por flexión con curvas a/b/c según el perfil, pandeo lateral con Mcr (C1 = 1) e interacción lineal simplificada (k = 1, conservadora). γM0 = γM1 = 1,0. Flecha en ELS respecto a la cuerda de la barra. Peso de la estructura: {f(r.weight, 0)} kg.</p>
      </>)}
      {tab === 'reac' && (<>
        <table className="ptable"><thead><tr><th>Nudo</th><th className="num">Rx</th><th className="num">Ry</th><th className="num">Rz (kN)</th><th className="num">Mx</th><th className="num">My</th><th className="num">Mz (kN·m)</th></tr></thead>
          <tbody>{r.reactions.map((x) => <tr key={x.key}><td>{x.key.replace(/,/g, '; ')}</td>{x.F.map((v, i) => <td key={i} className="num">{f(v, 2)}</td>)}{x.M.map((v, i) => <td key={'m' + i} className="num">{f(v, 2)}</td>)}</tr>)}</tbody></table>
        <p className="phelp">Reacciones en ELU. Desplazamiento máximo de nudo (ELU): {f(r.maxDisp, 1)} mm; en ELS: {f(r.sls?.maxDisp ?? 0, 1)} mm.</p>
      </>)}
      <div className="modal-btns">
        <button className="btn" disabled={!r.members.length} onClick={showColors}>Colorear barras</button>
        <button className="btn" disabled={!s.memberUtil} onClick={() => s.set({ memberUtil: null })}>Quitar colores</button>
        <button className="btn" disabled={!r.members.length} onClick={toXls}>Exportar Excel</button>
        <span className="grow" />
        <button className="btn primary" onClick={() => { save(); onClose(); }}>Cerrar</button>
      </div>
    </Modal>
  );
}

// =================== Uniones EN 1993-1-8 ===================
const BW: Record<string, number> = { S235: 0.8, S275: 0.85, S355: 0.9 };
const FU: Record<string, number> = { S235: 360, S275: 430, S355: 490 };
export function JointCalcDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const sel = s.asm.bolts.find((b) => b.id === s.selItem);
  const [tab, setTab] = useState<'bolt' | 'weld'>('bolt');
  const [size, setSize] = useState(sel?.size ?? 'M16'), [grade, setGrade] = useState(sel?.grade ?? '8.8');
  const [n1, setN1] = useState(Number(sel?.n1) || 2), [n2, setN2] = useState(Number(sel?.n2) || 2);
  const [p1, setP1] = useState(70), [p2, setP2] = useState(70), [e1, setE1] = useState(40), [e2, setE2] = useState(40);
  const [tp, setTp] = useState(10), [steel, setSteel] = useState('S275'), [planes, setPlanes] = useState(1), [thread, setThread] = useState(true);
  const [V, setV] = useState(100), [Nt, setNt] = useState(0), [M, setM] = useState(0);
  const [a, setA] = useState(5), [Lw, setLw] = useState(200), [nw, setNw] = useState(2), [Fw, setFw] = useState(200), [ang, setAng] = useState(90);
  const B = BOLTS[size], G = BOLT_GRADES[grade] ?? { fub: 800, fyb: 640 };
  const fu = FU[steel] ?? 430, gM2 = 1.25;
  const d = B?.d ?? 16, d0 = B?.d0 ?? d + 2, As = B?.As ?? (Math.PI / 4) * (d * 0.85) ** 2;
  const n = Math.max(1, n1 * n2);
  // cortante por tornillo (cat. A)
  const av = grade === '10.9' || grade === '4.8' || grade === '5.8' || grade === '6.8' ? 0.5 : 0.6;
  const FvRd = (planes * av * G.fub * (thread ? As : (Math.PI * d * d) / 4)) / gM2;
  // aplastamiento (tabla 3.4)
  const k1e = Math.min(2.8 * e2 / d0 - 1.7, 1.4 * p2 / d0 - 1.7, 2.5), ab = Math.min(e1 / (3 * d0), p1 / (3 * d0) - 0.25, G.fub / fu, 1);
  const FbRd = (k1e * ab * fu * d * tp) / gM2;
  const FtRd = (0.9 * G.fub * As) / gM2;
  const dm = ((B?.s ?? 1.5 * d) + (B?.s ?? 1.5 * d) * 1.1547) / 2, BpRd = (0.6 * Math.PI * dm * tp * fu) / gM2;
  // grupo: cortante centrado + momento en el plano (método elástico) + tracción repartida
  const pts: [number, number][] = [];
  for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) pts.push([(i - (n1 - 1) / 2) * p1, (j - (n2 - 1) / 2) * p2]);
  const r2 = pts.reduce((acc, [x, y]) => acc + x * x + y * y, 0) || 1;
  const fb = Math.max(...pts.map(([x, y]) => Math.hypot(V * 1000 / n + (M * 1e6 * Math.abs(x)) / r2, (M * 1e6 * Math.abs(y)) / r2)));
  const ft = (Nt * 1000) / n;
  const uV = fb / Math.min(FvRd, FbRd), uT = ft / Math.min(FtRd, BpRd), uVT = fb / FvRd + ft / (1.4 * FtRd);
  // soldadura en ángulo: método simplificado §4.5.3.3
  const fvwd = fu / Math.sqrt(3) / ((BW[steel] ?? 0.85) * gM2);
  const FwRd = fvwd * a; // N/mm
  const fwEd = (Fw * 1000) / (nw * Math.max(Lw - 2 * a, 1));
  // método direccional (§4.5.3.2) para carga a un ángulo θ respecto al eje del cordón
  const th = (ang * Math.PI) / 180, sigma = (Fw * 1000 * Math.sin(th)) / (nw * Lw * a) / Math.SQRT2, tauPerp = sigma, tauPar = (Fw * 1000 * Math.cos(th)) / (nw * Lw * a);
  const svm = Math.sqrt(sigma ** 2 + 3 * (tauPerp ** 2 + tauPar ** 2)), lim = fu / ((BW[steel] ?? 0.85) * gM2);
  return (
    <Modal title="Uniones · EN 1993-1-8" onClose={onClose} xwide>
      <Row label="Ver"><Seg value={tab} onChange={setTab} options={[['bolt', 'Unión atornillada'], ['weld', 'Soldadura en ángulo']]} /></Row>
      <Row label="Acero de las chapas"><Seg value={steel} onChange={setSteel} options={[['S235', 'S235'], ['S275', 'S275'], ['S355', 'S355']]} /></Row>
      {tab === 'bolt' && (<div className="net-grid">
        <div>
          {sel && <p className="phelp">Datos tomados del grupo de tornillos seleccionado ({sel.name}).</p>}
          <Row label="Tornillo / clase"><span style={{ display: 'flex', gap: 6 }}><select value={size} onChange={(e) => setSize(e.target.value)}>{Object.keys(BOLTS).map((k) => <option key={k}>{k}</option>)}</select><select value={grade} onChange={(e) => setGrade(e.target.value)}>{Object.keys(BOLT_GRADES).map((k) => <option key={k}>{k}</option>)}</select></span></Row>
          <Row label="Filas × columnas"><span style={{ display: 'flex', gap: 6 }}><Num v={n1} on={(x) => setN1(Math.max(1, x))} /><Num v={n2} on={(x) => setN2(Math.max(1, x))} /></span></Row>
          <Row label="p1 · p2 (mm)"><span style={{ display: 'flex', gap: 6 }}><Num v={p1} on={setP1} /><Num v={p2} on={setP2} /></span></Row>
          <Row label="e1 · e2 (mm)"><span style={{ display: 'flex', gap: 6 }}><Num v={e1} on={setE1} /><Num v={e2} on={setE2} /></span></Row>
          <Row label="Chapa más delgada t (mm)"><Num v={tp} on={setTp} /></Row>
          <Row label="Planos de corte"><Seg value={String(planes)} onChange={(v) => setPlanes(Number(v))} options={[['1', '1'], ['2', '2']]} /></Row>
          <label className="check"><input type="checkbox" checked={thread} onChange={(e) => setThread(e.target.checked)} />Rosca en el plano de corte (As)</label>
          <Row label="V (kN) · N (kN) · M (kN·m)"><span style={{ display: 'flex', gap: 6 }}><Num v={V} on={setV} /><Num v={Nt} on={setNt} /><Num v={M} step={0.5} on={setM} /></span></Row>
        </div>
        <div>
          <table className="ptable"><tbody>
            <tr><td>d0 · As</td><td className="num">{d0} mm · {f(As, 0)} mm²</td></tr>
            <tr><td>Fv,Rd por tornillo (tabla 3.4)</td><td className="num">{f(FvRd / 1e3, 1)} kN</td></tr>
            <tr><td>Fb,Rd aplastamiento (k1 {f(k1e, 2)} · αb {f(ab, 2)})</td><td className="num">{f(FbRd / 1e3, 1)} kN</td></tr>
            <tr><td>Ft,Rd tracción</td><td className="num">{f(FtRd / 1e3, 1)} kN</td></tr>
            <tr><td>Bp,Rd punzonamiento</td><td className="num">{f(BpRd / 1e3, 1)} kN</td></tr>
            <tr><td>Esfuerzo cortante del tornillo más cargado</td><td className="num">{f(fb / 1e3, 1)} kN</td></tr>
            <tr><td><b>Cortante / aplastamiento</b></td><td className="num">{f(uV * 100, 0)} % <OK ok={uV <= 1} /></td></tr>
            <tr><td><b>Tracción / punzonamiento</b></td><td className="num">{f(uT * 100, 0)} % <OK ok={uT <= 1} /></td></tr>
            <tr><td><b>Interacción Fv/Fv,Rd + Ft/(1,4·Ft,Rd)</b></td><td className="num">{f(uVT * 100, 0)} % <OK ok={uVT <= 1} /></td></tr>
            <tr><td>Distancias mínimas (e1, e2 ≥ 1,2·d0; p1 ≥ 2,2·d0; p2 ≥ 2,4·d0)</td><td className="num"><OK ok={e1 >= 1.2 * d0 && e2 >= 1.2 * d0 && (n1 < 2 || p1 >= 2.2 * d0) && (n2 < 2 || p2 >= 2.4 * d0)} /></td></tr>
          </tbody></table>
          <p className="phelp">Categoría A (aplastamiento), γM2 = 1,25. El momento en el plano se reparte por el método elástico (r²). Para tornillos pretensados (categorías B/C) comprueba además el deslizamiento §3.9.</p>
        </div>
      </div>)}
      {tab === 'weld' && (<div className="net-grid">
        <div>
          <Row label="Garganta a (mm)"><Num v={a} step={0.5} on={setA} /></Row>
          <Row label="Longitud de cada cordón (mm)"><Num v={Lw} step={10} on={setLw} /></Row>
          <Row label="Nº de cordones"><Num v={nw} on={(x) => setNw(Math.max(1, x))} /></Row>
          <Row label="Fuerza total (kN) · ángulo con el cordón (°)"><span style={{ display: 'flex', gap: 6 }}><Num v={Fw} on={setFw} /><Num v={ang} step={15} on={setAng} /></span></Row>
        </div>
        <div>
          <table className="ptable"><tbody>
            <tr><td>fvw,d = fu/(√3·βw·γM2)</td><td className="num">{f(fvwd, 1)} MPa</td></tr>
            <tr><td>Fw,Rd = fvw,d·a</td><td className="num">{f(FwRd, 0)} N/mm</td></tr>
            <tr><td>Fw,Ed por mm (longitud eficaz L − 2a)</td><td className="num">{f(fwEd, 0)} N/mm</td></tr>
            <tr><td><b>Método simplificado §4.5.3.3</b></td><td className="num">{f((fwEd / FwRd) * 100, 0)} % <OK ok={fwEd <= FwRd} /></td></tr>
            <tr><td>σ⊥ = τ⊥ · τ∥</td><td className="num">{f(sigma, 1)} · {f(tauPar, 1)} MPa</td></tr>
            <tr><td><b>Método direccional §4.5.3.2</b> √(σ⊥² + 3(τ⊥² + τ∥²)) ≤ fu/(βw·γM2)</td><td className="num">{f(svm, 0)} / {f(lim, 0)} MPa <OK ok={svm <= lim && sigma <= 0.9 * fu / gM2} /></td></tr>
            <tr><td>Garganta mínima 3 mm · L ≥ max(30 mm, 6a)</td><td className="num"><OK ok={a >= 3 && Lw >= Math.max(30, 6 * a)} /></td></tr>
          </tbody></table>
          <p className="phelp">βw = {BW[steel]} ({steel}), γM2 = 1,25. En el método direccional se supone la carga transversal repartida a 45° en la garganta.</p>
        </div>
      </div>)}
      <div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}
