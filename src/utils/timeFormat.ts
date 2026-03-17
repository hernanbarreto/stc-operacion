/**
 * Smart duration formatting:
 *  - < 60s  → "45s"
 *  - 1–60 min → "3m 25s"
 *  - > 1h → "1h 12m 30s"
 */
export function formatDuration(ms: number): string {
    const totalSec = Math.abs(Math.round(ms / 1000));
    if (totalSec < 60) return `${totalSec}s`;
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Format ms as compact string for boxplot labels */
export function formatDurationShort(ms: number): string {
    const totalSec = Math.abs(Math.round(ms / 1000));
    if (totalSec < 60) return `${totalSec}s`;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return s > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${m}m`;
}
