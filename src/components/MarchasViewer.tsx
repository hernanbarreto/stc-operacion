import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { TIEMPOS_PARADA_V1, TIEMPOS_PARADA_V2, type Horario } from '../simulador/tiempos_parada';
import { exportRtvReport } from '../utils/rtvReport';
import './MarchasViewer.css';

type CurvePoint = { pk_km: number; v_kmh: number };
type CurveJson = {
  meta: { material: string; via: string; pk_min: number; pk_max: number; n_points: number };
  curve: CurvePoint[];
};

const HORARIOS: { key: Horario; label: string }[] = [
  { key: 'valle',       label: 'Valle' },
  { key: 'pico_manana', label: 'Pico Mañana' },
  { key: 'pico_tarde',  label: 'Pico Tarde' },
];

type CdvCatalog = {
  fisicos: CdvFisico[];
  virtuales: CdvVirtual[];
};
type CdvFisico = {
  id: string; station: string; via: string;
  pk_ini_m: number; pk_fin_m: number; longitud_m: number; n_virtuales: number;
};
type CdvVirtual = {
  id: string; padre: string; station: string; via: string;
  pk_ini_m: number; pk_fin_m: number; longitud_m: number;
};
// Un RTV agrupa 1 o varios CDVs bajo un mismo rango PK y velocidad.
type RtvApplied = {
  id: string | number;
  via: string;           // 'V1' | 'V2'
  pki_m: number;
  pkf_m: number;
  v_rtv_kmh: number;
  cdvs: string[];        // ids de los CDV afectados
};

type TrenSpec = {
  id: 'NM16' | 'NM22'; nombre: string; longitud_m: number;
  masa_kg: number; decel_servicio_ms2: number;
  jerk_traccion_ms3: number; jerk_frenado_ms3: number;
  t_ac_delay_s: number; t_eb_delay_s: number; t_eb_s: number;
  davis: { A: number; B: number; C: number; comentario?: string };
  accel_curve: { v_kmh: number; a_cm_s2: number }[];
};

// Tiempo de marcha (sin paradas). Integra dx/v.
// Usamos UMBRAL v<15 sólo para los puntos del baseline (artefactos cerca de estaciones).
// Para curva c/RTV, se usa el umbral original (0.5) y se le aplica el MISMO offset que
// se "le sacó" al baseline → así la diferencia Δt es física (positiva con RTV).
const V_MIN_BASELINE = 15;  // km/h - calibrado vs Siemens (artefactos)
const V_MIN_RAW      = 0.5; // km/h
function computeRunningTime(curve: CurvePoint[], vmin = V_MIN_BASELINE): number {
  let t = 0;
  for (let i = 1; i < curve.length; i++) {
    const dx = curve[i].pk_km - curve[i-1].pk_km;
    const vAvg = (curve[i].v_kmh + curve[i-1].v_kmh) / 2;
    if (vAvg < vmin || dx <= 0) continue;
    t += dx / vAvg * 3600;
  }
  return t;
}

// Aceleración en m/s² para una velocidad dada (km/h), interpolando la curva del tren.
function lookupAccel(curve: { v_kmh: number; a_cm_s2: number }[], v_kmh: number): number {
  if (!curve.length) return 0.5;
  if (v_kmh <= curve[0].v_kmh) return curve[0].a_cm_s2 / 100;
  if (v_kmh >= curve[curve.length-1].v_kmh) return curve[curve.length-1].a_cm_s2 / 100;
  for (let i = 1; i < curve.length; i++) {
    if (v_kmh < curve[i].v_kmh) {
      const t = (v_kmh - curve[i-1].v_kmh) / (curve[i].v_kmh - curve[i-1].v_kmh);
      return (curve[i-1].a_cm_s2 + t * (curve[i].a_cm_s2 - curve[i-1].a_cm_s2)) / 100;
    }
  }
  return curve[curve.length-1].a_cm_s2 / 100;
}

// Calcula la zona efectiva (PK rango) para una RTV dado el largo del tren y la via.
//  V1 (PK creciente): la cabeza entra en pki, la cola sale en pkf + L. -> zona [pki, pkf+L]
//  V2 (PK decreciente): la cabeza entra en pkf, la cola sale en pki - L. -> zona [pki-L, pkf]
function rtvEffectiveZone(rtv: RtvApplied, via: 'V1' | 'V2', longitud_tren_km: number) {
  const pki_km = rtv.pki_m / 1000;
  const pkf_km = rtv.pkf_m / 1000;
  if (via === 'V1') return { rtv_id: rtv.id, v_rtv: rtv.v_rtv_kmh, eff_lo: pki_km, eff_hi: pkf_km + longitud_tren_km, rtv_lo: pki_km, rtv_hi: pkf_km, despeje_lo: pkf_km, despeje_hi: pkf_km + longitud_tren_km };
  return { rtv_id: rtv.id, v_rtv: rtv.v_rtv_kmh, eff_lo: pki_km - longitud_tren_km, eff_hi: pkf_km, rtv_lo: pki_km, rtv_hi: pkf_km, despeje_lo: pki_km - longitud_tren_km, despeje_hi: pki_km };
}

// Aplica las RTVs sobre una curva: clip v_max en zonas efectivas + frenado SBI antes + aceleración después
function aplicarRtvCurva(baseline: CurvePoint[], rtvsVia: RtvApplied[], via: 'V1' | 'V2', tren: TrenSpec): CurvePoint[] {
  if (!rtvsVia.length || !tren) return baseline;
  const L_km = tren.longitud_m / 1000;
  const decel = tren.decel_servicio_ms2;
  const out = baseline.map(p => ({ pk_km: p.pk_km, v_kmh: p.v_kmh }));
  const zones = rtvsVia.map(r => ({ ...rtvEffectiveZone(r, via, L_km), v_rtv: r.v_rtv_kmh }));

  // 1) Clip estricto dentro de cada zona efectiva
  for (const z of zones) {
    for (let i = 0; i < out.length; i++) {
      if (out[i].pk_km >= z.eff_lo - 1e-6 && out[i].pk_km <= z.eff_hi + 1e-6) {
        out[i].v_kmh = Math.min(out[i].v_kmh, z.v_rtv);
      }
    }
  }

  // 2) Frenado y aceleración alrededor de cada zona
  for (const z of zones) {
    if (via === 'V1') {
      // Brake antes de eff_lo: walking backward
      const entry_idx = out.findIndex(p => p.pk_km >= z.eff_lo - 1e-6);
      if (entry_idx > 0) {
        for (let i = entry_idx - 1; i >= 0; i--) {
          const dx_m = (z.eff_lo - out[i].pk_km) * 1000;
          if (dx_m <= 0) continue;
          const v_req_ms = Math.sqrt(Math.pow(z.v_rtv/3.6, 2) + 2*decel*dx_m);
          const v_req_kmh = v_req_ms * 3.6;
          if (v_req_kmh >= out[i].v_kmh) break;
          out[i].v_kmh = v_req_kmh;
        }
      }
      // Accel despues de eff_hi: walking forward usando curva de accel del tren
      const exit_idx = out.findIndex(p => p.pk_km > z.eff_hi);
      if (exit_idx > 0) {
        let v_curr = z.v_rtv;
        for (let i = exit_idx; i < out.length; i++) {
          if (out[i].v_kmh <= v_curr + 0.1) break;
          const dx_m = (out[i].pk_km - out[i-1].pk_km) * 1000;
          const a = lookupAccel(tren.accel_curve, v_curr);
          const v_new_ms = Math.sqrt(Math.pow(v_curr/3.6, 2) + 2*a*dx_m);
          v_curr = Math.min(v_new_ms * 3.6, out[i].v_kmh);
          if (v_curr < out[i].v_kmh) out[i].v_kmh = v_curr;
        }
      }
    } else {
      // V2: brake al entrar desde alto PK (pasada por eff_hi caminando hacia mayor PK)
      const exit_high_idx = out.findIndex(p => p.pk_km > z.eff_hi);
      if (exit_high_idx > 0) {
        for (let i = exit_high_idx; i < out.length; i++) {
          const dx_m = (out[i].pk_km - z.eff_hi) * 1000;
          if (dx_m <= 0) continue;
          const v_req_ms = Math.sqrt(Math.pow(z.v_rtv/3.6, 2) + 2*decel*dx_m);
          const v_req_kmh = v_req_ms * 3.6;
          if (v_req_kmh >= out[i].v_kmh) break;
          out[i].v_kmh = v_req_kmh;
        }
      }
      // Accel despues de eff_lo: walking backward (PK decreciente = tiempo creciente para V2)
      let exit_low_idx = -1;
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].pk_km < z.eff_lo) { exit_low_idx = i; break; }
      }
      if (exit_low_idx >= 0 && exit_low_idx < out.length - 1) {
        let v_curr = z.v_rtv;
        for (let i = exit_low_idx; i >= 0; i--) {
          if (out[i].v_kmh <= v_curr + 0.1) break;
          const dx_m = (out[i+1].pk_km - out[i].pk_km) * 1000;
          if (dx_m <= 0) continue;
          const a = lookupAccel(tren.accel_curve, v_curr);
          const v_new_ms = Math.sqrt(Math.pow(v_curr/3.6, 2) + 2*a*dx_m);
          v_curr = Math.min(v_new_ms * 3.6, out[i].v_kmh);
          if (v_curr < out[i].v_kmh) out[i].v_kmh = v_curr;
        }
      }
    }
  }
  return out;
}

// Suma de tiempos de parada en estaciones intermedias (excluye terminales)
function computeDwellTime(via: 'V1' | 'V2', horario: Horario, includeTerminals = false): number {
  const tabla = via === 'V1' ? TIEMPOS_PARADA_V1 : TIEMPOS_PARADA_V2;
  let t = 0;
  const codes = Object.keys(tabla);
  for (let i = 0; i < codes.length; i++) {
    if (!includeTerminals && (i === 0 || i === codes.length - 1)) continue;
    t += tabla[codes[i]][horario] ?? 15;
  }
  return t;
}

// Tiempo en terminales (origen + destino) - dwell en PAN y OBS según horario
function computeTerminalDwell(via: 'V1' | 'V2', horario: Horario): number {
  const tabla = via === 'V1' ? TIEMPOS_PARADA_V1 : TIEMPOS_PARADA_V2;
  const codes = Object.keys(tabla);
  const t0 = tabla[codes[0]][horario] ?? 30;
  const tN = tabla[codes[codes.length - 1]][horario] ?? 30;
  return t0 + tN;
}

function fmtSeg(s: number): string {
  const m = Math.floor(s / 60); const sec = Math.round(s - m * 60);
  return `${m}m ${sec.toString().padStart(2,'0')}s`;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// PKs OFICIALES del plano de vía (mismo sistema que stationPK.ts del diagrama de hilo).
// Para consistencia entre diagrama de hilo, curvas de marcha, CDVs y RTVs.
const STATIONS: { code: string; name: string; pk: number }[] = [
  { code: 'PAN', name: 'Pantitlán',                pk:  0.650   },
  { code: 'ZAR', name: 'Zaragoza',                 pk:  2.117798 },
  { code: 'GOM', name: 'Gómez Farías',             pk:  3.029863 },
  { code: 'BPA', name: 'Boulevard Puerto Aéreo',   pk:  3.790228 },  // BOU en el diagrama
  { code: 'BAL', name: 'Balbuena',                 pk:  4.535736 },
  { code: 'MOC', name: 'Moctezuma',                pk:  5.389045 },
  { code: 'SLA', name: 'San Lázaro',               pk:  6.015849 },
  { code: 'CAN', name: 'Candelaria',               pk:  7.036776 },
  { code: 'MER', name: 'Merced',                   pk:  7.881872 },
  { code: 'PIN', name: 'Pino Suárez',              pk:  8.776772 },
  { code: 'ISA', name: 'Isabel la Católica',       pk:  9.309249 },
  { code: 'SAL', name: 'Salto del Agua',           pk:  9.902240 },
  { code: 'BAD', name: 'Balderas',                 pk: 10.512010 },
  { code: 'CUA', name: 'Cuauhtémoc',               pk: 11.070800 },
  { code: 'INS', name: 'Insurgentes',              pk: 12.013590 },
  { code: 'SEV', name: 'Sevilla',                  pk: 12.808040 },
  { code: 'CHP', name: 'Chapultepec',              pk: 13.458740 },
  { code: 'JNA', name: 'Juanacatlán',              pk: 14.583120 },
  { code: 'TCY', name: 'Tacubaya',                 pk: 15.890670 },
  { code: 'OBS', name: 'Observatorio',             pk: 17.300600 },
];

const SOURCES = [
  { key: 'NM16_V1', label: 'NM16 — Vía 1 (PAN → OBS)', file: '/marchas/NM16_V1_PAN-OBS_stitched.json', color: '#2563eb' },
  { key: 'NM16_V2', label: 'NM16 — Vía 2 (OBS → PAN)', file: '/marchas/NM16_V2_OBS-PAN_stitched.json', color: '#0891b2' },
  { key: 'NM22_V1', label: 'NM22 — Vía 1 (PAN → OBS)', file: '/marchas/NM22_V1_PAN-OBS_stitched.json', color: '#7c3aed' },
  { key: 'NM22_V2', label: 'NM22 — Vía 2 (OBS → PAN)', file: '/marchas/NM22_V2_OBS-PAN_stitched.json', color: '#db2777' },
];

const V_MAX = 80;
const STATION_AROUND_M = 1.2;  // ventana por defecto al saltar a una estación: ±0.6 km

// Detecta zonas donde la curva esta cerca de v=0 (estaciones).
// Devuelve los PKs MEDIOS de cada zona. Asume que el orden de zonas
// matchea las STATIONS (PAN, ZAR, GOM, ...).
function detectStationsPK(curve: CurvePoint[], threshold = 2.0): number[] {
  if (!curve.length) return [];
  const zones: number[] = [];
  let inZone = false;
  let zoneStart = 0;
  for (let i = 0; i < curve.length; i++) {
    const v = curve[i].v_kmh;
    if (v <= threshold) {
      if (!inZone) { inZone = true; zoneStart = i; }
    } else {
      if (inZone) {
        inZone = false;
        const zoneEnd = i - 1;
        const mid = (curve[zoneStart].pk_km + curve[zoneEnd].pk_km) / 2;
        zones.push(mid);
      }
    }
  }
  if (inZone) {
    const mid = (curve[zoneStart].pk_km + curve[curve.length-1].pk_km) / 2;
    zones.push(mid);
  }
  return zones;
}

export function MarchasViewer() {
  const [curves, setCurves] = useState<Record<string, CurveJson | null>>({});
  const [stationsByCurve, setStationsByCurve] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [horario, setHorario] = useState<Horario>('valle');
  const [showDwellModal, setShowDwellModal] = useState(false);
  const [showRtvModal, setShowRtvModal] = useState(false);
  const [rtvs, setRtvs] = useState<RtvApplied[]>([]);
  const [trenes, setTrenes] = useState<Record<string, TrenSpec>>({});
  const chartRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  // ventana visible PK [min, max]
  const [view, setView] = useState<{ min: number; max: number }>({
    min: STATIONS[0].pk - 0.1,
    max: STATIONS[2].pk + 0.1,   // arranca mostrando PAN-ZAR-GOM
  });
  const [hoverPk, setHoverPk] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    // cache-bust agresivo: timestamp + no-cache headers
    const bust = Date.now();
    Promise.all(SOURCES.map(s => fetch(`${s.file}?v=${bust}`, { cache: 'no-store' }).then(r => r.json() as Promise<CurveJson>)))
      .then(results => {
        if (cancelled) return;
        const m: Record<string, CurveJson | null> = {};
        const st: Record<string, number[]> = {};
        SOURCES.forEach((s, i) => { m[s.key] = results[i]; st[s.key] = detectStationsPK(results[i].curve); });
        setCurves(m);
        setStationsByCurve(st);
      })
      .catch(err => console.error('Error cargando marchas:', err))
      .finally(() => { if (!cancelled) setLoading(false); });
    // Cargar trenes (NM16, NM22) para el cálculo de RTV
    fetch(`/data/trenes.json?v=${bust}`, { cache: 'no-store' })
      .then(r => r.json())
      .then((d: { trenes: TrenSpec[] }) => {
        if (cancelled) return;
        const map: Record<string, TrenSpec> = {};
        for (const t of d.trenes) map[t.id] = t;
        setTrenes(map);
      })
      .catch(err => console.error('Error cargando trenes:', err));
    return () => { cancelled = true; };
  }, []);

  // PKs por estacion: promedio (mediana) de las posiciones detectadas en las 4 curvas.
  // Cada curva detecta 20 zonas v=0, mapeadas por indice a las 20 estaciones.
  const stationsAvg = useMemo(() => {
    const N = STATIONS.length;
    const out: { code: string; name: string; pk: number }[] = [];
    for (let i = 0; i < N; i++) {
      const obs: number[] = [];
      for (const s of SOURCES) {
        const list = stationsByCurve[s.key];
        if (list && list[i] !== undefined) obs.push(list[i]);
      }
      const pk = obs.length
        ? obs.slice().sort((a, b) => a - b)[Math.floor(obs.length / 2)]
        : STATIONS[i].pk;
      out.push({ code: STATIONS[i].code, name: STATIONS[i].name, pk });
    }
    return out;
  }, [stationsByCurve]);

  const fullRange = useMemo(() => {
    return {
      min: stationsAvg[0].pk - 0.05,
      max: stationsAvg[stationsAvg.length - 1].pk + 0.05,
    };
  }, [stationsAvg]);

  // Curvas con RTV aplicadas (recortes + frenado SBI + aceleración)
  const curvesWithRtv = useMemo(() => {
    const out: Record<string, CurvePoint[] | null> = {};
    for (const s of SOURCES) {
      const c = curves[s.key];
      const material = s.key.startsWith('NM16') ? 'NM16' : 'NM22';
      const via: 'V1' | 'V2' = s.key.endsWith('V1') ? 'V1' : 'V2';
      const tren = trenes[material];
      if (!c || !tren) { out[s.key] = null; continue; }
      const rtvsVia = rtvs.filter(r => r.via === via);
      if (!rtvsVia.length) { out[s.key] = null; continue; }
      out[s.key] = aplicarRtvCurva(c.curve, rtvsVia, via, tren);
    }
    return out;
  }, [curves, rtvs, trenes]);

  // Tiempos por curva. Para RTV, calculamos delta crudo (sin umbral) y lo sumamos
  // al baseline calibrado. Asi el Δt refleja el efecto físico real de la RTV.
  const tiempos = useMemo(() => {
    const out: Record<string, {
      tMarcha: number; tParadas: number; tTerminal: number;
      tMarchaRtv: number | null;
    }> = {};
    for (const s of SOURCES) {
      const c = curves[s.key];
      if (!c) continue;
      const tMarcha = computeRunningTime(c.curve, V_MIN_BASELINE);
      const via = s.key.endsWith('V1') ? 'V1' : 'V2';
      const tParadas = computeDwellTime(via, horario);
      const tTerminal = computeTerminalDwell(via, horario);
      const cRtv = curvesWithRtv[s.key];
      let tMarchaRtv: number | null = null;
      if (cRtv) {
        // delta físico real (sin umbral): T_full(rtv) - T_full(baseline)
        const tFullBase = computeRunningTime(c.curve, V_MIN_RAW);
        const tFullRtv  = computeRunningTime(cRtv,    V_MIN_RAW);
        tMarchaRtv = tMarcha + (tFullRtv - tFullBase);
      }
      out[s.key] = { tMarcha, tParadas, tTerminal, tMarchaRtv };
    }
    return out;
  }, [curves, horario, curvesWithRtv]);

  // Tiempos POR SEGMENTO (interestacion) por curva. Devuelve baseline y con-rtv.
  const segmentTimes = useMemo(() => {
    const out: Record<string, { from: string; to: string; pkA: number; pkB: number; t: number; tRtv: number | null }[]> = {};
    function segT(slice: CurvePoint[], vmin = V_MIN_BASELINE) {
      let t = 0;
      for (let k = 1; k < slice.length; k++) {
        const dx = slice[k].pk_km - slice[k-1].pk_km;
        const vAvg = (slice[k].v_kmh + slice[k-1].v_kmh) / 2;
        if (vAvg >= vmin && dx > 0) t += dx / vAvg * 3600;
      }
      return t;
    }
    for (let i = 0; i < SOURCES.length; i++) {
      const s = SOURCES[i];
      const c = curves[s.key];
      if (!c) continue;
      const stPKs = stationsByCurve[s.key];
      if (!stPKs) continue;
      const cRtv = curvesWithRtv[s.key];
      const segs: { from: string; to: string; pkA: number; pkB: number; t: number; tRtv: number | null }[] = [];
      for (let j = 0; j < STATIONS.length - 1; j++) {
        const pkA = stPKs[j]; const pkB = stPKs[j+1];
        if (pkA === undefined || pkB === undefined) continue;
        const slice = c.curve.filter(p => p.pk_km >= pkA - 0.001 && p.pk_km <= pkB + 0.001);
        const tBase = segT(slice, V_MIN_BASELINE);
        let tRtv: number | null = null;
        if (cRtv) {
          const sliceRtv = cRtv.filter(p => p.pk_km >= pkA - 0.001 && p.pk_km <= pkB + 0.001);
          const tFullBase = segT(slice,    V_MIN_RAW);
          const tFullRtv  = segT(sliceRtv, V_MIN_RAW);
          tRtv = tBase + (tFullRtv - tFullBase);
        }
        segs.push({ from: STATIONS[j].code, to: STATIONS[j+1].code, pkA, pkB, t: tBase, tRtv });
      }
      out[s.key] = segs;
    }
    return out;
  }, [curves, stationsByCurve, curvesWithRtv]);

  // Dwell por estacion segun horario y via
  const dwellByStation = useMemo(() => {
    const v1: Record<string, number> = {};
    const v2: Record<string, number> = {};
    for (const s of STATIONS) {
      v1[s.code] = TIEMPOS_PARADA_V1[s.code]?.[horario] ?? 15;
      v2[s.code] = TIEMPOS_PARADA_V2[s.code]?.[horario] ?? 15;
    }
    return { V1: v1, V2: v2 };
  }, [horario]);

  const span = view.max - view.min;
  const stepZoom = 1.2;

  const zoom = (factor: number) => {
    const center = (view.min + view.max) / 2;
    const newSpan = Math.max(0.3, Math.min(fullRange.max - fullRange.min, span * factor));
    setView({
      min: Math.max(fullRange.min, center - newSpan / 2),
      max: Math.min(fullRange.max, center + newSpan / 2),
    });
  };

  const pan = (deltaFrac: number) => {
    const delta = span * deltaFrac;
    let newMin = view.min + delta;
    let newMax = view.max + delta;
    if (newMin < fullRange.min) { newMax -= (newMin - fullRange.min); newMin = fullRange.min; }
    if (newMax > fullRange.max) { newMin -= (newMax - fullRange.max); newMax = fullRange.max; }
    setView({ min: Math.max(fullRange.min, newMin), max: Math.min(fullRange.max, newMax) });
  };

  const jumpToStation = (pk: number) => {
    const half = Math.max(STATION_AROUND_M / 2, span / 2);
    let newMin = pk - half;
    let newMax = pk + half;
    if (newMin < fullRange.min) { newMax += (fullRange.min - newMin); newMin = fullRange.min; }
    if (newMax > fullRange.max) { newMin -= (newMax - fullRange.max); newMax = fullRange.max; }
    setView({
      min: Math.max(fullRange.min, newMin),
      max: Math.min(fullRange.max, newMax),
    });
  };

  const nextStation = useCallback((dir: 1 | -1) => {
    const center = (view.min + view.max) / 2;
    // estación mas cercana al centro actual
    let idx = 0; let bestD = Infinity;
    for (let i = 0; i < STATIONS.length; i++) {
      const d = Math.abs(STATIONS[i].pk - center);
      if (d < bestD) { bestD = d; idx = i; }
    }
    const next = Math.max(0, Math.min(STATIONS.length - 1, idx + dir));
    jumpToStation(STATIONS[next].pk);
  }, [view, span]);

  const exportarReporte = async () => {
    if (rtvs.length === 0) return;
    const horarioLabel = HORARIOS.find(h => h.key === horario)?.label || horario;

    // Computar Δt por RTV individualmente + generar datos para gráficos individuales
    const perRtvCharts: any[] = [];
    const deltasPerRtv = rtvs.map(rtv => {
      const out = { rtv, deltas: { NM16: 0, NM22: 0 } } as { rtv: typeof rtv; deltas: { NM16: number; NM22: number } };
      for (const material of ['NM16', 'NM22'] as const) {
        const tren = trenes[material];
        if (!tren) continue;
        const via = rtv.via as 'V1' | 'V2';
        const cKey = `${material}_${via}`;
        const baseline = curves[cKey]?.curve;
        if (!baseline) continue;
        const modified = aplicarRtvCurva(baseline, [rtv], via, tren);
        const tBase = computeRunningTime(baseline, V_MIN_RAW);
        const tMod  = computeRunningTime(modified, V_MIN_RAW);
        const delta = tMod - tBase;
        out.deltas[material] = delta;
        // gráfico individual para esta combinación
        const L_km = tren.longitud_m / 1000;
        const zone = rtvEffectiveZone(rtv, via, L_km);
        const vMax = Math.max(80, ...baseline.map(p => p.v_kmh));
        perRtvCharts.push({
          rtv, material,
          baseline,
          rtvCurve: modified,
          effLoKm: zone.eff_lo, effHiKm: zone.eff_hi,
          rtvLoKm: zone.rtv_lo, rtvHiKm: zone.rtv_hi,
          despejeLoKm: zone.despeje_lo, despejeHiKm: zone.despeje_hi,
          deltaSec: delta,
          vMax,
          stations: STATIONS.map(s => ({ code: s.code, pk: s.pk })),
        });
      }
      return out;
    });

    // Δt total agregado (todas las RTVs juntas, ya está en `tiempos`)
    const totalDelta = {
      NM16_V1: (tiempos['NM16_V1']?.tMarchaRtv ?? 0) - (tiempos['NM16_V1']?.tMarcha ?? 0),
      NM16_V2: (tiempos['NM16_V2']?.tMarchaRtv ?? 0) - (tiempos['NM16_V2']?.tMarcha ?? 0),
      NM22_V1: (tiempos['NM22_V1']?.tMarchaRtv ?? 0) - (tiempos['NM22_V1']?.tMarcha ?? 0),
      NM22_V2: (tiempos['NM22_V2']?.tMarchaRtv ?? 0) - (tiempos['NM22_V2']?.tMarcha ?? 0),
    };
    const baselineTimes = {
      NM16_V1: tiempos['NM16_V1']?.tMarcha ?? 0,
      NM16_V2: tiempos['NM16_V2']?.tMarcha ?? 0,
      NM22_V1: tiempos['NM22_V1']?.tMarcha ?? 0,
      NM22_V2: tiempos['NM22_V2']?.tMarcha ?? 0,
    };

    // Capturar imágenes de los 4 paneles (estado actual de la vista)
    const chartImages: { key: string; label: string; png: string }[] = [];
    for (const s of SOURCES) {
      const canvas = chartRefs.current[s.key];
      if (!canvas) continue;
      try {
        chartImages.push({ key: s.key, label: s.label, png: canvas.toDataURL('image/png') });
      } catch (e) { console.error(e); }
    }

    // dwells por horario
    const dwellsV1: Record<string, number> = {}, dwellsV2: Record<string, number> = {};
    for (const code of Object.keys(TIEMPOS_PARADA_V1)) dwellsV1[code] = TIEMPOS_PARADA_V1[code][horario];
    for (const code of Object.keys(TIEMPOS_PARADA_V2)) dwellsV2[code] = TIEMPOS_PARADA_V2[code][horario];

    await exportRtvReport({
      horario: horarioLabel,
      rtvs,
      deltasPerRtv,
      totalDelta,
      baselineTimes,
      chartImages,
      perRtvCharts,
      trenes: Object.values(trenes),
      dwells: { V1: dwellsV1, V2: dwellsV2 },
      longitudTrenM: 151.33,
    });
  };

  const lastHWheelAt = useRef(0);
  const hAccum = useRef(0);
  const onWheel = useCallback((e: WheelEvent) => {
    // Ctrl/Cmd + scroll → zoom (interceptamos)
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoom(e.deltaY > 0 ? stepZoom : 1 / stepZoom);
      return;
    }
    // Gesto horizontal de trackpad (deltaX significativo) → cambiar estaciones
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.7 && Math.abs(e.deltaX) > 1) {
      e.preventDefault();
      hAccum.current += e.deltaX;
      const THR = 60;  // sensibilidad: ~60 px de swipe = 1 estación
      const now = performance.now();
      if (Math.abs(hAccum.current) >= THR && (now - lastHWheelAt.current) > 180) {
        nextStation(hAccum.current > 0 ? +1 : -1);
        hAccum.current = 0;
        lastHWheelAt.current = now;
      }
      return;
    }
    // Rueda vertical sin Ctrl: NO interceptar → scroll vertical normal de la pagina
  }, [span, view, nextStation]);

  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  if (loading) {
    return (
      <div className="marchas-page">
        <div className="marchas-loading">Cargando curvas de marcha…</div>
      </div>
    );
  }

  return (
    <div className="marchas-page">
      <div className="marchas-header">
        <h2>Curvas de Marcha Siemens — Línea 1</h2>
        <p className="marchas-sub">
          PK actual: {view.min.toFixed(3)} → {view.max.toFixed(3)} km · Ventana {(span).toFixed(3)} km
        </p>
      </div>

      <div className="marchas-controls">
        <div className="ctrl-group">
          <button onClick={() => pan(-0.4)} title="Atrás">⟪</button>
          <button onClick={() => pan(-0.1)} title="Atrás chico">‹</button>
          <button onClick={() => pan(+0.1)} title="Adelante chico">›</button>
          <button onClick={() => pan(+0.4)} title="Adelante">⟫</button>
        </div>
        <div className="ctrl-group">
          <button onClick={() => zoom(1 / stepZoom)} title="Zoom in">+</button>
          <button onClick={() => zoom(stepZoom)} title="Zoom out">−</button>
          <button onClick={() => setView(fullRange)} title="Ver todo">Todo</button>
        </div>
        <div className="ctrl-group ctrl-horario">
          <span className="ctrl-lbl">Horario:</span>
          {HORARIOS.map(h => (
            <button
              key={h.key}
              className={horario === h.key ? 'active' : ''}
              onClick={() => setHorario(h.key)}
            >{h.label}</button>
          ))}
          <button onClick={() => setShowDwellModal(true)} title="Ver tabla completa de tiempos de parada">
            Tabla dwell
          </button>
          <button
            onClick={() => setShowRtvModal(true)}
            className="btn-rtv"
            title="Aplicar restricciones de velocidad"
          >
            Aplicar RTV {rtvs.length > 0 ? `(${rtvs.length})` : ''}
          </button>
          <button
            onClick={() => exportarReporte()}
            className="btn-export"
            disabled={rtvs.length === 0}
            title={rtvs.length === 0 ? 'Aplique al menos una RTV para exportar' : 'Exportar reporte PDF'}
          >
            Exportar PDF
          </button>
        </div>
      </div>

      {showDwellModal && (
        <DwellModal horario={horario} onClose={() => setShowDwellModal(false)} />
      )}
      {showRtvModal && (
        <RtvModal
          rtvs={rtvs}
          onChange={setRtvs}
          onClose={() => setShowRtvModal(false)}
        />
      )}

      <div className="marchas-tiempos">
        {SOURCES.map(s => {
          const t = tiempos[s.key];
          if (!t) return null;
          const tTotal = t.tMarcha + t.tParadas + t.tTerminal;
          const tTotalRtv = t.tMarchaRtv !== null ? t.tMarchaRtv + t.tParadas + t.tTerminal : null;
          const delta = tTotalRtv !== null ? tTotalRtv - tTotal : null;
          return (
            <div key={s.key} className="tiempo-card">
              <div className="tiempo-label">{s.key.replace('_', ' ')}</div>
              <div className="tiempo-row"><span>Marcha (rodando)</span><strong>{fmtSeg(t.tMarcha)}</strong></div>
              <div className="tiempo-row"><span>Paradas intermedias (18)</span><strong>{fmtSeg(t.tParadas)}</strong></div>
              <div className="tiempo-row"><span>Terminales (PAN+OBS)</span><strong>{fmtSeg(t.tTerminal)}</strong></div>
              <div className="tiempo-row total"><span>Total c/maniobra</span><strong>{fmtSeg(tTotal)}</strong></div>
              {t.tMarchaRtv !== null && delta !== null && (
                <>
                  <div className="tiempo-row rtv"><span>Marcha c/RTV</span><strong>{fmtSeg(t.tMarchaRtv)}</strong></div>
                  <div className="tiempo-row rtv total"><span>Total c/RTV</span><strong>{fmtSeg(tTotalRtv!)}</strong></div>
                  <div className="tiempo-row delta"><span>Δ por viaje</span><strong>{delta >= 0 ? '+' : ''}{fmtSeg(delta)}</strong></div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="marchas-stations">
        {STATIONS.map(s => {
          // Una estación tiene RTV si alguna RTV (cualquier vía) cae dentro
          // del rango de las interestaciones adyacentes (i-1 -> i  o  i -> i+1)
          const sIdx = STATIONS.findIndex(x => x.code === s.code);
          const pkPrev = sIdx > 0 ? STATIONS[sIdx-1].pk : -Infinity;
          const pkNext = sIdx < STATIONS.length-1 ? STATIONS[sIdx+1].pk : Infinity;
          const hasRtv = rtvs.some(r => {
            const lo = Math.min(r.pki_m, r.pkf_m) / 1000;
            const hi = Math.max(r.pki_m, r.pkf_m) / 1000;
            // overlap con (pkPrev, pkNext)
            return hi >= pkPrev && lo <= pkNext;
          });
          const inView = view.min <= s.pk && s.pk <= view.max;
          return (
            <button
              key={s.code}
              className={`station-btn ${inView ? 'in-view' : ''} ${hasRtv ? 'has-rtv' : ''}`}
              onClick={() => jumpToStation(s.pk)}
              title={`${s.name} · PK ${s.pk.toFixed(3)}${hasRtv ? ' · contiene RTV' : ''}`}
            >
              {s.code}
            </button>
          );
        })}
      </div>

      <div className="marchas-charts" ref={containerRef}>
        {SOURCES.map(s => {
          const c = curves[s.key];
          if (!c) return (
            <div key={s.key} className="marchas-chart-empty">
              No se pudo cargar {s.key}
            </div>
          );
          const via: 'V1' | 'V2' = s.key.endsWith('V1') ? 'V1' : 'V2';
          const material = s.key.startsWith('NM16') ? 'NM16' : 'NM22';
          const tren = trenes[material];
          const L_km = tren ? tren.longitud_m / 1000 : 0.15133;
          const rtvZones = rtvs
            .filter(r => r.via === via)
            .map(r => rtvEffectiveZone(r, via, L_km));
          return (
            <ChartPanel
              key={s.key}
              label={s.label}
              color={s.color}
              curve={c.curve}
              curveRtv={curvesWithRtv[s.key] || undefined}
              rtvZones={rtvZones}
              viewMin={view.min}
              viewMax={view.max}
              vMax={V_MAX}
              stations={stationsAvg}
              perCurveStations={stationsByCurve[s.key]}
              segments={segmentTimes[s.key]}
              dwellTimes={dwellByStation[via]}
              onHoverPk={setHoverPk}
              hoverPk={hoverPk}
              canvasRef={(el) => { chartRefs.current[s.key] = el; }}
            />
          );
        })}
      </div>

      <div className="marchas-help">
        <span>Scroll horizontal (2 dedos →←) = siguiente/anterior estación · Ctrl+Scroll = zoom · Click sobre estación = saltar · Scroll vertical = página</span>
      </div>
    </div>
  );
}

type ChartPanelProps = {
  label: string;
  color: string;
  curve: CurvePoint[];
  curveRtv?: CurvePoint[];
  rtvZones?: { rtv_id?: string | number; v_rtv?: number; eff_lo: number; eff_hi: number; rtv_lo: number; rtv_hi: number; despeje_lo: number; despeje_hi: number }[];
  viewMin: number;
  viewMax: number;
  vMax: number;
  stations: { code: string; name: string; pk: number }[];
  perCurveStations?: number[];
  segments?: { from: string; to: string; pkA: number; pkB: number; t: number; tRtv: number | null }[];
  dwellTimes?: Record<string, number>;
  onHoverPk: (pk: number | null) => void;
  hoverPk: number | null;
  canvasRef?: (el: HTMLCanvasElement | null) => void;
};

function ChartPanel({ label, color, curve, curveRtv, rtvZones, viewMin, viewMax, vMax, stations, perCurveStations, segments, dwellTimes, onHoverPk, hoverPk, canvasRef: externalRef }: ChartPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // ResizeObserver maneja el sizing del canvas - SOLO se ejecuta cuando el wrapper cambia
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const update = () => {
      // clientWidth/clientHeight excluyen borde - evita feedback loop
      const w = wrapper.clientWidth; const h = wrapper.clientHeight;
      setSize(prev => (prev.w === w && prev.h === h) ? prev : { w, h });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.floor(size.w * dpr);
    const H = Math.floor(size.h * dpr);
    // SOLO setear el bitmap. NO tocar style.width/height (deja que el CSS 100%/100% maneje el display).
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext('2d'); if (!ctx) return;

    const PAD_L = 60 * dpr, PAD_R = 20 * dpr, PAD_T = 30 * dpr, PAD_B = 70 * dpr;
    const PW = W - PAD_L - PAD_R; const PH = H - PAD_T - PAD_B;

    ctx.clearRect(0, 0, W, H);
    // BG
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);
    // Plot area BG
    ctx.fillStyle = '#1e293b'; ctx.fillRect(PAD_L, PAD_T, PW, PH);

    const pkToX = (pk: number) => PAD_L + (pk - viewMin) / (viewMax - viewMin) * PW;
    const vToY = (v: number) => PAD_T + PH - (v / vMax) * PH;

    // Bandas de zona RTV (debajo de todo lo demás)
    if (rtvZones && rtvZones.length) {
      for (const z of rtvZones) {
        // Despeje (más claro)
        if (z.despeje_hi > viewMin && z.despeje_lo < viewMax) {
          const x1 = Math.max(pkToX(Math.max(z.despeje_lo, viewMin)), PAD_L);
          const x2 = Math.min(pkToX(Math.min(z.despeje_hi, viewMax)), PAD_L + PW);
          if (x2 > x1) {
            ctx.fillStyle = 'rgba(251, 191, 36, 0.10)';  // amarillo
            ctx.fillRect(x1, PAD_T, x2 - x1, PH);
          }
        }
        // Zona RTV propiamente dicha (más intenso)
        if (z.rtv_hi > viewMin && z.rtv_lo < viewMax) {
          const x1 = Math.max(pkToX(Math.max(z.rtv_lo, viewMin)), PAD_L);
          const x2 = Math.min(pkToX(Math.min(z.rtv_hi, viewMax)), PAD_L + PW);
          if (x2 > x1) {
            ctx.fillStyle = 'rgba(239, 68, 68, 0.16)';  // rojo
            ctx.fillRect(x1, PAD_T, x2 - x1, PH);
          }
        }
      }
    }

    // Y grid + labels
    ctx.font = `${10 * dpr}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let v = 0; v <= vMax; v += 10) {
      const y = vToY(v);
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(PAD_L, y); ctx.lineTo(PAD_L + PW, y); ctx.stroke();
      ctx.fillStyle = '#94a3b8'; ctx.fillText(String(v), PAD_L - 6 * dpr, y);
    }

    // X grid + labels (cada 0.05, 0.1 o 0.2 km segun zoom)
    const span = viewMax - viewMin;
    let step = 0.1; if (span < 1.5) step = 0.05; else if (span > 3) step = 0.2;
    if (span > 8) step = 0.5;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const pkStart = Math.ceil(viewMin / step) * step;
    for (let pk = pkStart; pk <= viewMax; pk += step) {
      const x = pkToX(pk);
      ctx.strokeStyle = '#334155'; ctx.beginPath();
      ctx.moveTo(x, PAD_T); ctx.lineTo(x, PAD_T + PH); ctx.stroke();
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(pk.toFixed(2), x, PAD_T + PH + 4 * dpr);
    }

    // Marcadores de estaciones (verticales verdes) + dwell time abajo
    for (let i = 0; i < stations.length; i++) {
      const s = stations[i];
      // PK de marker: usar el detectado por curva especifico si esta disponible
      const pk = perCurveStations && perCurveStations[i] !== undefined ? perCurveStations[i] : s.pk;
      if (pk < viewMin || pk > viewMax) continue;
      const x = pkToX(pk);
      ctx.strokeStyle = 'rgba(34,197,94,0.6)'; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(x, PAD_T); ctx.lineTo(x, PAD_T + PH); ctx.stroke();
      // etiqueta de estacion arriba
      ctx.fillStyle = '#86efac'; ctx.font = `bold ${11 * dpr}px sans-serif`;
      ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      ctx.fillText(s.code, x, PAD_T + 4 * dpr);
      // dwell time abajo del PK label
      if (dwellTimes && dwellTimes[s.code] !== undefined) {
        const d = dwellTimes[s.code];
        ctx.fillStyle = '#fbbf24'; ctx.font = `bold ${10 * dpr}px sans-serif`;
        ctx.textBaseline = 'top'; ctx.textAlign = 'center';
        ctx.fillText(`${d}s`, x, PAD_T + PH + 20 * dpr);
      }
    }

    // Tiempos de recorrido por segmento (interestacion), centrados entre dos estaciones
    if (segments) {
      for (const seg of segments) {
        // Usar perCurveStations para los limites visuales del segmento
        const idx = stations.findIndex(st => st.code === seg.from);
        const pkA = perCurveStations && perCurveStations[idx] !== undefined ? perCurveStations[idx] : seg.pkA;
        const pkB = perCurveStations && perCurveStations[idx+1] !== undefined ? perCurveStations[idx+1] : seg.pkB;
        const midPk = (pkA + pkB) / 2;
        if (midPk < viewMin || midPk > viewMax) continue;
        // ocultar si el segmento queda muy chico horizontalmente
        const wPx = pkToX(pkB) - pkToX(pkA);
        if (wPx < 40 * dpr) continue;
        const x = pkToX(midPk);
        const fmt = (t: number) => { const mm = Math.floor(t/60); const ss = Math.round(t - mm*60); return mm > 0 ? `${mm}m ${ss}s` : `${ss}s`; };
        ctx.font = `${10 * dpr}px sans-serif`;
        ctx.textBaseline = 'top'; ctx.textAlign = 'center';
        // Tiempo baseline
        ctx.fillStyle = seg.tRtv !== null ? '#94a3b8' : '#cbd5e1';
        ctx.fillText(fmt(seg.t), x, PAD_T + PH + 34 * dpr);
        // Tiempo con RTV (abajo, en rojo) si difiere
        if (seg.tRtv !== null) {
          ctx.fillStyle = '#ef4444';
          ctx.font = `bold ${10 * dpr}px sans-serif`;
          ctx.fillText(fmt(seg.tRtv), x, PAD_T + PH + 48 * dpr);
        }
      }
    }

    // CURVA BASELINE (color propio, opaco siempre — la curva de marcha tipo real)
    const hasRtv = !!(curveRtv && curveRtv.length);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * dpr;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    let started = false;
    for (const p of curve) {
      if (p.pk_km < viewMin - 0.01 || p.pk_km > viewMax + 0.01) continue;
      const x = pkToX(p.pk_km), y = vToY(p.v_kmh);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // CURVA CON RTV: en cualquier zona donde difiera del baseline (incluye frenado
    // antes de la RTV y aceleración después). Color rojo.
    if (curveRtv) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.5 * dpr;
      ctx.setLineDash([]);
      const baseIdx: Record<number, number> = {};
      curve.forEach((p, i) => { baseIdx[Math.round(p.pk_km * 100000)] = i; });
      ctx.beginPath();
      let started2 = false;
      for (let i = 0; i < curveRtv.length; i++) {
        const p = curveRtv[i];
        if (p.pk_km < viewMin - 0.01 || p.pk_km > viewMax + 0.01) {
          if (started2) { ctx.stroke(); ctx.beginPath(); started2 = false; }
          continue;
        }
        const j = baseIdx[Math.round(p.pk_km * 100000)];
        const vBase = j !== undefined ? curve[j].v_kmh : p.v_kmh;
        const differ = Math.abs(p.v_kmh - vBase) > 0.3;
        if (!differ) {
          if (started2) { ctx.stroke(); ctx.beginPath(); started2 = false; }
          continue;
        }
        const x = pkToX(p.pk_km), y = vToY(p.v_kmh);
        if (!started2) { ctx.moveTo(x, y); started2 = true; }
        else ctx.lineTo(x, y);
      }
      if (started2) ctx.stroke();
    }

    // Línea horizontal de v_rtv + ID en cada zona
    if (rtvZones && rtvZones.length) {
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      for (let idx = 0; idx < rtvZones.length; idx++) {
        const z = rtvZones[idx];
        if (z.v_rtv === undefined) continue;
        if (z.eff_hi < viewMin || z.eff_lo > viewMax) continue;
        // La línea horizontal abarca TODA la zona efectiva (RTV + despeje por cola)
        const x1 = pkToX(Math.max(z.eff_lo, viewMin));
        const x2 = pkToX(Math.min(z.eff_hi, viewMax));
        const yRtv = vToY(z.v_rtv);
        ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 1.8 * dpr;
        ctx.beginPath();
        ctx.moveTo(x1, yRtv); ctx.lineTo(x2, yRtv); ctx.stroke();
        // Etiqueta
        const labelTxt = `RTV ${z.rtv_id ?? ''} · ${z.v_rtv}km/h`;
        ctx.font = `bold ${10 * dpr}px sans-serif`;
        ctx.fillStyle = '#fecaca';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(labelTxt, (x1 + x2) / 2, yRtv - 3 * dpr);
      }
      ctx.setLineDash([]);
    }
    void hasRtv;
    void hexToRgba;

    // Frame
    ctx.strokeStyle = '#475569'; ctx.lineWidth = 1; ctx.strokeRect(PAD_L, PAD_T, PW, PH);

    // Cursor hover
    if (hoverPk !== null && hoverPk >= viewMin && hoverPk <= viewMax) {
      const x = pkToX(hoverPk);
      ctx.strokeStyle = 'rgba(248,113,113,0.55)'; ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(x, PAD_T); ctx.lineTo(x, PAD_T + PH); ctx.stroke();
      // valor en ese PK
      const i = nearestIdx(curve, hoverPk);
      if (i >= 0) {
        const v = curve[i].v_kmh;
        const y = vToY(v);
        ctx.fillStyle = color; ctx.beginPath();
        ctx.arc(x, y, 3 * dpr, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fef3c7'; ctx.font = `${11 * dpr}px sans-serif`;
        ctx.textAlign = x < W / 2 ? 'left' : 'right';
        ctx.textBaseline = 'bottom';
        const tx = x < W / 2 ? x + 6 * dpr : x - 6 * dpr;
        ctx.fillText(`v=${v.toFixed(1)} km/h  pk=${hoverPk.toFixed(3)} km`, tx, y - 5 * dpr);
      }
    }

    // Title
    ctx.fillStyle = '#e2e8f0';
    ctx.font = `bold ${12 * dpr}px sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(label, PAD_L, 8 * dpr);

    // Label Y
    ctx.save();
    ctx.translate(14 * dpr, PAD_T + PH / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.fillStyle = '#94a3b8';
    ctx.font = `${10 * dpr}px sans-serif`;
    ctx.fillText('V [km/h]', 0, 0); ctx.restore();
  }, [curve, curveRtv, rtvZones, viewMin, viewMax, vMax, stations, perCurveStations, segments, dwellTimes, hoverPk, color, label, size]);

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const wrapper = wrapperRef.current; if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const xRel = e.clientX - rect.left;
    const dpr = window.devicePixelRatio || 1;
    const PAD_L_css = 60; const PAD_R_css = 20;
    const PW_css = rect.width - PAD_L_css - PAD_R_css;
    if (xRel < PAD_L_css || xRel > rect.width - PAD_R_css) {
      onHoverPk(null); return;
    }
    const pk = viewMin + (xRel - PAD_L_css) / PW_css * (viewMax - viewMin);
    onHoverPk(pk);
    void dpr;
  };

  return (
    <div className="marchas-chart-wrapper" ref={wrapperRef}
         onMouseMove={onMouseMove}
         onMouseLeave={() => onHoverPk(null)}>
      <canvas ref={(el) => { canvasRef.current = el; if (externalRef) externalRef(el); }} />
    </div>
  );
}

type RtvModalProps = {
  rtvs: RtvApplied[];
  onChange: (next: RtvApplied[]) => void;
  onClose: () => void;
};

function RtvModal({ rtvs, onChange, onClose }: RtvModalProps) {
  const [catalog, setCatalog] = useState<CdvCatalog | null>(null);
  const [trenes, setTrenes] = useState<TrenSpec[] | null>(null);
  const [filterStation, setFilterStation] = useState('');
  const [filterVia, setFilterVia] = useState<'todos' | 'V1' | 'V2'>('todos');
  const [filterTipo, setFilterTipo] = useState<'todos' | 'fisicos' | 'virtuales'>('todos');
  const [search, setSearch] = useState('');
  const [vDefault, setVDefault] = useState(50);

  const [preset, setPreset] = useState<any>(null);

  useEffect(() => {
    const bust = Date.now();
    fetch(`/data/cdv_catalog.json?v=${bust}`).then(r => r.json()).then(setCatalog).catch(console.error);
    fetch(`/data/trenes.json?v=${bust}`).then(r => r.json()).then(d => setTrenes(d.trenes)).catch(console.error);
    fetch(`/data/rtv_ca01148.json?v=${bust}`).then(r => r.json()).then(setPreset).catch(console.error);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lista: (CdvFisico | CdvVirtual)[] = useMemo(() => {
    if (!catalog) return [];
    let out: (CdvFisico | CdvVirtual)[] = [];
    if (filterTipo === 'todos' || filterTipo === 'fisicos') out = out.concat(catalog.fisicos);
    if (filterTipo === 'todos' || filterTipo === 'virtuales') out = out.concat(catalog.virtuales);
    if (filterStation) out = out.filter(c => c.station === filterStation);
    if (filterVia !== 'todos') out = out.filter(c => c.via === filterVia);
    if (search) {
      const q = search.toLowerCase();
      out = out.filter(c => c.id.toLowerCase().includes(q));
    }
    out.sort((a, b) => a.pk_ini_m - b.pk_ini_m);
    return out.slice(0, 200);
  }, [catalog, filterStation, filterVia, filterTipo, search]);

  const stations = useMemo(() => {
    if (!catalog) return [];
    const set = new Set<string>();
    catalog.fisicos.forEach(c => set.add(c.station));
    return Array.from(set).sort();
  }, [catalog]);

  const addRtv = (c: CdvFisico | CdvVirtual) => {
    // crear un nuevo RTV con un solo CDV usando el rango PK del CDV
    if (rtvs.some(r => r.cdvs.includes(c.id))) return;
    onChange([...rtvs, {
      id: `m_${Date.now()}_${c.id}`,
      via: c.via,
      pki_m: Math.min(c.pk_ini_m, c.pk_fin_m),
      pkf_m: Math.max(c.pk_ini_m, c.pk_fin_m),
      v_rtv_kmh: vDefault,
      cdvs: [c.id],
    }]);
  };
  const removeRtv = (id: string | number) => onChange(rtvs.filter(r => r.id !== id));
  const updateV = (id: string | number, v: number) =>
    onChange(rtvs.map(r => r.id === id ? { ...r, v_rtv_kmh: v } : r));

  const cargarPreset = () => {
    if (!preset || !preset.rtvs) return;
    onChange(preset.rtvs.map((r: any) => ({
      id: r.id,
      via: r.via,
      pki_m: r.pki_m,
      pkf_m: r.pkf_m,
      v_rtv_kmh: r.v_rtv_kmh,
      cdvs: r.cdvs,
    })));
  };

  return (
    <div className="dwell-modal-overlay" onClick={onClose}>
      <div className="dwell-modal rtv-modal" onClick={e => e.stopPropagation()}>
        <div className="dwell-modal-header">
          <h3>Aplicar Restricciones de Velocidad (RTV)</h3>
          <button className="dwell-close" onClick={onClose}>×</button>
        </div>
        <div className="rtv-modal-body">
          <div className="rtv-picker">
            <div className="rtv-section-title">Catálogo de CDV</div>
            <div className="rtv-filters">
              <input
                type="text" placeholder="Buscar por ID..." value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <select value={filterStation} onChange={e => setFilterStation(e.target.value)}>
                <option value="">Toda estación</option>
                {stations.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={filterVia} onChange={e => setFilterVia(e.target.value as any)}>
                <option value="todos">V1 y V2</option>
                <option value="V1">V1</option>
                <option value="V2">V2</option>
              </select>
              <select value={filterTipo} onChange={e => setFilterTipo(e.target.value as any)}>
                <option value="todos">Físicos + Virtuales</option>
                <option value="fisicos">Físicos</option>
                <option value="virtuales">Virtuales</option>
              </select>
              <label className="rtv-vdefault">
                V por defecto: <input type="number" min={5} max={80} value={vDefault} onChange={e => setVDefault(+e.target.value)} /> km/h
              </label>
            </div>
            <div className="rtv-cdv-list">
              {!catalog && <div className="rtv-loading">Cargando catálogo…</div>}
              {catalog && lista.length === 0 && <div className="rtv-empty">Sin resultados</div>}
              {lista.map(c => {
                const aplicado = rtvs.some(r => r.cdvs.includes(c.id));
                return (
                  <div key={c.id} className={`rtv-cdv-item ${aplicado ? 'applied' : ''}`}>
                    <div className="rtv-cdv-info">
                      <div className="rtv-cdv-id">{c.id} <span className="rtv-cdv-via">{c.via} · {c.station}</span></div>
                      <div className="rtv-cdv-pk">PK {(c.pk_ini_m/1000).toFixed(3)} → {(c.pk_fin_m/1000).toFixed(3)} km · {c.longitud_m.toFixed(1)} m</div>
                    </div>
                    <button
                      className="btn-add-rtv"
                      onClick={() => addRtv(c)}
                      disabled={aplicado}
                    >{aplicado ? '✓' : '+'}</button>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rtv-applied">
            <div className="rtv-section-title">
              RTVs aplicadas ({rtvs.length})
              <button className="rtv-preset" onClick={cargarPreset} disabled={!preset} title="Cargar set de RTVs preconfigurado">
                Preset RTVs
              </button>
              {rtvs.length > 0 && (
                <button className="rtv-clear" onClick={() => onChange([])}>Limpiar</button>
              )}
            </div>
            <div className="rtv-applied-list">
              {rtvs.length === 0 && <div className="rtv-empty">Ninguna RTV aplicada todavía.</div>}
              {rtvs.map(r => (
                <div key={r.id} className="rtv-applied-item">
                  <div className="rtv-applied-info">
                    <div className="rtv-cdv-id">
                      RTV #{r.id} <span className="rtv-cdv-via">{r.via}</span>
                    </div>
                    <div className="rtv-cdv-pk">
                      PK {(r.pki_m/1000).toFixed(3)} → {(r.pkf_m/1000).toFixed(3)} km · {(r.pkf_m - r.pki_m).toFixed(0)} m
                    </div>
                    <div className="rtv-cdv-cdvs">CDVs: {r.cdvs.join(', ')}</div>
                  </div>
                  <input
                    type="number" min={5} max={80} value={r.v_rtv_kmh}
                    onChange={e => updateV(r.id, +e.target.value)}
                  />
                  <span>km/h</span>
                  <button onClick={() => removeRtv(r.id)} className="rtv-remove">×</button>
                </div>
              ))}
            </div>
            {trenes && (
              <div className="rtv-trenes-info">
                <div className="rtv-section-subtitle">Material rodante disponible</div>
                {trenes.map(t => (
                  <div key={t.id} className="rtv-tren-card">
                    <strong>{t.nombre}</strong>
                    <div>Longitud: {t.longitud_m} m · Masa: {(t.masa_kg/1000).toFixed(1)} t</div>
                    <div>Decel servicio: {t.decel_servicio_ms2} m/s² · Jerk trac/freno: {t.jerk_traccion_ms3}/{t.jerk_frenado_ms3} m/s³</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type DwellModalProps = { horario: Horario; onClose: () => void };

function DwellModal({ horario, onClose }: DwellModalProps) {
  // Orden V1 (PAN -> OBS). Mostramos en filas: cada estación con tiempos V1 y V2 por horario.
  const ORDEN = ['PAN','ZAR','GOM','BPA','BAL','MOC','SLA','CAN','MER','PIN',
                 'ISA','SAL','BAD','CUA','INS','SEV','CHP','JNA','TCY','OBS'];
  const NOMBRES: Record<string,string> = {
    PAN:'Pantitlán', ZAR:'Zaragoza', GOM:'Gómez Farías', BPA:'Boulevard Puerto Aéreo',
    BAL:'Balbuena', MOC:'Moctezuma', SLA:'San Lázaro', CAN:'Candelaria',
    MER:'Merced', PIN:'Pino Suárez', ISA:'Isabel la Católica', SAL:'Salto del Agua',
    BAD:'Balderas', CUA:'Cuauhtémoc', INS:'Insurgentes', SEV:'Sevilla',
    CHP:'Chapultepec', JNA:'Juanacatlán', TCY:'Tacubaya', OBS:'Observatorio',
  };
  const v1 = TIEMPOS_PARADA_V1; const v2 = TIEMPOS_PARADA_V2;

  // Cerrar con Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dwell-modal-overlay" onClick={onClose}>
      <div className="dwell-modal" onClick={e => e.stopPropagation()}>
        <div className="dwell-modal-header">
          <h3>Tiempos de parada en estaciones (Tabla 8 - Headway)</h3>
          <button className="dwell-close" onClick={onClose}>×</button>
        </div>
        <div className="dwell-modal-body">
          <p className="dwell-modal-note">
            Valores en segundos. Horario activo: <strong>{horario.replace('_',' ')}</strong>.
            Terminales (PAN, OBS) incluyen tiempo de inversión.
          </p>
          <table className="dwell-table">
            <thead>
              <tr>
                <th rowSpan={2}>Cód</th>
                <th rowSpan={2}>Estación</th>
                <th colSpan={3}>Vía 1 (PAN → OBS)</th>
                <th colSpan={3}>Vía 2 (OBS → PAN)</th>
              </tr>
              <tr>
                <th className={horario==='valle'?'col-active':''}>Valle</th>
                <th className={horario==='pico_manana'?'col-active':''}>Pico AM</th>
                <th className={horario==='pico_tarde'?'col-active':''}>Pico PM</th>
                <th className={horario==='valle'?'col-active':''}>Valle</th>
                <th className={horario==='pico_manana'?'col-active':''}>Pico AM</th>
                <th className={horario==='pico_tarde'?'col-active':''}>Pico PM</th>
              </tr>
            </thead>
            <tbody>
              {ORDEN.map(code => (
                <tr key={code}>
                  <td className="code">{code}</td>
                  <td className="name">{NOMBRES[code]}</td>
                  <td className={horario==='valle'?'col-active':''}>{v1[code]?.valle ?? '-'}</td>
                  <td className={horario==='pico_manana'?'col-active':''}>{v1[code]?.pico_manana ?? '-'}</td>
                  <td className={horario==='pico_tarde'?'col-active':''}>{v1[code]?.pico_tarde ?? '-'}</td>
                  <td className={horario==='valle'?'col-active':''}>{v2[code]?.valle ?? '-'}</td>
                  <td className={horario==='pico_manana'?'col-active':''}>{v2[code]?.pico_manana ?? '-'}</td>
                  <td className={horario==='pico_tarde'?'col-active':''}>{v2[code]?.pico_tarde ?? '-'}</td>
                </tr>
              ))}
              <tr className="totals-row">
                <td className="code" colSpan={2}>Σ Intermedias</td>
                {(['valle','pico_manana','pico_tarde'] as Horario[]).map(h => {
                  const sumV1 = ORDEN.slice(1, -1).reduce((s, c) => s + (v1[c]?.[h] ?? 0), 0);
                  return (
                    <td key={`v1-${h}`} className={horario===h?'col-active':''}><strong>{sumV1}</strong></td>
                  );
                })}
                {(['valle','pico_manana','pico_tarde'] as Horario[]).map(h => {
                  const sumV2 = ORDEN.slice(1, -1).reduce((s, c) => s + (v2[c]?.[h] ?? 0), 0);
                  return (
                    <td key={`v2-${h}`} className={horario===h?'col-active':''}><strong>{sumV2}</strong></td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function nearestIdx(curve: CurvePoint[], pk: number): number {
  // Binary search
  if (!curve.length) return -1;
  let lo = 0, hi = curve.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (curve[mid].pk_km < pk) lo = mid; else hi = mid;
  }
  return Math.abs(curve[lo].pk_km - pk) < Math.abs(curve[hi].pk_km - pk) ? lo : hi;
}
