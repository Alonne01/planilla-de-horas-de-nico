import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH, LEVEL_ADMIN } from '../middleware/roles.middleware.js';
import { feriadosVigentes, olvidarFeriados } from '../utils/contexto-dia.utils.js';
import {
  sincronizarFeriados,
  aniosDeInteres,
  ultimaSincronizacion,
} from '../utils/feriados-sync.service.js';
import { logAuditoria } from '../lib/auditoria.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);
router.use(requireLevel(LEVEL_RRHH));

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// ─── GET /admin/feriados ─────────────────────────
// Estado del calendario: qué feriados están vigentes, de dónde salió cada uno y
// cuándo fue la última vez que se pudo consultar internet.

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [{ mapa }, nacionales, config, ultima] = await Promise.all([
      feriadosVigentes(req.user!.empresaId),
      prisma.feriadoNacional.findMany({
        select: { fecha: true, nombre: true, tipo: true, origen: true },
        orderBy: { fecha: 'asc' },
      }),
      prisma.empresaConfig.findFirst({
        where: { empresaId: req.user!.empresaId },
        select: { feriadosPersonalizados: true },
      }),
      ultimaSincronizacion(),
    ]);

    const propios = Array.isArray(config?.feriadosPersonalizados)
      ? (config!.feriadosPersonalizados as unknown[])
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.slice(0, 10))
          .filter((x) => FECHA.test(x))
      : [];

    const porFecha = new Map(nacionales.map((f) => [f.fecha, f]));

    res.json({
      ultimaSincronizacion: ultima,
      // Sin filas sincronizadas el cálculo corre con el respaldo del código, que
      // envejece: conviene que se vea en la pantalla de configuración.
      sincronizado: nacionales.length > 0,
      total: mapa.size,
      feriados: [...mapa.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([fecha, nombre]) => {
          const nacional = porFecha.get(fecha);
          return {
            fecha,
            nombre,
            tipo: nacional?.tipo ?? null,
            origen: nacional ? nacional.origen : propios.includes(fecha) ? 'EMPRESA' : 'RESPALDO',
          };
        }),
    });
  } catch (error) {
    console.error('Error listing feriados admin:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /admin/feriados/sincronizar ────────────
// Fuerza la consulta a internet sin esperar el ciclo de 24 h.

const sincronizarSchema = z.object({
  anios: z.array(z.number().int().min(2000).max(2100)).min(1).max(10).optional(),
});

router.post('/sincronizar', requireLevel(LEVEL_ADMIN), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = sincronizarSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const anios = parsed.data.anios ?? aniosDeInteres();
    const resultados = await sincronizarFeriados(anios);
    const algunoOk = resultados.some((r) => r.ok);

    await logAuditoria({
      entidad: 'FeriadoNacional',
      entidadId: anios.join(','),
      accion: 'EDITAR',
      descripcion:
        'Sincronización manual desde internet — ' +
        resultados.map((r) => `${r.anio}: ${r.ok ? `${r.guardados} feriados` : r.detalle}`).join(' | '),
      usuarioId: req.user!.userId,
    }).catch(() => { /* la auditoría no puede tumbar la respuesta */ });

    // 200 aunque falle: no es un error del pedido, es que no hubo internet. El
    // detalle por año dice qué pasó y el cálculo sigue con lo que ya estaba.
    res.json({
      ok: algunoOk,
      mensaje: algunoOk
        ? 'Feriados actualizados desde internet'
        : 'No se pudo consultar internet; se conservan los feriados que ya estaban',
      resultados,
    });
  } catch (error) {
    console.error('Error sincronizando feriados:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /admin/feriados/empresa ─────────────────
// Los feriados propios de la empresa (los del CCT, los de un convenio local).
// No toca los nacionales: esos los maneja la sincronización.

const propiosSchema = z.object({
  fechas: z.array(z.string().regex(FECHA, 'Usar formato YYYY-MM-DD')).max(200),
});

router.put('/empresa', requireLevel(LEVEL_ADMIN), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = propiosSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const fechas = [...new Set(parsed.data.fechas)].sort();
    const previo = await prisma.empresaConfig.findFirst({
      where: { empresaId: req.user!.empresaId },
      select: { id: true, feriadosPersonalizados: true },
    });
    if (!previo) {
      res.status(404).json({ error: 'Configuración no encontrada' });
      return;
    }

    await prisma.empresaConfig.update({
      where: { empresaId: req.user!.empresaId },
      data: { feriadosPersonalizados: fechas },
    });

    olvidarFeriados(req.user!.empresaId);
    await logAuditoria({
      entidad: 'EmpresaConfig',
      entidadId: previo.id,
      accion: 'EDITAR',
      campo: 'feriadosPersonalizados',
      valorAnterior: JSON.stringify(previo.feriadosPersonalizados).slice(0, 1000),
      valorNuevo: JSON.stringify(fechas).slice(0, 1000),
      descripcion: `Feriados propios de la empresa: ${fechas.length} fechas`,
      usuarioId: req.user!.userId,
    }).catch(() => { /* la auditoría no puede tumbar la respuesta */ });

    res.json({ fechas });
  } catch (error) {
    console.error('Error updating feriados de empresa:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
