import { Router, Response } from 'express';
import { PrismaClient, PlanillaEstado, LugarTrabajo, PernocteEnum, Prisma, AusenciaTipo } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { z } from 'zod';
import { fechaFlexible } from '../utils/zod.utils.js';
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
import { canManageUser } from '../utils/user-scope.utils.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

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

const createPlanillaSchema = z.object({
  periodoInicio: fechaFlexible.optional(),
  periodoFin: fechaFlexible.optional(),
});

const createRegistroSchema = z.object({
  fecha: z.string(),
  entradaTurno1: z.string().nullable().optional(),
  salidaTurno1: z.string().nullable().optional(),
  entradaTurno2: z.string().nullable().optional(),
  salidaTurno2: z.string().nullable().optional(),
  lugarTrabajo: z.nativeEnum(LugarTrabajo).nullable().optional(),
  pernocte: z.nativeEnum(PernocteEnum).optional(),
  maneja: z.boolean().optional(),
  horasViajeInput: z.number().min(0).max(24).optional(),
  esFeriado: z.boolean().optional(),
  esFrancoCompensatorio: z.boolean().optional(),
  esFrancoTrabajado: z.boolean().optional(),
  distanciaViaje: z.string().nullable().optional(),
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
    if (periodoInicio) where.periodoInicio = { gte: new Date(periodoInicio) };
    if (periodoFin) {
      const fin = new Date(periodoFin); fin.setHours(23, 59, 59, 999);
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

    const usuario = await prisma.usuario.findUnique({ where: { id: userId }, select: { sectorId: true } });

    // Priority-based flujo lookup: user-specific → sector → company-wide default
    let flujo = await prisma.flujoAprobacion.findFirst({
      where: {
        empresaId, tipoDocumento: 'PLANILLA', activo: true,
        asignaciones: { some: { usuarioId: userId, activo: true, tipoDocumento: 'PLANILLA' } },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (!flujo && usuario?.sectorId) {
      flujo = await prisma.flujoAprobacion.findFirst({
        where: {
          empresaId, tipoDocumento: 'PLANILLA', activo: true,
          asignaciones: { some: { sectorId: usuario.sectorId, activo: true, tipoDocumento: 'PLANILLA' } },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
    }

    if (!flujo) {
      flujo = await prisma.flujoAprobacion.findFirst({
        where: {
          empresaId, tipoDocumento: 'PLANILLA', activo: true,
          asignaciones: { some: { sectorId: null, usuarioId: null, activo: true, tipoDocumento: 'PLANILLA' } },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
    }

    const flujoId = flujo?.id ?? null;

    if ((process.env.DEBUG_APPROVALS === '1' || process.env.DEBUG_APPROVALS === 'true')) {
      console.log(`[CREAR PLANILLA] user=${userId.slice(-6)} sector=${usuario?.sectorId?.slice(-6) ?? 'N/A'} → flujo=${flujoId?.slice(-6) ?? 'NONE'}`);
    }

    const planilla = await prisma.planilla.create({
      data: {
        usuarioId: userId,
        periodoInicio,
        periodoFin,
        flujoId,
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
            marcaManual: { select: { id: true, estado: true, tipo: true, cargadaPorId: true, aprobadaPorId: true } },
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
        // Allow access if user is the responsible approver for the current step
        const pasos = planilla.flujo?.pasos ?? [];
        const currentStep = pasos.find(p => p.orden === planilla.pasoActual);
        const isPendingReview = planilla.estado === 'ENVIADA' || planilla.estado === 'EN_REVISION';
        const approverSectorId = (await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { sectorId: true } }))?.sectorId ?? null;
        if (!isPendingReview || !currentStep || !isResponsibleApprover(currentStep.rolAprobador, planilla.usuario, req.user!.userId, req.user!.rol, nivel, approverSectorId)) {
          res.status(403).json({ error: 'Sin permisos para ver esta planilla' });
          return;
        }
      }
    }

    res.json(planilla);
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

    // Validate completeness: days must have a registro UNLESS they are franco (rest) days or feriados
    const registros = await prisma.registroHoras.findMany({
      where: { planillaId },
      select: { fecha: true, bloqueado: true, lugarTrabajo: true, horasTrabajadas: true, entradaTurno1: true },
    });

    // Look up user's active diagram to determine franco days
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user!.userId },
      select: { empresaId: true },
    });
    const diagramaAsignacion = await prisma.usuarioDiagrama.findFirst({
      where: { usuarioId: req.user!.userId, activo: true },
      include: { diagrama: true },
      orderBy: { fechaInicio: 'desc' },
    });

    // Load feriados from empresa config
    let feriadosDates: Set<string> = new Set();
    if (usuario) {
      const config = await prisma.empresaConfig.findFirst({
        where: { empresaId: usuario.empresaId },
        select: { feriadosPersonalizados: true },
      });
      if (config?.feriadosPersonalizados) {
        const feriados = config.feriadosPersonalizados as unknown as string[];
        if (Array.isArray(feriados)) {
          feriadosDates = new Set(feriados.map(f => typeof f === 'string' ? f.split('T')[0] : ''));
        }
      }
    }

    // Helper: check if a date is a franco (rest) day per the diagram
    function esDiaFranco(fecha: Date): boolean {
      if (!diagramaAsignacion) return false;
      const diag = diagramaAsignacion.diagrama;
      if (diag.tipo === 'ROTATIVO') {
        const ciclo = (diag.diasTrabajo ?? 0) + (diag.diasDescanso ?? 0);
        if (ciclo === 0) return false;
        const msPerDay = 86400000;
        const startMs = Date.UTC(
          diagramaAsignacion.fechaInicio.getFullYear(),
          diagramaAsignacion.fechaInicio.getMonth(),
          diagramaAsignacion.fechaInicio.getDate(),
        );
        const fechaMs = Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
        const diffDias = Math.round((fechaMs - startMs) / msPerDay);
        const pos = ((diffDias % ciclo) + ciclo) % ciclo;
        return pos >= (diag.diasTrabajo ?? 0);
      }
      if (diag.tipo === 'FIJO_SEMANA') {
        return !diag.diasSemana.includes(fecha.getDay());
      }
      return false;
    }

    const inicio = new Date(planilla.periodoInicio);
    const fin = new Date(planilla.periodoFin);
    const diasFaltantes: string[] = [];

    for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];

      // Skip franco (rest) days — no registro needed
      if (esDiaFranco(d)) continue;
      // Skip feriados — no registro needed
      if (feriadosDates.has(dateStr)) continue;

      const reg = registros.find(r => {
        const rDate = new Date(r.fecha).toISOString().split('T')[0];
        return rDate === dateStr;
      });

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

    const updated = await prisma.planilla.update({
      where: { id: planillaId },
      data: { estado: 'ENVIADA', pasoActual: 1, enviadaAt: new Date(), obsRechazo: null },
    });

    if ((process.env.DEBUG_APPROVALS === '1' || process.env.DEBUG_APPROVALS === 'true')) {
      console.log(`[ENVIAR PLANILLA] planilla=${planillaId.slice(-6)} flujo=${planilla.flujoId?.slice(-6) ?? 'NONE'} user=${req.user!.userId.slice(-6)} → pasoActual=1`);
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
    await notificarAprobadoresPaso(
      planilla.usuarioId, req.user!.empresaId, planilla.flujoId, 1, 'PLANILLA', solicitanteNombre,
    );

    res.json(updated);
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
    if (planilla.estado !== 'ENVIADA' && planilla.estado !== 'EN_REVISION') {
      res.status(400).json({ error: 'La planilla no está en estado de revisión' });
      return;
    }

    // Gating plan B: no se puede avanzar/aprobar con marcas manuales sin validar
    const marcasPendientes = await prisma.ausencia.count({
      where: { planillaId, cargaManual: true, estado: { notIn: ['APROBADA', 'RECHAZADA'] } },
    });
    if (marcasPendientes > 0) {
      res.status(400).json({ error: `Hay ${marcasPendientes} marca(s) manual(es) sin validar. Validalas antes de aprobar.`, marcasPendientes });
      return;
    }

    const pasos = planilla.flujo?.pasos ?? [];
    const totalPasos = pasos.length;
    const pasoActual = planilla.pasoActual;

    let nuevoEstado: PlanillaEstado;
    let nuevoPaso: number;

    // pasoActual is 1-based (matches FlujoPaso.orden). 0 = not started, 1..N = current step.
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
      if ((process.env.DEBUG_APPROVALS === '1' || process.env.DEBUG_APPROVALS === 'true')) {
        console.log(`[AVANZAR PLANILLA] planilla=${planillaId.slice(-6)} paso=${pasoActual}/${totalPasos} rolPaso=${pasoConfig.rolAprobador} approver=${req.user!.userId.slice(-6)} rol=${req.user!.rol} sector=${approverSectorId?.slice(-6)} ownerSector=${planilla.usuario.sectorId?.slice(-6)}`);
      }
      if (!isResponsibleApprover(pasoConfig.rolAprobador, planilla.usuario, req.user!.userId, req.user!.rol, req.user!.rolNivel ?? 0, approverSectorId)) {
        res.status(403).json({ error: `No tenés autorización para aprobar esta planilla en el paso de ${pasoConfig.rolAprobador}` });
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
        const { count } = await tx.planilla.updateMany({
          where: { id: planillaId, pasoActual: planilla.pasoActual },
          data: {
            estado: nuevoEstado,
            pasoActual: nuevoPaso,
            ...(nuevoEstado === 'APROBADA' ? { aprobadaPorId: req.user!.userId, aprobadaAt: new Date() } : {}),
          },
        });
        if (count === 0) throw new Error('CONCURRENT_MODIFICATION');

        // Duplicate check INSIDE transaction (after row lock acquired by UPDATE)
        const yaAprobo = await tx.planillaHistorial.findFirst({
          where: {
            planillaId,
            usuarioId: req.user!.userId,
            pasoFlujo: nuevoPaso,
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
        }

        await tx.planillaHistorial.create({
          data: {
            planillaId: planilla.id,
            usuarioId: req.user!.userId,
            estadoAnterior: planilla.estado,
            estadoNuevo: nuevoEstado,
            pasoFlujo: nuevoPaso,
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
        planilla.usuarioId, req.user!.empresaId, planilla.flujoId, nuevoPaso, 'PLANILLA', ownerNombre,
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

    // Explicit state guard (mirrors /avanzar): sólo se rechaza una planilla en
    // revisión. Sin esto, una planilla ya APROBADA/CERRADA caía en el chequeo de
    // aprobador y devolvía un 403 engañoso en vez de un 400 con motivo claro.
    if (planilla.estado !== 'ENVIADA' && planilla.estado !== 'EN_REVISION') {
      res.status(400).json({ error: 'La planilla no está en estado de revisión' });
      return;
    }

    // Verify the caller is the responsible approver for this step
    const pasos = planilla.flujo?.pasos ?? [];
    const currentStep = pasos.find(p => p.orden === planilla.pasoActual);
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
    const calculo = calcularHorasRegistro(
      {
        entradaTurno1: parsed.data.entradaTurno1 ? new Date(parsed.data.entradaTurno1) : null,
        salidaTurno1: parsed.data.salidaTurno1 ? new Date(parsed.data.salidaTurno1) : null,
        entradaTurno2: parsed.data.entradaTurno2 ? new Date(parsed.data.entradaTurno2) : null,
        salidaTurno2: parsed.data.salidaTurno2 ? new Date(parsed.data.salidaTurno2) : null,
        lugarTrabajo: parsed.data.lugarTrabajo ?? null,
        esFeriado: parsed.data.esFeriado ?? false,
        esFrancoTrabajado: parsed.data.esFrancoTrabajado ?? false,
        horasViajeInput: parsed.data.horasViajeInput ?? 2,
        maneja: parsed.data.maneja ?? false,
      },
      config
    );

    const fecha = new Date(parsed.data.fecha);

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
        esFeriado: parsed.data.esFeriado ?? false,
        esFrancoCompensatorio: parsed.data.esFrancoCompensatorio ?? false,
        esFrancoTrabajado: parsed.data.esFrancoTrabajado ?? false,
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
    const calculo = calcularHorasRegistro(
      {
        entradaTurno1: parsed.data.entradaTurno1 ? new Date(parsed.data.entradaTurno1) : null,
        salidaTurno1: parsed.data.salidaTurno1 ? new Date(parsed.data.salidaTurno1) : null,
        entradaTurno2: parsed.data.entradaTurno2 ? new Date(parsed.data.entradaTurno2) : null,
        salidaTurno2: parsed.data.salidaTurno2 ? new Date(parsed.data.salidaTurno2) : null,
        lugarTrabajo: parsed.data.lugarTrabajo ?? null,
        esFeriado: parsed.data.esFeriado ?? false,
        esFrancoTrabajado: parsed.data.esFrancoTrabajado ?? false,
        horasViajeInput: parsed.data.horasViajeInput ?? 2,
        maneja: parsed.data.maneja ?? false,
      },
      config
    );

    const registro = await prisma.registroHoras.update({
      where: { id: rid, planillaId },
      data: {
        fecha: parsed.data.fecha ? new Date(parsed.data.fecha) : existingReg.fecha,
        entradaTurno1: parsed.data.entradaTurno1 ? new Date(parsed.data.entradaTurno1) : null,
        salidaTurno1: parsed.data.salidaTurno1 ? new Date(parsed.data.salidaTurno1) : null,
        entradaTurno2: parsed.data.entradaTurno2 ? new Date(parsed.data.entradaTurno2) : null,
        salidaTurno2: parsed.data.salidaTurno2 ? new Date(parsed.data.salidaTurno2) : null,
        lugarTrabajo: parsed.data.lugarTrabajo ?? null,
        pernocte: parsed.data.pernocte ?? 'NO',
        maneja: parsed.data.maneja ?? false,
        horasViajeInput: new Decimal((parsed.data.horasViajeInput ?? 2).toString()),
        distanciaViaje: parsed.data.distanciaViaje ?? null,
        esFeriado: parsed.data.esFeriado ?? false,
        esFrancoCompensatorio: parsed.data.esFrancoCompensatorio ?? false,
        esFrancoTrabajado: parsed.data.esFrancoTrabajado ?? false,
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
router.patch('/:id/registros/:rid/compensatorio', requireLevel(LEVEL_SUPERVISOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    const rid = req.params.rid as string;
    const { activar } = req.body; // boolean

    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: { usuario: { select: { empresaId: true, id: true } } },
    });

    if (!planilla || planilla.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }

    const registro = await prisma.registroHoras.findUnique({ where: { id: rid } });
    if (!registro || registro.planillaId !== planillaId) {
      res.status(404).json({ error: 'Registro no encontrado' });
      return;
    }

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

      // Increment compensatoriosPendientes on the user's VacacionSaldo
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

      // Decrement compensatoriosPendientes or compensatoriosUsados
      const anio = new Date(registro.fecha).getFullYear();
      const saldo = await prisma.vacacionSaldo.findUnique({
        where: { usuarioId_anio: { usuarioId: planilla.usuarioId, anio } },
      });
      if (saldo) {
        if (planilla.estado === 'APROBADA') {
          // Already approved: decrement usados
          await prisma.vacacionSaldo.update({
            where: { id: saldo.id },
            data: { compensatoriosUsados: { decrement: 1 } },
          });
        } else {
          // Still pending: decrement pendientes
          await prisma.vacacionSaldo.update({
            where: { id: saldo.id },
            data: { compensatoriosPendientes: { decrement: 1 } },
          });
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
      await prisma.planilla.delete({ where: { id: planillaId } });
      res.status(204).send();
      return;
    }

    if (planilla.estado === 'ENVIADA') {
      // Atomic check+delete: prevent race with concurrent approval
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

        await tx.planilla.delete({ where: { id: planillaId } });
        return true;
      });

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
const ESTADOS_MANAGER = ['BORRADOR', 'RECHAZADA', 'ENVIADA', 'EN_REVISION'];

const marcarDiaSchema = z.object({
  fecha: fechaFlexible,
  tipo: z.nativeEnum(AusenciaTipo),
  descripcion: z.string().max(500).optional(),
});

function ymd(d: Date): string { return d.toISOString().split('T')[0]; }

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
    const actorNivel = req.user!.rolNivel ?? 0;
    const empresaId = req.user!.empresaId;

    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: { usuario: { select: { id: true, empresaId: true } } },
    });
    if (!planilla || planilla.usuario.empresaId !== empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }

    const isOwner = planilla.usuarioId === actorId;
    const isManager = !isOwner && await canManageUser(actorId, actorNivel, planilla.usuarioId, empresaId);
    if (!isOwner && !isManager) {
      res.status(403).json({ error: 'No autorizado para marcar días en esta planilla' });
      return;
    }

    const allowed = isOwner ? ESTADOS_OWNER : ESTADOS_MANAGER;
    if (!allowed.includes(planilla.estado)) {
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

    const tipo = parsed.data.tipo;
    const anio = fecha.getFullYear();
    const autoValidada = isManager;

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
            estado: autoValidada ? 'APROBADA' : 'PENDIENTE',
            pasoActual: 0,
            fechaInicio: fecha,
            fechaFin: fecha,
            diasAusencia: 1,
            descripcion: parsed.data.descripcion ?? null,
            descuentaSueldo: tipo === 'FALTA_INJUSTIFICADA',
            porcentajeDescuento: tipo === 'FALTA_INJUSTIFICADA' ? 100 : 0,
            requiereAprobacion: !autoValidada,
            aprobada: autoValidada,
            ...(autoValidada ? { aprobadaPorId: actorId, aprobadaAt: new Date() } : {}),
            flujoId: null,
          },
        });

        await tx.ausenciaHistorial.create({
          data: {
            ausenciaId: aus.id,
            usuarioId: actorId,
            estadoNuevo: autoValidada ? 'APROBADA' : 'PENDIENTE',
            comentario: autoValidada ? 'Marca manual (auto-validada por superior)' : 'Marca manual del empleado (sin validar)',
          },
        });

        if (autoValidada && tipo === 'FRANCO_COMPENSATORIO') {
          await tx.vacacionSaldo.update({
            where: { usuarioId_anio: { usuarioId: planilla.usuarioId, anio } },
            data: { compensatoriosPendientes: { decrement: 1 }, compensatoriosUsados: { increment: 1 } },
          });
        }

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
      descripcion: `Marca manual ${tipo} ${ymd(fecha)}${autoValidada ? ' (validada)' : ' (sin validar)'}`,
      usuarioId: actorId,
    });

    const registro = await prisma.registroHoras.findUnique({
      where: { planillaId_fecha: { planillaId, fecha } },
      include: { marcaManual: { select: { id: true, estado: true, tipo: true, cargadaPorId: true, aprobadaPorId: true } } },
    });
    res.status(201).json(registro);
  } catch (error) {
    console.error('Error marcando día:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /planillas/:id/marcas/:ausenciaId/validar ──────
router.post('/:id/marcas/:ausenciaId/validar', requireLevel(LEVEL_SUPERVISOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    const ausenciaId = req.params.ausenciaId as string;
    const actorId = req.user!.userId;
    const actorNivel = req.user!.rolNivel ?? 0;

    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: { usuario: { select: { id: true, empresaId: true } } },
    });
    if (!planilla || planilla.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }
    if (planilla.usuarioId === actorId) {
      res.status(403).json({ error: 'No podés validar tus propias marcas' });
      return;
    }
    if (!await canManageUser(actorId, actorNivel, planilla.usuarioId, req.user!.empresaId)) {
      res.status(403).json({ error: 'No autorizado para validar marcas de este empleado' });
      return;
    }

    const ausencia = await prisma.ausencia.findFirst({ where: { id: ausenciaId, planillaId, cargaManual: true } });
    if (!ausencia) {
      res.status(404).json({ error: 'Marca no encontrada' });
      return;
    }
    if (ausencia.estado !== 'PENDIENTE') {
      res.status(400).json({ error: 'La marca no está pendiente de validación' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.ausencia.update({
        where: { id: ausenciaId },
        data: { estado: 'APROBADA', aprobada: true, aprobadaPorId: actorId, aprobadaAt: new Date() },
      });
      await tx.ausenciaHistorial.create({
        data: { ausenciaId, usuarioId: actorId, estadoAnterior: 'PENDIENTE', estadoNuevo: 'APROBADA', comentario: 'Marca manual validada' },
      });
      if (ausencia.tipo === 'FRANCO_COMPENSATORIO') {
        const anio = new Date(ausencia.fechaInicio).getFullYear();
        await tx.vacacionSaldo.update({
          where: { usuarioId_anio: { usuarioId: ausencia.usuarioId, anio } },
          data: { compensatoriosPendientes: { decrement: 1 }, compensatoriosUsados: { increment: 1 } },
        });
      }
    });

    await logAuditoria({ entidad: 'Ausencia', entidadId: ausenciaId, accion: 'EDITAR', campo: 'estado', valorAnterior: 'PENDIENTE', valorNuevo: 'APROBADA', descripcion: 'Marca manual validada', usuarioId: actorId });
    const updated = await prisma.ausencia.findUnique({ where: { id: ausenciaId } });
    res.json(updated);
  } catch (error) {
    console.error('Error validando marca:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /planillas/:id/marcas/validar-todo ─────────────
router.post('/:id/marcas/validar-todo', requireLevel(LEVEL_SUPERVISOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    const actorId = req.user!.userId;
    const actorNivel = req.user!.rolNivel ?? 0;

    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: { usuario: { select: { id: true, empresaId: true } } },
    });
    if (!planilla || planilla.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }
    if (planilla.usuarioId === actorId) {
      res.status(403).json({ error: 'No podés validar tus propias marcas' });
      return;
    }
    if (!await canManageUser(actorId, actorNivel, planilla.usuarioId, req.user!.empresaId)) {
      res.status(403).json({ error: 'No autorizado para validar marcas de este empleado' });
      return;
    }

    const pendientes = await prisma.ausencia.findMany({ where: { planillaId, cargaManual: true, estado: 'PENDIENTE' } });
    if (pendientes.length === 0) { res.json({ validadas: 0 }); return; }

    await prisma.$transaction(async (tx) => {
      for (const aus of pendientes) {
        await tx.ausencia.update({
          where: { id: aus.id },
          data: { estado: 'APROBADA', aprobada: true, aprobadaPorId: actorId, aprobadaAt: new Date() },
        });
        await tx.ausenciaHistorial.create({
          data: { ausenciaId: aus.id, usuarioId: actorId, estadoAnterior: 'PENDIENTE', estadoNuevo: 'APROBADA', comentario: 'Marca manual validada (lote)' },
        });
        if (aus.tipo === 'FRANCO_COMPENSATORIO') {
          const anio = new Date(aus.fechaInicio).getFullYear();
          await tx.vacacionSaldo.update({
            where: { usuarioId_anio: { usuarioId: aus.usuarioId, anio } },
            data: { compensatoriosPendientes: { decrement: 1 }, compensatoriosUsados: { increment: 1 } },
          });
        }
      }
    });

    await logAuditoria({ entidad: 'Planilla', entidadId: planillaId, accion: 'EDITAR', descripcion: `Validó ${pendientes.length} marca(s) manual(es) en lote`, usuarioId: actorId });
    res.json({ validadas: pendientes.length });
  } catch (error) {
    console.error('Error validando marcas en lote:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /planillas/:id/marcas/:ausenciaId ────────────
// Dueño: quita su marca PENDIENTE (elimina la fila). Superior: rechaza (RECHAZADA).
router.delete('/:id/marcas/:ausenciaId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    const ausenciaId = req.params.ausenciaId as string;
    const actorId = req.user!.userId;
    const actorNivel = req.user!.rolNivel ?? 0;

    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: { usuario: { select: { id: true, empresaId: true } } },
    });
    if (!planilla || planilla.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }

    const ausencia = await prisma.ausencia.findFirst({ where: { id: ausenciaId, planillaId, cargaManual: true } });
    if (!ausencia) {
      res.status(404).json({ error: 'Marca no encontrada' });
      return;
    }

    const isOwner = planilla.usuarioId === actorId;
    const isManager = !isOwner && actorNivel >= LEVEL_SUPERVISOR && await canManageUser(actorId, actorNivel, planilla.usuarioId, req.user!.empresaId);
    if (!isOwner && !isManager) {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }

    if (isOwner) {
      if (!ESTADOS_OWNER.includes(planilla.estado)) {
        res.status(400).json({ error: `No se puede quitar marcas con la planilla en estado ${planilla.estado}` });
        return;
      }
      if (ausencia.estado !== 'PENDIENTE') {
        res.status(400).json({ error: 'Solo podés quitar marcas sin validar' });
        return;
      }
    }

    const anio = new Date(ausencia.fechaInicio).getFullYear();

    await prisma.$transaction(async (tx) => {
      // Liberar saldo comp. reservado/usado
      if (ausencia.tipo === 'FRANCO_COMPENSATORIO') {
        if (ausencia.estado === 'APROBADA') {
          await tx.vacacionSaldo.update({ where: { usuarioId_anio: { usuarioId: ausencia.usuarioId, anio } }, data: { compensatoriosUsados: { decrement: 1 } } });
        } else if (ausencia.estado === 'PENDIENTE') {
          await tx.vacacionSaldo.update({ where: { usuarioId_anio: { usuarioId: ausencia.usuarioId, anio } }, data: { compensatoriosPendientes: { decrement: 1 } } });
        }
      }
      // Des-inyectar: eliminar el/los registro(s) del día ligados a la marca (mientras el link existe)
      await tx.registroHoras.deleteMany({ where: { planillaId, marcaManualId: ausenciaId } });
      // Dueño: elimina la fila. Superior: la deja RECHAZADA para traza.
      if (isOwner) {
        await tx.ausencia.delete({ where: { id: ausenciaId } });
      } else {
        await tx.ausencia.update({
          where: { id: ausenciaId },
          data: { estado: 'RECHAZADA', aprobada: false, obsRechazo: (req.body?.motivo as string) ?? 'Marca rechazada' },
        });
        await tx.ausenciaHistorial.create({
          data: { ausenciaId, usuarioId: actorId, estadoAnterior: ausencia.estado, estadoNuevo: 'RECHAZADA', comentario: (req.body?.motivo as string) ?? 'Marca manual rechazada' },
        });
      }
    });

    await recalcularTotalesPlanilla(planillaId);
    await logAuditoria({ entidad: 'Ausencia', entidadId: ausenciaId, accion: isOwner ? 'ELIMINAR' : 'EDITAR', descripcion: isOwner ? 'Marca manual quitada por el dueño' : 'Marca manual rechazada', usuarioId: actorId });

    if (isOwner) {
      res.status(204).send();
    } else {
      const updated = await prisma.ausencia.findUnique({ where: { id: ausenciaId } });
      res.json(updated);
    }
  } catch (error) {
    console.error('Error quitando/rechazando marca:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
