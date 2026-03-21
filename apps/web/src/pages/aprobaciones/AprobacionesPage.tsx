import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import {
  CheckCircle2, XCircle, Loader2, Clock, Palmtree, Calendar,
  History, AlertCircle, ChevronRight, X, Send, AlertTriangle
} from 'lucide-react';

// ─── Types ───────────────────────────────────────
interface PlanillaItem {
  id: string;
  periodoInicio: string;
  periodoFin: string;
  estado: string;
  enviadaAt: string | null;
  usuario: { id: string; nombre: string; apellido: string; legajo: string | null; rol: string; sector?: { nombre: string } | null };
}

interface VacacionItem {
  id: string;
  fechaInicio: string;
  fechaFin: string;
  diasTotales: number;
  estado: string;
  motivo: string | null;
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

interface AprobacionesData {
  planillasPendientes: PlanillaItem[];
  vacacionesPendientes: VacacionItem[];
  ausenciasPendientes: AusenciaItem[];
  compensatoriosPendientes: CompensatorioItem[];
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
  const [tab, setTab] = useState<'planillas' | 'vacaciones' | 'ausencias' | 'compensatorios' | 'historial'>('planillas');
  const [rechazandoId, setRechazandoId] = useState<string | null>(null);
  const [rechazandoTipo, setRechazandoTipo] = useState<'planilla' | 'vacacion' | 'ausencia'>('planilla');
  const [motivoRechazo, setMotivoRechazo] = useState('');

  const { data, isLoading, refetch } = useQuery<AprobacionesData>({
    queryKey: ['aprobaciones'],
    queryFn: () => api.get('/aprobaciones').then(r => r.data),
    refetchInterval: 30000, // auto-refresh every 30s
  });

  const aprobarPlanillaMutation = useMutation({
    mutationFn: (id: string) => api.post(`/planillas/${id}/avanzar`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['aprobaciones'] }); },
  });

  const rechazarPlanillaMutation = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      api.post(`/planillas/${id}/rechazar`, { motivo }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['aprobaciones'] }); setRechazandoId(null); setMotivoRechazo(''); },
  });

  const aprobarVacacionMutation = useMutation({
    mutationFn: (id: string) => api.post(`/vacaciones/${id}/avanzar`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['aprobaciones'] }); },
  });

  const rechazarVacacionMutation = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      api.post(`/vacaciones/${id}/rechazar`, { motivo }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['aprobaciones'] }); setRechazandoId(null); setMotivoRechazo(''); },
  });

  const aprobarAusenciaMutation = useMutation({
    mutationFn: (id: string) => api.post(`/ausencias/${id}/avanzar`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['aprobaciones'] }); },
  });

  const rechazarAusenciaMutation = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      api.post(`/ausencias/${id}/rechazar`, { motivo }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['aprobaciones'] }); setRechazandoId(null); setMotivoRechazo(''); },
  });

  const planillasPendienteCount = data?.planillasPendientes.length ?? 0;
  const vacacionesPendienteCount = data?.vacacionesPendientes.length ?? 0;
  const ausenciasPendienteCount = data?.ausenciasPendientes?.length ?? 0;
  const compensatoriosPendienteCount = data?.compensatoriosPendientes?.length ?? 0;
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

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/20 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('planillas')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all',
            tab === 'planillas' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Clock className="h-4 w-4" /> Planillas
          {planillasPendienteCount > 0 && (
            <span className="bg-primary text-primary-foreground rounded-full text-xs px-1.5 min-w-[20px] text-center">
              {planillasPendienteCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('vacaciones')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all',
            tab === 'vacaciones' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Palmtree className="h-4 w-4" /> Vacaciones
          {vacacionesPendienteCount > 0 && (
            <span className="bg-primary text-primary-foreground rounded-full text-xs px-1.5 min-w-[20px] text-center">
              {vacacionesPendienteCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('ausencias')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all',
            tab === 'ausencias' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <AlertTriangle className="h-4 w-4" /> Ausencias
          {ausenciasPendienteCount > 0 && (
            <span className="bg-primary text-primary-foreground rounded-full text-xs px-1.5 min-w-[20px] text-center">
              {ausenciasPendienteCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('compensatorios')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all',
            tab === 'compensatorios' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Calendar className="h-4 w-4" /> Compensatorios
          {compensatoriosPendienteCount > 0 && (
            <span className="bg-primary text-primary-foreground rounded-full text-xs px-1.5 min-w-[20px] text-center">
              {compensatoriosPendienteCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('historial')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all',
            tab === 'historial' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <History className="h-4 w-4" /> Historial
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : tab === 'planillas' ? (
        <div className="space-y-4">
          {/* Planillas */}
          {(data?.planillasPendientes.length ?? 0) > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-blue-400" />
                <h2 className="text-sm font-semibold text-foreground">Planillas de horas</h2>
                <span className="text-xs text-muted-foreground">({data!.planillasPendientes.length})</span>
              </div>
              <div className="space-y-2">
                {data!.planillasPendientes.map((p) => (
                  <div key={p.id} className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-medium text-sm">{p.usuario.apellido}, {p.usuario.nombre}</span>
                        <span className="text-xs text-muted-foreground">{p.usuario.sector?.nombre ?? p.usuario.rol}</span>
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_STYLES[p.estado])}>
                          {p.estado === 'EN_REVISION' ? 'En revisión' : p.estado.charAt(0) + p.estado.slice(1).toLowerCase()}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(p.periodoInicio).toLocaleDateString('es-AR')} — {new Date(p.periodoFin).toLocaleDateString('es-AR')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => navigate(`/planillas/${p.id}`)}
                        className="p-2 rounded-lg hover:bg-accent text-muted-foreground"
                        title="Ver planilla"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => aprobarPlanillaMutation.mutate(p.id)}
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
          {(data?.vacacionesPendientes ?? []).map((v) => (
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
                  onClick={() => aprobarVacacionMutation.mutate(v.id)}
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
          {(data?.ausenciasPendientes ?? []).map((a) => (
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
                  onClick={() => aprobarAusenciaMutation.mutate(a.id)}
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
          {(data?.compensatoriosPendientes ?? []).length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-4 w-4 text-purple-400" />
                <h2 className="text-sm font-semibold text-foreground">Días compensatorios pendientes</h2>
                <span className="text-xs text-muted-foreground">({data!.compensatoriosPendientes.length})</span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Los compensatorios se aprueban junto con su planilla. Esta vista es informativa.
              </p>
              <div className="space-y-2">
                {data!.compensatoriosPendientes.map((c) => (
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
      ) : (
        <div className="space-y-4">
          {/* Planillas historial */}
          {(data?.historial.planillas.length ?? 0) > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Planillas recientes</h2>
              </div>
              <div className="space-y-1.5">
                {data!.historial.planillas.map((p) => (
                  <div key={p.id}
                    onClick={() => navigate(`/planillas/${p.id}`)}
                    className="rounded-lg border border-border bg-card/50 p-3 flex items-center gap-3 cursor-pointer hover:bg-muted/10 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{p.usuario.apellido}, {p.usuario.nombre}</span>
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_STYLES[p.estado])}>
                          {p.estado === 'EN_REVISION' ? 'En revisión' : p.estado.charAt(0) + p.estado.slice(1).toLowerCase()}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(p.periodoInicio).toLocaleDateString('es-AR')} — {new Date(p.periodoFin).toLocaleDateString('es-AR')}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Vacaciones historial */}
          {(data?.historial.vacaciones.length ?? 0) > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Palmtree className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Vacaciones recientes</h2>
              </div>
              <div className="space-y-1.5">
                {data!.historial.vacaciones.map((v) => (
                  <div key={v.id} className="rounded-lg border border-border bg-card/50 p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{v.usuario.apellido}, {v.usuario.nombre}</span>
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_STYLES[v.estado])}>
                          {v.estado.charAt(0) + v.estado.slice(1).toLowerCase()}
                        </span>
                        <span className="text-xs text-muted-foreground">{v.diasTotales}d</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(v.fechaInicio).toLocaleDateString('es-AR')} — {new Date(v.fechaFin).toLocaleDateString('es-AR')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Ausencias historial */}
          {(data?.historial.ausencias?.length ?? 0) > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Ausencias recientes</h2>
              </div>
              <div className="space-y-1.5">
                {data!.historial.ausencias.map((a) => (
                  <div key={a.id} className="rounded-lg border border-border bg-card/50 p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{a.usuario.apellido}, {a.usuario.nombre}</span>
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_STYLES[a.estado])}>
                          {a.estado.charAt(0) + a.estado.slice(1).toLowerCase()}
                        </span>
                        <span className="text-xs text-muted-foreground">{a.diasAusencia}d</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(a.fechaInicio).toLocaleDateString('es-AR')} — {new Date(a.fechaFin).toLocaleDateString('es-AR')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {((data?.historial.planillas.length ?? 0) + (data?.historial.vacaciones.length ?? 0) + (data?.historial.ausencias?.length ?? 0)) === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <History className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Sin historial todavía</p>
            </div>
          )}
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
