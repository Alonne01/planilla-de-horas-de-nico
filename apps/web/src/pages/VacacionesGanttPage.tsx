import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { useState, useMemo } from 'react';
import { Loader2, ChevronLeft, ChevronRight, Calendar, Users } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

interface Sector { id: string; nombre: string }
interface Bloque {
  id: string;
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  estado: string;
  tipo: string;
  detalle: string | null;
}
interface Empleado {
  id: string;
  nombre: string;
  apellido: string;
  legajo: string;
  sector: Sector | null;
  bloques: Bloque[];
}
interface GanttData {
  anio: number;
  sectores: Sector[];
  empleados: Empleado[];
}

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Colors by block type
const TIPO_COLORS: Record<string, string> = {
  VACACION: 'bg-emerald-500',
  CAPACITACION: 'bg-violet-500',
  AUSENCIA_CERTIFICADO_MEDICO: 'bg-red-500',
  AUSENCIA_FALTA_INJUSTIFICADA: 'bg-rose-700',
  AUSENCIA_FALTA_JUSTIFICADA: 'bg-orange-500',
  AUSENCIA_LICENCIA_ESPECIAL: 'bg-pink-500',
  AUSENCIA_FRANCO_COMPENSATORIO: 'bg-cyan-500',
  AUSENCIA_ACCIDENTE_TRABAJO: 'bg-red-700',
  AUSENCIA_LICENCIA_GREMIAL: 'bg-yellow-600',
  AUSENCIA_SUSPENSION: 'bg-gray-500',
};

const TIPO_LABELS: Record<string, string> = {
  VACACION: 'Vacación',
  CAPACITACION: 'Capacitación',
  AUSENCIA_CERTIFICADO_MEDICO: 'Cert. médico',
  AUSENCIA_FALTA_INJUSTIFICADA: 'Falta injust.',
  AUSENCIA_FALTA_JUSTIFICADA: 'Falta just.',
  AUSENCIA_LICENCIA_ESPECIAL: 'Lic. especial',
  AUSENCIA_FRANCO_COMPENSATORIO: 'Compensatorio',
  AUSENCIA_ACCIDENTE_TRABAJO: 'Acc. trabajo',
  AUSENCIA_LICENCIA_GREMIAL: 'Lic. gremial',
  AUSENCIA_SUSPENSION: 'Suspensión',
};

const ESTADO_BADGE: Record<string, string> = {
  APROBADA: 'bg-emerald-500/20 text-emerald-400',
  EN_REVISION: 'bg-amber-500/20 text-amber-400',
  PENDIENTE: 'bg-blue-500/20 text-blue-400',
};

export default function VacacionesGanttPage() {
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [sectorId, setSectorId] = useState('');
  const [hoveredBlock, setHoveredBlock] = useState<(Bloque & { empNombre: string }) | null>(null);
  const user = useAuthStore((s) => s.user);
  const isRRHH = (user?.rolNivel ?? 0) >= 90;

  const { data, isLoading } = useQuery<GanttData>({
    queryKey: ['vacaciones-gantt', anio, sectorId],
    queryFn: async () => {
      const params = new URLSearchParams({ anio: String(anio) });
      if (sectorId) params.set('sectorId', sectorId);
      return (await api.get(`/vacaciones/gantt?${params}`)).data;
    },
  });

  const months = useMemo(() => {
    return MESES.map((label, i) => {
      const days = new Date(anio, i + 1, 0).getDate();
      return { label, index: i, days };
    });
  }, [anio]);

  const totalDays = useMemo(() => months.reduce((s, m) => s + m.days, 0), [months]);

  const dateToDayOffset = (dateStr: string) => {
    const d = new Date(dateStr);
    const start = new Date(anio, 0, 1);
    const diff = Math.max(0, Math.floor((d.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    return Math.min(diff, totalDays - 1);
  };

  // Collect which tipos exist for the legend
  const activeTipos = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const emp of data.empleados) {
      for (const b of emp.bloques) set.add(b.tipo);
    }
    return Array.from(set);
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Calendar className="h-6 w-6 text-primary" />
          Calendario de Ausencias
        </h1>
        <div className="flex items-center gap-3">
          {isRRHH && (
            <select
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="">Todos los sectores</option>
              {data?.sectores.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1">
            <button
              onClick={() => setAnio((a) => a - 1)}
              className="p-2 rounded-lg hover:bg-muted/50 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-lg font-bold min-w-[4ch] text-center">{anio}</span>
            <button
              onClick={() => setAnio((a) => a + 1)}
              className="p-2 rounded-lg hover:bg-muted/50 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Legend — dynamic based on what types exist */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
        {activeTipos.map((t) => (
          <span key={t} className="flex items-center gap-1.5">
            <span className={cn('w-3 h-3 rounded', TIPO_COLORS[t] ?? 'bg-slate-500')} />
            {TIPO_LABELS[t] ?? t}
          </span>
        ))}
        {activeTipos.length === 0 && <span>Sin datos</span>}
      </div>

      {/* Gantt Chart */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {(!data?.empleados.length) ? (
          <div className="p-12 text-center">
            <Users className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-muted-foreground">No hay registros en {anio}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              {/* Month header */}
              <div className="flex border-b border-border">
                <div className="w-48 min-w-48 px-3 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground border-r border-border">
                  Empleado
                </div>
                <div className="flex-1 flex">
                  {months.map((m) => (
                    <div
                      key={m.index}
                      className="text-center text-xs font-medium text-muted-foreground py-2 border-r border-border/50"
                      style={{ width: `${(m.days / totalDays) * 100}%` }}
                    >
                      {m.label}
                    </div>
                  ))}
                </div>
              </div>

              {/* Employee rows */}
              {data.empleados.map((emp) => (
                <div key={emp.id} className="flex border-b border-border/50 hover:bg-muted/10 transition-colors">
                  <div className="w-48 min-w-48 px-3 py-2.5 border-r border-border flex flex-col justify-center">
                    <span className="text-sm font-medium truncate">{emp.apellido}, {emp.nombre}</span>
                    {emp.sector && (
                      <span className="text-[10px] text-muted-foreground truncate">{emp.sector.nombre}</span>
                    )}
                  </div>

                  <div className="flex-1 relative py-1.5 px-0.5" style={{ minHeight: '40px' }}>
                    {/* Month gridlines */}
                    {months.map((m) => {
                      const offset = months.slice(0, m.index).reduce((s, mm) => s + mm.days, 0);
                      return (
                        <div
                          key={m.index}
                          className="absolute top-0 bottom-0 border-r border-border/20"
                          style={{ left: `${(offset / totalDays) * 100}%` }}
                        />
                      );
                    })}

                    {/* Today marker */}
                    {anio === new Date().getFullYear() && (() => {
                      const todayOffset = dateToDayOffset(new Date().toISOString());
                      return (
                        <div
                          className="absolute top-0 bottom-0 w-px bg-red-500/50 z-10"
                          style={{ left: `${(todayOffset / totalDays) * 100}%` }}
                        />
                      );
                    })()}

                    {/* Blocks */}
                    {emp.bloques.map((b) => {
                      const startDay = dateToDayOffset(b.fechaInicio);
                      const endDay = dateToDayOffset(b.fechaFin);
                      const duration = Math.max(endDay - startDay + 1, 1);
                      const leftPct = (startDay / totalDays) * 100;
                      const widthPct = (duration / totalDays) * 100;

                      return (
                        <div
                          key={`${b.tipo}-${b.id}`}
                          className={cn(
                            'absolute top-1/2 -translate-y-1/2 h-5 rounded-md cursor-pointer opacity-80 hover:opacity-100 transition-opacity',
                            TIPO_COLORS[b.tipo] ?? 'bg-slate-500'
                          )}
                          style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 0.5)}%` }}
                          onMouseEnter={() => setHoveredBlock({ ...b, empNombre: `${emp.apellido}, ${emp.nombre}` })}
                          onMouseLeave={() => setHoveredBlock(null)}
                        >
                          {widthPct > 3 && (
                            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-medium text-white truncate px-1">
                              {b.dias}d
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tooltip */}
      {hoveredBlock && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-border bg-card shadow-lg p-4 max-w-xs">
          <p className="font-semibold text-sm">{hoveredBlock.empNombre}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {new Date(hoveredBlock.fechaInicio).toLocaleDateString('es-AR')} — {new Date(hoveredBlock.fechaFin).toLocaleDateString('es-AR')}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className={cn('w-2.5 h-2.5 rounded', TIPO_COLORS[hoveredBlock.tipo] ?? 'bg-slate-500')} />
            <span className="text-xs font-medium">{TIPO_LABELS[hoveredBlock.tipo] ?? hoveredBlock.tipo}</span>
          </div>
          <p className="text-xs mt-1">
            <span className="font-medium">{hoveredBlock.dias} día{hoveredBlock.dias !== 1 ? 's' : ''}</span> · 
            <span className={cn('ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium', ESTADO_BADGE[hoveredBlock.estado] ?? 'bg-slate-500/20 text-slate-400')}>
              {hoveredBlock.estado}
            </span>
          </p>
          {hoveredBlock.detalle && (
            <p className="text-xs text-muted-foreground mt-1 italic">"{hoveredBlock.detalle}"</p>
          )}
        </div>
      )}

      {/* Summary */}
      {data && data.empleados.length > 0 && (
        <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
          <span>{data.empleados.length} empleados</span>
          <span>{data.empleados.reduce((s, e) => s + e.bloques.length, 0)} registros</span>
          <span>
            {data.empleados.reduce((s, e) => s + e.bloques.filter(b => b.tipo === 'VACACION').length, 0)} vacaciones
          </span>
          <span>
            {data.empleados.reduce((s, e) => s + e.bloques.filter(b => b.tipo.startsWith('AUSENCIA_')).length, 0)} ausencias
          </span>
          <span>
            {data.empleados.reduce((s, e) => s + e.bloques.filter(b => b.tipo === 'CAPACITACION').length, 0)} capacitaciones
          </span>
        </div>
      )}
    </div>
  );
}
