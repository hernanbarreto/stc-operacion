#!/usr/bin/env node
// Cifra los datos del esquemático (derivados de planos C2-Confidencial) para que el repo y el hosting
// sólo contengan texto cifrado. La web los descifra en el navegador con la clave de datos.
//
// Formato: public/data/l1/manifest.json + un .bin por archivo.
//   clave  = PBKDF2-SHA256(clave de datos, sal, iteraciones) → AES-256-GCM
//   .bin   = AES-GCM(gzip(contenido)), IV de 12 bytes propio de cada archivo (en el manifiesto)
//
// Uso:
//   STC_CLAVE_DATOS='…' node tools/esquematico/cifrado.mjs --entrada datos_planos --salida public/data/l1
import { webcrypto } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const subtle = webcrypto.subtle;
export const ITERACIONES = 600000;
export const TEXTO_CONTROL = 'stc-operacion/esquematico-l1';

const b64 = (u8) => Buffer.from(u8).toString('base64');

export async function derivarClave(clave, sal, iteraciones = ITERACIONES) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** gzip + AES-GCM. Devuelve { iv, datos }. */
export async function cifrarBytes(key, bytes) {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, gzipSync(bytes, { level: 9 }));
  return { iv, datos: new Uint8Array(ct) };
}

function listar(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...listar(p));
    else out.push(p);
  }
  return out.sort();
}

export async function cifrarDirectorio(entrada, salida, clave) {
  const sal = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await derivarClave(clave, sal);
  if (existsSync(salida)) rmSync(salida, { recursive: true });
  mkdirSync(salida, { recursive: true });
  const control = await cifrarBytes(key, new TextEncoder().encode(TEXTO_CONTROL));
  const manifiesto = {
    v: 1,
    kdf: { alg: 'PBKDF2', hash: 'SHA-256', iteraciones: ITERACIONES, sal: b64(sal) },
    cifrado: 'AES-256-GCM sobre gzip',
    control: { iv: b64(control.iv), datos: b64(control.datos) },
    archivos: {},
  };
  const archivos = listar(entrada);
  let i = 0;
  let total = 0;
  for (const p of archivos) {
    const ruta = relative(entrada, p).split(sep).join('/');
    const { iv, datos } = await cifrarBytes(key, readFileSync(p));
    const nombre = `d${String(i++).padStart(3, '0')}.bin`;
    writeFileSync(join(salida, nombre), datos);
    total += datos.length;
    manifiesto.archivos[ruta] = { f: nombre, iv: b64(iv) };
  }
  writeFileSync(join(salida, 'manifest.json'), JSON.stringify(manifiesto));
  return { archivos: archivos.length, bytes: total };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(k);
    return i >= 0 ? process.argv[i + 1] : d;
  };
  const clave = process.env.STC_CLAVE_DATOS;
  if (!clave || clave.length < 16) {
    console.error('Falta STC_CLAVE_DATOS (mínimo 16 caracteres).');
    process.exit(2);
  }
  const r = await cifrarDirectorio(arg('--entrada', 'datos_planos'), arg('--salida', 'public/data/l1'), clave);
  console.log(`${r.archivos} archivos cifrados, ${(r.bytes / 1e6).toFixed(2)} MB`);
}
