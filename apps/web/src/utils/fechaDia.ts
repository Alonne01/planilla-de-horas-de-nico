/**
 * Fechas-DÍA en el front.
 *
 * El backend las guarda como medianoche UTC del día calendario argentino y las
 * serializa con `.toISOString()`. Construir un `Date` con ese string y leerlo con
 * getters locales (`getDate()`, `toLocaleDateString()`) corre el día hacia atrás
 * en cualquier huso negativo: en Argentina (UTC-3), `2026-07-31T00:00:00.000Z`
 * es el 30 a las 21:00. Ese era el bug de la ausencia que se pintaba un día antes.
 *
 * Regla: la clave del día sale del STRING; si hace falta un `Date` (para
 * formatear o para calcular), se construye con los componentes ya extraídos.
 *
 * Esto NO aplica a horas reales (entrada/salida de un turno): esas sí se leen
 * con `new Date(iso)` porque su hora importa.
 */

/** Clave 'YYYY-MM-DD' de una fecha-día serializada por el backend. */
export function diaKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Componentes [año, mes 1-12, día] de una fecha-día. */
export function ymd(iso: string): [number, number, number] {
  const [y, m, d] = diaKey(iso).split('-').map(Number);
  return [y as number, m as number, d as number];
}

/** `Date` en el huso del navegador, posicionado en el día correcto (mediodía). */
export function diaLocal(iso: string): Date {
  const [y, m, d] = ymd(iso);
  return new Date(y, m - 1, d, 12, 0, 0);
}

/** Formato es-AR de una fecha-día. */
export function fmtDia(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return diaLocal(iso).toLocaleDateString('es-AR', opts);
}
