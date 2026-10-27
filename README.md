# INV3D

CAD paramétrico 3D libre en el navegador, con el flujo de trabajo de Autodesk Inventor.
Núcleo geométrico OpenCascade (vía [replicad](https://replicad.xyz)), visor Three.js, interfaz React.

## Estado: fase F0 (MVP)

| Área | Incluido |
| --- | --- |
| Boceto 2D | Línea (cadena; al cerrar crea un contorno), rectángulo, círculo, polígono regular, líneas de construcción, cotas editables con doble clic, enganche a puntos y rejilla, boceto en plano de origen (con desfase) o en cara plana |
| Pieza | Extrusión (normal, inversa, simétrica), revolución (eje X/Y del boceto o línea), empalme y chaflán (aristas seleccionadas en pantalla o por filtro), unir / cortar / intersección / nuevo sólido |
| Paramétrico | Tabla de parámetros fx con unidades y funciones; cualquier cota admite expresiones (`L/2`, `2*e + 5 mm`) |
| Árbol | Navegador con bocetos anidados, editar, renombrar, suprimir, eliminar; errores marcados en rojo |
| Propiedades | iProperties, material, masa, volumen, área, centro de gravedad |
| Ficheros | `.i3p` propio (JSON), importar/exportar STEP, exportar STL, abrir/crear `.ipj`, metadatos y miniatura de `.ipt/.iam/.idw/.ipn`, versión de `.dwg` |

Atajos: `S` boceto, `L` `R` `C` `P` herramientas de boceto, `E` extrusión, `R` revolución, `F` empalme, `Esc`, `Supr`, `Ctrl+Z/Y/S/O`, `F6` inicio.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # genera dist/
```

`scripts/split-wasm.mjs` parte el WASM de OpenCascade (23 MB) en trozos de 12 MB dentro de `public/oc/`; el worker los recompone al cargar. Así cabe en alojamientos con límite por fichero.

## Despliegue en GitHub Pages

1. Crea el repositorio y sube el código a la rama `main`.
2. En GitHub: **Settings › Pages › Build and deployment › Source: GitHub Actions**.
3. Cada `push` a `main` ejecuta `.github/workflows/pages.yml` y publica `dist/`.

## Compatibilidad con Inventor

Los `.ipt/.iam/.idw/.ipn` guardan la geometría en un formato cerrado de Autodesk; no se pueden reconstruir. Flujo recomendado: en Inventor, **Archivo › Exportar › Formato CAD › STEP**, y abrir el `.stp` en INV3D.

## Estructura

```
src/core/expr.ts        evaluador de expresiones y parámetros
src/core/doc.ts         modelo de datos .i3p
src/core/store.ts       estado (Zustand), deshacer/rehacer, regeneración
src/core/files.ts       E/S: .i3p, STEP, STL, .ipj, OLE de Inventor
src/worker/cad.worker.ts núcleo OpenCascade en Web Worker
src/ui/                 cinta, navegador, visor 3D + boceto, paneles
```

## Licencia

LGPL-2.1-or-later (compatible con OpenCascade y replicad).
