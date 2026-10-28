import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, ZoomIn, ZoomOut, Rows3, Layers, FileText, AlertTriangle, Info, FileImage, SplitSquareVertical } from 'lucide-react';
import type { ElementoRef, Esquematico, Fuente, Seccion, Tramo } from './types';
import {
  cajaDe, construirEjePk, construirIndice, fmtPk, perfilEn, rangoX, resolver, type Indice,
} from './resolver';
import {
  CAPAS_INICIALES, CDV_ALT, DET_H, FREQ_COLORS, G_GAP, G_ROW, G_SOLAPE, G_Y0, G_Y1, GRUPOS_CAPAS, IXL_COLORS, MODOS,
  SIN_DATO, TIPO_COLORS, VIA_IHM, Y_EST, Y_PK, Y_PK_G, colorVelocidad, type Capa, type Modo,
} from './constantes';
import {
  AgujaSvg, AndenSvg, ArmariosSvg, BalizasSvg, CartelesSvg, EquiposSvg, JuntasSvg, PendientesSvg, PlanoTiras,
  RotulosSvg, SenalSvg, SubestacionesSvg, TramosSvg, VelAgujasSvg, VelocidadSvg, ZonasSvg, type PlanoIndex,
} from './capas';
import { Detalle, Fuentes, Leyenda, Observaciones, Tooltip } from './paneles';
import { PlanoCdv } from './PlanoCdv';
import './EsquematicoL1.css';

// ───────────────────────── utilidades ─────────────────────────

function refKey(r: ElementoRef | null): string {
  return r ? `${r.tipo}:${r.id}` : '';
}

function tramoD(ts: Tramo[]): string {
  return ts.map(t => `M${t[0]} ${t[1]}L${t[2]} ${t[3]}`).join('');
}

function fuenteCorta(f?: Fuente): string {
  return f ? `${f.codigo} rev ${f.revision}` : '';
}

interface View { x: number; y: number; w: number; h: number }
type Vista = 'general' | 'detalle';
interface Filas { n: number; rowW: number; x0s: number[]; vw: number; vh: number }

function calcularFilas(area: [number, number, number, number], aspect: number): Filas {
  const L = area[2] - area[0];
  // número de filas que maximiza la escala dentro del contenedor (ancho 1, alto = aspect)
  let n = 2, mejor = 0;
  for (let k = 2; k <= 8; k++) {
    const vw = L / k + G_SOLAPE;
    const vh = k * G_ROW + (k - 1) * G_GAP;
    const sc = Math.min(1 / vw, aspect / vh);
    if (sc > mejor) { mejor = sc; n = k; }
  }
  const paso = L / n;
  const rowW = paso + G_SOLAPE;
  const x0s = Array.from({ length: n }, (_, i) => area[0] + i * paso - G_SOLAPE / 2);
  return { n, rowW, x0s, vw: rowW, vh: n * G_ROW + (n - 1) * G_GAP };
}

const PLANO_SEN = '/data/planos/sen_h1';
const PLANO_CDV = '/data/planos/cdv';

// ───────────────────────── componente ─────────────────────────

export const EsquematicoL1: React.FC = () => {
  const [data, setData] = useState<Esquematico | null>(null);
  const [idxSen, setIdxSen] = useState<PlanoIndex | null>(null);
  const [idxCdv, setIdxCdv] = useState<PlanoIndex | null>(null);
  const [error, setError] = useState('');
  const [modo, setModo] = useState<Modo>('ihm');
  const [capas, setCapas] = useState<Set<Capa>>(new Set(CAPAS_INICIALES));
  const [sel, setSel] = useState<ElementoRef | null>(null);
  const [hover, setHover] = useState<{ ref: ElementoRef; cx: number; cy: number } | null>(null);
  const [tab, setTab] = useState<'elemento' | 'fuentes' | 'observaciones' | 'leyenda'>('fuentes');
  const [busqueda, setBusqueda] = useState('');
  const [busquedaError, setBusquedaError] = useState('');
  const [showCapas, setShowCapas] = useState(false);
  const [showCdv, setShowCdv] = useState(false);
  const [planoClaro, setPlanoClaro] = useState(false);
  const [view, setView] = useState<View>({ x: 40, y: 100, w: 600, h: DET_H });
  const [vista, setVista] = useState<Vista>('general');
  const [aspect, setAspect] = useState(0.5);
  const [cursorPk, setCursorPk] = useState<number | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; v: View; moved: boolean } | null>(null);

  useEffect(() => {
    const bust = Date.now();
    fetch(`/data/esquematico_l1.json?v=${bust}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: Esquematico) => setData(d))
      .catch(e => setError(`No se pudo cargar el esquemático: ${e.message}`));
    fetch(`${PLANO_SEN}/index.json?v=${bust}`).then(r => (r.ok ? r.json() : null)).then(setIdxSen).catch(() => setIdxSen(null));
    fetch(`${PLANO_CDV}/index.json?v=${bust}`).then(r => (r.ok ? r.json() : null)).then(setIdxCdv).catch(() => setIdxCdv(null));
  }, []);

  const ix: Indice | null = useMemo(() => (data ? construirIndice(data) : null), [data]);
  const eje = useMemo(() => (data ? construirEjePk(data) : null), [data]);
  const fuentes = useMemo(() => new Map((data?.fuentes ?? []).map(f => [f.id, f])), [data]);
  const filas = useMemo(() => (data ? calcularFilas(data.lienzo.area, aspect) : null), [data, aspect]);

  // aspecto del lienzo = aspecto del contenedor
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !data) return;
    const medir = () => {
      const r = el.getBoundingClientRect();
      const a = r.height / Math.max(r.width, 1);
      setAspect(a);
      setView(v => ({ ...v, h: v.w * a }));
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data, showCdv]);

  const irADetalle = useCallback((cx: number, cy = 238) => {
    const w = DET_H / Math.max(aspect, 0.05);
    setView({ x: cx - w / 2, y: cy - DET_H / 2, w, h: DET_H });
    setVista('detalle');
  }, [aspect]);

  const encuadrar = useCallback((box: [number, number, number, number], minW = 120) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const asp = r.height / Math.max(r.width, 1);
    const [x0, y0, x1, y1] = box;
    let w = Math.max(minW, (x1 - x0) * 1.6, ((y1 - y0) * 1.6) / asp);
    w = Math.min(w, 9400);
    const h = w * asp;
    setView({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h });
    setVista('detalle');
  }, []);

  const seleccionar = useCallback((ref: ElementoRef | null, zoom = false) => {
    setSel(ref);
    if (ref) setTab('elemento');
    // si el elemento pertenece a una capa apagada, se enciende para que se vea
    const capasDe: Capa[] = !ref ? [] : ref.tipo === 'zona' ? [ref.id.startsWith('RAUZ') ? 'zonas_rauz' : 'zonas_asr']
      : ref.tipo === 'armario' ? ['armarios'] : ref.tipo === 'subestacion' ? ['subestaciones']
        : ref.tipo === 'baliza' ? ['balizas'] : ref.tipo === 'zona_velocidad' ? ['vel_zonas']
          : ref.tipo === 'junta' ? ['juntas_fisicas']
            : ref.tipo === 'equipo' ? (data?.equipos?.[Number(ref.id)]?.tipo === 'RESET' ? ['equipos', 'reset'] : ['equipos']) : [];
    if (capasDe.length) setCapas(s => (capasDe.every(c => s.has(c)) ? s : new Set([...s, ...capasDe])));
    if (ref && zoom && ix) {
      const b = cajaDe(ix, ref);
      if (b) encuadrar(b);
    }
  }, [ix, encuadrar, data]);

  // ── zoom / pan ──
  /** Pantalla → coordenadas del plano. En la vista general resuelve la fila; null si cae entre filas. */
  const toCanvas = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    if (vista === 'detalle') {
      return { x: view.x + ((clientX - r.left) / r.width) * view.w, y: view.y + ((clientY - r.top) / r.height) * view.h };
    }
    if (!filas) return null;
    const sc = Math.min(r.width / filas.vw, r.height / filas.vh);
    const vx = (clientX - r.left - (r.width - filas.vw * sc) / 2) / sc;
    const vy = (clientY - r.top - (r.height - filas.vh * sc) / 2) / sc;
    const i = Math.floor(vy / (G_ROW + G_GAP));
    const ly = vy - i * (G_ROW + G_GAP);
    if (i < 0 || i >= filas.n || ly > G_ROW || vx < 0 || vx > filas.vw) return null;
    return { x: filas.x0s[i] + vx, y: G_Y0 + ly };
  }, [vista, view, filas]);

  const toCanvasRef = useRef(toCanvas);
  const irADetalleRef = useRef(irADetalle);
  useEffect(() => { toCanvasRef.current = toCanvas; irADetalleRef.current = irADetalle; }, [toCanvas, irADetalle]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (vista === 'general') {
        const p = toCanvasRef.current(e.clientX, e.clientY);
        if (p && e.deltaY < 0) irADetalleRef.current(p.x);
        return;
      }
      const r = svg.getBoundingClientRect();
      const f = Math.exp(e.deltaY * 0.0015);
      setView(v => {
        const w = Math.min(9600, Math.max(15, v.w * f));
        const h = v.h * (w / v.w);
        const px = v.x + ((e.clientX - r.left) / r.width) * v.w;
        const py = v.y + ((e.clientY - r.top) / r.height) * v.h;
        return { x: px - ((px - v.x) * w) / v.w, y: py - ((py - v.y) * h) / v.h, w, h };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [data, vista, showCdv]);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, v: view, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = toCanvas(e.clientX, e.clientY);
    if (eje) setCursorPk(p ? eje.pkAt(p.x) : null);
    const d = drag.current;
    if (!d || !svgRef.current) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) {
      if (!d.moved && vista === 'detalle') svgRef.current.setPointerCapture?.(e.pointerId);
      d.moved = true;
    }
    if (vista === 'general') return;
    const r = svgRef.current.getBoundingClientRect();
    const dx = ((e.clientX - d.x) / r.width) * d.v.w;
    const dy = ((e.clientY - d.y) / r.height) * d.v.h;
    if (d.moved) setView({ ...d.v, x: d.v.x - dx, y: d.v.y - dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const p = toCanvas(e.clientX, e.clientY);
    if (vista === 'general') {
      if (p) irADetalle(p.x);
      return;
    }
    // clic en un punto vacío: inspector de PK
    if (hover == null && p && eje) {
      const pk = eje.pkAt(p.x);
      if (pk != null) seleccionar({ tipo: 'pk', id: String(Math.round(pk * 1000) / 1000) });
    }
  };
  const zoomBtn = (f: number) => setView(v => {
    const w = Math.min(9600, Math.max(15, v.w * f));
    const h = v.h * (w / v.w);
    return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h };
  });

  // ── colores por modo ──
  const cdvOrden = useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    const lst = [...data.cdvs].sort((a, b) => rangoX(a.tramos)[0] - rangoX(b.tramos)[0]);
    const porVia = new Map<string, number>();
    for (const c of lst) {
      const k = c.vias.join('|');
      const n = porVia.get(k) ?? 0;
      m.set(c.id, n);
      porVia.set(k, n + 1);
    }
    return m;
  }, [data]);

  // altura del nombre de estación: sobre la vía más alta de su zona de andenes (PAN y OBS tienen más vías)
  const yEstacion = useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    for (const e of data.estaciones) {
      const ps = data.andenes.filter(p => p.estacion === e.codigo);
      if (!ps.length) continue;
      const a = Math.min(...ps.map(p => p.x0)), b = Math.max(...ps.map(p => p.x1));
      const ys = data.vias.filter(v => Math.max(v.pts[0], v.pts[2]) >= a && Math.min(v.pts[0], v.pts[2]) <= b)
        .flatMap(v => [v.pts[1], v.pts[3]]);
      m.set(e.codigo, Math.min(Y_EST, (ys.length ? Math.min(...ys) : Y_EST + 9) - 9));
    }
    return m;
  }, [data]);

  const ixlDe = useMemo(() => new Map((data?.estaciones ?? []).map(e => [e.codigo, e.enclavamiento ?? null])), [data]);

  const velSeccion = useMemo(() => {
    const m = new Map<string, number | null>();
    if (!data?.perfil) return m;
    const zs = data.perfil.zonas_velocidad;
    for (const s of data.secciones) {
      const [a, b] = rangoX(s.tramos);
      const { velocidad } = perfilEn(data, s.vias, a, b);
      const vs = velocidad.map(z => z.v).filter((v): v is number => v != null);
      if (vs.length) { m.set(s.id, Math.min(...vs)); continue; }
      // fuera de toda zona: velocidad "fuera" de la zona más cercana de la misma vía
      const misma = zs.filter(z => z.via && s.vias.some(v => v.split('/').includes(z.via as string)) && z.v_fuera != null);
      const cerca = misma.sort((p, q) => Math.min(Math.abs(p.x0 - a), Math.abs(p.x1 - a)) - Math.min(Math.abs(q.x0 - a), Math.abs(q.x1 - a)))[0];
      m.set(s.id, cerca?.v_fuera ?? null);
    }
    return m;
  }, [data]);

  const colorSeccion = useCallback((s: Seccion): string => {
    const c = s.cdv ? ix?.cdv.get(s.cdv) : undefined;
    switch (modo) {
      case 'ihm': return VIA_IHM;
      case 'cdv': return c ? CDV_ALT[(cdvOrden.get(c.id) ?? 0) % CDV_ALT.length] : SIN_DATO;
      case 'frecuencia': return c?.frecuencia?.codigo ? FREQ_COLORS[c.frecuencia.codigo] ?? SIN_DATO : SIN_DATO;
      case 'tipo': return c?.tipo ? TIPO_COLORS[c.tipo] ?? SIN_DATO : SIN_DATO;
      case 'enclavamiento': {
        const ixl = s.estacion ? ixlDe.get(s.estacion) : null;
        return ixl ? IXL_COLORS[ixl] ?? SIN_DATO : SIN_DATO;
      }
      case 'velocidad': return colorVelocidad(velSeccion.get(s.id));
    }
  }, [modo, ix, cdvOrden, ixlDe, velSeccion]);

  // nivel de detalle según el ancho visible (unidades de lienzo)
  const effW = vista === 'general' && filas ? filas.rowW : view.w;
  const lod = {
    nombresSeccion: effW < 700,
    nombresCdv: effW < 1500,
    nombresSenal: effW < 1300,
    nombresAguja: effW < 1300,
    balizas: effW < 1600,
    idsBaliza: effW < 650,
    psp: effW < 600,
    detalle: effW < 400,
    lazos: effW < 520,
    velEtiquetas: effW < 1600,
    velNombres: effW < 420,
    pendientes: effW < 2600,
    pendEtiquetas: effW < 900,
    equiposTxt: effW < 1600,
    reset: effW < 900,
    zonasTxt: effW < 2600,
    armariosTxt: effW < 1100,
    seTxt: true,
    rotulos: effW < 2600,
    tramosTxt: effW < 2600,
  };

  // ── selección / resaltado ──
  const selKey = refKey(sel);
  const hoverKey = hover ? refKey(hover.ref) : '';
  const selCdv = useMemo(() => {
    if (!sel || !ix) return null;
    if (sel.tipo === 'cdv') return sel.id;
    if (sel.tipo === 'seccion') return ix.seccion.get(sel.id)?.cdv ?? null;
    return null;
  }, [sel, ix]);

  const hov = (ref: ElementoRef) => ({
    onPointerEnter: (e: React.PointerEvent) => setHover({ ref, cx: e.clientX, cy: e.clientY }),
    onPointerMove: (e: React.PointerEvent) => setHover({ ref, cx: e.clientX, cy: e.clientY }),
    onPointerLeave: () => setHover(h => (h && refKey(h.ref) === refKey(ref) ? null : h)),
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); if (!drag.current?.moved) seleccionar(ref); },
  });

  // ── capas estáticas (memo) ──
  const capaVias = useMemo(() => {
    if (!data) return null;
    return (
      <g className="esq-vias-base">
        {data.vias.map(v => <line key={v.id} x1={v.pts[0]} y1={v.pts[1]} x2={v.pts[2]} y2={v.pts[3]} />)}
      </g>
    );
  }, [data]);

  const capaSecciones = useMemo(() => {
    if (!data) return null;
    return (
      <g>
        {data.secciones.map(s => <path key={s.id} d={tramoD(s.tramos)} stroke={colorSeccion(s)} className="esq-seccion" />)}
      </g>
    );
  }, [data, colorSeccion]);

  if (error) return <div className="esq-page"><div className="esq-error">{error}</div></div>;
  if (!data || !ix || !eje || !filas) return <div className="esq-page"><div className="esq-loading">Cargando esquemático…</div></div>;

  const sen = fuentes.get('SEN');
  const cdvF = fuentes.get('CDV');
  const on = (c: Capa) => capas.has(c);
  const general = vista === 'general';
  const strokeK = Math.max(0.35, Math.min(1.6, effW / 2600));
  const visX0 = general ? data.lienzo.area[0] : view.x;
  const visX1 = general ? data.lienzo.area[2] : view.x + view.w;
  const perf = data.perfil;
  const selIdx = (t: string) => (sel?.tipo === t ? Number(sel.id) : null);
  const selId = (t: string) => (sel?.tipo === t ? sel.id : null);

  const resaltado: React.ReactNode[] = [];
  if (selCdv) {
    const c = ix.cdv.get(selCdv);
    if (c) resaltado.push(<path key="selcdv" d={tramoD(c.tramos)} className="esq-sel-cdv" style={{ strokeWidth: 3.2 * strokeK + 1.2 }} />);
  }
  if (sel?.tipo === 'seccion') {
    const s = ix.seccion.get(sel.id);
    if (s) resaltado.push(<path key="selsec" d={tramoD(s.tramos)} className="esq-sel-sec" style={{ strokeWidth: 2.2 * strokeK + 0.8 }} />);
  }

  const yPk = general ? Y_PK_G : Y_PK;
  const pkTicks: React.ReactNode[] = [];
  if (on('pk')) {
    const step = general || effW > 3000 ? 1000 : effW > 1200 ? 500 : effW > 300 ? 100 : 50;
    for (let pk = 0; pk <= 17700; pk += step) {
      const x = eje.xAt(pk);
      if (x == null || x < visX0 - 50 || x > visX1 + 50) continue;
      const major = pk % 1000 === 0;
      pkTicks.push(
        <g key={pk}>
          <line x1={x} x2={x} y1={yPk - (major ? 3 : 1.6) * (general ? 1.6 : 1)} y2={yPk + 1.5} className="esq-pk-tick" />
          <text x={x} y={yPk - (general ? 5.5 : 4)} className="esq-pk-label" fontSize={general ? 6 : major ? 3.2 : 2.4}>
            {fmtPk(pk).replace(/\.000$/, '')}
          </text>
        </g>,
      );
    }
  }

  const contenido = (
    <>
      {on('plano_sen') && idxSen && <PlanoTiras base={PLANO_SEN} index={idxSen} x0={visX0} x1={visX1} claro={planoClaro} />}

      {on('zonas_asr') && data.zonas && <ZonasSvg zonas={data.zonas.filter(z => z.tipo === 'ASR')} etiquetas={lod.zonasTxt} selId={selId('zona')} hov={hov} />}
      {on('zonas_rauz') && data.zonas && <ZonasSvg zonas={data.zonas.filter(z => z.tipo === 'RAUZ')} etiquetas={lod.zonasTxt} selId={selId('zona')} hov={hov} />}

      {on('limites') && data.limites.map((l, i) => (
        <g key={`lim${i}`} className={l.tipo === 'wcu' ? 'esq-lim-wcu' : 'esq-lim'}>
          <line x1={l.x} x2={l.x} y1={l.y0} y2={l.y1} />
          {l.tipo === 'wcu' && <text x={l.x + 1} y={l.y0 + 3} fontSize={2.6}>límite WCU {l.izq ?? ''} | {l.der ?? ''}</text>}
          <title>{l.tipo === 'wcu' ? 'Límite de WCU' : 'Límite de estación'}: {l.izq ?? '—'} | {l.der ?? '—'}</title>
        </g>
      ))}

      {on('tramos') && data.tramos && <TramosSvg items={data.tramos} etiquetas={lod.tramosTxt} />}
      {on('subestaciones') && data.subestaciones && <SubestacionesSvg items={data.subestaciones} etiquetas={lod.seTxt} selId={selId('subestacion')} hov={hov} />}

      {on('pk') && <g className="esq-pk"><line x1={visX0} x2={visX1} y1={yPk + 1.5} y2={yPk + 1.5} className="esq-pk-axis" />{pkTicks}</g>}

      <g className="esq-est-names">
        {data.estaciones.map(e => e.x != null && (
          <text key={e.codigo} x={e.x} y={(yEstacion.get(e.codigo) ?? Y_EST) + (general ? 2 : 0)} fontSize={general ? 11 : effW > 3000 ? 7 : 4.2}>
            {general ? e.nombre : effW > 3000 ? e.codigo : `${e.nombre} (${e.codigo})`}
          </text>
        ))}
      </g>

      {on('andenes') && data.andenes.map((p, i) => <AndenSvg key={`and${i}`} p={p} detalle={lod.detalle} hov={hov} />)}
      {on('rotulos') && lod.rotulos && data.rotulos && <RotulosSvg items={data.rotulos} />}
      {on('carteles') && data.carteles && <CartelesSvg items={data.carteles} etiquetas={lod.tramosTxt} />}

      {on('vel_zonas') && perf && <VelocidadSvg zonas={perf.zonas_velocidad} etiquetas={lod.velEtiquetas} nombres={lod.velNombres} hov={hov} />}
      {on('vel_agujas') && perf && lod.pendEtiquetas && <VelAgujasSvg items={perf.velocidad_agujas} />}
      {on('pendientes') && perf && lod.pendientes && <PendientesSvg items={perf.pendientes} etiquetas={lod.pendEtiquetas} />}

      {capaVias}
      <g style={{ strokeWidth: 2.4 * strokeK }}>{capaSecciones}</g>
      {resaltado}

      <g className="esq-hit">
        {data.secciones.map(s => (
          <path key={s.id} d={tramoD(s.tramos)} style={{ strokeWidth: Math.max(4, 6 * strokeK) }} {...hov({ tipo: 'seccion', id: s.id })} />
        ))}
      </g>

      <JuntasSvg juntas={data.juntas} fisicas={on('juntas_fisicas')} virtuales={on('juntas_virtuales')}
        lazos={on('lazos') && lod.lazos} selIdx={selIdx('junta')} hov={hov} />

      {on('cdv_nombres') && lod.nombresCdv && (
        <g className="esq-cdv-names">
          {data.cdvs.map(c => {
            const t = c.tramos.reduce((a, b) => (Math.abs(b[2] - b[0]) > Math.abs(a[2] - a[0]) ? b : a), c.tramos[0]);
            if (!t) return null;
            const y = (t[1] + t[3]) / 2;
            return <text key={c.id} x={(t[0] + t[2]) / 2} y={y < 228 ? y - 3.4 : y + 5.6} fontSize={2.6}>{c.id}</text>;
          })}
        </g>
      )}
      {on('secciones_nombres') && lod.nombresSeccion && (
        <g className="esq-sec-names">
          {data.secciones.map(s => s.etiqueta && (
            <text key={s.id} x={s.etiqueta.x} y={s.etiqueta.y} fontSize={1.9}>{s.id}{s.longitud_m != null ? ` · ${s.longitud_m} m` : ''}</text>
          ))}
        </g>
      )}

      {on('avc') && data.avc.map(a => (
        <g key={a.id} className="esq-avc" {...hov({ tipo: 'avc', id: a.id })}>
          <rect x={a.x - 9} y={a.y - 2.2} width={18} height={4.4} rx={0.8} />
          <text x={a.x} y={a.y + 1} fontSize={2.2}>{a.id}</text>
        </g>
      ))}

      {on('balizas') && lod.balizas && <BalizasSvg balizas={data.balizas} etiquetas={lod.idsBaliza} selId={selId('baliza')} hov={hov} />}
      {on('psp') && lod.psp && (
        <g className="esq-psp">
          {data.psp.map((p, i) => <path key={i} d={`M${p.x} ${p.y - 3.2}L${p.x} ${p.y - 0.4}M${p.x - 0.6} ${p.y - 1.2}L${p.x} ${p.y - 0.4}L${p.x + 0.6} ${p.y - 1.2}`} />)}
        </g>
      )}
      {on('marcadores_al') && lod.psp && (
        <g className="esq-al">
          {data.marcadores_al.map((m, i) => <g key={i}><line x1={m.x} x2={m.x} y1={m.y - 2} y2={m.y + 2} /><title>{`AL ${m.senal}`}</title></g>)}
        </g>
      )}
      {on('fp') && lod.nombresSenal && (
        <g className="esq-fp">
          {data.puntos_libramiento.map((f, i) => (
            <g key={i}>
              <path d={`M${f.x} ${f.y - 1.2}L${f.x + 1} ${f.y}L${f.x} ${f.y + 1.2}L${f.x - 1} ${f.y}Z`} />
              <title>{`FP ${f.aguja} · PK ${fmtPk(f.pk)}`}</title>
            </g>
          ))}
        </g>
      )}

      {on('topes') && data.topes.map(t => (
        <g key={t.id} className="esq-tope"><line x1={t.x} x2={t.x} y1={t.y - 2.6} y2={t.y + 2.6} /><title>{t.id}</title></g>
      ))}

      {on('agujas') && data.agujas.map(a => (
        <AgujaSvg key={a.id} a={a} data={data} k={strokeK} etiqueta={lod.nombresAguja}
          activo={selKey === `aguja:${a.id}` || hoverKey === `aguja:${a.id}`} hov={hov} />
      ))}
      {on('senales') && data.senales.map(s => (
        <SenalSvg key={s.id} s={s} etiqueta={lod.nombresSenal}
          activo={selKey === `senal:${s.id}` || hoverKey === `senal:${s.id}`} hov={hov} />
      ))}

      {on('equipos') && data.equipos && (
        <EquiposSvg equipos={data.equipos} reset={on('reset') && lod.reset} etiquetas={lod.equiposTxt} selIdx={selIdx('equipo')} hov={hov} />
      )}
      {on('armarios') && data.armarios && <ArmariosSvg armarios={data.armarios} etiquetas={lod.armariosTxt} selId={selId('armario')} hov={hov} />}

      {sel?.tipo === 'pk' && eje.xAt(Number(sel.id)) != null && (
        <line x1={eje.xAt(Number(sel.id)) as number} x2={eje.xAt(Number(sel.id)) as number} y1={G_Y0} y2={G_Y1} className="esq-pk-sel" />
      )}
    </>
  );

  const cursorX = !general && cursorPk != null ? eje.xAt(cursorPk) : null;

  return (
    <div className="esq-page">
      <header className="esq-header">
        <div className="esq-title">
          <h2>Esquemático Línea 1 — vías, CDV, agujas, señales, ATC y perfil</h2>
          <p className="esq-sub">
            Fuentes: <span title={sen?.titulo}>{fuenteCorta(sen)} ({sen?.fecha_revision})</span> ·{' '}
            <span title={cdvF?.titulo}>{fuenteCorta(cdvF)} ({cdvF?.fecha_revision})</span> · generado {data.generado}
          </p>
        </div>
        <div className="esq-stats">
          <span>{data.cdvs.length} CDV</span><span>{data.secciones.length} secciones</span>
          <span>{data.agujas.length} agujas</span><span>{data.senales.length} señales</span>
          <span>{data.balizas.length} balizas</span>
          <span className={data.observaciones.length ? 'esq-warn' : ''} onClick={() => setTab('observaciones')}>
            {data.observaciones.length} observaciones
          </span>
        </div>
      </header>

      <div className="esq-toolbar">
        <form className="esq-search" onSubmit={e => {
          e.preventDefault();
          const r = resolver(ix, busqueda);
          if (r) { setBusquedaError(''); seleccionar(r, true); } else setBusquedaError('Sin coincidencia');
        }}>
          <Search size={14} />
          <input list="esq-ids" value={busqueda} placeholder="CDV, sección, señal, aguja, baliza, BFU, ubicación (OBS-03.0), zona, S/E, PK (4+535), id del log…"
            onChange={e => { setBusqueda(e.target.value); setBusquedaError(''); }} />
          <datalist id="esq-ids">{ix.todos.map(id => <option key={id} value={id} />)}</datalist>
          {busquedaError && <span className="esq-search-err">{busquedaError}</span>}
        </form>
        <div className="esq-modes">
          {MODOS.map(m => (
            <button key={m.key} className={modo === m.key ? 'active' : ''} onClick={() => setModo(m.key)}>{m.label}</button>
          ))}
        </div>
        <div className="esq-modes">
          <button className={general ? 'active' : ''} onClick={() => setVista('general')} title="Línea completa en filas">
            <Rows3 size={14} />&nbsp;General
          </button>
          <button className={!general ? 'active' : ''} onClick={() => setVista('detalle')} title="Vista de detalle con zoom">Detalle</button>
        </div>
        <div className="esq-tools">
          <button onClick={() => (general ? setVista('detalle') : zoomBtn(1 / 1.6))} title="Acercar"><ZoomIn size={15} /></button>
          <button onClick={() => (general ? undefined : zoomBtn(1.6))} disabled={general} title="Alejar"><ZoomOut size={15} /></button>
          <button className={on('plano_sen') ? 'active' : ''} title="Superponer el plano de señalización original"
            onClick={() => setCapas(s => { const n = new Set(s); if (n.has('plano_sen')) n.delete('plano_sen'); else n.add('plano_sen'); return n; })}>
            <FileImage size={15} />
          </button>
          <button className={showCdv ? 'active' : ''} disabled={general || !idxCdv} title="Plano de CDV sincronizado por PK (vista de detalle)"
            onClick={() => setShowCdv(s => !s)}><SplitSquareVertical size={15} /></button>
          <button className={showCapas ? 'active' : ''} onClick={() => setShowCapas(s => !s)} title="Capas"><Layers size={15} /></button>
        </div>
        {showCapas && (
          <div className="esq-capas">
            {GRUPOS_CAPAS.map(g => (
              <div key={g.grupo} className="esq-capas-grupo">
                <h5>{g.grupo}</h5>
                {g.capas.map(c => (
                  <label key={c.key}>
                    <input type="checkbox" checked={capas.has(c.key)} onChange={() => setCapas(s => {
                      const n = new Set(s);
                      if (n.has(c.key)) n.delete(c.key); else n.add(c.key);
                      return n;
                    })} />
                    {c.label}
                  </label>
                ))}
              </div>
            ))}
            <label className="esq-capas-extra">
              <input type="checkbox" checked={planoClaro} onChange={() => setPlanoClaro(v => !v)} /> Planos originales con fondo blanco
            </label>
          </div>
        )}
      </div>

      <nav className="esq-stations">
        {data.estaciones.slice().sort((a, b) => (a.x ?? 0) - (b.x ?? 0)).map(e => (
          <button key={e.codigo} title={`${e.nombre} — ${e.mx}${e.enclavamiento ? ` — ${e.enclavamiento}` : ''}`}
            onClick={() => seleccionar({ tipo: 'estacion', id: e.codigo }, true)}
            className={sel?.tipo === 'estacion' && sel.id === e.codigo ? 'active' : ''}>
            {e.codigo}
          </button>
        ))}
      </nav>

      <div className="esq-body">
        <div className="esq-canvas-col">
          <div className="esq-canvas" ref={wrapRef}>
            <svg ref={svgRef} viewBox={general ? `0 0 ${filas.vw} ${filas.vh}` : `${view.x} ${view.y} ${view.w} ${view.h}`}
              preserveAspectRatio="xMidYMid meet" className={general ? 'esq-general' : ''}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
              onPointerLeave={() => setCursorPk(null)}
              style={{ ['--k' as string]: strokeK } as React.CSSProperties}>
              {general ? (
                <>
                  <defs>
                    <g id="esq-contenido">{contenido}</g>
                    {filas.x0s.map((x0, i) => (
                      <clipPath key={i} id={`esq-fila-${i}`} clipPathUnits="userSpaceOnUse">
                        <rect x={x0} y={G_Y0} width={filas.rowW} height={G_ROW} />
                      </clipPath>
                    ))}
                  </defs>
                  {filas.x0s.map((x0, i) => (
                    <g key={i} transform={`translate(${-x0} ${i * (G_ROW + G_GAP) - G_Y0})`}>
                      <rect x={x0} y={G_Y0} width={filas.rowW} height={G_ROW} className="esq-fila-fondo" />
                      <use href="#esq-contenido" clipPath={`url(#esq-fila-${i})`} />
                    </g>
                  ))}
                </>
              ) : (
                <>
                  {contenido}
                  {cursorX != null && <line x1={cursorX} x2={cursorX} y1={view.y} y2={view.y + view.h} className="esq-cursor-line" style={{ strokeWidth: view.w / 1400 }} />}
                </>
              )}
            </svg>

            {hover && <Tooltip ix={ix} r={hover.ref} x={hover.cx} y={hover.cy} />}
            <div className="esq-cursor">
              {cursorPk != null ? `PK aprox. ${fmtPk(cursorPk)}` : ''}
              {general ? '  ·  clic o rueda para ver el detalle' : '  ·  clic en un punto vacío: inspector de PK'}
            </div>
          </div>
          {showCdv && !general && idxCdv && data.regla_cdv?.length && (
            <PlanoCdv index={idxCdv} base={PLANO_CDV} reglaSen={data.regla_sen ?? []} reglaCdv={data.regla_cdv ?? []}
              ejeSen={eje} vx={view.x} vw={view.w} cursorPk={cursorPk} onCursorPk={setCursorPk} claro={planoClaro} />
          )}
        </div>

        <aside className="esq-panel">
          <div className="esq-tabs">
            <button className={tab === 'elemento' ? 'active' : ''} onClick={() => setTab('elemento')}><Info size={13} /> Elemento</button>
            <button className={tab === 'fuentes' ? 'active' : ''} onClick={() => setTab('fuentes')}><FileText size={13} /> Fuentes</button>
            <button className={tab === 'observaciones' ? 'active' : ''} onClick={() => setTab('observaciones')}><AlertTriangle size={13} /> Observ.</button>
            <button className={tab === 'leyenda' ? 'active' : ''} onClick={() => setTab('leyenda')}>Leyenda</button>
          </div>
          <div className="esq-panel-body">
            {tab === 'elemento' && (sel
              ? <Detalle ix={ix} r={sel} fuentes={fuentes} eje={eje} onSel={r => seleccionar(r, true)} onClose={() => setSel(null)} />
              : <p className="esq-muted">Seleccioná un elemento, buscá un identificador o un PK, o hacé clic en un punto vacío de la vista de detalle.</p>)}
            {tab === 'fuentes' && <Fuentes data={data} />}
            {tab === 'observaciones' && <Observaciones data={data} onGo={(x, y) => encuadrar([x - 20, y - 10, x + 20, y + 10])} onSel={r => seleccionar(r, true)} ix={ix} />}
            {tab === 'leyenda' && <Leyenda modo={modo} />}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default EsquematicoL1;
