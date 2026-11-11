// Cálculo de estructuras de barras: pórtico espacial por rigidez (6 GDL por nudo), combinaciones ELU/ELS (EN 1990)
// y comprobaciones EN 1993-1-1 (resistencia de sección, pandeo por flexión, pandeo lateral simplificado, flecha).
import type { V3 } from './doc';
import type { AsmDoc, FrameMember } from './asm';
import { memberFrame } from './asm';
import { getProfile, profileLabel, type ProfileShape } from './catalog';

// ---------- Propiedades de sección ----------
export interface SecProps { A: number; Iy: number; Iz: number; It: number; Wply: number; Wplz: number; Wely: number; Welz: number; Avz: number; Avy: number; h: number; b: number; tf: number; curveY: number; curveZ: number; curveLT: number; Iw: number }
const ALPHA = { a0: 0.13, a: 0.21, b: 0.34, c: 0.49, d: 0.76 };
/** Propiedades geométricas (mm): y = eje fuerte (flexión en el plano del canto), z = eje débil */
export function sectionProps(p: ProfileShape, coldFormed = true): SecProps {
  switch (p.kind) {
    case 'I': case 'U': {
      const { h, b, tw, tf, r } = p, hw = h - 2 * tf;
      const A = 2 * b * tf + hw * tw + (4 - Math.PI) * r * r;
      const Iy = (b * h ** 3 - (b - tw) * hw ** 3) / 12;
      const xc = (2 * b * tf * (b / 2) + hw * tw * (tw / 2)) / A;
      const Iz = p.kind === 'I' ? (2 * tf * b ** 3 + hw * tw ** 3) / 12 : (2 * tf * b ** 3) / 3 + (hw * tw ** 3) / 3 - A * xc * xc;
      const Wply = b * tf * (h - tf) + (tw * hw * hw) / 4;
      const Wplz = p.kind === 'I' ? (tf * b * b) / 2 + (hw * tw * tw) / 4 : (tf * b * b) / 2 * 0.8;
      const It = (2 * b * tf ** 3 + (h - tf) * tw ** 3) / 3;
      const rolledRatio = h / b;
      return { A, Iy, Iz, It, Wply, Wplz, Wely: (2 * Iy) / h, Welz: p.kind === 'I' ? (2 * Iz) / b : Iz / (b * 0.6), Avz: Math.max(A - 2 * b * tf + (tw + 2 * r) * tf, hw * tw), Avy: 2 * b * tf, h, b, tf,
        curveY: p.kind === 'U' ? ALPHA.c : rolledRatio > 1.2 ? ALPHA.a : ALPHA.b, curveZ: p.kind === 'U' ? ALPHA.c : rolledRatio > 1.2 ? ALPHA.b : ALPHA.c,
        curveLT: rolledRatio <= 2 ? ALPHA.b : ALPHA.c, Iw: (Iz * (h - tf) ** 2) / 4 };
    }
    case 'RHS': {
      const { h, b, t } = p, hi = h - 2 * t, bi = b - 2 * t;
      const A = b * h - bi * hi, Iy = (b * h ** 3 - bi * hi ** 3) / 12, Iz = (h * b ** 3 - hi * bi ** 3) / 12;
      const Am = (b - t) * (h - t), It = (4 * Am * Am * t) / (2 * ((b - t) + (h - t)));
      const c = coldFormed ? ALPHA.c : ALPHA.a;
      return { A, Iy, Iz, It, Wply: (b * h * h - bi * hi * hi) / 4, Wplz: (h * b * b - hi * bi * bi) / 4, Wely: (2 * Iy) / h, Welz: (2 * Iz) / b, Avz: (A * h) / (b + h), Avy: (A * b) / (b + h), h, b, tf: t, curveY: c, curveZ: c, curveLT: ALPHA.d, Iw: 0 };
    }
    case 'CHS': {
      const { d, t } = p, di = d - 2 * t, A = (Math.PI / 4) * (d * d - di * di), I = (Math.PI / 64) * (d ** 4 - di ** 4);
      const c = coldFormed ? ALPHA.c : ALPHA.a;
      return { A, Iy: I, Iz: I, It: 2 * I, Wply: (d ** 3 - di ** 3) / 6, Wplz: (d ** 3 - di ** 3) / 6, Wely: (2 * I) / d, Welz: (2 * I) / d, Avz: (2 * A) / Math.PI, Avy: (2 * A) / Math.PI, h: d, b: d, tf: t, curveY: c, curveZ: c, curveLT: ALPHA.d, Iw: 0 };
    }
    case 'L': {
      const { a, t } = p, A = t * (2 * a - t), c = (a * a + a * t - t * t) / (2 * (2 * a - t));
      const I = (t * (a - c) ** 3 + a * c ** 3 - (a - t) * (c - t) ** 3) / 3;
      const Iv = I * 0.4; // eje débil (principal menor), aproximado
      return { A, Iy: I, Iz: Iv, It: (2 * a * t ** 3) / 3, Wply: 1.5 * I / (a - c), Wplz: 1.5 * Iv / (a * 0.7), Wely: I / (a - c), Welz: Iv / (a * 0.7), Avz: a * t, Avy: a * t, h: a, b: a, tf: t, curveY: ALPHA.b, curveZ: ALPHA.b, curveLT: ALPHA.d, Iw: 0 };
    }
    case 'FLAT': {
      const { b, t } = p, A = b * t;
      return { A, Iy: (b * t ** 3) / 12, Iz: (t * b ** 3) / 12, It: (b * t ** 3) / 3, Wply: (b * t * t) / 4, Wplz: (t * b * b) / 4, Wely: (b * t * t) / 6, Welz: (t * b * b) / 6, Avz: A, Avy: A, h: t, b, tf: t, curveY: ALPHA.c, curveZ: ALPHA.c, curveLT: ALPHA.d, Iw: 0 };
    }
    case 'ROUND': {
      const { d } = p, A = (Math.PI * d * d) / 4, I = (Math.PI * d ** 4) / 64;
      return { A, Iy: I, Iz: I, It: 2 * I, Wply: d ** 3 / 6, Wplz: d ** 3 / 6, Wely: (Math.PI * d ** 3) / 32, Welz: (Math.PI * d ** 3) / 32, Avz: (A * 0.9), Avy: A * 0.9, h: d, b: d, tf: d, curveY: ALPHA.c, curveZ: ALPHA.c, curveLT: ALPHA.d, Iw: 0 };
    }
  }
}

/** Límite elástico según el material (MPa) */
export const fyOf = (mat: string) => (/355/.test(mat) ? 355 : /275/.test(mat) ? 275 : /235/.test(mat) ? 235 : /316|304|inox/i.test(mat) ? 220 : /6061|aluminio/i.test(mat) ? 240 : 275);

// ---------- Modelo ----------
export type SupportType = 'fixed' | 'pinned' | 'roller' | 'free';
export interface FrameLoads {
  /** carga permanente adicional en barras horizontales (kN/m, hacia −Z) */
  g: number;
  /** sobrecarga en barras horizontales (kN/m, hacia −Z) */
  q: number;
  /** cargas puntuales en nudos (kN), variables */
  nodal: Record<string, V3>;
  supports: Record<string, SupportType>;
  gG: number; gQ: number;
  deflLim: number;
  /** longitud de pandeo / longitud real */
  kBuck: number;
  /** pandeo lateral: longitud entre arriostramientos del ala comprimida = L · kLT (0 = arriostrada) */
  kLT: number;
}
export const defaultLoads = (): FrameLoads => ({ g: 1, q: 2, nodal: {}, supports: {}, gG: 1.35, gQ: 1.5, deflLim: 250, kBuck: 1, kLT: 1 });
export const nkey = (p: V3) => p.map((x) => Math.round(x)).join(',');

export interface MemberRes { id: string; name: string; label: string; L: number; N: number; Vy: number; Vz: number; T: number; My: number; Mz: number; uSec: number; uBuck: number; uLT: number; uShear: number; u: number; defl: number; deflRatio: number; okDefl: boolean; cls: string }
export interface FrameRes { nodes: { key: string; p: V3 }[]; members: MemberRes[]; reactions: { key: string; F: V3; M: V3 }[]; maxDisp: number; errors: string[]; weight: number }

/** Resolución lineal (eliminación de Gauss con pivote parcial) */
function solve(K: Float64Array, F: Float64Array, n: number): Float64Array | null {
  const A = K, b = F;
  for (let c = 0; c < n; c++) {
    let piv = c, mx = Math.abs(A[c * n + c]);
    for (let r = c + 1; r < n; r++) { const v = Math.abs(A[r * n + c]); if (v > mx) { mx = v; piv = r; } }
    if (mx < 1e-9) return null;
    if (piv !== c) { for (let k = 0; k < n; k++) { const t = A[c * n + k]; A[c * n + k] = A[piv * n + k]; A[piv * n + k] = t; } const t = b[c]; b[c] = b[piv]; b[piv] = t; }
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / A[c * n + c]; if (!f) continue;
      for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k];
      b[r] -= f * b[c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k]; x[r] = s / A[r * n + r]; }
  return x;
}

/** Rigidez local 12×12 de barra 3D (unidades N, mm). Orden: ux uy uz rx ry rz en cada extremo; x = eje de la barra */
function kLocal(E: number, G: number, A: number, Iy: number, Iz: number, J: number, L: number) {
  const k = new Float64Array(144), s = (i: number, j: number, v: number) => { k[i * 12 + j] += v; if (i !== j) k[j * 12 + i] += v; };
  const ea = (E * A) / L, gj = (G * J) / L;
  s(0, 0, ea); s(6, 6, ea); s(0, 6, -ea);
  s(3, 3, gj); s(9, 9, gj); s(3, 9, -gj);
  // flexión en el plano x-y (giro rz): inercia respecto a z
  const a = (12 * E * Iz) / L ** 3, b = (6 * E * Iz) / L ** 2, c = (4 * E * Iz) / L, d = (2 * E * Iz) / L;
  s(1, 1, a); s(7, 7, a); s(1, 7, -a); s(1, 5, b); s(1, 11, b); s(7, 5, -b); s(7, 11, -b); s(5, 5, c); s(11, 11, c); s(5, 11, d);
  // flexión en el plano x-z (giro ry): inercia respecto a y
  const a2 = (12 * E * Iy) / L ** 3, b2 = (6 * E * Iy) / L ** 2, c2 = (4 * E * Iy) / L, d2 = (2 * E * Iy) / L;
  s(2, 2, a2); s(8, 8, a2); s(2, 8, -a2); s(2, 4, -b2); s(2, 10, -b2); s(8, 4, b2); s(8, 10, b2); s(4, 4, c2); s(10, 10, c2); s(4, 10, d2);
  return k;
}

export function analyzeFrame(asm: AsmDoc, L0: FrameLoads, fyOverride?: number): FrameRes & { sls: FrameRes | null } {
  const uls = run(asm, L0, L0.gG, L0.gQ, fyOverride);
  const sls = run(asm, L0, 1, 1, fyOverride);
  // la flecha se comprueba en ELS
  for (const m of uls.members) { const s = sls.members.find((x) => x.id === m.id); if (s) { m.defl = s.defl; m.deflRatio = s.deflRatio; m.okDefl = s.okDefl; } }
  return { ...uls, sls };
}

function run(asm: AsmDoc, Ld: FrameLoads, gG: number, gQ: number, fyOverride?: number): FrameRes {
  const errors: string[] = [];
  const mems = asm.frames.filter((m) => !m.suppressed);
  const nodes: { key: string; p: V3 }[] = [];
  const idx = (p: V3) => { const k = nkey(p); let i = nodes.findIndex((n) => n.key === k); if (i < 0) { i = nodes.length; nodes.push({ key: k, p }); } return i; };
  // partir barras por los nudos intermedios que caen sobre ellas (uniones a media barra)
  const ends = mems.flatMap((m) => [m.a, m.b]);
  type Elem = { m: FrameMember; a: number; b: number };
  const elems: Elem[] = [];
  for (const m of mems) {
    const d = [m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]], L = Math.hypot(d[0], d[1], d[2]);
    if (L < 1) continue;
    const u = d.map((x) => x / L);
    const ts = [0, L];
    for (const p of ends) { const t = (p[0] - m.a[0]) * u[0] + (p[1] - m.a[1]) * u[1] + (p[2] - m.a[2]) * u[2]; if (t > 1 && t < L - 1 && Math.hypot(m.a[0] + u[0] * t - p[0], m.a[1] + u[1] * t - p[1], m.a[2] + u[2] * t - p[2]) < 1) ts.push(t); }
    ts.sort((x, y) => x - y);
    for (let i = 0; i + 1 < ts.length; i++) {
      const pa: V3 = [m.a[0] + u[0] * ts[i], m.a[1] + u[1] * ts[i], m.a[2] + u[2] * ts[i]], pb: V3 = [m.a[0] + u[0] * ts[i + 1], m.a[1] + u[1] * ts[i + 1], m.a[2] + u[2] * ts[i + 1]];
      elems.push({ m, a: idx(pa), b: idx(pb) });
    }
  }
  const n = nodes.length * 6;
  if (!elems.length) return { nodes, members: [], reactions: [], maxDisp: 0, errors: ['No hay barras de estructura en el ensamblaje (Diseño › Insertar perfil)'], weight: 0 };
  if (n > 2400) return { nodes, members: [], reactions: [], maxDisp: 0, errors: ['Estructura demasiado grande para el cálculo en el navegador (máx. 400 nudos)'], weight: 0 };
  const K = new Float64Array(n * n), F = new Float64Array(n);
  const E = 210000, G = 81000;
  let weight = 0;
  const elData = elems.map((el) => {
    const p = sectionProps(getProfile(el.m.family, el.m.size), !/IPE|HE|UPN/.test(el.m.family));
    const pa = nodes[el.a].p, pb = nodes[el.b].p;
    const fr = memberFrame(pa, pb, Number(el.m.rot) || 0);
    // ejes locales: x = barra, y = ancho del perfil (fr.x), z = canto (fr.y): Iz local = inercia débil, Iy local = fuerte
    const R = [fr.z, fr.x, fr.y];
    const L = fr.len;
    const k = kLocal(E, G, p.A, p.Iy, p.Iz, p.It, L);
    // cargas: peso propio (permanente) + g y q en barras casi horizontales (kN/m = N/mm)
    const sw = p.A * 7.85e-6 * 9.81; // N/mm
    weight += p.A * L * 7.85e-6;
    const horiz = Math.abs(fr.z[2]) < 0.2;
    const wz = -(gG * (sw + (horiz ? Ld.g : 0)) + gQ * (horiz ? Ld.q : 0)); // global Z (N/mm)
    const wg: V3 = [0, 0, wz];
    const wl = R.map((ax) => ax[0] * wg[0] + ax[1] * wg[1] + ax[2] * wg[2]); // componentes locales
    // fuerzas de empotramiento perfecto (locales)
    const fe = new Float64Array(12);
    fe[0] = (wl[0] * L) / 2; fe[6] = (wl[0] * L) / 2;
    fe[1] = (wl[1] * L) / 2; fe[7] = (wl[1] * L) / 2; fe[5] = (wl[1] * L * L) / 12; fe[11] = -(wl[1] * L * L) / 12;
    fe[2] = (wl[2] * L) / 2; fe[8] = (wl[2] * L) / 2; fe[4] = -(wl[2] * L * L) / 12; fe[10] = (wl[2] * L * L) / 12;
    // ensamblaje: T = bloque de R
    const T = (i: number, j: number) => { const bi = Math.floor(i / 3), bj = Math.floor(j / 3); return bi !== bj ? 0 : R[i % 3][j % 3]; };
    const kg = new Float64Array(144);
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) { let s = 0; for (let a = 0; a < 12; a++) { const tai = T(a, i); if (!tai) continue; for (let b = 0; b < 12; b++) { const tbj = T(b, j); if (tbj) s += tai * k[a * 12 + b] * tbj; } } kg[i * 12 + j] = s; }
    const dofs = [...Array(6)].map((_, i) => el.a * 6 + i).concat([...Array(6)].map((_, i) => el.b * 6 + i));
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) K[dofs[i] * n + dofs[j]] += kg[i * 12 + j];
    for (let i = 0; i < 12; i++) { let s = 0; for (let a = 0; a < 12; a++) s += T(a, i) * fe[a]; F[dofs[i]] += s; }
    return { el, p, R, L, k, fe, dofs, wl, T };
  });
  for (const [key, f] of Object.entries(Ld.nodal)) { const i = nodes.findIndex((x) => x.key === key); if (i >= 0) for (let d = 0; d < 3; d++) F[i * 6 + d] += gQ * f[d] * 1000; }
  // apoyos (por defecto: empotrados los nudos más bajos)
  const zMin = Math.min(...nodes.map((x) => x.p[2]));
  const sup = (k: string, z: number): SupportType => Ld.supports[k] ?? (Math.abs(z - zMin) < 1 ? 'fixed' : 'free');
  const fixed = new Set<number>();
  nodes.forEach((nd, i) => {
    const t = sup(nd.key, nd.p[2]);
    if (t === 'fixed') for (let d = 0; d < 6; d++) fixed.add(i * 6 + d);
    else if (t === 'pinned') for (let d = 0; d < 3; d++) fixed.add(i * 6 + d);
    else if (t === 'roller') fixed.add(i * 6 + 2);
  });
  if (!fixed.size) errors.push('No hay apoyos');
  // giros sin rigidez (nudos con barras articuladas o colineales): muelle pequeño para evitar singularidades
  for (let i = 0; i < n; i++) if (i % 6 >= 3) K[i * n + i] += 1; else if (K[i * n + i] === 0) K[i * n + i] = 1;
  const Kc = Float64Array.from(K), Fc = Float64Array.from(F);
  for (const d of fixed) { for (let j = 0; j < n; j++) { Kc[d * n + j] = 0; Kc[j * n + d] = 0; } Kc[d * n + d] = 1; Fc[d] = 0; }
  const U = solve(Kc, Fc, n);
  if (!U) return { nodes, members: [], reactions: [], maxDisp: 0, errors: [...errors, 'Estructura inestable (mecanismo): revisa los apoyos y las uniones'], weight };
  // reacciones
  const reactions: FrameRes['reactions'] = [];
  nodes.forEach((nd, i) => {
    if (!fixed.has(i * 6) && !fixed.has(i * 6 + 2)) return;
    const r = [0, 0, 0, 0, 0, 0];
    for (let d = 0; d < 6; d++) { let s = -F[i * 6 + d]; for (let j = 0; j < n; j++) s += K[(i * 6 + d) * n + j] * U[j]; r[d] = s; }
    reactions.push({ key: nd.key, F: [r[0] / 1000, r[1] / 1000, r[2] / 1000], M: [r[3] / 1e6, r[4] / 1e6, r[5] / 1e6] });
  });
  let maxDisp = 0; for (let i = 0; i < nodes.length; i++) maxDisp = Math.max(maxDisp, Math.hypot(U[i * 6], U[i * 6 + 1], U[i * 6 + 2]));
  // esfuerzos por barra (envolvente de sus elementos)
  const byMember = new Map<string, MemberRes>();
  for (const d of elData) {
    const ug = d.dofs.map((i) => U[i]);
    const ul = new Float64Array(12); for (let a = 0; a < 12; a++) { let s = 0; for (let j = 0; j < 12; j++) s += d.T(a, j) * ug[j]; ul[a] = s; }
    const fl = new Float64Array(12); for (let a = 0; a < 12; a++) { let s = -d.fe[a]; for (let j = 0; j < 12; j++) s += d.k[a * 12 + j] * ul[j]; fl[a] = s; }
    // momentos a lo largo de la barra (extremo 1 + carga repartida)
    let My = 0, Mz = 0, Vy = 0, Vz = 0, defl = 0;
    const E2 = 210000;
    for (let s = 0; s <= 10; s++) {
      const x = (s / 10) * d.L;
      const mz = -fl[5] + fl[1] * x + (d.wl[1] * x * x) / 2;
      const my = -fl[4] - fl[2] * x - (d.wl[2] * x * x) / 2;
      Mz = Math.max(Mz, Math.abs(mz)); My = Math.max(My, Math.abs(my));
      // flecha relativa a la cuerda (Hermite + solución particular de empotramiento)
      const xi = x / d.L, N1 = 1 - 3 * xi * xi + 2 * xi ** 3, N2 = d.L * (xi - 2 * xi * xi + xi ** 3), N3 = 3 * xi * xi - 2 * xi ** 3, N4 = d.L * (-xi * xi + xi ** 3);
      const vy = N1 * ul[1] + N2 * ul[5] + N3 * ul[7] + N4 * ul[11] - (ul[1] * (1 - xi) + ul[7] * xi) + (d.wl[1] * x * x * (d.L - x) ** 2) / (24 * E2 * d.p.Iz);
      const vz = N1 * ul[2] - N2 * ul[4] + N3 * ul[8] - N4 * ul[10] - (ul[2] * (1 - xi) + ul[8] * xi) + (d.wl[2] * x * x * (d.L - x) ** 2) / (24 * E2 * d.p.Iy);
      defl = Math.max(defl, Math.hypot(vy, vz));
    }
    Vy = Math.max(Math.abs(fl[1]), Math.abs(fl[7])); Vz = Math.max(Math.abs(fl[2]), Math.abs(fl[8]));
    const N = -fl[0]; // tracción positiva
    const m = d.el.m, prev = byMember.get(m.id);
    const Ltot = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]);
    const cur = { N, Vy, Vz, T: Math.abs(fl[3]), My, Mz, defl, L: Ltot };
    if (!prev) byMember.set(m.id, { id: m.id, name: m.name, label: profileLabel(m.family, m.size), L: Ltot, N: cur.N, Vy, Vz, T: cur.T, My, Mz, uSec: 0, uBuck: 0, uLT: 0, uShear: 0, u: 0, defl, deflRatio: 0, okDefl: true, cls: '' });
    else { prev.N = Math.abs(cur.N) > Math.abs(prev.N) ? cur.N : prev.N; prev.Vy = Math.max(prev.Vy, Vy); prev.Vz = Math.max(prev.Vz, Vz); prev.T = Math.max(prev.T, cur.T); prev.My = Math.max(prev.My, My); prev.Mz = Math.max(prev.Mz, Mz); prev.defl = Math.max(prev.defl, defl); }
  }
  // comprobaciones EC3 (γM0 = 1,0; γM1 = 1,0)
  const members: MemberRes[] = [];
  for (const r of byMember.values()) {
    const m = mems.find((x) => x.id === r.id)!;
    const p = sectionProps(getProfile(m.family, m.size), !/IPE|HE|UPN/.test(m.family));
    const fy = fyOverride ?? fyOf(m.material);
    const NRd = p.A * fy, MyRd = p.Wply * fy, MzRd = p.Wplz * fy;
    const uSec = Math.abs(r.N) / NRd + r.My / MyRd + r.Mz / MzRd;
    const VRd = (p.Avz * fy) / Math.sqrt(3), VyRd = (p.Avy * fy) / Math.sqrt(3);
    const uShear = Math.max(r.Vz / VRd, r.Vy / VyRd);
    // pandeo por flexión (compresión)
    const Lcr = r.L * Ld.kBuck;
    const chi = (I: number, alpha: number) => {
      const lam = (Lcr / Math.sqrt(I / p.A)) / (Math.PI * Math.sqrt(E / fy));
      const ph = 0.5 * (1 + alpha * (lam - 0.2) + lam * lam);
      return Math.min(1, 1 / (ph + Math.sqrt(Math.max(ph * ph - lam * lam, 0))));
    };
    const chiY = chi(p.Iy, p.curveY), chiZ = chi(p.Iz, p.curveZ);
    // pandeo lateral (perfiles en I/U, C1 = 1, carga en el centro de esfuerzos cortantes)
    let chiLT = 1;
    if (p.Iw > 0 && Ld.kLT > 0) {
      const Lb = r.L * Ld.kLT;
      const Mcr = (Math.PI ** 2 * E * p.Iz) / (Lb * Lb) * Math.sqrt(p.Iw / p.Iz + (Lb * Lb * G * p.It) / (Math.PI ** 2 * E * p.Iz));
      const lamLT = Math.sqrt((p.Wply * fy) / Mcr);
      const ph = 0.5 * (1 + p.curveLT * (lamLT - 0.2) + lamLT * lamLT);
      chiLT = Math.min(1, 1 / (ph + Math.sqrt(Math.max(ph * ph - lamLT * lamLT, 0))));
    }
    const comp = r.N < 0 ? -r.N : 0;
    // interacción simplificada (kyy = kzz = 1, conservadora frente al anejo A/B de EN 1993-1-1 §6.3.3)
    const uBuck = comp / (Math.min(chiY, chiZ) * NRd) + r.My / (chiLT * MyRd) + r.Mz / MzRd;
    const uLT = r.My / (chiLT * MyRd);
    const lim = r.L / Ld.deflLim;
    members.push({ ...r, uSec, uShear, uBuck, uLT, u: Math.max(uSec, uShear, uBuck), deflRatio: r.defl > 0 ? r.L / r.defl : Infinity, okDefl: r.defl <= lim, cls: `χy ${chiY.toFixed(2)} · χz ${chiZ.toFixed(2)} · χLT ${chiLT.toFixed(2)}` });
  }
  return { nodes, members, reactions, maxDisp, errors, weight };
}
