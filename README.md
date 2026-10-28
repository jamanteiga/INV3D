# INV3D

CAD paramétrico 3D libre en el navegador, con el flujo de trabajo de Autodesk Inventor.
Núcleo geométrico OpenCascade (vía [replicad](https://replicad.xyz)), visor Three.js, interfaz React.

## Versión 0.2

| Entorno | Qué hace |
| --- | --- |
| **Boceto 2D** | Línea (cadena; al cerrar crea contorno), círculo, arco, rectángulo, ranura, polígono, punto, construcción. Cotas editables con doble clic y expresiones (`L/2`). Boceto en plano de origen, plano de trabajo o cara plana |
| **Pieza** | Extrusión, revolución, solevación, barrido, agujero (simple, refrentado, avellanado, roscado), empalme, chaflán, vaciado, patrón rectangular y circular, simetría, planos de trabajo, importar STEP. Parámetros fx, iProperties, masa y CdG |
| **Chapa** | Estilo (t, R, K), cara, pestaña sobre arista elegida en pantalla, desarrollo con líneas de pliegue y DXF para corte |
| **Ensamblaje** | Colocar, crear pieza en contexto, mover/girar con gizmo, fijar, uniones coincidente / al ras / rígida, líneas de esqueleto 3D, lista de materiales (CSV), STEP de ensamblaje |
| **Estructura** | Perfiles EN: IPE, HEA, HEB, UPN, L, SHS, RHS, CHS, pletina, redondo. Insertar sobre líneas de esqueleto o de bocetos, giro, desfase, simetría, inglete automático, recortar/alargar a la cara de otra barra, longitudes y ángulos de corte en la lista de materiales |
| **Soldadura** | Cordón en ángulo entre dos caras que forman rincón, garganta *a*, símbolo ISO 2553, longitud y masa de aporte |
| **Tornillería** | Conexión atornillada ISO 4017 + ISO 4032 + ISO 7089, filas y columnas, espesor apretado automático, longitud comercial, taladros en los componentes (EN 1090-2). Cálculo EN 1993-1-8: cortadura, aplastamiento, tracción, punzonamiento e interacción |
| **Dibujo** | Hojas A4–A1 con marco y cajetín, vista base, proyectadas (proyección europea), isométrica, aristas ocultas, cotas, notas, lista de piezas. Exporta DXF, PDF y SVG |
| **Presentación** | Explosionado automático o manual, animación y grabación de vídeo WebM |
| **Inventor** | Lee proyectos `.ipj`, miniatura y propiedades de `.ipt/.iam/.idw/.ipn`, visor `.dwg` (LibreDWG) y `.dxf`. Regla iLogic para exportar un proyecto completo a STEP/DWG. Un STEP de varios sólidos se abre como ensamblaje |

Ejemplos en **Herramientas › Ejemplos**: brida paramétrica y escalera con meseta (perfiles, ingletes, recortes, placas base y cordones).

### Límites conocidos

- La geometría de `.ipt/.iam/.idw` está en un formato cerrado de Autodesk: hay que exportarla a STEP/DWG (regla iLogic incluida en **Herramientas › Regla de exportación**).
- El boceto aún no tiene restricciones geométricas (paralela, tangente…): solo cotas y expresiones.
- Las uniones se resuelven en orden, no con un solver simultáneo.
- Desarrollo de chapa: pestañas sobre la cara base (no pestañas sobre pestañas).

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # genera dist/
```

`scripts/split-wasm.mjs` parte el WASM de OpenCascade (23 MB) en trozos de 12 MB en `public/oc/` y copia el de LibreDWG a `public/dwg/`.

## Despliegue en GitHub Pages

1. **Settings › Pages › Build and deployment › Source: GitHub Actions**.
2. Cada `push` a `main` ejecuta `.github/workflows/pages.yml` y publica `dist/`.

## Estructura

```
src/core/        modelo de datos (pieza, ensamblaje, plano), catálogos EN/ISO, cálculo EC3, E/S, DXF
src/worker/      núcleo OpenCascade: pieza y chapa (part.ts), ensamblaje y estructura (asm.ts)
src/ui/          cinta, navegador, visores 3D (pieza, ensamblaje), plano, paneles y diálogos
```

## Licencia

GPL-3.0-or-later, por el visor DWG (LibreDWG). Sin él (`src/core/files.ts`, función `dwgInfo`), el resto es compatible con LGPL-2.1 (OpenCascade, replicad).
