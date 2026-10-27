// El WASM se sirve partido desde dist/oc/; se elimina la copia completa que emite Vite.
import { readdirSync, unlinkSync } from 'node:fs';
for (const f of readdirSync('dist/assets')) if (f.endsWith('.wasm')) { unlinkSync(`dist/assets/${f}`); console.log('eliminado', f); }
