// Datos del esquemático en Firebase Storage (lectura y escritura sólo con usuario autenticado).
// No se publican en /public ni en el repositorio: derivan de planos C2-Confidencial.
import { getBlob, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../../firebase';
import type { Esquematico } from './types';
import { RUTA_DATOS, validarEsquematico } from './esquema';

export { RUTA_DATOS, validarEsquematico };

const ESPERA_MS = 25000;

function conLimite<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((ok, mal) => {
    const h = setTimeout(() => mal(new Error(msg)), ms);
    p.then(v => { clearTimeout(h); ok(v); }, e => { clearTimeout(h); mal(e); });
  });
}

/** Lee el esquemático de Storage; null si todavía no se cargó. */
export async function leerEsquematico(): Promise<Esquematico | null> {
  try {
    const blob = await conLimite(getBlob(ref(storage, RUTA_DATOS)), ESPERA_MS, 'Firebase Storage no respondió (¿sin conexión?)');
    const d = JSON.parse(await blob.text());
    return validarEsquematico(d) ? d : null;
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'storage/object-not-found') return null;
    throw e;
  }
}

export async function leerArchivoLocal(f: File): Promise<Esquematico> {
  const d = JSON.parse(await f.text());
  if (!validarEsquematico(d)) throw new Error('El archivo no es un esquemático de la Línea 1 (esquematico_l1.json)');
  return d;
}

/** Sube el esquemático a Storage (reemplaza el anterior). */
export async function subirEsquematico(f: File): Promise<Esquematico> {
  const d = await leerArchivoLocal(f);
  await uploadBytes(ref(storage, RUTA_DATOS), f, { contentType: 'application/json' });
  return d;
}
