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
      res.json({ planillasPendientes: [], vacacionesPendientes: [], ausenciasPendientes: [], compensatoriosPendientes: [], faltantes: { actual: null, anterior: null }, historial: { planillas: [], vacaciones: [], ausencias: [] } });
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
        usuario: { select: { id: true, nombre: true, apellido: true, legajo: true, rol: true, sector: { select: { nombre: true } } } },
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
        usuario: { select: { id: true, nombre: true, apellido: true, legajo: true, rol: true, sector: { select: { nombre: true } } } },
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
        usuario: { select: { id: true, nombre: true, apellido: true, legajo: true, rol: true, sector: { select: { nombre: true } } } },
      },
      orderBy: { aprobadaAt: 'desc' },
      take: 15,
    });

    // ── Faltantes: users who haven't submitted their planilla ────
    // Computes for BOTH the selected period and the previous one.
    const MESES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

    type FaltanteUser = { id: string; nombre: string; apellido: string; legajo: string | null; rol: string; sector: { id: string; nombre: string } | null };
    type FaltanteEntry = { usuario: FaltanteUser; planillaId: string | null; estado: string };
    type FaltantesPeriodo = { label: string; periodoInicio: string; periodoFin: string; items: FaltanteEntry[] } | null;

    const computeFaltantes = async (
      pInicio: Date, pFin: Date, users: FaltanteUser[],
    ): Promise<FaltanteEntry[]> => {
      const ids = users.map(u => u.id);
      if (ids.length === 0) return [];
      const finEnd = new Date(pFin); finEnd.setHours(23, 59, 59, 999);
      const planillas = await prisma.planilla.findMany({
        where: {
          usuarioId: { in: ids },
          periodoInicio: { gte: pInicio },
          periodoFin: { lte: finEnd },
        },
        select: { id: true, usuarioId: true, estado: true },
      });

      const bestMap = new Map<string, { id: string; estado: string }>();
      const prio: Record<string, number> = { CERRADA: 5, APROBADA: 4, EN_REVISION: 3, ENVIADA: 2, RECHAZADA: 1, BORRADOR: 0 };
      for (const p of planillas) {
        const ex = bestMap.get(p.usuarioId);
        if (!ex || (prio[p.estado] ?? 0) > (prio[ex.estado] ?? 0)) {
          bestMap.set(p.usuarioId, { id: p.id, estado: p.estado });
        }
      }

      const SUBMITTED = new Set(['ENVIADA', 'EN_REVISION', 'APROBADA', 'CERRADA']);
      const result: FaltanteEntry[] = [];
      for (const u of users) {
        const best = bestMap.get(u.id);
        if (best && SUBMITTED.has(best.estado)) continue;
        result.push({ usuario: u, planillaId: best?.id ?? null, estado: best?.estado ?? 'SIN_PLANILLA' });
      }
      const order: Record<string, number> = { SIN_PLANILLA: 0, RECHAZADA: 1, BORRADOR: 2 };
      result.sort((a, b) => (order[a.estado] ?? 9) - (order[b.estado] ?? 9));
      return result;
    };

    const buildLabel = (inicio: Date, fin: Date): string => {
      return `${inicio.getDate()} ${MESES_ES[inicio.getMonth()]} — ${fin.getDate()} ${MESES_ES[fin.getMonth()]} ${fin.getFullYear()}`;
    };

    let faltantesActual: FaltantesPeriodo = null;
    let faltantesAnterior: FaltantesPeriodo = null;

    if (qPeriodoInicio && qPeriodoFin) {
      const visibleUsersWhere = approvableUserIds
        ? { id: { in: approvableUserIds }, activo: true }
        : { empresaId, activo: true };
      const visibleUsers = await prisma.usuario.findMany({
        where: visibleUsersWhere,
        select: {
          id: true, nombre: true, apellido: true, legajo: true, rol: true,
          sector: { select: { id: true, nombre: true } },
        },
      });

      // Current period
      const curInicio = new Date(qPeriodoInicio);
      const curFin = new Date(qPeriodoFin);
      const actualItems = await computeFaltantes(curInicio, curFin, visibleUsers);
      faltantesActual = {
        label: buildLabel(curInicio, curFin),
        periodoInicio: qPeriodoInicio,
        periodoFin: qPeriodoFin,
        items: actualItems,
      };

      // Previous period (one month back in the 21-20 cycle)
      const prevInicio = new Date(curInicio.getFullYear(), curInicio.getMonth() - 1, curInicio.getDate());
      const prevFin = new Date(curFin.getFullYear(), curFin.getMonth() - 1, curFin.getDate());
      const anteriorItems = await computeFaltantes(prevInicio, prevFin, visibleUsers);
      faltantesAnterior = {
        label: buildLabel(prevInicio, prevFin),
        periodoInicio: prevInicio.toISOString(),
        periodoFin: prevFin.toISOString(),
        items: anteriorItems,
      };
    }

    res.json({
      planillasPendientes,
      vacacionesPendientes,
      ausenciasPendientes,
      compensatoriosPendientes,
      faltantes: { actual: faltantesActual, anterior: faltantesAnterior },
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
