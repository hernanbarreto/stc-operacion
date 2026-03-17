import { read, utils } from 'xlsx';

const VALID_EVENTS = [
    'TGMT_ARRIVAL_AT_PLATFORM',
    'TGMT_DEPARTURE_AT_PLATFORM',
    'TGMT_SKIP_PLATFORM',
];

export interface ValidationResult {
    valid: boolean;
    error: string;
    rows: number;
    events: number;
}

/**
 * Validate an Excel file before uploading.
 * Checks that it has the required columns and contains ATS event data.
 */
export function validateExcelFormat(buffer: ArrayBuffer): ValidationResult {
    try {
        const data = new Uint8Array(buffer);
        const workbook = read(data, { type: 'array' });

        if (workbook.SheetNames.length === 0) {
            return { valid: false, error: 'El archivo no tiene hojas de cálculo.', rows: 0, events: 0 };
        }

        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

        if (rows.length < 2) {
            return { valid: false, error: 'El archivo está vacío o no tiene datos suficientes.', rows: rows.length, events: 0 };
        }

        // Check first 200 data rows for valid events
        let eventCount = 0;
        let hasTren = false;
        let hasEstacion = false;
        const limit = Math.min(rows.length, 200);

        for (let i = 1; i < limit; i++) {
            const row = rows[i];
            if (!row || row.length < 3) continue;

            const label = String(row[0] || '').trim();
            const desc = String(row[2] || '').trim();

            if (VALID_EVENTS.includes(label)) {
                eventCount++;

                if (/(?:tren|TREN)\s+\d+/i.test(desc)) hasTren = true;
                if (/(?:estaci[oó]n|ESTACI[OÓ]N)\s+\d+/i.test(desc)) hasEstacion = true;
            }
        }

        if (eventCount === 0) {
            return {
                valid: false,
                error: 'No se encontraron eventos ATS válidos (TGMT_ARRIVAL_AT_PLATFORM, TGMT_DEPARTURE_AT_PLATFORM, TGMT_SKIP_PLATFORM) en la columna A.',
                rows: rows.length,
                events: 0,
            };
        }

        if (!hasTren || !hasEstacion) {
            const missing: string[] = [];
            if (!hasTren) missing.push('"tren"');
            if (!hasEstacion) missing.push('"estación"');
            return {
                valid: false,
                error: `La columna de descripción (C) no contiene información de ${missing.join(' ni ')}. Verifica el formato del archivo.`,
                rows: rows.length,
                events: eventCount,
            };
        }

        return { valid: true, error: '', rows: rows.length, events: eventCount };
    } catch (err) {
        return {
            valid: false,
            error: `Error al leer el archivo: ${err instanceof Error ? err.message : 'formato no reconocido'}.`,
            rows: 0,
            events: 0,
        };
    }
}
