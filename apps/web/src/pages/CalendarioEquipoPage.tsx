import { useQuery } from '@tanstack/react-query';
import { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, CalendarRange, Lock, LayoutList, CalendarDays, X } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import {
  type GanttData, type Bloque, calendarQueryKey, fetchCalendar, fmtDate, overlappingEmployeeIds,
} from '@/components/calendario/shared';
import CalendarioCompacto from '@/components/calendario/CalendarioCompacto';
import CalendarioDetallado from '@/components/calendario/CalendarioDetallado';

interface OverlapSel { block: Bloque; empId: string; empName: string; }

type Modo = 'compacto' | 'detallado';
const MODO_KEY = 'calendario-equipo-modo';
function loadModo(): Modo {
  try { return localStorage.getItem(MODO_KEY) === 'detallado' ? 'detallado' : 'compacto'; } catch { return 'compacto'; }
}

export default function CalendarioEquipoPage() {
  const user = useAuthStore((s) => s.user);
  const isRRHH = (user?.rolNivel ?? 0) >= 90;
  const puedeVer = user?.puedeVerCalendario ?? false;

  const [anio, setAnio] = useState(new Date().getFullYear());
  const [sectorId, setSectorId] = useState('');
  const [modo, setModoState] = useState<Modo>(loadModo);
  const [overlap, setOverlap] = useState<OverlapSel | null>(null);
  const setModo = (m: Modo) => {
    setModoState(m);
    try { localStorage.setItem(MODO_KEY, m); } catch { /* ignore */ }
  };

  const { data, isLoading } = useQuery<GanttData>({
    queryKey: calendarQueryKey(anio, sectorId),
    queryFn: () => fetchCalendar(anio, sectorId),
    enabled: puedeVer,
  });

  // El filtro de solape deja de ser válido si cambia el año o el sector.
  useEffect(() => { setOverlap(null); }, [anio, sectorId]);

  // Datos pasados al subcomponente: con filtro activo, sólo el empleado clickeado
  // + los que se solapan con ese bloque.
  const viewData = useMemo<GanttData | undefined>(() => {
    if (!data || !overlap) return data;
    const ids = overlappingEmployeeIds(data.empleados, overlap.block, overlap.empId, anio);
    ids.add(overlap.empId);
    return { ...data, empleados: data.empleados.filter((e) => ids.has(e.id)) };
  }, [data, overlap, anio]);

  const overlapCount = viewData && overlap ? Math.max(0, viewData.empleados.length - 1) : 0;

  if (user && !puedeVer) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground">
        <Lock className="h-10 w-10 mb-3 opacity-50" />
        <p>No tenés permisos para ver el calendario del equipo.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar compartida: título + toggle de modo + sector (RRHH) + año */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarRange className="h-6 w-6 text-primary" />
          Calendario de Equipo
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
            <button
              type="button"
              onClick={() => setModo('compacto')}
              aria-pressed={modo === 'compacto'}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                modo === 'compacto' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <LayoutList className="h-4 w-4" /> Compacto
            </button>
            <button
              type="button"
              onClick={() => setModo('detallado')}
              aria-pressed={modo === 'detallado'}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                modo === 'detallado' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <CalendarDays className="h-4 w-4" /> Detallado
            </button>
          </div>

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
            <button onClick={() => setAnio((a) => a - 1)} className="p-2 rounded-lg hover:bg-muted/50 transition-colors" aria-label="Año anterior">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-lg font-bold min-w-[4ch] text-center tabular-nums">{anio}</span>
            <button onClick={() => setAnio((a) => a + 1)} className="p-2 rounded-lg hover:bg-muted/50 transition-colors" aria-label="Año siguiente">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Banner del filtro de solape (ambos modos) */}
      {overlap && (
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-cal-rose/40 bg-cal-rose/10 px-3 py-2 text-sm">
          <span className="text-foreground">
            Mostrando a <span className="font-semibold">{overlap.empName}</span> y {overlapCount}{' '}
            {overlapCount === 1 ? 'persona que se solapa' : 'personas que se solapan'}
            <span className="text-muted-foreground"> ({fmtDate(overlap.block.fechaInicio)}–{fmtDate(overlap.block.fechaFin)})</span>
          </span>
          <button
            type="button"
            onClick={() => setOverlap(null)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-muted/50"
          >
            <X className="h-3.5 w-3.5" /> Mostrar todos
          </button>
        </div>
      )}

      {modo === 'compacto'
        ? <CalendarioCompacto data={viewData} anio={anio} isLoading={isLoading} onOverlapSelect={(block, empId, empName) => setOverlap({ block, empId, empName })} />
        : <CalendarioDetallado data={viewData} anio={anio} isLoading={isLoading} onOverlapSelect={(block, empId, empName) => setOverlap({ block, empId, empName })} />}
    </div>
  );
}
