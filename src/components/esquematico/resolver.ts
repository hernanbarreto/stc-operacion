// Resolución de identificadores (de los planos o del log de eventos del ATS) a elementos del esquemático.
// Mismas reglas que tools/esquematico/validar_log.py, más los elementos que sólo existen en los planos
// (balizas, ubicaciones de equipos de CDV, zonas RAUZ/ASR, subestaciones, PK).
import type {
  Anden, Armario, Avc, Aguja, Baliza, Cdv, ElementoRef, Esquematico, Junta, Seccion, Senal, Subestacion, Zona,
  ZonaVelocidad, Pendiente,
} from './types';

export const AREAS = ['PAN', 'ZAR', 'GOM', 'BOU', 'BAL', 'MOC', 'SLA', 'CAN', 'MER', 'PIN', 'ISA', 'SAL',
  'BAD', 'CUA', 'INS', 'SEV', 'CHP', 'JNA', 'TCY', 'OBS'] as const;

export interface Indice {
  data: Esquematico;
  seccion: Map<string, Seccion>;
  cdv: Map<string, Cdv>;           // incluye alias del plano de CDV
  senal: Map<string, Senal>;
  aguja: Map<string, Aguja>;
  avc: Map<string, Avc>;           // incluye alias (p. ej. AVC20PIN)
  anden: Map<string, Anden>;       // ids lógicos: BAL1, PAN42, OBS2…
  bfu: Map<string, Anden>;         // BFU1AOBS → andén
  tgmt: Map<number, ElementoRef>;  // id de estación TGMT → estación o AVC
  baliza: Map<string, Baliza>;
  armario: Map<string, Armario>;
  zona: Map<string, Zona>;
  subestacion: Map<string, Subestacion>;
  todos: string[];                 // ids para autocompletar
}

export function construirIndice(data: Esquematico): Indice {
  const seccion = new Map(data.secciones.map(s => [s.id, s]));
  const cdv = new Map<string, Cdv>();
  for (const c of data.cdvs) {
    cdv.set(c.id, c);
    for (const a of c.alias) cdv.set(a, c);
  }
  const senal = new Map(data.senales.map(s => [s.id, s]));
  const aguja = new Map(data.agujas.map(a => [a.id, a]));
  const avc = new Map<string, Avc>();
  for (const a of data.avc) {
    avc.set(a.id, a);
    for (const al of a.alias ?? []) avc.set(al, a);
  }
  const anden = new Map<string, Anden>();
  const bfu = new Map<string, Anden>();
  for (const p of data.andenes) {
    for (const id of p.ids) if (!anden.has(id)) anden.set(id, p);
    if (p.estacion) for (const b of p.bfu) bfu.set(b + p.estacion, p);
  }
  const tgmt = new Map<number, ElementoRef>();
  for (const e of data.estaciones) tgmt.set(e.tgmt_id, { tipo: 'estacion', id: e.codigo });
  for (const a of data.avc) if (a.tgmt_id != null) tgmt.set(a.tgmt_id, { tipo: 'avc', id: a.id });
  const baliza = new Map(data.balizas.map(b => [b.id, b]));
  const armario = new Map<string, Armario>();
  for (const a of data.armarios ?? []) {
    armario.set(a.clave, a);
    if (!armario.has(a.id)) armario.set(a.id, a);
  }
  const zona = new Map((data.zonas ?? []).map(z => [z.id, z]));
  const subestacion = new Map((data.subestaciones ?? []).filter(s => s.nombre).map(s => [s.nombre as string, s]));
  const todos = [
    ...seccion.keys(), ...data.cdvs.map(c => c.id), ...senal.keys(), ...aguja.keys(),
    ...data.avc.map(a => a.id), ...anden.keys(), ...data.estaciones.map(e => e.codigo),
    ...baliza.keys(), ...armario.keys(), ...zona.keys(), ...[...subestacion.keys()].map(n => `S/E ${n}`),
  ];
  return {
    data, seccion, cdv, senal, aguja, avc, anden, bfu, tgmt, baliza, armario, zona, subestacion,
    todos: [...new Set(todos)].sort(),
  };
}

/** CDV físico o sección (virtual / de aguja), con o sin prefijo de área del ATS (p. ej. BALC22BAL). */
export function resolverVia(ix: Indice, ident: string): ElementoRef | null {
  const cands = [ident];
  if (ident.length > 3 && (AREAS as readonly string[]).includes(ident.slice(0, 3))) cands.push(ident.slice(3));
  for (const c of cands) {
    if (ix.seccion.has(c)) return { tipo: 'seccion', id: c };
    const cd = ix.cdv.get(c);
    if (cd) return { tipo: 'cdv', id: cd.id };
  }
  return null;
}

/** '4+535.694' / '4+535' / '-0+031.040' → metros. */
export function parsePk(s: string): number | null {
  const m = /^(-?)(\d+)\+(\d{1,3})(?:[.,](\d+))?$/.exec(s.trim());
  if (!m) return null;
  const v = Number(m[2]) * 1000 + Number(m[3]) + (m[4] ? Number(`0.${m[4]}`) : 0);
  return m[1] ? -v : v;
}

/** Cualquier identificador: secciones/CDV, señales (sufijo LRTB del log), agujas, BFU, AVC, andenes,
 *  estaciones (código o id TGMT 101–123 / 24–46), balizas, ubicaciones de equipos de CDV, zonas, S/E o un PK. */
export function resolver(ix: Indice, raw: string): ElementoRef | null {
  const ident = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!ident) return null;
  const pk = parsePk(ident);
  if (pk != null) return { tipo: 'pk', id: String(pk) };
  if (/^\d+$/.test(ident)) return ix.tgmt.get(Number(ident)) ?? null;
  if (ix.aguja.has(ident)) return { tipo: 'aguja', id: ident };
  const sig = ident.replace(/LRTB$/, '');
  if (ix.senal.has(sig)) return { tipo: 'senal', id: sig };
  const v = resolverVia(ix, ident);
  if (v) return v;
  if (ix.bfu.has(ident)) return { tipo: 'bfu', id: ident };
  const av = ix.avc.get(ident.replace(/\*$/, ''));
  if (av) return { tipo: 'avc', id: av.id };
  if (ix.anden.has(ident)) return { tipo: 'anden', id: ident };
  const ba = ident.replace(/^\*/, '');
  if (ix.baliza.has(ba)) return { tipo: 'baliza', id: ba };
  const arm = ix.armario.get(ident);
  if (arm) return { tipo: 'armario', id: arm.clave };
  if (ix.zona.has(ident)) return { tipo: 'zona', id: ident };
  const se = raw.trim().toUpperCase().replace(/^S\/E\s*/, '');
  if (ix.subestacion.has(se)) return { tipo: 'subestacion', id: se };
  if ((AREAS as readonly string[]).includes(ident)) return { tipo: 'estacion', id: ident };
  return null;
}

type Caja = [number, number, number, number];

/** Caja envolvente (coordenadas del lienzo) para encuadrar un elemento. */
export function cajaDe(ix: Indice, ref: ElementoRef): Caja | null {
  const fromTramos = (ts: [number, number, number, number][]) => {
    if (!ts.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of ts) {
      x0 = Math.min(x0, t[0], t[2]); x1 = Math.max(x1, t[0], t[2]);
      y0 = Math.min(y0, t[1], t[3]); y1 = Math.max(y1, t[1], t[3]);
    }
    return [x0, y0, x1, y1] as Caja;
  };
  switch (ref.tipo) {
    case 'seccion': { const s = ix.seccion.get(ref.id); return s ? fromTramos(s.tramos) : null; }
    case 'cdv': { const c = ix.cdv.get(ref.id); return c ? fromTramos(c.tramos) : null; }
    case 'senal': { const s = ix.senal.get(ref.id); return s ? [s.x - 4, s.y - 8, s.x + 4, s.y + 8] : null; }
    case 'aguja': { const a = ix.aguja.get(ref.id); return a && a.x != null && a.y != null ? [a.x - 6, a.y - 6, a.x + 6, a.y + 6] : null; }
    case 'anden': { const p = ix.anden.get(ref.id); return p ? [p.x0, Math.min(p.y_borde, p.y_via) - 4, p.x1, Math.max(p.y_borde, p.y_via) + 4] : null; }
    case 'bfu': { const p = ix.bfu.get(ref.id); return p ? [p.x0, Math.min(p.y_borde, p.y_via) - 4, p.x1, Math.max(p.y_borde, p.y_via) + 4] : null; }
    case 'avc': { const a = ix.avc.get(ref.id); return a ? [a.x - 10, a.y - 6, a.x + 10, a.y + 6] : null; }
    case 'baliza': { const b = ix.baliza.get(ref.id); return b ? [b.x - 5, b.y - 6, b.x + 5, b.y + 4] : null; }
    case 'junta': { const j = ix.data.juntas[Number(ref.id)]; return j ? [j.x - 6, j.y - 6, j.x + 6, j.y + 6] : null; }
    case 'zona': { const z = ix.zona.get(ref.id); return z ? [z.x0, z.y0, z.x1, z.y1] : null; }
    case 'armario': {
      const a = ix.armario.get(ref.id);
      return a && a.x0 != null && a.x1 != null ? [a.x0, 190, a.x1, 260] : null;
    }
    case 'subestacion': { const s = ix.subestacion.get(ref.id); return s && s.x != null ? [s.x - 25, 150, s.x + 25, 330] : null; }
    case 'equipo': {
      const e = ix.data.equipos?.[Number(ref.id)];
      return e && e.x != null ? [e.x - 15, (e.y ?? 228) - 15, e.x + 15, (e.y ?? 228) + 15] : null;
    }
    case 'zona_velocidad': {
      const z = ix.data.perfil?.zonas_velocidad[Number(ref.id)];
      return z ? [Math.min(z.x0, z.x1), z.y - 8, Math.max(z.x0, z.x1), z.y + 8] : null;
    }
    case 'pk': {
      const x = construirEjePk(ix.data).xAt(Number(ref.id));
      return x == null ? null : [x - 30, 190, x + 30, 260];
    }
    case 'tren':
      return null;   // la posición depende del instante de la reproducción
    case 'estacion': {
      const ps = ix.data.andenes.filter(p => p.estacion === ref.id);
      if (!ps.length) return null;
      return [Math.min(...ps.map(p => p.x0)) - 20, 140, Math.max(...ps.map(p => p.x1)) + 20, 320];
    }
  }
}

export interface EjePk {
  pkAt: (x: number) => number | null;
  xAt: (pk: number) => number | null;
}

/** Interpolación lineal a tramos (y extrapolación con la pendiente del extremo). xs crecientes. */
export function interpolar(xs: number[], ys: number[], v: number): number | null {
  const n = xs.length;
  if (n < 2) return null;
  let i: number;
  if (v <= xs[0]) i = 1;
  else if (v >= xs[n - 1]) i = n - 1;
  else {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= v) lo = mid; else hi = mid;
    }
    i = hi;
  }
  const x0 = xs[i - 1], x1 = xs[i];
  if (x1 === x0) return ys[i - 1];
  return ys[i - 1] + ((v - x0) * (ys[i] - ys[i - 1])) / (x1 - x0);
}

/** Eje x ↔ PK a partir de puntos [x, pk] con PK decreciente en x (regla del plano). */
export function ejeDesdeRegla(pts: [number, number][]): EjePk {
  const ord = [...pts].sort((a, b) => a[0] - b[0]);
  const X = ord.map(p => p[0]);
  const P = ord.map(p => p[1]);
  const Pr = [...P].reverse();
  const Xr = [...X].reverse();
  return { pkAt: (x: number) => interpolar(X, P, x), xAt: (pk: number) => interpolar(Pr, Xr, pk) };
}

/** Eje del lienzo: regla de PK del plano de señalización; si no está, juntas de vía 1 con PK. */
export function construirEjePk(data: Esquematico): EjePk {
  if (data.regla_sen && data.regla_sen.length >= 2) return ejeDesdeRegla(data.regla_sen);
  const pts = data.eje_pk.filter(p => p[2] === 'V1').map(p => [p[0], p[1]] as [number, number]).sort((a, b) => a[0] - b[0]);
  const mono: [number, number][] = [];
  for (const p of pts) if (!mono.length || p[1] < mono[mono.length - 1][1]) mono.push(p);
  return ejeDesdeRegla(mono);
}

export function fmtPk(m: number | null | undefined): string {
  if (m == null || !isFinite(m)) return '—';
  const neg = m < 0;
  const a = Math.abs(m);
  const km = Math.floor(a / 1000);
  const r = a - km * 1000;
  return `${neg ? '-' : ''}${km}+${r.toFixed(3).padStart(7, '0')}`;
}

// ───────────────────────── perfil de vía ─────────────────────────

const solapa = (a0: number, a1: number, b0: number, b1: number) =>
  Math.max(Math.min(a0, a1), Math.min(b0, b1)) <= Math.min(Math.max(a0, a1), Math.max(b0, b1));

/** Zonas de velocidad, curvas y pendientes de una vía que se solapan con el rango de x dado. */
export function perfilEn(data: Esquematico, vias: string[], x0: number, x1: number): {
  velocidad: ZonaVelocidad[]; pendientes: Pendiente[];
} {
  const p = data.perfil;
  if (!p) return { velocidad: [], pendientes: [] };
  const vs = new Set(vias.flatMap(v => v.split('/')));
  const velocidad = p.zonas_velocidad.filter(z => z.via && vs.has(z.via) && solapa(z.x0, z.x1, x0, x1));
  const pendientes = p.pendientes.filter(s => s.via && vs.has(s.via) && s.x0 != null && s.x1 != null
    && solapa(s.x0, s.x1, x0, x1));
  return { velocidad, pendientes };
}

/** Rango de x de un conjunto de tramos. */
export function rangoX(ts: [number, number, number, number][]): [number, number] {
  const xs = ts.flatMap(t => [t[0], t[2]]);
  return [Math.min(...xs), Math.max(...xs)];
}

/** Juntas físicas en los extremos de un CDV (por vía y x). */
export function juntasDe(data: Esquematico, c: Cdv): { j: Junta; i: number }[] {
  const [a, b] = rangoX(c.tramos);
  return data.juntas
    .map((j, i) => ({ j, i }))
    .filter(({ j }) => j.tipo === 'fisica' && (Math.abs(j.x - a) < 0.8 || Math.abs(j.x - b) < 0.8)
      && c.tramos.some(t => Math.min(t[0], t[2]) - 0.8 <= j.x && j.x <= Math.max(t[0], t[2]) + 0.8
        && Math.abs((t[1] + t[3]) / 2 - j.y) < 3));
}

/**
 * Sentido de salida de los trenes de un andén: vía 1 hacia Observatorio, vía 2 hacia Pantitlán; en las terminales
 * los trenes salen hacia la otra punta; en otras vías, el de la señal de salida en la punta del andén.
 */
export function sentidoSalida(data: Esquematico, a: Anden): 'OBS' | 'PAN' {
  const vias = (a.via ?? '').split('/');
  if (vias.includes('V1') && !vias.includes('V2')) return 'OBS';
  if (vias.includes('V2') && !vias.includes('V1')) return 'PAN';
  if (a.estacion === 'PAN') return 'OBS';
  if (a.estacion === 'OBS') return 'PAN';
  const ss = data.senales.filter(s => s.sentido && Math.abs(s.y - a.y_via) < 3 && s.x >= a.x0 - 15 && s.x <= a.x1 + 15);
  const obs = ss.some(s => s.sentido === 'OBS' && s.x <= a.x0 + 10), pan = ss.some(s => s.sentido === 'PAN' && s.x >= a.x1 - 10);
  return pan && !obs ? 'PAN' : 'OBS';
}

/** Lugar del cuadrado DBO: en la punta del andén por donde sale el tren (según el sentido de avance de su vía),
 *  sobre el borde del andén que da a esa vía. */
export function lugarDbo(a: Anden, sentido: 'OBS' | 'PAN', px: number): [number, number] {
  const w = 30 * px;
  const largo = a.x1 - a.x0;
  const x = largo < w * 1.2 ? (a.x0 + a.x1) / 2 : sentido === 'OBS' ? a.x0 + w / 2 + 2 * px : a.x1 - w / 2 - 2 * px;
  const yAnden = a.lado === 'arriba' ? a.y_borde - 2.1 : a.y_borde + 2.1;
  return [x, (yAnden + a.y_via) / 2];
}
