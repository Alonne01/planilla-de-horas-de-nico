/**
 * Fechas-DÍA en el front.
 *
 * La convención de destino es medianoche UTC del día calendario argentino, y el
 * backend serializa con `.toISOString()`. Construir un `Date` con ese string y
 * leerlo con getters locales (`getDate()`, `toLocaleDateString()`) corre el día
 * hacia atrás en cualquier huso negativo: en Argentina (UTC-3),
 * `2026-07-31T00:00:00.000Z` es el 30 a las 21:00. Ése era el bug de la ausencia
 * que se pintaba un día antes.
 *
 * OJO: la migración de datos TODAVÍA NO CORRIÓ. En la base conviven las tres
 * convenciones históricas — `00:00Z`, `03:00Z` (medianoche argentina) y `15:00Z`
 * (mediodía local, lo que mandaba la planilla) — y estos helpers manejan las tres
 * sin distinguirlas, justamente porque la clave sale del string y nunca se
 * construye un `Date` con el ISO. No leas el párrafo de arriba como permiso para
 * hacer `new Date(iso)` sobre un campo "ya migrado": sigue siendo incorrecto.
 *
 * Regla: la clave del día sale del STRING; si hace falta un `Date` (para
 * formatear o para calcular), se construye con los componentes ya extraídos.
 *
 * Esto NO aplica a horas reales (entrada/salida de un turno): esas sí se leen
 * con `new Date(iso)` porque su hora importa.
 */

/**
 * Clave 'YYYY-MM-DD' de una FECHA-DÍA serializada por el backend.
 *
 * Sólo para fechas-día. Pasarle un INSTANTE real devuelve su día **UTC**, que no
 * es el día calendario argentino: entre las 21:00 y las 24:00 en Argentina el día
 * UTC ya es mañana. Ése fue exactamente el error del marcador de "hoy" del gantt
 * (`diaKey(new Date().toISOString())` daba el día siguiente), y el tipo `string`
 * no lo puede atajar. Para el día local de un `Date` está `claveLocal`; para hoy,
 * `hoyKey`.
 */
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

/**
 * Clave 'YYYY-MM-DD' del día que un `Date` representa en el huso del navegador.
 *
 * Es la contracara de `diaKey`: ésta parte de un `Date` (los que arma el
 * calendario), `diaKey` parte de un ISO del backend. Nunca uses
 * `.toISOString().slice(0, 10)` para esto — eso da el día **UTC**.
 */
export function claveLocal(fecha: Date): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

/**
 * Clave 'YYYY-MM-DD' del día de HOY en el huso del navegador.
 *
 * Es el reemplazo de `new Date().toISOString().slice(0, 10)`, que devuelve el día
 * **UTC**: entre las 21:00 y las 24:00 en Argentina ése ya es el día siguiente.
 *
 * `ahora` es un parámetro sólo para poder testearlo con un instante fijo.
 */
export function hoyKey(ahora: Date = new Date()): string {
  return claveLocal(ahora);
}

/**
 * Días calendario enteros que faltan para `objetivo` contando desde `desde`:
 * 0 el mismo día, negativo si `objetivo` ya pasó.
 *
 * Se calcula sobre medianoches UTC armadas con los componentes del día, así que
 * el resultado no depende del huso ni de los horarios de verano — a diferencia
 * de restar dos `Date` con hora, donde el corte se corre según a qué hora del
 * día se mire la pantalla.
 *
 * Los argumentos van en un objeto A PROPÓSITO. Con dos parámetros posicionales
 * del mismo tipo, invertirlos compila y devuelve el valor negado: el badge de
 * vencimiento de capacitaciones pasaría a marcar "vencida" todo lo válido y
 * "vigente" lo vencido, sin que nada falle. Nombrarlos hace que el error tenga
 * que escribirse explícito.
 */
export function diasHasta({ objetivo, desde }: { objetivo: string; desde: string }): number {
  const [ya, ma, da] = ymd(objetivo);
  const [yb, mb, db] = ymd(desde);
  return Math.round((Date.UTC(ya, ma - 1, da) - Date.UTC(yb, mb - 1, db)) / 86_400_000);
}
