import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { useStore, activeSketch, type State } from '../core/store';
import { makeEval, fmt } from '../core/expr';
import {
  planeFrame, toWorld, entityOutline, consumedSketches, uid, v3, MATERIALS, PLANE_STD,
  type Frame, type V3, type V2, type SkEntity, type SketchF, type StdPlane, type EdgeSel,
} from '../core/doc';
import type { MeshData } from '../core/cadClient';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000';
const tv = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);
const r3 = (x: number) => String(Math.round(x * 1000) / 1000);

interface Label { key: string; x: number; y: number; text: string; expr: string; entity: string; field: string; fx: boolean }

function niceStep(worldPerPx: number) {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  return steps.find((s) => s / worldPerPx >= 14) ?? 1000;
}

/** Puntos de enganche de las entidades del boceto (extremos, esquinas, centros). */
function snapPoints(sk: SketchF, ev: (s: string) => number): V2[] {
  const pts: V2[] = [[0, 0]];
  for (const e of sk.entities) {
    try {
      if (e.type === 'circle' || e.type === 'npoly') pts.push([ev(e.cx), ev(e.cy)]);
      if (e.type !== 'circle') pts.push(...entityOutline(e, ev).pts);
    } catch { /* expresión inválida */ }
  }
  return pts;
}

export default function Viewport() {
  const host = useRef<HTMLDivElement>(null);
  const cubeHost = useRef<HTMLDivElement>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const [hint, setHint] = useState('');
  const api = useRef<any>({});

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    renderer.domElement.className = 'vp-canvas';

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    camera.up.set(0, 0, 1);
    camera.position.set(400, -400, 400);
    camera.zoom = 1;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    controls.enableDamping = false;
    controls.rotateSpeed = 0.9;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3b2, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    camera.add(key); key.position.set(0.4, 0.8, 1);
    const fill = new THREE.DirectionalLight(0xffffff, 0.9);
    camera.add(fill); fill.position.set(-1, -0.3, 0.5);
    scene.add(camera);

    const partGroup = new THREE.Group(); scene.add(partGroup);
    const sketchGroup = new THREE.Group(); scene.add(sketchGroup);
    const originGroup = new THREE.Group(); scene.add(originGroup);
    const overlayGroup = new THREE.Group(); scene.add(overlayGroup);

    const lineMats: LineMaterial[] = [];
    const lineMat = (color: string, width: number, dashed = false, depthTest = true) => {
      const m = new LineMaterial({ color: new THREE.Color(color), linewidth: width, dashed, dashSize: 3, gapSize: 2, depthTest, transparent: !depthTest });
      lineMats.push(m);
      m.resolution.set(el.clientWidth, el.clientHeight);
      return m;
    };
    const segs = (pts: number[], mat: LineMaterial) => {
      const g = new LineSegmentsGeometry(); g.setPositions(pts);
      const l = new LineSegments2(g, mat); l.computeLineDistances(); return l;
    };
    const clearGroup = (g: THREE.Group) => {
      for (const c of [...g.children]) {
        g.remove(c);
        c.traverse((o: any) => { o.geometry?.dispose?.(); if (o.material && !lineMats.includes(o.material)) o.material.dispose?.(); });
      }
    };

    // --- Triada de origen ---
    const triad = new THREE.Group();
    const axisLine = (dir: V3, color: number) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), tv(dir).multiplyScalar(30)]);
      return new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 }));
    };
    triad.add(axisLine([1, 0, 0], 0xd0443e), axisLine([0, 1, 0], 0x3fa34d), axisLine([0, 0, 1], 0x3d6fd6));
    triad.renderOrder = 5;
    scene.add(triad);

    let needs = true;
    const request = () => { needs = true; };
    const state = {
      mesh: null as MeshData | null,
      partMesh: null as THREE.Mesh | null,
      bbox: new THREE.Box3(new THREE.Vector3(-100, -100, -100), new THREE.Vector3(100, 100, 100)),
      frame: null as Frame | null,
      chain: [] as V2[], chainIds: [] as string[],
      clicks: [] as V2[],
      hover: null as V2 | null,
      snapped: false,
      hoverEdge: -1,
      hoverPlane: '' as string,
      saved: null as null | { pos: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; zoom: number },
    };

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      const aspect = w / Math.max(h, 1), H = 300;
      camera.left = (-H * aspect) / 2; camera.right = (H * aspect) / 2; camera.top = H / 2; camera.bottom = -H / 2;
      camera.updateProjectionMatrix();
      lineMats.forEach((m) => m.resolution.set(w, h));
      request();
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    const worldPerPx = () => (camera.top - camera.bottom) / camera.zoom / Math.max(el.clientHeight, 1);

    // ---------- Vistas ----------
    const fitTo = (box: THREE.Box3, dir: THREE.Vector3, up: THREE.Vector3) => {
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length() || 200;
      controls.target.copy(c);
      camera.up.copy(up);
      camera.position.copy(c).addScaledVector(dir.clone().normalize(), -size * 4);
      const aspect = el.clientWidth / Math.max(el.clientHeight, 1);
      camera.zoom = Math.min(300 / (size * 1.15), (300 * aspect) / (size * 1.15));
      camera.updateProjectionMatrix();
      camera.lookAt(c);
      controls.update();
      request();
    };
    const VIEWS: Record<string, [V3, V3]> = {
      home: [[-1, 1, -0.8], [0, 0, 1]], front: [[0, 1, 0], [0, 0, 1]], back: [[0, -1, 0], [0, 0, 1]],
      top: [[0, 0, -1], [0, 1, 0]], bottom: [[0, 0, 1], [0, -1, 0]], right: [[-1, 0, 0], [0, 0, 1]], left: [[1, 0, 0], [0, 0, 1]],
    };
    const viewBox = () => {
      const b = state.partMesh ? state.bbox.clone() : new THREE.Box3(new THREE.Vector3(-60, -60, -60), new THREE.Vector3(60, 60, 60));
      return b;
    };
    const setView = (name: string) => {
      const s = useStore.getState();
      if (name === 'sketch') {
        const sk = activeSketch(s);
        if (!sk) return;
        state.saved = { pos: camera.position.clone(), target: controls.target.clone(), up: camera.up.clone(), zoom: camera.zoom };
        const ev = safeEval(s);
        const fr = planeFrame(sk.plane, ev);
        const box = new THREE.Box3().setFromCenterAndSize(tv(fr.origin), new THREE.Vector3(160, 160, 160));
        if (state.partMesh) box.union(state.bbox);
        fitTo(box, tv(fr.normal).negate(), tv(fr.yDir));
        return;
      }
      if (name === 'restore') {
        if (state.saved) {
          camera.position.copy(state.saved.pos); controls.target.copy(state.saved.target); camera.up.copy(state.saved.up);
          camera.zoom = state.saved.zoom; camera.updateProjectionMatrix(); camera.lookAt(controls.target); controls.update(); request();
        }
        return;
      }
      if (name === 'fit') {
        const dir = controls.target.clone().sub(camera.position);
        return fitTo(viewBox(), dir, camera.up.clone());
      }
      const v = VIEWS[name];
      if (v) fitTo(viewBox(), tv(v[0]), tv(v[1]));
    };
    api.current.setView = setView;
    api.current.viewFromNormal = (n: THREE.Vector3) => {
      const up = Math.abs(n.z) > 0.9 ? new THREE.Vector3(0, n.z > 0 ? 1 : -1, 0) : new THREE.Vector3(0, 0, 1);
      fitTo(viewBox(), n.clone().negate(), up);
    };

    const safeEval = (s: State) => {
      const e = makeEval(s.doc.parameters);
      return (x: string) => { try { return e(x); } catch { return NaN; } };
    };

    // ---------- Pieza ----------
    const buildPart = (s: State) => {
      clearGroup(partGroup);
      state.partMesh = null;
      const res = (s.dialog && 'draft' in s.dialog && s.preview) ? s.preview : s.result;
      const m = res?.mesh ?? null;
      state.mesh = m;
      if (!m || !m.triangles.length) { request(); return; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.vertices, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
      g.setIndex(new THREE.BufferAttribute(m.triangles, 1));
      g.computeBoundingBox();
      state.bbox.copy(g.boundingBox!);
      const color = MATERIALS.find((x) => x.name === s.doc.iProperties.material)?.color ?? '#c3c8cf';
      const isPreview = res === s.preview && !!s.preview;
      const mat = new THREE.MeshStandardMaterial({
        color, metalness: 0.25, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        transparent: s.mode === 'sketch', opacity: s.mode === 'sketch' ? 0.35 : 1,
        emissive: isPreview ? new THREE.Color(css('--accent')) : new THREE.Color(0), emissiveIntensity: isPreview ? 0.12 : 0,
      });
      const mesh = new THREE.Mesh(g, mat);
      partGroup.add(mesh);
      state.partMesh = mesh;
      if (s.showEdges && m.lines.length) {
        const eg = new THREE.BufferGeometry();
        eg.setAttribute('position', new THREE.BufferAttribute(m.lines, 3));
        const edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: css('--edge'), transparent: true, opacity: s.mode === 'sketch' ? 0.35 : 1 }));
        partGroup.add(edges);
      }
      buildEdgeOverlay(s);
      request();
    };

    // Aristas seleccionadas / resaltadas para empalme y chaflán
    // Para empalme/chaflán se seleccionan aristas del sólido ANTES de la operación (la vista previa ya las redondea)
    const pickMesh = (): MeshData | null => {
      const s = useStore.getState();
      return s.pickBase?.mesh ?? state.mesh;
    };
    const groupPts = (gi: number): number[] => {
      const m = pickMesh()!; const g = m.edgeGroups[gi];
      return Array.from(m.lines.subarray(g.start * 3, (g.start + g.count) * 3));
    };
    const groupMatches = (gi: number, p: V3) => {
      const a = groupPts(gi);
      for (let i = 0; i + 5 < a.length; i += 6) {
        const A = new THREE.Vector3(a[i], a[i + 1], a[i + 2]), B = new THREE.Vector3(a[i + 3], a[i + 4], a[i + 5]);
        const seg = new THREE.Line3(A, B), q = new THREE.Vector3();
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
    const buildEdgeOverlay = (s: State) => {
      clearGroup(overlayGroup);
      const d = s.dialog && 'draft' in s.dialog ? s.dialog.draft : null;
      const m = pickMesh();
      if (!m || !d || (d.type !== 'fillet' && d.type !== 'chamfer')) { request(); return; }
      const sel = (d.edges as EdgeSel).points;
      const selPts: number[] = [];
      if (d.edges.mode === 'picked') {
        m.edgeGroups.forEach((_, gi) => { if (sel.some((p) => groupMatches(gi, p))) selPts.push(...groupPts(gi)); });
      }
      if (selPts.length) overlayGroup.add(segs(selPts, lineMat(css('--accent'), 4, false, false)));
      if (state.hoverEdge >= 0 && state.hoverEdge < m.edgeGroups.length) overlayGroup.add(segs(groupPts(state.hoverEdge), lineMat(css('--hover'), 4, false, false)));
      request();
    };

    // ---------- Bocetos ----------
    const buildSketches = (s: State) => {
      clearGroup(sketchGroup);
      const ev = safeEval(s);
      const used = consumedSketches(s.doc);
      const showOrigin = s.tool === 'pickPlane';
      for (const f of s.doc.features) {
        if (f.type !== 'sketch' || f.suppressed) continue;
        const active = f.id === s.sketchId;
        if (!active && used.has(f.id)) continue;
        const fr = planeFrame(f.plane, ev);
        if (!isFinite(fr.origin[0])) continue;
        const normal: number[] = [], sel: number[] = [], cons: number[] = [];
        for (const e of f.entities) {
          let o; try { o = entityOutline(e, ev); } catch { continue; }
          if (o.pts.some((p) => !isFinite(p[0]) || !isFinite(p[1]))) continue;
          const target = active && e.id === s.selEntity ? sel : e.type === 'line' && e.construction ? cons : normal;
          const n = o.pts.length;
          for (let i = 0; i < (o.closed ? n : n - 1); i++) {
            const a = toWorld(fr, o.pts[i][0], o.pts[i][1]), b = toWorld(fr, o.pts[(i + 1) % n][0], o.pts[(i + 1) % n][1]);
            target.push(...a, ...b);
          }
        }
        const col = active ? css('--sketch') : css('--sketch-idle');
        if (normal.length) sketchGroup.add(segs(normal, lineMat(col, active ? 2 : 1.5, false, !active)));
        if (cons.length) sketchGroup.add(segs(cons, lineMat(col, 1.5, true, false)));
        if (sel.length) sketchGroup.add(segs(sel, lineMat(css('--accent'), 3, false, false)));
        if (active) {
          state.frame = fr;
          // Rejilla del boceto y ejes locales
          const wpp = worldPerPx();
          const step = niceStep(wpp) * 5;
          const ext = Math.max(200, state.bbox.getSize(new THREE.Vector3()).length());
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
          sketchGroup.add(segs([...toWorld(fr, -half, 0), ...toWorld(fr, half, 0)], lineMat('#d0443e', 1, true, false)));
          sketchGroup.add(segs([...toWorld(fr, 0, -half), ...toWorld(fr, 0, half)], lineMat('#3fa34d', 1, true, false)));
        }
      }
      if (!s.sketchId) state.frame = null;
      // Planos de origen para elegir el plano del boceto
      clearGroup(originGroup);
      if (showOrigin) {
        const size = Math.max(80, state.bbox.getSize(new THREE.Vector3()).length() * 0.45);
        (['XY', 'XZ', 'YZ'] as StdPlane[]).forEach((name) => {
          const p = PLANE_STD[name];
          const fr: Frame = { origin: [0, 0, 0], xDir: p.xDir, normal: p.normal, yDir: v3.cross(p.normal, p.xDir) };
          const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => tv(toWorld(fr, u * size / 2, v * size / 2)));
          const geo = new THREE.BufferGeometry().setFromPoints([corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]]);
          geo.computeVertexNormals();
          const hov = state.hoverPlane === name;
          const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: css(hov ? '--accent' : '--plane'), transparent: true, opacity: hov ? 0.35 : 0.16, side: THREE.DoubleSide, depthWrite: false }));
          mesh.userData.plane = name;
          originGroup.add(mesh);
          const border: number[] = [];
          for (let i = 0; i < 4; i++) border.push(...corners[i].toArray(), ...corners[(i + 1) % 4].toArray());
          originGroup.add(segs(border, lineMat(css(hov ? '--accent' : '--plane'), hov ? 2 : 1, false, true)));
        });
      }
      buildPreview(s);
      updateLabels();
      request();
    };

    // Vista previa de la herramienta activa de boceto
    const previewObj = new THREE.Group(); scene.add(previewObj);
    const snapMarker = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: 0xf2b600, depthTest: false, transparent: true }));
    snapMarker.renderOrder = 10;
    scene.add(snapMarker); snapMarker.visible = false;
    const buildPreview = (s: State) => {
      clearGroup(previewObj);
      const fr = state.frame, h = state.hover;
      snapMarker.visible = false;
      if (!fr || !h || !s.tool || s.mode !== 'sketch') { request(); return; }
      if (state.snapped) {
        snapMarker.visible = true;
        snapMarker.position.copy(tv(toWorld(fr, h[0], h[1])));
        snapMarker.quaternion.copy(camera.quaternion);
        snapMarker.scale.setScalar(worldPerPx() * 5);
      }
      const W = (p: V2) => toWorld(fr, p[0], p[1]);
      const pts: number[] = [];
      const c = state.clicks;
      const loop = (ps: V2[]) => { for (let i = 0; i < ps.length; i++) pts.push(...W(ps[i]), ...W(ps[(i + 1) % ps.length])); };
      if (s.tool === 'line' && state.chain.length) pts.push(...W(state.chain[state.chain.length - 1]), ...W(h));
      if (s.tool === 'rect' && c.length === 1) loop([c[0], [h[0], c[0][1]], h, [c[0][0], h[1]]]);
      if ((s.tool === 'circle' || s.tool === 'npoly') && c.length === 1) {
        const r = Math.hypot(h[0] - c[0][0], h[1] - c[0][1]);
        const n = s.tool === 'circle' ? 72 : 6;
        const rot = s.tool === 'npoly' ? Math.atan2(h[1] - c[0][1], h[0] - c[0][0]) : 0;
        const ps: V2[] = [];
        for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; ps.push([c[0][0] + r * Math.cos(a), c[0][1] + r * Math.sin(a)]); }
        loop(ps);
        pts.push(...W(c[0]), ...W(h));
      }
      if (pts.length) previewObj.add(segs(pts, lineMat(css('--accent'), 2, false, false)));
      request();
    };

    // ---------- Cotas (etiquetas HTML) ----------
    const project = (p: V3) => {
      const v = tv(p).project(camera);
      return { x: (v.x * 0.5 + 0.5) * el.clientWidth, y: (-v.y * 0.5 + 0.5) * el.clientHeight };
    };
    const updateLabels = () => {
      const s = useStore.getState();
      const sk = activeSketch(s);
      if (!sk || s.mode !== 'sketch' || !state.frame) { setLabels((l) => (l.length ? [] : l)); return; }
      const ev = safeEval(s), fr = state.frame, out: Label[] = [];
      const off = worldPerPx() * 14;
      const add = (e: SkEntity, field: string, u: number, v: number, val: number, expr: string, prefix = '') => {
        if (!isFinite(val) || !isFinite(u) || !isFinite(v)) return;
        const q = project(toWorld(fr, u, v));
        out.push({ key: `${e.id}.${field}`, x: q.x, y: q.y, text: prefix + fmt(val, 2), expr, entity: e.id, field, fx: !/^-?[\d.]+(\s*mm)?$/.test(expr.trim()) });
      };
      for (const e of sk.entities) {
        if (e.type === 'rect') {
          const x = ev(e.x), y = ev(e.y), w = ev(e.w), h = ev(e.h);
          add(e, 'w', x + w / 2, y - off, w, e.w);
          add(e, 'h', x + w + off, y + h / 2, h, e.h);
        } else if (e.type === 'circle' || e.type === 'npoly') {
          const r = ev(e.d) / 2;
          add(e, 'd', ev(e.cx) + r * 0.7071 + off * 0.7, ev(e.cy) + r * 0.7071 + off * 0.7, ev(e.d), e.d, 'Ø');
        } else if (e.type === 'line') {
          const a: V2 = [ev(e.a[0]), ev(e.a[1])], b: V2 = [ev(e.b[0]), ev(e.b[1])];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const nx = -(b[1] - a[1]) / (L || 1), ny = (b[0] - a[0]) / (L || 1);
          add(e, 'len', (a[0] + b[0]) / 2 + nx * off, (a[1] + b[1]) / 2 + ny * off, L, r3(L));
        }
      }
      setLabels(out);
    };
    api.current.updateLabels = updateLabels;

    // ---------- Interacción ----------
    const raycaster = new THREE.Raycaster();
    const ndc = (ev: PointerEvent | MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    };
    const toLocal = (ev: PointerEvent | MouseEvent): V2 | null => {
      const fr = state.frame; if (!fr) return null;
      raycaster.setFromCamera(ndc(ev), camera);
      const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(tv(fr.normal), tv(fr.origin));
      const hit = raycaster.ray.intersectPlane(pl, new THREE.Vector3());
      if (!hit) return null;
      const d = hit.sub(tv(fr.origin));
      return [d.dot(tv(fr.xDir)), d.dot(tv(fr.yDir))];
    };
    const screenOfLocal = (p: V2) => project(toWorld(state.frame!, p[0], p[1]));

    const snap = (ev: PointerEvent | MouseEvent, raw: V2): V2 => {
      const s = useStore.getState(); const sk = activeSketch(s);
      state.snapped = false;
      const m = { x: ev.clientX - renderer.domElement.getBoundingClientRect().left, y: ev.clientY - renderer.domElement.getBoundingClientRect().top };
      if (sk) {
        const cands = [...snapPoints(sk, safeEval(s)), ...state.chain.slice(0, 1)];
        let best: V2 | null = null, bd = 9;
        for (const p of cands) { const q = screenOfLocal(p); const d = Math.hypot(q.x - m.x, q.y - m.y); if (d < bd) { bd = d; best = p; } }
        if (best) { state.snapped = true; return [best[0], best[1]]; }
      }
      const step = niceStep(worldPerPx());
      let p: V2 = [Math.round(raw[0] / step) * step, Math.round(raw[1] / step) * step];
      // Inferencia horizontal/vertical respecto del punto anterior
      const prev = s.tool === 'line' ? state.chain[state.chain.length - 1] : undefined;
      if (prev) {
        const tol = worldPerPx() * 8;
        if (Math.abs(p[1] - prev[1]) < tol) p = [p[0], prev[1]];
        if (Math.abs(p[0] - prev[0]) < tol) p = [prev[0], p[1]];
      }
      return p;
    };

    const nearestEntity = (ev: MouseEvent): string | null => {
      const s = useStore.getState(); const sk = activeSketch(s); if (!sk || !state.frame) return null;
      const evl = safeEval(s);
      const r = renderer.domElement.getBoundingClientRect();
      const m = new THREE.Vector2(ev.clientX - r.left, ev.clientY - r.top);
      let best: string | null = null, bd = 7;
      for (const e of sk.entities) {
        let o; try { o = entityOutline(e, evl); } catch { continue; }
        const n = o.pts.length;
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

    const nearestEdge = (ev: MouseEvent): number => {
      const m = pickMesh(); if (!m) return -1;
      const r = renderer.domElement.getBoundingClientRect();
      const P = new THREE.Vector2(ev.clientX - r.left, ev.clientY - r.top);
      let best = -1, bd = 8;
      const camDir = controls.target.clone().sub(camera.position).normalize();
      // Oclusión aproximada: se descartan aristas detrás de la superficie visible
      raycaster.setFromCamera(ndc(ev), camera);
      const hit = state.partMesh ? raycaster.intersectObject(state.partMesh)[0] : undefined;
      const depthLimit = hit ? hit.point.dot(camDir) + worldPerPx() * 6 : Infinity;
      m.edgeGroups.forEach((g, gi) => {
        const a = m.lines;
        for (let i = g.start; i + 1 < g.start + g.count; i += 2) {
          const A3: V3 = [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]], B3: V3 = [a[i * 3 + 3], a[i * 3 + 4], a[i * 3 + 5]];
          const pa = project(A3), pb = project(B3);
          const A = new THREE.Vector2(pa.x, pa.y), B = new THREE.Vector2(pb.x, pb.y);
          const t = Math.max(0, Math.min(1, P.clone().sub(A).dot(B.clone().sub(A)) / Math.max(B.distanceToSquared(A), 1e-9)));
          const d = A.clone().lerp(B, t).distanceTo(P);
          if (d < bd) {
            const W3 = tv(A3).lerp(tv(B3), t);
            if (W3.dot(camDir) <= depthLimit) { bd = d; best = gi; }
          }
        }
      });
      return best;
    };

    const pickFacePlane = (ev: MouseEvent) => {
      if (!state.partMesh || !state.mesh) return null;
      raycaster.setFromCamera(ndc(ev), camera);
      const hit = raycaster.intersectObject(state.partMesh)[0];
      if (!hit || hit.faceIndex == null) return null;
      const m = state.mesh;
      const gIdx = m.faceGroups.findIndex((g) => hit.faceIndex! * 3 >= g.start && hit.faceIndex! * 3 < g.start + g.count);
      if (gIdx < 0) return null;
      const g = m.faceGroups[gIdx];
      const n0 = new THREE.Vector3();
      let planar = true;
      for (let i = g.start; i < g.start + g.count; i++) {
        const vi = m.triangles[i];
        const n = new THREE.Vector3(m.normals[vi * 3], m.normals[vi * 3 + 1], m.normals[vi * 3 + 2]);
        if (i === g.start) n0.copy(n); else if (n.angleTo(n0) > 1e-3) { planar = false; break; }
      }
      return { planar, normal: n0.normalize(), point: hit.point.clone() };
    };

    const hitPlane = (ev: MouseEvent): string => {
      raycaster.setFromCamera(ndc(ev), camera);
      const hits = raycaster.intersectObjects(originGroup.children.filter((c) => c.userData.plane));
      return hits[0]?.object.userData.plane ?? '';
    };

    const commitLineChain = (close: boolean) => {
      const s = useStore.getState();
      if (close && state.chain.length >= 3) {
        const pts = state.chain.map((p) => [r3(p[0]), r3(p[1])] as [string, string]);
        const ids = new Set(state.chainIds);
        const sid = s.sketchId;
        const pid = uid('p');
        s.commit((d) => {
          const sk = d.features.find((f) => f.id === sid) as SketchF;
          sk.entities = sk.entities.filter((e) => !ids.has(e.id));
          sk.entities.push({ id: pid, type: 'poly', pts });
        });
        useStore.setState({ selEntity: pid });
      }
      state.chain = []; state.chainIds = [];
    };

    let downAt: { x: number; y: number } | null = null;
    const onDown = (ev: PointerEvent) => { downAt = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev: PointerEvent) => {
      if (!downAt || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 4 || ev.button !== 0) { downAt = null; return; }
      downAt = null;
      const s = useStore.getState();
      if (s.tool === 'pickPlane') {
        const pn = hitPlane(ev);
        const face = pickFacePlane(ev);
        if (face && (!pn || true)) {
          // Cara del sólido delante de los planos de origen
          raycaster.setFromCamera(ndc(ev), camera);
          const fh = state.partMesh ? raycaster.intersectObject(state.partMesh)[0] : undefined;
          const ph = raycaster.intersectObjects(originGroup.children.filter((c) => c.userData.plane))[0];
          if (fh && (!ph || fh.distance <= ph.distance)) {
            if (!face.planar) { s.notify('Selecciona una cara plana o un plano de origen', 'error'); return; }
            const n = face.normal;
            const o = n.clone().multiplyScalar(face.point.dot(n));
            let x = new THREE.Vector3(1, 0, 0).projectOnPlane(n);
            if (x.length() < 0.3) x = new THREE.Vector3(0, 1, 0).projectOnPlane(n);
            x.normalize();
            const r = (v: THREE.Vector3): V3 => [Number(v.x.toFixed(6)), Number(v.y.toFixed(6)), Number(v.z.toFixed(6))];
            s.startSketch({ kind: 'custom', label: 'Cara de la pieza', origin: r(o), xDir: r(x), normal: r(n) });
            return;
          }
        }
        if (pn) s.startSketch({ kind: 'std', name: pn as StdPlane, offset: '0' });
        return;
      }
      if (s.tool === 'pickEdges') {
        const gi = nearestEdge(ev);
        const d = s.dialog && 'draft' in s.dialog ? s.dialog.draft : null;
        if (gi < 0 || !d || (d.type !== 'fillet' && d.type !== 'chamfer')) return;
        const p = edgeRefPoint(gi);
        const pts = d.edges.points;
        const existing = pts.findIndex((q) => groupMatches(gi, q));
        const next = existing >= 0 ? pts.filter((_, i) => i !== existing) : [...pts, p];
        s.updateDraft({ edges: { mode: 'picked', points: next } } as never);
        return;
      }
      if (s.mode !== 'sketch') {
        // Selección de cara para un nuevo boceto rápido: no implementado en modo modelo
        return;
      }
      const raw = toLocal(ev); if (!raw) return;
      const p = snap(ev, raw);
      const tool = s.tool;
      if (!tool) { useStore.setState({ selEntity: nearestEntity(ev) }); return; }
      if (tool === 'line') {
        if (!state.chain.length) { state.chain = [p]; state.chainIds = []; buildPreview(s); return; }
        const last = state.chain[state.chain.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1e-9) { commitLineChain(false); buildPreview(s); return; }
        const first = state.chain[0];
        if (state.chain.length >= 2 && Math.hypot(p[0] - first[0], p[1] - first[1]) < 1e-9) {
          // Línea que cierra en el primer punto
          state.chain.push(p);
          state.chain.pop();
          const id = uid('l');
          s.addEntity({ id, type: 'line', a: [r3(last[0]), r3(last[1])], b: [r3(p[0]), r3(p[1])] });
          state.chainIds.push(id);
          commitLineChain(true);
          buildPreview(useStore.getState());
          return;
        }
        const id = uid('l');
        s.addEntity({ id, type: 'line', a: [r3(last[0]), r3(last[1])], b: [r3(p[0]), r3(p[1])] });
        state.chainIds.push(id);
        state.chain.push(p);
        return;
      }
      if (!state.clicks.length) { state.clicks = [p]; buildPreview(s); return; }
      const c = state.clicks[0];
      state.clicks = [];
      if (tool === 'rect') {
        const w = p[0] - c[0], h = p[1] - c[1];
        if (Math.abs(w) < 1e-6 || Math.abs(h) < 1e-6) return;
        s.addEntity({ id: uid('r'), type: 'rect', x: r3(Math.min(c[0], p[0])), y: r3(Math.min(c[1], p[1])), w: r3(Math.abs(w)), h: r3(Math.abs(h)) });
      } else if (tool === 'circle') {
        const d = 2 * Math.hypot(p[0] - c[0], p[1] - c[1]);
        if (d < 1e-6) return;
        s.addEntity({ id: uid('c'), type: 'circle', cx: r3(c[0]), cy: r3(c[1]), d: r3(d) });
      } else if (tool === 'npoly') {
        const d = 2 * Math.hypot(p[0] - c[0], p[1] - c[1]);
        if (d < 1e-6) return;
        const rot = (Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI;
        s.addEntity({ id: uid('n'), type: 'npoly', cx: r3(c[0]), cy: r3(c[1]), d: r3(d), n: '6', rot: r3(rot) });
      }
    };
    const onMove = (ev: PointerEvent) => {
      const s = useStore.getState();
      if (s.tool === 'pickPlane') {
        const pn = hitPlane(ev);
        if (pn !== state.hoverPlane) { state.hoverPlane = pn; buildSketches(s); }
        setHint(pn ? `Plano ${pn}` : 'Elige un plano de origen o una cara plana');
        return;
      }
      if (s.tool === 'pickEdges') {
        const gi = nearestEdge(ev);
        if (gi !== state.hoverEdge) { state.hoverEdge = gi; buildEdgeOverlay(s); }
        return;
      }
      if (s.mode === 'sketch') {
        const raw = toLocal(ev);
        if (!raw) return;
        const p = s.tool ? snap(ev, raw) : raw;
        state.hover = p;
        useStore.setState({ cursor: p });
        if (s.tool) buildPreview(s);
      }
    };
    const onDbl = () => {
      const s = useStore.getState();
      if (s.tool === 'line') { commitLineChain(false); buildPreview(s); }
    };
    const onContext = (ev: MouseEvent) => { ev.preventDefault(); };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('dblclick', onDbl);
    renderer.domElement.addEventListener('contextmenu', onContext);
    renderer.domElement.addEventListener('pointerleave', () => { state.hover = null; useStore.setState({ cursor: null }); buildPreview(useStore.getState()); });

    api.current.cancelTool = () => { state.chain = []; state.chainIds = []; state.clicks = []; buildPreview(useStore.getState()); };

    // Botones del ratón según el modo
    const applyMouse = (s: State) => {
      const drawing = s.mode === 'sketch' || s.tool === 'pickEdges' || s.tool === 'pickPlane';
      controls.mouseButtons = {
        LEFT: drawing ? (null as unknown as THREE.MOUSE) : THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: drawing && s.mode === 'sketch' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
      };
      renderer.domElement.style.cursor = s.tool && s.tool !== 'pickPlane' && s.tool !== 'pickEdges' ? 'crosshair' : s.tool ? 'pointer' : 'default';
    };

    let labelTimer = 0;
    controls.addEventListener('change', () => {
      request();
      cancelAnimationFrame(labelTimer);
      labelTimer = requestAnimationFrame(() => {
        const s = useStore.getState();
        if (s.mode === 'sketch') { updateLabels(); }
        if (cubeApi.sync) cubeApi.sync();
      });
    });

    // ---------- ViewCube ----------
    const cubeApi: { sync?: () => void; dispose?: () => void } = {};
    {
      const ch = cubeHost.current!;
      const cr = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      cr.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      cr.setSize(104, 104);
      ch.appendChild(cr.domElement);
      const cs = new THREE.Scene();
      const cc = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 20);
      // Cada cara: texto girado para que quede derecho con Z arriba (giros calculados desde los ejes UV de BoxGeometry)
      const face = (txt: string, rotDeg: number) => {
        const c = document.createElement('canvas'); c.width = c.height = 128;
        const g = c.getContext('2d')!;
        g.fillStyle = '#eef1f5'; g.fillRect(0, 0, 128, 128);
        g.strokeStyle = '#9aa3ae'; g.lineWidth = 4; g.strokeRect(2, 2, 124, 124);
        g.translate(64, 64); g.rotate((-rotDeg * Math.PI) / 180);
        g.fillStyle = '#3b4552'; g.font = `600 ${txt.length > 8 ? 19 : 23}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(txt, 0, 0);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        return new THREE.MeshBasicMaterial({ map: t });
      };
      // Orden de materiales de BoxGeometry: +X, -X, +Y, -Y, +Z, -Z
      const cube = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), [
        face('DERECHA', 90), face('IZQUIERDA', -90), face('POSTERIOR', -180), face('FRONTAL', 0), face('SUPERIOR', 0), face('INFERIOR', -180),
      ]);
      cs.add(cube);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(cube.geometry), new THREE.LineBasicMaterial({ color: 0x8892a0 }));
      cs.add(edges);
      const sync = () => {
        const dir = camera.position.clone().sub(controls.target).normalize();
        cc.position.copy(dir.multiplyScalar(5)); cc.up.copy(camera.up); cc.lookAt(0, 0, 0);
        cr.render(cs, cc);
      };
      cubeApi.sync = sync;
      const rc = new THREE.Raycaster();
      cr.domElement.addEventListener('click', (ev) => {
        const r = cr.domElement.getBoundingClientRect();
        rc.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), cc);
        const hit = rc.intersectObject(cube)[0];
        if (!hit?.face) return;
        const p = hit.point, n = new THREE.Vector3();
        // Zonas de esquina/arista: combinar ejes cercanos al borde
        (['x', 'y', 'z'] as const).forEach((k) => { if (Math.abs(p[k]) > 0.45) n[k] = Math.sign(p[k]); });
        if (n.lengthSq() === 0) n.copy(hit.face.normal);
        api.current.viewFromNormal(n.normalize());
      });
      cr.domElement.style.cursor = 'pointer';
      cubeApi.dispose = () => { cr.dispose(); ch.innerHTML = ''; };
      sync();
    }

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!needs) return;
      needs = false;
      const s = useStore.getState();
      triad.scale.setScalar(worldPerPx() * 1.6);
      triad.visible = s.mode !== 'sketch';
      if (snapMarker.visible) { snapMarker.quaternion.copy(camera.quaternion); snapMarker.scale.setScalar(worldPerPx() * 5); }
      renderer.render(scene, camera);
      cubeApi.sync?.();
    };
    loop();

    // ---------- Suscripción al estado ----------
    const s0 = useStore.getState();
    applyMouse(s0); buildPart(s0); buildSketches(s0);
    let firstMesh = true;
    const unsub = useStore.subscribe((s, p) => {
      if (s.pickBase !== p.pickBase) buildEdgeOverlay(s);
      if (s.result !== p.result || s.preview !== p.preview || s.dialog !== p.dialog || s.showEdges !== p.showEdges || s.mode !== p.mode || s.doc.iProperties.material !== p.doc.iProperties.material) {
        buildPart(s);
        if (firstMesh && s.result?.mesh) { firstMesh = false; setView('home'); }
      }
      if (s.doc !== p.doc || s.sketchId !== p.sketchId || s.selEntity !== p.selEntity || s.tool !== p.tool || s.mode !== p.mode) buildSketches(s);
      if (s.tool !== p.tool || s.mode !== p.mode) { applyMouse(s); api.current.cancelTool(); setHint(''); state.hoverEdge = -1; }
      if (s.view !== p.view) setView(s.view.name);
    });
    setView('home');

    return () => {
      unsub(); cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); cubeApi.dispose?.();
      el.removeChild(renderer.domElement);
    };
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
      {tool === 'pickEdges' && <div className="vp-hint">Selecciona aristas · clic de nuevo para quitar</div>}
    </div>
  );
}
