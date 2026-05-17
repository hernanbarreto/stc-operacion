import { jsPDF } from 'jspdf';

const FONT = 'helvetica';
const PAGE_W = 297;   // landscape A4
const PAGE_H = 210;
const MARGIN = 12;
const CONTENT_W = PAGE_W - MARGIN * 2;
const HEADER_H = 14;

// imagenes corp (cargar si existen)
let metroImg: string | null = null;
let ingeropImg: string | null = null;
async function loadImg(url: string): Promise<string> {
  try {
    const res = await fetch(url); const blob = await res.blob();
    return await new Promise((ok, no) => {
      const fr = new FileReader(); fr.onload = () => ok(fr.result as string); fr.onerror = no;
      fr.readAsDataURL(blob);
    });
  } catch { return ''; }
}

function addHeader(doc: jsPDF, pageNum: number, totalPages: number) {
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PAGE_W, HEADER_H, 'F');
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3); doc.line(0, HEADER_H, PAGE_W, HEADER_H);
  if (metroImg) doc.addImage(metroImg, 'PNG', MARGIN, 1.5, 10, 10);
  if (ingeropImg) doc.addImage(ingeropImg, 'PNG', PAGE_W - MARGIN - 18, 2.5, 18, 8);
  doc.setFont(FONT, 'bold'); doc.setFontSize(8); doc.setTextColor(30, 41, 59);
  doc.text('STC Operación L1 - Reporte de Afectación por RTV', MARGIN + 14, 8);
  doc.setFont(FONT, 'normal'); doc.setFontSize(7); doc.setTextColor(120, 120, 140);
  doc.text(`Pág. ${pageNum}/${totalPages}`, PAGE_W / 2, PAGE_H - 5, { align: 'center' });
}

function addCoverPage(doc: jsPDF, totalPages: number, numRtvs: number, horario: string) {
  doc.setFillColor(30, 27, 75); doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  if (metroImg) doc.addImage(metroImg, 'PNG', MARGIN + 10, 20, 30, 30);
  if (ingeropImg) doc.addImage(ingeropImg, 'PNG', PAGE_W - MARGIN - 50, 25, 40, 20);
  doc.setFont(FONT, 'bold'); doc.setFontSize(26); doc.setTextColor(255, 255, 255);
  doc.text('Análisis de Afectación al Servicio', PAGE_W / 2, 78, { align: 'center' });
  doc.text('por Restricciones Temporales de Velocidad', PAGE_W / 2, 92, { align: 'center' });
  doc.setFontSize(14); doc.setTextColor(200, 200, 230);
  doc.text('STC Operación - Línea 1', PAGE_W / 2, 108, { align: 'center' });
  doc.setFontSize(11); doc.setTextColor(180, 180, 210);
  doc.text(`Estudio de afectación al servicio - aplicación de RTV`, PAGE_W / 2, 124, { align: 'center' });

  const barY = 142;
  doc.setFillColor(50, 47, 95); doc.roundedRect(PAGE_W / 2 - 90, barY, 180, 22, 4, 4, 'F');
  doc.setFont(FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(180, 180, 220);
  doc.text(`RTVs analizadas: ${numRtvs}`, PAGE_W / 2 - 60, barY + 13, { align: 'center' });
  doc.text(`Horario: ${horario}`, PAGE_W / 2, barY + 13, { align: 'center' });
  doc.text(`Material: NM16 + NM22`, PAGE_W / 2 + 60, barY + 13, { align: 'center' });

  doc.setFontSize(8); doc.setTextColor(140, 140, 170);
  doc.text(`Generado: ${new Date().toLocaleString('es-MX')}`, PAGE_W / 2, PAGE_H - 20, { align: 'center' });
  doc.text(`Pág. 1/${totalPages}`, PAGE_W / 2, PAGE_H - 12, { align: 'center' });
}

type RtvData = {
  id: string | number;
  via: string;
  pki_m: number; pkf_m: number;
  v_rtv_kmh: number;
  cdvs: string[];
};

type DeltaPerRtv = {
  rtv: RtvData;
  deltas: { NM16: number; NM22: number };  // segundos por viaje
};

type CurvePt = { pk_km: number; v_kmh: number };
type StationRef = { code: string; pk: number };
type PerRtvChartInput = {
  rtv: RtvData;
  material: 'NM16' | 'NM22';
  baseline: CurvePt[];
  rtvCurve: CurvePt[];
  effLoKm: number; effHiKm: number;
  rtvLoKm: number; rtvHiKm: number;
  despejeLoKm: number; despejeHiKm: number;
  deltaSec: number;
  vMax: number;
  stations: StationRef[];   // estaciones a marcar en el grafico
};

type ReportInput = {
  horario: string;
  rtvs: RtvData[];
  deltasPerRtv: DeltaPerRtv[];
  totalDelta: { NM16_V1: number; NM16_V2: number; NM22_V1: number; NM22_V2: number };
  baselineTimes: { NM16_V1: number; NM16_V2: number; NM22_V1: number; NM22_V2: number };  // s
  chartImages: { key: string; label: string; png: string }[];
  perRtvCharts: PerRtvChartInput[];
  trenes: { id: string; longitud_m: number; masa_kg: number; decel_servicio_ms2: number;
    jerk_traccion_ms3: number; jerk_frenado_ms3: number; t_ac_delay_s: number; t_eb_delay_s: number; t_eb_s: number;
    davis: { A: number; B: number; C: number };
    accel_curve: { v_kmh: number; a_cm_s2: number }[];
  }[];
  dwells: { V1: Record<string, number>; V2: Record<string, number> };
  longitudTrenM: number;
};

// Renderiza un gráfico de RTV individual en un canvas off-screen y devuelve PNG dataURL.
function renderRtvChart(p: PerRtvChartInput): string {
  const W = 1200, H = 380;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  const L = 70, R = 1180, T = 50, B = 320;
  const PW = R - L, PH = B - T;
  // ventana PK: zona efectiva +/- 200 m
  const padKm = 0.25;
  const viewMin = p.effLoKm - padKm; const viewMax = p.effHiKm + padKm;
  const vMax = Math.max(80, Math.ceil(p.vMax / 10) * 10 + 10);
  const pkToX = (pk: number) => L + (pk - viewMin) / (viewMax - viewMin) * PW;
  const vToY = (v: number) => B - v / vMax * PH;

  // BG plot
  ctx.fillStyle = '#fafbff'; ctx.fillRect(L, T, PW, PH);

  // Banda despeje (amarillo) y zona RTV (rojo)
  ctx.fillStyle = 'rgba(251, 191, 36, 0.18)';
  ctx.fillRect(pkToX(p.despejeLoKm), T, pkToX(p.despejeHiKm) - pkToX(p.despejeLoKm), PH);
  ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
  ctx.fillRect(pkToX(p.rtvLoKm), T, pkToX(p.rtvHiKm) - pkToX(p.rtvLoKm), PH);

  // Grid Y
  ctx.strokeStyle = '#d0d0e0'; ctx.lineWidth = 0.5;
  ctx.font = '11px sans-serif'; ctx.fillStyle = '#666';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  for (let v = 0; v <= vMax; v += 10) {
    const y = vToY(v);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke();
    ctx.fillText(String(v), L - 6, y);
  }
  // Grid X
  const span = viewMax - viewMin;
  const step = span < 0.6 ? 0.05 : 0.1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const pkStart = Math.ceil(viewMin / step) * step;
  for (let pk = pkStart; pk <= viewMax; pk += step) {
    const x = pkToX(pk);
    ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, B); ctx.stroke();
    ctx.fillText(pk.toFixed(3), x, B + 4);
  }

  // Baseline (azul)
  const colorBase = p.material === 'NM16' ? '#2563eb' : '#7c3aed';
  ctx.strokeStyle = colorBase; ctx.lineWidth = 2;
  ctx.beginPath(); let started = false;
  for (const pt of p.baseline) {
    if (pt.pk_km < viewMin - 0.01 || pt.pk_km > viewMax + 0.01) continue;
    const x = pkToX(pt.pk_km), y = vToY(pt.v_kmh);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // RTV curva (rojo) donde difiere
  const baseIdx: Record<number, number> = {};
  p.baseline.forEach((pt, i) => { baseIdx[Math.round(pt.pk_km * 100000)] = i; });
  ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2.4;
  ctx.beginPath(); let started2 = false;
  for (const pt of p.rtvCurve) {
    if (pt.pk_km < viewMin - 0.01 || pt.pk_km > viewMax + 0.01) {
      if (started2) { ctx.stroke(); ctx.beginPath(); started2 = false; } continue;
    }
    const j = baseIdx[Math.round(pt.pk_km * 100000)];
    const vBase = j !== undefined ? p.baseline[j].v_kmh : pt.v_kmh;
    if (Math.abs(pt.v_kmh - vBase) <= 0.3) {
      if (started2) { ctx.stroke(); ctx.beginPath(); started2 = false; } continue;
    }
    const x = pkToX(pt.pk_km), y = vToY(pt.v_kmh);
    if (!started2) { ctx.moveTo(x, y); started2 = true; } else ctx.lineTo(x, y);
  }
  if (started2) ctx.stroke();

  // Línea horizontal v_RTV
  ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(pkToX(p.effLoKm), vToY(p.rtv.v_rtv_kmh));
  ctx.lineTo(pkToX(p.effHiKm), vToY(p.rtv.v_rtv_kmh));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#dc2626'; ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(`RTV ${p.rtv.id} - ${p.rtv.v_rtv_kmh} km/h`,
    (pkToX(p.effLoKm) + pkToX(p.effHiKm)) / 2, vToY(p.rtv.v_rtv_kmh) - 4);

  // Marcadores de estaciones (verticales verdes con etiqueta)
  if (p.stations && p.stations.length) {
    for (const st of p.stations) {
      if (st.pk < viewMin || st.pk > viewMax) continue;
      const x = pkToX(st.pk);
      ctx.strokeStyle = 'rgba(34,197,94,0.85)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, B); ctx.stroke();
      // etiqueta arriba (caja blanca + texto verde)
      ctx.fillStyle = '#16a34a'; ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const tw = ctx.measureText(st.code).width + 4;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(x - tw/2, T + 2, tw, 13);
      ctx.fillStyle = '#16a34a';
      ctx.fillText(st.code, x, T + 4);
    }
  }

  // Frame
  ctx.strokeStyle = '#999'; ctx.lineWidth = 1;
  ctx.strokeRect(L, T, PW, PH);

  // Título
  ctx.fillStyle = '#1e1b4b'; ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(`${p.material} ${p.rtv.via}  -  RTV ${p.rtv.id}  -  PK ${p.rtv.pki_m.toFixed(1)} a ${p.rtv.pkf_m.toFixed(1)} m  -  ${p.rtv.v_rtv_kmh} km/h`, L, 12);
  ctx.font = '10px sans-serif'; ctx.fillStyle = '#555';
  ctx.fillText(`CDVs afectados: ${p.rtv.cdvs.join(', ')}`, L, 28);
  // Afectación destacada
  const deltaTxt = p.deltaSec >= 0.5 ? `Afectación: +${p.deltaSec.toFixed(1)} s por viaje` : (p.deltaSec > 0 ? `Afectación: +${p.deltaSec.toFixed(2)} s` : 'Sin afectación (marcha tipo ya por debajo de v_RTV)');
  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = p.deltaSec > 0.5 ? '#dc2626' : '#16a34a';
  ctx.textAlign = 'right';
  ctx.fillText(deltaTxt, R, 16);

  // Labels eje
  ctx.fillStyle = '#333'; ctx.font = '10px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('PK [km]', (L + R) / 2, H - 4);
  ctx.save();
  ctx.translate(14, (T + B) / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('V [km/h]', 0, 0);
  ctx.restore();

  return canvas.toDataURL('image/png');
}

function fmtSeg(s: number): string {
  if (Math.abs(s) < 1) return `${s.toFixed(1)} s`;
  const sign = s < 0 ? '-' : '';
  const a = Math.abs(s); const m = Math.floor(a / 60); const sec = Math.round(a - m * 60);
  return `${sign}${m}m ${sec.toString().padStart(2,'0')}s`;
}

function addSectionTitle(doc: jsPDF, title: string, y: number): number {
  doc.setFont(FONT, 'bold'); doc.setFontSize(12); doc.setTextColor(30, 41, 75);
  doc.text(title, MARGIN, y);
  doc.setDrawColor(99, 102, 241); doc.setLineWidth(0.5);
  doc.line(MARGIN, y + 1.5, MARGIN + 60, y + 1.5);
  return y + 7;
}

function addParagraph(doc: jsPDF, txt: string, y: number, opts?: { size?: number; color?: [number, number, number] }): number {
  const size = opts?.size ?? 9;
  const color = opts?.color ?? [50, 50, 65];
  doc.setFont(FONT, 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
  const lines = doc.splitTextToSize(txt, CONTENT_W);
  doc.text(lines, MARGIN, y);
  return y + lines.length * (size * 0.45);
}

function addBullet(doc: jsPDF, txt: string, y: number): number {
  doc.setFont(FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(50, 50, 65);
  const lines = doc.splitTextToSize(txt, CONTENT_W - 6);
  doc.text('-', MARGIN, y);
  doc.text(lines, MARGIN + 4, y);
  return y + lines.length * 4 + 0.5;
}

function newPage(doc: jsPDF, pageNum: number, totalPages: number): number {
  doc.addPage(); addHeader(doc, pageNum, totalPages);
  return HEADER_H + 6;
}

function addTable(
  doc: jsPDF, header: string[], rows: (string|number)[][], y: number,
  colWidths?: number[], opts?: { headerBg?: [number,number,number]; align?: string[]; rowColor?: (i:number)=>[number,number,number]|null }
): number {
  const widths = colWidths || header.map(() => CONTENT_W / header.length);
  const rowH = 5.5;
  const headBg = opts?.headerBg || [99, 102, 241];
  const align = opts?.align || header.map(() => 'left');

  // header
  doc.setFillColor(...headBg); doc.rect(MARGIN, y, widths.reduce((a,b)=>a+b,0), rowH, 'F');
  doc.setFont(FONT, 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
  let x = MARGIN;
  header.forEach((h, i) => {
    const tx = align[i] === 'right' ? x + widths[i] - 1.5 : align[i] === 'center' ? x + widths[i]/2 : x + 1.5;
    doc.text(String(h), tx, y + 3.8, { align: align[i] as any });
    x += widths[i];
  });
  y += rowH;
  doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(30, 30, 40);
  rows.forEach((row, ri) => {
    const bg = opts?.rowColor?.(ri);
    if (bg) { doc.setFillColor(...bg); doc.rect(MARGIN, y, widths.reduce((a,b)=>a+b,0), rowH, 'F'); }
    else if (ri % 2 === 0) { doc.setFillColor(245, 245, 250); doc.rect(MARGIN, y, widths.reduce((a,b)=>a+b,0), rowH, 'F'); }
    x = MARGIN;
    row.forEach((c, i) => {
      const tx = align[i] === 'right' ? x + widths[i] - 1.5 : align[i] === 'center' ? x + widths[i]/2 : x + 1.5;
      doc.text(String(c), tx, y + 3.8, { align: align[i] as any });
      x += widths[i];
    });
    y += rowH;
  });
  return y + 2;
}

export async function exportRtvReport(d: ReportInput): Promise<void> {
  if (!metroImg) metroImg = await loadImg('/metro.png');
  if (!ingeropImg) ingeropImg = await loadImg('/ingerop.png');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  // portada + metodologia(2) + trenes(1) + (perRtv charts: 2 por pagina) + conclusion(1)
  const numPerRtv = d.perRtvCharts.length;
  const totalPages = 1 + 2 + 1 + Math.max(1, Math.ceil(numPerRtv / 2)) + 1;
  let pg = 1;

  // PORTADA
  addCoverPage(doc, totalPages, d.rtvs.length, d.horario);

  // PAGE 2: METODOLOGÍA - FUENTE Y CONTEXTO
  pg = 2;
  let y = newPage(doc, pg, totalPages);
  y = addSectionTitle(doc, '1. Fuente y contexto', y);
  y = addParagraph(doc, 'Este reporte analiza la afectación al servicio de la Línea 1 del Sistema de Transporte Colectivo (STC) de la Ciudad de México causada por las Restricciones Temporales de Velocidad (RTV) seleccionadas y configuradas por el usuario.', y);
  y += 4;
  // Cuadro de cita destacado
  doc.setFillColor(240, 240, 250);
  doc.setDrawColor(99, 102, 241);
  doc.setLineWidth(0.6);
  doc.roundedRect(MARGIN, y, CONTENT_W, 26, 2, 2, 'FD');
  doc.setFont(FONT, 'bold'); doc.setFontSize(9); doc.setTextColor(60, 60, 130);
  doc.text('FUENTE PRIMARIA', MARGIN + 4, y + 5);
  doc.setFont(FONT, 'normal'); doc.setFontSize(10); doc.setTextColor(30, 30, 50);
  doc.text('Siemens Mobility - "Simulación de Headway", Línea 1 STC CDMX (2022).', MARGIN + 4, y + 11);
  doc.setFont(FONT, 'bold'); doc.setFontSize(10);
  doc.text('Ref: 2022-MRRC-CB.ATC-L1MO-000-III-00702096-I Rev D', MARGIN + 4, y + 17);
  doc.setFont(FONT, 'italic'); doc.setFontSize(8); doc.setTextColor(80, 80, 100);
  doc.text('Contiene las curvas de marcha tipo (v vs PK) por interestación y material (NM16, NM22) en ambas vías, y las tablas de tiempos (Tabla 8 dwell; Tablas 9-12, 14-17, 19-22, 24-27 tiempos de marcha).', MARGIN + 4, y + 23, { maxWidth: CONTENT_W - 8 });
  y += 30;
  y += 4;
  y = addSectionTitle(doc, '2. Metodología', y);
  y = addBullet(doc, 'Digitalización pixel-a-pixel de cada una de las 76 curvas v(PK) del PDF Siemens (19 interestaciones x 2 vías x 2 materiales). Cada PNG se procesa con: detección automática del marco del plot, calibración Y por grids cada 10 km/h, detección de la curva por filtro de color (excluyendo polígono y elevación), tracking del trazo con restricción de salto físico y filtro de mediana para eliminar spikes.', y);
  y = addBullet(doc, 'Suavizado: Savitzky-Golay (ventana 21, polinomio 3) sobre interpolación PCHIP a paso 1 m.', y);
  y = addBullet(doc, 'Calibración X: anclaje de los endpoints de cada curva (v=0) a los PK oficiales de las estaciones del STC, garantizando continuidad PK exacta entre segmentos adyacentes.', y);
  y = addBullet(doc, 'Concatenación: las 19 curvas individuales por (material, vía) se unen formando 4 trayectorias continuas PAN<->OBS (NM16 V1, NM16 V2, NM22 V1, NM22 V2).', y);
  y = addBullet(doc, 'Verificación contra Siemens: el tiempo de marcha de cada vuelta calculado por integración de dx/v se compara con la suma de dt de las Tablas 9-27. Diferencia residual menor a 2% (validada en las 4 combinaciones material x vía).', y);
  y = addBullet(doc, 'Tiempos de parada en andén: Tabla 8 del documento Siemens, valores discriminados por horario (Valle, Pico Mañana, Pico Tarde) y por vía.', y);

  // PAGE 3: METODOLOGÍA RTV
  pg++;
  y = newPage(doc, pg, totalPages);
  y = addSectionTitle(doc, '3. Aplicación de RTV', y);
  y = addBullet(doc, `Largo del tren considerado: ${d.longitudTrenM} m (idéntico para NM16 y NM22).`, y);
  y = addBullet(doc, 'Zona efectiva de cada RTV: el tren debe respetar la velocidad límite v_RTV desde que su CABEZA entra en la zona hasta que su COLA sale. Esto define la "zona de despeje por cola" adicional al rango [pki, pkf] del cartel de restricción:', y);
  y = addBullet(doc, '   - V1 (PK creciente): zona efectiva = [pki, pkf + L_tren]', y);
  y = addBullet(doc, '   - V2 (PK decreciente): zona efectiva = [pki - L_tren, pkf]', y);
  y = addBullet(doc, 'Modificación de la curva de marcha: dentro de la zona efectiva, v(PK) se recorta a min(v_baseline, v_RTV). El frenado previo se simula con la deceleración de servicio del tren (~1.4 m/s^2). La aceleración posterior usa la curva accel(v) específica del material.', y);
  y = addBullet(doc, 'Superposición de RTVs: cuando el despeje por cola de una RTV se superpone con el rango de la siguiente, la velocidad efectiva en la intersección es el mínimo de ambas v_RTV.', y);
  y += 3;
  y = addSectionTitle(doc, '4. Color y simbología de los gráficos', y);
  y = addBullet(doc, 'Curva de color (azul/cyan/morado/rosa según material y vía): marcha tipo Siemens original sin restricción.', y);
  y = addBullet(doc, 'Curva ROJA: marcha tipo modificada con la RTV aplicada. Sólo se dibuja donde difiere del baseline (incluye frenado previo y aceleración posterior).', y);
  y = addBullet(doc, 'Banda ROJA semi-transparente: rango [pki, pkf] del cartel RTV.', y);
  y = addBullet(doc, 'Banda AMARILLA semi-transparente: zona de despeje por cola del tren.', y);
  y = addBullet(doc, 'Línea ROJA punteada horizontal: velocidad límite v_RTV, etiquetada con el ID y el valor.', y);
  y = addBullet(doc, 'Líneas VERDES verticales: posición de las estaciones.', y);

  // PAGE 4: DATOS DE TRENES
  pg++;
  y = newPage(doc, pg, totalPages);
  y = addSectionTitle(doc, '5. Material rodante - parámetros físicos', y);
  for (const t of d.trenes) {
    doc.setFont(FONT, 'bold'); doc.setFontSize(10); doc.setTextColor(30, 41, 75);
    doc.text(t.id, MARGIN, y); y += 5;
    doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(50,50,65);
    const txt = [
      `Longitud: ${t.longitud_m} m   Masa: ${(t.masa_kg/1000).toFixed(1)} t`,
      `Decel servicio: ${t.decel_servicio_ms2} m/s^2   Jerk tracción: ${t.jerk_traccion_ms3} m/s^3   Jerk frenado: ${t.jerk_frenado_ms3} m/s^3`,
      `t_ac_delay: ${t.t_ac_delay_s}s   t_eb_delay: ${t.t_eb_delay_s}s   t_EB: ${t.t_eb_s}s`,
      `Davis: A=${t.davis.A} N   B=${t.davis.B}   C=${t.davis.C}   (F_res [N] = A + B.v + C.v^2  con v en m/s)`,
    ];
    txt.forEach(l => { doc.text(l, MARGIN + 4, y); y += 4; });
    // Tabla de aceleracion compacta
    y += 1;
    doc.setFontSize(7.5); doc.setTextColor(99, 102, 141);
    doc.text('Curva de aceleración a(v) [cm/s^2]:', MARGIN + 4, y); y += 4;
    const head = t.accel_curve.map(p => `${p.v_kmh}`);
    const vals = t.accel_curve.map(p => `${p.a_cm_s2}`);
    const w = (CONTENT_W - 10) / head.length;
    let x = MARGIN + 4;
    doc.setFillColor(99,102,141); doc.rect(x, y, w*head.length, 4.5, 'F');
    doc.setTextColor(255,255,255); doc.setFontSize(7);
    head.forEach((h, i) => { doc.text(h, x + i*w + w/2, y+3.2, { align: 'center' }); });
    y += 4.5;
    doc.setFillColor(245,245,250); doc.rect(x, y, w*head.length, 4.5, 'F');
    doc.setTextColor(30,30,40);
    vals.forEach((v, i) => { doc.text(v, x + i*w + w/2, y+3.2, { align: 'center' }); });
    y += 8;
  }

  // PAGES siguientes: 1 gráfico por RTV x material (renderizados off-screen, 2 por página)
  const perCharts = [...d.perRtvCharts].sort((a, b) => {
    if (a.material !== b.material) return a.material.localeCompare(b.material);
    if (a.rtv.via !== b.rtv.via) return a.rtv.via.localeCompare(b.rtv.via);
    return Number(a.rtv.id) - Number(b.rtv.id);
  });
  for (let i = 0; i < perCharts.length; i += 2) {
    pg++;
    y = newPage(doc, pg, totalPages);
    if (i === 0) y = addSectionTitle(doc, '6. Curvas de marcha por cada RTV aplicada', y);
    else y = addSectionTitle(doc, '6. Curvas de marcha por cada RTV aplicada', y);
    for (let j = 0; j < 2 && i + j < perCharts.length; j++) {
      const c = perCharts[i + j];
      const png = renderRtvChart(c);
      const imgRatio = 380 / 1200;
      try {
        doc.addImage(png, 'PNG', MARGIN, y, CONTENT_W, CONTENT_W * imgRatio);
        y += CONTENT_W * imgRatio + 3;
      } catch (e) { console.error(e); }
    }
  }

  // PAGE FINAL: CONCLUSION + TABLA
  pg = totalPages;
  y = newPage(doc, pg, totalPages);
  y = addSectionTitle(doc, '7. Conclusión - afectación por RTV', y);
  y = addParagraph(doc, `Tabla resumen del impacto de cada RTV sobre el tiempo de viaje por vuelta para cada material. La afectación total es la suma de los efectos individuales considerando que cada vuelta incluye un viaje V1 (PAN->OBS) y uno V2 (OBS->PAN).`, y);
  y += 3;

  const rows = d.deltasPerRtv.map(d2 => ([
    `RTV ${d2.rtv.id}`,
    d2.rtv.via,
    `${(d2.rtv.pki_m).toFixed(1)} - ${(d2.rtv.pkf_m).toFixed(1)}`,
    `${d2.rtv.v_rtv_kmh}`,
    d2.rtv.cdvs.join(', '),
    fmtSeg(d2.deltas.NM16),
    fmtSeg(d2.deltas.NM22),
  ]));

  const totalNM16 = d.totalDelta.NM16_V1 + d.totalDelta.NM16_V2;
  const totalNM22 = d.totalDelta.NM22_V1 + d.totalDelta.NM22_V2;

  y = addTable(
    doc,
    ['RTV', 'Vía', 'PK [m]', 'v_RTV [km/h]', 'CDVs afectados', 'dt NM16', 'dt NM22'],
    rows, y,
    [16, 14, 36, 22, 90, 32, 32],
    { align: ['center','center','center','center','left','right','right'] }
  );
  y += 2;

  // Fila de totales destacada
  doc.setFillColor(220, 38, 38); doc.rect(MARGIN, y, [16,14,36,22,90,32,32].reduce((a,b)=>a+b,0), 6, 'F');
  doc.setFont(FONT, 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
  doc.text('TOTAL POR VUELTA', MARGIN + 2, y + 4);
  doc.text(`V1 + V2 = ${fmtSeg(totalNM16)}`, MARGIN + 16+14+36+22+90 + 32/2, y + 4, { align: 'center' });
  doc.text(`V1 + V2 = ${fmtSeg(totalNM22)}`, MARGIN + 16+14+36+22+90+32 + 32/2, y + 4, { align: 'center' });
  y += 8;

  // Resumen por vía
  doc.setFont(FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(50, 50, 65);
  doc.text(`Baseline por viaje: NM16 V1 = ${fmtSeg(d.baselineTimes.NM16_V1)}, V2 = ${fmtSeg(d.baselineTimes.NM16_V2)}.   NM22 V1 = ${fmtSeg(d.baselineTimes.NM22_V1)}, V2 = ${fmtSeg(d.baselineTimes.NM22_V2)}`, MARGIN, y); y += 5;
  doc.text(`dt V1 con RTV: NM16 = ${fmtSeg(d.totalDelta.NM16_V1)}   NM22 = ${fmtSeg(d.totalDelta.NM22_V1)}`, MARGIN, y); y += 4;
  doc.text(`dt V2 con RTV: NM16 = ${fmtSeg(d.totalDelta.NM16_V2)}   NM22 = ${fmtSeg(d.totalDelta.NM22_V2)}`, MARGIN, y); y += 6;

  doc.setFont(FONT, 'italic'); doc.setFontSize(8); doc.setTextColor(100, 100, 120);
  doc.text('Nota: la afectación calculada parte de la marcha tipo Siemens digitalizada. Cuando la velocidad de la marcha tipo en la zona ya es inferior a v_RTV, no hay afectación adicional (la RTV no restringe).', MARGIN, y, { maxWidth: CONTENT_W });

  // descargar
  const fname = `Reporte_RTV_${new Date().toISOString().slice(0,16).replace(/[T:]/g,'-')}.pdf`;
  doc.save(fname);
}
