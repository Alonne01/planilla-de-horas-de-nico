import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_ADMIN } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);
router.use(requireLevel(LEVEL_ADMIN));

// ─── Schemas ─────────────────────────────────────

// Shared paso shape used in create/update/individual step operations
const pasoSchema = z.object({
  orden: z.number().int().min(1),
  nombrePaso: z.string().min(1).max(100),
  rolAprobador: z.string().min(1),
  usuarioEspecificoId: z.string().uuid().optional().nullable(),
  requiereComentarioRechazo: z.boolean().optional(),
  notificarRoles: z.array(z.string().min(1)).optional(),
  tiempoLimiteHoras: z.number().int().optional().nullable(),
});

const createFlujoSchema = z.object({
  nombre: z.string().min(1).max(100),
  tipoDocumento: z.enum(['PLANILLA', 'VACACION', 'AUSENCIA', 'COMPENSATORIO']),
  descripcion: z.string().max(500).optional(),
  pasos: z.array(pasoSchema).min(1),
});

const updateFlujoSchema = z.object({
  nombre: z.string().min(1).max(100).optional(),
  descripcion: z.string().max(500).optional(),
  activo: z.boolean().optional(),
  pasos: z.array(pasoSchema).min(1).optional(),
});

// Alias for the individual step creation endpoint
const createPasoSchema = pasoSchema;

const createAsignacionSchema = z.object({
  flujoId: z.string().uuid(),
  tipoDocumento: z.string().min(1),
  sectorId: z.string().uuid().optional().nullable(),
  usuarioId: z.string().uuid().optional().nullable(),
});

// ─── GET /admin/flujos ───────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const flujos = await prisma.flujoAprobacion.findMany({
      where: { empresaId: req.user!.empresaId },
      include: {
        pasos: { orderBy: { orden: 'asc' } },
        _count: { select: { asignaciones: true, planillas: true, vacaciones: true } },
      },
      orderBy: { nombre: 'asc' },
    });
    res.json(flujos);
  } catch (error) {
    console.error('Error listing flujos:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /admin/flujos ──────────────────────────

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createFlujoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const flujo = await prisma.flujoAprobacion.create({
      data: {
        empresaId: req.user!.empresaId,
        nombre: parsed.data.nombre,
        tipoDocumento: parsed.data.tipoDocumento,
        descripcion: parsed.data.descripcion ?? null,
        pasos: {
          create: parsed.data.pasos.map((p) => ({
            orden: p.orden,
            nombrePaso: p.nombrePaso,
            rolAprobador: p.rolAprobador,
            usuarioEspecificoId: p.usuarioEspecificoId ?? null,
            requiereComentarioRechazo: p.requiereComentarioRechazo ?? true,
            notificarRoles: p.notificarRoles ?? [],
            tiempoLimiteHoras: p.tiempoLimiteHoras ?? null,
          })),
        },
      },
      include: { pasos: { orderBy: { orden: 'asc' } } },
    });

    res.status(201).json(flujo);
  } catch (error) {
    console.error('Error creating flujo:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /admin/flujos/:id ───────────────────────

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const flujoId = req.params.id as string;
    const flujo = await prisma.flujoAprobacion.findFirst({
      where: { id: flujoId, empresaId: req.user!.empresaId },
      include: {
        pasos: {
          orderBy: { orden: 'asc' },
          include: { usuarioEspecifico: { select: { nombre: true, apellido: true } } },
        },
        asignaciones: {
          include: {
            sector: { select: { id: true, nombre: true } },
            usuario: { select: { id: true, nombre: true, apellido: true } },
          },
        },
      },
    });

    if (!flujo) {
      res.status(404).json({ error: 'Flujo no encontrado' });
      return;
    }
    res.json(flujo);
  } catch (error) {
    console.error('Error getting flujo:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /admin/flujos/:id ───────────────────────

router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const flujoId = req.params.id as string;
    const parsed = updateFlujoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos' });
      return;
    }

    const existing = await prisma.flujoAprobacion.findFirst({
      where: { id: flujoId, empresaId: req.user!.empresaId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Flujo no encontrado' });
      return;
    }

    const { pasos, ...flujoData } = parsed.data;

    let flujo;
    if (pasos) {
      // Atomic replace: delete all steps and create the new ones in one transaction
      const [, updated] = await prisma.$transaction([
        prisma.flujoPaso.deleteMany({ where: { flujoId } }),
        prisma.flujoAprobacion.update({
          where: { id: flujoId },
          data: {
            ...flujoData,
            pasos: {
              create: pasos.map((p) => ({
                orden: p.orden,
                nombrePaso: p.nombrePaso,
                rolAprobador: p.rolAprobador,
                usuarioEspecificoId: p.usuarioEspecificoId ?? null,
                requiereComentarioRechazo: p.requiereComentarioRechazo ?? true,
                notificarRoles: p.notificarRoles ?? [],
                tiempoLimiteHoras: p.tiempoLimiteHoras ?? null,
              })),
            },
          },
          include: { pasos: { orderBy: { orden: 'asc' } } },
        }),
      ]);
      flujo = updated;
    } else {
      flujo = await prisma.flujoAprobacion.update({
        where: { id: flujoId },
        data: flujoData,
        include: { pasos: { orderBy: { orden: 'asc' } } },
      });
    }
    res.json(flujo);
  } catch (error) {
    console.error('Error updating flujo:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /admin/flujos/:id ────────────────────

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const flujoId = req.params.id as string;
    const existing = await prisma.flujoAprobacion.findFirst({
      where: { id: flujoId, empresaId: req.user!.empresaId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Flujo no encontrado' });
      return;
    }

    await prisma.flujoAprobacion.delete({ where: { id: flujoId } });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting flujo:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /admin/flujos/:id/pasos ────────────────

router.post('/:id/pasos', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const flujoId = req.params.id as string;
    const parsed = createPasoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const flujo = await prisma.flujoAprobacion.findFirst({
      where: { id: flujoId, empresaId: req.user!.empresaId },
    });
    if (!flujo) {
      res.status(404).json({ error: 'Flujo no encontrado' });
      return;
    }

    const paso = await prisma.flujoPaso.create({
      data: {
        flujoId,
        orden: parsed.data.orden,
        nombrePaso: parsed.data.nombrePaso,
        rolAprobador: parsed.data.rolAprobador,
        usuarioEspecificoId: parsed.data.usuarioEspecificoId ?? null,
        requiereComentarioRechazo: parsed.data.requiereComentarioRechazo ?? true,
        notificarRoles: parsed.data.notificarRoles ?? [],
        tiempoLimiteHoras: parsed.data.tiempoLimiteHoras ?? null,
      },
    });
    res.status(201).json(paso);
  } catch (error) {
    console.error('Error creating paso:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /admin/flujos/:id/pasos/:pid ────────────

router.put('/:id/pasos/:pid', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const pid = req.params.pid as string;
    const paso = await prisma.flujoPaso.update({
      where: { id: pid },
      data: req.body,
    });
    res.json(paso);
  } catch (error) {
    console.error('Error updating paso:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /admin/flujos/:id/pasos/:pid ─────────

router.delete('/:id/pasos/:pid', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const pid = req.params.pid as string;
    await prisma.flujoPaso.delete({ where: { id: pid } });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting paso:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /admin/flujos/asignaciones ──────────────

router.get('/asignaciones/list', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const asignaciones = await prisma.flujoAsignacion.findMany({
      where: { flujo: { empresaId: req.user!.empresaId } },
      include: {
        flujo: { select: { nombre: true, tipoDocumento: true } },
        sector: { select: { id: true, nombre: true } },
        usuario: { select: { id: true, nombre: true, apellido: true } },
      },
    });
    res.json(asignaciones);
  } catch (error) {
    console.error('Error listing asignaciones:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /admin/flujos/asignaciones ─────────────

router.post('/asignaciones', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createAsignacionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const flujo = await prisma.flujoAprobacion.findFirst({
      where: { id: parsed.data.flujoId, empresaId: req.user!.empresaId },
    });
    if (!flujo) {
      res.status(404).json({ error: 'Flujo no encontrado' });
      return;
    }

    // Prevent duplicate assignments for same scope
    const existing = await prisma.flujoAsignacion.findFirst({
      where: {
        flujoId: parsed.data.flujoId,
        tipoDocumento: parsed.data.tipoDocumento,
        sectorId: parsed.data.sectorId ?? null,
        usuarioId: parsed.data.usuarioId ?? null,
      },
    });
    if (existing) {
      res.status(409).json({ error: 'Ya existe una asignación con el mismo alcance para este flujo' });
      return;
    }

    const asignacion = await prisma.flujoAsignacion.create({
      data: {
        flujoId: parsed.data.flujoId,
        tipoDocumento: parsed.data.tipoDocumento,
        sectorId: parsed.data.sectorId ?? null,
        usuarioId: parsed.data.usuarioId ?? null,
      },
    });
    res.status(201).json(asignacion);
  } catch (error) {
    console.error('Error creating asignacion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /admin/flujos/asignaciones/:id ───────

router.delete('/asignaciones/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const asignacion = await prisma.flujoAsignacion.findFirst({
      where: { id: req.params.id, flujo: { empresaId: req.user!.empresaId } },
    });
    if (!asignacion) {
      res.status(404).json({ error: 'Asignación no encontrada' });
      return;
    }
    await prisma.flujoAsignacion.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting asignacion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
