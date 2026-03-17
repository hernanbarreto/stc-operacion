/**
 * Marcha Tipo Ideal — Datos estáticos
 *
 * Velocidades por tramo extraídas de periodos normales (CBTC puro, sin congestión).
 * Tiempos de estacionamiento fijados en 20s por defecto.
 * Estos valores son FIJOS y se usan en todos los días/archivos.
 */

import { SERVICE_STATIONS, STATION_PK } from './stationPK';

// ─── Velocidades ideales por tramo (km/h) ───
// Extraídas de medianas de periodos normales N1/N2 (cajas rectas, CBTC puro)
export const IDEAL_SEGMENT_SPEED: Record<string, number> = {
    'PAN→ZAR': 62,   // 1702m
    'ZAR→GOM': 50,   // 912m
    'GOM→BOU': 47,   // 760m
    'BOU→BAL': 46,   // 746m
    'BAL→MOC': 50,   // 853m
    'MOC→SLA': 43,   // 627m
    'SLA→CAN': 55,   // 1021m
    'CAN→MER': 50,   // 845m
    'MER→PIN': 52,   // 895m
    'PIN→ISA': 40,   // 532m
    'ISA→SAL': 42,   // 593m
    'SAL→BAD': 42,   // 610m
    'BAD→CUA': 40,   // 559m
    'CUA→INS': 52,   // 943m
    'INS→SEV': 48,   // 794m
    'SEV→CHP': 44,   // 651m
    'CHP→JNA': 58,   // 1124m
    'JNA→TCY': 60,   // 1308m
    'TCY→OBS': 62,   // 1410m
};

// ─── Tiempos de estacionamiento (ms) ───
// Default 20s en todas las estaciones. Configurable por estación.
export const IDEAL_DWELL_MS: Record<string, number> = Object.fromEntries(
    SERVICE_STATIONS.map(st => [st, 20_000])
);

// ─── Tipos ───
export interface MarchaPoint {
    estacion: string;
    timeOffsetMs: number; // ms desde el inicio de la vuelta
    tipo: 'ARRIBO' | 'PARTIO';
}

// ─── Generar curva de marcha tipo ───
// Dirección PAN→OBS (Vía 1): parte de PAN, recorre todos los tramos hasta OBS
// Dirección OBS→PAN (Vía 2): parte de OBS en sentido inverso

function segmentTimeMs(from: string, to: string, speeds: Record<string, number>): number {
    const label = `${from}→${to}`;
    const speed = speeds[label];
    if (!speed || speed <= 0) return 120_000; // fallback 2min
    const pkA = STATION_PK[from];
    const pkB = STATION_PK[to];
    if (pkA === undefined || pkB === undefined) return 120_000;
    const distM = Math.abs(pkB - pkA);
    // time = dist / speed → (m) / (km/h * 1000/3600) → ms
    return (distM / (speed * 1000 / 3600)) * 1000;
}

export function buildMarchaTipo(
    direction: 'PAN→OBS' | 'OBS→PAN',
    speeds: Record<string, number> = IDEAL_SEGMENT_SPEED,
    dwells: Record<string, number> = IDEAL_DWELL_MS,
): MarchaPoint[] {
    const stations = direction === 'PAN→OBS'
        ? [...SERVICE_STATIONS]
        : [...SERVICE_STATIONS].reverse();

    const points: MarchaPoint[] = [];
    let t = 0;

    for (let i = 0; i < stations.length; i++) {
        const st = stations[i];

        if (i === 0) {
            // Primera estación: PARTIO (salida)
            points.push({ estacion: st, timeOffsetMs: t, tipo: 'PARTIO' });
        } else {
            // Arribo a estación
            const prev = stations[i - 1];
            // Segment label is always in PAN→OBS direction
            const fromSt = STATION_PK[prev] < STATION_PK[st] ? prev : st;
            const toSt = STATION_PK[prev] < STATION_PK[st] ? st : prev;
            const travelMs = segmentTimeMs(fromSt, toSt, speeds);
            t += travelMs;
            points.push({ estacion: st, timeOffsetMs: t, tipo: 'ARRIBO' });

            // Dwell (si no es la última estación)
            if (i < stations.length - 1) {
                const dwell = dwells[st] ?? 20_000;
                t += dwell;
                points.push({ estacion: st, timeOffsetMs: t, tipo: 'PARTIO' });
            }
        }
    }

    return points;
}

// ─── Utilidad: tiempo total de la marcha tipo (ms) ───
export function marchaTipoTotalMs(
    direction: 'PAN→OBS' | 'OBS→PAN',
    speeds?: Record<string, number>,
    dwells?: Record<string, number>,
): number {
    const pts = buildMarchaTipo(direction, speeds, dwells);
    return pts.length > 0 ? pts[pts.length - 1].timeOffsetMs : 0;
}
