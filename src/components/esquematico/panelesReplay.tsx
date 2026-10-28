// Paneles de la reproducción de eventos: lista de eventos, estado del sistema y ficha de tren.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ElementoRef } from './types';
import { type Categoria, type Evento, type ModeloEventos, indiceEvento, numeroEn } from './eventos';
import type { EstadoInstante } from './replay';
import { horaTxt } from './fecha';
import { COLOR_CATEGORIA } from './constantes';
import { fmtPk } from './resolver';

const CATS: { k: Categoria; label: string }[] = [
  { k: 'movimiento', label: 'Movimiento' }, { k: 'alarma', label: 'Alarmas' }, { k: 'comando', label: 'Comandos' },
  { k: 'tren', label: 'Trenes' }, { k: 'ihm', label: 'IHM' }, { k: 'enclavamiento', label: 'Enclav.' }, { k: 'otro', label: 'Otros' },
];

const refTxt = (r: ElementoRef) => r.id;
const rk = (r: ElementoRef) => `${r.tipo}:${r.id}`;

export const EventosPanel: React.FC<{
  mod: ModeloEventos; t: number; sel: ElementoRef | null; onIr: (e: Evento) => void; onSel: (r: ElementoRef) => void;
}> = ({ mod, t, sel, onIr, onSel }) => {
  const [cats, setCats] = useState<Set<Categoria>>(new Set(['alarma', 'comando', 'tren', 'ihm', 'enclavamiento', 'otro']));
  const [texto, setTexto] = useState('');
  const [soloSel, setSoloSel] = useState(true);
  const lista = useRef<HTMLDivElement>(null);
  const filtrados = useMemo(() => {
    const q = texto.trim().toLowerCase();
    const k = sel ? rk(sel) : null;
    const porSel = soloSel && k;
    const out: Evento[] = [];
    const i0 = porSel ? 0 : Math.max(0, indiceEvento(mod.eventos, t - 10 * 60e3));
    const i1 = porSel ? mod.eventos.length : Math.min(mod.eventos.length, indiceEvento(mod.eventos, t + 5 * 60e3));
    for (let i = i0; i < i1; i++) {
      const e = mod.eventos[i];
      if (porSel) {
        const hit = sel!.tipo === 'tren' ? e.tren === sel!.id : e.refs.some(r => rk(r) === k);
        if (!hit) continue;
      } else if (!cats.has(e.cat)) continue;
      if (q && !e.desc.toLowerCase().includes(q) && !e.tipo.toLowerCase().includes(q)) continue;
      out.push(e);
      if (out.length > 1500) break;
    }
    return out;
  }, [mod, t, cats, texto, sel, soloSel]);
  const actual = filtrados.findIndex(e => e.t > t);
  useEffect(() => {
    const el = lista.current?.querySelector('.esq-ev.ahora');
    el?.scrollIntoView({ block: 'center' });
  }, [actual, filtrados.length]);
  return (
    <div className="esq-eventos">
      <div className="esq-ev-filtros">
        {CATS.map(c => (
          <button key={c.k} className={cats.has(c.k) ? 'on' : ''} style={{ borderColor: COLOR_CATEGORIA[c.k] }}
            onClick={() => setCats(s => { const n = new Set(s); if (n.has(c.k)) n.delete(c.k); else n.add(c.k); return n; })}>{c.label}</button>
        ))}
      </div>
      <input className="esq-ev-buscar" placeholder="Filtrar texto…" value={texto} onChange={e => setTexto(e.target.value)} />
      {sel && (
        <label className="esq-ev-sel"><input type="checkbox" checked={soloSel} onChange={e => setSoloSel(e.target.checked)} /> Sólo eventos de {sel.tipo === 'tren' ? 'tren' : sel.tipo} {sel.id}</label>
      )}
      <div className="esq-ev-lista" ref={lista}>
        {filtrados.map((e, i) => (
          <div key={e.i} className={`esq-ev${e.t > t ? ' futuro' : ''}${i === actual ? ' ahora' : ''}`} onClick={() => onIr(e)}>
            <span className="h">{horaTxt(e.t)}</span>
            <i style={{ background: COLOR_CATEGORIA[e.cat] }} />
            <span className="d">
              <b>{e.tipo}</b> {e.desc}
              {e.refs.length > 0 && <span className="refs">{e.refs.map(r => <button key={rk(r)} className="esq-link" onClick={ev => { ev.stopPropagation(); onSel(r); }}>{refTxt(r)}</button>)}</span>}
            </span>
          </div>
        ))}
        {!filtrados.length && <p className="esq-muted">Sin eventos para el filtro en este momento.</p>}
      </div>
    </div>
  );
};

const NOMBRE_IV: Record<string, string> = {
  detenido: 'Tren detenido en CDV', arb: 'ARB activo', alarma: 'Otras alarmas', rebase: 'Rebase de punto de parada',
  dbo: 'DBO activo', degradado: 'Tren degradado', tarjeta: 'Tarjeta de enclavamiento en fallo', ihm: 'IHM sin conexión',
  ixl: 'Enclavamiento/ATP desconectado',
};

export const EstadoPanel: React.FC<{ estado: EstadoInstante; onSel: (r: ElementoRef) => void }> = ({ estado, onSel }) => {
  const grupos = new Map<string, typeof estado.activos>();
  for (const a of estado.activos) grupos.set(a.tipo, [...(grupos.get(a.tipo) ?? []), a]);
  return (
    <div className="esq-estado">
      <h3>Estado a las {horaTxt(estado.t)}</h3>
      <h4>Trenes ({estado.trenes.length})</h4>
      <div className="esq-estado-trenes">
        {estado.trenes.map(p => (
          <button key={p.tren.clave} className={`esq-link${p.vigente ? '' : ' viejo'}`} onClick={() => onSel({ tipo: 'tren', id: p.tren.clave })}
            title={p.enAnden ? `en ${p.estCodigo}` : `PK ${fmtPk(p.pk)}`}>
            {p.numero ?? '—'}·{p.tren.clave.replace(/ \((nm\d+)\)/, '·$1')}
          </button>
        ))}
      </div>
      {estado.ixlCaidos.size > 0 && <p className="esq-estado-alerta">Desconectados del ATS: {[...estado.ixlCaidos].join(', ')}</p>}
      <h4>IHM</h4>
      {estado.ihm.length ? (
        <table className="esq-ihm"><tbody>
          <tr><th>IHM</th><th>Usuario</th><th>Servidor</th><th>Áreas</th></tr>
          {estado.ihm.map(x => (
            <tr key={x.ihm}><td>{x.ihm}</td><td>{x.usuario ?? '—'}</td><td>{x.servidor ?? '—'}</td><td>{x.areas.join(', ') || '—'}</td></tr>
          ))}
        </tbody></table>
      ) : <p className="esq-muted">Sin sesiones, servidores ni cambios de área registrados hasta este momento.</p>}
      {[...grupos.entries()].map(([tipo, l]) => (
        <section key={tipo}>
          <h4>{NOMBRE_IV[tipo] ?? tipo} ({l.length})</h4>
          {l.slice(0, 80).map((a, i) => (
            <div key={i} className="esq-estado-item">
              <span className="h">{horaTxt(a.t0)}</span> {a.texto}
              {a.refs.map(r => <button key={rk(r)} className="esq-link" onClick={() => onSel(r)}> {r.id}</button>)}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
};

export const TrenPanel: React.FC<{ mod: ModeloEventos; clave: string; t: number; estado: EstadoInstante; onIr: (t: number) => void }> = ({ mod, clave, t, estado, onIr }) => {
  const tr = mod.trenes.find(x => x.clave === clave);
  if (!tr) return <p>{clave}</p>;
  const pos = estado.trenes.find(p => p.tren.clave === clave);
  const numero = numeroEn(mod, tr, t);
  const historial = tr.cabinas.flatMap(c => (mod.numeros.get(c) ?? []).map(x => ({ ...x, cab: c }))).sort((a, b) => a.t - b.t);
  const i = tr.paradas.findIndex(p => p.t > t);
  const prox = i >= 0 ? tr.paradas.slice(i, i + 4) : [];
  return (
    <div>
      <h3>Tren {tr.clave}</h3>
      <table><tbody>
        <tr><th>Número de servicio</th><td>{numero ?? '—'}</td></tr>
        <tr><th>Material</th><td>{tr.material ?? '—'}</td></tr>
        <tr><th>Cabinas TGMT</th><td>{tr.cabinas.join(', ')}</td></tr>
        <tr><th>Posición</th><td>{pos ? (pos.enAnden ? `detenido en ${pos.estCodigo} (vía ${pos.via})` : `en marcha, PK ${fmtPk(pos.pk)} (vía ${pos.via})`) : 'sin datos en este momento'}</td></tr>
        {pos && !pos.vigente && <tr><th>Nota</th><td>dato sin actualizar (más de 15 min sin eventos de andén)</td></tr>}
        <tr><th>Eventos de andén</th><td>{tr.paradas.length}</td></tr>
      </tbody></table>
      {prox.length > 0 && <h4>Próximos eventos de andén</h4>}
      {prox.map((p, k) => (
        <div key={k} className="esq-estado-item" onClick={() => onIr(p.t)} style={{ cursor: 'pointer' }}>
          <span className="h">{horaTxt(p.t)}</span> {p.tipo === 'arr' ? 'llega a' : p.tipo === 'dep' ? 'sale de' : 'pasa sin parar por'} estación {p.est} (vía {p.via})
        </div>
      ))}
      {historial.length > 0 && <h4>Números asignados</h4>}
      {historial.map((x, k) => <div key={k} className="esq-estado-item"><span className="h">{horaTxt(x.t)}</span> cabina {x.cab}: {x.numero ?? 'borrado'}</div>)}
      <p className="esq-muted">Fuente: eventos TGMT de llegada/salida (posición por estación; entre estaciones se interpola con la marcha tipo del material) y ATS_I_Train_Number / TRAIN_CHANGED (número).</p>
    </div>
  );
};
