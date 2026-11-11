// Generadores de elementos de máquinas (como Design Accelerator): ejes, engranajes rectos, rodamientos rígidos de bolas,
// muelles de compresión y chavetas paralelas, con sus cálculos básicos.
import { newDoc, type PartDoc, type SkEntity, type Feature } from './doc';

const f1 = (x: number) => String(Math.round(x * 10000) / 10000);
let n = 0; const id = (p: string) => `${p}${++n}`;
const XY = (o = 0) => ({ kind: 'std' as const, name: 'XY' as const, offset: f1(o) });
const XZ = { kind: 'std' as const, name: 'XZ' as const, offset: '0' };
const circ = (d: number, cx = 0, cy = 0): SkEntity => ({ id: id('c'), type: 'circle', cx: f1(cx), cy: f1(cy), d: f1(d) });
const poly = (pts: [number, number][]): SkEntity => ({ id: id('p'), type: 'poly', pts: pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-4).map(([x, y]) => [f1(x), f1(y)] as [string, string]) });
function base(pn: string, desc: string, material: string): PartDoc {
  const d = newDoc(); n = 0;
  d.iProperties = { partNumber: pn, description: desc, designer: 'Generador de diseño', material, revision: '' } as PartDoc['iProperties'];
  return d;
}
const sketch = (d: PartDoc, name: string, plane: unknown, ents: SkEntity[]) => { const s = id('s'); d.features.push({ id: s, name, type: 'sketch', plane: plane as never, entities: ents } as Feature); return s; };
const extrude = (d: PartDoc, name: string, prof: string, dist: number, op: 'join' | 'cut' = 'join', dir: 'normal' | 'reverse' | 'symmetric' = 'normal') => d.features.push({ id: id('f'), name, type: 'extrude', profile: prof, distance: f1(dist), dir, op } as Feature);
const revolve = (d: PartDoc, name: string, prof: string, op: 'join' | 'cut' = 'join') => d.features.push({ id: id('f'), name, type: 'revolve', profile: prof, axis: 'sy', angle: '360 deg', op } as Feature);

// ---------- Chavetas DIN 6885-1 / ISO 773 ----------
/** [d desde, d hasta, b, h, t1 (eje), t2 (cubo)] */
export const KEYS: [number, number, number, number, number, number][] = [
  [6, 8, 2, 2, 1.2, 1], [8, 10, 3, 3, 1.8, 1.4], [10, 12, 4, 4, 2.5, 1.8], [12, 17, 5, 5, 3, 2.3], [17, 22, 6, 6, 3.5, 2.8], [22, 30, 8, 7, 4, 3.3],
  [30, 38, 10, 8, 5, 3.3], [38, 44, 12, 8, 5, 3.3], [44, 50, 14, 9, 5.5, 3.8], [50, 58, 16, 10, 6, 4.3], [58, 65, 18, 11, 7, 4.4], [65, 75, 20, 12, 7.5, 4.9],
  [75, 85, 22, 14, 9, 5.4], [85, 95, 25, 14, 9, 5.4], [95, 110, 28, 16, 10, 6.4], [110, 130, 32, 18, 11, 7.4], [130, 150, 36, 20, 12, 8.4],
];
export const keyFor = (d: number) => KEYS.find((k) => d > k[0] && d <= k[1]) ?? KEYS[KEYS.length - 1];
export const KEY_L = [6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40, 45, 50, 56, 63, 70, 80, 90, 100, 110, 125, 140, 160, 180, 200];
/** Presión superficial de la chaveta: p = 2T / (d · (h − t1) · (l − b)) [MPa] (forma A, longitud útil l − b) */
export const keyPressure = (T: number, d: number, k: (typeof KEYS)[number], l: number) => (2 * T * 1000) / (d * (k[3] - k[4]) * Math.max(l - k[2], 1));
export function makeKey(d: number, l: number, material = 'Acero C45'): PartDoc {
  const k = keyFor(d), [, , b, h] = k;
  const doc = base(`DIN 6885 A ${b}x${h}x${l}`, `Chaveta paralela forma A ${b} × ${h} × ${l} (DIN 6885-1) para eje Ø${d}`, material);
  const s = sketch(doc, 'Contorno', XY(), [{ id: id('sl'), type: 'slot', x1: f1(-(l - b) / 2), y1: '0', x2: f1((l - b) / 2), y2: '0', w: f1(b) }]);
  extrude(doc, 'Chaveta', s, h);
  return doc;
}

// ---------- Eje escalonado ----------
export interface ShaftSec { d: number; L: number; key?: { l: number } ; chamfer?: number }
export function makeShaft(secs: ShaftSec[], material = 'Acero C45'): PartDoc {
  const Ltot = secs.reduce((a, s) => a + s.L, 0);
  const doc = base(`Eje Ø${Math.max(...secs.map((s) => s.d))}×${Ltot}`, `Eje escalonado ${secs.map((s) => `Ø${s.d}×${s.L}`).join(' · ')}`, material);
  // perfil de media sección en XZ (x radio, y = z axial) con chaflanes en los extremos
  const c0 = secs[0].chamfer ?? 1, c1 = secs[secs.length - 1].chamfer ?? 1;
  const pts: [number, number][] = [[0, 0], [secs[0].d / 2 - c0, 0], [secs[0].d / 2, c0]];
  let z = 0;
  secs.forEach((s, i) => {
    if (i > 0) pts.push([s.d / 2, z]);
    z += s.L;
    pts.push([s.d / 2, i === secs.length - 1 ? z - c1 : z]);
  });
  pts.push([secs[secs.length - 1].d / 2 - c1, z], [0, z]);
  revolve(doc, 'Eje', sketch(doc, 'Perfil', XZ, [poly(pts)]));
  // chaveteros
  z = 0;
  for (const s of secs) {
    if (s.key) {
      const k = keyFor(s.d), l = Math.min(s.key.l, s.L - 4), zc = z + s.L / 2;
      const off = s.d / 2 - k[4];
      const p = sketch(doc, `Chavetero ${k[2]}x${k[3]}`, { kind: 'custom', label: 'Chavetero', origin: [0, off, 0], normal: [0, 1, 0], xDir: [0, 0, 1] }, [{ id: id('sl'), type: 'slot', x1: f1(zc - (l - k[2]) / 2), y1: '0', x2: f1(zc + (l - k[2]) / 2), y2: '0', w: f1(k[2]) }]);
      extrude(doc, 'Chavetero', p, k[4] + 2, 'cut');
    }
    z += s.L;
  }
  return doc;
}
/** Tensiones en la sección más débil: τ = 16T/(πd³), σ = 32M/(πd³), Von Mises */
export function shaftCheck(dMin: number, T: number, M: number, fy: number) {
  const tau = (16 * T * 1000) / (Math.PI * dMin ** 3), sig = (32 * M * 1000) / (Math.PI * dMin ** 3);
  const vm = Math.sqrt(sig * sig + 3 * tau * tau);
  return { tau, sig, vm, sf: fy / vm, dReq: Math.cbrt((16 / (Math.PI * fy / 2)) * Math.sqrt((M * 1000) ** 2 + (T * 1000) ** 2)) };
}

// ---------- Engranaje recto de evolvente ----------
const inv = (a: number) => Math.tan(a) - a;
export interface GearSpec { m: number; z: number; b: number; alpha?: number; x?: number; bore: number; key?: boolean; hubD?: number; hubL?: number }
export function gearGeom(g: GearSpec) {
  const a = ((g.alpha ?? 20) * Math.PI) / 180, x = g.x ?? 0;
  const rp = (g.m * g.z) / 2, rb = rp * Math.cos(a), ra = rp + g.m * (1 + x), rf = rp - g.m * (1.25 - x);
  return { a, rp, rb, ra, rf, d: 2 * rp, da: 2 * ra, df: 2 * rf, db: 2 * rb };
}
export function makeGear(g: GearSpec, material = 'Acero 42CrMo4'): PartDoc {
  const G = gearGeom(g), x = g.x ?? 0;
  const s = (Math.PI * g.m) / 2 + 2 * x * g.m * Math.tan(G.a);
  const psiP = s / (2 * G.rp) + inv(G.a); // semiángulo del diente en el círculo base (más la evolvente en el primitivo)
  const r0 = Math.max(G.rb, G.rf);
  const psi = (r: number) => psiP - inv(Math.acos(Math.min(1, G.rb / r)));
  const N = 10, pts: [number, number][] = [];
  const P = (r: number, t: number): [number, number] => [r * Math.cos(t), r * Math.sin(t)];
  for (let k = 0; k < g.z; k++) {
    const th = (2 * Math.PI * k) / g.z;
    if (G.rf < G.rb) pts.push(P(G.rf, th - psi(r0)));
    for (let i = 0; i <= N; i++) { const r = r0 + ((G.ra - r0) * i) / N; pts.push(P(r, th - psi(r))); }
    const tipA = psi(G.ra);
    if (tipA > 0) for (let i = 1; i < 3; i++) pts.push(P(G.ra, th - tipA + (2 * tipA * i) / 3));
    for (let i = N; i >= 0; i--) { const r = r0 + ((G.ra - r0) * i) / N; pts.push(P(r, th + psi(r))); }
    if (G.rf < G.rb) pts.push(P(G.rf, th + psi(r0)));
    // fondo entre dientes
    const t0 = th + psi(r0), t1 = (2 * Math.PI * (k + 1)) / g.z - psi(r0);
    for (let i = 1; i < 4; i++) pts.push(P(G.rf, t0 + ((t1 - t0) * i) / 4));
  }
  const doc = base(`Engranaje m${g.m} z${g.z} b${g.b}`, `Rueda dentada recta m = ${g.m}, z = ${g.z}, α = ${g.alpha ?? 20}°, b = ${g.b} · d = ${G.d.toFixed(2)}, da = ${G.da.toFixed(2)}`, material);
  doc.parameters = [{ name: 'm', expr: `${g.m} mm`, comment: 'Módulo' }, { name: 'z', expr: `${g.z}`, comment: 'Dientes' }, { name: 'd', expr: `${G.d.toFixed(3)} mm`, comment: 'Diámetro primitivo' }];
  extrude(doc, 'Dentado', sketch(doc, 'Perfil de evolvente', XY(), [poly(pts)]), g.b);
  if (g.hubD && g.hubL) extrude(doc, 'Cubo', sketch(doc, 'Cubo', XY(g.b), [circ(g.hubD)]), g.hubL);
  const L = g.b + (g.hubD && g.hubL ? g.hubL : 0);
  extrude(doc, 'Agujero', sketch(doc, 'Agujero', XY(-1), [circ(g.bore)]), L + 2, 'cut');
  if (g.key && g.bore >= 8) {
    const k = keyFor(g.bore);
    extrude(doc, 'Chavetero', sketch(doc, 'Chavetero', XY(-1), [{ id: id('r'), type: 'rect', x: f1(-k[2] / 2), y: f1(0), w: f1(k[2]), h: f1(g.bore / 2 + k[5]) }]), L + 2, 'cut');
  }
  return doc;
}
/** Pareja de ruedas: distancia entre centros, relación y grado de recubrimiento; tensión de Lewis */
export function gearPair(m: number, z1: number, z2: number, alphaDeg = 20) {
  const a = (alphaDeg * Math.PI) / 180, g1 = gearGeom({ m, z: z1, b: 1, bore: 0, alpha: alphaDeg }), g2 = gearGeom({ m, z: z2, b: 1, bore: 0, alpha: alphaDeg });
  const ad = (m * (z1 + z2)) / 2;
  const eps = (Math.sqrt(g1.ra ** 2 - g1.rb ** 2) + Math.sqrt(g2.ra ** 2 - g2.rb ** 2) - ad * Math.sin(a)) / (Math.PI * m * Math.cos(a));
  return { a: ad, i: z2 / z1, eps };
}
export const lewisY = (z: number) => 0.154 - 0.912 / z;
export const lewisStress = (T: number, m: number, z: number, b: number) => { const Ft = (2 * T * 1000) / (m * z); return { Ft, sigma: Ft / (b * m * lewisY(z)) }; };

// ---------- Rodamientos rígidos de bolas ----------
/** designación → [d, D, B, C (kN), C0 (kN)] */
export const BEARINGS: Record<string, [number, number, number, number, number]> = {
  6200: [10, 30, 9, 5.07, 2.36], 6201: [12, 32, 10, 6.89, 3.1], 6202: [15, 35, 11, 7.8, 3.75], 6203: [17, 40, 12, 9.56, 4.75], 6204: [20, 47, 14, 13.5, 6.55],
  6205: [25, 52, 15, 14.8, 7.8], 6206: [30, 62, 16, 20.3, 11.2], 6207: [35, 72, 17, 27, 15.3], 6208: [40, 80, 18, 32.5, 19], 6209: [45, 85, 19, 35.1, 21.6],
  6210: [50, 90, 20, 37.1, 23.2], 6211: [55, 100, 21, 46.2, 29], 6212: [60, 110, 22, 55.3, 36], 6213: [65, 120, 23, 58.5, 40.5], 6214: [70, 125, 24, 63.7, 45],
  6215: [75, 130, 25, 68.9, 49], 6216: [80, 140, 26, 72.8, 55],
  6300: [10, 35, 11, 8.52, 3.4], 6301: [12, 37, 12, 9.75, 4.15], 6302: [15, 42, 13, 11.9, 5.4], 6303: [17, 47, 14, 14.3, 6.55], 6304: [20, 52, 15, 16.8, 7.8],
  6305: [25, 62, 17, 23.4, 11.6], 6306: [30, 72, 19, 29.6, 16], 6307: [35, 80, 21, 35.1, 19], 6308: [40, 90, 23, 42.3, 24], 6309: [45, 100, 25, 55.3, 31.5],
  6310: [50, 110, 27, 65, 38], 6311: [55, 120, 29, 74.1, 45], 6312: [60, 130, 31, 85.2, 52],
};
/** Vida nominal L10h (horas) = (C/P)³·10⁶/(60·n) */
export const bearingLife = (C: number, P: number, rpm: number) => (Math.pow(C / Math.max(P, 1e-6), 3) * 1e6) / (60 * Math.max(rpm, 1));
/** Carga dinámica equivalente aproximada (rígido de bolas): P = X·Fr + Y·Fa con X = 0,56, Y ≈ 1,5 si Fa/Fr > 0,3 */
export const bearingP = (Fr: number, Fa: number) => (Fr > 0 && Fa / Fr > 0.3 ? 0.56 * Fr + 1.5 * Fa : Fr);
export function makeBearing(des: string): PartDoc {
  const [d, D, B] = BEARINGS[des];
  const doc = base(`Rodamiento ${des}`, `Rodamiento rígido de bolas ${des} (ISO 15) · d ${d} · D ${D} · B ${B}`, 'Acero 100Cr6');
  const dm = (d + D) / 2, Dw = 0.3 * (D - d);
  const ri = d / 2, ro = D / 2, ti = (dm - Dw * 0.35) / 2, to = (dm + Dw * 0.35) / 2; // radios de los aros en la pista
  const ch = Math.min(0.6, B * 0.06);
  // aros interior y exterior (media sección en XZ) con pista circular
  const inner: [number, number][] = [[ri + ch, 0], [ti, 0], [ti, B], [ri + ch, B], [ri, B - ch], [ri, ch]];
  const outer: [number, number][] = [[to, 0], [ro - ch, 0], [ro, ch], [ro, B - ch], [ro - ch, B], [to, B]];
  revolve(doc, 'Aro interior', sketch(doc, 'Aro interior', XZ, [poly(inner)]));
  revolve(doc, 'Aro exterior', sketch(doc, 'Aro exterior', XZ, [poly(outer)]));
  // pistas (toro) en los dos aros
  const race = (): [number, number][] => { const out: [number, number][] = []; for (let i = 0; i < 24; i++) { const t = (2 * Math.PI * i) / 24; out.push([dm / 2 + Dw * 0.51 * Math.cos(t), B / 2 + Dw * 0.51 * Math.sin(t)]); } return out; };
  revolve(doc, 'Pistas', sketch(doc, 'Pistas', XZ, [poly(race())]), 'cut');
  // bolas: media circunferencia girada sobre su diámetro y patrón circular
  const half: [number, number][] = []; for (let i = 0; i <= 16; i++) { const t = -Math.PI / 2 + (Math.PI * i) / 16; half.push([dm / 2 + (Dw / 2) * Math.cos(t), B / 2 + (Dw / 2) * Math.sin(t)]); }
  const nb = Math.max(6, Math.floor((Math.PI * dm) / (Dw * 1.35)));
  const sb = sketch(doc, 'Bola', { kind: 'custom', label: 'Bola', origin: [0, 0, 0], normal: [0, -1, 0], xDir: [1, 0, 0] }, [poly(half), { id: 'bax', type: 'line', a: [f1(dm / 2), f1(B / 2 - Dw)], b: [f1(dm / 2), f1(B / 2 + Dw)], construction: true }]);
  const fb = id('f');
  doc.features.push({ id: fb, name: 'Bola', type: 'revolve', profile: sb, axis: 'bax', angle: '360 deg', op: 'join' } as Feature);
  doc.features.push({ id: id('f'), name: `Bolas (${nb})`, type: 'pattern', ptype: 'circ', features: [fb], dir1: 'X', n1: '1', d1: '0', dir2: '', n2: '1', d2: '0', axis: 'Z', count: String(nb), angle: '360 deg' } as Feature);
  return doc;
}

// ---------- Muelle de compresión ----------
export interface SpringSpec { d: number; Dm: number; na: number; L0: number; ends: 'closed' | 'ground' }
export function springCalc(s: SpringSpec, F: number, G = 81500) {
  const C = s.Dm / s.d, Kw = (4 * C - 1) / (4 * C - 4) + 0.615 / C;
  const k = (G * s.d ** 4) / (8 * s.Dm ** 3 * s.na);
  const nt = s.na + 2, Ls = nt * s.d * (s.ends === 'ground' ? 1 : 1.0) + (s.ends === 'ground' ? 0 : s.d);
  const tau = (Kw * 8 * F * s.Dm) / (Math.PI * s.d ** 3);
  const Rm = 2230 - 355 * Math.log(Math.max(s.d, 0.3)); // EN 10270-1 SH (aprox.)
  const sMax = s.L0 - Ls, Fmax = k * sMax, tauS = (Kw * 8 * Fmax * s.Dm) / (Math.PI * s.d ** 3);
  return { C, Kw, k, nt, Ls, tau, Rm, tauAll: 0.45 * Rm, defl: F / k, sMax, Fmax, tauS, buckling: s.L0 / s.Dm > 5.24 };
}
export function makeSpring(s: SpringSpec): PartDoc {
  const nt = s.na + 2, pitch = (s.L0 - (s.ends === 'ground' ? 0 : s.d)) / nt;
  const doc = base(`Muelle d${s.d} Dm${s.Dm} n${s.na} L0 ${s.L0}`, `Muelle de compresión hilo Ø${s.d}, Dm ${s.Dm}, ${s.na} espiras útiles (${nt} totales), L0 ${s.L0} mm, extremos ${s.ends === 'ground' ? 'cerrados y esmerilados' : 'cerrados'}`, 'Acero para muelles EN 10270-1 SH');
  const sp = sketch(doc, 'Sección del hilo', XZ, [circ(s.d, s.Dm / 2, s.d / 2), { id: 'sax', type: 'line', a: ['0', '0'], b: ['0', '10'], construction: true }]);
  doc.features.push({ id: id('f'), name: 'Espiras', type: 'coil', profile: sp, axis: 'sax', pitch: f1(pitch), turns: f1(nt - 0.02), left: false, op: 'join' } as Feature);
  if (s.ends === 'ground') {
    extrude(doc, 'Esmerilado inferior', sketch(doc, 'Corte inferior', XY(-s.d * 2), [circ(s.Dm + 3 * s.d)]), s.d * 2 + s.d * 0.25, 'cut');
    extrude(doc, 'Esmerilado superior', sketch(doc, 'Corte superior', XY(s.L0 - s.d * 0.25 + pitch * 0), [circ(s.Dm + 3 * s.d)]), s.d * 3, 'cut');
  }
  return doc;
}
