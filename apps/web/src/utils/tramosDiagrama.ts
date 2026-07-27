import { esDiaFranco, type DiagramaInfo } from './planillaHelpers';

/**
 * Un período de vigencia de un diagrama, tal como lo manda el backend en
 * `GET /planillas/:id` y en el gantt. Las fechas llegan en ISO.
 *
 * Espejo de `diagrama-vigencia.utils.ts` del API: si los dos no eligen el mismo
 * tramo para un día, el calendario pinta un franco que la liquidación no paga.
 */
export interface TramoDiagrama {
  diagrama: DiagramaInfo;
  fechaInicio: string;
  fechaFin: string | null;
}

/**
 * Día calendario de una fecha, comparable entre un `Date` local (los que arma el
 * calendario) y un ISO del backend (medianoche UTC). Se compara por componentes
 * de día, nunca por timestamp: en UTC-3 la medianoche UTC del 01/08 es el 31/07
 * a las 21:00 local, y el corte se correría un día.
 */
function claveLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function claveIso(iso: string): string {
  return iso.slice(0, 10);
}

/** El tramo vigente ese día: el que lo cubre y, si hay varios, el que arrancó más tarde. */
export function tramoDelDia(tramos: TramoDiagrama[], fecha: Date): TramoDiagrama | null {
  const k = claveLocal(fecha);
  let elegido: TramoDiagrama | null = null;
  for (const t of tramos) {
    if (claveIso(t.fechaInicio) > k) continue;
    if (t.fechaFin && claveIso(t.fechaFin) < k) continue;
    if (!elegido || claveIso(t.fechaInicio) >= claveIso(elegido.fechaInicio)) elegido = t;
  }
  return elegido;
}

/**
 * Si ese día es franco según el tramo que lo cubre. El ciclo de un ROTATIVO se
 * cuenta desde el inicio DEL TRAMO, no desde la asignación corriente.
 *
 * El orden de los parámetros es `(tramos, fecha)` en todo el módulo y en su
 * espejo del backend: mezclarlo con el de `esDiaFranco(fecha, ...)` es una fuente
 * de errores silenciosos, porque los dos tipos son objetos.
 */
export function francoDelDia(tramos: TramoDiagrama[], fecha: Date): boolean {
  const tramo = tramoDelDia(tramos, fecha);
  if (!tramo) return false;
  const [y, m, d] = claveIso(tramo.fechaInicio).split('-').map(Number);
  return esDiaFranco(fecha, tramo.diagrama, new Date(y!, m! - 1, d!));
}

/**
 * Si ese día arranca un tramo que NO es el primero: es el día donde cambia el
 * diagrama, y el calendario lo marca para que el corte de francos se entienda.
 */
export function esInicioDeTramo(tramos: TramoDiagrama[], fecha: Date): boolean {
  if (tramos.length < 2) return false;
  const k = claveLocal(fecha);
  const ordenados = [...tramos].sort((a, b) => claveIso(a.fechaInicio).localeCompare(claveIso(b.fechaInicio)));
  return ordenados.slice(1).some((t) => claveIso(t.fechaInicio) === k);
}

/**
 * Texto para el encabezado del PDF cuando el período tiene un corte de
 * diagrama: mismo criterio que arma `diagramaNombre` en `export.routes.ts`
 * (backend) para el Excel, así el PDF del front dice lo mismo que la planilla
 * que ya liquidó esos días. `tramos` llega pre-ordenado por `fechaInicio` (lo
 * garantiza `tramosDeUsuario` en el backend), así que no hace falta reordenar.
 */
export function diagramaHeaderText(tramos: TramoDiagrama[]): string {
  if (tramos.length === 0) return '—';
  if (tramos.length === 1) return tramos[0]!.diagrama.nombre || '—';
  const fmt = (iso: string) => claveIso(iso).split('-').reverse().join('/');
  return tramos
    .map((t, i) => (i === 0 && t.fechaFin
      ? `${t.diagrama.nombre || '—'} hasta ${fmt(t.fechaFin)}`
      : `${t.diagrama.nombre || '—'} desde ${fmt(t.fechaInicio)}`))
    .join(' · ');
}
