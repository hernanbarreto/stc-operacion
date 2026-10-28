import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Search, ZoomIn, ZoomOut, Rows3, Maximize2, Layers, FileText, AlertTriangle, Info, PanelRightOpen, PanelRightClose, ListTree, Activity, Upload, FolderOpen, ChartNoAxesGantt } from 'lucide-react';
import type { ElementoRef, Esquematico, Seccion, Tramo } from './types';
import {
  cajaDe, construirEjePk, construirIndice, fmtPk, perfilEn, rangoX, resolver, type Indice,
} from './resolver';
import {
  CAPAS_INICIALES, CDV_ALT, COLOR_CATEGORIA, DET_H, FREQ_COLORS, G_GAP, G_ROW, G_SOLAPE, G_Y0, G_Y1, GRUPOS_CAPAS,
  IXL_COLORS, MODOS, SIN_DATO, TIPO_COLORS, VIA_IHM, Y_EST, Y_PK, Y_PK_G, colorVelocidad, type Capa, type Modo,
} from './constantes';
import {
  AgujaSvg, AndenSvg, ArmariosSvg, BalizasSvg, CartelesSvg, DboSvg, EnergiaSvg, EquiposSvg, EstadosSvg, FantasmasSvg, JuntasSvg, RutasSvg,
  PendientesSvg, RotulosSvg, RotulosViaSvg, SenalSvg, TramosSvg, TrenesSvg, VelAgujasSvg, VelocidadSvg, ZonasSvg,
  type Geo, type IntervaloDibujo, type RutaDibujo, type TrenDibujo,
} from './capas';
import { Detalle, Fuentes, Leyenda, Observaciones, Tooltip } from './paneles';
import { EventosPanel, EstadoPanel, TrenPanel } from './panelesReplay';
import { leerArchivoLocal, leerEsquematico, subirEsquematico } from './almacen';
import { calcularRotulos } from './rotulos';
import { type Evento, type ModeloEventos, indiceEvento, interpretar } from './eventos';
import { LectorEventos } from './lectorEventos';
import { crearContexto, DESTELLO_MS, HUECO_MAX_MS, estadoEn, faseEn, mapaPkMarcha, prepararReplay, recorridoReal, yDeVia } from './replay';
import { type CurvaMarcha, cargarCurvas, curvaDe, trayectoriaTipo, type PuntoMarcha } from './marcha';
import { Hilo, type MarchaDibujo, type MarcaEvento } from './Hilo';
import { BarraReproduccion, type OpcionMarcha } from './BarraReproduccion';
import { fetchIndex, type DayIndexEntry } from '../../services/daysIndex';
import { downloadExcelFile, listExcelFiles } from '../../services/storageService';
import { fechaDia } from './fecha';
import { inferHorario } from '../../data/marchaTipoSiemens';
import './EsquematicoL1.css';

// ───────────────────────── utilidades ─────────────────────────

function refKey(r: ElementoRef | null): string {
  return r ? `${r.tipo}:${r.id}` : '';
}

function tramoD(ts: Tramo[]): string {
  return ts.map(t => `M${t[0]} ${t[1]}L${t[2]} ${t[3]}`).join('');
}

interface View { x: number; y: number; w: number; h: number }
type Vista = 'general' | 'detalle';
type Tab = 'elemento' | 'eventos' | 'estado' | 'fuentes' | 'observaciones' | 'leyenda';
interface Filas { n: number; rowW: number; x0s: number[]; vw: number; vh: number }

function calcularFilas(area: [number, number, number, number], aspect: number): Filas {
  const L = area[2] - area[0];
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

function hoyA(h: number): number {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.getTime();
}

const lector = new LectorEventos();

// ───────────────────────── componente ─────────────────────────

export const EsquematicoL1: React.FC = () => {
  // datos del esquemático
  const [data, setData] = useState<Esquematico | null>(null);
  const [estadoDatos, setEstadoDatos] = useState<'cargando' | 'falta' | 'listo'>('cargando');
  const [errorDatos, setErrorDatos] = useState('');
  const [subiendo, setSubiendo] = useState(false);

  // vista
  const [modo, setModo] = useState<Modo>('ihm');
  const [capas, setCapas] = useState<Set<Capa>>(new Set(CAPAS_INICIALES));
  const [sel, setSel] = useState<ElementoRef | null>(null);
  const [hover, setHover] = useState<{ ref: ElementoRef; cx: number; cy: number } | null>(null);
  const [tab, setTab] = useState<Tab>('fuentes');
  const [panel, setPanel] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [busquedaError, setBusquedaError] = useState('');
  const [showCapas, setShowCapas] = useState(false);
  const [view, setView] = useState<View>({ x: 40, y: 63, w: 600, h: DET_H });
  const [vista, setVista] = useState<Vista>('general');
  const [aspect, setAspect] = useState(0.5);
  const [anchoPx, setAnchoPx] = useState(1200);
  const [cursorPk, setCursorPk] = useState<number | null>(null);
  const [alto, setAlto] = useState<number | null>(null);

  // reproducción
  const [dias, setDias] = useState<DayIndexEntry[] | null>(null);
  const [diasLocales, setDiasLocales] = useState<{ fecha: string; n: number }[]>([]);
  const [archivoLocal, setArchivoLocal] = useState<string | null>(null);
  const [actual, setActual] = useState<{ origen: string; fecha: string } | null>(null);
  const [cargando, setCargando] = useState<string | null>(null);
  const [mod, setMod] = useState<ModeloEventos | null>(null);
  const [t, setT] = useState<number>(hoyA(7));
  const [reproduciendo, setReproduciendo] = useState(false);
  const [velocidad, setVelocidad] = useState(10);
  const [span, setSpan] = useState(3600e3);
  const [hiloAbierto, setHiloAbierto] = useState(true);
  const [hiloAlto, setHiloAlto] = useState(260);
  const [marcha, setMarcha] = useState<OpcionMarcha>('ninguna');
  const [marchaAncla, setMarchaAncla] = useState<number>(hoyA(7));
  const [seguir, setSeguir] = useState(false);
  const [curvas, setCurvas] = useState<CurvaMarcha[]>([]);

  const pageRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; v: View; moved: boolean } | null>(null);

  // ── carga de datos ──
  useEffect(() => {
    leerEsquematico()
      .then(d => { if (d) { setData(d); setEstadoDatos('listo'); } else setEstadoDatos('falta'); })
      .catch(e => { setErrorDatos(`No se pudo leer el esquemático de Storage: ${e instanceof Error ? e.message : e}`); setEstadoDatos('falta'); });
    fetchIndex().then(setDias).catch(() => setDias(null));
    cargarCurvas().then(setCurvas).catch(() => setCurvas([]));
  }, []);

  const abrirJson = async (f: File, subir: boolean) => {
    setErrorDatos('');
    setSubiendo(true);
    try {
      const d = subir ? await subirEsquematico(f) : await leerArchivoLocal(f);
      setData(d);
      setEstadoDatos('listo');
    } catch (e) {
      setErrorDatos(e instanceof Error ? e.message : String(e));
    } finally {
      setSubiendo(false);
    }
  };

  const ix: Indice | null = useMemo(() => (data ? construirIndice(data) : null), [data]);
  const eje = useMemo(() => (data ? construirEjePk(data) : null), [data]);
  const fuentes = useMemo(() => new Map((data?.fuentes ?? []).map(f => [f.id, f])), [data]);
  const filas = useMemo(() => (data ? calcularFilas(data.lienzo.area, aspect) : null), [data, aspect]);
  const rotulosVia = useMemo(() => (data ? calcularRotulos(data) : []), [data]);
  const longitudes = useMemo(() => new Map((data?.secciones ?? []).map(s => [s.id, s.longitud_m])), [data]);
  const ctx = useMemo(() => (data && eje ? crearContexto(data, eje, curvas) : null), [data, eje, curvas]);

  // alto disponible: desde el borde superior de la vista hasta el pie de la ventana
  useLayoutEffect(() => {
    const medir = () => {
      const el = pageRef.current;
      if (el) setAlto(window.innerHeight - el.getBoundingClientRect().top);
    };
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [estadoDatos]);

  // aspecto del lienzo = aspecto del contenedor
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !data) return;
    const medir = () => {
      const r = el.getBoundingClientRect();
      const a = r.height / Math.max(r.width, 1);
      setAspect(a);
      setAnchoPx(Math.max(1, r.width));
      setView(v => ({ ...v, h: v.w * a }));
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data, hiloAbierto]);

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

  // ── reproducción: estado en el instante t ──
  const rep = useMemo(() => (ctx && mod ? prepararReplay(ctx, mod) : null), [ctx, mod]);
  const estado = useMemo(() => (rep ? estadoEn(rep, t) : null), [rep, t]);
  const recorridos = useMemo(() => {
    const m = new Map<string, { t: number; pk: number; via: number }[][]>();
    if (rep && mod) for (const tr of mod.trenes) m.set(tr.clave, recorridoReal(rep, tr));
    return m;
  }, [rep, mod]);

  const seleccionar = useCallback((ref: ElementoRef | null, zoom = false) => {
    setSel(ref);
    if (ref) { setTab('elemento'); setPanel(true); }
    const capasDe: Capa[] = !ref ? [] : ref.tipo === 'zona' ? [ref.id.startsWith('RAUZ') ? 'zonas_rauz' : 'zonas_asr']
      : ref.tipo === 'armario' ? ['armarios'] : ref.tipo === 'subestacion' ? ['subestaciones']
        : ref.tipo === 'baliza' ? ['balizas'] : ref.tipo === 'zona_velocidad' ? ['vel_zonas']
          : ref.tipo === 'junta' ? ['juntas_fisicas'] : ref.tipo === 'tren' ? ['trenes']
            : ref.tipo === 'equipo' ? (data?.equipos?.[Number(ref.id)]?.tipo === 'RESET' ? ['equipos', 'reset'] : ['equipos']) : [];
    if (capasDe.length) setCapas(s => (capasDe.every(c => s.has(c)) ? s : new Set([...s, ...capasDe])));
    if (ref && zoom && ix) {
      if (ref.tipo === 'tren') {
        const p = estado?.trenes.find(x => x.tren.clave === ref.id);
        if (p) encuadrar([p.x - 40, p.y - 20, p.x + 40, p.y + 20]);
      } else {
        const b = cajaDe(ix, ref);
        if (b) encuadrar(b);
      }
    }
  }, [ix, encuadrar, data, estado]);

  // carga de un día de eventos
  const cargarDia = useCallback(async (origen: string, fecha: string, obtener: () => Promise<void>) => {
    if (!ix) return;
    setReproduciendo(false);
    try {
      await obtener();
      setCargando(`Interpretando ${fecha}…`);
      const filas = await lector.dia(origen, fecha);
      const m = interpretar(filas, ix);
      setMod(m);
      setActual({ origen, fecha });
      const ini = m.trenes.length ? Math.min(...m.trenes.map(x => x.paradas[0]?.t ?? Infinity)) : m.t0;
      setT(Number.isFinite(ini) ? ini : m.t0);
      setHiloAbierto(true);
    } catch (e) {
      alert(`No se pudieron cargar los eventos: ${e instanceof Error ? e.message : e}`);
    } finally {
      setCargando(null);
    }
  }, [ix]);

  const onDiaStorage = (d: DayIndexEntry) => cargarDia(d.source, d.fecha, async () => {
    setCargando(`Descargando ${d.source}…`);
    const buf = await downloadExcelFile(d.source);
    setCargando(`Leyendo ${d.source}…`);
    await lector.abrir(d.source, buf);
  });

  const onArchivo = async (f: File) => {
    setCargando(`Leyendo ${f.name}…`);
    try {
      const ds = await lector.abrir(`__local:${f.name}`, await f.arrayBuffer());
      setArchivoLocal(f.name);
      setDiasLocales(ds);
      setCargando(null);
      const mayor = [...ds].sort((a, b) => b.n - a.n)[0];
      if (mayor) await cargarDia(`__local:${f.name}`, mayor.fecha, async () => undefined);
    } catch (e) {
      setCargando(null);
      alert(`No se pudo leer el archivo: ${e instanceof Error ? e.message : e}`);
    }
  };
  // clasificación de tipos de evento de varios archivos → CSV
  const clasificarArchivos = async (fuentes: { nombre: string; obtener: () => Promise<ArrayBuffer> }[]) => {
    if (!fuentes.length) { alert('No hay archivos de eventos para clasificar.'); return; }
    setReproduciendo(false);
    try {
      let filas = 0;
      for (let i = 0; i < fuentes.length; i++) {
        setCargando(`Clasificando ${i + 1}/${fuentes.length}: ${fuentes[i].nombre}…`);
        filas += (await lector.clasificar(fuentes[i].nombre, await fuentes[i].obtener(), i === 0)).n;
      }
      const csv = await lector.csvClasificacion();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `clasificacion_eventos_${fechaDia(Date.now())}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setCargando(`Clasificación lista: ${fuentes.length} archivo(s), ${filas.toLocaleString('es-MX')} filas`);
      setTimeout(() => setCargando(c => (c?.startsWith('Clasificación lista') ? null : c)), 6000);
    } catch (e) {
      setCargando(null);
      alert(`No se pudo clasificar: ${e instanceof Error ? e.message : e}`);
    }
  };
  const onClasificarStorage = async () => {
    try {
      setCargando('Listando archivos de Storage…');
      const fs = await listExcelFiles();
      await clasificarArchivos(fs.map(f => ({ nombre: f.name, obtener: () => downloadExcelFile(f.fullPath) })));
    } catch (e) {
      setCargando(null);
      alert(`No se pudo leer Storage: ${e instanceof Error ? e.message : e}`);
    }
  };
  const onClasificarLocal = (fs: File[]) => clasificarArchivos(fs.map(f => ({ nombre: f.name, obtener: () => f.arrayBuffer() })));

  const onDiaLocal = (fecha: string) => { if (archivoLocal) void cargarDia(`__local:${archivoLocal}`, fecha, async () => undefined); };

  // reloj de la reproducción
  useEffect(() => {
    if (!reproduciendo) return;
    let ultimo = performance.now();
    let raf = 0;
    const paso = (ahora: number) => {
      const dt = ahora - ultimo;
      ultimo = ahora;
      setT(tt => {
        const n = tt + dt * velocidad;
        if (mod && n >= mod.t1) { setReproduciendo(false); return mod.t1; }
        return n;
      });
      raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [reproduciendo, velocidad, mod]);

  // espacio = play / pausa
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement;
      if (e.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tg.tagName)) { e.preventDefault(); setReproduciendo(r => !r); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const trenSel = sel?.tipo === 'tren' ? sel.id : null;
  const posSel = trenSel ? estado?.trenes.find(p => p.tren.clave === trenSel) : null;

  // seguir al tren seleccionado
  useEffect(() => {
    if (!seguir || !posSel || vista !== 'detalle') return;
    setView(v => (Math.abs(posSel.x - (v.x + v.w / 2)) > v.w * 0.25 ? { ...v, x: posSel.x - v.w / 2 } : v));
  }, [seguir, posSel, vista]);

  // marcha tipo: trayectoria absoluta (t en ms)
  // marcha tipo del tren seleccionado: se alinea con la primera salida de su viaje actual (clave estable mientras dure)
  const viajeSel = useMemo((): string => {
    if (marcha !== 'tren' || !mod || !trenSel || !ctx) return '';
    const tr = mod.trenes.find(x => x.clave === trenSel);
    if (!tr) return '';
    const ps = tr.paradas;
    let i = -1;
    for (let k = 0; k < ps.length && ps[k].t <= t; k++) i = k;
    if (i < 0) return '';
    const via = ps[i].via;
    let k = i;
    while (k > 0 && ps[k - 1].via === via && ps[k].t - ps[k - 1].t < HUECO_MAX_MS) k--;
    const inicio = ps.slice(k, i + 1).find(p => p.tipo === 'dep') ?? ps[k];
    return [tr.material ?? 'NM22', via === 1 ? 'V1' : 'V2', inicio.t, ctx.codigoEst(inicio.est) ?? '', tr.clave].join('|');
  }, [marcha, mod, trenSel, ctx, t]);

  const marchaAbs = useMemo((): { puntos: { t: number; pk: number }[]; etiqueta: string; via: number } | null => {
    if (marcha === 'ninguna' || !ctx) return null;
    let material: 'NM16' | 'NM22', via: 'V1' | 'V2', etiqueta: string;
    let alinear: (pts: PuntoMarcha[]) => number;
    if (marcha === 'tren') {
      if (!viajeSel) return null;
      const [m, v, tIni, codigo, clave] = viajeSel.split('|');
      material = m as 'NM16' | 'NM22'; via = v as 'V1' | 'V2';
      etiqueta = `tipo ${material} ${via} (${clave})`;
      alinear = pts => {
        const ref = pts.find(p => p.estacion === codigo && p.tipo === 'dep') ?? pts.find(p => p.estacion === codigo);
        return Number(tIni) - (ref?.t ?? 0) * 1000;
      };
    } else {
      const [m, v] = marcha.split('_') as ['NM16' | 'NM22', 'V1' | 'V2'];
      material = m; via = v;
      etiqueta = `tipo ${material} ${via}`;
      alinear = () => marchaAncla;
    }
    const pts: PuntoMarcha[] = trayectoriaTipo(curvaDe(curvas, material, via), material, via, inferHorario(marcha === 'tren' ? Number(viajeSel.split('|')[2]) : marchaAncla));
    const ancla = alinear(pts);
    const nv = via === 'V1' ? 1 : 2;
    const aPlano = mapaPkMarcha(ctx, nv);
    return { puntos: pts.map(p => ({ t: ancla + p.t * 1000, pk: aPlano(p.pk) })), etiqueta, via: nv };
  }, [marcha, ctx, viajeSel, curvas, marchaAncla]);

  const fantasmas = useMemo(() => {
    if (!marchaAbs || !eje || !data) return [];
    const ps = marchaAbs.puntos;
    if (t < ps[0].t || t > ps[ps.length - 1].t) return [];
    let i = 1;
    while (i < ps.length - 1 && ps[i].t < t) i++;
    const a = ps[i - 1], b = ps[i];
    const pk = b.t === a.t ? a.pk : a.pk + ((t - a.t) / (b.t - a.t)) * (b.pk - a.pk);
    const x = eje.xAt(pk);
    if (x == null) return [];
    const y = yDeVia(data, `V${marchaAbs.via}`, x) ?? (marchaAbs.via === 1 ? 208 : 248);
    return [{ x, y, etiqueta: marchaAbs.etiqueta }];
  }, [marchaAbs, eje, data, t]);

  const setMarchaDesdeAhora = (m: OpcionMarcha) => { setMarcha(m); setMarchaAncla(t); };

  const pasoEvento = (dir: -1 | 1) => {
    if (!mod) return;
    const relevantes = (e: Evento) => e.cat !== 'movimiento';
    let i = indiceEvento(mod.eventos, t + (dir > 0 ? 1 : 0));
    if (dir > 0) { while (i < mod.eventos.length && !relevantes(mod.eventos[i])) i++; if (i < mod.eventos.length) setT(mod.eventos[i].t); }
    else { i -= 1; while (i >= 0 && !relevantes(mod.eventos[i])) i--; if (i >= 0) setT(mod.eventos[i].t); }
  };

  const irAEvento = (e: Evento) => {
    setT(e.t);
    setReproduciendo(false);
    if (e.refs[0]) seleccionar(e.refs[0], true);
    else if (e.tren) seleccionar({ tipo: 'tren', id: e.tren }, false);
  };

  // ── zoom / pan ──
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
  }, [data, vista, estadoDatos]);

  const onPointerDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, v: view, moved: false }; };
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
    if (d.moved) setView({ ...d.v, x: d.v.x - ((e.clientX - d.x) / r.width) * d.v.w, y: d.v.y - ((e.clientY - d.y) / r.height) * d.v.h });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const p = toCanvas(e.clientX, e.clientY);
    if (vista === 'general') { if (p) irADetalle(p.x); return; }
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

  const yEstacion = useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    for (const e of data.estaciones) {
      const ps = data.andenes.filter(p => p.estacion === e.codigo);
      if (!ps.length) continue;
      const a = Math.min(...ps.map(p => p.x0)), b = Math.max(...ps.map(p => p.x1));
      const ys = data.vias.filter(v => Math.max(v.pts[0], v.pts[2]) >= a && Math.min(v.pts[0], v.pts[2]) <= b).flatMap(v => [v.pts[1], v.pts[3]]);
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

  // geometría de un elemento para resaltarlo (estados de la reproducción)
  const geoCache = useMemo(() => new Map<string, Geo>(), [ix]); // eslint-disable-line react-hooks/exhaustive-deps
  const geoDe = useCallback((k: string): Geo => {
    if (!ix) return null;
    const i = k.indexOf(':');
    const ref = { tipo: k.slice(0, i), id: k.slice(i + 1) } as ElementoRef;
    const conLab = (ts: Tramo[]): Geo => {
      if (!ts.length) return null;
      const m = ts.reduce((a, q) => (Math.abs(q[2] - q[0]) > Math.abs(a[2] - a[0]) ? q : a));
      return { d: tramoD(ts), lab: [(m[0] + m[2]) / 2, (m[1] + m[3]) / 2] };
    };
    if (ref.tipo === 'seccion') { const s = ix.seccion.get(ref.id); return s ? conLab(s.tramos) : null; }
    if (ref.tipo === 'cdv') { const c = ix.cdv.get(ref.id); return c ? conLab(c.tramos) : null; }
    const b = cajaDe(ix, ref);
    if (!b) return null;
    if (ref.tipo === 'anden' || ref.tipo === 'bfu') return { rect: b };
    return { c: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] };
  }, [ix]);
  const geo = useCallback((k: string) => {
    if (!geoCache.has(k)) geoCache.set(k, geoDe(k));
    return geoCache.get(k) ?? null;
  }, [geoDe, geoCache]);

  // nivel de detalle según el ancho visible (unidades de lienzo)
  const general = vista === 'general';
  const effW = general && filas ? filas.rowW : view.w;
  const px = effW / anchoPx;                    // unidades de lienzo por píxel de pantalla
  const lod = {
    nombresSenal: effW < 1300, nombresAguja: effW < 1300, balizas: effW < 1600, idsBaliza: effW < 650,
    psp: effW < 600, detalle: effW < 400, lazosTxt: effW < 700, velEtiquetas: effW < 1600, velNombres: effW < 420,
    pendientes: effW < 2600, pendEtiquetas: effW < 900, equiposTxt: effW < 1600, reset: effW < 900, zonasTxt: effW < 2600,
    armariosTxt: effW < 1100, rotulos: effW < 2600, tramosTxt: effW < 2600,
  };

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

  const capaVias = useMemo(() => (data ? (
    <g className="esq-vias-base">{data.vias.map(v => <line key={v.id} x1={v.pts[0]} y1={v.pts[1]} x2={v.pts[2]} y2={v.pts[3]} />)}</g>
  ) : null), [data]);

  const capaSecciones = useMemo(() => (data ? (
    <g>{data.secciones.map(s => <path key={s.id} d={tramoD(s.tramos)} stroke={colorSeccion(s)} className="esq-seccion" />)}</g>
  ) : null), [data, colorSeccion]);

  const yVias = useCallback((x: number) => {
    if (!data) return [];
    return ['V1', 'V2'].map(v => yDeVia(data, v, x)).filter((y): y is number => y != null);
  }, [data]);

  const trenesDibujo: TrenDibujo[] = useMemo(() => (estado?.trenes ?? []).map(p => ({
    clave: p.tren.clave, numero: p.numero, x: p.x, y: p.y, sentido: p.sentido, material: p.tren.material,
    enAnden: p.enAnden || !!p.cdv, vigente: p.vigente, degradado: !!p.numero && (estado?.degradados.has(p.numero) ?? false),
  })), [estado]);

  // alarmas y marcas por elemento (sin DBO, que va en su propia capa)
  const porElementoDibujo = useMemo(() => {
    const m = new Map<string, IntervaloDibujo[]>();
    if (!estado) return m;
    for (const [k, ivs] of estado.porElemento) {
      const l = ivs.filter(iv => iv.tipo !== 'dbo').map(iv => ({ tipo: iv.tipo, etiqueta: iv.etiqueta, fase: faseEn(iv, t) }));
      if (l.length) m.set(k, l);
    }
    return m;
  }, [estado, t]);
  const dboItems = useMemo(() => (estado?.activos ?? []).filter(iv => iv.tipo === 'dbo')
    .flatMap(iv => iv.refs.map(r => ({ k: refKey(r), texto: iv.texto }))), [estado]);
  const rutasDibujo: RutaDibujo[] = useMemo(() => {
    if (!estado) return [];
    const num = new Map(estado.trenes.map(p => [p.tren.clave, p.numero]));
    const out: RutaDibujo[] = [];
    for (const r of estado.rutas) {
      if (!r.rec) continue;
      const tr = r.tren ? `${num.get(r.tren) ?? '—'} · ${r.tren}` : 'sin tren asociado todavía';
      out.push({ id: r.id, tramos: r.rec.tramos, agujas: r.rec.agujas, tipo: 'ruta', activa: !!trenSel && r.tren === trenSel,
        texto: `Itinerario ${r.origen} → ${r.destino} · tren ${tr} · agujas ${r.rec.agujas.map(a => `${a.id} ${a.pos}`).join(', ') || '—'} (recorrido inferido del plano)` });
    }
    for (const d of estado.desl) {
      if (!d.rec) continue;
      out.push({ id: d.id, tramos: d.rec.tramos, agujas: d.rec.agujas, tipo: 'desl', activa: !!trenSel && d.tren === trenSel,
        texto: `Deslizamiento ${d.senal} (${d.comando.replace('EstablecerDeslizamiento', '')}) · agujas ${d.rec.agujas.map(a => `${a.id} ${a.pos}`).join(', ') || '—'} (inferido del plano)` });
    }
    return out;
  }, [estado, trenSel]);

  const marcas: MarcaEvento[] = useMemo(() => {
    if (!mod || !ix) return [];
    const out: MarcaEvento[] = [];
    const tTop = t - span * 0.4, tBot = tTop + span;
    for (let i = indiceEvento(mod.eventos, tTop); i < mod.eventos.length && mod.eventos[i].t <= tBot; i++) {
      const e = mod.eventos[i];
      // los DBO acompañan cada parada: se omiten en el hilo para no tapar el resto (siguen en la lista y en el lienzo)
      if (e.cat === 'movimiento' || e.plantilla === 'dbo' || e.plantilla === 'dbo_nocbtc' || !e.refs.length) continue;
      const g = geo(refKey(e.refs[0]));
      const x = g?.lab?.[0] ?? g?.c?.[0] ?? (g?.rect ? (g.rect[0] + g.rect[2]) / 2 : null);
      if (x == null || Number.isNaN(x)) continue;
      out.push({ t: e.t, x, color: COLOR_CATEGORIA[e.cat], titulo: e.desc, i: e.i });
      if (out.length > 4000) break;
    }
    return out;
  }, [mod, ix, t, span, geo]);

  const marchasHilo: MarchaDibujo[] = useMemo(() => (marchaAbs ? [{ etiqueta: marchaAbs.etiqueta, color: '#fbbf24', puntos: marchaAbs.puntos }] : []), [marchaAbs]);

  // ───────────────────────── pantallas previas ─────────────────────────

  if (estadoDatos === 'cargando') return <div className="esq-page" ref={pageRef}><div className="esq-loading">Cargando esquemático…</div></div>;
  if (estadoDatos === 'falta' || !data || !ix || !eje || !filas) {
    return (
      <div className="esq-page" ref={pageRef}>
        <div className="esq-carga">
          <h3>Datos del esquemático</h3>
          <p>Todavía no están cargados en Firebase Storage (se leen con tu usuario; no van al repositorio ni a /public).
            Elegí el archivo <code>esquematico_l1.json</code> generado por <code>tools/esquematico/extract.py</code>.</p>
          {errorDatos && <p className="esq-search-err">{errorDatos}</p>}
          <label className="esq-carga-btn"><Upload size={15} /> Subir a Storage y abrir
            <input type="file" accept=".json,application/json" hidden disabled={subiendo} onChange={e => { const f = e.target.files?.[0]; if (f) void abrirJson(f, true); e.target.value = ''; }} />
          </label>
          <label className="esq-carga-btn sec"><FolderOpen size={15} /> Abrir sólo en este navegador
            <input type="file" accept=".json,application/json" hidden disabled={subiendo} onChange={e => { const f = e.target.files?.[0]; if (f) void abrirJson(f, false); e.target.value = ''; }} />
          </label>
          {subiendo && <p className="esq-muted">Procesando…</p>}
        </div>
      </div>
    );
  }

  const on = (c: Capa) => capas.has(c);
  const strokeK = Math.max(0.35, Math.min(1.6, effW / 2600));
  const visX0 = general ? data.lienzo.area[0] : view.x;
  const visX1 = general ? data.lienzo.area[2] : view.x + view.w;
  const perf = data.perfil;
  const selIdx = (k: string) => (sel?.tipo === k ? Number(sel.id) : null);
  const selId = (k: string) => (sel?.tipo === k ? sel.id : null);

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
          <text x={x} y={yPk - (general ? 5.5 : 4)} className="esq-pk-label" fontSize={general ? 6 : major ? 3.2 : 2.4}>{fmtPk(pk).replace(/\.000$/, '')}</text>
        </g>,
      );
    }
  }

  const ixlCaidos = estado?.ixlCaidos ?? new Set<string>();

  const contenido = (
    <>
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
      {on('pk') && <g className="esq-pk"><line x1={visX0} x2={visX1} y1={yPk + 1.5} y2={yPk + 1.5} className="esq-pk-axis" />{pkTicks}</g>}

      <g className="esq-est-names">
        {data.estaciones.map(e => e.x != null && (
          <text key={e.codigo} x={e.x} y={(yEstacion.get(e.codigo) ?? Y_EST) + (general ? 2 : 0)}
            fontSize={Math.max(4.2, (general ? 15 : 13) * px)}
            className={(e.enclavamiento && ixlCaidos.has(e.enclavamiento)) || (e.atp && ixlCaidos.has(e.atp)) ? 'caido' : ''}>
            {general || effW > 1500 ? e.nombre : `${e.nombre} (${e.codigo})`}
          </text>
        ))}
      </g>

      {on('andenes') && data.andenes.map((p, i) => <AndenSvg key={`and${i}`} p={p} detalle={lod.detalle} hov={hov} />)}
      {on('rotulos') && lod.rotulos && data.rotulos && <RotulosSvg items={data.rotulos} />}
      {on('carteles') && data.carteles && <CartelesSvg items={data.carteles} etiquetas={lod.tramosTxt} />}

      {on('vel_zonas') && perf && <VelocidadSvg zonas={perf.zonas_velocidad} etiquetas={lod.velEtiquetas} nombres={lod.velNombres} hov={hov} />}
      {on('vel_agujas') && perf && lod.pendEtiquetas && <VelAgujasSvg items={perf.velocidad_agujas} />}
      {on('pendientes') && perf && lod.pendientes && <PendientesSvg items={perf.pendientes} etiquetas={lod.pendEtiquetas} />}

      {(on('subestaciones') || on('energia_zonas')) && data.subestaciones && (
        <EnergiaSvg items={on('subestaciones') ? data.subestaciones : data.subestaciones} yVias={yVias} zonas={on('energia_zonas')}
          etiquetas px={px} selId={selId('subestacion')} hov={hov} />
      )}

      {on('estados') && estado && (
        <EstadosSvg porElemento={porElementoDibujo} recientes={estado.recientes} ventanaMs={DESTELLO_MS} geo={geo} px={px} etiquetas={!general || effW < 3000} />
      )}

      {capaVias}
      <g style={{ strokeWidth: 2.4 * strokeK }}>{capaSecciones}</g>
      {resaltado}

      <g className="esq-hit">
        {data.secciones.map(s => <path key={s.id} d={tramoD(s.tramos)} style={{ strokeWidth: Math.max(4, 6 * strokeK) }} {...hov({ tipo: 'seccion', id: s.id })} />)}
      </g>

      <JuntasSvg juntas={data.juntas} fisicas={on('juntas_fisicas')} virtuales={on('juntas_virtuales')}
        lazos={on('lazos')} etiquetas={lod.lazosTxt} px={px} selIdx={selIdx('junta')} hov={hov} />

      <RotulosViaSvg rotulos={rotulosVia} px={px} x0={visX0} x1={visX1} cdv={on('cdv_nombres') && !general && effW < 1800}
        seccion={on('secciones_nombres') && !general && effW < 1100} longitudes={longitudes} />

      {on('avc') && data.avc.map(a => (
        <g key={a.id} className="esq-avc" {...hov({ tipo: 'avc', id: a.id })}>
          <rect x={a.x - 9} y={a.y - 2.2} width={18} height={4.4} rx={0.8} />
          <text x={a.x} y={a.y + 1} fontSize={2.2}>{a.id}</text>
        </g>
      ))}

      {on('balizas') && lod.balizas && <BalizasSvg balizas={data.balizas} etiquetas={lod.idsBaliza} selId={selId('baliza')} hov={hov} />}
      {on('psp') && lod.psp && (
        <g className="esq-psp">{data.psp.map((p, i) => <path key={i} d={`M${p.x} ${p.y - 3.2}L${p.x} ${p.y - 0.4}M${p.x - 0.6} ${p.y - 1.2}L${p.x} ${p.y - 0.4}L${p.x + 0.6} ${p.y - 1.2}`} />)}</g>
      )}
      {on('marcadores_al') && lod.psp && (
        <g className="esq-al">{data.marcadores_al.map((m, i) => <g key={i}><line x1={m.x} x2={m.x} y1={m.y - 2} y2={m.y + 2} /><title>{`AL ${m.senal}`}</title></g>)}</g>
      )}
      {on('fp') && lod.nombresSenal && (
        <g className="esq-fp">
          {data.puntos_libramiento.map((f, i) => (
            <g key={i}><path d={`M${f.x} ${f.y - 1.2}L${f.x + 1} ${f.y}L${f.x} ${f.y + 1.2}L${f.x - 1} ${f.y}Z`} /><title>{`FP ${f.aguja} · PK ${fmtPk(f.pk)}`}</title></g>
          ))}
        </g>
      )}
      {on('topes') && data.topes.map(tp => (
        <g key={tp.id} className="esq-tope"><line x1={tp.x} x2={tp.x} y1={tp.y - 2.6} y2={tp.y + 2.6} /><title>{tp.id}</title></g>
      ))}
      {on('agujas') && data.agujas.map(a => (
        <AgujaSvg key={a.id} a={a} data={data} k={strokeK} etiqueta={lod.nombresAguja} activo={selKey === `aguja:${a.id}` || hoverKey === `aguja:${a.id}`} hov={hov} />
      ))}
      {on('senales') && data.senales.map(s => (
        <SenalSvg key={s.id} s={s} etiqueta={lod.nombresSenal} activo={selKey === `senal:${s.id}` || hoverKey === `senal:${s.id}`} hov={hov} escala={Math.min(3, Math.max(1, 1.5 * px))} />
      ))}
      {on('equipos') && data.equipos && (
        <EquiposSvg equipos={data.equipos} reset={on('reset') && lod.reset} etiquetas={lod.equiposTxt} selIdx={selIdx('equipo')} hov={hov} />
      )}
      {on('armarios') && data.armarios && <ArmariosSvg armarios={data.armarios} etiquetas={lod.armariosTxt} selId={selId('armario')} hov={hov} />}

      {on('rutas') && rutasDibujo.length > 0 && <RutasSvg rutas={rutasDibujo} px={px} etiquetas={effW < 1500} />}
      {on('dbo') && dboItems.length > 0 && <DboSvg items={dboItems} geo={geo} px={px} />}
      {on('fantasmas') && fantasmas.length > 0 && <FantasmasSvg items={fantasmas} px={px} />}
      {on('trenes') && trenesDibujo.length > 0 && <TrenesSvg trenes={trenesDibujo} px={px} sel={trenSel} hov={hov} />}

      {sel?.tipo === 'pk' && eje.xAt(Number(sel.id)) != null && (
        <line x1={eje.xAt(Number(sel.id)) as number} x2={eje.xAt(Number(sel.id)) as number} y1={G_Y0} y2={G_Y1} className="esq-pk-sel" />
      )}
    </>
  );

  const cursorX = !general && cursorPk != null ? eje.xAt(cursorPk) : null;
  const estacionesHilo = data.estaciones.filter(e => e.x != null).map(e => ({ codigo: e.codigo, x: e.x as number }));

  return (
    <div className="esq-page" ref={pageRef} style={alto ? { height: alto } : undefined}>
      <div className="esq-toolbar">
        <form className="esq-search" onSubmit={e => {
          e.preventDefault();
          const r = resolver(ix, busqueda);
          if (r) { setBusquedaError(''); seleccionar(r, true); } else setBusquedaError('Sin coincidencia');
        }}>
          <Search size={14} />
          <input list="esq-ids" value={busqueda} placeholder="Buscar: CDV, sección, señal, aguja, baliza, ubicación, zona, S/E, PK (4+535), id del log…"
            onChange={e => { setBusqueda(e.target.value); setBusquedaError(''); }} />
          <datalist id="esq-ids">{ix.todos.map(id => <option key={id} value={id} />)}</datalist>
          {busquedaError && <span className="esq-search-err">{busquedaError}</span>}
        </form>
        <select className="esq-modo" value={modo} onChange={e => setModo(e.target.value as Modo)} title="Colorear vías por…">
          {MODOS.map(m => <option key={m.key} value={m.key}>Color: {m.label}</option>)}
        </select>
        <div className="esq-modes">
          <button className={general ? 'active' : ''} onClick={() => setVista('general')} title="Ver toda la línea (en filas)"><Rows3 size={14} /> Línea completa</button>
          <button className={!general ? 'active' : ''} onClick={() => setVista('detalle')} title="Detalle con zoom">Detalle</button>
          <button onClick={() => { setVista('detalle'); encuadrar([data.lienzo.area[0], 150, data.lienzo.area[2], 330], 9000); }} title="Toda la línea en una sola tira (detalle)"><Maximize2 size={14} /></button>
        </div>
        <div className="esq-tools">
          <button onClick={() => (general ? setVista('detalle') : zoomBtn(1 / 1.6))} title="Acercar"><ZoomIn size={15} /></button>
          <button onClick={() => (general ? undefined : zoomBtn(1.6))} disabled={general} title="Alejar"><ZoomOut size={15} /></button>
          <button className={showCapas ? 'active' : ''} onClick={() => setShowCapas(s => !s)} title="Capas"><Layers size={15} /></button>
          <button className={hiloAbierto ? 'active' : ''} onClick={() => setHiloAbierto(v => !v)} title="Reproducción y diagrama de hilo"><ChartNoAxesGantt size={15} /></button>
          <button className={panel ? 'active' : ''} onClick={() => setPanel(v => !v)} title={panel ? 'Ocultar panel' : 'Mostrar panel'}>
            {panel ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </button>
        </div>
        {showCapas && (
          <div className="esq-capas">
            {GRUPOS_CAPAS.map(g => (
              <div key={g.grupo} className="esq-capas-grupo">
                <h5>{g.grupo}</h5>
                {g.capas.map(c => (
                  <label key={c.key}>
                    <input type="checkbox" checked={capas.has(c.key)} onChange={() => setCapas(s => { const n = new Set(s); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} />
                    {c.label}
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <nav className="esq-stations">
        {data.estaciones.slice().sort((a, b) => (a.x ?? 0) - (b.x ?? 0)).map(e => (
          <button key={e.codigo} title={`${e.nombre} — ${e.mx}${e.enclavamiento ? ` — ${e.enclavamiento}` : ''}`}
            onClick={() => seleccionar({ tipo: 'estacion', id: e.codigo }, true)}
            className={`${sel?.tipo === 'estacion' && sel.id === e.codigo ? 'active' : ''}${(e.enclavamiento && ixlCaidos.has(e.enclavamiento)) ? ' caido' : ''}`}>
            {e.codigo}
          </button>
        ))}
      </nav>

      <div className="esq-main">
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
                    <clipPath key={i} id={`esq-fila-${i}`} clipPathUnits="userSpaceOnUse"><rect x={x0} y={G_Y0} width={filas.rowW} height={G_ROW} /></clipPath>
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
            {cursorPk != null ? `PK ${fmtPk(cursorPk)}` : ''}
            {general ? '  ·  clic o rueda: detalle' : '  ·  clic en punto vacío: todo lo que hay en ese PK'}
          </div>

          {panel && (
            <aside className="esq-panel">
              <div className="esq-tabs">
                <button className={tab === 'elemento' ? 'active' : ''} onClick={() => setTab('elemento')} title="Elemento"><Info size={13} /></button>
                <button className={tab === 'eventos' ? 'active' : ''} onClick={() => setTab('eventos')} title="Eventos"><ListTree size={13} /> Eventos</button>
                <button className={tab === 'estado' ? 'active' : ''} onClick={() => setTab('estado')} title="Estado en el instante"><Activity size={13} /> Estado</button>
                <button className={tab === 'fuentes' ? 'active' : ''} onClick={() => setTab('fuentes')} title="Fuentes"><FileText size={13} /></button>
                <button className={tab === 'observaciones' ? 'active' : ''} onClick={() => setTab('observaciones')} title="Observaciones"><AlertTriangle size={13} /></button>
                <button className={tab === 'leyenda' ? 'active' : ''} onClick={() => setTab('leyenda')}>Leyenda</button>
                <button className="esq-panel-cerrar" onClick={() => setPanel(false)} title="Ocultar panel"><PanelRightClose size={14} /></button>
              </div>
              <div className="esq-panel-body">
                {tab === 'elemento' && (sel
                  ? (sel.tipo === 'tren'
                    ? (mod && estado ? <TrenPanel mod={mod} clave={sel.id} t={t} estado={estado} onIr={tt => setT(tt)} /> : <p>Tren {sel.id}</p>)
                    : <Detalle ix={ix} r={sel} fuentes={fuentes} eje={eje} onSel={r => seleccionar(r, true)} onClose={() => setSel(null)} />)
                  : <p className="esq-muted">Seleccioná un elemento o un tren, buscá un identificador o un PK, o hacé clic en un punto vacío.</p>)}
                {tab === 'eventos' && (mod
                  ? <EventosPanel mod={mod} t={t} sel={sel} onIr={irAEvento} onSel={r => seleccionar(r, true)} />
                  : <p className="esq-muted">Elegí un día de eventos en la barra de reproducción.</p>)}
                {tab === 'estado' && (estado ? <EstadoPanel estado={estado} onSel={r => seleccionar(r, true)} /> : <p className="esq-muted">Sin eventos cargados.</p>)}
                {tab === 'fuentes' && <Fuentes data={data} />}
                {tab === 'observaciones' && <Observaciones data={data} onGo={(x, y) => encuadrar([x - 20, y - 10, x + 20, y + 10])} onSel={r => seleccionar(r, true)} ix={ix} />}
                {tab === 'leyenda' && <Leyenda modo={modo} />}
              </div>
            </aside>
          )}
        </div>

        {hiloAbierto && (
          <>
            <div className="esq-divisor" title="Arrastrar para agrandar o achicar el diagrama de hilo · doble clic: mitad de la pantalla"
              onDoubleClick={() => setHiloAlto(h => (h > window.innerHeight * 0.4 ? 200 : Math.round(window.innerHeight * 0.5)))}
              onPointerDown={e => {
                e.preventDefault();
                const y0 = e.clientY, h0 = hiloAlto;
                const mover = (ev: PointerEvent) => setHiloAlto(Math.max(60, Math.min(window.innerHeight - 260, h0 - (ev.clientY - y0))));
                const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); };
                window.addEventListener('pointermove', mover);
                window.addEventListener('pointerup', soltar);
              }}><span /></div>
            <BarraReproduccion dias={dias} diasLocales={diasLocales} archivoLocal={archivoLocal} actual={actual} cargando={cargando}
              onDiaStorage={onDiaStorage} onArchivo={onArchivo} onDiaLocal={onDiaLocal} mod={mod} t={t} setT={setT}
              reproduciendo={reproduciendo} setReproduciendo={setReproduciendo} velocidad={velocidad} setVelocidad={setVelocidad}
              span={span} setSpan={setSpan} marcha={marcha} setMarcha={setMarchaDesdeAhora} seguir={seguir} setSeguir={setSeguir}
              hayTrenSel={!!trenSel} onPaso={pasoEvento} onClasificarStorage={() => void onClasificarStorage()} onClasificarLocal={fs => void onClasificarLocal(fs)} />
            <div className="esq-hilo-wrap" style={{ height: mod || marchasHilo.length ? hiloAlto : 44 }}>
              {mod || marchasHilo.length ? (
                <Hilo mod={mod ?? { eventos: [], trenes: [], intervalos: [], numeros: new Map(), areasIhm: [], sesionesIhm: [], servidoresIhm: [], itinerarios: [], deslizamientos: [], t0: t, t1: t, conteo: new Map() }}
                  eje={eje} recorridos={recorridos} vx={visX0} vw={visX1 - visX0} t={t} span={span} onT={tt => { setT(tt); setReproduciendo(false); }}
                  onSpan={setSpan} sel={trenSel} onSel={c => (c ? seleccionar({ tipo: 'tren', id: c }) : undefined)} marchas={marchasHilo}
                  marcas={marcas} onMarca={i => { if (mod) irAEvento(mod.eventos[i]); }} estaciones={estacionesHilo} />
              ) : (
                <div className="esq-hilo-vacio">
                  Elegí un día de eventos (o abrí un Excel del ATS) para reproducirlo; sin eventos podés ver la marcha tipo de cada material.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default EsquematicoL1;
