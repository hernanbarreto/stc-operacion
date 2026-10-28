// Pruebas del esquemático de la Línea 1: cifrado de los datos, resolución de identificadores (planos y log del
// ATS), ejes de PK, correspondencia entre las reglas de los dos planos e integridad del JSON generado por
// tools/esquematico. Los datos en claro están en datos_planos/ (no versionado); si no están, se descifran los de
// public/data/l1 con STC_CLAVE_DATOS; sin ninguno de los dos se omiten las pruebas de integridad.
import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Esquematico } from '../src/components/esquematico/types';
import {
  cajaDe, construirEjePk, construirIndice, ejeDesdeRegla, fmtPk, interpolar, parsePk, perfilEn, rangoX, resolver,
  tramosHomologos,
} from '../src/components/esquematico/resolver';
import { AlmacenCifrado } from '../src/components/esquematico/datos';
// @ts-expect-error módulo ESM de Node sin tipos
import { cifrarDirectorio } from '../tools/esquematico/cifrado.mjs';

const RAIZ = resolve(__dirname, '..');
const PLANO = join(RAIZ, 'datos_planos/esquematico_l1.json');
const CIFRADO = join(RAIZ, 'public/data/l1');
const CLAVE = process.env.STC_CLAVE_DATOS;
const lectorFs = (dir: string) => async (f: string) => new Uint8Array(readFileSync(join(dir, f)));
const hayDatos = existsSync(PLANO) || (!!CLAVE && existsSync(join(CIFRADO, 'manifest.json')));
let data = {} as Esquematico;

beforeAll(async () => {
  if (existsSync(PLANO)) data = JSON.parse(readFileSync(PLANO, 'utf-8'));
  else if (hayDatos) {
    const a = new AlmacenCifrado('', lectorFs(CIFRADO));
    if (!(await a.desbloquear(CLAVE as string))) throw new Error('STC_CLAVE_DATOS no corresponde a public/data/l1');
    data = await a.leerJson<Esquematico>('esquematico_l1.json');
  }
});

describe('cifrado de datos', () => {
  it('lo cifrado con tools/esquematico/cifrado.mjs se descifra en la web sólo con la clave correcta', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'esq-'));
    const ent = join(tmp, 'plano');
    mkdirSync(join(ent, 'planos/x'), { recursive: true });
    writeFileSync(join(ent, 'esquematico_l1.json'), JSON.stringify({ hola: 'línea 1', n: [1, 2, 3] }));
    writeFileSync(join(ent, 'planos/x/t00.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const clave = 'clave-de-prueba-0123456789';
    await cifrarDirectorio(ent, join(tmp, 'l1'), clave);
    const a = new AlmacenCifrado('', lectorFs(join(tmp, 'l1')));
    expect(await a.desbloquear('otra-clave-0123456789')).toBeNull();
    const raw = await a.desbloquear(clave);
    expect(raw?.length).toBe(32);
    expect(await a.leerJson('esquematico_l1.json')).toEqual({ hola: 'línea 1', n: [1, 2, 3] });
    expect(new TextDecoder().decode(await a.leer('planos/x/t00.svg'))).toContain('<svg');
    const b = new AlmacenCifrado('', lectorFs(join(tmp, 'l1')));
    expect(await b.desbloquearCruda(raw as Uint8Array<ArrayBuffer>)).toBe(true);
    await expect(new AlmacenCifrado('', lectorFs(join(tmp, 'l1'))).leer('esquematico_l1.json')).rejects.toThrow();
  }, 30000);

  it('el repo no contiene los datos en claro', () => {
    for (const f of ['public/data/esquematico_l1.json', 'public/data/planos']) expect(existsSync(join(RAIZ, f))).toBe(false);
    const m = JSON.parse(readFileSync(join(CIFRADO, 'manifest.json'), 'utf-8'));
    expect(m.kdf.iteraciones).toBeGreaterThanOrEqual(600000);
    expect(Object.keys(m.archivos)).toContain('esquematico_l1.json');
  });
});

describe('PK', () => {
  it('parsea y formatea', () => {
    expect(parsePk('4+535.694')).toBeCloseTo(4535.694, 6);
    expect(parsePk('4+535')).toBe(4535);
    expect(parsePk('17+213,650')).toBeCloseTo(17213.65, 6);
    expect(parsePk('-0+031.040')).toBeCloseTo(-31.04, 6);
    expect(parsePk('C22BAL')).toBeNull();
    expect(fmtPk(4535.694)).toBe('4+535.694');
    expect(fmtPk(-31.04)).toBe('-0+031.040');
    expect(fmtPk(null)).toBe('—');
  });

  it('interpola y extrapola a tramos', () => {
    expect(interpolar([0, 10, 20], [100, 50, 0], 5)).toBe(75);
    expect(interpolar([0, 10, 20], [100, 50, 0], 25)).toBe(-25);
    expect(interpolar([0, 10, 20], [100, 50, 0], -10)).toBe(150);
    expect(interpolar([1], [1], 0)).toBeNull();
  });

  it('el eje de una regla es invertible', () => {
    const eje = ejeDesdeRegla([[0, 1000], [10, 900], [80, 800], [90, 700]]);
    for (const x of [-5, 0, 3, 10, 45, 89, 120]) {
      const pk = eje.pkAt(x) as number;
      expect(eje.xAt(pk)).toBeCloseTo(x, 6);
    }
  });

  it('tramos homólogos llevan cada PK a la misma x en ambos planos', () => {
    const sen: [number, number][] = [[0, 300], [70, 200], [84, 100], [154, 0]];
    const cdv: [number, number][] = [[0, 300], [14, 200], [84, 100], [98, 0]];
    const ts = tramosHomologos(sen, cdv);
    expect(ts.length).toBe(5);
    const warp = (xc: number) => {
      const t = ts.find(t => t.xc0 <= xc && xc <= t.xc1);
      if (!t) return null;
      return t.xs0 + ((xc - t.xc0) * (t.xs1 - t.xs0)) / (t.xc1 - t.xc0);
    };
    expect(warp(14)).toBeCloseTo(70, 6);
    expect(warp(84)).toBeCloseTo(84, 6);
    expect(warp(91)).toBeCloseTo(119, 6);
  });
});

describe.runIf(hayDatos)('esquematico_l1.json', () => {
  let ix: ReturnType<typeof construirIndice> | null = null;
  beforeAll(() => { ix = construirIndice(data); });

  it('declara las fuentes y sus revisiones', () => {
    const f = new Map(data.fuentes.map(x => [x.id, x]));
    expect(f.get('SEN')?.codigo).toBe('2022-SIE-CB.IXL-L1MO-000-II-41252-P');
    expect(f.get('SEN')?.revision).toBe('09');
    expect(f.get('CDV')?.codigo).toBe('2022-MRRC-CB.IXL-L1MO-000-III-47802987-P');
    expect(f.get('CDV')?.revision).toBe('J');
    for (const k of ['SEN', 'CDV']) expect(f.get(k)?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('inventario extraído de los planos', () => {
    expect(data.estaciones).toHaveLength(20);
    expect(data.cdvs).toHaveLength(215);
    expect(data.secciones).toHaveLength(336);
    expect(data.agujas).toHaveLength(47);
    expect(data.senales).toHaveLength(139);
    expect(data.andenes).toHaveLength(42);
    expect(data.balizas).toHaveLength(470);
    expect(data.avc).toHaveLength(23);
    expect(data.subestaciones).toHaveLength(16);
    expect(data.armarios).toHaveLength(182);
    expect(data.zonas?.filter(z => z.tipo === 'RAUZ')).toHaveLength(21);
    expect(data.zonas?.filter(z => z.tipo === 'ASR')).toHaveLength(54);
  });

  it('secciones y CDV son consistentes entre sí', () => {
    const ids = new Set(data.secciones.map(s => s.id));
    expect(ids.size).toBe(data.secciones.length);
    const cdvs = new Set(data.cdvs.map(c => c.id));
    for (const s of data.secciones) {
      expect(s.cdv, s.id).not.toBeNull();
      expect(cdvs.has(s.cdv as string), s.id).toBe(true);
    }
    for (const c of data.cdvs) for (const s of c.secciones) expect(ids.has(s), `${c.id}/${s}`).toBe(true);
  });

  it('todo CDV del plano de CDV tiene tipo y frecuencia salvo los señalados', () => {
    const sinTipo = data.cdvs.filter(c => c.en_plano_cdv && !c.tipo).map(c => c.id);
    expect(sinTipo.length).toBeLessThanOrEqual(5);
  });

  it('las reglas de PK son monótonas (PK decrece con x)', () => {
    for (const r of [data.regla_sen ?? [], data.regla_cdv ?? []]) {
      expect(r.length).toBeGreaterThan(150);
      for (let i = 1; i < r.length; i++) {
        expect(r[i][0]).toBeGreaterThan(r[i - 1][0]);
        expect(r[i][1]).toBeLessThan(r[i - 1][1]);
      }
    }
  });

  it('las señales con PK caen cerca de su PK en la regla del plano', () => {
    const eje = construirEjePk(data);
    const err = data.senales.filter(s => s.pk != null && s.head && s.estacion !== 'PAN')
      .map(s => Math.abs((eje.pkAt(s.x) as number) - (s.pk as number)));
    err.sort((a, b) => a - b);
    expect(err[Math.floor(err.length / 2)]).toBeLessThan(5);
  });

  it('claves únicas de ubicaciones de equipos de CDV', () => {
    const claves = (data.armarios ?? []).map(a => a.clave);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('balizas asociadas a sección, CDV y vía', () => {
    const ok = data.balizas.filter(b => b.seccion && b.cdv && b.via);
    expect(ok.length).toBeGreaterThanOrEqual(data.balizas.length - 1);
  });

  it('juntas físicas con tipo de lazo y equipos del plano de CDV', () => {
    const f = data.juntas.filter(j => j.tipo === 'fisica');
    expect(f.filter(j => j.tipo_cdv).length).toBeGreaterThan(200);
    expect(f.filter(j => j.sintonia?.length).length).toBeGreaterThan(150);
    expect(f.filter(j => j.compensacion).length).toBeGreaterThan(10);
  });

  it('perfil: la zona de andén de Balbuena V1 es de 60 km/h', () => {
    const c = ix?.cdv.get('C22BAL');
    expect(c).toBeTruthy();
    const [a, b] = rangoX(c!.tramos);
    const { velocidad } = perfilEn(data, c!.vias, a, b);
    expect(velocidad.some(z => z.nombre === 'BAB_01' && z.v === 60)).toBe(true);
  });

  it('resuelve identificadores del log del ATS y de los planos', () => {
    const r = (s: string) => resolver(ix!, s);
    expect(r('BALC22BAL')).toMatchObject({ id: expect.stringMatching(/^C22BAL/) });
    expect(r('PANC42PAN1')).toEqual({ tipo: 'seccion', id: 'C42PAN1' });
    expect(r('S12BBADLRTB')).toEqual({ tipo: 'senal', id: 'S12BBAD' });
    expect(r('A23BAL')).toEqual({ tipo: 'aguja', id: 'A23BAL' });
    expect(r('117')).toEqual({ tipo: 'estacion', id: 'CUA' });
    expect(r('35')).toEqual({ tipo: 'avc', id: 'AVC20BPIN' });
    expect(r('AVC20PIN')).toEqual({ tipo: 'avc', id: 'AVC20BPIN' });
    expect(r('BFU1AOBS')).toEqual({ tipo: 'bfu', id: 'BFU1AOBS' });
    expect(r('C21APAN')).toEqual({ tipo: 'cdv', id: 'C21PAN' });
    expect(r('*BA10815')).toEqual({ tipo: 'baliza', id: 'BA10815' });
    expect(r('OBS-03.0')).toEqual({ tipo: 'armario', id: 'OBS-03.0' });
    expect(r('RAUZ_BFU_BAL')).toEqual({ tipo: 'zona', id: 'RAUZ_BFU_BAL' });
    expect(r('S/E BALBUENA')).toEqual({ tipo: 'subestacion', id: 'BALBUENA' });
    expect(r('4+535')).toEqual({ tipo: 'pk', id: '4535' });
    expect(r('PAN')).toEqual({ tipo: 'estacion', id: 'PAN' });
    expect(r('NOEXISTE')).toBeNull();
  });

  it('todo elemento seleccionable tiene caja para encuadrar', () => {
    const refs = [
      ...data.secciones.slice(0, 20).map(s => ({ tipo: 'seccion' as const, id: s.id })),
      ...data.senales.map(s => ({ tipo: 'senal' as const, id: s.id })),
      ...data.agujas.map(a => ({ tipo: 'aguja' as const, id: a.id })),
      ...data.balizas.slice(0, 30).map(b => ({ tipo: 'baliza' as const, id: b.id })),
      ...(data.zonas ?? []).map(z => ({ tipo: 'zona' as const, id: z.id })),
      ...(data.armarios ?? []).map(a => ({ tipo: 'armario' as const, id: a.clave })),
      ...data.estaciones.map(e => ({ tipo: 'estacion' as const, id: e.codigo })),
      { tipo: 'pk' as const, id: '8000' },
    ];
    for (const ref of refs) {
      const b = cajaDe(ix!, ref);
      expect(b, `${ref.tipo}:${ref.id}`).not.toBeNull();
      expect(b![2]).toBeGreaterThanOrEqual(b![0]);
    }
  });
});
