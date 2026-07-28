import { useQueries } from '@tanstack/react-query';
import { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, CalendarRange, Lock, LayoutList, CalendarDays, X } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import { hoyKey, ymd } from '@/utils/fechaDia';
import {
  type GanttData, type Empleado, type Bloque, type Ventana,
  MESES, calendarQueryKey, fetchCalendar, fmtDate, overlappingEmployeeIds,
  aniosDeVentana, ventanaAnual, ventanaDeMeses,
} from '@/components/calendario/shared';
import CalendarioCompacto from '@/components/calendario/CalendarioCompacto';
import CalendarioDetallado from '@/components/calendario/CalendarioDetallado';

interface OverlapSel { block: Bloque; empId: string; empName: string; }

type Modo = 'compacto' | 'detallado';
const MODO_KEY = 'calendario-equipo-modo';
function loadModo(): Modo {
  try { return localStorage.getItem(MODO_KEY) === 'detallado' ? 'detallado' : 'compacto'; } catch { return 'compacto'; }
}

/**
 * El zoom. "Año" es la vista de siempre; "trimestre" y "mes" son las que dejan
 * ver de cerca qué días se solapan, que en 12 meses de ancho se pierden.
 */
type Zoom = 'anio' | 'trimestre' | 'mes';
const ZOOM_KEY = 'calendario-equipo-zoom';
const MESES_POR_ZOOM: Record<Zoom, number> = { anio: 12, trimestre: 3, mes: 1 };
function loadZoom(): Zoom {
  try {
    const v = localStorage.getItem(ZOOM_KEY);
    return v === 'trimestre' || v === 'mes' ? v : 'anio';
  } catch { return 'anio'; }
}

/** Etiqueta del rango que se está mirando, para el centro de la barra. */
function etiquetaVentana(v: Ventana): string {
  const primero = v.meses[0]!;
  const ultimo = v.meses[v.meses.length - 1]!;
  if (v.meses.length === 12 && primero.mes === 1) return String(primero.anio);
  if (v.meses.length === 1) return `${MESES[primero.mes - 1]} ${primero.anio}`;
  if (primero.anio === ultimo.anio) {
    return `${MESES[primero.mes - 1]} – ${MESES[ultimo.mes - 1]} ${primero.anio}`;
  }
  return `${MESES[primero.mes - 1]} ${primero.anio} – ${MESES[ultimo.mes - 1]} ${ultimo.anio}`;
}

/**
 * Une las respuestas de varios años en un solo gantt.
 *
 * Una ventana que cruza diciembre necesita dos años, y un bloque que cruza el 31
 * viene en las DOS respuestas: se deduplica por id. Los tramos de diagrama no
 * tienen id propio en el gantt, así que se deduplican por diagrama + fecha de
 * inicio.
 */
function fusionarGantt(partes: GanttData[]): GanttData | undefined {
  if (partes.length === 0) return undefined;
  if (partes.length === 1) return partes[0];
  const porEmpleado = new Map<string, Empleado>();
  for (const parte of partes) {
    for (const emp of parte.empleados) {
      const acc = porEmpleado.get(emp.id);
      if (!acc) {
        porEmpleado.set(emp.id, { ...emp, bloques: [...emp.bloques], tramos: [...(emp.tramos ?? [])] });
        continue;
      }
      const bloquesVistos = new Set(acc.bloques.map((b) => b.id));
      for (const b of emp.bloques) if (!bloquesVistos.has(b.id)) acc.bloques.push(b);
      const tramosVistos = new Set((acc.tramos ?? []).map((t) => `${t.diagrama.id}|${t.fechaInicio}`));
      for (const t of emp.tramos ?? []) {
        const k = `${t.diagrama.id}|${t.fechaInicio}`;
        if (!tramosVistos.has(k)) { acc.tramos!.push(t); tramosVistos.add(k); }
      }
    }
  }
  const empleados = [...porEmpleado.values()].sort((a, b) => a.apellido.localeCompare(b.apellido));
  for (const e of empleados) e.bloques.sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio));
  return { anio: partes[0]!.anio, sectores: partes[0]!.sectores, empleados };
}

export default function CalendarioEquipoPage() {
  const user = useAuthStore((s) => s.user);
  const isRRHH = (user?.rolNivel ?? 0) >= 90;
  const puedeVer = user?.puedeVerCalendario ?? false;

  // El ancla arranca en el mes de HOY, leído con `hoyKey()`: con
  // `new Date().getMonth()` en el último día del mes a la noche, el huso puede
  // dar el mes siguiente.
  const [hoyAnio, hoyMes] = ymd(hoyKey());
  const [zoom, setZoomState] = useState<Zoom>(loadZoom);
  const [ancla, setAncla] = useState({ anio: hoyAnio, mes: hoyMes });
  const [sectorId, setSectorId] = useState('');
  const [modo, setModoState] = useState<Modo>(loadModo);
  const [overlap, setOverlap] = useState<OverlapSel | null>(null);

  const setModo = (m: Modo) => {
    setModoState(m);
    try { localStorage.setItem(MODO_KEY, m); } catch { /* ignore */ }
  };
  const setZoom = (z: Zoom) => {
    setZoomState(z);
    try { localStorage.setItem(ZOOM_KEY, z); } catch { /* ignore */ }
  };

  const ventana = useMemo(
    () => (zoom === 'anio'
      ? ventanaAnual(ancla.anio)
      : ventanaDeMeses(ancla.anio, ancla.mes, MESES_POR_ZOOM[zoom])),
    [zoom, ancla],
  );

  // En modo año las flechas mueven un año (como siempre); con zoom, un mes.
  const mover = (pasos: number) => {
    setAncla((a) => {
      if (zoom === 'anio') return { ...a, anio: a.anio + pasos };
      const total = a.anio * 12 + (a.mes - 1) + pasos;
      return { anio: Math.floor(total / 12), mes: (total % 12) + 1 };
    });
  };

  // Una ventana que cruza diciembre toca dos años y hay que pedir los dos: el
  // gantt está indexado por año.
  const anios = useMemo(() => aniosDeVentana(ventana), [ventana]);

  const resultados = useQueries({
    queries: anios.map((a) => ({
      queryKey: calendarQueryKey(a, sectorId),
      queryFn: () => fetchCalendar(a, sectorId),
      enabled: puedeVer,
    })),
  });

  const isLoading = resultados.some((r) => r.isLoading);
  const data = useMemo(
    () => fusionarGantt(resultados.map((r) => r.data).filter(Boolean) as GanttData[]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resultados.map((r) => r.dataUpdatedAt).join('|')],
  );

  // El filtro de solape deja de ser válido si cambia la ventana o el sector: el
  // bloque seleccionado puede no estar más a la vista.
  useEffect(() => { setOverlap(null); }, [ventana, sectorId]);

  // Datos pasados al subcomponente: con filtro activo, sólo el empleado clickeado
  // + los que se solapan con ese bloque.
  const viewData = useMemo<GanttData | undefined>(() => {
    if (!data || !overlap) return data;
    const ids = overlappingEmployeeIds(data.empleados, overlap.block, overlap.empId, ventana);
    ids.add(overlap.empId);
    return { ...data, empleados: data.empleados.filter((e) => ids.has(e.id)) };
  }, [data, overlap, ventana]);

  const overlapCount = viewData && overlap ? Math.max(0, viewData.empleados.length - 1) : 0;

  if (user && !puedeVer) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground">
        <Lock className="h-10 w-10 mb-3 opacity-50" />
        <p>No tenés permisos para ver el calendario del equipo.</p>
      </div>
    );
  }

  const zooms: { key: Zoom; label: string }[] = [
    { key: 'anio', label: 'Año' },
    { key: 'trimestre', label: 'Trimestre' },
    { key: 'mes', label: 'Mes' },
  ];

  return (
    <div className="space-y-3">
      {/* Toolbar compartida: título + toggle de modo + zoom + sector (RRHH) + navegación */}
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

          <div className="inline-flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Zoom del calendario">
            {zooms.map((z) => (
              <button
                key={z.key}
                type="button"
                onClick={() => setZoom(z.key)}
                aria-pressed={zoom === z.key}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-sm transition-colors',
                  zoom === z.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {z.label}
              </button>
            ))}
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
            <button onClick={() => mover(-1)} className="p-2 rounded-lg hover:bg-muted/50 transition-colors" aria-label={zoom === 'anio' ? 'Año anterior' : 'Mes anterior'}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-lg font-bold min-w-[4ch] text-center tabular-nums">{etiquetaVentana(ventana)}</span>
            <button onClick={() => mover(1)} className="p-2 rounded-lg hover:bg-muted/50 transition-colors" aria-label={zoom === 'anio' ? 'Año siguiente' : 'Mes siguiente'}>
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
        ? <CalendarioCompacto data={viewData} ventana={ventana} isLoading={isLoading} onOverlapSelect={(block, empId, empName) => setOverlap({ block, empId, empName })} />
        : <CalendarioDetallado data={viewData} ventana={ventana} isLoading={isLoading} onOverlapSelect={(block, empId, empName) => setOverlap({ block, empId, empName })} />}
    </div>
  );
}
