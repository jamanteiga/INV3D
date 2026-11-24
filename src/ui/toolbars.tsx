// Barras de herramientas flotantes personalizadas: cualquier botón de la cinta (clic derecho › Añadir a barra)
// o comando con atajo, en barras con nombre que se arrastran por la pantalla y se recuerdan.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useStore } from '../core/store';
import { Icon } from './icons';
import { COMMANDS } from './commands';

export interface BarItem { key: string; label: string; icon: string; kind?: string; tab?: string; tabLabel?: string; cmd?: string }
export interface Bar { id: string; name: string; x: number; y: number; vertical: boolean; visible: boolean; big: boolean; items: BarItem[] }
interface BarsState { bars: Bar[]; menu: { x: number; y: number; item: BarItem } | null }
const LS = 'inv3d.bars';
const load = (): Bar[] => { try { return JSON.parse(localStorage.getItem(LS) ?? '[]') as Bar[]; } catch { return []; } };
export const useBars = create<BarsState>(() => ({ bars: load(), menu: null }));
useBars.subscribe((s, p) => { if (s.bars !== p.bars) { try { localStorage.setItem(LS, JSON.stringify(s.bars)); } catch { /* */ } } });
const setBars = (fn: (b: Bar[]) => Bar[]) => useBars.setState({ bars: fn(useBars.getState().bars) });
export const newBar = (name: string, items: BarItem[] = []): Bar => ({ id: Math.random().toString(36).slice(2, 9), name, x: 260, y: 170 + useBars.getState().bars.length * 50, vertical: false, visible: true, big: false, items });
export const barsApi = {
  add: (b: Bar) => setBars((l) => [...l, b]),
  update: (id: string, patch: Partial<Bar>) => setBars((l) => l.map((b) => (b.id === id ? { ...b, ...patch } : b))),
  remove: (id: string) => setBars((l) => l.filter((b) => b.id !== id)),
  addItem: (id: string, it: BarItem) => setBars((l) => l.map((b) => (b.id === id && !b.items.some((x) => x.key === it.key) ? { ...b, items: [...b.items, it] } : b))),
};

// ---------- Registro de botones de la cinta ----------
export interface RibbonCtx { kind: string; tab: string; tabLabel: string }
export const TabCtx = createContext<RibbonCtx | null>(null);
const registry = new Map<string, { label: string; icon: string; run: () => void; kind: string; tab: string; tabLabel: string }>();
export const ribbonItems = () => [...registry.entries()].map(([key, v]) => ({ key, ...v }));
/** Control de la cinta (lo rellena Ribbon): cambiar de pestaña para ejecutar un botón de otra pestaña */
export const ribbonCtl: { setTab: (t: string) => void; tab: string; tabs: string[] } = { setTab: () => {}, tab: '', tabs: [] };
/** Lo llaman Big/Small/SplitBig: registra el botón y devuelve el manejador de clic derecho */
export function useRibbonReg(label: string, icon: string, run?: () => void) {
  const c = useContext(TabCtx);
  if (!c || !run) return undefined;
  const key = `${c.kind}|${c.tab}|${label}`;
  registry.set(key, { label, icon, run, ...c });
  return (e: React.MouseEvent) => { e.preventDefault(); useBars.setState({ menu: { x: e.clientX, y: e.clientY, item: { key, label, icon, kind: c.kind, tab: c.tab, tabLabel: c.tabLabel } } }); };
}
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
/** Recorre todas las pestañas de la cinta para registrar sus botones (para el editor de barras) */
export async function collectRibbon() {
  const prev = ribbonCtl.tab;
  for (const t of [...ribbonCtl.tabs]) { ribbonCtl.setTab(t); await frame(); await frame(); }
  ribbonCtl.setTab(prev); await frame();
}
/** Ejecuta un elemento de barra */
export async function runItem(it: BarItem) {
  const s = useStore.getState();
  if (it.cmd) { const c = COMMANDS.find((x) => x.id === it.cmd); if (c) c.run(s); return; }
  if (it.kind && it.kind !== s.kind) { s.notify(`«${it.label}» es de ${it.kind === 'part' ? 'pieza' : it.kind === 'assembly' ? 'ensamblaje' : 'dibujo'}`, 'error'); return; }
  if (it.tab && !ribbonCtl.tabs.includes(it.tab)) { s.notify(`«${it.label}» no está disponible ahora (pestaña ${it.tabLabel ?? it.tab})`, 'error'); return; }
  const prev = ribbonCtl.tab;
  if (it.tab && it.tab !== prev) { ribbonCtl.setTab(it.tab); await frame(); await frame(); }
  const r = registry.get(it.key);
  if (!r) s.notify(`«${it.label}» no está en la cinta actual`, 'error');
  else r.run();
  if (it.tab && it.tab !== prev) { await frame(); ribbonCtl.setTab(prev); }
}

const CMD_ICON: Record<string, string> = {
  'file.new': 'newfile', 'file.open': 'open', 'file.save': 'save', 'file.saveas': 'save', 'edit.undo': 'undo', 'edit.redo': 'redo', 'tools.params': 'params', 'tools.iprops': 'iprops',
  'tools.rebuild': 'refresh', 'view.home': 'home', 'view.fit': 'fit', 'part.sketch': 'sketch', 'part.extrude': 'extrude', 'part.revolve': 'revolve', 'part.sweep': 'sweep', 'part.loft': 'loft',
  'part.hole': 'hole', 'part.fillet': 'fillet', 'part.chamfer': 'chamfer', 'part.shell': 'shell', 'part.mirror': 'mirror', 'part.workplane': 'workplane', 'part.workaxis': 'workaxis',
  'part.workpoint': 'workpoint', 'part.epoint': 'epoint', 'part.measure': 'measure', 'sk.line': 'line', 'sk.rect': 'rect', 'sk.circle': 'circle', 'sk.arc': 'arc', 'sk.dim': 'dim',
  'sk.trim': 'trim', 'sk.finish': 'finish', 'asm.place': 'place', 'asm.joint': 'constraint3d', 'asm.move': 'move', 'drw.section': 'section', 'drw.detail': 'detail',
};
export const cmdItem = (id: string): BarItem => { const c = COMMANDS.find((x) => x.id === id)!; return { key: `cmd|${id}`, cmd: id, label: c.label, icon: CMD_ICON[id] ?? 'options' }; };

// ---------- Barras en pantalla ----------
export function FloatBars() {
  const { bars, menu } = useBars();
  const s = useStore();
  return (<>
    {bars.filter((b) => b.visible).map((b) => <FloatBar key={b.id} b={b} kind={s.kind} />)}
    {menu && (<>
      <div className="menu-shade clear" onClick={() => useBars.setState({ menu: null })} onContextMenu={(e) => { e.preventDefault(); useBars.setState({ menu: null }); }} />
      <div className="rb-menu" style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 300 }}>
        <div className="muted" style={{ padding: '4px 8px', fontSize: 11 }}>Añadir «{menu.item.label}» a…</div>
        {bars.map((b) => <button key={b.id} onClick={() => { barsApi.addItem(b.id, menu.item); barsApi.update(b.id, { visible: true }); useBars.setState({ menu: null }); }}><Icon name="toolbar" size={18} />{b.name}</button>)}
        <button onClick={() => { const n = prompt('Nombre de la barra nueva', `Barra ${bars.length + 1}`); if (n) barsApi.add(newBar(n, [menu.item])); useBars.setState({ menu: null }); }}><Icon name="toolbar" size={18} />Barra nueva…</button>
        <button onClick={() => { useBars.setState({ menu: null }); useStore.getState().open({ kind: 'toolbars' } as never); }}><Icon name="options" size={18} />Personalizar barras…</button>
      </div>
    </>)}
  </>);
}

function FloatBar({ b, kind }: { b: Bar; kind: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: b.x, y: b.y });
  useEffect(() => setPos({ x: b.x, y: b.y }), [b.x, b.y]);
  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    const sx = e.clientX - pos.x, sy = e.clientY - pos.y;
    let last = pos;
    const mv = (ev: PointerEvent) => { last = { x: Math.max(0, Math.min(window.innerWidth - 40, ev.clientX - sx)), y: Math.max(0, Math.min(window.innerHeight - 30, ev.clientY - sy)) }; setPos(last); };
    const upf = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upf); barsApi.update(b.id, last); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upf);
  };
  const sz = b.big ? 26 : 18;
  return (
    <div ref={ref} className={`fbar ${b.vertical ? 'vert' : ''}`} style={{ left: pos.x, top: pos.y }} data-testid="fbar">
      <div className="fbar-grip" onPointerDown={drag} title={`${b.name} · arrastrar para mover`}><span>⋮⋮</span>{!b.vertical && <b>{b.name}</b>}</div>
      {b.items.map((it) => {
        const off = !!it.kind && it.kind !== kind;
        return <button key={it.key} className="fbar-b" disabled={off} title={`${it.label}${it.tabLabel ? ` (${it.tabLabel})` : ''}`} onClick={() => void runItem(it)}><Icon name={it.icon} size={sz} />{b.big && <span>{it.label}</span>}</button>;
      })}
      {!b.items.length && <span className="muted" style={{ fontSize: 11, padding: '0 6px' }}>Clic derecho en un botón de la cinta › Añadir</span>}
      <button className="fbar-b small" title="Personalizar" onClick={() => useStore.getState().open({ kind: 'toolbars' } as never)}>⚙</button>
      <button className="fbar-b small" title="Ocultar (Herramientas › Barras flotantes para mostrarla)" onClick={() => barsApi.update(b.id, { visible: false })}>✕</button>
    </div>
  );
}
