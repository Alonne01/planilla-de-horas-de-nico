import { Router, Response } from 'express';
import { PrismaClient, PlanillaEstado, LugarTrabajo, PernocteEnum, Prisma, AusenciaTipo } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { z } from 'zod';
import { fechaFlexible, spanDiasCalendario } from '../utils/zod.utils.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_SUPERVISOR, LEVEL_RRHH, LEVEL_ADMIN } from '../middleware/roles.middleware.js';
import { notificarPlanilla, notificarAprobadoresPaso } from '../utils/notificacion.utils.js';
import { getFlowVisibleUserIds } from '../utils/visibility.utils.js';
import { isResponsibleApprover } from '../utils/approval-auth.utils.js';
import {
  calcularHorasRegistro,
  getEmpresaConfig,
  recalcularTotalesPlanilla,
  getPeriodoActual,
} from '../utils/calculo.utils.js';
import { backfillAusenciasEnPlanilla, inyectarDiasBloqueados, formatTipoAusencia } from '../utils/ausencia-calendar.utils.js';
import { logAuditoria } from '../lib/auditoria.js';
import { devolverSaldoDeMarca, borrarAdjuntosDeMarcas } from '../utils/marca-manual.utils.js';
import { contextoDelDia, feriadosDeEmpresa } from '../utils/contexto-dia.utils.js';
import { tramosDeUsuario, esFrancoEnFecha } from '../utils/diagrama-vigencia.utils.js';
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

/** Campos horarios que comparten el POST y el PUT de un registro. */
type DatosRegistro = {
  entradaTurno1?: string | null;
  salidaTurno1?: string | null;
  entradaTurno2?: string | null;
  salidaTurno2?: string | null;
  lugarTrabajo?: LugarTrabajo | null;
  esFrancoCompensatorio?: boolean;
  horasViajeInput?: number;
  maneja?: boolean;
};

/**
 * Calcula las horas de un día derivando el contexto en el servidor.
 *
 * `esFeriado` y `esFrancoTrabajado` deciden si la jornada entera se paga al 100%,
 * y antes los mandaba el navegador desde un calendario en localStorage. Ahora
 * salen de la configuración de la empresa y del diagrama del usuario: lo que
 * llegue en el body se ignora.
 *
 * Se calcula dos veces porque `hayTrabajo` depende de las horas y los flags no
 * afectan el total, sólo cómo se reparte entre normales y al 100%.
 */
async function calcularConContexto(
  datos: DatosRegistro,
  fecha: Date,
  usuarioId: string,
  empresaId: string,
  config: Awaited<ReturnType<typeof getEmpresaConfig>>,
) {
  const horarios = {
    entradaTurno1: datos.entradaTurno1 ? new Date(datos.entradaTurno1) : null,
    salidaTurno1: datos.salidaTurno1 ? new Date(datos.salidaTurno1) : null,
    entradaTurno2: datos.entradaTurno2 ? new Date(datos.entradaTurno2) : null,
    salidaTurno2: datos.salidaTurno2 ? new Date(datos.salidaTurno2) : null,
    lugarTrabajo: datos.lugarTrabajo ?? null,
    horasViajeInput: datos.horasViajeInput ?? 2,
    maneja: datos.maneja ?? false,
  };

  const sinRecargo = calcularHorasRegistro(
    { ...horarios, esFeriado: false, esFrancoTrabajado: false },
    config,
  );
  // Un compensatorio no es jornada trabajada: no convierte el franco en trabajado.
  const hayTrabajo = sinRecargo.horasTrabajadas > 0 && !datos.esFrancoCompensatorio;

  const { esFeriado, esFrancoTrabajado } = await contextoDelDia(
    usuarioId, empresaId, fecha, hayTrabajo,
  );

  const calculo = calcularHorasRegistro({ ...horarios, esFeriado, esFrancoTrabajado }, config);
  return { calculo, esFeriado, esFrancoTrabajado };
}

/** Check if the current user can access a planilla (by fetching the planilla's owner info) */
async function assertPlanillaAccess(req: AuthRequest, planillaId: string): Promise<boolean> {
  const planilla = await prisma.planilla.findUnique({
    where: { id: planillaId },
    select: { usuarioId: true, usuario: { select: { empresaId: true } } },
  });
  if (!planilla || planilla.usuario.empresaId !== req.user!.empresaId) return false;
  if (planilla.usuarioId === req.user!.userId) return true;
  const nivel = req.user!.rolNivel ?? 0;
  if (nivel >= 90) return true;
  if (nivel < 60) return false;
  const visibleIds = await getFlowVisibleUserIds(
    prisma, req.user!.userId, req.user!.empresaId, req.user!.rol, nivel, 'PLANILLA',
  );
  return visibleIds.includes(planilla.usuarioId);
}

// ─── Schemas ─────────────────────────────────────

// Una planilla cubre un ciclo mensual. El techo es generoso a propósito (períodos
// partidos, ciclos reconfigurados), pero acota el bucle día-por-día de /:id/enviar:
// sin él, un período de años bloquea el event loop del proceso entero.
const MAX_DIAS_PERIODO = 366;

const createPlanillaSchema = z.object({
  periodoInicio: fechaFlexible.optional(),
  periodoFin: fechaFlexible.optional(),
}).refine(
  (d) => !d.periodoInicio || !d.periodoFin
    || spanDiasCalendario(d.periodoInicio, d.periodoFin) <= MAX_DIAS_PERIODO,
  { message: `El período no puede superar los ${MAX_DIAS_PERIODO} días`, path: ['periodoFin'] },
);

// Turno horario: fecha/hora válida, o cadena vacía / null / ausente
const horaOpcional = z.union([fechaFlexible, z.literal('')]).nullable().optional();

const createRegistroSchema = z.object({
  fecha: fechaFlexible,
  entradaTurno1: horaOpcional,
  salidaTurno1: horaOpcional,
  entradaTurno2: horaOpcional,
  salidaTurno2: horaOpcional,
  lugarTrabajo: z.nativeEnum(LugarTrabajo).nullable().optional(),
  pernocte: z.nativeEnum(PernocteEnum).optional(),
  maneja: z.boolean().optional(),
  horasViajeInput: z.number().min(0).max(24).optional(),
  // esFeriado y esFrancoTrabajado se siguen aceptando para no romper a una PWA
  // vieja que quedó en cache, pero se IGNORAN: los deriva calcularConContexto().
  esFeriado: z.boolean().optional(),
  esFrancoCompensatorio: z.boolean().optional(),
  esFrancoTrabajado: z.boolean().optional(),
  distanciaViaje: z.string().max(50).nullable().optional(),
  observaciones: z.string().max(500).nullable().optional(),
  proyectoId: z.string().uuid().nullable().optional(),
});

// PUT identifica el registro por :rid, por lo que `fecha` es opcional
// (si se omite, se conserva la fecha del registro existente).
const updateRegistroSchema = createRegistroSchema.extend({ fecha: z.string().optional() });

// ─── GET /planillas ──────────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const empresaId = req.user!.empresaId;
    const estado = req.query.estado as string | undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    // Flow-based visibility: who can see which planillas depends on approval flow config
    const nivel = req.user!.rolNivel ?? 0;
    if (nivel < 60) {
      // OPERADOR: solo sus propias planillas
      where.usuarioId = userId;
    } else if (nivel >= 90) {
      // RRHH/ADMIN: toda la empresa
      where.usuario = { empresaId };
    } else {
      // SUPERVISOR/COORDINADOR/GERENTE: gated by approval flow
      const visibleIds = await getFlowVisibleUserIds(
        prisma, userId, empresaId, req.user!.rol, nivel, 'PLANILLA',
      );
      where.usuarioId = { in: visibleIds };
    }

    if (estado) {
      const raw = Array.isArray(estado) ? estado.join(',') : String(estado);
      const estados = raw.split(',').map(s => s.trim()).filter(Boolean);
      where.estado = estados.length === 1 ? estados[0] : { in: estados };
    }

    const periodoInicio = req.query.periodoInicio as string | undefined;
    const periodoFin = req.query.periodoFin as string | undefined;
    if (periodoInicio) {
      const d = new Date(periodoInicio);
      if (isNaN(d.getTime())) { res.status(400).json({ error: 'periodoInicio inválido' }); return; }
      where.periodoInicio = { gte: d };
    }
    if (periodoFin) {
      const fin = new Date(periodoFin);
      if (isNaN(fin.getTime())) { res.status(400).json({ error: 'periodoFin inválido' }); return; }
      fin.setHours(23, 59, 59, 999);
      where.periodoFin = { lte: fin };
    }

    const planillas = await prisma.planilla.findMany({
      where,
      include: {
        usuario: {
          select: {
            id: true, nombre: true, apellido: true, legajo: true,
            sector: { select: { nombre: true } },
          },
        },
        _count: { select: { registros: true } },
      },
      orderBy: { periodoInicio: 'desc' },
    });

    res.json(planillas.map((p) => ({
      ...p,
      registrosCount: p._count.registros,
      _count: undefined,
    })));
  } catch (error) {
    console.error('Error listing planillas:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /planillas ─────────────────────────────

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createPlanillaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const userId = req.user!.userId;
    const empresaId = req.user!.empresaId;

    const config = await prisma.empresaConfig.findUnique({ where: { empresaId } });
    const diaInicio = config?.periodoDiaInicio ?? 21;
    const diaFin = config?.periodoDiaFin ?? 20;

    let periodoInicio: Date;
    let periodoFin: Date;

    if (parsed.data.periodoInicio && parsed.data.periodoFin) {
      periodoInicio = new Date(parsed.data.periodoInicio);
      periodoFin = new Date(parsed.data.periodoFin);
      if (periodoFin < periodoInicio) {
        res.status(400).json({ error: 'El fin del período no puede ser anterior al inicio' });
        return;
      }
    } else {
      const periodo = getPeriodoActual(diaInicio, diaFin);
      periodoInicio = periodo.inicio;
      periodoFin = periodo.fin;
    }

    // Check: only one planilla per user per cycle (no overlapping periods)
    const existing = await prisma.planilla.findFirst({
      where: {
        usuarioId: userId,
        OR: [
          // Exact match
          { periodoInicio, periodoFin },
          // Any overlap with the requested period
          {
            periodoInicio: { lte: periodoFin },
            periodoFin: { gte: periodoInicio },
          },
        ],
      },
    });
    if (existing) {
      res.status(409).json({ error: 'Ya existe una planilla para este ciclo mensual', planillaId: existing.id });
      return;
    }

    // El borrador no ata ningún flujo: se resuelve y se congela al ENVIAR. Un
    // borrador puede vivir semanas antes de enviarse, y resolver acá lo hacía
    // circular por la configuración que existía cuando se creó.
    const planilla = await prisma.planilla.create({
      data: {
        usuarioId: userId,
        periodoInicio,
        periodoFin,
        flujoId: null,
      },
      include: {
        usuario: { select: { id: true, nombre: true, apellido: true } },
      },
    });

    await prisma.planillaHistorial.create({
      data: {
        planillaId: planilla.id,
        usuarioId: userId,
        estadoNuevo: 'BORRADOR',
      },
    });

    // Back-fill locked entries for approved absences/vacations in this period
    await backfillAusenciasEnPlanilla(planilla.id, userId, periodoInicio, periodoFin);

    res.status(201).json(planilla);
  } catch (error) {
    console.error('Error creating planilla:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /planillas/feriados ─────────────────────
//
// Los feriados que el servidor va a usar para el recargo del 100%. El calendario
// del front los pinta desde acá: si el front tuviera su propia lista, mostraría
// un feriado que la liquidación no paga (o al revés).
// Va ANTES de /:id, si no Express lo toma como un id de planilla.

router.get('/feriados', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const mapa = await feriadosDeEmpresa(req.user!.empresaId);
    res.json(Object.fromEntries(mapa));
  } catch (error) {
    console.error('Error listing feriados:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /planillas/:id ──────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: {
        usuario: {
          select: {
            id: true, nombre: true, apellido: true, legajo: true,
            empresaId: true, sectorId: true, supervisorId: true, coordinadorId: true,
            sector: { select: { nombre: true } },
            diagramas: {
              where: { activo: true },
              take: 1,
              select: { diagrama: { select: { nombre: true } } },
            },
          },
        },
        registros: {
          orderBy: { fecha: 'asc' },
          include: {
            proyecto: { select: { codigo: true, nombre: true } },
            marcaManual: { select: { id: true, estado: true, tipo: true, cargadaPorId: true, aprobadaPorId: true, archivoUrl: true } },
          },
        },
        flujo: { select: { nombre: true, pasos: { orderBy: { orden: 'asc' } } } },
      },
    });

    if (!planilla || planilla.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }

    // Authorization: verify the caller can see this planilla
    const nivel = req.user!.rolNivel ?? 0;
    const isOwn = planilla.usuario.id === req.user!.userId;
    if (!isOwn && nivel < 90) {
      if (nivel < 60) {
        res.status(403).json({ error: 'Sin permisos para ver esta planilla' });
        return;
      }
      const visibleIds = await getFlowVisibleUserIds(
        prisma, req.user!.userId, req.user!.empresaId, req.user!.rol, nivel, 'PLANILLA',
      );
      if (!visibleIds.includes(planilla.usuario.id)) {
        // Allow access if user is the responsible approver for the current step.
        // El paso sale del circuito congelado: si se leyeran los pasos vivos, un
        // cambio de configuración le abriría (o le cerraría) la planilla a alguien
        // que no es el aprobador real de este documento.
        const currentStep = pasoActualDe(planilla);
        const isPendingReview = planilla.estado === 'ENVIADA' || planilla.estado === 'EN_REVISION';
        const approverSectorId = (await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { sectorId: true } }))?.sectorId ?? null;
        if (!isPendingReview || !currentStep || !isResponsibleApprover(currentStep.rolAprobador, planilla.usuario, req.user!.userId, req.user!.rol, nivel, approverSectorId)) {
          res.status(403).json({ error: 'Sin permisos para ver esta planilla' });
          return;
        }
      }
    }

    // Los tramos de diagrama que cubren el período: el calendario del front pinta
    // los francos con ellos, así una planilla partida por un cambio de diagrama se
    // ve igual que se liquida.
    const tramosDiagrama = await tramosDeUsuario(
      planilla.usuarioId,
      planilla.periodoInicio,
      planilla.periodoFin,
    );

    res.json({ ...planilla, tramosDiagrama });
  } catch (error) {
    console.error('Error getting planilla:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /planillas/:id/enviar ──────────────────

router.post('/:id/enviar', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    const planilla = await prisma.planilla.findFirst({
      where: { id: planillaId, usuarioId: req.user!.userId },
    });
    if (!planilla) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }
    if (planilla.estado !== 'BORRADOR' && planilla.estado !== 'RECHAZADA') {
      res.status(400).json({ error: 'Solo se puede enviar una planilla en BORRADOR o RECHAZADA' });
      return;
    }

    // Defensive guard: an inverted period would make the completeness loop run zero
    // times, letting an empty planilla slip into the approval pipeline.
    if (new Date(planilla.periodoFin) < new Date(planilla.periodoInicio)) {
      res.status(400).json({ error: 'El período de la planilla es inválido (fin anterior al inicio)' });
      return;
    }

    // Cota dura antes del recorrido día-por-día: cubre las planillas creadas antes
    // de que el schema validara la amplitud del período.
    const diasPeriodo = spanDiasCalendario(
      planilla.periodoInicio.toISOString(),
      planilla.periodoFin.toISOString(),
    );
    if (diasPeriodo > MAX_DIAS_PERIODO) {
      res.status(400).json({
        error: `El período de la planilla es inválido (${diasPeriodo} días, máximo ${MAX_DIAS_PERIODO})`,
      });
      return;
    }

    // Validate completeness: days must have a registro UNLESS they are franco (rest) days or feriados
    const registros = await prisma.registroHoras.findMany({
      where: { planillaId },
      select: { fecha: true, bloqueado: true, lugarTrabajo: true, horasTrabajadas: true, entradaTurno1: true },
    });

    // Look up user's active diagram to determine franco days.
    // `sectorId` y `rol` salen de la misma consulta porque son los que resuelven
    // el circuito más abajo: el dueño de la planilla es siempre quien la envía
    // (el findFirst filtra por `usuarioId: req.user!.userId`).
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user!.userId },
      select: { empresaId: true, sectorId: true, rol: true },
    });
    // Tramos que cubren el período: un cambio de diagrama aprobado a mitad de
    // ciclo parte el período, y con una sola asignación la validación reclama
    // días que eran franco (o deja pasar días laborables sin cargar).
    const tramos = await tramosDeUsuario(
      req.user!.userId,
      new Date(planilla.periodoInicio),
      new Date(planilla.periodoFin),
    );

    // Feriados vigentes: los mismos que usa el cálculo del recargo (nacionales ∪
    // los de la empresa), para que la planilla no exija cargar un día que el
    // cálculo trata como feriado.
    const feriadosDates = usuario
      ? new Set((await feriadosDeEmpresa(usuario.empresaId)).keys())
      : new Set<string>();

    // Franco por diagrama: misma fuente que deriva esFrancoTrabajado al guardar.
    function esDiaFranco(fecha: Date): boolean {
      return esFrancoEnFecha(tramos, fecha);
    }

    const inicio = new Date(planilla.periodoInicio);
    const fin = new Date(planilla.periodoFin);
    const diasFaltantes: string[] = [];

    // Índice por fecha: evita recorrer todos los registros en cada día del período
    const registrosPorFecha = new Map<string, (typeof registros)[number]>();
    for (const r of registros) {
      const rDate = new Date(r.fecha).toISOString().split('T')[0] as string;
      if (!registrosPorFecha.has(rDate)) registrosPorFecha.set(rDate, r);
    }

    for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0] as string;

      // Skip franco (rest) days — no registro needed
      if (esDiaFranco(d)) continue;
      // Skip feriados — no registro needed
      if (feriadosDates.has(dateStr)) continue;

      const reg = registrosPorFecha.get(dateStr);

      if (!reg) {
        diasFaltantes.push(dateStr);
      } else if (!reg.bloqueado && !reg.lugarTrabajo && !reg.entradaTurno1) {
        diasFaltantes.push(dateStr);
      }
    }

    if (diasFaltantes.length > 0) {
      res.status(400).json({
        error: `Faltan completar ${diasFaltantes.length} día(s) en la planilla`,
        diasFaltantes,
      });
      return;
    }

    // El circuito se resuelve recién ahora y queda CONGELADO en la planilla: a
    // partir de acá, tocar la configuración de flujos no altera el recorrido de
    // lo que ya está en vuelo. Un reenvío después de un rechazo es un envío
    // nuevo, así que vuelve a resolver y a congelar.
    const flujo = await resolverFlujo(prisma, 'PLANILLA', {
      userId: planilla.usuarioId,
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

    const updated = await prisma.planilla.update({
      where: { id: planillaId },
      data: {
        estado: 'ENVIADA',
        pasoActual: 1,
        enviadaAt: new Date(),
        obsRechazo: null,
        flujoId: flujo?.id ?? null,
        // Se guarda SIEMPRE el arreglo, aunque venga vacío, y nunca `undefined`:
        //  - con `undefined` Prisma ni toca la columna, así que al reenviar una
        //    planilla rechazada cuyo sector se quedó sin flujo quedaría pegado el
        //    snapshot viejo — el circuito fantasma que este cambio viene a eliminar;
        //  - con `DbNull` el vacío sería indistinguible de una planilla anterior a
        //    este cambio, y `pasosDe` caería al flujo vivo. Si después le cargan
        //    pasos a ese flujo, la planilla en vuelo empezaría a seguir la cadena
        //    nueva, que es exactamente lo que el congelado tiene que impedir.
        // Un `[]` guardado dice "se envió sin circuito", que es un hecho del
        // documento y no una ausencia de dato.
        circuitoSnapshot: circuito,
      },
    });

    if ((process.env.DEBUG_APPROVALS === '1' || process.env.DEBUG_APPROVALS === 'true')) {
      console.log(`[ENVIAR PLANILLA] planilla=${planillaId.slice(-6)} flujo=${flujo?.id.slice(-6) ?? 'NONE'} user=${req.user!.userId.slice(-6)} nivel=${nivelSolicitante} → pasos=${circuito.length} pasoActual=1`);
    }

    await prisma.planillaHistorial.create({
      data: {
        planillaId: planilla.id,
        usuarioId: req.user!.userId,
        estadoAnterior: planilla.estado,
        estadoNuevo: 'ENVIADA',
      },
    });

    // Notify step 1 approvers
    const solicitante = await prisma.usuario.findUnique({
      where: { id: req.user!.userId },
      select: { nombre: true, apellido: true },
    });
    const solicitanteNombre = solicitante ? `${solicitante.nombre} ${solicitante.apellido}` : 'Un empleado';
    // El flujo recién resuelto, no `planilla.flujoId`: la fila que cargamos al
    // principio del handler es la de ANTES del update y ahí el borrador no tiene
    // flujo, así que nadie recibiría el aviso.
    await notificarAprobadoresPaso(
      planilla.usuarioId, req.user!.empresaId,
      { rolAprobador: circuito[0]?.rolAprobador }, 'PLANILLA', solicitanteNombre,
    );

    res.json({
      ...updated,
      // Sin circuito la planilla queda en la rama de escape del avance, que exige
      // nivel RRHH o superior: conviene que el empleado lo sepa al enviarla y no
      // cuando nadie se la aprueba.
      avisoSinCircuito: circuito.length === 0
        ? 'Tu sector no tiene circuito de aprobación configurado: la planilla va a requerir una aprobación manual de RRHH o superior.'
        : undefined,
    });
  } catch (error) {
    console.error('Error al enviar planilla:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /planillas/:id/avanzar ─────────────────

router.post('/:id/avanzar', requireLevel(LEVEL_SUPERVISOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: {
        flujo: { include: { pasos: { orderBy: { orden: 'asc' } } } },
        usuario: { select: { id: true, empresaId: true, sectorId: true, supervisorId: true, coordinadorId: true } },
      },
    });

    if (!planilla || planilla.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }
    // Nadie aprueba lo suyo, ni siquiera un ADMIN. Con la regla por nivel esto es
    // crítico: un RRHH que envía conserva el paso RRHH en su circuito.
    if (planilla.usuarioId === req.user!.userId) {
      res.status(403).json({ error: 'No podés aprobar ni rechazar tu propia planilla' });
      return;
    }
    if (planilla.estado !== 'ENVIADA' && planilla.estado !== 'EN_REVISION') {
      res.status(400).json({ error: 'La planilla no está en estado de revisión' });
      return;
    }

    // El circuito congelado al enviar; los pasos vivos del flujo son sólo el
    // fallback de las planillas anteriores a este cambio.
    const pasos = pasosDe(planilla);
    const totalPasos = pasos.length;
    const pasoActual = planilla.pasoActual;

    let nuevoEstado: PlanillaEstado;
    let nuevoPaso: number;
    // El rol del paso que se está FIRMANDO, para dejarlo escrito en el historial.
    // Queda en null en la rama sin circuito: ahí no hay paso que firmar.
    let rolPasoAprobado: string | null = null;

    // pasoActual is 1-based (matches FlujoPaso.orden). 0 = not started, 1..N = current step.
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
      const pasoConfig = pasoActualDe(planilla);
      if (!pasoConfig) {
        res.status(500).json({ error: `Configuración de paso ${pasoActual} no encontrada en el circuito` });
        return;
      }
      const approverSectorId = (await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { sectorId: true } }))?.sectorId ?? null;
      if ((process.env.DEBUG_APPROVALS === '1' || process.env.DEBUG_APPROVALS === 'true')) {
        console.log(`[AVANZAR PLANILLA] planilla=${planillaId.slice(-6)} paso=${pasoActual}/${totalPasos} rolPaso=${pasoConfig.rolAprobador} approver=${req.user!.userId.slice(-6)} rol=${req.user!.rol} sector=${approverSectorId?.slice(-6)} ownerSector=${planilla.usuario.sectorId?.slice(-6)}`);
      }
      if (!isResponsibleApprover(pasoConfig.rolAprobador, planilla.usuario, req.user!.userId, req.user!.rol, req.user!.rolNivel ?? 0, approverSectorId)) {
        res.status(403).json({ error: `No tenés autorización para aprobar esta planilla en el paso de ${pasoConfig.rolAprobador}` });
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
        const { count } = await tx.planilla.updateMany({
          where: { id: planillaId, pasoActual: planilla.pasoActual },
          data: {
            estado: nuevoEstado,
            pasoActual: nuevoPaso,
            ...(nuevoEstado === 'APROBADA' ? { aprobadaPorId: req.user!.userId, aprobadaAt: new Date() } : {}),
          },
        });
        if (count === 0) throw new Error('CONCURRENT_MODIFICATION');

        // Duplicate check INSIDE transaction (after row lock acquired by UPDATE).
        // Se compara contra el paso que se está APROBANDO, no contra el destino:
        // lo que hay que impedir es que la misma persona firme dos veces el mismo
        // recorrido, y con el destino la comparación se corría un paso.
        const yaAprobo = await tx.planillaHistorial.findFirst({
          where: {
            planillaId,
            usuarioId: req.user!.userId,
            pasoFlujo: planilla.pasoActual,
            createdAt: { gt: planilla.enviadaAt ?? new Date(0) },
          },
        });
        if (yaAprobo) {
          throw new Error('DUPLICATE_APPROVAL');
        }

        if (nuevoEstado === 'APROBADA') {
          const registros = await tx.registroHoras.findMany({
            where: { planillaId: planilla.id },
          });

          const francosTrabajados = registros.filter(r => r.esFrancoTrabajado).length;
          const compensatoriosUsados = registros.filter(r => r.esFrancoCompensatorio).length;

          if (francosTrabajados > 0 || compensatoriosUsados > 0) {
            const anio = new Date(planilla.periodoInicio).getFullYear();
            await tx.vacacionSaldo.upsert({
              where: { usuarioId_anio: { usuarioId: planilla.usuarioId, anio } },
              create: {
                usuarioId: planilla.usuarioId,
                anio,
                diasCorrespondientes: 0,
                compensatoriosAcumulados: francosTrabajados,
                compensatoriosUsados: compensatoriosUsados,
              },
              update: {
                compensatoriosAcumulados: { increment: francosTrabajados },
                ...(compensatoriosUsados > 0 ? {
                  compensatoriosPendientes: { decrement: compensatoriosUsados },
                  compensatoriosUsados: { increment: compensatoriosUsados },
                } : {}),
              },
            });
          }

          // Las marcas manuales viajan con la planilla: la firma que aprueba la
          // planilla aprueba también los días que el dueño cargó a mano. No hay
          // doble conteo con el upsert de arriba: ese cuenta por
          // `registro.esFrancoCompensatorio`, y `inyectarDiasBloqueados` no setea
          // esa columna en los días de marca manual.
          const marcas = await tx.ausencia.findMany({
            where: { planillaId: planilla.id, cargaManual: true, estado: 'PENDIENTE' },
          });
          for (const m of marcas) {
            await tx.ausencia.update({
              where: { id: m.id },
              data: { estado: 'APROBADA', aprobada: true, aprobadaPorId: req.user!.userId, aprobadaAt: new Date() },
            });
            await tx.ausenciaHistorial.create({
              data: {
                ausenciaId: m.id,
                usuarioId: req.user!.userId,
                estadoAnterior: 'PENDIENTE',
                estadoNuevo: 'APROBADA',
                comentario: 'Aprobada junto con la planilla',
              },
            });
            if (m.tipo === 'FRANCO_COMPENSATORIO') {
              const anioMarca = new Date(m.fechaInicio).getFullYear();
              await tx.vacacionSaldo.update({
                where: { usuarioId_anio: { usuarioId: m.usuarioId, anio: anioMarca } },
                data: { compensatoriosPendientes: { decrement: 1 }, compensatoriosUsados: { increment: 1 } },
              });
            }
          }
        }

        await tx.planillaHistorial.create({
          data: {
            planillaId: planilla.id,
            usuarioId: req.user!.userId,
            estadoAnterior: planilla.estado,
            estadoNuevo: nuevoEstado,
            // El paso FIRMADO, no el destino: el historial tiene que decir por
            // dónde pasó la planilla, y el destino ni siquiera existe cuando la
            // firma es la última del circuito.
            pasoFlujo: pasoActual,
            rolAprobador: rolPasoAprobado,
            comentario: req.body?.comentario ?? null,
          },
        });

        return tx.planilla.findUnique({ where: { id: planillaId } });
      });
    } catch (error: any) {
      if (error?.message === 'DUPLICATE_APPROVAL') {
        res.status(409).json({ error: 'Ya aprobaste este paso. No se puede aprobar dos veces.' });
        return;
      }
      if (error?.message === 'CONCURRENT_MODIFICATION') {
        res.status(409).json({ error: 'La planilla fue modificada por otro aprobador. Recargue la página.' });
        return;
      }
      throw error;
    }

    // Notify planilla owner
    const aprobador = await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { nombre: true, apellido: true } });
    const aprobadorNombre = aprobador ? `${aprobador.nombre} ${aprobador.apellido}` : 'Un aprobador';
    await notificarPlanilla(planilla.usuarioId, nuevoEstado as 'APROBADA' | 'EN_REVISION', aprobadorNombre, undefined, planillaId);

    // Notify next approver if advancing to another step
    if (nuevoEstado === 'EN_REVISION') {
      const ownerInfo = await prisma.usuario.findUnique({
        where: { id: planilla.usuarioId },
        select: { nombre: true, apellido: true },
      });
      const ownerNombre = ownerInfo ? `${ownerInfo.nombre} ${ownerInfo.apellido}` : 'Un empleado';
      await notificarAprobadoresPaso(
        planilla.usuarioId, req.user!.empresaId,
        // El rol sale del circuito de ESTA planilla: `nuevoPaso` indexa el
        // snapshot renumerado, no la cadena configurada.
        { rolAprobador: pasos.find((p) => p.orden === nuevoPaso)?.rolAprobador },
        'PLANILLA', ownerNombre,
      );
    }

    res.json(updated);
  } catch (error) {
    console.error('Error al avanzar planilla:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /planillas/:id/rechazar ────────────────

router.post('/:id/rechazar', requireLevel(LEVEL_SUPERVISOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    const { motivo } = req.body;
    if (!motivo) {
      res.status(400).json({ error: 'Se requiere un motivo de rechazo' });
      return;
    }

    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: {
        flujo: { include: { pasos: { orderBy: { orden: 'asc' } } } },
        usuario: { select: { id: true, empresaId: true, sectorId: true, supervisorId: true, coordinadorId: true } },
      },
    });

    if (!planilla || planilla.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }

    // Nadie rechaza lo suyo: mismo criterio que en /avanzar.
    if (planilla.usuarioId === req.user!.userId) {
      res.status(403).json({ error: 'No podés aprobar ni rechazar tu propia planilla' });
      return;
    }

    // Explicit state guard (mirrors /avanzar): sólo se rechaza una planilla en
    // revisión. Sin esto, una planilla ya APROBADA/CERRADA caía en el chequeo de
    // aprobador y devolvía un 403 engañoso en vez de un 400 con motivo claro.
    if (planilla.estado !== 'ENVIADA' && planilla.estado !== 'EN_REVISION') {
      res.status(400).json({ error: 'La planilla no está en estado de revisión' });
      return;
    }

    // Verify the caller is the responsible approver for this step (el paso sale
    // del circuito congelado; los pasos vivos son el fallback de lo viejo)
    const currentStep = pasoActualDe(planilla);
    const approverSectorId = (await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { sectorId: true } }))?.sectorId ?? null;
    if ((process.env.DEBUG_APPROVALS === '1' || process.env.DEBUG_APPROVALS === 'true')) {
      console.log(`[RECHAZAR PLANILLA] planilla=${planillaId.slice(-6)} paso=${planilla.pasoActual} rolPaso=${currentStep?.rolAprobador ?? 'N/A'} approver=${req.user!.userId.slice(-6)} rol=${req.user!.rol} sector=${approverSectorId?.slice(-6)}`);
    }
    if (!currentStep || !isResponsibleApprover(currentStep.rolAprobador, planilla.usuario, req.user!.userId, req.user!.rol, req.user!.rolNivel ?? 0, approverSectorId)) {
      res.status(403).json({ error: 'No tenés autorización para rechazar esta planilla' });
      return;
    }

    const updated = await prisma.planilla.update({
      where: { id: planillaId },
      data: { estado: 'RECHAZADA', obsRechazo: motivo, pasoActual: 0 },
    });

    await prisma.planillaHistorial.create({
      data: {
        planillaId: planilla.id,
        usuarioId: req.user!.userId,
        estadoAnterior: planilla.estado,
        estadoNuevo: 'RECHAZADA',
        // Dónde se cortó el circuito. El update de arriba ya dejó `pasoActual` en
        // 0, así que el valor sale de la fila que se leyó ANTES de rechazar: sin
        // esto el historial no dice en qué paso murió la planilla.
        pasoFlujo: planilla.pasoActual,
        rolAprobador: currentStep.rolAprobador,
        comentario: motivo,
      },
    });

    // Notify planilla owner
    const aprobador = await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { nombre: true, apellido: true } });
    const aprobadorNombre = aprobador ? `${aprobador.nombre} ${aprobador.apellido}` : 'Un aprobador';
    await notificarPlanilla(planilla.usuarioId, 'RECHAZADA', aprobadorNombre, motivo, planillaId);

    res.json(updated);
  } catch (error) {
    console.error('Error al rechazar planilla:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /planillas/:id/cerrar ──────────────────

router.post('/:id/cerrar', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: { usuario: { select: { empresaId: true } } },
    });

    if (!planilla || planilla.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }
    if (planilla.estado !== 'APROBADA') {
      res.status(400).json({ error: 'Solo se puede cerrar una planilla APROBADA' });
      return;
    }

    const updated = await prisma.planilla.update({
      where: { id: planillaId },
      data: { estado: 'CERRADA', cerradaAt: new Date() },
    });

    await prisma.planillaHistorial.create({
      data: {
        planillaId: planilla.id,
        usuarioId: req.user!.userId,
        estadoAnterior: 'APROBADA',
        estadoNuevo: 'CERRADA',
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error al cerrar planilla:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /planillas/:id/reabrir ──────────────────

router.post('/:id/reabrir', requireLevel(LEVEL_ADMIN), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    const { motivo } = req.body;
    if (!motivo) {
      res.status(400).json({ error: 'Se requiere un motivo para reabrir' });
      return;
    }

    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: { usuario: { select: { empresaId: true } } },
    });

    if (!planilla || planilla.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }
    if (planilla.estado !== 'CERRADA') {
      res.status(400).json({ error: 'Solo se puede reabrir una planilla CERRADA' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.planilla.update({
        where: { id: planillaId },
        data: { estado: 'APROBADA', cerradaAt: null },
      });
      await tx.planillaHistorial.create({
        data: {
          planillaId: planilla.id,
          usuarioId: req.user!.userId,
          estadoAnterior: 'CERRADA',
          estadoNuevo: 'APROBADA',
          comentario: `[REABRIR] ${motivo}`,
        },
      });
      return result;
    });

    res.json(updated);
  } catch (error) {
    console.error('Error al reabrir planilla:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /planillas/:id/historial ────────────────

router.get('/:id/historial', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    if (!await assertPlanillaAccess(req, planillaId)) {
      res.status(403).json({ error: 'Sin permisos' });
      return;
    }
    const historial = await prisma.planillaHistorial.findMany({
      where: { planillaId },
      include: { usuario: { select: { nombre: true, apellido: true, rol: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json(historial);
  } catch (error) {
    console.error('Error getting historial:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ═══════════════════════════════════════════════════
// REGISTROS DE HORAS
// ═══════════════════════════════════════════════════

router.get('/:id/registros', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    if (!await assertPlanillaAccess(req, planillaId)) {
      res.status(403).json({ error: 'Sin permisos' });
      return;
    }
    const registros = await prisma.registroHoras.findMany({
      where: { planillaId },
      include: { proyecto: { select: { codigo: true, nombre: true } } },
      orderBy: { fecha: 'asc' },
    });
    res.json(registros);
  } catch (error) {
    console.error('Error listing registros:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.post('/:id/registros', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createRegistroSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const planillaId = req.params.id as string;
    const planilla = await prisma.planilla.findFirst({
      where: { id: planillaId, usuarioId: req.user!.userId },
      include: { usuario: { select: { empresaId: true } } },
    });

    if (!planilla) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }
    if (planilla.estado !== 'BORRADOR' && planilla.estado !== 'RECHAZADA') {
      res.status(400).json({ error: 'Solo se pueden agregar registros en BORRADOR o RECHAZADA' });
      return;
    }

    // Validate proyecto exists in this empresa (prevents FK 500 on bad proyectoId)
    if (parsed.data.proyectoId) {
      const proyecto = await prisma.proyecto.findFirst({
        where: { id: parsed.data.proyectoId, empresaId: planilla.usuario.empresaId },
        select: { id: true },
      });
      if (!proyecto) {
        res.status(400).json({ error: 'Proyecto inexistente' });
        return;
      }
    }

    const config = await getEmpresaConfig(planilla.usuario.empresaId);
    const fecha = new Date(parsed.data.fecha);
    const { calculo, esFeriado, esFrancoTrabajado } = await calcularConContexto(
      parsed.data,
      fecha,
      req.user!.userId,
      planilla.usuario.empresaId,
      config,
    );

    const registro = await prisma.registroHoras.create({
      data: {
        planillaId,
        fecha,
        entradaTurno1: parsed.data.entradaTurno1 ? new Date(parsed.data.entradaTurno1) : null,
        salidaTurno1: parsed.data.salidaTurno1 ? new Date(parsed.data.salidaTurno1) : null,
        entradaTurno2: parsed.data.entradaTurno2 ? new Date(parsed.data.entradaTurno2) : null,
        salidaTurno2: parsed.data.salidaTurno2 ? new Date(parsed.data.salidaTurno2) : null,
        lugarTrabajo: parsed.data.lugarTrabajo ?? null,
        pernocte: parsed.data.pernocte ?? 'NO',
        maneja: parsed.data.maneja ?? false,
        horasViajeInput: new Decimal((parsed.data.horasViajeInput ?? 2).toString()),
        distanciaViaje: parsed.data.distanciaViaje ?? null,
        esFeriado,
        esFrancoCompensatorio: parsed.data.esFrancoCompensatorio ?? false,
        esFrancoTrabajado,
        horasTrabajadas: new Decimal(calculo.horasTrabajadas.toString()),
        horasNormales: new Decimal(calculo.horasNormales.toString()),
        horasExtra50: new Decimal(calculo.horasExtra50.toString()),
        horasExtra100: new Decimal(calculo.horasExtra100.toString()),
        horasViajeCalc: new Decimal(calculo.horasViajeCalc.toString()),
        observaciones: parsed.data.observaciones ?? null,
        proyectoId: parsed.data.proyectoId ?? null,
      },
    });

    await recalcularTotalesPlanilla(planillaId);
    res.status(201).json(registro);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
      res.status(409).json({ error: 'Ya existe un registro para esa fecha' });
      return;
    }
    console.error('Error creating registro:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.put('/:id/registros/:rid', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = updateRegistroSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const planillaId = req.params.id as string;
    const rid = req.params.rid as string;
    const planilla = await prisma.planilla.findFirst({
      where: { id: planillaId, usuarioId: req.user!.userId },
      include: { usuario: { select: { empresaId: true } } },
    });
    if (!planilla || (planilla.estado !== 'BORRADOR' && planilla.estado !== 'RECHAZADA')) {
      res.status(400).json({ error: 'Solo se pueden editar registros en BORRADOR o RECHAZADA' });
      return;
    }

    // Check if the registro exists within this planilla and is not locked
    const existingReg = await prisma.registroHoras.findFirst({ where: { id: rid, planillaId } });
    if (!existingReg) {
      res.status(404).json({ error: 'Registro no encontrado' });
      return;
    }
    if (existingReg.bloqueado) {
      res.status(403).json({ error: `Este día está bloqueado: ${existingReg.motivoBloqueo ?? 'ausencia/vacación'}` });
      return;
    }

    // Validate proyecto exists in this empresa (prevents FK 500 on bad proyectoId)
    if (parsed.data.proyectoId) {
      const proyecto = await prisma.proyecto.findFirst({
        where: { id: parsed.data.proyectoId, empresaId: planilla.usuario.empresaId },
        select: { id: true },
      });
      if (!proyecto) {
        res.status(400).json({ error: 'Proyecto inexistente' });
        return;
      }
    }

    const config = await getEmpresaConfig(planilla.usuario.empresaId);
    const fecha = parsed.data.fecha ? new Date(parsed.data.fecha) : existingReg.fecha;
    const { calculo, esFeriado, esFrancoTrabajado } = await calcularConContexto(
      parsed.data,
      fecha,
      req.user!.userId,
      planilla.usuario.empresaId,
      config,
    );

    const registro = await prisma.registroHoras.update({
      where: { id: rid, planillaId },
      data: {
        fecha,
        entradaTurno1: parsed.data.entradaTurno1 ? new Date(parsed.data.entradaTurno1) : null,
        salidaTurno1: parsed.data.salidaTurno1 ? new Date(parsed.data.salidaTurno1) : null,
        entradaTurno2: parsed.data.entradaTurno2 ? new Date(parsed.data.entradaTurno2) : null,
        salidaTurno2: parsed.data.salidaTurno2 ? new Date(parsed.data.salidaTurno2) : null,
        lugarTrabajo: parsed.data.lugarTrabajo ?? null,
        pernocte: parsed.data.pernocte ?? 'NO',
        maneja: parsed.data.maneja ?? false,
        horasViajeInput: new Decimal((parsed.data.horasViajeInput ?? 2).toString()),
        distanciaViaje: parsed.data.distanciaViaje ?? null,
        esFeriado,
        esFrancoCompensatorio: parsed.data.esFrancoCompensatorio ?? false,
        esFrancoTrabajado,
        horasTrabajadas: new Decimal(calculo.horasTrabajadas.toString()),
        horasNormales: new Decimal(calculo.horasNormales.toString()),
        horasExtra50: new Decimal(calculo.horasExtra50.toString()),
        horasExtra100: new Decimal(calculo.horasExtra100.toString()),
        horasViajeCalc: new Decimal(calculo.horasViajeCalc.toString()),
        observaciones: parsed.data.observaciones ?? null,
        proyectoId: parsed.data.proyectoId ?? null,
      },
    });

    await recalcularTotalesPlanilla(planillaId);
    res.json(registro);
  } catch (error) {
    console.error('Error updating registro:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.delete('/:id/registros/:rid', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    const rid = req.params.rid as string;
    const planilla = await prisma.planilla.findFirst({
      where: { id: planillaId, usuarioId: req.user!.userId },
    });
    if (!planilla || (planilla.estado !== 'BORRADOR' && planilla.estado !== 'RECHAZADA')) {
      res.status(400).json({ error: 'Solo se pueden eliminar registros en BORRADOR o RECHAZADA' });
      return;
    }

    // Check if the registro exists within this planilla and is not locked
    const regToDelete = await prisma.registroHoras.findFirst({ where: { id: rid, planillaId } });
    if (!regToDelete) {
      res.status(404).json({ error: 'Registro no encontrado' });
      return;
    }
    if (regToDelete.bloqueado) {
      res.status(403).json({ error: `Este día está bloqueado: ${regToDelete.motivoBloqueo ?? 'ausencia/vacación'}` });
      return;
    }

    await prisma.registroHoras.delete({ where: { id: rid, planillaId } });
    await recalcularTotalesPlanilla(planillaId);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting registro:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PATCH toggle compensatorio (supervisor+) ─────────────────
router.patch('/:id/registros/:rid/compensatorio', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    const rid = req.params.rid as string;
    const { activar } = req.body; // boolean

    if (typeof activar !== 'boolean') {
      res.status(400).json({ error: 'El campo "activar" (boolean) es requerido' });
      return;
    }

    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: { usuario: { select: { empresaId: true, id: true } } },
    });

    if (!planilla || planilla.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }

    // La planilla es del dueño: el franco compensatorio lo declara él, no su jefe.
    if (planilla.usuarioId !== req.user!.userId) {
      res.status(403).json({ error: 'Solo el dueño puede declarar francos compensatorios en su planilla' });
      return;
    }

    if (!ESTADOS_OWNER.includes(planilla.estado)) {
      res.status(400).json({ error: `No se puede modificar la planilla en estado ${planilla.estado}` });
      return;
    }

    const registro = await prisma.registroHoras.findUnique({ where: { id: rid } });
    if (!registro || registro.planillaId !== planillaId) {
      res.status(404).json({ error: 'Registro no encontrado' });
      return;
    }
    const wasComp = registro.esFrancoCompensatorio; // para idempotencia del saldo

    const aprobador = await prisma.usuario.findUnique({
      where: { id: req.user!.userId },
      select: { nombre: true, apellido: true },
    });
    const aprobadorNombre = aprobador ? `${aprobador.nombre} ${aprobador.apellido}`.trim() : 'superior';

    if (activar) {
      const updated = await prisma.registroHoras.update({
        where: { id: rid },
        data: {
          esFrancoCompensatorio: true,
          bloqueado: true,
          motivoBloqueo: 'FRANCO_COMPENSATORIO',
          entradaTurno1: null,
          salidaTurno1: null,
          entradaTurno2: null,
          salidaTurno2: null,
          horasTrabajadas: new Decimal('0'),
          horasNormales: new Decimal('0'),
          horasExtra50: new Decimal('0'),
          horasExtra100: new Decimal('0'),
          horasViajeCalc: new Decimal('0'),
          observaciones: `Franco compensatorio otorgado por ${aprobadorNombre}`,
        },
      });

      // Increment compensatoriosPendientes sólo si no era ya compensatorio (idempotente)
      if (!wasComp) {
        const anio = new Date(registro.fecha).getFullYear();
        await prisma.vacacionSaldo.upsert({
          where: { usuarioId_anio: { usuarioId: planilla.usuarioId, anio } },
          create: {
            usuarioId: planilla.usuarioId,
            anio,
            diasCorrespondientes: 0,
            compensatoriosPendientes: 1,
          },
          update: {
            compensatoriosPendientes: { increment: 1 },
          },
        });
      }

      res.json(updated);
    } else {
      const updated = await prisma.registroHoras.update({
        where: { id: rid },
        data: {
          esFrancoCompensatorio: false,
          bloqueado: false,
          motivoBloqueo: null,
          observaciones: `Franco compensatorio revocado por ${aprobadorNombre}`,
        },
      });

      // Decrement sólo si el registro ERA compensatorio (idempotente: evita saldo negativo)
      if (wasComp) {
        const anio = new Date(registro.fecha).getFullYear();
        const saldo = await prisma.vacacionSaldo.findUnique({
          where: { usuarioId_anio: { usuarioId: planilla.usuarioId, anio } },
        });
        if (saldo) {
          if (planilla.estado === 'APROBADA') {
            // Already approved: decrement usados (sin bajar de 0)
            await prisma.vacacionSaldo.update({
              where: { id: saldo.id },
              data: { compensatoriosUsados: { decrement: Math.min(1, saldo.compensatoriosUsados) } },
            });
          } else {
            // Still pending: decrement pendientes (sin bajar de 0)
            await prisma.vacacionSaldo.update({
              where: { id: saldo.id },
              data: { compensatoriosPendientes: { decrement: Math.min(1, saldo.compensatoriosPendientes) } },
            });
          }
        }
      }

      res.json(updated);
    }
  } catch (error) {
    console.error('Error toggling compensatorio:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    const planilla = await prisma.planilla.findFirst({
      where: { id: planillaId, usuarioId: req.user!.userId },
    });
    if (!planilla) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }

    // Allow delete for BORRADOR or ENVIADA (before any approval step)
    if (planilla.estado === 'BORRADOR' || planilla.estado === 'RECHAZADA') {
      let adjuntos: string[] = [];
      await prisma.$transaction(async (tx) => {
        adjuntos = await limpiarMarcasManuales(tx, planillaId);
        await tx.planilla.delete({ where: { id: planillaId } });
      });
      borrarAdjuntosDeMarcas(adjuntos);
      res.status(204).send();
      return;
    }

    if (planilla.estado === 'ENVIADA') {
      // Atomic check+delete: prevent race with concurrent approval
      let adjuntos: string[] = [];
      const deleted = await prisma.$transaction(async (tx) => {
        const approvalEntry = await tx.planillaHistorial.findFirst({
          where: {
            planillaId,
            estadoNuevo: { in: ['EN_REVISION', 'APROBADA'] },
          },
        });
        if (approvalEntry) return false;

        // Re-check state hasn't changed since outer read
        const current = await tx.planilla.findUnique({ where: { id: planillaId }, select: { estado: true } });
        if (!current || current.estado !== 'ENVIADA') return false;

        adjuntos = await limpiarMarcasManuales(tx, planillaId);
        await tx.planilla.delete({ where: { id: planillaId } });
        return true;
      });
      if (deleted) borrarAdjuntosDeMarcas(adjuntos);

      if (!deleted) {
        res.status(400).json({
          error: 'No se puede eliminar esta planilla porque ya fue revisada por un aprobador. Podés solicitar que sea rechazada para corregirla.',
        });
        return;
      }
      res.status(204).send();
      return;
    }

    // EN_REVISION, APROBADA, CERRADA — cannot delete
    const mensajes: Record<string, string> = {
      EN_REVISION: 'No se puede eliminar esta planilla porque está en proceso de aprobación. Un aprobador ya revisó al menos un paso.',
      APROBADA: 'No se puede eliminar esta planilla porque ya fue aprobada.',
      CERRADA: 'No se puede eliminar esta planilla porque ya fue cerrada.',
    };
    res.status(400).json({
      error: mensajes[planilla.estado] ?? 'No se puede eliminar esta planilla en su estado actual.',
    });
  } catch (error) {
    console.error('Error deleting planilla:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ═══════════════════════════════════════════════════
// MARCAS MANUALES DE DÍAS (plan B)
// ═══════════════════════════════════════════════════

const ESTADOS_OWNER = ['BORRADOR', 'RECHAZADA'];

const marcarDiaSchema = z.object({
  fecha: fechaFlexible,
  tipo: z.nativeEnum(AusenciaTipo),
  descripcion: z.string().max(500).optional(),
});

function ymd(d: Date): string { return d.toISOString().split('T')[0]; }

// Libera el saldo comp. reservado/usado por las marcas manuales de una planilla
// y las elimina. Se usa al borrar la planilla (Ausencia.planillaId no tiene FK/cascade).
// Devuelve las URLs de los adjuntos para que el llamador los borre del disco DESPUÉS
// del commit: el filesystem no hace rollback.
async function limpiarMarcasManuales(tx: Prisma.TransactionClient, planillaId: string): Promise<string[]> {
  const marcas = await tx.ausencia.findMany({ where: { planillaId, cargaManual: true } });
  for (const m of marcas) {
    await devolverSaldoDeMarca(tx, m);
  }
  await tx.ausenciaHistorial.deleteMany({ where: { ausenciaId: { in: marcas.map(m => m.id) } } });
  await tx.ausencia.deleteMany({ where: { planillaId, cargaManual: true } });
  return marcas.map(m => m.archivoUrl).filter((u): u is string => u !== null);
}

// ─── POST /planillas/:id/marcar-dia ──────────────
router.post('/:id/marcar-dia', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = marcarDiaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }
    const planillaId = req.params.id as string;
    const actorId = req.user!.userId;
    const empresaId = req.user!.empresaId;

    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: { usuario: { select: { id: true, empresaId: true } } },
    });
    if (!planilla || planilla.usuario.empresaId !== empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }

    // La planilla es del dueño: nadie más carga días en ella, ni RRHH ni ADMIN.
    // Un aprobador que ve un error rechaza la planilla y la corrige el dueño.
    if (planilla.usuarioId !== actorId) {
      res.status(403).json({ error: 'Solo el dueño puede marcar días en su planilla' });
      return;
    }

    // El plan B nace apagado: esconder el botón en el front no es apagar la función.
    const configMarca = await prisma.empresaConfig.findUnique({
      where: { empresaId },
      select: { marcaManualActiva: true },
    });
    if (!configMarca?.marcaManualActiva) {
      res.status(403).json({ error: 'La marca manual de días no está habilitada' });
      return;
    }

    if (!ESTADOS_OWNER.includes(planilla.estado)) {
      res.status(400).json({ error: `No se puede marcar días con la planilla en estado ${planilla.estado}` });
      return;
    }

    // No usar setHours (hora local): desplazaría la fecha un día por el huso horario
    // del servidor y rompería la igualdad con las fechas guardadas como UTC-medianoche
    // (mismo patrón que el resto del archivo, p. ej. POST /:id/registros).
    const fecha = new Date(parsed.data.fecha);
    const ini = new Date(planilla.periodoInicio);
    const fin = new Date(planilla.periodoFin);
    if (fecha < ini || fecha > fin) {
      res.status(400).json({ error: 'La fecha está fuera del período de la planilla' });
      return;
    }

    // El día no debe estar ya bloqueado (ausencia formal, vacación u otra marca)
    const existingReg = await prisma.registroHoras.findUnique({
      where: { planillaId_fecha: { planillaId, fecha } },
    });
    if (existingReg?.bloqueado) {
      res.status(409).json({ error: `El día ya está bloqueado (${existingReg.motivoBloqueo ?? 'ausencia/vacación'})` });
      return;
    }
    if (existingReg?.esFrancoCompensatorio) {
      res.status(409).json({ error: 'El día ya está declarado como franco compensatorio. Quitá esa marca antes de marcarlo manualmente.' });
      return;
    }

    const tipo = parsed.data.tipo;
    const anio = fecha.getFullYear();

    let ausencia;
    try {
      ausencia = await prisma.$transaction(async (tx) => {
        if (tipo === 'FRANCO_COMPENSATORIO') {
          const saldo = await tx.vacacionSaldo.findUnique({ where: { usuarioId_anio: { usuarioId: planilla.usuarioId, anio } } });
          const disponible = (saldo?.compensatoriosAcumulados ?? 0) - (saldo?.compensatoriosUsados ?? 0) - (saldo?.compensatoriosPendientes ?? 0);
          if (disponible < 1) throw Object.assign(new Error('SALDO_COMPENSATORIO_INSUFICIENTE'), { disponible });
          await tx.vacacionSaldo.upsert({
            where: { usuarioId_anio: { usuarioId: planilla.usuarioId, anio } },
            update: { compensatoriosPendientes: { increment: 1 } },
            create: { usuarioId: planilla.usuarioId, anio, diasCorrespondientes: 0, compensatoriosPendientes: 1 },
          });
        }

        const aus = await tx.ausencia.create({
          data: {
            usuarioId: planilla.usuarioId,
            cargadaPorId: actorId,
            planillaId,
            cargaManual: true,
            tipo,
            estado: 'PENDIENTE',
            pasoActual: 0,
            fechaInicio: fecha,
            fechaFin: fecha,
            diasAusencia: 1,
            descripcion: parsed.data.descripcion ?? null,
            descuentaSueldo: tipo === 'FALTA_INJUSTIFICADA',
            porcentajeDescuento: tipo === 'FALTA_INJUSTIFICADA' ? 100 : 0,
            requiereAprobacion: true,
            aprobada: false,
            flujoId: null,
          },
        });

        await tx.ausenciaHistorial.create({
          data: {
            ausenciaId: aus.id,
            usuarioId: actorId,
            estadoNuevo: 'PENDIENTE',
            comentario: 'Marca manual del empleado (se aprueba con la planilla)',
          },
        });

        return aus;
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

    // Inyectar/reemplazar el día bloqueado, ligado a la marca
    const tipoLabel = formatTipoAusencia(tipo);
    await inyectarDiasBloqueados({
      usuarioId: planilla.usuarioId,
      fechaInicio: fecha,
      fechaFin: fecha,
      motivoBloqueo: tipo,
      observaciones: `${tipoLabel} (marca manual)${parsed.data.descripcion ? ` — ${parsed.data.descripcion}` : ''}`,
      marcaManualId: ausencia.id,
    });

    await recalcularTotalesPlanilla(planillaId);
    await logAuditoria({
      entidad: 'Ausencia', entidadId: ausencia.id, accion: 'CREAR',
      descripcion: `Marca manual ${tipo} ${ymd(fecha)} (a aprobar con la planilla)`,
      usuarioId: actorId,
    });

    const registro = await prisma.registroHoras.findUnique({
      where: { planillaId_fecha: { planillaId, fecha } },
      include: { marcaManual: { select: { id: true, estado: true, tipo: true, cargadaPorId: true, aprobadaPorId: true, archivoUrl: true } } },
    });
    res.status(201).json(registro);
  } catch (error) {
    console.error('Error marcando día:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /planillas/:id/marcas/:ausenciaId ────────────
// Solo el dueño, con la planilla editable. Borrar el día cancela la solicitud:
// se va la Ausencia, su historial, el día bloqueado y el certificado adjunto.
// A diferencia de marcar, esto NO depende del flag: si quedaron marcas de cuando
// el plan B estuvo encendido, tienen que poder limpiarse.
router.delete('/:id/marcas/:ausenciaId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    const ausenciaId = req.params.ausenciaId as string;
    const actorId = req.user!.userId;

    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: { usuario: { select: { id: true, empresaId: true } } },
    });
    if (!planilla || planilla.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }

    if (planilla.usuarioId !== actorId) {
      res.status(403).json({ error: 'Solo el dueño puede quitar marcas de su planilla' });
      return;
    }

    if (!ESTADOS_OWNER.includes(planilla.estado)) {
      res.status(400).json({ error: `No se puede quitar marcas con la planilla en estado ${planilla.estado}` });
      return;
    }

    const ausencia = await prisma.ausencia.findFirst({ where: { id: ausenciaId, planillaId, cargaManual: true } });
    if (!ausencia) {
      res.status(404).json({ error: 'Marca no encontrada' });
      return;
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Des-inyectar mientras el link todavía existe.
        await tx.registroHoras.deleteMany({ where: { planillaId, marcaManualId: ausenciaId } });
        await devolverSaldoDeMarca(tx, ausencia);
        await tx.ausenciaHistorial.deleteMany({ where: { ausenciaId } });
        const { count } = await tx.ausencia.deleteMany({ where: { id: ausenciaId } });
        if (count === 0) throw new Error('CONCURRENT_MODIFICATION');
      });
    } catch (err: unknown) {
      if ((err as Error)?.message === 'CONCURRENT_MODIFICATION') {
        res.status(409).json({ error: 'La marca fue modificada simultáneamente. Recargá la página.' });
        return;
      }
      throw err;
    }

    // Recién ahora: el filesystem no participa del rollback.
    borrarAdjuntosDeMarcas([ausencia.archivoUrl]);

    await recalcularTotalesPlanilla(planillaId);
    await logAuditoria({
      entidad: 'Ausencia', entidadId: ausenciaId, accion: 'ELIMINAR',
      descripcion: 'Marca manual quitada por el dueño (solicitud cancelada)', usuarioId: actorId,
    });

    res.status(204).send();
  } catch (error) {
    console.error('Error quitando marca:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
