# Eventos del ATS en el esquemático — qué se muestra y qué falta

Referencia para ir incorporando la representación de los eventos del log del ATS en el esquemático de la
Línea 1 (vista **Esquemático**, barra de reproducción y diagrama de hilo).

- Código: `src/components/esquematico/eventos.ts` (plantillas `PLANTILLAS`, modelo `interpretar`),
  `replay.ts` (trayectos, itinerarios, deslizamientos y estado en un instante), `rutas.ts` (recorridos inferidos
  del plano), `capas.tsx` (dibujo), `Hilo.tsx` (diagrama de hilo), `clasificacion.ts` (clasificación a CSV).
- Clasificación de todos los Excel de Storage (botón «CSV de eventos», 28/10/2026): **60 archivos, del 22/02/2026 al
  28/10/2026, 23 137 504 filas y 15 358 777 eventos** sin duplicados (mismo tipo y texto en menos de 2 s; el ATS
  registra cada evento 2–3 veces). Todos los `eventtype` y todas las formas de texto quedan cubiertos por una
  plantilla; sólo `comando_tren` conserva 1 evento sin representación.
- Detalle por día validado con `eventos_2010-2610.xlsx` (838 311 filas, 18/10 11:15 – 28/10 03:03): 35 trenes; todas
  las cabinas TGMT están en la flota y todos los ids de estación/AVC del TGMT tienen PK en el plano.

## Clasificar todos los eventos disponibles

En la barra superior, botón **«CSV de eventos»** → *Todos los Excel de Storage* (con la sesión de la
app) o *Elegir archivos de esta computadora*. Descarga `clasificacion_eventos_AAAA-MM-DD.csv` con una fila por
plantilla, `eventtype` y forma del texto (identificadores reemplazados por `#`): cantidad de filas, eventos sin
duplicados, primera y última fecha, cantidad de archivos, un ejemplo y si se muestra (`sí`), está reconocida
pero sin representación (`pendiente`) o no se reconoce (`no reconocido`). Con ese CSV se completan las plantillas.

Para agregar una representación: escribir o ajustar la plantilla en `PLANTILLAS` (expresión regular sobre
`description`, categoría y texto `muestra`), manejarla en `interpretar` y dibujarla. `muestra: ''` marca una
plantilla reconocida sin representación; la prueba `tests/esquematico.test.ts` exige que cada plantilla figure acá.

## Qué se muestra hoy

Cantidades = eventos sin duplicados en los 60 archivos de Storage (todas las variantes OPERATOR / ACK / NACK de un
comando).

| Plantilla | `eventtype` | Eventos | Cómo se muestra |
|---|---|---:|---|
| `llegada` | TGMT_ARRIVAL_AT_PLATFORM | 3 615 299 | Tren detenido en el andén o AVC, con su número (en terminales el número de vía del TGMT es el andén) |
| `salida` | TGMT_DEPARTURE_AT_PLATFORM | 3 552 632 | Tren en marcha hacia la próxima parada, por las vías, con la curva de marcha tipo de su material y vía |
| `salto` | TGMT_SKIP_PLATFORM | 29 432 | Paso sin parada |
| `dbo` | COMMAND_* | 2 314 352 | Cuadrado rojo «DBO» en la punta de salida del andén (vía 1 → hacia OBS, vía 2 → hacia PAN; terminales hacia la otra punta), entre el andén y su vía, desde el ACK de *Activar* hasta el de *Desactivar* |
| `dbo_nocbtc` | COMMAND_* | 591 107 | Cuadrado rojo «DBO» junto a la señal (DBONoCBTC → CancelarDBONoCBTC ejecutado) |
| `comunicacion` | ALARM_* | 2 251 913 | Panel *Estado › Comunicaciones* y aviso «Comunicaciones: n caídas» en la barra: enlaces RMI de PCC/PML (RMI_PCC_OBS ≈ 965 mil aperturas, RMI_PCC_PAN ≈ 159 mil, SRV_PCC, SRV_OBS, SRV_PAN), canales con OCC1, MOVIOLA, MOV, PML, PCC, PCCR, ATP, WCU_ATP, estaciones…, WCU_TTS, módulos del servidor, IxlManager; el PML o la sala MX del plano se pintan con «COMUNIC» |
| `detenido` | ALARM_* | 1 268 766 | CDV pintado con «DET n°»; el tren (por número o, sin número, el más cercano en su vía) queda detenido en el extremo de salida de ese CDV |
| `numero_tren` | COMMAND_ACK | 951 937 | Número de servicio dentro del tren (`1600` → `16`, `*7600` → `*76`) |
| `itinerario` | COMMAND_* | 127 921 | Ruta en verde de la señal origen a la destino, con la posición de cada aguja (N/I) y el tren que la usa |
| `arb` | ALARM_* | 126 247 | CDV pintado con «ARB» |
| `deslizamiento` | COMMAND_* | 120 559 | Deslizamiento en ámbar discontinuo a continuación de la señal, con las agujas en la posición del comando |
| `comando` | COMMAND_* (resto) | 67 981 | Destello de los elementos del comando (rojo si fue rechazado, con el motivo en la lista); MoverAguja: «MOV → N/I» 1 min sobre la aguja |
| `alarma` | ALARM_* (resto) | 65 583 | Elemento nombrado (CDV, aguja, señal, BFU) pintado con el nombre corto: OCUP. TREN, OCUP. INTEMP, RUTA BLOQ, SIN COMPROB, MOTOR AG, CONTROL AG, TALONADA, FOCO R/A/V, P. EMERG, SALTO SEC… |
| `tarjeta` | ALARM_* | 60 504 | Panel *Estado* |
| `degradado` | ALARM_* | 58 569 | Tren con borde rojo (si su número está asignado a una cabina) |
| `marca_comando` | COMMAND_* | 43 103 | Etiqueta sobre el elemento mientras está activo: FLOTA, ITI AUTO, DESL AUTO, SALTO, PROH. PUERTAS, BLOQ. MOV, BLOQUEO, BLOQ. SEÑAL, BLOQ. DESTINO; **RTV** (TSR_SPEED → CancelarTSR) pinta la sección rayada en amarillo |
| `ihm_conexion` | ALARM_* | 23 267 | Panel *Estado › Comunicaciones* |
| `cambio_numero` | TRAIN_CHANGED | 19 520 | Número de servicio actualizado |
| `ihm_area` | IHM_ZONE_CONTROL | 16 523 | Panel *Estado*: IHM que controla cada área |
| `ihm_servidor` | CONTROL_IHM | 11 655 | Panel *Estado*: servidor de cada IHM |
| `rebase` | ALARM_* | 10 680 | Andén con «REBASE» 5 min (casi nunca se normaliza en el log) |
| `nuevo_tren` | NEW_TRAIN | 9 042 | Destello de la sección donde se numera |
| `borrado` | TRAIN_DELETED | 8 444 | Se quita el número de servicio |
| `tren_hold` | COMMAND_ACK | 5 072 | «HOLD/SKIP n» junto al tren mientras el código no es 0 (falta la tabla de códigos) |
| `nrb` | ALARM_* | 1 946 | CDV pintado con «NRB» |
| `ixl_carga` | COMM_IXL_START/END_LOADING | 1 885 | Lista de eventos |
| `ihm_login` | IHM_LOGIN | 1 424 | Panel *Estado*: usuario en cada IHM |
| `tren_orden` | COMMAND_* | 1 422 | Etiqueta 1 min junto al tren: PUERTAS a/b (Remote_Door_Open_Close), CONTINUAR, LIB. FRENO EMERG |
| `ixl_conexion` | COMM_IXL_CONNECT | 880 | Fin de la desconexión |
| `ixl_desconexion` | COMM_IXL_DISCONNECT | 872 | Estaciones del enclavamiento / ATP en rojo hasta reconectar |
| `tren_stop` | COMMAND_* | 159 | «STOP REMOTO» junto al tren hasta *Release_Remote_Stop_Now* |
| `ihm_logoff` | IHM_LOGOFF | 73 | Panel *Estado*: fin de la sesión |
| `salio_control` | TRAIN_LEFT_CONTROL_CENTER | 7 | Lista de eventos (el número deja la zona de control) |
| `comando_tren` | COMMAND_ACK | 1 | **Pendiente**: otros ATS_I_* sólo en la lista de eventos |

**Ciclo de las alarmas.** Abierta → se pinta con trazo lleno. Normalizada → si después el operador la reconoce o
la cierra, queda con trazo discontinuo y «*» (pendiente de reconocer) hasta ese momento; si no hay reconocimiento
en el log, termina al normalizarse (así se comporta la gran mayoría: ciclo abierta → normalizada).

**Itinerarios.** El log da señal origen y destino; el recorrido se busca en el grafo de vías del plano (vías con sus
nodos, agujas con talón / recta / desviada, señales con su vía y sentido). Las 86 rutas distintas del log se
resuelven (entre dos caminos posibles, el de menos agujas invertidas). Vigencia: desde el ACK hasta que se cancela,
se establece otra desde la misma señal o una en conflicto (comparte secciones), o el tren asociado pasa la señal
destino o llega a su próxima parada (estimado). El tren es el primero que pasa por la señal origen después del ACK
y cuya parada anterior está sobre la ruta o conectada con su comienzo, y cuya parada siguiente queda sobre la ruta o
sobre la vía en la que termina; si ninguno cumple, la ruta se dibuja sin tren.

**Deslizamientos.** Posición de agujas por el nombre del comando (Normal, Invertida, Normal1Normal2, …); largo
hasta la primera junta pasada la última aguja (máx. ~140 unidades del lienzo). Se liberan cuando el tren se
detiene antes de la señal (45 s) o la pasa (estimado). Todos los deslizamientos del log se resuelven.

**Posición de los trenes.** Andén/AVC por TGMT (en las terminales el número de vía del TGMT es el andén: PAN 1/3/7,
OBS 1/2; las colas de PAN por el nombre del AVC: AVC1x → VA, 2x → VB, 4x → VC, 6x → VD); entre paradas, marcha tipo
del material y vía con arranque y frenado, siempre sobre el camino por las vías entre las dos paradas (y por la ruta
establecida, si es la del tren); detenido en CDV por la alarma (sólo en vía 1 / vía 2). El tren se dibuja con la inclinación de la vía
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
- **Códigos de Skip/Hold y de puertas remotas** (ATS_I_Train_Skip_Hold_Cmd #0/#3, ATS_I_Remote_Door_Open_Close #a#b):
  se muestran tal cual; falta la tabla de códigos.
- **Ubicación en la red de los enlaces de comunicación** (RMI_PCC_OBS / RMI_PCC_PAN, OCC1, MOVIOLA, MOV, PCC, PCCR,
  IxlManager, WCU_TTS): hoy se listan y se cuentan; para dibujarlos sobre los puestos (PCC, PML Pantitlán,
  PML Observatorio) hacen falta los planos de red e IHM (fase PCC/PML).