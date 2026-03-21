import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import {
  Palmtree, Plus, Send, XCircle,
  Loader2, X, Calendar, ChevronLeft, ChevronRight
} from 'lucide-react';


interface Vacacion {
  id: string;
  fechaInicio: string;
  fechaFin: string;
  diasHabiles: number;
  diasTotales: number;
  estado: string;
  motivo: string | null;
  obsRechazo: string | null;
  usuario: { nombre: string; apellido: string };
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

export default function VacacionesPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [showForm, setShowForm] = useState(false);

  const { data: vacaciones = [], isLoading } = useQuery<Vacacion[]>({
    queryKey: ['vacaciones'],
    queryFn: async () => (await api.get('/vacaciones')).data,
  });

  const { data: saldo } = useQuery<Saldo>({
    queryKey: ['vacaciones-saldo'],
    queryFn: async () => (await api.get('/vacaciones/saldo')).data,
  });

  const enviarMutation = useMutation({
    mutationFn: (id: string) => api.post(`/vacaciones/${id}/enviar`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vacaciones'] });
      queryClient.invalidateQueries({ queryKey: ['vacaciones-saldo'] });
    },
  });

  const canCreate = ['OPERADOR', 'SUPERVISOR', 'COORDINADOR', 'GERENTE'].includes(user?.rol ?? '');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Palmtree className="h-6 w-6 text-emerald-400" /> Vacaciones
          </h1>
          <p className="text-sm text-muted-foreground">{vacaciones.length} solicitud{vacaciones.length !== 1 ? 'es' : ''}</p>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
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
      ) : vacaciones.length === 0 ? (
        <div className="text-center py-16">
          <Palmtree className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-muted-foreground">No hay solicitudes de vacaciones</p>
        </div>
      ) : (
        <div className="space-y-2">
          {vacaciones.map((v) => (
            <div key={v.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Calendar className="h-4 w-4 text-primary" />
                    <span className="font-medium text-sm">
                      {new Date(v.fechaInicio).toLocaleDateString('es-AR')} — {new Date(v.fechaFin).toLocaleDateString('es-AR')}
                    </span>
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_STYLES[v.estado])}>
                      {v.estado === 'EN_REVISION' ? 'En Revisión' : v.estado.charAt(0) + v.estado.slice(1).toLowerCase()}
                    </span>
                    <span className="text-xs text-muted-foreground">{v.diasTotales} día{v.diasTotales !== 1 ? 's' : ''} corridos</span>
                  </div>
                  {v.motivo && <p className="text-xs text-muted-foreground">{v.motivo}</p>}
                  {v.obsRechazo && <p className="text-xs text-red-400 flex items-center gap-1"><XCircle className="h-3 w-3" /> {v.obsRechazo}</p>}
                </div>
                <div className="flex gap-2">
                  {v.estado === 'BORRADOR' && (
                    <button
                      onClick={() => enviarMutation.mutate(v.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors"
                    >
                      <Send className="h-3 w-3" /> Enviar
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showForm && (
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
      await api.post('/vacaciones', {
        fechaInicio: startDate.toISOString(),
        fechaFin: endDate.toISOString(),
        diasHabiles: diasTotales, // backend field, but we send total calendar days
        motivo: motivo || undefined,
      });
      onSuccess();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } };
        setError(axiosErr.response?.data?.error ?? 'Error al crear');
      }
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
