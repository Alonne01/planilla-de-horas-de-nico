import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── Schemas ─────────────────────────────────────

const tipoCapSchema = z.object({
  nombre: z.string().min(1).max(200),
  descripcion: z.string().max(500).nullable().optional(),
  vigenciaDias: z.number().int().min(1).nullable().optional(),
  esObligatoria: z.boolean().optional(),
  alertaDias: z.number().int().min(0).optional(),
});

const empleadoCapSchema = z.object({
  usuarioId: z.string().uuid(),
  tipoId: z.string().uuid(),
  fechaRealizacion: z.string(),
  fechaVencimiento: z.string().nullable().optional(),
  institucion: z.string().max(200).nullable().optional(),
  archivoUrl: z.string().max(500).nullable().optional(),
  observaciones: z.string().max(500).nullable().optional(),
});

// ══════════════════════════════════════════════════
// EMPLOYEE ENDPOINTS (own data)
// ══════════════════════════════════════════════════

// ─── GET /mis-capacitaciones — Employee's own training records ───

router.get('/mis-capacitaciones', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const records = await prisma.empleadoCapacitacion.findMany({
      where: { usuarioId: req.user!.userId },
      include: { tipo: true },
      orderBy: { fechaRealizacion: 'desc' },
    });
    res.json(records);
  } catch (err) {
    console.error('Error fetching mis capacitaciones:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ══════════════════════════════════════════════════
// RRHH/ADMIN ENDPOINTS
// ══════════════════════════════════════════════════

// ─── GET /tipos — List training types ────────────

router.get('/tipos', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tipos = await prisma.tipoCapacitacion.findMany({
      where: { empresaId: req.user!.empresaId },
      include: { _count: { select: { capacitaciones: true } } },
      orderBy: { nombre: 'asc' },
    });
    res.json(tipos);
  } catch (err) {
    console.error('Error fetching tipos capacitacion:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /tipos — Create training type ──────────

router.post('/tipos', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = tipoCapSchema.parse(req.body);
    const tipo = await prisma.tipoCapacitacion.create({
      data: {
        empresaId: req.user!.empresaId,
        nombre: data.nombre,
        descripcion: data.descripcion ?? null,
        vigenciaDias: data.vigenciaDias ?? null,
        esObligatoria: data.esObligatoria ?? false,
        alertaDias: data.alertaDias ?? 30,
      },
    });
    res.status(201).json(tipo);
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Datos inválidos', details: err.errors });
      return;
    }
    console.error('Error creating tipo:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /tipos/:id — Update training type ───────

router.put('/tipos/:id', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = tipoCapSchema.partial().parse(req.body);
    const tipo = await prisma.tipoCapacitacion.update({
      where: { id: req.params.id },
      data,
    });
    res.json(tipo);
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Tipo no encontrado' }); return; }
    console.error('Error updating tipo:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /tipos/:id — Deactivate training type ─

router.delete('/tipos/:id', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.tipoCapacitacion.update({
      where: { id: req.params.id },
      data: { activo: false },
    });
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'No encontrado' }); return; }
    console.error('Error deleting tipo:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /registros — List all training records (RRHH) ───

router.get('/registros', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { tipoId, usuarioId, estado } = req.query;
    const where: any = {};

    if (tipoId) where.tipoId = tipoId;
    if (usuarioId) where.usuarioId = usuarioId;

    const registros = await prisma.empleadoCapacitacion.findMany({
      where,
      include: {
        tipo: true,
        usuario: { select: { id: true, nombre: true, apellido: true, legajo: true } },
      },
      orderBy: { fechaRealizacion: 'desc' },
    });

    // Filter by status (vigente/vencida/proxima) in-memory
    const now = new Date();
    const result = registros.map((r) => {
      let statusCap: 'vigente' | 'vencida' | 'proxima' | 'sin_vencimiento' = 'sin_vencimiento';
      if (r.fechaVencimiento) {
        const venc = new Date(r.fechaVencimiento);
        const diffDays = Math.ceil((venc.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) statusCap = 'vencida';
        else if (diffDays <= (r.tipo.alertaDias ?? 30)) statusCap = 'proxima';
        else statusCap = 'vigente';
      }
      return { ...r, statusCap };
    });

    if (estado) {
      res.json(result.filter((r) => r.statusCap === estado));
    } else {
      res.json(result);
    }
  } catch (err) {
    console.error('Error fetching registros:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /registros — Create training record ────

router.post('/registros', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = empleadoCapSchema.parse(req.body);

    // Auto-calculate fechaVencimiento if tipo has vigenciaDias
    let fechaVencimiento = data.fechaVencimiento ? new Date(data.fechaVencimiento) : null;
    if (!fechaVencimiento) {
      const tipo = await prisma.tipoCapacitacion.findUnique({ where: { id: data.tipoId } });
      if (tipo?.vigenciaDias) {
        fechaVencimiento = new Date(data.fechaRealizacion);
        fechaVencimiento.setDate(fechaVencimiento.getDate() + tipo.vigenciaDias);
      }
    }

    const registro = await prisma.empleadoCapacitacion.create({
      data: {
        usuarioId: data.usuarioId,
        tipoId: data.tipoId,
        fechaRealizacion: new Date(data.fechaRealizacion),
        fechaVencimiento,
        institucion: data.institucion ?? null,
        archivoUrl: data.archivoUrl ?? null,
        observaciones: data.observaciones ?? null,
      },
      include: { tipo: true, usuario: { select: { id: true, nombre: true, apellido: true } } },
    });
    res.status(201).json(registro);
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Datos inválidos', details: err.errors });
      return;
    }
    console.error('Error creating registro:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /registros/:id — Update training record ─

router.put('/registros/:id', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = empleadoCapSchema.partial().parse(req.body);
    const updateData: any = {};
    if (data.fechaRealizacion) updateData.fechaRealizacion = new Date(data.fechaRealizacion);
    if (data.fechaVencimiento !== undefined) updateData.fechaVencimiento = data.fechaVencimiento ? new Date(data.fechaVencimiento) : null;
    if (data.institucion !== undefined) updateData.institucion = data.institucion;
    if (data.archivoUrl !== undefined) updateData.archivoUrl = data.archivoUrl;
    if (data.observaciones !== undefined) updateData.observaciones = data.observaciones;

    const registro = await prisma.empleadoCapacitacion.update({
      where: { id: req.params.id },
      data: updateData,
      include: { tipo: true },
    });
    res.json(registro);
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'No encontrado' }); return; }
    console.error('Error updating registro:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /registros/:id — Delete training record ─

router.delete('/registros/:id', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.empleadoCapacitacion.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'No encontrado' }); return; }
    console.error('Error deleting registro:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /resumen — Summary dashboard data ───────

router.get('/resumen', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const registros = await prisma.empleadoCapacitacion.findMany({
      include: { tipo: true },
    });

    let vigentes = 0, vencidas = 0, proximas = 0;
    registros.forEach((r) => {
      if (!r.fechaVencimiento) { vigentes++; return; }
      const diff = Math.ceil((new Date(r.fechaVencimiento).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (diff < 0) vencidas++;
      else if (diff <= (r.tipo.alertaDias ?? 30)) proximas++;
      else vigentes++;
    });

    res.json({ total: registros.length, vigentes, vencidas, proximas });
  } catch (err) {
    console.error('Error fetching resumen:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
