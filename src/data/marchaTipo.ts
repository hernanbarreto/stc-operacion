/**
 * Marcha tipo - construccion de la trayectoria ideal por vuelta.
 *
 * Antes los tiempos eran configurables por el usuario (MarchaConfig modal).
 * Ahora se toman SIEMPRE del PDF Siemens "Simulacion de Headway" en funcion
 * de (material rodante, via, horario) de cada vuelta especifica.
 *
 * Fuente: 2022-MRRC-CB.ATC-L1MO-000-III-00702096-I Rev D
 */
import { SERVICE_STATIONS } from './stationPK';
import {
  segmentTimeSec, dwellTimeSec,
  type Material, type Via,
} from './marchaTipoSiemens';
import type { Horario } from '../simulador/tiempos_parada';

export interface MarchaPoint {
  estacion: string;
  timeOffsetMs: number; // ms desde el inicio de la vuelta
  tipo: 'ARRIBO' | 'PARTIO';
}

// Construye la marcha tipo para una direccion, material y horario dados.
//  - direction 'PAN→OBS' equivale a Via 1 (PK creciente)
//  - direction 'OBS→PAN' equivale a Via 2 (PK decreciente)
export function buildMarchaTipo(
  direction: 'PAN→OBS' | 'OBS→PAN',
  material: Material = 'NM16',
  horario: Horario = 'valle',
): MarchaPoint[] {
  const via: Via = direction === 'PAN→OBS' ? 'V1' : 'V2';
  const stations = direction === 'PAN→OBS'
    ? [...SERVICE_STATIONS]
    : [...SERVICE_STATIONS].reverse();

  const points: MarchaPoint[] = [];
  let t = 0;

  for (let i = 0; i < stations.length; i++) {
    const st = stations[i];
    if (i === 0) {
      // primera estacion: PARTIO (salida)
      points.push({ estacion: st, timeOffsetMs: t, tipo: 'PARTIO' });
    } else {
      const prev = stations[i - 1];
      const travelSec = segmentTimeSec(material, via, prev, st);
      t += travelSec * 1000;
      points.push({ estacion: st, timeOffsetMs: t, tipo: 'ARRIBO' });
      // dwell (excepto en la ultima estacion = terminal de llegada)
      if (i < stations.length - 1) {
        const dwellSec = dwellTimeSec(via, horario, st);
        t += dwellSec * 1000;
        points.push({ estacion: st, timeOffsetMs: t, tipo: 'PARTIO' });
      }
    }
  }
  return points;
}

// Duracion total (ms) de una marcha tipo segun parametros.
export function marchaTipoTotalMs(
  direction: 'PAN→OBS' | 'OBS→PAN',
  material: Material = 'NM16',
  horario: Horario = 'valle',
): number {
  const pts = buildMarchaTipo(direction, material, horario);
  return pts.length > 0 ? pts[pts.length - 1].timeOffsetMs : 0;
}

// Re-exports para los imports existentes (backwards compat).
export { inferHorario, inferMaterial } from './marchaTipoSiemens';
export type { Material, Via } from './marchaTipoSiemens';
