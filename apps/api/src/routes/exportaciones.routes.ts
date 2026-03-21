import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);
router.use(requireLevel(LEVEL_RRHH));

// ─── GET /exportaciones ──────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const exportaciones = await prisma.exportacion.findMany({
      where: { empresaId: req.user!.empresaId },
      include: {
        generadaPor: { select: { nombre: true, apellido: true } },
      },
      orderBy: { creadoAt: 'desc' },
      take: 50,
    });
    res.json(exportaciones);
  } catch (error) {
    console.error('Error listing exportaciones:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /exportaciones ─────────────────────────
// Log an export operation

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { periodoInicio, periodoFin, sectoresIds, usuariosIds, nombreArchivo, totalPersonas, totalRegistros } = req.body;

    const exportacion = await prisma.exportacion.create({
      data: {
        empresaId: req.user!.empresaId,
        generadaPorId: req.user!.userId,
        periodoInicio: new Date(periodoInicio),
        periodoFin: new Date(periodoFin),
        sectoresIds: sectoresIds ?? [],
        usuariosIds: usuariosIds ?? [],
        rolesFiltro: [],
        hojasIncluidas: [],
        estadoPlanillas: [],
        nombreArchivo,
        totalPersonas: totalPersonas ?? null,
        totalRegistros: totalRegistros ?? null,
      },
    });
    res.status(201).json(exportacion);
  } catch (error) {
    console.error('Error creating exportacion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /cierre ────────────────────────────────
// Close all approved planillas for a period (RRHH/ADMIN)

router.post('/cierre', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { periodoInicio, periodoFin, sectorId } = req.body;

    if (!periodoInicio || !periodoFin) {
      res.status(400).json({ error: 'Se requiere periodoInicio y periodoFin' });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      estado: 'APROBADA',
      periodoInicio: new Date(periodoInicio),
      periodoFin: new Date(periodoFin),
      usuario: { empresaId: req.user!.empresaId },
    };
    if (sectorId) where.usuario.sectorId = sectorId;

    // Get planillas to close
    const planillas = await prisma.planilla.findMany({
      where,
      include: {
        usuario: { select: { id: true, nombre: true, apellido: true } },
      },
    });

    if (planillas.length === 0) {
      res.status(400).json({ error: 'No hay planillas aprobadas para cerrar en este período' });
      return;
    }

    // Close all in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.planilla.updateMany({
        where: {
          id: { in: planillas.map((p) => p.id) },
          estado: 'APROBADA',
        },
        data: {
          estado: 'CERRADA',
          cerradaAt: new Date(),
        },
      });

      // Create recibos for each closed planilla
      const recibosCreated = [];
      for (const p of planillas) {
        const existing = await tx.reciboSueldo.findUnique({ where: { planillaId: p.id } });
        if (!existing) {
          const recibo = await tx.reciboSueldo.create({
            data: {
              planillaId: p.id,
              usuarioId: p.usuario.id,
            },
          });
          recibosCreated.push(recibo.id);
        }
      }

      // Create notifications for each user
      for (const p of planillas) {
        await tx.notificacion.create({
          data: {
            usuarioId: p.usuario.id,
            tipo: 'planilla:cerrada',
            titulo: 'Período cerrado',
            cuerpo: `Tu planilla del período ${new Date(periodoInicio).toLocaleDateString('es-AR')} al ${new Date(periodoFin).toLocaleDateString('es-AR')} ha sido cerrada.`,
            link: `/planillas/${p.id}`,
          },
        });
      }

      return { cerradas: updated.count, recibosCreados: recibosCreated.length };
    });

    res.json({
      ok: true,
      planillasCerradas: result.cerradas,
      recibosCreados: result.recibosCreados,
      usuarios: planillas.map((p) => `${p.usuario.apellido} ${p.usuario.nombre}`),
    });
  } catch (error) {
    console.error('Error closing period:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
