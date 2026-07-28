import api from '@/services/api';
import { type DiagramaInfo } from '@/utils/planillaHelpers';
import { type Ventana, rangoEnVentana } from './ventana';

export interface Sector { id: string; nombre: string }
/** Un tramo de vigencia, tal como lo manda el gantt. */
export interface TramoEmp {
  diagrama: DiagramaInfo;
  fechaInicio: string;
  fechaFin: string | null;
}
export interface Bloque {
  id: string;
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  estado: string;
  tipo: string;
  detalle: string | null;
}
export interface Empleado {
  id: string;
  nombre: string;
  apellido: string;
  legajo: string | null;
  sector: Sector | null;
  tramos?: TramoEmp[];
  bloques: Bloque[];
}
export interface GanttData {
  anio: number;
  sectores: Sector[];
  empleados: Empleado[];
}

export const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
export const DOW_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export type Cat = 'VACACION' | 'AUSENCIA' | 'FRANCO' | 'CAPACITACION' | 'DESCANSO';

// Clases literales (nunca interpolar `text-cal-${cat}`: Tailwind v4 JIT lo purga).
export const CAT: Record<Cat, string> = {
  VACACION: 'text-cal-teal',
  AUSENCIA: 'text-cal-red',
  FRANCO: 'text-cal-violet',
  CAPACITACION: 'text-cal-blue',
  DESCANSO: 'text-muted-foreground',
};
export const CAT_LABEL: Record<Cat, string> = {
  VACACION: 'Vacación',
  AUSENCIA: 'Ausencia / Licencia',
  FRANCO: 'Franco comp.',
  CAPACITACION: 'Capacitación',
  DESCANSO: 'Franco / Descanso',
};
export const ESTADO_BADGE: Record<string, string> = {
  APROBADA: 'bg-cal-emerald/20 text-cal-emerald',
  EN_REVISION: 'bg-cal-amber/20 text-cal-amber',
  PENDIENTE: 'bg-cal-blue/20 text-cal-blue',
};
// Categorías que cuentan para el solape (ausencia real). DESCANSO/CAPACITACION no.
export const COUNTABLE: Record<Cat, boolean> = {
  VACACION: true, AUSENCIA: true, FRANCO: true, CAPACITACION: false, DESCANSO: false,
};
export const CAT_ORDER: Cat[] = ['VACACION', 'AUSENCIA', 'FRANCO', 'CAPACITACION'];

export function catOf(tipo: string): Cat {
  if (tipo === 'VACACION') return 'VACACION';
  if (tipo === 'AUSENCIA_FRANCO_COMPENSATORIO') return 'FRANCO';
  if (tipo === 'CAPACITACION') return 'CAPACITACION';
  return 'AUSENCIA'; // cualquier otro AUSENCIA_*
}

// Etiqueta del TIPO exacto (para el tooltip), preservando la granularidad.
export const TIPO_LABEL: Record<string, string> = {
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
export function tipoLabel(tipo: string): string {
  return TIPO_LABEL[tipo] ?? tipo;
}

// Parse date-only (sin `new Date(iso)`): el backend serializa las fechas-día con
// .toISOString(); construir un Date acá correría el día en algunas timezones.
// La implementación vive en utils/fechaDia.ts (autoridad única): acá sólo se
// re-exporta con los nombres que ya usaban los calendarios.
export { ymd, fmtDia as fmtDate } from '@/utils/fechaDia';

// El eje del calendario (ventana de meses, índices de día, recortes). Se
// re-exporta acá para que los dos componentes sigan importando de un solo lugar.
// `daysInMonth(anio, mes0)` era la versión 0-based de `diasDelMes(anio, mes)`:
// OJO al migrar llamadas, el mes ahora va 1-12.
export * from './ventana';

export function norm(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Query compartida del calendario de equipo (ambos modos). Siempre `todos=1`.
export function calendarQueryKey(anio: number, sectorId: string) {
  return ['calendario-equipo', anio, sectorId] as const;
}
export async function fetchCalendar(anio: number, sectorId: string): Promise<GanttData> {
  const params = new URLSearchParams({ anio: String(anio), todos: '1' });
  if (sectorId) params.set('sectorId', sectorId);
  return (await api.get(`/vacaciones/gantt?${params}`)).data;
}

// ── Solapes (overlap) ──────────────────────────────────────────────────────
//
// El pico se mide DENTRO DE LA VENTANA: en la vista de un mes, el badge cuenta la
// gente que se pisa ese mes, no en todo el año. Es lo que el zoom tiene que
// responder —"quién más está afuera estos días"— pero es un cambio observable
// respecto de cuando el eje era el año entero: el mismo bloque puede mostrar
// pico 3 en la vista anual y 2 en la mensual, y las dos cifras son correctas
// para lo que cada vista pregunta.

// Pico de ocupación por bloque countable (≥2 ⇒ al menos otra persona afuera esos
// días). Cada empleado cuenta 1 por día. Devuelve sólo los bloques con pico ≥ 2.
export function computeOverlapPeaks(empleados: Empleado[], v: Ventana): Map<string, number> {
  const counts = new Int16Array(v.totalDias);
  for (const emp of empleados) {
    const dias = new Set<number>();
    for (const b of emp.bloques) {
      if (!COUNTABLE[catOf(b.tipo)]) continue;
      const rg = rangoEnVentana(b.fechaInicio, b.fechaFin, v);
      if (!rg) continue;
      for (let d = rg[0]; d <= rg[1]; d++) dias.add(d);
    }
    for (const d of dias) counts[d]++;
  }
  const peaks = new Map<string, number>();
  for (const emp of empleados) {
    for (const b of emp.bloques) {
      if (!COUNTABLE[catOf(b.tipo)]) continue;
      const rg = rangoEnVentana(b.fechaInicio, b.fechaFin, v);
      if (!rg) continue;
      let peak = 0;
      for (let d = rg[0]; d <= rg[1]; d++) if (counts[d] > peak) peak = counts[d];
      if (peak >= 2) peaks.set(b.id, peak);
    }
  }
  return peaks;
}

// IDs de empleados (excluye al clickeado) cuyo bloque countable se solapa con el
// rango del bloque dado.
export function overlappingEmployeeIds(
  empleados: Empleado[], block: Bloque, clickedEmpId: string, v: Ventana,
): Set<string> {
  const ids = new Set<string>();
  const range = rangoEnVentana(block.fechaInicio, block.fechaFin, v);
  if (!range) return ids;
  const [s0, s1] = range;
  for (const emp of empleados) {
    if (emp.id === clickedEmpId) continue;
    for (const b of emp.bloques) {
      if (!COUNTABLE[catOf(b.tipo)]) continue;
      const rg = rangoEnVentana(b.fechaInicio, b.fechaFin, v);
      if (!rg || rg[0] > s1 || rg[1] < s0) continue;
      ids.add(emp.id);
      break;
    }
  }
  return ids;
}
