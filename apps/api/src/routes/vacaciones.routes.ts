import { Router, Response } from 'express';
import { PrismaClient, Prisma, VacacionEstado } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_SUPERVISOR } from '../middleware/roles.middleware.js';
import { inyectarDiasBloqueados } from '../utils/ausencia-calendar.utils.js';
import { notificarVacacion, notificarAprobadoresPaso } from '../utils/notificacion.utils.js';
import { isResponsibleApprover } from '../utils/approval-auth.utils.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── Schemas ─────────────────────────────────────

const createVacacionSchema = z.object({
  fechaInicio: z.string(),
  fechaFin: z.string(),
  diasHabiles: z.number().int().min(1),
  motivo: z.string().max(500).optional(),
});

// ─── Helper: calculate vacation days by LCT seniority ─────────
function diasPorAntiguedad(fechaIngreso: Date, anio: number): number {
  const alDic31 = new Date(anio, 11, 31);
  let anios = alDic31.getFullYear() - fechaIngreso.getFullYear();
  const aniv = new Date(anio, fechaIngreso.getMonth(), fechaIngreso.getDate());
  if (alDic31 < aniv) anios--;
  if (anios < 0) anios = 0;
  if (anios <= 5) return 14;
  if (anios <= 10) return 21;
  if (anios <= 20) return 28;
  return 35;
}

// ─── GET /vacaciones/saldo ───────────────────────

router.get('/saldo', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const anio = new Date().getFullYear();

    // Try to find existing saldo for this year
    let saldo = await prisma.vacacionSaldo.findUnique({
      where: { usuarioId_anio: { usuarioId: userId, anio } },
    });

    // Auto-create if it doesn't exist
    if (!saldo) {
      const usuario = await prisma.usuario.findUnique({
        where: { id: userId },
        select: { fechaIngreso: true },
      });
      if (!usuario) {
        res.status(404).json({ error: 'Usuario no encontrado' });
        return;
      }
      const dias = diasPorAntiguedad(usuario.fechaIngreso, anio);
      saldo = await prisma.vacacionSaldo.create({
        data: { usuarioId: userId, anio, diasCorrespondientes: dias },
      });
    }

    const total = saldo.diasCorrespondientes + saldo.diasAjuste;
    const disponible = total - saldo.diasUsados - saldo.diasPendientes;

    res.json({
      disponible: Math.max(0, disponible),
      usados: saldo.diasUsados,
      pendiente: saldo.diasPendientes,
      total,
    });
  } catch (error) {
    console.error('Error getting saldo:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /vacaciones/gantt — Calendar view for team (vacaciones + ausencias + capacitaciones) ──

router.get('/gantt', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userNivel = req.user!.rolNivel ?? 0;
    const userId = req.user!.userId;
    const empresaId = req.user!.empresaId;

    // Only COORDINADOR+ can see team gantt
    if (userNivel < 70) {
      res.status(403).json({ error: 'Sin permisos' });
      return;
    }

    const { anio, sectorId } = req.query;
    const year = anio ? Number(anio) : new Date().getFullYear();
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59);

    const userWhere: any = { empresaId };
    // Below RRHH (< 90): force own sector only. RRHH+ can filter or see all.
    if (userNivel < 90) {
      const me = await prisma.usuario.findUnique({ where: { id: userId }, select: { sectorId: true } });
      if (me?.sectorId) userWhere.sectorId = me.sectorId;
    } else if (sectorId) {
      userWhere.sectorId = sectorId as string;
    }

    // 1. Fetch vacaciones
    const vacaciones = await prisma.vacacion.findMany({
      where: {
        usuario: userWhere,
        fechaInicio: { lte: endDate },
        fechaFin: { gte: startDate },
        estado: { in: ['PENDIENTE', 'EN_REVISION', 'APROBADA'] },
      },
      select: {
        id: true, fechaInicio: true, fechaFin: true, diasTotales: true,
        estado: true, motivo: true,
        usuario: {
          select: { id: true, nombre: true, apellido: true, legajo: true,
            sector: { select: { id: true, nombre: true } } },
        },
      },
      orderBy: [{ usuario: { apellido: 'asc' } }, { fechaInicio: 'asc' }],
    });

    // 2. Fetch ausencias
    const ausencias = await prisma.ausencia.findMany({
      where: {
        usuario: userWhere,
        fechaInicio: { lte: endDate },
        fechaFin: { gte: startDate },
        estado: { in: ['PENDIENTE', 'EN_REVISION', 'APROBADA'] },
      },
      select: {
        id: true, fechaInicio: true, fechaFin: true, diasAusencia: true,
        estado: true, tipo: true, descripcion: true,
        usuario: {
          select: { id: true, nombre: true, apellido: true, legajo: true,
            sector: { select: { id: true, nombre: true } } },
        },
      },
      orderBy: [{ usuario: { apellido: 'asc' } }, { fechaInicio: 'asc' }],
    });

    // 3. Fetch capacitaciones (training sessions with accepted/attended invitations)
    const invitaciones = await prisma.invitacionCapacitacion.findMany({
      where: {
        estado: { in: ['ACEPTADA', 'PENDIENTE'] },
        sesion: {
          empresaId,
          fecha: { gte: startDate, lte: endDate },
          estado: { notIn: ['CANCELADA'] },
        },
        usuario: userWhere,
      },
      select: {
        id: true, estado: true, asistio: true,
        usuario: {
          select: { id: true, nombre: true, apellido: true, legajo: true,
            sector: { select: { id: true, nombre: true } } },
        },
        sesion: {
          select: { id: true, titulo: true, fecha: true, horaInicio: true, horaFin: true,
            tipo: { select: { nombre: true } } },
        },
      },
    });

    // Group everything by employee
    type Block = {
      id: string; fechaInicio: string; fechaFin: string;
      dias: number; estado: string; tipo: string; detalle: string | null;
    };
    type EmpleadoGantt = {
      id: string; nombre: string; apellido: string; legajo: string | null;
      sector: { id: string; nombre: string } | null;
      bloques: Block[];
    };

    const empleadoMap = new Map<string, EmpleadoGantt>();

    const ensureEmp = (u: { id: string; nombre: string; apellido: string; legajo: string | null; sector: { id: string; nombre: string } | null }) => {
      if (!empleadoMap.has(u.id)) {
        empleadoMap.set(u.id, { ...u, bloques: [] });
      }
      return empleadoMap.get(u.id)!;
    };

    // Add vacaciones blocks
    for (const v of vacaciones) {
      const emp = ensureEmp(v.usuario);
      emp.bloques.push({
        id: v.id, tipo: 'VACACION',
        fechaInicio: (v.fechaInicio as Date).toISOString(),
        fechaFin: (v.fechaFin as Date).toISOString(),
        dias: v.diasTotales, estado: v.estado,
        detalle: v.motivo,
      });
    }

    // Add ausencias blocks
    const TIPO_LABELS: Record<string, string> = {
      CERTIFICADO_MEDICO: 'Certificado médico',
      FALTA_INJUSTIFICADA: 'Falta injustificada',
      FALTA_JUSTIFICADA: 'Falta justificada',
      LICENCIA_ESPECIAL: 'Licencia especial',
      FRANCO_COMPENSATORIO: 'Franco compensatorio',
      ACCIDENTE_TRABAJO: 'Accidente de trabajo',
      LICENCIA_GREMIAL: 'Lic. gremial',
      SUSPENSION: 'Suspensión',
    };

    for (const a of ausencias) {
      const emp = ensureEmp(a.usuario);
      emp.bloques.push({
        id: a.id, tipo: `AUSENCIA_${a.tipo}`,
        fechaInicio: (a.fechaInicio as Date).toISOString(),
        fechaFin: (a.fechaFin as Date).toISOString(),
        dias: a.diasAusencia, estado: a.estado,
        detalle: a.descripcion || TIPO_LABELS[a.tipo] || a.tipo,
      });
    }

    // Add capacitacion blocks
    for (const inv of invitaciones) {
      const emp = ensureEmp(inv.usuario);
      const fecha = (inv.sesion.fecha as Date).toISOString();
      emp.bloques.push({
        id: inv.id, tipo: 'CAPACITACION',
        fechaInicio: fecha, fechaFin: fecha,
        dias: 1,
        estado: inv.estado === 'ACEPTADA' ? 'APROBADA' : 'PENDIENTE',
        detalle: inv.sesion.titulo || inv.sesion.tipo?.nombre || 'Capacitación',
      });
    }

    // Sort employees by apellido, blocks by date
    const empleados = Array.from(empleadoMap.values())
      .sort((a, b) => a.apellido.localeCompare(b.apellido));
    for (const emp of empleados) {
      emp.bloques.sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio));
    }

    const sectores = await prisma.sector.findMany({
      where: { empresaId },
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });

    res.json({ anio: year, sectores, empleados });
  } catch (err) {
    console.error('Error fetching gantt:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /vacaciones ─────────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userNivel = req.user!.rolNivel ?? 0;
    const userId = req.user!.userId;
    const empresaId = req.user!.empresaId;
    const scope = req.query.scope as string | undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let where: any = {};

    if (scope === 'mio') {
      // Only own records
      where = { usuarioId: userId };
    } else if (userNivel >= 90) {
      // RRHH/ADMIN: see all vacations in the company
      where = { usuario: { empresaId } };
    } else if (userNivel >= 60) {
      // SUPERVISOR/COORDINADOR/GERENTE: see own + subordinates'
      // Get IDs of users they supervise or coordinate
      const subordinados = await prisma.usuario.findMany({
        where: {
          empresaId,
          activo: true,
          OR: [
            { supervisorId: userId },
            { coordinadorId: userId },
          ],
        },
        select: { id: true },
      });
      const subIds = subordinados.map((u: { id: string }) => u.id);
      // Also include same-sector if COORDINADOR and up
      const me = await prisma.usuario.findUnique({
        where: { id: userId },
        select: { sectorId: true },
      });
      const sectorFilter = me?.sectorId
        ? { usuario: { sectorId: me.sectorId, empresaId } }
        : null;

      where = {
        OR: [
          { usuarioId: userId },
          { usuarioId: { in: subIds } },
          ...(sectorFilter ? [sectorFilter] : []),
        ],
      };
    } else {
      // OPERADOR: own only
      where = { usuarioId: userId };
    }

    const periodoInicio = req.query.periodoInicio as string | undefined;
    const periodoFin = req.query.periodoFin as string | undefined;
    if (periodoInicio && periodoFin) {
      const fin = new Date(periodoFin); fin.setHours(23, 59, 59, 999);
      where = {
        AND: [
          where,
          {
            fechaInicio: {
              gte: new Date(periodoInicio),
              lte: fin,
            },
          },
        ],
      };
    }

    const vacaciones = await prisma.vacacion.findMany({
      where,
      include: {
        usuario: { select: { id: true, nombre: true, apellido: true, legajo: true, rol: true, sector: { select: { id: true, nombre: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(vacaciones);
  } catch (error) {
    console.error('Error listing vacaciones:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});


// ─── POST /vacaciones ────────────────────────────

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createVacacionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const userId = req.user!.userId;
    const empresaId = req.user!.empresaId;
    // Saldo year is always the year the request is CREATED (current year),
    // matching the POST logic with rejection/re-send routes that derive year from createdAt.
    const anio = new Date().getFullYear();

    // Check saldo from VacacionSaldo
    const usuario = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { fechaIngreso: true, sectorId: true },
    });
    if (!usuario) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }

    const fechaInicio = new Date(parsed.data.fechaInicio);
    const fechaFin = new Date(parsed.data.fechaFin);
    const diasTotales = Math.ceil((fechaFin.getTime() - fechaInicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Find applicable flow (read-only, outside transaction)
    // Priority-based flujo lookup: user-specific → sector → company-wide default
    let flujo = await prisma.flujoAprobacion.findFirst({
      where: {
        empresaId, tipoDocumento: 'VACACION', activo: true,
        asignaciones: { some: { usuarioId: userId, activo: true, tipoDocumento: 'VACACION' } },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (!flujo && usuario?.sectorId) {
      flujo = await prisma.flujoAprobacion.findFirst({
        where: {
          empresaId, tipoDocumento: 'VACACION', activo: true,
          asignaciones: { some: { sectorId: usuario.sectorId, activo: true, tipoDocumento: 'VACACION' } },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
    }

    if (!flujo) {
      flujo = await prisma.flujoAprobacion.findFirst({
        where: {
          empresaId, tipoDocumento: 'VACACION', activo: true,
          asignaciones: { some: { sectorId: null, usuarioId: null, activo: true, tipoDocumento: 'VACACION' } },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
    }

    const flujoId = flujo?.id ?? null;

    // Critical section: balance check + create atomically to prevent double-spend
    const vacacion = await prisma.$transaction(async (tx) => {
      let saldo = await tx.vacacionSaldo.findUnique({
        where: { usuarioId_anio: { usuarioId: userId, anio } },
      });
      if (!saldo) {
        saldo = await tx.vacacionSaldo.create({
          data: { usuarioId: userId, anio, diasCorrespondientes: diasPorAntiguedad(usuario.fechaIngreso, anio) },
        });
      }
      const disponible = saldo.diasCorrespondientes + saldo.diasAjuste - saldo.diasUsados - saldo.diasPendientes;
      // Balance is tracked in calendar days, consistent with diasUsados/diasPendientes on approval
      if (diasTotales > disponible) {
        throw Object.assign(new Error('SALDO_INSUFICIENTE'), { disponible });
      }

      const vac = await tx.vacacion.create({
        data: {
          usuarioId: userId,
          fechaInicio,
          fechaFin,
          diasHabiles: parsed.data.diasHabiles,
          diasTotales,
          motivo: parsed.data.motivo ?? null,
          flujoId,
          estado: 'PENDIENTE',
          pasoActual: 1,
        },
      });

      await tx.vacacionHistorial.create({
        data: {
          vacacionId: vac.id,
          usuarioId: userId,
          estadoNuevo: 'PENDIENTE',
          comentario: 'Solicitud enviada automáticamente',
        },
      });

      await tx.vacacionSaldo.update({
        where: { usuarioId_anio: { usuarioId: userId, anio } },
        data: { diasPendientes: { increment: diasTotales } },
      });

      return vac;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    res.status(201).json(vacacion);
  } catch (error) {
    if (error instanceof Error && error.message === 'SALDO_INSUFICIENTE') {
      res.status(400).json({ error: `Saldo insuficiente. Disponible: ${(error as Error & { disponible: number }).disponible} días` });
      return;
    }
    if ((error as { code?: string }).code === 'P2034') {
      res.status(409).json({ error: 'Conflicto de transacción, intente de nuevo' });
      return;
    }
    console.error('Error creating vacacion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /vacaciones/:id ─────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vacId = req.params.id as string;
    const userId = req.user!.userId;
    const empresaId = req.user!.empresaId;
    const userNivel = req.user!.rolNivel ?? 0;

    const vacacion = await prisma.vacacion.findUnique({
      where: { id: vacId },
      include: {
        usuario: { select: { id: true, nombre: true, apellido: true, empresaId: true, sector: { select: { nombre: true } } } },
        flujo: { select: { nombre: true, pasos: { orderBy: { orden: 'asc' } } } },
        historial: {
          include: { usuario: { select: { nombre: true, apellido: true, rol: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!vacacion) {
      res.status(404).json({ error: 'Vacación no encontrada' });
      return;
    }
    // Authorization: owner, same-company supervisor+, or RRHH/ADMIN
    const isOwner = vacacion.usuario.id === userId;
    const isSameCompany = vacacion.usuario.empresaId === empresaId;
    const isSuperiorOrRRHH = userNivel >= 60;
    if (!isOwner && !(isSameCompany && isSuperiorOrRRHH)) {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }
    res.json(vacacion);
  } catch (error) {
    console.error('Error getting vacacion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /vacaciones/:id/enviar ─────────────────

router.post('/:id/enviar', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vacId = req.params.id as string;
    const vacacion = await prisma.vacacion.findFirst({
      where: { id: vacId, usuarioId: req.user!.userId },
    });
    if (!vacacion) {
      res.status(404).json({ error: 'Vacación no encontrada' });
      return;
    }
    if (vacacion.estado !== 'BORRADOR' && vacacion.estado !== 'RECHAZADA') {
      res.status(400).json({ error: 'Solo se puede enviar en BORRADOR o RECHAZADA' });
      return;
    }

    // Re-submitting from RECHAZADA: re-add dias to pending balance (rejection decremented it)
    // Also re-validate available balance — user may have spent days since rejection
    // Use createdAt year (matches POST creation logic) to avoid mismatch with fechaInicio year
    const anioEnviar = new Date(vacacion.createdAt).getFullYear();
    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        if (vacacion.estado === 'RECHAZADA') {
          let saldo = await tx.vacacionSaldo.findUnique({
            where: { usuarioId_anio: { usuarioId: vacacion.usuarioId, anio: anioEnviar } },
          });
          if (!saldo) {
            const u = await tx.usuario.findUnique({ where: { id: vacacion.usuarioId }, select: { fechaIngreso: true } });
            saldo = await tx.vacacionSaldo.create({
              data: { usuarioId: vacacion.usuarioId, anio: anioEnviar, diasCorrespondientes: diasPorAntiguedad(u!.fechaIngreso, anioEnviar) },
            });
          }
          const disponible = saldo.diasCorrespondientes + saldo.diasAjuste - saldo.diasUsados - saldo.diasPendientes;
          if (vacacion.diasTotales > disponible) {
            throw Object.assign(new Error('SALDO_INSUFICIENTE'), { disponible });
          }
          await tx.vacacionSaldo.update({
            where: { usuarioId_anio: { usuarioId: vacacion.usuarioId, anio: anioEnviar } },
            data: { diasPendientes: { increment: vacacion.diasTotales } },
          });
        }
        return tx.vacacion.update({
          where: { id: vacId },
          data: { estado: 'PENDIENTE', pasoActual: 1, obsRechazo: null },
        });
      });
    } catch (err: any) {
      if (err?.message === 'SALDO_INSUFICIENTE') {
        res.status(400).json({ error: `Saldo insuficiente para re-enviar. Disponible: ${err.disponible} días` });
        return;
      }
      throw err;
    }

    await prisma.vacacionHistorial.create({
      data: {
        vacacionId: vacId,
        usuarioId: req.user!.userId,
        estadoAnterior: vacacion.estado,
        estadoNuevo: 'PENDIENTE',
      },
    });

    // Notify step 1 approvers
    const solicitante = await prisma.usuario.findUnique({
      where: { id: req.user!.userId },
      select: { nombre: true, apellido: true },
    });
    const solicitanteNombre = solicitante ? `${solicitante.nombre} ${solicitante.apellido}` : 'Un empleado';
    await notificarAprobadoresPaso(
      vacacion.usuarioId, req.user!.empresaId, vacacion.flujoId, 1, 'VACACION', solicitanteNombre,
    );

    res.json(updated);
  } catch (error) {
    console.error('Error al enviar vacacion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /vacaciones/:id/avanzar ────────────────

router.post('/:id/avanzar', requireLevel(LEVEL_SUPERVISOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vacId = req.params.id as string;
    const vacacion = await prisma.vacacion.findUnique({
      where: { id: vacId },
      include: {
        flujo: { include: { pasos: { orderBy: { orden: 'asc' } } } },
        usuario: { select: { id: true, empresaId: true, diasVacacionesUsados: true, sectorId: true, supervisorId: true, coordinadorId: true } },
      },
    });

    if (!vacacion || vacacion.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Vacación no encontrada' });
      return;
    }
    if (vacacion.estado !== 'PENDIENTE' && vacacion.estado !== 'EN_REVISION') {
      res.status(400).json({ error: 'La vacación no está pendiente de revisión' });
      return;
    }

    const pasos = vacacion.flujo?.pasos ?? [];
    const totalPasos = pasos.length;
    const pasoActual = vacacion.pasoActual;
    let nuevoEstado: VacacionEstado;
    let nuevoPaso: number;

    // pasoActual is 1-based (matches FlujoPaso.orden)
    if (pasoActual > totalPasos || totalPasos === 0) {
      nuevoEstado = 'APROBADA';
      nuevoPaso = pasoActual;
    } else {
      const pasoConfig = pasos.find(p => p.orden === pasoActual);
      if (!pasoConfig) {
        res.status(500).json({ error: `Configuración de paso ${pasoActual} no encontrada en el flujo` });
        return;
      }
      const approverSectorId = (await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { sectorId: true } }))?.sectorId ?? null;
      if (!isResponsibleApprover(pasoConfig.rolAprobador, vacacion.usuario, req.user!.userId, req.user!.rol, req.user!.rolNivel ?? 0, approverSectorId)) {
        res.status(403).json({ error: `No tenés autorización para aprobar esta vacación en el paso de ${pasoConfig.rolAprobador}` });
        return;
      }

      nuevoPaso = pasoActual + 1;
      nuevoEstado = nuevoPaso > totalPasos ? 'APROBADA' : 'EN_REVISION';
    }

    // Atomic: optimistic concurrency + duplicate check inside transaction
    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        // Optimistic concurrency: only advance if pasoActual hasn't changed
        const { count } = await tx.vacacion.updateMany({
          where: { id: vacId, pasoActual: pasoActual },
          data: {
            estado: nuevoEstado,
            pasoActual: nuevoPaso,
            ...(nuevoEstado === 'APROBADA' ? { aprobadaPorId: req.user!.userId, aprobadaAt: new Date() } : {}),
          },
        });
        if (count === 0) throw new Error('CONCURRENT_MODIFICATION');

        // Duplicate check inside tx scoped to current submission
        const lastSubmission = await tx.vacacionHistorial.findFirst({
          where: { vacacionId: vacId, estadoNuevo: 'PENDIENTE' },
          orderBy: { createdAt: 'desc' },
        });
        const yaAprobo = await tx.vacacionHistorial.findFirst({
          where: {
            vacacionId: vacId,
            usuarioId: req.user!.userId,
            pasoFlujo: nuevoPaso,
            createdAt: { gt: lastSubmission?.createdAt ?? new Date(0) },
          },
        });
        if (yaAprobo) {
          throw new Error('DUPLICATE_APPROVAL');
        }

        // Balance mutation inside transaction
        if (nuevoEstado === 'APROBADA') {
          // Use createdAt year — matches POST creation saldo year, avoids fechaInicio year mismatch
          const anioVac = new Date(vacacion.createdAt).getFullYear();
          await tx.vacacionSaldo.upsert({
            where: { usuarioId_anio: { usuarioId: vacacion.usuario.id, anio: anioVac } },
            update: {
              diasUsados: { increment: vacacion.diasTotales },
              diasPendientes: { decrement: vacacion.diasTotales },
            },
            create: {
              usuarioId: vacacion.usuario.id,
              anio: anioVac,
              diasCorrespondientes: 14,
              diasUsados: vacacion.diasTotales,
              diasPendientes: 14 - vacacion.diasTotales,
            },
          });
        }

        await tx.vacacionHistorial.create({
          data: {
            vacacionId: vacId,
            usuarioId: req.user!.userId,
            estadoAnterior: vacacion.estado,
            estadoNuevo: nuevoEstado,
            pasoFlujo: nuevoPaso,
            comentario: req.body?.comentario ?? null,
          },
        });

        return tx.vacacion.findUnique({ where: { id: vacId } });
      });
    } catch (error: any) {
      if (error?.message === 'DUPLICATE_APPROVAL') {
        res.status(409).json({ error: 'Ya aprobaste este paso. No se puede aprobar dos veces.' });
        return;
      }
      if (error?.message === 'CONCURRENT_MODIFICATION') {
        res.status(409).json({ error: 'La solicitud fue modificada por otro aprobador. Recargue la página.' });
        return;
      }
      throw error;
    }

    // Inject locked days outside transaction (idempotent)
    if (nuevoEstado === 'APROBADA') {
      await inyectarDiasBloqueados({
        usuarioId: vacacion.usuario.id,
        fechaInicio: vacacion.fechaInicio,
        fechaFin: vacacion.fechaFin,
        motivoBloqueo: 'VACACION',
        observaciones: `Vacaciones${vacacion.motivo ? ` — ${vacacion.motivo}` : ''}`,
      });
    }

    // Notify vacation requester
    const aprobador = await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { nombre: true, apellido: true } });
    const aprobadorNombre = aprobador ? `${aprobador.nombre} ${aprobador.apellido}` : 'Un aprobador';
    await notificarVacacion(vacacion.usuarioId, nuevoEstado as 'APROBADA' | 'EN_REVISION', aprobadorNombre);

    // Notify next approver if advancing to another step
    if (nuevoEstado === 'EN_REVISION') {
      const ownerInfo = await prisma.usuario.findUnique({
        where: { id: vacacion.usuarioId },
        select: { nombre: true, apellido: true },
      });
      const ownerNombre = ownerInfo ? `${ownerInfo.nombre} ${ownerInfo.apellido}` : 'Un empleado';
      await notificarAprobadoresPaso(
        vacacion.usuarioId, req.user!.empresaId, vacacion.flujoId, nuevoPaso, 'VACACION', ownerNombre,
      );
    }

    res.json(updated);
  } catch (error) {
    console.error('Error al avanzar vacacion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /vacaciones/:id/rechazar ───────────────

router.post('/:id/rechazar', requireLevel(LEVEL_SUPERVISOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vacId = req.params.id as string;
    const { motivo } = req.body;
    if (!motivo) {
      res.status(400).json({ error: 'Se requiere un motivo de rechazo' });
      return;
    }

    const vacacion = await prisma.vacacion.findUnique({
      where: { id: vacId },
      include: {
        flujo: { include: { pasos: { orderBy: { orden: 'asc' } } } },
        usuario: { select: { id: true, empresaId: true, sectorId: true, supervisorId: true, coordinadorId: true } },
      },
    });

    if (!vacacion || vacacion.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Vacación no encontrada' });
      return;
    }

    // Verify the caller is the responsible approver for this step
    const pasos = vacacion.flujo?.pasos ?? [];
    const currentStep = pasos.find(p => p.orden === vacacion.pasoActual);
    const approverSectorId = (await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { sectorId: true } }))?.sectorId ?? null;
    if (!currentStep || !isResponsibleApprover(currentStep.rolAprobador, vacacion.usuario, req.user!.userId, req.user!.rol, req.user!.rolNivel ?? 0, approverSectorId)) {
      res.status(403).json({ error: 'No tenés autorización para rechazar esta vacación' });
      return;
    }

    // Atomically update vacation state and release pending days back to saldo
    // Uses optimistic concurrency (mirrors avanzar) to prevent double-decrement on race
    // Use createdAt year — consistent with POST creation that uses new Date().getFullYear()
    const anio = new Date(vacacion.createdAt).getFullYear();
    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        // Guard: only reject if still in a pending-review state
        const { count } = await tx.vacacion.updateMany({
          where: { id: vacId, estado: { in: ['PENDIENTE', 'EN_REVISION'] } },
          data: { estado: 'RECHAZADA', obsRechazo: motivo, pasoActual: 0 },
        });
        if (count === 0) throw new Error('CONCURRENT_MODIFICATION');

        await tx.vacacionSaldo.updateMany({
          where: { usuarioId: vacacion.usuarioId, anio },
          data: { diasPendientes: { decrement: vacacion.diasTotales } },
        });
        return tx.vacacion.findUnique({ where: { id: vacId } });
      });
    } catch (err: any) {
      if (err?.message === 'CONCURRENT_MODIFICATION') {
        res.status(409).json({ error: 'La vacación fue modificada simultáneamente. Recargue la página.' });
        return;
      }
      throw err;
    }

    await prisma.vacacionHistorial.create({
      data: {
        vacacionId: vacId,
        usuarioId: req.user!.userId,
        estadoAnterior: vacacion.estado,
        estadoNuevo: 'RECHAZADA',
        comentario: motivo,
      },
    });

    // Notify vacation requester
    const aprobador = await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { nombre: true, apellido: true } });
    const aprobadorNombre = aprobador ? `${aprobador.nombre} ${aprobador.apellido}` : 'Un aprobador';
    await notificarVacacion(vacacion.usuarioId, 'RECHAZADA', aprobadorNombre, motivo);

    res.json(updated);
  } catch (error) {
    console.error('Error al rechazar vacacion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /vacaciones/:id ──────────────────────
// RRHH/ADMIN can delete any vacacion; owner can delete their own BORRADOR or PENDIENTE vacacion.
// Deleting a PENDIENTE vacacion returns its diasPendientes to the saldo atomically.

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vacId = req.params.id as string;
    const userId = req.user!.userId;
    const empresaId = req.user!.empresaId;
    const userNivel = req.user!.rolNivel ?? 0;

    const vacacion = await prisma.vacacion.findUnique({
      where: { id: vacId },
      include: {
        usuario: { select: { id: true, empresaId: true } },
      },
    });

    if (!vacacion || vacacion.usuario.empresaId !== empresaId) {
      res.status(404).json({ error: 'Vacación no encontrada' });
      return;
    }

    const isOwner = vacacion.usuario.id === userId;
    const isRrhhOrAdmin = userNivel >= 90;

    // Authorization: owner can delete BORRADOR/PENDIENTE; RRHH/ADMIN can delete anything not APROBADA
    if (!isRrhhOrAdmin) {
      if (!isOwner) {
        res.status(403).json({ error: 'No autorizado' });
        return;
      }
      if (vacacion.estado !== 'BORRADOR' && vacacion.estado !== 'PENDIENTE' && vacacion.estado !== 'RECHAZADA') {
        res.status(400).json({ error: `No se puede eliminar una vacación en estado ${vacacion.estado}` });
        return;
      }
    } else {
      // RRHH/ADMIN restriction: cannot delete APROBADA (those are historical records)
      if (vacacion.estado === 'APROBADA') {
        res.status(400).json({ error: 'No se puede eliminar una vacación ya aprobada' });
        return;
      }
    }

    await prisma.$transaction(async (tx) => {
      // Re-fetch current state inside transaction to prevent TOCTOU race
      const current = await tx.vacacion.findUnique({ where: { id: vacId }, select: { estado: true } });
      if (!current) throw Object.assign(new Error('NOT_FOUND_IN_TX'), {});
      // Block deletion if vacation was concurrently approved
      if (current.estado === 'APROBADA') throw Object.assign(new Error('APROBADA_IN_TX'), {});

      // If PENDIENTE or EN_REVISION, return the reserved days to saldo
      if (current.estado === 'PENDIENTE' || current.estado === 'EN_REVISION') {
        // Use createdAt year — matches POST creation saldo year
        const anioVac = new Date(vacacion.createdAt).getFullYear();
        await tx.vacacionSaldo.updateMany({
          where: { usuarioId: vacacion.usuario.id, anio: anioVac },
          data: { diasPendientes: { decrement: vacacion.diasTotales } },
        });
      }
      // Delete historial first (cascade may not exist in schema)
      await tx.vacacionHistorial.deleteMany({ where: { vacacionId: vacId } });
      await tx.vacacion.delete({ where: { id: vacId } });
    });

    res.status(204).send();
  } catch (error) {
    if ((error as Error)?.message === 'NOT_FOUND_IN_TX') {
      res.status(404).json({ error: 'Vacación no encontrada' });
      return;
    }
    if ((error as Error)?.message === 'APROBADA_IN_TX') {
      res.status(409).json({ error: 'La vacación fue aprobada mientras se procesaba la eliminación' });
      return;
    }
    console.error('Error deleting vacacion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
