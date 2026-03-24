import { cn } from '@/lib/utils';

export interface PasoAprobacion {
  orden: number;
  nombrePaso: string;
  rolAprobador: string;
  completado: boolean;
  actual: boolean;
  aprobadoPor?: { nombre: string; apellido: string } | null;
  fecha?: string | null;
  comentario?: string | null;
}

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

/** Client-side equivalent of the backend's enriquecerPasos */
export function enriquecerPasos(
  pasosFlujo: Array<{ orden: number; nombrePaso: string; rolAprobador: string }>,
  pasoActual: number,
  historial: Array<{
    pasoFlujo: number | null;
    estadoNuevo: string;
    comentario: string | null;
    createdAt: string;
    usuario: { nombre: string; apellido: string };
  }>,
): PasoAprobacion[] {
  return pasosFlujo.map((paso) => {
    const entry = historial.find(
      (h) => h.pasoFlujo === paso.orden && h.estadoNuevo !== 'RECHAZADA',
    );
    return {
      orden: paso.orden,
      nombrePaso: paso.nombrePaso,
      rolAprobador: paso.rolAprobador,
      completado: paso.orden < pasoActual,
      actual: paso.orden === pasoActual,
      aprobadoPor: entry ? { nombre: entry.usuario.nombre, apellido: entry.usuario.apellido } : null,
      fecha: entry ? entry.createdAt : null,
      comentario: entry?.comentario ?? null,
    };
  });
}
