// Recipiente a presión (EN 13445): virola, fondos toriesféricos o elípticos, tubuladuras con brida y soportes.
// El eje del recipiente es Z; la línea de tangencia inferior está en z = 0.
import { newDoc, type PartDoc, type SkEntity } from './doc';
import { headGeom, type HeadType } from './pressure';
import { EN_OD, EN_S, en1092 } from './pipedata';

export interface Nozzle { name: string; dn: number; pos: 'shell' | 'top' | 'bottom'; z: number; angle: number; proj: number; pn: number }
export interface VesselSpec {
  Di: number; Ltt: number; eShell: number; eHead: number; head: HeadType;
  support: 'legs' | 'saddles' | 'skirt' | 'none';
  nozzles: Nozzle[];
  material: string; name: string; desc: string;
}

const f1 = (x: number) => String(Math.round(x * 1000) / 1000);
let n = 0; const id = (p: string) => `${p}${++n}`;

/** Contorno de un fondo (del ecuador al polo), relativo a la línea de tangencia, con desfase e hacia fuera */
function headPts(type: HeadType, Di: number, e: number, steps = 18): [number, number][] {
  const Ri = Di / 2;
  if (type === 'ellip') {
    const a = Ri + e, b = Di / 4 + e, out: [number, number][] = [];
    for (let i = 0; i <= steps * 2; i++) { const t = (i / (steps * 2)) * Math.PI / 2; out.push([i === steps * 2 ? 0 : a * Math.cos(t), b * Math.sin(t)]); }
    return out;
  }
  const { R, r } = headGeom(type, Di);
  const xk = Ri - r, zc = Math.sqrt((R - r) ** 2 - xk ** 2), th = Math.atan2(zc, xk);
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) { const a = (i / steps) * th; out.push([xk + (r + e) * Math.cos(a), (r + e) * Math.sin(a)]); }
  for (let i = 1; i <= steps; i++) { const g = th + (i / steps) * (Math.PI / 2 - th); out.push([i === steps ? 0 : (R + e) * Math.cos(g), -zc + (R + e) * Math.sin(g)]); }
  return out;
}
export const headHeight = (type: HeadType, Di: number, e: number) => { const p = headPts(type, Di, e); return p[p.length - 1][1]; };

export function makeVessel(s: VesselSpec): PartDoc {
  n = 0;
  const d = newDoc();
  d.iProperties = { partNumber: s.name, description: s.desc, designer: 'Generador · Recipiente EN 13445', material: s.material, revision: '' } as PartDoc['iProperties'];
  const Ri = s.Di / 2, Ro = Ri + s.eShell, L = s.Ltt;
  const top = (e: number) => headPts(s.head, s.Di, e).map(([x, z]) => [x, L + z] as [number, number]);
  const bot = (e: number) => headPts(s.head, s.Di, e).map(([x, z]) => [x, -z] as [number, number]);
  // contorno exterior (polo superior → ecuador → virola → polo inferior) e interior en sentido contrario
  const outer = [...top(s.eHead).reverse(), [Ro, L] as [number, number], [Ro, 0] as [number, number], ...bot(s.eHead)];
  const inner = [...bot(0).reverse(), [Ri, 0] as [number, number], [Ri, L] as [number, number], ...top(0)];
  const poly = (raw: [number, number][]): SkEntity => {
    // sin puntos repetidos (aristas de longitud nula)
    const pts = raw.filter((p, i) => i === 0 || Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]) > 1e-3);
    return { id: id('p'), type: 'poly', pts: pts.map(([x, y]) => [f1(x), f1(y)] as [string, string]) };
  };
  const XZ = { kind: 'std' as const, name: 'XZ' as const, offset: '0' };
  const XY = (o: number) => ({ kind: 'std' as const, name: 'XY' as const, offset: f1(o) });
  const custom = (o: [number, number, number], nrm: [number, number, number], x: [number, number, number]) => ({ kind: 'custom' as const, label: 'Tubuladura', origin: o, normal: nrm, xDir: x });
  const circ = (dd: number, cx = 0, cy = 0): SkEntity => ({ id: id('c'), type: 'circle', cx: f1(cx), cy: f1(cy), d: f1(dd) });
  const F = d.features;
  const sk = (name: string, plane: unknown, ents: SkEntity[]) => { const sid = id('s'); F.push({ id: sid, name, type: 'sketch', plane: plane as never, entities: ents }); return sid; };
  const ext = (name: string, plane: unknown, ents: SkEntity[], dist: number, op: 'join' | 'cut' = 'join') => { const p = sk(name, plane, ents); F.push({ id: id('f'), name, type: 'extrude', profile: p, distance: f1(dist), dir: 'normal', op }); };
  // cuerpo macizo de revolución (contorno exterior) — se vacía al final
  const pOut = sk('Contorno exterior', XZ, [poly(outer)]);
  F.push({ id: id('f'), name: 'Virola y fondos', type: 'revolve', profile: pOut, axis: 'sy', angle: '360 deg', op: 'join' });
  // tubuladuras
  const bores: (() => void)[] = [];
  for (const nz of s.nozzles) {
    const D = EN_OD[nz.dn] ?? nz.dn, t = EN_S[nz.dn] ?? 3, fl = en1092(nz.pn, nz.dn, '11');
    const tf = fl?.tf ?? 20, Df = fl?.D ?? D * 1.8;
    let o: [number, number, number], nrm: [number, number, number], xd: [number, number, number], len: number;
    if (nz.pos === 'shell') {
      const a = (nz.angle * Math.PI) / 180; o = [0, 0, nz.z]; nrm = [Math.cos(a), Math.sin(a), 0]; xd = [-Math.sin(a), Math.cos(a), 0]; len = Ro + nz.proj;
    } else {
      const hh = headHeight(s.head, s.Di, s.eHead), up = nz.pos === 'top';
      o = up ? [0, 0, L] : [0, 0, 0]; nrm = up ? [0, 0, 1] : [0, 0, -1]; xd = [1, 0, 0]; len = hh + nz.proj;
      if (nz.z) o = [nz.z, 0, o[2]]; // desplazamiento radial en el fondo
    }
    ext(`${nz.name} · cuello DN${nz.dn}`, custom(o, nrm, xd), [circ(D)], len - tf);
    ext(`${nz.name} · brida PN${nz.pn}`, custom([o[0] + nrm[0] * (len - tf), o[1] + nrm[1] * (len - tf), o[2] + nrm[2] * (len - tf)], nrm, xd), [circ(Df)], tf);
    const oo = o, nn = nrm, xx = xd, ll = len;
    bores.push(() => ext(`${nz.name} · paso`, custom(oo, nn, xx), [circ(D - 2 * t)], ll + 1, 'cut'));
  }
  // soportes
  const hh = headHeight(s.head, s.Di, s.eHead);
  if (s.support === 'legs') {
    const w = Math.max(80, Math.round(s.Di * 0.1 / 10) * 10), Lg = hh + Math.max(300, s.Di * 0.4);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2, r = Ro + w / 2 - 2;
      ext(`Pata ${k + 1}`, XY(-Lg), [{ id: id('r'), type: 'rect', x: f1(r * Math.cos(a) - w / 2), y: f1(r * Math.sin(a) - w / 2), w: f1(w), h: f1(w) }], Lg + Math.min(s.Ltt * 0.3, 400));
      ext(`Placa base ${k + 1}`, XY(-Lg), [{ id: id('r'), type: 'rect', x: f1(r * Math.cos(a) - w), y: f1(r * Math.sin(a) - w), w: f1(2 * w), h: f1(2 * w) }], 12);
    }
  } else if (s.support === 'skirt') {
    const Hs = hh + Math.max(500, s.Di * 0.5);
    ext('Faldón', XY(-Hs), [circ(2 * Ro), circ(2 * Ro - 2 * Math.max(6, s.eShell))], Hs + 1);
    ext('Anillo base', XY(-Hs), [circ(2 * Ro + 200), circ(2 * Ro - 2 * Math.max(6, s.eShell) - 100)], 20);
  } else if (s.support === 'saddles') {
    // horizontal: el eje Z del recipiente queda horizontal; las cunas apoyan hacia −Y
    const B = 0.8 * 2 * Ro, H = Math.max(150, Ro * 0.25), yc = Math.sqrt(Ro * Ro - (B / 2) ** 2);
    const arc: [number, number][] = []; for (let i = 0; i <= 24; i++) { const t = Math.asin(B / 2 / Ro) * (1 - (2 * i) / 24); arc.push([Ro * Math.sin(t), -Ro * Math.cos(t)]); }
    for (const zf of [0.2, 0.8]) {
      const z0 = s.Ltt * zf;
      ext(`Cuna ${zf < 0.5 ? 1 : 2}`, XY(z0 - 6), [poly([[-B / 2, -Ro - H], [B / 2, -Ro - H], ...arc])], 12);
      ext(`Placa base cuna ${zf < 0.5 ? 1 : 2}`, XY(z0 - 100), [{ id: id('r'), type: 'rect', x: f1(-B / 2 - 20), y: f1(-Ro - H), w: f1(B + 40), h: '15' }], 200);
    }
  }
  // vaciado interior y pasos de tubuladuras
  const pIn = sk('Contorno interior', XZ, [poly(inner)]);
  F.push({ id: id('f'), name: 'Interior', type: 'revolve', profile: pIn, axis: 'sy', angle: '360 deg', op: 'cut' });
  bores.forEach((b) => b());
  return d;
}
