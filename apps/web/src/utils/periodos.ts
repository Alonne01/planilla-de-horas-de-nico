/**
 * Matemática de los ciclos de planilla. Sin React a propósito: es lógica pura
 * y así se puede testear con `npx tsx src/utils/periodos.test.ts`.
 *
 * Los días de inicio y fin del ciclo los configura el usuario en Administración
 * > Configuración y los sirve `GET /config/periodo`. Los defaults 21/20 son solo
 * un último recurso para el primer render, antes de que llegue la respuesta.
 */

const MESES_ES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

export const DIA_INICIO_POR_DEFECTO = 21;
export const DIA_FIN_POR_DEFECTO = 20;

export interface Cycle {
  inicio: string;
  fin: string;
  label: string;
}

/**
 * Construye una fecha sin desbordar al mes siguiente. `new Date(2026, 1, 31)`
 * devuelve el 3 de marzo; esto devuelve el 28 de febrero. Hace falta porque el
 * día de inicio del período lo elige el usuario y el backend acepta hasta 31.
 */
function fechaEnMes(anio: number, mes: number, dia: number): Date {
  const base = new Date(anio, mes, 1); // normaliza meses fuera de rango (negativos o >11)
  const ultimoDia = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  return new Date(base.getFullYear(), base.getMonth(), Math.min(dia, ultimoDia));
}

export function generateCycles(
  count: number,
  diaInicio: number = DIA_INICIO_POR_DEFECTO,
  diaFin: number = DIA_FIN_POR_DEFECTO,
  hoy: Date = new Date(),
): Cycle[] {
  const cycles: Cycle[] = [];
  let startYear = hoy.getFullYear();
  let startMonth = hoy.getMonth();

  if (hoy.getDate() < diaInicio) {
    // Todavía no arrancó el ciclo de este mes: el vigente empezó el mes pasado.
    startMonth -= 1;
    if (startMonth < 0) {
      startMonth = 11;
      startYear -= 1;
    }
  }

  for (let i = 0; i < count; i++) {
    const inicioDate = fechaEnMes(startYear, startMonth - i, diaInicio);
    const finDate = fechaEnMes(startYear, startMonth - i + 1, diaFin);

    const fYear = finDate.getFullYear();
    // El año en el inicio solo se muestra si difiere del año del fin.
    const iYearStr = inicioDate.getFullYear() !== fYear ? ` ${inicioDate.getFullYear()}` : '';

    cycles.push({
      inicio: inicioDate.toISOString(),
      fin: finDate.toISOString(),
      label: `${inicioDate.getDate()} ${MESES_ES[inicioDate.getMonth()]}${iYearStr} - ${finDate.getDate()} ${MESES_ES[finDate.getMonth()]} ${fYear}`,
    });
  }

  return cycles;
}

export function getCurrentPeriod(
  diaInicio: number = DIA_INICIO_POR_DEFECTO,
  diaFin: number = DIA_FIN_POR_DEFECTO,
  hoy: Date = new Date(),
): { inicio: string; fin: string } {
  const [current] = generateCycles(1, diaInicio, diaFin, hoy);
  return { inicio: current.inicio, fin: current.fin };
}
