import { Router, Response } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH } from '../middleware/roles.middleware.js';
import { fechaDia } from '../utils/zod.utils.js';
import { fmtFechaDia } from '../utils/fecha-dia.utils.js';

const prisma = new PrismaClient();
const router = Router();

const exportacionSchema = z
  .object({
    periodoInicio: fechaDia,
    periodoFin: fechaDia,
    nombreArchivo: z.string().min(1, 'nombreArchivo es requerido'),
    sectoresIds: z.array(z.string()).optional(),
    usuariosIds: z.array(z.string()).optional(),
    totalPersonas: z.number().int().nullable().optional(),
    totalRegistros: z.number().int().nullable().optional(),
  })
  .refine(
    (d) => d.periodoFin >= d.periodoInicio,
    { message: 'periodoFin debe ser mayor o igual a periodoInicio', path: ['periodoFin'] },
  );

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
    const parsed = exportacionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }
    const { periodoInicio, periodoFin, sectoresIds, usuariosIds, nombreArchivo, totalPersonas, totalRegistros } = parsed.data;

    const exportacion = await prisma.exportacion.create({
      data: {
        empresaId: req.user!.empresaId,
        generadaPorId: req.user!.userId,
        periodoInicio,
        periodoFin,
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

      // Create notifications for each user
      for (const p of planillas) {
        await tx.notificacion.create({
          data: {
            usuarioId: p.usuario.id,
            tipo: 'planilla:cerrada',
            titulo: 'Período cerrado',
            cuerpo: `Tu planilla del período ${fmtFechaDia(new Date(periodoInicio))} al ${fmtFechaDia(new Date(periodoFin))} ha sido cerrada.`,
            link: `/planillas/${p.id}`,
          },
        });
      }

      return { cerradas: updated.count };
    });

    res.json({
      ok: true,
      planillasCerradas: result.cerradas,
      usuarios: planillas.map((p) => `${p.usuario.apellido} ${p.usuario.nombre}`),
    });
  } catch (error) {
    console.error('Error closing period:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
