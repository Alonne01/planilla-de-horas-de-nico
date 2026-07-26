import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { getFlowVisibleUserIds } from '../utils/visibility.utils.js';
import { matchesCurrentStep, type AprobadorContexto } from '../utils/approval-auth.utils.js';
import { pasosDe } from '../utils/circuito.utils.js';

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
      res.json({ planillasPendientes: [], vacacionesPendientes: [], ausenciasPendientes: [], compensatoriosPendientes: [], cambiosDiagramaPendientes: [], faltantes: { actual: null, anterior: null }, historial: { planillas: [], vacaciones: [], ausencias: [] } });
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

    // Visibilidad propia de los cambios de diagrama. Se calcula aparte y NO se
    // suma a `approvableUserIds`: ese conjunto sale de PLANILLA ∪ VACACION y lo
    // comparten los otros cuatro tipos, así que ampliarlo les cambiaría lo que
    // devuelven. Con el conjunto compartido, además, un aprobador que sólo
    // figura en el flujo de CAMBIO_DIAGRAMA no vería ninguna solicitud.
    let cambioDiagramaUserIds: string[] | null = null;
    if (scope === 'mio') {
      cambioDiagramaUserIds = [userId];
    } else if (userNivel < 90) {
      cambioDiagramaUserIds = await getFlowVisibleUserIds(prisma, userId, empresaId, userRol, userNivel, 'CAMBIO_DIAGRAMA');
    }
    // El filtro es sobre `usuarioId` (el DUEÑO del cambio) y no sobre
    // `solicitanteId`: lo que se aprueba es el cambio del empleado.
    const cambioDiagramaFilter = cambioDiagramaUserIds
      ? { usuarioId: { in: cambioDiagramaUserIds } }
      : { usuario: { empresaId } };

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

    const approverSectorId = (await prisma.usuario.findUnique({ where: { id: userId }, select: { sectorId: true } }))?.sectorId ?? null;

    // El criterio de "a quién le toca" vive en `approval-auth.utils`: lo comparte
    // con `GET /cambios-diagrama/pendientes`, y duplicado divergen en el primer
    // cambio.
    const aprobador: AprobadorContexto = { userId, rol: userRol, nivel: userNivel, sectorId: approverSectorId };

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
            sectorId: true, supervisorId: true, coordinadorId: true,
            sector: { select: { nombre: true } },
          },
        },
        ...flujoInclude,
      },
      orderBy: { enviadaAt: 'asc' },
    });
    const planillasPendientes = planillasRaw.filter((p) => matchesCurrentStep(p, aprobador));

    const DEBUG = process.env.DEBUG_APPROVALS === '1' || process.env.DEBUG_APPROVALS === 'true';
    if (DEBUG) {
      console.log(`[APROBACIONES] user=${userId.slice(-6)} rol=${userRol} sector=${approverSectorId?.slice(-6)} | planillasRaw=${planillasRaw.length} → pendientes=${planillasPendientes.length}`);
      for (const p of planillasRaw) {
        const pasos = pasosDe(p);
        const paso = pasos.find(pp => pp.orden === p.pasoActual);
        console.log(`  planilla=${p.id.slice(-6)} owner=${(p as any).usuario?.id?.slice(-6)} pasoActual=${p.pasoActual}/${pasos.length} rolPaso=${paso?.rolAprobador ?? 'N/A'} circuito=${Array.isArray(p.circuitoSnapshot) ? 'congelado' : 'vivo'} match=${matchesCurrentStep(p, aprobador)}`);
      }
    }

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
            sectorId: true, supervisorId: true, coordinadorId: true,
            sector: { select: { nombre: true } },
          },
        },
        ...flujoInclude,
      },
      orderBy: { createdAt: 'asc' },
    });
    const vacacionesPendientes = vacacionesRaw.filter((v) => matchesCurrentStep(v, aprobador));

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
            sectorId: true, supervisorId: true, coordinadorId: true,
            sector: { select: { nombre: true } },
          },
        },
        cargadaPor: { select: { nombre: true, apellido: true } },
        ...flujoInclude,
      },
      orderBy: { createdAt: 'asc' },
    });
    const ausenciasPendientes = ausenciasRaw.filter((a) => matchesCurrentStep(a, aprobador));

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
                sectorId: true, supervisorId: true, coordinadorId: true,
                sector: { select: { nombre: true } },
              },
            },
            ...flujoInclude,
          },
        },
      },
      orderBy: { fecha: 'asc' },
    });
    const compensatoriosPendientes = compensatoriosRaw.filter(c => matchesCurrentStep(c.planilla, aprobador));

    // ── Pending cambios de diagrama ─────────────────────────────
    // No lleva filtro de período: una solicitud de cambio de diagrama no
    // pertenece a un período de liquidación, y `fechaEfectiva` es opcional, así
    // que filtrar por ella escondería justamente las que todavía no la tienen.
    const cambiosDiagramaRaw = await prisma.solicitudCambioDiagrama.findMany({
      where: {
        ...cambioDiagramaFilter,
        estado: { in: ['PENDIENTE', 'EN_REVISION'] },
      },
      include: {
        usuario: {
          select: {
            id: true, nombre: true, apellido: true, legajo: true, rol: true,
            sectorId: true, supervisorId: true, coordinadorId: true,
            sector: { select: { nombre: true } },
          },
        },
        solicitante: { select: { id: true, nombre: true, apellido: true } },
        diagramaActual: { select: { id: true, nombre: true, tipo: true, diasTrabajo: true, diasDescanso: true } },
        diagramaNuevo: { select: { id: true, nombre: true, tipo: true, diasTrabajo: true, diasDescanso: true } },
        ...flujoInclude,
      },
      orderBy: { createdAt: 'asc' },
    });
    const cambiosDiagramaPendientes = cambiosDiagramaRaw.filter((c) => matchesCurrentStep(c, aprobador));

    // ── Recent history ────────────────────────────────────────────
    // Include items in final states AND items where the user personally
    // approved their step (even if still in progress at a later step).
    // When scope='mio', only show the user's own items (skip personal approvals of others).
    const userHistInclude = { select: { id: true, nombre: true, apellido: true, legajo: true, rol: true, sector: { select: { nombre: true } } } };
    const isMioScope = scope === 'mio';

    // Find entity IDs where the current user has an approval entry (bounded to last 90 days)
    const histCutoff = new Date(); histCutoff.setDate(histCutoff.getDate() - 90);
    const histDateFilter = { createdAt: { gte: histCutoff } };

    let myPlanillaIds: string[] = [];
    let myVacacionIds: string[] = [];
    let myAusenciaIds: string[] = [];

    if (!isMioScope) {
      const [myPlanillaHist, myVacacionHist, myAusenciaHist] = await Promise.all([
        prisma.planillaHistorial.findMany({
          where: { usuarioId: userId, estadoNuevo: { in: ['EN_REVISION', 'APROBADA'] }, ...histDateFilter },
          select: { planillaId: true },
          distinct: ['planillaId'],
        }),
        prisma.vacacionHistorial.findMany({
          where: { usuarioId: userId, estadoNuevo: { in: ['EN_REVISION', 'APROBADA'] }, ...histDateFilter },
          select: { vacacionId: true },
          distinct: ['vacacionId'],
        }),
        prisma.ausenciaHistorial.findMany({
          where: { usuarioId: userId, estadoNuevo: { in: ['EN_REVISION', 'APROBADA'] }, ...histDateFilter },
          select: { ausenciaId: true },
          distinct: ['ausenciaId'],
        }),
      ]);
      myPlanillaIds = myPlanillaHist.map(h => h.planillaId);
      myVacacionIds = myVacacionHist.map(h => h.vacacionId);
      myAusenciaIds = myAusenciaHist.map(h => h.ausenciaId);
    }

    const planillasHistory = await prisma.planilla.findMany({
      where: {
        ...planillaPeriodFilter,
        OR: [
          { ...userFilter, estado: { in: ['APROBADA', 'RECHAZADA', 'CERRADA'] } },
          ...(myPlanillaIds.length ? [{ id: { in: myPlanillaIds }, estado: { notIn: ['BORRADOR'] as const } }] : []),
        ],
      },
      include: { usuario: userHistInclude, ...flujoInclude },
      orderBy: { updatedAt: 'desc' },
      take: 15,
    });

    const vacacionesHistory = await prisma.vacacion.findMany({
      where: {
        ...fechaPeriodFilter,
        OR: [
          { ...userFilter, estado: { in: ['APROBADA', 'RECHAZADA'] } },
          ...(myVacacionIds.length ? [{ id: { in: myVacacionIds }, estado: { notIn: ['BORRADOR'] as const } }] : []),
        ],
      },
      include: { usuario: userHistInclude, ...flujoInclude },
      orderBy: { updatedAt: 'desc' },
      take: 15,
    });

    const ausenciasHistory = await prisma.ausencia.findMany({
      where: {
        ...fechaPeriodFilter,
        OR: [
          { ...userFilter, estado: { in: ['APROBADA', 'RECHAZADA'] } },
          ...(myAusenciaIds.length ? [{ id: { in: myAusenciaIds }, estado: { notIn: ['BORRADOR'] as const } }] : []),
        ],
      },
      include: { usuario: userHistInclude, ...flujoInclude },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });

    // ── Faltantes: users who haven't submitted their planilla ────
    // Computes for BOTH the selected period and the previous one.
    const MESES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

    type FaltanteUser = { id: string; nombre: string; apellido: string; legajo: string | null; rol: string; diagramaColor: string | null; sector: { id: string; nombre: string } | null };
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
          diagramaColor: true,
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
      cambiosDiagramaPendientes,
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

/**
 * GET /aprobaciones/can-approve
 * Lightweight check: is the current user part of any approval flow?
 */
router.get('/can-approve', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userNivel = req.user!.rolNivel ?? 0;

    // RRHH / ADMIN always approve
    if (userNivel >= 90) {
      res.json({ canApprove: true });
      return;
    }
    // Below SUPERVISOR → never
    if (userNivel < 60) {
      res.json({ canApprove: false });
      return;
    }

    const match = await prisma.flujoPaso.findFirst({
      where: {
        flujo: {
          empresaId: req.user!.empresaId,
          activo: true,
          asignaciones: { some: { activo: true } },
        },
        rolAprobador: req.user!.rol,
      },
      select: { id: true },
    });

    res.json({ canApprove: !!match });
  } catch (error) {
    console.error('Error checking can-approve:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
