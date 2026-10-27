import { useEffect, useState } from 'react';
import { useStore, activeSketch } from '../core/store';
import { evaluate, resolveParams, makeEval, fmt, isValidName } from '../core/expr';
import {
  ENTITY_NAMES, OP_NAMES, MATERIALS, planeLabel, FEATURE_NAMES,
  type Feature, type SkEntity, type SketchF, type BoolOp, type EdgeMode, type E2,
} from '../core/doc';
import { Icon } from './icons';
import { openFile, newIpj } from '../core/files';

function useEval() {
  const params = useStore((s) => s.doc.parameters);
  const { values } = resolveParams(params);
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

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="prow"><span className="plabel">{label}</span><span className="pfield">{children}</span></label>
);

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string, string?][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, l, icon]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)} title={l}>{icon ? <Icon name={icon} size={16} /> : null}{l}</button>
      ))}
    </div>
  );
}

function FeatureDialog() {
  const s = useStore();
  const d = s.dialog && 'draft' in s.dialog ? s.dialog : null;
  if (!d) return null;
  const f = d.draft;
  const up = (p: Partial<Feature>) => s.updateDraft(p);
  const sketches = s.doc.features.filter((x): x is SketchF => x.type === 'sketch' && x.entities.some((e) => e.type !== 'line'));
  const pst = s.preview?.status[f.id];
  const opSeg = (op: BoolOp) => (
    <Seg value={op} onChange={(v) => up({ op: v } as never)} options={[['join', OP_NAMES.join], ['cut', OP_NAMES.cut], ['intersect', 'Intersec.'], ['new', 'Nuevo']]} />
  );
  const profileSel = (profile: string) => (
    <select value={profile} onChange={(e) => up({ profile: e.target.value } as never)}>
      {!sketches.length && <option value="">— sin bocetos con perfil —</option>}
      {sketches.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
    </select>
  );
  return (
    <div className="fdlg">
      <div className="fdlg-head"><Icon name={f.type} size={20} /><input className="fdlg-name" value={f.name} onChange={(e) => up({ name: e.target.value })} /></div>
      {f.type === 'extrude' && (<>
        <Row label="Perfil">{profileSel(f.profile)}</Row>
        <Row label="Distancia"><Expr value={f.distance} live autoFocus onCommit={(v) => up({ distance: v } as never)} /></Row>
        <Row label="Dirección"><Seg value={f.dir} onChange={(v) => up({ dir: v } as never)} options={[['normal', 'Normal'], ['reverse', 'Inversa'], ['symmetric', 'Simétrica']]} /></Row>
        <Row label="Operación">{opSeg(f.op)}</Row>
      </>)}
      {f.type === 'revolve' && (() => {
        const sk = s.doc.features.find((x) => x.id === f.profile) as SketchF | undefined;
        const lines = sk?.entities.filter((e) => e.type === 'line') ?? [];
        return (<>
          <Row label="Perfil">{profileSel(f.profile)}</Row>
          <Row label="Eje">
            <select value={f.axis} onChange={(e) => up({ axis: e.target.value } as never)}>
              <option value="sx">Eje X del boceto</option>
              <option value="sy">Eje Y del boceto</option>
              {lines.map((l, i) => <option key={l.id} value={l.id}>Línea {i + 1}{l.type === 'line' && l.construction ? ' (constr.)' : ''}</option>)}
            </select>
          </Row>
          <Row label="Ángulo"><Expr value={f.angle} unit="deg" live onCommit={(v) => up({ angle: v } as never)} /></Row>
          <Row label="Operación">{opSeg(f.op)}</Row>
        </>);
      })()}
      {(f.type === 'fillet' || f.type === 'chamfer') && (<>
        {f.type === 'fillet'
          ? <Row label="Radio"><Expr value={f.radius} live autoFocus onCommit={(v) => up({ radius: v } as never)} /></Row>
          : <Row label="Distancia"><Expr value={f.distance} live autoFocus onCommit={(v) => up({ distance: v } as never)} /></Row>}
        <Row label="Aristas">
          <select value={f.edges.mode} onChange={(e) => up({ edges: { ...f.edges, mode: e.target.value as EdgeMode } } as never)}>
            <option value="picked">Seleccionadas en pantalla</option>
            <option value="all">Todas las aristas</option>
            <option value="circle">Aristas circulares</option>
            <option value="Z">Paralelas a Z</option>
            <option value="X">Paralelas a X</option>
            <option value="Y">Paralelas a Y</option>
          </select>
        </Row>
        {f.edges.mode === 'picked' && (
          <div className="pick-info">
            <b>{f.edges.points.length}</b> arista{f.edges.points.length === 1 ? '' : 's'} seleccionada{f.edges.points.length === 1 ? '' : 's'}
            {f.edges.points.length > 0 && <button className="link" onClick={() => up({ edges: { mode: 'picked', points: [] } } as never)}>Borrar</button>}
          </div>
        )}
      </>)}
      {pst && !pst.ok && <div className="fdlg-err"><Icon name="error" size={16} />{pst.error}</div>}
      <div className="fdlg-btns">
        <button className="btn primary" onClick={() => s.applyDialog(true)}>Aceptar</button>
        <button className="btn" onClick={s.closeDialog}>Cancelar</button>
        {!d.editId && <button className="btn icon" title="Aplicar y crear otra" onClick={() => s.applyDialog(false)}>+</button>}
      </div>
    </div>
  );
}

function EntityEditor({ e }: { e: SkEntity }) {
  const s = useStore();
  const up = (patch: Partial<SkEntity>) => s.updateEntity(e.id, patch);
  const pt = (label: string, p: E2, set: (v: E2) => void) => (
    <div className="prow2"><span className="plabel">{label}</span>
      <Expr value={p[0]} onCommit={(v) => set([v, p[1]])} /><Expr value={p[1]} onCommit={(v) => set([p[0], v])} />
    </div>
  );
  return (
    <div className="psec">
      <div className="psec-title">{ENTITY_NAMES[e.type]}</div>
      {e.type === 'rect' && (<>
        {pt('Esquina', [e.x, e.y], (v) => up({ x: v[0], y: v[1] } as never))}
        <Row label="Ancho"><Expr value={e.w} onCommit={(v) => up({ w: v } as never)} /></Row>
        <Row label="Alto"><Expr value={e.h} onCommit={(v) => up({ h: v } as never)} /></Row>
      </>)}
      {(e.type === 'circle' || e.type === 'npoly') && (<>
        {pt('Centro', [e.cx, e.cy], (v) => up({ cx: v[0], cy: v[1] } as never))}
        <Row label="Diámetro"><Expr value={e.d} onCommit={(v) => up({ d: v } as never)} /></Row>
        {e.type === 'npoly' && (<>
          <Row label="Lados"><Expr value={e.n} unit="ul" onCommit={(v) => up({ n: v } as never)} /></Row>
          <Row label="Giro"><Expr value={e.rot} unit="deg" onCommit={(v) => up({ rot: v } as never)} /></Row>
        </>)}
      </>)}
      {e.type === 'line' && (<>
        {pt('Inicio', e.a, (v) => up({ a: v } as never))}
        {pt('Fin', e.b, (v) => up({ b: v } as never))}
        <label className="check"><input type="checkbox" checked={!!e.construction} onChange={(x) => up({ construction: x.target.checked } as never)} />Construcción (eje de revolución)</label>
      </>)}
      {e.type === 'poly' && e.pts.map((p, i) => <div key={i}>{pt(`P${i + 1}`, p, (v) => up({ pts: e.pts.map((q, k) => (k === i ? v : q)) } as never))}</div>)}
      <button className="btn danger wide" onClick={() => s.deleteEntity(e.id)}><Icon name="trash" size={16} />Eliminar (Supr)</button>
    </div>
  );
}

function SketchPanel({ sk }: { sk: SketchF }) {
  const s = useStore();
  const e = sk.entities.find((x) => x.id === s.selEntity);
  const st = s.result?.status[sk.id];
  return (<>
    <div className="psec">
      <div className="psec-title">{sk.name}</div>
      <Row label="Plano"><span className="ro">{planeLabel(sk.plane)}</span></Row>
      {sk.plane.kind === 'std' && (
        <Row label="Desfase"><Expr value={sk.plane.offset || '0'} onCommit={(v) => s.commit((d) => { const f = d.features.find((x) => x.id === sk.id) as SketchF; if (f.plane.kind === 'std') f.plane.offset = v; })} /></Row>
      )}
      <Row label="Entidades"><span className="ro">{sk.entities.length}</span></Row>
      {st && !st.ok && <div className="fdlg-err"><Icon name="error" size={16} />{st.error}</div>}
      {!e && <p className="phelp">Dibuja con las herramientas de la cinta. Clic para seleccionar una entidad; doble clic en una cota para cambiarla. Las cotas admiten parámetros (fx).</p>}
    </div>
    {e && <EntityEditor e={e} />}
  </>);
}

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
        {f.type === 'revolve' && <Row label="Ángulo"><span className="ro">{f.angle} · {OP_NAMES[f.op]}</span></Row>}
        {f.type === 'fillet' && <Row label="Radio"><span className="ro">{f.radius}</span></Row>}
        {f.type === 'chamfer' && <Row label="Distancia"><span className="ro">{f.distance}</span></Row>}
        {f.type === 'import' && <Row label="Fichero"><span className="ro">{f.fileName}</span></Row>}
        {st && !st.ok && <div className="fdlg-err"><Icon name="error" size={16} />{st.error}</div>}
        {f.type !== 'import' && <button className="btn wide" onClick={() => (f.type === 'sketch' ? s.editSketch(f.id) : s.openFeatureDialog(f.type, f.id))}>Editar</button>}
      </div>
    )}
    <div className="psec">
      <div className="psec-title">Propiedades físicas</div>
      {p ? (<>
        <Row label="Material"><span className="ro">{s.doc.iProperties.material}</span></Row>
        <Row label="Masa"><span className="ro strong">{fmt((p.volume * 1e-9) * dens, 3)} kg</span></Row>
        <Row label="Volumen"><span className="ro">{fmt(p.volume / 1000, 2)} cm³</span></Row>
        <Row label="Área"><span className="ro">{fmt(p.area / 100, 2)} cm²</span></Row>
        <Row label="Centro de g."><span className="ro mono">{p.cog.map((v) => fmt(v, 1)).join(', ')}</span></Row>
        <Row label="Caja"><span className="ro mono">{[0, 1, 2].map((i) => fmt(p.bbox[1][i] - p.bbox[0][i], 1)).join(' × ')} mm</span></Row>
      </>) : <p className="phelp">Sin sólido todavía. Empieza con <b>Iniciar boceto 2D</b> (S), elige un plano y dibuja un perfil cerrado; después <b>Extrusión</b> (E).</p>}
    </div>
  </>);
}

export function PropertyPanel() {
  const s = useStore();
  const sk = activeSketch(s);
  const hasDlg = s.dialog && 'draft' in s.dialog;
  return (
    <aside className="props">
      <div className="br-head"><span>Propiedades</span></div>
      <div className="props-body">
        {hasDlg ? <FeatureDialog /> : s.mode === 'sketch' && sk ? <SketchPanel sk={sk} /> : <PartSummary />}
      </div>
    </aside>
  );
}

// ---------------- Diálogos modales ----------------
function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-shade" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
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
  const add = () => {
    let n = rows.length + 1; while (rows.some((r) => r.name === `d${n}`)) n++;
    setRows([...rows, { name: `d${n}`, expr: '10 mm', comment: '' }]);
  };
  return (
    <Modal title="Parámetros" onClose={onClose} wide>
      <table className="ptable">
        <thead><tr><th>Nombre</th><th>Expresión</th><th>Valor</th><th>Comentario</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const nameBad = !isValidName(r.name) || dup(r.name);
            return (
              <tr key={i}>
                <td><input className={nameBad ? 'bad' : ''} value={r.name} onChange={(e) => set(i, 'name', e.target.value)} title={nameBad ? 'Nombre no válido o repetido' : ''} /></td>
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
        <button className="btn" onClick={add}>Añadir parámetro</button>
        <span className="grow" />
        <button className="btn primary" disabled={bad} onClick={() => { s.commit((d) => { d.parameters = rows; }); onClose(); }}>Aceptar</button>
        <button className="btn" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}

function IPropsDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [ip, setIp] = useState({ ...s.doc.iProperties });
  const p = s.result?.props;
  const dens = MATERIALS.find((m) => m.name === ip.material)?.density ?? 1000;
  const field = (k: keyof typeof ip, label: string) => (
    <Row label={label}><input value={ip[k]} onChange={(e) => setIp({ ...ip, [k]: e.target.value })} /></Row>
  );
  return (
    <Modal title={`iProperties — ${s.fileName}`} onClose={onClose}>
      <div className="two">
        <div>
          <div className="psec-title">Proyecto</div>
          {field('partNumber', 'Nº de pieza')}
          {field('description', 'Descripción')}
          {field('revision', 'Revisión')}
          {field('designer', 'Diseñador')}
          <Row label="Material">
            <select value={ip.material} onChange={(e) => setIp({ ...ip, material: e.target.value })}>
              {MATERIALS.map((m) => <option key={m.name}>{m.name}</option>)}
            </select>
          </Row>
        </div>
        <div>
          <div className="psec-title">Físicas</div>
          {p ? (<>
            <Row label="Densidad"><span className="ro">{dens} kg/m³</span></Row>
            <Row label="Masa"><span className="ro strong">{fmt(p.volume * 1e-9 * dens, 4)} kg</span></Row>
            <Row label="Volumen"><span className="ro">{fmt(p.volume, 1)} mm³</span></Row>
            <Row label="Área"><span className="ro">{fmt(p.area, 1)} mm²</span></Row>
            <Row label="CdG X"><span className="ro mono">{fmt(p.cog[0], 3)} mm</span></Row>
            <Row label="CdG Y"><span className="ro mono">{fmt(p.cog[1], 3)} mm</span></Row>
            <Row label="CdG Z"><span className="ro mono">{fmt(p.cog[2], 3)} mm</span></Row>
          </>) : <p className="phelp">Sin sólido.</p>}
        </div>
      </div>
      <div className="modal-btns">
        <span className="grow" />
        <button className="btn primary" onClick={() => { s.commit((d) => { d.iProperties = ip; }); onClose(); }}>Aceptar</button>
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
        <table className="ptable kv">
          <tbody>{p.entries.map((e, i) => <tr key={i}><td>{e.label}</td><td className="mono">{e.value}</td></tr>)}</tbody>
        </table>
        <p className="phelp">Las rutas del proyecto se usarán para resolver referencias entre piezas, ensamblajes y planos a partir de la fase F2.</p>
      </>) : <p className="phelp">No hay proyecto activo. Abre un fichero <code>.ipj</code> de Inventor para ver su espacio de trabajo y librerías, o crea uno nuevo compatible.</p>}
      <div className="modal-btns">
        <button className="btn" onClick={() => openFile()}>Abrir .ipj…</button>
        <button className="btn" onClick={() => newIpj(s.doc.iProperties.partNumber || 'Proyecto')}>Crear .ipj nuevo</button>
        <span className="grow" />
        <button className="btn primary" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}

function FileInfoDialog({ title, info, onClose }: { title: string; info: import('../core/store').FileInfo; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="fi-head">
        {info.thumbnail ? <img className="fi-thumb" src={info.thumbnail} alt="Miniatura" /> : <div className="fi-thumb none"><Icon name="part" size={40} /></div>}
        <div>
          <div className="fi-name">{info.fileName}</div>
          <div className="muted">{info.kind}</div>
          <p className="fi-msg">{info.message}</p>
        </div>
      </div>
      {!!info.props?.length && (
        <table className="ptable kv"><tbody>{info.props.map((p, i) => <tr key={i}><td>{p.label}</td><td>{p.value}</td></tr>)}</tbody></table>
      )}
      {!!info.streams?.length && (
        <details className="fi-streams"><summary>Contenido del contenedor OLE ({info.streams.length} flujos)</summary>
          <div className="mono small">{info.streams.map((x) => x.replace(/[\u0000-\u001f]/g, '·')).join('\n')}</div>
        </details>
      )}
      <div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['S', 'Iniciar boceto 2D'], ['L', 'Línea (en boceto)'], ['R', 'Rectángulo (boceto) / Revolución (modelo)'], ['C', 'Círculo'], ['P', 'Polígono'],
  ['E', 'Extrusión'], ['F', 'Empalme'], ['Esc', 'Cancelar herramienta / terminar boceto'], ['Supr', 'Eliminar selección'],
  ['Ctrl+Z / Ctrl+Y', 'Deshacer / Rehacer'], ['Ctrl+S', 'Guardar .i3p'], ['Ctrl+O', 'Abrir'], ['F6', 'Vista de inicio'], ['Inicio', 'Ajustar a la ventana'],
  ['Ratón', 'Izq.: órbita · Central/dcho. en boceto: encuadre · Rueda: zoom'],
];

export function Modals() {
  const s = useStore();
  const d = s.dialog;
  const close = () => s.set({ dialog: null });
  if (!d || 'draft' in d) return null;
  if (d.kind === 'params') return <ParamsDialog onClose={close} />;
  if (d.kind === 'iprops') return <IPropsDialog onClose={close} />;
  if (d.kind === 'project') return <ProjectDialog onClose={close} />;
  if (d.kind === 'fileinfo') return <FileInfoDialog title={d.title} info={d.info} onClose={close} />;
  if (d.kind === 'shortcuts') return (
    <Modal title="Atajos de teclado y ratón" onClose={close}>
      <table className="ptable kv"><tbody>{SHORTCUTS.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>
    </Modal>
  );
  return (
    <Modal title="Acerca de INV3D" onClose={close}>
      <p><b>INV3D 0.1 · Fase F0 (MVP)</b></p>
      <p className="phelp">CAD paramétrico libre en el navegador con el flujo de trabajo de Inventor. Núcleo geométrico OpenCascade (LGPL) vía replicad, visor Three.js.</p>
      <p className="phelp">Formatos propios: .i3p (pieza). Intercambio: STEP, STL. Inventor: .ipj (lectura) y metadatos/miniatura de .ipt, .iam, .idw, .ipn.</p>
      <div className="modal-btns"><span className="grow" /><button className="btn primary" onClick={close}>Cerrar</button></div>
    </Modal>
  );
}

export { makeEval };
