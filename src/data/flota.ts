// Flota de la Línea 1: identificadores de cabina TGMT → tren (dos cabinas por tren).
// Compartido por el procesador de Excel y el esquemático.

export const NM16_TRENES: Record<string, number[]> = {
  '01 (nm16)': [32776, 32777], '02 (nm16)': [32774, 32775], '03 (nm16)': [32778, 32779],
  '04 (nm16)': [32784, 32785], '05 (nm16)': [32772, 32773], '06 (nm16)': [32786, 32787],
  '07 (nm16)': [32782, 32783], '08 (nm16)': [32770, 32771], '09 (nm16)': [32780, 32781],
  '10 (nm16)': [32768, 32769],
};

export const NM22_TRENES: Record<string, number[]> = {
  '01 (nm22)': [32788, 32789], '02 (nm22)': [32790, 32791], '03 (nm22)': [32792, 32793],
  '04 (nm22)': [32794, 32795], '05 (nm22)': [32796, 32797], '06 (nm22)': [32798, 32799],
  '07 (nm22)': [32800, 32801], '08 (nm22)': [32802, 32803], '09 (nm22)': [32804, 32805],
  '10 (nm22)': [32806, 32807], '11 (nm22)': [32808, 32809], '12 (nm22)': [32810, 32811],
  '13 (nm22)': [32812, 32813], '14 (nm22)': [32814, 32815], '15 (nm22)': [32816, 32817],
  '16 (nm22)': [32818, 32819], '17 (nm22)': [32820, 32821], '18 (nm22)': [32822, 32823],
  '19 (nm22)': [32824, 32825], '20 (nm22)': [32826, 32827], '21 (nm22)': [32828, 32829],
  '22 (nm22)': [32830, 32831], '23 (nm22)': [32832, 32833], '24 (nm22)': [32834, 32835],
  '25 (nm22)': [32836, 32837], '26 (nm22)': [32838, 32839], '27 (nm22)': [32840, 32841],
  '28 (nm22)': [32842, 32843], '29 (nm22)': [32844, 32845],
};

/** Cabina TGMT (texto) → nombre del tren, p. ej. '32840' → '27 (nm22)'. */
export const TRAIN_MAP: Record<string, string> = {};
for (const [k, ids] of Object.entries({ ...NM16_TRENES, ...NM22_TRENES })) for (const id of ids) TRAIN_MAP[String(id)] = k;

export type MaterialFlota = 'NM16' | 'NM22';

export function materialDe(nombreTren: string): MaterialFlota | null {
  if (/nm16/i.test(nombreTren)) return 'NM16';
  if (/nm22/i.test(nombreTren)) return 'NM22';
  return null;
}
