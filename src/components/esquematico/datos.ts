// Carga y descifrado de los datos del esquemático. En el repo y en el hosting sólo hay texto cifrado
// (public/data/l1, generado con tools/esquematico/cifrado.mjs): los planos de origen son C2-Confidencial.
// La clave de datos se pide una vez (o se lee de Firestore para usuarios autenticados) y nunca se versiona.

export interface Manifiesto {
  v: number;
  kdf: { alg: 'PBKDF2'; hash: 'SHA-256'; iteraciones: number; sal: string };
  control: { iv: string; datos: string };
  archivos: Record<string, { f: string; iv: string }>;
}

export const TEXTO_CONTROL = 'stc-operacion/esquematico-l1';

export function deB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function aB64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

/** Clave AES-256-GCM a partir de la clave de datos (PBKDF2-SHA256 con la sal del manifiesto). */
export async function derivarClave(clave: string, m: Manifiesto, extraible = false): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: deB64(m.kdf.sal), iterations: m.kdf.iteraciones },
    base, { name: 'AES-GCM', length: 256 }, extraible, ['decrypt'],
  );
}

export async function importarClaveCruda(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['decrypt']);
}

async function gunzip(u8: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const flujo = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

/** AES-GCM + gunzip. Lanza si la clave no corresponde (falla la etiqueta de autenticación). */
export async function descifrar(key: CryptoKey, iv: Uint8Array<ArrayBuffer>, datos: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const plano = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, datos);
  return gunzip(new Uint8Array(plano));
}

export async function claveValida(key: CryptoKey, m: Manifiesto): Promise<boolean> {
  try {
    const t = await descifrar(key, deB64(m.control.iv), deB64(m.control.datos));
    return new TextDecoder().decode(t) === TEXTO_CONTROL;
  } catch {
    return false;
  }
}

type Lector = (ruta: string) => Promise<Uint8Array<ArrayBuffer>>;

const lectorHttp = (base: string): Lector => async (f: string) => {
  const r = await fetch(`${base}/${f}`);
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${f}`);
  return new Uint8Array(await r.arrayBuffer());
};

/** Acceso a los archivos cifrados (manifiesto + .bin) con caché de lo ya descifrado. */
export class AlmacenCifrado {
  manifiesto: Manifiesto | null = null;
  private key: CryptoKey | null = null;
  private urls = new Map<string, Promise<string>>();
  private readonly leerBin: Lector;

  constructor(base = '/data/l1', lector?: Lector) {
    this.leerBin = lector ?? lectorHttp(base);
  }

  async iniciar(): Promise<Manifiesto> {
    if (!this.manifiesto) this.manifiesto = JSON.parse(new TextDecoder().decode(await this.leerBin('manifest.json')));
    return this.manifiesto as Manifiesto;
  }

  get desbloqueado(): boolean {
    return this.key != null;
  }

  /** Prueba una clave de datos; si es correcta queda en uso y devuelve la clave AES cruda (para recordarla). */
  async desbloquear(clave: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const m = await this.iniciar();
    const key = await derivarClave(clave.trim(), m, true);
    if (!(await claveValida(key, m))) return null;
    this.key = key;
    return new Uint8Array(await crypto.subtle.exportKey('raw', key));
  }

  async desbloquearCruda(raw: Uint8Array<ArrayBuffer>): Promise<boolean> {
    const m = await this.iniciar();
    try {
      const key = await importarClaveCruda(raw);
      if (!(await claveValida(key, m))) return false;
      this.key = key;
      return true;
    } catch {
      return false;
    }
  }

  async leer(ruta: string): Promise<Uint8Array<ArrayBuffer>> {
    const m = await this.iniciar();
    if (!this.key) throw new Error('Datos bloqueados: falta la clave de datos');
    const a = m.archivos[ruta];
    if (!a) throw new Error(`No existe ${ruta} en los datos cifrados`);
    return descifrar(this.key, deB64(a.iv), await this.leerBin(a.f));
  }

  async leerJson<T>(ruta: string): Promise<T> {
    return JSON.parse(new TextDecoder().decode(await this.leer(ruta))) as T;
  }

  /** URL local (blob:) de un SVG descifrado, para usar en <image href>. */
  urlSvg(ruta: string): Promise<string> {
    let p = this.urls.get(ruta);
    if (!p) {
      p = this.leer(ruta).then(b => URL.createObjectURL(new Blob([b], { type: 'image/svg+xml' })));
      this.urls.set(ruta, p);
      p.catch(() => this.urls.delete(ruta));
    }
    return p;
  }
}
