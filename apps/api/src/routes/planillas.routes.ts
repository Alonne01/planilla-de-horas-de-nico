import { Router, Response } from 'express';
import { PrismaClient, PlanillaEstado, LugarTrabajo, PernocteEnum } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_SUPERVISOR, LEVEL_RRHH } from '../middleware/roles.middleware.js';
import { notificarPlanilla } from '../utils/notificacion.utils.js';
import {
  calcularHorasRegistro,
  getEmpresaConfig,
  recalcularTotalesPlanilla,
  getPeriodoActual,
} from '../utils/calculo.utils.js';
import { backfillAusenciasEnPlanilla } from '../utils/ausencia-calendar.utils.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── Schemas ─────────────────────────────────────

const createPlanillaSchema = z.object({
  periodoInicio: z.string().datetime().optional(),
  periodoFin: z.string().datetime().optional(),
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

// ─── GET /planillas ──────────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const empresaId = req.user!.empresaId;
    const estado = req.query.estado as string | undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    // Role-based filtering
    const nivel = req.user!.rolNivel ?? 0;
    if (nivel < 60) {
      // OPERADOR: solo sus propias planillas
      where.usuarioId = userId;
    } else if (nivel < 90) {
      // SUPERVISOR/COORDINADOR/GERENTE: propias + subordinados + mismo sector
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
      const me = await prisma.usuario.findUnique({
        where: { id: userId },
        select: { sectorId: true },
      });
      if (me?.sectorId) {
        const sectorUsers = await prisma.usuario.findMany({
          where: { sectorId: me.sectorId, empresaId, activo: true },
          select: { id: true },
        });
        sectorUsers.forEach((u: { id: string }) => {
          if (!subIds.includes(u.id)) subIds.push(u.id);
        });
      }
      if (!subIds.includes(userId)) subIds.push(userId);
      where.usuarioId = { in: subIds };
    } else {
      // RRHH/ADMIN: toda la empresa
      where.usuario = { empresaId };
    }

    if (estado) where.estado = estado;

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

    const flujoAsignacion = await prisma.flujoAsignacion.findFirst({
      where: {
        tipoDocumento: 'PLANILLA',
        activo: true,
        flujo: { empresaId },
        OR: [
          { usuarioId: userId },
          { sectorId: usuario?.sectorId ?? undefined },
          { sectorId: null, usuarioId: null },
        ],
      },
    });

    const planilla = await prisma.planilla.create({
      data: {
        usuarioId: userId,
        periodoInicio,
        periodoFin,
        flujoId: flujoAsignacion?.flujoId ?? null,
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
            sector: { select: { nombre: true } },
            categoria: { select: { codigo: true, nombre: true } },
          },
        },
        registros: {
          orderBy: { fecha: 'asc' },
          include: { proyecto: { select: { codigo: true, nombre: true } } },
        },
        flujo: { select: { nombre: true, pasos: { orderBy: { orden: 'asc' } } } },
      },
    });

    if (!planilla) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
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

    await prisma.planillaHistorial.create({
      data: {
        planillaId: planilla.id,
        usuarioId: req.user!.userId,
        estadoAnterior: planilla.estado,
        estadoNuevo: 'ENVIADA',
      },
    });

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
        usuario: { select: { empresaId: true } },
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

    const pasos = planilla.flujo?.pasos ?? [];
    const totalPasos = pasos.length;
    const pasoActual = planilla.pasoActual;

    let nuevoEstado: PlanillaEstado;
    let nuevoPaso: number;

    if (pasoActual >= totalPasos || totalPasos === 0) {
      nuevoEstado = 'APROBADA';
      nuevoPaso = pasoActual;
    } else {
      // Validate user's role matches the current step's rolAprobador
      const pasoConfig = pasos[pasoActual - 1];
      if (pasoConfig && pasoConfig.rolAprobador !== req.user!.rol) {
        // Also allow users with higher level (ADMIN/RRHH can always approve)
        if ((req.user!.rolNivel ?? 0) < 90) {
          res.status(403).json({ error: `Este paso requiere el rol ${pasoConfig.rolAprobador}` });
          return;
        }
      }
      nuevoPaso = pasoActual + 1;
      nuevoEstado = nuevoPaso > totalPasos ? 'APROBADA' : 'EN_REVISION';
    }

    const updated = await prisma.planilla.update({
      where: { id: planillaId },
      data: {
        estado: nuevoEstado,
        pasoActual: nuevoPaso,
        ...(nuevoEstado === 'APROBADA' ? { aprobadaPorId: req.user!.userId, aprobadaAt: new Date() } : {}),
      },
    });

    // When planilla is approved, update compensatorio saldos
    if (nuevoEstado === 'APROBADA') {
      // Count franco trabajado days → increment compensatoriosAcumulados
      const registros = await prisma.registroHoras.findMany({
        where: { planillaId: planilla.id },
      });

      const francosTrabajados = registros.filter(r => r.esFrancoTrabajado).length;
      const compensatoriosUsados = registros.filter(r => r.esFrancoCompensatorio).length;

      if (francosTrabajados > 0 || compensatoriosUsados > 0) {
        const anio = new Date(planilla.periodoInicio).getFullYear();
        await prisma.vacacionSaldo.upsert({
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
            // Move from pendientes to usados for compensatorio days
            ...(compensatoriosUsados > 0 ? {
              compensatoriosPendientes: { decrement: compensatoriosUsados },
              compensatoriosUsados: { increment: compensatoriosUsados },
            } : {}),
          },
        });
      }
    }

    await prisma.planillaHistorial.create({
      data: {
        planillaId: planilla.id,
        usuarioId: req.user!.userId,
        estadoAnterior: planilla.estado,
        estadoNuevo: nuevoEstado,
        pasoFlujo: nuevoPaso,
        comentario: req.body?.comentario ?? null,
      },
    });

    // Notify planilla owner
    const aprobador = await prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { nombre: true, apellido: true } });
    const aprobadorNombre = aprobador ? `${aprobador.nombre} ${aprobador.apellido}` : 'Un aprobador';
    await notificarPlanilla(planilla.usuarioId, nuevoEstado as 'APROBADA' | 'EN_REVISION', aprobadorNombre);

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
      include: { usuario: { select: { empresaId: true } } },
    });

    if (!planilla || planilla.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
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
    await notificarPlanilla(planilla.usuarioId, 'RECHAZADA', aprobadorNombre, motivo);

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

// ─── GET /planillas/:id/historial ────────────────

router.get('/:id/historial', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
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
    const parsed = createRegistroSchema.safeParse(req.body);
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

    // Check if the registro is locked (ausencia/vacación)
    const existingReg = await prisma.registroHoras.findUnique({ where: { id: rid } });
    if (existingReg?.bloqueado) {
      res.status(403).json({ error: `Este día está bloqueado: ${existingReg.motivoBloqueo ?? 'ausencia/vacación'}` });
      return;
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
      where: { id: rid },
      data: {
        fecha: new Date(parsed.data.fecha),
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

    // Check if the registro is locked (ausencia/vacación)
    const regToDelete = await prisma.registroHoras.findUnique({ where: { id: rid } });
    if (regToDelete?.bloqueado) {
      res.status(403).json({ error: `Este día está bloqueado: ${regToDelete.motivoBloqueo ?? 'ausencia/vacación'}` });
      return;
    }

    await prisma.registroHoras.delete({ where: { id: rid } });
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
          observaciones: `Franco compensatorio otorgado por ${req.user!.nombre || 'superior'}`,
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
          observaciones: `Franco compensatorio revocado por ${req.user!.nombre || 'superior'}`,
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
    if (planilla.estado !== 'BORRADOR') {
      res.status(400).json({ error: 'Solo se puede eliminar una planilla en BORRADOR' });
      return;
    }

    await prisma.planilla.delete({ where: { id: planillaId } });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting planilla:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
