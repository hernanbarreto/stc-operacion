// Ubicación y validación del JSON del esquemático (sin dependencias de Firebase, para poder probarlo).
import type { Esquematico } from './types';

export const RUTA_DATOS = 'esquematico/esquematico_l1.json';
export const ESQUEMA = 'stc-operacion/esquematico-l1';

/** Valida que el contenido sea un esquemático generado por tools/esquematico/extract.py. */
export function validarEsquematico(d: unknown): d is Esquematico {
  const e = d as Partial<Esquematico> | null;
  return !!e && e.esquema === ESQUEMA && Array.isArray(e.cdvs) && Array.isArray(e.secciones) && Array.isArray(e.vias);
}
