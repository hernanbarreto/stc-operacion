import type { ATSEvent, AlarmEvent } from '../../types';
import { STATION_PK } from '../../data/stationPK';
import { FONT, MARGIN, SNAP_PX } from './constants';
import { roundRect } from './helpers';

interface EvPos { ev: ATSEvent; x: number; y: number }
interface DboPos { ev: ATSEvent; x: number; y: number }
interface AlarmPos { alarm: AlarmEvent; x: number; y: number }

type HoverTarget =
  | { kind: 'alarm'; x: number; y: number; alarm: AlarmEvent }
  | { kind: 'dbo'; x: number; y: number; ev: ATSEvent }
  | { kind: 'train'; x: number; y: number; ev: ATSEvent };

export interface RenderOverlayParams {
  canvas: HTMLCanvasElement;
  canvasW: number;
  canvasH: number;
  drawW: number;
  drawH: number;
  dayStart: number;
  dayEnd: number;
  evPos: EvPos[];
  dboPos: DboPos[];
  alarmPos: AlarmPos[];
  showDbo: boolean;
  showAlarms: boolean;
  mx: number;
  my: number;
}

export function renderOverlay(p: RenderOverlayParams) {
  const {
    canvas, canvasW, canvasH, drawW, drawH, dayStart, dayEnd,
    evPos, dboPos, alarmPos, showDbo, showAlarms, mx, my,
  } = p;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvasW, canvasH);

  const inArea = mx >= MARGIN.left && mx <= MARGIN.left + drawW
    && my >= MARGIN.top && my <= MARGIN.top + drawH;
  if (!inArea) return;

  // Crosshair
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(MARGIN.left, my); ctx.lineTo(MARGIN.left + drawW, my); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(mx, MARGIN.top); ctx.lineTo(mx, MARGIN.top + drawH); ctx.stroke();
  ctx.setLineDash([]);

  // Time label
  const relX = (mx - MARGIN.left) / drawW;
  const t = new Date(dayStart + relX * (dayEnd - dayStart));
  const ts = t.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  ctx.font = `600 9px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const tw = ctx.measureText(ts).width;
  roundRect(ctx, mx - tw / 2 - 5, MARGIN.top - 18, tw + 10, 15, 3);
  ctx.fillStyle = 'rgba(15,23,42,0.9)'; ctx.fill();
  ctx.fillStyle = '#e2e8f0'; ctx.fillText(ts, mx, MARGIN.top - 6);

  // Find closest hover target among trains, DBOs and alarms
  const target = pickTarget(mx, my, evPos, dboPos, alarmPos, showDbo, showAlarms);
  if (!target) return;

  // Highlight ring
  ctx.beginPath(); ctx.arc(target.x, target.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();

  const { lines, borderColor } = buildTooltipLines(target);

  if (lines.length === 0) return;

  ctx.font = `500 11px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const maxW = Math.max(...lines.map(l => ctx.measureText(l).width));
  const tipW = maxW + 20, tipH = lines.length * 17 + 12;
  let tx = target.x + 14, ty = target.y - tipH / 2;
  if (tx + tipW > canvasW - 10) tx = target.x - tipW - 14;
  if (ty < MARGIN.top) ty = MARGIN.top;
  if (ty + tipH > MARGIN.top + drawH) ty = MARGIN.top + drawH - tipH;

  roundRect(ctx, tx, ty, tipW, tipH, 6);
  ctx.fillStyle = 'rgba(15,23,42,0.95)'; ctx.fill();
  ctx.strokeStyle = borderColor; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#e2e8f0';
  lines.forEach((l, i) => ctx.fillText(l, tx + 10, ty + 7 + i * 17));
}

function pickTarget(
  mx: number, my: number,
  evPos: EvPos[], dboPos: DboPos[], alarmPos: AlarmPos[],
  showDbo: boolean, showAlarms: boolean,
): HoverTarget | null {
  let bestTrain: EvPos | null = null;
  let bestTrainD = SNAP_PX;
  for (const p of evPos) {
    const d = Math.hypot(p.x - mx, p.y - my);
    if (d < bestTrainD) { bestTrainD = d; bestTrain = p; }
  }

  let bestDbo: DboPos | null = null;
  let bestDboD = SNAP_PX;
  if (showDbo) {
    for (const p of dboPos) {
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d < bestDboD) { bestDboD = d; bestDbo = p; }
    }
  }

  let bestAlarm: AlarmPos | null = null;
  let bestAlarmD = SNAP_PX;
  if (showAlarms) {
    for (const p of alarmPos) {
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d < bestAlarmD) { bestAlarmD = d; bestAlarm = p; }
    }
  }

  // Prefer alarm > DBO > train, pick closest
  const isAlarmTarget = bestAlarm
    && (!bestTrain || bestAlarmD < bestTrainD)
    && (!bestDbo || bestAlarmD < bestDboD);
  if (isAlarmTarget && bestAlarm) {
    return { kind: 'alarm', x: bestAlarm.x, y: bestAlarm.y, alarm: bestAlarm.alarm };
  }
  const isDboTarget = bestDbo && (!bestTrain || bestDboD < bestTrainD);
  if (isDboTarget && bestDbo) {
    return { kind: 'dbo', x: bestDbo.x, y: bestDbo.y, ev: bestDbo.ev };
  }
  if (bestTrain) {
    return { kind: 'train', x: bestTrain.x, y: bestTrain.y, ev: bestTrain.ev };
  }
  return null;
}

function buildTooltipLines(target: HoverTarget): { lines: string[]; borderColor: string } {
  switch (target.kind) {
    case 'alarm': {
      const a = target.alarm;
      const pk = STATION_PK[a.estacion];
      return {
        borderColor: 'rgba(245,158,11,0.6)',
        lines: [
          `[ALARMA] ${a.eventType}`,
          `Est: ${a.estacion}  ·  ${a.estado || '—'}${pk !== undefined ? `  ·  PK ${pk.toFixed(0)}m` : ''}`,
          `${a.datetime.toLocaleTimeString('es-MX')}`,
          a.descripcion.length > 50 ? a.descripcion.substring(0, 50) + '…' : a.descripcion,
        ],
      };
    }
    case 'dbo': {
      const ev = target.ev;
      const pk = STATION_PK[ev.estacion];
      return {
        borderColor: 'rgba(239,68,68,0.5)',
        lines: [
          ev.evento === 'DBO_ACTIVAR' ? '🟥 DBO Activado' : '🟥 DBO Desactivado',
          `Est: ${ev.estacion}${pk !== undefined ? `  ·  PK ${pk.toFixed(0)}m` : ''}`,
          `Hora: ${ev.datetime.toLocaleTimeString('es-MX')}`,
        ],
      };
    }
    case 'train': {
      const ev = target.ev;
      const pk = STATION_PK[ev.estacion];
      return {
        borderColor: 'rgba(148,163,184,0.3)',
        lines: [
          `Tren: ${ev.tren}`,
          `Est: ${ev.estacion}  ·  Vía ${ev.via || '—'}${pk !== undefined ? `  ·  PK ${pk.toFixed(0)}m` : ''}`,
          `${ev.evento}  ·  ${ev.datetime.toLocaleTimeString('es-MX')}`,
        ],
      };
    }
  }
}
