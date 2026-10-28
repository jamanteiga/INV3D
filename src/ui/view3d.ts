// Núcleo del visor 3D compartido por pieza y ensamblaje: cámara ortográfica Z-arriba, órbita,
// ViewCube, triada, iluminación, utilidades de líneas gruesas, proyección y selección.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { V3 } from '../core/doc';
import type { MeshData } from '../core/cadClient';

export const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000';
export const tv = (p: V3 | number[]) => new THREE.Vector3(p[0], p[1], p[2]);
export const r3 = (x: number) => String(Math.round(x * 1000) / 1000);
export const vArr = (v: THREE.Vector3, d = 6): V3 => [Number(v.x.toFixed(d)), Number(v.y.toFixed(d)), Number(v.z.toFixed(d))];

const VIEWS: Record<string, [V3, V3]> = {
  home: [[-1, 1, -0.8], [0, 0, 1]], front: [[0, 1, 0], [0, 0, 1]], back: [[0, -1, 0], [0, 0, 1]],
  top: [[0, 0, -1], [0, 1, 0]], bottom: [[0, 0, 1], [0, -1, 0]], right: [[-1, 0, 0], [0, 0, 1]], left: [[1, 0, 0], [0, 0, 1]],
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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(el); this.resize();
    this.controls.addEventListener('change', () => { this.request(); this.onChange(); });
    this.cube = this.makeCube(cubeHost);
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
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
    cancelAnimationFrame(this.raf); this.ro.disconnect(); this.controls.dispose(); this.renderer.dispose(); this.cube?.dispose();
    this.el.removeChild(this.renderer.domElement);
  }
  request() { this.needs = true; }
  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / Math.max(h, 1), H = 300;
    Object.assign(this.camera, { left: (-H * aspect) / 2, right: (H * aspect) / 2, top: H / 2, bottom: -H / 2 });
    this.camera.updateProjectionMatrix();
    this.lineMats.forEach((m) => m.resolution.set(w, h));
    this.request();
  }
  worldPerPx() { return (this.camera.top - this.camera.bottom) / this.camera.zoom / Math.max(this.el.clientHeight, 1); }

  // ---- Líneas ----
  lineMat(color: string, width: number, dashed = false, depthTest = true) {
    const m = new LineMaterial({ color: new THREE.Color(color), linewidth: width, dashed, dashSize: 3, gapSize: 2, depthTest, transparent: !depthTest });
    this.lineMats.push(m);
    m.resolution.set(this.el.clientWidth, this.el.clientHeight);
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
      const eg = new THREE.BufferGeometry();
      eg.setAttribute('position', new THREE.BufferAttribute(m.lines, 3));
      grp.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: css('--edge'), transparent: op < 1, opacity: op < 1 ? Math.max(op, 0.3) : 1 })));
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
  fitTo(box: THREE.Box3, dir: THREE.Vector3, up: THREE.Vector3) {
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
    if (name === 'fit') return this.fitTo(this.viewBox(), this.camDir(), this.camera.up.clone());
    const v = VIEWS[name];
    if (v) this.fitTo(this.viewBox(), tv(v[0]), tv(v[1]));
  }
  saveCamera() { this.saved = { pos: this.camera.position.clone(), target: this.controls.target.clone(), up: this.camera.up.clone(), zoom: this.camera.zoom }; }
  viewFromNormal(n: THREE.Vector3) {
    const up = Math.abs(n.z) > 0.9 ? new THREE.Vector3(0, n.z > 0 ? 1 : -1, 0) : new THREE.Vector3(0, 0, 1);
    this.fitTo(this.viewBox(), n.clone().negate(), up);
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
    cr.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    cr.setSize(104, 104);
    ch.appendChild(cr.domElement);
    const cs = new THREE.Scene();
    const cc = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 20);
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
