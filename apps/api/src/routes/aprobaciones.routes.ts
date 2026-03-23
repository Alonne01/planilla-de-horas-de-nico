import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { getFlowVisibleUserIds } from '../utils/visibility.utils.js';

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
    const scope = req.query.scope as string | undefined;

    if (userNivel < 60 && scope !== 'mio') {
      // OPERADOR can't approve anything
      res.json({ planillasPendientes: [], vacacionesPendientes: [], ausenciasPendientes: [], compensatoriosPendientes: [], historial: { planillas: [], vacaciones: [], ausencias: [] } });
      return;
    }

    // ── Determine which user IDs this user can approve ────────────
    let approvableUserIds: string[] | null = null; // null = all company

    if (scope === 'mio') {
      approvableUserIds = [userId];
    } else if (userNivel < 90) {
      // Flow-based: union of visible users across all doc types this endpoint handles
      const [planillaIds, vacacionIds] = await Promise.all([
        getFlowVisibleUserIds(prisma, userId, empresaId, req.user!.rol, userNivel, 'PLANILLA'),
        getFlowVisibleUserIds(prisma, userId, empresaId, req.user!.rol, userNivel, 'VACACION'),
      ]);
      const combined = new Set([...planillaIds, ...vacacionIds]);
      approvableUserIds = [...combined];
    }

    const userFilter = approvableUserIds
      ? { usuarioId: { in: approvableUserIds } }
      : { usuario: { empresaId } };

    const userRol = req.user!.rol;

    // ── Period filter (optional) ──────────────────────────────────
    const qPeriodoInicio = req.query.periodoInicio as string | undefined;
    const qPeriodoFin = req.query.periodoFin as string | undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const planillaPeriodFilter: any = {};
    if (qPeriodoInicio) planillaPeriodFilter.periodoInicio = { gte: new Date(qPeriodoInicio) };
    if (qPeriodoFin) {
      const fin = new Date(qPeriodoFin); fin.setHours(23, 59, 59, 999);
      planillaPeriodFilter.periodoFin = { lte: fin };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fechaPeriodFilter: any = {};
    if (qPeriodoInicio && qPeriodoFin) {
      const fin = new Date(qPeriodoFin); fin.setHours(23, 59, 59, 999);
      fechaPeriodFilter.fechaInicio = {
        gte: new Date(qPeriodoInicio),
        lte: fin,
      };
    }

    // Helper: returns true if the item's current approval step matches the user's role
    const matchesCurrentStep = (item: { flujoId?: string | null; pasoActual: number; flujo?: { pasos: { orden: number; rolAprobador: string }[] } | null }) => {
      if (!item.flujo || !item.flujoId) return true; // no flujo → legacy behavior
      const paso = item.flujo.pasos.find(p => p.orden === item.pasoActual);
      if (!paso) return true; // safety fallback
      return paso.rolAprobador === userRol;
    };

    const flujoInclude = { flujo: { include: { pasos: { orderBy: { orden: 'asc' as const } } } } };

    // ── Pending planillas ─────────────────────────────────────────
    const planillasRaw = await prisma.planilla.findMany({
      where: {
        ...userFilter,
        ...planillaPeriodFilter,
        estado: { in: ['ENVIADA', 'EN_REVISION'] },
      },
      include: {
        usuario: {
          select: {
            id: true, nombre: true, apellido: true, legajo: true, rol: true,
            sector: { select: { nombre: true } },
          },
        },
        ...flujoInclude,
      },
      orderBy: { enviadaAt: 'asc' },
    });
    const planillasPendientes = planillasRaw.filter(matchesCurrentStep);

    // ── Pending vacaciones ────────────────────────────────────────
    const vacacionesRaw = await prisma.vacacion.findMany({
      where: {
        ...userFilter,
        ...fechaPeriodFilter,
        estado: { in: ['PENDIENTE', 'EN_REVISION'] },
      },
      include: {
        usuario: {
          select: {
            id: true, nombre: true, apellido: true, legajo: true, rol: true,
            sector: { select: { nombre: true } },
          },
        },
        ...flujoInclude,
      },
      orderBy: { createdAt: 'asc' },
    });
    const vacacionesPendientes = vacacionesRaw.filter(matchesCurrentStep);

    // ── Pending ausencias ──────────────────────────────────────
    const ausenciasRaw = await prisma.ausencia.findMany({
      where: {
        ...userFilter,
        ...fechaPeriodFilter,
        estado: { in: ['PENDIENTE', 'EN_REVISION'] },
      },
      include: {
        usuario: {
          select: {
            id: true, nombre: true, apellido: true, legajo: true, rol: true,
            sector: { select: { nombre: true } },
          },
        },
        cargadaPor: { select: { nombre: true, apellido: true } },
        ...flujoInclude,
      },
      orderBy: { createdAt: 'asc' },
    });
    const ausenciasPendientes = ausenciasRaw.filter(matchesCurrentStep);

    // ── Pending compensatorios ──────────────────────────────────
    const planillaFilter = approvableUserIds
      ? { usuarioId: { in: approvableUserIds } }
      : { usuario: { empresaId } };

    const compensatoriosRaw = await prisma.registroHoras.findMany({
      where: {
        esFrancoCompensatorio: true,
        planilla: {
          ...planillaFilter,
          ...planillaPeriodFilter,
          estado: { in: ['ENVIADA', 'EN_REVISION'] },
        },
      },
      include: {
        planilla: {
          include: {
            usuario: {
              select: {
                id: true, nombre: true, apellido: true, legajo: true, rol: true,
                sector: { select: { nombre: true } },
              },
            },
            ...flujoInclude,
          },
        },
      },
      orderBy: { fecha: 'asc' },
    });
    const compensatoriosPendientes = compensatoriosRaw.filter(c => matchesCurrentStep(c.planilla));

    // ── Recent history (last 30 items) ────────────────────────────
    const planillasHistory = await prisma.planilla.findMany({
      where: {
        ...userFilter,
        ...planillaPeriodFilter,
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
        ...fechaPeriodFilter,
        estado: { in: ['APROBADA', 'RECHAZADA'] },
      },
      include: {
        usuario: { select: { id: true, nombre: true, apellido: true } },
      },
      orderBy: { aprobadaAt: 'desc' },
      take: 15,
    });

    const ausenciasHistory = await prisma.ausencia.findMany({
      where: {
        ...userFilter,
        ...fechaPeriodFilter,
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
      ausenciasPendientes,
      compensatoriosPendientes,
      historial: {
        planillas: planillasHistory,
        vacaciones: vacacionesHistory,
        ausencias: ausenciasHistory,
      },
    });
  } catch (error) {
    console.error('Error listing aprobaciones:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
