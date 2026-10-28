// Estado del esquemático en un instante: posición de cada tren e intervalos activos.
import type { Esquematico, ElementoRef } from './types';
import type { EjePk } from './resolver';
import { type Intervalo, type ModeloEventos, type Parada, type Tren, indiceEvento, numeroEn } from './eventos';
import { type CurvaMarcha, curvaDe, pkEnTramo } from './marcha';
import { STATION_PK } from '../../data/stationPK';

export const HUECO_MAX_MS = 15 * 60 * 1000;     // más de esto entre paradas: sin datos de posición
export const VIGENCIA_MS = 20 * 60 * 1000;      // tras el último evento el tren se deja de mostrar
export const DESTELLO_MS = 20 * 1000;           // ventana de "eventos recientes"

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

/** y de la vía V1/V2 (o la indicada) en la x dada; null si no hay vía con ese nombre ahí. */
export function yDeVia(data: Esquematico, via: string, x: number): number | null {
  let mejor: number | null = null;
  for (const v of data.vias) {
    if (v.via !== via) continue;
    const [x0, y0, x1, y1] = v.pts;
    if (x < Math.min(x0, x1) - 0.5 || x > Math.max(x0, x1) + 0.5) continue;
    const y = x1 === x0 ? (y0 + y1) / 2 : y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
    if (mejor == null || Math.abs(y1 - y0) < 0.01) mejor = y;
  }
  return mejor;
}

export interface PosTren {
  tren: Tren;
  numero: string | null;
  pk: number;
  via: number;
  x: number;
  y: number;
  enAnden: boolean;
  estCodigo: string | null;
  sentido: 'OBS' | 'PAN';
  vigente: boolean;          // false: dato viejo (hueco o fin de datos)
  ultimo: Parada;
}

function buscarParada(ps: Parada[], t: number): number {
  let lo = 0, hi = ps.length - 1, r = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (ps[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1;
  }
  return r;
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
export function posicionTren(ctx: Contexto, mod: ModeloEventos, tren: Tren, t: number): PosTren | null {
  const ps = tren.paradas;
  const i = buscarParada(ps, t);
  if (i < 0) return null;
  const p = ps[i];
  if (t - p.t > VIGENCIA_MS && i === ps.length - 1) return null;
  const numero = numeroEn(mod, tren, t);
  const sentido: 'OBS' | 'PAN' = p.via === 1 ? 'OBS' : 'PAN';
  const pkA = ctx.pkEst(p.est, p.via);
  if (pkA == null) return null;
  // detenido en andén: llegada y todavía no salió
  if (p.tipo === 'arr') {
    const sig = ps[i + 1];
    const vigente = !sig || sig.t - p.t < HUECO_MAX_MS;
    const cod = ctx.codigoEst(p.est);
    const u = ubicar(ctx, pkA, p.via, cod, true);
    return u ? { tren, numero, pk: pkA, via: p.via, ...u, enAnden: true, estCodigo: cod, sentido, vigente, ultimo: p } : null;
  }
  // en marcha: hacia la siguiente parada en otra estación
  let k = i + 1;
  while (k < ps.length && ps[k].est === p.est && ps[k].tipo === 'dep') k++;
  const q = ps[k];
  if (!q || q.t - p.t > HUECO_MAX_MS) {
    const cod = ctx.codigoEst(p.est);
    const u = ubicar(ctx, pkA, p.via, cod, false);
    return u ? { tren, numero, pk: pkA, via: p.via, ...u, enAnden: false, estCodigo: cod, sentido, vigente: false, ultimo: p } : null;
  }
  const pkB = ctx.pkEst(q.est, q.via) ?? pkA;
  const frac = (t - p.t) / Math.max(1, q.t - p.t);
  const c = curvaDe(ctx.curvas, tren.material, p.via === 1 ? 'V1' : 'V2');
  const pk = pkEnTramo(c, pkA, pkB, frac);
  const u = ubicar(ctx, pk, p.via, null, false);
  return u ? { tren, numero, pk, via: p.via, ...u, enAnden: false, estCodigo: null, sentido, vigente: true, ultimo: p } : null;
}

export function posicionesEn(ctx: Contexto, mod: ModeloEventos, t: number): PosTren[] {
  const out: PosTren[] = [];
  for (const tr of mod.trenes) {
    const p = posicionTren(ctx, mod, tr, t);
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

export interface EstadoInstante {
  t: number;
  trenes: PosTren[];
  activos: Intervalo[];
  porElemento: Map<string, Intervalo['tipo'][]>;   // refKey → tipos de intervalo activos
  recientes: Map<string, number>;                  // refKey → edad (ms) del evento más reciente
  ixlCaidos: Set<string>;
  degradados: Set<string>;                         // números de servicio degradados
  ihm: { ihm: string; areas: string[]; usuario: string | null; servidor: string | null }[];
}

export function estadoEn(ctx: Contexto, mod: ModeloEventos, t: number): EstadoInstante {
  const activos = intervalosActivos(mod, t);
  const porElemento = new Map<string, Intervalo['tipo'][]>();
  const ixlCaidos = new Set<string>();
  const degradados = new Set<string>();
  for (const iv of activos) {
    for (const r of iv.refs) {
      const k = refKey(r);
      porElemento.set(k, [...(porElemento.get(k) ?? []), iv.tipo]);
    }
    if (iv.tipo === 'ixl') ixlCaidos.add(iv.clave.replace(/^IXL /, ''));
    if (iv.tipo === 'degradado' && iv.numero) degradados.add(iv.numero);
  }
  const recientes = new Map<string, number>();
  for (let i = indiceEvento(mod.eventos, t - DESTELLO_MS); i < mod.eventos.length && mod.eventos[i].t <= t; i++) {
    const e = mod.eventos[i];
    if (e.cat === 'movimiento') continue;
    for (const r of e.refs) recientes.set(refKey(r), t - e.t);
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
  return {
    t, trenes: posicionesEn(ctx, mod, t), activos, porElemento, recientes, ixlCaidos, degradados,
    ihm: [...porIhm.entries()]
      .map(([ihm, areas]) => ({ ihm, areas: areas.sort(), usuario: usuario.get(ihm) ?? null, servidor: servidor.get(ihm) ?? null }))
      .sort((a, b) => a.ihm.localeCompare(b.ihm, undefined, { numeric: true })),
  };
}

/** Recorrido real de un tren para el diagrama de hilo: tramos continuos de puntos (t, pk). */
export function recorridoReal(ctx: Contexto, tren: Tren, muestras = 6): { t: number; pk: number; via: number }[][] {
  const out: { t: number; pk: number; via: number }[][] = [];
  let tramo: { t: number; pk: number; via: number }[] = [];
  const ps = tren.paradas;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const pk = ctx.pkEst(p.est, p.via);
    if (pk == null) continue;
    const ant = tramo[tramo.length - 1];
    if (ant && p.t - ant.t > HUECO_MAX_MS) { if (tramo.length > 1) out.push(tramo); tramo = []; }
    if (ant && (p.tipo === 'arr' || p.tipo === 'skip') && Math.abs(pk - ant.pk) > 1) {
      const c = curvaDe(ctx.curvas, tren.material, p.via === 1 ? 'V1' : 'V2');
      for (let k = 1; k < muestras; k++) {
        const fr = k / muestras;
        tramo.push({ t: ant.t + fr * (p.t - ant.t), pk: pkEnTramo(c, ant.pk, pk, fr), via: p.via });
      }
    }
    tramo.push({ t: p.t, pk, via: p.via });
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
