// Análisis estático lineal de piezas por elementos finitos: la pieza se voxeliza en hexaedros de 8 nudos
// (todos iguales: una sola matriz de rigidez) y se resuelve K·u = f con gradiente conjugado precondicionado (Jacobi)
// sin ensamblar la matriz. Unidades: mm, N, MPa.
export interface FemIn {
  vertices: Float32Array; normals: Float32Array; triangles: Uint32Array; faceGroups: { start: number; count: number }[];
  h: number; E: number; nu: number;
  fixed: number[];
  loads: { faces: number[]; F?: [number, number, number]; p?: number }[];
}
export interface FemOut { vmVert: Float32Array; dispVert: Float32Array; vmMax: number; dispMax: number; nVox: number; nDof: number; iters: number; ms: number; error?: string; vertices?: Float32Array; normals?: Float32Array; triangles?: Uint32Array }

function hexKe(h: number, E: number, nu: number) {
  const D = (() => { const c = E / ((1 + nu) * (1 - 2 * nu)); const d = new Float64Array(36); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) d[i * 6 + j] = c * (i === j ? 1 - nu : nu); for (let i = 3; i < 6; i++) d[i * 6 + i] = c * (1 - 2 * nu) / 2; return d; })();
  const nodes = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const Bat = (xi: number, et: number, ze: number) => {
    const B = new Float64Array(6 * 24), J = h / 2;
    for (let a = 0; a < 8; a++) {
      const [xa, ya, za] = nodes[a];
      const dx = (xa * (1 + ya * et) * (1 + za * ze)) / 8 / J, dy = (ya * (1 + xa * xi) * (1 + za * ze)) / 8 / J, dz = (za * (1 + xa * xi) * (1 + ya * et)) / 8 / J;
      const c = a * 3;
      B[0 * 24 + c] = dx; B[1 * 24 + c + 1] = dy; B[2 * 24 + c + 2] = dz;
      B[3 * 24 + c] = dy; B[3 * 24 + c + 1] = dx;
      B[4 * 24 + c + 1] = dz; B[4 * 24 + c + 2] = dy;
      B[5 * 24 + c] = dz; B[5 * 24 + c + 2] = dx;
    }
    return B;
  };
  const K = new Float64Array(576), g = 1 / Math.sqrt(3), detJ = (h / 2) ** 3;
  for (const xi of [-g, g]) for (const et of [-g, g]) for (const ze of [-g, g]) {
    const B = Bat(xi, et, ze);
    const DB = new Float64Array(6 * 24);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 24; j++) { let s = 0; for (let k = 0; k < 6; k++) s += D[i * 6 + k] * B[k * 24 + j]; DB[i * 24 + j] = s; }
    for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) { let s = 0; for (let k = 0; k < 6; k++) s += B[k * 24 + i] * DB[k * 24 + j]; K[i * 24 + j] += s * detJ; }
  }
  return { K, D, Bc: Bat(0, 0, 0), Bat };
}

function run(inp: FemIn): FemOut {
  const t0 = performance.now();
  const V = inp.vertices, T = inp.triangles, h = inp.h;
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < V.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], V[i + k]); mx[k] = Math.max(mx[k], V[i + k]); }
  mn = mn.map((x) => x - h * 1e-3); mx = mx.map((x) => x + h * 1e-3);
  const nx = Math.max(1, Math.ceil((mx[0] - mn[0]) / h)), ny = Math.max(1, Math.ceil((mx[1] - mn[1]) / h)), nz = Math.max(1, Math.ceil((mx[2] - mn[2]) / h));
  // ---- voxelizado por rayos según Z (paridad) ----
  const bins: number[][] = Array.from({ length: nx * ny }, () => []);
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
    const x0 = Math.min(V[a], V[b], V[c]), x1 = Math.max(V[a], V[b], V[c]), y0 = Math.min(V[a + 1], V[b + 1], V[c + 1]), y1 = Math.max(V[a + 1], V[b + 1], V[c + 1]);
    const i0 = Math.max(0, Math.floor((x0 - mn[0]) / h - 0.5)), i1 = Math.min(nx - 1, Math.ceil((x1 - mn[0]) / h - 0.5));
    const j0 = Math.max(0, Math.floor((y0 - mn[1]) / h - 0.5)), j1 = Math.min(ny - 1, Math.ceil((y1 - mn[1]) / h - 0.5));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) bins[i * ny + j].push(t);
  }
  const occ = new Uint8Array(nx * ny * nz);
  const vid = (i: number, j: number, k: number) => (i * ny + j) * nz + k;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const px = mn[0] + (i + 0.5) * h + 1e-4, py = mn[1] + (j + 0.5) * h + 1.3e-4;
    const zs: number[] = [];
    for (const t of bins[i * ny + j]) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const ax = V[a], ay = V[a + 1], bx = V[b], by = V[b + 1], cx = V[c], cy = V[c + 1];
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(d) < 1e-12) continue;
      const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      zs.push(l1 * V[a + 2] + l2 * V[b + 2] + l3 * V[c + 2]);
    }
    zs.sort((p, q) => p - q);
    for (let s = 0; s + 1 < zs.length; s += 2) {
      const k0 = Math.max(0, Math.ceil((zs[s] - mn[2]) / h - 0.5)), k1 = Math.min(nz - 1, Math.floor((zs[s + 1] - mn[2]) / h - 0.5));
      for (let k = k0; k <= k1; k++) occ[vid(i, j, k)] = 1;
    }
  }
  // ---- nudos ----
  const NX = nx + 1, NY = ny + 1, NZ = nz + 1;
  const nodeId = new Int32Array(NX * NY * NZ).fill(-1);
  const nid = (i: number, j: number, k: number) => (i * NY + j) * NZ + k;
  const vox: number[] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) if (occ[vid(i, j, k)]) vox.push(i, j, k);
  const nVox = vox.length / 3;
  if (!nVox) return { vmVert: new Float32Array(), dispVert: new Float32Array(), vmMax: 0, dispMax: 0, nVox: 0, nDof: 0, iters: 0, ms: 0, error: 'No se pudo voxelizar la pieza (¿sólido cerrado?)' };
  let nn = 0;
  const OFF = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const conn = new Int32Array(nVox * 8);
  for (let e = 0; e < nVox; e++) for (let a = 0; a < 8; a++) {
    const g = nid(vox[e * 3] + OFF[a][0], vox[e * 3 + 1] + OFF[a][1], vox[e * 3 + 2] + OFF[a][2]);
    if (nodeId[g] < 0) nodeId[g] = nn++;
    conn[e * 8 + a] = nodeId[g];
  }
  const nDof = nn * 3;
  const { K, D, Bc, Bat } = hexKe(h, inp.E, inp.nu);
  // ---- condiciones de contorno: muestreo de las caras elegidas ----
  const nodesOnFaces = (faces: number[]) => {
    const set = new Map<number, number>(); // nudo → área asociada
    for (const fi of faces) {
      const g = inp.faceGroups[fi]; if (!g) continue;
      for (let t = g.start; t < g.start + g.count; t += 3) {
        const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
        const e1 = [V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]], e2 = [V[c] - V[a], V[c + 1] - V[a + 1], V[c + 2] - V[a + 2]];
        const area = 0.5 * Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
        const ns = Math.max(1, Math.ceil(Math.max(Math.hypot(...e1), Math.hypot(...e2)) / (h * 0.5)));
        let cnt = 0; const hits: number[] = [];
        for (let u = 0; u <= ns; u++) for (let w = 0; w <= ns - u; w++) {
          const p = [V[a] + (e1[0] * u + e2[0] * w) / ns, V[a + 1] + (e1[1] * u + e2[1] * w) / ns, V[a + 2] + (e1[2] * u + e2[2] * w) / ns];
          const gi = Math.round((p[0] - mn[0]) / h), gj = Math.round((p[1] - mn[1]) / h), gk = Math.round((p[2] - mn[2]) / h);
          let best = -1, bd = Infinity;
          for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
            const ii = gi + di, jj = gj + dj, kk = gk + dk; if (ii < 0 || jj < 0 || kk < 0 || ii >= NX || jj >= NY || kk >= NZ) continue;
            const id = nodeId[nid(ii, jj, kk)]; if (id < 0) continue;
            const d = (mn[0] + ii * h - p[0]) ** 2 + (mn[1] + jj * h - p[1]) ** 2 + (mn[2] + kk * h - p[2]) ** 2;
            if (d < bd) { bd = d; best = id; }
          }
          if (best >= 0 && bd < (1.2 * h) ** 2) { hits.push(best); cnt++; }
        }
        for (const id of hits) set.set(id, (set.get(id) ?? 0) + area / Math.max(cnt, 1));
      }
    }
    return set;
  };
  const fixed = new Uint8Array(nDof);
  const fx = nodesOnFaces(inp.fixed);
  if (!fx.size) return { vmVert: new Float32Array(), dispVert: new Float32Array(), vmMax: 0, dispMax: 0, nVox, nDof, iters: 0, ms: 0, error: 'Elige al menos una cara fija' };
  for (const id of fx.keys()) { fixed[id * 3] = 1; fixed[id * 3 + 1] = 1; fixed[id * 3 + 2] = 1; }
  const f = new Float64Array(nDof);
  for (const L of inp.loads) {
    const ns = nodesOnFaces(L.faces), tot = [...ns.values()].reduce((a, b) => a + b, 0) || 1;
    let Fv: number[] = L.F ?? [0, 0, 0];
    if (L.p) {
      // presión: fuerza = p·área según la normal media de las caras (hacia dentro)
      let nxs = 0, nys = 0, nzs = 0, A = 0;
      for (const fi of L.faces) { const g = inp.faceGroups[fi]; if (!g) continue; for (let t = g.start; t < g.start + g.count; t += 3) { const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3; const e1 = [V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]], e2 = [V[c] - V[a], V[c + 1] - V[a + 1], V[c + 2] - V[a + 2]]; const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; nxs += n[0] / 2; nys += n[1] / 2; nzs += n[2] / 2; A += Math.hypot(...n) / 2; } }
      const l = Math.hypot(nxs, nys, nzs) || 1; Fv = [-(nxs / l) * L.p * A, -(nys / l) * L.p * A, -(nzs / l) * L.p * A];
    }
    for (const [id, w] of ns) for (let d = 0; d < 3; d++) f[id * 3 + d] += (Fv[d] * w) / tot;
  }
  for (let i = 0; i < nDof; i++) if (fixed[i]) f[i] = 0;
  // ---- K·u sin ensamblar ----
  const Ku = (u: Float64Array, out: Float64Array) => {
    out.fill(0);
    const ue = new Float64Array(24);
    for (let e = 0; e < nVox; e++) {
      for (let a = 0; a < 8; a++) { const n = conn[e * 8 + a] * 3; ue[a * 3] = u[n]; ue[a * 3 + 1] = u[n + 1]; ue[a * 3 + 2] = u[n + 2]; }
      for (let i = 0; i < 24; i++) {
        let s = 0; const r = i * 24;
        for (let j = 0; j < 24; j++) s += K[r + j] * ue[j];
        out[conn[e * 8 + ((i / 3) | 0)] * 3 + (i % 3)] += s;
      }
    }
    for (let i = 0; i < nDof; i++) if (fixed[i]) out[i] = u[i];
  };
  const diag = new Float64Array(nDof);
  for (let e = 0; e < nVox; e++) for (let i = 0; i < 24; i++) diag[conn[e * 8 + ((i / 3) | 0)] * 3 + (i % 3)] += K[i * 24 + i];
  for (let i = 0; i < nDof; i++) if (fixed[i] || !diag[i]) diag[i] = 1;
  const u = new Float64Array(nDof), r = Float64Array.from(f), z = new Float64Array(nDof), p = new Float64Array(nDof), Ap = new Float64Array(nDof);
  for (let i = 0; i < nDof; i++) { z[i] = r[i] / diag[i]; p[i] = z[i]; }
  let rz = 0; for (let i = 0; i < nDof; i++) rz += r[i] * z[i];
  const f2 = Math.sqrt(f.reduce((a, b) => a + b * b, 0)) || 1;
  let it = 0;
  for (; it < 6000; it++) {
    Ku(p, Ap);
    let pAp = 0; for (let i = 0; i < nDof; i++) pAp += p[i] * Ap[i];
    const al = rz / pAp;
    let rr = 0;
    for (let i = 0; i < nDof; i++) { u[i] += al * p[i]; r[i] -= al * Ap[i]; rr += r[i] * r[i]; }
    if (Math.sqrt(rr) / f2 < 1e-6) break;
    let rz2 = 0; for (let i = 0; i < nDof; i++) { z[i] = r[i] / diag[i]; rz2 += r[i] * z[i]; }
    const be = rz2 / rz; rz = rz2;
    for (let i = 0; i < nDof; i++) p[i] = z[i] + be * p[i];
    if (it % 50 === 0) (self as unknown as Worker).postMessage({ progress: it });
  }
  // ---- tensiones en el centro de cada vóxel ----
  const vmVox = new Float32Array(nVox);
  const ue = new Float64Array(24), eps = new Float64Array(6);
  let vmMax = 0;
  for (let e = 0; e < nVox; e++) {
    for (let a = 0; a < 8; a++) { const n = conn[e * 8 + a] * 3; ue[a * 3] = u[n]; ue[a * 3 + 1] = u[n + 1]; ue[a * 3 + 2] = u[n + 2]; }
    for (let i = 0; i < 6; i++) { let s = 0; for (let j = 0; j < 24; j++) s += Bc[i * 24 + j] * ue[j]; eps[i] = s; }
    const sg = [0, 0, 0, 0, 0, 0]; for (let i = 0; i < 6; i++) { let s = 0; for (let k = 0; k < 6; k++) s += D[i * 6 + k] * eps[k]; sg[i] = s; }
    const vm = Math.sqrt(0.5 * ((sg[0] - sg[1]) ** 2 + (sg[1] - sg[2]) ** 2 + (sg[2] - sg[0]) ** 2) + 3 * (sg[3] ** 2 + sg[4] ** 2 + sg[5] ** 2));
    vmVox[e] = vm;
  }
  // ---- malla de presentación: triángulos de la pieza subdivididos a ~h/2 y valores en cada vértice ----
  const voxIdx = new Int32Array(nx * ny * nz).fill(-1);
  for (let e = 0; e < nVox; e++) voxIdx[vid(vox[e * 3], vox[e * 3 + 1], vox[e * 3 + 2])] = e;
  let dispMax = 0;
  for (let n = 0; n < nn; n++) dispMax = Math.max(dispMax, Math.hypot(u[n * 3], u[n * 3 + 1], u[n * 3 + 2]));
  const NR = inp.normals;
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const nTri = T.length / 3;
  let budget = 600000; // vértices máx. de la malla de presentación
  const target = h * 0.5;
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
    const L = Math.max(Math.hypot(V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]), Math.hypot(V[c] - V[a], V[c + 1] - V[a + 1], V[c + 2] - V[a + 2]), Math.hypot(V[c] - V[b], V[c + 1] - V[b + 1], V[c + 2] - V[b + 2]));
    const left = nTri - t / 3;
    let n = Math.max(1, Math.ceil(L / target));
    while (n > 1 && ((n + 1) * (n + 2)) / 2 > budget / left) n--;
    const base = pos.length / 3;
    const row: number[] = [];
    let k = 0;
    for (let i = 0; i <= n; i++) { row.push(k); for (let j = 0; j <= n - i; j++) {
      const wb = i / n, wc = j / n, wa = 1 - wb - wc;
      for (let d = 0; d < 3; d++) { pos.push(wa * V[a + d] + wb * V[b + d] + wc * V[c + d]); nor.push(wa * NR[a + d] + wb * NR[b + d] + wc * NR[c + d]); }
      k++;
    } }
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
      const p0 = base + row[i] + j, p1 = base + row[i + 1] + j, p2 = base + row[i] + j + 1;
      idx.push(p0, p1, p2);
      if (j < n - i - 1) { const p3 = base + row[i + 1] + j + 1; idx.push(p2, p1, p3); }
    }
    budget -= k;
  }
  const nv = pos.length / 3, vmVert = new Float32Array(nv), dispVert = new Float32Array(nv);
  const Nsh = (xi: number, et: number, ze: number) => [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(([x, y, z]) => ((1 + x * xi) * (1 + y * et) * (1 + z * ze)) / 8);
  for (let v = 0; v < nv; v++) {
    const X = pos[v * 3], Y = pos[v * 3 + 1], Z = pos[v * 3 + 2];
    const fi = (X - mn[0]) / h, fj = (Y - mn[1]) / h, fk = (Z - mn[2]) / h;
    const ci = Math.min(nx - 1, Math.max(0, Math.floor(fi))), cj = Math.min(ny - 1, Math.max(0, Math.floor(fj))), ck = Math.min(nz - 1, Math.max(0, Math.floor(fk)));
    let e = voxIdx[vid(ci, cj, ck)];
    if (e < 0) { let bd = Infinity; for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) for (let dk = -2; dk <= 2; dk++) {
      const ii = ci + di, jj = cj + dj, kk = ck + dk; if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
      const q = voxIdx[vid(ii, jj, kk)]; if (q < 0) continue;
      const d = (ii + 0.5 - fi) ** 2 + (jj + 0.5 - fj) ** 2 + (kk + 0.5 - fk) ** 2; if (d < bd) { bd = d; e = q; }
    } }
    if (e < 0) continue;
    const cl = (x: number) => Math.max(-1, Math.min(1, x));
    const xi = cl((fi - vox[e * 3]) * 2 - 1), et = cl((fj - vox[e * 3 + 1]) * 2 - 1), ze = cl((fk - vox[e * 3 + 2]) * 2 - 1);
    for (let a = 0; a < 8; a++) { const n = conn[e * 8 + a] * 3; ue[a * 3] = u[n]; ue[a * 3 + 1] = u[n + 1]; ue[a * 3 + 2] = u[n + 2]; }
    const B = Bat(xi, et, ze);
    for (let i = 0; i < 6; i++) { let q = 0; for (let j = 0; j < 24; j++) q += B[i * 24 + j] * ue[j]; eps[i] = q; }
    const sg = [0, 0, 0, 0, 0, 0]; for (let i = 0; i < 6; i++) { let q = 0; for (let k = 0; k < 6; k++) q += D[i * 6 + k] * eps[k]; sg[i] = q; }
    vmVert[v] = Math.sqrt(0.5 * ((sg[0] - sg[1]) ** 2 + (sg[1] - sg[2]) ** 2 + (sg[2] - sg[0]) ** 2) + 3 * (sg[3] ** 2 + sg[4] ** 2 + sg[5] ** 2));
    const N = Nsh(xi, et, ze); let ux = 0, uy = 0, uz = 0;
    for (let a = 0; a < 8; a++) { ux += N[a] * ue[a * 3]; uy += N[a] * ue[a * 3 + 1]; uz += N[a] * ue[a * 3 + 2]; }
    dispVert[v] = Math.hypot(ux, uy, uz);
  }
  // máximo robusto en superficie: percentil 99,5 de los vértices (la malla es uniforme, ~h/2)
  { const sv = Float32Array.from(vmVert).sort(); vmMax = sv[Math.min(sv.length - 1, Math.floor(sv.length * 0.995))]; }
  return { vmVert, dispVert, vmMax, dispMax, nVox, nDof, iters: it, ms: performance.now() - t0, vertices: new Float32Array(pos), normals: new Float32Array(nor), triangles: new Uint32Array(idx) };
}

self.onmessage = (ev: MessageEvent<FemIn>) => {
  try { const r = run(ev.data); (self as unknown as Worker).postMessage({ done: r }); }
  catch (e) { (self as unknown as Worker).postMessage({ done: { error: (e as Error).message } }); }
};
