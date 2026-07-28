/**
 * Agrupación de personal por TURNO — espejo de `apps/web/src/utils/turnos.ts`.
 *
 * Dos personas comparten turno si comparten DÍAS DE DESCANSO. Por eso la clave
 * no puede ser el id de la asignación (`UsuarioDiagrama`) ni "diagrama +
 * fechaInicio": eso agrupa por fila de la tabla, no por patrón. Dos personas con
 * el mismo Lunes-Viernes pero fechas de alta distintas —lo normal, cada una se
 * asigna cuando ingresa— son el mismo turno. Para ROTATIVO la fecha sí importa,
 * pero sólo por su FASE dentro del ciclo: dos 7×7 desfasados una semana
 * descansan días distintos.
 *
 * HAY DOS COPIAS A PROPÓSITO. La del front alimenta el filtro del calendario
 * detallado, que trabaja sobre datos ya cargados en memoria. Ésta es la
 * AUTORIDAD: es la que resuelve a quién le llega una difusión, y nunca confía en
 * una lista de destinatarios mandada por el cliente. Si cambia el criterio hay
 * que cambiar las dos, y los dos tests.
 */
import { claveFecha } from './fecha-dia.utils.js';

const MS_POR_DIA = 86_400_000;
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export interface DiagramaTurno {
  tipo: string;
  diasTrabajo: number | null;
  diasDescanso: number | null;
  diasSemana: number[];
}

export interface TramoTurno {
  diagrama: DiagramaTurno;
  fechaInicio: Date;
}

/**
 * Días enteros desde la época, leídos de la CLAVE del día.
 *
 * `claveFecha` y no los getters del Date: `fechaInicio` de una asignación guarda
 * la hora real de la aprobación (`cambios-diagrama.routes.ts` usa `new Date()`),
 * así que restar timestamps deja la fase corrida cuando el corte cae cerca de la
 * medianoche UTC.
 */
function diaEpoch(fecha: Date): number {
  return Math.round(Date.parse(`${claveFecha(fecha)}T00:00:00Z`) / MS_POR_DIA);
}

export function turnoKey(tramo: TramoTurno | null): string {
  if (!tramo) return 'SIN';
  const { diagrama, fechaInicio } = tramo;

  if (diagrama.tipo === 'ROTATIVO') {
    const dt = diagrama.diasTrabajo ?? 0;
    const dd = diagrama.diasDescanso ?? 0;
    const ciclo = dt + dd;
    if (ciclo <= 0) return 'SIN';
    const fase = ((diaEpoch(fechaInicio) % ciclo) + ciclo) % ciclo;
    return `R|${dt}|${dd}|${fase}`;
  }

  if (diagrama.tipo === 'FIJO_SEMANA') {
    return `F|${[...diagrama.diasSemana].sort((a, b) => a - b).join(',')}`;
  }

  return 'SIN';
}

/**
 * El primer día ≥ `hoy` en que arranca un ciclo de trabajo — lo que la gente
 * quiere decir con "los que empiezan el jueves 30".
 *
 * `null` para FIJO_SEMANA: no tiene ciclo que empiece.
 */
export function proximoInicioDeCiclo(tramo: TramoTurno, hoy: Date): Date | null {
  const { diagrama, fechaInicio } = tramo;
  if (diagrama.tipo !== 'ROTATIVO') return null;
  const ciclo = (diagrama.diasTrabajo ?? 0) + (diagrama.diasDescanso ?? 0);
  if (ciclo <= 0) return null;

  const hoyE = diaEpoch(hoy);
  const desfase = (((hoyE - diaEpoch(fechaInicio)) % ciclo) + ciclo) % ciclo;
  // Si hoy YA es un inicio de ciclo, el próximo es hoy: sumar el ciclo entero
  // mandaría el aviso al grupo equivocado justo el día que arrancan.
  const proximo = desfase === 0 ? hoyE : hoyE + (ciclo - desfase);
  return new Date(proximo * MS_POR_DIA);
}

/**
 * Etiqueta legible del turno, para que el remitente sepa a quién le está por
 * escribir antes de mandar.
 */
export function etiquetaTurno(tramo: TramoTurno | null, hoy: Date): { etiqueta: string; proximoInicio: string | null } {
  if (!tramo) return { etiqueta: 'Sin diagrama asignado', proximoInicio: null };
  const { diagrama } = tramo;

  if (diagrama.tipo === 'ROTATIVO') {
    const dt = diagrama.diasTrabajo ?? 0;
    const dd = diagrama.diasDescanso ?? 0;
    const prox = proximoInicioDeCiclo(tramo, hoy);
    if (!prox) return { etiqueta: `Rotativo ${dt}×${dd}`, proximoInicio: null };
    // Getters UTC: `prox` es una fecha-día (medianoche UTC) y el proceso corre
    // con TZ=America/Argentina/Buenos_Aires, así que `getDay()` devolvería el día
    // ANTERIOR y la etiqueta nombraría el miércoles en vez del jueves.
    const nombreDia = DIAS_SEMANA[prox.getUTCDay()]!;
    const dia = String(prox.getUTCDate()).padStart(2, '0');
    const mes = String(prox.getUTCMonth() + 1).padStart(2, '0');
    return {
      etiqueta: `Rotativo ${dt}×${dd} — arrancan el ${nombreDia} ${dia}/${mes}`,
      proximoInicio: claveFecha(prox),
    };
  }

  if (diagrama.tipo === 'FIJO_SEMANA') {
    const dias = [...diagrama.diasSemana].sort((a, b) => a - b).map((d) => DIAS_SEMANA[d] ?? String(d));
    return { etiqueta: `Semana fija — trabajan ${dias.join(', ') || '—'}`, proximoInicio: null };
  }

  return { etiqueta: 'Sin diagrama asignado', proximoInicio: null };
}
