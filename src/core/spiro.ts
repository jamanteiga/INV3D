// Espirotubo: tubo helicoidal comercial y accesorios con extremos macho (EN 1506 / EN 12237).
// Convención comercial: el tubo se designa por su diámetro interior nominal y los accesorios por el
// exterior de su extremo macho (Ø − 1 mm), que entra en el tubo. El eje es Z y la boca 1 está en z = 0.
import { newDoc, type PartDoc, type SkEntity, type V3 } from './doc';
import { B, XY, XZ, YZ, custom, circ, poly, rect, f1, id, resetIds, makeHvacPart, spiralPitch } from './hvac';

/** Diámetros nominales comerciales (serie EN 1506 más los habituales de catálogo en España) */
export const SPIRO_D = [80, 100, 125, 140, 150, 160, 180, 200, 224, 250, 280, 300, 315, 355, 400, 450, 500, 560, 600, 630, 710, 800, 900, 1000, 1120, 1250];
/** Espesores comerciales de chapa (mm) */
export const SPIRO_T = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.25, 1.5];
export const SPIRO_ANGLES = [15, 30, 45, 60, 90];
/** Longitudes comerciales de tubo (mm) */
export const SPIRO_L = [500, 1000, 1500, 2000, 3000, 6000];

/** Espesor de tubo habitual de catálogo (acero galvanizado, clase de estanqueidad C) — orientativo */
export function tubeT(D: number) { return D <= 250 ? 0.5 : D <= 500 ? 0.6 : D <= 800 ? 0.8 : D <= 1000 ? 1.0 : 1.2; }
/** Espesor habitual de accesorios (prensados y de gajos, una galga por encima del tubo) — orientativo */
export function fitT(D: number) { return D <= 200 ? 0.5 : D <= 400 ? 0.7 : D <= 630 ? 0.8 : D <= 1000 ? 1.0 : 1.25; }
/** Longitud de inserción del extremo macho */
export function spigotL(D: number) { return D <= 250 ? 40 : D <= 630 ? 60 : 80; }

export type SpiroKind =
  | 'tube' | 'elbow' | 'tee' | 'tee45' | 'cross' | 'saddle' | 'reducer' | 'reducerEcc'
  | 'nipple' | 'sleeve' | 'capM' | 'capF' | 'clamp' | 'damper' | 'roofcap';

export const SPIRO_KINDS: Record<SpiroKind, string> = {
  tube: 'Tubo espiral', elbow: 'Codo', tee: 'Te 90°', tee45: 'Te 45° (injerto)', cross: 'Cruz 90°', saddle: 'Toma de silla (injerto sobre tubo)',
  reducer: 'Reducción concéntrica', reducerEcc: 'Reducción excéntrica', nipple: 'Manguito macho (unión tubo-tubo)', sleeve: 'Manguito hembra (unión accesorio-accesorio)',
  capM: 'Tapón macho (para tubo)', capF: 'Tapón hembra (para accesorio)', clamp: 'Abrazadera de suspensión', damper: 'Compuerta de regulación', roofcap: 'Sombrerete (terminal de cubierta)',
};
export const SPIRO_GROUPS: [string, SpiroKind[]][] = [
  ['Tubo', ['tube']],
  ['Codos', ['elbow']],
  ['Derivaciones', ['tee', 'tee45', 'cross', 'saddle']],
  ['Reducciones', ['reducer', 'reducerEcc']],
  ['Uniones y cierres', ['nipple', 'sleeve', 'capM', 'capF']],
  ['Soportes y terminales', ['clamp', 'damper', 'roofcap']],
];
/** Accesorios con segundo diámetro */
export const SPIRO_D2: SpiroKind[] = ['tee', 'tee45', 'cross', 'saddle', 'reducer', 'reducerEcc'];

export interface SpiroSpec {
  kind: SpiroKind; D: number; D2?: number;
  /** espesor de chapa; 0 / ausente = comercial */
  t?: number;
  L?: number; angle?: number;
  /** Radio del codo en diámetros (1 D o 1,5 D) */
  rd?: number;
  /** Codo: prensado (liso), por gajos o automático según diámetro */
  build?: 'auto' | 'pressed' | 'segmented';
  /** Extremos macho con junta de labio EPDM o sin junta */
  gasket: boolean;
  material: string;
}

const dec = (v: number) => String(v).replace('.', ',');

function doc(s: SpiroSpec, pn: string, desc: string, params: [string, number, string][] = []): PartDoc {
  const d = newDoc();
  d.iProperties = { partNumber: pn, description: desc, designer: 'Centro de contenido · Espirotubo', material: s.material, revision: '', project: '', stockNumber: 'EN 1506 / EN 12237' } as PartDoc['iProperties'];
  d.parameters = params.map(([name, v, comment]) => ({ name, expr: `${f1(v)} mm`, comment }));
  return d;
}

/** Codos por gajos: número habitual de piezas según el ángulo */
export const goresFor = (ang: number) => (ang <= 15 ? 2 : ang <= 45 ? 3 : ang <= 60 ? 4 : 5);
/** Construcción automática: prensado hasta Ø315, por gajos por encima */
const elbowBuild = (s: SpiroSpec) => (s.build && s.build !== 'auto' ? s.build : s.D <= 315 ? 'pressed' : 'segmented');

/** Extremo macho: junta de labio y cordón de tope en un plano dado (normal = sentido hacia el interior del accesorio). */
function maleEnd(b: B, s: SpiroSpec, D: number, t: number, at: (z: number) => ReturnType<typeof XY>) {
  const dO = D - 1, Lm = spigotL(D);
  if (s.gasket) b.ext('Junta EPDM', at(10), [circ(D + 2), circ(dO - 0.2)], 6);
  b.ext('Cordón de tope', at(Lm - 4), [circ(dO + 6), circ(dO - 0.2)], 4);
  void t;
}
const planeAt = (origin: V3, n: V3, xd: V3) => (z: number) => custom([origin[0] + n[0] * z, origin[1] + n[1] * z, origin[2] + n[2] * z], n, xd, 'Boca');
const ends = (s: SpiroSpec) => (s.gasket ? 'extremos macho con junta EPDM' : 'extremos macho sin junta');

// ---------- Codo ----------
function makeElbow(s: SpiroSpec, t: number): PartDoc {
  const ang = s.angle ?? 90, D = s.D, dO = D - 1, dI = dO - 2 * t, Lm = spigotL(D), rd = s.rd ?? 1, Rc = rd * D, b = new B();
  const bd = elbowBuild(s);
  b.ext('Extremo macho 1', XY(), [circ(dO), circ(dI)], Lm);
  const th = (ang * Math.PI) / 180;
  if (bd === 'pressed') {
    const ax: SkEntity = { id: 'ax', type: 'line', a: [f1(Rc), '-10'], b: [f1(Rc), '10'], construction: true };
    b.rev('Codo prensado', XY(Lm), [circ(dO), circ(dI), ax], 'ax', ang);
  } else {
    const n = goresFor(ang), dl = th / (n - 1), full = 2 * Rc * Math.tan(dl / 2);
    const path = (ext: number) => {
      const p: [number, number][] = [[0, Lm - ext]]; let x = 0, z = Lm;
      for (let i = 0; i < n; i++) {
        const phi = i * dl, len = (i === 0 || i === n - 1 ? full / 2 : full) + (i === n - 1 ? ext : 0);
        x += Math.sin(phi) * len; z += Math.cos(phi) * len; p.push([x, z]);
      }
      return p;
    };
    const lines = (pts: [number, number][]): SkEntity[] => pts.slice(1).map((q, i) => ({ id: id('l'), type: 'line', a: [f1(pts[i][0]), f1(pts[i][1])], b: [f1(q[0]), f1(q[1])] }));
    const po = b.sketch('Trayectoria', XZ(), lines(path(0)));
    const pi = b.sketch('Trayectoria interior', XZ(), lines(path(0.5)));
    const so = b.sketch('Sección exterior', XY(Lm), [circ(dO)]);
    const si = b.sketch('Sección interior', XY(Lm - 0.5), [circ(dI)]);
    b.f.push({ id: 'sw1', name: `Gajos (${n})`, type: 'sweep', profile: so, path: po, op: 'join', transition: 'right' });
    b.f.push({ id: 'sw2', name: 'Interior gajos', type: 'sweep', profile: si, path: pi, op: 'cut', transition: 'right' });
  }
  // la salida queda en el mismo punto para prensado y gajos (tangentes iguales)
  const C: V3 = [Rc * (1 - Math.cos(th)), 0, Lm + Rc * Math.sin(th)], nOut: V3 = [Math.sin(th), 0, Math.cos(th)];
  b.ext('Extremo macho 2', custom(C, nOut, [0, 1, 0], 'Boca 2'), [circ(dO), circ(dI)], Lm);
  maleEnd(b, s, D, t, (z) => XY(z));
  // en la boca 2 el «interior» va hacia atrás: se mide desde el extremo libre
  const tip: V3 = [C[0] + nOut[0] * Lm, 0, C[2] + nOut[2] * Lm], nIn: V3 = [-nOut[0], 0, -nOut[2]];
  maleEnd(b, s, D, t, (z) => planeAt(tip, nIn, [0, 1, 0])(z));
  const nm = bd === 'pressed' ? 'prensado' : `de ${goresFor(ang)} gajos`;
  const d = doc(s, `ESP-CODO${ang}-Ø${D}-R${dec(rd)}D`, `Codo ${ang}° ${nm} para espirotubo Ø${D} · R = ${dec(rd)}·D (${Math.round(Rc)} mm) · ${ends(s)} · chapa ${dec(t)} mm`,
    [['D', D, 'Diámetro nominal'], ['R', Rc, 'Radio al eje'], ['t', t, 'Espesor de chapa']]);
  d.features = b.f; return d;
}

// ---------- Tes, cruz e injerto a 45° ----------
function makeTee(s: SpiroSpec, t: number): PartDoc {
  const D = s.D, D2 = Math.min(s.D2 ?? D, D), dO = D - 1, dI = dO - 2 * t, d2O = D2 - 1, d2I = d2O - 2 * t;
  const Lm = spigotL(D), Lm2 = spigotL(D2), b = new B();
  const k = s.kind, a45 = k === 'tee45';
  const L = s.L && s.L > 0 ? s.L : a45 ? Math.round(D2 * Math.SQRT2 + 2 * Lm + 100) : D2 + 2 * Lm + 100;
  const zb = L / 2, half = dO / 2, arm = half + 50 + Lm2;
  b.ext('Cuerpo', XY(), [circ(dO), circ(dI)], L);
  const sides = k === 'cross' ? [1, -1] : [1];
  const branches: { o: V3; n: V3; len: number }[] = [];
  if (a45) {
    const al = Math.PI / 4, n: V3 = [Math.sin(al), 0, Math.cos(al)], len = half / Math.sin(al) + 50 + Lm2;
    const o: V3 = [0, 0, zb - half / Math.tan(al)];
    b.ext('Derivación 45°', custom(o, n, [0, 1, 0], 'Derivación'), [circ(d2O)], len);
    branches.push({ o, n, len });
  } else for (const sg of sides) {
    b.ext(sg > 0 ? 'Derivación' : 'Derivación opuesta', YZ(), [circ(d2O, 0, zb)], arm, 'join', sg > 0 ? 'normal' : 'reverse');
    branches.push({ o: [0, 0, zb], n: [sg, 0, 0], len: arm });
  }
  b.ext('Interior cuerpo', XY(-1), [circ(dI)], L + 2, 'cut');
  if (a45) b.ext('Recorte inferior', XY(0), [circ(4 * D)], 400, 'cut', 'reverse');
  for (const br of branches) b.ext('Interior derivación', custom(br.o, br.n, [0, 1, 0], 'Derivación'), [circ(d2I)], br.len + 1, 'cut');
  maleEnd(b, s, D, t, (z) => XY(z));
  maleEnd(b, s, D, t, (z) => custom([0, 0, L - z - (z === 10 ? 6 : 4)], [0, 0, 1], [1, 0, 0], 'Boca 2'));
  for (const br of branches) { const tip: V3 = [br.o[0] + br.n[0] * br.len, 0, br.o[2] + br.n[2] * br.len], nIn: V3 = [-br.n[0], 0, -br.n[2]]; maleEnd(b, s, D2, t, (z) => planeAt(tip, nIn, [0, 1, 0])(z)); }
  const red = D2 < D ? ` reducida Ø${D}/Ø${D2}` : ` Ø${D}`;
  const nm = k === 'cross' ? 'Cruz 90°' : a45 ? 'Te 45° (injerto)' : 'Te 90°';
  const d = doc(s, `ESP-${k === 'cross' ? 'CRUZ' : a45 ? 'TE45' : 'TE90'}-Ø${D}-Ø${D2}`, `${nm}${red} para espirotubo · L ${L} mm · ${ends(s)} · chapa ${dec(t)} mm`,
    [['D', D, 'Diámetro principal'], ['D2', D2, 'Diámetro derivación'], ['L', L, 'Longitud'], ['t', t, 'Espesor de chapa']]);
  d.features = b.f; return d;
}

// ---------- Toma de silla (se monta sobre el tubo) ----------
function makeSaddle(s: SpiroSpec, t: number): PartDoc {
  const D = s.D, D2 = Math.min(s.D2 ?? D / 2, D * 0.8), tt = tubeT(D), Ro = D / 2 + tt, d2O = D2 - 1, d2I = d2O - 2 * t, Lm2 = spigotL(D2), b = new B();
  const Ls = D2 + 60, zb = Ls / 2, arm = Ro + 30 + Lm2;
  b.ext('Silla', XY(), [circ(2 * (Ro + t)), circ(2 * Ro)], Ls);
  b.ext('Recorte de la silla', XY(-1), [rect(1.35 * Ro + 10, 2 * Ro + 10, (0.35 * Ro - Ro - 10) / 2, 0)], Ls + 2, 'cut');
  b.ext('Boca', YZ(), [circ(d2O, 0, zb)], arm);
  b.ext('Paso del tubo', XY(-1), [circ(2 * Ro)], Ls + 2, 'cut');
  b.ext('Interior boca', YZ(), [circ(d2I, 0, zb)], arm + 1, 'cut');
  maleEnd(b, s, D2, t, (z) => custom([arm - z - (z === 10 ? 6 : 4), 0, zb], [1, 0, 0], [0, 1, 0], 'Boca'));
  const d = doc(s, `ESP-SILLA-Ø${D}-Ø${D2}`, `Toma de silla Ø${D2} sobre espirotubo Ø${D} (montaje con remaches o tornillos y masilla) · ${ends(s)} · chapa ${dec(t)} mm`,
    [['D', D, 'Diámetro del tubo'], ['D2', D2, 'Diámetro de la toma'], ['t', t, 'Espesor de chapa']]);
  d.features = b.f; return d;
}

// ---------- Reducciones ----------
function makeReducer(s: SpiroSpec, t: number): PartDoc {
  const D = s.D, D2 = Math.min(s.D2 ?? D, D);
  if (D2 >= D) throw new Error('La reducción necesita Ø2 menor que Ø1');
  const dO = D - 1, d2O = D2 - 1, Lm = spigotL(D), Lm2 = spigotL(D2), Lc = s.L && s.L > 0 ? s.L : Math.max(60, Math.round(D - D2));
  const ecc = s.kind === 'reducerEcc', e = ecc ? (dO - d2O) / 2 : 0, b = new B();
  const z1 = Lm, z2 = Lm + Lc;
  b.ext('Extremo macho 1', XY(), [circ(dO), circ(dO - 2 * t)], Lm);
  const so = b.sketch('Sección grande', XY(z1), [circ(dO)]), sb = b.sketch('Sección pequeña', XY(z2), [circ(d2O, 0, -e)]);
  b.f.push({ id: 'lf1', name: 'Cono', type: 'loft', sections: [so, sb], ruled: true, op: 'join' });
  const si = b.sketch('Interior grande', XY(z1), [circ(dO - 2 * t)]), sj = b.sketch('Interior pequeño', XY(z2), [circ(d2O - 2 * t, 0, -e)]);
  b.f.push({ id: 'lf2', name: 'Interior cono', type: 'loft', sections: [si, sj], ruled: true, op: 'cut' });
  b.ext('Extremo macho 2', XY(z2), [circ(d2O, 0, -e), circ(d2O - 2 * t, 0, -e)], Lm2);
  maleEnd(b, s, D, t, (z) => XY(z));
  const zt = z2 + Lm2;
  if (s.gasket) b.ext('Junta EPDM 2', XY(zt - 16), [circ(D2 + 2, 0, -e), circ(d2O - 0.2, 0, -e)], 6);
  b.ext('Cordón de tope 2', XY(z2), [circ(d2O + 6, 0, -e), circ(d2O - 0.2, 0, -e)], 4);
  const nm = ecc ? 'Reducción excéntrica (generatriz plana)' : 'Reducción concéntrica';
  const d = doc(s, `ESP-RED${ecc ? 'E' : 'C'}-Ø${D}-Ø${D2}`, `${nm} Ø${D} → Ø${D2} para espirotubo · L ${zt} mm · ${ends(s)} · chapa ${dec(t)} mm`,
    [['D', D, 'Diámetro mayor'], ['D2', D2, 'Diámetro menor'], ['t', t, 'Espesor de chapa']]);
  d.features = b.f; return d;
}

// ---------- Manguitos y tapones ----------
function makeUnion(s: SpiroSpec, t: number): PartDoc {
  const D = s.D, dO = D - 1, Lm = spigotL(D), b = new B(), k = s.kind;
  let pn = '', desc = '';
  if (k === 'nipple') {
    // macho-macho: entra en los dos tubos, cordón central de tope
    const L = 2 * Lm + 10;
    b.ext('Manguito macho', XY(), [circ(dO), circ(dO - 2 * t)], L);
    b.ext('Cordón central', XY(Lm), [circ(dO + 6), circ(dO - 0.2)], 10);
    if (s.gasket) for (const z of [10, L - 16]) b.ext('Junta EPDM', XY(z), [circ(D + 2), circ(dO - 0.2)], 6);
    pn = `ESP-MANGM-Ø${D}`; desc = `Manguito macho (unión tubo-tubo) Ø${D} · L ${L} mm · ${s.gasket ? 'con juntas EPDM' : 'sin junta'} · chapa ${dec(t)} mm`;
  } else if (k === 'sleeve') {
    // hembra-hembra: recibe dos accesorios (interior = Ø nominal), tope interior central
    const ts = Math.max(t, fitT(D)), L = 2 * Lm + 10;
    b.ext('Manguito hembra', XY(), [circ(D + 2 * ts), circ(D)], L);
    b.ext('Tope interior', XY(Lm), [circ(D + 0.2), circ(D - 8)], 10);
    pn = `ESP-MANGH-Ø${D}`; desc = `Manguito hembra (unión accesorio-accesorio) Ø${D} · L ${L} mm · chapa ${dec(ts)} mm`;
  } else if (k === 'capM') {
    b.ext('Fondo', XY(), [circ(dO + 6)], Math.max(t, 0.8));
    b.ext('Extremo macho', XY(), [circ(dO), circ(dO - 2 * t)], Lm);
    if (s.gasket) b.ext('Junta EPDM', XY(Lm - 16), [circ(D + 2), circ(dO - 0.2)], 6);
    pn = `ESP-TAPM-Ø${D}`; desc = `Tapón macho Ø${D} (cierre de tubo) · ${s.gasket ? 'con junta EPDM' : 'sin junta'} · chapa ${dec(t)} mm`;
  } else {
    const ts = Math.max(t, fitT(D));
    b.ext('Fondo', XY(), [circ(D + 2 * ts)], Math.max(ts, 0.8));
    b.ext('Collar hembra', XY(), [circ(D + 2 * ts), circ(D)], Lm + 10);
    pn = `ESP-TAPH-Ø${D}`; desc = `Tapón hembra Ø${D} (cierre de accesorio) · chapa ${dec(ts)} mm`;
  }
  const d = doc(s, pn, desc, [['D', D, 'Diámetro nominal'], ['t', t, 'Espesor de chapa']]);
  d.features = b.f; return d;
}

// ---------- Abrazadera de suspensión ----------
function makeClamp(s: SpiroSpec): PartDoc {
  const D = s.D, Ri = D / 2 + tubeT(D), w = D <= 315 ? 25 : 35, tb = D <= 630 ? 1.5 : 2, b = new B();
  const rod = D <= 315 ? 8 : D <= 800 ? 10 : 12, ear = rod + 14;
  // banda en el plano XY a lo largo de Z = eje del tubo; orejeta superior con tuerca para varilla roscada
  b.ext('Banda', XY(), [circ(2 * (Ri + tb)), circ(2 * Ri)], w);
  b.ext('Orejetas', XY(), [rect(ear, 30, 0, Ri + tb + 12)], w);
  b.ext('Paso del tubo', XY(-1), [circ(2 * Ri)], w + 2, 'cut');
  const yTop = Ri + tb + 27;
  b.ext('Tuerca de suspensión', custom([0, yTop - 0.5, w / 2], [0, 1, 0], [1, 0, 0], 'Tuerca'), [circ(rod * 1.8)], rod * 0.8 + 0.5);
  b.ext('Rosca', custom([0, yTop - 20, w / 2], [0, 1, 0], [1, 0, 0], 'Rosca'), [circ(rod)], 21 + rod, 'cut');
  b.ext('Junta de goma', XY(1), [circ(2 * Ri + 0.2), circ(2 * Ri - 4)], w - 2);
  const d = doc(s, `ESP-ABR-Ø${D}-M${rod}`, `Abrazadera de suspensión Ø${D} con goma antivibratoria y tuerca M${rod} para varilla roscada · banda ${w}×${dec(tb)} mm`,
    [['D', D, 'Diámetro del tubo']]);
  d.iProperties.material = s.material;
  d.features = b.f; return d;
}

// ---------- Compuerta de regulación ----------
function makeDamper(s: SpiroSpec, t: number): PartDoc {
  const D = s.D, dO = D - 1, dI = dO - 2 * t, Lm = spigotL(D), L = s.L && s.L > 0 ? s.L : Math.max(2 * Lm + 100, Math.round(D * 0.6) + 2 * Lm), zc = L / 2, b = new B();
  const sh = D <= 315 ? 8 : 12;
  b.ext('Cuerpo', XY(), [circ(dO), circ(dI)], L);
  b.ext('Lama', XZ(), [rect(dI - 3, 1.5, 0, zc)], dI - 3, 'join', 'symmetric');
  b.ext('Recorte de la lama', XY(zc - 1), [circ(2 * dI), circ(dI - 3)], 2, 'cut');
  b.ext('Eje', XZ(), [circ(sh, 0, zc)], dO + 80, 'join', 'symmetric');
  b.ext('Sector de maniobra', XZ(-(dO / 2 + 25)), [poly([[-10, zc - 6], [10, zc - 6], [45, zc + 30], [-45, zc + 30]])], 2);
  b.ext('Palanca', XZ(-(dO / 2 + 27)), [rect(16, 70, 0, zc + 25)], 3);
  maleEnd(b, s, D, t, (z) => XY(z));
  maleEnd(b, s, D, t, (z) => custom([0, 0, L - z - (z === 10 ? 6 : 4)], [0, 0, 1], [1, 0, 0], 'Boca 2'));
  const d = doc(s, `ESP-COMP-Ø${D}`, `Compuerta de regulación manual Ø${D} con sector de bloqueo · L ${L} mm · ${ends(s)} · chapa ${dec(t)} mm`,
    [['D', D, 'Diámetro nominal'], ['L', L, 'Longitud'], ['t', t, 'Espesor de chapa']]);
  d.features = b.f; return d;
}

// ---------- Sombrerete ----------
function makeRoofcap(s: SpiroSpec, t: number): PartDoc {
  const D = s.D, dO = D - 1, dI = dO - 2 * t, Lm = spigotL(D), Lb = Lm + 100, gap = Math.max(60, D * 0.5), Dh = D * 2, hh = D * 0.35, b = new B();
  b.ext('Boca', XY(), [circ(dO), circ(dI)], Lb);
  // cono del sombrero (revolución de un perfil de chapa)
  const z0 = Lb + gap, tc = Math.max(t, 0.6) * 1.5;
  const ax: SkEntity = { id: 'cax', type: 'line', a: ['0', '0'], b: ['0', '10'], construction: true };
  b.rev('Sombrero', XZ(), [poly([[0, z0 + hh], [Dh / 2, z0], [Dh / 2, z0 - tc * 2], [0, z0 + hh - tc * 2.2]]), ax], 'cax', 360);
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * Math.PI) / 3, r = dO / 2 + 5, sz = 12;
    const zLow = z0 + hh - 2.2 * tc - (r / (Dh / 2)) * (hh - 0.2 * tc);
    b.ext('Pata', XY(Lb - 40), [rect(sz, sz, r * Math.cos(a), r * Math.sin(a))], zLow + 0.5 - (Lb - 40));
  }
  maleEnd(b, s, D, t, (z) => XY(z));
  const d = doc(s, `ESP-SOMB-Ø${D}`, `Sombrerete (terminal de cubierta) Ø${D} · sombrero Ø${Dh} · ${ends(s)} · chapa ${dec(t)} mm`,
    [['D', D, 'Diámetro nominal'], ['t', t, 'Espesor de chapa']]);
  d.features = b.f; return d;
}

export function spiroThickness(s: SpiroSpec) { return s.t && s.t > 0 ? s.t : s.kind === 'tube' ? tubeT(s.D) : fitT(s.D); }

export function makeSpiroPart(s: SpiroSpec): PartDoc {
  resetIds();
  if (!(s.D >= 50)) throw new Error('Diámetro no válido');
  const t = spiroThickness(s);
  switch (s.kind) {
    case 'tube': {
      const L = s.L && s.L > 0 ? s.L : 3000;
      const d = makeHvacPart({ kind: 'duct', std: 'EN', shape: 'round', seam: 'spiral', W: s.D, H: s.D, D: s.D, L, t, ends: 'none', material: s.material });
      d.iProperties.partNumber = `ESP-TUBO-Ø${s.D}-${L}`;
      d.iProperties.description = `Espirotubo Ø${s.D} · L ${L} mm · chapa ${dec(t)} mm · grapa helicoidal paso ${spiralPitch(s.D)} mm (EN 1506 / EN 12237) · extremos lisos (hembra)`;
      d.iProperties.designer = 'Centro de contenido · Espirotubo';
      return d;
    }
    case 'elbow': return makeElbow(s, t);
    case 'tee': case 'tee45': case 'cross': return makeTee(s, t);
    case 'saddle': return makeSaddle(s, t);
    case 'reducer': case 'reducerEcc': return makeReducer(s, t);
    case 'nipple': case 'sleeve': case 'capM': case 'capF': return makeUnion(s, t);
    case 'clamp': return makeClamp(s);
    case 'damper': return makeDamper(s, t);
    case 'roofcap': return makeRoofcap(s, t);
  }
}
