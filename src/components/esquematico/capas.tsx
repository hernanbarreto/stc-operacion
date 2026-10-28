// Capas SVG del esquemático (coordenadas del lienzo = puntos PDF de la hoja 1/25 del plano de señalización).
import React from 'react';
import type { Anden, Aguja, Armario, Baliza, Cartel, ElementoRef, Equipo, Esquematico, Junta, Pendiente, Rotulo, Senal,
  Subestacion, TramoObra, VelocidadAguja, Zona, ZonaVelocidad } from './types';
import { LAMP, LAZO_COLORS, Y_ARM, Y_TOP, colorVelocidad } from './constantes';
import { fmtPk } from './resolver';

export type HovFn = (ref: ElementoRef) => Record<string, unknown>;

// ───────────────────────── plano original en tiras SVG ─────────────────────────

export interface PlanoIndex {
  titulo: string;
  ancho: number;
  alto: number;
  tiras: { x0: number; x1: number; archivo: string }[];
}

export const PlanoTiras: React.FC<{ base: string; index: PlanoIndex; x0: number; x1: number; claro?: boolean }> = ({ base, index, x0, x1, claro }) => (
  <g className={`esq-plano${claro ? ' claro' : ''}`}>
    {index.tiras.filter(t => t.x1 >= x0 - 50 && t.x0 <= x1 + 50).map(t => (
      <image key={t.archivo} href={`${base}/${t.archivo}`} x={t.x0} y={0} width={t.x1 - t.x0} height={index.alto}
        preserveAspectRatio="none" />
    ))}
  </g>
);

// ───────────────────────── señales, agujas, andenes ─────────────────────────

export const SenalSvg: React.FC<{ s: Senal; etiqueta: boolean; activo: boolean; hov: HovFn }> = ({ s, etiqueta, activo, hov }) => {
  // Geometría del plano: poste en (x, y) sobre la vía, cabeza de focos entre head.x0 y head.x1 a la altura head.cy.
  // El sentido gobernado es el que va del poste hacia los focos.
  if (!s.head) {
    return (
      <g className={`esq-senal${activo ? ' activo' : ''}`} {...hov({ tipo: 'senal', id: s.id })}>
        <circle cx={s.x} cy={s.y} r={2.4} className="esq-senal-dudosa" />
        {etiqueta && <text x={s.x + 2.8} y={s.y - 2.8} fontSize={2.4} className="esq-senal-label">{s.id} (?)</text>}
      </g>
    );
  }
  const { x0, x1, cy } = s.head;
  const n = Math.max(1, s.focos.length);
  const dir = s.sentido === 'OBS' ? -1 : 1;
  const largo = Math.abs(x1 - x0);
  const r = Math.min(1.5, largo / (2 * n + 0.6));
  const base = s.x + dir * 0.6;
  const lamps = s.focos.length ? s.focos : (['R'] as const);
  return (
    <g className={`esq-senal${activo ? ' activo' : ''}${s.tipo === 'fin_de_via' ? ' fin' : ''}`} {...hov({ tipo: 'senal', id: s.id })}>
      <line x1={s.x} x2={s.x} y1={s.y} y2={cy} className="esq-senal-mast" />
      <line x1={base} x2={base} y1={cy - r} y2={cy + r} className="esq-senal-mast" />
      <line x1={s.x} x2={base} y1={cy} y2={cy} className="esq-senal-mast" />
      {lamps.map((c, i) => (
        <circle key={i} cx={base + dir * (r + 0.15 + i * 2 * r)} cy={cy} r={r} fill={LAMP[c]} className="esq-lamp" />
      ))}
      {s.sentido == null && <circle cx={s.x} cy={cy} r={2.4} className="esq-senal-dudosa" />}
      {etiqueta && s.etiqueta && (
        <text x={s.etiqueta.x} y={s.etiqueta.y} fontSize={2.6} className="esq-senal-label">{s.id}</text>
      )}
    </g>
  );
};

export const AgujaSvg: React.FC<{ a: Aguja; data: Esquematico; k: number; etiqueta: boolean; activo: boolean; hov: HovFn }> = ({ a, data, k, etiqueta, activo, hov }) => {
  if (a.x == null || a.y == null) return null;
  const ax = a.x, ay = a.y;
  const rama = (edge?: number) => {
    if (edge == null) return null;
    const v = data.vias[edge];
    if (!v) return null;
    const [x0, y0, x1, y1] = v.pts;
    const far = Math.hypot(x0 - ax, y0 - ay) > Math.hypot(x1 - ax, y1 - ay) ? [x0, y0] : [x1, y1];
    const L = Math.hypot(far[0] - ax, far[1] - ay) || 1;
    const len = Math.min(5, L);
    return [ax, ay, ax + ((far[0] - ax) / L) * len, ay + ((far[1] - ay) / L) * len];
  };
  const recta = rama(a.recta_edge);
  const desv = rama(a.desviada_edge);
  return (
    <g className={`esq-aguja${activo ? ' activo' : ''}`} {...hov({ tipo: 'aguja', id: a.id })}>
      {recta && <line x1={recta[0]} y1={recta[1]} x2={recta[2]} y2={recta[3]} className="esq-aguja-normal" style={{ strokeWidth: 2.4 * k + 0.4 }} />}
      {desv && <line x1={desv[0]} y1={desv[1]} x2={desv[2]} y2={desv[3]} className="esq-aguja-reversa" style={{ strokeWidth: 1.4 * k + 0.2 }} />}
      <circle cx={ax} cy={ay} r={1.3} className="esq-aguja-pto" />
      {etiqueta && (a.etiqueta
        ? <text x={a.etiqueta.x} y={a.etiqueta.y} fontSize={2.3} className="esq-aguja-label">{a.id}</text>
        : <text x={ax} y={ay + (ay < 228 ? -3 : 5)} fontSize={2.3} className="esq-aguja-label">{a.id}</text>)}
    </g>
  );
};

export const AndenSvg: React.FC<{ p: Anden; detalle: boolean; hov: HovFn }> = ({ p, detalle, hov }) => {
  const h = 4.2;
  const y = p.lado === 'arriba' ? p.y_borde - h : p.y_borde;
  const ref: ElementoRef = { tipo: 'anden', id: p.ids[0] ?? `${p.estacion}?` };
  return (
    <g className="esq-anden" {...hov(ref)}>
      <rect x={p.x0} y={y} width={p.x1 - p.x0} height={h} rx={0.6} />
      <text x={(p.x0 + p.x1) / 2} y={y + h / 2 + 0.9} fontSize={2.4}>
        {p.estacion} · {p.plataforma?.replace('PLATFORM', 'Andén') ?? ''}{detalle && p.bfu.length ? ` · ${p.bfu.join(' ')}` : ''}
      </text>
    </g>
  );
};

// ───────────────────────── juntas y balizas ─────────────────────────

export const JuntasSvg: React.FC<{ juntas: Junta[]; fisicas: boolean; virtuales: boolean; lazos: boolean; selIdx: number | null; hov: HovFn }> = ({ juntas, fisicas, virtuales, lazos, selIdx, hov }) => (
  <g>
    {virtuales && (
      <g className="esq-junta-v">
        {juntas.map((j, i) => j.tipo === 'virtual' && <line key={i} x1={j.x} x2={j.x} y1={j.y - 1.6} y2={j.y + 1.6} />)}
      </g>
    )}
    {fisicas && (
      <g className="esq-junta-f">
        {juntas.map((j, i) => j.tipo === 'fisica' && (
          <g key={i} {...hov({ tipo: 'junta', id: String(i) })} className={selIdx === i ? 'activo' : ''}>
            <line x1={j.x} x2={j.x} y1={j.y - 2.6} y2={j.y + 2.6} style={j.tipo_cdv ? { stroke: LAZO_COLORS[j.tipo_cdv] } : undefined} />
            <rect x={j.x - 1.2} y={j.y - 3} width={2.4} height={6} className="esq-hitbox" />
            {lazos && (j.tipo_cdv || j.compensacion) && (
              <text x={j.x} y={j.y + (j.y < 228 ? -3.4 : 5.4)} fontSize={1.7} className="esq-lazo-label">
                {j.tipo_cdv ?? ''}{j.compensacion ? '*' : ''}{j.r && j.r.length ? ` ${j.r.join('/')}` : ''}
              </text>
            )}
          </g>
        ))}
      </g>
    )}
  </g>
);

export const BalizasSvg: React.FC<{ balizas: Baliza[]; etiquetas: boolean; selId: string | null; hov: HovFn }> = ({ balizas, etiquetas, selId, hov }) => (
  <g className="esq-baliza">
    {balizas.map(b => (
      <g key={b.id} {...hov({ tipo: 'baliza', id: b.id })} className={selId === b.id ? 'activo' : ''}>
        <path d={`M${b.x - 1} ${b.y - 1.2}L${b.x + 1} ${b.y - 1.2}L${b.x} ${b.y - 2.6}Z`} className={b.provisional ? 'prov' : ''} />
        <rect x={b.x - 1.4} y={b.y - 3} width={2.8} height={2.2} className="esq-hitbox" />
        {etiquetas && <text x={b.x} y={b.y - 3.2} fontSize={1.4}>{b.provisional ? '*' : ''}{b.id}</text>}
      </g>
    ))}
  </g>
);

// ───────────────────────── perfil de vía ─────────────────────────

export const VelocidadSvg: React.FC<{ zonas: ZonaVelocidad[]; etiquetas: boolean; nombres: boolean; hov: HovFn }> = ({ zonas, etiquetas, nombres, hov }) => (
  <g className="esq-vel">
    {zonas.map((z, i) => {
      const a = Math.min(z.x0, z.x1), b = Math.max(z.x0, z.x1);
      const col = colorVelocidad(z.v);
      const y = z.y - 3.4;
      return (
        <g key={i} {...hov({ tipo: 'zona_velocidad', id: String(i) })}>
          <line x1={a} x2={b === a ? a + 1 : b} y1={y} y2={y} stroke={col} className={`esq-vel-bar ${z.tipo}`} />
          <line x1={a} x2={a} y1={y - 1.2} y2={y + 1.2} stroke={col} className="esq-vel-tick" />
          <line x1={b} x2={b} y1={y - 1.2} y2={y + 1.2} stroke={col} className="esq-vel-tick" />
          <rect x={a} y={y - 1.4} width={Math.max(b - a, 1)} height={2.8} className="esq-hitbox" />
          {etiquetas && (
            <text x={(a + b) / 2} y={y - 1} fontSize={1.9} fill={col}>
              {z.v ?? '?'}{z.tipo === 'curva' && z.radio_m ? ` · R${z.radio_m}` : ''}{nombres ? ` · ${z.nombre}` : ''}
            </text>
          )}
        </g>
      );
    })}
  </g>
);

export const VelAgujasSvg: React.FC<{ items: VelocidadAguja[] }> = ({ items }) => (
  <g className="esq-vel-aguja">
    {items.map((a, i) => (
      <text key={i} x={a.x} y={a.y} fontSize={1.8}>
        {a.aguja} {a.v ?? '?'} km/h{a.pk_local.length ? ` (${a.pk_local.join(' – ')})` : ''}
      </text>
    ))}
  </g>
);

export const PendientesSvg: React.FC<{ items: Pendiente[]; etiquetas: boolean }> = ({ items, etiquetas }) => (
  <g className="esq-pend">
    {items.map((s, i) => {
      if (s.x0 == null || s.x1 == null) return null;
      const a = Math.min(s.x0, s.x1), b = Math.max(s.x0, s.x1);
      const sube = (s.permil ?? 0) > 0;
      const y = s.y + 2.6;
      return (
        <g key={i}>
          <line x1={a} x2={b} y1={y} y2={y} className={sube ? 'sube' : (s.permil ?? 0) < 0 ? 'baja' : 'llano'} />
          {etiquetas && <text x={(a + b) / 2} y={y - 0.6} fontSize={1.5}>{s.permil != null ? `${s.permil}‰` : '?'}</text>}
          <title>{`${s.nombre}${s.via ? ` · ${s.via}` : ''}${s.aguja ? ` · aguja ${s.aguja}` : ''} · ${s.permil ?? '?'}‰ · PK ${fmtPk(s.pk_ini)} – ${fmtPk(s.pk_fin)}`}</title>
        </g>
      );
    })}
  </g>
);

// ───────────────────────── equipos, zonas, armarios, energía ─────────────────────────

const yEquipo = (e: Equipo) => e.y ?? (e.lado === 'abajo' ? 312 : 150);

export const EquiposSvg: React.FC<{ equipos: Equipo[]; reset: boolean; etiquetas: boolean; selIdx: number | null; hov: HovFn }> = ({ equipos, reset, etiquetas, selIdx, hov }) => (
  <g className="esq-equipos">
    {equipos.map((e, i) => {
      if (e.x == null || (e.tipo === 'RESET' && !reset)) return null;
      const y = yEquipo(e);
      const w = e.tipo === 'MX' ? 9 : e.tipo === 'RESET' ? 7 : e.tipo === 'PML' ? 10 : e.tipo === 'SALA' ? 12 : 6;
      return (
        <g key={i} className={`esq-eq ${e.tipo}${e.provisional ? ' prov' : ''}${selIdx === i ? ' activo' : ''}`} {...hov({ tipo: 'equipo', id: String(i) })}>
          <rect x={e.x - w / 2} y={y - 1.8} width={w} height={3.6} rx={0.5} />
          {etiquetas && <text x={e.x} y={y + 0.8} fontSize={2}>{e.tipo === 'SALA' ? 'SALA TÉC.' : e.id}</text>}
        </g>
      );
    })}
  </g>
);

export const ZonasSvg: React.FC<{ zonas: Zona[]; etiquetas: boolean; selId: string | null; hov: HovFn }> = ({ zonas, etiquetas, selId, hov }) => (
  <g className="esq-zonas">
    {zonas.map(z => (
      <g key={z.id} className={`esq-zona ${z.tipo}${selId === z.id ? ' activo' : ''}`} {...hov({ tipo: 'zona', id: z.id })}>
        <rect x={z.x0} y={z.y0} width={z.x1 - z.x0} height={z.y1 - z.y0} />
        {etiquetas && <text x={(z.x0 + z.x1) / 2} y={(z.y0 + z.y1) / 2 + 1.2} fontSize={3.4}>{z.id}</text>}
      </g>
    ))}
  </g>
);

export const ArmariosSvg: React.FC<{ armarios: Armario[]; etiquetas: boolean; selId: string | null; hov: HovFn }> = ({ armarios, etiquetas, selId, hov }) => (
  <g className="esq-armarios">
    {armarios.map(a => {
      if (a.x0 == null || a.x1 == null) return null;
      const y = a.lado === 'arriba' ? Y_ARM : Y_ARM + 7;
      return (
        <g key={a.clave} className={`esq-arm${selId === a.clave ? ' activo' : ''}`} {...hov({ tipo: 'armario', id: a.clave })}>
          <path d={`M${a.x0 + 0.3} ${y - 2}V${y}H${a.x1 - 0.3}V${y - 2}`} />
          <rect x={a.x0} y={y - 2.4} width={a.x1 - a.x0} height={5} className="esq-hitbox" />
          {etiquetas && <text x={(a.x0 + a.x1) / 2} y={y + 2.6} fontSize={2}>{a.id}{a.capacidad ? ` ${a.capacidad}` : ''}{a.nota ? ` (${a.nota})` : ''}</text>}
        </g>
      );
    })}
  </g>
);

export const SubestacionesSvg: React.FC<{ items: Subestacion[]; etiquetas: boolean; selId: string | null; hov: HovFn }> = ({ items, etiquetas, selId, hov }) => (
  <g className="esq-se">
    {items.map((s, i) => s.x != null && (
      <g key={i} className={selId === s.nombre ? 'activo' : ''} {...hov({ tipo: 'subestacion', id: s.nombre ?? '' })}>
        <line x1={s.x} x2={s.x} y1={Y_TOP + 4} y2={398} />
        <rect x={s.x - 1.5} y={Y_TOP} width={3} height={266} className="esq-hitbox" />
        {etiquetas && <text x={s.x + 1} y={Y_TOP + 3} fontSize={2.8}>S/E {s.nombre} · {s.pk_texto ?? fmtPk(s.pk)}</text>}
      </g>
    ))}
  </g>
);

export const CartelesSvg: React.FC<{ items: Cartel[]; etiquetas: boolean }> = ({ items, etiquetas }) => (
  <g className="esq-cartel">
    {items.map((c, i) => c.x != null && (
      <g key={i}>
        <rect x={c.x - 1.4} y={Y_TOP + 6} width={2.8} height={2.8} className={c.tipo} />
        {etiquetas && <text x={c.x + 2} y={Y_TOP + 8.4} fontSize={2}>{c.texto} · {c.pk_texto ?? fmtPk(c.pk)}</text>}
        <title>{`${c.texto} · PK ${c.pk_texto ?? fmtPk(c.pk)} (plano de CDV)`}</title>
      </g>
    ))}
  </g>
);

export const TramosSvg: React.FC<{ items: TramoObra[]; etiquetas: boolean }> = ({ items, etiquetas }) => (
  <g className="esq-tramo">
    {items.map((t, i) => t.x != null && (
      <g key={i}>
        <line x1={t.x} x2={t.x} y1={Y_TOP + 10} y2={392} />
        {etiquetas && (
          <text x={t.x + (t.tipo === 'inicio' ? 0.8 : -0.8)} y={Y_TOP + 13 + (i % 2) * 3} fontSize={2}
            textAnchor={t.tipo === 'inicio' ? 'start' : 'end'}>{t.texto}</text>
        )}
        <title>{`${t.texto} · PK ${fmtPk(t.pk)} (plano de CDV)`}</title>
      </g>
    ))}
  </g>
);

export const RotulosSvg: React.FC<{ items: Rotulo[] }> = ({ items }) => (
  <g className="esq-rotulo">
    {items.map((r, i) => (
      <text key={i} x={r.x} y={r.y} fontSize={Math.max(2.2, r.size * 0.9)}
        transform={Math.abs(r.ang) > 0.5 ? `rotate(${r.ang} ${r.x} ${r.y})` : undefined}>{r.texto}</text>
    ))}
  </g>
);
