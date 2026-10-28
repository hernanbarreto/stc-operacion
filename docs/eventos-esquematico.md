# Eventos del ATS en el esquemático — qué se muestra y qué falta

Referencia para ir incorporando, de a poco, la representación de los eventos del log del ATS en el esquemático
de la Línea 1 (vista **Esquemático**, barra de reproducción y diagrama de hilo).

- Código: `src/components/esquematico/eventos.ts` (plantillas `PLANTILLAS`, modelo `interpretar`),
  `replay.ts` (estado en un instante), `capas.tsx` (dibujo), `Hilo.tsx` (diagrama de hilo).
- Log analizado: `eventos_2010-2610.xlsx` — 838 311 filas, del 18/10/2026 11:15 al 28/10/2026 03:03 (hora del log).
  Tras descartar los duplicados del log (mismo tipo y texto en menos de 2 s; el ATS registra cada evento 2–3
  veces) quedan **408 016 eventos**. 35 trenes, todas las cabinas TGMT están en la flota (`src/data/flota.ts`)
  y todos los identificadores de estación/AVC del TGMT tienen PK en el plano.
- Columnas del Excel usadas: `eventtype`, `sourcetime`, `description`.

Para agregar una representación: escribir o ajustar la plantilla en `PLANTILLAS` (expresión regular sobre
`description`, categoría y texto `muestra`), abrir o cerrar el intervalo correspondiente en `interpretar` y
dibujarlo en `EstadosSvg`/`TrenesSvg` (o en el panel de estado). `muestra: ''` marca una plantilla reconocida
pero todavía sin representación; la prueba `tests/esquematico.test.ts` exige que cada plantilla figure en este
documento.

## Qué se muestra hoy

Cantidades = eventos tras quitar duplicados, en todo el log.

| Plantilla | `eventtype` | Eventos | Cómo se muestra |
|---|---|---:|---|
| `llegada` | TGMT_ARRIVAL_AT_PLATFORM | 117 247 | Tren detenido en el andén (o AVC) con su número; vértice en el diagrama de hilo |
| `salida` | TGMT_DEPARTURE_AT_PLATFORM | 115 496 | Tren en marcha hacia la próxima parada, interpolado con la marcha tipo de su material |
| `salto` | TGMT_SKIP_PLATFORM | 774 | Paso sin parada (posición y diagrama de hilo) |
| `detenido` | ALARM_* | 42 599 | Sección/CDV resaltada en naranja mientras la alarma está abierta |
| `arb` | ALARM_* | 6 717 | Sección/CDV resaltada (ARB) mientras está abierta |
| `degradado` | ALARM_* | 1 989 | Tren con borde rojo mientras está abierta (si el número está asignado a una cabina) |
| `rebase` | ALARM_* | 300 | Andén resaltado 5 min (o hasta el cierre, si es antes: el log casi nunca la normaliza) |
| `tarjeta` | ALARM_* | 2 229 | Panel *Estado* (el texto no dice de qué enclavamiento es la tarjeta PM1/PM2) |
| `ihm_conexion` | ALARM_* | 943 | Panel *Estado* (IHM sin conexión con el servidor ATS) |
| `alarma` | ALARM_* (resto) | 3 802 | Elementos nombrados en el texto (agujas, señales, secciones, BFU) resaltados mientras está abierta; si el texto no nombra un elemento, sólo panel *Estado* |
| `dbo` | COMMAND_ACK / NACK | 40 663 | Andén con DBO activo desde el ACK de *Activar* hasta el de *Desactivar* |
| `numero_tren` | COMMAND_ACK | 1 131 | Número de servicio sobre el tren (cabina → número; `1600` → `16`, `*7600` → `*76`) |
| `comando` | COMMAND_* (resto) | 71 140 | Destello de los elementos del comando (señal, sección, andén, AVC) y fila en la lista de eventos |
| `cambio_numero` | TRAIN_CHANGED | 713 | Número de servicio actualizado sobre el tren |
| `nuevo_tren` | NEW_TRAIN | 335 | Destello de la sección donde se numera |
| `borrado` | TRAIN_DELETED | 321 | Se quita el número de servicio del tren |
| `ihm_area` | IHM_ZONE_CONTROL | 483 | Panel *Estado*: qué IHM controla cada área |
| `ihm_servidor` | CONTROL_IHM | 482 | Panel *Estado*: servidor que controla cada IHM |
| `ihm_login` | IHM_LOGIN | 52 | Panel *Estado*: usuario en cada IHM |
| `ihm_logoff` | IHM_LOGOFF | 4 | Panel *Estado*: fin de la sesión |
| `ixl_desconexion` | COMM_IXL_DISCONNECT | 90 | Estaciones del enclavamiento / ATP en rojo (nombre y botón) hasta reconectar |
| `ixl_conexion` | COMM_IXL_CONNECT | 94 | Fin de la desconexión |
| `ixl_carga` | COMM_IXL_START/END_LOADING | 183 | Sólo lista de eventos |
| `comando_tren` | COMMAND_ACK | 221 | **Pendiente** (ver abajo); sólo lista de eventos |
| *(sin plantilla)* | COMMAND_ACK | 8 | `TSR_SPEED` — sólo lista de eventos |

Todos los eventos aparecen además en la pestaña **Eventos** (filtros por categoría y por elemento o tren
seleccionado) y, los que nombran un elemento, como punto de color en el diagrama de hilo (clic → ir al evento).

## Qué falta mostrar

### Posición de los trenes

1. **Ocupación real de CDV.** El log no trae eventos de ocupación/liberación de circuitos de vía ni reportes
   de posición del TGMT: la posición sale sólo de llegadas/salidas en andén y, entre estaciones, se interpola
   con la marcha tipo. Hace falta el registro de ocupación del ATS (o el de posiciones CBTC) para ubicar el
   tren en el CDV real y mostrar trenes detenidos entre estaciones.
2. **Vías de maniobra.** Las paradas en vías 3, 4 y 7 (AVC de Pantitlán) se dibujan sobre la vía principal
   más cercana; falta llevarlas a la vía del plano.
3. **Alarma de tren detenido sin número.** 17 638 de 20 213 aperturas de `detenido` llegan con el número vacío
   (`Tren número  está detenido…`): se resalta el CDV pero no se asocia al tren. Se podría asociar por
   posición (tren ubicado en ese CDV en ese momento) cuando haya ocupación real.

### Comandos (`comando`, `comando_tren`, `TSR_SPEED`)

Hoy todos los comandos destellan los elementos que nombran. Falta una representación propia por tipo
(cantidades = filas del Excel, todas las variantes OPERATOR/ACK/NACK):

| Comando | Filas | Representación pendiente |
|---|---:|---|
| EstablecerItinerario / CancelarItinerario / CancelarItinerarioEmergencia | 5 731 / 874 / 196 | Dibujar el itinerario de señal a señal mientras está establecido. Requiere la **tabla de itinerarios** del enclavamiento (secciones y agujas de cada ruta), que no está en los planos |
| ActivarItinerarioAutomatico / Desactivar… | 335 / 163 | Marca de itinerario automático en la señal |
| EstablecerDeslizamiento* / CancelarDeslizamiento / …Automatico | ~5 300 | Deslizamiento (overlap) de la señal; requiere la misma tabla de itinerarios |
| CancelarDBONoCBTC | 19 754 | DBO no CBTC por señal; 9 787 rechazados por el enclavamiento: mostrar el rechazo |
| ReiniciarOcupacionLogica | 1 986 | Destello de la sección (hecho); falta marcar ocupación lógica reiniciada |
| ReinicioOcupacionLogicaGlobal (`PAN ESTE`) | 1 040 | Área sin elemento en el plano: falta definir qué secciones abarca cada área |
| MoverAguja* / NormalizarAgujaTalonada | ~180 | Posición normal/invertida de la aguja (hoy sólo se dibuja la normal asumida) |
| BloquearMovimiento / Bloquear / BloqueoSenal / BloqueoDestino / Cancelar… | ~200 | Bloqueos sobre señal o sección |
| ActivarVueltaAutomatica / Desactivar… | 506 / 266 | Marca de vuelta automática en la terminal |
| ActivarSaltoEstacion / Desactivar… | 178 / 58 | Andén con salto activo |
| ActivarModoFlota / Desactivar… | 96 / 26 | Indicación de modo flota |
| EstablecerCondicionesMojado/Seco… | 44 | Condición de adherencia por vía |
| `TSR_SPEED` / CancelarTSR | 8 / 8 | Restricción temporal de velocidad sobre la sección (el texto no trae el valor) |
| CancelarASR | 8 | Zona ASR de la hoja 25 |
| Activar/DesactivarProhibicionAperturaPuertas | 8 | Andén con prohibición de apertura |
| TomarMando / TomarMandoporEmergencia | 16 | Cambio de puesto de mando (fase PCC/PML) |
| Rearmar | 10 | — |
| `comando_tren`: ATS_I_Train_Skip_Hold_Cmd | 167 | Retención / salto ordenado al tren (código `#0`, `#3`…: falta la tabla de códigos) |
| `comando_tren`: ATS_I_Remote_Door_Open_Close | 54 | Apertura/cierre remoto de puertas del tren |

Además: los comandos **rechazados** (COMMAND_NACK, 12 488 tras quitar duplicados) se ven igual que los
ejecutados en el esquemático; falta distinguirlos.

### Alarmas genéricas (`alarma`)

Se abren y cierran como intervalo y resaltan los elementos que el texto nombra. Falta una representación
específica para (aperturas en el log):

| Alarma | Aperturas | Pendiente |
|---|---:|---|
| NRB activo en el circuito de vía … | 412 | Igual que ARB (color propio) |
| Tren reportando ocupación en … el cuál no está ocupado | 365 | Marca de discrepancia de ocupación en la sección |
| Liberación de la ruta bloqueada por el tren en señal … | 261 | Marca en la señal |
| Ocupación intempestiva en … | 203 | Marca en la sección / aguja |
| Aguja: pérdida de comprobación, motor, control, talonada | 189 | Estado de falla en la aguja |
| Señal … foco rojo/amarillo/verde en fallo | ~110 | Foco apagado/tachado en la señal |
| BFU … pulsador de parada de emergencia activado | 48 | BFU resaltado (hoy se resalta si el BFU está en el plano) |
| Fallo en el canal de comunicaciones con OCC1, PML, MOV, PCCR, PCC, WCU_ATP, ATP, MOVIOLA… | 85 | **Fase PCC/PML**: ubicar cada equipo en la red y en el esquemático (requiere planos de red e IHM) |
| PCC/OBS AIA ha perdido la conexión RMI (RMI_PCC_OBS, RMI_PCC_PAN, SRV_PCC, SRV_OBS) | ~50 | **Fase PCC/PML** |
| El Servidor ATS perdió la conexión con el módulo …; con IxlManager …; WCU_TTS | ~17 | **Fase PCC/PML** |
| Salto de secuencia en el enclavamiento … | 17 | Panel de estado del enclavamiento |
| Rearme necesario | 2 | — |

### Otros

- `tarjeta`: identificar a qué enclavamiento pertenece cada tarjeta PM (el texto no lo dice).
- `ihm_conexion`, `ihm_area`, `ihm_servidor`, `ihm_login`: hoy sólo en el panel *Estado*; en la fase PCC/PML
  se mostrarán sobre un esquema de puestos (PCC, PML Pantitlán, PML Observatorio) y la red.
- `degradado`: si el número no está asignado a ninguna cabina en ese momento, no se puede marcar el tren.
- `ixl_carga`: mostrar la carga del enclavamiento (estaciones en gris mientras carga).
- Marcha tipo: tiempos de recorrido y de parada de las tablas Siemens; falta el tiempo de vuelta en terminal
  para encadenar viajes.
