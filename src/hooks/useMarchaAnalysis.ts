/**
 * Marcha Tipo Adherence Analysis
 *
 * Compares real train trips against the ideal marcha tipo to calculate:
 * - Per-trip deviation (total seconds off)
 * - Per-segment deviation (which segments accumulate the most delay)
 * - Point of divergence (first station where deviation exceeds threshold)
 * - Best/worst trips
 * - Dwell excess per station
 */

import { useMemo } from 'react';
import type { ATSEvent } from '../types';
import { STATION_PK } from '../data/stationPK';
import { buildMarchaTipo, IDEAL_SEGMENT_SPEED, IDEAL_DWELL_MS, type MarchaPoint } from '../data/marchaTipo';
import { formatDuration } from '../utils/timeFormat';

// ─── Types ───

export interface TripAnalysis {
    tren: string;
    direction: 'PAN→OBS' | 'OBS→PAN';
    departureTime: Date;
    totalDeviationMs: number;         // total |real - ideal| deviation
    totalDeviationSigned: number;     // positive = slower than ideal
    adherencePct: number;             // 100 = perfect, lower = worse
    perStation: StationDeviation[];
    divergenceStation: string | null; // first station where deviated >30s
    divergenceMs: number;
}

export interface StationDeviation {
    estacion: string;
    idealMs: number;     // ideal offset from departure
    realMs: number;      // actual offset from departure
    deviationMs: number; // real - ideal (positive = late)
}

export interface SegmentDelay {
    segment: string;
    avgDelayMs: number;
    count: number;
}

export interface MarchaAnalysisData {
    trips: TripAnalysis[];
    bestTrip: TripAnalysis | null;
    worstTrip: TripAnalysis | null;
    avgAdherence: number;
    topDelaySegments: SegmentDelay[];
    dwellExcess: { estacion: string; avgExcessMs: number; count: number }[];
    divergenceFrequency: { estacion: string; count: number; pct: number }[];
    dboCorrelation: { divergencesWithDbo: number; totalDivergences: number; pct: number; details: { estacion: string; count: number }[] };
    totalTrips: number;
}

// ─── Helpers ───

function detectTrips(
    eventos: ATSEvent[],
    serviceStartHour: number,
): { direction: 'PAN→OBS' | 'OBS→PAN'; tren: string; departureTime: number; events: ATSEvent[] }[] {
    const sorted = [...eventos].sort((a, b) => a.datetime.getTime() - b.datetime.getTime());
    const byTrain: Record<string, ATSEvent[]> = {};
    sorted.forEach(e => { if (!byTrain[e.tren]) byTrain[e.tren] = []; byTrain[e.tren].push(e); });

    const pkPAN = STATION_PK['PAN'] || 0;
    const pkOBS = STATION_PK['OBS'] || 0;

    const trips: ReturnType<typeof detectTrips> = [];

    Object.entries(byTrain).forEach(([tren, tevs]) => {
        for (let i = 0; i < tevs.length; i++) {
            const ev = tevs[i];
            if (ev.estacion !== 'PAN' && ev.estacion !== 'OBS') continue;

            // Find last event at this terminal
            let lastIdx = i;
            while (lastIdx + 1 < tevs.length && tevs[lastIdx + 1].estacion === ev.estacion) lastIdx++;

            // Find next event at different station
            let nextSt = '';
            for (let j = lastIdx + 1; j < tevs.length; j++) {
                if (tevs[j].estacion !== ev.estacion) { nextSt = tevs[j].estacion; break; }
            }
            if (!nextSt || STATION_PK[nextSt] === undefined) { i = lastIdx; continue; }
            const nextPK = STATION_PK[nextSt];

            let direction: 'PAN→OBS' | 'OBS→PAN' | null = null;
            if (ev.estacion === 'PAN' && nextPK > pkPAN) direction = 'PAN→OBS';
            if (ev.estacion === 'OBS' && nextPK < pkOBS) direction = 'OBS→PAN';

            if (!direction) { i = lastIdx; continue; }

            const departureTime = tevs[lastIdx].datetime.getTime();
            const targetTerminal = direction === 'PAN→OBS' ? 'OBS' : 'PAN';

            // Collect events from departure to arrival at opposite terminal
            const tripEvents: ATSEvent[] = [];
            let reachedTarget = false;
            for (let j = lastIdx; j < tevs.length; j++) {
                tripEvents.push(tevs[j]);
                if (tevs[j].estacion === targetTerminal && j > lastIdx) {
                    reachedTarget = true;
                    break;
                }
                // Stop if train returns to origin terminal (incomplete trip)
                if (j > lastIdx + 1 && tevs[j].estacion === ev.estacion) break;
            }

            // Only include COMPLETE trips within reasonable time (max 60 min) AND during service hours (5:00-24:00)
            const MAX_TRIP_MS = 60 * 60_000;
            if (reachedTarget && tripEvents.length > 2) {
                const tripDuration = tripEvents[tripEvents.length - 1].datetime.getTime() - departureTime;
                const depDate = new Date(departureTime);
                const depHour = depDate.getHours();
                const inService = depHour >= serviceStartHour; // based on day type
                if (tripDuration > 0 && tripDuration < MAX_TRIP_MS && inService) {
                    trips.push({ direction, tren, departureTime, events: tripEvents });
                }
            }
            i = lastIdx;
        }
    });

    return trips;
}

function analyzeTrip(
    trip: ReturnType<typeof detectTrips>[0],
    idealPts: MarchaPoint[],
): TripAnalysis {
    // Build ordered ideal timeline: each station's ARRIBO offset from departure
    const idealArriboByStation = new Map<string, number>();
    const idealPartioByStation = new Map<string, number>();
    idealPts.forEach(pt => {
        if (pt.tipo === 'ARRIBO') idealArriboByStation.set(pt.estacion, pt.timeOffsetMs);
        else idealPartioByStation.set(pt.estacion, pt.timeOffsetMs);
    });

    // Get ordered station list from ideal path (preserves direction order)
    const orderedStations: string[] = [];
    idealPts.forEach(pt => {
        if (!orderedStations.includes(pt.estacion)) orderedStations.push(pt.estacion);
    });

    // Index real events by station for fast lookup
    const realByStation = new Map<string, ATSEvent[]>();
    trip.events.forEach(ev => {
        if (!realByStation.has(ev.estacion)) realByStation.set(ev.estacion, []);
        realByStation.get(ev.estacion)!.push(ev);
    });

    const base = trip.departureTime;
    const perStation: StationDeviation[] = [];

    // Walk through each station in order, comparing real vs ideal
    for (let si = 0; si < orderedStations.length; si++) {
        const est = orderedStations[si];
        const stEvents = realByStation.get(est) || [];

        if (si === 0) {
            // First station (departure): use PARTIO
            const idealMs = idealPartioByStation.get(est) ?? 0;
            const realPartio = stEvents.find(e => e.evento === 'PARTIO');
            const realMs = realPartio ? realPartio.datetime.getTime() - base : 0;
            perStation.push({ estacion: est, idealMs, realMs, deviationMs: realMs - idealMs });
        } else {
            // Intermediate/final station: use ARRIBO
            const idealArrMs = idealArriboByStation.get(est);
            if (idealArrMs !== undefined) {
                const realArr = stEvents.find(e => e.evento === 'ARRIBO');
                if (realArr) {
                    const realMs = realArr.datetime.getTime() - base;
                    perStation.push({ estacion: est, idealMs: idealArrMs, realMs, deviationMs: realMs - idealArrMs });
                }
            }

            // Also check PARTIO (dwell end) if not the last station
            if (si < orderedStations.length - 1) {
                const idealDepMs = idealPartioByStation.get(est);
                if (idealDepMs !== undefined) {
                    const realDep = stEvents.find(e => e.evento === 'PARTIO');
                    if (realDep) {
                        const realMs = realDep.datetime.getTime() - base;
                        perStation.push({ estacion: est + ' (dep)', idealMs: idealDepMs, realMs, deviationMs: realMs - idealDepMs });
                    }
                }
            }
        }
    }

    // Total deviation: sum of |deviation| at all measured points
    const totalDeviationMs = perStation.reduce((s, p) => s + Math.abs(p.deviationMs), 0);

    // Signed deviation at final station (how much later/earlier the train arrived)
    const totalDeviationSigned = perStation.length > 0 ? perStation[perStation.length - 1].deviationMs : 0;

    // Adherence: per-station relative accuracy, then averaged
    // For each ARRIBO station: adherence = max(0, 1 - |deviation| / idealTimeAtStation)
    // This means early deviations weigh more (2min late at 5min mark = 60%, not 93%)
    const arriboPoints = perStation.filter(p => !p.estacion.includes('(dep)') && p.idealMs > 0);
    let adherencePct = 100;
    if (arriboPoints.length > 0) {
        const stationAdherences = arriboPoints.map(p =>
            Math.max(0, 1 - Math.abs(p.deviationMs) / p.idealMs)
        );
        adherencePct = Math.round(
            (stationAdherences.reduce((s, a) => s + a, 0) / stationAdherences.length) * 1000
        ) / 10;
    }

    // Divergence: first ARRIBO station where cumulative deviation exceeds 30s
    let divergenceStation: string | null = null;
    let divergenceMs = 0;
    for (const p of perStation) {
        if (p.estacion.includes('(dep)')) continue; // skip departure points
        if (Math.abs(p.deviationMs) > 30_000) {
            divergenceStation = p.estacion;
            divergenceMs = p.deviationMs;
            break;
        }
    }

    return {
        tren: trip.tren,
        direction: trip.direction,
        departureTime: new Date(trip.departureTime),
        totalDeviationMs,
        totalDeviationSigned,
        adherencePct,
        perStation,
        divergenceStation,
        divergenceMs,
    };
}

// ─── Main Hook ───

export function useMarchaAnalysis(
    eventos: ATSEvent[],
    speeds: Record<string, number> = IDEAL_SEGMENT_SPEED,
    dwells: Record<string, number> = IDEAL_DWELL_MS,
    serviceStartHour: number = 5,
    allEvents: ATSEvent[] = [],
): MarchaAnalysisData {
    return useMemo(() => {
        if (eventos.length === 0) {
            return { trips: [], bestTrip: null, worstTrip: null, avgAdherence: 0, topDelaySegments: [], dwellExcess: [], divergenceFrequency: [], dboCorrelation: { divergencesWithDbo: 0, totalDivergences: 0, pct: 0, details: [] }, totalTrips: 0 };
        }

        const marchaPO = buildMarchaTipo('PAN→OBS', speeds, dwells);
        const marchaOP = buildMarchaTipo('OBS→PAN', speeds, dwells);

        const rawTrips = detectTrips(eventos, serviceStartHour);
        const trips: TripAnalysis[] = rawTrips.map(t =>
            analyzeTrip(t, t.direction === 'PAN→OBS' ? marchaPO : marchaOP)
        );

        if (trips.length === 0) {
            return { trips: [], bestTrip: null, worstTrip: null, avgAdherence: 0, topDelaySegments: [], dwellExcess: [], divergenceFrequency: [], dboCorrelation: { divergencesWithDbo: 0, totalDivergences: 0, pct: 0, details: [] }, totalTrips: 0 };
        }

        // Best/worst by adherence
        const sorted = [...trips].sort((a, b) => b.adherencePct - a.adherencePct);
        const bestTrip = sorted[0];
        const worstTrip = sorted[sorted.length - 1];

        // Average adherence
        const avgAdherence = Math.round(trips.reduce((s, t) => s + t.adherencePct, 0) / trips.length * 10) / 10;

        // Per-segment delay analysis (ARRIBO points only, skip dep markers)
        const segDelays: Record<string, number[]> = {};
        trips.forEach(trip => {
            const via = trip.direction === 'PAN→OBS' ? 'V1' : 'V2';
            const arriboStations = trip.perStation.filter(p => !p.estacion.includes('(dep)'));
            for (let i = 1; i < arriboStations.length; i++) {
                const prev = arriboStations[i - 1];
                const cur = arriboStations[i];
                const idealSegTime = cur.idealMs - prev.idealMs;
                const realSegTime = cur.realMs - prev.realMs;
                if (idealSegTime <= 0) continue;
                const segLabel = trip.direction === 'PAN→OBS'
                    ? `${prev.estacion}→${cur.estacion} (${via})`
                    : `${cur.estacion}→${prev.estacion} (${via})`;
                if (!segDelays[segLabel]) segDelays[segLabel] = [];
                segDelays[segLabel].push(realSegTime - idealSegTime);
            }
        });

        const topDelaySegments: SegmentDelay[] = Object.entries(segDelays)
            .map(([seg, delays]) => ({
                segment: seg,
                avgDelayMs: delays.reduce((s, d) => s + d, 0) / delays.length,
                count: delays.length,
            }))
            .sort((a, b) => b.avgDelayMs - a.avgDelayMs)
            .slice(0, 5);

        // Dwell excess per station (compare real dwell vs ideal 20s)
        const dwellData: Record<string, number[]> = {};
        rawTrips.forEach(trip => {
            const via = trip.direction === 'PAN→OBS' ? 'V1' : 'V2';
            trip.events.forEach((ev: ATSEvent, idx: number) => {
                if (ev.evento !== 'ARRIBO') return;
                if (ev.estacion === 'PAN' || ev.estacion === 'OBS' || ev.estacion === 'VIAC') return;
                for (let j = idx + 1; j < trip.events.length; j++) {
                    if (trip.events[j].estacion === ev.estacion && trip.events[j].evento === 'PARTIO') {
                        const dt = trip.events[j].datetime.getTime() - ev.datetime.getTime();
                        if (dt > 0 && dt < 300_000) {
                            const idealDwell = (dwells[ev.estacion] ?? 20_000);
                            const excess = dt - idealDwell;
                            const key = `${ev.estacion} (${via})`;
                            if (!dwellData[key]) dwellData[key] = [];
                            dwellData[key].push(excess);
                        }
                        break;
                    }
                    if (trip.events[j].estacion !== ev.estacion) break;
                }
            });
        });

        const dwellExcess = Object.entries(dwellData)
            .map(([est, excesses]) => ({
                estacion: est,
                avgExcessMs: excesses.reduce((s, e) => s + e, 0) / excesses.length,
                count: excesses.length,
            }))
            .filter(d => d.avgExcessMs > 2000) // only show >2s excess
            .sort((a, b) => b.avgExcessMs - a.avgExcessMs);

        // Divergence frequency: how often each station is the first point of divergence
        const divCounts: Record<string, number> = {};
        let divTotal = 0;
        trips.forEach(t => {
            if (t.divergenceStation) {
                const via = t.direction === 'PAN→OBS' ? 'V1' : 'V2';
                const key = `${t.divergenceStation} (${via})`;
                divCounts[key] = (divCounts[key] || 0) + 1;
                divTotal++;
            }
        });
        const divergenceFrequency = Object.entries(divCounts)
            .map(([est, count]) => ({ estacion: est, count, pct: Math.round(count / Math.max(divTotal, 1) * 100) }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        // DBO-Divergence correlation: check if DBO events near divergence points
        const dboEvents = allEvents.filter(e => e.evento === 'DBO_ACTIVAR');
        let divergencesWithDbo = 0;
        let totalDivergences = 0;
        const dboStationCounts: Record<string, number> = {};
        const DBO_WINDOW_MS = 5 * 60_000; // 5 minutes

        trips.forEach(t => {
            if (!t.divergenceStation) return;
            totalDivergences++;
            const divTime = t.departureTime.getTime() + (t.perStation.find(p => p.estacion === t.divergenceStation)?.realMs ?? 0);
            const hasDbo = dboEvents.some(d =>
                d.estacion === t.divergenceStation &&
                Math.abs(d.datetime.getTime() - divTime) < DBO_WINDOW_MS
            );
            if (hasDbo) {
                divergencesWithDbo++;
                dboStationCounts[t.divergenceStation] = (dboStationCounts[t.divergenceStation] || 0) + 1;
            }
        });

        const dboCorrelation = {
            divergencesWithDbo,
            totalDivergences,
            pct: totalDivergences > 0 ? Math.round(divergencesWithDbo / totalDivergences * 100) : 0,
            details: Object.entries(dboStationCounts)
                .map(([est, count]) => ({ estacion: est, count }))
                .sort((a, b) => b.count - a.count),
        };

        return {
            trips,
            bestTrip,
            worstTrip,
            avgAdherence,
            topDelaySegments,
            dwellExcess,
            divergenceFrequency,
            dboCorrelation,
            totalTrips: trips.length,
        };
    }, [eventos, speeds, dwells, serviceStartHour, allEvents]);
}

// ─── Formatters for display ───

export function formatTripLabel(t: TripAnalysis): string {
    const h = t.departureTime.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    return `${t.tren} ${h} ${t.direction}`;
}

export function formatDeviation(ms: number): string {
    const sign = ms >= 0 ? '+' : '-';
    return `${sign}${formatDuration(Math.abs(ms))}`;
}
