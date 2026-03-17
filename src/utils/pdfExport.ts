import { jsPDF } from 'jspdf';
import { formatDuration } from './timeFormat';
import type { ATSEvent } from '../types';
import type { Period, PeriodStationValues } from '../hooks/useAnalytics';
import { computeBoxStats } from '../hooks/useAnalytics';
import { SEGMENTS, DIST_PAN_OBS } from '../data/stationPK';
import type { InsightsData } from '../hooks/useInsights';
import type { ManeuversAnalysisData } from '../hooks/useManeuversAnalysis';
const MARGIN = 15;
const PAGE_W = 297; // A4 landscape
const PAGE_H = 210;
const CONTENT_W = PAGE_W - MARGIN * 2;
const HEADER_H = 14;
const FONT = 'helvetica';

// ─── Logo loader ───
let metroImg: string | null = null;
let ingeropImg: string | null = null;

async function loadLogos(): Promise<void> {
    if (metroImg && ingeropImg) return;
    const load = (src: string): Promise<string> => new Promise((res, rej) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            c.getContext('2d')!.drawImage(img, 0, 0);
            res(c.toDataURL('image/png'));
        };
        img.onerror = rej;
        img.src = src;
    });
    [metroImg, ingeropImg] = await Promise.all([load('/metro.png'), load('/ingerop.png')]);
}

// ─── White header with divider line ───
function addHeader(doc: jsPDF, pageNum: number, totalPages: number) {
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, PAGE_W, HEADER_H, 'F');
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(0, HEADER_H, PAGE_W, HEADER_H);
    if (metroImg) doc.addImage(metroImg, 'PNG', MARGIN, 1.5, 10, 10);
    if (ingeropImg) doc.addImage(ingeropImg, 'PNG', PAGE_W - MARGIN - 18, 2.5, 18, 8);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);
    doc.text('STC Operación — Línea 1 - Reporte', MARGIN + 14, 8);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 140);
    doc.text(`Pág. ${pageNum}/${totalPages}`, PAGE_W / 2, PAGE_H - 5, { align: 'center' });
}

// ─── Cover page ───
function addCoverPage(doc: jsPDF, dateLabel: string, _dayTypeLabel: string, totalPages: number, totalTrains: number, totalEvents: number) {
    doc.setFillColor(30, 27, 75);
    doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
    if (metroImg) doc.addImage(metroImg, 'PNG', MARGIN + 10, 20, 30, 30);
    if (ingeropImg) doc.addImage(ingeropImg, 'PNG', PAGE_W - MARGIN - 50, 25, 40, 20);

    doc.setFont(FONT, 'bold');
    doc.setFontSize(28);
    doc.setTextColor(255, 255, 255);
    doc.text('STC Operación L1', PAGE_W / 2, 80, { align: 'center' });

    doc.setFontSize(14);
    doc.setTextColor(200, 200, 230);
    doc.text('Reporte de Operación', PAGE_W / 2, 95, { align: 'center' });

    doc.setFontSize(12);
    doc.setTextColor(180, 180, 210);
    doc.text(dateLabel, PAGE_W / 2, 112, { align: 'center' });

    // Summary stats bar
    const barY = 140;
    doc.setFillColor(50, 47, 95);
    doc.roundedRect(PAGE_W / 2 - 80, barY, 160, 20, 4, 4, 'F');
    doc.setFont(FONT, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(180, 180, 220);
    doc.text(`Trenes: ${totalTrains}`, PAGE_W / 2 - 40, barY + 13, { align: 'center' });
    doc.text(`Eventos: ${totalEvents}`, PAGE_W / 2 + 40, barY + 13, { align: 'center' });

    doc.setFontSize(8);
    doc.setTextColor(140, 140, 170);
    doc.text(`Generado: ${new Date().toLocaleString('es-MX')}`, PAGE_W / 2, PAGE_H - 20, { align: 'center' });
    doc.text(`Pág. 1/${totalPages}`, PAGE_W / 2, PAGE_H - 12, { align: 'center' });
}

// ─── Canvas image (scaled to fit) ───
function addCanvasImage(doc: jsPDF, canvas: HTMLCanvasElement, y: number, maxH: number): number {
    const imgData = canvas.toDataURL('image/png');
    const ratio = canvas.height / canvas.width;
    let imgW = CONTENT_W;
    let imgH = imgW * ratio;
    if (imgH > maxH) { imgH = maxH; imgW = imgH / ratio; }
    const x = MARGIN + (CONTENT_W - imgW) / 2;
    doc.addImage(imgData, 'PNG', x, y, imgW, imgH);
    return y + imgH + 4;
}

// ─── Format helpers ───
function fmtSpeed(v: number): string { return v.toFixed(1) + ' km/h'; }

// ─── Heatmap color generators ───
function heatColorNormal(v: number, min: number, range: number): [number, number, number] {
    const t = range === 0 ? 0 : (v - min) / range; // 0=green, 1=red
    return [Math.round(16 + t * 223), Math.round(185 - t * 117), Math.round(129 - t * 61)];
}
function heatColorInverted(v: number, min: number, range: number): [number, number, number] {
    const t = range === 0 ? 0 : 1 - (v - min) / range; // inverted: high=green
    return [Math.round(16 + t * 223), Math.round(185 - t * 117), Math.round(129 - t * 61)];
}

// ─── Summary table (generic: supports time and speed) ───
function addSummaryTable(
    doc: jsPDF, data: PeriodStationValues, periods: Period[], stations: string[], startY: number,
    opts?: { fmtFn?: (v: number) => string; invertHeat?: boolean },
): number {
    const fmtFn = opts?.fmtFn || formatDuration;
    const heatFn = opts?.invertHeat ? heatColorInverted : heatColorNormal;

    const subCols = ['Med', 'Q1', 'Q3', 'n'];
    const numDataCols = periods.length * subCols.length;
    const stColW = 20;
    const cellW = Math.min(14, (CONTENT_W - stColW) / numDataCols);
    const tableW = stColW + numDataCols * cellW;
    const tableX = MARGIN + (CONTENT_W - tableW) / 2;
    const cellH = 5;
    let y = startY;

    // Collect medians for heatmap range
    const allMed: number[] = [];
    stations.forEach(st => {
        periods.forEach(p => {
            const vals = (data[p.id] || {})[st];
            if (vals && vals.length >= 2) { const s = computeBoxStats(vals); if (s) allMed.push(s.median); }
        });
    });
    const mMin = allMed.length > 0 ? Math.min(...allMed) : 0;
    const mMax = allMed.length > 0 ? Math.max(...allMed) : 1;
    const mRange = mMax - mMin || 1;

    // Header row
    doc.setFillColor(240, 240, 245);
    doc.rect(tableX, y, tableW, cellH, 'F');
    doc.setFont(FONT, 'bold');
    doc.setFontSize(5.5);
    doc.setTextColor(30, 41, 59);
    doc.text('Est.', tableX + 2, y + 3.5);
    let hx = tableX + stColW;
    periods.forEach(p => {
        const pw = subCols.length * cellW;
        doc.text(p.label, hx + pw / 2, y + 3.5, { align: 'center' });
        hx += pw;
    });
    y += cellH;

    // Sub-header
    doc.setFillColor(240, 240, 245);
    doc.rect(tableX, y, tableW, cellH, 'F');
    doc.setFont(FONT, 'normal');
    doc.setFontSize(4.5);
    doc.setTextColor(100, 116, 139);
    hx = tableX + stColW;
    periods.forEach(() => {
        subCols.forEach(sc => {
            doc.text(sc, hx + cellW / 2, y + 3.5, { align: 'center' });
            hx += cellW;
        });
    });
    y += cellH;

    // Data rows
    stations.forEach((st, ri) => {
        if (y + cellH > PAGE_H - 12) return; // safety: don't overflow page
        const bgV = ri % 2 === 0 ? 250 : 255;
        doc.setFillColor(bgV, bgV, bgV + (ri % 2 === 0 ? 2 : 0));
        doc.rect(tableX, y, tableW, cellH, 'F');
        doc.setDrawColor(220, 220, 225);
        doc.setLineWidth(0.1);
        doc.line(tableX, y + cellH, tableX + tableW, y + cellH);

        doc.setFont(FONT, 'bold');
        doc.setFontSize(5);
        doc.setTextColor(30, 41, 59);
        doc.text(st, tableX + 2, y + 3.5);

        hx = tableX + stColW;
        periods.forEach(p => {
            const vals = (data[p.id] || {})[st];
            const s = vals && vals.length >= 2 ? computeBoxStats(vals) : null;
            if (s) {
                const [hr, hg, hb] = heatFn(s.median, mMin, mRange);
                doc.setFillColor(hr, hg, hb);
                doc.rect(hx, y, cellW, cellH, 'F');
                doc.setFont(FONT, 'bold');
                doc.setFontSize(4.5);
                doc.setTextColor(255, 255, 255);
                doc.text(fmtFn(s.median), hx + cellW / 2, y + 3.5, { align: 'center' });
                hx += cellW;
                doc.setFont(FONT, 'normal');
                doc.setTextColor(60, 60, 80);
                doc.text(fmtFn(s.q1), hx + cellW / 2, y + 3.5, { align: 'center' });
                hx += cellW;
                doc.text(fmtFn(s.q3), hx + cellW / 2, y + 3.5, { align: 'center' });
                hx += cellW;
                doc.setTextColor(100, 100, 120);
                doc.text(String(s.count), hx + cellW / 2, y + 3.5, { align: 'center' });
                hx += cellW;
            } else {
                for (let c = 0; c < 4; c++) {
                    doc.setFont(FONT, 'normal');
                    doc.setFontSize(4.5);
                    doc.setTextColor(180, 180, 190);
                    doc.text('—', hx + cellW / 2, y + 3.5, { align: 'center' });
                    hx += cellW;
                }
            }
        });
        y += cellH;
    });

    // Border
    doc.setDrawColor(200, 200, 210);
    doc.setLineWidth(0.3);
    doc.rect(tableX, startY, tableW, y - startY);
    return y + 4;
}

// ─── Train count + roster table ───
function addTrainCountPage(
    doc: jsPDF, eventos: ATSEvent[], periods: Period[], pageNum: number, totalPages: number,
) {
    addHeader(doc, pageNum, totalPages);
    let y = HEADER_H + 8;

    doc.setFont(FONT, 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text('Resumen de Trenes por Franja Horaria', MARGIN, y);
    y += 8;

    // Count trains per period and type
    const trainsByPeriod: Record<string, { total: Set<string>; nm16: Set<string>; nm22: Set<string>; other: Set<string> }> = {};
    periods.forEach(p => {
        trainsByPeriod[p.id] = { total: new Set(), nm16: new Set(), nm22: new Set(), other: new Set() };
    });
    const allTrains = { total: new Set<string>(), nm16: new Set<string>(), nm22: new Set<string>(), other: new Set<string>() };

    eventos.forEach(ev => {
        if (ev.evento !== 'ARRIBO' && ev.evento !== 'PARTIO' && ev.evento !== 'SALTO') return;
        const h = ev.datetime.getHours();
        allTrains.total.add(ev.tren);
        if (ev.tren.toLowerCase().includes('nm16')) allTrains.nm16.add(ev.tren);
        else if (ev.tren.toLowerCase().includes('nm22')) allTrains.nm22.add(ev.tren);
        else allTrains.other.add(ev.tren);

        periods.forEach(p => {
            if (h >= p.start && h < (p.end === 24 ? 24 : p.end)) {
                trainsByPeriod[p.id].total.add(ev.tren);
                if (ev.tren.toLowerCase().includes('nm16')) trainsByPeriod[p.id].nm16.add(ev.tren);
                else if (ev.tren.toLowerCase().includes('nm22')) trainsByPeriod[p.id].nm22.add(ev.tren);
                else trainsByPeriod[p.id].other.add(ev.tren);
            }
        });
    });

    // Table layout
    const cols = ['Tipo', ...periods.map(p => p.label), 'Total'];
    const numCols = cols.length;
    const colW = Math.min(40, CONTENT_W / numCols);
    const tableW = numCols * colW;
    const tableX = MARGIN + (CONTENT_W - tableW) / 2;
    const cellH = 8;

    const rows = [
        { label: 'Total', vals: periods.map(p => trainsByPeriod[p.id].total.size), total: allTrains.total.size },
        { label: 'NM16', vals: periods.map(p => trainsByPeriod[p.id].nm16.size), total: allTrains.nm16.size },
        { label: 'NM22', vals: periods.map(p => trainsByPeriod[p.id].nm22.size), total: allTrains.nm22.size },
    ];

    // Header
    doc.setFillColor(99, 102, 241);
    doc.rect(tableX, y, tableW, cellH, 'F');
    doc.setFont(FONT, 'bold');
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    cols.forEach((c, i) => {
        doc.text(c, tableX + i * colW + colW / 2, y + 5.5, { align: 'center' });
    });
    y += cellH;

    // Data rows
    rows.forEach((row, ri) => {
        doc.setFillColor(ri % 2 === 0 ? 245 : 255, ri % 2 === 0 ? 245 : 255, ri % 2 === 0 ? 250 : 255);
        doc.rect(tableX, y, tableW, cellH, 'F');
        doc.setFont(FONT, 'bold');
        doc.setFontSize(7);
        doc.setTextColor(30, 41, 59);
        doc.text(row.label, tableX + colW / 2, y + 5.5, { align: 'center' });
        doc.setFont(FONT, 'normal');
        row.vals.forEach((v, i) => {
            doc.text(String(v), tableX + (i + 1) * colW + colW / 2, y + 5.5, { align: 'center' });
        });
        doc.setFont(FONT, 'bold');
        doc.setTextColor(99, 102, 241);
        doc.text(String(row.total), tableX + (cols.length - 1) * colW + colW / 2, y + 5.5, { align: 'center' });
        y += cellH;
    });

    // Border
    doc.setDrawColor(200, 200, 210);
    doc.setLineWidth(0.3);
    doc.rect(tableX, y - rows.length * cellH - cellH, tableW, (rows.length + 1) * cellH);

    // ─── Train roster ───
    y += 10;
    doc.setFont(FONT, 'bold');
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text('Listado de Trenes que Circularon', MARGIN, y);
    y += 6;

    const sortedTrains = Array.from(allTrains.total).sort();
    const rosterCols = 6;
    const rColW = CONTENT_W / rosterCols;
    const rCellH = 5;

    doc.setFont(FONT, 'normal');
    doc.setFontSize(6);
    doc.setTextColor(50, 50, 70);

    sortedTrains.forEach((tren, idx) => {
        if (y + rCellH > PAGE_H - 15) return; // don't overflow
        const col = idx % rosterCols;
        const x = MARGIN + col * rColW;
        // Alternate row bg
        if (col === 0) {
            const rowIdx = Math.floor(idx / rosterCols);
            doc.setFillColor(rowIdx % 2 === 0 ? 248 : 255, rowIdx % 2 === 0 ? 248 : 255, rowIdx % 2 === 0 ? 252 : 255);
            doc.rect(MARGIN, y, CONTENT_W, rCellH, 'F');
        }
        // Color by type
        if (tren.toLowerCase().includes('nm16')) doc.setTextColor(59, 130, 246); // blue
        else if (tren.toLowerCase().includes('nm22')) doc.setTextColor(16, 185, 129); // green
        else doc.setTextColor(100, 116, 139); // gray
        doc.text(tren, x + 3, y + 3.5);
        if (col === rosterCols - 1) y += rCellH;
    });
    if (sortedTrains.length % rosterCols !== 0) y += rCellH;
}

// ─── Section page helper: title + chart + table ───
function addSectionPage(
    doc: jsPDF, title: string, canvas: HTMLCanvasElement | undefined,
    data: PeriodStationValues, periods: Period[], stations: string[],
    pageNum: number, totalPages: number,
    opts?: { fmtFn?: (v: number) => string; invertHeat?: boolean; chartH?: number },
) {
    addHeader(doc, pageNum, totalPages);
    let y = HEADER_H + 8;
    doc.setFont(FONT, 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text(title, MARGIN, y);
    y += 6;
    if (canvas) y = addCanvasImage(doc, canvas, y, opts?.chartH || 65);
    addSummaryTable(doc, data, periods, stations, y, opts);
}

// ─── Public API ───
const STATIONS = [
    'OBS', 'TCY', 'JNA', 'CHP', 'SEV', 'INS', 'CUA', 'BAD',
    'SAL', 'ISA', 'PIN', 'MER', 'CAN', 'SLA', 'MOC', 'BAL',
    'BOU', 'GOM', 'ZAR', 'PAN',
];

export interface PdfExportData {
    dateLabel: string;
    dayTypeLabel: string;
    eventos: ATSEvent[];
    vuelta: PeriodStationValues;
    comercialSpeed: PeriodStationValues;
    segmentSpeed: Record<string, PeriodStationValues>;
    headway: Record<string, PeriodStationValues>;
    dwell: Record<string, PeriodStationValues>;
    periods: Period[];
    chartCanvases: HTMLCanvasElement[];
    insights: InsightsData;
    maneuvers?: ManeuversAnalysisData;
}

export async function exportToPdf(d: PdfExportData): Promise<void> {
    await loadLogos();

    // Determine active vias
    const hwVias = ['1', '2'].filter(v => d.headway[v] && Object.values(d.headway[v]).some(st => Object.keys(st).length > 0));
    const dwellVias = ['1', '2'].filter(v => d.dwell[v] && Object.values(d.dwell[v]).some(st => Object.keys(st).length > 0));
    const segVias = ['1', '2'].filter(v => d.segmentSpeed[v] && Object.values(d.segmentSpeed[v]).some(st => Object.keys(st).length > 0));
    const hasComercial = Object.values(d.comercialSpeed).some(st => Object.values(st).some(arr => arr.length > 0));

    // Count pages
    const hasManeuvers = d.maneuvers && (d.maneuvers.pan.instances.length + d.maneuvers.obs.instances.length) > 0;
    const totalPages = 1 + 1 + 1 + (hasComercial ? 1 : 0) + hwVias.length + dwellVias.length + segVias.length + 1 + 1 + (hasManeuvers ? 1 : 0);

    // Unique trains count for cover
    const trainSet = new Set<string>();
    d.eventos.forEach(ev => { if (ev.tren) trainSet.add(ev.tren); });

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    let pageNum = 1;
    let y: number;

    // Page 1 — Cover
    addCoverPage(doc, d.dateLabel, d.dayTypeLabel, totalPages, trainSet.size, d.eventos.length);

    // Page 2 — Train count + roster
    doc.addPage();
    pageNum++;
    addTrainCountPage(doc, d.eventos, d.periods, pageNum, totalPages);

    // Canvas index tracker (matches DOM order from Reports.tsx:
    //   0: vuelta, 1: comercial, 2+: headway vias, then dwell vias, then segment vias)
    let ci = 0;

    // Page 3 — Vuelta
    doc.addPage();
    pageNum++;
    addSectionPage(doc, '1. Tiempos de Vuelta', d.chartCanvases[ci], d.vuelta, d.periods,
        ['PAN→OBS', 'OBS→PAN'], pageNum, totalPages, { chartH: 75 });
    ci++;

    // Page 4 — Velocidad Comercial (if data)
    if (hasComercial) {
        doc.addPage();
        pageNum++;
        addSectionPage(doc, '2. Velocidad Comercial (km/h)', d.chartCanvases[ci], d.comercialSpeed, d.periods,
            ['PAN→OBS', 'OBS→PAN'], pageNum, totalPages,
            { fmtFn: fmtSpeed, invertHeat: true, chartH: 75 });
        ci++;
    }

    // Headway pages
    let sectionNum = hasComercial ? 3 : 2;
    for (const v of hwVias) {
        doc.addPage();
        pageNum++;
        addSectionPage(doc, `${sectionNum}. Headway — Vía ${v}`, d.chartCanvases[ci], d.headway[v], d.periods,
            STATIONS, pageNum, totalPages);
        ci++;
    }

    // Dwell pages
    sectionNum++;
    for (const v of dwellVias) {
        doc.addPage();
        pageNum++;
        addSectionPage(doc, `${sectionNum}. Estacionamiento — Vía ${v}`, d.chartCanvases[ci], d.dwell[v], d.periods,
            STATIONS, pageNum, totalPages);
        ci++;
    }

    // Segment speed pages
    sectionNum++;
    const segLabels = SEGMENTS.map(s => s.label);
    for (const v of segVias) {
        doc.addPage();
        pageNum++;
        addSectionPage(doc, `${sectionNum}. Velocidad por Tramo — Vía ${v} (km/h)`, d.chartCanvases[ci],
            d.segmentSpeed[v], d.periods, segLabels, pageNum, totalPages,
            { fmtFn: fmtSpeed, invertHeat: true, chartH: 70 });
        ci++;
    }

    // ─── Insights Page (Análisis de Operación) ───
    doc.addPage();
    pageNum++;
    addHeader(doc, pageNum, totalPages);
    y = HEADER_H + 8;
    doc.setFont(FONT, 'bold');
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text('Análisis de Operación', MARGIN, y);
    y += 4;

    // Badges line
    doc.setFont(FONT, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`Trenes: ${d.insights.totalTrains}  |  DBO: ${d.insights.totalDBO}  |  Alarmas: ${d.insights.totalAlarms}`, MARGIN, y + 4);
    y += 10;

    // Period table
    const insCols = ['Franja', 'Trenes', 'Headway', 'Dwell', 'DBO', 'Alarmas', 'Estado'];
    const insColW = [55, 25, 35, 35, 22, 25, 25];
    const insTableW = insColW.reduce((a, b) => a + b, 0);
    const insTableX = MARGIN + (CONTENT_W - insTableW) / 2;
    const insCellH = 7;

    // Header
    doc.setFillColor(99, 102, 241);
    doc.rect(insTableX, y, insTableW, insCellH, 'F');
    doc.setFont(FONT, 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(255, 255, 255);
    let cx = insTableX;
    insCols.forEach((c, i) => {
        doc.text(c, cx + insColW[i] / 2, y + 5, { align: 'center' });
        cx += insColW[i];
    });
    y += insCellH;

    const sevLabels: Record<string, string> = { ok: 'OK', warning: 'ALERTA', critical: 'CRIT.', info: 'INFO' };
    const sevLblColors: Record<string, [number, number, number]> = {
        ok: [16, 185, 129], warning: [245, 158, 11], critical: [239, 68, 68], info: [99, 102, 241],
    };
    const sevBg: Record<string, [number, number, number]> = {
        critical: [255, 240, 240], warning: [255, 250, 240], ok: [240, 255, 245], info: [245, 245, 255],
    };

    d.insights.periodRows.forEach((row, ri) => {
        const bg = sevBg[row.status] || [255, 255, 255];
        doc.setFillColor(ri % 2 === 0 ? bg[0] : 255, ri % 2 === 0 ? bg[1] : 255, ri % 2 === 0 ? bg[2] : 255);
        doc.rect(insTableX, y, insTableW, insCellH, 'F');
        doc.setDrawColor(220, 220, 225);
        doc.setLineWidth(0.1);
        doc.line(insTableX, y + insCellH, insTableX + insTableW, y + insCellH);

        cx = insTableX;
        doc.setFont(FONT, 'bold'); doc.setFontSize(6); doc.setTextColor(30, 41, 59);
        doc.text(row.period, cx + 3, y + 5);
        cx += insColW[0];
        doc.setFont(FONT, 'normal');
        doc.text(String(row.trains), cx + insColW[1] / 2, y + 5, { align: 'center' });
        cx += insColW[1];
        // Headway: color if > target
        if (row.hwMedianMs > 90000) doc.setTextColor(245, 158, 11); else doc.setTextColor(16, 185, 129);
        doc.setFont(FONT, 'bold');
        doc.text(row.hwMedian, cx + insColW[2] / 2, y + 5, { align: 'center' });
        cx += insColW[2];
        // Dwell
        if (row.dwellMedianMs > 20000) doc.setTextColor(245, 158, 11); else doc.setTextColor(16, 185, 129);
        doc.text(row.dwellMedian, cx + insColW[3] / 2, y + 5, { align: 'center' });
        cx += insColW[3];
        // DBO
        doc.setTextColor(row.dboCount > 0 ? 239 : 100, row.dboCount > 0 ? 68 : 116, row.dboCount > 0 ? 68 : 139);
        doc.setFont(FONT, row.dboCount > 0 ? 'bold' : 'normal');
        doc.text(String(row.dboCount), cx + insColW[4] / 2, y + 5, { align: 'center' });
        cx += insColW[4];
        // Alarms
        doc.setTextColor(row.alarmsCount > 0 ? 239 : 100, row.alarmsCount > 0 ? 68 : 116, row.alarmsCount > 0 ? 68 : 139);
        doc.text(String(row.alarmsCount), cx + insColW[5] / 2, y + 5, { align: 'center' });
        cx += insColW[5];
        // Status
        const [sr, sg, sb] = sevLblColors[row.status] || [100, 100, 100];
        doc.setFont(FONT, 'bold'); doc.setTextColor(sr, sg, sb);
        doc.text(sevLabels[row.status] || '—', cx + insColW[6] / 2, y + 5, { align: 'center' });
        y += insCellH;
    });

    // Border
    doc.setDrawColor(200, 200, 210);
    doc.setLineWidth(0.3);
    doc.rect(insTableX, y - d.insights.periodRows.length * insCellH - insCellH, insTableW,
        (d.insights.periodRows.length + 1) * insCellH);

    // Findings
    if (d.insights.findings.length > 0) {
        y += 8;
        doc.setFont(FONT, 'bold');
        doc.setFontSize(9);
        doc.setTextColor(30, 41, 59);
        doc.text('Hallazgos', MARGIN, y);
        y += 6;

        const sevDot: Record<string, [number, number, number]> = {
            critical: [239, 68, 68], warning: [245, 158, 11], ok: [16, 185, 129], info: [99, 102, 241],
        };
        d.insights.findings.forEach(f => {
            if (y + 6 > PAGE_H - 15) return;
            const [fr, fg, fb] = sevDot[f.severity] || [100, 100, 100];
            doc.setFillColor(fr, fg, fb);
            doc.circle(MARGIN + 2, y + 1.5, 1.2, 'F');
            doc.setFont(FONT, 'normal');
            doc.setFontSize(6.5);
            doc.setTextColor(50, 50, 70);
            const lines = doc.splitTextToSize(f.text, CONTENT_W - 10);
            doc.text(lines[0] || '', MARGIN + 6, y + 3);
            y += lines.length > 1 ? 10 : 6;
        });
    }



    // ─── Executive Summary Page (last page) ───
    doc.addPage();
    pageNum++;
    addHeader(doc, pageNum, totalPages);
    y = HEADER_H + 8;
    doc.setFont(FONT, 'bold');
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text('Resumen Ejecutivo', MARGIN, y);
    y += 8;

    // Summary cards
    const distKm = (DIST_PAN_OBS / 1000).toFixed(2);

    const summaryRows: { label: string; value: string; target?: string }[] = [];

    // Vuelta medians
    const vueltaPO = Object.values(d.vuelta).flatMap(st => st['PAN→OBS'] || []);
    const vueltaOP = Object.values(d.vuelta).flatMap(st => st['OBS→PAN'] || []);
    if (vueltaPO.length > 0) {
        const med = computeBoxStats(vueltaPO);
        summaryRows.push({ label: 'Tiempo de Vuelta PAN→OBS', value: med ? formatDuration(med.median) : '—', target: '29m 26s' });
    }
    if (vueltaOP.length > 0) {
        const med = computeBoxStats(vueltaOP);
        summaryRows.push({ label: 'Tiempo de Vuelta OBS→PAN', value: med ? formatDuration(med.median) : '—', target: '28m 38s' });
    }

    // Commercial speed medians
    const spdPO = Object.values(d.comercialSpeed).flatMap(st => st['PAN→OBS'] || []);
    const spdOP = Object.values(d.comercialSpeed).flatMap(st => st['OBS→PAN'] || []);
    if (spdPO.length > 0) {
        const med = computeBoxStats(spdPO);
        summaryRows.push({ label: 'Vel. Comercial PAN→OBS', value: med ? fmtSpeed(med.median) : '—', target: '36 km/h' });
    }
    if (spdOP.length > 0) {
        const med = computeBoxStats(spdOP);
        summaryRows.push({ label: 'Vel. Comercial OBS→PAN', value: med ? fmtSpeed(med.median) : '—', target: '36 km/h' });
    }

    summaryRows.push({ label: 'Distancia PAN↔OBS', value: `${distKm} km` });
    summaryRows.push({ label: 'Trenes Circulados', value: String(trainSet.size) });
    summaryRows.push({ label: 'Eventos Totales', value: String(d.eventos.length) });

    // Draw summary table
    const sumColW = [120, 55, 55];
    const sumTableW = sumColW.reduce((a, b) => a + b, 0);
    const sumTableX = MARGIN + (CONTENT_W - sumTableW) / 2;
    const sumCellH = 7;

    // Header
    doc.setFillColor(99, 102, 241);
    doc.rect(sumTableX, y, sumTableW, sumCellH, 'F');
    doc.setFont(FONT, 'bold');
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    doc.text('Indicador', sumTableX + 4, y + 5);
    doc.text('Medición', sumTableX + sumColW[0] + sumColW[1] / 2, y + 5, { align: 'center' });
    doc.text('Obj. Contractual', sumTableX + sumColW[0] + sumColW[1] + sumColW[2] / 2, y + 5, { align: 'center' });
    y += sumCellH;

    summaryRows.forEach((row, ri) => {
        doc.setFillColor(ri % 2 === 0 ? 247 : 255, ri % 2 === 0 ? 247 : 255, ri % 2 === 0 ? 252 : 255);
        doc.rect(sumTableX, y, sumTableW, sumCellH, 'F');

        doc.setFont(FONT, 'normal');
        doc.setFontSize(7);
        doc.setTextColor(30, 41, 59);
        doc.text(row.label, sumTableX + 4, y + 5);

        doc.setFont(FONT, 'bold');
        doc.setTextColor(99, 102, 241);
        doc.text(row.value, sumTableX + sumColW[0] + sumColW[1] / 2, y + 5, { align: 'center' });

        if (row.target) {
            doc.setFont(FONT, 'normal');
            doc.setTextColor(34, 211, 238);
            doc.text(row.target, sumTableX + sumColW[0] + sumColW[1] + sumColW[2] / 2, y + 5, { align: 'center' });
        }
        y += sumCellH;
    });

    // Border
    doc.setDrawColor(200, 200, 210);
    doc.setLineWidth(0.3);
    doc.rect(sumTableX, y - summaryRows.length * sumCellH - sumCellH, sumTableW, (summaryRows.length + 1) * sumCellH);

    // Maneuver page
    if (hasManeuvers && d.maneuvers) {
        const { pan, obs } = d.maneuvers;
        doc.addPage();
        addHeader(doc, totalPages, totalPages);
        let y = MARGIN + HEADER_H + 6;

        doc.setFont(FONT, 'bold');
        doc.setFontSize(11);
        doc.setTextColor(30, 41, 59);
        doc.text('Maniobras en Cabeceras', MARGIN, y);
        y += 7;

        const terminals = [pan, obs];
        const termColW = CONTENT_W / 2 - 4;

        terminals.forEach((terminal, ti) => {
            const xBase = MARGIN + ti * (termColW + 8);
            doc.setFont(FONT, 'bold');
            doc.setFontSize(9);
            doc.setTextColor(99, 102, 241);
            doc.text(terminal.terminal === 'PAN' ? 'Pantitlán (PAN)' : 'Observatorio (OBS)', xBase, y);

            // Table header
            const rowH = 6;
            const colW0 = 44;
            const colWn = (termColW - colW0) / terminal.patterns.length;
            let ty = y + 5;

            // Draw header row
            doc.setFillColor(30, 41, 59);
            doc.rect(xBase, ty, termColW, rowH, 'F');
            doc.setFont(FONT, 'bold'); doc.setFontSize(6.5); doc.setTextColor(255, 255, 255);
            doc.text('Franja', xBase + 2, ty + 4);
            terminal.patterns.forEach((pat, pi) => {
                const cx = xBase + colW0 + pi * colWn + colWn / 2;
                doc.text(pat.id, cx, ty + 4, { align: 'center' });
            });
            ty += rowH;

            // Data rows
            terminal.periods.forEach((period, ri) => {
                const rowStats = terminal.statsByPeriod[period.id] || [];
                const bg: [number, number, number] = ri % 2 === 0 ? [247, 248, 252] : [255, 255, 255];
                doc.setFillColor(...bg);
                doc.rect(xBase, ty, termColW, rowH, 'F');
                doc.setFont(FONT, 'normal'); doc.setFontSize(6); doc.setTextColor(71, 85, 105);
                doc.text(period.label, xBase + 2, ty + 4);
                terminal.patterns.forEach((pat, pi) => {
                    const st = rowStats.find(r => r.tipo === pat.id);
                    const cx = xBase + colW0 + pi * colWn + colWn / 2;
                    if (st && st.count > 0) {
                        doc.setFont(FONT, 'bold');
                        doc.setTextColor(99, 102, 241);
                        const medStr = st.boxStats ? formatDuration(st.boxStats.median) : '';
                        const txt = medStr ? `${st.count} (${medStr})` : `${st.count}`;
                        doc.text(txt, cx, ty + 4, { align: 'center' });
                    } else {
                        doc.setFont(FONT, 'normal');
                        doc.setTextColor(148, 163, 184);
                        doc.text('--', cx, ty + 4, { align: 'center' });
                    }
                });
                ty += rowH;
            });

            // Total row
            doc.setFillColor(220, 220, 240);
            doc.rect(xBase, ty, termColW, rowH, 'F');
            doc.setFont(FONT, 'bold'); doc.setFontSize(6.5); doc.setTextColor(30, 41, 59);
            doc.text('Total', xBase + 2, ty + 4);
            terminal.patterns.forEach((pat, pi) => {
                const total = terminal.instances.filter(i => i.tipo === pat.id).length;
                const cx = xBase + colW0 + pi * colWn + colWn / 2;
                doc.text(total > 0 ? String(total) : '--', cx, ty + 4, { align: 'center' });
            });

            // Table border
            doc.setDrawColor(200, 200, 210);
            doc.setLineWidth(0.3);
            doc.rect(xBase, y + 5, termColW, ty + rowH - (y + 5));

            // Measurement legend
            ty += rowH + 4;
            doc.setFont(FONT, 'normal'); doc.setFontSize(5.5); doc.setTextColor(100, 116, 139);
            terminal.patterns.forEach(pat => {
                const line = `${pat.id}: ${pat.label} - ${pat.medicion}`;
                doc.text(line, xBase + 2, ty);
                ty += 4;
            });
        });
    }

    doc.save(`Reporte_L1_${d.dateLabel.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
}
