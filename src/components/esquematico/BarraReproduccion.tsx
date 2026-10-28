// Barra de la reproducción: origen de los eventos (día de Storage o Excel local), tiempo, play, velocidad,
// paso a paso, escala del diagrama de hilo y marcha tipo.
import React, { useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, Rewind, FastForward, FolderOpen, Crosshair } from 'lucide-react';
import type { DayIndexEntry } from '../../services/daysIndex';
import type { ModeloEventos } from './eventos';
import { horaTxt } from './fecha';

export type OpcionMarcha = 'ninguna' | 'tren' | 'NM16_V1' | 'NM16_V2' | 'NM22_V1' | 'NM22_V2';

const VELOCIDADES = [1, 2, 5, 10, 30, 60, 120, 300];
const SPANS: { ms: number; label: string }[] = [
  { ms: 10 * 60e3, label: '10 min' }, { ms: 30 * 60e3, label: '30 min' }, { ms: 3600e3, label: '1 h' },
  { ms: 3 * 3600e3, label: '3 h' }, { ms: 6 * 3600e3, label: '6 h' }, { ms: 24 * 3600e3, label: '24 h' },
];

interface Props {
  dias: DayIndexEntry[] | null;
  diasLocales: { fecha: string; n: number }[];
  archivoLocal: string | null;
  actual: { origen: string; fecha: string } | null;
  cargando: string | null;
  onDiaStorage: (e: DayIndexEntry) => void;
  onArchivo: (f: File) => void;
  onDiaLocal: (fecha: string) => void;
  mod: ModeloEventos | null;
  t: number;
  setT: (t: number) => void;
  reproduciendo: boolean;
  setReproduciendo: (v: boolean) => void;
  velocidad: number;
  setVelocidad: (v: number) => void;
  span: number;
  setSpan: (v: number) => void;
  marcha: OpcionMarcha;
  setMarcha: (m: OpcionMarcha) => void;
  seguir: boolean;
  setSeguir: (v: boolean) => void;
  hayTrenSel: boolean;
  onPaso: (dir: -1 | 1) => void;
  onClasificarStorage: () => void;
  onClasificarLocal: (fs: File[]) => void;
}

export const BarraReproduccion: React.FC<Props> = p => {
  const archivo = useRef<HTMLInputElement>(null);
  const variosArchivos = useRef<HTMLInputElement>(null);
  const t0 = p.mod?.t0 ?? p.t - 3600e3;
  const t1 = p.mod?.t1 ?? p.t + 3600e3;
  return (
    <div className="esq-replay">
      <select value={p.actual ? `${p.actual.origen}|${p.actual.fecha}` : ''} disabled={!!p.cargando}
        onChange={e => {
          const [origen, fecha] = e.target.value.split('|');
          if (origen === '__local') p.onDiaLocal(fecha);
          else { const d = p.dias?.find(x => x.source === origen && x.fecha === fecha); if (d) p.onDiaStorage(d); }
        }}>
        <option value="">{p.dias == null ? 'Eventos: sin índice de días' : 'Elegir día de eventos…'}</option>
        {p.dias?.length ? (
          <optgroup label="Archivos cargados (Storage)">
            {p.dias.map(d => <option key={`${d.source}|${d.fecha}`} value={`${d.source}|${d.fecha}`}>{d.fecha} · {d.hourStart.slice(0, 5)}–{d.hourEnd.slice(0, 5)} · {d.evCount} ev.</option>)}
          </optgroup>
        ) : null}
        {p.diasLocales.length ? (
          <optgroup label={`Excel local: ${p.archivoLocal}`}>
            {p.diasLocales.map(d => <option key={d.fecha} value={`__local|${d.fecha}`}>{d.fecha} · {d.n} filas</option>)}
          </optgroup>
        ) : null}
      </select>
      <button title="Abrir un Excel de eventos de esta computadora" onClick={() => archivo.current?.click()} disabled={!!p.cargando}><FolderOpen size={14} /></button>
      <input ref={archivo} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) p.onArchivo(f); e.target.value = ''; }} />
      <select value="" disabled={!!p.cargando} title="Clasificar los tipos de evento y descargar un CSV"
        onChange={e => { if (e.target.value === 'storage') p.onClasificarStorage(); else if (e.target.value === 'local') variosArchivos.current?.click(); }}>
        <option value="">Clasificar eventos (CSV)…</option>
        <option value="storage">Todos los Excel de Storage</option>
        <option value="local">Elegir archivos de esta computadora</option>
      </select>
      <input ref={variosArchivos} type="file" accept=".xlsx,.xls,.csv" multiple hidden
        onChange={e => { const fs = [...(e.target.files ?? [])]; if (fs.length) p.onClasificarLocal(fs); e.target.value = ''; }} />
      {p.cargando && <span className="esq-replay-cargando">{p.cargando}</span>}

      <span className="esq-replay-sep" />
      <button title="Evento anterior" onClick={() => p.onPaso(-1)} disabled={!p.mod}><SkipBack size={14} /></button>
      <button title="−1 min" onClick={() => p.setT(p.t - 60e3)}><Rewind size={14} /></button>
      <button className="play" title={p.reproduciendo ? 'Pausa (espacio)' : 'Reproducir (espacio)'} onClick={() => p.setReproduciendo(!p.reproduciendo)}>
        {p.reproduciendo ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <button title="+1 min" onClick={() => p.setT(p.t + 60e3)}><FastForward size={14} /></button>
      <button title="Evento siguiente" onClick={() => p.onPaso(1)} disabled={!p.mod}><SkipForward size={14} /></button>
      <select value={p.velocidad} onChange={e => p.setVelocidad(+e.target.value)} title="Velocidad de reproducción">
        {VELOCIDADES.map(v => <option key={v} value={v}>×{v}</option>)}
      </select>
      <span className="esq-replay-hora">{p.actual ? `${p.actual.fecha} ` : ''}{horaTxt(p.t)}</span>
      <input className="esq-replay-slider" type="range" min={t0} max={t1} step={1000} value={Math.min(t1, Math.max(t0, p.t))}
        onChange={e => p.setT(+e.target.value)} disabled={!p.mod} />

      <span className="esq-replay-sep" />
      <select value={p.span} onChange={e => p.setSpan(+e.target.value)} title="Tiempo visible en el diagrama de hilo">
        {SPANS.map(s => <option key={s.ms} value={s.ms}>hilo {s.label}</option>)}
      </select>
      <select value={p.marcha} onChange={e => p.setMarcha(e.target.value as OpcionMarcha)} title="Marcha tipo (desde la hora actual o desde la salida del tren seleccionado)">
        <option value="ninguna">Marcha tipo: no</option>
        <option value="tren" disabled={!p.hayTrenSel}>Marcha tipo del tren seleccionado</option>
        <option value="NM16_V1">Marcha tipo NM16 · V1 (PAN→OBS) desde ahora</option>
        <option value="NM16_V2">Marcha tipo NM16 · V2 (OBS→PAN) desde ahora</option>
        <option value="NM22_V1">Marcha tipo NM22 · V1 (PAN→OBS) desde ahora</option>
        <option value="NM22_V2">Marcha tipo NM22 · V2 (OBS→PAN) desde ahora</option>
      </select>
      <button className={p.seguir ? 'active' : ''} title="Seguir al tren seleccionado" disabled={!p.hayTrenSel} onClick={() => p.setSeguir(!p.seguir)}><Crosshair size={14} /></button>
    </div>
  );
};
