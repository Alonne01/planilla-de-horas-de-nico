import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_ADMIN } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

// All routes require auth + ADMIN role
router.use(authMiddleware);
router.use(requireLevel(LEVEL_ADMIN));

// ─── Schemas ─────────────────────────────────────

const createSectorSchema = z.object({
  nombre: z.string().min(1, 'Nombre requerido').max(100),
  descripcion: z.string().max(500).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color debe ser hex (#RRGGBB)').optional(),
});

const updateSectorSchema = createSectorSchema.partial().extend({
  activo: z.boolean().optional(),
});

// ─── GET /admin/sectores ─────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sectores = await prisma.sector.findMany({
      where: { empresaId: req.user!.empresaId },
      include: {
        _count: { select: { usuarios: true } },
      },
      orderBy: { nombre: 'asc' },
    });

    res.json(sectores.map((s) => ({
      ...s,
      usuariosCount: s._count.usuarios,
      _count: undefined,
    })));
  } catch (error) {
    console.error('Error listing sectores:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /admin/sectores ────────────────────────

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createSectorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const sector = await prisma.sector.create({
      data: {
        empresaId: req.user!.empresaId,
        ...parsed.data,
      },
    });

    res.status(201).json(sector);
  } catch (error) {
    console.error('Error creating sector:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── PUT /admin/sectores/:id ─────────────────────

router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = updateSectorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    // Verify ownership
    const existing = await prisma.sector.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Sector no encontrado' });
      return;
    }

    const sector = await prisma.sector.update({
      where: { id: req.params.id },
      data: parsed.data,
    });

    res.json(sector);
  } catch (error) {
    console.error('Error updating sector:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── DELETE /admin/sectores/:id ──────────────────

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.sector.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Sector no encontrado' });
      return;
    }

    // Check if sector has users
    const usersCount = await prisma.usuario.count({
      where: { sectorId: req.params.id },
    });
    if (usersCount > 0) {
      res.status(409).json({
        error: `No se puede eliminar: tiene ${usersCount} usuario(s) asignado(s)`,
      });
      return;
    }

    await prisma.sector.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting sector:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
