import { PrismaClient } from '@prisma/client';
import { crearNotificacion } from './notificacion.utils.js';

const prisma = new PrismaClient();

/**
 * Motivo con el que se cierra una solicitud que llegó a su fecha de inicio sin
 * terminar de aprobarse. No se usa un estado nuevo: RECHAZADA + motivo evita
 * tocar el enum y todas las pantallas que lo interpretan.
 */
export const MOTIVO_VENCIDA =
  'Vencida: la fecha de inicio del diagrama pasó sin completarse la aprobación';

/**
 * Fin del día de hoy en UTC (23:59:59.999). El corte tiene que ser el FINAL del
 * día, no su comienzo: una `fechaEfectiva` de hoy a las 15:00 ya llegó a su día
 * y tiene que vencer igual que si fuera hoy a las 00:00. Filtrar con la
 * medianoche de hoy como límite (`lte` a las 00:00:00) dejaba pasar hasta
 * mañana cualquier fecha de inicio de hoy con hora distinta de cero.
 *
 * Esto expresa en una query de Prisma el mismo criterio que la ruta aplica
 * comparando por `claveFecha` (clave de día, en `/avanzar`): los dos caminos
 * tienen que decidir lo mismo para la misma solicitud, o una podría vencer por
 * un lado y aprobarse por el otro según cuál corra primero.
 */
function finDeHoyUTC(): Date {
  const ahora = new Date();
  return new Date(Date.UTC(
    ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate(),
    23, 59, 59, 999,
  ));
}

/**
 * Cierra las solicitudes que llegaron a su fecha de inicio sin terminar de
 * aprobarse y avisa a los interesados. Devuelve cuántas venció.
 *
 * Las viejas sin fecha de inicio (el campo era opcional) no se tocan: nunca
 * tuvieron plazo.
 */
export async function vencerCambiosDiagrama(): Promise<number> {
  const candidatas = await prisma.solicitudCambioDiagrama.findMany({
    where: {
      estado: { in: ['PENDIENTE', 'EN_REVISION'] },
      fechaEfectiva: { not: null, lte: finDeHoyUTC() },
    },
    select: { id: true, usuarioId: true, solicitanteId: true, fechaEfectiva: true, estado: true },
  });
  if (candidatas.length === 0) return 0;

  let vencidas = 0;
  for (const s of candidatas) {
    // Update condicional: entre el findMany de arriba y este punto, la solicitud
    // pudo cerrarse por otra vía (un /avanzar final concurrente, un /rechazar
    // explícito de otro aprobador, o el solicitante cancelándola). El filtro por
    // estado hace que sólo la corrida que llega primero encuentre la fila en
    // PENDIENTE/EN_REVISION; si `count` da 0, otra ya la cerró y no hay que
    // escribir un historial ni un aviso duplicados para esta solicitud.
    const cerroEsta = await prisma.$transaction(async (tx) => {
      const { count } = await tx.solicitudCambioDiagrama.updateMany({
        where: { id: s.id, estado: { in: ['PENDIENTE', 'EN_REVISION'] } },
        data: { estado: 'RECHAZADA', obsRechazo: MOTIVO_VENCIDA },
      });
      if (count === 0) return false;

      await tx.cambioDiagramaHistorial.create({
        data: {
          solicitudId: s.id,
          usuarioId: s.usuarioId,
          estadoAnterior: s.estado,
          estadoNuevo: 'RECHAZADA',
          pasoFlujo: 0,
          rolAprobador: null,
          comentario: MOTIVO_VENCIDA,
        },
      });
      return true;
    });

    if (!cerroEsta) continue; // ya la cerraron por otro lado: nada que avisar

    const fecha = s.fechaEfectiva
      ? s.fechaEfectiva.toISOString().slice(0, 10).split('-').reverse().join('/')
      : '';
    for (const usuarioId of new Set([s.usuarioId, s.solicitanteId])) {
      await crearNotificacion({
        usuarioId,
        tipo: 'CAMBIO_DIAGRAMA',
        titulo: 'Solicitud de cambio de diagrama vencida',
        cuerpo: `Llegó el ${fecha} sin que se completara la aprobación. Hay que pedirla de nuevo con otra fecha de inicio.`,
        link: '/cambios-diagrama',
      });
    }
    vencidas += 1;
  }

  console.log(`⏳ Cambios de diagrama vencidos: ${vencidas}`);
  return vencidas;
}

// ─── Scheduler ───────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null;
const VEINTICUATRO_HORAS = 24 * 60 * 60 * 1000;

/**
 * Barrido diario, con una corrida al minuto del arranque para no depender de que
 * el proceso viva 24 h. El catch es obligatorio: el callback de un timer no tiene
 * a quién propagarle el rechazo y tumbaría el proceso por unhandledRejection.
 */
export function startCambiosDiagramaScheduler(): void {
  const seguro = () => {
    vencerCambiosDiagrama().catch((err) =>
      console.error('Error venciendo cambios de diagrama:', err),
    );
  };
  setTimeout(seguro, 60_000);
  timer = setInterval(seguro, VEINTICUATRO_HORAS);
  console.log('🕐 Vencimiento de cambios de diagrama: cada 24 horas');
}

export function stopCambiosDiagramaScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
