import { Router, Response } from 'express';
import { PrismaClient, CambioDiagramaEstado } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_SUPERVISOR, LEVEL_COORDINADOR } from '../middleware/roles.middleware.js';

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

const createSolicitudSchema = z.object({
  usuarioId: z.string().uuid(),
  diagramaNuevoId: z.string().uuid(),
  motivo: z.string().min(1).max(500).optional(),
  fechaEfectiva: z.string().datetime().optional(),
});

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
        usuario: { select: { id: true, nombre: true, apellido: true, legajo: true, sector: { select: { nombre: true } } } },
        solicitante: { select: { id: true, nombre: true, apellido: true } },
        diagramaActual: { select: { id: true, nombre: true, tipo: true, diasTrabajo: true, diasDescanso: true } },
        diagramaNuevo: { select: { id: true, nombre: true, tipo: true, diasTrabajo: true, diasDescanso: true } },
        flujo: { include: { pasos: { orderBy: { orden: 'asc' } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(solicitudes);
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

    // Resolve flujo for CAMBIO_DIAGRAMA (3-step priority: user → sector → default)
    let flujo = await prisma.flujoAprobacion.findFirst({
      where: {
        empresaId: req.user!.empresaId,
        tipoDocumento: 'CAMBIO_DIAGRAMA',
        activo: true,
        asignaciones: { some: { usuarioId, activo: true, tipoDocumento: 'CAMBIO_DIAGRAMA' } },
      },
      include: { pasos: { orderBy: { orden: 'asc' } } },
    });

    if (!flujo && targetUser.sectorId) {
      flujo = await prisma.flujoAprobacion.findFirst({
        where: {
          empresaId: req.user!.empresaId,
          tipoDocumento: 'CAMBIO_DIAGRAMA',
          activo: true,
          asignaciones: { some: { sectorId: targetUser.sectorId, activo: true, tipoDocumento: 'CAMBIO_DIAGRAMA' } },
        },
        include: { pasos: { orderBy: { orden: 'asc' } } },
      });
    }

    if (!flujo) {
      flujo = await prisma.flujoAprobacion.findFirst({
        where: {
          empresaId: req.user!.empresaId,
          tipoDocumento: 'CAMBIO_DIAGRAMA',
          activo: true,
          asignaciones: { some: { sectorId: null, usuarioId: null, activo: true, tipoDocumento: 'CAMBIO_DIAGRAMA' } },
        },
        include: { pasos: { orderBy: { orden: 'asc' } } },
      });
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

    res.status(201).json(solicitud);
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
        usuario: { select: { id: true, empresaId: true } },
      },
    });

    if (!solicitud || solicitud.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Solicitud no encontrada' });
      return;
    }
    if (solicitud.estado !== 'PENDIENTE' && solicitud.estado !== 'EN_REVISION') {
      res.status(400).json({ error: 'La solicitud no está pendiente de revisión' });
      return;
    }

    const pasos = solicitud.flujo?.pasos ?? [];
    const totalPasos = pasos.length;
    const pasoActual = solicitud.pasoActual;
    let nuevoEstado: CambioDiagramaEstado;
    let nuevoPaso: number;

    if (pasoActual > totalPasos || totalPasos === 0) {
      nuevoEstado = 'APROBADA';
      nuevoPaso = pasoActual;
    } else {
      const pasoConfig = pasos.find(p => p.orden === pasoActual);
      if (!pasoConfig) {
        res.status(500).json({ error: `Configuración de paso ${pasoActual} no encontrada` });
        return;
      }
      if (pasoConfig.rolAprobador !== req.user!.rol) {
        if ((req.user!.rolNivel ?? 0) < 90) {
          res.status(403).json({ error: `Este paso requiere el rol ${pasoConfig.rolAprobador}` });
          return;
        }
      }

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
        const yaAprobo = await tx.cambioDiagramaHistorial.findFirst({
          where: {
            solicitudId: solId,
            usuarioId: req.user!.userId,
            pasoFlujo: nuevoPaso,
            createdAt: { gt: lastSubmission?.createdAt ?? new Date(0) },
          },
        });
        if (yaAprobo) throw new Error('DUPLICATE_APPROVAL');

        // On final approval: apply the diagram change
        if (nuevoEstado === 'APROBADA') {
          // Close current diagram assignment
          await tx.usuarioDiagrama.updateMany({
            where: { usuarioId: solicitud.usuarioId, activo: true },
            data: { activo: false, fechaFin: solicitud.fechaEfectiva ?? new Date() },
          });

          // Create new diagram assignment
          await tx.usuarioDiagrama.create({
            data: {
              usuarioId: solicitud.usuarioId,
              diagramaId: solicitud.diagramaNuevoId,
              fechaInicio: solicitud.fechaEfectiva ?? new Date(),
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
            pasoFlujo: nuevoPaso,
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
      include: { usuario: { select: { empresaId: true } } },
    });

    if (!solicitud || solicitud.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Solicitud no encontrada' });
      return;
    }
    if (solicitud.estado !== 'PENDIENTE' && solicitud.estado !== 'EN_REVISION') {
      res.status(400).json({ error: 'La solicitud no está pendiente de revisión' });
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
        comentario: motivo,
      },
    });

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
    });

    if (!solicitud) {
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

export default router;
