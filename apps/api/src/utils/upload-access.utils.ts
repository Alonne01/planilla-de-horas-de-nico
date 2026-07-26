import { PrismaClient } from '@prisma/client';
import { getFlowVisibleUserIds } from './visibility.utils.js';
import { LEVEL_COORDINADOR, LEVEL_RRHH } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();

export type ActorUpload = {
  userId: string;
  empresaId: string;
  rol: string;
  rolNivel: number;
  sectorId: string | null;
};

/**
 * Quién es el dueño real de un adjunto de /uploads. Comparar sólo empresas deja el
 * certificado médico de un compañero a un UUID de distancia, así que cada tipo de
 * archivo se resuelve hasta la persona y después se le aplica el mismo criterio que
 * usa la ruta que muestra ese registro.
 */
type DuenoArchivo =
  | { tipo: 'ausencia'; empresaId: string; usuarioId: string }
  | { tipo: 'capacitacion'; empresaId: string; usuarioId: string }
  | { tipo: 'exportacion'; empresaId: string; generadaPorId: string }
  | { tipo: 'mensaje'; empresaId: string; habilitados: string[] }
  | { tipo: 'wentop'; empresaId: string; creadorId: string; sectorObservacionId: string | null }
  // Avatares y logo: se pintan en cada listado de la empresa, no hay dueño a proteger.
  | { tipo: 'publico-empresa'; empresaId: string };

export async function duenoDelArchivo(url: string): Promise<DuenoArchivo | null> {
  const [ausencia, avatar, mensaje, respuesta, capacitacion, exportacion, foto, logo] =
    await Promise.all([
      prisma.ausencia.findFirst({
        where: { archivoUrl: url },
        select: { usuarioId: true, usuario: { select: { empresaId: true } } },
      }),
      prisma.usuario.findFirst({ where: { avatarUrl: url }, select: { empresaId: true } }),
      prisma.mensaje.findFirst({
        where: { archivoUrl: url },
        select: {
          empresaId: true,
          remitenteId: true,
          destinatarios: { select: { usuarioId: true } },
        },
      }),
      prisma.mensajeRespuesta.findFirst({
        where: { archivoUrl: url },
        select: {
          usuarioId: true,
          mensaje: {
            select: {
              empresaId: true,
              remitenteId: true,
              destinatarios: { select: { usuarioId: true } },
            },
          },
        },
      }),
      prisma.empleadoCapacitacion.findFirst({
        where: { archivoUrl: url },
        select: { usuarioId: true, usuario: { select: { empresaId: true } } },
      }),
      prisma.exportacion.findFirst({
        where: { archivoUrl: url },
        select: { empresaId: true, generadaPorId: true },
      }),
      prisma.wentopFoto.findFirst({
        where: { url },
        select: {
          tarjeta: { select: { empresaId: true, creadorId: true, sectorObservacionId: true } },
        },
      }),
      prisma.empresa.findFirst({ where: { logoUrl: url }, select: { id: true } }),
    ]);

  if (ausencia) {
    return { tipo: 'ausencia', empresaId: ausencia.usuario.empresaId, usuarioId: ausencia.usuarioId };
  }
  if (capacitacion) {
    return {
      tipo: 'capacitacion',
      empresaId: capacitacion.usuario.empresaId,
      usuarioId: capacitacion.usuarioId,
    };
  }
  if (exportacion) {
    return {
      tipo: 'exportacion',
      empresaId: exportacion.empresaId,
      generadaPorId: exportacion.generadaPorId,
    };
  }
  if (mensaje) {
    return {
      tipo: 'mensaje',
      empresaId: mensaje.empresaId,
      habilitados: [mensaje.remitenteId, ...mensaje.destinatarios.map((d) => d.usuarioId)],
    };
  }
  if (respuesta) {
    // La respuesta la ven los mismos que el mensaje padre, más quien la escribió.
    return {
      tipo: 'mensaje',
      empresaId: respuesta.mensaje.empresaId,
      habilitados: [
        respuesta.usuarioId,
        respuesta.mensaje.remitenteId,
        ...respuesta.mensaje.destinatarios.map((d) => d.usuarioId),
      ],
    };
  }
  if (foto) {
    return {
      tipo: 'wentop',
      empresaId: foto.tarjeta.empresaId,
      creadorId: foto.tarjeta.creadorId,
      sectorObservacionId: foto.tarjeta.sectorObservacionId,
    };
  }
  if (avatar) return { tipo: 'publico-empresa', empresaId: avatar.empresaId };
  if (logo) return { tipo: 'publico-empresa', empresaId: logo.id };

  return null;
}

/** Mismo criterio que buildVisibilityWhere() de wentop.routes. */
async function puedeVerTarjeta(
  dueno: { creadorId: string; sectorObservacionId: string | null },
  actor: ActorUpload,
): Promise<boolean> {
  if (actor.rol === 'CMASS' || actor.rolNivel >= LEVEL_RRHH) return true;
  if (dueno.creadorId === actor.userId) return true;
  if (!dueno.sectorObservacionId) return false;
  if (actor.sectorId && actor.sectorId === dueno.sectorObservacionId) return true;

  const gestor = await prisma.wentopGestor.findFirst({
    where: { usuarioId: actor.userId, sectorId: dueno.sectorObservacionId, activo: true },
    select: { id: true },
  });
  return gestor !== null;
}

/**
 * Autorización de /uploads por persona. Cada rama replica el criterio de la ruta
 * que expone ese registro: si alguien puede abrir la ausencia, puede abrir su
 * certificado, y si no puede, tampoco adivinando el nombre del archivo.
 */
export async function puedeVerUpload(url: string, actor: ActorUpload): Promise<boolean> {
  const dueno = await duenoDelArchivo(url);

  // Ninguna fila lo referencia: es basura de una subida fallida o un archivo que
  // quedó suelto tras un borrado. No hay dueño a quien consultar y nada del front
  // lo necesita, así que no se sirve.
  if (!dueno) return false;
  if (dueno.empresaId !== actor.empresaId) return false;

  switch (dueno.tipo) {
    case 'publico-empresa':
      return true;

    case 'ausencia': {
      // El titular siempre. Para el resto rige lo mismo que para la planilla: hace
      // falta que el dueño le quede visible por nivel. Con `canManageUser` alcanzaba
      // con ser nivel >= 70 del mismo sector, así que un par podía abrir el
      // certificado médico de otro par por URL directa aunque no viera su planilla.
      if (dueno.usuarioId === actor.userId) return true;
      if (actor.rolNivel >= LEVEL_RRHH) return true;
      const visibles = await getFlowVisibleUserIds(
        prisma, actor.userId, actor.empresaId, actor.rol, actor.rolNivel, 'AUSENCIA',
      );
      return visibles.includes(dueno.usuarioId);
    }

    case 'capacitacion':
      // GET /capacitaciones/registros pide COORDINADOR; el propio legajo siempre.
      return dueno.usuarioId === actor.userId || actor.rolNivel >= LEVEL_COORDINADOR;

    case 'exportacion':
      // Un export trae la liquidación de medio padrón: quien lo generó, o RRHH.
      return dueno.generadaPorId === actor.userId || actor.rolNivel >= LEVEL_RRHH;

    case 'mensaje':
      return dueno.habilitados.includes(actor.userId);

    case 'wentop':
      return puedeVerTarjeta(dueno, actor);
  }
}
