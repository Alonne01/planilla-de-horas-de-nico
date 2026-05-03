import { Router, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_COORDINADOR } from '../middleware/roles.middleware.js';
import { crearNotificacion } from '../utils/notificacion.utils.js';
import { inyectarDiasBloqueados } from '../utils/ausencia-calendar.utils.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── Schemas ─────────────────────────────────────

const createSesionSchema = z.object({
  tipoId: z.string().uuid(),
  titulo: z.string().min(1).max(200),
  descripcion: z.string().max(1000).nullable().optional(),
  fecha: z.string(),
  horaInicio: z.string().max(5).nullable().optional(),
  horaFin: z.string().max(5).nullable().optional(),
  lugar: z.string().max(200).nullable().optional(),
  vacantes: z.number().int().min(1),
});

const invitarSchema = z.object({
  usuarioIds: z.array(z.string().uuid()).min(1),
});

// ─── Helper: get subordinates for current user ───

async function getSubordinateIds(userId: string, empresaId: string, userNivel: number): Promise<string[]> {
  if (userNivel >= 90) {
    const all = await prisma.usuario.findMany({
      where: { empresaId, activo: true, id: { not: userId } },
      select: { id: true },
    });
    return all.map(u => u.id);
  }

  const subs = await prisma.usuario.findMany({
    where: {
      empresaId, activo: true,
      OR: [{ supervisorId: userId }, { coordinadorId: userId }],
    },
    select: { id: true },
  });
  const ids = subs.map(u => u.id);

  if (userNivel >= 70) {
    const me = await prisma.usuario.findUnique({ where: { id: userId }, select: { sectorId: true } });
    if (me?.sectorId) {
      const sectorUsers = await prisma.usuario.findMany({
        where: { sectorId: me.sectorId, empresaId, activo: true, id: { not: userId } },
        select: { id: true },
      });
      sectorUsers.forEach(u => { if (!ids.includes(u.id)) ids.push(u.id); });
    }
  }

  return ids;
}

// ══════════════════════════════════════════════════
// COORDINADOR+ ENDPOINTS (manage sessions)
// ══════════════════════════════════════════════════

// ─── GET / — List sessions (filtered by role/sector) ───

router.get('/', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const empresaId = req.user!.empresaId;
    const userNivel = req.user!.rolNivel ?? 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { empresaId };

    // Non-RRHH see only sessions they organized or sessions in their sector
    if (userNivel < 90) {
      const me = await prisma.usuario.findUnique({ where: { id: userId }, select: { sectorId: true } });
      if (me?.sectorId) {
        where.OR = [
          { organizadorId: userId },
          { organizador: { sectorId: me.sectorId } },
        ];
      } else {
        where.organizadorId = userId;
      }
    }

    const { estado, tipoId } = req.query;
    if (estado) where.estado = estado;
    if (tipoId) where.tipoId = tipoId;

    const sesiones = await prisma.sesionCapacitacion.findMany({
      where,
      include: {
        tipo: { select: { id: true, nombre: true } },
        organizador: { select: { id: true, nombre: true, apellido: true } },
        invitaciones: {
          include: { usuario: { select: { id: true, nombre: true, apellido: true, legajo: true } } },
        },
        _count: { select: { invitaciones: true } },
      },
      orderBy: { fecha: 'desc' },
    });

    const result = sesiones.map(s => {
      const aceptadas = s.invitaciones.filter(i => i.estado === 'ACEPTADA').length;
      const pendientes = s.invitaciones.filter(i => i.estado === 'PENDIENTE').length;
      const rechazadas = s.invitaciones.filter(i => i.estado === 'RECHAZADA').length;
      return { ...s, stats: { aceptadas, pendientes, rechazadas, total: s.invitaciones.length } };
    });

    res.json(result);
  } catch (error) {
    console.error('Error listing sesiones:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST / — Create session ─────────────────────

router.post('/', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createSesionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const sesion = await prisma.sesionCapacitacion.create({
      data: {
        empresaId: req.user!.empresaId,
        tipoId: parsed.data.tipoId,
        organizadorId: req.user!.userId,
        titulo: parsed.data.titulo,
        descripcion: parsed.data.descripcion ?? null,
        fecha: new Date(parsed.data.fecha),
        horaInicio: parsed.data.horaInicio ?? null,
        horaFin: parsed.data.horaFin ?? null,
        lugar: parsed.data.lugar ?? null,
        vacantes: parsed.data.vacantes,
      },
      include: {
        tipo: { select: { nombre: true } },
        organizador: { select: { nombre: true, apellido: true } },
      },
    });

    res.status(201).json(sesion);
  } catch (error) {
    console.error('Error creating sesion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /:id — Update session ───────────────────

router.put('/:id', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createSesionSchema.partial().parse(req.body);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = { ...data };
    if (data.fecha) updateData.fecha = new Date(data.fecha);

    const sesion = await prisma.sesionCapacitacion.update({
      where: { id: req.params.id },
      data: updateData,
      include: { tipo: { select: { nombre: true } } },
    });
    res.json(sesion);
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Sesión no encontrada' }); return; }
    console.error('Error updating sesion:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /:id — Cancel/delete session ─────────

router.delete('/:id', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sesion = await prisma.sesionCapacitacion.findUnique({
      where: { id: req.params.id },
      include: { invitaciones: { where: { estado: 'ACEPTADA' }, include: { usuario: true } } },
    });
    if (!sesion) { res.status(404).json({ error: 'Sesión no encontrada' }); return; }

    // Notify accepted invitees about cancellation
    for (const inv of sesion.invitaciones) {
      await crearNotificacion({
        usuarioId: inv.usuarioId,
        tipo: 'CAPACITACION',
        titulo: '❌ Capacitación cancelada',
        cuerpo: `La sesión "${sesion.titulo}" del ${new Date(sesion.fecha).toLocaleDateString('es-AR')} fue cancelada.`,
        link: '/capacitaciones',
      });
    }

    await prisma.sesionCapacitacion.update({
      where: { id: req.params.id },
      data: { estado: 'CANCELADA' },
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error cancelling sesion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /subordinados — List available subordinates to invite ───

router.get('/subordinados', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ids = await getSubordinateIds(req.user!.userId, req.user!.empresaId, req.user!.rolNivel ?? 0);
    const subordinados = await prisma.usuario.findMany({
      where: { id: { in: ids }, activo: true },
      select: { id: true, nombre: true, apellido: true, legajo: true, sector: { select: { nombre: true } } },
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    });
    res.json(subordinados);
  } catch (error) {
    console.error('Error listing subordinados:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /:id/invitar — Invite subordinates to session ───

router.post('/:id/invitar', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = invitarSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos' });
      return;
    }

    const sesion = await prisma.sesionCapacitacion.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { invitaciones: true } } },
    });
    if (!sesion || sesion.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Sesión no encontrada' });
      return;
    }
    if (sesion.estado === 'CANCELADA' || sesion.estado === 'FINALIZADA') {
      res.status(400).json({ error: 'La sesión no acepta nuevas invitaciones' });
      return;
    }

    // Check vacancy limit
    const currentInvites = sesion._count.invitaciones;
    const newTotal = currentInvites + parsed.data.usuarioIds.length;
    if (newTotal > sesion.vacantes) {
      res.status(400).json({
        error: `No se pueden invitar ${parsed.data.usuarioIds.length} personas. Vacantes disponibles: ${sesion.vacantes - currentInvites} de ${sesion.vacantes}`,
      });
      return;
    }

    // Validate all users are subordinates
    const allowedIds = await getSubordinateIds(req.user!.userId, req.user!.empresaId, req.user!.rolNivel ?? 0);
    const invalidIds = parsed.data.usuarioIds.filter(id => !allowedIds.includes(id));
    if (invalidIds.length > 0) {
      res.status(403).json({ error: 'No tiene permisos para invitar a algunos empleados' });
      return;
    }

    const createdInvitations = [];
    const organizador = await prisma.usuario.findUnique({
      where: { id: req.user!.userId },
      select: { nombre: true, apellido: true },
    });
    const orgNombre = organizador ? `${organizador.nombre} ${organizador.apellido}` : 'Un coordinador';
    const fechaStr = new Date(sesion.fecha).toLocaleDateString('es-AR');

    for (const usuarioId of parsed.data.usuarioIds) {
      try {
        const inv = await prisma.invitacionCapacitacion.create({
          data: { sesionId: sesion.id, usuarioId },
          include: { usuario: { select: { id: true, nombre: true, apellido: true } } },
        });
        createdInvitations.push(inv);

        // Notify the invited employee
        await crearNotificacion({
          usuarioId,
          tipo: 'CAPACITACION',
          titulo: '📚 Invitación a capacitación',
          cuerpo: `${orgNombre} te invitó a "${sesion.titulo}" el ${fechaStr}. Confirmá tu asistencia.`,
          link: '/capacitaciones',
        });
      } catch (err: any) {
        // Skip duplicates (already invited)
        if (err.code !== 'P2002') throw err;
      }
    }

    // Check if vacancies are filled
    const totalAceptadas = await prisma.invitacionCapacitacion.count({
      where: { sesionId: sesion.id, estado: 'ACEPTADA' },
    });
    if (totalAceptadas >= sesion.vacantes) {
      await prisma.sesionCapacitacion.update({
        where: { id: sesion.id },
        data: { estado: 'COMPLETA' },
      });
    }

    res.status(201).json(createdInvitations);
  } catch (error) {
    console.error('Error inviting to sesion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /:id/invitaciones/:invId — Remove invitation ───

router.delete('/:id/invitaciones/:invId', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.invitacionCapacitacion.delete({ where: { id: req.params.invId } });
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === 'P2025') { res.status(404).json({ error: 'Invitación no encontrada' }); return; }
    console.error('Error removing invitation:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ══════════════════════════════════════════════════
// EMPLOYEE ENDPOINTS (respond to invitations)
// ══════════════════════════════════════════════════

// ─── GET /mis-invitaciones — Employee's pending invitations ───

router.get('/mis-invitaciones', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const invitaciones = await prisma.invitacionCapacitacion.findMany({
      where: { usuarioId: req.user!.userId },
      include: {
        sesion: {
          include: {
            tipo: { select: { nombre: true } },
            organizador: { select: { nombre: true, apellido: true } },
          },
        },
      },
      orderBy: { sesion: { fecha: 'desc' } },
    });
    res.json(invitaciones);
  } catch (error) {
    console.error('Error fetching mis invitaciones:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /mis-invitaciones/:invId/responder — Accept or reject invitation ───

router.post('/mis-invitaciones/:invId/responder', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { aceptar, motivoRechazo } = req.body;
    if (typeof aceptar !== 'boolean') {
      res.status(400).json({ error: 'Se requiere el campo "aceptar" (boolean)' });
      return;
    }

    const inv = await prisma.invitacionCapacitacion.findUnique({
      where: { id: req.params.invId },
      include: {
        sesion: { include: { organizador: { select: { id: true } } } },
        usuario: { select: { nombre: true, apellido: true } },
      },
    });

    if (!inv || inv.usuarioId !== req.user!.userId) {
      res.status(404).json({ error: 'Invitación no encontrada' });
      return;
    }
    if (inv.estado !== 'PENDIENTE') {
      res.status(400).json({ error: 'Ya respondiste a esta invitación' });
      return;
    }

    // Accepting: vacancy check + update must be atomic to prevent over-acceptance
    let updated;
    if (aceptar) {
      try {
        updated = await prisma.$transaction(
          async (tx) => {
            const aceptadas = await tx.invitacionCapacitacion.count({
              where: { sesionId: inv.sesionId, estado: 'ACEPTADA' },
            });
            if (aceptadas >= inv.sesion.vacantes) {
              throw new Error('NO_VACANCIES');
            }
            return tx.invitacionCapacitacion.update({
              where: { id: inv.id },
              data: { estado: 'ACEPTADA', respondidoAt: new Date(), motivoRechazo: null },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (err: any) {
        if (err?.message === 'NO_VACANCIES') {
          res.status(400).json({ error: 'Ya no hay vacantes disponibles en esta sesión' });
          return;
        }
        // P2034 = serialization failure due to concurrent acceptance — surface as conflict
        if (err?.code === 'P2034') {
          res.status(409).json({ error: 'Conflicto al procesar la aceptación, intentá de nuevo' });
          return;
        }
        throw err;
      }
    } else {
      updated = await prisma.invitacionCapacitacion.update({
        where: { id: inv.id },
        data: { estado: 'RECHAZADA', respondidoAt: new Date(), motivoRechazo: motivoRechazo || null },
      });
    }

    const empleadoNombre = `${inv.usuario.nombre} ${inv.usuario.apellido}`;
    const fechaStr = new Date(inv.sesion.fecha).toLocaleDateString('es-AR');

    // Notify the organizer
    await crearNotificacion({
      usuarioId: inv.sesion.organizador.id,
      tipo: 'CAPACITACION',
      titulo: aceptar ? '✅ Invitación aceptada' : '❌ Invitación rechazada',
      cuerpo: aceptar
        ? `${empleadoNombre} aceptó la capacitación "${inv.sesion.titulo}" del ${fechaStr}.`
        : `${empleadoNombre} rechazó la capacitación "${inv.sesion.titulo}" del ${fechaStr}.${motivoRechazo ? ` Motivo: ${motivoRechazo}` : ''}`,
      link: '/capacitaciones',
    });

    // If vacancies full after acceptance, mark session as COMPLETA
    if (aceptar) {
      const totalAceptadas = await prisma.invitacionCapacitacion.count({
        where: { sesionId: inv.sesionId, estado: 'ACEPTADA' },
      });
      if (totalAceptadas >= inv.sesion.vacantes) {
        await prisma.sesionCapacitacion.update({
          where: { id: inv.sesionId },
          data: { estado: 'COMPLETA' },
        });
      }
    }

    res.json(updated);
  } catch (error) {
    console.error('Error responding to invitation:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /:id/finalizar — Mark session as finished, create training records + lock planilla days ───

router.post('/:id/finalizar', requireLevel(LEVEL_COORDINADOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sesion = await prisma.sesionCapacitacion.findUnique({
      where: { id: req.params.id },
      include: {
        tipo: true,
        invitaciones: {
          where: { estado: 'ACEPTADA' },
          include: { usuario: { select: { id: true, nombre: true, apellido: true } } },
        },
      },
    });

    if (!sesion || sesion.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Sesión no encontrada' });
      return;
    }
    if (sesion.estado === 'FINALIZADA') {
      res.status(400).json({ error: 'La sesión ya fue finalizada' });
      return;
    }

    // Mark attendance from body { asistieron: [userId1, userId2, ...] }
    const { asistieron } = req.body as { asistieron?: string[] };
    const asistieronIds = asistieron ?? sesion.invitaciones.map(i => i.usuarioId);

    for (const inv of sesion.invitaciones) {
      const didAttend = asistieronIds.includes(inv.usuarioId);

      // Update attendance
      await prisma.invitacionCapacitacion.update({
        where: { id: inv.id },
        data: { asistio: didAttend },
      });

      if (didAttend) {
        // Create EmpleadoCapacitacion record
        let fechaVencimiento: Date | null = null;
        if (sesion.tipo.vigenciaDias) {
          fechaVencimiento = new Date(sesion.fecha);
          fechaVencimiento.setDate(fechaVencimiento.getDate() + sesion.tipo.vigenciaDias);
        }

        await prisma.empleadoCapacitacion.create({
          data: {
            usuarioId: inv.usuarioId,
            tipoId: sesion.tipoId,
            fechaRealizacion: sesion.fecha,
            fechaVencimiento,
            institucion: sesion.lugar ?? null,
            observaciones: `Sesión: ${sesion.titulo}`,
          },
        });

        // Lock the day in the employee's planilla as "CAPACITACION"
        await inyectarDiasBloqueados({
          usuarioId: inv.usuarioId,
          fechaInicio: sesion.fecha,
          fechaFin: sesion.fecha,
          motivoBloqueo: 'CAPACITACION',
          observaciones: `Capacitación: ${sesion.titulo}${sesion.horaInicio ? ` (${sesion.horaInicio}–${sesion.horaFin ?? ''})` : ''}`,
        });

        // Notify attendee
        await crearNotificacion({
          usuarioId: inv.usuarioId,
          tipo: 'CAPACITACION',
          titulo: '🎓 Capacitación completada',
          cuerpo: `Se registró tu asistencia a "${sesion.titulo}". Ya se reflejó en tu planilla de horas.`,
          link: '/capacitaciones',
        });
      }
    }

    await prisma.sesionCapacitacion.update({
      where: { id: sesion.id },
      data: { estado: 'FINALIZADA' },
    });

    res.json({ ok: true, asistieron: asistieronIds.length });
  } catch (error) {
    console.error('Error finalizing sesion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
