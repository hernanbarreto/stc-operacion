// Plano de circuitos de vía (bifilar) sincronizado por PK con la vista de detalle del esquemático.
// Los dos planos tienen escalas distintas por tramo (cada uno amplía estaciones e interestaciones a su modo):
// el plano de CDV se deforma en x por tramos entre marcas de su regla de PK para que cada PK caiga en la misma
// x que en el plano de señalización. En la mayoría de los tramos la escala es la misma (factor 1).
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { type EjePk, fmtPk, tramosHomologos } from './resolver';
import { PlanoTiras, type PlanoIndex } from './capas';

interface Props {
  index: PlanoIndex;
  base: string;
  reglaSen: [number, number][];
  reglaCdv: [number, number][];
  ejeSen: EjePk;
  vx: number;          // rango visible del lienzo principal (x del plano de señalización)
  vw: number;
  cursorPk: number | null;
  onCursorPk: (pk: number | null) => void;
  claro: boolean;
}

const Y_CENTRO = 215;   // centro de las vías en la hoja del plano de CDV

export const PlanoCdv: React.FC<Props> = ({ index, base, reglaSen, reglaCdv, ejeSen, vx, vw, cursorPk, onCursorPk, claro }) => {
  const ref = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/:/g, '');
  const [asp, setAsp] = useState(0.3);
  const [yc, setYc] = useState(Y_CENTRO);
  const drag = useRef<{ y: number; yc: number; h: number } | null>(null);
  const tramos = useMemo(() => tramosHomologos(reglaSen, reglaCdv), [reglaSen, reglaCdv]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => {
      const r = el.getBoundingClientRect();
      setAsp(r.height / Math.max(r.width, 1));
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const h = vw * asp;
  const y0 = h >= index.alto ? (index.alto - h) / 2 : Math.max(0, Math.min(index.alto - h, yc - h / 2));
  const visibles = tramos.map((t, i) => ({ t, i })).filter(({ t }) => t.xs1 >= vx - 5 && t.xs0 <= vx + vw + 5);
  const xCur = cursorPk != null ? ejeSen.xAt(cursorPk) : null;

  return (
    <div className="esq-cdv-pane" ref={ref}>
      <div className="esq-cdv-titulo">
        {index.titulo} · alineado por PK {fmtPk(ejeSen.pkAt(vx))} – {fmtPk(ejeSen.pkAt(vx + vw))} · arrastrar: desplazar en vertical · doble clic: centrar
      </div>
      <svg viewBox={`${vx} ${y0} ${vw} ${h}`} preserveAspectRatio="none"
        onPointerDown={e => { drag.current = { y: e.clientY, yc: Math.max(h / 2, Math.min(index.alto - h / 2, yc)), h }; (e.target as Element).setPointerCapture?.(e.pointerId); }}
        onPointerMove={e => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          onCursorPk(ejeSen.pkAt(vx + ((e.clientX - r.left) / r.width) * vw));
          const d = drag.current;
          if (d) setYc(d.yc - ((e.clientY - d.y) / r.height) * d.h);
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerLeave={() => onCursorPk(null)}
        onDoubleClick={() => setYc(Y_CENTRO)}>
        <defs>
          {visibles.map(({ t, i }) => (
            <clipPath key={i} id={`${uid}-c${i}`} clipPathUnits="userSpaceOnUse">
              <rect x={t.xs0} y={0} width={t.xs1 - t.xs0} height={index.alto} />
            </clipPath>
          ))}
        </defs>
        <rect x={vx} y={y0} width={vw} height={h} className={claro ? 'esq-cdv-fondo claro' : 'esq-cdv-fondo'} />
        {visibles.map(({ t, i }) => {
          const sx = (t.xs1 - t.xs0) / (t.xc1 - t.xc0);
          return (
            <g key={i} clipPath={`url(#${uid}-c${i})`}>
              <g transform={`matrix(${sx} 0 0 1 ${t.xs0 - sx * t.xc0} 0)`}>
                <PlanoTiras base={base} index={index} x0={t.xc0} x1={t.xc1} claro={claro} />
              </g>
            </g>
          );
        })}
        {xCur != null && <line x1={xCur} x2={xCur} y1={0} y2={index.alto} className="esq-cursor-line" style={{ strokeWidth: vw / 1400 }} />}
      </svg>
    </div>
  );
};
