import api from '@/services/api';
import { type DiagramaInfo } from '@/utils/planillaHelpers';

export interface Sector { id: string; nombre: string }
export type EmpDiagrama = DiagramaInfo & { fechaInicio: string };
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
  diagrama?: EmpDiagrama | null;
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

// Parse date-only (sin `new Date(iso)`): el backend serializa fechas server-local
// vía .toISOString(); construir un Date acá correría el día en algunas timezones.
export function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return [y, m, d];
}
export function daysInMonth(year: number, monthIndex0: number) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}
export function fmtDate(iso: string) {
  const [y, m, d] = ymd(iso);
  return new Date(y, m - 1, d).toLocaleDateString('es-AR');
}
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
// Offsets día-del-año por mes (leap-aware).
export function monthOffsets(anio: number): { monthOffset: number[]; totalDays: number } {
  const monthOffset: number[] = [];
  let acc = 0;
  for (let mi = 0; mi < 12; mi++) { monthOffset[mi] = acc; acc += daysInMonth(anio, mi); }
  return { monthOffset, totalDays: acc };
}

// Rango [inicio,fin] en día-del-año de un bloque, acotado al año (null si queda afuera).
export function blockDoyRange(
  fechaInicio: string, fechaFin: string, year: number, monthOffset: number[], totalDays: number,
): [number, number] | null {
  const [y1, m1, d1] = ymd(fechaInicio);
  const [y2, m2, d2] = ymd(fechaFin);
  if (y1 > year || y2 < year) return null;
  const start = y1 < year ? 0 : monthOffset[m1 - 1] + (d1 - 1);
  const end = y2 > year ? totalDays - 1 : monthOffset[m2 - 1] + (d2 - 1);
  return [Math.max(0, start), Math.min(totalDays - 1, end)];
}

// Pico de ocupación por bloque countable (≥2 ⇒ al menos otra persona afuera esos
// días). Cada empleado cuenta 1 por día. Devuelve sólo los bloques con pico ≥ 2.
export function computeOverlapPeaks(empleados: Empleado[], anio: number): Map<string, number> {
  const { monthOffset, totalDays } = monthOffsets(anio);
  const counts = new Int16Array(totalDays);
  for (const emp of empleados) {
    const doySet = new Set<number>();
    for (const b of emp.bloques) {
      if (!COUNTABLE[catOf(b.tipo)]) continue;
      const rg = blockDoyRange(b.fechaInicio, b.fechaFin, anio, monthOffset, totalDays);
      if (!rg) continue;
      for (let d = rg[0]; d <= rg[1]; d++) doySet.add(d);
    }
    for (const d of doySet) counts[d]++;
  }
  const peaks = new Map<string, number>();
  for (const emp of empleados) {
    for (const b of emp.bloques) {
      if (!COUNTABLE[catOf(b.tipo)]) continue;
      const rg = blockDoyRange(b.fechaInicio, b.fechaFin, anio, monthOffset, totalDays);
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
  empleados: Empleado[], block: Bloque, clickedEmpId: string, anio: number,
): Set<string> {
  const { monthOffset, totalDays } = monthOffsets(anio);
  const ids = new Set<string>();
  const range = blockDoyRange(block.fechaInicio, block.fechaFin, anio, monthOffset, totalDays);
  if (!range) return ids;
  const [s0, s1] = range;
  for (const emp of empleados) {
    if (emp.id === clickedEmpId) continue;
    for (const b of emp.bloques) {
      if (!COUNTABLE[catOf(b.tipo)]) continue;
      const rg = blockDoyRange(b.fechaInicio, b.fechaFin, anio, monthOffset, totalDays);
      if (!rg || rg[0] > s1 || rg[1] < s0) continue;
      ids.add(emp.id);
      break;
    }
  }
  return ids;
}
