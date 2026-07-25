import { Router, Response } from 'express';
import { PrismaClient, ContratoTipo, Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { z } from 'zod';
import { fechaFlexible } from '../utils/zod.utils.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_ADMIN, LEVEL_RRHH, LEVEL_COORDINADOR, LEVEL_SUPERVISOR } from '../middleware/roles.middleware.js';
import { revokeAllRefreshTokensForUser } from '../utils/jwt.utils.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── Schemas ─────────────────────────────────────

const createUsuarioSchema = z.object({
  nombre: z.string().min(1).max(100),
  apellido: z.string().min(1).max(100),
  email: z.string().email(),
  password: z
    .string()
    .min(8, 'Mínimo 8 caracteres')
    .max(72, 'Máximo 72 caracteres')
    .regex(/[A-Z]/, 'Debe contener al menos una mayúscula')
    .regex(/[0-9]/, 'Debe contener al menos un número'),
  rol: z.string().min(1),
  sectorId: z.string().uuid().optional().nullable(),
  legajo: z.string().max(20).optional().nullable(),
  dni: z.string().max(15).optional().nullable(),
  cuil: z.string().max(15).optional().nullable(),
  fechaNacimiento: fechaFlexible.optional().nullable(),
  telefono: z.string().max(30).optional().nullable(),
  tipoContrato: z.nativeEnum(ContratoTipo).optional(),
  fechaIngreso: fechaFlexible,
  fechaFinPrueba: fechaFlexible.optional().nullable(),
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
  legajo: z.string().max(20).optional().nullable(),
  dni: z.string().max(15).optional().nullable(),
  cuil: z.string().max(15).optional().nullable(),
  fechaNacimiento: fechaFlexible.optional().nullable(),
  telefono: z.string().max(30).optional().nullable(),
  tipoContrato: z.nativeEnum(ContratoTipo).optional(),
  fechaIngreso: fechaFlexible.optional(),
  fechaFinPrueba: fechaFlexible.optional().nullable(),
  fechaEgreso: fechaFlexible.optional().nullable(),
  coordinadorId: z.string().uuid().optional().nullable(),
  supervisorId: z.string().uuid().optional().nullable(),
  activo: z.boolean().optional(),
  diagramaColor: z.enum(['AZUL', 'AMARILLO', 'BASE']).optional().nullable(),
});

const assignDiagramaSchema = z.object({
  diagramaId: z.string().uuid(),
  fechaInicio: fechaFlexible,
});

// ─── Helper: resolve a role's permission level for this empresa ───
// Returns the RolConfig.nivel for `codigo`, or null if the role doesn't exist.
async function getRoleLevel(empresaId: string, codigo: string): Promise<number | null> {
  const rc = await prisma.rolConfig.findFirst({
    where: { empresaId, codigo, activo: true },
    select: { nivel: true },
  });
  return rc?.nivel ?? null;
}

// Guard against privilege escalation: a user may never assign a role whose
// level exceeds their own. Writes the HTTP error and returns false when blocked.
async function assertCanAssignRole(req: AuthRequest, res: Response, codigo: string): Promise<boolean> {
  const targetLevel = await getRoleLevel(req.user!.empresaId, codigo);
  if (targetLevel === null) {
    res.status(400).json({ error: 'Rol inexistente' });
    return false;
  }
  if (targetLevel > (req.user!.rolNivel ?? 0)) {
    res.status(403).json({ error: 'No podés asignar un rol de nivel superior al tuyo' });
    return false;
  }
  return true;
}

// Tenant isolation for the reporting line: a coordinador/supervisor from another
// empresa breaks the approval chain (the real supervisor stops matching) and leaks
// the foreign user through GET /usuarios/:id. Writes the HTTP error and returns false.
async function assertRefsDeLaEmpresa(
  req: AuthRequest,
  res: Response,
  coordinadorId?: string | null,
  supervisorId?: string | null,
): Promise<boolean> {
  const refs: Array<[string, string]> = [];
  if (coordinadorId) refs.push(['Coordinador', coordinadorId]);
  if (supervisorId) refs.push(['Supervisor', supervisorId]);

  for (const [etiqueta, id] of refs) {
    const existe = await prisma.usuario.findFirst({
      where: { id, empresaId: req.user!.empresaId },
      select: { id: true },
    });
    if (!existe) {
      res.status(400).json({ error: `${etiqueta} inexistente` });
      return false;
    }
  }
  return true;
}

// ─── GET /usuarios ───────────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { rol, sectorId, activo, search } = req.query;
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

// El detalle lo puede pedir cualquier compañero de sector, así que los campos se
// recortan por nivel en vez de devolver la fila entera: los datos personales (dni,
// cuil, nacimiento, teléfono, egreso, saldo de vacaciones) sólo salen para el propio
// usuario o RRHH/ADMIN.

// Par de sector: el mismo conjunto que ya expone el listado GET /usuarios, más la
// empresa y el diagrama vigente que el detalle necesita.
const SELECT_USUARIO_PAR = {
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
  empresaId: true,
  sectorId: true,
  empresa: { select: { id: true, nombre: true } },
  sector: { select: { id: true, nombre: true } },
  diagramas: {
    where: { activo: true },
    select: { fechaInicio: true, diagrama: true },
    orderBy: { fechaInicio: 'desc' as const },
    take: 1,
  },
} satisfies Prisma.UsuarioSelect;

// Supervisor en adelante: suma la línea de mando y el período de prueba, que es lo
// que hace falta para gestionar al empleado.
const SELECT_USUARIO_GESTION = {
  ...SELECT_USUARIO_PAR,
  fechaFinPrueba: true,
  coordinadorId: true,
  supervisorId: true,
  coordinador: { select: { id: true, nombre: true, apellido: true } },
  supervisor: { select: { id: true, nombre: true, apellido: true } },
} satisfies Prisma.UsuarioSelect;

// El propio usuario y RRHH/ADMIN: ficha completa (todo menos passwordHash).
const SELECT_USUARIO_COMPLETO = {
  ...SELECT_USUARIO_GESTION,
  dni: true,
  cuil: true,
  fechaNacimiento: true,
  telefono: true,
  fechaEgreso: true,
  diasVacacionesSaldo: true,
  diasVacacionesUsados: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UsuarioSelect;

type UsuarioDetalle = Record<string, unknown> & {
  id: string;
  sectorId: string | null;
  diagramas: Array<{ fechaInicio: Date; diagrama: unknown }>;
};

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userNivel = req.user!.rolNivel ?? 0;
    const esPropio = req.params.id === req.user!.userId;

    const select = esPropio || userNivel >= LEVEL_RRHH
      ? SELECT_USUARIO_COMPLETO
      : userNivel >= LEVEL_SUPERVISOR
        ? SELECT_USUARIO_GESTION
        : SELECT_USUARIO_PAR;

    const usuario = (await prisma.usuario.findFirst({
      where: { id: req.params.id as string, empresaId: req.user!.empresaId },
      select: select as Prisma.UsuarioSelect,
    })) as unknown as UsuarioDetalle | null;

    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    // Access control: below RRHH can only see themselves or users in their own
    // sector (mirror the visibility rule of GET /usuarios). 404 to avoid leaking
    // the existence of out-of-scope users.
    if (userNivel < LEVEL_RRHH && !esPropio) {
      const me = await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { sectorId: true } });
      if (!me?.sectorId || me.sectorId !== usuario.sectorId) {
        res.status(404).json({ error: 'Usuario no encontrado' });
        return;
      }
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

    // Unicidad de legajo a nivel aplicación (el schema no tiene constraint).
    // Sólo aplica a legajos no nulos y dentro de la misma empresa.
    if (parsed.data.legajo) {
      const legajoExists = await prisma.usuario.findFirst({
        where: { empresaId: req.user!.empresaId, legajo: parsed.data.legajo },
        select: { id: true },
      });
      if (legajoExists) {
        res.status(409).json({ error: 'Ya existe un usuario con ese legajo' });
        return;
      }
    }

    // Privilege-escalation guard: cannot create a user above the caller's level
    if (!(await assertCanAssignRole(req, res, parsed.data.rol))) return;

    // Tenant isolation: a provided sector must belong to the caller's empresa
    if (parsed.data.sectorId) {
      const sector = await prisma.sector.findFirst({
        where: { id: parsed.data.sectorId, empresaId: req.user!.empresaId },
        select: { id: true },
      });
      if (!sector) {
        res.status(400).json({ error: 'Sector inexistente' });
        return;
      }
    }

    // La línea de mando también queda dentro del tenant: supervisorId define quién
    // aprueba los documentos del empleado, y uno de otra empresa lo deja sin aprobador.
    if (!(await assertRefsDeLaEmpresa(req, res, parsed.data.coordinadorId, parsed.data.supervisorId))) return;

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
      },
    });

    const { passwordHash: _omit, ...safeUsuario } = usuario;
    res.status(201).json(safeUsuario);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2003') {
      res.status(400).json({ error: 'Referencia inválida: sector, coordinador o supervisor inexistente' });
      return;
    }
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

    if (parsed.data.legajo && parsed.data.legajo !== existing.legajo) {
      const legajoExists = await prisma.usuario.findFirst({
        where: { empresaId: req.user!.empresaId, legajo: parsed.data.legajo, id: { not: existing.id } },
        select: { id: true },
      });
      if (legajoExists) {
        res.status(409).json({ error: 'Legajo ya en uso' });
        return;
      }
    }

    const d = parsed.data;

    // Privilege-escalation guard: cannot promote a user above the caller's level.
    // Also prevents an RRHH from editing/demoting someone already above them.
    if (d.rol !== undefined && !(await assertCanAssignRole(req, res, d.rol))) return;
    const targetCurrentLevel = await getRoleLevel(req.user!.empresaId, existing.rol);
    if (targetCurrentLevel !== null && targetCurrentLevel > (req.user!.rolNivel ?? 0)) {
      res.status(403).json({ error: 'No podés modificar a un usuario de nivel superior al tuyo' });
      return;
    }

    // Tenant isolation: el mismo chequeo que hace POST /. Un sectorId de otra empresa
    // mete al empleado en el alcance de analytics/export del otro tenant, y una línea
    // de mando ajena lo deja sin aprobador válido.
    if (d.sectorId) {
      const sector = await prisma.sector.findFirst({
        where: { id: d.sectorId, empresaId: req.user!.empresaId },
        select: { id: true },
      });
      if (!sector) {
        res.status(400).json({ error: 'Sector inexistente' });
        return;
      }
    }
    if (!(await assertRefsDeLaEmpresa(req, res, d.coordinadorId, d.supervisorId))) return;

    const usuario = await prisma.usuario.update({
      where: { id: req.params.id as string },
      data: {
        ...(d.nombre !== undefined && { nombre: d.nombre }),
        ...(d.apellido !== undefined && { apellido: d.apellido }),
        ...(d.email !== undefined && { email: d.email }),
        ...(d.rol !== undefined && { rol: d.rol }),
        ...(d.sectorId !== undefined && { sectorId: d.sectorId }),
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

    const { passwordHash: _omit, ...safeUsuario } = usuario;
    res.json(safeUsuario);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2003') {
      res.status(400).json({ error: 'Referencia inválida: sector, coordinador o supervisor inexistente' });
      return;
    }
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

    // Validate the target diagrama exists in this empresa: prevents an FK 500 that
    // would leave the user with no active diagram after the deactivation below.
    const diagrama = await prisma.diagrama.findFirst({
      where: { id: parsed.data.diagramaId, empresaId: req.user!.empresaId },
      select: { id: true },
    });
    if (!diagrama) {
      res.status(400).json({ error: 'Diagrama inexistente' });
      return;
    }

    // Atomic: deactivate the current assignment and create the new one together.
    const assignment = await prisma.$transaction(async (tx) => {
      await tx.usuarioDiagrama.updateMany({
        where: { usuarioId: req.params.id as string, activo: true },
        data: { activo: false, fechaFin: new Date() },
      });
      return tx.usuarioDiagrama.create({
        data: {
          usuarioId: req.params.id as string,
          diagramaId: parsed.data.diagramaId,
          fechaInicio: new Date(parsed.data.fechaInicio),
        },
        include: { diagrama: true },
      });
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

    // Ambos sectores tienen que existir: con los dos en null la igualdad se cumple
    // sola y un coordinador sin sector podría tocar a cualquier empleado sin sector.
    if ((req.user!.rolNivel ?? 0) < LEVEL_RRHH && (!caller?.sectorId || caller.sectorId !== target.sectorId)) {
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

    // Tenant isolation: a provided sector must belong to the caller's empresa
    if (parsed.data.sectorId) {
      const sector = await prisma.sector.findFirst({
        where: { id: parsed.data.sectorId, empresaId: req.user!.empresaId },
        select: { id: true },
      });
      if (!sector) {
        res.status(400).json({ error: 'Sector inexistente' });
        return;
      }
    }

    const usuario = await prisma.usuario.update({
      where: { id: req.params.id as string },
      data: { sectorId: parsed.data.sectorId },
      include: {
        sector: { select: { id: true, nombre: true } },
      },
    });

    const { passwordHash: _omit, ...safeUsuario } = usuario;
    res.json(safeUsuario);
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

    const { passwordHash: _omit, ...safeUsuario } = usuario;
    res.json(safeUsuario);
  } catch (error) {
    console.error('Error getting ficha:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /usuarios/:id/reset-password ───────────
// Admin resets a user's password to a temporary one, forcing change on next login

router.post('/:id/reset-password', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const usuario = await prisma.usuario.findFirst({
      where: { id: req.params.id as string, empresaId: req.user!.empresaId },
      select: { id: true, activo: true, nombre: true, apellido: true },
    });

    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    if (!usuario.activo) {
      res.status(400).json({ error: 'No se puede restablecer la contraseña de un usuario inactivo' });
      return;
    }

    if (req.params.id === req.user!.userId) {
      res.status(400).json({ error: 'No podés restablecer tu propia contraseña desde acá. Usá "Cambiar contraseña".' });
      return;
    }

    // Generate secure temporary password: 3 random words + 2 digits + '!'
    const words = [
      'Sol', 'Mar', 'Rio', 'Luz', 'Nube', 'Flor', 'Roca', 'Pino', 'Luna', 'Lago',
      'Cielo', 'Viento', 'Fuego', 'Trueno', 'Arena', 'Plata', 'Cobre', 'Hierro', 'Jade', 'Opalo',
      'Tigre', 'Halcon', 'Zorro', 'Lobo', 'Aguila', 'Coral', 'Roble', 'Cedro', 'Sauce', 'Olmo',
      'Norte', 'Cumbre', 'Valle', 'Monte', 'Costa', 'Delta', 'Pampa', 'Selva', 'Bosque', 'Pradera',
      'Brisa', 'Onda', 'Llama', 'Chispa', 'Rayo', 'Nieve', 'Lava', 'Perla', 'Ambar', 'Cuarzo',
    ];
    const pick = () => words[crypto.randomInt(words.length)];
    const tempPassword = `${pick()}${pick()}${pick()}${crypto.randomInt(10, 99)}!`;

    const passwordHash = await bcrypt.hash(tempPassword, 12);

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { passwordHash, primerLogin: true },
    });

    // Revoke all refresh tokens so user is forced to re-login
    await revokeAllRefreshTokensForUser(usuario.id);

    console.log(`[Admin Reset] ${req.user!.email} restableció contraseña de ${usuario.nombre} ${usuario.apellido}`);

    res.json({
      message: 'Contraseña restablecida correctamente',
      tempPassword,
      usuario: { nombre: usuario.nombre, apellido: usuario.apellido },
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
