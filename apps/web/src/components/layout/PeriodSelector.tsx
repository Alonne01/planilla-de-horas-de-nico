import { useMemo, useRef, useState, useEffect } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

const MESES_ES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

interface Cycle {
  inicio: string;
  fin: string;
  label: string;
}

export function generateCycles(
  count: number,
  diaInicio: number = 21,
  diaFin: number = 20,
): Cycle[] {
  const cycles: Cycle[] = [];
  const now = new Date();
  // Determine current cycle's start month
  let startYear = now.getFullYear();
  let startMonth = now.getMonth(); // 0-indexed

  if (now.getDate() < diaInicio) {
    // We're in the first half — cycle started previous month
    startMonth -= 1;
    if (startMonth < 0) {
      startMonth = 11;
      startYear -= 1;
    }
  }

  for (let i = 0; i < count; i++) {
    const inicioDate = new Date(startYear, startMonth - i, diaInicio);
    const finDate = new Date(startYear, startMonth - i + 1, diaFin);

    const iDay = inicioDate.getDate();
    const iMes = MESES_ES[inicioDate.getMonth()];
    const fDay = finDate.getDate();
    const fMes = MESES_ES[finDate.getMonth()];
    const fYear = finDate.getFullYear();

    // Only show year on inicio if it differs from fin
    const iYearStr =
      inicioDate.getFullYear() !== fYear
        ? ` ${inicioDate.getFullYear()}`
        : '';

    cycles.push({
      inicio: inicioDate.toISOString(),
      fin: finDate.toISOString(),
      label: `${iDay} ${iMes}${iYearStr} - ${fDay} ${fMes} ${fYear}`,
    });
  }

  return cycles;
}

export function getCurrentPeriod(
  diaInicio: number = 21,
  diaFin: number = 20,
): { inicio: string; fin: string } {
  const [current] = generateCycles(1, diaInicio, diaFin);
  return { inicio: current.inicio, fin: current.fin };
}

// ── Component ────────────────────────────────────────────────────

export interface PeriodSelectorProps {
  value: { inicio: string; fin: string };
  onChange: (period: { inicio: string; fin: string }) => void;
  className?: string;
}

export default function PeriodSelector({
  value,
  onChange,
  className,
}: PeriodSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const cycles = useMemo(() => generateCycles(12), []);

  const currentPeriod = useMemo(() => getCurrentPeriod(), []);

  const selectedIndex = useMemo(() => {
    const valInicio = new Date(value.inicio).getTime();
    const valFin = new Date(value.fin).getTime();
    return cycles.findIndex(
      (c) =>
        new Date(c.inicio).getTime() === valInicio &&
        new Date(c.fin).getTime() === valFin,
    );
  }, [value, cycles]);

  const selectedLabel =
    selectedIndex >= 0 ? cycles[selectedIndex].label : cycles[0].label;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const isCurrent = (cycle: Cycle) =>
    new Date(cycle.inicio).getTime() === new Date(currentPeriod.inicio).getTime() &&
    new Date(cycle.fin).getTime() === new Date(currentPeriod.fin).getTime();

  return (
    <div ref={containerRef} className={cn('relative inline-block', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 bg-card border border-border rounded-lg',
          'px-3 py-1.5 text-sm text-foreground',
          'hover:bg-accent/50 transition-colors cursor-pointer',
          'focus:outline-none focus:ring-2 focus:ring-ring',
        )}
      >
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span>{selectedLabel}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <ul
          className={cn(
            'absolute z-50 mt-1 w-full min-w-[220px]',
            'bg-card border border-border rounded-lg shadow-lg',
            'py-1 max-h-64 overflow-y-auto',
          )}
        >
          {cycles.map((cycle, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <li key={cycle.inicio}>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ inicio: cycle.inicio, fin: cycle.fin });
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full text-left px-3 py-1.5 text-sm transition-colors cursor-pointer',
                    isSelected
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-accent/50',
                  )}
                >
                  {cycle.label}
                  {isCurrent(cycle) && (
                    <span className="ml-1 text-xs opacity-70">(Actual)</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
