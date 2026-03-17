import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { formatDuration, formatDurationShort } from '../utils/timeFormat';
import type { BoxStats, Period, PeriodStationValues } from '../hooks/useAnalytics';
import { computeBoxStats } from '../hooks/useAnalytics';
import './Boxplot.css';

const FONT = 'Inter, system-ui, sans-serif';
const STATIONS = [
    'OBS', 'TCY', 'JNA', 'CHP', 'SEV', 'INS', 'CUA', 'BAD',
    'SAL', 'ISA', 'PIN', 'MER', 'CAN', 'SLA', 'MOC', 'BAL',
    'BOU', 'GOM', 'ZAR', 'PAN',
];

// ─── Single Boxplot (for maniobra / vuelta) ───
interface BoxplotProps {
    label: string; stats: BoxStats; scaleMax?: number; width?: number; height?: number;
}

export const Boxplot: React.FC<BoxplotProps> = ({ label, stats, scaleMax, width = 280, height = 110 }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pad = { left: 10, right: 50, top: 22, bottom: 18 };
    const drawW = width - pad.left - pad.right;

    useEffect(() => {
        const c = canvasRef.current; if (!c) return;
        const ctx = c.getContext('2d'); if (!ctx) return;
        c.width = width; c.height = height;
        ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, width, height);

        const maxVal = scaleMax ?? Math.max(stats.max, ...stats.outliers, 1);
        const toX = (v: number) => pad.left + (v / maxVal) * drawW;
        const midY = height / 2; const boxH = 28;

        ctx.fillStyle = '#e2e8f0'; ctx.font = `600 10px ${FONT}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(label, pad.left, 3);
        ctx.fillStyle = '#64748b'; ctx.font = `400 9px ${FONT}`;
        ctx.textAlign = 'right'; ctx.fillText(`n=${stats.count}`, width - 4, 3);

        ctx.strokeStyle = '#475569'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(toX(stats.min), midY); ctx.lineTo(toX(stats.max), midY); ctx.stroke();
        [stats.min, stats.max].forEach(v => { const x = toX(v); ctx.beginPath(); ctx.moveTo(x, midY - 8); ctx.lineTo(x, midY + 8); ctx.stroke(); });

        const bx1 = toX(stats.q1), bx3 = toX(stats.q3);
        ctx.fillStyle = 'rgba(99,102,241,0.25)'; ctx.fillRect(bx1, midY - boxH / 2, bx3 - bx1, boxH);
        ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 1.5; ctx.strokeRect(bx1, midY - boxH / 2, bx3 - bx1, boxH);

        const mx = toX(stats.median);
        ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(mx, midY - boxH / 2); ctx.lineTo(mx, midY + boxH / 2); ctx.stroke();

        ctx.fillStyle = '#ef4444';
        stats.outliers.forEach(v => { const x = toX(v); if (x >= pad.left && x <= width - pad.right) { ctx.beginPath(); ctx.arc(x, midY, 2.5, 0, Math.PI * 2); ctx.fill(); } });

        const labelY = midY + boxH / 2 + 4;
        ctx.font = `400 8px ${FONT}`; ctx.textBaseline = 'top';
        ctx.fillStyle = '#64748b'; ctx.textAlign = 'center';
        ctx.fillText(formatDurationShort(stats.min), toX(stats.min), labelY);
        ctx.fillText(formatDurationShort(stats.max), toX(stats.max), labelY);
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`Q1:${formatDurationShort(stats.q1)}`, bx1, midY - boxH / 2 - 10);
        ctx.fillText(`Q3:${formatDurationShort(stats.q3)}`, bx3, midY - boxH / 2 - 10);
        ctx.fillStyle = '#f59e0b'; ctx.font = `600 9px ${FONT}`; ctx.fillText(formatDurationShort(stats.median), mx, labelY);
    }, [stats, width, height, scaleMax, label, drawW, pad.left, pad.right]);

    return <canvas ref={canvasRef} className="boxplot-canvas" />;
};

// ─── Grouped multi-period boxplot chart with hover + summary table ───
const PERIOD_COLORS = ['#64748b', '#ef4444', '#10b981', '#f59e0b', '#64748b'];
const BOX_W = 22;
const GAP = 4;
const PERIOD_GAP = 18;
const PAD = { left: 100, right: 20, top: 35, bottom: 50 };

interface GroupedBoxplotProps {
    title: string;
    data: PeriodStationValues;
    periods: Period[];
    height?: number;
    customStations?: string[];
    unit?: string;
    invertHeatmap?: boolean;
    stationDistances?: Record<string, number>;
    targetValue?: number; // single horizontal target line for all stations
    targetValues?: Record<string, number>; // per-station target values
    targetLabel?: string; // label for the target line
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

export const GroupedBoxplot: React.FC<GroupedBoxplotProps> = ({ title, data, periods, height = 320, customStations, unit, invertHeatmap, stationDistances, targetValue, targetValues, targetLabel }) => {
    const mainRef = useRef<HTMLCanvasElement>(null);
    const overlayRef = useRef<HTMLCanvasElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const rafRef = useRef(0);

    // Format helper based on unit
    const fmtVal = useCallback((v: number) => unit ? `${v.toFixed(1)} ${unit}` : formatDuration(v), [unit]);
    const fmtShort = useCallback((v: number) => unit ? `${v.toFixed(0)}` : formatDurationShort(v), [unit]);

    const stList = customStations || STATIONS;
    const boxW = customStations ? 60 : BOX_W;
    const gap = customStations ? 20 : GAP;
    const numSt = stList.length;
    const periodW = numSt * (boxW + gap);
    const totalW = PAD.left + periods.length * periodW + (periods.length - 1) * PERIOD_GAP + PAD.right;
    const drawH = height - PAD.top - PAD.bottom;

    // Pre-compute stats + positions
    const computed = useMemo(() => {
        const items: { period: string; station: string; stats: BoxStats; cx: number }[] = [];
        let globalMax = 0;

        periods.forEach((p, pi) => {
            const pData = data[p.id] || {};
            const periodX = PAD.left + pi * (periodW + PERIOD_GAP);

            stList.forEach((st, si) => {
                const vals = pData[st];
                if (vals && vals.length >= 2) {
                    const s = computeBoxStats(vals);
                    if (s) {
                        globalMax = Math.max(globalMax, s.max, ...s.outliers);
                        items.push({ period: p.id, station: st, stats: s, cx: periodX + si * (boxW + gap) + boxW / 2 });
                    }
                }
            });
        });

        if (globalMax === 0) globalMax = 60000;
        // Include target values in Y scale
        if (targetValue) globalMax = Math.max(globalMax, targetValue);
        if (targetValues) Object.values(targetValues).forEach(v => { globalMax = Math.max(globalMax, v); });
        globalMax *= 1.15;
        return { items, globalMax };
    }, [data, periods, periodW, stList]);

    const toY = useCallback((v: number) => PAD.top + drawH - (v / computed.globalMax) * drawH, [drawH, computed.globalMax]);

    // Draw main canvas
    useEffect(() => {
        const c = mainRef.current; if (!c) return;
        const ctx = c.getContext('2d'); if (!ctx) return;
        c.width = Math.max(totalW, 600); c.height = height;

        ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, c.width, height);

        // Title
        ctx.fillStyle = '#e2e8f0'; ctx.font = `700 12px ${FONT}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(title, PAD.left, 8);

        // Y axis
        const yTicks = 6;
        for (let i = 0; i <= yTicks; i++) {
            const v = (computed.globalMax / yTicks) * i;
            const y = toY(v);
            ctx.strokeStyle = 'rgba(148,163,184,0.1)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(c.width - PAD.right, y); ctx.stroke();
            ctx.fillStyle = '#64748b'; ctx.font = `400 9px ${FONT}`;
            ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(fmtShort(v), PAD.left - 6, y);
        }

        // Period bands + labels + station labels
        periods.forEach((p, pi) => {
            const periodX = PAD.left + pi * (periodW + PERIOD_GAP);

            if (pi > 0) {
                ctx.strokeStyle = PERIOD_COLORS[pi % PERIOD_COLORS.length];
                ctx.globalAlpha = 0.4; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
                ctx.beginPath(); ctx.moveTo(periodX - PERIOD_GAP / 2, PAD.top);
                ctx.lineTo(periodX - PERIOD_GAP / 2, PAD.top + drawH); ctx.stroke();
                ctx.setLineDash([]); ctx.globalAlpha = 1;
            }

            ctx.fillStyle = PERIOD_COLORS[pi % PERIOD_COLORS.length];
            ctx.font = `600 9px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.fillText(p.label, periodX + periodW / 2, PAD.top + drawH + 32);

            stList.forEach((st, si) => {
                const cx = periodX + si * (boxW + gap) + boxW / 2;
                if (customStations) {
                    // Horizontal labels for few items
                    ctx.fillStyle = '#94a3b8'; ctx.font = `500 9px ${FONT}`;
                    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
                    ctx.fillText(st, cx, PAD.top + drawH + 6);
                } else {
                    ctx.save(); ctx.translate(cx, PAD.top + drawH + 4); ctx.rotate(-Math.PI / 3);
                    ctx.fillStyle = '#94a3b8'; ctx.font = `400 8px ${FONT}`;
                    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(st, 0, 0);
                    ctx.restore();
                }
            });
        });

        // Boxplots
        computed.items.forEach(({ stats: s, cx }) => {
            ctx.strokeStyle = '#475569'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(cx, toY(s.min)); ctx.lineTo(cx, toY(s.max)); ctx.stroke();
            const capW = boxW * 0.3;
            ctx.beginPath(); ctx.moveTo(cx - capW, toY(s.min)); ctx.lineTo(cx + capW, toY(s.min)); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx - capW, toY(s.max)); ctx.lineTo(cx + capW, toY(s.max)); ctx.stroke();

            const bxW = boxW * 0.7;
            const by1 = toY(s.q3), by2 = toY(s.q1);
            ctx.fillStyle = 'rgba(99,102,241,0.3)'; ctx.fillRect(cx - bxW / 2, by1, bxW, by2 - by1);
            ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 1; ctx.strokeRect(cx - bxW / 2, by1, bxW, by2 - by1);

            ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2;
            const my = toY(s.median);
            ctx.beginPath(); ctx.moveTo(cx - bxW / 2, my); ctx.lineTo(cx + bxW / 2, my); ctx.stroke();

            ctx.fillStyle = '#ef4444';
            s.outliers.forEach(v => { const oy = toY(v); if (oy >= PAD.top && oy <= PAD.top + drawH) { ctx.beginPath(); ctx.arc(cx, oy, 2, 0, Math.PI * 2); ctx.fill(); } });
        });

        // Target lines
        if (targetValue !== undefined) {
            const ty = toY(targetValue);
            if (ty >= PAD.top && ty <= PAD.top + drawH) {
                ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
                ctx.beginPath(); ctx.moveTo(PAD.left, ty); ctx.lineTo(c.width - PAD.right, ty); ctx.stroke();
                ctx.setLineDash([]);
                const lbl = targetLabel || (unit ? `Obj: ${targetValue} ${unit}` : `Obj: ${fmtShort(targetValue)}`);
                ctx.fillStyle = '#22d3ee'; ctx.font = `600 9px ${FONT}`;
                ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
                ctx.fillText(lbl, PAD.left - 6, ty);
            }
        }
        if (targetValues) {
            // Draw dashed lines on each station box
            computed.items.forEach(item => {
                const tv = targetValues[item.station];
                if (tv === undefined) return;
                const ty = toY(tv);
                if (ty < PAD.top || ty > PAD.top + drawH) return;
                const halfW = boxW * 0.5;
                ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
                ctx.beginPath(); ctx.moveTo(item.cx - halfW, ty); ctx.lineTo(item.cx + halfW, ty); ctx.stroke();
                ctx.setLineDash([]);
            });
            // Draw labels on left side of Y-axis, offset vertically to avoid overlap
            const entries = Object.entries(targetValues);
            entries.forEach(([st, tv], idx) => {
                const ty = toY(tv);
                if (ty < PAD.top || ty > PAD.top + drawH) return;
                const lbl = unit ? `${st}: ${tv.toFixed(1)} ${unit}` : `${st}: ${fmtShort(tv)}`;
                ctx.fillStyle = '#22d3ee'; ctx.font = `600 8px ${FONT}`;
                ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
                // Offset each label vertically: alternate above/below
                const offset = idx % 2 === 0 ? -8 : 8;
                ctx.fillText(lbl, PAD.left - 6, ty + offset);
            });
        }

        ctx.strokeStyle = 'rgba(148,163,184,0.3)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PAD.left, PAD.top); ctx.lineTo(PAD.left, PAD.top + drawH); ctx.stroke();
    }, [title, computed, periods, height, totalW, periodW, drawH, toY, fmtShort, targetValue, targetValues, targetLabel, unit]);

    // Overlay for hover tooltip
    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const c = overlayRef.current; if (!c) return;
        const ctx = c.getContext('2d'); if (!ctx) return;
        const r = c.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;

        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
            ctx.clearRect(0, 0, c.width, c.height);
            if (mx < PAD.left || my < PAD.top || my > PAD.top + drawH) return;

            // Find nearest boxplot
            let best: (typeof computed.items)[0] | null = null;
            let bestD = boxW;
            for (const item of computed.items) {
                const d = Math.abs(item.cx - mx);
                if (d < bestD) { bestD = d; best = item; }
            }
            if (!best) return;

            // Highlight
            const bxW = boxW * 0.7;
            const by1 = toY(best.stats.q3), by2 = toY(best.stats.q1);
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
            ctx.strokeRect(best.cx - bxW / 2 - 2, by1 - 2, bxW + 4, by2 - by1 + 4);

            // Tooltip
            const s = best.stats;
            const pLabel = periods.find(p => p.id === best!.period)?.label || best.period;
            const lines = [
                `${best.station} — ${pLabel}`,
            ];
            if (stationDistances && stationDistances[best.station] !== undefined) {
                const d = stationDistances[best.station];
                lines.push(`Dist: ${(d / 1000).toFixed(2)} km`);
            }
            lines.push(
                `Med: ${fmtVal(s.median)}`,
                `Q1: ${fmtVal(s.q1)}  Q3: ${fmtVal(s.q3)}`,
                `Min: ${fmtVal(s.min)}  Max: ${fmtVal(s.max)}`,
                `n=${s.count}  Atíp: ${s.outliers.length}`,
            );

            ctx.font = `500 10px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
            const maxW = Math.max(...lines.map(l => ctx.measureText(l).width));
            const tipW = maxW + 16, tipH = lines.length * 15 + 10;
            let tx = best.cx + 16, ty = Math.max(PAD.top, my - tipH / 2);
            if (tx + tipW > c.width - 10) tx = best.cx - tipW - 16;

            roundRect(ctx, tx, ty, tipW, tipH, 6);
            ctx.fillStyle = 'rgba(15,23,42,0.95)'; ctx.fill();
            ctx.strokeStyle = 'rgba(148,163,184,0.3)'; ctx.lineWidth = 1; ctx.stroke();
            ctx.fillStyle = '#e2e8f0';
            lines.forEach((l, i) => { if (i === 0) ctx.font = `600 10px ${FONT}`; else ctx.font = `400 10px ${FONT}`; ctx.fillText(l, tx + 8, ty + 6 + i * 15); });
        });
    }, [computed.items, periods, drawH, toY, fmtVal]);

    const handleMouseLeave = useCallback(() => {
        cancelAnimationFrame(rafRef.current);
        const ctx = overlayRef.current?.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, overlayRef.current!.width, overlayRef.current!.height);
    }, []);

    // Summary table data + heatmap
    const tableData = useMemo(() => {
        const rows: { station: string; cells: Record<string, BoxStats | null> }[] = [];
        const allStations = new Set<string>();
        computed.items.forEach(i => allStations.add(i.station));

        stList.forEach(st => {
            if (!allStations.has(st)) return;
            const cells: Record<string, BoxStats | null> = {};
            periods.forEach(p => {
                const item = computed.items.find(i => i.period === p.id && i.station === st);
                cells[p.id] = item ? item.stats : null;
            });
            rows.push({ station: st, cells });
        });
        return rows;
    }, [computed.items, periods, stList]);

    // Collect all median values for heatmap range
    const medianRange = useMemo(() => {
        const medians: number[] = [];
        tableData.forEach(row => {
            periods.forEach(p => {
                const s = row.cells[p.id];
                if (s) medians.push(s.median);
            });
        });
        if (medians.length === 0) return { min: 0, max: 1 };
        return { min: Math.min(...medians), max: Math.max(...medians) };
    }, [tableData, periods]);

    const medianHeatColor = useCallback((val: number) => {
        const range = medianRange.max - medianRange.min;
        if (range === 0) return 'rgba(16,185,129,0.5)';
        let t = (val - medianRange.min) / range; // 0=min, 1=max
        if (invertHeatmap) t = 1 - t; // invert: high=green, low=red
        const r = Math.round(16 + t * (239 - 16));
        const g = Math.round(185 - t * (185 - 68));
        const b = Math.round(129 - t * (129 - 68));
        return `rgba(${r},${g},${b},0.35)`;
    }, [medianRange, invertHeatmap]);

    const cW = Math.max(totalW, 600);

    return (
        <div className="grouped-boxplot-wrapper">
            <div className="grouped-boxplot-scroll" ref={scrollRef}>
                <div className="grouped-canvas-stack" style={{ width: cW, height }}>
                    <canvas ref={mainRef} width={cW} height={height} />
                    <canvas ref={overlayRef} width={cW} height={height}
                        onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
                        style={{ cursor: 'crosshair' }} />
                </div>
            </div>

            {/* Summary table */}
            {tableData.length > 0 && (
                <div className="summary-table-scroll">
                    <table className="summary-table">
                        <thead>
                            <tr>
                                <th>Est.</th>
                                {periods.map(p => (
                                    <th key={p.id} colSpan={4}>{p.label}</th>
                                ))}
                            </tr>
                            <tr>
                                <th></th>
                                {periods.map(p => (
                                    <React.Fragment key={p.id}>
                                        <th className="sub">Med</th><th className="sub">Q1</th><th className="sub">Q3</th><th className="sub">n</th>
                                    </React.Fragment>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {tableData.map(row => (
                                <tr key={row.station}>
                                    <td className="st-name">{row.station}</td>
                                    {periods.map(p => {
                                        const s = row.cells[p.id];
                                        if (!s) return <React.Fragment key={p.id}><td>—</td><td>—</td><td>—</td><td>—</td></React.Fragment>;
                                        return (
                                            <React.Fragment key={p.id}>
                                                <td className="val-med" style={{ backgroundColor: medianHeatColor(s.median) }}>{fmtVal(s.median)}</td>
                                                <td>{fmtVal(s.q1)}</td>
                                                <td>{fmtVal(s.q3)}</td>
                                                <td className="val-n">{s.count}</td>
                                            </React.Fragment>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
