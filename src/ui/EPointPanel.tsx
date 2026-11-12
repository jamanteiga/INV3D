import { useEffect, useState } from 'react';
import { useStore } from '../core/store';
import { uid, type V3 } from '../core/doc';
import { partEPoints, EP_KIND_NAMES, type EPoint, type EPointKind } from '../core/epoints';
import { Icon } from './icons';

const n3 = (v: V3) => { const l = Math.hypot(...v) || 1; return v.map((x) => Math.round((x / l) * 1e6) / 1e6) as V3; };

/** Panel flotante de ePoints de la pieza: crear, editar y borrar (sin tapar el modelo, para poder elegir caras) */
export default function EPointPanel({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const list = s.kind === 'part' ? partEPoints(s.doc) : [];
  const blank = (): EPoint => ({ id: uid('ep'), name: `ePoint${list.length}`, kind: 'mate', point: [0, 0, 0], dir: [0, 0, 1], offset: '0' });
  const [d, setD] = useState<EPoint>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const pick = s.epPick;
  // cara elegida en el modelo → posición y dirección (cilíndrica: inserción con radio)
  useEffect(() => {
    if (!pick) return;
    setD((x) => ({ ...x, point: pick.point, dir: pick.dir, radius: pick.radius, kind: x.isDefault ? x.kind : pick.axis ? 'insert' : x.kind === 'composite' ? 'mate' : x.kind }));
  }, [pick?.n]);
  useEffect(() => () => { const t = useStore.getState(); if (t.tool === 'epPick' || t.tool === 'epEdge') t.set({ tool: null, epEdges: [] }); }, []);
  if (s.kind !== 'part') return null;
  const up = (p: Partial<EPoint>) => setD({ ...d, ...p });
  const save = () => {
    if (!d.name.trim()) { s.notify('Pon un nombre al ePoint: se conecta con los ePoints del mismo nombre', 'error'); return; }
    if (d.kind === 'composite' && (d.members?.length ?? 0) < 2) { s.notify('Un ePoint compuesto agrupa al menos dos ePoints', 'error'); return; }
    if (!d.isDefault && list.some((e) => e.name === d.name.trim() && e.id !== d.id && !e.isDefault)) { s.notify('Ya hay un ePoint con ese nombre en la pieza', 'error'); return; }
    const e: EPoint = { ...d, name: d.name.trim(), dir: n3(d.dir) };
    s.commit((doc) => {
      const cur = doc.epoints ?? [];
      // el de inserción por defecto se guarda solo al editarlo
      doc.epoints = cur.some((x) => x.id === e.id) ? cur.map((x) => (x.id === e.id ? e : x)) : [...cur, e];
    });
    s.notify(`ePoint «${e.name}» ${editing ? 'actualizado' : 'creado'}`);
    setEditing(null); setD({ ...blank(), name: `ePoint${list.length + (editing ? 0 : 1)}` });
  };
  const del = (id: string) => s.commit((doc) => {
    doc.epoints = (doc.epoints ?? []).filter((x) => x.id !== id).map((x) => (x.members ? { ...x, members: x.members.filter((m) => m !== id) } : x));
  });
  const num = (v: number, on: (x: number) => void) => <input className="num" type="number" step="any" value={v} onChange={(e) => on(parseFloat(e.target.value) || 0)} style={{ width: 70 }} />;

  return (
    <div className="fem-panel ep-panel" role="dialog" aria-label="ePoints">
      <div className="modal-head"><span>ePoints de la pieza</span><button className="x" onClick={onClose} aria-label="Cerrar"><Icon name="close" size={18} /></button></div>
      <div className="modal-body">
        <table className="ptable"><tbody>
          {list.map((e) => (
            <tr key={e.id} className={editing === e.id ? 'sel' : ''}>
              <td><label className="check" title={e.inactive ? 'Desactivado: no se conecta ni se ofrece al colocar' : 'Activo'}><input type="checkbox" checked={!e.inactive} onChange={(ev) => s.commit((doc) => {
                const cur = doc.epoints ?? [], v = ev.target.checked ? undefined : true;
                doc.epoints = cur.some((x) => x.id === e.id) ? cur.map((x) => (x.id === e.id ? { ...x, inactive: v } : x)) : [{ ...e, inactive: v }, ...cur];
              })} /><span className={`ep-dot ep-${e.inactive ? 'off' : e.isDefault ? 'def' : e.kind}`} /> {e.name}</label></td>
              <td className="muted">{e.isDefault ? 'Inserción (por defecto)' : EP_KIND_NAMES[e.kind]}{e.kind === 'composite' ? ` · ${e.members?.length ?? 0}` : ''}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn sm" onClick={() => { setEditing(e.id); setD(structuredClone(e)); }}>Editar</button>
                {!e.isDefault && <button className="btn sm" title="Duplicar (mismo tipo, nombre nuevo)" onClick={() => s.commit((doc) => { const cur = doc.epoints ?? []; let k = 2; while (cur.some((x) => x.name === `${e.name}_${k}`)) k++; doc.epoints = [...cur, { ...structuredClone(e), id: uid('ep'), name: `${e.name}_${k}` }]; })}>⧉</button>}
                {!e.isDefault && <button className="btn sm" title="Eliminar" onClick={() => del(e.id)}>✕</button>}
              </td>
            </tr>
          ))}
        </tbody></table>
        <div className="psec-title" style={{ marginTop: 4, display: 'flex', alignItems: 'center' }}>{editing ? `Editar «${d.name}»` : 'Nuevo ePoint'}<span style={{ flex: 1 }} />
          <button className="btn sm" title="Otro ePoint nuevo en esta pieza (elige una cara y Guardar)" onClick={() => { setEditing(null); setD({ ...blank(), name: (() => { let k = list.length; while (list.some((x) => x.name === `ePoint${k}`)) k++; return `ePoint${k}`; })() }); s.set({ tool: 'epPick' }); }}>＋ Nuevo</button></div>
        <div className="fem-row">Nombre <input value={d.name} disabled={d.isDefault} onChange={(e) => up({ name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} style={{ flex: 1 }} /></div>
        {!d.isDefault && <div className="fem-row seg-mini">
          {(['mate', 'insert', 'composite'] as EPointKind[]).map((k) => <button key={k} className={d.kind === k ? 'on' : ''} onClick={() => up({ kind: k, members: k === 'composite' ? d.members ?? [] : undefined })}>{EP_KIND_NAMES[k]}</button>)}
        </div>}
        <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
          {d.isDefault ? 'Punto por el que se coge la pieza al colocarla en un ensamblaje.'
            : d.kind === 'mate' ? 'Cara plana: al colocar la pieza se enfrenta con el ePoint de coincidencia del mismo nombre de otro componente.'
            : d.kind === 'insert' ? 'Eje de un cilindro en su extremo: se inserta en el ePoint de inserción del mismo nombre (tornillo ↔ taladro).'
            : 'Agrupa varios ePoints: se conectan todos a la vez con el compuesto del mismo nombre de otro componente.'}
        </p>
        {d.kind !== 'composite' && <>
          <div className="ep-modes">
            {([['facec', 'Centro de cara', 'Centro de una cara plana (o eje de una cara cilíndrica)'], ['face', 'Punto de cara', 'Punto donde se hace clic en la cara'], ['circle', 'Círculo', 'Arista circular: centro y eje (conducto o accesorio circular)'], ['edges3', '3 aristas', 'Boca rectangular hueca: tres aristas de sus lados'], ['oval2', 'Oval', 'Dos aristas rectas (lados planos) de una boca oval']] as const).map(([k, l, t]) => {
              const tool = k === 'face' || k === 'facec' ? 'epPick' : 'epEdge';
              const on = s.epMode === k && s.tool === tool;
              return <button key={k} className={`btn sm ${on ? 'primary' : ''}`} title={t} onClick={() => s.set({ epMode: k, epEdges: [], tool: on ? null : tool })}>{l}</button>;
            })}
          </div>
          {(s.tool === 'epPick' || s.tool === 'epEdge') && <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>{s.tool === 'epPick' ? (s.epMode === 'face' ? 'Clic en el punto de la cara…' : 'Clic en una cara: se toma su centro…') : `Elige ${s.epMode === 'circle' ? 'la arista circular' : s.epMode === 'oval2' ? 'las 2 aristas rectas' : 'las 3 aristas de los lados'} (${s.epEdges.length}/${s.epMode === 'circle' ? 1 : s.epMode === 'oval2' ? 2 : 3})…`}</p>}
          <div className="fem-row"><button className="btn sm" onClick={() => up({ dir: d.dir.map((x) => -x) as V3 })}>Invertir dirección</button></div>
          <div className="fem-row">Punto X {num(d.point[0], (x) => up({ point: [x, d.point[1], d.point[2]] }))} Y {num(d.point[1], (x) => up({ point: [d.point[0], x, d.point[2]] }))} Z {num(d.point[2], (x) => up({ point: [d.point[0], d.point[1], x] }))}</div>
          <div className="fem-row">Dirección {num(d.dir[0], (x) => up({ dir: [x, d.dir[1], d.dir[2]] }))} {num(d.dir[1], (x) => up({ dir: [d.dir[0], x, d.dir[2]] }))} {num(d.dir[2], (x) => up({ dir: [d.dir[0], d.dir[1], x] }))}</div>
          {d.kind === 'insert' && !d.isDefault && <div className="fem-row">Radio {num(d.radius ?? 5, (x) => up({ radius: x }))} mm</div>}
          {!d.isDefault && <div className="fem-row">Desfase al conectar <input value={d.offset ?? '0'} onChange={(e) => up({ offset: e.target.value })} onKeyDown={(e) => e.stopPropagation()} style={{ width: 70 }} /> mm</div>}
        </>}
        {d.kind === 'composite' && <div className="ep-members">
          {list.filter((e) => !e.isDefault && e.kind !== 'composite').map((e) => (
            <label key={e.id} className="check"><input type="checkbox" checked={!!d.members?.includes(e.id)} onChange={(ev) => up({ members: ev.target.checked ? [...(d.members ?? []), e.id] : (d.members ?? []).filter((x) => x !== e.id) })} /> {e.name} <span className="muted">({EP_KIND_NAMES[e.kind]})</span></label>
          ))}
          {list.filter((e) => !e.isDefault && e.kind !== 'composite').length < 2 && <p className="muted">Crea antes al menos dos ePoints de coincidencia o inserción.</p>}
        </div>}
        <div className="modal-btns">
          {editing && <button className="btn" onClick={() => { setEditing(null); setD(blank()); }}>Cancelar</button>}
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={save}>{editing ? 'Guardar' : 'Añadir ePoint'}</button>
        </div>
      </div>
    </div>
  );
}
