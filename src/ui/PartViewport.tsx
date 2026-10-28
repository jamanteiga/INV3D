import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { useStore, activeSketch, type State } from '../core/store';
import { makeEval, fmt } from '../core/expr';
import {
  planeFrame, toWorld, entityOutline, consumedSketches, uid, v3, MATERIALS, PLANE_STD, resolveWorkPlanes,
  type Frame, type V3, type V2, type SkEntity, type SketchF, type StdPlane, type EdgeSel, type WorkPlanes,
} from '../core/doc';
import type { MeshData } from '../core/cadClient';
import { View3D, css, tv, r3, vArr, planarFaceAt, faceVertices } from './view3d';

interface Label { key: string; x: number; y: number; text: string; expr: string; entity: string; field: string; fx: boolean }

function niceStep(worldPerPx: number) {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  return steps.find((s) => s / worldPerPx >= 14) ?? 1000;
}

function snapPoints(sk: SketchF, ev: (s: string) => number): V2[] {
  const pts: V2[] = [[0, 0]];
  for (const e of sk.entities) {
    try {
      if (e.type === 'circle' || e.type === 'npoly' || e.type === 'arc') pts.push([ev(e.cx), ev(e.cy)]);
      if (e.type === 'arc') { const o = entityOutline(e, ev).pts; pts.push(o[0], o[o.length - 1]); }
      else if (e.type === 'slot') pts.push([ev(e.x1), ev(e.y1)], [ev(e.x2), ev(e.y2)]);
      else if (e.type !== 'circle') pts.push(...entityOutline(e, ev).pts);
    } catch { /* expresión inválida */ }
  }
  return pts;
}

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
  const [labels, setLabels] = useState<Label[]>([]);
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const [hint, setHint] = useState('');

  useEffect(() => {
    const V = new View3D(host.current!, cubeHost.current!);
    (window as unknown as { __v3d: View3D }).__v3d = V; // ayuda de depuración / pruebas
    const { scene, camera } = V;
    const partGroup = new THREE.Group(); scene.add(partGroup);
    const sketchGroup = new THREE.Group(); scene.add(sketchGroup);
    const originGroup = new THREE.Group(); scene.add(originGroup);
    const overlayGroup = new THREE.Group(); scene.add(overlayGroup);
    const previewObj = new THREE.Group(); scene.add(previewObj);
    const snapMarker = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: 0xf2b600, depthTest: false, transparent: true }));
    snapMarker.renderOrder = 10; snapMarker.visible = false; scene.add(snapMarker);

    const state = {
      mesh: null as MeshData | null,
      partMesh: null as THREE.Mesh | null,
      frame: null as Frame | null,
      work: new Map() as WorkPlanes,
      chain: [] as V2[], chainIds: [] as string[],
      clicks: [] as V2[],
      hover: null as V2 | null,
      snapped: false,
      hoverEdge: -1,
      hoverPlane: '' as string,
    };
    const safeEval = (s: State) => { const e = makeEval(s.doc.parameters); return (x: string) => { try { return e(x); } catch { return NaN; } }; };

    V.onFrame = () => {
      const s = useStore.getState();
      V.triad.visible = s.mode !== 'sketch';
      if (snapMarker.visible) { snapMarker.quaternion.copy(camera.quaternion); snapMarker.scale.setScalar(V.worldPerPx() * 5); }
    };
    let labelRaf = 0;
    V.onChange = () => { cancelAnimationFrame(labelRaf); labelRaf = requestAnimationFrame(() => { if (useStore.getState().mode === 'sketch') updateLabels(); }); };

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
      buildOverlay(s);
    };

    const pickMesh = (): MeshData | null => useStore.getState().pickBase?.mesh ?? state.mesh;
    const groupPts = (gi: number): number[] => { const m = pickMesh()!; const g = m.edgeGroups[gi]; return Array.from(m.lines.subarray(g.start * 3, (g.start + g.count) * 3)); };
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
    const buildOverlay = (s: State) => {
      V.clearGroup(overlayGroup);
      const d = s.dialog && 'draft' in s.dialog ? s.dialog.draft : null;
      const m = pickMesh();
      if (m && d && (d.type === 'fillet' || d.type === 'chamfer')) {
        const sel = (d.edges as EdgeSel).points, selPts: number[] = [];
        if (d.edges.mode === 'picked') m.edgeGroups.forEach((_, gi) => { if (sel.some((p: V3) => groupMatches(gi, p))) selPts.push(...groupPts(gi)); });
        if (selPts.length) overlayGroup.add(V.segs(selPts, V.lineMat(css('--accent'), 4, false, false)));
      }
      if (m && d && d.type === 'sm_flange' && d.edge) {
        overlayGroup.add(V.segs([...d.edge.p0, ...d.edge.p1], V.lineMat(css('--accent'), 4, false, false)));
      }
      if (m && d && d.type === 'shell') {
        for (const p of d.faces as V3[]) { const gi = faceGroupContaining(m, p); if (gi >= 0) overlayGroup.add(faceOverlay(m, gi, css('--accent'), 0.45)); }
        if (hoverFace >= 0 && hoverFace < m.faceGroups.length) overlayGroup.add(faceOverlay(m, hoverFace, css('--hover'), 0.35));
      }
      if (m && state.hoverEdge >= 0 && state.hoverEdge < m.edgeGroups.length && (s.tool === 'pickEdges' || s.tool === 'pickFlangeEdge')) {
        overlayGroup.add(V.segs(groupPts(state.hoverEdge), V.lineMat(css('--hover'), 4, false, false)));
      }
      V.request();
    };

    // ---------- Bocetos y planos ----------
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
        const normal: number[] = [], sel: number[] = [], cons: number[] = [], pts: V3[] = [];
        for (const e of f.entities) {
          let o; try { o = entityOutline(e, ev); } catch { continue; }
          if (o.pts.some((p) => !isFinite(p[0]) || !isFinite(p[1]))) continue;
          if (e.type === 'point') { pts.push(toWorld(fr, o.pts[0][0], o.pts[0][1])); continue; }
          const target = active && e.id === s.selEntity ? sel : (e.type === 'line' || e.type === 'arc') && e.construction ? cons : normal;
          const n = o.pts.length;
          for (let i = 0; i < (o.closed ? n : n - 1); i++) target.push(...toWorld(fr, o.pts[i][0], o.pts[i][1]), ...toWorld(fr, o.pts[(i + 1) % n][0], o.pts[(i + 1) % n][1]));
        }
        const col = active ? css('--sketch') : css('--sketch-idle');
        if (normal.length) sketchGroup.add(V.segs(normal, V.lineMat(col, active ? 2 : 1.5, false, !active)));
        if (cons.length) sketchGroup.add(V.segs(cons, V.lineMat(col, 1.5, true, false)));
        if (sel.length) sketchGroup.add(V.segs(sel, V.lineMat(css('--accent'), 3, false, false)));
        for (const p of pts) {
          const k = V.worldPerPx() * 4, c = tv(p), x = tv(fr.xDir).multiplyScalar(k), y = tv(fr.yDir).multiplyScalar(k);
          sketchGroup.add(V.segs([...c.clone().sub(x).toArray(), ...c.clone().add(x).toArray(), ...c.clone().sub(y).toArray(), ...c.clone().add(y).toArray()], V.lineMat(col, 2, false, false)));
        }
        if (active) {
          state.frame = fr;
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
          sketchGroup.add(V.segs([...toWorld(fr, -half, 0), ...toWorld(fr, half, 0)], V.lineMat('#d0443e', 1, true, false)));
          sketchGroup.add(V.segs([...toWorld(fr, 0, -half), ...toWorld(fr, 0, half)], V.lineMat('#3fa34d', 1, true, false)));
        }
      }
      if (!s.sketchId) state.frame = null;
      // Planos de origen (al elegir plano) y planos de trabajo (siempre)
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
        quad({ origin: [0, 0, 0], xDir: p.xDir, normal: p.normal, yDir: v3.cross(p.normal, p.xDir) }, name, s.tool === 'pickPlane', `Plano ${name}`);
      });
      for (const f of s.doc.features) {
        if (f.type !== 'workplane' || f.suppressed) continue;
        const fr = state.work.get(f.id);
        if (fr && s.mode !== 'sketch') quad(fr, 'work:' + f.id, true, f.name);
      }
      buildPreview(s);
      updateLabels();
      V.request();
    };

    const buildPreview = (s: State) => {
      V.clearGroup(previewObj);
      const fr = state.frame, h = state.hover;
      snapMarker.visible = false;
      if (!fr || !h || !s.tool || s.mode !== 'sketch') { V.request(); return; }
      if (state.snapped) { snapMarker.visible = true; snapMarker.position.copy(tv(toWorld(fr, h[0], h[1]))); }
      const W = (p: V2) => toWorld(fr, p[0], p[1]);
      const pts: number[] = [];
      const c = state.clicks;
      const loop = (ps: V2[], closed = true) => { for (let i = 0; i < ps.length - (closed ? 0 : 1); i++) pts.push(...W(ps[i]), ...W(ps[(i + 1) % ps.length])); };
      const circ = (cx: V2, r: number, n = 72, rot = 0) => { const ps: V2[] = []; for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; ps.push([cx[0] + r * Math.cos(a), cx[1] + r * Math.sin(a)]); } return ps; };
      if (s.tool === 'line' && state.chain.length) pts.push(...W(state.chain[state.chain.length - 1]), ...W(h));
      if (s.tool === 'rect' && c.length === 1) loop([c[0], [h[0], c[0][1]], h, [c[0][0], h[1]]]);
      if ((s.tool === 'circle' || s.tool === 'npoly') && c.length === 1) {
        const r = Math.hypot(h[0] - c[0][0], h[1] - c[0][1]);
        loop(circ(c[0], r, s.tool === 'circle' ? 72 : 6, s.tool === 'npoly' ? Math.atan2(h[1] - c[0][1], h[0] - c[0][0]) : 0));
        pts.push(...W(c[0]), ...W(h));
      }
      if (s.tool === 'arc' && c.length >= 1) {
        const r = Math.hypot((c[1] ?? h)[0] - c[0][0], (c[1] ?? h)[1] - c[0][1]);
        if (c.length === 1) pts.push(...W(c[0]), ...W(h));
        else {
          const a0 = Math.atan2(c[1][1] - c[0][1], c[1][0] - c[0][0]); let a1 = Math.atan2(h[1] - c[0][1], h[0] - c[0][0]);
          while (a1 <= a0) a1 += Math.PI * 2;
          const ps: V2[] = []; for (let i = 0; i <= 48; i++) { const a = a0 + ((a1 - a0) * i) / 48; ps.push([c[0][0] + r * Math.cos(a), c[0][1] + r * Math.sin(a)]); }
          loop(ps, false);
        }
      }
      if (s.tool === 'slot' && c.length >= 1) {
        if (c.length === 1) pts.push(...W(c[0]), ...W(h));
        else {
          const a = c[0], b = c[1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
          const w = Math.abs((h[0] - a[0]) * nx + (h[1] - a[1]) * ny) * 2;
          loop([[a[0] + nx * w / 2, a[1] + ny * w / 2], [b[0] + nx * w / 2, b[1] + ny * w / 2], [b[0] - nx * w / 2, b[1] - ny * w / 2], [a[0] - nx * w / 2, a[1] - ny * w / 2]]);
        }
      }
      if (pts.length) previewObj.add(V.segs(pts, V.lineMat(css('--accent'), 2, false, false)));
      V.request();
    };

    // ---------- Cotas ----------
    const updateLabels = () => {
      const s = useStore.getState();
      const sk = activeSketch(s);
      if (!sk || s.mode !== 'sketch' || !state.frame) { setLabels((l) => (l.length ? [] : l)); return; }
      const ev = safeEval(s), fr = state.frame, out: Label[] = [];
      const off = V.worldPerPx() * 14;
      const add = (e: SkEntity, field: string, u: number, v: number, val: number, expr: string, prefix = '') => {
        if (!isFinite(val) || !isFinite(u) || !isFinite(v)) return;
        const q = V.project(toWorld(fr, u, v));
        out.push({ key: `${e.id}.${field}`, x: q.x, y: q.y, text: prefix + fmt(val, 2), expr, entity: e.id, field, fx: !/^-?[\d.]+(\s*(mm|deg))?$/.test(expr.trim()) });
      };
      for (const e of sk.entities) {
        if (e.type === 'rect') {
          const x = ev(e.x), y = ev(e.y), w = ev(e.w), h = ev(e.h);
          add(e, 'w', x + w / 2, y - off, w, e.w); add(e, 'h', x + w + off, y + h / 2, h, e.h);
        } else if (e.type === 'circle' || e.type === 'npoly') {
          const r = ev(e.d) / 2;
          add(e, 'd', ev(e.cx) + r * 0.7071 + off * 0.7, ev(e.cy) + r * 0.7071 + off * 0.7, ev(e.d), e.d, 'Ø');
        } else if (e.type === 'arc') {
          const r = ev(e.r), am = ((ev(e.a0) + ev(e.a1)) / 2) * Math.PI / 180;
          add(e, 'r', ev(e.cx) + (r + off) * Math.cos(am), ev(e.cy) + (r + off) * Math.sin(am), r, e.r, 'R');
        } else if (e.type === 'slot') {
          add(e, 'w', ev(e.x2) + off, ev(e.y2) + ev(e.w) / 2 + off, ev(e.w), e.w);
        } else if (e.type === 'line') {
          const a: V2 = [ev(e.a[0]), ev(e.a[1])], b: V2 = [ev(e.b[0]), ev(e.b[1])];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const nx = -(b[1] - a[1]) / (L || 1), ny = (b[0] - a[0]) / (L || 1);
          add(e, 'len', (a[0] + b[0]) / 2 + nx * off, (a[1] + b[1]) / 2 + ny * off, L, r3(L));
        }
      }
      setLabels(out);
    };

    // ---------- Interacción ----------
    const toLocal = (ev: PointerEvent | MouseEvent): V2 | null => {
      const fr = state.frame; if (!fr) return null;
      const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(tv(fr.normal), tv(fr.origin));
      const hit = V.ray(ev).ray.intersectPlane(pl, new THREE.Vector3());
      if (!hit) return null;
      const d = hit.sub(tv(fr.origin));
      return [d.dot(tv(fr.xDir)), d.dot(tv(fr.yDir))];
    };
    const screenOfLocal = (p: V2) => V.project(toWorld(state.frame!, p[0], p[1]));
    const snap = (ev: PointerEvent | MouseEvent, raw: V2): V2 => {
      const s = useStore.getState(); const sk = activeSketch(s);
      state.snapped = false;
      const m = V.local(ev);
      if (sk) {
        const cands = [...snapPoints(sk, safeEval(s)), ...state.chain.slice(0, 1), ...state.clicks];
        let best: V2 | null = null, bd = 9;
        for (const p of cands) { const q = screenOfLocal(p); const d = Math.hypot(q.x - m.x, q.y - m.y); if (d < bd) { bd = d; best = p; } }
        if (best) { state.snapped = true; return [best[0], best[1]]; }
      }
      const step = niceStep(V.worldPerPx());
      let p: V2 = [Math.round(raw[0] / step) * step, Math.round(raw[1] / step) * step];
      const prev = s.tool === 'line' ? state.chain[state.chain.length - 1] : undefined;
      if (prev) {
        const tol = V.worldPerPx() * 8;
        if (Math.abs(p[1] - prev[1]) < tol) p = [p[0], prev[1]];
        if (Math.abs(p[0] - prev[0]) < tol) p = [prev[0], p[1]];
      }
      return p;
    };
    const nearestEntity = (ev: MouseEvent): string | null => {
      const s = useStore.getState(); const sk = activeSketch(s); if (!sk || !state.frame) return null;
      const evl = safeEval(s), m = V.local(ev);
      let best: string | null = null, bd = 7;
      for (const e of sk.entities) {
        let o; try { o = entityOutline(e, evl); } catch { continue; }
        const n = o.pts.length;
        if (n === 1) { const q = screenOfLocal(o.pts[0]); const d = Math.hypot(q.x - m.x, q.y - m.y); if (d < bd) { bd = d; best = e.id; } continue; }
        for (let i = 0; i < (o.closed ? n : n - 1); i++) {
          const a = screenOfLocal(o.pts[i]), b = screenOfLocal(o.pts[(i + 1) % n]);
          const A = new THREE.Vector2(a.x, a.y), B = new THREE.Vector2(b.x, b.y);
          const t = Math.max(0, Math.min(1, m.clone().sub(A).dot(B.clone().sub(A)) / Math.max(B.distanceToSquared(A), 1e-9)));
          const d = A.clone().lerp(B, t).distanceTo(m);
          if (d < bd) { bd = d; best = e.id; }
        }
      }
      return best;
    };
    const occluders = () => (state.partMesh ? [state.partMesh] : []);
    const hitPlane = (ev: MouseEvent): { key: string; dist: number } | null => {
      const hits = V.ray(ev).intersectObjects(originGroup.children.filter((c) => c.userData.plane));
      return hits[0] ? { key: hits[0].object.userData.plane, dist: hits[0].distance } : null;
    };
    const faceHit = (ev: MouseEvent) => {
      const m = pickMesh(); if (!m || !state.partMesh) return null;
      // la malla de selección puede ser la base (sin la operación en curso); se crea una temporal para el rayo
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

    const commitLineChain = (close: boolean) => {
      const s = useStore.getState();
      if (close && state.chain.length >= 3) {
        const pts = state.chain.map((p) => [r3(p[0]), r3(p[1])] as [string, string]);
        const ids = new Set(state.chainIds), sid = s.sketchId, pid = uid('p');
        s.commit((d) => {
          const sk = d.features.find((f) => f.id === sid) as SketchF;
          sk.entities = sk.entities.filter((e) => !ids.has(e.id));
          sk.entities.push({ id: pid, type: 'poly', pts });
        });
        useStore.setState({ selEntity: pid });
      }
      state.chain = []; state.chainIds = [];
    };

    /** Pestaña de chapa: arista recta + sus dos caras planas (la delgada da la dirección hacia fuera). */
    const flangeEdgeFrom = (gi: number) => {
      const m = pickMesh()!, a = groupPts(gi);
      const p0 = new THREE.Vector3(a[0], a[1], a[2]), p1 = new THREE.Vector3(a[a.length - 3], a[a.length - 2], a[a.length - 1]);
      const e = p1.clone().sub(p0); const L = e.length(); if (L < 1e-6) return null; e.normalize();
      // recta: todos los puntos sobre la línea
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

    let downAt: { x: number; y: number } | null = null;
    const onDown = (ev: PointerEvent) => { downAt = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev: PointerEvent) => {
      if (!downAt || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 4 || ev.button !== 0) { downAt = null; return; }
      downAt = null;
      const s = useStore.getState();
      const d = s.dialog && 'draft' in s.dialog ? s.dialog.draft : null;
      if (s.tool === 'pickPlane') {
        const ph = hitPlane(ev), fh = faceHit(ev);
        if (fh && (!ph || fh.distance <= ph.dist)) {
          if (!fh.planar) { s.notify('Selecciona una cara plana o un plano', 'error'); return; }
          const n = fh.normal, o = n.clone().multiplyScalar(fh.point.dot(n));
          let x = new THREE.Vector3(1, 0, 0).projectOnPlane(n);
          if (x.length() < 0.3) x = new THREE.Vector3(0, 1, 0).projectOnPlane(n);
          x.normalize();
          s.startSketch({ kind: 'custom', label: 'Cara de la pieza', origin: vArr(o), xDir: vArr(x), normal: vArr(n) });
          return;
        }
        if (ph) {
          if (ph.key.startsWith('work:')) s.startSketch({ kind: 'work', id: ph.key.slice(5) });
          else s.startSketch({ kind: 'std', name: ph.key as StdPlane, offset: '0' });
        }
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
      if (s.tool === 'pickFaces' && d?.type === 'shell') {
        const fh = faceHit(ev); if (!fh) return;
        const cur = d.faces as V3[];
        const idx = cur.findIndex((p) => faceGroupContaining(fh.mesh, p) === fh.group);
        s.updateDraft({ faces: idx >= 0 ? cur.filter((_, i) => i !== idx) : [...cur, vArr(fh.point)] });
        return;
      }
      if (s.mode !== 'sketch') return;
      const raw = toLocal(ev); if (!raw) return;
      const p = snap(ev, raw);
      const tool = s.tool;
      if (!tool) { useStore.setState({ selEntity: nearestEntity(ev) }); return; }
      if (tool === 'point') { s.addEntity({ id: uid('pt'), type: 'point', cx: r3(p[0]), cy: r3(p[1]) }); return; }
      if (tool === 'line') {
        if (!state.chain.length) { state.chain = [p]; state.chainIds = []; buildPreview(s); return; }
        const last = state.chain[state.chain.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1e-9) { commitLineChain(false); buildPreview(s); return; }
        const first = state.chain[0];
        const id = uid('l');
        s.addEntity({ id, type: 'line', a: [r3(last[0]), r3(last[1])], b: [r3(p[0]), r3(p[1])] });
        state.chainIds.push(id);
        if (state.chain.length >= 2 && Math.hypot(p[0] - first[0], p[1] - first[1]) < 1e-9) { commitLineChain(true); buildPreview(useStore.getState()); return; }
        state.chain.push(p);
        return;
      }
      const need = tool === 'arc' || tool === 'slot' ? 3 : 2;
      state.clicks.push(p);
      if (state.clicks.length < need) { buildPreview(s); return; }
      const c = state.clicks; state.clicks = [];
      if (tool === 'rect') {
        const w = p[0] - c[0][0], h = p[1] - c[0][1];
        if (Math.abs(w) < 1e-6 || Math.abs(h) < 1e-6) return;
        s.addEntity({ id: uid('r'), type: 'rect', x: r3(Math.min(c[0][0], p[0])), y: r3(Math.min(c[0][1], p[1])), w: r3(Math.abs(w)), h: r3(Math.abs(h)) });
      } else if (tool === 'circle' || tool === 'npoly') {
        const dd = 2 * Math.hypot(p[0] - c[0][0], p[1] - c[0][1]); if (dd < 1e-6) return;
        if (tool === 'circle') s.addEntity({ id: uid('c'), type: 'circle', cx: r3(c[0][0]), cy: r3(c[0][1]), d: r3(dd) });
        else s.addEntity({ id: uid('n'), type: 'npoly', cx: r3(c[0][0]), cy: r3(c[0][1]), d: r3(dd), n: '6', rot: r3((Math.atan2(p[1] - c[0][1], p[0] - c[0][0]) * 180) / Math.PI) });
      } else if (tool === 'arc') {
        const r = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]); if (r < 1e-6) return;
        const a0 = (Math.atan2(c[1][1] - c[0][1], c[1][0] - c[0][0]) * 180) / Math.PI, a1 = (Math.atan2(p[1] - c[0][1], p[0] - c[0][0]) * 180) / Math.PI;
        s.addEntity({ id: uid('a'), type: 'arc', cx: r3(c[0][0]), cy: r3(c[0][1]), r: r3(r), a0: r3(a0), a1: r3(a1) });
      } else if (tool === 'slot') {
        const a = c[0], b = c[1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const w = Math.abs((p[0] - a[0]) * (-(b[1] - a[1]) / L) + (p[1] - a[1]) * ((b[0] - a[0]) / L)) * 2;
        if (w < 1e-6) return;
        s.addEntity({ id: uid('sl'), type: 'slot', x1: r3(a[0]), y1: r3(a[1]), x2: r3(b[0]), y2: r3(b[1]), w: r3(w) });
      }
    };
    const onMove = (ev: PointerEvent) => {
      const s = useStore.getState();
      if (s.tool === 'pickPlane') {
        const ph = hitPlane(ev), key = ph?.key ?? '';
        if (key !== state.hoverPlane) { state.hoverPlane = key; buildSketches(s); }
        const lbl = originGroup.children.find((c) => c.userData.plane === key)?.userData.label;
        setHint(lbl ? `${lbl}` : 'Elige un plano o una cara plana');
        return;
      }
      if (s.tool === 'pickEdges' || s.tool === 'pickFlangeEdge') {
        const m = pickMesh(); if (!m) return;
        const gi = V.nearestEdge(ev, m, null, occluders())?.group ?? -1;
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
        const p = s.tool ? snap(ev, raw) : raw;
        state.hover = p;
        useStore.setState({ cursor: p });
        if (s.tool) buildPreview(s);
      }
    };
    const onDbl = () => { const s = useStore.getState(); if (s.tool === 'line') { commitLineChain(false); buildPreview(s); } };
    const cvs = V.renderer.domElement;
    cvs.addEventListener('pointerdown', onDown);
    cvs.addEventListener('pointerup', onUp);
    cvs.addEventListener('pointermove', onMove);
    cvs.addEventListener('dblclick', onDbl);
    cvs.addEventListener('contextmenu', (e) => e.preventDefault());
    cvs.addEventListener('pointerleave', () => { state.hover = null; useStore.setState({ cursor: null }); buildPreview(useStore.getState()); });

    const cancelTool = () => { state.chain = []; state.chainIds = []; state.clicks = []; buildPreview(useStore.getState()); };
    const applyMouse = (s: State) => {
      const picking = s.tool === 'pickEdges' || s.tool === 'pickPlane' || s.tool === 'pickFaces' || s.tool === 'pickFlangeEdge';
      V.setMouse(s.mode === 'sketch' || picking, s.mode === 'sketch');
      cvs.style.cursor = s.tool && !picking ? 'crosshair' : s.tool ? 'pointer' : 'default';
    };

    const s0 = useStore.getState();
    applyMouse(s0); buildPart(s0); buildSketches(s0);
    let firstMesh = !s0.result?.mesh;
    const unsub = useStore.subscribe((s, p) => {
      if (s.kind !== 'part') return;
      if (s.pickBase !== p.pickBase) buildOverlay(s);
      if (s.result !== p.result || s.preview !== p.preview || s.dialog !== p.dialog || s.showEdges !== p.showEdges || s.mode !== p.mode || s.doc.iProperties.material !== p.doc.iProperties.material) {
        buildPart(s);
        if (firstMesh && s.result?.mesh) { firstMesh = false; setView('home'); }
      }
      if (s.doc !== p.doc || s.sketchId !== p.sketchId || s.selEntity !== p.selEntity || s.tool !== p.tool || s.mode !== p.mode) buildSketches(s);
      if (s.tool !== p.tool || s.mode !== p.mode) { applyMouse(s); cancelTool(); setHint(''); state.hoverEdge = -1; hoverFace = -1; }
      if (s.view !== p.view) setView(s.view.name);
    });
    setView('home');
    return () => { unsub(); V.dispose(); };
  }, []);

  const commitLabel = useCallback((lb: Label, value: string) => {
    const s = useStore.getState();
    const sk = activeSketch(s);
    const e = sk?.entities.find((x) => x.id === lb.entity);
    if (!e) return;
    try {
      const ev = makeEval(s.doc.parameters);
      const v = ev(value);
      if (lb.field === 'len' && e.type === 'line') {
        const a: V2 = [ev(e.a[0]), ev(e.a[1])], b: V2 = [ev(e.b[0]), ev(e.b[1])];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        s.updateEntity(e.id, { b: [r3(a[0] + ((b[0] - a[0]) / L) * v), r3(a[1] + ((b[1] - a[1]) / L) * v)] } as never);
      } else {
        if (!(v > 0)) throw new Error('La cota debe ser positiva');
        s.updateEntity(e.id, { [lb.field]: value.trim() } as never);
      }
    } catch (err) { s.notify((err as Error).message, 'error'); }
  }, []);

  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.tool);
  const hints: Record<string, string> = {
    pickEdges: 'Selecciona aristas · clic de nuevo para quitar',
    pickFaces: 'Selecciona las caras a eliminar (abiertas) · clic de nuevo para quitar',
    pickFlangeEdge: 'Selecciona la arista superior del borde de la chapa',
  };

  return (
    <div className="viewport" ref={host}>
      <div className="viewcube" ref={cubeHost} />
      <button className="vp-home" title="Vista de inicio (F6)" onClick={() => useStore.getState().setView('home')}>
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
      </button>
      {mode === 'sketch' && labels.map((lb) => (
        editing?.key === lb.key ? (
          <input key={lb.key} className="dim-edit" style={{ left: lb.x, top: lb.y }} autoFocus value={editing.value}
            onChange={(e) => setEditing({ key: lb.key, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { commitLabel(lb, editing.value); setEditing(null); }
              if (e.key === 'Escape') setEditing(null);
              e.stopPropagation();
            }}
            onBlur={() => setEditing(null)} />
        ) : (
          <button key={lb.key} className={`dim ${lb.fx ? 'fx' : ''}`} style={{ left: lb.x, top: lb.y }}
            title={lb.fx ? `fx: ${lb.expr} — doble clic para editar` : 'Doble clic para editar la cota'}
            onDoubleClick={() => setEditing({ key: lb.key, value: lb.expr })}
            onClick={() => useStore.setState({ selEntity: lb.entity })}>
            {lb.fx && <span className="fxmark">fx:</span>}{lb.text}
          </button>
        )
      ))}
      {hint && <div className="vp-hint">{hint}</div>}
      {tool && hints[tool] && <div className="vp-hint">{hints[tool]}</div>}
    </div>
  );
}
