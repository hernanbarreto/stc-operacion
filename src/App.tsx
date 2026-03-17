import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from './contexts/AuthContext';
import { Login } from './components/Login';
import { UploadComponent } from './components/Upload';
import { Diagram } from './components/Diagram';
import { Reports } from './components/Reports';
import { Insights } from './components/Insights';
import { AlarmTable } from './components/AlarmTable';
import { ManeuversPanel } from './components/ManeuversPanel';
import type { ExcelUploadData } from './types';
import { LogOut, Upload, ChevronDown, FileDown, Loader } from 'lucide-react';
import { useAnalytics } from './hooks/useAnalytics';
import { useInsights } from './hooks/useInsights';
import { useManeuversAnalysis } from './hooks/useManeuversAnalysis';

import { IDEAL_SEGMENT_SPEED, IDEAL_DWELL_MS } from './data/marchaTipo';
import { exportToPdf } from './utils/pdfExport';
import './App.css';

const DAY_TYPE_LABELS: Record<string, string> = {
  laborable: 'Día Laborable',
  sabado: 'Sábado',
  domingo: 'Domingo / Festivo',
};

export const App: React.FC = () => {
  const { user, loading, logout } = useAuth();
  const [excelData, setExcelData] = useState<ExcelUploadData | null>(null);
  const [selectedDay, setSelectedDay] = useState<string>('');
  const [showUpload, setShowUpload] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadingDay, setLoadingDay] = useState(false);
  const reportsRef = useRef<HTMLDivElement>(null);

  // Safety timeout: if loadingDay stays true for >5s, force-clear it
  useEffect(() => {
    if (!loadingDay) return;
    const safetyTimer = setTimeout(() => setLoadingDay(false), 5000);
    return () => clearTimeout(safetyTimer);
  }, [loadingDay]);

  // Disable right-click globally
  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, []);

  // Analytics for PDF export
  const eventos = excelData && selectedDay ? (excelData.eventos_por_dia[selectedDay] || []) : [];
  const alarmas = excelData && selectedDay ? (excelData.alarmas_por_dia[selectedDay] || []) : [];
  const analytics = useAnalytics(eventos, selectedDay || '2025-01-01');
  const insights = useInsights(eventos, alarmas, analytics);
  const maneuvers = useManeuversAnalysis(eventos, selectedDay || '2025-01-01');
  const [configSpeeds, setConfigSpeeds] = useState<Record<string, number>>({ ...IDEAL_SEGMENT_SPEED });
  const [configDwells, setConfigDwells] = useState<Record<string, number>>({ ...IDEAL_DWELL_MS });


  const handleExportPdf = useCallback(async () => {
    if (!excelData || !selectedDay) return;
    setExporting(true);

    try {
      // Get chart canvases from reports section
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
        insights: insights,
        maneuvers,
      });
    } catch (err) {
      console.error('PDF export error:', err);
    } finally {
      setExporting(false);
    }
  }, [excelData, selectedDay, analytics]);

  if (loading) {
    return (
      <div className="app-loader">
        <div className="app-loader-spinner" />
        <p>Cargando...</p>
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <div className="main-page">
      {/* ─── Top Nav ─── */}
      <nav className="main-nav">
        <div className="nav-left">
          <img src="/metro.png" alt="Metro" className="nav-logo-metro" />
          <div className="nav-brand">
            <h1>STC Operación</h1>
            <span className="nav-subtitle">Línea 1 - Reporte</span>
          </div>
        </div>
        <div className="nav-actions">
          {excelData && selectedDay && !showUpload && (
            <button className="nav-btn nav-btn-pdf" onClick={handleExportPdf} disabled={exporting}>
              {exporting ? <Loader size={15} className="spin" /> : <FileDown size={15} />}
              <span>{exporting ? 'Exportando…' : 'Exportar PDF'}</span>
            </button>
          )}
          {excelData && (
            <button className="nav-btn" onClick={() => { setShowUpload(true); }}>
              <Upload size={15} /><span>Cargar otro</span>
            </button>
          )}
          <span className="nav-user">{user.email}</span>
          <button className="nav-btn nav-btn-logout" onClick={logout}>
            <LogOut size={15} /><span>Salir</span>
          </button>
          <img src="/ingerop.png" alt="Ingerop" className="nav-logo-ingerop" title="Programó: Hernán Barreto — Potenció: Leo Casale" />
        </div>
      </nav>

      <div className="main-content">
        {/* ─── Upload Section ─── */}
        {(!excelData || showUpload) && (
          <section className="section-upload">
            <UploadComponent
              onDataLoaded={(data) => {
                setExcelData(data);
                setShowUpload(false);
                if (data.días.length === 1) {
                  setSelectedDay(data.días[0]);
                } else {
                  setSelectedDay('');
                }
              }}
              onLogout={logout}
              embedded
            />
          </section>
        )}

        {/* ─── Day Selector ─── */}
        {excelData && !showUpload && (
          <section className="section-days">
            <div className="days-bar">
              <span className="days-label">Día:</span>
              <div className="days-chips">
                {excelData.días.map((dia) => {
                  const fecha = new Date(dia + 'T12:00:00');
                  const diasES = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
                  const diaStr = diasES[fecha.getDay()];
                  const fechaStr = fecha.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });
                  const evCount = excelData.eventos_por_dia[dia]?.length || 0;

                  return (
                    <button key={dia}
                      className={`day-chip ${selectedDay === dia ? 'active' : ''}`}
                      onClick={() => {
                        setLoadingDay(true);
                        setTimeout(() => {
                          setSelectedDay(dia);
                          setTimeout(() => setLoadingDay(false), 300);
                        }, 50);
                      }}>
                      <strong>{diaStr}</strong> {fechaStr}
                      <span className="chip-count">{evCount.toLocaleString()} ev.</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Loading overlay */}
        {loadingDay && (
          <div className="day-loading-overlay" onClick={() => setLoadingDay(false)}>
            <div className="day-loading-content">
              <Loader size={32} className="spin" />
              <span>Procesando datos...</span>
              <span className="day-loading-hint">Toca para cerrar</span>
            </div>
          </div>
        )}

        {/* ─── Diagram ─── */}
        {excelData && selectedDay && !showUpload && (
          <>
            <section className="section-diagram">
              <Diagram
                data={excelData}
                selectedDay={selectedDay}
                onBack={() => setSelectedDay('')}
                configSpeeds={configSpeeds}
                configDwells={configDwells}
                onConfigSpeedsChange={setConfigSpeeds}
                onConfigDwellsChange={setConfigDwells}
              />
            </section>

            {/* ─── Insights (between diagram and reports) ─── */}
            <section className="section-insights">
              <Insights data={insights} />
              <ManeuversPanel data={maneuvers} />
            </section>

            {/* ─── Reports (scroll down) ─── */}
            <section className="section-reports" ref={reportsRef}>
              <div className="scroll-hint">
                <ChevronDown size={16} /> Reportes
              </div>
              <Reports
                data={excelData}
                selectedDay={selectedDay}
                onBack={() => { }}
              />
            </section>

            {/* ─── Alarm Table ─── */}
            {excelData.alarmas_por_dia[selectedDay]?.length > 0 && (
              <section className="section-alarms">
                <AlarmTable
                  alarmas={excelData.alarmas_por_dia[selectedDay]}
                  fecha={selectedDay}
                />
              </section>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {excelData && selectedDay && !showUpload && (
        <footer className="app-footer">
          <span>Ingerop T3 — Ciudad de México</span>
        </footer>
      )}
    </div>
  );
};

export default App;
