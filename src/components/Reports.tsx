import React, { useMemo } from 'react';
import type { ExcelUploadData } from '../types';
import { useAnalytics } from '../hooks/useAnalytics';
import { GroupedBoxplot } from './Boxplot';
import { SEGMENTS, DIST_PAN_OBS } from '../data/stationPK';
import './Reports.css';



interface ReportsProps {
    data: ExcelUploadData;
    selectedDay: string;
    onBack: () => void;
}

export const Reports: React.FC<ReportsProps> = ({ data, selectedDay }) => {
    const eventos = useMemo(() => data.eventos_por_dia[selectedDay] || [], [data, selectedDay]);
    const analytics = useAnalytics(eventos, selectedDay);

    const formattedDay = useMemo(() => {
        const d = new Date(selectedDay + 'T12:00:00');
        return d.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }, [selectedDay]);

    // Check which vias have data
    const dwellVias = useMemo(() =>
        ['1', '2'].filter(v => analytics.dwell[v] && Object.values(analytics.dwell[v]).some(st => Object.keys(st).length > 0)),
        [analytics]);

    const headwayVias = useMemo(() =>
        ['1', '2'].filter(v => analytics.headway[v] && Object.values(analytics.headway[v]).some(st => Object.keys(st).length > 0)),
        [analytics]);

    const segSpeedVias = useMemo(() =>
        ['1', '2'].filter(v => analytics.segmentSpeed[v] && Object.values(analytics.segmentSpeed[v]).some(st => Object.keys(st).length > 0)),
        [analytics]);

    // Ordered segment labels for the boxplot X axis
    const segmentLabels = useMemo(() => SEGMENTS.map(s => s.label), []);

    // Check if commercial speed has data
    const hasComercial = useMemo(() =>
        Object.values(analytics.comercialSpeed).some(st => Object.values(st).some(arr => arr.length > 0)),
        [analytics]);

    // Distance maps for tooltips
    const comercialDistances = useMemo(() => ({
        'PAN→OBS': DIST_PAN_OBS,
        'OBS→PAN': DIST_PAN_OBS,
    }), []);

    const segmentDistances = useMemo(() => {
        const map: Record<string, number> = {};
        SEGMENTS.forEach(s => { map[s.label] = s.distanceM; });
        return map;
    }, []);

    return (
        <div className="reports-page">
            <div className="reports-title-bar">
                <h2>Reportes — {formattedDay}</h2>
            </div>

            <div className="reports-content">
                {/* 1. Tiempos de Vuelta */}
                <section className="reports-section">
                    <h2>1. Tiempos de Vuelta</h2>
                    <p className="reports-desc">
                        PAN→OBS: PARTIO PAN → ARRIBO OBS. OBS→PAN: PARTIO OBS Vía 2 → ARRIBO PAN.
                    </p>
                    <GroupedBoxplot title="Tiempos de Vuelta" data={analytics.vuelta} periods={analytics.periods} height={280}
                        customStations={['PAN→OBS', 'OBS→PAN']}
                        targetValues={{ 'PAN→OBS': (29 * 60 + 26) * 1000, 'OBS→PAN': (28 * 60 + 38) * 1000 }}
                        targetLabel="Obj. Contractual" />
                </section>

                {/* 2. Velocidad Comercial */}
                <section className="reports-section">
                    <h2>2. Velocidad Comercial (km/h)</h2>
                    <p className="reports-desc">
                        Velocidad = Distancia PAN↔OBS (16.884 km) / Tiempo de vuelta. Unidad: km/h.
                    </p>
                    {hasComercial ? (
                        <GroupedBoxplot title="Velocidad Comercial" data={analytics.comercialSpeed} periods={analytics.periods} height={280}
                            customStations={['PAN→OBS', 'OBS→PAN']} unit="km/h" invertHeatmap stationDistances={comercialDistances}
                            targetValue={36} targetLabel="Obj: 36 km/h" />
                    ) : <p className="no-data">Sin datos de velocidad comercial</p>}
                </section>

                {/* 3. Headway */}
                <section className="reports-section">
                    <h2>3. Headway</h2>
                    <p className="reports-desc">PARTIO tren A → PARTIO tren B siguiente, misma estación y vía (excl. Vía C).</p>
                    {headwayVias.length === 0 ? <p className="no-data">Sin datos</p> : (
                        headwayVias.map(v => (
                            <GroupedBoxplot key={`hw-${v}`} title={`Headway — Vía ${v}`}
                                data={analytics.headway[v]} periods={analytics.periods} height={320}
                                targetValue={90000} targetLabel="Obj: 90s" />
                        ))
                    )}
                </section>

                {/* 4. Estacionamiento */}
                <section className="reports-section">
                    <h2>4. Tiempos de Estacionamiento</h2>
                    <p className="reports-desc">ARRIBO → PARTIO del mismo tren en cada estación (excl. Vía C).</p>
                    {dwellVias.length === 0 ? <p className="no-data">Sin datos</p> : (
                        dwellVias.map(v => (
                            <GroupedBoxplot key={`dwell-${v}`} title={`Estacionamiento — Vía ${v}`}
                                data={analytics.dwell[v]} periods={analytics.periods} height={320}
                                targetValue={20000} targetLabel="Obj: 20s" />
                        ))
                    )}
                </section>

                {/* 5. Velocidad por Tramo */}
                <section className="reports-section">
                    <h2>5. Velocidad por Tramo (km/h)</h2>
                    <p className="reports-desc">
                        Velocidad entre estaciones consecutivas: PARTIO est. A → ARRIBO est. B (excl. Vía C y VIAC).
                    </p>
                    {segSpeedVias.length === 0 ? <p className="no-data">Sin datos</p> : (
                        segSpeedVias.map(v => (
                            <GroupedBoxplot key={`seg-${v}`} title={`Velocidad por Tramo — Vía ${v}`}
                                data={analytics.segmentSpeed[v]} periods={analytics.periods} height={380}
                                customStations={segmentLabels} unit="km/h" invertHeatmap stationDistances={segmentDistances} />
                        ))
                    )}
                </section>
            </div>
        </div>
    );
};
