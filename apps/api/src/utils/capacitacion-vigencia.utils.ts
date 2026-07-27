/**
 * Estado de vigencia de un certificado de capacitación.
 *
 * Vive fuera de `capacitaciones.routes.ts` porque es lógica pura (sin Prisma,
 * sin Express) que dos handlers usaban duplicada, y porque así se puede testear
 * el borde horario sin levantar el API.
 */
import { diaDesdeEntrada, MS_POR_DIA } from './fecha-dia.utils.js';

export type EstadoVigencia = 'vigente' | 'vencida' | 'proxima' | 'sin_vencimiento';

/**
 * Estado de vigencia medido por DÍA calendario argentino.
 *
 * `fechaVencimiento` es una fecha-día (`00:00Z`), no un instante: compararla
 * contra `new Date()` mezcla las dos cosas. El 26/7 a las 23:00 hora argentina,
 * un certificado que vence el 26/7 daba `ceil(-1.083) = -1` y se mostraba
 * "vencida" cuando en Argentina todavía era el 26 y vencía recién esa noche —
 * una ventana de 3 h por día en la que el sistema miente. Por eso `hoy` tiene
 * que venir de `hoyLocalEmpresa()` (medianoche UTC del día argentino de hoy) y
 * la diferencia va con `round`, no con `ceil`: los dos operandos ya son días
 * enteros, así que la resta es un número entero de días y `ceil` sólo servía
 * para tapar el instante que se colaba por el otro lado.
 *
 * `alertaDias` es la ventana de aviso previo configurada en el tipo. Un
 * certificado que vence HOY da `dias === 0`, así que cae en 'proxima' (no en
 * 'vencida'): todavía es válido hasta que termine el día.
 */
export function estadoVigencia(
  fechaVencimiento: Date | null,
  alertaDias: number,
  hoy: Date,
): EstadoVigencia {
  if (!fechaVencimiento) return 'sin_vencimiento';
  const dias = Math.round((diaDesdeEntrada(fechaVencimiento).getTime() - hoy.getTime()) / MS_POR_DIA);
  if (dias < 0) return 'vencida';
  if (dias <= alertaDias) return 'proxima';
  return 'vigente';
}
