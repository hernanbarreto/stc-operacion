import React from 'react';
import type { InsightsData } from '../hooks/useInsights';
import './Insights.css';

interface InsightsProps {
    data: InsightsData;
}

const SEV_LABEL: Record<string, string> = { ok: 'OK', warning: 'ALERTA', critical: 'CRIT.', info: 'INFO' };

export const Insights: React.FC<InsightsProps> = ({ data }) => {
    if (data.periodRows.length === 0) return null;

    return (
        <div className="insights-section">
            <h2>Análisis de Operación</h2>

            {/* KPI Summary badges */}
            <div className="insights-badges">
                <span className="ins-badge">{data.totalTrains} trenes</span>
                <span className="ins-badge ins-badge-dbo">{data.totalDBO} DBO</span>
                <span className="ins-badge ins-badge-alarm">{data.totalAlarms} alarmas</span>
            </div>

            {/* Executive table by period */}
            <div className="insights-table-wrap">
                <table className="insights-table">
                    <thead>
                        <tr>
                            <th>Franja</th>
                            <th>Trenes</th>
                            <th>Headway Med.</th>
                            <th>Dwell Med.</th>
                            <th>DBO</th>
                            <th>Alarmas</th>
                            <th>Estado</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.periodRows.map(row => (
                            <tr key={row.period} className={`row-${row.status}`}>
                                <td className="td-period">{row.period}</td>
                                <td>{row.trains}</td>
                                <td className={row.hwMedianMs > 90000 ? 'td-warn' : 'td-ok'}>{row.hwMedian}</td>
                                <td className={row.dwellMedianMs > 20000 ? 'td-warn' : 'td-ok'}>{row.dwellMedian}</td>
                                <td className={row.dboCount > 0 ? 'td-alert' : ''}>{row.dboCount}</td>
                                <td className={row.alarmsCount > 0 ? 'td-alert' : ''}>{row.alarmsCount}</td>
                                <td className={`td-sev td-sev-${row.status}`}>{SEV_LABEL[row.status] || '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Concise findings */}
            {data.findings.length > 0 && (
                <div className="insights-findings">
                    <h3>Hallazgos</h3>
                    <ul>
                        {data.findings.map((f, i) => (
                            <li key={i} className={`finding-${f.severity}`}>
                                <span className={`sev-dot sev-${f.severity}`} /> {f.text}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};
