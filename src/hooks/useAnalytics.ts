import { useMemo } from 'react';
import type { ATSEvent } from '../types';
import { DIST_PAN_OBS, STATION_PK, speedKmh } from '../data/stationPK';

// ─── Period helpers ───
export type DayType = 'laborable' | 'sabado' | 'domingo';
export interface Period { id: string; label: string; start: number; end: number }

export function getDayType(dateStr: string): DayType {
    const d = new Date(dateStr + 'T12:00:00');
    const dow = d.getDay();
    if (dow === 0) return 'domingo';
    if (dow === 6) return 'sabado';
    return 'laborable';
}

export function getPeriodsForDay(dt: DayType): Period[] {
    switch (dt) {
        case 'laborable': return [
            { id: 'N1', label: 'Normal (05-06)', start: 5, end: 6 },
            { id: 'PM', label: 'P.Mañana (06-10)', start: 6, end: 10 },
            { id: 'V', label: 'Valle (10-17)', start: 10, end: 17 },
            { id: 'PV', label: 'P.Tarde (17-22)', start: 17, end: 22 },
            { id: 'N2', label: 'Normal (22-00)', start: 22, end: 24 },
        ];
        case 'sabado': return [
            { id: 'V', label: 'Valle (06-22)', start: 6, end: 22 },
            { id: 'N', label: 'Normal (22-00)', start: 22, end: 24 },
        ];
        case 'domingo': return [
            { id: 'N1', label: 'Normal (07-09)', start: 7, end: 9 },
            { id: 'V', label: 'Valle (09-20)', start: 9, end: 20 },
            { id: 'N2', label: 'Normal (20-00)', start: 20, end: 24 },
        ];
    }
}

function classifyHour(h: number, periods: Period[]): string | null {
    for (const p of periods) { if (h >= p.start && h < (p.end === 24 ? 24 : p.end)) return p.id; }
    return null;
}

// Only process via 1 and 2
const VALID_VIAS = ['1', '2'];

// ─── Box stats ───
export interface BoxStats {
    min: number; q1: number; median: number; q3: number; max: number;
    outliers: number[]; count: number;
}

export function computeBoxStats(values: number[]): BoxStats | null {
    if (values.length < 2) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const q1 = sorted[Math.floor(n * 0.25)];
    const median = sorted[Math.floor(n * 0.5)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;
    const whiskerMin = sorted.find(v => v >= lo) ?? sorted[0];
    let whiskerMax = sorted[n - 1];
    for (let i = n - 1; i >= 0; i--) { if (sorted[i] <= hi) { whiskerMax = sorted[i]; break; } }
    const outliers = sorted.filter(v => v < lo || v > hi);
    return { min: whiskerMin, q1, median, q3, max: whiskerMax, outliers, count: n };
}

// ─── Analytics types ───
/** Record<periodId, Record<station, number[]>> */
export type PeriodStationValues = Record<string, Record<string, number[]>>;

export interface AnalyticsData {
    /** Dwell: dwell['1'] = dwell via 1, dwell['2'] = dwell via 2 */
    dwell: Record<string, PeriodStationValues>;
    /** Headway per via */
    headway: Record<string, PeriodStationValues>;
    /** Vuelta as PeriodStationValues (stations = 'PAN→OBS' and 'OBS→PAN') */
    vuelta: PeriodStationValues;
    /** Velocidad comercial PAN↔OBS en km/h */
    comercialSpeed: PeriodStationValues;
    /** Velocidad por tramo entre estaciones consecutivas (por vía) */
    segmentSpeed: Record<string, PeriodStationValues>;
    periods: Period[];
    dayType: DayType;
}

export function useAnalytics(eventos: ATSEvent[], selectedDay: string): AnalyticsData {
    const dayType = useMemo(() => getDayType(selectedDay), [selectedDay]);
    const periods = useMemo(() => getPeriodsForDay(dayType), [dayType]);

    return useMemo(() => {
        const dwell: Record<string, PeriodStationValues> = {};
        const headway: Record<string, PeriodStationValues> = {};
        const vuelta: PeriodStationValues = {};
        const comercialSpeed: PeriodStationValues = {};
        const segmentSpeed: Record<string, PeriodStationValues> = {};

        // Init per via
        VALID_VIAS.forEach(v => {
            dwell[v] = {};
            headway[v] = {};
            segmentSpeed[v] = {};
            periods.forEach(p => {
                dwell[v][p.id] = {};
                headway[v][p.id] = {};
                segmentSpeed[v][p.id] = {};
            });
        });

        // Init vuelta & commercial speed
        periods.forEach(p => {
            vuelta[p.id] = { 'PAN→OBS': [], 'OBS→PAN': [] };
            comercialSpeed[p.id] = { 'PAN→OBS': [], 'OBS→PAN': [] };
        });

        if (eventos.length === 0) return { dwell, headway, vuelta, comercialSpeed, segmentSpeed, periods, dayType };

        // Filter to valid vias only
        const sorted = [...eventos]
            .filter(ev => !ev.via || VALID_VIAS.includes(ev.via))
            .sort((a, b) => a.datetime.getTime() - b.datetime.getTime());

        // Group by train
        const byTrain: Record<string, ATSEvent[]> = {};
        sorted.forEach(ev => { if (!byTrain[ev.tren]) byTrain[ev.tren] = []; byTrain[ev.tren].push(ev); });

        // Per-train calculations
        Object.values(byTrain).forEach(tevs => {
            for (let i = 0; i < tevs.length; i++) {
                const a = tevs[i];
                const via = a.via || '1';
                if (!VALID_VIAS.includes(via)) continue;

                // DWELL: ARRIBO → search forward for PARTIO same station (excl VIAC)
                if (a.evento === 'ARRIBO' && a.estacion !== 'VIAC') {
                    for (let j = i + 1; j < tevs.length; j++) {
                        if (tevs[j].estacion === a.estacion && tevs[j].evento === 'PARTIO') {
                            const dt = tevs[j].datetime.getTime() - a.datetime.getTime();
                            if (dt > 0 && dt < 600000) {
                                const pid = classifyHour(a.datetime.getHours(), periods);
                                if (pid && dwell[via] && dwell[via][pid]) {
                                    if (!dwell[via][pid][a.estacion]) dwell[via][pid][a.estacion] = [];
                                    dwell[via][pid][a.estacion].push(dt);
                                }
                            }
                            break;
                        }
                        if (tevs[j].estacion !== a.estacion) break;
                    }
                }

                // VUELTA PAN→OBS: PARTIO PAN → search forward for ARRIBO OBS
                if (a.evento === 'PARTIO' && a.estacion === 'PAN') {
                    for (let j = i + 1; j < tevs.length; j++) {
                        if (tevs[j].evento === 'ARRIBO' && tevs[j].estacion === 'OBS') {
                            const dt = tevs[j].datetime.getTime() - a.datetime.getTime();
                            if (dt > 0 && dt < 7200000) {
                                const pid = classifyHour(a.datetime.getHours(), periods);
                                if (pid) {
                                    vuelta[pid]['PAN→OBS'].push(dt);
                                    comercialSpeed[pid]['PAN→OBS'].push(speedKmh(DIST_PAN_OBS, dt));
                                }
                            }
                            break;
                        }
                    }
                }

                // VUELTA OBS→PAN: PARTIO OBS vía 2 → search forward for ARRIBO PAN
                if (a.evento === 'PARTIO' && a.estacion === 'OBS' && a.via === '2') {
                    for (let j = i + 1; j < tevs.length; j++) {
                        if (tevs[j].evento === 'ARRIBO' && tevs[j].estacion === 'PAN') {
                            const dt = tevs[j].datetime.getTime() - a.datetime.getTime();
                            if (dt > 0 && dt < 7200000) {
                                const pid = classifyHour(a.datetime.getHours(), periods);
                                if (pid) {
                                    vuelta[pid]['OBS→PAN'].push(dt);
                                    comercialSpeed[pid]['OBS→PAN'].push(speedKmh(DIST_PAN_OBS, dt));
                                }
                            }
                            break;
                        }
                    }
                }

                // SEGMENT SPEED: PARTIO station A → ARRIBO next station (same train, same via)
                if (a.evento === 'PARTIO' && a.estacion !== 'VIAC') {
                    const pkA = STATION_PK[a.estacion];
                    if (pkA === undefined) continue;

                    for (let j = i + 1; j < tevs.length; j++) {
                        const b = tevs[j];
                        if (b.evento === 'ARRIBO' && b.estacion !== 'VIAC') {
                            const pkB = STATION_PK[b.estacion];
                            if (pkB === undefined) break;
                            const dist = Math.abs(pkB - pkA);
                            if (dist < 50) break; // same station or too close
                            const dt = b.datetime.getTime() - a.datetime.getTime();
                            if (dt > 0 && dt < 600000 && dist < 3000) { // max 5min, max 3km for single segment
                                const pid = classifyHour(a.datetime.getHours(), periods);
                                // Determine segment label based on direction
                                const label = pkB > pkA
                                    ? `${a.estacion}→${b.estacion}`
                                    : `${b.estacion}→${a.estacion}`;
                                if (pid && segmentSpeed[via] && segmentSpeed[via][pid]) {
                                    if (!segmentSpeed[via][pid][label]) segmentSpeed[via][pid][label] = [];
                                    segmentSpeed[via][pid][label].push(speedKmh(dist, dt));
                                }
                            }
                            break;
                        }
                        // Skip non-ARRIBO events (e.g. SALTO) but keep looking
                        if (b.evento === 'PARTIO') break; // Another PARTIO means we missed the ARRIBO
                    }
                }
            }
        });

        // HEADWAY per station+via (PARTIO → next PARTIO different train)
        const partioByStVia: Record<string, ATSEvent[]> = {};
        sorted.forEach(ev => {
            if (ev.evento === 'PARTIO' && ev.estacion !== 'VIAC' && ev.via && VALID_VIAS.includes(ev.via)) {
                const key = `${ev.estacion}_${ev.via}`;
                if (!partioByStVia[key]) partioByStVia[key] = [];
                partioByStVia[key].push(ev);
            }
        });

        Object.entries(partioByStVia).forEach(([key, evs]) => {
            const [est, via] = key.split('_');
            if (!headway[via]) return;
            for (let i = 1; i < evs.length; i++) {
                if (evs[i].tren === evs[i - 1].tren) continue;
                const dt = evs[i].datetime.getTime() - evs[i - 1].datetime.getTime();
                if (dt > 0 && dt < 1800000) {
                    const pid = classifyHour(evs[i].datetime.getHours(), periods);
                    if (pid) {
                        if (!headway[via][pid][est]) headway[via][pid][est] = [];
                        headway[via][pid][est].push(dt);
                    }
                }
            }
        });

        return { dwell, headway, vuelta, comercialSpeed, segmentSpeed, periods, dayType };
    }, [eventos, periods, dayType]);
}
