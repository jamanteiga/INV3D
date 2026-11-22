# INV3D

CAD paramétrico 3D libre en el navegador.
Núcleo geométrico OpenCascade (vía [replicad](https://replicad.xyz)), visor Three.js, interfaz React.

## Versión 0.31

| Entorno | Qué hace |
| --- | --- |
| **Boceto 2D** | Línea, círculo (centro / 3 puntos), arco (3 puntos / centro / tangente), rectángulo (2 puntos / 3 puntos / centro), ranura, polígono, elipse, spline, punto, texto. **Restricciones geométricas** (coincidente, colineal, concéntrica, fija, paralela, perpendicular, horizontal, vertical, tangente, punto medio, simétrica, igual), aplicadas también solas al forzar el cursor. **Cotas** como restricciones (lineal, horizontal, vertical, radio, diámetro, ángulo, punto-línea, entre paralelas) con parámetros `d0, d1…` y expresiones, cotas de referencia. Grados de libertad y color de geometría totalmente restringida. Arrastre de puntos y curvas resuelto por el solver. Recortar, alargar, desfase, empalme y chaflán 2D, simetría, patrones, mover, copiar, girar, escalar y proyectar geometría del modelo |
| **Pieza** | Extrusión (distancia, a través de todo, dos direcciones, inclinación), revolución, solevación, barrido, nervio, bobina (muelles), relieve/grabado de texto, agujero (simple, refrentado, avellanado, roscado), empalme, chaflán, vaciado, inclinación de caras (desmoldeo), rosca cosmética, dividir, engrosar, patrón rectangular y circular (también sobre eje de trabajo), simetría, planos, ejes y puntos de trabajo, importar STEP. Parámetros fx, iProperties, masa, CdG y medición |
| **Superficies** | Superficie extruida, de revolución y solevada/reglada, **parche** (contorno plano o 3D), **coser** (si cierran volumen pasa a sólido), engrosar superficie. Se muestran translúcidas |
| **Boceto 3D** | Líneas, splines y hélices en el espacio con expresiones; trayectorias de barrido y contornos de parche |
| **eFamily / eOperaciones** | Tabla de familia de piezas (activar fila, generar miembros .i3p); extraer e insertar operaciones reutilizables con sus cotas como parámetros (biblioteca propia y ficheros .i3f) |
| **Chapa** | Cinta como Inventor. *Crear*: cara, pestaña, pestaña de contorno, **pestaña solevada** (desarrollo por triangulación), **rodillo de contorno**, dobladillo, **pliegue** entre dos caras, **plegado** por línea, derivar. *Modificar*: corte, **costura de esquina**, punzonado (redondo, cuadrado, rectangular, coliso), **rasgadura**, **desplegar / volver a plegar**, agujero, ranura, redondeo y chaflán de esquina, **marcar**. Operaciones de trabajo (plano, eje, punto, **SCU**), patrones (rectangular, circular, simetría, **controlado por boceto**), valores de chapa (t, R, K con valores DIN 6935 por espesor, desahogo de esquina) y *Patrón plano*: **definir cara A**, desarrollo con líneas de pliegue, cortes y marcas, DXF (capas CORTE, PLIEGUE, TEXTO, MARCADO), **crear pieza** y **crear componentes** |
| **Ensamblaje** | **ePoints** (Modelo 3D › ePoint en la pieza): puntos de conexión de **coincidencia** (cara plana: punto y normal), **inserción** (eje de un cilindro en su extremo, con radio) y **compuesto** (grupo de ePoints que se conectan a la vez); toda pieza tiene un **ePoint de inserción** por defecto (el origen o el que se defina), por el que se coge al colocarla. Al soltar una pieza, sus ePoints se unen solos con los del mismo nombre y tipo de otro componente; **Ensamblar › Conectar ePoints** une todos los pendientes. En el **árbol**, cada componente tiene un **+** que despliega sus operaciones y ePoints. **Colocar (P)**: piezas abiertas, del disco (.i3p, STEP) o de la carpeta de trabajo; el primer componente queda fijo en el origen y las copias siguen al cursor (clic para soltar, X/Y/Z giran 90°, Esc termina). **Arrastre libre** de componentes no fijos (respeta sus grados de libertad), crear pieza, mover/girar con gizmo, fijar. **Subensamblajes** (.i3a dentro de .i3a, restringibles por las caras de sus piezas). **Propiedades y cotas del componente** (doble clic sobre la pieza, en el árbol o clic derecho): masa, volumen, área, medidas, CdG y material, y **cotas geométricas editables** de la pieza (parámetros, cotas de boceto, anchos, altos, diámetros, longitudes de extrusión, espesores de vaciado/chapa/nervio, taladros, patrones…) con expresiones, vista previa en el ensamblaje y botones **Aceptar** / **Cancelar** (Cancelar o Esc deja la pieza como estaba); el cambio afecta a todas sus apariciones. **Edición en contexto** (clic derecho o Ensamblar › Editar): la pieza se edita viendo el resto del ensamblaje, con bocetos sobre caras de otros componentes y proyección de sus aristas; **Crear** hace la pieza nueva en contexto. **Estados de modelo** (supresiones y posiciones). **Lista de materiales estructurada** o solo piezas, exportable a **Excel**. **Detección de colisiones al mover** (Inspeccionar). Las piezas colocadas se cargan **en memoria sin pestaña** (se abren con doble clic y se cierran sin afectar al ensamblaje). **Restringir (J)** o **clic derecho sobre una cara/eje** con **vista previa** y **Aplicar** para encadenar: coincidir (caras o ejes), al ras, ángulo, **perpendicular**, tangente, insertar, **simetría** y rígida, contra otra pieza, los **planos/ejes de origen** del ensamblaje o de cada componente y **planos de trabajo** del ensamblaje (se mueve siempre el componente libre); **uniones** de rotación, corredera, cilíndrica, planar y bola (con bloqueo, **límites de recorrido** y **conducir** para animar mecanismos); **restricciones de movimiento** rotación-rotación (engranajes) y rotación-traslación (piñón-cremallera), resueltas a la vez (Gauss-Newton) con grados de libertad por componente. **Centro de contenido** (ISO 4017, ISO 4762, ISO 4032, ISO 7089, ISO 2338, rodamientos 60/62, chavetas DIN 6885). **Patrón de componentes** y **simetría de componente** asociativos, **sustituir componente**, **representaciones de vista**, análisis de interferencias, vista de corte 3D, lista de materiales y STEP |
| **Mecánica · Tubería** | Pestaña **Mecánica** (pieza y ensamblaje). ASME: tubo B36.10M/B36.19M (todos los NPS y schedules), bridas **B16.5** (WN, SO, ciega, loca, socket weld, roscada; clases 150–2500), **B16.47 Serie A y B** (26"–60"), codos B16.9 radio largo y corto 45/90/180°, tes, tes reducidas, cruces, reducciones concéntricas y excéntricas, casquetes, portabridas, manguitos y medios manguitos B16.11 (3000/6000, roscados NPT y socket weld). EN: tubo EN 10220, bridas **EN 1092-1** tipos 01, 05, 11, 12 y 13 (PN 6 a PN 100), accesorios EN 10253. Materiales ASTM/ASME (A106, A53, API 5L, A333, A312, A234, A403, A105, A350, A182…) y EN (P235GH, P265GH, P250GH, 16Mo3, 1.4301, 1.4404, 1.4571, dúplex…). Cada pieza lleva designación, norma y material en las iProperties |
| **HVAC** | Pestaña **HVAC** con selector EN/UNE (EN 1505/1506) o SMACNA. Los **conductos rectangulares** son piezas de **chapa plegada** (tres pliegues y cierre engatillado en la cuarta esquina) con desarrollo para corte. **Tuberías y presión** (Mecánica): **red de tuberías** (trazado con líneas 3D, dimensionado por velocidad, pérdidas Darcy-Weisbach, espesores B31.3 / EN 13480, categoría PED por línea, vanos entre soportes, generación de tubos, codos, tes, reducciones y bridas WN, isométrico y Excel); **comprobación a presión** (espesor de tubo, bridas P-T ASME B16.5 / EN 1092-1, refuerzo de derivaciones B31.3 §304.3.3 y vanos MSS SP-58); **recipiente EN 13445** (virola y fondos Klöpper, Korbbogen o elípticos, prueba hidráulica, categoría PED y modelo 3D con tubuladuras embridadas y patas, faldón o cunas). **Red de conductos** (HVAC › Red): trazado con líneas 3D del esqueleto, caudales por terminal, dimensionado por velocidad o pérdida unitaria (espirotubo o rectangular), cálculo de pérdidas (fricción Colebrook + singulares), circuito índice, **equilibrado** de terminales, **ventilador** necesario, **ruido** regenerado (VDI 2081, orientativo) con silenciador recomendado, **aislamiento según RITE** (espesor mínimo, pérdidas y temperatura en terminales), **mediciones** (Excel y **BC3**), **generación automática** de tubos, codos, tes, reducciones y manguitos en el ensamblaje y **plano isométrico** con lista de piezas y tabla de tramos. **Espirotubo comercial** (HVAC › Espirotubo, o Sección › Espirotubo en Conducto, Codo, Transición, Derivación, Manguito, Tapa, Compuerta y Soporte): tubo espiral Ø80–1250 en longitudes de catálogo y accesorios con extremo macho (con o sin junta EPDM): codos de 15, 30, 45, 60 y 90° prensados o por gajos (R = 1·D o 1,5·D), te 90°, te 45°, cruz y toma de silla (también reducidas), reducciones concéntricas y excéntricas, manguitos macho y hembra, tapones, abrazadera de suspensión, compuerta de regulación y sombrerete, con espesores comerciales (orientativos) seleccionables. **Conductos** rectangulares, circulares, **helicoidales (espiral, EN 12237)** y **ovales planos**: tramo recto (bridas TDC, marco angular o enchufe), **manguito de unión** para espiral, codos con radio, rectos con álabes, prensados, por gajos y ovales, transiciones rectangular/circular/oval en cualquier combinación, reducciones (también excéntricas) y desvíos con **desarrollo para corte**, te, toma de zapato, collarín, derivación a 45°, pantalón, tapas y plenums. **Terminales y equipos**: rejillas, difusores cuadrados y circulares, compuertas de regulación, cortafuegos, silenciadores, flexibles, UTA y fancoil. **Uniones, soportes y aislamiento**: bridas/marcos, soportes en trapecio o abrazadera con varilla, aislamiento. Espesor de chapa automático (UNE/EN 1507, EN 12237, calibres SMACNA). **Dimensionado** por pérdida de carga constante o velocidad (Darcy-Weisbach, Colebrook-White, Huebscher), pérdidas singulares y exportación CSV |
| **Estructura** | Perfiles EN: IPE, HEA, HEB, UPN, L, SHS, RHS, CHS, pletina, redondo. Inglete, recortar/alargar, longitudes y ángulos de corte en la lista de materiales. **Cálculo de la estructura** (Diseño › Cálculo): pórtico 3D por rigidez con apoyos (empotrado, articulado, rodillo), cargas en barras y nudos, peso propio, combinaciones ELU/ELS, comprobaciones **EC3** (axil, flexión, cortante, interacción, pandeo) y flechas, barras coloreadas por aprovechamiento y Excel. **Uniones EC3** (EN 1993-1-8): tornillos (cortante, aplastamiento, tracción, punzonamiento) y cordones en ángulo (método direccional) |
| **Simulación** | **Análisis de tensiones FEM lineal** de piezas (Inspeccionar › Análisis de tensiones): caras fijas, fuerzas o presiones sobre caras, malla de hexaedros por voxelizado con tamaño ajustable, σ von Mises y desplazamiento en color con leyenda y coeficiente de seguridad respecto al límite elástico |
| **Generadores** | (Diseño › Generadores) **ejes** escalonados con chaveteros y comprobación a torsión-flexión, **chavetas DIN 6885** con presión de contacto, **engranajes** rectos de evolvente (pareja colocada a la distancia entre centros, Lewis), **rodamientos** 62xx/63xx con vida L10h, **muelles** de compresión con rigidez y tensión |
| **Soldadura** | Cordón en ángulo entre dos caras, garganta *a*, símbolo ISO 2553 |
| **Tornillería** | Conexión atornillada con taladros y cálculo EN 1993-1-8 |
| **Dibujo** | **Plantillas ISO A4, A3, A2, A1 y A0** al crear un archivo nuevo. **Cajetín desde dibujos externos**: Colocar vistas › Cajetín › Importar DXF / DWG (2004 o posterior) / DGN (V7), con bloques expandidos y atributos convertidos en etiquetas; **etiquetas ilimitadas**, cada una con el campo al que hace referencia (del plano, propio o texto fijo), situables con un clic en la vista previa. **Cotas**: tras elegir los puntos la cota sigue al ratón hasta el clic que la suelta; el valor va siempre por encima de la línea de cota; **símbolos delante del valor** (Ø, □, R, SØ, SR, M, refrentado, avellanado, profundidad, ±, ≈, arco, t=), prefijo y sufijo libres. **Mover vistas** arrastrando: las proyectadas y auxiliares siempre alineadas con su vista padre, secciones, detalles e isométricas libres; **Ctrl + arrastrar** mueve en bloque la vista base con todas sus vistas. **Doble clic sobre una vista**: propiedades con escala (de la vista padre, normalizada o personalizada, p. ej. 1:7,5), etiqueta, aristas ocultas, marcas de centro y contorno del detalle (círculo discontinuo por defecto o continuo), con Aceptar/Cancelar. **Varias hojas**, vista base con escala automática, proyectadas (4 lados) e isométrica, **sección con rayado**, **detalle**, **auxiliar**, **partida**, **recortada**, **desarrollo de chapa** con tabla de pliegues, **sección escalonada** (línea quebrada), **corte parcial** (Break Out), aristas ocultas, marcas de centro automáticas. **Cotas recuperadas del modelo** (asociativas: siguen los cambios de la pieza), cotas lineales, **desde línea base**, **por coordenadas**, de radio, diámetro y ángulo con tolerancias (±, H7…), **tolerancias geométricas ISO 1101** y símbolos de referencia, **tabla de taladros**, **tabla de revisiones**, **plantillas de cajetín editables** (Colocar vistas › Cajetín: INV3D, ISO 7200 y compacto; celdas con campos del plano, campos propios o texto fijo; biblioteca, importar/exportar `.i3tb` y plantilla por defecto), notas de taladro/rosca, marcas y líneas de centro, texto con directriz, acabado superficial, símbolo de soldadura, globos y lista de piezas, **globos automáticos** (Anotar › Globos automáticos: uno por elemento de la lista de piezas, en columnas a los lados de la vista y con la misma numeración). **Gestor de estilos ISO / DIN / ANSI** (cotas, flechas, decimales, unidades, grosores, primer o tercer diedro). Exporta DXF (capas ISO), PDF de varias páginas y SVG |
| **Exportar** | STEP, STL, **3MF** (impresión 3D), **OBJ**, **glTF (.glb)** e **IFC4** para BIM (un elemento por componente: viga, pilar o barra, chapa, conducto y accesorio, terminal, compuerta, tubo y accesorio de tubería, tornillería; con material y propiedades) |
| **Configuración** | Se recuerda al entrar: ajustes (usuario, empresa, material, norma, hoja), materiales propios, proyecto, recientes y los documentos abiertos (autoguardado). **Carpeta de trabajo** local recordada (Chrome/Edge): Ctrl+S guarda en ella y la configuración se copia en `inv3d-config.json` para llevarla a otro PC. Archivo › Opciones de la aplicación |
| **Presentación** | Explosionado automático o manual, animación y vídeo WebM |
| **Intercambio** | Proyectos `.ipj`, miniatura y propiedades de `.ipt/.iam/.idw/.ipn`, visor `.dwg` (LibreDWG) y `.dxf`, regla VB.NET de exportación a STEP/DWG |

**Barra de vista** en la parte superior del área gráfica de pieza y ensamblaje: zoom para ajustar, **zoom encuadre**, **vista anterior**, **vista de sección** (plano frontal, superior o lateral con desfase e inversión), orientación (6 vistas, isométrica, dimétrica, trimétrica, normal al boceto), **estilo de visualización** (sombreado con aristas, sombreado, sin líneas ocultas, líneas ocultas visibles, alámbrico), ocultar/mostrar (planos y ejes de trabajo, bocetos, triedro, cubo de vistas, aristas) y **escena** (fondo); se recuerda entre sesiones.

**Novedades 0.31**
- **Fin de pieza arrastrable** (todas las piezas: pieza, chapa, tubería, HVAC, estructura…): en el árbol, arrastra *Fin de pieza* hacia arriba o hacia abajo; las operaciones que quedan debajo se ven atenuadas y no se calculan (tampoco en ensamblajes, planos ni desarrollo). Las operaciones nuevas se crean encima de *Fin de pieza*. Doble clic en *Fin de pieza*: al final. Clic derecho: al final, al principio, subir o bajar una operación; en una operación: *Mover Fin de pieza aquí*. Se guarda con la pieza y se deshace con Ctrl+Z.

**Novedades 0.30.1**
- Corregido: con el patrón plano en pantalla, *Iniciar boceto 2D* (o cualquier herramienta) no dejaba elegir cara. Ahora el visor vuelve solo al modelo plegado.

**Novedades 0.30**
- **Patrón plano como Inventor**: *Chapa › Patrón plano › Desarrollo* crea el patrón plano y el visor muestra la chapa desarrollada en 3D (líneas de pliegue en rojo, marcas en azul). En el árbol aparecen **Modelo plegado** y **Patrón plano** (clic para cambiar; clic derecho: cotas y DXF, cara A, eliminar). Se vuelve con *Ir a pieza plegada* (cinta, barra del visor o árbol). Se actualiza solo al cambiar la pieza. *Cotas y DXF* abre el desarrollo 2D con rótulos y exportación.

**Novedades 0.29.2**
- Chapa: el botón **Desarrollo** vuelve a llamarse así y el grupo *Patrón plano* (Desarrollo, Definir cara A, Crear pieza, Crear componentes) pasa justo detrás de *Crear*, siempre visible. Cinta compactada.

**Novedades 0.29.1**
- Chapa: los **redondeos y chaflanes de esquina** (aristas en el espesor, en la cara base o en el tramo plano de cualquier pestaña) aparecen en el desarrollo, en el DXF y en la vista de desarrollo del plano.

**Novedades 0.29**
- **Chapa**: cinta reorganizada como Inventor (Boceto · Crear · Modificar · Operaciones de trabajo · Patrón · Configuración · Patrón plano) y herramientas nuevas:
  - **Rodillo de contorno**: perfil abierto de líneas girado alrededor de un eje (virolas, conos, canales curvados); desarrollo con el radio neutro.
  - **Pliegue**: une dos caras de chapa eligiendo una arista de cada una (pliegue de radio R, doble pliegue si son paralelas y desplazadas, o tramo recto).
  - **Plegado**: pliega por una línea de boceto (eje del pliegue centrado, ángulo, sentido y lado). Las pestañas, cortes y taladros sobre el lado plegado van al desarrollo.
  - **Costura de esquina**: cierra la esquina entre dos pestañas contiguas (solape o solape inverso, con holgura).
  - **Rasgadura**: abre la chapa a lo largo de líneas de boceto.
  - **Desplegar / Volver a plegar**: corta sobre el desarrollo y lleva los cortes a la base y a las pestañas al replegar.
  - **Ranura**, **Marcar** (texto o geometría al desarrollo y al DXF en la capa MARCADO), **SCU** (origen, planos y ejes de usuario), **Patrón controlado por boceto**.
  - **Patrón plano**: **Definir cara A** (el desarrollo se ve desde esa cara), **Crear pieza** (derivada) y **Crear componentes** (una pieza por cuerpo y un ensamblaje).
- Corte, Punzonado, Plegado, Rasgadura y Marcar: con el cuadro abierto y sin boceto, clic en una cara para bocetar en ella y volver a la operación.

**Novedades 0.28.2**
- **Chapa › Estilo de chapa**: K por defecto **0,273** en chapas y conductos nuevos. Al cambiar el espesor, el radio pasa al **mínimo DIN 6935** (S235) para ese espesor; se muestra el R y K recomendados (K DIN 6935 = (0,65 + 0,5·log R/t)/2) con botón *Usar recomendados*, botón *K = 0,273*, aviso si R es menor que el mínimo y **tabla de valores recomendados** por espesor (0,5–15 mm). La biblioteca de estilos usa esos valores.

**Novedades 0.28.1**
- Chapa: **Corte** y **Punzonado** ya no reutilizan el boceto de la cara base. Con el cuadro abierto y sin boceto libre, haz clic en una cara plana: se abre un boceto en ella y al pulsar «Terminar boceto» vuelve la operación con ese boceto. También: clic en la cara + **S**.

**Novedades 0.28**
- **Chapa**: clic en una cara (base o pestaña) + **S** (o *Chapa › Iniciar boceto 2D*) para bocetar en ella, y con ese boceto **Corte**, **Punzonado** o **Agujero**.
- **Desarrollo de chapa con cortes, agujeros y punzonados**: se trasladan al desarrollo (y al DXF y a la vista de desarrollo del plano) si están sobre la cara base o sobre el tramo plano de cualquier pestaña. Los que caen en una zona de pliegue se avisan en el diálogo.

**Novedades 0.27.9**
- Tecla **T** = **Zoom › Todo** (como AutoCAD) en pieza, ensamblaje y plano (en el plano encuadra la hoja completa). Sigue también con **Inicio**. El texto de boceto pasa a **Mayús+T**. Se puede cambiar en Herramientas › Atajos de teclado.

**Novedades 0.27.8**
- **Desahogo de esquina en chapa**: cuando dos pestañas nacen en aristas contiguas, cada una se recorta en esa esquina R + t + holgura y los pliegues ya no se pisan; el desarrollo sale con la esquina desahogada. Holgura por defecto 0,5 mm, regulable o desactivable en **Chapa › Estilo de chapa › Desahogo de esquina**.

**Novedades 0.27.7**
- Desarrollo de chapa: los rótulos de pliegue (ARRIBA/ABAJO, ángulo, R) van **paralelos a su línea de pliegue**, centrados y legibles, en el diálogo, en el DXF exportado y en la vista de desarrollo del plano (P1, P2…).

**Novedades 0.27.6**
- **Chapa › Desarrollo**: ya desarrolla **pestañas sobre pestañas** (en el extremo o en el lateral de otra pestaña, a cualquier nivel), no solo sobre aristas de la cara base. Cada pestaña se despliega desde la posición plana de su pestaña madre con su desarrollo de pliegue (ángulo · (R + K·t)).

**Novedades 0.27.5**
- Materiales de tubería, accesorios y bridas con designación ASME Sección II: **SA-105N** (antes ASTM A105) y **SA-…** en lugar de ASTM A… (SA-106 Gr. B, SA-234 WPB, SA-182 F316L, SA-350 LF2…); tornillería SA-193 B7 / SA-194 2H. Los ficheros antiguos se actualizan solos al abrirlos. La arandela ASTM F436 no cambia (no tiene equivalente SA).

**Novedades 0.27.4**
- Ensamblaje: **Mayús + doble clic** sobre una pieza → la vista gira en torno a ella (se centra y se marca su centro). Mayús + doble clic en vacío vuelve a girar en torno a todo el ensamblaje.

**Novedades 0.27.3**
- En un boceto se puede seguir girando la pieza: **Mayús + botón central (o derecho) arrastrando**, o el ViewCube. **Re Pág** (Mirar al boceto) vuelve a ponerlo de frente.

**Novedades 0.27.2**
- **Boceto en una cara**: clic en una cara plana de la pieza (queda resaltada) y **S** o **Modelo 3D › Iniciar boceto 2D** abre el boceto en ella. Con *Iniciar boceto 2D* activo, la cara de la pieza bajo el cursor tiene prioridad sobre los planos de origen que la atraviesan. También: clic derecho sobre la cara › *Nuevo boceto*.

**Novedades 0.27.1**
- **ePoints automáticos en las piezas generadas**: cada extremo de tubos, codos, tes, cruces, reducciones, casquetes, portabridas, manguitos y bridas (ASME/EN), y de conductos, codos, transiciones, manguitos, tapas, compuertas, silenciadores y flexibles de HVAC lleva un ePoint de inserción en su centro, con la dirección hacia fuera. Las bridas llevan además el de la cara de junta (WN en el extremo del cuello, SO retranqueado espesor + 3 mm, SW en el fondo del encaje con 1,6 mm). Extremos con el mismo nombre (p. ej. «Tubo 4"», «Conducto Ø315», «Cara brida 4 Clase 150») se conectan solos al colocarlos.

**Novedades 0.27**
- **Asistente IA (Gemini)**: botón **IA** de la barra superior o **F1**. Panel a la derecha que conoce el documento abierto (operaciones y errores, parámetros, propiedades físicas, componentes, GDL y restricciones, vistas del plano) y puede actuar: crear piezas y operaciones, modificarlas o borrarlas, cambiar parámetros e iPropiedades, abrir órdenes. Cada cambio se confirma antes (o automático, opcional) y se deshace con Ctrl+Z. Admite adjuntar una imagen o PDF.
- Configuración en ⚙ del panel: clave de API de Gemini (Google AI Studio) guardada solo en el navegador y elección de modelo.

**Novedades 0.26.2**
- Zoom con la rueda el doble de rápido por defecto y regulable en **Archivo › Opciones de la aplicación… › General › Velocidad del zoom (rueda)** (0,5× a 6×), en 3D y en planos.

**Novedades 0.26.1**
- **Fijación** reconoce la brida del taladro (ASME B16.5/B16.47 o EN 1092-1: clase/PN, tamaño, tipo y nº × métrica de pernos) y elige montaje: ASME → espárrago + 2 tuercas + 2 arandelas (B16.5, rosca UNC/8UN); EN → tornillo + arandela + tuerca (EN 1515-1). Si entre las bridas solo hay el hueco de las caras realzadas, suma la junta (espirometálica B16.20 3,2 mm / plana EN 1514-1 2 mm); si la junta está modelada, la mide.
- Cada pieza de la fijación queda **restringida al agujero** (Insertar: coaxial y apoyada), con 1 GDL de giro sobre su eje.

**Novedades 0.26**
- **Mecánica › Tornillería y juntas (ASME · EN)**:
  - EN/ISO: tornillo ISO 4014/4017, espárrago DIN 976-1 / EN 1515-1, tuerca ISO 4032, arandela ISO 7089 (M6–M64).
  - ASME: tornillo hexagonal pesado B18.2.1, espárrago B18.31.2 para bridas B16.5, tuerca hexagonal pesada B18.2.2 2H y arandela ASTM F436 (1/2"–4"; UNC hasta 1", 8UN por encima).
  - Juntas planas EN 1514-1 IBC / ASME B16.21 y espirometálicas EN 1514-2 / ASME B16.20 por DN-PN o NPS-clase.
- **Mecánica › Fijación** (ensamblaje): tornillo + arandela + tuerca, o tuerca + arandela + espárrago + arandela + tuerca. Clic en la pared de un taladro: mide el espesor a abarcar (los huecos de junta de hasta 10 mm se suman), propone la métrica según el taladro y coloca el conjunto en todos los taladros iguales de la pieza. Opción de sumar la junta si no está modelada. Longitud comercial con saliente mínimo de **2 hilos (ASME)** o **10 mm (métrica)**.

**Novedades 0.25.2**
- **Bridas de cuello para soldar (WN)** ASME B16.5 / B16.47 / EN 1092 tipo 11: geometría corregida con acuerdo entre plato y cubo, cubo cónico de X a A, **tramo recto** de Ø A y **chaflán de soldadura** ASME B16.25 (37,5°, talón 1,6 mm). La longitud total Y no cambia.

**Novedades 0.25.1**
- **Ensamblar › Posición › Rotar** (tecla R): arrastrando una pieza se gira sola alrededor de su centro, para ver y elegir la geometría a restringir (funciona con el diálogo de restricción abierto). Pieza libre: el giro se guarda. Pieza restringida o fija: giro temporal, se restablece con Esc o al desactivar Rotar.

**Novedades 0.25**
- **Plano**: doble clic sobre el cajetín abre su plantilla. **Separadores de zona** en todos los formatos (1, 2, 3… y A, B, C…, a partes iguales: A4 6×4, A3 8×6, A2 12×8, A1 16×12, A0 24×16). **Colocar vistas › Plantillas de hoja**: importar desde DXF/DWG el **plano completo**, los **bordes**, el **cajetín de revisiones** y el **copyright** (en la esquina elegida); el cajetín principal sigue en *Cajetín*.
- **Estilos de dibujo**: estilos personalizados con nombre (guardar, cargar, por defecto para planos nuevos); cotas con nº de decimales, **pulgadas entre corchetes en fracciones** (25,4 [1"]) y **tolerancias +a/-b apiladas a la derecha** de la cota.
- **Anotación automática** en las vistas: marcas de centro de taladros, **ejes de simetría**, ejes longitudinales de cilindros y ejes de taladros vistos de perfil; **nota de taladro roscado** según ISO 6410 (p. ej. `M8x1,25-6H ↧12 / Ø6,8 ↧15`). Se quitan por vista (clic derecho o propiedades).
- **Agujero**: corta siempre hacia el material (antes podía quedarse en un círculo pintado) con *Invertir dirección*; colocación **en cara** (clic en la cara y distancias del centro a dos aristas).
- **Booleanas** (Modelo 3D › Booleanas): unión, diferencia e intersección entre cuerpos de la pieza.
- **Empalme**: arista a arista, cara plana (todas sus aristas), todas las aristas de la pieza y **radio variable**.
- **Boceto**: **Línea eje** (trazo y punto; eje de revolución y crea un eje de trabajo al terminar el boceto), **Construcción** fina y discontinua (con selección la convierte, sin selección se aplica a lo siguiente que se dibuje), **Proyectar ejes** principales y **Proyectar desde operación** (geometría de otro boceto).
- **Proyectar** (Modelo 3D › Proyectar): *Sobre cara/plano* (boceto nuevo con la geometría proyectada) y *Sobre superficie* (curvas 3D sobre la cara, en un boceto 3D).
- **Doble clic** en una cara, arista o curva del 3D abre la operación que la creó.
- **Ensamblaje**: clic derecho sobre un componente › *Restringir por ePoint · …* y después el ePoint del otro componente.

**Novedades 0.24**
- **Guardado**: tras el primer guardado (o al abrir un fichero con Archivo › Abrir) se guarda en el mismo fichero sin preguntar; *Guardar como* sigue preguntando. **Autoguardado** cada 2 min de los documentos ya guardados (Archivo › Opciones de la aplicación… › Carpeta y sesión: intervalo en minutos).
- **Pieza → ensamblaje**: al guardar una pieza se actualizan y guardan los ensamblajes y planos abiertos que la usan; con la carpeta de trabajo, al abrir un ensamblaje sus piezas se toman de su fichero.
- **Ensamblaje**: arrastrar sobre una pieza libre gira la vista; para moverla, selecciónala primero (o Mover). **ePoints visibles** (barra de vista o clic derecho › Ocultar ePoints): clic en un ePoint y en otro de otro componente → se conectan. Al colocar, el ePoint de la pieza nueva **se imanta** al ePoint cercano de otra y al soltar queda conectada. Con *Restringir* abierto los ePoints, y los planos y ejes de origen de cada pieza, se eligen en el 3D o en el árbol.
- **Origen de la pieza en el ensamblaje**: al desplegar «+» un componente aparecen *Origen* (planos XY/XZ/YZ y ejes X/Y/Z) y sus ePoints; clic derecho en el componente › *Mostrar origen de la pieza*.
- **ePoints**: creación por *Centro de cara*, *Punto de cara*, *Círculo* (arista circular: centro y eje), *3 aristas* (boca rectangular hueca) y *Oval* (2 aristas rectas). Menú contextual completo: conectar, restringir, activar/desactivar, ocultar, invertir dirección, renombrar, usar como inserción, copiar coordenadas, editar, eliminar.
- **Atajos de teclado personalizables** (Herramientas › Atajos de teclado, o «?» de la barra rápida): añadir (＋), cambiar (✎), quitar (✕), restablecer, buscar y filtrar por entorno; avisa de conflictos.

**Centro de gravedad (CDG)**: en pieza y ensamblaje, **Vista › Aspecto › Ver/ocultar CDG** (o la barra de vista › Ocultar/mostrar › Centro de gravedad): símbolo con coordenadas y masa según el material de cada pieza. En el dibujo, **clic derecho sobre una vista › Ver/ocultar CDG** (por vista).

**Novedades 0.23**
- **ePoints activables**: clic derecho sobre un ePoint en el árbol de la pieza (o dentro de la pieza en el árbol del ensamblaje) → *Activar / Desactivar*; los desactivados (gris) no se conectan ni se ofrecen al colocar. También *Nuevo ePoint*, *Duplicar* y *Usar como ePoint de inserción*; en la ventana de ePoints, casilla de activo, ⧉ duplicar y **＋ Nuevo**.
- **eFamily** (antes familia por tabla) y **eOperaciones** (operaciones reutilizables): Herramientas › Tabla eFamily / eOperaciones.
- **Auxiliares** con nombres automáticos: planos **P1, P2…**, ejes **E1, E2…**, puntos **pt1, pt2…** en pieza (Modelo 3D › Operaciones de trabajo) y en ensamblaje (Ensamblar › Geometría de trabajo › Plano / Eje / Punto; el eje se puede tomar de una arista circular y sirve para *Coaxial con E1*).
- **Boceto en auxiliar** (Modelo 3D › Boceto › Boceto en auxiliar, o clic derecho sobre P/E/pt en el árbol): por un punto auxiliar paralelo a XY/XZ/YZ, o por punto y eje (normal al eje). El boceto sigue al auxiliar.
- **Parámetros c1, c2…**: cada cota de boceto y cada valor de operación crea su parámetro de modelo; Herramientas › Parámetros los muestra (operación · valor), se editan y se usan en fórmulas (`c3 = c1/2`).
- **Referencias a objetos** tipo AutoCAD (Herramientas › Referencias a objetos, **F3** o botón **REFENT** de la barra de estado): punto final, medio, centro, nodo, cuadrante, intersección, perpendicular, tangente, cercano y origen 0,0,0, con su símbolo y nombre junto al cursor; en boceto y al designar puntos en el 3D.
- **Cotas flotantes** al dibujar (línea: longitud y ángulo; rectángulo: ancho y alto; círculo: Ø; arco: R): se escribe el valor, Tab cambia de cuadro, Intro crea la entidad y deja la cota (cN). Sin escribir, las medidas se cambian después en Propiedades (la línea muestra longitud y ángulo).
- **Asistente de taladro**: escariado, avellanado, taladro, taladro roscado, roscado cónico (NPT / R), heredado (simple, escariado, avellanado, abocardado), ranura, ranura escariada, ranura avellanada y taladro avanzado (escalonado). Tamaño de tornillo, ajuste ISO 273 (ajustado / normal / holgado), escariados DIN 974 y avellanados ISO 10642/7046/2009, ángulo de punta, avellanado del lado cercano.
- **Roscas**: ISO métrica gruesa y fina, UNC, UNF, G (BSP), R (BSPT), NPT, trapecial y Whitworth; clase, desfase y rosca a izquierdas. **Rosca cosmética** con textura helicoidal sobre la cara (como Inventor), también en los taladros roscados.
- **Clic derecho sobre una cara** de la pieza: nuevo boceto, extrusión, revolución, taladro aquí, rosca (cilíndrica), empalme, chaflán, vaciado, inclinación, engrosar, patrón, simetría, plano/eje/punto de trabajo, ePoint en la cara, mirar a y medir.

**Primer componente de un ensamblaje vacío** (Ensamblar › Colocar): tras elegir la pieza se indica qué punto suyo se lleva al destino (por defecto su **ePoint de inserción**, otro ePoint o su origen) y las **coordenadas de destino** (por defecto 0, 0, 0), y si queda fijo.

**Cerrar fichero**: aspa ✕ en la esquina superior derecha del área gráfica (pieza, ensamblaje o dibujo); pregunta si hay cambios sin guardar. Clic central en la pestaña inferior también cierra.

**Modo de recorte** (Vista › Vista de corte › Modo de recorte, o el botón «Modo de recorte» de la barra de vista): barra flotante, arrastrable por el asa, para cortar pieza o ensamblaje y ver el interior. **1.er botón (plano)**: oculta un lado; el deslizador de la izquierda lo mueve por el modelo. **2.º botón (franja)**: solo se ve la rodaja entre dos planos (espesor = paso). Planos **XYc/XZc/YZc** con **tapa** rellena, **XY/XZ/YZ** solo recorte y **\*** plano libre por el punto y el vector. **M**: plano perpendicular al eje; **−X/+X/−Y/+Y/−Z/+Z** eligen qué lado se oculta. El deslizador de la derecha es la **parte visible**: al 100 % no se oculta nada y al deslizar a la izquierda se va ocultando (y al revés). **⌖** designa directamente en el modelo el punto por el que pasa el plano (automático: vértice si está cerca, si no arista, si no cara); también **Shift+F** cara, **Shift+G** arista y **Shift+V** vértice; **Esc** cancela. Al cambiar −X/+X… o R el plano se queda en el punto designado. Las flechas ⬅ (menos) y ➡ (más) lo mueven el valor del **paso**. **R** invierte el lado oculto y **×** quita el recorte.

**Estilos de iconos** (Vista › Estilo de iconos, o Archivo › Opciones › General con vista previa): **Estilo 1** (línea, el original), **Estilo 2** (plano, gris azulado con la operación en azul y acentos naranja), **Estilo 3** (sombreado gris con degradados, operación en amarillo, bocetos en azul y sombra) y **Estilo 4** (brillante: protusiones amarillas, vaciados rojos, superficies verdes, bocetos azules, contorno negro y reflejos). Unos 70 iconos principales dibujados en perspectiva isométrica; el resto se adapta en color. Iconos un 20 % mayores.

Visualización nítida: supermuestreo en monitores 1x, aristas con grosor real en píxeles, mallado con tolerancia angular de 3,4°, iconos a color y planos con grosor de línea constante en pantalla.

Ejemplos en **Herramientas › Ejemplos**: brida paramétrica y escalera con meseta.

### Límites conocidos

- La geometría de `.ipt/.iam/.idw` está en un formato cerrado: hay que exportarla a STEP/DWG (regla de exportación incluida).
- Perfiles de boceto: lazos de líneas, arcos y splines unidos por sus extremos; las líneas que se cruzan hay que recortarlas.
- La sección por línea quebrada se proyecta (escalonada); los tramos inclinados no se giran al plano como en una sección alineada.
- La geometría proyectada y los planos tomados de otros componentes en la edición en contexto no se actualizan solos si esos componentes cambian.
- Los miembros eFamily se generan como piezas independientes; no se elige miembro al colocar en un ensamblaje.
- Tubería: valores de referencia de catálogos públicos; verificar contra la edición vigente de la norma antes de fabricar. Las medidas M de tes reducidas que no están en la tabla se aproximan; los accesorios EN 10253 usan las medidas de referencia ISO 3419/B16.9 por DN.
- HVAC: la grapa helicoidal del conducto espiral se modela en relieve solo si se pide (es geometría pesada); derivaciones, compuertas y terminales ovales no están disponibles. Espesores de chapa y coeficientes ζ orientativos (práctica habitual); los equipos y terminales son bloques de implantación, no modelos de fabricante.
- IGES no está disponible: la versión de OpenCascade para web no incluye ese módulo (usa STEP).
- La carpeta de trabajo necesita Chrome o Edge en escritorio abriendo la web directamente; el navegador pide un clic de «Reconectar» en cada sesión.
- Desarrollo de chapa: no se desarrollan el pliegue entre caras ni una segunda cara base; el rodillo con tramos cónicos se desarrolla aproximado (radio neutro medio). Al volver a plegar, los cortes que cruzan una zona de pliegue no se aplican en ella.
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
