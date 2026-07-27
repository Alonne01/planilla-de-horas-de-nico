import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_COORDINADOR, LEVEL_RRHH, LEVEL_SUPERVISOR } from '../middleware/roles.middleware.js';
import { hoyLocalEmpresa } from '../utils/fecha-dia.utils.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── GET /analytics/usuario/:id ──────────────────

router.get('/usuario/:uid', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const uid = req.params.uid as string;
    const { userId, empresaId, rolNivel } = req.user!;
    const isSelf = uid === userId;

    // Only SUPERVISOR+ (or self) may access another user's analytics
    if (!isSelf && rolNivel < LEVEL_SUPERVISOR) {
      res.status(403).json({ error: 'Sin permiso' });
      return;
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id: uid },
      select: {
        id: true, nombre: true, apellido: true, legajo: true,
        empresaId: true, sectorId: true,
        sector: { select: { nombre: true } },
        diasVacacionesSaldo: true, diasVacacionesUsados: true,
      },
    });
    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    // Scope by empresa
    if (usuario.empresaId !== empresaId) {
      res.status(403).json({ error: 'Sin permiso' });
      return;
    }

    // SUPERVISOR/COORDINADOR (nivel 60–89): only own sector
    if (!isSelf && rolNivel < LEVEL_RRHH) {
      const requester = await prisma.usuario.findUnique({
        where: { id: userId },
        select: { sectorId: true },
      });
      if (!requester?.sectorId || requester.sectorId !== usuario.sectorId) {
        res.status(403).json({ error: 'Sin permiso' });
        return;
      }
    }

    // Planillas summary
    const planillas = await prisma.planilla.findMany({
      where: { usuarioId: uid },
      select: {
        id: true, periodoInicio: true, periodoFin: true, estado: true,
        totalHorasNormales: true, totalHorasExtra50: true, totalHorasExtra100: true,
        totalHorasViaje: true, totalDiasCampo: true, totalDiasBase: true,
      },
      orderBy: { periodoInicio: 'desc' },
      take: 12,
    });

    const totals = planillas.reduce((acc, p) => ({
      horasNormales: acc.horasNormales + Number(p.totalHorasNormales),
      horasExtra50: acc.horasExtra50 + Number(p.totalHorasExtra50),
      horasExtra100: acc.horasExtra100 + Number(p.totalHorasExtra100),
      horasViaje: acc.horasViaje + Number(p.totalHorasViaje),
      diasCampo: acc.diasCampo + p.totalDiasCampo,
      diasBase: acc.diasBase + p.totalDiasBase,
    }), { horasNormales: 0, horasExtra50: 0, horasExtra100: 0, horasViaje: 0, diasCampo: 0, diasBase: 0 });

    // Monthly trend
    const trend = planillas.map((p) => ({
      periodo: `${new Date(p.periodoInicio).toLocaleDateString('es-AR', { month: 'short', year: '2-digit' })}`,
      normales: Number(p.totalHorasNormales),
      extra50: Number(p.totalHorasExtra50),
      extra100: Number(p.totalHorasExtra100),
      viaje: Number(p.totalHorasViaje),
    })).reverse();

    // Ausencias count
    const ausencias = await prisma.ausencia.groupBy({
      by: ['tipo'],
      where: { usuarioId: uid },
      _sum: { diasAusencia: true },
      _count: true,
    });

    // Vacaciones
    const vacacionesPendientes = await prisma.vacacion.count({
      where: { usuarioId: uid, estado: { in: ['PENDIENTE', 'EN_REVISION'] } },
    });

    const { empresaId: _eid, sectorId: _sid, ...usuarioPublic } = usuario;
    res.json({
      usuario: usuarioPublic,
      totals,
      trend,
      planillasCount: planillas.length,
      ausencias: ausencias.map((a) => ({ tipo: a.tipo, dias: a._sum.diasAusencia, count: a._count })),
      vacaciones: {
        saldo: usuario.diasVacacionesSaldo - usuario.diasVacacionesUsados,
        usados: usuario.diasVacacionesUsados,
        pendientes: vacacionesPendientes,
      },
    });
  } catch (error) {
    console.error('Error analytics usuario:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /analytics/sectores (read-only list for filters) ───

router.get('/sectores', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sectores = await prisma.sector.findMany({
      where: { empresaId: req.user!.empresaId, activo: true },
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });
    res.json(sectores);
  } catch (error) {
    console.error('Error listing sectores:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /analytics/diagramas (catálogo de lectura, ≥COORDINADOR) ─
// Selects de asignación (UsuariosPage, etc.) que no deben requerir nivel ADMIN.
router.get('/diagramas', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const diagramas = await prisma.diagrama.findMany({
      where: { empresaId: req.user!.empresaId, activo: true },
      orderBy: { nombre: 'asc' },
    });
    res.json(diagramas);
  } catch (error) {
    console.error('Error listing diagramas:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /analytics/sector/:id ───────────────────

router.get('/sector/:sid', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sid = req.params.sid as string;
    const { userId, empresaId, rolNivel } = req.user!;

    const sector = await prisma.sector.findUnique({
      where: { id: sid },
      select: { id: true, nombre: true, empresaId: true },
    });
    if (!sector) {
      res.status(404).json({ error: 'Sector no encontrado' });
      return;
    }

    // Must be same empresa
    if (sector.empresaId !== empresaId) {
      res.status(403).json({ error: 'Sin permiso' });
      return;
    }

    // COORDINADOR/SUPERVISOR (nivel 60–89): only own sector
    if (rolNivel < LEVEL_RRHH) {
      const requester = await prisma.usuario.findUnique({
        where: { id: userId },
        select: { sectorId: true },
      });
      if (requester?.sectorId !== sid) {
        res.status(403).json({ error: 'Sin permiso' });
        return;
      }
    }

    const usuarios = await prisma.usuario.findMany({
      where: { sectorId: sid, activo: true },
      select: { id: true, nombre: true, apellido: true, legajo: true },
    });
    const userIds = usuarios.map((u) => u.id);

    // Aggregate planillas for sector users
    const planillaAgg = await prisma.planilla.aggregate({
      where: { usuarioId: { in: userIds } },
      _sum: {
        totalHorasNormales: true,
        totalHorasExtra50: true,
        totalHorasExtra100: true,
        totalHorasViaje: true,
        totalDiasCampo: true,
        totalDiasBase: true,
      },
      _count: true,
    });

    // Per-user breakdown
    const userBreakdown = await Promise.all(
      usuarios.map(async (u) => {
        const agg = await prisma.planilla.aggregate({
          where: { usuarioId: u.id },
          _sum: {
            totalHorasNormales: true,
            totalHorasExtra50: true,
            totalHorasExtra100: true,
          },
          _count: true,
        });
        return {
          ...u,
          horasNormales: Number(agg._sum.totalHorasNormales ?? 0),
          horasExtra50: Number(agg._sum.totalHorasExtra50 ?? 0),
          horasExtra100: Number(agg._sum.totalHorasExtra100 ?? 0),
          planillas: agg._count,
        };
      })
    );

    // Ausencias del sector
    const ausencias = await prisma.ausencia.groupBy({
      by: ['tipo'],
      where: { usuarioId: { in: userIds } },
      _sum: { diasAusencia: true },
      _count: true,
    });

    // Planillas by state
    const estadosCounts = await prisma.planilla.groupBy({
      by: ['estado'],
      where: { usuarioId: { in: userIds } },
      _count: true,
    });

    res.json({
      sector: { id: sector.id, nombre: sector.nombre },
      usuariosCount: usuarios.length,
      totals: {
        horasNormales: Number(planillaAgg._sum.totalHorasNormales ?? 0),
        horasExtra50: Number(planillaAgg._sum.totalHorasExtra50 ?? 0),
        horasExtra100: Number(planillaAgg._sum.totalHorasExtra100 ?? 0),
        horasViaje: Number(planillaAgg._sum.totalHorasViaje ?? 0),
        diasCampo: Number(planillaAgg._sum.totalDiasCampo ?? 0),
        diasBase: Number(planillaAgg._sum.totalDiasBase ?? 0),
        planillas: planillaAgg._count,
      },
      userBreakdown,
      ausencias: ausencias.map((a) => ({ tipo: a.tipo, dias: a._sum.diasAusencia, count: a._count })),
      estadosPlanilla: estadosCounts.map((e) => ({ estado: e.estado, count: e._count })),
    });
  } catch (error) {
    console.error('Error analytics sector:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /analytics/empresa ──────────────────────

router.get('/empresa', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const empresaId = req.user!.empresaId;

    const qPeriodoInicio = req.query.periodoInicio as string | undefined;
    const qPeriodoFin = req.query.periodoFin as string | undefined;
    const qSectorId = req.query.sectorId as string | undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const planillaPeriodFilter: any = {};
    if (qPeriodoInicio) planillaPeriodFilter.periodoInicio = { gte: new Date(qPeriodoInicio) };
    if (qPeriodoFin) {
      const fin = new Date(qPeriodoFin);
      fin.setHours(23, 59, 59, 999);
      planillaPeriodFilter.periodoFin = { lte: fin };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fechaPeriodFilter: any = {};
    if (qPeriodoInicio && qPeriodoFin) {
      const fin = new Date(qPeriodoFin);
      fin.setHours(23, 59, 59, 999);
      fechaPeriodFilter.fechaInicio = {
        gte: new Date(qPeriodoInicio),
        lte: fin,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userWhere: any = { empresaId, activo: true };
    if (qSectorId) userWhere.sectorId = qSectorId;

    // Users in the company (or sector)
    const totalUsuarios = await prisma.usuario.count({ where: userWhere });

    // Get all user IDs for this empresa (or sector)
    const userIds = (await prisma.usuario.findMany({
      where: userWhere,
      select: { id: true },
    })).map((u) => u.id);

    // Global aggregates
    const planillaAgg = await prisma.planilla.aggregate({
      where: { usuarioId: { in: userIds }, ...planillaPeriodFilter },
      _sum: {
        totalHorasNormales: true,
        totalHorasExtra50: true,
        totalHorasExtra100: true,
        totalHorasViaje: true,
        totalDiasCampo: true,
        totalDiasBase: true,
      },
      _count: true,
    });

    // Planillas by state
    const estadosCounts = await prisma.planilla.groupBy({
      by: ['estado'],
      where: { usuarioId: { in: userIds }, ...planillaPeriodFilter },
      _count: true,
    });

    // Per-sector breakdown
    const sectores = await prisma.sector.findMany({
      where: { empresaId },
      select: { id: true, nombre: true },
    });

    const sectorBreakdown = await Promise.all(
      sectores.map(async (s) => {
        const sectorUserIds = (await prisma.usuario.findMany({
          where: { sectorId: s.id, activo: true },
          select: { id: true },
        })).map((u) => u.id);

        const agg = await prisma.planilla.aggregate({
          where: { usuarioId: { in: sectorUserIds }, ...planillaPeriodFilter },
          _sum: {
            totalHorasNormales: true,
            totalHorasExtra50: true,
            totalHorasExtra100: true,
          },
          _count: true,
        });

        const usersCount = sectorUserIds.length;

        return {
          ...s,
          usuarios: usersCount,
          horasNormales: Number(agg._sum.totalHorasNormales ?? 0),
          horasExtra50: Number(agg._sum.totalHorasExtra50 ?? 0),
          horasExtra100: Number(agg._sum.totalHorasExtra100 ?? 0),
          planillas: agg._count,
        };
      })
    );

    // Ausencias global
    const ausencias = await prisma.ausencia.groupBy({
      by: ['tipo'],
      where: { usuarioId: { in: userIds }, ...fechaPeriodFilter },
      _sum: { diasAusencia: true },
      _count: true,
    });

    // Vacaciones global
    const vacacionesPendientes = await prisma.vacacion.count({
      where: { usuarioId: { in: userIds }, ...fechaPeriodFilter, estado: { in: ['PENDIENTE', 'EN_REVISION'] } },
    });

    // ─── Top employees by overtime ───
    const userPlanillas = await prisma.planilla.groupBy({
      by: ['usuarioId'],
      where: { usuarioId: { in: userIds }, ...planillaPeriodFilter },
      _sum: { totalHorasExtra50: true, totalHorasExtra100: true, totalHorasNormales: true },
    });

    const topExtrasRaw = userPlanillas
      .map((up) => ({
        usuarioId: up.usuarioId,
        extra50: Number(up._sum.totalHorasExtra50 ?? 0),
        extra100: Number(up._sum.totalHorasExtra100 ?? 0),
        normales: Number(up._sum.totalHorasNormales ?? 0),
        totalExtra: Number(up._sum.totalHorasExtra50 ?? 0) + Number(up._sum.totalHorasExtra100 ?? 0),
      }))
      .sort((a, b) => b.totalExtra - a.totalExtra)
      .slice(0, 10);

    const topUserIds = topExtrasRaw.map((t) => t.usuarioId);
    const topUsers = await prisma.usuario.findMany({
      where: { id: { in: topUserIds } },
      select: { id: true, nombre: true, apellido: true, legajo: true, sector: { select: { nombre: true } } },
    });
    const userMap = new Map(topUsers.map((u) => [u.id, u]));

    const topExtras = topExtrasRaw.map((t) => ({
      usuario: userMap.get(t.usuarioId),
      extra50: t.extra50,
      extra100: t.extra100,
      normales: t.normales,
      totalExtra: t.totalExtra,
    }));

    // ─── Registro-level aggregates ───
    const registros = await prisma.registroHoras.findMany({
      where: {
        planilla: {
          usuarioId: { in: userIds },
          ...planillaPeriodFilter,
        },
      },
      select: {
        lugarTrabajo: true,
        pernocte: true,
        esFeriado: true,
        esFrancoTrabajado: true,
        esFrancoCompensatorio: true,
        maneja: true,
        horasViajeCalc: true,
        horasNormales: true,
        horasExtra50: true,
        horasExtra100: true,
        planilla: { select: { usuario: { select: { sectorId: true } } } },
      },
    });

    const campoVsBase = {
      campo: registros.filter((r) => r.lugarTrabajo === 'CAMPO').length,
      base: registros.filter((r) => r.lugarTrabajo === 'BASE').length,
      franco: registros.filter((r) => r.lugarTrabajo === 'FRANCO').length,
    };

    const pernoctes = {
      hotel: registros.filter((r) => r.pernocte === 'HOTEL').length,
      trailer: registros.filter((r) => r.pernocte === 'TRAILER').length,
      sinPernocte: registros.filter((r) => r.pernocte === 'NO' || !r.pernocte).length,
    };

    const feriadosFrancos = {
      feriadosTrabajados: registros.filter((r) => r.esFeriado).length,
      francosTrabajados: registros.filter((r) => r.esFrancoTrabajado).length,
      francosCompensatorios: registros.filter((r) => r.esFrancoCompensatorio).length,
    };

    const horasViaje = {
      maneja: registros.filter((r) => r.maneja).reduce((sum, r) => sum + Number(r.horasViajeCalc ?? 0), 0),
      noManeja: registros.filter((r) => !r.maneja).reduce((sum, r) => sum + Number(r.horasViajeCalc ?? 0), 0),
    };

    // ─── Ausencias grouped by sector ───
    const ausenciasBySectorData = await prisma.ausencia.findMany({
      where: { usuarioId: { in: userIds }, ...fechaPeriodFilter },
      select: {
        diasAusencia: true,
        tipo: true,
        usuario: { select: { sector: { select: { nombre: true } } } },
      },
    });

    const ausenciasBySectorMap: Record<string, number> = {};
    for (const a of ausenciasBySectorData) {
      const sName = a.usuario.sector?.nombre ?? 'Sin sector';
      ausenciasBySectorMap[sName] = (ausenciasBySectorMap[sName] ?? 0) + a.diasAusencia;
    }
    const ausenciasBySector = Object.entries(ausenciasBySectorMap)
      .map(([sector, dias]) => ({ sector, dias }))
      .sort((a, b) => b.dias - a.dias);

    // ─── Compensatorios balance ───
    // Año de negocio (Argentina), no el del huso del proceso: esta fila la
    // indexan también las rutas que reservan/consumen compensatorios por
    // fecha-día, ya normalizadas a getUTCFullYear().
    const anio = hoyLocalEmpresa().getUTCFullYear();
    const compensatoriosSaldos = await prisma.vacacionSaldo.findMany({
      where: { usuarioId: { in: userIds }, anio },
      select: { compensatoriosAcumulados: true, compensatoriosUsados: true, compensatoriosPendientes: true },
    });

    const compensatorios = compensatoriosSaldos.reduce(
      (acc, s) => ({
        acumulados: acc.acumulados + s.compensatoriosAcumulados,
        usados: acc.usados + s.compensatoriosUsados,
        pendientes: acc.pendientes + s.compensatoriosPendientes,
      }),
      { acumulados: 0, usados: 0, pendientes: 0 },
    );

    // ─── Trend data: last 6 cycles ───
    const trendPlanillas = await prisma.planilla.findMany({
      where: { usuarioId: { in: userIds } },
      select: {
        periodoInicio: true,
        totalHorasNormales: true,
        totalHorasExtra50: true,
        totalHorasExtra100: true,
        totalHorasViaje: true,
      },
      orderBy: { periodoInicio: 'asc' },
    });

    const trendMap: Record<string, { normales: number; extra50: number; extra100: number; viaje: number }> = {};
    for (const p of trendPlanillas) {
      const label = new Date(p.periodoInicio).toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
      if (!trendMap[label]) trendMap[label] = { normales: 0, extra50: 0, extra100: 0, viaje: 0 };
      trendMap[label].normales += Number(p.totalHorasNormales ?? 0);
      trendMap[label].extra50 += Number(p.totalHorasExtra50 ?? 0);
      trendMap[label].extra100 += Number(p.totalHorasExtra100 ?? 0);
      trendMap[label].viaje += Number(p.totalHorasViaje ?? 0);
    }
    const trend = Object.entries(trendMap)
      .map(([periodo, vals]) => ({ periodo, ...vals }))
      .slice(-8);

    res.json({
      totalUsuarios,
      totals: {
        horasNormales: Number(planillaAgg._sum.totalHorasNormales ?? 0),
        horasExtra50: Number(planillaAgg._sum.totalHorasExtra50 ?? 0),
        horasExtra100: Number(planillaAgg._sum.totalHorasExtra100 ?? 0),
        horasViaje: Number(planillaAgg._sum.totalHorasViaje ?? 0),
        diasCampo: Number(planillaAgg._sum.totalDiasCampo ?? 0),
        diasBase: Number(planillaAgg._sum.totalDiasBase ?? 0),
        planillas: planillaAgg._count,
      },
      estadosPlanilla: estadosCounts.map((e) => ({ estado: e.estado, count: e._count })),
      sectorBreakdown,
      ausencias: ausencias.map((a) => ({ tipo: a.tipo, dias: a._sum.diasAusencia, count: a._count })),
      vacacionesPendientes,
      topExtras,
      campoVsBase,
      pernoctes,
      feriadosFrancos,
      horasViaje,
      ausenciasBySector,
      compensatorios,
      trend,
    });
  } catch (error) {
    console.error('Error analytics empresa:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
