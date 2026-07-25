import { Router, Response } from 'express';
import { PrismaClient, DiagramaTipo } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_ADMIN } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);
router.use(requireLevel(LEVEL_ADMIN));

// ─── Schemas ─────────────────────────────────────

const createDiagramaSchema = z.object({
  nombre: z.string().min(1).max(50),
  tipo: z.nativeEnum(DiagramaTipo),
  diasTrabajo: z.number().int().min(1).max(60).optional(),
  diasDescanso: z.number().int().min(1).max(60).optional(),
  diasSemana: z.array(z.number().int().min(0).max(6)).optional(),
  descripcion: z.string().max(250).optional(),
}).refine(
  (data) => {
    if (data.tipo === 'ROTATIVO') return data.diasTrabajo !== undefined && data.diasDescanso !== undefined;
    if (data.tipo === 'FIJO_SEMANA') return data.diasSemana !== undefined && data.diasSemana.length > 0;
    return true;
  },
  { message: 'ROTATIVO requiere diasTrabajo/diasDescanso, FIJO_SEMANA requiere diasSemana' }
);

const updateDiagramaSchema = z.object({
  nombre: z.string().min(1).max(50).optional(),
  descripcion: z.string().max(250).optional(),
  activo: z.boolean().optional(),
});

// ─── GET /admin/diagramas ────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const diagramas = await prisma.diagrama.findMany({
      where: { empresaId: req.user!.empresaId },
      include: {
        _count: { select: { asignaciones: true } },
      },
      orderBy: { nombre: 'asc' },
    });

    res.json(diagramas.map((d) => ({
      ...d,
      asignacionesCount: d._count.asignaciones,
      _count: undefined,
    })));
  } catch (error) {
    console.error('Error listing diagramas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /admin/diagramas ───────────────────────

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createDiagramaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const diagrama = await prisma.diagrama.create({
      data: {
        empresaId: req.user!.empresaId,
        nombre: parsed.data.nombre,
        tipo: parsed.data.tipo,
        diasTrabajo: parsed.data.diasTrabajo ?? null,
        diasDescanso: parsed.data.diasDescanso ?? null,
        diasSemana: parsed.data.diasSemana ?? [],
        descripcion: parsed.data.descripcion ?? null,
      },
    });

    res.status(201).json(diagrama);
  } catch (error) {
    console.error('Error creating diagrama:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── PUT /admin/diagramas/:id ────────────────────

router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = updateDiagramaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const existing = await prisma.diagrama.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Diagrama no encontrado' });
      return;
    }

    const diagrama = await prisma.diagrama.update({
      where: { id: req.params.id },
      data: parsed.data,
    });

    res.json(diagrama);
  } catch (error) {
    console.error('Error updating diagrama:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── DELETE /admin/diagramas/:id ─────────────────

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.diagrama.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Diagrama no encontrado' });
      return;
    }

    const activeAssignments = await prisma.usuarioDiagrama.count({
      where: { diagramaId: req.params.id, activo: true },
    });
    if (activeAssignments > 0) {
      res.status(409).json({
        error: `No se puede eliminar: tiene ${activeAssignments} asignación(es) activa(s)`,
      });
      return;
    }

    // Historical (inactive) assignments still reference this diagrama via FK, so a
    // hard delete would throw P2003. Soft-delete instead to preserve history.
    const historicalAssignments = await prisma.usuarioDiagrama.count({
      where: { diagramaId: req.params.id },
    });
    if (historicalAssignments > 0) {
      await prisma.diagrama.update({
        where: { id: req.params.id },
        data: { activo: false },
      });
      res.status(200).json({ softDeleted: true, message: 'Diagrama desactivado (conserva historial de asignaciones)' });
      return;
    }

    // solicitudes_cambio_diagrama.diagrama_nuevo_id is ON DELETE RESTRICT, so a hard
    // delete would throw P2003 if any request references this diagrama as the new one.
    // (diagrama_actual_id is ON DELETE SET NULL and does not block deletion, so it's
    // intentionally excluded from this check.) Soft-delete instead, same as historical
    // assignments above.
    const solicitudesAsociadas = await prisma.solicitudCambioDiagrama.count({
      where: { diagramaNuevoId: req.params.id },
    });
    if (solicitudesAsociadas > 0) {
      await prisma.diagrama.update({
        where: { id: req.params.id },
        data: { activo: false },
      });
      res.status(200).json({ softDeleted: true, message: 'Diagrama desactivado (tiene solicitudes de cambio asociadas)' });
      return;
    }

    await prisma.diagrama.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting diagrama:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
