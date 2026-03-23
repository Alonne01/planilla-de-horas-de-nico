/** Pure utility functions for planilla calendar, holidays, and diagram logic */

/** Format a date as YYYY-MM-DD */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Easter Sunday dates by year (month, day) */
const EASTER_SUNDAY: Record<number, [number, number]> = {
  2024: [3, 31], 2025: [4, 20], 2026: [4, 5], 2027: [3, 28], 2028: [4, 16],
};

/** Argentine public holidays (fixed + movable) */
export function buildArgHolidays(year: number): Set<string> {
  const fmt = (m: number, d: number) =>
    `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const fixed = [
    fmt(1, 1),
    fmt(3, 24), fmt(4, 2), fmt(5, 1), fmt(5, 25),
    fmt(6, 20), fmt(7, 9), fmt(8, 17), fmt(10, 12),
    fmt(11, 20), fmt(12, 8), fmt(12, 25),
  ];
  const easter = EASTER_SUNDAY[year];
  if (easter) {
    const [em, ed] = easter;
    fixed.push(fmt(em, ed - 2)); // Viernes Santo
    fixed.push(fmt(em, ed));     // Domingo Pascua
    // Carnaval: 48 and 47 days before Easter Sunday
    const easterDate = new Date(year, em - 1, ed);
    const carnavalMon = new Date(easterDate);
    carnavalMon.setDate(carnavalMon.getDate() - 48);
    const carnavalTue = new Date(easterDate);
    carnavalTue.setDate(carnavalTue.getDate() - 47);
    fixed.push(dateKey(carnavalMon), dateKey(carnavalTue));
  }
  return new Set(fixed);
}

/** Días no laborables: el empleador decide si se trabaja o no */
export function buildDiasNoLaborables(year: number): Set<string> {
  const fmt = (m: number, d: number) =>
    `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const easter = EASTER_SUNDAY[year];
  const dias = [
    fmt(3, 23),
    fmt(12, 24),
    fmt(12, 31),
  ];
  if (easter) {
    const [em, ed] = easter;
    dias.push(fmt(em, ed - 3)); // Jueves Santo (Easter Sunday - 3)
  }
  return new Set(dias);
}

export interface DiagramaInfo {
  id: string;
  tipo: string;
  diasTrabajo: number | null;
  diasDescanso: number | null;
  diasSemana: number[];
}

/**
 * Returns true if the given date falls on a REST (franco) day
 * based on the diagram cycle starting from fechaInicioDiagrama.
 *
 * ROTATIVO: cycles work days then rest days from the start date.
 * FIJO_SEMANA: days NOT in diasSemana (0=Sun..6=Sat) are rest days.
 */
export function esDiaFranco(fecha: Date, diagrama: DiagramaInfo, fechaInicio: Date): boolean {
  if (diagrama.tipo === 'ROTATIVO') {
    const ciclo = (diagrama.diasTrabajo ?? 0) + (diagrama.diasDescanso ?? 0);
    if (ciclo === 0) return false;
    const msPerDay = 86400000;
    const startMs = Date.UTC(fechaInicio.getFullYear(), fechaInicio.getMonth(), fechaInicio.getDate());
    const fechaMs = Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    const diffDias = Math.round((fechaMs - startMs) / msPerDay);
    const pos = ((diffDias % ciclo) + ciclo) % ciclo;
    return pos >= (diagrama.diasTrabajo ?? 0);
  }
  if (diagrama.tipo === 'FIJO_SEMANA') {
    return !diagrama.diasSemana.includes(fecha.getDay());
  }
  return false;
}

/** Build all calendar days for a 21→20 period */
export function buildCalendarDays(periodoInicio: string, periodoFin: string): Date[] {
  const start = new Date(periodoInicio);
  const end = new Date(periodoFin);
  const days: Date[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/** Group days into weeks (Mon=0 → Sun=6) */
export function buildWeeks(days: Date[]): (Date | null)[][] {
  const weeks: (Date | null)[][] = [];
  let currentWeek: (Date | null)[] = [];

  const firstDow = (days[0].getDay() + 6) % 7; // Mon=0
  for (let i = 0; i < firstDow; i++) currentWeek.push(null);

  for (const d of days) {
    currentWeek.push(d);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push(null);
    weeks.push(currentWeek);
  }

  return weeks;
}
