import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import ApprovalProgressBar from '@/components/ui/ApprovalProgressBar';
import type { PasoAprobacion } from '@/components/ui/ApprovalProgressBar';
import {
  ClipboardList,
  Palmtree,
  FileX,
  ArrowLeftRight,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Filter,
  ChevronDown,
  ChevronUp,
  User,
} from 'lucide-react';

interface Paso extends PasoAprobacion {}

interface Solicitud {
  id: string;
  tipo: 'VACACION' | 'AUSENCIA' | 'CAMBIO_DIAGRAMA';
  estado: string;
  pasoActual: number;
  totalPasos: number;
  createdAt: string;
  detalle: string;
  pasos: Paso[];
  obsRechazo?: string | null;
}

const TIPO_ICON: Record<string, React.ElementType> = {
  VACACION: Palmtree,
  AUSENCIA: FileX,
  CAMBIO_DIAGRAMA: ArrowLeftRight,
};

const TIPO_LABEL: Record<string, string> = {
  VACACION: 'Vacaciones',
  AUSENCIA: 'Ausencia',
  CAMBIO_DIAGRAMA: 'Cambio Diagrama',
};

const TIPO_COLOR: Record<string, string> = {
  VACACION: 'text-emerald-400',
  AUSENCIA: 'text-amber-400',
  CAMBIO_DIAGRAMA: 'text-blue-400',
};

const ESTADO_BADGE: Record<string, { bg: string; icon: React.ElementType }> = {
  PENDIENTE: { bg: 'bg-blue-500/20 text-blue-400', icon: Clock },
  EN_REVISION: { bg: 'bg-amber-500/20 text-amber-400', icon: Clock },
  APROBADA: { bg: 'bg-emerald-500/20 text-emerald-400', icon: CheckCircle2 },
  RECHAZADA: { bg: 'bg-red-500/20 text-red-400', icon: XCircle },
};

const FILTER_OPTIONS = [
  { value: '', label: 'Todas' },
  { value: 'VACACION', label: 'Vacaciones' },
  { value: 'AUSENCIA', label: 'Ausencias' },
  { value: 'CAMBIO_DIAGRAMA', label: 'Cambios Diagrama' },
];

function SolicitudCard({ solicitud }: { solicitud: Solicitud }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TIPO_ICON[solicitud.tipo] ?? ClipboardList;
  const estadoBadge = ESTADO_BADGE[solicitud.estado] ?? ESTADO_BADGE.PENDIENTE;
  const EstadoIcon = estadoBadge.icon;

  const fecha = new Date(solicitud.createdAt).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });

  return (
    <div
      className={cn(
        'rounded-xl border p-4 space-y-2 transition-colors',
        solicitud.estado === 'RECHAZADA'
          ? 'border-red-500/30 bg-red-500/5'
          : solicitud.estado === 'APROBADA'
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : 'border-border bg-card hover:border-primary/30',
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={cn('h-4 w-4 shrink-0', TIPO_COLOR[solicitud.tipo])} />
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">{TIPO_LABEL[solicitud.tipo]}</p>
            <p className="text-[10px] text-muted-foreground">{fecha}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium',
              estadoBadge.bg,
            )}
          >
            <EstadoIcon className="h-3 w-3" />
            {solicitud.estado.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* Detail */}
      <p className="text-xs text-foreground/80">{solicitud.detalle}</p>

      {/* Rejection note */}
      {solicitud.obsRechazo && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
          <p className="text-[10px] text-red-400">
            <span className="font-semibold">Motivo rechazo:</span> {solicitud.obsRechazo}
          </p>
        </div>
      )}

      {/* Progress bar */}
      {solicitud.pasos.length > 0 && (
        <ApprovalProgressBar pasos={solicitud.pasos} estado={solicitud.estado} />
      )}

      {/* Expandable historial */}
      {solicitud.pasos.some((p) => p.aprobadoPor || p.comentario) && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? 'Ocultar detalle' : 'Ver detalle'}
        </button>
      )}

      {expanded && (
        <div className="space-y-1.5 pl-2 border-l-2 border-border">
          {solicitud.pasos
            .filter((p) => p.aprobadoPor || p.comentario)
            .map((paso) => (
              <div key={paso.orden} className="text-[10px]">
                <div className="flex items-center gap-1">
                  <User className="h-2.5 w-2.5 text-muted-foreground" />
                  <span className="font-medium">
                    {paso.aprobadoPor
                      ? `${paso.aprobadoPor.nombre} ${paso.aprobadoPor.apellido}`
                      : paso.nombrePaso}
                  </span>
                  {paso.fecha && (
                    <span className="text-muted-foreground">
                      {new Date(paso.fecha).toLocaleDateString('es-AR')}
                    </span>
                  )}
                </div>
                {paso.comentario && (
                  <p className="text-muted-foreground ml-3.5 italic">"{paso.comentario}"</p>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export default function MisSolicitudesPage() {
  const [tipoFilter, setTipoFilter] = useState('');

  const { data: solicitudes = [], isLoading } = useQuery<Solicitud[]>({
    queryKey: ['mis-solicitudes'],
    queryFn: async () => (await api.get('/mis-solicitudes')).data,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const filtered = tipoFilter
    ? solicitudes.filter((s) => s.tipo === tipoFilter)
    : solicitudes;

  const pendientes = filtered.filter(
    (s) => s.estado === 'PENDIENTE' || s.estado === 'EN_REVISION',
  );
  const resueltas = filtered.filter(
    (s) => s.estado === 'APROBADA' || s.estado === 'RECHAZADA',
  );

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold">Mis Solicitudes</h1>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <div className="flex gap-1 flex-wrap">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTipoFilter(opt.value)}
              className={cn(
                'px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
                tipoFilter === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : solicitudes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <ClipboardList className="h-10 w-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No tenés solicitudes</p>
          <p className="text-xs">
            Las solicitudes de vacaciones, ausencias y cambios de diagrama aparecerán acá.
          </p>
        </div>
      ) : (
        <>
          {/* Active requests */}
          {pendientes.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                En curso ({pendientes.length})
              </h2>
              {pendientes.map((s) => (
                <SolicitudCard key={s.id} solicitud={s} />
              ))}
            </section>
          )}

          {/* Resolved requests */}
          {resueltas.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Resueltas ({resueltas.length})
              </h2>
              {resueltas.map((s) => (
                <SolicitudCard key={s.id} solicitud={s} />
              ))}
            </section>
          )}

          {filtered.length === 0 && solicitudes.length > 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">No hay solicitudes de este tipo</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
