import { read, utils } from 'xlsx';
import type { ATSEvent, AlarmEvent, ExcelUploadData } from '../types';

type ExcelCell = string | number | boolean | Date | null | undefined;
type ExcelRow = ExcelCell[];

const isDev = import.meta.env.DEV;
const devLog = (...args: unknown[]) => { if (isDev) console.log(...args); };
const devWarn = (...args: unknown[]) => { if (isDev) console.warn(...args); };

const STATION_MAP: { [key: string]: string } = {
  '101': 'PAN', '102': 'ZAR', '106': 'GOM', '107': 'BOU',
  '108': 'BAL', '109': 'MOC', '110': 'SLA', '111': 'CAN',
  '112': 'MER', '113': 'PIN', '114': 'ISA', '115': 'SAL',
  '116': 'BAD', '117': 'CUA', '118': 'INS', '119': 'SEV',
  '120': 'CHP', '121': 'JNA', '122': 'TCY', '123': 'OBS',
  '24': 'AVC16PAN', '25': 'AVC26PAN', '26': 'AVC46PAN', '27': 'AVC14PAN',
  '28': 'AVC24PAN', '29': 'AVC44PAN', '30': 'AVC64PAN', '31': 'AVC62PAN',
  '32': 'AVC24ZAR', '33': 'AVC14ZAR', '34': 'AVC14BAL', '35': 'AVC20PIN',
  '36': 'AVCZSAL', '37': 'AVC20ABAD', '38': 'AVC20CHP', '39': 'AVC54OBS',
  '40': 'AVC34OBS', '41': 'AVC14OBS', '42': 'AVC24OBS', '43': 'AVC44OBS',
  '44': 'AVC64OBS', '45': 'AVC84OBS', '46': 'AVC104OBS'
};

const TRAIN_MAP: { [key: string]: string } = {};

// Mapeo de trenes NM16 y NM22
const nm16Trains: { [key: string]: number[] } = {
  '01 (nm16)': [32776, 32777], '02 (nm16)': [32774, 32775], '03 (nm16)': [32778, 32779],
  '04 (nm16)': [32784, 32785], '05 (nm16)': [32772, 32773], '06 (nm16)': [32786, 32787],
  '07 (nm16)': [32782, 32783], '08 (nm16)': [32770, 32771], '09 (nm16)': [32780, 32781],
  '10 (nm16)': [32768, 32769]
};

const nm22Trains: { [key: string]: number[] } = {
  '01 (nm22)': [32788, 32789], '02 (nm22)': [32790, 32791], '03 (nm22)': [32792, 32793],
  '04 (nm22)': [32794, 32795], '05 (nm22)': [32796, 32797], '06 (nm22)': [32798, 32799],
  '07 (nm22)': [32800, 32801], '08 (nm22)': [32802, 32803], '09 (nm22)': [32804, 32805],
  '10 (nm22)': [32806, 32807], '11 (nm22)': [32808, 32809], '12 (nm22)': [32810, 32811],
  '13 (nm22)': [32812, 32813], '14 (nm22)': [32814, 32815], '15 (nm22)': [32816, 32817],
  '16 (nm22)': [32818, 32819], '17 (nm22)': [32820, 32821], '18 (nm22)': [32822, 32823],
  '19 (nm22)': [32824, 32825], '20 (nm22)': [32826, 32827], '21 (nm22)': [32828, 32829],
  '22 (nm22)': [32830, 32831], '23 (nm22)': [32832, 32833], '24 (nm22)': [32834, 32835],
  '25 (nm22)': [32836, 32837], '26 (nm22)': [32838, 32839], '27 (nm22)': [32840, 32841],
  '28 (nm22)': [32842, 32843], '29 (nm22)': [32844, 32845]
};

// Construir mapeo de tren
Object.entries(nm16Trains).forEach(([key, ids]) => {
  ids.forEach(id => TRAIN_MAP[id.toString()] = key);
});
Object.entries(nm22Trains).forEach(([key, ids]) => {
  ids.forEach(id => TRAIN_MAP[id.toString()] = key);
});

// Known station abbreviations for alarm matching
const KNOWN_STATIONS = ['PAN', 'ZAR', 'GOM', 'BOU', 'BAL', 'MOC', 'SLA', 'CAN',
  'MER', 'PIN', 'ISA', 'SAL', 'BAD', 'CUA', 'INS', 'SEV', 'CHP', 'JNA', 'TCY', 'OBS',
  'AVC16PAN', 'AVC26PAN', 'AVC46PAN', 'AVC14PAN', 'AVC24PAN', 'AVC44PAN', 'AVC64PAN', 'AVC62PAN',
  'AVC24ZAR', 'AVC14ZAR', 'AVC14BAL', 'AVC20PIN', 'AVCZSAL', 'AVC20ABAD', 'AVC20CHP',
  'AVC54OBS', 'AVC34OBS', 'AVC14OBS', 'AVC24OBS', 'AVC44OBS', 'AVC64OBS', 'AVC84OBS', 'AVC104OBS'];

export const useExcelProcessor = () => {
  const procesarExcelBuffer = (buffer: ArrayBuffer, fileName: string): Promise<ExcelUploadData> => {
    return new Promise((resolve, reject) => {
      // Yield to the browser so the loading UI can paint before the heavy parse blocks the main thread.
      setTimeout(() => {
        try {
          devLog(`📂 Parseando ${fileName} (${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);
          const data = new Uint8Array(buffer);
          const workbook = read(data, { type: 'array' });

          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const rows = utils.sheet_to_json<ExcelRow>(worksheet, { header: 1 });

          const eventos_por_dia: { [fecha: string]: ATSEvent[] } = {};
          const alarmas_por_dia: { [fecha: string]: AlarmEvent[] } = {};
          const dias_set = new Set<string>();

          devLog('📊 Procesando Excel - Total filas:', rows.length);
          devLog('📊 Primera fila:', rows[0]);
          devLog('📊 Segunda fila:', rows[1]);

          // Procesar todas las filas sin saltar
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length < 3) continue;

            const label = String(row[0] || '').trim();
            const fechaHora = row[1];
            const descripcion = String(row[2] || '').trim();

            // Filtrar solo eventos relevantes
            const isTrainEvent = ['TGMT_ARRIVAL_AT_PLATFORM', 'TGMT_DEPARTURE_AT_PLATFORM', 'TGMT_SKIP_PLATFORM'].includes(label);
            const isDboEvent = label === 'COMMAND_ACK' && /(?:Activar|Desactivar)DBOCBTC/i.test(descripcion);
            const isAlarmEvent = label.startsWith('ALARM_');

            if (!isTrainEvent && !isDboEvent && !isAlarmEvent) {
              continue;
            }

            // Parsear fecha/hora
            let datetime: Date;
            try {
              if (typeof fechaHora === 'number') {
                const ms = (fechaHora - 25569) * 86400 * 1000;
                const tzOffsetMs = new Date(ms).getTimezoneOffset() * 60000;
                datetime = new Date(ms + tzOffsetMs);
              } else if (typeof fechaHora === 'string') {
                datetime = new Date(fechaHora);
              } else if (fechaHora instanceof Date) {
                datetime = fechaHora;
              } else {
                continue;
              }

              if (isNaN(datetime.getTime())) {
                continue;
              }
            } catch {
              continue;
            }

            // Use local date for the key
            const yy = datetime.getFullYear();
            const mm = String(datetime.getMonth() + 1).padStart(2, '0');
            const dd = String(datetime.getDate()).padStart(2, '0');
            const fecha = `${yy}-${mm}-${dd}`;
            dias_set.add(fecha);

            if (!eventos_por_dia[fecha]) {
              eventos_por_dia[fecha] = [];
            }
            if (!alarmas_por_dia[fecha]) {
              alarmas_por_dia[fecha] = [];
            }

            if (isAlarmEvent) {
              // Extract estado
              let estado = '';
              if (/\bAbierta\b/i.test(descripcion)) estado = 'Abierta';
              else if (/\bReconocida\b/i.test(descripcion)) estado = 'Reconocida';
              else if (/\bNormalizada\b/i.test(descripcion)) estado = 'Normalizada';
              else if (/\bCerrada\b/i.test(descripcion)) estado = 'Cerrada';

              // Extract station: split into tokens, check if last chars match a known station
              // e.g. "BALC14BAL" -> endsWith("BAL") -> BAL
              let estacion = '';
              const tokens = descripcion.split(/\s+/);
              for (const tok of tokens) {
                const up = tok.toUpperCase();
                for (const st of KNOWN_STATIONS) {
                  if (up.endsWith(st) && up.length >= st.length) {
                    estacion = st;
                    break;
                  }
                }
                if (estacion) break;
              }

              alarmas_por_dia[fecha].push({
                datetime,
                eventType: label,
                descripcion,
                estado,
                estacion,
              });
              continue;
            }

            if (isDboEvent) {
              // Must check Desactivar first — "ActivarDBOCBTC" is a substring of "DesactivarDBOCBTC"
              const isActivar = !((/DesactivarDBOCBTC/i).test(descripcion));
              const dboMatch = descripcion.match(/(?:Activar|Desactivar)DBOCBTC\s+(\w+)/i);
              if (!dboMatch) continue;
              const stCode = dboMatch[1].toUpperCase();
              const estacion = Object.values(STATION_MAP).includes(stCode)
                ? stCode
                : stCode;

              eventos_por_dia[fecha].push({
                datetime,
                evento: isActivar ? 'DBO_ACTIVAR' : 'DBO_DESACTIVAR',
                tren: '',
                estacion,
                via: '',
                periodo: 'DESC'
              });
              continue;
            }

            // Extraer información de descripción (train events)
            const eventoMatch = label === 'TGMT_ARRIVAL_AT_PLATFORM' ? 'ARRIBO'
              : label === 'TGMT_DEPARTURE_AT_PLATFORM' ? 'PARTIO'
                : 'SALTO';

            const trenMatch = descripcion.match(/(?:tren|TREN)\s+(\d+)/i);
            const viaMatch = descripcion.match(/(?:vía|VÍA|via|VIA)\s+(\d+)/i);
            const estacionMatch = descripcion.match(/(?:estación|ESTACIÓN|estacion|ESTACION)\s+(\d+)/i);

            if (!trenMatch || !estacionMatch) {
              devWarn('❌ No se extrajo tren o estación de:', descripcion);
              continue;
            }

            const tren = TRAIN_MAP[trenMatch[1]] || `T${trenMatch[1]}`;
            const via = viaMatch ? viaMatch[1] : '';
            const estacion = STATION_MAP[estacionMatch[1]] || estacionMatch[1];

            eventos_por_dia[fecha].push({
              datetime,
              evento: eventoMatch as 'ARRIBO' | 'PARTIO' | 'SALTO',
              tren,
              estacion,
              via,
              periodo: 'DESC'
            });
          }

          // ── Deduplication: ATS logs each event twice with ms-level gaps ──
          let totalRemoved = 0;
          Object.keys(eventos_por_dia).forEach(fecha => {
            const evs = eventos_por_dia[fecha];
            evs.sort((a, b) => {
              if (a.tren !== b.tren) return a.tren.localeCompare(b.tren);
              return a.datetime.getTime() - b.datetime.getTime();
            });
            const deduped: ATSEvent[] = [];
            for (let i = 0; i < evs.length; i++) {
              if (i > 0
                && evs[i].tren === evs[i - 1].tren
                && evs[i].estacion === evs[i - 1].estacion
                && evs[i].evento === evs[i - 1].evento
                && evs[i].via === evs[i - 1].via
                && (evs[i].datetime.getTime() - evs[i - 1].datetime.getTime()) < 5000
              ) continue; // skip ATS duplicate
              deduped.push(evs[i]);
            }
            totalRemoved += evs.length - deduped.length;
            eventos_por_dia[fecha] = deduped;
          });
          if (totalRemoved > 0) {
            devLog(`🧹 Deduplicación: eliminados ${totalRemoved} eventos duplicados del ATS`);
          }

          const dias = Array.from(dias_set).sort();

          devLog('✅ Procesamiento completado');
          devLog('   Días encontrados:', dias);
          devLog('   Eventos totales:', Object.values(eventos_por_dia).reduce((sum, arr) => sum + arr.length, 0));
          devLog('   Alarmas totales:', Object.values(alarmas_por_dia).reduce((sum, arr) => sum + arr.length, 0));
          devLog('   Alarmas con estación:', Object.values(alarmas_por_dia).reduce((sum, arr) => sum + arr.filter(a => a.estacion).length, 0));

          if (dias.length === 0) {
            reject(new Error('No se encontraron eventos válidos en el archivo'));
            return;
          }

          resolve({
            días: dias,
            eventos_por_dia,
            alarmas_por_dia,
          });
        } catch (error) {
          console.error('❌ Error al procesar Excel:', error);
          reject(error);
        }
      }, 0);
    });
  };

  const procesarExcel = (file: File): Promise<ExcelUploadData> =>
    file.arrayBuffer().then(buf => procesarExcelBuffer(buf, file.name));

  return { procesarExcel, procesarExcelBuffer };
};
