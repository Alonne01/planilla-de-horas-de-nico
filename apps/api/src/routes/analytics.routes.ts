import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_COORDINADOR, LEVEL_RRHH } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── GET /analytics/usuario/:id ──────────────────

router.get('/usuario/:uid', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const uid = req.params.uid as string;
    const userRole = req.user!.rol;
    // Operadores only see own data
    if (userRole === 'OPERADOR' && uid !== req.user!.userId) {
      res.status(403).json({ error: 'Sin permiso' });
      return;
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id: uid },
      select: {
        id: true, nombre: true, apellido: true, legajo: true,
        sector: { select: { nombre: true } },
        categoria: { select: { codigo: true, nombre: true } },
        diasVacacionesSaldo: true, diasVacacionesUsados: true,
      },
    });
    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
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

    res.json({
      usuario,
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

// ─── GET /analytics/sector/:id ───────────────────

router.get('/sector/:sid', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sid = req.params.sid as string;

    const sector = await prisma.sector.findUnique({
      where: { id: sid },
      select: { id: true, nombre: true },
    });
    if (!sector) {
      res.status(404).json({ error: 'Sector no encontrado' });
      return;
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
      sector,
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

    // Users in the company
    const totalUsuarios = await prisma.usuario.count({ where: { empresaId, activo: true } });

    // Get all user IDs for this empresa
    const userIds = (await prisma.usuario.findMany({
      where: { empresaId, activo: true },
      select: { id: true },
    })).map((u) => u.id);

    // Global aggregates
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

    // Planillas by state
    const estadosCounts = await prisma.planilla.groupBy({
      by: ['estado'],
      where: { usuarioId: { in: userIds } },
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
          where: { usuarioId: { in: sectorUserIds } },
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
      where: { usuarioId: { in: userIds } },
      _sum: { diasAusencia: true },
      _count: true,
    });

    // Vacaciones global
    const vacacionesPendientes = await prisma.vacacion.count({
      where: { usuarioId: { in: userIds }, estado: { in: ['PENDIENTE', 'EN_REVISION'] } },
    });

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
    });
  } catch (error) {
    console.error('Error analytics empresa:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
