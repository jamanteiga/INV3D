// ISO metric fastener data (coarse thread) used by Content Center and the Bolted Connection Generator.
export interface ThreadRow {
  d: string; dn: number; p: number;      // designation, nominal diameter, pitch
  s: number; k: number; e: number;       // hex head: across flats, head height, across corners
  m: number;                              // nut height ISO 4032
  dk: number; ks: number;                 // socket head ISO 4762: head dia, head height
  w1: number; w2: number; wh: number;     // washer ISO 7089: inner, outer, thickness
  hf: number; hm: number; hc: number;     // clearance holes ISO 273: fine, medium, coarse
  tap: number;                            // tap drill
  As: number;                             // tensile stress area mm²
}

export const THREADS: ThreadRow[] = [
  { d: 'M3', dn: 3, p: 0.5, s: 5.5, k: 2, e: 6.01, m: 2.4, dk: 5.5, ks: 3, w1: 3.2, w2: 7, wh: 0.5, hf: 3.2, hm: 3.4, hc: 3.6, tap: 2.5, As: 5.03 },
  { d: 'M4', dn: 4, p: 0.7, s: 7, k: 2.8, e: 7.66, m: 3.2, dk: 7, ks: 4, w1: 4.3, w2: 9, wh: 0.8, hf: 4.3, hm: 4.5, hc: 4.8, tap: 3.3, As: 8.78 },
  { d: 'M5', dn: 5, p: 0.8, s: 8, k: 3.5, e: 8.79, m: 4.7, dk: 8.5, ks: 5, w1: 5.3, w2: 10, wh: 1, hf: 5.3, hm: 5.5, hc: 5.8, tap: 4.2, As: 14.2 },
  { d: 'M6', dn: 6, p: 1, s: 10, k: 4, e: 11.05, m: 5.2, dk: 10, ks: 6, w1: 6.4, w2: 12, wh: 1.6, hf: 6.4, hm: 6.6, hc: 7, tap: 5, As: 20.1 },
  { d: 'M8', dn: 8, p: 1.25, s: 13, k: 5.3, e: 14.38, m: 6.8, dk: 13, ks: 8, w1: 8.4, w2: 16, wh: 1.6, hf: 8.4, hm: 9, hc: 10, tap: 6.8, As: 36.6 },
  { d: 'M10', dn: 10, p: 1.5, s: 16, k: 6.4, e: 17.77, m: 8.4, dk: 16, ks: 10, w1: 10.5, w2: 20, wh: 2, hf: 10.5, hm: 11, hc: 12, tap: 8.5, As: 58 },
  { d: 'M12', dn: 12, p: 1.75, s: 18, k: 7.5, e: 20.03, m: 10.8, dk: 18, ks: 12, w1: 13, w2: 24, wh: 2.5, hf: 13, hm: 13.5, hc: 14.5, tap: 10.2, As: 84.3 },
  { d: 'M14', dn: 14, p: 2, s: 21, k: 8.8, e: 23.36, m: 12.8, dk: 21, ks: 14, w1: 15, w2: 28, wh: 2.5, hf: 15, hm: 15.5, hc: 16.5, tap: 12, As: 115 },
  { d: 'M16', dn: 16, p: 2, s: 24, k: 10, e: 26.75, m: 14.8, dk: 24, ks: 16, w1: 17, w2: 30, wh: 3, hf: 17, hm: 17.5, hc: 18.5, tap: 14, As: 157 },
  { d: 'M20', dn: 20, p: 2.5, s: 30, k: 12.5, e: 33.53, m: 18, dk: 30, ks: 20, w1: 21, w2: 37, wh: 3, hf: 21, hm: 22, hc: 24, tap: 17.5, As: 245 },
  { d: 'M24', dn: 24, p: 3, s: 36, k: 15, e: 39.98, m: 21.5, dk: 36, ks: 24, w1: 25, w2: 44, wh: 4, hf: 25, hm: 26, hc: 28, tap: 21, As: 353 },
  { d: 'M27', dn: 27, p: 3, s: 41, k: 17, e: 45.2, m: 23.8, dk: 40, ks: 27, w1: 28, w2: 50, wh: 4, hf: 28, hm: 30, hc: 32, tap: 24, As: 459 },
  { d: 'M30', dn: 30, p: 3.5, s: 46, k: 18.7, e: 50.85, m: 25.6, dk: 45, ks: 30, w1: 31, w2: 56, wh: 4, hf: 31, hm: 33, hc: 35, tap: 26.5, As: 561 },
  { d: 'M36', dn: 36, p: 4, s: 55, k: 22.5, e: 60.79, m: 31, dk: 54, ks: 36, w1: 37, w2: 66, wh: 5, hf: 37, hm: 39, hc: 42, tap: 32, As: 817 },
];
export const threadBy = (d: string) => THREADS.find((t) => t.d === d) ?? THREADS[4];
export const BOLT_LENGTHS = [6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200, 220, 240, 260, 280, 300];

/** Property classes (ISO 898-1): yield / ultimate MPa */
export const BOLT_CLASSES: Record<string, { Sy: number; Su: number }> = {
  '4.6': { Sy: 240, Su: 400 }, '5.6': { Sy: 300, Su: 500 }, '8.8': { Sy: 640, Su: 800 }, '10.9': { Sy: 940, Su: 1040 }, '12.9': { Sy: 1100, Su: 1220 },
  'A2-70': { Sy: 450, Su: 700 }, 'A4-80': { Sy: 600, Su: 800 },
};

/* ---------------- Content Center catalog ---------------- */
export interface CCFamily {
  id: string; path: string[]; name: string; standard: string;
  params: { key: string; label: string; options?: (string | number)[]; default: string | number; unit?: string }[];
  describe: (p: Record<string, any>) => string;
}

export const CC_FAMILIES: CCFamily[] = [
  {
    id: 'iso4017', path: ['Fasteners', 'Bolts', 'Hex Head'], name: 'ISO 4017', standard: 'ISO 4017 Hexagon head screw',
    params: [{ key: 'size', label: 'Thread Description', options: THREADS.map((t) => t.d), default: 'M8' }, { key: 'L', label: 'Nominal Length', options: BOLT_LENGTHS, default: 30, unit: 'mm' }],
    describe: (p) => `ISO 4017 - ${p.size} x ${p.L}`,
  },
  {
    id: 'iso4014', path: ['Fasteners', 'Bolts', 'Hex Head'], name: 'ISO 4014', standard: 'ISO 4014 Hexagon head bolt (partial thread)',
    params: [{ key: 'size', label: 'Thread Description', options: THREADS.map((t) => t.d), default: 'M10' }, { key: 'L', label: 'Nominal Length', options: BOLT_LENGTHS, default: 50, unit: 'mm' }],
    describe: (p) => `ISO 4014 - ${p.size} x ${p.L}`,
  },
  {
    id: 'iso4762', path: ['Fasteners', 'Bolts', 'Socket Head'], name: 'ISO 4762', standard: 'ISO 4762 Socket head cap screw',
    params: [{ key: 'size', label: 'Thread Description', options: THREADS.map((t) => t.d), default: 'M6' }, { key: 'L', label: 'Nominal Length', options: BOLT_LENGTHS, default: 20, unit: 'mm' }],
    describe: (p) => `ISO 4762 - ${p.size} x ${p.L}`,
  },
  {
    id: 'iso4032', path: ['Fasteners', 'Nuts', 'Hex'], name: 'ISO 4032', standard: 'ISO 4032 Hexagon nut',
    params: [{ key: 'size', label: 'Thread Description', options: THREADS.map((t) => t.d), default: 'M8' }],
    describe: (p) => `ISO 4032 - ${p.size}`,
  },
  {
    id: 'iso7089', path: ['Fasteners', 'Washers', 'Plain'], name: 'ISO 7089', standard: 'ISO 7089 Plain washer',
    params: [{ key: 'size', label: 'Nominal Diameter', options: THREADS.map((t) => t.d), default: 'M8' }],
    describe: (p) => `ISO 7089 - ${p.size.replace('M', '')}`,
  },
  {
    id: 'iso2338', path: ['Fasteners', 'Pins', 'Dowel'], name: 'ISO 2338', standard: 'ISO 2338 Parallel pin',
    params: [{ key: 'd', label: 'Diameter', options: [2, 3, 4, 5, 6, 8, 10, 12, 16, 20], default: 6, unit: 'mm' }, { key: 'L', label: 'Length', options: [10, 12, 16, 20, 25, 30, 40, 50, 60, 80], default: 20, unit: 'mm' }],
    describe: (p) => `ISO 2338 - ${p.d} m6 x ${p.L}`,
  },
  {
    id: 'iso2341', path: ['Fasteners', 'Pins', 'Clevis'], name: 'ISO 2341 B', standard: 'ISO 2341 Clevis pin with head',
    params: [{ key: 'd', label: 'Diameter', options: [5, 6, 8, 10, 12, 16, 20, 24, 30], default: 10, unit: 'mm' }, { key: 'L', label: 'Length', options: [16, 20, 25, 30, 40, 50, 60, 80, 100], default: 40, unit: 'mm' }],
    describe: (p) => `ISO 2341 B - ${p.d} x ${p.L}`,
  },
  {
    id: 'profile', path: ['Structural Shapes'], name: 'Structural Shape', standard: 'Steel structural shape',
    params: [{ key: 'family', label: 'Family', default: 'DIN 1025-5 (IPE)' }, { key: 'size', label: 'Size', default: 'IPE 200' }, { key: 'L', label: 'Length', default: 1000, unit: 'mm' }],
    describe: (p) => `${p.family} - ${p.size} - ${p.L}`,
  },
];
