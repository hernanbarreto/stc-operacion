// Paneles laterales del esquemático: detalle por elemento, inspector de PK, fuentes, observaciones y leyenda.
import React from 'react';
import { X } from 'lucide-react';
import type { ElementoRef, Esquematico, Fuente, Junta } from './types';
import { type EjePk, type Indice, fmtPk, juntasDe, perfilEn, rangoX, resolver } from './resolver';
import { resumen } from './resumen';
import { COLOR_CATEGORIA, COLOR_ESTADO, COLOR_MATERIAL, FREQ_COLORS, IXL_COLORS, LAZO_COLORS, SIN_DATO, TIPO_COLORS, VIA_IHM, colorVelocidad, type Modo } from './constantes';
import { glifoJunta } from './glifos';


// ───────────────────────── tooltip ─────────────────────────

export const Tooltip: React.FC<{ ix: Indice; r: ElementoRef; x: number; y: number }> = ({ ix, r, x, y }) => (
  <div className="esq-tooltip" style={{ left: x + 14, top: y + 14 }}>
    {resumen(ix, r).filter(Boolean).map((l, i) => <div key={i} className={i === 0 ? 'esq-tt-title' : ''}>{l}</div>)}
  </div>
);

// ───────────────────────── piezas comunes ─────────────────────────

const Fila: React.FC<{ k: string; children: React.ReactNode }> = ({ k, children }) => (
  <tr><th>{k}</th><td>{children}</td></tr>
);

const Src: React.FC<{ ids: string[]; fuentes: Map<string, Fuente>; hojas?: string }> = ({ ids, fuentes, hojas }) => (
  <div className="esq-src">
    {ids.map(id => {
      const f = fuentes.get(id);
      return f ? (
        <span key={id} title={f.titulo}>
          {f.codigo} rev {f.revision} ({f.fecha_revision}){id === 'SEN' ? ` · hoja ${hojas ?? '1/25'}` : ''}
        </span>
      ) : null;
    })}
  </div>
);

const lazoTxt = (j: Junta) => [j.tipos_cdv?.join('/') ?? j.tipo_cdv ?? '—', j.compensacion ? 'con lazo de compensación de 300 mm² (*)' : ''].filter(Boolean).join(' · ');

const PerfilTabla: React.FC<{ data: Esquematico; vias: string[]; x0: number; x1: number; onSel: (r: ElementoRef) => void }> = ({ data, vias, x0, x1, onSel }) => {
  const { velocidad, pendientes } = perfilEn(data, vias, x0, x1);
  if (!velocidad.length && !pendientes.length) return null;
  const zs = data.perfil?.zonas_velocidad ?? [];
  return (
    <div className="esq-perfil">
      <h4>Perfil de vía (plano de señalización)</h4>
      {velocidad.map((z, i) => (
        <div key={`v${i}`} className="esq-perfil-fila">
          <i style={{ background: colorVelocidad(z.v) }} />
          <button className="esq-link" onClick={() => onSel({ tipo: 'zona_velocidad', id: String(zs.indexOf(z)) })}>{z.nombre}</button>
          <span>{z.tipo === 'curva' ? 'curva' : 'estación'} · {z.v ?? '?'} km/h{z.radio_m ? ` · R ${z.radio_m} m` : ''}</span>
        </div>
      ))}
      {pendientes.map((s, i) => (
        <div key={`p${i}`} className="esq-perfil-fila">
          <i className="pend" />
          <span>{s.nombre} · {s.permil ?? '?'}‰ · {fmtPk(s.pk_ini)} – {fmtPk(s.pk_fin)}</span>
        </div>
      ))}
    </div>
  );
};

// ───────────────────────── inspector de PK ─────────────────────────

const InspectorPk: React.FC<{ ix: Indice; pk: number; eje: EjePk; onSel: (r: ElementoRef) => void }> = ({ ix, pk, eje, onSel }) => {
  const d = ix.data;
  const x = eje.xAt(pk);
  if (x == null) return <p>PK fuera del plano.</p>;
  const secs = d.secciones.filter(s => s.tramos.some(t => Math.min(t[0], t[2]) - 0.2 <= x && x <= Math.max(t[0], t[2]) + 0.2));
  const enc = (d.encabezado ?? []).filter(e => e.pk != null && Math.abs(e.pk - pk) <= 30)
    .sort((a, b) => (b.pk ?? 0) - (a.pk ?? 0));
  const zv = (d.perfil?.zonas_velocidad ?? []).map((z, i) => ({ z, i })).filter(({ z }) => Math.min(z.x0, z.x1) <= x && x <= Math.max(z.x0, z.x1));
  const pe = (d.perfil?.pendientes ?? []).filter(s => s.x0 != null && s.x1 != null && Math.min(s.x0, s.x1) <= x && x <= Math.max(s.x0, s.x1));
  const zo = (d.zonas ?? []).filter(z => z.x0 <= x && x <= z.x1);
  const ar = (d.armarios ?? []).filter(a => a.x0 != null && a.x1 != null && a.x0 <= x && x <= a.x1);
  const se = (d.subestaciones ?? []).filter(s => s.pk != null).sort((a, b) => Math.abs((a.pk ?? 0) - pk) - Math.abs((b.pk ?? 0) - pk))[0];
  const ba = d.balizas.filter(b => b.pk != null && Math.abs(b.pk - pk) <= 30);
  return (
    <>
      <h3>PK {fmtPk(pk)}</h3>
      <p className="esq-muted">Todo lo que los planos ubican en este punto (± 30 m en cabeceras y balizas).</p>
      <h4>Secciones / CDV en este punto</h4>
      <table><tbody>
        {secs.map(s => (
          <Fila key={s.id} k={s.vias.join(', ')}>
            <button className="esq-link" onClick={() => onSel({ tipo: 'seccion', id: s.id })}>{s.id}</button>
            {s.cdv && <> · <button className="esq-link" onClick={() => onSel({ tipo: 'cdv', id: s.cdv as string })}>{s.cdv}</button></>}
          </Fila>
        ))}
      </tbody></table>
      {(zv.length > 0 || pe.length > 0) && <h4>Perfil</h4>}
      {zv.map(({ z, i }) => (
        <div key={i} className="esq-perfil-fila"><i style={{ background: colorVelocidad(z.v) }} />
          <button className="esq-link" onClick={() => onSel({ tipo: 'zona_velocidad', id: String(i) })}>{z.nombre}</button>
          <span>{z.via} · {z.v ?? '?'} km/h{z.radio_m ? ` · R ${z.radio_m} m` : ''}</span></div>
      ))}
      {pe.map((s, i) => <div key={i} className="esq-perfil-fila"><i className="pend" /><span>{s.nombre} · {s.via ?? s.aguja} · {s.permil ?? '?'}‰</span></div>)}
      {(zo.length > 0 || ar.length > 0 || se) && <h4>Zonas y equipos</h4>}
      {zo.map(z => <div key={z.id}><button className="esq-link" onClick={() => onSel({ tipo: 'zona', id: z.id })}>{z.id}</button> <span className="esq-muted">({z.vias.join(', ')})</span></div>)}
      {ar.map(a => <div key={a.clave}><button className="esq-link" onClick={() => onSel({ tipo: 'armario', id: a.clave })}>{a.id}</button> <span className="esq-muted">{a.capacidad ?? ''}</span></div>)}
      {se && <div>S/E más cercana: <button className="esq-link" onClick={() => onSel({ tipo: 'subestacion', id: se.nombre ?? '' })}>{se.nombre}</button> <span className="esq-muted">({se.pk_texto})</span></div>}
      {ba.length > 0 && <h4>Balizas (± 30 m)</h4>}
      {ba.map(b => <span key={b.id}><button className="esq-link" onClick={() => onSel({ tipo: 'baliza', id: b.id })}>{b.provisional ? '*' : ''}{b.id}</button> </span>)}
      {enc.length > 0 && <h4>Cabeceras de los planos (± 30 m)</h4>}
      <table className="esq-enc"><tbody>
        {enc.map((e, i) => (
          <tr key={i}><td>{e.pk_texto ?? fmtPk(e.pk)}</td><td>{e.texto}</td><td className="esq-muted">{e.fuente}</td></tr>
        ))}
      </tbody></table>
    </>
  );
};

// ───────────────────────── detalle por elemento ─────────────────────────

export const Detalle: React.FC<{
  ix: Indice; r: ElementoRef; fuentes: Map<string, Fuente>; eje: EjePk;
  onSel: (r: ElementoRef) => void; onClose: () => void;
}> = ({ ix, r, fuentes, eje, onSel, onClose }) => {
  const d = ix.data;
  const link = (ref: ElementoRef, txt?: string) => <button className="esq-link" onClick={() => onSel(ref)}>{txt ?? ref.id}</button>;
  const reId = r.tipo === 'pk' ? null : new RegExp(`(^|[^A-Z0-9])${r.id.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^A-Z0-9]|$)`);
  const obs = reId ? d.observaciones.filter(o => reId.test(o.detalle)) : [];
  let body: React.ReactNode = null;

  if (r.tipo === 'seccion') {
    const s = ix.seccion.get(r.id);
    const c = s?.cdv ? ix.cdv.get(s.cdv) : undefined;
    if (s) {
      const [a, b] = rangoX(s.tramos);
      const bal = d.balizas.filter(x => x.seccion === s.id);
      body = (
        <>
          <h3>Sección {s.id}</h3>
          <table><tbody>
            <Fila k="Tipo">{s.tipo === 'aguja' ? 'Sección de aguja' : 'Sección virtual (subdivisión de CDV)'}</Fila>
            <Fila k="CDV físico">{s.cdv ? link({ tipo: 'cdv', id: s.cdv }) : '—'}</Fila>
            <Fila k="Estación">{s.estacion ?? '—'}</Fila>
            <Fila k="Vía">{s.vias.join(', ')}</Fila>
            <Fila k="Longitud">{s.longitud_m != null ? `${s.longitud_m} m` : '—'}</Fila>
            {c && <Fila k="Frecuencia CDV">{c.frecuencia ? `${c.frecuencia.codigo ?? ''} ${c.frecuencia.khz} kHz` : '—'}</Fila>}
            {c && <Fila k="Tipo CDV">{c.tipo ?? '—'}</Fila>}
            <Fila k="PK aprox.">{fmtPk(eje.pkAt(Math.max(a, b)))} – {fmtPk(eje.pkAt(Math.min(a, b)))}</Fila>
            {bal.length > 0 && <Fila k="Balizas">{bal.map(x => <span key={x.id}>{link({ tipo: 'baliza', id: x.id }, `${x.provisional ? '*' : ''}${x.id}`)} </span>)}</Fila>}
          </tbody></table>
          <PerfilTabla data={d} vias={s.vias} x0={a} x1={b} onSel={onSel} />
          <Src ids={c?.en_plano_cdv ? ["SEN", "CDV"] : ["SEN"]} fuentes={fuentes} />
        </>
      );
    }
  } else if (r.tipo === 'cdv') {
    const c = ix.cdv.get(r.id);
    if (c) {
      const [a, b] = rangoX(c.tramos);
      const js = juntasDe(d, c);
      const bal = d.balizas.filter(x => x.cdv === c.id);
      body = (
        <>
          <h3>CDV {c.id}</h3>
          <table><tbody>
            {c.alias.length > 0 && <Fila k="En plano de CDV">{c.alias.join(', ')}</Fila>}
            <Fila k="Estación">{c.estacion ?? '—'}</Fila>
            <Fila k="Vía">{c.vias.join(', ')}</Fila>
            <Fila k="Tipo">{c.tipo ?? '—'}</Fila>
            <Fila k="Frecuencia">{c.frecuencia ? `${c.frecuencia.codigo ?? ''} ${c.frecuencia.khz} kHz` : '—'}</Fila>
            <Fila k="Secciones">{c.secciones.map(s => <span key={s}>{link({ tipo: 'seccion', id: s })} </span>)}</Fila>
            <Fila k="Long. secciones">{c.longitud_secciones_m != null ? `${c.longitud_secciones_m} m` : '—'}</Fila>
            <Fila k="PK juntas">{c.pk_juntas.length ? c.pk_juntas.map(fmtPk).join(' · ') : '—'}</Fila>
            {js.map(({ j, i }) => (
              <Fila key={i} k={`Junta ${fmtPk(j.pk)}`}>
                {link({ tipo: 'junta', id: String(i) }, lazoTxt(j))}
                {j.sintonia?.length ? <div className="esq-muted">{j.sintonia.map(s => s.join(' / ')).join(' · ')}{j.r?.length ? ` · ${j.r.join('/')}` : ''}</div> : null}
              </Fila>
            ))}
            {c.armarios?.length ? <Fila k="Ubicación equipos">{c.armarios.map(x => <span key={x}>{link({ tipo: 'armario', id: x }, x.split('@')[0])} </span>)}</Fila> : null}
            {bal.length > 0 && <Fila k="Balizas">{bal.map(x => <span key={x.id}>{link({ tipo: 'baliza', id: x.id }, `${x.provisional ? '*' : ''}${x.id}`)} </span>)}</Fila>}
            {c.nombre_inferido && <Fila k="Nota">Nombre inferido (sin etiqueta propia en la tira)</Fila>}
          </tbody></table>
          <PerfilTabla data={d} vias={c.vias} x0={a} x1={b} onSel={onSel} />
          <Src ids={c.en_plano_cdv ? ['SEN', 'CDV'] : ['SEN']} fuentes={fuentes} />
        </>
      );
    }
  } else if (r.tipo === 'senal') {
    const s = ix.senal.get(r.id);
    if (s) body = (
      <>
        <h3>Señal {s.id}</h3>
        <table><tbody>
          <Fila k="Tipo">{s.tipo === 'fin_de_via' ? 'Fin de vía (BS)' : 'Principal'}</Fila>
          <Fila k="Sentido">{s.sentido ? `hacia ${s.sentido === 'PAN' ? 'Pantitlán' : 'Observatorio'}` : 'no determinado'}</Fila>
          <Fila k="Focos">{s.focos.map(f => ({ R: 'rojo', V: 'verde', A: 'amarillo' }[f])).join(', ') || '—'}</Fila>
          <Fila k="Vía">{s.via ?? '—'}</Fila>
          <Fila k="PK">{s.pk_texto ?? fmtPk(s.pk)}</Fila>
          <Fila k="Estación">{s.estacion ?? '—'}</Fila>
          {s.obs && <Fila k="Nota">{s.obs}</Fila>}
          {d.marcadores_al.filter(m => m.senal === s.id).length > 0 && <Fila k="Marcadores AL">{d.marcadores_al.filter(m => m.senal === s.id).length}</Fila>}
        </tbody></table>
        <p className="esq-muted">En el log del ATS aparece también como {s.id}LRTB.</p>
        <Src ids={['SEN']} fuentes={fuentes} />
      </>
    );
  } else if (r.tipo === 'aguja') {
    const a = ix.aguja.get(r.id);
    const sec = ix.seccion.get(r.id);
    const va = d.perfil?.velocidad_agujas.filter(v => v.aguja === r.id) ?? [];
    const fp = d.puntos_libramiento.filter(f => f.aguja === r.id);
    if (a) body = (
      <>
        <h3>Aguja {a.id}</h3>
        <table><tbody>
          <Fila k="PK">{a.pk_texto ?? fmtPk(a.pk)}</Fila>
          <Fila k="Vía (talón)">{a.via ?? '—'}</Fila>
          <Fila k="Rama recta">{a.via_recta ?? '—'}</Fila>
          <Fila k="Rama desviada">{a.via_desviada ?? '—'}{a.pk_desviada_local != null ? ` (cadenamiento ${fmtPk(a.pk_desviada_local)})` : ''}</Fila>
          <Fila k="Sección">{sec ? link({ tipo: 'seccion', id: sec.id }) : '—'}</Fila>
          {va.length > 0 && <Fila k="Velocidad">{va.map(v => `${v.v ?? '?'} km/h${v.pk_local.length ? ` (${v.pk_local.join(' – ')})` : ''}`).join(' · ')}</Fila>}
          {fp.length > 0 && <Fila k="Punto de libramiento">{fp.map(f => fmtPk(f.pk)).join(' · ')}</Fila>}
          <Fila k="Normal">Rama recta (asumida; confirmar con tabla de enclavamiento)</Fila>
          {a.obs && <Fila k="Nota">{a.obs}</Fila>}
        </tbody></table>
        <Src ids={['SEN']} fuentes={fuentes} />
      </>
    );
  } else if (r.tipo === 'anden' || r.tipo === 'bfu') {
    const p = r.tipo === 'anden' ? ix.anden.get(r.id) : ix.bfu.get(r.id);
    if (p) body = (
      <>
        <h3>Andén {p.estacion} · {p.plataforma}</h3>
        <table><tbody>
          <Fila k="Ids lógicos">{p.ids.join(', ')}</Fila>
          <Fila k="Vía">{p.via ?? '—'}</Fila>
          <Fila k="PK centro">{p.pk_centro_texto ?? '—'}</Fila>
          <Fila k="BFU">{p.bfu.join(', ') || '—'}</Fila>
          <Fila k="Equipos">{p.equipos.join(', ') || '—'}</Fila>
          <Fila k="TGMT">{p.mx ?? '—'}</Fila>
        </tbody></table>
        <Src ids={['SEN']} fuentes={fuentes} />
      </>
    );
  } else if (r.tipo === 'avc') {
    const a = ix.avc.get(r.id);
    if (a) body = (
      <>
        <h3>{a.id}</h3>
        <table><tbody>
          <Fila k="Id estación TGMT">{a.tgmt_id ?? '—'}</Fila>
          <Fila k="PK">{fmtPk(a.pk_ini)} – {fmtPk(a.pk_fin)}</Fila>
          <Fila k="Provisional">{a.provisional ? 'sí (marcado *)' : 'no'}</Fila>
          {a.alias?.length ? <Fila k="Alias">{a.alias.join(', ')}</Fila> : null}
        </tbody></table>
        <Src ids={['SEN']} fuentes={fuentes} />
      </>
    );
  } else if (r.tipo === 'estacion') {
    const e = d.estaciones.find(s => s.codigo === r.id);
    const ands = d.andenes.filter(p => p.estacion === r.id);
    const eqs = (d.equipos ?? []).map((q, i) => ({ q, i })).filter(({ q }) => q.estacion === r.id);
    const zs = (d.zonas ?? []).filter(z => z.id.endsWith(`_${r.id}`) || z.id.includes(`_${r.id}`));
    const arms = (d.armarios ?? []).filter(a => a.estacion === r.id);
    if (e) body = (
      <>
        <h3>{e.nombre} ({e.codigo})</h3>
        <table><tbody>
          <Fila k="TGMT">{e.mx} (id {e.tgmt_id})</Fila>
          <Fila k="Enclavamiento">{e.enclavamiento ?? '—'}{e.enclavamiento_fuente === 'LOG' ? ' (derivado del log)' : ''}</Fila>
          <Fila k="ATP">{e.atp ?? '—'}</Fila>
          <Fila k="Andenes">{ands.map((p, i) => (
            <div key={i}>{link({ tipo: 'anden', id: p.ids[0] ?? '' }, `${p.plataforma?.replace('PLATFORM', 'Andén') ?? '?'} · ${p.via ?? ''} · ${p.lado}`)}{' '}
              <span className="esq-muted">{p.ids.join(' ')}</span></div>
          ))}</Fila>
          <Fila k="Equipos">{eqs.filter(({ q }) => q.tipo !== 'RESET').map(({ q, i }) => (
            <span key={i}>{link({ tipo: 'equipo', id: String(i) }, `${q.id}${q.fuente === 'CDV' ? '·CDV' : ''}`)} </span>
          ))}{eqs.some(({ q }) => q.tipo === 'RESET') ? <span className="esq-muted"> + {eqs.filter(({ q }) => q.tipo === 'RESET').length} RESET</span> : null}</Fila>
          {zs.length > 0 && <Fila k="Zonas">{zs.map(z => <span key={z.id}>{link({ tipo: 'zona', id: z.id })} </span>)}</Fila>}
          {arms.length > 0 && <Fila k="Ubicaciones CDV">{arms.map(a => <span key={a.clave}>{link({ tipo: 'armario', id: a.clave }, a.id)} </span>)}</Fila>}
        </tbody></table>
        <Src ids={e.enclavamiento_fuente === 'LOG' ? ['SEN', 'CDV', 'LOG'] : ['SEN', 'CDV']} fuentes={fuentes} />
      </>
    );
  } else if (r.tipo === 'baliza') {
    const b = ix.baliza.get(r.id);
    if (b) body = (
      <>
        <h3>Baliza {b.id}</h3>
        <table><tbody>
          <Fila k="PK">{b.pk_texto ?? fmtPk(b.pk)}</Fila>
          <Fila k="Provisional">{b.provisional ? 'sí (* en el plano: servicios provisionales)' : 'no'}</Fila>
          <Fila k="Vía">{b.via ?? '—'}</Fila>
          <Fila k="Sección">{b.seccion ? link({ tipo: 'seccion', id: b.seccion }) : '—'}</Fila>
          <Fila k="CDV">{b.cdv ? link({ tipo: 'cdv', id: b.cdv }) : '—'}</Fila>
          <Fila k="Estación">{b.estacion ?? '—'}</Fila>
        </tbody></table>
        <Src ids={['SEN']} fuentes={fuentes} />
      </>
    );
  } else if (r.tipo === 'junta') {
    const j = d.juntas[Number(r.id)];
    if (j) {
      const secs = d.secciones.filter(s => s.tramos.some(t => (Math.abs(t[0] - j.x) < 0.8 && Math.abs(t[1] - j.y) < 1)
        || (Math.abs(t[2] - j.x) < 0.8 && Math.abs(t[3] - j.y) < 1)));
      body = (
        <>
          <h3>Junta {j.via ?? ''} · {fmtPk(j.pk)}</h3>
          <table><tbody>
            <Fila k="Tipo de lazo / junta">{j.tipos_cdv?.join(' / ') ?? j.tipo_cdv ?? '—'}</Fila>
            {j.via_cdv && <Fila k="Vía en plano de CDV">{j.via_cdv}</Fila>}
            <Fila k="Compensación">{j.compensacion ? 'Lazo de 300 mm² para compensar la corriente de tracción (*)' : '—'}</Fila>
            <Fila k="Unidades">{j.sintonia?.length ? j.sintonia.map((s, i) => <div key={i}>{s.join(' / ')}</div>) : '—'}</Fila>
            <Fila k="R">{j.r?.length ? j.r.join(', ') : '—'}</Fila>
            <Fila k="Ubicación equipos">{j.armarios?.length ? j.armarios.map(x => <span key={x}>{link({ tipo: 'armario', id: x }, x.split('@')[0])} </span>) : '—'}</Fila>
            <Fila k="Secciones">{secs.map(s => <span key={s.id}>{link({ tipo: 'seccion', id: s.id })} </span>)}</Fila>
            <Fila k="PK">{j.pk_texto ?? fmtPk(j.pk)}</Fila>
          </tbody></table>
          <Src ids={['SEN', 'CDV']} fuentes={fuentes} />
        </>
      );
    }
  } else if (r.tipo === 'zona') {
    const z = ix.zona.get(r.id);
    if (z) {
      const secs = d.secciones.filter(s => s.tramos.some(t => {
        const xm = (t[0] + t[2]) / 2, ym = (t[1] + t[3]) / 2;
        return xm >= z.x0 && xm <= z.x1 && ym >= z.y0 && ym <= z.y1;
      }));
      body = (
        <>
          <h3>{z.id}</h3>
          <table><tbody>
            <Fila k="Tipo">{z.tipo} (hoja {z.hoja}/25 del plano de señalización)</Fila>
            <Fila k="Vías">{z.vias.join(', ')}</Fila>
            <Fila k="PK">{fmtPk(z.pk_ini)} – {fmtPk(z.pk_fin)}</Fila>
            <Fila k="Secciones">{secs.map(s => <span key={s.id}>{link({ tipo: 'seccion', id: s.id })} </span>)}</Fila>
          </tbody></table>
          <Src ids={['SEN']} fuentes={fuentes} hojas={`${z.hoja}/25`} />
        </>
      );
    }
  } else if (r.tipo === 'armario') {
    const a = ix.armario.get(r.id);
    if (a) {
      const cds = d.cdvs.filter(c => c.armarios?.includes(a.clave));
      const js = d.juntas.map((j, i) => ({ j, i })).filter(({ j }) => j.armarios?.includes(a.clave));
      body = (
        <>
          <h3>Ubicación {a.id}</h3>
          <table><tbody>
            <Fila k="Capacidad / tipo">{a.capacidad ?? '—'}</Fila>
            {a.nota && <Fila k="Nota">({a.nota}) {d.notas?.find(n => n.texto.startsWith(`(${a.nota})`))?.texto ?? ''}</Fila>}
            <Fila k="Estación">{a.estacion}</Fila>
            <Fila k="Extensión">{fmtPk(a.pk_ini)} – {fmtPk(a.pk_fin)}</Fila>
            <Fila k="Posición en el plano">{a.lado === 'arriba' ? 'sobre vía 1' : 'bajo vía 2'}</Fila>
            <Fila k="CDV">{cds.map(c => <span key={c.id}>{link({ tipo: 'cdv', id: c.id })} </span>)}</Fila>
            <Fila k="Juntas">{js.map(({ j, i }) => <span key={i}>{link({ tipo: 'junta', id: String(i) }, `${j.via} ${fmtPk(j.pk)}`)} </span>)}</Fila>
          </tbody></table>
          <Src ids={['CDV']} fuentes={fuentes} />
        </>
      );
    }
  } else if (r.tipo === 'subestacion') {
    const s = ix.subestacion.get(r.id);
    if (s) {
      const js = s.x != null ? d.juntas.map((j, i) => ({ j, i })).filter(({ j }) => j.compensacion && Math.abs(j.x - (s.x as number)) < 60) : [];
      body = (
        <>
          <h3>S/E {s.nombre}</h3>
          <table><tbody>
            <Fila k="PK">{s.pk_texto ?? fmtPk(s.pk)}</Fila>
            {s.obs && <Fila k="Nota">{s.obs}</Fila>}
            <Fila k="Lazos de compensación">{js.length ? js.map(({ j, i }) => <span key={i}>{link({ tipo: 'junta', id: String(i) }, `${j.via} ${fmtPk(j.pk)}`)} </span>) : '—'}</Fila>
          </tbody></table>
          <Src ids={['CDV']} fuentes={fuentes} />
        </>
      );
    }
  } else if (r.tipo === 'equipo') {
    const e = d.equipos?.[Number(r.id)];
    const DESC: Record<string, string> = {
      MX: 'Sala de equipos / estación TGMT', OC: 'Object Controller', ZC: 'Zone Controller', WCU: 'WCU',
      RESET: 'RESET', PML: 'RST-PML', SALA: 'Sala técnica',
    };
    if (e) body = (
      <>
        <h3>{e.id}</h3>
        <table><tbody>
          <Fila k="Tipo">{DESC[e.tipo] ?? e.tipo}</Fila>
          <Fila k="Estación">{e.estacion ? link({ tipo: 'estacion', id: e.estacion }) : '—'}</Fila>
          {e.provisional && <Fila k="Provisional">sí (*)</Fila>}
          {e.pk != null && <Fila k="PK aprox.">{fmtPk(e.pk)}</Fila>}
          {e.via && <Fila k="Junto a vía">{e.via}</Fila>}
          <Fila k="Posición">{e.fuente === 'SEN' ? 'la del plano de señalización' : 'llevada por PK desde el plano de CDV (lado aproximado)'}</Fila>
        </tbody></table>
        <Src ids={[e.fuente]} fuentes={fuentes} />
      </>
    );
  } else if (r.tipo === 'zona_velocidad') {
    const z = d.perfil?.zonas_velocidad[Number(r.id)];
    if (z) body = (
      <>
        <h3>{z.nombre}</h3>
        <table><tbody>
          <Fila k="Tipo">{z.tipo === 'curva' ? 'Curva (restricción por curvatura)' : 'Zona de estación'}</Fila>
          <Fila k="Vía">{z.via ?? '—'}</Fila>
          <Fila k="Velocidad">{z.v ?? '—'} km/h</Fila>
          <Fila k="Fuera de la zona">{z.v_fuera ?? '—'} km/h</Fila>
          {z.tipo === 'curva' && <Fila k="Radio">{z.radio_m != null ? `${z.radio_m} m` : '—'}</Fila>}
          <Fila k="PK">{fmtPk(z.pk_ini)} – {fmtPk(z.pk_fin)}</Fila>
          {z.incompleta && <Fila k="Nota">Sólo se ubicó un extremo en el plano</Fila>}
        </tbody></table>
        <Src ids={['SEN']} fuentes={fuentes} />
      </>
    );
  } else if (r.tipo === 'pk') {
    body = <InspectorPk ix={ix} pk={Number(r.id)} eje={eje} onSel={onSel} />;
  }
  return (
    <div className="esq-detalle">
      <button className="esq-close" onClick={onClose} title="Cerrar"><X size={14} /></button>
      {body ?? <p>{r.id}</p>}
      {obs.length > 0 && (
        <div className="esq-obs-local">
          <h4>Observaciones</h4>
          {obs.map((o, i) => <p key={i}>{o.detalle}</p>)}
        </div>
      )}
    </div>
  );
};

// ───────────────────────── fuentes, observaciones, leyenda ─────────────────────────

export const Fuentes: React.FC<{ data: Esquematico }> = ({ data }) => (
  <div className="esq-fuentes">
    {data.fuentes.map(f => (
      <section key={f.id}>
        <h3>{f.titulo}</h3>
        <table><tbody>
          <Fila k="Código">{f.codigo}</Fila>
          <Fila k="Revisión">{f.revision} — {f.fecha_revision}</Fila>
          {f.descripcion_revision && <Fila k="Motivo">{f.descripcion_revision}</Fila>}
          {f.hoja && <Fila k="Hojas">{f.hoja}</Fila>}
          {f.ot && <Fila k="OT">{f.ot}</Fila>}
          {f.emisor && <Fila k="Emisor">{f.emisor}</Fila>}
          {f.uso && <Fila k="Uso en el esquemático">{f.uso}</Fila>}
          {f.sha256 && <Fila k="SHA-256">{f.sha256.slice(0, 16)}…</Fila>}
        </tbody></table>
        {f.historial && (
          <details>
            <summary>Historial de revisiones ({f.historial.length})</summary>
            <table className="esq-hist"><tbody>
              {f.historial.map(h => <tr key={h[0]}><td>{h[0]}</td><td>{h[1]}</td><td>{h[2]}</td></tr>)}
            </tbody></table>
          </details>
        )}
        {f.documentacion_de_referencia && (
          <details>
            <summary>Documentación de referencia ({f.documentacion_de_referencia.length})</summary>
            <ul>{f.documentacion_de_referencia.map(x => <li key={x}>{x}</li>)}</ul>
          </details>
        )}
      </section>
    ))}
    {data.notas?.length ? (
      <section>
        <h3>Notas de los planos</h3>
        {data.notas.map((n, i) => <p key={i} className="esq-muted">{n.texto} <em>({n.fuente})</em></p>)}
      </section>
    ) : null}
    <p className="esq-muted">{data.lienzo.nota} Lo que viene del plano de CDV se lleva al lienzo por PK con la regla de cada plano.</p>
  </div>
);

const TIPO_OBS: Record<string, string> = {
  nombre_distinto_entre_planos: 'Nombre distinto entre planos',
  cdv_solo_en_plano_cdv: 'CDV sólo en plano de CDV',
  cdv_no_en_plano_cdv: 'CDV no presente en plano de CDV',
  cdv_nombre_inferido: 'Nombre de CDV inferido',
  cdv_sin_nombre: 'CDV sin nombre',
  cdv_varios_padres: 'Junta física no detectada',
  seccion_sin_nombre: 'Tramo sin sección',
  seccion_multiple_etiqueta: 'Varias etiquetas en un tramo',
  etiqueta_sin_tramo: 'Etiqueta sin tramo',
  senal_posicion_aproximada: 'Señal con posición aproximada',
  aguja_normal_asumida: 'Posición normal de agujas',
  id_log_sin_elemento: 'Identificador del log sin elemento en el plano de señalización',
  armario_repetido: 'Ubicación de equipos de CDV repetida',
};

export const Observaciones: React.FC<{ data: Esquematico; ix: Indice; onGo: (x: number, y: number) => void; onSel: (r: ElementoRef) => void }> = ({ data, ix, onGo, onSel }) => {
  const grupos = new Map<string, typeof data.observaciones>();
  for (const o of data.observaciones) {
    const g = grupos.get(o.tipo) ?? [];
    g.push(o);
    grupos.set(o.tipo, g);
  }
  return (
    <div className="esq-obs">
      <p className="esq-muted">Diferencias y vacíos detectados al cruzar los planos y el log. Cada punto es un hallazgo del cotejo automático, a revisar contra el plano.</p>
      {[...grupos.entries()].map(([t, os]) => (
        <section key={t}>
          <h4>{TIPO_OBS[t] ?? t} ({os.length})</h4>
          {os.map((o, i) => {
            const ids = o.detalle.match(/\b[CAS][0-9Z][0-9A-Z]*\b/g) ?? [];
            return (
              <p key={i}>
                {o.detalle}
                {o.x != null && o.y != null && <button className="esq-link" onClick={() => onGo(o.x as number, o.y as number)}>ver</button>}
                {ids.slice(0, 2).map(id => {
                  const r = resolver(ix, id);
                  return r ? <button key={id} className="esq-link" onClick={() => onSel(r)}>{id}</button> : null;
                })}
              </p>
            );
          })}
        </section>
      ))}
    </div>
  );
};

const NOMBRE_LAZO: Record<string, string> = {
  LS: 'Lazo en S', LC: 'Lazo cerrado', LT: 'Lazo terminal', AC: 'Acoplador', JAR: 'Junta aislada de riel', J: 'Junta (sin tipo en el plano)',
};
const NOMBRE_ESTADO: Record<string, string> = {
  detenido: 'Tren detenido en CDV', arb: 'ARB', alarma: 'Otra alarma activa', rebase: 'Rebase de punto de parada', dbo: 'DBO activo',
  degradado: 'Tren degradado', tarjeta: 'Tarjeta de enclavamiento', ihm: 'IHM sin conexión', ixl: 'Enclavamiento / ATP desconectado',
  nrb: 'NRB', marca: 'Marca de comando (FLOTA, ITI AUTO, SALTO, BLOQ…)',
};

const Glifo: React.FC<{ tipo: string; color: string }> = ({ tipo, color }) => (
  <svg width="22" height="16" viewBox="-6 -8 12 16" className="esq-ley-glifo">
    <line x1={-6} x2={6} y1={0} y2={0} stroke="#475569" strokeWidth={1.6} />
    <path d={glifoJunta(tipo === 'J' ? null : tipo, 0, 0, 5)} stroke={color} strokeWidth={1.1} fill="none" />
  </svg>
);

export const Leyenda: React.FC<{ modo: Modo }> = ({ modo }) => (
  <div className="esq-leyenda">
    <h4>Color de las vías</h4>
    {modo === 'frecuencia' && Object.entries(FREQ_COLORS).map(([k, c]) => <div key={k}><i style={{ background: c }} />{k}</div>)}
    {modo === 'tipo' && Object.entries(TIPO_COLORS).map(([k, c]) => <div key={k}><i style={{ background: c }} />{k} (según plano de CDV)</div>)}
    {modo === 'enclavamiento' && Object.entries(IXL_COLORS).map(([k, c]) => <div key={k}><i style={{ background: c }} />{k} (derivado del log)</div>)}
    {modo === 'velocidad' && [25, 35, 60, 68, 74, 80].map(v => <div key={v}><i style={{ background: colorVelocidad(v) }} />{v} km/h</div>)}
    {modo === 'cdv' && <div>Colores alternados para distinguir la extensión de cada circuito de vía físico.</div>}
    {modo === 'ihm' && <div><i style={{ background: VIA_IHM }} />Vía (la reproducción resalta encima ocupación y alarmas)</div>}
    <div><i style={{ background: SIN_DATO }} />Sin dato en el plano</div>
    <div><b className="esq-ley-cdv">C110</b> nombre del CDV físico (un lado de la vía) · <span className="esq-ley-sec">S1102</span> sección / CDV virtual (lado opuesto)</div>
    <hr />
    <h4>Juntas (símbolo y color = tipo de lazo del plano de CDV)</h4>
    {Object.entries(LAZO_COLORS).map(([k, c]) => <div key={k}><Glifo tipo={k} color={c} />{k} — {NOMBRE_LAZO[k] ?? k}</div>)}
    <div>* = lazo de 300 mm² para compensar la corriente de tracción</div>
    <div><span className="esq-ley-junta-v" />Límite de sección (virtual)</div>
    <hr />
    <h4>Energía</h4>
    <div><svg width="22" height="16" viewBox="-6 -8 12 16"><circle cx={0} cy={-2.2} r={3} fill="#1f0a0a" stroke="#f87171" /><circle cx={0} cy={2.2} r={3} fill="#1f0a0a" stroke="#f87171" /></svg>Subestación (S/E) con su alimentación a las vías principales</div>
    <div><i style={{ background: 'rgba(239,68,68,0.45)' }} /><i style={{ background: 'rgba(249,115,22,0.45)' }} />Tramos entre subestaciones consecutivas</div>
    <hr />
    <h4>Reproducción de eventos</h4>
    {Object.entries(COLOR_MATERIAL).map(([k, c]) => <div key={k}><i style={{ background: c }} />Tren {k} (número de servicio · tren físico)</div>)}
    <div><i style={{ background: '#fbbf24' }} />Tren seleccionado · <span style={{ opacity: 0.45 }}>atenuado = dato sin actualizar</span></div>
    <div><i style={{ background: 'transparent', border: '1px dashed #fbbf24' }} />Tren de marcha tipo (comparación)</div>
    {Object.entries(NOMBRE_ESTADO).map(([k, n]) => <div key={k}><i style={{ background: COLOR_ESTADO[k] }} />{n}</div>)}
    <div><b className="esq-ley-dbo">DBO</b>DBO activo en el andén (CBTC) o en la señal (no CBTC)</div>
    <div><i style={{ background: '#22c55e' }} />Itinerario establecido (recorrido inferido del plano; N / I = posición de agujas)</div>
    <div><i style={{ background: 'transparent', border: '1px dashed #f59e0b' }} />Deslizamiento</div>
    <div><i style={{ background: 'repeating-linear-gradient(90deg,#fde047 0 3px,transparent 3px 6px)' }} />RTV: restricción temporal de velocidad (sin valor en el log)</div>
    <div>Texto junto al elemento: alarma o marca activa; con * = normalizada, pendiente de que el operador la reconozca (trazo discontinuo)</div>
    <div><i style={{ background: '#fde047' }} />Destello: elemento nombrado en un evento de los últimos 20 s (rojo: comando rechazado)</div>
    <h4>Categorías de evento (lista y diagrama de hilo)</h4>
    {Object.entries(COLOR_CATEGORIA).map(([k, c]) => <div key={k}><i style={{ background: c, width: 8, height: 8, borderRadius: '50%' }} />{k}</div>)}
    <hr />
    <div><span className="esq-ley-normal" />Rama recta de aguja (normal asumida)</div>
    <div>Señal: el brazo apunta al sentido de circulación que gobierna; focos según plano</div>
    <div>Círculo punteado: señal sin sentido determinado</div>
    <div>Barras de color sobre/bajo la tira: velocidad máxima por zona (estación / curva)</div>
    <div>Banda inferior: ubicaciones de equipos de CDV (cajas del plano de CDV)</div>
    <div>Clic en un punto vacío de la vista de detalle: todo lo que hay en ese PK</div>
  </div>
);
