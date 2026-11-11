// Generadores de diseño: eje, engranajes, rodamiento, muelle y chaveta con cálculo.
import { useState } from 'react';
import { useStore } from '../core/store';
import type { PartDoc } from '../core/doc';
import { makeShaft, shaftCheck, makeGear, gearGeom, gearPair, lewisStress, makeBearing, BEARINGS, bearingLife, bearingP, makeSpring, springCalc, makeKey, keyFor, keyPressure, KEY_L, type ShaftSec } from '../core/machine';
import { frameXf } from '../core/ductnet';
import { fmt } from '../core/expr';
import { asmActions } from './actions';
import { Modal, Row, Seg } from './Panels';

const f = (x: number, d = 1) => (isFinite(x) ? fmt(x, d) : '—');
const Num = ({ v, on, step = 1 }: { v: number; on: (x: number) => void; step?: number }) => <input type="number" step={step} value={v} onChange={(e) => on(Number(e.target.value))} onKeyDown={(e) => e.stopPropagation()} />;
const OK = ({ ok, t }: { ok: boolean; t?: string }) => <b style={{ color: ok ? 'var(--ok, #2b8a3e)' : 'var(--danger, #c0392b)' }}>{ok ? '✓' : '✗'}{t ? ` ${t}` : ''}</b>;

export function GenDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [tab, setTab] = useState<'shaft' | 'gear' | 'bearing' | 'spring' | 'key'>('shaft');
  // eje
  const [secs, setSecs] = useState<ShaftSec[]>([{ d: 30, L: 40 }, { d: 40, L: 80, key: { l: 50 } }, { d: 35, L: 30 }, { d: 30, L: 50, key: { l: 36 } }]);
  const [T, setT] = useState(150), [M, setM] = useState(80), [fy, setFy] = useState(430);
  // engranajes
  const [m, setMod] = useState(2), [z1, setZ1] = useState(20), [z2, setZ2] = useState(40), [b, setB] = useState(20), [bore1, setBore1] = useState(20), [bore2, setBore2] = useState(30), [Tg, setTg] = useState(50), [sAll, setSAll] = useState(250);
  // rodamiento
  const [des, setDes] = useState('6205'), [Fr, setFr] = useState(3), [Fa, setFa] = useState(0.5), [rpm, setRpm] = useState(1450);
  // muelle
  const [sd, setSd] = useState(3), [Dm, setDm] = useState(24), [na, setNa] = useState(8), [L0, setL0] = useState(60), [F, setF] = useState(150), [ends, setEnds] = useState<'closed' | 'ground'>('ground');
  // chaveta
  const [kd, setKd] = useState(40), [kl, setKl] = useState(50), [kT, setKT] = useState(200), [pAll, setPAll] = useState(100);

  const put = (docs: { doc: PartDoc; xf?: [number, number, number] }[]) => {
    try {
      onClose();
      if (s.kind === 'assembly') {
        if (docs.length === 1) { const d = docs[0].doc; asmActions.startPlace(s.docs.find((x) => x.fileName === `${d.iProperties.partNumber}.i3p`)?.id ?? s.addDocument('part', d, `${d.iProperties.partNumber}.i3p`, false)); return; }
        asmActions.placeGenerated(`gen-${Date.now().toString(36)}`, docs.map(({ doc, xf }) => ({ fileName: `${doc.iProperties.partNumber}.i3p`, make: () => doc, xf: frameXf(xf ?? [0, 0, 0], [1, 0, 0], [0, 0, 1]) })));
        s.notify(`${docs.length} piezas colocadas`);
      } else docs.forEach(({ doc }) => s.addDocument('part', doc, `${doc.iProperties.partNumber}.i3p`));
    } catch (e) { s.notify((e as Error).message, 'error'); }
  };

  const dMin = Math.min(...secs.map((x) => x.d)), sc = shaftCheck(dMin, T, M, fy);
  const g1 = gearGeom({ m, z: z1, b, bore: bore1 }), g2 = gearGeom({ m, z: z2, b, bore: bore2 }), pr = gearPair(m, z1, z2);
  const lw1 = lewisStress(Tg, m, z1, b);
  const BR = BEARINGS[des], P = bearingP(Fr, Fa), L10h = bearingLife(BR[3], P, rpm);
  const sp = springCalc({ d: sd, Dm, na, L0, ends }, F);
  const key = keyFor(kd), kp = keyPressure(kT, kd, key, kl);
  const label = (t: string) => (s.kind === 'assembly' ? `Colocar ${t}` : `Crear ${t}`);
  return (
    <Modal title="Generadores de diseño" onClose={onClose} xwide>
      <Row label="Elemento"><Seg value={tab} onChange={setTab} options={[['shaft', 'Eje'], ['gear', 'Engranajes rectos'], ['bearing', 'Rodamiento'], ['spring', 'Muelle de compresión'], ['key', 'Chaveta']]} /></Row>
      {tab === 'shaft' && (<div className="net-grid">
        <div>
          <table className="ptable"><thead><tr><th>Tramo</th><th className="num">Ø (mm)</th><th className="num">L (mm)</th><th>Chavetero</th><th /></tr></thead>
            <tbody>{secs.map((x, i) => <tr key={i}><td>{i + 1}</td><td className="num"><Num v={x.d} on={(v) => setSecs(secs.map((y, k) => (k === i ? { ...y, d: v } : y)))} /></td><td className="num"><Num v={x.L} on={(v) => setSecs(secs.map((y, k) => (k === i ? { ...y, L: v } : y)))} /></td>
              <td><label className="check"><input type="checkbox" checked={!!x.key} onChange={(e) => setSecs(secs.map((y, k) => (k === i ? { ...y, key: e.target.checked ? { l: Math.max(10, Math.round(y.L * 0.7)) } : undefined } : y)))} />{x.key ? `${keyFor(x.d)[2]}×${keyFor(x.d)[3]} L${x.key.l}` : ''}</label></td>
              <td><button className="btn icon" onClick={() => setSecs(secs.filter((_, k) => k !== i))}>×</button></td></tr>)}</tbody></table>
          <div className="modal-btns" style={{ justifyContent: 'flex-start' }}><button className="btn" onClick={() => setSecs([...secs, { d: secs[secs.length - 1]?.d ?? 30, L: 40 }])}>Añadir tramo</button></div>
        </div>
        <div>
          <Row label="Par T (N·m)"><Num v={T} on={setT} /></Row>
          <Row label="Momento flector M (N·m)"><Num v={M} on={setM} /></Row>
          <Row label="Límite elástico (MPa)"><Num v={fy} step={10} on={setFy} /></Row>
          <table className="ptable"><tbody>
            <tr><td>Sección mínima</td><td className="num">Ø{dMin}</td></tr>
            <tr><td>τ = 16T/(πd³) · σ = 32M/(πd³)</td><td className="num">{f(sc.tau, 1)} · {f(sc.sig, 1)} MPa</td></tr>
            <tr><td>Von Mises</td><td className="num">{f(sc.vm, 1)} MPa</td></tr>
            <tr><td><b>Coeficiente de seguridad</b> (≥ 2 recomendado)</td><td className="num"><OK ok={sc.sf >= 2} t={f(sc.sf, 2)} /></td></tr>
            <tr><td>Ø mínimo (Tresca, n = 2)</td><td className="num">{f(sc.dReq, 1)} mm</td></tr>
          </tbody></table>
          <p className="phelp">Comprobación estática; para fatiga aplica los factores de concentración en cambios de sección y chaveteros.</p>
        </div>
      </div>)}
      {tab === 'gear' && (<div className="net-grid">
        <div>
          <Row label="Módulo m"><select value={m} onChange={(e) => setMod(Number(e.target.value))}>{[0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((x) => <option key={x} value={x}>{x}</option>)}</select></Row>
          <Row label="Dientes z1 · z2"><span style={{ display: 'flex', gap: 6 }}><Num v={z1} on={(x) => setZ1(Math.max(8, Math.round(x)))} /><Num v={z2} on={(x) => setZ2(Math.max(8, Math.round(x)))} /></span></Row>
          <Row label="Ancho b (mm)"><Num v={b} on={setB} /></Row>
          <Row label="Agujeros (mm)"><span style={{ display: 'flex', gap: 6 }}><Num v={bore1} on={setBore1} /><Num v={bore2} on={setBore2} /></span></Row>
          <Row label="Par en el piñón (N·m)"><Num v={Tg} on={setTg} /></Row>
          <Row label="σ admisible flexión (MPa)"><Num v={sAll} step={10} on={setSAll} /></Row>
        </div>
        <div>
          <table className="ptable"><thead><tr><th /><th className="num">Piñón</th><th className="num">Rueda</th></tr></thead><tbody>
            <tr><td>d primitivo</td><td className="num">{f(g1.d, 2)}</td><td className="num">{f(g2.d, 2)}</td></tr>
            <tr><td>da exterior</td><td className="num">{f(g1.da, 2)}</td><td className="num">{f(g2.da, 2)}</td></tr>
            <tr><td>df de fondo</td><td className="num">{f(g1.df, 2)}</td><td className="num">{f(g2.df, 2)}</td></tr>
            <tr><td>db base</td><td className="num">{f(g1.db, 2)}</td><td className="num">{f(g2.db, 2)}</td></tr>
          </tbody></table>
          <Row label="Distancia entre centros"><span className="ro">{f(pr.a, 2)} mm</span></Row>
          <Row label="Relación i"><span className="ro">{f(pr.i, 3)}</span></Row>
          <Row label="Grado de recubrimiento εα"><span className="ro">{f(pr.eps, 2)} <OK ok={pr.eps >= 1.2} /></span></Row>
          <Row label="Fuerza tangencial"><span className="ro">{f(lw1.Ft, 0)} N</span></Row>
          <Row label="Tensión de Lewis (piñón)"><span className="ro">{f(lw1.sigma, 1)} MPa <OK ok={lw1.sigma <= sAll} /></span></Row>
          {z1 < 17 && <p className="phelp">Con z &lt; 17 hay socavado del pie sin corrección de perfil.</p>}
        </div>
      </div>)}
      {tab === 'bearing' && (<div className="net-grid">
        <div>
          <Row label="Rodamiento"><select value={des} onChange={(e) => setDes(e.target.value)}>{Object.entries(BEARINGS).map(([k, v]) => <option key={k} value={k}>{k} · d{v[0]} D{v[1]} B{v[2]}</option>)}</select></Row>
          <Row label="Fr · Fa (kN)"><span style={{ display: 'flex', gap: 6 }}><Num v={Fr} step={0.1} on={setFr} /><Num v={Fa} step={0.1} on={setFa} /></span></Row>
          <Row label="Velocidad (rpm)"><Num v={rpm} step={50} on={setRpm} /></Row>
        </div>
        <div>
          <table className="ptable"><tbody>
            <tr><td>C · C0</td><td className="num">{BR[3]} · {BR[4]} kN</td></tr>
            <tr><td>P equivalente</td><td className="num">{f(P, 2)} kN</td></tr>
            <tr><td><b>Vida L10h</b></td><td className="num">{f(L10h, 0)} h <OK ok={L10h >= 20000} /></td></tr>
          </tbody></table>
          <p className="phelp">L10h = (C/P)³·10⁶/(60·n) (ISO 281). Para 20 000 h (máquinas de uso continuo); X = 0,56 e Y ≈ 1,5 si Fa/Fr &gt; 0,3. Valores de catálogo orientativos.</p>
        </div>
      </div>)}
      {tab === 'spring' && (<div className="net-grid">
        <div>
          <Row label="Hilo d · Dm (mm)"><span style={{ display: 'flex', gap: 6 }}><Num v={sd} step={0.1} on={setSd} /><Num v={Dm} on={setDm} /></span></Row>
          <Row label="Espiras útiles · L0"><span style={{ display: 'flex', gap: 6 }}><Num v={na} step={0.5} on={setNa} /><Num v={L0} on={setL0} /></span></Row>
          <Row label="Extremos"><Seg value={ends} onChange={setEnds} options={[['ground', 'Cerrados y esmerilados'], ['closed', 'Cerrados']]} /></Row>
          <Row label="Fuerza de trabajo (N)"><Num v={F} on={setF} /></Row>
        </div>
        <div>
          <table className="ptable"><tbody>
            <tr><td>Índice C · Wahl Kw</td><td className="num">{f(sp.C, 2)} · {f(sp.Kw, 3)}</td></tr>
            <tr><td>Rigidez k = G·d⁴/(8·Dm³·n)</td><td className="num">{f(sp.k, 2)} N/mm</td></tr>
            <tr><td>Flecha con F</td><td className="num">{f(sp.defl, 1)} mm</td></tr>
            <tr><td>Long. a bloque Ls · carrera máx.</td><td className="num">{f(sp.Ls, 1)} · {f(sp.sMax, 1)} mm</td></tr>
            <tr><td><b>τ con F</b> (≤ 0,45·Rm = {f(sp.tauAll, 0)})</td><td className="num">{f(sp.tau, 0)} MPa <OK ok={sp.tau <= sp.tauAll && sp.defl < sp.sMax} /></td></tr>
            <tr><td>τ a bloque</td><td className="num">{f(sp.tauS, 0)} MPa <OK ok={sp.tauS <= 0.56 * sp.Rm} /></td></tr>
            <tr><td>Pandeo (L0/Dm &gt; 5,24 con apoyos paralelos)</td><td className="num">{sp.buckling ? <OK ok={false} t="riesgo" /> : <OK ok />}</td></tr>
          </tbody></table>
          <p className="phelp">EN 13906-1, acero EN 10270-1 SH (Rm ≈ {f(sp.Rm, 0)} MPa), G = 81,5 GPa.</p>
        </div>
      </div>)}
      {tab === 'key' && (<div className="net-grid">
        <div>
          <Row label="Ø del eje (mm)"><Num v={kd} on={setKd} /></Row>
          <Row label="Longitud (mm)"><select value={kl} onChange={(e) => setKl(Number(e.target.value))}>{KEY_L.map((x) => <option key={x} value={x}>{x}</option>)}</select></Row>
          <Row label="Par (N·m)"><Num v={kT} on={setKT} /></Row>
          <Row label="p admisible (MPa)"><Num v={pAll} step={10} on={setPAll} /></Row>
        </div>
        <div>
          <table className="ptable"><tbody>
            <tr><td>Chaveta DIN 6885-1 A</td><td className="num">{key[2]} × {key[3]} × {kl}</td></tr>
            <tr><td>t1 eje · t2 cubo</td><td className="num">{key[4]} · {key[5]} mm</td></tr>
            <tr><td><b>Presión p = 2T/(d·(h − t1)·(l − b))</b></td><td className="num">{f(kp, 1)} MPa <OK ok={kp <= pAll} /></td></tr>
          </tbody></table>
          <p className="phelp">Presión admisible orientativa: cubo de acero 100–120 MPa, de fundición 50–60 MPa.</p>
        </div>
      </div>)}
      <div className="modal-btns">
        <span className="grow" />
        <button className="btn" onClick={onClose}>Cerrar</button>
        {tab === 'shaft' && <button className="btn primary" onClick={() => put([{ doc: makeShaft(secs) }])}>{label('eje')}</button>}
        {tab === 'gear' && <>
          <button className="btn" onClick={() => put([{ doc: makeGear({ m, z: z1, b, bore: bore1, key: true }) }])}>{label('piñón')}</button>
          <button className="btn primary" onClick={() => put([{ doc: makeGear({ m, z: z1, b, bore: bore1, key: true }) }, { doc: makeGear({ m, z: z2, b, bore: bore2, key: true }), xf: [pr.a, 0, 0] }])}>{s.kind === 'assembly' ? 'Colocar la pareja engranada' : 'Crear piñón y rueda'}</button>
        </>}
        {tab === 'bearing' && <button className="btn primary" onClick={() => put([{ doc: makeBearing(des) }])}>{label(`rodamiento ${des}`)}</button>}
        {tab === 'spring' && <button className="btn primary" onClick={() => put([{ doc: makeSpring({ d: sd, Dm, na, L0, ends }) }])}>{label('muelle')}</button>}
        {tab === 'key' && <button className="btn primary" onClick={() => put([{ doc: makeKey(kd, kl) }])}>{label('chaveta')}</button>}
      </div>
    </Modal>
  );
}
