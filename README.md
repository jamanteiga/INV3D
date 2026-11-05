# INV3D

CAD paramétrico 3D libre en el navegador, con el flujo de trabajo de Autodesk Inventor.
Núcleo geométrico OpenCascade (vía [replicad](https://replicad.xyz)), visor Three.js, interfaz React.

## Versión 0.5

| Entorno | Qué hace |
| --- | --- |
| **Boceto 2D** | Línea, círculo (centro / 3 puntos), arco (3 puntos / centro / tangente), rectángulo (2 puntos / 3 puntos / centro), ranura, polígono, elipse, spline, punto, texto. **Restricciones geométricas** (coincidente, colineal, concéntrica, fija, paralela, perpendicular, horizontal, vertical, tangente, punto medio, simétrica, igual), aplicadas también solas al forzar el cursor. **Cotas** como restricciones (lineal, horizontal, vertical, radio, diámetro, ángulo, punto-línea, entre paralelas) con parámetros `d0, d1…` y expresiones, cotas de referencia. Grados de libertad y color de geometría totalmente restringida. Arrastre de puntos y curvas resuelto por el solver. Recortar, alargar, desfase, empalme y chaflán 2D, simetría, patrones, mover, copiar, girar, escalar y proyectar geometría del modelo |
| **Pieza** | Extrusión (distancia, a través de todo, dos direcciones, inclinación), revolución, solevación, barrido, nervio, bobina (muelles), relieve/grabado de texto, agujero (simple, refrentado, avellanado, roscado), empalme, chaflán, vaciado, inclinación de caras (desmoldeo), rosca cosmética, dividir, engrosar, patrón rectangular y circular (también sobre eje de trabajo), simetría, planos, ejes y puntos de trabajo, importar STEP. Parámetros fx, iProperties, masa, CdG y medición |
| **Chapa** | Estilo (t, R, K), cara, pestaña, **pestaña de contorno**, **dobladillo**, redondeo y chaflán de esquina, corte, **punzonado** (redondo, rectangular, colisa, cuadrado), desarrollo con líneas de pliegue y DXF para corte |
| **Ensamblaje** | Colocar, crear pieza, mover/girar con gizmo, fijar. **Restricciones** coincidir (caras o ejes), al ras, ángulo, tangente, insertar y rígida; **uniones** de rotación, corredera, cilíndrica, planar y bola (con bloqueo, **límites de recorrido** y **conducir** para animar mecanismos); **restricciones de movimiento** rotación-rotación (engranajes) y rotación-traslación (piñón-cremallera), resueltas a la vez (Gauss-Newton) con grados de libertad por componente. **Centro de contenido** (ISO 4017, ISO 4762, ISO 4032, ISO 7089, ISO 2338, rodamientos 60/62, chavetas DIN 6885). **Patrón de componentes** y **simetría de componente** asociativos, **sustituir componente**, **representaciones de vista**, análisis de interferencias, vista de corte 3D, lista de materiales y STEP |
| **Estructura** | Perfiles EN: IPE, HEA, HEB, UPN, L, SHS, RHS, CHS, pletina, redondo. Inglete, recortar/alargar, longitudes y ángulos de corte en la lista de materiales |
| **Soldadura** | Cordón en ángulo entre dos caras, garganta *a*, símbolo ISO 2553 |
| **Tornillería** | Conexión atornillada con taladros y cálculo EN 1993-1-8 |
| **Dibujo** | **Varias hojas**, vista base con escala automática, proyectadas (4 lados) e isométrica, **sección con rayado**, **detalle**, **auxiliar**, **partida**, **recortada**, **desarrollo de chapa** con tabla de pliegues, aristas ocultas, marcas de centro automáticas. **Cotas recuperadas del modelo** (asociativas: siguen los cambios de la pieza), cotas lineales, **desde línea base**, **por coordenadas**, de radio, diámetro y ángulo con tolerancias (±, H7…), **tolerancias geométricas ISO 1101** y símbolos de referencia, **tabla de taladros**, **tabla de revisiones**, cajetín ampliado (tolerancias generales, acabado, aprobado, masa, hoja n/N), notas de taladro/rosca, marcas y líneas de centro, texto con directriz, acabado superficial, símbolo de soldadura, globos y lista de piezas. **Gestor de estilos ISO / DIN / ANSI** (cotas, flechas, decimales, unidades, grosores, primer o tercer diedro). Exporta DXF (capas ISO), PDF de varias páginas y SVG |
| **Exportar** | STEP, STL, **3MF** (impresión 3D), **OBJ** y **glTF (.glb)** |
| **Configuración** | Se recuerda al entrar: ajustes (usuario, empresa, material, norma, hoja), materiales propios, proyecto, recientes y los documentos abiertos (autoguardado). **Carpeta de trabajo** local recordada (Chrome/Edge): Ctrl+S guarda en ella y la configuración se copia en `inv3d-config.json` para llevarla a otro PC. Archivo › Opciones de la aplicación |
| **Presentación** | Explosionado automático o manual, animación y vídeo WebM |
| **Inventor** | Proyectos `.ipj`, miniatura y propiedades de `.ipt/.iam/.idw/.ipn`, visor `.dwg` (LibreDWG) y `.dxf`, regla iLogic de exportación a STEP/DWG |

Visualización nítida: supermuestreo en monitores 1x, aristas con grosor real en píxeles, mallado con tolerancia angular de 3,4°, iconos a color y planos con grosor de línea constante en pantalla.

Ejemplos en **Herramientas › Ejemplos**: brida paramétrica y escalera con meseta.

### Límites conocidos

- La geometría de `.ipt/.iam/.idw` está en un formato cerrado de Autodesk: hay que exportarla a STEP/DWG (regla iLogic incluida).
- Perfiles de boceto: lazos de líneas, arcos y splines unidos por sus extremos; las líneas que se cruzan hay que recortarlas.
- IGES no está disponible: la versión de OpenCascade para web no incluye ese módulo (usa STEP).
- La carpeta de trabajo necesita Chrome o Edge en escritorio abriendo la web directamente; el navegador pide un clic de «Reconectar» en cada sesión.
- Desarrollo de chapa: pestañas sobre la cara base o una pestaña de contorno; los punzonados no aparecen en el desarrollo.
- Uniones: el origen es el centro de la cara elegida (o el eje del cilindro); no hay límites de recorrido.

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
