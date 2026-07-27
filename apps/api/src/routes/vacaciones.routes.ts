import { Router, Response } from 'express';
import { PrismaClient, Prisma, VacacionEstado } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_SUPERVISOR } from '../middleware/roles.middleware.js';
import { inyectarDiasBloqueados } from '../utils/ausencia-calendar.utils.js';
import { notificarVacacion, notificarAprobadoresPaso } from '../utils/notificacion.utils.js';
import { isResponsibleApprover } from '../utils/approval-auth.utils.js';
import { puedeVerCalendario } from '../utils/calendario-access.utils.js';
import { fechaDia } from '../utils/zod.utils.js';
import { hoyLocalEmpresa, rangoConsultaDia } from '../utils/fecha-dia.utils.js';
import { periodoQuerySchema, filtroFechaInicioEnPeriodo } from '../utils/periodo-query.utils.js';
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

// ─── Schemas ─────────────────────────────────────

const createVacacionSchema = z.object({
  fechaInicio: fechaDia,
  fechaFin: fechaDia,
  diasHabiles: z.number().int().min(1),
  motivo: z.string().max(500).optional(),
}).refine(
  (d) => d.fechaFin >= d.fechaInicio,
  { message: 'La fecha de fin no puede ser anterior a la de inicio', path: ['fechaFin'] },
);

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
    // Año de negocio (Argentina), no el del huso del proceso.
    const anio = hoyLocalEmpresa().getUTCFullYear();

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

    const { anio, sectorId } = req.query;
    let year = hoyLocalEmpresa().getUTCFullYear();
    if (anio !== undefined && anio !== '') {
      const n = Number(anio);
      // Sin este guard, un `?anio=abc` propaga NaN hasta el `where` de Prisma y
      // el gantt entero contesta 500.
      if (!Number.isInteger(n) || n < 1900 || n > 2999) {
        res.status(400).json({ error: 'anio inválido' });
        return;
      }
      year = n;
    }
    // Las puntas del año van en UTC. Con el constructor local, bajo
    // TZ=America/Argentina/Buenos_Aires (ver Dockerfile) `new Date(year, 0, 1)`
    // da `03:00Z` del 1/1, y como se usa como `fechaFin: { gte: startDate }`,
    // unas vacaciones que TERMINAN el 1 de enero (fecha-día `00:00:00Z`)
    // quedaban afuera del gantt de ese año; por el otro extremo se colaba una
    // que arrancaba el 1 de enero del año siguiente.
    const { desde: startDate, hasta: endDate } = rangoConsultaDia(
      new Date(Date.UTC(year, 0, 1)),
      new Date(Date.UTC(year, 11, 31)),
    );

    const userWhere: any = { empresaId };
    // Acceso dinámico por cadena de aprobación. RRHH+ (>=90) ven todo y pueden
    // filtrar por sector; el resto sólo su propio sector, y sólo si están en la
    // cadena de aprobación de ese sector ("de supervisor para arriba" donde aplique).
    if (userNivel < 90) {
      const me = await prisma.usuario.findUnique({ where: { id: userId }, select: { sectorId: true } });
      const allowed = await puedeVerCalendario(prisma, { rolNivel: userNivel, empresaId, sectorId: me?.sectorId ?? null });
      if (!allowed) {
        res.status(403).json({ error: 'Sin permisos' });
        return;
      }
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
    type TramoGantt = {
      diagrama: {
        id: string; nombre: string; tipo: string;
        diasTrabajo: number | null; diasDescanso: number | null; diasSemana: number[];
      };
      fechaInicio: string;
      fechaFin: string | null;
    };
    type EmpleadoGantt = {
      id: string; nombre: string; apellido: string; legajo: string | null;
      sector: { id: string; nombre: string } | null;
      tramos?: TramoGantt[];
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

    // Optionally include ALL active employees in scope (even with no blocks),
    // so the Disponibilidad view can show one row per employee.
    if (req.query.todos === '1' || req.query.todos === 'true') {
      const todosEmpleados = await prisma.usuario.findMany({
        where: { ...userWhere, activo: true },
        select: { id: true, nombre: true, apellido: true, legajo: true, sector: { select: { id: true, nombre: true } } },
      });
      for (const u of todosEmpleados) ensureEmp(u);
    }

    // Sort employees by apellido, blocks by date
    const empleados = Array.from(empleadoMap.values())
      .sort((a, b) => a.apellido.localeCompare(b.apellido));
    for (const emp of empleados) {
      emp.bloques.sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio));
    }

    // Cada empleado va con TODOS sus tramos de diagrama del año: con uno solo, un
    // cambio a mitad de año pinta los descansos del diagrama nuevo también en los
    // meses anteriores.
    if (empleados.length > 0) {
      const asignaciones = await prisma.usuarioDiagrama.findMany({
        where: {
          usuarioId: { in: empleados.map((e) => e.id) },
          fechaInicio: { lte: endDate },
          OR: [{ fechaFin: null }, { fechaFin: { gte: startDate } }],
        },
        orderBy: { fechaInicio: 'asc' },
        select: {
          usuarioId: true, fechaInicio: true, fechaFin: true,
          diagrama: { select: { id: true, nombre: true, tipo: true, diasTrabajo: true, diasDescanso: true, diasSemana: true } },
        },
      });
      const tramosByUser = new Map<string, TramoGantt[]>();
      for (const a of asignaciones) {
        const lista = tramosByUser.get(a.usuarioId) ?? [];
        lista.push({
          diagrama: a.diagrama,
          fechaInicio: (a.fechaInicio as Date).toISOString(),
          fechaFin: a.fechaFin ? (a.fechaFin as Date).toISOString() : null,
        });
        tramosByUser.set(a.usuarioId, lista);
      }
      for (const e of empleados) e.tramos = tramosByUser.get(e.id) ?? [];
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

    const periodo = periodoQuerySchema.safeParse(req.query);
    if (!periodo.success) {
      res.status(400).json({ error: 'periodoInicio/periodoFin inválido', details: periodo.error.flatten() });
      return;
    }
    const filtroPeriodo = filtroFechaInicioEnPeriodo(periodo.data);
    if (filtroPeriodo.fechaInicio) {
      where = { AND: [where, filtroPeriodo] };
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
    // A propósito NO se pasa a hoyLocalEmpresa().getUTCFullYear(): este valor
    // tiene que seguir de acuerdo con el mismo `new Date(vacacion.createdAt).getFullYear()`
    // que leen /enviar, /avanzar, /rechazar, DELETE y mis-solicitudes.routes.ts
    // para ESTA misma solicitud (ver el comentario de arriba). Cambiar sólo la
    // creación desalinearía la fila de created con la de lectura durante la
    // ventana de 3 h del 31/12 si el proceso corre fuera de Argentina — el
    // mismo bug que esta limpieza vino a sacar, pero movido de lugar. Requiere
    // migrar junto los sitios que leen `createdAt` (fuera de esta tanda).
    const anio = new Date().getFullYear();

    // Check saldo from VacacionSaldo
    // `sectorId` y `rol` salen de la misma consulta porque son los que resuelven
    // el circuito más abajo: el dueño de la solicitud es siempre quien la crea.
    const usuario = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { fechaIngreso: true, sectorId: true, rol: true, nombre: true, apellido: true },
    });
    if (!usuario) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }

    const fechaInicio = parsed.data.fechaInicio;
    const fechaFin = parsed.data.fechaFin;
    const diasTotales = Math.ceil((fechaFin.getTime() - fechaInicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // El circuito se resuelve y se CONGELA acá, y no en /enviar, porque en
    // vacaciones el alta ES el envío: la solicitud nace PENDIENTE en el paso 1 y
    // nunca pasa por /enviar salvo que la rechacen. Desde este punto, tocar la
    // configuración de flujos no altera el recorrido de lo que ya está en vuelo.
    // (Lectura sola: va fuera de la transacción.)
    const flujo = await resolverFlujo(prisma, 'VACACION', {
      userId, empresaId, sectorId: usuario.sectorId,
    });
    const niveles = await nivelesPorRol(prisma, empresaId);
    const nivelSolicitante = niveles[usuario.rol] ?? 0;

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

      // Bloquear solapamiento con otra vacación vigente del mismo usuario. Que
      // distintas personas se solapen es esperable (lo muestra el calendario);
      // acá sólo evitamos que una misma persona tenga dos vacaciones pisadas.
      // Dentro de la tx Serializable para ser seguro ante inserts concurrentes.
      const solapada = await tx.vacacion.findFirst({
        where: {
          usuarioId: userId,
          estado: { notIn: ['RECHAZADA'] },
          fechaInicio: { lte: fechaFin },
          fechaFin: { gte: fechaInicio },
        },
        select: { id: true },
      });
      if (solapada) {
        throw Object.assign(new Error('VACACION_SOLAPADA'), {});
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
          // Se guarda SIEMPRE el arreglo, aunque venga vacío: un `[]` dice "se
          // envió sin circuito", que es un hecho del documento. Dejar la columna
          // en null lo haría indistinguible de una solicitud anterior a este
          // cambio y `pasosDe` caería al flujo vivo, así que si después le cargan
          // pasos a ese flujo la solicitud en vuelo empezaría a seguir la cadena
          // nueva — justo lo que el congelado tiene que impedir.
          circuitoSnapshot: circuito,
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

    // Acá el alta ES el envío, pero nunca se avisaba al aprobador del paso 1: la
    // solicitud solo aparecía cuando alguien miraba la bandeja. Fuera de la
    // transacción, como en el resto del archivo: un fallo del aviso no puede
    // revertir una solicitud ya creada.
    const solicitanteNombre = usuario ? `${usuario.nombre} ${usuario.apellido}` : 'Un empleado';
    await notificarAprobadoresPaso(
      userId, req.user!.empresaId,
      { rolAprobador: circuito[0]?.rolAprobador }, 'VACACION', solicitanteNombre,
    );

    res.status(201).json({
      ...vacacion,
      // Sin circuito la solicitud queda en la rama de escape del avance, que
      // exige nivel RRHH o superior: conviene que el empleado lo sepa al pedirla
      // y no cuando ve que nadie se la aprueba.
      avisoSinCircuito: circuito.length === 0
        ? 'Tu sector no tiene circuito de aprobación configurado: la solicitud va a requerir una aprobación manual de RRHH o superior.'
        : undefined,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'SALDO_INSUFICIENTE') {
      res.status(400).json({ error: `Saldo insuficiente. Disponible: ${(error as Error & { disponible: number }).disponible} días` });
      return;
    }
    if (error instanceof Error && error.message === 'VACACION_SOLAPADA') {
      res.status(409).json({ error: 'Ya tenés una vacación que se solapa con esas fechas' });
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
        usuario: { select: { id: true, nombre: true, apellido: true, empresaId: true, sectorId: true, supervisorId: true, coordinadorId: true, sector: { select: { nombre: true } } } },
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
    // Authorization: owner, RRHH/ADMIN, or a superior with scope over the owner.
    // Mirrors the list-scoping in GET /vacaciones so the detail never 403s a
    // record the list already shows (direct report or same sector).
    const isOwner = vacacion.usuario.id === userId;
    const isSameCompany = vacacion.usuario.empresaId === empresaId;
    let autorizado = isOwner || (isSameCompany && userNivel >= 90);
    if (!autorizado && isSameCompany && userNivel >= 60) {
      const owner = vacacion.usuario;
      if (owner.supervisorId === userId || owner.coordinadorId === userId) {
        autorizado = true;
      } else if (owner.sectorId) {
        const me = await prisma.usuario.findUnique({ where: { id: userId }, select: { sectorId: true } });
        if (me?.sectorId && me.sectorId === owner.sectorId) autorizado = true;
      }
    }
    if (!autorizado) {
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

    // `sectorId` y `rol` resuelven el circuito; `nombre`/`apellido` van en el
    // aviso a los aprobadores. El dueño es siempre quien envía: el findFirst de
    // arriba filtra por `usuarioId: req.user!.userId`.
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user!.userId },
      select: { sectorId: true, rol: true, nombre: true, apellido: true },
    });

    // El circuito se resuelve recién ahora y queda CONGELADO en la solicitud: a
    // partir de acá, tocar la configuración de flujos no altera el recorrido de
    // lo que ya está en vuelo. Un reenvío después de un rechazo es un envío
    // nuevo, así que vuelve a resolver y a congelar.
    const flujo = await resolverFlujo(prisma, 'VACACION', {
      userId: vacacion.usuarioId,
      empresaId: req.user!.empresaId,
      sectorId: usuario?.sectorId ?? null,
    });
    const niveles = await nivelesPorRol(prisma, req.user!.empresaId);
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
          data: {
            estado: 'PENDIENTE',
            pasoActual: 1,
            obsRechazo: null,
            flujoId: flujo?.id ?? null,
            // Se guarda SIEMPRE el arreglo, aunque venga vacío, y nunca
            // `undefined`:
            //  - con `undefined` Prisma ni toca la columna, así que al reenviar
            //    una solicitud rechazada cuyo sector se quedó sin flujo quedaría
            //    pegado el snapshot viejo — el circuito fantasma que este cambio
            //    viene a eliminar;
            //  - con `DbNull` el vacío sería indistinguible de una solicitud
            //    anterior a este cambio, y `pasosDe` caería al flujo vivo. Si
            //    después le cargan pasos a ese flujo, la solicitud en vuelo
            //    empezaría a seguir la cadena nueva, que es exactamente lo que el
            //    congelado tiene que impedir.
            // Un `[]` guardado dice "se envió sin circuito", que es un hecho del
            // documento y no una ausencia de dato.
            circuitoSnapshot: circuito,
          },
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
    const solicitanteNombre = usuario ? `${usuario.nombre} ${usuario.apellido}` : 'Un empleado';
    // El rol sale del circuito recién congelado, no de `vacacion.flujoId`: la fila
    // que cargamos al principio del handler es la de ANTES del update, y ahí un
    // borrador no tiene flujo, así que nadie recibiría el aviso. Además el
    // snapshot está renumerado desde 1, con lo que buscar el paso vivo por
    // `(flujoId, orden)` le avisaría al rol equivocado.
    await notificarAprobadoresPaso(
      vacacion.usuarioId, req.user!.empresaId,
      { rolAprobador: circuito[0]?.rolAprobador }, 'VACACION', solicitanteNombre,
    );

    res.json({
      ...updated,
      // Sin circuito la solicitud queda en la rama de escape del avance, que
      // exige nivel RRHH o superior: conviene que el empleado lo sepa al enviarla
      // y no cuando ve que nadie se la aprueba.
      avisoSinCircuito: circuito.length === 0
        ? 'Tu sector no tiene circuito de aprobación configurado: la solicitud va a requerir una aprobación manual de RRHH o superior.'
        : undefined,
    });
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
    // Nadie aprueba lo suyo, ni siquiera un ADMIN. Con la regla por nivel esto es
    // crítico: un RRHH que envía conserva el paso RRHH en su circuito.
    if (vacacion.usuarioId === req.user!.userId) {
      res.status(403).json({ error: 'No podés aprobar ni rechazar tu propia solicitud de vacaciones' });
      return;
    }
    if (vacacion.estado !== 'PENDIENTE' && vacacion.estado !== 'EN_REVISION') {
      res.status(400).json({ error: 'La vacación no está pendiente de revisión' });
      return;
    }

    // El circuito congelado al enviar; los pasos vivos del flujo son sólo el
    // fallback de las solicitudes anteriores a este cambio.
    const pasos = pasosDe(vacacion);
    const totalPasos = pasos.length;
    const pasoActual = vacacion.pasoActual;
    let nuevoEstado: VacacionEstado;
    let nuevoPaso: number;
    // El rol del paso que se está FIRMANDO, para dejarlo escrito en el historial.
    // Queda en null en la rama sin circuito: ahí no hay paso que firmar.
    let rolPasoAprobado: string | null = null;

    // pasoActual is 1-based (matches el `orden` del circuito).
    // Sin circuito, o con un pasoActual que quedó fuera de él: con el snapshot ya
    // no pasa por editar el flujo mientras la solicitud circula, pero sigue
    // cubriendo las solicitudes viejas sin snapshot, que leen los pasos vivos.
    if (pasoActual > totalPasos || totalPasos === 0) {
      // Sin circuito: se exige RRHH o superior. La guarda de autoaprobación que
      // vivía acá ya la cubre la general del principio del handler.
      if ((req.user!.rolNivel ?? 0) < 90) {
        res.status(403).json({ error: 'Se requiere nivel RRHH o superior para aprobar una vacación sin flujo definido' });
        return;
      }
      nuevoEstado = 'APROBADA';
      nuevoPaso = pasoActual;
    } else {
      const pasoConfig = pasoActualDe(vacacion);
      if (!pasoConfig) {
        res.status(500).json({ error: `Configuración de paso ${pasoActual} no encontrada en el circuito` });
        return;
      }
      const approverSectorId = (await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { sectorId: true } }))?.sectorId ?? null;
      if (!isResponsibleApprover(pasoConfig.rolAprobador, vacacion.usuario, req.user!.userId, req.user!.rol, req.user!.rolNivel ?? 0, approverSectorId)) {
        res.status(403).json({ error: `No tenés autorización para aprobar esta vacación en el paso de ${pasoConfig.rolAprobador}` });
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
        const { count } = await tx.vacacion.updateMany({
          where: { id: vacId, pasoActual: pasoActual },
          data: {
            estado: nuevoEstado,
            pasoActual: nuevoPaso,
            ...(nuevoEstado === 'APROBADA' ? { aprobadaPorId: req.user!.userId, aprobadaAt: new Date() } : {}),
          },
        });
        if (count === 0) throw new Error('CONCURRENT_MODIFICATION');

        // Duplicate check inside tx scoped to current submission.
        // Se compara contra el paso que se está APROBANDO, no contra el destino:
        // lo que hay que impedir es que la misma persona firme dos veces el mismo
        // recorrido, y con el destino la comparación se corría un paso.
        const lastSubmission = await tx.vacacionHistorial.findFirst({
          where: { vacacionId: vacId, estadoNuevo: 'PENDIENTE' },
          orderBy: { createdAt: 'desc' },
        });
        const yaAprobo = await tx.vacacionHistorial.findFirst({
          where: {
            vacacionId: vacId,
            usuarioId: req.user!.userId,
            pasoFlujo: vacacion.pasoActual,
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
            // El paso FIRMADO, no el destino: el historial tiene que decir por
            // dónde pasó la solicitud, y el destino ni siquiera existe cuando la
            // firma es la última del circuito.
            pasoFlujo: pasoActual,
            rolAprobador: rolPasoAprobado,
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
        vacacion.usuarioId, req.user!.empresaId,
        // El rol sale del circuito de ESTA solicitud: `nuevoPaso` indexa el
        // snapshot renumerado, no la cadena configurada.
        { rolAprobador: pasos.find((p) => p.orden === nuevoPaso)?.rolAprobador },
        'VACACION', ownerNombre,
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

    // Nadie rechaza lo suyo: mismo criterio que en /avanzar.
    if (vacacion.usuarioId === req.user!.userId) {
      res.status(403).json({ error: 'No podés aprobar ni rechazar tu propia solicitud de vacaciones' });
      return;
    }

    // Explicit state guard (mirrors /avanzar): rechazar sólo aplica a una vacación
    // en revisión. Devuelve 400 claro en vez del 409 "modificada simultáneamente"
    // del guard transaccional, que sólo debe dispararse ante una carrera real.
    if (vacacion.estado !== 'PENDIENTE' && vacacion.estado !== 'EN_REVISION') {
      res.status(400).json({ error: 'La vacación no está en estado de revisión' });
      return;
    }

    // Verify the caller is the responsible approver for this step (el paso sale
    // del circuito congelado; los pasos vivos son el fallback de lo viejo)
    const currentStep = pasoActualDe(vacacion);
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
        // Dónde se cortó el circuito. La transacción de arriba ya dejó
        // `pasoActual` en 0, así que el valor sale de la fila que se leyó ANTES
        // de rechazar: sin esto el historial no dice en qué paso murió.
        pasoFlujo: vacacion.pasoActual,
        rolAprobador: currentStep.rolAprobador,
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
