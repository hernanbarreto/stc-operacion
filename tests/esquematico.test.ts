// Pruebas del esquemático de la Línea 1: ejes de PK, resolución de identificadores (planos y log del ATS),
// integridad del JSON generado por tools/esquematico, rótulos de vía, marcha tipo y reproducción de eventos.
// Los datos derivados de los planos están en datos_planos/ (no versionado; en la web se leen de Firebase Storage):
// sin ellos se omiten las pruebas que los necesitan.
import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Esquematico } from '../src/components/esquematico/types';
import {
  cajaDe, construirEjePk, construirIndice, ejeDesdeRegla, fmtPk, interpolar, lugarDbo, parsePk, perfilEn, rangoX, resolver,
  sentidoSalida,
} from '../src/components/esquematico/resolver';
import { calcularRotulos } from '../src/components/esquematico/rotulos';
import { validarEsquematico } from '../src/components/esquematico/esquema';
import { type CurvaMarcha, ARCHIVOS_MARCHA, curvaDesdeJson, pkEnTramo, trayectoriaTipo } from '../src/components/esquematico/marcha';
import { PLANTILLAS, type FilaLog, etiquetaAlarma, interpretar, numeroEn, numeroServicio, nombreTren } from '../src/components/esquematico/eventos';
import { crearContexto, estadoEn, faseEn, lugarDeVia, mapaPkMarcha, prepararReplay, recorridoReal } from '../src/components/esquematico/replay';
import { aristaEn, caminoEntre, deslizamiento, itinerario, posicionesDeslizamiento } from '../src/components/esquematico/rutas';
import { parseFecha, horaTxt, fechaDia } from '../src/components/esquematico/fecha';

const RAIZ = resolve(__dirname, '..');
const PLANO = join(RAIZ, 'datos_planos/esquematico_l1.json');
const hayDatos = existsSync(PLANO);
let data = {} as Esquematico;
beforeAll(() => { if (hayDatos) data = JSON.parse(readFileSync(PLANO, 'utf-8')); });

const curvas: CurvaMarcha[] = ARCHIVOS_MARCHA.map(a =>
  curvaDesdeJson(a.material, a.via, JSON.parse(readFileSync(join(RAIZ, 'public', a.archivo), 'utf-8'))));

describe('datos de los planos fuera del repositorio y del hosting', () => {
  it('no hay datos de planos en public/ (Hosting los serviría sin login)', () => {
    for (const f of ['public/data/esquematico_l1.json', 'public/data/planos', 'public/data/l1']) {
      expect(existsSync(join(RAIZ, f)), f).toBe(false);
    }
  });
  it('datos_planos/ está ignorado por git', () => {
    const gi = readFileSync(join(RAIZ, '.gitignore'), 'utf-8').split(/\r?\n/).map(l => l.trim());
    expect(gi).toContain('datos_planos/');
    expect(gi).toContain('public/data/esquematico_l1.json');
  });
  it('sólo acepta un JSON del esquemático con el esquema esperado', () => {
    expect(validarEsquematico({ hola: 1 })).toBe(false);
    expect(validarEsquematico(null)).toBe(false);
    if (hayDatos) expect(validarEsquematico(data)).toBe(true);
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
});

describe('fechas del log', () => {
  it('texto del ATS, número de serie de Excel y Date', () => {
    const t = parseFecha('2026-10-21 08:05:03.060000') as number;
    expect(fechaDia(t)).toBe('2026-10-21');
    expect(horaTxt(t, true)).toBe('08:05:03.060');
    expect(parseFecha(new Date(t))).toBe(t);
    const serie = 46316 + (8 * 3600 + 5 * 60 + 3) / 86400;   // 2026-10-21 08:05:03
    expect(horaTxt(parseFecha(serie) as number)).toBe('08:05:03');
    expect(parseFecha('ayer')).toBeNull();
  });
});

describe('plantillas de eventos', () => {
  it('ids únicos y descripción de cómo se muestra cada una (vacía = pendiente)', () => {
    const ids = PLANTILLAS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PLANTILLAS) expect(typeof p.muestra).toBe('string');
    // la documentación de lo pendiente lista todas las plantillas
    const doc = readFileSync(join(RAIZ, 'docs/eventos-esquematico.md'), 'utf-8');
    for (const p of PLANTILLAS) expect(doc, p.id).toContain(`\`${p.id}\``);
  });
  it('número de servicio y nombre de tren', () => {
    expect(numeroServicio('1600')).toBe('16');
    expect(numeroServicio('*7600')).toBe('*76');
    expect(numeroServicio('05')).toBe('05');
    expect(nombreTren('32840')).toBe('27 (nm22)');
    expect(nombreTren('99999')).toBe('T99999');
  });
});

describe('marcha tipo', () => {
  it('las cuatro curvas (NM16/NM22 × V1/V2) cubren la línea con PK creciente', () => {
    expect(curvas).toHaveLength(4);
    for (const c of curvas) {
      expect(c.pk.length).toBeGreaterThan(100);
      for (let i = 1; i < c.pk.length; i++) expect(c.pk[i]).toBeGreaterThanOrEqual(c.pk[i - 1]);
      expect(c.pk[0]).toBeLessThan(1000);
      expect(c.pk[c.pk.length - 1]).toBeGreaterThan(16500);
    }
  });
  it('dentro de un tramo el PK avanza en el sentido de marcha y llega a los extremos', () => {
    const c = curvas.find(x => x.material === 'NM22' && x.via === 'V2') as CurvaMarcha;
    const a = 9902, b = 9309;  // SAL → ISA (PK decreciente)
    expect(pkEnTramo(c, a, b, 0)).toBeCloseTo(a, 3);
    expect(pkEnTramo(c, a, b, 1)).toBeCloseTo(b, 3);
    let ant = a;
    for (let k = 1; k <= 20; k++) {
      const p = pkEnTramo(c, a, b, k / 20);
      expect(p).toBeLessThanOrEqual(ant + 1e-6);
      ant = p;
    }
    expect(pkEnTramo(null, 0, 100, 0.25)).toBe(25);
  });
  it('trayectoria completa: V1 de PAN a OBS, V2 de OBS a PAN, tiempo creciente', () => {
    for (const via of ['V1', 'V2'] as const) {
      const c = curvas.find(x => x.material === 'NM16' && x.via === via) as CurvaMarcha;
      const pts = trayectoriaTipo(c, 'NM16', via, 'valle');
      expect(pts[0].estacion).toBe(via === 'V1' ? 'PAN' : 'OBS');
      expect(pts[pts.length - 1].estacion).toBe(via === 'V1' ? 'OBS' : 'PAN');
      for (let i = 1; i < pts.length; i++) expect(pts[i].t).toBeGreaterThanOrEqual(pts[i - 1].t);
      const total = pts[pts.length - 1].t / 60;
      expect(total).toBeGreaterThan(25);
      expect(total).toBeLessThan(45);
    }
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

  it('subestaciones ubicadas en el lienzo, ordenadas por PK', () => {
    const se = (data.subestaciones ?? []).filter(s => s.x != null);
    expect(se.length).toBe(data.subestaciones?.length);
    const porX = [...se].sort((a, b) => (a.x as number) - (b.x as number));
    for (let i = 1; i < porX.length; i++) expect(porX[i].pk as number).toBeLessThan(porX[i - 1].pk as number);
  });

  it('nombres de CDV de un lado de la vía y de sus secciones del otro', () => {
    const rs = calcularRotulos(data);
    const cdv = new Map(rs.filter(r => r.tipo === 'cdv').map(r => [r.id, r]));
    expect(cdv.size).toBe(data.cdvs.filter(c => c.tramos.length).length);
    for (const s of data.secciones) {
      const r = rs.find(x => x.tipo === 'seccion' && x.id === s.id);
      expect(r, s.id).toBeTruthy();
      const c = s.cdv ? cdv.get(s.cdv) : undefined;
      if (c) expect(r!.lado, s.id).toBe(-c.lado);
    }
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
      ...(data.subestaciones ?? []).map(s => ({ tipo: 'subestacion' as const, id: s.nombre as string })),
      ...data.estaciones.map(e => ({ tipo: 'estacion' as const, id: e.codigo })),
      { tipo: 'pk' as const, id: '8000' },
    ];
    for (const ref of refs) {
      const b = cajaDe(ix!, ref);
      expect(b, `${ref.tipo}:${ref.id}`).not.toBeNull();
      expect(b![2]).toBeGreaterThanOrEqual(b![0]);
    }
  });

  describe('reproducción de eventos', () => {
    const T0 = parseFecha('2026-10-21 08:00:00.000') as number;
    const s = (seg: number) => T0 + seg * 1000;
    const filas: FilaLog[] = [
      { t: s(0), tipo: 'COMMAND_ACK', desc: 'Comando ATS_I_Train_Number#32840#0#2700 ejecutado por PANTTS' },
      { t: s(5), tipo: 'IHM_LOGIN', desc: 'Usuario Regulador1 ingresa en el IHM 2' },
      { t: s(6), tipo: 'IHM_ZONE_CONTROL', desc: 'IHM 2 toma control del área PIN' },
      { t: s(7), tipo: 'CONTROL_IHM', desc: 'Servidor 1 controla el IHM 2' },
      { t: s(10), tipo: 'TGMT_DEPARTURE_AT_PLATFORM', desc: 'El tren 32840 en la vía 1 ha salido a la estación 101' },
      { t: s(130), tipo: 'TGMT_ARRIVAL_AT_PLATFORM', desc: 'El tren 32840 en la vía 1 ha llegado a la estación 102' },
      { t: s(130.5), tipo: 'TGMT_ARRIVAL_AT_PLATFORM', desc: 'El tren 32840 en la vía 1 ha llegado a la estación 102' },
      { t: s(160), tipo: 'TGMT_DEPARTURE_AT_PLATFORM', desc: 'El tren 32840 en la vía 1 ha salido a la estación 102' },
      { t: s(200), tipo: 'ALARM_OPENED', desc: 'Tren número 27 está detenido en el circuito de vía BALC22BAL . Abierta' },
      { t: s(260), tipo: 'ALARM_NORMALIZED', desc: 'Tren número 27 está detenido en el circuito de vía BALC22BAL . Normalizada' },
      { t: s(300), tipo: 'COMMAND_ACK', desc: 'Comando ActivarDBOCBTC TCY TCY1 ejecutado por OBSATP' },
      { t: s(400), tipo: 'COMMAND_ACK', desc: 'Comando DesactivarDBOCBTC TCY TCY1 ejecutado por OBSATP' },
      { t: s(500), tipo: 'COMM_IXL_DISCONNECT', desc: 'El ATS ha perdido la conexión con el enclavamiento PANIXL' },
      { t: s(530), tipo: 'COMM_IXL_CONNECT', desc: 'Enclavamiento conectado: PANIXL' },
      { t: s(600), tipo: 'TRAIN_CHANGED', desc: 'Tren numerado 27 cambió a *27' },
    ];
    const conRuta: FilaLog[] = [
      ...filas.slice(0, 4),
      { t: s(8), tipo: 'COMMAND_ACK', desc: 'Comando EstablecerItinerario PAN S22APAN S24ZAR ejecutado por PANIXL' },
      ...filas.slice(4),
    ];

    it('interpreta el log: tren, paradas, número de servicio e intervalos', () => {
      const mod = interpretar(filas, ix!);
      expect(mod.eventos).toHaveLength(filas.length - 1);   // el duplicado < 2 s se descarta
      expect(mod.trenes.map(t => t.clave)).toEqual(['27 (nm22)']);
      const tr = mod.trenes[0];
      expect(tr.material).toBe('NM22');
      expect(tr.paradas.map(p => `${p.tipo}${p.est}`)).toEqual(['dep101', 'arr102', 'dep102']);
      expect(numeroEn(mod, tr, s(20))).toBe('27');
      expect(numeroEn(mod, tr, s(700))).toBe('*27');
      const det = mod.intervalos.find(i => i.tipo === 'detenido');
      expect(det).toMatchObject({ t0: s(200), t1: s(260) });
      expect(det!.refs[0]?.id).toMatch(/^C22BAL/);
      expect(mod.intervalos.find(i => i.tipo === 'dbo')).toMatchObject({ t0: s(300), t1: s(400) });
      expect(mod.intervalos.find(i => i.tipo === 'ixl')).toMatchObject({ t0: s(500), t1: s(530) });
    });

    it('estado en un instante: posición del tren, elementos con alarma, enclavamiento caído e IHM', () => {
      const mod = interpretar(filas, ix!);
      const eje = construirEjePk(data);
      const rep = prepararReplay(crearContexto(data, eje, curvas), mod);
      const xPan = data.estaciones.find(e => e.codigo === 'PAN')!.x as number;
      const xZar = data.estaciones.find(e => e.codigo === 'ZAR')!.x as number;

      const enMarcha = estadoEn(rep, s(70)).trenes[0];
      expect(enMarcha.enAnden).toBe(false);
      expect(enMarcha.via).toBe(1);
      expect(enMarcha.sentido).toBe('OBS');
      expect(enMarcha.numero).toBe('27');
      expect(enMarcha.x).toBeLessThan(xPan);
      expect(enMarcha.x).toBeGreaterThan(xZar - 60);

      expect(enMarcha.ang).toBeCloseTo(0, 3);
      const enAnden = estadoEn(rep, s(145)).trenes[0];
      expect(enAnden).toMatchObject({ enAnden: true, estCodigo: 'ZAR', sentido: 'OBS' });

      const e230 = estadoEn(rep, s(230));
      const det = mod.intervalos.find(i => i.tipo === 'detenido')!;
      expect(e230.porElemento.get(`${det.refs[0].tipo}:${det.refs[0].id}`)?.map(i => i.tipo)).toContain('detenido');
      expect(det.tren).toBe('27 (nm22)');
      expect(estadoEn(rep, s(515)).ixlCaidos.has('PANIXL')).toBe(true);
      expect(estadoEn(rep, s(540)).ixlCaidos.size).toBe(0);
      expect(e230.ihm).toContainEqual({ ihm: '2', usuario: 'Regulador1', servidor: '1', areas: ['PIN'] });
    });

    it('recorrido para el diagrama de hilo y PK de la marcha tipo llevado al plano', () => {
      const mod = interpretar(filas, ix!);
      const ctx = crearContexto(data, construirEjePk(data), curvas);
      const rec = recorridoReal(prepararReplay(ctx, mod), mod.trenes[0]);
      expect(rec).toHaveLength(1);
      for (let i = 1; i < rec[0].length; i++) expect(rec[0][i].t).toBeGreaterThanOrEqual(rec[0][i - 1].t);
      const m = mapaPkMarcha(ctx, 1);
      expect(m(2117.798)).toBeCloseTo(ctx.pkEst(102, 1) as number, 3);   // ZAR
      expect(m(17300.6)).toBeCloseTo(ctx.pkEst(123, 1) as number, 3);    // OBS
    });

    it('itinerario: se dibuja mientras el tren lo usa y se libera al pasar', () => {
      const mod = interpretar(conRuta, ix!);
      expect(mod.itinerarios).toEqual([{ t: s(8), accion: 'establecer', est: 'PAN', origen: 'S22APAN', destino: 'S24ZAR' }]);
      const rep = prepararReplay(crearContexto(data, construirEjePk(data), curvas), mod);
      const r = rep.rutas[0];
      expect(r.rec).not.toBeNull();
      expect(r.tren).toBe('27 (nm22)');
      expect(estadoEn(rep, s(60)).rutas.map(x => x.id)).toEqual([r.id]);
      expect(estadoEn(rep, s(400)).rutas).toHaveLength(0);
      // la misma salida con una ruta desde otro andén (andén 3, vía 42) no se le asigna a este tren
      const otra = interpretar(conRuta.map(f => ({ ...f, desc: f.desc.replace('S22APAN', 'S42APAN') })), ix!);
      expect(prepararReplay(crearContexto(data, construirEjePk(data), curvas), otra).rutas[0].tren).toBeNull();
    });

    it('el tren siempre se dibuja sobre una vía (también al salir de la terminal por la ruta)', () => {
      const mod = interpretar(conRuta, ix!);
      const rep = prepararReplay(crearContexto(data, construirEjePk(data), curvas), mod);
      let n = 0;
      for (let k = 0; k <= 170; k += 2) {
        const p = estadoEn(rep, s(k)).trenes[0];
        if (!p) continue;
        n++;
        expect(aristaEn(data, p.x, p.y, 1.5), `${k}s x${p.x.toFixed(1)} y${p.y.toFixed(1)}`).not.toBeNull();
      }
      expect(n).toBeGreaterThan(50);
    });

    it('camino por las vías entre dos puntos', () => {
      const a = data.andenes.find(x => x.ids.includes('ZAR1'))!, b = data.andenes.find(x => x.ids.includes('GOM1'))!;
      const r = caminoEntre(data, { x: (a.x0 + a.x1) / 2, y: a.y_via }, { x: (b.x0 + b.x1) / 2, y: b.y_via });
      expect(r).not.toBeNull();
      expect(r!.agujas.every(g => g.pos === 'normal')).toBe(true);    // por la vía 1, sin cruzar
    });

    it('tren detenido entre estaciones: queda en el CDV de la alarma', () => {
      const eje = construirEjePk(data);
      const ctx = crearContexto(data, eje, curvas);
      const pZar = ctx.pkEst(102, 1) as number, pGom = ctx.pkEst(106, 1) as number;
      const secc = data.secciones.find(x => {
        const l = lugarDeVia(ctx, { tipo: 'seccion', id: x.id });
        return l?.via === 1 && l.pk > pZar + 200 && l.pk < pGom - 200;
      })!;
      expect(secc).toBeTruthy();
      const filasDet: FilaLog[] = [
        { t: s(0), tipo: 'COMMAND_ACK', desc: 'Comando ATS_I_Train_Number#32840#0#2700 ejecutado por PANTTS' },
        { t: s(10), tipo: 'TGMT_DEPARTURE_AT_PLATFORM', desc: 'El tren 32840 en la vía 1 ha salido a la estación 102' },
        { t: s(120), tipo: 'ALARM_OPENED', desc: `Tren número  está detenido en el circuito de vía ${secc.id} . Abierta` },
        { t: s(400), tipo: 'ALARM_NORMALIZED', desc: `Tren número  está detenido en el circuito de vía ${secc.id} . Normalizada` },
        { t: s(520), tipo: 'TGMT_ARRIVAL_AT_PLATFORM', desc: 'El tren 32840 en la vía 1 ha llegado a la estación 106' },
      ];
      const mod = interpretar(filasDet, ix!);
      const rep = prepararReplay(ctx, mod);
      expect(mod.intervalos[0].tren).toBe('27 (nm22)');      // sin número: el tren más cercano
      const p = estadoEn(rep, s(250)).trenes[0];
      expect(p.cdv).toEqual({ tipo: 'seccion', id: secc.id });
      expect(estadoEn(rep, s(450)).trenes[0].cdv).toBeNull();
    });
  });

  describe('DBO en la punta del andén según el sentido de salida', () => {
    it('vía 1 sale hacia OBS, vía 2 hacia PAN, terminales hacia la otra punta', () => {
      const a = (id: string) => ix!.anden.get(id)!;
      expect(sentidoSalida(data, a('BOU1'))).toBe('OBS');
      expect(sentidoSalida(data, a('BOU2'))).toBe('PAN');
      expect(sentidoSalida(data, a('OBS1'))).toBe('PAN');
      expect(sentidoSalida(data, a('PAN42'))).toBe('OBS');
      const b1 = a('BOU1'), [x1, y1] = lugarDbo(b1, 'OBS', 0.2);
      expect(x1 - b1.x0).toBeLessThan(5);                       // punta de salida hacia OBS (x menor)
      expect(y1).toBeGreaterThan(b1.y_borde - 2.1);             // entre el andén y su vía
      expect(y1).toBeLessThan(b1.y_via);
      const b2 = a('BOU2'), [x2] = lugarDbo(b2, 'PAN', 0.2);
      expect(b2.x1 - x2).toBeLessThan(5);
    });
  });

  describe('itinerarios y deslizamientos inferidos del plano', () => {
    it('rutas del log recorren el plano de señal a señal en el sentido de la señal origen', () => {
      for (const [o, d] of [['S10PAN', 'S12BPAN'], ['S42APAN', 'S24ZAR'], ['S10OBS', 'S22BOBS'], ['S12BPAN', 'S24BPAN'],
        ['S24BPAN', 'BSBPAN'], ['S83BZAR', 'S36PAN'], ['S22ATCY', 'S10OBS'], ['SZBSAL', 'S17BSAL']]) {
        const r = itinerario(data, o, d);
        expect(r, `${o}>${d}`).not.toBeNull();
        const so = data.senales.find(x => x.id === o)!, sd = data.senales.find(x => x.id === d)!;
        const xs = r!.tramos.flatMap(t => [t[0], t[2]]);
        expect(Math.min(...xs)).toBeCloseTo(Math.min(so.x, sd.x), 0);
        expect(Math.max(...xs)).toBeCloseTo(Math.max(so.x, sd.x), 0);
        expect(r!.secciones.length).toBeGreaterThan(0);
      }
      expect(itinerario(data, 'S10PAN', 'NOEXISTE')).toBeNull();
    });
    it('deslizamiento con la posición de agujas del comando', () => {
      expect(posicionesDeslizamiento('EstablecerDeslizamientoNormal1Invertido2')).toEqual(['normal', 'invertida']);
      expect(posicionesDeslizamiento('EstablecerDeslizamientoInvertida')).toEqual(['invertida']);
      const n = deslizamiento(data, 'S12BOBS', ['normal'])!;
      const i = deslizamiento(data, 'S12BPAN', ['invertida'])!;
      expect(n.agujas.map(a => a.pos)).toEqual(['normal']);
      expect(i.agujas.map(a => a.pos)).toEqual(['invertida']);
      expect(n.largo).toBeLessThanOrEqual(140);
    });
  });

  describe('alarmas: activa, pendiente de reconocer y marcas de comandos', () => {
    const T0 = parseFecha('2026-10-21 09:00:00.000') as number;
    const s = (seg: number) => T0 + seg * 1000;
    it('normalizada sin reconocimiento termina al normalizarse; con reconocimiento queda pendiente hasta el cierre', () => {
      const a = 'ARB activo en el circuito de vía C11BOU (BOU)';
      const b = 'Ocupación intempestiva en PANA11PAN';
      const mod = interpretar([
        { t: s(0), tipo: 'ALARM_OPENED', desc: `${a} . Abierta` },
        { t: s(10), tipo: 'ALARM_OPENED', desc: `${b} . Abierta` },
        { t: s(60), tipo: 'ALARM_NORMALIZED', desc: `${a} . Normalizada` },
        { t: s(70), tipo: 'ALARM_NORMALIZED', desc: `${b} . Normalizada` },
        { t: s(300), tipo: 'ALARM_ACK', desc: `${b} . Reconocida` },
        { t: s(300.5), tipo: 'ALARM_CLOSED', desc: `${b} . Cerrada` },
        { t: s(400), tipo: 'COMMAND_ACK', desc: 'Comando ActivarModoFlota PAN S10PAN ejecutado por PANIXL' },
        { t: s(500), tipo: 'COMMAND_ACK', desc: 'Comando DesactivarModoFlota PAN S10PAN ejecutado por PANIXL' },
        { t: s(600), tipo: 'COMMAND_ACK', desc: 'Comando DBONoCBTC SAL S17ASAL ejecutado por OBSIXL' },
        { t: s(610), tipo: 'COMMAND_NACK', desc: 'Comando CancelarDBONoCBTC SAL S17ASAL rechazado por OBSIXL: Comando rechazado por el enclavamiento' },
      ], ix!);
      const [ia, ib] = mod.intervalos;
      expect(ia).toMatchObject({ tipo: 'arb', etiqueta: 'ARB', t0: s(0), tN: s(60), t1: s(60) });
      expect(ib).toMatchObject({ tipo: 'alarma', etiqueta: 'OCUP. INTEMP', tN: s(70), t1: s(300.5) });
      expect(faseEn(ib, s(100))).toBe('pendiente');
      expect(faseEn(ib, s(50))).toBe('activa');
      expect(ib.refs[0]).toMatchObject({ id: expect.stringMatching(/A11PAN/) });
      expect(mod.intervalos.find(i => i.etiqueta === 'FLOTA')).toMatchObject({ t0: s(400), t1: s(500), refs: [{ tipo: 'senal', id: 'S10PAN' }] });
      const dbo = mod.intervalos.find(i => i.tipo === 'dbo')!;
      expect(dbo).toMatchObject({ t0: s(600), t1: null, refs: [{ tipo: 'senal', id: 'S17ASAL' }] });   // el NACK no lo cancela
      expect(mod.eventos.at(-1)!.rechazo).toBe('Comando rechazado por el enclavamiento');
    });
    it('etiquetas cortas de alarmas', () => {
      expect(etiquetaAlarma('Tren número 16 está detenido en el circuito de vía OBSC14OBS')).toBe('DET 16');
      expect(etiquetaAlarma('Señal S24OBS (OBS) foco rojo en fallo')).toBe('FOCO R');
      expect(etiquetaAlarma('Aguja A63BOBS (OBS) talonada')).toBe('TALONADA');
      expect(etiquetaAlarma('NRB activo en el circuito de vía C12PAN (PAN)')).toBe('NRB');
    });
  });
});
