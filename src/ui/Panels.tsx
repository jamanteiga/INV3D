import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore, activeSketch } from '../core/store';
import { evaluate, resolveParams, makeEval, fmt, isValidName } from '../core/expr';
import {
  docParams, ENTITY_NAMES, OP_NAMES, MATERIALS, planeLabel, FEATURE_NAMES, BODY_FEATURES, v3,
  type Feature, type SkEntity, type SketchF, type BoolOp, type EdgeMode, type E2, type PartDoc, type V3, type StdPlane, type PlaneRef,
} from '../core/doc';
import { PROFILES, profileLabel, BOLTS, BOLT_GRADES, boltLength } from '../core/catalog';
import { checkBolts } from '../core/ec3';
import { CONSTRAINT_NAMES, CONSTRAINT_GLYPH, transformEntities, offsetEntity, refLine, refPoint, makeConstraint, num } from '../core/sketch';
import { weldFromFaces, q, type AsmDoc, type Joint } from '../core/asm';
import { SCALES, scaleLabel, VIEW_NAMES, type ViewDir } from '../core/drawing';
import { Icon } from './icons';
import { openFile, newIpj, saveText } from '../core/files';
import { cad, type FlatResult } from '../core/cadClient';
import { flattenPath, bboxOf, type P2 } from '../core/svgpath';
import { writeDxf } from '../core/dxf';
import { asmActions, drwActions } from './actions';
import { bomRows, bomCsv } from './bom';
import { ILOGIC_RULE } from './ilogic';
import { CONTENT } from '../core/content';
import { connectSpaceMouse, getSmSettings, setSmSettings, webHidAvailable, type SmSettings } from './spacemouse';

function useEval() {
  const doc = useStore((s) => (s.kind === 'part' ? s.doc : null));
  const { values } = resolveParams(doc ? docParams(doc) : []);
  return (x: string) => evaluate(x, (n) => values[n]);
}

/** Campo de expresión con validación en vivo, como los cuadros de cota de Inventor. */
export function Expr({ value, onCommit, live, unit = 'mm', autoFocus }: { value: string; onCommit: (v: string) => void; live?: boolean; unit?: string; autoFocus?: boolean }) {
  const ev = useEval();
  const [txt, setTxt] = useState(value);
  useEffect(() => setTxt(value), [value]);
  let err = '', val = NaN;
  try { val = ev(txt); } catch (e) { err = (e as Error).message; }
  const isPlain = /^-?[\d.]+\s*[a-z°]*$/i.test(txt.trim());
  return (
    <div className={`expr ${err ? 'bad' : ''}`}>
      <input value={txt} autoFocus={autoFocus} spellCheck={false}
        onChange={(e) => { setTxt(e.target.value); if (live) onCommit(e.target.value); }}
        onBlur={() => { if (!err && txt !== value) onCommit(txt); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !err) onCommit(txt); if (e.key === 'Escape') setTxt(value); e.stopPropagation(); }}
        title={err || (isPlain ? '' : `= ${fmt(val)} ${unit}`)} />
      <span className="expr-val">{err ? '!' : isPlain ? unit : `= ${fmt(val, 2)}`}</span>
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="prow"><span className="plabel">{label}</span><span className="pfield">{children}</span></label>
);
function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)} title={l}>{l}</button>)}
    </div>
  );
}
const Btns = ({ onOk, onCancel, onPlus, okLabel = 'Aceptar', okDisabled }: { onOk: () => void; onCancel: () => void; onPlus?: () => void; okLabel?: string; okDisabled?: boolean }) => (
  <div className="fdlg-btns">
    <button className="btn primary" disabled={okDisabled} onClick={onOk}>{okLabel}</button>
    <button className="btn" onClick={onCancel}>Cancelar</button>
    {onPlus && <button className="btn icon" title="Aplicar y crear otra" onClick={onPlus}>+</button>}
  </div>
);
const Err = ({ text }: { text?: string }) => (text ? <div className="fdlg-err"><Icon name="error" size={16} />{text}</div> : null);
const Head = ({ icon, name, onName }: { icon: string; name: string; onName?: (v: string) => void }) => (
  <div className="fdlg-head"><Icon name={icon} size={20} />{onName ? <input className="fdlg-name" value={name} onChange={(e) => onName(e.target.value)} /> : <span className="fdlg-title">{name}</span>}</div>
);
const Steps = ({ items, current }: { items: [string, boolean][]; current: number }) => (
  <ol className="steps">{items.map(([l, done], i) => <li key={i} className={`${done ? 'done' : ''} ${i === current ? 'cur' : ''}`}>{l}</li>)}</ol>
);

// =================== PIEZA ===================
const ICONS: Record<string, string> = { extrude: 'extrude', revolve: 'revolve', fillet: 'fillet', chamfer: 'chamfer', hole: 'hole', pattern: 'prect', mirror: 'mirror', shell: 'shell', workplane: 'workplane', loft: 'loft', sweep: 'sweep', sm_face: 'smface', sm_flange: 'smflange',
  rib: 'rib', coil: 'coil', split: 'split', draft: 'draft', thicken: 'thicken', thread: 'thread', workaxis: 'axis', workpoint: 'point' };

/** Selector de plano (origen o de trabajo) con selección en pantalla. */
function PlanePick({ value, onChange, exclude }: { value: PlaneRef; onChange: (p: PlaneRef) => void; exclude?: string }) {
  const s = useStore();
  const v = value.kind === 'std' ? value.name : value.kind === 'work' ? 'w:' + value.id : 'c';
  return (
    <div className="pp-row">
      <select value={v} onChange={(e) => { const x = e.target.value; if (x === 'c') return; onChange(x.startsWith('w:') ? { kind: 'work', id: x.slice(2) } : { kind: 'std', name: x as StdPlane, offset: '0' }); }}>
        {(['XY', 'XZ', 'YZ'] as StdPlane[]).map((p) => <option key={p} value={p}>Plano {p}</option>)}
        {s.doc.features.filter((x) => x.type === 'workplane' && x.id !== exclude).map((x) => <option key={x.id} value={'w:' + x.id}>{x.name}</option>)}
        {value.kind === 'custom' && <option value="c">{value.label}</option>}
      </select>
      <button className={`btn icon ${s.tool === 'pickWorkBase' ? 'on' : ''}`} title="Elegir plano o cara en pantalla" onClick={() => s.setTool(s.tool === 'pickWorkBase' ? null : 'pickWorkBase')}>⌖</button>
    </div>
  );
}

function FeatureDialog() {
  const s = useStore();
  const d = s.dialog && 'draft' in s.dialog ? s.dialog : null;
  if (!d) return null;
  const f = d.draft as Feature;
  const up = (p: Record<string, unknown>) => s.updateDraft(p);
  const sketches = s.doc.features.filter((x): x is SketchF => x.type === 'sketch');
  const closedSks = sketches.filter((x) => x.entities.some((e) => e.type !== 'point' && !e.construction));
  const pst = s.preview?.status[f.id];
  const opSeg = (op: BoolOp) => <Seg value={op} onChange={(v) => up({ op: v })} options={[['join', OP_NAMES.join], ['cut', OP_NAMES.cut], ['intersect', 'Intersec.'], ['new', 'Nuevo']]} />;
  const skSel = (val: string, key: string, list = closedSks) => (
    <select value={val} onChange={(e) => up({ [key]: e.target.value })}>
      {!list.length && <option value="">— sin bocetos válidos —</option>}
      {!list.some((k) => k.id === val) && list.length > 0 && <option value="">— elige —</option>}
      {list.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
    </select>
  );
  const bodyFeats = s.doc.features.filter((x) => BODY_FEATURES.includes(x.type) && x.id !== f.id);
  const featPick = (ids: string[], allowBody = false) => (
    <div className="chips">
      {allowBody && <button className={`chip ${!ids.length ? 'on' : ''}`} onClick={() => up({ features: [] })}>Sólido completo</button>}
      {bodyFeats.map((x) => {
        const on = ids.includes(x.id);
        return <button key={x.id} className={`chip ${on ? 'on' : ''}`} onClick={() => up({ features: on ? ids.filter((i) => i !== x.id) : [...ids, x.id] })}>{x.name}</button>;
      })}
      {!bodyFeats.length && <span className="phelp">No hay operaciones de sólido.</span>}
    </div>
  );
  const axisSel = (val: string, key: string, allowNone = false) => (
    <Seg value={val as any} onChange={(v) => up({ [key]: v })} options={[...(allowNone ? [['', '—'] as ['', string]] : []), ['X', 'X'], ['Y', 'Y'], ['Z', 'Z']] as any} />
  );
  return (
    <div className="fdlg">
      <Head icon={ICONS[f.type] ?? 'part'} name={f.name} onName={(v) => up({ name: v })} />
      {f.type === 'extrude' && (<>
        <Row label="Perfil">{skSel(f.profile, 'profile')}</Row>
        <Row label="Extensión"><Seg value={f.extent ?? 'distance'} onChange={(v) => up({ extent: v })} options={[['distance', 'Distancia'], ['through', 'A través de todo']]} /></Row>
        {(f.extent ?? 'distance') === 'distance' && <Row label="Distancia"><Expr value={f.distance} live autoFocus onCommit={(v) => up({ distance: v })} /></Row>}
        <Row label="Dirección"><Seg value={f.dir} onChange={(v) => up({ dir: v })} options={[['normal', 'Normal'], ['reverse', 'Inversa'], ['symmetric', 'Simétrica'], ['two', 'Dos dir.']]} /></Row>
        {f.dir === 'two' && (f.extent ?? 'distance') === 'distance' && <Row label="Distancia 2"><Expr value={f.distance2 ?? '10 mm'} live onCommit={(v) => up({ distance2: v })} /></Row>}
        <Row label="Inclinación"><Expr value={f.taper ?? '0 deg'} unit="deg" live onCommit={(v) => up({ taper: v })} /></Row>
        <Row label="Operación">{opSeg(f.op)}</Row>
      </>)}
      {f.type === 'rib' && (() => {
        const ribSks = sketches.filter((x) => x.entities.some((e) => e.type === 'line' && !e.construction));
        return (<>
          <Row label="Perfil">{skSel(f.profile, 'profile', ribSks)}</Row>
          <Row label="Espesor"><Expr value={f.thickness} live autoFocus onCommit={(v) => up({ thickness: v })} /></Row>
          <Row label="Profundidad"><Expr value={f.depth} live onCommit={(v) => up({ depth: v })} /></Row>
          <Row label="Lado"><Seg value={f.flip ? 'b' : 'a'} onChange={(v) => up({ flip: v === 'b' })} options={[['a', 'Izquierda'], ['b', 'Derecha']]} /></Row>
          <div className="pick-info">Líneas abiertas del boceto: el nervio crece desde ellas hacia el lado elegido, con el espesor centrado en el plano del boceto.</div>
          <Row label="Operación">{opSeg(f.op)}</Row>
        </>);
      })()}
      {f.type === 'coil' && (() => {
        const sk = s.doc.features.find((x) => x.id === f.profile) as SketchF | undefined;
        const lines = sk?.entities.filter((e) => e.type === 'line') ?? [];
        return (<>
          <Row label="Perfil">{skSel(f.profile, 'profile')}</Row>
          <Row label="Eje"><select value={f.axis} onChange={(e) => up({ axis: e.target.value })}>
            <option value="sx">Eje X del boceto</option><option value="sy">Eje Y del boceto</option>
            {lines.map((l, i) => <option key={l.id} value={l.id}>Línea {i + 1}{l.construction ? ' (constr.)' : ''}</option>)}
          </select></Row>
          <Row label="Paso"><Expr value={f.pitch} live autoFocus onCommit={(v) => up({ pitch: v })} /></Row>
          <Row label="Vueltas"><Expr value={f.turns} unit="ul" live onCommit={(v) => up({ turns: v })} /></Row>
          <Row label="Sentido"><Seg value={f.left ? 'l' : 'r'} onChange={(v) => up({ left: v === 'l' })} options={[['r', 'Derecha'], ['l', 'Izquierda']]} /></Row>
          <Row label="Operación">{opSeg(f.op)}</Row>
        </>);
      })()}
      {f.type === 'split' && (<>
        <Row label="Plano"><PlanePick value={f.plane} onChange={(p) => up({ plane: p })} /></Row>
        <Row label="Conservar"><Seg value={f.keep} onChange={(v) => up({ keep: v })} options={[['pos', 'Lado de la normal'], ['neg', 'Lado opuesto']]} /></Row>
      </>)}
      {f.type === 'draft' && (<>
        <Row label="Ángulo"><Expr value={f.angle} unit="deg" live autoFocus onCommit={(v) => up({ angle: v })} /></Row>
        <Row label="Plano neutro"><PlanePick value={f.plane} onChange={(p) => up({ plane: p })} /></Row>
        <div className="pick-info"><b>{f.faces.length}</b> cara(s) a inclinar (planas, cilíndricas o cónicas){f.faces.length > 0 && <button className="link" onClick={() => up({ faces: [] })}>Borrar</button>}. Dirección de desmoldeo: normal del plano neutro.</div>
      </>)}
      {f.type === 'thicken' && (<>
        <Row label="Distancia"><Expr value={f.distance} live autoFocus onCommit={(v) => up({ distance: v })} /></Row>
        <div className="pick-info"><b>{f.faces.length}</b> cara(s){f.faces.length > 0 && <button className="link" onClick={() => up({ faces: [] })}>Borrar</button>}. Distancia negativa: hacia dentro.</div>
        <Row label="Operación">{opSeg(f.op)}</Row>
      </>)}
      {f.type === 'thread' && (<>
        <Row label="Designación"><select value={f.designation} onChange={(e) => up({ designation: e.target.value })}>
          {Object.entries(BOLTS).map(([m, b]) => <option key={m} value={`${m}x${b.p}`}>{m} × {b.p}</option>)}
        </select></Row>
        <label className="check"><input type="checkbox" checked={f.full} onChange={(e) => up({ full: e.target.checked })} />Longitud completa</label>
        {!f.full && <Row label="Longitud"><Expr value={f.length} live onCommit={(v) => up({ length: v })} /></Row>}
        <div className="pick-info"><b>{f.faces.length}</b> cara(s) cilíndrica(s). Rosca cosmética: se muestra en el modelo y se acota en el plano.</div>
      </>)}
      {(f.type === 'workaxis' || f.type === 'workpoint') && (<>
        <div className="prow3"><span className="plabel">Origen</span>{[0, 1, 2].map((i) => <Expr key={i} value={f.origin[i]} onCommit={(v) => up({ origin: f.origin.map((x, k) => (k === i ? v : x)) })} />)}</div>
        {f.type === 'workaxis' && <div className="prow3"><span className="plabel">Dirección</span>{[0, 1, 2].map((i) => <Expr key={i} value={f.dir[i]} unit="ul" onCommit={(v) => up({ dir: f.dir.map((x, k) => (k === i ? v : x)) })} />)}</div>}
        {f.type === 'workaxis' && <Seg value={'' as any} onChange={(v: string) => up({ dir: v === 'X' ? ['1', '0', '0'] : v === 'Y' ? ['0', '1', '0'] : ['0', '0', '1'] })} options={[['X', 'Eje X'], ['Y', 'Eje Y'], ['Z', 'Eje Z']] as any} />}
      </>)}
      {f.type === 'revolve' && (() => {
        const sk = s.doc.features.find((x) => x.id === f.profile) as SketchF | undefined;
        const lines = sk?.entities.filter((e) => e.type === 'line') ?? [];
        return (<>
          <Row label="Perfil">{skSel(f.profile, 'profile')}</Row>
          <Row label="Eje">
            <select value={f.axis} onChange={(e) => up({ axis: e.target.value })}>
              <option value="sx">Eje X del boceto</option><option value="sy">Eje Y del boceto</option>
              {lines.map((l, i) => <option key={l.id} value={l.id}>Línea {i + 1}{l.type === 'line' && l.construction ? ' (constr.)' : ''}</option>)}
            </select>
          </Row>
          <Row label="Ángulo"><Expr value={f.angle} unit="deg" live onCommit={(v) => up({ angle: v })} /></Row>
          <Row label="Operación">{opSeg(f.op)}</Row>
        </>);
      })()}
      {(f.type === 'fillet' || f.type === 'chamfer') && (<>
        {f.type === 'fillet' ? <Row label="Radio"><Expr value={f.radius} live autoFocus onCommit={(v) => up({ radius: v })} /></Row>
          : <Row label="Distancia"><Expr value={f.distance} live autoFocus onCommit={(v) => up({ distance: v })} /></Row>}
        <Row label="Aristas">
          <select value={f.edges.mode} onChange={(e) => up({ edges: { ...f.edges, mode: e.target.value as EdgeMode } })}>
            <option value="picked">Seleccionadas en pantalla</option><option value="all">Todas las aristas</option><option value="circle">Aristas circulares</option>
            <option value="Z">Paralelas a Z</option><option value="X">Paralelas a X</option><option value="Y">Paralelas a Y</option>
          </select>
        </Row>
        {f.edges.mode === 'picked' && <div className="pick-info"><b>{f.edges.points.length}</b> arista(s) seleccionada(s){f.edges.points.length > 0 && <button className="link" onClick={() => up({ edges: { mode: 'picked', points: [] } })}>Borrar</button>}</div>}
      </>)}
      {f.type === 'hole' && (() => {
        const sks = sketches.filter((x) => x.entities.some((e) => e.type === 'point' || e.type === 'circle'));
        const sk = sketches.find((x) => x.id === f.sketch);
        const n = sk?.entities.filter((e) => e.type === 'point' || e.type === 'circle').length ?? 0;
        return (<>
          <Row label="Centros">{skSel(f.sketch, 'sketch', sks)}</Row>
          <div className="pick-info">{n} centro(s): puntos y centros de círculo del boceto. El taladro va hacia el interior del plano del boceto.</div>
          <Row label="Tipo"><Seg value={f.kind} onChange={(v) => up({ kind: v })} options={[['simple', 'Simple'], ['cbore', 'Refrentado'], ['csink', 'Avellanado']]} /></Row>
          <Row label="Diámetro"><Expr value={f.dia} live autoFocus onCommit={(v) => up({ dia: v })} /></Row>
          {f.kind === 'cbore' && (<><Row label="Ø refrentado"><Expr value={f.cbDia} live onCommit={(v) => up({ cbDia: v })} /></Row><Row label="Prof. refr."><Expr value={f.cbDepth} live onCommit={(v) => up({ cbDepth: v })} /></Row></>)}
          {f.kind === 'csink' && (<><Row label="Ø avellanado"><Expr value={f.csDia} live onCommit={(v) => up({ csDia: v })} /></Row><Row label="Ángulo"><Expr value={f.csAngle} unit="deg" live onCommit={(v) => up({ csAngle: v })} /></Row></>)}
          <Row label="Terminación"><Seg value={f.through ? 'through' : 'depth'} onChange={(v) => up({ through: v === 'through' })} options={[['through', 'Pasante'], ['depth', 'Distancia']]} /></Row>
          {!f.through && <Row label="Profundidad"><Expr value={f.depth} live onCommit={(v) => up({ depth: v })} /></Row>}
          <Row label="Rosca"><select value={f.thread} onChange={(e) => up({ thread: e.target.value, ...(e.target.value ? { dia: `${(BOLTS[e.target.value].d - BOLTS[e.target.value].p).toFixed(2)} mm` } : {}) })}>
            <option value="">Sin rosca</option>{Object.keys(BOLTS).map((m) => <option key={m} value={m}>{m} × {BOLTS[m].p} (Ø broca {(BOLTS[m].d - BOLTS[m].p).toFixed(1)})</option>)}
          </select></Row>
        </>);
      })()}
      {f.type === 'pattern' && (<>
        <Row label="Tipo"><Seg value={f.ptype} onChange={(v) => up({ ptype: v })} options={[['rect', 'Rectangular'], ['circ', 'Circular']]} /></Row>
        <div className="plabel">Operaciones a repetir</div>{featPick(f.features)}
        {f.ptype === 'rect' ? (<>
          <Row label="Dirección 1">{axisSel(f.dir1, 'dir1')}</Row>
          <Row label="Cantidad"><Expr value={f.n1} unit="ul" live onCommit={(v) => up({ n1: v })} /></Row>
          <Row label="Separación"><Expr value={f.d1} live onCommit={(v) => up({ d1: v })} /></Row>
          <Row label="Dirección 2">{axisSel(f.dir2, 'dir2', true)}</Row>
          {f.dir2 && (<><Row label="Cantidad"><Expr value={f.n2} unit="ul" live onCommit={(v) => up({ n2: v })} /></Row><Row label="Separación"><Expr value={f.d2} live onCommit={(v) => up({ d2: v })} /></Row></>)}
        </>) : (<>
          <Row label="Eje"><select value={f.axis} onChange={(e) => up({ axis: e.target.value })}>
            <option value="X">Eje X</option><option value="Y">Eje Y</option><option value="Z">Eje Z</option>
            {s.doc.features.filter((x) => x.type === 'workaxis').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select></Row>
          <Row label="Cantidad"><Expr value={f.count} unit="ul" live onCommit={(v) => up({ count: v })} /></Row>
          <Row label="Ángulo total"><Expr value={f.angle} unit="deg" live onCommit={(v) => up({ angle: v })} /></Row>
        </>)}
      </>)}
      {f.type === 'mirror' && (<>
        <div className="plabel">Qué reflejar</div>{featPick(f.features, true)}
        <Row label="Plano"><Seg value={f.plane} onChange={(v) => up({ plane: v })} options={[['YZ', 'YZ'], ['XZ', 'XZ'], ['XY', 'XY']]} /></Row>
      </>)}
      {f.type === 'shell' && (<>
        <Row label="Espesor"><Expr value={f.thickness} live autoFocus onCommit={(v) => up({ thickness: v })} /></Row>
        <div className="pick-info"><b>{f.faces.length}</b> cara(s) a eliminar{f.faces.length > 0 && <button className="link" onClick={() => up({ faces: [] })}>Borrar</button>}</div>
      </>)}
      {f.type === 'workplane' && (<>
        <Row label="Plano base"><PlanePick value={f.base} onChange={(p) => up({ base: p })} exclude={f.id} /></Row>
        <Row label="Desfase"><Expr value={f.offset} live autoFocus onCommit={(v) => up({ offset: v })} /></Row>
        <Row label="Giro (eje X)"><Expr value={f.angle} unit="deg" live onCommit={(v) => up({ angle: v })} /></Row>
      </>)}
      {f.type === 'loft' && (<>
        <div className="plabel">Secciones (en orden)</div>
        <div className="chips">
          {closedSks.map((k) => { const on = f.sections.includes(k.id); return <button key={k.id} className={`chip ${on ? 'on' : ''}`} onClick={() => up({ sections: on ? f.sections.filter((i) => i !== k.id) : [...f.sections, k.id] })}>{on ? `${f.sections.indexOf(k.id) + 1}. ` : ''}{k.name}</button>; })}
        </div>
        <label className="check"><input type="checkbox" checked={f.ruled} onChange={(e) => up({ ruled: e.target.checked })} />Superficie reglada (caras planas entre secciones)</label>
        <Row label="Operación">{opSeg(f.op)}</Row>
      </>)}
      {f.type === 'sweep' && (<>
        <Row label="Perfil">{skSel(f.profile, 'profile')}</Row>
        <Row label="Trayectoria">{skSel(f.path, 'path', sketches.filter((x) => x.entities.some((e) => e.type === 'line' || e.type === 'arc' || e.type === 'spline')))}</Row>
        <div className="pick-info">Trayectoria: líneas y arcos encadenados de otro boceto, empezando junto al perfil.</div>
        <Row label="Operación">{opSeg(f.op)}</Row>
      </>)}
      {f.type === 'sm_face' && (<>
        <Row label="Perfil">{skSel(f.profile, 'profile')}</Row>
        <div className="pick-info">Espesor de chapa: {s.doc.sheet?.t}</div>
      </>)}
      {f.type === 'sm_flange' && (<>
        <div className="pick-info">{f.edge ? <>Arista elegida · {fmt(v3.len(v3.sub(f.edge.p1, f.edge.p0)), 1)} mm</> : 'Selecciona en pantalla una arista del borde de la chapa'}</div>
        <Row label="Longitud"><Expr value={f.length} live autoFocus onCommit={(v) => up({ length: v })} /></Row>
        <Row label="Ángulo"><Expr value={f.angle} unit="deg" live onCommit={(v) => up({ angle: v })} /></Row>
        <Row label="Sentido"><Seg value={f.dir} onChange={(v) => up({ dir: v })} options={[['up', 'Hacia arriba'], ['down', 'Hacia abajo']]} /></Row>
        <div className="pick-info">Radio interior {s.doc.sheet?.r} · K = {s.doc.sheet?.k}. La longitud es el tramo recto tras el pliegue.</div>
      </>)}
      <Err text={pst && !pst.ok ? pst.error : undefined} />
      <Btns onOk={() => s.applyDialog(true)} onCancel={s.closeDialog} onPlus={!d.editId ? () => s.applyDialog(false) : undefined} />
    </div>
  );
}

function EntityEditor({ e }: { e: SkEntity }) {
  const s = useStore();
  const up = (patch: Record<string, unknown>) => s.updateEntity(e.id, patch as never);
  const pt = (label: string, p: E2, set: (v: E2) => void) => (
    <div className="prow2"><span className="plabel">{label}</span><Expr value={p[0]} onCommit={(v) => set([v, p[1]])} /><Expr value={p[1]} onCommit={(v) => set([p[0], v])} /></div>
  );
  const sk = activeSketch(s);
  const cons = (sk?.constraints ?? []).filter((c) => [c.a, c.b, c.c].some((r) => r?.e === e.id));
  return (
    <div className="psec">
      <div className="psec-title">{ENTITY_NAMES[e.type]}{e.ref ? ' (proyectada)' : ''}</div>
      {e.type === 'rect' && (<>{pt('Esquina', [e.x, e.y], (v) => up({ x: v[0], y: v[1] }))}<Row label="Ancho"><Expr value={e.w} onCommit={(v) => up({ w: v })} /></Row><Row label="Alto"><Expr value={e.h} onCommit={(v) => up({ h: v })} /></Row></>)}
      {(e.type === 'circle' || e.type === 'npoly') && (<>
        {pt('Centro', [e.cx, e.cy], (v) => up({ cx: v[0], cy: v[1] }))}
        <Row label="Diámetro"><Expr value={e.d} onCommit={(v) => up({ d: v })} /></Row>
        {e.type === 'npoly' && (<><Row label="Lados"><Expr value={e.n} unit="ul" onCommit={(v) => up({ n: v })} /></Row><Row label="Giro"><Expr value={e.rot} unit="deg" onCommit={(v) => up({ rot: v })} /></Row></>)}
      </>)}
      {e.type === 'point' && pt('Posición', [e.cx, e.cy], (v) => up({ cx: v[0], cy: v[1] }))}
      {e.type === 'arc' && (<>
        {pt('Centro', [e.cx, e.cy], (v) => up({ cx: v[0], cy: v[1] }))}
        <Row label="Radio"><Expr value={e.r} onCommit={(v) => up({ r: v })} /></Row>
        <Row label="Ángulo inicio"><Expr value={e.a0} unit="deg" onCommit={(v) => up({ a0: v })} /></Row>
        <Row label="Ángulo fin"><Expr value={e.a1} unit="deg" onCommit={(v) => up({ a1: v })} /></Row>
      </>)}
      {e.type === 'slot' && (<>
        {pt('Centro 1', [e.x1, e.y1], (v) => up({ x1: v[0], y1: v[1] }))}{pt('Centro 2', [e.x2, e.y2], (v) => up({ x2: v[0], y2: v[1] }))}
        <Row label="Anchura"><Expr value={e.w} onCommit={(v) => up({ w: v })} /></Row>
      </>)}
      {e.type === 'line' && (<>{pt('Inicio', e.a, (v) => up({ a: v }))}{pt('Fin', e.b, (v) => up({ b: v }))}</>)}
      {e.type === 'ellipse' && (<>
        {pt('Centro', [e.cx, e.cy], (v) => up({ cx: v[0], cy: v[1] }))}
        <Row label="Semieje mayor"><Expr value={e.rx} onCommit={(v) => up({ rx: v })} /></Row>
        <Row label="Semieje menor"><Expr value={e.ry} onCommit={(v) => up({ ry: v })} /></Row>
        <Row label="Giro"><Expr value={e.rot} unit="deg" onCommit={(v) => up({ rot: v })} /></Row>
      </>)}
      {e.type === 'text' && (<>
        <Row label="Texto"><input value={e.text} onChange={(x) => up({ text: x.target.value })} onKeyDown={(x) => x.stopPropagation()} /></Row>
        {pt('Posición', [e.x, e.y], (v) => up({ x: v[0], y: v[1] }))}
        <Row label="Altura"><Expr value={e.size} onCommit={(v) => up({ size: v })} /></Row>
        <Row label="Giro"><Expr value={e.rot} unit="deg" onCommit={(v) => up({ rot: v })} /></Row>
      </>)}
      {(e.type === 'poly' || e.type === 'spline') && e.pts.map((p, i) => <div key={i}>{pt(`P${i + 1}`, p, (v) => up({ pts: e.pts.map((qq, k) => (k === i ? v : qq)) }))}</div>)}
      {e.type === 'spline' && <label className="check"><input type="checkbox" checked={!!e.closed} onChange={(x) => up({ closed: x.target.checked })} />Cerrada</label>}
      {e.type !== 'point' && <label className="check"><input type="checkbox" checked={!!e.construction} onChange={(x) => up({ construction: x.target.checked })} />Construcción (no forma perfiles)</label>}
      {cons.length > 0 && (<>
        <div className="plabel" style={{ marginTop: 6 }}>Restricciones</div>
        <div className="con-list">{cons.map((c) => (
          <button key={c.id} className={`con-item ${s.selCon === c.id ? 'on' : ''}`} onClick={() => s.set({ selCon: c.id })} title="Seleccionar · Supr para borrar">
            <span className="cg">{CONSTRAINT_GLYPH[c.type]}</span>{c.type === 'dim' ? `${c.name ?? 'Cota'} = ${c.expr}${c.driven ? ' (ref.)' : ''}` : CONSTRAINT_NAMES[c.type]}
          </button>))}
        </div>
      </>)}
      <button className="btn danger wide" onClick={() => s.deleteEntity(e.id)}><Icon name="trash" size={16} />Eliminar (Supr)</button>
    </div>
  );
}

function ConstraintEditor({ sk, id }: { sk: SketchF; id: string }) {
  const s = useStore();
  const c = sk.constraints?.find((x) => x.id === id);
  if (!c) return null;
  return (
    <div className="psec">
      <div className="psec-title">{CONSTRAINT_GLYPH[c.type]} {c.type === 'dim' ? `Cota ${c.name ?? ''}` : CONSTRAINT_NAMES[c.type]}</div>
      {c.type === 'dim' && (<>
        <Row label="Valor"><Expr value={c.expr ?? ''} unit={c.kind === 'angle' ? 'deg' : 'mm'} onCommit={(v) => s.sketchCommit((k) => { const x = k.constraints!.find((q) => q.id === id)!; x.expr = v; }, 'La geometría no admite ese valor')} /></Row>
        <label className="check"><input type="checkbox" checked={!!c.driven} onChange={(e) => {
          if (!e.target.checked) { const cc = { ...c, driven: false }; s.sketchCommit((k) => { k.constraints = k.constraints!.filter((q) => q.id !== id); }); s.addConstraint(cc); }
          else s.sketchCommit((k) => { const x = k.constraints!.find((q) => q.id === id)!; x.driven = true; });
        }} />Cota de referencia (conducida)</label>
      </>)}
      <button className="btn danger wide" onClick={() => s.deleteConstraint(id)}><Icon name="trash" size={16} />Eliminar restricción (Supr)</button>
    </div>
  );
}

function SketchPanel({ sk }: { sk: SketchF }) {
  const s = useStore();
  const e = sk.entities.find((x) => x.id === s.selEntity);
  const st = s.result?.status[sk.id];
  const info = s.skInfo;
  const nCons = (sk.constraints ?? []).filter((c) => c.type !== 'dim').length, nDims = (sk.constraints ?? []).filter((c) => c.type === 'dim').length;
  return (<>
    <div className="psec">
      <div className="psec-title">{sk.name}</div>
      <Row label="Plano"><span className="ro">{planeLabel(sk.plane, s.doc)}</span></Row>
      {sk.plane.kind === 'std' && <Row label="Desfase"><Expr value={sk.plane.offset || '0'} onCommit={(v) => s.commit((d) => { const f = d.features.find((x) => x.id === sk.id) as SketchF; if (f.plane.kind === 'std') f.plane.offset = v; })} /></Row>}
      <Row label="Geometría"><span className="ro">{sk.entities.length} entidades · {nCons} restricciones · {nDims} cotas</span></Row>
      {info && <div className={`dof ${info.dof === 0 ? 'full' : ''}`}>{!info.ok ? 'El boceto no se puede resolver' : info.dof === 0 ? 'Totalmente restringido' : `Se necesitan ${info.dof} cota(s) o restricción(es)`}</div>}
      <Err text={st && !st.ok ? st.error : undefined} />
      {!e && !s.selCon && <p className="phelp">Dibuja con las herramientas de la cinta; las restricciones (coincidente, horizontal…) se añaden solas al forzar el cursor. Acota con <b>Cota</b> (D). Arrastra puntos para ver los grados de libertad. Ctrl+clic para selección múltiple.</p>}
    </div>
    {s.selCon && <ConstraintEditor sk={sk} id={s.selCon} />}
    {e && <EntityEditor e={e} />}
    {s.selEntities.length > 1 && <div className="psec"><div className="psec-title">{s.selEntities.length} entidades seleccionadas</div><p className="phelp">Usa Simetría, Patrón, Mover, Copiar, Girar o Escalar de la cinta.</p></div>}
  </>);
}

/** Operaciones de edición de boceto: desfase, simetría, patrones, mover/copiar/girar/escalar y texto. */
function SkOpDialog() {
  const s = useStore();
  const d = s.dialog as Extract<NonNullable<typeof s.dialog>, { kind: 'skop' }>;
  const sk = activeSketch(s);
  if (!sk) return null;
  const P = d.params;
  const setP = (k: string, v: string) => s.set({ dialog: { ...d, params: { ...P, [k]: v } } });
  const sel = s.selEntities.length ? s.selEntities : s.selEntity ? [s.selEntity] : [];
  const ev0 = makeEval(docParams(s.doc)); const ev = (x: string) => { try { return ev0(x); } catch { return NaN; } };
  const base = d.base ? JSON.parse(d.base) : null;
  const T: Record<string, string> = { offset: 'Desfase', mirror: 'Simetría', rpattern: 'Patrón rectangular', cpattern: 'Patrón circular', move: 'Mover', copy: 'Copiar', rotate: 'Girar', scale: 'Escalar', text: 'Texto', fillet: 'Empalme', chamfer: 'Chaflán' };
  const center = (): [number, number] => { const p = base ? refPoint(sk, base, ev) : null; return p ?? [ev(P.cx ?? '0'), ev(P.cy ?? '0')]; };
  const apply = () => {
    const op = d.op;
    if (op === 'text') {
      if (!P.text?.trim()) return s.notify('Escribe el texto', 'error');
      s.sketchCommit((k) => { k.entities.push({ id: 't' + Date.now().toString(36), type: 'text', x: P.x, y: P.y, text: P.text, size: P.size, rot: P.rot }); });
      s.set({ dialog: null, tool: null }); return;
    }
    if (!sel.length) return s.notify('Selecciona geometría en el boceto (Ctrl+clic para varias)', 'error');
    const ok = s.sketchCommit((k) => {
      if (op === 'offset') { let out = k; for (const id of sel) out = offsetEntity(out, id, ev(P.dist), ev); return out; }
      if (op === 'mirror') {
        const L = base ? refLine(sk, base, ev) : null;
        if (!L) throw new Error('Elige la línea de simetría');
        const [A, B] = L, u = [B[0] - A[0], B[1] - A[1]], ul = Math.hypot(u[0], u[1]) || 1, n = [u[0] / ul, u[1] / ul];
        const f = (p: [number, number]): [number, number] => { const d0 = [p[0] - A[0], p[1] - A[1]], t = d0[0] * n[0] + d0[1] * n[1]; const F = [A[0] + n[0] * t, A[1] + n[1] * t]; return [2 * F[0] - p[0], 2 * F[1] - p[1]]; };
        const r = transformEntities(k, sel, ev, f, { copy: true, mirror: true });
        // restricciones de simetría entre puntos homólogos de líneas
        for (const [src, dst] of r.map) {
          const e0 = r.sk.entities.find((x) => x.id === src);
          if (e0?.type === 'line') for (const kk of ['a', 'b']) r.sk.constraints!.push({ id: 'k' + Math.random().toString(36).slice(2, 9), type: 'symmetric', a: { e: src, k: kk }, b: { e: dst, k: kk }, c: base });
          else if (e0 && (e0.type === 'circle' || e0.type === 'arc')) { r.sk.constraints!.push({ id: 'k' + Math.random().toString(36).slice(2, 9), type: 'symmetric', a: { e: src, k: 'c' }, b: { e: dst, k: 'c' }, c: base }); r.sk.constraints!.push(makeConstraint(r.sk, ev, 'equal', { e: src }, { e: dst })); }
        }
        return r.sk;
      }
      if (op === 'rpattern') {
        let out = k; const nx = Math.max(1, Math.round(ev(P.nx))), ny = Math.max(1, Math.round(ev(P.ny))), dx = ev(P.dx), dy = ev(P.dy);
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { if (!i && !j) continue; out = transformEntities(out, sel, ev, (p) => [p[0] + i * dx, p[1] + j * dy], { copy: true }).sk; }
        return out;
      }
      if (op === 'cpattern') {
        let out = k; const n = Math.max(2, Math.round(ev(P.n))), tot = ev(P.angle), c = center();
        const step = Math.abs(tot - 360) < 1e-9 ? 360 / n : tot / (n - 1);
        for (let i = 1; i < n; i++) { const a = (step * i * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a); out = transformEntities(out, sel, ev, (p) => [c[0] + (p[0] - c[0]) * co - (p[1] - c[1]) * si, c[1] + (p[0] - c[0]) * si + (p[1] - c[1]) * co], { copy: true, rot: step * i }).sk; }
        return out;
      }
      if (op === 'move' || op === 'copy') { const dx = ev(P.dx), dy = ev(P.dy); return transformEntities(k, sel, ev, (p) => [p[0] + dx, p[1] + dy], { copy: op === 'copy' }).sk; }
      if (op === 'rotate') { const a = (ev(P.angle) * Math.PI) / 180, c = center(), co = Math.cos(a), si = Math.sin(a); return transformEntities(k, sel, ev, (p) => [c[0] + (p[0] - c[0]) * co - (p[1] - c[1]) * si, c[1] + (p[0] - c[0]) * si + (p[1] - c[1]) * co], { copy: P.copy === '1', rot: ev(P.angle) }).sk; }
      if (op === 'scale') { const f = ev(P.f), c = center(); if (!(f > 0)) throw new Error('Factor no válido'); return transformEntities(k, sel, ev, (p) => [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f], { copy: P.copy === '1', scale: f }).sk; }
    }, 'Las restricciones impiden esta operación (borra las cotas o fijaciones que lo bloquean)');
    if (ok) s.set({ dialog: null, tool: null });
  };
  const baseLabel = base ? (base.e === 'O' ? 'Origen' : base.e === 'X' ? 'Eje X' : base.e === 'Y' ? 'Eje Y' : `${ENTITY_NAMES[sk.entities.find((x) => x.id === base.e)?.type ?? 'line']}${base.k ? ' · ' + base.k : ''}`) : '';
  const pickBtn = (label: string) => (
    <Row label={label}><div className="pp-row"><span className="ro">{baseLabel || (d.op === 'mirror' ? '— elige línea —' : 'Origen')}</span><button className={`btn icon ${s.tool === 'skpick' ? 'on' : ''}`} onClick={() => s.setTool(s.tool === 'skpick' ? null : 'skpick')} title="Elegir en pantalla">⌖</button></div></Row>
  );
  return (
    <div className="fdlg">
      <Head icon={({ offset: 'offset2d', mirror: 'mirror', rpattern: 'prect', cpattern: 'pcirc', move: 'move', copy: 'copy2d', rotate: 'rotate2d', scale: 'scale2d', text: 'text' } as Record<string, string>)[d.op] ?? 'sketch'} name={T[d.op]} />
      {d.op !== 'text' && <div className="pick-info"><b>{sel.length}</b> entidad(es) seleccionada(s){sel.length === 0 && ' — selecciona en el boceto (Ctrl+clic para varias)'}</div>}
      {d.op === 'text' && (<>
        <Row label="Texto"><input value={P.text} autoFocus onChange={(e) => setP('text', e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></Row>
        <Row label="Altura"><Expr value={P.size} onCommit={(v) => setP('size', v)} /></Row>
        <Row label="Giro"><Expr value={P.rot} unit="deg" onCommit={(v) => setP('rot', v)} /></Row>
        <p className="phelp">El texto forma perfiles cerrados: extrúyelo para grabar o dar relieve.</p>
      </>)}
      {d.op === 'offset' && <Row label="Distancia"><Expr value={P.dist} onCommit={(v) => setP('dist', v)} /></Row>}
      {d.op === 'offset' && <p className="phelp">Positiva hacia fuera en contornos cerrados; negativa hacia dentro.</p>}
      {d.op === 'mirror' && pickBtn('Línea de simetría')}
      {d.op === 'rpattern' && (<>
        <Row label="Cantidad X"><Expr value={P.nx} unit="ul" onCommit={(v) => setP('nx', v)} /></Row><Row label="Separación X"><Expr value={P.dx} onCommit={(v) => setP('dx', v)} /></Row>
        <Row label="Cantidad Y"><Expr value={P.ny} unit="ul" onCommit={(v) => setP('ny', v)} /></Row><Row label="Separación Y"><Expr value={P.dy} onCommit={(v) => setP('dy', v)} /></Row>
      </>)}
      {(d.op === 'cpattern' || d.op === 'rotate' || d.op === 'scale') && pickBtn('Centro')}
      {d.op === 'cpattern' && (<><Row label="Cantidad"><Expr value={P.n} unit="ul" onCommit={(v) => setP('n', v)} /></Row><Row label="Ángulo total"><Expr value={P.angle} unit="deg" onCommit={(v) => setP('angle', v)} /></Row></>)}
      {(d.op === 'move' || d.op === 'copy') && (<><Row label="Δ X"><Expr value={P.dx} onCommit={(v) => setP('dx', v)} /></Row><Row label="Δ Y"><Expr value={P.dy} onCommit={(v) => setP('dy', v)} /></Row></>)}
      {d.op === 'rotate' && <Row label="Ángulo"><Expr value={P.angle} unit="deg" onCommit={(v) => setP('angle', v)} /></Row>}
      {d.op === 'scale' && <Row label="Factor"><Expr value={P.f} unit="ul" onCommit={(v) => setP('f', v)} /></Row>}
      {(d.op === 'rotate' || d.op === 'scale') && <label className="check"><input type="checkbox" checked={P.copy === '1'} onChange={(e) => setP('copy', e.target.checked ? '1' : '0')} />Copiar</label>}
      <Btns onOk={apply} onCancel={() => s.set({ dialog: null, tool: null })} />
    </div>
  );
}
void num;

function PartSummary() {
  const s = useStore();
  const p = s.result?.props;
  const dens = MATERIALS.find((m) => m.name === s.doc.iProperties.material)?.density ?? 1000;
  const f = s.doc.features.find((x) => x.id === s.selFeature);
  const st = f ? s.result?.status[f.id] : undefined;
  return (<>
    {f && (
      <div className="psec">
        <div className="psec-title">{f.name}</div>
        <Row label="Tipo"><span className="ro">{FEATURE_NAMES[f.type]}</span></Row>
        {f.type === 'extrude' && <Row label="Distancia"><span className="ro">{f.distance} · {OP_NAMES[f.op]}</span></Row>}
        {f.type === 'hole' && <Row label="Agujero"><span className="ro">Ø{f.dia}{f.thread ? ` · ${f.thread}` : ''} · {f.through ? 'pasante' : f.depth}</span></Row>}
        {f.type === 'import' && <Row label="Fichero"><span className="ro">{f.fileName}</span></Row>}
        <Err text={st && !st.ok ? st.error : undefined} />
        {f.type !== 'import' && <button className="btn wide" onClick={() => (f.type === 'sketch' ? s.editSketch(f.id) : s.openFeatureDialog(f.type as never, f.id))}>Editar</button>}
      </div>
    )}
    <div className="psec">
      <div className="psec-title">Propiedades físicas</div>
      {p ? (<>
        <Row label="Material"><span className="ro">{s.doc.iProperties.material}</span></Row>
        <Row label="Masa"><span className="ro strong">{fmt(p.volume * 1e-9 * dens, 3)} kg</span></Row>
        <Row label="Volumen"><span className="ro">{fmt(p.volume / 1000, 2)} cm³</span></Row>
        <Row label="Área"><span className="ro">{fmt(p.area / 100, 2)} cm²</span></Row>
        <Row label="Centro de g."><span className="ro mono">{p.cog.map((v) => fmt(v, 1)).join(', ')}</span></Row>
        <Row label="Caja"><span className="ro mono">{[0, 1, 2].map((i) => fmt(p.bbox[1][i] - p.bbox[0][i], 1)).join(' × ')} mm</span></Row>
      </>) : <p className="phelp">Sin sólido todavía. Empieza con <b>Iniciar boceto 2D</b> (S), elige un plano y dibuja un perfil cerrado; después <b>Extrusión</b> (E).</p>}
    </div>
  </>);
}

// =================== ENSAMBLAJE ===================
function JointDialog() {
  const s = useStore();
  const d = s.dialog as { kind: 'joint'; draft: any; step?: number };
  const j = d.draft;
  const ok = j.a && j.b;
  const occName = (id?: string) => s.asm.occurrences.find((o) => o.id === id)?.name ?? '—';
  const kindName = (r: any) => (r?.kind === 'axis' ? `eje Ø${fmt((r.radius ?? 0) * 2, 2)}` : 'cara');
  const help: Record<string, string> = {
    mate: 'Coincidir: caras enfrentadas (normales opuestas) o ejes alineados. Eje con cara: el eje queda sobre el plano.',
    flush: 'Al ras: caras paralelas en el mismo sentido, a la distancia del desfase.',
    angle: 'Ángulo entre las normales de dos caras (o direcciones de dos ejes).',
    tangent: 'Tangente: cara plana y cilíndrica (o dos cilindros) en contacto.',
    insert: 'Insertar: dos ejes (tornillo y taladro) alineados y sus caras extremas coincidentes. Elige cada cilindro cerca del extremo que debe coincidir.',
    rigid: 'Rígida: caras enfrentadas y puntos de selección coincidentes.',
  };
  return (
    <div className="fdlg">
      <Head icon="constraint3d" name={j.name} onName={(v) => s.updateDraft({ name: v })} />
      <div className="jt-grid">
        {([['mate', 'Coincidir', 'constraint3d'], ['flush', 'Al ras', 'joint'], ['angle', 'Ángulo', 'angle3d'], ['tangent', 'Tangente', 'c_tangent'], ['insert', 'Insertar', 'insert3d'], ['rigid', 'Rígida', 'ground']] as const).map(([t, l, ic]) => (
          <button key={t} className={`jt ${j.type === t ? 'on' : ''}`} onClick={() => s.updateDraft({ type: t })}><Icon name={ic} size={20} />{l}</button>
        ))}
      </div>
      <Steps current={d.step ?? 0} items={[[`A: ${j.a ? `${occName(j.a.occ)} · ${kindName(j.a)}` : 'elegir cara o eje'}`, !!j.a], [`B (se mueve): ${j.b ? `${occName(j.b.occ)} · ${kindName(j.b)}` : 'elegir cara o eje'}`, !!j.b]]} />
      {j.type !== 'angle' && <Row label="Desfase"><Expr value={j.offset} onCommit={(v) => s.updateDraft({ offset: v })} /></Row>}
      {j.type === 'angle' && <Row label="Ángulo"><Expr value={j.angle} unit="deg" onCommit={(v) => s.updateDraft({ angle: v })} /></Row>}
      {j.type === 'insert' && <Row label="Solución"><Seg value={j.aligned ? 'al' : 'op'} onChange={(v) => s.updateDraft({ aligned: v === 'al' })} options={[['al', 'Alineada'], ['op', 'Opuesta']]} /></Row>}
      <p className="phelp">{help[j.type]}</p>
      <Btns okDisabled={!ok} onOk={() => {
        if (j.a.occ === j.b.occ) { s.notify('Elige geometría de dos componentes distintos', 'error'); return; }
        if (j.type === 'insert' && (j.a.kind !== 'axis' || j.b.kind !== 'axis')) { s.notify('Insertar necesita dos caras cilíndricas', 'error'); return; }
        if (j.type === 'tangent' && j.a.kind !== 'axis' && j.b.kind !== 'axis') { s.notify('Tangente necesita al menos una cara cilíndrica', 'error'); return; }
        if (j.type === 'flush' && (j.a.kind === 'axis' || j.b.kind === 'axis')) { s.notify('Al ras se aplica a caras planas', 'error'); return; }
        const joint: Joint = { id: j.id, name: j.name, type: j.type, a: j.a, b: j.b, offset: j.offset, angle: j.angle, aligned: j.type === 'insert' ? !!j.aligned : undefined };
        s.commitAsm((a) => { a.joints.push(joint); });
        s.closeDialog();
      }} onCancel={s.closeDialog} />
    </div>
  );
}

function SkelDialog() {
  const s = useStore();
  const d = s.dialog as { kind: 'skel'; draft: any; step?: number };
  const k = d.draft;
  const coord = (p: V3 | undefined, key: 'a' | 'b') => (
    <div className="prow3">
      <span className="plabel">{key === 'a' ? 'Inicio' : 'Fin'}</span>
      {[0, 1, 2].map((i) => <input key={i} className="num-in" value={p ? String(p[i]) : ''} placeholder={'XYZ'[i]}
        onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); const n: V3 = p ? [...p] as V3 : [0, 0, 0]; if (isFinite(v)) n[i] = v; s.updateDraft({ [key]: n }); }} />)}
    </div>
  );
  const ok = k.a && k.b && v3.len(v3.sub(k.a, k.b)) > 1e-6;
  return (
    <div className="fdlg">
      <Head icon="skel" name="Línea de esqueleto" />
      <Steps current={d.step ?? 0} items={[['Punto inicial', !!k.a], ['Punto final', !!k.b]]} />
      {coord(k.a, 'a')}{coord(k.b, 'b')}
      {ok && <div className="pick-info">Longitud {fmt(v3.len(v3.sub(k.b, k.a)), 1)} mm</div>}
      <p className="phelp">Clic en vértices de componentes o extremos de líneas, o escribe las coordenadas (mm). Tras aceptar, la siguiente línea empieza en el punto final.</p>
      <Btns okLabel="Añadir línea" okDisabled={!ok} onOk={() => {
        s.commitAsm((a) => { a.skeleton.push({ id: k.id, a: k.a, b: k.b }); });
        useStore.setState({ dialog: { kind: 'skel', draft: { id: 'k' + Date.now().toString(36), a: k.b }, step: 1 }, tool: 'skelPoint' });
      }} onCancel={s.closeDialog} />
    </div>
  );
}

function ProfileSelect({ family, size, onChange }: { family: string; size: string; onChange: (f: string, s: string) => void }) {
  const fam = PROFILES.find((p) => p.id === family) ?? PROFILES[0];
  return (<>
    <Row label="Familia"><select value={family} onChange={(e) => { const f = PROFILES.find((p) => p.id === e.target.value)!; onChange(f.id, Object.keys(f.sizes)[Math.min(3, Object.keys(f.sizes).length - 1)]); }}>
      {PROFILES.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.standard}</option>)}
    </select></Row>
    <Row label="Tamaño"><select value={size} onChange={(e) => onChange(family, e.target.value)}>{Object.keys(fam.sizes).map((z) => <option key={z}>{z}</option>)}</select></Row>
  </>);
}

function FrameDialog() {
  const s = useStore();
  const d = (s.dialog as { draft: any }).draft;
  return (
    <div className="fdlg">
      <Head icon="frame" name="Insertar perfil" />
      <ProfileSelect family={d.family} size={d.size} onChange={(f, z) => s.updateDraft({ family: f, size: z })} />
      <Row label="Material"><select value={d.material} onChange={(e) => s.updateDraft({ material: e.target.value })}>{MATERIALS.slice(0, 6).map((m) => <option key={m.name}>{m.name}</option>)}</select></Row>
      <Row label="Giro"><Expr value={d.rot} unit="deg" onCommit={(v) => s.updateDraft({ rot: v })} /></Row>
      <Row label="Desfase X"><Expr value={d.offX} onCommit={(v) => s.updateDraft({ offX: v })} /></Row>
      <Row label="Desfase Y"><Expr value={d.offY} onCommit={(v) => s.updateDraft({ offY: v })} /></Row>
      <label className="check"><input type="checkbox" checked={d.autoMiter} onChange={(e) => s.updateDraft({ autoMiter: e.target.checked })} />Inglete automático en esquinas</label>
      <div className="pick-info"><b>{d.lines.length}</b> línea(s) seleccionada(s){d.lines.length > 0 && <button className="link" onClick={() => s.updateDraft({ lines: [] })}>Borrar</button>}</div>
      <p className="phelp">Elige líneas del esqueleto del ensamblaje o líneas de bocetos de una pieza esqueleto colocada. El perfil se centra en la línea; usa el desfase para apoyarlo.</p>
      <Btns okDisabled={!d.lines.length} onOk={() => asmActions.applyFrame(d)} onCancel={s.closeDialog} />
    </div>
  );
}

function EndDialog() {
  const s = useStore();
  const d = (s.dialog as { draft: any }).draft;
  const nm = (id: string) => s.asm.frames.find((m) => m.id === id)?.name ?? '—';
  return (
    <div className="fdlg">
      <Head icon={d.type === 'miter' ? 'miter' : 'trim'} name={d.type === 'miter' ? 'Inglete' : 'Recortar / alargar a barra'} />
      <Row label="Tipo"><Seg value={d.type} onChange={(v) => s.updateDraft({ type: v })} options={[['miter', 'Inglete'], ['trim', 'Recortar']]} /></Row>
      <Steps current={d.member ? 1 : 0} items={[[`Barra: ${d.member ? nm(d.member) : 'elegir'}`, !!d.member], [`${d.type === 'miter' ? 'Otra barra' : 'Barra de referencia'}: ${d.target ? nm(d.target) : 'elegir'}`, !!d.target]]} />
      <Row label="Holgura"><Expr value={d.gap} onCommit={(v) => s.updateDraft({ gap: v })} /></Row>
      <p className="phelp">{d.type === 'miter' ? 'Corta ambas barras por el plano bisector de su extremo común.' : 'Ajusta el extremo de la barra a la cara más próxima de la de referencia (unión en T).'}</p>
      <Btns okLabel="Aplicar" okDisabled={!d.member || !d.target} onOk={() => asmActions.applyEnd(d)} onCancel={s.closeDialog} />
    </div>
  );
}

function WeldDialog() {
  const s = useStore();
  const dl = s.dialog as { draft: any; step?: number };
  const d = dl.draft;
  const geo = useMemo(() => {
    if (!d.fA || !d.fB) return null;
    try { return { ok: weldFromFaces(d.fA.normalW, d.fA.vertsW, d.fB.normalW, d.fB.vertsW) } as const; } catch (e) { return { err: (e as Error).message } as const; }
  }, [d.fA, d.fB]);
  const g = geo && 'ok' in geo ? geo.ok : null;
  const L = g ? v3.len(v3.sub(g.p1, g.p0)) : 0;
  let a = 0; try { a = makeEval([])(d.throat); } catch { /* */ }
  return (
    <div className="fdlg">
      <Head icon="weld" name="Cordón en ángulo" />
      <Steps current={dl.step ?? 0} items={[['Primera cara', !!d.fA], ['Segunda cara', !!d.fB]]} />
      <Row label="Garganta a"><Expr value={d.throat} onCommit={(v) => s.updateDraft({ throat: v })} /></Row>
      <Row label="Proceso"><select value={d.process} onChange={(e) => s.updateDraft({ process: e.target.value })}>
        <option value="135">135 · MAG</option><option value="131">131 · MIG</option><option value="141">141 · TIG</option><option value="111">111 · electrodo</option>
      </select></Row>
      <Err text={geo && 'err' in geo ? geo.err : undefined} />
      {g && <div className="weld-sym"><b>a{fmt(a, 1)} ⊿ {fmt(L, 0)}</b><span>ISO 2553 · lado del rincón · z = {fmt(a * Math.SQRT2, 1)} mm · {fmt(0.5 * 2 * a * a * L * 7850e-9, 3)} kg aporte</span></div>}
      <Btns okDisabled={!g} onOk={() => {
        const n = s.asm.welds.length + 1;
        s.commitAsm((as) => { as.welds.push({ id: 'w' + Date.now().toString(36), name: `Cordón ${n}`, throat: d.throat, process: d.process, p0: g!.p0, p1: g!.p1, dA: g!.dA, dB: g!.dB }); });
        useStore.setState({ dialog: { kind: 'weld', draft: { throat: d.throat, process: d.process }, step: 0 }, tool: 'weldFace' });
      }} onCancel={s.closeDialog} />
    </div>
  );
}

function BoltDialog() {
  const s = useStore();
  const dl = s.dialog as { draft: any; editId?: string };
  const g = dl.draft;
  const [tab, setTab] = useState<'design' | 'calc'>('design');
  const up = (p: Record<string, unknown>) => s.updateDraft(p);
  const upC = (p: Record<string, unknown>) => s.updateDraft({ calc: { ...g.calc, ...p } });
  const num = (x: string) => { try { return makeEval([])(x); } catch { return NaN; } };
  const n = Math.max(1, Math.round(num(g.n1))) * Math.max(1, Math.round(num(g.n2)));
  const L = boltLength(g.size, num(g.grip) || 0, g.washers, g.nut);
  const placed = v3.len(g.origin) > 0 || dl.editId;
  const res = checkBolts({ size: g.size, grade: g.grade, nBolts: n, FvEd: Number(g.calc.FvEd) || 0, FtEd: Number(g.calc.FtEd) || 0, planes: Number(g.calc.planes) || 1, threadInShear: g.calc.threadInShear,
    steel: g.calc.steel, tmin: Number(g.calc.tmin) || 1, e1: Number(g.calc.e1) || 0, e2: Number(g.calc.e2) || 0, p1: num(g.n1) > 1 ? num(g.p1) : 0, p2: num(g.n2) > 1 ? num(g.p2) : 0 });
  const rotU = (deg: number) => { const d = v3.norm(g.dir); up({ u: q.rotate(q.axisAngle(d, (deg * Math.PI) / 180), g.u) }); };
  return (
    <div className="fdlg">
      <Head icon="bolt" name={g.name} onName={(v) => up({ name: v })} />
      <div className="seg tabs-seg"><button className={tab === 'design' ? 'on' : ''} onClick={() => setTab('design')}>Diseño</button><button className={tab === 'calc' ? 'on' : ''} onClick={() => setTab('calc')}>Cálculo EN 1993-1-8</button></div>
      {tab === 'design' ? (<>
        <div className="pick-info">{placed ? <>Cara de inicio elegida · apriete {g.grip} mm</> : 'Clic en la cara donde apoya la cabeza'}</div>
        <Row label="Métrica"><select value={g.size} onChange={(e) => up({ size: e.target.value })}>{Object.keys(BOLTS).map((m) => <option key={m}>{m}</option>)}</select></Row>
        <Row label="Clase"><select value={g.grade} onChange={(e) => up({ grade: e.target.value })}>{Object.keys(BOLT_GRADES).map((m) => <option key={m}>{m}</option>)}</select></Row>
        <Row label="Filas × sep."><span className="pair"><Expr value={g.n1} unit="ul" onCommit={(v) => up({ n1: v })} /><Expr value={g.p1} onCommit={(v) => up({ p1: v })} /></span></Row>
        <Row label="Columnas × sep."><span className="pair"><Expr value={g.n2} unit="ul" onCommit={(v) => up({ n2: v })} /><Expr value={g.p2} onCommit={(v) => up({ p2: v })} /></span></Row>
        <Row label="Dirección filas"><span className="pair"><button className="btn" onClick={() => rotU(90)}>Girar 90°</button><button className="btn" onClick={() => rotU(180)}>Invertir</button></span></Row>
        <Row label="Apriete"><Expr value={g.grip} onCommit={(v) => up({ grip: v })} /></Row>
        <Row label="Arandelas"><Seg value={String(g.washers)} onChange={(v) => up({ washers: Number(v) })} options={[['0', 'Ninguna'], ['1', 'Cabeza'], ['2', 'Ambas']]} /></Row>
        <label className="check"><input type="checkbox" checked={g.nut} onChange={(e) => up({ nut: e.target.checked })} />Tuerca ISO 4032</label>
        <label className="check"><input type="checkbox" checked={g.cutHoles} onChange={(e) => up({ cutHoles: e.target.checked })} />Taladrar los componentes (Ø{BOLTS[g.size].d0} mm, EN 1090-2)</label>
        <div className="pick-info">{n} × ISO 4017 {g.size}×{L} {g.grade}{g.nut ? ' + ISO 4032' : ''}{g.washers ? ` + ${g.washers}× ISO 7089` : ''}</div>
      </>) : (<>
        <Row label="Fv,Ed total"><span className="pair"><input className="num-in" value={g.calc.FvEd} onChange={(e) => upC({ FvEd: e.target.value })} /><span className="unit">kN</span></span></Row>
        <Row label="Ft,Ed total"><span className="pair"><input className="num-in" value={g.calc.FtEd} onChange={(e) => upC({ FtEd: e.target.value })} /><span className="unit">kN</span></span></Row>
        <Row label="Planos de corte"><Seg value={String(g.calc.planes)} onChange={(v) => upC({ planes: v })} options={[['1', '1'], ['2', '2']]} /></Row>
        <label className="check"><input type="checkbox" checked={g.calc.threadInShear} onChange={(e) => upC({ threadInShear: e.target.checked })} />Rosca en el plano de corte</label>
        <Row label="Acero chapa"><Seg value={g.calc.steel} onChange={(v) => upC({ steel: v })} options={[['S235', 'S235'], ['S275', 'S275'], ['S355', 'S355']]} /></Row>
        <Row label="t mín."><span className="pair"><input className="num-in" value={g.calc.tmin} onChange={(e) => upC({ tmin: e.target.value })} /><span className="unit">mm</span></span></Row>
        <Row label="e1 / e2"><span className="pair"><input className="num-in" value={g.calc.e1} onChange={(e) => upC({ e1: e.target.value })} /><input className="num-in" value={g.calc.e2} onChange={(e) => upC({ e2: e.target.value })} /><span className="unit">mm</span></span></Row>
        <table className="calc">
          <tbody>{res.rows.map((r, i) => (
            <tr key={i} title={r.formula}>
              <td>{r.label}</td><td className="num">{fmt(r.value, 2)} {r.unit !== '—' ? r.unit : ''}</td>
              <td className="num">{r.util !== undefined ? <span className={`util ${r.util > 1 ? 'bad' : r.util > 0.85 ? 'warn' : 'ok'}`}>{fmt(r.util * 100, 0)} %</span> : ''}</td>
            </tr>
          ))}</tbody>
        </table>
        <div className={`verdict ${res.ok ? 'ok' : 'bad'}`}>{res.ok ? 'Cumple' : 'No cumple'} · aprovechamiento máx. {fmt(res.maxUtil * 100, 0)} %</div>
        {res.warnings.map((w, i) => <div key={i} className="fdlg-err warn"><Icon name="error" size={14} />{w}</div>)}
        <p className="phelp">γM2 = 1,25. Aplastamiento calculado para el tornillo de borde. Pasa el ratón por cada fila para ver la fórmula.</p>
      </>)}
      <Btns okDisabled={!placed} onOk={() => s.applyDialog(true)} onCancel={s.closeDialog} />
    </div>
  );
}

function SelectionPanel() {
  const s = useStore();
  const id = s.selItem;
  const o = s.asm.occurrences.find((x) => x.id === id);
  const m = s.asm.frames.find((x) => x.id === id);
  const w = s.asm.welds.find((x) => x.id === id);
  const b = s.asm.bolts.find((x) => x.id === id);
  const errs = s.asmResult?.errors ?? {};
  const upM = (p: Record<string, unknown>) => s.commitAsm((a) => { Object.assign(a.frames.find((x) => x.id === id)!, p); });
  if (o) {
    const xf = s.asmResult?.xf[o.id] ?? o.xf;
    const setPos = (i: number, v: number) => s.commitAsm((a) => { const t = a.occurrences.find((x) => x.id === id)!; const p: V3 = [...xf.pos] as V3; p[i] = v; t.xf = { pos: p, quat: xf.quat }; });
    const rot = (axis: V3, deg: number) => s.commitAsm((a) => { const t = a.occurrences.find((x) => x.id === id)!; t.xf = { pos: xf.pos, quat: q.norm(q.mul(q.axisAngle(axis, (deg * Math.PI) / 180), xf.quat)) }; });
    const r = s.asmResult?.parts[o.part];
    const doc = s.docData(o.part) as PartDoc | null;
    const dens = MATERIALS.find((x) => x.name === doc?.iProperties.material)?.density ?? 7850;
    return (
      <div className="psec">
        <div className="psec-title">{o.name}</div>
        <Row label="Pieza"><span className="ro">{s.docs.find((d) => d.id === o.part)?.fileName}</span></Row>
        {r?.props && <Row label="Masa"><span className="ro">{fmt(r.props.volume * 1e-9 * dens, 3)} kg</span></Row>}
        <div className="prow3"><span className="plabel">Posición</span>{[0, 1, 2].map((i) => <NumIn key={i} value={xf.pos[i]} onCommit={(v) => setPos(i, v)} disabled={o.grounded} />)}</div>
        <Row label="Girar 90°"><span className="pair">{(['X', 'Y', 'Z'] as const).map((k, i) => <button key={k} className="btn" disabled={o.grounded} onClick={() => rot([i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0], 90)}>{k}</button>)}</span></Row>
        <label className="check"><input type="checkbox" checked={!!o.grounded} onChange={() => s.commitAsm((a) => { const t = a.occurrences.find((x) => x.id === id)!; t.grounded = !t.grounded; })} />Fijo</label>
        <button className="btn wide" onClick={() => s.activate(o.part)}>Abrir pieza</button>
      </div>
    );
  }
  if (m) {
    const res = s.asmResult?.members.find((x) => x.id === id);
    return (
      <div className="psec">
        <div className="psec-title">{m.name}</div>
        <ProfileSelect family={m.family} size={m.size} onChange={(f, z) => upM({ family: f, size: z, name: `${profileLabel(f, z)}` })} />
        <Row label="Material"><select value={m.material} onChange={(e) => upM({ material: e.target.value })}>{MATERIALS.slice(0, 6).map((x) => <option key={x.name}>{x.name}</option>)}</select></Row>
        <Row label="Giro"><Expr value={m.rot} unit="deg" onCommit={(v) => upM({ rot: v })} /></Row>
        <Row label="Desfase X"><Expr value={m.offX} onCommit={(v) => upM({ offX: v })} /></Row>
        <Row label="Desfase Y"><Expr value={m.offY} onCommit={(v) => upM({ offY: v })} /></Row>
        <label className="check"><input type="checkbox" checked={!!m.mirror} onChange={(e) => upM({ mirror: e.target.checked })} />Simetría del perfil</label>
        {res && <Row label="Long. corte"><span className="ro strong">{fmt(res.length, 1)} mm</span></Row>}
        {res && <Row label="Cortes"><span className="ro">{res.cutAngles.map((a) => (a > 0.05 ? `${fmt(a, 1)}°` : 'recto')).join(' / ')}</span></Row>}
        {m.ends.map((e, i) => <Row key={i} label={`Extremo ${i + 1}`}><span className="ro">{e.type === 'none' ? 'Recto' : e.type === 'miter' ? 'Inglete' : 'Recortado'}{e.other ? ` · ${s.asm.frames.find((x) => x.id === e.other)?.name ?? ''}` : ''}</span></Row>)}
        <Err text={errs[m.id]} />
      </div>
    );
  }
  if (w) {
    const res = s.asmResult?.welds.find((x) => x.id === id);
    return (
      <div className="psec">
        <div className="psec-title">{w.name}</div>
        <Row label="Garganta a"><Expr value={w.throat} onCommit={(v) => s.commitAsm((a) => { a.welds.find((x) => x.id === id)!.throat = v; })} /></Row>
        <Row label="Proceso"><span className="ro">{w.process}</span></Row>
        {res && <Row label="Longitud"><span className="ro">{fmt(res.length, 1)} mm</span></Row>}
        {res && <Row label="Aporte"><span className="ro">{fmt(res.area * res.length * 7850e-9, 3)} kg</span></Row>}
        <Err text={errs[w.id]} />
      </div>
    );
  }
  if (b) {
    return (
      <div className="psec">
        <div className="psec-title">{b.name}</div>
        <Row label="Tornillos"><span className="ro">{b.size} {b.grade}</span></Row>
        <Err text={errs[b.id]} />
        <button className="btn wide" onClick={() => asmActions.openBolt(b.id)}>Editar y calcular</button>
      </div>
    );
  }
  return null;
}

function NumIn({ value, onCommit, disabled }: { value: number; onCommit: (v: number) => void; disabled?: boolean }) {
  const [t, setT] = useState(fmt(value, 3));
  useEffect(() => setT(fmt(value, 3)), [value]);
  const commit = () => { const v = Number(t.replace(',', '.')); if (isFinite(v) && v !== value) onCommit(v); };
  return <input className="num-in" value={t} disabled={disabled} onChange={(e) => setT(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); e.stopPropagation(); }} />;
}

function AsmSummary() {
  const s = useStore();
  const rows = bomRows(s, s.asm);
  const mass = rows.reduce((a, r) => a + r.mass * (r.kind === 'part' ? r.qty : 1), 0);
  const r = s.asmResult;
  return (
    <div className="psec">
      <div className="psec-title">{s.asm.iProperties.partNumber}</div>
      <Row label="Componentes"><span className="ro">{s.asm.occurrences.length}</span></Row>
      <Row label="Barras"><span className="ro">{s.asm.frames.length}</span></Row>
      <Row label="Cordones"><span className="ro">{s.asm.welds.length}</span></Row>
      <Row label="Tornillos"><span className="ro">{r?.bolts.reduce((a, x) => a + x.count, 0) ?? 0}</span></Row>
      <Row label="Masa total"><span className="ro strong">{fmt(mass, 2)} kg</span></Row>
      {r && Object.keys(r.errors).length > 0 && <Err text={`${Object.keys(r.errors).length} elemento(s) con error; pasa el ratón por el icono rojo del navegador`} />}
      {!s.asm.occurrences.length && !s.asm.frames.length && <p className="phelp">Ensamblaje vacío. <b>Colocar</b> inserta piezas abiertas; <b>Diseño › Insertar perfil</b> crea estructura sobre líneas de esqueleto (<b>Ensamblar › Línea 3D</b>).</p>}
    </div>
  );
}

function PresentPanel() {
  const s = useStore();
  const id = s.selItem;
  const e = (id && s.asm.explode[id]) || [0, 0, 0];
  const set = (i: number, v: number) => s.commitAsm((a) => { const c: V3 = [...(a.explode[id!] ?? [0, 0, 0])] as V3; c[i] = v; a.explode[id!] = c; });
  return (
    <div className="psec">
      <div className="psec-title">Presentación</div>
      <Row label="Explosión"><input type="range" min={0} max={1} step={0.01} value={s.explodeT} onChange={(ev) => s.set({ explodeT: Number(ev.target.value) })} /></Row>
      {id ? (<>
        <div className="plabel">Desplazamiento de la selección (mm)</div>
        <div className="prow3"><span className="plabel">X Y Z</span>{[0, 1, 2].map((i) => <NumIn key={i} value={e[i]} onCommit={(v) => set(i, v)} />)}</div>
      </>) : <p className="phelp">Selecciona un componente o una barra para ajustar su trayectoria de explosión.</p>}
      <button className="btn wide" onClick={() => asmActions.animate()}><Icon name="play" size={16} />Reproducir</button>
    </div>
  );
}

// =================== PLANO ===================
function DrwPanel() {
  const s = useStore();
  const d = s.drw;
  const v = d.views.find((x) => x.id === s.selItem);
  const dim = d.dims.find((x) => x.id === s.selItem);
  const note = d.notes.find((x) => x.id === s.selItem);
  const ann = (d.anns ?? []).find((x) => x.id === s.selItem);
  const upV = (p: Record<string, unknown>) => s.commitDrw((dd) => {
    const t = dd.views.find((x) => x.id === v!.id)!; Object.assign(t, p);
    if ('scale' in p) for (const c of dd.views) if (c.parent === t.id && c.kind !== 'detail') c.scale = t.scale;
    if ('scale' in p && !t.parent) dd.title.scale = scaleLabel(t.scale);
  });
  const upA = (p: Record<string, unknown>) => s.commitDrw((dd) => { Object.assign((dd.anns ?? []).find((x) => x.id === ann!.id)!, p); });
  const t = d.title;
  const ANN: Record<string, string> = { balloon: 'Globo', leader: 'Nota con directriz', surface: 'Acabado superficial', weld: 'Símbolo de soldadura', centerline: 'Línea de centro', centermark: 'Marca de centro', hole: 'Nota de taladro' };
  return (<>
    {v && (
      <div className="psec">
        <div className="psec-title">{v.kind === 'section' ? `Sección ${v.label}-${v.label}` : v.kind === 'detail' ? `Detalle ${v.label}` : v.name}</div>
        <Row label="Origen"><span className="ro">{s.docs.find((x) => x.id === v.source)?.fileName ?? 'no abierto'}</span></Row>
        {(!v.kind || v.kind === 'base' || v.kind === 'proj' || v.kind === 'iso') && <Row label="Orientación"><select value={v.dir} onChange={(e) => upV({ dir: e.target.value, name: VIEW_NAMES[e.target.value as ViewDir] })}>{Object.entries(VIEW_NAMES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Row>}
        <Row label="Escala"><select value={v.scale} onChange={(e) => upV({ scale: Number(e.target.value) })} disabled={!!v.parent && v.kind !== 'detail'}>{SCALES.map((x) => <option key={x} value={x}>{scaleLabel(x)}</option>)}</select></Row>
        {v.kind === 'detail' && v.detail && <Row label="Radio zona"><input type="number" value={v.detail.r} onChange={(e) => upV({ detail: { ...v.detail!, r: Math.max(2, Number(e.target.value)) } })} /></Row>}
        <label className="check"><input type="checkbox" checked={v.hidden} onChange={(e) => upV({ hidden: e.target.checked })} />Aristas ocultas</label>
        <label className="check"><input type="checkbox" checked={!!v.centers} onChange={(e) => upV({ centers: e.target.checked })} />Marcas de centro automáticas</label>
        {v.kind === 'section' && <button className="btn wide" onClick={drwActions.flipSection}>Invertir dirección de la sección</button>}
        <button className="btn danger wide" onClick={() => s.commitDrw((dd) => { const gone = new Set([v.id, ...dd.views.filter((x) => x.parent === v.id).map((x) => x.id)]); dd.views = dd.views.filter((x) => !gone.has(x.id)); dd.dims = dd.dims.filter((x) => !gone.has(x.view)); })}><Icon name="trash" size={16} />Eliminar vista</button>
      </div>
    )}
    {dim && (
      <div className="psec">
        <div className="psec-title">Cota {dim.kind === 'd' ? 'de diámetro' : dim.kind === 'r' ? 'de radio' : dim.kind === 'ang' ? 'angular' : 'lineal'}</div>
        <Row label="Texto"><input value={dim.text ?? ''} placeholder="automático" onChange={(e) => s.commitDrw((dd) => { dd.dims.find((x) => x.id === dim.id)!.text = e.target.value || undefined; })} onKeyDown={(e) => e.stopPropagation()} /></Row>
        <Row label="Tolerancia"><select value={TOLS.includes(dim.tol ?? '') ? dim.tol ?? '' : '*'} onChange={(e) => s.commitDrw((dd) => { dd.dims.find((x) => x.id === dim.id)!.tol = e.target.value === '*' ? '±0.1' : e.target.value || undefined; })}>
          {TOLS.map((x) => <option key={x} value={x}>{x || 'Sin tolerancia'}</option>)}<option value="*">Otra…</option>
        </select></Row>
        {!TOLS.includes(dim.tol ?? '') && <Row label="Valor tol."><input value={dim.tol ?? ''} onChange={(e) => s.commitDrw((dd) => { dd.dims.find((x) => x.id === dim.id)!.tol = e.target.value || undefined; })} onKeyDown={(e) => e.stopPropagation()} /></Row>}
        {(dim.kind === 'h' || dim.kind === 'v' || dim.kind === 'a') && <Row label="Tipo"><Seg value={dim.kind} onChange={(k) => s.commitDrw((dd) => { dd.dims.find((x) => x.id === dim.id)!.kind = k; })} options={[['h', 'Horizontal'], ['v', 'Vertical'], ['a', 'Alineada']]} /></Row>}
        {(dim.kind === 'd' || dim.kind === 'r') && <Row label="Tipo"><Seg value={dim.kind} onChange={(k) => s.commitDrw((dd) => { dd.dims.find((x) => x.id === dim.id)!.kind = k; })} options={[['d', 'Diámetro'], ['r', 'Radio']]} /></Row>}
        <button className="btn danger wide" onClick={() => s.commitDrw((dd) => { dd.dims = dd.dims.filter((x) => x.id !== dim.id); })}><Icon name="trash" size={16} />Eliminar cota</button>
      </div>
    )}
    {ann && (
      <div className="psec">
        <div className="psec-title">{ANN[ann.kind]}</div>
        {ann.kind !== 'centerline' && ann.kind !== 'centermark' && <Row label={ann.kind === 'balloon' ? 'Posición' : ann.kind === 'surface' ? 'Rugosidad' : ann.kind === 'weld' ? 'Garganta' : 'Texto'}>
          <input value={ann.text ?? ''} onChange={(e) => upA({ text: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        </Row>}
        {ann.kind === 'weld' && (<>
          <Row label="Lado"><Seg value={ann.side ?? 'arrow'} onChange={(k) => upA({ side: k })} options={[['arrow', 'Flecha'], ['other', 'Otro'], ['both', 'Ambos']]} /></Row>
          <label className="check"><input type="checkbox" checked={!!ann.allAround} onChange={(e) => upA({ allAround: e.target.checked })} />Todo alrededor</label>
        </>)}
        {ann.kind === 'surface' && <Seg value={ann.text ?? ''} onChange={(k) => upA({ text: k })} options={[['Ra 0,8', '0,8'], ['Ra 1,6', '1,6'], ['Ra 3,2', '3,2'], ['Ra 6,3', '6,3'], ['Ra 12,5', '12,5']] as any} />}
        <button className="btn danger wide" onClick={() => s.commitDrw((dd) => { dd.anns = (dd.anns ?? []).filter((x) => x.id !== ann.id); })}><Icon name="trash" size={16} />Eliminar</button>
      </div>
    )}
    {note && (
      <div className="psec">
        <div className="psec-title">Nota</div>
        <textarea className="note-in" value={note.text} onChange={(e) => s.commitDrw((dd) => { dd.notes.find((x) => x.id === note.id)!.text = e.target.value; })} onKeyDown={(e) => e.stopPropagation()} />
        <Row label="Altura"><Seg value={String(note.size)} onChange={(k) => s.commitDrw((dd) => { dd.notes.find((x) => x.id === note.id)!.size = Number(k); })} options={[['2.5', '2,5'], ['3.5', '3,5'], ['5', '5'], ['7', '7']]} /></Row>
        <button className="btn danger wide" onClick={() => s.commitDrw((dd) => { dd.notes = dd.notes.filter((x) => x.id !== note.id); })}><Icon name="trash" size={16} />Eliminar nota</button>
      </div>
    )}
    <div className="psec">
      <div className="psec-title">Cajetín</div>
      {([['title', 'Título'], ['partNumber', 'Nº de plano'], ['material', 'Material'], ['company', 'Empresa'], ['designer', 'Dibujado'], ['checker', 'Revisado'], ['date', 'Fecha'], ['revision', 'Revisión'], ['scale', 'Escala']] as const).map(([k, l]) => (
        <Row key={k} label={l}><input value={t[k]} onChange={(e) => s.commitDrw((dd) => { dd.title[k] = e.target.value; })} onKeyDown={(e) => e.stopPropagation()} /></Row>
      ))}
    </div>
  </>);
}
const TOLS = ['', '±0.05', '±0.1', '±0.2', '±0.5', '+0.1/0', '0/-0.1', 'H7', 'h6', 'g6', 'js7'];

export function PropertyPanel() {
  const s = useStore();
  const sk = activeSketch(s);
  const dk = s.dialog?.kind;
  let body: ReactNode = null;
  if (s.kind === 'part') body = s.dialog && 'draft' in s.dialog ? <FeatureDialog /> : dk === 'skop' ? <SkOpDialog /> : s.mode === 'sketch' && sk ? <SketchPanel sk={sk} /> : <PartSummary />;
  else if (s.kind === 'assembly') {
    body = dk === 'joint' ? <JointDialog /> : dk === 'skel' ? <SkelDialog /> : dk === 'frame' ? <FrameDialog /> : dk === 'endtreat' ? <EndDialog /> : dk === 'weld' ? <WeldDialog /> : dk === 'bolt' ? <BoltDialog />
      : (<>{s.mode === 'present' && <PresentPanel />}<SelectionPanel /><AsmSummary /></>);
  } else body = <DrwPanel />;
  return (
    <aside className="props">
      <div className="br-head"><span>Propiedades</span></div>
      <div className="props-body">{body}</div>
    </aside>
  );
}

// =================== MODALES ===================
function Modal({ title, onClose, children, wide, xwide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; xwide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-shade" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''} ${xwide ? 'xwide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head"><span>{title}</span><button className="x" onClick={onClose} aria-label="Cerrar"><Icon name="close" size={18} /></button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function ParamsDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [rows, setRows] = useState(() => s.doc.parameters.map((p) => ({ ...p })));
  const { values, errors } = resolveParams(rows);
  const dup = (n: string) => rows.filter((r) => r.name === n).length > 1;
  const bad = rows.some((r) => !isValidName(r.name) || dup(r.name) || errors[r.name]);
  const set = (i: number, k: 'name' | 'expr' | 'comment', v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const add = () => { let n = rows.length + 1; while (rows.some((r) => r.name === `d${n}`)) n++; setRows([...rows, { name: `d${n}`, expr: '10 mm', comment: '' }]); };
  return (
    <Modal title="Parámetros" onClose={onClose} wide>
      <table className="ptable">
        <thead><tr><th>Nombre</th><th>Expresión</th><th>Valor</th><th>Comentario</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const nameBad = !isValidName(r.name) || dup(r.name);
            return (
              <tr key={i}>
                <td><input className={nameBad ? 'bad' : ''} value={r.name} onChange={(e) => set(i, 'name', e.target.value)} /></td>
                <td><input className={errors[r.name] ? 'bad' : ''} value={r.expr} onChange={(e) => set(i, 'expr', e.target.value)} title={errors[r.name] ?? ''} spellCheck={false} /></td>
                <td className="num">{errors[r.name] ? <span className="errtxt">{errors[r.name]}</span> : fmt(values[r.name] ?? NaN, 4)}</td>
                <td><input value={r.comment ?? ''} onChange={(e) => set(i, 'comment', e.target.value)} /></td>
                <td><button className="btn icon" title="Eliminar" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="trash" size={15} /></button></td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={5} className="empty">Sin parámetros de usuario. Úsalos en cualquier cota: <code>L/2</code>, <code>2*e + 5 mm</code>.</td></tr>}
        </tbody>
      </table>
      <p className="phelp">Unidades: mm, cm, m, in, deg, rad. Funciones: sin, cos, tan (grados), sqrt, abs, min, max, round. Constante PI.</p>
      <div className="modal-btns">
        <button className="btn" onClick={add}>Añadir parámetro</button><span className="grow" />
        <button className="btn primary" disabled={bad} onClick={() => { s.commit((d) => { d.parameters = rows; }); onClose(); }}>Aceptar</button>
        <button className="btn" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}

function IPropsDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const src = s.kind === 'part' ? s.doc.iProperties : s.kind === 'assembly' ? s.asm.iProperties : null;
  const [ip, setIp] = useState(() => ({ ...(src ?? { partNumber: '', description: '', designer: '', material: '', revision: '' }) }));
  const p = s.kind === 'part' ? s.result?.props : null;
  const dens = MATERIALS.find((m) => m.name === ip.material)?.density ?? 1000;
  if (!src) return <Modal title="iProperties" onClose={onClose}><p className="phelp">Los datos del plano se editan en el cajetín (panel de propiedades).</p></Modal>;
  const field = (k: keyof typeof ip, label: string) => <Row label={label}><input value={ip[k]} onChange={(e) => setIp({ ...ip, [k]: e.target.value })} /></Row>;
  return (
    <Modal title={`iProperties — ${s.fileName}`} onClose={onClose}>
      <div className="two">
        <div>
          <div className="psec-title">Proyecto</div>
          {field('partNumber', 'Nº de pieza')}{field('description', 'Descripción')}{field('revision', 'Revisión')}{field('designer', 'Diseñador')}
          {s.kind === 'part' && <Row label="Material"><select value={ip.material} onChange={(e) => setIp({ ...ip, material: e.target.value })}>{MATERIALS.map((m) => <option key={m.name}>{m.name}</option>)}</select></Row>}
        </div>
        <div>
          <div className="psec-title">Físicas</div>
          {p ? (<>
            <Row label="Densidad"><span className="ro">{dens} kg/m³</span></Row>
            <Row label="Masa"><span className="ro strong">{fmt(p.volume * 1e-9 * dens, 4)} kg</span></Row>
            <Row label="Volumen"><span className="ro">{fmt(p.volume, 1)} mm³</span></Row>
            <Row label="Área"><span className="ro">{fmt(p.area, 1)} mm²</span></Row>
            {(['X', 'Y', 'Z'] as const).map((a, i) => <Row key={a} label={`CdG ${a}`}><span className="ro mono">{fmt(p.cog[i], 3)} mm</span></Row>)}
          </>) : <p className="phelp">{s.kind === 'assembly' ? 'La masa del ensamblaje está en la lista de materiales.' : 'Sin sólido.'}</p>}
        </div>
      </div>
      <div className="modal-btns"><span className="grow" />
        <button className="btn primary" onClick={() => { if (s.kind === 'part') s.commit((d) => { d.iProperties = ip; }); else s.commitAsm((d) => { d.iProperties = ip; }); onClose(); }}>Aceptar</button>
        <button className="btn" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}

function ProjectDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const p = s.project;
  return (
    <Modal title="Proyectos" onClose={onClose} wide>
      {p ? (<>
        <div className="proj-head"><Icon name="project" size={26} /><div><b>{p.name}</b><div className="muted">{p.fileName}</div></div></div>
        <table className="ptable kv"><tbody>{p.entries.map((e, i) => <tr key={i}><td>{e.label}</td><td className="mono">{e.value}</td></tr>)}</tbody></table>
      </>) : <p className="phelp">No hay proyecto activo. Abre un <code>.ipj</code> de Inventor para ver su espacio de trabajo y librerías, o crea uno nuevo compatible.</p>}
      <div className="modal-btns">
        <button className="btn" onClick={() => openFile()}>Abrir .ipj…</button>
        <button className="btn" onClick={() => newIpj('Proyecto')}>Crear .ipj nuevo</button><span className="grow" />
        <button className="btn primary" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}

function FileInfoDialog({ title, info, onClose }: { title: string; info: import('../core/store').FileInfo; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  return (
    <Modal title={title} onClose={onClose} wide={!info.svg} xwide={!!info.svg}>
      {info.svg ? (
        <div className="dwg-view" onWheel={(e) => setZoom((z) => Math.max(0.2, Math.min(20, z * (e.deltaY > 0 ? 0.87 : 1.15))))}>
          <div className="dwg-inner" style={{ transform: `scale(${zoom})` }} dangerouslySetInnerHTML={{ __html: info.svg }} />
        </div>
      ) : (
        <div className="fi-head">
          {info.thumbnail ? <img className="fi-thumb" src={info.thumbnail} alt="Miniatura" /> : <div className="fi-thumb none"><Icon name="part" size={40} /></div>}
          <div><div className="fi-name">{info.fileName}</div><div className="muted">{info.kind}</div><p className="fi-msg">{info.message}</p></div>
        </div>
      )}
      {!!info.props?.length && <table className="ptable kv"><tbody>{info.props.map((p, i) => <tr key={i}><td>{p.label}</td><td>{p.value}</td></tr>)}</tbody></table>}
      {!!info.streams?.length && (
        <details className="fi-streams"><summary>Contenido del contenedor OLE ({info.streams.length} flujos)</summary>
          <div className="mono small">{info.streams.map((x) => x.replace(/[\u0000-\u001f]/g, '·')).join('\n')}</div>
        </details>
      )}
      <div className="modal-btns">{info.svg && <span className="phelp">Rueda del ratón: zoom</span>}<span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}

function PlaceDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const parts = s.docs.filter((d) => d.kind === 'part');
  return (
    <Modal title="Colocar componente" onClose={onClose}>
      <div className="place-list">
        {parts.map((p) => (
          <button key={p.id} className="place-item" onClick={() => { asmActions.placePart(p.id); onClose(); }}>
            <Icon name={(s.docData(p.id) as PartDoc).sheet ? 'sheetmetal' : 'part'} size={24} />
            <span><b>{p.fileName}</b><span className="muted">{(s.docData(p.id) as PartDoc).iProperties.description || (s.docData(p.id) as PartDoc).iProperties.material}</span></span>
          </button>
        ))}
        {!parts.length && <p className="phelp">No hay piezas abiertas.</p>}
      </div>
      <div className="modal-btns">
        <button className="btn" onClick={() => { onClose(); openFile(); }}>Abrir pieza o STEP…</button>
        <button className="btn" onClick={() => { onClose(); asmActions.createPart(); }}>Crear pieza nueva</button>
        <button className="btn" onClick={() => s.open({ kind: 'content' })}>Centro de contenido…</button><span className="grow" />
        <button className="btn" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}

function ContentDialog({ onClose }: { onClose: () => void }) {
  const [fam, setFam] = useState(CONTENT[0].id);
  const F = CONTENT.find((f) => f.id === fam)!;
  const [size, setSize] = useState(F.sizes[2] ?? F.sizes[0]);
  const lens = F.lengths?.(size) ?? [];
  const [len, setLen] = useState(lens[Math.floor(lens.length / 3)] ?? 0);
  useEffect(() => { const sz = F.sizes.includes(size) ? size : F.sizes[Math.min(2, F.sizes.length - 1)]; setSize(sz); const l = F.lengths?.(sz) ?? []; if (l.length && !l.includes(len)) setLen(l[Math.floor(l.length / 3)]); }, [fam]);
  const cats = [...new Set(CONTENT.map((c) => c.category))];
  return (
    <Modal title="Centro de contenido" onClose={onClose} wide>
      <div className="cc">
        <div className="cc-tree">
          {cats.map((c) => (<div key={c}><div className="cc-cat">{c}</div>{CONTENT.filter((x) => x.category === c).map((x) => (
            <button key={x.id} className={`cc-item ${x.id === fam ? 'on' : ''}`} onClick={() => setFam(x.id)}><b>{x.std}</b><span>{x.name}</span></button>
          ))}</div>))}
        </div>
        <div className="cc-form">
          <div className="psec-title">{F.name} · {F.std}</div>
          <Row label="Tamaño"><select value={size} onChange={(e) => setSize(e.target.value)}>{F.sizes.map((z) => <option key={z}>{z}</option>)}</select></Row>
          {lens.length > 0 && <Row label="Longitud"><select value={len} onChange={(e) => setLen(Number(e.target.value))}>{lens.map((l) => <option key={l} value={l}>{l} mm</option>)}</select></Row>}
          <p className="phelp">Se crea una pieza paramétrica normalizada (con sus iProperties y rosca cosmética) y se coloca en el ensamblaje. Después se restringe con Insertar o Coincidir.</p>
          <div className="modal-btns"><span className="grow" /><button className="btn" onClick={onClose}>Cancelar</button>
            <button className="btn primary" onClick={() => { asmActions.placeContent(F.id, size, len); onClose(); }}>Colocar</button></div>
        </div>
      </div>
    </Modal>
  );
}

function CompPatternDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const occ = s.asm.occurrences.find((o) => o.id === s.selItem);
  const [kind, setKind] = useState<'rect' | 'circ'>('rect');
  const [dir, setDir] = useState<'X' | 'Y' | 'Z'>('X');
  const [n, setN] = useState('3'); const [d, setD] = useState('50 mm');
  const [dir2, setDir2] = useState<'' | 'X' | 'Y' | 'Z'>(''); const [n2, setN2] = useState('2'); const [d2, setD2] = useState('50 mm');
  const [count, setCount] = useState('6'); const [ang, setAng] = useState('360 deg');
  return (
    <Modal title="Patrón de componentes" onClose={onClose}>
      {!occ ? <p className="phelp">Selecciona antes un componente en el visor o en el navegador.</p> : (<>
        <Row label="Componente"><span className="ro">{occ.name}</span></Row>
        <Row label="Tipo"><Seg value={kind} onChange={setKind} options={[['rect', 'Rectangular'], ['circ', 'Circular']]} /></Row>
        {kind === 'rect' ? (<>
          <Row label="Dirección 1"><Seg value={dir} onChange={setDir} options={[['X', 'X'], ['Y', 'Y'], ['Z', 'Z']]} /></Row>
          <Row label="Cantidad"><Expr value={n} unit="ul" onCommit={setN} /></Row><Row label="Separación"><Expr value={d} onCommit={setD} /></Row>
          <Row label="Dirección 2"><Seg value={dir2} onChange={setDir2} options={[['', '—'], ['X', 'X'], ['Y', 'Y'], ['Z', 'Z']]} /></Row>
          {dir2 && (<><Row label="Cantidad"><Expr value={n2} unit="ul" onCommit={setN2} /></Row><Row label="Separación"><Expr value={d2} onCommit={setD2} /></Row></>)}
        </>) : (<>
          <Row label="Eje (origen)"><Seg value={dir} onChange={setDir} options={[['X', 'X'], ['Y', 'Y'], ['Z', 'Z']]} /></Row>
          <Row label="Cantidad"><Expr value={count} unit="ul" onCommit={setCount} /></Row><Row label="Ángulo total"><Expr value={ang} unit="deg" onCommit={setAng} /></Row>
        </>)}
      </>)}
      <div className="modal-btns"><span className="grow" /><button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!occ} onClick={() => { asmActions.patternComponent(occ!.id, kind === 'rect' ? { kind, dir, n, d, dir2, n2, d2 } : { kind, dir, count, angle: ang }); onClose(); }}>Aceptar</button></div>
    </Modal>
  );
}

function InterfDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [busy, setBusy] = useState(true);
  useEffect(() => { asmActions.interference().finally(() => setBusy(false)); }, []);
  const name = (id: string) => s.asm.occurrences.find((o) => o.id === id)?.name ?? s.asm.frames.find((f) => f.id === id)?.name ?? id;
  const list = s.interf ?? [];
  return (
    <Modal title="Análisis de interferencias" onClose={() => { onClose(); }} wide>
      {busy ? <p className="phelp">Calculando intersecciones entre todos los componentes…</p> : !list.length ? <p className="ok-msg">No se han encontrado interferencias.</p> : (
        <table className="ptable"><thead><tr><th>#</th><th>Componente 1</th><th>Componente 2</th><th>Volumen</th></tr></thead>
          <tbody>{list.map((x, i) => <tr key={i}><td>{i + 1}</td><td>{name(x.a)}</td><td>{name(x.b)}</td><td>{fmt(x.volume, 2)} mm³</td></tr>)}</tbody></table>
      )}
      {!busy && list.length > 0 && <p className="phelp">Las zonas de interferencia se muestran en rojo en el visor hasta cerrar este cuadro.</p>}
      <div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={() => { s.set({ interf: null }); onClose(); }}>Cerrar</button></div>
    </Modal>
  );
}

function SpaceMouseDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [st, setSt] = useState(getSmSettings());
  const up = (p: Partial<SmSettings>) => { const n = { ...st, ...p }; setSt(n); setSmSettings(n); };
  return (
    <Modal title="Ratón 3D (3Dconnexion)" onClose={onClose}>
      <Row label="Estado"><span className={`ro ${s.spaceMouse ? 'strong' : ''}`}>{s.spaceMouse ? `${s.spaceMouse} conectado` : 'Sin conectar'}</span></Row>
      {!webHidAvailable() && <Err text="Este navegador no admite WebHID. Usa Chrome o Edge de escritorio (en Firefox se detecta como mando si el sistema lo expone)." />}
      <Row label="Velocidad"><input type="range" min={0.2} max={3} step={0.1} value={st.speed} onChange={(e) => up({ speed: Number(e.target.value) })} /><span className="ro" style={{ marginLeft: 8 }}>{st.speed.toFixed(1)}×</span></Row>
      <label className="check"><input type="checkbox" checked={st.invT} onChange={(e) => up({ invT: e.target.checked })} />Invertir encuadre (X, Y)</label>
      <label className="check"><input type="checkbox" checked={st.invZoom} onChange={(e) => up({ invZoom: e.target.checked })} />Invertir zoom</label>
      <label className="check"><input type="checkbox" checked={st.invR} onChange={(e) => up({ invR: e.target.checked })} />Invertir giros</label>
      <label className="check"><input type="checkbox" checked={st.lockRot} onChange={(e) => up({ lockRot: e.target.checked })} />Bloquear giros (solo encuadre y zoom)</label>
      <label className="check"><input type="checkbox" checked={st.lockPan} onChange={(e) => up({ lockPan: e.target.checked })} />Bloquear encuadre (solo giros y zoom)</label>
      <p className="phelp">Modo objeto, como Inventor: el modelo sigue a la tapa. Botón izquierdo: vista de inicio · botón derecho: ajustar. Funciona con 3DxWare instalado; si no responde, cierra otras aplicaciones que usen el ratón 3D en el navegador. En la vista previa incrustada el navegador puede bloquear el acceso: abre la web directamente.</p>
      <div className="modal-btns"><span className="grow" />
        <button className="btn primary" onClick={() => connectSpaceMouse()}>{s.spaceMouse ? 'Cambiar dispositivo…' : 'Conectar…'}</button>
        <button className="btn" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}

function BomDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const rows = bomRows(s, s.asm);
  const total = rows.reduce((a, r) => a + r.mass * (r.kind === 'part' ? r.qty : 1), 0);
  const cut = rows.filter((r) => r.kind === 'member');
  return (
    <Modal title={`Lista de materiales — ${s.asm.iProperties.partNumber}`} onClose={onClose} xwide>
      <table className="ptable bom">
        <thead><tr><th>Pos.</th><th>Cant.</th><th>Nº de pieza / designación</th><th>Descripción</th><th>Material</th><th className="num">Masa (kg)</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i} className={`k-${r.kind}`}><td>{i + 1}</td><td>{r.qty}</td><td>{r.pn}</td><td>{r.desc}</td><td>{r.material}</td><td className="num">{r.mass ? fmt(r.kind === 'part' ? r.mass * r.qty : r.mass, 2) : ''}</td></tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={5}>Total</td><td className="num"><b>{fmt(total, 2)}</b></td></tr></tfoot>
      </table>
      {cut.length > 0 && <p className="phelp">Barras de estructura: {cut.reduce((a, r) => a + r.qty, 0)} cortes · {fmt(cut.reduce((a, r) => a + (r.length ?? 0) * r.qty, 0) / 1000, 2)} m de perfil.</p>}
      <div className="modal-btns"><span className="grow" />
        <button className="btn" onClick={() => saveText('﻿' + bomCsv(rows), `${s.asm.iProperties.partNumber}-LM.csv`, 'CSV', '.csv', 'text/csv')}>Exportar CSV</button>
        <button className="btn primary" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}

function SheetStyleDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [st, setSt] = useState(() => ({ ...(s.doc.sheet ?? { t: '2 mm', r: '2 mm', k: '0.44' }) }));
  return (
    <Modal title="Estilo de chapa" onClose={onClose}>
      <Row label="Espesor t"><Expr value={st.t} live onCommit={(v) => setSt({ ...st, t: v })} /></Row>
      <Row label="Radio plegado"><Expr value={st.r} live onCommit={(v) => setSt({ ...st, r: v })} /></Row>
      <Row label="Factor K"><Expr value={st.k} unit="ul" live onCommit={(v) => setSt({ ...st, k: v })} /></Row>
      <p className="phelp">Desarrollo con tolerancia de pliegue BA = θ·(R + K·t). Valores típicos de K: 0,33 (R &lt; t) a 0,50 (R &gt; 3t).</p>
      <div className="modal-btns"><span className="grow" />
        <button className="btn primary" onClick={() => { s.commit((d) => { d.sheet = st; }); onClose(); }}>Aceptar</button><button className="btn" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}

function FlatDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [res, setRes] = useState<FlatResult | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { cad.flat(s.doc).then(setRes).catch((e) => setErr((e as Error).message)); }, [s.doc]);
  const polys: P2[][] = res ? res.paths.flatMap((d) => flattenPath(d)) : [];
  const bb = bboxOf(polys);
  const pad = 10, W = bb[2] - bb[0] + pad * 2, H = bb[3] - bb[1] + pad * 2;
  const tr = (p: P2) => `${(p[0] - bb[0] + pad).toFixed(2)},${(bb[3] - p[1] + pad).toFixed(2)}`;
  const exportDxf = () => {
    if (!res) return;
    const doc = { layers: [{ name: 'CORTE', color: 7 }, { name: 'PLIEGUE', color: 1, ltype: 'CENTER' as const }, { name: 'TEXTO', color: 3 }],
      lines: [...polys.map((pts) => ({ layer: 'CORTE', pts })), ...res.bends.map((b) => ({ layer: 'PLIEGUE', pts: [b.a, b.b] as P2[] }))],
      texts: res.bends.map((b) => ({ layer: 'TEXTO', x: (b.a[0] + b.b[0]) / 2, y: (b.a[1] + b.b[1]) / 2 + 2, h: 3, text: b.label })) };
    saveText(writeDxf(doc), s.fileName.replace(/\.[^.]+$/, '-desarrollo.dxf'), 'DXF', '.dxf', 'application/dxf');
  };
  return (
    <Modal title="Desarrollo de chapa" onClose={onClose} xwide>
      {err ? <Err text={err} /> : !res ? <p className="phelp">Calculando…</p> : (<>
        <div className="flat-view">
          <svg viewBox={`0 0 ${W} ${H}`}>
            {polys.map((p, i) => <polyline key={i} points={p.map(tr).join(' ')} className="ln-vis" />)}
            {res.bends.map((b, i) => <g key={i}><polyline points={`${tr(b.a)} ${tr(b.b)}`} className="ln-bend" /><text x={(b.a[0] + b.b[0]) / 2 - bb[0] + pad} y={bb[3] - (b.a[1] + b.b[1]) / 2 + pad - 2} className="bend-label">{b.label}</text></g>)}
          </svg>
        </div>
        <p className="phelp">Dimensiones del desarrollo: {fmt(bb[2] - bb[0], 1)} × {fmt(bb[3] - bb[1], 1)} mm · t = {res.t} · R = {res.r} · K = {res.k} · {res.bends.length} pliegue(s).</p>
      </>)}
      <div className="modal-btns"><span className="grow" /><button className="btn" disabled={!res} onClick={exportDxf}>Exportar DXF</button><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}

function NewDocDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const go = (k: Parameters<typeof s.newDocument>[0]) => { onClose(); s.newDocument(k); };
  const T = ({ icon, name, desc, k }: { icon: string; name: string; desc: string; k: Parameters<typeof s.newDocument>[0] }) => (
    <button className="tpl" onClick={() => go(k)}><Icon name={icon} size={40} /><b>{name}</b><span>{desc}</span></button>
  );
  return (
    <Modal title="Crear archivo nuevo" onClose={onClose} wide>
      <div className="tpl-sec">Pieza — crear objetos 2D y 3D</div>
      <div className="tpl-row"><T icon="part" name="Normal (mm).i3p" desc="Pieza sólida" k="part" /><T icon="sheetmetal" name="Chapa (mm).i3p" desc="Chapa con pestañas y desarrollo" k="sheet" /></div>
      <div className="tpl-sec">Ensamblaje — ensamblar componentes 2D y 3D</div>
      <div className="tpl-row"><T icon="assembly" name="Normal (mm).i3a" desc="Componentes, uniones, estructura, tornillería" k="assembly" /><T icon="weldment" name="Soldadura (ISO).i3a" desc="Construcción soldada" k="weldment" /></div>
      <div className="tpl-sec">Dibujo — crear un documento anotado</div>
      <div className="tpl-row"><T icon="drawing" name="ISO A3.i3d" desc="Plano con cajetín y proyección europea" k="drawing" /></div>
      <p className="phelp">La presentación (explosionado y animación) es un modo del ensamblaje: pestaña Presentación.</p>
    </Modal>
  );
}

function DrwViewDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const sources = s.docs.filter((d) => d.kind !== 'drawing');
  const [src, setSrc] = useState(sources[sources.length - 1]?.id ?? '');
  const [dir, setDir] = useState<ViewDir>('front');
  const [scale, setScale] = useState(1);
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const d = s.docData(src) as any;
    if (!d) return;
    if (d.format === 'inv3d.assembly') setScale(0.1);
  }, [src]);
  return (
    <Modal title="Vista base" onClose={onClose}>
      <Row label="Documento"><select value={src} onChange={(e) => setSrc(e.target.value)}>{sources.map((d) => <option key={d.id} value={d.id}>{d.fileName}</option>)}</select></Row>
      <Row label="Orientación"><select value={dir} onChange={(e) => setDir(e.target.value as ViewDir)}>{Object.entries(VIEW_NAMES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Row>
      <Row label="Escala"><select value={scale} onChange={(e) => setScale(Number(e.target.value))}>{SCALES.map((x) => <option key={x} value={x}>{scaleLabel(x)}</option>)}</select></Row>
      <label className="check"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />Aristas ocultas</label>
      {!sources.length && <Err text="Abre o crea primero una pieza o un ensamblaje" />}
      <div className="modal-btns"><span className="grow" />
        <button className="btn primary" disabled={!src} onClick={() => drwActions.placeBase(src, dir, scale, hidden)}>Colocar</button><button className="btn" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}

function ILogicDialog({ onClose }: { onClose: () => void }) {
  const copy = () => { navigator.clipboard?.writeText(ILOGIC_RULE).catch(() => {}); useStore.getState().notify('Regla copiada al portapapeles'); };
  return (
    <Modal title="Exportar un proyecto de Inventor a STEP y DWG" onClose={onClose} xwide>
      <ol className="howto">
        <li>En Inventor, abre cualquier documento del proyecto y ve a <b>Administrar › iLogic › Agregar regla</b> (o crea una regla externa en el <b>Explorador de iLogic</b>).</li>
        <li>Pega la regla y ejecútala. Recorre el espacio de trabajo del proyecto activo (.ipj) y crea <code>_EXPORT_INV3D</code> con un .stp por pieza y ensamblaje y un .dwg por plano.</li>
        <li>Abre los .stp en INV3D (los ensamblajes se convierten en componentes) y los .dwg con el visor.</li>
      </ol>
      <pre className="code">{ILOGIC_RULE}</pre>
      <div className="modal-btns"><span className="grow" />
        <button className="btn" onClick={() => saveText(ILOGIC_RULE, 'ExportarProyecto_INV3D.iLogicVb', 'Regla iLogic', '.txt', 'text/plain')}>Guardar regla</button>
        <button className="btn" onClick={copy}>Copiar</button><button className="btn primary" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['S', 'Iniciar boceto 2D'], ['L · C · A · R · P · T', 'Línea, círculo, arco, rectángulo, polígono, texto (en boceto)'], ['D · X', 'Cota y recortar (en boceto)'], ['F8', 'Mostrar u ocultar restricciones'],
  ['Arrastrar', 'En boceto: mueve puntos y curvas respetando las restricciones'], ['Ctrl+clic', 'Selección múltiple en boceto'], ['E · R · H · F', 'Extrusión, revolución, agujero, empalme'],
  ['Esc', 'Cancelar herramienta / terminar boceto'], ['Supr', 'Eliminar selección'], ['Ctrl+Z / Ctrl+Y', 'Deshacer / Rehacer'], ['Ctrl+S · Ctrl+O · Ctrl+N', 'Guardar, abrir, nuevo'],
  ['F6 · Inicio', 'Vista de inicio, ajustar'], ['Ensamblaje: P · J', 'Colocar, restringir'], ['Plano: D', 'Cota'], ['Ratón', 'Izq.: órbita · Central: encuadre · Rueda: zoom · Doble clic en componente: abrir pieza'],
];

export function Modals() {
  const s = useStore();
  const d = s.dialog;
  const close = () => s.set({ dialog: null });
  if (!d || 'draft' in d) return null;
  switch (d.kind) {
    case 'params': return <ParamsDialog onClose={close} />;
    case 'iprops': return <IPropsDialog onClose={close} />;
    case 'project': return <ProjectDialog onClose={close} />;
    case 'fileinfo': return <FileInfoDialog title={d.title} info={d.info} onClose={close} />;
    case 'place': return <PlaceDialog onClose={close} />;
    case 'content': return <ContentDialog onClose={close} />;
    case 'cpattern': return <CompPatternDialog onClose={close} />;
    case 'spacemouse': return <SpaceMouseDialog onClose={close} />;
    case 'interf': return <InterfDialog onClose={() => s.set({ dialog: null, interf: null })} />;
    case 'bom': return <BomDialog onClose={close} />;
    case 'sheetstyle': return <SheetStyleDialog onClose={close} />;
    case 'flat': return <FlatDialog onClose={close} />;
    case 'newdoc': return <NewDocDialog onClose={close} />;
    case 'drwview': return <DrwViewDialog onClose={close} />;
    case 'ilogic': return <ILogicDialog onClose={close} />;
    case 'shortcuts': return <Modal title="Atajos de teclado y ratón" onClose={close}><table className="ptable kv"><tbody>{SHORTCUTS.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table></Modal>;
    default: return (
      <Modal title="Acerca de INV3D" onClose={close}>
        <p><b>INV3D 0.3</b> · CAD paramétrico libre en el navegador, con el flujo de trabajo de Inventor.</p>
        <p className="phelp">Boceto con restricciones geométricas y cotas, pieza y chapa, ensamblaje con restricciones (solver simultáneo), Centro de contenido, estructura (perfiles EN), soldadura (ISO 2553), tornillería (ISO, cálculo EN 1993-1-8), planos con secciones y detalles (ISO, proyección europea) y presentación.</p>
        <p className="phelp">Núcleo OpenCascade (LGPL) vía replicad · visor Three.js · visor DWG LibreDWG (GPL-3.0).</p>
        <div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={close}>Cerrar</button></div>
      </Modal>
    );
  }
}

export type { AsmDoc };
