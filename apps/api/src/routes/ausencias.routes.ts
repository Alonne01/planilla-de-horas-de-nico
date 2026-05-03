import { Router, Response } from 'express';
import { PrismaClient, Prisma, AusenciaTipo, AusenciaEstado } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_SUPERVISOR, LEVEL_RRHH } from '../middleware/roles.middleware.js';
import { upload } from '../middleware/upload.middleware.js';
import { inyectarDiasBloqueados, formatTipoAusencia } from '../utils/ausencia-calendar.utils.js';
import { notificarAusencia, notificarAprobadoresPaso } from '../utils/notificacion.utils.js';
import { isResponsibleApprover } from '../utils/approval-auth.utils.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── Schemas ─────────────────────────────────────

const createAusenciaSchema = z.object({
  usuarioId: z.string().uuid(),
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

// ─── Helper: check if user can manage target employee ────

async function canManageUser(actorId: string, actorNivel: number, targetUserId: string, empresaId: string): Promise<boolean> {
  if (actorNivel >= 90) return true; // RRHH/ADMIN can manage anyone

  const target = await prisma.usuario.findUnique({
    where: { id: targetUserId },
    select: { empresaId: true, supervisorId: true, coordinadorId: true, sectorId: true },
  });
  if (!target || target.empresaId !== empresaId) return false;

  // Direct supervisor or coordinator
  if (target.supervisorId === actorId || target.coordinadorId === actorId) return true;

  // Same sector for COORDINADOR+
  if (actorNivel >= 70 && target.sectorId) {
    const actor = await prisma.usuario.findUnique({ where: { id: actorId }, select: { sectorId: true } });
    if (actor?.sectorId === target.sectorId) return true;
  }

  return false;
}

// ─── GET /ausencias ──────────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const empresaId = req.user!.empresaId;
    const userNivel = req.user!.rolNivel ?? 0;
    const scope = req.query.scope as string | undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (scope === 'mio') {
      // Only own records
      where.usuarioId = userId;
    } else if (userNivel >= 90) {
      // RRHH/ADMIN: all company
      where.usuario = { empresaId };
    } else if (userNivel >= 60) {
      // SUPERVISOR/COORDINADOR/GERENTE: own + subordinates + sector
      const subordinados = await prisma.usuario.findMany({
        where: {
          empresaId, activo: true,
          OR: [{ supervisorId: userId }, { coordinadorId: userId }],
        },
        select: { id: true },
      });
      const subIds = subordinados.map(u => u.id);

      const me = await prisma.usuario.findUnique({ where: { id: userId }, select: { sectorId: true } });
      if (me?.sectorId) {
        const sectorUsers = await prisma.usuario.findMany({
          where: { sectorId: me.sectorId, empresaId, activo: true },
          select: { id: true },
        });
        sectorUsers.forEach(u => { if (!subIds.includes(u.id)) subIds.push(u.id); });
      }
      if (!subIds.includes(userId)) subIds.push(userId);
      where.usuarioId = { in: subIds };
    } else {
      // OPERADOR: only own
      where.usuarioId = userId;
    }

    const tipo = req.query.tipo as string | undefined;
    if (tipo) where.tipo = tipo;

    const periodoInicio = req.query.periodoInicio as string | undefined;
    const periodoFin = req.query.periodoFin as string | undefined;
    if (periodoInicio && periodoFin) {
      const fin = new Date(periodoFin); fin.setHours(23, 59, 59, 999);
      where.fechaInicio = {
        gte: new Date(periodoInicio),
        lte: fin,
      };
    }

    const ausencias = await prisma.ausencia.findMany({
      where,
      include: {
        usuario: { select: { id: true, nombre: true, apellido: true, legajo: true, sector: { select: { nombre: true } } } },
        cargadaPor: { select: { id: true, nombre: true, apellido: true } },
      },
      orderBy: { fechaInicio: 'desc' },
    });
    res.json(ausencias);
  } catch (error) {
    console.error('Error listing ausencias:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /ausencias/subordinados ─────────────────
// Returns list of employees the current user can create absences for

router.get('/subordinados', requireLevel(LEVEL_SUPERVISOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const empresaId = req.user!.empresaId;
    const userNivel = req.user!.rolNivel ?? 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let where: any;

    if (userNivel >= 90) {
      where = { empresaId, activo: true };
    } else {
      const conditions = [
        { supervisorId: userId },
        { coordinadorId: userId },
      ];
      const me = await prisma.usuario.findUnique({ where: { id: userId }, select: { sectorId: true } });
      if (me?.sectorId && userNivel >= 70) {
        conditions.push({ sectorId: me.sectorId } as any);
      }
      where = { empresaId, activo: true, OR: conditions };
    }

    const subordinados = await prisma.usuario.findMany({
      where,
      select: { id: true, nombre: true, apellido: true, legajo: true, sector: { select: { nombre: true } } },
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    });

    // Filter out the current user
    res.json(subordinados.filter(u => u.id !== userId));
  } catch (error) {
    console.error('Error listing subordinados:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /ausencias/solicitar — Employee creates own absence (sick leave, etc.)
router.post('/solicitar', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const empresaId = req.user!.empresaId;

    const schema = z.object({
      tipo: z.nativeEnum(AusenciaTipo),
      fechaInicio: z.string(),
      fechaFin: z.string(),
      diasAusencia: z.number().int().min(1),
      descripcion: z.string().max(500).optional(),
      numeroCertificado: z.string().max(50).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    // Employees cannot self-request FRANCO_COMPENSATORIO here (use /compensatorio instead)
    if (parsed.data.tipo === 'FRANCO_COMPENSATORIO') {
      res.status(400).json({ error: 'Usá la sección de Franco Compensatorio para solicitar días compensatorios' });
      return;
    }

    const descuentaSueldo = parsed.data.tipo === 'FALTA_INJUSTIFICADA';

    // Find approval flow for AUSENCIA
    const usuario = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { sectorId: true, nombre: true, apellido: true },
    });

    let flujo = await prisma.flujoAprobacion.findFirst({
      where: {
        empresaId,
        tipoDocumento: 'AUSENCIA',
        activo: true,
        asignaciones: { some: { usuarioId: userId, activo: true, tipoDocumento: 'AUSENCIA' } },
      },
      include: { pasos: { orderBy: { orden: 'asc' } } },
    });

    if (!flujo && usuario?.sectorId) {
      flujo = await prisma.flujoAprobacion.findFirst({
        where: {
          empresaId,
          tipoDocumento: 'AUSENCIA',
          activo: true,
          asignaciones: { some: { sectorId: usuario.sectorId, activo: true, tipoDocumento: 'AUSENCIA' } },
        },
        include: { pasos: { orderBy: { orden: 'asc' } } },
      });
    }

    if (!flujo) {
      flujo = await prisma.flujoAprobacion.findFirst({
        where: {
          empresaId,
          tipoDocumento: 'AUSENCIA',
          activo: true,
          asignaciones: { some: { sectorId: null, usuarioId: null, activo: true, tipoDocumento: 'AUSENCIA' } },
        },
        include: { pasos: { orderBy: { orden: 'asc' } } },
      });
    }

    const ausencia = await prisma.ausencia.create({
      data: {
        usuarioId: userId,
        cargadaPorId: userId,
        tipo: parsed.data.tipo,
        estado: 'PENDIENTE',
        pasoActual: 1,
        fechaInicio: new Date(parsed.data.fechaInicio),
        fechaFin: new Date(parsed.data.fechaFin),
        diasAusencia: parsed.data.diasAusencia,
        descripcion: parsed.data.descripcion ?? null,
        numeroCertificado: parsed.data.numeroCertificado ?? null,
        descuentaSueldo,
        porcentajeDescuento: descuentaSueldo ? 100 : 0,
        requiereAprobacion: true,
        aprobada: false,
        flujoId: flujo?.id ?? null,
      },
    });

    await prisma.ausenciaHistorial.create({
      data: {
        ausenciaId: ausencia.id,
        usuarioId: userId,
        estadoNuevo: 'PENDIENTE',
        comentario: 'Solicitud del empleado',
      },
    });

    // Notify step 1 approvers via flow
    const solicitanteNombre = usuario ? `${usuario.nombre} ${usuario.apellido}` : 'Un empleado';
    await notificarAprobadoresPaso(
      userId, empresaId, ausencia.flujoId, 1, 'AUSENCIA', solicitanteNombre,
    );

    res.status(201).json(ausencia);
  } catch (error) {
    console.error('Error creating employee ausencia:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /ausencias/compensatorio — User requests compensatorio days for themselves
router.post('/compensatorio', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const empresaId = req.user!.empresaId;

    const schema = z.object({
      fechaInicio: z.string(),
      fechaFin: z.string(),
      diasAusencia: z.number().int().min(1),
      descripcion: z.string().max(500).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    // Use fechaInicio's year — consistent with revokar and avanzar paths
    const anio = new Date(parsed.data.fechaInicio).getFullYear();

    // Find COMPENSATORIO approval flow (read-only, outside transaction)
    const usuario = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { sectorId: true },
    });

    const flujoAsignacion = await prisma.flujoAsignacion.findFirst({
      where: {
        tipoDocumento: 'COMPENSATORIO',
        activo: true,
        flujo: { empresaId },
        OR: [
          { usuarioId: userId },
          { sectorId: usuario?.sectorId ?? undefined },
          { sectorId: null, usuarioId: null },
        ],
      },
    });

    let flujoIdComp = flujoAsignacion?.flujoId ?? null;
    if (!flujoIdComp) {
      const fallbackFlow = await prisma.flujoAprobacion.findFirst({
        where: { empresaId, tipoDocumento: 'COMPENSATORIO', activo: true, asignaciones: { some: { activo: true } } },
        select: { id: true },
      });
      flujoIdComp = fallbackFlow?.id ?? null;
    }

    // Critical section: balance check + create atomically to prevent double-spend
    const ausencia = await prisma.$transaction(async (tx) => {
      const saldo = await tx.vacacionSaldo.findUnique({
        where: { usuarioId_anio: { usuarioId: userId, anio } },
      });
      const disponible = (saldo?.compensatoriosAcumulados ?? 0) - (saldo?.compensatoriosUsados ?? 0) - (saldo?.compensatoriosPendientes ?? 0);
      if (parsed.data.diasAusencia > disponible) {
        throw Object.assign(new Error('SALDO_COMPENSATORIO_INSUFICIENTE'), { disponible });
      }

      const aus = await tx.ausencia.create({
        data: {
          usuarioId: userId,
          cargadaPorId: userId,
          tipo: 'FRANCO_COMPENSATORIO',
          estado: 'PENDIENTE',
          pasoActual: 1,
          fechaInicio: new Date(parsed.data.fechaInicio),
          fechaFin: new Date(parsed.data.fechaFin),
          diasAusencia: parsed.data.diasAusencia,
          descripcion: parsed.data.descripcion ?? null,
          descuentaSueldo: false,
          requiereAprobacion: true,
          aprobada: false,
          flujoId: flujoIdComp,
        },
      });

      await tx.ausenciaHistorial.create({
        data: {
          ausenciaId: aus.id,
          usuarioId: userId,
          estadoNuevo: 'PENDIENTE',
          comentario: 'Solicitud de franco compensatorio',
        },
      });

      // Update compensatoriosPendientes
      await tx.vacacionSaldo.upsert({
        where: { usuarioId_anio: { usuarioId: userId, anio } },
        update: { compensatoriosPendientes: { increment: parsed.data.diasAusencia } },
        create: {
          usuarioId: userId,
          anio,
          diasCorrespondientes: 0,
          compensatoriosPendientes: parsed.data.diasAusencia,
        },
      });

      return aus;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    res.status(201).json(ausencia);
  } catch (error) {
    if (error instanceof Error && error.message === 'SALDO_COMPENSATORIO_INSUFICIENTE') {
      res.status(400).json({ error: `Saldo de compensatorios insuficiente. Disponible: ${(error as Error & { disponible: number }).disponible} días` });
      return;
    }
    if ((error as { code?: string }).code === 'P2034') {
      res.status(409).json({ error: 'Conflicto de transacción, intente de nuevo' });
      return;
    }
    console.error('Error creating compensatorio request:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /ausencias ─────────────────────────────
// Superior creates absence for a subordinate

router.post('/', requireLevel(LEVEL_SUPERVISOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createAusenciaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const actorId = req.user!.userId;
    const actorNivel = req.user!.rolNivel ?? 0;
    const empresaId = req.user!.empresaId;
    const targetUserId = parsed.data.usuarioId;

    // Validate hierarchy
    const allowed = await canManageUser(actorId, actorNivel, targetUserId, empresaId);
    if (!allowed) {
      res.status(403).json({ error: 'No tiene permisos para cargar ausencias de este empleado' });
      return;
    }

    const isCertMedico = parsed.data.tipo === 'CERTIFICADO_MEDICO';

    const ausencia = await prisma.ausencia.create({
      data: {
        usuarioId: targetUserId,
        cargadaPorId: actorId,
        tipo: parsed.data.tipo,
        estado: isCertMedico ? 'APROBADA' : 'BORRADOR',
        fechaInicio: new Date(parsed.data.fechaInicio),
        fechaFin: new Date(parsed.data.fechaFin),
        diasAusencia: parsed.data.diasAusencia,
        descripcion: parsed.data.descripcion ?? null,
        numeroCertificado: parsed.data.numeroCertificado ?? null,
        descuentaSueldo: parsed.data.descuentaSueldo ?? false,
        porcentajeDescuento: parsed.data.porcentajeDescuento ?? 0,
        requiereAprobacion: !isCertMedico,
        aprobada: isCertMedico,
        ...(isCertMedico ? { aprobadaPorId: actorId, aprobadaAt: new Date() } : {}),
      },
    });

    // Create initial history entry
    await prisma.ausenciaHistorial.create({
      data: {
        ausenciaId: ausencia.id,
        usuarioId: actorId,
        estadoNuevo: isCertMedico ? 'APROBADA' : 'BORRADOR',
        comentario: `Cargada por superior`,
      },
    });

    // Auto-approved cert médico → inject locked days into planilla
    if (isCertMedico) {
      const tipoLabel = formatTipoAusencia(parsed.data.tipo);
      await inyectarDiasBloqueados({
        usuarioId: targetUserId,
        fechaInicio: new Date(parsed.data.fechaInicio),
        fechaFin: new Date(parsed.data.fechaFin),
        motivoBloqueo: parsed.data.tipo,
        observaciones: `${tipoLabel}${parsed.data.descripcion ? ` — ${parsed.data.descripcion}` : ''}`,
      });
    }

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
    // Bug fix: scope by tenant so users cannot read absences from other companies
    const ausencia = await prisma.ausencia.findFirst({
      where: { id: ausId, usuario: { empresaId: req.user!.empresaId } },
      include: {
        usuario: { select: { id: true, nombre: true, apellido: true, sector: { select: { nombre: true } } } },
        cargadaPor: { select: { nombre: true, apellido: true } },
        aprobadaPor: { select: { nombre: true, apellido: true } },
        historial: {
          include: { usuario: { select: { nombre: true, apellido: true } } },
          orderBy: { createdAt: 'asc' },
        },
        flujo: { include: { pasos: { orderBy: { orden: 'asc' } } } },
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

// ─── POST /ausencias/:id/enviar ──────────────────
// Submit absence to approval flow

router.post('/:id/enviar', requireLevel(LEVEL_SUPERVISOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ausId = req.params.id as string;
    const ausencia = await prisma.ausencia.findUnique({
      where: { id: ausId },
      include: { usuario: { select: { id: true, empresaId: true, sectorId: true } } },
    });

    if (!ausencia || ausencia.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Ausencia no encontrada' });
      return;
    }
    if (ausencia.estado !== 'BORRADOR' && ausencia.estado !== 'RECHAZADA') {
      res.status(400).json({ error: 'Solo se puede enviar en estado BORRADOR o RECHAZADA' });
      return;
    }

    // Find applicable flow for AUSENCIA
    const targetUserId = ausencia.usuarioId;
    let flujo = await prisma.flujoAprobacion.findFirst({
      where: {
        empresaId: req.user!.empresaId,
        tipoDocumento: 'AUSENCIA',
        activo: true,
        asignaciones: { some: { usuarioId: targetUserId, activo: true, tipoDocumento: 'AUSENCIA' } },
      },
      include: { pasos: { orderBy: { orden: 'asc' } } },
    });

    if (!flujo && ausencia.usuario.sectorId) {
      flujo = await prisma.flujoAprobacion.findFirst({
        where: {
          empresaId: req.user!.empresaId,
          tipoDocumento: 'AUSENCIA',
          activo: true,
          asignaciones: { some: { sectorId: ausencia.usuario.sectorId, activo: true, tipoDocumento: 'AUSENCIA' } },
        },
        include: { pasos: { orderBy: { orden: 'asc' } } },
      });
    }

    if (!flujo) {
      flujo = await prisma.flujoAprobacion.findFirst({
        where: {
          empresaId: req.user!.empresaId,
          tipoDocumento: 'AUSENCIA',
          activo: true,
          asignaciones: { some: { sectorId: null, usuarioId: null, activo: true, tipoDocumento: 'AUSENCIA' } },
        },
        include: { pasos: { orderBy: { orden: 'asc' } } },
      });
    }

    // Atomic: state update + historial + optional saldo re-reservation
    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        const result = await tx.ausencia.update({
          where: { id: ausId },
          data: {
            estado: 'PENDIENTE',
            pasoActual: 1,
            obsRechazo: null,
            flujoId: flujo?.id ?? null,
            requiereAprobacion: true,
            aprobada: false,
          },
        });

        await tx.ausenciaHistorial.create({
          data: {
            ausenciaId: ausId,
            usuarioId: req.user!.userId,
            estadoAnterior: ausencia.estado as AusenciaEstado,
            estadoNuevo: 'PENDIENTE',
          },
        });

        // Re-submitting a rejected FRANCO_COMPENSATORIO: re-reserve the pending balance.
        // (Rejection released compensatoriosPendientes; we must re-reserve before re-entering the flow.)
        if (ausencia.tipo === 'FRANCO_COMPENSATORIO' && ausencia.estado === 'RECHAZADA') {
          const anio = new Date(ausencia.fechaInicio).getFullYear();
          const saldo = await tx.vacacionSaldo.findUnique({
            where: { usuarioId_anio: { usuarioId: ausencia.usuarioId, anio } },
          });
          const disponible = (saldo?.compensatoriosAcumulados ?? 0)
            - (saldo?.compensatoriosUsados ?? 0)
            - (saldo?.compensatoriosPendientes ?? 0);
          if (ausencia.diasAusencia > disponible) {
            throw Object.assign(new Error('SALDO_COMPENSATORIO_INSUFICIENTE'), { disponible });
          }
          await tx.vacacionSaldo.update({
            where: { usuarioId_anio: { usuarioId: ausencia.usuarioId, anio } },
            data: { compensatoriosPendientes: { increment: ausencia.diasAusencia } },
          });
        }

        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err: any) {
      if (err?.message === 'SALDO_COMPENSATORIO_INSUFICIENTE') {
        res.status(400).json({ error: `Saldo de compensatorios insuficiente. Disponible: ${err.disponible} días` });
        return;
      }
      if ((err as { code?: string }).code === 'P2034') {
        res.status(409).json({ error: 'Conflicto de transacción, intente de nuevo' });
        return;
      }
      throw err;
    }

    res.json(updated);
  } catch (error) {
    console.error('Error al enviar ausencia:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /ausencias/:id/avanzar ─────────────────
// Approve (advance step in flow)

router.post('/:id/avanzar', requireLevel(LEVEL_SUPERVISOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ausId = req.params.id as string;
    const ausencia = await prisma.ausencia.findUnique({
      where: { id: ausId },
      include: {
        flujo: { include: { pasos: { orderBy: { orden: 'asc' } } } },
        usuario: { select: { id: true, empresaId: true, sectorId: true, supervisorId: true, coordinadorId: true } },
      },
    });

    if (!ausencia || ausencia.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Ausencia no encontrada' });
      return;
    }
    if (ausencia.estado !== 'PENDIENTE' && ausencia.estado !== 'EN_REVISION') {
      res.status(400).json({ error: 'La ausencia no está pendiente de revisión' });
      return;
    }

    const pasos = ausencia.flujo?.pasos ?? [];
    const totalPasos = pasos.length;
    const pasoActual = ausencia.pasoActual;
    let nuevoEstado: AusenciaEstado;
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
      if (!isResponsibleApprover(pasoConfig.rolAprobador, ausencia.usuario, req.user!.userId, req.user!.rol, req.user!.rolNivel ?? 0, approverSectorId)) {
        res.status(403).json({ error: `No tenés autorización para aprobar esta ausencia en el paso de ${pasoConfig.rolAprobador}` });
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
        const { count } = await tx.ausencia.updateMany({
          where: { id: ausId, pasoActual: pasoActual },
          data: {
            estado: nuevoEstado,
            pasoActual: nuevoPaso,
            ...(nuevoEstado === 'APROBADA' ? {
              aprobada: true,
              aprobadaPorId: req.user!.userId,
              aprobadaAt: new Date(),
            } : {}),
          },
        });
        if (count === 0) throw new Error('CONCURRENT_MODIFICATION');

        // Duplicate check inside tx scoped to current submission
        const lastSubmission = await tx.ausenciaHistorial.findFirst({
          where: { ausenciaId: ausId, estadoNuevo: 'PENDIENTE' },
          orderBy: { createdAt: 'desc' },
        });
        const yaAprobo = await tx.ausenciaHistorial.findFirst({
          where: {
            ausenciaId: ausId,
            usuarioId: req.user!.userId,
            pasoFlujo: nuevoPaso,
            createdAt: { gt: lastSubmission?.createdAt ?? new Date(0) },
          },
        });
        if (yaAprobo) {
          throw new Error('DUPLICATE_APPROVAL');
        }

        // FRANCO_COMPENSATORIO: balance mutation inside transaction
        if (nuevoEstado === 'APROBADA' && ausencia.tipo === 'FRANCO_COMPENSATORIO') {
          const anio = new Date(ausencia.fechaInicio).getFullYear();
          await tx.vacacionSaldo.update({
            where: { usuarioId_anio: { usuarioId: ausencia.usuario.id, anio } },
            data: {
              compensatoriosPendientes: { decrement: ausencia.diasAusencia },
              compensatoriosUsados: { increment: ausencia.diasAusencia },
            },
          });
        }

        await tx.ausenciaHistorial.create({
          data: {
            ausenciaId: ausId,
            usuarioId: req.user!.userId,
            estadoAnterior: ausencia.estado as AusenciaEstado,
            estadoNuevo: nuevoEstado,
            pasoFlujo: nuevoPaso,
            comentario: req.body?.comentario ?? null,
          },
        });

        return tx.ausencia.findUnique({ where: { id: ausId } });
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

    // Approved → inject locked days into employee planilla (outside tx, idempotent)
    if (nuevoEstado === 'APROBADA') {
      const tipoLabel = formatTipoAusencia(ausencia.tipo);
      await inyectarDiasBloqueados({
        usuarioId: ausencia.usuario.id,
        fechaInicio: ausencia.fechaInicio,
        fechaFin: ausencia.fechaFin,
        motivoBloqueo: ausencia.tipo,
        observaciones: `${tipoLabel}${ausencia.descripcion ? ` — ${ausencia.descripcion}` : ''}`,
      });
    }

    // Notify absence requester
    const aprobador = await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { nombre: true, apellido: true } });
    const aprobadorNombre = aprobador ? `${aprobador.nombre} ${aprobador.apellido}` : 'Un aprobador';
    await notificarAusencia(ausencia.usuarioId, nuevoEstado as 'APROBADA' | 'EN_REVISION', aprobadorNombre);

    // Notify next approver if advancing to another step
    if (nuevoEstado === 'EN_REVISION') {
      const ownerInfo = await prisma.usuario.findUnique({
        where: { id: ausencia.usuarioId },
        select: { nombre: true, apellido: true },
      });
      const ownerNombre = ownerInfo ? `${ownerInfo.nombre} ${ownerInfo.apellido}` : 'Un empleado';
      await notificarAprobadoresPaso(
        ausencia.usuarioId, req.user!.empresaId, ausencia.flujoId, nuevoPaso, 'AUSENCIA', ownerNombre,
      );
    }

    res.json(updated);
  } catch (error) {
    console.error('Error al avanzar ausencia:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /ausencias/:id/rechazar ────────────────

router.post('/:id/rechazar', requireLevel(LEVEL_SUPERVISOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ausId = req.params.id as string;
    const { motivo } = req.body;
    if (!motivo) {
      res.status(400).json({ error: 'Se requiere un motivo de rechazo' });
      return;
    }

    const ausencia = await prisma.ausencia.findUnique({
      where: { id: ausId },
      include: {
        flujo: { include: { pasos: { orderBy: { orden: 'asc' } } } },
        usuario: { select: { id: true, empresaId: true, sectorId: true, supervisorId: true, coordinadorId: true } },
      },
    });

    if (!ausencia || ausencia.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Ausencia no encontrada' });
      return;
    }

    // Verify the caller is the responsible approver for this step
    const pasos = ausencia.flujo?.pasos ?? [];
    const currentStep = pasos.find(p => p.orden === ausencia.pasoActual);
    const approverSectorId = (await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { sectorId: true } }))?.sectorId ?? null;
    if (!currentStep || !isResponsibleApprover(currentStep.rolAprobador, ausencia.usuario, req.user!.userId, req.user!.rol, req.user!.rolNivel ?? 0, approverSectorId)) {
      res.status(403).json({ error: 'No tenés autorización para rechazar esta ausencia' });
      return;
    }

    // Atomic: state guard + historial + saldo in a single transaction
    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        // Concurrency guard: only reject if still in a reviewable state
        const { count } = await tx.ausencia.updateMany({
          where: { id: ausId, estado: { in: ['PENDIENTE', 'EN_REVISION'] } },
          data: { estado: 'RECHAZADA', obsRechazo: motivo, pasoActual: 0, aprobada: false },
        });
        if (count === 0) throw new Error('CONCURRENT_MODIFICATION');

        await tx.ausenciaHistorial.create({
          data: {
            ausenciaId: ausId,
            usuarioId: req.user!.userId,
            estadoAnterior: ausencia.estado as AusenciaEstado,
            estadoNuevo: 'RECHAZADA',
            comentario: motivo,
          },
        });

        // FRANCO_COMPENSATORIO: restore pending balance atomically
        if (ausencia.tipo === 'FRANCO_COMPENSATORIO') {
          const anio = new Date(ausencia.fechaInicio).getFullYear();
          await tx.vacacionSaldo.update({
            where: { usuarioId_anio: { usuarioId: ausencia.usuarioId, anio } },
            data: { compensatoriosPendientes: { decrement: ausencia.diasAusencia } },
          });
        }

        return tx.ausencia.findUnique({ where: { id: ausId } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err: any) {
      if (err?.message === 'CONCURRENT_MODIFICATION') {
        res.status(409).json({ error: 'La ausencia fue modificada simultáneamente. Recargue la página.' });
        return;
      }
      throw err;
    }

    // Notify absence requester (outside tx — fire-and-forget is acceptable)
    const aprobador = await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { nombre: true, apellido: true } });
    const aprobadorNombre = aprobador ? `${aprobador.nombre} ${aprobador.apellido}` : 'Un aprobador';
    await notificarAusencia(ausencia.usuarioId, 'RECHAZADA', aprobadorNombre, motivo);

    res.json(updated);
  } catch (error) {
    console.error('Error al rechazar ausencia:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /ausencias/:id/revocar — User self-revokes their own compensatorio
router.post('/:id/revocar', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ausId = req.params.id as string;
    const userId = req.user!.userId;

    const ausencia = await prisma.ausencia.findUnique({
      where: { id: ausId },
      include: { usuario: { select: { id: true, empresaId: true } } },
    });

    if (!ausencia || ausencia.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Ausencia no encontrada' });
      return;
    }

    if (ausencia.usuarioId !== userId) {
      res.status(403).json({ error: 'Solo podés revocar tus propios compensatorios' });
      return;
    }

    if (ausencia.tipo !== 'FRANCO_COMPENSATORIO') {
      res.status(400).json({ error: 'Solo se pueden revocar francos compensatorios' });
      return;
    }

    if (!['PENDIENTE', 'EN_REVISION', 'APROBADA'].includes(ausencia.estado)) {
      res.status(400).json({ error: 'No se puede revocar en este estado' });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(ausencia.fechaInicio) < today) {
      res.status(400).json({ error: 'No se puede revocar un compensatorio cuya fecha ya pasó' });
      return;
    }

    const wasApproved = ausencia.estado === 'APROBADA';
    const anio = new Date(ausencia.fechaInicio).getFullYear();

    await prisma.ausencia.update({
      where: { id: ausId },
      data: { estado: 'RECHAZADA', obsRechazo: 'Revocado por el usuario', aprobada: false },
    });

    await prisma.ausenciaHistorial.create({
      data: {
        ausenciaId: ausId,
        usuarioId: userId,
        estadoAnterior: ausencia.estado as AusenciaEstado,
        estadoNuevo: 'RECHAZADA',
        comentario: req.body?.motivo || 'Revocado por el usuario',
      },
    });

    if (wasApproved) {
      await prisma.vacacionSaldo.update({
        where: { usuarioId_anio: { usuarioId: userId, anio } },
        data: { compensatoriosUsados: { decrement: ausencia.diasAusencia } },
      });

      // Remove locked days from planilla
      const fechaInicio = new Date(ausencia.fechaInicio);
      const fechaFin = new Date(ausencia.fechaFin);

      const planillas = await prisma.planilla.findMany({
        where: { usuarioId: userId },
        select: { id: true },
      });

      if (planillas.length > 0) {
        await prisma.registroHoras.updateMany({
          where: {
            planillaId: { in: planillas.map(p => p.id) },
            fecha: { gte: fechaInicio, lte: fechaFin },
            bloqueado: true,
            motivoBloqueo: 'FRANCO_COMPENSATORIO',
          },
          data: {
            bloqueado: false,
            motivoBloqueo: null,
            esFrancoCompensatorio: false,
            observaciones: 'Franco compensatorio revocado por el usuario',
          },
        });
      }
    } else {
      await prisma.vacacionSaldo.update({
        where: { usuarioId_anio: { usuarioId: userId, anio } },
        data: { compensatoriosPendientes: { decrement: ausencia.diasAusencia } },
      });
    }

    res.json({ message: 'Compensatorio revocado exitosamente' });
  } catch (error) {
    console.error('Error revocando compensatorio:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /ausencias/:id/archivo ─────────────────
// Upload medical certificate (image or PDF)

router.post('/:id/archivo', upload.single('archivo'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ausId = req.params.id as string;
    if (!req.file) {
      res.status(400).json({ error: 'No se envió un archivo' });
      return;
    }

    const ausencia = await prisma.ausencia.findUnique({
      where: { id: ausId },
      include: { usuario: { select: { empresaId: true } } },
    });
    if (!ausencia || ausencia.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Ausencia no encontrada' });
      return;
    }

    const archivoUrl = `/uploads/${req.file.filename}`;
    const updated = await prisma.ausencia.update({
      where: { id: ausId },
      data: { archivoUrl },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error uploading archivo:', error);
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
