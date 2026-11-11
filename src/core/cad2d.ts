// Lectura de dibujos 2D externos (DXF, DWG y DGN V7) a una geometría simple de líneas y textos,
// para usarlos como plantillas de cajetín. Los bloques (INSERT) se expanden y los atributos (ATTDEF/ATTRIB)
// se convierten en etiquetas enlazadas a campos del plano.
export type P2 = [number, number];
export interface GeoText { x: number; y: number; h: number; text: string; rot?: number }
export interface GeoTag { x: number; y: number; h: number; tag: string; rot?: number }
export interface Geo2D { lines: P2[][]; texts: GeoText[]; tags: GeoTag[]; unit?: string }

const arcPts = (cx: number, cy: number, r: number, a0: number, a1: number): P2[] => {
  let sw = a1 - a0; while (sw <= 0) sw += 360;
  const n = Math.max(6, Math.ceil(sw / 6)), out: P2[] = [];
  for (let k = 0; k <= n; k++) { const a = ((a0 + (sw * k) / n) * Math.PI) / 180; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
};
/** Polilínea con abombamientos (bulge) entre vértices */
const bulgePts = (pts: { x: number; y: number; b: number }[], closed: boolean): P2[] => {
  const out: P2[] = [];
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i], c = pts[(i + 1) % n];
    out.push([a.x, a.y]);
    if (Math.abs(a.b) > 1e-9) {
      const th = 4 * Math.atan(a.b), dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy);
      if (d > 1e-12) {
        const r = d / (2 * Math.sin(th / 2)), mx = (a.x + c.x) / 2, my = (a.y + c.y) / 2, h = r * Math.cos(th / 2);
        const cx = mx - (dy / d) * h, cy = my + (dx / d) * h;
        const a0 = Math.atan2(a.y - cy, a.x - cx), seg = Math.max(4, Math.ceil(Math.abs(th) / 0.15));
        for (let k = 1; k < seg; k++) { const t = a0 + (th * k) / seg; out.push([cx + Math.abs(r) * Math.cos(t), cy + Math.abs(r) * Math.sin(t)]); }
      }
    }
  }
  const last = closed ? pts[0] : pts[n - 1];
  if (last) out.push([last.x, last.y]);
  return out;
};
const cleanMText = (t: string) => t.replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;\\]*;/g, '').replace(/\\[A-Za-z]/g, '').replace(/[{}]/g, '').replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±');

// ---------- Transformaciones de bloque ----------
type Xf = (p: P2) => P2;
const mkXf = (ip: P2, sx: number, sy: number, rotDeg: number, base: P2): Xf => {
  const c = Math.cos((rotDeg * Math.PI) / 180), s = Math.sin((rotDeg * Math.PI) / 180);
  return ([x, y]) => { const u = (x - base[0]) * sx, v = (y - base[1]) * sy; return [ip[0] + u * c - v * s, ip[1] + u * s + v * c]; };
};

// ---------- DXF ----------
interface DxfEnt { type: string; g: [number, string][]; sub?: DxfEnt[] }
export function dxfToGeo(text: string): Geo2D {
  const raw = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) pairs.push([parseInt(raw[i].trim(), 10), raw[i + 1].replace(/\s+$/, '')]);
  // Agrupa entidades (código 0) por sección
  const sections = new Map<string, DxfEnt[]>();
  let sec = '', i = 0;
  while (i < pairs.length) {
    const [c, v] = pairs[i];
    if (c === 0 && v.trim() === 'SECTION') { sec = pairs[i + 1]?.[1].trim() ?? ''; sections.set(sec, []); i += 2; continue; }
    if (c === 0 && v.trim() === 'ENDSEC') { sec = ''; i++; continue; }
    if (c === 0 && sec) {
      const e: DxfEnt = { type: v.trim(), g: [] }; i++;
      while (i < pairs.length && pairs[i][0] !== 0) e.g.push(pairs[i++]);
      sections.get(sec)!.push(e);
      continue;
    }
    i++;
  }
  const units = (() => { const h = sections.get('HEADER') ?? []; void h; const k = pairs.findIndex((p) => p[0] === 9 && p[1].trim() === '$INSUNITS'); return k >= 0 ? parseInt(pairs[k + 1]?.[1] ?? '4', 10) : 4; })();
  // Bloques
  const blocks = new Map<string, { base: P2; ents: DxfEnt[] }>();
  let cur: { name: string; base: P2; ents: DxfEnt[] } | null = null;
  for (const e of sections.get('BLOCKS') ?? []) {
    const get = (code: number) => e.g.find((p) => p[0] === code)?.[1].trim();
    if (e.type === 'BLOCK') { cur = { name: get(2) ?? '', base: [parseFloat(get(10) ?? '0'), parseFloat(get(20) ?? '0')], ents: [] }; continue; }
    if (e.type === 'ENDBLK') { if (cur) blocks.set(cur.name, { base: cur.base, ents: cur.ents }); cur = null; continue; }
    cur?.ents.push(e);
  }
  const out: Geo2D = { lines: [], texts: [], tags: [] };
  const walk = (ents: DxfEnt[], xf: Xf, rot: number, scale: number, depth: number) => {
    for (let k = 0; k < ents.length; k++) {
      const e = ents[k];
      const num = (code: number, d = 0) => { const f = e.g.find((p) => p[0] === code); return f ? parseFloat(f[1]) : d; };
      const str = (code: number) => e.g.filter((p) => p[0] === code).map((p) => p[1]).join('');
      const all = (code: number) => e.g.filter((p) => p[0] === code).map((p) => parseFloat(p[1]));
      const P = (x: number, y: number) => xf([x, y]);
      switch (e.type) {
        case 'LINE': out.lines.push([P(num(10), num(20)), P(num(11), num(21))]); break;
        case 'CIRCLE': out.lines.push(arcPts(num(10), num(20), num(40), 0, 360).map(([x, y]) => P(x, y))); break;
        case 'ARC': out.lines.push(arcPts(num(10), num(20), num(40), num(50), num(51)).map(([x, y]) => P(x, y))); break;
        case 'LWPOLYLINE': {
          const xs = all(10), ys = all(20), bs: number[] = [];
          // abombamientos (42) por vértice, en el orden en que aparecen
          let vi = -1; for (const [c, v] of e.g) { if (c === 10) { vi++; bs[vi] = 0; } if (c === 42 && vi >= 0) bs[vi] = parseFloat(v); }
          out.lines.push(bulgePts(xs.map((x, j) => ({ x, y: ys[j], b: bs[j] ?? 0 })), (num(70) & 1) === 1).map(([x, y]) => P(x, y)));
          break;
        }
        case 'POLYLINE': {
          const vs: { x: number; y: number; b: number }[] = [];
          while (k + 1 < ents.length && ents[k + 1].type === 'VERTEX') {
            k++; const v = ents[k]; const g = (c: number) => parseFloat(v.g.find((p) => p[0] === c)?.[1] ?? '0');
            vs.push({ x: g(10), y: g(20), b: g(42) });
          }
          if (ents[k + 1]?.type === 'SEQEND') k++;
          if (vs.length > 1) out.lines.push(bulgePts(vs, (num(70) & 1) === 1).map(([x, y]) => P(x, y)));
          break;
        }
        case 'ELLIPSE': {
          const cx = num(10), cy = num(20), mx = num(11), my = num(21), ratio = num(40, 1), t0 = num(41), t1 = num(42, Math.PI * 2);
          const a = Math.hypot(mx, my), r0 = Math.atan2(my, mx), pts: P2[] = [];
          let sw = t1 - t0; while (sw <= 0) sw += Math.PI * 2;
          for (let j = 0; j <= 48; j++) { const t = t0 + (sw * j) / 48; const x = a * Math.cos(t), y = a * ratio * Math.sin(t); pts.push(P(cx + x * Math.cos(r0) - y * Math.sin(r0), cy + x * Math.sin(r0) + y * Math.cos(r0))); }
          out.lines.push(pts); break;
        }
        case 'SPLINE': { const xs = all(10), ys = all(20); if (xs.length > 1) out.lines.push(xs.map((x, j) => P(x, ys[j]))); break; }
        case 'SOLID': case 'TRACE': { const q = [P(num(10), num(20)), P(num(11), num(21)), P(num(13), num(23)), P(num(12), num(22))]; out.lines.push([...q, q[0]]); break; }
        case 'TEXT': case 'MTEXT': {
          const t = cleanMText(e.type === 'MTEXT' ? str(3) + str(1) : str(1));
          if (!t.trim()) break;
          const useAlign = e.type === 'TEXT' && (num(72) || num(73)) && e.g.some((p) => p[0] === 11);
          const [x, y] = useAlign ? P(num(11), num(21)) : P(num(10), num(20));
          out.texts.push({ x, y, h: num(40, 2.5) * scale, text: t, rot: num(50) + rot });
          break;
        }
        case 'ATTDEF': case 'ATTRIB': {
          const [x, y] = P(num(10), num(20));
          const tag = str(2).trim();
          if (tag) out.tags.push({ x, y, h: num(40, 2.5) * scale, tag, rot: num(50) + rot });
          break;
        }
        case 'INSERT': {
          const b = blocks.get(str(2).trim()); if (!b || depth > 8) break;
          const sx = num(41, 1), sy = num(42, 1), r = num(50);
          const inner = mkXf([0, 0], sx, sy, r, b.base);
          // composición: primero la del bloque y luego la exterior (sin escala exterior en la posición del texto)
          const comp: Xf = (p) => { const q = inner(p); return xf([q[0] + num(10), q[1] + num(20)]); };
          walk(b.ents.filter((x) => !(x.type === 'ATTDEF' && ents.slice(k + 1).some((y) => y.type === 'ATTRIB'))), comp, rot + r, scale * Math.abs(sx), depth + 1);
          // atributos que siguen al INSERT
          while (k + 1 < ents.length && (ents[k + 1].type === 'ATTRIB' || ents[k + 1].type === 'SEQEND')) { k++; if (ents[k].type === 'ATTRIB') walk([ents[k]], xf, rot, scale, depth + 1); }
          break;
        }
      }
    }
  };
  walk(sections.get('ENTITIES') ?? [], (p) => p, 0, 1, 0);
  out.unit = units === 1 ? 'in' : units === 5 ? 'cm' : units === 6 ? 'm' : 'mm';
  return out;
}

// ---------- DWG (LibreDWG) ----------
const DWG_VER: Record<string, string> = { AC1009: 'R12', AC1012: 'R13', AC1014: 'R14', AC1015: '2000' };
/** Lee el DWG en un proceso aparte (algunos DWG antiguos hacen fallar la biblioteca y no deben tumbar la página) */
export function dwgToGeo(buf: ArrayBuffer): Promise<Geo2D> {
  const ver = String.fromCharCode(...new Uint8Array(buf, 0, 6));
  if (!/^AC10(1[89]|2\d|3\d)/.test(ver)) return Promise.reject(new Error(`DWG ${DWG_VER[ver] ?? ver}: el lector solo admite DWG 2004 o posterior. Guárdalo como DWG 2004+ o como DXF.`));
  return new Promise((res, rej) => {
    const w = new Worker(new URL('../worker/dwg.worker.ts', import.meta.url), { type: 'module' });
    const t = setTimeout(() => { w.terminate(); rej(new Error('El DWG tarda demasiado en leerse')); }, 60000);
    w.onmessage = (e: MessageEvent<{ geo?: Geo2D; error?: string }>) => { clearTimeout(t); w.terminate(); if (e.data.geo) res(e.data.geo); else rej(new Error(e.data.error || 'No se pudo leer el DWG')); };
    w.onerror = () => { clearTimeout(t); w.terminate(); rej(new Error('No se pudo leer este DWG (versión R14/2000 no compatible con el lector). Guárdalo como DWG 2004 o posterior, o como DXF.')); };
    w.postMessage({ buf, base: new URL('./dwg', document.baseURI).href.replace(/\/$/, '') }, [buf]);
  });
}
/** Entidades de LibreDWG → geometría simple */
export function dwgDbToGeo(db: any): Geo2D {
  const blocks = new Map<string, { base: P2; ents: any[] }>();
  for (const b of db.tables?.BLOCK_RECORD?.entries ?? []) blocks.set(b.name, { base: [b.basePoint?.x ?? 0, b.basePoint?.y ?? 0], ents: b.entities ?? [] });
  const out: Geo2D = { lines: [], texts: [], tags: [] };
  const deg = (r: number) => (r * 180) / Math.PI;
  const walk = (ents: any[], xf: Xf, rot: number, scale: number, depth: number) => {
    for (const e of ents) {
      const P = (x: number, y: number) => xf([x, y]);
      switch (e.type) {
        case 'LINE': out.lines.push([P(e.startPoint.x, e.startPoint.y), P(e.endPoint.x, e.endPoint.y)]); break;
        case 'CIRCLE': out.lines.push(arcPts(e.center.x, e.center.y, e.radius, 0, 360).map(([x, y]) => P(x, y))); break;
        case 'ARC': out.lines.push(arcPts(e.center.x, e.center.y, e.radius, deg(e.startAngle), deg(e.endAngle)).map(([x, y]) => P(x, y))); break;
        case 'LWPOLYLINE': out.lines.push(bulgePts((e.vertices ?? []).map((v: any) => ({ x: v.x, y: v.y, b: v.bulge ?? 0 })), (e.flag & 1) === 1).map(([x, y]) => P(x, y))); break;
        case 'POLYLINE2D': case 'POLYLINE': case 'POLYLINE3D': out.lines.push(bulgePts((e.vertices ?? []).map((v: any) => ({ x: v.x, y: v.y, b: v.bulge ?? 0 })), (e.flag & 1) === 1).map(([x, y]) => P(x, y))); break;
        case 'ELLIPSE': {
          const a = Math.hypot(e.majorAxisEndPoint.x, e.majorAxisEndPoint.y), r0 = Math.atan2(e.majorAxisEndPoint.y, e.majorAxisEndPoint.x), pts: P2[] = [];
          let sw = (e.endAngle ?? Math.PI * 2) - (e.startAngle ?? 0); while (sw <= 0) sw += Math.PI * 2;
          for (let j = 0; j <= 48; j++) { const t = (e.startAngle ?? 0) + (sw * j) / 48; const x = a * Math.cos(t), y = a * (e.axisRatio ?? 1) * Math.sin(t); pts.push(P(e.center.x + x * Math.cos(r0) - y * Math.sin(r0), e.center.y + x * Math.sin(r0) + y * Math.cos(r0))); }
          out.lines.push(pts); break;
        }
        case 'TEXT': { if (!e.text?.trim()) break; const [x, y] = P(e.startPoint.x, e.startPoint.y); out.texts.push({ x, y, h: (e.textHeight ?? 2.5) * scale, text: cleanMText(e.text), rot: deg(e.rotation ?? 0) + rot }); break; }
        case 'MTEXT': { if (!e.text?.trim()) break; const [x, y] = P(e.insertionPoint.x, e.insertionPoint.y - (e.textHeight ?? 2.5)); out.texts.push({ x, y, h: (e.textHeight ?? 2.5) * scale, text: cleanMText(e.text), rot: deg(e.rotation ?? 0) + rot }); break; }
        case 'ATTDEF': case 'ATTRIB': { const sp = e.startPoint ?? e.insertionPoint; if (!sp || !e.tag) break; const [x, y] = P(sp.x, sp.y); out.tags.push({ x, y, h: (e.textHeight ?? 2.5) * scale, tag: e.tag, rot: deg(e.rotation ?? 0) + rot }); break; }
        case 'INSERT': {
          const b = blocks.get(e.name); if (!b || depth > 8) break;
          const inner = mkXf([0, 0], e.xScale ?? 1, e.yScale ?? 1, deg(e.rotation ?? 0), b.base);
          const comp: Xf = (p) => { const q = inner(p); return xf([q[0] + e.insertionPoint.x, q[1] + e.insertionPoint.y]); };
          const hasAttribs = (e.attribs ?? []).length > 0;
          walk(b.ents.filter((x: any) => !(hasAttribs && x.type === 'ATTDEF')), comp, rot + deg(e.rotation ?? 0), scale * Math.abs(e.xScale ?? 1), depth + 1);
          walk(e.attribs ?? [], xf, rot, scale, depth + 1);
          break;
        }
      }
    }
  };
  walk(db.entities ?? [], (p) => p, 0, 1, 0);
  out.unit = 'mm';
  return out;
}

// ---------- DGN V7 (MicroStation/IGDS) ----------
const i32 = (b: Uint8Array, o: number) => { const v = b[o + 2] + b[o + 3] * 256 + b[o + 1] * 65536 * 256 + b[o] * 65536; return v > 0x7fffffff ? v - 0x100000000 : v; };
const u16 = (b: Uint8Array, o: number) => b[o] + b[o + 1] * 256;
/** Doble VAX D-float (orden de palabras de DGN) → número */
function vaxDouble(b: Uint8Array, o: number): number {
  const d = [b[o + 1], b[o], b[o + 3], b[o + 2], b[o + 5], b[o + 4], b[o + 7], b[o + 6]];
  const hi = ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0, lo = ((d[4] << 24) | (d[5] << 16) | (d[6] << 8) | d[7]) >>> 0;
  const exp = (hi >>> 23) & 0xff; if (!exp) return 0;
  const m = (hi & 0x7fffff) * 4294967296 + lo;
  const v = (1 + m / 36028797018963968) * Math.pow(2, exp - 129);
  return hi >>> 31 ? -v : v;
}
export function dgnToGeo(buf: ArrayBuffer): Geo2D {
  const b = new Uint8Array(buf);
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) throw new Error('Es un DGN V8 (formato cerrado de MicroStation). Expórtalo a DXF o DWG para usarlo aquí.');
  const out: Geo2D = { lines: [], texts: [], tags: [] };
  let o = 0, is3d = false, scale = 1, ox = 0, oy = 0, sawTcb = false;
  const P = (x: number, y: number): P2 => [(x - ox) * scale, (y - oy) * scale];
  while (o + 4 <= b.length) {
    if (b[o] === 0xff && b[o + 1] === 0xff) break; // fin del fichero
    const type = b[o + 1] & 0x7f, deleted = (b[o + 1] & 0x80) !== 0, words = u16(b, o + 2), size = words * 2 + 4;
    if (size < 4 || o + size > b.length) break;
    const E = b.subarray(o, o + size);
    if (!deleted) {
      if (type === 9 && !sawTcb && size >= 1264) {
        // Bloque de control: unidades y origen global
        sawTcb = true;
        is3d = (E[1214] & 0x40) !== 0;
        const subPerMaster = i32(E, 1112), uorPerSub = i32(E, 1116);
        const name = String.fromCharCode(E[1120], E[1121]).trim().toLowerCase();
        const uorPerMaster = Math.abs(subPerMaster * uorPerSub) || 1;
        const toMm = name === 'm' ? 1000 : name === 'cm' ? 10 : name === 'in' || name === '"' ? 25.4 : name === 'ft' || name === "'" ? 304.8 : 1;
        scale = toMm / uorPerMaster;
        ox = vaxDouble(E, 1240); oy = vaxDouble(E, 1248);
        // el origen global está en UOR
      } else if (type === 3 && size >= 36 + (is3d ? 24 : 16)) {
        if (is3d) out.lines.push([P(i32(E, 36), i32(E, 40)), P(i32(E, 48), i32(E, 52))]);
        else out.lines.push([P(i32(E, 36), i32(E, 40)), P(i32(E, 44), i32(E, 48))]);
      } else if ((type === 4 || type === 6 || type === 11 || type === 12 || type === 14) && size >= 38) {
        const n = u16(E, 36), st = is3d ? 12 : 8, pts: P2[] = [];
        for (let k = 0; k < n && 38 + k * st + 8 <= size; k++) pts.push(P(i32(E, 38 + k * st), i32(E, 42 + k * st)));
        if (pts.length > 1) out.lines.push(pts);
      } else if ((type === 15 || type === 16) && size >= 36) {
        // Elipse / arco (2D): ejes y origen en dobles VAX
        let p = 36, a0 = 0, sw = 360;
        if (type === 16) { a0 = i32(E, p) / 360000; sw = i32(E, p + 4) / 360000; p += 8; if (sw === 0) sw = 360; }
        const ra = vaxDouble(E, p), rb = vaxDouble(E, p + 8);
        const rot = is3d ? 0 : i32(E, p + 16) / 360000;
        const cx = vaxDouble(E, is3d ? p + 32 : p + 20), cy = vaxDouble(E, is3d ? p + 40 : p + 28);
        const pts: P2[] = [], n = Math.max(8, Math.ceil(Math.abs(sw) / 6)), cr = Math.cos((rot * Math.PI) / 180), sr = Math.sin((rot * Math.PI) / 180);
        for (let k = 0; k <= n; k++) { const t = ((a0 + (sw * k) / n) * Math.PI) / 180; const x = ra * Math.cos(t), y = rb * Math.sin(t); pts.push(P(cx + x * cr - y * sr, cy + x * sr + y * cr)); }
        if (isFinite(ra) && ra > 0) out.lines.push(pts);
      } else if (type === 17 && size >= 60) {
        const hMult = i32(E, 42) * 6 / 1000, rot = is3d ? 0 : i32(E, 46) / 360000;
        const x = is3d ? i32(E, 62) : i32(E, 50), y = is3d ? i32(E, 66) : i32(E, 54);
        const nChars = is3d ? E[74] : E[58], t0 = is3d ? 76 : 60;
        let text = ''; for (let k = 0; k < nChars && t0 + k < size; k++) text += String.fromCharCode(E[t0 + k]);
        if (text.trim()) { const [px, py] = P(x, y); out.texts.push({ x: px, y: py, h: Math.abs(hMult * scale) || 2.5, text, rot }); }
      }
    }
    o += size;
  }
  if (!out.lines.length && !out.texts.length) throw new Error('No se encontraron elementos legibles en el DGN (¿formato V8?). Expórtalo a DXF o DWG.');
  out.unit = 'mm';
  return out;
}

/** Lleva la geometría a la esquina inferior izquierda (0, 0) y escala a mm. */
export function normalizeGeo(g: Geo2D, scale = 1): { geo: Geo2D; w: number; h: number } {
  const k = scale * (g.unit === 'm' ? 1000 : g.unit === 'cm' ? 10 : g.unit === 'in' ? 25.4 : 1);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of g.lines) for (const [x, y] of l) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (!isFinite(x0)) for (const t of [...g.texts, ...g.tags]) { x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x); y1 = Math.max(y1, t.y + t.h); }
  if (!isFinite(x0)) throw new Error('El dibujo está vacío');
  const T = ([x, y]: P2): P2 => [Math.round((x - x0) * k * 1000) / 1000, Math.round((y - y0) * k * 1000) / 1000];
  return {
    geo: {
      lines: g.lines.filter((l) => l.length > 1).map((l) => l.map(T)),
      texts: g.texts.map((t) => { const [x, y] = T([t.x, t.y]); return { ...t, x, y, h: t.h * k }; }),
      tags: g.tags.map((t) => { const [x, y] = T([t.x, t.y]); return { ...t, x, y, h: t.h * k }; }),
      unit: 'mm',
    },
    w: (x1 - x0) * k, h: (y1 - y0) * k,
  };
}

/** Campo del cajetín que corresponde a la etiqueta de un atributo (TITULO, DWG_NO, FECHA…) */
export function fieldForTag(tag: string): string {
  const t = tag.toUpperCase().replace(/[^A-Z0-9ÑÁÉÍÓÚ]/g, '');
  const rules: [RegExp, string][] = [
    [/^(TITULO|TITLE|DENOMINACION|DESCRIP)/, 'title'], [/(PLANO|DWGNO|DRAWINGNO|NUMERO|NUMBER|CODIGO|REFERENCIA|PARTNO)/, 'partNumber'],
    [/^(FECHA|DATE)$/, 'date'], [/(ESCALA|SCALE)/, 'scale'], [/(MATERIAL)/, 'material'], [/(DIBUJ|DRAWN|AUTOR|DISEN|DESIGN)/, 'designer'],
    [/(REVISADO|CHECK|COMPROB)/, 'checker'], [/(APROB|APPROV)/, 'approved'], [/^(REV|REVISION|EDICION)$/, 'revision'], [/(HOJA|SHEET)/, '#sheet'],
    [/(EMPRESA|COMPANY|CLIENTE|CLIENT)/, 'company'], [/(PROYECTO|PROJECT|OBRA)/, 'project'], [/(MASA|PESO|WEIGHT|MASS)/, 'mass'],
    [/(FORMATO|FORMAT|SIZE)/, '#format'], [/(TOLER)/, 'generalTol'], [/(ACABADO|FINISH)/, 'finish'],
  ];
  for (const [re, f] of rules) if (re.test(t)) return f;
  return `custom:${tag}`;
}
