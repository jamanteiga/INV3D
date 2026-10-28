// Modelo de datos del plano INV3D (.i3d): hojas, vistas proyectadas, cotas, notas y cajetín.
import type { V3 } from './doc';

export type SheetSize = 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
export const SHEETS: Record<SheetSize, [number, number]> = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };

export type ViewDir = 'front' | 'top' | 'right' | 'left' | 'back' | 'bottom' | 'iso';
export const VIEW_NAMES: Record<ViewDir, string> = {
  front: 'Alzado', top: 'Planta', right: 'Perfil derecho', left: 'Perfil izquierdo', back: 'Posterior', bottom: 'Inferior', iso: 'Isométrica',
};

/** Dirección de la mirada (desde la cámara hacia la pieza) y eje X de la vista, con Z arriba (proyección europea). */
export const VIEW_CAMERAS: Record<ViewDir, { dir: V3; x: V3 }> = {
  front: { dir: [0, 1, 0], x: [1, 0, 0] },
  back: { dir: [0, -1, 0], x: [-1, 0, 0] },
  right: { dir: [-1, 0, 0], x: [0, 1, 0] },
  left: { dir: [1, 0, 0], x: [0, -1, 0] },
  top: { dir: [0, 0, -1], x: [1, 0, 0] },
  bottom: { dir: [0, 0, 1], x: [1, 0, 0] },
  iso: { dir: [-0.5774, 0.5774, -0.5774], x: [0.7071, 0.7071, 0] },
};

export interface DView {
  id: string; name: string;
  source: string;           // id del documento (pieza o ensamblaje)
  dir: ViewDir;
  scale: number;            // 1:n → 1/n
  x: number; y: number;     // centro en la hoja (mm)
  hidden: boolean;          // mostrar aristas ocultas
  parent?: string;          // vista base de la que se proyecta
}
export interface DDim { id: string; view: string; a: [number, number]; b: [number, number]; offset: number; kind: 'h' | 'v' | 'a'; text?: string }
export interface DNote { id: string; x: number; y: number; text: string; size: number }
export interface TitleBlock { title: string; partNumber: string; material: string; designer: string; checker: string; date: string; company: string; revision: string; scale: string }

export interface DrawingDoc {
  format: 'inv3d.drawing';
  version: 1;
  sheet: SheetSize;
  views: DView[];
  dims: DDim[];
  notes: DNote[];
  title: TitleBlock;
  bom?: { view: string; x: number; y: number } | null;
}

export function newDrawing(): DrawingDoc {
  return {
    format: 'inv3d.drawing', version: 1, sheet: 'A3', views: [], dims: [], notes: [],
    title: { title: '', partNumber: '', material: '', designer: '', checker: '', date: new Date().toLocaleDateString('es-ES'), company: '', revision: 'A', scale: '1:1' },
    bom: null,
  };
}
export function validateDrawing(x: unknown): DrawingDoc {
  const d = x as DrawingDoc;
  if (!d || d.format !== 'inv3d.drawing') throw new Error('No es un plano INV3D (.i3d) válido');
  d.dims ??= []; d.notes ??= []; d.views ??= [];
  return d;
}

export const SCALES = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.04, 0.02, 0.01];
export const scaleLabel = (s: number) => (s >= 1 ? `${s}:1` : `1:${Math.round(1 / s)}`);

/** Proyección europea (ISO E): a partir de la vista base, la proyectada a la derecha es el perfil izquierdo, etc. */
export function projectedDir(base: ViewDir, side: 'right' | 'left' | 'up' | 'down'): ViewDir {
  if (base === 'front') return side === 'right' ? 'left' : side === 'left' ? 'right' : side === 'down' ? 'top' : 'bottom';
  if (base === 'top') return side === 'up' ? 'front' : side === 'down' ? 'back' : side === 'right' ? 'left' : 'right';
  return 'iso';
}
