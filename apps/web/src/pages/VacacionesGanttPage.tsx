import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { useState, useMemo } from 'react';
import { Loader2, ChevronLeft, ChevronRight, Calendar, Users } from 'lucide-react';

interface Sector { id: string; nombre: string }
interface VacacionBlock {
  id: string;
  fechaInicio: string;
  fechaFin: string;
  diasTotales: number;
  estado: string;
  motivo: string | null;
  usuario: { id: string; nombre: string; apellido: string; legajo: string; sector: Sector | null };
}
interface Empleado {
  id: string;
  nombre: string;
  apellido: string;
  legajo: string;
  sector: Sector | null;
  vacaciones: VacacionBlock[];
}
interface GanttData {
  anio: number;
  sectores: Sector[];
  empleados: Empleado[];
}

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const ESTADO_COLORS: Record<string, string> = {
  APROBADA: 'bg-emerald-500',
  EN_REVISION: 'bg-amber-500',
  PENDIENTE: 'bg-blue-500',
};

export default function VacacionesGanttPage() {
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [sectorId, setSectorId] = useState('');
  const [hoveredVac, setHoveredVac] = useState<VacacionBlock | null>(null);

  const { data, isLoading } = useQuery<GanttData>({
    queryKey: ['vacaciones-gantt', anio, sectorId],
    queryFn: async () => {
      const params = new URLSearchParams({ anio: String(anio) });
      if (sectorId) params.set('sectorId', sectorId);
      const res = await api.get(`/vacaciones/gantt?${params}`);
      return res.data;
    },
  });

  // Build month columns with day counts
  const months = useMemo(() => {
    return MESES.map((label, i) => {
      const days = new Date(anio, i + 1, 0).getDate();
      return { label, index: i, days };
    });
  }, [anio]);

  const totalDays = useMemo(() => months.reduce((s, m) => s + m.days, 0), [months]);

  // Convert a date to a day-of-year offset (0-indexed)
  const dateToDayOffset = (dateStr: string) => {
    const d = new Date(dateStr);
    const start = new Date(anio, 0, 1);
    const diff = Math.max(0, Math.floor((d.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    return Math.min(diff, totalDays - 1);
  };

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Calendar className="h-6 w-6 text-primary" />
          Calendario de Vacaciones
        </h1>
        <div className="flex items-center gap-3">
          {/* Sector filter */}
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

          {/* Year navigation */}
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

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500" /> Aprobada</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-500" /> En revisión</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-500" /> Pendiente</span>
      </div>

      {/* Gantt Chart */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {(!data?.empleados.length) ? (
          <div className="p-12 text-center">
            <Users className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-muted-foreground">No hay vacaciones en {anio}</p>
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
                  {/* Name column */}
                  <div className="w-48 min-w-48 px-3 py-2.5 border-r border-border flex flex-col justify-center">
                    <span className="text-sm font-medium truncate">{emp.apellido}, {emp.nombre}</span>
                    {emp.sector && (
                      <span className="text-[10px] text-muted-foreground truncate">{emp.sector.nombre}</span>
                    )}
                  </div>

                  {/* Timeline column */}
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

                    {/* Vacation bars */}
                    {emp.vacaciones.map((v) => {
                      const startDay = dateToDayOffset(v.fechaInicio);
                      const endDay = dateToDayOffset(v.fechaFin);
                      const duration = Math.max(endDay - startDay + 1, 1);
                      const leftPct = (startDay / totalDays) * 100;
                      const widthPct = (duration / totalDays) * 100;

                      return (
                        <div
                          key={v.id}
                          className={cn(
                            'absolute top-1/2 -translate-y-1/2 h-5 rounded-md cursor-pointer opacity-80 hover:opacity-100 transition-opacity',
                            ESTADO_COLORS[v.estado] ?? 'bg-slate-500'
                          )}
                          style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 0.5)}%` }}
                          onMouseEnter={() => setHoveredVac(v)}
                          onMouseLeave={() => setHoveredVac(null)}
                        >
                          {widthPct > 3 && (
                            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-medium text-white truncate px-1">
                              {v.diasTotales}d
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
      {hoveredVac && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-border bg-card shadow-lg p-4 max-w-xs">
          <p className="font-semibold text-sm">
            {hoveredVac.usuario.apellido}, {hoveredVac.usuario.nombre}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {new Date(hoveredVac.fechaInicio).toLocaleDateString('es-AR')} — {new Date(hoveredVac.fechaFin).toLocaleDateString('es-AR')}
          </p>
          <p className="text-xs mt-1">
            <span className="font-medium">{hoveredVac.diasTotales} días</span> · 
            <span className={cn(
              'ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
              hoveredVac.estado === 'APROBADA' ? 'bg-emerald-500/20 text-emerald-400' :
              hoveredVac.estado === 'EN_REVISION' ? 'bg-amber-500/20 text-amber-400' :
              'bg-blue-500/20 text-blue-400'
            )}>
              {hoveredVac.estado}
            </span>
          </p>
          {hoveredVac.motivo && (
            <p className="text-xs text-muted-foreground mt-1 italic">"{hoveredVac.motivo}"</p>
          )}
        </div>
      )}

      {/* Summary */}
      {data && data.empleados.length > 0 && (
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{data.empleados.length} empleados</span>
          <span>{data.empleados.reduce((s, e) => s + e.vacaciones.length, 0)} solicitudes</span>
          <span>
            {data.empleados.reduce((s, e) => s + e.vacaciones.filter(v => v.estado === 'APROBADA').length, 0)} aprobadas
          </span>
        </div>
      )}
    </div>
  );
}
