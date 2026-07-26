import { cn } from '@/lib/utils';
import type { PasoRecorrido } from '@/utils/circuito';

/**
 * La barra dibuja el recorrido reconstruido. El tipo vive en `utils/circuito.ts`,
 * al lado de la función que lo arma y del criterio del back que replica: dos
 * formas del mismo paso se separan en el primer campo que se agregue.
 */
export type PasoAprobacion = PasoRecorrido;

export default function ApprovalProgressBar({
  pasos,
  estado,
}: {
  pasos: PasoAprobacion[];
  estado: string;
}) {
  if (!pasos.length) return null;

  const isRejected = estado === 'RECHAZADA';
  const isApproved = estado === 'APROBADA';

  return (
    <div className="mt-3 space-y-2">
      {/* Visual progress bar */}
      <div className="flex items-center gap-0.5">
        {pasos.map((paso, i) => {
          const isComplete = paso.completado || isApproved;
          const isCurrent = paso.actual && !isApproved;
          const isFailed = isCurrent && isRejected;

          return (
            <div key={paso.orden} className="flex-1 flex items-center">
              <div className="flex-1 relative">
                <div
                  className={cn(
                    'h-2 rounded-full transition-all',
                    isComplete
                      ? 'bg-emerald-500'
                      : isFailed
                        ? 'bg-red-500'
                        : isCurrent
                          ? 'bg-amber-500 animate-pulse'
                          : 'bg-muted',
                  )}
                />
              </div>
              {i < pasos.length - 1 && <div className="w-0.5" />}
            </div>
          );
        })}
      </div>

      {/* Step labels */}
      <div className="flex">
        {pasos.map((paso) => {
          const isComplete = paso.completado || isApproved;
          const isCurrent = paso.actual && !isApproved;
          const isFailed = isCurrent && isRejected;

          return (
            <div key={paso.orden} className="flex-1 min-w-0 px-0.5">
              <p
                className={cn(
                  'text-[9px] font-medium truncate text-center',
                  isComplete
                    ? 'text-emerald-400'
                    : isFailed
                      ? 'text-red-400'
                      : isCurrent
                        ? 'text-amber-400'
                        : 'text-muted-foreground',
                )}
              >
                {paso.nombrePaso}
              </p>
              {paso.aprobadoPor && (
                <p className="text-[8px] text-muted-foreground text-center truncate">
                  {paso.aprobadoPor.nombre} {paso.aprobadoPor.apellido.charAt(0)}.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
