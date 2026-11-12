// Referencias a objetos (como las de AutoCAD): punto final, medio, centro, cuadrante, intersección,
// perpendicular, tangente, cercano, nodo y origen 0,0,0. Se usan al dibujar en el boceto y al designar puntos en el 3D.
// F3 las activa o desactiva; Herramientas › Referencias a objetos elige los modos.
import { useStore } from '../core/store';

export type OsMode = 'end' | 'mid' | 'cen' | 'qua' | 'int' | 'per' | 'tan' | 'nea' | 'nod' | 'ori';
export const OS_MODES: OsMode[] = ['end', 'mid', 'cen', 'nod', 'qua', 'int', 'per', 'tan', 'nea', 'ori'];
export const OS_NAMES: Record<OsMode, string> = {
  end: 'Punto final', mid: 'Punto medio', cen: 'Centro', qua: 'Cuadrante', int: 'Intersección',
  per: 'Perpendicular', tan: 'Tangente', nea: 'Cercano', nod: 'Nodo (punto)', ori: 'Origen 0,0,0',
};
export const OS_DEFAULT: OsMode[] = ['end', 'mid', 'cen', 'nod', 'qua', 'int', 'per', 'tan', 'nea', 'ori'];
/** Prioridad cuando dos referencias están igual de cerca (la menor gana) */
export const OS_PRIO: Record<OsMode, number> = { end: 0, nod: 0, cen: 1, ori: 1, int: 2, mid: 3, qua: 3, per: 4, tan: 4, nea: 9 };

export function osCfg() {
  const o = useStore.getState().settings.osnap;
  return { on: o?.on ?? true, modes: new Set<OsMode>((o?.modes as OsMode[] | undefined) ?? OS_DEFAULT) };
}
export function setOsCfg(p: { on?: boolean; modes?: OsMode[] }) {
  const st = useStore.getState(), cur = st.settings.osnap ?? { on: true, modes: OS_DEFAULT };
  useStore.setState({ settings: { ...st.settings, osnap: { on: p.on ?? cur.on, modes: p.modes ?? cur.modes } } });
}
export const toggleOsnap = () => { const on = !osCfg().on; setOsCfg({ on }); useStore.getState().notify(`Referencias a objetos ${on ? 'activadas' : 'desactivadas'} (F3)`); };

/** Símbolo de cada referencia (como AutoCAD), en un recuadro de 16 px centrado en el punto */
export const OS_GLYPH: Record<OsMode, string> = {
  end: '<rect x="2" y="2" width="12" height="12"/>',
  mid: '<path d="M8 2L14.5 14H1.5Z"/>',
  cen: '<circle cx="8" cy="8" r="6"/>',
  qua: '<path d="M8 1.5L14.5 8L8 14.5L1.5 8Z"/>',
  int: '<path d="M2 2L14 14M14 2L2 14"/>',
  per: '<path d="M2 14H14M5 14V5H2M5 5V14"/><path d="M2 8.5H8.5V14"/>',
  tan: '<circle cx="8" cy="9.5" r="5"/><path d="M1.5 4.5H14.5"/>',
  nea: '<path d="M2 2H14L2 14H14Z"/>',
  nod: '<circle cx="8" cy="8" r="6"/><path d="M3.8 3.8L12.2 12.2M12.2 3.8L3.8 12.2"/>',
  ori: '<circle cx="8" cy="8" r="6"/><path d="M8 0.5V15.5M0.5 8H15.5"/>',
};

let el: HTMLDivElement | null = null;
/** Muestra (o quita) el marcador de referencia en la posición de pantalla (px de la ventana) */
export function showSnapHint(x: number | null, y = 0, mode?: OsMode) {
  if (x == null || !mode) { if (el) el.style.display = 'none'; return; }
  if (!el) { el = document.createElement('div'); el.className = 'os-hint'; document.body.appendChild(el); }
  el.style.display = 'block';
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  if (el.dataset.m !== mode) {
    el.dataset.m = mode;
    el.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">${OS_GLYPH[mode]}</svg><span>${OS_NAMES[mode]}</span>`;
  }
}

// ---------- Geometría 2D para las referencias ----------
type P = [number, number];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1];
const crs = (a: P, b: P) => a[0] * b[1] - a[1] * b[0];
export type Prim = { kind: 'seg'; a: P; b: P; ref?: any } | { kind: 'circ'; c: P; r: number; a0?: number; a1?: number; ref?: any };
const angIn = (t: number, a0?: number, a1?: number) => {
  if (a0 == null || a1 == null) return true;
  const n = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const s = n(a0), e = n(a1), v = n(t);
  return s <= e ? v >= s - 1e-9 && v <= e + 1e-9 : v >= s - 1e-9 || v <= e + 1e-9;
};
const onSeg = (p: P, a: P, b: P) => { const d = sub(b, a), L = dot(d, d); const t = L ? dot(sub(p, a), d) / L : 0; return t >= -1e-9 && t <= 1 + 1e-9; };
const onCirc = (p: P, c: { c: P; a0?: number; a1?: number }) => angIn(Math.atan2(p[1] - c.c[1], p[0] - c.c[0]), c.a0, c.a1);
/** Intersecciones entre dos primitivas (segmentos y circunferencias/arcos) */
export function intersect(A: Prim, B: Prim): P[] {
  if (A.kind === 'seg' && B.kind === 'seg') {
    const r = sub(A.b, A.a), s = sub(B.b, B.a), den = crs(r, s); if (Math.abs(den) < 1e-12) return [];
    const t = crs(sub(B.a, A.a), s) / den, u = crs(sub(B.a, A.a), r) / den;
    return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? [[A.a[0] + r[0] * t, A.a[1] + r[1] * t]] : [];
  }
  if (A.kind === 'circ' && B.kind === 'seg') return intersect(B, A);
  if (A.kind === 'seg' && B.kind === 'circ') {
    const d = sub(A.b, A.a), f = sub(A.a, B.c), a = dot(d, d), b = 2 * dot(f, d), c = dot(f, f) - B.r * B.r;
    const disc = b * b - 4 * a * c; if (disc < 0 || !a) return [];
    const q = Math.sqrt(disc), out: P[] = [];
    for (const t of [(-b - q) / (2 * a), (-b + q) / (2 * a)]) if (t >= -1e-9 && t <= 1 + 1e-9) { const p: P = [A.a[0] + d[0] * t, A.a[1] + d[1] * t]; if (onCirc(p, B)) out.push(p); }
    return out;
  }
  if (A.kind === 'circ' && B.kind === 'circ') {
    const D = sub(B.c, A.c), d = Math.hypot(...D); if (d < 1e-12 || d > A.r + B.r || d < Math.abs(A.r - B.r)) return [];
    const a = (A.r * A.r - B.r * B.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, A.r * A.r - a * a));
    const m: P = [A.c[0] + (D[0] * a) / d, A.c[1] + (D[1] * a) / d];
    return ([[m[0] + (h * D[1]) / d, m[1] - (h * D[0]) / d], [m[0] - (h * D[1]) / d, m[1] + (h * D[0]) / d]] as P[]).filter((p) => onCirc(p, A) && onCirc(p, B));
  }
  return [];
}
/** Pie de la perpendicular desde «from» a la primitiva (sobre ella) */
export function perpFoot(from: P, X: Prim): P | null {
  if (X.kind === 'seg') { const d = sub(X.b, X.a), L = dot(d, d); if (!L) return null; const t = dot(sub(from, X.a), d) / L; if (t < 0 || t > 1) return null; return [X.a[0] + d[0] * t, X.a[1] + d[1] * t]; }
  const v = sub(from, X.c), l = Math.hypot(...v); if (l < 1e-12) return null;
  const p: P = [X.c[0] + (v[0] / l) * X.r, X.c[1] + (v[1] / l) * X.r];
  return onCirc(p, X) ? p : null;
}
/** Puntos de tangencia desde «from» a una circunferencia */
export function tangentPts(from: P, X: Prim): P[] {
  if (X.kind !== 'circ') return [];
  const v = sub(from, X.c), d = Math.hypot(...v); if (d <= X.r) return [];
  const base = Math.atan2(v[1], v[0]), al = Math.acos(X.r / d);
  return [base + al, base - al].map((t) => [X.c[0] + X.r * Math.cos(t), X.c[1] + X.r * Math.sin(t)] as P).filter((p) => onCirc(p, X));
}
/** Cuadrantes (0°, 90°, 180°, 270°) de una circunferencia o arco */
export const quadrants = (X: Prim): P[] => (X.kind !== 'circ' ? [] : [0, 1, 2, 3].map((i) => i * Math.PI / 2).filter((t) => angIn(t, X.a0, X.a1)).map((t) => [X.c[0] + X.r * Math.cos(t), X.c[1] + X.r * Math.sin(t)] as P));
export const segOnPoint = onSeg;
