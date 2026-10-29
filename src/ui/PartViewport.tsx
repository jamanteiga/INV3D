import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { useStore, activeSketch, type State } from '../core/store';
import { makeEval, fmt } from '../core/expr';
import {
  docParams, planeFrame, toWorld, entityOutline, consumedSketches, uid, v3, MATERIALS, PLANE_STD, resolveWorkPlanes,
  type Frame, type V3, type V2, type SkEntity, type SketchF, type StdPlane, type EdgeSel, type WorkPlanes, type GRef, type SkConstraint, type DimKind,
} from '../core/doc';
import {
  sketchPoints, pointOf, segKeys, segOf, entG, refPoint, refLine, refCurve, refKind, makeConstraint, makeDim, dimValue,
  trim, extend, filletCorner, solve, applySolution, isLiteral, num, circleFrom3, CONSTRAINT_GLYPH, CONSTRAINT_NAMES, nextDimName, distToSeg,
} from '../core/sketch';
import type { MeshData } from '../core/cadClient';
import { View3D, css, tv, r3, vArr, planarFaceAt, faceVertices, dpr } from './view3d';

type Ev = (s: string) => number;
interface DimLabel { id: string; x: number; y: number; text: string; expr: string; fx: boolean; driven: boolean; sel: boolean }
interface Glyph { id: string; x: number; y: number; g: string; title: string; sel: boolean }
type Pick = { kind: 'point' | 'line' | 'curve' | 'entity'; ref: GRef; p: V2 };
interface Snap { p: V2; ref?: GRef; mid?: GRef; on?: GRef; hv?: 'h' | 'v' }

function niceStep(worldPerPx: number) {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  return steps.find((s) => s / worldPerPx >= 14) ?? 1000;
}
const D2R = Math.PI / 180;
const dist2 = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Grupo de cara que contiene el punto p (prueba punto-en-triángulo con tolerancia). */
function faceGroupContaining(m: MeshData, p: V3): number {
  const P = tv(p), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), q = new THREE.Vector3();
  for (let gi = 0; gi < m.faceGroups.length; gi++) {
    const g = m.faceGroups[gi];
    for (let i = g.start; i < g.start + g.count; i += 3) {
      const t = m.triangles, v = m.vertices;
      a.set(v[t[i] * 3], v[t[i] * 3 + 1], v[t[i] * 3 + 2]); b.set(v[t[i + 1] * 3], v[t[i + 1] * 3 + 1], v[t[i + 1] * 3 + 2]); c.set(v[t[i + 2] * 3], v[t[i + 2] * 3 + 1], v[t[i + 2] * 3 + 2]);
      new THREE.Triangle(a, b, c).closestPointToPoint(P, q);
      if (q.distanceTo(P) < 1e-3) return gi;
    }
  }
  return -1;
}

export default function PartViewport() {
  const host = useRef<HTMLDivElement>(null);
  const cubeHost = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<DimLabel[]>([]);
  const [glyphs, setGlyphs] = useState<Glyph[]>([]);
  const [editing, setEditing] = useState<{ id: string; value: string; x: number; y: number } | null>(null);
  const [hint, setHint] = useState('');
  const api = useRef<{ startLabelDrag: (id: string, ev: React.PointerEvent) => void; screenOf: (p: V2) => { x: number; y: number } } | null>(null);

  useEffect(() => {
    const V = new View3D(host.current!, cubeHost.current!);
    (window as unknown as { __v3d: View3D }).__v3d = V; // ayuda de depuración / pruebas
    const { scene, camera } = V;
    const partGroup = new THREE.Group(); scene.add(partGroup);
    const sketchGroup = new THREE.Group(); scene.add(sketchGroup);
    const dimGroup = new THREE.Group(); scene.add(dimGroup);
    const originGroup = new THREE.Group(); scene.add(originGroup);
    const overlayGroup = new THREE.Group(); scene.add(overlayGroup);
    const previewObj = new THREE.Group(); scene.add(previewObj);
    const snapMarker = new THREE.Mesh(new THREE.RingGeometry(0.55, 1, 24), new THREE.MeshBasicMaterial({ color: 0xf2b600, depthTest: false, transparent: true, side: THREE.DoubleSide }));
    snapMarker.renderOrder = 10; snapMarker.visible = false; scene.add(snapMarker);

    const state = {
      mesh: null as MeshData | null,
      partMesh: null as THREE.Mesh | null,
      frame: null as Frame | null,
      work: new Map() as WorkPlanes,
      chain: [] as { p: V2; snap: Snap }[], chainIds: [] as string[], chainFirst: null as Snap | null,
      clicks: [] as Snap[],
      hover: null as Snap | null,
      hoverPick: null as Pick | null,
      hoverEdge: -1,
      hoverPlane: '' as string,
      picks: [] as Pick[],
      drag: null as null | { kind: 'point' | 'line' | 'circle'; ref: GRef; start: V2; base: ReturnType<typeof structuredClone<State['doc']>>; moved: boolean; raf: number; last: V2 | null },
      labelDrag: null as null | { id: string; base: State['doc']; moved: boolean },
    };
    const safeEval = (s: State): Ev => { const e = makeEval(docParams(s.doc)); return (x: string) => { try { return e(x); } catch { return NaN; } }; };

    V.onFrame = () => {
      const s = useStore.getState();
      V.triad.visible = s.mode !== 'sketch';
      if (snapMarker.visible) { snapMarker.quaternion.copy(camera.quaternion); snapMarker.scale.setScalar(V.worldPerPx() * 6); }
    };
    let labelRaf = 0;
    V.onChange = () => { cancelAnimationFrame(labelRaf); labelRaf = requestAnimationFrame(() => { if (useStore.getState().mode === 'sketch') { buildDims(useStore.getState()); updateLabels(); } }); };

    const setView = (name: string) => {
      const s = useStore.getState();
      if (name === 'sketch') {
        const sk = activeSketch(s); if (!sk) return;
        V.saveCamera();
        const ev = safeEval(s);
        const fr = planeFrame(sk.plane, ev, resolveWorkPlanes(s.doc, ev));
        const box = new THREE.Box3().setFromCenterAndSize(tv(fr.origin), new THREE.Vector3(160, 160, 160));
        if (state.partMesh) box.union(V.bbox);
        V.fitTo(box, tv(fr.normal).negate(), tv(fr.yDir));
        return;
      }
      V.setView(name);
    };

    // ---------- Pieza ----------
    const buildPart = (s: State) => {
      V.clearGroup(partGroup);
      state.partMesh = null;
      const res = (s.dialog && 'draft' in s.dialog && s.preview) ? s.preview : s.result;
      const m = res?.mesh ?? null;
      state.mesh = m;
      V.hasModel = !!m?.triangles.length;
      if (!m || !m.triangles.length) { buildOverlay(s); return; }
      const color = MATERIALS.find((x) => x.name === s.doc.iProperties.material)?.color ?? '#c3c8cf';
      const isPreview = res === s.preview && !!s.preview;
      const { grp, mesh } = V.meshFromData(m, color, { opacity: s.mode === 'sketch' ? 0.35 : 1, edges: s.showEdges, emissive: isPreview ? css('--accent') : undefined });
      partGroup.add(grp);
      mesh.geometry.computeBoundingBox();
      V.bbox.copy(mesh.geometry.boundingBox!);
      state.partMesh = mesh;
      V.applyVisual(s.mode === 'sketch' ? '' : s.clip, s.wire && s.mode !== 'sketch', [grp]);
      // Roscas cosméticas: anillos a paso constante sobre la cara cilíndrica
      for (const f of s.doc.features) {
        if (f.type !== 'thread' || f.suppressed || !s.result?.status[f.id]?.ok) continue;
        const pitch = parseFloat((f.designation.split(/x/i)[1] ?? '1.5')) || 1.5;
        for (const pt of f.faces) {
          const gi = faceGroupContaining(m, pt); if (gi < 0) continue;
          const g = m.faceGroups[gi], vs: THREE.Vector3[] = [], ns: THREE.Vector3[] = [];
          for (let i = g.start; i < g.start + g.count; i++) { const v = m.triangles[i]; vs.push(new THREE.Vector3(m.vertices[v * 3], m.vertices[v * 3 + 1], m.vertices[v * 3 + 2])); ns.push(new THREE.Vector3(m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2])); }
          let axis: THREE.Vector3 | null = null;
          for (let i = 1; i < ns.length && !axis; i++) { const c = ns[0].clone().cross(ns[i]); if (c.length() > 0.2) axis = c.normalize(); }
          if (!axis) continue;
          const tmin = Math.min(...vs.map((v) => v.dot(axis!))), tmax = Math.max(...vs.map((v) => v.dot(axis!)));
          // centro: punto medio entre dos vértices de normales opuestas (aprox.) → mejor: proyección y circunferencia por 3 puntos
          const P0 = vs[0].clone().addScaledVector(axis, -vs[0].dot(axis));
          const far = vs.reduce((b, v) => { const q = v.clone().addScaledVector(axis!, -v.dot(axis!)); return q.distanceTo(P0) > b.distanceTo(P0) ? q : b; }, P0.clone());
          const center = P0.clone().add(far).multiplyScalar(0.5), r = P0.distanceTo(far) / 2;
          if (!(r > 1e-6)) continue;
          const len = f.full ? tmax - tmin : Math.min(tmax - tmin, parseFloat(f.length) || tmax - tmin);
          const u = new THREE.Vector3(1, 0, 0); if (Math.abs(u.dot(axis)) > 0.9) u.set(0, 1, 0); u.sub(axis.clone().multiplyScalar(u.dot(axis))).normalize();
          const w = axis.clone().cross(u), segs: number[] = [];
          const rr = r * 1.004;
          for (let t = tmax - pitch / 2; t > tmax - len; t -= pitch) {
            const base = center.clone().addScaledVector(axis, t);
            for (let k = 0; k < 48; k++) {
              const a0 = (k / 48) * Math.PI * 2, a1 = ((k + 1) / 48) * Math.PI * 2;
              const p0 = base.clone().addScaledVector(u, rr * Math.cos(a0)).addScaledVector(w, rr * Math.sin(a0)).addScaledVector(axis, (-pitch * k) / 48 * 0);
              const p1 = base.clone().addScaledVector(u, rr * Math.cos(a1)).addScaledVector(w, rr * Math.sin(a1));
              segs.push(...p0.toArray(), ...p1.toArray());
            }
          }
          if (segs.length) partGroup.add(V.segs(segs, V.lineMat('#6b5a2a', 1, false, true)));
        }
      }
      buildOverlay(s);
    };

    const pickMesh = (): MeshData | null => useStore.getState().pickBase?.mesh ?? state.mesh;
    const groupPts = (gi: number, m = pickMesh()!): number[] => { const g = m.edgeGroups[gi]; return Array.from(m.lines.subarray(g.start * 3, (g.start + g.count) * 3)); };
    const groupMatches = (gi: number, p: V3) => {
      const a = groupPts(gi);
      for (let i = 0; i + 5 < a.length; i += 6) {
        const seg = new THREE.Line3(new THREE.Vector3(a[i], a[i + 1], a[i + 2]), new THREE.Vector3(a[i + 3], a[i + 4], a[i + 5])), q = new THREE.Vector3();
        seg.closestPointToPoint(tv(p), true, q);
        if (q.distanceTo(tv(p)) < 1e-2) return true;
      }
      return false;
    };
    const edgeRefPoint = (gi: number): V3 => {
      const a = groupPts(gi), n = a.length / 3;
      if (n <= 2) return [(a[0] + a[3]) / 2, (a[1] + a[4]) / 2, (a[2] + a[5]) / 2];
      const k = Math.floor(n / 2) * 3;
      return [a[k], a[k + 1], a[k + 2]];
    };
    const faceOverlay = (m: MeshData, gi: number, color: string, opacity: number) => {
      const g = m.faceGroups[gi], pos: number[] = [];
      for (let i = g.start; i < g.start + g.count; i++) { const v = m.triangles[i]; pos.push(m.vertices[v * 3], m.vertices[v * 3 + 1], m.vertices[v * 3 + 2]); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, side: THREE.DoubleSide }));
      mesh.renderOrder = 4;
      return mesh;
    };
    let hoverFace = -1;
    let measureSel: number[] = [];
    const buildOverlay = (s: State) => {
      V.clearGroup(overlayGroup);
      if (s.tool === 'measure' && state.mesh) for (const g of measureSel) if (g < state.mesh.edgeGroups.length) overlayGroup.add(V.segs(groupPts(g, state.mesh), V.lineMat(css('--accent'), 4, false, false)));
      const d = s.dialog && 'draft' in s.dialog ? s.dialog.draft : null;
      const m = pickMesh();
      if (m && d && (d.type === 'fillet' || d.type === 'chamfer')) {
        const sel = (d.edges as EdgeSel).points, selPts: number[] = [];
        if (d.edges.mode === 'picked') m.edgeGroups.forEach((_, gi) => { if (sel.some((p: V3) => groupMatches(gi, p))) selPts.push(...groupPts(gi)); });
        if (selPts.length) overlayGroup.add(V.segs(selPts, V.lineMat(css('--accent'), 4, false, false)));
      }
      if (m && d && d.type === 'sm_flange' && d.edge) overlayGroup.add(V.segs([...d.edge.p0, ...d.edge.p1], V.lineMat(css('--accent'), 4, false, false)));
      if (m && d && (d.type === 'shell' || d.type === 'draft' || d.type === 'split' || d.type === 'thicken')) {
        for (const p of (d.faces ?? []) as V3[]) { const gi = faceGroupContaining(m, p); if (gi >= 0) overlayGroup.add(faceOverlay(m, gi, css('--accent'), 0.45)); }
        if (hoverFace >= 0 && hoverFace < m.faceGroups.length) overlayGroup.add(faceOverlay(m, hoverFace, css('--hover'), 0.35));
      }
      if (m && state.hoverEdge >= 0 && state.hoverEdge < m.edgeGroups.length && (s.tool === 'pickEdges' || s.tool === 'pickFlangeEdge' || s.tool === 'projectGeom' || s.tool === 'measure')) {
        overlayGroup.add(V.segs(groupPts(state.hoverEdge, m), V.lineMat(css('--hover'), 4, false, false)));
      }
      V.request();
    };

    // ---------- Bocetos ----------
    const entColor = (s: State, e: SkEntity, active: boolean) => {
      if (!active) return css('--sketch-idle');
      if (s.selEntities.includes(e.id) || e.id === s.selEntity) return css('--accent');
      if (e.ref) return css('--sk-ref');
      if (s.skInfo && !s.skInfo.under.includes(e.id) && s.skInfo.ok) return css('--sk-full');
      return css('--sketch');
    };
    const buildSketches = (s: State) => {
      V.clearGroup(sketchGroup);
      const ev = safeEval(s);
      state.work = resolveWorkPlanes(s.doc, ev);
      const used = consumedSketches(s.doc);
      for (const f of s.doc.features) {
        if (f.type !== 'sketch' || f.suppressed) continue;
        const active = f.id === s.sketchId;
        if (!active && used.has(f.id)) continue;
        let fr: Frame; try { fr = planeFrame(f.plane, ev, state.work); } catch { continue; }
        if (!isFinite(fr.origin[0])) continue;
        const byColor = new Map<string, { solid: number[]; dash: number[] }>();
        const dots: number[] = [];
        const hov = active ? state.hoverPick : null;
        for (const e of f.entities) {
          let o; try { o = entityOutline(e, ev); } catch { continue; }
          if (o.pts.some((p) => !isFinite(p[0]) || !isFinite(p[1]))) continue;
          let col = entColor(s, e, active);
          if (hov && hov.ref.e === e.id && hov.kind !== 'point' && !s.selEntities.includes(e.id)) col = css('--hover');
          if (!byColor.has(col)) byColor.set(col, { solid: [], dash: [] });
          const target = e.construction ? byColor.get(col)!.dash : byColor.get(col)!.solid;
          if (e.type === 'point') { const p = toWorld(fr, o.pts[0][0], o.pts[0][1]); dots.push(...p); continue; }
          const n = o.pts.length;
          for (let i = 0; i < (o.closed ? n : n - 1); i++) target.push(...toWorld(fr, o.pts[i][0], o.pts[i][1]), ...toWorld(fr, o.pts[(i + 1) % n][0], o.pts[(i + 1) % n][1]));
          if (e.type === 'text' && active) {
            // vista previa del texto: rectángulo (el contorno real se genera en el núcleo)
          }
        }
        for (const [col, g] of byColor) {
          if (g.solid.length) sketchGroup.add(V.segs(g.solid, V.lineMat(col, active ? 2 : 1.5, false, !active)));
          if (g.dash.length) sketchGroup.add(V.segs(g.dash, V.lineMat(col, 1.4, true, false)));
        }
        if (active) {
          state.frame = fr;
          // extremos y centros
          const pts: number[] = [], ptsSel: number[] = [];
          for (const q of sketchPoints(f, ev)) {
            if (q.ref.e === 'O') continue;
            const e = f.entities.find((x) => x.id === q.ref.e);
            if (e?.type === 'point' || (e?.type === 'rect' && q.ref.k === 'c')) continue;
            (hov?.kind === 'point' && hov.ref.e === q.ref.e && hov.ref.k === q.ref.k ? ptsSel : pts).push(...toWorld(fr, q.p[0], q.p[1]));
          }
          const P = (arr: number[], color: string, size: number) => {
            if (!arr.length) return;
            const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
            const pm = new THREE.Points(g, new THREE.PointsMaterial({ color, size: size * dpr(), sizeAttenuation: false, depthTest: false, transparent: true }));
            pm.renderOrder = 6; sketchGroup.add(pm);
          };
          P(pts, css('--sketch'), 4.5);
          P(ptsSel, css('--hover'), 8);
          P(dots, css('--sketch'), 6);
          const step = niceStep(V.worldPerPx()) * 5;
          const ext = Math.max(200, V.bbox.getSize(new THREE.Vector3()).length());
          const half = Math.ceil(ext / step) * step;
          const gpts: number[] = [];
          for (let t = -half; t <= half + 1e-9; t += step) {
            if (Math.abs(t) < 1e-9) continue;
            gpts.push(...toWorld(fr, t, -half), ...toWorld(fr, t, half), ...toWorld(fr, -half, t), ...toWorld(fr, half, t));
          }
          const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gpts, 3));
          const grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: css('--grid'), transparent: true, opacity: 0.55, depthWrite: false }));
          grid.renderOrder = -1;
          sketchGroup.add(grid);
          const ax = hov?.kind === 'line' && (hov.ref.e === 'X' || hov.ref.e === 'Y') ? hov.ref.e : '';
          sketchGroup.add(V.segs([...toWorld(fr, -half, 0), ...toWorld(fr, half, 0)], V.lineMat(ax === 'X' ? css('--hover') : '#d0443e', ax === 'X' ? 2.5 : 1, ax !== 'X', false)));
          sketchGroup.add(V.segs([...toWorld(fr, 0, -half), ...toWorld(fr, 0, half)], V.lineMat(ax === 'Y' ? css('--hover') : '#3fa34d', ax === 'Y' ? 2.5 : 1, ax !== 'Y', false)));
          P([...toWorld(fr, 0, 0)], css('--sk-ref'), 7);
        } else if (dots.length) {
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3));
          sketchGroup.add(new THREE.Points(g, new THREE.PointsMaterial({ color: css('--sketch-idle'), size: 5 * dpr(), sizeAttenuation: false })));
        }
      }
      if (!s.sketchId) state.frame = null;
      buildPlanes(s);
      buildDims(s);
      buildPreview(s);
      updateLabels();
      V.request();
    };

    const buildPlanes = (s: State) => {
      V.clearGroup(originGroup);
      const size = Math.max(80, V.bbox.getSize(new THREE.Vector3()).length() * 0.45);
      const quad = (fr: Frame, key: string, show: boolean, label: string) => {
        if (!show) return;
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => tv(toWorld(fr, (u * size) / 2, (v * size) / 2)));
        const geo = new THREE.BufferGeometry().setFromPoints([corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]]);
        const hov = state.hoverPlane === key;
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: css(hov ? '--accent' : '--plane'), transparent: true, opacity: hov ? 0.35 : 0.14, side: THREE.DoubleSide, depthWrite: false }));
        mesh.userData.plane = key; mesh.userData.label = label;
        originGroup.add(mesh);
        const border: number[] = [];
        for (let i = 0; i < 4; i++) border.push(...corners[i].toArray(), ...corners[(i + 1) % 4].toArray());
        originGroup.add(V.segs(border, V.lineMat(css(hov ? '--accent' : '--plane'), hov ? 2 : 1, false, true)));
      };
      (['XY', 'XZ', 'YZ'] as StdPlane[]).forEach((name) => {
        const p = PLANE_STD[name];
        quad({ origin: [0, 0, 0], xDir: p.xDir, normal: p.normal, yDir: v3.cross(p.normal, p.xDir) }, name, s.tool === 'pickPlane' || s.tool === 'pickWorkBase', `Plano ${name}`);
      });
      for (const f of s.doc.features) {
        if (f.type === 'workplane' && !f.suppressed) {
          const fr = state.work.get(f.id);
          if (fr && s.mode !== 'sketch') quad(fr, 'work:' + f.id, true, f.name);
        }
        if ((f.type === 'workaxis' || f.type === 'workpoint') && !f.suppressed && s.mode !== 'sketch') {
          try {
            const ev = safeEval(s);
            if (f.type === 'workaxis') {
              const o = f.origin.map(ev) as V3, d = v3.norm(f.dir.map(ev) as V3), L = size * 0.6;
              originGroup.add(V.segs([...v3.add(o, v3.mul(d, -L)), ...v3.add(o, v3.mul(d, L))], V.lineMat(css('--plane'), 1.5, true, true)));
            } else {
              const o = f.origin.map(ev) as V3;
              const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(o, 3));
              originGroup.add(new THREE.Points(g, new THREE.PointsMaterial({ color: css('--plane'), size: 9 * dpr(), sizeAttenuation: false })));
            }
          } catch { /* expresión inválida */ }
        }
      }
    };

    // ---------- Cotas y restricciones (gráficos) ----------
    const dimPrims = (sk: SketchF, ev: Ev, c: SkConstraint): { lines: V2[][]; arrows: [V2, V2][]; text: V2 } | null => {
      const wpp = V.worldPerPx(), ext = wpp * 6, ah = wpp * 9;
      const pos = c.pos ?? [0, 0];
      const arrowsAt = (A: V2, B: V2): [V2, V2][] => { const d = dist2(A, B) || 1; const u: V2 = [(B[0] - A[0]) / d, (B[1] - A[1]) / d]; return [[A, u], [B, [-u[0], -u[1]]]]; };
      const aligned = (A: V2, B: V2): { lines: V2[][]; arrows: [V2, V2][]; text: V2 } => {
        const d = dist2(A, B) || 1e-9, u: V2 = [(B[0] - A[0]) / d, (B[1] - A[1]) / d], n: V2 = [-u[1], u[0]];
        const o = (pos[0] - A[0]) * n[0] + (pos[1] - A[1]) * n[1], s = Math.sign(o) || 1;
        const A2: V2 = [A[0] + n[0] * o, A[1] + n[1] * o], B2: V2 = [B[0] + n[0] * o, B[1] + n[1] * o];
        return { lines: [[A, [A2[0] + n[0] * ext * s, A2[1] + n[1] * ext * s]], [B, [B2[0] + n[0] * ext * s, B2[1] + n[1] * ext * s]], [A2, B2]], arrows: arrowsAt(A2, B2), text: pos };
      };
      try {
        switch (c.kind) {
          case 'len': { const L = refLine(sk, c.a, ev)!; return aligned(L[0], L[1]); }
          case 'dist': {
            if (refKind(sk, c.a) === 'line') { const L = refLine(sk, c.a, ev)!; return aligned(L[0], L[1]); }
            return aligned(refPoint(sk, c.a, ev)!, refPoint(sk, c.b!, ev)!);
          }
          case 'hdist': case 'vdist': {
            const A = refPoint(sk, c.a, ev)!, B = refPoint(sk, c.b!, ev)!;
            if (c.kind === 'hdist') {
              const y = pos[1], A2: V2 = [A[0], y], B2: V2 = [B[0], y], s = (k: V2) => Math.sign(y - k[1]) || 1;
              return { lines: [[A, [A[0], y + ext * s(A)]], [B, [B[0], y + ext * s(B)]], [A2, B2]], arrows: arrowsAt(A2, B2), text: pos };
            }
            const x = pos[0], A2: V2 = [x, A[1]], B2: V2 = [x, B[1]], s = (k: V2) => Math.sign(x - k[0]) || 1;
            return { lines: [[A, [x + ext * s(A), A[1]]], [B, [x + ext * s(B), B[1]]], [A2, B2]], arrows: arrowsAt(A2, B2), text: pos };
          }
          case 'pldist': case 'lldist': {
            const P = c.kind === 'pldist' ? refPoint(sk, c.a, ev)! : refLine(sk, c.a, ev)![0];
            const L = refLine(sk, c.b!, ev)!; const d = [L[1][0] - L[0][0], L[1][1] - L[0][1]], dl = Math.hypot(d[0], d[1]) || 1;
            const t = ((P[0] - L[0][0]) * d[0] + (P[1] - L[0][1]) * d[1]) / (dl * dl);
            const F: V2 = [L[0][0] + d[0] * t, L[0][1] + d[1] * t];
            return { lines: [[P, F]], arrows: arrowsAt(P, F), text: pos };
          }
          case 'radius': case 'diameter': {
            const C = refCurve(sk, c.a, ev)!; const dir = [pos[0] - C.c[0], pos[1] - C.c[1]], dl = Math.hypot(dir[0], dir[1]) || 1;
            const u: V2 = [dir[0] / dl, dir[1] / dl], E: V2 = [C.c[0] + u[0] * C.r, C.c[1] + u[1] * C.r];
            if (c.kind === 'radius') return { lines: [[C.c, E], [E, pos]], arrows: [[E, [-u[0], -u[1]]]], text: pos };
            const E2: V2 = [C.c[0] - u[0] * C.r, C.c[1] - u[1] * C.r];
            return { lines: [[E2, E], [E, pos]], arrows: [[E, [-u[0], -u[1]]], [E2, u]], text: pos };
          }
          case 'angle': {
            const L1 = refLine(sk, c.a, ev)!, L2 = refLine(sk, c.b!, ev)!;
            const d1 = [L1[1][0] - L1[0][0], L1[1][1] - L1[0][1]], d2 = [L2[1][0] - L2[0][0], L2[1][1] - L2[0][1]];
            const den = d1[0] * d2[1] - d1[1] * d2[0];
            let X: V2 = L1[0];
            if (Math.abs(den) > 1e-12) { const t = ((L2[0][0] - L1[0][0]) * d2[1] - (L2[0][1] - L1[0][1]) * d2[0]) / den; X = [L1[0][0] + d1[0] * t, L1[0][1] + d1[1] * t]; }
            const R = dist2(pos, X) || wpp * 40;
            const a1 = Math.atan2(d1[1], d1[0]); let a2 = a1 + (c.sense ?? 1) * ev(c.expr ?? '0') * D2R;
            const ap = Math.atan2(pos[1] - X[1], pos[0] - X[0]);
            // elegir el cuadrante que contiene la etiqueta
            const inSweep = (a0: number, sw: number, a: number) => { let x = (a - a0) * Math.sign(sw); while (x < 0) x += 2 * Math.PI; while (x > 2 * Math.PI) x -= 2 * Math.PI; return x <= Math.abs(sw); };
            let s0 = a1, sw = a2 - a1;
            if (!inSweep(s0, sw, ap)) { s0 = a1 + Math.PI; a2 = s0 + sw; if (!inSweep(s0, sw, ap)) { s0 = a1; sw = -(2 * Math.PI - Math.abs(sw)) * Math.sign(sw); } }
            const arc: V2[] = []; for (let i = 0; i <= 32; i++) { const a = s0 + (sw * i) / 32; arc.push([X[0] + R * Math.cos(a), X[1] + R * Math.sin(a)]); }
            return { lines: [arc], arrows: [], text: pos };
          }
        }
      } catch { return null; }
      return null;
    };
    const buildDims = (s: State) => {
      V.clearGroup(dimGroup);
      const sk = activeSketch(s), fr = state.frame;
      if (!sk || !fr || s.mode !== 'sketch') { V.request(); return; }
      const ev = safeEval(s), W = (p: V2) => toWorld(fr, p[0], p[1]);
      const norm: number[] = [], sel: number[] = [], drv: number[] = [];
      const wpp = V.worldPerPx();
      for (const c of sk.constraints ?? []) {
        if (c.type !== 'dim') continue;
        const g = dimPrims(sk, ev, c); if (!g) continue;
        const tgt = c.id === s.selCon ? sel : c.driven ? drv : norm;
        for (const l of g.lines) for (let i = 0; i + 1 < l.length; i++) tgt.push(...W(l[i]), ...W(l[i + 1]));
        for (const [P, u] of g.arrows) {
          const L = wpp * 9, w = wpp * 3, n: V2 = [-u[1], u[0]];
          const b: V2 = [P[0] + u[0] * L, P[1] + u[1] * L];
          tgt.push(...W(P), ...W([b[0] + n[0] * w, b[1] + n[1] * w]), ...W(P), ...W([b[0] - n[0] * w, b[1] - n[1] * w]));
        }
      }
      if (norm.length) dimGroup.add(V.segs(norm, V.lineMat(css('--sk-dim'), 1.2, false, false)));
      if (drv.length) dimGroup.add(V.segs(drv, V.lineMat(css('--sk-dim'), 1, true, false)));
      if (sel.length) dimGroup.add(V.segs(sel, V.lineMat(css('--accent'), 2, false, false)));
      V.request();
    };

    const conAnchor = (sk: SketchF, ev: Ev, r: GRef): V2 | null => {
      const k = refKind(sk, r);
      if (k === 'point') return refPoint(sk, r, ev);
      if (k === 'line') { if (r.e === 'X') return [V.worldPerPx() * 60, 0]; if (r.e === 'Y') return [0, V.worldPerPx() * 60]; const L = refLine(sk, r, ev); return L ? [(L[0][0] + L[1][0]) / 2, (L[0][1] + L[1][1]) / 2] : null; }
      if (k === 'curve') { const C = refCurve(sk, r, ev); return C ? [C.c[0], C.c[1] + C.r] : null; }
      return null;
    };
    const updateLabels = () => {
      const s = useStore.getState();
      const sk = activeSketch(s);
      if (!sk || s.mode !== 'sketch' || !state.frame) { setDims((l) => (l.length ? [] : l)); setGlyphs((l) => (l.length ? [] : l)); return; }
      const ev = safeEval(s), fr = state.frame;
      const scr = (p: V2) => V.project(toWorld(fr, p[0], p[1]));
      const out: DimLabel[] = [];
      for (const c of sk.constraints ?? []) {
        if (c.type !== 'dim' || !c.pos) continue;
        const q = scr(c.pos), val = c.driven ? dimValue(sk, ev, c) : ev(c.expr ?? '0');
        const pre = c.kind === 'diameter' ? 'Ø' : c.kind === 'radius' ? 'R' : '';
        const unit = c.kind === 'angle' ? '°' : '';
        const txt = `${pre}${fmt(val, 2)}${unit}`;
        out.push({ id: c.id, x: q.x, y: q.y, text: c.driven ? `(${txt})` : txt, expr: c.expr ?? '', fx: !c.driven && !isLiteral(c.expr ?? ''), driven: !!c.driven, sel: c.id === s.selCon });
      }
      setDims(out);
      const gl: Glyph[] = [];
      if (s.showCons) {
        const stack = new Map<string, number>();
        const showFor = new Set([...s.selEntities, s.selEntity ?? '']);
        for (const c of sk.constraints ?? []) {
          if (c.type === 'dim') continue;
          if (c.type === 'coincident' && !showFor.has(c.a.e) && !showFor.has(c.b?.e ?? '') && c.id !== s.selCon) continue;
          const a = conAnchor(sk, ev, c.type === 'symmetric' ? c.c! : c.a); if (!a) continue;
          const q = scr(a), key = `${Math.round(q.x / 20)},${Math.round(q.y / 20)}`, n = stack.get(key) ?? 0; stack.set(key, n + 1);
          gl.push({ id: c.id, x: q.x + 12 + n * 17, y: q.y - 12, g: CONSTRAINT_GLYPH[c.type], title: CONSTRAINT_NAMES[c.type], sel: c.id === s.selCon });
        }
      }
      setGlyphs(gl);
    };

    // ---------- Vista previa de la herramienta ----------
    const buildPreview = (s: State) => {
      V.clearGroup(previewObj);
      const fr = state.frame, hs = state.hover;
      snapMarker.visible = false;
      if (!fr || s.mode !== 'sketch') { V.request(); return; }
      const W = (p: V2) => toWorld(fr, p[0], p[1]);
      const pts: number[] = [], aux: number[] = [];
      if (hs && (hs.ref || hs.mid || hs.on)) { snapMarker.visible = true; snapMarker.position.copy(tv(W(hs.p))); (snapMarker.material as THREE.MeshBasicMaterial).color.set(hs.mid ? 0x3fa34d : hs.on ? 0x1d6fb0 : 0xf2b600); }
      const h = hs?.p;
      const c = state.clicks.map((x) => x.p);
      const loop = (ps: V2[], closed = true, arr = pts) => { for (let i = 0; i < ps.length - (closed ? 0 : 1); i++) arr.push(...W(ps[i]), ...W(ps[(i + 1) % ps.length])); };
      const circ = (cx: V2, r: number, n = 72, rot = 0) => { const ps: V2[] = []; for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; ps.push([cx[0] + r * Math.cos(a), cx[1] + r * Math.sin(a)]); } return ps; };
      const t = s.tool;
      if (h && t) {
        if (t === 'line' && state.chain.length) pts.push(...W(state.chain[state.chain.length - 1].p), ...W(h));
        if (t === 'rect' && c.length === 1) loop([c[0], [h[0], c[0][1]], h, [c[0][0], h[1]]]);
        if (t === 'rectc' && c.length === 1) { const d = [h[0] - c[0][0], h[1] - c[0][1]]; loop([[c[0][0] - d[0], c[0][1] - d[1]], [h[0], c[0][1] - d[1]], h, [c[0][0] - d[0], h[1]]]); }
        if (t === 'rect3') {
          if (c.length === 1) pts.push(...W(c[0]), ...W(h));
          if (c.length === 2) { const u = [c[1][0] - c[0][0], c[1][1] - c[0][1]], ul = Math.hypot(u[0], u[1]) || 1, n = [-u[1] / ul, u[0] / ul]; const o = (h[0] - c[1][0]) * n[0] + (h[1] - c[1][1]) * n[1]; loop([c[0], c[1], [c[1][0] + n[0] * o, c[1][1] + n[1] * o], [c[0][0] + n[0] * o, c[0][1] + n[1] * o]]); }
        }
        if ((t === 'circle' || t === 'npoly') && c.length === 1) {
          const r = dist2(h, c[0]);
          loop(circ(c[0], r, t === 'circle' ? 72 : 6, t === 'npoly' ? Math.atan2(h[1] - c[0][1], h[0] - c[0][0]) : 0));
          aux.push(...W(c[0]), ...W(h));
        }
        if (t === 'circle3' && c.length >= 1) { if (c.length === 1) pts.push(...W(c[0]), ...W(h)); else { const C = circleFrom3(c[0], c[1], h); if (C) loop(circ(C.c, C.r)); } }
        if (t === 'arc' && c.length >= 1) {
          const r = dist2(c[1] ?? h, c[0]);
          if (c.length === 1) aux.push(...W(c[0]), ...W(h));
          else {
            const a0 = Math.atan2(c[1][1] - c[0][1], c[1][0] - c[0][0]); let a1 = Math.atan2(h[1] - c[0][1], h[0] - c[0][0]);
            while (a1 <= a0) a1 += Math.PI * 2;
            const ps: V2[] = []; for (let i = 0; i <= 48; i++) { const a = a0 + ((a1 - a0) * i) / 48; ps.push([c[0][0] + r * Math.cos(a), c[0][1] + r * Math.sin(a)]); }
            loop(ps, false);
          }
        }
        if (t === 'arc3' && c.length >= 1) {
          if (c.length === 1) aux.push(...W(c[0]), ...W(h));
          else { const ps = arc3Points(c[0], c[1], h); if (ps) loop(ps, false); else pts.push(...W(c[0]), ...W(c[1])); }
        }
        if (t === 'arctan' && c.length === 1) { const a = tangentArc(s, c[0], h); if (a) loop(a.pts, false); }
        if (t === 'slot' && c.length >= 1) {
          if (c.length === 1) aux.push(...W(c[0]), ...W(h));
          else {
            const a = c[0], b = c[1], L = dist2(a, b) || 1;
            const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
            const w = Math.abs((h[0] - a[0]) * nx + (h[1] - a[1]) * ny) * 2;
            loop([[a[0] + nx * w / 2, a[1] + ny * w / 2], [b[0] + nx * w / 2, b[1] + ny * w / 2], [b[0] - nx * w / 2, b[1] - ny * w / 2], [a[0] - nx * w / 2, a[1] - ny * w / 2]]);
          }
        }
        if (t === 'ellipse' && c.length >= 1) {
          if (c.length === 1) aux.push(...W(c[0]), ...W(h));
          else {
            const rx = dist2(c[1], c[0]), rot = Math.atan2(c[1][1] - c[0][1], c[1][0] - c[0][0]);
            const ry = Math.abs(-(h[0] - c[0][0]) * Math.sin(rot) + (h[1] - c[0][1]) * Math.cos(rot)) || rx * 0.5;
            const ps: V2[] = []; for (let i = 0; i < 72; i++) { const a = (i / 72) * Math.PI * 2, x = rx * Math.cos(a), y = ry * Math.sin(a); ps.push([c[0][0] + x * Math.cos(rot) - y * Math.sin(rot), c[0][1] + x * Math.sin(rot) + y * Math.cos(rot)]); }
            loop(ps);
          }
        }
        if (t === 'spline' && c.length >= 1) {
          const P = [...c, h];
          if (P.length >= 2) { const out: V2[] = []; for (let i = 0; i < P.length - 1; i++) out.push(P[i]); out.push(h); loop(splineLocal(P), false); }
        }
      }
      if (state.picks.length && (t === 'skdim' || t === 'constrain')) {
        const sk = activeSketch(s);
        if (sk) for (const pk of state.picks) highlightPick(sk, safeEval(s), pk, pts);
      }
      if (pts.length) previewObj.add(V.segs(pts, V.lineMat(css('--accent'), 2, false, false)));
      if (aux.length) previewObj.add(V.segs(aux, V.lineMat(css('--accent'), 1, true, false)));
      V.request();
    };
    const highlightPick = (sk: SketchF, ev: Ev, pk: Pick, out: number[]) => {
      const fr = state.frame!; const W = (p: V2) => toWorld(fr, p[0], p[1]);
      if (pk.kind === 'point') { const r = V.worldPerPx() * 5, p = pk.p; out.push(...W([p[0] - r, p[1]]), ...W([p[0] + r, p[1]]), ...W([p[0], p[1] - r]), ...W([p[0], p[1] + r])); return; }
      if (pk.kind === 'line') { const L = refLine(sk, pk.ref, ev); if (L) out.push(...W(L[0]), ...W(L[1])); return; }
      const e = sk.entities.find((x) => x.id === pk.ref.e); if (!e) return;
      const o = entityOutline(e, ev); for (let i = 0; i < o.pts.length - (o.closed ? 0 : 1); i++) out.push(...W(o.pts[i]), ...W(o.pts[(i + 1) % o.pts.length]));
    };
    const splineLocal = (P: V2[]): V2[] => {
      const out: V2[] = [];
      const n = P.length, at = (i: number) => P[Math.max(0, Math.min(n - 1, i))];
      for (let i = 0; i < n - 1; i++) {
        const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        const b: V2 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], cc: V2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        for (let k = i === 0 ? 0 : 1; k <= 12; k++) { const t = k / 12, u = 1 - t; out.push([u * u * u * p1[0] + 3 * u * u * t * b[0] + 3 * u * t * t * cc[0] + t * t * t * p2[0], u * u * u * p1[1] + 3 * u * u * t * b[1] + 3 * u * t * t * cc[1] + t * t * t * p2[1]]); }
      }
      return out;
    };
    const arc3Points = (a: V2, b: V2, m: V2): V2[] | null => {
      const C = circleFrom3(a, m, b); if (!C) return null;
      const ang = (p: V2) => Math.atan2(p[1] - C.c[1], p[0] - C.c[0]);
      const t0 = ang(a), norm = (t: number) => { while (t < t0) t += 2 * Math.PI; while (t >= t0 + 2 * Math.PI) t -= 2 * Math.PI; return t; };
      const ccw = norm(ang(m)) < norm(ang(b));
      const sw = ccw ? norm(ang(b)) - t0 : -(2 * Math.PI - (norm(ang(b)) - t0));
      const out: V2[] = []; for (let i = 0; i <= 48; i++) { const t = t0 + (sw * i) / 48; out.push([C.c[0] + C.r * Math.cos(t), C.c[1] + C.r * Math.sin(t)]); }
      return out;
    };
    /** Arco tangente al final de una línea (start debe ser un extremo de línea). */
    const tangentArc = (s: State, start: V2, end: V2) => {
      const sk = activeSketch(s); if (!sk) return null;
      const ev = safeEval(s);
      let tan: V2 | null = null, ref: GRef | null = null, line = '';
      for (const e of sk.entities) {
        if (e.type !== 'line') continue;
        const g = entG(e, ev), A = pointOf(e, 'a', g), B = pointOf(e, 'b', g);
        if (dist2(A, start) < 1e-6) { tan = [A[0] - B[0], A[1] - B[1]]; ref = { e: e.id, k: 'a' }; line = e.id; break; }
        if (dist2(B, start) < 1e-6) { tan = [B[0] - A[0], B[1] - A[1]]; ref = { e: e.id, k: 'b' }; line = e.id; break; }
      }
      if (!tan) return null;
      const tl = Math.hypot(tan[0], tan[1]); tan = [tan[0] / tl, tan[1] / tl];
      const n: V2 = [-tan[1], tan[0]], q: V2 = [end[0] - start[0], end[1] - start[1]];
      const den = 2 * (n[0] * q[0] + n[1] * q[1]); if (Math.abs(den) < 1e-9) return null;
      const sd = (q[0] * q[0] + q[1] * q[1]) / den, C: V2 = [start[0] + n[0] * sd, start[1] + n[1] * sd], r = Math.abs(sd);
      const a0 = Math.atan2(start[1] - C[1], start[0] - C[0]), a1 = Math.atan2(end[1] - C[1], end[0] - C[0]);
      const ccw = sd > 0; // giro a la izquierda
      let sw = a1 - a0; if (ccw) { while (sw <= 0) sw += 2 * Math.PI; } else { while (sw >= 0) sw -= 2 * Math.PI; }
      const pts: V2[] = []; for (let i = 0; i <= 48; i++) { const a = a0 + (sw * i) / 48; pts.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]); }
      return { C, r, a0: a0 / D2R, a1: a1 / D2R, ccw, pts, ref: ref!, line };
    };

    // ---------- Selección en el boceto ----------
    const toLocal = (ev: { clientX: number; clientY: number }): V2 | null => {
      const fr = state.frame; if (!fr) return null;
      const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(tv(fr.normal), tv(fr.origin));
      const hit = V.ray(ev).ray.intersectPlane(pl, new THREE.Vector3());
      if (!hit) return null;
      const d = hit.sub(tv(fr.origin));
      return [d.dot(tv(fr.xDir)), d.dot(tv(fr.yDir))];
    };
    const screenOfLocal = (p: V2) => V.project(toWorld(state.frame!, p[0], p[1]));
    api.current = {
      screenOf: (p) => (state.frame ? screenOfLocal(p) : { x: 0, y: 0 }),
      startLabelDrag: (id, e) => {
        const s = useStore.getState();
        state.labelDrag = { id, base: s.doc, moved: false };
        e.stopPropagation();
        const mv = (ev: PointerEvent) => {
          const ld = state.labelDrag; if (!ld) return;
          const p = toLocal(ev); if (!p) return;
          ld.moved = true;
          const st = useStore.getState(), sid = st.sketchId;
          const doc = structuredClone(st.doc);
          const sk = doc.features.find((f) => f.id === sid) as SketchF;
          const c = sk.constraints?.find((x) => x.id === id); if (c) c.pos = [Number(p[0].toFixed(3)), Number(p[1].toFixed(3))];
          useStore.setState({ doc });
        };
        const up = () => {
          window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
          const ld = state.labelDrag; state.labelDrag = null;
          if (ld?.moved) { const st = useStore.getState(); useStore.setState({ past: [...st.past.slice(-99), ld.base], future: [], dirty: true }); }
        };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      },
    };

    const pickAt = (ev: { clientX: number; clientY: number }, want: 'any' | 'point' | 'line' | 'curve' | 'linecurve' | 'nopoint' = 'any'): Pick | null => {
      const s = useStore.getState(); const sk = activeSketch(s); if (!sk || !state.frame) return null;
      const evl = safeEval(s), m = V.local(ev);
      const sd = (p: V2) => { const q = screenOfLocal(p); return Math.hypot(q.x - m.x, q.y - m.y); };
      const local = toLocal(ev);
      if (want === 'any' || want === 'point') {
        let best: Pick | null = null, bd = 9;
        for (const q of sketchPoints(sk, evl)) { const d = sd(q.p); if (d < bd) { bd = d; best = { kind: 'point', ref: q.ref, p: q.p }; } }
        if (best || want === 'point') return best;
      }
      let best: Pick | null = null, bd = 7;
      const segPx = (a: V2, b: V2) => { const A = screenOfLocal(a), B = screenOfLocal(b); return distToSeg([m.x, m.y], [A.x, A.y], [B.x, B.y]); };
      for (const e of sk.entities) {
        const g = entG(e, evl);
        if (want !== 'curve') for (const k of segKeys(e)) {
          const [a, b] = segOf(e, k, g); const d = segPx(a, b);
          if (d < bd) { bd = d; best = { kind: 'line', ref: k ? { e: e.id, k } : { e: e.id }, p: local ?? a }; }
        }
        if (want !== 'line' && (e.type === 'circle' || e.type === 'arc')) {
          const o = entityOutline(e, evl);
          for (let i = 0; i < o.pts.length - (o.closed ? 0 : 1); i++) { const d = segPx(o.pts[i], o.pts[(i + 1) % o.pts.length]); if (d < bd) { bd = d; best = { kind: 'curve', ref: { e: e.id }, p: local ?? o.pts[i] }; } }
        }
        if (want === 'any' && !segKeys(e).length && !(e.type === 'circle' || e.type === 'arc')) {
          const o = entityOutline(e, evl);
          if (o.pts.length === 1) { const d = sd(o.pts[0]); if (d < bd) { bd = d; best = { kind: 'entity', ref: { e: e.id }, p: o.pts[0] }; } }
          for (let i = 0; i < o.pts.length - (o.closed ? 0 : 1); i++) { const d = segPx(o.pts[i], o.pts[(i + 1) % o.pts.length]); if (d < bd) { bd = d; best = { kind: 'entity', ref: { e: e.id }, p: local ?? o.pts[i] }; } }
        }
      }
      if (!best && want !== 'curve' && local) {
        // ejes del boceto
        const ax = Math.abs(screenOfLocal([local[0], 0]).y - m.y), ay = Math.abs(screenOfLocal([0, local[1]]).x - m.x);
        if (ax < 6) best = { kind: 'line', ref: { e: 'X' }, p: [local[0], 0] };
        else if (ay < 6) best = { kind: 'line', ref: { e: 'Y' }, p: [0, local[1]] };
      }
      return best;
    };

    /** Forzado de cursor para las herramientas de dibujo: puntos, punto medio, sobre curva y alineación H/V. */
    const snap = (ev: { clientX: number; clientY: number }, raw: V2, from?: V2): Snap => {
      const s = useStore.getState(); const sk = activeSketch(s);
      const m = V.local(ev);
      const sd = (p: V2) => { const q = screenOfLocal(p); return Math.hypot(q.x - m.x, q.y - m.y); };
      if (sk) {
        const evl = safeEval(s);
        let best: Snap | null = null, bd = 10;
        for (const q of sketchPoints(sk, evl)) { const d = sd(q.p); if (d < bd) { bd = d; best = { p: q.p, ref: q.ref }; } }
        // puntos de la cadena en curso (aún sin restricciones)
        for (const c of [...state.chain.map((x) => x.p), ...state.clicks.map((x) => x.p)]) { const d = sd(c); if (d < bd) { bd = d; best = { p: c }; } }
        if (best) return best;
        // punto medio de líneas
        for (const e of sk.entities) for (const k of segKeys(e)) {
          const [a, b] = segOf(e, k, entG(e, evl)), mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const d = sd(mid); if (d < bd) { bd = d; best = { p: mid, mid: k ? { e: e.id, k } : { e: e.id } }; }
        }
        if (best) return best;
        // sobre una línea o circunferencia
        const pk = pickAt(ev, 'nopoint');
        if (pk && (pk.kind === 'line' || pk.kind === 'curve') && pk.ref.e !== 'X' && pk.ref.e !== 'Y') {
          if (pk.kind === 'line') { const L = refLine(sk, pk.ref, evl)!; const d = [L[1][0] - L[0][0], L[1][1] - L[0][1]], t = ((raw[0] - L[0][0]) * d[0] + (raw[1] - L[0][1]) * d[1]) / (d[0] ** 2 + d[1] ** 2 || 1); return { p: [L[0][0] + d[0] * t, L[0][1] + d[1] * t], on: pk.ref }; }
          const C = refCurve(sk, pk.ref, evl)!; const a = Math.atan2(raw[1] - C.c[1], raw[0] - C.c[0]); return { p: [C.c[0] + C.r * Math.cos(a), C.c[1] + C.r * Math.sin(a)], on: pk.ref };
        }
      }
      const step = niceStep(V.worldPerPx());
      let p: V2 = [Math.round(raw[0] / step) * step, Math.round(raw[1] / step) * step];
      let hv: 'h' | 'v' | undefined;
      if (from) {
        const tol = V.worldPerPx() * 8;
        if (Math.abs(raw[1] - from[1]) < tol) { p = [p[0], from[1]]; hv = 'h'; }
        else if (Math.abs(raw[0] - from[0]) < tol) { p = [from[0], p[1]]; hv = 'v'; }
      }
      return { p, hv };
    };

    /** Restricciones de un punto nuevo según el forzado. */
    const snapCons = (sn: Snap, ref: GRef): SkConstraint[] => {
      const out: SkConstraint[] = [];
      if (sn.ref) out.push({ id: uid('k'), type: 'coincident', a: ref, b: sn.ref });
      else if (sn.mid) out.push({ id: uid('k'), type: 'midpoint', a: ref, b: sn.mid });
      else if (sn.on) out.push({ id: uid('k'), type: 'onobject', a: ref, b: sn.on });
      return out;
    };
    const addGeom = (ents: SkEntity[], cons: SkConstraint[], sel?: string) => {
      const s = useStore.getState();
      const ok = s.sketchCommit((sk) => { sk.entities.push(...ents); (sk.constraints ??= []).push(...cons); });
      if (ok) useStore.setState({ selEntity: sel ?? ents[ents.length - 1]?.id ?? null, selEntities: [] });
      return ok;
    };
    const P2 = (p: V2): [string, string] => [r3(p[0]), r3(p[1])];

    const commitLine = (from: { p: V2; snap: Snap }, to: Snap, prevId: string | null) => {
      const id = uid('l');
      const cons: SkConstraint[] = [];
      if (prevId) cons.push({ id: uid('k'), type: 'coincident', a: { e: prevId, k: 'b' }, b: { e: id, k: 'a' } });
      else cons.push(...snapCons(from.snap, { e: id, k: 'a' }));
      // cierre de la cadena sobre su primer punto
      const first = state.chain[0];
      const closing = state.chainIds.length >= 2 && dist2(to.p, first.p) < 1e-9;
      if (closing) cons.push({ id: uid('k'), type: 'coincident', a: { e: id, k: 'b' }, b: { e: state.chainIds[0], k: 'a' } });
      else cons.push(...snapCons(to, { e: id, k: 'b' }));
      if (to.hv === 'h' || (Math.abs(to.p[1] - from.p[1]) < 1e-9 && Math.abs(to.p[0] - from.p[0]) > 1e-9)) cons.push({ id: uid('k'), type: 'horizontal', a: { e: id } });
      else if (to.hv === 'v' || (Math.abs(to.p[0] - from.p[0]) < 1e-9 && Math.abs(to.p[1] - from.p[1]) > 1e-9)) cons.push({ id: uid('k'), type: 'vertical', a: { e: id } });
      const ok = addGeom([{ id, type: 'line', a: P2(from.p), b: P2(to.p) }], cons);
      return ok ? { id, closing } : null;
    };

    // ---------- Arrastre de geometría ----------
    const dragTo = (p: V2) => {
      const dr = state.drag; if (!dr) return;
      dr.last = p;
      if (dr.raf) return;
      dr.raf = requestAnimationFrame(() => {
        dr.raf = 0;
        const s = useStore.getState(); const sid = s.sketchId; const tgt = dr.last!;
        const doc = structuredClone(dr.base);
        const sk = doc.features.find((f) => f.id === sid) as SketchF;
        const ev = safeEval({ ...s, doc } as State);
        const e = sk.entities.find((x) => x.id === dr.ref.e); if (!e) return;
        const drag: { e: string; path: string; target: number }[] = [];
        const fieldsOfPoint = (k: string): [string, string] | null => {
          switch (e.type) {
            case 'line': return k === 'a' ? ['a.0', 'a.1'] : k === 'b' ? ['b.0', 'b.1'] : null;
            case 'poly': case 'spline': { const i = parseInt(k.slice(1), 10); return [`pts.${i}.0`, `pts.${i}.1`]; }
            case 'slot': return k === 'c2' ? ['x2', 'y2'] : ['x1', 'y1'];
            case 'rect': return k === 'p0' ? ['x', 'y'] : null;
            case 'text': return ['x', 'y'];
            default: return k === 'c' ? ['cx', 'cy'] : null;
          }
        };
        if (dr.kind === 'point') {
          const fp = fieldsOfPoint(dr.ref.k ?? 'c');
          if (fp) { drag.push({ e: e.id, path: fp[0], target: tgt[0] }, { e: e.id, path: fp[1], target: tgt[1] }); }
          else if (e.type === 'rect') {
            const g = entG(e, ev), k = dr.ref.k!;
            const x = g('x'), y = g('y'), w = g('w'), h = g('h');
            if (k === 'p2') drag.push({ e: e.id, path: 'w', target: tgt[0] - x }, { e: e.id, path: 'h', target: tgt[1] - y });
            if (k === 'p1') drag.push({ e: e.id, path: 'w', target: tgt[0] - x }, { e: e.id, path: 'y', target: tgt[1] }, { e: e.id, path: 'h', target: y + h - tgt[1] });
            if (k === 'p3') drag.push({ e: e.id, path: 'x', target: tgt[0] }, { e: e.id, path: 'w', target: x + w - tgt[0] }, { e: e.id, path: 'h', target: tgt[1] - y });
            if (k === 'c') drag.push({ e: e.id, path: 'x', target: tgt[0] - w / 2 }, { e: e.id, path: 'y', target: tgt[1] - h / 2 });
          } else if (e.type === 'arc' && (dr.ref.k === 's' || dr.ref.k === 'e')) {
            const g = entG(e, ev), a = Math.atan2(tgt[1] - g('cy'), tgt[0] - g('cx')) / D2R;
            drag.push({ e: e.id, path: dr.ref.k === 's' ? 'a0' : 'a1', target: a }, { e: e.id, path: 'r', target: dist2(tgt, [g('cx'), g('cy')]) });
          }
        } else if (dr.kind === 'line') {
          const d: V2 = [tgt[0] - dr.start[0], tgt[1] - dr.start[1]];
          if (e.type === 'line') { const g = entG(e, ev); for (const [k, i] of [['a', 0], ['b', 1]] as const) { void i; const P = pointOf(e, k, g); drag.push({ e: e.id, path: `${k}.0`, target: P[0] + d[0] }, { e: e.id, path: `${k}.1`, target: P[1] + d[1] }); } }
          else if (e.type === 'rect') { const g = entG(e, ev); drag.push({ e: e.id, path: 'x', target: g('x') + d[0] }, { e: e.id, path: 'y', target: g('y') + d[1] }); }
        } else if (dr.kind === 'circle') {
          const g = entG(e, ev), c: V2 = [g('cx'), g('cy')];
          if (e.type === 'circle') drag.push({ e: e.id, path: 'd', target: 2 * dist2(tgt, c) });
          if (e.type === 'arc') drag.push({ e: e.id, path: 'r', target: dist2(tgt, c) });
        }
        if (!drag.length) return;
        const res = solve(sk, ev, { drag, analyse: false, maxIt: 25 });
        if (!res.ok && sk.constraints?.length) return;
        applySolution(sk, res);
        dr.moved = true;
        useStore.setState({ doc });
      });
    };

    // ---------- Interacción ----------
    const occluders = () => (state.partMesh ? [state.partMesh] : []);
    const hitPlane = (ev: MouseEvent): { key: string; dist: number } | null => {
      const hits = V.ray(ev).intersectObjects(originGroup.children.filter((c) => c.userData.plane));
      return hits[0] ? { key: hits[0].object.userData.plane, dist: hits[0].distance } : null;
    };
    const faceHit = (ev: MouseEvent) => {
      const m = pickMesh(); if (!m || !state.partMesh) return null;
      let target = state.partMesh;
      if (m !== state.mesh) {
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(m.vertices, 3)); g.setIndex(new THREE.BufferAttribute(m.triangles, 1));
        target = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
      }
      const hit = V.ray(ev).intersectObject(target)[0];
      if (!hit || hit.faceIndex == null) return null;
      const pf = planarFaceAt(m, hit.faceIndex);
      return pf ? { ...pf, point: hit.point.clone(), distance: hit.distance, mesh: m } : null;
    };

    /** Pestaña de chapa: arista recta + sus dos caras planas (la delgada da la dirección hacia fuera). */
    const flangeEdgeFrom = (gi: number) => {
      const m = pickMesh()!, a = groupPts(gi);
      const p0 = new THREE.Vector3(a[0], a[1], a[2]), p1 = new THREE.Vector3(a[a.length - 3], a[a.length - 2], a[a.length - 1]);
      const e = p1.clone().sub(p0); const L = e.length(); if (L < 1e-6) return null; e.normalize();
      for (let i = 0; i < a.length; i += 3) { const q = new THREE.Vector3(a[i], a[i + 1], a[i + 2]).sub(p0); if (q.clone().sub(e.clone().multiplyScalar(q.dot(e))).length() > 1e-3) return null; }
      const faces: { n: THREE.Vector3; extent: number }[] = [];
      m.faceGroups.forEach((_, fi) => {
        const pf = planarFaceAt(m, m.faceGroups[fi].start / 3); if (!pf?.planar) return;
        const vs = faceVertices(m, fi);
        const onEdge = vs.filter((v) => { const q = v.clone().sub(p0); const t = q.dot(e); return t > -1e-3 && t < L + 1e-3 && q.clone().sub(e.clone().multiplyScalar(t)).length() < 1e-3; });
        if (onEdge.length < 2) return;
        const perp = pf.normal.clone().cross(e).normalize();
        const extent = Math.max(...vs.map((v) => Math.abs(v.clone().sub(p0).dot(perp))));
        faces.push({ n: pf.normal.clone(), extent });
      });
      if (faces.length < 2) return null;
      faces.sort((x, y) => x.extent - y.extent);
      return { p0: vArr(p0), p1: vArr(p1), w: vArr(faces[0].n), n: vArr(faces[1].n) };
    };

    /** Proyecta una arista del modelo sobre el plano del boceto como geometría de referencia. */
    const projectEdge = (gi: number) => {
      const s = useStore.getState(), fr = state.frame, m = state.mesh; if (!fr || !m) return;
      const a = groupPts(gi, m), pts: V2[] = [];
      for (let i = 0; i < a.length; i += 3) { const d = v3.sub([a[i], a[i + 1], a[i + 2]], fr.origin); pts.push([v3.dot(d, fr.xDir), v3.dot(d, fr.yDir)]); }
      const uniq = pts.filter((p, i) => i === 0 || dist2(p, pts[i - 1]) > 1e-7);
      if (uniq.length < 2) { s.notify('La arista es perpendicular al boceto', 'error'); return; }
      const A = uniq[0], B = uniq[uniq.length - 1];
      const straight = uniq.every((p) => distToSeg(p, A, B) < 1e-4) && dist2(A, B) > 1e-6;
      let e: SkEntity | null = null;
      if (straight) e = { id: uid('l'), type: 'line', a: [num(A[0]), num(A[1])], b: [num(B[0]), num(B[1])], ref: true };
      else {
        const M = uniq[Math.floor(uniq.length / 2)];
        const closed = dist2(A, B) < 1e-5;
        const C = circleFrom3(uniq[0], uniq[Math.floor(uniq.length / 3)], uniq[Math.floor((2 * uniq.length) / 3)]);
        if (C && uniq.every((p) => Math.abs(dist2(p, C.c) - C.r) < Math.max(1e-3, C.r * 1e-3))) {
          if (closed) e = { id: uid('c'), type: 'circle', cx: num(C.c[0]), cy: num(C.c[1]), d: num(C.r * 2), ref: true };
          else {
            const a0 = Math.atan2(A[1] - C.c[1], A[0] - C.c[0]) / D2R, a1 = Math.atan2(B[1] - C.c[1], B[0] - C.c[0]) / D2R, am = Math.atan2(M[1] - C.c[1], M[0] - C.c[0]) / D2R;
            const ccw = (() => { let x = am - a0; while (x < 0) x += 360; let y = a1 - a0; while (y < 0) y += 360; return x < y; })();
            e = ccw ? { id: uid('a'), type: 'arc', cx: num(C.c[0]), cy: num(C.c[1]), r: num(C.r), a0: num(a0), a1: num(a1), ref: true } : { id: uid('a'), type: 'arc', cx: num(C.c[0]), cy: num(C.c[1]), r: num(C.r), a0: num(a1), a1: num(a0), ref: true };
          }
        } else {
          const step = Math.max(1, Math.floor(uniq.length / 24));
          const sp = uniq.filter((_, i) => i % step === 0);
          if (!closed && dist2(sp[sp.length - 1], B) > 1e-7) sp.push(B);
          e = { id: uid('sp'), type: 'spline', pts: (closed ? sp.slice(0, -1) : sp).map((p) => [num(p[0]), num(p[1])] as [string, string]), closed, ref: true };
        }
      }
      if (e) { addGeom([e], []); s.notify('Geometría proyectada (referencia fija)'); }
    };

    /** Crea la cota a partir de las selecciones y la posición del texto. */
    const createDim = (picks: Pick[], pos: V2) => {
      const s = useStore.getState(); const sk = activeSketch(s); if (!sk) return;
      const ev = safeEval(s);
      const P = (pk: Pick): GRef => (pk.kind === 'curve' ? { e: pk.ref.e, k: 'c' } : pk.ref);
      let kind: DimKind | null = null, a: GRef | undefined, b: GRef | undefined;
      const [p1, p2] = picks;
      if (picks.length === 1) {
        if (p1.kind === 'line') { kind = 'len'; a = p1.ref; }
        else if (p1.kind === 'curve') { const e = sk.entities.find((x) => x.id === p1.ref.e)!; kind = e.type === 'arc' ? 'radius' : 'diameter'; a = p1.ref; }
      } else if (picks.length === 2) {
        const k1 = p1.kind === 'curve' ? 'point' : p1.kind, k2 = p2.kind === 'curve' ? 'point' : p2.kind;
        if (k1 === 'point' && k2 === 'point') {
          a = P(p1); b = P(p2);
          const A = refPoint(sk, a, ev)!, B = refPoint(sk, b, ev)!;
          const inX = pos[0] > Math.min(A[0], B[0]) && pos[0] < Math.max(A[0], B[0]), inY = pos[1] > Math.min(A[1], B[1]) && pos[1] < Math.max(A[1], B[1]);
          kind = Math.abs(A[1] - B[1]) < 1e-9 ? 'hdist' : Math.abs(A[0] - B[0]) < 1e-9 ? 'vdist' : inX && !inY ? 'hdist' : inY && !inX ? 'vdist' : 'dist';
        } else if (k1 === 'point' && k2 === 'line') { kind = 'pldist'; a = P(p1); b = p2.ref; }
        else if (k1 === 'line' && k2 === 'point') { kind = 'pldist'; a = P(p2); b = p1.ref; }
        else if (k1 === 'line' && k2 === 'line') {
          const L1 = refLine(sk, p1.ref, ev)!, L2 = refLine(sk, p2.ref, ev)!;
          const u = [L1[1][0] - L1[0][0], L1[1][1] - L1[0][1]], v = [L2[1][0] - L2[0][0], L2[1][1] - L2[0][1]];
          const cr = (u[0] * v[1] - u[1] * v[0]) / ((Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1])) || 1);
          kind = Math.abs(cr) < 1e-6 ? 'lldist' : 'angle'; a = p1.ref; b = p2.ref;
        }
      }
      if (!kind || !a) { s.notify('Combinación no válida para una cota', 'error'); return; }
      const used = new Set(s.doc.features.flatMap((f) => (f.type === 'sketch' ? (f.constraints ?? []).map((c) => c.name ?? '') : [])));
      const c = makeDim(sk, ev, kind, a, b, [Number(pos[0].toFixed(3)), Number(pos[1].toFixed(3))], nextDimName(used));
      if (s.addConstraint(c)) {
        const q = screenOfLocal(pos);
        const cc = activeSketch(useStore.getState())?.constraints?.find((x) => x.id === c.id);
        if (cc && !cc.driven) setEditing({ id: c.id, value: (c.expr ?? '').replace(/ (mm|deg)$/, ''), x: q.x, y: q.y });
      }
    };

    const CON_NEEDS: Record<string, number> = { coincident: 2, horizontal: 1, vertical: 1, parallel: 2, perpendicular: 2, collinear: 2, equal: 2, tangent: 2, concentric: 2, midpoint: 2, symmetric: 3, fix: 1 };
    const conWant = (type: string, i: number, prev: Pick[]): Parameters<typeof pickAt>[1] => {
      switch (type) {
        case 'coincident': return i === 0 ? 'any' : prev[0].kind === 'point' ? 'any' : 'point';
        case 'horizontal': case 'vertical': return 'any';
        case 'parallel': case 'perpendicular': case 'collinear': return 'line';
        case 'equal': return i === 0 ? 'linecurve' : prev[0].kind === 'line' ? 'line' : 'curve';
        case 'tangent': return 'linecurve';
        case 'concentric': return 'curve';
        case 'midpoint': return i === 0 ? 'point' : 'line';
        case 'symmetric': return i < 2 ? 'point' : 'line';
        case 'fix': return 'point';
      }
      return 'any';
    };
    const finishConstraint = (type: string, picks: Pick[]): boolean => {
      const s = useStore.getState(); const sk = activeSketch(s); if (!sk) return true;
      const ev = safeEval(s);
      const [a, b, c] = picks;
      let k: SkConstraint | null = null;
      if ((type === 'horizontal' || type === 'vertical') && a.kind === 'point') { if (picks.length < 2) return false; k = { id: uid('k'), type: type as 'horizontal', a: a.ref, b: b.ref }; }
      else if ((type === 'horizontal' || type === 'vertical')) { if (a.kind !== 'line') { s.notify('Selecciona una línea o dos puntos', 'error'); return true; } k = { id: uid('k'), type: type as 'horizontal', a: a.ref }; }
      else if (type === 'coincident') {
        if (picks.length < 2) return false;
        const pt = a.kind === 'point' ? a : b, other = a.kind === 'point' ? b : a;
        if (pt.kind !== 'point') { s.notify('Selecciona al menos un punto', 'error'); return true; }
        k = other.kind === 'point' ? { id: uid('k'), type: 'coincident', a: pt.ref, b: other.ref } : { id: uid('k'), type: 'onobject', a: pt.ref, b: other.ref };
      } else {
        if (picks.length < CON_NEEDS[type]) return false;
        if (type === 'tangent' && a.kind === 'line' && b.kind === 'line') { s.notify('La tangencia necesita un arco o un círculo', 'error'); return true; }
        k = makeConstraint(sk, ev, type as SkConstraint['type'], a.ref, b?.ref, c?.ref);
      }
      if (k) s.addConstraint(k);
      return true;
    };

    let downAt: { x: number; y: number; btn: number } | null = null;
    const onDown = (ev: PointerEvent) => {
      downAt = { x: ev.clientX, y: ev.clientY, btn: ev.button };
      const s = useStore.getState();
      if (s.mode === 'sketch' && !s.tool && ev.button === 0) {
        const pk = pickAt(ev);
        if (pk && pk.ref.e !== 'O' && pk.ref.e !== 'X' && pk.ref.e !== 'Y' && pk.kind !== 'entity') {
          const sk = activeSketch(s)!, e = sk.entities.find((x) => x.id === pk.ref.e);
          if (e && !e.ref) {
            const kind = pk.kind === 'point' ? 'point' : pk.kind === 'line' ? 'line' : 'circle';
            const loc = toLocal(ev) ?? pk.p;
            state.drag = { kind, ref: pk.ref, start: loc, base: s.doc, moved: false, raf: 0, last: null };
            V.controls.enabled = false;
          }
        }
      }
    };
    const onUp = (ev: PointerEvent) => {
      V.controls.enabled = true;
      if (state.drag) {
        const dr = state.drag; state.drag = null;
        if (dr.raf) cancelAnimationFrame(dr.raf);
        if (dr.moved) { const st = useStore.getState(); useStore.setState({ past: [...st.past.slice(-99), dr.base], future: [], dirty: true }); downAt = null; return; }
      }
      if (!downAt || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 4) { downAt = null; return; }
      const btn = downAt.btn; downAt = null;
      const s = useStore.getState();
      if (btn === 2 && s.mode === 'sketch') { onContext(); return; }
      if (btn !== 0) return;
      const d = s.dialog && 'draft' in s.dialog ? s.dialog.draft : null;
      if (s.tool === 'pickPlane' || s.tool === 'pickWorkBase') {
        const ph = hitPlane(ev), fh = faceHit(ev);
        let plane: Parameters<typeof s.startSketch>[0] | null = null;
        if (fh && (!ph || fh.distance <= ph.dist)) {
          if (!fh.planar) { s.notify('Selecciona una cara plana o un plano', 'error'); return; }
          const n = fh.normal, o = n.clone().multiplyScalar(fh.point.dot(n));
          let x = new THREE.Vector3(1, 0, 0).projectOnPlane(n);
          if (x.length() < 0.3) x = new THREE.Vector3(0, 1, 0).projectOnPlane(n);
          x.normalize();
          plane = { kind: 'custom', label: 'Cara de la pieza', origin: vArr(o), xDir: vArr(x), normal: vArr(n) };
        } else if (ph) plane = ph.key.startsWith('work:') ? { kind: 'work', id: ph.key.slice(5) } : { kind: 'std', name: ph.key as StdPlane, offset: '0' };
        if (!plane) return;
        if (s.tool === 'pickWorkBase') { s.updateDraft(d?.type === 'workplane' ? { base: plane } : { plane }); useStore.setState({ tool: s.dialog && 'draft' in s.dialog && ['draft', 'thicken', 'thread'].includes(s.dialog.draft.type) ? 'pickFaces' : null }); }
        else s.startSketch(plane);
        return;
      }
      if (s.tool === 'pickEdges' && d && (d.type === 'fillet' || d.type === 'chamfer')) {
        const hit = V.nearestEdge(ev, pickMesh()!, null, occluders()); if (!hit) return;
        const p = edgeRefPoint(hit.group), pts = d.edges.points;
        const existing = pts.findIndex((q: V3) => groupMatches(hit.group, q));
        s.updateDraft({ edges: { mode: 'picked', points: existing >= 0 ? pts.filter((_: V3, i: number) => i !== existing) : [...pts, p] } });
        return;
      }
      if (s.tool === 'pickFlangeEdge' && d?.type === 'sm_flange') {
        const hit = V.nearestEdge(ev, pickMesh()!, null, occluders()); if (!hit) return;
        const e = flangeEdgeFrom(hit.group);
        if (!e) { s.notify('Elige una arista recta del borde de la chapa', 'error'); return; }
        s.updateDraft({ edge: e });
        return;
      }
      if (s.tool === 'measure') {
        const m = state.mesh; if (!m) return;
        const hit = V.nearestEdge(ev, m, null, occluders()); if (!hit) { measureSel = []; setHint('Medir: clic en una arista'); buildOverlay(s); return; }
        const pts = groupPts(hit.group, m);
        const P: THREE.Vector3[] = []; for (let i = 0; i < pts.length; i += 3) P.push(new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]));
        measureSel = measureSel.length >= 2 ? [hit.group] : [...measureSel, hit.group];
        const info = (g: number) => {
          const a = groupPts(g, m), Q: THREE.Vector3[] = []; for (let i = 0; i < a.length; i += 3) Q.push(new THREE.Vector3(a[i], a[i + 1], a[i + 2]));
          let L = 0; for (let i = 0; i + 1 < Q.length; i += 2) L += Q[i].distanceTo(Q[i + 1]);
          // ¿circular? tres puntos y comprobación
          const q2 = Q.map((v) => v);
          let txt = `Longitud ${fmt(L, 3)} mm`;
          if (q2.length > 6) {
            const a0 = q2[0], b0 = q2[Math.floor(q2.length / 3)], c0 = q2[Math.floor((2 * q2.length) / 3)];
            const ab = b0.clone().sub(a0), ac = c0.clone().sub(a0), n = ab.clone().cross(ac);
            if (n.lengthSq() > 1e-12) {
              const cc = a0.clone().add(ac.clone().multiplyScalar(ab.lengthSq()).sub(ab.clone().multiplyScalar(ac.lengthSq())).cross(n).multiplyScalar(-1 / (2 * n.lengthSq())));
              const r = cc.distanceTo(a0);
              if (q2.every((v) => Math.abs(v.distanceTo(cc) - r) < Math.max(1e-3, r * 1e-3))) txt += ` · R ${fmt(r, 3)} · Ø ${fmt(2 * r, 3)} mm`;
            }
          }
          return { Q, txt };
        };
        const i1 = info(measureSel[0]);
        if (measureSel.length === 1) setHint(i1.txt);
        else {
          const i2 = info(measureSel[1]);
          let best = Infinity, pa = new THREE.Vector3(), pb = new THREE.Vector3();
          for (let i = 0; i + 1 < i1.Q.length; i += 2) for (let j = 0; j + 1 < i2.Q.length; j += 2) {
            const s1 = new THREE.Line3(i1.Q[i], i1.Q[i + 1]), s2 = new THREE.Line3(i2.Q[j], i2.Q[j + 1]);
            for (const t of [0, 0.25, 0.5, 0.75, 1]) {
              const p1 = s1.at(t, new THREE.Vector3()), q1 = new THREE.Vector3(); s2.closestPointToPoint(p1, true, q1);
              const d1 = p1.distanceTo(q1); if (d1 < best) { best = d1; pa = p1; pb = q1; }
              const p2 = s2.at(t, new THREE.Vector3()), q3 = new THREE.Vector3(); s1.closestPointToPoint(p2, true, q3);
              const d2 = p2.distanceTo(q3); if (d2 < best) { best = d2; pa = q3; pb = p2; }
            }
          }
          const dv = pb.clone().sub(pa);
          setHint(`Distancia mínima ${fmt(best, 3)} mm · ΔX ${fmt(Math.abs(dv.x), 2)} ΔY ${fmt(Math.abs(dv.y), 2)} ΔZ ${fmt(Math.abs(dv.z), 2)}`);
        }
        buildOverlay(s);
        return;
      }
      if (s.tool === 'pickFaces' && d && 'faces' in d) {
        const fh = faceHit(ev); if (!fh) return;
        const cur = d.faces as V3[];
        const idx = cur.findIndex((p) => faceGroupContaining(fh.mesh, p) === fh.group);
        const single = d.type === 'draft' && false;
        s.updateDraft({ faces: idx >= 0 ? cur.filter((_, i) => i !== idx) : single ? [vArr(fh.point)] : [...cur, vArr(fh.point)], ...(d.type === 'draft' || d.type === 'thicken' ? {} : {}) });
        return;
      }
      if (s.mode !== 'sketch') return;
      const raw = toLocal(ev); if (!raw) return;
      const tool = s.tool;
      // --- selección ---
      if (!tool || tool === 'skpick') {
        const pk = pickAt(ev);
        const id = pk && pk.ref.e !== 'O' && pk.ref.e !== 'X' && pk.ref.e !== 'Y' ? pk.ref.e : null;
        if (tool === 'skpick') {
          const dl = s.dialog;
          if (dl && dl.kind === 'skop' && pk && (pk.kind === 'line' || pk.kind === 'point')) { useStore.setState({ dialog: { ...dl, base: JSON.stringify(pk.ref) }, tool: null }); }
          return;
        }
        if (ev.ctrlKey || ev.shiftKey || ev.metaKey) {
          if (!id) return;
          const cur = new Set(s.selEntities); if (s.selEntity && !cur.size) cur.add(s.selEntity);
          if (cur.has(id)) cur.delete(id); else cur.add(id);
          useStore.setState({ selEntities: [...cur], selEntity: id, selCon: null });
        } else useStore.setState({ selEntity: id, selEntities: id ? [id] : [], selCon: null });
        return;
      }
      // --- cotas y restricciones ---
      if (tool === 'skdim') {
        const pk = pickAt(ev, state.picks.length && state.picks[0].kind === 'curve' ? 'nopoint' : 'any');
        const placing = !pk || state.picks.length === 2 || (state.picks.length === 1 && state.picks[0].kind === 'curve' && (!pk || pk.kind === 'curve' && pk.ref.e === state.picks[0].ref.e));
        if (pk && !placing && !(state.picks.length === 1 && state.picks[0].ref.e === pk.ref.e && state.picks[0].ref.k === pk.ref.k)) { state.picks.push(pk); buildPreview(s); return; }
        if (!state.picks.length) return;
        createDim(state.picks, raw);
        state.picks = []; buildPreview(useStore.getState());
        return;
      }
      if (tool === 'constrain') {
        const type = s.conType;
        const pk = pickAt(ev, conWant(type, state.picks.length, state.picks));
        if (!pk) return;
        state.picks.push(pk);
        if (finishConstraint(type, state.picks)) state.picks = [];
        buildPreview(useStore.getState());
        return;
      }
      if (tool === 'trim' || tool === 'extend') {
        const pk = pickAt(ev, 'nopoint'); if (!pk || pk.ref.e === 'X' || pk.ref.e === 'Y') return;
        const ev2 = safeEval(s);
        s.sketchCommit((sk) => (tool === 'trim' ? trim(sk, pk.ref.e, raw, ev2) : extend(sk, pk.ref.e, raw, ev2)));
        return;
      }
      if (tool === 'fillet2d' || tool === 'chamfer2d') {
        const r = safeEval(s)(s.toolParam || '5');
        if (!(r > 0)) { s.notify('Indica un radio o distancia mayor que 0', 'error'); return; }
        const ev2 = safeEval(s);
        const before = activeSketch(s)?.entities.length ?? 0;
        const ok = s.sketchCommit((sk) => filletCorner(sk, raw, r, ev2, tool === 'chamfer2d'));
        if (ok && tool === 'fillet2d') {
          // cota de radio del empalme
          const sk2 = activeSketch(useStore.getState())!;
          const arc = sk2.entities.slice(before).concat(sk2.entities).find((e) => e.type === 'arc' && !(sk2.constraints ?? []).some((c) => c.type === 'dim' && c.a.e === e.id));
          if (arc && arc.type === 'arc') {
            const used = new Set(useStore.getState().doc.features.flatMap((f) => (f.type === 'sketch' ? (f.constraints ?? []).map((c) => c.name ?? '') : [])));
            const ev3 = safeEval(useStore.getState());
            const c = makeDim(sk2, ev3, 'radius', { e: arc.id }, undefined, [ev3(arc.cx) + ev3(arc.r) * 1.6, ev3(arc.cy) + ev3(arc.r) * 1.6], nextDimName(used));
            c.expr = s.toolParam || '5 mm';
            useStore.getState().addConstraint(c, { force: true });
          }
        }
        return;
      }
      if (tool === 'projectGeom') {
        const m = state.mesh; if (!m) { s.notify('No hay modelo que proyectar', 'error'); return; }
        const hit = V.nearestEdge(ev, m, null, []); if (!hit) return;
        projectEdge(hit.group);
        return;
      }
      // --- herramientas de dibujo ---
      const prev = tool === 'line' ? state.chain[state.chain.length - 1]?.p : tool === 'rect3' || tool === 'spline' ? state.clicks[state.clicks.length - 1]?.p : undefined;
      const sn = snap(ev, raw, prev);
      const p = sn.p;
      if (tool === 'point') { const id = uid('pt'); addGeom([{ id, type: 'point', cx: r3(p[0]), cy: r3(p[1]) }], snapCons(sn, { e: id, k: 'c' })); return; }
      if (tool === 'text') { useStore.setState({ dialog: { kind: 'skop', op: 'text', params: { text: 'INV3D', size: '10 mm', rot: '0 deg', x: r3(p[0]), y: r3(p[1]) }, step: 0 } }); return; }
      if (tool === 'line') {
        if (!state.chain.length) { state.chain = [{ p, snap: sn }]; state.chainIds = []; buildPreview(s); return; }
        const last = state.chain[state.chain.length - 1];
        if (dist2(p, last.p) < 1e-9) { endChain(); return; }
        const r = commitLine(last, sn, state.chainIds[state.chainIds.length - 1] ?? null);
        if (!r) return;
        state.chainIds.push(r.id);
        if (r.closing) { endChain(); return; }
        state.chain.push({ p, snap: sn });
        return;
      }
      if (tool === 'spline') {
        const c = state.clicks;
        if (c.length >= 2 && dist2(p, c[0].p) < 1e-9) { finishSpline(true); return; }
        if (c.length && dist2(p, c[c.length - 1].p) < 1e-9) { finishSpline(false); return; }
        c.push(sn); buildPreview(s); return;
      }
      const need = tool === 'arc' || tool === 'slot' || tool === 'arc3' || tool === 'rect3' || tool === 'circle3' || tool === 'ellipse' ? 3 : 2;
      state.clicks.push(sn);
      if (state.clicks.length < need) { buildPreview(s); return; }
      const cs = state.clicks; state.clicks = [];
      const c = cs.map((x) => x.p);
      if (tool === 'rect' || tool === 'rectc') {
        let x0: number, y0: number, w: number, h: number;
        if (tool === 'rect') { x0 = Math.min(c[0][0], p[0]); y0 = Math.min(c[0][1], p[1]); w = Math.abs(p[0] - c[0][0]); h = Math.abs(p[1] - c[0][1]); }
        else { w = 2 * Math.abs(p[0] - c[0][0]); h = 2 * Math.abs(p[1] - c[0][1]); x0 = c[0][0] - w / 2; y0 = c[0][1] - h / 2; }
        if (w < 1e-6 || h < 1e-6) return;
        const id = uid('r');
        const cornerKey = (q: V2) => (q[0] <= x0 + 1e-9 ? (q[1] <= y0 + 1e-9 ? 'p0' : 'p3') : (q[1] <= y0 + 1e-9 ? 'p1' : 'p2'));
        const cons = tool === 'rect' ? [...snapCons(cs[0], { e: id, k: cornerKey(c[0]) }), ...snapCons(sn, { e: id, k: cornerKey(p) })] : [...snapCons(cs[0], { e: id, k: 'c' }), ...snapCons(sn, { e: id, k: cornerKey(p) })];
        addGeom([{ id, type: 'rect', x: r3(x0), y: r3(y0), w: r3(w), h: r3(h) }], cons);
      } else if (tool === 'rect3') {
        const u = [c[1][0] - c[0][0], c[1][1] - c[0][1]], ul = Math.hypot(u[0], u[1]) || 1, n = [-u[1] / ul, u[0] / ul];
        const o = (p[0] - c[1][0]) * n[0] + (p[1] - c[1][1]) * n[1];
        if (Math.abs(o) < 1e-6 || ul < 1e-6) return;
        const q: V2[] = [c[0], c[1], [c[1][0] + n[0] * o, c[1][1] + n[1] * o], [c[0][0] + n[0] * o, c[0][1] + n[1] * o]];
        const ids = [uid('l'), uid('l'), uid('l'), uid('l')];
        const ents: SkEntity[] = ids.map((id, i) => ({ id, type: 'line', a: P2(q[i]), b: P2(q[(i + 1) % 4]) }));
        const cons: SkConstraint[] = ids.map((id, i) => ({ id: uid('k'), type: 'coincident' as const, a: { e: id, k: 'b' }, b: { e: ids[(i + 1) % 4], k: 'a' } }));
        cons.push({ id: uid('k'), type: 'perpendicular', a: { e: ids[0] }, b: { e: ids[1] } }, { id: uid('k'), type: 'parallel', a: { e: ids[0] }, b: { e: ids[2] } }, { id: uid('k'), type: 'parallel', a: { e: ids[1] }, b: { e: ids[3] } });
        cons.push(...snapCons(cs[0], { e: ids[0], k: 'a' }), ...snapCons(cs[1], { e: ids[1], k: 'a' }));
        addGeom(ents, cons);
      } else if (tool === 'circle' || tool === 'npoly') {
        const dd = 2 * dist2(p, c[0]); if (dd < 1e-6) return;
        if (tool === 'circle') { const id = uid('c'); addGeom([{ id, type: 'circle', cx: r3(c[0][0]), cy: r3(c[0][1]), d: r3(dd) }], [...snapCons(cs[0], { e: id, k: 'c' }), ...(sn.on || sn.ref ? [] : [])]); }
        else { const id = uid('n'); addGeom([{ id, type: 'npoly', cx: r3(c[0][0]), cy: r3(c[0][1]), d: r3(dd), n: s.toolParam && /^\d+$/.test(s.toolParam) ? s.toolParam : '6', rot: r3((Math.atan2(p[1] - c[0][1], p[0] - c[0][0]) * 180) / Math.PI) }], snapCons(cs[0], { e: id, k: 'c' })); }
      } else if (tool === 'circle3') {
        const C = circleFrom3(c[0], c[1], c[2]); if (!C) return;
        const id = uid('c'); addGeom([{ id, type: 'circle', cx: r3(C.c[0]), cy: r3(C.c[1]), d: r3(C.r * 2) }], []);
      } else if (tool === 'arc') {
        const r = dist2(c[1], c[0]); if (r < 1e-6) return;
        const a0 = (Math.atan2(c[1][1] - c[0][1], c[1][0] - c[0][0]) * 180) / Math.PI, a1 = (Math.atan2(p[1] - c[0][1], p[0] - c[0][0]) * 180) / Math.PI;
        const id = uid('a');
        addGeom([{ id, type: 'arc', cx: r3(c[0][0]), cy: r3(c[0][1]), r: r3(r), a0: r3(a0), a1: r3(a1) }], [...snapCons(cs[0], { e: id, k: 'c' }), ...snapCons(cs[1], { e: id, k: 's' })]);
      } else if (tool === 'arc3') {
        const C = circleFrom3(c[0], c[2], c[1]); if (!C) return;
        const ang = (q: V2) => (Math.atan2(q[1] - C.c[1], q[0] - C.c[0]) * 180) / Math.PI;
        const t0 = ang(c[0]), tm = ang(c[2]), t1 = ang(c[1]);
        const rel = (t: number) => { let x = t - t0; while (x < 0) x += 360; while (x >= 360) x -= 360; return x; };
        const ccw = rel(tm) < rel(t1);
        const id = uid('a');
        const [sKey, eKey] = ccw ? ['s', 'e'] : ['e', 's'];
        addGeom([{ id, type: 'arc', cx: r3(C.c[0]), cy: r3(C.c[1]), r: r3(C.r), a0: r3(ccw ? t0 : t1), a1: r3(ccw ? t1 : t0) }], [...snapCons(cs[0], { e: id, k: sKey }), ...snapCons(cs[1], { e: id, k: eKey })]);
      } else if (tool === 'arctan') {
        const ta = tangentArc(s, c[0], p); if (!ta) { s.notify('El arco tangente debe empezar en el extremo de una línea', 'error'); return; }
        const id = uid('a');
        const [sk, ek] = ta.ccw ? ['s', 'e'] : ['e', 's'];
        const ent: SkEntity = { id, type: 'arc', cx: r3(ta.C[0]), cy: r3(ta.C[1]), r: r3(ta.r), a0: r3(ta.ccw ? ta.a0 : ta.a1), a1: r3(ta.ccw ? ta.a1 : ta.a0) };
        const tmp = { ...activeSketch(s)!, entities: [...activeSketch(s)!.entities, ent] };
        addGeom([ent], [{ id: uid('k'), type: 'coincident', a: ta.ref, b: { e: id, k: sk } }, makeConstraint(tmp, safeEval(s), 'tangent', { e: ta.line }, { e: id }), ...snapCons(sn, { e: id, k: ek })]);
      } else if (tool === 'slot') {
        const a = c[0], b = c[1], L = dist2(a, b) || 1;
        const w = Math.abs((p[0] - a[0]) * (-(b[1] - a[1]) / L) + (p[1] - a[1]) * ((b[0] - a[0]) / L)) * 2;
        if (w < 1e-6) return;
        const id = uid('sl');
        addGeom([{ id, type: 'slot', x1: r3(a[0]), y1: r3(a[1]), x2: r3(b[0]), y2: r3(b[1]), w: r3(w) }], [...snapCons(cs[0], { e: id, k: 'c1' }), ...snapCons(cs[1], { e: id, k: 'c2' })]);
      } else if (tool === 'ellipse') {
        const rx = dist2(c[1], c[0]), rot = Math.atan2(c[1][1] - c[0][1], c[1][0] - c[0][0]);
        const ry = Math.abs(-(p[0] - c[0][0]) * Math.sin(rot) + (p[1] - c[0][1]) * Math.cos(rot));
        if (rx < 1e-6 || ry < 1e-6) return;
        const id = uid('el');
        addGeom([{ id, type: 'ellipse', cx: r3(c[0][0]), cy: r3(c[0][1]), rx: r3(rx), ry: r3(ry), rot: r3(rot / D2R) }], snapCons(cs[0], { e: id, k: 'c' }));
      }
    };
    const finishSpline = (closed: boolean) => {
      const c = state.clicks; state.clicks = [];
      if (c.length < 2) { buildPreview(useStore.getState()); return; }
      const id = uid('sp');
      const cons = [...snapCons(c[0], { e: id, k: 'p0' }), ...(closed ? [] : snapCons(c[c.length - 1], { e: id, k: `p${c.length - 1}` }))];
      addGeom([{ id, type: 'spline', pts: c.map((x) => P2(x.p)), closed: closed && c.length >= 3 }], cons);
      buildPreview(useStore.getState());
    };
    const endChain = () => { state.chain = []; state.chainIds = []; buildPreview(useStore.getState()); };
    const onContext = () => {
      const s = useStore.getState();
      if (s.tool === 'spline' && state.clicks.length >= 2) { finishSpline(false); return; }
      if (s.tool === 'line' && state.chain.length) { endChain(); return; }
      if (state.picks.length || state.clicks.length) { state.picks = []; state.clicks = []; buildPreview(s); return; }
      if (s.tool) s.setTool(null);
    };
    const onMove = (ev: PointerEvent) => {
      const s = useStore.getState();
      if (state.drag && (ev.buttons & 1)) { const p = toLocal(ev); if (p) dragTo(p); return; }
      if (s.tool === 'pickPlane' || s.tool === 'pickWorkBase') {
        const ph = hitPlane(ev), key = ph?.key ?? '';
        if (key !== state.hoverPlane) { state.hoverPlane = key; buildPlanes(s); V.request(); }
        const lbl = originGroup.children.find((c) => c.userData.plane === key)?.userData.label;
        setHint(lbl ? `${lbl}` : 'Elige un plano o una cara plana');
        return;
      }
      if (s.tool === 'pickEdges' || s.tool === 'pickFlangeEdge' || s.tool === 'projectGeom' || s.tool === 'measure') {
        const m = s.tool === 'projectGeom' || s.tool === 'measure' ? state.mesh : pickMesh(); if (!m) return;
        const gi = V.nearestEdge(ev, m, null, s.tool === 'projectGeom' ? [] : occluders())?.group ?? -1;
        if (gi !== state.hoverEdge) { state.hoverEdge = gi; buildOverlay(s); }
        return;
      }
      if (s.tool === 'pickFaces') {
        const fh = faceHit(ev), gi = fh?.group ?? -1;
        if (gi !== hoverFace) { hoverFace = gi; buildOverlay(s); }
        return;
      }
      if (s.mode === 'sketch') {
        const raw = toLocal(ev); if (!raw) return;
        const t = s.tool;
        const drawing = t && !['skdim', 'constrain', 'trim', 'extend', 'fillet2d', 'chamfer2d', 'skpick'].includes(t);
        let hp: Pick | null = null;
        if (!t || t === 'skpick') hp = pickAt(ev);
        else if (t === 'skdim') hp = pickAt(ev, state.picks.length && state.picks[0].kind === 'curve' ? 'nopoint' : 'any');
        else if (t === 'constrain') hp = pickAt(ev, conWant(s.conType, state.picks.length, state.picks));
        else if (t === 'trim' || t === 'extend') hp = pickAt(ev, 'nopoint');
        else if (t === 'fillet2d' || t === 'chamfer2d') hp = pickAt(ev, 'point');
        const changed = JSON.stringify(hp?.ref) !== JSON.stringify(state.hoverPick?.ref) || hp?.kind !== state.hoverPick?.kind;
        state.hoverPick = hp;
        const prev = t === 'line' ? state.chain[state.chain.length - 1]?.p : t === 'rect3' || t === 'spline' ? state.clicks[state.clicks.length - 1]?.p : undefined;
        state.hover = drawing ? snap(ev, raw, prev) : { p: raw };
        useStore.setState({ cursor: state.hover.p });
        if (changed) buildSketches(s); else buildPreview(s);
        cvs.style.cursor = !t && hp ? 'pointer' : t ? 'crosshair' : 'default';
      }
    };
    const onDbl = () => { const s = useStore.getState(); if (s.tool === 'line') endChain(); if (s.tool === 'spline') finishSpline(false); };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const s = useStore.getState();
      if (e.key === 'Enter' && s.tool === 'spline') finishSpline(false);
      if (e.key === 'Escape' && s.mode === 'sketch' && (state.chain.length || state.clicks.length || state.picks.length)) { e.stopPropagation(); state.chain = []; state.chainIds = []; state.clicks = []; state.picks = []; buildPreview(s); }
    };
    const cvs = V.renderer.domElement;
    cvs.addEventListener('pointerdown', onDown);
    cvs.addEventListener('pointerup', onUp);
    cvs.addEventListener('pointermove', onMove);
    cvs.addEventListener('dblclick', onDbl);
    window.addEventListener('keydown', onKey, true);
    cvs.addEventListener('contextmenu', (e) => e.preventDefault());
    cvs.addEventListener('pointerleave', () => { state.hover = null; useStore.setState({ cursor: null }); buildPreview(useStore.getState()); });

    const cancelTool = () => { state.chain = []; state.chainIds = []; state.clicks = []; state.picks = []; buildPreview(useStore.getState()); };
    const applyMouse = (s: State) => {
      const picking = ['pickEdges', 'pickPlane', 'pickFaces', 'pickFlangeEdge', 'pickWorkBase', 'measure'].includes(s.tool ?? '');
      V.setMouse(s.mode === 'sketch' || picking, s.mode === 'sketch');
      cvs.style.cursor = s.tool && !picking ? 'crosshair' : s.tool ? 'pointer' : 'default';
    };

    const s0 = useStore.getState();
    applyMouse(s0); buildPart(s0); buildSketches(s0);
    let firstMesh = !s0.result?.mesh;
    const unsub = useStore.subscribe((s, p) => {
      if (s.kind !== 'part') return;
      if (s.pickBase !== p.pickBase) buildOverlay(s);
      if (s.result !== p.result || s.preview !== p.preview || s.dialog !== p.dialog || s.showEdges !== p.showEdges || s.wire !== p.wire || s.clip !== p.clip || s.mode !== p.mode || s.doc.iProperties.material !== p.doc.iProperties.material) {
        buildPart(s);
        if (firstMesh && s.result?.mesh) { firstMesh = false; setView('home'); }
      }
      if (s.doc !== p.doc || s.sketchId !== p.sketchId || s.selEntity !== p.selEntity || s.selEntities !== p.selEntities || s.selCon !== p.selCon || s.tool !== p.tool || s.mode !== p.mode || s.skInfo !== p.skInfo || s.showCons !== p.showCons || s.dialog !== p.dialog) buildSketches(s);
      if (s.tool !== p.tool || s.mode !== p.mode || s.conType !== p.conType) { applyMouse(s); cancelTool(); setHint(''); state.hoverEdge = -1; hoverFace = -1; measureSel = []; buildOverlay(s); }
      if (s.view !== p.view) setView(s.view.name);
    });
    setView('home');
    return () => { unsub(); window.removeEventListener('keydown', onKey, true); V.dispose(); };
  }, []);

  const commitDim = useCallback((id: string, value: string) => {
    const s = useStore.getState();
    const sk = activeSketch(s);
    const c = sk?.constraints?.find((x) => x.id === id);
    if (!c) return;
    let v = value.trim();
    if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(v)) v += c.kind === 'angle' ? ' deg' : ' mm';
    try {
      const val = makeEval(docParams(s.doc))(v);
      if (!isFinite(val)) throw new Error('Expresión no válida');
      if (c.kind !== 'angle' && c.kind !== 'hdist' && c.kind !== 'vdist' && !(val > 0)) throw new Error('La cota debe ser positiva');
      s.sketchCommit((k) => { const cc = k.constraints!.find((x) => x.id === id)!; cc.expr = v; cc.driven = false; }, 'La geometría no admite ese valor');
    } catch (err) { s.notify((err as Error).message, 'error'); }
  }, []);

  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.tool);
  const conType = useStore((s) => s.conType);
  const toolParam = useStore((s) => s.toolParam);
  const hints: Record<string, string> = {
    pickEdges: 'Selecciona aristas · clic de nuevo para quitar',
    pickFaces: 'Selecciona caras · clic de nuevo para quitar',
    pickFlangeEdge: 'Selecciona la arista superior del borde de la chapa',
    pickWorkBase: 'Selecciona un plano o una cara plana de referencia',
    skdim: 'Cota: elige una o dos geometrías y luego la posición del texto',
    constrain: `${CONSTRAINT_NAMES[conType]}: selecciona la geometría`,
    trim: 'Recortar: clic sobre la parte de la curva que se elimina',
    extend: 'Alargar: clic cerca del extremo de la línea',
    projectGeom: 'Proyectar geometría: clic en aristas del modelo',
    skpick: 'Selecciona la línea o el punto de referencia',
    spline: 'Spline: clic en los puntos · doble clic, Intro o clic derecho para terminar · clic en el primero para cerrar',
  };

  return (
    <div className="viewport" ref={host}>
      <div className="viewcube" ref={cubeHost} />
      <button className="vp-home" title="Vista de inicio (F6)" onClick={() => useStore.getState().setView('home')}>
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
      </button>
      {mode === 'sketch' && dims.map((lb) => (
        editing?.id === lb.id ? null : (
          <button key={lb.id} className={`dim ${lb.fx ? 'fx' : ''} ${lb.driven ? 'driven' : ''} ${lb.sel ? 'on' : ''}`} style={{ left: lb.x, top: lb.y }}
            title={`${lb.fx ? `fx: ${lb.expr}` : lb.expr} — doble clic para editar · arrastrar para mover`}
            onPointerDown={(e) => { if (e.button === 0) { useStore.setState({ selCon: lb.id }); api.current?.startLabelDrag(lb.id, e); } }}
            onDoubleClick={() => { if (!lb.driven) setEditing({ id: lb.id, value: lb.expr.replace(/ (mm|deg)$/, ''), x: lb.x, y: lb.y }); }}>
            {lb.fx && <span className="fxmark">fx:</span>}{lb.text}
          </button>
        )
      ))}
      {mode === 'sketch' && editing && (
        <input className="dim-edit" style={{ left: editing.x, top: editing.y }} autoFocus value={editing.value}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { commitDim(editing.id, editing.value); setEditing(null); }
            if (e.key === 'Escape') setEditing(null);
            e.stopPropagation();
          }}
          onBlur={() => { commitDim(editing.id, editing.value); setEditing(null); }} />
      )}
      {mode === 'sketch' && glyphs.map((g) => (
        <button key={g.id} className={`cglyph ${g.sel ? 'on' : ''}`} style={{ left: g.x, top: g.y }} title={`${g.title} · clic para seleccionar, Supr para borrar`}
          onClick={() => useStore.setState({ selCon: g.id })}>{g.g}</button>
      ))}
      {mode === 'sketch' && (tool === 'fillet2d' || tool === 'chamfer2d' || tool === 'npoly') && (
        <div className="tool-param">
          <label>{tool === 'npoly' ? 'Lados' : tool === 'fillet2d' ? 'Radio' : 'Distancia'}</label>
          <input value={toolParam || (tool === 'npoly' ? '6' : '5 mm')} onChange={(e) => useStore.setState({ toolParam: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          <span>{tool === 'npoly' ? 'Centro y vértice' : 'Clic cerca del vértice entre dos líneas'}</span>
        </div>
      )}
      {hint && <div className="vp-hint">{hint}</div>}
      {tool && hints[tool] && <div className="vp-hint">{hints[tool]}</div>}
    </div>
  );
}
