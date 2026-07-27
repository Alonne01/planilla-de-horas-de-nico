/** Pure utility functions for planilla calendar, holidays, and diagram logic */

import { ymd } from './fechaDia';

/** Format a date as YYYY-MM-DD */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Feriados — SOLO inamovibles y trasladables (se pagan al 100% si se trabajan).
 * Los dias "puente" y "no laborables" NO cuentan: valen como dia comun.
 *
 * La lista que MANDA es la del servidor (GET /planillas/feriados: nacionales mas
 * los de la empresa, incluidos los del CCT petrolero). El front solo la pinta:
 * el flag esFeriado del registro lo deriva el backend al guardar, asi que una
 * lista propia aca solo lograria mostrar un feriado que la liquidacion no paga.
 *
 * Este seed queda como respaldo para el primer render y para modo offline, hasta
 * que responda cargarFeriados().
 */
const FERIADOS_SEED: Record<string, string> = {
  // 2025
  '2025-01-01': 'Año Nuevo',
  '2025-03-03': 'Carnaval',
  '2025-03-04': 'Carnaval',
  '2025-03-24': 'Día de la Memoria',
  '2025-04-02': 'Veteranos de Malvinas',
  '2025-04-18': 'Viernes Santo',
  '2025-05-01': 'Día del Trabajador',
  '2025-05-25': 'Revolución de Mayo',
  '2025-06-16': 'Paso a la Inmortalidad del Gral. Güemes (trasladado)',
  '2025-06-20': 'Paso a la Inmortalidad del Gral. Belgrano',
  '2025-07-09': 'Día de la Independencia',
  '2025-08-17': 'Paso a la Inmortalidad del Gral. San Martín',
  '2025-10-12': 'Día de la Diversidad Cultural',
  '2025-11-24': 'Día de la Soberanía Nacional (trasladado)',
  '2025-12-08': 'Inmaculada Concepción',
  '2025-12-25': 'Navidad',
  // 2026
  '2026-01-01': 'Año Nuevo',
  '2026-02-16': 'Carnaval',
  '2026-02-17': 'Carnaval',
  '2026-03-24': 'Día de la Memoria',
  '2026-04-02': 'Veteranos de Malvinas',
  '2026-04-03': 'Viernes Santo',
  '2026-05-01': 'Día del Trabajador',
  '2026-05-25': 'Revolución de Mayo',
  '2026-06-15': 'Paso a la Inmortalidad del Gral. Güemes (trasladado)',
  '2026-06-20': 'Paso a la Inmortalidad del Gral. Belgrano',
  '2026-07-09': 'Día de la Independencia',
  '2026-08-17': 'Paso a la Inmortalidad del Gral. San Martín',
  '2026-10-12': 'Día de la Diversidad Cultural',
  '2026-11-23': 'Día de la Soberanía Nacional (trasladado)',
  '2026-12-08': 'Inmaculada Concepción',
  '2026-12-25': 'Navidad',
};

const FERIADOS_CACHE_KEY = 'feriados-servidor-cache-v1';

/** Último mapa traído del servidor, para que el primer render offline no quede vacío. */
function cacheGuardado(): Record<string, string> | null {
  try {
    const crudo = localStorage.getItem(FERIADOS_CACHE_KEY);
    return crudo ? JSON.parse(crudo) : null;
  } catch {
    return null;
  }
}

let feriadosMap: Record<string, string> = cacheGuardado() ?? { ...FERIADOS_SEED };

/** True si la fecha (clave YYYY-MM-DD) es feriado a los efectos del recargo. */
export function esFeriadoNacional(key: string): boolean {
  return key in feriadosMap;
}

export function nombreFeriado(key: string): string | null {
  return feriadosMap[key] ?? null;
}

/**
 * Trae del servidor los feriados con los que se va a liquidar. Devuelve true si
 * cambió algo respecto de lo que ya se estaba mostrando (para forzar un repintado).
 * Si falla, se sigue usando lo último conocido: no hay razón para dejar el
 * calendario sin marcas por una petición caída.
 */
export async function cargarFeriados(
  traer: (url: string) => Promise<Record<string, string>>,
): Promise<boolean> {
  try {
    const delServidor = await traer('/planillas/feriados');
    if (!delServidor || typeof delServidor !== 'object') return false;

    const antes = JSON.stringify(feriadosMap);
    const ahora = JSON.stringify(delServidor);
    if (antes === ahora) return false;

    feriadosMap = delServidor;
    try { localStorage.setItem(FERIADOS_CACHE_KEY, ahora); } catch { /* cuota llena */ }
    return true;
  } catch {
    return false; // sin conexión o 5xx: queda el último mapa conocido
  }
}

export interface DiagramaInfo {
  id: string;
  nombre?: string;
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

// ── Estilo "pintado" de la celda del calendario (port de la PWA, vía tokens) ──
// Devuelve el relleno semántico de fondo + etiqueta + color de etiqueta de un día, con el ORDEN
// DE PRIORIDAD de la PWA mapeado al modelo del destino (lugar MAYÚSCULAS, ausencias/vacaciones/
// francos como `bloqueado`+`motivoBloqueo`). El cálculo de horas lo hace el backend: este helper
// NO recalcula nada, sólo decide colores. Los colores van por token (`text-cal-*`) y por paleta
// translúcida (funciona en los 6 temas claros/oscuros).

/** Subconjunto del registro que necesita el estilo de celda (evita acoplar el tipo de la página). */
export interface CellRegistro {
  lugarTrabajo: string | null;
  esFeriado: boolean;
  esFrancoTrabajado: boolean;
  esFrancoCompensatorio: boolean;
  bloqueado: boolean;
  motivoBloqueo: string | null;
  horasTrabajadas: string | number;
}

export interface CellCtx {
  /** Franco según el diagrama del usuario (contexto, no editable) */
  isFranco: boolean;
  /** Feriado nacional (contexto, no editable) */
  isFeriado: boolean;
}

export interface CellVisual {
  /** Clase(s) de fondo full-cell (puede ser '') */
  bgClass: string;
  /** Etiqueta corta del estado (puede ser '') */
  label: string;
  /** Clase de color de la etiqueta (token cal-*) */
  labelClass: string;
}

export function cellStyle(reg: CellRegistro | undefined, ctx: CellCtx): CellVisual {
  // Sin registro guardado → sólo contexto (feriado / franco por diagrama).
  if (!reg) {
    if (ctx.isFeriado) return { bgClass: 'bg-amber-500/12', label: 'Feriado', labelClass: 'text-cal-amber' };
    if (ctx.isFranco) return { bgClass: 'bg-muted/20', label: 'Franco', labelClass: 'text-muted-foreground' };
    return { bgClass: '', label: '', labelClass: '' };
  }

  // Día bloqueado (ausencia / vacación / falta / licencia / compensatorio gestionado fuera).
  if (reg.bloqueado) {
    switch (reg.motivoBloqueo) {
      case 'VACACION':
        return { bgClass: 'bg-teal-500/14', label: 'Vacac.', labelClass: 'text-cal-teal' };
      case 'FALTA_INJUSTIFICADA':
        return { bgClass: 'bg-rose-500/16', label: 'Falta', labelClass: 'text-cal-rose' };
      case 'FALTA_JUSTIFICADA':
      case 'CERTIFICADO_MEDICO':
        return { bgClass: 'bg-red-500/12', label: 'Ausencia', labelClass: 'text-cal-red' };
      case 'FRANCO_COMPENSATORIO':
        return { bgClass: 'bg-violet-500/16', label: 'F.Comp', labelClass: 'text-cal-violet' };
      case 'LICENCIA_ESPECIAL':
        return { bgClass: 'bg-violet-500/12', label: 'Licencia', labelClass: 'text-cal-violet' };
      default:
        return { bgClass: 'bg-violet-500/12', label: 'Ausencia', labelClass: 'text-cal-violet' };
    }
  }

  // Con registro de trabajo (orden de prioridad de la PWA).
  if (reg.esFrancoCompensatorio) return { bgClass: 'bg-violet-500/16', label: 'F.Comp', labelClass: 'text-cal-violet' };
  if (reg.esFrancoTrabajado) return { bgClass: 'bg-cyan-500/16', label: 'F.Trab', labelClass: 'text-cal-cyan' };

  const sinHoras = Number(reg.horasTrabajadas) <= 0;
  if (reg.esFeriado && sinHoras) return { bgClass: 'bg-amber-500/12', label: 'Feriado', labelClass: 'text-cal-amber' };
  if (reg.esFeriado) return { bgClass: 'bg-orange-500/16', label: 'F.Trab', labelClass: 'text-cal-orange' }; // feriado trabajado
  if (reg.lugarTrabajo === 'CAMPO') return { bgClass: 'bg-emerald-500/16', label: 'Campo', labelClass: 'text-cal-emerald' };
  if (reg.lugarTrabajo === 'BASE') return { bgClass: 'bg-blue-500/16', label: 'Base', labelClass: 'text-cal-blue' };
  if (ctx.isFranco) return { bgClass: 'bg-muted/20', label: 'Franco', labelClass: 'text-muted-foreground' };
  return { bgClass: '', label: '', labelClass: '' };
}

/** Build all calendar days for a 21→20 period */
export function buildCalendarDays(periodoInicio: string, periodoFin: string): Date[] {
  // Las puntas son fechas-DÍA: se toman del string. `new Date(iso)` las correría
  // un día en cualquier huso negativo (ver utils/fechaDia.ts).
  const [yi, mi, di] = ymd(periodoInicio);
  const [yf, mf, df] = ymd(periodoFin);
  const start = new Date(yi, mi - 1, di, 12, 0, 0);
  const end = new Date(yf, mf - 1, df, 12, 0, 0);
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
