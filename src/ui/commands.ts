// Comandos con atajo de teclado personalizable (Herramientas › Atajos de teclado).
// Cada comando tiene un contexto (dónde vale), sus atajos por defecto y la acción.
import { useStore, type State } from '../core/store';
import { asmActions } from './actions';
import { saveDoc, openFile } from '../core/files';
import { toggleOsnap } from './osnap';
import { toggleClipTool } from './ClipBar';

export type Ctx = 'all' | 'part' | 'sketch' | 'model' | 'assembly' | 'drawing';
export const CTX_NAMES: Record<Ctx, string> = { all: 'Global', part: 'Pieza', model: 'Pieza (modelo)', sketch: 'Boceto', assembly: 'Ensamblaje', drawing: 'Dibujo' };
export interface Command { id: string; label: string; ctx: Ctx; keys: string[]; run: (s: State) => void }

const S = () => useStore.getState();
const feat = (k: Parameters<State['openFeatureDialog']>[0]) => (s: State) => s.openFeatureDialog(k);
const tool = (t: State['tool']) => (s: State) => s.setTool(t);
const view = (n: string) => (s: State) => s.setView(n);
const hud = (k: 'cog' | 'origin' | 'triad' | 'cube' | 'epoints') => (s: State) => s.set({ hud: { ...s.hud, [k]: k === 'epoints' ? s.hud.epoints === false : !s.hud[k] } });

export const COMMANDS: Command[] = [
  // Archivo y edición
  { id: 'file.new', label: 'Nuevo documento', ctx: 'all', keys: ['Ctrl+N'], run: (s) => s.open({ kind: 'newdoc' }) },
  { id: 'file.open', label: 'Abrir', ctx: 'all', keys: ['Ctrl+O'], run: () => { openFile(); } },
  { id: 'file.save', label: 'Guardar', ctx: 'all', keys: ['Ctrl+S'], run: () => { saveDoc(false); } },
  { id: 'file.saveas', label: 'Guardar como', ctx: 'all', keys: ['Ctrl+Shift+S'], run: () => { saveDoc(true); } },
  { id: 'edit.undo', label: 'Deshacer', ctx: 'all', keys: ['Ctrl+Z'], run: (s) => { if (s.placing) asmActions.finishPlace(); s.undo(); } },
  { id: 'edit.redo', label: 'Rehacer', ctx: 'all', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], run: (s) => { if (s.placing) asmActions.finishPlace(); s.redo(); } },
  { id: 'tools.params', label: 'Parámetros', ctx: 'part', keys: [], run: (s) => s.open({ kind: 'params' }) },
  { id: 'tools.iprops', label: 'iPropiedades', ctx: 'all', keys: [], run: (s) => s.open({ kind: 'iprops' }) },
  { id: 'tools.options', label: 'Opciones de la aplicación', ctx: 'all', keys: [], run: (s) => s.open({ kind: 'options' } as never) },
  { id: 'tools.keys', label: 'Atajos de teclado', ctx: 'all', keys: [], run: (s) => s.open({ kind: 'shortcuts' }) },
  { id: 'tools.osnap', label: 'Referencias a objetos (activar/desactivar)', ctx: 'all', keys: ['F3'], run: () => toggleOsnap() },
  { id: 'tools.osnapcfg', label: 'Referencias a objetos (modos)', ctx: 'all', keys: [], run: (s) => s.open({ kind: 'osnap' }) },
  // Vista
  { id: 'view.home', label: 'Vista inicial', ctx: 'all', keys: ['F6'], run: view('home') },
  { id: 'view.fit', label: 'Zoom para ajustar', ctx: 'all', keys: ['Home'], run: view('fit') },
  { id: 'view.iso', label: 'Vista isométrica', ctx: 'all', keys: [], run: view('iso') },
  { id: 'view.front', label: 'Vista frontal', ctx: 'all', keys: [], run: view('front') },
  { id: 'view.top', label: 'Vista superior', ctx: 'all', keys: [], run: view('top') },
  { id: 'view.right', label: 'Vista derecha', ctx: 'all', keys: [], run: view('right') },
  { id: 'view.prev', label: 'Vista anterior', ctx: 'all', keys: [], run: view('prev') },
  { id: 'view.cog', label: 'Ver/ocultar CDG', ctx: 'all', keys: [], run: hud('cog') },
  { id: 'view.origin', label: 'Ver/ocultar planos de origen', ctx: 'all', keys: [], run: hud('origin') },
  { id: 'view.epoints', label: 'Ver/ocultar ePoints (ensamblaje)', ctx: 'assembly', keys: [], run: hud('epoints') },
  { id: 'view.clip', label: 'Modo de recorte', ctx: 'all', keys: [], run: () => toggleClipTool() },
  { id: 'view.edges', label: 'Aristas (sí/no)', ctx: 'all', keys: [], run: (s) => s.set({ showEdges: !s.showEdges }) },
  { id: 'view.wire', label: 'Alámbrico (sí/no)', ctx: 'all', keys: [], run: (s) => s.set({ wire: !s.wire, showEdges: true }) },
  // Pieza
  { id: 'part.sketch', label: 'Nuevo boceto', ctx: 'model', keys: ['S'], run: tool('pickPlane') },
  { id: 'part.auxsketch', label: 'Boceto en auxiliar', ctx: 'model', keys: [], run: (s) => s.open({ kind: 'auxsketch' }) },
  { id: 'part.extrude', label: 'Extrusión', ctx: 'model', keys: ['E'], run: feat('extrude') },
  { id: 'part.revolve', label: 'Revolución', ctx: 'model', keys: ['R'], run: feat('revolve') },
  { id: 'part.sweep', label: 'Barrido', ctx: 'model', keys: [], run: feat('sweep') },
  { id: 'part.loft', label: 'Solevado', ctx: 'model', keys: [], run: feat('loft') },
  { id: 'part.hole', label: 'Taladro', ctx: 'model', keys: ['H'], run: feat('hole') },
  { id: 'part.thread', label: 'Rosca', ctx: 'model', keys: [], run: feat('thread') },
  { id: 'part.fillet', label: 'Empalme', ctx: 'model', keys: ['F'], run: feat('fillet') },
  { id: 'part.chamfer', label: 'Chaflán', ctx: 'model', keys: [], run: feat('chamfer') },
  { id: 'part.shell', label: 'Vaciado', ctx: 'model', keys: [], run: feat('shell') },
  { id: 'part.draft', label: 'Inclinación', ctx: 'model', keys: [], run: feat('draft') },
  { id: 'part.pattern', label: 'Patrón', ctx: 'model', keys: [], run: feat('pattern') },
  { id: 'part.mirror', label: 'Simetría', ctx: 'model', keys: [], run: feat('mirror') },
  { id: 'part.workplane', label: 'Plano de trabajo (P1…)', ctx: 'model', keys: [], run: feat('workplane') },
  { id: 'part.workaxis', label: 'Eje de trabajo (E1…)', ctx: 'model', keys: [], run: feat('workaxis') },
  { id: 'part.workpoint', label: 'Punto de trabajo (pt1…)', ctx: 'model', keys: [], run: feat('workpoint') },
  { id: 'part.epoint', label: 'ePoints de la pieza', ctx: 'model', keys: [], run: (s) => s.open({ kind: 'epoint' }) },
  { id: 'part.measure', label: 'Medir', ctx: 'part', keys: [], run: tool('measure') },
  // Boceto
  { id: 'sk.line', label: 'Línea', ctx: 'sketch', keys: ['L'], run: tool('line') },
  { id: 'sk.rect', label: 'Rectángulo', ctx: 'sketch', keys: ['R'], run: tool('rect') },
  { id: 'sk.circle', label: 'Círculo', ctx: 'sketch', keys: ['C'], run: tool('circle') },
  { id: 'sk.poly', label: 'Polígono', ctx: 'sketch', keys: ['P'], run: tool('npoly') },
  { id: 'sk.arc', label: 'Arco por tres puntos', ctx: 'sketch', keys: ['A'], run: tool('arc3') },
  { id: 'sk.slot', label: 'Ranura', ctx: 'sketch', keys: [], run: tool('slot') },
  { id: 'sk.spline', label: 'Spline', ctx: 'sketch', keys: [], run: tool('spline') },
  { id: 'sk.point', label: 'Punto', ctx: 'sketch', keys: [], run: tool('point') },
  { id: 'sk.dim', label: 'Cota', ctx: 'sketch', keys: ['D'], run: tool('skdim') },
  { id: 'sk.trim', label: 'Recortar', ctx: 'sketch', keys: ['X'], run: tool('trim') },
  { id: 'sk.extend', label: 'Alargar', ctx: 'sketch', keys: [], run: tool('extend') },
  { id: 'sk.fillet', label: 'Empalme 2D', ctx: 'sketch', keys: [], run: tool('fillet2d') },
  { id: 'sk.text', label: 'Texto', ctx: 'sketch', keys: ['T'], run: tool('text') },
  { id: 'sk.cons', label: 'Mostrar restricciones', ctx: 'sketch', keys: ['F8', 'F9'], run: (s) => s.set({ showCons: !s.showCons }) },
  { id: 'sk.finish', label: 'Terminar boceto', ctx: 'sketch', keys: [], run: (s) => s.finishSketch() },
  // Ensamblaje
  { id: 'asm.place', label: 'Colocar componente', ctx: 'assembly', keys: ['P'], run: (s) => s.open({ kind: 'place' }) },
  { id: 'asm.joint', label: 'Restringir (unión)', ctx: 'assembly', keys: ['J'], run: () => asmActions.openJoint() },
  { id: 'asm.epoints', label: 'Conectar ePoints', ctx: 'assembly', keys: [], run: () => asmActions.connectEPoints() },
  { id: 'asm.workplane', label: 'Plano auxiliar del ensamblaje', ctx: 'assembly', keys: [], run: () => asmActions.openWorkPlane() },
  { id: 'asm.workaxis', label: 'Eje auxiliar del ensamblaje', ctx: 'assembly', keys: [], run: (s) => s.open({ kind: 'asmaux', aux: 'axis' }) },
  { id: 'asm.workpoint', label: 'Punto auxiliar del ensamblaje', ctx: 'assembly', keys: [], run: (s) => s.open({ kind: 'asmaux', aux: 'point' }) },
  { id: 'asm.move', label: 'Mover componente', ctx: 'assembly', keys: [], run: tool('move' as State['tool']) },
  { id: 'asm.ground', label: 'Fijar/liberar componente seleccionado', ctx: 'assembly', keys: [], run: () => asmActions.toggleGround() },
  { id: 'asm.rotx', label: 'Girar 90° en X al colocar', ctx: 'assembly', keys: ['X'], run: (s) => { if (s.tool === 'place') asmActions.rotatePlace(0); } },
  { id: 'asm.roty', label: 'Girar 90° en Y al colocar', ctx: 'assembly', keys: ['Y'], run: (s) => { if (s.tool === 'place') asmActions.rotatePlace(1); } },
  { id: 'asm.rotz', label: 'Girar 90° en Z al colocar', ctx: 'assembly', keys: ['Z'], run: (s) => { if (s.tool === 'place') asmActions.rotatePlace(2); } },
  // Dibujo
  { id: 'drw.dim', label: 'Cota', ctx: 'drawing', keys: ['D'], run: tool('drwDim' as State['tool']) },
  { id: 'drw.section', label: 'Vista de sección', ctx: 'drawing', keys: [], run: tool('drwSection' as State['tool']) },
  { id: 'drw.detail', label: 'Vista de detalle', ctx: 'drawing', keys: [], run: tool('drwDetail' as State['tool']) },
];

/** Nombre normalizado de una combinación de teclas: «Ctrl+Shift+S», «F3», «E» */
export function comboOf(e: KeyboardEvent): string | null {
  const k = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(k)) return null;
  let key = k.length === 1 ? k.toUpperCase() : k === ' ' ? 'Space' : k;
  if (/^Key[A-Z]$/.test(e.code) && (e.ctrlKey || e.altKey || e.metaKey)) key = e.code.slice(3);
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey && (k.length > 1 || e.ctrlKey || e.altKey || /[a-z]/i.test(k)) ? 'Shift' : '', key].filter(Boolean).join('+');
}

/** Atajos efectivos de un comando (personalizados o por defecto) */
export const keysOf = (c: Command, map = S().settings.keymap) => map?.[c.id] ?? c.keys;

/** Contexto actual */
export function ctxNow(s: State): Ctx[] {
  if (s.kind === 'part') return s.mode === 'sketch' ? ['all', 'part', 'sketch'] : ['all', 'part', 'model'];
  if (s.kind === 'assembly') return ['all', 'assembly'];
  return ['all', 'drawing'];
}

/** Ejecuta el comando con esa combinación en el contexto actual (devuelve si lo encontró) */
export function runShortcut(e: KeyboardEvent): boolean {
  const combo = comboOf(e); if (!combo) return false;
  const s = S(), ctx = ctxNow(s), map = s.settings.keymap;
  // los contextos más concretos primero (boceto antes que global)
  const order = [...ctx].reverse();
  for (const c of order) {
    const cmd = COMMANDS.find((x) => x.ctx === c && keysOf(x, map).includes(combo));
    if (cmd) { e.preventDefault(); cmd.run(s); return true; }
  }
  return false;
}

/** Comandos que ya usan esa combinación en contextos que se solapan */
export function conflicts(combo: string, ctx: Ctx, except?: string): Command[] {
  const overlap = (a: Ctx, b: Ctx) => a === b || a === 'all' || b === 'all' || (a === 'part' && (b === 'sketch' || b === 'model')) || (b === 'part' && (a === 'sketch' || a === 'model'));
  return COMMANDS.filter((c) => c.id !== except && overlap(c.ctx, ctx) && keysOf(c).includes(combo));
}
