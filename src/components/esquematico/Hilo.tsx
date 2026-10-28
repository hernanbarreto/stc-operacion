// Diagrama de hilo (posición × tiempo) alineado en x con el esquemático: cada tren es una línea; clic para elegir
// tren y momento, rueda para cambiar la escala de tiempo, arrastre para desplazarse en el tiempo.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { EjePk } from './resolver';
import { type ModeloEventos, numeroEn } from './eventos';
import { horaTxt } from './fecha';
import { COLOR_MATERIAL } from './constantes';

export interface MarchaDibujo { etiqueta: string; color: string; puntos: { t: number; pk: number }[] }
export interface MarcaEvento { t: number; x: number; color: string; titulo: string; i: number }

interface Props {
  mod: ModeloEventos;
  eje: EjePk;
  recorridos: Map<string, { t: number; pk: number; via: number }[][]>;
  vx: number;
  vw: number;
  t: number;
  span: number;
  onT: (t: number) => void;
  onSpan: (s: number) => void;
  sel: string | null;
  onSel: (clave: string | null) => void;
  marchas: MarchaDibujo[];
  marcas: MarcaEvento[];
  onMarca: (i: number) => void;
  estaciones: { codigo: string; x: number }[];
}

const POS_CURSOR = 0.4;
const PASOS = [60e3, 300e3, 600e3, 900e3, 1800e3, 3600e3, 7200e3];

export const Hilo: React.FC<Props> = ({ mod, eje, recorridos, vx, vw, t, span, onT, onSpan, sel, onSel, marchas, marcas, onMarca, estaciones }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [tam, setTam] = useState({ w: 800, h: 240 });
  const [hoverT, setHoverT] = useState<number | null>(null);
  const drag = useRef<{ y: number; t: number; movio: boolean } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => { const r = el.getBoundingClientRect(); setTam({ w: Math.max(100, r.width), h: Math.max(60, r.height) }); };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = tam;
  const tTop = t - span * POS_CURSOR;
  const tBot = tTop + span;
  const X = (xc: number) => ((xc - vx) / vw) * w;
  const Y = (tt: number) => ((tt - tTop) / span) * h;

  // trayectorias visibles en píxeles
  const lineas = useMemo(() => {
    const out: { clave: string; material: string | null; d: string; etiqueta: { x: number; y: number; txt: string } | null; pts: [number, number][] }[] = [];
    for (const tr of mod.trenes) {
      const tramos = recorridos.get(tr.clave) ?? [];
      const pts: [number, number][] = [];
      let d = '';
      let etiqueta: { x: number; y: number; txt: string } | null = null;
      for (const tramo of tramos) {
        if (tramo[tramo.length - 1].t < tTop - 60e3 || tramo[0].t > tBot + 60e3) continue;
        let primero = true;
        for (const p of tramo) {
          if (p.t < tTop - 300e3 || p.t > tBot + 300e3) { primero = true; continue; }
          const xc = eje.xAt(p.pk);
          if (xc == null) continue;
          const px = ((xc - vx) / vw) * w, py = ((p.t - tTop) / span) * h;
          d += `${primero ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`;
          pts.push([px, py]);
          if (!etiqueta && py >= 0 && py <= h && px >= 0 && px <= w) {
            etiqueta = { x: px, y: py, txt: `${numeroEn(mod, tr, p.t) ?? '—'} · ${tr.clave.replace(/ \((nm\d+)\)/, '·$1')}` };
          }
          primero = false;
        }
      }
      if (d) out.push({ clave: tr.clave, material: tr.material, d, etiqueta, pts });
    }
    return out;
  }, [mod, recorridos, eje, tTop, tBot, span, vx, vw, w, h]);

  const paso = PASOS.find(p => span / p <= 14) ?? 7200e3;
  const ticks: number[] = [];
  for (let tt = Math.ceil(tTop / paso) * paso; tt <= tBot; tt += paso) ticks.push(tt);

  const tiempoDe = (clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    return tTop + ((clientY - r.top) / r.height) * span;
  };

  const trenCercano = (cx: number, cy: number): string | null => {
    let mejor: { d: number; clave: string } | null = null;
    for (const l of lineas) {
      for (let i = 1; i < l.pts.length; i++) {
        const [x0, y0] = l.pts[i - 1], [x1, y1] = l.pts[i];
        if ((cy < Math.min(y0, y1) - 2) || (cy > Math.max(y0, y1) + 2)) continue;
        const xx = y1 === y0 ? (x0 + x1) / 2 : x0 + ((cy - y0) * (x1 - x0)) / (y1 - y0);
        const dd = Math.abs(xx - cx);
        if (dd < 9 && (!mejor || dd < mejor.d)) mejor = { d: dd, clave: l.clave };
      }
    }
    return mejor?.clave ?? null;
  };

  return (
    <div className="esq-hilo" ref={ref}
      onWheel={e => { onSpan(Math.min(24 * 3600e3, Math.max(5 * 60e3, span * Math.exp(e.deltaY * 0.0012)))); }}
      onPointerDown={e => { drag.current = { y: e.clientY, t, movio: false }; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); }}
      onPointerMove={e => {
        setHoverT(tiempoDe(e.clientY));
        const d = drag.current;
        if (!d) return;
        if (Math.abs(e.clientY - d.y) > 3) d.movio = true;
        if (d.movio) onT(d.t - ((e.clientY - d.y) / h) * span);
      }}
      onPointerUp={e => {
        const d = drag.current;
        drag.current = null;
        if (!d || d.movio) return;
        const r = ref.current!.getBoundingClientRect();
        const cx = e.clientX - r.left, cy = e.clientY - r.top;
        onT(tiempoDe(e.clientY));
        onSel(trenCercano(cx, cy));
      }}
      onPointerLeave={() => setHoverT(null)}>
      <svg width={w} height={h}>
        {estaciones.map(e => {
          const x = X(e.x);
          return x < -20 || x > w + 20 ? null : (
            <g key={e.codigo} className="esq-hilo-est">
              <line x1={x} x2={x} y1={0} y2={h} />
              <text x={x} y={11}>{e.codigo}</text>
            </g>
          );
        })}
        {ticks.map(tt => (
          <g key={tt} className="esq-hilo-tick">
            <line x1={0} x2={w} y1={Y(tt)} y2={Y(tt)} />
            <text x={4} y={Y(tt) - 2}>{horaTxt(tt).slice(0, 5)}</text>
          </g>
        ))}
        {marchas.map((m, i) => {
          let d = '';
          let primero = true;
          for (const p of m.puntos) {
            if (p.t < tTop - 300e3 || p.t > tBot + 300e3) { primero = true; continue; }
            const xc = eje.xAt(p.pk);
            if (xc == null) continue;
            d += `${primero ? 'M' : 'L'}${X(xc).toFixed(1)} ${Y(p.t).toFixed(1)}`;
            primero = false;
          }
          return d ? <path key={i} d={d} className="esq-hilo-marcha" stroke={m.color} /> : null;
        })}
        {lineas.map(l => (
          <path key={l.clave} d={l.d} className={`esq-hilo-tren${sel === l.clave ? ' activo' : ''}`}
            stroke={sel === l.clave ? '#fbbf24' : COLOR_MATERIAL[l.material ?? ''] ?? '#94a3b8'} />
        ))}
        {lineas.map(l => l.etiqueta && (
          <text key={`e${l.clave}`} x={l.etiqueta.x + 3} y={l.etiqueta.y - 3} className={`esq-hilo-lbl${sel === l.clave ? ' activo' : ''}`}>{l.etiqueta.txt}</text>
        ))}
        {marcas.map(m => {
          const x = X(m.x), y = Y(m.t);
          return x < 0 || x > w || y < 0 || y > h ? null : (
            <circle key={m.i} cx={x} cy={y} r={2.6} fill={m.color} className="esq-hilo-marca"
              onPointerUp={e => { e.stopPropagation(); onMarca(m.i); }}>
              <title>{`${horaTxt(m.t)} · ${m.titulo}`}</title>
            </circle>
          );
        })}
        <line x1={0} x2={w} y1={Y(t)} y2={Y(t)} className="esq-hilo-ahora" />
        <text x={w - 4} y={Y(t) - 3} className="esq-hilo-ahora-lbl">{horaTxt(t)}</text>
        {hoverT != null && <text x={w - 4} y={h - 4} className="esq-hilo-hover">{horaTxt(hoverT)}</text>}
      </svg>
    </div>
  );
};
