/**
 * Marcha tipo Siemens — Tiempos de marcha por segmento y dwell por estación.
 *
 * Fuente: PDF "Simulación de Headway" Siemens — referencia
 *   2022-MRRC-CB.ATC-L1MO-000-III-00702096-I Rev D
 *   Tablas 9-12 (NM16 V2), 14-17 (NM22 V2), 19-22 (NM16 V1), 24-27 (NM22 V1).
 *
 * Los tiempos de RECORRIDO (Δt por segmento) NO dependen del horario,
 * sólo de (material, vía). Los tiempos de PARADA en andén SÍ varían
 * por horario y por vía (importados de `tiempos_parada.ts`).
 */
import { TIEMPOS_PARADA_V1, TIEMPOS_PARADA_V2, type Horario } from '../simulador/tiempos_parada';

export type Material = 'NM16' | 'NM22';
export type Via = 'V1' | 'V2';

// Segmentos en orden V1 (PAN -> OBS). Para V2 se invierte.
// Etiquetas en el formato `${from}→${to}` con BOU=BPA (alias).
const SEG_NM16_V1: Record<string, number> = {
  'PAN→ZAR': 101, 'ZAR→GOM': 66, 'GOM→BOU': 59, 'BOU→BAL': 58, 'BAL→MOC': 64,
  'MOC→SLA': 55,  'SLA→CAN': 81, 'CAN→MER': 70, 'MER→PIN': 80, 'PIN→ISA': 48,
  'ISA→SAL': 55,  'SAL→BAD': 54, 'BAD→CUA': 49, 'CUA→INS': 69, 'INS→SEV': 61,
  'SEV→CHP': 54,  'CHP→JNA': 82, 'JNA→TCY': 86, 'TCY→OBS': 98,
};
const SEG_NM16_V2: Record<string, number> = {
  'OBS→TCY': 93, 'TCY→JNA': 86, 'JNA→CHP': 85, 'CHP→SEV': 54, 'SEV→INS': 61,
  'INS→CUA': 68, 'CUA→BAD': 49, 'BAD→SAL': 53, 'SAL→ISA': 57, 'ISA→PIN': 47,
  'PIN→MER': 80, 'MER→CAN': 69, 'CAN→SLA': 80, 'SLA→MOC': 54, 'MOC→BAL': 64,
  'BAL→BOU': 58, 'BOU→GOM': 59, 'GOM→ZAR': 67, 'ZAR→PAN':133,
};
const SEG_NM22_V1: Record<string, number> = {
  'PAN→ZAR':103, 'ZAR→GOM': 67, 'GOM→BOU': 60, 'BOU→BAL': 59, 'BAL→MOC': 64,
  'MOC→SLA': 55, 'SLA→CAN': 81, 'CAN→MER': 70, 'MER→PIN': 81, 'PIN→ISA': 48,
  'ISA→SAL': 55, 'SAL→BAD': 54, 'BAD→CUA': 49, 'CUA→INS': 68, 'INS→SEV': 61,
  'SEV→CHP': 55, 'CHP→JNA': 83, 'JNA→TCY': 87, 'TCY→OBS':101,
};
const SEG_NM22_V2: Record<string, number> = {
  'OBS→TCY': 94, 'TCY→JNA': 87, 'JNA→CHP': 83, 'CHP→SEV': 55, 'SEV→INS': 61,
  'INS→CUA': 68, 'CUA→BAD': 49, 'BAD→SAL': 54, 'SAL→ISA': 55, 'ISA→PIN': 48,
  'PIN→MER': 81, 'MER→CAN': 70, 'CAN→SLA': 81, 'SLA→MOC': 55, 'MOC→BAL': 64,
  'BAL→BOU': 59, 'BOU→GOM': 60, 'GOM→ZAR': 67, 'ZAR→PAN':133,
};

const SEGMENTS: Record<Material, Record<Via, Record<string, number>>> = {
  NM16: { V1: SEG_NM16_V1, V2: SEG_NM16_V2 },
  NM22: { V1: SEG_NM22_V1, V2: SEG_NM22_V2 },
};

// Tiempo (segundos) de marcha de un segmento, según (material, via).
// Las claves admiten BPA o BOU como alias del mismo andén.
function normalizeStation(s: string): string {
  return s === 'BPA' ? 'BOU' : s;
}
export function segmentTimeSec(material: Material, via: Via, from: string, to: string): number {
  const f = normalizeStation(from); const t = normalizeStation(to);
  const key = `${f}→${t}`;
  const tab = SEGMENTS[material][via];
  return tab[key] ?? 0;
}

// Tiempo de parada (segundos) en una estación, según (via, horario).
export function dwellTimeSec(via: Via, horario: Horario, station: string): number {
  const s = normalizeStation(station);
  const tabla = via === 'V1' ? TIEMPOS_PARADA_V1 : TIEMPOS_PARADA_V2;
  // BOU en stationPK -> BPA en tiempos_parada
  const code = s === 'BOU' ? 'BPA' : s;
  return tabla[code]?.[horario] ?? 15;
}

// Infiere franja horaria a partir de un timestamp.
//  Pico mañana: 06:00 - 09:00
//  Pico tarde: 17:00 - 20:00
//  Valle: resto
export function inferHorario(d: Date | number): Horario {
  const dt = typeof d === 'number' ? new Date(d) : d;
  const h = dt.getHours();
  if (h >= 6 && h < 9) return 'pico_manana';
  if (h >= 17 && h < 20) return 'pico_tarde';
  return 'valle';
}

// Infiere material a partir del nombre del tren (e.g. "01 (nm16)" -> "NM16").
export function inferMaterial(trainName: string): Material {
  return /nm22/i.test(trainName) ? 'NM22' : 'NM16';
}
