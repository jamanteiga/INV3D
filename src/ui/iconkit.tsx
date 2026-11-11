// Juegos de iconos propios en perspectiva isométrica (estilos 2, 3 y 4):
//  · Estilo 2: plano, sin degradados, trazo fino; cuerpo gris azulado, operación en azul, acentos naranja.
//  · Estilo 3: sombreado con degradados grises, operación en amarillo, bocetos en azul, sombra suave.
//  · Estilo 4: colores saturados y brillantes (protusión amarilla, vaciado rojo, superficie verde, boceto azul),
//    contorno negro marcado y reflejo especular.
import type { ReactNode } from 'react';

export type KitTheme = 'e2' | 'e3' | 'e4';
type Role = 'body' | 'feat' | 'cut' | 'surf' | 'plane' | 'p2' | 'p3' | 'paper';
type Face = 't' | 'l' | 'r' | 'f';
type C3 = [string, string]; // degradado: claro → oscuro

const PAL: Record<KitTheme, Record<Role, Record<Face, C3>>> = {
  e2: {
    body: { t: ['#e3eaf1', '#e3eaf1'], l: ['#bfcdda', '#bfcdda'], r: ['#9cb1c5', '#9cb1c5'], f: ['#cbd8e4', '#cbd8e4'] },
    feat: { t: ['#8fd3f5', '#8fd3f5'], l: ['#38aee6', '#38aee6'], r: ['#0b84c4', '#0b84c4'], f: ['#4cb7ea', '#4cb7ea'] },
    cut: { t: ['#5b6772', '#5b6772'], l: ['#46515b', '#46515b'], r: ['#3a434c', '#3a434c'], f: ['#55606b', '#55606b'] },
    surf: { t: ['#c3ecd0', '#c3ecd0'], l: ['#8fd4a5', '#8fd4a5'], r: ['#62bb7f', '#62bb7f'], f: ['#a2dcb4', '#a2dcb4'] },
    plane: { t: ['#ffe39a', '#ffe39a'], l: ['#ffd36a', '#ffd36a'], r: ['#f5c04a', '#f5c04a'], f: ['#ffe39a', '#ffe39a'] },
    p2: { t: ['#ffd48a', '#ffd48a'], l: ['#f7b54a', '#f7b54a'], r: ['#e3951f', '#e3951f'], f: ['#f9c066', '#f9c066'] },
    p3: { t: ['#cdbbea', '#cdbbea'], l: ['#ab93da', '#ab93da'], r: ['#8b70c4', '#8b70c4'], f: ['#b8a3e0', '#b8a3e0'] },
    paper: { t: ['#ffffff', '#ffffff'], l: ['#ffffff', '#ffffff'], r: ['#ffffff', '#ffffff'], f: ['#ffffff', '#ffffff'] },
  },
  e3: {
    body: { t: ['#fbfbfb', '#d8d8d8'], l: ['#d6d6d6', '#a4a4a4'], r: ['#acacac', '#737373'], f: ['#efefef', '#b9b9b9'] },
    feat: { t: ['#fff8cf', '#ffe04a'], l: ['#ffdc4d', '#e3aa00'], r: ['#e2a600', '#a87300'], f: ['#fff1a0', '#f2c200'] },
    cut: { t: ['#c7d3e2', '#8a9db5'], l: ['#8496ae', '#56677e'], r: ['#5a6b82', '#38465a'], f: ['#a8b8cb', '#6c7f97'] },
    surf: { t: ['#dff0ff', '#9ccaf2'], l: ['#a6cff3', '#5c9ad6'], r: ['#5f9bd6', '#2e68a8'], f: ['#cce4fa', '#7fb2e6'] },
    plane: { t: ['#e4f0fc', '#b8d5f3'], l: ['#cfe3f8', '#9cc2ea'], r: ['#b3d0ee', '#7fa9d8'], f: ['#e4f0fc', '#b3d0ee'] },
    p2: { t: ['#e2efff', '#9fc4ef'], l: ['#a5c8ef', '#5f91cf'], r: ['#6595cf', '#30609e'], f: ['#c9defa', '#80a9de'] },
    p3: { t: ['#e2f5df', '#a8d99e'], l: ['#acdba2', '#6bab5f'], r: ['#70ad63', '#3e7a33'], f: ['#cdebc6', '#8cc781'] },
    paper: { t: ['#ffffff', '#f2f2f2'], l: ['#ffffff', '#ececec'], r: ['#ffffff', '#e6e6e6'], f: ['#ffffff', '#ededed'] },
  },
  e4: {
    body: { t: ['#f6f9fd', '#c4d2e2'], l: ['#bccbdc', '#7f93ab'], r: ['#8799b0', '#4d6079'], f: ['#e6eef7', '#9fb2c8'] },
    feat: { t: ['#fffbd2', '#ffe12e'], l: ['#ffd51f', '#ec9800'], r: ['#e88f00', '#a35600'], f: ['#fff3a0', '#ffc400'] },
    cut: { t: ['#ffc2b6', '#ff5636'], l: ['#f5492b', '#c01f08'], r: ['#b81a06', '#760d01'], f: ['#ff8a72', '#e2300f'] },
    surf: { t: ['#e2ffd6', '#5fdb44'], l: ['#52c83a', '#2a8a1c'], r: ['#2f911f', '#165a0c'], f: ['#b4f59f', '#3cbf28'] },
    plane: { t: ['#ffe2a8', '#ffb43a'], l: ['#ffc76b', '#f29a00'], r: ['#f2a020', '#c06f00'], f: ['#ffd98c', '#ffaa22'] },
    p2: { t: ['#d6eeff', '#46a6f2'], l: ['#3d9ded', '#155fb3'], r: ['#1a64b8', '#0a3a75'], f: ['#9cd2fb', '#2f8be0'] },
    p3: { t: ['#e5ffd9', '#68d64f'], l: ['#5cc944', '#2a8a1c'], r: ['#2f911f', '#165a0c'], f: ['#b6f2a3', '#43c12d'] },
    paper: { t: ['#ffffff', '#f4f7fa'], l: ['#ffffff', '#eef2f6'], r: ['#ffffff', '#e7ecf2'], f: ['#ffffff', '#eef2f6'] },
  },
};

interface T {
  th: KitTheme;
  p: (r: Role, f: Face) => string;
  ink: string; w: number; sk: string; arrow: string; ok: string; red: string; text: string; gloss: boolean; dot: string;
}
const THEMES: Record<KitTheme, Omit<T, 'p' | 'th'>> = {
  e2: { ink: '#2f3b47', w: 0.85, sk: '#0696d7', arrow: '#f7941d', ok: '#3aa655', red: '#e2463a', text: 'var(--ico-ink)', gloss: false, dot: '#f7941d' },
  e3: { ink: '#4d4d4d', w: 0.8, sk: '#1d5fd2', arrow: '#d0101c', ok: '#2f9a3e', red: '#d0101c', text: 'var(--ico-ink)', gloss: false, dot: '#d0101c' },
  e4: { ink: '#121212', w: 1.05, sk: '#1d4fe0', arrow: '#1d4fe0', ok: '#16a316', red: '#e0200a', text: 'var(--ico-ink)', gloss: true, dot: '#ff2d00' },
};
const mk = (th: KitTheme): T => ({ th, ...THEMES[th], p: (r, f) => (th === 'e2' ? PAL[th][r][f][0] : `url(#k-${th}-${r}-${f})`) });

/** Degradados de los estilos (se insertan una vez en la página) */
export function KitDefs() {
  const out: ReactNode[] = [];
  for (const th of ['e3', 'e4'] as KitTheme[]) for (const [r, faces] of Object.entries(PAL[th])) for (const [f, [a, b]] of Object.entries(faces)) {
    out.push(<linearGradient key={`${th}${r}${f}`} id={`k-${th}-${r}-${f}`} x1="0" y1="0" x2={f === 't' ? '0.25' : '0'} y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient>);
  }
  out.push(<linearGradient key="gl" id="k-gloss" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".95" /><stop offset=".45" stopColor="#fff" stopOpacity=".35" /><stop offset=".55" stopColor="#fff" stopOpacity="0" /></linearGradient>);
  out.push(<radialGradient key="sp" id="k-sphere" cx=".35" cy=".3" r=".75"><stop offset="0" stopColor="#fff" /><stop offset=".25" stopColor="#ffe56a" /><stop offset="1" stopColor="#c46a00" /></radialGradient>);
  return <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable="false"><defs>{out}</defs></svg>;
}

// ---------- Primitivas ----------
type P2 = [number, number];
const pts = (a: P2[]) => a.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
const iso = (ox: number, oy: number, s = 1) => (x: number, y: number, z: number): P2 => [ox + (x - y) * 0.866 * s, oy + (x + y) * 0.5 * s - z * s];
type Iso = ReturnType<typeof iso>;

function Poly({ t, d, role, face }: { t: T; d: P2[]; role: Role; face: Face }) {
  return <>
    <polygon points={pts(d)} fill={t.p(role, face)} stroke={t.ink} strokeWidth={t.w} strokeLinejoin="round" />
    {t.gloss && face === 't' && <polygon points={pts(d)} fill="url(#k-gloss)" stroke="none" opacity=".75" />}
  </>;
}
/** Prisma isométrico (x hacia la derecha-abajo, y hacia la izquierda-abajo, z arriba) */
function Box({ t, P, x = 0, y = 0, z = 0, a, b, h, role = 'body', top }: { t: T; P: Iso; x?: number; y?: number; z?: number; a: number; b: number; h: number; role?: Role; top?: Role }) {
  return <>
    <Poly t={t} role={role} face="l" d={[P(x, y + b, z), P(x + a, y + b, z), P(x + a, y + b, z + h), P(x, y + b, z + h)]} />
    <Poly t={t} role={role} face="r" d={[P(x + a, y, z), P(x + a, y + b, z), P(x + a, y + b, z + h), P(x + a, y, z + h)]} />
    <Poly t={t} role={top ?? role} face="t" d={[P(x, y, z + h), P(x + a, y, z + h), P(x + a, y + b, z + h), P(x, y + b, z + h)]} />
  </>;
}
/** Cilindro vertical en pantalla (eje vertical): centro de la base, radios de la elipse y altura */
function Cyl({ t, cx, cy, rx, ry, h, role = 'feat', hole }: { t: T; cx: number; cy: number; rx: number; ry: number; h: number; role?: Role; hole?: number }) {
  const side = `M${cx - rx},${cy - h} L${cx - rx},${cy} A${rx},${ry} 0 0 0 ${cx + rx},${cy} L${cx + rx},${cy - h} Z`;
  return <>
    <path d={side} fill={t.p(role, 'r')} stroke={t.ink} strokeWidth={t.w} />
    <path d={`M${cx - rx},${cy - h} L${cx - rx},${cy} A${rx},${ry} 0 0 0 ${cx},${cy + ry} L${cx},${cy + ry - h} Z`} fill={t.p(role, 'l')} stroke="none" opacity=".9" />
    <ellipse cx={cx} cy={cy - h} rx={rx} ry={ry} fill={t.p(role, 't')} stroke={t.ink} strokeWidth={t.w} />
    {t.gloss && <ellipse cx={cx - rx * 0.25} cy={cy - h - ry * 0.25} rx={rx * 0.6} ry={ry * 0.5} fill="#fff" opacity=".55" />}
    {t.gloss && <rect x={cx - rx * 0.7} y={cy - h + 1} width={rx * 0.28} height={Math.max(0, h - 1)} fill="#fff" opacity=".45" rx=".5" />}
    {hole ? <ellipse cx={cx} cy={cy - h} rx={rx * hole} ry={ry * hole} fill={t.p('cut', 'r')} stroke={t.ink} strokeWidth={t.w} /> : null}
  </>;
}
function Arrow({ t, d, color, w = 1.8, head = [] as P2[] }: { t: T; d: string; color?: string; w?: number; head?: P2[] }) {
  const c = color ?? t.arrow;
  return <>
    <path d={d} fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    {head.length > 0 && <polygon points={pts(head)} fill={c} stroke={t.th === 'e4' ? t.ink : c} strokeWidth={t.th === 'e4' ? 0.6 : 0.4} strokeLinejoin="round" />}
  </>;
}
const head = (tip: P2, dir: P2, L = 4, W = 2.6): P2[] => {
  const l = Math.hypot(dir[0], dir[1]) || 1, u: P2 = [dir[0] / l, dir[1] / l], n: P2 = [-u[1], u[0]];
  const b: P2 = [tip[0] - u[0] * L, tip[1] - u[1] * L];
  return [tip, [b[0] + n[0] * W, b[1] + n[1] * W], [b[0] - n[0] * W, b[1] - n[1] * W]];
};
const Dot = ({ t, x, y, r = 1.5 }: { t: T; x: number; y: number; r?: number }) => <rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill={t.dot} stroke={t.th === 'e4' ? t.ink : 'none'} strokeWidth=".5" rx={t.th === 'e2' ? r : 0.3} />;
const Sk = ({ t, d, w = 1.5, dash }: { t: T; d: string; w?: number; dash?: string }) => <path d={d} fill="none" stroke={t.sk} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} />;
const Badge = ({ t, kind, x = 24, y = 24 }: { t: T; kind: 'plus' | 'check' | 'star'; x?: number; y?: number }) => (
  <g>
    <circle cx={x} cy={y} r="5.3" fill={kind === 'check' ? t.ok : kind === 'plus' ? t.ok : '#f5b400'} stroke={t.th === 'e2' ? '#fff' : t.ink} strokeWidth={t.th === 'e2' ? 1.2 : 0.8} />
    {t.gloss && <ellipse cx={x - 1.3} cy={y - 2} rx="3" ry="1.8" fill="#fff" opacity=".55" />}
    {kind === 'plus' && <path d={`M${x - 2.8},${y}h5.6M${x},${y - 2.8}v5.6`} stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />}
    {kind === 'check' && <path d={`M${x - 2.7},${y + 0.2}l1.9,2l3.6,-4`} stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
    {kind === 'star' && <path d={`M${x},${y - 3}l.9,2h2.1l-1.7,1.3.7,2.1-2-1.3-2,1.3.7-2.1-1.7-1.3h2.1z`} fill="#fff" />}
  </g>
);
/** Plano de trabajo en perspectiva */
const Plane = ({ t, P, z = 0, s = 1, role = 'plane' as Role }: { t: T; P: Iso; z?: number; s?: number; role?: Role }) => (
  <polygon points={pts([P(-2 * s, -2 * s, z), P(14 * s, -2 * s, z), P(14 * s, 14 * s, z), P(-2 * s, 14 * s, z)])} fill={t.p(role, 'f')} fillOpacity={t.th === 'e2' ? 0.85 : 0.8} stroke={t.th === 'e4' ? t.ink : t.th === 'e2' ? '#d99a00' : '#4a86c8'} strokeWidth={t.w} strokeLinejoin="round" />
);
const Sheet = ({ t, x = 4, y = 3, w = 24, h = 26, fold = true }: { t: T; x?: number; y?: number; w?: number; h?: number; fold?: boolean }) => (
  <>
    <path d={`M${x},${y}h${w - (fold ? 6 : 0)}l${fold ? 6 : 0},${fold ? 6 : 0}v${h - (fold ? 6 : 0)}h${-w}z`} fill={t.p('paper', 'f')} stroke={t.ink} strokeWidth={t.w} strokeLinejoin="round" />
    {fold && <path d={`M${x + w - 6},${y}v6h6`} fill={t.p('body', 'l')} stroke={t.ink} strokeWidth={t.w} strokeLinejoin="round" />}
  </>
);

// ---------- Iconos ----------
type Draw = (t: T) => ReactNode;
const P0 = iso(16, 16);
export const KIT: Record<string, Draw> = {
  part: (t) => <Box t={t} P={iso(16, 15)} a={12} b={12} h={10} />,
  assembly: (t) => { const P = iso(16, 13, 0.82); return <><Box t={t} P={P} x={0} y={0} a={14} b={14} h={5} /><Box t={t} P={P} x={2} y={2} z={5} a={6} b={6} h={9} role="p2" /><Box t={t} P={P} x={9} y={8} z={5} a={4} b={5} h={5} role="p3" /></>; },
  newpart: (t) => <><Box t={t} P={iso(14, 14, 0.85)} a={12} b={12} h={10} /><Badge t={t} kind="plus" /></>,
  drawing: (t) => <><Sheet t={t} fold={false} x={3} y={5} w={26} h={22} /><Box t={t} P={iso(12, 15, 0.45)} a={10} b={10} h={8} role="feat" /><path d="M18 21h10M18 24h10M22 21v6" stroke={t.ink} strokeWidth={t.w} fill="none" /><rect x="18" y="18" width="10" height="9" fill="none" stroke={t.ink} strokeWidth={t.w} /></>,
  sketch: (t) => { const P = iso(15, 18); return <><Plane t={t} P={P} /><Sk t={t} d={`M${pts([P(1, 1, 0), P(10, 1, 0), P(10, 10, 0), P(1, 10, 0), P(1, 1, 0)]).replace(/ /g, ' L')}`} w={1.6} />{[P(1, 1, 0), P(10, 1, 0), P(10, 10, 0), P(1, 10, 0)].map((q, i) => <Dot key={i} t={t} x={q[0]} y={q[1]} r={1.2} />)}<path d="M21 4l6 6-11 11-6.5 1 1-6.5z" fill={t.th === 'e4' ? '#ffd21f' : t.th === 'e3' ? '#f2c200' : '#fdb515'} stroke={t.ink} strokeWidth={t.w} strokeLinejoin="round" /><path d="M10.5 15.5l6 6M21 4l6 6" stroke={t.ink} strokeWidth={t.w} /></>; },
  sketch3d: (t) => { const P = iso(13, 21); return <><path d={`M${P(0, 0, 0)}L${P(14, 0, 0)}M${P(0, 0, 0)}L${P(0, 14, 0)}M${P(0, 0, 0)}L${P(0, 0, 16)}`} stroke={t.ink} strokeWidth={t.w} fill="none" /><Sk t={t} d="M6 24C8 12 14 22 18 12S26 6 28 4" w={2} /><Dot t={t} x={6} y={24} /><Dot t={t} x={18} y={12} /><Dot t={t} x={28} y={4} /></>; },
  finish: (t) => { const P = iso(14, 18, 0.85); return <><Plane t={t} P={P} /><Sk t={t} d={`M${P(2, 2, 0)}L${P(10, 2, 0)}L${P(10, 10, 0)}L${P(2, 10, 0)}Z`} /><Badge t={t} kind="check" x={23} y={22} /></>; },
  extrude: (t) => { const P = iso(15, 17); return <><Sk t={t} d={`M${P(0, 0, 0)}L${P(12, 0, 0)}L${P(12, 10, 0)}L${P(0, 10, 0)}Z`} w={1.6} dash="2 1.5" /><Box t={t} P={P} a={12} b={10} h={9} role="feat" /><Arrow t={t} d={`M${P(12, 5, 9)[0] + 5},${P(12, 5, 9)[1] - 1}v-8`} head={head([P(12, 5, 9)[0] + 5, P(12, 5, 9)[1] - 12], [0, -1])} /></>; },
  revolve: (t) => <><path d="M16 2v28" stroke={t.ink} strokeWidth={t.w} strokeDasharray="3 1.5 1 1.5" /><Cyl t={t} cx={16} cy={24} rx={11} ry={4} h={14} role="feat" hole={0.42} /><Arrow t={t} d="M6 7a10 3.4 0 0 1 18-1.5" head={head([26.6, 6.6], [1, 0.6])} /></>,
  loft: (t) => <><path d="M5 24 L16 29 L27 24 L16 19 Z" fill={t.p('feat', 'r')} stroke={t.ink} strokeWidth={t.w} /><path d="M5 24 L11 8 A5 2 0 0 1 21 8 L27 24 L16 29 Z" fill={t.p('feat', 'l')} stroke={t.ink} strokeWidth={t.w} strokeLinejoin="round" /><path d="M16 29 L21 8 L27 24 Z" fill={t.p('feat', 'r')} stroke={t.ink} strokeWidth={t.w} strokeLinejoin="round" /><ellipse cx="16" cy="8" rx="5" ry="2" fill={t.p('feat', 't')} stroke={t.ink} strokeWidth={t.w} />{t.gloss && <path d="M9 22 L13 10" stroke="#fff" strokeWidth="1.6" opacity=".6" />}<Sk t={t} d="M5 24 L16 19 L27 24" w={1.4} dash="2 1.2" /></>,
  sweep: (t) => <><Sk t={t} d="M4 26C6 14 16 22 20 12S26 6 28 5" w={1.2} dash="2 1.5" /><path d="M4 26C6 14 16 22 20 12S26 6 28 5" fill="none" stroke={t.ink} strokeWidth="7.6" strokeLinecap="round" /><path d="M4 26C6 14 16 22 20 12S26 6 28 5" fill="none" stroke={t.th === 'e2' ? PAL.e2.feat.r[0] : t.p('feat', 'r').startsWith('url') ? (t.th === 'e4' ? '#f0a000' : '#e6b000') : '#0b84c4'} strokeWidth="6" strokeLinecap="round" /><path d="M4 26C6 14 16 22 20 12S26 6 28 5" fill="none" stroke={t.th === 'e2' ? PAL.e2.feat.t[0] : t.th === 'e4' ? '#fff27a' : '#fff1a0'} strokeWidth="2.4" strokeLinecap="round" opacity={t.gloss ? 1 : 0.85} /><ellipse cx="28" cy="5" rx="3" ry="3" fill={t.p('feat', 't')} stroke={t.ink} strokeWidth={t.w} /></>,
  rib: (t) => { const P = iso(16, 16, 0.9); return <><Box t={t} P={P} a={14} b={4} h={3} /><Box t={t} P={P} x={0} y={0} z={3} a={3} b={4} h={12} /><polygon points={pts([P(3, 2.8, 3), P(13, 2.8, 3), P(3, 2.8, 14)])} fill={t.p('feat', 'l')} stroke={t.ink} strokeWidth={t.w} strokeLinejoin="round" /></>; },
  coil: (t) => { const segs: ReactNode[] = []; for (let i = 0; i < 5; i++) { const y = 6 + i * 4.6; segs.push(<path key={i} d={`M7 ${y}C7 ${y + 3} 25 ${y + 1} 25 ${y + 2.3}`} fill="none" stroke={t.ink} strokeWidth="4.2" strokeLinecap="round" />, <path key={'c' + i} d={`M7 ${y}C7 ${y + 3} 25 ${y + 1} 25 ${y + 2.3}`} fill="none" stroke={t.th === 'e2' ? '#38aee6' : t.th === 'e4' ? '#f0a000' : '#e6b000'} strokeWidth="2.8" strokeLinecap="round" />, <path key={'h' + i} d={`M8 ${y + 0.6}C10 ${y + 2} 20 ${y + 1} 24 ${y + 1.8}`} fill="none" stroke="#fff" strokeWidth=".9" opacity={t.gloss ? 0.9 : 0.5} />); } return <><path d="M16 3v26" stroke={t.ink} strokeWidth={t.w} strokeDasharray="3 1.5 1 1.5" />{segs}</>; },
  hole: (t) => { const P = iso(16, 16); return <><Box t={t} P={P} a={13} b={13} h={8} /><ellipse cx={P(6.5, 6.5, 8)[0]} cy={P(6.5, 6.5, 8)[1]} rx="5.4" ry="2.9" fill={t.p('cut', 'r')} stroke={t.ink} strokeWidth={t.w} /><path d={`M${P(6.5, 6.5, 8)[0] - 5.4},${P(6.5, 6.5, 8)[1]} a5.4 2.9 0 0 1 10.8 0`} fill={t.p('cut', 'l')} stroke="none" /><Arrow t={t} d={`M${P(6.5, 6.5, 8)[0]},1v7`} head={head([P(6.5, 6.5, 8)[0], P(6.5, 6.5, 8)[1] - 1.5], [0, 1], 3.5, 2.4)} color={t.th === 'e4' ? t.red : t.arrow} /></>; },
  fillet: (t) => { const P = iso(16, 16); const arc = (x: number) => [0, 1, 2, 3, 4, 5, 6].map((k) => { const an = (k / 6) * Math.PI / 2; return P(x, 9 + 4 * Math.sin(an), 5 + 4 * Math.cos(an)); }); const A0 = arc(0), A1 = arc(13); return <>
    <Poly t={t} role="body" face="l" d={[P(0, 13, 0), P(13, 13, 0), P(13, 13, 5), P(0, 13, 5)]} />
    <Poly t={t} role="body" face="r" d={[P(13, 0, 0), P(13, 13, 0), ...[...A1].reverse(), P(13, 0, 9)]} />
    <Poly t={t} role="body" face="t" d={[P(0, 0, 9), P(13, 0, 9), P(13, 9, 9), P(0, 9, 9)]} />
    <Poly t={t} role="feat" face="t" d={[...A0, ...[...A1].reverse()]} />
  </>; },
  chamfer: (t) => { const P = iso(16, 16); return <>
    <Poly t={t} role="body" face="l" d={[P(0, 13, 0), P(13, 13, 0), P(13, 13, 5), P(0, 13, 5)]} />
    <Poly t={t} role="body" face="r" d={[P(13, 0, 0), P(13, 13, 0), P(13, 13, 5), P(13, 9, 9), P(13, 0, 9)]} />
    <Poly t={t} role="body" face="t" d={[P(0, 0, 9), P(13, 0, 9), P(13, 9, 9), P(0, 9, 9)]} />
    <Poly t={t} role="feat" face="t" d={[P(0, 9, 9), P(13, 9, 9), P(13, 13, 5), P(0, 13, 5)]} />
  </>; },
  shell: (t) => { const P = iso(16, 16); return <><Box t={t} P={P} a={13} b={13} h={9} top="feat" /><polygon points={pts([P(2, 2, 9), P(11, 2, 9), P(11, 11, 9), P(2, 11, 9)])} fill={t.p('cut', 't')} stroke={t.ink} strokeWidth={t.w} strokeLinejoin="round" /><polygon points={pts([P(2, 2, 9), P(11, 2, 9), P(11, 2, 3), P(2, 2, 3)])} fill={t.p('cut', 'l')} stroke={t.ink} strokeWidth={t.w * 0.7} /><polygon points={pts([P(2, 2, 9), P(2, 11, 9), P(2, 11, 3), P(2, 2, 3)])} fill={t.p('cut', 'r')} stroke={t.ink} strokeWidth={t.w * 0.7} /></>; },
  draft: (t) => { const P = iso(16, 17); return <><polygon points={pts([P(0, 13, 0), P(13, 13, 0), P(10, 10, 10), P(3, 10, 10)])} fill={t.p('feat', 'l')} stroke={t.ink} strokeWidth={t.w} strokeLinejoin="round" /><polygon points={pts([P(13, 0, 0), P(13, 13, 0), P(10, 10, 10), P(10, 3, 10)])} fill={t.p('body', 'r')} stroke={t.ink} strokeWidth={t.w} strokeLinejoin="round" /><Poly t={t} role="body" face="t" d={[P(3, 3, 10), P(10, 3, 10), P(10, 10, 10), P(3, 10, 10)]} /><path d="M5 27l3-15" stroke={t.arrow} strokeWidth="1.3" strokeDasharray="2 1" /><path d="M5 27v-15" stroke={t.ink} strokeWidth={t.w} strokeDasharray="2 1" /><path d="M5 17a4 4 0 0 1 1.6-.4" stroke={t.arrow} strokeWidth="1.2" fill="none" /></>; },
  thread: (t) => <><Cyl t={t} cx={16} cy={26} rx={8} ry={3} h={20} role="body" />{[0, 1, 2, 3, 4].map((i) => <path key={i} d={`M8 ${10 + i * 3.6}Q16 ${14.5 + i * 3.6} 24 ${8.5 + i * 3.6}`} fill="none" stroke={t.th === 'e2' ? '#0b84c4' : t.th === 'e4' ? '#e88f00' : '#d39b00'} strokeWidth="1.5" />)}</>,
  split: (t) => { const P = iso(16, 16); return <><Box t={t} P={P} a={13} b={6} h={9} /><Box t={t} P={P} y={7.5} a={13} b={5.5} h={9} role="feat" /><polygon points={pts([P(-2, 6.8, -2), P(15, 6.8, -2), P(15, 6.8, 12), P(-2, 6.8, 12)])} fill={t.p('plane', 'f')} fillOpacity=".55" stroke={t.th === 'e4' ? t.ink : '#d99a00'} strokeWidth={t.w} /></>; },
  combine: (t) => { const P = iso(16, 17, 0.9); return <><Box t={t} P={P} a={12} b={12} h={7} /><Box t={t} P={P} x={5} y={5} z={4} a={9} b={9} h={8} role="feat" /></>; },
  mirror: (t) => <><Box t={t} P={iso(8.5, 18, 0.6)} a={9} b={9} h={10} /><path d="M16 2v28" stroke={t.th === 'e4' ? '#f29a00' : t.th === 'e2' ? '#d99a00' : '#4a86c8'} strokeWidth="1.6" strokeDasharray="3 1.5 1 1.5" /><Box t={t} P={iso(23.5, 18, 0.6)} a={9} b={9} h={10} role="feat" /><Arrow t={t} d="M10 4.5q6 -3 12 0" w={1.4} head={head([23, 5], [1, 0.5], 3, 2)} /></>,
  prect: (t) => { const P = iso(16, 16); return <><Box t={t} P={P} a={14} b={14} h={3} />{[[3.5, 3.5], [10.5, 3.5], [3.5, 10.5], [10.5, 10.5]].map(([x, y], i) => { const q = P(x, y, 3); return <Cyl key={i} t={t} cx={q[0]} cy={q[1]} rx={2.6} ry={1.4} h={5} role={i === 0 ? 'body' : 'feat'} />; })}</>; },
  pcirc: (t) => <><ellipse cx="16" cy="18" rx="13" ry="7" fill={t.p('body', 't')} stroke={t.ink} strokeWidth={t.w} />{[0, 1, 2, 3, 4, 5].map((i) => { const a = (i / 6) * Math.PI * 2 + 0.5; return { x: 16 + 9 * Math.cos(a), y: 18 + 4.6 * Math.sin(a), i }; }).sort((a, b) => a.y - b.y).map(({ x, y, i }) => <Cyl key={i} t={t} cx={x} cy={y} rx={2.3} ry={1.2} h={4.5} role={i === 0 ? 'body' : 'feat'} />)}</>,
  workplane: (t) => { const P = iso(15, 17); return <><Plane t={t} P={P} s={1.05} />{t.gloss && <polygon points={pts([P(-1, -1, 0), P(13, -1, 0), P(13, 4, 0), P(-1, 4, 0)])} fill="#fff" opacity=".35" />}<path d={`M${P(6, 6, 0)[0]} ${P(6, 6, 0)[1]}v-12`} stroke={t.sk} strokeWidth="1.6" /><polygon points={pts(head([P(6, 6, 0)[0], P(6, 6, 0)[1] - 14], [0, -1], 3.5, 2.2))} fill={t.sk} /></>; },
  workaxis: (t) => <><path d="M5 27L27 5" stroke={t.ink} strokeWidth="3.4" strokeLinecap="round" /><path d="M5 27L27 5" stroke={t.th === 'e4' ? '#f29a00' : t.th === 'e2' ? '#fdb515' : '#4a86c8'} strokeWidth="2" strokeLinecap="round" strokeDasharray="5 2 1.5 2" /><circle cx="16" cy="16" r="2.4" fill={t.dot} stroke={t.ink} strokeWidth={t.w} /></>,
  workpoint: (t) => <><path d="M16 4v24M4 16h24" stroke={t.ink} strokeWidth={t.w} strokeDasharray="2 1.5" /><circle cx="16" cy="16" r="5.5" fill={t.th === 'e4' ? 'url(#k-sphere)' : t.th === 'e2' ? '#fdb515' : t.p('feat', 't')} stroke={t.ink} strokeWidth={t.w} />{!t.gloss && <circle cx="14.4" cy="14.2" r="1.6" fill="#fff" opacity=".7" />}</>,
  line: (t) => <><Sk t={t} d="M6 25L26 7" w={2} /><Dot t={t} x={6} y={25} r={2} /><Dot t={t} x={26} y={7} r={2} /></>,
  rect: (t) => <><Sk t={t} d="M5 9h22v15H5z" w={2} /><Dot t={t} x={5} y={24} r={2} /><Dot t={t} x={27} y={9} r={2} /></>,
  circle: (t) => <><Sk t={t} d="M26 16a10 10 0 1 1 -20 0a10 10 0 1 1 20 0" w={2} /><Dot t={t} x={16} y={16} r={1.8} /><path d="M16 16l7-7" stroke={t.ink} strokeWidth={t.w} strokeDasharray="1.6 1.2" /><Dot t={t} x={23} y={9} r={1.6} /></>,
  arc: (t) => <><Sk t={t} d="M5 24A12 12 0 0 1 27 20" w={2} /><Dot t={t} x={5} y={24} r={2} /><Dot t={t} x={27} y={20} r={2} /><Dot t={t} x={15} y={11.5} r={1.6} /></>,
  dim: (t) => <><path d="M5 26V12M27 26V12" stroke={t.ink} strokeWidth={t.w} /><Arrow t={t} d="M7 18h18" color={t.th === 'e3' ? '#1d5fd2' : t.ink} w={1.2} head={head([5.2, 18], [-1, 0], 3.2, 1.6)} /><polygon points={pts(head([26.8, 18], [1, 0], 3.2, 1.6))} fill={t.th === 'e3' ? '#1d5fd2' : t.ink} /><rect x="9.5" y="7" width="13" height="8" rx={t.th === 'e2' ? 1 : 0} fill={t.th === 'e4' ? '#fff8c0' : '#fff'} stroke={t.th === 'e2' ? '#0696d7' : t.ink} strokeWidth={t.w} /><text x="16" y="13.4" fontSize="6.4" textAnchor="middle" fontWeight="700" fill={t.th === 'e2' ? '#0b6ea8' : '#222'} fontFamily="Arial, sans-serif">25</text></>,
  trimtool: (t) => <><Sk t={t} d="M4 26L28 6" w={1.8} /><Sk t={t} d="M4 9L16 17" w={1.8} /><path d="M16 17L28 25" stroke={t.red} strokeWidth="1.8" strokeDasharray="2.2 1.6" /><path d="M21 18l5 5M26 18l-5 5" stroke={t.red} strokeWidth="2" strokeLinecap="round" /></>,
  offset2d: (t) => <><Sk t={t} d="M4 22C10 22 10 10 16 10S22 22 28 22" w={1.8} /><path d="M4 27C12 27 12 15 16 15S20 27 28 27" fill="none" stroke={t.arrow} strokeWidth="1.6" strokeDasharray="2.6 1.6" /><Arrow t={t} d="M16 10v2.5" w={1.3} head={head([16, 14.6], [0, 1], 2.6, 1.8)} /></>,
  measure: (t) => <><g transform="rotate(-35 16 16)"><rect x="2" y="12" width="28" height="9" rx="1" fill={t.p('p2', 'f')} stroke={t.ink} strokeWidth={t.w} />{t.gloss && <rect x="3" y="13" width="26" height="3" fill="#fff" opacity=".55" />}{Array.from({ length: 12 }, (_, i) => <path key={i} d={`M${4.5 + i * 2.2} 12v${i % 2 ? 2.5 : 4}`} stroke={t.ink} strokeWidth=".8" />)}</g></>,
  mass: (t) => <><path d="M8 13h16l4 15H4z" fill={t.p('body', 'f')} stroke={t.ink} strokeWidth={t.w} strokeLinejoin="round" />{t.gloss && <path d="M9 15h7l-1.5 9H6z" fill="#fff" opacity=".5" />}<circle cx="16" cy="8.5" r="3.6" fill="none" stroke={t.ink} strokeWidth="1.6" /><text x="16" y="24.5" fontSize="7" textAnchor="middle" fontWeight="700" fill={t.th === 'e4' ? '#123' : '#333'} fontFamily="Arial, sans-serif">kg</text></>,
  iprops: (t) => <><Sheet t={t} x={5} y={3} w={20} h={25} /><path d="M9 12h12M9 16h12M9 20h7" stroke={t.ink} strokeWidth={t.w} /><circle cx="23" cy="23" r="5.4" fill={t.th === 'e2' ? '#0696d7' : t.th === 'e4' ? '#1d4fe0' : '#1d5fd2'} stroke={t.th === 'e2' ? '#fff' : t.ink} strokeWidth={t.th === 'e2' ? 1.2 : 0.8} />{t.gloss && <ellipse cx="21.8" cy="21" rx="3" ry="1.7" fill="#fff" opacity=".5" />}<text x="23" y="26" fontSize="7.5" textAnchor="middle" fontWeight="700" fill="#fff" fontFamily="Georgia, serif">i</text></>,
  params: (t) => <><rect x="3" y="5" width="26" height="22" rx={t.th === 'e2' ? 2 : 1} fill={t.p('paper', 'f')} stroke={t.ink} strokeWidth={t.w} /><rect x="3" y="5" width="26" height="6" rx={t.th === 'e2' ? 2 : 1} fill={t.p('feat', 'f')} stroke={t.ink} strokeWidth={t.w} /><text x="9" y="23" fontSize="11" fontStyle="italic" fontFamily="Georgia, serif" fill={t.sk} fontWeight="700">fx</text><path d="M19 16h7M19 20h7M19 24h5" stroke={t.ink} strokeWidth={t.w} /></>,
  place: (t) => <><Box t={t} P={iso(18, 18, 0.8)} a={12} b={12} h={10} role="p2" /><Arrow t={t} d="M3 4l7 7" w={2.2} head={head([12.5, 13.5], [1, 1], 4, 2.6)} /></>,
  joint: (t) => { const P = iso(16, 17, 0.85); return <><Box t={t} P={P} a={14} b={14} h={5} /><Box t={t} P={P} x={3} y={3} z={9} a={8} b={8} h={6} role="p2" /><polygon points={pts([P(3, 3, 5), P(11, 3, 5), P(11, 11, 5), P(3, 11, 5)])} fill={t.p('feat', 't')} stroke={t.ink} strokeWidth={t.w} /><Arrow t={t} d={`M${P(7, 7, 9)[0]},${P(7, 7, 9)[1]}v1.6`} w={1.4} head={head([P(7, 7, 5)[0], P(7, 7, 5)[1] - 0.6], [0, 1], 2.6, 1.8)} /></>; },
  constraint3d: (t) => KIT.joint(t),
  move: (t) => <><Box t={t} P={iso(16, 17, 0.6)} a={10} b={10} h={8} role="p2" />{([[16, 2, 0, -1], [16, 30, 0, 1], [2, 16, -1, 0], [30, 16, 1, 0]] as const).map(([x, y, dx, dy], i) => <Arrow key={i} t={t} d={`M${16 + dx * 8},${16 + dy * 8}L${x - dx * 3},${y - dy * 3}`} w={1.6} head={head([x, y], [dx, dy], 3.4, 2.2)} />)}</>,
  ground: (t) => <><Box t={t} P={iso(16, 15, 0.8)} a={12} b={12} h={9} /><path d="M16 21v5M9 27h14M11 29.5h10" stroke={t.ink} strokeWidth="1.4" /><circle cx="16" cy="19" r="2.8" fill={t.red} stroke={t.ink} strokeWidth={t.w} /></>,
  explode: (t) => { const P = iso(16, 16, 0.7); return <><Box t={t} P={P} z={-6} a={12} b={12} h={4} /><Box t={t} P={P} x={2} y={2} z={2} a={8} b={8} h={4} role="p2" /><Box t={t} P={P} x={4} y={4} z={10} a={4} b={4} h={4} role="p3" /><path d="M24 25v-14M26.5 21v-14" stroke={t.arrow} strokeWidth="1.2" strokeDasharray="2 1.4" /></>; },
  baseview: (t) => <><Sheet t={t} fold={false} x={3} y={5} w={26} h={22} /><rect x="7" y="10" width="13" height="10" fill={t.p('feat', 'f')} stroke={t.ink} strokeWidth={t.w} /><circle cx="13.5" cy="15" r="2.5" fill="#fff" stroke={t.ink} strokeWidth={t.w} /><path d="M21 23h7M24.5 20v6" stroke={t.ink} strokeWidth={t.w} /></>,
  projview: (t) => <><Sheet t={t} fold={false} x={2} y={4} w={28} h={24} /><rect x="5" y="16" width="10" height="8" fill={t.p('body', 'f')} stroke={t.ink} strokeWidth={t.w} /><rect x="5" y="7" width="10" height="5" fill={t.p('feat', 'f')} stroke={t.ink} strokeWidth={t.w} /><rect x="20" y="16" width="6" height="8" fill={t.p('feat', 'f')} stroke={t.ink} strokeWidth={t.w} /><path d="M10 15.5v-2.5M15.5 20h3.5" stroke={t.arrow} strokeWidth="1.2" /></>,
  section: (t) => { const P = iso(16, 16); return <><Box t={t} P={P} a={13} b={13} h={9} /><polygon points={pts([P(0, 13, 0), P(13, 13, 0), P(13, 13, 9), P(0, 13, 9)])} fill={t.p('cut', 'l')} stroke={t.ink} strokeWidth={t.w} />{[1, 3, 5, 7, 9, 11].map((k) => <path key={k} d={`M${P(k, 13, 0.4)}L${P(Math.min(13, k + 4), 13, 8.6)}`} stroke="#fff" strokeWidth=".8" opacity=".8" />)}<polygon points={pts([P(0, 13, 9), P(13, 13, 9), P(13, 6, 9), P(0, 6, 9)])} fill={t.p('body', 't')} stroke={t.ink} strokeWidth={t.w} /></>; },
  detail: (t) => <><Sheet t={t} fold={false} x={2} y={6} w={20} h={20} /><path d="M5 22l5-9 4 5 5-8" stroke={t.sk} strokeWidth="1.5" fill="none" /><circle cx="19" cy="13" r="7.2" fill={t.th === 'e4' ? '#d6f0ff' : '#eaf6ff'} fillOpacity=".7" stroke={t.ink} strokeWidth="1.6" />{t.gloss && <ellipse cx="17" cy="10.5" rx="4" ry="2" fill="#fff" opacity=".7" />}<path d="M24 18.5l5 5" stroke={t.ink} strokeWidth="3.4" strokeLinecap="round" /><path d="M24.5 19l4.3 4.3" stroke={t.th === 'e4' ? '#ffb000' : t.th === 'e2' ? '#fdb515' : '#e6b000'} strokeWidth="1.8" strokeLinecap="round" /></>,
  balloon: (t) => <><path d="M4 28l9-9" stroke={t.ink} strokeWidth={t.w} /><circle cx="4" cy="28" r="1.4" fill={t.ink} /><circle cx="19" cy="13" r="9" fill={t.th === 'e4' ? '#fff8c0' : '#fff'} stroke={t.th === 'e2' ? '#0696d7' : t.ink} strokeWidth="1.5" /><text x="19" y="17" fontSize="11" textAnchor="middle" fontWeight="700" fill={t.th === 'e2' ? '#0b6ea8' : '#222'} fontFamily="Arial, sans-serif">1</text></>,
  bom: (t) => <><rect x="3" y="5" width="26" height="22" fill={t.p('paper', 'f')} stroke={t.ink} strokeWidth={t.w} /><rect x="3" y="5" width="26" height="5" fill={t.p('feat', 'f')} stroke={t.ink} strokeWidth={t.w} />{[14.5, 19, 23.5].map((y) => <path key={y} d={`M3 ${y}h26`} stroke={t.ink} strokeWidth={t.w * 0.8} />)}<path d="M9 5v22M21 5v22" stroke={t.ink} strokeWidth={t.w * 0.8} /></>,
  note: (t) => <><path d="M4 28l7-8" stroke={t.ink} strokeWidth={t.w} /><polygon points={pts(head([4, 28], [-0.7, 0.8], 3.4, 1.6))} fill={t.ink} /><text x="19" y="17" fontSize="15" textAnchor="middle" fontWeight="700" fill={t.sk} fontFamily="Georgia, serif">A</text><path d="M11 20h16" stroke={t.ink} strokeWidth={t.w} /></>,
  save: (t) => <><rect x="4" y="4" width="24" height="24" rx="2" fill={t.th === 'e2' ? '#3b8ed0' : t.th === 'e4' ? 'url(#k-e4-p2-f)' : 'url(#k-e3-p2-f)'} stroke={t.ink} strokeWidth={t.w} /><rect x="9" y="4" width="13" height="8" fill="#e8eef4" stroke={t.ink} strokeWidth={t.w} /><rect x="17" y="5.5" width="3" height="5" fill={t.ink} /><rect x="8" y="16" width="16" height="12" fill="#fff" stroke={t.ink} strokeWidth={t.w} /><path d="M10 20h12M10 23.5h12" stroke="#9aa6b2" strokeWidth=".9" /></>,
  open: (t) => <><path d="M3 8h9l2 3h14v15H3z" fill={t.th === 'e2' ? '#f7b54a' : `url(#k-${t.th}-p2-r)`} stroke={t.ink} strokeWidth={t.w} strokeLinejoin="round" style={t.th === 'e2' ? undefined : { fill: t.th === 'e4' ? '#f2a020' : '#e3a830' }} /><path d="M3 26l4-11h23l-4 11z" fill={t.th === 'e2' ? '#ffd48a' : t.th === 'e4' ? '#ffd24a' : '#ffe07a'} stroke={t.ink} strokeWidth={t.w} strokeLinejoin="round" />{t.gloss && <path d="M8 16h20l-1 2.5H7z" fill="#fff" opacity=".6" />}</>,
  newfile: (t) => <><Sheet t={t} x={6} y={3} w={19} h={25} /><Badge t={t} kind="star" x={23} y={23} /></>,
  undo: (t) => <Arrow t={t} d="M8 11h12a6.5 6.5 0 0 1 0 13h-6" w={3} color={t.th === 'e4' ? '#1d4fe0' : t.th === 'e2' ? '#0696d7' : '#1d5fd2'} head={head([2.5, 11], [-1, 0], 6, 4)} />,
  redo: (t) => <Arrow t={t} d="M24 11H12a6.5 6.5 0 0 0 0 13h6" w={3} color={t.th === 'e4' ? '#1d4fe0' : t.th === 'e2' ? '#0696d7' : '#1d5fd2'} head={head([29.5, 11], [1, 0], 6, 4)} />,
  smface: (t) => { const P = iso(16, 13, 1.15); return <Box t={t} P={P} a={14} b={12} h={2} role="feat" />; },
  smflange: (t) => { const P = iso(16, 18); return <><Box t={t} P={P} a={14} b={10} h={2} /><Box t={t} P={P} x={0} y={10} a={14} b={2} h={13} role="feat" /></>; },
  frame: (t) => { const I = (x: number, y: number, len: number, vert: boolean, k: number) => vert
    ? <g key={k}><rect x={x - 3} y={y} width="6" height={len} fill={t.p('feat', 'r')} stroke={t.ink} strokeWidth={t.w} /><rect x={x - 1} y={y} width="2" height={len} fill={t.p('feat', 'l')} stroke="none" />{t.gloss && <rect x={x - 2.4} y={y + 1} width="1" height={len - 2} fill="#fff" opacity=".55" />}</g>
    : <g key={k}><rect x={x} y={y - 3} width={len} height="6" fill={t.p('feat', 't')} stroke={t.ink} strokeWidth={t.w} /><rect x={x} y={y - 1} width={len} height="2" fill={t.p('feat', 'r')} stroke="none" /></g>;
    return <>{I(6, 4, 24, true, 1)}{I(26, 4, 24, true, 2)}{I(3, 7, 26, false, 3)}{I(3, 18, 26, false, 4)}</>; },
  weld: (t) => { const P = iso(16, 18); return <><Box t={t} P={P} a={14} b={12} h={2} /><Box t={t} P={P} y={0} z={2} a={14} b={2} h={10} /><path d={`M${pts([P(0, 2, 2), P(14, 2, 2)]).replace(' ', ' L')}`} stroke={t.ink} strokeWidth="4.4" strokeLinecap="round" /><path d={`M${pts([P(0, 2, 2), P(14, 2, 2)]).replace(' ', ' L')}`} stroke={t.th === 'e4' ? '#ff5636' : t.th === 'e2' ? '#f7941d' : '#e6b000'} strokeWidth="3" strokeLinecap="round" strokeDasharray="1.2 .6" /></>; },
};
KIT.epoint = (t) => { const P = iso(16, 18); return <><Box t={t} P={P} a={13} b={13} h={6} /><circle cx={P(6.5, 6.5, 6)[0]} cy={P(6.5, 6.5, 6)[1]} r="3.2" fill={t.th === 'e4' ? 'url(#k-sphere)' : t.dot} stroke={t.ink} strokeWidth={t.w} /><Arrow t={t} d={`M${P(6.5, 6.5, 6)[0]},${P(6.5, 6.5, 6)[1] - 3}v-12`} w={1.8} color={t.sk} head={head([P(6.5, 6.5, 6)[0], P(6.5, 6.5, 6)[1] - 19], [0, -1], 4, 2.6)} /></>; };
// alias de nombres usados en la cinta
KIT.sheetmetal = KIT.smflange; KIT.weldment = KIT.weld; KIT.content = KIT.assembly; KIT.pattern_comp = KIT.prect;
void P0;

export function KitIcon({ name, size = 32, theme }: { name: string; size?: number; theme: KitTheme }) {
  const d = KIT[name]; if (!d) return null;
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={`ico ico-kit ico-kit-${theme}`} shapeRendering="geometricPrecision" aria-hidden>
      {d(mk(theme))}
    </svg>
  );
}
