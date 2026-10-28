// Estado del esquemático en un instante: posición de cada tren, intervalos activos, itinerarios y deslizamientos.
import type { Esquematico, ElementoRef } from './types';
import type { EjePk } from './resolver';
import { type Intervalo, type ModeloEventos, type Tren, indiceEvento, numeroEn } from './eventos';
import { type CurvaMarcha, curvaDe, pkEnTramo } from './marcha';
import { type Recorrido, deslizamiento, itinerario, posicionesDeslizamiento } from './rutas';
import { STATION_PK } from '../../data/stationPK';

export const HUECO_MAX_MS = 15 * 60 * 1000;     // más de esto entre paradas: sin datos de posición
export const VIGENCIA_MS = 20 * 60 * 1000;      // tras el último evento el tren se deja de mostrar
export const DESTELLO_MS = 20 * 1000;           // ventana de "eventos recientes"
const RUTA_SIN_TREN_MS = 20 * 60 * 1000;        // ruta sin tren que la use: se deja de mostrar
const DESL_MAX_MS = 10 * 60 * 1000;
const DETENIDO_RADIO_M = 700;                   // asociación de "tren detenido" sin número al tren más cercano

export interface Contexto {
  data: Esquematico;
  eje: EjePk;
  curvas: CurvaMarcha[];
  pkEst: (est: number, via: number) => number | null;
  codigoEst: (est: number) => string | null;
}

export function crearContexto(data: Esquematico, eje: EjePk, curvas: CurvaMarcha[]): Contexto {
  const porTgmt = new Map<number, { codigo: string; tipo: 'estacion' | 'avc' }>();
  for (const e of data.estaciones) porTgmt.set(e.tgmt_id, { codigo: e.codigo, tipo: 'estacion' });
  for (const a of data.avc) if (a.tgmt_id != null) porTgmt.set(a.tgmt_id, { codigo: a.id, tipo: 'avc' });
  const cache = new Map<string, number | null>();
  const pkEst = (est: number, via: number) => {
    const k = `${est}|${via}`;
    if (cache.has(k)) return cache.get(k) as number | null;
    const r = porTgmt.get(est);
    let pk: number | null = null;
    if (r?.tipo === 'avc') {
      const a = data.avc.find(x => x.id === r.codigo);
      if (a && a.pk_ini != null && a.pk_fin != null) pk = (a.pk_ini + a.pk_fin) / 2;
      else if (a) pk = eje.pkAt(a.x);
    } else if (r) {
      const ps = data.andenes.filter(p => p.estacion === r.codigo && p.pk_centro != null);
      const propio = ps.find(p => p.ids.includes(`${r.codigo}${via}`)) ?? ps.find(p => p.via === `V${via}`);
      if (propio) pk = propio.pk_centro as number;
      else if (ps.length) pk = ps.reduce((s, p) => s + (p.pk_centro as number), 0) / ps.length;
      else {
        const e = data.estaciones.find(x => x.codigo === r.codigo);
        if (e?.x != null) pk = eje.pkAt(e.x);
      }
    }
    cache.set(k, pk);
    return pk;
  };
  const codigoEst = (est: number) => porTgmt.get(est)?.codigo ?? null;
  return { data, eje, curvas, pkEst, codigoEst };
}

/** y de la vía V1/V2 (o la indicada) en la x dada; también tramos compartidos ('V1/VZ'); null si no pasa por ahí. */
export function yDeVia(data: Esquematico, via: string, x: number): number | null {
  let mejor: { y: number; nota: number } | null = null;
  for (const v of data.vias) {
    const exacta = v.via === via;
    if (!exacta && !v.via.split('/').includes(via)) continue;
    const [x0, y0, x1, y1] = v.pts;
    if (x < Math.min(x0, x1) - 0.5 || x > Math.max(x0, x1) + 0.5) continue;
    const y = x1 === x0 ? (y0 + y1) / 2 : y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
    const nota = (exacta ? 0 : 2) + (Math.abs(y1 - y0) < 0.01 ? 0 : 1);
    if (!mejor || nota < mejor.nota) mejor = { y, nota };
  }
  return mejor?.y ?? null;
}

/** y del recorrido de una ruta en la x dada (null si la ruta no pasa por esa x). */
export function yEnRecorrido(rec: { tramos: [number, number, number, number][] }, x: number): number | null {
  for (const [x0, y0, x1, y1] of rec.tramos) {
    if (x < x0 - 0.3 || x > x1 + 0.3) continue;
    return x1 === x0 ? (y0 + y1) / 2 : y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
  }
  return null;
}

/** y de la vía más cercana a un punto (p. ej. el rótulo de un AVC) en la x dada. */
function yViaCercana(data: Esquematico, x: number, yRef: number): number | null {
  let mejor: number | null = null;
  for (const v of data.vias) {
    const [x0, y0, x1, y1] = v.pts;
    if (x < x0 - 0.5 || x > x1 + 0.5) continue;
    const y = x1 === x0 ? (y0 + y1) / 2 : y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
    if (mejor == null || Math.abs(y - yRef) < Math.abs(mejor - yRef)) mejor = y;
  }
  return mejor;
}

// ───────────────────────── trayectos ─────────────────────────

export interface PuntoTrayecto {
  t: number;
  tipo: 'arr' | 'dep' | 'skip';
  pk: number;
  via: number;
  est: number | null;                                 // id TGMT (andén / AVC); null en un CDV intermedio
  cdv?: { ref: ElementoRef; x: number; y: number };   // detenido en un CDV (alarma "tren detenido")
  pos?: { x: number; y: number };                     // lugar fijo de la parada (AVC, o vía de la ruta por la que llegó)
}

/** Punto donde queda la cabeza de un tren detenido en una sección / CDV: el extremo de salida en su sentido de
 *  marcha (10 m antes), sobre la vía de la sección. */
export function puntoDeDetencion(ctx: Contexto, ref: ElementoRef, haciaObs: boolean): { x: number; y: number; pk: number } | null {
  const el = ref.tipo === 'seccion' ? ctx.data.secciones.find(s => s.id === ref.id) : ref.tipo === 'cdv' ? ctx.data.cdvs.find(c => c.id === ref.id) : null;
  if (!el || !el.tramos.length) return null;
  const t = el.tramos.reduce((m, q) => (Math.abs(q[2] - q[0]) > Math.abs(m[2] - m[0]) ? q : m));
  const xa = Math.min(t[0], t[2]), xb = Math.max(t[0], t[2]);
  const pa = ctx.eje.pkAt(xa), pb = ctx.eje.pkAt(xb);
  if (pa == null || pb == null) return null;
  const pMin = Math.min(pa, pb), pMax = Math.max(pa, pb);
  const centro = (pMin + pMax) / 2;
  const pk = haciaObs ? Math.max(centro, pMax - 10) : Math.min(centro, pMin + 10);
  const x = ctx.eje.xAt(pk);
  if (x == null) return null;
  const y = yEnRecorrido({ tramos: [[xa, xa === t[0] ? t[1] : t[3], xb, xb === t[2] ? t[3] : t[1]]] }, x) ?? (t[1] + t[3]) / 2;
  return { x, y, pk };
}

/** Ubicación de una sección / CDV: centro de su tramo más largo, PK y vía principal (1/2) si la tiene. */
export function lugarDeVia(ctx: Contexto, ref: ElementoRef): { x: number; y: number; pk: number; via: number | null } | null {
  const el = ref.tipo === 'seccion' ? ctx.data.secciones.find(s => s.id === ref.id) : ref.tipo === 'cdv' ? ctx.data.cdvs.find(c => c.id === ref.id) : null;
  if (!el || !el.tramos.length) return null;
  const t = el.tramos.reduce((m, q) => (Math.abs(q[2] - q[0]) > Math.abs(m[2] - m[0]) ? q : m));
  const x = (t[0] + t[2]) / 2, y = (t[1] + t[3]) / 2;
  const pk = ctx.eje.pkAt(x);
  if (pk == null) return null;
  const vs = el.vias.flatMap(v => v.split('/'));
  const via = vs.includes('V1') && !vs.includes('V2') ? 1 : vs.includes('V2') && !vs.includes('V1') ? 2 : null;
  return { x, y, pk, via };
}

function buscarPunto(ps: { t: number }[], t: number): number {
  let lo = 0, hi = ps.length - 1, r = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (ps[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1;
  }
  return r;
}

function trayectoBase(ctx: Contexto, tren: Tren): PuntoTrayecto[] {
  const out: PuntoTrayecto[] = [];
  for (const p of tren.paradas) {
    const pk = ctx.pkEst(p.est, p.via);
    if (pk != null) out.push({ t: p.t, tipo: p.tipo, pk, via: p.via, est: p.est });
  }
  return out;
}

/** PK del tren en t sobre un trayecto (sin ubicar en el lienzo). */
function pkEn(ctx: Contexto, tren: Tren, ps: PuntoTrayecto[], t: number): { pk: number; via: number; parado: boolean; i: number } | null {
  const i = buscarPunto(ps, t);
  if (i < 0) return null;
  const p = ps[i];
  if (t - p.t > VIGENCIA_MS && i === ps.length - 1) return null;
  if (p.tipo === 'arr') return { pk: p.pk, via: p.via, parado: true, i };
  let k = i + 1;
  while (k < ps.length && ps[k].pk === p.pk && ps[k].tipo !== 'arr') k++;
  const q = ps[k];
  if (!q || q.t - p.t > HUECO_MAX_MS) return { pk: p.pk, via: p.via, parado: false, i };
  const c = curvaDe(ctx.curvas, tren.material, p.via === 1 ? 'V1' : 'V2');
  return { pk: pkEnTramo(c, p.pk, q.pk, (t - p.t) / Math.max(1, q.t - p.t)), via: p.via, parado: false, i };
}

// ───────────────────────── itinerarios y deslizamientos ─────────────────────────

export interface RutaActiva {
  id: string;
  origen: string;
  destino: string;
  t0: number;
  t1: number | null;
  fin: string;                // cómo terminó: cancelada, nueva ruta, pasó el tren (estimado)…
  rec: Recorrido | null;      // null: no se encontró recorrido en el plano
  tren: string | null;        // tren que la usa (estimado por paso por la señal origen)
}

export interface DeslActivo {
  id: string;
  senal: string;
  comando: string;
  t0: number;
  t1: number | null;
  fin: string;
  rec: Recorrido | null;
  tren: string | null;
}

export interface Replay {
  ctx: Contexto;
  mod: ModeloEventos;
  tray: Map<string, PuntoTrayecto[]>;
  rutas: RutaActiva[];
  desl: DeslActivo[];
}

/** Primer paso de un tren por un PK en un sentido (PK creciente = hacia OBS) entre t0 y t1. */
function primerPaso(rep: { ctx: Contexto; mod: ModeloEventos; tray: Map<string, PuntoTrayecto[]> }, pk: number, haciaObs: boolean,
  t0: number, t1: number): { tren: string; t: number } | null {
  let mejor: { tren: string; t: number } | null = null;
  for (const tr of rep.mod.trenes) {
    const ps = rep.tray.get(tr.clave) ?? [];
    let i = Math.max(0, buscarPunto(ps, t0));
    for (; i < ps.length - 1 && ps[i].t <= (mejor?.t ?? t1); i++) {
      const p = ps[i], q = ps[i + 1];
      if (p.tipo === 'arr' && q.pk === p.pk) continue;
      if (q.t - p.t > HUECO_MAX_MS || q.pk === p.pk) continue;
      if ((q.pk > p.pk) !== haciaObs) continue;
      if ((p.pk - pk) * (q.pk - pk) > 0) continue;
      const t = p.t + ((pk - p.pk) / (q.pk - p.pk)) * (q.t - p.t);
      if (t < t0 || t > t1) continue;
      if (!mejor || t < mejor.t) mejor = { tren: tr.clave, t };
      break;
    }
  }
  return mejor;
}

/** Primera llegada de un tren a una parada a menos de `radio` m antes de un PK (en el sentido de marcha). */
function primeraLlegadaAntes(rep: { mod: ModeloEventos; tray: Map<string, PuntoTrayecto[]> }, pk: number, haciaObs: boolean,
  radio: number, t0: number, t1: number): { tren: string; t: number } | null {
  let mejor: { tren: string; t: number } | null = null;
  for (const tr of rep.mod.trenes) {
    const ps = rep.tray.get(tr.clave) ?? [];
    for (let i = Math.max(1, buscarPunto(ps, t0)); i < ps.length && ps[i].t <= (mejor?.t ?? t1); i++) {
      const q = ps[i], p = ps[i - 1];
      if (q.tipo !== 'arr' || q.t < t0 || (q.pk > p.pk) !== haciaObs) continue;
      const d = haciaObs ? pk - q.pk : q.pk - pk;
      if (d >= -20 && d <= radio) { mejor = { tren: tr.clave, t: q.t }; break; }
    }
  }
  return mejor;
}

function pkSenal(ctx: Contexto, id: string): { pk: number; haciaObs: boolean } | null {
  const s = ctx.data.senales.find(x => x.id === id);
  if (!s || !s.sentido) return null;
  const pk = s.pk ?? ctx.eje.pkAt(s.x);
  return pk == null ? null : { pk, haciaObs: s.sentido === 'OBS' };   // OBS: x decreciente = PK creciente
}

function construirRutas(rep: Omit<Replay, 'rutas' | 'desl'>): RutaActiva[] {
  const { ctx, mod } = rep;
  const cacheRec = new Map<string, Recorrido | null>();
  const rutas: RutaActiva[] = [];
  const activa = new Map<string, RutaActiva>();
  const terminar = (r: RutaActiva | undefined, t: number, fin: string) => { if (r && (r.t1 == null || t < r.t1)) { r.t1 = t; r.fin = fin; } };
  for (const c of mod.itinerarios) {
    if (c.accion !== 'establecer') { terminar(activa.get(c.origen), c.t, c.accion === 'cancelar' ? 'cancelada' : 'cancelada (emergencia)'); activa.delete(c.origen); continue; }
    if (!c.destino) continue;
    const k = `${c.origen}>${c.destino}`;
    const previa = activa.get(c.origen);
    if (previa && previa.destino === c.destino && (previa.t1 == null || previa.t1 > c.t)) continue;   // misma ruta repetida
    if (!cacheRec.has(k)) cacheRec.set(k, itinerario(ctx.data, c.origen, c.destino));
    const rec = cacheRec.get(k) ?? null;
    terminar(previa, c.t, 'reemplazada por otra ruta desde la misma señal');
    // el enclavamiento no admite rutas en conflicto: las que comparten secciones ya se liberaron
    if (rec) {
      for (const [o, otra] of activa) {
        if (o === c.origen || !otra.rec || (otra.t1 != null && otra.t1 <= c.t)) continue;
        if (otra.rec.secciones.some(x => rec.secciones.includes(x))) terminar(otra, c.t, 'liberada (ruta en conflicto establecida)');
      }
    }
    const r: RutaActiva = { id: `${k}@${c.t}`, origen: c.origen, destino: c.destino, t0: c.t, t1: null, fin: '', rec, tren: null };
    const so = pkSenal(ctx, c.origen), sd = pkSenal(ctx, c.destino);
    if (so) {
      const paso = primerPaso(rep, so.pk, so.haciaObs, c.t, c.t + RUTA_SIN_TREN_MS);
      if (paso) {
        r.tren = paso.tren;
        const ps = rep.tray.get(paso.tren) ?? [];
        // se libera cuando el tren pasa la señal destino o llega a su próxima parada (lo primero)
        const pasoDest = sd ? primerPaso({ ...rep, mod: { ...mod, trenes: mod.trenes.filter(t => t.clave === paso.tren) } }, sd.pk, sd.haciaObs, paso.t, paso.t + RUTA_SIN_TREN_MS) : null;
        const llegada = ps.find(p => p.t > paso.t && p.tipo === 'arr');
        const tFin = Math.min(pasoDest?.t ?? Infinity, llegada?.t ?? Infinity);
        terminar(r, Number.isFinite(tFin) ? tFin + 20e3 : c.t + RUTA_SIN_TREN_MS, 'pasó el tren (estimado)');
      } else terminar(r, c.t + RUTA_SIN_TREN_MS, 'sin tren en 20 min (estimado)');
    } else terminar(r, c.t + RUTA_SIN_TREN_MS, 'sin datos de la señal origen');
    rutas.push(r);
    activa.set(c.origen, r);
  }
  return rutas;
}

function construirDesl(rep: Omit<Replay, 'rutas' | 'desl'>): DeslActivo[] {
  const { ctx, mod } = rep;
  const cache = new Map<string, Recorrido | null>();
  const out: DeslActivo[] = [];
  const activo = new Map<string, DeslActivo>();
  const terminar = (d: DeslActivo | undefined, t: number, fin: string) => { if (d && (d.t1 == null || t < d.t1)) { d.t1 = t; d.fin = fin; } };
  for (const c of mod.deslizamientos) {
    terminar(activo.get(c.senal), c.t, c.cancelar ? 'cancelado' : 'reemplazado');
    activo.delete(c.senal);
    if (c.cancelar) continue;
    const k = `${c.comando}|${c.senal}`;
    if (!cache.has(k)) cache.set(k, deslizamiento(ctx.data, c.senal, posicionesDeslizamiento(c.comando)));
    const d: DeslActivo = { id: `${k}@${c.t}`, senal: c.senal, comando: c.comando, t0: c.t, t1: null, fin: '', rec: cache.get(k) ?? null, tren: null };
    const s = pkSenal(ctx, c.senal);
    if (s) {
      // se libera cuando el tren se detiene antes de la señal (temporizado) o la rebasa
      const llegada = primeraLlegadaAntes(rep, s.pk, s.haciaObs, 400, c.t, c.t + DESL_MAX_MS);
      const paso = primerPaso(rep, s.pk, s.haciaObs, c.t, c.t + DESL_MAX_MS);
      const cand = [llegada && { ...llegada, t: llegada.t + 45e3 }, paso && { ...paso, t: paso.t + 30e3 }].filter(Boolean) as { tren: string; t: number }[];
      const prim = cand.sort((a, b) => a.t - b.t)[0];
      if (prim) { d.tren = prim.tren; terminar(d, prim.t, 'liberado al detenerse o pasar el tren (estimado)'); }
      else terminar(d, c.t + DESL_MAX_MS, 'sin tren en 10 min (estimado)');
    } else terminar(d, c.t + DESL_MAX_MS, 'sin datos de la señal');
    out.push(d);
    activo.set(c.senal, d);
  }
  return out;
}

/** Trayectos de los trenes (paradas TGMT + detenciones en CDV), itinerarios y deslizamientos con su vigencia. */
export function prepararReplay(ctx: Contexto, mod: ModeloEventos): Replay {
  const tray = new Map<string, PuntoTrayecto[]>();
  for (const tr of mod.trenes) tray.set(tr.clave, trayectoBase(ctx, tr));
  const porClave = new Map(mod.trenes.map(t => [t.clave, t]));

  // detenciones: se asocia cada alarma "tren detenido" a un tren (por número o el más cercano) y, si el tren
  // estaba entre estaciones, su CDV pasa a ser un punto de parada del trayecto
  const extra = new Map<string, PuntoTrayecto[]>();
  for (const iv of mod.intervalos) {
    if (iv.tipo !== 'detenido' || !iv.refs.length) continue;
    const lugar = lugarDeVia(ctx, iv.refs[0]);
    if (!lugar) continue;
    let tren: Tren | null = null;
    if (iv.numero) tren = mod.trenes.find(t => numeroEn(mod, t, iv.t0) === iv.numero) ?? null;
    let base = tren ? pkEn(ctx, tren, tray.get(tren.clave) ?? [], iv.t0) : null;
    if (!tren) {
      let mejor = DETENIDO_RADIO_M;
      for (const t of mod.trenes) {
        const p = pkEn(ctx, t, tray.get(t.clave) ?? [], iv.t0);
        if (!p || (lugar.via != null && p.via !== lugar.via)) continue;
        const d = Math.abs(p.pk - lugar.pk);
        if (d < mejor) { mejor = d; tren = t; base = p; }
      }
    }
    if (!tren || !base) continue;
    iv.tren ??= tren.clave;
    const ps = tray.get(tren.clave) ?? [];
    const tFin = iv.tN ?? iv.t1 ?? iv.t0 + 60e3;
    if (base.parado && Math.abs(base.pk - lugar.pk) < 250) continue;            // ya está detenido en el andén
    const p = ps[base.i], q = ps.slice(base.i + 1).find(x => x.pk !== p.pk);
    if (!q || q.t <= tFin) continue;                                           // hay otra parada durante la detención
    const enMedio = (lugar.pk - p.pk) * (lugar.pk - q.pk) <= 0 || Math.abs(lugar.pk - p.pk) < 120;
    if (!enMedio) continue;
    const parada = puntoDeDetencion(ctx, iv.refs[0], q.pk > p.pk) ?? lugar;
    const cdv = { ref: iv.refs[0], x: parada.x, y: parada.y };
    const l = extra.get(tren.clave) ?? [];
    l.push({ t: iv.t0, tipo: 'arr', pk: parada.pk, via: p.via, est: null, cdv }, { t: tFin, tipo: 'dep', pk: parada.pk, via: p.via, est: null, cdv });
    extra.set(tren.clave, l);
  }
  for (const [clave, l] of extra) {
    if (!porClave.has(clave)) continue;
    tray.set(clave, [...(tray.get(clave) ?? []), ...l].sort((a, b) => a.t - b.t));
  }
  const base = { ctx, mod, tray };
  const rutas = construirRutas(base);
  fijarParadas(ctx, tray, rutas);
  return { ...base, rutas, desl: construirDesl(base) };
}

/**
 * Lugar de cada parada en el lienzo: la vía de la ruta por la que llegó el tren (andenes de terminal, colas de
 * maniobra) o, en un AVC, la vía más cercana a su rótulo. La salida desde el mismo lugar hereda la posición.
 */
function fijarParadas(ctx: Contexto, tray: Map<string, PuntoTrayecto[]>, rutas: RutaActiva[]) {
  for (const r of rutas) {
    if (!r.tren || !r.rec) continue;
    const xs = r.rec.tramos.flatMap(t => [t[0], t[2]]);
    const xa = Math.min(...xs), xb = Math.max(...xs);
    const tFin = (r.t1 ?? r.t0) + 90e3;
    for (const p of tray.get(r.tren) ?? []) {
      if (p.tipo !== 'arr' || p.cdv || p.t < r.t0 || p.t > tFin) continue;
      const x = ctx.eje.xAt(p.pk);
      if (x == null || x < xa - 2 || x > xb + 2) continue;
      const y = yEnRecorrido(r.rec, Math.min(Math.max(x, xa), xb));
      if (y != null) p.pos = { x: Math.min(Math.max(x, xa), xb), y };
    }
  }
  for (const ps of tray.values()) {
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!p.pos && p.est != null && p.tipo === 'arr') {
        const cod = ctx.codigoEst(p.est);
        const avc = cod ? ctx.data.avc.find(a => a.id === cod) : undefined;
        const x = ctx.eje.xAt(p.pk);
        if (avc && x != null) { const y = yViaCercana(ctx.data, x, avc.y); if (y != null) p.pos = { x, y }; }
      }
      if (p.tipo === 'arr' && p.pos) {
        for (let k = i + 1; k < ps.length && ps[k].pk === p.pk && ps[k].tipo === 'dep'; k++) ps[k].pos ??= p.pos;
      }
    }
  }
}

// ───────────────────────── posición en el lienzo ─────────────────────────

export interface PosTren {
  tren: Tren;
  numero: string | null;
  pk: number;
  via: number;
  x: number;
  y: number;
  enAnden: boolean;
  estCodigo: string | null;
  cdv: ElementoRef | null;    // detenido en un CDV intermedio
  sentido: 'OBS' | 'PAN';
  vigente: boolean;           // false: dato viejo (hueco o fin de datos)
}

function ubicar(ctx: Contexto, pk: number, via: number, estCodigo: string | null, enAnden: boolean): { x: number; y: number } | null {
  const x = ctx.eje.xAt(pk);
  if (x == null) return null;
  if (enAnden && estCodigo) {
    const a = ctx.data.andenes.find(p => p.estacion === estCodigo && p.ids.includes(`${estCodigo}${via}`));
    if (a) return { x: Math.min(Math.max(x, a.x0), a.x1), y: a.y_via };
  }
  const y = yDeVia(ctx.data, `V${via}`, x) ?? yDeVia(ctx.data, via === 1 ? 'V2' : 'V1', x);
  if (y != null) return { x, y };
  if (estCodigo) {
    const a = ctx.data.andenes.find(p => p.estacion === estCodigo);
    if (a) return { x, y: a.y_via };
  }
  return { x, y: via === 1 ? 208 : 248 };
}

/** Posición del tren en t (null si no hay datos para ese instante). */
export function posicionTren(rep: Replay, tren: Tren, t: number): PosTren | null {
  const { ctx, mod } = rep;
  const ps = rep.tray.get(tren.clave) ?? [];
  const i = buscarPunto(ps, t);
  if (i < 0) return null;
  const p = ps[i];
  if (t - p.t > VIGENCIA_MS && i === ps.length - 1) return null;
  const numero = numeroEn(mod, tren, t);
  const sentido: 'OBS' | 'PAN' = p.via === 1 ? 'OBS' : 'PAN';
  if (p.tipo === 'arr') {
    const sig = ps[i + 1];
    const vigente = !sig || sig.t - p.t < HUECO_MAX_MS;
    if (p.cdv) return { tren, numero, pk: p.pk, via: p.via, x: p.cdv.x, y: p.cdv.y, enAnden: false, estCodigo: null, cdv: p.cdv.ref, sentido, vigente: true };
    const cod = p.est != null ? ctx.codigoEst(p.est) : null;
    const u = p.pos ?? ubicar(ctx, p.pk, p.via, cod, true);
    return u ? { tren, numero, pk: p.pk, via: p.via, x: u.x, y: u.y, enAnden: true, estCodigo: cod, cdv: null, sentido, vigente } : null;
  }
  let k = i + 1;
  while (k < ps.length && ps[k].pk === p.pk && ps[k].tipo !== 'arr') k++;
  const q = ps[k];
  if (!q || q.t - p.t > HUECO_MAX_MS) {
    const cod = p.est != null ? ctx.codigoEst(p.est) : null;
    const u = p.pos ?? ubicar(ctx, p.pk, p.via, cod, false);
    return u ? { tren, numero, pk: p.pk, via: p.via, x: u.x, y: u.y, enAnden: false, estCodigo: cod, cdv: null, sentido, vigente: false } : null;
  }
  const c = curvaDe(ctx.curvas, tren.material, p.via === 1 ? 'V1' : 'V2');
  const fr = (t - p.t) / Math.max(1, q.t - p.t);
  const pk = pkEnTramo(c, p.pk, q.pk, fr);
  const x = ctx.eje.xAt(pk);
  if (x == null) return null;
  // 1) sobre la ruta establecida para este tren; 2) sobre su vía; 3) si sale o llega a otra vía (cola, andén de
  // terminal, CDV), pasa de una a otra a lo largo del tramo
  const ruta = rep.rutas.find(r => r.tren === tren.clave && r.rec && r.t0 <= t && (r.t1 == null || r.t1 > t) && yEnRecorrido(r.rec, x) != null);
  let y = ruta?.rec ? yEnRecorrido(ruta.rec, x) : null;
  if (y == null) {
    const yVia = (xx: number) => yDeVia(ctx.data, `V${p.via}`, xx) ?? yDeVia(ctx.data, p.via === 1 ? 'V2' : 'V1', xx);
    const pa = p.cdv ?? p.pos, pb = q.cdv ?? q.pos;
    const xa = pa?.x ?? ctx.eje.xAt(p.pk) ?? x, xb = pb?.x ?? ctx.eje.xAt(q.pk) ?? x;
    const ya = pa?.y ?? yVia(xa), yb = pb?.y ?? yVia(xb);
    const fuera = (pt: { x: number; y: number } | undefined) => !!pt && Math.abs((yVia(pt.x) ?? pt.y) - pt.y) > 2;
    if ((fuera(pa) || fuera(pb)) && ya != null && yb != null) {
      const f = xb === xa ? fr : Math.min(1, Math.max(0, (x - xa) / (xb - xa)));
      y = ya + f * (yb - ya);
    } else y = yVia(x) ?? (p.via === 1 ? 208 : 248);
  }
  return { tren, numero, pk, via: p.via, x, y, enAnden: false, estCodigo: null, cdv: null, sentido, vigente: true };
}

export function posicionesEn(rep: Replay, t: number): PosTren[] {
  const out: PosTren[] = [];
  for (const tr of rep.mod.trenes) {
    const p = posicionTren(rep, tr, t);
    if (p) out.push(p);
  }
  return out;
}

export function intervalosActivos(mod: ModeloEventos, t: number): Intervalo[] {
  return mod.intervalos.filter(iv => iv.t0 <= t && (iv.t1 == null || iv.t1 > t));
}

export function refKey(r: ElementoRef): string {
  return `${r.tipo}:${r.id}`;
}

/** Fase de un intervalo en t: activa, o normalizada y pendiente de reconocimiento del operador. */
export function faseEn(iv: Intervalo, t: number): 'activa' | 'pendiente' {
  return iv.tN != null && t >= iv.tN ? 'pendiente' : 'activa';
}

export interface Reciente { edad: number; rechazo: boolean }

export interface EstadoInstante {
  t: number;
  trenes: PosTren[];
  activos: Intervalo[];
  porElemento: Map<string, Intervalo[]>;           // refKey → intervalos activos sobre el elemento
  recientes: Map<string, Reciente>;                // refKey → edad del evento más reciente que lo nombra
  ixlCaidos: Set<string>;
  degradados: Set<string>;                         // números de servicio degradados
  ihm: { ihm: string; areas: string[]; usuario: string | null; servidor: string | null }[];
  rutas: RutaActiva[];
  desl: DeslActivo[];
}

export function estadoEn(rep: Replay, t: number): EstadoInstante {
  const { mod } = rep;
  const activos = intervalosActivos(mod, t);
  const porElemento = new Map<string, Intervalo[]>();
  const ixlCaidos = new Set<string>();
  const degradados = new Set<string>();
  for (const iv of activos) {
    for (const r of iv.refs) {
      const k = refKey(r);
      porElemento.set(k, [...(porElemento.get(k) ?? []), iv]);
    }
    if (iv.tipo === 'ixl') ixlCaidos.add(iv.clave.replace(/^IXL /, ''));
    if (iv.tipo === 'degradado' && iv.numero && faseEn(iv, t) === 'activa') degradados.add(iv.numero);
  }
  const recientes = new Map<string, Reciente>();
  for (let i = indiceEvento(mod.eventos, t - DESTELLO_MS); i < mod.eventos.length && mod.eventos[i].t <= t; i++) {
    const e = mod.eventos[i];
    if (e.cat === 'movimiento' || e.plantilla === 'dbo' || e.plantilla === 'dbo_nocbtc') continue;
    for (const r of e.refs) recientes.set(refKey(r), { edad: t - e.t, rechazo: e.tipo === 'COMMAND_NACK' });
  }
  const area = new Map<string, string>();
  for (const a of mod.areasIhm) { if (a.t > t) break; area.set(a.area, a.ihm); }
  const usuario = new Map<string, string | null>();
  for (const s of mod.sesionesIhm) { if (s.t > t) break; usuario.set(s.ihm, s.usuario); }
  const servidor = new Map<string, string>();
  for (const s of mod.servidoresIhm) { if (s.t > t) break; servidor.set(s.ihm, s.servidor); }
  const porIhm = new Map<string, string[]>();
  for (const ih of [...usuario.keys(), ...servidor.keys()]) porIhm.set(ih, []);
  for (const [ar, ih] of area) porIhm.set(ih, [...(porIhm.get(ih) ?? []), ar]);
  const vigente = (x: { t0: number; t1: number | null }) => x.t0 <= t && (x.t1 == null || x.t1 > t);
  return {
    t, trenes: posicionesEn(rep, t), activos, porElemento, recientes, ixlCaidos, degradados,
    ihm: [...porIhm.entries()]
      .map(([ihm, areas]) => ({ ihm, areas: areas.sort(), usuario: usuario.get(ihm) ?? null, servidor: servidor.get(ihm) ?? null }))
      .sort((a, b) => a.ihm.localeCompare(b.ihm, undefined, { numeric: true })),
    rutas: rep.rutas.filter(vigente),
    desl: rep.desl.filter(vigente),
  };
}

/** Recorrido real de un tren para el diagrama de hilo: tramos continuos de puntos (t, pk). */
export function recorridoReal(rep: Replay, tren: Tren, muestras = 6): { t: number; pk: number; via: number }[][] {
  const out: { t: number; pk: number; via: number }[][] = [];
  let tramo: { t: number; pk: number; via: number }[] = [];
  const ps = rep.tray.get(tren.clave) ?? [];
  for (const p of ps) {
    const ant = tramo[tramo.length - 1];
    if (ant && p.t - ant.t > HUECO_MAX_MS) { if (tramo.length > 1) out.push(tramo); tramo = []; }
    if (ant && (p.tipo === 'arr' || p.tipo === 'skip') && Math.abs(p.pk - ant.pk) > 1) {
      const c = curvaDe(rep.ctx.curvas, tren.material, p.via === 1 ? 'V1' : 'V2');
      for (let k = 1; k < muestras; k++) {
        const fr = k / muestras;
        tramo.push({ t: ant.t + fr * (p.t - ant.t), pk: pkEnTramo(c, ant.pk, p.pk, fr), via: p.via });
      }
    }
    tramo.push({ t: p.t, pk: p.pk, via: p.via });
  }
  if (tramo.length > 1) out.push(tramo);
  return out;
}

/** Lleva un PK de la marcha tipo (src/data/stationPK) al PK del plano, tramo a tramo entre estaciones de la vía dada. */
export function mapaPkMarcha(ctx: Contexto, via: number): (pk: number) => number {
  const pares: [number, number][] = [];
  for (const e of ctx.data.estaciones) {
    const a = STATION_PK[e.codigo], b = ctx.pkEst(e.tgmt_id, via);
    if (a != null && b != null) pares.push([a, b]);
  }
  pares.sort((p, q) => p[0] - q[0]);
  return pk => {
    if (pares.length < 2) return pk;
    let i = 1;
    while (i < pares.length - 1 && pares[i][0] < pk) i++;
    const [a0, b0] = pares[i - 1], [a1, b1] = pares[i];
    return b0 + ((pk - a0) * (b1 - b0)) / (a1 - a0);
  };
}
