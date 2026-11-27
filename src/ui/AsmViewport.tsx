import HeadsUp from './HeadsUp';
import { updateCog } from './cog';
import ClipBar from './ClipBar';
import MeasurePanel from './MeasurePanel';
import { useRoute, mouthWorld, mouthOf, epFrame, portsOf } from './hvacroute';
import { useMeasure, measureOverlay, measureCompute, measureAdd, measureReset, edgeEnt, faceEnt, vertexEnt, nearestVertex, type MEnt } from './measure';
import { insertPoint, partEPoints, activeEPoints, epRef, epJoint, type EPoint } from '../core/epoints';
import { setJointEPoint } from './jointep';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { useStore, type State } from '../core/store';
import { makeEval } from '../core/expr';
import { docParams, planeFrame, toWorld, entityOutline, consumedSketches, resolveWorkPlanes, v3, MATERIALS, type V3, type PartDoc } from '../core/doc';
import { xfPoint, xfInvPoint, xfInvDir, solveAssembly, ORIGIN_REFS, workPlaneRef, workAxisRef, ASM_REF, type Xform, type AsmDoc, type FaceRef, type JointType } from '../core/asm';
import { asmActions, foranJoint, epOfOcc, epGroup } from './actions';
import { isStraightDuct, distAlong, cutDuct, segmentDuct, setDuctLength, segCfg, unitOf, unitInfo, setUnit, fitUnit, deleteUnit } from './hvacops';
import UnitBar from './UnitBar';
import { STATUS_NAMES, STATUS_COLORS, setStatus } from './asmcalc';
import { calcColor, useAsmCalc, setSystem, addSupports, addInsulation, riteMin } from './asmcalc';
import { normalizeAsm, compose, type FlatOcc } from '../core/subasm';
import { docGetter } from '../core/store';
import type { MeshData } from '../core/cadClient';
import { View3D, css, tv, vArr, planarFaceAt, faceVertices } from './view3d';
import { sizeForHole, flangeOfPart } from '../core/fasteners';

export interface PickedFace { owner: string; ownerKind: 'occ' | 'member'; pointW: V3; normalW: V3; pointL: V3; normalL: V3; vertsW: V3[]; kind: 'plane' | 'axis'; radius?: number; convex?: boolean; centerL?: V3; xdirL?: V3 }

/** Ajuste de cilindro a un grupo de caras de la malla: eje (punto, dirección), radio y extensión axial. */
export function cylinderOf(m: MeshData, group: number) {
  const g = m.faceGroups[group];
  const vs: THREE.Vector3[] = [], ns: THREE.Vector3[] = [];
  for (let i = g.start; i < g.start + g.count; i++) { const vi = m.triangles[i]; vs.push(new THREE.Vector3(m.vertices[vi * 3], m.vertices[vi * 3 + 1], m.vertices[vi * 3 + 2])); ns.push(new THREE.Vector3(m.normals[vi * 3], m.normals[vi * 3 + 1], m.normals[vi * 3 + 2])); }
  let axis: THREE.Vector3 | null = null, best = 0;
  for (let i = 1; i < ns.length; i++) { const c = ns[0].clone().cross(ns[i]); if (c.length() > best) { best = c.length(); axis = c; } if (best > 0.7) break; }
  if (!axis || best < 0.05) return null;
  axis.normalize();
  if (ns.some((n) => Math.abs(n.dot(axis!)) > 0.05)) return null;
  // centro: intersección (mínimos cuadrados) de las rectas normal de cada vértice en el plano perpendicular al eje
  const u = new THREE.Vector3(1, 0, 0); if (Math.abs(u.dot(axis)) > 0.9) u.set(0, 1, 0); u.sub(axis.clone().multiplyScalar(u.dot(axis))).normalize();
  const w = axis.clone().cross(u);
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  vs.forEach((v, i) => {
    const px = v.dot(u), py = v.dot(w), nx = ns[i].dot(u), ny = ns[i].dot(w), nl = Math.hypot(nx, ny) || 1, ux = nx / nl, uy = ny / nl;
    const m11 = 1 - ux * ux, m12 = -ux * uy, m22 = 1 - uy * uy;
    a11 += m11; a12 += m12; a22 += m22; b1 += m11 * px + m12 * py; b2 += m12 * px + m22 * py;
  });
  const det = a11 * a22 - a12 * a12; if (Math.abs(det) < 1e-12) return null;
  const cx = (b1 * a22 - b2 * a12) / det, cy = (a11 * b2 - a12 * b1) / det;
  const center = u.clone().multiplyScalar(cx).add(w.clone().multiplyScalar(cy));
  const r = vs.reduce((acc, v) => acc + Math.hypot(v.dot(u) - cx, v.dot(w) - cy), 0) / vs.length;
  const ts = vs.map((v) => v.dot(axis!));
  // convexo (eje, tornillo) si las normales apuntan hacia fuera del eje; cóncavo (taladro) si hacia dentro
  const v0 = vs[0], radial = new THREE.Vector3(v0.dot(u) - cx, v0.dot(w) - cy, 0), nr = new THREE.Vector3(ns[0].dot(u), ns[0].dot(w), 0);
  return { point: center, axis, radius: r, tmin: Math.min(...ts), tmax: Math.max(...ts), convex: radial.dot(nr) > 0 };
}
export interface CandLine { key: string; a: V3; b: V3; label: string }

/** Líneas candidatas para estructura: esqueleto del ensamblaje + líneas de bocetos de los componentes. */
export function candidateLines(s: State): CandLine[] {
  const out: CandLine[] = s.asm.skeleton.map((l, i) => ({ key: 'sk:' + l.id, a: l.a, b: l.b, label: `Esqueleto ${i + 1}` }));
  const xf = s.asmResult?.xf ?? {};
  for (const o of s.asm.occurrences) {
    if (o.suppressed) continue;
    const doc = s.docData(o.part) as PartDoc | null; if (!doc || doc.format !== 'inv3d.part') continue;
    const ev0 = makeEval(docParams(doc)); const ev = (x: string) => { try { return ev0(x); } catch { return NaN; } };
    const work = resolveWorkPlanes(doc, ev);
    const used = consumedSketches(doc);
    const X = xf[o.id] ?? o.xf;
    for (const f of doc.features) {
      if (f.type !== 'sketch' || f.suppressed || used.has(f.id)) continue;
      let fr; try { fr = planeFrame(f.plane, ev, work); } catch { continue; }
      for (const e of f.entities) {
        if (e.type !== 'line' && e.type !== 'poly' && e.type !== 'rect') continue;
        const o2 = entityOutline(e, ev); const n = o2.pts.length;
        for (let i = 0; i < (o2.closed ? n : n - 1); i++) {
          const a = xfPoint(X, toWorld(fr, o2.pts[i][0], o2.pts[i][1])), b = xfPoint(X, toWorld(fr, o2.pts[(i + 1) % n][0], o2.pts[(i + 1) % n][1]));
          out.push({ key: `${o.id}:${f.id}:${e.id}:${i}`, a, b, label: `${o.name} · ${f.name}` });
        }
      }
    }
  }
  return out;
}

const xfMatrix = (x: Xform, explode: V3 = [0, 0, 0]) =>
  new THREE.Matrix4().compose(tv(v3.add(x.pos, explode)), new THREE.Quaternion(...x.quat), new THREE.Vector3(1, 1, 1));

export default function AsmViewport() {
  const host = useRef<HTMLDivElement>(null);
  const cubeHost = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState('');
  const [axisIn, setAxisIn] = useState<{ x: number; y: number; axis: 'X' | 'Y' | 'Z'; rot?: boolean } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; ref: FaceRef; pW: V3; label: string; ep?: { occ: string; id: string } } | null>(null);

  useEffect(() => {
    const V = new View3D(host.current!, cubeHost.current!);
    V.onFrame = () => { const st = useStore.getState(); V.triad.visible = st.hud.triad; updateCog(V, st, 'asm'); };
    (window as unknown as { __v3d: View3D }).__v3d = V; // ayuda de depuración / pruebas
    const { scene, camera } = V;
    const modelGroup = new THREE.Group(); scene.add(modelGroup);
    const lineGroup = new THREE.Group(); scene.add(lineGroup);
    const overlayGroup = new THREE.Group(); scene.add(overlayGroup);
    // Tríada de «Mover desde el ePoint»: ejes X, Y, Z globales en el ePoint del componente
    const triad = new THREE.Group(); triad.renderOrder = 999; scene.add(triad);
    const buildTriad = (s: State) => {
      V.clearGroup(triad);
      const F = s.tool === 'epMove' && s.epMove ? epOfOcc(s.epMove) : null;
      if (!F) { triad.visible = false; V.request(); return; }
      const L = V.worldPerPx() * 110, r = L * 0.018;
      const ax: ['X' | 'Y' | 'Z', number, THREE.Vector3][] = [['X', 0xe5484d, new THREE.Vector3(1, 0, 0)], ['Y', 0x30a46c, new THREE.Vector3(0, 1, 0)], ['Z', 0x3e63dd, new THREE.Vector3(0, 0, 1)]];
      for (const [name, col, d] of ax) {
        const mat = new THREE.MeshBasicMaterial({ color: col, depthTest: false });
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L * 0.82, 10), mat); shaft.position.copy(d.clone().multiplyScalar(L * 0.41)); shaft.quaternion.copy(q);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(r * 3, L * 0.18, 16), mat); tip.position.copy(d.clone().multiplyScalar(L * 0.91)); tip.quaternion.copy(q);
        const hit = new THREE.Mesh(new THREE.CylinderGeometry(r * 5, r * 5, L, 8), new THREE.MeshBasicMaterial({ visible: false })); hit.position.copy(d.clone().multiplyScalar(L / 2)); hit.quaternion.copy(q);
        for (const m of [shaft, tip, hit]) { m.renderOrder = 999; m.userData = { axis: name }; triad.add(m); }
        // etiqueta
        const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d')!; g.fillStyle = '#' + col.toString(16).padStart(6, '0'); g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, 32, 34);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false })); sp.scale.setScalar(L * 0.22); sp.position.copy(d.clone().multiplyScalar(L * 1.13)); sp.renderOrder = 999; sp.userData = { axis: name }; triad.add(sp);
      }
      // anillos de giro (uno por eje)
      for (const [name, col, d] of ax) {
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(L * 0.62, r * 0.9, 8, 64), new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.75 })); ring.quaternion.copy(q);
        const rhit = new THREE.Mesh(new THREE.TorusGeometry(L * 0.62, r * 4.5, 6, 48), new THREE.MeshBasicMaterial({ visible: false })); rhit.quaternion.copy(q);
        for (const m of [ring, rhit]) { m.renderOrder = 998; m.userData = { axis: name, ring: true }; triad.add(m); }
      }
      const dot = new THREE.Mesh(new THREE.SphereGeometry(r * 3, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb224, depthTest: false })); dot.renderOrder = 999; triad.add(dot);
      triad.position.copy(F.P); triad.visible = true; V.request();
    };
    const triadAxis = (ev: MouseEvent): { axis: 'X' | 'Y' | 'Z'; ring: boolean } | null => {
      if (!triad.visible) return null;
      const hs = V.ray(ev).intersectObjects(triad.children, false).filter((x) => x.object.userData.axis);
      const h = hs.find((x) => !x.object.userData.ring) ?? hs[0]; // las flechas tienen prioridad sobre los anillos
      return h ? { axis: h.object.userData.axis, ring: !!h.object.userData.ring } : null;
    };
    const measureGroup = new THREE.Group(); scene.add(measureGroup);
    const refGroup = new THREE.Group(); scene.add(refGroup);
    let refHover: THREE.Object3D | null = null;
    /** giros temporales (pieza restringida o fija) por componente de primer nivel */
    const tempRot = new Map<string, THREE.Matrix4>();
    /** Planos y ejes de origen del ensamblaje (al restringir) y planos de trabajo: visibles y seleccionables */
    const buildRefs = (s: State) => {
      V.clearGroup(refGroup); refHover = null;
      // planos/ejes de origen solo al restringir o crear planos; al tender / crear componente solo ePoints
      const joint = s.dialog?.kind === 'joint' || s.dialog?.kind === 'asmwp';
      const picking = s.tool === 'asmCreatePick' || s.tool === 'hvacRoute';
      const box = V.viewBox(), size = Math.max(100, box.getSize(new THREE.Vector3()).length() * 0.45);
      const plane = (ref: FaceRef, label: string, color: string) => {
        const n = tv(ref.normal).normalize(), x = tv(ref.xdir ?? [1, 0, 0]).normalize(), y = n.clone().cross(x);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
        m.matrixAutoUpdate = false; m.matrix.makeBasis(x, y, n).setPosition(tv(ref.center ?? ref.point));
        m.userData = { kind: 'ref', ref, label, base: 0.12 }; m.renderOrder = 3;
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 }));
        m.add(e); refGroup.add(m);
      };
      const axis = (ref: FaceRef, label: string, color: string) => {
        const d = tv(ref.normal).normalize();
        const m = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.006, size * 0.006, size * 1.2, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false }));
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); m.position.copy(tv(ref.point));
        m.userData = { kind: 'ref', ref, label, base: 0.55 }; m.renderOrder = 4; refGroup.add(m);
      };
      if (joint) for (const o of ORIGIN_REFS) (o.ref.kind === 'axis' ? axis : plane)(o.ref, `Ensamblaje · ${o.label}`, o.key.includes('X') && o.key.length === 1 ? '#d9480f' : o.key === 'Y' ? '#2b8a3e' : o.key === 'Z' ? '#1c7ed6' : '#e8a33d');
      if (!picking) for (const w of s.asm.workPlanes ?? []) if (!w.hidden || joint) plane(workPlaneRef(w), w.name, '#e8a33d');
      if (!picking) for (const w of s.asm.workAxes ?? []) if (!w.hidden || joint) axis(workAxisRef(w), w.name, '#e8a33d');
      for (const w of s.asm.workPoints ?? []) if (!w.hidden) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(size * 0.012, 12, 8), new THREE.MeshBasicMaterial({ color: '#e8a33d', depthTest: false }));
        m.position.set(...w.origin); m.renderOrder = 5; m.userData = { label: w.name }; refGroup.add(m);
      }
      // ePoints de los componentes (visibles por defecto): se eligen en las restricciones y para conectar
      const occX = (id: string) => s.asmResult?.xf[id] ?? s.asm.occurrences.find((o) => o.id === id)?.xf;
      const rotD = (X: Xform, d: V3) => vArr(new THREE.Vector3(...d).applyQuaternion(new THREE.Quaternion(...X.quat)).normalize(), 6);
      if (s.hud.epoints !== false || joint || picking) for (const o of s.asm.occurrences) {
        if (o.suppressed || (s.placing && o.id === s.placing.occ)) continue;
        const pd = s.docData(o.part) as PartDoc | null; if (!pd || pd.format !== 'inv3d.part') continue;
        const X = occX(o.id); if (!X) continue;
        for (const e of partEPoints(pd)) {
          if (e.inactive || e.hidden || e.kind === 'composite') continue;
          if (s.tool === 'hvacRoute' && !mouthOf(e, pd.iProperties?.designer)) continue; // al tender, solo las bocas de conducto
          if (s.tool === 'asmCreatePick' && e.isDefault && partEPoints(pd).some((x) => !x.isDefault && !x.inactive && !x.hidden)) continue; // el de inserción no tapa las bocas
          let pW = xfPoint(X, e.point), dW = rotD(X, e.dir);
          const tr = tempRot.get(findOcc(s, o.id)?.sub ?? o.id);
          if (tr) { pW = vArr(new THREE.Vector3(...pW).applyMatrix4(tr), 4); dW = vArr(new THREE.Vector3(...dW).transformDirection(tr), 6); }
          const col = s.epConnect?.occ === o.id && s.epConnect.ep === e.id ? '#e03131' : e.isDefault ? '#f08c00' : e.kind === 'insert' ? '#1673d0' : '#2f9a4c';
          const r = size * 0.011;
          const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.95 }));
          m.position.set(...pW); m.renderOrder = 9;
          m.userData = { kind: 'ref', ref: epRef(e, o.id), label: `${o.name} · ePoint ${e.name}`, base: 0.95, ep: { occ: o.id, id: e.id, kind: e.kind, name: e.name, pW, dW } };
          const ar = new THREE.ArrowHelper(new THREE.Vector3(...dW), new THREE.Vector3(0, 0, 0), r * 4.5, col, r * 1.6, r * 1.1);
          ar.traverse((c) => { const mm = (c as THREE.Mesh).material as THREE.Material | undefined; if (mm) { mm.depthTest = false; mm.transparent = true; } c.renderOrder = 9; (c as THREE.Mesh).raycast = () => {}; });
          m.add(ar); refGroup.add(m);
        }
      }
      // origen (planos y ejes) de las piezas elegidas: referencias locales del componente
      if (!picking) for (const id of s.asmOrigins) {
        const o = s.asm.occurrences.find((x) => x.id === id); const X = o && occX(id); if (!o || !X) continue;
        const qq = new THREE.Quaternion(...X.quat), P0 = new THREE.Vector3(...X.pos), sz = size * 0.5;
        const defs: [string, FaceRef, string][] = [
          ['XY', { occ: id, point: [0, 0, 0], normal: [0, 0, 1], kind: 'plane', xdir: [1, 0, 0], center: [0, 0, 0] }, '#1c7ed6'],
          ['XZ', { occ: id, point: [0, 0, 0], normal: [0, 1, 0], kind: 'plane', xdir: [1, 0, 0], center: [0, 0, 0] }, '#2b8a3e'],
          ['YZ', { occ: id, point: [0, 0, 0], normal: [1, 0, 0], kind: 'plane', xdir: [0, 1, 0], center: [0, 0, 0] }, '#d9480f'],
          ['X', { occ: id, point: [0, 0, 0], normal: [1, 0, 0], kind: 'axis', radius: 0, center: [0, 0, 0] }, '#d9480f'],
          ['Y', { occ: id, point: [0, 0, 0], normal: [0, 1, 0], kind: 'axis', radius: 0, center: [0, 0, 0] }, '#2b8a3e'],
          ['Z', { occ: id, point: [0, 0, 0], normal: [0, 0, 1], kind: 'axis', radius: 0, center: [0, 0, 0] }, '#1c7ed6'],
        ];
        for (const [k, ref, color] of defs) {
          const n = new THREE.Vector3(...ref.normal).applyQuaternion(qq);
          if (ref.kind === 'plane') {
            const x = new THREE.Vector3(...ref.xdir!).applyQuaternion(qq), y = n.clone().cross(x);
            const m = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
            m.matrixAutoUpdate = false; m.matrix.makeBasis(x, y, n).setPosition(P0);
            m.userData = { kind: 'ref', ref, label: `${o.name} · plano ${k}`, base: 0.1 }; m.renderOrder = 3;
            m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 })));
            refGroup.add(m);
          } else {
            const m = new THREE.Mesh(new THREE.CylinderGeometry(sz * 0.008, sz * 0.008, sz * 1.15, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false }));
            m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n); m.position.copy(P0);
            m.userData = { kind: 'ref', ref, label: `${o.name} · eje ${k}`, base: 0.6 }; m.renderOrder = 4; refGroup.add(m);
          }
        }
      }
      refGroup.updateMatrixWorld(true);
      V.request();
    };
    const refAt = (ev: MouseEvent) => V.ray(ev).intersectObjects(refGroup.children.filter((c) => c.userData.kind === 'ref'), false)[0];
    const tc = new TransformControls(camera, V.renderer.domElement);
    tc.setSize(0.8);
    const tcHelper = (tc as any).getHelper ? (tc as any).getHelper() : tc;
    scene.add(tcHelper);
    const gizmoProxy = new THREE.Object3D(); scene.add(gizmoProxy);
    tc.addEventListener('dragging-changed', (e: any) => {
      V.controls.enabled = !e.value;
      if (!e.value) {
        const s = useStore.getState(); const id = s.selItem;
        const o = s.asm.occurrences.find((x) => x.id === id);
        if (o) s.commitAsm((a) => { const t = a.occurrences.find((x) => x.id === id)!; t.xf = { pos: vArr(gizmoProxy.position, 4), quat: gizmoProxy.quaternion.toArray() as [number, number, number, number] }; });
        if (o) void asmActions.checkCollision(o.id);
      }
    });
    tc.addEventListener('change', () => {
      const s = useStore.getState();
      const obj = pickables.find((p) => p.userData.id === s.selItem && p.userData.kind === 'occ');
      if (obj && (tc as any).dragging) { obj.parent!.matrix.compose(gizmoProxy.position, gizmoProxy.quaternion, new THREE.Vector3(1, 1, 1)); obj.parent!.matrixWorldNeedsUpdate = true; }
      V.request();
    });

    let pickables: THREE.Mesh[] = [];
    let ghost: { grp: THREE.Group; part: string; box: THREE.Box3 } | null = null;
    let lastCursor: { x: number; y: number } | null = null;
    let ghostXf: Xform | null = null;
    let ghostSnap: { a: EPoint; occ: string; ep: string; label: string } | null = null;
    const snapMark = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), new THREE.MeshBasicMaterial({ color: 0xe03131, depthTest: false, side: THREE.DoubleSide }));
    snapMark.renderOrder = 30; snapMark.visible = false; snapMark.onBeforeRender = () => snapMark.quaternion.copy(camera.quaternion); scene.add(snapMark);
    /** Posición de la copia pendiente bajo el cursor: sobre la cara apuntada (apoyada en ella) o en el plano de la vista por el centro del modelo. */
    const moveGhost = (c: { x: number; y: number }) => {
      const s = useStore.getState(); const p = s.placing; if (!ghost || !p) return;
      if (ghost.box.isEmpty()) return;
      const bb = [ghost.box.min.toArray(), ghost.box.max.toArray()];
      const ev = { clientX: c.x, clientY: c.y } as MouseEvent;
      const q = new THREE.Quaternion(...p.quat);
      const cL = new THREE.Vector3((bb[0][0] + bb[1][0]) / 2, (bb[0][1] + bb[1][1]) / 2, (bb[0][2] + bb[1][2]) / 2);
      const half = new THREE.Vector3((bb[1][0] - bb[0][0]) / 2, (bb[1][1] - bb[0][1]) / 2, (bb[1][2] - bb[0][2]) / 2);
      const hit = hitAt(ev);
      let target: THREE.Vector3;
      if (hit && hit.face) {
        const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
        const nl = n.clone().applyQuaternion(q.clone().invert());
        const ext = Math.abs(nl.x) * half.x + Math.abs(nl.y) * half.y + Math.abs(nl.z) * half.z;
        target = hit.point.clone().addScaledVector(n, ext);
      } else {
        const ray = V.ray(ev).ray;
        const vb = V.hasModel ? V.bbox.getCenter(new THREE.Vector3()) : new THREE.Vector3();
        const dir = camera.getWorldDirection(new THREE.Vector3());
        const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(dir, vb);
        target = ray.intersectPlane(pl, new THREE.Vector3()) ?? vb;
        // en el espacio libre la pieza se coge por su ePoint de inserción
        const pd = s.docData(p.part) as PartDoc | null;
        if (pd?.format === 'inv3d.part') cL.set(...insertPoint(pd));
      }
      let pos = target.clone().sub(cL.clone().applyQuaternion(q));
      // imán: un ePoint de la pieza nueva se pega al ePoint de un componente colocado cercano al cursor
      ghostSnap = null; snapMark.visible = false;
      const pd0 = s.docData(p.part) as PartDoc | null;
      const mine = pd0?.format === 'inv3d.part' ? partEPoints(pd0).filter((e) => !e.inactive && e.kind !== 'composite') : [];
      if (mine.length) {
        const m = V.local(ev); let best: { u: any; d: number } | null = null;
        for (const c of refGroup.children) { const u = c.userData.ep; if (!u) continue; const sp = V.project(u.pW); const d = Math.hypot(sp.x - m.x, sp.y - m.y); if (d < 30 && (!best || d < best.d)) best = { u, d }; }
        if (best) {
          const u = best.u;
          const a = mine.find((e) => e.name === u.name && e.kind === u.kind) ?? mine.find((e) => e.kind === u.kind && !e.isDefault) ?? mine[0];
          const aDir = new THREE.Vector3(...a.dir).applyQuaternion(q), want = new THREE.Vector3(...u.dW).negate();
          const qa = new THREE.Quaternion().setFromUnitVectors(aDir.normalize(), want.normalize()).multiply(q);
          pos = new THREE.Vector3(...u.pW).sub(new THREE.Vector3(...a.point).applyQuaternion(qa));
          ghostSnap = { a, occ: u.occ, ep: u.id, label: `${a.name} → ${u.name}` };
          snapMark.position.set(...(u.pW as V3)); snapMark.scale.setScalar(V.worldPerPx() * 9); snapMark.visible = true;
          ghostXf = { pos: vArr(pos, 3), quat: [qa.x, qa.y, qa.z, qa.w] };
          ghost.grp.matrix.compose(pos, qa, new THREE.Vector3(1, 1, 1)); ghost.grp.matrixWorldNeedsUpdate = true;
          setHint(`Imán: ePoint ${ghostSnap.label} · clic para colocar y conectar`);
          V.request();
          return;
        }
      }
      ghostXf = { pos: vArr(pos, 3), quat: p.quat };
      ghost.grp.matrix.compose(pos, q, new THREE.Vector3(1, 1, 1)); ghost.grp.matrixWorldNeedsUpdate = true;
      V.request();
    };
    /** Vista previa de la restricción en curso: posiciones resueltas sin confirmar. */
    const preview = (s: State) => {
      const d = s.dialog?.kind === 'joint' && 'draft' in s.dialog ? s.dialog.draft : null;
      if (!d?.a || !d?.b || d.a.occ === d.b.occ) return false;
      try {
        const a = structuredClone(s.asm);
        if (d.type === 'sym' && !d.c) return false;
        a.joints.push({ id: '__prev', name: '', type: d.type, a: d.a, b: d.b, c: d.type === 'sym' ? d.c : undefined, offset: d.offset, angle: d.angle, aligned: d.type === 'insert' ? !!d.aligned : undefined, lock: d.lock, min: d.min, max: d.max });
        const evv = (x: string) => { try { return makeEval([])(x); } catch { return NaN; } };
        const r = solveAssembly(normalizeAsm(a, docGetter(s), evv), evv);
        for (const m of pickables) {
          if (m.userData.kind !== 'occ') continue;
          const fo = findOcc(s, m.userData.id);
          const x = fo?.sub && fo.local && r.xf[fo.sub] ? compose(r.xf[fo.sub], fo.local) : r.xf[m.userData.id];
          if (x) { m.parent!.matrix.copy(xfMatrix(x, explodeOf(s, m.userData.id))); m.parent!.matrixWorldNeedsUpdate = true; }
        }
        V.request();
        return true;
      } catch { return false; }
    };
    let cands: CandLine[] = [];
    let hoverKey = '';
    /** Ocurrencias a dibujar (aplanadas si hay subensamblajes) y búsqueda por id (también virtuales «padre/hijo») */
    const occs = (s: State) => (s.asmResult?.view?.occurrences ?? s.asm.occurrences) as FlatOcc[];
    const findOcc = (s: State, id: string): FlatOcc | undefined => occs(s).find((x) => x.id === id) ?? s.asm.occurrences.find((x) => x.id === id);
    const topOf = (s: State, id: string) => findOcc(s, id)?.sub ?? id;
    const meshOf = (kind: string, id: string): MeshData | null => {
      const s = useStore.getState(), r = s.asmResult; if (!r) return null;
      if (kind === 'occ') { const o = findOcc(s, id); return o ? (r.occCut[id]?.mesh ?? r.parts[o.part]?.mesh ?? null) : null; }
      if (kind === 'member') return r.members.find((m) => m.id === id)?.mesh ?? null;
      if (kind === 'weld') return r.welds.find((m) => m.id === id)?.mesh ?? null;
      return r.bolts.find((m) => m.id === id)?.mesh ?? null;
    };
    const explodeOf = (s: State, id: string): V3 => v3.mul(s.asm.explode[(findOcc(s, id)?.sub ?? id)] ?? [0, 0, 0], s.mode === 'present' ? s.explodeT : 0);

    /** Giros temporales de «Rotar» (matriz en mundo que se antepone a la posición resuelta) */
    const build = (s: State) => {
      V.clearGroup(modelGroup);
      pickables = [];
      const r = s.asmResult;
      const box = new THREE.Box3();
      if (r) {
        const add = (kind: string, id: string, m: MeshData | undefined | null, color: string, matrix: THREE.Matrix4 | null) => {
          if (!m || !m.triangles.length) return;
          const sel = (!!s.selItem && (s.selItem === id || (kind === 'occ' && topOf(s, id) === s.selItem))) || (kind === 'occ' && !!s.selGroup?.includes(topOf(s, id)));
          const { grp, mesh } = V.meshFromData(m, color, { edges: s.showEdges, emissive: sel ? css('--accent') : undefined });
          if (matrix) { grp.matrixAutoUpdate = false; grp.matrix.copy(matrix); }
          mesh.userData = { kind, id };
          modelGroup.add(grp);
          grp.updateMatrixWorld(true);
          pickables.push(mesh);
          mesh.geometry.computeBoundingBox();
          box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
        };
        ghost = null; ghostXf = null;
        for (const o of occs(s)) {
          if (o.suppressed || o.hidden) continue;
          const doc = s.docData(o.part) as PartDoc | null;
          const color = calcColor(o.sub ?? o.id) ?? MATERIALS.find((x) => x.name === doc?.iProperties.material)?.color ?? '#c3c8cf';
          const xf = r.xf[o.id] ?? o.xf;
          if (s.placing && s.placing.occ === (o.sub ?? o.id)) {
            // copia pendiente (pieza o todas las piezas del subensamblaje) en un grupo que sigue al cursor
            const m = r.parts[o.part]?.mesh; if (!m) continue;
            if (!ghost) { const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(xfMatrix(r.xf[o.sub ?? o.id] ?? (o.sub ? compose(xf, { pos: [0, 0, 0], quat: [0, 0, 0, 1] }) : xf))); modelGroup.add(g); ghost = { grp: g, part: s.placing.part, box: new THREE.Box3() }; }
            const { grp } = V.meshFromData(m, color, { edges: true, emissive: css('--accent') });
            grp.traverse((x: any) => { if (x.material) { x.material = x.material.clone(); x.material.transparent = true; x.material.opacity = 0.55; x.material.depthWrite = false; } x.renderOrder = 7; });
            grp.matrixAutoUpdate = false; grp.matrix.copy(xfMatrix(o.local ?? { pos: [0, 0, 0], quat: [0, 0, 0, 1] }));
            ghost.grp.add(grp);
            grp.traverse((x: any) => { if (x.isMesh) { x.geometry.computeBoundingBox(); ghost!.box.union(x.geometry.boundingBox.clone().applyMatrix4(grp.matrix)); } });
            continue;
          }
          const tr = tempRot.get(topOf(s, o.id));
          add('occ', o.id, meshOf('occ', o.id), color, tr ? tr.clone().multiply(xfMatrix(xf, explodeOf(s, o.id))) : xfMatrix(xf, explodeOf(s, o.id)));
        }
        for (const m of r.members) {
          const fm = s.asm.frames.find((f) => f.id === m.id);
          const u = s.memberUtil?.[m.id];
          // con resultados de cálculo: color por aprovechamiento (verde → amarillo → rojo)
          const color = u !== undefined ? `hsl(${Math.round(Math.max(0, 120 - Math.min(u, 1.2) * 100))}, 75%, 48%)` : MATERIALS.find((x) => x.name === fm?.material)?.color ?? '#b9bec6';
          const e = explodeOf(s, m.id);
          add('member', m.id, m.mesh, color, e[0] || e[1] || e[2] ? new THREE.Matrix4().makeTranslation(...e) : null);
        }
        for (const w of r.welds) add('weld', w.id, w.mesh, '#c7843a', null);
        for (const it of s.interf ?? []) {
          const { grp } = V.meshFromData(it.mesh, '#e03131', { edges: false, emissive: '#ff0000' });
          grp.traverse((o: any) => { if (o.material) { o.material.depthTest = false; o.material.transparent = true; o.material.opacity = 0.85; } o.renderOrder = 8; });
          modelGroup.add(grp);
        }
        for (const b of r.bolts) add('bolt', b.id, b.mesh, '#7d858f', null);
      }
      if (ghost && lastCursor) moveGhost(lastCursor);
      preview(s);
      V.hasModel = !box.isEmpty();
      if (V.hasModel) V.bbox.copy(box);
      V.applyVisual(s.clip, s.wire, pickables.map((m) => m.parent!).filter(Boolean));
      // Gizmo de movimiento
      tc.detach();
      if (s.tool === 'move' && s.selItem) {
        const o = s.asm.occurrences.find((x) => x.id === s.selItem);
        if (o && !o.grounded) {
          const xf = r?.xf[o.id] ?? o.xf;
          gizmoProxy.position.set(...xf.pos); gizmoProxy.quaternion.set(...xf.quat);
          tc.attach(gizmoProxy);
        }
      }
      buildLines(s);
      V.request();
    };

    const buildLines = (s: State) => {
      V.clearGroup(lineGroup);
      const showCands = s.tool === 'frameLine' || s.tool === 'skelPoint' || s.asm.skeleton.length > 0;
      cands = showCands ? candidateLines(s) : [];
      const d = s.dialog && 'draft' in s.dialog ? s.dialog.draft : null;
      const chosen = new Set<string>(s.dialog?.kind === 'frame' ? (d?.lines ?? []).map((l: any) => l.key) : []);
      const normal: number[] = [], sel: number[] = [], hov: number[] = [];
      for (const c of cands) {
        if (!(s.tool === 'frameLine' || c.key.startsWith('sk:'))) continue;
        (chosen.has(c.key) ? sel : c.key === hoverKey ? hov : normal).push(...c.a, ...c.b);
      }
      if (normal.length) lineGroup.add(V.segs(normal, V.lineMat(css('--sketch'), s.tool === 'frameLine' ? 2 : 1.2, true, s.tool !== 'frameLine')));
      if (hov.length) lineGroup.add(V.segs(hov, V.lineMat(css('--hover'), 3, false, false)));
      if (sel.length) lineGroup.add(V.segs(sel, V.lineMat(css('--accent'), 3, false, false)));
      // Puntos ya elegidos en diálogos
      if (d && s.dialog?.kind === 'skel') for (const p of [d.a, d.b].filter(Boolean)) lineGroup.add(marker(p));
      if (d && s.dialog?.kind === 'joint' && !(d.a && d.b)) for (const p of [d.aW].filter(Boolean)) lineGroup.add(marker(p));
      V.request();
    };
    const marker = (p: V3) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(V.worldPerPx() * 5, 12, 8), new THREE.MeshBasicMaterial({ color: css('--accent'), depthTest: false }));
      m.position.set(...p); m.renderOrder = 9; return m;
    };

    // ---------- Selección ----------
    const hitAt = (ev: MouseEvent) => V.ray(ev).intersectObjects(pickables, false)[0];
    const faceFromHit = (hit: THREE.Intersection): PickedFace | null => {
      const { kind, id } = hit.object.userData as { kind: string; id: string };
      if (kind !== 'occ' && kind !== 'member') return null;
      const m = meshOf(kind, id); if (!m || hit.faceIndex == null) return null;
      const pf = planarFaceAt(m, hit.faceIndex);
      if (!pf) return null;
      const mw = hit.object.matrixWorld;
      const s = useStore.getState();
      const toL = (pW: V3, nWv: V3): [V3, V3] => {
        if (kind !== 'occ') return [pW, nWv];
        const o = findOcc(s, id)!;
        const xf = s.asmResult?.xf[id] ?? o.xf;
        return [vArr(tv(xfInvPoint(xf, pW))), vArr(tv(xfInvDir(xf, nWv)).normalize())];
      };
      const vertsW = faceVertices(m, pf.group).map((v) => vArr(v.clone().applyMatrix4(mw)));
      if (!pf.planar) {
        // cara cilíndrica: eje, con el punto en el extremo más cercano al clic y la dirección hacia fuera por ese extremo
        const cyl = cylinderOf(m, pf.group); if (!cyl) return null;
        const local = hit.point.clone().applyMatrix4(mw.clone().invert());
        const t = local.dot(cyl.axis), end = Math.abs(t - cyl.tmax) < Math.abs(t - cyl.tmin) ? cyl.tmax : cyl.tmin;
        const dir = cyl.axis.clone().multiplyScalar(end === cyl.tmax ? 1 : -1);
        const pAx = cyl.point.clone().sub(cyl.axis.clone().multiplyScalar(cyl.point.dot(cyl.axis))).add(cyl.axis.clone().multiplyScalar(end));
        const pW = vArr(pAx.applyMatrix4(mw)), dW = vArr(dir.transformDirection(mw));
        const [pointL, normalL] = toL(pW, dW);
        const xr = new THREE.Vector3(1, 0, 0); if (Math.abs(xr.dot(cyl.axis)) > 0.9) xr.set(0, 1, 0); xr.sub(cyl.axis.clone().multiplyScalar(xr.dot(cyl.axis))).normalize();
        const [, xdirL] = toL(pW, vArr(xr.clone().transformDirection(mw)));
        return { owner: id, ownerKind: kind as 'occ' | 'member', pointW: pW, normalW: dW, pointL, normalL, vertsW, kind: 'axis', radius: cyl.radius, convex: cyl.convex, centerL: pointL, xdirL };
      }
      const nW = pf.normal.clone().transformDirection(mw);
      const [pointL, normalL] = toL(vArr(hit.point), vArr(nW));
      // centro de la cara (media de vértices) y dirección X: arista más larga de la cara
      const cW: V3 = vertsW.reduce((a, v) => [a[0] + v[0] / vertsW.length, a[1] + v[1] / vertsW.length, a[2] + v[2] / vertsW.length], [0, 0, 0] as V3);
      let xd = new THREE.Vector3(1, 0, 0), best = 0;
      for (let i = 0; i + 1 < Math.min(vertsW.length, 400); i++) { const d = tv(vertsW[i + 1]).sub(tv(vertsW[i])); d.sub(nW.clone().multiplyScalar(d.dot(nW))); if (d.length() > best) { best = d.length(); xd = d.normalize(); } }
      const [centerL, xdirL] = toL(cW, vArr(xd));
      return { owner: id, ownerKind: kind as 'occ' | 'member', pointW: vArr(hit.point), normalW: vArr(nW), pointL, normalL, vertsW, kind: 'plane', centerL, xdirL };
    };
    /** Geometría para restringir bajo el cursor: cara/eje de componente o plano/eje de referencia (el más cercano). */
    const pickRef = (ev: MouseEvent): { ref: FaceRef; pW: V3; label: string; ep?: { occ: string; id: string } } | null => {
      const h = hitAt(ev), r = refAt(ev);
      // los ePoints se dibujan por encima de todo: tienen prioridad
      if (r?.object.userData.ep) { const e = r.object.userData.ep; return { ref: r.object.userData.ref, pW: e.pW, label: r.object.userData.label, ep: { occ: e.occ, id: e.id } }; }
      // las caras de las piezas tienen prioridad sobre los planos de origen (que las atraviesan); los ejes, si están delante
      const rk = r?.object.userData.ref.kind;
      const useRef = r && (!h || (rk === 'axis' && r.distance < h.distance + 1e-6));
      if (useRef) return { ref: r!.object.userData.ref, pW: vArr(r!.point), label: r!.object.userData.label };
      if (!h) return null;
      const f = faceFromHit(h);
      if (!f || f.ownerKind !== 'occ') return null;
      const nm = findOcc(useStore.getState(), f.owner)?.name ?? '';
      return { ref: { occ: f.owner, point: f.pointL, normal: f.normalL, kind: f.kind, radius: f.radius, convex: f.convex, center: f.centerL, xdir: f.xdirL }, pW: f.pointW, label: `${nm} · ${f.kind === 'axis' ? `eje Ø${Math.round((f.radius ?? 0) * 20) / 10}` : 'cara'}` };
    };
    const nearestCand = (ev: MouseEvent): CandLine | null => {
      const P = V.local(ev);
      let best: CandLine | null = null, bd = 8;
      for (const c of cands) {
        const a = V.project(c.a), b = V.project(c.b);
        const A = new THREE.Vector2(a.x, a.y), B = new THREE.Vector2(b.x, b.y);
        const t = Math.max(0, Math.min(1, P.clone().sub(A).dot(B.clone().sub(A)) / Math.max(B.distanceToSquared(A), 1e-9)));
        const d = A.clone().lerp(B, t).distanceTo(P);
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    };
    /** Punto de enganche: vértices de mallas visibles y extremos de líneas candidatas. */
    const snapPoint = (ev: MouseEvent): V3 | null => {
      const P = V.local(ev);
      let best: V3 | null = null, bd = 12;
      const test = (p: V3) => { const q = V.project(p); const d = Math.hypot(q.x - P.x, q.y - P.y); if (d < bd) { bd = d; best = p; } };
      for (const c of candidateLines(useStore.getState())) { test(c.a); test(c.b); }
      // Vértices de aristas de todos los cuerpos visibles
      const v = new THREE.Vector3();
      for (const obj of pickables) {
        const m = meshOf(obj.userData.kind, obj.userData.id); if (!m) continue;
        const mw = obj.matrixWorld, lines = m.lines;
        for (let i = 0; i < lines.length; i += 3) { v.set(lines[i], lines[i + 1], lines[i + 2]).applyMatrix4(mw); test(vArr(v, 4)); }
      }
      if (!best) { const hit = hitAt(ev); if (hit) best = vArr(hit.point, 3); }
      return best;
    };
    /** Espesor apretado: recorrido del rayo por el material contiguo desde la cara de inicio. */
    const gripAlong = (origin: V3, dir: V3): number => {
      const rc = new THREE.Raycaster(tv(origin).addScaledVector(tv(dir), -0.01), tv(dir).normalize(), 0, 5000);
      const hits = rc.intersectObjects(pickables.filter((p) => p.userData.kind === 'occ' || p.userData.kind === 'member'), false).map((h) => h.distance).sort((a, b) => a - b);
      if (hits.length < 2) return 10;
      let end = hits[1];
      for (let i = 2; i + 1 < hits.length; i += 2) { if (hits[i] - end > 0.5) break; end = hits[i + 1]; }
      return Math.round((end - 0.01) * 10) / 10;
    };

    let downAt: { x: number; y: number; button: number } | null = null;
    const cvs = V.renderer.domElement;
    // Rotar: giro libre de una sola pieza alrededor de su centro (trackball con el ratón)
    let rot: { top: string; c: THREE.Vector3; grps: { g: THREE.Object3D; m: THREE.Matrix4 }[]; R0: THREE.Matrix4; x: number; y: number; R: THREE.Matrix4; moved: boolean; roll?: { cx: number; cy: number }; marks?: { o: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion }[] } | null = null;
    host.current!.addEventListener('pointerdown', (ev) => {
      const s = useStore.getState();
      if (!s.asmRotate || ev.button !== 0 || (s.tool && s.tool !== 'move') || s.mode === 'present') return;
      const hit = hitAt(ev);
      if (!hit || hit.object.userData.kind !== 'occ') return;
      const top = topOf(s, hit.object.userData.id);
      const meshes = pickables.filter((m) => m.userData.kind === 'occ' && topOf(s, m.userData.id) === top);
      const bb = new THREE.Box3(); for (const m of meshes) { m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld)); }
      V.controls.enabled = false;
      rot = { top, c: bb.getCenter(new THREE.Vector3()), grps: meshes.map((m) => ({ g: m.parent!, m: m.parent!.matrix.clone() })), R0: tempRot.get(top)?.clone() ?? new THREE.Matrix4(), x: ev.clientX, y: ev.clientY, R: new THREE.Matrix4(), moved: false };
      cvs.style.cursor = 'grabbing';
    }, { capture: true });
    // Giro libre con G (como Inventor): círculo de giro alrededor del componente. Arrastrar dentro del círculo gira
    // libremente; arrastrar fuera gira alrededor del eje de la vista. Se puede arrastrar varias veces; Esc o clic
    // derecho termina. Mientras no se arrastra se puede orbitar la vista con el botón central.
    let free: { top: string; c: THREE.Vector3; r: number; ring: HTMLDivElement; raf: number } | null = null;
    const ringPx = () => {
      if (!free) return null;
      const rect = cvs.getBoundingClientRect(), a = V.project(free.c);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const b = V.project(free.c.clone().addScaledVector(right, free.r));
      return { cx: rect.left + a.x, cy: rect.top + a.y, R: Math.max(30, Math.hypot(b.x - a.x, b.y - a.y)), lx: a.x, ly: a.y };
    };
    const startFreeRot = (s: State, id: string) => {
      const top = topOf(s, id);
      const meshes = pickables.filter((m) => m.userData.kind === 'occ' && topOf(s, m.userData.id) === top);
      if (!meshes.length) { useStore.setState({ freeRot: null }); return; }
      scene.updateMatrixWorld(true);
      const bb = new THREE.Box3(); for (const m of meshes) { m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld)); }
      const sph = bb.getBoundingSphere(new THREE.Sphere());
      const ring = document.createElement('div'); ring.className = 'free-ring';
      for (const q of ['t', 'b', 'l', 'r']) { const h = document.createElement('i'); h.className = 'h-' + q; ring.appendChild(h); }
      host.current!.appendChild(ring);
      free = { top, c: sph.center, r: sph.radius * 0.85, ring, raf: 0 };
      const tick = () => { if (!free) return; const g = ringPx(); if (g) { ring.style.left = `${g.lx - g.R}px`; ring.style.top = `${g.ly - g.R}px`; ring.style.width = ring.style.height = `${2 * g.R}px`; } free.raf = requestAnimationFrame(tick); };
      tick();
      const name = s.asm.occurrences.find((o) => o.id === top)?.name ?? '';
      s.notify(`Giro libre de ${name}: arrastra dentro del círculo para girar libremente, fuera para girar en el plano de la vista · Esc o clic derecho para terminar`);
    };
    const stopFreeRot = () => {
      if (rot) { for (const { g, m } of rot.grps) { g.matrix.copy(m); g.matrixWorldNeedsUpdate = true; } rot = null; }
      if (free) { cancelAnimationFrame(free.raf); free.ring.remove(); free = null; }
      buildRefs(useStore.getState());
      V.controls.enabled = true; cvs.style.cursor = useStore.getState().asmRotate ? 'grab' : 'default'; V.request();
    };
    let freeRotEnded = false;
    host.current!.addEventListener('contextmenu', (ev) => { if (free) { ev.preventDefault(); ev.stopImmediatePropagation(); } }, { capture: true });
    host.current!.addEventListener('pointerdown', (ev) => {
      const s = useStore.getState(); if (!s.freeRot || !free) return;
      if (ev.button === 1) return; // botón central: orbitar la vista
      ev.stopImmediatePropagation(); ev.preventDefault();
      if (ev.button === 2) { freeRotEnded = true; useStore.setState({ freeRot: null }); return; }
      const g = ringPx(); if (!g) return;
      const inside = Math.hypot(ev.clientX - g.cx, ev.clientY - g.cy) <= g.R;
      const meshes = pickables.filter((m) => m.userData.kind === 'occ' && topOf(s, m.userData.id) === free!.top);
      V.controls.enabled = false;
      rot = { top: free.top, c: free.c.clone(), grps: meshes.map((m) => ({ g: m.parent!, m: m.parent!.matrix.clone() })), R0: tempRot.get(free.top)?.clone() ?? new THREE.Matrix4(), x: ev.clientX, y: ev.clientY, R: new THREE.Matrix4(), moved: false, roll: inside ? undefined : { cx: g.cx, cy: g.cy } };
      cvs.style.cursor = 'grabbing';
      freeRotEnded = true;
    }, { capture: true });
    window.addEventListener('pointermove', (ev) => {
      if (!rot) return;
      const dx = ev.clientX - rot.x, dy = ev.clientY - rot.y;
      if (!rot.moved && Math.hypot(dx, dy) <= 4) return;
      rot.moved = true;
      let q: THREE.Quaternion;
      if (rot.roll) {
        // fuera del círculo: giro alrededor del eje de la vista
        const a0 = Math.atan2(rot.y - rot.roll.cy, rot.x - rot.roll.cx), a1 = Math.atan2(ev.clientY - rot.roll.cy, ev.clientX - rot.roll.cx);
        const view = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion).normalize();
        q = new THREE.Quaternion().setFromAxisAngle(view, -(a1 - a0));
      } else {
        // dentro: giro libre (trackball) con los ejes de la pantalla
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize(), right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
        q = new THREE.Quaternion().setFromAxisAngle(up, dx * 0.01).multiply(new THREE.Quaternion().setFromAxisAngle(right, dy * 0.01));
      }
      rot.R = new THREE.Matrix4().makeTranslation(rot.c.x, rot.c.y, rot.c.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q)).multiply(new THREE.Matrix4().makeTranslation(-rot.c.x, -rot.c.y, -rot.c.z));
      for (const { g, m } of rot.grps) { g.matrix.copy(m).premultiply(rot.R); g.matrixWorldNeedsUpdate = true; }
      // los ePoints de la pieza acompañan al giro
      if (!rot.marks) { const st = useStore.getState(); rot.marks = refGroup.children.filter((o) => o.userData.ep && topOf(st, o.userData.ep.occ) === rot!.top).map((o) => ({ o, p: o.position.clone(), q: o.quaternion.clone() })); }
      const qR = new THREE.Quaternion().setFromRotationMatrix(rot.R);
      for (const { o, p, q } of rot.marks) { o.position.copy(p).applyMatrix4(rot.R); o.quaternion.copy(qR).multiply(q); }
      V.request();
    });
    /** Fin del giro: persistente si la pieza está libre (sin restricciones ni fija), temporal si no */
    const endRot = (): boolean => {
      const r = rot; rot = null; if (!r) return false;
      queueMicrotask(() => { buildRefs(useStore.getState()); V.request(); });
      V.controls.enabled = true; cvs.style.cursor = 'grab';
      if (!r.moved) return false;
      const s = useStore.getState();
      const o = s.asm.occurrences.find((x) => x.id === r.top);
      const used = s.asm.joints.some((j) => [j.a, j.b, j.c].some((f) => f && (f.occ === r.top || topOf(s, f.occ) === r.top)));
      if (o && !o.grounded && !used && !o.mirrorOf && !o.patternOf) {
        const xf = s.asmResult?.xf[o.id] ?? o.xf;
        const M = r.R.clone().multiply(xfMatrix(xf));
        const pos = new THREE.Vector3(), quat = new THREE.Quaternion(); M.decompose(pos, quat, new THREE.Vector3());
        tempRot.delete(r.top);
        s.commitAsm((a) => { const t = a.occurrences.find((x) => x.id === r.top); if (t) t.xf = { pos: vArr(pos, 4), quat: quat.toArray() as [number, number, number, number] }; });
      } else {
        tempRot.set(r.top, r.R.clone().multiply(r.R0));
        if (!rotWarned) { rotWarned = true; s.notify('Giro temporal (pieza restringida o fija): se restablece al salir de Rotar'); }
      }
      return true;
    };
    let rotWarned = false;
    // Giro arrastrando un anillo de la tríada (pasos de 5°; Mayús: libre)
    let ringDrag: { axis: THREE.Vector3; name: string; P: THREE.Vector3; c: { x: number; y: number }; a0: number; sign: number; grps: { g: THREE.Object3D; m: THREE.Matrix4 }[]; deg: number } | null = null;
    host.current!.addEventListener('pointerdown', (ev) => {
      const s = useStore.getState();
      if (ev.button !== 0 || s.tool !== 'epMove' || !s.epMove) return;
      const a = triadAxis(ev); if (!a || !a.ring) return;
      const F = epOfOcc(s.epMove); if (!F) return;
      ev.stopPropagation(); V.controls.enabled = false;
      const axis = new THREE.Vector3(...(a.axis === 'X' ? [1, 0, 0] : a.axis === 'Y' ? [0, 1, 0] : [0, 0, 1]) as V3);
      const q = V.project([F.P.x, F.P.y, F.P.z]); const r = cvs.getBoundingClientRect(); const c = { x: r.left + q.x, y: r.top + q.y };
      const ids = new Set(epGroup(s.epMove));
      const grps = pickables.filter((m) => m.userData.kind === 'occ' && ids.has(topOf(s, m.userData.id))).map((m) => ({ g: m.parent!, m: m.parent!.matrix.clone() }));
      ringDrag = { axis, name: a.axis, P: F.P.clone(), c, a0: Math.atan2(ev.clientY - c.y, ev.clientX - c.x), sign: axis.dot(V.camDir()) > 0 ? 1 : -1, grps, deg: 0 };
    }, { capture: true });
    window.addEventListener('pointermove', (ev) => {
      if (!ringDrag) return;
      const d = ringDrag; let a = (Math.atan2(ev.clientY - d.c.y, ev.clientX - d.c.x) - d.a0) * 180 / Math.PI;
      a = ((a + 540) % 360) - 180; a *= d.sign;
      d.deg = ev.shiftKey ? Math.round(a * 10) / 10 : Math.round(a / 5) * 5;
      const M = new THREE.Matrix4().makeTranslation(d.P.x, d.P.y, d.P.z).multiply(new THREE.Matrix4().makeRotationAxis(d.axis, (d.deg * Math.PI) / 180)).multiply(new THREE.Matrix4().makeTranslation(-d.P.x, -d.P.y, -d.P.z));
      for (const { g, m } of d.grps) { g.matrix.copy(m).premultiply(M); g.matrixWorldNeedsUpdate = true; }
      setHint(`Girando sobre ${d.name}: ${d.deg > 0 ? '+' : ''}${d.deg}° (pasos de 5°; Mayús: libre) · suelta para aplicar · Esc cancela`);
      cvs.style.cursor = 'grabbing'; V.request();
    });
    window.addEventListener('pointerup', () => {
      const d = ringDrag; if (!d) return; ringDrag = null; V.controls.enabled = true; cvs.style.cursor = 'default'; setHint('');
      for (const { g, m } of d.grps) { g.matrix.copy(m); g.matrixWorldNeedsUpdate = true; } V.request();
      const s = useStore.getState(); if (d.deg && s.epMove) asmActions.epRotateAxis(s.epMove, [d.axis.x, d.axis.y, d.axis.z], d.deg);
    }, true);
    window.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape' || !ringDrag) return;
      const d = ringDrag; ringDrag = null; V.controls.enabled = true; setHint(''); ev.stopPropagation();
      for (const { g, m } of d.grps) { g.matrix.copy(m); g.matrixWorldNeedsUpdate = true; } V.request();
    }, true);
    // Arrastre libre: clic izquierdo mantenido sobre un componente no fijo lo mueve en el plano de la vista;
    // al soltar se vuelven a resolver las restricciones (se mueve solo en sus grados de libertad libres).
    let drag: { id: string; grp: THREE.Object3D; grps: { g: THREE.Object3D; m: THREE.Matrix4 }[]; plane: THREE.Plane; start: THREE.Vector3; xf: Xform; moved: boolean } | null = null;
    host.current!.addEventListener('pointerdown', (ev) => {
      const s = useStore.getState();
      if (ev.button !== 0 || s.tool || s.mode === 'present' || V.picking || s.asmRotate) return;
      const hit = hitAt(ev);
      if (!hit || hit.object.userData.kind !== 'occ') return;
      const top = topOf(s, hit.object.userData.id);
      const o = s.asm.occurrences.find((x) => x.id === top);
      if (!o || o.grounded || o.mirrorOf || o.patternOf) return;
      // totalmente restringido (0 GDL): no se arrastra (se mueve con clic derecho › Girar / Mover desde el ePoint)
      if ((s.asmDof?.[top] ?? 6) === 0) return;
      // solo se arrastra el componente ya seleccionado: así el arrastre sobre una pieza libre sigue girando la vista
      if (s.selItem !== top) return;
      V.controls.enabled = false;
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const grps = pickables.filter((m) => m.userData.kind === 'occ' && topOf(s, m.userData.id) === top).map((m) => ({ g: m.parent!, m: m.parent!.matrix.clone() }));
      drag = { id: o.id, grp: hit.object.parent!, grps, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(dir, hit.point), start: hit.point.clone(), xf: s.asmResult?.xf[o.id] ?? o.xf, moved: false };
    }, { capture: true });
    window.addEventListener('pointermove', (ev) => {
      if (!drag || !downAt) return;
      if (!drag.moved && Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) <= 4) return;
      drag.moved = true;
      const p = V.ray(ev).ray.intersectPlane(drag.plane, new THREE.Vector3()); if (!p) return;
      const d = p.sub(drag.start);
      const T = new THREE.Matrix4().makeTranslation(d.x, d.y, d.z);
      for (const { g, m } of drag.grps) { g.matrix.copy(m).premultiply(T); g.matrixWorldNeedsUpdate = true; }
      cvs.style.cursor = 'move';
      V.request();
    });
    const endDrag = (ev: PointerEvent) => {
      const dd = drag; drag = null; V.controls.enabled = true;
      if (!dd || !dd.moved) return false;
      cvs.style.cursor = 'default';
      const p = V.ray(ev).ray.intersectPlane(dd.plane, new THREE.Vector3());
      const d = p ? p.sub(dd.start) : new THREE.Vector3();
      useStore.getState().commitAsm((a) => { const t = a.occurrences.find((x) => x.id === dd.id); if (t) t.xf = { pos: vArr(tv(dd.xf.pos).add(d), 4), quat: [...dd.xf.quat] }; });
      void asmActions.checkCollision(dd.id);
      return true;
    };
    cvs.addEventListener('pointerdown', (ev) => { downAt = { x: ev.clientX, y: ev.clientY, button: ev.button }; });
    cvs.addEventListener('pointerup', (ev) => {
      if (freeRotEnded) {
        freeRotEnded = false; downAt = null; ev.stopImmediatePropagation();
        if (rot) { endRot(); if (free) { V.controls.enabled = true; cvs.style.cursor = 'crosshair'; } }
        return;
      }
      if (endRot()) { downAt = null; ev.stopImmediatePropagation(); return; }
      if (endDrag(ev)) { downAt = null; return; }
      if (V.picking) { downAt = null; return; }
      const small = !!downAt && Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) <= 4;
      if (small && ev.button === 2 && useStore.getState().tool === 'place') { downAt = null; asmActions.finishPlace(); return; }
      if (small && ev.button === 2 && useStore.getState().tool === 'epMove') { downAt = null; useStore.getState().setTool(null); return; }
      if (small && ev.button === 2 && !useStore.getState().tool) {
        downAt = null;
        const pk = pickRef(ev);
        if (pk) { const st = useStore.getState(); useStore.setState({ selItem: pk.ref.occ === ASM_REF ? null : topOf(st, pk.ref.occ) }); setCtx({ x: ev.clientX, y: ev.clientY, ref: pk.ref, pW: pk.pW, label: pk.label, ep: pk.ep }); }
        else setCtx(null);
        return;
      }
      if (!downAt || !small || ev.button !== 0 || (tc as any).dragging) { downAt = null; return; }
      downAt = null;
      const s = useStore.getState();
      if (s.unitPick) {
        const pk = pickRef(ev); const id = pk && pk.ref.occ !== ASM_REF ? topOf(s, pk.ref.occ) : null;
        if (id) { const cur = s.selGroup ?? []; useStore.setState({ selGroup: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id], selItem: null }); }
        return;
      }
      if (s.tool === 'measure') {
        const mode = useMeasure.getState().mode, hit = hitAt(ev), camDir = V.camDir(), lim = hit ? hit.point.dot(camDir) + V.worldPerPx() * 6 : Infinity;
        let e: MEnt | null = null;
        const objs = pickables.filter((o) => o.visible !== false);
        const nameOf = (o: THREE.Object3D) => (o.userData.kind === 'occ' ? findOcc(s, o.userData.id)?.name : undefined) ?? o.userData.kind;
        if (mode === 'auto' || mode === 'vertex') {
          let best: { p: THREE.Vector3; d: number; o: THREE.Object3D } | null = null; const P = V.local(ev);
          for (const o of objs) { const m = meshOf(o.userData.kind, o.userData.id); if (!m) continue; const p = nearestVertex(P, m.lines, o.matrixWorld, (q) => V.project(q), 9, (q) => q.dot(camDir) <= lim); if (p) { const q = V.project(p), d = Math.hypot(q.x - P.x, q.y - P.y); if (!best || d < best.d) best = { p, d, o }; } }
          if (best) e = vertexEnt(best.p, nameOf(best.o));
        }
        if (!e && (mode === 'auto' || mode === 'edge')) {
          const occl = objs as THREE.Object3D[];
          let best: { o: THREE.Object3D; g: number; m: NonNullable<ReturnType<typeof meshOf>> } | null = null;
          for (const o of objs) { const m = meshOf(o.userData.kind, o.userData.id); if (!m) continue; const eh = V.nearestEdge(ev, m, o.matrixWorld, occl, 7); if (eh) { best = { o, g: eh.group, m }; break; } }
          if (best) e = edgeEnt(best.m, best.g, best.o.matrixWorld, nameOf(best.o));
        }
        if (!e && (mode === 'auto' || mode === 'face' || mode === 'loop') && hit && hit.faceIndex != null) { const m = meshOf(hit.object.userData.kind, hit.object.userData.id); if (m) e = faceEnt(m, hit.faceIndex, hit.object.matrixWorld, nameOf(hit.object)); }
        if (!e) { measureReset(); return; }
        if (mode === 'loop') useMeasure.setState({ sel: [e] }); else measureAdd(e);
        return;
      }
      if (s.tool === 'place') {
        lastCursor = { x: ev.clientX, y: ev.clientY }; moveGhost(lastCursor);
        if (ghost && ghostXf) { asmActions.dropPlace(ghostXf, ghostSnap ? { a: ghostSnap.a.id, occ: ghostSnap.occ, ep: ghostSnap.ep } : undefined); ghostSnap = null; snapMark.visible = false; }
        else s.notify('Calculando la pieza… suéltala cuando aparezca bajo el cursor');
        return;
      }
      const dlg = s.dialog && 'draft' in s.dialog ? s.dialog : null;
      const d = dlg?.draft;
      if (s.tool === 'frameLine' && dlg?.kind === 'frame') {
        const c = nearestCand(ev); if (!c) return;
        const lines = (d.lines ?? []) as CandLine[];
        const has = lines.some((l) => l.key === c.key);
        s.updateDraft({ lines: has ? lines.filter((l) => l.key !== c.key) : [...lines, c] });
        return;
      }
      if (s.tool === 'skelPoint' && dlg?.kind === 'skel') {
        const p = snapPoint(ev); if (!p) return;
        if ((dlg.step ?? 0) === 0) useStore.setState({ dialog: { ...dlg, draft: { ...d, a: p }, step: 1 } });
        else useStore.setState({ dialog: { ...dlg, draft: { ...d, b: p }, step: 0 } });
        return;
      }
      if (s.tool === 'pickMember' && dlg?.kind === 'endtreat') {
        const hit = hitAt(ev);
        if (!hit || hit.object.userData.kind !== 'member') { s.notify('Selecciona una barra de estructura', 'error'); return; }
        const id = hit.object.userData.id as string;
        if (!d.member || (d.member && d.target)) s.updateDraft({ member: id, target: '' });
        else if (id !== d.member) s.updateDraft({ target: id });
        useStore.setState({ selItem: id });
        return;
      }
      if (s.tool === 'asmFace' && dlg?.kind === 'joint' && d?.epMode) {
        const r = refAt(ev); const ep = r?.object.userData.ep as { occ: string; id: string } | undefined;
        if (ep) setJointEPoint(ep.occ, ep.id); else s.notify('Haz clic en un ePoint (o elígelo en la lista del diálogo)', 'error');
        return;
      }
      if (s.tool === 'asmFace' && (dlg?.kind === 'joint' || dlg?.kind === 'asmwp')) {
        const pk = pickRef(ev);
        if (!pk) { s.notify('Selecciona una cara o eje de un componente, o un plano/eje de origen', 'error'); return; }
        if (dlg.kind === 'asmwp') {
          if (pk.ref.kind === 'axis') { s.notify('Elige una cara plana o un plano', 'error'); return; }
          const X = pk.ref.occ === ASM_REF ? { pos: [0, 0, 0] as V3, quat: [0, 0, 0, 1] as [number, number, number, number] } : (s.asmResult?.xf[pk.ref.occ] ?? findOcc(s, pk.ref.occ)!.xf);
          s.updateDraft({ base: 'face', face: { origin: xfPoint(X, pk.ref.center ?? pk.ref.point), normal: v3.norm(vArr(tv(xfPoint(X, pk.ref.normal)).sub(tv(xfPoint(X, [0, 0, 0]))))), xdir: v3.norm(vArr(tv(xfPoint(X, pk.ref.xdir ?? [1, 0, 0])).sub(tv(xfPoint(X, [0, 0, 0]))))) }, faceLabel: pk.label });
          return;
        }
        const ref = pk.ref, step = dlg.step ?? 0;
        // pieza seleccionada antes de R: la primera geometría es de esa pieza
        const pre = (d as { pre?: string }).pre;
        if (step === 0 && pre && ref.occ !== pre && topOf(s, ref.occ) !== pre) { s.notify(`Primera geometría: una cara, eje o ePoint de ${findOcc(s, pre)?.name ?? 'la pieza seleccionada'}`, 'error'); return; }
        if (step === 0) useStore.setState({ dialog: { ...dlg, draft: { ...d, a: ref, aW: pk.pW, aL: pk.label }, step: 1 } });
        else if (step === 1) useStore.setState({ dialog: { ...dlg, draft: { ...d, b: ref, bW: pk.pW, bL: pk.label, aligned: d.a?.kind === 'axis' && ref.kind === 'axis' ? d.a.convex !== ref.convex : d.aligned }, step: d.type === 'sym' ? 2 : 0 } });
        else {
          if (ref.kind === 'axis') { s.notify('El plano de simetría debe ser una cara plana o un plano', 'error'); return; }
          useStore.setState({ dialog: { ...dlg, draft: { ...d, c: ref, cL: pk.label }, step: 0 } });
        }
        return;
      }
      if (s.tool === 'fastHole' && s.dialog?.kind === 'fastener') {
        const fdl = s.dialog;
        const hit = hitAt(ev); if (!hit) return;
        const f = faceFromHit(hit);
        if (!f || f.kind !== 'axis' || f.convex || hit.object.userData.kind !== 'occ') { s.notify('Haz clic en la pared de un taladro, cerca del lado donde va la cabeza o la primera tuerca', 'error'); return; }
        const occId = hit.object.userData.id as string;
        const m = meshOf('occ', occId)!, mw = hit.object.matrixWorld;
        const d0 = tv(f.normalW).normalize(), p0 = tv(f.pointW), r = f.radius ?? 5;
        const found: { p: THREE.Vector3; d: THREE.Vector3 }[] = [{ p: p0, d: d0 }];
        if ((fdl.fx as { all?: boolean }).all !== false) {
          for (let g = 0; g < m.faceGroups.length; g++) {
            const c = cylinderOf(m, g); if (!c || c.convex || Math.abs(c.radius - r) > 0.05) continue;
            const ax = c.axis.clone().transformDirection(mw); if (Math.abs(ax.dot(d0)) < 0.999) continue;
            const base = c.point.clone().sub(c.axis.clone().multiplyScalar(c.point.dot(c.axis)));
            const ends = [c.tmin, c.tmax].map((t) => base.clone().add(c.axis.clone().multiplyScalar(t)).applyMatrix4(mw));
            const e = ends.find((q) => Math.abs(q.clone().sub(p0).dot(d0)) < 0.5); if (!e) continue;
            if (found.some((x) => x.p.distanceTo(e) < 0.5)) continue;
            found.push({ p: e, d: d0.clone() });
          }
        }
        // espesor a abarcar por fuera del taladro (paralelo al eje), sumando huecos de hasta 10 mm (junta)
        const occl = pickables.filter((q) => q.userData.kind === 'occ' || q.userData.kind === 'member');
        const holes = found.map(({ p, d }) => {
          const xr = new THREE.Vector3(1, 0, 0); if (Math.abs(xr.dot(d)) > 0.9) xr.set(0, 1, 0); xr.sub(d.clone().multiplyScalar(xr.dot(d))).normalize();
          const o = p.clone().addScaledVector(xr, r + 0.8).addScaledVector(d, 2);
          const hs = new THREE.Raycaster(o, d.clone().negate(), 0, 5000).intersectObjects(occl, false).map((h) => h.distance).sort((a, b) => a - b);
          let grip = 0, gap = 0, start = p.clone();
          if (hs.length >= 2) {
            let end = hs[1];
            for (let i = 2; i + 1 < hs.length; i += 2) { if (hs[i] - end > 10) break; gap += hs[i] - end; end = hs[i + 1]; }
            grip = Math.round((end - hs[0]) * 10) / 10;
            start = p.clone().addScaledVector(d, 2 - hs[0]);
          }
          // referencia del taladro en coordenadas de la pieza (para restringir la fijación al agujero)
          const inv = mw.clone().invert();
          return { p: vArr(start, 4), d: vArr(d, 6), grip, gap: Math.round(gap * 10) / 10, occ: occId, pL: vArr(start.clone().applyMatrix4(inv), 4), dL: vArr(d.clone().transformDirection(inv), 6), r: Math.round(r * 1000) / 1000 };
        });
        // ¿es una brida? → norma, métrica de pernos, montaje y junta
        const occ = s.asm.occurrences.find((o) => o.id === occId);
        const pdoc = occ ? s.docData(occ.part) as PartDoc | null : null;
        const fl = pdoc?.format === 'inv3d.part' ? flangeOfPart(pdoc) : null;
        const fx = fdl.fx as { std?: 'EN' | 'ASME' };
        const std = fl?.std ?? fx.std ?? 'EN';
        const size = fl?.size ?? sizeForHole(std, 2 * r);
        // sin junta modelada: el hueco entre platos es solo el de las caras realzadas (2·rfH)
        const noGap = holes[0].gap - (fl ? 2 * fl.rfH : 0) < 1;
        const patch = fl
          ? { std, size, kind: fl.kind, flange: fl.label, gasket: noGap, gasketT: String(fl.gasketT), gasketName: fl.gasketName }
          : { std, ...(size ? { size } : {}), flange: '' };
        useStore.setState({ tool: null, dialog: { ...fdl, fx: { ...fdl.fx, ...patch, holes, grip: String(holes[0].grip) } } });
        s.notify(fl ? `Brida ${fl.label} · ${holes.length} taladro(s) · espesor ${holes[0].grip} mm${noGap ? ` + junta ${fl.gasketT} mm` : ` (incluye ${holes[0].gap} mm de junta/hueco)`}`
          : `${holes.length} taladro(s) Ø${Math.round(2 * r * 10) / 10} · espesor a abarcar ${holes[0].grip} mm${size ? ` · ${size}` : ''}`);
        return;
      }
      if (s.tool === 'hvacRoute') {
        const r = refAt(ev); const ep = r?.object.userData.ep as { occ: string; id: string } | undefined;
        if (ep) { useRoute.setState({ active: { occ: ep.occ, ep: ep.id } }); const A = mouthWorld({ occ: ep.occ, ep: ep.id }); if (!A) s.notify('Ese ePoint no es una boca de conducto', 'error'); }
        else s.notify('Haz clic en una boca libre (ePoint) de un conducto o accesorio', 'error');
        return;
      }
      if (s.tool === 'asmCreatePick') {
        const r = refAt(ev); const ep = r?.object.userData.ep as { occ: string; id: string; kind: string; pW: V3; dW: V3 } | undefined;
        let T: NonNullable<State['createTarget']> | null = null;
        if (ep) T = { occ: ep.occ, ref: r!.object.userData.ref, ep: ep.id, epKind: ep.kind, label: r!.object.userData.label, pW: ep.pW, nW: ep.dW };
        // Tender hasta: boca de destino
        if (s.routePick && ep) { const rp = s.routePick; useStore.setState({ routePick: null, tool: null }); void import('./routeto').then((m) => m.routeTo(rp.occ, rp.ep, { to: { occ: ep.occ, ep: ep.id } })); return; }
        // Foran · Cambiar boca: el destino es un ePoint (o la boca más cercana al clic)
        if (s.reattach) {
          let to = ep ? { occ: ep.occ, id: ep.id } : null;
          if (!to) {
            const hit = hitAt(ev); const f = hit ? faceFromHit(hit) : null;
            const oc = f && f.ownerKind === 'occ' ? s.asm.occurrences.find((o) => o.id === f.owner) : undefined;
            const pdo = oc ? (s.docData(oc.part) as PartDoc | null) : null;
            if (oc && pdo && f) { let bd = Infinity; for (const e of portsOf(pdo)) { const Fr = epFrame(oc.id, e.id); if (!Fr) continue; const dd = Fr.P.distanceTo(new THREE.Vector3(...f.pointW)); if (dd < bd) { bd = dd; to = { occ: oc.id, id: e.id }; } } }
          }
          if (!to) { s.notify('Haz clic en una boca (ePoint) de otro componente', 'error'); return; }
          asmActions.foranReattachTo(s.reattach, to.occ, to.id);
          return;
        }
        else if (ep) { /* sigue abajo */ }
        else {
          const hit = hitAt(ev); const f = hit ? faceFromHit(hit) : null;
          if (!f || f.ownerKind !== 'occ') { s.notify('Elige un ePoint o una cara plana o cilíndrica de un componente', 'error'); return; }
          const nm = findOcc(s, f.owner)?.name ?? '';
          // clic sobre la pieza cerca de una boca libre: se toma esa boca (ePoint)
          const oc = s.asm.occurrences.find((o) => o.id === f.owner);
          const pdo = oc ? (s.docData(oc.part) as PartDoc | null) : null;
          if (oc && pdo) {
            let bestE: { id: string; d: number } | null = null;
            for (const e of portsOf(pdo)) { const Fr = epFrame(oc.id, e.id); if (!Fr) continue; const rr = Fr.m ? (Fr.m.shape === 'round' ? Fr.m.D / 2 : Math.max(Fr.m.W, Fr.m.H) / 2) : (e.radius ?? 50); const dd = Fr.P.distanceTo(new THREE.Vector3(...f.pointW)); if (dd < rr * 1.3 && (!bestE || dd < bestE.d)) bestE = { id: e.id, d: dd }; }
            if (bestE) { const Fr = epFrame(oc.id, bestE.id)!; T = { occ: oc.id, ref: epRef(Fr.e, oc.id), ep: bestE.id, epKind: Fr.e.kind, label: Fr.name, pW: [Fr.P.x, Fr.P.y, Fr.P.z], nW: [Fr.D.x, Fr.D.y, Fr.D.z] }; useStore.setState({ createTarget: T, tool: null, dialog: { kind: 'createcomp' } }); return; }
          }
          T = { occ: f.owner, ref: { occ: f.owner, point: f.pointL, normal: f.normalL, kind: f.kind, radius: f.radius, convex: f.convex, center: f.centerL, xdir: f.xdirL }, label: `${nm} · cara ${f.kind === 'axis' ? 'cilíndrica' : 'plana'}`, pW: f.pointW, nW: f.normalW };
        }
        useStore.setState({ createTarget: T, tool: null, dialog: { kind: 'createcomp' } });
        return;
      }
      if (s.tool === 'asmFace' || s.tool === 'weldFace' || s.tool === 'boltFace') {
        const hit = hitAt(ev); if (!hit) return;
        const f = faceFromHit(hit);
        if (!f || (f.kind === 'axis' && s.tool !== 'asmFace')) { s.notify(s.tool === 'asmFace' ? 'Selecciona una cara plana o cilíndrica' : 'Selecciona una cara plana', 'error'); return; }
        if (s.tool === 'asmFace' && dlg?.kind === 'joint') {
          if (f.ownerKind !== 'occ') { s.notify('Las uniones se hacen entre componentes', 'error'); return; }
          const ref = { occ: f.owner, point: f.pointL, normal: f.normalL, kind: f.kind, radius: f.radius, convex: f.convex, center: f.centerL, xdir: f.xdirL };
          if ((dlg.step ?? 0) === 0) useStore.setState({ dialog: { ...dlg, draft: { ...d, a: ref, aW: f.pointW }, step: 1 } });
          else useStore.setState({ dialog: { ...dlg, draft: { ...d, b: ref, bW: f.pointW, aligned: d.a?.kind === 'axis' && ref.kind === 'axis' ? d.a.convex !== ref.convex : d.aligned }, step: 0 } });
        } else if (s.tool === 'weldFace' && dlg?.kind === 'weld') {
          if ((dlg.step ?? 0) === 0) useStore.setState({ dialog: { ...dlg, draft: { ...d, fA: f }, step: 1 } });
          else useStore.setState({ dialog: { ...dlg, draft: { ...d, fB: f }, step: 0 } });
        } else if (s.tool === 'boltFace' && dlg?.kind === 'bolt') {
          const dir = v3.mul(f.normalW, -1);
          let u = v3.sub([1, 0, 0], v3.mul(dir, v3.dot([1, 0, 0], dir)));
          if (v3.len(u) < 0.3) u = v3.sub([0, 1, 0], v3.mul(dir, v3.dot([0, 1, 0], dir)));
          const grip = gripAlong(f.pointW, dir);
          s.updateDraft({ origin: vArr(tv(f.pointW), 3), dir: vArr(tv(dir)), u: vArr(tv(v3.norm(u))), grip: String(grip) });
        }
        return;
      }
      // ePoints visibles: clic en uno y clic en otro de otro componente → se conectan (como Inventor)
      if (!s.tool && !s.dialog) {
        const r = refAt(ev);
        const ep = r?.object.userData.ep as { occ: string; id: string; name: string } | undefined;
        if (ep) {
          const c = s.epConnect;
          if (!c || c.occ === ep.occ) { useStore.setState({ epConnect: { occ: ep.occ, ep: ep.id, label: r!.object.userData.label }, selItem: ep.occ }); return; }
          const oa = s.asm.occurrences.find((o) => o.id === c.occ), ob = s.asm.occurrences.find((o) => o.id === ep.occ);
          const ea = oa && partEPoints(s.docData(oa.part) as PartDoc).find((x) => x.id === c.ep), eb = ob && partEPoints(s.docData(ob.part) as PartDoc).find((x) => x.id === ep.id);
          useStore.setState({ epConnect: null });
          if (!ea || !eb) return;
          s.commitAsm((a) => { a.joints.push(epJoint(a, c.occ, ea, ep.occ, eb, (p0) => p0 + Math.random().toString(36).slice(2, 8))); });
          s.notify(`ePoints conectados: ${oa!.name} · ${ea.name} ↔ ${ob!.name} · ${eb.name}`);
          return;
        }
        if (s.epConnect) useStore.setState({ epConnect: null });
      }
      // Selección normal
      const hit = hitAt(ev);
      const id = hit ? (hit.object.userData.id as string) : null;
      useStore.setState({ selItem: id && hit!.object.userData.kind === 'occ' ? topOf(s, id) : id });
    });
    cvs.addEventListener('dblclick', (ev) => {
      const s = useStore.getState();
      if (s.tool === 'epMove') {
        const a = triadAxis(ev); if (!a) { s.notify('Doble clic sobre una flecha (mover) o un anillo (girar) de la tríada', 'error'); return; }
        const r = host.current!.getBoundingClientRect(); setAxisIn({ x: ev.clientX - r.left, y: ev.clientY - r.top, axis: a.axis, rot: a.ring }); return;
      }
      if (s.tool) return;
      const hit = hitAt(ev);
      // Mayús + doble clic: la vista gira en torno a esa pieza (en vacío: en torno a todo el ensamblaje)
      if (ev.shiftKey) {
        const bb = new THREE.Box3();
        if (hit?.object.userData.kind === 'occ') {
          const top = topOf(s, hit.object.userData.id);
          for (const m of pickables) if (m.userData.kind === 'occ' && topOf(s, m.userData.id) === top) { m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld)); }
        } else for (const m of pickables) if (m.visible !== false) { m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld)); }
        if (bb.isEmpty()) return;
        const c = bb.getCenter(new THREE.Vector3());
        // se desplaza la cámara junto con el objetivo para que la imagen no salte
        const d = c.clone().sub(V.controls.target);
        V.controls.target.add(d); camera.position.add(d); V.controls.update();
        V.showPoint(vArr(c, 3) as V3); setTimeout(() => V.showPoint(null), 1500);
        V.request();
        const o = hit?.object.userData.kind === 'occ' ? findOcc(s, hit.object.userData.id) : null;
        s.notify(o ? `Centro de giro: ${o.name} · Mayús + doble clic en vacío para volver al ensamblaje` : 'Centro de giro: todo el ensamblaje');
        return;
      }
      if (hit?.object.userData.kind === 'occ') {
        const o = findOcc(s, hit.object.userData.id);
        if (!o) return;
        // Ctrl + doble clic: editar la pieza en el 3D, con el resto del ensamblaje visible y difuminado
        if ((ev.ctrlKey || ev.metaKey) && s.docs.find((d) => d.id === o.part)?.kind === 'part') { asmActions.editInPlace(o.id); return; }
        // doble clic: editar el componente (generador HVAC/tubería con sus valores, o propiedades y cotas editables)
        asmActions.editComponent(o.id);
      }
    });
    cvs.addEventListener('pointermove', (ev) => {
      const s = useStore.getState();
      if (s.tool === 'place') { lastCursor = { x: ev.clientX, y: ev.clientY }; moveGhost(lastCursor); return; }
      if (s.tool === 'frameLine') {
        const c = nearestCand(ev); const k = c?.key ?? '';
        if (k !== hoverKey) { hoverKey = k; buildLines(s); setHint(c ? c.label : ''); }
      } else if (s.tool === 'asmFace' || s.tool === 'weldFace' || s.tool === 'boltFace') {
        const hit = hitAt(ev);
        V.clearGroup(overlayGroup);
        const r = s.tool === 'asmFace' ? refAt(ev) : undefined;
        const rh = r && (!hit || r.object.userData.ref.kind === 'axis' || r.distance < hit.distance) ? r.object : null;
        if (rh !== refHover) {
          if (refHover) ((refHover as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = refHover.userData.base;
          if (rh) ((rh as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, rh.userData.base + 0.3);
          refHover = rh; setHint(rh ? rh.userData.label : '');
        }
        if (rh) { V.request(); return; }
        if (hit) {
          const f = faceFromHit(hit);
          if (f) {
            const m = meshOf(hit.object.userData.kind, hit.object.userData.id)!;
            const pf = planarFaceAt(m, hit.faceIndex!)!; const g = m.faceGroups[pf.group], pos: number[] = [];
            for (let i = g.start; i < g.start + g.count; i++) { const vi = m.triangles[i]; pos.push(m.vertices[vi * 3], m.vertices[vi * 3 + 1], m.vertices[vi * 3 + 2]); }
            const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            const mm = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: css('--hover'), transparent: true, opacity: 0.4, depthTest: false, side: THREE.DoubleSide }));
            mm.renderOrder = 6; mm.matrixAutoUpdate = false; mm.matrix.copy(hit.object.matrixWorld);
            overlayGroup.add(mm);
          }
        }
        V.request();
      }
    });
    cvs.addEventListener('contextmenu', (e) => e.preventDefault());

    const applyMouse = (s: State) => {
      const picking = !!s.tool && s.tool !== 'move';
      // las herramientas de ensamblaje se eligen con clic: arrastrar con el botón izquierdo sigue girando la vista
      V.setMouse(false, false);
      cvs.style.cursor = picking ? 'pointer' : 'default';
    };

    const s0 = useStore.getState();
    applyMouse(s0); build(s0); buildRefs(s0);
    let first = !s0.asmResult;
    const drawMeasure = () => {
      V.clearGroup(measureGroup); const s = useStore.getState(); if (s.tool !== 'measure') return;
      const ms = useMeasure.getState(); let r = null; try { r = ms.sel.length ? measureCompute(ms.sel, ms.dist, ms.prec) : null; } catch { /* */ }
      measureGroup.add(measureOverlay(ms.sel, r, (p, c, w) => V.segs(p, V.lineMat(c, w, false, false)), css('--accent'), '#d94f8a')); V.request();
    };
    const unsubM = useMeasure.subscribe(drawMeasure);
    // Tender conductos: anillo y flecha en la boca activa
    const routeGroup = new THREE.Group(); scene.add(routeGroup);
    const drawRoute = () => {
      V.clearGroup(routeGroup); const s = useStore.getState(); const a = useRoute.getState().active;
      if (s.tool !== 'hvacRoute' || !a) { V.request(); return; }
      const A = mouthWorld(a); if (!A) { V.request(); return; }
      const r = A.m.shape === 'round' ? A.m.D / 2 : 0, pts: number[] = [];
      const ring = (k: number) => { if (A.m.shape === 'round') { const t = (k / 48) * Math.PI * 2; return A.P.clone().addScaledVector(A.X, Math.cos(t) * r).addScaledVector(A.Y, Math.sin(t) * r); } const c = [[1, 1], [-1, 1], [-1, -1], [1, -1]][k % 4]; return A.P.clone().addScaledVector(A.X, (c[0] * A.m.W) / 2).addScaledVector(A.Y, (c[1] * A.m.H) / 2); };
      const n = A.m.shape === 'round' ? 48 : 4;
      for (let k = 0; k < n; k++) { const p0 = ring(k), p1 = ring(k + 1); pts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z); }
      const L = Math.max(A.m.W, A.m.H, A.m.D) * 0.6, tip = A.P.clone().addScaledVector(A.D, L);
      pts.push(A.P.x, A.P.y, A.P.z, tip.x, tip.y, tip.z);
      routeGroup.add(V.segs(pts, V.lineMat('#1f8fb3', 4, false, false)));
      V.request();
    };
    const unsubR = useRoute.subscribe(drawRoute);
    const unsubCalc = useAsmCalc.subscribe((a, b) => { if (a.colorBy !== b.colorBy || a.revDiff !== b.revDiff || (a.colorBy !== 'none' && a.calc !== b.calc)) build(useStore.getState()); });
    const unsub = useStore.subscribe((s, p) => {
      if (s.kind !== 'assembly') return;
      if (s.asmResult !== p.asmResult || s.interf !== p.interf || s.wire !== p.wire || s.clip !== p.clip || s.selItem !== p.selItem || s.selGroup !== p.selGroup || s.memberUtil !== p.memberUtil || s.showEdges !== p.showEdges || s.explodeT !== p.explodeT || s.mode !== p.mode || s.tool !== p.tool || s.asm.explode !== p.asm.explode || s.hud !== p.hud) {
        build(s);
        if (first && s.asmResult && V.hasModel) { first = false; V.setView('home'); }
      }
      if (s.dialog?.kind !== p.dialog?.kind || s.asm.workPlanes !== p.asm.workPlanes || s.asm.workAxes !== p.asm.workAxes || s.asm.workPoints !== p.asm.workPoints
        || s.asmResult !== p.asmResult || s.asmOrigins !== p.asmOrigins || s.tool !== p.tool || s.hud.epoints !== p.hud.epoints || s.epConnect !== p.epConnect || s.docs !== p.docs || s.placing?.occ !== p.placing?.occ) buildRefs(s);
      if (s.epConnect !== p.epConnect) setHint(s.epConnect ? `${s.epConnect.label}: elige el ePoint de otro componente para conectarlos (Esc cancela)` : '');
      if (s.dialog !== p.dialog) { buildLines(s); if (!preview(s) && p.dialog?.kind === 'joint') build(s); }
      if (s.placing !== p.placing && s.placing && p.placing && s.placing.occ === p.placing.occ && lastCursor) moveGhost(lastCursor);
      if (s.tool !== p.tool || s.asmResult !== p.asmResult) drawRoute();
      if (!s.unitPick && s.selItem !== p.selItem && s.selGroup && !(s.selItem && s.selGroup.includes(s.selItem))) setTimeout(() => useStore.setState({ selGroup: null }), 0);
      if (p.tool === 'asmCreatePick' && s.tool !== 'asmCreatePick' && (s.reattach || s.routePick)) useStore.setState({ reattach: null, routePick: null });
      if (p.dialog && !s.dialog && s.createTarget) setTimeout(() => { const t = useStore.getState(); if (!t.dialog && t.createTarget) useStore.setState({ createTarget: null }); }, 0);
      if (p.dialog && !s.dialog && s.inlineAt) setTimeout(() => { const t = useStore.getState(); if (!t.dialog && t.inlineAt) useStore.setState({ inlineAt: null, createTarget: null }); }, 0);
      if (s.tool !== p.tool) { applyMouse(s); setHint(''); hoverKey = ''; V.clearGroup(overlayGroup); if (p.tool === 'measure') measureReset(); drawMeasure(); }
      if (s.view !== p.view) V.setView(s.view.name);
      if (s.freeRot !== p.freeRot) { stopFreeRot(); if (s.freeRot) startFreeRot(s, s.freeRot); }
      if (s.tool !== p.tool || s.epMove !== p.epMove || (s.tool === 'epMove' && s.asmResult !== p.asmResult)) { if (p.tool === 'epMove' && s.tool !== 'epMove') { setAxisIn(null); if (s.epMove) useStore.setState({ epMove: null }); } buildTriad(useStore.getState()); }
      if (s.asmRotate !== p.asmRotate) { if (!s.asmRotate) { tempRot.clear(); rotWarned = false; buildRefs(s); } cvs.style.cursor = s.asmRotate ? 'grab' : 'default'; build(s); }
    });
    V.setView('home');
    return () => { unsub(); unsubM(); unsubR(); unsubCalc(); tc.dispose(); V.dispose(); };
  }, []);

  const tool = useStore((s) => s.tool);
  const hud = useStore((s) => s.hud);
  const dialog = useStore((s) => s.dialog);
  const step = dialog && 'step' in dialog ? dialog.step ?? 0 : 0;
  const hints: Record<string, string> = {
    frameLine: 'Selecciona líneas de esqueleto o de boceto · clic de nuevo para quitar',
    skelPoint: step === 0 ? 'Punto inicial: vértice, extremo de línea o punto de una cara' : 'Punto final',
    hvacRoute: 'Tender conductos: clic en una boca libre (ePoint) · elige las piezas en el panel · Esc para terminar',
    epMove: 'Tríada del ePoint: arrastra un anillo para girar (pasos de 5°, Mayús libre) · doble clic en un anillo = ángulo exacto · doble clic en una flecha = mover (mm) · − = sentido contrario · Esc o clic derecho: terminar',
    asmCreatePick: 'Crear / Añadir: clic en un ePoint (boca o extremo libre) o en una cara de un componente · Esc: sin referencia',
    asmFace: dialog?.kind === 'asmwp' ? 'Cara plana o plano de base para el plano de trabajo' : (dialog as { draft?: { epMode?: boolean } } | null)?.draft?.epMode ? (step === 0 ? 'Primer ePoint: clic en un ePoint de un componente' : 'Segundo ePoint: clic en un ePoint de otro componente') : step === 0 ? 'Primera geometría: cara, eje o plano de origen' : step === 1 ? 'Segunda geometría (se moverá el componente libre)' : 'Plano de simetría',
    weldFace: step === 0 ? 'Primera cara a soldar' : 'Segunda cara a soldar',
    boltFace: 'Cara de inicio: donde apoya la cabeza del tornillo',
    fastHole: 'Clic en la pared de un taladro, cerca del lado de la cabeza o de la primera tuerca',
    move: 'Arrastra el gizmo para mover o girar el componente seleccionado',
    place: 'Clic: soltar copia · X / Y / Z: girar 90° · Esc o clic derecho: terminar',
    pickMember: 'Selecciona la barra y después la barra de referencia',
  };

  return (
    <div className={`viewport scene-${hud.scene} ${hud.cube ? '' : 'no-cube'}`} ref={host}>
      <div className="viewcube" ref={cubeHost} />
      <HeadsUp kind="asm" />
      <ClipBar />
      <MeasurePanel />
      <button className="vp-home" title="Vista de inicio (F6)" onClick={() => useStore.getState().setView('home')}>
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
      </button>
      {(hint || (tool && hints[tool])) && <div className="vp-hint">{hint || hints[tool!]}</div>}
      {ctx && <AsmCtxMenu ctx={ctx} close={() => setCtx(null)} />}
      {axisIn && <AxisInput {...axisIn} close={() => setAxisIn(null)} />}
      <UnitBar />
    </div>
  );
}

/** Caja flotante de «Mover desde el ePoint»: mm a lo largo del eje pulsado (negativo: sentido contrario) */
function AxisInput({ x, y, axis, rot, close }: { x: number; y: number; axis: 'X' | 'Y' | 'Z'; rot?: boolean; close: () => void }) {
  const [v, setV] = useState('');
  const ok = () => {
    const d = parseFloat(v.replace(',', '.').replace('−', '-'));
    const s = useStore.getState();
    if (!isFinite(d) || !d || !s.epMove) { close(); return; }
    const u: V3 = axis === 'X' ? [1, 0, 0] : axis === 'Y' ? [0, 1, 0] : [0, 0, 1];
    if (rot) asmActions.epRotateAxis(s.epMove, u, d);
    else asmActions.epMove(s.epMove, [u[0] * d, u[1] * d, u[2] * d]);
    close();
  };
  return (
    <div className="axis-in" style={{ left: x + 12, top: y - 14 }} onPointerDown={(e) => e.stopPropagation()}>
      <b className={`ax-${axis}`}>{rot ? `↻ ${axis}` : axis}</b>
      <input autoFocus value={v} placeholder={rot ? 'grados (−: al revés)' : 'mm (−: al revés)'} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') ok(); if (e.key === 'Escape') close(); }} />
      <button className="btn sm primary" onClick={ok}>OK</button>
    </div>
  );
}

/** Menú contextual del visor de ensamblaje: restringir la geometría pulsada. */
function AsmCtxMenu({ ctx, close }: { ctx: { x: number; y: number; ref: FaceRef; pW: V3; label: string; ep?: { occ: string; id: string } }; close: () => void }) {
  const [rotOpen, setRotOpen] = useState(false);
  const [rotAx, setRotAx] = useState<'ep' | 'X' | 'Y' | 'Z'>('ep');
  const [brOpen, setBrOpen] = useState(false);
  const [unOpen, setUnOpen] = useState(false);
  const [stOpen, setStOpen] = useState(false);
  const occRef = useRef<string | null>(null);
  const rot = (deg: number) => { const id = occRef.current; if (!id) return; if (rotAx === 'ep') asmActions.epRotate(id, deg); else asmActions.epRotateAxis(id, rotAx === 'X' ? [1, 0, 0] : rotAx === 'Y' ? [0, 1, 0] : [0, 0, 1], deg); };
  const s = useStore.getState();
  useEffect(() => {
    const off = (e: Event) => { if (!(e.target as HTMLElement).closest?.('.ctx')) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', off, true); window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('pointerdown', off, true); window.removeEventListener('keydown', esc, true); };
  }, [close]);
  const vo = (s.asmResult?.view?.occurrences as FlatOcc[] | undefined)?.find((o) => o.id === ctx.ref.occ);
  const occ = s.asm.occurrences.find((o) => o.id === (vo?.sub ?? ctx.ref.occ));
  occRef.current = occ?.id ?? null;
  const openPart = vo?.part ?? occ?.part;
  const isAxis = ctx.ref.kind === 'axis';
  const start = (type: JointType, extra: Record<string, unknown> = {}, b?: { ref: FaceRef; label: string }) => {
    close();
    asmActions.openJoint();
    const st = useStore.getState(); const dlg = st.dialog as any;
    const name = `${({ mate: 'Coincidir', flush: 'Al ras', angle: 'Ángulo', tangent: 'Tangente', insert: 'Insertar', perp: 'Perpendicular', sym: 'Simetría' } as Record<string, string>)[type] ?? 'Unión'}${st.asm.joints.length + 1}`;
    useStore.setState({ dialog: { ...dlg, draft: { ...dlg.draft, type, name, a: ctx.ref, aW: ctx.pW, aL: ctx.label, ...(b ? { b: b.ref, bL: b.label } : {}), ...extra }, step: b ? 0 : 1 } });
  };
  const items: [string, () => void][] = [
    ['Coincidencia', () => start('mate')],
    [isAxis ? 'Eje (coaxial)' : 'Cara plana (enfrentada)', () => start('mate')],
    ['Al ras (mismo sentido)', () => start('flush')],
    ['Tangencia', () => start('tangent')],
    ['Perpendicularidad', () => start('perp')],
    ['Ángulo…', () => start('angle', { angle: '90 deg' })],
    ['Inserción', () => start('insert')],
    ['Simetría…', () => start('sym')],
  ];
  const orig = ORIGIN_REFS.filter((o) => (o.ref.kind === 'axis') === isAxis);
  /** Restricción ePoint–ePoint: abre Restringir en modo ePoint (con el ePoint pulsado como origen) y se eligen en pantalla */
  const epEp = (ep?: { occ: string; id: string }) => {
    close();
    asmActions.openJoint();
    const st = useStore.getState(); const dlg = st.dialog as any; if (dlg?.kind !== 'joint') return;
    useStore.setState({ dialog: { ...dlg, draft: { ...dlg.draft, epMode: true, type: 'mate', a: undefined, b: undefined, aL: undefined, bL: undefined, aW: undefined, bW: undefined }, step: 0 }, hud: { ...st.hud, epoints: true } });
    if (ep) setJointEPoint(ep.occ, ep.id, 'a');
  };
  const tpls = ctx.ep ? (() => { try { return JSON.parse(localStorage.getItem('inv3d.routeTemplates') ?? '[]') as { name: string; date: string; items: unknown[] }[]; } catch { return []; } })() : [];
  if (ctx.ep) return (
    <div className="ctx" style={{ left: ctx.x, top: ctx.y, position: 'fixed' }} onContextMenu={(e) => e.preventDefault()}>
      <div className="ctx-title">{ctx.label}</div>
      <button title="Este ePoint es el origen; después haz clic en el ePoint destino de otro componente" onClick={() => epEp(ctx.ep)}>Restringir ePoint origen → ePoint destino…</button>
      <button title="Encadenar tubos, conductos, codos, tes… desde esta boca, restringidos por ePoints" onClick={() => { close(); const F = ctx.ep && epFrame(ctx.ep.occ, ctx.ep.id); if (!F) return; useStore.setState({ createRecursive: true, createCat: /^(Tubo|Cara brida|Cara portabridas)/.test(F.e.name) ? 'mech' : 'hvac', createTarget: { occ: F.o.id, ref: epRef(F.e, F.o.id), ep: F.e.id, epKind: F.e.kind, label: F.name, pW: [F.P.x, F.P.y, F.P.z], nW: [F.D.x, F.D.y, F.D.z] }, dialog: { kind: 'createcomp' } }); }}>Añadir desde aquí…</button>
      <button title="Tramos rectos y codos de 90° hasta un punto (X, Y, Z) o hasta otra boca, con las longitudes calculadas" onClick={() => { close(); if (ctx.ep) s.open({ kind: 'routeto', occ: ctx.ep.occ, ep: ctx.ep.id } as never); }}>Tender hasta…</button>
      {tpls.length > 0 && <><div className="ctx-sub">Insertar plantilla</div>{tpls.map((t) => <button key={t.name} title={`${t.items.length} piezas · ${t.date}`} onClick={() => { close(); if (ctx.ep) void import('./asmextra').then((m) => m.insertTemplate(t.name, ctx.ep!.occ, ctx.ep!.id)); }}>{t.name}</button>)}</>}
    </div>
  );
  return (
    <div className="ctx" style={{ left: ctx.x, top: ctx.y, position: 'fixed' }} onContextMenu={(e) => e.preventDefault()}>
      <div className="ctx-title">{ctx.label}</div>
      {items.map(([l, f]) => <button key={l} onClick={f}>Restringir · {l}</button>)}
      <button title="Elige el ePoint origen y el ePoint destino (de otro componente), en las listas o con clic en pantalla" onClick={() => epEp()}>Restringir ePoint origen → ePoint destino…</button>
      <hr />
      {orig.map((o) => <button key={o.key} onClick={() => start(isAxis ? 'mate' : 'flush', {}, { ref: o.ref, label: `Ensamblaje · ${o.label}` })}>{isAxis ? 'Coaxial con' : 'Al ras con'} {o.label} del ensamblaje</button>)}
      {!isAxis && (s.asm.workPlanes ?? []).map((w) => <button key={w.id} onClick={() => start('flush', {}, { ref: workPlaneRef(w), label: w.name })}>Al ras con {w.name}</button>)}
      {isAxis && (s.asm.workAxes ?? []).map((w) => <button key={w.id} onClick={() => start('mate', {}, { ref: workAxisRef(w), label: w.name })}>Coaxial con {w.name}</button>)}
      {occ && isStraightDuct(occ.id) && (() => { const d0 = Math.round(distAlong(occ.id, ctx.pW)); const cf = segCfg(); return (<><hr />
        <div className="ctx-sub">Tramo recto · punto a {d0} mm de su entrada</div>
        <button title={`Corta el conducto en el punto pulsado: dos tramos con bridas ${cf.joint === 'tdc' ? 'TDC' : 'de marco angular'} en el corte y junta de ${cf.g} mm`} onClick={() => { close(); cutDuct(occ.id, d0); }}>Cortar aquí (bridas + junta)</button>
        <button title="Paso por mamparo o cubierta en el punto pulsado: manguito con holgura 10 mm y chapa de refuerzo" onClick={() => { close(); void import('./asmextra').then((m) => m.addPenetration(occ.id, d0, 0)); }}>Paso por mamparo aquí (estanco)</button>
        <button title="Paso por mamparo clase A-60: manguito, chapa de refuerzo y aislamiento" onClick={() => { close(); const v = prompt('Paso A-60: espesor del aislamiento del paso (mm)', '50'); const e = v ? parseFloat(v.replace(',', '.')) : NaN; if (e > 0) void import('./asmextra').then((m) => m.addPenetration(occ.id, d0, e)); }}>Paso por mamparo aquí (A-60)…</button>
        <button onClick={() => { close(); const v = prompt('Cortar a (mm desde la entrada del tramo)', String(d0)); const d = v ? parseFloat(v.replace(',', '.')) : NaN; if (isFinite(d)) cutDuct(occ.id, d); }}>Cortar a…</button>
        <button title="Parte el tramo en el punto pulsado e inserta una compuerta, silenciador, cortafuegos, transición… elegida en el centro de contenido" onClick={() => { close(); const T = asmActions.inlineTarget(occ.id, d0); if (T) { useStore.setState({ inlineAt: { occ: occ.id, d: d0 }, createTarget: T, createCat: 'hvac' }); s.open({ kind: 'createcomp' }); } }}>Insertar en línea aquí…</button>
        <button title={`Partes de ≤ ${cf.maxL} mm y ≤ ${cf.maxKg} kg con bridas y juntas (Archivo › Opciones › Tramos)`} onClick={() => { close(); segmentDuct(occ.id); }}>Dividir en tramos (≤ {cf.maxL} mm / {cf.maxKg} kg)</button>
        <button onClick={() => { close(); const sp = (s.docData(occ.part) as { hvacSpec?: { L: number } }).hvacSpec; const v = prompt('Longitud del tramo (mm); lo de detrás se recoloca', String(sp?.L ?? '')); const L = v ? parseFloat(v.replace(',', '.')) : NaN; if (isFinite(L)) setDuctLength(occ.id, L); }}>Longitud del tramo…</button>
      </>); })()}
      {occ && s.docs.find((d) => d.id === occ.part)?.kind === 'part' && (<><hr />
        <button title="Doble clic" onClick={() => { close(); asmActions.editComponent(occ.id); }}>Editar componente…</button>
        <button title="Caudal de diseño en este componente (terminales: rejillas, difusores…) para el cálculo del tendido" onClick={() => { close(); const v = prompt(`Caudal de diseño de ${occ.name} (m³/h; vacío = sin caudal)`, occ.flow ? String(occ.flow) : ''); if (v == null) return; const q = parseFloat(v.replace(',', '.')); s.commitAsm((a) => { const t = a.occurrences.find((x) => x.id === occ.id); if (t) t.flow = q > 0 ? q : undefined; }); }}>Caudal de diseño…{occ.flow ? ` (${occ.flow} m³/h)` : ''}</button>
        {asmActions.isSheet(occ.part) && <button title="Desarrollo de la chapa con líneas de pliegue, cotas y DXF para corte" onClick={() => { close(); s.open({ kind: 'flat', pid: occ.part } as never); }}>Desarrollo de chapa…</button>}</>)}
      {occ && (foranJoint(occ.id) || occ.grounded) && epOfOcc(occ.id) && (<><hr />
        <div className="ctx-sub">Desde el ePoint «{epOfOcc(occ.id)!.name}»{foranJoint(occ.id) ? ' (unión)' : ''}{foranJoint(occ.id)?.offset && parseFloat(foranJoint(occ.id)!.offset) ? ` · desplazada ${foranJoint(occ.id)!.offset}` : ''}</div>
        <button className={rotOpen ? 'on' : ''} title="Gira el componente y todo lo que arrastra detrás sobre el eje de su ePoint" onClick={() => setRotOpen(!rotOpen)}>Girar {rotOpen ? '▾' : '▸'}</button>
        {rotOpen && (<div className="ctx-angles">
          <div className="ctx-axes">Eje {(['ep', 'X', 'Y', 'Z'] as const).map((k) => <button key={k} className={rotAx === k ? 'on' : ''} title={k === 'ep' ? 'Eje del ePoint (el de su unión)' : `Eje ${k} global por el ePoint`} onClick={() => setRotAx(k)}>{k === 'ep' ? 'ePoint' : k}</button>)}</div>
          {[15, 30, 45, 60, 75, 90].map((a) => <button key={a} onClick={() => { close(); rot(a); }}>+{a}°</button>)}
          {[15, 30, 45, 60, 75, 90].map((a) => <button key={-a} onClick={() => { close(); rot(-a); }}>−{a}°</button>)}
          <button className="wide" onClick={() => { close(); const v = prompt(`Ángulo de giro sobre ${rotAx === 'ep' ? 'el eje del ePoint' : `el eje ${rotAx}`} (grados; negativo = sentido contrario)`, '20'); const d = v ? parseFloat(v.replace(',', '.').replace('−', '-')) : NaN; if (isFinite(d) && d) rot(d); }}>Ángulo personalizado…</button>
        </div>)}
        <button className={brOpen ? 'on' : ''} title="El componente y todo lo que arrastra detrás" onClick={() => setBrOpen(!brOpen)}>Ramal {brOpen ? '▾' : '▸'}</button>
        {brOpen && (<div className="ctx-indent">
          <button onClick={() => { close(); const g = epGroup(occ.id); useStore.setState({ selItem: occ.id, selGroup: g }); s.notify(`Ramal: ${g.length} componente(s) resaltados`); }}>Seleccionar ramal</button>
          <button onClick={() => { close(); void import('./hvacops').then((m) => m.changeSectionPrompt(occ.id)); }}>Cambiar sección del ramal…</button>
          <button onClick={() => { close(); const v = prompt('Copiar el ramal desplazado (mm): dx, dy, dz', '0, 1000, 0'); if (v) { const d = v.split(/[;,\s]+/).map((x) => parseFloat(x.replace(',', '.')) || 0); void import('./hvacops').then((m) => m.copyBranch(occ.id, [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0])); } }}>Copiar ramal…</button>
          <button onClick={() => { close(); const v = prompt('Sistema del ramal (p. ej. Impulsión, Retorno, Extracción; vacío = quitar)', occ.system ?? 'Impulsión'); if (v != null) setSystem(occ.id, v.trim()); }}>Asignar sistema…</button>
          <button onClick={() => { close(); const v = prompt('Soportes en el ramal: separación (mm)', '2500'); const d = v ? parseFloat(v.replace(',', '.')) : NaN; if (d > 200) addSupports(d, 500, epGroup(occ.id)); }}>Soportes en el ramal…</button>
          <button onClick={() => { close(); const v = prompt(`Aislar el ramal: espesor (mm). Mínimo RITE (λ 0,04): interior ${riteMin('int', 'cold')} frío / ${riteMin('int', 'hot')} caliente · exterior ${riteMin('ext', 'cold')} / ${riteMin('ext', 'hot')}`, String(riteMin('int', 'cold'))); const e = v ? parseFloat(v.replace(',', '.')) : NaN; if (e > 0) addInsulation(e, epGroup(occ.id)); }}>Aislar ramal…</button>
          <button title="Guarda el ramal (o las piezas resaltadas) como plantilla para insertarla después en cualquier boca libre (clic derecho sobre el ePoint › Insertar plantilla)" onClick={() => { close(); const ids = s.selGroup?.includes(occ.id) ? s.selGroup : epGroup(occ.id); const v = prompt(`Nombre de la plantilla (${ids.length} piezas; se inserta por la boca de entrada de «${occ.name}»)`, 'Rejilla + plenum'); if (v?.trim()) void import('./asmextra').then((m) => m.saveTemplate(v.trim(), ids, occ.id)); }}>Guardar como plantilla…</button>
          <button onClick={() => { close(); const g = epGroup(occ.id); if (confirm(`¿Borrar el ramal (${g.length} componentes)?`)) void import('./hvacops').then((m) => m.deleteBranch(occ.id)); }}>Borrar ramal</button>
        </div>)}
        <button title="Tríada X, Y, Z en el ePoint: doble clic en una flecha = mover (mm), doble clic en un anillo = girar (°); negativo = sentido contrario" onClick={() => { close(); useStore.setState({ selItem: occ.id, epMove: occ.id }); s.setTool('epMove'); }}>Mover / girar con la tríada…</button>
        {foranJoint(occ.id) && (<>
          <button title="Separa la pieza a lo largo del eje de la unión (0 = encajada)" onClick={() => { close(); const v = prompt('Desplazar a lo largo de la unión (mm; 0 = encajada)', String(parseFloat(foranJoint(occ.id)?.offset ?? '0') || 0)); const d = v != null ? parseFloat(v.replace(',', '.')) : NaN; if (isFinite(d)) asmActions.foranOffset(occ.id, d); }}>Desplazar a lo largo de la unión…</button>
          <button title="Une la pieza a la misma boca de destino por otra de sus bocas" onClick={() => { close(); asmActions.foranOtherPort(occ.id); }}>Cambiar boca · usar otra boca de la pieza</button>
          <button title="Elige en pantalla otra boca libre de otro componente" onClick={() => { close(); asmActions.foranReattach(occ.id); }}>Cambiar boca de destino…</button>
          <button title="Quita la unión y deja la pieza libre para el gizmo (o G)" onClick={() => { close(); asmActions.foranFree(occ.id); }}>Soltar (mover / girar libre)</button>
        </>)}</>)}
      {occ && !foranJoint(occ.id) && !occ.grounded && (<><hr />
        <button title="Une la pieza a una boca libre de otro componente (elegida en pantalla)" onClick={() => { close(); asmActions.foranReattach(occ.id); }}>Unir por ePoint a una boca…</button></>)}
      {occ && s.asm.env?.hvac !== false && (() => { const un = unitOf(occ.id); return (<><hr />
        <button className={unOpen ? 'on' : ''} title="Conjunto de piezas que se fabrica y transporta junto: su longitud (caja envolvente) y su peso, con bridas y juntas, no pasan de los máximos; si pasan se cortan sus tramos rectos de los extremos" onClick={() => setUnOpen(!unOpen)}>Unidad de montaje{un ? ` (${un.name})` : ''} {unOpen ? '▾' : '▸'}</button>
        {unOpen && (<div className="ctx-indent">
          <button onClick={() => { close(); useStore.setState({ unitPick: {}, selGroup: [occ.id], selItem: null }); }}>Nueva unidad: elegir piezas con el ratón…</button>
          <button onClick={() => { close(); setUnit(epGroup(occ.id)); const u = unitOf(occ.id); if (u) setTimeout(() => fitUnit(u.id), 50); }}>Nueva unidad con el ramal</button>
          {un && <>
            <button onClick={() => { close(); useStore.setState({ unitPick: { id: un.id }, selGroup: [...un.occs], selItem: null }); }}>Editar piezas de {un.name}…</button>
            <button onClick={() => { close(); const i = unitInfo(un); s.notify(`${un.name}: ${i.ids.length} piezas · ${Math.round(i.len)} mm · ${i.kg.toFixed(1)} kg (máx. ${segCfg().maxL} mm / ${segCfg().maxKg} kg)`); useStore.setState({ selGroup: [...un.occs], selItem: occ.id }); }}>Ver {un.name} (longitud y peso)</button>
            <button onClick={() => { close(); fitUnit(un.id); }}>Ajustar {un.name} a los máximos</button>
            <button onClick={() => { close(); setUnit(un.occs.filter((x) => x !== occ.id), un.id); }}>Quitar la pieza de {un.name}</button>
            <button onClick={() => { close(); deleteUnit(un.id); }}>Borrar la unidad {un.name}</button>
          </>}
        </div>)}</>); })()}
      {occ && (() => { const tgt = s.selGroup?.includes(occ.id) ? s.selGroup : [occ.id]; return (<>
        <button className={stOpen ? 'on' : ''} title="Estado de fabricación y montaje (colores por estado)" onClick={() => setStOpen(!stOpen)}>Estado: {STATUS_NAMES[occ.status ?? 'design']}{tgt.length > 1 ? ` · ${tgt.length} piezas` : ''} {stOpen ? '▾' : '▸'}</button>
        {stOpen && (<div className="ctx-indent">{(Object.keys(STATUS_NAMES) as (keyof typeof STATUS_NAMES)[]).map((k) => <button key={k} onClick={() => { close(); setStatus(tgt, k); }}><span style={{ display: 'inline-block', width: 10, height: 10, background: STATUS_COLORS[k], borderRadius: 2, marginRight: 6 }} />{STATUS_NAMES[k]}</button>)}</div>)}</>); })()}
      {occ && (<><hr />
        <button onClick={() => { close(); s.commitAsm((a) => { const t = a.occurrences.find((x) => x.id === occ.id); if (t) t.grounded = !t.grounded; }); }}>{occ.grounded ? 'Liberar' : 'Fijar'}</button>
        {s.docs.find((d) => d.id === openPart)?.kind === 'part' && <button onClick={() => { close(); s.open({ kind: 'occprops', occ: vo?.id ?? occ.id }); }}>Propiedades y cotas…</button>}
        {s.docs.find((d) => d.id === openPart)?.kind === 'part' && <button onClick={() => { close(); asmActions.editInPlace(vo?.id ?? occ.id); }} title="La pieza se edita en el 3D con el resto del ensamblaje difuminado">Editar en contexto (Ctrl + doble clic)</button>}
        <button onClick={() => { close(); s.activate(openPart!); }}>{vo?.sub ? 'Abrir pieza del subensamblaje' : s.docs.find((d) => d.id === occ.part)?.kind === 'assembly' ? 'Abrir subensamblaje' : 'Abrir pieza'}</button></>)}
    </div>
  );
}

export type { AsmDoc };
