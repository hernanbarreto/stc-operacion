import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import type { DayIndexEntry } from '../services/daysIndex';
import './Calendar.css';

const WEEKDAYS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

interface CalendarProps {
  dayIndex: DayIndexEntry[];
  onSelectDay: (entry: DayIndexEntry) => void;
  loadingDay?: string | null;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shortHM(hms: string): string {
  return hms.slice(0, 5); // 'HH:MM:SS' → 'HH:MM'
}

export const CalendarView: React.FC<CalendarProps> = ({ dayIndex, onSelectDay, loadingDay }) => {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Default to current month, or to month of the latest indexed day if no current-month data
  const [cursor, setCursor] = useState<Date>(() => {
    const d = new Date(today);
    d.setDate(1);
    return d;
  });

  const indexByDate = useMemo(() => {
    const m = new Map<string, DayIndexEntry>();
    for (const e of dayIndex) m.set(e.fecha, e);
    return m;
  }, [dayIndex]);

  // Build the grid: first weekday of month → last day of month, padded with prev/next month days
  const grid = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const daysInMonth = last.getDate();

    // 0 = Sun, but we want Mon-first. Map: Mon=0, Tue=1, ..., Sun=6
    const firstDow = (first.getDay() + 6) % 7;

    const cells: { date: Date; inMonth: boolean }[] = [];
    // Leading days from previous month
    for (let i = firstDow - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      cells.push({ date: d, inMonth: false });
    }
    // Days of this month
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: new Date(year, month, d), inMonth: true });
    }
    // Trailing days to complete the last row
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1].date;
      const d = new Date(last);
      d.setDate(last.getDate() + 1);
      cells.push({ date: d, inMonth: false });
    }
    return cells;
  }, [cursor]);

  const monthLabel = `${MONTHS_ES[cursor.getMonth()]} ${cursor.getFullYear()}`;

  const goPrev = () => {
    const d = new Date(cursor);
    d.setMonth(d.getMonth() - 1);
    setCursor(d);
  };
  const goNext = () => {
    const d = new Date(cursor);
    d.setMonth(d.getMonth() + 1);
    setCursor(d);
  };
  const goToday = () => {
    const d = new Date(today);
    d.setDate(1);
    setCursor(d);
  };

  const todayYmd = ymd(today);
  const countWithData = useMemo(
    () => grid.filter(c => c.inMonth && indexByDate.has(ymd(c.date))).length,
    [grid, indexByDate],
  );

  return (
    <div className="calendar-view">
      <header className="calendar-header">
        <div className="calendar-title">
          <CalendarIcon size={22} />
          <h2>{monthLabel}</h2>
          <span className="calendar-subtitle">
            {countWithData > 0
              ? `${countWithData} ${countWithData === 1 ? 'día' : 'días'} con datos`
              : 'Sin datos este mes'}
          </span>
        </div>
        <div className="calendar-nav">
          <button className="cal-nav-btn" onClick={goPrev} title="Mes anterior">
            <ChevronLeft size={18} />
          </button>
          <button className="cal-today-btn" onClick={goToday}>Hoy</button>
          <button className="cal-nav-btn" onClick={goNext} title="Mes siguiente">
            <ChevronRight size={18} />
          </button>
        </div>
      </header>

      <div className="calendar-weekdays">
        {WEEKDAYS_ES.map(w => (
          <div key={w} className="calendar-weekday">{w}</div>
        ))}
      </div>

      <div className="calendar-grid">
        {grid.map(({ date, inMonth }) => {
          const dateStr = ymd(date);
          const entry = indexByDate.get(dateStr);
          const isToday = dateStr === todayYmd;
          const hasData = !!entry;
          const isLoading = loadingDay === dateStr;
          const classes = [
            'cal-cell',
            !inMonth && 'cal-cell-other',
            isToday && 'cal-cell-today',
            hasData && 'cal-cell-has-data',
            isLoading && 'cal-cell-loading',
          ].filter(Boolean).join(' ');

          return (
            <button
              key={dateStr}
              className={classes}
              disabled={!hasData}
              onClick={() => entry && onSelectDay(entry)}
              title={hasData ? `${entry!.evCount.toLocaleString()} eventos` : 'Sin datos'}
            >
              <span className="cal-cell-num">{date.getDate()}</span>
              {hasData && (
                <span className="cal-cell-range">
                  {shortHM(entry!.hourStart)}
                  <span className="cal-cell-dash">—</span>
                  {shortHM(entry!.hourEnd)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
