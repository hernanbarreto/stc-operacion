import React from 'react';
import { PALETTE } from './constants';

interface PeriodStat {
  id: string;
  label: string;
  range: string;
  color: string;
  count: number;
  start: number;
  end: number;
}

interface ControlPanelProps {
  timeStart: string;
  timeEnd: string;
  onTimeStart: (v: string) => void;
  onTimeEnd: (v: string) => void;
  onResetTimeRange: () => void;
  periodStats: PeriodStat[];
  onSelectPeriod: (p: { start: number; end: number }) => void;
  showDbo: boolean;
  showAlarms: boolean;
  showMarchaTipo: boolean;
  onToggleDbo: (v: boolean) => void;
  onToggleAlarms: (v: boolean) => void;
  onToggleMarchaTipo: (v: boolean) => void;
  trenes: string[];
  selectedTrains: Set<string> | null;
  visibleTrainCount: number;
  showTrainDropdown: boolean;
  onToggleTrainDropdown: () => void;
  trainDropRef: React.RefObject<HTMLDivElement | null>;
  onToggleTrain: (t: string) => void;
  onSelectAllTrains: () => void;
  onSelectNoneTrains: () => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  timeStart, timeEnd, onTimeStart, onTimeEnd, onResetTimeRange,
  periodStats, onSelectPeriod,
  showDbo, showAlarms, showMarchaTipo,
  onToggleDbo, onToggleAlarms, onToggleMarchaTipo,
  trenes, selectedTrains, visibleTrainCount, showTrainDropdown,
  onToggleTrainDropdown, trainDropRef, onToggleTrain,
  onSelectAllTrains, onSelectNoneTrains,
}) => {
  const timeRangeChanged = timeStart !== '05:00:00' || timeEnd !== '24:00:00';

  return (
    <div className="diagram-controls">
      <div className="ctrl-group">
        <span className="ctrl-label">Rango horario</span>
        <div className="ctrl-time-inputs">
          <input type="time" step="1" value={timeStart}
            onChange={e => onTimeStart(e.target.value)}
            className="alarm-filter-time" />
          <span className="ctrl-sep">—</span>
          <input type="time" step="1" value={timeEnd}
            onChange={e => onTimeEnd(e.target.value)}
            className="alarm-filter-time" />
          {timeRangeChanged && (
            <button className="ctrl-reset-btn" onClick={onResetTimeRange} title="Reset">↺</button>
          )}
        </div>
      </div>

      <div className="ctrl-group">
        <span className="ctrl-label">Franja</span>
        <div className="ctrl-periods">
          {periodStats.map(p => (
            <button key={p.id} className="ctrl-period-btn" style={{ borderColor: p.color }}
              onClick={() => onSelectPeriod(p)} title={`${p.label} (${p.range})`}>
              <span className="legend-dot" style={{ backgroundColor: p.color }} />
              {p.id}
            </button>
          ))}
        </div>
      </div>

      <div className="ctrl-group">
        <label className="ctrl-check">
          <input type="checkbox" checked={showDbo} onChange={e => onToggleDbo(e.target.checked)} />
          <span style={{ color: '#ef4444' }}>DBO</span>
        </label>
        <label className="ctrl-check">
          <input type="checkbox" checked={showAlarms} onChange={e => onToggleAlarms(e.target.checked)} />
          <span style={{ color: '#f59e0b' }}>Alarmas</span>
        </label>
        <label className="ctrl-check">
          <input type="checkbox" checked={showMarchaTipo} onChange={e => onToggleMarchaTipo(e.target.checked)} />
          <span style={{ color: '#fbbf24' }}>Marcha Tipo</span>
        </label>
      </div>

      <div className="ctrl-group ctrl-train-filter" ref={trainDropRef}>
        <button className="ctrl-train-btn" onClick={onToggleTrainDropdown}>
          {visibleTrainCount}/{trenes.length} trenes ▾
        </button>
        {showTrainDropdown && (
          <div className="ctrl-train-dropdown">
            <div className="ctrl-train-actions">
              <button onClick={onSelectAllTrains}>Todos</button>
              <button onClick={onSelectNoneTrains}>Ninguno</button>
            </div>
            <div className="ctrl-train-list">
              {trenes.map((t, i) => (
                <label key={t} className="ctrl-train-item">
                  <input type="checkbox"
                    checked={!selectedTrains || selectedTrains.has(t)}
                    onChange={() => onToggleTrain(t)} />
                  <span className="train-color-swatch" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
