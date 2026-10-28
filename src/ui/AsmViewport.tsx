import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { useStore, type State } from '../core/store';
import { makeEval } from '../core/expr';
import { planeFrame, toWorld, entityOutline, consumedSketches, resolveWorkPlanes, v3, MATERIALS, type V3, type PartDoc } from '../core/doc';
import { xfPoint, xfInvPoint, xfInvDir, type Xform, type AsmDoc } from '../core/asm';
import type { MeshData } from '../core/cadClient';
import { View3D, css, tv, vArr, planarFaceAt, faceVertices } from './view3d';

export interface PickedFace { owner: string; ownerKind: 'occ' | 'member'; pointW: V3; normalW: V3; pointL: V3; normalL: V3; vertsW: V3[] }
export interface CandLine { key: string; a: V3; b: V3; label: string }

/** Líneas candidatas para estructura: esqueleto del ensamblaje + líneas de bocetos de los componentes. */
export function candidateLines(s: State): CandLine[] {
  const out: CandLine[] = s.asm.skeleton.map((l, i) => ({ key: 'sk:' + l.id, a: l.a, b: l.b, label: `Esqueleto ${i + 1}` }));
  const xf = s.asmResult?.xf ?? {};
  for (const o of s.asm.occurrences) {
    if (o.suppressed) continue;
    const doc = s.docData(o.part) as PartDoc | null; if (!doc || doc.format !== 'inv3d.part') continue;
    const ev0 = makeEval(doc.parameters); const ev = (x: string) => { try { return ev0(x); } catch { return NaN; } };
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

  useEffect(() => {
    const V = new View3D(host.current!, cubeHost.current!);
    (window as unknown as { __v3d: View3D }).__v3d = V; // ayuda de depuración / pruebas
    const { scene, camera } = V;
    const modelGroup = new THREE.Group(); scene.add(modelGroup);
    const lineGroup = new THREE.Group(); scene.add(lineGroup);
    const overlayGroup = new THREE.Group(); scene.add(overlayGroup);
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
      }
    });
    tc.addEventListener('change', () => {
      const s = useStore.getState();
      const obj = pickables.find((p) => p.userData.id === s.selItem && p.userData.kind === 'occ');
      if (obj && (tc as any).dragging) { obj.parent!.matrix.compose(gizmoProxy.position, gizmoProxy.quaternion, new THREE.Vector3(1, 1, 1)); obj.parent!.matrixWorldNeedsUpdate = true; }
      V.request();
    });

    let pickables: THREE.Mesh[] = [];
    let cands: CandLine[] = [];
    let hoverKey = '';
    const meshOf = (kind: string, id: string): MeshData | null => {
      const s = useStore.getState(), r = s.asmResult; if (!r) return null;
      if (kind === 'occ') { const o = s.asm.occurrences.find((x) => x.id === id); return o ? (r.occCut[id]?.mesh ?? r.parts[o.part]?.mesh ?? null) : null; }
      if (kind === 'member') return r.members.find((m) => m.id === id)?.mesh ?? null;
      if (kind === 'weld') return r.welds.find((m) => m.id === id)?.mesh ?? null;
      return r.bolts.find((m) => m.id === id)?.mesh ?? null;
    };
    const explodeOf = (s: State, id: string): V3 => v3.mul(s.asm.explode[id] ?? [0, 0, 0], s.mode === 'present' ? s.explodeT : 0);

    const build = (s: State) => {
      V.clearGroup(modelGroup);
      pickables = [];
      const r = s.asmResult;
      const box = new THREE.Box3();
      if (r) {
        const add = (kind: string, id: string, m: MeshData | undefined | null, color: string, matrix: THREE.Matrix4 | null) => {
          if (!m || !m.triangles.length) return;
          const sel = s.selItem === id;
          const { grp, mesh } = V.meshFromData(m, color, { edges: s.showEdges, emissive: sel ? css('--accent') : undefined });
          if (matrix) { grp.matrixAutoUpdate = false; grp.matrix.copy(matrix); }
          mesh.userData = { kind, id };
          modelGroup.add(grp);
          grp.updateMatrixWorld(true);
          pickables.push(mesh);
          mesh.geometry.computeBoundingBox();
          box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
        };
        for (const o of s.asm.occurrences) {
          if (o.suppressed || o.hidden) continue;
          const doc = s.docData(o.part) as PartDoc | null;
          const color = MATERIALS.find((x) => x.name === doc?.iProperties.material)?.color ?? '#c3c8cf';
          const xf = r.xf[o.id] ?? o.xf;
          add('occ', o.id, meshOf('occ', o.id), color, xfMatrix(xf, explodeOf(s, o.id)));
        }
        for (const m of r.members) {
          const fm = s.asm.frames.find((f) => f.id === m.id);
          const color = MATERIALS.find((x) => x.name === fm?.material)?.color ?? '#b9bec6';
          const e = explodeOf(s, m.id);
          add('member', m.id, m.mesh, color, e[0] || e[1] || e[2] ? new THREE.Matrix4().makeTranslation(...e) : null);
        }
        for (const w of r.welds) add('weld', w.id, w.mesh, '#c7843a', null);
        for (const b of r.bolts) add('bolt', b.id, b.mesh, '#7d858f', null);
      }
      V.hasModel = !box.isEmpty();
      if (V.hasModel) V.bbox.copy(box);
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
      if (!pf?.planar) return null;
      const mw = hit.object.matrixWorld;
      const nW = pf.normal.clone().transformDirection(mw);
      const vertsW = faceVertices(m, pf.group).map((v) => vArr(v.applyMatrix4(mw)));
      const s = useStore.getState();
      let pointL: V3 = vArr(hit.point), normalL: V3 = vArr(nW);
      if (kind === 'occ') {
        const o = s.asm.occurrences.find((x) => x.id === id)!;
        const xf = s.asmResult?.xf[id] ?? o.xf;
        pointL = vArr(tv(xfInvPoint(xf, vArr(hit.point))));
        normalL = vArr(tv(xfInvDir(xf, vArr(nW))).normalize());
      }
      return { owner: id, ownerKind: kind as 'occ' | 'member', pointW: vArr(hit.point), normalW: vArr(nW), pointL, normalL, vertsW };
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

    let downAt: { x: number; y: number } | null = null;
    const cvs = V.renderer.domElement;
    cvs.addEventListener('pointerdown', (ev) => { downAt = { x: ev.clientX, y: ev.clientY }; });
    cvs.addEventListener('pointerup', (ev) => {
      if (!downAt || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 4 || ev.button !== 0 || (tc as any).dragging) { downAt = null; return; }
      downAt = null;
      const s = useStore.getState();
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
      if (s.tool === 'asmFace' || s.tool === 'weldFace' || s.tool === 'boltFace') {
        const hit = hitAt(ev); if (!hit) return;
        const f = faceFromHit(hit);
        if (!f) { s.notify('Selecciona una cara plana', 'error'); return; }
        if (s.tool === 'asmFace' && dlg?.kind === 'joint') {
          if (f.ownerKind !== 'occ') { s.notify('Las uniones se hacen entre componentes', 'error'); return; }
          const ref = { occ: f.owner, point: f.pointL, normal: f.normalL };
          if ((dlg.step ?? 0) === 0) useStore.setState({ dialog: { ...dlg, draft: { ...d, a: ref, aW: f.pointW }, step: 1 } });
          else useStore.setState({ dialog: { ...dlg, draft: { ...d, b: ref, bW: f.pointW }, step: 0 } });
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
      useStore.setState({ selItem: id });
    });
    cvs.addEventListener('dblclick', (ev) => {
      const s = useStore.getState();
      if (s.tool) return;
      const hit = hitAt(ev);
      if (hit?.object.userData.kind === 'occ') {
        const o = s.asm.occurrences.find((x) => x.id === hit.object.userData.id);
        if (o) s.activate(o.part);
      }
    });
    cvs.addEventListener('pointermove', (ev) => {
      const s = useStore.getState();
      if (s.tool === 'frameLine') {
        const c = nearestCand(ev); const k = c?.key ?? '';
        if (k !== hoverKey) { hoverKey = k; buildLines(s); setHint(c ? c.label : ''); }
      } else if (s.tool === 'asmFace' || s.tool === 'weldFace' || s.tool === 'boltFace') {
        const hit = hitAt(ev);
        V.clearGroup(overlayGroup);
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
    applyMouse(s0); build(s0);
    let first = !s0.asmResult;
    const unsub = useStore.subscribe((s, p) => {
      if (s.kind !== 'assembly') return;
      if (s.asmResult !== p.asmResult || s.selItem !== p.selItem || s.showEdges !== p.showEdges || s.explodeT !== p.explodeT || s.mode !== p.mode || s.tool !== p.tool || s.asm.explode !== p.asm.explode) {
        build(s);
        if (first && s.asmResult && V.hasModel) { first = false; V.setView('home'); }
      }
      if (s.dialog !== p.dialog) buildLines(s);
      if (s.tool !== p.tool) { applyMouse(s); setHint(''); hoverKey = ''; V.clearGroup(overlayGroup); }
      if (s.view !== p.view) V.setView(s.view.name);
    });
    V.setView('home');
    return () => { unsub(); tc.dispose(); V.dispose(); };
  }, []);

  const tool = useStore((s) => s.tool);
  const dialog = useStore((s) => s.dialog);
  const step = dialog && 'step' in dialog ? dialog.step ?? 0 : 0;
  const hints: Record<string, string> = {
    frameLine: 'Selecciona líneas de esqueleto o de boceto · clic de nuevo para quitar',
    skelPoint: step === 0 ? 'Punto inicial: vértice, extremo de línea o punto de una cara' : 'Punto final',
    asmFace: step === 0 ? 'Cara del componente A (referencia)' : 'Cara del componente B (se moverá)',
    weldFace: step === 0 ? 'Primera cara a soldar' : 'Segunda cara a soldar',
    boltFace: 'Cara de inicio: donde apoya la cabeza del tornillo',
    move: 'Arrastra el gizmo para mover o girar el componente seleccionado',
    pickMember: 'Selecciona la barra y después la barra de referencia',
  };

  return (
    <div className="viewport" ref={host}>
      <div className="viewcube" ref={cubeHost} />
      <button className="vp-home" title="Vista de inicio (F6)" onClick={() => useStore.getState().setView('home')}>
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
      </button>
      {(hint || (tool && hints[tool])) && <div className="vp-hint">{hint || hints[tool!]}</div>}
    </div>
  );
}

export type { AsmDoc };
