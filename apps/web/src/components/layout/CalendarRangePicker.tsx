import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * DUPLICACIÓN CONOCIDA (preexistente, no la consolides de paso): `VacacionesPage`
 * mantiene una copia inline de este mismo picker, porque necesita `maxDias` y
 * ningún caller de éste le pasa `maxDays`. Las dos copias tienen que arreglarse
 * juntas — el clamp por componentes de más abajo se aplicó en ambas. Unificarlas
 * es un refactor con su propio riesgo y merece su propia decisión.
 */
interface CalendarRangePickerProps {
  startDate: Date | null;
  endDate: Date | null;
  onSelect: (start: Date | null, end: Date | null) => void;
  maxDays?: number;
  allowPast?: boolean;
}

const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DOW = ['Lu','Ma','Mi','Ju','Vi','Sá','Do'];

export default function CalendarRangePicker({
  startDate,
  endDate,
  onSelect,
  maxDays,
  allowPast = true,
}: CalendarRangePickerProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [hoverDate, setHoverDate] = useState<Date | null>(null);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  function handleDayClick(d: Date) {
    if (!allowPast && d < today) return;
    if (!startDate || (startDate && endDate)) {
      onSelect(d, null);
    } else {
      if (d < startDate) {
        onSelect(d, null);
      } else {
        if (maxDays) {
          const candidateDays = Math.round((d.getTime() - startDate.getTime()) / 86400000) + 1;
          if (candidateDays > maxDays) {
            // Por componentes, no sumando milisegundos: con un cambio de huso en
            // el medio eso cae a las 23:00 del día anterior. Mismo arreglo que en
            // la copia inline del picker en VacacionesPage (ver nota de arriba).
            const clampedEnd = new Date(
              startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + maxDays - 1,
            );
            onSelect(startDate, clampedEnd);
            return;
          }
        }
        onSelect(startDate, d);
      }
    }
  }

  function inRange(d: Date) {
    const anchor = endDate ?? hoverDate;
    if (!startDate || !anchor) return false;
    const lo = startDate < anchor ? startDate : anchor;
    const hi = startDate < anchor ? anchor : startDate;
    return d >= lo && d <= hi;
  }

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={prevMonth}
          className="p-1.5 rounded-lg hover:bg-accent transition-colors">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button type="button" onClick={nextMonth}
          className="p-1.5 rounded-lg hover:bg-accent transition-colors">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {DOW.map(d => (
          <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {Array.from({ length: firstDow }).map((_, i) => <div key={`pad-${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const d = new Date(viewYear, viewMonth, i + 1);
          const isPast = !allowPast && d < today;
          const isStart = startDate && d.getTime() === startDate.getTime();
          const isEnd = endDate && d.getTime() === endDate.getTime();
          const highlighted = inRange(d);
          const isToday = d.getTime() === today.getTime();

          return (
            <button
              type="button"
              key={i}
              disabled={isPast}
              onClick={() => handleDayClick(d)}
              onMouseEnter={() => startDate && !endDate && setHoverDate(d)}
              onMouseLeave={() => setHoverDate(null)}
              className={cn(
                'h-8 text-xs font-medium rounded transition-all relative',
                isPast && 'text-muted-foreground/30 cursor-not-allowed',
                !isPast && !highlighted && !isStart && !isEnd && 'hover:bg-accent',
                highlighted && !isStart && !isEnd && 'bg-primary/15 rounded-none text-foreground',
                (isStart || isEnd) && 'bg-primary text-primary-foreground rounded-full z-10',
                isStart && endDate && 'rounded-l-full rounded-r-none',
                isEnd && startDate && 'rounded-r-full rounded-l-none',
                isToday && !isStart && !isEnd && 'font-bold text-primary',
              )}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
