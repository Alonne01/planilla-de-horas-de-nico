import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_ADMIN } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);
router.use(requireLevel(LEVEL_ADMIN));

// ─── Schema ──────────────────────────────────────

const updateConfigSchema = z.object({
  periodoDiaInicio: z.number().int().min(1).max(31).optional(),
  periodoDiaFin: z.number().int().min(1).max(31).optional(),
  umbralExtra50: z.number().min(0).max(24).optional(),
  umbralExtra100: z.number().min(0).max(24).optional(),
  horasJornadaNormal: z.number().min(0).max(24).optional(),
  descuentoAlmuerzoMinutos: z.number().min(0).max(120).optional(),
  descuentoAlmuerzoCampo: z.boolean().optional(),
  redondeoMinutos: z.number().int().min(1).max(60).optional(),
  horasViajeDefault: z.number().min(0).max(24).optional(),
  zonaHoraria: z.string().max(50).optional(),
  moneda: z.string().max(10).optional(),
});

// ─── GET /admin/config ───────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const config = await prisma.empresaConfig.findUnique({
      where: { empresaId: req.user!.empresaId },
    });
    if (!config) {
      res.status(404).json({ error: 'Configuración no encontrada' });
      return;
    }
    res.json(config);
  } catch (error) {
    console.error('Error getting config:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /admin/config ───────────────────────────

router.put('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = updateConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const config = await prisma.empresaConfig.update({
      where: { empresaId: req.user!.empresaId },
      data: parsed.data,
    });
    res.json(config);
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
