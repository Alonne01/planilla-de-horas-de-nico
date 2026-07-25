import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);
router.use(requireLevel(LEVEL_RRHH));

// ─── Schema ──────────────────────────────────────

const alertaSchema = z.object({
  tipo: z.string().min(1).max(100),
  activa: z.boolean().optional(),
  diasAnticipacion: z.number().int().min(0).nullable().optional(),
  horasLimite: z.number().int().min(0).nullable().optional(),
  rolesDestino: z.array(z.string()).optional(),
  descripcion: z.string().max(500).nullable().optional(),
});

// ─── GET / — List all alert configs ──────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const alertas = await prisma.alertaConfig.findMany({
      where: { empresaId: req.user!.empresaId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(alertas);
  } catch (err) {
    console.error('Error fetching alertas:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST / — Create alert config ───────────────

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = alertaSchema.parse(req.body);
    const alerta = await prisma.alertaConfig.create({
      data: {
        empresaId: req.user!.empresaId,
        tipo: data.tipo,
        activa: data.activa ?? true,
        diasAnticipacion: data.diasAnticipacion ?? null,
        horasLimite: data.horasLimite ?? null,
        rolesDestino: data.rolesDestino ?? ['RRHH'],
        descripcion: data.descripcion ?? null,
      },
    });
    res.status(201).json(alerta);
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Datos inválidos', details: err.flatten() });
      return;
    }
    console.error('Error creating alerta:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /:id — Update alert config ─────────────

router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.alertaConfig.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });
    if (!existing) { res.status(404).json({ error: 'Alerta no encontrada' }); return; }

    const data = alertaSchema.partial().parse(req.body);
    const alerta = await prisma.alertaConfig.update({
      where: { id: req.params.id },
      data: {
        ...(data.tipo !== undefined && { tipo: data.tipo }),
        ...(data.activa !== undefined && { activa: data.activa }),
        ...(data.diasAnticipacion !== undefined && { diasAnticipacion: data.diasAnticipacion }),
        ...(data.horasLimite !== undefined && { horasLimite: data.horasLimite }),
        ...(data.rolesDestino !== undefined && { rolesDestino: data.rolesDestino }),
        ...(data.descripcion !== undefined && { descripcion: data.descripcion }),
      },
    });
    res.json(alerta);
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Datos inválidos', details: err.flatten() });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Alerta no encontrada' });
      return;
    }
    console.error('Error updating alerta:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PATCH /:id/toggle — Toggle active state ────

router.patch('/:id/toggle', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.alertaConfig.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });
    if (!existing) { res.status(404).json({ error: 'No encontrada' }); return; }

    const alerta = await prisma.alertaConfig.update({
      where: { id: req.params.id },
      data: { activa: !existing.activa },
    });
    res.json(alerta);
  } catch (err) {
    console.error('Error toggling alerta:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /:id — Delete alert config ───────────

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.alertaConfig.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });
    if (!existing) { res.status(404).json({ error: 'No encontrada' }); return; }

    await prisma.alertaConfig.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'No encontrada' });
      return;
    }
    console.error('Error deleting alerta:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
