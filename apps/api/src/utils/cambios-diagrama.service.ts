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

/** Medianoche UTC de hoy. Una solicitud con fecha de inicio <= hoy ya no sirve. */
function hoyUTC(): Date {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
}

/**
 * Cierra las solicitudes que llegaron a su fecha de inicio sin terminar de
 * aprobarse y avisa a los interesados. Devuelve cuántas venció.
 *
 * Las viejas sin fecha de inicio (el campo era opcional) no se tocan: nunca
 * tuvieron plazo.
 */
export async function vencerCambiosDiagrama(): Promise<number> {
  const vencidas = await prisma.solicitudCambioDiagrama.findMany({
    where: {
      estado: { in: ['PENDIENTE', 'EN_REVISION'] },
      fechaEfectiva: { not: null, lte: hoyUTC() },
    },
    select: { id: true, usuarioId: true, solicitanteId: true, fechaEfectiva: true, estado: true },
  });
  if (vencidas.length === 0) return 0;

  for (const s of vencidas) {
    await prisma.$transaction([
      prisma.solicitudCambioDiagrama.update({
        where: { id: s.id },
        data: { estado: 'RECHAZADA', obsRechazo: MOTIVO_VENCIDA },
      }),
      prisma.cambioDiagramaHistorial.create({
        data: {
          solicitudId: s.id,
          usuarioId: s.usuarioId,
          estadoAnterior: s.estado,
          estadoNuevo: 'RECHAZADA',
          pasoFlujo: 0,
          rolAprobador: null,
          comentario: MOTIVO_VENCIDA,
        },
      }),
    ]);

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
  }

  console.log(`⏳ Cambios de diagrama vencidos: ${vencidas.length}`);
  return vencidas.length;
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
