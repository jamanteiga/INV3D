// Centro de contenido: piezas normalizadas generadas como piezas paramétricas INV3D (.i3p).
import { newDoc, type PartDoc, type SkEntity } from './doc';
import { BOLTS } from './catalog';

export interface ContentFamily {
  id: string; name: string; std: string; category: string;
  sizes: string[];
  lengths?: (size: string) => number[];
  make: (size: string, length: number) => PartDoc;
}

const LEN = [6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100, 110, 120, 140, 160, 180, 200];
const XY = (offset = '0') => ({ kind: 'std' as const, name: 'XY' as const, offset });
const XZ = { kind: 'std' as const, name: 'XZ' as const, offset: '0' };
const circle = (id: string, d: number | string): SkEntity => ({ id, type: 'circle', cx: '0', cy: '0', d: String(d) });
const hex = (id: string, s: number | string): SkEntity => ({ id, type: 'npoly', cx: '0', cy: '0', d: `${s} / cos(30)`, n: '6', rot: '30' });

function base(pn: string, desc: string, material = 'Acero S275JR'): PartDoc {
  const d = newDoc();
  d.iProperties = { partNumber: pn, description: desc, designer: 'Centro de contenido', material, revision: '' };
  return d;
}

/** Tornillo de cabeza allen ISO 4762: diámetro de cabeza, altura y llave. */
const ISO4762: Record<string, { dk: number; k: number; s: number }> = {
  M6: { dk: 10, k: 6, s: 5 }, M8: { dk: 13, k: 8, s: 6 }, M10: { dk: 16, k: 10, s: 8 }, M12: { dk: 18, k: 12, s: 10 },
  M16: { dk: 24, k: 16, s: 14 }, M20: { dk: 30, k: 20, s: 17 }, M24: { dk: 36, k: 24, s: 19 }, M27: { dk: 40, k: 27, s: 19 }, M30: { dk: 45, k: 30, s: 22 },
};
/** Rodamientos rígidos de bolas (d, D, B). */
const BEARINGS: Record<string, [number, number, number]> = {
  '6000': [10, 26, 8], '6001': [12, 28, 8], '6002': [15, 32, 9], '6003': [17, 35, 10], '6004': [20, 42, 12], '6005': [25, 47, 12], '6006': [30, 55, 13],
  '6200': [10, 30, 9], '6201': [12, 32, 10], '6202': [15, 35, 11], '6203': [17, 40, 12], '6204': [20, 47, 14], '6205': [25, 52, 15], '6206': [30, 62, 16],
  '6207': [35, 72, 17], '6208': [40, 80, 18],
};

export const CONTENT: ContentFamily[] = [
  {
    id: 'iso4017', name: 'Tornillo de cabeza hexagonal', std: 'ISO 4017', category: 'Tornillería', sizes: Object.keys(BOLTS), lengths: () => LEN.filter((l) => l >= 10),
    make: (m, L) => {
      const b = BOLTS[m]; const d = base(`ISO 4017 - ${m}x${L} - 8.8`, `Tornillo hexagonal ${m}×${L}`);
      d.parameters = [{ name: 'd', expr: `${b.d} mm`, comment: 'Diámetro nominal' }, { name: 'L', expr: `${L} mm`, comment: 'Longitud' }, { name: 's', expr: `${b.s} mm`, comment: 'Entrecaras' }, { name: 'k', expr: `${b.k} mm`, comment: 'Altura de cabeza' }];
      d.features = [
        { id: 's1', name: 'Cabeza', type: 'sketch', plane: XY(), entities: [hex('h', 's')] },
        { id: 'f1', name: 'Extrusión1', type: 'extrude', profile: 's1', distance: 'k', dir: 'normal', op: 'join' },
        { id: 's2', name: 'Caña', type: 'sketch', plane: XY(), entities: [circle('c', 'd')] },
        { id: 'f2', name: 'Extrusión2', type: 'extrude', profile: 's2', distance: 'L', dir: 'reverse', op: 'join' },
        { id: 'f3', name: 'Chaflán1', type: 'chamfer', distance: `${Math.max(0.5, b.p * 0.7)} mm`, edges: { mode: 'picked', points: [[b.d / 2, 0, -L]] } },
        { id: 'f4', name: 'Rosca1', type: 'thread', faces: [[b.d / 2, 0, -L / 2]], designation: `${m}x${b.p}`, length: `${Math.min(L, 2 * b.d + 6)} mm`, full: L <= 2 * b.d + 6 },
      ];
      return d;
    },
  },
  {
    id: 'iso4762', name: 'Tornillo de cabeza cilíndrica allen', std: 'ISO 4762', category: 'Tornillería', sizes: Object.keys(ISO4762), lengths: () => LEN.filter((l) => l >= 8),
    make: (m, L) => {
      const b = BOLTS[m], h = ISO4762[m]; const d = base(`ISO 4762 - ${m}x${L} - 8.8`, `Tornillo allen ${m}×${L}`);
      d.parameters = [{ name: 'd', expr: `${b.d} mm`, comment: '' }, { name: 'L', expr: `${L} mm`, comment: '' }, { name: 'dk', expr: `${h.dk} mm`, comment: 'Ø cabeza' }, { name: 'k', expr: `${h.k} mm`, comment: 'Altura de cabeza' }, { name: 'sw', expr: `${h.s} mm`, comment: 'Llave allen' }];
      d.features = [
        { id: 's1', name: 'Cabeza', type: 'sketch', plane: XY(), entities: [circle('c', 'dk')] },
        { id: 'f1', name: 'Extrusión1', type: 'extrude', profile: 's1', distance: 'k', dir: 'normal', op: 'join' },
        { id: 's2', name: 'Hueco', type: 'sketch', plane: XY('k'), entities: [hex('h', 'sw')] },
        { id: 'f2', name: 'Extrusión2', type: 'extrude', profile: 's2', distance: 'k * 0.6', dir: 'reverse', op: 'cut' },
        { id: 's3', name: 'Caña', type: 'sketch', plane: XY(), entities: [circle('c2', 'd')] },
        { id: 'f3', name: 'Extrusión3', type: 'extrude', profile: 's3', distance: 'L', dir: 'reverse', op: 'join' },
        { id: 'f4', name: 'Rosca1', type: 'thread', faces: [[b.d / 2, 0, -L / 2]], designation: `${m}x${b.p}`, length: `${L} mm`, full: true },
      ];
      return d;
    },
  },
  {
    id: 'iso4032', name: 'Tuerca hexagonal', std: 'ISO 4032', category: 'Tornillería', sizes: Object.keys(BOLTS),
    make: (m) => {
      const b = BOLTS[m]; const d = base(`ISO 4032 - ${m} - 8`, `Tuerca hexagonal ${m}`);
      d.parameters = [{ name: 'd', expr: `${b.d} mm`, comment: '' }, { name: 's', expr: `${b.s} mm`, comment: 'Entrecaras' }, { name: 'm', expr: `${b.m} mm`, comment: 'Altura' }];
      d.features = [
        { id: 's1', name: 'Boceto1', type: 'sketch', plane: XY(), entities: [hex('h', 's'), circle('c', 'd')] },
        { id: 'f1', name: 'Extrusión1', type: 'extrude', profile: 's1', distance: 'm', dir: 'normal', op: 'join' },
        { id: 'f2', name: 'Rosca1', type: 'thread', faces: [[b.d / 2, 0, b.m / 2]], designation: `${m}x${b.p}`, length: `${b.m} mm`, full: true },
      ];
      return d;
    },
  },
  {
    id: 'iso7089', name: 'Arandela plana', std: 'ISO 7089', category: 'Tornillería', sizes: Object.keys(BOLTS),
    make: (m) => {
      const b = BOLTS[m]; const d = base(`ISO 7089 - ${b.d} - 200 HV`, `Arandela ${m}`);
      d.features = [
        { id: 's1', name: 'Boceto1', type: 'sketch', plane: XY(), entities: [circle('c1', b.d2), circle('c2', b.d0 - 0.5)] },
        { id: 'f1', name: 'Extrusión1', type: 'extrude', profile: 's1', distance: `${b.h} mm`, dir: 'normal', op: 'join' },
      ];
      return d;
    },
  },
  {
    id: 'iso2338', name: 'Pasador cilíndrico', std: 'ISO 2338', category: 'Pasadores', sizes: ['3', '4', '5', '6', '8', '10', '12', '16', '20'], lengths: () => LEN,
    make: (ds, L) => {
      const dd = Number(ds); const d = base(`ISO 2338 - ${dd} m6 x ${L}`, `Pasador Ø${dd}×${L}`);
      d.features = [
        { id: 's1', name: 'Boceto1', type: 'sketch', plane: XY(), entities: [circle('c', dd)] },
        { id: 'f1', name: 'Extrusión1', type: 'extrude', profile: 's1', distance: `${L} mm`, dir: 'normal', op: 'join' },
        { id: 'f2', name: 'Chaflán1', type: 'chamfer', distance: `${Math.max(0.3, dd * 0.12).toFixed(2)} mm`, edges: { mode: 'circle', points: [] } },
      ];
      return d;
    },
  },
  {
    id: 'bearing', name: 'Rodamiento rígido de bolas', std: 'ISO 15 (serie 60/62)', category: 'Rodamientos', sizes: Object.keys(BEARINGS),
    make: (code) => {
      const [di, De, B] = BEARINGS[code]; const d = base(`${code}-2Z`, `Rodamiento ${code} (${di}×${De}×${B})`, 'Acero inoxidable AISI 316L');
      const r1 = di / 2, r2 = De / 2, t = (r2 - r1) * 0.28;
      d.parameters = [{ name: 'd', expr: `${di} mm`, comment: 'Ø interior' }, { name: 'D', expr: `${De} mm`, comment: 'Ø exterior' }, { name: 'B', expr: `${B} mm`, comment: 'Anchura' }];
      // Sección: anillo interior + exterior + tapas (2Z), en el plano XZ girado alrededor del eje Z (Y del boceto)
      d.features = [
        { id: 's1', name: 'Sección', type: 'sketch', plane: XZ, entities: [
          { id: 'ri', type: 'rect', x: String(r1), y: String(-B / 2), w: String(t), h: String(B) },
          { id: 're', type: 'rect', x: String(r2 - t), y: String(-B / 2), w: String(t), h: String(B) },
          { id: 'z1', type: 'rect', x: String(r1 + t), y: String(B / 2 - 0.6), w: String(r2 - r1 - 2 * t), h: '0.6' },
          { id: 'z2', type: 'rect', x: String(r1 + t), y: String(-B / 2), w: String(r2 - r1 - 2 * t), h: '0.6' },
        ] },
        { id: 'f1', name: 'Revolución1', type: 'revolve', profile: 's1', axis: 'sy', angle: '360 deg', op: 'join' },
        { id: 'f2', name: 'Empalme1', type: 'fillet', radius: `${Math.min(0.6, B * 0.05).toFixed(2)} mm`, edges: { mode: 'circle', points: [] } },
      ];
      return d;
    },
  },
  {
    id: 'din6885', name: 'Chaveta paralela', std: 'DIN 6885 A', category: 'Transmisión', sizes: ['4x4', '5x5', '6x6', '8x7', '10x8', '12x8', '14x9', '16x10'], lengths: () => LEN.filter((l) => l >= 10),
    make: (bh, L) => {
      const [bb, hh] = bh.split('x').map(Number); const d = base(`DIN 6885 A - ${bb}x${hh}x${L}`, `Chaveta ${bb}×${hh}×${L}`);
      d.features = [
        { id: 's1', name: 'Boceto1', type: 'sketch', plane: XY(), entities: [{ id: 'sl', type: 'slot', x1: String(-(L - bb) / 2), y1: '0', x2: String((L - bb) / 2), y2: '0', w: String(bb) }] },
        { id: 'f1', name: 'Extrusión1', type: 'extrude', profile: 's1', distance: `${hh} mm`, dir: 'normal', op: 'join' },
      ];
      return d;
    },
  },
];
