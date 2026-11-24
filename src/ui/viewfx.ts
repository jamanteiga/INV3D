// Efectos de visualización: análisis de cebra, inclinación (desmoldeo) y curvatura, y modo estudio (render realista).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** Cebra: franjas de reflexión según la normal en espacio de vista */
export function zebraMaterial(stripes = 12): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { k: { value: stripes } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float k; varying vec3 vN; varying vec3 vV; void main(){ vec3 r = reflect(-vV, normalize(vN)); float s = step(0.5, fract(r.y * k * 0.5 + 0.5)); vec3 c = mix(vec3(0.08), vec3(0.97), s); gl_FragColor = vec4(c, 1.0); }',
    side: THREE.DoubleSide,
  });
}

/** Inclinación respecto a la dirección de desmoldeo: verde ≥ ángulo, amarillo entre ±ángulo, rojo en contrasalida */
export function draftColors(g: THREE.BufferGeometry, dir: THREE.Vector3, angleDeg: number) {
  const n = g.getAttribute('normal') as THREE.BufferAttribute, col = new Float32Array(n.count * 3);
  const d = dir.clone().normalize(), lim = Math.sin((angleDeg * Math.PI) / 180);
  for (let i = 0; i < n.count; i++) {
    const s = n.getX(i) * d.x + n.getY(i) * d.y + n.getZ(i) * d.z;   // seno del ángulo de inclinación
    const c = s >= lim - 1e-6 ? [0.2, 0.72, 0.3] : s <= -lim + 1e-6 ? [0.85, 0.22, 0.18] : [0.95, 0.8, 0.15];
    col.set(c, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** Curvatura aproximada por vértice (variación de la normal respecto a los vecinos / distancia) */
export function curvColors(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute('position') as THREE.BufferAttribute, nor = g.getAttribute('normal') as THREE.BufferAttribute, idx = g.getIndex();
  const nV = pos.count, acc = new Float32Array(nV), cnt = new Float32Array(nV);
  const add = (a: number, b: number) => {
    const dx = pos.getX(a) - pos.getX(b), dy = pos.getY(a) - pos.getY(b), dz = pos.getZ(a) - pos.getZ(b), l = Math.hypot(dx, dy, dz); if (l < 1e-9) return;
    const dot = Math.max(-1, Math.min(1, nor.getX(a) * nor.getX(b) + nor.getY(a) * nor.getY(b) + nor.getZ(a) * nor.getZ(b)));
    const k = Math.acos(dot) / l; acc[a] += k; cnt[a]++; acc[b] += k; cnt[b]++;
  };
  const T = idx ? idx.array : Array.from({ length: nV }, (_, i) => i);
  for (let t = 0; t + 2 < T.length; t += 3) { add(T[t], T[t + 1]); add(T[t + 1], T[t + 2]); add(T[t + 2], T[t]); }
  const k = Array.from(acc, (v, i) => (cnt[i] ? v / cnt[i] : 0));
  const sorted = [...k].sort((a, b) => a - b), kmax = sorted[Math.floor(sorted.length * 0.97)] || 1e-6;
  const col = new Float32Array(nV * 3);
  const ramp = (t: number) => { const st = [[0.13, 0.3, 0.85], [0.1, 0.75, 0.85], [0.25, 0.8, 0.3], [0.95, 0.85, 0.15], [0.9, 0.15, 0.1]]; const x = Math.max(0, Math.min(1, t)) * 4, i = Math.min(3, Math.floor(x)), f = x - i; return st[i].map((a, j) => a + (st[i + 1][j] - a) * f); };
  for (let i = 0; i < nV; i++) col.set(ramp(k[i] / kmax), i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return kmax;
}

/** Modo estudio: entorno HDR, mapeo de tonos, sombras y suelo */
let envTex: THREE.Texture | null = null;
export function studio(renderer: THREE.WebGLRenderer, scene: THREE.Scene, group: THREE.Group, box: THREE.Box3, on: boolean) {
  const old = scene.getObjectByName('__studio'); if (old) scene.remove(old);
  if (!on) { scene.environment = null; renderer.toneMapping = THREE.NoToneMapping; renderer.shadowMap.enabled = false; return; }
  if (!envTex) { const pm = new THREE.PMREMGenerator(renderer); envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); }
  scene.environment = envTex;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.8;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const g = new THREE.Group(); g.name = '__studio';
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3()), R = Math.max(size.x, size.y, size.z, 10);
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(c.x + R, c.y - R * 0.6, c.z + R * 2); sun.target.position.copy(c); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera as THREE.OrthographicCamera; sc.left = sc.bottom = -R * 1.5; sc.right = sc.top = R * 1.5; sc.near = 0.1; sc.far = R * 8; sun.shadow.bias = -0.0005;
  g.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(R * 8, R * 8), new THREE.ShadowMaterial({ opacity: 0.25 }));
  ground.position.set(c.x, c.y, box.min.z - 0.01); ground.receiveShadow = true; ground.raycast = () => {};
  g.add(ground);
  scene.add(g);
  group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; const mt = m.material as THREE.MeshStandardMaterial; if (mt && 'envMapIntensity' in mt) mt.envMapIntensity = 1; } });
}
