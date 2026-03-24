import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { DIAGRAMA_CARD_BG } from '@/constants/planillaConstants';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import {
  CheckCircle2, XCircle, Loader2, Clock, Palmtree, Calendar,
  History, AlertCircle, ChevronRight, X, Send, AlertTriangle, Filter, UserX
} from 'lucide-react';
import PeriodSelector, { getCurrentPeriod } from '@/components/layout/PeriodSelector';
import ScopeToggle from '@/components/layout/ScopeToggle';

// ─── Types ───────────────────────────────────────
interface PlanillaItem {
  id: string;
  periodoInicio: string;
  periodoFin: string;
  estado: string;
  enviadaAt: string | null;
  obsRechazo?: string | null;
  usuario: { id: string; nombre: string; apellido: string; legajo: string | null; rol: string; sector?: { nombre: string } | null };
}

interface VacacionItem {
  id: string;
  fechaInicio: string;
  fechaFin: string;
  diasTotales: number;
  estado: string;
  motivo: string | null;
  obsRechazo?: string | null;
  createdAt: string;
  usuario: { id: string; nombre: string; apellido: string; legajo: string | null; rol: string; sector?: { nombre: string } | null };
}

interface AusenciaItem {
  id: string;
  tipo: string;
  fechaInicio: string;
  fechaFin: string;
  diasAusencia: number;
  estado: string;
  descripcion: string | null;
  obsRechazo?: string | null;
  usuario: { id: string; nombre: string; apellido: string; legajo: string | null; rol: string; sector?: { nombre: string } | null };
}

interface CompensatorioItem {
  id: string;
  fecha: string;
  observaciones: string | null;
  planilla: {
    id: string;
    periodoInicio: string;
    periodoFin: string;
    estado: string;
    usuario: { id: string; nombre: string; apellido: string; legajo: string | null; rol: string; sector?: { nombre: string } | null };
  };
}

interface FaltanteItem {
  usuario: { id: string; nombre: string; apellido: string; legajo: string | null; rol: string; diagramaColor?: string | null; sector?: { id: string; nombre: string } | null };
  planillaId: string | null;
  estado: string; // 'SIN_PLANILLA' | 'BORRADOR' | 'RECHAZADA'
}

interface FaltantesPeriodo {
  label: string;
  periodoInicio: string;
  periodoFin: string;
  items: FaltanteItem[];
}

interface AprobacionesData {
  planillasPendientes: PlanillaItem[];
  vacacionesPendientes: VacacionItem[];
  ausenciasPendientes: AusenciaItem[];
  compensatoriosPendientes: CompensatorioItem[];
  faltantes: { actual: FaltantesPeriodo | null; anterior: FaltantesPeriodo | null };
  historial: {
    planillas: PlanillaItem[];
    vacaciones: VacacionItem[];
    ausencias: AusenciaItem[];
  };
}

const ESTADO_STYLES: Record<string, string> = {
  ENVIADA: 'bg-blue-500/20 text-blue-400',
  EN_REVISION: 'bg-amber-500/20 text-amber-400',
  PENDIENTE: 'bg-blue-500/20 text-blue-400',
  APROBADA: 'bg-emerald-500/20 text-emerald-400',
  RECHAZADA: 'bg-red-500/20 text-red-400',
  CERRADA: 'bg-muted/30 text-muted-foreground',
  BORRADOR: 'bg-muted/30 text-muted-foreground',
};

export default function AprobacionesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<'planillas' | 'vacaciones' | 'ausencias' | 'compensatorios' | 'faltantes' | 'historial'>('planillas');
  const [rechazandoId, setRechazandoId] = useState<string | null>(null);
  const [rechazandoTipo, setRechazandoTipo] = useState<'planilla' | 'vacacion' | 'ausencia'>('planilla');
  const [motivoRechazo, setMotivoRechazo] = useState('');
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [confirmandoTipo, setConfirmandoTipo] = useState<'planilla' | 'vacacion' | 'ausencia'>('planilla');
  const [confirmandoNombre, setConfirmandoNombre] = useState('');
  const [confirmandoChecked, setConfirmandoChecked] = useState(false);
  const [filterSector, setFilterSector] = useState('');
  const [periodo, setPeriodo] = useState(getCurrentPeriod());
  const [scope, setScope] = useState<'mio' | 'equipo'>('equipo');
  const [faltantesPeriodoTab, setFaltantesPeriodoTab] = useState<'actual' | 'anterior'>('actual');
  const isRRHH = ['RRHH', 'ADMIN'].includes(user?.rol ?? '');
  const showScopeToggle = (user?.rolNivel ?? 0) >= 60 && !isRRHH;

  interface Sector { id: string; nombre: string; }
  const { data: sectores = [] } = useQuery<Sector[]>({
    queryKey: ['sectores-aprobaciones'],
    queryFn: async () => (await api.get('/analytics/sectores')).data,
  });

  const { data, isLoading, refetch } = useQuery<AprobacionesData>({
    queryKey: ['aprobaciones', periodo.inicio, periodo.fin, scope],
    queryFn: () => {
      const params = new URLSearchParams({ periodoInicio: periodo.inicio, periodoFin: periodo.fin });
      if (showScopeToggle && scope === 'mio') params.set('scope', 'mio');
      return api.get(`/aprobaciones?${params.toString()}`).then(r => r.data);
    },
    refetchInterval: 30000,
  });

  const filterBySector = <T extends { usuario: { sector?: { nombre: string } | null } }>(items: T[]) =>
    filterSector ? items.filter(i => i.usuario.sector?.nombre === filterSector) : items;

  const filterCompBySector = (items: CompensatorioItem[]) =>
    filterSector ? items.filter(i => i.planilla.usuario.sector?.nombre === filterSector) : items;

  const filteredPlanillas = filterBySector(data?.planillasPendientes ?? []);
  const filteredVacaciones = filterBySector(data?.vacacionesPendientes ?? []);
  const filteredAusencias = filterBySector(data?.ausenciasPendientes ?? []);
  const filteredCompensatorios = filterCompBySector(data?.compensatoriosPendientes ?? []);
  const filteredHistPlanillas = filterBySector(data?.historial.planillas ?? []);
  const filteredHistVacaciones = filterBySector(data?.historial.vacaciones ?? []);
  const filteredHistAusencias = filterBySector(data?.historial.ausencias ?? []);

  const filterFaltantesPeriodo = (p: FaltantesPeriodo | null | undefined): FaltantesPeriodo | null => {
    if (!p) return null;
    const items = filterSector ? p.items.filter(f => f.usuario.sector?.nombre === filterSector) : p.items;
    return { ...p, items };
  };
  const faltantesActual = filterFaltantesPeriodo(data?.faltantes?.actual);
  const faltantesAnterior = filterFaltantesPeriodo(data?.faltantes?.anterior);
  const faltantesActualCount = faltantesActual?.items.length ?? 0;
  const faltantesAnteriorCount = faltantesAnterior?.items.length ?? 0;
  const faltantesCount = faltantesActualCount + faltantesAnteriorCount;

  const aprobarPlanillaMutation = useMutation({
    mutationFn: (id: string) => api.post(`/planillas/${id}/avanzar`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['aprobaciones'] }); setConfirmandoId(null); toast({ title: 'Planilla aprobada', variant: 'success' }); },
    onError: () => { toast({ title: 'Error al aprobar planilla', variant: 'destructive' }); },
  });

  const rechazarPlanillaMutation = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      api.post(`/planillas/${id}/rechazar`, { motivo }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['aprobaciones'] }); setRechazandoId(null); setMotivoRechazo(''); toast({ title: 'Planilla rechazada', variant: 'success' }); },
    onError: () => { toast({ title: 'Error al rechazar planilla', variant: 'destructive' }); },
  });

  const aprobarVacacionMutation = useMutation({
    mutationFn: (id: string) => api.post(`/vacaciones/${id}/avanzar`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['aprobaciones'] }); setConfirmandoId(null); toast({ title: 'Vacación aprobada', variant: 'success' }); },
    onError: () => { toast({ title: 'Error al aprobar vacación', variant: 'destructive' }); },
  });

  const rechazarVacacionMutation = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      api.post(`/vacaciones/${id}/rechazar`, { motivo }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['aprobaciones'] }); setRechazandoId(null); setMotivoRechazo(''); toast({ title: 'Vacación rechazada', variant: 'success' }); },
    onError: () => { toast({ title: 'Error al rechazar vacación', variant: 'destructive' }); },
  });

  const aprobarAusenciaMutation = useMutation({
    mutationFn: (id: string) => api.post(`/ausencias/${id}/avanzar`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['aprobaciones'] }); setConfirmandoId(null); toast({ title: 'Ausencia aprobada', variant: 'success' }); },
    onError: () => { toast({ title: 'Error al aprobar ausencia', variant: 'destructive' }); },
  });

  const rechazarAusenciaMutation = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      api.post(`/ausencias/${id}/rechazar`, { motivo }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['aprobaciones'] }); setRechazandoId(null); setMotivoRechazo(''); toast({ title: 'Ausencia rechazada', variant: 'success' }); },
    onError: () => { toast({ title: 'Error al rechazar ausencia', variant: 'destructive' }); },
  });

  const planillasPendienteCount = filteredPlanillas.length;
  const vacacionesPendienteCount = filteredVacaciones.length;
  const ausenciasPendienteCount = filteredAusencias.length;
  const compensatoriosPendienteCount = filteredCompensatorios.length;
  const pendingTotal = planillasPendienteCount + vacacionesPendienteCount + ausenciasPendienteCount + compensatoriosPendienteCount;

  if ((user?.rolNivel ?? 0) < 60) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <AlertCircle className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p>No tenés permisos para ver aprobaciones.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Aprobaciones</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? 'Cargando...' : `${pendingTotal} pendiente${pendingTotal !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button onClick={() => refetch()} className="p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
          <Loader2 className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <PeriodSelector value={periodo} onChange={setPeriodo} />
        {showScopeToggle && <ScopeToggle value={scope} onChange={setScope} />}
        {sectores.length > 0 && (
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select
            className="h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm"
            value={filterSector}
            onChange={(e) => setFilterSector(e.target.value)}
          >
            <option value="">Todos los sectores</option>
            {sectores.map((s) => (
              <option key={s.id} value={s.nombre}>{s.nombre}</option>
            ))}
          </select>
        </div>
      )}
      </div>

      {/* Tabs */}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-1 bg-muted/20 rounded-lg p-1 w-fit">
          <button
            onClick={() => setTab('planillas')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap',
              tab === 'planillas' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Clock className="h-4 w-4 hidden sm:block" /> Planillas
            {planillasPendienteCount > 0 && (
              <span className="bg-primary text-primary-foreground rounded-full text-xs px-1.5 min-w-[20px] text-center">
                {planillasPendienteCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('vacaciones')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap',
              tab === 'vacaciones' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Palmtree className="h-4 w-4 hidden sm:block" /> Vac.
            {vacacionesPendienteCount > 0 && (
              <span className="bg-primary text-primary-foreground rounded-full text-xs px-1.5 min-w-[20px] text-center">
                {vacacionesPendienteCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('ausencias')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap',
              tab === 'ausencias' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <AlertTriangle className="h-4 w-4 hidden sm:block" /> Aus.
            {ausenciasPendienteCount > 0 && (
              <span className="bg-primary text-primary-foreground rounded-full text-xs px-1.5 min-w-[20px] text-center">
                {ausenciasPendienteCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('compensatorios')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap',
              tab === 'compensatorios' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Calendar className="h-4 w-4 hidden sm:block" /> Comp.
            {compensatoriosPendienteCount > 0 && (
              <span className="bg-primary text-primary-foreground rounded-full text-xs px-1.5 min-w-[20px] text-center">
                {compensatoriosPendienteCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('faltantes')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap',
              tab === 'faltantes' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <UserX className="h-4 w-4 hidden sm:block" /> Faltantes
            {faltantesCount > 0 && (
              <span className="bg-destructive text-destructive-foreground rounded-full text-xs px-1.5 min-w-[20px] text-center">
                {faltantesCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('historial')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap',
              tab === 'historial' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <History className="h-4 w-4 hidden sm:block" /> Historial
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : tab === 'planillas' ? (
        <div className="space-y-4">
          {/* Planillas */}
          {filteredPlanillas.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-blue-400" />
                <h2 className="text-sm font-semibold text-foreground">Planillas de horas</h2>
                <span className="text-xs text-muted-foreground">({filteredPlanillas.length})</span>
              </div>
              <div className="space-y-2">
                {filteredPlanillas.map((p) => (
                  <div key={p.id} className="rounded-xl border border-border bg-card p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-medium text-sm truncate">{p.usuario.apellido}, {p.usuario.nombre}</span>
                        <span className="text-xs text-muted-foreground">{p.usuario.sector?.nombre ?? p.usuario.rol}</span>
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_STYLES[p.estado])}>
                          {p.estado === 'EN_REVISION' ? 'En revisión' : p.estado.charAt(0) + p.estado.slice(1).toLowerCase()}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(p.periodoInicio).toLocaleDateString('es-AR')} — {new Date(p.periodoFin).toLocaleDateString('es-AR')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => navigate(`/planillas/${p.id}`)}
                        className="p-2 rounded-lg hover:bg-accent text-muted-foreground"
                        title="Ver planilla"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => { setConfirmandoId(p.id); setConfirmandoTipo('planilla'); setConfirmandoNombre(`${p.usuario.apellido}, ${p.usuario.nombre}`); }}
                        disabled={aprobarPlanillaMutation.isPending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Aprobar
                      </button>
                      <button
                        onClick={() => { setRechazandoId(p.id); setRechazandoTipo('planilla'); setMotivoRechazo(''); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/10 transition-colors"
                      >
                        <X className="h-3.5 w-3.5" /> Rechazar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {planillasPendienteCount === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <CheckCircle2 className="h-10 w-10 mx-auto mb-3 opacity-30 text-emerald-400" />
              <p className="text-sm">No hay planillas pendientes de aprobación</p>
            </div>
          )}
        </div>
      ) : tab === 'vacaciones' ? (
        <div className="space-y-4">
          {filteredVacaciones.map((v) => (
            <div key={v.id} className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-medium text-sm">{v.usuario.apellido}, {v.usuario.nombre}</span>
                  <span className="text-xs text-muted-foreground">{v.usuario.sector?.nombre ?? v.usuario.rol}</span>
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_STYLES[v.estado])}>
                    {v.estado === 'EN_REVISION' ? 'En revisión' : v.estado.charAt(0) + v.estado.slice(1).toLowerCase()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(v.fechaInicio).toLocaleDateString('es-AR')} — {new Date(v.fechaFin).toLocaleDateString('es-AR')}
                  {' · '}<span className="font-medium">{v.diasTotales} días corridos</span>
                </p>
                {v.motivo && <p className="text-xs text-muted-foreground mt-0.5">«{v.motivo}»</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => { setConfirmandoId(v.id); setConfirmandoTipo('vacacion'); setConfirmandoNombre(`${v.usuario.apellido}, ${v.usuario.nombre}`); }}
                  disabled={aprobarVacacionMutation.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Aprobar
                </button>
                <button
                  onClick={() => { setRechazandoId(v.id); setRechazandoTipo('vacacion'); setMotivoRechazo(''); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/10 transition-colors"
                >
                  <X className="h-3.5 w-3.5" /> Rechazar
                </button>
              </div>
            </div>
          ))}
          {vacacionesPendienteCount === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Palmtree className="h-10 w-10 mx-auto mb-3 opacity-30 text-emerald-400" />
              <p className="text-sm">No hay solicitudes de vacaciones pendientes</p>
            </div>
          )}
        </div>
      ) : tab === 'ausencias' ? (
        <div className="space-y-4">
          {filteredAusencias.map((a) => (
            <div key={a.id} className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-medium text-sm">{a.usuario.apellido}, {a.usuario.nombre}</span>
                  <span className="text-xs text-muted-foreground">{a.usuario.sector?.nombre ?? a.usuario.rol}</span>
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_STYLES[a.estado])}>
                    {a.estado === 'EN_REVISION' ? 'En revisión' : a.estado.charAt(0) + a.estado.slice(1).toLowerCase()}
                  </span>
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium',
                    a.tipo === 'CERTIFICADO_MEDICO' ? 'bg-blue-500/20 text-blue-400' :
                    a.tipo === 'FALTA_JUSTIFICADA' ? 'bg-amber-500/20 text-amber-400' :
                    a.tipo === 'FALTA_INJUSTIFICADA' ? 'bg-red-500/20 text-red-400' :
                    'bg-purple-500/20 text-purple-400'
                  )}>
                    {a.tipo.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(a.fechaInicio).toLocaleDateString('es-AR')} — {new Date(a.fechaFin).toLocaleDateString('es-AR')}
                  {' · '}<span className="font-medium">{a.diasAusencia} día{a.diasAusencia !== 1 ? 's' : ''}</span>
                </p>
                {a.descripcion && <p className="text-xs text-muted-foreground mt-0.5">«{a.descripcion}»</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => { setConfirmandoId(a.id); setConfirmandoTipo('ausencia'); setConfirmandoNombre(`${a.usuario.apellido}, ${a.usuario.nombre}`); }}
                  disabled={aprobarAusenciaMutation.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Aprobar
                </button>
                <button
                  onClick={() => { setRechazandoId(a.id); setRechazandoTipo('ausencia'); setMotivoRechazo(''); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/10 transition-colors"
                >
                  <X className="h-3.5 w-3.5" /> Rechazar
                </button>
              </div>
            </div>
          ))}
          {ausenciasPendienteCount === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <AlertTriangle className="h-10 w-10 mx-auto mb-3 opacity-30 text-amber-400" />
              <p className="text-sm">No hay ausencias pendientes de aprobación</p>
            </div>
          )}
        </div>
      ) : tab === 'compensatorios' ? (
        <div className="space-y-4">
          {filteredCompensatorios.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-4 w-4 text-purple-400" />
                <h2 className="text-sm font-semibold text-foreground">Días compensatorios pendientes</h2>
                <span className="text-xs text-muted-foreground">({filteredCompensatorios.length})</span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Los compensatorios se aprueban junto con su planilla. Esta vista es informativa.
              </p>
              <div className="space-y-2">
                {filteredCompensatorios.map((c) => (
                  <div key={c.id} className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-medium text-sm">{c.planilla.usuario.apellido}, {c.planilla.usuario.nombre}</span>
                        <span className="text-xs text-muted-foreground">{c.planilla.usuario.sector?.nombre ?? c.planilla.usuario.rol}</span>
                        {c.planilla.usuario.legajo && (
                          <span className="text-xs text-muted-foreground">#{c.planilla.usuario.legajo}</span>
                        )}
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_STYLES[c.planilla.estado])}>
                          {c.planilla.estado === 'EN_REVISION' ? 'En revisión' : c.planilla.estado.charAt(0) + c.planilla.estado.slice(1).toLowerCase()}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Franco compensatorio: <span className="font-medium">{new Date(c.fecha).toLocaleDateString('es-AR')}</span>
                      </p>
                      {c.observaciones && <p className="text-xs text-muted-foreground mt-0.5">«{c.observaciones}»</p>}
                    </div>
                    <button
                      onClick={() => navigate(`/planillas/${c.planilla.id}`)}
                      className="p-2 rounded-lg hover:bg-accent text-muted-foreground shrink-0"
                      title="Ver planilla"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {compensatoriosPendienteCount === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30 text-purple-400" />
              <p className="text-sm">No hay compensatorios pendientes</p>
            </div>
          )}
        </div>
      ) : tab === 'faltantes' ? (
        <div className="space-y-4">
          {/* Period sub-toggle */}
          <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-1 w-fit">
            <button
              onClick={() => setFaltantesPeriodoTab('actual')}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                faltantesPeriodoTab === 'actual' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Actual {faltantesActualCount > 0 && <span className="ml-1 text-destructive">({faltantesActualCount})</span>}
            </button>
            <button
              onClick={() => setFaltantesPeriodoTab('anterior')}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                faltantesPeriodoTab === 'anterior' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Anterior {faltantesAnteriorCount > 0 && <span className="ml-1 text-destructive">({faltantesAnteriorCount})</span>}
            </button>
          </div>

          {(() => {
            const periodo = faltantesPeriodoTab === 'actual' ? faltantesActual : faltantesAnterior;
            const titulo = faltantesPeriodoTab === 'actual' ? 'Período actual' : 'Período anterior';
            return (
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <UserX className="h-4 w-4 text-destructive" />
                  <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
                  {periodo && (
                    <span className="text-xs text-muted-foreground">
                      {periodo.label} · {periodo.items.length} faltante{periodo.items.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {periodo && periodo.items.length > 0 ? (
                  <div className="space-y-2">
                    {periodo.items.map((f) => (
                      <div key={f.usuario.id} className={cn(
                        'rounded-xl border p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4',
                        f.usuario.diagramaColor && DIAGRAMA_CARD_BG[f.usuario.diagramaColor]
                          ? DIAGRAMA_CARD_BG[f.usuario.diagramaColor]
                          : 'border-border bg-card',
                      )}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className="font-medium text-sm truncate">{f.usuario.apellido}, {f.usuario.nombre}</span>
                            {f.usuario.legajo && <span className="text-xs text-muted-foreground">#{f.usuario.legajo}</span>}
                            <span className="text-xs text-muted-foreground">{f.usuario.sector?.nombre ?? f.usuario.rol}</span>
                            <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium',
                              f.estado === 'SIN_PLANILLA' ? 'bg-muted/40 text-muted-foreground' :
                              f.estado === 'RECHAZADA' ? 'bg-red-500/20 text-red-400' :
                              'bg-muted/30 text-muted-foreground'
                            )}>
                              {f.estado === 'SIN_PLANILLA' ? 'Sin planilla' :
                               f.estado === 'RECHAZADA' ? 'Rechazada' : 'Borrador'}
                            </span>
                          </div>
                        </div>
                        {f.planillaId && (
                          <button
                            onClick={() => navigate(`/planillas/${f.planillaId}`)}
                            className="p-2 rounded-lg hover:bg-accent text-muted-foreground shrink-0"
                            title="Ver planilla"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground border border-dashed border-border rounded-xl">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-30 text-emerald-400" />
                    <p className="text-xs">Todos enviaron su planilla</p>
                  </div>
                )}
              </section>
            );
          })()}
        </div>
      ) : tab === 'historial' ? (
        <div className="space-y-4">
          {/* Planillas historial */}
          {filteredHistPlanillas.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Planillas recientes</h2>
              </div>
              <div className="space-y-1.5">
                {filteredHistPlanillas.map((p) => (
                  <div key={p.id}
                    onClick={() => navigate(`/planillas/${p.id}`)}
                    className="rounded-lg border border-border bg-card/50 p-3 flex items-center gap-3 cursor-pointer hover:bg-muted/10 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{p.usuario.apellido}, {p.usuario.nombre}</span>
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_STYLES[p.estado])}>
                          {p.estado === 'EN_REVISION' ? 'En revisión' : p.estado.charAt(0) + p.estado.slice(1).toLowerCase()}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(p.periodoInicio).toLocaleDateString('es-AR')} — {new Date(p.periodoFin).toLocaleDateString('es-AR')}
                      </p>
                      {p.obsRechazo && p.estado === 'RECHAZADA' && (
                        <p className="text-xs text-red-400 flex items-center gap-1 mt-0.5">
                          <XCircle className="h-3 w-3 shrink-0" /> {p.obsRechazo}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Vacaciones historial */}
          {filteredHistVacaciones.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Palmtree className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Vacaciones recientes</h2>
              </div>
              <div className="space-y-1.5">
                {filteredHistVacaciones.map((v) => (
                  <div key={v.id} className="rounded-lg border border-border bg-card/50 p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{v.usuario.apellido}, {v.usuario.nombre}</span>
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_STYLES[v.estado])}>
                          {v.estado.charAt(0) + v.estado.slice(1).toLowerCase()}
                        </span>
                        <span className="text-xs text-muted-foreground">{v.diasTotales}d</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(v.fechaInicio).toLocaleDateString('es-AR')} — {new Date(v.fechaFin).toLocaleDateString('es-AR')}
                      </p>
                      {v.obsRechazo && v.estado === 'RECHAZADA' && (
                        <p className="text-xs text-red-400 flex items-center gap-1 mt-0.5">
                          <XCircle className="h-3 w-3 shrink-0" /> {v.obsRechazo}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Ausencias historial */}
          {filteredHistAusencias.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Ausencias recientes</h2>
              </div>
              <div className="space-y-1.5">
                {filteredHistAusencias.map((a) => (
                  <div key={a.id} className="rounded-lg border border-border bg-card/50 p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{a.usuario.apellido}, {a.usuario.nombre}</span>
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_STYLES[a.estado])}>
                          {a.estado.charAt(0) + a.estado.slice(1).toLowerCase()}
                        </span>
                        <span className="text-xs text-muted-foreground">{a.diasAusencia}d</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(a.fechaInicio).toLocaleDateString('es-AR')} — {new Date(a.fechaFin).toLocaleDateString('es-AR')}
                      </p>
                      {a.obsRechazo && a.estado === 'RECHAZADA' && (
                        <p className="text-xs text-red-400 flex items-center gap-1 mt-0.5">
                          <XCircle className="h-3 w-3 shrink-0" /> {a.obsRechazo}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(filteredHistPlanillas.length + filteredHistVacaciones.length + filteredHistAusencias.length) === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <History className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Sin historial todavía</p>
            </div>
          )}
        </div>
      ) : null}

      {/* Confirmación de aprobación */}
      {confirmandoId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                Confirmar aprobación
              </h3>
              <button onClick={() => { setConfirmandoId(null); setConfirmandoChecked(false); }} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-sm text-muted-foreground">
              ¿Estás seguro de que querés aprobar {confirmandoTipo === 'planilla' ? 'la planilla' : confirmandoTipo === 'vacacion' ? 'la solicitud de vacaciones' : 'la ausencia'} de <span className="font-medium text-foreground">{confirmandoNombre}</span>?
            </p>
            {confirmandoTipo === 'planilla' && (
              <p className="text-xs text-muted-foreground">
                Una vez aprobada, la planilla no podrá ser editada por el empleado.
              </p>
            )}
            <label className="flex items-start gap-3 cursor-pointer select-none p-3 rounded-lg border border-border hover:bg-muted/20 transition-colors">
              <input
                type="checkbox"
                checked={confirmandoChecked}
                onChange={(e) => setConfirmandoChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border accent-emerald-500"
              />
              <span className="text-sm font-medium">
                Confirmo que revisé {confirmandoTipo === 'planilla' ? 'la planilla' : confirmandoTipo === 'vacacion' ? 'la solicitud' : 'la ausencia'} y es correcta
              </span>
            </label>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setConfirmandoId(null); setConfirmandoChecked(false); }}
                className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent">
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (confirmandoTipo === 'planilla') {
                    aprobarPlanillaMutation.mutate(confirmandoId);
                  } else if (confirmandoTipo === 'vacacion') {
                    aprobarVacacionMutation.mutate(confirmandoId);
                  } else {
                    aprobarAusenciaMutation.mutate(confirmandoId);
                  }
                }}
                disabled={!confirmandoChecked || aprobarPlanillaMutation.isPending || aprobarVacacionMutation.isPending || aprobarAusenciaMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {(aprobarPlanillaMutation.isPending || aprobarVacacionMutation.isPending || aprobarAusenciaMutation.isPending)
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <CheckCircle2 className="h-4 w-4" />}
                Aprobar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rechazo modal */}
      {rechazandoId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-400" />
                Motivo de rechazo
              </h3>
              <button onClick={() => setRechazandoId(null)} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>
            <textarea
              value={motivoRechazo}
              onChange={(e) => setMotivoRechazo(e.target.value)}
              rows={3}
              placeholder="Describí el motivo..."
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-foreground text-sm resize-none"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRechazandoId(null)}
                className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent">
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (!motivoRechazo.trim()) return;
                  if (rechazandoTipo === 'planilla') {
                    rechazarPlanillaMutation.mutate({ id: rechazandoId, motivo: motivoRechazo });
                  } else if (rechazandoTipo === 'vacacion') {
                    rechazarVacacionMutation.mutate({ id: rechazandoId, motivo: motivoRechazo });
                  } else {
                    rechazarAusenciaMutation.mutate({ id: rechazandoId, motivo: motivoRechazo });
                  }
                }}
                disabled={!motivoRechazo.trim() || rechazarPlanillaMutation.isPending || rechazarVacacionMutation.isPending || rechazarAusenciaMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {(rechazarPlanillaMutation.isPending || rechazarVacacionMutation.isPending || rechazarAusenciaMutation.isPending)
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Send className="h-4 w-4" />}
                Rechazar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
