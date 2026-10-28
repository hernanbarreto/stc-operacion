// Ubicación de los nombres de CDV físico y de sección: el CDV de un lado de la vía y sus secciones del otro.
import type { Esquematico, Tramo } from './types';

export interface RotuloVia {
  tipo: 'cdv' | 'seccion';
  id: string;
  x: number;
  y: number;
  lado: -1 | 1;        // -1 arriba de la vía, 1 abajo
  largo: number;       // largo horizontal disponible (unidades de lienzo)
}

const Y_MEDIO = 228;

function tramoMayor(ts: Tramo[]): Tramo | null {
  let mejor: Tramo | null = null;
  for (const t of ts) if (!mejor || Math.abs(t[2] - t[0]) > Math.abs(mejor[2] - mejor[0])) mejor = t;
  return mejor;
}

export function calcularRotulos(data: Esquematico): RotuloVia[] {
  const out: RotuloVia[] = [];
  const ladoCdv = new Map<string, -1 | 1>();
  for (const c of data.cdvs) {
    const t = tramoMayor(c.tramos);
    if (!t) continue;
    const x = (t[0] + t[2]) / 2, y = (t[1] + t[3]) / 2;
    const lado: -1 | 1 = y < Y_MEDIO ? -1 : 1;
    ladoCdv.set(c.id, lado);
    const largo = c.tramos.reduce((s, q) => s + Math.abs(q[2] - q[0]), 0);
    out.push({ tipo: 'cdv', id: c.id, x, y, lado, largo });
  }
  for (const s of data.secciones) {
    const t = tramoMayor(s.tramos);
    if (!t) continue;
    const x = (t[0] + t[2]) / 2, y = (t[1] + t[3]) / 2;
    const ladoC = s.cdv ? ladoCdv.get(s.cdv) : undefined;
    const lado: -1 | 1 = ladoC ? (ladoC === -1 ? 1 : -1) : (y < Y_MEDIO ? 1 : -1);
    out.push({ tipo: 'seccion', id: s.id, x, y, lado, largo: Math.abs(t[2] - t[0]) });
  }
  return out;
}
