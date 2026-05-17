/**
 * Motor cinemático del simulador RTV.
 * Port TypeScript de sim_v17.py validado contra Tablas 9/14/19/24 del PDF Headway.
 *
 * Modela:
 * - Polígono operacional V1/V2 (Tabla 5)
 * - Tabla aceleración por velocidad (NM16/NM22)
 * - Davis resistance (A + B·v + C·v²)
 * - Brake state machine: AC_DELAY → EB_DELAY → RAMP → FULL
 * - Jerk de tracción y frenado
 * - Smoothing de valles (agujas)
 * - Cruise factor 0.97 (margen operacional ATO)
 */
import type { PolygonSegment, TrenParams } from './data';
import { G, LONGITUD_TREN_M, ESTACIONES_PK_M } from './data';
import { ORDEN_V1, ORDEN_V2, tiempoParada, type Horario } from './tiempos_parada';

export interface RTV {
  pk_ini_m: number;
  pk_fin_m: number;
  v_kmh: number;
}

export interface SimResult {
  pk_km: number[];       // posición en km
  v_kmh: number[];       // velocidad en km/h
  tiempo_total_s: number;
}

const CRUISE_FACTOR = 0.97;
const SMOOTH_WINDOW_M = 100;
const SMOOTH_THRESHOLD_KMH = 40;
const SMOOTH_TOL_KMH = 6;

/** Devuelve la velocidad del polígono en m/s a una posición en metros. */
function vPoligono(poligono: PolygonSegment[], pk_m: number): number {
  const km = pk_m / 1000;
  for (const seg of poligono) {
    if (seg.pk_ini_km <= km && km < seg.pk_fin_km) {
      return seg.v_kmh / 3.6;
    }
  }
  return 80 / 3.6;
}

/** Aceleración máxima de tracción a una velocidad dada (m/s²). */
function aTraccion(v_kmh: number, accel: TrenParams['accel']): number {
  if (v_kmh <= 0) return accel[0].a_cm_s2 / 100;
  if (v_kmh >= 80) return accel[accel.length - 1].a_cm_s2 / 100;
  for (let i = 0; i < accel.length - 1; i++) {
    const a = accel[i], b = accel[i + 1];
    if (a.v_kmh <= v_kmh && v_kmh <= b.v_kmh) {
      if (b.v_kmh === a.v_kmh) return a.a_cm_s2 / 100;
      const f = (v_kmh - a.v_kmh) / (b.v_kmh - a.v_kmh);
      return (a.a_cm_s2 + f * (b.a_cm_s2 - a.a_cm_s2)) / 100;
    }
  }
  return 0.2;
}

function davisForce(v_ms: number, t: TrenParams): number {
  return t.davis_A + t.davis_B * v_ms + t.davis_C * v_ms * v_ms;
}

/** Aplica una RTV a un polígono base. Zona efectiva = [PK_ini, PK_fin + L_tren]. */
export function aplicarRTV(
  poligono: PolygonSegment[],
  rtv: RTV,
): PolygonSegment[] {
  const zonaIni = rtv.pk_ini_m / 1000;
  const zonaFin = (rtv.pk_fin_m + LONGITUD_TREN_M) / 1000;
  const result: PolygonSegment[] = [];

  for (const seg of poligono) {
    if (seg.pk_fin_km <= zonaIni || seg.pk_ini_km >= zonaFin) {
      result.push(seg);
    } else if (seg.pk_ini_km >= zonaIni && seg.pk_fin_km <= zonaFin) {
      result.push({ ...seg, v_kmh: Math.min(seg.v_kmh, rtv.v_kmh) });
    } else {
      let curIni = seg.pk_ini_km;
      if (curIni < zonaIni) {
        result.push({ pk_ini_km: curIni, pk_fin_km: zonaIni, v_kmh: seg.v_kmh });
        curIni = zonaIni;
      }
      if (seg.pk_fin_km > zonaFin) {
        result.push({ pk_ini_km: curIni, pk_fin_km: zonaFin, v_kmh: Math.min(seg.v_kmh, rtv.v_kmh) });
        result.push({ pk_ini_km: zonaFin, pk_fin_km: seg.pk_fin_km, v_kmh: seg.v_kmh });
      } else {
        result.push({ pk_ini_km: curIni, pk_fin_km: seg.pk_fin_km, v_kmh: Math.min(seg.v_kmh, rtv.v_kmh) });
      }
    }
  }
  return result;
}

export interface SimOpciones {
  pk_origen_m: number;
  pk_destino_m: number;
  poligono: PolygonSegment[];
  tren: TrenParams;
  via?: 1 | 2;
  gradienteAt?: (pk_m: number) => number;  // ‰
  dt?: number;
  dx?: number;
  cruiseFactor?: number;
}

/** Simulación cinemática completa con state machine de frenado. */
export function simular(opts: SimOpciones): SimResult {
  const { pk_origen_m, pk_destino_m, poligono, tren } = opts;
  const dt = opts.dt ?? 0.05;
  const dx = opts.dx ?? 1.0;
  const cruiseFactor = opts.cruiseFactor ?? CRUISE_FACTOR;
  const gradAt = opts.gradienteAt ?? (() => 0);

  const direccion = pk_destino_m > pk_origen_m ? 1 : -1;
  const pkLo = Math.min(pk_origen_m, pk_destino_m);
  const pkHi = Math.max(pk_origen_m, pk_destino_m);
  const distTotal = pkHi - pkLo;
  const n = Math.floor(distTotal / dx) + 1;

  const pkAt = (xRel: number) => pk_origen_m + direccion * xRel;
  const vLimRaw = new Array(n);
  for (let i = 0; i < n; i++) {
    vLimRaw[i] = vPoligono(poligono, pkAt(i * dx));
  }

  // Smooth valleys: en zonas con restricciones bajas (<40 km/h) cercanas, aplastar picos
  const nWin = Math.floor(SMOOTH_WINDOW_M / dx);
  const lowThresh = SMOOTH_THRESHOLD_KMH / 3.6;
  const tolSm = SMOOTH_TOL_KMH / 3.6;
  const vLimSmoothed = vLimRaw.slice();
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - nWin);
    const hi = Math.min(n, i + nWin + 1);
    let localMin = Infinity;
    for (let j = lo; j < hi; j++) {
      if (vLimRaw[j] < localMin) localMin = vLimRaw[j];
    }
    if (localMin < lowThresh && vLimRaw[i] > localMin + tolSm) {
      vLimSmoothed[i] = Math.min(vLimSmoothed[i], localMin + tolSm);
    }
  }

  const vLim = vLimSmoothed.map((v: number) => v * cruiseFactor);

  // Backward propagation estándar (sin delay)
  const vAllowed = vLim.slice();
  vAllowed[n - 1] = 0;
  for (let i = n - 2; i >= 0; i--) {
    const vBrake = Math.sqrt(vAllowed[i + 1] ** 2 + 2 * tren.decel_serv * dx);
    vAllowed[i] = Math.min(vAllowed[i], vBrake);
  }

  function anticipationDist(vNow: number, vTarget: number): number {
    if (vNow <= vTarget) return 0;
    const tPre = tren.t_ac_delay + tren.t_eb_delay + tren.t_EB / 2;
    return vNow * tPre + (vNow ** 2 - vTarget ** 2) / (2 * tren.decel_serv);
  }

  // Forward simulation con state machine
  let t = 0, x = 0, v = 0, aCur = 0;
  const recPk: number[] = [];
  const recV: number[] = [];

  let state: 'NORM' | 'BRAKE_AC' | 'BRAKE_EB' | 'BRAKE_RAMP' | 'BRAKE_FULL' = 'NORM';
  let stateT = 0;
  let brakeTargetV = 0;
  let brakeRampA = 0;

  const recordSnapshot = () => {
    const pk_m = pk_origen_m + direccion * x;
    recPk.push(pk_m / 1000);
    recV.push(v * 3.6);
  };
  recordSnapshot();

  let safety = 0;
  while (x < distTotal - 0.05 && t < 300) {
    safety++; if (safety > 200000) break;

    const idx = Math.min(Math.floor(x / dx), n - 1);
    const vMaxHere = vAllowed[idx];
    const pkNow = pkAt(x);
    const grad = gradAt(pkNow);
    const aGrav = -G * (grad / 1000) * direccion;
    const aDav = davisForce(v, tren) / tren.masa_kg;

    let a = 0;

    if (state === 'NORM') {
      const laDist = anticipationDist(v, 0);
      const idxLaEnd = Math.min(Math.floor((x + laDist + 50) / dx), n - 1);
      let needBrake = false;
      for (let k = idx; k <= idxLaEnd; k++) {
        if (vAllowed[k] < v - 0.3) {
          const dToK = (k - idx) * dx;
          const dNeeded = anticipationDist(v, vAllowed[k]);
          if (dNeeded >= dToK) {
            needBrake = true;
            brakeTargetV = vAllowed[k];
            break;
          }
        }
      }
      if (needBrake) {
        state = 'BRAKE_AC';
        stateT = 0;
        a = -aDav + aGrav;
        aCur = 0;
      } else if (v < vMaxHere - 0.05) {
        const aMaxTr = aTraccion(v * 3.6, tren.accel);
        const aTarget = aMaxTr - aDav + aGrav;
        if (aCur < aTarget) {
          aCur = Math.min(aTarget, aCur + tren.jerk_traccion * dt);
        } else {
          aCur = aTarget;
        }
        a = aCur;
      } else {
        a = 0;
        aCur = 0;
      }
    } else if (state === 'BRAKE_AC') {
      a = -aDav + aGrav;
      stateT += dt;
      if (stateT >= tren.t_ac_delay) {
        state = 'BRAKE_EB';
        stateT = 0;
      }
    } else if (state === 'BRAKE_EB') {
      a = -aDav + aGrav;
      stateT += dt;
      if (stateT >= tren.t_eb_delay) {
        state = 'BRAKE_RAMP';
        stateT = 0;
        brakeRampA = 0;
      }
    } else if (state === 'BRAKE_RAMP') {
      brakeRampA = Math.min(tren.decel_serv, brakeRampA + tren.jerk_frenado * dt);
      a = -brakeRampA - aDav + aGrav;
      if (brakeRampA >= tren.decel_serv) state = 'BRAKE_FULL';
      if (v <= brakeTargetV + 0.05) {
        state = 'NORM';
        brakeRampA = 0;
      }
    } else if (state === 'BRAKE_FULL') {
      a = -tren.decel_serv - aDav + aGrav;
      if (v <= brakeTargetV + 0.05) {
        state = 'NORM';
        brakeRampA = 0;
      }
    }

    const vNew = Math.max(0, v + a * dt);
    const vAvg = (v + vNew) / 2;
    x += vAvg * dt;
    t += dt;
    v = vNew;

    if (Math.floor(x / dx) > Math.floor((x - vAvg * dt) / dx)) {
      recordSnapshot();
    }
  }

  // Asegurar parada al destino
  while (v > 0.05 && t < 700) {
    const a = -tren.decel_serv;
    const vNew = Math.max(0, v + a * dt);
    x += (v + vNew) / 2 * dt;
    t += dt;
    v = vNew;
  }
  recordSnapshot();

  return {
    pk_km: recPk,
    v_kmh: recV,
    tiempo_total_s: Math.round(t * 100) / 100,
  };
}

export interface SegmentoResult {
  origen: string;
  destino: string;
  pk_origen_m: number;
  pk_destino_m: number;
  t_viaje_s: number;
  t_parada_destino_s: number;
  pk_km: number[];
  v_kmh: number[];
}

export interface VueltaResult {
  via: 1 | 2;
  horario: Horario;
  segmentos: SegmentoResult[];
  t_viaje_total_s: number;
  t_paradas_total_s: number;
  t_vuelta_s: number;
}

/**
 * Simula una vuelta completa, segmento por segmento, con paradas en cada estación.
 * Permite aplicar RTVs (se aplican al polígono antes de simular).
 */
export function simularVueltaCompleta(
  via: 1 | 2,
  poligono: PolygonSegment[],
  tren: TrenParams,
  horario: Horario,
  rtvs: RTV[] = [],
  opts: { dt?: number; dx?: number } = {},
): VueltaResult {
  // Aplicar todas las RTVs al polígono
  let polCon = poligono;
  for (const r of rtvs) polCon = aplicarRTV(polCon, r);

  const orden = via === 1 ? ORDEN_V1 : ORDEN_V2;
  const segmentos: SegmentoResult[] = [];
  let tViaje = 0, tParadas = 0;

  for (let i = 0; i < orden.length - 1; i++) {
    const origen = orden[i];
    const destino = orden[i + 1];
    const pkO = ESTACIONES_PK_M[origen];
    const pkD = ESTACIONES_PK_M[destino];

    const sim = simular({
      pk_origen_m: pkO, pk_destino_m: pkD,
      poligono: polCon, tren, via,
      ...opts,
    });

    // Parada en destino (excepto terminal final, ya viene cubierto)
    const tPar = (i === orden.length - 2) ? 0 : tiempoParada(via, destino, horario);

    segmentos.push({
      origen, destino, pk_origen_m: pkO, pk_destino_m: pkD,
      t_viaje_s: sim.tiempo_total_s,
      t_parada_destino_s: tPar,
      pk_km: sim.pk_km, v_kmh: sim.v_kmh,
    });
    tViaje += sim.tiempo_total_s;
    tParadas += tPar;
  }

  return {
    via, horario, segmentos,
    t_viaje_total_s: Math.round(tViaje * 10) / 10,
    t_paradas_total_s: tParadas,
    t_vuelta_s: Math.round((tViaje + tParadas) * 10) / 10,
  };
}

