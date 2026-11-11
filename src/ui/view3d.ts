// Núcleo del visor 3D compartido por pieza y ensamblaje: cámara ortográfica Z-arriba, órbita,
// ViewCube, triada, iluminación, utilidades de líneas gruesas, proyección y selección.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { V3 } from '../core/doc';
import { useStore } from '../core/store';
import type { MeshData } from '../core/cadClient';

export const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000';
export const tv = (p: V3 | number[]) => new THREE.Vector3(p[0], p[1], p[2]);
export const r3 = (x: number) => String(Math.round(x * 1000) / 1000);
/** Relación píxel físico / píxel CSS de la pantalla. */
export const dpr = () => window.devicePixelRatio || 1;
/** Compatibilidad: el lienzo se dibuja a la resolución física exacta (sin reescalado → sin desenfoque). */
export const renderPixelRatio = () => dpr();
/** Grosor de línea en píxeles físicos enteros (líneas nítidas, sin antialias de medio píxel). */
const devW = (cssW: number) => Math.max(1, Math.round(cssW * dpr()));

/** Último visor 3D activo (recibe el SpaceMouse). */
export let activeView: View3D | null = null;
export const vArr = (v: THREE.Vector3, d = 6): V3 => [Number(v.x.toFixed(d)), Number(v.y.toFixed(d)), Number(v.z.toFixed(d))];

const VIEWS: Record<string, [V3, V3]> = {
  home: [[-1, 1, -0.8], [0, 0, 1]], front: [[0, 1, 0], [0, 0, 1]], back: [[0, -1, 0], [0, 0, 1]],
  top: [[0, 0, -1], [0, 1, 0]], bottom: [[0, 0, 1], [0, -1, 0]], right: [[-1, 0, 0], [0, 0, 1]], left: [[1, 0, 0], [0, 0, 1]],
  iso: [[-1, 1, -1], [0, 0, 1]], dimetric: [[-1, 1, -0.55], [0, 0, 1]], trimetric: [[-0.62, 1, -0.78], [0, 0, 1]],
};


export class View3D {
  el: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
  controls: OrbitControls;
  raycaster = new THREE.Raycaster();
  triad = new THREE.Group();
  bbox = new THREE.Box3(new THREE.Vector3(-60, -60, -60), new THREE.Vector3(60, 60, 60));
  hasModel = false;
  saved: null | { pos: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; zoom: number } = null;
  onChange: () => void = () => {};
  onFrame: () => void = () => {};
  private lineMats: LineMaterial[] = [];
  private needs = true;
  private raf = 0;
  private ro: ResizeObserver;
  private cube: { sync: () => void; dispose: () => void } | null = null;

  constructor(el: HTMLElement, cubeHost: HTMLElement) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance', stencil: true });
    this.renderer.setPixelRatio(1);
    activeView = this;
    this.renderer.domElement.className = 'vp-canvas';
    el.appendChild(this.renderer.domElement);
    const cam = this.camera;
    cam.up.set(0, 0, 1);
    cam.position.set(400, -400, 400);
    this.controls = new OrbitControls(cam, this.renderer.domElement);
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.enableDamping = false;
    this.controls.rotateSpeed = 0.9;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3b2, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); cam.add(key); key.position.set(0.4, 0.8, 1);
    const fill = new THREE.DirectionalLight(0xffffff, 0.9); cam.add(fill); fill.position.set(-1, -0.3, 0.5);
    this.scene.add(cam);
    const axis = (dir: V3, color: number) => new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), tv(dir).multiplyScalar(30)]),
      new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 }));
    this.triad.add(axis([1, 0, 0], 0xd0443e), axis([0, 1, 0], 0x3fa34d), axis([0, 0, 1], 0x3d6fd6));
    this.triad.renderOrder = 5;
    this.scene.add(this.triad);
    this.scene.add(this.capGroup);
    this.unsubClip = useStore.subscribe((st, pv) => { if (st.clipTool !== pv.clipTool) this.refreshClip(); });
    this.ro = new ResizeObserver((ents) => {
      const e = ents[0] as ResizeObserverEntry & { devicePixelContentBoxSize?: ReadonlyArray<ResizeObserverSize> };
      const d = e?.devicePixelContentBoxSize?.[0];
      this.resize(d ? [d.inlineSize, d.blockSize] : undefined);
    });
    try { this.ro.observe(el, { box: 'device-pixel-content-box' as ResizeObserverBoxOptions }); } catch { this.ro.observe(el); }
    this.resize();
    this.controls.addEventListener('change', () => { this.request(); this.onChange(); });
    this.controls.addEventListener('start', () => this.pushHist());
    this.renderer.domElement.addEventListener('wheel', () => { clearTimeout(this.wheelT); if (!this.wheeling) { this.pushHist(); this.wheeling = true; } this.wheelT = setTimeout(() => { this.wheeling = false; }, 400); }, { passive: true, capture: true });
    this.cube = this.makeCube(cubeHost);
    let lastT = performance.now();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
      if (this.applyNav(dt, now)) this.needs = true;
      if (!this.needs) return;
      this.needs = false;
      this.triad.scale.setScalar(this.worldPerPx() * 1.6);
      this.onFrame();
      this.renderer.render(this.scene, this.camera);
      this.cube?.sync();
    };
    loop();
  }

  dispose() {
    if (activeView === this) activeView = null;
    this.unsubClip?.(); this.pickOff?.();
    cancelAnimationFrame(this.raf); this.ro.disconnect(); this.controls.dispose(); this.renderer.dispose(); this.cube?.dispose();
    this.el.removeChild(this.renderer.domElement);
  }
  request() { this.needs = true; }
  /** Tamaño del búfer = píxeles físicos exactos del elemento (el navegador no reescala el lienzo). */
  private buf: [number, number] = [1, 1];
  resize(device?: [number, number]) {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    // Tamaño físico exacto si el navegador lo da (y es coherente); si no, CSS × dpr redondeado
    const ok = device && Math.abs(device[0] - w * dpr()) < 2 && Math.abs(device[1] - h * dpr()) < 2;
    const bw = ok ? device![0] : Math.round(w * dpr()), bh = ok ? device![1] : Math.round(h * dpr());
    this.buf = [Math.max(1, bw), Math.max(1, bh)];
    this.renderer.setSize(this.buf[0], this.buf[1], false);
    const aspect = w / Math.max(h, 1), H = 300;
    Object.assign(this.camera, { left: (-H * aspect) / 2, right: (H * aspect) / 2, top: H / 2, bottom: -H / 2 });
    this.camera.updateProjectionMatrix();
    this.lineMats.forEach((m) => { m.resolution.set(this.buf[0], this.buf[1]); m.linewidth = devW(m.userData.cssW ?? 1); });
    this.request();
  }

  // ---- Ratón 3D (SpaceMouse): entrada continua normalizada [-1, 1] ----
  private nav = { t: [0, 0, 0], r: [0, 0, 0], at: 0 };
  navSpeed = 1;
  setNav(t: number[], r: number[]) { this.nav = { t, r, at: performance.now() }; this.request(); }
  private applyNav(dt: number, now: number): boolean {
    const n = this.nav;
    if (now - n.at > 250) return false;
    const dz = (v: number) => { const a = Math.abs(v); return a < 0.03 ? 0 : Math.sign(v) * ((a - 0.03) / 0.97) ** 1.6; };
    const [tx, ty, tz] = n.t.map(dz), [rx, ry, rz] = n.r.map(dz);
    if (!tx && !ty && !tz && !rx && !ry && !rz) return false;
    const cam = this.camera, tgt = this.controls.target, k = this.navSpeed;
    cam.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    const back = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2).normalize();
    // Modo objeto: el modelo sigue al movimiento de la tapa
    const viewH = (cam.top - cam.bottom) / cam.zoom;
    const pan = right.clone().multiplyScalar(-tx).add(up.clone().multiplyScalar(tz)).multiplyScalar(viewH * 0.9 * k * dt);
    cam.position.add(pan); tgt.add(pan);
    if (ty) { cam.zoom = Math.min(5000, Math.max(1e-4, cam.zoom * Math.exp(ty * 1.6 * k * dt))); cam.updateProjectionMatrix(); }
    const rot = (axis: THREE.Vector3, ang: number) => {
      if (!ang) return;
      const q = new THREE.Quaternion().setFromAxisAngle(axis, ang);
      const off = cam.position.clone().sub(tgt).applyQuaternion(q);
      cam.position.copy(tgt).add(off); cam.up.applyQuaternion(q);
    };
    const w = 1.8 * k * dt;
    rot(right, -rx * w); rot(up, -rz * w); rot(back, -ry * w);
    cam.lookAt(tgt);
    this.controls.update();
    this.onChange();
    return true;
  }
  worldPerPx() { return (this.camera.top - this.camera.bottom) / this.camera.zoom / Math.max(this.el.clientHeight, 1); }

  // ---- Líneas ----
  lineMat(color: string, width: number, dashed = false, depthTest = true) {
    const m = new LineMaterial({ color: new THREE.Color(color), linewidth: devW(width), dashed, dashSize: 3, gapSize: 2, depthTest, transparent: !depthTest });
    m.userData.cssW = width;
    this.lineMats.push(m);
    m.resolution.set(this.buf[0], this.buf[1]);
    return m;
  }
  segs(pts: number[], mat: LineMaterial) {
    const g = new LineSegmentsGeometry(); g.setPositions(pts);
    const l = new LineSegments2(g, mat); l.computeLineDistances(); return l;
  }
  clearGroup(g: THREE.Group) {
    for (const c of [...g.children]) {
      g.remove(c);
      c.traverse((o: any) => {
        o.geometry?.dispose?.();
        if (o.material && !Array.isArray(o.material)) {
          if (o.material instanceof LineMaterial) this.lineMats = this.lineMats.filter((m) => m !== o.material);
          o.material.dispose?.();
        }
      });
    }
  }

  /** Malla sombreada + aristas a partir de los datos del núcleo. */
  meshFromData(m: MeshData, color: string, opts: { opacity?: number; edges?: boolean; emissive?: string } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.vertices, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    g.setIndex(new THREE.BufferAttribute(m.triangles, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    g.userData.faceGroups = m.faceGroups;
    const op = opts.opacity ?? 1;
    const mat = new THREE.MeshStandardMaterial({
      color, metalness: 0.25, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      transparent: op < 1, opacity: op, depthWrite: op >= 1, side: THREE.DoubleSide,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0), emissiveIntensity: opts.emissive ? 0.18 : 0,
    });
    const mesh = new THREE.Mesh(g, mat);
    const grp = new THREE.Group();
    grp.add(mesh);
    if (opts.edges !== false && m.lines.length) {
      // Aristas con grosor real en píxeles (no dependen del supermuestreo)
      const lm = this.lineMat(css('--edge'), op < 1 ? 1 : 1.2);
      if (op < 1) { lm.transparent = true; lm.opacity = Math.max(op, 0.3); }
      const l = this.segs(Array.from(m.lines), lm);
      l.raycast = () => {};
      l.userData.edge = true;
      grp.add(l);
    }
    return { grp, mesh };
  }

  // ---- Coordenadas ----
  ndc(ev: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  }
  local(ev: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(ev.clientX - r.left, ev.clientY - r.top);
  }
  project(p: V3 | THREE.Vector3) {
    const v = (p instanceof THREE.Vector3 ? p.clone() : tv(p)).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.el.clientWidth, y: (-v.y * 0.5 + 0.5) * this.el.clientHeight };
  }
  ray(ev: { clientX: number; clientY: number }) { this.raycaster.setFromCamera(this.ndc(ev), this.camera); return this.raycaster; }
  camDir() { return this.controls.target.clone().sub(this.camera.position).normalize(); }

  /** Arista de malla más cercana al cursor (en píxeles), con oclusión aproximada. */
  nearestEdge(ev: { clientX: number; clientY: number }, m: MeshData, xform: THREE.Matrix4 | null, occluders: THREE.Object3D[], tolPx = 8): { group: number; t: number; seg: [THREE.Vector3, THREE.Vector3] } | null {
    const P = this.local(ev);
    const hit = occluders.length ? this.ray(ev).intersectObjects(occluders, true)[0] : undefined;
    const camDir = this.camDir();
    const limit = hit ? hit.point.dot(camDir) + this.worldPerPx() * 6 : Infinity;
    let best: { group: number; t: number; seg: [THREE.Vector3, THREE.Vector3] } | null = null, bd = tolPx;
    const a = m.lines;
    m.edgeGroups.forEach((g, gi) => {
      for (let i = g.start; i + 1 < g.start + g.count; i += 2) {
        const A3 = new THREE.Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]), B3 = new THREE.Vector3(a[i * 3 + 3], a[i * 3 + 4], a[i * 3 + 5]);
        if (xform) { A3.applyMatrix4(xform); B3.applyMatrix4(xform); }
        const pa = this.project(A3), pb = this.project(B3);
        const A = new THREE.Vector2(pa.x, pa.y), B = new THREE.Vector2(pb.x, pb.y);
        const t = Math.max(0, Math.min(1, P.clone().sub(A).dot(B.clone().sub(A)) / Math.max(B.distanceToSquared(A), 1e-9)));
        const d = A.clone().lerp(B, t).distanceTo(P);
        if (d < bd && A3.clone().lerp(B3, t).dot(camDir) <= limit) { bd = d; best = { group: gi, t, seg: [A3, B3] }; }
      }
    });
    return best;
  }

  // ---- Vistas ----
  // ---- Historial de vistas (Vista anterior) ----
  private wheelT: ReturnType<typeof setTimeout> | undefined; private wheeling = false;
  private hist: { pos: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; zoom: number }[] = [];
  private camState() { return { pos: this.camera.position.clone(), target: this.controls.target.clone(), up: this.camera.up.clone(), zoom: this.camera.zoom }; }
  pushHist() {
    const st = this.camState(), last = this.hist[this.hist.length - 1];
    if (last && last.pos.distanceTo(st.pos) < 1e-6 && last.target.distanceTo(st.target) < 1e-6 && Math.abs(last.zoom - st.zoom) < 1e-9 && last.up.distanceTo(st.up) < 1e-9) return;
    this.hist.push(st); if (this.hist.length > 30) this.hist.shift();
  }
  prevView() {
    const s = this.hist.pop(); if (!s) return false;
    this.camera.position.copy(s.pos); this.controls.target.copy(s.target); this.camera.up.copy(s.up);
    this.camera.zoom = s.zoom; this.camera.updateProjectionMatrix(); this.camera.lookAt(this.controls.target); this.controls.update(); this.request(); this.onChange();
    return true;
  }
  // ---- Zoom encuadre (rectángulo con el botón izquierdo) ----
  private zoomBox: { start: [number, number] | null; div: HTMLDivElement; off: () => void } | null = null;
  startZoomArea() {
    if (this.zoomBox) return;
    const cvs = this.renderer.domElement, div = document.createElement('div');
    div.className = 'vp-zoombox'; div.style.display = 'none'; this.el.appendChild(div);
    const prevEnabled = this.controls.enabled; this.controls.enabled = false;
    cvs.style.cursor = 'zoom-in';
    const loc = (e: PointerEvent): [number, number] => { const r = this.el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const down = (e: PointerEvent) => { if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); this.zoomBox!.start = loc(e); };
    const move = (e: PointerEvent) => {
      const z = this.zoomBox; if (!z?.start) return; e.stopPropagation();
      const [x0, y0] = z.start, [x1, y1] = loc(e);
      Object.assign(div.style, { display: 'block', left: `${Math.min(x0, x1)}px`, top: `${Math.min(y0, y1)}px`, width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px` });
    };
    const up = (e: PointerEvent) => {
      const z = this.zoomBox; if (!z?.start) return; e.stopPropagation();
      const [x0, y0] = z.start, [x1, y1] = loc(e);
      finish();
      const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      if (w < 6 || h < 6) return;
      this.pushHist();
      const W = this.el.clientWidth, H = this.el.clientHeight, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      // desplazamiento en el plano de la vista hasta el centro del rectángulo
      this.camera.updateMatrixWorld();
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
      const upv = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
      const wpp = this.worldPerPx();
      const d = right.multiplyScalar((cx - W / 2) * wpp).add(upv.multiplyScalar(-(cy - H / 2) * wpp));
      this.camera.position.add(d); this.controls.target.add(d);
      this.camera.zoom = Math.min(5000, this.camera.zoom * Math.min(W / w, H / h));
      this.camera.updateProjectionMatrix(); this.controls.update(); this.request(); this.onChange();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(); };
    const finish = () => {
      cvs.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('keydown', key, true);
      div.remove(); this.controls.enabled = prevEnabled; cvs.style.cursor = ''; this.zoomBox = null;
    };
    cvs.addEventListener('pointerdown', down, true); window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('keydown', key, true);
    this.zoomBox = { start: null, div, off: finish };
  }
  fitTo(box: THREE.Box3, dir: THREE.Vector3, up: THREE.Vector3) {
    this.pushHist();
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 200;
    this.controls.target.copy(c);
    this.camera.up.copy(up);
    this.camera.position.copy(c).addScaledVector(dir.clone().normalize(), -size * 4);
    const aspect = this.el.clientWidth / Math.max(this.el.clientHeight, 1);
    this.camera.zoom = Math.min(300 / (size * 1.15), (300 * aspect) / (size * 1.15));
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(c);
    this.controls.update();
    this.request();
  }
  viewBox() { return this.hasModel ? this.bbox.clone() : new THREE.Box3(new THREE.Vector3(-60, -60, -60), new THREE.Vector3(60, 60, 60)); }
  setView(name: string) {
    if (name === 'restore') {
      const s = this.saved; if (!s) return;
      this.camera.position.copy(s.pos); this.controls.target.copy(s.target); this.camera.up.copy(s.up);
      this.camera.zoom = s.zoom; this.camera.updateProjectionMatrix(); this.camera.lookAt(this.controls.target); this.controls.update(); this.request();
      return;
    }
    if (name === 'prev') { this.prevView(); return; }
    if (name === 'zoomarea') { this.startZoomArea(); return; }
    if (name === 'fit') return this.fitTo(this.viewBox(), this.camDir(), this.camera.up.clone());
    const v = VIEWS[name];
    if (v) this.fitTo(this.viewBox(), tv(v[0]), tv(v[1]));
  }
  saveCamera() { this.saved = { pos: this.camera.position.clone(), target: this.controls.target.clone(), up: this.camera.up.clone(), zoom: this.camera.zoom }; }
  viewFromNormal(n: THREE.Vector3) {
    const up = Math.abs(n.z) > 0.9 ? new THREE.Vector3(0, n.z > 0 ? 1 : -1, 0) : new THREE.Vector3(0, 0, 1);
    this.fitTo(this.viewBox(), n.clone().negate(), up);
  }
  // ---------- Modo de recorte (barra de recorte) y vista de sección ----------
  clipTargets: THREE.Object3D[] = [];
  private hudClip: '' | 'X' | 'Y' | 'Z' = '';
  private capGroup = new THREE.Group();
  private unsubClip?: () => void;
  private pickOff?: () => void;
  /** Planos de recorte vigentes (THREE: se oculta lo que queda en el lado negativo de cada plano) */
  clipPlanes(): { planes: THREE.Plane[]; cap: boolean } {
    const st = useStore.getState(), ct = st.clipTool, bb = this.bbox;
    const mn = bb.min, mx = bb.max, size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
    if (!ct) {
      const clip = this.hudClip; if (!clip) return { planes: [], cap: false };
      const ax = clip === 'X' ? 0 : clip === 'Y' ? 1 : 2;
      const n = clip === 'X' ? new THREE.Vector3(-1, 0, 0) : clip === 'Y' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, -1);
      const pt = c.clone(); pt.setComponent(ax, c.getComponent(ax) + st.hud.clipOff * size.getComponent(ax));
      if (st.hud.clipFlip) n.negate();
      return { planes: [new THREE.Plane(n, -n.dot(pt))], cap: false };
    }
    const axOf = (p: string) => (p.startsWith('XY') ? 2 : p.startsWith('XZ') ? 1 : 0);
    const cap = ct.mode === 'manual' ? ct.plane.endsWith('c') || ct.plane === '*' : ct.plane.endsWith('c') || ct.plane === '*';
    if (ct.mode === 'manual') {
      const ax = 'xyz'.indexOf(ct.dir[1]), hideNeg = ct.dir[0] === '-' ? !ct.flip : ct.flip;
      const p0 = ct.pt[ax], end = hideNeg ? mx.getComponent(ax) : mn.getComponent(ax);
      const X = p0 + ct.mpos * (end - p0);
      const n = new THREE.Vector3(); n.setComponent(ax, hideNeg ? 1 : -1);
      const pt = new THREE.Vector3(); pt.setComponent(ax, X);
      return { planes: [new THREE.Plane(n, -n.dot(pt))], cap };
    }
    let n: THREE.Vector3, lo: number, hi: number, base: THREE.Vector3;
    if (ct.plane === '*') {
      n = new THREE.Vector3(...ct.normal).normalize(); base = new THREE.Vector3(...ct.pt);
      // extensión del modelo a lo largo de la normal
      lo = Infinity; hi = -Infinity;
      for (const x of [mn.x, mx.x]) for (const y of [mn.y, mx.y]) for (const z of [mn.z, mx.z]) { const d = n.dot(new THREE.Vector3(x, y, z).sub(base)); lo = Math.min(lo, d); hi = Math.max(hi, d); }
    } else {
      const ax = axOf(ct.plane); n = new THREE.Vector3(); n.setComponent(ax, 1); base = new THREE.Vector3();
      lo = mn.getComponent(ax); hi = mx.getComponent(ax);
    }
    // plano libre: 0,5 = pasa por el punto; plano de ejes: 0–1 a lo largo del modelo
    const at = ct.plane === '*' ? (ct.pos - 0.5) * (hi - lo) : lo + ct.pos * (hi - lo);
    const P = (d: number) => base.clone().addScaledVector(n, d);
    if (ct.mode === 'slab') {
      const w = Math.max(1e-3, ct.step) / 2;
      const a = n.clone(), b = n.clone().negate();
      return { planes: [new THREE.Plane(a, -a.dot(P(at - w))), new THREE.Plane(b, -b.dot(P(at + w)))], cap };
    }
    const k = ct.flip ? n.clone() : n.clone().negate(); // por defecto se oculta el lado + (se ve el interior desde arriba)
    return { planes: [new THREE.Plane(k, -k.dot(P(at)))], cap };
  }
  /** Aplica los planos y dibuja las tapas de la sección (técnica de stencil) y el contorno del plano */
  refreshClip() {
    const { planes, cap } = this.clipPlanes();
    // un pelo hacia el lado visible: si el plano coincide con una cara, la cara queda cortada y la tapa se ve limpia
    const nudge = Math.max(1, this.bbox.getSize(new THREE.Vector3()).length()) * 2e-4;
    for (const pl of planes) pl.constant -= nudge;
    this.renderer.clippingPlanes = planes;
    for (const o of [...this.capGroup.children]) { this.capGroup.remove(o); o.traverse((x: any) => { if (x.material) x.material.dispose?.(); if (x.userData.ownGeo) x.geometry?.dispose?.(); }); }
    const ct = useStore.getState().clipTool;
    if (planes.length) {
      const size = Math.max(1, this.bbox.getSize(new THREE.Vector3()).length());
      const eps = size * 2e-5;
      const meshes: THREE.Mesh[] = [];
      for (const t of this.clipTargets) t.traverse((o: any) => { if (o.isMesh && !(o instanceof LineSegments2) && !o.userData.keep && o.material?.visible !== false && o.geometry?.index !== undefined) meshes.push(o); });
      planes.forEach((pl, i) => {
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), pl.normal);
        const at = pl.coplanarPoint(new THREE.Vector3());
        // proyección del centro del modelo sobre el plano
        const c = this.bbox.getCenter(new THREE.Vector3()); const cp = c.clone().addScaledVector(pl.normal, -pl.distanceToPoint(c));
        if (cap && meshes.length) {
          const base = new THREE.MeshBasicMaterial({ depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc });
          for (const m of meshes) {
            m.updateWorldMatrix(true, false);
            for (const [side, op] of [[THREE.BackSide, THREE.IncrementWrapStencilOp], [THREE.FrontSide, THREE.DecrementWrapStencilOp]] as const) {
              const mt = base.clone(); mt.side = side; mt.stencilFail = op; mt.stencilZFail = op; mt.stencilZPass = op;
              const sm = new THREE.Mesh(m.geometry, mt); sm.matrixAutoUpdate = false; sm.matrix.copy(m.matrixWorld); sm.renderOrder = 10 + i; sm.raycast = () => {};
              this.capGroup.add(sm);
            }
          }
          base.dispose();
          const capMat = new THREE.MeshStandardMaterial({ color: 0xc8564a, metalness: 0.1, roughness: 0.75, side: THREE.DoubleSide, stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
          const capM = new THREE.Mesh(new THREE.PlaneGeometry(size * 3, size * 3), capMat);
          capM.userData.ownGeo = true; capM.quaternion.copy(q); capM.position.copy(cp).addScaledVector(pl.normal, eps); capM.renderOrder = 10.5 + i; capM.raycast = () => {};
          capM.onAfterRender = (r) => r.clearStencil();
          this.capGroup.add(capM);
        }
        if (ct?.show) {
          // contorno del plano de corte (rectángulo del tamaño del modelo)
          const s2 = size * 0.42, g = new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([x, y]) => new THREE.Vector3(x * s2, y * s2, 0)));
          const ln = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x1673d0, depthTest: false, transparent: true, opacity: 0.9 }));
          const fill = new THREE.Mesh(new THREE.PlaneGeometry(s2 * 2, s2 * 2), new THREE.MeshBasicMaterial({ color: 0x1673d0, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
          for (const o of [ln, fill]) { o.userData.ownGeo = true; o.quaternion.copy(q); o.position.copy(cp).addScaledVector(pl.normal, eps * 2); o.renderOrder = 20; o.raycast = () => {}; this.capGroup.add(o); }
          void at;
        }
      });
    }
    this.request();
  }
  // ---------- Designación de puntos 3D (ventana «Punto 3D») ----------
  private pickMarker?: THREE.Group;
  private edgeCache = new WeakMap<object, EdgeTopo>();
  private scr(v: THREE.Vector3) {
    const r = this.renderer.domElement.getBoundingClientRect(), p = v.clone().project(this.camera);
    return new THREE.Vector2(r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height);
  }
  private visible(p: THREE.Vector3) {
    const tol = Math.max(1, this.bbox.getSize(new THREE.Vector3()).length()) * 5e-4;
    return this.renderer.clippingPlanes.every((pl) => pl.distanceToPoint(p) >= -tol);
  }
  /** Aristas visibles del modelo con su topología (vértices, cadenas, centros de arco) en coordenadas globales */
  private edgeSets() {
    const out: { obj: THREE.Object3D; topo: EdgeTopo; mw: THREE.Matrix4 }[] = [];
    for (const t of this.clipTargets) t.traverse((o: any) => {
      if (!(o instanceof LineSegments2) || !o.userData.edge || o.userData.hidCopy || !o.visible) return;
      let topo = this.edgeCache.get(o.geometry);
      if (!topo) { topo = edgeTopo(((o.geometry as any).attributes.instanceStart?.data?.array as Float32Array) ?? new Float32Array()); this.edgeCache.set(o.geometry, topo); }
      o.updateWorldMatrix(true, false);
      out.push({ obj: o, topo, mw: o.matrixWorld });
    });
    return out;
  }
  /** Punto de referencia para el cursor 2D: plano normal a la vista por el punto de recorte o el centro del modelo */
  refPoint = new THREE.Vector3();
  private surfaceHit(ray: THREE.Raycaster) {
    const hits = ray.intersectObjects(this.clipTargets, true).filter((h: any) => h.object.isMesh && !(h.object instanceof LineSegments2) && h.face && !h.object.userData.keep);
    return hits.find((x) => this.visible(x.point));
  }
  /** Resuelve el punto según el tipo de designación bajo el cursor (null si no hay nada que designar) */
  resolvePick(kind: PickKind, adv: AdvKind, cx: number, cy: number): PickRes | null {
    const cvs = this.renderer.domElement, r = cvs.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera);
    const m = new THREE.Vector2(cx, cy), TH = 18;
    const h = this.surfaceHit(ray);
    const hitN = h ? h.face!.normal.clone().transformDirection(h.object.matrixWorld).normalize() : undefined;
    const viewPlane = () => {
      const n = this.camDir().normalize(), pl = new THREE.Plane().setFromNormalAndCoplanarPoint(n, this.refPoint);
      const p = ray.ray.intersectPlane(pl, new THREE.Vector3()) ?? ray.ray.closestPointToPoint(this.refPoint, new THREE.Vector3());
      return { p, n: n.clone().negate(), what: 'Cursor 2D' } as PickRes;
    };
    const nearestOf = (cands: { p: THREE.Vector3; what: string }[]) => {
      let best: PickRes | null = null, bd = TH;
      for (const c of cands) { if (!this.visible(c.p)) continue; const d = this.scr(c.p).distanceTo(m); if (d < bd) { bd = d; best = { p: c.p, n: hitN, what: c.what }; } }
      return best;
    };
    const sets = () => this.edgeSets();
    /** Cadena (arista) más cercana al cursor en pantalla y el punto más cercano sobre ella */
    const nearestChain = () => {
      let best: { pts: THREE.Vector3[]; p: THREE.Vector3; d: number } | null = null;
      for (const { topo, mw } of sets()) for (const ch of topo.chains) {
        const W = ch.map((v) => v.clone().applyMatrix4(mw));
        for (let i = 0; i + 1 < W.length; i++) {
          const A = this.scr(W[i]), B = this.scr(W[i + 1]), AB = B.clone().sub(A), L2 = AB.lengthSq();
          const t = L2 < 1e-9 ? 0 : Math.min(1, Math.max(0, m.clone().sub(A).dot(AB) / L2));
          const d = A.clone().addScaledVector(AB, t).distanceTo(m);
          const p = W[i].clone().lerp(W[i + 1], t);
          if (d < TH && (!best || d < best.d) && this.visible(p)) best = { pts: W, p, d };
        }
      }
      return best;
    };
    switch (kind) {
      case 'cursor3d': return h ? { p: h.point.clone(), n: hitN, what: 'Cursor 3D' } : viewPlane();
      case 'cursor2d': return viewPlane();
      case 'face': return h ? { p: h.point.clone(), n: hitN, what: 'Sobre cara' } : null;
      case 'vertex': {
        const c: { p: THREE.Vector3; what: string }[] = [];
        for (const { topo, mw } of sets()) for (const v of topo.corners) c.push({ p: v.clone().applyMatrix4(mw), what: 'Vértice' });
        const v = nearestOf(c); if (v) return v;
        if (h) { // sin aristas: vértice del triángulo más cercano
          const g = (h.object as THREE.Mesh).geometry, pos = g.getAttribute('position'), mw = h.object.matrixWorld;
          let best = Infinity, p = h.point.clone();
          for (const i of [h.face!.a, h.face!.b, h.face!.c]) { const q = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mw); const d = q.distanceTo(h.point); if (d < best) { best = d; p = q; } }
          return { p, n: hitN, what: 'Vértice' };
        }
        return null;
      }
      case 'pcon': {
        const c: { p: THREE.Vector3; what: string }[] = [];
        for (const { topo, mw } of sets()) {
          for (const v of topo.corners) c.push({ p: v.clone().applyMatrix4(mw), what: 'Vértice' });
          for (const ch of topo.chains) {
            const W = ch.map((v) => v.clone().applyMatrix4(mw));
            c.push({ p: chainMid(W), what: 'Punto medio' });
            const cc = circleOf(W); if (cc) c.push({ p: cc.c, what: 'Centro' });
          }
        }
        return nearestOf(c);
      }
      case 'edge': { const e = nearestChain(); return e ? { p: e.p, n: hitN, what: 'Sobre arista' } : null; }
      case 'adv': {
        if (adv === 'mid') { const e = nearestChain(); return e ? { p: chainMid(e.pts), n: hitN, what: 'Punto medio de arista' } : null; }
        if (adv === 'center') { const e = nearestChain(); const cc = e && circleOf(e.pts); return cc ? { p: cc.c, n: cc.n, what: 'Centro de arco' } : null; }
        if (adv === 'facec') {
          if (!h) return null;
          const g = (h.object as THREE.Mesh).geometry, fg = g.userData.faceGroups as { start: number; count: number }[] | undefined;
          const idx = g.getIndex(), pos = g.getAttribute('position');
          const grp = fg?.find((q) => h.faceIndex! * 3 >= q.start && h.faceIndex! * 3 < q.start + q.count);
          if (!grp || !idx) return { p: h.point.clone(), n: hitN, what: 'Sobre cara' };
          const acc = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); let A = 0;
          for (let i = grp.start; i < grp.start + grp.count; i += 3) {
            a.fromBufferAttribute(pos, idx.getX(i)); b.fromBufferAttribute(pos, idx.getX(i + 1)); c.fromBufferAttribute(pos, idx.getX(i + 2));
            const ar = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2; A += ar;
            acc.addScaledVector(a.clone().add(b).add(c).divideScalar(3), ar);
          }
          return { p: A > 0 ? acc.divideScalar(A).applyMatrix4(h.object.matrixWorld) : h.point.clone(), n: hitN, what: 'Centro de cara' };
        }
        if (adv === 'two') return this.resolvePick('pcon', adv, cx, cy) ?? (h ? { p: h.point.clone(), n: hitN, what: 'Punto' } : null);
        return null;
      }
      default: return null;
    }
  }
  private markerAt(p: THREE.Vector3 | null, color = 0xf08c00, slot = 0) {
    if (!this.pickMarker) { this.pickMarker = new THREE.Group(); this.pickMarker.renderOrder = 30; this.scene.add(this.pickMarker); }
    let mk = this.pickMarker.children[slot] as THREE.Mesh | undefined;
    if (!mk) {
      mk = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
      mk.renderOrder = 30; mk.raycast = () => {}; this.pickMarker.add(mk);
    }
    mk.visible = !!p;
    if (p) { mk.position.copy(p); mk.scale.setScalar(this.worldPerPx() * 5); }
    this.request();
  }
  /** Designación activa: resalta el punto bajo el cursor y llama a `onPick` con cada clic (sin arrastre) */
  startPick(kind: PickKind, adv: AdvKind, onPick: (r: PickRes) => void) {
    this.stopPick();
    const cvs = this.renderer.domElement;
    cvs.style.cursor = 'crosshair';
    let first: THREE.Vector3 | null = null, down: { x: number; y: number } | null = null;
    const move = (e: PointerEvent) => { if (e.buttons) return; const r = this.resolvePick(kind, adv, e.clientX, e.clientY); this.markerAt(r?.p ?? null); };
    const pd = (e: PointerEvent) => { if (e.button === 0) down = { x: e.clientX, y: e.clientY }; };
    const pu = (e: PointerEvent) => {
      if (e.button !== 0 || !down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4; down = null; if (moved) return;
      const r = this.resolvePick(kind, adv, e.clientX, e.clientY); if (!r) return;
      r.p.set(...([r.p.x, r.p.y, r.p.z].map((x) => Math.round(x * 1000) / 1000) as [number, number, number]));
      if (kind === 'adv' && adv === 'two') {
        if (!first) { first = r.p.clone(); this.markerAt(first, 0x1673d0, 1); return; }
        const p = first.clone().add(r.p).multiplyScalar(0.5); first = null; this.markerAt(null, 0, 1);
        setTimeout(() => onPick({ p, n: r.n, what: 'Punto medio entre dos puntos' })); return;
      }
      setTimeout(() => onPick(r)); // tras los demás manejadores del clic (aún en designación: no seleccionan)
    };
    cvs.addEventListener('pointermove', move); cvs.addEventListener('pointerdown', pd, true); cvs.addEventListener('pointerup', pu, true);
    this.pickOff = () => {
      cvs.removeEventListener('pointermove', move); cvs.removeEventListener('pointerdown', pd, true); cvs.removeEventListener('pointerup', pu, true);
      cvs.style.cursor = ''; this.markerAt(null); this.markerAt(null, 0, 1); this.pickOff = undefined;
    };
  }
  stopPick() { this.pickOff?.(); }
  /** Hay una designación de punto en curso (los visores no seleccionan con el clic) */
  get picking() { return !!this.pickOff; }
  /** Marca fija (punto elegido en la ventana «Punto 3D») */
  showPoint(p: [number, number, number] | null) { this.markerAt(p ? new THREE.Vector3(...p) : null, 0x1673d0, 2); }
  /** Vista de sección (plano por el modelo con desfase e inversión), estilo alámbrico y líneas ocultas. */
  applyVisual(clip: '' | 'X' | 'Y' | 'Z', wire: boolean, meshes: THREE.Object3D[]) {
    const viewOpts = { style: useStore.getState().hud.style };
    this.clipTargets = meshes; this.hudClip = clip;
    this.refreshClip();
    const style = wire ? 'shaded' : viewOpts.style;
    const adds: [THREE.Object3D, THREE.Object3D][] = [], dels: THREE.Object3D[] = [];
    for (const m of meshes) m.traverse((o: any) => {
      if (o.userData.hidCopy) { dels.push(o); return; }
      if (o.isMesh && o.material && !o.userData.keep && !(o instanceof LineSegments2)) {
        o.material.visible = !wire;
        // sin líneas ocultas: las caras solo tapan (se ve el fondo)
        if (o.material.transparent !== true || o.material.opacity >= 1) o.material.colorWrite = style === 'shaded' && o.userData.noColor !== true;
      }
      if (style === 'hlv' && o instanceof LineSegments2 && o.userData.edge) {
        // se dibuja antes que todo (opaco, sin profundidad) y las aristas visibles quedan encima
        const hm = this.lineMat('#8a93a0', 0.9, true, false); hm.transparent = false; hm.depthWrite = false;
        const h = new LineSegments2(o.geometry, hm);
        h.userData.hidCopy = true; h.raycast = () => {}; h.renderOrder = -10;
        adds.push([o.parent!, h]);
      }
    });
    for (const d of dels) d.parent?.remove(d);
    for (const [p, h] of adds) p.add(h);
    this.request();
  }
  setMouse(drawing: boolean, panRight: boolean) {
    this.controls.mouseButtons = {
      LEFT: drawing ? (null as unknown as THREE.MOUSE) : THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: panRight ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
    };
  }

  private makeCube(ch: HTMLElement) {
    const cr = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    cr.setPixelRatio(dpr());
    cr.setSize(112, 112);
    ch.appendChild(cr.domElement);
    const cs = new THREE.Scene();
    const cc = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 20);
    const face = (txt: string, rotDeg: number) => {
      const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
      const g = c.getContext('2d')!;
      const grd = g.createLinearGradient(0, 0, 0, N); grd.addColorStop(0, '#f7f9fb'); grd.addColorStop(1, '#e3e8ee');
      g.fillStyle = grd; g.fillRect(0, 0, N, N);
      g.strokeStyle = '#8e99a6'; g.lineWidth = 10; g.strokeRect(5, 5, N - 10, N - 10);
      g.translate(N / 2, N / 2); g.rotate((-rotDeg * Math.PI) / 180);
      g.fillStyle = '#26303b'; g.font = `600 ${txt.length > 8 ? 70 : 84}px "Segoe UI", system-ui, -apple-system, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(txt, 0, 4);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true;
      return new THREE.MeshBasicMaterial({ map: t });
    };
    const cube = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), [
      face('DERECHA', 90), face('IZQUIERDA', -90), face('POSTERIOR', -180), face('FRONTAL', 0), face('SUPERIOR', 0), face('INFERIOR', -180),
    ]);
    cs.add(cube);
    cs.add(new THREE.LineSegments(new THREE.EdgesGeometry(cube.geometry), new THREE.LineBasicMaterial({ color: 0x8892a0 })));
    const sync = () => {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      cc.position.copy(dir.multiplyScalar(5)); cc.up.copy(this.camera.up); cc.lookAt(0, 0, 0);
      cr.render(cs, cc);
    };
    const rc = new THREE.Raycaster();
    cr.domElement.addEventListener('click', (ev) => {
      const r = cr.domElement.getBoundingClientRect();
      rc.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), cc);
      const hit = rc.intersectObject(cube)[0];
      if (!hit?.face) return;
      const p = hit.point, n = new THREE.Vector3();
      (['x', 'y', 'z'] as const).forEach((k) => { if (Math.abs(p[k]) > 0.45) n[k] = Math.sign(p[k]); });
      if (n.lengthSq() === 0) n.copy(hit.face.normal);
      this.viewFromNormal(n.normalize());
    });
    cr.domElement.style.cursor = 'pointer';
    sync();
    return { sync, dispose: () => { cr.dispose(); ch.innerHTML = ''; } };
  }
}

/** Cara plana bajo el cursor dentro de una malla del núcleo (normal y punto, en el espacio de la malla). */
export function planarFaceAt(m: MeshData, faceIndex: number): { planar: boolean; normal: THREE.Vector3; group: number } | null {
  const gIdx = m.faceGroups.findIndex((g) => faceIndex * 3 >= g.start && faceIndex * 3 < g.start + g.count);
  if (gIdx < 0) return null;
  const g = m.faceGroups[gIdx];
  const n0 = new THREE.Vector3();
  let planar = true;
  for (let i = g.start; i < g.start + g.count; i++) {
    const vi = m.triangles[i];
    const n = new THREE.Vector3(m.normals[vi * 3], m.normals[vi * 3 + 1], m.normals[vi * 3 + 2]);
    if (i === g.start) n0.copy(n); else if (n.angleTo(n0) > 1e-3) { planar = false; break; }
  }
  return { planar, normal: n0.normalize(), group: gIdx };
}

/** Vértices (únicos) de un grupo de cara. */
export function faceVertices(m: MeshData, group: number): THREE.Vector3[] {
  const g = m.faceGroups[group], seen = new Set<number>(), out: THREE.Vector3[] = [];
  for (let i = g.start; i < g.start + g.count; i++) {
    const vi = m.triangles[i];
    if (seen.has(vi)) continue;
    seen.add(vi);
    out.push(new THREE.Vector3(m.vertices[vi * 3], m.vertices[vi * 3 + 1], m.vertices[vi * 3 + 2]));
  }
  return out;
}

// ---------- Designación de puntos: tipos y topología de aristas ----------
export type PickKind = 'cursor3d' | 'vertex' | 'face' | 'pcon' | 'aux' | 'cursor2d' | 'edge' | 'adv';
export type AdvKind = 'mid' | 'center' | 'facec' | 'two' | 'bbox' | 'origin';
export interface PickRes { p: THREE.Vector3; n?: THREE.Vector3; what: string }
interface EdgeTopo { corners: THREE.Vector3[]; chains: THREE.Vector3[][] }
/** Agrupa los segmentos de aristas en cadenas (aristas del modelo) separadas por vértices (esquinas o uniones de 3+) */
function edgeTopo(a: Float32Array): EdgeTopo {
  const key = (i: number) => `${Math.round(a[i] * 1e3)}_${Math.round(a[i + 1] * 1e3)}_${Math.round(a[i + 2] * 1e3)}`;
  const nodes = new Map<string, { p: THREE.Vector3; segs: number[] }>();
  const nseg = Math.floor(a.length / 6), ends: [string, string][] = [];
  for (let s = 0; s < nseg; s++) {
    const ka = key(s * 6), kb = key(s * 6 + 3); ends.push([ka, kb]);
    if (ka === kb) continue;
    for (const [k, o] of [[ka, s * 6], [kb, s * 6 + 3]] as const) { let n = nodes.get(k); if (!n) nodes.set(k, (n = { p: new THREE.Vector3(a[o], a[o + 1], a[o + 2]), segs: [] })); n.segs.push(s); }
  }
  const other = (s: number, k: string) => (ends[s][0] === k ? ends[s][1] : ends[s][0]);
  const isCorner = (k: string) => {
    const n = nodes.get(k)!; if (n.segs.length !== 2) return true;
    const u = nodes.get(other(n.segs[0], k))!.p.clone().sub(n.p).normalize(), v = nodes.get(other(n.segs[1], k))!.p.clone().sub(n.p).normalize();
    return u.dot(v) > Math.cos((145 * Math.PI) / 180); // giro de más de 35°
  };
  const corner = new Map<string, boolean>(); for (const k of nodes.keys()) corner.set(k, isCorner(k));
  const used = new Set<number>(), chains: THREE.Vector3[][] = [];
  const walk = (k0: string, s0: number) => {
    const pts = [nodes.get(k0)!.p]; let k = k0, s = s0;
    for (let guard = 0; guard < 1e6; guard++) {
      used.add(s); k = other(s, k); pts.push(nodes.get(k)!.p);
      if (corner.get(k) || k === k0) break;
      const nx = nodes.get(k)!.segs.find((q) => !used.has(q)); if (nx === undefined) break; s = nx;
    }
    chains.push(pts);
  };
  for (const [k, n] of nodes) if (corner.get(k)) for (const s of n.segs) if (!used.has(s)) walk(k, s);
  for (const [k, n] of nodes) for (const s of n.segs) if (!used.has(s)) walk(k, s); // bucles cerrados sin esquinas
  return { corners: [...nodes].filter(([k]) => corner.get(k)).map(([, n]) => n.p), chains };
}
/** Punto medio (por longitud) de una cadena de puntos */
function chainMid(W: THREE.Vector3[]) {
  let L = 0; for (let i = 0; i + 1 < W.length; i++) L += W[i].distanceTo(W[i + 1]);
  let acc = 0;
  for (let i = 0; i + 1 < W.length; i++) { const d = W[i].distanceTo(W[i + 1]); if (acc + d >= L / 2) return W[i].clone().lerp(W[i + 1], d ? (L / 2 - acc) / d : 0); acc += d; }
  return W[0].clone();
}
/** Centro y normal si la cadena es un arco o circunferencia */
function circleOf(W: THREE.Vector3[]): { c: THREE.Vector3; n: THREE.Vector3 } | null {
  if (W.length < 4) return null;
  const A = W[0], B = W[Math.floor(W.length / 3)], C = W[Math.floor((2 * W.length) / 3)];
  const ab = B.clone().sub(A), ac = C.clone().sub(A), n = ab.clone().cross(ac); const n2 = n.lengthSq(); if (n2 < 1e-12) return null;
  const c = A.clone().add(n.clone().cross(ab).multiplyScalar(ac.lengthSq()).add(ac.clone().cross(n).multiplyScalar(ab.lengthSq())).divideScalar(2 * n2));
  const R = c.distanceTo(A); if (!(R > 1e-6)) return null;
  for (const p of W) if (Math.abs(p.distanceTo(c) - R) > Math.max(0.02 * R, 1e-3)) return null;
  return { c, n: n.normalize() };
}
