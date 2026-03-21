import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

/**
 * GET /aprobaciones
 *
 * Returns all pending planillas AND vacaciones that the current user
 * can approve, based on their role level.
 *
 * Also returns a history of recently approved/rejected items.
 */
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const empresaId = req.user!.empresaId;
    const userNivel = req.user!.rolNivel ?? 0;

    if (userNivel < 60) {
      // OPERADOR can't approve anything
      res.json({ planillasPendientes: [], vacacionesPendientes: [], historial: [] });
      return;
    }

    // ── Determine which user IDs this user can approve ────────────
    let approvableUserIds: string[] | null = null; // null = all company

    if (userNivel < 90) {
      // SUPERVISOR/COORDINADOR/GERENTE: can approve subordinates + own sector
      const subordinados = await prisma.usuario.findMany({
        where: {
          empresaId,
          activo: true,
          OR: [
            { supervisorId: userId },
            { coordinadorId: userId },
          ],
        },
        select: { id: true },
      });
      const subIds = subordinados.map((u: { id: string }) => u.id);

      // Also same sector
      const me = await prisma.usuario.findUnique({
        where: { id: userId },
        select: { sectorId: true },
      });
      if (me?.sectorId) {
        const sectorUsers = await prisma.usuario.findMany({
          where: { sectorId: me.sectorId, empresaId, activo: true },
          select: { id: true },
        });
        sectorUsers.forEach((u: { id: string }) => { if (!subIds.includes(u.id)) subIds.push(u.id); });
      }

      approvableUserIds = subIds;
    }

    const userFilter = approvableUserIds
      ? { usuarioId: { in: approvableUserIds } }
      : { usuario: { empresaId } };

    // ── Pending planillas ─────────────────────────────────────────
    const planillasPendientes = await prisma.planilla.findMany({
      where: {
        ...userFilter,
        estado: { in: ['ENVIADA', 'EN_REVISION'] },
      },
      include: {
        usuario: {
          select: {
            id: true, nombre: true, apellido: true, legajo: true, rol: true,
            sector: { select: { nombre: true } },
          },
        },
      },
      orderBy: { enviadaAt: 'asc' },
    });

    // ── Pending vacaciones ────────────────────────────────────────
    const vacacionesPendientes = await prisma.vacacion.findMany({
      where: {
        ...userFilter,
        estado: { in: ['PENDIENTE', 'EN_REVISION'] },
      },
      include: {
        usuario: {
          select: {
            id: true, nombre: true, apellido: true, legajo: true, rol: true,
            sector: { select: { nombre: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // ── Recent history (last 30 items) ────────────────────────────
    const planillasHistory = await prisma.planilla.findMany({
      where: {
        ...userFilter,
        estado: { in: ['APROBADA', 'RECHAZADA', 'CERRADA'] },
      },
      include: {
        usuario: { select: { id: true, nombre: true, apellido: true } },
      },
      orderBy: { aprobadaAt: 'desc' },
      take: 15,
    });

    const vacacionesHistory = await prisma.vacacion.findMany({
      where: {
        ...userFilter,
        estado: { in: ['APROBADA', 'RECHAZADA'] },
      },
      include: {
        usuario: { select: { id: true, nombre: true, apellido: true } },
      },
      orderBy: { aprobadaAt: 'desc' },
      take: 15,
    });

    res.json({
      planillasPendientes,
      vacacionesPendientes,
      historial: {
        planillas: planillasHistory,
        vacaciones: vacacionesHistory,
      },
    });
  } catch (error) {
    console.error('Error listing aprobaciones:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
