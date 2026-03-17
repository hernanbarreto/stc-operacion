import React, { useState, useMemo } from 'react';
import type { AlarmEvent } from '../types';
import './AlarmTable.css';

interface AlarmTableProps {
    alarmas: AlarmEvent[];
    fecha: string;
}

/**
 * Determine row background class based on description & estado.
 */
function getRowClass(alarm: AlarmEvent): string {
    const { descripcion, estado } = alarm;
    const desc = descripcion.toLowerCase();

    if (estado === 'Normalizada' || estado === 'Cerrada') return '';
    if (estado !== 'Abierta') return '';
    if (desc.includes('detenido') || desc.includes('degradado')) return '';

    if (
        desc.includes('aguja') ||
        desc.includes('perdio la conexi') ||
        desc.includes('perdió la conexi') ||
        desc.includes('se ha pasado del punto de parada')
    ) {
        return 'alarm-row-red';
    }

    if (
        desc.includes('arb') ||
        desc.includes('tren reportando ocupaci')
    ) {
        return 'alarm-row-pink';
    }

    return '';
}

export const AlarmTable: React.FC<AlarmTableProps> = ({ alarmas, fecha }) => {
    // Filter state
    const [filterEventType, setFilterEventType] = useState('');
    const [filterEstado, setFilterEstado] = useState('');
    const [filterDesc, setFilterDesc] = useState('');
    const [filterHoraStart, setFilterHoraStart] = useState('');
    const [filterHoraEnd, setFilterHoraEnd] = useState('');

    // Unique values for dropdowns
    const eventTypes = useMemo(() => [...new Set(alarmas.map(a => a.eventType))].sort(), [alarmas]);
    const estados = useMemo(() => [...new Set(alarmas.map(a => a.estado).filter(Boolean))].sort(), [alarmas]);

    // Filtered + sorted
    const filtered = useMemo(() => {
        let list = [...alarmas];

        if (filterEventType) list = list.filter(a => a.eventType === filterEventType);
        if (filterEstado) list = list.filter(a => a.estado === filterEstado);
        if (filterDesc) {
            const q = filterDesc.toLowerCase();
            list = list.filter(a => a.descripcion.toLowerCase().includes(q));
        }
        if (filterHoraStart) {
            const [h, m] = filterHoraStart.split(':').map(Number);
            const startMin = h * 60 + (m || 0);
            list = list.filter(a => {
                const aMin = a.datetime.getHours() * 60 + a.datetime.getMinutes();
                return aMin >= startMin;
            });
        }
        if (filterHoraEnd) {
            const [h, m] = filterHoraEnd.split(':').map(Number);
            const endMin = h * 60 + (m || 0);
            list = list.filter(a => {
                const aMin = a.datetime.getHours() * 60 + a.datetime.getMinutes();
                return aMin <= endMin;
            });
        }

        return list.sort((a, b) => a.datetime.getTime() - b.datetime.getTime());
    }, [alarmas, filterEventType, filterEstado, filterDesc, filterHoraStart, filterHoraEnd]);

    const hasFilters = filterEventType || filterEstado || filterDesc || filterHoraStart || filterHoraEnd;
    const clearFilters = () => {
        setFilterEventType(''); setFilterEstado(''); setFilterDesc('');
        setFilterHoraStart(''); setFilterHoraEnd('');
    };

    if (alarmas.length === 0) {
        return (
            <div className="alarm-section">
                <h3 className="alarm-title">Alarmas — {fecha}</h3>
                <p className="alarm-empty">Sin alarmas para este día.</p>
            </div>
        );
    }

    return (
        <div className="alarm-section">
            <h3 className="alarm-title">
                Alarmas — {fecha} <span className="alarm-count">({filtered.length}{hasFilters ? ` / ${alarmas.length}` : ''})</span>
                {hasFilters && <button className="alarm-clear-filters" onClick={clearFilters}>✕ Limpiar filtros</button>}
            </h3>

            {/* Filter bar */}
            <div className="alarm-filters">
                <div className="alarm-filter-item">
                    <label>Hora desde</label>
                    <input type="time" value={filterHoraStart} onChange={e => setFilterHoraStart(e.target.value)} className="alarm-filter-time" />
                </div>
                <div className="alarm-filter-item">
                    <label>Hora hasta</label>
                    <input type="time" value={filterHoraEnd} onChange={e => setFilterHoraEnd(e.target.value)} className="alarm-filter-time" />
                </div>
                <div className="alarm-filter-item">
                    <label>Event Type</label>
                    <select value={filterEventType} onChange={e => setFilterEventType(e.target.value)} className="alarm-filter-select">
                        <option value="">Todos</option>
                        {eventTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
                <div className="alarm-filter-item">
                    <label>Estado</label>
                    <select value={filterEstado} onChange={e => setFilterEstado(e.target.value)} className="alarm-filter-select">
                        <option value="">Todos</option>
                        {estados.map(e => <option key={e} value={e}>{e}</option>)}
                    </select>
                </div>
                <div className="alarm-filter-item alarm-filter-desc">
                    <label>Descripción</label>
                    <input type="text" value={filterDesc} placeholder="Buscar..." onChange={e => setFilterDesc(e.target.value)} className="alarm-filter-text" />
                </div>
            </div>

            <div className="alarm-table-wrapper">
                <table className="alarm-table">
                    <thead>
                        <tr>
                            <th>Hora</th>
                            <th>Event Type</th>
                            <th>Estado</th>
                            <th>Descripción</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((alarm, i) => (
                            <tr key={i} className={getRowClass(alarm)}>
                                <td className="alarm-hora">{alarm.datetime.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                                <td className="alarm-type">{alarm.eventType}</td>
                                <td className="alarm-estado">{alarm.estado || '—'}</td>
                                <td className="alarm-desc">{alarm.descripcion}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
