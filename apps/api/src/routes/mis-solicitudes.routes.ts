import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
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

      prisma.ausencia.findMany({
        where: {
          usuarioId: userId,
          requiereAprobacion: true,
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

export default router;
