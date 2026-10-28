// Modelo de eventos del ATS para reproducir sobre el esquemático.
// Entrada: filas del log (eventtype, sourcetime, description). Salida: eventos tipificados con los elementos
// del esquemático que involucran, trenes con sus paradas, números de servicio, intervalos de estado
// (alarmas, DBO, marcas de comandos, enclavamiento desconectado…) y comandos de itinerario y deslizamiento.
import type { ElementoRef } from './types';
import { type Indice, resolver, resolverVia } from './resolver';
import { TRAIN_MAP, materialDe, type MaterialFlota } from '../../data/flota';
export { parseFecha } from './fecha';

export interface FilaLog { t: number; tipo: string; desc: string }

export type Categoria = 'movimiento' | 'alarma' | 'comando' | 'tren' | 'ihm' | 'enclavamiento' | 'otro';

export interface Evento {
  i: number;
  t: number;
  tipo: string;
  desc: string;
  cat: Categoria;
  plantilla: string;
  refs: ElementoRef[];
  tren?: string;          // tren físico (nombre de flota) si el evento lo identifica
  numero?: string;        // número de servicio
  estado?: 'abierta' | 'normalizada' | 'cerrada' | 'reconocida';
  rechazo?: string;       // COMMAND_NACK: motivo
}

export interface Parada { t: number; tipo: 'arr' | 'dep' | 'skip'; est: number; via: number; cab: string }

export interface Tren {
  clave: string;          // nombre de flota, p. ej. '27 (nm22)', o 'T32840' si la cabina no está en la flota
  material: MaterialFlota | null;
  cabinas: string[];
  paradas: Parada[];
}

export type TipoIntervalo = 'detenido' | 'arb' | 'nrb' | 'degradado' | 'rebase' | 'tarjeta' | 'ihm' | 'alarma'
  | 'dbo' | 'ixl' | 'marca';

export interface Intervalo {
  tipo: TipoIntervalo;
  clave: string;
  texto: string;
  etiqueta: string;       // texto corto que se dibuja junto al elemento
  t0: number;
  tN?: number;            // alarma normalizada (la condición desapareció)
  tAck?: number;          // reconocida por el operador
  t1: number | null;      // fin: cerrada / reconocida tras normalizar / normalizada sin reconocimiento; null = sigue
  refs: ElementoRef[];
  numero?: string;
  tren?: string;
}

/** Comando de itinerario ejecutado (COMMAND_ACK). */
export interface ComandoRuta { t: number; accion: 'establecer' | 'cancelar' | 'emergencia'; est: string; origen: string; destino?: string }
/** Comando de deslizamiento ejecutado (COMMAND_ACK). */
export interface ComandoDesl { t: number; comando: string; est: string; senal: string; cancelar: boolean }

export interface Plantilla {
  id: string;
  tipos: string[];        // eventtype a los que aplica ('*' = cualquiera)
  re: RegExp;
  cat: Categoria;
  muestra: string;        // cómo se representa en el esquemático ('' = pendiente)
}

const ALARMA = ['ALARM_OPENED', 'ALARM_NORMALIZED', 'ALARM_CLOSED', 'ALARM_ACK'];
const COMANDO = ['COMMAND_ACK', 'COMMAND_OPERATOR', 'COMMAND_NACK'];

/** Marcas de comandos con activación y desactivación: comando → [clase, etiqueta, abre?]. */
const MARCAS: Record<string, [string, string, boolean]> = {
  ActivarModoFlota: ['flota', 'FLOTA', true], DesactivarModoFlota: ['flota', 'FLOTA', false],
  ActivarItinerarioAutomatico: ['itiauto', 'ITI AUTO', true], DesactivarItinerarioAutomatico: ['itiauto', 'ITI AUTO', false],
  ActivarDeslizamientoAutomatico: ['deslauto', 'DESL AUTO', true], DesactivarDeslizamientoAutomatico: ['deslauto', 'DESL AUTO', false],
  ActivarVueltaAutomatica: ['vuelta', 'VUELTA AUT', true], DesactivarVueltaAutomatica: ['vuelta', 'VUELTA AUT', false],
  ActivarSaltoEstacion: ['salto', 'SALTO', true], DesactivarSaltoEstacion: ['salto', 'SALTO', false],
  ActivarProhibicionAperturaPuertas: ['puertas', 'PROH. PUERTAS', true], DesactivarProhibicionAperturaPuertas: ['puertas', 'PROH. PUERTAS', false],
  BloquearMovimiento: ['bloqmov', 'BLOQ. MOV', true], CancelarBloqueoMovimiento: ['bloqmov', 'BLOQ. MOV', false],
  Bloquear: ['bloqueo', 'BLOQUEO', true], CancelarBloqueo: ['bloqueo', 'BLOQUEO', false],
  BloqueoSenal: ['bloqsenal', 'BLOQ. SEÑAL', true], BloqueoDestino: ['bloqdest', 'BLOQ. DESTINO', true],
  TSR_SPEED: ['tsr', 'RTV', true], CancelarTSR: ['tsr', 'RTV', false],
};
const MARCA_RE = new RegExp(`[Cc]omando (${Object.keys(MARCAS).join('|')}) (?:(\\w{3}) )?(\\S+)(?: (?:ejecutado|rechazado)|$)`);

/** Plantillas reconocidas. `muestra` vacío = todavía no se representa en el esquemático (ver docs). */
export const PLANTILLAS: Plantilla[] = [
  { id: 'llegada', tipos: ['TGMT_ARRIVAL_AT_PLATFORM'], re: /^El tren (\d+) en la vía (\d+) ha llegado a la estación (\d+)/, cat: 'movimiento', muestra: 'posición del tren (detenido en andén / AVC) y diagrama de hilo' },
  { id: 'salida', tipos: ['TGMT_DEPARTURE_AT_PLATFORM'], re: /^El tren (\d+) en la vía (\d+) ha salido a la estación (\d+)/, cat: 'movimiento', muestra: 'posición del tren (en marcha, interpolada con la marcha tipo) y diagrama de hilo' },
  { id: 'salto', tipos: ['TGMT_SKIP_PLATFORM'], re: /^El tren (\d+) en la vía (\d+) se ha saltado la estación (\d+)/, cat: 'movimiento', muestra: 'paso sin parada en el diagrama de hilo y posición del tren' },
  { id: 'detenido', tipos: ALARMA, re: /^Tren número (\S*) está detenido en el circuito de vía (\w+)/, cat: 'alarma', muestra: 'CDV pintado con «DET n°» y el tren ubicado en ese CDV' },
  { id: 'arb', tipos: ALARMA, re: /^ARB activo en el circuito de vía (\w+) \((\w+)\)/, cat: 'alarma', muestra: 'CDV pintado con «ARB»' },
  { id: 'nrb', tipos: ALARMA, re: /^NRB activo en el circuito de vía (\w+) \((\w+)\)/, cat: 'alarma', muestra: 'CDV pintado con «NRB»' },
  { id: 'degradado', tipos: ALARMA, re: /^El tren número (\S+) ha sido degradado/, cat: 'alarma', muestra: 'tren con borde rojo (si su número está asignado a una cabina)' },
  { id: 'rebase', tipos: ALARMA, re: /^El tren (\d+) se ha pasado el punto de parada de la plataforma (\d+) en la estación (\d+)/, cat: 'alarma', muestra: 'andén con «REBASE» 5 min (o hasta el cierre)' },
  { id: 'tarjeta', tipos: ALARMA, re: /^Tarjeta (PM\d+) del enclavamiento en fallo/, cat: 'enclavamiento', muestra: 'panel de estado (el texto no indica qué enclavamiento)' },
  { id: 'ihm_conexion', tipos: ALARMA, re: /^El Servidor ATS perdió la conexión con el IHM (\d+)/, cat: 'ihm', muestra: 'panel de estado (IHM sin conexión)' },
  { id: 'alarma', tipos: ALARMA, re: /^/, cat: 'alarma', muestra: 'elemento nombrado (CDV, aguja, señal, BFU) pintado con el nombre corto de la alarma' },
  { id: 'dbo', tipos: COMANDO, re: /[Cc]omando (Activar|Desactivar)DBOCBTC (\w{3}) (\w+)/, cat: 'comando', muestra: 'cuadrado rojo «DBO» en el andén mientras está activo' },
  { id: 'dbo_nocbtc', tipos: COMANDO, re: /[Cc]omando (DBONoCBTC|CancelarDBONoCBTC) (\w{3}) (\w+)/, cat: 'comando', muestra: 'cuadrado rojo «DBO» en la señal mientras está activo' },
  { id: 'itinerario', tipos: COMANDO, re: /[Cc]omando (EstablecerItinerario|CancelarItinerarioEmergencia|CancelarItinerario) (\w{3}) (\w+)(?: (\w+))?(?: (?:ejecutado|rechazado)|$)/, cat: 'comando', muestra: 'ruta de señal a señal (recorrido inferido del plano) con posición de agujas y tren que la usa' },
  { id: 'deslizamiento', tipos: COMANDO, re: /[Cc]omando (EstablecerDeslizamiento\w+|CancelarDeslizamiento) (\w{3}) (\w+)/, cat: 'comando', muestra: 'deslizamiento a continuación de la señal con la posición de agujas del comando' },
  { id: 'marca_comando', tipos: COMANDO, re: MARCA_RE, cat: 'comando', muestra: 'etiqueta sobre el elemento mientras está activo (FLOTA, ITI AUTO, DESL AUTO, SALTO, PROH. PUERTAS, BLOQ…); RTV (TSR_SPEED) pinta la sección rayada' },
  { id: 'numero_tren', tipos: COMANDO, re: /ATS_I_Train_Number#(\d+)#(\d+)#(\*?\d+)/, cat: 'tren', muestra: 'número de servicio sobre el tren (cabina → número)' },
  { id: 'comando_tren', tipos: COMANDO, re: /[Cc]omando (ATS_I_\w+)#/, cat: 'comando', muestra: '' },
  { id: 'comando', tipos: COMANDO, re: /[Cc]omando (\S+) (\w{3}) (\S+)(?: (\S+))?/, cat: 'comando', muestra: 'destello de los elementos del comando (rojo si fue rechazado)' },
  { id: 'cambio_numero', tipos: ['TRAIN_CHANGED'], re: /^Tren numerado (\S+) cambió a (\S+)/, cat: 'tren', muestra: 'número de servicio actualizado sobre el tren' },
  { id: 'nuevo_tren', tipos: ['NEW_TRAIN'], re: /^Tren numerado como (\S+) en el (\w+)/, cat: 'tren', muestra: 'destello de la sección donde se numera' },
  { id: 'borrado', tipos: ['TRAIN_DELETED'], re: /^Número de tren (\S+) fue borrado/, cat: 'tren', muestra: 'se quita el número de servicio del tren' },
  { id: 'ihm_area', tipos: ['IHM_ZONE_CONTROL'], re: /^IHM (\d+) toma control del área (\w+)/, cat: 'ihm', muestra: 'panel de estado (área → IHM que la controla)' },
  { id: 'ihm_servidor', tipos: ['CONTROL_IHM'], re: /^Servidor (\d+) controla el IHM (\d+)/, cat: 'ihm', muestra: 'panel de estado' },
  { id: 'ihm_login', tipos: ['IHM_LOGIN'], re: /^Usuario (\S+) ingresa en el IHM (\d+)/, cat: 'ihm', muestra: 'panel de estado (usuario en cada IHM)' },
  { id: 'ihm_logoff', tipos: ['IHM_LOGOFF'], re: /^Usuario (\S+) se desconectó IHM (\d+)/, cat: 'ihm', muestra: 'panel de estado' },
  { id: 'ixl_desconexion', tipos: ['COMM_IXL_DISCONNECT'], re: /enclavamiento (\w+)\s*$/, cat: 'enclavamiento', muestra: 'estaciones del enclavamiento/ATP en rojo hasta reconectar' },
  { id: 'ixl_conexion', tipos: ['COMM_IXL_CONNECT'], re: /conectado: (\w+)\s*$/, cat: 'enclavamiento', muestra: 'fin de la desconexión' },
  { id: 'ixl_carga', tipos: ['COMM_IXL_START_LOADING', 'COMM_IXL_END_LOADING'], re: /(?:enclavamiento|enclavamiento:) (\w+)\s*$/, cat: 'enclavamiento', muestra: 'lista de eventos' },
];

const REBASE_MS = 5 * 60 * 1000;
const MOVER_AGUJA_MS = 60 * 1000;

const ESTADO_RE = /\s\.\s(Abierta|Normalizada|Cerrada|Reconocida)\s*$/;
const ESTADOS: Record<string, Evento['estado']> = {
  Abierta: 'abierta', Normalizada: 'normalizada', Cerrada: 'cerrada', Reconocida: 'reconocida',
};

export function nombreTren(cab: string): string {
  return TRAIN_MAP[cab] ?? `T${cab}`;
}

/** '1600' → '16', '*7600' → '*76' (formato de ATS_I_Train_Number). */
export function numeroServicio(raw: string): string {
  const m = /^(\*?)(\d+)$/.exec(raw);
  if (!m) return raw;
  const d = m[2].length === 4 ? m[2].slice(0, 2) : m[2];
  return m[1] + d;
}

/** Nombre corto de una alarma para dibujar junto al elemento. */
export function etiquetaAlarma(texto: string): string {
  const reglas: [RegExp, string | ((m: RegExpExecArray) => string)][] = [
    [/^Tren número (\S*) está detenido/, m => (m[1] ? `DET ${m[1]}` : 'DET')],
    [/^ARB activo/, 'ARB'], [/^NRB activo/, 'NRB'],
    [/[Oo]cupación intempestiva/, 'OCUP. INTEMP'],
    [/reportando ocupación/, 'OCUP. TREN'],
    [/Liberacion de la ruta bloqueada/, 'RUTA BLOQ'],
    [/[Pp]erdida de comprobacion/, 'SIN COMPROB'],
    [/Motor de aguja/, 'MOTOR AG'],
    [/control de la aguja/, 'CONTROL AG'],
    [/talonada/, 'TALONADA'],
    [/foco (rojo|amarillo|verde) en fallo/, m => `FOCO ${m[1][0].toUpperCase()}`],
    [/[Pp]ulsador de parada de emergencia/, 'P. EMERG'],
    [/se ha pasado el punto de parada/, 'REBASE'],
    [/Fallo en el canal de comunicaciones/, 'COMUNIC'],
  ];
  for (const [re, f] of reglas) {
    const m = re.exec(texto);
    if (m) return typeof f === 'string' ? f : f(m);
  }
  return texto.split(/\s+/).slice(0, 2).join(' ').toUpperCase().slice(0, 14);
}

const NO_ELEMENTO = new Set(['PANIXL', 'OBSIXL', 'PANATP', 'OBSATP', 'PANTTS', 'IXL', 'ATS', 'CBTC']);

function refsGenericos(ix: Indice, texto: string): ElementoRef[] {
  const out: ElementoRef[] = [];
  const vistos = new Set<string>();
  for (const m of texto.matchAll(/\b[A-Z*][A-Z0-9_*]{3,}\b/g)) {
    const tok = m[0];
    if (NO_ELEMENTO.has(tok)) continue;
    const r = resolver(ix, tok);
    if (r && r.tipo !== 'pk' && r.tipo !== 'estacion') {
      const k = `${r.tipo}:${r.id}`;
      if (!vistos.has(k)) { vistos.add(k); out.push(r); }
    }
  }
  return out;
}

function refEstacion(ix: Indice, est: number): ElementoRef[] {
  const r = ix.tgmt.get(est);
  return r ? [r] : [];
}

function refAnden(ix: Indice, codigoEst: string | null, plataforma: string): ElementoRef[] {
  if (!codigoEst) return [];
  const r = resolver(ix, `${codigoEst}${plataforma}`);
  return r ? [r] : [];
}

function refElemento(ix: Indice, id: string): ElementoRef[] {
  const asr = /^TGMT_(ASR_\w+?)ASR$/.exec(id);
  const r = resolverVia(ix, asr ? asr[1] : id) ?? resolver(ix, asr ? asr[1] : id);
  return r && r.tipo !== 'pk' && r.tipo !== 'estacion' ? [r] : [];
}

export interface ModeloEventos {
  eventos: Evento[];
  trenes: Tren[];
  intervalos: Intervalo[];
  numeros: Map<string, { t: number; numero: string | null }[]>;   // por cabina
  areasIhm: { t: number; ihm: string; area: string }[];
  sesionesIhm: { t: number; ihm: string; usuario: string | null }[];
  servidoresIhm: { t: number; ihm: string; servidor: string }[];
  itinerarios: ComandoRuta[];
  deslizamientos: ComandoDesl[];
  t0: number;
  t1: number;
  conteo: Map<string, { plantilla: string; tipo: string; n: number }>;
}

/** Interpreta el log. Las filas deben venir ordenadas por tiempo; se descartan duplicados (mismo tipo y texto en < 2 s). */
export function interpretar(filas: FilaLog[], ix: Indice): ModeloEventos {
  const eventos: Evento[] = [];
  const trenes = new Map<string, Tren>();
  const intervalos: Intervalo[] = [];
  const abiertos = new Map<string, Intervalo>();
  const numeros = new Map<string, { t: number; numero: string | null }[]>();
  const cabDeNumero = new Map<string, string>();
  const areasIhm: ModeloEventos['areasIhm'] = [];
  const sesionesIhm: ModeloEventos['sesionesIhm'] = [];
  const servidoresIhm: ModeloEventos['servidoresIhm'] = [];
  const itinerarios: ComandoRuta[] = [];
  const deslizamientos: ComandoDesl[] = [];
  const conteo = new Map<string, { plantilla: string; tipo: string; n: number }>();
  const ultimo = new Map<string, number>();

  const finPendiente = (iv: Intervalo, t: number) => {
    // abierta sin normalizar: termina en t; normalizada: si el operador la reconoció después, hasta el
    // reconocimiento; si no, en la normalización (no quedó pendiente)
    if (iv.tN == null) return t;
    return iv.tAck != null && iv.tAck >= iv.tN ? iv.tAck : iv.tN;
  };
  const abrir = (iv: Intervalo) => {
    const prev = abiertos.get(iv.clave);
    if (prev) {
      if (prev.tN == null && iv.tipo !== 'marca') return;           // sigue abierta: se ignora la repetición
      prev.t1 = prev.tipo === 'marca' ? iv.t0 : finPendiente(prev, iv.t0);
    }
    abiertos.set(iv.clave, iv);
    intervalos.push(iv);
  };
  const cerrar = (clave: string, t: number) => { const iv = abiertos.get(clave); if (iv) { iv.t1 = t; abiertos.delete(clave); } };
  const asignarNumero = (cab: string, t: number, numero: string | null) => {
    const l = numeros.get(cab) ?? [];
    if (!l.length || l[l.length - 1].numero !== numero) l.push({ t, numero });
    numeros.set(cab, l);
    for (const [n, c] of cabDeNumero) if (c === cab) cabDeNumero.delete(n);
    if (numero) cabDeNumero.set(numero, cab);
  };
  const codigoEst = (est: number) => {
    const r = ix.tgmt.get(est);
    return r?.tipo === 'estacion' ? r.id : null;
  };
  /** Ciclo de una alarma: abierta → normalizada → (reconocida) → cerrada. */
  const alarma = (f: FilaLog, tipo: TipoIntervalo, clave: string, refs: ElementoRef[], extra: Partial<Intervalo> = {}) => {
    if (f.tipo === 'ALARM_OPENED') {
      abrir({ tipo, clave, texto: clave, etiqueta: etiquetaAlarma(clave), t0: f.t, t1: null, refs, ...extra });
      return;
    }
    const iv = abiertos.get(clave);
    if (!iv) return;
    if (f.tipo === 'ALARM_NORMALIZED') iv.tN ??= f.t;
    else if (f.tipo === 'ALARM_ACK') iv.tAck ??= f.t;
    else if (f.tipo === 'ALARM_CLOSED') cerrar(clave, f.t);
  };

  for (const f of filas) {
    const dk = `${f.tipo}|${f.desc}`;
    const prev = ultimo.get(dk);
    ultimo.set(dk, f.t);
    if (prev != null && f.t - prev < 2000) continue;

    const tpl = PLANTILLAS.find(p => (p.tipos.includes(f.tipo) || p.tipos.includes('*')) && p.re.test(f.desc));
    const m = tpl ? tpl.re.exec(f.desc) : null;
    const ev: Evento = {
      i: eventos.length, t: f.t, tipo: f.tipo, desc: f.desc,
      cat: tpl?.cat ?? (f.tipo.startsWith('ALARM') ? 'alarma' : f.tipo.startsWith('COMMAND') ? 'comando' : 'otro'),
      plantilla: tpl?.id ?? 'sin_plantilla', refs: [],
    };
    const ck = `${ev.plantilla}|${f.tipo}`;
    const c = conteo.get(ck) ?? { plantilla: ev.plantilla, tipo: f.tipo, n: 0 };
    c.n++;
    conteo.set(ck, c);

    const est = ESTADO_RE.exec(f.desc);
    if (est) ev.estado = ESTADOS[est[1]];
    if (f.tipo === 'COMMAND_NACK') ev.rechazo = /rechazado por \w+:\s*(.+)$/.exec(f.desc)?.[1]?.trim() ?? 'rechazado';
    const claveAlarma = f.desc.replace(ESTADO_RE, '').trim();
    const ack = f.tipo === 'COMMAND_ACK';

    switch (tpl?.id) {
      case 'llegada':
      case 'salida':
      case 'salto': {
        const cab = m![1];
        const clave = nombreTren(cab);
        const tr = trenes.get(clave) ?? { clave, material: materialDe(clave), cabinas: [], paradas: [] };
        if (!tr.cabinas.includes(cab)) tr.cabinas.push(cab);
        tr.paradas.push({ t: f.t, tipo: tpl.id === 'llegada' ? 'arr' : tpl.id === 'salida' ? 'dep' : 'skip', est: +m![3], via: +m![2], cab });
        trenes.set(clave, tr);
        ev.tren = clave;
        ev.refs = refEstacion(ix, +m![3]);
        break;
      }
      case 'detenido':
      case 'arb':
      case 'nrb': {
        const r = resolverVia(ix, m![tpl.id === 'detenido' ? 2 : 1]);
        ev.refs = r ? [r] : [];
        if (tpl.id === 'detenido' && m![1]) ev.numero = m![1];
        alarma(f, tpl.id, claveAlarma, ev.refs, { numero: ev.numero });
        break;
      }
      case 'degradado':
        ev.numero = m![1];
        alarma(f, 'degradado', claveAlarma, [], { numero: m![1] });
        break;
      case 'rebase':
        ev.tren = nombreTren(m![1]);
        ev.refs = refAnden(ix, codigoEst(+m![3]), m![2]);
        alarma(f, 'rebase', claveAlarma, ev.refs, { tren: ev.tren });
        break;
      case 'tarjeta':
      case 'ihm_conexion':
      case 'alarma':
        if (tpl.id === 'alarma') ev.refs = refsGenericos(ix, claveAlarma);
        alarma(f, tpl.id === 'tarjeta' ? 'tarjeta' : tpl.id === 'ihm_conexion' ? 'ihm' : 'alarma', claveAlarma, ev.refs);
        break;
      case 'dbo':
      case 'dbo_nocbtc': {
        ev.refs = refElemento(ix, m![3]);
        if (ack) {
          const clave = `DBO ${m![3]}`;
          if (m![1] === 'Activar' || m![1] === 'DBONoCBTC') {
            abrir({ tipo: 'dbo', clave, texto: `DBO${tpl.id === 'dbo' ? '' : ' no CBTC'} en ${m![3]}`, etiqueta: 'DBO', t0: f.t, t1: null, refs: ev.refs });
          } else cerrar(clave, f.t);
        }
        break;
      }
      case 'itinerario': {
        const accion = m![1] === 'EstablecerItinerario' ? 'establecer' : m![1] === 'CancelarItinerario' ? 'cancelar' : 'emergencia';
        ev.refs = [m![3], m![4]].filter(Boolean).flatMap(id => refElemento(ix, id as string));
        if (ack) itinerarios.push({ t: f.t, accion, est: m![2], origen: m![3], destino: accion === 'establecer' ? m![4] : undefined });
        break;
      }
      case 'deslizamiento':
        ev.refs = refElemento(ix, m![3]);
        if (ack) deslizamientos.push({ t: f.t, comando: m![1], est: m![2], senal: m![3], cancelar: m![1] === 'CancelarDeslizamiento' });
        break;
      case 'marca_comando': {
        const [clase, etiqueta, abre] = MARCAS[m![1]];
        ev.refs = refElemento(ix, m![3]);
        if (ack) {
          const clave = `${clase} ${m![3]}`;
          if (abre) abrir({ tipo: 'marca', clave, texto: `${m![1]} ${m![3]}`, etiqueta, t0: f.t, t1: null, refs: ev.refs });
          else cerrar(clave, f.t);
        }
        break;
      }
      case 'numero_tren':
        ev.tren = nombreTren(m![1]);
        ev.numero = numeroServicio(m![3]);
        if (ack) asignarNumero(m![1], f.t, ev.numero);
        break;
      case 'comando': {
        const args = [m![3], m![4]].filter(Boolean) as string[];
        ev.refs = args.flatMap(a => refElemento(ix, a));
        // posición ordenada de una aguja (no hay comprobación en el log): marca breve sobre la aguja
        const mv = /^MoverAguja(Normal|Invertida)?(Emergencia)?$/.exec(m![1]);
        if (mv && ack && ev.refs.length) {
          const etiqueta = mv[1] === 'Normal' ? 'MOV → N' : mv[1] === 'Invertida' ? 'MOV → I' : 'MOV';
          intervalos.push({ tipo: 'marca', clave: `mov ${m![3]} ${f.t}`, texto: `${m![1]} ${m![3]}`, etiqueta, t0: f.t, t1: f.t + MOVER_AGUJA_MS, refs: ev.refs });
        }
        break;
      }
      case 'cambio_numero': {
        const cab = cabDeNumero.get(m![1]);
        if (cab) asignarNumero(cab, f.t, m![2]);
        ev.numero = m![2];
        if (cab) ev.tren = nombreTren(cab);
        break;
      }
      case 'nuevo_tren': {
        const r = resolverVia(ix, m![2]);
        ev.refs = r ? [r] : [];
        ev.numero = m![1];
        break;
      }
      case 'borrado': {
        const cab = cabDeNumero.get(m![1]);
        if (cab) { asignarNumero(cab, f.t, null); ev.tren = nombreTren(cab); }
        ev.numero = m![1];
        break;
      }
      case 'ihm_area':
        areasIhm.push({ t: f.t, ihm: m![1], area: m![2] });
        break;
      case 'ihm_servidor':
        servidoresIhm.push({ t: f.t, servidor: m![1], ihm: m![2] });
        break;
      case 'ihm_login':
        sesionesIhm.push({ t: f.t, usuario: m![1], ihm: m![2] });
        break;
      case 'ihm_logoff':
        sesionesIhm.push({ t: f.t, usuario: null, ihm: m![2] });
        break;
      case 'ixl_desconexion':
        abrir({ tipo: 'ixl', clave: `IXL ${m![1]}`, texto: `${m![1]} desconectado del ATS`, etiqueta: 'DESCONECTADO', t0: f.t, t1: null, refs: [] });
        break;
      case 'ixl_conexion':
        cerrar(`IXL ${m![1]}`, f.t);
        break;
      default:
        if (!tpl) ev.refs = refsGenericos(ix, f.desc);
    }
    eventos.push(ev);
  }
  for (const tr of trenes.values()) tr.paradas.sort((a, b) => a.t - b.t);
  // alarmas normalizadas sin cierre: terminan al reconocerlas (si hubo reconocimiento) o al normalizarse
  for (const iv of intervalos) if (iv.t1 == null && iv.tN != null) iv.t1 = finPendiente(iv, iv.tN);
  // el rebase es puntual y casi nunca se normaliza en el log: se muestra 5 min (o hasta su cierre, si es antes)
  for (const iv of intervalos) if (iv.tipo === 'rebase' && (iv.t1 == null || iv.t1 - iv.t0 > REBASE_MS)) iv.t1 = iv.t0 + REBASE_MS;
  return {
    eventos, trenes: [...trenes.values()].sort((a, b) => a.clave.localeCompare(b.clave)), intervalos, numeros, areasIhm,
    sesionesIhm, servidoresIhm, itinerarios, deslizamientos,
    t0: eventos.length ? eventos[0].t : 0, t1: eventos.length ? eventos[eventos.length - 1].t : 0, conteo,
  };
}

/** Último valor de una serie temporal ≤ t (búsqueda binaria). */
export function valorEn<T extends { t: number }>(serie: T[], t: number): T | null {
  let lo = 0, hi = serie.length - 1, res = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (serie[m].t <= t) { res = m; lo = m + 1; } else hi = m - 1;
  }
  return res >= 0 ? serie[res] : null;
}

/** Índice del primer evento con t ≥ tiempo. */
export function indiceEvento(eventos: Evento[], t: number): number {
  let lo = 0, hi = eventos.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (eventos[m].t < t) lo = m + 1; else hi = m;
  }
  return lo;
}

/** Número de servicio de un tren en el instante t (por cualquiera de sus cabinas). */
export function numeroEn(mod: ModeloEventos, tren: Tren, t: number): string | null {
  let mejor: { t: number; numero: string | null } | null = null;
  for (const cab of tren.cabinas) {
    const v = valorEn(mod.numeros.get(cab) ?? [], t);
    if (v && (!mejor || v.t > mejor.t)) mejor = v;
  }
  return mejor?.numero ?? null;
}
