// Worker: lee el Excel (o CSV) de eventos del ATS y devuelve las filas de un día, sin bloquear la interfaz.
import { read, utils } from 'xlsx';
import { fechaDia, parseFecha } from './fecha';

interface Fila { t: number; tipo: string; desc: string }
const archivos = new Map<string, Map<string, Fila[]>>();

type Msg =
  | { op: 'abrir'; id: number; nombre: string; buffer: ArrayBuffer }
  | { op: 'dia'; id: number; nombre: string; fecha: string };

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.op === 'abrir') {
      if (!archivos.has(m.nombre)) {
        const bytes = new Uint8Array(m.buffer);
        // .xlsx (zip, 'PK') y .xls (OLE) se leen como binario; un CSV se decodifica como UTF-8 (acentos del log)
        const binario = (bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf);
        const wb = binario
          ? read(bytes, { type: 'array', cellDates: false })
          : read(new TextDecoder('utf-8').decode(bytes), { type: 'string', cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const filas = utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
        const cab = (filas[0] ?? []).map(c => String(c ?? '').trim().toLowerCase());
        const col = (nombre: string, def: number) => { const i = cab.indexOf(nombre); return i >= 0 ? i : def; };
        const cTipo = col('eventtype', 0), cT = col('sourcetime', 1), cDesc = col('description', 2);
        const porDia = new Map<string, Fila[]>();
        for (let i = 1; i < filas.length; i++) {
          const r = filas[i];
          if (!r) continue;
          const t = parseFecha(r[cT]);
          if (t == null) continue;
          const f = { t, tipo: String(r[cTipo] ?? '').trim(), desc: String(r[cDesc] ?? '').trim() };
          const k = fechaDia(t);
          const l = porDia.get(k);
          if (l) l.push(f); else porDia.set(k, [f]);
        }
        for (const l of porDia.values()) l.sort((a, b) => a.t - b.t);
        archivos.set(m.nombre, porDia);
      }
      const dias = [...(archivos.get(m.nombre) as Map<string, Fila[]>).entries()]
        .map(([fecha, l]) => ({ fecha, n: l.length })).sort((a, b) => a.fecha.localeCompare(b.fecha));
      self.postMessage({ id: m.id, ok: true, dias });
    } else {
      const filas = archivos.get(m.nombre)?.get(m.fecha) ?? [];
      self.postMessage({ id: m.id, ok: true, filas });
    }
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
