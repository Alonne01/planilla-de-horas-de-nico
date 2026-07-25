import { useMemo, useState } from 'react';
import { Users, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type GanttData, type Bloque, type Cat,
  MESES, CAT, CAT_LABEL, CAT_ORDER, ESTADO_BADGE, catOf, tipoLabel, computeOverlapPeaks,
} from './shared';

interface Props {
  data?: GanttData;
  anio: number;
  isLoading: boolean;
  onOverlapSelect: (block: Bloque, empId: string, empName: string) => void;
}

export default function CalendarioCompacto({ data, anio, isLoading, onOverlapSelect }: Props) {
  const [hovered, setHovered] = useState<(Bloque & { empNombre: string; cat: Cat }) | null>(null);

  // Picos de solape por bloque (pico ≥ 2 ⇒ al menos otra persona afuera esos días).
  const overlapPeaks = useMemo(
    () => (data ? computeOverlapPeaks(data.empleados, anio) : new Map<string, number>()),
    [data, anio],
  );

  const months = useMemo(
    () => MESES.map((label, i) => ({ label, index: i, days: new Date(anio, i + 1, 0).getDate() })),
    [anio],
  );
  const totalDays = useMemo(() => months.reduce((s, m) => s + m.days, 0), [months]);

  const dateToDayOffset = (dateStr: string) => {
    const d = new Date(dateStr);
    const start = new Date(anio, 0, 1);
    const diff = Math.max(0, Math.floor((d.getTime() - start.getTime()) / 86400000));
    return Math.min(diff, totalDays - 1);
  };

  // Categorías presentes (para la leyenda).
  const activeCats = useMemo(() => {
    if (!data) return [] as Cat[];
    const set = new Set<Cat>();
    for (const emp of data.empleados) for (const b of emp.bloques) set.add(catOf(b.tipo));
    return CAT_ORDER.filter((c) => set.has(c));
  }, [data]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Leyenda */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
        {activeCats.map((c) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className={cn('w-3 h-3 rounded', CAT[c])} style={{ backgroundColor: 'currentColor' }} />
            {CAT_LABEL[c]}
          </span>
        ))}
        {activeCats.length === 0 && <span>Sin datos</span>}
        <span className="ml-2 flex items-center gap-2 text-[11px]">
          <span className="flex items-center gap-1">
            <span className="cal-estado relative inline-block w-3 h-3 text-muted-foreground" />
            aprobada
          </span>
          <span className="flex items-center gap-1">
            <span className="cal-estado relative inline-block w-3 h-3 text-muted-foreground" data-estado="EN_REVISION" />
            en revisión
          </span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border-2 border-cal-rose" /> solape</span>
        </span>
      </div>

      {/* Gantt */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {!data?.empleados.length ? (
          <div className="p-12 text-center">
            <Users className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-muted-foreground">No hay registros en {anio}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              {/* Header de meses */}
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

              {/* Filas de empleados */}
              {data.empleados.map((emp) => (
                <div key={emp.id} className="flex border-b border-border/50 hover:bg-muted/10 transition-colors">
                  <div className="w-48 min-w-48 px-3 py-2.5 border-r border-border flex flex-col justify-center">
                    <span className="text-sm font-medium truncate">{emp.apellido}, {emp.nombre}</span>
                    {emp.sector && (
                      <span className="text-[10px] text-muted-foreground truncate">{emp.sector.nombre}</span>
                    )}
                  </div>

                  <div className="flex-1 relative py-1.5 px-0.5" style={{ minHeight: '40px' }}>
                    {/* Gridlines de meses */}
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

                    {/* Marcador de hoy */}
                    {anio === new Date().getFullYear() && (() => {
                      const todayOffset = dateToDayOffset(new Date().toISOString());
                      return (
                        <div
                          className="absolute top-0 bottom-0 w-px bg-primary/60 z-10"
                          style={{ left: `${(todayOffset / totalDays) * 100}%` }}
                        />
                      );
                    })()}

                    {/* Barras */}
                    {emp.bloques.map((b) => {
                      const cat = catOf(b.tipo);
                      const peak = overlapPeaks.get(b.id);
                      const isOverlap = peak != null;
                      const startDay = dateToDayOffset(b.fechaInicio);
                      const endDay = dateToDayOffset(b.fechaFin);
                      const duration = Math.max(endDay - startDay + 1, 1);
                      const leftPct = (startDay / totalDays) * 100;
                      const widthPct = (duration / totalDays) * 100;
                      return (
                        <div
                          key={`${b.tipo}-${b.id}`}
                          className={cn('cal-estado absolute top-1/2 -translate-y-1/2 h-5', CAT[cat], isOverlap ? 'cursor-pointer' : 'cursor-default')}
                          data-estado={b.estado}
                          data-overlap={isOverlap ? (peak >= 3 ? '2' : '1') : undefined}
                          title={isOverlap ? 'Solape — clic para ver con quién' : undefined}
                          style={{ left: `${leftPct}%`, width: `max(${widthPct}%, 4px)` }}
                          onMouseEnter={() => setHovered({ ...b, cat, empNombre: `${emp.apellido}, ${emp.nombre}` })}
                          onMouseLeave={() => setHovered(null)}
                          onClick={() => { if (isOverlap) onOverlapSelect(b, emp.id, `${emp.apellido}, ${emp.nombre}`); }}
                        />
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
      {hovered && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-border bg-card shadow-lg p-4 max-w-xs">
          <p className="font-semibold text-sm">{hovered.empNombre}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {new Date(hovered.fechaInicio).toLocaleDateString('es-AR')} — {new Date(hovered.fechaFin).toLocaleDateString('es-AR')}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className={cn('w-2.5 h-2.5 rounded', CAT[hovered.cat])} style={{ backgroundColor: 'currentColor' }} />
            <span className="text-xs font-medium">{tipoLabel(hovered.tipo)}</span>
          </div>
          <p className="text-xs mt-1">
            <span className="font-medium">{hovered.dias} día{hovered.dias !== 1 ? 's' : ''}</span>
            <span className={cn('ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium', ESTADO_BADGE[hovered.estado] ?? 'bg-muted text-muted-foreground')}>
              {hovered.estado}
            </span>
          </p>
          {hovered.detalle && <p className="text-xs text-muted-foreground mt-1 italic">"{hovered.detalle}"</p>}
        </div>
      )}

      {/* Resumen */}
      {data && data.empleados.length > 0 && (
        <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
          <span>{data.empleados.length} empleados</span>
          <span>{data.empleados.reduce((s, e) => s + e.bloques.length, 0)} registros</span>
          <span>{data.empleados.reduce((s, e) => s + e.bloques.filter((b) => b.tipo === 'VACACION').length, 0)} vacaciones</span>
          <span>{data.empleados.reduce((s, e) => s + e.bloques.filter((b) => b.tipo.startsWith('AUSENCIA_')).length, 0)} ausencias</span>
        </div>
      )}
    </div>
  );
}
