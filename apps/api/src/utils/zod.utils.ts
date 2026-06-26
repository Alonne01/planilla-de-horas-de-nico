import { z } from 'zod';

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
 * Cantidad de días-calendario entre dos fechas, inclusive en ambos extremos
 * (el mismo día da 1). Asume que ambos strings ya pasaron por `fechaFlexible`.
 */
export function spanDiasCalendario(fechaInicio: string, fechaFin: string): number {
  const ini = new Date(fechaInicio);
  const fin = new Date(fechaFin);
  return Math.floor((fin.getTime() - ini.getTime()) / 86_400_000) + 1;
}
