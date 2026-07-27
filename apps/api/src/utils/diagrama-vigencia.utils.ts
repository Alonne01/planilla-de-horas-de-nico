import { PrismaClient } from '@prisma/client';
import { esDiaFrancoSegunDiagrama } from './contexto-dia.utils.js';

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
  const asignaciones = await prisma.usuarioDiagrama.findMany({
    where: {
      usuarioId,
      fechaInicio: { lte: hasta },
      OR: [{ fechaFin: null }, { fechaFin: { gte: desde } }],
    },
    select: { fechaInicio: true, fechaFin: true, diagrama: { select: SELECT_DIAGRAMA } },
    orderBy: { fechaInicio: 'asc' },
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
 */
export function tramoDelDia(tramos: TramoDiagrama[], fecha: Date): TramoDiagrama | null {
  let elegido: TramoDiagrama | null = null;
  for (const t of tramos) {
    if (t.fechaInicio > fecha) continue;
    if (t.fechaFin && t.fechaFin < fecha) continue;
    if (!elegido || t.fechaInicio >= elegido.fechaInicio) elegido = t;
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
