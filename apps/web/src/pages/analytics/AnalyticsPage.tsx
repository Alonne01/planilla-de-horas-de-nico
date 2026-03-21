import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import {
  BarChart3, TrendingUp, Users, MapPin,
  Loader2, Clock, Palmtree, AlertTriangle,
  Car, Bed, CalendarCheck, Award, Building2, Tent
} from 'lucide-react';
import PeriodSelector, { getCurrentPeriod } from '@/components/layout/PeriodSelector';

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
  topExtras: {
    usuario: { id: string; nombre: string; apellido: string; legajo: string | null; sector?: { nombre: string } | null } | null;
    extra50: number;
    extra100: number;
    normales: number;
    totalExtra: number;
  }[];
  campoVsBase: { campo: number; base: number; franco: number };
  pernoctes: { hotel: number; trailer: number; sinPernocte: number };
  feriadosFrancos: { feriadosTrabajados: number; francosTrabajados: number; francosCompensatorios: number };
  horasViaje: { maneja: number; noManeja: number };
  ausenciasBySector: { sector: string; dias: number }[];
  compensatorios: { acumulados: number; usados: number; pendientes: number };
  trend: { periodo: string; normales: number; extra50: number; extra100: number; viaje: number }[];
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
  const [periodo, setPeriodo] = useState(getCurrentPeriod());
  const [filterSector, setFilterSector] = useState('');

  const { data: sectores = [] } = useQuery<{ id: string; nombre: string }[]>({
    queryKey: ['sectores-analytics'],
    queryFn: async () => (await api.get('/analytics/sectores')).data,
  });

  const { data, isLoading } = useQuery<EmpresaAnalytics>({
    queryKey: ['analytics-empresa', periodo.inicio, periodo.fin, filterSector],
    queryFn: async () => {
      let url = `/analytics/empresa?periodoInicio=${encodeURIComponent(periodo.inicio)}&periodoFin=${encodeURIComponent(periodo.fin)}`;
      if (filterSector) url += `&sectorId=${encodeURIComponent(filterSector)}`;
      return (await api.get(url)).data;
    },
  });

  if (isLoading || !data) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const totalHoras = data.totals.horasNormales + data.totals.horasExtra50 + data.totals.horasExtra100;
  const maxSectorHoras = Math.max(...data.sectorBreakdown.map(s => s.horasNormales + s.horasExtra50 + s.horasExtra100), 1);
  const maxTopExtra = Math.max(...(data.topExtras?.map(t => t.totalExtra) ?? []), 1);
  const totalCampoBase = (data.campoVsBase?.campo ?? 0) + (data.campoVsBase?.base ?? 0) + (data.campoVsBase?.franco ?? 0);
  const totalPernoctes = (data.pernoctes?.hotel ?? 0) + (data.pernoctes?.trailer ?? 0) + (data.pernoctes?.sinPernocte ?? 0);
  const totalViajeHoras = (data.horasViaje?.maneja ?? 0) + (data.horasViaje?.noManeja ?? 0);
  const maxAusSector = Math.max(...(data.ausenciasBySector?.map(a => a.dias) ?? []), 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" /> Analytics — Empresa
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.totalUsuarios} usuarios activos — {data.totals.planillas} planillas
            {filterSector ? ` — ${sectores.find(s => s.id === filterSector)?.nombre ?? 'Sector'}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={filterSector}
            onChange={(e) => setFilterSector(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Todos los sectores</option>
            {sectores.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
          <PeriodSelector value={periodo} onChange={setPeriodo} />
        </div>
      </div>

      {/* ═══ KPI Cards ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <KpiCard label="Total horas" value={totalHoras.toFixed(0)} icon={<Clock className="h-5 w-5" />} color="text-primary" />
        <KpiCard label="Normales" value={data.totals.horasNormales.toFixed(0)} icon={<TrendingUp className="h-5 w-5" />} color="text-foreground" />
        <KpiCard label="Extra 50%" value={data.totals.horasExtra50.toFixed(0)} color="text-amber-400" />
        <KpiCard label="Extra 100%" value={data.totals.horasExtra100.toFixed(0)} color="text-red-400" />
        <KpiCard label="Viaje" value={data.totals.horasViaje.toFixed(0)} icon={<Car className="h-5 w-5" />} color="text-blue-400" />
        <KpiCard label="Campo / Base" value={`${data.totals.diasCampo} / ${data.totals.diasBase}`} icon={<MapPin className="h-5 w-5" />} color="text-emerald-400" />
      </div>

      {/* ═══ Trend Line Chart ═══ */}
      {(data.trend?.length ?? 0) > 1 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" /> Tendencia — Horas por Período
          </h3>
          <TrendLineChart data={data.trend} />
        </div>
      )}

      {/* ═══ Row 1: Estado de Planillas + Distribución Lugar/Pernocte ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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

        {/* Campo vs Base - Donut */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Distribución Lugar de Trabajo
          </h3>
          {totalCampoBase > 0 ? (
            <div className="flex items-center gap-6">
              <DonutChart segments={[
                { value: data.campoVsBase.campo, color: '#10b981', label: 'Campo' },
                { value: data.campoVsBase.base, color: '#3b82f6', label: 'Base' },
                { value: data.campoVsBase.franco, color: '#8b5cf6', label: 'Franco' },
              ]} size={120} />
              <div className="space-y-2">
                <LegendItem color="bg-emerald-500" label="Campo" value={data.campoVsBase.campo} total={totalCampoBase} />
                <LegendItem color="bg-blue-500" label="Base" value={data.campoVsBase.base} total={totalCampoBase} />
                <LegendItem color="bg-purple-500" label="Franco" value={data.campoVsBase.franco} total={totalCampoBase} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sin registros</p>
          )}
        </div>

        {/* Pernoctes distribution */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
            <Bed className="h-4 w-4" /> Pernoctes
          </h3>
          {totalPernoctes > 0 ? (
            <div className="flex items-center gap-6">
              <DonutChart segments={[
                { value: data.pernoctes.hotel, color: '#f59e0b', label: 'Hotel' },
                { value: data.pernoctes.trailer, color: '#06b6d4', label: 'Tráiler' },
                { value: data.pernoctes.sinPernocte, color: '#6b7280', label: 'Sin pernocte' },
              ]} size={120} />
              <div className="space-y-2">
                <LegendItem color="bg-amber-500" label="Hotel" value={data.pernoctes.hotel} total={totalPernoctes} />
                <LegendItem color="bg-cyan-500" label="Tráiler" value={data.pernoctes.trailer} total={totalPernoctes} />
                <LegendItem color="bg-gray-500" label="Sin pernocte" value={data.pernoctes.sinPernocte} total={totalPernoctes} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sin registros</p>
          )}
        </div>
      </div>

      {/* ═══ Row 2: Feriados/Francos + Viaje + Compensatorios ═══ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {/* Feriados y Francos */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
            <CalendarCheck className="h-4 w-4" /> Feriados y Francos
          </h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold text-amber-400">{data.feriadosFrancos?.feriadosTrabajados ?? 0}</p>
              <p className="text-[11px] text-muted-foreground leading-tight">Feriados trabajados</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-purple-400">{data.feriadosFrancos?.francosTrabajados ?? 0}</p>
              <p className="text-[11px] text-muted-foreground leading-tight">Francos trabajados</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-400">{data.feriadosFrancos?.francosCompensatorios ?? 0}</p>
              <p className="text-[11px] text-muted-foreground leading-tight">Francos compensatorios</p>
            </div>
          </div>
        </div>

        {/* Horas de Viaje */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
            <Car className="h-4 w-4" /> Horas de Viaje
          </h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Maneja</span>
                <span className="font-bold">{(data.horasViaje?.maneja ?? 0).toFixed(1)}h</span>
              </div>
              <div className="h-4 rounded-full bg-muted/30 overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: totalViajeHoras > 0 ? `${((data.horasViaje?.maneja ?? 0) / totalViajeHoras) * 100}%` : '0%' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>No maneja</span>
                <span className="font-bold">{(data.horasViaje?.noManeja ?? 0).toFixed(1)}h</span>
              </div>
              <div className="h-4 rounded-full bg-muted/30 overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: totalViajeHoras > 0 ? `${((data.horasViaje?.noManeja ?? 0) / totalViajeHoras) * 100}%` : '0%' }} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center pt-1">Total: {totalViajeHoras.toFixed(1)} horas</p>
          </div>
        </div>

        {/* Compensatorios Balance */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
            <Award className="h-4 w-4" /> Compensatorios (empresa)
          </h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold text-emerald-400">{data.compensatorios?.acumulados ?? 0}</p>
              <p className="text-[11px] text-muted-foreground leading-tight">Acumulados</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{data.compensatorios?.usados ?? 0}</p>
              <p className="text-[11px] text-muted-foreground leading-tight">Usados</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-400">{data.compensatorios?.pendientes ?? 0}</p>
              <p className="text-[11px] text-muted-foreground leading-tight">Pendientes</p>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Row 3: Top Horas Extra + Ausencias ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top employees by overtime */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-amber-400" /> Top 10 — Horas Extra
          </h3>
          {(data.topExtras?.length ?? 0) > 0 ? (
            <div className="space-y-2">
              {data.topExtras.map((t, i) => (
                <div key={t.usuario?.id ?? i} className="flex items-center gap-3">
                  <span className={cn(
                    'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                    i === 0 ? 'bg-amber-500/20 text-amber-400' :
                    i === 1 ? 'bg-slate-400/20 text-slate-400' :
                    i === 2 ? 'bg-amber-700/20 text-amber-600' :
                    'bg-muted/30 text-muted-foreground'
                  )}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium truncate">{t.usuario?.apellido}, {t.usuario?.nombre}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{t.usuario?.sector?.nombre}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-3 rounded-full bg-muted/20 overflow-hidden flex">
                        <div className="h-full bg-amber-500" style={{ width: `${(t.extra50 / maxTopExtra) * 100}%` }} title={`E50%: ${t.extra50.toFixed(1)}`} />
                        <div className="h-full bg-red-500" style={{ width: `${(t.extra100 / maxTopExtra) * 100}%` }} title={`E100%: ${t.extra100.toFixed(1)}`} />
                      </div>
                      <span className="text-xs font-bold w-12 text-right">{t.totalExtra.toFixed(1)}h</span>
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-4 mt-3 pt-2 border-t border-border text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Extra 50%</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Extra 100%</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sin datos de horas extra</p>
          )}
        </div>

        {/* Ausencias panel */}
        <div className="space-y-4">
          {/* Ausencias by type */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Ausencias por Tipo
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
                      <span className="text-xs text-muted-foreground ml-2">({a.count})</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
              <Palmtree className="h-4 w-4 text-emerald-400" />
              <span className="text-sm">{data.vacacionesPendientes} vacaciones pendiente{data.vacacionesPendientes !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* Ausencias by sector */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Ausencias por Sector
            </h3>
            {(data.ausenciasBySector?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">Sin ausencias por sector</p>
            ) : (
              <div className="space-y-2">
                {data.ausenciasBySector.map((a) => (
                  <div key={a.sector} className="flex items-center gap-3">
                    <span className="text-sm w-28 truncate">{a.sector}</span>
                    <div className="flex-1 h-4 rounded-full bg-muted/20 overflow-hidden">
                      <div className="h-full bg-red-500/70 rounded-full" style={{ width: `${(a.dias / maxAusSector) * 100}%` }} />
                    </div>
                    <span className="text-xs font-bold w-12 text-right">{a.dias} d</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Row 4: Sector breakdown ═══ */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
          <Users className="h-4 w-4" /> Desglose por Sector — Horas
        </h3>
        <div className="space-y-4">
          {data.sectorBreakdown.map((s) => {
            const sTotal = s.horasNormales + s.horasExtra50 + s.horasExtra100;
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

function DonutChart({ segments, size = 120 }: { segments: { value: number; color: string; label: string }[]; size?: number }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0">
      {segments.map((seg, i) => {
        const pct = seg.value / total;
        const dashLength = pct * circumference;
        const currentOffset = offset;
        offset += dashLength;
        return (
          <circle
            key={i}
            cx="50" cy="50" r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth="18"
            strokeDasharray={`${dashLength} ${circumference - dashLength}`}
            strokeDashoffset={-currentOffset}
            transform="rotate(-90 50 50)"
          />
        );
      })}
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
        className="fill-foreground text-[13px] font-bold">{total}</text>
      <text x="50" y="62" textAnchor="middle" dominantBaseline="central"
        className="fill-muted-foreground text-[7px]">días</text>
    </svg>
  );
}

function LegendItem({ color, label, value, total }: { color: string; label: string; value: number; total: number }) {
  const pct = total > 0 ? ((value / total) * 100).toFixed(0) : '0';
  return (
    <div className="flex items-center gap-2">
      <span className={cn('w-3 h-3 rounded-full shrink-0', color)} />
      <span className="text-sm">{label}</span>
      <span className="text-sm font-bold ml-auto">{value}</span>
      <span className="text-xs text-muted-foreground">({pct}%)</span>
    </div>
  );
}

const LINE_SERIES = [
  { key: 'normales' as const, color: '#10b981', label: 'Normales' },
  { key: 'extra50' as const, color: '#f59e0b', label: 'Extra 50%' },
  { key: 'extra100' as const, color: '#ef4444', label: 'Extra 100%' },
  { key: 'viaje' as const, color: '#3b82f6', label: 'Viaje' },
];

function TrendLineChart({ data }: { data: { periodo: string; normales: number; extra50: number; extra100: number; viaje: number }[] }) {
  if (data.length < 2) return <p className="text-sm text-muted-foreground">Datos insuficientes para tendencia</p>;

  const chartW = 600;
  const chartH = 200;
  const padL = 45;
  const padR = 15;
  const padT = 10;
  const padB = 40;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const allValues = data.flatMap(d => [d.normales, d.extra50, d.extra100, d.viaje]);
  const maxVal = Math.max(...allValues, 1);
  const stepCount = data.length - 1;

  const getX = (i: number) => padL + (i / stepCount) * innerW;
  const getY = (v: number) => padT + innerH - (v / maxVal) * innerH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(maxVal * f));

  return (
    <div>
      <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {gridLines.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={chartW - padR} y1={getY(v)} y2={getY(v)} stroke="currentColor" strokeOpacity={0.1} strokeDasharray="4 4" />
            <text x={padL - 6} y={getY(v) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{v}</text>
          </g>
        ))}

        {/* Lines + dots for each series */}
        {LINE_SERIES.map(({ key, color }) => {
          const points = data.map((d, i) => `${getX(i)},${getY(d[key])}`).join(' ');
          // Area fill
          const areaPoints = `${getX(0)},${getY(0)} ` + points + ` ${getX(data.length - 1)},${getY(0)}`;
          return (
            <g key={key}>
              <polygon points={areaPoints} fill={color} fillOpacity={0.05} />
              <polyline points={points} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
              {data.map((d, i) => (
                <circle key={i} cx={getX(i)} cy={getY(d[key])} r={3.5} fill={color} stroke="var(--color-card)" strokeWidth={2}>
                  <title>{d.periodo}: {d[key].toFixed(1)}h</title>
                </circle>
              ))}
            </g>
          );
        })}

        {/* X-axis labels */}
        {data.map((d, i) => (
          <text key={i} x={getX(i)} y={chartH - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
            {d.periodo}
          </text>
        ))}
      </svg>
      <div className="flex items-center justify-center gap-4 mt-2 text-xs text-muted-foreground">
        {LINE_SERIES.map(({ key, color, label }) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded-full inline-block" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
