// Ejemplo: estructura de escalera con meseta (perfiles EN, ingletes, recortes, placas base y cordones).
import { useStore } from '../core/store';
import { newDoc, uid, type V3 } from '../core/doc';
import { newAsm, type FrameMember, type Weld } from '../core/asm';
import { autoMiter } from './actions';

export function demoStair() {
  const s = useStore.getState();
  // Pieza: placa base 160×160×10 con 4 taladros Ø14
  const plate = newDoc();
  plate.iProperties = { partNumber: 'PB-160-10', description: 'Placa base 160×160×10', designer: '', material: 'Acero S275JR', revision: 'A' };
  plate.parameters = [{ name: 'a', expr: '160 mm', comment: 'Lado' }, { name: 't', expr: '10 mm', comment: 'Espesor' }, { name: 'e', expr: '25 mm', comment: 'Distancia del taladro al borde' }];
  plate.features = [
    { id: 's1', name: 'Boceto1', type: 'sketch', plane: { kind: 'std', name: 'XY', offset: '0' }, entities: [{ id: 'r', type: 'rect', x: '-a/2', y: '-a/2', w: 'a', h: 'a' }] },
    { id: 'f1', name: 'Extrusión1', type: 'extrude', profile: 's1', distance: 't', dir: 'normal', op: 'join' },
    { id: 's2', name: 'Boceto2', type: 'sketch', plane: { kind: 'std', name: 'XY', offset: 't' }, entities: [
      { id: 'p1', type: 'point', cx: 'a/2-e', cy: 'a/2-e' }, { id: 'p2', type: 'point', cx: '-(a/2-e)', cy: 'a/2-e' },
      { id: 'p3', type: 'point', cx: '-(a/2-e)', cy: '-(a/2-e)' }, { id: 'p4', type: 'point', cx: 'a/2-e', cy: '-(a/2-e)' },
    ] },
    { id: 'f2', name: 'Agujero1', type: 'hole', sketch: 's2', dia: '14 mm', depth: '10 mm', through: true, kind: 'simple', cbDia: '22 mm', cbDepth: '5 mm', csDia: '24 mm', csAngle: '90 deg', thread: '' },
    { id: 'f3', name: 'Chaflán1', type: 'chamfer', distance: '2 mm', edges: { mode: 'Z', points: [] } },
  ];
  const pid = s.addDocument('part', plate, 'PB-160-10.i3p', false);

  const asm = newAsm('weldment');
  asm.iProperties = { partNumber: 'ESCALERA-01', description: 'Escalera con meseta', designer: '', material: 'Acero S275JR', revision: 'A' };
  const H = 1100, L = 1000;
  const sk = (a: V3, b: V3) => { const l = { id: uid('k'), a, b }; asm.skeleton.push(l); return l; };
  const meseta = [sk([0, 0, H], [L, 0, H]), sk([L, 0, H], [L, L, H]), sk([L, L, H], [0, L, H]), sk([0, L, H], [0, 0, H])];
  const legs = ([[0, 0], [L, 0], [L, L], [0, L]] as [number, number][]).map(([x, y]) => sk([x, y, 0], [x, y, H]));
  const cross = sk([L / 2, 0, H], [L / 2, L, H]);
  const zancas = [sk([-1700, 150, 0], [0, 150, H]), sk([-1700, 850, 0], [0, 850, H])];
  const mk = (l: { a: V3; b: V3 }, family: string, size: string, name: string, extra: Partial<FrameMember> = {}): FrameMember => ({
    id: uid('m'), name, family, size, material: 'Acero S275JR', a: l.a, b: l.b, rot: '0 deg', offX: '0 mm', offY: '0 mm',
    ends: [{ type: 'none' }, { type: 'none' }], ext: ['0', '0'], ...extra,
  });
  const rim = meseta.map((l, i) => mk(l, 'RHS', '80x40x4', `RHS 80x40x4:${i + 1}`, { offY: '-40 mm' }));
  asm.frames.push(...rim);
  autoMiter(asm.frames, rim.map((m) => m.id));
  const front = rim[3], back = rim[1], left = rim[0];
  const travesano = mk(cross, 'RHS', '80x40x4', 'RHS 80x40x4:5', { offY: '-40 mm' });
  travesano.ends = [{ type: 'trim', other: left.id, gap: '0' }, { type: 'trim', other: rim[2].id, gap: '0' }];
  const pilares = legs.map((l, i) => {
    const m = mk(l, 'SHS', '60x4', `SHS 60x4:${i + 1}`);
    m.ends[1] = { type: 'trim', other: (i === 0 || i === 3 ? front : back).id, gap: '0' };
    m.a = [l.a[0], l.a[1], 10];
    return m;
  });
  const z = zancas.map((l, i) => {
    const m = mk(l, 'UPN', '160', `UPN 160:${i + 1}`, { mirror: i === 1, offY: '-80 mm' });
    m.ends[1] = { type: 'trim', other: front.id, gap: '0' };
    return m;
  });
  asm.frames.push(travesano, ...pilares, ...z);
  // Placas base bajo los pilares
  legs.forEach((l, i) => asm.occurrences.push({ id: uid('o'), name: `PB-160-10:${i + 1}`, part: pid, xf: { pos: [l.a[0], l.a[1], 0], quat: [0, 0, 0, 1] }, grounded: true }));
  // Cordones perimetrales pilar–placa (a = 4 mm)
  const welds: Weld[] = [];
  legs.forEach((l, i) => {
    const [x, y] = [l.a[0], l.a[1]], h = 30, zt = 10;
    const sides: [V3, V3, V3][] = [
      [[x + h, y - h, zt], [x + h, y + h, zt], [1, 0, 0]], [[x - h, y + h, zt], [x - h, y - h, zt], [-1, 0, 0]],
      [[x + h, y + h, zt], [x - h, y + h, zt], [0, 1, 0]], [[x - h, y - h, zt], [x + h, y - h, zt], [0, -1, 0]],
    ];
    sides.forEach(([p0, p1, n], k) => welds.push({ id: uid('w'), name: `Cordón ${i + 1}.${k + 1}`, throat: '4 mm', p0, p1, dA: n, dB: [0, 0, 1], process: '135' }));
  });
  asm.welds.push(...welds);
  s.addDocument('assembly', asm, 'ESCALERA-01.i3a');
  s.notify('Ejemplo: estructura de escalera con perfiles EN, ingletes, recortes, placas base y cordones');
}
