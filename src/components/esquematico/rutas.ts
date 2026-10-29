// Itinerarios y deslizamientos inferidos de la topología del plano de señalización (vías con sus nodos, agujas
// con talón / recta / desviada, señales con su vía y sentido). El log sólo da señal origen y destino, y el
// nombre del comando de deslizamiento (posición de las agujas): el recorrido sale de buscar en el grafo de vías.
// La tabla de itinerarios del enclavamiento permitiría confirmarlos.
import type { Esquematico, Tramo } from './types';

export type Sentido = 'PAN' | 'OBS';          // PAN: x creciente; OBS: x decreciente
export type PosAguja = 'normal' | 'invertida';

export interface AgujaEnRuta { id: string; pos: PosAguja; x: number; y: number }

export interface Recorrido {
  tramos: Tramo[];             // segmentos del recorrido (coordenadas del lienzo)
  agujas: AgujaEnRuta[];
  secciones: string[];         // secciones atravesadas
  largo: number;               // unidades de lienzo
}

interface Grafo {
  data: Esquematico;
  inc: Map<number, number[]>;                  // nodo → aristas
  agujaDeNodo: Map<number, Esquematico['agujas'][number]>;
  juntasDeArista: Map<number, number[]>;       // arista → x de las juntas que caen en ella
  seccionesDeArista: Map<number, { id: string; x0: number; x1: number }[]>;
}

const grafos = new WeakMap<Esquematico, Grafo>();

function sobreArista(t: Tramo, x: number, y: number, tol = 0.6): boolean {
  const [x0, y0, x1, y1] = t;
  if (x < x0 - tol || x > x1 + tol) return false;
  const yy = x1 === x0 ? y0 : y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
  return Math.abs(yy - y) < tol + 0.3;
}

export function grafoDe(data: Esquematico): Grafo {
  const g0 = grafos.get(data);
  if (g0) return g0;
  const inc = new Map<number, number[]>();
  for (const e of data.vias) {
    inc.set(e.a, [...(inc.get(e.a) ?? []), e.id]);
    inc.set(e.b, [...(inc.get(e.b) ?? []), e.id]);
  }
  const agujaDeNodo = new Map<number, Esquematico['agujas'][number]>();
  for (const a of data.agujas) if (a.nodo != null) agujaDeNodo.set(a.nodo, a);
  const juntasDeArista = new Map<number, number[]>();
  const seccionesDeArista = new Map<number, { id: string; x0: number; x1: number }[]>();
  for (const e of data.vias) {
    juntasDeArista.set(e.id, data.juntas.filter(j => sobreArista(e.pts, j.x, j.y)).map(j => j.x).sort((p, q) => p - q));
    const ss: { id: string; x0: number; x1: number }[] = [];
    for (const s of data.secciones) {
      for (const t of s.tramos) {
        const tx0 = Math.min(t[0], t[2]), tx1 = Math.max(t[0], t[2]);
        if (tx1 - tx0 < 0.05) continue;
        const xm = (tx0 + tx1) / 2, ym = (t[1] + t[3]) / 2;
        if (sobreArista(e.pts, xm, ym, 0.8)) ss.push({ id: s.id, x0: tx0, x1: tx1 });
      }
    }
    seccionesDeArista.set(e.id, ss);
  }
  const g = { data, inc, agujaDeNodo, juntasDeArista, seccionesDeArista };
  grafos.set(data, g);
  return g;
}

function yEn(t: Tramo, x: number): number {
  const [x0, y0, x1, y1] = t;
  return x1 === x0 ? y0 : y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
}

/** Aristas siguientes al llegar a un nodo por la arista `e`, respetando las agujas. */
function siguientes(g: Grafo, e: number, nodo: number): { e: number; aguja?: AgujaEnRuta }[] {
  const a = g.agujaDeNodo.get(nodo);
  if (a && a.talon_edge != null && a.recta_edge != null && a.desviada_edge != null) {
    const posDe = (rama: number): PosAguja => ((rama === a.recta_edge) === (a.normal !== 'desviada') ? 'normal' : 'invertida');
    const ag = (rama: number): AgujaEnRuta => ({ id: a.id, pos: posDe(rama), x: a.x ?? 0, y: a.y ?? 0 });
    if (e === a.talon_edge) return [{ e: a.recta_edge, aguja: ag(a.recta_edge) }, { e: a.desviada_edge, aguja: ag(a.desviada_edge) }];
    if (e === a.recta_edge || e === a.desviada_edge) return [{ e: a.talon_edge, aguja: ag(e) }];
    return [];
  }
  return (g.inc.get(nodo) ?? []).filter(x => x !== e).map(x => ({ e: x }));
}

/** Nodo de salida de una arista recorrida en un sentido. */
const salida = (g: Grafo, e: number, s: Sentido) => (s === 'PAN' ? g.data.vias[e].b : g.data.vias[e].a);
/** Arista que se recorre en el sentido indicado al salir de `nodo` (debe empezar en ese nodo). */
const empiezaEn = (g: Grafo, e: number, nodo: number, s: Sentido) => (s === 'PAN' ? g.data.vias[e].a === nodo : g.data.vias[e].b === nodo);

function tramoEntre(t: Tramo, xa: number, xb: number): Tramo {
  const a = Math.min(xa, xb), b = Math.max(xa, xb);
  return [a, yEn(t, a), b, yEn(t, b)];
}

function seccionesDe(g: Grafo, e: number, xa: number, xb: number): string[] {
  const a = Math.min(xa, xb), b = Math.max(xa, xb);
  // sólo las secciones que el recorrido atraviesa de verdad (no la que apenas toca junto a la señal)
  return (g.seccionesDeArista.get(e) ?? []).filter(s => Math.min(s.x1, b) - Math.max(s.x0, a) > 3).map(s => s.id);
}

/** Recorrido de la señal origen a la destino (la más corta que respeta el sentido de la señal origen). */
export function itinerario(data: Esquematico, origen: string, destino: string): Recorrido | null {
  const g = grafoDe(data);
  const so = data.senales.find(s => s.id === origen), sd = data.senales.find(s => s.id === destino);
  if (!so || !sd || so.edge == null || sd.edge == null) return null;
  const sentidos: Sentido[] = so.sentido ? [so.sentido] : ['PAN', 'OBS'];
  for (const s of sentidos) {
    const r = buscar(g, so.edge, so.x, s, e => (e === sd.edge ? sd.x : null));
    if (r) return r;
  }
  return null;
}

const PENAL_INVERTIDA = 400;   // costo extra por aguja en posición invertida: entre dos caminos posibles, el que va recto

/**
 * Busca desde (arista, x) en sentido s hasta que `fin(arista)` dé la x de llegada en esa arista. Dijkstra sobre el
 * largo recorrido más una penalización por cada aguja invertida (el enclavamiento usa la ruta directa cuando existe).
 */
function buscar(g: Grafo, e0: number, x0: number, s: Sentido, fin: (e: number) => number | null): Recorrido | null {
  const adelante = (xa: number, xb: number) => (s === 'PAN' ? xb >= xa - 0.01 : xb <= xa + 0.01);
  interface Estado { e: number; xEntrada: number; costo: number; prev: Estado | null; aguja?: AgujaEnRuta; xFin?: number }
  const cola: Estado[] = [{ e: e0, xEntrada: x0, costo: 0, prev: null }];
  const xf0 = fin(e0);
  if (xf0 != null && adelante(x0, xf0)) cola[0].xFin = xf0;
  const mejor = new Map<number, number>();
  let hallado: Estado | null = null;
  while (cola.length) {
    cola.sort((p, q) => p.costo - q.costo);
    const cur = cola.shift() as Estado;
    if (cur.xFin != null) { hallado = cur; break; }
    const v = g.data.vias[cur.e];
    const nodo = salida(g, cur.e, s);
    const xSal = s === 'PAN' ? v.pts[2] : v.pts[0];
    const costo = cur.costo + Math.abs(xSal - cur.xEntrada) + Math.abs(yEn(v.pts, xSal) - yEn(v.pts, cur.xEntrada)) * 0.2;
    if (costo > 6000) continue;
    for (const nx of siguientes(g, cur.e, nodo)) {
      if (!empiezaEn(g, nx.e, nodo, s)) continue;
      const xIn = s === 'PAN' ? g.data.vias[nx.e].pts[0] : g.data.vias[nx.e].pts[2];
      const c = costo + (nx.aguja?.pos === 'invertida' ? PENAL_INVERTIDA : 0);
      const xf = fin(nx.e);
      if (xf != null) {
        cola.push({ e: nx.e, xEntrada: xIn, costo: c + Math.abs(xf - xIn), prev: cur, aguja: nx.aguja, xFin: xf });
        continue;
      }
      if ((mejor.get(nx.e) ?? Infinity) <= c) continue;
      mejor.set(nx.e, c);
      cola.push({ e: nx.e, xEntrada: xIn, costo: c, prev: cur, aguja: nx.aguja });
    }
  }
  if (!hallado) return null;
  const cadena: Estado[] = [];
  for (let p: Estado | null = hallado; p; p = p.prev) cadena.unshift(p);
  const tramos: Tramo[] = [], agujas: AgujaEnRuta[] = [], secciones: string[] = [];
  let largo = 0;
  cadena.forEach((st, i) => {
    const v = g.data.vias[st.e];
    const xEnd = i === cadena.length - 1 ? (hallado as Estado).xFin as number : (s === 'PAN' ? v.pts[2] : v.pts[0]);
    if (Math.abs(xEnd - st.xEntrada) > 0.01) tramos.push(tramoEntre(v.pts, st.xEntrada, xEnd));
    largo += Math.abs(xEnd - st.xEntrada);
    if (st.aguja) agujas.push(st.aguja);
    for (const id of seccionesDe(g, st.e, st.xEntrada, xEnd)) if (!secciones.includes(id)) secciones.push(id);
  });
  return { tramos, agujas, secciones, largo };
}

/** Arista que pasa por (x, y) (la más cercana, a menos de `tol` en y). */
export function aristaEn(data: Esquematico, x: number, y: number, tol = 1.5): number | null {
  let mejor: { e: number; d: number } | null = null;
  for (const v of data.vias) {
    const [x0, , x1] = v.pts;
    if (x < x0 - 0.3 || x > x1 + 0.3) continue;
    const d = Math.abs(yEn(v.pts, Math.min(Math.max(x, x0), x1)) - y);
    if (d < tol && (!mejor || d < mejor.d)) mejor = { e: v.id, d };
  }
  return mejor?.e ?? null;
}

const caminos = new WeakMap<Esquematico, Map<string, Recorrido | null>>();

/**
 * Camino por las vías entre dos puntos del lienzo (p. ej. dos paradas de un tren), en el sentido de x de a hacia b:
 * el más corto con menos agujas invertidas. null si los puntos no están sobre una vía o no hay camino.
 */
export function caminoEntre(data: Esquematico, a: { x: number; y: number }, b: { x: number; y: number }): Recorrido | null {
  let m = caminos.get(data);
  if (!m) { m = new Map(); caminos.set(data, m); }
  const k = `${a.x.toFixed(1)},${a.y.toFixed(1)}>${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  if (m.has(k)) return m.get(k) ?? null;
  let r: Recorrido | null = null;
  const ea = aristaEn(data, a.x, a.y), eb = aristaEn(data, b.x, b.y);
  if (ea != null && eb != null && Math.abs(b.x - a.x) > 0.01) {
    r = buscar(grafoDe(data), ea, a.x, b.x > a.x ? 'PAN' : 'OBS', e => (e === eb ? b.x : null));
  }
  if (m.size > 20000) m.clear();
  m.set(k, r);
  return r;
}

/** Posiciones de agujas pedidas por el comando de deslizamiento (EstablecerDeslizamientoNormal1Invertido2 → N, I). */
export function posicionesDeslizamiento(comando: string): PosAguja[] {
  const m = /^EstablecerDeslizamiento(\w+)$/.exec(comando);
  if (!m) return [];
  const partes = m[1].match(/(Normal|Invertid[oa])\d?/g) ?? [];
  return partes.map(p => (p.startsWith('Normal') ? 'normal' : 'invertida'));
}

const LARGO_MAX_DESL = 140;   // unidades de lienzo (~ el largo de una sección de deslizamiento en el plano)

/**
 * Deslizamiento más allá de la señal: sigue en el sentido de la señal, toma las agujas en la posición pedida y
 * termina en la primera junta pasada la última aguja (o en la primera junta, si no hay agujas).
 */
export function deslizamiento(data: Esquematico, senal: string, posiciones: PosAguja[]): Recorrido | null {
  const g = grafoDe(data);
  const sd = data.senales.find(s => s.id === senal);
  if (!sd || sd.edge == null || !sd.sentido) return null;
  const s = sd.sentido;
  const tramos: Tramo[] = [], agujas: AgujaEnRuta[] = [], secciones: string[] = [];
  let e = sd.edge, x = sd.x, largo = 0, k = 0;
  for (let paso = 0; paso < 12; paso++) {
    const v = data.vias[e];
    const xSal = s === 'PAN' ? v.pts[2] : v.pts[0];
    const pendientes = k < posiciones.length;
    const juntas = (g.juntasDeArista.get(e) ?? []).filter(j => (s === 'PAN' ? j > x + 0.8 : j < x - 0.8));
    const jFin = pendientes ? null : (s === 'PAN' ? juntas[0] : juntas[juntas.length - 1]) ?? null;
    const xLim = s === 'PAN' ? x + (LARGO_MAX_DESL - largo) : x - (LARGO_MAX_DESL - largo);
    let xEnd = jFin ?? xSal;
    if (s === 'PAN' ? xEnd > xLim : xEnd < xLim) xEnd = xLim;
    tramos.push(tramoEntre(v.pts, x, xEnd));
    for (const id of seccionesDe(g, e, x, xEnd)) if (!secciones.includes(id)) secciones.push(id);
    largo += Math.abs(xEnd - x);
    if (xEnd !== xSal || largo >= LARGO_MAX_DESL) break;
    const nodo = salida(g, e, s);
    const ops = siguientes(g, e, nodo).filter(o => empiezaEn(g, o.e, nodo, s));
    if (!ops.length) break;
    let elegida = ops[0];
    if (ops.length > 1 || ops[0].aguja) {
      const want = posiciones[k] ?? 'normal';
      elegida = ops.find(o => o.aguja?.pos === want) ?? ops[0];
      if (elegida.aguja) { agujas.push(elegida.aguja); k++; }
    }
    e = elegida.e;
    x = s === 'PAN' ? data.vias[e].pts[0] : data.vias[e].pts[2];
  }
  return tramos.length ? { tramos, agujas, secciones, largo } : null;
}
