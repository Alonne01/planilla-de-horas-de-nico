import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface NotifParams {
  usuarioId: string;
  tipo: string;
  titulo: string;
  cuerpo?: string;
  link?: string;
}

export async function crearNotificacion({ usuarioId, tipo, titulo, cuerpo, link }: NotifParams) {
  try {
    await prisma.notificacion.create({
      data: { usuarioId, tipo, titulo, cuerpo: cuerpo ?? null, link: link ?? null },
    });
  } catch (error) {
    console.error('Error creando notificación:', error);
  }
}

// Notify the planilla owner about approval/rejection
export async function notificarPlanilla(
  planillaUsuarioId: string,
  estado: 'APROBADA' | 'RECHAZADA' | 'EN_REVISION',
  aprobadorNombre: string,
  motivo?: string,
) {
  const titulos: Record<string, string> = {
    APROBADA: '✅ Planilla aprobada',
    RECHAZADA: '❌ Planilla rechazada',
    EN_REVISION: '🔄 Planilla avanzó de paso',
  };
  const cuerpos: Record<string, string> = {
    APROBADA: `Tu planilla fue aprobada por ${aprobadorNombre}.`,
    RECHAZADA: `Tu planilla fue rechazada por ${aprobadorNombre}.${motivo ? ` Motivo: ${motivo}` : ''}`,
    EN_REVISION: `Tu planilla fue aprobada en un paso por ${aprobadorNombre} y avanzó al siguiente nivel.`,
  };
  await crearNotificacion({
    usuarioId: planillaUsuarioId,
    tipo: 'PLANILLA',
    titulo: titulos[estado],
    cuerpo: cuerpos[estado],
    link: '/planillas',
  });
}

// Notify the vacation requester about approval/rejection
export async function notificarVacacion(
  vacacionUsuarioId: string,
  estado: 'APROBADA' | 'RECHAZADA' | 'EN_REVISION',
  aprobadorNombre: string,
  motivo?: string,
) {
  const titulos: Record<string, string> = {
    APROBADA: '✅ Vacaciones aprobadas',
    RECHAZADA: '❌ Vacaciones rechazadas',
    EN_REVISION: '🔄 Vacaciones avanzaron de paso',
  };
  const cuerpos: Record<string, string> = {
    APROBADA: `Tu solicitud de vacaciones fue aprobada por ${aprobadorNombre}.`,
    RECHAZADA: `Tu solicitud de vacaciones fue rechazada por ${aprobadorNombre}.${motivo ? ` Motivo: ${motivo}` : ''}`,
    EN_REVISION: `Tu solicitud de vacaciones fue aprobada en un paso por ${aprobadorNombre}.`,
  };
  await crearNotificacion({
    usuarioId: vacacionUsuarioId,
    tipo: 'VACACION',
    titulo: titulos[estado],
    cuerpo: cuerpos[estado],
    link: '/vacaciones',
  });
}

// Notify the absence owner about approval/rejection
export async function notificarAusencia(
  ausenciaUsuarioId: string,
  estado: 'APROBADA' | 'RECHAZADA' | 'EN_REVISION',
  aprobadorNombre: string,
  motivo?: string,
) {
  const titulos: Record<string, string> = {
    APROBADA: '✅ Ausencia aprobada',
    RECHAZADA: '❌ Ausencia rechazada',
    EN_REVISION: '🔄 Ausencia avanzó de paso',
  };
  const cuerpos: Record<string, string> = {
    APROBADA: `Tu ausencia fue aprobada por ${aprobadorNombre}.`,
    RECHAZADA: `Tu ausencia fue rechazada por ${aprobadorNombre}.${motivo ? ` Motivo: ${motivo}` : ''}`,
    EN_REVISION: `Tu ausencia fue aprobada en un paso por ${aprobadorNombre}.`,
  };
  await crearNotificacion({
    usuarioId: ausenciaUsuarioId,
    tipo: 'AUSENCIA',
    titulo: titulos[estado],
    cuerpo: cuerpos[estado],
    link: '/ausencias',
  });
}

// Notify when a planilla is sent for review (to approvers)
export async function notificarEnvio(
  destinatarioId: string,
  tipo: 'PLANILLA' | 'VACACION' | 'AUSENCIA',
  solicitanteNombre: string,
) {
  const labels: Record<string, string> = {
    PLANILLA: 'planilla',
    VACACION: 'solicitud de vacaciones',
    AUSENCIA: 'ausencia',
  };
  await crearNotificacion({
    usuarioId: destinatarioId,
    tipo,
    titulo: `📨 Nueva ${labels[tipo]} para revisar`,
    cuerpo: `${solicitanteNombre} envió una ${labels[tipo]} que requiere tu aprobación.`,
    link: '/aprobaciones',
  });
}
