import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH, LEVEL_COORDINADOR } from '../middleware/roles.middleware.js';
import { fechaDia } from '../utils/zod.utils.js';
import { hoyLocalEmpresa } from '../utils/fecha-dia.utils.js';
import { estadoVigencia } from '../utils/capacitacion-vigencia.utils.js';

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
  fechaRealizacion: fechaDia,
  fechaVencimiento: fechaDia.nullable().optional(),
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

router.get('/tipos', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
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
      res.status(400).json({ error: 'Datos inválidos', details: err.flatten() });
      return;
    }
    console.error('Error creating tipo:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /tipos/:id — Update training type ───────

router.put('/tipos/:id', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = tipoCapSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }
    // El tenant va dentro del WHERE: sin TOCTOU y sin poder tocar el catálogo de otra empresa
    const result = await prisma.tipoCapacitacion.updateMany({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
      data: parsed.data,
    });
    if (result.count === 0) {
      res.status(404).json({ error: 'Tipo no encontrado' });
      return;
    }
    const tipo = await prisma.tipoCapacitacion.findUnique({ where: { id: req.params.id } });
    res.json(tipo);
  } catch (err: any) {
    console.error('Error updating tipo:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /tipos/:id — Deactivate training type ─

router.delete('/tipos/:id', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await prisma.tipoCapacitacion.updateMany({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
      data: { activo: false },
    });
    if (result.count === 0) {
      res.status(404).json({ error: 'No encontrado' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('Error deleting tipo:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /registros — List all training records (RRHH) ───

router.get('/registros', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { tipoId, usuarioId, estado } = req.query;
    const userNivel = req.user!.rolNivel ?? 0;
    const userId = req.user!.userId;
    // EmpleadoCapacitacion no tiene empresaId propio: el tenant se acota por la relación usuario
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { usuario: { empresaId: req.user!.empresaId } };

    // Los filtros llegan crudos del query string: si no son string, Prisma revienta con 500
    if (typeof tipoId === 'string') where.tipoId = tipoId;
    if (typeof usuarioId === 'string') where.usuarioId = usuarioId;

    // Sector filtering for non-RRHH
    if (userNivel < 90) {
      const me = await prisma.usuario.findUnique({ where: { id: userId }, select: { sectorId: true } });
      if (me?.sectorId) {
        const sectorUsers = await prisma.usuario.findMany({
          where: { sectorId: me.sectorId, empresaId: req.user!.empresaId, activo: true },
          select: { id: true },
        });
        where.usuarioId = { in: sectorUsers.map(u => u.id) };
      } else {
        where.usuarioId = userId;
      }
    }

    const registros = await prisma.empleadoCapacitacion.findMany({
      where,
      include: {
        tipo: true,
        usuario: { select: { id: true, nombre: true, apellido: true, legajo: true } },
      },
      orderBy: { fechaRealizacion: 'desc' },
    });

    // Filter by status (vigente/vencida/proxima) in-memory
    const hoy = hoyLocalEmpresa();
    const result = registros.map((r) => ({
      ...r,
      statusCap: estadoVigencia(r.fechaVencimiento, r.tipo.alertaDias ?? 30, hoy),
    }));

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
    const empresaId = req.user!.empresaId;

    // Empleado y tipo tienen que ser de la empresa del emisor: si no, se cargan
    // capacitaciones a personas de otro tenant o con el catálogo ajeno
    const [empleado, tipo] = await Promise.all([
      prisma.usuario.findFirst({ where: { id: data.usuarioId, empresaId }, select: { id: true } }),
      prisma.tipoCapacitacion.findFirst({ where: { id: data.tipoId, empresaId }, select: { id: true, vigenciaDias: true } }),
    ]);
    if (!empleado) { res.status(400).json({ error: 'Empleado no encontrado' }); return; }
    if (!tipo) { res.status(400).json({ error: 'Tipo de capacitación no encontrado' }); return; }

    // Auto-calculate fechaVencimiento if tipo has vigenciaDias
    let fechaVencimiento = data.fechaVencimiento ?? null;
    if (!fechaVencimiento && tipo.vigenciaDias) {
      // `new Date(...)` copia el valor: no se puede mutar `data.fechaRealizacion`
      // directamente con `setDate`, porque abajo se guarda ese mismo campo.
      fechaVencimiento = new Date(data.fechaRealizacion);
      fechaVencimiento.setUTCDate(fechaVencimiento.getUTCDate() + tipo.vigenciaDias);
    }

    const registro = await prisma.empleadoCapacitacion.create({
      data: {
        usuarioId: data.usuarioId,
        tipoId: data.tipoId,
        fechaRealizacion: data.fechaRealizacion,
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
      res.status(400).json({ error: 'Datos inválidos', details: err.flatten() });
      return;
    }
    console.error('Error creating registro:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /registros/:id — Update training record ─

router.put('/registros/:id', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = empleadoCapSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }
    const data = parsed.data;
    const empresaId = req.user!.empresaId;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {};
    if (data.tipoId !== undefined) updateData.tipoId = data.tipoId;
    if (data.fechaRealizacion) updateData.fechaRealizacion = data.fechaRealizacion;
    if (data.fechaVencimiento !== undefined) updateData.fechaVencimiento = data.fechaVencimiento ?? null;
    if (data.institucion !== undefined) updateData.institucion = data.institucion;
    if (data.archivoUrl !== undefined) updateData.archivoUrl = data.archivoUrl;
    if (data.observaciones !== undefined) updateData.observaciones = data.observaciones;

    // El tipo nuevo también tiene que ser del propio catálogo
    if (data.tipoId !== undefined) {
      const tipo = await prisma.tipoCapacitacion.findFirst({ where: { id: data.tipoId, empresaId }, select: { id: true } });
      if (!tipo) { res.status(400).json({ error: 'Tipo de capacitación no encontrado' }); return; }
    }

    // Tenant en el WHERE por la relación usuario (el modelo no tiene empresaId propio)
    const result = await prisma.empleadoCapacitacion.updateMany({
      where: { id: req.params.id, usuario: { empresaId } },
      data: updateData,
    });
    if (result.count === 0) {
      res.status(404).json({ error: 'No encontrado' });
      return;
    }
    const registro = await prisma.empleadoCapacitacion.findUnique({
      where: { id: req.params.id },
      include: { tipo: true },
    });
    res.json(registro);
  } catch (err: any) {
    console.error('Error updating registro:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /registros/:id — Delete training record ─

router.delete('/registros/:id', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await prisma.empleadoCapacitacion.deleteMany({
      where: { id: req.params.id, usuario: { empresaId: req.user!.empresaId } },
    });
    if (result.count === 0) {
      res.status(404).json({ error: 'No encontrado' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('Error deleting registro:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /resumen — Summary dashboard data ───────

router.get('/resumen', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hoy = hoyLocalEmpresa();
    const userNivel = req.user!.rolNivel ?? 0;
    const userId = req.user!.userId;

    // EmpleadoCapacitacion no tiene empresaId propio: el tenant se acota por la relación usuario
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { usuario: { empresaId: req.user!.empresaId } };

    // Sector filtering for non-RRHH
    if (userNivel < 90) {
      const me = await prisma.usuario.findUnique({ where: { id: userId }, select: { sectorId: true } });
      if (me?.sectorId) {
        const sectorUsers = await prisma.usuario.findMany({
          where: { sectorId: me.sectorId, empresaId: req.user!.empresaId, activo: true },
          select: { id: true },
        });
        where.usuarioId = { in: sectorUsers.map(u => u.id) };
      } else {
        where.usuarioId = userId;
      }
    }

    const registros = await prisma.empleadoCapacitacion.findMany({
      where,
      include: { tipo: true },
    });

    let vigentes = 0, vencidas = 0, proximas = 0;
    registros.forEach((r) => {
      // Un registro sin vencimiento cuenta como vigente en este resumen (a
      // diferencia de GET /registros, que lo expone como 'sin_vencimiento').
      const estado = estadoVigencia(r.fechaVencimiento, r.tipo.alertaDias ?? 30, hoy);
      if (estado === 'vencida') vencidas++;
      else if (estado === 'proxima') proximas++;
      else vigentes++;
    });

    res.json({ total: registros.length, vigentes, vencidas, proximas });
  } catch (err) {
    console.error('Error fetching resumen:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
