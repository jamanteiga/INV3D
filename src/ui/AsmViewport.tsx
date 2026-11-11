import HeadsUp from './HeadsUp';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { useStore, type State } from '../core/store';
import { makeEval } from '../core/expr';
import { docParams, planeFrame, toWorld, entityOutline, consumedSketches, resolveWorkPlanes, v3, MATERIALS, type V3, type PartDoc } from '../core/doc';
import { xfPoint, xfInvPoint, xfInvDir, solveAssembly, ORIGIN_REFS, workPlaneRef, ASM_REF, type Xform, type AsmDoc, type FaceRef, type JointType } from '../core/asm';
import { asmActions } from './actions';
import { normalizeAsm, compose, type FlatOcc } from '../core/subasm';
import { docGetter } from '../core/store';
import type { MeshData } from '../core/cadClient';
import { View3D, css, tv, vArr, planarFaceAt, faceVertices } from './view3d';

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
  const [ctx, setCtx] = useState<{ x: number; y: number; ref: FaceRef; pW: V3; label: string } | null>(null);

  useEffect(() => {
    const V = new View3D(host.current!, cubeHost.current!);
    V.onFrame = () => { V.triad.visible = useStore.getState().hud.triad; };
    (window as unknown as { __v3d: View3D }).__v3d = V; // ayuda de depuración / pruebas
    const { scene, camera } = V;
    const modelGroup = new THREE.Group(); scene.add(modelGroup);
    const lineGroup = new THREE.Group(); scene.add(lineGroup);
    const overlayGroup = new THREE.Group(); scene.add(overlayGroup);
    const refGroup = new THREE.Group(); scene.add(refGroup);
    let refHover: THREE.Object3D | null = null;
    /** Planos y ejes de origen del ensamblaje (al restringir) y planos de trabajo: visibles y seleccionables */
    const buildRefs = (s: State) => {
      V.clearGroup(refGroup); refHover = null;
      const joint = s.dialog?.kind === 'joint' || s.dialog?.kind === 'asmwp';
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
      for (const w of s.asm.workPlanes ?? []) if (!w.hidden || joint) plane(workPlaneRef(w), w.name, '#e8a33d');
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
      }
      const pos = target.clone().sub(cL.clone().applyQuaternion(q));
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

    const build = (s: State) => {
      V.clearGroup(modelGroup);
      pickables = [];
      const r = s.asmResult;
      const box = new THREE.Box3();
      if (r) {
        const add = (kind: string, id: string, m: MeshData | undefined | null, color: string, matrix: THREE.Matrix4 | null) => {
          if (!m || !m.triangles.length) return;
          const sel = !!s.selItem && (s.selItem === id || (kind === 'occ' && topOf(s, id) === s.selItem));
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
          const color = MATERIALS.find((x) => x.name === doc?.iProperties.material)?.color ?? '#c3c8cf';
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
          add('occ', o.id, meshOf('occ', o.id), color, xfMatrix(xf, explodeOf(s, o.id)));
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
    const pickRef = (ev: MouseEvent): { ref: FaceRef; pW: V3; label: string } | null => {
      const h = hitAt(ev), r = refAt(ev);
      const useRef = r && (!h || r.object.userData.ref.kind === 'axis' || r.distance < h.distance - 1e-6);
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
    // Arrastre libre (como Inventor): clic izquierdo mantenido sobre un componente no fijo lo mueve en el plano de la vista;
    // al soltar se vuelven a resolver las restricciones (se mueve solo en sus grados de libertad libres).
    let drag: { id: string; grp: THREE.Object3D; grps: { g: THREE.Object3D; m: THREE.Matrix4 }[]; plane: THREE.Plane; start: THREE.Vector3; xf: Xform; moved: boolean } | null = null;
    host.current!.addEventListener('pointerdown', (ev) => {
      const s = useStore.getState();
      if (ev.button !== 0 || s.tool || s.mode === 'present') return;
      const hit = hitAt(ev);
      if (!hit || hit.object.userData.kind !== 'occ') return;
      const top = topOf(s, hit.object.userData.id);
      const o = s.asm.occurrences.find((x) => x.id === top);
      if (!o || o.grounded || o.mirrorOf || o.patternOf) return;
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
      if (endDrag(ev)) { downAt = null; return; }
      const small = !!downAt && Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) <= 4;
      if (small && ev.button === 2 && useStore.getState().tool === 'place') { downAt = null; asmActions.finishPlace(); return; }
      if (small && ev.button === 2 && !useStore.getState().tool) {
        downAt = null;
        const pk = pickRef(ev);
        if (pk) { const st = useStore.getState(); useStore.setState({ selItem: pk.ref.occ === ASM_REF ? null : topOf(st, pk.ref.occ) }); setCtx({ x: ev.clientX, y: ev.clientY, ref: pk.ref, pW: pk.pW, label: pk.label }); }
        else setCtx(null);
        return;
      }
      if (!downAt || !small || ev.button !== 0 || (tc as any).dragging) { downAt = null; return; }
      downAt = null;
      const s = useStore.getState();
      if (s.tool === 'place') {
        lastCursor = { x: ev.clientX, y: ev.clientY }; moveGhost(lastCursor);
        if (ghost && ghostXf) asmActions.dropPlace(ghostXf);
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
        if (step === 0) useStore.setState({ dialog: { ...dlg, draft: { ...d, a: ref, aW: pk.pW, aL: pk.label }, step: 1 } });
        else if (step === 1) useStore.setState({ dialog: { ...dlg, draft: { ...d, b: ref, bW: pk.pW, bL: pk.label, aligned: d.a?.kind === 'axis' && ref.kind === 'axis' ? d.a.convex !== ref.convex : d.aligned }, step: d.type === 'sym' ? 2 : 0 } });
        else {
          if (ref.kind === 'axis') { s.notify('El plano de simetría debe ser una cara plana o un plano', 'error'); return; }
          useStore.setState({ dialog: { ...dlg, draft: { ...d, c: ref, cL: pk.label }, step: 0 } });
        }
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
      // Selección normal
      const hit = hitAt(ev);
      const id = hit ? (hit.object.userData.id as string) : null;
      useStore.setState({ selItem: id && hit!.object.userData.kind === 'occ' ? topOf(s, id) : id });
    });
    cvs.addEventListener('dblclick', (ev) => {
      const s = useStore.getState();
      if (s.tool) return;
      const hit = hitAt(ev);
      if (hit?.object.userData.kind === 'occ') {
        const o = findOcc(s, hit.object.userData.id);
        // doble clic: propiedades físicas y cotas editables de la pieza (editar en contexto: menú contextual o Ensamblar › Editar)
        if (o && s.docs.find((d) => d.id === o.part)?.kind === 'part') s.open({ kind: 'occprops', occ: o.id });
        else if (o) s.activate(o.part);
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
      V.setMouse(picking, false);
      cvs.style.cursor = picking ? 'pointer' : 'default';
    };

    const s0 = useStore.getState();
    applyMouse(s0); build(s0); buildRefs(s0);
    let first = !s0.asmResult;
    const unsub = useStore.subscribe((s, p) => {
      if (s.kind !== 'assembly') return;
      if (s.asmResult !== p.asmResult || s.interf !== p.interf || s.wire !== p.wire || s.clip !== p.clip || s.selItem !== p.selItem || s.memberUtil !== p.memberUtil || s.showEdges !== p.showEdges || s.explodeT !== p.explodeT || s.mode !== p.mode || s.tool !== p.tool || s.asm.explode !== p.asm.explode || s.hud !== p.hud) {
        build(s);
        if (first && s.asmResult && V.hasModel) { first = false; V.setView('home'); }
      }
      if (s.dialog?.kind !== p.dialog?.kind || s.asm.workPlanes !== p.asm.workPlanes) buildRefs(s);
      if (s.dialog !== p.dialog) { buildLines(s); if (!preview(s) && p.dialog?.kind === 'joint') build(s); }
      if (s.placing !== p.placing && s.placing && p.placing && s.placing.occ === p.placing.occ && lastCursor) moveGhost(lastCursor);
      if (s.tool !== p.tool) { applyMouse(s); setHint(''); hoverKey = ''; V.clearGroup(overlayGroup); }
      if (s.view !== p.view) V.setView(s.view.name);
    });
    V.setView('home');
    return () => { unsub(); tc.dispose(); V.dispose(); };
  }, []);

  const tool = useStore((s) => s.tool);
  const hud = useStore((s) => s.hud);
  const dialog = useStore((s) => s.dialog);
  const step = dialog && 'step' in dialog ? dialog.step ?? 0 : 0;
  const hints: Record<string, string> = {
    frameLine: 'Selecciona líneas de esqueleto o de boceto · clic de nuevo para quitar',
    skelPoint: step === 0 ? 'Punto inicial: vértice, extremo de línea o punto de una cara' : 'Punto final',
    asmFace: dialog?.kind === 'asmwp' ? 'Cara plana o plano de base para el plano de trabajo' : step === 0 ? 'Primera geometría: cara, eje o plano de origen' : step === 1 ? 'Segunda geometría (se moverá el componente libre)' : 'Plano de simetría',
    weldFace: step === 0 ? 'Primera cara a soldar' : 'Segunda cara a soldar',
    boltFace: 'Cara de inicio: donde apoya la cabeza del tornillo',
    move: 'Arrastra el gizmo para mover o girar el componente seleccionado',
    place: 'Clic: soltar copia · X / Y / Z: girar 90° · Esc o clic derecho: terminar',
    pickMember: 'Selecciona la barra y después la barra de referencia',
  };

  return (
    <div className={`viewport scene-${hud.scene} ${hud.cube ? '' : 'no-cube'}`} ref={host}>
      <div className="viewcube" ref={cubeHost} />
      <HeadsUp kind="asm" />
      <button className="vp-home" title="Vista de inicio (F6)" onClick={() => useStore.getState().setView('home')}>
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
      </button>
      {(hint || (tool && hints[tool])) && <div className="vp-hint">{hint || hints[tool!]}</div>}
      {ctx && <AsmCtxMenu ctx={ctx} close={() => setCtx(null)} />}
    </div>
  );
}

/** Menú contextual del visor de ensamblaje: restringir la geometría pulsada (como el clic derecho de Inventor). */
function AsmCtxMenu({ ctx, close }: { ctx: { x: number; y: number; ref: FaceRef; pW: V3; label: string }; close: () => void }) {
  const s = useStore.getState();
  useEffect(() => {
    const off = (e: Event) => { if (!(e.target as HTMLElement).closest?.('.ctx')) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', off, true); window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('pointerdown', off, true); window.removeEventListener('keydown', esc, true); };
  }, [close]);
  const vo = (s.asmResult?.view?.occurrences as FlatOcc[] | undefined)?.find((o) => o.id === ctx.ref.occ);
  const occ = s.asm.occurrences.find((o) => o.id === (vo?.sub ?? ctx.ref.occ));
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
  return (
    <div className="ctx" style={{ left: ctx.x, top: ctx.y, position: 'fixed' }} onContextMenu={(e) => e.preventDefault()}>
      <div className="ctx-title">{ctx.label}</div>
      {items.map(([l, f]) => <button key={l} onClick={f}>Restringir · {l}</button>)}
      <hr />
      {orig.map((o) => <button key={o.key} onClick={() => start(isAxis ? 'mate' : 'flush', {}, { ref: o.ref, label: `Ensamblaje · ${o.label}` })}>{isAxis ? 'Coaxial con' : 'Al ras con'} {o.label} del ensamblaje</button>)}
      {!isAxis && (s.asm.workPlanes ?? []).map((w) => <button key={w.id} onClick={() => start('flush', {}, { ref: workPlaneRef(w), label: w.name })}>Al ras con {w.name}</button>)}
      {occ && (<><hr />
        <button onClick={() => { close(); s.commitAsm((a) => { const t = a.occurrences.find((x) => x.id === occ.id); if (t) t.grounded = !t.grounded; }); }}>{occ.grounded ? 'Liberar' : 'Fijar'}</button>
        {s.docs.find((d) => d.id === openPart)?.kind === 'part' && <button onClick={() => { close(); s.open({ kind: 'occprops', occ: vo?.id ?? occ.id }); }}>Propiedades y cotas…</button>}
        {s.docs.find((d) => d.id === openPart)?.kind === 'part' && <button onClick={() => { close(); asmActions.editInPlace(vo?.id ?? occ.id); }}>Editar en contexto</button>}
        <button onClick={() => { close(); s.activate(openPart!); }}>{vo?.sub ? 'Abrir pieza del subensamblaje' : s.docs.find((d) => d.id === occ.part)?.kind === 'assembly' ? 'Abrir subensamblaje' : 'Abrir pieza'}</button></>)}
    </div>
  );
}

export type { AsmDoc };
