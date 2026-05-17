/**
 * Tabla 8 PDF Headway: tiempos de parada por estación, vía, horario.
 * Tiempo en segundos.
 */

export type Horario = 'valle' | 'pico_manana' | 'pico_tarde';

// Vía 1: PAN → OBS (incrementando PK)
export const TIEMPOS_PARADA_V1: Record<string, Record<Horario, number>> = {
  PAN: { valle: 30, pico_manana: 30, pico_tarde: 30 },  // terminal
  ZAR: { valle: 15, pico_manana: 15, pico_tarde: 15 },
  GOM: { valle: 18, pico_manana: 15, pico_tarde: 15 },
  BPA: { valle: 18, pico_manana: 15, pico_tarde: 15 },
  BAL: { valle: 15, pico_manana: 15, pico_tarde: 15 },
  MOC: { valle: 18, pico_manana: 15, pico_tarde: 15 },
  SLA: { valle: 20, pico_manana: 15, pico_tarde: 20 },
  CAN: { valle: 15, pico_manana: 15, pico_tarde: 15 },
  MER: { valle: 18, pico_manana: 15, pico_tarde: 15 },
  PIN: { valle: 25, pico_manana: 15, pico_tarde: 20 },
  ISA: { valle: 18, pico_manana: 15, pico_tarde: 15 },
  SAL: { valle: 20, pico_manana: 15, pico_tarde: 15 },
  BAD: { valle: 20, pico_manana: 15, pico_tarde: 20 },
  CUA: { valle: 15, pico_manana: 15, pico_tarde: 15 },
  INS: { valle: 15, pico_manana: 15, pico_tarde: 15 },
  SEV: { valle: 20, pico_manana: 15, pico_tarde: 15 },
  CHP: { valle: 15, pico_manana: 15, pico_tarde: 15 },
  JNA: { valle: 18, pico_manana: 15, pico_tarde: 15 },
  TCY: { valle: 20, pico_manana: 15, pico_tarde: 15 },
  OBS: { valle: 30, pico_manana: 30, pico_tarde: 30 },  // terminal
};

// Vía 2: OBS → PAN (decrementando PK)
export const TIEMPOS_PARADA_V2: Record<string, Record<Horario, number>> = {
  OBS: { valle: 30, pico_manana: 30, pico_tarde: 30 },
  TCY: { valle: 18, pico_manana: 15, pico_tarde: 15 },
  JNA: { valle: 18, pico_manana: 15, pico_tarde: 15 },
  CHP: { valle: 15, pico_manana: 15, pico_tarde: 15 },
  SEV: { valle: 18, pico_manana: 15, pico_tarde: 15 },
  INS: { valle: 15, pico_manana: 15, pico_tarde: 15 },
  CUA: { valle: 18, pico_manana: 15, pico_tarde: 15 },
  BAD: { valle: 20, pico_manana: 20, pico_tarde: 15 },
  SAL: { valle: 15, pico_manana: 20, pico_tarde: 15 },
  ISA: { valle: 18, pico_manana: 15, pico_tarde: 15 },
  PIN: { valle: 25, pico_manana: 25, pico_tarde: 15 },
  MER: { valle: 18, pico_manana: 20, pico_tarde: 15 },
  CAN: { valle: 18, pico_manana: 20, pico_tarde: 15 },
  SLA: { valle: 20, pico_manana: 25, pico_tarde: 15 },
  MOC: { valle: 18, pico_manana: 15, pico_tarde: 15 },
  BAL: { valle: 15, pico_manana: 15, pico_tarde: 15 },
  BPA: { valle: 18, pico_manana: 15, pico_tarde: 15 },
  GOM: { valle: 20, pico_manana: 15, pico_tarde: 15 },
  ZAR: { valle: 25, pico_manana: 15, pico_tarde: 15 },
  PAN: { valle: 30, pico_manana: 30, pico_tarde: 30 },
};

// Orden de estaciones por vía
export const ORDEN_V1 = ['PAN','ZAR','GOM','BPA','BAL','MOC','SLA','CAN','MER',
                         'PIN','ISA','SAL','BAD','CUA','INS','SEV','CHP','JNA','TCY','OBS'];
export const ORDEN_V2 = [...ORDEN_V1].reverse();

export function tiempoParada(via: 1 | 2, estacion: string, horario: Horario): number {
  const tabla = via === 1 ? TIEMPOS_PARADA_V1 : TIEMPOS_PARADA_V2;
  return tabla[estacion]?.[horario] ?? 15;
}
