import { PERIOD_COLORS, MANIOBRA_STATIONS } from './constants';

export type DayType = 'laborable' | 'sabado' | 'domingo';

export interface Period {
  id: string;
  label: string;
  start: number;
  end: number;
  color: string;
  lc: string;
}

export function getDayType(dateStr: string): DayType {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay();
  if (dow === 0) return 'domingo';
  if (dow === 6) return 'sabado';
  return 'laborable';
}

export function getPeriodsForDay(dt: DayType): Period[] {
  switch (dt) {
    case 'laborable': return [
      { id: 'N1', label: 'NORMAL', start: 5, end: 6, ...PERIOD_COLORS.N },
      { id: 'PM', label: 'P.MAÑ', start: 6, end: 10, ...PERIOD_COLORS.PM },
      { id: 'V', label: 'VALLE', start: 10, end: 17, ...PERIOD_COLORS.V },
      { id: 'PV', label: 'P.TARDE', start: 17, end: 22, ...PERIOD_COLORS.PV },
      { id: 'N2', label: 'NORMAL', start: 22, end: 24, ...PERIOD_COLORS.N },
    ];
    case 'sabado': return [
      { id: 'V', label: 'VALLE', start: 6, end: 22, ...PERIOD_COLORS.V },
      { id: 'N', label: 'NORMAL', start: 22, end: 24, ...PERIOD_COLORS.N },
    ];
    case 'domingo': return [
      { id: 'N1', label: 'NORMAL', start: 7, end: 9, ...PERIOD_COLORS.N },
      { id: 'V', label: 'VALLE', start: 9, end: 20, ...PERIOD_COLORS.V },
      { id: 'N2', label: 'NORMAL', start: 20, end: 24, ...PERIOD_COLORS.N },
    ];
  }
}

export function isManiobra(estacion: string, via: string) {
  if (MANIOBRA_STATIONS.has(estacion)) return true;
  if (estacion === 'PAN' && via !== '1' && via !== '3' && via !== '7') return true;
  if (via === '4') return true;
  if (via.toUpperCase() === 'Z') return true;
  return false;
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

export function parseTime(t: string) {
  const [h, m, s] = t.split(':').map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
}
