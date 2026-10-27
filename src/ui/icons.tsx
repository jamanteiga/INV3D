// Iconos propios (trazo simple) para la cinta y el navegador.
import type { ReactNode } from 'react';

const S = ({ children, size = 28 }: { children: ReactNode; size?: number }) => (
  <svg viewBox="0 0 32 32" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">{children}</svg>
);
const A = 'var(--ico-accent)';
const B = 'var(--ico-fill)';

export const Icons: Record<string, (p: { size?: number }) => JSX.Element> = {
  sketch: (p) => <S {...p}><path d="M5 25 L5 9 L21 9" /><path d="M9 21h16V7" stroke={A} /><path d="M20 26l7-7 2 2-7 7h-2z" fill={B} /></S>,
  finish: (p) => <S {...p}><rect x="5" y="7" width="22" height="18" rx="2" /><path d="M10 16l4 4 8-8" stroke="#2f9a4c" strokeWidth="2.2" /></S>,
  extrude: (p) => <S {...p}><path d="M6 22l8 4 12-6-8-4z" fill={B} /><path d="M6 22V12l8 4v10M14 16l12-6v10" /><path d="M6 12l12-6 8 4" /><path d="M18 6v-3m0 0l-2 2m2-2l2 2" stroke={A} /></S>,
  revolve: (p) => <S {...p}><path d="M16 4v24" strokeDasharray="2 2" /><path d="M16 8h5v16h-5" fill={B} /><path d="M11 7a9 4 0 1 0 10 0" stroke={A} /><path d="M21 7l-1-2.5M21 7l-2.6 .6" stroke={A} /></S>,
  fillet: (p) => <S {...p}><path d="M5 26V12a7 7 0 0 1 7-7h14" /><path d="M5 26h21V5" /><path d="M5 12a7 7 0 0 1 7-7" stroke={A} strokeWidth="2.4" /></S>,
  chamfer: (p) => <S {...p}><path d="M5 26V12l7-7h14v21z" fill={B} /><path d="M5 12l7-7" stroke={A} strokeWidth="2.4" /></S>,
  import: (p) => <S {...p}><path d="M8 4h11l6 6v18H8z" fill={B} /><path d="M19 4v6h6" /><path d="M16 13v10m0 0l-4-4m4 4l4-4" stroke={A} /></S>,
  line: (p) => <S {...p}><path d="M6 25L26 7" /><circle cx="6" cy="25" r="2" fill={A} stroke="none" /><circle cx="26" cy="7" r="2" fill={A} stroke="none" /></S>,
  rect: (p) => <S {...p}><rect x="6" y="9" width="20" height="14" /><circle cx="6" cy="23" r="2" fill={A} stroke="none" /><circle cx="26" cy="9" r="2" fill={A} stroke="none" /></S>,
  circle: (p) => <S {...p}><circle cx="16" cy="16" r="10" /><circle cx="16" cy="16" r="1.8" fill={A} stroke="none" /><path d="M16 16l7 -7" stroke={A} /></S>,
  npoly: (p) => <S {...p}><path d="M16 5l9.5 5.5v11L16 27l-9.5-5.5v-11z" /><circle cx="16" cy="16" r="1.8" fill={A} stroke="none" /></S>,
  dim: (p) => <S {...p}><path d="M5 22h22M5 18v8M27 18v8" /><path d="M9 22l-3 0m20 0l-3 0" /><text x="16" y="15" fontSize="9" textAnchor="middle" fill="currentColor" stroke="none">25</text></S>,
  params: (p) => <S {...p}><text x="5" y="22" fontSize="15" fontStyle="italic" fontFamily="Georgia, serif" fill="currentColor" stroke="none">fx</text><path d="M20 10h8M20 16h8M20 22h6" stroke={A} /></S>,
  iprops: (p) => <S {...p}><path d="M7 4h13l5 5v19H7z" fill={B} /><path d="M11 13h10M11 17h10M11 21h6" /><circle cx="22" cy="23" r="4" fill="var(--panel)" stroke={A} /><path d="M22 22v3" stroke={A} /></S>,
  mass: (p) => <S {...p}><path d="M9 12h14l3 15H6z" fill={B} /><circle cx="16" cy="8" r="3" /><path d="M13 21h6" stroke={A} /></S>,
  home: (p) => <S {...p}><path d="M5 15L16 6l11 9M8 13v13h16V13" /></S>,
  front: (p) => <S {...p}><rect x="7" y="7" width="18" height="18" fill={B} /><path d="M7 7h18v18H7z" stroke={A} /></S>,
  top: (p) => <S {...p}><path d="M4 12l12-6 12 6-12 6z" fill={B} stroke={A} /><path d="M4 12v8l12 6 12-6v-8" /></S>,
  right: (p) => <S {...p}><path d="M16 6l12 6v10l-12 6z" fill={B} stroke={A} /><path d="M16 6L4 12v10l12 6" /></S>,
  iso: (p) => <S {...p}><path d="M16 4l11 6v12l-11 6-11-6V10z" /><path d="M5 10l11 6 11-6M16 16v12" /></S>,
  fit: (p) => <S {...p}><path d="M5 11V5h6M21 5h6v6M27 21v6h-6M11 27H5v-6" /><rect x="11" y="11" width="10" height="10" fill={B} /></S>,
  edges: (p) => <S {...p}><path d="M16 4l11 6v12l-11 6-11-6V10z" fill={B} /><path d="M5 10l11 6 11-6M16 16v12" strokeWidth="2.2" /></S>,
  undo: (p) => <S {...p}><path d="M10 9L5 14l5 5" /><path d="M5 14h13a7 7 0 0 1 0 14h-4" /></S>,
  redo: (p) => <S {...p}><path d="M22 9l5 5-5 5" /><path d="M27 14H14a7 7 0 0 0 0 14h4" /></S>,
  save: (p) => <S {...p}><path d="M6 5h17l4 4v18H6z" /><path d="M10 5v7h11V5M10 27v-9h12v9" /></S>,
  open: (p) => <S {...p}><path d="M4 9h9l2 3h13v14H4z" /><path d="M4 26l4-10h22l-4 10" fill={B} /></S>,
  newfile: (p) => <S {...p}><path d="M8 4h11l6 6v18H8z" /><path d="M19 4v6h6M16 15v8M12 19h8" /></S>,
  project: (p) => <S {...p}><path d="M5 7h22v18H5z" /><path d="M5 12h22M10 7v18" /></S>,
  step: (p) => <S {...p}><path d="M8 4h11l6 6v18H8z" /><text x="16.5" y="22" fontSize="7.5" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700">STP</text></S>,
  stl: (p) => <S {...p}><path d="M8 4h11l6 6v18H8z" /><text x="16.5" y="22" fontSize="7.5" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700">STL</text></S>,
  sheet: (p) => <S {...p}><path d="M5 22l10-10h12L17 22z" fill={B} /><path d="M5 22v4l10 0 2-4M17 22v4" /></S>,
  frame: (p) => <S {...p}><path d="M6 26V8M26 26V8M6 8h20M6 17h20" strokeWidth="2.6" /></S>,
  weld: (p) => <S {...p}><path d="M4 22h24M16 22V8" strokeWidth="2.4" /><path d="M16 22l-4-4M16 22l4-4" stroke={A} strokeWidth="2.2" /></S>,
  bolt: (p) => <S {...p}><path d="M10 6h12l-2 4h-8z" fill={B} /><path d="M13 10v16M19 10v16M13 14h6M13 18h6M13 22h6" /></S>,
  drawing: (p) => <S {...p}><rect x="4" y="6" width="24" height="20" /><path d="M18 26v-6h10M8 10h8v8H8z" /></S>,
  assembly: (p) => <S {...p}><path d="M4 18l7-4 7 4-7 4z" fill={B} /><path d="M4 18v6l7 4v-6M18 18v6l-7 4" /><path d="M14 10l7-4 7 4-7 4z" /><path d="M14 10v6l7 4 7-4v-6M21 14v6" /></S>,
  presentation: (p) => <S {...p}><rect x="9" y="5" width="12" height="8" /><rect x="9" y="19" width="12" height="8" fill={B} /><path d="M15 13v6m0 0l-2-2m2 2l2-2" stroke={A} /></S>,
  origin: (p) => <S {...p}><path d="M9 4h14v24H9z" fill={B} /><path d="M12 9h8M12 14h8" /></S>,
  plane: (p) => <S {...p}><path d="M4 20l8-10h16l-8 10z" fill={B} /></S>,
  axis: (p) => <S {...p}><path d="M4 26L28 6" strokeDasharray="3 2" /></S>,
  point: (p) => <S {...p}><circle cx="16" cy="16" r="3" fill={A} stroke="none" /><path d="M16 6v6M16 20v6M6 16h6M20 16h6" /></S>,
  part: (p) => <S {...p}><path d="M16 4l11 6v12l-11 6-11-6V10z" fill={B} /><path d="M5 10l11 6 11-6M16 16v12" /></S>,
  error: (p) => <S {...p}><circle cx="16" cy="16" r="11" fill="#d64545" stroke="none" /><path d="M16 9v9M16 22v1" stroke="#fff" strokeWidth="2.4" /></S>,
  trash: (p) => <S {...p}><path d="M7 9h18M12 9V6h8v3M9 9l1.5 18h11L23 9" /></S>,
  close: (p) => <S {...p}><path d="M9 9l14 14M23 9L9 23" /></S>,
  help: (p) => <S {...p}><circle cx="16" cy="16" r="11" /><path d="M12.5 12.5a3.5 3.5 0 1 1 5 3.2c-1 .5-1.5 1.2-1.5 2.3M16 22v.5" /></S>,
};

export const Icon = ({ name, size }: { name: string; size?: number }) => (Icons[name] ?? Icons.part)({ size });
