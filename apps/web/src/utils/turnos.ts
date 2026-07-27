import type { TramoDiagrama } from './tramosDiagrama';
import { tramoDelDia } from './tramosDiagrama';

/**
 * Clave de "turno" para agrupar empleados en el filtro del calendario de equipo.
 *
 * La intención (ver el código previo a la migración a tramos, commit 0c3d159)
 * siempre fue: dos empleados comparten turno si sus DÍAS DE DESCANSO coinciden.
 * Por eso la clave NO puede ser el id de la asignación (`UsuarioDiagrama`) ni
 * "diagrama.id + fechaInicio del tramo": eso agrupa por fila de la tabla, no por
 * patrón de descanso. Dos personas con el mismo diagrama Lunes-Viernes pero
 * fechas de alta distintas —lo normal, cada una se asigna cuando ingresa—
 * tienen que caer en el mismo turno.
 *
 * Para FIJO_SEMANA la fecha de alta no influye en qué días son francos, así que
 * se omite de la clave. Para ROTATIVO sí importa: dos 7x7 con altas distintas
 * pueden estar desfasados, así que la clave lleva la FASE del ciclo
 * (fechaInicio módulo el largo del ciclo) en vez de la fecha cruda.
 *
 * Se evalúa sobre el tramo vigente HOY —lo que aporta la migración a tramos—:
 * si el empleado tuvo un cambio de diagrama a mitad de año, el filtro agrupa
 * según el diagrama que rige ahora, no el histórico.
 */
export function turnoKey(tramos: TramoDiagrama[]): string {
  const t = tramoDelDia(tramos, new Date());
  if (!t) return 'SIN';
  const { diagrama, fechaInicio } = t;
  if (diagrama.tipo === 'ROTATIVO') {
    const dt = diagrama.diasTrabajo ?? 0;
    const dd = diagrama.diasDescanso ?? 0;
    const ciclo = dt + dd;
    if (ciclo <= 0) return 'SIN';
    const [y, m, d] = fechaInicio.slice(0, 10).split('-').map(Number);
    const epochDay = Math.floor(Date.UTC(y!, m! - 1, d!) / 86400000);
    const fase = ((epochDay % ciclo) + ciclo) % ciclo;
    return `R|${dt}|${dd}|${fase}`;
  }
  if (diagrama.tipo === 'FIJO_SEMANA') {
    return `F|${[...diagrama.diasSemana].sort((a, b) => a - b).join(',')}`;
  }
  return 'SIN';
}
