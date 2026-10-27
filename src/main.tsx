import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// Acceso para depuración y pruebas automatizadas
import { useStore } from './core/store';
(window as unknown as { __inv3d: typeof useStore }).__inv3d = useStore;
