# INV3D

CAD paramétrico 3D libre en el navegador, con el flujo de trabajo de Autodesk Inventor.
Núcleo geométrico OpenCascade (vía [replicad](https://replicad.xyz)), visor Three.js, interfaz React.

## Versión 0.12

| Entorno | Qué hace |
| --- | --- |
| **Boceto 2D** | Línea, círculo (centro / 3 puntos), arco (3 puntos / centro / tangente), rectángulo (2 puntos / 3 puntos / centro), ranura, polígono, elipse, spline, punto, texto. **Restricciones geométricas** (coincidente, colineal, concéntrica, fija, paralela, perpendicular, horizontal, vertical, tangente, punto medio, simétrica, igual), aplicadas también solas al forzar el cursor. **Cotas** como restricciones (lineal, horizontal, vertical, radio, diámetro, ángulo, punto-línea, entre paralelas) con parámetros `d0, d1…` y expresiones, cotas de referencia. Grados de libertad y color de geometría totalmente restringida. Arrastre de puntos y curvas resuelto por el solver. Recortar, alargar, desfase, empalme y chaflán 2D, simetría, patrones, mover, copiar, girar, escalar y proyectar geometría del modelo |
| **Pieza** | Extrusión (distancia, a través de todo, dos direcciones, inclinación), revolución, solevación, barrido, nervio, bobina (muelles), relieve/grabado de texto, agujero (simple, refrentado, avellanado, roscado), empalme, chaflán, vaciado, inclinación de caras (desmoldeo), rosca cosmética, dividir, engrosar, patrón rectangular y circular (también sobre eje de trabajo), simetría, planos, ejes y puntos de trabajo, importar STEP. Parámetros fx, iProperties, masa, CdG y medición |
| **Superficies** | Superficie extruida, de revolución y solevada/reglada, **parche** (contorno plano o 3D), **coser** (si cierran volumen pasa a sólido), engrosar superficie. Se muestran translúcidas |
| **Boceto 3D** | Líneas, splines y hélices en el espacio con expresiones; trayectorias de barrido y contornos de parche |
| **iPart / iFeature** | Tabla de familia de piezas (activar fila, generar miembros .i3p); extraer e insertar operaciones reutilizables con sus cotas como parámetros (biblioteca propia y ficheros .i3f) |
| **Chapa** | Estilo (t, R, K) con **biblioteca de estilos**, **pestaña solevada** (transiciones rectangular-circular, reducciones) con **desarrollo por triangulación**, cara, pestaña, **pestaña de contorno**, **dobladillo**, redondeo y chaflán de esquina, corte, **punzonado** (redondo, rectangular, colisa, cuadrado), desarrollo con líneas de pliegue y DXF para corte |
| **Ensamblaje** | **Colocar (P)** como en Inventor: piezas abiertas, del disco (.i3p, STEP) o de la carpeta de trabajo; el primer componente queda fijo en el origen y las copias siguen al cursor (clic para soltar, X/Y/Z giran 90°, Esc termina). **Arrastre libre** de componentes no fijos (respeta sus grados de libertad), crear pieza, mover/girar con gizmo, fijar. **Subensamblajes** (.i3a dentro de .i3a, restringibles por las caras de sus piezas). **Edición en contexto** (doble clic o Ensamblar › Editar): la pieza se edita viendo el resto del ensamblaje, con bocetos sobre caras de otros componentes y proyección de sus aristas; **Crear** hace la pieza nueva en contexto. **Estados de modelo** (supresiones y posiciones). **Lista de materiales estructurada** o solo piezas, exportable a **Excel**. **Detección de colisiones al mover** (Inspeccionar). Las piezas colocadas se cargan **en memoria sin pestaña** (se abren con doble clic y se cierran sin afectar al ensamblaje). **Restringir (J)** o **clic derecho sobre una cara/eje** con **vista previa** y **Aplicar** para encadenar: coincidir (caras o ejes), al ras, ángulo, **perpendicular**, tangente, insertar, **simetría** y rígida, contra otra pieza, los **planos/ejes de origen** del ensamblaje o de cada componente y **planos de trabajo** del ensamblaje (se mueve siempre el componente libre); **uniones** de rotación, corredera, cilíndrica, planar y bola (con bloqueo, **límites de recorrido** y **conducir** para animar mecanismos); **restricciones de movimiento** rotación-rotación (engranajes) y rotación-traslación (piñón-cremallera), resueltas a la vez (Gauss-Newton) con grados de libertad por componente. **Centro de contenido** (ISO 4017, ISO 4762, ISO 4032, ISO 7089, ISO 2338, rodamientos 60/62, chavetas DIN 6885). **Patrón de componentes** y **simetría de componente** asociativos, **sustituir componente**, **representaciones de vista**, análisis de interferencias, vista de corte 3D, lista de materiales y STEP |
| **Mecánica · Tubería** | Pestaña **Mecánica** (pieza y ensamblaje). ASME: tubo B36.10M/B36.19M (todos los NPS y schedules), bridas **B16.5** (WN, SO, ciega, loca, socket weld, roscada; clases 150–2500), **B16.47 Serie A y B** (26"–60"), codos B16.9 radio largo y corto 45/90/180°, tes, tes reducidas, cruces, reducciones concéntricas y excéntricas, casquetes, portabridas, manguitos y medios manguitos B16.11 (3000/6000, roscados NPT y socket weld). EN: tubo EN 10220, bridas **EN 1092-1** tipos 01, 05, 11, 12 y 13 (PN 6 a PN 100), accesorios EN 10253. Materiales ASTM/ASME (A106, A53, API 5L, A333, A312, A234, A403, A105, A350, A182…) y EN (P235GH, P265GH, P250GH, 16Mo3, 1.4301, 1.4404, 1.4571, dúplex…). Cada pieza lleva designación, norma y material en las iProperties |
| **HVAC** | Pestaña **HVAC** con selector EN/UNE (EN 1505/1506) o SMACNA. **Red de conductos** (HVAC › Red): trazado con líneas 3D del esqueleto, caudales por terminal, dimensionado por velocidad o pérdida unitaria (espirotubo o rectangular), cálculo de pérdidas (fricción Colebrook + singulares), circuito índice, **equilibrado** de terminales, **ventilador** necesario, **ruido** regenerado (VDI 2081, orientativo) con silenciador recomendado, **aislamiento según RITE** (espesor mínimo, pérdidas y temperatura en terminales), **mediciones** (Excel y **BC3**), **generación automática** de tubos, codos, tes, reducciones y manguitos en el ensamblaje y **plano isométrico** con lista de piezas y tabla de tramos. **Espirotubo comercial** (HVAC › Espirotubo, o Sección › Espirotubo en Conducto, Codo, Transición, Derivación, Manguito, Tapa, Compuerta y Soporte): tubo espiral Ø80–1250 en longitudes de catálogo y accesorios con extremo macho (con o sin junta EPDM): codos de 15, 30, 45, 60 y 90° prensados o por gajos (R = 1·D o 1,5·D), te 90°, te 45°, cruz y toma de silla (también reducidas), reducciones concéntricas y excéntricas, manguitos macho y hembra, tapones, abrazadera de suspensión, compuerta de regulación y sombrerete, con espesores comerciales (orientativos) seleccionables. **Conductos** rectangulares, circulares, **helicoidales (espiral, EN 12237)** y **ovales planos**: tramo recto (bridas TDC, marco angular o enchufe), **manguito de unión** para espiral, codos con radio, rectos con álabes, prensados, por gajos y ovales, transiciones rectangular/circular/oval en cualquier combinación, reducciones (también excéntricas) y desvíos con **desarrollo para corte**, te, toma de zapato, collarín, derivación a 45°, pantalón, tapas y plenums. **Terminales y equipos**: rejillas, difusores cuadrados y circulares, compuertas de regulación, cortafuegos, silenciadores, flexibles, UTA y fancoil. **Uniones, soportes y aislamiento**: bridas/marcos, soportes en trapecio o abrazadera con varilla, aislamiento. Espesor de chapa automático (UNE/EN 1507, EN 12237, calibres SMACNA). **Dimensionado** por pérdida de carga constante o velocidad (Darcy-Weisbach, Colebrook-White, Huebscher), pérdidas singulares y exportación CSV |
| **Estructura** | Perfiles EN: IPE, HEA, HEB, UPN, L, SHS, RHS, CHS, pletina, redondo. Inglete, recortar/alargar, longitudes y ángulos de corte en la lista de materiales |
| **Soldadura** | Cordón en ángulo entre dos caras, garganta *a*, símbolo ISO 2553 |
| **Tornillería** | Conexión atornillada con taladros y cálculo EN 1993-1-8 |
| **Dibujo** | **Varias hojas**, vista base con escala automática, proyectadas (4 lados) e isométrica, **sección con rayado**, **detalle**, **auxiliar**, **partida**, **recortada**, **desarrollo de chapa** con tabla de pliegues, **sección escalonada** (línea quebrada), **corte parcial** (Break Out), aristas ocultas, marcas de centro automáticas. **Cotas recuperadas del modelo** (asociativas: siguen los cambios de la pieza), cotas lineales, **desde línea base**, **por coordenadas**, de radio, diámetro y ángulo con tolerancias (±, H7…), **tolerancias geométricas ISO 1101** y símbolos de referencia, **tabla de taladros**, **tabla de revisiones**, cajetín ampliado (tolerancias generales, acabado, aprobado, masa, hoja n/N), notas de taladro/rosca, marcas y líneas de centro, texto con directriz, acabado superficial, símbolo de soldadura, globos y lista de piezas. **Gestor de estilos ISO / DIN / ANSI** (cotas, flechas, decimales, unidades, grosores, primer o tercer diedro). Exporta DXF (capas ISO), PDF de varias páginas y SVG |
| **Exportar** | STEP, STL, **3MF** (impresión 3D), **OBJ** y **glTF (.glb)** |
| **Configuración** | Se recuerda al entrar: ajustes (usuario, empresa, material, norma, hoja), materiales propios, proyecto, recientes y los documentos abiertos (autoguardado). **Carpeta de trabajo** local recordada (Chrome/Edge): Ctrl+S guarda en ella y la configuración se copia en `inv3d-config.json` para llevarla a otro PC. Archivo › Opciones de la aplicación |
| **Presentación** | Explosionado automático o manual, animación y vídeo WebM |
| **Inventor** | Proyectos `.ipj`, miniatura y propiedades de `.ipt/.iam/.idw/.ipn`, visor `.dwg` (LibreDWG) y `.dxf`, regla iLogic de exportación a STEP/DWG |

Visualización nítida: supermuestreo en monitores 1x, aristas con grosor real en píxeles, mallado con tolerancia angular de 3,4°, iconos a color y planos con grosor de línea constante en pantalla.

Ejemplos en **Herramientas › Ejemplos**: brida paramétrica y escalera con meseta.

### Límites conocidos

- La geometría de `.ipt/.iam/.idw` está en un formato cerrado de Autodesk: hay que exportarla a STEP/DWG (regla iLogic incluida).
- Perfiles de boceto: lazos de líneas, arcos y splines unidos por sus extremos; las líneas que se cruzan hay que recortarlas.
- La sección por línea quebrada se proyecta (escalonada); los tramos inclinados no se giran al plano como en la sección alineada de Inventor.
- La geometría proyectada y los planos tomados de otros componentes en la edición en contexto no se actualizan solos si esos componentes cambian.
- Los miembros iPart se generan como piezas independientes; no se elige miembro al colocar en un ensamblaje.
- Tubería: valores de referencia de catálogos públicos; verificar contra la edición vigente de la norma antes de fabricar. Las medidas M de tes reducidas que no están en la tabla se aproximan; los accesorios EN 10253 usan las medidas de referencia ISO 3419/B16.9 por DN.
- HVAC: la grapa helicoidal del conducto espiral se modela en relieve solo si se pide (es geometría pesada); derivaciones, compuertas y terminales ovales no están disponibles. Espesores de chapa y coeficientes ζ orientativos (práctica habitual); los equipos y terminales son bloques de implantación, no modelos de fabricante.
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
