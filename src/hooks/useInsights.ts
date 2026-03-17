import { useMemo } from 'react';
import type { ATSEvent, AlarmEvent } from '../types';
import type { AnalyticsData, PeriodStationValues } from './useAnalytics';
import { formatDuration } from '../utils/timeFormat';

// ─── Types ───
export type InsightSeverity = 'ok' | 'warning' | 'critical' | 'info';

/** One row in the executive summary table */
export interface PeriodRow {
    period: string;
    trains: number;
    hwMedian: string;       // formatted
    hwMedianMs: number;
    dwellMedian: string;    // formatted
    dwellMedianMs: number;
    dboCount: number;
    alarmsCount: number;
    status: InsightSeverity;
}

/** A concise finding / recommendation */
export interface Finding {
    severity: InsightSeverity;
    text: string;
}

export interface InsightsData {
    periodRows: PeriodRow[];
    findings: Finding[];
    totalTrains: number;
    totalDBO: number;
    totalAlarms: number;
}

// ─── Targets ───
const TARGET_HEADWAY = 90_000;
const TARGET_DWELL = 20_000;
const TARGET_VUELTA_PO = (29 * 60 + 26) * 1000;
const TARGET_VUELTA_OP = (28 * 60 + 38) * 1000;
const TARGET_SPEED = 36;

function median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function globalMedian(data: PeriodStationValues, station: string): number | null {
    const all: number[] = [];
    Object.values(data).forEach(st => { if (st[station]) all.push(...st[station]); });
    return all.length >= 2 ? median(all) : null;
}

export function useInsights(
    eventos: ATSEvent[],
    alarmas: AlarmEvent[],
    analytics: AnalyticsData,
): InsightsData {
    return useMemo(() => {
        const opEvents = eventos.filter(e => e.datetime.getHours() >= 5);
        const opAlarms = alarmas.filter(a => a.datetime.getHours() >= 5);
        const findings: Finding[] = [];

        // ─── Build per-period rows ───
        const periodRows: PeriodRow[] = analytics.periods.map(p => {
            // Trains in this period
            const pTrains = new Set<string>();
            opEvents.forEach(e => {
                const h = e.datetime.getHours();
                if (h >= p.start && h < (p.end === 24 ? 24 : p.end) &&
                    (e.evento === 'ARRIBO' || e.evento === 'PARTIO')) {
                    pTrains.add(e.tren);
                }
            });

            // Headway median (both vias combined)
            const hwVals: number[] = [];
            ['1', '2'].forEach(via => {
                const hwData = analytics.headway[via];
                if (hwData && hwData[p.id]) {
                    Object.values(hwData[p.id]).forEach(arr => hwVals.push(...arr));
                }
            });
            const hwMed = hwVals.length >= 2 ? median(hwVals) : 0;

            // Dwell median (both vias)
            const dwVals: number[] = [];
            ['1', '2'].forEach(via => {
                const dwData = analytics.dwell[via];
                if (dwData && dwData[p.id]) {
                    Object.values(dwData[p.id]).forEach(arr => dwVals.push(...arr));
                }
            });
            const dwMed = dwVals.length >= 2 ? median(dwVals) : 0;

            // DBO in this period
            const dbo = opEvents.filter(e => {
                const h = e.datetime.getHours();
                return e.evento === 'DBO_ACTIVAR' && h >= p.start && h < (p.end === 24 ? 24 : p.end);
            }).length;

            // Alarms in this period
            const alm = opAlarms.filter(a => {
                const h = a.datetime.getHours();
                return h >= p.start && h < (p.end === 24 ? 24 : p.end)
                    && (a.estado === 'Abierta' || a.estado === 'Reconocida');
            }).length;

            // Status: worst of hw/dwell/dbo
            let status: InsightSeverity = 'ok';
            if (hwMed > TARGET_HEADWAY * 1.5 || dwMed > 30_000 || dbo > 5) status = 'critical';
            else if (hwMed > TARGET_HEADWAY || dwMed > TARGET_DWELL || dbo > 0) status = 'warning';

            return {
                period: p.label,
                trains: pTrains.size,
                hwMedian: hwMed > 0 ? formatDuration(hwMed) : '—',
                hwMedianMs: hwMed,
                dwellMedian: dwMed > 0 ? formatDuration(dwMed) : '—',
                dwellMedianMs: dwMed,
                dboCount: dbo,
                alarmsCount: alm,
                status,
            };
        });

        // ─── Totals ───
        const allTrains = new Set<string>();
        opEvents.forEach(e => { if (e.tren) allTrains.add(e.tren); });
        const totalDBO = opEvents.filter(e => e.evento === 'DBO_ACTIVAR').length;
        const totalAlarms = opAlarms.filter(a => a.estado === 'Abierta' || a.estado === 'Reconocida').length;

        // ─── Key findings (max ~5-6 concise lines) ───

        // Vuelta
        const medPO = globalMedian(analytics.vuelta, 'PAN→OBS');
        const medOP = globalMedian(analytics.vuelta, 'OBS→PAN');
        if (medPO !== null) {
            const diff = medPO - TARGET_VUELTA_PO;
            if (diff > 60_000) findings.push({ severity: 'critical', text: `Vuelta PAN→OBS: ${formatDuration(medPO)} (obj: 29:26, +${formatDuration(diff)})` });
            else if (diff > 0) findings.push({ severity: 'warning', text: `Vuelta PAN→OBS: ${formatDuration(medPO)} (obj: 29:26, +${formatDuration(diff)})` });
            else findings.push({ severity: 'ok', text: `Vuelta PAN→OBS: ${formatDuration(medPO)} ✓ cumple objetivo 29:26` });
        }
        if (medOP !== null) {
            const diff = medOP - TARGET_VUELTA_OP;
            if (diff > 60_000) findings.push({ severity: 'critical', text: `Vuelta OBS→PAN: ${formatDuration(medOP)} (obj: 28:38, +${formatDuration(diff)})` });
            else if (diff > 0) findings.push({ severity: 'warning', text: `Vuelta OBS→PAN: ${formatDuration(medOP)} (obj: 28:38, +${formatDuration(diff)})` });
            else findings.push({ severity: 'ok', text: `Vuelta OBS→PAN: ${formatDuration(medOP)} ✓ cumple objetivo 28:38` });
        }

        // Speed
        const spdPO = globalMedian(analytics.comercialSpeed, 'PAN→OBS');
        const spdOP = globalMedian(analytics.comercialSpeed, 'OBS→PAN');
        if (spdPO !== null && spdOP !== null) {
            const avgSpd = (spdPO + spdOP) / 2;
            if (avgSpd < TARGET_SPEED - 5) findings.push({ severity: 'critical', text: `Vel. comercial media: ${avgSpd.toFixed(1)} km/h (obj: ${TARGET_SPEED}, déficit ${(TARGET_SPEED - avgSpd).toFixed(1)} km/h)` });
            else if (avgSpd < TARGET_SPEED) findings.push({ severity: 'warning', text: `Vel. comercial: ${avgSpd.toFixed(1)} km/h, ${(TARGET_SPEED - avgSpd).toFixed(1)} km/h bajo objetivo` });
            else findings.push({ severity: 'ok', text: `Vel. comercial: ${avgSpd.toFixed(1)} km/h ✓ cumple objetivo ${TARGET_SPEED} km/h` });
        }


        // DBO
        if (totalDBO > 2) {
            // Find recurring station
            const dboByStation: Record<string, number> = {};
            opEvents.filter(e => e.evento === 'DBO_ACTIVAR').forEach(e => {
                dboByStation[e.estacion] = (dboByStation[e.estacion] || 0) + 1;
            });
            const worst = Object.entries(dboByStation).sort((a, b) => b[1] - a[1])[0];
            findings.push({ severity: 'warning', text: `${totalDBO} DBO en horario comercial. Estación recurrente: ${worst?.[0]} (${worst?.[1]}x).` });
        } else if (totalDBO > 0) {
            findings.push({ severity: 'info', text: `${totalDBO} activación(es) DBO en horario comercial.` });
        }

        // Service gaps
        const gapStations: string[] = [];
        ['1', '2'].forEach(via => {
            const hwData = analytics.headway[via];
            if (!hwData) return;
            Object.entries(hwData).forEach(([, stData]) => {
                Object.entries(stData).forEach(([st, arr]) => {
                    if (arr.length >= 5 && arr.filter(v => v > 180_000).length > arr.length * 0.25) {
                        if (!gapStations.includes(st)) gapStations.push(st);
                    }
                });
            });
        });
        if (gapStations.length > 0) {
            findings.push({ severity: 'warning', text: `Huecos de servicio (>3min) frecuentes en: ${gapStations.slice(0, 4).join(', ')}.` });
        }

        return {
            periodRows,
            findings,
            totalTrains: allTrains.size,
            totalDBO,
            totalAlarms,
        };
    }, [eventos, alarmas, analytics]);
}
