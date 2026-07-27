import { Router, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { formatTipoAusencia } from '../utils/ausencia-calendar.utils.js';
import { enriquecerPasos, pasosDe, type PasoRecorrido } from '../utils/circuito.utils.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// Helper: format date as dd/MM
function fmtDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

interface SolicitudUnificada {
  id: string;
  tipo: 'VACACION' | 'AUSENCIA' | 'CAMBIO_DIAGRAMA' | 'PLANILLA';
  estado: string;
  pasoActual: number;
  totalPasos: number;
  createdAt: string;
  detalle: string;
  pasos: PasoRecorrido[];
  obsRechazo?: string | null;
  cancelable: boolean;
}

/** Cancelable = el dueño todavía puede retirarla porque nadie la firmó. */
function esCancelable(tipo: SolicitudUnificada['tipo'], estado: string, pasoActual: number): boolean {
  if (tipo === 'PLANILLA') return estado === 'ENVIADA' && pasoActual <= 1;
  return estado === 'PENDIENTE' && pasoActual <= 1;
}

// `enriquecerPasos` vive en circuito.utils.ts: es lógica pura y testeable, y la
// reconstrucción del recorrido tiene que seguir el mismo criterio de snapshot
// que usan las rutas de aprobación.

// ─── GET /mis-solicitudes ────────────────────────
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    const historialInclude = {
      include: {
        usuario: { select: { nombre: true, apellido: true } },
      },
      orderBy: { createdAt: 'asc' as const },
    };

    const flujoInclude = {
      include: { pasos: { orderBy: { orden: 'asc' as const } } },
    };

    // Fetch all 4 types in parallel
    const [planillas, vacaciones, ausencias, cambiosDiagrama] = await Promise.all([
      prisma.planilla.findMany({
        where: {
          usuarioId: userId,
          estado: { notIn: ['BORRADOR'] },
        },
        include: {
          flujo: flujoInclude,
          historial: historialInclude,
        },
        orderBy: { createdAt: 'desc' },
      }),

      prisma.vacacion.findMany({
        where: {
          usuarioId: userId,
          estado: { not: 'BORRADOR' },
        },
        include: {
          flujo: flujoInclude,
          historial: historialInclude,
        },
        orderBy: { createdAt: 'desc' },
      }),

      // Las marcas manuales (cargaManual) viven dentro de la planilla y se aprueban
      // con ella: listarlas acá las mostraba PENDIENTE para siempre, sin circuito y
      // sin nadie que pudiera aprobarlas desde la bandeja.
      prisma.ausencia.findMany({
        where: {
          usuarioId: userId,
          requiereAprobacion: true,
          cargaManual: false,
          estado: { not: 'BORRADOR' },
        },
        include: {
          flujo: flujoInclude,
          historial: historialInclude,
        },
        orderBy: { createdAt: 'desc' },
      }),

      prisma.solicitudCambioDiagrama.findMany({
        where: {
          solicitanteId: userId,
        },
        include: {
          diagramaActual: { select: { nombre: true } },
          diagramaNuevo: { select: { nombre: true } },
          flujo: flujoInclude,
          historial: historialInclude,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const combined: SolicitudUnificada[] = [];

    // Map planillas
    for (const p of planillas) {
      // El circuito congelado del documento, no la cadena configurada hoy: el
      // `include` del flujo queda sólo como fallback de lo anterior al snapshot.
      const pasos = pasosDe(p);
      const inicio = fmtDate(p.periodoInicio);
      const fin = fmtDate(p.periodoFin);
      const totalHoras = Number(p.totalHorasNormales) + Number(p.totalHorasExtra50) + Number(p.totalHorasExtra100);
      combined.push({
        id: p.id,
        tipo: 'PLANILLA',
        estado: p.estado,
        pasoActual: p.pasoActual,
        totalPasos: pasos.length,
        createdAt: p.createdAt.toISOString(),
        detalle: `Planilla ${inicio} — ${fin}${totalHoras > 0 ? ` · ${totalHoras.toFixed(1)}hs` : ''}`,
        pasos: enriquecerPasos(pasos, p.pasoActual, p.historial),
        obsRechazo: p.obsRechazo,
        cancelable: esCancelable('PLANILLA', p.estado, p.pasoActual),
      });
    }

    // Map vacaciones
    for (const v of vacaciones) {
      const pasos = pasosDe(v);
      combined.push({
        id: v.id,
        tipo: 'VACACION',
        estado: v.estado,
        pasoActual: v.pasoActual,
        totalPasos: pasos.length,
        createdAt: v.createdAt.toISOString(),
        detalle: `Vacaciones del ${fmtDate(v.fechaInicio)} al ${fmtDate(v.fechaFin)} (${v.diasHabiles} días hábiles)`,
        pasos: enriquecerPasos(pasos, v.pasoActual, v.historial),
        obsRechazo: v.obsRechazo,
        cancelable: esCancelable('VACACION', v.estado, v.pasoActual),
      });
    }

    // Map ausencias
    for (const a of ausencias) {
      const pasos = pasosDe(a);
      const tipoLabel = formatTipoAusencia(a.tipo);
      combined.push({
        id: a.id,
        tipo: 'AUSENCIA',
        estado: a.estado,
        pasoActual: a.pasoActual,
        totalPasos: pasos.length,
        createdAt: a.createdAt.toISOString(),
        detalle: `${tipoLabel} del ${fmtDate(a.fechaInicio)} al ${fmtDate(a.fechaFin)} (${a.diasAusencia} días)`,
        pasos: enriquecerPasos(pasos, a.pasoActual, a.historial),
        obsRechazo: a.obsRechazo,
        cancelable: esCancelable('AUSENCIA', a.estado, a.pasoActual),
      });
    }

    // Map cambios diagrama
    for (const c of cambiosDiagrama) {
      const pasos = pasosDe(c);
      combined.push({
        id: c.id,
        tipo: 'CAMBIO_DIAGRAMA',
        estado: c.estado,
        pasoActual: c.pasoActual,
        totalPasos: pasos.length,
        createdAt: c.createdAt.toISOString(),
        detalle: `Cambio de diagrama: ${c.diagramaActual?.nombre ?? 'N/A'} → ${c.diagramaNuevo.nombre}`,
        pasos: enriquecerPasos(pasos, c.pasoActual, c.historial),
        obsRechazo: c.obsRechazo,
        cancelable: esCancelable('CAMBIO_DIAGRAMA', c.estado, c.pasoActual),
      });
    }

    // Sort by createdAt DESC
    combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json(combined);
  } catch (error) {
    console.error('Error listing mis solicitudes:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /mis-solicitudes/:tipo/:id/cancelar ────
//
// El dueño retira su solicitud mientras NADIE la haya firmado. Una firma
// intermedia la traba: a partir de ahí solo se sale por rechazo de la cadena.
// No hay días bloqueados que liberar: `inyectarDiasBloqueados` corre al aprobar,
// y acá solo entran solicitudes sin aprobar.

const TIPOS_CANCELABLES = ['planilla', 'vacacion', 'ausencia', 'cambio-diagrama'] as const;
type TipoCancelable = typeof TIPOS_CANCELABLES[number];

router.post('/:tipo/:id/cancelar', async (req: AuthRequest, res: Response): Promise<void> => {
  const tipo = req.params.tipo as TipoCancelable;
  const id = req.params.id as string;
  const userId = req.user!.userId;
  const empresaId = req.user!.empresaId;

  if (!TIPOS_CANCELABLES.includes(tipo)) {
    res.status(400).json({ error: `Tipo de solicitud desconocido: ${tipo}` });
    return;
  }

  try {
    switch (tipo) {
      case 'planilla': return await cancelarPlanilla(res, id, userId, empresaId);
      case 'vacacion': return await cancelarVacacion(res, id, userId, empresaId);
      case 'ausencia': return await cancelarAusencia(res, id, userId, empresaId);
      case 'cambio-diagrama': return await cancelarCambioDiagrama(res, id, userId, empresaId);
    }
  } catch (error) {
    if ((error as Error)?.message === 'CONCURRENT_MODIFICATION') {
      res.status(409).json({ error: 'La solicitud cambió mientras se cancelaba. Recargá la página.' });
      return;
    }
    console.error(`Error cancelando ${tipo}:`, error);
    res.status(500).json({ error: 'Error interno' });
  }
});

async function cancelarPlanilla(res: Response, id: string, userId: string, empresaId: string): Promise<void> {
  const planilla = await prisma.planilla.findUnique({
    where: { id },
    include: { usuario: { select: { empresaId: true } } },
  });
  if (!planilla || planilla.usuario.empresaId !== empresaId) {
    res.status(404).json({ error: 'Planilla no encontrada' }); return;
  }
  if (planilla.usuarioId !== userId) {
    res.status(403).json({ error: 'Solo el solicitante puede cancelar' }); return;
  }
  if (planilla.estado !== 'ENVIADA') {
    res.status(400).json({ error: `No se puede cancelar una planilla en estado ${planilla.estado}` }); return;
  }
  // El estado no alcanza: un circuito de un solo paso podría saltar de ENVIADA a
  // APROBADA sin pasar por EN_REVISION. Lo que decide es si alguien firmó.
  const firma = await prisma.planillaHistorial.findFirst({
    where: { planillaId: id, pasoFlujo: { gte: 1 }, createdAt: { gt: planilla.enviadaAt ?? new Date(0) } },
  });
  if (firma) {
    res.status(400).json({ error: 'La solicitud ya fue firmada por un aprobador' }); return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.planilla.updateMany({
      where: { id, estado: 'ENVIADA' },
      data: { estado: 'BORRADOR', pasoActual: 0, enviadaAt: null, circuitoSnapshot: Prisma.DbNull },
    });
    if (count === 0) throw new Error('CONCURRENT_MODIFICATION');
    await tx.planillaHistorial.create({
      data: { planillaId: id, usuarioId: userId, estadoAnterior: 'ENVIADA', estadoNuevo: 'BORRADOR', comentario: 'Cancelada por el solicitante' },
    });
    return tx.planilla.findUnique({ where: { id } });
  });
  res.json(updated);
}

async function cancelarVacacion(res: Response, id: string, userId: string, empresaId: string): Promise<void> {
  const vac = await prisma.vacacion.findUnique({
    where: { id },
    include: { usuario: { select: { empresaId: true } } },
  });
  if (!vac || vac.usuario.empresaId !== empresaId) {
    res.status(404).json({ error: 'Vacación no encontrada' }); return;
  }
  if (vac.usuarioId !== userId) {
    res.status(403).json({ error: 'Solo el solicitante puede cancelar' }); return;
  }
  if (vac.estado !== 'PENDIENTE') {
    res.status(400).json({ error: `No se puede cancelar una vacación en estado ${vac.estado}` }); return;
  }
  // Nace en paso 1 y sube uno por firma, sin salir de PENDIENTE: el estado solo no
  // distingue "nadie la miró" de "ya la firmaron dos". Mismo criterio que `esCancelable`.
  if (vac.pasoActual > 1) {
    res.status(400).json({ error: 'La solicitud ya fue firmada por un aprobador' }); return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.vacacion.updateMany({
      where: { id, estado: 'PENDIENTE', pasoActual: vac.pasoActual },
      data: { estado: 'CANCELADA' },
    });
    if (count === 0) throw new Error('CONCURRENT_MODIFICATION');
    // Mismo año que usó la reserva al crearla (createdAt), no el de las fechas:
    // así lo hace el POST y el DELETE que ya existen.
    const anio = new Date(vac.createdAt).getFullYear();
    await tx.vacacionSaldo.updateMany({
      where: { usuarioId: userId, anio },
      data: { diasPendientes: { decrement: vac.diasTotales } },
    });
    await tx.vacacionHistorial.create({
      data: { vacacionId: id, usuarioId: userId, estadoAnterior: 'PENDIENTE', estadoNuevo: 'CANCELADA', comentario: 'Cancelada por el solicitante' },
    });
    return tx.vacacion.findUnique({ where: { id } });
  });
  res.json(updated);
}

async function cancelarAusencia(res: Response, id: string, userId: string, empresaId: string): Promise<void> {
  const aus = await prisma.ausencia.findUnique({
    where: { id },
    include: { usuario: { select: { empresaId: true } } },
  });
  if (!aus || aus.usuario.empresaId !== empresaId) {
    res.status(404).json({ error: 'Ausencia no encontrada' }); return;
  }
  if (aus.usuarioId !== userId) {
    res.status(403).json({ error: 'Solo el solicitante puede cancelar' }); return;
  }
  if (aus.cargaManual) {
    res.status(400).json({ error: 'Las marcas manuales se quitan desde la planilla' }); return;
  }
  if (aus.estado !== 'PENDIENTE') {
    res.status(400).json({ error: `No se puede cancelar una ausencia en estado ${aus.estado}` }); return;
  }
  if (aus.pasoActual > 1) {
    res.status(400).json({ error: 'La solicitud ya fue firmada por un aprobador' }); return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.ausencia.updateMany({
      where: { id, estado: 'PENDIENTE', pasoActual: aus.pasoActual },
      data: { estado: 'CANCELADA', aprobada: false },
    });
    if (count === 0) throw new Error('CONCURRENT_MODIFICATION');
    if (aus.tipo === 'FRANCO_COMPENSATORIO') {
      const anio = new Date(aus.fechaInicio).getUTCFullYear();
      await tx.vacacionSaldo.updateMany({
        where: { usuarioId: userId, anio },
        data: { compensatoriosPendientes: { decrement: aus.diasAusencia } },
      });
    }
    await tx.ausenciaHistorial.create({
      data: { ausenciaId: id, usuarioId: userId, estadoAnterior: 'PENDIENTE', estadoNuevo: 'CANCELADA', comentario: 'Cancelada por el solicitante' },
    });
    return tx.ausencia.findUnique({ where: { id } });
  });
  res.json(updated);
}

async function cancelarCambioDiagrama(res: Response, id: string, userId: string, empresaId: string): Promise<void> {
  const sol = await prisma.solicitudCambioDiagrama.findUnique({
    where: { id },
    include: { usuario: { select: { empresaId: true } } },
  });
  if (!sol || sol.usuario.empresaId !== empresaId) {
    res.status(404).json({ error: 'Solicitud no encontrada' }); return;
  }
  if (sol.solicitanteId !== userId) {
    res.status(403).json({ error: 'Solo el solicitante puede cancelar' }); return;
  }
  if (sol.estado !== 'PENDIENTE') {
    res.status(400).json({ error: `No se puede cancelar una solicitud en estado ${sol.estado}` }); return;
  }
  if (sol.pasoActual > 1) {
    res.status(400).json({ error: 'La solicitud ya fue firmada por un aprobador' }); return;
  }
  // El cambio de diagrama no tiene CANCELADA en su enum: el borrado físico es la
  // semántica que ya tenía y no se cambia acá. Su historial va con onDelete: Cascade.
  const { count } = await prisma.solicitudCambioDiagrama.deleteMany({
    where: { id, estado: 'PENDIENTE', pasoActual: sol.pasoActual },
  });
  if (count === 0) throw new Error('CONCURRENT_MODIFICATION');
  res.json({ id, estado: 'CANCELADA' });
}

export default router;
