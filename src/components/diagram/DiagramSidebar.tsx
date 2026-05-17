import React from 'react';
import { PALETTE } from './constants';

interface PeriodStat {
  id: string;
  label: string;
  range: string;
  color: string;
  count: number;
}

interface DiagramSidebarProps {
  trenes: string[];
  selectedTrains: Set<string> | null;
  onToggleTrain: (t: string) => void;
  periodStats: PeriodStat[];
}

export const DiagramSidebar: React.FC<DiagramSidebarProps> = ({
  trenes, selectedTrains, onToggleTrain, periodStats,
}) => (
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
          <svg width="12" height="12">
            <line x1="2" y1="2" x2="10" y2="10" stroke="#94a3b8" strokeWidth="2" />
            <line x1="10" y1="2" x2="2" y2="10" stroke="#94a3b8" strokeWidth="2" />
          </svg>
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
          <div key={tren}
            className={`train-legend-item ${selectedTrains && !selectedTrains.has(tren) ? 'train-hidden' : ''}`}
            onClick={() => onToggleTrain(tren)}
            style={{ cursor: 'pointer' }}>
            <span className="train-color-swatch" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
            <span className="train-legend-name">{tren}</span>
          </div>
        ))}
      </div>
    </div>
  </aside>
);
