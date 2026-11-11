// Red de conductos: trazado (líneas 3D), caudales, dimensionado, cálculo, ruido, térmico, mediciones y generación.
import { useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { uid, type V3 } from '../core/doc';
import { calcNet, generateNet, measureNet, toBC3, cp1252, newDuctNet, buildGraph, leaves, nodeKey, termName, type DuctNet } from '../core/ductnet';
import { HVAC_MATERIALS } from '../core/hvacdata';
import { downloadXlsx } from '../core/xlsx';
import { saveText } from '../core/files';
import { newDrawing, SCALES, type DrawingDoc } from '../core/drawing';
import { fmt } from '../core/expr';
import { asmActions } from './actions';
import { Modal, Row, Seg } from './Panels';

const f1 = (x: number, d = 1) => fmt(x, d);

export function DuctNetDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [net, setNet] = useState<DuctNet>(() => structuredClone(s.asm.ductNets?.[0] ?? newDuctNet(uid('dn'))));
  const [tab, setTab] = useState<'route' | 'calc' | 'acoustic' | 'measure'>('route');
  const up = (p: Partial<DuctNet>) => setNet({ ...net, ...p });
  const upIns = (p: Partial<DuctNet['ins']>) => setNet({ ...net, ins: { ...net.ins, ...p } });
  const g = useMemo(() => buildGraph(s.asm, net), [s.asm, net]);
  const lv = leaves(g);
  const c = useMemo(() => calcNet(s.asm, net), [s.asm, net]);
  const gen = useMemo(() => { try { return generateNet(net, c); } catch (e) { return { items: [], warnings: [(e as Error).message] }; } }, [net, c]);
  const meas = useMemo(() => measureNet(net, c, gen.items), [net, c, gen]);
  const srcKey = c.source >= 0 ? g.nodes[c.source]?.key : '';
  const save = (n = net) => s.commitAsm((a) => { a.ductNets = [n, ...(a.ductNets ?? []).slice(1)]; });
  const mats = HVAC_MATERIALS.filter((m) => !/Aislamiento|Lana|Elastom/i.test(m.name)).map((m) => m.name);

  const generate = () => {
    if (c.errors.length) { s.notify(c.errors[0], 'error'); return; }
    const old = new Set(net.generated ?? []);
    const byFile = new Map<string, string>();
    for (const it of gen.items) {
      if (byFile.has(it.fileName)) continue;
      const ex = s.docs.find((d) => d.fileName === it.fileName)?.id;
      byFile.set(it.fileName, ex ?? s.addDocument('part', it.make(), it.fileName, false));
    }
    const ids: string[] = [];
    s.commitAsm((a) => {
      a.occurrences = a.occurrences.filter((o) => !old.has(o.id) && o.gen !== net.id);
      a.joints = a.joints.filter((j) => !old.has(j.a.occ) && !old.has(j.b.occ));
      const cnt = new Map<string, number>();
      for (const it of gen.items) {
        const id = uid('o'); ids.push(id);
        const base = it.fileName.replace(/\.i3p$/, ''); const k = (cnt.get(base) ?? 0) + 1; cnt.set(base, k);
        a.occurrences.push({ id, name: `${base}:${k}`, part: byFile.get(it.fileName)!, xf: it.xf, grounded: true, gen: net.id });
      }
      const n2 = { ...net, generated: ids };
      a.ductNets = [n2, ...(a.ductNets ?? []).slice(1)];
    });
    setNet({ ...net, generated: ids });
    s.notify(`Red generada: ${gen.items.length} piezas${gen.warnings.length ? ` · ${gen.warnings.length} avisos` : ''}`, gen.warnings.length ? 'error' : undefined);
  };
  const toExcel = () => {
    downloadXlsx([
      { name: 'Tramos', rows: [['Tramo', 'Sección', 'L (m)', 'Q (m³/h)', 'v (m/s)', 'R (Pa/m)', 'Δp fricción (Pa)', 'ζ', 'Δp singular (Pa)', 'Δp acumulada (Pa)', 'Lw (dB)', 'NR est.', 'T entrada (°C)', 'T salida (°C)', 'Flujo de calor (W)'],
        ...c.rows.map((r) => [r.name, r.size, +(r.L / 1000).toFixed(2), r.q, +r.v.toFixed(2), +r.R.toFixed(2), +r.dpF.toFixed(1), +r.zeta.toFixed(2), +r.dpS.toFixed(1), +r.dpTot.toFixed(1), +r.lw.toFixed(1), r.nr, +r.tIn.toFixed(2), +r.tOut.toFixed(2), +r.qLoss.toFixed(0)])] },
      { name: 'Terminales', rows: [['Terminal', 'Q (m³/h)', 'Δp hasta el terminal (Pa)', 'A compensar con compuerta (Pa)'], ...c.terms.map((t) => [t.name, t.q, +t.dp.toFixed(1), +t.excess.toFixed(1)]), [], ['Ventilador', +c.fan.q.toFixed(0), +c.fan.dp.toFixed(1), 'Δp disponible recomendada (+10 %)'], ['', '', +(c.fan.dp * 1.1).toFixed(0), '']] },
      { name: 'Mediciones', rows: [['Capítulo', 'Código', 'Descripción', 'Ud', 'Cantidad'], ...meas.map((m) => [m.group, m.code, m.desc, m.unit, m.qty])] },
      { name: 'Piezas', rows: [['Tramo', 'Código', 'Descripción'], ...gen.items.map((i) => [c.rows[i.seg]?.name ?? '', i.code, i.desc])] },
    ], `${s.asm.iProperties.partNumber}-${net.name}`);
  };
  const toBc3 = () => saveText(cp1252(toBC3(s.asm.iProperties.partNumber || 'RED', meas)) as BlobPart, `${s.asm.iProperties.partNumber}-${net.name}.bc3`, 'Presupuesto BC3', '.bc3', 'text/plain');
  const isoDrawing = () => {
    // plano isométrico de la red con lista de piezas y tabla de tramos
    const asmId = s.active;
    const pts = g.nodes.map((n) => n.p);
    const ext = pts.length ? Math.max(...[0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k])))) : 1000;
    const sc = SCALES.find((x) => ext * 1.3 * x <= 240) ?? SCALES[SCALES.length - 1];
    const dw: DrawingDoc = newDrawing();
    dw.sheet = 'A3'; dw.std = s.settings.drawingStd;
    dw.title = { ...dw.title, title: `${net.name} · isométrico`, partNumber: `${s.asm.iProperties.partNumber}-ISO`, designer: s.settings.userName, company: s.settings.company, scale: sc >= 1 ? `${sc}:1` : `1:${Math.round(1 / sc)}`, date: new Date().toLocaleDateString('es-ES') };
    const vid = uid('v');
    dw.views = [{ id: vid, name: 'Isométrica', source: asmId, dir: 'iso', scale: sc, x: 150, y: 165, hidden: false, kind: 'iso' }];
    dw.bom = { view: vid, x: 0, y: 0 };
    const lines = [`RED DE CONDUCTOS · Q = ${f1(c.fan.q, 0)} m³/h · Δp = ${f1(c.fan.dp * 1.1, 0)} Pa (con 10 %)`, ...c.rows.map((r) => `${r.name}  ${r.size}  L ${f1(r.L / 1000, 2)} m  Q ${r.q} m³/h  v ${f1(r.v, 1)} m/s  R ${f1(r.R, 2)} Pa/m`)];
    dw.notes = lines.map((t, i) => ({ id: uid('n'), x: 20, y: 60 - i * 4.5 + lines.length * 4.5, text: t, size: i ? 2.5 : 3 }));
    const id = s.addDocument('drawing', dw, `${s.asm.iProperties.partNumber}-ISO.i3d`);
    void id;
    s.notify('Plano isométrico creado (con lista de piezas y tabla de tramos)');
  };

  return (
    <Modal title={`Red de conductos — ${net.name}`} onClose={() => { save(); onClose(); }} xwide>
      <Row label="Ver"><Seg value={tab} onChange={setTab} options={[['route', 'Trazado y caudales'], ['calc', 'Cálculo y equilibrado'], ['acoustic', 'Ruido y térmico'], ['measure', 'Mediciones y piezas']]} /></Row>
      {c.errors.map((e) => <div key={e} className="fdlg-err">{e}</div>)}
      {tab === 'route' && (<div className="net-grid">
        <div>
          <div className="psec-title">Trazado</div>
          <p className="phelp">El trazado son las <b>líneas 3D del esqueleto</b> del ensamblaje (Ensamblar › Esqueleto › Línea 3D): ejes de los conductos, con extremos comunes en codos y derivaciones. Ahora: {g.edges.length} tramos, {g.nodes.length} nudos, {lv.length} extremos.</p>
          <div className="modal-btns" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
            <button className="btn" onClick={() => { save(); onClose(); asmActions.openSkel(); }}>Dibujar trazado (Línea 3D)</button>
          </div>
          <Row label="Nombre"><input value={net.name} onChange={(e) => up({ name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></Row>
          <Row label="Origen (ventilador)"><select value={srcKey} onChange={(e) => { const n = g.nodes.find((x) => x.key === e.target.value); if (n) up({ source: [...n.p] as V3 }); }}>
            {lv.map((n) => <option key={n.key} value={n.key}>({n.key.replace(/,/g, '; ')})</option>)}</select></Row>
          <Row label="Conducto"><Seg value={net.shape} onChange={(v) => up({ shape: v })} options={[['spiro', 'Espirotubo circular'], ['rect', 'Rectangular']]} /></Row>
          <Row label="Dimensionado"><Seg value={net.method} onChange={(v) => up({ method: v })} options={[['vel', 'Velocidad máx.'], ['fric', 'Pérdida unitaria']]} /></Row>
          <Row label="v máx. (m/s)"><input type="number" step={0.5} value={net.vmax} onChange={(e) => up({ vmax: Number(e.target.value) || 1 })} /></Row>
          {net.method === 'fric' && <Row label="R máx. (Pa/m)"><input type="number" step={0.1} value={net.rmax} onChange={(e) => up({ rmax: Number(e.target.value) || 0.1 })} /></Row>}
          {net.shape === 'rect' && <Row label="Altura máx. (mm)"><input type="number" step={50} value={net.hmax} onChange={(e) => up({ hmax: Number(e.target.value) || 100 })} /></Row>}
          <Row label="Material"><select value={net.material} onChange={(e) => up({ material: e.target.value })}>{mats.map((m) => <option key={m}>{m}</option>)}</select></Row>
          {net.shape === 'spiro' && <label className="check"><input type="checkbox" checked={net.gasket} onChange={(e) => up({ gasket: e.target.checked })} />Accesorios con junta EPDM</label>}
        </div>
        <div>
          <div className="psec-title">Terminales (extremos)</div>
          <table className="ptable"><thead><tr><th>Terminal</th><th>Posición</th><th className="num">Caudal (m³/h)</th></tr></thead>
            <tbody>{lv.filter((n) => n.key !== srcKey).map((n) => {
              const t = net.terminals[n.key] ?? { q: 500 };
              return (<tr key={n.key}>
                <td><input value={t.name ?? termName(g, c.source, n.id)} onChange={(e) => up({ terminals: { ...net.terminals, [n.key]: { ...t, name: e.target.value } } })} onKeyDown={(e) => e.stopPropagation()} /></td>
                <td className="ro">{n.key.replace(/,/g, '; ')}</td>
                <td className="num"><input type="number" step={50} value={t.q} onChange={(e) => up({ terminals: { ...net.terminals, [n.key]: { ...t, q: Number(e.target.value) || 0 } } })} /></td>
              </tr>);
            })}</tbody></table>
          <Row label="Δp terminal (Pa)"><input type="number" step={5} value={net.termDp} onChange={(e) => up({ termDp: Number(e.target.value) || 0 })} /></Row>
          <p className="phelp">Caudal total: <b>{f1(c.fan.q, 0)} m³/h</b>. El origen debe ser un extremo; las derivaciones se detectan donde una línea llega a otra.</p>
        </div>
      </div>)}
      {tab === 'calc' && (<>
        <table className="ptable bom"><thead><tr><th>Tramo</th><th>Sección</th><th className="num">L (m)</th><th className="num">Q (m³/h)</th><th className="num">v (m/s)</th><th className="num">R (Pa/m)</th><th className="num">Δp fric.</th><th className="num">ζ</th><th className="num">Δp sing.</th><th className="num">Δp acum. (Pa)</th></tr></thead>
          <tbody>{c.rows.map((r) => <tr key={r.seg} className={r.v > net.vmax * 1.01 ? 'warn' : ''}><td>{r.name}</td><td>{r.size}</td><td className="num">{f1(r.L / 1000, 2)}</td><td className="num">{r.q}</td><td className="num">{f1(r.v, 2)}</td><td className="num">{f1(r.R, 2)}</td><td className="num">{f1(r.dpF, 1)}</td><td className="num">{f1(r.zeta, 2)}</td><td className="num">{f1(r.dpS, 1)}</td><td className="num">{f1(r.dpTot, 1)}</td></tr>)}</tbody></table>
        <div className="net-grid">
          <div>
            <div className="psec-title">Equilibrado</div>
            <table className="ptable"><thead><tr><th>Terminal</th><th className="num">Q</th><th className="num">Δp (Pa)</th><th className="num">A compensar (Pa)</th></tr></thead>
              <tbody>{c.terms.map((t) => <tr key={t.key}><td>{t.name}</td><td className="num">{t.q}</td><td className="num">{f1(t.dp, 1)}</td><td className="num">{t.excess > 0.5 ? <b>{f1(t.excess, 1)}</b> : '—'}</td></tr>)}</tbody></table>
            <p className="phelp">El terminal más desfavorable marca el circuito índice; en el resto, la compuerta de regulación debe absorber la diferencia.</p>
          </div>
          <div>
            <div className="psec-title">Ventilador necesario</div>
            <Row label="Caudal"><span className="ro">{f1(c.fan.q, 0)} m³/h ({f1(c.fan.q / 3600, 3)} m³/s)</span></Row>
            <Row label="Δp circuito índice"><span className="ro">{f1(c.fan.dp, 1)} Pa</span></Row>
            <Row label="Δp con margen 10 %"><span className="ro"><b>{f1(c.fan.dp * 1.1, 0)} Pa</b></span></Row>
            <Row label="Potencia aire"><span className="ro">{f1((c.fan.q / 3600) * c.fan.dp * 1.1, 0)} W · al eje (η 0,6) ≈ {f1((c.fan.q / 3600) * c.fan.dp * 1.1 / 0.6, 0)} W</span></Row>
            <p className="phelp">Añade la pérdida del equipo (filtros, baterías, recuperador) a la presión disponible del ventilador.</p>
          </div>
        </div>
      </>)}
      {tab === 'acoustic' && (<div className="net-grid">
        <div>
          <div className="psec-title">Ruido regenerado (VDI 2081, orientativo)</div>
          <Row label="NR objetivo"><input type="number" step={5} value={net.nrTarget} onChange={(e) => up({ nrTarget: Number(e.target.value) || 30 })} /></Row>
          <table className="ptable"><thead><tr><th>Tramo</th><th className="num">v</th><th className="num">Lw (dB)</th><th className="num">NR est.</th></tr></thead>
            <tbody>{c.rows.map((r) => <tr key={r.seg} className={r.nr > net.nrTarget ? 'warn' : ''}><td>{r.name} · {r.size}</td><td className="num">{f1(r.v, 1)}</td><td className="num">{f1(r.lw, 1)}</td><td className="num">{r.nr}</td></tr>)}</tbody></table>
          {(() => { const mx = Math.max(0, ...c.rows.map((r) => r.nr)); const il = mx - net.nrTarget; return il > 0
            ? <p className="phelp"><b>Silenciador recomendado</b> en la impulsión: atenuación ≥ {il + 3} dB a 250 Hz (p. ej. bafles de 100 mm, L ≈ {Math.max(600, Math.ceil((il + 3) / 10) * 600)} mm), o reduce la velocidad.</p>
            : <p className="phelp">El ruido regenerado en los conductos no supera NR {net.nrTarget}. Comprueba además el ruido del ventilador y de las unidades terminales.</p>; })()}
        </div>
        <div>
          <div className="psec-title">Aislamiento térmico (RITE IT 1.2.4.2)</div>
          <Row label="Ubicación"><Seg value={net.ins.where} onChange={(v) => upIns({ where: v })} options={[['int', 'Interior'], ['ext', 'Exterior']]} /></Row>
          <Row label="Fluido"><Seg value={net.ins.mode} onChange={(v) => upIns({ mode: v })} options={[['cold', 'Aire frío'], ['hot', 'Aire caliente']]} /></Row>
          <Row label="Espesor (mm)"><input type="number" step={5} value={net.ins.e} onChange={(e) => upIns({ e: Number(e.target.value) || 0 })} /></Row>
          <Row label="λ (W/m·K)"><input type="number" step={0.002} value={net.ins.lambda} onChange={(e) => upIns({ lambda: Number(e.target.value) || 0.04 })} /></Row>
          <Row label="T aire / ambiente (°C)"><span style={{ display: 'flex', gap: 6 }}><input type="number" value={net.ins.tAir} onChange={(e) => upIns({ tAir: Number(e.target.value) })} /><input type="number" value={net.ins.tAmb} onChange={(e) => upIns({ tAmb: Number(e.target.value) })} /></span></Row>
          {c.rows[0] && <p className="phelp">Espesor mínimo RITE: <b>{c.rows[0].eMin} mm</b> {c.rows[0].insOk ? '✓ cumple' : '✗ no cumple'}. Flujo de calor total: {f1(c.rows.reduce((a, r) => a + r.qLoss, 0), 0)} W. Temperatura del aire en los terminales: {c.rows.filter((r) => !c.segs[r.seg].children.length).map((r) => `${f1(r.tOut, 1)} °C`).join(' · ')}.</p>}
        </div>
      </div>)}
      {tab === 'measure' && (<>
        <table className="ptable bom"><thead><tr><th>Capítulo</th><th>Descripción</th><th>Ud</th><th className="num">Cantidad</th></tr></thead>
          <tbody>{meas.map((m) => <tr key={m.code}><td>{m.group}</td><td>{m.desc}</td><td>{m.unit}</td><td className="num">{f1(m.qty, 2)}</td></tr>)}</tbody></table>
        <p className="phelp">{gen.items.length} piezas a generar ({gen.items.filter((i) => i.kind === 'tube' || i.kind === 'duct').length} tramos de conducto y {gen.items.filter((i) => i.kind !== 'tube' && i.kind !== 'duct').length} accesorios).</p>
        {gen.warnings.map((w) => <div key={w} className="fdlg-err">{w}</div>)}
      </>)}
      <div className="modal-btns">
        <button className="btn" onClick={toExcel}>Exportar Excel</button>
        <button className="btn" onClick={toBc3}>Exportar BC3</button>
        <button className="btn" disabled={!net.generated?.length} onClick={() => { save(); isoDrawing(); }}>Plano isométrico</button>
        <span className="grow" />
        <button className="btn" onClick={() => { save(); onClose(); }}>Cerrar</button>
        <button className="btn primary" disabled={!!c.errors.length || !gen.items.length} onClick={generate}>{net.generated?.length ? 'Regenerar en el ensamblaje' : 'Generar en el ensamblaje'}</button>
      </div>
    </Modal>
  );
}

void nodeKey;
