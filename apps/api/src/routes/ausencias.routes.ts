import { Router, Response } from 'express';
import { PrismaClient, AusenciaTipo } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── Schemas ─────────────────────────────────────

const createAusenciaSchema = z.object({
  tipo: z.nativeEnum(AusenciaTipo),
  fechaInicio: z.string(),
  fechaFin: z.string(),
  diasAusencia: z.number().int().min(1),
  descripcion: z.string().max(500).optional(),
  numeroCertificado: z.string().max(50).optional(),
  descuentaSueldo: z.boolean().optional(),
  porcentajeDescuento: z.number().min(0).max(100).optional(),
});

const updateAusenciaSchema = z.object({
  tipo: z.nativeEnum(AusenciaTipo).optional(),
  fechaInicio: z.string().optional(),
  fechaFin: z.string().optional(),
  diasAusencia: z.number().int().min(1).optional(),
  descripcion: z.string().max(500).optional(),
  numeroCertificado: z.string().max(50).optional(),
  descuentaSueldo: z.boolean().optional(),
  porcentajeDescuento: z.number().min(0).max(100).optional(),
  aprobada: z.boolean().optional(),
});

// ─── GET /ausencias ──────────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userRole = req.user!.rol;
    const userId = req.user!.userId;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (['OPERADOR', 'SUPERVISOR', 'COORDINADOR', 'GERENTE'].includes(userRole)) {
      where.usuarioId = userId;
    } else {
      where.usuario = { empresaId: req.user!.empresaId };
    }

    const tipo = req.query.tipo as string | undefined;
    if (tipo) where.tipo = tipo;

    const ausencias = await prisma.ausencia.findMany({
      where,
      include: {
        usuario: { select: { id: true, nombre: true, apellido: true, legajo: true } },
      },
      orderBy: { fechaInicio: 'desc' },
    });
    res.json(ausencias);
  } catch (error) {
    console.error('Error listing ausencias:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /ausencias ─────────────────────────────

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createAusenciaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const userId = req.user!.userId;

    const ausencia = await prisma.ausencia.create({
      data: {
        usuarioId: userId,
        tipo: parsed.data.tipo,
        fechaInicio: new Date(parsed.data.fechaInicio),
        fechaFin: new Date(parsed.data.fechaFin),
        diasAusencia: parsed.data.diasAusencia,
        descripcion: parsed.data.descripcion ?? null,
        numeroCertificado: parsed.data.numeroCertificado ?? null,
        descuentaSueldo: parsed.data.descuentaSueldo ?? false,
        porcentajeDescuento: parsed.data.porcentajeDescuento ?? 0,
        requiereAprobacion: parsed.data.tipo !== 'CERTIFICADO_MEDICO',
        aprobada: parsed.data.tipo === 'CERTIFICADO_MEDICO', // Auto-approve cert médico
      },
    });

    res.status(201).json(ausencia);
  } catch (error) {
    console.error('Error creating ausencia:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /ausencias/:id ──────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ausId = req.params.id as string;
    const ausencia = await prisma.ausencia.findUnique({
      where: { id: ausId },
      include: {
        usuario: { select: { id: true, nombre: true, apellido: true, sector: { select: { nombre: true } } } },
        aprobadaPor: { select: { nombre: true, apellido: true } },
      },
    });
    if (!ausencia) {
      res.status(404).json({ error: 'Ausencia no encontrada' });
      return;
    }
    res.json(ausencia);
  } catch (error) {
    console.error('Error getting ausencia:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /ausencias/:id (RRHH/ADMIN) ────────────

router.put('/:id', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ausId = req.params.id as string;
    const parsed = updateAusenciaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos' });
      return;
    }

    const existing = await prisma.ausencia.findUnique({
      where: { id: ausId },
      include: { usuario: { select: { empresaId: true } } },
    });
    if (!existing || existing.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Ausencia no encontrada' });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { ...parsed.data };
    if (data.fechaInicio) data.fechaInicio = new Date(data.fechaInicio);
    if (data.fechaFin) data.fechaFin = new Date(data.fechaFin);
    if (data.aprobada !== undefined) {
      data.aprobadaPorId = req.user!.userId;
    }

    const ausencia = await prisma.ausencia.update({ where: { id: ausId }, data });
    res.json(ausencia);
  } catch (error) {
    console.error('Error updating ausencia:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /ausencias/:id (RRHH/ADMIN) ──────────

router.delete('/:id', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ausId = req.params.id as string;
    const existing = await prisma.ausencia.findUnique({
      where: { id: ausId },
      include: { usuario: { select: { empresaId: true } } },
    });
    if (!existing || existing.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Ausencia no encontrada' });
      return;
    }

    await prisma.ausencia.delete({ where: { id: ausId } });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting ausencia:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
