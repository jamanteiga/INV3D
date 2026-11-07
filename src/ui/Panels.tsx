import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore, activeSketch } from '../core/store';
import { evaluate, resolveParams, makeEval, fmt, isValidName } from '../core/expr';
import {
  docParams, ENTITY_NAMES, OP_NAMES, MATERIALS, planeLabel, FEATURE_NAMES, BODY_FEATURES, SURFACE_FEATURES, v3, uid, type S3Entity, type E3, type Sketch3dF,
  type Feature, type SkEntity, type SketchF, type BoolOp, type EdgeMode, type E2, type PartDoc, type V3, type StdPlane, type PlaneRef,
  type IProps,
} from '../core/doc';
import { PROFILES, profileLabel, BOLTS, BOLT_GRADES, boltLength } from '../core/catalog';
import { checkBolts } from '../core/ec3';
import { CONSTRAINT_NAMES, CONSTRAINT_GLYPH, transformEntities, offsetEntity, refLine, refPoint, makeConstraint, num } from '../core/sketch';
import { weldFromFaces, q, type AsmDoc, type Joint } from '../core/asm';
import { SCALES, scaleLabel, VIEW_NAMES, type ViewDir } from '../core/drawing';
import { Icon } from './icons';
import { openFile, newIpj, saveText, pickFile } from '../core/files';
import { cad, type FlatResult } from '../core/cadClient';
import { flattenPath, bboxOf, type P2 } from '../core/svgpath';
import { writeDxf } from '../core/dxf';
import { asmActions, drwActions } from './actions';
import { bomRows, bomCsv } from './bom';
import { ILOGIC_RULE } from './ilogic';
import { CONTENT } from '../core/content';
import { JOINT_NAMES, JOINT_DOF, MOTION_NAMES, motionBase } from '../core/asm';
import { viewModelDims, viewGeom } from './DrawingView';
import { makePipePart, flangeDims, od, wallOf, PIPE_KINDS, ASME_SIZES, type PipeKind, type PipeSpec, type FlangeStd } from '../core/piping';
import { ASME_PIPE, EN_OD, EN_DN, EN_S, enWalls, enSizes, b165Sizes, B1647_TABLES, B165_CLASSES, EN_PN, EN_TYPES, B169, B1611, FITTING_NPS, REDUCER_H, reducedOptions, NPS_DN, DN_NPS, PIPE_MATERIALS } from '../core/pipedata';
import { ipartCandidates, currentValue, applyIPartRow, extractIFeature, ifParams, insertIFeature, type IPartTable, type IFeatureDef } from '../core/ifeature';
import type { ModelDim } from '../core/retrieve';
import { folderApi, openFromFolder, exportConfig, importConfig } from './session';
import { listFolder, type FolderEntry } from '../core/persist';
import { GDT_NAMES, GDT_DATUM, SHEETS, drawStyle, type DrawStyle, type DrawingDoc } from '../core/drawing';
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
  rib: 'rib', coil: 'coil', split: 'split', draft: 'draft', thicken: 'thicken', thread: 'thread', workaxis: 'axis', workpoint: 'point',
  surf_extrude: 'surfext', surf_revolve: 'surfrev', surf_loft: 'surfloft', surf_patch: 'patch', stitch: 'stitch', sm_loft: 'smloft', sketch3d: 'sketch3d',
  combine: 'combine', movebody: 'move', derive: 'derive', pathpattern: 'pathpattern', sm_contour: 'smcontour', sm_punch: 'punch' };

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
  const sk3 = s.doc.features.filter((x) => x.type === 'sketch3d');
  const surfs = s.doc.features.filter((x) => (SURFACE_FEATURES as readonly string[]).includes(x.type) || x.type === 'stitch');
  const skSel = (val: string, key: string, list: { id: string; name: string }[] = closedSks) => (
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
        <Row label="Origen"><select value={f.surface ?? ''} onChange={(e) => up({ surface: e.target.value || undefined })}><option value="">Caras del sólido</option>{surfs.map((x) => <option key={x.id} value={x.id}>Superficie: {x.name}</option>)}</select></Row>
        {!f.surface && <div className="pick-info"><b>{f.faces.length}</b> cara(s){f.faces.length > 0 && <button className="link" onClick={() => up({ faces: [] })}>Borrar</button>}. Distancia negativa: hacia dentro.</div>}
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
      {f.type === 'combine' && (<>
        <Row label="Operación"><Seg value={f.op} onChange={(v) => up({ op: v })} options={[['join', 'Unir'], ['cut', 'Cortar'], ['intersect', 'Intersección']]} /></Row>
        <div className="pick-info">{f.faces.length === 0 ? 'Clic en una cara del cuerpo base' : f.faces.length === 1 ? 'Base elegida · clic en caras de los cuerpos herramienta' : <><b>{f.faces.length - 1}</b> cuerpo(s) herramienta</>}{f.faces.length > 0 && <button className="link" onClick={() => up({ faces: [] })}>Borrar</button>}</div>
        <label className="check"><input type="checkbox" checked={f.keep} onChange={(e) => up({ keep: e.target.checked })} />Conservar herramientas</label>
        <p className="phelp">Los cuerpos se crean con la operación «Nuevo sólido» en extrusión, revolución, etc.</p>
      </>)}
      {f.type === 'movebody' && (<>
        <div className="pick-info">{f.faces.length ? <><b>{f.faces.length}</b> cuerpo(s) elegido(s)</> : 'Todos los cuerpos (o clic en una cara para elegir)'}{f.faces.length > 0 && <button className="link" onClick={() => up({ faces: [] })}>Borrar</button>}</div>
        <div className="prow3"><span className="plabel">Desplazar</span><Expr value={f.dx} live onCommit={(v) => up({ dx: v })} /><Expr value={f.dy} live onCommit={(v) => up({ dy: v })} /><Expr value={f.dz} live onCommit={(v) => up({ dz: v })} /></div>
        <Row label="Girar eje"><Seg value={f.axis} onChange={(v) => up({ axis: v })} options={[['X', 'X'], ['Y', 'Y'], ['Z', 'Z']]} /></Row>
        <Row label="Ángulo"><Expr value={f.angle} unit="deg" live onCommit={(v) => up({ angle: v })} /></Row>
        <label className="check"><input type="checkbox" checked={f.copy} onChange={(e) => up({ copy: e.target.checked })} />Copiar (conservar el original)</label>
      </>)}
      {f.type === 'derive' && (() => {
        const parts = s.docs.filter((x) => x.kind === 'part' && x.id !== s.active);
        return (<>
          <Row label="Pieza origen"><select value={f.source} onChange={(e) => { const sd = s.docData(e.target.value) as PartDoc | null; up({ source: e.target.value, sourceName: s.docs.find((x) => x.id === e.target.value)?.fileName ?? '', doc: sd ? structuredClone(sd) : null }); }}>
            <option value="">—</option>{parts.map((x) => <option key={x.id} value={x.id}>{x.fileName}</option>)}
          </select></Row>
          {!parts.length && <Err text="Abre antes la pieza de origen en otra pestaña" />}
          <Row label="Escala"><Expr value={f.scale} unit="ul" live onCommit={(v) => up({ scale: v })} /></Row>
          <Row label="Simetría"><Seg value={f.mirror} onChange={(v) => up({ mirror: v })} options={[['', 'No'], ['YZ', 'YZ'], ['XZ', 'XZ'], ['XY', 'XY']]} /></Row>
          <Row label="Operación">{opSeg(f.op)}</Row>
          <p className="phelp">Copia la geometría de la pieza origen en este momento. Para actualizarla, edita la operación y vuelve a elegir la pieza.</p>
        </>);
      })()}
      {f.type === 'pathpattern' && (<>
        <div className="plabel">Operaciones a repetir</div>{featPick(f.features)}
        <Row label="Trayectoria">{skSel(f.path, 'path', [...sketches.filter((x) => x.entities.some((e) => e.type === 'line' || e.type === 'arc' || e.type === 'spline')), ...sk3])}</Row>
        <Row label="Cantidad"><Expr value={f.count} unit="ul" live onCommit={(v) => up({ count: v })} /></Row>
        <label className="check"><input type="checkbox" checked={f.align} onChange={(e) => up({ align: e.target.checked })} />Orientar según la trayectoria</label>
      </>)}
      {f.type === 'sm_contour' && (<>
        <Row label="Perfil">{skSel(f.profile, 'profile', sketches.filter((x) => x.entities.some((e) => e.type === 'line' && !e.construction)))}</Row>
        <Row label="Anchura"><Expr value={f.width} live autoFocus onCommit={(v) => up({ width: v })} /></Row>
        <Row label="Dirección"><Seg value={f.dir} onChange={(v) => up({ dir: v })} options={[['normal', 'Normal'], ['reverse', 'Inversa'], ['symmetric', 'Simétrica']]} /></Row>
        <Row label="Material"><Seg value={f.side} onChange={(v) => up({ side: v })} options={[['in', 'Izquierda'], ['out', 'Derecha']]} /></Row>
        <p className="phelp">Cadena abierta de líneas: los pliegues se redondean con el radio y el espesor del estilo de chapa.</p>
      </>)}
      {f.type === 'sm_punch' && (<>
        <Row label="Centros">{skSel(f.sketch, 'sketch', sketches.filter((x) => x.entities.some((e) => e.type === 'point')))}</Row>
        <Row label="Forma"><Seg value={f.shape} onChange={(v) => up({ shape: v })} options={[['round', 'Redondo'], ['square', 'Cuadrado'], ['rect', 'Rectángulo'], ['slot', 'Coliso']]} /></Row>
        {f.shape === 'round' && <Row label="Diámetro"><Expr value={f.d} live onCommit={(v) => up({ d: v })} /></Row>}
        {f.shape !== 'round' && <Row label={f.shape === 'slot' ? 'Longitud' : 'Ancho'}><Expr value={f.w} live onCommit={(v) => up({ w: v })} /></Row>}
        {(f.shape === 'rect' || f.shape === 'slot') && <Row label={f.shape === 'slot' ? 'Anchura' : 'Alto'}><Expr value={f.h} live onCommit={(v) => up({ h: v })} /></Row>}
        {f.shape !== 'round' && <Row label="Giro"><Expr value={f.rot} unit="deg" live onCommit={(v) => up({ rot: v })} /></Row>}
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
        <Row label="Trayectoria">{skSel(f.path, 'path', [...sketches.filter((x) => x.entities.some((e) => e.type === 'line' || e.type === 'arc' || e.type === 'spline')), ...sk3])}</Row>
        <div className="pick-info">Trayectoria: líneas y arcos encadenados de otro boceto, empezando junto al perfil.</div>
        <Row label="Operación">{opSeg(f.op)}</Row>
      </>)}
      {f.type === 'surf_extrude' && (<>
        <Row label="Perfil">{skSel(f.profile, 'profile')}</Row>
        <Row label="Distancia"><Expr value={f.distance} live autoFocus onCommit={(v) => up({ distance: v })} /></Row>
        <Row label="Dirección"><Seg value={f.dir} onChange={(v) => up({ dir: v })} options={[['normal', 'Normal'], ['reverse', 'Inversa'], ['symmetric', 'Simétrica']]} /></Row>
        <div className="pick-info">Crea una superficie (sin espesor) a partir del perfil, abierto o cerrado.</div>
      </>)}
      {f.type === 'surf_revolve' && (<>
        <Row label="Perfil">{skSel(f.profile, 'profile')}</Row>
        <Row label="Eje"><select value={f.axis} onChange={(e) => up({ axis: e.target.value })}>
          <option value="sx">Eje X del boceto</option><option value="sy">Eje Y del boceto</option>
          {(sketches.find((k) => k.id === f.profile)?.entities ?? []).filter((e) => e.type === 'line').map((e, i) => <option key={e.id} value={e.id}>Línea {i + 1}{e.construction ? ' (construcción)' : ''}</option>)}
        </select></Row>
        <Row label="Ángulo"><Expr value={f.angle} unit="deg" live onCommit={(v) => up({ angle: v })} /></Row>
      </>)}
      {f.type === 'surf_loft' && (<>
        <div className="plabel">Secciones (en orden)</div>
        <div className="chips">
          {[...closedSks, ...sk3].map((k) => { const on = f.sections.includes(k.id); return <button key={k.id} className={`chip ${on ? 'on' : ''}`} onClick={() => up({ sections: on ? f.sections.filter((i) => i !== k.id) : [...f.sections, k.id] })}>{on ? `${f.sections.indexOf(k.id) + 1}. ` : ''}{k.name}</button>; })}
        </div>
        <label className="check"><input type="checkbox" checked={f.ruled} onChange={(e) => up({ ruled: e.target.checked })} />Reglada (superficie reglada entre aristas)</label>
      </>)}
      {f.type === 'surf_patch' && (<>
        <Row label="Contorno">{skSel(f.sketch, 'sketch', [...closedSks, ...sk3])}</Row>
        <div className="pick-info">Boceto 2D cerrado: parche plano. Boceto 3D cerrado: superficie de contorno (Boundary Patch).</div>
      </>)}
      {f.type === 'stitch' && (<>
        <div className="plabel">Superficies a coser</div>
        <div className="chips">
          {surfs.filter((x) => x.id !== f.id).map((k) => { const on = f.surfaces.includes(k.id); return <button key={k.id} className={`chip ${on ? 'on' : ''}`} onClick={() => up({ surfaces: on ? f.surfaces.filter((i) => i !== k.id) : [...f.surfaces, k.id] })}>{k.name}</button>; })}
        </div>
        <Row label="Operación">{opSeg(f.op)}</Row>
        <label className="check"><input type="checkbox" checked={!!f.keep} onChange={(e) => up({ keep: e.target.checked })} />Conservar las superficies</label>
        <div className="pick-info">Si cierran un volumen se convierte en sólido; si no, queda una superficie cosida.</div>
      </>)}
      {f.type === 'sm_loft' && (<>
        <Row label="Contorno 1">{skSel(f.a, 'a', [...closedSks, ...sk3])}</Row>
        <Row label="Contorno 2">{skSel(f.b, 'b', [...closedSks, ...sk3])}</Row>
        <Row label="Espesor hacia"><Seg value={f.side} onChange={(v) => up({ side: v })} options={[['in', 'Dentro'], ['out', 'Fuera']]} /></Row>
        <Row label="Segmentos (desarrollo)"><Expr value={f.segments} unit="ul" live onCommit={(v) => up({ segments: v })} /></Row>
        <div className="pick-info">Transiciones de conductos (rectangular a circular, reducciones…). Espesor {s.doc.sheet?.t}. El desarrollo se calcula por triangulación.</div>
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
    rot: 'Rotación: el origen es el centro de la cara o el eje del cilindro elegido; B gira alrededor del eje de A (bisagra, eje, rueda).',
    slider: 'Corredera: B se desplaza a lo largo del eje de A sin girar (guía, carro).',
    cyl: 'Cilíndrica: B gira y se desplaza a lo largo del eje de A (pistón, eje en casquillo).',
    planar: 'Planar: B se mueve apoyado en la cara de A (2 traslaciones + giro).',
    ball: 'Bola: los orígenes coinciden y B gira libremente (rótula).',
  };
  return (
    <div className="fdlg">
      <Head icon="constraint3d" name={j.name} onName={(v) => s.updateDraft({ name: v })} />
      <div className="jt-grid">
        {([['mate', 'Coincidir', 'constraint3d'], ['flush', 'Al ras', 'joint'], ['angle', 'Ángulo', 'angle3d'], ['tangent', 'Tangente', 'c_tangent'], ['insert', 'Insertar', 'insert3d'], ['rigid', 'Rígida', 'ground']] as const).map(([t, l, ic]) => (
          <button key={t} className={`jt ${j.type === t ? 'on' : ''}`} onClick={() => s.updateDraft({ type: t })}><Icon name={ic} size={20} />{l}</button>
        ))}
      </div>
      <div className="plabel">Uniones (origen + eje)</div>
      <div className="jt-grid">
        {([['rot', 'Rotación', 'rotate2d'], ['slider', 'Corredera', 'move'], ['cyl', 'Cilíndrica', 'insert3d'], ['planar', 'Planar', 'smface'], ['ball', 'Bola', 'circle']] as const).map(([t, l, ic]) => (
          <button key={t} className={`jt ${j.type === t ? 'on' : ''}`} onClick={() => s.updateDraft({ type: t })}><Icon name={ic} size={20} />{l}</button>
        ))}
      </div>
      {JOINT_DOF[j.type as keyof typeof JOINT_DOF] && <div className="pick-info">Movimiento libre: <b>{JOINT_DOF[j.type as keyof typeof JOINT_DOF]}</b></div>}
      <Steps current={d.step ?? 0} items={[[`A: ${j.a ? `${occName(j.a.occ)} · ${kindName(j.a)}` : 'elegir cara o eje'}`, !!j.a], [`B (se mueve): ${j.b ? `${occName(j.b.occ)} · ${kindName(j.b)}` : 'elegir cara o eje'}`, !!j.b]]} />
      {j.type !== 'angle' && j.type !== 'rot' && j.type !== 'ball' && j.type !== 'cyl' && <Row label="Desfase"><Expr value={j.offset} onCommit={(v) => s.updateDraft({ offset: v })} /></Row>}
      {(j.type === 'rot' || j.type === 'slider') && (<>
        <label className="check"><input type="checkbox" checked={!!j.lock} onChange={(e) => s.updateDraft({ lock: e.target.checked })} />Bloquear {j.type === 'rot' ? 'ángulo' : 'posición'}</label>
        {j.lock && j.type === 'rot' && <Row label="Ángulo"><Expr value={j.angle || '0 deg'} unit="deg" onCommit={(v) => s.updateDraft({ angle: v })} /></Row>}
        {j.lock && j.type === 'slider' && <Row label="Posición"><Expr value={j.offset || '0 mm'} onCommit={(v) => s.updateDraft({ offset: v })} /></Row>}
        {!j.lock && (<>
          <Row label="Límite mín."><input value={j.min ?? ''} placeholder={j.type === 'rot' ? 'p. ej. -90 deg' : 'p. ej. 0 mm'} onChange={(e) => s.updateDraft({ min: e.target.value || undefined })} onKeyDown={(e) => e.stopPropagation()} /></Row>
          <Row label="Límite máx."><input value={j.max ?? ''} placeholder={j.type === 'rot' ? 'p. ej. 90 deg' : 'p. ej. 100 mm'} onChange={(e) => s.updateDraft({ max: e.target.value || undefined })} onKeyDown={(e) => e.stopPropagation()} /></Row>
        </>)}
      </>)}
      {j.type === 'angle' && <Row label="Ángulo"><Expr value={j.angle} unit="deg" onCommit={(v) => s.updateDraft({ angle: v })} /></Row>}
      {j.type === 'insert' && <Row label="Solución"><Seg value={j.aligned ? 'al' : 'op'} onChange={(v) => s.updateDraft({ aligned: v === 'al' })} options={[['al', 'Alineada'], ['op', 'Opuesta']]} /></Row>}
      <p className="phelp">{help[j.type]}</p>
      <Btns okDisabled={!ok} onOk={() => {
        if (j.a.occ === j.b.occ) { s.notify('Elige geometría de dos componentes distintos', 'error'); return; }
        if (j.type === 'insert' && (j.a.kind !== 'axis' || j.b.kind !== 'axis')) { s.notify('Insertar necesita dos caras cilíndricas', 'error'); return; }
        if (j.type === 'tangent' && j.a.kind !== 'axis' && j.b.kind !== 'axis') { s.notify('Tangente necesita al menos una cara cilíndrica', 'error'); return; }
        if (j.type === 'flush' && (j.a.kind === 'axis' || j.b.kind === 'axis')) { s.notify('Al ras se aplica a caras planas', 'error'); return; }
        const joint: Joint = { id: j.id, name: j.name, type: j.type, a: j.a, b: j.b, offset: j.offset, angle: j.angle, aligned: j.type === 'insert' ? !!j.aligned : undefined, lock: j.lock || undefined, min: j.min || undefined, max: j.max || undefined };
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
  const tab = (d.tables ?? []).find((x) => x.id === s.selItem);
  const ANN: Record<string, string> = { fcf: 'Tolerancia geométrica', datum: 'Referencia (datum)', balloon: 'Globo', leader: 'Nota con directriz', surface: 'Acabado superficial', weld: 'Símbolo de soldadura', centerline: 'Línea de centro', centermark: 'Marca de centro', hole: 'Nota de taladro' };
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
        {(v.breaks?.length || v.crop) && <button className="btn wide" onClick={drwActions.clearBreaks}>Quitar roturas y recorte</button>}
        {v.breakout && (<>
          <Row label="Corte parcial"><input type="number" value={v.breakout.depth} onChange={(e) => s.commitDrw((dd) => { const t = dd.views.find((x) => x.id === v.id)!; t.breakout = { ...t.breakout!, depth: Number(e.target.value) }; })} /><span className="ro" style={{ marginLeft: 6 }}>mm de profundidad</span></Row>
          <button className="btn wide" onClick={() => s.commitDrw((dd) => { delete dd.views.find((x) => x.id === v.id)!.breakout; })}>Quitar corte parcial</button>
        </>)}
        {v.kind === 'flat' && <button className="btn wide" onClick={() => drwActions.addTable('bend')}>Tabla de pliegues</button>}
        <button className="btn danger wide" onClick={() => s.commitDrw((dd) => { const gone = new Set([v.id, ...dd.views.filter((x) => x.parent === v.id).map((x) => x.id)]); dd.views = dd.views.filter((x) => !gone.has(x.id)); dd.dims = dd.dims.filter((x) => !gone.has(x.view)); })}><Icon name="trash" size={16} />Eliminar vista</button>
      </div>
    )}
    {dim && (
      <div className="psec">
        {dim.ref && <div className={`pick-info ${dim.orphan ? 'err' : ''}`}>{dim.orphan ? 'La cota del modelo ya no existe' : 'Cota asociada al modelo'}{' '}<button className="btn" onClick={() => s.commitDrw((dd) => { const t = dd.dims.find((x) => x.id === dim.id); if (t) { delete t.ref; delete t.orphan; } })}>Desvincular</button></div>}
        <div className="psec-title">Cota {dim.kind === 'd' ? 'de diámetro' : dim.kind === 'r' ? 'de radio' : dim.kind === 'ang' ? 'angular' : dim.kind === 'ord' ? `por coordenadas (${dim.axis === 'y' ? 'Y' : 'X'})` : 'lineal'}</div>
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
        {ann.kind === 'fcf' && (<>
          <Row label="Característica"><select value={ann.sym ?? 'flat'} onChange={(e) => upA({ sym: e.target.value })}>{Object.entries(GDT_NAMES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Row>
          <label className="check"><input type="checkbox" checked={!!ann.dia} onChange={(e) => upA({ dia: e.target.checked })} />Zona cilíndrica (Ø)</label>
          {GDT_DATUM[ann.sym ?? 'flat'] && <Row label="Referencias"><input value={ann.datums ?? ''} placeholder="A|B|C" onChange={(e) => upA({ datums: e.target.value.toUpperCase() })} onKeyDown={(e) => e.stopPropagation()} /></Row>}
        </>)}
        {ann.kind !== 'centerline' && ann.kind !== 'centermark' && <Row label={ann.kind === 'balloon' ? 'Posición' : ann.kind === 'surface' ? 'Rugosidad' : ann.kind === 'weld' ? 'Garganta' : ann.kind === 'fcf' ? 'Tolerancia' : ann.kind === 'datum' ? 'Letra' : 'Texto'}>
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
    {tab && (
      <div className="psec">
        <div className="psec-title">{tab.kind === 'hole' ? 'Tabla de taladros' : tab.kind === 'bend' ? 'Tabla de pliegues' : 'Tabla de revisiones'}</div>
        {tab.kind === 'hole' && <Row label="Vista"><select value={tab.view} onChange={(e) => s.commitDrw((dd) => { dd.tables!.find((x) => x.id === tab.id)!.view = e.target.value; })}>{d.views.filter((x) => x.kind !== 'iso').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Row>}
        {tab.kind === 'hole' && <p className="phelp">Origen 0,0 en la esquina inferior izquierda de la vista. Las etiquetas A1, A2… se colocan junto a cada taladro.</p>}
        {tab.kind === 'rev' && (<>
          {(d.revisions ?? []).map((r, i) => (
            <div key={i} className="rev-row">
              {(['rev', 'desc', 'date', 'by'] as const).map((k) => <input key={k} className={`rev-${k}`} value={r[k]} placeholder={{ rev: 'Rev', desc: 'Descripción', date: 'Fecha', by: 'Aprobado' }[k]} onChange={(e) => s.commitDrw((dd) => { dd.revisions![i][k] = e.target.value; })} onKeyDown={(e) => e.stopPropagation()} />)}
              <button className="btn icon" onClick={() => s.commitDrw((dd) => { dd.revisions!.splice(i, 1); })}><Icon name="trash" size={14} /></button>
            </div>
          ))}
          <button className="btn wide" onClick={drwActions.addRevision}>Nueva revisión</button>
        </>)}
        <button className="btn danger wide" onClick={() => s.commitDrw((dd) => { dd.tables = (dd.tables ?? []).filter((x) => x.id !== tab.id); })}><Icon name="trash" size={16} />Eliminar tabla</button>
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
      {([['title', 'Título'], ['partNumber', 'Nº de plano'], ['material', 'Material'], ['company', 'Empresa'], ['project', 'Proyecto'], ['designer', 'Dibujado'], ['checker', 'Revisado'], ['approved', 'Aprobado'], ['approvedDate', 'Fecha aprob.'], ['date', 'Fecha'], ['revision', 'Revisión'], ['scale', 'Escala'], ['mass', 'Masa'], ['generalTol', 'Tol. generales'], ['finish', 'Acabado']] as const).map(([k, l]) => (
        <Row key={k} label={l}><input value={t[k] ?? ''} onChange={(e) => s.commitDrw((dd) => { dd.title[k] = e.target.value; })} onKeyDown={(e) => e.stopPropagation()} /></Row>
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
  const [ip, setIp] = useState<IProps>(() => ({ ...(src ?? { partNumber: '', description: '', designer: '', material: '', revision: '' }) }));
  const [tab, setTab] = useState<'sum' | 'proj' | 'state' | 'custom' | 'phys'>('proj');
  const p = s.kind === 'part' ? s.result?.props : null;
  const dens = MATERIALS.find((m) => m.name === ip.material)?.density ?? 1000;
  if (!src) return <Modal title="iProperties" onClose={onClose}><p className="phelp">Los datos del plano se editan en el cajetín (panel de propiedades).</p></Modal>;
  type SK = Exclude<keyof IProps, 'custom' | 'status'>;
  const field = (k: SK, label: string, ph?: string) => <Row label={label}><input value={(ip[k] as string) ?? ''} placeholder={ph} onChange={(e) => setIp({ ...ip, [k]: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></Row>;
  const custom = ip.custom ?? [];
  const setCustom = (c: { name: string; value: string }[]) => setIp({ ...ip, custom: c });
  return (
    <Modal title={`iProperties — ${s.fileName}`} onClose={onClose} wide>
      <div style={{ marginBottom: 10 }}><Seg value={tab} onChange={setTab} options={[['sum', 'Resumen'], ['proj', 'Proyecto'], ['state', 'Estado'], ['custom', 'Personalizadas'], ['phys', 'Físicas']]} /></div>
      {tab === 'sum' && (<>{field('title', 'Título')}{field('subject', 'Asunto')}{field('author', 'Autor')}{field('manager', 'Responsable')}{field('company', 'Empresa')}{field('keywords', 'Palabras clave')}{field('comments', 'Comentarios')}</>)}
      {tab === 'proj' && (<>
        {field('partNumber', 'Nº de pieza')}{field('description', 'Descripción')}{field('revision', 'Revisión')}{field('project', 'Proyecto')}{field('designer', 'Diseñador')}
        {field('stockNumber', 'Nº de almacén')}{field('vendor', 'Proveedor')}{field('costCenter', 'Centro de coste')}{field('finish', 'Acabado', 'p. ej. Galvanizado en caliente')}{field('webLink', 'Vínculo web')}
        {s.kind === 'part' && <Row label="Material"><select value={ip.material} onChange={(e) => setIp({ ...ip, material: e.target.value })}>{MATERIALS.map((m) => <option key={m.name}>{m.name}</option>)}</select></Row>}
      </>)}
      {tab === 'state' && (<>
        <Row label="Estado"><select value={ip.status ?? 'En curso'} onChange={(e) => setIp({ ...ip, status: e.target.value as IProps['status'] })}>{['En curso', 'Revisión', 'Aprobado', 'Obsoleto'].map((x) => <option key={x}>{x}</option>)}</select></Row>
        {field('checkedBy', 'Revisado por')}{field('checkedDate', 'Fecha revisión')}{field('approvedBy', 'Aprobado por')}{field('approvedDate', 'Fecha aprobación')}
        <p className="phelp">Al colocar la pieza en un plano, el cajetín toma Proyecto, Descripción, Acabado y Aprobado.</p>
      </>)}
      {tab === 'custom' && (<>
        {custom.map((c, i) => (
          <div key={i} className="vr-row">
            <input placeholder="Nombre" value={c.name} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} onKeyDown={(e) => e.stopPropagation()} />
            <input placeholder="Valor" value={c.value} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} onKeyDown={(e) => e.stopPropagation()} />
            <button className="btn icon" onClick={() => setCustom(custom.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button>
          </div>
        ))}
        <button className="btn" onClick={() => setCustom([...custom, { name: '', value: '' }])}>Añadir propiedad</button>
      </>)}
      {tab === 'phys' && (p ? (<>
        <Row label="Densidad"><span className="ro">{dens} kg/m³</span></Row>
        <Row label="Masa"><span className="ro strong">{fmt(p.volume * 1e-9 * dens, 4)} kg</span></Row>
        <Row label="Volumen"><span className="ro">{fmt(p.volume, 1)} mm³</span></Row>
        <Row label="Área"><span className="ro">{fmt(p.area, 1)} mm²</span></Row>
        {(['X', 'Y', 'Z'] as const).map((a, i) => <Row key={a} label={`CdG ${a}`}><span className="ro mono">{fmt(p.cog[i], 3)} mm</span></Row>)}
      </>) : <p className="phelp">{s.kind === 'assembly' ? 'La masa del ensamblaje está en la lista de materiales.' : 'Sin sólido.'}</p>)}
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

function OptionsDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [tab, setTab] = useState<'gen' | 'folder' | 'libs' | 'drw'>('gen');
  const st = s.settings;
  const setS = (p: Partial<typeof st>) => useStore.setState({ settings: { ...st, ...p } });
  const mats = s.libs.materials;
  const setM = (m: typeof mats) => useStore.setState({ libs: { ...s.libs, materials: m } });
  const txt = (k: 'userName' | 'company', label: string) => <Row label={label}><input value={st[k]} onChange={(e) => setS({ [k]: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></Row>;
  return (
    <Modal title="Opciones de la aplicación" onClose={onClose} wide>
      <div style={{ marginBottom: 10 }}><Seg value={tab} onChange={setTab} options={[['gen', 'General'], ['folder', 'Carpeta y sesión'], ['libs', 'Bibliotecas'], ['drw', 'Dibujo']]} /></div>
      {tab === 'gen' && (<>
        {txt('userName', 'Usuario (diseñador)')}{txt('company', 'Empresa')}
        <Row label="Material por defecto"><select value={st.defaultMaterial} onChange={(e) => setS({ defaultMaterial: e.target.value })}>{MATERIALS.map((m) => <option key={m.name}>{m.name}</option>)}</select></Row>
        <label className="check"><input type="checkbox" checked={st.showEdges} onChange={(e) => { setS({ showEdges: e.target.checked }); s.set({ showEdges: e.target.checked }); }} />Mostrar aristas en el modelo</label>
        <p className="phelp">El usuario y la empresa rellenan el diseñador de las piezas nuevas y el cajetín de los planos.</p>
      </>)}
      {tab === 'folder' && (<>
        <label className="check"><input type="checkbox" checked={st.restoreSession} onChange={(e) => setS({ restoreSession: e.target.checked })} />Reabrir los documentos de la última sesión al entrar</label>
        <label className="check"><input type="checkbox" checked={st.autosave} onChange={(e) => setS({ autosave: e.target.checked })} />Autoguardar la sesión en el navegador (cada cambio)</label>
        <label className="check"><input type="checkbox" checked={st.autosaveFolder} disabled={s.folder.state !== 'granted'} onChange={(e) => setS({ autosaveFolder: e.target.checked })} />Autoguardar cada minuto en la carpeta los documentos ya guardados allí</label>
        <div className="psec-title" style={{ marginTop: 12 }}>Carpeta de trabajo</div>
        {!folderApi.supported() ? <p className="phelp">Este navegador o esta página no permiten acceder a carpetas locales. Abre INV3D directamente en Chrome o Edge (https://jamanteiga.github.io/INV3D/). La configuración se guarda igualmente en el navegador.</p> : (<>
          <Row label="Carpeta"><span className="ro strong">{s.folder.name || '— sin carpeta —'}</span>{s.folder.state === 'prompt' && <span className="ro" style={{ marginLeft: 6 }}>(pendiente de permiso)</span>}</Row>
          <div className="modal-btns">
            <button className="btn" onClick={folderApi.choose}>{s.folder.name ? 'Cambiar carpeta…' : 'Elegir carpeta…'}</button>
            {s.folder.state === 'prompt' && <button className="btn primary" onClick={folderApi.reconnect}>Reconectar</button>}
            {s.folder.name && <button className="btn" onClick={folderApi.forget}>Olvidar</button>}
          </div>
          <p className="phelp">Elige p. ej. C:\Users\jaman\Documents\PROYECTOS. INV3D la recuerda: al entrar basta un clic en «Reconectar». Ctrl+S guarda directamente en ella y la configuración se copia en <b>inv3d-config.json</b> dentro de la carpeta, así que si la carpeta está en OneDrive tendrás la misma configuración en otro PC.</p>
        </>)}
      </>)}
      {tab === 'libs' && (<>
        <div className="psec-title">Materiales propios</div>
        {mats.map((m, i) => (
          <div key={i} className="vr-row">
            <input placeholder="Nombre" value={m.name} onChange={(e) => setM(mats.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} onKeyDown={(e) => e.stopPropagation()} />
            <input type="number" title="Densidad kg/m³" style={{ width: 80, flex: 'none' }} value={m.density} onChange={(e) => setM(mats.map((x, j) => (j === i ? { ...x, density: Number(e.target.value) } : x)))} />
            <input type="color" style={{ width: 34, flex: 'none' }} value={m.color} onChange={(e) => setM(mats.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />
            <button className="btn icon" onClick={() => setM(mats.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button>
          </div>
        ))}
        <button className="btn" onClick={() => setM([...mats, { name: 'Material nuevo', density: 7850, color: '#b9bec6' }])}>Añadir material</button>
        <div className="psec-title" style={{ marginTop: 12 }}>Copiar la configuración</div>
        <div className="modal-btns">
          <button className="btn" onClick={() => saveText(exportConfig(), 'inv3d-config.json', 'Configuración INV3D', '.json', 'application/json')}>Exportar…</button>
          <button className="btn" onClick={async () => { const f = await pickFile('.json'); if (!f) return; try { importConfig(await f.text()); s.notify('Configuración importada'); } catch (e) { s.notify((e as Error).message, 'error'); } }}>Importar…</button>
        </div>
        <p className="phelp">Las plantillas propias se añadirán aquí.</p>
      </>)}
      {tab === 'drw' && (<>
        <Row label="Norma de dibujo"><select value={st.drawingStd} onChange={(e) => setS({ drawingStd: e.target.value as typeof st.drawingStd })}><option>ISO</option><option>DIN</option><option>ANSI</option></select></Row>
        <Row label="Hoja por defecto"><select value={st.sheetDefault} onChange={(e) => setS({ sheetDefault: e.target.value as typeof st.sheetDefault })}>{Object.keys(SHEETS).map((k) => <option key={k}>{k}</option>)}</select></Row>
        <p className="phelp">Se aplica a los planos nuevos. Cada plano se puede ajustar en Anotar › Estilos.</p>
      </>)}
      <div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}

function DrwStyleDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const d = s.drw, st = drawStyle(d);
  const up = (p: Partial<DrawStyle>) => s.commitDrw((dd) => { dd.style = { ...(dd.style ?? {}), ...p }; });
  const num = (k: keyof DrawStyle, label: string, step = 0.1) => <Row label={label}><input type="number" step={step} value={st[k] as number} onChange={(e) => up({ [k]: Number(e.target.value) })} /><span className="ro" style={{ marginLeft: 6 }}>mm</span></Row>;
  return (
    <Modal title="Gestor de estilos de dibujo" onClose={onClose} wide>
      <Row label="Norma"><select value={d.std ?? 'ISO'} onChange={(e) => s.commitDrw((dd) => { dd.std = e.target.value as DrawingDoc['std']; dd.style = {}; })}><option>ISO</option><option>DIN</option><option>ANSI</option></select>
        <button className="btn" style={{ marginLeft: 8 }} onClick={() => s.commitDrw((dd) => { dd.style = {}; })}>Restablecer</button></Row>
      <div className="two-col">
        <div>
          <div className="psec-title">Cotas</div>
          {num('dimTextH', 'Altura de texto')}
          <Row label="Terminación"><select value={st.arrow} onChange={(e) => up({ arrow: e.target.value as DrawStyle['arrow'] })}><option value="closed">Flecha llena</option><option value="open">Flecha abierta</option><option value="tick">Trazo oblicuo</option><option value="dot">Punto</option></select></Row>
          {num('arrowL', 'Largo de flecha')}{num('arrowW', 'Semiancho de flecha', 0.05)}
          {num('extGap', 'Separación de la línea auxiliar')}{num('extOver', 'Prolongación de la línea auxiliar')}
          <Row label="Unidades"><select value={st.units} onChange={(e) => up({ units: e.target.value as 'mm' | 'in' })}><option value="mm">mm</option><option value="in">pulgadas</option></select></Row>
          <Row label="Decimales"><input type="number" min={0} max={6} value={st.precision} onChange={(e) => up({ precision: Number(e.target.value) })} /></Row>
          <Row label="Separador"><select value={st.decSep} onChange={(e) => up({ decSep: e.target.value as ',' | '.' })}><option value=",">coma (12,5)</option><option value=".">punto (12.5)</option></select></Row>
          <label className="check"><input type="checkbox" checked={st.trailingZeros} onChange={(e) => up({ trailingZeros: e.target.checked })} />Ceros finales (12,50)</label>
        </div>
        <div>
          <div className="psec-title">Líneas y vistas</div>
          {num('thick', 'Línea gruesa (PDF)', 0.05)}{num('thin', 'Línea fina (PDF)', 0.05)}
          {num('hatchStep', 'Paso del rayado')}
          <Row label="Proyección"><select value={st.projection} onChange={(e) => up({ projection: e.target.value as 'first' | 'third' })}><option value="first">Primer diedro (europea)</option><option value="third">Tercer diedro (americana)</option></select></Row>
          <p className="phelp">La proyección decide qué vista se crea al proyectar a cada lado y el símbolo del cajetín. Las vistas ya colocadas no cambian.</p>
        </div>
      </div>
      <div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}

function RetrieveDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const v = s.drw.views.find((x) => x.id === s.selItem) ?? s.drw.views.find((x) => !x.parent);
  const list = useMemo(() => (v ? viewModelDims(s, s.drw, v) : []), [v?.id]);
  const have = (m: ModelDim) => s.drw.dims.some((d) => d.view === v?.id && d.ref && d.ref.sk === m.ref.sk && d.ref.con === m.ref.con && d.ref.feat === m.ref.feat && d.ref.ent === m.ref.ent);
  const [sel, setSel] = useState<Set<number>>(() => new Set(list.map((m, i) => (have(m) ? -1 : i)).filter((i) => i >= 0)));
  const create = () => {
    if (!v) return;
    const g = viewGeom(s, v); if (!g) return;
    let kh = 0, kv = 0, ka = 0;
    s.commitDrw((d) => {
      list.forEach((m, i) => {
        if (!sel.has(i)) return;
        let offset = 0;
        const A: [number, number] = [m.a[0] + v.x, m.a[1] + v.y], B: [number, number] = [m.b[0] + v.x, m.b[1] + v.y];
        if (m.kind === 'h') offset = g.rect[3] + 8 + 7 * kh++ - Math.max(A[1], B[1]);
        else if (m.kind === 'v') offset = g.rect[2] + 8 + 7 * kv++ - Math.max(A[0], B[0]);
        else if (m.kind === 'a') offset = 8 + 7 * ka++;
        d.dims.push({ id: uid('dm'), view: v.id, kind: m.kind, a: m.a, b: m.b, r: m.r, offset, ref: m.ref });
      });
    });
    s.notify(`${sel.size} cotas recuperadas`); onClose();
  };
  return (
    <Modal title={`Recuperar cotas del modelo${v ? ` — ${v.name}` : ''}`} onClose={onClose} wide>
      {!v ? <p className="phelp">Selecciona una vista.</p> : !list.length ? <p className="phelp">No hay cotas del modelo visibles en verdadera magnitud en esta vista. Las cotas de boceto aparecen en vistas paralelas al boceto; las de extrusión, en vistas laterales.</p> : (<>
        <div className="modal-btns"><button className="btn" onClick={() => setSel(new Set(list.map((_, i) => i)))}>Todas</button><button className="btn" onClick={() => setSel(new Set())}>Ninguna</button></div>
        <div className="folder-list">
          {list.map((m, i) => (
            <label key={i} className="folder-row"><input type="checkbox" checked={sel.has(i)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(i); else n.delete(i); setSel(n); }} />
              <span className="fr-path">{m.label}</span><span className="ro">{{ h: 'horizontal', v: 'vertical', a: 'alineada', d: 'diámetro', r: 'radio' }[m.kind as 'h'] ?? m.kind}{have(m) ? ' · ya está' : ''}</span></label>
          ))}
        </div>
        <p className="phelp">Las cotas recuperadas siguen al modelo: si cambias la pieza, se mueven y cambian de valor.</p>
      </>)}
      <div className="modal-btns"><span className="grow" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!sel.size} onClick={create}>Crear</button></div>
    </Modal>
  );
}

function FolderDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [files, setFiles] = useState<FolderEntry[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { if (s.folder.state === 'granted') listFolder().then(setFiles).catch(() => setFiles([])); }, [s.folder.state, s.folder.name]);
  const shown = (files ?? []).filter((f) => !q || f.path.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title={`Carpeta de trabajo${s.folder.name ? ` — ${s.folder.name}` : ''}`} onClose={onClose} wide>
      {!folderApi.supported() ? <p className="phelp">Abre INV3D directamente en Chrome o Edge para usar una carpeta local.</p>
        : s.folder.state === 'none' ? (<><p className="phelp">Elige la carpeta donde guardas tus proyectos. INV3D la recordará cada vez que entres.</p><div className="modal-btns"><button className="btn primary" onClick={folderApi.choose}>Elegir carpeta…</button></div></>)
        : s.folder.state === 'prompt' ? (<><p className="phelp">El navegador pide confirmar el acceso a <b>{s.folder.name}</b> en cada sesión.</p><div className="modal-btns"><button className="btn primary" onClick={folderApi.reconnect}>Reconectar {s.folder.name}</button><button className="btn" onClick={folderApi.choose}>Otra carpeta…</button></div></>)
        : (<>
          <div className="vr-row"><input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /><button className="btn" onClick={() => listFolder().then(setFiles)}>Actualizar</button><button className="btn" onClick={folderApi.choose}>Cambiar…</button></div>
          <div className="folder-list">
            {files === null ? <p className="phelp">Leyendo…</p> : !shown.length ? <p className="phelp">No hay ficheros CAD.</p> : shown.map((f) => (
              <button key={f.path} className="folder-row" onDoubleClick={() => { openFromFolder(f.path); onClose(); }} onClick={(e) => { if (e.detail === 1) (e.currentTarget as HTMLElement).focus(); }} onKeyDown={(e) => { if (e.key === 'Enter') { openFromFolder(f.path); onClose(); } }}>
                <Icon name={/\.i3a$|\.iam$/i.test(f.name) ? 'assembly' : /\.i3d$|\.idw$|\.dxf$|\.dwg$/i.test(f.name) ? 'drawing' : /\.ipj$/i.test(f.name) ? 'project' : 'part'} size={16} />
                <span className="fr-path">{f.path}</span><span className="ro">{(f.size / 1024).toFixed(0)} kB · {new Date(f.modified).toLocaleDateString('es-ES')}</span>
              </button>
            ))}
          </div>
          <p className="phelp">Doble clic para abrir. Ctrl+S guarda en esta carpeta.</p>
        </>)}
      <div className="modal-btns"><span className="grow" /><button className="btn" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}

function MotionDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [type, setType] = useState<'gear' | 'rack'>('gear');
  const rots = s.asm.joints.filter((j) => j.type === 'rot' || j.type === 'cyl');
  const seconds = s.asm.joints.filter((j) => (type === 'gear' ? j.type === 'rot' || j.type === 'cyl' : j.type === 'slider' || j.type === 'cyl'));
  const [j1, setJ1] = useState(rots[0]?.id ?? '');
  const [j2, setJ2] = useState('');
  const [ratio, setRatio] = useState('1');
  const [rev, setRev] = useState(false);
  const second = seconds.find((x) => x.id === j2 && x.id !== j1) ?? seconds.find((x) => x.id !== j1);
  const ok = () => {
    const J1 = s.asm.joints.find((x) => x.id === j1), J2 = second;
    if (!J1 || !J2) return;
    const ev = (x: string) => { try { return makeEval([])(x); } catch { return NaN; } };
    const k = (ev(ratio) || 1) * (rev ? -1 : 1);
    const xf = (id: string) => s.asm.occurrences.find((o) => o.id === id)!.xf;
    const base = motionBase(type, k, J1, J2, xf);
    s.commitAsm((a) => { (a.motions ??= []).push({ id: uid('mo'), name: `${MOTION_NAMES[type]}${(a.motions?.length ?? 0) + 1}`, type, j1: J1.id, j2: J2.id, ratio, reverse: rev || undefined, base }); });
    onClose();
  };
  return (
    <Modal title="Restricción de movimiento" onClose={onClose}>
      <Seg value={type} onChange={setType} options={[['gear', 'Rotación-rotación'], ['rack', 'Rotación-traslación']]} />
      {!rots.length ? <p className="phelp">Crea antes uniones de rotación (Ensamblar › Unión).</p> : (<>
        <Row label={type === 'gear' ? 'Unión 1 (motriz)' : 'Unión de giro'}><select value={j1} onChange={(e) => setJ1(e.target.value)}>{rots.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Row>
        <Row label={type === 'gear' ? 'Unión 2' : 'Unión corredera'}><select value={second?.id ?? ''} onChange={(e) => setJ2(e.target.value)}>{seconds.filter((x) => x.id !== j1).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Row>
        <Row label={type === 'gear' ? 'Relación (z1/z2)' : 'Avance por vuelta'}><input value={ratio} onChange={(e) => setRatio(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={type === 'gear' ? '20/40' : 'π·m·z, p. ej. 3.1416*2*20 mm'} /></Row>
        <label className="check"><input type="checkbox" checked={rev} onChange={(e) => setRev(e.target.checked)} />{type === 'gear' ? 'Sentido inverso (engranaje exterior)' : 'Sentido inverso'}</label>
        <p className="phelp">{type === 'gear' ? 'Giro 2 = relación × giro 1. Para dos ruedas dentadas exteriores usa z1/z2 y sentido inverso.' : 'Desplazamiento = avance × vueltas del piñón (π·m·z para una cremallera).'} Se mantiene la posición actual como origen. Prueba el mecanismo con Conducir.</p>
      </>)}
      <div className="modal-btns"><span className="grow" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!rots.length || !second} onClick={ok}>Aceptar</button></div>
    </Modal>
  );
}

function Sketch3dDialog({ id, onClose }: { id?: string; onClose: () => void }) {
  const s = useStore();
  const orig = id ? (s.doc.features.find((f) => f.id === id) as Sketch3dF | undefined) : undefined;
  const [ents, setEnts] = useState<S3Entity[]>(() => (orig ? JSON.parse(JSON.stringify(orig.entities)) : [{ id: uid('e'), type: 'line3', a: ['0', '0', '0'], b: ['0', '0', '100'] }]));
  const [name, setName] = useState(orig?.name ?? `Boceto3D${s.doc.features.filter((f) => f.type === 'sketch3d').length + 1}`);
  const last = (): E3 => { const e = ents[ents.length - 1]; if (!e) return ['0', '0', '0']; return e.type === 'line3' ? [...e.b] as E3 : e.type === 'spline3' ? [...e.pts[e.pts.length - 1]] as E3 : [...e.origin] as E3; };
  const upE = (i: number, p: Partial<S3Entity>) => setEnts(ents.map((e, j) => (j === i ? ({ ...e, ...p } as S3Entity) : e)));
  const pt = (val: E3, on: (v: E3) => void) => (
    <span className="xyz">{(['X', 'Y', 'Z'] as const).map((k, i) => <input key={k} title={k} value={val[i]} onChange={(e) => { const n = [...val] as E3; n[i] = e.target.value; on(n); }} onKeyDown={(e) => e.stopPropagation()} />)}</span>
  );
  const save = () => {
    s.commit((d) => {
      const f = id ? (d.features.find((x) => x.id === id) as Sketch3dF) : null;
      if (f) { f.entities = ents; f.name = name; }
      else d.features.push({ id: uid('f'), name, type: 'sketch3d', entities: ents });
    });
    onClose();
  };
  return (
    <Modal title={id ? `Editar ${name}` : 'Boceto 3D'} onClose={onClose} wide>
      <Row label="Nombre"><input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></Row>
      <p className="phelp">Coordenadas en mm respecto al origen de la pieza; admiten expresiones y parámetros (p. ej. <code>L/2</code>). Las entidades se encadenan en orden.</p>
      <div className="s3-list">
        {ents.map((e, i) => (
          <div key={e.id} className="s3-row">
            <b>{i + 1}. {e.type === 'line3' ? 'Línea' : e.type === 'spline3' ? 'Spline' : 'Hélice'}</b>
            {e.type === 'line3' && <>{pt(e.a, (v) => upE(i, { a: v }))}<span>→</span>{pt(e.b, (v) => upE(i, { b: v }))}</>}
            {e.type === 'spline3' && (<div className="s3-pts">
              {e.pts.map((q, k) => <div key={k}>{pt(q, (v) => upE(i, { pts: e.pts.map((x, j) => (j === k ? v : x)) }))}{e.pts.length > 2 && <button className="link" onClick={() => upE(i, { pts: e.pts.filter((_, j) => j !== k) })}>quitar</button>}</div>)}
              <button className="link" onClick={() => upE(i, { pts: [...e.pts, [...e.pts[e.pts.length - 1]] as E3] })}>+ punto</button>
            </div>)}
            {e.type === 'helix3' && (<>
              <span>Centro</span>{pt(e.origin, (v) => upE(i, { origin: v }))}
              <select value={e.axis} onChange={(ev) => upE(i, { axis: ev.target.value as 'X' })}><option>X</option><option>Y</option><option>Z</option></select>
              {(['radius', 'pitch', 'height'] as const).map((k) => <label key={k} className="s3-f">{{ radius: 'R', pitch: 'Paso', height: 'Altura' }[k]}<input value={e[k]} onChange={(ev) => upE(i, { [k]: ev.target.value })} onKeyDown={(ev) => ev.stopPropagation()} /></label>)}
              <label className="check"><input type="checkbox" checked={!!e.left} onChange={(ev) => upE(i, { left: ev.target.checked })} />Izquierdas</label>
            </>)}
            <button className="btn icon" title="Eliminar" onClick={() => setEnts(ents.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button>
          </div>
        ))}
      </div>
      <div className="modal-btns">
        <button className="btn" onClick={() => { const a = last(); setEnts([...ents, { id: uid('e'), type: 'line3', a, b: [a[0], a[1], `${a[2]} + 50`] }]); }}>+ Línea</button>
        <button className="btn" onClick={() => { const a = last(); setEnts([...ents, { id: uid('e'), type: 'spline3', pts: [a, [`${a[0]} + 30`, a[1], `${a[2]} + 30`], [`${a[0]} + 60`, a[1], a[2]]] }]); }}>+ Spline</button>
        <button className="btn" onClick={() => setEnts([...ents, { id: uid('e'), type: 'helix3', origin: ['0', '0', '0'], axis: 'Z', radius: '20', pitch: '10', height: '60' }])}>+ Hélice</button>
        <span className="grow" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!ents.length} onClick={save}>Aceptar</button>
      </div>
    </Modal>
  );
}

function IPartDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [t, setT] = useState<IPartTable>(() => (s.doc.ipart ? JSON.parse(JSON.stringify(s.doc.ipart)) : { cols: [], rows: [{ name: s.doc.iProperties.partNumber || s.fileName.replace(/\.[^.]+$/, ''), values: [] }], active: 0 }));
  const cands = ipartCandidates(s.doc).filter((c) => !t.cols.includes(c));
  const [addCol, setAddCol] = useState(cands[0] ?? '');
  const commit = (apply?: number) => s.commit((d) => { const tt = JSON.parse(JSON.stringify(t)) as IPartTable; d.ipart = tt; if (apply !== undefined) applyIPartRow(d, tt, apply); });
  const setCell = (r: number, c: number, v: string) => setT({ ...t, rows: t.rows.map((row, i) => (i === r ? { ...row, values: Object.assign([...row.values], { [c]: v }) } : row)) });
  const member = (r: number) => {
    const d = JSON.parse(JSON.stringify(s.doc)) as PartDoc; const tt = JSON.parse(JSON.stringify(t)) as IPartTable;
    applyIPartRow(d, tt, r); delete d.ipart;
    saveText(JSON.stringify(d, null, 1), `${t.rows[r].name}.i3p`, 'Pieza INV3D', '.i3p', 'application/json');
  };
  return (
    <Modal title="Tabla iPart (familia de piezas)" onClose={onClose} wide>
      <p className="phelp">Cada fila es un miembro de la familia. Las columnas son parámetros de usuario o cotas de boceto. «Activar» aplica la fila a la pieza; «Generar» guarda el miembro como pieza independiente.</p>
      <div className="vr-row">
        <select value={addCol} onChange={(e) => setAddCol(e.target.value)}>{cands.map((c) => <option key={c}>{c}</option>)}</select>
        <button className="btn" disabled={!addCol} onClick={() => { setT({ ...t, cols: [...t.cols, addCol], rows: t.rows.map((r) => ({ ...r, values: [...r.values, currentValue(s.doc, addCol)] })) }); setAddCol(cands.filter((c) => c !== addCol)[0] ?? ''); }}>Añadir columna</button>
        <button className="btn" onClick={() => setT({ ...t, rows: [...t.rows, { name: `${t.rows[t.rows.length - 1]?.name ?? 'Miembro'}-${t.rows.length + 1}`, values: [...(t.rows[t.rows.length - 1]?.values ?? t.cols.map((c) => currentValue(s.doc, c)))] }] })}>Añadir fila</button>
      </div>
      <div className="ipart-wrap">
        <table className="ipart">
          <thead><tr><th></th><th>Nº de pieza</th>{t.cols.map((c, i) => <th key={c}>{c}<button className="link" title="Quitar columna" onClick={() => setT({ cols: t.cols.filter((_, j) => j !== i), rows: t.rows.map((r) => ({ ...r, values: r.values.filter((_, j) => j !== i) })), active: t.active })}>×</button></th>)}<th></th></tr></thead>
          <tbody>
            {t.rows.map((r, ri) => (
              <tr key={ri} className={ri === t.active ? 'on' : ''}>
                <td>{ri === t.active ? '✓' : ''}</td>
                <td><input value={r.name} onChange={(e) => setT({ ...t, rows: t.rows.map((x, i) => (i === ri ? { ...x, name: e.target.value } : x)) })} onKeyDown={(e) => e.stopPropagation()} /></td>
                {t.cols.map((_, ci) => <td key={ci}><input value={r.values[ci] ?? ''} onChange={(e) => setCell(ri, ci, e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></td>)}
                <td className="nowrap"><button className="btn" onClick={() => { setT({ ...t, active: ri }); commit(ri); }}>Activar</button><button className="btn" onClick={() => member(ri)}>Generar</button>{t.rows.length > 1 && <button className="btn icon" onClick={() => setT({ ...t, rows: t.rows.filter((_, i) => i !== ri), active: Math.min(t.active, t.rows.length - 2) })}><Icon name="trash" size={14} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="modal-btns">
        {s.doc.ipart && <button className="btn" onClick={() => { s.commit((d) => { delete d.ipart; }); onClose(); }}>Quitar tabla</button>}
        <span className="grow" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => { commit(t.active); onClose(); }}>Aceptar</button>
      </div>
    </Modal>
  );
}

function IFeatureDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const lib = s.libs.ifeatures ?? [];
  const [tab, setTab] = useState<'insert' | 'extract'>(lib.length ? 'insert' : 'extract');
  const sks = s.doc.features.filter((f) => f.type === 'sketch');
  const [sk, setSk] = useState(sks[sks.length - 1]?.id ?? '');
  const [name, setName] = useState('iFeature1');
  const [sel, setSel] = useState(0);
  const def = lib[sel];
  const params = useMemo(() => (def ? ifParams(def) : []), [def]);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [plane, setPlane] = useState<PlaneRef>({ kind: 'std', name: 'XY', offset: '0' });
  const saveLib = (l: IFeatureDef[]) => useStore.setState({ libs: { ...s.libs, ifeatures: l } });
  return (
    <Modal title="iFeature" onClose={onClose} wide>
      <div style={{ marginBottom: 10 }}><Seg value={tab} onChange={setTab} options={[['insert', 'Insertar'], ['extract', 'Extraer']]} /></div>
      {tab === 'extract' && (<>
        <Row label="Boceto"><select value={sk} onChange={(e) => setSk(e.target.value)}>{sks.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Row>
        <Row label="Nombre"><input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></Row>
        <p className="phelp">Se guardan el boceto y las operaciones que lo usan (extrusión, agujero, revolución…) con sus cotas como parámetros. Queda en tu biblioteca (Opciones › Bibliotecas) y se puede exportar como fichero .i3f.</p>
        <div className="modal-btns"><span className="grow" />
          <button className="btn" disabled={!sk} onClick={() => { try { const d = extractIFeature(s.doc, sk, name); saveText(JSON.stringify(d, null, 1), `${name}.i3f`, 'iFeature INV3D', '.i3f', 'application/json'); } catch (e) { s.notify((e as Error).message, 'error'); } }}>Exportar .i3f…</button>
          <button className="btn primary" disabled={!sk} onClick={() => { try { const d = extractIFeature(s.doc, sk, name); saveLib([...lib.filter((x) => x.name !== name), d]); s.notify(`iFeature «${name}» guardada en la biblioteca (${d.features.length} operaciones)`); setTab('insert'); setSel(lib.filter((x) => x.name !== name).length); } catch (e) { s.notify((e as Error).message, 'error'); } }}>Guardar en la biblioteca</button>
        </div>
      </>)}
      {tab === 'insert' && (<>
        <div className="vr-row">
          <select value={sel} onChange={(e) => { setSel(Number(e.target.value)); setVals({}); }}>{lib.map((d, i) => <option key={i} value={i}>{d.name} ({d.features.length})</option>)}</select>
          <button className="btn" onClick={async () => { const f = await pickFile('.i3f,.json'); if (!f) return; try { const d = JSON.parse(await f.text()) as IFeatureDef; if (!Array.isArray(d.features)) throw new Error('No es una iFeature'); saveLib([...lib, d]); setSel(lib.length); } catch (e) { s.notify((e as Error).message, 'error'); } }}>Abrir .i3f…</button>
          {def && <button className="btn icon" title="Quitar de la biblioteca" onClick={() => { saveLib(lib.filter((_, i) => i !== sel)); setSel(0); }}><Icon name="trash" size={14} /></button>}
        </div>
        {!def ? <p className="phelp">La biblioteca está vacía: extrae antes una iFeature.</p> : (<>
          <Row label="Plano de colocación"><PlanePick value={plane} onChange={setPlane} /></Row>
          {params.map((p) => <Row key={p.key} label={p.label}><input value={vals[p.key] ?? p.expr} onChange={(e) => setVals({ ...vals, [p.key]: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></Row>)}
        </>)}
        <div className="modal-btns"><span className="grow" /><button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!def} onClick={() => { s.commit((d) => insertIFeature(d, def, plane, vals)); onClose(); }}>Insertar</button></div>
      </>)}
    </Modal>
  );
}

function PipingDialog({ pk: pk0, norm: norm0, onClose }: { pk: string; norm: 'ASME' | 'EN'; onClose: () => void }) {
  const s = useStore();
  const [kind, setKind] = useState<PipeKind>(pk0 as PipeKind);
  const [norm, setNorm] = useState<'ASME' | 'EN'>(norm0);
  const [flStd, setFlStd] = useState<FlangeStd>(norm0 === 'EN' ? 'EN1092' : 'B16.5');
  const [rating, setRating] = useState<number>(norm0 === 'EN' ? 16 : 150);
  const [flType, setFlType] = useState<string>(norm0 === 'EN' ? '11' : 'WN');
  const sizeList = (): string[] => {
    if (kind === 'flange') {
      if (flStd === 'EN1092') return enSizes(rating).map(String);
      if (flStd === 'B16.5') return b165Sizes(rating);
      return (B1647_TABLES[flStd === 'B16.47A' ? 'A' : 'B'][rating] ?? []).map((r) => r[0]);
    }
    if (kind === 'coupling') return norm === 'ASME' ? Object.keys(B1611) : Object.keys(B1611).map((n) => String(NPS_DN[n]));
    if (kind === 'pipe') return norm === 'ASME' ? ASME_SIZES : EN_DN.map(String);
    const fitSizes = FITTING_NPS.filter((n) => kind !== 'reducer' || REDUCER_H[n]).filter((n) => kind !== 'rtee' || reducedOptions(n).length).filter((n) => kind !== 'stub' || B169[n][5]);
    return norm === 'ASME' ? fitSizes : fitSizes.map((n) => NPS_DN[n]).filter((dn) => EN_OD[dn]).map(String);
  };
  const sizes = sizeList();
  const defSize = sizes.find((x) => x === '4' || x === '100') ?? sizes[Math.min(8, sizes.length - 1)] ?? '';
  const [size, setSize] = useState<string>(defSize);
  const sz = sizes.includes(size) ? size : defSize;
  const npsBig = norm === 'ASME' ? sz : DN_NPS[Number(sz)] ?? '';
  const size2List = (kind === 'rtee' || kind === 'reducer') ? reducedOptions(npsBig).map((n) => (norm === 'ASME' ? n : String(NPS_DN[n]))).filter((x) => norm === 'ASME' || EN_OD[Number(x)]) : [];
  const [size2, setSize2] = useState('');
  const sz2 = size2List.includes(size2) ? size2 : size2List[0] ?? '';
  const schs = norm === 'ASME' && ASME_PIPE[norm === 'ASME' ? sz : npsBig] ? Object.keys(ASME_PIPE[sz]?.[1] ?? {}) : [];
  const [sch, setSch] = useState('STD');
  const schV = schs.includes(sch) ? sch : schs.includes('STD') ? 'STD' : schs[0] ?? 'STD';
  const enW = norm === 'EN' ? enWalls(EN_OD[Number(sz)] ?? 0) : [];
  const [wall, setWall] = useState(0);
  const wallV = enW.includes(wall) ? wall : (EN_S[Number(sz)] ?? enW[0] ?? 0);
  const [len, setLen] = useState(6000);
  const [elbow, setElbow] = useState<'LR' | 'SR' | '3D' | '5D'>(norm0 === 'EN' ? '3D' : 'LR');
  const [angle, setAngle] = useState<45 | 90 | 180>(90);
  const [ecc, setEcc] = useState(false);
  const [cls, setCls] = useState<3000 | 6000>(3000);
  const [sw, setSw] = useState(false);
  const [half, setHalf] = useState(false);
  const [facing, setFacing] = useState<'RF' | 'FF'>('RF');
  const [stubShort, setStubShort] = useState(false);
  const use = kind === 'pipe' ? 'pipe' : kind === 'flange' ? 'flange' : 'fitting';
  const mats = PIPE_MATERIALS.filter((m) => m.std === norm && m.use.includes(use));
  const [mat, setMat] = useState('');
  const matV = mats.some((m) => m.name === mat) ? mat : mats[0]?.name ?? 'Acero S275JR';
  const ratings = flStd === 'EN1092' ? Object.keys(EN_PN).map(Number) : flStd === 'B16.5' ? B165_CLASSES : Object.keys(B1647_TABLES[flStd === 'B16.47A' ? 'A' : 'B']).map(Number);
  const types: [string, string][] = flStd === 'EN1092' ? Object.entries(EN_TYPES) : [['WN', 'Cuello para soldar (WN)'], ['SO', 'Deslizante (SO)'], ['BL', 'Ciega (BL)'], ...(flStd === 'B16.5' ? [['LJ', 'Loca (LJ)'], ['SW', 'Socket weld (SW)'], ['TH', 'Roscada (TH)']] as [string, string][] : [])];
  const spec: PipeSpec = {
    kind, norm, size: sz, size2: sz2, sch: schV, wall: wallV, length: kind === 'stub' ? (stubShort ? 1 : 0) : len, flStd, rating, flType, facing,
    elbow, angle, ecc, cls, sw, half, material: matV,
  };
  let info = '', err = '';
  try {
    const D = od(spec, sz), t = wallOf(spec, sz);
    if (kind === 'flange') { const fd = flangeDims(spec); if (!fd) throw new Error('No existe en la norma'); info = `Ø${fd.D} · espesor ${fd.tf} · ${fd.n} × ${fd.bolt} en Ø${fd.bc} (taladros Ø${fd.hole}) · cara Ø${fd.rf}`; }
    else if (kind === 'coupling') info = `Para tubo Ø${od({ norm: 'ASME' }, npsBig)}`;
    else info = `Ø${D} × ${t} mm`;
  } catch (e) { err = (e as Error).message; }
  const create = (place: boolean) => {
    try {
      const doc = makePipePart(spec);
      const FR: Record<string, string> = { '1/2': '½', '1/4': '¼', '3/4': '¾', '1/8': '⅛', '3/8': '⅜' };
      const fn = doc.iProperties.partNumber.replace(/(\d)\/(\d)/g, (m) => FR[m] ?? m.replace('/', '-')).replace(/-(?=[½¼¾⅛⅜])/g, '').replace(/"/g, 'in').replace(/[\\/:*?<>|]+/g, '_') + '.i3p';
      if (place && s.kind === 'assembly') {
        const existing = s.docs.find((d) => d.fileName === fn);
        const pid = existing?.id ?? s.addDocument('part', doc, fn, false);
        asmActions.placePart(pid);
        s.notify(`${doc.iProperties.description} colocado`);
      } else { s.addDocument('part', doc, fn); onClose(); }
    } catch (e) { s.notify((e as Error).message, 'error'); }
  };
  const kinds: [PipeKind, string][] = Object.entries(PIPE_KINDS).filter(([k]) => norm === 'ASME' || k !== 'stub') as [PipeKind, string][];
  return (
    <Modal title="Tubería · Centro de contenido" onClose={onClose} wide>
      <div className="cc">
        <div className="cc-tree">
          <div style={{ padding: '4px 6px 8px' }}><Seg value={norm} onChange={(v) => { setNorm(v); setFlStd(v === 'EN' ? 'EN1092' : 'B16.5'); setRating(v === 'EN' ? 16 : 150); setFlType(v === 'EN' ? '11' : 'WN'); setElbow(v === 'EN' ? '3D' : 'LR'); }} options={[['ASME', 'ASME'], ['EN', 'EN']]} /></div>
          {kinds.map(([k, n]) => <button key={k} className={`cc-item ${k === kind ? 'on' : ''}`} onClick={() => setKind(k)}><span>{n}</span></button>)}
        </div>
        <div className="cc-form">
          <div className="psec-title">{PIPE_KINDS[kind]} · {kind === 'pipe' ? (norm === 'ASME' ? 'ASME B36.10M / B36.19M' : 'EN 10220 / EN 10216') : kind === 'flange' ? (flStd === 'EN1092' ? 'EN 1092-1' : ({ 'B16.5': 'ASME B16.5', 'B16.47A': 'ASME B16.47 Serie A', 'B16.47B': 'ASME B16.47 Serie B' } as Record<string, string>)[flStd]) : kind === 'coupling' ? 'ASME B16.11' : norm === 'ASME' ? 'ASME B16.9' : 'EN 10253'}</div>
          {kind === 'flange' && (<>
            {norm === 'ASME' && <Row label="Norma"><select value={flStd} onChange={(e) => { const v = e.target.value as FlangeStd; setFlStd(v); setRating(v === 'B16.47B' ? 150 : 150); if (v !== 'B16.5' && !['WN', 'BL'].includes(flType)) setFlType('WN'); }}><option value="B16.5">B16.5 (½"–24")</option><option value="B16.47A">B16.47 Serie A (26"–60")</option><option value="B16.47B">B16.47 Serie B (26"–60")</option></select></Row>}
            <Row label={flStd === 'EN1092' ? 'PN' : 'Clase'}><select value={rating} onChange={(e) => setRating(Number(e.target.value))}>{ratings.map((r) => <option key={r} value={r}>{flStd === 'EN1092' ? `PN ${r}` : `${r} lb`}</option>)}</select></Row>
            <Row label="Tipo"><select value={flType} onChange={(e) => setFlType(e.target.value)}>{types.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Row>
            <Row label="Cara"><Seg value={facing} onChange={setFacing} options={[['RF', flStd === 'EN1092' ? 'Realzada (B1)' : 'Realzada (RF)'], ['FF', 'Plana (FF / A)']]} /></Row>
          </>)}
          <Row label={norm === 'ASME' ? 'NPS' : 'DN'}><select value={sz} onChange={(e) => setSize(e.target.value)}>{sizes.map((x) => <option key={x} value={x}>{norm === 'ASME' ? `${x}"` : `DN ${x}`}</option>)}</select></Row>
          {size2List.length > 0 && <Row label={kind === 'rtee' ? 'Derivación' : 'Extremo pequeño'}><select value={sz2} onChange={(e) => setSize2(e.target.value)}>{size2List.map((x) => <option key={x} value={x}>{norm === 'ASME' ? `${x}"` : `DN ${x}`}</option>)}</select></Row>}
          {kind !== 'coupling' && !(kind === 'flange' && flType !== 'WN' && flType !== '11' && flType !== 'SW') && (norm === 'ASME'
            ? <Row label="Schedule"><select value={schV} onChange={(e) => setSch(e.target.value)}>{schs.map((x) => <option key={x} value={x}>{x} · {ASME_PIPE[sz]?.[1][x as 'STD']} mm</option>)}</select></Row>
            : <Row label="Espesor"><select value={wallV} onChange={(e) => setWall(Number(e.target.value))}>{enW.map((x) => <option key={x} value={x}>{String(x).replace('.', ',')} mm</option>)}</select></Row>)}
          {kind === 'pipe' && <Row label="Longitud"><input type="number" value={len} min={1} onChange={(e) => setLen(Number(e.target.value))} /><span className="ro" style={{ marginLeft: 6 }}>mm</span></Row>}
          {kind === 'elbow' && (<>
            <Row label="Radio"><select value={elbow} onChange={(e) => setElbow(e.target.value as 'LR')}><option value="LR">Radio largo 1,5D (LR)</option><option value="SR">Radio corto 1D (SR)</option>{norm === 'EN' && <option value="3D">EN 10253 tipo 3D</option>}<option value="5D">Curva 5D</option></select></Row>
            <Row label="Ángulo"><Seg value={String(angle)} onChange={(v) => setAngle(Number(v) as 90)} options={[['45', '45°'], ['90', '90°'], ['180', '180° (retorno)']]} /></Row>
          </>)}
          {kind === 'reducer' && <Row label="Tipo"><Seg value={ecc ? 'e' : 'c'} onChange={(v) => setEcc(v === 'e')} options={[['c', 'Concéntrica'], ['e', 'Excéntrica']]} /></Row>}
          {kind === 'stub' && <Row label="Longitud"><Seg value={stubShort ? 's' : 'l'} onChange={(v) => setStubShort(v === 's')} options={[['l', 'Larga (ASME)'], ['s', 'Corta (MSS)']]} /></Row>}
          {kind === 'coupling' && (<>
            <Row label="Clase"><Seg value={String(cls)} onChange={(v) => setCls(Number(v) as 3000)} options={[['3000', '3000'], ['6000', '6000']]} /></Row>
            <Row label="Unión"><Seg value={sw ? 'sw' : 'th'} onChange={(v) => setSw(v === 'sw')} options={[['th', 'Roscado NPT'], ['sw', 'Socket weld']]} /></Row>
            <Row label="Forma"><Seg value={half ? 'h' : 'f'} onChange={(v) => setHalf(v === 'h')} options={[['f', 'Manguito'], ['h', 'Medio manguito']]} /></Row>
          </>)}
          <Row label="Material"><select value={matV} onChange={(e) => setMat(e.target.value)}>{mats.map((m) => <option key={m.name}>{m.name}</option>)}</select></Row>
          {err ? <Err text={err} /> : <div className="pick-info">{info}</div>}
          <p className="phelp">Se crea una pieza paramétrica con sus iProperties (designación, norma y material) para la lista de materiales. En un ensamblaje se coloca y se restringe con Insertar en las caras de los extremos.</p>
          <div className="modal-btns"><span className="grow" /><button className="btn" onClick={onClose}>Cerrar</button>
            <button className="btn" disabled={!!err} onClick={() => create(false)}>Abrir como pieza</button>
            {s.kind === 'assembly' && <button className="btn primary" disabled={!!err} onClick={() => create(true)}>Colocar</button>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DriveDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const joints = s.asm.joints.filter((j) => j.type === 'rot' || j.type === 'slider');
  const [jid, setJid] = useState(joints.find((j) => j.id === s.selItem)?.id ?? joints[0]?.id ?? '');
  const j = joints.find((x) => x.id === jid);
  const [from, setFrom] = useState(0), [to, setTo] = useState(j?.type === 'slider' ? 50 : 360), [steps, setSteps] = useState(60);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Conducir unión" onClose={onClose}>
      {!joints.length ? <p className="phelp">Crea antes una unión de rotación o corredera (Ensamblar › Unión).</p> : (<>
        <Row label="Unión"><select value={jid} onChange={(e) => setJid(e.target.value)}>{joints.map((x) => <option key={x.id} value={x.id}>{x.name} ({JOINT_NAMES[x.type]})</option>)}</select></Row>
        <Row label="Desde"><input type="number" value={from} onChange={(e) => setFrom(Number(e.target.value))} /><span className="ro" style={{ marginLeft: 6 }}>{j?.type === 'rot' ? '°' : 'mm'}</span></Row>
        <Row label="Hasta"><input type="number" value={to} onChange={(e) => setTo(Number(e.target.value))} /></Row>
        <Row label="Pasos"><input type="number" value={steps} min={2} max={720} onChange={(e) => setSteps(Math.max(2, Number(e.target.value)))} /></Row>
        <p className="phelp">Mueve el mecanismo resolviendo todas las restricciones en cada paso. Al terminar vuelve a la posición inicial.</p>
      </>)}
      <div className="modal-btns"><span className="grow" />
        <button className="btn primary" disabled={!j || busy} onClick={async () => { setBusy(true); const base = s.asm; await asmActions.drive(jid, from, to, steps, 30); useStore.setState({ asm: base }); setBusy(false); }}>{busy ? 'Reproduciendo…' : 'Reproducir'}</button>
        <button className="btn" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}

function ReplaceDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const o = s.asm.occurrences.find((x) => x.id === s.selItem);
  const parts = s.docs.filter((d) => d.kind === 'part' && d.id !== o?.part);
  const [pid, setPid] = useState(parts[0]?.id ?? '');
  const [all, setAll] = useState(false);
  return (
    <Modal title="Sustituir componente" onClose={onClose}>
      {!o ? <p className="phelp">Selecciona antes un componente.</p> : (<>
        <Row label="Componente"><span className="ro">{o.name}</span></Row>
        <Row label="Sustituir por"><select value={pid} onChange={(e) => setPid(e.target.value)}>{parts.map((d) => <option key={d.id} value={d.id}>{d.fileName}</option>)}</select></Row>
        {!parts.length && <Err text="Abre antes la pieza nueva (Archivo › Abrir) o créala" />}
        <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Sustituir todas las apariciones</label>
      </>)}
      <div className="modal-btns"><span className="grow" /><button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!o || !pid} onClick={() => { asmActions.replaceComponent(o!.id, pid, all); onClose(); }}>Aceptar</button></div>
    </Modal>
  );
}

function ViewRepDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [name, setName] = useState(`Vista${(s.asm.viewReps?.length ?? 0) + 1}`);
  return (
    <Modal title="Representaciones de vista" onClose={onClose}>
      <p className="phelp">Guarda qué componentes están ocultos (clic derecho › Ocultar en el navegador) y recupéralo después.</p>
      <div className="vr-list">
        <button className="btn wide" onClick={() => s.commitAsm((a) => { for (const o of a.occurrences) o.hidden = false; })}>Principal (mostrar todo)</button>
        {(s.asm.viewReps ?? []).map((r) => (
          <div key={r.id} className="vr-row">
            <button className="btn wide" onClick={() => asmActions.applyViewRep(r.id)}>{r.name} <span className="ro">· {r.hidden.length} ocultos</span></button>
            <button className="btn icon" title="Eliminar" onClick={() => s.commitAsm((a) => { a.viewReps = (a.viewReps ?? []).filter((x) => x.id !== r.id); })}><Icon name="trash" size={14} /></button>
          </div>
        ))}
      </div>
      <Row label="Nueva"><input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></Row>
      <div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={() => { asmActions.saveViewRep(name); setName(`Vista${(s.asm.viewReps?.length ?? 0) + 2}`); }}>Guardar la actual</button><button className="btn" onClick={onClose}>Cerrar</button></div>
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

const SHEET_STYLES = [
  { name: 'Galvanizado 0,6', t: '0.6 mm', r: '0.6 mm', k: '0.35' }, { name: 'Galvanizado 0,8', t: '0.8 mm', r: '0.8 mm', k: '0.35' },
  { name: 'Galvanizado 1', t: '1 mm', r: '1 mm', k: '0.38' }, { name: 'Galvanizado 1,2', t: '1.2 mm', r: '1.2 mm', k: '0.4' },
  { name: 'Acero 2', t: '2 mm', r: '2 mm', k: '0.44' }, { name: 'Acero 3', t: '3 mm', r: '4 mm', k: '0.44' }, { name: 'Acero 5', t: '5 mm', r: '6 mm', k: '0.45' },
  { name: 'Inox 1,5', t: '1.5 mm', r: '1.5 mm', k: '0.42' }, { name: 'Aluminio 2', t: '2 mm', r: '3 mm', k: '0.43' },
];

function SheetStyleDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [st, setSt] = useState(() => ({ ...(s.doc.sheet ?? { t: '2 mm', r: '2 mm', k: '0.44' }) }));
  return (
    <Modal title="Estilo de chapa" onClose={onClose}>
      <Row label="Espesor t"><Expr value={st.t} live onCommit={(v) => setSt({ ...st, t: v })} /></Row>
      <Row label="Radio plegado"><Expr value={st.r} live onCommit={(v) => setSt({ ...st, r: v })} /></Row>
      <Row label="Factor K"><Expr value={st.k} unit="ul" live onCommit={(v) => setSt({ ...st, k: v })} /></Row>
      <p className="phelp">Desarrollo con tolerancia de pliegue BA = θ·(R + K·t). Valores típicos de K: 0,33 (R &lt; t) a 0,50 (R &gt; 3t).</p>
      <div className="psec-title">Biblioteca de estilos</div>
      <div className="chips">
        {[...SHEET_STYLES, ...(s.libs.sheetStyles ?? [])].map((x) => <button key={x.name} className="chip" title={`t ${x.t} · R ${x.r} · K ${x.k}`} onClick={() => setSt({ t: x.t, r: x.r, k: x.k })}>{x.name}</button>)}
      </div>
      <div className="modal-btns">
        <button className="btn" onClick={() => { const n = prompt('Nombre del estilo (p. ej. Galvanizado 1 mm):', `Chapa ${st.t}`); if (n) useStore.setState({ libs: { ...s.libs, sheetStyles: [...(s.libs.sheetStyles ?? []).filter((x) => x.name !== n), { name: n, ...st }] } }); }}>Guardar en la biblioteca</button>
        <span className="grow" />
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
  // toSVGPaths devuelve Y hacia abajo: se invierte para coincidir con las líneas de pliegue
  const polys: P2[][] = res ? res.paths.flatMap((d) => flattenPath(d)).map((pl) => pl.map(([x, y]) => [x, -y] as P2)) : [];
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
    case 'drive': return <DriveDialog onClose={close} />;
    case 'motion': return <MotionDialog onClose={close} />;
    case 'piping': return <PipingDialog pk={(d as { pk: string }).pk} norm={(d as { norm: 'ASME' | 'EN' }).norm} onClose={close} />;
    case 'ipart': return <IPartDialog onClose={close} />;
    case 'ifeature': return <IFeatureDialog onClose={close} />;
    case 'sketch3d': return <Sketch3dDialog id={(d as { id?: string }).id} onClose={close} />;
    case 'options': return <OptionsDialog onClose={close} />;
    case 'drwstyle': return <DrwStyleDialog onClose={close} />;
    case 'retrieve': return <RetrieveDialog onClose={close} />;
    case 'folder': return <FolderDialog onClose={close} />;
    case 'replace': return <ReplaceDialog onClose={close} />;
    case 'viewreps': return <ViewRepDialog onClose={close} />;
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
        <p><b>INV3D 0.7</b> · CAD paramétrico libre en el navegador, con el flujo de trabajo de Inventor.</p>
        <p className="phelp">Boceto con restricciones geométricas y cotas, pieza y chapa, ensamblaje con restricciones (solver simultáneo), Centro de contenido, estructura (perfiles EN), soldadura (ISO 2553), tornillería (ISO, cálculo EN 1993-1-8), planos con secciones y detalles (ISO, proyección europea) y presentación.</p>
        <p className="phelp">Núcleo OpenCascade (LGPL) vía replicad · visor Three.js · visor DWG LibreDWG (GPL-3.0).</p>
        <div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={close}>Cerrar</button></div>
      </Modal>
    );
  }
}

export type { AsmDoc };
