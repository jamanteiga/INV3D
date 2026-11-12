// Barra de vista superpuesta en el área gráfica:
// zoom ajustar / encuadre, vista anterior, vista de sección, orientación, estilo de visualización, ocultar/mostrar y escena.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore, type HudState } from '../core/store';
import { toggleClipTool } from './ClipBar';

const sv = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
);
// Cubo isométrico base para los iconos de estilo
const CUBE = 'M12 3l8 4.5v9L12 21l-8-4.5v-9z';
const ICONS: Record<string, ReactNode> = {
  fit: sv(<><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5.5 5.5M7.5 10.5h6M10.5 7.5v6" /><path d="M2.5 6V2.5H6M18 2.5h3.5V6M2.5 18v3.5H6" opacity=".55" /></>),
  zoomarea: sv(<><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5.5 5.5" /><rect x="7.5" y="8" width="6" height="5" strokeDasharray="1.6 1.4" /></>),
  prev: sv(<><path d="M9 5L4 10l5 5" /><path d="M4 10h10a5 5 0 0 1 0 10h-4" /></>),
  section: sv(<><path d={CUBE} opacity=".45" /><path d="M12 3v9l8 4.5M12 12l-8 4.5" opacity=".45" /><path d="M5 9.5l14-4v9l-14 4z" fill="currentColor" fillOpacity=".25" /></>),
  orient: sv(<><path d={CUBE} /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /><path d="M4 7.5l8-4.5 8 4.5-8 4.5z" fill="currentColor" fillOpacity=".3" /></>),
  shadedEdges: sv(<><path d={CUBE} fill="currentColor" fillOpacity=".35" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>),
  shaded: sv(<><path d={CUBE} fill="currentColor" fillOpacity=".55" stroke="none" /><path d="M12 12l8-4.5v9L12 21z" fill="currentColor" fillOpacity=".35" stroke="none" /></>),
  hlr: sv(<><path d={CUBE} /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>),
  hlv: sv(<><path d={CUBE} /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /><path d="M12 3v0M4 16.5l8-4.5 8 4.5" strokeDasharray="1.6 1.6" opacity=".6" /></>),
  wire: sv(<><path d={CUBE} /><path d="M4 7.5l8 4.5 8-4.5M12 12v9M4 16.5l8-4.5 8 4.5M12 3v9" opacity=".75" /></>),
  eye: sv(<><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  scene: sv(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 15l5-5 4 4 3-3 6 6" /><circle cx="16" cy="8.5" r="1.6" /></>),
  clipmode: sv(<><path d="M4 7l8-4 8 4v10l-8 4-8-4z" opacity=".45" /><path d="M2 13h20" strokeWidth="2" /><path d="M4 13l8 4 8-4v4l-8 4-8-4z" fill="currentColor" fillOpacity=".3" /></>),
  caret: <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>,
};

type DS = 'shadedEdges' | 'shaded' | 'hlr' | 'hlv' | 'wire';
const STYLES: [DS, string][] = [['shadedEdges', 'Sombreado con aristas'], ['shaded', 'Sombreado'], ['hlr', 'Sin líneas ocultas'], ['hlv', 'Líneas ocultas visibles'], ['wire', 'Estructura alámbrica']];
const ORIENTS: [string, string][] = [['front', 'Frontal'], ['back', 'Posterior'], ['left', 'Izquierda'], ['right', 'Derecha'], ['top', 'Superior'], ['bottom', 'Inferior'], ['iso', 'Isométrica'], ['dimetric', 'Dimétrica'], ['trimetric', 'Trimétrica'], ['home', 'Inicio']];
const SCENES: [HudState['scene'], string, string][] = [
  ['grad', 'Degradado claro', 'linear-gradient(180deg,#d6dee7,#f5f7f9)'], ['white', 'Blanco liso', '#ffffff'], ['studio', 'Estudio gris', 'radial-gradient(circle at 50% 35%,#f4f4f4,#a9adb3)'],
  ['blue', 'Azul cielo', 'linear-gradient(180deg,#a7c3e6,#ffffff)'], ['dark', 'Oscuro', 'linear-gradient(180deg,#232a33,#39424e)'],
];

export default function HeadsUp({ kind }: { kind: 'part' | 'asm' }) {
  const s = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('pointerdown', off, true); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', off, true); window.removeEventListener('keydown', esc); };
  }, [open]);
  const hud = s.hud;
  const setHud = (p: Partial<HudState>) => s.set({ hud: { ...hud, ...p } });
  const ds: DS = s.wire ? 'wire' : hud.style === 'hlr' ? 'hlr' : hud.style === 'hlv' ? 'hlv' : s.showEdges ? 'shadedEdges' : 'shaded';
  const setDs = (d: DS) => {
    s.set({ wire: d === 'wire', showEdges: d !== 'shaded', hud: { ...hud, style: d === 'hlr' || d === 'hlv' ? d : 'shaded' } });
    setOpen(null);
  };
  const B = ({ id, icon, title, onClick, active, drop }: { id?: string; icon: string; title: string; onClick?: () => void; active?: boolean; drop?: boolean }) => (
    <button className={`hu-btn ${active ? 'on' : ''} ${drop && open === id ? 'open' : ''}`} title={title} aria-label={title}
      onClick={() => (drop ? setOpen(open === id ? null : id!) : (setOpen(null), onClick?.()))}>
      {ICONS[icon]}{drop && <span className="hu-caret">{ICONS.caret}</span>}
    </button>
  );
  const sketchMode = s.mode === 'sketch';

  return (
    <div className="hu" ref={ref} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <B icon="fit" title="Zoom para ajustar" onClick={() => s.setView('fit')} />
      <B icon="zoomarea" title="Zoom encuadre: arrastra un rectángulo (Esc cancela)" onClick={() => s.setView('zoomarea')} />
      <B icon="prev" title="Vista anterior" onClick={() => s.setView('prev')} />
      <span className="hu-sep" />
      <B icon="clipmode" title="Modo de recorte: corta la pieza o el ensamblaje por planos para ver el interior" onClick={() => toggleClipTool()} active={!!s.clipTool} />
      <div className="hu-dd">
        <B id="sec" icon="section" title="Vista de sección" drop active={!!s.clip} />
        {open === 'sec' && (
          <div className="hu-pop">
            <div className="hu-ttl">Vista de sección</div>
            <div className="hu-seg">
              {([['', 'Ninguna'], ['Y', 'Alzado'], ['Z', 'Planta'], ['X', 'Perfil']] as const).map(([k, l]) => (
                <button key={k} className={s.clip === k ? 'on' : ''} title={k ? `Plano ${k === 'X' ? 'YZ (derecha)' : k === 'Y' ? 'XZ (frontal)' : 'XY (superior)'}` : 'Sin sección'} onClick={() => s.set({ clip: k, hud: { ...hud, clipOff: k ? hud.clipOff : 0 } })}>{l}</button>
              ))}
            </div>
            <label className="hu-row">Desfase <input type="range" min={-50} max={50} step={1} disabled={!s.clip} value={Math.round(hud.clipOff * 100)} onChange={(e) => setHud({ clipOff: +e.target.value / 100 })} /><span className="hu-num">{Math.round(hud.clipOff * 100)} %</span></label>
            <label className="hu-row"><input type="checkbox" disabled={!s.clip} checked={hud.clipFlip} onChange={(e) => setHud({ clipFlip: e.target.checked })} /> Invertir el lado visible</label>
            <button className="hu-link" disabled={!s.clip && !hud.clipOff} onClick={() => { s.set({ clip: '', hud: { ...hud, clipOff: 0, clipFlip: false } }); setOpen(null); }}>Quitar sección</button>
          </div>
        )}
      </div>
      <div className="hu-dd">
        <B id="ori" icon="orient" title="Orientación de la vista" drop />
        {open === 'ori' && (
          <div className="hu-pop">
            <div className="hu-ttl">Orientación</div>
            <div className="hu-grid">
              {ORIENTS.map(([k, l]) => <button key={k} onClick={() => { s.setView(k); setOpen(null); }}>{l}</button>)}
            </div>
            {sketchMode && <button className="hu-link" onClick={() => { s.setView('sketch'); setOpen(null); }}>Normal al boceto</button>}
          </div>
        )}
      </div>
      <div className="hu-dd">
        <B id="ds" icon={ds} title={`Estilo de visualización: ${STYLES.find(([k]) => k === ds)![1]}`} drop />
        {open === 'ds' && (
          <div className="hu-pop hu-list">
            {STYLES.map(([k, l]) => <button key={k} className={ds === k ? 'on' : ''} onClick={() => setDs(k)}>{ICONS[k]}<span>{l}</span></button>)}
          </div>
        )}
      </div>
      <div className="hu-dd">
        <B id="vis" icon="eye" title="Ocultar/mostrar elementos" drop />
        {open === 'vis' && (
          <div className="hu-pop">
            <div className="hu-ttl">Ocultar/mostrar</div>
            {kind === 'part' && <label className="hu-row"><input type="checkbox" checked={hud.origin} onChange={(e) => setHud({ origin: e.target.checked })} /> Planos, ejes y puntos de trabajo</label>}
            {kind === 'part' && <label className="hu-row"><input type="checkbox" checked={hud.sketches} onChange={(e) => setHud({ sketches: e.target.checked })} /> Bocetos</label>}
            <label className="hu-row"><input type="checkbox" checked={hud.triad} onChange={(e) => setHud({ triad: e.target.checked })} /> Triedro de ejes</label>
            <label className="hu-row"><input type="checkbox" checked={!!hud.cog} onChange={(e) => setHud({ cog: e.target.checked })} /> Centro de gravedad (CDG)</label>
            <label className="hu-row"><input type="checkbox" checked={hud.cube} onChange={(e) => setHud({ cube: e.target.checked })} /> Cubo de vistas</label>
            <label className="hu-row"><input type="checkbox" checked={s.showEdges} disabled={s.wire || hud.style !== 'shaded'} onChange={(e) => s.set({ showEdges: e.target.checked })} /> Aristas</label>
          </div>
        )}
      </div>
      <span className="hu-sep" />
      <div className="hu-dd">
        <B id="scn" icon="scene" title="Aplicar escena (fondo)" drop />
        {open === 'scn' && (
          <div className="hu-pop hu-list">
            {SCENES.map(([k, l, bg]) => <button key={k} className={hud.scene === k ? 'on' : ''} onClick={() => { setHud({ scene: k }); setOpen(null); }}><span className="hu-sw" style={{ background: bg }} /><span>{l}</span></button>)}
          </div>
        )}
      </div>
    </div>
  );
}
