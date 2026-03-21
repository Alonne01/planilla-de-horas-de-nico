import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import {
  BarChart3, TrendingUp, Users, MapPin,
  Loader2, Clock, Palmtree, AlertTriangle
} from 'lucide-react';

interface EmpresaAnalytics {
  totalUsuarios: number;
  totals: {
    horasNormales: number;
    horasExtra50: number;
    horasExtra100: number;
    horasViaje: number;
    diasCampo: number;
    diasBase: number;
    planillas: number;
  };
  estadosPlanilla: { estado: string; count: number }[];
  sectorBreakdown: {
    id: string;
    nombre: string;
    usuarios: number;
    horasNormales: number;
    horasExtra50: number;
    horasExtra100: number;
    planillas: number;
  }[];
  ausencias: { tipo: string; dias: number; count: number }[];
  vacacionesPendientes: number;
}

interface UsuarioAnalytics {
  usuario: { id: string; nombre: string; apellido: string };
  totals: {
    horasNormales: number;
    horasExtra50: number;
    horasExtra100: number;
    horasViaje: number;
    diasCampo: number;
    diasBase: number;
  };
  trend: { periodo: string; normales: number; extra50: number; extra100: number; viaje: number }[];
  planillasCount: number;
  ausencias: { tipo: string; dias: number; count: number }[];
  vacaciones: { saldo: number; usados: number; pendientes: number };
}

const ESTADO_COLORS: Record<string, string> = {
  BORRADOR: 'bg-slate-500',
  ENVIADA: 'bg-blue-500',
  EN_REVISION: 'bg-amber-500',
  APROBADA: 'bg-emerald-500',
  RECHAZADA: 'bg-red-500',
  CERRADA: 'bg-purple-500',
};

const TIPO_LABELS: Record<string, string> = {
  CERTIFICADO_MEDICO: 'Cert. Médico',
  FALTA_JUSTIFICADA: 'Justificada',
  FALTA_INJUSTIFICADA: 'Injustificada',
  LICENCIA_ESPECIAL: 'Lic. Especial',
};

export default function AnalyticsPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = ['RRHH', 'ADMIN'].includes(user?.rol ?? '');

  if (isAdmin) return <EmpresaDashboard />;
  return <UsuarioDashboard userId={user?.id ?? ''} />;
}

function EmpresaDashboard() {
  const { data, isLoading } = useQuery<EmpresaAnalytics>({
    queryKey: ['analytics-empresa'],
    queryFn: async () => (await api.get('/analytics/empresa')).data,
  });

  if (isLoading || !data) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const totalHoras = data.totals.horasNormales + data.totals.horasExtra50 + data.totals.horasExtra100;
  const maxSectorHoras = Math.max(...data.sectorBreakdown.map(s => s.horasNormales + s.horasExtra50 + s.horasExtra100), 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" /> Analytics — Empresa
        </h1>
        <p className="text-sm text-muted-foreground">{data.totalUsuarios} usuarios activos — {data.totals.planillas} planillas</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <KpiCard label="Total horas" value={totalHoras.toFixed(0)} icon={<Clock className="h-5 w-5" />} color="text-primary" />
        <KpiCard label="Normales" value={data.totals.horasNormales.toFixed(0)} icon={<TrendingUp className="h-5 w-5" />} color="text-foreground" />
        <KpiCard label="Extra 50%" value={data.totals.horasExtra50.toFixed(0)} color="text-amber-400" />
        <KpiCard label="Extra 100%" value={data.totals.horasExtra100.toFixed(0)} color="text-red-400" />
        <KpiCard label="Viaje" value={data.totals.horasViaje.toFixed(0)} color="text-blue-400" />
        <KpiCard label="Campo / Base" value={`${data.totals.diasCampo} / ${data.totals.diasBase}`} icon={<MapPin className="h-5 w-5" />} color="text-emerald-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Planilla states */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">Estado de Planillas</h3>
          <div className="space-y-3">
            {data.estadosPlanilla.map((e) => {
              const pct = data.totals.planillas > 0 ? (e.count / data.totals.planillas) * 100 : 0;
              return (
                <div key={e.estado} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-24">{e.estado.replace('_', ' ')}</span>
                  <div className="flex-1 h-6 rounded-full bg-muted/30 overflow-hidden relative">
                    <div className={cn('h-full rounded-full transition-all', ESTADO_COLORS[e.estado])} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm font-bold w-8 text-right">{e.count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Ausencias breakdown */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Ausencias
          </h3>
          {data.ausencias.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin ausencias registradas</p>
          ) : (
            <div className="space-y-3">
              {data.ausencias.map((a) => (
                <div key={a.tipo} className="flex items-center justify-between">
                  <span className="text-sm">{TIPO_LABELS[a.tipo] ?? a.tipo}</span>
                  <div className="text-right">
                    <span className="text-sm font-bold">{a.dias} día{a.dias !== 1 ? 's' : ''}</span>
                    <span className="text-xs text-muted-foreground ml-2">({a.count} registro{a.count !== 1 ? 's' : ''})</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 pt-3 border-t border-border flex items-center gap-2">
            <Palmtree className="h-4 w-4 text-amber-400" />
            <span className="text-sm">{data.vacacionesPendientes} solicitud{data.vacacionesPendientes !== 1 ? 'es' : ''} de vacaciones pendiente{data.vacacionesPendientes !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      {/* Sector breakdown */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
          <Users className="h-4 w-4" /> Desglose por Sector
        </h3>
        <div className="space-y-4">
          {data.sectorBreakdown.map((s) => {
            const sTotal = s.horasNormales + s.horasExtra50 + s.horasExtra100;
            const pct = (sTotal / maxSectorHoras) * 100;
            return (
              <div key={s.id}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{s.nombre}</span>
                  <span className="text-xs text-muted-foreground">{s.usuarios} usuarios — {s.planillas} planillas</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-5 rounded-full bg-muted/20 overflow-hidden flex">
                    <div className="h-full bg-emerald-500" style={{ width: `${(s.horasNormales / maxSectorHoras) * 100}%` }} title={`Normal: ${s.horasNormales}`} />
                    <div className="h-full bg-amber-500" style={{ width: `${(s.horasExtra50 / maxSectorHoras) * 100}%` }} title={`E50%: ${s.horasExtra50}`} />
                    <div className="h-full bg-red-500" style={{ width: `${(s.horasExtra100 / maxSectorHoras) * 100}%` }} title={`E100%: ${s.horasExtra100}`} />
                  </div>
                  <span className="text-sm font-bold w-16 text-right">{sTotal.toFixed(0)}h</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-emerald-500" /> Normales</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-500" /> Extra 50%</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500" /> Extra 100%</span>
        </div>
      </div>
    </div>
  );
}

function UsuarioDashboard({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery<UsuarioAnalytics>({
    queryKey: ['analytics-usuario', userId],
    queryFn: async () => (await api.get(`/analytics/usuario/${userId}`)).data,
    enabled: !!userId,
  });

  if (isLoading || !data) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const totalHoras = data.totals.horasNormales + data.totals.horasExtra50 + data.totals.horasExtra100;
  const maxTrend = Math.max(...data.trend.map(t => t.normales + t.extra50 + t.extra100), 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" /> Mis Estadísticas
        </h1>
        <p className="text-sm text-muted-foreground">{data.planillasCount} planilla{data.planillasCount !== 1 ? 's' : ''} registradas</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Total horas" value={totalHoras.toFixed(0)} icon={<Clock className="h-5 w-5" />} color="text-primary" />
        <KpiCard label="Normales" value={data.totals.horasNormales.toFixed(0)} color="text-foreground" />
        <KpiCard label="Extra 50%" value={data.totals.horasExtra50.toFixed(0)} color="text-amber-400" />
        <KpiCard label="Extra 100%" value={data.totals.horasExtra100.toFixed(0)} color="text-red-400" />
        <KpiCard label="Viaje" value={data.totals.horasViaje.toFixed(0)} color="text-blue-400" />
        <KpiCard label="Campo / Base" value={`${data.totals.diasCampo} / ${data.totals.diasBase}`} icon={<MapPin className="h-5 w-5" />} color="text-emerald-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trend chart (bar chart) */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" /> Tendencia mensual
          </h3>
          {data.trend.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos de tendencia</p>
          ) : (
            <div className="flex items-end gap-1 h-40">
              {data.trend.map((t, i) => {
                const total = t.normales + t.extra50 + t.extra100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] font-bold text-foreground">{total > 0 ? total.toFixed(0) : ''}</span>
                    <div className="w-full flex flex-col-reverse rounded-t overflow-hidden" style={{ height: `${(total / maxTrend) * 100}%`, minHeight: total > 0 ? '4px' : '0' }}>
                      <div className="w-full bg-emerald-500" style={{ height: `${(t.normales / total) * 100}%` }} />
                      <div className="w-full bg-amber-500" style={{ height: `${(t.extra50 / total) * 100}%` }} />
                      <div className="w-full bg-red-500" style={{ height: `${(t.extra100 / total) * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground rotate-[-45deg] origin-top-left mt-1 w-8">{t.periodo}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Vacaciones + Ausencias */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
              <Palmtree className="h-4 w-4 text-emerald-400" /> Vacaciones
            </h3>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-xl font-bold text-emerald-400">{data.vacaciones.saldo}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{data.vacaciones.usados}</p>
                <p className="text-xs text-muted-foreground">Usados</p>
              </div>
              <div>
                <p className="text-xl font-bold text-amber-400">{data.vacaciones.pendientes}</p>
                <p className="text-xs text-muted-foreground">Pendientes</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" /> Ausencias
            </h3>
            {data.ausencias.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin ausencias</p>
            ) : (
              <div className="space-y-2">
                {data.ausencias.map((a) => (
                  <div key={a.tipo} className="flex items-center justify-between text-sm">
                    <span>{TIPO_LABELS[a.tipo] ?? a.tipo}</span>
                    <span className="font-bold">{a.dias} día{a.dias !== 1 ? 's' : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, color, icon }: { label: string; value: string; color: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-center">
      {icon && <div className={cn('flex justify-center mb-1', color)}>{icon}</div>}
      <p className={cn('text-xl font-bold', color)}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
