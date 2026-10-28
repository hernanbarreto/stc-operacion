// Tipos del archivo public/data/esquematico_l1.json (generado por tools/esquematico/extract.py).
// Coordenadas en puntos PDF de la hoja 1/25 del plano de señalización; x crece hacia Pantitlán.

export type Tramo = [number, number, number, number]; // x0, y0, x1, y1

export interface Fuente {
  id: 'SEN' | 'CDV' | 'LOG' | string;
  codigo: string;
  titulo: string;
  revision: string;
  fecha_revision: string;
  descripcion_revision?: string;
  hoja?: string;
  ot?: string;
  emisor?: string;
  contrato?: string;
  uso?: string;
  sha256?: string;
  historial?: [string, string, string][];
  documentacion_de_referencia?: string[];
}

export interface Estacion {
  codigo: string;
  nombre: string;
  tgmt_id: number;
  mx: string;
  x: number | null;
  andenes: number;
  enclavamiento?: string | null;
  atp?: string | null;
  enclavamiento_fuente?: string;
}

export interface Via {
  id: number;
  via: string;
  pts: Tramo;
  a: number;
  b: number;
}

export interface Seccion {
  id: string;
  tipo: 'virtual' | 'aguja';
  cdv: string | null;
  estacion: string | null;
  vias: string[];
  longitud_m: number | null;
  tramos: Tramo[];
  etiqueta: { x: number; y: number } | null;
}

export interface Cdv {
  id: string;
  alias: string[];
  nombre_inferido: boolean;
  estacion: string | null;
  vias: string[];
  secciones: string[];
  tipo: string | null;
  frecuencia: { codigo: string | null; khz: number; texto?: string } | null;
  en_plano_cdv: boolean;
  pk_juntas: number[];
  longitud_secciones_m: number | null;
  tramos: Tramo[];
  armarios?: string[];
}

export interface Junta {
  tipo: 'fisica' | 'virtual';
  x: number;
  y: number;
  via: string | null;
  pk: number | null;
  pk_texto: string | null;
  tipo_cdv: string | null;          // tipo de lazo / junta según el plano de CDV: LS, LC, LT, AC, JAR, J
  tipos_cdv?: string[];             // si en ese punto el plano de CDV marca varias (p. ej. AC, JAR, LT)
  via_cdv?: string;                 // nombre de la vía en el plano de CDV cuando difiere del de señalización
  sintonia?: string[][];            // unidades D10-Bn junto a la junta (plano de CDV)
  r?: string[];                     // R / R1 / R2 (plano de CDV)
  compensacion?: boolean;           // (*) lazo de 300 mm² para compensar la corriente de tracción
  armarios?: string[];              // ubicación de equipos de CDV que cubre la junta
}

export interface Senal {
  id: string;
  tipo: 'principal' | 'fin_de_via';
  estacion: string | null;
  focos: ('R' | 'V' | 'A')[];
  sentido: 'PAN' | 'OBS' | null;
  x: number;
  y: number;
  lado: 'arriba' | 'abajo' | null;
  via: string | null;
  edge: number | null;
  pk: number | null;
  pk_texto: string | null;
  head: { x0: number; x1: number; cy: number } | null;  // cabeza de focos según el plano
  etiqueta: { x: number; y: number } | null;
  obs?: string;
}

export interface Aguja {
  id: string;
  estacion: string | null;
  x?: number;
  y?: number;
  nodo?: number;
  via?: string;
  talon_edge?: number;
  recta_edge?: number;
  desviada_edge?: number;
  via_recta?: string;
  via_desviada?: string;
  normal?: string;
  pk?: number | null;
  pk_texto?: string | null;
  pk_desviada_local?: number | null;
  etiqueta?: { x: number; y: number } | null;
  obs?: string;
}

export interface Anden {
  ids: string[];
  estacion: string | null;
  mx: string | null;
  plataforma: string | null;
  via: string | null;
  x0: number;
  x1: number;
  y_borde: number;
  y_via: number;
  lado: 'arriba' | 'abajo';
  pk_centro: number | null;
  pk_centro_texto: string | null;
  bfu: string[];
  equipos: string[];
}

export interface Baliza {
  id: string;
  provisional: boolean;
  x: number;
  y: number;
  pk: number | null;
  pk_texto: string | null;
  via?: string | null;
  seccion?: string | null;
  cdv?: string | null;
  estacion?: string | null;
}

export interface Psp {
  x: number;
  y: number;
  pk_candidatos: (number | null)[];
}

export interface MarcadorAl {
  senal: string;
  x: number;
  y: number;
}

export interface PuntoLibramiento {
  aguja: string;
  x: number;
  y: number;
  pk: number | null;
}

export interface Avc {
  id: string;
  alias?: string[];
  provisional: boolean;
  x: number;
  y: number;
  pk_ini: number | null;
  pk_fin: number | null;
  tgmt_id: number | null;
}

export interface Tope {
  id: string;
  x: number;
  y: number;
  nodo?: number;
  obs?: string;
}

export interface Limite {
  x: number;
  y0: number;
  y1: number;
  tipo: 'estacion' | 'wcu';
  izq: string | null;
  der: string | null;
}

export interface Observacion {
  tipo: string;
  detalle: string;
  x?: number;
  y?: number;
  largo_pt?: number;
}

export interface ZonaVelocidad {
  tipo: 'estacion' | 'curva';
  nombre: string;
  via: string | null;
  x0: number;
  x1: number;
  pk_ini: number | null;
  pk_fin: number | null;
  v: number | null;                 // velocidad de la zona (km/h)
  v_fuera: number | null;           // velocidad fuera de la zona
  y: number;
  radio_m?: number | null;
  incompleta?: boolean;
}

export interface Pendiente {
  nombre: string;
  via: string | null;
  aguja: string | null;
  x0: number | null;
  x1: number | null;
  pk_ini: number | null;
  pk_fin: number | null;
  permil: number | null;
  y: number;
}

export interface PuntoPendiente {
  pk: number | null;
  pk_texto: string;
  x: number;
  y: number;
  p_izq: number | null;
  p_der: number | null;
  n_izq: string | null;
  n_der: string | null;
}

export interface VelocidadAguja {
  aguja: string;
  v: number | null;
  pk_local: string[];
  x: number;
  y: number;
}

export interface Perfil {
  zonas_velocidad: ZonaVelocidad[];
  velocidad_agujas: VelocidadAguja[];
  pendientes: Pendiente[];
  puntos_pendiente: PuntoPendiente[];
}

export interface Equipo {
  tipo: 'MX' | 'OC' | 'ZC' | 'WCU' | 'RESET' | 'PML' | 'SALA' | string;
  id: string;
  provisional: boolean;
  x: number | null;
  y?: number;
  pk?: number | null;
  lado?: 'arriba' | 'abajo';
  via?: string | null;
  estacion: string | null;
  fuente: 'SEN' | 'CDV' | string;
}

export interface Zona {
  id: string;
  tipo: 'RAUZ' | 'ASR' | string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  vias: string[];
  pk_ini: number | null;
  pk_fin: number | null;
  hoja: number;
}

export interface Armario {
  id: string;                       // rótulo del plano (puede repetirse)
  clave: string;                    // identificador único (rótulo, o rótulo@PK si se repite)
  nota: string | null;
  capacidad: string | null;
  x: number | null;
  x0: number | null;
  x1: number | null;
  pk: number | null;
  pk_ini: number | null;
  pk_fin: number | null;
  lado: 'arriba' | 'abajo';
  estacion: string;
}

export interface Subestacion {
  nombre: string | null;
  pk: number | null;
  pk_texto: string | null;
  x: number | null;
  fuente: string;
  obs?: string;
}

export interface Cartel {
  tipo: 'aviso' | 'ejecucion';
  texto: string;
  pk: number | null;
  pk_texto: string | null;
  x: number | null;
}

export interface TramoObra {
  texto: string;
  tipo: 'inicio' | 'fin';
  pk: number | null;
  x: number | null;
}

export interface Rotulo {
  texto: string;
  x: number;
  y: number;
  size: number;
  ang: number;
  fuente: string;
}

export interface EntradaEncabezado {
  texto: string;
  pk: number | null;
  pk_texto: string | null;
  pk_aux: string | null;
  color: string;
  x: number | null;
  fuente: 'SEN' | 'CDV' | string;
}

export interface Nota {
  texto: string;
  fuente: string;
}

export interface Esquematico {
  esquema: string;
  version: number;
  generado: string;
  fuentes: Fuente[];
  capas: Record<string, string[]>;
  lienzo: { ancho: number; alto: number; area: [number, number, number, number]; nota: string };
  estaciones: Estacion[];
  vias: Via[];
  secciones: Seccion[];
  cdvs: Cdv[];
  juntas: Junta[];
  senales: Senal[];
  agujas: Aguja[];
  andenes: Anden[];
  balizas: Baliza[];
  psp: Psp[];
  marcadores_al: MarcadorAl[];
  puntos_libramiento: PuntoLibramiento[];
  avc: Avc[];
  topes: Tope[];
  limites: Limite[];
  eje_pk: [number, number, string][];
  observaciones: Observacion[];
  regla_sen?: [number, number][];   // regla de PK del plano de señalización: [x, pk]
  regla_cdv?: [number, number][];   // regla de PK del plano de CDV: [x en su hoja, pk]
  perfil?: Perfil;
  equipos?: Equipo[];
  zonas?: Zona[];
  armarios?: Armario[];
  subestaciones?: Subestacion[];
  carteles?: Cartel[];
  tramos?: TramoObra[];
  rotulos?: Rotulo[];
  encabezado?: EntradaEncabezado[];
  notas?: Nota[];
}

/** Referencia a un elemento seleccionable del esquemático. */
export type ElementoRef =
  | { tipo: 'seccion'; id: string }
  | { tipo: 'cdv'; id: string }
  | { tipo: 'senal'; id: string }
  | { tipo: 'aguja'; id: string }
  | { tipo: 'anden'; id: string }        // id lógico (p. ej. BAL1) o índice "#n"
  | { tipo: 'bfu'; id: string }          // BFU1AOBS
  | { tipo: 'avc'; id: string }
  | { tipo: 'estacion'; id: string }
  | { tipo: 'baliza'; id: string }
  | { tipo: 'junta'; id: string }         // índice en data.juntas
  | { tipo: 'zona'; id: string }
  | { tipo: 'armario'; id: string }
  | { tipo: 'subestacion'; id: string }   // nombre
  | { tipo: 'equipo'; id: string }        // índice en data.equipos
  | { tipo: 'zona_velocidad'; id: string } // índice en data.perfil.zonas_velocidad
  | { tipo: 'pk'; id: string }            // PK en metros (texto)
  | { tipo: 'tren'; id: string };         // tren físico (nombre de flota) en la reproducción de eventos
