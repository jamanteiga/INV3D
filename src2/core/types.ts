// INV3D v2 — document model (part .i3p, assembly .i3a, drawing .i3d, presentation .i3n)

export type V2 = [number, number];
export type V3 = [number, number, number];
/** 4x4 column-major matrix (same layout as THREE.Matrix4.elements) */
export type M4 = number[];

export interface Param {
  name: string;
  expr: string;
  kind: 'model' | 'user' | 'reference';
  unit?: 'mm' | 'deg' | 'ul';
  comment?: string;
}

export interface IProps {
  partNumber: string;
  description: string;
  designer: string;
  revision: string;
  project: string;
  stockNumber: string;
  company: string;
  checkedBy: string;
  creationDate: string;
}

/* ------------------------------------------------------------------ */
/* Geometry references (what the user picked)                          */
/* ------------------------------------------------------------------ */
export type GeomRef =
  | { t: 'face'; p: V3; n: V3; surf: 'plane' | 'cylinder' | 'cone' | 'sphere' | 'other'; o?: V3; d?: V3; r?: number; area?: number; occ?: string }
  | { t: 'edge'; p: V3; curve: 'line' | 'circle' | 'other'; a?: V3; b?: V3; c?: V3; d?: V3; r?: number; occ?: string }
  | { t: 'vertex'; p: V3; occ?: string }
  | { t: 'work'; id: string; occ?: string }
  | { t: 'sk'; sketch: string; ent: string; occ?: string }
  | { t: 'profile'; sketch: string; pts: V2[] }
  | { t: 'occ'; occ: string };

export type PickFilter =
  | 'face' | 'planarFace' | 'cylFace' | 'edge' | 'linearEdge' | 'circularEdge' | 'vertex'
  | 'workPlane' | 'workAxis' | 'workPoint' | 'skLine' | 'skPoint' | 'skCurve' | 'skEntity' | 'profile'
  | 'occ' | 'frameMember' | 'skeletonLine';

/* ------------------------------------------------------------------ */
/* Sketch                                                              */
/* ------------------------------------------------------------------ */
export interface SkPoint { id: string; t: 'point'; x: number; y: number; fixed?: boolean; construction?: boolean; ref?: boolean; center?: boolean }
export interface SkLine { id: string; t: 'line'; p1: string; p2: string; construction?: boolean; ref?: boolean; centerline?: boolean }
export interface SkCircle { id: string; t: 'circle'; c: string; r: number; construction?: boolean; ref?: boolean }
export interface SkArc { id: string; t: 'arc'; c: string; s: string; e: string; r: number; construction?: boolean; ref?: boolean }
export interface SkText { id: string; t: 'text'; p: string; text: string; h: number }
export type SkEnt = SkPoint | SkLine | SkCircle | SkArc | SkText;

export type SkConType =
  | 'coincident' | 'pointOnLine' | 'pointOnCurve' | 'horizontal' | 'vertical' | 'parallel' | 'perpendicular'
  | 'tangent' | 'equal' | 'fix' | 'concentric' | 'collinear' | 'midpoint' | 'symmetric' | 'hpp' | 'vpp';
export interface SkCon { id: string; t: SkConType; e: string[] }

export type SkDimType = 'distance' | 'hdist' | 'vdist' | 'length' | 'radius' | 'diameter' | 'angle' | 'pldist' | 'hlen' | 'vlen';
export interface SkDim { id: string; t: SkDimType; e: string[]; param: string; driven?: boolean; pos: V2 }

export type PlaneSpec =
  | { t: 'work'; id: string }
  | { t: 'face'; o: V3; x: V3; n: V3; label?: string };

/* ------------------------------------------------------------------ */
/* Part features                                                       */
/* ------------------------------------------------------------------ */
export type BoolOp = 'join' | 'cut' | 'intersect' | 'new';

export interface FBase { id: string; name: string; suppressed?: boolean; visible?: boolean }

export interface SketchF extends FBase { type: 'sketch'; plane: PlaneSpec; ents: SkEnt[]; cons: SkCon[]; dims: SkDim[] }
export interface Sketch3DF extends FBase { type: 'sketch3d'; pts: { id: string; x: string; y: string; z: string }[]; lines: { id: string; p1: string; p2: string }[] }
export interface WorkPlaneF extends FBase { type: 'workplane'; mode: 'offset' | 'angle' | 'midplane'; base: GeomRef; base2?: GeomRef; axis?: GeomRef; dist: string; angle: string }
export interface WorkAxisF extends FBase { type: 'workaxis'; mode: 'twoPoints' | 'edge' | 'cyl' | 'planes'; refs: GeomRef[] }
export interface WorkPointF extends FBase { type: 'workpoint'; x: string; y: string; z: string }

export interface ExtrudeF extends FBase {
  type: 'extrude'; profile: GeomRef; extent: 'distance' | 'through' | 'to';
  dist: string; dist2: string; dir: 'default' | 'flip' | 'symmetric' | 'asym'; op: BoolOp; taper: string; to?: GeomRef; sm?: boolean;
}
export interface RevolveF extends FBase { type: 'revolve'; profile: GeomRef; axis: GeomRef | null; extent: 'full' | 'angle'; angle: string; dir: 'default' | 'flip' | 'symmetric'; op: BoolOp }
export interface SweepF extends FBase { type: 'sweep'; profile: GeomRef; path: GeomRef[]; op: BoolOp; orient: 'path' | 'parallel' }
export interface LoftF extends FBase { type: 'loft'; sections: GeomRef[]; op: BoolOp; ruled: boolean }
export interface CoilF extends FBase { type: 'coil'; profile: GeomRef; axis: GeomRef | null; mode: 'pitchRevs' | 'pitchHeight' | 'revsHeight'; pitch: string; revs: string; height: string; ccw: boolean; op: BoolOp }
export interface HoleF extends FBase {
  type: 'hole'; sketch: string; points: string[]; flip: boolean;
  holeType: 'simple' | 'clearance' | 'tapped' | 'cbore' | 'csink';
  size: string; d: string; term: 'distance' | 'through'; depth: string;
  cbD: string; cbDepth: string; csD: string; csAngle: string; drillAngle: string;
}
export interface EdgeSel { mode: 'picked' | 'all' | 'X' | 'Y' | 'Z' | 'circle'; refs: GeomRef[] }
export interface FilletF extends FBase { type: 'fillet'; edges: EdgeSel; r: string }
export interface ChamferF extends FBase { type: 'chamfer'; edges: EdgeSel; mode: 'distance' | 'twoDist'; d: string; d2: string }
export interface ShellF extends FBase { type: 'shell'; faces: GeomRef[]; t: string; dir: 'inside' | 'outside' }
export interface ThreadF extends FBase { type: 'thread'; face: GeomRef | null; size: string; full: boolean; length: string }
export interface CombineF extends FBase { type: 'combine'; base: number; tools: number[]; op: 'join' | 'cut' | 'intersect'; keep: boolean }
export interface SplitF extends FBase { type: 'split'; tool: GeomRef | null; mode: 'trim' | 'split'; side: 'pos' | 'neg' }
export interface MirrorF extends FBase { type: 'mirror'; mode: 'features' | 'solid'; features: string[]; plane: GeomRef | null }
export interface RectPatternF extends FBase { type: 'rectpattern'; mode: 'features' | 'solid'; features: string[]; dir1: GeomRef | null; n1: string; s1: string; flip1: boolean; dir2: GeomRef | null; n2: string; s2: string; flip2: boolean }
export interface CircPatternF extends FBase { type: 'circpattern'; mode: 'features' | 'solid'; features: string[]; axis: GeomRef | null; n: string; angle: string }
export interface ImportF extends FBase { type: 'import'; fileName: string; step: string }
export interface DeriveF extends FBase { type: 'derive'; file: string; op: 'new' | 'join'; scale: string; mirrorPlane: 'none' | 'XY' | 'XZ' | 'YZ' }
/* sheet metal */
export interface SMFaceF extends FBase { type: 'smface'; profile: GeomRef; flip: boolean }
export interface SMFlangeF extends FBase { type: 'smflange'; edge: GeomRef | null; height: string; angle: string; radius: string; flip: boolean; off1: string; off2: string; datum: 'outer' | 'inner' | 'tangent' }
export interface SMContourF extends FBase { type: 'smcontour'; path: GeomRef[]; sketch: string; width: string; flip: boolean; symmetric: boolean }
export interface SMHemF extends FBase { type: 'smhem'; edge: GeomRef | null; hem: 'single' | 'double'; gap: string; length: string; flip: boolean }
export interface SMPunchF extends FBase { type: 'smpunch'; sketch: string; points: string[]; shape: 'round' | 'square' | 'obround' | 'rect'; d: string; w: string; h: string; angle: string }

export type Feature =
  | SketchF | Sketch3DF | WorkPlaneF | WorkAxisF | WorkPointF
  | ExtrudeF | RevolveF | SweepF | LoftF | CoilF | HoleF | FilletF | ChamferF | ShellF | ThreadF
  | CombineF | SplitF | MirrorF | RectPatternF | CircPatternF | ImportF | DeriveF
  | SMFaceF | SMFlangeF | SMContourF | SMHemF | SMPunchF;
export type FeatureType = Feature['type'];

export interface SheetDefaults { thickness: string; radius: string; kfactor: string; relief: string; gap: string }

export interface IPartRow { name: string; values: Record<string, string> }
export interface Rule { id: string; name: string; code: string; trigger: 'manual' | 'paramChange' | 'beforeSave'; suppressed?: boolean }
export interface FormItem { t: 'param' | 'rule' | 'label'; ref: string; label?: string }
export interface IForm { id: string; name: string; items: FormItem[] }

export interface PartDoc {
  kind: 'part'; version: 2; subtype: 'standard' | 'sheetmetal'; units: 'mm';
  iprops: IProps; params: Param[]; features: Feature[];
  material: string; appearance: string;
  sheet: SheetDefaults;
  ipart?: { rows: IPartRow[]; active: number; columns: string[] };
  rules: Rule[]; forms: IForm[];
  eop?: number; // end-of-part index (features after are rolled back)
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */
export type OccSrc =
  | { t: 'file'; file: string }
  | { t: 'gen'; gen: string; p: Record<string, number | string>; label: string };

export interface Occ {
  id: string; name: string; src: OccSrc; m: M4; grounded: boolean; visible: boolean;
  color?: string; group?: string; material?: string; partNumber?: string; description?: string;
}

export type JointType = 'rigid' | 'rotational' | 'slider' | 'cylindrical' | 'planar' | 'ball';
export interface ACon {
  id: string; name: string; type: 'mate' | 'flush' | 'angle' | 'insert' | 'tangent' | 'joint';
  joint?: JointType; a: GeomRef; b: GeomRef; offset: string; angle: string; aligned?: boolean; suppressed?: boolean;
}

export interface APattern { id: string; name: string; type: 'rect' | 'circ' | 'mirror'; occs: string[]; n1: string; s1: string; d1: V3; n2: string; s2: string; d2: V3; axisO: V3; axisD: V3; angle: string; planeO: V3; planeN: V3; made: string[] }

export interface ProfileRef { standard: string; family: string; size: string }
export interface EndTreat { t: 'none' | 'miter' | 'trim' | 'corner' | 'notch' | 'trimFrame'; other?: string; gap?: number; bbox?: boolean; corner?: 'butt' | 'lap' }
export interface FrameMember {
  id: string; name: string; line: GeomRef; profile: ProfileRef; material: string;
  rot: string; offA: string; offB: string; mirror: boolean;
  ext0: number; ext1: number; ends: [EndTreat, EndTreat];
  caps?: [{ t: number; off: number } | null, { t: number; off: number } | null];
}

export interface Connection {
  id: string; name: string; kind: 'bolted' | 'clevis' | 'secure' | 'cross' | 'joint' | 'radial' | 'shaft' | 'spring' | 'gear' | 'key' | 'bearing';
  design: Record<string, any>; calc: Record<string, any>; occs: string[];
}

export interface AsmFeature {
  id: string; name: string; type: 'holecut' | 'extrudecut' | 'chamfer';
  stage: 'asm' | 'prep' | 'machining';
  axisO?: V3; axisD?: V3; d?: number; depth?: number;
  occs: string[]; data?: Record<string, any>;
}

export interface Weld {
  id: string; name: string; type: 'fillet' | 'groove' | 'cosmetic';
  set1: GeomRef[]; set2: GeomRef[]; size: string; leg: 'leg' | 'throat'; intermittent?: { len: number; pitch: number };
  edges?: GeomRef[]; process: string; symbol: boolean;
}

export interface AssemblyDoc {
  kind: 'assembly'; version: 2; subtype: 'standard' | 'weldment'; units: 'mm';
  iprops: IProps; params: Param[];
  occs: Occ[]; cons: ACon[]; patterns: APattern[];
  frame: FrameMember[]; skeleton?: string; frameLoads?: FrameAnalysisSetup;
  connections: Connection[]; asmFeatures: AsmFeature[]; welds: Weld[];
  rules: Rule[]; forms: IForm[];
}

export interface FrameAnalysisSetup {
  supports: { node: V3; type: 'fixed' | 'pinned' | 'floating' }[];
  forces: { node: V3; f: V3; m: V3 }[];
  dist: { member: string; q: V3 }[];
  gravity: boolean;
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */
export type ViewDir = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' | 'iso-tr' | 'iso-tl' | 'iso-br' | 'iso-bl';
export interface DView {
  id: string; name: string; type: 'base' | 'projected' | 'section' | 'detail' | 'aux';
  file: string; scene?: { pres: string; scene: string; time: number };
  parent?: string; dir: V3; up: V3; dirName?: ViewDir;
  scale: number; x: number; y: number; style: 'hidden' | 'visible' | 'hiddenRemoved';
  showLabel: boolean; label: string;
  section?: { a: V2; b: V2; flip: boolean };
  detail?: { c: V2; r: number; fence: 'circle' | 'rect' };
  crop?: { a: V2; b: V2 };
  shaded?: boolean;
}
export type AnnoType = 'dim' | 'text' | 'leader' | 'balloon' | 'partslist' | 'centermark' | 'centerline' | 'surface' | 'weld' | 'fcf' | 'datum' | 'revtable' | 'revtag' | 'holenote' | 'sketch';
export interface Anno {
  id: string; t: AnnoType; view?: string;
  pts: V2[]; // sheet-space points (mm) or view-local points when attached
  text?: string; value?: number; kind?: string; data?: Record<string, any>;
}
export interface Sheet { id: string; name: string; size: 'A0' | 'A1' | 'A2' | 'A3' | 'A4'; orient: 'landscape' | 'portrait'; views: DView[]; annos: Anno[]; titleBlock: boolean; border: boolean }
export interface DrawingDoc { kind: 'drawing'; version: 2; units: 'mm'; standard: 'ISO' | 'DIN' | 'ANSI'; projection: 'first' | 'third'; iprops: IProps; sheets: Sheet[]; revisions: { rev: string; desc: string; date: string; by: string }[] }

/* ------------------------------------------------------------------ */
/* Presentation                                                        */
/* ------------------------------------------------------------------ */
export interface Tweak { id: string; name: string; occs: string[]; dir: V3; dist: number; rotAxis: V3; rotAngle: number; start: number; dur: number; trail: boolean }
export interface Snapshot { id: string; name: string; time: number; cam: { pos: V3; target: V3; up: V3; zoom: number } }
export interface PScene { id: string; name: string; tweaks: Tweak[]; snapshots: Snapshot[]; cams: { id: string; time: number; cam: Snapshot['cam'] }[]; hidden: { occ: string; time: number; opacity: number }[] }
export interface PresentationDoc { kind: 'presentation'; version: 2; asm: string; iprops: IProps; scenes: PScene[] }

export type AnyDoc = PartDoc | AssemblyDoc | DrawingDoc | PresentationDoc;
export type DocKind = AnyDoc['kind'];

export const EXT: Record<DocKind, string> = { part: '.i3p', assembly: '.i3a', drawing: '.i3d', presentation: '.i3n' };
export const KIND_OF_EXT: Record<string, DocKind> = { i3p: 'part', i3a: 'assembly', i3d: 'drawing', i3n: 'presentation' };
