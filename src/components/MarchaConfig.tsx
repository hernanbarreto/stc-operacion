import React, { useState } from 'react';
import { SERVICE_STATIONS, STATION_PK } from '../data/stationPK';
import { IDEAL_SEGMENT_SPEED, IDEAL_DWELL_MS } from '../data/marchaTipo';
import './MarchaConfig.css';

interface MarchaConfigProps {
    open: boolean;
    onClose: () => void;
    speeds: Record<string, number>;
    dwells: Record<string, number>;
    onSave: (speeds: Record<string, number>, dwells: Record<string, number>) => void;
}

const SEGMENTS = SERVICE_STATIONS.slice(0, -1).map((st, i) => {
    const next = SERVICE_STATIONS[i + 1];
    const dist = Math.abs(STATION_PK[next] - STATION_PK[st]);
    return { from: st, to: next, label: `${st}→${next}`, distM: dist };
});

export const MarchaConfig: React.FC<MarchaConfigProps> = ({ open, onClose, speeds, dwells, onSave }) => {
    const [localSpeeds, setLocalSpeeds] = useState({ ...speeds });
    const [localDwells, setLocalDwells] = useState({ ...dwells });

    if (!open) return null;

    const handleSpeedChange = (label: string, val: number) => {
        setLocalSpeeds(prev => ({ ...prev, [label]: val }));
    };
    const handleDwellChange = (st: string, valSec: number) => {
        setLocalDwells(prev => ({ ...prev, [st]: valSec * 1000 }));
    };
    const handleSave = () => { onSave(localSpeeds, localDwells); onClose(); };
    const handleReset = () => {
        setLocalSpeeds({ ...IDEAL_SEGMENT_SPEED });
        setLocalDwells({ ...IDEAL_DWELL_MS });
    };

    // Calculate travel time for each segment
    const segTime = (label: string, dist: number) => {
        const spd = localSpeeds[label] || 50;
        return (dist / (spd * 1000 / 3600)); // seconds
    };

    // Total time
    const totalPO = SEGMENTS.reduce((acc, s) => {
        const travel = segTime(s.label, s.distM);
        const dwell = (localDwells[s.to] ?? 20_000) / 1000;
        return acc + travel + (s.to === 'OBS' ? 0 : dwell);
    }, 0);

    return (
        <div className="marcha-overlay" onClick={onClose}>
            <div className="marcha-modal" onClick={e => e.stopPropagation()}>
                <div className="marcha-header">
                    <h3>Configuración Marcha Tipo</h3>
                    <div className="marcha-header-actions">
                        <span className="marcha-total">Total PAN→OBS: <strong>{Math.floor(totalPO / 60)}m {Math.round(totalPO % 60)}s</strong></span>
                        <button onClick={handleReset} className="marcha-reset-btn">Reset</button>
                        <button onClick={handleSave} className="marcha-save-btn">Guardar</button>
                        <button onClick={onClose} className="marcha-close-btn">✕</button>
                    </div>
                </div>

                <div className="marcha-body">
                    {/* Speeds table */}
                    <div className="marcha-section">
                        <h4>Velocidades por tramo (km/h)</h4>
                        <table className="marcha-table">
                            <thead>
                                <tr>
                                    <th>Tramo</th>
                                    <th>Dist (m)</th>
                                    <th>Vel (km/h)</th>
                                    <th>Tiempo</th>
                                </tr>
                            </thead>
                            <tbody>
                                {SEGMENTS.map(s => {
                                    const t = segTime(s.label, s.distM);
                                    return (
                                        <tr key={s.label}>
                                            <td className="marcha-seg-label">{s.label}</td>
                                            <td className="marcha-seg-dist">{Math.round(s.distM)}</td>
                                            <td>
                                                <input type="number" min={10} max={120} step={1}
                                                    value={localSpeeds[s.label] || 50}
                                                    onChange={e => handleSpeedChange(s.label, +e.target.value)}
                                                    className="marcha-input" />
                                            </td>
                                            <td className="marcha-seg-time">{Math.round(t)}s</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Dwell table */}
                    <div className="marcha-section">
                        <h4>Tiempo de estacionamiento (s)</h4>
                        <div className="marcha-dwell-grid">
                            {SERVICE_STATIONS.filter(st => st !== 'PAN' && st !== 'OBS').map(st => (
                                <div key={st} className="marcha-dwell-item">
                                    <span className="marcha-dwell-label">{st}</span>
                                    <input type="number" min={5} max={120} step={1}
                                        value={Math.round((localDwells[st] ?? 20_000) / 1000)}
                                        onChange={e => handleDwellChange(st, +e.target.value)}
                                        className="marcha-input marcha-input-sm" />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
