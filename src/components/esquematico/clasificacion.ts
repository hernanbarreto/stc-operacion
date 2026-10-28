// Clasificación de los eventos del log del ATS por plantilla y forma del texto, para saber qué tipos existen,
// cuántos hay y cuáles ya se representan en el esquemático. Se acumula archivo por archivo y se exporta a CSV.
import { PLANTILLAS, type FilaLog } from './eventos';
import { fechaDia } from './fecha';

export interface FilaClasif {
  plantilla: string;
  eventtype: string;
  forma: string;          // texto con identificadores y números reemplazados por #
  filas: number;          // filas del Excel
  eventos: number;        // sin duplicados (mismo tipo y texto en menos de 2 s)
  primera: number;
  ultima: number;
  ejemplo: string;
  archivos: Set<string>;
}

export type Clasificacion = Map<string, FilaClasif>;

const ESTADO_RE = /\s\.\s(Abierta|Normalizada|Cerrada|Reconocida)\s*$/;

/** Forma del texto: sin el estado de la alarma y con identificadores (todo lo que lleva dígitos) como #. */
export function formaDe(desc: string): string {
  return desc.replace(ESTADO_RE, '').replace(/\b[A-Za-z_*]*\d[\w*#.]*\b/g, '#').replace(/\s+/g, ' ').trim().slice(0, 160);
}

export function clasificar(filas: FilaLog[], archivo: string, acum: Clasificacion = new Map()): Clasificacion {
  const ultimo = new Map<string, number>();
  for (const f of filas) {
    const tpl = PLANTILLAS.find(p => (p.tipos.includes(f.tipo) || p.tipos.includes('*')) && p.re.test(f.desc));
    const plantilla = tpl?.id ?? 'sin_plantilla';
    const forma = formaDe(f.desc);
    const k = `${plantilla}|${f.tipo}|${forma}`;
    let c = acum.get(k);
    if (!c) {
      c = { plantilla, eventtype: f.tipo, forma, filas: 0, eventos: 0, primera: f.t, ultima: f.t, ejemplo: f.desc, archivos: new Set() };
      acum.set(k, c);
    }
    c.filas++;
    c.archivos.add(archivo);
    if (f.t < c.primera) c.primera = f.t;
    if (f.t > c.ultima) c.ultima = f.t;
    const dk = `${f.tipo}|${f.desc}`;
    const prev = ultimo.get(dk);
    ultimo.set(dk, f.t);
    if (prev == null || f.t - prev >= 2000) c.eventos++;
  }
  return acum;
}

const campo = (v: string | number) => {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV (UTF-8 con BOM para que Excel respete los acentos), ordenado por plantilla y cantidad. */
export function aCsv(c: Clasificacion): string {
  const muestra = new Map(PLANTILLAS.map(p => [p.id, p.muestra]));
  const cab = ['plantilla', 'eventtype', 'se_muestra', 'como_se_muestra', 'forma_del_texto', 'filas_excel', 'eventos_sin_duplicados',
    'primera_fecha', 'ultima_fecha', 'archivos', 'ejemplo'];
  const filas = [...c.values()].sort((a, b) => a.plantilla.localeCompare(b.plantilla) || b.eventos - a.eventos);
  const lineas = filas.map(f => {
    const m = muestra.get(f.plantilla);
    const estado = m == null ? 'no reconocido' : m === '' ? 'pendiente' : 'sí';
    return [f.plantilla, f.eventtype, estado, m ?? '', f.forma, f.filas, f.eventos, fechaDia(f.primera), fechaDia(f.ultima), f.archivos.size, f.ejemplo]
      .map(campo).join(',');
  });
  return `\ufeff${cab.join(',')}\n${lineas.join('\n')}\n`;
}
