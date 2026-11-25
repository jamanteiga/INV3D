import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// Acceso para depuración y pruebas automatizadas
import { useStore } from './core/store';
(window as unknown as { __inv3d: typeof useStore }).__inv3d = useStore;

import { initSpaceMouse } from './ui/spacemouse';
initSpaceMouse();

import { initSession } from './ui/session';
initSession();
import { cad } from './core/cadClient';
(window as unknown as { __cad: typeof cad }).__cad = cad;
import('./core/epoints').then((m) => { (window as unknown as { __ep: unknown }).__ep = m.partEPoints; });
import './ui/rules';
import { loadUserProfiles, registerUserContent } from './ui/Panels2';
loadUserProfiles(); registerUserContent();
import('./core/fdp').then((m) => { const r = m.recallProject(); if (r) m.activateProject(r.p, r.fileName); });
// utilidades de prueba
void Promise.all([import('./ui/hvacroute'), import('./core/hvac'), import('./core/spiro')]).then(([r, h, sp]) => { (window as unknown as { __route: unknown }).__route = { ...r, makeHvacPart: h.makeHvacPart, makeSpiroPart: sp.makeSpiroPart }; });
