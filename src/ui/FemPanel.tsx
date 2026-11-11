import { useEffect, useRef, useState } from 'react';
import { useStore, type FemLoad, type FemState } from '../core/store';
import type { FemIn, FemOut } from '../worker/fem.worker';
import { Icon } from './icons';

/** Propiedades elásticas y límite elástico por material (MPa) */
export function elastic(name: string): { E: number; nu: number; fy: number } {
  const n = name.toLowerCase();
  if (/s355/.test(n)) return { E: 210000, nu: 0.3, fy: 355 };
  if (/s235/.test(n)) return { E: 210000, nu: 0.3, fy: 235 };
  if (/inox|316|304/.test(n)) return { E: 193000, nu: 0.3, fy: 220 };
  if (/5083/.test(n)) return { E: 70000, nu: 0.33, fy: 125 };
  if (/alumin/.test(n)) return { E: 69000, nu: 0.33, fy: 240 };
  if (/fundici|gjl/.test(n)) return { E: 110000, nu: 0.26, fy: 165 };
  if (/gjs|nodular/.test(n)) return { E: 169000, nu: 0.275, fy: 250 };
  if (/lat[oó]n/.test(n)) return { E: 100000, nu: 0.34, fy: 200 };
  if (/cobre/.test(n)) return { E: 117000, nu: 0.34, fy: 70 };
  if (/titan/.test(n)) return { E: 114000, nu: 0.34, fy: 880 };
  if (/pvc|pp|pe|pl[aá]stic|abs|nylon|poliamida/.test(n)) return { E: 2500, nu: 0.38, fy: 40 };
  if (/madera/.test(n)) return { E: 11000, nu: 0.3, fy: 24 };
  return { E: 210000, nu: 0.3, fy: 275 };
}

/** Escala de color azul → cian → verde → amarillo → rojo */
export function femColor(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  const stops: [number, number, number][] = [[0.13, 0.25, 0.85], [0.1, 0.75, 0.9], [0.2, 0.8, 0.25], [0.95, 0.85, 0.15], [0.9, 0.15, 0.1]];
  const x = t * 4, i = Math.min(3, Math.floor(x)), f = x - i, a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

const fmt = (x: number, d = 2) => (isFinite(x) ? x.toLocaleString('es-ES', { maximumFractionDigits: d }) : '—');

export default function FemPanel({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const fem = s.fem;
  const mesh = s.result?.mesh;
  const mat = s.kind === 'part' ? s.doc.iProperties.material : '';
  const [props, setProps] = useState(() => elastic(mat));
  const [prog, setProg] = useState(0);
  const wk = useRef<Worker | null>(null);

  // Al abrir: estado inicial con tamaño de elemento ≈ diagonal/40
  useEffect(() => {
    const st = useStore.getState();
    if (st.kind !== 'part') return;
    if (!st.fem || st.fem.part !== st.active) {
      let h = 2;
      const m = st.result?.mesh;
      if (m) {
        const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < m.vertices.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], m.vertices[i + k]); mx[k] = Math.max(mx[k], m.vertices[i + k]); }
        const d = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
        // ~ 60 000 vóxeles para un bloque macizo; se redondea a un valor cómodo
        h = Math.cbrt((d[0] * d[1] * d[2]) / 60000);
        h = Math.max(h, Math.max(...d) / 120);
        const nice = [0.1, 0.2, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100];
        h = nice.find((x) => x >= h) ?? h;
      }
      st.set({ fem: { part: st.active, pick: 'fixed', fixed: [], loads: [{ faces: [], kind: 'force', F: [0, 0, -1000], p: 1 }], h, show: 'vm' } });
    }
    st.set({ tool: 'femFace' });
    return () => { wk.current?.terminate(); const t = useStore.getState(); if (t.tool === 'femFace') t.set({ tool: null }); };
  }, []);
  useEffect(() => { setProps(elastic(mat)); }, [mat]);

  if (s.kind !== 'part' || !fem || fem.part !== s.active) return null;
  const upd = (p: Partial<FemState>) => s.set({ fem: { ...fem, ...p } });
  const updLoad = (i: number, p: Partial<FemLoad>) => upd({ loads: fem.loads.map((l, j) => (j === i ? { ...l, ...p } : l)), res: undefined });
  const pickBtn = (k: 'fixed' | number, n: number) => (
    <button className={`btn sm ${fem.pick === k && s.tool === 'femFace' ? 'primary' : ''}`} onClick={() => { upd({ pick: k }); s.set({ tool: 'femFace' }); }}>
      {fem.pick === k && s.tool === 'femFace' ? 'Eligiendo…' : 'Elegir caras'} ({n})
    </button>
  );

  const run = () => {
    if (!mesh) { s.notify('La pieza no tiene sólido', 'error'); return; }
    if (!fem.fixed.length) { s.notify('Elige al menos una cara fija', 'error'); return; }
    if (!fem.loads.some((l) => l.faces.length)) { s.notify('Elige las caras de alguna carga', 'error'); return; }
    wk.current?.terminate();
    const w = new Worker(new URL('../worker/fem.worker.ts', import.meta.url), { type: 'module' });
    wk.current = w;
    upd({ running: true, res: undefined }); setProg(0);
    const t0 = useStore.getState().fem!;
    w.onmessage = (ev: MessageEvent<{ progress?: number; done?: FemOut }>) => {
      if (ev.data.progress != null) { setProg(ev.data.progress); return; }
      const r = ev.data.done!;
      w.terminate(); wk.current = null;
      const cur = useStore.getState().fem; if (!cur) return;
      if (r.error) { useStore.getState().set({ fem: { ...cur, running: false } }); useStore.getState().notify(r.error, 'error'); return; }
      useStore.getState().set({ fem: { ...cur, running: false, show: 'vm', res: { vm: r.vmVert, disp: r.dispVert, vmMax: r.vmMax, dispMax: r.dispMax, nVox: r.nVox, nDof: r.nDof, iters: r.iters, ms: r.ms, mesh, disp3: { vertices: r.vertices!, normals: r.normals!, triangles: r.triangles! } } }, tool: null });
    };
    w.onerror = (e) => { useStore.getState().set({ fem: { ...useStore.getState().fem!, running: false } }); useStore.getState().notify('FEM: ' + e.message, 'error'); };
    const inp: FemIn = {
      vertices: mesh.vertices.slice(), normals: mesh.normals.slice(), triangles: mesh.triangles.slice(), faceGroups: mesh.faceGroups.map((g) => ({ start: g.start, count: g.count })),
      h: t0.h, E: props.E, nu: props.nu, fixed: t0.fixed,
      loads: t0.loads.filter((l) => l.faces.length).map((l) => (l.kind === 'force' ? { faces: l.faces, F: l.F } : { faces: l.faces, p: l.p })),
    };
    w.postMessage(inp);
  };

  const r = fem.res;
  const sf = r ? props.fy / Math.max(r.vmMax, 1e-9) : NaN;
  const num = (v: number, on: (x: number) => void, w = 64) => <input className="num" style={{ width: w }} type="number" value={v} onChange={(e) => on(parseFloat(e.target.value) || 0)} />;

  return (
    <div className="fem-panel" role="dialog" aria-label="Análisis de tensiones">
      <div className="modal-head"><span>Análisis de tensiones (FEM lineal)</span><button className="x" onClick={onClose} aria-label="Cerrar"><Icon name="close" size={18} /></button></div>
      <div className="modal-body">
        <div className="fem-row"><b>Material</b><span className="muted">{mat}</span></div>
        <div className="fem-row">E {num(props.E, (x) => setProps({ ...props, E: x }), 80)} MPa · ν {num(props.nu, (x) => setProps({ ...props, nu: x }), 54)} · Re {num(props.fy, (x) => setProps({ ...props, fy: x }), 60)} MPa</div>
        <div className="fem-row"><span className="fem-sw" style={{ background: '#2f6fe0' }} /> <b>Restricción fija</b> {pickBtn('fixed', fem.fixed.length)}</div>
        {fem.loads.map((l, i) => (
          <div key={i} className="fem-load">
            <div className="fem-row"><span className="fem-sw" style={{ background: '#e0452f' }} /> <b>Carga {i + 1}</b>
              <select value={l.kind} onChange={(e) => updLoad(i, { kind: e.target.value as FemLoad['kind'] })}><option value="force">Fuerza total (N)</option><option value="pressure">Presión (MPa)</option></select>
              {pickBtn(i, l.faces.length)}
              {fem.loads.length > 1 && <button className="btn sm" title="Quitar carga" onClick={() => upd({ loads: fem.loads.filter((_, j) => j !== i), pick: 'fixed', res: undefined })}>✕</button>}
            </div>
            {l.kind === 'force'
              ? <div className="fem-row">Fx {num(l.F[0], (x) => updLoad(i, { F: [x, l.F[1], l.F[2]] }), 72)} Fy {num(l.F[1], (x) => updLoad(i, { F: [l.F[0], x, l.F[2]] }), 72)} Fz {num(l.F[2], (x) => updLoad(i, { F: [l.F[0], l.F[1], x] }), 72)} N</div>
              : <div className="fem-row">p {num(l.p, (x) => updLoad(i, { p: x }))} MPa (perpendicular, hacia la pieza)</div>}
          </div>
        ))}
        <div className="fem-row"><button className="btn sm" onClick={() => upd({ loads: [...fem.loads, { faces: [], kind: 'force', F: [0, 0, -1000], p: 1 }], pick: fem.loads.length })}>+ Añadir carga</button></div>
        <div className="fem-row">Tamaño de elemento {num(fem.h, (x) => upd({ h: Math.max(0.05, x), res: undefined }))} mm <span className="muted">(menor = más preciso y más lento)</span></div>
        <div className="modal-btns">
          <button className="btn primary" disabled={!!fem.running} onClick={run}>{fem.running ? `Calculando… ${prog ? `(it. ${prog})` : ''}` : 'Calcular'}</button>
          {r && <><button className={`btn sm ${fem.show === 'vm' ? 'primary' : ''}`} onClick={() => upd({ show: 'vm' })}>σ von Mises</button><button className={`btn sm ${fem.show === 'disp' ? 'primary' : ''}`} onClick={() => upd({ show: 'disp' })}>Desplazamiento</button></>}
        </div>
        {r && (
          <>
            <div className="fem-legend">
              <div className="fem-bar" />
              <div className="fem-scale"><span>0</span><span>{fmt((fem.show === 'vm' ? r.vmMax : r.dispMax) / 2, 3)}</span><span>{fmt(fem.show === 'vm' ? r.vmMax : r.dispMax, 3)} {fem.show === 'vm' ? 'MPa' : 'mm'}</span></div>
            </div>
            <table className="ptable"><tbody>
              <tr><td>σ von Mises máx. (P99,5)</td><td className="num">{fmt(r.vmMax, 1)} MPa</td></tr>
              <tr><td>Desplazamiento máx.</td><td className="num">{fmt(r.dispMax, 4)} mm</td></tr>
              <tr><td>Coef. de seguridad Re/σ</td><td className="num" style={{ color: sf < 1 ? 'var(--danger)' : sf < 1.5 ? '#c98a00' : 'var(--ok, #2a9d4b)' }}>{fmt(sf, 2)}</td></tr>
              <tr><td>Elementos / GDL</td><td className="num">{r.nVox.toLocaleString('es-ES')} / {r.nDof.toLocaleString('es-ES')}</td></tr>
              <tr><td>Iteraciones · tiempo</td><td className="num">{r.iters} · {fmt(r.ms / 1000, 1)} s</td></tr>
            </tbody></table>
            <p className="muted" style={{ fontSize: 11.5 }}>Hexaedros de 8 nudos sobre la pieza voxelizada; los valores cerca de aristas vivas y apoyos son orientativos. Afina el tamaño de elemento para comprobar la convergencia.</p>
          </>
        )}
      </div>
    </div>
  );
}
