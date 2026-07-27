import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { mensajeDeError } from '@/lib/errores';
import { useAuthStore } from '@/stores/authStore';
import { useCanApprove } from '@/hooks/useCanApprove';
import ApprovalProgressBar from '@/components/ui/ApprovalProgressBar';
import type { PasoAprobacion } from '@/components/ui/ApprovalProgressBar';
import { enriquecerPasos, pasosDe, type FirmaHistorial, type PasoDocumento } from '@/utils/circuito';
import { avisarSinCircuito } from '@/lib/avisoCircuito';
import {
  Palmtree, Plus, Send, XCircle,
  Loader2, X, Calendar, ChevronLeft, ChevronRight, Filter, UserCheck, Clock,
  ChevronDown, ChevronUp, User, AlertTriangle,
} from 'lucide-react';
import PeriodSelector from '@/components/layout/PeriodSelector';
import { usePeriodoActual, AVISO_PERIODO_POR_DEFECTO } from '@/hooks/usePeriodoConfig';
import ScopeToggle from '@/components/layout/ScopeToggle';
import { fmtDia } from '@/utils/fechaDia';


interface Vacacion {
  id: string;
  fechaInicio: string;
  fechaFin: string;
  diasHabiles: number;
  diasTotales: number;
  estado: string;
  motivo: string | null;
  obsRechazo: string | null;
  createdAt: string;
  usuario: {
    id: string;
    nombre: string;
    apellido: string;
    legajo: string | null;
    rol: string;
    sector?: { id: string; nombre: string } | null;
  };
}

interface Saldo {
  disponible: number;
  usados: number;
  pendiente: number;
  total: number;
}

const ESTADO_STYLES: Record<string, string> = {
  BORRADOR: 'bg-slate-500/20 text-slate-400',
  PENDIENTE: 'bg-blue-500/20 text-blue-400',
  EN_REVISION: 'bg-amber-500/20 text-amber-400',
  APROBADA: 'bg-emerald-500/20 text-emerald-400',
  RECHAZADA: 'bg-red-500/20 text-red-400',
};

interface VacacionDetail {
  pasoActual: number;
  /** El circuito congelado al enviar; JSON crudo, lo interpreta `pasosDe`. */
  circuitoSnapshot: unknown;
  flujo?: {
    nombre: string;
    pasos: PasoDocumento[];
  } | null;
  historial: FirmaHistorial[];
}

function VacacionCard({
  v,
  onEnviar,
  enviando,
}: {
  v: Vacacion;
  onEnviar: (id: string) => void;
  enviando: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const { data: detail, isLoading: loadingDetail, isError } = useQuery<VacacionDetail>({
    queryKey: ['vacacion-detail', v.id],
    queryFn: async () => (await api.get(`/vacaciones/${v.id}`)).data,
    enabled: expanded,
    staleTime: 60_000,
  });

  // El recorrido sale del circuito congelado de ESTA solicitud, no de la cadena
  // configurada hoy: con un circuito acortado por nivel, los pasos vivos muestran
  // firmas que la solicitud nunca necesitó.
  const pasos: PasoAprobacion[] = detail
    ? enriquecerPasos(pasosDe(detail), detail.pasoActual, detail.historial)
    : [];

  const hasBorrador = v.estado === 'BORRADOR';
  const hasFlow = v.estado !== 'BORRADOR';

  return (
    <div
      className={cn(
        'rounded-xl border p-4 transition-colors',
        v.estado === 'RECHAZADA'
          ? 'border-red-500/30 bg-red-500/5'
          : v.estado === 'APROBADA'
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : 'border-border bg-card',
        hasFlow && 'cursor-pointer hover:border-primary/30',
      )}
      onClick={() => hasFlow && setExpanded(!expanded)}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_STYLES[v.estado])}>
              {v.estado === 'EN_REVISION' ? 'En Revisión' : v.estado.charAt(0) + v.estado.slice(1).toLowerCase()}
            </span>
            <span className="font-medium text-sm flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              {fmtDia(v.fechaInicio)} — {fmtDia(v.fechaFin)}
            </span>
            <span className="text-xs text-muted-foreground">{v.diasHabiles} háb. / {v.diasTotales} corrido{v.diasTotales !== 1 ? 's' : ''}</span>
            {hasFlow && (
              expanded
                ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
                : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              <UserCheck className="h-3 w-3" />
              {v.usuario.apellido}, {v.usuario.nombre}
            </span>
            {v.usuario.legajo && (
              <span className="font-mono text-[11px]">Leg. {v.usuario.legajo}</span>
            )}
            {v.usuario.sector?.nombre && (
              <span>{v.usuario.sector.nombre}</span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Solicitada {new Date(v.createdAt).toLocaleDateString('es-AR')}
            </span>
          </div>
          {v.motivo && <p className="text-xs text-muted-foreground mt-1">{v.motivo}</p>}
          {v.obsRechazo && <p className="text-xs text-red-400 flex items-center gap-1 mt-1"><XCircle className="h-3 w-3" /> {v.obsRechazo}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          {hasBorrador && (
            <button
              onClick={(e) => { e.stopPropagation(); onEnviar(v.id); }}
              disabled={enviando}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Send className="h-3 w-3" /> Enviar
            </button>
          )}
        </div>
      </div>

      {/* Expanded: approval progress */}
      {expanded && (
        <div className="mt-3 border-t border-border pt-3">
          {loadingDetail ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <p className="text-xs text-red-400 text-center py-2">No se pudo cargar el flujo de aprobación</p>
          ) : pasos.length > 0 ? (
            <>
              <ApprovalProgressBar pasos={pasos} estado={v.estado} />
              {/* Detail historial */}
              {pasos.some((p) => p.aprobadoPor || p.comentario) && (
                <div className="space-y-1.5 pl-2 border-l-2 border-border mt-3">
                  {pasos
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
            </>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-2">Sin flujo de aprobación asignado</p>
          )}
        </div>
      )}
    </div>
  );
}

interface VacacionesPageProps {
  embedded?: boolean;
}

export default function VacacionesPage({ embedded = false }: VacacionesPageProps = {}) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [showForm, setShowForm] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const rol = useAuthStore.getState().user?.rol ?? '';
    return params.get('crear') === 'true' && ['OPERADOR', 'SUPERVISOR', 'COORDINADOR', 'GERENTE'].includes(rol);
  });
  const [filterSector, setFilterSector] = useState('');
  const { periodo, setPeriodo, listo, usandoValoresPorDefecto } = usePeriodoActual();
  const [scope, setScope] = useState<'mio' | 'equipo'>('equipo');
  const isRRHH = ['RRHH', 'ADMIN'].includes(user?.rol ?? '');
  const canApprove = useCanApprove();
  const showScopeToggle = canApprove === true && !isRRHH;

  interface Sector { id: string; nombre: string; }
  const { data: sectores = [] } = useQuery<Sector[]>({
    queryKey: ['sectores-vacaciones'],
    queryFn: async () => (await api.get('/analytics/sectores')).data,
    enabled: isRRHH,
  });

  const { data: vacaciones = [], isLoading } = useQuery<Vacacion[]>({
    queryKey: ['vacaciones', periodo?.inicio, periodo?.fin, scope],
    queryFn: async () => {
      const params = new URLSearchParams({ periodoInicio: periodo!.inicio, periodoFin: periodo!.fin });
      if (showScopeToggle && scope === 'mio') params.set('scope', 'mio');
      else if (!showScopeToggle && canApprove !== true) params.set('scope', 'mio');
      return (await api.get(`/vacaciones?${params.toString()}`)).data;
    },
    enabled: !!periodo,
  });

  const { data: saldo } = useQuery<Saldo>({
    queryKey: ['vacaciones-saldo'],
    queryFn: async () => (await api.get('/vacaciones/saldo')).data,
  });

  const enviarMutation = useMutation({
    mutationFn: (id: string) => api.post(`/vacaciones/${id}/enviar`),
    onSuccess: (res) => {
      avisarSinCircuito(res.data);
      queryClient.invalidateQueries({ queryKey: ['vacaciones'] });
      queryClient.invalidateQueries({ queryKey: ['vacaciones-saldo'] });
    },
  });

  const filteredVacaciones = filterSector
    ? vacaciones.filter(v => v.usuario.sector?.id === filterSector)
    : vacaciones;

  const canCreate = ['OPERADOR', 'SUPERVISOR', 'COORDINADOR', 'GERENTE'].includes(user?.rol ?? '');

  if (!listo) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cuando está embebida (tab "Vacaciones" dentro de Ausencias), la
         pantalla contenedora ya muestra este aviso — evitamos duplicarlo. */}
      {!embedded && usandoValoresPorDefecto && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <p className="text-xs text-amber-400">{AVISO_PERIODO_POR_DEFECTO}</p>
        </div>
      )}
      {!embedded && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Palmtree className="h-6 w-6 text-emerald-400" /> Vacaciones
            </h1>
            <p className="text-sm text-muted-foreground">{filteredVacaciones.length} solicitud{filteredVacaciones.length !== 1 ? 'es' : ''}</p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {periodo && <PeriodSelector value={periodo} onChange={setPeriodo} />}
        {showScopeToggle && <ScopeToggle value={scope} onChange={setScope} />}
        {isRRHH && sectores.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select
              className="h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm"
              value={filterSector}
              onChange={(e) => setFilterSector(e.target.value)}
            >
              <option value="">Todos los sectores</option>
              {sectores.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>
        )}
        {canCreate && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
          >
            <Plus className="h-4 w-4" /> Solicitar vacaciones
          </button>
        )}
      </div>

      {/* Saldo cards */}
      {saldo && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-border bg-card p-3 text-center">
            <p className="text-2xl font-bold text-emerald-400">{saldo.disponible}</p>
            <p className="text-xs text-muted-foreground">Disponibles</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3 text-center">
            <p className="text-2xl font-bold text-foreground">{saldo.usados}</p>
            <p className="text-xs text-muted-foreground">Usados</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3 text-center">
            <p className="text-2xl font-bold text-amber-400">{saldo.pendiente}</p>
            <p className="text-xs text-muted-foreground">Pendientes</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3 text-center">
            <p className="text-2xl font-bold text-muted-foreground">{saldo.total}</p>
            <p className="text-xs text-muted-foreground">Total anual</p>
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filteredVacaciones.length === 0 ? (
        <div className="text-center py-16">
          <Palmtree className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-muted-foreground">No hay solicitudes de vacaciones</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredVacaciones.map((v) => (
            <VacacionCard
              key={v.id}
              v={v}
              onEnviar={(id) => enviarMutation.mutate(id)}
              enviando={enviarMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Create Modal */}
      {canCreate && showForm && (
        <VacacionFormModal
          saldo={saldo}
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ['vacaciones'] });
            queryClient.invalidateQueries({ queryKey: ['vacaciones-saldo'] });
          }}
        />
      )}
    </div>
  );
}

function VacacionFormModal({
  saldo,
  onClose,
  onSuccess,
}: {
  saldo: Saldo | undefined;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [motivo, setMotivo] = useState('');

  // Calendar state
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-based
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);

  const maxDias = saldo?.disponible ?? 0;

  // Compute total calendar days selected
  const diasTotales = startDate && endDate
    ? Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1
    : 0;

  // Build calendar grid for the viewed month
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // Mon=0

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  function handleDayClick(d: Date) {
    if (d < today) return; // past
    if (!startDate || (startDate && endDate)) {
      // Start fresh
      setStartDate(d);
      setEndDate(null);
    } else {
      // Set end
      if (d < startDate) {
        setStartDate(d);
        setEndDate(null);
      } else {
        const candidateDays = Math.round((d.getTime() - startDate.getTime()) / 86400000) + 1;
        if (candidateDays > maxDias) {
          // Clamp to max
          const clampedEnd = new Date(startDate.getTime() + (maxDias - 1) * 86400000);
          setEndDate(clampedEnd);
        } else {
          setEndDate(d);
        }
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

  const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const DOW = ['Lu','Ma','Mi','Ju','Vi','Sá','Do'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) { setError('Seleccioná las fechas en el calendario'); return; }
    if (diasTotales > maxDias) { setError(`Solo tenés ${maxDias} días disponibles`); return; }
    setLoading(true);
    setError('');
    try {
      // En vacaciones el alta ES el envío: el aviso de "sin circuito" viene acá.
      const res = await api.post('/vacaciones', {
        fechaInicio: startDate.toISOString(),
        fechaFin: endDate.toISOString(),
        diasHabiles: diasTotales, // backend field, but we send total calendar days
        motivo: motivo || undefined,
      });
      avisarSinCircuito(res.data);
      onSuccess();
    } catch (err: unknown) {
      setError(mensajeDeError(err).mensaje);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Solicitar Vacaciones</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent"><X className="h-5 w-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

          {/* Available days */}
          {saldo && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Días disponibles:</span>
              <span className="font-bold text-emerald-400 text-lg">{saldo.disponible}</span>
            </div>
          )}

          {/* Selection summary */}
          {startDate && (
            <div className="rounded-lg bg-primary/10 border border-primary/20 px-3 py-2 text-sm flex items-center justify-between">
              <span className="text-muted-foreground">
                {startDate.toLocaleDateString('es-AR')}
                {endDate && ` — ${endDate.toLocaleDateString('es-AR')}`}
                {!endDate && ' → seleccioná fin'}
              </span>
              {endDate && (
                <span className="font-bold text-primary">{diasTotales} días</span>
              )}
            </div>
          )}

          {/* Calendar */}
          <div className="select-none">
            {/* Month nav */}
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

            {/* Day-of-week header */}
            <div className="grid grid-cols-7 mb-1">
              {DOW.map(d => (
                <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">{d}</div>
              ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7 gap-y-0.5">
              {Array.from({ length: firstDow }).map((_, i) => <div key={`pad-${i}`} />)}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const d = new Date(viewYear, viewMonth, i + 1);
                const isPast = d < today;
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

          {/* Motivo */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Motivo (opcional)</label>
            <input
              className="mt-1 w-full h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !startDate || !endDate}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Solicitar {endDate && `(${diasTotales}d)`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
