import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import {
  Clock, Palmtree, AlertTriangle,
  Loader2, TrendingUp, FileText, CheckCircle2,
  ArrowRight, MapPin, Send, CalendarCheck2, Shield, PenLine, BarChart3
} from 'lucide-react';
import { ESTADO_STYLES } from '@/constants/planillaConstants';

interface DashboardData {
  planillaActual: {
    id: string;
    estado: string;
    totalHorasNormales: string;
    totalHorasExtra50: string;
    totalHorasExtra100: string;
    totalDiasCampo: number;
    totalDiasBase: number;
    registrosCount: number;
  } | null;
  vacaciones: { saldo: number; usados: number; pendientes: number };
  compensatorios: { disponible: number; acumulados: number; usados: number; pendientes: number };
  ausencias: { tipo: string; dias: number; count: number }[];
  planillasRecientes: {
    id: string;
    periodoInicio: string;
    periodoFin: string;
    estado: string;
    totalHorasNormales: string;
    totalHorasExtra50: string;
    totalHorasExtra100: string;
  }[];
  horasTrend: { label: string; normales: number; extra50: number; extra100: number }[];
  recibos: { total: number; pendientesFirma: number; ultimoFirmado: string | null }[];
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const [planillasRes, saldoRes, ausenciasRes, compSaldoRes, recibosRes] = await Promise.all([
        api.get('/planillas'),
        api.get('/vacaciones/saldo').catch(() => ({ data: { disponible: 0, usados: 0, pendiente: 0 } })),
        api.get('/ausencias').catch(() => ({ data: [] })),
        api.get('/vacacion-saldos/mi-saldo').catch(() => ({ data: { compensatoriosDisponible: 0, compensatoriosAcumulados: 0, compensatoriosUsados: 0, compensatoriosPendientes: 0 } })),
        api.get('/recibos/mis-recibos').catch(() => ({ data: [] })),
      ]);

      const planillas = planillasRes.data;
      const saldo = saldoRes.data;
      const compSaldo = compSaldoRes.data;
      const recibosData = recibosRes.data as { firmadoEmpleadoAt: string | null }[];

      // Find current period planilla
      const planillaActual = planillas.find((p: { estado: string }) =>
        ['BORRADOR', 'ENVIADA', 'EN_REVISION'].includes(p.estado)
      ) ?? planillas[0] ?? null;

      // Ausencias by tipo
      const ausMap: Record<string, { dias: number; count: number }> = {};
      (ausenciasRes.data as { tipo: string; diasAusencia: number }[]).forEach((a) => {
        if (!ausMap[a.tipo]) ausMap[a.tipo] = { dias: 0, count: 0 };
        ausMap[a.tipo].dias += a.diasAusencia;
        ausMap[a.tipo].count += 1;
      });

      // Build hours trend from last 6 planillas
      const horasTrend = planillas.slice(0, 6).reverse().map((p: {
        periodoInicio: string; totalHorasNormales: string; totalHorasExtra50: string; totalHorasExtra100: string;
      }) => {
        const d = new Date(p.periodoInicio);
        return {
          label: d.toLocaleDateString('es-AR', { month: 'short' }),
          normales: Number(p.totalHorasNormales),
          extra50: Number(p.totalHorasExtra50),
          extra100: Number(p.totalHorasExtra100),
        };
      });

      // Recibos summary
      const pendientesFirma = recibosData.filter((r) => !r.firmadoEmpleadoAt).length;

      return {
        planillaActual: planillaActual ? {
          ...planillaActual,
          registrosCount: planillaActual._count?.registros ?? planillaActual.registrosCount ?? 0,
        } : null,
        vacaciones: {
          saldo: saldo.disponible,
          usados: saldo.usados,
          pendientes: saldo.pendiente,
        },
        compensatorios: {
          disponible: compSaldo.compensatoriosDisponible ?? 0,
          acumulados: compSaldo.compensatoriosAcumulados ?? 0,
          usados: compSaldo.compensatoriosUsados ?? 0,
          pendientes: compSaldo.compensatoriosPendientes ?? 0,
        },
        ausencias: Object.entries(ausMap).map(([tipo, v]) => ({ tipo, ...v })),
        planillasRecientes: planillas.slice(0, 5),
        horasTrend,
        recibos: [{ total: recibosData.length, pendientesFirma, ultimoFirmado: null }],
      };
    },
  });

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Buenos días';
    if (hour < 18) return 'Buenas tardes';
    return 'Buenas noches';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pa = data?.planillaActual;
  const totalHoras = pa ? Number(pa.totalHorasNormales) + Number(pa.totalHorasExtra50) + Number(pa.totalHorasExtra100) : 0;

  const TIPO_LABELS: Record<string, string> = {
    CERTIFICADO_MEDICO: 'Cert. Médico',
    FALTA_JUSTIFICADA: 'Justificada',
    FALTA_INJUSTIFICADA: 'Injustificada',
    LICENCIA_ESPECIAL: 'Lic. Especial',
    FRANCO_COMPENSATORIO: 'Franco Comp.',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-foreground">
          {getGreeting()}, {user?.nombre} 👋
        </h1>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
            <Shield className="h-3 w-3" /> {user?.rol}
          </span>
          {user?.sectorNombre && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-medium">
              <MapPin className="h-3 w-3" /> {user.sectorNombre}
            </span>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        {/* Planilla actual */}
        <button
          onClick={() => pa && navigate(`/planillas/${pa.id}`)}
          className="rounded-xl border border-border bg-card p-5 hover:border-primary/30 transition-colors text-left"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">Planilla actual</span>
            <Clock className="h-5 w-5 text-blue-400" />
          </div>
          {pa ? (
            <>
              <p className="text-2xl font-bold text-foreground">{totalHoras.toFixed(0)}h</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', ESTADO_STYLES[pa.estado])}>
                  {pa.estado}
                </span>
                <span className="text-xs text-muted-foreground">{pa.registrosCount ?? 0} registros</span>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Sin planilla abierta</p>
          )}
        </button>

        {/* Horas breakdown */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">Horas del período</span>
            <TrendingUp className="h-5 w-5 text-emerald-400" />
          </div>
          {pa ? (
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Normales</span>
                <span className="font-bold">{Number(pa.totalHorasNormales).toFixed(1)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-amber-400">Extra 50%</span>
                <span className="font-bold text-amber-400">{Number(pa.totalHorasExtra50).toFixed(1)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-red-400">Extra 100%</span>
                <span className="font-bold text-red-400">{Number(pa.totalHorasExtra100).toFixed(1)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </div>

        {/* Vacaciones */}
        <button
          onClick={() => navigate('/vacaciones')}
          className="rounded-xl border border-border bg-card p-5 hover:border-primary/30 transition-colors text-left"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">Vacaciones</span>
            <Palmtree className="h-5 w-5 text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-emerald-400">{data?.vacaciones.saldo ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">
            días disponibles · {data?.vacaciones.usados ?? 0} usados
            {(data?.vacaciones.pendientes ?? 0) > 0 && <span className="text-amber-400"> · {data?.vacaciones.pendientes} pendientes</span>}
          </p>
        </button>

        {/* Compensatorios */}
        <button
          onClick={() => navigate('/ausencias')}
          className="rounded-xl border border-border bg-card p-5 hover:border-primary/30 transition-colors text-left"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">Compensatorios</span>
            <CalendarCheck2 className="h-5 w-5 text-cyan-400" />
          </div>
          <p className="text-2xl font-bold text-cyan-400">{data?.compensatorios.disponible ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">
            disponibles · {data?.compensatorios.acumulados ?? 0} acum.
            {(data?.compensatorios.pendientes ?? 0) > 0 && <span className="text-amber-400"> · {data?.compensatorios.pendientes} pend.</span>}
          </p>
        </button>

        {/* Ausencias */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">Ausencias</span>
            <AlertTriangle className="h-5 w-5 text-purple-400" />
          </div>
          {(data?.ausencias.length ?? 0) === 0 ? (
            <div>
              <p className="text-2xl font-bold text-foreground">0</p>
              <p className="text-xs text-muted-foreground mt-1">Sin ausencias registradas</p>
            </div>
          ) : (
            <div className="space-y-1">
              {data?.ausencias.map((a) => (
                <div key={a.tipo} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{TIPO_LABELS[a.tipo] ?? a.tipo}</span>
                  <span className="font-bold">{a.dias}d</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Hours trend chart */}
      {(data?.horasTrend.length ?? 0) > 1 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" /> Evolución de horas
          </h2>
          <MiniBarChart data={data!.horasTrend} />
        </div>
      )}

      {/* Bottom section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Planillas recientes */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Planillas recientes</h2>
            <button onClick={() => navigate('/planillas')} className="text-xs text-primary hover:underline flex items-center gap-1">
              Ver todas <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          {(data?.planillasRecientes.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Sin planillas</p>
          ) : (
            <div className="space-y-2">
              {data?.planillasRecientes.map((p) => (
                <button
                  key={p.id}
                  onClick={() => navigate(`/planillas/${p.id}`)}
                  className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-muted/30 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">
                        {new Date(p.periodoInicio).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })} — {new Date(p.periodoFin).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </p>
                      <p className="text-xs text-muted-foreground">{Number(p.totalHorasNormales).toFixed(0)}h normales</p>
                    </div>
                  </div>
                  <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-medium', ESTADO_STYLES[p.estado])}>
                    {p.estado}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions + campo/base + recibos */}
        <div className="space-y-4">
          {/* Campo / base info */}
          {pa && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                <MapPin className="h-5 w-5 text-emerald-400" /> Ubicación del período
              </h2>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-muted-foreground">Campo</span>
                    <span className="text-sm font-bold text-emerald-400">{pa.totalDiasCampo} días</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${((pa.totalDiasCampo) / Math.max(pa.totalDiasCampo + pa.totalDiasBase, 1)) * 100}%` }} />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-muted-foreground">Base</span>
                    <span className="text-sm font-bold text-blue-400">{pa.totalDiasBase} días</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${((pa.totalDiasBase) / Math.max(pa.totalDiasCampo + pa.totalDiasBase, 1)) * 100}%` }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Recibos widget */}
          {(data?.recibos[0]?.total ?? 0) > 0 && (
            <button
              onClick={() => navigate('/recibos')}
              className="w-full rounded-xl border border-border bg-card p-5 hover:border-primary/30 transition-colors text-left"
            >
              <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" /> Mis Recibos
              </h2>
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-2xl font-bold">{data!.recibos[0].total}</p>
                  <p className="text-xs text-muted-foreground">recibos</p>
                </div>
                {data!.recibos[0].pendientesFirma > 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15">
                    <PenLine className="h-4 w-4 text-amber-400" />
                    <span className="text-sm font-medium text-amber-400">
                      {data!.recibos[0].pendientesFirma} pendiente{data!.recibos[0].pendientesFirma > 1 ? 's' : ''} de firma
                    </span>
                  </div>
                )}
                {data!.recibos[0].pendientesFirma === 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span className="text-sm font-medium text-emerald-400">Todo firmado</span>
                  </div>
                )}
              </div>
            </button>
          )}

          {/* Quick actions */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold text-foreground mb-3">Acciones rápidas</h2>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => navigate('/planillas')}
                className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
              >
                <Clock className="h-4 w-4" /> Mis planillas
              </button>
              <button
                onClick={() => navigate('/vacaciones')}
                className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 text-emerald-400 text-sm font-medium hover:bg-emerald-500/20 transition-colors"
              >
                <Palmtree className="h-4 w-4" /> Vacaciones
              </button>
              <button
                onClick={() => navigate('/ausencias')}
                className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 text-amber-400 text-sm font-medium hover:bg-amber-500/20 transition-colors"
              >
                <AlertTriangle className="h-4 w-4" /> Ausencias
              </button>
              <button
                onClick={() => navigate('/recibos')}
                className="flex items-center gap-2 p-3 rounded-lg bg-cyan-500/10 text-cyan-400 text-sm font-medium hover:bg-cyan-500/20 transition-colors"
              >
                <FileText className="h-4 w-4" /> Recibos
              </button>
            </div>
          </div>

          {/* Pending approvals for coordinators+ */}
          {['COORDINADOR', 'RRHH', 'ADMIN'].includes(user?.rol ?? '') && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-amber-400" /> Pendientes de aprobación
              </h2>
              <div className="flex gap-3">
                <button
                  onClick={() => navigate('/aprobaciones')}
                  className="flex-1 flex items-center gap-2 p-3 rounded-lg bg-blue-500/10 text-sm hover:bg-blue-500/20 transition-colors"
                >
                  <Send className="h-4 w-4 text-blue-400" />
                  <span>Planillas enviadas</span>
                </button>
                <button
                  onClick={() => navigate('/vacaciones')}
                  className="flex-1 flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 text-sm hover:bg-emerald-500/20 transition-colors"
                >
                  <Palmtree className="h-4 w-4 text-emerald-400" />
                  <span>Vacaciones pendientes</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MiniBarChart: stacked bar chart for hours trend ─────────────────────────
function MiniBarChart({ data }: { data: { label: string; normales: number; extra50: number; extra100: number }[] }) {
  const maxTotal = Math.max(...data.map((d) => d.normales + d.extra50 + d.extra100), 1);
  const H = 120;
  const barW = 40;
  const gap = 12;
  const W = data.length * (barW + gap) - gap + 40;

  return (
    <div className="overflow-x-auto">
      <svg width={W} height={H + 30} className="mx-auto">
        {data.map((d, i) => {
          const x = 20 + i * (barW + gap);
          const total = d.normales + d.extra50 + d.extra100;
          const hN = (d.normales / maxTotal) * H;
          const hE50 = (d.extra50 / maxTotal) * H;
          const hE100 = (d.extra100 / maxTotal) * H;
          const baseY = H;
          return (
            <g key={i}>
              {/* Normal hours */}
              <rect x={x} y={baseY - hN} width={barW} height={hN} rx={3} fill="var(--color-primary, #6366f1)" opacity={0.8} />
              {/* Extra 50% */}
              <rect x={x} y={baseY - hN - hE50} width={barW} height={hE50} rx={2} fill="#f59e0b" opacity={0.8} />
              {/* Extra 100% */}
              <rect x={x} y={baseY - hN - hE50 - hE100} width={barW} height={hE100} rx={2} fill="#ef4444" opacity={0.8} />
              {/* Total label */}
              <text x={x + barW / 2} y={baseY - hN - hE50 - hE100 - 4} textAnchor="middle"
                className="fill-foreground text-[10px] font-medium">{total.toFixed(0)}h</text>
              {/* Month label */}
              <text x={x + barW / 2} y={H + 16} textAnchor="middle"
                className="fill-muted-foreground text-[10px]">{d.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="flex items-center justify-center gap-4 mt-2">
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="w-2.5 h-2.5 rounded-sm bg-primary inline-block" /> Normales
        </span>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" /> Extra 50%
        </span>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" /> Extra 100%
        </span>
      </div>
    </div>
  );
}
