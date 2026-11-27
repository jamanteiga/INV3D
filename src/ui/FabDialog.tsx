// Fabricación: anidado de desarrollos en chapas, spools de tubería e isométricos, planos automáticos
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { saveText } from '../core/files';
import { Modal } from './Panels';
import { collectFlats, nest, placedPolys, nestDxf, buildSpools, spoolSvg, spoolsCsv, assemblyDrawing, partDrawings, type NestPiece } from './fab';

const SHEETS: [number, number][] = [[1000, 2000], [1250, 2500], [1500, 3000]];
const f = (x: number, d = 1) => x.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function FabDialog({ onClose, tab: tab0 }: { onClose: () => void; tab?: 'nest' | 'spools' | 'draw' }) {
  const s = useStore();
  const [tab, setTab] = useState(tab0 ?? 'nest');
  const base = s.fileName.replace(/\.[^.]+$/, '');
  return (
    <Modal title="Fabricación" onClose={onClose} xwide>
      <div className="ai-row" style={{ gap: 6 }}>
        {([['nest', 'Anidado de chapa'], ['spools', 'Spools de tubería'], ['draw', 'Planos automáticos']] as const).map(([k, n]) => <button key={k} className={`btn sm ${tab === k ? 'primary' : ''}`} onClick={() => setTab(k)}>{n}</button>)}
      </div>
      {tab === 'nest' ? <NestTab base={base} /> : tab === 'spools' ? <SpoolTab base={base} /> : <DrawTab onClose={onClose} />}
      <div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}

function NestTab({ base }: { base: string }) {
  const s = useStore();
  const [pieces, setPieces] = useState<NestPiece[] | null>(null), [skipped, setSkipped] = useState<string[]>([]);
  const [si, setSi] = useState(1), [gap, setGap] = useState(10), [page, setPage] = useState(0);
  useEffect(() => { setPieces(null); void collectFlats().then((r) => { setPieces(r.pieces); setSkipped(r.skipped); }); }, [s.asm]);
  const res = useMemo(() => (pieces ? nest(pieces, SHEETS[si][1], SHEETS[si][0], gap) : null), [pieces, si, gap]);
  if (!pieces) return <p className="phelp">Calculando desarrollos…</p>;
  const sh = res?.sheets[Math.min(page, (res?.sheets.length ?? 1) - 1)];
  const tot = res ? res.sheets.reduce((a, x) => a + x.usage, 0) / Math.max(1, res.sheets.length) : 0;
  return (<>
    <p className="phelp">Desarrollos de todas las piezas de chapa del ensamblaje (codos: tapas, chapas y gajos; virolas; piezas de chapa) colocados por estanterías con giro de 90°, separados por espesor y material.</p>
    <div className="ai-row" style={{ gap: 12, flexWrap: 'wrap' }}>
      <label>Chapa <select value={si} onChange={(e) => { setSi(Number(e.target.value)); setPage(0); }}>{SHEETS.map(([a, b], i) => <option key={i} value={i}>{a} × {b}</option>)}</select></label>
      <label>Separación (mm) <input type="number" value={gap} min={0} onChange={(e) => setGap(Math.max(0, Number(e.target.value) || 0))} style={{ width: 60 }} /></label>
      <span>{pieces.length} pieza(s) · {res?.sheets.length ?? 0} chapa(s) · aprovechamiento medio {f(tot * 100)} %</span>
    </div>
    {sh ? (<>
      <div className="ai-row" style={{ gap: 6 }}>
        {res!.sheets.map((x, i) => <button key={i} className={`btn sm ${sh === x ? 'primary' : ''}`} onClick={() => setPage(i)}>{i + 1} · e{x.t} · {f(x.usage * 100, 0)} %</button>)}
      </div>
      <div className="flat-view" style={{ maxHeight: 360 }}>
        <svg viewBox={`-10 -10 ${sh.W + 20} ${sh.H + 20}`} style={{ width: '100%' }}>
          <rect x={0} y={0} width={sh.W} height={sh.H} fill="#f4f6f8" stroke="#888" strokeWidth={2} />
          {sh.items.map((it, i) => <g key={i}>
            {placedPolys(it).map((pl, k) => <polyline key={k} points={pl.map(([x, y]) => `${x.toFixed(1)},${(sh.H - y).toFixed(1)}`).join(' ')} fill={k === 0 ? '#cfe0f5' : '#f4f6f8'} stroke="#1e3f6e" strokeWidth={1.5} />)}
            <text x={it.x + (it.rot ? it.p.h : it.p.w) / 2} y={sh.H - it.y - (it.rot ? it.p.w : it.p.h) / 2} fontSize={Math.max(14, Math.min(40, (it.rot ? it.p.w : it.p.h) / 6))} textAnchor="middle" fill="#333">{i + 1}</text>
          </g>)}
        </svg>
      </div>
      <p className="phelp">Chapa {res!.sheets.indexOf(sh) + 1}: {sh.W} × {sh.H} · e {sh.t} mm · {sh.material || 'material sin definir'} · {sh.items.length} pieza(s): {sh.items.map((it, i) => `${i + 1} ${it.p.name}`).join(' · ')}</p>
    </>) : <p className="phelp">No hay piezas de chapa desarrollables en el ensamblaje.</p>}
    {!!res?.tooBig.length && <p className="phelp" style={{ color: '#b00' }}>⚠ No caben en la chapa: {res.tooBig.join(', ')}</p>}
    {!!skipped.length && <p className="phelp" style={{ color: '#a66a00' }}>⚠ Sin desarrollo: {skipped.join(', ')}</p>}
    <div className="ai-row"><button className="btn" disabled={!res?.sheets.length} onClick={() => saveText(nestDxf(res!.sheets), `${base}-anidado.dxf`, 'DXF', '.dxf', 'application/dxf')}>Exportar DXF (todas las chapas)</button></div>
  </>);
}

function SpoolTab({ base }: { base: string }) {
  const s = useStore();
  const sps = useMemo(() => buildSpools(), [s.asm, s.asmResult]);
  const [i, setI] = useState(0); const sp = sps[Math.min(i, sps.length - 1)];
  if (!sps.length) return <p className="phelp">No hay tubería en el ensamblaje (Mecánica › Tubería).</p>;
  const svg = sp ? spoolSvg(sp) : '';
  const allSvg = () => sps.forEach((x) => saveText(spoolSvg(x), `${base}-${x.id}.svg`, 'SVG', '.svg', 'image/svg+xml'));
  return (<>
    <p className="phelp">La tubería se divide en spools en cada unión embridada (cara de brida); las uniones a tope o con encaje dentro de un spool se numeran como soldaduras W-001… Isométrico con Z arriba, cotas de corte de los tubos.</p>
    <div className="ai-row" style={{ gap: 6, flexWrap: 'wrap' }}>{sps.map((x, k) => <button key={x.id} className={`btn sm ${x === sp ? 'primary' : ''}`} onClick={() => setI(k)}>{x.id} · {x.occs.length} pz · {x.welds.length} sold.</button>)}</div>
    <div className="ai-row" style={{ alignItems: 'flex-start', gap: 12 }}>
      <div style={{ border: '1px solid var(--line, #ccc)', background: '#fff', flex: '0 0 auto' }} dangerouslySetInnerHTML={{ __html: svg }} />
      <div style={{ flex: 1, minWidth: 200, maxHeight: 380, overflow: 'auto' }}>
        <table className="bom-table"><thead><tr><th>Elemento</th><th>Corte</th><th>Ud</th></tr></thead>
          <tbody>{sp.cut.map((c, k) => <tr key={k}><td>{c.name}</td><td>{c.len != null ? Math.round(c.len) : ''}</td><td>{c.qty}</td></tr>)}</tbody></table>
        <table className="bom-table" style={{ marginTop: 8 }}><thead><tr><th>Sold.</th><th>Tipo</th><th>Entre</th></tr></thead>
          <tbody>{sp.welds.map((w) => <tr key={w.id}><td style={{ whiteSpace: 'nowrap' }}>{w.id}</td><td style={{ whiteSpace: 'nowrap' }}>{w.type} {w.size}</td><td>{w.a} – {w.b}</td></tr>)}</tbody></table>
      </div>
    </div>
    <div className="ai-row" style={{ gap: 6 }}>
      <button className="btn" onClick={() => saveText(spoolsCsv(sps), `${base}-spools.csv`, 'CSV', '.csv', 'text/csv')}>Exportar lista (CSV)</button>
      <button className="btn" onClick={() => saveText(svg, `${base}-${sp.id}.svg`, 'SVG', '.svg', 'image/svg+xml')}>Isométrico {sp.id} (SVG)</button>
      <button className="btn" onClick={allSvg}>Todos los isométricos</button>
    </div>
  </>);
}

function DrawTab({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const n = new Set(s.asm.occurrences.filter((o) => !o.suppressed && !o.tag).map((o) => o.part)).size;
  const [busy, setBusy] = useState(false);
  const go = (fn: () => Promise<void>) => { setBusy(true); onClose(); void fn().finally(() => setBusy(false)); };
  return (<>
    <p className="phelp">Crea dibujos nuevos a partir del ensamblaje activo. Después se editan como cualquier dibujo (cotas, notas, cajetín).</p>
    <div className="ai-row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <button className="btn" disabled={busy} onClick={() => go(assemblyDrawing)}>Plano de montaje (alzado, planta, isométrica, globos y lista de piezas)</button>
      <button className="btn" disabled={busy || !n} onClick={() => go(() => partDrawings())}>Planos de taller ({n} pieza{n === 1 ? '' : 's'} distintas: vistas + desarrollo si es chapa)</button>
    </div>
  </>);
}
