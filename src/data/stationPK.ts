// Puntos Kilométricos por estación (en metros)
// Valores proporcionados por el cliente — mismo PK para ambas vías
export const STATION_PK: Record<string, number> = {
    AVC16PAN: 96.620,
    AVC26PAN: 96.850,
    AVC46PAN: 97.010,
    AVC64PAN: 370,
    AVC14PAN: 338,
    AVC24PAN: 350,
    AVC44PAN: 370,
    PAN: 650,
    AVC62PAN: 416.220,
    AVC24ZAR: 1614.461,
    AVC14ZAR: 1671.050,
    ZAR: 2117.798,
    GOM: 3029.863,
    BOU: 3790.228,
    AVC14BAL: 4296.874,
    BAL: 4535.736,
    MOC: 5389.045,
    SLA: 6015.849,
    CAN: 7036.776,
    MER: 7881.872,
    PIN: 8776.772,
    AVC20PIN: 9021.290,
    ISA: 9309.249,
    SAL: 9902.240,
    AVCZSAL: 10170,
    BAD: 10512.010,
    AVC20ABAD: 10763.320,
    CUA: 11070.800,
    INS: 12013.590,
    SEV: 12808.040,
    CHP: 13458.740,
    AVC20CHP: 13706.970,
    JNA: 14583.120,
    TCY: 15890.670,
    OBS: 17300.600,
    VIAC: 17585.580,
    AVC54OBS: 17600,
    AVC34OBS: 17600,
    AVC14OBS: 17600,
    AVC24OBS: 17600,
    AVC44OBS: 17600,
    AVC64OBS: 17600,
    AVC84OBS: 17600,
    AVC104OBS: 17600,
};

// Distancia PAN → OBS en metros
export const DIST_PAN_OBS = STATION_PK['OBS'] - STATION_PK['PAN']; // 16650.6m

// Todas las estaciones incluyendo maniobra (para el diagrama/eje Y)
export const SEGMENT_STATIONS = [
    'AVC16PAN', 'AVC26PAN', 'AVC46PAN', 'AVC64PAN', 'AVC14PAN', 'AVC24PAN', 'AVC44PAN',
    'PAN', 'AVC62PAN', 'AVC24ZAR', 'AVC14ZAR', 'ZAR', 'GOM', 'BOU', 'AVC14BAL', 'BAL',
    'MOC', 'SLA', 'CAN', 'MER', 'PIN', 'AVC20PIN', 'ISA', 'SAL', 'AVCZSAL', 'BAD',
    'AVC20ABAD', 'CUA', 'INS', 'SEV', 'CHP', 'AVC20CHP', 'JNA', 'TCY', 'OBS',
    'AVC54OBS', 'AVC34OBS', 'AVC14OBS', 'AVC24OBS', 'AVC44OBS', 'AVC64OBS', 'AVC84OBS', 'AVC104OBS'
];

// Estaciones de servicio (PAN→OBS, sin maniobra) — para reportes y marcha tipo
export const SERVICE_STATIONS = [
    'PAN', 'ZAR', 'GOM', 'BOU', 'BAL', 'MOC', 'SLA', 'CAN',
    'MER', 'PIN', 'ISA', 'SAL', 'BAD', 'CUA', 'INS', 'SEV',
    'CHP', 'JNA', 'TCY', 'OBS',
];

// Tramos consecutivos de SERVICIO con distancia en metros (para reportes)
export const SEGMENTS = SERVICE_STATIONS.slice(0, -1).map((st, i) => {
    const next = SERVICE_STATIONS[i + 1];
    return {
        from: st,
        to: next,
        label: `${st}→${next}`,
        distanceM: STATION_PK[next] - STATION_PK[st],
    };
});

/**
 * Convierte tiempo (ms) y distancia (metros) a velocidad en km/h
 */
export function speedKmh(distanceM: number, timeMs: number): number {
    if (timeMs <= 0) return 0;
    return (distanceM / 1000) / (timeMs / 3600000);
}
