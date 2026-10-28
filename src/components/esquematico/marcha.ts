// Marcha tipo por material y vía a lo largo de la línea.
// - Velocidad en cada PK: curvas digitalizadas de la simulación Siemens (public/marchas/*_stitched.json).
// - Tiempos de recorrido por tramo y de parada por estación: tablas Siemens (src/data/marchaTipoSiemens.ts).
// La forma de la marcha dentro de cada tramo sale de integrar 1/v sobre la curva; la duración del tramo
// se ajusta a la tabla Siemens.
import { SERVICE_STATIONS, STATION_PK } from '../../data/stationPK';
import { dwellTimeSec, segmentTimeSec } from '../../data/marchaTipoSiemens';
import type { Horario } from '../../simulador/tiempos_parada';
import type { MaterialFlota } from '../../data/flota';

export type ViaMarcha = 'V1' | 'V2';

export interface CurvaMarcha {
  material: MaterialFlota;
  via: ViaMarcha;
  pk: number[];   // m, creciente
  v: number[];    // km/h
}

export const ARCHIVOS_MARCHA: { material: MaterialFlota; via: ViaMarcha; archivo: string }[] = [
  { material: 'NM16', via: 'V1', archivo: '/marchas/NM16_V1_PAN-OBS_stitched.json' },
  { material: 'NM16', via: 'V2', archivo: '/marchas/NM16_V2_OBS-PAN_stitched.json' },
  { material: 'NM22', via: 'V1', archivo: '/marchas/NM22_V1_PAN-OBS_stitched.json' },
  { material: 'NM22', via: 'V2', archivo: '/marchas/NM22_V2_OBS-PAN_stitched.json' },
];

interface CurvaJson { meta: { material: string; via: string }; curve: { pk_km: number; v_kmh: number }[] }

export function curvaDesdeJson(material: MaterialFlota, via: ViaMarcha, j: CurvaJson): CurvaMarcha {
  const pts = [...j.curve].sort((a, b) => a.pk_km - b.pk_km);
  return { material, via, pk: pts.map(p => p.pk_km * 1000), v: pts.map(p => p.v_kmh) };
}

export async function cargarCurvas(): Promise<CurvaMarcha[]> {
  const out: CurvaMarcha[] = [];
  await Promise.all(ARCHIVOS_MARCHA.map(async a => {
    try {
      const r = await fetch(a.archivo);
      if (r.ok) out.push(curvaDesdeJson(a.material, a.via, await r.json()));
    } catch { /* sin curva: interpolación lineal */ }
  }));
  return out;
}

const V_MIN = 3; // km/h: evita tiempos infinitos en los puntos de detención

function indiceDesde(pk: number[], x: number): number {
  let lo = 0, hi = pk.length - 1;
  if (x <= pk[0]) return 0;
  if (x >= pk[hi]) return hi;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (pk[m] <= x) lo = m; else hi = m;
  }
  return lo;
}

/** Perfil de tiempo normalizado entre dos PK (en el orden de marcha): pks y fracción de tiempo acumulada 0..1. */
export function perfilTramo(c: CurvaMarcha, pkA: number, pkB: number): { pks: number[]; f: number[] } | null {
  const a = Math.min(pkA, pkB), b = Math.max(pkA, pkB);
  if (b - a < 1 || a < c.pk[0] - 50 || b > c.pk[c.pk.length - 1] + 50) return null;
  const i0 = indiceDesde(c.pk, a), i1 = indiceDesde(c.pk, b);
  const pks: number[] = [a];
  for (let i = i0 + 1; i <= i1; i++) if (c.pk[i] > a && c.pk[i] < b) pks.push(c.pk[i]);
  pks.push(b);
  const vAt = (x: number) => {
    const i = indiceDesde(c.pk, x);
    const j = Math.min(i + 1, c.pk.length - 1);
    const t = c.pk[j] === c.pk[i] ? 0 : (x - c.pk[i]) / (c.pk[j] - c.pk[i]);
    return Math.max(V_MIN, c.v[i] + t * (c.v[j] - c.v[i]));
  };
  const cum = [0];
  for (let i = 1; i < pks.length; i++) {
    const dx = pks[i] - pks[i - 1];
    const vm = (vAt(pks[i]) + vAt(pks[i - 1])) / 2 / 3.6;
    cum.push(cum[i - 1] + dx / vm);
  }
  const tot = cum[cum.length - 1] || 1;
  let f = cum.map(x => x / tot);
  let p = pks;
  if (pkA > pkB) { // marcha en PK decreciente
    p = [...pks].reverse();
    f = [...f].reverse().map(x => 1 - x);
  }
  return { pks: p, f };
}

const cachePerfiles = new WeakMap<CurvaMarcha, Map<string, ReturnType<typeof perfilTramo>>>();

function perfilCacheado(c: CurvaMarcha, pkA: number, pkB: number): ReturnType<typeof perfilTramo> {
  let m = cachePerfiles.get(c);
  if (!m) { m = new Map(); cachePerfiles.set(c, m); }
  const k = `${pkA}|${pkB}`;
  if (!m.has(k)) {
    if (m.size > 5000) m.clear();
    m.set(k, perfilTramo(c, pkA, pkB));
  }
  return m.get(k) ?? null;
}

/** PK alcanzado al recorrer la fracción `frac` del tiempo entre dos paradas. Sin curva: lineal. */
export function pkEnTramo(c: CurvaMarcha | null, pkA: number, pkB: number, frac: number): number {
  const fr = Math.max(0, Math.min(1, frac));
  const perfil = c ? perfilCacheado(c, pkA, pkB) : null;
  if (!perfil) return pkA + (pkB - pkA) * fr;
  const { pks, f } = perfil;
  let lo = 1, hi = f.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (f[m] < fr) lo = m + 1; else hi = m; }
  const i = lo;
  const t = f[i] === f[i - 1] ? 0 : (fr - f[i - 1]) / (f[i] - f[i - 1]);
  return pks[i - 1] + t * (pks[i] - pks[i - 1]);
}

export interface PuntoMarcha { t: number; pk: number; estacion?: string; tipo?: 'arr' | 'dep' }

/** Marcha tipo completa (segundos desde la salida de la terminal de origen). V1: PAN→OBS, V2: OBS→PAN. */
export function trayectoriaTipo(c: CurvaMarcha | null, material: MaterialFlota, via: ViaMarcha, horario: Horario,
  muestrasPorTramo = 24): PuntoMarcha[] {
  const est = via === 'V1' ? [...SERVICE_STATIONS] : [...SERVICE_STATIONS].reverse();
  const out: PuntoMarcha[] = [{ t: 0, pk: STATION_PK[est[0]], estacion: est[0], tipo: 'dep' }];
  let t = 0;
  for (let i = 1; i < est.length; i++) {
    const A = est[i - 1], B = est[i];
    const pkA = STATION_PK[A], pkB = STATION_PK[B];
    const T = segmentTimeSec(material, via, A, B) || Math.abs(pkB - pkA) / (40 / 3.6);
    for (let k = 1; k < muestrasPorTramo; k++) {
      const fr = k / muestrasPorTramo;
      out.push({ t: t + fr * T, pk: pkEnTramo(c, pkA, pkB, fr) });
    }
    t += T;
    out.push({ t, pk: pkB, estacion: B, tipo: 'arr' });
    if (i < est.length - 1) {
      t += dwellTimeSec(via, horario, B);
      out.push({ t, pk: pkB, estacion: B, tipo: 'dep' });
    }
  }
  return out;
}

export function curvaDe(curvas: CurvaMarcha[], material: MaterialFlota | null, via: ViaMarcha): CurvaMarcha | null {
  return curvas.find(c => c.material === (material ?? 'NM22') && c.via === via) ?? null;
}
