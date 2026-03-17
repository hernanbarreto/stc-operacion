import React from 'react';
import type { ManeuversAnalysisData, TerminalManeuverData } from '../hooks/useManeuversAnalysis';
import { GroupedBoxplot } from './Boxplot';
import './ManeuversPanel.css';

// ─── Terminal frequency table ──────────────────────────────────────────────

interface TerminalTableProps {
    data: TerminalManeuverData;
}

const TerminalTable: React.FC<TerminalTableProps> = ({ data }) => {
    const { terminal, patterns, statsByPeriod, periods, instances } = data;
    const totalInstances = instances.length;

    if (totalInstances === 0) {
        return (
            <div className="maniobra-terminal">
                <h3 className="maniobra-terminal-title">
                    <span className={`maniobra-dot maniobra-dot-${terminal.toLowerCase()}`} />
                    {terminal === 'PAN' ? 'Pantitlán' : 'Observatorio'}
                </h3>
                <p className="maniobra-no-data">Sin maniobras detectadas en los datos del día.</p>
            </div>
        );
    }

    return (
        <div className="maniobra-terminal">
            <h3 className="maniobra-terminal-title">
                <span className={`maniobra-dot maniobra-dot-${terminal.toLowerCase()}`} />
                {terminal === 'PAN' ? 'Pantitlán' : 'Observatorio'}
                <span className="maniobra-total-badge">{totalInstances} maniobras</span>
            </h3>

            <div className="maniobra-table-wrap">
                <table className="maniobra-table">
                    <thead>
                        <tr>
                            <th>Franja</th>
                            {patterns.map(p => (
                                <th key={p.id} title={p.label}>{p.id}</th>
                            ))}
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {periods.map(p => {
                            const rowStats = statsByPeriod[p.id] || [];
                            const total = rowStats.reduce((s, r) => s + r.count, 0);
                            return (
                                <tr key={p.id}>
                                    <td className="maniobra-td-period">{p.label}</td>
                                    {patterns.map(pat => {
                                        const st = rowStats.find(r => r.tipo === pat.id);
                                        const n = st?.count ?? 0;
                                        return (
                                            <td key={pat.id} className={n > 0 ? 'maniobra-td-count' : 'maniobra-td-zero'}>
                                                {n > 0 ? n : '—'}
                                            </td>
                                        );
                                    })}
                                    <td className="maniobra-td-total">{total > 0 ? total : '—'}</td>
                                </tr>
                            );
                        })}
                        <tr className="maniobra-totals-row">
                            <td>Total</td>
                            {patterns.map(pat => {
                                const total = instances.filter(i => i.tipo === pat.id).length;
                                return <td key={pat.id}>{total > 0 ? total : '—'}</td>;
                            })}
                            <td>{totalInstances}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* Measurement legend */}
            <div className="maniobra-legend">
                {patterns.map(p => (
                    <div key={p.id} className="maniobra-legend-item">
                        <strong>{p.id}</strong>: {p.label} — <em>{p.medicion}</em>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ─── Main Panel ───────────────────────────────────────────────────────────────

interface ManeuversPanelProps {
    data: ManeuversAnalysisData;
}

export const ManeuversPanel: React.FC<ManeuversPanelProps> = ({ data }) => {
    const totalPan = data.pan.instances.length;
    const totalObs = data.obs.instances.length;

    if (totalPan === 0 && totalObs === 0) return null;

    return (
        <div className="maniobras-section">
            <h2 className="maniobras-title">Maniobras en Cabeceras</h2>
            <p className="maniobras-subtitle">
                Clasificación automática de maniobras de inversión detectadas en el ATS
                por franja horaria.
            </p>

            {/* Frequency tables side by side */}
            <div className="maniobras-tables">
                <TerminalTable data={data.pan} />
                <TerminalTable data={data.obs} />
            </div>

            {/* Boxplots — identical style to other sections, one per terminal */}
            {totalPan > 0 && Object.keys(data.pan.boxplotData).length > 0 && (
                <div className="grouped-canvas-stack">
                    <GroupedBoxplot
                        title="Pantitlán — Duración de maniobras"
                        data={data.pan.boxplotData}
                        periods={data.pan.periods}
                        customStations={data.pan.patternIds}
                        height={300}
                    />
                </div>
            )}

            {totalObs > 0 && Object.keys(data.obs.boxplotData).length > 0 && (
                <div className="grouped-canvas-stack">
                    <GroupedBoxplot
                        title="Observatorio — Duración de maniobras"
                        data={data.obs.boxplotData}
                        periods={data.obs.periods}
                        customStations={data.obs.patternIds}
                        height={300}
                    />
                </div>
            )}
        </div>
    );
};
