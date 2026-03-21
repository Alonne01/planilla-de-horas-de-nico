import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── Schema ──────────────────────────────────────

const createNotifSchema = z.object({
  usuarioId: z.string().uuid(),
  tipo: z.string().max(50),
  titulo: z.string().max(200),
  cuerpo: z.string().max(1000).optional(),
  link: z.string().max(200).optional(),
});

// ─── GET /notificaciones ─────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const notificaciones = await prisma.notificacion.findMany({
      where: { usuarioId: req.user!.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(notificaciones);
  } catch (error) {
    console.error('Error listing notificaciones:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /notificaciones/count ───────────────────

router.get('/count', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const count = await prisma.notificacion.count({
      where: { usuarioId: req.user!.userId, leida: false },
    });
    res.json({ count });
  } catch (error) {
    console.error('Error counting notificaciones:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /notificaciones/:id/leer ────────────────

router.put('/:id/leer', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.notificacion.updateMany({
      where: { id: req.params.id as string, usuarioId: req.user!.userId },
      data: { leida: true },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error marking notificacion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /notificaciones/leer-todas ──────────────

router.put('/leer-todas', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.notificacion.updateMany({
      where: { usuarioId: req.user!.userId, leida: false },
      data: { leida: true },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error marking all notificaciones:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /notificaciones (admin/system) ─────────

router.post('/', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createNotifSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos' });
      return;
    }
    const notif = await prisma.notificacion.create({
      data: {
        usuarioId: parsed.data.usuarioId,
        tipo: parsed.data.tipo,
        titulo: parsed.data.titulo,
        cuerpo: parsed.data.cuerpo ?? null,
        link: parsed.data.link ?? null,
      },
    });
    res.status(201).json(notif);
  } catch (error) {
    console.error('Error creating notificacion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
