import { useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const MESES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export interface PeriodoItem {
  id: string;
  periodoInicio: string;
  periodoFin: string;
}

/**
 * Selector de período tipo "calendario de meses" 3×4 (port de la PWA, tematizado).
 * Cada celda = un mes del año visible; está habilitada si el propietario tiene una planilla cuyo
 * período CIERRA en ese mes (se navega a esa planilla por id). Los meses sin planilla quedan inertes.
 */
export default function PeriodGridPicker({
  planillas,
  currentId,
  currentFin,
  onPick,
  onClose,
}: {
  planillas: PeriodoItem[];
  currentId: string;
  currentFin: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const curFin = new Date(currentFin);
  const [year, setYear] = useState(curFin.getFullYear());
  const [closing, setClosing] = useState(false);

  // Mapa mes-de-cierre → planilla (del año visible).
  const byMonth = new Map<number, PeriodoItem>();
  for (const p of planillas) {
    const f = new Date(p.periodoFin);
    if (f.getFullYear() === year) byMonth.set(f.getMonth(), p);
  }
  const curMonth = curFin.getMonth();
  const curYear = curFin.getFullYear();

  function cerrar() {
    setClosing(true);
    setTimeout(onClose, 180);
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-[70] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm',
        closing ? 'animate-[backdrop-fade-out_180ms_ease_both]' : 'animate-[backdrop-fade-in_180ms_ease_both]',
      )}
      onClick={cerrar}
    >
      <div
        className="w-full max-w-xs rounded-2xl bg-card border border-border shadow-2xl p-5 animate-[container-grow-in_200ms_cubic-bezier(0.34,1.56,0.64,1)_both]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setYear((y) => y - 1)} aria-label="Año anterior" className="p-2 rounded-lg hover:bg-accent text-muted-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-base font-bold tabular-nums text-foreground">{year}</span>
          <button onClick={() => setYear((y) => y + 1)} aria-label="Año siguiente" className="p-2 rounded-lg hover:bg-accent text-muted-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button onClick={cerrar} aria-label="Cerrar" className="ml-1 p-2 rounded-lg hover:bg-accent text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 12 }, (_, m) => {
            const p = byMonth.get(m);
            const sel = !!p && p.id === currentId;
            const isCur = m === curMonth && year === curYear;
            return (
              <button
                key={m}
                disabled={!p}
                onClick={() => { if (p) { onPick(p.id); cerrar(); } }}
                className={cn(
                  'relative rounded-xl py-2.5 px-1 flex flex-col items-center transition-colors active:scale-95',
                  sel
                    ? 'bg-primary text-primary-foreground shadow'
                    : p
                      ? 'bg-muted/40 text-foreground hover:bg-muted/70'
                      : 'bg-muted/10 text-muted-foreground/40 cursor-not-allowed',
                  isCur && !sel && 'ring-1 ring-primary/50',
                )}
              >
                <span className="text-sm font-semibold leading-tight">{MESES_SHORT[m]}</span>
                <span className={cn('text-[10px] leading-tight', sel ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                  {p ? 'planilla' : '—'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
