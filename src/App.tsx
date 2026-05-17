import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from './contexts/AuthContext';
import { Login } from './components/Login';
import { Diagram } from './components/Diagram';
import { Reports } from './components/Reports';
import { Insights } from './components/Insights';
import { AlarmTable } from './components/AlarmTable';
import { ManeuversPanel } from './components/ManeuversPanel';
import { CalendarView } from './components/Calendar';
import { UploadModal } from './components/UploadModal';
import { FilesModal } from './components/FilesModal';
import { MarchasViewer } from './components/MarchasViewer';
import type { ExcelUploadData } from './types';
import {
  LogOut, Upload, ChevronDown, FileDown, Loader, FolderOpen,
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Activity,
} from 'lucide-react';
import { useAnalytics } from './hooks/useAnalytics';
import { useInsights } from './hooks/useInsights';
import { useManeuversAnalysis } from './hooks/useManeuversAnalysis';
import { useExcelProcessor } from './hooks/useExcelProcessor';
import { fetchIndex, type DayIndexEntry } from './services/daysIndex';
import { downloadExcelFile } from './services/storageService';

import { exportToPdf } from './utils/pdfExport';
import './App.css';

const DAY_TYPE_LABELS: Record<string, string> = {
  laborable: 'Día Laborable',
  sabado: 'Sábado',
  domingo: 'Domingo / Festivo',
};

type View = 'calendar' | 'diagram' | 'simulador';

export const App: React.FC = () => {
  const { user, loading, logout } = useAuth();

  const [view, setView] = useState<View>('calendar');
  const [dayIndex, setDayIndex] = useState<DayIndexEntry[]>([]);
  const [dayIndexLoading, setDayIndexLoading] = useState(true);
  const [dayIndexError, setDayIndexError] = useState('');

  const [excelData, setExcelData] = useState<ExcelUploadData | null>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string>('');
  const [loadingDay, setLoadingDay] = useState<string | null>(null);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showFilesModal, setShowFilesModal] = useState(false);
  const [exporting, setExporting] = useState(false);

  const reportsRef = useRef<HTMLDivElement>(null);
  const activeChipRef = useRef<HTMLButtonElement>(null);
  const { procesarExcel } = useExcelProcessor();

  // Auto-scroll active day chip into center of the chips bar
  useEffect(() => {
    if (!selectedDay) return;
    const el = activeChipRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedDay, view]);

  // Load day index from server (single small JSON file in Storage)
  const refreshDayIndex = useCallback(async () => {
    setDayIndexLoading(true);
    setDayIndexError('');
    try {
      const idx = await fetchIndex();
      setDayIndex(idx);
    } catch (err) {
      setDayIndexError(err instanceof Error ? err.message : 'Error al cargar el índice');
    } finally {
      setDayIndexLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) refreshDayIndex();
  }, [user, refreshDayIndex]);

  // Disable right-click globally
  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, []);

  // Open a day: download+process its source file if needed, then switch to diagram
  const openDay = useCallback(async (entry: DayIndexEntry) => {
    setLoadingDay(entry.fecha);
    try {
      if (loadedSource !== entry.source || !excelData) {
        const buffer = await downloadExcelFile(entry.source);
        const file = new File([buffer], entry.source);
        const data = await procesarExcel(file);
        setExcelData(data);
        setLoadedSource(entry.source);
      }
      setSelectedDay(entry.fecha);
      setView('diagram');
    } catch (err) {
      setDayIndexError(err instanceof Error ? err.message : 'Error al cargar el día');
    } finally {
      setLoadingDay(null);
    }
  }, [loadedSource, excelData, procesarExcel]);

  const goToCalendar = useCallback(() => {
    setView('calendar');
  }, []);

  // Prev/Next day within the index
  const goAdjacentDay = useCallback((delta: number) => {
    if (!selectedDay) return;
    const idx = dayIndex.findIndex(e => e.fecha === selectedDay);
    if (idx < 0) return;
    const target = dayIndex[idx + delta];
    if (target) openDay(target);
  }, [dayIndex, selectedDay, openDay]);

  // Analytics for currently selected day
  const eventos = excelData && selectedDay ? (excelData.eventos_por_dia[selectedDay] || []) : [];
  const alarmas = excelData && selectedDay ? (excelData.alarmas_por_dia[selectedDay] || []) : [];
  const analytics = useAnalytics(eventos, selectedDay || '2025-01-01');
  const insights = useInsights(eventos, alarmas, analytics);
  const maneuvers = useManeuversAnalysis(eventos, selectedDay || '2025-01-01');

  const handleExportPdf = useCallback(async () => {
    if (!excelData || !selectedDay) return;
    setExporting(true);
    try {
      const reportsEl = reportsRef.current;
      const chartCanvases: HTMLCanvasElement[] = [];
      if (reportsEl) {
        const wrappers = reportsEl.querySelectorAll('.grouped-canvas-stack');
        wrappers.forEach(w => {
          const c = w.querySelector('canvas');
          if (c) chartCanvases.push(c);
        });
      }

      const d = new Date(selectedDay + 'T12:00:00');
      const dateLabel = d.toLocaleDateString('es-MX', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });

      await exportToPdf({
        dateLabel,
        dayTypeLabel: DAY_TYPE_LABELS[analytics.dayType] || '',
        eventos: excelData.eventos_por_dia[selectedDay] || [],
        vuelta: analytics.vuelta,
        comercialSpeed: analytics.comercialSpeed,
        segmentSpeed: analytics.segmentSpeed,
        headway: analytics.headway,
        dwell: analytics.dwell,
        periods: analytics.periods,
        chartCanvases,
        insights,
        maneuvers,
      });
    } catch (err) {
      console.error('PDF export error:', err);
    } finally {
      setExporting(false);
    }
  }, [excelData, selectedDay, analytics, insights, maneuvers]);

  if (loading) {
    return (
      <div className="app-loader">
        <div className="app-loader-spinner" />
        <p>Cargando...</p>
      </div>
    );
  }

  if (!user) return <Login />;

  const inDiagram = view === 'diagram' && excelData && selectedDay;
  const selectedIdx = dayIndex.findIndex(e => e.fecha === selectedDay);
  const hasPrev = selectedIdx > 0;
  const hasNext = selectedIdx >= 0 && selectedIdx < dayIndex.length - 1;

  return (
    <div className="main-page">
      <nav className="main-nav">
        <div className="nav-left">
          <img src="/metro.png" alt="Metro" className="nav-logo-metro" />
          <div className="nav-brand">
            <h1>STC Operación</h1>
            <span className="nav-subtitle">Línea 1 - Reporte</span>
          </div>
        </div>
        <div className="nav-actions">
          {inDiagram && (
            <button className="nav-btn nav-btn-pdf" onClick={handleExportPdf} disabled={exporting}>
              {exporting ? <Loader size={15} className="spin" /> : <FileDown size={15} />}
              <span>{exporting ? 'Exportando…' : 'Exportar PDF'}</span>
            </button>
          )}
          <button
            className={`nav-btn ${view === 'simulador' ? 'nav-btn-active' : ''}`}
            onClick={() => setView(view === 'simulador' ? 'calendar' : 'simulador')}
            title={view === 'simulador' ? 'Volver al calendario' : 'Ver marcha tipo'}
          >
            {view === 'simulador'
              ? (<><CalendarIcon size={15} /><span>Calendario</span></>)
              : (<><Activity size={15} /><span>Marcha Tipo</span></>)}
          </button>
          <button className="nav-btn" onClick={() => setShowUploadModal(true)}>
            <Upload size={15} /><span>Subir</span>
          </button>
          <button className="nav-btn" onClick={() => setShowFilesModal(true)}>
            <FolderOpen size={15} /><span>Archivos</span>
          </button>
          <span className="nav-user">{user.email}</span>
          <button className="nav-btn nav-btn-logout" onClick={logout}>
            <LogOut size={15} /><span>Salir</span>
          </button>
          <img src="/ingerop.png" alt="Ingerop" className="nav-logo-ingerop"
               title="Programó: Hernán Barreto — Potenció: Leo Casale" />
        </div>
      </nav>

      <div className="main-content">
        {/* ─── Marcha Tipo view ─── */}
        {view === 'simulador' && <MarchasViewer />}

        {/* ─── Calendar view ─── */}
        {view === 'calendar' && (
          <section className="section-calendar">
            {dayIndexLoading ? (
              <div className="calendar-loading">
                <Loader size={28} className="spin" />
                <p>Cargando índice…</p>
              </div>
            ) : dayIndexError ? (
              <div className="calendar-error">
                <p>{dayIndexError}</p>
                <button className="nav-btn" onClick={refreshDayIndex}>Reintentar</button>
              </div>
            ) : dayIndex.length === 0 ? (
              <div className="calendar-empty">
                <CalendarIcon size={42} strokeWidth={1.2} />
                <h2>No hay datos indexados</h2>
                <p>Sube un archivo Excel nuevo para comenzar. Si ya tienes archivos en el servidor sin indexar, abrí "Archivos" y dale a "Reescanear".</p>
                <div className="calendar-empty-actions">
                  <button className="nav-btn" onClick={() => setShowUploadModal(true)}>
                    <Upload size={15} /><span>Subir archivo</span>
                  </button>
                  <button className="nav-btn" onClick={() => setShowFilesModal(true)}>
                    <FolderOpen size={15} /><span>Archivos del servidor</span>
                  </button>
                </div>
              </div>
            ) : (
              <CalendarView
                dayIndex={dayIndex}
                onSelectDay={openDay}
                loadingDay={loadingDay}
              />
            )}
          </section>
        )}

        {/* ─── Diagram view ─── */}
        {inDiagram && (
          <>
            <section className="section-days">
              <div className="days-bar">
                <button className="days-back-btn" onClick={goToCalendar} title="Volver al calendario">
                  <CalendarIcon size={14} /><span>Calendario</span>
                </button>
                <button
                  className="days-nav-btn"
                  onClick={() => goAdjacentDay(-1)}
                  disabled={!hasPrev || !!loadingDay}
                  title="Día anterior"
                >
                  <ChevronLeft size={16} />
                </button>
                <div className="days-chips">
                  {dayIndex.map(entry => {
                    const fecha = new Date(entry.fecha + 'T12:00:00');
                    const diasES = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
                    const diaStr = diasES[fecha.getDay()];
                    const fechaStr = fecha.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });
                    const isActive = selectedDay === entry.fecha;
                    const isLoading = loadingDay === entry.fecha;
                    return (
                      <button key={entry.fecha}
                        ref={isActive ? activeChipRef : null}
                        className={`day-chip ${isActive ? 'active' : ''} ${isLoading ? 'loading' : ''}`}
                        onClick={() => openDay(entry)}
                        disabled={!!loadingDay}
                      >
                        <strong>{diaStr}</strong> {fechaStr}
                        <span className="chip-count">{entry.evCount.toLocaleString()} ev.</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  className="days-nav-btn"
                  onClick={() => goAdjacentDay(1)}
                  disabled={!hasNext || !!loadingDay}
                  title="Día siguiente"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </section>

            {loadingDay && (
              <div className="day-loading-overlay">
                <div className="day-loading-content">
                  <Loader size={32} className="spin" />
                  <span>Procesando datos...</span>
                </div>
              </div>
            )}

            <section className="section-diagram">
              <Diagram
                data={excelData!}
                selectedDay={selectedDay}
                onBack={goToCalendar}
              />
            </section>

            <section className="section-insights">
              <Insights data={insights} />
              <ManeuversPanel data={maneuvers} />
            </section>

            <section className="section-reports" ref={reportsRef}>
              <div className="scroll-hint">
                <ChevronDown size={16} /> Reportes
              </div>
              <Reports
                data={excelData!}
                selectedDay={selectedDay}
                onBack={() => { }}
              />
            </section>

            {excelData!.alarmas_por_dia[selectedDay]?.length > 0 && (
              <section className="section-alarms">
                <AlarmTable
                  alarmas={excelData!.alarmas_por_dia[selectedDay]}
                  fecha={selectedDay}
                />
              </section>
            )}
          </>
        )}
      </div>

      {inDiagram && (
        <footer className="app-footer">
          <span>Ingerop T3 — Ciudad de México</span>
        </footer>
      )}

      {showUploadModal && (
        <UploadModal
          onClose={() => setShowUploadModal(false)}
          onSuccess={(entries, data, fileName) => {
            setShowUploadModal(false);
            setExcelData(data);
            setLoadedSource(fileName);
            refreshDayIndex();
            // If a single day was uploaded, jump straight to its diagram view
            if (entries.length === 1) {
              setSelectedDay(entries[0].fecha);
              setView('diagram');
            }
          }}
        />
      )}

      {showFilesModal && (
        <FilesModal
          onClose={() => setShowFilesModal(false)}
          onIndexChanged={refreshDayIndex}
        />
      )}
    </div>
  );
};

export default App;
