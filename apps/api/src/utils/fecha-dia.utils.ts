/**
 * Autoridad única de la convención de FECHA-DÍA del sistema.
 *
 * Regla: una fecha que representa un DÍA (no un instante) se guarda como
 * **medianoche UTC del día calendario argentino**. Todo lo que entra por el API
 * pasa por `diaDesdeEntrada`; toda comparación de días va por clave, nunca por
 * timestamp.
 *
 * Este módulo NO importa Prisma a propósito: lo usa `zod.utils.ts`, que se
 * carga en el borde de validación de todas las rutas.
 */

// Argentina es UTC-3 todo el año (no observa horario de verano desde 2009), así
// que un desplazamiento fijo alcanza sin tirar de una librería de zonas horarias.
// Si la empresa alguna vez opera en otro huso —o en uno con horario de verano—,
// este valor deja de alcanzar: hay que resolver el offset real del huso de la
// empresa en el momento de la consulta (por ejemplo con `Intl` y un `timeZone`
// guardado por empresa) en vez de un desplazamiento constante.
const OFFSET_ARGENTINA_MS = 3 * 60 * 60 * 1000;

/**
 * Milisegundos por día. Exportada porque el ensanche de rangos y de cálculos de
 * días-calendario (`zod.utils.ts`, `ausencia-calendar.utils.ts`) la necesitaba
 * retipeada como literal en más de un lugar.
 */
export const MS_POR_DIA = 86_400_000;

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Clave YYYY-MM-DD del día UTC.
 *
 * Pensada para fechas-día ya normalizadas (donde el día UTC y el día argentino
 * coinciden por construcción, porque ya pasaron por `diaDesdeEntrada`). NO mide
 * el día calendario argentino de un instante real: `claveFecha` de un instante
 * cualquiera puede discrepar de `diaDesdeEntrada` del mismo instante en la
 * ventana `(00:00Z, 03:00Z)` (`2026-08-01T02:00:00Z` es `'2026-08-01'` en UTC
 * pero 31/7 en Argentina). Para medir el día calendario argentino de un
 * instante real, usá `diaLocalEmpresaDe`. Es a propósito que esta función no
 * cambie: la usan `diagrama-vigencia.utils.ts`, `export.routes.ts` y
 * `cambios-diagrama.routes.ts` asumiendo que ya reciben fechas-día normalizadas.
 */
export function claveFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Medianoche UTC del día calendario argentino que corresponde a `valor`.
 *
 * Tres casos, en este orden:
 *   1. `"YYYY-MM-DD"` → ese día, literal. Aplicarle el offset lo correría un día.
 *   2. Medianoche UTC exacta → se devuelve igual: YA está en la convención de
 *      destino (es lo que hay guardado y lo que mandan los tests QA existentes).
 *   3. Cualquier otro instante → se mide su día calendario en Argentina. Así
 *      `03:00Z` (medianoche AR) y `15:00Z` (mediodía AR) caen en el mismo día, y
 *      las últimas 3 h del día argentino no se van al día siguiente.
 *
 * Entrada inválida: lanza `RangeError` (política de los helpers puros de este
 * módulo; ver `spanDiasCalendario` en zod.utils.ts para el contrario).
 *
 * Garantía de no-aliasing: nunca devuelve el mismo objeto que recibió — siempre
 * un `Date` nuevo, incluso en el atajo de medianoche UTC exacta (caso 2). Código
 * como `buildDaysBetween` depende de esto para poder mutar el resultado con
 * `setUTCDate` sin alterar el `Date` que le pasaron.
 */
export function diaDesdeEntrada(valor: string | Date): Date {
  if (typeof valor === 'string' && SOLO_FECHA.test(valor.trim())) {
    const soloFecha = valor.trim();
    const d = new Date(`${soloFecha}T00:00:00.000Z`);
    // El round-trip caza los días que no existen: '2026-02-30' se normalizaría
    // solo a marzo, y '2026-13-45' queda Invalid Date.
    if (Number.isNaN(d.getTime()) || claveFecha(d) !== soloFecha) {
      throw new RangeError(`Fecha inválida: ${valor}`);
    }
    return d;
  }
  const d = typeof valor === 'string' ? new Date(valor) : valor;
  if (Number.isNaN(d.getTime())) {
    throw new RangeError(`Fecha inválida: ${String(valor)}`);
  }
  if (d.getTime() % MS_POR_DIA === 0) return new Date(d.getTime());
  const local = new Date(d.getTime() - OFFSET_ARGENTINA_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/**
 * ¿Las dos fechas caen en el mismo día calendario argentino?
 *
 * Normaliza con `diaDesdeEntrada` antes de comparar por clave: comparar
 * `claveFecha` directo mide el día UTC, que discrepa del argentino en la
 * ventana `(00:00Z, 03:00Z)`. Este módulo se declara autoridad única de la
 * convención de fecha-día, así que sus propias funciones de comparación no
 * pueden medir "día" de dos maneras distintas.
 */
export function mismoDia(a: Date, b: Date): boolean {
  return claveFecha(diaDesdeEntrada(a)) === claveFecha(diaDesdeEntrada(b));
}

/**
 * ¿`dia` cae dentro de [desde, hasta], comparando por día calendario argentino?
 * Inclusivo en ambos extremos y a prueba de fechas con horas distintas (ver
 * nota de normalización en `mismoDia`).
 */
export function dentroDelRango(dia: Date, desde: Date, hasta: Date): boolean {
  const clave = claveFecha(diaDesdeEntrada(dia));
  return clave >= claveFecha(diaDesdeEntrada(desde)) && clave <= claveFecha(diaDesdeEntrada(hasta));
}

/**
 * Día calendario argentino de un instante dado, como medianoche UTC.
 *
 * NO pasa por `diaDesdeEntrada`: el atajo de "medianoche UTC ya normalizada" que
 * esa función aplica vale para fechas-día guardadas, pero acá el argumento es un
 * instante real, y a las 00:00:00Z en Argentina todavía son las 21:00 del día
 * anterior.
 */
export function diaLocalEmpresaDe(instante: Date): Date {
  const local = new Date(instante.getTime() - OFFSET_ARGENTINA_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/**
 * Medianoche UTC del día calendario de HOY en el huso de la empresa (Argentina),
 * NO en el huso del servidor.
 *
 * El servidor puede correr en cualquier huso (en producción, típicamente UTC),
 * pero quien usa el sistema piensa las fechas en hora argentina. Tomar los
 * componentes UTC crudos de "ahora" mide el día calendario UTC, que difiere del
 * argentino durante las últimas 3 horas de cada día en Argentina (21:00–24:00).
 */
export function hoyLocalEmpresa(): Date {
  return diaLocalEmpresaDe(new Date());
}
