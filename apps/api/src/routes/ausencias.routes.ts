import { Router, Response } from 'express';
import { PrismaClient, Prisma, AusenciaTipo, AusenciaEstado } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_SUPERVISOR, LEVEL_RRHH } from '../middleware/roles.middleware.js';
import {
  upload,
  uploadLimiter,
  descartarArchivos,
  borrarUploadPorUrl,
} from '../middleware/upload.middleware.js';
import { inyectarDiasBloqueados, formatTipoAusencia } from '../utils/ausencia-calendar.utils.js';
import { notificarAusencia, notificarAprobadoresPaso } from '../utils/notificacion.utils.js';
import { isResponsibleApprover } from '../utils/approval-auth.utils.js';
import { fechaDia, spanDiasCalendario } from '../utils/zod.utils.js';
import { canManageUser } from '../utils/user-scope.utils.js';
import {
  construirCircuito,
  nivelesPorRol,
  pasoActualDe,
  pasosDe,
  resolverFlujo,
  type PasoCircuito,
} from '../utils/circuito.utils.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// Sin circuito la ausencia queda en la rama de escape del avance, que exige
// nivel RRHH o superior: conviene que el empleado lo sepa al enviarla y no
// cuando ve que nadie se la aprueba.
const AVISO_SIN_CIRCUITO =
  'Tu sector no tiene circuito de aprobación configurado: la ausencia va a requerir una aprobación manual de RRHH o superior.';

// ─── Schemas ─────────────────────────────────────

// Tope de amplitud del rango: una ausencia aprobada se materializa día por día en la
// planilla (inyectarDiasBloqueados), así que un rango de siglos congela el proceso.
const MAX_SPAN_DIAS = 366;

const createAusenciaSchema = z.object({
  usuarioId: z.string().uuid(),
  tipo: z.nativeEnum(AusenciaTipo),
  fechaInicio: fechaDia,
  fechaFin: fechaDia,
  diasAusencia: z.number().int().min(1).max(366),
  descripcion: z.string().max(500).optional(),
  numeroCertificado: z.string().max(50).optional(),
  descuentaSueldo: z.boolean().optional(),
  porcentajeDescuento: z.number().min(0).max(100).optional(),
}).refine(
  (d) => d.fechaFin >= d.fechaInicio,
  { message: 'fechaFin debe ser mayor o igual a fechaInicio', path: ['fechaFin'] },
).refine(
  (d) => d.diasAusencia <= spanDiasCalendario(d.fechaInicio, d.fechaFin),
  { message: 'diasAusencia no puede exceder los días del rango de fechas', path: ['diasAusencia'] },
).refine(
  (d) => spanDiasCalendario(d.fechaInicio, d.fechaFin) <= MAX_SPAN_DIAS,
  { message: `El rango no puede superar ${MAX_SPAN_DIAS} días de calendario`, path: ['fechaFin'] },
);

const updateAusenciaSchema = z.object({
  tipo: z.nativeEnum(AusenciaTipo).optional(),
  fechaInicio: fechaDia.optional(),
  fechaFin: fechaDia.optional(),
  diasAusencia: z.number().int().min(1).max(366).optional(),
  descripcion: z.string().max(500).optional(),
  numeroCertificado: z.string().max(50).optional(),
  descuentaSueldo: z.boolean().optional(),
  porcentajeDescuento: z.number().min(0).max(100).optional(),
  aprobada: z.boolean().optional(),
});

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
      // SUPERVISOR: propio + subordinados directos. COORDINADOR+: además todo su sector.
      // El alcance replica canManageUser (el guard de GET /:id): si no, el listado
      // entregaba en bloque los certificados médicos del sector que el detalle niega
      // uno por uno.
      const subordinados = await prisma.usuario.findMany({
        where: {
          empresaId, activo: true,
          OR: [{ supervisorId: userId }, { coordinadorId: userId }],
        },
        select: { id: true },
      });
      const subIds = subordinados.map(u => u.id);

      if (userNivel >= 70) {
        const me = await prisma.usuario.findUnique({ where: { id: userId }, select: { sectorId: true } });
        if (me?.sectorId) {
          const sectorUsers = await prisma.usuario.findMany({
            where: { sectorId: me.sectorId, empresaId, activo: true },
            select: { id: true },
          });
          sectorUsers.forEach(u => { if (!subIds.includes(u.id)) subIds.push(u.id); });
        }
      }
      if (!subIds.includes(userId)) subIds.push(userId);
      where.usuarioId = { in: subIds };
    } else {
      // OPERADOR: only own
      where.usuarioId = userId;
    }

    const tipo = req.query.tipo as string | undefined;
    if (tipo) {
      // Un tipo que no existe en el enum hace explotar a Prisma con un 500 genérico
      if (!Object.values(AusenciaTipo).includes(tipo as AusenciaTipo)) {
        res.status(400).json({ error: 'tipo inválido' });
        return;
      }
      where.tipo = tipo;
    }

    const periodoInicio = req.query.periodoInicio as string | undefined;
    const periodoFin = req.query.periodoFin as string | undefined;
    // Una fecha no parseable llega como Invalid Date y Prisma responde 500 al serializarla
    if (periodoInicio && isNaN(new Date(periodoInicio).getTime())) {
      res.status(400).json({ error: 'periodoInicio inválido' });
      return;
    }
    if (periodoFin && isNaN(new Date(periodoFin).getTime())) {
      res.status(400).json({ error: 'periodoFin inválido' });
      return;
    }
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
      fechaInicio: fechaDia,
      fechaFin: fechaDia,
      diasAusencia: z.number().int().min(1).max(366),
      descripcion: z.string().max(500).optional(),
      numeroCertificado: z.string().max(50).optional(),
    }).refine(
      (d) => d.fechaFin >= d.fechaInicio,
      { message: 'fechaFin debe ser mayor o igual a fechaInicio', path: ['fechaFin'] },
    ).refine(
      (d) => d.diasAusencia <= spanDiasCalendario(d.fechaInicio, d.fechaFin),
      { message: 'diasAusencia no puede exceder los días del rango de fechas', path: ['diasAusencia'] },
    ).refine(
      (d) => spanDiasCalendario(d.fechaInicio, d.fechaFin) <= MAX_SPAN_DIAS,
      { message: `El rango no puede superar ${MAX_SPAN_DIAS} días de calendario`, path: ['fechaFin'] },
    );

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

    // `sectorId` y `rol` resuelven el circuito; `nombre`/`apellido` van en el
    // aviso a los aprobadores. El dueño de la ausencia es siempre quien la pide
    // por esta vía (se crea con `usuarioId: userId`).
    const usuario = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { sectorId: true, rol: true, nombre: true, apellido: true },
    });

    // El circuito se resuelve y se CONGELA acá, y no en /enviar, porque por esta
    // vía el alta ES el envío: la ausencia nace PENDIENTE en el paso 1 y nunca
    // pasa por /enviar salvo que la rechacen. Desde este punto, tocar la
    // configuración de flujos no altera el recorrido de lo que ya está en vuelo.
    const flujo = await resolverFlujo(prisma, 'AUSENCIA', {
      userId, empresaId, sectorId: usuario?.sectorId ?? null,
    });
    const niveles = await nivelesPorRol(prisma, empresaId);
    const nivelSolicitante = niveles[usuario?.rol ?? ''] ?? 0;

    let circuito: PasoCircuito[] = [];
    if (flujo) {
      const pasosDelFlujo = await prisma.flujoPaso.findMany({
        where: { flujoId: flujo.id },
        orderBy: { orden: 'asc' },
      });
      // Sin cast: `FlujoPaso` trae campos de más (id, flujoId, accion*), pero por
      // tipado estructural encaja en `PasoCircuito` tal cual sale de Prisma.
      circuito = construirCircuito(pasosDelFlujo, nivelSolicitante, niveles);
    }

    const ausencia = await prisma.ausencia.create({
      data: {
        usuarioId: userId,
        cargadaPorId: userId,
        tipo: parsed.data.tipo,
        estado: 'PENDIENTE',
        pasoActual: 1,
        fechaInicio: parsed.data.fechaInicio,
        fechaFin: parsed.data.fechaFin,
        diasAusencia: parsed.data.diasAusencia,
        descripcion: parsed.data.descripcion ?? null,
        numeroCertificado: parsed.data.numeroCertificado ?? null,
        descuentaSueldo,
        porcentajeDescuento: descuentaSueldo ? 100 : 0,
        requiereAprobacion: true,
        aprobada: false,
        flujoId: flujo?.id ?? null,
        // Se guarda SIEMPRE el arreglo, aunque venga vacío: un `[]` dice "se
        // envió sin circuito", que es un hecho del documento. Dejar la columna en
        // null lo haría indistinguible de una ausencia anterior a este cambio y
        // `pasosDe` caería al flujo vivo, así que si después le cargan pasos a
        // ese flujo la ausencia en vuelo empezaría a seguir la cadena nueva —
        // justo lo que el congelado tiene que impedir.
        circuitoSnapshot: circuito,
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

    // Notify step 1 approvers. El rol sale del circuito recién congelado: el
    // snapshot está renumerado desde 1, con lo que buscar el paso vivo por
    // `(flujoId, orden)` le avisaría al rol equivocado apenas el nivel del
    // solicitante saltee el primer paso de la cadena configurada.
    const solicitanteNombre = usuario ? `${usuario.nombre} ${usuario.apellido}` : 'Un empleado';
    await notificarAprobadoresPaso(
      userId, empresaId,
      { rolAprobador: circuito[0]?.rolAprobador }, 'AUSENCIA', solicitanteNombre,
    );

    res.status(201).json({
      ...ausencia,
      avisoSinCircuito: circuito.length === 0 ? AVISO_SIN_CIRCUITO : undefined,
    });
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
      fechaInicio: fechaDia,
      fechaFin: fechaDia,
      diasAusencia: z.number().int().min(1).max(366),
      descripcion: z.string().max(500).optional(),
    }).refine(
      (d) => d.fechaFin >= d.fechaInicio,
      { message: 'fechaFin debe ser mayor o igual a fechaInicio', path: ['fechaFin'] },
    ).refine(
      (d) => d.diasAusencia <= spanDiasCalendario(d.fechaInicio, d.fechaFin),
      { message: 'diasAusencia no puede exceder los días del rango de fechas', path: ['diasAusencia'] },
    ).refine(
      (d) => spanDiasCalendario(d.fechaInicio, d.fechaFin) <= MAX_SPAN_DIAS,
      { message: `El rango no puede superar ${MAX_SPAN_DIAS} días de calendario`, path: ['fechaFin'] },
    );

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    // Use fechaInicio's year — consistent with revokar and avanzar paths
    const anio = parsed.data.fechaInicio.getUTCFullYear();

    // Find COMPENSATORIO approval flow (read-only, outside transaction).
    // `rol` resuelve el nivel del solicitante; `nombre`/`apellido` van en el
    // aviso a los aprobadores.
    const usuario = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { sectorId: true, rol: true, nombre: true, apellido: true },
    });

    // Prioridad usuario → sector → global, la misma que el resto de los
    // documentos. Antes acá había un OR plano donde la asignación global le podía
    // ganar a la del usuario, más un fallback que agarraba CUALQUIER flujo de
    // COMPENSATORIO de la empresa ignorando el sector: con la prioridad correcta
    // ese fallback no hace falta y lo único que lograba era tapar una
    // configuración faltante, mandando la solicitud a un circuito ajeno.
    // Igual que en /solicitar, acá el alta ES el envío: se congela el circuito.
    const flujo = await resolverFlujo(prisma, 'COMPENSATORIO', {
      userId, empresaId, sectorId: usuario?.sectorId ?? null,
    });
    const niveles = await nivelesPorRol(prisma, empresaId);
    const nivelSolicitante = niveles[usuario?.rol ?? ''] ?? 0;

    let circuito: PasoCircuito[] = [];
    if (flujo) {
      const pasosDelFlujo = await prisma.flujoPaso.findMany({
        where: { flujoId: flujo.id },
        orderBy: { orden: 'asc' },
      });
      // Sin cast: `FlujoPaso` trae campos de más (id, flujoId, accion*), pero por
      // tipado estructural encaja en `PasoCircuito` tal cual sale de Prisma.
      circuito = construirCircuito(pasosDelFlujo, nivelSolicitante, niveles);
    }
    const flujoIdComp = flujo?.id ?? null;

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
          fechaInicio: parsed.data.fechaInicio,
          fechaFin: parsed.data.fechaFin,
          diasAusencia: parsed.data.diasAusencia,
          descripcion: parsed.data.descripcion ?? null,
          descuentaSueldo: false,
          requiereAprobacion: true,
          aprobada: false,
          flujoId: flujoIdComp,
          // Siempre el arreglo, aunque venga vacío: ver el comentario largo en
          // /solicitar. Un `[]` dice "se envió sin circuito"; null diría "es un
          // documento viejo" y `pasosDe` caería al flujo vivo.
          circuitoSnapshot: circuito,
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

    // Acá el alta ES el envío, pero nunca se avisaba al aprobador del paso 1: el
    // pedido sólo aparecía cuando alguien miraba la bandeja. Fuera de la
    // transacción, como en el resto del archivo: un fallo del aviso no puede
    // revertir un pedido ya creado (ni la reserva de saldo que lo acompaña).
    const solicitanteNombre = usuario ? `${usuario.nombre} ${usuario.apellido}` : 'Un empleado';
    await notificarAprobadoresPaso(
      userId, empresaId,
      { rolAprobador: circuito[0]?.rolAprobador }, 'AUSENCIA', solicitanteNombre,
    );

    res.status(201).json({
      ...ausencia,
      avisoSinCircuito: circuito.length === 0 ? AVISO_SIN_CIRCUITO : undefined,
    });
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

    // Esta vía NO ata flujo ni congela circuito: nace en BORRADOR (o APROBADA
    // directo, si es un certificado médico, que no pasa por ningún circuito) y el
    // circuito se resuelve recién en /enviar, con el nivel del DUEÑO de la
    // ausencia. Congelarlo acá dejaría un circuito viejo pegado al borrador.
    const ausencia = await prisma.ausencia.create({
      data: {
        usuarioId: targetUserId,
        cargadaPorId: actorId,
        tipo: parsed.data.tipo,
        estado: isCertMedico ? 'APROBADA' : 'BORRADOR',
        fechaInicio: parsed.data.fechaInicio,
        fechaFin: parsed.data.fechaFin,
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
        fechaInicio: parsed.data.fechaInicio,
        fechaFin: parsed.data.fechaFin,
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
    // Authorization: only the owner or someone who manages them (direct supervisor/
    // coordinator, same-sector coordinator, or RRHH/ADMIN) may read an absence.
    // Prevents IDOR leaking medical certificates to any tenant user who guesses the id.
    const isOwner = ausencia.usuario.id === req.user!.userId;
    if (!isOwner && !(await canManageUser(req.user!.userId, req.user!.rolNivel ?? 0, ausencia.usuario.id, req.user!.empresaId))) {
      res.status(403).json({ error: 'No autorizado' });
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
      // `rol` y `sectorId` son del DUEÑO de la ausencia, no de quien la envía: el
      // circuito es del documento, y acá quien envía puede ser el superior que la
      // cargó. `nombre`/`apellido` van en el aviso a los aprobadores.
      include: {
        usuario: {
          select: { id: true, empresaId: true, sectorId: true, rol: true, nombre: true, apellido: true },
        },
      },
    });

    if (!ausencia || ausencia.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Ausencia no encontrada' });
      return;
    }
    if (ausencia.estado !== 'BORRADOR' && ausencia.estado !== 'RECHAZADA') {
      res.status(400).json({ error: 'Solo se puede enviar en estado BORRADOR o RECHAZADA' });
      return;
    }

    // Mismo alcance que POST / (crear): reenviar al flujo vuelve a reservar el saldo
    // de compensatorios del dueño, así que no puede hacerlo un superior de otro sector.
    const isOwner = ausencia.usuarioId === req.user!.userId;
    const actorNivel = req.user!.rolNivel ?? 0;
    let puedeEnviar =
      isOwner || (await canManageUser(req.user!.userId, actorNivel, ausencia.usuarioId, req.user!.empresaId));

    // canManageUser solo mira el sector desde nivel 70, y un SUPERVISOR (60) del mismo
    // sector sí tiene que poder reenviar: es el criterio que ya usa isResponsibleApprover
    // para aprobar, y en la práctica muchos empleados no tienen supervisorId cargado.
    if (!puedeEnviar && actorNivel >= 60 && ausencia.usuario.sectorId) {
      const actor = await prisma.usuario.findUnique({
        where: { id: req.user!.userId },
        select: { sectorId: true },
      });
      puedeEnviar = !!actor?.sectorId && actor.sectorId === ausencia.usuario.sectorId;
    }

    if (!puedeEnviar) {
      res.status(403).json({ error: 'No tiene permisos para enviar ausencias de este empleado' });
      return;
    }

    // Find applicable flow. A re-sent FRANCO_COMPENSATORIO must route to the
    // COMPENSATORIO flow, not the generic AUSENCIA flow.
    const tipoDoc = ausencia.tipo === 'FRANCO_COMPENSATORIO' ? 'COMPENSATORIO' : 'AUSENCIA';

    // El circuito se resuelve recién ahora y queda CONGELADO en la ausencia: a
    // partir de acá, tocar la configuración de flujos no altera el recorrido de
    // lo que ya está en vuelo. Un reenvío después de un rechazo es un envío
    // nuevo, así que vuelve a resolver y a congelar.
    // El nivel que arma el circuito es el del DUEÑO, no el de quien envía: si lo
    // mandara el superior que la cargó, su propio nivel saltearía pasos que la
    // ausencia del empleado sí tiene que recorrer.
    const flujo = await resolverFlujo(prisma, tipoDoc, {
      userId: ausencia.usuarioId,
      empresaId: req.user!.empresaId,
      sectorId: ausencia.usuario.sectorId,
    });
    const niveles = await nivelesPorRol(prisma, req.user!.empresaId);
    const nivelSolicitante = niveles[ausencia.usuario.rol] ?? 0;

    let circuito: PasoCircuito[] = [];
    if (flujo) {
      const pasosDelFlujo = await prisma.flujoPaso.findMany({
        where: { flujoId: flujo.id },
        orderBy: { orden: 'asc' },
      });
      // Sin cast: `FlujoPaso` trae campos de más (id, flujoId, accion*), pero por
      // tipado estructural encaja en `PasoCircuito` tal cual sale de Prisma.
      circuito = construirCircuito(pasosDelFlujo, nivelSolicitante, niveles);
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
            // Se guarda SIEMPRE el arreglo, aunque venga vacío, y nunca
            // `undefined`:
            //  - con `undefined` Prisma ni toca la columna, así que al reenviar
            //    una ausencia rechazada cuyo sector se quedó sin flujo quedaría
            //    pegado el snapshot viejo — el circuito fantasma que este cambio
            //    viene a eliminar;
            //  - con `DbNull` el vacío sería indistinguible de una ausencia
            //    anterior a este cambio, y `pasosDe` caería al flujo vivo. Si
            //    después le cargan pasos a ese flujo, la ausencia en vuelo
            //    empezaría a seguir la cadena nueva, que es exactamente lo que el
            //    congelado tiene que impedir.
            // Un `[]` guardado dice "se envió sin circuito", que es un hecho del
            // documento y no una ausencia de dato.
            circuitoSnapshot: circuito,
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

    // Notify step 1 approvers. El rol sale del circuito recién congelado y no de
    // `ausencia.flujoId`: la fila que cargamos al principio del handler es la de
    // ANTES del update, y ahí un borrador no tiene flujo, así que nadie recibiría
    // el aviso. Además el snapshot está renumerado desde 1, con lo que buscar el
    // paso vivo por `(flujoId, orden)` le avisaría al rol equivocado.
    const ownerNombre = `${ausencia.usuario.nombre} ${ausencia.usuario.apellido}`;
    await notificarAprobadoresPaso(
      ausencia.usuarioId, req.user!.empresaId,
      { rolAprobador: circuito[0]?.rolAprobador }, 'AUSENCIA', ownerNombre,
    );

    res.json({
      ...updated,
      avisoSinCircuito: circuito.length === 0 ? AVISO_SIN_CIRCUITO : undefined,
    });
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
    // Nadie aprueba lo suyo, ni siquiera un ADMIN. Con la regla por nivel esto es
    // crítico: un RRHH que envía conserva el paso RRHH en su circuito.
    // La guarda es sobre `usuarioId` (el DUEÑO), no sobre `cargadaPorId`: un
    // superior que carga una ausencia para un subordinado sí puede aprobarla si
    // el circuito se lo permite, porque la ausencia no es suya.
    if (ausencia.usuarioId === req.user!.userId) {
      res.status(403).json({ error: 'No podés aprobar ni rechazar tu propia ausencia' });
      return;
    }
    if (ausencia.estado !== 'PENDIENTE' && ausencia.estado !== 'EN_REVISION') {
      res.status(400).json({ error: 'La ausencia no está pendiente de revisión' });
      return;
    }

    // El circuito congelado al enviar; los pasos vivos del flujo son sólo el
    // fallback de las ausencias anteriores a este cambio.
    const pasos = pasosDe(ausencia);
    const totalPasos = pasos.length;
    const pasoActual = ausencia.pasoActual;
    let nuevoEstado: AusenciaEstado;
    let nuevoPaso: number;
    // El rol del paso que se está FIRMANDO, para dejarlo escrito en el historial.
    // Queda en null en la rama sin circuito: ahí no hay paso que firmar.
    let rolPasoAprobado: string | null = null;

    // pasoActual is 1-based (matches el `orden` del circuito).
    if (pasoActual > totalPasos || totalPasos === 0) {
      // Sin circuito: se exige RRHH o superior. La guarda de autoaprobación que
      // vivía acá ya la cubre la general del principio del handler.
      if ((req.user!.rolNivel ?? 0) < 90) {
        res.status(403).json({ error: 'Se requiere nivel RRHH o superior para aprobar sin flujo de aprobación' });
        return;
      }
      nuevoEstado = 'APROBADA';
      nuevoPaso = pasoActual;
    } else {
      const pasoConfig = pasoActualDe(ausencia);
      if (!pasoConfig) {
        res.status(500).json({ error: `Configuración de paso ${pasoActual} no encontrada en el circuito` });
        return;
      }
      const approverSectorId = (await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { sectorId: true } }))?.sectorId ?? null;
      if (!isResponsibleApprover(pasoConfig.rolAprobador, ausencia.usuario, req.user!.userId, req.user!.rol, req.user!.rolNivel ?? 0, approverSectorId)) {
        res.status(403).json({ error: `No tenés autorización para aprobar esta ausencia en el paso de ${pasoConfig.rolAprobador}` });
        return;
      }

      rolPasoAprobado = pasoConfig.rolAprobador;
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

        // Duplicate check inside tx scoped to current submission.
        // Se compara contra el paso que se está APROBANDO, no contra el destino:
        // lo que hay que impedir es que la misma persona firme dos veces el mismo
        // recorrido, y con el destino la comparación se corría un paso.
        const lastSubmission = await tx.ausenciaHistorial.findFirst({
          where: { ausenciaId: ausId, estadoNuevo: 'PENDIENTE' },
          orderBy: { createdAt: 'desc' },
        });
        const yaAprobo = await tx.ausenciaHistorial.findFirst({
          where: {
            ausenciaId: ausId,
            usuarioId: req.user!.userId,
            pasoFlujo: ausencia.pasoActual,
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
            // El paso FIRMADO, no el destino: el historial tiene que decir por
            // dónde pasó la solicitud, y el destino ni siquiera existe cuando la
            // firma es la última del circuito.
            pasoFlujo: pasoActual,
            rolAprobador: rolPasoAprobado,
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
        ausencia.usuarioId, req.user!.empresaId,
        // El rol sale del circuito de ESTA ausencia: `nuevoPaso` indexa el
        // snapshot renumerado, no la cadena configurada.
        { rolAprobador: pasos.find((p) => p.orden === nuevoPaso)?.rolAprobador },
        'AUSENCIA', ownerNombre,
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

    // Nadie rechaza lo suyo: mismo criterio que en /avanzar. La guarda es sobre
    // `usuarioId` (el DUEÑO) y no sobre `cargadaPorId`, así el superior que cargó
    // la ausencia de un subordinado la puede seguir rechazando.
    if (ausencia.usuarioId === req.user!.userId) {
      res.status(403).json({ error: 'No podés aprobar ni rechazar tu propia ausencia' });
      return;
    }

    // Explicit state guard (mirrors /avanzar): rechazar sólo aplica a una ausencia
    // en revisión. Devuelve 400 claro en vez del 409 "modificada simultáneamente"
    // del guard transaccional, que sólo debe dispararse ante una carrera real.
    if (ausencia.estado !== 'PENDIENTE' && ausencia.estado !== 'EN_REVISION') {
      res.status(400).json({ error: 'La ausencia no está en estado de revisión' });
      return;
    }

    // Verify the caller is the responsible approver for this step (el paso sale
    // del circuito congelado; los pasos vivos son el fallback de lo viejo)
    const currentStep = pasoActualDe(ausencia);
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
            // Dónde se cortó el circuito. El updateMany de arriba ya dejó
            // `pasoActual` en 0, así que el valor sale de la fila que se leyó
            // ANTES de rechazar: sin esto el historial no dice en qué paso murió.
            pasoFlujo: ausencia.pasoActual,
            rolAprobador: currentStep.rolAprobador,
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

    // CANCELADA y no RECHAZADA: el dueño no debería ver su propia devolución como
    // un rechazo. `revocar` conserva su semántica propia (compensatorio ya APROBADA
    // con fecha futura), que es justo lo que la cancelación no permite.
    await prisma.ausencia.update({
      where: { id: ausId },
      data: { estado: 'CANCELADA', obsRechazo: 'Revocado por el usuario', aprobada: false },
    });

    await prisma.ausenciaHistorial.create({
      data: {
        ausenciaId: ausId,
        usuarioId: userId,
        estadoAnterior: ausencia.estado as AusenciaEstado,
        estadoNuevo: 'CANCELADA',
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

router.post('/:id/archivo', uploadLimiter, upload.single('archivo'), async (req: AuthRequest, res: Response): Promise<void> => {
  const subido = req.file;
  try {
    const ausId = req.params.id as string;
    if (!subido) {
      res.status(400).json({ error: 'No se envió un archivo' });
      return;
    }

    const ausencia = await prisma.ausencia.findUnique({
      where: { id: ausId },
      include: { usuario: { select: { empresaId: true } } },
    });
    if (!ausencia || ausencia.usuario.empresaId !== req.user!.empresaId) {
      descartarArchivos([subido]);
      res.status(404).json({ error: 'Ausencia no encontrada' });
      return;
    }

    const actorId = req.user!.userId;
    const actorNivel = req.user!.rolNivel ?? 0;

    if (ausencia.estado === 'CANCELADA') {
      descartarArchivos([subido]);
      res.status(400).json({ error: 'La solicitud está cancelada' });
      return;
    }

    if (ausencia.cargaManual) {
      // La marca vive dentro de la planilla y sigue sus reglas: solo el dueño, y
      // solo mientras la planilla sea editable. Ni el supervisor ni RRHH.
      if (ausencia.usuarioId !== actorId) {
        descartarArchivos([subido]);
        res.status(403).json({ error: 'Solo el dueño puede adjuntar en su marca' });
        return;
      }
      const planilla = ausencia.planillaId
        ? await prisma.planilla.findUnique({ where: { id: ausencia.planillaId }, select: { estado: true } })
        : null;
      if (planilla && planilla.estado !== 'BORRADOR' && planilla.estado !== 'RECHAZADA') {
        descartarArchivos([subido]);
        res.status(400).json({ error: `No se puede adjuntar con la planilla en estado ${planilla.estado}` });
        return;
      }
    } else if (ausencia.usuarioId !== actorId && !(await canManageUser(actorId, actorNivel, ausencia.usuarioId, req.user!.empresaId))) {
      descartarArchivos([subido]);
      res.status(403).json({ error: 'No autorizado para modificar el archivo de esta ausencia' });
      return;
    }

    const anterior = ausencia.archivoUrl;
    const archivoUrl = `/uploads/${subido.filename}`;
    const updated = await prisma.ausencia.update({
      where: { id: ausId },
      data: { archivoUrl },
    });

    // Un certificado reemplaza al anterior: si no se borra, cada reemplazo deja
    // un archivo huérfano en disco que ya nadie puede ver ni eliminar.
    if (anterior && anterior !== archivoUrl) {
      borrarUploadPorUrl(anterior);
    }

    res.json(updated);
  } catch (error) {
    console.error('Error uploading archivo:', error);
    descartarArchivos(subido ? [subido] : undefined);
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

    if (existing.estado === 'APROBADA') {
      res.status(400).json({ error: 'No se puede editar una ausencia aprobada' });
      return;
    }

    // El schema valida cada fecha por separado; el rango efectivo mezcla lo enviado
    // con lo que ya estaba guardado, así que se controla acá (orden, amplitud y
    // consistencia con diasAusencia, que es lo que alimenta el descuento de sueldo).
    // Sólo se valida si la edición toca el rango o los días: una edición de otros
    // campos no debe quedar bloqueada por datos viejos fuera de rango.
    const tocaRango = parsed.data.fechaInicio !== undefined
      || parsed.data.fechaFin !== undefined
      || parsed.data.diasAusencia !== undefined;
    if (tocaRango) {
      const nuevoInicio = parsed.data.fechaInicio ?? existing.fechaInicio;
      const nuevoFin = parsed.data.fechaFin ?? existing.fechaFin;
      if (nuevoFin < nuevoInicio) {
        res.status(400).json({ error: 'fechaFin debe ser mayor o igual a fechaInicio' });
        return;
      }
      const span = spanDiasCalendario(nuevoInicio, nuevoFin);
      if (span > MAX_SPAN_DIAS) {
        res.status(400).json({ error: `El rango no puede superar ${MAX_SPAN_DIAS} días de calendario` });
        return;
      }
      const nuevosDias = parsed.data.diasAusencia ?? existing.diasAusencia;
      if (nuevosDias > span) {
        res.status(400).json({ error: 'diasAusencia no puede exceder los días del rango de fechas' });
        return;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { ...parsed.data };
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

    if (existing.estado === 'APROBADA') {
      res.status(400).json({ error: 'No se puede eliminar una ausencia aprobada. Usá un flujo de revocación.' });
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
