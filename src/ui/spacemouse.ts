// Ratón 3D 3Dconnexion (SpaceMouse, SpaceNavigator, SpacePilot…) por WebHID (Chrome y Edge),
// con la API Gamepad como alternativa. Envía 6 ejes normalizados al visor 3D activo.
import { activeView } from './view3d';
import { useStore } from '../core/store';

export interface SmSettings { speed: number; invT: boolean; invZoom: boolean; invR: boolean; lockRot: boolean; lockPan: boolean }
const KEY = 'inv3d.spacemouse';
export function loadSettings(): SmSettings {
  const d: SmSettings = { speed: 1, invT: false, invZoom: false, invR: false, lockRot: false, lockPan: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return d; }
}
export function saveSettings(s: SmSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sin almacenamiento */ } }

type HIDDev = { opened: boolean; productName: string; vendorId: number; open: () => Promise<void>; addEventListener: (t: string, f: (e: any) => void) => void; removeEventListener: (t: string, f: (e: any) => void) => void };
const hid = (navigator as any).hid as undefined | { requestDevice: (o: object) => Promise<HIDDev[]>; getDevices: () => Promise<HIDDev[]>; addEventListener: (t: string, f: (e: any) => void) => void };

export const SM_FILTERS = [{ vendorId: 0x256f }, { vendorId: 0x046d, usagePage: 0x01, usage: 0x08 }];
const FULL = 350; // escala típica de los ejes en bruto

let t = [0, 0, 0], r = [0, 0, 0], buttons = 0;
let device: HIDDev | null = null;
let settings = loadSettings();
export const smState = { name: '', mode: '' as '' | 'hid' | 'gamepad' };

function push() {
  const v = activeView; if (!v) return;
  const s = settings, kt = s.invT ? -1 : 1, kr = s.invR ? -1 : 1;
  v.navSpeed = s.speed;
  const tt = [(t[0] / FULL) * kt, (t[1] / FULL) * (s.invZoom ? -1 : 1), (t[2] / FULL) * kt];
  v.setNav(s.lockPan ? [0, tt[1], 0] : tt, s.lockRot ? [0, 0, 0] : r.map((x) => (x / FULL) * kr));
}
function onButtons(b: number) {
  const pressed = b & ~buttons; buttons = b;
  const st = useStore.getState();
  if (pressed & 1) st.setView('home');   // botón izquierdo: vista de inicio
  if (pressed & 2) st.setView('fit');    // botón derecho: ajustar
}
function onReport(e: { reportId: number; data: DataView }) {
  const d = e.data, i16 = (o: number) => (d.byteLength >= o + 2 ? d.getInt16(o, true) : 0);
  if (e.reportId === 1) {
    t = [i16(0), i16(2), i16(4)];
    if (d.byteLength >= 12) r = [i16(6), i16(8), i16(10)]; // modelos modernos: los 6 ejes en un informe
    push();
  } else if (e.reportId === 2) { r = [i16(0), i16(2), i16(4)]; push(); }
  else if (e.reportId === 3) onButtons(d.byteLength >= 2 ? d.getUint16(0, true) : d.getUint8(0));
}

async function attach(dev: HIDDev) {
  if (!dev.opened) await dev.open();
  device?.removeEventListener('inputreport', onReport);
  device = dev;
  dev.addEventListener('inputreport', onReport);
  smState.name = dev.productName || '3Dconnexion'; smState.mode = 'hid';
  useStore.setState({ spaceMouse: smState.name });
}

export const webHidAvailable = () => !!hid;

/** Pide permiso y conecta (requiere un clic del usuario). */
export async function connectSpaceMouse() {
  const st = useStore.getState();
  if (!hid) { st.notify('Este navegador no admite WebHID: usa Chrome o Edge en escritorio', 'error'); return; }
  try {
    const devs = await hid.requestDevice({ filters: SM_FILTERS });
    if (!devs.length) return;
    await attach(devs[0]);
    st.notify(`${smState.name} conectado`);
  } catch (e) {
    const msg = (e as Error).message || '';
    st.notify(/permission|policy|disallowed/i.test(msg) ? 'El acceso a dispositivos HID está bloqueado en esta página (ábrela directamente, no incrustada)' : `No se pudo abrir el ratón 3D: ${msg}`, 'error');
  }
}

/** Reconexión automática a dispositivos ya autorizados y sondeo de mandos (Gamepad). */
export function initSpaceMouse() {
  if (hid) {
    hid.getDevices().then((ds) => { const d = ds.find((x) => x.vendorId === 0x256f || x.vendorId === 0x046d); if (d) attach(d).catch(() => {}); }).catch(() => {});
    hid.addEventListener('disconnect', (e: any) => { if (e.device === device) { device = null; smState.name = ''; smState.mode = ''; useStore.setState({ spaceMouse: '' }); } });
  }
  // Firefox / Linux: el ratón 3D aparece como mando con 6 ejes
  const poll = () => {
    requestAnimationFrame(poll);
    if (smState.mode === 'hid') return;
    const pads = (navigator.getGamepads?.() ?? []).filter(Boolean) as Gamepad[];
    const g = pads.find((p) => /3dconnexion|space ?(mouse|navigator|pilot|explorer)|256f/i.test(p.id));
    if (!g) { if (smState.mode === 'gamepad') { smState.mode = ''; smState.name = ''; useStore.setState({ spaceMouse: '' }); } return; }
    if (smState.mode !== 'gamepad') { smState.mode = 'gamepad'; smState.name = g.id.replace(/\(.*?\)/g, '').trim() || 'SpaceMouse'; useStore.setState({ spaceMouse: smState.name }); }
    const a = g.axes;
    t = [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0].map((x) => x * FULL);
    r = [a[3] ?? 0, a[4] ?? 0, a[5] ?? 0].map((x) => x * FULL);
    if (t.some((x) => Math.abs(x) > 5) || r.some((x) => Math.abs(x) > 5)) push();
    onButtons(g.buttons.reduce((m, b, i) => (b.pressed ? m | (1 << i) : m), 0));
  };
  requestAnimationFrame(poll);
}

export function setSmSettings(s: SmSettings) { settings = s; saveSettings(s); }
export const getSmSettings = () => settings;
