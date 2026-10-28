// Document factories, templates and model-parameter helpers.
import type {
  PartDoc, AssemblyDoc, DrawingDoc, PresentationDoc, IProps, Param, AnyDoc, DocKind, Feature, FeatureType, SheetDefaults,
} from './types';
import { EXT } from './types';
import { resolveParams } from './expr';

export const emptyIProps = (partNumber = ''): IProps => ({
  partNumber, description: '', designer: '', revision: '', project: '', stockNumber: '', company: '', checkedBy: '',
  creationDate: new Date().toISOString().slice(0, 10),
});

export const defaultSheet = (): SheetDefaults => ({ thickness: '0.5 mm', radius: 'Thickness', kfactor: '0.44', relief: 'Thickness', gap: 'Thickness' });

export function newPart(name = 'Part1', subtype: PartDoc['subtype'] = 'standard'): PartDoc {
  const d: PartDoc = {
    kind: 'part', version: 2, subtype, units: 'mm', iprops: emptyIProps(name), params: [], features: [],
    material: subtype === 'sheetmetal' ? 'Steel, Mild' : 'Generic', appearance: 'As Material',
    sheet: defaultSheet(), rules: [], forms: [],
  };
  if (subtype === 'sheetmetal') {
    d.params.push({ name: 'Thickness', expr: '0.5 mm', kind: 'model', unit: 'mm', comment: 'Sheet Metal Thickness' });
  }
  return d;
}
export const newAssembly = (name = 'Assembly1', subtype: AssemblyDoc['subtype'] = 'standard'): AssemblyDoc => ({
  kind: 'assembly', version: 2, subtype, units: 'mm', iprops: emptyIProps(name), params: [], occs: [], cons: [], patterns: [],
  frame: [], connections: [], asmFeatures: [], welds: [], rules: [], forms: [],
});
export const newDrawing = (size: DrawingDoc['sheets'][0]['size'] = 'A3', standard: DrawingDoc['standard'] = 'ISO'): DrawingDoc => ({
  kind: 'drawing', version: 2, units: 'mm', standard, projection: standard === 'ANSI' ? 'third' : 'first', iprops: emptyIProps('Drawing1'),
  sheets: [{ id: 'sh1', name: 'Sheet:1', size, orient: size === 'A4' ? 'portrait' : 'landscape', views: [], annos: [], titleBlock: true, border: true }],
  revisions: [],
});
export const newPresentation = (asm = ''): PresentationDoc => ({
  kind: 'presentation', version: 2, asm, iprops: emptyIProps('Presentation1'),
  scenes: [{ id: 'sc1', name: 'Scene1', tweaks: [], snapshots: [], cams: [], hidden: [] }],
});

export function newDocOfKind(kind: DocKind): AnyDoc {
  switch (kind) {
    case 'part': return newPart();
    case 'assembly': return newAssembly();
    case 'drawing': return newDrawing();
    case 'presentation': return newPresentation();
  }
}

/* ---------------- Templates (File > New) ---------------- */
export interface Template { id: string; label: string; kind: DocKind; folder: 'Metric' | 'English'; make: () => AnyDoc; icon: string }
export const TEMPLATES: Template[] = [
  { id: 'part-mm', label: 'Standard (mm)', kind: 'part', folder: 'Metric', make: () => newPart(), icon: 'part' },
  { id: 'part-din', label: 'Standard (DIN)', kind: 'part', folder: 'Metric', make: () => newPart(), icon: 'part' },
  { id: 'sm-mm', label: 'Sheet Metal (mm)', kind: 'part', folder: 'Metric', make: () => newPart('Part1', 'sheetmetal'), icon: 'sheetpart' },
  { id: 'sm-din', label: 'Sheet Metal (DIN)', kind: 'part', folder: 'Metric', make: () => newPart('Part1', 'sheetmetal'), icon: 'sheetpart' },
  { id: 'asm-mm', label: 'Standard (mm)', kind: 'assembly', folder: 'Metric', make: () => newAssembly(), icon: 'assembly' },
  { id: 'asm-din', label: 'Standard (DIN)', kind: 'assembly', folder: 'Metric', make: () => newAssembly(), icon: 'assembly' },
  { id: 'weld-iso', label: 'Weldment (ISO)', kind: 'assembly', folder: 'Metric', make: () => newAssembly('Assembly1', 'weldment'), icon: 'weldasm' },
  { id: 'weld-din', label: 'Weldment (DIN)', kind: 'assembly', folder: 'Metric', make: () => newAssembly('Assembly1', 'weldment'), icon: 'weldasm' },
  { id: 'dwg-a0', label: 'A0', kind: 'drawing', folder: 'Metric', make: () => newDrawing('A0'), icon: 'drawing' },
  { id: 'dwg-a1', label: 'A1', kind: 'drawing', folder: 'Metric', make: () => newDrawing('A1'), icon: 'drawing' },
  { id: 'dwg-a2', label: 'A2', kind: 'drawing', folder: 'Metric', make: () => newDrawing('A2'), icon: 'drawing' },
  { id: 'dwg-a3', label: 'A3', kind: 'drawing', folder: 'Metric', make: () => newDrawing('A3'), icon: 'drawing' },
  { id: 'dwg-a4', label: 'A4', kind: 'drawing', folder: 'Metric', make: () => newDrawing('A4'), icon: 'drawing' },
  { id: 'dwg-iso', label: 'ISO', kind: 'drawing', folder: 'Metric', make: () => newDrawing('A3', 'ISO'), icon: 'drawing' },
  { id: 'dwg-din', label: 'DIN', kind: 'drawing', folder: 'Metric', make: () => newDrawing('A3', 'DIN'), icon: 'drawing' },
  { id: 'pres-mm', label: 'Standard (mm)', kind: 'presentation', folder: 'Metric', make: () => newPresentation(), icon: 'presentation' },
  { id: 'part-in', label: 'Standard (in)', kind: 'part', folder: 'English', make: () => newPart(), icon: 'part' },
  { id: 'asm-in', label: 'Standard (in)', kind: 'assembly', folder: 'English', make: () => newAssembly(), icon: 'assembly' },
  { id: 'dwg-ansi', label: 'ANSI (in)', kind: 'drawing', folder: 'English', make: () => newDrawing('A3', 'ANSI'), icon: 'drawing' },
];

export const BASE_NAMES: Record<DocKind, string> = { part: 'Part', assembly: 'Assembly', drawing: 'Drawing', presentation: 'Presentation' };
export function nextFileName(kind: DocKind, taken: Set<string>): string {
  let n = 1;
  while (taken.has(`${BASE_NAMES[kind]}${n}${EXT[kind]}`)) n++;
  return `${BASE_NAMES[kind]}${n}${EXT[kind]}`;
}

/* ---------------- Model parameters (d0, d1, …) ---------------- */
export function nextParamName(params: Param[]): string {
  let n = 0;
  const names = new Set(params.map((p) => p.name));
  while (names.has(`d${n}`)) n++;
  return `d${n}`;
}
/** Create a model parameter and return its name */
export function addModelParam(params: Param[], expr: string, unit: Param['unit'] = 'mm', comment = ''): string {
  const name = nextParamName(params);
  params.push({ name, expr, kind: 'model', unit, comment });
  return name;
}
export const paramExpr = (params: Param[], name: string) => params.find((p) => p.name === name)?.expr ?? name;

/** Evaluate an expression or parameter name with all doc params */
export function docEval(params: Param[]) {
  const { values, errors } = resolveParams(params);
  return { values, errors };
}

/** Param names referenced by a feature (to remove params when a feature is deleted) */
export function featureParamNames(f: Feature): string[] {
  const out: string[] = [];
  const walk = (o: unknown) => {
    if (typeof o === 'string') { if (/^d\d+$/.test(o)) out.push(o); return; }
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') Object.values(o).forEach(walk);
  };
  walk(f);
  return out;
}

export const FEATURE_LABEL: Record<FeatureType, string> = {
  sketch: 'Sketch', sketch3d: '3D Sketch', workplane: 'Work Plane', workaxis: 'Work Axis', workpoint: 'Work Point',
  extrude: 'Extrusion', revolve: 'Revolution', sweep: 'Sweep', loft: 'Loft', coil: 'Coil', hole: 'Hole', fillet: 'Fillet',
  chamfer: 'Chamfer', shell: 'Shell', thread: 'Thread', combine: 'Combine', split: 'Split', mirror: 'Mirror',
  rectpattern: 'Rectangular Pattern', circpattern: 'Circular Pattern', import: 'Import', derive: 'Derived Part',
  smface: 'Face', smflange: 'Flange', smcontour: 'Contour Flange', smhem: 'Hem', smpunch: 'iFeature',
};

export function nextFeatureName(features: Feature[], type: FeatureType): string {
  const base = FEATURE_LABEL[type].replace(/\s/g, '');
  let n = 1;
  const names = new Set(features.map((f) => f.name));
  while (names.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

export function validateDoc(x: any): AnyDoc {
  if (!x || x.version !== 2 || !['part', 'assembly', 'drawing', 'presentation'].includes(x.kind)) throw new Error('Not an INV3D v2 document');
  const base = newDocOfKind(x.kind) as any;
  for (const k of Object.keys(base)) if (x[k] === undefined) x[k] = base[k];
  return x as AnyDoc;
}
