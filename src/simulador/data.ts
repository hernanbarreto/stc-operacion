/**
 * Datos físicos del simulador de RTV — Línea 1 Metro CDMX
 * Fuente: PDF Simulación de Headway (CRRC, 2022-MRRC-CB.ATC-L1MO-000-III-00702096-I rev D)
 *         + Anexo 1 (workshop 24/nov/22)
 *         + Planos de señalización (gradientes)
 */

export interface PolygonSegment {
  pk_ini_km: number;
  pk_fin_km: number;
  v_kmh: number;
}

export interface AccelPoint {
  v_kmh: number;
  a_cm_s2: number;
}

export interface TrenParams {
  id: 'NM16' | 'NM22';
  accel: AccelPoint[];
  decel_serv: number;       // m/s²
  jerk_traccion: number;    // m/s³
  jerk_frenado: number;     // m/s³
  t_ac_delay: number;       // s
  t_eb_delay: number;       // s
  t_EB: number;             // s
  masa_kg: number;
  davis_A: number;
  davis_B: number;
  davis_C: number;
}

export const LONGITUD_TREN_M = 151.33;
export const G = 9.81;

export const ESTACIONES_PK_M: Record<string, number> = {
  PAN: 651, ZAR: 2121, GOM: 3033, BPA: 3793, BAL: 4538, MOC: 5392,
  SLA: 6019, CAN: 7037, MER: 7884, PIN: 8779, ISA: 9311, SAL: 9905,
  BAD: 10512, CUA: 11071, INS: 12014, SEV: 12809, CHP: 13448,
  JNA: 14582, TCY: 15890, OBS: 17300,
};

export const TREN_NM16: TrenParams = {
  id: 'NM16',
  accel: [
    { v_kmh: 0, a_cm_s2: 143 }, { v_kmh: 5, a_cm_s2: 143 },
    { v_kmh: 10, a_cm_s2: 143 }, { v_kmh: 15, a_cm_s2: 144 },
    { v_kmh: 20, a_cm_s2: 144 }, { v_kmh: 25, a_cm_s2: 144 },
    { v_kmh: 30, a_cm_s2: 139 }, { v_kmh: 35, a_cm_s2: 118 },
    { v_kmh: 40, a_cm_s2: 103 }, { v_kmh: 45, a_cm_s2: 91 },
    { v_kmh: 50, a_cm_s2: 82 },  { v_kmh: 55, a_cm_s2: 67 },
    { v_kmh: 60, a_cm_s2: 55 },  { v_kmh: 65, a_cm_s2: 46 },
    { v_kmh: 70, a_cm_s2: 39 },  { v_kmh: 75, a_cm_s2: 33 },
    { v_kmh: 80, a_cm_s2: 28 },
  ],
  decel_serv: 1.4, jerk_traccion: 0.5, jerk_frenado: 1.0,
  t_ac_delay: 1.001, t_eb_delay: 0.71, t_EB: 1.32,
  masa_kg: 395023, davis_A: 3950.23, davis_B: 0.018, davis_C: 9.1368,
};

export const TREN_NM22: TrenParams = {
  id: 'NM22',
  accel: [
    { v_kmh: 0, a_cm_s2: 121 }, { v_kmh: 5, a_cm_s2: 121 },
    { v_kmh: 10, a_cm_s2: 121 }, { v_kmh: 15, a_cm_s2: 121 },
    { v_kmh: 20, a_cm_s2: 121 }, { v_kmh: 25, a_cm_s2: 121 },
    { v_kmh: 30, a_cm_s2: 101 }, { v_kmh: 35, a_cm_s2: 86 },
    { v_kmh: 40, a_cm_s2: 75 },  { v_kmh: 45, a_cm_s2: 66 },
    { v_kmh: 50, a_cm_s2: 59 },  { v_kmh: 55, a_cm_s2: 48 },
    { v_kmh: 60, a_cm_s2: 40 },  { v_kmh: 65, a_cm_s2: 33 },
    { v_kmh: 70, a_cm_s2: 28 },  { v_kmh: 75, a_cm_s2: 24 },
    { v_kmh: 80, a_cm_s2: 20 },
  ],
  decel_serv: 1.4, jerk_traccion: 1.0, jerk_frenado: 1.0,
  t_ac_delay: 1.256, t_eb_delay: 0.75, t_EB: 2.0,
  masa_kg: 390514, davis_A: 7429.69, davis_B: 257.49, davis_C: 12.45,
};

export const POLIGONO_V1: PolygonSegment[] = [
  { pk_ini_km: 0.000, pk_fin_km: 0.403, v_kmh: 74 }, { pk_ini_km: 0.403, pk_fin_km: 0.536, v_kmh: 73 },
  { pk_ini_km: 0.536, pk_fin_km: 0.577, v_kmh: 74 }, { pk_ini_km: 0.577, pk_fin_km: 0.729, v_kmh: 60 },
  { pk_ini_km: 0.729, pk_fin_km: 1.311, v_kmh: 74 }, { pk_ini_km: 1.311, pk_fin_km: 1.649, v_kmh: 59 },
  { pk_ini_km: 1.649, pk_fin_km: 2.044, v_kmh: 74 }, { pk_ini_km: 2.044, pk_fin_km: 2.198, v_kmh: 60 },
  { pk_ini_km: 2.198, pk_fin_km: 2.957, v_kmh: 74 }, { pk_ini_km: 2.957, pk_fin_km: 3.109, v_kmh: 60 },
  { pk_ini_km: 3.109, pk_fin_km: 3.717, v_kmh: 74 }, { pk_ini_km: 3.717, pk_fin_km: 3.869, v_kmh: 60 },
  { pk_ini_km: 3.869, pk_fin_km: 4.462, v_kmh: 74 }, { pk_ini_km: 4.462, pk_fin_km: 4.615, v_kmh: 60 },
  { pk_ini_km: 4.615, pk_fin_km: 5.315, v_kmh: 74 }, { pk_ini_km: 5.315, pk_fin_km: 5.469, v_kmh: 60 },
  { pk_ini_km: 5.469, pk_fin_km: 5.761, v_kmh: 74 }, { pk_ini_km: 5.761, pk_fin_km: 5.941, v_kmh: 57 },
  { pk_ini_km: 5.941, pk_fin_km: 5.943, v_kmh: 74 }, { pk_ini_km: 5.943, pk_fin_km: 6.096, v_kmh: 60 },
  { pk_ini_km: 6.096, pk_fin_km: 6.325, v_kmh: 58 }, { pk_ini_km: 6.325, pk_fin_km: 6.591, v_kmh: 73 },
  { pk_ini_km: 6.591, pk_fin_km: 6.634, v_kmh: 74 }, { pk_ini_km: 6.634, pk_fin_km: 6.673, v_kmh: 54.5 },
  { pk_ini_km: 6.673, pk_fin_km: 6.929, v_kmh: 55 }, { pk_ini_km: 6.929, pk_fin_km: 6.961, v_kmh: 74 },
  { pk_ini_km: 6.961, pk_fin_km: 7.113, v_kmh: 60 }, { pk_ini_km: 7.113, pk_fin_km: 7.382, v_kmh: 74 },
  { pk_ini_km: 7.382, pk_fin_km: 7.687, v_kmh: 56 }, { pk_ini_km: 7.687, pk_fin_km: 7.808, v_kmh: 74 },
  { pk_ini_km: 7.808, pk_fin_km: 7.960, v_kmh: 60 }, { pk_ini_km: 7.960, pk_fin_km: 8.405, v_kmh: 74 },
  { pk_ini_km: 8.405, pk_fin_km: 8.510, v_kmh: 43.5 }, { pk_ini_km: 8.510, pk_fin_km: 8.531, v_kmh: 74 },
  { pk_ini_km: 8.531, pk_fin_km: 8.622, v_kmh: 42 }, { pk_ini_km: 8.622, pk_fin_km: 8.703, v_kmh: 74 },
  { pk_ini_km: 8.703, pk_fin_km: 8.855, v_kmh: 60 }, { pk_ini_km: 8.855, pk_fin_km: 9.234, v_kmh: 74 },
  { pk_ini_km: 9.234, pk_fin_km: 9.388, v_kmh: 60 }, { pk_ini_km: 9.388, pk_fin_km: 9.596, v_kmh: 74 },
  { pk_ini_km: 9.596, pk_fin_km: 9.655, v_kmh: 54 }, { pk_ini_km: 9.655, pk_fin_km: 9.677, v_kmh: 74 },
  { pk_ini_km: 9.677, pk_fin_km: 9.745, v_kmh: 51.5 }, { pk_ini_km: 9.745, pk_fin_km: 9.769, v_kmh: 74 },
  { pk_ini_km: 9.769, pk_fin_km: 9.826, v_kmh: 70 }, { pk_ini_km: 9.826, pk_fin_km: 9.829, v_kmh: 74 },
  { pk_ini_km: 9.829, pk_fin_km: 9.981, v_kmh: 60 }, { pk_ini_km: 9.981, pk_fin_km: 10.326, v_kmh: 74 },
  { pk_ini_km: 10.326, pk_fin_km: 10.421, v_kmh: 58 }, { pk_ini_km: 10.421, pk_fin_km: 10.436, v_kmh: 74 },
  { pk_ini_km: 10.436, pk_fin_km: 10.589, v_kmh: 60 }, { pk_ini_km: 10.589, pk_fin_km: 10.995, v_kmh: 74 },
  { pk_ini_km: 10.995, pk_fin_km: 11.147, v_kmh: 60 }, { pk_ini_km: 11.147, pk_fin_km: 11.938, v_kmh: 74 },
  { pk_ini_km: 11.938, pk_fin_km: 12.090, v_kmh: 60 }, { pk_ini_km: 12.090, pk_fin_km: 12.733, v_kmh: 74 },
  { pk_ini_km: 12.733, pk_fin_km: 12.885, v_kmh: 60 }, { pk_ini_km: 12.885, pk_fin_km: 13.383, v_kmh: 74 },
  { pk_ini_km: 13.383, pk_fin_km: 13.535, v_kmh: 60 }, { pk_ini_km: 13.535, pk_fin_km: 13.604, v_kmh: 74 },
  { pk_ini_km: 13.604, pk_fin_km: 13.778, v_kmh: 56 }, { pk_ini_km: 13.778, pk_fin_km: 13.803, v_kmh: 54.5 },
  { pk_ini_km: 13.803, pk_fin_km: 13.864, v_kmh: 72.5 }, { pk_ini_km: 13.864, pk_fin_km: 14.506, v_kmh: 74 },
  { pk_ini_km: 14.506, pk_fin_km: 14.658, v_kmh: 60 }, { pk_ini_km: 14.658, pk_fin_km: 14.862, v_kmh: 74 },
  { pk_ini_km: 14.862, pk_fin_km: 14.988, v_kmh: 73 }, { pk_ini_km: 14.988, pk_fin_km: 15.655, v_kmh: 74 },
  { pk_ini_km: 15.655, pk_fin_km: 15.777, v_kmh: 70.5 }, { pk_ini_km: 15.777, pk_fin_km: 15.814, v_kmh: 74 },
  { pk_ini_km: 15.814, pk_fin_km: 15.966, v_kmh: 60 }, { pk_ini_km: 15.966, pk_fin_km: 15.968, v_kmh: 74 },
  { pk_ini_km: 15.968, pk_fin_km: 16.141, v_kmh: 64.9 }, { pk_ini_km: 16.141, pk_fin_km: 16.397, v_kmh: 74 },
  { pk_ini_km: 16.397, pk_fin_km: 16.698, v_kmh: 71 }, { pk_ini_km: 16.698, pk_fin_km: 16.863, v_kmh: 70.5 },
  { pk_ini_km: 16.863, pk_fin_km: 16.966, v_kmh: 67.5 }, { pk_ini_km: 16.966, pk_fin_km: 17.133, v_kmh: 70.5 },
  { pk_ini_km: 17.133, pk_fin_km: 17.224, v_kmh: 74 }, { pk_ini_km: 17.224, pk_fin_km: 17.371, v_kmh: 60 },
  { pk_ini_km: 17.371, pk_fin_km: 17.382, v_kmh: 30 }, { pk_ini_km: 17.382, pk_fin_km: 17.388, v_kmh: 80 },
  { pk_ini_km: 17.388, pk_fin_km: 17.512, v_kmh: 74 }, { pk_ini_km: 17.512, pk_fin_km: 17.666, v_kmh: 27 },
];

export const POLIGONO_V2: PolygonSegment[] = [
  { pk_ini_km: 0.510, pk_fin_km: 0.544, v_kmh: 74 }, { pk_ini_km: 0.544, pk_fin_km: 0.564, v_kmh: 25 },
  { pk_ini_km: 0.564, pk_fin_km: 0.576, v_kmh: 74 }, { pk_ini_km: 0.576, pk_fin_km: 0.726, v_kmh: 60 },
  { pk_ini_km: 0.726, pk_fin_km: 0.762, v_kmh: 74 }, { pk_ini_km: 0.762, pk_fin_km: 0.793, v_kmh: 30 },
  { pk_ini_km: 0.793, pk_fin_km: 0.810, v_kmh: 74 }, { pk_ini_km: 0.810, pk_fin_km: 0.850, v_kmh: 20 },
  { pk_ini_km: 0.850, pk_fin_km: 1.315, v_kmh: 74 }, { pk_ini_km: 1.315, pk_fin_km: 1.653, v_kmh: 62 },
  { pk_ini_km: 1.653, pk_fin_km: 2.044, v_kmh: 74 }, { pk_ini_km: 2.044, pk_fin_km: 2.198, v_kmh: 60 },
  { pk_ini_km: 2.198, pk_fin_km: 2.957, v_kmh: 74 }, { pk_ini_km: 2.957, pk_fin_km: 3.109, v_kmh: 60 },
  { pk_ini_km: 3.109, pk_fin_km: 3.717, v_kmh: 74 }, { pk_ini_km: 3.717, pk_fin_km: 3.869, v_kmh: 60 },
  { pk_ini_km: 3.869, pk_fin_km: 4.462, v_kmh: 74 }, { pk_ini_km: 4.462, pk_fin_km: 4.615, v_kmh: 60 },
  { pk_ini_km: 4.615, pk_fin_km: 5.315, v_kmh: 74 }, { pk_ini_km: 5.315, pk_fin_km: 5.469, v_kmh: 60 },
  { pk_ini_km: 5.469, pk_fin_km: 5.770, v_kmh: 74 }, { pk_ini_km: 5.770, pk_fin_km: 5.947, v_kmh: 58.4 },
  { pk_ini_km: 5.947, pk_fin_km: 6.096, v_kmh: 60 }, { pk_ini_km: 6.096, pk_fin_km: 6.101, v_kmh: 74 },
  { pk_ini_km: 6.101, pk_fin_km: 6.333, v_kmh: 57.6 }, { pk_ini_km: 6.333, pk_fin_km: 6.591, v_kmh: 74 },
  { pk_ini_km: 6.591, pk_fin_km: 6.636, v_kmh: 73 }, { pk_ini_km: 6.636, pk_fin_km: 6.673, v_kmh: 54.7 },
  { pk_ini_km: 6.673, pk_fin_km: 6.933, v_kmh: 56.2 }, { pk_ini_km: 6.933, pk_fin_km: 6.961, v_kmh: 74 },
  { pk_ini_km: 6.961, pk_fin_km: 7.113, v_kmh: 60 }, { pk_ini_km: 7.113, pk_fin_km: 7.385, v_kmh: 74 },
  { pk_ini_km: 7.385, pk_fin_km: 7.690, v_kmh: 56.7 }, { pk_ini_km: 7.690, pk_fin_km: 7.808, v_kmh: 74 },
  { pk_ini_km: 7.808, pk_fin_km: 7.960, v_kmh: 60 }, { pk_ini_km: 7.960, pk_fin_km: 8.406, v_kmh: 74 },
  { pk_ini_km: 8.406, pk_fin_km: 8.514, v_kmh: 42.7 }, { pk_ini_km: 8.514, pk_fin_km: 8.535, v_kmh: 74 },
  { pk_ini_km: 8.535, pk_fin_km: 8.636, v_kmh: 42.6 }, { pk_ini_km: 8.636, pk_fin_km: 8.703, v_kmh: 74 },
  { pk_ini_km: 8.703, pk_fin_km: 8.855, v_kmh: 60 }, { pk_ini_km: 8.855, pk_fin_km: 9.234, v_kmh: 74 },
  { pk_ini_km: 9.234, pk_fin_km: 9.388, v_kmh: 60 }, { pk_ini_km: 9.388, pk_fin_km: 9.603, v_kmh: 74 },
  { pk_ini_km: 9.603, pk_fin_km: 9.655, v_kmh: 51.3 }, { pk_ini_km: 9.655, pk_fin_km: 9.675, v_kmh: 74 },
  { pk_ini_km: 9.675, pk_fin_km: 9.749, v_kmh: 47 }, { pk_ini_km: 9.749, pk_fin_km: 9.777, v_kmh: 74 },
  { pk_ini_km: 9.777, pk_fin_km: 9.830, v_kmh: 47.3 }, { pk_ini_km: 9.830, pk_fin_km: 9.981, v_kmh: 60 },
  { pk_ini_km: 9.981, pk_fin_km: 10.345, v_kmh: 74 }, { pk_ini_km: 10.345, pk_fin_km: 10.432, v_kmh: 56 },
  { pk_ini_km: 10.432, pk_fin_km: 10.436, v_kmh: 74 }, { pk_ini_km: 10.436, pk_fin_km: 10.589, v_kmh: 60 },
  { pk_ini_km: 10.589, pk_fin_km: 10.995, v_kmh: 74 }, { pk_ini_km: 10.995, pk_fin_km: 11.147, v_kmh: 60 },
  { pk_ini_km: 11.147, pk_fin_km: 11.938, v_kmh: 74 }, { pk_ini_km: 11.938, pk_fin_km: 12.090, v_kmh: 60 },
  { pk_ini_km: 12.090, pk_fin_km: 12.733, v_kmh: 74 }, { pk_ini_km: 12.733, pk_fin_km: 12.885, v_kmh: 60 },
  { pk_ini_km: 12.885, pk_fin_km: 13.383, v_kmh: 74 }, { pk_ini_km: 13.383, pk_fin_km: 13.535, v_kmh: 60 },
  { pk_ini_km: 13.535, pk_fin_km: 13.606, v_kmh: 74 }, { pk_ini_km: 13.606, pk_fin_km: 13.778, v_kmh: 50.1 },
  { pk_ini_km: 13.778, pk_fin_km: 13.807, v_kmh: 48.6 }, { pk_ini_km: 13.807, pk_fin_km: 13.864, v_kmh: 73 },
  { pk_ini_km: 13.864, pk_fin_km: 14.506, v_kmh: 74 }, { pk_ini_km: 14.506, pk_fin_km: 14.658, v_kmh: 60 },
  { pk_ini_km: 14.658, pk_fin_km: 14.862, v_kmh: 74 }, { pk_ini_km: 14.862, pk_fin_km: 14.988, v_kmh: 73 },
  { pk_ini_km: 14.988, pk_fin_km: 15.655, v_kmh: 74 }, { pk_ini_km: 15.655, pk_fin_km: 15.777, v_kmh: 70.5 },
  { pk_ini_km: 15.777, pk_fin_km: 15.814, v_kmh: 74 }, { pk_ini_km: 15.814, pk_fin_km: 15.966, v_kmh: 60 },
  { pk_ini_km: 15.966, pk_fin_km: 15.972, v_kmh: 74 }, { pk_ini_km: 15.972, pk_fin_km: 16.147, v_kmh: 66 },
  { pk_ini_km: 16.147, pk_fin_km: 16.397, v_kmh: 74 }, { pk_ini_km: 16.397, pk_fin_km: 16.698, v_kmh: 73 },
  { pk_ini_km: 16.698, pk_fin_km: 16.867, v_kmh: 70.5 }, { pk_ini_km: 16.867, pk_fin_km: 16.970, v_kmh: 68.2 },
  { pk_ini_km: 16.970, pk_fin_km: 17.133, v_kmh: 70.5 }, { pk_ini_km: 17.133, pk_fin_km: 17.223, v_kmh: 74 },
  { pk_ini_km: 17.223, pk_fin_km: 17.376, v_kmh: 60 }, { pk_ini_km: 17.376, pk_fin_km: 17.381, v_kmh: 74 },
  { pk_ini_km: 17.381, pk_fin_km: 17.393, v_kmh: 33 }, { pk_ini_km: 17.393, pk_fin_km: 17.666, v_kmh: 27 },
];
