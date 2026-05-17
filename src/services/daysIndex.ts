import { ref, uploadString, getBlob, getMetadata } from 'firebase/storage';
import { read, utils } from 'xlsx';
import { storage } from '../firebase';
import { listExcelFiles, downloadExcelFile, type StorageFile } from './storageService';

export interface DayIndexEntry {
  fecha: string;          // 'YYYY-MM-DD'
  hourStart: string;      // 'HH:MM:SS'
  hourEnd: string;        // 'HH:MM:SS'
  evCount: number;
  alarmCount: number;
  source: string;         // Storage file name
}

interface FileMeta { size: number; updated: string }

interface ServerIndex {
  version: 1;
  files: Record<string, FileMeta>;
  entries: DayIndexEntry[];
}

const INDEX_PATH = '_index.json';
const isDev = import.meta.env.DEV;
const log = (...args: unknown[]) => { if (isDev) console.log('[daysIndex]', ...args); };

function emptyIndex(): ServerIndex {
  return { version: 1, files: {}, entries: [] };
}

async function loadServerIndex(): Promise<ServerIndex> {
  const r = ref(storage, INDEX_PATH);
  try {
    await getMetadata(r);
  } catch {
    log('No existe _index.json todavía');
    return emptyIndex();
  }
  try {
    const blob = await getBlob(r);
    const text = await blob.text();
    const parsed = JSON.parse(text) as ServerIndex;
    if (parsed.version !== 1) return emptyIndex();
    if (!parsed.files) parsed.files = {};
    if (!parsed.entries) parsed.entries = [];
    return parsed;
  } catch (err) {
    log('Error leyendo _index.json:', err);
    return emptyIndex();
  }
}

async function saveServerIndex(idx: ServerIndex): Promise<void> {
  const r = ref(storage, INDEX_PATH);
  await uploadString(r, JSON.stringify(idx), 'raw', { contentType: 'application/json' });
  log(`_index.json guardado (${idx.entries.length} días, ${Object.keys(idx.files).length} archivos)`);
}

function pad2(n: number) { return String(n).padStart(2, '0'); }
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function hms(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Lightweight parse: scan only what's needed to extract per-day metadata. */
export function extractDaysFromBuffer(buffer: ArrayBuffer, sourceName: string): DayIndexEntry[] {
  const workbook = read(new Uint8Array(buffer), { type: 'array' });
  const ws = workbook.Sheets[workbook.SheetNames[0]];
  const rows = utils.sheet_to_json<unknown[]>(ws, { header: 1 });

  interface Agg { first: Date; last: Date; ev: number; alarms: number; dbo: number }
  const byDay = new Map<string, Agg>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;
    const label = String(row[0] || '').trim();
    const fechaHora = row[1];
    const descripcion = String(row[2] || '');

    const isTrainEvent = label === 'TGMT_ARRIVAL_AT_PLATFORM'
      || label === 'TGMT_DEPARTURE_AT_PLATFORM'
      || label === 'TGMT_SKIP_PLATFORM';
    const isDbo = label === 'COMMAND_ACK' && /(?:Activar|Desactivar)DBOCBTC/i.test(descripcion);
    const isAlarm = label.startsWith('ALARM_');
    if (!isTrainEvent && !isDbo && !isAlarm) continue;

    let dt: Date;
    if (typeof fechaHora === 'number') {
      const ms = (fechaHora - 25569) * 86400 * 1000;
      const tz = new Date(ms).getTimezoneOffset() * 60000;
      dt = new Date(ms + tz);
    } else if (typeof fechaHora === 'string') {
      dt = new Date(fechaHora);
    } else if (fechaHora instanceof Date) {
      dt = fechaHora;
    } else {
      continue;
    }
    if (isNaN(dt.getTime())) continue;

    const fecha = ymd(dt);
    let agg = byDay.get(fecha);
    if (!agg) {
      agg = { first: dt, last: dt, ev: 0, alarms: 0, dbo: 0 };
      byDay.set(fecha, agg);
    } else {
      if (dt < agg.first) agg.first = dt;
      if (dt > agg.last) agg.last = dt;
    }
    if (isTrainEvent) agg.ev++;
    else if (isDbo) agg.dbo++;
    else agg.alarms++;
  }

  const entries: DayIndexEntry[] = [];
  byDay.forEach((agg, fecha) => {
    if (agg.ev + agg.dbo + agg.alarms === 0) return;
    entries.push({
      fecha,
      hourStart: hms(agg.first),
      hourEnd: hms(agg.last),
      evCount: agg.ev,
      alarmCount: agg.alarms,
      source: sourceName,
    });
  });
  return entries.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Fast: app entry. Just downloads the small JSON index, no Excel parsing. */
export async function fetchIndex(): Promise<DayIndexEntry[]> {
  const idx = await loadServerIndex();
  return idx.entries.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Add (or replace) a file's entries in the server index. Called after an upload. */
export async function addFileToIndex(
  sf: { name: string; size: number; updated: string },
  entries: DayIndexEntry[],
): Promise<DayIndexEntry[]> {
  const idx = await loadServerIndex();
  idx.entries = idx.entries.filter(e => e.source !== sf.name);
  idx.entries.push(...entries);
  idx.files[sf.name] = { size: sf.size, updated: sf.updated };
  idx.entries.sort((a, b) => a.fecha.localeCompare(b.fecha));
  await saveServerIndex(idx);
  return idx.entries;
}

/** Remove a file from the server index. Called after a delete. */
export async function removeFileFromIndex(fileName: string): Promise<DayIndexEntry[]> {
  const idx = await loadServerIndex();
  idx.entries = idx.entries.filter(e => e.source !== fileName);
  delete idx.files[fileName];
  await saveServerIndex(idx);
  return idx.entries;
}

export interface RescanProgress {
  current: number;
  total: number;
  fileName: string;
  phase: 'list' | 'load-index' | 'process' | 'cleanup' | 'save' | 'done';
}

/**
 * Reconcile the server index with what's actually in Storage.
 * - Adds entries for files in Storage not yet indexed
 * - Updates entries for files whose size/updated changed (re-uploaded outside the app)
 * - Removes entries for files no longer in Storage
 * Uses the existing index as a starting point — only downloads files that need processing.
 */
export async function rescanStorage(
  onProgress?: (p: RescanProgress) => void,
): Promise<DayIndexEntry[]> {
  onProgress?.({ current: 0, total: 0, fileName: '', phase: 'list' });
  const files = await listExcelFiles();
  onProgress?.({ current: 0, total: files.length, fileName: '', phase: 'load-index' });
  const idx = await loadServerIndex();
  let changed = false;

  // Cleanup: drop entries for files no longer in storage
  const storageNames = new Set(files.map(f => f.name));
  for (const name of Object.keys(idx.files)) {
    if (!storageNames.has(name)) {
      log(`Limpiando entradas huérfanas de ${name}`);
      idx.entries = idx.entries.filter(e => e.source !== name);
      delete idx.files[name];
      changed = true;
    }
  }

  // Process new or changed files
  for (let i = 0; i < files.length; i++) {
    const sf = files[i];
    const meta = idx.files[sf.name];
    const upToDate = meta && meta.size === sf.size && meta.updated === sf.updated;
    if (upToDate) continue;

    onProgress?.({ current: i + 1, total: files.length, fileName: sf.name, phase: 'process' });
    await new Promise(r => setTimeout(r, 0));

    try {
      log(`Indexando ${sf.name} (${(sf.size / 1024 / 1024).toFixed(1)} MB)`);
      const buffer = await downloadExcelFile(sf.fullPath);
      const days = extractDaysFromBuffer(buffer, sf.name);
      idx.entries = idx.entries.filter(e => e.source !== sf.name);
      idx.entries.push(...days);
      idx.files[sf.name] = { size: sf.size, updated: sf.updated };
      changed = true;
      log(`  → ${days.length} días`);
    } catch (err) {
      log(`Error procesando ${sf.name}:`, err);
    }
  }

  if (changed) {
    onProgress?.({ current: files.length, total: files.length, fileName: '', phase: 'save' });
    idx.entries.sort((a, b) => a.fecha.localeCompare(b.fecha));
    await saveServerIndex(idx);
  }

  onProgress?.({ current: files.length, total: files.length, fileName: '', phase: 'done' });
  return idx.entries;
}

export type { StorageFile };
