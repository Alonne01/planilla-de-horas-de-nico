import { Router, Response } from 'express';
import { PrismaClient, CambioDiagramaEstado } from '@prisma/client';
import { z } from 'zod';
import { fechaFlexible } from '../utils/zod.utils.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_SUPERVISOR, LEVEL_COORDINADOR } from '../middleware/roles.middleware.js';
import { crearNotificacion, notificarAprobadoresPaso } from '../utils/notificacion.utils.js';
import {
  isResponsibleApprover,
  matchesCurrentStep,
  type AprobadorContexto,
} from '../utils/approval-auth.utils.js';
import {
  construirCircuito,
  nivelesPorRol,
  pasoActualDe,
  pasosDe,
  resolverFlujo,
  type PasoCircuito,
} from '../utils/circuito.utils.js';
import { cierreDeAsignacion } from '../utils/diagrama-vigencia.utils.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── GET /cambios-diagrama/diagramas ──────────────
// List available diagramas (for the request form)

router.get('/diagramas', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const diagramas = await prisma.diagrama.findMany({
      where: { empresaId: req.user!.empresaId, activo: true },
      select: { id: true, nombre: true, tipo: true, diasTrabajo: true, diasDescanso: true, descripcion: true },
      orderBy: { nombre: 'asc' },
    });
    res.json(diagramas);
  } catch (error) {
    console.error('Error listing diagramas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── Schemas ─────────────────────────────────────

/** Medianoche UTC de hoy: el piso contra el que se compara la fecha de inicio. */
function hoyUTC(): Date {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
}

const createSolicitudSchema = z.object({
  usuarioId: z.string().uuid(),
  diagramaNuevoId: z.string().uuid(),
  motivo: z.string().min(1).max(500).optional(),
  // Obligatoria y futura: el diagrama nuevo rige desde este día, y la solicitud
  // vence si no se termina de aprobar antes. Aceptarla vacía o pasada dejaría el
  // cambio aplicándose retroactivo sobre días ya cargados.
  fechaEfectiva: fechaFlexible,
}).refine(
  (d) => new Date(d.fechaEfectiva) > hoyUTC(),
  { message: 'La fecha de inicio del diagrama debe ser posterior a hoy', path: ['fechaEfectiva'] },
);

// ─── GET /cambios-diagrama ────────────────────────
// Lists solicitudes visible to the current user

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const where: any = {
      usuario: { empresaId: req.user!.empresaId },
    };

    // Non-RRHH/ADMIN see only their own requests
    if ((req.user!.rolNivel ?? 0) < 90) {
      where.solicitanteId = req.user!.userId;
    }

    const solicitudes = await prisma.solicitudCambioDiagrama.findMany({
      where,
      include: {
        usuario: { select: { id: true, nombre: true, apellido: true, legajo: true, sector: { select: { nombre: true } } } },
        solicitante: { select: { id: true, nombre: true, apellido: true } },
        diagramaActual: { select: { id: true, nombre: true, tipo: true, diasTrabajo: true, diasDescanso: true } },
        diagramaNuevo: { select: { id: true, nombre: true, tipo: true, diasTrabajo: true, diasDescanso: true } },
        aprobadaPor: { select: { id: true, nombre: true, apellido: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(solicitudes);
  } catch (error) {
    console.error('Error listing cambios diagrama:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /cambios-diagrama/pendientes ─────────────
// RRHH: pending requests needing approval

router.get('/pendientes', requireLevel(LEVEL_SUPERVISOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const solicitudes = await prisma.solicitudCambioDiagrama.findMany({
      where: {
        usuario: { empresaId: req.user!.empresaId },
        estado: { in: ['PENDIENTE', 'EN_REVISION'] },
      },
      include: {
        // `sectorId`, `supervisorId` y `coordinadorId` los necesita
        // `matchesCurrentStep` para decidir si el paso vigente le toca a quien
        // consulta. Sin ellos la decisión se tomaría con datos incompletos.
        usuario: {
          select: {
            id: true, nombre: true, apellido: true, legajo: true,
            sectorId: true, supervisorId: true, coordinadorId: true,
            sector: { select: { nombre: true } },
          },
        },
        solicitante: { select: { id: true, nombre: true, apellido: true } },
        diagramaActual: { select: { id: true, nombre: true, tipo: true, diasTrabajo: true, diasDescanso: true } },
        diagramaNuevo: { select: { id: true, nombre: true, tipo: true, diasTrabajo: true, diasDescanso: true } },
        flujo: { include: { pasos: { orderBy: { orden: 'asc' } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Antes devolvía TODAS las solicitudes de la empresa a cualquier nivel ≥60,
    // incluidas las de sectores ajenos y las de pasos que no le tocan. Se aplica
    // el mismo criterio que la bandeja unificada, que es el mismo que la guarda
    // de `/avanzar`: las tres vistas tienen que coincidir.
    const aprobador: AprobadorContexto = {
      userId: req.user!.userId,
      rol: req.user!.rol,
      nivel: req.user!.rolNivel ?? 0,
      sectorId: (await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { sectorId: true } }))?.sectorId ?? null,
    };

    res.json(solicitudes.filter((s) => matchesCurrentStep(s, aprobador)));
  } catch (error) {
    console.error('Error listing pendientes cambios diagrama:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /cambios-diagrama ──────────────────────
// Coordinador/Gerente creates a change request

router.post('/', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createSolicitudSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const { usuarioId, diagramaNuevoId, motivo, fechaEfectiva } = parsed.data;

    // Validate target user belongs to same empresa
    const targetUser = await prisma.usuario.findFirst({
      where: { id: usuarioId, empresaId: req.user!.empresaId, activo: true },
      include: {
        diagramas: {
          where: { activo: true },
          orderBy: { fechaInicio: 'desc' },
          take: 1,
          include: { diagrama: true },
        },
      },
    });
    if (!targetUser) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    // Validate new diagrama exists
    const nuevoDiagrama = await prisma.diagrama.findFirst({
      where: { id: diagramaNuevoId, empresaId: req.user!.empresaId, activo: true },
    });
    if (!nuevoDiagrama) {
      res.status(404).json({ error: 'Diagrama destino no encontrado' });
      return;
    }

    const diagramaActualId = targetUser.diagramas[0]?.diagramaId ?? null;

    // Prevent duplicate pending requests for same user
    const existing = await prisma.solicitudCambioDiagrama.findFirst({
      where: {
        usuarioId,
        estado: { in: ['PENDIENTE', 'EN_REVISION'] },
      },
    });
    if (existing) {
      res.status(409).json({ error: 'Ya existe una solicitud pendiente para este usuario' });
      return;
    }

    // El circuito se resuelve y se CONGELA acá porque en este tipo el alta ES el
    // envío: la solicitud nace PENDIENTE en el paso 1 y no hay un /enviar aparte
    // ni un borrador previo. Desde este punto, tocar la configuración de flujos
    // no altera el recorrido de lo que ya está en vuelo.
    //
    // Tanto el flujo como el nivel salen del DUEÑO del cambio (el empleado), no
    // de quien crea la solicitud: acá siempre las carga un tercero
    // (COORDINADOR+ por `requireLevel`), y con el nivel del que crea se
    // saltearían pasos que el cambio del empleado sí tiene que recorrer.
    //
    // Las tres consultas encadenadas que había acá (usuario → sector → global)
    // no llevaban `orderBy`: con dos asignaciones que empatan, el flujo elegido
    // lo decidía el orden físico de Postgres. `resolverFlujo` mantiene la misma
    // prioridad pero con orden determinístico.
    const flujo = await resolverFlujo(prisma, 'CAMBIO_DIAGRAMA', {
      userId: usuarioId,
      empresaId: req.user!.empresaId,
      sectorId: targetUser.sectorId,
    });
    const niveles = await nivelesPorRol(prisma, req.user!.empresaId);
    const nivelSolicitante = niveles[targetUser.rol] ?? 0;

    let circuito: PasoCircuito[] = [];
    if (flujo) {
      const pasosDelFlujo = await prisma.flujoPaso.findMany({
        where: { flujoId: flujo.id },
        orderBy: { orden: 'asc' },
      });
      // Sin cast: `FlujoPaso` trae campos de más (id, flujoId, accion*), pero por
      // tipado estructural encaja en `PasoCircuito` tal cual sale de Prisma.
      circuito = construirCircuito(pasosDelFlujo, nivelSolicitante, niveles);
    }

    const solicitud = await prisma.solicitudCambioDiagrama.create({
      data: {
        solicitanteId: req.user!.userId,
        usuarioId,
        diagramaActualId,
        diagramaNuevoId,
        flujoId: flujo?.id ?? null,
        motivo: motivo ?? null,
        fechaEfectiva: fechaEfectiva ? new Date(fechaEfectiva) : null,
        estado: 'PENDIENTE',
        pasoActual: 1,
        // Se guarda SIEMPRE el arreglo, aunque venga vacío: un `[]` dice "se creó
        // sin circuito", que es un hecho del documento. Dejar la columna en null
        // lo haría indistinguible de una solicitud anterior a este cambio y
        // `pasosDe` caería al flujo vivo, así que si después le cargan pasos a
        // ese flujo la solicitud en vuelo empezaría a seguir la cadena nueva —
        // justo lo que el congelado tiene que impedir.
        circuitoSnapshot: circuito,
      },
    });

    await prisma.cambioDiagramaHistorial.create({
      data: {
        solicitudId: solicitud.id,
        usuarioId: req.user!.userId,
        estadoNuevo: 'PENDIENTE',
        comentario: motivo ?? null,
      },
    });

    // Aviso a los aprobadores del paso 1: en este tipo el alta ES el envío.
    // El rol sale del `circuito` recién construido y no de `solicitud.flujoId`:
    // el snapshot renumera los pasos desde 1, así que buscar el paso vivo por
    // `orden` le avisaría al rol equivocado cuando el nivel del empleado acortó
    // el circuito. El nombre es el del DUEÑO del cambio (no el de quien lo
    // cargó): el aviso dice "X tiene una … pendiente de tu aprobación".
    await notificarAprobadoresPaso(
      usuarioId, req.user!.empresaId,
      { rolAprobador: circuito[0]?.rolAprobador }, 'CAMBIO_DIAGRAMA',
      `${targetUser.nombre} ${targetUser.apellido}`,
    );

    res.status(201).json({
      ...solicitud,
      // Sin circuito la solicitud queda en la rama de escape del avance, que
      // exige nivel RRHH o superior: conviene que quien la crea lo sepa ahora y
      // no cuando ve que nadie la aprueba.
      avisoSinCircuito: circuito.length === 0
        ? 'El sector del empleado no tiene circuito de aprobación configurado: el cambio de diagrama va a requerir una aprobación manual de RRHH o superior.'
        : undefined,
    });
  } catch (error) {
    console.error('Error creating solicitud cambio diagrama:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /cambios-diagrama/:id/avanzar ──────────
// Advance approval step (typically RRHH-only)

router.post('/:id/avanzar', requireLevel(LEVEL_SUPERVISOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const solId = req.params.id as string;
    const solicitud = await prisma.solicitudCambioDiagrama.findUnique({
      where: { id: solId },
      include: {
        flujo: { include: { pasos: { orderBy: { orden: 'asc' } } } },
        // `nombre`/`apellido` son para el aviso al aprobador del paso siguiente:
        // el cuerpo nombra al DUEÑO del cambio, que acá casi nunca es quien lo pidió.
        usuario: { select: { id: true, nombre: true, apellido: true, empresaId: true, sectorId: true, supervisorId: true, coordinadorId: true } },
        diagramaNuevo: { select: { nombre: true } },
      },
    });

    if (!solicitud || solicitud.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Solicitud no encontrada' });
      return;
    }
    // Nadie aprueba lo suyo, ni siquiera un ADMIN. Con la regla por nivel esto es
    // crítico: un RRHH que envía conserva el paso RRHH en su circuito.
    // La guarda es sobre `usuarioId` (el DUEÑO del cambio) y no sobre
    // `solicitanteId`: el coordinador que pidió el cambio para un subordinado sí
    // puede aprobarlo si el circuito se lo permite, porque el cambio no es suyo.
    if (solicitud.usuarioId === req.user!.userId) {
      res.status(403).json({ error: 'No podés aprobar ni rechazar tu propia solicitud de cambio de diagrama' });
      return;
    }
    if (solicitud.estado !== 'PENDIENTE' && solicitud.estado !== 'EN_REVISION') {
      res.status(400).json({ error: 'La solicitud no está pendiente de revisión' });
      return;
    }

    // El circuito congelado al crear la solicitud; los pasos vivos del flujo son
    // sólo el fallback de las solicitudes anteriores a este cambio.
    const pasos = pasosDe(solicitud);
    const totalPasos = pasos.length;
    const pasoActual = solicitud.pasoActual;
    let nuevoEstado: CambioDiagramaEstado;
    let nuevoPaso: number;
    // El rol del paso que se está FIRMANDO, para dejarlo escrito en el historial.
    // Queda en null en la rama sin circuito: ahí no hay paso que firmar.
    let rolPasoAprobado: string | null = null;

    // pasoActual is 1-based (matches el `orden` del circuito).
    if (pasoActual > totalPasos || totalPasos === 0) {
      // Sin circuito: se exige RRHH o superior. La guarda de autoaprobación que
      // vivía acá ya la cubre la general del principio del handler.
      if ((req.user!.rolNivel ?? 0) < 90) {
        res.status(403).json({ error: 'Se requiere nivel RRHH o superior para aprobar sin flujo de aprobación' });
        return;
      }
      nuevoEstado = 'APROBADA';
      nuevoPaso = pasoActual;
    } else {
      const pasoConfig = pasoActualDe(solicitud);
      if (!pasoConfig) {
        res.status(500).json({ error: `Configuración de paso ${pasoActual} no encontrada en el circuito` });
        return;
      }
      const approverSectorId = (await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { sectorId: true } }))?.sectorId ?? null;
      if (!isResponsibleApprover(pasoConfig.rolAprobador, solicitud.usuario, req.user!.userId, req.user!.rol, req.user!.rolNivel ?? 0, approverSectorId)) {
        res.status(403).json({ error: `No tenés autorización para aprobar esta solicitud en el paso de ${pasoConfig.rolAprobador}` });
        return;
      }

      rolPasoAprobado = pasoConfig.rolAprobador;
      nuevoPaso = pasoActual + 1;
      nuevoEstado = nuevoPaso > totalPasos ? 'APROBADA' : 'EN_REVISION';
    }

    // Atomic: optimistic concurrency + duplicate check
    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        const { count } = await tx.solicitudCambioDiagrama.updateMany({
          where: { id: solId, pasoActual },
          data: {
            estado: nuevoEstado,
            pasoActual: nuevoPaso,
            ...(nuevoEstado === 'APROBADA' ? { aprobadaPorId: req.user!.userId, aprobadaAt: new Date() } : {}),
          },
        });
        if (count === 0) throw new Error('CONCURRENT_MODIFICATION');

        // Duplicate check
        const lastSubmission = await tx.cambioDiagramaHistorial.findFirst({
          where: { solicitudId: solId, estadoNuevo: 'PENDIENTE' },
          orderBy: { createdAt: 'desc' },
        });
        // Se compara contra el paso que se está APROBANDO, no contra el destino:
        // lo que hay que impedir es que la misma persona firme dos veces el mismo
        // recorrido, y con el destino la comparación se corría un paso.
        const yaAprobo = await tx.cambioDiagramaHistorial.findFirst({
          where: {
            solicitudId: solId,
            usuarioId: req.user!.userId,
            pasoFlujo: solicitud.pasoActual,
            createdAt: { gt: lastSubmission?.createdAt ?? new Date(0) },
          },
        });
        if (yaAprobo) throw new Error('DUPLICATE_APPROVAL');

        // On final approval: apply the diagram change
        if (nuevoEstado === 'APROBADA') {
          const desde = solicitud.fechaEfectiva ?? new Date();
          // La saliente se cierra el día ANTERIOR al arranque de la entrante: si
          // ambas cubren el día del corte, ese día queda con dos diagramas
          // vigentes y el franco depende de un desempate.
          //
          // Se actualiza fila por fila (no updateMany) porque el cierre correcto
          // depende de la propia fechaInicio de CADA saliente: si la entrante
          // arranca el mismo día calendario en que arrancó la saliente,
          // diaAnterior(desde) cae antes de su propio inicio y queda un rango
          // invertido en el historial. cierreDeAsignacion() aplica esa guarda.
          const salientes = await tx.usuarioDiagrama.findMany({
            where: { usuarioId: solicitud.usuarioId, activo: true },
            select: { id: true, fechaInicio: true },
          });
          for (const saliente of salientes) {
            await tx.usuarioDiagrama.update({
              where: { id: saliente.id },
              data: { activo: false, fechaFin: cierreDeAsignacion(saliente.fechaInicio, desde) },
            });
          }

          await tx.usuarioDiagrama.create({
            data: {
              usuarioId: solicitud.usuarioId,
              diagramaId: solicitud.diagramaNuevoId,
              fechaInicio: desde,
              activo: true,
            },
          });
        }

        await tx.cambioDiagramaHistorial.create({
          data: {
            solicitudId: solId,
            usuarioId: req.user!.userId,
            estadoAnterior: solicitud.estado,
            estadoNuevo: nuevoEstado,
            // El paso FIRMADO, no el destino: el historial tiene que decir por
            // dónde pasó la solicitud, y el destino ni siquiera existe cuando la
            // firma es la última del circuito.
            pasoFlujo: pasoActual,
            rolAprobador: rolPasoAprobado,
            comentario: req.body?.comentario ?? null,
          },
        });

        return tx.solicitudCambioDiagrama.findUnique({ where: { id: solId } });
      });
    } catch (error: any) {
      if (error?.message === 'DUPLICATE_APPROVAL') {
        res.status(409).json({ error: 'Ya aprobaste este paso' });
        return;
      }
      if (error?.message === 'CONCURRENT_MODIFICATION') {
        res.status(409).json({ error: 'Modificación concurrente. Recargue la página.' });
        return;
      }
      throw error;
    }

    // Notify the affected employee and the requester (was missing entirely)
    if (nuevoEstado === 'APROBADA') {
      await crearNotificacion({
        usuarioId: solicitud.usuarioId,
        tipo: 'CAMBIO_DIAGRAMA',
        titulo: 'Tu diagrama fue actualizado',
        cuerpo: `Se aprobó el cambio de tu diagrama${solicitud.diagramaNuevo?.nombre ? ` a "${solicitud.diagramaNuevo.nombre}"` : ''}.`,
        link: '/dashboard',
      });
      if (solicitud.solicitanteId !== solicitud.usuarioId) {
        await crearNotificacion({
          usuarioId: solicitud.solicitanteId,
          tipo: 'CAMBIO_DIAGRAMA',
          titulo: 'Cambio de diagrama aprobado',
          cuerpo: 'La solicitud de cambio de diagrama que creaste fue aprobada.',
          link: '/cambios-diagrama',
        });
      }
    } else if (nuevoEstado === 'EN_REVISION') {
      if (solicitud.solicitanteId !== req.user!.userId) {
        await crearNotificacion({
          usuarioId: solicitud.solicitanteId,
          tipo: 'CAMBIO_DIAGRAMA',
          titulo: 'Cambio de diagrama avanzó de paso',
          cuerpo: 'La solicitud de cambio de diagrama avanzó al siguiente paso de aprobación.',
          link: '/cambios-diagrama',
        });
      }
      // Los avisos de arriba son para el SOLICITANTE ("lo tuyo avanzó"); éste es
      // para quien tiene que firmar el paso DESTINO, que es otra cosa y no había
      // nadie mandándolo. El rol sale de `pasos` —el circuito congelado de ESTA
      // solicitud— porque `nuevoPaso` indexa el snapshot renumerado y no la
      // cadena configurada. Acá `pasos` sirve aunque venga de la fila leída antes
      // del update: el snapshot se congela al crear la solicitud y `/avanzar` no
      // lo toca (a diferencia de `/enviar` en planillas, donde sí lo escribe).
      await notificarAprobadoresPaso(
        solicitud.usuarioId, req.user!.empresaId,
        { rolAprobador: pasos.find((p) => p.orden === nuevoPaso)?.rolAprobador },
        'CAMBIO_DIAGRAMA',
        `${solicitud.usuario.nombre} ${solicitud.usuario.apellido}`,
      );
    }

    res.json(updated);
  } catch (error) {
    console.error('Error al avanzar cambio diagrama:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /cambios-diagrama/:id/rechazar ──────────

router.post('/:id/rechazar', requireLevel(LEVEL_SUPERVISOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const solId = req.params.id as string;
    const { motivo } = req.body;
    if (!motivo) {
      res.status(400).json({ error: 'Se requiere un motivo de rechazo' });
      return;
    }

    const solicitud = await prisma.solicitudCambioDiagrama.findUnique({
      where: { id: solId },
      include: {
        flujo: { include: { pasos: { orderBy: { orden: 'asc' } } } },
        usuario: { select: { id: true, empresaId: true, sectorId: true, supervisorId: true, coordinadorId: true } },
      },
    });

    if (!solicitud || solicitud.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Solicitud no encontrada' });
      return;
    }
    // Nadie rechaza lo suyo: mismo criterio que en /avanzar. La guarda es sobre
    // `usuarioId` (el DUEÑO del cambio) y no sobre `solicitanteId`, así el
    // coordinador que pidió el cambio de un subordinado lo puede seguir
    // rechazando.
    if (solicitud.usuarioId === req.user!.userId) {
      res.status(403).json({ error: 'No podés aprobar ni rechazar tu propia solicitud de cambio de diagrama' });
      return;
    }
    if (solicitud.estado !== 'PENDIENTE' && solicitud.estado !== 'EN_REVISION') {
      res.status(400).json({ error: 'La solicitud no está pendiente de revisión' });
      return;
    }

    // El paso sale del circuito congelado; los pasos vivos del flujo son sólo el
    // fallback de las solicitudes anteriores a este cambio.
    const currentStep = pasoActualDe(solicitud);
    const approverSectorId = (await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { sectorId: true } }))?.sectorId ?? null;
    if (!currentStep || !isResponsibleApprover(currentStep.rolAprobador, solicitud.usuario, req.user!.userId, req.user!.rol, req.user!.rolNivel ?? 0, approverSectorId)) {
      res.status(403).json({ error: 'No tenés autorización para rechazar esta solicitud' });
      return;
    }

    const updated = await prisma.solicitudCambioDiagrama.update({
      where: { id: solId },
      data: { estado: 'RECHAZADA', obsRechazo: motivo, pasoActual: 0 },
    });

    await prisma.cambioDiagramaHistorial.create({
      data: {
        solicitudId: solId,
        usuarioId: req.user!.userId,
        estadoAnterior: solicitud.estado,
        estadoNuevo: 'RECHAZADA',
        // Dónde se cortó el circuito. El update de arriba ya dejó `pasoActual`
        // en 0, así que el valor sale de la fila que se leyó ANTES de rechazar:
        // sin esto el historial no dice en qué paso murió la solicitud.
        pasoFlujo: solicitud.pasoActual,
        rolAprobador: currentStep.rolAprobador,
        comentario: motivo,
      },
    });

    // Notify the requester of the rejection (was missing entirely)
    if (solicitud.solicitanteId !== req.user!.userId) {
      await crearNotificacion({
        usuarioId: solicitud.solicitanteId,
        tipo: 'CAMBIO_DIAGRAMA',
        titulo: 'Cambio de diagrama rechazado',
        cuerpo: `La solicitud de cambio de diagrama fue rechazada. Motivo: ${motivo}`,
        link: '/cambios-diagrama',
      });
    }

    res.json(updated);
  } catch (error) {
    console.error('Error al rechazar cambio diagrama:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /cambios-diagrama/:id ─────────────────
// Solicitante can cancel a pending request

router.delete('/:id', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const solId = req.params.id as string;
    const solicitud = await prisma.solicitudCambioDiagrama.findUnique({
      where: { id: solId },
      include: { usuario: { select: { empresaId: true } } },
    });

    // El borrado es físico: sin el filtro por empresa un RRHH podría cancelar solicitudes de otro tenant
    if (!solicitud || solicitud.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Solicitud no encontrada' });
      return;
    }
    if (solicitud.solicitanteId !== req.user!.userId && (req.user!.rolNivel ?? 0) < 90) {
      res.status(403).json({ error: 'Solo el solicitante puede cancelar' });
      return;
    }
    if (solicitud.estado !== 'PENDIENTE') {
      res.status(400).json({ error: 'Solo se pueden cancelar solicitudes pendientes' });
      return;
    }

    await prisma.solicitudCambioDiagrama.delete({ where: { id: solId } });
    res.status(204).send();
  } catch (error) {
    console.error('Error al cancelar cambio diagrama:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /cambios-diagrama/:id — detalle de una solicitud ───
// (Debe ir al final: después de /diagramas y /pendientes para no sombrearlas.)
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const solicitud = await prisma.solicitudCambioDiagrama.findFirst({
      where: { id: req.params.id, usuario: { empresaId: req.user!.empresaId } },
      include: {
        usuario: { select: { id: true, nombre: true, apellido: true, legajo: true, sector: { select: { nombre: true } } } },
        solicitante: { select: { id: true, nombre: true, apellido: true } },
        diagramaActual: { select: { id: true, nombre: true, tipo: true, diasTrabajo: true, diasDescanso: true } },
        diagramaNuevo: { select: { id: true, nombre: true, tipo: true, diasTrabajo: true, diasDescanso: true } },
        aprobadaPor: { select: { id: true, nombre: true, apellido: true } },
        flujo: { include: { pasos: { orderBy: { orden: 'asc' } } } },
      },
    });

    if (!solicitud) {
      res.status(404).json({ error: 'Solicitud no encontrada' });
      return;
    }

    // RRHH+ ve todo; aprobadores (nivel>=60) ven cualquiera; el resto, solo las propias.
    const nivel = req.user!.rolNivel ?? 0;
    if (nivel < 90 && nivel < 60 && solicitud.solicitanteId !== req.user!.userId) {
      res.status(403).json({ error: 'Sin permisos' });
      return;
    }

    res.json(solicitud);
  } catch (error) {
    console.error('Error getting cambio diagrama:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
