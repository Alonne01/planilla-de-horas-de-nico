import { z } from 'zod';
import { diaDesdeEntrada } from './fecha-dia.utils.js';

/**
 * Schema de fecha flexible: acepta fecha-sola "YYYY-MM-DD" o ISO 8601 datetime
 * completo (p. ej. "2026-06-01T00:00:00.000Z"). Devuelve el string sin transformar,
 * por lo que los handlers existentes (que hacen `new Date(valor)`) siguen funcionando.
 *
 * Reemplaza a `z.string().datetime()`, que rechazaba el formato fecha-sola y obligaba
 * a los clientes a mandar siempre el datetime completo.
 */
export const fechaFlexible = z.string().refine(
  (s) => /^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(s) && !Number.isNaN(Date.parse(s)),
  { message: 'Fecha inválida (use formato YYYY-MM-DD o ISO 8601)' },
);

/**
 * Fecha-DÍA: valida igual que `fechaFlexible` pero **devuelve un `Date` ya
 * normalizado** a medianoche UTC del día calendario argentino.
 *
 * Los handlers no tienen que decidir nada: da lo mismo si el cliente manda
 * "2026-07-31", "2026-07-31T00:00:00-03:00" o un ISO con hora.
 *
 * `fechaFlexible` sigue existiendo para lo que NO es una fecha-día: las horas de
 * entrada/salida de un registro (`horaOpcional` en planillas.routes.ts), que son
 * instantes reales y conservan su hora.
 */
export const fechaDia = fechaFlexible.transform((s) => diaDesdeEntrada(s));

/**
 * Cantidad de días-calendario entre dos fechas, inclusive en ambos extremos
 * (el mismo día da 1). Acepta strings validados por `fechaFlexible` o los `Date`
 * que devuelve `fechaDia`.
 */
export function spanDiasCalendario(fechaInicio: string | Date, fechaFin: string | Date): number {
  const ini = diaDesdeEntrada(fechaInicio);
  const fin = diaDesdeEntrada(fechaFin);
  return Math.round((fin.getTime() - ini.getTime()) / 86_400_000) + 1;
}
