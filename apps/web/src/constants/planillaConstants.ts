/** Shared estado (planilla state) styling, labels, and colors */

export const ESTADO_STYLES: Record<string, string> = {
  BORRADOR: 'bg-slate-500/20 text-slate-400',
  ENVIADA: 'bg-blue-500/20 text-blue-400',
  EN_REVISION: 'bg-amber-500/20 text-amber-400',
  APROBADA: 'bg-emerald-500/20 text-emerald-400',
  RECHAZADA: 'bg-red-500/20 text-red-400',
  CERRADA: 'bg-purple-500/20 text-purple-400',
};

export const ESTADO_LABELS: Record<string, string> = {
  BORRADOR: 'Borrador',
  ENVIADA: 'Enviada',
  EN_REVISION: 'En Revisión',
  APROBADA: 'Aprobada',
  RECHAZADA: 'Rechazada',
  CERRADA: 'Cerrada',
};

/** Solid background variant — used in analytics charts/bars */
export const ESTADO_COLORS: Record<string, string> = {
  BORRADOR: 'bg-slate-500',
  ENVIADA: 'bg-blue-500',
  EN_REVISION: 'bg-amber-500',
  APROBADA: 'bg-emerald-500',
  RECHAZADA: 'bg-red-500',
  CERRADA: 'bg-purple-500',
};
