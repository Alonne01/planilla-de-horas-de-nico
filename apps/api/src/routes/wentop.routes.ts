import { Router, Response } from 'express';
import { PrismaClient, WentopEstado, WentopTipoTarjeta } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH, LEVEL_CMASS } from '../middleware/roles.middleware.js';
import {
  upload,
  uploadLimiter,
  descartarArchivos,
  pesoTotalDeUploads,
  MAX_FOTOS_POR_TARJETA,
  MAX_BYTES_POR_TARJETA,
} from '../middleware/upload.middleware.js';
import { fechaDia } from '../utils/zod.utils.js';
import { claveFecha, hoyLocalEmpresa } from '../utils/fecha-dia.utils.js';
import { unlink } from 'fs/promises';
import path from 'path';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── Constants ───────────────────────────────────

const VALID_TIPOS = ['DETENCION_TAREAS', 'CONDICION_INSEGURA', 'ACTO_INSEGURO', 'CASI_ACCIDENTE', 'OBSERVACION_POSITIVA'] as const;

// Tope del listado: sin cota, una tarjeta con textos enormes multiplicada por
// muchas filas hace que el findMany + serialización se coma la memoria del proceso.
const MAX_TARJETAS_LISTADO = 500;

// Textos de la tarjeta: los campos son text/jsonb sin cota en el schema, así que
// el único límite real sería el body de 10 MB de express. Se acotan acá.
const MAX_TEXTO_LARGO = 2000;
const MAX_TEXTO_CORTO = 200;
const MAX_CATEGORIAS = 50;

/**
 * Tope de escrituras de tarjetas por usuario. Va por usuario y no por IP por el
 * mismo motivo que uploadLimiter: detrás de nginx la IP es la del proxy.
 */
const escrituraLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as AuthRequest).user?.userId ?? 'anonimo',
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Demasiadas tarjetas en poco tiempo. Esperá un rato antes de seguir cargando.',
    });
  },
});

// ─── Schemas ─────────────────────────────────────

const textoLargoOpcional = z.string().max(MAX_TEXTO_LARGO).nullable().optional();
const textoCortoOpcional = z.string().max(MAX_TEXTO_CORTO).nullable().optional();
const categorias = z.array(z.string().max(MAX_TEXTO_CORTO)).max(MAX_CATEGORIAS).optional();

const tarjetaSchema = z.object({
  fechaReporte: fechaDia,
  sectorObservacionId: z.string().uuid().nullable().optional(),
  sectorTercero: z.boolean().optional(),
  cliente: textoCortoOpcional,
  lugarPozoLocacion: textoCortoOpcional,
  tipoTarjeta: z.enum(VALID_TIPOS),
  calidad: categorias,
  medioambiente: categorias,
  seguridadSalud: categorias,
  descripcion: z.string().min(1).max(MAX_TEXTO_LARGO),
  accionesInmediatas: textoLargoOpcional,
  recomendaciones: textoLargoOpcional,
  justificacionAbierta: textoLargoOpcional,
});

const updateTarjetaSchema = tarjetaSchema.partial();

const estadoSchema = z.object({
  estado: z.enum(['ABIERTA', 'EN_PROGRESO', 'CERRADA']),
  accionCierre: z.string().max(MAX_TEXTO_LARGO).nullable().optional(),
  fechaCierre: fechaDia.nullable().optional(),
});

// ─── Helper ──────────────────────────────────────

type UsuarioWentop = { userId: string; empresaId: string; rol: string; rolNivel: number };

/**
 * Los sectores cuyas tarjetas puede ver el usuario, y si su alcance es global.
 *
 * Mismo criterio que `buildVisibilityWhere`, pero devuelto como lista en vez de
 * como `where`: lo necesitan el selector de sector del tablero (para saber si
 * mostrarlo) y la validación del filtro (para saber si el sector pedido está
 * permitido).
 */
async function alcanceDeSectores(user: UsuarioWentop): Promise<{ global: boolean; sectores: { id: string; nombre: string }[] }> {
  if (user.rol === 'CMASS' || user.rolNivel >= 90) {
    const sectores = await prisma.sector.findMany({
      where: { empresaId: user.empresaId, activo: true },
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });
    return { global: true, sectores };
  }

  const [usuario, gestorDe] = await Promise.all([
    prisma.usuario.findUnique({ where: { id: user.userId }, select: { sectorId: true } }),
    prisma.wentopGestor.findMany({ where: { usuarioId: user.userId, activo: true }, select: { sectorId: true } }),
  ]);

  const ids = new Set<string>();
  if (usuario?.sectorId) ids.add(usuario.sectorId);
  for (const g of gestorDe) ids.add(g.sectorId);

  const sectores = ids.size === 0 ? [] : await prisma.sector.findMany({
    where: { id: { in: [...ids] }, empresaId: user.empresaId },
    select: { id: true, nombre: true },
    orderBy: { nombre: 'asc' },
  });
  return { global: false, sectores };
}

/**
 * Rango de `fechaReporte` a partir de `desde`/`hasta` de la query.
 *
 * Devuelve `null` si alguno es inválido, para que el llamador conteste 400: sin
 * el guard, un `?desde=abc` propaga un Invalid Date al `where` de Prisma y la
 * ruta entera contesta 500.
 */
function filtroFechaReporte(query: Record<string, unknown>): { ok: true; filtro?: { gte?: Date; lte?: Date } } | { ok: false; campo: string } {
  const filtro: { gte?: Date; lte?: Date } = {};
  for (const campo of ['desde', 'hasta'] as const) {
    const valor = query[campo];
    if (!valor) continue;
    const d = new Date(valor as string);
    if (isNaN(d.getTime())) return { ok: false, campo };
    if (campo === 'desde') filtro.gte = d;
    else filtro.lte = d;
  }
  return { ok: true, filtro: Object.keys(filtro).length > 0 ? filtro : undefined };
}

async function canManageWentop(
  userId: string,
  rol: string,
  rolNivel: number,
  sectorObservacionId: string | null,
): Promise<boolean> {
  if (rol === 'CMASS' || rolNivel >= 90) return true;

  if (rolNivel >= 70 && sectorObservacionId) {
    const user = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { sectorId: true },
    });
    if (user?.sectorId === sectorObservacionId) return true;
  }

  if (sectorObservacionId) {
    const gestor = await prisma.wentopGestor.findFirst({
      where: { usuarioId: userId, sectorId: sectorObservacionId, activo: true },
    });
    if (gestor) return true;
  }

  return false;
}

// El sector de observación define quién gestiona la tarjeta (canManageWentop /
// buildVisibilityWhere), así que uno de otra empresa la deja fuera del alcance de
// los gestores del propio tenant.
async function sectorEsDeLaEmpresa(sectorId: string, empresaId: string): Promise<boolean> {
  const sector = await prisma.sector.findFirst({
    where: { id: sectorId, empresaId },
    select: { id: true },
  });
  return sector !== null;
}

// Build visibility filter for tarjetas — based on observation sector
async function buildVisibilityWhere(user: { userId: string; empresaId: string; rol: string; rolNivel: number }) {
  const base: any = { empresaId: user.empresaId };

  if (user.rol === 'CMASS' || user.rolNivel >= 90) {
    return base;
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id: user.userId },
    select: { sectorId: true },
  });

  const gestorSectors = await prisma.wentopGestor.findMany({
    where: { usuarioId: user.userId, activo: true },
    select: { sectorId: true },
  });

  const sectorIds: string[] = [];
  if (usuario?.sectorId) sectorIds.push(usuario.sectorId);
  for (const g of gestorSectors) {
    if (!sectorIds.includes(g.sectorId)) sectorIds.push(g.sectorId);
  }

  return {
    ...base,
    OR: [
      { sectorObservacionId: { in: sectorIds } },
      { creadorId: user.userId },
    ],
  };
}

/**
 * Alcance del TABLERO, que no es el del listado.
 *
 * `buildVisibilityWhere` incluye `{ creadorId: vos }` para que siempre puedas
 * encontrar una tarjeta tuya, aunque la hayas cargado sobre otro sector. En un
 * tablero que dice "sector X" esa rama mete tarjetas de otros sectores y los
 * números dejan de coincidir con los que ve el gestor de X. Por eso son dos
 * funciones y no una con un flag: el flag se termina pasando mal.
 */
async function buildAnalyticsWhere(
  user: UsuarioWentop,
  sectorId?: string,
): Promise<{ where: any } | { status: number; error: string }> {
  const alcance = await alcanceDeSectores(user);

  if (sectorId) {
    if (!alcance.global && !alcance.sectores.some((s) => s.id === sectorId)) {
      // 403 explícito y no un tablero vacío: en pantalla los dos se ven igual, y
      // el segundo se termina reportando como bug de datos faltantes.
      return { status: 403, error: 'Sin permiso para ver ese sector' };
    }
    return { where: { empresaId: user.empresaId, sectorObservacionId: sectorId } };
  }

  if (alcance.global) return { where: { empresaId: user.empresaId } };

  return {
    where: {
      empresaId: user.empresaId,
      sectorObservacionId: { in: alcance.sectores.map((s) => s.id) },
    },
  };
}

const tarjetaInclude = {
  creador: { select: { nombre: true, apellido: true, legajo: true, sector: { select: { id: true, nombre: true } } } },
  sectorObservacion: { select: { id: true, nombre: true } },
  _count: { select: { fotos: true } },
};

const tarjetaDetailInclude = {
  creador: { select: { nombre: true, apellido: true, legajo: true, sector: { select: { id: true, nombre: true } } } },
  sectorObservacion: { select: { id: true, nombre: true } },
  fotos: true,
};

// ─── GET /wentop/analytics ───────────────────────

router.get('/analytics', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const alcance = await buildAnalyticsWhere(req.user!, req.query.sectorId as string | undefined);
    if ('error' in alcance) {
      res.status(alcance.status).json({ error: alcance.error });
      return;
    }
    const where: any = alcance.where;

    const fechas = filtroFechaReporte(req.query as Record<string, unknown>);
    if (!fechas.ok) {
      res.status(400).json({ error: `Parámetro "${fechas.campo}" inválido` });
      return;
    }
    if (fechas.filtro) where.fechaReporte = fechas.filtro;

    const tarjetas = await prisma.wentopTarjeta.findMany({
      where,
      select: {
        estado: true,
        tipoTarjeta: true,
        sectorObservacionId: true,
        sectorObservacion: { select: { nombre: true } },
        fechaReporte: true,
        calidad: true,
        medioambiente: true,
        seguridadSalud: true,
      },
    });

    const total = tarjetas.length;
    const abierta = tarjetas.filter((t) => t.estado === 'ABIERTA').length;
    const enProgreso = tarjetas.filter((t) => t.estado === 'EN_PROGRESO').length;
    const cerrada = tarjetas.filter((t) => t.estado === 'CERRADA').length;

    // Por tipo
    const tipoMap = new Map<string, number>();
    for (const t of tarjetas) {
      tipoMap.set(t.tipoTarjeta, (tipoMap.get(t.tipoTarjeta) || 0) + 1);
    }
    const porTipo = Array.from(tipoMap.entries()).map(([tipo, count]) => ({ tipo, count }));

    // Por sector
    const sectorMap = new Map<string, { sectorNombre: string; count: number }>();
    for (const t of tarjetas) {
      if (t.sectorObservacionId) {
        const existing = sectorMap.get(t.sectorObservacionId);
        if (existing) {
          existing.count++;
        } else {
          sectorMap.set(t.sectorObservacionId, {
            sectorNombre: t.sectorObservacion?.nombre || '',
            count: 1,
          });
        }
      }
    }
    const porSector = Array.from(sectorMap.entries()).map(([sectorId, v]) => ({
      sectorId,
      sectorNombre: v.sectorNombre,
      count: v.count,
    }));

    // Por mes
    const mesMap = new Map<string, number>();
    for (const t of tarjetas) {
      const mes = claveFecha(t.fechaReporte).slice(0, 7);
      mesMap.set(mes, (mesMap.get(mes) || 0) + 1);
    }
    const porMes = Array.from(mesMap.entries())
      .map(([mes, count]) => ({ mes, count }))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    // Por categoría — parse JSON arrays and count label occurrences
    function countLabels(items: any[], field: string): { label: string; count: number }[] {
      const map = new Map<string, number>();
      for (const item of items) {
        const arr = item[field];
        if (Array.isArray(arr)) {
          for (const label of arr) {
            if (typeof label === 'string') {
              map.set(label, (map.get(label) || 0) + 1);
            }
          }
        }
      }
      return Array.from(map.entries()).map(([label, count]) => ({ label, count }));
    }

    const porCategoria = {
      calidad: countLabels(tarjetas, 'calidad'),
      medioambiente: countLabels(tarjetas, 'medioambiente'),
      seguridadSalud: countLabels(tarjetas, 'seguridadSalud'),
    };

    res.json({
      totales: { total, abierta, enProgreso, cerrada },
      porTipo,
      porSector,
      porMes,
      porCategoria,
    });
  } catch (error) {
    console.error('Error fetching wentop analytics:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /wentop/sectores ────────────────────────
// Catálogo de sectores SIN guardia de nivel.
//
// El front pedía esta lista a `/analytics/sectores`, que exige nivel 70: para un
// operador eso era un 403 y la lista quedaba vacía. No sólo lo dejaba sin filtro
// — el MISMO array alimenta el `<select>` del asistente de alta, así que un
// operador no podía elegir el sector de observación de su propia tarjeta.
// Son id y nombre, que ya viajan dentro de cada tarjeta que ese usuario ve.
router.get('/sectores', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sectores = await prisma.sector.findMany({
      where: { empresaId: req.user!.empresaId, activo: true },
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });
    res.json(sectores);
  } catch (error) {
    console.error('Error listing sectores wentop:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /wentop/mi-alcance ──────────────────────
// Qué sectores puede mirar el tablero de quien pregunta. El front lo usa para
// decidir si muestra el selector: con un solo sector no hay nada que elegir.

router.get('/mi-alcance', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.json(await alcanceDeSectores(req.user!));
  } catch (error) {
    console.error('Error fetching alcance wentop:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /wentop/mis-gestores ────────────────────
// Returns the current user's gestor sector assignments (no role guard)

router.get('/mis-gestores', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const gestores = await prisma.wentopGestor.findMany({
      where: { usuarioId: req.user!.userId, activo: true },
      select: { sectorId: true },
    });
    res.json(gestores.map((g) => g.sectorId));
  } catch (error) {
    console.error('Error fetching mis gestores:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /wentop/gestores ────────────────────────

router.get('/gestores', requireLevel(LEVEL_CMASS), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const gestores = await prisma.wentopGestor.findMany({
      where: { empresaId: req.user!.empresaId, activo: true },
      include: {
        usuario: { select: { nombre: true, apellido: true, email: true, legajo: true } },
        sector: { select: { nombre: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(gestores);
  } catch (error) {
    console.error('Error listing wentop gestores:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /wentop/gestores ───────────────────────

router.post('/gestores', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { usuarioId, sectorId } = req.body;

    if (!usuarioId || !sectorId) {
      res.status(400).json({ error: 'usuarioId y sectorId son requeridos' });
      return;
    }

    // Validate both IDs belong to the same empresa
    const [usuario, sector] = await Promise.all([
      prisma.usuario.findFirst({ where: { id: usuarioId, empresaId: req.user!.empresaId }, select: { id: true } }),
      prisma.sector.findFirst({ where: { id: sectorId, empresaId: req.user!.empresaId }, select: { id: true } }),
    ]);

    if (!usuario) {
      res.status(400).json({ error: 'Usuario no encontrado en esta empresa' });
      return;
    }
    if (!sector) {
      res.status(400).json({ error: 'Sector no encontrado en esta empresa' });
      return;
    }

    const gestor = await prisma.wentopGestor.upsert({
      where: { usuarioId_sectorId: { usuarioId, sectorId } },
      update: { activo: true, empresaId: req.user!.empresaId },
      create: {
        empresaId: req.user!.empresaId,
        usuarioId,
        sectorId,
      },
      include: {
        usuario: { select: { nombre: true, apellido: true, email: true, legajo: true } },
        sector: { select: { nombre: true } },
      },
    });

    res.status(201).json(gestor);
  } catch (error) {
    console.error('Error creating wentop gestor:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── DELETE /wentop/gestores/:id ─────────────────

router.delete('/gestores/:id', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.wentopGestor.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Gestor no encontrado' });
      return;
    }

    await prisma.wentopGestor.update({
      where: { id: req.params.id },
      data: { activo: false },
    });

    res.status(204).send();
  } catch (error) {
    console.error('Error removing wentop gestor:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /wentop ─────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { estado, tipoTarjeta, sectorId } = req.query;

    const where: any = await buildVisibilityWhere(req.user!);

    if (estado) {
      if (!Object.values(WentopEstado).includes(estado as WentopEstado)) {
        res.status(400).json({ error: 'Parámetro "estado" inválido' }); return;
      }
      where.estado = estado as string;
    }
    if (tipoTarjeta) {
      if (!Object.values(WentopTipoTarjeta).includes(tipoTarjeta as WentopTipoTarjeta)) {
        res.status(400).json({ error: 'Parámetro "tipoTarjeta" inválido' }); return;
      }
      where.tipoTarjeta = tipoTarjeta as string;
    }
    if (sectorId) where.sectorObservacionId = sectorId as string;

    const fechas = filtroFechaReporte(req.query as Record<string, unknown>);
    if (!fechas.ok) {
      res.status(400).json({ error: `Parámetro "${fechas.campo}" inválido` });
      return;
    }
    if (fechas.filtro) where.fechaReporte = fechas.filtro;

    const tarjetas = await prisma.wentopTarjeta.findMany({
      where,
      include: tarjetaInclude,
      orderBy: { fechaReporte: 'desc' },
      take: MAX_TARJETAS_LISTADO,
    });

    res.json(tarjetas);
  } catch (error) {
    console.error('Error listing wentop tarjetas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /wentop/:id ────────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const where: any = await buildVisibilityWhere(req.user!);
    where.id = req.params.id;

    const tarjeta = await prisma.wentopTarjeta.findFirst({
      where,
      include: tarjetaDetailInclude,
    });

    if (!tarjeta) {
      res.status(404).json({ error: 'Tarjeta no encontrada' });
      return;
    }

    res.json(tarjeta);
  } catch (error) {
    console.error('Error fetching wentop tarjeta:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /wentop ────────────────────────────────

router.post('/', escrituraLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = tarjetaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const {
      fechaReporte,
      sectorObservacionId,
      sectorTercero,
      cliente,
      lugarPozoLocacion,
      tipoTarjeta,
      calidad,
      medioambiente,
      seguridadSalud,
      descripcion,
      accionesInmediatas,
      recomendaciones,
      justificacionAbierta,
    } = parsed.data;

    if (sectorObservacionId && !(await sectorEsDeLaEmpresa(sectorObservacionId, req.user!.empresaId))) {
      res.status(400).json({ error: 'Sector de observación no encontrado en esta empresa' });
      return;
    }

    const tarjeta = await prisma.wentopTarjeta.create({
      data: {
        empresaId: req.user!.empresaId,
        creadorId: req.user!.userId,
        estado: 'ABIERTA',
        fechaReporte,
        sectorObservacionId: sectorObservacionId || null,
        sectorTercero: sectorTercero ?? false,
        cliente: cliente || null,
        lugarPozoLocacion: lugarPozoLocacion || null,
        tipoTarjeta,
        calidad: calidad ?? [],
        medioambiente: medioambiente ?? [],
        seguridadSalud: seguridadSalud ?? [],
        descripcion,
        accionesInmediatas: accionesInmediatas || null,
        recomendaciones: recomendaciones || null,
        justificacionAbierta: justificacionAbierta || null,
      },
      include: tarjetaDetailInclude,
    });

    res.status(201).json(tarjeta);
  } catch (error) {
    console.error('Error creating wentop tarjeta:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── PUT /wentop/:id ─────────────────────────────

router.put('/:id', escrituraLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = updateTarjetaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const tarjeta = await prisma.wentopTarjeta.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });

    if (!tarjeta) {
      res.status(404).json({ error: 'Tarjeta no encontrada' });
      return;
    }

    const isCreator = tarjeta.creadorId === req.user!.userId;
    const canManage = await canManageWentop(req.user!.userId, req.user!.rol, req.user!.rolNivel, tarjeta.sectorObservacionId);

    if (!isCreator && !canManage) {
      res.status(403).json({ error: 'No tiene permisos para editar esta tarjeta' });
      return;
    }

    if (tarjeta.estado === 'CERRADA' && req.user!.rolNivel < 90) {
      res.status(400).json({ error: 'No se puede editar una tarjeta cerrada' });
      return;
    }

    const {
      fechaReporte,
      sectorObservacionId,
      sectorTercero,
      cliente,
      lugarPozoLocacion,
      tipoTarjeta,
      calidad,
      medioambiente,
      seguridadSalud,
      descripcion,
      accionesInmediatas,
      recomendaciones,
      justificacionAbierta,
    } = parsed.data;

    if (sectorObservacionId && !(await sectorEsDeLaEmpresa(sectorObservacionId, req.user!.empresaId))) {
      res.status(400).json({ error: 'Sector de observación no encontrado en esta empresa' });
      return;
    }

    const updated = await prisma.wentopTarjeta.update({
      where: { id: req.params.id },
      data: {
        ...(fechaReporte !== undefined && { fechaReporte }),
        ...(sectorObservacionId !== undefined && { sectorObservacionId: sectorObservacionId || null }),
        ...(sectorTercero !== undefined && { sectorTercero }),
        ...(cliente !== undefined && { cliente: cliente || null }),
        ...(lugarPozoLocacion !== undefined && { lugarPozoLocacion: lugarPozoLocacion || null }),
        ...(tipoTarjeta !== undefined && { tipoTarjeta }),
        ...(calidad !== undefined && { calidad }),
        ...(medioambiente !== undefined && { medioambiente }),
        ...(seguridadSalud !== undefined && { seguridadSalud }),
        ...(descripcion !== undefined && { descripcion }),
        ...(accionesInmediatas !== undefined && { accionesInmediatas: accionesInmediatas || null }),
        ...(recomendaciones !== undefined && { recomendaciones: recomendaciones || null }),
        ...(justificacionAbierta !== undefined && { justificacionAbierta: justificacionAbierta || null }),
      },
      include: tarjetaDetailInclude,
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating wentop tarjeta:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── PATCH /wentop/:id/estado ────────────────────

router.patch('/:id/estado', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tarjeta = await prisma.wentopTarjeta.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });

    if (!tarjeta) {
      res.status(404).json({ error: 'Tarjeta no encontrada' });
      return;
    }

    const isCreator = tarjeta.creadorId === req.user!.userId;
    const canManage = await canManageWentop(req.user!.userId, req.user!.rol, req.user!.rolNivel, tarjeta.sectorObservacionId);

    if (!isCreator && !canManage) {
      res.status(403).json({ error: 'No tiene permisos para cambiar el estado' });
      return;
    }

    const parsed = estadoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const { estado, accionCierre, fechaCierre } = parsed.data;

    const data: any = { estado };

    if (estado === 'CERRADA') {
      if (!accionCierre) {
        res.status(400).json({ error: 'accionCierre es requerido para cerrar la tarjeta' });
        return;
      }
      data.accionCierre = accionCierre;
      // `fecha_cierre` es una FECHA-DÍA (la normaliza la migración
      // 20260727173000_normalizar_fechas_dia junto con `fecha_reporte`), así que
      // el valor por defecto tiene que ser el DÍA de hoy en el huso de la empresa,
      // no el instante en que se cerró. Con `new Date()`, cerrar una tarjeta entre
      // las 21:00 y las 24:00 argentinas grababa un instante dentro de la ventana
      // (00:00, 03:00) UTC — justo la que el encabezado de esa migración declara
      // como precondición a revalidar, porque ahí truncar corre el día uno hacia
      // adelante. El front siempre manda `fechaCierre`, así que sólo lo alcanza un
      // cliente que la omita.
      data.fechaCierre = fechaCierre ?? hoyLocalEmpresa();
    } else {
      // Clear closure data when reopening
      data.accionCierre = null;
      data.fechaCierre = null;
    }

    const updated = await prisma.wentopTarjeta.update({
      where: { id: req.params.id },
      data,
      include: tarjetaDetailInclude,
    });

    res.json(updated);
  } catch (error) {
    console.error('Error changing wentop tarjeta estado:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── DELETE /wentop/:id ──────────────────────────

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tarjeta = await prisma.wentopTarjeta.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });

    if (!tarjeta) {
      res.status(404).json({ error: 'Tarjeta no encontrada' });
      return;
    }

    const isCreator = tarjeta.creadorId === req.user!.userId;
    const isAdmin = req.user!.rolNivel >= 90;

    if (!isAdmin && (!isCreator || tarjeta.estado !== 'ABIERTA')) {
      res.status(403).json({ error: 'Solo puede eliminar sus propias tarjetas en estado ABIERTA' });
      return;
    }

    // Collect photo URLs for cleanup after DB delete
    const fotos = await prisma.wentopFoto.findMany({
      where: { tarjetaId: tarjeta.id },
      select: { url: true },
    });

    // DB delete first (cascade deletes WentopFoto records)
    await prisma.wentopTarjeta.delete({ where: { id: req.params.id } });

    // Then clean up files from disk (best-effort)
    for (const foto of fotos) {
      const filename = foto.url.replace('/uploads/', '');
      const filePath = path.resolve(process.cwd(), 'uploads', filename);
      try {
        await unlink(filePath);
      } catch {
        // File may already be deleted
      }
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting wentop tarjeta:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /wentop/:id/fotos ─────────────────────

router.post('/:id/fotos', uploadLimiter, upload.array('fotos', MAX_FOTOS_POR_TARJETA), async (req: AuthRequest, res: Response): Promise<void> => {
  const files = req.files as Express.Multer.File[] | undefined;
  try {
    const tarjeta = await prisma.wentopTarjeta.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
      include: { fotos: { select: { url: true } } },
    });

    if (!tarjeta) {
      descartarArchivos(files);
      res.status(404).json({ error: 'Tarjeta no encontrada' });
      return;
    }

    const isCreator = tarjeta.creadorId === req.user!.userId;
    const canManage = await canManageWentop(req.user!.userId, req.user!.rol, req.user!.rolNivel, tarjeta.sectorObservacionId);

    if (!isCreator && !canManage) {
      descartarArchivos(files);
      res.status(403).json({ error: 'No tiene permisos para subir fotos a esta tarjeta' });
      return;
    }

    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No se enviaron archivos' });
      return;
    }

    // Límites ACUMULADOS por tarjeta: el tope de multer es por request, así que
    // sin esto se puede repetir la llamada y subir fotos sin fin.
    const yaCargadas = tarjeta.fotos.length;
    if (yaCargadas + files.length > MAX_FOTOS_POR_TARJETA) {
      descartarArchivos(files);
      const disponibles = Math.max(0, MAX_FOTOS_POR_TARJETA - yaCargadas);
      res.status(400).json({
        error: disponibles === 0
          ? `La tarjeta ya tiene el máximo de ${MAX_FOTOS_POR_TARJETA} fotos`
          : `Solo se pueden agregar ${disponibles} foto(s) más: el máximo por tarjeta es ${MAX_FOTOS_POR_TARJETA}`,
      });
      return;
    }

    const pesoExistente = pesoTotalDeUploads(tarjeta.fotos.map((f) => f.url));
    const pesoNuevo = files.reduce((acc, f) => acc + f.size, 0);
    if (pesoExistente + pesoNuevo > MAX_BYTES_POR_TARJETA) {
      descartarArchivos(files);
      res.status(400).json({
        error: `Se supera el máximo de ${Math.round(MAX_BYTES_POR_TARJETA / 1024 / 1024)} MB de fotos por tarjeta`,
      });
      return;
    }

    const fotos = await Promise.all(
      files.map((file) =>
        prisma.wentopFoto.create({
          data: {
            tarjetaId: tarjeta.id,
            url: `/uploads/${file.filename}`,
          },
        }),
      ),
    );

    res.status(201).json(fotos);
  } catch (error) {
    console.error('Error uploading wentop fotos:', error);
    descartarArchivos(files);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── DELETE /wentop/:id/fotos/:fotoId ────────────

router.delete('/:id/fotos/:fotoId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tarjeta = await prisma.wentopTarjeta.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });

    if (!tarjeta) {
      res.status(404).json({ error: 'Tarjeta no encontrada' });
      return;
    }

    const isCreator = tarjeta.creadorId === req.user!.userId;
    const canManage = await canManageWentop(req.user!.userId, req.user!.rol, req.user!.rolNivel, tarjeta.sectorObservacionId);

    if (!isCreator && !canManage) {
      res.status(403).json({ error: 'No tiene permisos para eliminar fotos de esta tarjeta' });
      return;
    }

    const foto = await prisma.wentopFoto.findFirst({
      where: { id: req.params.fotoId, tarjetaId: tarjeta.id },
    });

    if (!foto) {
      res.status(404).json({ error: 'Foto no encontrada' });
      return;
    }

    const filename = foto.url.replace('/uploads/', '');
    const filePath = path.resolve(process.cwd(), 'uploads', filename);
    try {
      await unlink(filePath);
    } catch {
      // File may already be deleted
    }

    await prisma.wentopFoto.delete({ where: { id: foto.id } });

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting wentop foto:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
