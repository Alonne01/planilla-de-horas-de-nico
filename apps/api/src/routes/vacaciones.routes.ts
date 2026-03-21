import { Router, Response } from 'express';
import { PrismaClient, VacacionEstado } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_SUPERVISOR } from '../middleware/roles.middleware.js';
import { inyectarDiasBloqueados } from '../utils/ausencia-calendar.utils.js';

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

// ─── GET /vacaciones ─────────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userRole = req.user!.rol;
    const userNivel = req.user!.rolNivel ?? 0;
    const userId = req.user!.userId;
    const empresaId = req.user!.empresaId;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let where: any = {};

    if (userNivel >= 90) {
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
    const anio = new Date().getFullYear();

    // Check saldo from VacacionSaldo
    const usuario = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { fechaIngreso: true, sectorId: true },
    });
    if (!usuario) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }

    let saldo = await prisma.vacacionSaldo.findUnique({
      where: { usuarioId_anio: { usuarioId: userId, anio } },
    });
    if (!saldo) {
      saldo = await prisma.vacacionSaldo.create({
        data: { usuarioId: userId, anio, diasCorrespondientes: diasPorAntiguedad(usuario.fechaIngreso, anio) },
      });
    }
    const disponible = saldo.diasCorrespondientes + saldo.diasAjuste - saldo.diasUsados - saldo.diasPendientes;
    if (parsed.data.diasHabiles > disponible) {
      res.status(400).json({ error: `Saldo insuficiente. Disponible: ${disponible} días` });
      return;
    }

    const fechaInicio = new Date(parsed.data.fechaInicio);
    const fechaFin = new Date(parsed.data.fechaFin);
    const diasTotales = Math.ceil((fechaFin.getTime() - fechaInicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Find applicable flow
    const flujoAsignacion = await prisma.flujoAsignacion.findFirst({
      where: {
        tipoDocumento: 'VACACION',
        activo: true,
        flujo: { empresaId },
        OR: [
          { usuarioId: userId },
          { sectorId: usuario?.sectorId ?? undefined },
          { sectorId: null, usuarioId: null },
        ],
      },
    });

    const vacacion = await prisma.vacacion.create({
      data: {
        usuarioId: userId,
        fechaInicio,
        fechaFin,
        diasHabiles: parsed.data.diasHabiles,
        diasTotales,
        motivo: parsed.data.motivo ?? null,
        flujoId: flujoAsignacion?.flujoId ?? null,
        estado: 'PENDIENTE',
        pasoActual: 1,
      },
    });

    await prisma.vacacionHistorial.create({
      data: {
        vacacionId: vacacion.id,
        usuarioId: userId,
        estadoNuevo: 'PENDIENTE',
        comentario: 'Solicitud enviada automáticamente',
      },
    });

    // Update diasPendientes in VacacionSaldo
    await prisma.vacacionSaldo.update({
      where: { usuarioId_anio: { usuarioId: userId, anio } },
      data: { diasPendientes: { increment: diasTotales } },
    });

    res.status(201).json(vacacion);
  } catch (error) {
    console.error('Error creating vacacion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /vacaciones/:id ─────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vacId = req.params.id as string;
    const vacacion = await prisma.vacacion.findUnique({
      where: { id: vacId },
      include: {
        usuario: { select: { id: true, nombre: true, apellido: true, sector: { select: { nombre: true } } } },
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

    const updated = await prisma.vacacion.update({
      where: { id: vacId },
      data: { estado: 'PENDIENTE', pasoActual: 1, obsRechazo: null },
    });

    await prisma.vacacionHistorial.create({
      data: {
        vacacionId: vacId,
        usuarioId: req.user!.userId,
        estadoAnterior: vacacion.estado,
        estadoNuevo: 'PENDIENTE',
      },
    });

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
        usuario: { select: { id: true, empresaId: true, diasVacacionesUsados: true } },
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
    let nuevoEstado: VacacionEstado;
    let nuevoPaso = vacacion.pasoActual + 1;

    if (nuevoPaso > totalPasos || totalPasos === 0) {
      nuevoEstado = 'APROBADA';
    } else {
      nuevoEstado = 'EN_REVISION';
    }

    const updated = await prisma.vacacion.update({
      where: { id: vacId },
      data: {
        estado: nuevoEstado,
        pasoActual: nuevoPaso,
        ...(nuevoEstado === 'APROBADA' ? { aprobadaPorId: req.user!.userId, aprobadaAt: new Date() } : {}),
      },
    });

    // If approved, update VacacionSaldo.diasUsados
    if (nuevoEstado === 'APROBADA') {
      const anioVac = new Date(vacacion.fechaInicio).getFullYear();
      await prisma.vacacionSaldo.upsert({
        where: { usuarioId_anio: { usuarioId: vacacion.usuario.id, anio: anioVac } },
        update: {
          diasUsados: { increment: vacacion.diasTotales },
          diasPendientes: { decrement: vacacion.diasTotales },
        },
        create: {
          usuarioId: vacacion.usuario.id,
          anio: anioVac,
          diasCorrespondientes: 14, // fallback, should already exist
          diasUsados: vacacion.diasTotales,
        },
      });

      // Inject locked days into employee planilla
      await inyectarDiasBloqueados({
        usuarioId: vacacion.usuario.id,
        fechaInicio: vacacion.fechaInicio,
        fechaFin: vacacion.fechaFin,
        motivoBloqueo: 'VACACION',
        observaciones: `Vacaciones${vacacion.motivo ? ` — ${vacacion.motivo}` : ''}`,
      });
    }

    await prisma.vacacionHistorial.create({
      data: {
        vacacionId: vacId,
        usuarioId: req.user!.userId,
        estadoAnterior: vacacion.estado,
        estadoNuevo: nuevoEstado,
        pasoFlujo: nuevoPaso,
        comentario: req.body?.comentario ?? null,
      },
    });

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
      include: { usuario: { select: { empresaId: true } } },
    });

    if (!vacacion || vacacion.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Vacación no encontrada' });
      return;
    }

    const updated = await prisma.vacacion.update({
      where: { id: vacId },
      data: { estado: 'RECHAZADA', obsRechazo: motivo, pasoActual: 0 },
    });

    await prisma.vacacionHistorial.create({
      data: {
        vacacionId: vacId,
        usuarioId: req.user!.userId,
        estadoAnterior: vacacion.estado,
        estadoNuevo: 'RECHAZADA',
        comentario: motivo,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error al rechazar vacacion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
