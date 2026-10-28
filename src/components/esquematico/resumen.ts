// Resumen de una línea por elemento (tooltip del esquemático).
import type { ElementoRef } from './types';
import { type Indice, fmtPk } from './resolver';

export function resumen(ix: Indice, r: ElementoRef): string[] {
  const d = ix.data;
  switch (r.tipo) {
    case 'seccion': {
      const s = ix.seccion.get(r.id);
      if (!s) return [r.id];
      const c = s.cdv ? ix.cdv.get(s.cdv) : undefined;
      return [`Sección ${s.id} (${s.tipo === 'aguja' ? 'de aguja' : 'virtual'})`,
        `CDV ${s.cdv ?? '—'}${c?.frecuencia?.codigo ? ` · ${c.frecuencia.codigo} ${c.frecuencia.khz} kHz` : ''}${c?.tipo ? ` · ${c.tipo}` : ''}`,
        `Longitud ${s.longitud_m != null ? `${s.longitud_m} m` : '—'} · vía ${s.vias.join(', ')}`];
    }
    case 'cdv': {
      const c = ix.cdv.get(r.id);
      return c ? [`CDV ${c.id}`, `${c.secciones.length} secciones`] : [r.id];
    }
    case 'senal': {
      const s = ix.senal.get(r.id);
      return s ? [`Señal ${s.id}`, `${s.sentido ? `sentido → ${s.sentido}` : 'sentido indeterminado'} · vía ${s.via ?? '—'}`, `PK ${s.pk_texto ?? fmtPk(s.pk)}`] : [r.id];
    }
    case 'aguja': {
      const a = ix.aguja.get(r.id);
      return a ? [`Aguja ${a.id}`, `PK ${a.pk_texto ?? fmtPk(a.pk)}`, `recta ${a.via_recta ?? '—'} · desviada ${a.via_desviada ?? '—'}`] : [r.id];
    }
    case 'anden':
    case 'bfu': {
      const p = r.tipo === 'anden' ? ix.anden.get(r.id) : ix.bfu.get(r.id);
      return p ? [`Andén ${p.estacion} ${p.plataforma ?? ''}`, `vía ${p.via ?? '—'} · ${p.pk_centro_texto ?? '—'}`, p.bfu.join(' ')] : [r.id];
    }
    case 'avc': {
      const a = ix.avc.get(r.id);
      return a ? [`${a.id}${a.provisional ? ' (provisional)' : ''}`, `TGMT id ${a.tgmt_id ?? '—'} · PK ${fmtPk(a.pk_ini)} – ${fmtPk(a.pk_fin)}`] : [r.id];
    }
    case 'estacion': {
      const e = d.estaciones.find(s => s.codigo === r.id);
      return e ? [`${e.nombre} (${e.codigo})`, `${e.mx} · ${e.enclavamiento ?? ''}`] : [r.id];
    }
    case 'baliza': {
      const b = ix.baliza.get(r.id);
      return b ? [`Baliza ${b.id}${b.provisional ? ' (provisional)' : ''}`, `PK ${b.pk_texto ?? fmtPk(b.pk)} · vía ${b.via ?? '—'}`, `sección ${b.seccion ?? '—'} · CDV ${b.cdv ?? '—'}`] : [r.id];
    }
    case 'junta': {
      const j = d.juntas[Number(r.id)];
      return j ? [`Junta ${j.via ?? ''} · ${j.tipo_cdv ?? 'tipo s/d'}${j.compensacion ? ' · lazo comp. (*)' : ''}`,
        `PK ${j.pk_texto ?? fmtPk(j.pk)}`, (j.sintonia ?? []).map(s => s.join('/')).join(' · ')] : [r.id];
    }
    case 'zona': {
      const z = ix.zona.get(r.id);
      return z ? [z.id, `vías ${z.vias.join(', ')} · PK ${fmtPk(z.pk_ini)} – ${fmtPk(z.pk_fin)}`] : [r.id];
    }
    case 'armario': {
      const a = ix.armario.get(r.id);
      return a ? [`Ubicación ${a.id}${a.capacidad ? ` · ${a.capacidad}` : ''}`, `PK ${fmtPk(a.pk_ini)} – ${fmtPk(a.pk_fin)}`] : [r.id];
    }
    case 'subestacion': {
      const s = ix.subestacion.get(r.id);
      return s ? [`S/E ${s.nombre}`, `PK ${s.pk_texto ?? fmtPk(s.pk)}`] : [r.id];
    }
    case 'equipo': {
      const e = d.equipos?.[Number(r.id)];
      return e ? [`${e.id}${e.provisional ? ' (provisional)' : ''} · ${e.estacion ?? ''}`, `fuente: plano ${e.fuente === 'SEN' ? 'de señalización' : 'de CDV'}`] : [r.id];
    }
    case 'zona_velocidad': {
      const z = d.perfil?.zonas_velocidad[Number(r.id)];
      return z ? [`${z.tipo === 'curva' ? 'Curva' : 'Zona de estación'} ${z.nombre} · ${z.via ?? ''}`,
        `${z.v ?? '?'} km/h (fuera ${z.v_fuera ?? '—'})${z.radio_m ? ` · R ${z.radio_m} m` : ''}`, `PK ${fmtPk(z.pk_ini)} – ${fmtPk(z.pk_fin)}`] : [r.id];
    }
    case 'pk':
      return [`PK ${fmtPk(Number(r.id))}`];
    case 'tren':
      return [`Tren ${r.id}`];
  }
}
