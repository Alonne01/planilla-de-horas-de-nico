import { Router, Response } from 'express';
import { PrismaClient, ContratoTipo, Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_ADMIN, LEVEL_RRHH, LEVEL_COORDINADOR } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── Schemas ─────────────────────────────────────

const createUsuarioSchema = z.object({
  nombre: z.string().min(1).max(100),
  apellido: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
  rol: z.string().min(1),
  sectorId: z.string().uuid().optional().nullable(),
  categoriaId: z.string().uuid().optional().nullable(),
  convenioId: z.string().uuid().optional().nullable(),
  legajo: z.string().max(20).optional().nullable(),
  dni: z.string().max(15).optional().nullable(),
  cuil: z.string().max(15).optional().nullable(),
  fechaNacimiento: z.string().datetime().optional().nullable(),
  telefono: z.string().max(30).optional().nullable(),
  tipoContrato: z.nativeEnum(ContratoTipo).optional(),
  fechaIngreso: z.string().datetime(),
  fechaFinPrueba: z.string().datetime().optional().nullable(),
  coordinadorId: z.string().uuid().optional().nullable(),
  supervisorId: z.string().uuid().optional().nullable(),
  diagramaColor: z.enum(['AZUL', 'AMARILLO', 'BASE']).optional().nullable(),
});

const updateUsuarioSchema = z.object({
  nombre: z.string().min(1).max(100).optional(),
  apellido: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  rol: z.string().min(1).optional(),
  sectorId: z.string().uuid().optional().nullable(),
  categoriaId: z.string().uuid().optional().nullable(),
  convenioId: z.string().uuid().optional().nullable(),
  legajo: z.string().max(20).optional().nullable(),
  dni: z.string().max(15).optional().nullable(),
  cuil: z.string().max(15).optional().nullable(),
  fechaNacimiento: z.string().datetime().optional().nullable(),
  telefono: z.string().max(30).optional().nullable(),
  tipoContrato: z.nativeEnum(ContratoTipo).optional(),
  fechaIngreso: z.string().datetime().optional(),
  fechaFinPrueba: z.string().datetime().optional().nullable(),
  fechaEgreso: z.string().datetime().optional().nullable(),
  coordinadorId: z.string().uuid().optional().nullable(),
  supervisorId: z.string().uuid().optional().nullable(),
  activo: z.boolean().optional(),
  sueldoBasicoOverride: z.number().optional().nullable(),
  diagramaColor: z.enum(['AZUL', 'AMARILLO', 'BASE']).optional().nullable(),
});

const assignDiagramaSchema = z.object({
  diagramaId: z.string().uuid(),
  fechaInicio: z.string().datetime(),
});

// ─── GET /usuarios ───────────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { rol, sectorId, activo, search } = req.query;
    const userRole = req.user!.rol;
    const userEmpresaId = req.user!.empresaId;

    const where: Record<string, unknown> = { empresaId: userEmpresaId };

    if (rol) where.rol = rol as string;
    if (sectorId) where.sectorId = sectorId as string;
    if (activo !== undefined) where.activo = activo === 'true';
    if (search) {
      where.OR = [
        { nombre: { contains: search as string, mode: 'insensitive' } },
        { apellido: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
        { legajo: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    // Role-based visibility — below RRHH see only their own sector
    const RRHH_LEVEL = 90;
    const userNivel = req.user!.rolNivel ?? 0;
    if (userNivel < RRHH_LEVEL) {
      // Look up the user's sector to filter
      const me = await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { sectorId: true } });
      if (me?.sectorId) {
        where.sectorId = me.sectorId;
      } else {
        where.id = req.user!.userId; // fallback: only self
      }
    }

    const usuarios = await prisma.usuario.findMany({
      where: where as Prisma.UsuarioWhereInput,
      select: {
        id: true,
        nombre: true,
        apellido: true,
        email: true,
        rol: true,
        legajo: true,
        activo: true,
        avatarUrl: true,
        tipoContrato: true,
        fechaIngreso: true,
        primerLogin: true,
        diagramaColor: true,
        sector: { select: { id: true, nombre: true } },
        categoria: { select: { id: true, codigo: true, nombre: true } },
        convenio: { select: { id: true, nombre: true } },
      },
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    });

    res.json(usuarios);
  } catch (error) {
    console.error('Error listing usuarios:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /usuarios/:id ──────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const usuario = await prisma.usuario.findFirst({
      where: { id: req.params.id as string, empresaId: req.user!.empresaId },
      include: {
        empresa: { select: { id: true, nombre: true } },
        sector: { select: { id: true, nombre: true } },
        categoria: { select: { id: true, codigo: true, nombre: true } },
        convenio: { select: { id: true, nombre: true } },
        coordinador: { select: { id: true, nombre: true, apellido: true } },
        supervisor: { select: { id: true, nombre: true, apellido: true } },
        diagramas: {
          where: { activo: true },
          include: { diagrama: true },
          orderBy: { fechaInicio: 'desc' },
          take: 1,
        },
      },
    });

    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    res.json({
      ...usuario,
      diagramaActual: usuario.diagramas[0]?.diagrama ?? null,
      diagramaFechaInicio: usuario.diagramas[0]?.fechaInicio ?? null,
      diagramas: undefined,
    });
  } catch (error) {
    console.error('Error getting usuario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /usuarios ──────────────────────────────

router.post('/', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createUsuarioSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const existing = await prisma.usuario.findUnique({ where: { email: parsed.data.email } });
    if (existing) {
      res.status(409).json({ error: 'Ya existe un usuario con ese email' });
      return;
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);

    const usuario = await prisma.usuario.create({
      data: {
        empresaId: req.user!.empresaId,
        nombre: parsed.data.nombre,
        apellido: parsed.data.apellido,
        email: parsed.data.email,
        passwordHash,
        rol: parsed.data.rol,
        sectorId: parsed.data.sectorId ?? null,
        categoriaId: parsed.data.categoriaId ?? null,
        convenioId: parsed.data.convenioId ?? null,
        legajo: parsed.data.legajo ?? null,
        dni: parsed.data.dni ?? null,
        cuil: parsed.data.cuil ?? null,
        fechaNacimiento: parsed.data.fechaNacimiento ? new Date(parsed.data.fechaNacimiento) : null,
        telefono: parsed.data.telefono ?? null,
        tipoContrato: parsed.data.tipoContrato ?? ContratoTipo.INDEFINIDO,
        fechaIngreso: new Date(parsed.data.fechaIngreso),
        fechaFinPrueba: parsed.data.fechaFinPrueba ? new Date(parsed.data.fechaFinPrueba) : null,
        coordinadorId: parsed.data.coordinadorId ?? null,
        supervisorId: parsed.data.supervisorId ?? null,
        diagramaColor: parsed.data.diagramaColor ?? null,
        primerLogin: true,
      },
      include: {
        sector: { select: { id: true, nombre: true } },
        categoria: { select: { id: true, codigo: true, nombre: true } },
      },
    });

    res.status(201).json(usuario);
  } catch (error) {
    console.error('Error creating usuario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── PUT /usuarios/:id ──────────────────────────

router.put('/:id', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = updateUsuarioSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const existing = await prisma.usuario.findFirst({
      where: { id: req.params.id as string, empresaId: req.user!.empresaId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    if (parsed.data.email && parsed.data.email !== existing.email) {
      const emailExists = await prisma.usuario.findUnique({ where: { email: parsed.data.email } });
      if (emailExists) {
        res.status(409).json({ error: 'Email ya en uso' });
        return;
      }
    }

    const d = parsed.data;

    const usuario = await prisma.usuario.update({
      where: { id: req.params.id as string },
      data: {
        ...(d.nombre !== undefined && { nombre: d.nombre }),
        ...(d.apellido !== undefined && { apellido: d.apellido }),
        ...(d.email !== undefined && { email: d.email }),
        ...(d.rol !== undefined && { rol: d.rol }),
        ...(d.sectorId !== undefined && { sectorId: d.sectorId }),
        ...(d.categoriaId !== undefined && { categoriaId: d.categoriaId }),
        ...(d.convenioId !== undefined && { convenioId: d.convenioId }),
        ...(d.legajo !== undefined && { legajo: d.legajo }),
        ...(d.dni !== undefined && { dni: d.dni }),
        ...(d.cuil !== undefined && { cuil: d.cuil }),
        ...(d.telefono !== undefined && { telefono: d.telefono }),
        ...(d.tipoContrato !== undefined && { tipoContrato: d.tipoContrato }),
        ...(d.activo !== undefined && { activo: d.activo }),
        ...(d.coordinadorId !== undefined && { coordinadorId: d.coordinadorId }),
        ...(d.supervisorId !== undefined && { supervisorId: d.supervisorId }),
        ...(d.fechaIngreso && { fechaIngreso: new Date(d.fechaIngreso) }),
        ...(d.fechaNacimiento && { fechaNacimiento: new Date(d.fechaNacimiento) }),
        ...(d.fechaFinPrueba !== undefined && d.fechaFinPrueba !== null && { fechaFinPrueba: new Date(d.fechaFinPrueba) }),
        ...(d.fechaEgreso !== undefined && d.fechaEgreso !== null && { fechaEgreso: new Date(d.fechaEgreso) }),
        ...(d.diagramaColor !== undefined && { diagramaColor: d.diagramaColor }),
      },
    });

    res.json(usuario);
  } catch (error) {
    console.error('Error updating usuario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── DELETE /usuarios/:id (soft delete) ──────────

router.delete('/:id', requireLevel(LEVEL_ADMIN), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.usuario.findFirst({
      where: { id: req.params.id as string, empresaId: req.user!.empresaId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    if (req.params.id === req.user!.userId) {
      res.status(400).json({ error: 'No podés desactivar tu propia cuenta' });
      return;
    }

    await prisma.usuario.update({
      where: { id: req.params.id as string },
      data: { activo: false },
    });

    res.status(204).send();
  } catch (error) {
    console.error('Error deactivating usuario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── PATCH /usuarios/:id/diagrama ────────────────

router.patch('/:id/diagrama', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = assignDiagramaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const usuario = await prisma.usuario.findFirst({
      where: { id: req.params.id as string, empresaId: req.user!.empresaId },
    });
    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    // Deactivate current diagram assignment
    await prisma.usuarioDiagrama.updateMany({
      where: { usuarioId: req.params.id as string, activo: true },
      data: { activo: false, fechaFin: new Date() },
    });

    // Create new assignment
    const assignment = await prisma.usuarioDiagrama.create({
      data: {
        usuarioId: req.params.id as string,
        diagramaId: parsed.data.diagramaId,
        fechaInicio: new Date(parsed.data.fechaInicio),
      },
      include: { diagrama: true },
    });

    res.json(assignment);
  } catch (error) {
    console.error('Error assigning diagrama:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── PATCH /usuarios/:id/sector ──────────────────

// ─── PATCH /usuarios/:id/diagrama-color ──────────
// Coordinadores of Well Testing can set diagrama color for their sector members

router.patch('/:id/diagrama-color', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const schema = z.object({ diagramaColor: z.enum(['AZUL', 'AMARILLO', 'BASE']).nullable() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valor inválido. Usar AZUL, AMARILLO, BASE o null.' });
      return;
    }

    // Verify the target user is in the same sector
    const caller = await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { sectorId: true } });
    const target = await prisma.usuario.findFirst({
      where: { id: req.params.id as string, empresaId: req.user!.empresaId },
      select: { sectorId: true },
    });

    if (!target) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    if (caller?.sectorId !== target.sectorId) {
      res.status(403).json({ error: 'Solo puedes modificar empleados de tu sector' });
      return;
    }

    const updated = await prisma.usuario.update({
      where: { id: req.params.id as string },
      data: { diagramaColor: parsed.data.diagramaColor },
      select: { id: true, diagramaColor: true },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating diagrama color:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── PATCH /usuarios/:id/sector ──────────────────

router.patch('/:id/sector', requireLevel(LEVEL_ADMIN), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const schema = z.object({ sectorId: z.string().uuid().nullable() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos' });
      return;
    }

    const existing = await prisma.usuario.findFirst({
      where: { id: req.params.id as string, empresaId: req.user!.empresaId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    const usuario = await prisma.usuario.update({
      where: { id: req.params.id as string },
      data: { sectorId: parsed.data.sectorId },
      include: {
        sector: { select: { id: true, nombre: true } },
      },
    });

    res.json(usuario);
  } catch (error) {
    console.error('Error updating sector:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /usuarios/:id/ficha ─────────────────────

router.get('/:id/ficha', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const usuario = await prisma.usuario.findFirst({
      where: { id: req.params.id as string, empresaId: req.user!.empresaId },
      include: {
        empresa: { select: { nombre: true } },
        sector: true,
        categoria: true,
        convenio: true,
        coordinador: { select: { id: true, nombre: true, apellido: true } },
        supervisor: { select: { id: true, nombre: true, apellido: true } },
        diagramas: {
          include: { diagrama: true },
          orderBy: { fechaInicio: 'desc' },
        },
        planillas: {
          select: { id: true, periodoInicio: true, periodoFin: true, estado: true },
          orderBy: { periodoInicio: 'desc' },
          take: 12,
        },
        vacaciones: {
          select: { id: true, fechaInicio: true, fechaFin: true, diasHabiles: true, estado: true },
          orderBy: { fechaInicio: 'desc' },
          take: 10,
        },
        ausencias: {
          select: { id: true, tipo: true, fechaInicio: true, fechaFin: true, diasAusencia: true },
          orderBy: { fechaInicio: 'desc' },
          take: 10,
        },
      },
    });

    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    res.json(usuario);
  } catch (error) {
    console.error('Error getting ficha:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
