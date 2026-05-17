import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { ExcelUploadData, Cursor, CursorCalculation } from '../types';
import { Trash2, ZoomIn, ZoomOut, RotateCcw, Maximize, Minimize } from 'lucide-react';
import {
  KNOWN_STATION_ORDER, CURSOR_COLORS, MARGIN, STATION_COL_W,
  DEFAULT_PX_PER_HOUR, MIN_ZOOM, MAX_ZOOM, MANIOBRA_STATIONS, MANIOBRA_ZONES,
} from './diagram/constants';
import { getDayType, getPeriodsForDay, parseTime } from './diagram/helpers';
import { renderMain } from './diagram/renderMain';
import { renderOverlay } from './diagram/renderOverlay';
import { ControlPanel } from './diagram/ControlPanel';
import { DiagramSidebar } from './diagram/DiagramSidebar';
import './Diagram.css';

interface DiagramProps {
  data: ExcelUploadData;
  selectedDay: string;
  onBack: () => void;
}

export const Diagram: React.FC<DiagramProps> = ({
  data, selectedDay,
}) => {
  const mainRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const trainDropRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  const [zoom, setZoom] = useState(1);
  const [canvasH, setCanvasH] = useState(600);
  const [mCursors, setMCursors] = useState<Cursor[]>([]);
  const [calcs, setCalcs] = useState<CursorCalculation[]>([]);
  const [showDbo, setShowDbo] = useState(false);
  const [showAlarms, setShowAlarms] = useState(false);
  const [showMarchaTipo, setShowMarchaTipo] = useState(false);
  const [timeStart, setTimeStart] = useState('05:00:00');
  const [timeEnd, setTimeEnd] = useState('24:00:00');
  const [selectedTrains, setSelectedTrains] = useState<Set<string> | null>(null);
  const [showTrainDropdown, setShowTrainDropdown] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
  const eventosAll = useMemo(
    () => (data.eventos_por_dia[selectedDay] || []).filter(e => e.evento !== 'DBO_ACTIVAR' && e.evento !== 'DBO_DESACTIVAR'),
    [data, selectedDay],
  );
  const dboEventos = useMemo(
    () => (data.eventos_por_dia[selectedDay] || []).filter(e => e.evento === 'DBO_ACTIVAR' || e.evento === 'DBO_DESACTIVAR'),
    [data, selectedDay],
  );
  const alarmEventos = useMemo(
    () => (data.alarmas_por_dia?.[selectedDay] || []).filter(a => a.estacion),
    [data, selectedDay],
  );
  const trenes = useMemo(() => [...new Set(eventosAll.map(e => e.tren))].sort(), [eventosAll]);

  const eventos = useMemo(() => {
    if (!selectedTrains) return eventosAll;
    return eventosAll.filter(e => selectedTrains.has(e.tren));
  }, [eventosAll, selectedTrains]);

  const estaciones = useMemo(() => [...KNOWN_STATION_ORDER], []);
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

  // Weighted stationY: compress maniobra stations vertically
  const stationWeights = useMemo(() => {
    const MAN_WEIGHT = 0.15;
    const weights = estaciones.map(est => MANIOBRA_STATIONS.has(est) ? MAN_WEIGHT : 1.0);
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

  const evPos = useMemo(() => eventos.map(ev => {
    const si = estaciones.indexOf(ev.estacion);
    return { ev, x: timeToX(ev.datetime.getTime()), y: si >= 0 ? stationY(si) : -1 };
  }).filter(p => p.y >= 0), [eventos, estaciones, timeToX, stationY]);

  const dboPos = useMemo(() => dboEventos.map(ev => {
    const si = estaciones.indexOf(ev.estacion);
    return { ev, x: timeToX(ev.datetime.getTime()), y: si >= 0 ? stationY(si) : -1 };
  }).filter(p => p.y >= 0), [dboEventos, estaciones, timeToX, stationY]);

  const alarmPos = useMemo(() => alarmEventos.map(alarm => {
    const si = estaciones.indexOf(alarm.estacion);
    return { alarm, x: timeToX(alarm.datetime.getTime()), y: si >= 0 ? stationY(si) : -1 };
  }).filter(p => p.y >= 0), [alarmEventos, estaciones, timeToX, stationY]);

  // ──── Effects: render ────
  useEffect(() => {
    if (!mainRef.current) return;
    renderMain({
      canvas: mainRef.current,
      canvasW, canvasH, drawW, drawH,
      eventos, estaciones, trenes, periods,
      evPos, dboPos, alarmPos, mCursors, calcs, zoom,
      showDbo, showAlarms, showMarchaTipo,
      timeToX, stationY,
    });
  }, [canvasW, canvasH, drawW, drawH, eventos, estaciones, trenes, periods,
      evPos, dboPos, alarmPos, mCursors, calcs, zoom,
      showDbo, showAlarms, showMarchaTipo,
      timeToX, stationY]);

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
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => renderOverlay({
      canvas: c, canvasW, canvasH, drawW, drawH, dayStart, dayEnd,
      evPos, dboPos, alarmPos, showDbo, showAlarms, mx, my,
    }));
  }, [canvasW, canvasH, drawW, drawH, dayStart, dayEnd, evPos, dboPos, alarmPos, showDbo, showAlarms]);

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
    if (mx < MARGIN.left || mx > canvasW - MARGIN.right
      || my < MARGIN.top || my > canvasH - MARGIN.bottom) return;

    const relX = (mx - MARGIN.left) / drawW;
    const t = new Date(dayStart + relX * (dayEnd - dayStart));
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
  }, [mCursors, estaciones, stationY, dayStart, dayEnd, canvasW, canvasH, drawW]);

  const clearAll = () => { setMCursors([]); setCalcs([]); };
  const zoomIn = () => setZoom(z => Math.min(MAX_ZOOM, z * 1.4));
  const zoomOut = () => setZoom(z => Math.max(MIN_ZOOM, z / 1.4));
  const resetZoom = () => setZoom(1);
  const toggleFullscreen = useCallback(() => setIsFullscreen(prev => !prev), []);

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

  // Time validation
  const handleTimeStart = (v: string) => {
    if (parseTime(v) >= parseTime(timeEnd)) return;
    setTimeStart(v);
  };
  const handleTimeEnd = (v: string) => {
    if (parseTime(v) <= parseTime(timeStart)) return;
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
          <button onClick={toggleFullscreen} className="zoom-btn"
            title={isFullscreen ? 'Salir pantalla completa' : 'Pantalla completa'}>
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>
      </header>

      <ControlPanel
        timeStart={timeStart} timeEnd={timeEnd}
        onTimeStart={handleTimeStart} onTimeEnd={handleTimeEnd}
        onResetTimeRange={resetTimeRange}
        periodStats={periodStats} onSelectPeriod={selectPeriod}
        showDbo={showDbo} showAlarms={showAlarms} showMarchaTipo={showMarchaTipo}
        onToggleDbo={setShowDbo} onToggleAlarms={setShowAlarms} onToggleMarchaTipo={setShowMarchaTipo}
        trenes={trenes} selectedTrains={selectedTrains}
        visibleTrainCount={visibleTrainCount} showTrainDropdown={showTrainDropdown}
        onToggleTrainDropdown={() => setShowTrainDropdown(v => !v)}
        trainDropRef={trainDropRef}
        onToggleTrain={toggleTrain}
        onSelectAllTrains={selectAllTrains}
        onSelectNoneTrains={selectNoneTrains}
      />

      <div className="diagram-body">
        <div className="diagram-canvas-area" ref={areaRef}>
          <div className="station-column" style={{ width: STATION_COL_W, height: canvasH }}>
            {(() => {
              const zonedSet = new Set(MANIOBRA_ZONES.flatMap(z => z.stations));
              return estaciones.map((est, idx) => {
                if (zonedSet.has(est)) return null;
                if (MANIOBRA_STATIONS.has(est)) {
                  const shortName = est.replace('AVC', '');
                  return (
                    <div key={est} className="station-label"
                      style={{ top: stationY(idx), color: '#3b82f6', fontSize: '7px', opacity: 0.7 }}>
                      {shortName}
                    </div>
                  );
                }
                return <div key={est} className="station-label" style={{ top: stationY(idx) }}>{est}</div>;
              });
            })()}
            {MANIOBRA_ZONES.map(zone => {
              const indices = zone.stations.map(s => estaciones.indexOf(s)).filter(i => i >= 0);
              if (indices.length === 0) return null;
              const minY = stationY(Math.min(...indices));
              const maxY = stationY(Math.max(...indices));
              return (
                <div key={zone.id} className="station-label"
                  style={{ top: (minY + maxY) / 2, color: '#3b82f6', fontWeight: 700, fontSize: '8px' }}>
                  {zone.label}
                </div>
              );
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

        <DiagramSidebar
          trenes={trenes}
          selectedTrains={selectedTrains}
          onToggleTrain={toggleTrain}
          periodStats={periodStats}
        />
      </div>
    </div>
  );
};
