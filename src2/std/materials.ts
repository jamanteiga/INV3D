// Material library (Inventor Material Library naming). Units: density kg/m³, E/Sy/Su MPa.
export interface Material { name: string; density: number; E: number; nu: number; Sy: number; Su: number; color: string; category: string }

export const MATERIALS: Material[] = [
  { name: 'Generic', density: 1000, E: 1000, nu: 0.3, Sy: 1, Su: 1, color: '#c8ccd2', category: 'Other' },
  { name: 'Steel', density: 7850, E: 210000, nu: 0.3, Sy: 207, Su: 345, color: '#b6bcc4', category: 'Metal' },
  { name: 'Steel, Mild', density: 7850, E: 220000, nu: 0.275, Sy: 207, Su: 345, color: '#b0b6be', category: 'Metal' },
  { name: 'Steel S235JR', density: 7850, E: 210000, nu: 0.3, Sy: 235, Su: 360, color: '#b4bac2', category: 'Metal' },
  { name: 'Steel S275JR', density: 7850, E: 210000, nu: 0.3, Sy: 275, Su: 430, color: '#b2b8c0', category: 'Metal' },
  { name: 'Steel S355J2', density: 7850, E: 210000, nu: 0.3, Sy: 355, Su: 510, color: '#adb3bb', category: 'Metal' },
  { name: 'Steel, Alloy (42CrMo4)', density: 7850, E: 210000, nu: 0.3, Sy: 650, Su: 900, color: '#9fa6ae', category: 'Metal' },
  { name: 'Steel, Galvanized', density: 7850, E: 200000, nu: 0.29, Sy: 207, Su: 345, color: '#c7ccd1', category: 'Metal' },
  { name: 'Stainless Steel AISI 304', density: 8000, E: 193000, nu: 0.29, Sy: 215, Su: 505, color: '#d2d6db', category: 'Metal' },
  { name: 'Stainless Steel AISI 316L', density: 8000, E: 193000, nu: 0.3, Sy: 170, Su: 485, color: '#d6dade', category: 'Metal' },
  { name: 'Aluminum 6061', density: 2700, E: 68900, nu: 0.33, Sy: 275, Su: 310, color: '#dfe3e7', category: 'Metal' },
  { name: 'Aluminum 5083', density: 2660, E: 71000, nu: 0.33, Sy: 145, Su: 290, color: '#dbe0e4', category: 'Metal' },
  { name: 'Aluminum 6082-T6', density: 2700, E: 70000, nu: 0.33, Sy: 260, Su: 310, color: '#dde1e6', category: 'Metal' },
  { name: 'Iron, Gray (EN-GJL-250)', density: 7200, E: 110000, nu: 0.26, Sy: 165, Su: 250, color: '#8c9198', category: 'Metal' },
  { name: 'Iron, Ductile (EN-GJS-400)', density: 7100, E: 169000, nu: 0.275, Sy: 250, Su: 400, color: '#92979e', category: 'Metal' },
  { name: 'Brass, Soft Yellow', density: 8470, E: 109600, nu: 0.331, Sy: 103, Su: 338, color: '#d8b75e', category: 'Metal' },
  { name: 'Bronze, Soft Tin', density: 8800, E: 110000, nu: 0.34, Sy: 150, Su: 280, color: '#b9874d', category: 'Metal' },
  { name: 'Copper', density: 8930, E: 110000, nu: 0.34, Sy: 69, Su: 220, color: '#c8835a', category: 'Metal' },
  { name: 'Titanium Ti-6Al-4V', density: 4430, E: 113800, nu: 0.342, Sy: 880, Su: 950, color: '#a8a9ad', category: 'Metal' },
  { name: 'ABS Plastic', density: 1060, E: 2240, nu: 0.38, Sy: 20, Su: 29.6, color: '#e9e5da', category: 'Plastic' },
  { name: 'Nylon-6/6', density: 1140, E: 2760, nu: 0.39, Sy: 82.8, Su: 82.8, color: '#efece2', category: 'Plastic' },
  { name: 'Polycarbonate', density: 1200, E: 2410, nu: 0.39, Sy: 62, Su: 65, color: '#c5d8e4', category: 'Plastic' },
  { name: 'PVC', density: 1400, E: 3000, nu: 0.38, Sy: 45, Su: 50, color: '#9fb4c7', category: 'Plastic' },
  { name: 'Polyethylene HD', density: 950, E: 1070, nu: 0.42, Sy: 26, Su: 33, color: '#ecece6', category: 'Plastic' },
  { name: 'Rubber', density: 1190, E: 10, nu: 0.49, Sy: 14, Su: 14, color: '#2b2d30', category: 'Other' },
  { name: 'Wood (Pine)', density: 500, E: 9000, nu: 0.3, Sy: 40, Su: 40, color: '#caa472', category: 'Other' },
  { name: 'Glass', density: 2580, E: 70000, nu: 0.22, Sy: 45, Su: 45, color: '#cfe3ea', category: 'Other' },
  { name: 'Concrete', density: 2400, E: 30000, nu: 0.2, Sy: 3, Su: 30, color: '#a8a6a0', category: 'Other' },
];

export const matByName = (n: string) => MATERIALS.find((m) => m.name === n) ?? MATERIALS[2];

export interface Appearance { name: string; color: string; metalness: number; roughness: number; opacity?: number }
export const APPEARANCES: Appearance[] = [
  { name: 'As Material', color: '', metalness: 0.3, roughness: 0.5 },
  { name: 'Default', color: '#c8ccd2', metalness: 0.1, roughness: 0.6 },
  { name: 'Smooth - Red', color: '#c0392b', metalness: 0.05, roughness: 0.4 },
  { name: 'Smooth - Blue', color: '#2d6db4', metalness: 0.05, roughness: 0.4 },
  { name: 'Smooth - Green', color: '#3f8f4a', metalness: 0.05, roughness: 0.4 },
  { name: 'Smooth - Yellow', color: '#e3b51d', metalness: 0.05, roughness: 0.4 },
  { name: 'Smooth - Orange', color: '#e07a1f', metalness: 0.05, roughness: 0.4 },
  { name: 'Smooth - Black', color: '#25272a', metalness: 0.05, roughness: 0.45 },
  { name: 'Smooth - White', color: '#f2f2f0', metalness: 0.02, roughness: 0.5 },
  { name: 'Aluminum - Polished', color: '#e3e6ea', metalness: 0.9, roughness: 0.2 },
  { name: 'Chrome - Polished', color: '#eef0f3', metalness: 1, roughness: 0.08 },
  { name: 'Steel - Satin', color: '#aab0b8', metalness: 0.75, roughness: 0.35 },
  { name: 'Zinc', color: '#b8bfc6', metalness: 0.7, roughness: 0.4 },
  { name: 'Powder Coat - Gray RAL 7035', color: '#d7d7d7', metalness: 0.05, roughness: 0.7 },
  { name: 'Powder Coat - Blue RAL 5010', color: '#0e4c92', metalness: 0.05, roughness: 0.7 },
  { name: 'Glass - Clear', color: '#d8eaf2', metalness: 0, roughness: 0.05, opacity: 0.35 },
];
