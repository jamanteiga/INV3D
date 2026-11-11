// Generador HVAC: conductos de chapa, accesorios, terminales, equipos, uniones, soportes y aislamiento.
// Medidas de conducto interiores; el eje del conducto es Z y la boca de entrada está en z = 0.
import { newDoc, type PartDoc, type SkEntity, type Feature, type PlaneRef, type V3 } from './doc';
import { sheetThickness, INCH } from './hvacdata';

export type HvacKind =
  | 'duct' | 'elbow' | 'transition' | 'branch' | 'coupling' | 'cap' | 'plenum'
  | 'grille' | 'diffuser' | 'damper' | 'firedamper' | 'silencer' | 'flex' | 'ahu' | 'fancoil'
  | 'flange' | 'support' | 'insulation';

/** Sección: rectangular, circular u oval plana (dos semicírculos unidos por tramos rectos: anchura = eje mayor) */
export type DuctShape = 'rect' | 'round' | 'oval';
export interface HvacSpec {
  kind: HvacKind; std: 'EN' | 'SMACNA'; shape: DuctShape;
  /** Conducto circular: costura longitudinal o helicoidal (espiral, EN 12237 / SMACNA) */
  seam?: 'long' | 'spiral';
  /** Modelar la grapa helicoidal en relieve (geometría pesada: varios segundos por metro) */
  seamGeo?: boolean;
  /** Interior: anchura (X), altura (Y) o diámetro. En oval, anchura = eje mayor y altura = eje menor */
  W: number; H: number; D: number;
  /** Segunda boca: transiciones y derivaciones */
  shape2?: DuctShape; W2?: number; H2?: number; D2?: number; ex?: number; ey?: number;
  L: number; t?: number;
  /** Codos */
  angle?: number; elbowType?: 'radius' | 'square' | 'segmented' | 'smooth'; rw?: number; vanes?: boolean; gores?: number;
  /** Derivaciones */
  branch?: 'tee' | 'shoe' | 'y' | 'collar'; branchAngle?: number;
  /** Uniones en los extremos */
  ends?: 'none' | 'tdc' | 'angle' | 'socket';
  /** Terminales y equipos */
  blades?: number; bladeAngle?: number; neck?: number; splitter?: number; plate?: number; spigot?: 'top' | 'side';
  /** Aislamiento / soporte */
  ins?: number; rod?: string; material: string;
}

export const f1 = (x: number) => String(Math.round(x * 1000) / 1000);
export const XY = (o = 0): PlaneRef => ({ kind: 'std', name: 'XY', offset: f1(o) });
export const XZ = (o = 0): PlaneRef => ({ kind: 'std', name: 'XZ', offset: f1(o) });
export const YZ = (o = 0): PlaneRef => ({ kind: 'std', name: 'YZ', offset: f1(o) });
export const custom = (origin: V3, normal: V3, xDir: V3, label: string): PlaneRef => ({ kind: 'custom', label, origin, normal, xDir });
let nid = 0;
export const resetIds = () => { nid = 0; };
export const id = (p: string) => `${p}${++nid}`;
export const rect = (w: number, h: number, cx = 0, cy = 0): SkEntity => ({ id: id('r'), type: 'rect', x: f1(cx - w / 2), y: f1(cy - h / 2), w: f1(w), h: f1(h) });
export const circ = (d: number, cx = 0, cy = 0): SkEntity => ({ id: id('c'), type: 'circle', cx: f1(cx), cy: f1(cy), d: f1(d) });
export const poly = (pts: [number, number][]): SkEntity => ({ id: id('p'), type: 'poly', pts: pts.map(([x, y]) => [f1(x), f1(y)]) });
const rpoly = (w: number, h: number, ang: number, cx = 0, cy = 0): SkEntity => {
  const a = (ang * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return poly(([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as [number, number][]).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]));
};

const oval = (w: number, h: number, cx = 0, cy = 0): SkEntity => {
  if (!(w > h && h > 0)) throw new Error('En oval plano la anchura (eje mayor) debe ser mayor que la altura (eje menor)');
  const a = (w - h) / 2;
  return { id: id('o'), type: 'slot', x1: f1(cx - a), y1: f1(cy), x2: f1(cx + a), y2: f1(cy), w: f1(h) };
};
/** Contorno de una sección con crecimiento g (2·espesor para el exterior, etc.) */
const secE = (shape: DuctShape, W: number, H: number, D: number, g = 0, cx = 0, cy = 0): SkEntity =>
  shape === 'rect' ? rect(W + g, H + g, cx, cy) : shape === 'round' ? circ(D + g, cx, cy) : oval(W + g, H + g, cx, cy);
const SHAPE_NAME: Record<DuctShape, string> = { rect: 'rectangular', round: 'circular', oval: 'oval' };
/** Paso de la grapa helicoidal (banda de 137 mm habitual; 100 mm en diámetros pequeños) */
export const spiralPitch = (D: number) => (D <= 200 ? 100 : 137);

export class B {
  f: Feature[] = [];
  private n = 0;
  /** Boceto + extrusión */
  ext(name: string, plane: PlaneRef, ents: SkEntity[], dist: number, op: 'join' | 'cut' | 'new' = 'join', dir: 'normal' | 'reverse' | 'symmetric' = 'normal') {
    const s = `s${++this.n}`;
    this.f.push({ id: s, name: `${name} (boceto)`, type: 'sketch', plane, entities: ents });
    this.f.push({ id: `e${this.n}`, name, type: 'extrude', profile: s, distance: f1(dist), dir, op });
  }
  rev(name: string, plane: PlaneRef, ents: SkEntity[], axis: string, angle: number, op: 'join' | 'cut' = 'join') {
    const s = `s${++this.n}`;
    this.f.push({ id: s, name: `${name} (boceto)`, type: 'sketch', plane, entities: ents });
    this.f.push({ id: `e${this.n}`, name, type: 'revolve', profile: s, axis, angle: `${angle} deg`, op });
  }
  sketch(name: string, plane: PlaneRef, ents: SkEntity[]) { const s = `s${++this.n}`; this.f.push({ id: s, name, type: 'sketch', plane, entities: ents }); return s; }
}

const dims = (s: HvacSpec) => (s.std === 'SMACNA' ? (v: number) => `${+(v / INCH).toFixed(1)}"` : (v: number) => `${Math.round(v)}`);
export function sizeLabel(s: HvacSpec, second = false): string {
  const d = dims(s);
  const sh = second ? s.shape2 ?? s.shape : s.shape;
  if (sh === 'round') return `Ø${d(second ? s.D2 ?? s.D : s.D)}`;
  if (sh === 'oval') return `${d(second ? s.W2 ?? s.W : s.W)}×${d(second ? s.H2 ?? s.H : s.H)} oval`;
  return `${d(second ? s.W2 ?? s.W : s.W)}×${d(second ? s.H2 ?? s.H : s.H)}`;
}
export function autoT(s: HvacSpec): number {
  if (s.t && s.t > 0) return s.t;
  return sheetThickness(s.std, s.shape, s.shape === 'rect' ? Math.max(s.W, s.H) : s.shape === 'oval' ? s.W : s.D).t;
}

function doc(s: HvacSpec, pn: string, desc: string, params: [string, number, string][] = []): PartDoc {
  const d = newDoc();
  d.iProperties = { partNumber: pn, description: desc, designer: 'Centro de contenido · HVAC', material: s.material, revision: '', project: '', stockNumber: s.std === 'EN' ? 'EN 1505/1506' : 'SMACNA' } as PartDoc['iProperties'];
  d.parameters = params.map(([name, v, comment]) => ({ name, expr: `${f1(v)} mm`, comment }));
  return d;
}

// ---------- Uniones en los extremos ----------
function endJoints(b: B, s: HvacSpec, t: number, L: number, shape = s.shape, W = s.W, H = s.H, D = s.D) {
  const e = s.ends ?? 'none';
  if (e === 'none' || e === 'socket') return;
  const fh = e === 'tdc' ? (Math.max(W, H, D) > 1000 ? 40 : 30) : 30, ft = e === 'tdc' ? Math.max(t, 0.8) * 1.5 : 3, coll = e === 'angle' ? 30 : 0;
  for (const z of [0, L - ft]) b.ext(shape === 'rect' ? (e === 'tdc' ? 'Brida TDC' : 'Marco angular') : e === 'tdc' ? 'Brida de perfil' : 'Aro angular', XY(z), [secE(shape, W, H, D, 2 * t + 2 * fh), secE(shape, W, H, D, 2 * t)], ft);
  if (coll) for (const z of [0, L - coll]) b.ext(shape === 'rect' ? 'Ala del angular' : 'Ala del aro', XY(z), [secE(shape, W, H, D, 2 * t + 2 * ft), secE(shape, W, H, D, 2 * t)], coll);
}
const endsLabel = (s: HvacSpec) => ({ none: '', tdc: ' · bridas TDC', angle: ' · marco angular', socket: ' · unión enchufe' }[s.ends ?? 'none']);

// ---------- Conducto recto ----------
function makeDuct(s: HvacSpec): PartDoc {
  const t = autoT(s), L = s.L, b = new B(), sh = s.shape;
  if (sh === 'rect') return makeRectDuctSheet(s, t);
  b.ext('Conducto', XY(), [secE(sh, s.W, s.H, s.D, 2 * t), secE(sh, s.W, s.H, s.D)], L);
  if (s.ends === 'socket') b.ext('Manguito de unión', XY(L - 60), [secE(sh, s.W, s.H, s.D, 4 * t + 1), secE(sh, s.W, s.H, s.D, 2 * t)], 60);
  const spiral = s.seam === 'spiral';
  let pitch = 0;
  if (spiral && sh === 'round') pitch = spiralPitch(s.D);
  if (spiral && sh === 'round' && s.seamGeo) {
    // grapa helicoidal en relieve por el exterior (se solapa con la pared para unirse bien)
    const hs = Math.max(2, 3 * t), ws = Math.max(6, 8 * t), R0 = s.D / 2 + t / 2, turns = (L - ws - 4) / pitch;
    if (turns > 0.2) {
      const ax: SkEntity = { id: 'sax', type: 'line', a: ['0', '0'], b: ['0', '10'], construction: true };
      const pr = b.sketch('Grapa (perfil)', XZ(), [rect(hs + t / 2, ws, R0 + (hs + t / 2) / 2, ws / 2 + 2), ax]);
      b.f.push({ id: 'coil1', name: 'Grapa helicoidal', type: 'coil', profile: pr, axis: 'sax', pitch: f1(pitch), turns: String(Math.round(turns * 1000) / 1000), left: false, op: 'join' });
    }
  }
  endJoints(b, s, t, L);
  const nm = spiral ? 'Conducto espiral' : 'Conducto';
  const d = doc(s, `${nm} ${sizeLabel(s)} L=${L} e=${t}`, `${nm} ${SHAPE_NAME[sh]} ${sizeLabel(s)} · L ${L} mm · chapa ${String(t).replace(".", ",")} mm${spiral ? (sh === 'round' ? ` · grapa helicoidal paso ${pitch} mm (EN 12237)` : ' · oval plano conformado de tubo espiral') : ''}${endsLabel(s)}`,
    sh === 'round' ? [['D', s.D, 'Diámetro interior'], ['L', L, 'Longitud'], ['t', t, 'Espesor de chapa']] : [['W', s.W, sh === 'oval' ? 'Eje mayor interior' : 'Anchura interior'], ['H', s.H, sh === 'oval' ? 'Eje menor interior' : 'Altura interior'], ['L', L, 'Longitud'], ['t', t, 'Espesor de chapa']]);
  d.features = b.f; return d;
}

/** Conducto rectangular de chapa plegada: pestaña de contorno con tres pliegues y cierre engatillado en la cuarta esquina.
 *  Es una pieza de chapa: tiene desarrollo para corte (Chapa › Desarrollo) y espesor/radio en el estilo de chapa. */
function makeRectDuctSheet(s: HvacSpec, t: number): PartDoc {
  const L = s.L, W = s.W, H = s.H, r = Math.max(t, 1), gap = Math.round((r + t + 2) * 10) / 10, b = new B();
  const P: [number, number][] = [[-W / 2, -H / 2 + gap], [-W / 2, H / 2], [W / 2, H / 2], [W / 2, -H / 2], [-W / 2 + gap, -H / 2]];
  const ents: SkEntity[] = P.slice(0, -1).map((p, i) => ({ id: id('l'), type: 'line', a: [f1(p[0]), f1(p[1])], b: [f1(P[i + 1][0]), f1(P[i + 1][1])] }) as SkEntity);
  const sk = b.sketch('Sección (boceto)', XY(), ents);
  b.f.push({ id: 'cf1', name: 'Conducto (chapa plegada)', type: 'sm_contour', profile: sk, width: f1(L), dir: 'normal', side: 'in' });
  endJoints(b, s, t, L);
  const d = doc(s, `Conducto ${sizeLabel(s)} L=${L} e=${t}`, `Conducto rectangular de chapa plegada ${sizeLabel(s)} · L ${L} mm · chapa ${String(t).replace('.', ',')} mm · 3 pliegues R${String(r).replace('.', ',')} y cierre engatillado en la cuarta esquina${endsLabel(s)}`,
    [['W', W, 'Anchura interior'], ['H', H, 'Altura interior'], ['L', L, 'Longitud'], ['t', t, 'Espesor de chapa']]);
  d.sheet = { t: `${t} mm`, r: `${r} mm`, k: '0.44' };
  d.features = b.f; return d;
}

// ---------- Codos ----------
function makeElbow(s: HvacSpec): PartDoc {
  const t = autoT(s), ang = s.angle ?? 90, b = new B();
  let kind = s.elbowType ?? (s.shape === 'round' ? 'smooth' : 'radius');
  if (s.shape === 'round' && kind !== 'segmented') kind = 'smooth';
  if (s.shape === 'rect' && kind !== 'square') kind = 'radius';
  if (s.shape === 'oval') kind = 'radius';
  const rw = s.rw ?? (s.shape === 'round' ? 1.5 : 1);
  let name = '';
  if (s.shape === 'oval') {
    const Rc = rw * s.W, ax = { id: 'ax', type: 'line' as const, a: [f1(Rc), '-10'] as [string, string], b: [f1(Rc), '10'] as [string, string], construction: true };
    if (Rc <= s.W / 2 + t) throw new Error('Radio de eje demasiado pequeño para el oval');
    b.rev('Codo', XY(), [oval(s.W + 2 * t, s.H + 2 * t), oval(s.W, s.H), ax], 'ax', ang);
    name = `Codo oval ${ang}° R/W ${rw}`;
  } else if (s.shape === 'rect' && kind === 'radius') {
    const Rc = rw * s.W, ax = { id: 'ax', type: 'line' as const, a: [f1(Rc), '-10'] as [string, string], b: [f1(Rc), '10'] as [string, string], construction: true };
    b.rev('Codo', XY(), [rect(s.W + 2 * t, s.H + 2 * t), rect(s.W, s.H), ax], 'ax', ang);
    name = `Codo rectangular ${ang}° con radio R/W ${rw}`;
  } else if (s.shape === 'rect') {
    // codo recto (a inglete) con álabes directrices: dos tramos en L
    if (ang !== 90) throw new Error('El codo recto con álabes se genera a 90°');
    const a = s.W / 2, o = a + t, Lz = o + 60, Lx = o + 60;
    b.ext('Codo recto', XZ(), [poly([[-o, 0], [o, 0], [o, Lz - o], [Lx, Lz - o], [Lx, Lz + o], [-o, Lz + o]])], s.H + 2 * t, 'join', 'symmetric');
    b.ext('Interior', XZ(), [poly([[-a, -1], [a, -1], [a, Lz - a], [Lx + 1, Lz - a], [Lx + 1, Lz + a], [-a, Lz + a]])], s.H, 'cut', 'symmetric');
    if (s.vanes !== false) {
      const rv = Math.min(50, a * 0.6), tv = Math.max(0.8, t), diag = Math.SQRT2 * 2 * a, n = Math.max(1, Math.floor(diag / (rv * 0.85)) - 1);
      const vanes: SkEntity[] = [];
      for (let k = 1; k <= n; k++) {
        const q: [number, number] = [-a + (2 * a * k) / (n + 1), Lz + a - (2 * a * k) / (n + 1)];
        const c: [number, number] = [q[0] + rv * Math.SQRT1_2, q[1] - rv * Math.SQRT1_2];
        const pts: [number, number][] = [];
        for (let i = 0; i <= 8; i++) { const th = Math.PI / 2 + (i / 8) * Math.PI / 2; pts.push([c[0] + (rv + tv / 2) * Math.cos(th), c[1] + (rv + tv / 2) * Math.sin(th)]); }
        for (let i = 8; i >= 0; i--) { const th = Math.PI / 2 + (i / 8) * Math.PI / 2; pts.push([c[0] + (rv - tv / 2) * Math.cos(th), c[1] + (rv - tv / 2) * Math.sin(th)]); }
        if (pts.every(([x, z]) => x >= -a && x <= Lx && z >= 0 && z <= Lz + a && (z >= Lz - a || x <= a))) vanes.push(poly(pts));
      }
      if (vanes.length) b.ext('Álabes', XZ(), vanes, s.H, 'join', 'symmetric');
    }
    name = `Codo recto ${s.vanes === false ? 'sin' : 'con'} álabes`;
  } else if (kind === 'smooth') {
    const Rc = rw * s.D, ax = { id: 'ax', type: 'line' as const, a: [f1(Rc), '-10'] as [string, string], b: [f1(Rc), '10'] as [string, string], construction: true };
    b.rev('Codo', XY(), [circ(s.D + 2 * t), circ(s.D), ax], 'ax', ang);
    name = `Codo circular ${ang}° prensado R/D ${rw}`;
  } else {
    // codo circular por segmentos (gajos): barrido a inglete sobre una poligonal
    const n = Math.max(3, s.gores ?? (ang >= 90 ? 5 : 3)), Rc = rw * s.D, dl = ((ang / (n - 1)) * Math.PI) / 180, full = 2 * Rc * Math.tan(dl / 2);
    const path = (ext: number) => {
      const p: [number, number][] = [[0, -ext]]; let x = 0, z = 0;
      for (let i = 0; i < n; i++) {
        const phi = i * dl, len = (i === 0 || i === n - 1 ? full / 2 : full) + (i === n - 1 ? ext : 0);
        x += Math.sin(phi) * len; z += Math.cos(phi) * len; p.push([x, z]);
      }
      return p;
    };
    const lines = (pts: [number, number][]): SkEntity[] => pts.slice(1).map((q, i) => ({ id: id('l'), type: 'line', a: [f1(pts[i][0]), f1(pts[i][1])], b: [f1(q[0]), f1(q[1])] }));
    const po = b.sketch('Trayectoria', XZ(), lines(path(0)));
    const pi = b.sketch('Trayectoria interior', XZ(), lines(path(1)));
    const so = b.sketch('Sección exterior', XY(), [circ(s.D + 2 * t)]);
    const si = b.sketch('Sección interior', XY(-1), [circ(s.D)]);
    b.f.push({ id: 'sw1', name: 'Gajos', type: 'sweep', profile: so, path: po, op: 'join', transition: 'right' });
    b.f.push({ id: 'sw2', name: 'Interior', type: 'sweep', profile: si, path: pi, op: 'cut', transition: 'right' });
    name = `Codo circular ${ang}° de ${n} gajos R/D ${rw}`;
  }
  const d = doc(s, `Codo ${ang} ${sizeLabel(s)} e=${t}${kind === 'square' ? ' AL' : ''}`, `${name} ${sizeLabel(s)} · chapa ${String(t).replace(".", ",")} mm`);
  d.features = b.f; return d;
}

// ---------- Transiciones, reducciones y desvíos (chapa con desarrollo) ----------
function makeTransition(s: HvacSpec): PartDoc {
  const t = autoT(s), L = s.L, b = new B();
  const sh2 = s.shape2 ?? s.shape;
  const a = b.sketch('Boca 1', XY(), [secE(s.shape, s.W, s.H, s.D)]);
  const ex = s.ex ?? 0, ey = s.ey ?? 0;
  const c = b.sketch('Boca 2', XY(L), [secE(sh2, s.W2 ?? s.W, s.H2 ?? s.H, s.D2 ?? s.D, 0, ex, ey)]);
  b.f.push({ id: 'lf', name: 'Pestaña solevada', type: 'sm_loft', a, b: c, side: 'out', segments: '48' });
  const same = s.shape === sh2 && (s.shape === 'round' ? s.D === s.D2 : s.W === s.W2 && s.H === s.H2);
  const nm = same ? 'Desvío' : s.shape !== sh2 ? 'Transición' : 'Reducción';
  const d = doc(s, `${nm} ${sizeLabel(s)}-${sizeLabel(s, true)} L=${L}`, `${nm} ${SHAPE_NAME[s.shape]}${s.shape !== sh2 ? `-${SHAPE_NAME[sh2]}` : ''} ${sizeLabel(s)} → ${sizeLabel(s, true)} · L ${L}${ex || ey ? ` · desplazamiento ${ex}/${ey}` : ''} · chapa ${String(t).replace(".", ",")} mm`);
  d.sheet = { t: `${t} mm`, r: `${t} mm`, k: '0.4' };
  d.features = b.f; return d;
}

// ---------- Derivaciones ----------
function makeBranch(s: HvacSpec): PartDoc {
  const t = autoT(s), L = s.L, b = new B(), kind = s.branch ?? 'tee';
  const sh2 = s.shape2 ?? s.shape, W2 = s.W2 ?? s.W / 2, H2 = s.H2 ?? s.H, D2 = s.D2 ?? s.D / 2, Lb = 150;
  const zb = L / 2;
  if (kind === 'y') {
    if (s.shape !== 'round') throw new Error('El pantalón se genera en circular');
    const al = ((s.branchAngle ?? 30) * Math.PI) / 180, La = Math.max(150, D2 * 1.5);
    // tramo común macizo + brazos macizos; después se vacía todo (evita caras coincidentes)
    const z0 = L - s.D * 0.3;
    b.ext('Tramo común', XY(), [circ(s.D + 2 * t)], L);
    for (const sg of [1, -1]) {
      const n: V3 = [sg * Math.sin(al), 0, Math.cos(al)];
      b.ext(`Brazo ${sg > 0 ? 'derecho' : 'izquierdo'}`, custom([sg * 0.01, 0, z0], n, [0, 1, 0], 'Brazo'), [circ(D2 + 2 * t)], La + s.D * 0.3);
    }
    b.ext('Interior común', XY(-1), [circ(s.D)], L + 1, 'cut');
    for (const sg of [1, -1]) {
      const n: V3 = [sg * Math.sin(al), 0, Math.cos(al)];
      b.ext('Interior brazo', custom([sg * 0.02, 0, z0 - 0.5], n, [0, 1, 0], 'Brazo'), [circ(D2)], La + s.D * 0.3 + 2, 'cut');
    }
    const d = doc(s, `Pantalón Ø${s.D}-2×Ø${D2} ${Math.round((al * 180) / Math.PI)}°`, `Pantalón circular Ø${s.D} → 2 × Ø${D2} a ±${Math.round((al * 180) / Math.PI)}° · chapa ${String(t).replace(".", ",")} mm`);
    d.features = b.f; return d;
  }
  // conducto principal
  if (s.shape === 'rect') b.ext('Principal', XY(), [rect(s.W + 2 * t, s.H + 2 * t), rect(s.W, s.H)], L);
  else b.ext('Principal', XY(), [circ(s.D + 2 * t), circ(s.D)], L);
  const half = s.shape === 'rect' ? s.W / 2 + t : s.D / 2 + t;
  if (s.shape === 'round' && sh2 === 'round' && (s.branchAngle ?? 90) !== 90) {
    // derivación circular a 45°
    const al = ((s.branchAngle ?? 45) * Math.PI) / 180, n: V3 = [Math.sin(al), 0, Math.cos(al)], len = half / Math.sin(al) + Lb;
    b.ext('Derivación', custom([0, 0, zb - half / Math.tan(al)], n, [0, 1, 0], 'Derivación'), [circ(D2 + 2 * t)], len);
    b.ext('Interior principal', XY(-1), [circ(s.D)], L + 2, 'cut');
    b.ext('Interior derivación', custom([0, 0, zb - half / Math.tan(al)], n, [0, 1, 0], 'Derivación'), [circ(D2)], len + 1, 'cut');
  } else if (kind === 'shoe' && s.shape === 'rect' && sh2 === 'rect') {
    const sh = Math.min(W2 / 2, 100), w = W2 / 2;
    b.ext('Toma de zapato', XZ(), [poly([[0, zb - w - sh], [half, zb - w - sh], [half + sh, zb - w], [half + Lb, zb - w], [half + Lb, zb + w], [0, zb + w]])], H2 + 2 * t, 'join', 'symmetric');
    b.ext('Interior principal', XY(-1), [rect(s.W, s.H)], L + 2, 'cut');
    b.ext('Interior zapato', XZ(), [poly([[0, zb - w - sh + t], [half - t, zb - w - sh + t], [half + sh - t * 0.4, zb - w + t], [half + Lb + 1, zb - w + t], [half + Lb + 1, zb + w - t], [0, zb + w - t]])], H2, 'cut', 'symmetric');
  } else {
    // te o collarín: boca en la cara +X
    const outer = sh2 === 'rect' ? [rect(H2 + 2 * t, W2 + 2 * t, 0, zb)] : [circ(D2 + 2 * t, 0, zb)];
    const inner = sh2 === 'rect' ? [rect(H2, W2, 0, zb)] : [circ(D2, 0, zb)];
    b.ext(kind === 'collar' ? 'Collarín' : 'Derivación', YZ(), outer, half + Lb);
    b.ext('Interior principal', XY(-1), [s.shape === 'rect' ? rect(s.W, s.H) : circ(s.D)], L + 2, 'cut');
    b.ext('Interior derivación', YZ(), inner, half + Lb + 1, 'cut');
  }
  const nm = kind === 'shoe' ? 'Toma de zapato' : kind === 'collar' ? 'Collarín' : (s.branchAngle ?? 90) !== 90 && s.shape === 'round' ? `Derivación a ${s.branchAngle}°` : 'Te';
  const d = doc(s, `${nm} ${sizeLabel(s)}-${sizeLabel({ ...s, shape: sh2 }, true)}`, `${nm} ${sizeLabel(s)} con derivación ${sizeLabel({ ...s, shape: sh2 }, true)} · L ${L} · chapa ${String(t).replace(".", ",")} mm`);
  d.features = b.f; return d;
}

// ---------- Manguito de unión (conducto espiral) ----------
function makeCoupling(s: HvacSpec): PartDoc {
  if (s.shape === 'rect') throw new Error('El manguito interior es para conducto circular u oval (espiral)');
  const t = autoT(s), sh = s.shape, b = new B(), E = (g: number) => secE(sh, s.W, s.H, s.D, g);
  const L = s.L > 0 && s.L < 600 ? s.L : (sh === 'round' ? s.D : s.W) <= 315 ? 100 : 150, bw = 10;
  // macho que entra en los dos conductos (exterior = interior del conducto) con cordón de tope en el centro
  b.ext('Manguito', XY(), [E(-0.4), E(-0.4 - 2 * t)], L);
  b.ext('Cordón de tope', XY(L / 2 - bw / 2), [E(2 * t + 4), E(-0.4 - 2 * t)], bw);
  const d = doc(s, `Manguito ${sizeLabel(s)} L=${L}`, `Manguito de unión interior (macho-macho) para conducto espiral ${sizeLabel(s)} · L ${L} mm con cordón de tope · chapa ${String(t).replace(".", ",")} mm`);
  d.features = b.f; return d;
}

// ---------- Tapas y plenums ----------
function makeCap(s: HvacSpec): PartDoc {
  const t = autoT(s), b = new B(), c = 40;
  const sh = s.shape, E = (g: number) => secE(sh, s.W, s.H, s.D, g);
  b.ext('Tapa', XY(), [E(4 * t)], t); b.ext('Collar', XY(t), [E(4 * t), E(2 * t)], c);
  const d = doc(s, `Tapa ${sizeLabel(s)}`, `Tapa final ${sizeLabel(s)} · chapa ${String(t).replace(".", ",")} mm`);
  d.features = b.f; return d;
}
function makePlenum(s: HvacSpec): PartDoc {
  const t = autoT(s), b = new B(), Hp = s.L, D = s.D2 ?? 200;
  b.ext('Caja', XY(), [rect(s.W + 2 * t, s.H + 2 * t)], Hp + t);
  b.ext('Interior', XY(-1), [rect(s.W, s.H)], Hp + 1, 'cut');
  if ((s.spigot ?? 'top') === 'top') {
    b.ext('Boca', XY(Hp), [circ(D + 2 * t)], t + 80); b.ext('Paso boca', XY(Hp - 1), [circ(D)], t + 82, 'cut');
  } else {
    b.ext('Boca', YZ(s.W / 2), [circ(D + 2 * t, 0, Hp / 2)], t + 80); b.ext('Paso boca', YZ(s.W / 2 - 1), [circ(D, 0, Hp / 2)], t + 82, 'cut');
  }
  const d = doc(s, `Plenum ${s.W}×${s.H}×${Hp} Ø${D}`, `Plenum ${s.W}×${s.H} h ${Hp} con boca Ø${D} ${(s.spigot ?? 'top') === 'top' ? 'superior' : 'lateral'} · chapa ${String(t).replace(".", ",")} mm`);
  d.features = b.f; return d;
}

// ---------- Terminales ----------
function makeGrille(s: HvacSpec): PartDoc {
  const b = new B(), fr = 30, n = s.blades ?? Math.max(2, Math.floor(s.H / 18)), ang = s.bladeAngle ?? 0;
  b.ext('Marco', XY(), [rect(s.W + 2 * fr, s.H + 2 * fr), rect(s.W, s.H)], 8);
  b.ext('Cuello', XY(8), [rect(s.W, s.H), rect(s.W - 2, s.H - 2)], 40);
  const bl: SkEntity[] = [];
  for (let i = 0; i < n; i++) bl.push(rpoly(1.2, 16, ang, -s.H / 2 + (s.H * (i + 0.5)) / n, 18));
  b.ext('Lamas', YZ(-s.W / 2 + 1), bl, s.W - 2);
  const d = doc(s, `Rejilla ${s.W}×${s.H}`, `Rejilla de lamas ${s.W}×${s.H} (${n} lamas a ${ang}°) · marco ${fr} mm`);
  d.features = b.f; return d;
}
function makeDiffuser(s: HvacSpec): PartDoc {
  const b = new B(), N = s.neck ?? 250;
  if (s.shape === 'rect') {
    const P = s.plate ?? 595;
    b.ext('Placa', XY(), [rect(P, P), rect(P * 0.62, P * 0.62)], 4);
    for (let i = 0; i < 4; i++) { const k = 0.62 - i * 0.12; b.ext(`Cono ${i + 1}`, XY(4 + i * 6), [rect(P * k, P * k), rect(P * k - 3, P * k - 3)], 6 + i * 6); }
    b.ext('Centro', XY(30), [rect(P * 0.14, P * 0.14)], 4);
    b.ext('Cuello', XY(4), [circ(N + 1.4), circ(N)], 120);
    const d = doc(s, `Difusor ${P}×${P} Ø${N}`, `Difusor cuadrado de conos ${P}×${P} (placa de techo) con cuello Ø${N}`);
    d.features = b.f; return d;
  }
  const Do = Math.max(N * 1.9, N + 150), rings: [number, number][] = [];
  for (let i = 0; i < 4; i++) { const r = Do / 2 - i * (Do / 2 - N / 2) / 4; rings.push([r, i * 12]); }
  const pts: [number, number][] = [[N / 2, 120], [N / 2 + 1.2, 120], [N / 2 + 1.2, 50], [Do / 2, 4], [Do / 2, 0], [Do / 2 - 2, 0], [N / 2, 46]];
  b.rev('Difusor', XZ(), [poly(pts), { id: 'ax', type: 'line', a: ['0', '-10'], b: ['0', '10'], construction: true }], 'ax', 360);
  for (let i = 1; i < 3; i++) { const r = Do / 2 - i * (Do - N) / 6; b.rev(`Cono ${i}`, XZ(), [poly([[r, -10 - i * 6], [r - 25, 10 + i * 4], [r - 26.5, 10 + i * 4], [r - 1.5, -10 - i * 6]]), { id: 'ax', type: 'line', a: ['0', '-10'], b: ['0', '10'], construction: true }], 'ax', 360); }
  const d = doc(s, `Difusor circular Ø${N}`, `Difusor circular de conos para cuello Ø${N} (Ø exterior ${Math.round(Do)})`);
  d.features = b.f; return d;
}
function makeDamper(s: HvacSpec, fire: boolean): PartDoc {
  const t = Math.max(autoT(s), fire ? 1.5 : 1.0), L = s.L || (fire ? 350 : 150), b = new B(), ang = s.bladeAngle ?? (fire ? 0 : 60);
  if (s.shape === 'rect') {
    b.ext('Carcasa', XY(), [rect(s.W + 2 * t, s.H + 2 * t), rect(s.W, s.H)], L);
    // regulación: lamas opuestas (0° cerrada, 90° abierta); cortafuegos: clapeta (0° abierta, 90° cerrada)
    const n = fire ? 1 : Math.max(1, Math.ceil(s.H / 150)), pitch = s.H / n;
    const bl: SkEntity[] = fire ? [rpoly(25, s.H - 4, ang, 0, L / 2)]
      : Array.from({ length: n }, (_, i) => rpoly(pitch - 4, 2, i % 2 ? -ang : ang, -s.H / 2 + pitch * (i + 0.5), L / 2));
    b.ext(fire ? 'Clapeta' : 'Lamas', YZ(-s.W / 2 + 1), bl, s.W - 2);
    if (fire) b.ext('Núcleo de la clapeta', YZ(-s.W / 2 + 3), [rpoly(23, s.H - 8, ang, 0, L / 2)], s.W - 6, 'cut');
    b.ext(fire ? 'Mecanismo' : 'Servomotor', YZ(s.W / 2 + t), [rect(fire ? 140 : 90, fire ? 160 : 110, 0, L / 2)], fire ? 90 : 70);
    b.ext('Hueco de la caja', YZ(s.W / 2 + t + 1.5), [rect(fire ? 137 : 87, fire ? 157 : 107, 0, L / 2)], fire ? 87 : 67, 'cut');
  } else {
    b.ext('Carcasa', XY(), [circ(s.D + 2 * t), circ(s.D)], L);
    b.ext(fire ? 'Clapeta' : 'Disco', custom([0, 0, L / 2], [0, Math.sin((((fire ? 90 - ang : ang)) * Math.PI) / 180), Math.cos((((fire ? 90 - ang : ang)) * Math.PI) / 180)], [1, 0, 0], 'Disco'), [circ(s.D - 2)], fire ? 20 : 2, 'join', 'symmetric');
    if (fire) b.ext('Núcleo de la clapeta', custom([0, 0, L / 2], [0, Math.sin(((90 - ang) * Math.PI) / 180), Math.cos(((90 - ang) * Math.PI) / 180)], [1, 0, 0], 'Disco'), [circ(s.D - 8)], 18, 'cut', 'symmetric');
    b.ext(fire ? 'Mecanismo' : 'Servomotor', YZ(s.D / 2 + t), [rect(fire ? 120 : 80, fire ? 140 : 100, 0, L / 2)], fire ? 80 : 60);
    b.ext('Hueco de la caja', YZ(s.D / 2 + t + 1.5), [rect(fire ? 117 : 77, fire ? 137 : 97, 0, L / 2)], fire ? 77 : 57, 'cut');
  }
  endJoints(b, s, t, L);
  const nm = fire ? 'Compuerta cortafuegos' : 'Compuerta de regulación';
  const d = doc(s, `${fire ? 'CCF' : 'Compuerta'} ${sizeLabel(s)}`, `${nm} ${sizeLabel(s)} · L ${L}${fire ? ' · EN 15650 / EI 120 (S) (referencia)' : ` · lamas opuestas a ${ang}°`}`);
  d.features = b.f; return d;
}
function makeSilencer(s: HvacSpec): PartDoc {
  const t = autoT(s), L = s.L, b = new B(), sp = s.splitter ?? 100, gap = Math.max(50, sp * 0.8);
  const n = Math.max(1, Math.floor((s.W + gap) / (sp + gap)));
  if (s.shape === 'rect') {
    b.ext('Envolvente', XY(), [rect(s.W + 2 * t, s.H + 2 * t), rect(s.W, s.H)], L);
    const tot = n * sp + (n - 1) * gap, x0 = -tot / 2 + sp / 2;
    // celdas: chapa perforada (la lana mineral no se cuenta en la masa)
    b.ext('Celdas absorbentes', XY(50), Array.from({ length: n }, (_, i) => rect(sp, s.H, x0 + i * (sp + gap), 0)), L - 100);
    b.ext('Relleno de las celdas', XY(50 + t), Array.from({ length: n }, (_, i) => rect(sp - 2 * t, s.H - 2 * t, x0 + i * (sp + gap), 0)), L - 100 - 2 * t, 'cut');
  } else {
    b.ext('Envolvente', XY(), [circ(s.D + 2 * t + 2 * sp), circ(s.D)], L);
    b.ext('Paso', XY(-1), [circ(s.D)], L + 2, 'cut');
  }
  endJoints(b, s, t, L);
  const d = doc(s, `Silenciador ${sizeLabel(s)} L=${L}`, s.shape === 'rect' ? `Silenciador rectangular ${sizeLabel(s)} · L ${L} · ${n} celdas de ${sp} mm (paso libre ${Math.round(((s.W - n * sp) / s.W) * 100)} %)` : `Silenciador circular ${sizeLabel(s)} · L ${L} · absorbente ${sp} mm`);
  d.features = b.f; return d;
}
function makeFlex(s: HvacSpec): PartDoc {
  const L = s.L, p = 25, a = 3, n = Math.max(2, Math.round(L / p)), r = s.D / 2;
  const pts: [number, number][] = [[r, 0]];
  for (let i = 0; i < n; i++) { pts.push([r + a, i * p + p * 0.25], [r + a, i * p + p * 0.5], [r, i * p + p * 0.75], [r, (i + 1) * p]); }
  const back = pts.slice().reverse().map(([x, z]) => [x - 0.6, z] as [number, number]);
  const b = new B();
  b.rev('Flexible', XZ(), [poly([...pts, ...back]), { id: 'ax', type: 'line', a: ['0', '-10'], b: ['0', '10'], construction: true }], 'ax', 360);
  const d = doc(s, `Flexible Ø${s.D} L=${L}`, `Conducto flexible Ø${s.D} · L ${L} (aluminio / lana, en recto)`);
  d.features = b.f; return d;
}
function makeAHU(s: HvacSpec, fancoil: boolean): PartDoc {
  const b = new B(), W = s.W, H = s.H, L = s.L, w = fancoil ? 1 : 50;
  b.ext('Envolvente', XY(), [rect(W, H)], L);
  b.ext('Interior', XY(w), [rect(W - 2 * w, H - 2 * w)], L - 2 * w, 'cut');
  const W2 = s.W2 ?? W * 0.5, H2 = s.H2 ?? H * 0.5;
  if (fancoil) {
    b.ext('Boca impulsión', XY(L), [rect(W2 + 2, H2 + 2), rect(W2, H2)], 60);
    b.ext('Paso impulsión', XY(L - w - 1), [rect(W2, H2)], w + 2, 'cut');
    b.ext('Boca retorno', XY(0), [rect(W2 + 2, H2 + 2), rect(W2, H2)], 60, 'join', 'reverse');
    b.ext('Paso retorno', XY(-1), [rect(W2, H2)], w + 2, 'cut');
    b.ext('Bandeja de condensados', XY(L * 0.3), [rect(W - 2, 30, 0, -H / 2 - 15)], L * 0.4);
    b.ext('Hueco de la bandeja', XY(L * 0.3 + 2), [rect(W - 6, 27.5, 0, -H / 2 - 13.75)], L * 0.4 - 4, 'cut');
  } else {
    // UTA: impulsión y retorno en los extremos (parte superior), bancada
    for (const [nm, z, up] of [['Impulsión', L, 1], ['Retorno', 0, -1]] as const) {
      b.ext(`Boca ${nm.toLowerCase()}`, XY(z), [rect(W2 + 4, H2 + 4, 0, H / 2 - H2 / 2 - w - 20), rect(W2, H2, 0, H / 2 - H2 / 2 - w - 20)], 80, 'join', up > 0 ? 'normal' : 'reverse');
      b.ext(`Paso ${nm.toLowerCase()}`, XY(up > 0 ? L - w - 1 : -1), [rect(W2, H2, 0, H / 2 - H2 / 2 - w - 20)], w + 2, 'cut');
    }
    b.ext('Bancada', XZ(H / 2), [rect(100, L, -W / 2 + 50, L / 2), rect(100, L, W / 2 - 50, L / 2)], 100);
  }
  const d = doc(s, `${fancoil ? 'Fancoil' : 'UTA'} ${L}×${W}×${H}`, fancoil ? `Fancoil de conductos ${L}×${W}×${H} · bocas ${W2}×${H2} (bloque)` : `Unidad de tratamiento de aire ${L}×${W}×${H} · panel 50 mm · bocas ${W2}×${H2} (bloque)`);
  d.features = b.f; return d;
}

// ---------- Uniones, soportes y aislamiento ----------
function makeFlangeFrame(s: HvacSpec): PartDoc {
  const t = autoT(s), b = new B(), e = s.ends && s.ends !== 'none' ? s.ends : 'angle';
  endJoints(b, { ...s, ends: e }, t, e === 'tdc' ? Math.max(t, 0.8) * 1.5 : 30);
  b.f = b.f.slice(0, 2).concat(e === 'angle' ? b.f.slice(4, 6) : []);
  const d = doc(s, `${e === 'tdc' ? 'Brida TDC' : 'Marco angular'} ${sizeLabel(s)}`, `${e === 'tdc' ? (s.shape === 'rect' ? 'Marco de brida TDC' : 'Brida de perfil') : s.shape === 'rect' ? 'Marco de angular L30×3' : 'Aro de angular L30×3'}${s.shape === 'oval' ? ' oval' : ''} para conducto ${sizeLabel(s)}`);
  d.features = b.f; return d;
}
function makeSupport(s: HvacSpec): PartDoc {
  const t = autoT(s), b = new B();
  const tr = s.shape !== 'round'; // rectangular y oval: trapecio
  const width = tr ? s.W + 2 * t : s.D + 2 * t, hgt = tr ? s.H + 2 * t : s.D + 2 * t;
  const rod = s.rod ?? (width <= 1000 ? 'M8' : width <= 1500 ? 'M10' : 'M12'), rd = Number(rod.slice(1)), Lr = s.L || 500;
  const span = width + 100, x = span / 2 - 25;
  if (tr) {
    b.ext('Perfil (carril 41×41)', XZ(), [rect(span, 41, 0, -hgt / 2 - 20.5)], 41, 'join', 'symmetric');
    b.ext('Hueco del carril', XZ(), [rect(span + 2, 37, 0, -hgt / 2 - 20.5 + 2)], 37, 'cut', 'symmetric');
  } else {
    b.ext('Abrazadera', XY(-20), [circ(s.D + 2 * t + 6), circ(s.D + 2 * t)], 30);
    b.ext('Oreja', XZ(), [rect(width + 50, 4, 0, s.D / 2 + t + 2)], 30, 'join', 'symmetric');
  }
  const zTop = tr ? -hgt / 2 - 41 : 0;
  const rods: SkEntity[] = (tr ? [-x, x] : [0]).map((sx) => circ(rd, sx, 0));
  b.ext('Varillas roscadas', custom([0, tr ? zTop : s.D / 2 + t + 4, 0], [0, 1, 0], [1, 0, 0], 'Varillas'), rods, Lr + (tr ? hgt + 41 : 0));
  const d = doc(s, `Soporte ${tr ? 'trapecio' : 'abrazadera'} ${sizeLabel(s)} ${rod}`, tr
    ? `Soporte en trapecio para conducto ${sizeLabel(s)}: carril 41×41 de ${span} mm y 2 varillas ${rod} (separación recomendada 2,5–3 m)`
    : `Soporte con abrazadera para conducto ${sizeLabel(s)} y varilla ${rod}`);
  d.features = b.f; return d;
}
function makeInsulation(s: HvacSpec): PartDoc {
  const t = autoT(s), e = s.ins ?? 25, L = s.L, b = new B();
  b.ext('Aislamiento', XY(), [secE(s.shape, s.W, s.H, s.D, 2 * t + 2 * e), secE(s.shape, s.W, s.H, s.D, 2 * t)], L);
  const d = doc(s, `Aislamiento ${sizeLabel(s)} e=${e} L=${L}`, `Aislamiento térmico de ${e} mm para conducto ${sizeLabel(s)} · L ${L} (RITE IT 1.2.4.2.1)`);
  d.features = b.f; return d;
}

/** Elementos que admiten sección oval plana */
export const OVAL_KINDS: HvacKind[] = ['duct', 'elbow', 'transition', 'coupling', 'cap', 'flange', 'support', 'insulation'];
export function makeHvacPart(s: HvacSpec): PartDoc {
  nid = 0;
  if ((s.shape === 'oval' || (s.kind === 'transition' && s.shape2 === 'oval')) && !OVAL_KINDS.includes(s.kind)) throw new Error(`${HVAC_KINDS[s.kind]}: no disponible en sección oval`);
  switch (s.kind) {
    case 'duct': return makeDuct(s);
    case 'elbow': return makeElbow(s);
    case 'transition': return makeTransition(s);
    case 'branch': return makeBranch(s);
    case 'coupling': return makeCoupling(s);
    case 'cap': return makeCap(s);
    case 'plenum': return makePlenum(s);
    case 'grille': return makeGrille(s);
    case 'diffuser': return makeDiffuser(s);
    case 'damper': return makeDamper(s, false);
    case 'firedamper': return makeDamper(s, true);
    case 'silencer': return makeSilencer(s);
    case 'flex': return makeFlex(s);
    case 'ahu': return makeAHU(s, false);
    case 'fancoil': return makeAHU(s, true);
    case 'flange': return makeFlangeFrame(s);
    case 'support': return makeSupport(s);
    case 'insulation': return makeInsulation(s);
  }
}

export const HVAC_KINDS: Record<HvacKind, string> = {
  duct: 'Conducto recto', elbow: 'Codo', transition: 'Transición / reducción / desvío', branch: 'Derivación', coupling: 'Manguito de unión (espiral)', cap: 'Tapa final', plenum: 'Plenum',
  grille: 'Rejilla', diffuser: 'Difusor', damper: 'Compuerta de regulación', firedamper: 'Compuerta cortafuegos', silencer: 'Silenciador', flex: 'Conducto flexible',
  ahu: 'UTA (climatizadora)', fancoil: 'Fancoil de conductos',
  flange: 'Brida / marco', support: 'Soporte', insulation: 'Aislamiento',
};
export const HVAC_GROUPS: [string, HvacKind[]][] = [
  ['Conductos', ['duct', 'elbow', 'transition', 'branch', 'coupling', 'cap', 'plenum']],
  ['Terminales y equipos', ['grille', 'diffuser', 'damper', 'firedamper', 'silencer', 'flex', 'ahu', 'fancoil']],
  ['Uniones, soportes y aislamiento', ['flange', 'support', 'insulation']],
];
