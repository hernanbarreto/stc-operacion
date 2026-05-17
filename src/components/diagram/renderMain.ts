import type { ATSEvent, AlarmEvent, Cursor, CursorCalculation } from '../../types';
import { STATION_PK } from '../../data/stationPK';
import { buildMarchaTipo, inferHorario, inferMaterial } from '../../data/marchaTipo';
import { formatDuration } from '../../utils/timeFormat';
import { FONT, MARGIN, PALETTE, MANIOBRA_STATIONS, MANIOBRA_ZONES } from './constants';
import { isManiobra, roundRect, type Period } from './helpers';

interface EvPos { ev: ATSEvent; x: number; y: number }
interface DboPos { ev: ATSEvent; x: number; y: number }
interface AlarmPos { alarm: AlarmEvent; x: number; y: number }

export interface RenderMainParams {
  canvas: HTMLCanvasElement;
  canvasW: number;
  canvasH: number;
  drawW: number;
  drawH: number;
  eventos: ATSEvent[];
  estaciones: string[];
  trenes: string[];
  periods: Period[];
  evPos: EvPos[];
  dboPos: DboPos[];
  alarmPos: AlarmPos[];
  mCursors: Cursor[];
  calcs: CursorCalculation[];
  zoom: number;
  showDbo: boolean;
  showAlarms: boolean;
  showMarchaTipo: boolean;
  timeToX: (t: number) => number;
  stationY: (idx: number) => number;
}

export function renderMain(p: RenderMainParams) {
  const {
    canvas, canvasW, canvasH, drawW, drawH, eventos, estaciones, trenes,
    periods, dboPos, alarmPos, mCursors, calcs, zoom,
    showDbo, showAlarms, showMarchaTipo,
    timeToX, stationY,
  } = p;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.width = canvasW;
  canvas.height = canvasH;

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvasW, canvasH);
  if (eventos.length === 0) {
    ctx.fillStyle = '#64748b';
    ctx.font = `500 14px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('Sin eventos', canvasW / 2, canvasH / 2);
    return;
  }

  const refDate = new Date(eventos[0].datetime);
  refDate.setHours(0, 0, 0, 0);

  // 1) Period bands
  periods.forEach(period => {
    const ps = new Date(refDate); ps.setHours(period.start, 0, 0, 0);
    const pe = new Date(refDate);
    pe.setHours(period.end === 24 ? 23 : period.end, period.end === 24 ? 59 : 0, period.end === 24 ? 59 : 0, 0);
    const x1 = Math.max(timeToX(ps.getTime()), MARGIN.left);
    const x2 = Math.min(timeToX(pe.getTime()), MARGIN.left + drawW);
    if (x2 <= x1) return;
    ctx.fillStyle = period.color;
    ctx.fillRect(x1, MARGIN.top, x2 - x1, drawH);
    if (x2 - x1 > 35) {
      ctx.fillStyle = period.lc; ctx.globalAlpha = 0.6;
      ctx.font = `700 8px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(period.label, (x1 + x2) / 2, MARGIN.top + 3);
      ctx.globalAlpha = 1;
    }
    const xs = timeToX(ps.getTime());
    if (xs >= MARGIN.left && xs <= MARGIN.left + drawW) {
      ctx.strokeStyle = period.lc; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]); ctx.beginPath();
      ctx.moveTo(xs, MARGIN.top); ctx.lineTo(xs, MARGIN.top + drawH); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  });

  // 2) Station grid
  estaciones.forEach((est, idx) => {
    const y = stationY(idx);
    const isM = MANIOBRA_STATIONS.has(est);
    ctx.strokeStyle = isM ? 'rgba(148,163,184,0.05)' : 'rgba(148,163,184,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(MARGIN.left, y); ctx.lineTo(MARGIN.left + drawW, y); ctx.stroke();
  });

  // 2b) Maniobra zone rectangles
  MANIOBRA_ZONES.forEach(zone => {
    const indices = zone.stations.map(s => estaciones.indexOf(s)).filter(i => i >= 0);
    if (indices.length === 0) return;
    const minY = stationY(Math.min(...indices));
    const maxY = stationY(Math.max(...indices));
    const pad = 4;
    ctx.fillStyle = 'rgba(59,130,246,0.08)';
    ctx.fillRect(MARGIN.left, minY - pad, drawW, maxY - minY + pad * 2);
    ctx.fillStyle = 'rgba(59,130,246,0.35)';
    ctx.fillRect(MARGIN.left, minY - pad, 3, maxY - minY + pad * 2);
  });

  // 2c) Intermediate maniobra ticks
  const zonedStations = new Set(MANIOBRA_ZONES.flatMap(z => z.stations));
  estaciones.forEach((est, idx) => {
    if (!MANIOBRA_STATIONS.has(est) || zonedStations.has(est)) return;
    const y = stationY(idx);
    ctx.fillStyle = 'rgba(59,130,246,0.4)';
    ctx.fillRect(MARGIN.left, y - 2, 4, 4);
  });

  // 3) Hour ticks
  for (let h = 0; h < 24; h++) {
    const hd = new Date(refDate); hd.setHours(h, 0, 0, 0);
    const x = timeToX(hd.getTime());
    if (x < MARGIN.left || x > MARGIN.left + drawW) continue;
    ctx.strokeStyle = 'rgba(148,163,184,0.15)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, MARGIN.top); ctx.lineTo(x, MARGIN.top + drawH); ctx.stroke();
    ctx.fillStyle = '#94a3b8'; ctx.font = `600 10px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${h.toString().padStart(2, '0')}:00`, x, MARGIN.top - 5);
  }
  for (let h = 0; h < 24; h++) {
    const hd = new Date(refDate); hd.setHours(h, 30, 0, 0);
    const x = timeToX(hd.getTime());
    if (x < MARGIN.left || x > MARGIN.left + drawW) continue;
    ctx.strokeStyle = 'rgba(148,163,184,0.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, MARGIN.top); ctx.lineTo(x, MARGIN.top + drawH); ctx.stroke();
    if (zoom >= 2) {
      ctx.fillStyle = '#475569'; ctx.font = `400 8px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(`${h.toString().padStart(2, '0')}:30`, x, MARGIN.top - 5);
    }
  }

  // 4) Train trajectories
  trenes.forEach((tren, ti) => {
    const col = PALETTE[ti % PALETTE.length];
    const tevs = eventos.filter(e => e.tren === tren)
      .sort((a, b) => a.datetime.getTime() - b.datetime.getTime());

    for (let i = 0; i < tevs.length - 1; i++) {
      const e1 = tevs[i], e2 = tevs[i + 1];
      const si1 = estaciones.indexOf(e1.estacion), si2 = estaciones.indexOf(e2.estacion);
      if (si1 < 0 || si2 < 0) continue;
      const x1 = timeToX(e1.datetime.getTime()), y1 = stationY(si1);
      const x2 = timeToX(e2.datetime.getTime()), y2 = stationY(si2);

      const isM = isManiobra(e1.estacion, e1.via) || isManiobra(e2.estacion, e2.via);
      if (isM) {
        ctx.strokeStyle = '#9ca3af';
        ctx.lineWidth = 1.6; ctx.globalAlpha = 0.65;
        ctx.setLineDash([4, 4]);
      } else {
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.8; ctx.globalAlpha = 0.85;
        ctx.setLineDash(e1.via === '1' ? [5, 4] : []);
      }

      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    tevs.forEach(ev => {
      const si = estaciones.indexOf(ev.estacion);
      if (si < 0) return;
      const x = timeToX(ev.datetime.getTime()), y = stationY(si);

      const isM = isManiobra(ev.estacion, ev.via);
      ctx.fillStyle = isM ? '#9ca3af' : col;
      ctx.globalAlpha = isM ? 0.7 : 0.9;

      if (ev.evento === 'PARTIO') {
        ctx.beginPath();
        if (ev.via === '1') {
          ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y - 3); ctx.lineTo(x, y + 4);
        } else {
          ctx.moveTo(x, y - 4); ctx.lineTo(x + 3, y + 3); ctx.lineTo(x - 3, y + 3);
        }
        ctx.closePath(); ctx.fill();
      } else if (ev.evento === 'ARRIBO') {
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
      } else if (ev.evento === 'SALTO') {
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke();
        ctx.strokeStyle = col;
      }
      ctx.globalAlpha = 1;
    });
  });

  // 4c) Marcha Tipo Ideal
  if (showMarchaTipo) {
    drawMarchaTipo(ctx, eventos, estaciones, timeToX, stationY);
  }

  // 4b) DBO markers
  if (showDbo) {
    dboPos.forEach(({ ev, x, y }) => {
      const sz = 6;
      if (ev.evento === 'DBO_ACTIVAR') {
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(x - sz, y - sz, sz * 2, sz * 2);
      } else {
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
        ctx.strokeRect(x - sz, y - sz, sz * 2, sz * 2);
      }
    });
  }

  // 4c) Alarm markers
  if (showAlarms) {
    alarmPos.forEach(({ alarm, x, y }) => {
      const sz = 6;
      const isFilled = alarm.estado === 'Abierta' || alarm.estado === 'Reconocida';
      ctx.beginPath();
      ctx.moveTo(x, y - sz); ctx.lineTo(x + sz, y); ctx.lineTo(x, y + sz); ctx.lineTo(x - sz, y);
      ctx.closePath();
      if (isFilled) {
        ctx.fillStyle = '#f59e0b'; ctx.fill();
        ctx.fillStyle = '#000'; ctx.font = `bold 8px ${FONT}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', x, y + 1);
      } else {
        ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#f59e0b'; ctx.font = `bold 7px ${FONT}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', x, y + 1);
      }
    });
  }

  // 5) Measurement cursors
  mCursors.forEach((cur, idx) => {
    const si = estaciones.indexOf(cur.estacion);
    if (si < 0) return;
    const x = timeToX(cur.time.getTime()), y = stationY(si);
    ctx.strokeStyle = cur.color; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
    ctx.setLineDash([4, 4]); ctx.beginPath();
    ctx.moveTo(x, MARGIN.top); ctx.lineTo(x, MARGIN.top + drawH); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = cur.color; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `bold 9px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${idx + 1}`, x, y);
  });

  if (calcs.length > 0) {
    const last = calcs[calcs.length - 1];
    const c1Si = estaciones.indexOf(last.cursorA.estacion);
    const c2Si = estaciones.indexOf(last.cursorB.estacion);
    if (c1Si >= 0 && c2Si >= 0) {
      const cx = (timeToX(last.cursorA.time.getTime()) + timeToX(last.cursorB.time.getTime())) / 2;
      const cy = (stationY(c1Si) + stationY(c2Si)) / 2;
      const durMs = Math.abs(last.cursorB.time.getTime() - last.cursorA.time.getTime());
      const text = `${formatDuration(durMs)} · ${last.distanciaEstaciones} est.`;
      ctx.font = `600 10px ${FONT}`; ctx.textAlign = 'center';
      const tw2 = ctx.measureText(text).width;
      roundRect(ctx, cx - tw2 / 2 - 8, cy - 12, tw2 + 16, 20, 4);
      ctx.fillStyle = 'rgba(15,23,42,0.9)'; ctx.fill();
      ctx.strokeStyle = 'rgba(99,102,241,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#e2e8f0'; ctx.fillText(text, cx, cy + 1);
    }
  }

  // 6) Left border
  ctx.strokeStyle = 'rgba(148,163,184,0.2)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(MARGIN.left, MARGIN.top);
  ctx.lineTo(MARGIN.left, MARGIN.top + drawH); ctx.stroke();
}

function drawMarchaTipo(
  ctx: CanvasRenderingContext2D,
  eventos: ATSEvent[],
  estaciones: string[],
  timeToX: (t: number) => number,
  stationY: (idx: number) => number,
) {
  // Cada vuelta detectada se anota con (tBase, dir, trainName) y se construye
  // su marcha tipo segun (material, via, horario).
  const departures: { tBase: number; dir: 'PAN→OBS' | 'OBS→PAN'; train: string }[] = [];
  const sortedEvs = [...eventos].sort((a, b) => a.datetime.getTime() - b.datetime.getTime());
  const byTrain: Record<string, ATSEvent[]> = {};
  sortedEvs.forEach(e => { if (!byTrain[e.tren]) byTrain[e.tren] = []; byTrain[e.tren].push(e); });
  const pkPAN = STATION_PK['PAN'] || 0;
  const pkOBS = STATION_PK['OBS'] || 0;
  Object.entries(byTrain).forEach(([train, tevs]) => {
    for (let i = 0; i < tevs.length; i++) {
      const ev = tevs[i];
      if (ev.estacion !== 'PAN' && ev.estacion !== 'OBS') continue;
      let lastIdx = i;
      while (lastIdx + 1 < tevs.length && tevs[lastIdx + 1].estacion === ev.estacion) lastIdx++;
      let nextSt = '';
      for (let j = lastIdx + 1; j < tevs.length; j++) {
        if (tevs[j].estacion !== ev.estacion) { nextSt = tevs[j].estacion; break; }
      }
      if (!nextSt || STATION_PK[nextSt] === undefined) { i = lastIdx; continue; }
      const nextPK = STATION_PK[nextSt];
      const lastEvTime = tevs[lastIdx].datetime.getTime();

      let direction: 'PAN→OBS' | 'OBS→PAN' | null = null;
      if (ev.estacion === 'PAN' && nextPK > pkPAN) direction = 'PAN→OBS';
      if (ev.estacion === 'OBS' && nextPK < pkOBS) direction = 'OBS→PAN';
      if (!direction) { i = lastIdx; continue; }

      const target = direction === 'PAN→OBS' ? 'OBS' : 'PAN';
      let reachedTarget = false;
      for (let j = lastIdx + 1; j < tevs.length; j++) {
        if (tevs[j].estacion === target) { reachedTarget = true; break; }
        if (tevs[j].estacion === ev.estacion) break;
      }
      if (!reachedTarget) { i = lastIdx; continue; }

      departures.push({ tBase: lastEvTime, dir: direction, train });
      i = lastIdx;
    }
  });

  // Para cada vuelta: construir marcha tipo Siemens en funcion de (material, via, horario)
  departures.forEach(({ tBase, dir, train }) => {
    const material = inferMaterial(train);
    const horario = inferHorario(new Date(tBase));
    const pts = buildMarchaTipo(dir, material, horario);
    drawOneMarcha(ctx, pts, tBase, dir, estaciones, timeToX, stationY);
  });
}

function drawOneMarcha(
  ctx: CanvasRenderingContext2D,
  pts: ReturnType<typeof buildMarchaTipo>,
  tBase: number,
  dir: 'PAN→OBS' | 'OBS→PAN',
  estaciones: string[],
  timeToX: (t: number) => number,
  stationY: (idx: number) => number,
) {
  {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.45;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      let moved = false;
      for (const pt of pts) {
        const si = estaciones.indexOf(pt.estacion);
        if (si < 0) continue;
        const x = timeToX(tBase + pt.timeOffsetMs);
        const y = stationY(si);
        if (!moved) { ctx.moveTo(x, y); moved = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#fbbf24';
      ctx.globalAlpha = 0.6;
      for (const pt of pts) {
        const si = estaciones.indexOf(pt.estacion);
        if (si < 0) continue;
        const x = timeToX(tBase + pt.timeOffsetMs);
        const y = stationY(si);
        if (pt.tipo === 'ARRIBO') {
          ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.beginPath();
          if (dir === 'PAN→OBS') {
            ctx.moveTo(x, y - 4); ctx.lineTo(x + 3, y + 3); ctx.lineTo(x - 3, y + 3);
          } else {
            ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y - 3); ctx.lineTo(x, y + 4);
          }
          ctx.closePath(); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
  }
}
