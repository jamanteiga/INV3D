// Conversión de trayectorias SVG (M, L, H, V, C, Q, A, Z — absolutas y relativas) a polilíneas.
export type P2 = [number, number];

export function flattenPath(d: string, tol = 0.05): P2[][] {
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: P2[][] = [];
  let cur: P2 = [0, 0], start: P2 = [0, 0], poly: P2[] = [];
  let i = 0, cmd = '';
  const num = () => parseFloat(toks[i++]);
  const push = () => { if (poly.length > 1) out.push(poly); poly = []; };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const pt = (): P2 => { const x = num(), y = num(); return rel ? [cur[0] + x, cur[1] + y] : [x, y]; };
    if (C === 'M') { push(); cur = pt(); start = cur; poly = [cur]; cmd = rel ? 'l' : 'L'; }
    else if (C === 'L') { cur = pt(); poly.push(cur); }
    else if (C === 'H') { const x = num(); cur = [rel ? cur[0] + x : x, cur[1]]; poly.push(cur); }
    else if (C === 'V') { const y = num(); cur = [cur[0], rel ? cur[1] + y : y]; poly.push(cur); }
    else if (C === 'C') {
      const p1 = pt(), p2 = pt(), p3 = pt(), p0 = cur;
      const n = Math.max(4, Math.min(64, Math.ceil(Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) / Math.max(tol * 20, 0.5))));
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        poly.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
      }
      cur = p3;
    } else if (C === 'Q') {
      const p1 = pt(), p2 = pt(), p0 = cur, n = 16;
      for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; poly.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]); }
      cur = p2;
    } else if (C === 'A') {
      const rx = Math.abs(num()), ry = Math.abs(num()), rot = (num() * Math.PI) / 180, large = num(), sweep = num();
      const end = pt();
      poly.push(...arcPoints(cur, end, rx, ry, rot, !!large, !!sweep, tol));
      cur = end;
    } else if (C === 'Z') { poly.push(start); cur = start; push(); cmd = ''; }
    else i++;
  }
  push();
  return out;
}

function arcPoints(p0: P2, p1: P2, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, tol: number): P2[] {
  if (rx < 1e-9 || ry < 1e-9) return [p1];
  const c = Math.cos(phi), s = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = c * dx + s * dy, y1 = -s * dx + c * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  let k = Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  if (large === sweep) k = -k;
  const cx1 = (k * rx * y1) / ry, cy1 = (-k * ry * x1) / rx;
  const cx = c * cx1 - s * cy1 + (p0[0] + p1[0]) / 2, cy = s * cx1 + c * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const r = Math.max(rx, ry);
  const n = Math.max(4, Math.min(180, Math.ceil(Math.abs(dt) / (2 * Math.acos(Math.max(-1, 1 - tol / r))))));
  const out: P2[] = [];
  for (let i = 1; i <= n; i++) {
    const t = t1 + (dt * i) / n;
    out.push([cx + c * rx * Math.cos(t) - s * ry * Math.sin(t), cy + s * rx * Math.cos(t) + c * ry * Math.sin(t)]);
  }
  return out;
}

export function bboxOf(polys: P2[][]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const q of p) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
  return isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, 0, 0];
}
