import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

/**
 * GET /config/periodo — Días de inicio y fin del ciclo de planilla.
 *
 * Deliberadamente separado de /admin/config, que es ADMIN-only y devuelve
 * también las tarifas. Esto lo necesita cualquier usuario autenticado porque
 * el selector de períodos aparece en Cierre, Aprobaciones, Analytics,
 * Ausencias y Vacaciones.
 */
router.get('/periodo', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const config = await prisma.empresaConfig.findUnique({
      where: { empresaId: req.user!.empresaId },
      select: { periodoDiaInicio: true, periodoDiaFin: true },
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

export default router;
