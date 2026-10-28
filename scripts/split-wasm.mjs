// Parte el WASM de OpenCascade en trozos < 12 MB (límite de alojamiento) y genera un manifiesto.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
const src = 'node_modules/replicad-opencascadejs/dist/replicad_single.wasm';
const out = 'public/oc';
const CHUNK = 12 * 1024 * 1024;
const buf = readFileSync(src);
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) unlinkSync(`${out}/${f}`);
const parts = [];
for (let i = 0, n = 0; i < buf.length; i += CHUNK, n++) {
  const name = `occt.part${n}.wasm`;
  writeFileSync(`${out}/${name}`, buf.subarray(i, i + CHUNK));
  parts.push(name);
}
writeFileSync(`${out}/manifest.json`, JSON.stringify({ size: buf.length, parts }));
console.log(`OpenCascade WASM: ${buf.length} bytes en ${parts.length} trozos`);

// Visor DWG (LibreDWG, GPL-3.0): se copia el WASM junto a la aplicación
import { copyFileSync } from 'node:fs';
mkdirSync('public/dwg', { recursive: true });
copyFileSync('node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm', 'public/dwg/libredwg-web.wasm');
console.log('LibreDWG WASM copiado');
