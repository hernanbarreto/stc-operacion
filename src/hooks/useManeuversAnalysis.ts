import { useMemo } from 'react';
import type { ATSEvent } from '../types';
import { computeBoxStats, getPeriodsForDay, getDayType } from './useAnalytics';
import type { BoxStats, Period, PeriodStationValues } from './useAnalytics';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ManeuverPattern { id: string; label: string; medicion: string; }
export interface ManeuverInstance {
    tren: string; tipo: string; periodoId: string;
    startTime: Date; endTime: Date; duracionMs: number;
}
export interface ManeuverStats {
    tipo: string; label: string; periodoId: string;
    count: number; boxStats: BoxStats | null;
}
export interface TerminalManeuverData {
    terminal: 'PAN' | 'OBS';
    patterns: ManeuverPattern[];
    instances: ManeuverInstance[];
    statsByPeriod: Record<string, ManeuverStats[]>;
    periods: Period[];
    boxplotData: PeriodStationValues;
    patternIds: string[];
}
export interface ManeuversAnalysisData {
    pan: TerminalManeuverData;
    obs: TerminalManeuverData;
}

// ─── Pattern definitions ─────────────────────────────────────────────────────

const PAN_PATTERNS: ManeuverPattern[] = [
    { id: 'O', label: 'O (v1>v1)', medicion: 'Dwell: ARRIBO v1 > PARTIDA v1' },
    { id: 'V1', label: 'V1 (v1>v3 via AVC)', medicion: 'Movimiento: PARTIDA v1 > ARRIBO v3' },
    { id: 'V2', label: 'V2 (v7>v1 via AVC)', medicion: 'Movimiento: PARTIDA v7 > ARRIBO v1' },
    { id: 'V3', label: 'V3 (v7>v3 via AVC)', medicion: 'Movimiento: PARTIDA v7 > ARRIBO v3' },
];
const OBS_PATTERNS: ManeuverPattern[] = [
    { id: 'O', label: 'O (TCY>OBS v2)', medicion: 'Dwell: ARRIBO v2 > PARTIDA v2' },
    { id: 'V', label: 'V (v1>v2 via AVC)', medicion: 'Movimiento: PARTIDA v1 > ARRIBO v2' },
];

function classifyPeriod(dt: Date, periods: Period[]): string {
    const h = dt.getHours() + dt.getMinutes() / 60;
    for (const p of periods) {
        if (h >= p.start && h < (p.end === 24 ? 24 : p.end)) return p.id;
    }
    return 'DESC';
}

// ─── PAN Detection ───────────────────────────────────────────────────────────
//
// Tren llega desde servicio (ZAR/AVC14ZAR).
// O:  ARRIBO PAN v1 → PARTIDA PAN v1 → vuelve a ZAR.     Dur = ARRIBO v1 → PARTIDA v1 (dwell)
// V1: ARRIBO PAN v1 → PARTIDA PAN v1 → AVC24PAN → PAN v3. Dur = PARTIDA v1 → ARRIBO v3
// V2: ARRIBO PAN v7 → PARTIDA PAN v7 → AVC24PAN → PAN v1. Dur = PARTIDA v7 → ARRIBO v1
// V3: ARRIBO PAN v7 → PARTIDA PAN v7 → AVC24PAN → PAN v3. Dur = PARTIDA v7 → ARRIBO v3

function detectPAN(allEvents: ATSEvent[], periods: Period[]): ManeuverInstance[] {
    const RELEVANT = new Set(['PAN', 'AVC24PAN', 'ZAR', 'AVC14ZAR', 'AVC24ZAR']);
    const PAN_TERMINAL = new Set(['PAN', 'AVC24PAN']); // stations that are part of the PAN terminal
    const byTrain = new Map<string, ATSEvent[]>();
    for (const ev of allEvents) {
        if (RELEVANT.has(ev.estacion) && (ev.evento === 'ARRIBO' || ev.evento === 'PARTIO')) {
            if (!byTrain.has(ev.tren)) byTrain.set(ev.tren, []);
            byTrain.get(ev.tren)!.push(ev);
        }
    }

    const instances: ManeuverInstance[] = [];

    for (const [tren, evs] of byTrain) {
        evs.sort((a, b) => a.datetime.getTime() - b.datetime.getTime());

        for (let i = 0; i < evs.length; i++) {
            const arr = evs[i];
            // ARRIBO PAN v1 or v7
            if (arr.estacion !== 'PAN' || arr.evento !== 'ARRIBO') continue;
            if (arr.via !== '1' && arr.via !== '7') continue;

            // Must come from service: prev event NOT at a PAN terminal station
            if (i === 0) continue;
            const prev = evs[i - 1];
            if (PAN_TERMINAL.has(prev.estacion)) continue; // came from within terminal, skip

            // Find PARTIDA PAN same via (within 5 min)
            let partIdx = -1;
            for (let j = i + 1; j < evs.length; j++) {
                if (evs[j].estacion === 'PAN' && evs[j].evento === 'PARTIO' && evs[j].via === arr.via) {
                    partIdx = j; break;
                }
                if (evs[j].datetime.getTime() - arr.datetime.getTime() > 5 * 60 * 1000) break;
            }
            if (partIdx < 0) continue;

            // What comes AFTER PARTIDA?
            if (partIdx + 1 < evs.length) {
                const next = evs[partIdx + 1];
                const gap = next.datetime.getTime() - evs[partIdx].datetime.getTime();

                if (next.estacion === 'AVC24PAN' && next.evento === 'ARRIBO' && gap < 5 * 60 * 1000) {
                    // V maneuver — find final ARRIBO PAN v1 or v3
                    let finalIdx = -1;
                    for (let j = partIdx + 2; j < evs.length; j++) {
                        if (evs[j].estacion === 'PAN' && evs[j].evento === 'ARRIBO' &&
                            (evs[j].via === '1' || evs[j].via === '3')) {
                            finalIdx = j; break;
                        }
                        if (evs[j].datetime.getTime() - evs[partIdx].datetime.getTime() > 15 * 60 * 1000) break;
                    }
                    if (finalIdx >= 0) {
                        const finalVia = evs[finalIdx].via;
                        let tipo: string | null = null;
                        if (arr.via === '1' && finalVia === '3') tipo = 'V1';
                        else if (arr.via === '7' && finalVia === '1') tipo = 'V2';
                        else if (arr.via === '7' && finalVia === '3') tipo = 'V3';
                        if (tipo) {
                            // Duration: PARTIDA → final ARRIBO (movement only)
                            instances.push({
                                tren, tipo,
                                periodoId: classifyPeriod(arr.datetime, periods),
                                startTime: evs[partIdx].datetime,
                                endTime: evs[finalIdx].datetime,
                                duracionMs: evs[finalIdx].datetime.getTime() - evs[partIdx].datetime.getTime(),
                            });
                        }
                        i = finalIdx;
                    }
                } else if (!PAN_TERMINAL.has(next.estacion)) {
                    // O: train returned to service. Duration = dwell (ARRIBO → PARTIDA)
                    instances.push({
                        tren, tipo: 'O',
                        periodoId: classifyPeriod(arr.datetime, periods),
                        startTime: arr.datetime,
                        endTime: evs[partIdx].datetime,
                        duracionMs: evs[partIdx].datetime.getTime() - arr.datetime.getTime(),
                    });
                }
            }
        }
    }
    // Filter: if duration > 15 min, train stalled — not a service maneuver
    return instances.filter(m => m.duracionMs <= 15 * 60 * 1000);
}

// ─── OBS Detection ───────────────────────────────────────────────────────────
//
// Tren llega desde servicio (TCY v1).
// O: TCY v1 → ARRIBO OBS v2 directo.           Dur = ARRIBO v2 → PARTIDA v2 (dwell)
// V: TCY v1 → ARRIBO OBS v1 → PARTIDA v1 →
//    AVC14OBS → ARRIBO OBS v2.                 Dur = PARTIDA v1 → ARRIBO v2

function detectOBS(allEvents: ATSEvent[], periods: Period[]): ManeuverInstance[] {
    const RELEVANT = new Set(['OBS', 'AVC14OBS', 'TCY']);
    const byTrain = new Map<string, ATSEvent[]>();
    for (const ev of allEvents) {
        if (RELEVANT.has(ev.estacion) && (ev.evento === 'ARRIBO' || ev.evento === 'PARTIO')) {
            if (!byTrain.has(ev.tren)) byTrain.set(ev.tren, []);
            byTrain.get(ev.tren)!.push(ev);
        }
    }

    const instances: ManeuverInstance[] = [];

    for (const [tren, evs] of byTrain) {
        evs.sort((a, b) => a.datetime.getTime() - b.datetime.getTime());

        for (let i = 0; i < evs.length; i++) {
            const ev = evs[i];
            if (ev.estacion !== 'OBS' || ev.evento !== 'ARRIBO') continue;
            if (i === 0) continue;
            const prev = evs[i - 1];
            if (prev.estacion !== 'TCY' || prev.evento !== 'PARTIO' || prev.via !== '1') continue;

            if (ev.via === '2') {
                // O: direct to v2. Duration = dwell (ARRIBO v2 → PARTIDA v2)
                let partIdx = -1;
                for (let j = i + 1; j < evs.length; j++) {
                    if (evs[j].estacion === 'OBS' && evs[j].evento === 'PARTIO' && evs[j].via === '2') {
                        partIdx = j; break;
                    }
                    if (evs[j].datetime.getTime() - ev.datetime.getTime() > 5 * 60 * 1000) break;
                }
                if (partIdx >= 0) {
                    instances.push({
                        tren, tipo: 'O',
                        periodoId: classifyPeriod(ev.datetime, periods),
                        startTime: ev.datetime,
                        endTime: evs[partIdx].datetime,
                        duracionMs: evs[partIdx].datetime.getTime() - ev.datetime.getTime(),
                    });
                }
            } else if (ev.via === '1') {
                // V: arrived at v1, will maneuver. Find PARTIDA OBS v1 first.
                let partV1Idx = -1;
                for (let j = i + 1; j < evs.length; j++) {
                    if (evs[j].estacion === 'OBS' && evs[j].evento === 'PARTIO' && evs[j].via === '1') {
                        partV1Idx = j; break;
                    }
                    if (evs[j].datetime.getTime() - ev.datetime.getTime() > 5 * 60 * 1000) break;
                }
                if (partV1Idx < 0) continue;

                // Find final ARRIBO OBS v2
                let finalIdx = -1;
                for (let j = partV1Idx + 1; j < evs.length; j++) {
                    if (evs[j].estacion === 'OBS' && evs[j].evento === 'ARRIBO' && evs[j].via === '2') {
                        finalIdx = j; break;
                    }
                    if (evs[j].datetime.getTime() - evs[partV1Idx].datetime.getTime() > 10 * 60 * 1000) break;
                }
                if (finalIdx >= 0) {
                    // Duration: PARTIDA v1 → ARRIBO v2 (movement only)
                    instances.push({
                        tren, tipo: 'V',
                        periodoId: classifyPeriod(ev.datetime, periods),
                        startTime: evs[partV1Idx].datetime,
                        endTime: evs[finalIdx].datetime,
                        duracionMs: evs[finalIdx].datetime.getTime() - evs[partV1Idx].datetime.getTime(),
                    });
                    i = finalIdx;
                }
            }
        }
    }
    return instances.filter(m => m.duracionMs <= 15 * 60 * 1000);
}

// ─── Stats ───────────────────────────────────────────────────────────────────

function buildStats(
    instances: ManeuverInstance[], patterns: ManeuverPattern[], periods: Period[]
): { statsByPeriod: Record<string, ManeuverStats[]>; boxplotData: PeriodStationValues } {
    const statsByPeriod: Record<string, ManeuverStats[]> = {};
    const boxplotData: PeriodStationValues = {};

    for (const p of periods) {
        const pInst = instances.filter(m => m.periodoId === p.id);
        statsByPeriod[p.id] = patterns.map(pat => {
            const matching = pInst.filter(m => m.tipo === pat.id);
            return {
                tipo: pat.id, label: pat.label, periodoId: p.id,
                count: matching.length,
                boxStats: computeBoxStats(matching.map(m => m.duracionMs)),
            };
        });
        const pEntry: Record<string, number[]> = {};
        patterns.forEach(pat => {
            const matching = pInst.filter(m => m.tipo === pat.id);
            if (matching.length >= 2) pEntry[pat.id] = matching.map(m => m.duracionMs);
        });
        if (Object.keys(pEntry).length > 0) boxplotData[p.id] = pEntry;
    }
    return { statsByPeriod, boxplotData };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useManeuversAnalysis(eventos: ATSEvent[], selectedDay: string): ManeuversAnalysisData {
    return useMemo(() => {
        const dayType = getDayType(selectedDay);
        const periods = getPeriodsForDay(dayType);
        const panInst = detectPAN(eventos, periods);
        const obsInst = detectOBS(eventos, periods);
        const panStats = buildStats(panInst, PAN_PATTERNS, periods);
        const obsStats = buildStats(obsInst, OBS_PATTERNS, periods);

        return {
            pan: {
                terminal: 'PAN', patterns: PAN_PATTERNS,
                instances: panInst, statsByPeriod: panStats.statsByPeriod,
                periods, boxplotData: panStats.boxplotData,
                patternIds: PAN_PATTERNS.map(p => p.id),
            },
            obs: {
                terminal: 'OBS', patterns: OBS_PATTERNS,
                instances: obsInst, statsByPeriod: obsStats.statsByPeriod,
                periods, boxplotData: obsStats.boxplotData,
                patternIds: OBS_PATTERNS.map(p => p.id),
            },
        };
    }, [eventos, selectedDay]);
}
