// Fechas del log del ATS (número de serie de Excel, texto 'YYYY-MM-DD HH:MM:SS.ffffff' o Date) → ms en hora local.

export function parseFecha(v: unknown): number | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') {
    const ms = (v - 25569) * 86400 * 1000;
    return ms + new Date(ms).getTimezoneOffset() * 60000;
  }
  if (typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(v.trim());
    if (!m) return null;
    const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms).getTime();
  }
  return null;
}

const p2 = (n: number) => String(n).padStart(2, '0');

export function fechaDia(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

export function horaTxt(t: number, ms = false): string {
  const d = new Date(t);
  const s = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  return ms ? `${s}.${String(d.getMilliseconds()).padStart(3, '0')}` : s;
}
