// Geometría de ensamblaje: componentes transformados, barras de estructura, cordones de soldadura y tornillería.
import { Plane, draw, drawCircle, drawRoundedRectangle, makeCylinder, compoundShapes } from 'replicad';
import type { Drawing, Shape3D } from 'replicad';
import { makeEval } from '../core/expr';
import { v3, type V3, type V2 } from '../core/doc';
import { getProfile, profileHalf, BOLTS, boltLength, type ProfileShape } from '../core/catalog';
import { memberFrame, solveJoints, xfInvPoint, xfInvDir, type AsmDoc, type FrameMember, type Xform, type BoltGroup, type Weld } from '../core/asm';

type Ev = (s: string) => number;

function poly(pts: V2[]): Drawing {
  let pen = draw(pts[0]);
  for (let i = 1; i < pts.length; i++) pen = pen.lineTo(pts[i]);
  return pen.close();
}

/** Contorno 2D del perfil, centrado en el origen de su caja (x = ancho, y = canto). */
export function profileDrawing(p: ProfileShape): Drawing {
  switch (p.kind) {
    case 'I': {
      const { h, b, tw, tf, r } = p, H = h / 2, B = b / 2, T = tw / 2;
      return (draw([-B, -H]) as any).lineTo([B, -H]).lineTo([B, -H + tf]).lineTo([T, -H + tf]).customCorner(r)
        .lineTo([T, H - tf]).customCorner(r).lineTo([B, H - tf]).lineTo([B, H]).lineTo([-B, H]).lineTo([-B, H - tf])
        .lineTo([-T, H - tf]).customCorner(r).lineTo([-T, -H + tf]).customCorner(r).lineTo([-B, -H + tf]).close();
    }
    case 'U': {
      const { h, b, tw, tf, r } = p, H = h / 2, B = b / 2;
      // Alma a la izquierda (x = -B), alas hacia +x
      return (draw([-B, -H]) as any).lineTo([B, -H]).lineTo([B, -H + tf]).lineTo([-B + tw, -H + tf]).customCorner(r)
        .lineTo([-B + tw, H - tf]).customCorner(r).lineTo([B, H - tf]).lineTo([B, H]).lineTo([-B, H]).close();
    }
    case 'L': {
      const { a, b, t, r } = p, X = a / 2, Y = b / 2;
      return (draw([-X, -Y]) as any).lineTo([X, -Y]).lineTo([X, -Y + t]).lineTo([-X + t, -Y + t]).customCorner(r)
        .lineTo([-X + t, Y]).lineTo([-X, Y]).close();
    }
    case 'RHS': {
      const ro = Math.min(2 * p.t, Math.min(p.b, p.h) / 2 - 0.1), ri = Math.max(ro - p.t, 0.01);
      return drawRoundedRectangle(p.b, p.h, ro).cut(drawRoundedRectangle(p.b - 2 * p.t, p.h - 2 * p.t, ri));
    }
    case 'CHS': return drawCircle(p.d / 2).cut(drawCircle(p.d / 2 - p.t));
    case 'FLAT': return drawRoundedRectangle(p.b, p.t, 0);
    case 'ROUND': return drawCircle(p.d / 2);
  }
}

function halfSpace(P: V3, m: V3, size: number): Shape3D {
  // Bloque que ocupa el lado +m del plano (P, m)
  let x = v3.cross(m, [0, 0, 1]); if (v3.len(x) < 1e-6) x = v3.cross(m, [1, 0, 0]);
  x = v3.norm(x);
  return (drawRoundedRectangle(size * 2, size * 2, 0).sketchOnPlane(new Plane(P, x, m)) as any).extrude(size);
}

function closestOnLine(a: V3, d: V3, p: V3): V3 { return v3.add(a, v3.mul(d, v3.dot(v3.sub(p, a), d))); }

export interface MemberOut { id: string; shape: Shape3D; length: number; cutAngles: [number, number]; area: number }

export function buildMember(m: FrameMember, all: FrameMember[], ev: Ev): MemberOut {
  const p = getProfile(m.family, m.size);
  const fr = memberFrame(m.a, m.b, ev(m.rot || '0'));
  const [hx, hy] = profileHalf(p);
  const reach = 2 * Math.max(hx, hy);
  const ext = [ev(m.ext[0] || '0'), ev(m.ext[1] || '0')];
  // Extremos con tratamiento: se alarga de más y luego se corta
  const extra = m.ends.map((e, i) => (e.type !== 'none' ? reach * 3 + 20 : ext[i]));
  let prof = profileDrawing(p);
  if (m.mirror) prof = prof.mirror([1, 0], [0, 0], 'plane') as Drawing;
  prof = prof.translate(ev(m.offX || '0'), ev(m.offY || '0'));
  const start = v3.sub(m.a, v3.mul(fr.z, extra[0]));
  const L = fr.len + extra[0] + extra[1];
  if (!(L > 0)) throw new Error('Longitud nula');
  let solid: Shape3D = (prof.sketchOnPlane(new Plane(start, fr.x, fr.z)) as any).extrude(L);
  const angles: [number, number] = [0, 0];
  m.ends.forEach((e, i) => {
    if (e.type === 'none') return;
    const P = i === 0 ? m.a : m.b;
    const awayFromP = i === 0 ? fr.z : v3.mul(fr.z, -1);    // hacia el interior de la barra
    const other = all.find((x) => x.id === e.other);
    const gap = ev(e.gap || '0');
    if (!other) throw new Error('Barra de referencia no encontrada');
    const ofr = memberFrame(other.a, other.b, ev(other.rot || '0'));
    if (e.type === 'miter') {
      const near = (q: V3) => v3.len(v3.sub(q, P)) < 1e-3;
      const oP = near(other.a) ? other.a : near(other.b) ? other.b : null;
      if (!oP) throw new Error('Inglete: las barras no comparten extremo');
      const u2 = near(other.a) ? ofr.z : v3.mul(ofr.z, -1);
      const n = v3.norm(v3.sub(awayFromP, u2));
      const keep = v3.dot(awayFromP, n) > 0 ? n : v3.mul(n, -1);
      solid = solid.cut(halfSpace(v3.add(P, v3.mul(keep, gap / 2)), v3.mul(keep, -1), reach * 10 + fr.len));
      angles[i] = Math.round((Math.acos(Math.min(1, Math.abs(v3.dot(fr.z, keep)))) * 180) / Math.PI * 10) / 10;
    } else {
      // Recortar/alargar hasta la cara del perfil de referencia que mira hacia esta barra
      const shiftO = v3.add(v3.mul(ofr.x, ev(other.offX || '0')), v3.mul(ofr.y, ev(other.offY || '0')));
      const C = closestOnLine(v3.add(other.a, shiftO), ofr.z, P);
      const far = i === 0 ? m.b : m.a;
      const toFar = v3.sub(far, C);
      if (v3.len(v3.sub(toFar, v3.mul(ofr.z, v3.dot(toFar, ofr.z)))) < 1e-6) throw new Error('Recortar: barras paralelas');
      const [ox, oy] = profileHalf(getProfile(other.family, other.size));
      const cands: [V3, number][] = [[ofr.x, ox], [v3.mul(ofr.x, -1), ox], [ofr.y, oy], [v3.mul(ofr.y, -1), oy]];
      const [n0, half] = cands.reduce((best, c) => (v3.dot(c[0], toFar) > v3.dot(best[0], toFar) ? c : best));
      const plane = v3.add(C, v3.mul(n0, half + gap));
      solid = solid.cut(halfSpace(plane, v3.mul(n0, -1), reach * 10 + fr.len + 4 * half));
      angles[i] = Math.round((Math.acos(Math.min(1, Math.abs(v3.dot(fr.z, n0)))) * 180) / Math.PI * 10) / 10;
    }
  });
  return { id: m.id, shape: solid, length: 0, cutAngles: angles, area: 0 };
}

export function weldSolid(w: Weld, ev: Ev): { shape: Shape3D; length: number; area: number } {
  const a = ev(w.throat);
  if (!(a > 0)) throw new Error('Garganta no válida');
  const z = a * Math.SQRT2;
  const axis = v3.sub(w.p1, w.p0), L = v3.len(axis);
  if (L < 1e-6) throw new Error('Cordón de longitud nula');
  const n = v3.norm(axis);
  const proj = (d: V3) => v3.norm(v3.sub(d, v3.mul(n, v3.dot(d, n))));
  const dA = proj(w.dA), dB = proj(w.dB);
  const y = v3.cross(n, dA);
  const bx = v3.dot(dB, dA), by = v3.dot(dB, y);
  const tri = poly([[0, 0], [z, 0], [z * bx, z * by]]);
  const shape = (tri.sketchOnPlane(new Plane(w.p0, dA, n)) as any).extrude(L);
  const area = 0.5 * z * z * Math.abs(by);
  return { shape, length: L, area };
}

/** Posiciones de los tornillos del grupo. */
export function boltPositions(g: BoltGroup, ev: Ev): V3[] {
  const dir = v3.norm(g.dir), u = v3.norm(g.u), v = v3.norm(v3.cross(dir, u));
  const n1 = Math.max(1, Math.round(ev(g.n1))), n2 = Math.max(1, Math.round(ev(g.n2)));
  const p1 = ev(g.p1), p2 = ev(g.p2);
  const out: V3[] = [];
  for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) out.push(v3.add(g.origin, v3.add(v3.mul(u, i * p1), v3.mul(v, j * p2))));
  return out;
}

function hexPrism(center: V3, axis: V3, s: number, h: number): Shape3D {
  const R = s / Math.sqrt(3);
  const pts: V2[] = [];
  for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3 + Math.PI / 6; pts.push([R * Math.cos(a), R * Math.sin(a)]); }
  let x = v3.cross(axis, [0, 0, 1]); if (v3.len(x) < 1e-6) x = v3.cross(axis, [1, 0, 0]);
  return (poly(pts).sketchOnPlane(new Plane(center, v3.norm(x), axis)) as any).extrude(h);
}

export function boltHardware(g: BoltGroup, ev: Ev): { shape: Shape3D; holes: Shape3D[]; length: number; count: number } {
  const b = BOLTS[g.size];
  if (!b) throw new Error('Métrica no válida');
  const grip = ev(g.grip);
  if (!(grip > 0)) throw new Error('Espesor apretado no válido');
  const dir = v3.norm(g.dir);
  const L = boltLength(g.size, grip, g.washers, g.nut);
  const parts: Shape3D[] = [], holes: Shape3D[] = [];
  const pos = boltPositions(g, ev);
  const wh = g.washers > 0 ? b.h : 0;
  for (const Q of pos) {
    const at = (s: number) => v3.add(Q, v3.mul(dir, s));
    // Cabeza y arandela bajo cabeza (lado de inicio)
    parts.push(hexPrism(at(-wh - b.k), dir, b.s, b.k));
    if (wh) parts.push(makeCylinder(b.d2 / 2, wh, at(-wh), dir).cut(makeCylinder(b.d0 / 2, wh + 1, at(-wh - 0.5), dir)));
    parts.push(makeCylinder(b.d / 2, L, at(-wh), dir));
    if (g.nut) {
      const w2 = g.washers > 1 ? b.h : 0;
      if (w2) parts.push(makeCylinder(b.d2 / 2, w2, at(grip), dir).cut(makeCylinder(b.d0 / 2, w2 + 1, at(grip - 0.5), dir)));
      parts.push(hexPrism(at(grip + w2), dir, b.s * 0.999, b.m).cut(makeCylinder(b.d / 2, b.m + 1, at(grip + w2 - 0.5), dir)));
    }
    holes.push(makeCylinder(b.d0 / 2, grip + 2, at(-1), dir));
  }
  const shape = compoundShapes(parts) as unknown as Shape3D;
  return { shape, holes, length: L, count: pos.length };
}

export function xfShape(s: Shape3D, x: Xform): Shape3D {
  const [qx, qy, qz, qw] = x.quat;
  const ang = 2 * Math.acos(Math.max(-1, Math.min(1, qw)));
  let out = s.clone();
  if (ang > 1e-9) {
    const sn = Math.sin(ang / 2);
    out = out.rotate((ang * 180) / Math.PI, [0, 0, 0], [qx / sn, qy / sn, qz / sn]);
  }
  if (v3.len(x.pos) > 0) out = out.translate(x.pos);
  return out;
}

export interface AsmGeometry {
  xf: Record<string, Xform>;
  jointErrors: Record<string, string>;
  members: (MemberOut & { error?: string })[];
  memberErrors: Record<string, string>;
  welds: { id: string; shape: Shape3D; length: number; area: number }[];
  weldErrors: Record<string, string>;
  bolts: { id: string; shape: Shape3D; holes: Shape3D[]; length: number; count: number }[];
  boltErrors: Record<string, string>;
}

export function buildAsmGeometry(asm: AsmDoc): AsmGeometry {
  const ev = makeEval([]);
  const { xf, errors } = solveJoints(asm, ev);
  const out: AsmGeometry = { xf, jointErrors: errors, members: [], memberErrors: {}, welds: [], weldErrors: {}, bolts: [], boltErrors: {} };
  for (const m of asm.frames) {
    if (m.suppressed) continue;
    try { out.members.push(buildMember(m, asm.frames, ev)); } catch (e) { out.memberErrors[m.id] = (e as Error).message || 'Error de geometría'; }
  }
  for (const w of asm.welds) {
    if (w.suppressed) continue;
    try { out.welds.push({ id: w.id, ...weldSolid(w, ev) }); } catch (e) { out.weldErrors[w.id] = (e as Error).message || 'Error de geometría'; }
  }
  for (const g of asm.bolts) {
    if (g.suppressed) continue;
    try { out.bolts.push({ id: g.id, ...boltHardware(g, ev) }); } catch (e) { out.boltErrors[g.id] = (e as Error).message || 'Error de geometría'; }
  }
  return out;
}

/** Taladros de tornillería aplicados a un componente (en coordenadas locales de su pieza). */
export function cutHolesLocal(part: Shape3D, x: Xform, holes: Shape3D[]): Shape3D | null {
  const inv: Xform = { pos: [0, 0, 0], quat: [-x.quat[0], -x.quat[1], -x.quat[2], x.quat[3]] };
  let out: Shape3D | null = null;
  const bb = part.boundingBox.bounds as [V3, V3];
  for (const h of holes) {
    let local = h.clone().translate(v3.mul(x.pos, -1));
    local = xfShape(local, inv);
    const hb = local.boundingBox.bounds as [V3, V3];
    const overlap = [0, 1, 2].every((i) => hb[0][i] <= bb[1][i] + 1e-6 && hb[1][i] >= bb[0][i] - 1e-6);
    if (overlap) out = (out ?? part.clone()).cut(local);
  }
  return out;
}

export { xfInvPoint, xfInvDir };
