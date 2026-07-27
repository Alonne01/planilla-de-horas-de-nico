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

/**
 * Cuántos ciclos ofrece el desplegable de período.
 *
 * Vive acá y no como un literal dentro de `PeriodSelector` porque la pantalla de
 * Cierre necesita generar EXACTAMENTE la misma lista para poder avisar por las
 * planillas cuyo período no anida en ninguno de los ciclos ofrecidos. Si los dos
 * números se desincronizan, el aviso pasa a hablar de ciclos que el selector no
 * muestra (o a callarse por ciclos que sí muestra).
 */
export const CICLOS_OFRECIDOS = 12;

export interface Cycle {
  inicio: string;
  fin: string;
  label: string;
}

/**
 * Construye una FECHA-DÍA sin desbordar al mes siguiente. `new Date(2026, 1, 31)`
 * devuelve el 3 de marzo; esto devuelve el 28 de febrero. Hace falta porque el
 * día de inicio del período lo elige el usuario y el backend acepta hasta 31.
 *
 * Se arma con `Date.UTC` y se lee con getters UTC porque el resultado sale de
 * acá hacia el API por `toISOString()`, y el sistema guarda una fecha que
 * representa un DÍA como medianoche UTC del día calendario argentino (misma
 * convención que `fechaEnMes` en apps/api/src/utils/calculo.utils.ts: hay que
 * mantenerlas iguales). Con el constructor local pedía el período a las 03:00Z.
 *
 * Consecuencia: TODO lo que lea estas fechas tiene que usar getters UTC
 * (`getUTCDate`, `getUTCMonth`, `getUTCFullYear`). Con getters locales, un
 * navegador al oeste de Greenwich muestra el día anterior.
 */
function fechaEnMes(anio: number, mes: number, dia: number): Date {
  const base = new Date(Date.UTC(anio, mes, 1)); // normaliza meses fuera de rango (negativos o >11)
  const ultimoDia = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), Math.min(dia, ultimoDia)));
}

export function generateCycles(
  count: number,
  diaInicio: number = DIA_INICIO_POR_DEFECTO,
  diaFin: number = DIA_FIN_POR_DEFECTO,
  hoy: Date = new Date(),
): Cycle[] {
  const cycles: Cycle[] = [];
  // `hoy` es un INSTANTE real, no una fecha-día: se lee con getters LOCALES a
  // propósito, porque el "hoy" que importa es el del calendario de quien está
  // mirando la pantalla. Sólo las fechas que salen de `fechaEnMes` son fechas-día
  // y se leen en UTC.
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

    // Getters UTC: `fechaEnMes` devuelve medianoche UTC del día argentino, y
    // leerla con getters locales desde cualquier huso negativo (el de Argentina,
    // sin ir más lejos) mostraría el día anterior en el label.
    const fYear = finDate.getUTCFullYear();
    // El año en el inicio solo se muestra si difiere del año del fin.
    const iYearStr = inicioDate.getUTCFullYear() !== fYear ? ` ${inicioDate.getUTCFullYear()}` : '';

    cycles.push({
      inicio: inicioDate.toISOString(),
      fin: finDate.toISOString(),
      label: `${inicioDate.getUTCDate()} ${MESES_ES[inicioDate.getUTCMonth()]}${iYearStr} - ${finDate.getUTCDate()} ${MESES_ES[finDate.getUTCMonth()]} ${fYear}`,
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
