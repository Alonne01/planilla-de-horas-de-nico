import { PrismaClient } from '@prisma/client';
import { claveFecha, esDiaFrancoSegunDiagrama } from './contexto-dia.utils.js';

const prisma = new PrismaClient();

/**
 * Un período de vigencia de un diagrama para una persona.
 *
 * `UsuarioDiagrama` siempre fue un historial (tiene fechaInicio y fechaFin), pero
 * el resto del código resolvía la vigencia por el flag `activo`. Apenas se aprueba
 * un cambio, la asignación anterior queda en `activo: false` y los días previos
 * al corte se quedaban sin diagrama: un franco trabajado de la primera mitad del
 * período perdía el recargo del 100% al recalcularse. Acá la vigencia la deciden
 * las fechas, y `activo` sólo dice cuál es la asignación corriente.
 */
export type TramoDiagrama = {
  diagrama: {
    id: string;
    nombre: string;
    tipo: string;
    diasTrabajo: number | null;
    diasDescanso: number | null;
    diasSemana: number[];
  };
  fechaInicio: Date;
  fechaFin: Date | null;
};

const SELECT_DIAGRAMA = {
  id: true, nombre: true, tipo: true,
  diasTrabajo: true, diasDescanso: true, diasSemana: true,
} as const;

/**
 * Tramos que cubren algún día de [desde, hasta], ordenados por fechaInicio.
 * Se incluye el tramo que arranca antes del rango y sigue abierto (o termina
 * dentro), porque es el que rige los primeros días.
 */
export async function tramosDeUsuario(
  usuarioId: string,
  desde: Date,
  hasta: Date,
): Promise<TramoDiagrama[]> {
  // El filtro en SQL compara timestamps, pero `fechaInicio`/`fechaFin` guardan la
  // hora real de la aprobación (ver comentario de tramoDelDia). Un tramo que
  // arranca a las 15:32 del último día del rango, o cierra a las 00:10 del
  // primero, quedaría afuera del findMany aunque por día calendario corresponda.
  // Se amplía el filtro al día completo en UTC; el recorte fino por día ya lo
  // hace tramoDelDia después con las claves.
  const desdeDia = new Date(Date.UTC(
    desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate(), 0, 0, 0, 0,
  ));
  const hastaDia = new Date(Date.UTC(
    hasta.getUTCFullYear(), hasta.getUTCMonth(), hasta.getUTCDate(), 23, 59, 59, 999,
  ));
  const asignaciones = await prisma.usuarioDiagrama.findMany({
    where: {
      usuarioId,
      fechaInicio: { lte: hastaDia },
      OR: [{ fechaFin: null }, { fechaFin: { gte: desdeDia } }],
    },
    select: { fechaInicio: true, fechaFin: true, diagrama: { select: SELECT_DIAGRAMA } },
    // Sin clave secundaria, dos asignaciones con el mismo fechaInicio (no hay
    // constraint único en el schema) quedarían en el orden que Postgres decida
    // devolver, que no está garantizado.
    orderBy: [{ fechaInicio: 'asc' }, { createdAt: 'asc' }],
  });
  return asignaciones.map((a) => ({
    diagrama: a.diagrama,
    fechaInicio: a.fechaInicio,
    fechaFin: a.fechaFin,
  }));
}

/**
 * El tramo vigente en una fecha: el que la cubre y, si hay más de uno, el que
 * arrancó más tarde.
 *
 * El desempate no es decorativo: hasta ahora la asignación vieja se cerraba con
 * la MISMA fecha en que abría la nueva, así que el día del corte queda cubierto
 * por las dos en todos los datos ya guardados. Gana la nueva.
 *
 * La comparación es por CLAVE DE DÍA ('YYYY-MM-DD'), no por el Date crudo. Las
 * rutas que escriben `fechaInicio`/`fechaFin` guardan la hora real de la
 * aprobación (`cambios-diagrama.routes.ts`, `usuarios.routes.ts` usan
 * `new Date()`, no medianoche UTC), así que comparar timestamps deja el día del
 * cambio del lado equivocado — o, si el cierre y la apertura caen a distinto
 * lado de la medianoche UTC (~21 hs en Buenos Aires), sin ningún tramo. `fecha`,
 * en cambio, siempre llega como medianoche UTC del día calendario (la convención
 * del dominio), así que sólo el día importa.
 */
export function tramoDelDia(tramos: TramoDiagrama[], fecha: Date): TramoDiagrama | null {
  const claveDia = claveFecha(fecha);
  let elegido: TramoDiagrama | null = null;
  let claveElegido = '';
  for (const t of tramos) {
    const claveInicio = claveFecha(t.fechaInicio);
    if (claveInicio > claveDia) continue;
    if (t.fechaFin && claveFecha(t.fechaFin) < claveDia) continue;
    if (!elegido || claveInicio >= claveElegido) {
      elegido = t;
      claveElegido = claveInicio;
    }
  }
  return elegido;
}

/**
 * Si esa fecha es franco según el tramo que la cubre.
 *
 * El ciclo de un ROTATIVO se cuenta desde el `fechaInicio` DEL TRAMO: usar el de
 * otra asignación corre todos los francos del período.
 */
export function esFrancoEnFecha(tramos: TramoDiagrama[], fecha: Date): boolean {
  const tramo = tramoDelDia(tramos, fecha);
  if (!tramo) return false;
  return esDiaFrancoSegunDiagrama(fecha, tramo.diagrama, tramo.fechaInicio);
}
