# Eventos del ATS en el esquemático — qué se muestra y qué falta

Referencia para ir incorporando la representación de los eventos del log del ATS en el esquemático de la
Línea 1 (vista **Esquemático**, barra de reproducción y diagrama de hilo).

- Código: `src/components/esquematico/eventos.ts` (plantillas `PLANTILLAS`, modelo `interpretar`),
  `replay.ts` (trayectos, itinerarios, deslizamientos y estado en un instante), `rutas.ts` (recorridos inferidos
  del plano), `capas.tsx` (dibujo), `Hilo.tsx` (diagrama de hilo), `clasificacion.ts` (clasificación a CSV).
- Log analizado: `eventos_2010-2610.xlsx` — 838 311 filas, del 18/10/2026 11:15 al 28/10/2026 03:03 (hora del log).
  Tras quitar los duplicados (mismo tipo y texto en menos de 2 s; el ATS registra cada evento 2–3 veces) quedan
  **408 016 eventos**. 35 trenes; todas las cabinas TGMT están en la flota y todos los ids de estación/AVC del TGMT
  tienen PK en el plano.

## Clasificar todos los eventos disponibles

En la barra de reproducción, **«Clasificar eventos (CSV)…»** → *Todos los Excel de Storage* (con la sesión de la
app) o *Elegir archivos de esta computadora*. Descarga `clasificacion_eventos_AAAA-MM-DD.csv` con una fila por
plantilla, `eventtype` y forma del texto (identificadores reemplazados por `#`): cantidad de filas, eventos sin
duplicados, primera y última fecha, cantidad de archivos, un ejemplo y si se muestra (`sí`), está reconocida
pero sin representación (`pendiente`) o no se reconoce (`no reconocido`). Con ese CSV se completan las plantillas.

Para agregar una representación: escribir o ajustar la plantilla en `PLANTILLAS` (expresión regular sobre
`description`, categoría y texto `muestra`), manejarla en `interpretar` y dibujarla. `muestra: ''` marca una
plantilla reconocida sin representación; la prueba `tests/esquematico.test.ts` exige que cada plantilla figure acá.

## Qué se muestra hoy

Cantidades = eventos sin duplicados en el log analizado (todas las variantes OPERATOR / ACK / NACK de un comando).

| Plantilla | `eventtype` | Eventos | Cómo se muestra |
|---|---|---:|---|
| `llegada` | TGMT_ARRIVAL_AT_PLATFORM | 117 247 | Tren detenido en el andén o AVC, con su número; en terminales, sobre la vía de la ruta por la que llegó |
| `salida` | TGMT_DEPARTURE_AT_PLATFORM | 115 496 | Tren en marcha hacia la próxima parada con la curva de marcha tipo de su material y vía (arranque y frenado hasta el punto de parada) |
| `salto` | TGMT_SKIP_PLATFORM | 774 | Paso sin parada |
| `detenido` | ALARM_* | 42 599 | CDV pintado con «DET n°»; el tren (por número o, sin número, el más cercano) queda detenido en el extremo de salida de ese CDV |
| `arb` | ALARM_* | 6 717 | CDV pintado con «ARB» |
| `nrb` | ALARM_* | 834 | CDV pintado con «NRB» |
| `alarma` | ALARM_* (resto) | 2 968 | Elemento nombrado (CDV, aguja, señal, BFU) pintado con el nombre corto: OCUP. INTEMP, OCUP. TREN, RUTA BLOQ, SIN COMPROB, MOTOR AG, CONTROL AG, TALONADA, FOCO R/A/V, P. EMERG, COMUNIC |
| `rebase` | ALARM_* | 300 | Andén con «REBASE» 5 min (casi nunca se normaliza en el log) |
| `degradado` | ALARM_* | 1 989 | Tren con borde rojo (si su número está asignado a una cabina) |
| `tarjeta` | ALARM_* | 2 229 | Panel *Estado* |
| `ihm_conexion` | ALARM_* | 943 | Panel *Estado* |
| `dbo` | COMMAND_* | 76 384 | Cuadrado rojo «DBO» en la punta de salida del andén (vía 1 → hacia OBS, vía 2 → hacia PAN; terminales hacia la otra punta), entre el andén y su vía, desde el ACK de *Activar* hasta el de *Desactivar* |
| `dbo_nocbtc` | COMMAND_* | 19 934 | Cuadrado rojo «DBO» junto a la señal (DBONoCBTC → CancelarDBONoCBTC ejecutado; 9 787 cancelaciones fueron rechazadas) |
| `itinerario` | COMMAND_* | 6 438 | Ruta en verde de la señal origen a la destino, con la posición de cada aguja (N/I) y el tren que la usa |
| `deslizamiento` | COMMAND_* | 3 668 | Deslizamiento en ámbar discontinuo a continuación de la señal, con las agujas en la posición del comando |
| `marca_comando` | COMMAND_* | 2 112 | Etiqueta sobre el elemento mientras está activo: FLOTA, ITI AUTO, DESL AUTO, SALTO, PROH. PUERTAS, BLOQ. MOV, BLOQUEO, BLOQ. SEÑAL, BLOQ. DESTINO; **RTV** (TSR_SPEED → CancelarTSR) pinta la sección rayada en amarillo |
| `numero_tren` | COMMAND_ACK | 1 131 | Número de servicio dentro del tren (`1600` → `16`, `*7600` → `*76`) |
| `comando` | COMMAND_* (resto) | 3 275 | Destello de los elementos del comando (rojo si fue rechazado, con el motivo en la lista); MoverAguja: «MOV → N/I» 1 min sobre la aguja |
| `cambio_numero` | TRAIN_CHANGED | 713 | Número de servicio actualizado |
| `nuevo_tren` | NEW_TRAIN | 335 | Destello de la sección donde se numera |
| `borrado` | TRAIN_DELETED | 321 | Se quita el número de servicio |
| `ihm_area` | IHM_ZONE_CONTROL | 483 | Panel *Estado*: IHM que controla cada área |
| `ihm_servidor` | CONTROL_IHM | 482 | Panel *Estado*: servidor de cada IHM |
| `ihm_login` | IHM_LOGIN | 52 | Panel *Estado*: usuario en cada IHM |
| `ihm_logoff` | IHM_LOGOFF | 4 | Panel *Estado*: fin de la sesión |
| `ixl_desconexion` | COMM_IXL_DISCONNECT | 90 | Estaciones del enclavamiento / ATP en rojo hasta reconectar |
| `ixl_conexion` | COMM_IXL_CONNECT | 94 | Fin de la desconexión |
| `ixl_carga` | COMM_IXL_START/END_LOADING | 183 | Lista de eventos |
| `comando_tren` | COMMAND_ACK | 221 | **Pendiente**: sólo lista de eventos |

**Ciclo de las alarmas.** Abierta → se pinta con trazo lleno. Normalizada → si después el operador la reconoce o
la cierra, queda con trazo discontinuo y «*» (pendiente de reconocer) hasta ese momento; si no hay reconocimiento
en el log, termina al normalizarse (así se comporta la gran mayoría: ciclo abierta → normalizada).

**Itinerarios.** El log da señal origen y destino; el recorrido se busca en el grafo de vías del plano (vías con sus
nodos, agujas con talón / recta / desviada, señales con su vía y sentido). Las 86 rutas distintas del log se
resuelven. Vigencia: desde el ACK hasta que se cancela, se establece otra desde la misma señal o una en conflicto
(comparte secciones), o el tren asociado pasa la señal destino o llega a su próxima parada (estimado). El tren es
el primero que pasa por la señal origen después del ACK.

**Deslizamientos.** Posición de agujas por el nombre del comando (Normal, Invertida, Normal1Normal2, …); largo
hasta la primera junta pasada la última aguja (máx. ~140 unidades del lienzo). Se liberan cuando el tren se
detiene antes de la señal (45 s) o la pasa (estimado). Todos los deslizamientos del log se resuelven.

**Posición de los trenes.** Andén/AVC por TGMT; entre paradas, marcha tipo del material y vía con arranque y
frenado; detenido en CDV por la alarma; sobre la ruta establecida para ese tren (terminales y cambios de vía) o, si
sale o llega a otra vía, pasa de una a otra a lo largo del tramo. El tren se dibuja con la inclinación de la vía
donde está y la flecha en su sentido de avance; detenido, el de su próximo movimiento (rotación en terminales).

## Qué no se puede saber con el log actual

- **Modo de conducción de cada tren** (ATO, ATPM, RM, CBTC / no CBTC): no viene en ningún evento; sólo la alarma
  «degradado». Hace falta el registro de estado de tren del ATS / TGMT.
- **Ocupación real de CDV y marcha real**: no hay eventos de ocupación ni reportes de posición; entre paradas la
  posición es la de la marcha tipo, salvo detenciones con alarma.
- **Liberación real de rutas y deslizamientos, comprobación de agujas, aspecto de señales**: no están en el log
  (vigencias estimadas).
- **Tabla de itinerarios del enclavamiento**: confirmaría el recorrido de cada ruta y el largo de cada deslizamiento.
- **Valor de velocidad de la RTV**: TSR_SPEED no lo trae (se muestra la sección, sin afectar la marcha).
- **Áreas sin elemento en el plano**: «PAN ESTE» (ReinicioOcupacionLogicaGlobal, TomarMando), vueltas automáticas
  VA1PAN / VA2OBS…: se listan en el panel *Estado*, no se dibujan.
- **Tarjeta PM1 / PM2**: no dice de qué enclavamiento es.
- **Skip/Hold y puertas remotas al tren** (`comando_tren`: ATS_I_Train_Skip_Hold_Cmd #0/#3,
  ATS_I_Remote_Door_Open_Close): falta la tabla de códigos.
- **Fallas de comunicación con OCC1, PML, MOV, PCCR, RMI, IxlManager, WCU_TTS**: se pintan si el texto nombra un
  elemento del plano; ubicarlas en la red y los puestos requiere los planos de red e IHM (fase PCC/PML).
