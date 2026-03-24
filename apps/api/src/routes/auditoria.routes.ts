import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);
router.use(requireLevel(LEVEL_RRHH));

// ─── GET / — Unified audit log from all historial tables ─────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const empresaId = req.user!.empresaId;
    const { tipo, usuarioId, desde, hasta, limit: lim } = req.query;
    const maxRows = Math.min(Number(lim) || 100, 500);

    const dateFilter = (field: string) => {
      const cond: any = {};
      if (desde) cond[field] = { ...cond[field], gte: new Date(desde as string) };
      if (hasta) cond[field] = { ...cond[field], lte: new Date(hasta as string) };
      return Object.keys(cond).length ? cond : undefined;
    };

    const results: any[] = [];

    // Planilla historial
    if (!tipo || tipo === 'planilla') {
      const planillaLogs = await prisma.planillaHistorial.findMany({
        where: {
          planilla: { usuario: { empresaId } },
          ...(usuarioId ? { usuarioId: usuarioId as string } : {}),
          ...dateFilter('createdAt'),
        },
        include: {
          usuario: { select: { id: true, nombre: true, apellido: true } },
          planilla: { select: { id: true, periodoInicio: true, periodoFin: true, usuario: { select: { nombre: true, apellido: true, legajo: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: maxRows,
      });
      results.push(...planillaLogs.map((l) => ({
        id: l.id,
        tipo: 'PLANILLA',
        entidadId: l.planillaId,
        entidadLabel: `Planilla ${l.planilla.usuario.apellido} ${l.planilla.usuario.nombre} (${new Date(l.planilla.periodoInicio).toLocaleDateString('es-AR')})`,
        estadoAnterior: l.estadoAnterior,
        estadoNuevo: l.estadoNuevo,
        paso: l.pasoFlujo,
        comentario: l.comentario,
        usuario: l.usuario,
        createdAt: l.createdAt,
      })));
    }

    // Vacacion historial
    if (!tipo || tipo === 'vacacion') {
      const vacacionLogs = await prisma.vacacionHistorial.findMany({
        where: {
          vacacion: { usuario: { empresaId } },
          ...(usuarioId ? { usuarioId: usuarioId as string } : {}),
          ...dateFilter('createdAt'),
        },
        include: {
          usuario: { select: { id: true, nombre: true, apellido: true } },
          vacacion: { select: { id: true, fechaInicio: true, fechaFin: true, usuario: { select: { nombre: true, apellido: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: maxRows,
      });
      results.push(...vacacionLogs.map((l) => ({
        id: l.id,
        tipo: 'VACACION',
        entidadId: l.vacacionId,
        entidadLabel: `Vacación ${l.vacacion.usuario.apellido} (${new Date(l.vacacion.fechaInicio).toLocaleDateString('es-AR')})`,
        estadoAnterior: l.estadoAnterior,
        estadoNuevo: l.estadoNuevo,
        paso: l.pasoFlujo,
        comentario: l.comentario,
        usuario: l.usuario,
        createdAt: l.createdAt,
      })));
    }

    // Ausencia historial
    if (!tipo || tipo === 'ausencia') {
      const ausenciaLogs = await prisma.ausenciaHistorial.findMany({
        where: {
          ausencia: { usuario: { empresaId } },
          ...(usuarioId ? { usuarioId: usuarioId as string } : {}),
          ...dateFilter('createdAt'),
        },
        include: {
          usuario: { select: { id: true, nombre: true, apellido: true } },
          ausencia: { select: { id: true, tipo: true, fechaInicio: true, usuario: { select: { nombre: true, apellido: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: maxRows,
      });
      results.push(...ausenciaLogs.map((l) => ({
        id: l.id,
        tipo: 'AUSENCIA',
        entidadId: l.ausenciaId,
        entidadLabel: `Ausencia ${l.ausencia.usuario.apellido} — ${l.ausencia.tipo} (${new Date(l.ausencia.fechaInicio).toLocaleDateString('es-AR')})`,
        estadoAnterior: l.estadoAnterior,
        estadoNuevo: l.estadoNuevo,
        paso: l.pasoFlujo,
        comentario: l.comentario,
        usuario: l.usuario,
        createdAt: l.createdAt,
      })));
    }

    // Recibo firmas
    if (!tipo || tipo === 'recibo') {
      const reciboFirmas = await prisma.reciboSueldo.findMany({
        where: {
          usuario: { empresaId },
          firmadoEmpleadoAt: { not: null },
          ...(usuarioId ? { usuarioId: usuarioId as string } : {}),
          ...(desde || hasta ? {
            firmadoEmpleadoAt: {
              ...(desde ? { gte: new Date(desde as string) } : {}),
              ...(hasta ? { lte: new Date(hasta as string) } : {}),
            },
          } : {}),
        },
        include: {
          usuario: { select: { id: true, nombre: true, apellido: true } },
          planilla: { select: { periodoInicio: true } },
        },
        orderBy: { firmadoEmpleadoAt: 'desc' },
        take: maxRows,
      });
      results.push(...reciboFirmas.map((r) => ({
        id: r.id,
        tipo: 'RECIBO_FIRMA',
        entidadId: r.id,
        entidadLabel: `Recibo firmado — ${r.usuario.apellido} (${new Date(r.planilla.periodoInicio).toLocaleDateString('es-AR')})`,
        estadoAnterior: 'PENDIENTE',
        estadoNuevo: 'FIRMADO',
        paso: null,
        comentario: `IP: ${r.ipFirma || 'N/A'}`,
        usuario: r.usuario,
        createdAt: r.firmadoEmpleadoAt!,
      })));
    }

    // AuditoriaLog (admin changes: salary, conceptos, etc.)
    if (!tipo || tipo === 'admin') {
      const adminLogs = await prisma.auditoriaLog.findMany({
        where: {
          usuario: { empresaId },
          ...(usuarioId ? { usuarioId: usuarioId as string } : {}),
          ...dateFilter('createdAt'),
        },
        include: {
          usuario: { select: { id: true, nombre: true, apellido: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: maxRows,
      });
      results.push(...adminLogs.map((l) => ({
        id: l.id,
        tipo: 'ADMIN',
        entidadId: l.entidadId,
        entidadLabel: l.descripcion ?? `${l.entidad} ${l.entidadId}`,
        estadoAnterior: l.valorAnterior,
        estadoNuevo: l.accion + (l.valorNuevo ? `: ${l.valorNuevo}` : ''),
        paso: null,
        comentario: l.campo ? `Campo: ${l.campo}` : null,
        usuario: l.usuario,
        createdAt: l.createdAt,
      })));
    }

    // Sort all results by date desc
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json(results.slice(0, maxRows));
  } catch (err) {
    console.error('Error fetching audit log:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /stats — Audit summary stats ───────────

router.get('/stats', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const empresaId = req.user!.empresaId;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [planillas, vacaciones, ausencias, recibos, adminChanges] = await Promise.all([
      prisma.planillaHistorial.count({
        where: { planilla: { usuario: { empresaId } }, createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.vacacionHistorial.count({
        where: { vacacion: { usuario: { empresaId } }, createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.ausenciaHistorial.count({
        where: { ausencia: { usuario: { empresaId } }, createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.reciboSueldo.count({
        where: { usuario: { empresaId }, firmadoEmpleadoAt: { gte: thirtyDaysAgo } },
      }),
      prisma.auditoriaLog.count({
        where: { usuario: { empresaId }, createdAt: { gte: thirtyDaysAgo } },
      }),
    ]);

    res.json({
      ultimos30Dias: { planillas, vacaciones, ausencias, recibos, admin: adminChanges, total: planillas + vacaciones + ausencias + recibos + adminChanges },
    });
  } catch (err) {
    console.error('Error fetching audit stats:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
