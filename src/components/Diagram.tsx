import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { ExcelUploadData, Cursor, CursorCalculation } from '../types';
import { Trash2, ZoomIn, ZoomOut, RotateCcw, Maximize, Minimize } from 'lucide-react';
import { formatDuration } from '../utils/timeFormat';
import { STATION_PK } from '../data/stationPK';
import { buildMarchaTipo } from '../data/marchaTipo';
import { MarchaConfig } from './MarchaConfig';
import './Diagram.css';

// ───────────────────────── Constants ─────────────────────────
const KNOWN_STATION_ORDER = [
  'AVC104OBS', 'AVC84OBS', 'AVC64OBS', 'AVC44OBS', 'AVC24OBS', 'AVC14OBS', 'AVC34OBS', 'AVC54OBS',
  'OBS', 'TCY', 'JNA', 'AVC20CHP', 'CHP', 'SEV', 'INS', 'CUA', 'AVC20ABAD', 'BAD', 'AVCZSAL', 'SAL', 'ISA', 'AVC20PIN', 'PIN', 'MER', 'CAN', 'SLA', 'MOC', 'BAL', 'AVC14BAL', 'BOU', 'GOM', 'ZAR', 'AVC14ZAR', 'AVC24ZAR', 'PAN', 'AVC62PAN', 'AVC44PAN', 'AVC24PAN', 'AVC14PAN', 'AVC64PAN', 'AVC46PAN', 'AVC26PAN', 'AVC16PAN'
];

const PALETTE = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f97316', '#06b6d4', '#84cc16', '#a78bfa', '#fb923c',
  '#34d399', '#f87171', '#c084fc', '#e879f9', '#22d3ee', '#a3e635',
  '#fbbf24', '#2dd4bf', '#818cf8', '#fb7185', '#4ade80', '#94a3b8',
  '#fca5a5', '#86efac', '#fde68a', '#c4b5fd', '#67e8f9', '#fdba74',
];

const CURSOR_COLORS = ['#ef4444', '#3b82f6'];
const MARGIN = { left: 5, right: 30, top: 50, bottom: 20 };
const STATION_COL_W = 70;
const DEFAULT_PX_PER_HOUR = 200;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 10;
const SNAP_PX = 20;
const FONT = 'Inter, system-ui, sans-serif';

// ──────────────── Day-dependent period schedules ─────────────
type DayType = 'laborable' | 'sabado' | 'domingo';
interface Period { id: string; label: string; start: number; end: number; color: string; lc: string }

const PERIOD_COLORS = {
  PM: { color: 'rgba(239,68,68,0.12)', lc: '#ef4444' },
  PV: { color: 'rgba(245,158,11,0.12)', lc: '#f59e0b' },
  V: { color: 'rgba(16,185,129,0.08)', lc: '#10b981' },
  N: { color: 'rgba(100,116,139,0.10)', lc: '#64748b' },
};

function getDayType(dateStr: string): DayType {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay();
  if (dow === 0) return 'domingo';
  if (dow === 6) return 'sabado';
  return 'laborable';
}

function getPeriodsForDay(dt: DayType): Period[] {
  switch (dt) {
    case 'laborable': return [
      { id: 'N1', label: 'NORMAL', start: 5, end: 6, ...PERIOD_COLORS.N },
      { id: 'PM', label: 'P.MAÑ', start: 6, end: 10, ...PERIOD_COLORS.PM },
      { id: 'V', label: 'VALLE', start: 10, end: 17, ...PERIOD_COLORS.V },
      { id: 'PV', label: 'P.TARDE', start: 17, end: 22, ...PERIOD_COLORS.PV },
      { id: 'N2', label: 'NORMAL', start: 22, end: 24, ...PERIOD_COLORS.N },
    ];
    case 'sabado': return [
      { id: 'V', label: 'VALLE', start: 6, end: 22, ...PERIOD_COLORS.V },
      { id: 'N', label: 'NORMAL', start: 22, end: 24, ...PERIOD_COLORS.N },
    ];
    case 'domingo': return [
      { id: 'N1', label: 'NORMAL', start: 7, end: 9, ...PERIOD_COLORS.N },
      { id: 'V', label: 'VALLE', start: 9, end: 20, ...PERIOD_COLORS.V },
      { id: 'N2', label: 'NORMAL', start: 20, end: 24, ...PERIOD_COLORS.N },
    ];
  }
}


// ─────────────── Maniobra zones ───────────────────────────
// PK-based zone boundaries (meters)
const MAN_PAN_PK_MAX = 550.0;    // PAN maniobra zone: PK 0 → 550
const MAN_OBS_PK_MIN = 17393.430; // OBS maniobra zone: PK 17393.430 →

// All AVC stations are maniobra, regardless of PK
const MANIOBRA_STATIONS = new Set(
  Object.keys(STATION_PK).filter(name => name.startsWith('AVC') || name === 'AVCZSAL')
);
// Also add VIAC if present
if (STATION_PK['VIAC'] !== undefined) MANIOBRA_STATIONS.add('VIAC');

interface ManiobraZone {
  id: string;
  label: string;
  stations: string[];
}

const MANIOBRA_ZONES: ManiobraZone[] = [
  { id: 'pan_deep', label: 'MAN PAN', stations: [...MANIOBRA_STATIONS].filter(s => (STATION_PK[s] ?? Infinity) <= MAN_PAN_PK_MAX) },
  { id: 'obs_deep', label: 'MAN OBS', stations: [...MANIOBRA_STATIONS].filter(s => (STATION_PK[s] ?? 0) >= MAN_OBS_PK_MIN && s !== 'AVCZSAL') },
];

// ─────────────────────── Helpers ──────────────────────────
function isManiobra(estacion: string, via: string) {
  if (MANIOBRA_STATIONS.has(estacion)) return true;
  if (estacion === 'PAN' && via !== '1' && via !== '3' && via !== '7') return true;
  if (via === '4') return true;   // vía 4 is always maniobra
  if (via.toUpperCase() === 'Z') return true; // vía Z is always maniobra
  return false;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

// ─────────────────────── Component ───────────────────────
interface DiagramProps {
  data: ExcelUploadData;
  selectedDay: string;
  onBack: () => void;
  configSpeeds: Record<string, number>;
  configDwells: Record<string, number>;
  onConfigSpeedsChange: (v: Record<string, number>) => void;
  onConfigDwellsChange: (v: Record<string, number>) => void;
}

export const Diagram: React.FC<DiagramProps> = ({
  data, selectedDay, configSpeeds, configDwells, onConfigSpeedsChange, onConfigDwellsChange,
}) => {
  const mainRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  const [zoom, setZoom] = useState(1);
  const [canvasH, setCanvasH] = useState(600);
  const [mCursors, setMCursors] = useState<Cursor[]>([]);
  const [calcs, setCalcs] = useState<CursorCalculation[]>([]);
  const [showDbo, setShowDbo] = useState(false);
  const [showAlarms, setShowAlarms] = useState(false);
  const [showMarchaTipo, setShowMarchaTipo] = useState(false);
  const [showMarchaConfig, setShowMarchaConfig] = useState(false);

  // Control panel state
  const [timeStart, setTimeStart] = useState('05:00:00');
  const [timeEnd, setTimeEnd] = useState('24:00:00');
  const [selectedTrains, setSelectedTrains] = useState<Set<string> | null>(null); // null = all
  const [showTrainDropdown, setShowTrainDropdown] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const trainDropRef = useRef<HTMLDivElement>(null);

  // Responsive canvas height — fill available space
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setCanvasH(Math.max(300, Math.floor(entry.contentRect.height)));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ──── Derived data ────
  const eventosAll = useMemo(() => (data.eventos_por_dia[selectedDay] || []).filter(e => e.evento !== 'DBO_ACTIVAR' && e.evento !== 'DBO_DESACTIVAR'), [data, selectedDay]);
  const dboEventos = useMemo(() => (data.eventos_por_dia[selectedDay] || []).filter(e => e.evento === 'DBO_ACTIVAR' || e.evento === 'DBO_DESACTIVAR'), [data, selectedDay]);
  const alarmEventos = useMemo(() => (data.alarmas_por_dia?.[selectedDay] || []).filter(a => a.estacion), [data, selectedDay]);
  const trenes = useMemo(() => [...new Set(eventosAll.map(e => e.tren))].sort(), [eventosAll]);

  // Filter by selected trains
  const eventos = useMemo(() => {
    if (!selectedTrains) return eventosAll;
    return eventosAll.filter(e => selectedTrains.has(e.tren));
  }, [eventosAll, selectedTrains]);

  const estaciones = useMemo(() => {
    // Always show ALL known stations (including maniobra) so the zones are visible
    return [...KNOWN_STATION_ORDER];
  }, []);

  const dayType = useMemo(() => getDayType(selectedDay), [selectedDay]);
  const periods = useMemo(() => getPeriodsForDay(dayType), [dayType]);

  const trenesPerPeriod = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    periods.forEach(p => { map[p.id] = new Set(); });
    eventos.forEach(ev => {
      const h = ev.datetime.getHours();
      periods.forEach(p => { if (h >= p.start && h < p.end) map[p.id].add(ev.tren); });
    });
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v.size]));
  }, [eventos, periods]);

  // Parse time string to seconds
  const parseTime = (t: string) => {
    const [h, m, s] = t.split(':').map(Number);
    return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
  };

  const { dayStart, dayEnd } = useMemo(() => {
    if (eventosAll.length === 0) return { dayStart: 0, dayEnd: 1 };
    const ref = new Date(eventosAll[0].datetime);
    ref.setHours(0, 0, 0, 0);
    const base = ref.getTime();
    const s = base + parseTime(timeStart) * 1000;
    const e = base + parseTime(timeEnd) * 1000;
    return { dayStart: s, dayEnd: Math.max(e, s + 60000) };
  }, [eventosAll, timeStart, timeEnd]);

  const visibleHours = (dayEnd - dayStart) / 3_600_000;
  const canvasW = useMemo(
    () => Math.max(900, Math.round(visibleHours * DEFAULT_PX_PER_HOUR * zoom) + MARGIN.left + MARGIN.right),
    [zoom, visibleHours],
  );
  const drawW = canvasW - MARGIN.left - MARGIN.right;
  const drawH = canvasH - MARGIN.top - MARGIN.bottom;

  const timeToX = useCallback(
    (t: number) => MARGIN.left + ((t - dayStart) / (dayEnd - dayStart || 1)) * drawW,
    [dayStart, dayEnd, drawW],
  );
  // Weighted stationY: compress maniobra stations to use less vertical space
  const stationWeights = useMemo(() => {
    const MAN_WEIGHT = 0.15;
    const weights = estaciones.map(est => MANIOBRA_STATIONS.has(est) ? MAN_WEIGHT : 1.0);
    // Build cumulative positions
    const cumul: number[] = [0];
    for (let i = 1; i < weights.length; i++) {
      cumul.push(cumul[i - 1] + (weights[i - 1] + weights[i]) / 2);
    }
    const total = cumul[cumul.length - 1] || 1;
    return cumul.map(c => c / total);
  }, [estaciones]);

  const stationY = useCallback(
    (idx: number) => MARGIN.top + (stationWeights[idx] ?? 0) * drawH,
    [stationWeights, drawH],
  );

  const evPos = useMemo(() => {
    return eventos.map(ev => {
      const si = estaciones.indexOf(ev.estacion);
      return { ev, x: timeToX(ev.datetime.getTime()), y: si >= 0 ? stationY(si) : -1 };
    }).filter(p => p.y >= 0);
  }, [eventos, estaciones, timeToX, stationY]);

  const dboPos = useMemo(() => {
    return dboEventos.map(ev => {
      const si = estaciones.indexOf(ev.estacion);
      return { ev, x: timeToX(ev.datetime.getTime()), y: si >= 0 ? stationY(si) : -1 };
    }).filter(p => p.y >= 0);
  }, [dboEventos, estaciones, timeToX, stationY]);

  const alarmPos = useMemo(() => {
    return alarmEventos.map(alarm => {
      const si = estaciones.indexOf(alarm.estacion);
      return { alarm, x: timeToX(alarm.datetime.getTime()), y: si >= 0 ? stationY(si) : -1 };
    }).filter(p => p.y >= 0);
  }, [alarmEventos, estaciones, timeToX, stationY]);

  // ──── MAIN CANVAS ────
  const drawMain = useCallback(() => {
    const c = mainRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    c.width = canvasW; c.height = canvasH;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvasW, canvasH);
    if (eventos.length === 0) {
      ctx.fillStyle = '#64748b'; ctx.font = `500 14px ${FONT}`;
      ctx.textAlign = 'center'; ctx.fillText('Sin eventos', canvasW / 2, canvasH / 2);
      return;
    }

    const refDate = new Date(eventos[0].datetime);
    refDate.setHours(0, 0, 0, 0);

    // 1) Period bands
    periods.forEach(p => {
      const ps = new Date(refDate); ps.setHours(p.start, 0, 0, 0);
      const pe = new Date(refDate); pe.setHours(p.end === 24 ? 23 : p.end, p.end === 24 ? 59 : 0, p.end === 24 ? 59 : 0, 0);
      const x1 = Math.max(timeToX(ps.getTime()), MARGIN.left);
      const x2 = Math.min(timeToX(pe.getTime()), MARGIN.left + drawW);
      if (x2 <= x1) return;
      ctx.fillStyle = p.color;
      ctx.fillRect(x1, MARGIN.top, x2 - x1, drawH);
      if (x2 - x1 > 35) {
        ctx.fillStyle = p.lc; ctx.globalAlpha = 0.6;
        ctx.font = `700 8px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(p.label, (x1 + x2) / 2, MARGIN.top + 3);
        ctx.globalAlpha = 1;
      }
      const xs = timeToX(ps.getTime());
      if (xs >= MARGIN.left && xs <= MARGIN.left + drawW) {
        ctx.strokeStyle = p.lc; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]); ctx.beginPath();
        ctx.moveTo(xs, MARGIN.top); ctx.lineTo(xs, MARGIN.top + drawH); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
    });

    // 2) Station grid
    estaciones.forEach((est, idx) => {
      const y = stationY(idx);
      const isM = MANIOBRA_STATIONS.has(est);
      ctx.strokeStyle = isM ? 'rgba(148,163,184,0.05)' : 'rgba(148,163,184,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(MARGIN.left, y); ctx.lineTo(MARGIN.left + drawW, y); ctx.stroke();
    });

    // 2b) Draw blue maniobra zone rectangles (no text — labels are in station column)
    MANIOBRA_ZONES.forEach(zone => {
      const indices = zone.stations.map(s => estaciones.indexOf(s)).filter(i => i >= 0);
      if (indices.length === 0) return;
      const minY = stationY(Math.min(...indices));
      const maxY = stationY(Math.max(...indices));
      const pad = 4;
      ctx.fillStyle = 'rgba(59,130,246,0.08)';
      ctx.fillRect(MARGIN.left, minY - pad, drawW, maxY - minY + pad * 2);
      ctx.fillStyle = 'rgba(59,130,246,0.35)';
      ctx.fillRect(MARGIN.left, minY - pad, 3, maxY - minY + pad * 2);
    });

    // 2c) Intermediate maniobra stations (single AVC not in a zone) — small blue tick
    const zonedStations = new Set(MANIOBRA_ZONES.flatMap(z => z.stations));
    estaciones.forEach((est, idx) => {
      if (!MANIOBRA_STATIONS.has(est) || zonedStations.has(est)) return;
      const y = stationY(idx);
      ctx.fillStyle = 'rgba(59,130,246,0.4)';
      ctx.fillRect(MARGIN.left, y - 2, 4, 4); // small blue square tick
    });

    // 3) Hour ticks
    for (let h = 0; h < 24; h++) {
      const hd = new Date(refDate); hd.setHours(h, 0, 0, 0);
      const x = timeToX(hd.getTime());
      if (x < MARGIN.left || x > MARGIN.left + drawW) continue;
      ctx.strokeStyle = 'rgba(148,163,184,0.15)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, MARGIN.top); ctx.lineTo(x, MARGIN.top + drawH); ctx.stroke();
      ctx.fillStyle = '#94a3b8'; ctx.font = `600 10px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(`${h.toString().padStart(2, '0')}:00`, x, MARGIN.top - 5);
    }
    for (let h = 0; h < 24; h++) {
      const hd = new Date(refDate); hd.setHours(h, 30, 0, 0);
      const x = timeToX(hd.getTime());
      if (x < MARGIN.left || x > MARGIN.left + drawW) continue;
      ctx.strokeStyle = 'rgba(148,163,184,0.06)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, MARGIN.top); ctx.lineTo(x, MARGIN.top + drawH); ctx.stroke();
      if (zoom >= 2) {
        ctx.fillStyle = '#475569'; ctx.font = `400 8px ${FONT}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(`${h.toString().padStart(2, '0')}:30`, x, MARGIN.top - 5);
      }
    }

    // 4) Train trajectories
    trenes.forEach((tren, ti) => {
      const col = PALETTE[ti % PALETTE.length];
      const tevs = eventos.filter(e => e.tren === tren)
        .sort((a, b) => a.datetime.getTime() - b.datetime.getTime());

      for (let i = 0; i < tevs.length - 1; i++) {
        const e1 = tevs[i], e2 = tevs[i + 1];
        const si1 = estaciones.indexOf(e1.estacion), si2 = estaciones.indexOf(e2.estacion);
        if (si1 < 0 || si2 < 0) continue;
        const x1 = timeToX(e1.datetime.getTime()), y1 = stationY(si1);
        const x2 = timeToX(e2.datetime.getTime()), y2 = stationY(si2);

        const isM = isManiobra(e1.estacion, e1.via) || isManiobra(e2.estacion, e2.via);
        if (isM) {
          ctx.strokeStyle = '#9ca3af'; // gris de maniobra
          ctx.lineWidth = 1.6; ctx.globalAlpha = 0.65;
          ctx.setLineDash([4, 4]);
        } else {
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.8; ctx.globalAlpha = 0.85;
          ctx.setLineDash(e1.via === '1' ? [5, 4] : []);
        }

        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }

      // ALL markers
      tevs.forEach(ev => {
        const si = estaciones.indexOf(ev.estacion);
        if (si < 0) return;
        const x = timeToX(ev.datetime.getTime()), y = stationY(si);

        const isM = isManiobra(ev.estacion, ev.via);
        ctx.fillStyle = isM ? '#9ca3af' : col;
        ctx.globalAlpha = isM ? 0.7 : 0.9;

        if (ev.evento === 'PARTIO') {
          ctx.beginPath();
          if (ev.via === '1') {
            // Vía 1 = OBS→PAN (↓ en diagrama) → flecha abajo ▽
            ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y - 3); ctx.lineTo(x, y + 4);
          } else {
            // Vía 2 = PAN→OBS (↑ en diagrama) → flecha arriba △
            ctx.moveTo(x, y - 4); ctx.lineTo(x + 3, y + 3); ctx.lineTo(x - 3, y + 3);
          }
          ctx.closePath(); ctx.fill();
        } else if (ev.evento === 'ARRIBO') {
          ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
        } else if (ev.evento === 'SALTO') {
          // Red X for skipped stations
          ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke();
          ctx.strokeStyle = col; // restore
        }
        ctx.globalAlpha = 1;
      });
    });

    // 4c) Marcha Tipo Ideal — anchored at each real departure
    if (showMarchaTipo) {
      const marchaPO = buildMarchaTipo('PAN→OBS', configSpeeds, configDwells);
      const marchaOP = buildMarchaTipo('OBS→PAN', configSpeeds, configDwells);

      // Detect departures: only for COMPLETE trips that reach opposite terminal
      const departurePAN: number[] = [];
      const departureOBS: number[] = [];
      const sortedEvs = [...eventos].sort((a, b) => a.datetime.getTime() - b.datetime.getTime());
      const byTrain: Record<string, typeof sortedEvs> = {};
      sortedEvs.forEach(e => { if (!byTrain[e.tren]) byTrain[e.tren] = []; byTrain[e.tren].push(e); });
      const pkPAN = STATION_PK['PAN'] || 0;
      const pkOBS = STATION_PK['OBS'] || 0;
      Object.values(byTrain).forEach(tevs => {
        for (let i = 0; i < tevs.length; i++) {
          const ev = tevs[i];
          if (ev.estacion !== 'PAN' && ev.estacion !== 'OBS') continue;
          let lastIdx = i;
          while (lastIdx + 1 < tevs.length && tevs[lastIdx + 1].estacion === ev.estacion) lastIdx++;
          let nextSt = '';
          for (let j = lastIdx + 1; j < tevs.length; j++) {
            if (tevs[j].estacion !== ev.estacion) { nextSt = tevs[j].estacion; break; }
          }
          if (!nextSt || STATION_PK[nextSt] === undefined) { i = lastIdx; continue; }
          const nextPK = STATION_PK[nextSt];
          const lastEvTime = tevs[lastIdx].datetime.getTime();

          let direction: 'PAN→OBS' | 'OBS→PAN' | null = null;
          if (ev.estacion === 'PAN' && nextPK > pkPAN) direction = 'PAN→OBS';
          if (ev.estacion === 'OBS' && nextPK < pkOBS) direction = 'OBS→PAN';
          if (!direction) { i = lastIdx; continue; }

          // Verify train reaches opposite terminal
          const target = direction === 'PAN→OBS' ? 'OBS' : 'PAN';
          let reachedTarget = false;
          for (let j = lastIdx + 1; j < tevs.length; j++) {
            if (tevs[j].estacion === target) { reachedTarget = true; break; }
            // Stop if train returns to origin terminal
            if (tevs[j].estacion === ev.estacion) break;
          }
          if (!reachedTarget) { i = lastIdx; continue; }

          if (direction === 'PAN→OBS') departurePAN.push(lastEvTime);
          else departureOBS.push(lastEvTime);
          i = lastIdx;
        }
      });

      const drawMarcha = (pts: typeof marchaPO, departures: number[], dir: 'PAN→OBS' | 'OBS→PAN') => {
        departures.forEach(tBase => {
          // Draw path
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2.5;
          ctx.globalAlpha = 0.45;
          ctx.setLineDash([8, 4]);
          ctx.beginPath();
          let moved = false;
          for (const pt of pts) {
            const si = estaciones.indexOf(pt.estacion);
            if (si < 0) continue;
            const x = timeToX(tBase + pt.timeOffsetMs);
            const y = stationY(si);
            if (!moved) { ctx.moveTo(x, y); moved = true; }
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.setLineDash([]);

          // Draw markers
          ctx.fillStyle = '#fbbf24';
          ctx.globalAlpha = 0.6;
          for (const pt of pts) {
            const si = estaciones.indexOf(pt.estacion);
            if (si < 0) continue;
            const x = timeToX(tBase + pt.timeOffsetMs);
            const y = stationY(si);
            if (pt.tipo === 'ARRIBO') {
              ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
            } else {
              // Triangle: direction-aware
              ctx.beginPath();
              if (dir === 'PAN→OBS') {
                // Going up (OBS is top) → △
                ctx.moveTo(x, y - 4); ctx.lineTo(x + 3, y + 3); ctx.lineTo(x - 3, y + 3);
              } else {
                // Going down (PAN is bottom) → ▽
                ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y - 3); ctx.lineTo(x, y + 4);
              }
              ctx.closePath(); ctx.fill();
            }
          }
          ctx.globalAlpha = 1;
        });
      };

      drawMarcha(marchaPO, departurePAN, 'PAN→OBS');
      drawMarcha(marchaOP, departureOBS, 'OBS→PAN');
    }

    // 4b) DBO markers
    if (showDbo) {
      dboPos.forEach(({ ev, x, y }) => {
        const sz = 6;
        if (ev.evento === 'DBO_ACTIVAR') {
          // Red filled square
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(x - sz, y - sz, sz * 2, sz * 2);
        } else {
          // Red outlined square (no fill)
          ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
          ctx.strokeRect(x - sz, y - sz, sz * 2, sz * 2);
        }
      });
    }

    // 4c) Alarm markers
    if (showAlarms) {
      alarmPos.forEach(({ alarm, x, y }) => {
        const sz = 6;
        const isFilled = alarm.estado === 'Abierta' || alarm.estado === 'Reconocida';
        // Diamond shape
        ctx.beginPath();
        ctx.moveTo(x, y - sz); ctx.lineTo(x + sz, y); ctx.lineTo(x, y + sz); ctx.lineTo(x - sz, y);
        ctx.closePath();
        if (isFilled) {
          ctx.fillStyle = '#f59e0b'; ctx.fill();
          ctx.fillStyle = '#000'; ctx.font = `bold 8px ${FONT}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('?', x, y + 1);
        } else {
          ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2; ctx.stroke();
          ctx.fillStyle = '#f59e0b'; ctx.font = `bold 7px ${FONT}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('?', x, y + 1);
        }
      });
    }

    // 5) Measurement cursors
    mCursors.forEach((cur, idx) => {
      const si = estaciones.indexOf(cur.estacion);
      if (si < 0) return;
      const x = timeToX(cur.time.getTime()), y = stationY(si);
      ctx.strokeStyle = cur.color; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
      ctx.setLineDash([4, 4]); ctx.beginPath();
      ctx.moveTo(x, MARGIN.top); ctx.lineTo(x, MARGIN.top + drawH); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = cur.color; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `bold 9px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${idx + 1}`, x, y);
    });

    if (calcs.length > 0) {
      const last = calcs[calcs.length - 1];
      const c1Si = estaciones.indexOf(last.cursorA.estacion);
      const c2Si = estaciones.indexOf(last.cursorB.estacion);
      if (c1Si >= 0 && c2Si >= 0) {
        const cx = (timeToX(last.cursorA.time.getTime()) + timeToX(last.cursorB.time.getTime())) / 2;
        const cy = (stationY(c1Si) + stationY(c2Si)) / 2;
        const durMs = Math.abs(last.cursorB.time.getTime() - last.cursorA.time.getTime());
        const text = `${formatDuration(durMs)} · ${last.distanciaEstaciones} est.`;
        ctx.font = `600 10px ${FONT}`; ctx.textAlign = 'center';
        const tw2 = ctx.measureText(text).width;
        roundRect(ctx, cx - tw2 / 2 - 8, cy - 12, tw2 + 16, 20, 4);
        ctx.fillStyle = 'rgba(15,23,42,0.9)'; ctx.fill();
        ctx.strokeStyle = 'rgba(99,102,241,0.5)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#e2e8f0'; ctx.fillText(text, cx, cy + 1);
      }
    }

    // 6) Left border
    ctx.strokeStyle = 'rgba(148,163,184,0.2)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(MARGIN.left, MARGIN.top);
    ctx.lineTo(MARGIN.left, MARGIN.top + drawH); ctx.stroke();
  }, [canvasW, canvasH, drawW, drawH, eventos, eventosAll, estaciones, trenes, periods, timeToX, stationY, mCursors, calcs, zoom, dboPos, showDbo, alarmPos, showAlarms, showMarchaTipo, dayStart, dayEnd, configSpeeds, configDwells]);

  // ──── OVERLAY ────
  const drawOverlay = useCallback((mx: number, my: number) => {
    const c = overlayRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasW, canvasH);

    const inArea = mx >= MARGIN.left && mx <= MARGIN.left + drawW &&
      my >= MARGIN.top && my <= MARGIN.top + drawH;
    if (!inArea) return;

    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(MARGIN.left, my); ctx.lineTo(MARGIN.left + drawW, my); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mx, MARGIN.top); ctx.lineTo(mx, MARGIN.top + drawH); ctx.stroke();
    ctx.setLineDash([]);

    const relX = (mx - MARGIN.left) / drawW;
    const t = new Date(dayStart + relX * (dayEnd - dayStart));
    const ts = t.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    ctx.font = `600 9px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const tw = ctx.measureText(ts).width;
    roundRect(ctx, mx - tw / 2 - 5, MARGIN.top - 18, tw + 10, 15, 3);
    ctx.fillStyle = 'rgba(15,23,42,0.9)'; ctx.fill();
    ctx.fillStyle = '#e2e8f0'; ctx.fillText(ts, mx, MARGIN.top - 6);

    let best: (typeof evPos)[0] | null = null;
    let bestD = SNAP_PX;
    for (const p of evPos) {
      const dx = p.x - mx, dy = p.y - my;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = p; }
    }

    // Also check DBO events (only if showDbo)
    let bestDbo: (typeof dboPos)[0] | null = null;
    let bestDboD = SNAP_PX;
    if (showDbo) {
      for (const p of dboPos) {
        const dx = p.x - mx, dy = p.y - my;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestDboD) { bestDboD = d; bestDbo = p; }
      }
    }

    // Also check Alarm events (only if showAlarms)
    let bestAlarm: (typeof alarmPos)[0] | null = null;
    let bestAlarmD = SNAP_PX;
    if (showAlarms) {
      for (const p of alarmPos) {
        const dx = p.x - mx, dy = p.y - my;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestAlarmD) { bestAlarmD = d; bestAlarm = p; }
      }
    }

    // Prefer alarm > DBO > train, pick closest
    const isDboTarget = bestDbo && (!best || bestDboD < bestD);
    const isAlarmTarget = bestAlarm && (!best || bestAlarmD < bestD) && (!bestDbo || bestAlarmD < bestDboD);
    const target = isAlarmTarget ? { x: bestAlarm!.x, y: bestAlarm!.y, ev: null as any, alarm: bestAlarm!.alarm }
      : isDboTarget ? { x: bestDbo!.x, y: bestDbo!.y, ev: bestDbo!.ev, alarm: null as any }
        : best ? { x: best.x, y: best.y, ev: best.ev, alarm: null as any } : null;

    if (target) {
      ctx.beginPath(); ctx.arc(target.x, target.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();

      let lines: string[];
      let borderColor = 'rgba(148,163,184,0.3)';

      if (isAlarmTarget && target.alarm) {
        const a = target.alarm;
        const pk = STATION_PK[a.estacion];
        lines = [
          `[ALARMA] ${a.eventType}`,
          `Est: ${a.estacion}  ·  ${a.estado || '—'}${pk !== undefined ? `  ·  PK ${pk.toFixed(0)}m` : ''}`,
          `${a.datetime.toLocaleTimeString('es-MX')}`,
          a.descripcion.length > 50 ? a.descripcion.substring(0, 50) + '…' : a.descripcion,
        ];
        borderColor = 'rgba(245,158,11,0.6)';
      } else if (isDboTarget && target.ev) {
        const pkD = STATION_PK[target.ev.estacion];
        lines = [
          target.ev.evento === 'DBO_ACTIVAR' ? '🟥 DBO Activado' : '🟥 DBO Desactivado',
          `Est: ${target.ev.estacion}${pkD !== undefined ? `  ·  PK ${pkD.toFixed(0)}m` : ''}`,
          `Hora: ${target.ev.datetime.toLocaleTimeString('es-MX')}`,
        ];
        borderColor = 'rgba(239,68,68,0.5)';
      } else if (target.ev) {
        const ev = target.ev;
        const pkE = STATION_PK[ev.estacion];
        lines = [
          `Tren: ${ev.tren}`,
          `Est: ${ev.estacion}  ·  Vía ${ev.via || '—'}${pkE !== undefined ? `  ·  PK ${pkE.toFixed(0)}m` : ''}`,
          `${ev.evento}  ·  ${ev.datetime.toLocaleTimeString('es-MX')}`,
        ];
      } else {
        lines = [];
      }

      if (lines.length > 0) {
        ctx.font = `500 11px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        const maxW = Math.max(...lines.map(l => ctx.measureText(l).width));
        const tipW = maxW + 20, tipH = lines.length * 17 + 12;
        let tx = target.x + 14, ty = target.y - tipH / 2;
        if (tx + tipW > canvasW - 10) tx = target.x - tipW - 14;
        if (ty < MARGIN.top) ty = MARGIN.top;
        if (ty + tipH > MARGIN.top + drawH) ty = MARGIN.top + drawH - tipH;

        roundRect(ctx, tx, ty, tipW, tipH, 6);
        ctx.fillStyle = 'rgba(15,23,42,0.95)'; ctx.fill();
        ctx.strokeStyle = borderColor; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#e2e8f0';
        lines.forEach((l, i) => ctx.fillText(l, tx + 10, ty + 7 + i * 17));
      }
    }
  }, [canvasW, canvasH, drawW, drawH, dayStart, dayEnd, evPos, dboPos, showDbo, alarmPos, showAlarms]);

  // ──── Effects ────
  useEffect(() => { drawMain(); }, [drawMain]);

  useEffect(() => {
    const w = scrollRef.current;
    if (!w) return;
    const onScroll = () => {
      const ctx = overlayRef.current?.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasW, canvasH);
    };
    w.addEventListener('scroll', onScroll, { passive: true });
    return () => w.removeEventListener('scroll', onScroll);
  }, [canvasW, canvasH]);

  useEffect(() => {
    const w = scrollRef.current;
    if (!w) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.85 : 1.18;
      const cx = w.scrollLeft + w.clientWidth / 2;
      const ratio = cx / (w.scrollWidth || 1);
      setZoom(z => {
        const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
        requestAnimationFrame(() => { w.scrollLeft = ratio * w.scrollWidth - w.clientWidth / 2; });
        return nz;
      });
    };
    w.addEventListener('wheel', onWheel, { passive: false });
    return () => w.removeEventListener('wheel', onWheel);
  }, []);

  // ──── Mouse handlers ────
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = overlayRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => drawOverlay(e.clientX - r.left, e.clientY - r.top));
  }, [drawOverlay]);

  const handleMouseLeave = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const ctx = overlayRef.current?.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvasW, canvasH);
  }, [canvasW, canvasH]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = overlayRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (mx < MARGIN.left || mx > canvasW - MARGIN.right ||
      my < MARGIN.top || my > canvasH - MARGIN.bottom) return;

    const relX = (mx - MARGIN.left) / drawW;
    const t = new Date(dayStart + relX * (dayEnd - dayStart));
    // Find closest station by weighted Y position
    let si = 0;
    let bestDist = Infinity;
    for (let i = 0; i < estaciones.length; i++) {
      const d = Math.abs(my - stationY(i));
      if (d < bestDist) { bestDist = d; si = i; }
    }
    const est = estaciones[si];

    const nc: Cursor = {
      id: `c-${Date.now()}`, time: t, estacion: est,
      color: CURSOR_COLORS[mCursors.length % CURSOR_COLORS.length],
    };
    const next = [...mCursors, nc];
    if (next.length > 2) { next.splice(0, next.length - 2); setCalcs([]); }
    setMCursors(next);

    if (next.length === 2) {
      const a = next[0], b = next[1];
      const mins = Math.abs(b.time.getTime() - a.time.getTime()) / 60000;
      const ai = estaciones.indexOf(a.estacion), bi = estaciones.indexOf(b.estacion);
      // Count only service stations (exclude AVC* maniobra platforms)
      const minI = Math.min(ai, bi), maxI = Math.max(ai, bi);
      const dist = estaciones.slice(minI, maxI + 1).filter(s => !s.startsWith('AVC')).length - 1;
      const vel = dist > 0 ? dist / mins : 0;
      setCalcs([{
        cursorA: a, cursorB: b,
        tiempoMinutos: Math.round(mins * 100) / 100,
        distanciaEstaciones: dist,
        velocidadEstacionesMinuto: Math.round(vel * 100) / 100,
      }]);
    }
  }, [mCursors, estaciones, stationY, dayStart, dayEnd, canvasW, canvasH, drawW, drawH]);

  const clearAll = () => { setMCursors([]); setCalcs([]); };
  const zoomIn = () => setZoom(z => Math.min(MAX_ZOOM, z * 1.4));
  const zoomOut = () => setZoom(z => Math.max(MIN_ZOOM, z / 1.4));
  const resetZoom = () => setZoom(1);

  // Diagram maximize (CSS-based, avoids Fullscreen API conflict)
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  // Close train dropdown on outside click
  useEffect(() => {
    if (!showTrainDropdown) return;
    const handler = (e: MouseEvent) => {
      if (trainDropRef.current && !trainDropRef.current.contains(e.target as Node)) {
        setShowTrainDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTrainDropdown]);

  // Time validation helpers
  const totalStartSec = parseTime(timeStart);
  const totalEndSec = parseTime(timeEnd);

  const handleTimeStart = (v: string) => {
    if (parseTime(v) >= totalEndSec) return;
    setTimeStart(v);
  };
  const handleTimeEnd = (v: string) => {
    if (parseTime(v) <= totalStartSec) return;
    setTimeEnd(v);
  };

  const selectPeriod = (p: { start: number; end: number }) => {
    setTimeStart(`${String(p.start).padStart(2, '0')}:00:00`);
    setTimeEnd(`${String(p.end).padStart(2, '0')}:00:00`);
  };
  const resetTimeRange = () => {
    setTimeStart('05:00:00');
    setTimeEnd('24:00:00');
  };

  // Train toggle
  const toggleTrain = (t: string) => {
    setSelectedTrains(prev => {
      if (!prev) {
        // switching from all -> specific: select all except this one
        const s = new Set(trenes);
        s.delete(t);
        return s.size === 0 ? null : s;
      }
      const s = new Set(prev);
      if (s.has(t)) s.delete(t); else s.add(t);
      return s.size === 0 ? null : (s.size === trenes.length ? null : s);
    });
  };
  const selectAllTrains = () => setSelectedTrains(null);
  const selectNoneTrains = () => setSelectedTrains(new Set());

  const visibleTrainCount = selectedTrains ? selectedTrains.size : trenes.length;

  const formattedDay = useMemo(() => {
    const d = new Date(selectedDay + 'T12:00:00');
    return d.toLocaleDateString('es-MX', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }, [selectedDay]);

  const periodStats = useMemo(() =>
    periods.map(p => ({
      id: p.id,
      label: p.label,
      range: `${p.start.toString().padStart(2, '0')}-${(p.end === 24 ? 0 : p.end).toString().padStart(2, '0')}`,
      color: p.lc,
      count: trenesPerPeriod[p.id] || 0,
      start: p.start,
      end: p.end,
    })),
    [periods, trenesPerPeriod],
  );

  // ──── Render ────
  return (
    <div className={`diagram-page ${isFullscreen ? 'diagram-fullscreen' : ''}`} ref={pageRef}>
      <header className="diagram-header">
        <div className="diagram-header-left">
          <div className="diagram-title-group">
            <h1>Diagrama de Hilo</h1>
            <span className="diagram-date">{formattedDay}</span>
          </div>
        </div>
        <div className="diagram-header-right">
          <div className="diagram-stats">
            <span className="stat-item"><strong>{eventos.length.toLocaleString()}</strong> ev.</span>
          </div>
          <div className="zoom-controls">
            <button onClick={zoomOut} className="zoom-btn" title="Reducir"><ZoomOut size={16} /></button>
            <span className="zoom-level">{Math.round(zoom * 100)}%</span>
            <button onClick={zoomIn} className="zoom-btn" title="Ampliar"><ZoomIn size={16} /></button>
            <button onClick={resetZoom} className="zoom-btn" title="Reset"><RotateCcw size={14} /></button>
          </div>
          <button onClick={clearAll} className="diagram-clear-btn"><Trash2 size={16} /><span>Limpiar</span></button>
          <button onClick={toggleFullscreen} className="zoom-btn" title={isFullscreen ? 'Salir pantalla completa' : 'Pantalla completa'}>
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>
      </header>

      {/* ──── Control Panel ──── */}
      <div className="diagram-controls">
        {/* Time range */}
        <div className="ctrl-group">
          <span className="ctrl-label">Rango horario</span>
          <div className="ctrl-time-inputs">
            <input type="time" step="1" value={timeStart} onChange={e => handleTimeStart(e.target.value)} className="alarm-filter-time" />
            <span className="ctrl-sep">—</span>
            <input type="time" step="1" value={timeEnd} onChange={e => handleTimeEnd(e.target.value)} className="alarm-filter-time" />
            {(timeStart !== '05:00:00' || timeEnd !== '24:00:00') ? (
              <button className="ctrl-reset-btn" onClick={resetTimeRange} title="Reset">↺</button>
            ) : null}
          </div>
        </div>

        {/* Period quick select */}
        <div className="ctrl-group">
          <span className="ctrl-label">Franja</span>
          <div className="ctrl-periods">
            {periodStats.map(p => (
              <button key={p.id} className="ctrl-period-btn" style={{ borderColor: p.color }}
                onClick={() => selectPeriod(p)} title={`${p.label} (${p.range})`}>
                <span className="legend-dot" style={{ backgroundColor: p.color }} />
                {p.id}
              </button>
            ))}
          </div>
        </div>

        {/* DBO / Alarms / Marcha Tipo toggles */}
        <div className="ctrl-group">
          <label className="ctrl-check">
            <input type="checkbox" checked={showDbo} onChange={e => setShowDbo(e.target.checked)} />
            <span style={{ color: '#ef4444' }}>DBO</span>
          </label>
          <label className="ctrl-check">
            <input type="checkbox" checked={showAlarms} onChange={e => setShowAlarms(e.target.checked)} />
            <span style={{ color: '#f59e0b' }}>Alarmas</span>
          </label>
          <label className="ctrl-check">
            <input type="checkbox" checked={showMarchaTipo} onChange={e => setShowMarchaTipo(e.target.checked)} />
            <span style={{ color: '#fbbf24' }}>Marcha Tipo</span>
          </label>
          {showMarchaTipo && (
            <button className="ctrl-reset-btn" onClick={() => setShowMarchaConfig(true)} title="Configurar marcha tipo">CFG</button>
          )}
        </div>

        {/* Train filter */}
        <div className="ctrl-group ctrl-train-filter" ref={trainDropRef}>
          <button className="ctrl-train-btn" onClick={() => setShowTrainDropdown(v => !v)}>
            {visibleTrainCount}/{trenes.length} trenes ▾
          </button>
          {showTrainDropdown && (
            <div className="ctrl-train-dropdown">
              <div className="ctrl-train-actions">
                <button onClick={selectAllTrains}>Todos</button>
                <button onClick={selectNoneTrains}>Ninguno</button>
              </div>
              <div className="ctrl-train-list">
                {trenes.map((t, i) => (
                  <label key={t} className="ctrl-train-item">
                    <input type="checkbox"
                      checked={!selectedTrains || selectedTrains.has(t)}
                      onChange={() => toggleTrain(t)} />
                    <span className="train-color-swatch" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                    <span>{t}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="diagram-body">
        <div className="diagram-canvas-area" ref={areaRef}>
          <div className="station-column" style={{ width: STATION_COL_W, height: canvasH }}>
            {(() => {
              const zonedSet = new Set(MANIOBRA_ZONES.flatMap(z => z.stations));
              return estaciones.map((est, idx) => {
                // PAN/OBS zone AVC: hide individual labels
                if (zonedSet.has(est)) return null;
                // Intermediate AVC: small blue label
                if (MANIOBRA_STATIONS.has(est)) {
                  const shortName = est.replace('AVC', '');
                  return <div key={est} className="station-label" style={{ top: stationY(idx), color: '#3b82f6', fontSize: '7px', opacity: 0.7 }}>{shortName}</div>;
                }
                return <div key={est} className="station-label" style={{ top: stationY(idx) }}>{est}</div>;
              });
            })()}
            {/* Maniobra zone labels in the station column */}
            {MANIOBRA_ZONES.map(zone => {
              const indices = zone.stations.map(s => estaciones.indexOf(s)).filter(i => i >= 0);
              if (indices.length === 0) return null;
              const minY = stationY(Math.min(...indices));
              const maxY = stationY(Math.max(...indices));
              return <div key={zone.id} className="station-label" style={{ top: (minY + maxY) / 2, color: '#3b82f6', fontWeight: 700, fontSize: '8px' }}>{zone.label}</div>;
            })}
          </div>
          <div className="canvas-scroll" ref={scrollRef}>
            <div className="canvas-stack" style={{ width: canvasW, height: canvasH }}>
              <canvas ref={mainRef} width={canvasW} height={canvasH} />
              <canvas ref={overlayRef} width={canvasW} height={canvasH}
                onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
                onClick={handleClick} style={{ cursor: 'crosshair' }} />
            </div>
          </div>
        </div>

        <aside className="diagram-sidebar">
          <div className="sidebar-section sidebar-refs-compact">
            <h3 className="sidebar-title">Referencias</h3>
            <div className="ref-inline">
              <div className="ref-item">
                <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4,3" /></svg>
                <span>V1</span>
              </div>
              <div className="ref-item">
                <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="#94a3b8" strokeWidth="2" /></svg>
                <span>V2</span>
              </div>
              <div className="ref-item">
                <svg width="12" height="12"><circle cx="6" cy="6" r="3" fill="#94a3b8" /></svg>
                <span>Arr</span>
              </div>
              <div className="ref-item">
                <svg width="12" height="12"><polygon points="3,2 9,2 6,10" fill="#94a3b8" /></svg>
                <span>Part↓</span>
              </div>
              <div className="ref-item">
                <svg width="12" height="12"><polygon points="6,2 9,10 3,10" fill="#94a3b8" /></svg>
                <span>Part↑</span>
              </div>
              <div className="ref-item">
                <svg width="12" height="12"><line x1="2" y1="2" x2="10" y2="10" stroke="#94a3b8" strokeWidth="2" /><line x1="10" y1="2" x2="2" y2="10" stroke="#94a3b8" strokeWidth="2" /></svg>
                <span>Salto</span>
              </div>
            </div>
            <div className="period-list-compact">
              {periodStats.map(p => (
                <div key={p.id} className="period-stat-item">
                  <span className="legend-dot" style={{ backgroundColor: p.color }} />
                  <span className="period-label">{p.label} ({p.range})</span>
                  <strong className="period-count">{p.count} tr</strong>
                </div>
              ))}
            </div>
            <p className="sidebar-hint">Ctrl + Scroll = Zoom horizontal</p>
          </div>

          <div className="sidebar-section sidebar-trains">
            <h3 className="sidebar-title">Trenes ({trenes.length})</h3>
            <div className="train-legend-grid">
              {trenes.map((tren, i) => (
                <div key={tren} className={`train-legend-item ${selectedTrains && !selectedTrains.has(tren) ? 'train-hidden' : ''}`}
                  onClick={() => toggleTrain(tren)} style={{ cursor: 'pointer' }}>
                  <span className="train-color-swatch" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                  <span className="train-legend-name">{tren}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
      <MarchaConfig
        open={showMarchaConfig}
        onClose={() => setShowMarchaConfig(false)}
        speeds={configSpeeds}
        dwells={configDwells}
        onSave={(s, d) => { onConfigSpeedsChange(s); onConfigDwellsChange(d); }}
      />
    </div>
  );
};
