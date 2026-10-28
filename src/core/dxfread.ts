// Lector DXF ASCII sencillo para el visor: LINE, LWPOLYLINE, POLYLINE/VERTEX, CIRCLE, ARC, ELLIPSE, SPLINE, TEXT, MTEXT.
export interface DxfView { svg: string; entities: number; layers: string[] }

export function readDxf(text: string): DxfView {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  const start = pairs.findIndex((p, i) => p[0] === 2 && p[1] === 'ENTITIES' && pairs[i - 1]?.[1] === 'SECTION');
  if (start < 0) throw new Error('El DXF no tiene sección ENTITIES');
  const polys: { pts: [number, number][]; layer: string; dashed: boolean }[] = [];
  const texts: { x: number; y: number; h: number; t: string; rot: number }[] = [];
  const layers = new Set<string>();
  let i = start + 1, count = 0;
  const arcPts = (cx: number, cy: number, r: number, a0: number, a1: number) => {
    let sw = a1 - a0; while (sw <= 0) sw += 360;
    const n = Math.max(8, Math.ceil(sw / 5)), out: [number, number][] = [];
    for (let k = 0; k <= n; k++) { const a = ((a0 + (sw * k) / n) * Math.PI) / 180; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return out;
  };
  while (i < pairs.length) {
    const [c, v] = pairs[i];
    if (c === 0 && v === 'ENDSEC') break;
    if (c !== 0) { i++; continue; }
    const type = v; i++;
    const g: [number, string][] = [];
    while (i < pairs.length && pairs[i][0] !== 0) g.push(pairs[i++]);
    const get = (code: number, d = 0) => { const f = g.find((p) => p[0] === code); return f ? parseFloat(f[1]) : d; };
    const all = (code: number) => g.filter((p) => p[0] === code).map((p) => parseFloat(p[1]));
    const layer = g.find((p) => p[0] === 8)?.[1] ?? '0';
    const ltype = (g.find((p) => p[0] === 6)?.[1] ?? '').toUpperCase();
    const dashed = /DASH|HIDDEN|CENTER|OCULT/.test(ltype) || /OCULT|HIDDEN/i.test(layer);
    layers.add(layer);
    count++;
    if (type === 'LINE') polys.push({ pts: [[get(10), get(20)], [get(11), get(21)]], layer, dashed });
    else if (type === 'CIRCLE') polys.push({ pts: arcPts(get(10), get(20), get(40), 0, 360), layer, dashed });
    else if (type === 'ARC') polys.push({ pts: arcPts(get(10), get(20), get(40), get(50), get(51)), layer, dashed });
    else if (type === 'LWPOLYLINE') {
      const xs = all(10), ys = all(20);
      const pts = xs.map((x, k) => [x, ys[k]] as [number, number]);
      if (get(70) & 1) pts.push(pts[0]);
      polys.push({ pts, layer, dashed });
    } else if (type === 'POLYLINE') {
      const pts: [number, number][] = [];
      const closed = (get(70) & 1) === 1;
      while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === 'SEQEND')) {
        if (pairs[i][0] === 0 && pairs[i][1] === 'VERTEX') {
          i++; let x = 0, y = 0;
          while (i < pairs.length && pairs[i][0] !== 0) { if (pairs[i][0] === 10) x = parseFloat(pairs[i][1]); if (pairs[i][0] === 20) y = parseFloat(pairs[i][1]); i++; }
          pts.push([x, y]);
        } else i++;
      }
      if (closed && pts.length) pts.push(pts[0]);
      polys.push({ pts, layer, dashed });
    } else if (type === 'SPLINE') {
      const xs = all(10), ys = all(20);
      if (xs.length > 1) polys.push({ pts: xs.map((x, k) => [x, ys[k]] as [number, number]), layer, dashed });
    } else if (type === 'ELLIPSE') {
      const cx = get(10), cy = get(20), mx = get(11), my = get(21), ratio = get(40, 1), t0 = get(41), t1 = get(42, Math.PI * 2);
      const a = Math.hypot(mx, my), rot = Math.atan2(my, mx), pts: [number, number][] = [];
      let sw = t1 - t0; while (sw <= 0) sw += Math.PI * 2;
      for (let k = 0; k <= 64; k++) { const t = t0 + (sw * k) / 64; const x = a * Math.cos(t), y = a * ratio * Math.sin(t); pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]); }
      polys.push({ pts, layer, dashed });
    } else if (type === 'TEXT' || type === 'MTEXT') {
      const t = g.filter((p) => p[0] === 1 || p[0] === 3).map((p) => p[1]).join('').replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '');
      texts.push({ x: get(10), y: get(20), h: get(40, 2.5), t, rot: get(50) });
    } else count--;
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p.pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  for (const t of texts) { x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x); y0 = Math.min(y0, t.y); y1 = Math.max(y1, t.y + t.h); }
  if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = 100; y1 = 100; }
  const W = x1 - x0 || 1, H = y1 - y0 || 1, pad = Math.max(W, H) * 0.03, sw = Math.max(W, H) / 1200;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = polys.map((p) => `<polyline fill="none" stroke="#111" stroke-width="${sw}"${p.dashed ? ` stroke-dasharray="${sw * 6} ${sw * 4}"` : ''} points="${p.pts.map(([x, y]) => `${x.toFixed(3)},${(-y).toFixed(3)}`).join(' ')}"/>`).join('')
    + texts.map((t) => `<text x="${t.x}" y="${-t.y}" font-size="${t.h}" font-family="Arial" fill="#111"${t.rot ? ` transform="rotate(${-t.rot} ${t.x} ${-t.y})"` : ''}>${esc(t.t)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0 - pad} ${-y1 - pad} ${W + pad * 2} ${H + pad * 2}" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
  return { svg, entities: count, layers: [...layers] };
}
