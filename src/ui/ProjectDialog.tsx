// Proyectos (.fdp): lista de proyectos y editor de opciones como el de Inventor 2027
import { useState } from 'react';
import { useStore } from '../core/store';
import { Modal, Row } from './Panels';
import { Icon } from './icons';
import { folderApi } from './session';
import { openFile } from '../core/files';
import {
  DEFAULT_SUBS, FDP_ROLES, newFdp, writeProject, activateProject, rememberProject, projectList, removeFromList, fdpText,
  type FdpProject, type FdpSub, type FdpRole, type FdpPath,
} from '../core/fdp';

type Sec = 'project' | 'workspace' | 'workgroups' | 'libraries' | 'favorites' | 'folders' | 'options' | 'subdirs';
const SECS: [Sec, string, string][] = [
  ['project', 'Proyecto', 'project'], ['workspace', 'Espacio de trabajo', 'folder'], ['subdirs', 'Subcarpetas del espacio de trabajo', 'folder'],
  ['workgroups', 'Rutas de búsqueda de grupo de trabajo', 'folder'], ['libraries', 'Bibliotecas', 'content'], ['favorites', 'Subcarpetas de uso frecuente', 'folder'],
  ['folders', 'Opciones de carpeta', 'folder'], ['options', 'Opciones', 'options'],
];

export default function ProjectDialog({ onClose, create }: { onClose: () => void; create?: boolean }) {
  const s = useStore();
  const act = s.project?.fdp ?? null;
  const [list, setList] = useState(() => projectList());
  const [selName, setSelName] = useState(act?.name ?? list[0]?.p.name ?? '');
  const sel = list.find((x) => x.p.name === selName)?.p ?? (act?.name === selName ? act : null);
  const [ed, setEd] = useState<FdpProject | null>(sel ? structuredClone(sel) : null);
  const [sec, setSec] = useState<Sec>('project');
  const [wizard, setWizard] = useState<boolean>(!!create || (!act && !list.length));
  const folderOk = folderApi.supported();

  const choose = (name: string) => { setSelName(name); const e = list.find((x) => x.p.name === name)?.p; setEd(e ? structuredClone(e) : null); };
  const dirty = !!ed && !!sel && fdpText(ed) !== fdpText(sel);
  const up = (patch: Partial<FdpProject>) => ed && setEd({ ...ed, ...patch });
  const save = async (activate = true) => {
    if (!ed) return;
    try { const msg = await writeProject(ed); if (activate) activateProject(ed, `${ed.name}.fdp`); else { (await import('../core/fdp')).storeInList(ed, `${ed.name}.fdp`); } setList(projectList()); setSelName(ed.name); s.notify(`Proyecto ${ed.name}: ${msg}`); }
    catch (e) { s.notify(`No se pudo guardar el proyecto: ${(e as Error).message}`, 'error'); }
  };
  const activate = () => { if (!ed) return; activateProject(ed, `${ed.name}.fdp`); setList(projectList()); s.notify(`Proyecto activo: ${ed.name}`); };

  if (wizard) return <NewProject onClose={onClose} onDone={(p) => { setWizard(false); setList(projectList()); setSelName(p.name); setEd(structuredClone(p)); }} onBack={list.length || act ? () => setWizard(false) : undefined} />;

  const PathList = ({ k, help, ro }: { k: 'workgroups' | 'libraries' | 'favorites'; help: string; ro?: boolean }) => {
    const L = ed![k];
    const set = (v: FdpPath[]) => up({ [k]: v } as Partial<FdpProject>);
    return (<>
      <p className="phelp">{help}</p>
      <table className="ptable"><tbody>
        <tr className="muted"><td>Nombre</td><td>Ruta (relativa a la carpeta del proyecto)</td><td /></tr>
        {L.map((x, i) => (
          <tr key={i}>
            <td><input value={x.name} onChange={(e) => set(L.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} onKeyDown={(e) => e.stopPropagation()} /></td>
            <td><input value={x.path} onChange={(e) => set(L.map((y, j) => (j === i ? { ...y, path: e.target.value } : y)))} onKeyDown={(e) => e.stopPropagation()} /></td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {ro && <span title="Solo lectura">🔒</span>}
              <button className="btn sm" disabled={i === 0} title="Subir (orden de búsqueda)" onClick={() => { const c = [...L]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; set(c); }}>↑</button>
              <button className="btn sm" title="Quitar" onClick={() => set(L.filter((_, j) => j !== i))}>✕</button>
            </td>
          </tr>))}
      </tbody></table>
      <button className="btn sm" onClick={() => set([...L, { name: `Nuevo ${L.length + 1}`, path: '' }])}>＋ Añadir ruta</button>
    </>);
  };

  return (
    <Modal title="Proyectos" onClose={onClose} xwide>
      <div className="prj-list">
        <table className="ptable"><thead><tr><th /><th>Nombre del proyecto</th><th>Ubicación del proyecto</th></tr></thead><tbody>
          {list.map((x) => (
            <tr key={x.p.name} className={x.p.name === selName ? 'sel' : ''} onClick={() => choose(x.p.name)} onDoubleClick={() => { choose(x.p.name); activateProject(x.p, x.fileName); setList(projectList()); }} style={{ cursor: 'pointer' }}>
              <td>{act?.name === x.p.name ? '✔' : ''}</td><td><Icon name="project" size={14} /> {x.p.name}</td><td className="mono">{x.p.workspace || '—'}</td>
            </tr>))}
          {!list.length && <tr><td colSpan={3} className="muted">No hay proyectos. Pulsa Nuevo o Examinar.</td></tr>}
        </tbody></table>
      </div>
      {ed && (
        <div className="prj-ed">
          <div className="prj-tree">
            {SECS.map(([k, l, ic]) => <button key={k} className={sec === k ? 'on' : ''} onClick={() => setSec(k)}><Icon name={ic} size={14} /> {l}</button>)}
          </div>
          <div className="prj-body">
            {sec === 'project' && (<>
              <Row label="Nombre"><input value={ed.name} onChange={(e) => up({ name: e.target.value.replace(/[\\/:*?"<>|]/g, '_') })} onKeyDown={(e) => e.stopPropagation()} /></Row>
              <Row label="Tipo"><select value={ed.type} onChange={(e) => up({ type: e.target.value as FdpProject['type'] })}><option value="single">Usuario único</option><option value="vault">Vault (servidor de datos)</option></select></Row>
              <Row label="Ubicación"><span className="ro">{ed.workspace || '—'}{s.folder.state === 'granted' ? ` · carpeta conectada: ${s.folder.name}` : ''}</span></Row>
              <Row label="Fichero incluido"><input value={ed.included} placeholder="p. ej. Comun/Empresa.fdp" onChange={(e) => up({ included: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></Row>
              <p className="phelp">El fichero incluido aporta sus rutas de grupo de trabajo y bibliotecas al abrir este proyecto.</p>
              {folderOk && <button className="btn sm" onClick={async () => { await folderApi.choose(); const f = useStore.getState().folder; if (f.state === 'granted') up({ workspace: f.name }); }}>Elegir carpeta del proyecto…</button>}
            </>)}
            {sec === 'workspace' && (<>
              <Row label="Espacio de trabajo"><input value={ed.wsPath} onChange={(e) => up({ wsPath: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></Row>
              <p className="phelp">Ruta relativa a la carpeta del proyecto donde se guardan los documentos («.» es la propia carpeta). Es la primera ruta de búsqueda.</p>
            </>)}
            {sec === 'subdirs' && (<>
              <p className="phelp">Subcarpetas dentro del espacio de trabajo. Al guardar un documento nuevo se propone la de su tipo.</p>
              <SubdirEditor subs={ed.subdirs} onChange={(v) => up({ subdirs: v })} />
            </>)}
            {sec === 'workgroups' && <PathList k="workgroups" help="Carpetas compartidas donde se buscan los ficheros que no están en el espacio de trabajo (en este orden)." />}
            {sec === 'libraries' && <PathList k="libraries" ro help="Carpetas de piezas normalizadas o compradas. Sus ficheros se abren en solo lectura: no se pueden sobrescribir (usa Guardar como)." />}
            {sec === 'favorites' && <PathList k="favorites" help="Accesos rápidos en Archivo › Abrir desde carpeta (★)." />}
            {sec === 'folders' && (<>
              <Row label="Datos de diseño (estilos)"><input value={ed.folders.styles} onChange={(e) => up({ folders: { ...ed.folders, styles: e.target.value } })} onKeyDown={(e) => e.stopPropagation()} /></Row>
              <Row label="Plantillas"><input value={ed.folders.templates} onChange={(e) => up({ folders: { ...ed.folders, templates: e.target.value } })} onKeyDown={(e) => e.stopPropagation()} /></Row>
              <Row label="Ficheros del centro de contenido"><input value={ed.folders.content} onChange={(e) => up({ folders: { ...ed.folders, content: e.target.value } })} onKeyDown={(e) => e.stopPropagation()} /></Row>
              <p className="phelp">Las plantillas (.i3p, .i3a, .i3d) de esa carpeta aparecen en Archivo › Nuevo. Las piezas del centro de contenido que se colocan se guardan en su carpeta (HVAC, Tubería, Mecánica).</p>
            </>)}
            {sec === 'options' && (<>
              <Row label="Versiones antiguas a conservar"><input className="num" type="number" min={0} max={99} value={ed.options.oldVersions} onChange={(e) => up({ options: { ...ed.options, oldVersions: Math.max(0, Math.min(99, parseInt(e.target.value) || 0)) } })} /></Row>
              <p className="phelp">Al guardar se copia la versión anterior a <code>OldVersions/nombre.0001.ext</code> (0 = no se guardan).</p>
              <label className="check"><input type="checkbox" checked={ed.options.uniqueNames} onChange={(e) => up({ options: { ...ed.options, uniqueNames: e.target.checked } })} />Usar nombres de fichero únicos (aviso al guardar un nombre repetido)</label>
              <label className="check"><input type="checkbox" checked={ed.options.contentAutoSave} onChange={(e) => up({ options: { ...ed.options, contentAutoSave: e.target.checked } })} />Guardar las piezas del centro de contenido en su carpeta al colocarlas</label>
              <Row label="Acceso directo"><input value={ed.options.shortcut} onChange={(e) => up({ options: { ...ed.options, shortcut: e.target.value } })} onKeyDown={(e) => e.stopPropagation()} /></Row>
              <Row label="Propietario"><input value={ed.options.owner} onChange={(e) => up({ options: { ...ed.options, owner: e.target.value } })} onKeyDown={(e) => e.stopPropagation()} /></Row>
              <Row label="ID de versión"><input value={ed.options.releaseId} onChange={(e) => up({ options: { ...ed.options, releaseId: e.target.value } })} onKeyDown={(e) => e.stopPropagation()} /></Row>
            </>)}
          </div>
        </div>
      )}
      <div className="modal-btns">
        <button className="btn" onClick={() => setWizard(true)}>Nuevo…</button>
        <button className="btn" onClick={() => openFile()}>Examinar…</button>
        {ed && <button className="btn" onClick={() => { removeFromList(ed.name); if (act?.name === ed.name) { useStore.setState({ project: null }); rememberProject(null); } setList(projectList()); setEd(null); setSelName(''); }}>Quitar de la lista</button>}
        {act && <button className="btn" onClick={() => { useStore.setState({ project: null }); rememberProject(null); setList(projectList()); }}>Cerrar proyecto</button>}
        <span className="grow" />
        {ed && act?.name !== ed.name && <button className="btn" onClick={activate}>Aplicar (activar)</button>}
        {ed && <button className="btn primary" onClick={() => void save(act?.name === ed.name || !act)}>{dirty ? 'Guardar *' : 'Guardar'}</button>}
        <button className="btn" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}

function SubdirEditor({ subs, onChange }: { subs: FdpSub[]; onChange: (v: FdpSub[]) => void }) {
  const [nsub, setNsub] = useState('');
  const add = () => { const v = nsub.trim().replace(/^[\\/]+|[\\/]+$/g, ''); if (!v || subs.some((x) => x.path === v)) return; onChange([...subs, { path: v, role: '' }]); setNsub(''); };
  return (
    <table className="ptable"><tbody>
      {subs.map((x, i) => (
        <tr key={i}>
          <td style={{ width: '55%' }}><input value={x.path} onChange={(e) => onChange(subs.map((y, k) => (k === i ? { ...y, path: e.target.value } : y)))} onKeyDown={(e) => e.stopPropagation()} /></td>
          <td><select value={x.role} onChange={(e) => onChange(subs.map((y, k) => (k === i ? { ...y, role: e.target.value as FdpRole } : y)))}>{(Object.keys(FDP_ROLES) as FdpRole[]).map((r) => <option key={r} value={r}>{r ? `Para ${FDP_ROLES[r].toLowerCase()}` : 'Otro'}</option>)}</select></td>
          <td><button className="btn sm" title="Quitar" onClick={() => onChange(subs.filter((_, k) => k !== i))}>✕</button></td>
        </tr>))}
      <tr><td><input value={nsub} placeholder="Nueva subcarpeta (p. ej. Piezas/Chapa)" onChange={(e) => setNsub(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') add(); }} /></td><td colSpan={2}><button className="btn sm" onClick={add}>＋ Añadir</button></td></tr>
    </tbody></table>
  );
}

/** Asistente de proyecto nuevo: nombre, carpeta del proyecto (directorio de trabajo) y subcarpetas */
function NewProject({ onClose, onDone, onBack }: { onClose: () => void; onDone: (p: FdpProject) => void; onBack?: () => void }) {
  const s = useStore();
  const [name, setName] = useState('Proyecto');
  const [ws, setWs] = useState(s.folder.state === 'granted' ? s.folder.name : '');
  const [subs, setSubs] = useState<FdpSub[]>(DEFAULT_SUBS.map((x) => ({ ...x })));
  const [lib, setLib] = useState(true);
  const folderOk = folderApi.supported();
  const create = async () => {
    const nm = name.trim().replace(/[\\/:*?"<>|]/g, '_'); if (!nm) { s.notify('Pon un nombre al proyecto', 'error'); return; }
    const p = newFdp(nm, ws.trim(), subs); if (!lib) p.libraries = [];
    try { const msg = await writeProject(p); activateProject(p, `${nm}.fdp`); s.notify(`Proyecto ${nm}: ${msg}`); onDone(p); }
    catch (e) { s.notify(`No se pudo crear el proyecto: ${(e as Error).message}`, 'error'); }
  };
  return (
    <Modal title="Nuevo proyecto (.fdp)" onClose={onClose} wide>
      <Row label="Tipo"><span className="ro">Usuario único</span></Row>
      <Row label="Nombre"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></Row>
      <Row label="Directorio de trabajo">
        <div style={{ display: 'flex', gap: 4, width: '100%' }}>
          <input style={{ flex: 1 }} value={ws} placeholder={folderOk ? 'Elige una carpeta…' : 'p. ej. D:\\Proyectos\\Obra 25'} onChange={(e) => setWs(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          {folderOk && <button className="btn sm" onClick={async () => { await folderApi.choose(); const f = useStore.getState().folder; if (f.state === 'granted') setWs(f.name); }}>Elegir carpeta…</button>}
        </div>
      </Row>
      {!folderOk && <p className="phelp">Este navegador (o la vista incrustada) no da acceso a carpetas: el .fdp se descarga y las carpetas se crean a mano. En Chrome/Edge abriendo la web directamente se crean solas.</p>}
      <div className="plabel">Subcarpetas del espacio de trabajo</div>
      <SubdirEditor subs={subs} onChange={setSubs} />
      <label className="check"><input type="checkbox" checked={lib} onChange={(e) => setLib(e.target.checked)} />Crear biblioteca (solo lectura) «Bibliotecas», plantillas, datos de diseño y centro de contenido</label>
      <p className="phelp">Después, en Proyectos se editan las rutas de grupo de trabajo, bibliotecas, subcarpetas de uso frecuente, carpetas y opciones, como en Inventor.</p>
      <div className="modal-btns">
        {onBack && <button className="btn" onClick={onBack}>Volver</button>}
        <span className="grow" />
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={() => void create()}>Crear proyecto</button>
      </div>
    </Modal>
  );
}
